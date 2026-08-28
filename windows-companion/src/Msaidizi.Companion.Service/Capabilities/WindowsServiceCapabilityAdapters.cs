using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal static class WindowsServiceSchemas
{
  public static readonly JsonElement Arguments = Parse(
    """
    {
      "type": "object",
      "properties": {
        "serviceId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" }
      },
      "required": ["serviceId"],
      "additionalProperties": false
    }
    """);

  public static readonly JsonElement Result = Parse(
    """
    {
      "type": "object",
      "properties": {
        "status": { "enum": ["Stopped", "StartPending", "StopPending", "Running", "ContinuePending", "PausePending", "Paused", "Unknown"] },
        "processId": { "type": "integer", "minimum": 0 },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["status", "processId", "stateSha256"],
      "additionalProperties": false
    }
    """);

  public static CapabilityDescriptor Descriptor(
    string id,
    string name,
    string description,
    CapabilityEffect effect,
    RecoveryKind recovery) => new(
      id,
      "1.0.0",
      name,
      description,
      CapabilityDataClass.Internal,
      effect,
      ConsentRequirement.SignedMandate,
      recovery,
      RequiredPrivilege.LocalSystem,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      Arguments,
      Result,
      ["windows-service-control-manager", "host-recovery-record"],
      TouchesTrustedRoot: false);

  public static CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    arguments.ValueKind == JsonValueKind.Object
    && arguments.EnumerateObject().Count() == 1
    && arguments.TryGetProperty("serviceId", out var id)
    && id.ValueKind == JsonValueKind.String
    && id.GetString() is { Length: >= 1 and <= 80 }
      ? CapabilityArgumentValidation.Success
      : CapabilityArgumentValidation.Invalid(
        "arguments_schema_invalid",
        "Windows service target is invalid.");

  public static CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    result.ValueKind == JsonValueKind.Object
    && result.EnumerateObject().Count() == 3
    && result.TryGetProperty("status", out var status)
    && status.GetString() is "Stopped" or "StartPending" or "StopPending" or "Running"
      or "ContinuePending" or "PausePending" or "Paused" or "Unknown"
    && result.TryGetProperty("processId", out var processId)
    && processId.TryGetInt64(out var pid)
    && pid >= 0
    && result.TryGetProperty("stateSha256", out var state)
    && state.GetString() is { } digest
    && PayloadDigest.IsSha256Hex(digest)
      ? CapabilityArgumentValidation.Success
      : CapabilityArgumentValidation.Invalid(
        "result_schema_invalid",
        "Windows service result is invalid.");

  private static JsonElement Parse(string json)
  {
    using var document = JsonDocument.Parse(json);
    return document.RootElement.Clone();
  }
}

internal sealed record AllowedWindowsService(
  string Id,
  string Name,
  bool AllowStart,
  bool AllowStop,
  IReadOnlySet<string> AllowedStartModes);

internal sealed class WindowsServicePolicy
{
  private static readonly HashSet<string> ProtectedServices = new(
    [
      "Itemba Msaidizi Companion",
      "Itemba.Msaidizi.Companion",
      "Itemba Msaidizi Update Supervisor",
      "Itemba.Msaidizi.UpdateSupervisor",
      "Itemba Msaidizi Recovery Supervisor",
      "Itemba.Msaidizi.RecoverySupervisor",
      "Itemba Msaidizi Audit Signer",
      "Itemba.Msaidizi.AuditSigner",
    ],
    StringComparer.OrdinalIgnoreCase);
  private readonly Dictionary<string, AllowedWindowsService> _services;

  public WindowsServicePolicy(IOptions<HostCapabilityOptions> options)
  {
    _services = options.Value.AllowedWindowsServices
      .Select(Validate)
      .ToDictionary(service => service.Id, StringComparer.Ordinal);
  }

  public AllowedWindowsService Resolve(
    JsonElement arguments,
    bool requireStart = false,
    bool requireStop = false)
  {
    var id = arguments.GetProperty("serviceId").GetString()!;
    if (!_services.TryGetValue(id, out var service)
      || (requireStart && !service.AllowStart)
      || (requireStop && !service.AllowStop))
    {
      throw new HostPreconditionException("windows_service_not_allowed");
    }

    return service;
  }

