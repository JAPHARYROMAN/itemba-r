using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal static class MachineEnvironmentSchemas
{
  public const string CapabilityVersion = "2.0.0";
  public const string RecoveryRecordContract =
    "windows-machine-environment-recovery/v1";

  public static readonly JsonElement TargetArguments = Parse(
    """
    {
      "type": "object",
      "properties": {
        "variableId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" }
      },
      "required": ["variableId"],
      "additionalProperties": false
    }
    """);

  public static readonly JsonElement SetArguments = Parse(
    """
    {
      "type": "object",
      "properties": {
        "variableId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "value": { "type": "string", "maxLength": 32767 }
      },
      "required": ["variableId", "value"],
      "additionalProperties": false
    }
    """);

  public static readonly JsonElement ReadResult = Parse(
    """
    {
      "type": "object",
      "properties": {
        "exists": { "type": "boolean" },
        "value": { "type": ["string", "null"] },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["exists", "value", "stateSha256"],
      "additionalProperties": false
    }
    """);

  public static readonly JsonElement MutationResult = Parse(
    """
    {
      "type": "object",
      "properties": {
        "committed": { "type": "boolean" },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["committed", "stateSha256"],
      "additionalProperties": false
    }
    """);

  public static CapabilityDescriptor Descriptor(
    string id,
    string name,
    string description,
    CapabilityEffect effect,
    RecoveryKind recovery,
    JsonElement arguments,
    JsonElement result) => new(
      id,
      CapabilityVersion,
      name,
      description,
      CapabilityDataClass.Confidential,
      effect,
      ConsentRequirement.SignedMandate,
      recovery,
      RequiredPrivilege.LocalSystem,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      arguments,
      result,
      recovery == RecoveryKind.NotApplicable
        ? ["machine-environment"]
        : ["machine-environment", "host-recovery-record"],
      TouchesTrustedRoot: false);

  public static CapabilityArgumentValidation ValidateTarget(JsonElement arguments) =>
    arguments.ValueKind == JsonValueKind.Object
    && arguments.EnumerateObject().Count() == 1
    && arguments.TryGetProperty("variableId", out var id)
    && id.ValueKind == JsonValueKind.String
    && id.GetString() is { Length: >= 1 and <= 80 }
      ? CapabilityArgumentValidation.Success
      : Invalid("Machine environment target is invalid.");

  public static CapabilityArgumentValidation ValidateSet(JsonElement arguments) =>
    arguments.ValueKind == JsonValueKind.Object
    && arguments.EnumerateObject().Count() == 2
    && arguments.TryGetProperty("variableId", out var id)
    && id.ValueKind == JsonValueKind.String
    && id.GetString() is { Length: >= 1 and <= 80 }
    && arguments.TryGetProperty("value", out var value)
    && value.ValueKind == JsonValueKind.String
    && value.GetString() is { Length: <= 32_767 } parsed
    && !parsed.Contains('\0')
    && !DurableNonSecretValuePolicy.AppearsSecretBearingText(parsed)
      ? CapabilityArgumentValidation.Success
      : Invalid("Machine environment value is invalid.");

  public static CapabilityArgumentValidation ValidateReadResult(JsonElement result)
  {
    if (!Exact(result, "exists", "value", "stateSha256")
      || result.GetProperty("exists").ValueKind is not (
        JsonValueKind.True or JsonValueKind.False)
      || result.GetProperty("stateSha256").ValueKind != JsonValueKind.String
      || result.GetProperty("stateSha256").GetString() is not { } digest
      || !PayloadDigest.IsSha256Hex(digest))
    {
      return InvalidResult("Machine environment read result is invalid.");
    }

    var exists = result.GetProperty("exists").GetBoolean();
    var value = result.GetProperty("value");
    var safe = exists
      ? value.ValueKind == JsonValueKind.String
        && !DurableNonSecretValuePolicy.AppearsSecretBearingText(
          value.GetString())
      : value.ValueKind == JsonValueKind.Null;
    return safe
      ? CapabilityArgumentValidation.Success
      : InvalidResult(
        "Machine environment read result violates the durable-value boundary.");
  }

  public static CapabilityArgumentValidation ValidateMutationResult(JsonElement result) =>
    Exact(result, "committed", "stateSha256")
    && result.GetProperty("committed").ValueKind == JsonValueKind.True
    && result.GetProperty("stateSha256").GetString() is { } digest
    && PayloadDigest.IsSha256Hex(digest)
      ? CapabilityArgumentValidation.Success
      : InvalidResult("Machine environment mutation result is invalid.");

  private static bool Exact(JsonElement value, params string[] names) =>
    value.ValueKind == JsonValueKind.Object
    && value.EnumerateObject().Count() == names.Length
    && value.EnumerateObject().Select(property => property.Name)
      .ToHashSet(StringComparer.Ordinal).SetEquals(names);

  private static CapabilityArgumentValidation Invalid(string message) =>
    CapabilityArgumentValidation.Invalid("arguments_schema_invalid", message);

  private static CapabilityArgumentValidation InvalidResult(string message) =>
    CapabilityArgumentValidation.Invalid("result_schema_invalid", message);

  private static JsonElement Parse(string json)
  {
    using var document = JsonDocument.Parse(json);
    return document.RootElement.Clone();
  }
}

