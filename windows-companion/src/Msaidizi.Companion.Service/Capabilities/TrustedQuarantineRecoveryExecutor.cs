using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

public sealed record TrustedQuarantineRecoveryRequest(
  string OriginalActionId,
  string RecoveryRecordSha256,
  string ExpectedCurrentStateSha256);

public sealed record TrustedQuarantineRecoveryResult(
  string OriginalActionId,
  string Operation,
  string RestoredStateSha256,
  bool IdempotentReplay);

/// <summary>
/// Recovery-vault operation available only to the trusted supervisor control
/// plane. It is not present in the capability manifest and therefore cannot be
/// selected or parameterized by the planner/model.
/// </summary>
public interface ITrustedQuarantineRecoveryExecutor
{
  ValueTask<TrustedQuarantineRecoveryResult> RestoreAsync(
    TrustedQuarantineRecoveryRequest request,
    CancellationToken cancellationToken);
}

public sealed class TrustedQuarantineRecoveryExecutor : ITrustedQuarantineRecoveryExecutor
{
  private readonly ITrustedHostRecoveryRecordReader _records;
  private readonly SupervisorPathPolicy _paths;
  private readonly long _maximumBytes;

  public TrustedQuarantineRecoveryExecutor(
    ITrustedHostRecoveryRecordReader records,
    SupervisorPathPolicy paths,
    IOptions<HostCapabilityOptions> options)
  {
    _records = records;
    _paths = paths;
    _maximumBytes = options.Value.MaximumRecoveryBytes;
  }

  public async ValueTask<TrustedQuarantineRecoveryResult> RestoreAsync(
    TrustedQuarantineRecoveryRequest request,
    CancellationToken cancellationToken)
  {
    if (!PayloadDigest.IsSha256Hex(request.RecoveryRecordSha256)
      || !PayloadDigest.IsSha256Hex(request.ExpectedCurrentStateSha256)
      || _maximumBytes <= 0)
    {
      throw new HostRecoveryException("recovery_request_invalid");
    }

    var record = await _records.ReadAsync(
      request.OriginalActionId,
      request.RecoveryRecordSha256,
      cancellationToken).ConfigureAwait(false);
    if (record.Irreversible || record.Operation != "filesystem.entry.quarantine")
    {
      throw new HostRecoveryException("recovery_operation_not_supported");
    }

    var target = _paths.Resolve(
      RequiredString(record.RecoveryRecord, "rootId", 64),
      RequiredString(record.RecoveryRecord, "relativePath", 32_767),
      HostPathAccess.Delete);
    var quarantinedPath = RequiredString(
      record.RecoveryRecord,
      "quarantinedPath",
      32_767);
    var entryType = RequiredString(record.RecoveryRecord, "entryType", 16);
    if (entryType is not ("file" or "directory"))
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }

    var current = await HostFileSystemSupport.ComputeStateAsync(
      _paths,
      target,
      _maximumBytes,
      cancellationToken).ConfigureAwait(false);
    var quarantinedExists = File.Exists(quarantinedPath) || Directory.Exists(quarantinedPath);

    // A lost acknowledgement after the exact rename is a successful replay,
    // but only when the original path contains the recorded pre-state and the
    // protected payload no longer exists.
    if (!quarantinedExists
      && PayloadDigest.FixedTimeEqualsHex(current.Sha256, record.PreStateSha256))
    {
      return new TrustedQuarantineRecoveryResult(
        record.ActionId,
        record.Operation,
        current.Sha256,
        IdempotentReplay: true);
    }

    if (!PayloadDigest.FixedTimeEqualsHex(current.Sha256, request.ExpectedCurrentStateSha256)
      || current.EntryType != "absent"
      || !PayloadDigest.FixedTimeEqualsHex(
        request.ExpectedCurrentStateSha256,
        HostFileSystemSupport.AbsentStateSha256)
      || !quarantinedExists)
    {
      throw new HostRecoveryException("recovery_precondition_mismatch");
    }

    using var targetParent = _paths.OpenParentForCreate(target);
    var recoveryDirectory = Path.GetDirectoryName(quarantinedPath)
      ?? throw new HostRecoveryException("recovery_record_format_invalid");
    using var recoveryParent = _paths.OpenRecoveryEntry(
      target,
      recoveryDirectory,
      requireDirectory: true);
    using var payload = _paths.OpenRecoveryEntry(
      target,
      quarantinedPath,
      requireDirectory: entryType == "directory",
      deleteAccess: true);
    SupervisorPathPolicy.EnsureHandleStillNames(
      targetParent,
      Path.GetDirectoryName(target.FullPath)!);
    SupervisorPathPolicy.EnsureHandleStillNames(recoveryParent, recoveryDirectory);
    SupervisorPathPolicy.EnsureHandleStillNames(payload, quarantinedPath);
    SupervisorPathPolicy.RenameExact(payload, targetParent, Path.GetFileName(target.FullPath));
    // The source handle intentionally excludes mutation sharing. Release it
    // before opening the renamed entry for the exact post-state check.
    payload.Dispose();

    var restored = await HostFileSystemSupport.ComputeStateAsync(
      _paths,
      target,
      _maximumBytes,
      cancellationToken).ConfigureAwait(false);
    if (restored.EntryType != entryType
      || !PayloadDigest.FixedTimeEqualsHex(restored.Sha256, record.PreStateSha256))
    {
      // Preserve the recovery payload on a failed postcondition. The target
      // handle proves that the exact just-restored NTFS entry is moved back.
      using var unexpected = _paths.OpenExisting(
        target,
        requireDirectory: entryType == "directory",
        lockAgainstMutation: true,
        deleteAccess: true);
      SupervisorPathPolicy.RenameExact(unexpected, recoveryParent, "payload");
      throw new HostRecoveryException("recovery_postcondition_mismatch");
    }

    return new TrustedQuarantineRecoveryResult(
      record.ActionId,
      record.Operation,
      restored.Sha256,
      IdempotentReplay: false);
  }

  private static string RequiredString(JsonElement value, string property, int maximumLength)
  {
    if (!value.TryGetProperty(property, out var candidate)
      || candidate.ValueKind != JsonValueKind.String
      || string.IsNullOrWhiteSpace(candidate.GetString())
      || candidate.GetString()!.Length > maximumLength)
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }
    return candidate.GetString()!;
  }
}
