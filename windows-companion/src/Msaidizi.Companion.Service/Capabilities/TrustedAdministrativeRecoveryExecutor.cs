using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Microsoft.Win32;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

public sealed record TrustedAdministrativeRecoveryRequest(
  string OriginalActionId,
  string RecoveryRecordSha256,
  string ExpectedCurrentStateSha256);

public sealed record TrustedAdministrativeRecoveryResult(
  string OriginalActionId,
  string Operation,
  string RestoredStateSha256,
  bool IdempotentReplay);

/// <summary>
/// Supervisor-only compensator for reversible administrative state. It is not
/// a model capability and requires both the protected recovery-record digest
/// and the exact centrally observed current-state digest.
/// </summary>
public interface ITrustedAdministrativeRecoveryExecutor
{
  ValueTask<TrustedAdministrativeRecoveryResult> RestoreAsync(
    TrustedAdministrativeRecoveryRequest request,
    CancellationToken cancellationToken);
}

internal interface IAdministrativeRecoveryOperation
{
  bool Supports(string operation);

  ValueTask<string> ReadStateAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken);

  ValueTask RestoreAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken);
}

internal interface IExpectedCurrentStateAdministrativeRecoveryOperation
{
  ValueTask RestoreExpectedStateAsync(
    TrustedHostRecoveryRecord record,
    string expectedCurrentStateSha256,
    CancellationToken cancellationToken);
}

internal sealed class TrustedAdministrativeRecoveryExecutor(
  ITrustedHostRecoveryRecordReader records,
  IEnumerable<IAdministrativeRecoveryOperation> operations) :
  ITrustedAdministrativeRecoveryExecutor
{
  private readonly IAdministrativeRecoveryOperation[] _operations = operations.ToArray();

  public async ValueTask<TrustedAdministrativeRecoveryResult> RestoreAsync(
    TrustedAdministrativeRecoveryRequest request,
    CancellationToken cancellationToken)
  {
    if (string.IsNullOrWhiteSpace(request.OriginalActionId)
      || !PayloadDigest.IsSha256Hex(request.RecoveryRecordSha256)
      || !PayloadDigest.IsSha256Hex(request.ExpectedCurrentStateSha256))
    {
      throw new HostRecoveryException("recovery_request_invalid");
    }

    var record = await records.ReadAsync(
      request.OriginalActionId,
      request.RecoveryRecordSha256,
      cancellationToken).ConfigureAwait(false);
    if (record.Irreversible)
    {
      throw new HostRecoveryException("recovery_operation_not_supported");
    }

    var matches = _operations.Where(operation => operation.Supports(record.Operation)).ToArray();
    if (matches.Length != 1)
    {
      throw new HostRecoveryException("recovery_operation_not_supported");
    }

    try
    {
      var operation = matches[0];
      var current = await operation.ReadStateAsync(record, cancellationToken)
        .ConfigureAwait(false);
      if (PayloadDigest.FixedTimeEqualsHex(current, record.PreStateSha256))
      {
        return new TrustedAdministrativeRecoveryResult(
          record.ActionId,
          record.Operation,
          current,
          IdempotentReplay: true);
      }
      if (!PayloadDigest.FixedTimeEqualsHex(
        current,
        request.ExpectedCurrentStateSha256))
      {
        throw new HostRecoveryException("recovery_precondition_mismatch");
      }

      if (operation is IExpectedCurrentStateAdministrativeRecoveryOperation guarded)
      {
        await guarded.RestoreExpectedStateAsync(
          record,
          request.ExpectedCurrentStateSha256,
          cancellationToken).ConfigureAwait(false);
      }
      else
      {
        await operation.RestoreAsync(record, cancellationToken).ConfigureAwait(false);
      }
      var restored = await operation.ReadStateAsync(record, cancellationToken)
        .ConfigureAwait(false);
      if (!PayloadDigest.FixedTimeEqualsHex(restored, record.PreStateSha256))
      {
        throw new HostRecoveryException("recovery_postcondition_mismatch");
      }

      return new TrustedAdministrativeRecoveryResult(
        record.ActionId,
        record.Operation,
        restored,
        IdempotentReplay: false);
    }
    catch (HostRecoveryException)
    {
      throw;
    }
    catch (Exception exception) when (exception is JsonException
      or KeyNotFoundException
      or FormatException)
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }
  }
}

