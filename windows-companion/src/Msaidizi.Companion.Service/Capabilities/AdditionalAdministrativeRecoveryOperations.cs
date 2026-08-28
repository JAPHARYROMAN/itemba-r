using System.Text.Json;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal sealed class LocalAccountAdministrativeRecoveryOperation(
  LocalIdentityPolicy policy,
  IWindowsLocalIdentityManager identities) : IAdministrativeRecoveryOperation
{
  public bool Supports(string operation) => operation == "local-account.enabled.set";

  public ValueTask<string> ReadStateAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var account = policy.ResolveAccountRecovery(record.RecoveryRecord);
    return ValueTask.FromResult(identities.ReadAccount(account.AccountName).StateSha256);
  }

  public ValueTask RestoreAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var account = policy.ResolveAccountRecovery(record.RecoveryRecord);
    identities.SetAccountEnabled(
      account.AccountName,
      RequiredBoolean(record.RecoveryRecord, "enabled"));
    return ValueTask.CompletedTask;
  }

  internal static bool RequiredBoolean(JsonElement value, string property) =>
    value.TryGetProperty(property, out var candidate)
    && candidate.ValueKind is JsonValueKind.True or JsonValueKind.False
      ? candidate.GetBoolean()
      : throw new HostRecoveryException("recovery_record_format_invalid");

  internal static uint RequiredUInt32(
    JsonElement value,
    string property,
    uint maximum) => value.TryGetProperty(property, out var candidate)
    && candidate.TryGetUInt32(out var parsed)
    && parsed <= maximum
      ? parsed
      : throw new HostRecoveryException("recovery_record_format_invalid");
}

internal sealed class LocalGroupAdministrativeRecoveryOperation(
  LocalIdentityPolicy policy,
  IWindowsLocalIdentityManager identities) : IAdministrativeRecoveryOperation
{
  public bool Supports(string operation) => operation == "local-group.membership.set";

  public ValueTask<string> ReadStateAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var (group, account) = Resolve(record.RecoveryRecord);
    var member = identities.IsGroupMember(group.GroupName, account.AccountName);
    return ValueTask.FromResult(LocalGroupMembershipReadCapabilityAdapter.MembershipState(
      group,
      account,
      member));
  }

  public ValueTask RestoreAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var (group, account) = Resolve(record.RecoveryRecord);
    identities.SetGroupMember(
      group.GroupName,
      account.AccountName,
      LocalAccountAdministrativeRecoveryOperation.RequiredBoolean(
        record.RecoveryRecord,
        "member"));
    return ValueTask.CompletedTask;
  }

  private (ResolvedLocalGroup Group, ResolvedLocalAccount Account) Resolve(
    JsonElement recoveryRecord) => (
      policy.ResolveGroupRecovery(recoveryRecord),
      policy.ResolveAccountRecovery(recoveryRecord));
}

internal sealed class NetworkAdapterAdministrativeRecoveryOperation(
  NetworkAdapterPolicy policy,
  IWindowsNetworkAdapterManager network) : IAdministrativeRecoveryOperation
{
  public bool Supports(string operation) => operation == "network.adapter.enabled.set";

  public ValueTask<string> ReadStateAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var adapter = policy.ResolveRecovery(record.RecoveryRecord);
    var state = network.Inspect(adapter.InterfaceGuid, policy.MaximumAddresses);
    return ValueTask.FromResult(state.EnabledStateSha256(adapter.Id));
  }

  public ValueTask RestoreAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var adapter = policy.ResolveRecovery(record.RecoveryRecord);
    network.SetEnabled(
      adapter.InterfaceGuid,
      LocalAccountAdministrativeRecoveryOperation.RequiredBoolean(
        record.RecoveryRecord,
        "enabled"));
    return ValueTask.CompletedTask;
  }
}

internal sealed class PrinterAdministrativeRecoveryOperation(
  PrinterPolicy policy,
  IWindowsPrinterManager printers) : IAdministrativeRecoveryOperation
{
  public bool Supports(string operation) => operation == "printer.queue.paused.set";

  public ValueTask<string> ReadStateAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var printer = policy.ResolveRecovery(record.RecoveryRecord);
    var state = printers.TryInspect(printer.PrinterName)
      ?? throw new HostRecoveryException("recovery_target_unavailable");
    return ValueTask.FromResult(state.PauseStateSha256(printer.Id));
  }

  public ValueTask RestoreAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var printer = policy.ResolveRecovery(record.RecoveryRecord);
    printers.SetPaused(
      printer.PrinterName,
      LocalAccountAdministrativeRecoveryOperation.RequiredBoolean(
        record.RecoveryRecord,
        "paused"));
    return ValueTask.CompletedTask;
  }
}

internal sealed class PowerSettingsAdministrativeRecoveryOperation(
  PowerSchemePolicy policy,
  IWindowsPowerSettingsManager power) : IAdministrativeRecoveryOperation
{
  public bool Supports(string operation) => operation is
    "power.active-scheme.set" or "display.monitor-timeout.set";

  public ValueTask<string> ReadStateAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var scheme = policy.ResolveRecovery(record.RecoveryRecord);
    if (record.Operation == "power.active-scheme.set")
    {
      var activeGuid = power.ReadActiveScheme();
      var active = policy.Find(activeGuid);
      return ValueTask.FromResult(ActivePowerSchemeReadCapabilityAdapter.ActiveState(
        active?.Id,
        activeGuid));
    }

    var powerSource = ReadPowerSource(record.RecoveryRecord);
    var seconds = power.ReadMonitorTimeout(scheme.SchemeGuid, powerSource == "ac");
    return ValueTask.FromResult(MonitorTimeoutReadCapabilityAdapter.TimeoutState(
      scheme.Id,
      powerSource,
      seconds));
  }

  public ValueTask RestoreAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var scheme = policy.ResolveRecovery(record.RecoveryRecord);
    if (record.Operation == "power.active-scheme.set")
    {
      power.SetActiveScheme(scheme.SchemeGuid);
      return ValueTask.CompletedTask;
    }

    var powerSource = ReadPowerSource(record.RecoveryRecord);
    var seconds = LocalAccountAdministrativeRecoveryOperation.RequiredUInt32(
      record.RecoveryRecord,
      "seconds",
      86_400);
    power.SetMonitorTimeout(scheme.SchemeGuid, powerSource == "ac", seconds);
    return ValueTask.CompletedTask;
  }

  private static string ReadPowerSource(JsonElement recoveryRecord)
  {
    var source = RecoveryJson.RequiredString(recoveryRecord, "powerSource", 2);
    return source is "ac" or "dc"
      ? source
      : throw new HostRecoveryException("recovery_record_format_invalid");
  }
}

internal sealed class TimeZoneAdministrativeRecoveryOperation(
  TimeZonePolicy policy,
  IWindowsTimeZoneManager timeZones) : IAdministrativeRecoveryOperation
{
  public bool Supports(string operation) => operation == "settings.time-zone.set";

  public ValueTask<string> ReadStateAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    _ = policy.ResolveRecovery(record.RecoveryRecord);
    var currentWindowsId = timeZones.ReadWindowsTimeZoneId();
    var current = policy.Find(currentWindowsId);
    return ValueTask.FromResult(TimeZoneReadCapabilityAdapter.State(
      current?.Id,
      currentWindowsId));
  }

  public ValueTask RestoreAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var timeZone = policy.ResolveRecovery(record.RecoveryRecord);
    timeZones.SetWindowsTimeZoneId(timeZone.WindowsTimeZoneId);
    return ValueTask.CompletedTask;
  }
}
