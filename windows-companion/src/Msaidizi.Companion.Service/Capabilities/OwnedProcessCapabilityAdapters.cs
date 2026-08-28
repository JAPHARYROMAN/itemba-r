using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Security;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal static class OwnedProcessSchemas
{
  public static readonly JsonElement HandleArguments = FileSystemCapabilitySchemas.Parse(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "processHandle": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["processHandle"],
      "additionalProperties": false
    }
    """);

  public static readonly JsonElement StatusResult = FileSystemCapabilitySchemas.Parse(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "processHandle": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "processId": { "type": "integer", "minimum": 1 },
        "running": { "type": "boolean" },
        "exitCode": { "type": ["integer", "null"], "minimum": 0 },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "executableId": { "type": "string" },
        "launchActionId": { "type": "string" }
      },
      "required": ["processHandle", "processId", "running", "exitCode", "stateSha256", "executableId", "launchActionId"],
      "additionalProperties": false
    }
    """);

  public static CapabilityArgumentValidation ValidateHandle(
    JsonElement arguments,
    OwnedProcessManager manager)
  {
    if (!HostFileSystemSupport.HasExactProperties(
        arguments,
        new HashSet<string>(["processHandle"], StringComparer.Ordinal))
      || !arguments.TryGetProperty("processHandle", out var handle)
      || handle.ValueKind != JsonValueKind.String
      || handle.GetString()?.Length != 64
      || !handle.GetString()!.All(character =>
        char.IsAsciiHexDigit(character) && !char.IsAsciiLetterUpper(character))
      || !manager.IsKnownHandle(handle.GetString()!))
    {
      return CapabilityArgumentValidation.Invalid(
        "owned_process_not_found",
        "The process handle is not owned by this companion instance.");
    }

    return CapabilityArgumentValidation.Success;
  }

  public static CapabilityArgumentValidation ValidateStatusResult(JsonElement result) =>
    FileSystemCapabilitySchemas.ValidateSimpleResult(
        result,
        "processHandle",
        "processId",
        "running",
        "exitCode",
        "stateSha256",
        "executableId",
        "launchActionId").IsValid
      && FileSystemCapabilitySchemas.IsString(result, "processHandle")
      && result.GetProperty("processHandle").GetString()?.Length == 64
      && FileSystemCapabilitySchemas.IsNonNegativeInteger(result, "processId")
      && result.GetProperty("processId").GetInt64() > 0
      && result.GetProperty("running").ValueKind is JsonValueKind.True or JsonValueKind.False
      && (result.GetProperty("exitCode").ValueKind == JsonValueKind.Null
        || FileSystemCapabilitySchemas.IsNonNegativeInteger(result, "exitCode"))
      && ((result.GetProperty("running").GetBoolean()
          && result.GetProperty("exitCode").ValueKind == JsonValueKind.Null)
        || (!result.GetProperty("running").GetBoolean()
          && result.GetProperty("exitCode").ValueKind == JsonValueKind.Number))
      && FileSystemCapabilitySchemas.IsSha256(result, "stateSha256")
      && FileSystemCapabilitySchemas.IsString(result, "executableId")
      && FileSystemCapabilitySchemas.IsString(result, "launchActionId")
        ? CapabilityArgumentValidation.Success
        : CapabilityArgumentValidation.Invalid("result_schema_invalid", "Invalid process result.");

  public static string Serialize(OwnedProcessSnapshot snapshot) => JsonSerializer.Serialize(new
  {
    processHandle = snapshot.ProcessHandle,
    processId = snapshot.ProcessId,
    running = snapshot.Running,
    exitCode = snapshot.ExitCode,
    stateSha256 = snapshot.StateSha256,
    executableId = snapshot.ExecutableId,
    launchActionId = snapshot.LaunchActionId,
  });

  public static CapabilityDescriptor Descriptor(
    string id,
    string name,
    string description,
    CapabilityEffect effect,
    RecoveryKind recovery,
    JsonElement arguments,
    ConsentRequirement consent = ConsentRequirement.SignedMandate) => new(
      id,
      "1.0.0",
      name,
      description,
      CapabilityDataClass.Internal,
      effect,
      consent,
      recovery,
      RequiredPrivilege.LocalSystem,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      arguments,
      StatusResult,
      ["windows-owned-process"],
      TouchesTrustedRoot: false);
}

