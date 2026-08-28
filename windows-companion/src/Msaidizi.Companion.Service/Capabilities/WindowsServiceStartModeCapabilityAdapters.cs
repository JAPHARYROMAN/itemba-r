using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal static class WindowsServiceStartModeSchemas
{
  public const string ReadArguments =
    """
    {
      "type": "object",
      "properties": {
        "serviceId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" }
      },
      "required": ["serviceId"],
      "additionalProperties": false
    }
    """;

  public const string SetArguments =
    """
    {
      "type": "object",
      "properties": {
        "serviceId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "startMode": { "enum": ["automatic", "manual", "disabled"] }
      },
      "required": ["serviceId", "startMode"],
      "additionalProperties": false
    }
    """;

  public const string ReadResult =
    """
    {
      "type": "object",
      "properties": {
        "startMode": { "enum": ["boot", "system", "automatic", "manual", "disabled"] },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["startMode", "stateSha256"],
      "additionalProperties": false
    }
    """;

  public const string SetResult =
    """
    {
      "type": "object",
      "properties": {
        "updated": { "const": true },
        "startMode": { "enum": ["automatic", "manual", "disabled"] },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["updated", "startMode", "stateSha256"],
      "additionalProperties": false
    }
    """;

  public static CapabilityArgumentValidation ValidateReadArguments(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(value, "serviceId")
    && GovernedWindowsCapabilitySupport.String(value, "serviceId", 1, 80)
    && GovernedWindowsCapabilitySupport.IsSafeId(
      value.GetProperty("serviceId").GetString()!)
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidArguments(
        "Windows service start-mode target is invalid.");

  public static CapabilityArgumentValidation ValidateSetArguments(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(value, "serviceId", "startMode")
    && GovernedWindowsCapabilitySupport.String(value, "serviceId", 1, 80)
    && GovernedWindowsCapabilitySupport.IsSafeId(
      value.GetProperty("serviceId").GetString()!)
    && GovernedWindowsCapabilitySupport.String(value, "startMode", 6, 9)
    && WindowsServiceStartModeSupport.IsSettable(
      value.GetProperty("startMode").GetString()!)
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidArguments(
        "Windows service start-mode mutation is invalid.");

  public static CapabilityArgumentValidation ValidateReadResult(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(value, "startMode", "stateSha256")
    && GovernedWindowsCapabilitySupport.String(value, "startMode", 4, 9)
    && WindowsServiceStartModeSupport.IsKnown(
      value.GetProperty("startMode").GetString()!)
    && GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidResult(
        "Windows service start-mode result is invalid.");

  public static CapabilityArgumentValidation ValidateSetResult(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(
      value,
      "updated",
      "startMode",
      "stateSha256")
    && value.GetProperty("updated").ValueKind == JsonValueKind.True
    && GovernedWindowsCapabilitySupport.String(value, "startMode", 6, 9)
    && WindowsServiceStartModeSupport.IsSettable(
      value.GetProperty("startMode").GetString()!)
    && GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidResult(
        "Windows service start-mode mutation result is invalid.");
}

internal sealed record WindowsServiceStartModeSnapshot(
  string StartMode,
  uint ServiceType,
  string StateSha256);

internal sealed record WindowsServiceStartModeObservation(
  string StartMode,
  uint ServiceType,
  string ConfigurationIdentitySha256);

internal static class WindowsServiceStartModeSupport
{
  public const string CapabilityVersion = "2.0.0";
  public const string RecoveryRecordContract =
    "windows-service-start-mode-recovery/v2";

  public const uint Win32OwnProcess = 0x00000010;
  public const uint Win32ShareProcess = 0x00000020;

  private static readonly HashSet<string> KnownModes = new(
    ["boot", "system", "automatic", "manual", "disabled"],
    StringComparer.Ordinal);
  private static readonly HashSet<string> SettableModes = new(
    ["automatic", "manual", "disabled"],
    StringComparer.Ordinal);

  public static bool IsKnown(string value) => KnownModes.Contains(value);

  public static bool IsSettable(string value) => SettableModes.Contains(value);

  public static bool IsSupportedServiceType(uint value) =>
    value is Win32OwnProcess or Win32ShareProcess;

  public static WindowsServiceStartModeSnapshot Snapshot(
    AllowedWindowsService service,
    string startMode,
    uint serviceType = Win32OwnProcess,
    string? configurationIdentitySha256 = null)
  {
    if (!IsKnown(startMode))
    {
      throw new HostPreconditionException("windows_service_start_mode_unsupported");
    }

    var configurationIdentity = configurationIdentitySha256
      ?? ConfiguredTargetIdentitySha256(service, serviceType);
    if (!PayloadDigest.IsSha256Hex(configurationIdentity))
    {
      throw new HostPreconditionException(
        "windows_service_configuration_identity_invalid");
    }

    return new WindowsServiceStartModeSnapshot(
      startMode,
      serviceType,
      GovernedWindowsCapabilitySupport.StateSha256(new
      {
        service.Id,
        service.Name,
        startMode,
        serviceType,
        configurationIdentitySha256 = configurationIdentity,
      }));
  }

  public static WindowsServiceStartModeSnapshot Snapshot(
    AllowedWindowsService service,
    WindowsServiceStartModeObservation observation) => Snapshot(
      service,
      observation.StartMode,
      observation.ServiceType,
      observation.ConfigurationIdentitySha256);

  internal static string ConfiguredTargetIdentitySha256(
    AllowedWindowsService service,
    uint serviceType = Win32OwnProcess) =>
    GovernedWindowsCapabilitySupport.StateSha256(new
    {
      contract = "windows-service-base-configuration/test-target/v1",
      service.Id,
      service.Name,
      serviceType,
    });

  public static DataProvenance Provenance(
    AllowedWindowsService service,
    string stateSha256) => GovernedWindowsCapabilitySupport.Provenance(
      "windows-service-control-manager",
      service.Id,
      stateSha256);
}

internal interface IWindowsServiceStartModeManager
{
  WindowsServiceStartModeObservation ReadStartMode(AllowedWindowsService service);

  void SetStartMode(
    AllowedWindowsService service,
    string startMode,
    string expectedStartMode,
    uint expectedServiceType,
    string expectedConfigurationIdentitySha256,
    CancellationToken cancellationToken);
}

/// <summary>
/// Direct SCM configuration boundary. It changes only dwStartType and passes
/// SERVICE_NO_CHANGE/null for binary path, account, password, dependencies,
/// display name, service type, error control, and load-order group.
/// </summary>
internal sealed class WindowsServiceStartModeManager : IWindowsServiceStartModeManager
{
  private const uint ScManagerConnect = 0x0001;
  private const uint ServiceQueryConfig = 0x0001;
  private const uint ServiceChangeConfig = 0x0002;
  private const uint ServiceNoChange = 0xffffffff;
  private const int ErrorInsufficientBuffer = 122;
  // QueryServiceConfigW documents an 8 KiB maximum buffer.
  private const int MaximumQueryConfigBytes = 8 * 1024;

  public WindowsServiceStartModeObservation ReadStartMode(
    AllowedWindowsService service)
  {
    using var handles = Open(service, ServiceQueryConfig);
    return ReadConfiguration(handles.Service);
  }

  private static WindowsServiceStartModeObservation ReadConfiguration(
    SafeServiceHandle serviceHandle)
  {
    _ = QueryServiceConfigW(serviceHandle, IntPtr.Zero, 0, out var requiredBytes);
    var error = Marshal.GetLastWin32Error();
    if (error != ErrorInsufficientBuffer
      || requiredBytes < Marshal.SizeOf<QueryServiceConfig>()
      || requiredBytes > MaximumQueryConfigBytes)
    {
      throw new Win32Exception(error);
    }

    var buffer = Marshal.AllocHGlobal(requiredBytes);
    try
    {
      if (!QueryServiceConfigW(
        serviceHandle,
        buffer,
        requiredBytes,
        out var returnedBytes)
        || returnedBytes > requiredBytes)
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }

      var configuration = Marshal.PtrToStructure<QueryServiceConfig>(buffer);
      var startMode = configuration.StartType switch
      {
        0 => "boot",
        1 => "system",
        2 => "automatic",
        3 => "manual",
        4 => "disabled",
        _ => throw new HostPreconditionException(
          "windows_service_start_mode_unsupported"),
      };
      var configurationIdentitySha256 =
        GovernedWindowsCapabilitySupport.StateSha256(new
        {
          contract = "windows-service-base-configuration/v1",
          configuration.ServiceType,
          configuration.ErrorControl,
          binaryPathName = ReadBoundedString(
            configuration.BinaryPathName,
            buffer,
            requiredBytes),
          loadOrderGroup = ReadBoundedString(
            configuration.LoadOrderGroup,
            buffer,
            requiredBytes),
          configuration.TagId,
          dependencies = ReadBoundedMultiString(
            configuration.Dependencies,
            buffer,
            requiredBytes),
          serviceStartName = ReadBoundedString(
            configuration.ServiceStartName,
            buffer,
            requiredBytes),
          displayName = ReadBoundedString(
            configuration.DisplayName,
            buffer,
            requiredBytes),
        });
      return new WindowsServiceStartModeObservation(
        startMode,
        configuration.ServiceType,
        configurationIdentitySha256);
    }
    finally
    {
      Marshal.FreeHGlobal(buffer);
    }
  }

  public void SetStartMode(
    AllowedWindowsService service,
    string startMode,
    string expectedStartMode,
    uint expectedServiceType,
    string expectedConfigurationIdentitySha256,
    CancellationToken cancellationToken)
  {
    if (!WindowsServiceStartModeSupport.IsSettable(startMode)
      || !WindowsServiceStartModeSupport.IsSettable(expectedStartMode)
      || !PayloadDigest.IsSha256Hex(expectedConfigurationIdentitySha256))
    {
      throw new HostPreconditionException(
        "windows_service_start_mode_unsupported");
    }
    var nativeStartType = startMode switch
    {
      "automatic" => 2u,
      "manual" => 3u,
      "disabled" => 4u,
      _ => throw new HostPreconditionException(
        "windows_service_start_mode_unsupported"),
    };
    using var handles = Open(
      service,
      ServiceQueryConfig | ServiceChangeConfig);
    var current = ReadConfiguration(handles.Service);
    if (!string.Equals(
        current.StartMode,
        expectedStartMode,
        StringComparison.Ordinal)
      || current.ServiceType != expectedServiceType
      || !PayloadDigest.FixedTimeEqualsHex(
        current.ConfigurationIdentitySha256,
        expectedConfigurationIdentitySha256)
      || !WindowsServiceStartModeSupport.IsSupportedServiceType(
        current.ServiceType))
    {
      throw new HostPreconditionException(
        "windows_service_pre_state_changed");
    }

    // This is the final cooperative boundary inside the native manager after
    // the same-handle service-type guard and immediately before commit.
    cancellationToken.ThrowIfCancellationRequested();
    if (!ChangeServiceConfigW(
      handles.Service,
      serviceType: ServiceNoChange,
      startType: nativeStartType,
      errorControl: ServiceNoChange,
      binaryPathName: null,
      loadOrderGroup: null,
      tagId: IntPtr.Zero,
      dependencies: null,
      serviceStartName: null,
      password: null,
      displayName: null))
    {
      // Once the native commit API has been attempted, the caller treats every
      // failure as an unknown write outcome and never retries the whole action.
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
  }

  private static string? ReadBoundedString(
    IntPtr value,
    IntPtr buffer,
    int bufferBytes)
  {
    if (value == IntPtr.Zero)
    {
      return null;
    }

    var offset = checked(value.ToInt64() - buffer.ToInt64());
    if (offset < 0 || offset >= bufferBytes || (offset & 1) != 0)
    {
      throw new HostPreconditionException(
        "windows_service_configuration_identity_invalid");
    }

    var maximumCharacters = checked((bufferBytes - (int)offset) / sizeof(char));
    var characters = new char[maximumCharacters];
    for (var index = 0; index < maximumCharacters; index++)
    {
      var character = (char)Marshal.ReadInt16(value, index * sizeof(char));
      if (character == '\0')
      {
        return new string(characters, 0, index);
      }
      characters[index] = character;
    }

    throw new HostPreconditionException(
      "windows_service_configuration_identity_invalid");
  }

  private static string[] ReadBoundedMultiString(
    IntPtr value,
    IntPtr buffer,
    int bufferBytes)
  {
    if (value == IntPtr.Zero)
    {
      return [];
    }

    var offset = checked(value.ToInt64() - buffer.ToInt64());
    if (offset < 0 || offset >= bufferBytes || (offset & 1) != 0)
    {
      throw new HostPreconditionException(
        "windows_service_configuration_identity_invalid");
    }

    var maximumCharacters = checked((bufferBytes - (int)offset) / sizeof(char));
    var values = new List<string>();
    var current = new List<char>();
    for (var index = 0; index < maximumCharacters; index++)
    {
      var character = (char)Marshal.ReadInt16(value, index * sizeof(char));
      if (character != '\0')
      {
        current.Add(character);
        continue;
      }

      if (current.Count == 0)
      {
        return values.ToArray();
      }

      values.Add(new string(current.ToArray()));
      current.Clear();
    }

    throw new HostPreconditionException(
      "windows_service_configuration_identity_invalid");
  }

  private static ServiceHandles Open(AllowedWindowsService service, uint access)
  {
    var manager = OpenSCManagerW(null, null, ScManagerConnect);
    if (manager.IsInvalid)
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    var serviceHandle = OpenServiceW(manager, service.Name, access);
    if (serviceHandle.IsInvalid)
    {
      manager.Dispose();
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    return new ServiceHandles(manager, serviceHandle);
  }

  private sealed record ServiceHandles(
    SafeServiceHandle Manager,
    SafeServiceHandle Service) : IDisposable
  {
    public void Dispose()
    {
      Service.Dispose();
      Manager.Dispose();
    }
  }

  private sealed class SafeServiceHandle : SafeHandleZeroOrMinusOneIsInvalid
  {
    public SafeServiceHandle() : base(ownsHandle: true)
    {
    }

    protected override bool ReleaseHandle() => CloseServiceHandle(handle);
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct QueryServiceConfig
  {
    public uint ServiceType;
    public uint StartType;
    public uint ErrorControl;
    public IntPtr BinaryPathName;
    public IntPtr LoadOrderGroup;
    public uint TagId;
    public IntPtr Dependencies;
    public IntPtr ServiceStartName;
    public IntPtr DisplayName;
  }

  [DllImport(
    "advapi32.dll",
    EntryPoint = "OpenSCManagerW",
    CharSet = CharSet.Unicode,
    ExactSpelling = true,
    SetLastError = true)]
  private static extern SafeServiceHandle OpenSCManagerW(
    string? machineName,
    string? databaseName,
    uint desiredAccess);

  [DllImport(
    "advapi32.dll",
    EntryPoint = "OpenServiceW",
    CharSet = CharSet.Unicode,
    ExactSpelling = true,
    SetLastError = true)]
  private static extern SafeServiceHandle OpenServiceW(
    SafeServiceHandle manager,
    string serviceName,
    uint desiredAccess);

  [DllImport(
    "advapi32.dll",
    EntryPoint = "QueryServiceConfigW",
    ExactSpelling = true,
    SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool QueryServiceConfigW(
    SafeServiceHandle service,
    IntPtr queryServiceConfig,
    int bufferSize,
    out int bytesNeeded);

  [DllImport(
    "advapi32.dll",
    EntryPoint = "ChangeServiceConfigW",
    CharSet = CharSet.Unicode,
    ExactSpelling = true,
    SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool ChangeServiceConfigW(
    SafeServiceHandle service,
    uint serviceType,
    uint startType,
    uint errorControl,
    string? binaryPathName,
    string? loadOrderGroup,
    IntPtr tagId,
    string? dependencies,
    string? serviceStartName,
    string? password,
    string? displayName);

  [DllImport("advapi32.dll", ExactSpelling = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool CloseServiceHandle(IntPtr service);
}

internal sealed class WindowsServiceStartModeReadCapabilityAdapter(
  WindowsServicePolicy policy,
  IWindowsServiceStartModeManager manager) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } =
    GovernedWindowsCapabilitySupport.Descriptor(
      "windows.service.start-mode.read",
      "Read approved Windows service start mode",
      "Reads only the base SCM start mode for one supervisor-approved service.",
      CapabilityDataClass.Internal,
      CapabilityEffect.LocalRead,
      RecoveryKind.NotApplicable,
      WindowsServiceStartModeSchemas.ReadArguments,
      WindowsServiceStartModeSchemas.ReadResult,
      ["windows-service-control-manager"],
      version: WindowsServiceStartModeSupport.CapabilityVersion);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    WindowsServiceStartModeSchemas.ValidateReadArguments(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    WindowsServiceStartModeSchemas.ValidateReadResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var target = policy.ResolveStartMode(
      arguments.GetProperty("serviceId").GetString()!,
      startMode: string.Empty,
      requireChange: false);
    var state = WindowsServiceStartModeSupport.Snapshot(
      target,
      manager.ReadStartMode(target));
    var output = JsonSerializer.Serialize(new
    {
      startMode = state.StartMode,
      stateSha256 = state.StateSha256,
    });
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance: [WindowsServiceStartModeSupport.Provenance(target, state.StateSha256)],
      PreStateSha256: state.StateSha256,
      LocalBytesRead: GovernedWindowsCapabilitySupport.JsonByteCount(output)));
  }
}

internal sealed class WindowsServiceStartModeSetCapabilityAdapter(
  WindowsServicePolicy policy,
  IWindowsServiceStartModeManager manager,
  IHostRecoveryVault recoveryVault) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } =
    GovernedWindowsCapabilitySupport.Descriptor(
      "windows.service.start-mode.set",
      "Set approved Windows service start mode",
      "Changes only the base SCM start mode to one supervisor-approved value.",
      CapabilityDataClass.Internal,
      CapabilityEffect.Administrative,
      RecoveryKind.Snapshot,
      WindowsServiceStartModeSchemas.SetArguments,
      WindowsServiceStartModeSchemas.SetResult,
      ["windows-service-control-manager", "host-recovery-record"],
      version: WindowsServiceStartModeSupport.CapabilityVersion);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    WindowsServiceStartModeSchemas.ValidateSetArguments(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    WindowsServiceStartModeSchemas.ValidateSetResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var requestedMode = arguments.GetProperty("startMode").GetString()!;
    var target = policy.ResolveStartMode(
      arguments.GetProperty("serviceId").GetString()!,
      requestedMode,
      requireChange: true);
    var beforeObservation = manager.ReadStartMode(target);
    if (!WindowsServiceStartModeSupport.IsSupportedServiceType(
        beforeObservation.ServiceType)
      || !WindowsServiceStartModeSupport.IsSettable(
        beforeObservation.StartMode))
    {
      throw new HostPreconditionException(
        "windows_service_type_not_allowed");
    }
    var before = WindowsServiceStartModeSupport.Snapshot(
      target,
      beforeObservation);
    RegistryValueSetCapabilityAdapter.MatchExpected(context, before.StateSha256);
    if (string.Equals(before.StartMode, requestedMode, StringComparison.Ordinal))
    {
      throw new HostPreconditionException(
        "windows_service_start_mode_already_set");
    }

    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      before.StateSha256,
      new
      {
        recordContract = WindowsServiceStartModeSupport.RecoveryRecordContract,
        target.Id,
        target.Name,
        startMode = before.StartMode,
        serviceType = before.ServiceType,
        configurationIdentitySha256 = beforeObservation.ConfigurationIdentitySha256,
      },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);

    var guardedBefore = WindowsServiceStartModeSupport.Snapshot(
      target,
      manager.ReadStartMode(target));
    RegistryValueSetCapabilityAdapter.MatchExpected(
      context,
      guardedBefore.StateSha256);

    // Final cooperative boundary before the native manager's same-handle type
    // guard. The manager checks cancellation again immediately before commit.
    cancellationToken.ThrowIfCancellationRequested();
    manager.SetStartMode(
      target,
      requestedMode,
      before.StartMode,
      before.ServiceType,
      beforeObservation.ConfigurationIdentitySha256,
      cancellationToken);
    WindowsServiceStartModeSnapshot after;
    try
    {
      after = WindowsServiceStartModeSupport.Snapshot(
        target,
        manager.ReadStartMode(target));
    }
    catch (HostPreconditionException exception)
    {
      // The native setter returned success, so even a value that SCM should
      // never report here is a post-commit ambiguity, not a known no-write
      // precondition failure. The coordinator must persist NEEDS_ATTENTION.
      throw new InvalidOperationException(
        "windows_service_start_mode_postcondition_failed",
        exception);
    }
    var expectedAfter = WindowsServiceStartModeSupport.Snapshot(
      target,
      requestedMode,
      before.ServiceType,
      beforeObservation.ConfigurationIdentitySha256);
    if (!PayloadDigest.FixedTimeEqualsHex(
        after.StateSha256,
        expectedAfter.StateSha256))
    {
      throw new InvalidOperationException(
        "windows_service_start_mode_postcondition_failed");
    }

    var output = JsonSerializer.Serialize(new
    {
      updated = true,
      startMode = after.StartMode,
      stateSha256 = after.StateSha256,
    });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: true,
      OutcomeUncertain: false,
      Provenance:
      [
        WindowsServiceStartModeSupport.Provenance(target, after.StateSha256),
        RegistryValueSetCapabilityAdapter.RecoveryProvenance(recovery),
      ],
      OpaqueRecoveryHandle: recovery.OpaqueHandle,
      PreStateSha256: before.StateSha256,
      RecoveryProvenanceSha256: recovery.RecordSha256,
      LocalBytesRead: GovernedWindowsCapabilitySupport.JsonByteCount(output),
      LocalBytesWritten: sizeof(uint));
  }
}

internal sealed class WindowsServiceStartModeAdministrativeRecoveryOperation(
  WindowsServicePolicy policy,
  IWindowsServiceStartModeManager manager) :
  IAdministrativeRecoveryOperation,
  IExpectedCurrentStateAdministrativeRecoveryOperation
{
  public bool Supports(string operation) =>
    operation == "windows.service.start-mode.set";

  public ValueTask<string> ReadStateAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var target = Resolve(record, out _, out _, out _);
    return ValueTask.FromResult(WindowsServiceStartModeSupport.Snapshot(
      target,
      manager.ReadStartMode(target)).StateSha256);
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
    var target = Resolve(
      record,
      out var priorMode,
      out var serviceType,
      out var configurationIdentitySha256);
    cancellationToken.ThrowIfCancellationRequested();
    try
    {
      var current = manager.ReadStartMode(target);
      var currentState = WindowsServiceStartModeSupport.Snapshot(target, current);
      if (!PayloadDigest.FixedTimeEqualsHex(
          currentState.StateSha256,
          expectedCurrentStateSha256)
        || current.ServiceType != serviceType
        || !PayloadDigest.FixedTimeEqualsHex(
          current.ConfigurationIdentitySha256,
          configurationIdentitySha256))
      {
        throw new HostPreconditionException(
          "windows_service_pre_state_changed");
      }
      manager.SetStartMode(
        target,
        priorMode,
        current.StartMode,
        serviceType,
        configurationIdentitySha256,
        cancellationToken);
      return ValueTask.CompletedTask;
    }
    catch (HostPreconditionException)
    {
      throw new HostRecoveryException("recovery_precondition_mismatch");
    }
    catch (OperationCanceledException)
    {
      throw;
    }
    catch (Exception exception) when (exception is not HostRecoveryException)
    {
      throw new HostRecoveryException("recovery_outcome_unknown");
    }
  }

  private AllowedWindowsService Resolve(
    TrustedHostRecoveryRecord record,
    out string priorMode,
    out uint serviceType,
    out string configurationIdentitySha256)
  {
    if (!record.RecoveryRecord.TryGetProperty(
        "recordContract",
        out var recordContractValue)
      || recordContractValue.ValueKind != JsonValueKind.String
      || !string.Equals(
        recordContractValue.GetString(),
        WindowsServiceStartModeSupport.RecoveryRecordContract,
        StringComparison.Ordinal))
    {
      throw new HostRecoveryException("recovery_record_version_unsupported");
    }

    if (!GovernedWindowsCapabilitySupport.Exact(
      record.RecoveryRecord,
      "recordContract",
      "id",
      "name",
      "startMode",
      "serviceType",
      "configurationIdentitySha256"))
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }

    var target = policy.ResolveRecovery(record.RecoveryRecord);
    priorMode = RecoveryJson.RequiredString(
      record.RecoveryRecord,
      "startMode",
      16);
    if (!WindowsServiceStartModeSupport.IsSettable(priorMode)
      || !record.RecoveryRecord.TryGetProperty(
        "serviceType",
        out var serviceTypeValue)
      || !serviceTypeValue.TryGetUInt32(out serviceType)
      || !WindowsServiceStartModeSupport.IsSupportedServiceType(serviceType)
      || !record.RecoveryRecord.TryGetProperty(
        "configurationIdentitySha256",
        out var configurationIdentityValue)
      || configurationIdentityValue.ValueKind != JsonValueKind.String
      || !PayloadDigest.IsSha256Hex(
        configurationIdentityValue.GetString() ?? string.Empty))
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }

    configurationIdentitySha256 = configurationIdentityValue.GetString()!;

    return target;
  }
}