internal sealed class RegistryAdministrativeRecoveryOperation(
  RegistryTargetPolicy policy) :
  IAdministrativeRecoveryOperation,
  IExpectedCurrentStateAdministrativeRecoveryOperation
{
  public bool Supports(string operation) => operation is
    "registry.value.set" or "registry.value.delete";

  public ValueTask<string> ReadStateAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var target = policy.ResolveRecovery(record.RecoveryRecord);
    using var baseKey = RegistryKey.OpenBaseKey(target.Hive, RegistryView.Registry64);
    using var key = baseKey.OpenSubKey(target.SubKey, writable: false);
    var state = RegistryStateSupport.Read(key, target.ValueName);
    return ValueTask.FromResult(RegistryRecoverySupport.StateSha256(
      record.RecoveryRecord,
      state));
  }

  public ValueTask RestoreAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken) =>
    ValueTask.FromException(new HostRecoveryException(
      "recovery_expected_current_state_required"));

  public ValueTask RestoreExpectedStateAsync(
    TrustedHostRecoveryRecord record,
    string expectedCurrentStateSha256,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var target = policy.ResolveRecovery(record.RecoveryRecord);
    var existed = record.RecoveryRecord.TryGetProperty("exists", out var exists)
      ? exists.GetBoolean()
      : true;
    var hasKeyExistenceSnapshot = RegistryRecoverySupport.HasKeyExistenceSnapshot(
      record.RecoveryRecord);
    var keyExisted = hasKeyExistenceSnapshot
      ? record.RecoveryRecord.GetProperty("keyExisted").GetBoolean()
      : true;
    if (existed && !keyExisted)
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }

    using var baseKey = RegistryKey.OpenBaseKey(target.Hive, RegistryView.Registry64);
    using (var observedKey = baseKey.OpenSubKey(target.SubKey, writable: false))
    {
      var current = RegistryStateSupport.Read(observedKey, target.ValueName);
      if (!PayloadDigest.FixedTimeEqualsHex(
          RegistryRecoverySupport.StateSha256(record.RecoveryRecord, current),
          expectedCurrentStateSha256))
      {
        throw new HostRecoveryException("recovery_precondition_mismatch");
      }
    }
    if (!existed)
    {
      if (!keyExisted)
      {
        RegistryRecoverySupport.RemoveActionCreatedKey(
          baseKey,
          target,
          cancellationToken);
        return ValueTask.CompletedTask;
      }

      using var key = baseKey.OpenSubKey(target.SubKey, writable: true);
      if (key is null && hasKeyExistenceSnapshot)
      {
        throw new HostRecoveryException("recovery_precondition_mismatch");
      }
      key?.DeleteValue(target.ValueName, throwOnMissingValue: false);
      key?.Flush();
      return ValueTask.CompletedTask;
    }

    var valueType = RecoveryJson.RequiredString(record.RecoveryRecord, "valueType", 32);
    var value = record.RecoveryRecord.GetProperty("value");
    var decoded = RegistryStateSupport.Decode(valueType, value);
    using var writable = baseKey.OpenSubKey(target.SubKey, writable: true)
      ?? throw new HostRecoveryException("recovery_precondition_mismatch");
    writable.SetValue(target.ValueName, decoded.Value, decoded.Kind);
    writable.Flush();
    return ValueTask.CompletedTask;
  }
}

internal static class RegistryRecoverySupport
{
  public static string StateSha256(
    JsonElement recoveryRecord,
    RegistryState state) => HasKeyExistenceSnapshot(recoveryRecord)
      ? state.StateSha256
      : state.LegacyStateSha256;