public sealed class OwnedProcessLaunchCapabilityAdapter : IHostCapabilityAdapter
{
  public const string CapabilityId = "process.owned.launch";

  private static readonly HashSet<string> RequiredArguments = new(
    ["executableId", "arguments", "workingRootId", "workingRelativePath"],
    StringComparer.Ordinal);
  private static readonly JsonElement ArgumentsSchema = FileSystemCapabilitySchemas.Parse(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "executableId": { "type": "string", "minLength": 1, "maxLength": 64 },
        "arguments": { "type": "array", "maxItems": 128, "items": { "type": "string", "maxLength": 8192 } },
        "workingRootId": { "type": "string", "minLength": 1, "maxLength": 64 },
        "workingRelativePath": { "type": "string", "maxLength": 32767 }
      },
      "required": ["executableId", "arguments", "workingRootId", "workingRelativePath"],
      "additionalProperties": false
    }
    """);
  private readonly OwnedProcessManager _processes;
  private readonly SupervisorPathPolicy _paths;
  private readonly IHostRecoveryVault _recovery;

  public OwnedProcessLaunchCapabilityAdapter(
    OwnedProcessManager processes,
    SupervisorPathPolicy paths,
    IHostRecoveryVault recovery)
  {
    _processes = processes;
    _paths = paths;
    _recovery = recovery;
  }

  public CapabilityDescriptor Descriptor { get; } = OwnedProcessSchemas.Descriptor(
    CapabilityId,
    "Launch an approved process",
    "Launches an exact supervisor-approved executable with an argument array inside a kill-on-close Job Object.",
    CapabilityEffect.Administrative,
    RecoveryKind.CompensatingAction,
    ArgumentsSchema);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments)
  {
    try
    {
      if (!HostFileSystemSupport.HasExactProperties(arguments, RequiredArguments)
        || !arguments.TryGetProperty("arguments", out var argumentArray)
        || argumentArray.ValueKind != JsonValueKind.Array)
      {
        return FileSystemCapabilitySchemas.Invalid();
      }

      var executableId = HostFileSystemSupport.RequiredString(arguments, "executableId", 64);
      if (!_processes.IsExecutableAllowed(executableId))
      {
        return CapabilityArgumentValidation.Invalid(
          "process_executable_not_allowed",
          "Executable ID is not in the supervisor-owned allowlist.");
      }

      var values = argumentArray.EnumerateArray()
        .Select(value => value.ValueKind == JsonValueKind.String
          ? value.GetString()!
          : throw new HostPolicyException("process_arguments_invalid"))
        .ToArray();
      _processes.ValidateArguments(values);
      var workingDirectory = _paths.Resolve(
        HostFileSystemSupport.RequiredString(arguments, "workingRootId", 64),
        arguments.GetProperty("workingRelativePath").GetString()
          ?? throw new HostPolicyException("arguments_schema_invalid"),
        HostPathAccess.Write,
        allowRoot: true);
      using var handle = _paths.OpenExisting(workingDirectory, requireDirectory: true);
      return CapabilityArgumentValidation.Success;
    }
    catch (HostPolicyException exception)
    {
      return CapabilityArgumentValidation.Invalid(exception.ErrorCode, exception.Message);
    }
  }

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    OwnedProcessSchemas.ValidateStatusResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    if (context.ExpectedPreStateSha256 is null
      || !PayloadDigest.FixedTimeEqualsHex(
        context.ExpectedPreStateSha256,
        OwnedProcessManager.AbsentStateSha256))
    {
      throw new HostPreconditionException("expected_pre_state_mismatch");
    }

    var workingDirectory = _paths.Resolve(
      arguments.GetProperty("workingRootId").GetString()!,
      arguments.GetProperty("workingRelativePath").GetString()!,
      HostPathAccess.Write,
      allowRoot: true);
    using var workingHandle = _paths.OpenExisting(
      workingDirectory,
      requireDirectory: true,
      lockAgainstMutation: true);
    var executableId = arguments.GetProperty("executableId").GetString()!;
    var argumentValues = arguments.GetProperty("arguments")
      .EnumerateArray()
      .Select(value => value.GetString()!)
      .ToArray();
    var recovery = await _recovery.PrepareAsync(
      context,
      CapabilityId,
      OwnedProcessManager.AbsentStateSha256,
      new
      {
        executableId,
        arguments = argumentValues,
        workingDirectory.RootId,
        workingDirectory.RelativePath,
        recovery = "terminate-owned-job-object",
      },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    var snapshot = _processes.Launch(
      executableId,
      argumentValues,
      workingDirectory.FullPath,
      context.TaskId,
      context.ActionId,
      cancellationToken);
    return new CapabilityExecutionResult(
      OwnedProcessSchemas.Serialize(snapshot),
      MutationCommitted: true,
      OutcomeUncertain: false,
      [new DataProvenance(
        "windows-owned-process",
        PayloadDigest.Sha256Hex(snapshot.ProcessHandle),
        snapshot.StateSha256,
        ProvenanceTrust.TrustedSystem,
        DateTimeOffset.UtcNow)],
      recovery.OpaqueHandle,
      OwnedProcessManager.AbsentStateSha256,
      recovery.RecordSha256);
  }
}

public sealed class OwnedProcessStatusCapabilityAdapter : IHostCapabilityAdapter
{
  private readonly OwnedProcessManager _processes;

  public OwnedProcessStatusCapabilityAdapter(OwnedProcessManager processes)
  {
    _processes = processes;
  }

  public CapabilityDescriptor Descriptor { get; } = OwnedProcessSchemas.Descriptor(
    "process.owned.status",
    "Inspect an owned process",
    "Returns state only for a process tree launched and retained by this companion.",
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    OwnedProcessSchemas.HandleArguments);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    OwnedProcessSchemas.ValidateHandle(arguments, _processes);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    OwnedProcessSchemas.ValidateStatusResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var snapshot = _processes.GetStatus(
      arguments.GetProperty("processHandle").GetString()!,
      context.TaskId);
    return ValueTask.FromResult(new CapabilityExecutionResult(
      OwnedProcessSchemas.Serialize(snapshot),
      MutationCommitted: false,
      OutcomeUncertain: false,
      [new DataProvenance(
        "windows-owned-process",
        PayloadDigest.Sha256Hex(snapshot.ProcessHandle),
        snapshot.StateSha256,
        ProvenanceTrust.TrustedSystem,
        DateTimeOffset.UtcNow)]));
  }
}

public sealed class OwnedProcessTerminateCapabilityAdapter : IHostCapabilityAdapter
{
  private readonly OwnedProcessManager _processes;
  private readonly IHostRecoveryVault _recovery;

  public OwnedProcessTerminateCapabilityAdapter(
    OwnedProcessManager processes,
    IHostRecoveryVault recovery)
  {
    _processes = processes;
    _recovery = recovery;
  }

  public CapabilityDescriptor Descriptor { get; } = OwnedProcessSchemas.Descriptor(
    "process.owned.terminate",
    "Terminate an owned process tree",
    "Irreversibly terminates only the task-owned Windows Job Object, never an arbitrary PID.",
    CapabilityEffect.Irreversible,
    RecoveryKind.Irreversible,
    OwnedProcessSchemas.HandleArguments);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    OwnedProcessSchemas.ValidateHandle(arguments, _processes);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    OwnedProcessSchemas.ValidateStatusResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var processHandle = arguments.GetProperty("processHandle").GetString()!;
    var before = _processes.GetStatus(processHandle, context.TaskId);
    if (context.ExpectedPreStateSha256 is null
      || !PayloadDigest.FixedTimeEqualsHex(
        context.ExpectedPreStateSha256,
        before.StateSha256))
    {
      throw new HostPreconditionException("expected_pre_state_mismatch");
    }

    var recovery = await _recovery.PrepareAsync(
      context,
      "process.owned.terminate",
      before.StateSha256,
      new
      {
        before.ProcessHandle,
        before.ExecutableId,
        recovery = "none-process-runtime-state-cannot-be-restored",
        processStateRecoverable = false,
      },
      irreversible: true,
      cancellationToken).ConfigureAwait(false);
    var after = _processes.Terminate(processHandle, context.TaskId);
    return new CapabilityExecutionResult(
      OwnedProcessSchemas.Serialize(after),
      MutationCommitted: true,
      OutcomeUncertain: false,
      [new DataProvenance(
        "windows-owned-process",
        PayloadDigest.Sha256Hex(after.ProcessHandle),
        after.StateSha256,
        ProvenanceTrust.TrustedSystem,
        DateTimeOffset.UtcNow)],
      recovery.OpaqueHandle,
      before.StateSha256,
      recovery.RecordSha256);
  }
}