  public AllowedWindowsService ResolveStartMode(
    string id,
    string startMode,
    bool requireChange)
  {
    if (!_services.TryGetValue(id, out var service)
      || (requireChange && !service.AllowedStartModes.Contains(startMode)))
    {
      throw new HostPreconditionException("windows_service_start_mode_not_allowed");
    }

    return service;
  }

  public AllowedWindowsService ResolveRecovery(JsonElement recoveryRecord)
  {
    var id = recoveryRecord.GetProperty("id").GetString()!;
    var name = recoveryRecord.GetProperty("name").GetString()!;
    if (!_services.TryGetValue(id, out var service)
      || !string.Equals(service.Name, name, StringComparison.Ordinal))
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }
    return service;
  }

  private static AllowedWindowsService Validate(AllowedWindowsServiceOptions service)
  {
    if (string.IsNullOrWhiteSpace(service.Id)
      || service.Id.Length > 80
      || service.Id.Any(character => !(char.IsAsciiLetterOrDigit(character)
        || character is '.' or '-' or '_'))
      || string.IsNullOrWhiteSpace(service.ServiceName)
      || service.ServiceName.Length > 256
      || service.ServiceName.Contains('\\')
      || service.ServiceName.Contains('/')
      || IsTrustedServiceName(service.ServiceName))
    {
      throw new InvalidOperationException(
        "An allowed Windows service is invalid or part of the trusted supervisor.");
    }

    var allowedStartModes = service.AllowedStartModes?.ToArray()
      ?? throw new InvalidOperationException(
        $"Allowed Windows service '{service.Id}' has no start-mode allowlist.");
    if (allowedStartModes.Length != allowedStartModes.Distinct(StringComparer.Ordinal).Count()
      || allowedStartModes.Any(mode => !WindowsServiceStartModeSupport.IsSettable(mode)))
    {
      throw new InvalidOperationException(
        "A Windows service start-mode allowlist is invalid.");
    }

    return new AllowedWindowsService(
      service.Id,
      service.ServiceName,
      service.AllowStart,
      service.AllowStop,
      allowedStartModes.ToHashSet(StringComparer.Ordinal));
  }

  internal static bool IsTrustedServiceName(string serviceName)
  {
    if (ProtectedServices.Contains(serviceName))
    {
      return true;
    }

    var canonical = string.Concat(serviceName
      .Where(char.IsAsciiLetterOrDigit)
      .Select(char.ToLowerInvariant));
    if (!canonical.Contains("msaidizi", StringComparison.Ordinal))
    {
      return false;
    }

    return canonical.Contains("companion", StringComparison.Ordinal)
      || canonical.Contains("update", StringComparison.Ordinal)
      || canonical.Contains("recovery", StringComparison.Ordinal)
      || canonical.Contains("supervisor", StringComparison.Ordinal)
      || canonical.Contains("audit", StringComparison.Ordinal);
  }
}

internal sealed record WindowsServiceState(
  string Status,
  uint ProcessId,
  string StateSha256);

internal static class WindowsServiceControl
{
  private const uint ScManagerConnect = 0x0001;
  private const uint ServiceQueryStatus = 0x0004;
  private const uint ServiceStart = 0x0010;
  private const uint ServiceStop = 0x0020;
  private const uint ServiceControlStop = 0x00000001;
  private const int ScStatusProcessInfo = 0;

  public static WindowsServiceState Query(AllowedWindowsService service)
  {
    using var handles = Open(service, ServiceQueryStatus);
    return Query(handles.Service);
  }

  public static async ValueTask<WindowsServiceState> StartAsync(
    AllowedWindowsService service,
    CancellationToken cancellationToken)
  {
    using var handles = Open(service, ServiceQueryStatus | ServiceStart);
    if (Query(handles.Service).Status != "Stopped")
    {
      throw new HostPreconditionException("windows_service_not_stopped");
    }

    if (!StartService(handles.Service, 0, IntPtr.Zero))
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    return await WaitForAsync(handles.Service, "Running", cancellationToken)
      .ConfigureAwait(false);
  }

