using System.Runtime.InteropServices;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal static class SystemPowerSchemas
{
  public const string EmptyArguments =
    """
    {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
    """;

  public const string BootSessionResult =
    """
    {
      "type": "object",
      "properties": {
        "bootSessionSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["bootSessionSha256", "stateSha256"],
      "additionalProperties": false
    }
    """;

  public const string RestartScheduledResult =
    """
    {
      "type": "object",
      "properties": {
        "scheduled": { "const": true },
        "delaySeconds": { "type": "integer", "minimum": 120, "maximum": 600 },
        "bootSessionSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["scheduled", "delaySeconds", "bootSessionSha256", "stateSha256"],
      "additionalProperties": false
    }
    """;

  public static CapabilityArgumentValidation ValidateEmpty(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(value)
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidArguments(
        "This capability accepts no arguments.");

  public static CapabilityArgumentValidation ValidateBootSessionResult(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(
      value,
      "bootSessionSha256",
      "stateSha256")
    && GovernedWindowsCapabilitySupport.Sha256(value, "bootSessionSha256")
    && GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidResult(
        "Boot-session result is invalid.");

  public static CapabilityArgumentValidation ValidateRestartResult(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(
      value,
      "scheduled",
      "delaySeconds",
      "bootSessionSha256",
      "stateSha256")
    && value.GetProperty("scheduled").ValueKind == JsonValueKind.True
    && GovernedWindowsCapabilitySupport.Integer(value, "delaySeconds", 120, 600)
    && GovernedWindowsCapabilitySupport.Sha256(value, "bootSessionSha256")
    && GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidResult(
        "Scheduled-restart result is invalid.");
}

internal sealed class SystemPowerPolicy
{
  public const int MinimumRestartDelaySeconds = 120;
  public const int MaximumRestartDelaySeconds = 600;

  public SystemPowerPolicy(IOptions<SystemPowerOptions> options)
  {
    var configured = options.Value;
    if (!configured.Enabled)
    {
      throw new InvalidOperationException("System-power capabilities are disabled.");
    }
    if (configured.RestartDelaySeconds is < MinimumRestartDelaySeconds
      or > MaximumRestartDelaySeconds)
    {
      throw new InvalidOperationException(
        "The system restart delay must be between 120 and 600 seconds.");
    }

    RestartDelaySeconds = configured.RestartDelaySeconds;
  }

  public int RestartDelaySeconds { get; }
}

internal interface IWindowsSystemPowerManager
{
  Guid ReadBootIdentifier();

  void ScheduleRestart(int delaySeconds);
}

/// <summary>
/// Direct Win32/NT system-power boundary. The action surface never supplies a
/// message, timeout, force flag, shutdown reason, or target machine.
/// </summary>
internal sealed class WindowsSystemPowerManager : IWindowsSystemPowerManager
{
  private const int SystemBootEnvironmentInformationClass = 90;
  private const int ErrorNotAllAssigned = 1300;
  private const uint TokenQuery = 0x0008;
  private const uint TokenAdjustPrivileges = 0x0020;
  private const uint PrivilegeEnabled = 0x00000002;
  private const uint ShutdownReasonMajorOperatingSystem = 0x00020000;
  private const uint ShutdownReasonMinorReconfig = 0x00000004;
  private const uint ShutdownReasonFlagPlanned = 0x80000000;
  private const string RestartMessage =
    "Itemba Msaidizi scheduled a governed Windows restart.";

  public Guid ReadBootIdentifier()
  {
    var status = NtQuerySystemInformation(
      SystemBootEnvironmentInformationClass,
      out var information,
      Marshal.SizeOf<SystemBootEnvironmentInformation>(),
      out var returnedLength);
    if (status != 0
      || returnedLength < Marshal.SizeOf<SystemBootEnvironmentInformation>()
      || information.BootIdentifier == Guid.Empty)
    {
      throw NtFailure("boot_session_read_failed", status);
    }

    return information.BootIdentifier;
  }

  public void ScheduleRestart(int delaySeconds)
  {
    if (delaySeconds is < SystemPowerPolicy.MinimumRestartDelaySeconds
      or > SystemPowerPolicy.MaximumRestartDelaySeconds)
    {
      throw new HostPreconditionException("system_restart_delay_outside_policy");
    }

    using var privilege = ShutdownPrivilegeScope.Enable();
    if (!InitiateSystemShutdownExW(
      machineName: null,
      message: RestartMessage,
      timeoutSeconds: checked((uint)delaySeconds),
      forceAppsClosed: false,
      rebootAfterShutdown: true,
      reason: ShutdownReasonMajorOperatingSystem
        | ShutdownReasonMinorReconfig
        | ShutdownReasonFlagPlanned))
    {
      throw Win32Failure(
        "system_restart_schedule_failed",
        Marshal.GetLastWin32Error());
    }
  }

  private static HostPreconditionException NtFailure(string errorCode, int status) =>
    new($"{errorCode}_0x{unchecked((uint)status):x8}");

  private static HostPreconditionException Win32Failure(string errorCode, int nativeCode) =>
    new($"{errorCode}_{Math.Max(nativeCode, 0)}");

  [DllImport("ntdll.dll")]
  private static extern int NtQuerySystemInformation(
    int systemInformationClass,
    out SystemBootEnvironmentInformation systemInformation,
    int systemInformationLength,
    out int returnLength);

  [DllImport(
    "advapi32.dll",
    EntryPoint = "InitiateSystemShutdownExW",
    CharSet = CharSet.Unicode,
    ExactSpelling = true,
    SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool InitiateSystemShutdownExW(
    string? machineName,
    string message,
    uint timeoutSeconds,
    [MarshalAs(UnmanagedType.Bool)] bool forceAppsClosed,
    [MarshalAs(UnmanagedType.Bool)] bool rebootAfterShutdown,
    uint reason);

  [DllImport("advapi32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool OpenProcessToken(
    IntPtr processHandle,
    uint desiredAccess,
    out IntPtr tokenHandle);

  [DllImport(
    "advapi32.dll",
    EntryPoint = "LookupPrivilegeValueW",
    CharSet = CharSet.Unicode,
    ExactSpelling = true,
    SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool LookupPrivilegeValueW(
    string? systemName,
    string name,
    out Luid luid);

  [DllImport("advapi32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool AdjustTokenPrivileges(
    IntPtr tokenHandle,
    [MarshalAs(UnmanagedType.Bool)] bool disableAllPrivileges,
    ref TokenPrivileges newState,
    int bufferLength,
    out TokenPrivileges previousState,
    out int returnLength);

  [DllImport("kernel32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool CloseHandle(IntPtr handle);

  [StructLayout(LayoutKind.Sequential)]
  private struct SystemBootEnvironmentInformation
  {
    public Guid BootIdentifier;
    public int FirmwareType;
    public ulong BootFlags;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct Luid
  {
    public uint LowPart;
    public int HighPart;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct LuidAndAttributes
  {
    public Luid Luid;
    public uint Attributes;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct TokenPrivileges
  {
    public uint PrivilegeCount;
    public LuidAndAttributes Privileges;
  }

  private sealed class ShutdownPrivilegeScope : IDisposable
  {
    private readonly IntPtr _token;
    private readonly TokenPrivileges _previous;

    private ShutdownPrivilegeScope(IntPtr token, TokenPrivileges previous)
    {
      _token = token;
      _previous = previous;
    }

    public static ShutdownPrivilegeScope Enable()
    {
      if (!OpenProcessToken(
          new IntPtr(-1),
          TokenQuery | TokenAdjustPrivileges,
          out var token))
      {
        throw Win32Failure(
          "system_restart_privilege_unavailable",
          Marshal.GetLastWin32Error());
      }

      if (!LookupPrivilegeValueW(null, "SeShutdownPrivilege", out var luid))
      {
        var error = Marshal.GetLastWin32Error();
        _ = CloseHandle(token);
        throw Win32Failure("system_restart_privilege_unavailable", error);
      }

      var requested = new TokenPrivileges
      {
        PrivilegeCount = 1,
        Privileges = new LuidAndAttributes
        {
          Luid = luid,
          Attributes = PrivilegeEnabled,
        },
      };
      Marshal.SetLastPInvokeError(0);
      if (!AdjustTokenPrivileges(
          token,
          disableAllPrivileges: false,
          ref requested,
          Marshal.SizeOf<TokenPrivileges>(),
          out var previous,
          out _)
        || Marshal.GetLastWin32Error() == ErrorNotAllAssigned)
      {
        var error = Marshal.GetLastWin32Error();
        _ = CloseHandle(token);
        throw Win32Failure("system_restart_privilege_unavailable", error);
      }

      return new ShutdownPrivilegeScope(token, previous);
    }

    public void Dispose()
    {
      var previous = _previous;
      _ = AdjustTokenPrivileges(
        _token,
        disableAllPrivileges: false,
        ref previous,
        Marshal.SizeOf<TokenPrivileges>(),
        out _,
        out _);
      _ = CloseHandle(_token);
    }
  }
}

internal sealed class BootSessionReadCapabilityAdapter(
  IWindowsSystemPowerManager systemPower) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } =
    GovernedWindowsCapabilitySupport.Descriptor(
      "system.boot-session.read",
      "Read Windows boot session",
      "Reads a digest-only identifier for the current Windows boot session.",
      CapabilityDataClass.Internal,
      CapabilityEffect.LocalRead,
      RecoveryKind.NotApplicable,
      SystemPowerSchemas.EmptyArguments,
      SystemPowerSchemas.BootSessionResult,
      ["windows-boot-session"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    SystemPowerSchemas.ValidateEmpty(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    SystemPowerSchemas.ValidateBootSessionResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var bootIdentifier = systemPower.ReadBootIdentifier();
    var bootSessionSha256 = BootSessionSha256(bootIdentifier);
    var stateSha256 = State(context.DeviceId, bootIdentifier);
    var output = JsonSerializer.Serialize(new
    {
      bootSessionSha256,
      stateSha256,
    });
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance: [Provenance(context.DeviceId, bootIdentifier, stateSha256)],
      PreStateSha256: stateSha256,
      LocalBytesRead: GovernedWindowsCapabilitySupport.JsonByteCount(output)));
  }

  internal static string BootSessionSha256(Guid bootIdentifier) =>
    PayloadDigest.Sha256Hex(bootIdentifier.ToString("D"));

  internal static string State(string deviceId, Guid bootIdentifier) =>
    GovernedWindowsCapabilitySupport.StateSha256(new
    {
      deviceId,
      bootIdentifier = bootIdentifier.ToString("D"),
    });

  internal static DataProvenance Provenance(
    string deviceId,
    Guid bootIdentifier,
    string stateSha256) => GovernedWindowsCapabilitySupport.Provenance(
      "windows-boot-session",
      $"{deviceId}\n{bootIdentifier:D}",
      stateSha256);
}

internal sealed class SystemRestartScheduleCapabilityAdapter(
  SystemPowerPolicy policy,
  IWindowsSystemPowerManager systemPower) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } =
    GovernedWindowsCapabilitySupport.Descriptor(
      "system.power.restart.schedule",
      "Schedule governed Windows restart",
      "Schedules one non-forcing Windows restart after the fixed supervisor delay.",
      CapabilityDataClass.Internal,
      CapabilityEffect.Irreversible,
      RecoveryKind.Irreversible,
      SystemPowerSchemas.EmptyArguments,
      SystemPowerSchemas.RestartScheduledResult,
      ["windows-boot-session", "windows-system-power"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    SystemPowerSchemas.ValidateEmpty(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    SystemPowerSchemas.ValidateRestartResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    cancellationToken.ThrowIfCancellationRequested();
    var bootIdentifier = systemPower.ReadBootIdentifier();
    var stateSha256 = BootSessionReadCapabilityAdapter.State(
      context.DeviceId,
      bootIdentifier);
    RegistryValueSetCapabilityAdapter.MatchExpected(context, stateSha256);

    // This is the final cooperative cancellation boundary before the single
    // native commit call. The native manager hardcodes non-forcing semantics.
    cancellationToken.ThrowIfCancellationRequested();
    systemPower.ScheduleRestart(policy.RestartDelaySeconds);

    var bootSessionSha256 = BootSessionReadCapabilityAdapter.BootSessionSha256(
      bootIdentifier);
    var output = JsonSerializer.Serialize(new
    {
      scheduled = true,
      delaySeconds = policy.RestartDelaySeconds,
      bootSessionSha256,
      stateSha256,
    });
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: true,
      OutcomeUncertain: false,
      Provenance:
      [
        BootSessionReadCapabilityAdapter.Provenance(
          context.DeviceId,
          bootIdentifier,
          stateSha256),
        GovernedWindowsCapabilitySupport.Provenance(
          "windows-system-power",
          context.ActionId,
          PayloadDigest.Sha256Hex(output)),
      ],
      PreStateSha256: stateSha256,
      LocalBytesRead: GovernedWindowsCapabilitySupport.JsonByteCount(output),
      LocalBytesWritten: 1));
  }
}