  public static bool HasKeyExistenceSnapshot(JsonElement recoveryRecord)
  {
    var hasRecordContract = recoveryRecord.TryGetProperty(
      "recordContract",
      out var recordContract);
    var hasKeyExisted = recoveryRecord.TryGetProperty("keyExisted", out var value);
    if (!hasRecordContract && !hasKeyExisted)
    {
      // Explicit legacy parser: v1 records were value-only and cannot authorize
      // deletion of the containing key.
      return false;
    }
    if (!hasRecordContract
      || recordContract.ValueKind != JsonValueKind.String
      || !string.Equals(
        recordContract.GetString(),
        RegistryCapabilitySchemas.RecoveryRecordContract,
        StringComparison.Ordinal)
      || !hasKeyExisted
      || value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
    {
      throw new HostRecoveryException("recovery_record_version_unsupported");
    }
    return true;
  }

  public static void RemoveActionCreatedKey(
    RegistryKey baseKey,
    ResolvedRegistryTarget target,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    using (var key = baseKey.OpenSubKey(target.SubKey, writable: true))
    {
      if (key is null)
      {
        return;
      }

      var valueNames = key.GetValueNames();
      var subKeyNames = key.GetSubKeyNames();
      if (subKeyNames.Length != 0
        || valueNames.Any(name => !string.Equals(
          name,
          target.ValueName,
          StringComparison.OrdinalIgnoreCase)))
      {
        throw new HostRecoveryException("recovery_precondition_mismatch");
      }

      cancellationToken.ThrowIfCancellationRequested();
      try
      {
        key.DeleteValue(target.ValueName, throwOnMissingValue: false);
        key.Flush();
        if (key.GetValueNames().Length != 0 || key.GetSubKeyNames().Length != 0)
        {
          throw new InvalidOperationException(
            "registry_created_key_not_empty_after_value_restore");
        }
      }
      catch (Exception exception) when (exception is IOException
        or InvalidOperationException
        or UnauthorizedAccessException
        or System.Security.SecurityException)
      {
        throw new HostRecoveryException("recovery_outcome_unknown");
      }
    }

    try
    {
      // Non-recursive deletion is deliberate. A concurrently added subkey
      // makes this fail rather than recursively deleting unrelated state.
      baseKey.DeleteSubKey(target.SubKey, throwOnMissingSubKey: true);
      baseKey.Flush();
    }
    catch (Exception exception) when (exception is ArgumentException
      or InvalidOperationException
      or IOException
      or UnauthorizedAccessException
      or System.Security.SecurityException)
    {
      throw new HostRecoveryException("recovery_outcome_unknown");
    }
  }
}

internal sealed class MachineEnvironmentAdministrativeRecoveryOperation(
  MachineEnvironmentPolicy policy) : IAdministrativeRecoveryOperation
{
  public bool Supports(string operation) => operation is
    "environment.machine.set" or "environment.machine.delete";

  public ValueTask<string> ReadStateAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var target = policy.ResolveRecovery(record.RecoveryRecord);
    return ValueTask.FromResult(MachineEnvironmentSupport.Read(target).StateSha256);
  }

  public ValueTask RestoreAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var target = policy.ResolveRecovery(record.RecoveryRecord);
    var existed = record.RecoveryRecord.TryGetProperty("exists", out var exists)
      ? exists.GetBoolean()
      : true;
    var value = existed
      ? RecoveryJson.RequiredString(record.RecoveryRecord, "value", 32_767)
      : null;
    Environment.SetEnvironmentVariable(
      target.Name,
      value,
      EnvironmentVariableTarget.Machine);
    MachineEnvironmentSupport.BroadcastChange();
    return ValueTask.CompletedTask;
  }
}

internal sealed class WindowsServiceAdministrativeRecoveryOperation(
  WindowsServicePolicy policy) : IAdministrativeRecoveryOperation
{
  public bool Supports(string operation) => operation is
    "windows.service.start" or "windows.service.stop";

  public ValueTask<string> ReadStateAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var target = policy.ResolveRecovery(record.RecoveryRecord);
    return ValueTask.FromResult(WindowsServiceControl.Query(target).StateSha256);
  }

  public async ValueTask RestoreAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    var target = policy.ResolveRecovery(record.RecoveryRecord);
    var desired = RecoveryJson.RequiredString(record.RecoveryRecord, "status", 64);
    var current = WindowsServiceControl.Query(target);
    if (desired == "Running" && current.Status == "Stopped")
    {
      _ = await WindowsServiceControl.StartAsync(target, cancellationToken)
        .ConfigureAwait(false);
    }
    else if (desired == "Stopped" && current.Status == "Running")
    {
      _ = await WindowsServiceControl.StopAsync(target, cancellationToken)
        .ConfigureAwait(false);
    }
    else if (!string.Equals(desired, current.Status, StringComparison.Ordinal))
    {
      throw new HostRecoveryException("recovery_operation_not_supported");
    }
  }
}

internal sealed class ScheduledTaskAdministrativeRecoveryOperation(
  ScheduledTaskPolicy policy,
  GovernedSystemToolRunner runner) : IAdministrativeRecoveryOperation
{
  public bool Supports(string operation) => operation == "scheduled-task.enabled.set";

  public async ValueTask<string> ReadStateAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    var recovery = policy.ResolveRecovery(
      record.RecoveryRecord,
      record.PreStateSha256);
    var state = await ScheduledTaskSupport.ReadAsync(
      runner,
      recovery.Target,
      cancellationToken)
      .ConfigureAwait(false);
    return state.StateSha256;
  }

  public async ValueTask RestoreAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    var recovery = policy.ResolveRecovery(
      record.RecoveryRecord,
      record.PreStateSha256);
    await ScheduledTaskSupport.SetEnabledAsync(
      runner,
      recovery.Target,
      recovery.Enabled,
      cancellationToken)
      .ConfigureAwait(false);
  }
}

internal static class RecoveryJson
{
  public static string RequiredString(
    JsonElement value,
    string property,
    int maximumLength)
  {
    if (!value.TryGetProperty(property, out var candidate)
      || candidate.ValueKind != JsonValueKind.String
      || candidate.GetString() is not { } parsed
      || parsed.Length > maximumLength)
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }
    return parsed;
  }
}