  public static async ValueTask<WindowsServiceState> StopAsync(
    AllowedWindowsService service,
    CancellationToken cancellationToken)
  {
    using var handles = Open(service, ServiceQueryStatus | ServiceStop);
    if (Query(handles.Service).Status != "Running")
    {
      throw new HostPreconditionException("windows_service_not_running");
    }

    if (!ControlService(handles.Service, ServiceControlStop, out _))
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    return await WaitForAsync(handles.Service, "Stopped", cancellationToken)
      .ConfigureAwait(false);
  }

  private static ServiceHandles Open(AllowedWindowsService service, uint access)
  {
    var manager = OpenSCManager(null, null, ScManagerConnect);
    if (manager.IsInvalid)
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    var serviceHandle = OpenService(manager, service.Name, access);
    if (serviceHandle.IsInvalid)
    {
      manager.Dispose();
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    return new ServiceHandles(manager, serviceHandle);
  }

  private static WindowsServiceState Query(SafeServiceHandle service)
  {
    var size = Marshal.SizeOf<ServiceStatusProcess>();
    var buffer = Marshal.AllocHGlobal(size);
    try
    {
      if (!QueryServiceStatusEx(
        service,
        ScStatusProcessInfo,
        buffer,
        size,
        out _))
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }

      var native = Marshal.PtrToStructure<ServiceStatusProcess>(buffer);
      var status = native.CurrentState switch
      {
        1 => "Stopped",
        2 => "StartPending",
        3 => "StopPending",
        4 => "Running",
        5 => "ContinuePending",
        6 => "PausePending",
        7 => "Paused",
        _ => "Unknown",
      };
      // PID is observational provenance, not durable service state. Excluding
      // it makes a stop/start compensation converge to the exact pre-state.
      var canonical = JsonSerializer.Serialize(new { status });
      return new WindowsServiceState(status, native.ProcessId, PayloadDigest.Sha256Hex(canonical));
    }
    finally
    {
      Marshal.FreeHGlobal(buffer);
    }
  }