internal sealed record MachineEnvironmentTarget(
  string Id,
  string Name,
  bool AllowRead,
  bool AllowWrite,
  bool AllowDelete);

internal sealed class MachineEnvironmentPolicy
{
  private static readonly HashSet<string> ProtectedNames = new(
    [
      "COMSPEC",
      "PATH",
      "PATHEXT",
      "PSMODULEPATH",
      "SYSTEMROOT",
      "WINDIR",
      "TEMP",
      "TMP",
      "PROGRAMDATA",
    ],
    StringComparer.OrdinalIgnoreCase);
  private readonly Dictionary<string, MachineEnvironmentTarget> _targets;

  public MachineEnvironmentPolicy(IOptions<HostCapabilityOptions> options)
  {
    ArgumentNullException.ThrowIfNull(options);
    var targets = options.Value.AllowedMachineEnvironmentVariables
      .Select(Validate)
      .ToArray();
    if (targets.GroupBy(target => target.Id, StringComparer.Ordinal)
        .Any(group => group.Count() != 1)
      || targets.GroupBy(target => target.Name, StringComparer.OrdinalIgnoreCase)
        .Any(group => group.Count() != 1))
    {
      throw InvalidConfiguration();
    }
    _targets = targets.ToDictionary(item => item.Id, StringComparer.Ordinal);
  }

  public MachineEnvironmentTarget Resolve(
    JsonElement arguments,
    bool requireRead = false,
    bool requireWrite = false,
    bool requireDelete = false)
  {
    var id = arguments.GetProperty("variableId").GetString()!;
    if (!_targets.TryGetValue(id, out var target)
      || (requireRead && !target.AllowRead)
      || (requireWrite && !target.AllowWrite)
      || (requireDelete && !target.AllowDelete))
    {
      throw new HostPreconditionException("machine_environment_target_not_allowed");
    }

    return target;
  }

