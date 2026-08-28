using System.ComponentModel;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Execution;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal static class NetworkAdapterCapabilitySchemas
{
  public const string AdapterArguments =
    """
    {
      "type": "object",
      "properties": {
        "adapterId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" }
      },
      "required": ["adapterId"],
      "additionalProperties": false
    }
    """;

  public const string AdapterSetArguments =
    """
    {
      "type": "object",
      "properties": {
        "adapterId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "enabled": { "type": "boolean" }
      },
      "required": ["adapterId", "enabled"],
      "additionalProperties": false
    }
    """;

  public const string InspectResult =
    """
    {
      "type": "object",
      "properties": {
        "adapterId": { "type": "string" },
        "enabled": { "type": "boolean" },
        "operationalStatus": { "type": "string" },
        "interfaceType": { "type": "string" },
        "speedBitsPerSecond": { "type": "integer", "minimum": -1 },
        "unicastAddresses": {
          "type": "array",
          "maxItems": 64,
          "items": {
            "type": "object",
            "properties": {
              "family": { "enum": ["ipv4", "ipv6"] },
              "address": { "type": "string", "maxLength": 65 },
              "prefixLength": { "type": "integer", "minimum": 0, "maximum": 128 }
            },
            "required": ["family", "address", "prefixLength"],
            "additionalProperties": false
          }
        },
        "gateways": {
          "type": "array",
          "maxItems": 64,
          "items": { "type": "string", "maxLength": 65 }
        },
        "dnsServers": {
          "type": "array",
          "maxItems": 64,
          "items": { "type": "string", "maxLength": 65 }
        },
        "enabledStateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["adapterId", "enabled", "operationalStatus", "interfaceType", "speedBitsPerSecond", "unicastAddresses", "gateways", "dnsServers", "enabledStateSha256", "stateSha256"],
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

  public static CapabilityArgumentValidation ValidateArguments(
    JsonElement value,
    bool mutation)
  {
    var exact = mutation
      ? GovernedWindowsCapabilitySupport.Exact(value, "adapterId", "enabled")
      : GovernedWindowsCapabilitySupport.Exact(value, "adapterId");
    return exact
      && GovernedWindowsCapabilitySupport.String(value, "adapterId", 1, 80)
      && GovernedWindowsCapabilitySupport.IsSafeId(value.GetProperty("adapterId").GetString()!)
      && (!mutation || GovernedWindowsCapabilitySupport.Boolean(value, "enabled"))
        ? CapabilityArgumentValidation.Success
        : GovernedWindowsCapabilitySupport.InvalidArguments("Network adapter target is invalid.");
  }

  public static CapabilityArgumentValidation ValidateInspectResult(JsonElement value)
  {
    if (!GovernedWindowsCapabilitySupport.Exact(
        value,
        "adapterId",
        "enabled",
        "operationalStatus",
        "interfaceType",
        "speedBitsPerSecond",
        "unicastAddresses",
        "gateways",
        "dnsServers",
        "enabledStateSha256",
        "stateSha256")
      || !GovernedWindowsCapabilitySupport.String(value, "adapterId", 1, 80)
      || !GovernedWindowsCapabilitySupport.Boolean(value, "enabled")
      || !GovernedWindowsCapabilitySupport.String(value, "operationalStatus", 1, 64)
      || !GovernedWindowsCapabilitySupport.String(value, "interfaceType", 1, 64)
      || !GovernedWindowsCapabilitySupport.Integer64(
        value,
        "speedBitsPerSecond",
        -1,
        long.MaxValue)
      || !ValidateAddresses(value.GetProperty("unicastAddresses"))
      || !ValidateIpList(value.GetProperty("gateways"))
      || !ValidateIpList(value.GetProperty("dnsServers"))
      || !GovernedWindowsCapabilitySupport.Sha256(value, "enabledStateSha256")
      || !GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256"))
    {
      return GovernedWindowsCapabilitySupport.InvalidResult(
        "Network adapter inspection result is invalid.");
    }
    return CapabilityArgumentValidation.Success;
  }

  public static CapabilityArgumentValidation ValidateMutationResult(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(value, "committed", "stateSha256")
    && value.GetProperty("committed").ValueKind == JsonValueKind.True
    && GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidResult("Network adapter mutation result is invalid.");

  private static bool ValidateAddresses(JsonElement value) =>
    value.ValueKind == JsonValueKind.Array
    && value.GetArrayLength() <= 64
    && value.EnumerateArray().All(item =>
      GovernedWindowsCapabilitySupport.Exact(item, "family", "address", "prefixLength")
      && GovernedWindowsCapabilitySupport.String(item, "family", 4, 4)
      && item.GetProperty("family").GetString() is "ipv4" or "ipv6"
      && GovernedWindowsCapabilitySupport.String(item, "address", 2, 65)
      && IPAddress.TryParse(item.GetProperty("address").GetString(), out _)
      && GovernedWindowsCapabilitySupport.Integer(item, "prefixLength", 0, 128));

  private static bool ValidateIpList(JsonElement value) =>
    value.ValueKind == JsonValueKind.Array
    && value.GetArrayLength() <= 64
    && value.EnumerateArray().All(item => item.ValueKind == JsonValueKind.String
      && item.GetString() is { Length: >= 2 and <= 65 } address
      && IPAddress.TryParse(address, out _));
}

internal sealed record ResolvedNetworkAdapter(
  string Id,
  Guid InterfaceGuid,
  bool AllowInspect,
  bool AllowEnable,
  bool AllowDisable);

internal sealed class NetworkAdapterPolicy
{
  private readonly Dictionary<string, ResolvedNetworkAdapter> _adapters;
  public int MaximumAddresses { get; }

  public NetworkAdapterPolicy(IOptions<HostCapabilityOptions> options)
  {
    MaximumAddresses = Math.Clamp(options.Value.MaximumNetworkAddresses, 1, 64);
    _adapters = options.Value.AllowedNetworkAdapters
      .Select(Parse)
      .ToDictionary(adapter => adapter.Id, StringComparer.Ordinal);
    if (_adapters.Values.Select(adapter => adapter.InterfaceGuid).Distinct().Count()
      != _adapters.Count)
    {
      throw new InvalidOperationException("Network adapter allowlist contains duplicate interfaces.");
    }
  }

  public ResolvedNetworkAdapter Resolve(
    string id,
    bool requireInspect = false,
    bool? desiredEnabled = null)
  {
    if (!_adapters.TryGetValue(id, out var adapter)
      || (requireInspect && !adapter.AllowInspect)
      || (desiredEnabled == true && !adapter.AllowEnable)
      || (desiredEnabled == false && !adapter.AllowDisable))
    {
      throw new HostPreconditionException("network_adapter_not_allowed");
    }
    return adapter;
  }

  public ResolvedNetworkAdapter ResolveRecovery(JsonElement recoveryRecord)
  {
    var id = RecoveryJson.RequiredString(recoveryRecord, "adapterId", 80);
    var configuredGuid = RecoveryJson.RequiredString(recoveryRecord, "interfaceGuid", 38);
    var adapter = Resolve(id);
    return Guid.TryParse(configuredGuid, out var parsed)
      && parsed == adapter.InterfaceGuid
        ? adapter
        : throw new HostRecoveryException("recovery_record_format_invalid");
  }

  private static ResolvedNetworkAdapter Parse(AllowedNetworkAdapterOptions adapter)
  {
    if (!GovernedWindowsCapabilitySupport.IsSafeId(adapter.Id)
      || !Guid.TryParse(adapter.InterfaceGuid, out var interfaceGuid)
      || interfaceGuid == Guid.Empty)
    {
      throw new InvalidOperationException("An allowed network adapter is invalid.");
    }
    return new ResolvedNetworkAdapter(
      adapter.Id,
      interfaceGuid,
      adapter.AllowInspect,
      adapter.AllowEnable,
      adapter.AllowDisable);
  }
}

internal sealed record NetworkUnicastAddress(
  string Family,
  string Address,
  int PrefixLength);

internal sealed record NetworkAdapterSnapshot(
  bool Enabled,
  string OperationalStatus,
  string InterfaceType,
  long SpeedBitsPerSecond,
  IReadOnlyList<NetworkUnicastAddress> UnicastAddresses,
  IReadOnlyList<string> Gateways,
  IReadOnlyList<string> DnsServers)
{
  public string EnabledStateSha256(string adapterId) =>
    GovernedWindowsCapabilitySupport.StateSha256(new { adapterId, enabled = Enabled });

  public string StateSha256(string adapterId) =>
    GovernedWindowsCapabilitySupport.StateSha256(new
    {
      adapterId,
      enabled = Enabled,
      operationalStatus = OperationalStatus,
      interfaceType = InterfaceType,
      speedBitsPerSecond = SpeedBitsPerSecond,
      unicastAddresses = UnicastAddresses,
      gateways = Gateways,
      dnsServers = DnsServers,
    });
}

internal interface IWindowsNetworkAdapterManager
{
  NetworkAdapterSnapshot Inspect(Guid interfaceGuid, int maximumAddresses);

  void SetEnabled(Guid interfaceGuid, bool enabled);
}

internal sealed class WindowsNetworkAdapterManager : IWindowsNetworkAdapterManager
{
  private static readonly Guid NetworkAdapterClassGuid =
    new("4d36e972-e325-11ce-bfc1-08002be10318");
  private const int ErrorNoMoreItems = 259;
  private const int DigcfPresent = 0x00000002;
  private const int DifPropertyChange = 0x00000012;
  private const int DicsEnable = 1;
  private const int DicsDisable = 2;
  private const int DicsFlagGlobal = 1;
  private const int DiregDriver = 2;
  private const int KeyRead = 0x20019;
  private static readonly object MutationGate = new();

  public NetworkAdapterSnapshot Inspect(Guid interfaceGuid, int maximumAddresses)
  {
    var networkInterface = NetworkInterface.GetAllNetworkInterfaces()
      .SingleOrDefault(candidate => Guid.TryParse(candidate.Id, out var id)
        && id == interfaceGuid)
      ?? throw new HostPreconditionException("network_adapter_unavailable");
    var properties = networkInterface.GetIPProperties();
    var unicast = properties.UnicastAddresses
      .Where(address => address.Address.AddressFamily is
        AddressFamily.InterNetwork or AddressFamily.InterNetworkV6)
      .Select(address => new NetworkUnicastAddress(
        address.Address.AddressFamily == AddressFamily.InterNetwork ? "ipv4" : "ipv6",
        address.Address.ToString(),
        address.PrefixLength))
      .OrderBy(address => address.Family, StringComparer.Ordinal)
      .ThenBy(address => address.Address, StringComparer.Ordinal)
      .Take(maximumAddresses + 1)
      .ToArray();
    var gateways = properties.GatewayAddresses
      .Select(address => address.Address.ToString())
      .Distinct(StringComparer.Ordinal)
      .OrderBy(address => address, StringComparer.Ordinal)
      .Take(maximumAddresses + 1)
      .ToArray();
    var dns = properties.DnsAddresses
      .Select(address => address.ToString())
      .Distinct(StringComparer.Ordinal)
      .OrderBy(address => address, StringComparer.Ordinal)
      .Take(maximumAddresses + 1)
      .ToArray();
    if (unicast.Length > maximumAddresses
      || gateways.Length > maximumAddresses
      || dns.Length > maximumAddresses)
    {
      throw new HostPreconditionException("network_adapter_address_limit_exceeded");
    }

    return new NetworkAdapterSnapshot(
      ReadEnabled(interfaceGuid),
      networkInterface.OperationalStatus.ToString(),
      networkInterface.NetworkInterfaceType.ToString(),
      Math.Max(-1, networkInterface.Speed),
      unicast,
      gateways,
      dns);
  }

  public void SetEnabled(Guid interfaceGuid, bool enabled)
  {
    lock (MutationGate)
    {
      using var deviceSet = OpenDeviceSet();
      var device = FindExactDevice(deviceSet, interfaceGuid);
      var parameters = new SpPropChangeParams
      {
        ClassInstallHeader = new SpClassInstallHeader
        {
          Size = Marshal.SizeOf<SpClassInstallHeader>(),
          InstallFunction = DifPropertyChange,
        },
        StateChange = enabled ? DicsEnable : DicsDisable,
        Scope = DicsFlagGlobal,
        HardwareProfile = 0,
      };
      if (!SetupDiSetClassInstallParams(
          deviceSet,
          ref device,
          ref parameters,
          Marshal.SizeOf<SpPropChangeParams>())
        || !SetupDiCallClassInstaller(DifPropertyChange, deviceSet, ref device))
      {
        throw NativeFailure("network_adapter_update_failed");
      }
    }
  }

  private static bool ReadEnabled(Guid interfaceGuid)
  {
    using var deviceSet = OpenDeviceSet();
    var device = FindExactDevice(deviceSet, interfaceGuid);
    using var registryKey = OpenDriverKey(deviceSet, ref device);
    var configFlags = registryKey.GetValue("ConfigFlags", 0) switch
    {
      int value => unchecked((uint)value),
      uint value => value,
      _ => 0u,
    };
    return (configFlags & 0x1) == 0;
  }

  private static SafeDeviceInfoSetHandle OpenDeviceSet()
  {
    var classGuid = NetworkAdapterClassGuid;
    var result = SetupDiGetClassDevs(ref classGuid, null, IntPtr.Zero, DigcfPresent);
    return result.IsInvalid
      ? throw NativeFailure("network_adapter_inventory_unavailable")
      : result;
  }

  private static SpDevInfoData FindExactDevice(
    SafeDeviceInfoSetHandle deviceSet,
    Guid interfaceGuid)
  {
    SpDevInfoData? match = null;
    for (uint index = 0; ; index++)
    {
      var device = new SpDevInfoData { Size = Marshal.SizeOf<SpDevInfoData>() };
      if (!SetupDiEnumDeviceInfo(deviceSet, index, ref device))
      {
        if (Marshal.GetLastWin32Error() == ErrorNoMoreItems)
        {
          break;
        }
        throw NativeFailure("network_adapter_inventory_unavailable");
      }

      using var key = OpenDriverKey(deviceSet, ref device);
      if (key.GetValue("NetCfgInstanceId") is string configured
        && Guid.TryParse(configured, out var parsed)
        && parsed == interfaceGuid)
      {
        if (match is not null)
        {
          throw new HostPreconditionException("network_adapter_identity_ambiguous");
        }
        match = device;
      }
    }
    return match ?? throw new HostPreconditionException("network_adapter_device_unavailable");
  }

  private static RegistryKey OpenDriverKey(
    SafeDeviceInfoSetHandle deviceSet,
    ref SpDevInfoData device)
  {
    var handle = SetupDiOpenDevRegKey(
      deviceSet,
      ref device,
      DicsFlagGlobal,
      0,
      DiregDriver,
      KeyRead);
    if (handle == new IntPtr(-1))
    {
      throw NativeFailure("network_adapter_identity_unavailable");
    }
    return RegistryKey.FromHandle(new SafeRegistryHandle(handle, ownsHandle: true));
  }

  private static HostPreconditionException NativeFailure(string errorCode) =>
    new($"{errorCode}_{new Win32Exception(Marshal.GetLastWin32Error()).NativeErrorCode}");

  [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern SafeDeviceInfoSetHandle SetupDiGetClassDevs(
    ref Guid classGuid,
    string? enumerator,
    IntPtr parentWindow,
    int flags);

  [DllImport("setupapi.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SetupDiEnumDeviceInfo(
    SafeDeviceInfoSetHandle deviceInfoSet,
    uint memberIndex,
    ref SpDevInfoData deviceInfoData);

  [DllImport("setupapi.dll", SetLastError = true)]
  private static extern IntPtr SetupDiOpenDevRegKey(
    SafeDeviceInfoSetHandle deviceInfoSet,
    ref SpDevInfoData deviceInfoData,
    int scope,
    int hardwareProfile,
    int keyType,
    int desiredAccess);

  [DllImport("setupapi.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SetupDiSetClassInstallParams(
    SafeDeviceInfoSetHandle deviceInfoSet,
    ref SpDevInfoData deviceInfoData,
    ref SpPropChangeParams classInstallParams,
    int classInstallParamsSize);

  [DllImport("setupapi.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SetupDiCallClassInstaller(
    int installFunction,
    SafeDeviceInfoSetHandle deviceInfoSet,
    ref SpDevInfoData deviceInfoData);

  [DllImport("setupapi.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SetupDiDestroyDeviceInfoList(IntPtr deviceInfoSet);

  [StructLayout(LayoutKind.Sequential)]
  private struct SpDevInfoData
  {
    public int Size;
    public Guid ClassGuid;
    public uint DeviceInstance;
    public IntPtr Reserved;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct SpClassInstallHeader
  {
    public int Size;
    public int InstallFunction;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct SpPropChangeParams
  {
    public SpClassInstallHeader ClassInstallHeader;
    public int StateChange;
    public int Scope;
    public int HardwareProfile;
  }

  private sealed class SafeDeviceInfoSetHandle : SafeHandleZeroOrMinusOneIsInvalid
  {
    private SafeDeviceInfoSetHandle() : base(ownsHandle: true)
    {
    }

    protected override bool ReleaseHandle() => SetupDiDestroyDeviceInfoList(handle);
  }
}

internal sealed class NetworkAdapterInspectCapabilityAdapter(
  NetworkAdapterPolicy policy,
  IWindowsNetworkAdapterManager network) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "network.adapter.inspect",
    "Inspect approved network adapter",
    "Reads bounded IP configuration and state for one supervisor-approved adapter.",
    CapabilityDataClass.Confidential,
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    NetworkAdapterCapabilitySchemas.AdapterArguments,
    NetworkAdapterCapabilitySchemas.InspectResult,
    ["windows-network-adapter"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    NetworkAdapterCapabilitySchemas.ValidateArguments(arguments, mutation: false);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    NetworkAdapterCapabilitySchemas.ValidateInspectResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var adapter = policy.Resolve(
      arguments.GetProperty("adapterId").GetString()!,
      requireInspect: true);
    var state = network.Inspect(adapter.InterfaceGuid, policy.MaximumAddresses);
    var stateSha256 = state.StateSha256(adapter.Id);
    var enabledSha256 = state.EnabledStateSha256(adapter.Id);
    var output = JsonSerializer.Serialize(new
    {
      adapterId = adapter.Id,
      enabled = state.Enabled,
      operationalStatus = state.OperationalStatus,
      interfaceType = state.InterfaceType,
      speedBitsPerSecond = state.SpeedBitsPerSecond,
      unicastAddresses = state.UnicastAddresses.Select(address => new
      {
        family = address.Family,
        address = address.Address,
        prefixLength = address.PrefixLength,
      }),
      gateways = state.Gateways,
      dnsServers = state.DnsServers,
      enabledStateSha256 = enabledSha256,
      stateSha256,
    });
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance:
      [
        Provenance(adapter, stateSha256),
      ],
      PreStateSha256: enabledSha256,
      LocalBytesRead: GovernedWindowsCapabilitySupport.JsonByteCount(output)));
  }

  internal static DataProvenance Provenance(
    ResolvedNetworkAdapter adapter,
    string stateSha256) => GovernedWindowsCapabilitySupport.Provenance(
      "windows-network-adapter",
      $"{adapter.Id}\n{adapter.InterfaceGuid:D}",
      stateSha256);
}

internal sealed class NetworkAdapterEnabledSetCapabilityAdapter(
  NetworkAdapterPolicy policy,
  IWindowsNetworkAdapterManager network,
  IHostRecoveryVault recoveryVault) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "network.adapter.enabled.set",
    "Enable or disable approved network adapter",
    "Changes the device state of one exact supervisor-approved network adapter.",
    CapabilityDataClass.Confidential,
    CapabilityEffect.Administrative,
    RecoveryKind.Snapshot,
    NetworkAdapterCapabilitySchemas.AdapterSetArguments,
    NetworkAdapterCapabilitySchemas.MutationResult,
    ["windows-network-adapter", "host-recovery-record"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    NetworkAdapterCapabilitySchemas.ValidateArguments(arguments, mutation: true);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    NetworkAdapterCapabilitySchemas.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var desired = arguments.GetProperty("enabled").GetBoolean();
    var adapter = policy.Resolve(
      arguments.GetProperty("adapterId").GetString()!,
      desiredEnabled: desired);
    var before = network.Inspect(adapter.InterfaceGuid, policy.MaximumAddresses);
    var beforeSha256 = before.EnabledStateSha256(adapter.Id);
    RegistryValueSetCapabilityAdapter.MatchExpected(context, beforeSha256);
    if (before.Enabled == desired)
    {
      throw new HostPreconditionException("network_adapter_already_desired");
    }
    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      beforeSha256,
      new
      {
        adapterId = adapter.Id,
        interfaceGuid = adapter.InterfaceGuid.ToString("D"),
        enabled = before.Enabled,
      },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    cancellationToken.ThrowIfCancellationRequested();
    network.SetEnabled(adapter.InterfaceGuid, desired);
    var after = network.Inspect(adapter.InterfaceGuid, policy.MaximumAddresses);
    if (after.Enabled != desired)
    {
      throw new HostPreconditionException("network_adapter_postcondition_failed");
    }
    var afterSha256 = after.EnabledStateSha256(adapter.Id);
    var output = JsonSerializer.Serialize(new { committed = true, stateSha256 = afterSha256 });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: true,
      OutcomeUncertain: false,
      Provenance:
      [
        NetworkAdapterInspectCapabilityAdapter.Provenance(adapter, afterSha256),
        RegistryValueSetCapabilityAdapter.RecoveryProvenance(recovery),
      ],
      OpaqueRecoveryHandle: recovery.OpaqueHandle,
      PreStateSha256: beforeSha256,
      RecoveryProvenanceSha256: recovery.RecordSha256,
      LocalBytesRead: 64,
      LocalBytesWritten: 64);
  }
}