  private static async ValueTask<WindowsServiceState> WaitForAsync(
    SafeServiceHandle service,
    string expected,
    CancellationToken cancellationToken)
  {
    while (true)
    {
      cancellationToken.ThrowIfCancellationRequested();
      var state = Query(service);
      if (state.Status == expected)
      {
        return state;
      }

      if (state.Status is not ("StartPending" or "StopPending"))
      {
        throw new InvalidOperationException("windows_service_transition_failed");
      }

      await Task.Delay(TimeSpan.FromMilliseconds(250), cancellationToken).ConfigureAwait(false);
    }
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
  private struct ServiceStatus
  {
    public uint ServiceType;
    public uint CurrentState;
    public uint ControlsAccepted;
    public uint Win32ExitCode;
    public uint ServiceSpecificExitCode;
    public uint CheckPoint;
    public uint WaitHint;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct ServiceStatusProcess
  {
    public uint ServiceType;
    public uint CurrentState;
    public uint ControlsAccepted;
    public uint Win32ExitCode;
    public uint ServiceSpecificExitCode;
    public uint CheckPoint;
    public uint WaitHint;
    public uint ProcessId;
    public uint ServiceFlags;
  }

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern SafeServiceHandle OpenSCManager(
    string? machineName,
    string? databaseName,
    uint desiredAccess);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern SafeServiceHandle OpenService(
    SafeServiceHandle manager,
    string serviceName,
    uint desiredAccess);

  [DllImport("advapi32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool QueryServiceStatusEx(
    SafeServiceHandle service,
    int infoLevel,
    IntPtr buffer,
    int bufferSize,
    out int bytesNeeded);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool StartService(
    SafeServiceHandle service,
    int argumentCount,
    IntPtr arguments);

  [DllImport("advapi32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool ControlService(
    SafeServiceHandle service,
    uint control,
    out ServiceStatus status);

  [DllImport("advapi32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool CloseServiceHandle(IntPtr service);
}

internal sealed class WindowsServiceStatusCapabilityAdapter(
  WindowsServicePolicy policy) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = WindowsServiceSchemas.Descriptor(
    "windows.service.status",
    "Read approved Windows service status",
    "Reads runtime status for one supervisor-approved Windows service.",
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    WindowsServiceSchemas.ValidateArguments(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    WindowsServiceSchemas.ValidateResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var target = policy.Resolve(arguments);
    var state = WindowsServiceControl.Query(target);
    return ValueTask.FromResult(Result(target, state, mutation: false));
  }

  internal static CapabilityExecutionResult Result(
    AllowedWindowsService target,
    WindowsServiceState state,
    bool mutation,
    HostRecoveryReceipt? recovery = null,
    string? preStateSha256 = null)
  {
    var output = JsonSerializer.Serialize(new
    {
      status = state.Status,
      processId = state.ProcessId,
      stateSha256 = state.StateSha256,
    });
    var provenance = new List<DataProvenance>
    {
      new(
        "windows-service-control-manager",
        PayloadDigest.Sha256Hex(target.Id),
        state.StateSha256,
        ProvenanceTrust.TrustedSystem,
        DateTimeOffset.UtcNow),
    };
    if (recovery is not null)
    {
      provenance.Add(RegistryValueSetCapabilityAdapter.RecoveryProvenance(recovery));
    }

    return new CapabilityExecutionResult(
      output,
      MutationCommitted: mutation,
      OutcomeUncertain: false,
      Provenance: provenance,
      OpaqueRecoveryHandle: recovery?.OpaqueHandle,
      PreStateSha256: preStateSha256 ?? state.StateSha256,
      RecoveryProvenanceSha256: recovery?.RecordSha256);
  }
}

internal sealed class WindowsServiceStartCapabilityAdapter(
  WindowsServicePolicy policy,
  IHostRecoveryVault recoveryVault) : IHostCapabilityAdapter
{
  internal const string CapabilityId = "windows.service.start";

  public CapabilityDescriptor Descriptor { get; } = WindowsServiceSchemas.Descriptor(
    CapabilityId,
    "Start approved Windows service",
    "Starts one supervisor-approved Windows service and waits for Running.",
    CapabilityEffect.Administrative,
    RecoveryKind.CompensatingAction);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    WindowsServiceSchemas.ValidateArguments(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    WindowsServiceSchemas.ValidateResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var target = policy.Resolve(arguments, requireStart: true);
    var before = WindowsServiceControl.Query(target);
    RegistryValueSetCapabilityAdapter.MatchExpected(context, before.StateSha256);
    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      before.StateSha256,
      new { target.Id, target.Name, before.Status, before.ProcessId },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    var after = await WindowsServiceControl.StartAsync(target, cancellationToken)
      .ConfigureAwait(false);
    return WindowsServiceStatusCapabilityAdapter.Result(
      target,
      after,
      mutation: true,
      recovery,
      before.StateSha256);
  }
}

internal sealed class WindowsServiceStopCapabilityAdapter(
  WindowsServicePolicy policy,
  IHostRecoveryVault recoveryVault) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = WindowsServiceSchemas.Descriptor(
    "windows.service.stop",
    "Stop approved Windows service",
    "Stops one supervisor-approved Windows service and waits for Stopped.",
    CapabilityEffect.Administrative,
    RecoveryKind.CompensatingAction);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    WindowsServiceSchemas.ValidateArguments(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    WindowsServiceSchemas.ValidateResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var target = policy.Resolve(arguments, requireStop: true);
    var before = WindowsServiceControl.Query(target);
    RegistryValueSetCapabilityAdapter.MatchExpected(context, before.StateSha256);
    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      before.StateSha256,
      new { target.Id, target.Name, before.Status, before.ProcessId },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    var after = await WindowsServiceControl.StopAsync(target, cancellationToken)
      .ConfigureAwait(false);
    return WindowsServiceStatusCapabilityAdapter.Result(
      target,
      after,
      mutation: true,
      recovery,
      before.StateSha256);
  }
}