  public MachineEnvironmentTarget ResolveRecovery(JsonElement recoveryRecord)
  {
    if (recoveryRecord.TryGetProperty("recordContract", out var contract)
      && (contract.ValueKind != JsonValueKind.String
        || !string.Equals(
          contract.GetString(),
          MachineEnvironmentSchemas.RecoveryRecordContract,
          StringComparison.Ordinal)))
    {
      throw new HostRecoveryException("recovery_record_version_unsupported");
    }
    var id = recoveryRecord.GetProperty("id").GetString()!;
    var name = recoveryRecord.GetProperty("name").GetString()!;
    if (!_targets.TryGetValue(id, out var target)
      || !string.Equals(target.Name, name, StringComparison.Ordinal))
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }
    return target;
  }

  private static MachineEnvironmentTarget Validate(AllowedMachineEnvironmentVariableOptions item)
  {
    if (string.IsNullOrWhiteSpace(item.Id)
      || item.Id.Length > 80
      || item.Id.Any(character => !(char.IsAsciiLetterOrDigit(character)
        || character is '.' or '-' or '_'))
      || string.IsNullOrWhiteSpace(item.Name)
      || item.Name.Length > 128
      || !(char.IsAsciiLetter(item.Name[0]) || item.Name[0] == '_')
      || item.Name.Skip(1).Any(character => !(char.IsAsciiLetterOrDigit(character)
        || character == '_'))
      || ProtectedNames.Contains(item.Name)
      || (item.AllowRead || item.AllowWrite)
        && (DurableNonSecretValuePolicy.IsCredentialLikeName(item.Name)
          || !DurableNonSecretValuePolicy.IsClassified(item.Classification))
      || !(item.AllowRead || item.AllowWrite)
        && !string.IsNullOrEmpty(item.Classification)
        && !DurableNonSecretValuePolicy.IsClassified(item.Classification))
    {
      throw InvalidConfiguration();
    }

    return new MachineEnvironmentTarget(
      item.Id,
      item.Name,
      item.AllowRead,
      item.AllowWrite,
      item.AllowDelete);
  }

  private static InvalidOperationException InvalidConfiguration() => new(
    "A machine environment target is invalid, secret-like, ambiguously aliased, or lacks durable non-secret classification.");
}

internal sealed record MachineEnvironmentState(
  bool Exists,
  string? Value,
  string StateSha256,
  long Bytes);

internal static class MachineEnvironmentSupport
{
  public static MachineEnvironmentState Read(MachineEnvironmentTarget target)
  {
    var value = Environment.GetEnvironmentVariable(
      target.Name,
      EnvironmentVariableTarget.Machine);
    var canonical = JsonSerializer.Serialize(new { exists = value is not null, value });
    return new MachineEnvironmentState(
      value is not null,
      value,
      PayloadDigest.Sha256Hex(canonical),
      Encoding.UTF8.GetByteCount(canonical));
  }

  public static void BroadcastChange()
  {
    _ = SendMessageTimeout(
      new IntPtr(0xffff),
      0x001A,
      IntPtr.Zero,
      "Environment",
      0x0002,
      2_000,
      out _);
  }

  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern IntPtr SendMessageTimeout(
    IntPtr window,
    uint message,
    IntPtr wParam,
    string lParam,
    uint flags,
    uint timeout,
    out IntPtr result);
}

internal sealed class MachineEnvironmentReadCapabilityAdapter(
  MachineEnvironmentPolicy policy) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = MachineEnvironmentSchemas.Descriptor(
    "environment.machine.read",
    "Read approved machine environment variable",
    "Reads one exactly classified durable non-secret machine environment variable as untrusted content.",
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    MachineEnvironmentSchemas.TargetArguments,
    MachineEnvironmentSchemas.ReadResult);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    MachineEnvironmentSchemas.ValidateTarget(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    MachineEnvironmentSchemas.ValidateReadResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var target = policy.Resolve(arguments, requireRead: true);
    var state = MachineEnvironmentSupport.Read(target);
    return ValueTask.FromResult(Result(target, state));
  }

  internal static CapabilityExecutionResult Result(
    MachineEnvironmentTarget target,
    MachineEnvironmentState state)
  {
    if (state.Exists
      && DurableNonSecretValuePolicy.AppearsSecretBearingText(state.Value))
    {
      throw new HostPreconditionException(
        "machine_environment_durable_value_secret_detected");
    }
    var output = JsonSerializer.Serialize(new
    {
      exists = state.Exists,
      value = state.Value,
      stateSha256 = state.StateSha256,
    });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance: [Provenance(target, state.StateSha256)],
      PreStateSha256: state.StateSha256,
      LocalBytesRead: state.Bytes);
  }

  internal static DataProvenance Provenance(
    MachineEnvironmentTarget target,
    string digest) => new(
      "machine-environment",
      PayloadDigest.Sha256Hex(target.Id),
      digest,
      ProvenanceTrust.UntrustedContent,
      DateTimeOffset.UtcNow);
}

