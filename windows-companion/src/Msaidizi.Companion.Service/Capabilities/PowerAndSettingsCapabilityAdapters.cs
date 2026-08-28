using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Execution;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal static class PowerAndSettingsSchemas
{
  public const string EmptyArguments =
    """
    {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
    """;

  public const string PowerSchemeArguments =
    """
    {
      "type": "object",
      "properties": {
        "schemeId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" }
      },
      "required": ["schemeId"],
      "additionalProperties": false
    }
    """;

  public const string MonitorTimeoutArguments =
    """
    {
      "type": "object",
      "properties": {
        "schemeId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "powerSource": { "enum": ["ac", "dc"] }
      },
      "required": ["schemeId", "powerSource"],
      "additionalProperties": false
    }
    """;

  public const string MonitorTimeoutSetArguments =
    """
    {
      "type": "object",
      "properties": {
        "schemeId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "powerSource": { "enum": ["ac", "dc"] },
        "seconds": { "type": "integer", "minimum": 0, "maximum": 86400 }
      },
      "required": ["schemeId", "powerSource", "seconds"],
      "additionalProperties": false
    }
    """;

  public const string ActiveSchemeResult =
    """
    {
      "type": "object",
      "properties": {
        "schemeId": { "type": ["string", "null"] },
        "schemeGuidSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["schemeId", "schemeGuidSha256", "stateSha256"],
      "additionalProperties": false
    }
    """;

  public const string MonitorTimeoutResult =
    """
    {
      "type": "object",
      "properties": {
        "schemeId": { "type": "string" },
        "powerSource": { "enum": ["ac", "dc"] },
        "seconds": { "type": "integer", "minimum": 0, "maximum": 86400 },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["schemeId", "powerSource", "seconds", "stateSha256"],
      "additionalProperties": false
    }
    """;

  public const string TimeZoneResult =
    """
    {
      "type": "object",
      "properties": {
        "timeZoneId": { "type": ["string", "null"] },
        "windowsIdSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["timeZoneId", "windowsIdSha256", "stateSha256"],
      "additionalProperties": false
    }
    """;

  public const string TimeZoneSetArguments =
    """
    {
      "type": "object",
      "properties": {
        "timeZoneId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" }
      },
      "required": ["timeZoneId"],
      "additionalProperties": false
    }
    """;

  public const string MutationResult =
    """
    {
      "type": "object",
      "properties": {
        "committed": { "const": true },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["committed", "stateSha256"],
      "additionalProperties": false
    }
    """;

  public static CapabilityArgumentValidation ValidateEmpty(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(value)
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidArguments("This capability accepts no arguments.");

  public static CapabilityArgumentValidation ValidateScheme(JsonElement value) =>
    ValidateId(value, "schemeId")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidArguments("Power scheme target is invalid.");

  public static CapabilityArgumentValidation ValidateMonitorTimeout(
    JsonElement value,
    bool mutation)
  {
    var exact = mutation
      ? GovernedWindowsCapabilitySupport.Exact(value, "schemeId", "powerSource", "seconds")
      : GovernedWindowsCapabilitySupport.Exact(value, "schemeId", "powerSource");
    return exact
      && GovernedWindowsCapabilitySupport.String(value, "schemeId", 1, 80)
      && GovernedWindowsCapabilitySupport.IsSafeId(value.GetProperty("schemeId").GetString()!)
      && GovernedWindowsCapabilitySupport.String(value, "powerSource", 2, 2)
      && value.GetProperty("powerSource").GetString() is "ac" or "dc"
      && (!mutation || GovernedWindowsCapabilitySupport.Integer(value, "seconds", 0, 86_400))
        ? CapabilityArgumentValidation.Success
        : GovernedWindowsCapabilitySupport.InvalidArguments("Display timeout target is invalid.");
  }

  public static CapabilityArgumentValidation ValidateTimeZoneSet(JsonElement value) =>
    ValidateId(value, "timeZoneId")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidArguments("Time-zone target is invalid.");

  public static CapabilityArgumentValidation ValidateActiveSchemeResult(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(
      value,
      "schemeId",
      "schemeGuidSha256",
      "stateSha256")
    && IsOptionalSafeId(value.GetProperty("schemeId"))
    && GovernedWindowsCapabilitySupport.Sha256(value, "schemeGuidSha256")
    && GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidResult("Active power scheme result is invalid.");

  public static CapabilityArgumentValidation ValidateMonitorTimeoutResult(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(
      value,
      "schemeId",
      "powerSource",
      "seconds",
      "stateSha256")
    && GovernedWindowsCapabilitySupport.String(value, "schemeId", 1, 80)
    && GovernedWindowsCapabilitySupport.String(value, "powerSource", 2, 2)
    && value.GetProperty("powerSource").GetString() is "ac" or "dc"
    && GovernedWindowsCapabilitySupport.Integer(value, "seconds", 0, 86_400)
    && GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidResult("Display timeout result is invalid.");

  public static CapabilityArgumentValidation ValidateTimeZoneResult(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(
      value,
      "timeZoneId",
      "windowsIdSha256",
      "stateSha256")
    && IsOptionalSafeId(value.GetProperty("timeZoneId"))
    && GovernedWindowsCapabilitySupport.Sha256(value, "windowsIdSha256")
    && GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidResult("Time-zone result is invalid.");

  public static CapabilityArgumentValidation ValidateMutationResult(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(value, "committed", "stateSha256")
    && value.GetProperty("committed").ValueKind == JsonValueKind.True
    && GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidResult("Windows settings mutation result is invalid.");

  private static bool ValidateId(JsonElement value, string property) =>
    GovernedWindowsCapabilitySupport.Exact(value, property)
    && GovernedWindowsCapabilitySupport.String(value, property, 1, 80)
    && GovernedWindowsCapabilitySupport.IsSafeId(value.GetProperty(property).GetString()!);

  private static bool IsOptionalSafeId(JsonElement value) => value.ValueKind == JsonValueKind.Null
    || (value.ValueKind == JsonValueKind.String
      && value.GetString() is { } id
      && GovernedWindowsCapabilitySupport.IsSafeId(id));
}

internal sealed record ResolvedPowerScheme(
  string Id,
  Guid SchemeGuid,
  bool AllowActivate,
  bool AllowDisplayTimeoutChange);

internal sealed class PowerSchemePolicy
{
  private readonly Dictionary<string, ResolvedPowerScheme> _schemes;

  public PowerSchemePolicy(IOptions<HostCapabilityOptions> options)
  {
    _schemes = options.Value.AllowedPowerSchemes
      .Select(Parse)
      .ToDictionary(scheme => scheme.Id, StringComparer.Ordinal);
    if (_schemes.Values.Select(scheme => scheme.SchemeGuid).Distinct().Count()
      != _schemes.Count)
    {
      throw new InvalidOperationException("Power scheme allowlist contains duplicate GUIDs.");
    }
  }

  public ResolvedPowerScheme? Find(Guid schemeGuid) => _schemes.Values
    .SingleOrDefault(scheme => scheme.SchemeGuid == schemeGuid);

  public ResolvedPowerScheme Resolve(
    string id,
    bool requireActivate = false,
    bool requireDisplayTimeoutChange = false)
  {
    if (!_schemes.TryGetValue(id, out var scheme)
      || (requireActivate && !scheme.AllowActivate)
      || (requireDisplayTimeoutChange && !scheme.AllowDisplayTimeoutChange))
    {
      throw new HostPreconditionException("power_scheme_not_allowed");
    }
    return scheme;
  }

  public ResolvedPowerScheme ResolveRecovery(JsonElement recoveryRecord)
  {
    var id = RecoveryJson.RequiredString(recoveryRecord, "schemeId", 80);
    var guid = RecoveryJson.RequiredString(recoveryRecord, "schemeGuid", 38);
    var scheme = Resolve(id);
    return Guid.TryParse(guid, out var parsed) && parsed == scheme.SchemeGuid
      ? scheme
      : throw new HostRecoveryException("recovery_record_format_invalid");
  }

  private static ResolvedPowerScheme Parse(AllowedPowerSchemeOptions scheme)
  {
    if (!GovernedWindowsCapabilitySupport.IsSafeId(scheme.Id)
      || !Guid.TryParse(scheme.SchemeGuid, out var schemeGuid)
      || schemeGuid == Guid.Empty)
    {
      throw new InvalidOperationException("An allowed power scheme is invalid.");
    }
    return new ResolvedPowerScheme(
      scheme.Id,
      schemeGuid,
      scheme.AllowActivate,
      scheme.AllowDisplayTimeoutChange);
  }
}

internal sealed record ResolvedTimeZone(
  string Id,
  string WindowsTimeZoneId,
  bool AllowSet);

internal sealed class TimeZonePolicy
{
  private readonly Dictionary<string, ResolvedTimeZone> _timeZones;

  public TimeZonePolicy(IOptions<HostCapabilityOptions> options)
  {
    _timeZones = options.Value.AllowedTimeZones
      .Select(Parse)
      .ToDictionary(timeZone => timeZone.Id, StringComparer.Ordinal);
    if (_timeZones.Values.Select(timeZone => timeZone.WindowsTimeZoneId)
        .Distinct(StringComparer.OrdinalIgnoreCase).Count() != _timeZones.Count)
    {
      throw new InvalidOperationException("Time-zone allowlist contains duplicate Windows IDs.");
    }
  }

  public ResolvedTimeZone? Find(string windowsTimeZoneId) => _timeZones.Values
    .SingleOrDefault(timeZone => string.Equals(
      timeZone.WindowsTimeZoneId,
      windowsTimeZoneId,
      StringComparison.OrdinalIgnoreCase));

  public ResolvedTimeZone Resolve(string id, bool requireSet = false)
  {
    if (!_timeZones.TryGetValue(id, out var timeZone)
      || (requireSet && !timeZone.AllowSet))
    {
      throw new HostPreconditionException("time_zone_not_allowed");
    }
    return timeZone;
  }

  public ResolvedTimeZone ResolveRecovery(JsonElement recoveryRecord)
  {
    var id = RecoveryJson.RequiredString(recoveryRecord, "timeZoneId", 80);
    var windowsId = RecoveryJson.RequiredString(recoveryRecord, "windowsTimeZoneId", 128);
    var timeZone = Resolve(id);
    return string.Equals(
      timeZone.WindowsTimeZoneId,
      windowsId,
      StringComparison.OrdinalIgnoreCase)
        ? timeZone
        : throw new HostRecoveryException("recovery_record_format_invalid");
  }

  private static ResolvedTimeZone Parse(AllowedTimeZoneOptions timeZone)
  {
    if (!GovernedWindowsCapabilitySupport.IsSafeId(timeZone.Id)
      || string.IsNullOrWhiteSpace(timeZone.WindowsTimeZoneId)
      || timeZone.WindowsTimeZoneId.Length > 128)
    {
      throw new InvalidOperationException("An allowed time zone is invalid.");
    }
    try
    {
      _ = TimeZoneInfo.FindSystemTimeZoneById(timeZone.WindowsTimeZoneId);
    }
    catch (TimeZoneNotFoundException exception)
    {
      throw new InvalidOperationException("An allowed time zone is not installed.", exception);
    }
    catch (InvalidTimeZoneException exception)
    {
      throw new InvalidOperationException("An allowed time zone is invalid.", exception);
    }
    return new ResolvedTimeZone(timeZone.Id, timeZone.WindowsTimeZoneId, timeZone.AllowSet);
  }
}

internal interface IWindowsPowerSettingsManager
{
  Guid ReadActiveScheme();

  void SetActiveScheme(Guid schemeGuid);

  uint ReadMonitorTimeout(Guid schemeGuid, bool acPower);

  void SetMonitorTimeout(Guid schemeGuid, bool acPower, uint seconds);
}

internal sealed class WindowsPowerSettingsManager : IWindowsPowerSettingsManager
{
  private static readonly Guid VideoSubgroup =
    new("7516b95f-f776-4464-8c53-06167f40cc99");
  private static readonly Guid VideoPowerdownTimeout =
    new("3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e");

  public Guid ReadActiveScheme()
  {
    var status = PowerGetActiveScheme(IntPtr.Zero, out var schemePointer);
    if (status != 0 || schemePointer == IntPtr.Zero)
    {
      throw NativeFailure("power_scheme_read_failed", status);
    }
    try
    {
      return Marshal.PtrToStructure<Guid>(schemePointer);
    }
    finally
    {
      _ = LocalFree(schemePointer);
    }
  }

  public void SetActiveScheme(Guid schemeGuid)
  {
    var status = PowerSetActiveScheme(IntPtr.Zero, ref schemeGuid);
    if (status != 0)
    {
      throw NativeFailure("power_scheme_update_failed", status);
    }
  }

  public uint ReadMonitorTimeout(Guid schemeGuid, bool acPower)
  {
    var subgroup = VideoSubgroup;
    var setting = VideoPowerdownTimeout;
    var status = acPower
      ? PowerReadAcValueIndex(
        IntPtr.Zero,
        ref schemeGuid,
        ref subgroup,
        ref setting,
        out var seconds)
      : PowerReadDcValueIndex(
        IntPtr.Zero,
        ref schemeGuid,
        ref subgroup,
        ref setting,
        out seconds);
    if (status != 0 || seconds > 86_400)
    {
      throw NativeFailure("monitor_timeout_read_failed", status);
    }
    return seconds;
  }

  public void SetMonitorTimeout(Guid schemeGuid, bool acPower, uint seconds)
  {
    if (seconds > 86_400)
    {
      throw new HostPreconditionException("monitor_timeout_outside_policy");
    }
    var subgroup = VideoSubgroup;
    var setting = VideoPowerdownTimeout;
    var status = acPower
      ? PowerWriteAcValueIndex(
        IntPtr.Zero,
        ref schemeGuid,
        ref subgroup,
        ref setting,
        seconds)
      : PowerWriteDcValueIndex(
        IntPtr.Zero,
        ref schemeGuid,
        ref subgroup,
        ref setting,
        seconds);
    if (status != 0)
    {
      throw NativeFailure("monitor_timeout_update_failed", status);
    }
    if (ReadActiveScheme() == schemeGuid)
    {
      SetActiveScheme(schemeGuid);
    }
  }

  private static HostPreconditionException NativeFailure(string errorCode, uint nativeCode) =>
    new($"{errorCode}_{new Win32Exception(checked((int)nativeCode)).NativeErrorCode}");

  [DllImport("powrprof.dll")]
  private static extern uint PowerGetActiveScheme(
    IntPtr userRootPowerKey,
    out IntPtr activePolicyGuid);

  [DllImport("powrprof.dll")]
  private static extern uint PowerSetActiveScheme(
    IntPtr userRootPowerKey,
    ref Guid schemeGuid);

  [DllImport("powrprof.dll", EntryPoint = "PowerReadACValueIndex")]
  private static extern uint PowerReadAcValueIndex(
    IntPtr rootPowerKey,
    ref Guid schemeGuid,
    ref Guid subgroupGuid,
    ref Guid powerSettingGuid,
    out uint valueIndex);

  [DllImport("powrprof.dll", EntryPoint = "PowerReadDCValueIndex")]
  private static extern uint PowerReadDcValueIndex(
    IntPtr rootPowerKey,
    ref Guid schemeGuid,
    ref Guid subgroupGuid,
    ref Guid powerSettingGuid,
    out uint valueIndex);

  [DllImport("powrprof.dll", EntryPoint = "PowerWriteACValueIndex")]
  private static extern uint PowerWriteAcValueIndex(
    IntPtr rootPowerKey,
    ref Guid schemeGuid,
    ref Guid subgroupGuid,
    ref Guid powerSettingGuid,
    uint valueIndex);

  [DllImport("powrprof.dll", EntryPoint = "PowerWriteDCValueIndex")]
  private static extern uint PowerWriteDcValueIndex(
    IntPtr rootPowerKey,
    ref Guid schemeGuid,
    ref Guid subgroupGuid,
    ref Guid powerSettingGuid,
    uint valueIndex);

  [DllImport("kernel32.dll")]
  private static extern IntPtr LocalFree(IntPtr memory);
}

internal interface IWindowsTimeZoneManager
{
  string ReadWindowsTimeZoneId();

  void SetWindowsTimeZoneId(string windowsTimeZoneId);
}

internal sealed class WindowsTimeZoneManager : IWindowsTimeZoneManager
{
  private const uint ErrorSuccess = 0;
  private const uint ErrorNoMoreItems = 259;
  private const int ErrorNotAllAssigned = 1300;
  private const uint TokenQuery = 0x0008;
  private const uint TokenAdjustPrivileges = 0x0020;
  private const uint PrivilegeEnabled = 0x00000002;

  public string ReadWindowsTimeZoneId()
  {
    var result = GetDynamicTimeZoneInformation(out var timeZone);
    if (result == uint.MaxValue || string.IsNullOrWhiteSpace(timeZone.TimeZoneKeyName))
    {
      throw NativeFailure("time_zone_read_failed", Marshal.GetLastWin32Error());
    }
    return timeZone.TimeZoneKeyName;
  }

  public void SetWindowsTimeZoneId(string windowsTimeZoneId)
  {
    var timeZone = FindTimeZone(windowsTimeZoneId);
    using var privilege = TimeZonePrivilegeScope.Enable();
    if (!SetDynamicTimeZoneInformation(ref timeZone))
    {
      throw NativeFailure("time_zone_update_failed", Marshal.GetLastWin32Error());
    }
  }

  private static DynamicTimeZoneInformation FindTimeZone(string windowsTimeZoneId)
  {
    for (uint index = 0; index < 1_024; index++)
    {
      var result = EnumDynamicTimeZoneInformation(index, out var candidate);
      if (result == ErrorNoMoreItems)
      {
        break;
      }
      if (result != ErrorSuccess)
      {
        throw NativeFailure("time_zone_inventory_failed", checked((int)result));
      }
      if (string.Equals(
        candidate.TimeZoneKeyName,
        windowsTimeZoneId,
        StringComparison.OrdinalIgnoreCase))
      {
        return candidate;
      }
    }
    throw new HostPreconditionException("time_zone_unavailable");
  }

  private static HostPreconditionException NativeFailure(string errorCode, int nativeCode) =>
    new($"{errorCode}_{new Win32Exception(nativeCode).NativeErrorCode}");

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern uint GetDynamicTimeZoneInformation(
    out DynamicTimeZoneInformation timeZoneInformation);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SetDynamicTimeZoneInformation(
    ref DynamicTimeZoneInformation timeZoneInformation);

  [DllImport("kernel32.dll")]
  private static extern uint EnumDynamicTimeZoneInformation(
    uint index,
    out DynamicTimeZoneInformation timeZoneInformation);

  [DllImport("advapi32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool OpenProcessToken(
    IntPtr processHandle,
    uint desiredAccess,
    out IntPtr tokenHandle);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool LookupPrivilegeValue(
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

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct DynamicTimeZoneInformation
  {
    public int Bias;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
    public string StandardName;
    public SystemTime StandardDate;
    public int StandardBias;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
    public string DaylightName;
    public SystemTime DaylightDate;
    public int DaylightBias;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
    public string TimeZoneKeyName;
    [MarshalAs(UnmanagedType.Bool)]
    public bool DynamicDaylightTimeDisabled;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct SystemTime
  {
    public ushort Year;
    public ushort Month;
    public ushort DayOfWeek;
    public ushort Day;
    public ushort Hour;
    public ushort Minute;
    public ushort Second;
    public ushort Milliseconds;
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

  private sealed class TimeZonePrivilegeScope : IDisposable
  {
    private readonly IntPtr _token;
    private readonly TokenPrivileges _previous;

    private TimeZonePrivilegeScope(IntPtr token, TokenPrivileges previous)
    {
      _token = token;
      _previous = previous;
    }

    public static TimeZonePrivilegeScope Enable()
    {
      if (!OpenProcessToken(
          new IntPtr(-1),
          TokenQuery | TokenAdjustPrivileges,
          out var token)
        || !LookupPrivilegeValue(null, "SeTimeZonePrivilege", out var luid))
      {
        if (token != IntPtr.Zero)
        {
          _ = CloseHandle(token);
        }
        throw NativeFailure("time_zone_privilege_unavailable", Marshal.GetLastWin32Error());
      }
      var requested = new TokenPrivileges
      {
        PrivilegeCount = 1,
        Privileges = new LuidAndAttributes { Luid = luid, Attributes = PrivilegeEnabled },
      };
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
        throw NativeFailure("time_zone_privilege_unavailable", error);
      }
      return new TimeZonePrivilegeScope(token, previous);
    }

    public void Dispose()
    {
      var previous = _previous;
      _ = AdjustTokenPrivileges(
        _token,
        disableAllPrivileges: false,
        ref previous,
        0,
        out _,
        out _);
      _ = CloseHandle(_token);
    }
  }
}

internal sealed class ActivePowerSchemeReadCapabilityAdapter(
  PowerSchemePolicy policy,
  IWindowsPowerSettingsManager power) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "power.active-scheme.read",
    "Read active power scheme",
    "Reads the active Windows power scheme and maps it to supervisor policy when approved.",
    CapabilityDataClass.Internal,
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    PowerAndSettingsSchemas.EmptyArguments,
    PowerAndSettingsSchemas.ActiveSchemeResult,
    ["windows-power-settings"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    PowerAndSettingsSchemas.ValidateEmpty(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    PowerAndSettingsSchemas.ValidateActiveSchemeResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var activeGuid = power.ReadActiveScheme();
    var configured = policy.Find(activeGuid);
    var stateSha256 = ActiveState(configured?.Id, activeGuid);
    var output = JsonSerializer.Serialize(new
    {
      schemeId = configured?.Id,
      schemeGuidSha256 = PayloadDigest.Sha256Hex(activeGuid.ToString("D")),
      stateSha256,
    });
    return ValueTask.FromResult(ReadResult(output, activeGuid, stateSha256));
  }

  internal static string ActiveState(string? schemeId, Guid schemeGuid) =>
    GovernedWindowsCapabilitySupport.StateSha256(new
    {
      schemeId,
      schemeGuid = schemeGuid.ToString("D"),
    });

  internal static CapabilityExecutionResult ReadResult(
    string output,
    Guid schemeGuid,
    string stateSha256) => new(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance:
      [
        GovernedWindowsCapabilitySupport.Provenance(
          "windows-power-settings",
          schemeGuid.ToString("D"),
          stateSha256),
      ],
      PreStateSha256: stateSha256,
      LocalBytesRead: GovernedWindowsCapabilitySupport.JsonByteCount(output));
}

internal sealed class ActivePowerSchemeSetCapabilityAdapter(
  PowerSchemePolicy policy,
  IWindowsPowerSettingsManager power,
  IHostRecoveryVault recoveryVault) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "power.active-scheme.set",
    "Set active approved power scheme",
    "Activates one supervisor-approved power scheme after snapshotting the approved prior scheme.",
    CapabilityDataClass.Internal,
    CapabilityEffect.Administrative,
    RecoveryKind.Snapshot,
    PowerAndSettingsSchemas.PowerSchemeArguments,
    PowerAndSettingsSchemas.MutationResult,
    ["windows-power-settings", "host-recovery-record"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    PowerAndSettingsSchemas.ValidateScheme(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    PowerAndSettingsSchemas.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var desired = policy.Resolve(
      arguments.GetProperty("schemeId").GetString()!,
      requireActivate: true);
    var beforeGuid = power.ReadActiveScheme();
    var before = policy.Find(beforeGuid)
      ?? throw new HostPreconditionException("active_power_scheme_not_recoverable");
    var beforeSha256 = ActivePowerSchemeReadCapabilityAdapter.ActiveState(before.Id, beforeGuid);
    RegistryValueSetCapabilityAdapter.MatchExpected(context, beforeSha256);
    if (beforeGuid == desired.SchemeGuid)
    {
      throw new HostPreconditionException("power_scheme_already_active");
    }
    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      beforeSha256,
      new
      {
        schemeId = before.Id,
        schemeGuid = before.SchemeGuid.ToString("D"),
      },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    cancellationToken.ThrowIfCancellationRequested();
    power.SetActiveScheme(desired.SchemeGuid);
    var afterGuid = power.ReadActiveScheme();
    if (afterGuid != desired.SchemeGuid)
    {
      throw new HostPreconditionException("power_scheme_postcondition_failed");
    }
    var afterSha256 = ActivePowerSchemeReadCapabilityAdapter.ActiveState(desired.Id, afterGuid);
    return MutationResult(
      output: JsonSerializer.Serialize(new { committed = true, stateSha256 = afterSha256 }),
      beforeSha256,
      afterSha256,
      recovery,
      desired.SchemeGuid);
  }

  internal static CapabilityExecutionResult MutationResult(
    string output,
    string beforeSha256,
    string afterSha256,
    HostRecoveryReceipt recovery,
    Guid sourceGuid) => new(
      output,
      MutationCommitted: true,
      OutcomeUncertain: false,
      Provenance:
      [
        GovernedWindowsCapabilitySupport.Provenance(
          "windows-power-settings",
          sourceGuid.ToString("D"),
          afterSha256),
        RegistryValueSetCapabilityAdapter.RecoveryProvenance(recovery),
      ],
      OpaqueRecoveryHandle: recovery.OpaqueHandle,
      PreStateSha256: beforeSha256,
      RecoveryProvenanceSha256: recovery.RecordSha256,
      LocalBytesRead: 64,
      LocalBytesWritten: 64);
}

internal sealed class MonitorTimeoutReadCapabilityAdapter(
  PowerSchemePolicy policy,
  IWindowsPowerSettingsManager power) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "display.monitor-timeout.read",
    "Read display power timeout",
    "Reads the bounded AC or DC monitor-off timeout for one approved power scheme.",
    CapabilityDataClass.Internal,
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    PowerAndSettingsSchemas.MonitorTimeoutArguments,
    PowerAndSettingsSchemas.MonitorTimeoutResult,
    ["windows-display-power-setting"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    PowerAndSettingsSchemas.ValidateMonitorTimeout(arguments, mutation: false);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    PowerAndSettingsSchemas.ValidateMonitorTimeoutResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var scheme = policy.Resolve(
      arguments.GetProperty("schemeId").GetString()!);
    var powerSource = arguments.GetProperty("powerSource").GetString()!;
    var seconds = power.ReadMonitorTimeout(scheme.SchemeGuid, powerSource == "ac");
    var stateSha256 = TimeoutState(scheme.Id, powerSource, seconds);
    var output = JsonSerializer.Serialize(new
    {
      schemeId = scheme.Id,
      powerSource,
      seconds,
      stateSha256,
    });
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance:
      [
        Provenance(scheme, powerSource, stateSha256),
      ],
      PreStateSha256: stateSha256,
      LocalBytesRead: GovernedWindowsCapabilitySupport.JsonByteCount(output)));
  }

  internal static string TimeoutState(string schemeId, string powerSource, uint seconds) =>
    GovernedWindowsCapabilitySupport.StateSha256(new { schemeId, powerSource, seconds });

  internal static DataProvenance Provenance(
    ResolvedPowerScheme scheme,
    string powerSource,
    string stateSha256) => GovernedWindowsCapabilitySupport.Provenance(
      "windows-display-power-setting",
      $"{scheme.Id}\n{scheme.SchemeGuid:D}\n{powerSource}",
      stateSha256);
}

internal sealed class MonitorTimeoutSetCapabilityAdapter(
  PowerSchemePolicy policy,
  IWindowsPowerSettingsManager power,
  IHostRecoveryVault recoveryVault) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "display.monitor-timeout.set",
    "Set display power timeout",
    "Sets a bounded AC or DC monitor-off timeout for one approved power scheme.",
    CapabilityDataClass.Internal,
    CapabilityEffect.Administrative,
    RecoveryKind.Snapshot,
    PowerAndSettingsSchemas.MonitorTimeoutSetArguments,
    PowerAndSettingsSchemas.MutationResult,
    ["windows-display-power-setting", "host-recovery-record"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    PowerAndSettingsSchemas.ValidateMonitorTimeout(arguments, mutation: true);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    PowerAndSettingsSchemas.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var scheme = policy.Resolve(
      arguments.GetProperty("schemeId").GetString()!,
      requireDisplayTimeoutChange: true);
    var powerSource = arguments.GetProperty("powerSource").GetString()!;
    var acPower = powerSource == "ac";
    var beforeSeconds = power.ReadMonitorTimeout(scheme.SchemeGuid, acPower);
    var beforeSha256 = MonitorTimeoutReadCapabilityAdapter.TimeoutState(
      scheme.Id,
      powerSource,
      beforeSeconds);
    RegistryValueSetCapabilityAdapter.MatchExpected(context, beforeSha256);
    var desired = arguments.GetProperty("seconds").GetUInt32();
    if (beforeSeconds == desired)
    {
      throw new HostPreconditionException("monitor_timeout_already_desired");
    }
    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      beforeSha256,
      new
      {
        schemeId = scheme.Id,
        schemeGuid = scheme.SchemeGuid.ToString("D"),
        powerSource,
        seconds = beforeSeconds,
      },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    cancellationToken.ThrowIfCancellationRequested();
    power.SetMonitorTimeout(scheme.SchemeGuid, acPower, desired);
    var after = power.ReadMonitorTimeout(scheme.SchemeGuid, acPower);
    if (after != desired)
    {
      throw new HostPreconditionException("monitor_timeout_postcondition_failed");
    }
    var afterSha256 = MonitorTimeoutReadCapabilityAdapter.TimeoutState(
      scheme.Id,
      powerSource,
      after);
    var output = JsonSerializer.Serialize(new { committed = true, stateSha256 = afterSha256 });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: true,
      OutcomeUncertain: false,
      Provenance:
      [
        MonitorTimeoutReadCapabilityAdapter.Provenance(scheme, powerSource, afterSha256),
        RegistryValueSetCapabilityAdapter.RecoveryProvenance(recovery),
      ],
      OpaqueRecoveryHandle: recovery.OpaqueHandle,
      PreStateSha256: beforeSha256,
      RecoveryProvenanceSha256: recovery.RecordSha256,
      LocalBytesRead: 64,
      LocalBytesWritten: 64);
  }
}

internal sealed class TimeZoneReadCapabilityAdapter(
  TimeZonePolicy policy,
  IWindowsTimeZoneManager timeZones) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "settings.time-zone.read",
    "Read Windows time zone",
    "Reads the active Windows time-zone identity and maps it to supervisor policy.",
    CapabilityDataClass.Internal,
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    PowerAndSettingsSchemas.EmptyArguments,
    PowerAndSettingsSchemas.TimeZoneResult,
    ["windows-system-settings"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    PowerAndSettingsSchemas.ValidateEmpty(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    PowerAndSettingsSchemas.ValidateTimeZoneResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var windowsId = timeZones.ReadWindowsTimeZoneId();
    var configured = policy.Find(windowsId);
    var stateSha256 = State(configured?.Id, windowsId);
    var output = JsonSerializer.Serialize(new
    {
      timeZoneId = configured?.Id,
      windowsIdSha256 = PayloadDigest.Sha256Hex(windowsId),
      stateSha256,
    });
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance:
      [
        Provenance(windowsId, stateSha256),
      ],
      PreStateSha256: stateSha256,
      LocalBytesRead: GovernedWindowsCapabilitySupport.JsonByteCount(output)));
  }

  internal static string State(string? timeZoneId, string windowsTimeZoneId) =>
    GovernedWindowsCapabilitySupport.StateSha256(new { timeZoneId, windowsTimeZoneId });

  internal static DataProvenance Provenance(
    string windowsTimeZoneId,
    string stateSha256) => GovernedWindowsCapabilitySupport.Provenance(
      "windows-system-settings",
      windowsTimeZoneId,
      stateSha256);
}

internal sealed class TimeZoneSetCapabilityAdapter(
  TimeZonePolicy policy,
  IWindowsTimeZoneManager timeZones,
  IHostRecoveryVault recoveryVault) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "settings.time-zone.set",
    "Set approved Windows time zone",
    "Changes the machine time zone to one supervisor-approved installed Windows time zone.",
    CapabilityDataClass.Internal,
    CapabilityEffect.Administrative,
    RecoveryKind.Snapshot,
    PowerAndSettingsSchemas.TimeZoneSetArguments,
    PowerAndSettingsSchemas.MutationResult,
    ["windows-system-settings", "host-recovery-record"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    PowerAndSettingsSchemas.ValidateTimeZoneSet(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    PowerAndSettingsSchemas.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var desired = policy.Resolve(
      arguments.GetProperty("timeZoneId").GetString()!,
      requireSet: true);
    var beforeWindowsId = timeZones.ReadWindowsTimeZoneId();
    var before = policy.Find(beforeWindowsId)
      ?? throw new HostPreconditionException("active_time_zone_not_recoverable");
    var beforeSha256 = TimeZoneReadCapabilityAdapter.State(before.Id, beforeWindowsId);
    RegistryValueSetCapabilityAdapter.MatchExpected(context, beforeSha256);
    if (string.Equals(
      beforeWindowsId,
      desired.WindowsTimeZoneId,
      StringComparison.OrdinalIgnoreCase))
    {
      throw new HostPreconditionException("time_zone_already_active");
    }
    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      beforeSha256,
      new
      {
        timeZoneId = before.Id,
        before.WindowsTimeZoneId,
      },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    cancellationToken.ThrowIfCancellationRequested();
    timeZones.SetWindowsTimeZoneId(desired.WindowsTimeZoneId);
    var afterWindowsId = timeZones.ReadWindowsTimeZoneId();
    if (!string.Equals(
      afterWindowsId,
      desired.WindowsTimeZoneId,
      StringComparison.OrdinalIgnoreCase))
    {
      throw new HostPreconditionException("time_zone_postcondition_failed");
    }
    var afterSha256 = TimeZoneReadCapabilityAdapter.State(desired.Id, afterWindowsId);
    var output = JsonSerializer.Serialize(new { committed = true, stateSha256 = afterSha256 });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: true,
      OutcomeUncertain: false,
      Provenance:
      [
        TimeZoneReadCapabilityAdapter.Provenance(afterWindowsId, afterSha256),
        RegistryValueSetCapabilityAdapter.RecoveryProvenance(recovery),
      ],
      OpaqueRecoveryHandle: recovery.OpaqueHandle,
      PreStateSha256: beforeSha256,
      RecoveryProvenanceSha256: recovery.RecordSha256,
      LocalBytesRead: 64,
      LocalBytesWritten: 64);
  }
}