internal sealed class MachineEnvironmentSetCapabilityAdapter(
  MachineEnvironmentPolicy policy,
  IHostRecoveryVault recoveryVault) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = MachineEnvironmentSchemas.Descriptor(
    "environment.machine.set",
    "Set approved machine environment variable",
    "Creates or replaces one exactly classified durable non-secret machine environment variable.",
    CapabilityEffect.Administrative,
    RecoveryKind.Snapshot,
    MachineEnvironmentSchemas.SetArguments,
    MachineEnvironmentSchemas.MutationResult);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    MachineEnvironmentSchemas.ValidateSet(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    MachineEnvironmentSchemas.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var validation = ValidateArguments(arguments);
    if (!validation.IsValid)
    {
      throw new HostPreconditionException(
        validation.ErrorCode ?? "arguments_schema_invalid");
    }
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var target = policy.Resolve(arguments, requireWrite: true);
    var before = MachineEnvironmentSupport.Read(target);
    RegistryValueSetCapabilityAdapter.MatchExpected(context, before.StateSha256);
    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      before.StateSha256,
      CreateRecoveryRecord(target, before),
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    cancellationToken.ThrowIfCancellationRequested();
    Environment.SetEnvironmentVariable(
      target.Name,
      arguments.GetProperty("value").GetString(),
      EnvironmentVariableTarget.Machine);
    MachineEnvironmentSupport.BroadcastChange();
    var after = MachineEnvironmentSupport.Read(target);
    var output = JsonSerializer.Serialize(new { committed = true, stateSha256 = after.StateSha256 });
    return Result(output, target, before, after, recovery);
  }

  internal static CapabilityExecutionResult Result(
    string output,
    MachineEnvironmentTarget target,
    MachineEnvironmentState before,
    MachineEnvironmentState after,
    HostRecoveryReceipt recovery) => new(
      output,
      MutationCommitted: true,
      OutcomeUncertain: false,
      Provenance:
      [
        MachineEnvironmentReadCapabilityAdapter.Provenance(target, after.StateSha256),
        RegistryValueSetCapabilityAdapter.RecoveryProvenance(recovery),
      ],
      OpaqueRecoveryHandle: recovery.OpaqueHandle,
      PreStateSha256: before.StateSha256,
      RecoveryProvenanceSha256: recovery.RecordSha256,
      LocalBytesRead: before.Bytes,
      LocalBytesWritten: after.Bytes);

  internal static object CreateRecoveryRecord(
    MachineEnvironmentTarget target,
    MachineEnvironmentState before) => new
    {
      recordContract = MachineEnvironmentSchemas.RecoveryRecordContract,
      target.Id,
      target.Name,
      before.Exists,
      before.Value,
    };
}

internal sealed class MachineEnvironmentDeleteCapabilityAdapter(
  MachineEnvironmentPolicy policy,
  IHostRecoveryVault recoveryVault) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = MachineEnvironmentSchemas.Descriptor(
    "environment.machine.delete",
    "Delete approved machine environment variable",
    "Deletes one supervisor-approved machine environment variable after snapshotting it.",
    CapabilityEffect.Administrative,
    RecoveryKind.Snapshot,
    MachineEnvironmentSchemas.TargetArguments,
    MachineEnvironmentSchemas.MutationResult);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    MachineEnvironmentSchemas.ValidateTarget(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    MachineEnvironmentSchemas.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var target = policy.Resolve(arguments, requireDelete: true);
    var before = MachineEnvironmentSupport.Read(target);
    if (!before.Exists)
    {
      throw new HostPreconditionException("machine_environment_value_absent");
    }

    RegistryValueSetCapabilityAdapter.MatchExpected(context, before.StateSha256);
    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      before.StateSha256,
      MachineEnvironmentSetCapabilityAdapter.CreateRecoveryRecord(target, before),
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    cancellationToken.ThrowIfCancellationRequested();
    Environment.SetEnvironmentVariable(
      target.Name,
      null,
      EnvironmentVariableTarget.Machine);
    MachineEnvironmentSupport.BroadcastChange();
    var after = MachineEnvironmentSupport.Read(target);
    var output = JsonSerializer.Serialize(new { committed = true, stateSha256 = after.StateSha256 });
    return MachineEnvironmentSetCapabilityAdapter.Result(
      output,
      target,
      before,
      after,
      recovery);
  }
}
