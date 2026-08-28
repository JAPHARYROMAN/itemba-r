using System.Text;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal static class ScheduledTaskSchemas
{
  public const string MetadataCapabilityVersion = "2.0.0";
  public const string RunCapabilityVersion = "2.0.0";
  public const string RecoveryRecordContract =
    "windows-scheduled-task-enabled-recovery/v2";

  public static readonly JsonElement TargetArguments = Parse(
    """
    {
      "type": "object",
      "properties": {
        "taskId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" }
      },
      "required": ["taskId"],
      "additionalProperties": false
    }
    """);

  public static readonly JsonElement EnableArguments = Parse(
    """
    {
      "type": "object",
      "properties": {
        "taskId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "enabled": { "type": "boolean" }
      },
      "required": ["taskId", "enabled"],
      "additionalProperties": false
    }
    """);

  public static readonly JsonElement DefinitionResult = Parse(
    """
    {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean" },
        "definitionSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["enabled", "definitionSha256", "stateSha256"],
      "additionalProperties": false
    }
    """);

  public static readonly JsonElement RunResult = Parse(
    """
    {
      "type": "object",
      "properties": {
        "dispatched": { "type": "boolean" },
        "definitionSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["dispatched", "definitionSha256"],
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
    JsonElement result,
    IReadOnlyList<string> provenanceOutputs,
    string version,
    CapabilityDataClass dataClass = CapabilityDataClass.Confidential) => new(
      id,
      version,
      name,
      description,
      dataClass,
      effect,
      ConsentRequirement.SignedMandate,
      recovery,
      RequiredPrivilege.LocalSystem,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      arguments,
      result,
      provenanceOutputs,
      TouchesTrustedRoot: false);

  public static CapabilityArgumentValidation ValidateTarget(JsonElement arguments) =>
    arguments.ValueKind == JsonValueKind.Object
    && arguments.EnumerateObject().Count() == 1
    && arguments.TryGetProperty("taskId", out var id)
    && IsTaskId(id)
      ? CapabilityArgumentValidation.Success
      : Invalid("Scheduled task target is invalid.");

  public static CapabilityArgumentValidation ValidateEnable(JsonElement arguments) =>
    arguments.ValueKind == JsonValueKind.Object
    && arguments.EnumerateObject().Count() == 2
    && arguments.TryGetProperty("taskId", out var id)
    && IsTaskId(id)
    && arguments.TryGetProperty("enabled", out var enabled)
    && enabled.ValueKind is JsonValueKind.True or JsonValueKind.False
      ? CapabilityArgumentValidation.Success
      : Invalid("Scheduled task enable arguments are invalid.");

  public static CapabilityArgumentValidation ValidateDefinitionResult(JsonElement result)
  {
    if (result.ValueKind != JsonValueKind.Object
      || result.EnumerateObject().Count() != 3
      || !result.TryGetProperty("enabled", out var enabled)
      || enabled.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
      || !result.TryGetProperty("definitionSha256", out var definition)
      || definition.ValueKind != JsonValueKind.String
      || definition.GetString() is not { } definitionSha256
      || !PayloadDigest.IsSha256Hex(definitionSha256)
      || !result.TryGetProperty("stateSha256", out var state)
      || state.ValueKind != JsonValueKind.String
      || state.GetString() is not { } stateSha256
      || !PayloadDigest.IsSha256Hex(stateSha256))
    {
      return InvalidResult("Scheduled task metadata result is invalid.");
    }

    var expectedState = ScheduledTaskSupport.StateSha256(
      enabled.GetBoolean(),
      definitionSha256);
    return PayloadDigest.FixedTimeEqualsHex(expectedState, stateSha256)
      ? CapabilityArgumentValidation.Success
      : InvalidResult("Scheduled task metadata result is invalid.");
  }

  public static CapabilityArgumentValidation ValidateRunResult(JsonElement result) =>
    result.ValueKind == JsonValueKind.Object
    && result.EnumerateObject().Count() == 2
    && result.TryGetProperty("dispatched", out var dispatched)
    && dispatched.ValueKind == JsonValueKind.True
    && result.TryGetProperty("definitionSha256", out var definition)
    && definition.ValueKind == JsonValueKind.String
    && definition.GetString() is { } digest
    && PayloadDigest.IsSha256Hex(digest)
      ? CapabilityArgumentValidation.Success
      : InvalidResult("Scheduled task run result is invalid.");

  private static CapabilityArgumentValidation Invalid(string message) =>
    CapabilityArgumentValidation.Invalid("arguments_schema_invalid", message);

  private static CapabilityArgumentValidation InvalidResult(string message) =>
    CapabilityArgumentValidation.Invalid("result_schema_invalid", message);

  private static bool IsTaskId(JsonElement value) =>
    value.ValueKind == JsonValueKind.String
    && value.GetString() is { Length: >= 1 and <= 80 } id
    && id.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_');

  private static JsonElement Parse(string json)
  {
    using var document = JsonDocument.Parse(json);
    return document.RootElement.Clone();
  }
}

internal sealed record AllowedScheduledTask(
  string Id,
  string Path,
  bool AllowRun,
  bool AllowEnableDisable);

internal sealed record ResolvedScheduledTaskRecovery(
  AllowedScheduledTask Target,
  bool Enabled);

internal sealed class ScheduledTaskPolicy
{
  private const string ProtectedPrefix = @"\Itemba\Msaidizi\Supervisor";
  private readonly Dictionary<string, AllowedScheduledTask> _tasks;

  public ScheduledTaskPolicy(IOptions<HostCapabilityOptions> options)
  {
    _tasks = options.Value.AllowedScheduledTasks
      .Select(Validate)
      .ToDictionary(task => task.Id, StringComparer.Ordinal);
  }

  public AllowedScheduledTask Resolve(
    JsonElement arguments,
    bool requireRun = false,
    bool requireEnable = false)
  {
    var id = arguments.GetProperty("taskId").GetString()!;
    if (!_tasks.TryGetValue(id, out var task)
      || (requireRun && !task.AllowRun)
      || (requireEnable && !task.AllowEnableDisable))
    {
      throw new HostPreconditionException("scheduled_task_not_allowed");
    }

    return task;
  }

  public ResolvedScheduledTaskRecovery ResolveRecovery(
    JsonElement recoveryRecord,
    string expectedPreStateSha256)
  {
    try
    {
      if (recoveryRecord.ValueKind != JsonValueKind.Object
        || recoveryRecord.EnumerateObject().Count() != 7
        || !PayloadDigest.IsSha256Hex(expectedPreStateSha256))
      {
        throw InvalidRecoveryRecord();
      }

      var contract = RecoveryJson.RequiredString(recoveryRecord, "contract", 80);
      var id = RecoveryJson.RequiredString(recoveryRecord, "id", 80);
      var path = RecoveryJson.RequiredString(recoveryRecord, "path", 512);
      var xml = RecoveryJson.RequiredString(
        recoveryRecord,
        "definitionXml",
        524_288);
      var definitionSha256 = RecoveryJson.RequiredString(
        recoveryRecord,
        "definitionSha256",
        64);
      var stateSha256 = RecoveryJson.RequiredString(
        recoveryRecord,
        "stateSha256",
        64);
      if (!recoveryRecord.TryGetProperty("enabled", out var enabledValue)
        || enabledValue.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
        || !string.Equals(
          contract,
          ScheduledTaskSchemas.RecoveryRecordContract,
          StringComparison.Ordinal)
        || !_tasks.TryGetValue(id, out var task)
        || !string.Equals(task.Path, path, StringComparison.Ordinal)
        || !PayloadDigest.IsSha256Hex(definitionSha256)
        || !PayloadDigest.IsSha256Hex(stateSha256))
      {
        throw InvalidRecoveryRecord();
      }

      var definition = ScheduledTaskSupport.ParseDefinition(xml);
      var enabled = enabledValue.GetBoolean();
      if (definition.Enabled != enabled
        || !PayloadDigest.FixedTimeEqualsHex(
          definition.DefinitionSha256,
          definitionSha256)
        || !PayloadDigest.FixedTimeEqualsHex(definition.StateSha256, stateSha256)
        || !PayloadDigest.FixedTimeEqualsHex(stateSha256, expectedPreStateSha256))
      {
        throw InvalidRecoveryRecord();
      }

      return new ResolvedScheduledTaskRecovery(task, enabled);
    }
    catch (HostRecoveryException)
    {
      throw;
    }
    catch (Exception exception) when (exception is not OperationCanceledException)
    {
      throw InvalidRecoveryRecord();
    }
  }

  private static HostRecoveryException InvalidRecoveryRecord() =>
    new("recovery_record_format_invalid");

  private static AllowedScheduledTask Validate(AllowedScheduledTaskOptions task)
  {
    var path = task.TaskPath.Trim();
    if (string.IsNullOrWhiteSpace(task.Id)
      || task.Id.Length > 80
      || task.Id.Any(character => !(char.IsAsciiLetterOrDigit(character)
        || character is '.' or '-' or '_'))
      || !path.StartsWith('\\')
      || path.Length > 512
      || path.Contains("..", StringComparison.Ordinal)
      || path.Contains('/')
      || path.StartsWith(ProtectedPrefix, StringComparison.OrdinalIgnoreCase))
    {
      throw new InvalidOperationException(
        "An allowed scheduled task is invalid or part of the trusted supervisor.");
    }

    return new AllowedScheduledTask(
      task.Id,
      path,
      task.AllowRun,
      task.AllowEnableDisable);
  }
}

internal sealed record ScheduledTaskDefinition(
  string Xml,
  bool Enabled,
  string DefinitionSha256,
  string StateSha256,
  long Bytes);

internal sealed record ScheduledTaskEnabledRecoveryRecord(
  [property: System.Text.Json.Serialization.JsonPropertyName("contract")]
  string Contract,
  [property: System.Text.Json.Serialization.JsonPropertyName("id")]
  string Id,
  [property: System.Text.Json.Serialization.JsonPropertyName("path")]
  string Path,
  [property: System.Text.Json.Serialization.JsonPropertyName("enabled")]
  bool Enabled,
  [property: System.Text.Json.Serialization.JsonPropertyName("definitionXml")]
  string DefinitionXml,
  [property: System.Text.Json.Serialization.JsonPropertyName("definitionSha256")]
  string DefinitionSha256,
  [property: System.Text.Json.Serialization.JsonPropertyName("stateSha256")]
  string StateSha256);

internal static class ScheduledTaskSupport
{
  public const long EnabledStateEffectBytes = 1;

  public static async ValueTask<ScheduledTaskDefinition> ReadAsync(
    GovernedSystemToolRunner runner,
    AllowedScheduledTask task,
    CancellationToken cancellationToken)
  {
    var result = await runner.RunAsync(
      GovernedSystemTool.ScheduledTasks,
      ["/Query", "/TN", task.Path, "/XML", "ONE"],
      1_048_576,
      cancellationToken).ConfigureAwait(false);
    if (result.ExitCode != 0)
    {
      throw new HostPreconditionException("scheduled_task_query_failed");
    }

    var xml = result.StandardOutput.TrimStart('\uFEFF', '\r', '\n', ' ');
    return ParseDefinition(xml);
  }

  public static ScheduledTaskDefinition ParseDefinition(string xml)
  {
    try
    {
      if (Encoding.Unicode.GetByteCount(xml) > 1_048_576)
      {
        throw new HostPreconditionException("scheduled_task_definition_too_large");
      }

      using var text = new StringReader(xml);
      using var reader = XmlReader.Create(text, new XmlReaderSettings
      {
        DtdProcessing = DtdProcessing.Prohibit,
        XmlResolver = null,
        MaxCharactersInDocument = 524_288,
        IgnoreComments = false,
      });
      var document = XDocument.Load(reader, LoadOptions.PreserveWhitespace);
      var enabledNode = document.Descendants()
        .SingleOrDefault(element => element.Name.LocalName == "Enabled");
      var enabled = enabledNode is null || enabledNode.Value.Trim() switch
      {
        var value when string.Equals(value, "true", StringComparison.OrdinalIgnoreCase) => true,
        var value when string.Equals(value, "false", StringComparison.OrdinalIgnoreCase) => false,
        _ => throw new HostPreconditionException("scheduled_task_definition_invalid"),
      };
      var definitionSha256 = PayloadDigest.Sha256Hex(xml);
      return new ScheduledTaskDefinition(
        xml,
        enabled,
        definitionSha256,
        StateSha256(enabled, definitionSha256),
        Encoding.Unicode.GetByteCount(xml));
    }
    catch (HostPreconditionException)
    {
      throw;
    }
    catch (Exception exception) when (exception is not OperationCanceledException)
    {
      throw new HostPreconditionException("scheduled_task_definition_invalid");
    }
  }

  public static string StateSha256(bool enabled, string definitionSha256)
  {
    if (!PayloadDigest.IsSha256Hex(definitionSha256))
    {
      throw new ArgumentException(
        "Scheduled task definition digest must be SHA-256.",
        nameof(definitionSha256));
    }

    return PayloadDigest.Sha256Hex(
      $"windows-scheduled-task-state/v2\n{(enabled ? "enabled" : "disabled")}\n{definitionSha256}");
  }

  public static async ValueTask SetEnabledAsync(
    GovernedSystemToolRunner runner,
    AllowedScheduledTask task,
    bool enabled,
    CancellationToken cancellationToken)
  {
    var result = await runner.RunAsync(
      GovernedSystemTool.ScheduledTasks,
      ["/Change", "/TN", task.Path, enabled ? "/ENABLE" : "/DISABLE"],
      65_536,
      cancellationToken).ConfigureAwait(false);
    if (result.ExitCode != 0)
    {
      throw new InvalidOperationException("scheduled_task_change_failed");
    }
  }

  public static async ValueTask RunAsync(
    GovernedSystemToolRunner runner,
    AllowedScheduledTask task,
    CancellationToken cancellationToken)
  {
    var result = await runner.RunAsync(
      GovernedSystemTool.ScheduledTasks,
      ["/Run", "/TN", task.Path],
      65_536,
      cancellationToken).ConfigureAwait(false);
    if (result.ExitCode != 0)
    {
      throw new InvalidOperationException("scheduled_task_run_failed");
    }
  }
}

internal sealed class ScheduledTaskDefinitionReadCapabilityAdapter(
  ScheduledTaskPolicy policy,
  GovernedSystemToolRunner runner) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = ScheduledTaskSchemas.Descriptor(
    "scheduled-task.definition.read",
    "Read approved scheduled task metadata",
    "Reads secret-free enabled state and digests for one supervisor-approved scheduled task.",
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    ScheduledTaskSchemas.TargetArguments,
    ScheduledTaskSchemas.DefinitionResult,
    ["windows-task-scheduler"],
    ScheduledTaskSchemas.MetadataCapabilityVersion);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    ScheduledTaskSchemas.ValidateTarget(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    ScheduledTaskSchemas.ValidateDefinitionResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var target = policy.Resolve(arguments);
    var definition = await ScheduledTaskSupport.ReadAsync(runner, target, cancellationToken)
      .ConfigureAwait(false);
    return Result(target, definition, mutation: false);
  }

  internal static CapabilityExecutionResult Result(
    AllowedScheduledTask target,
    ScheduledTaskDefinition definition,
    bool mutation,
    HostRecoveryReceipt? recovery = null,
    string? preState = null,
    long priorReadBytes = 0)
  {
    ArgumentOutOfRangeException.ThrowIfNegative(priorReadBytes);
    var output = JsonSerializer.Serialize(new
    {
      enabled = definition.Enabled,
      definitionSha256 = definition.DefinitionSha256,
      stateSha256 = definition.StateSha256,
    });
    var provenance = new List<DataProvenance>
    {
      new(
        "windows-task-scheduler",
        PayloadDigest.Sha256Hex(target.Id),
        definition.StateSha256,
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
      PreStateSha256: preState ?? definition.StateSha256,
      RecoveryProvenanceSha256: recovery?.RecordSha256,
      LocalBytesRead: checked(definition.Bytes + priorReadBytes),
      LocalBytesWritten: mutation ? ScheduledTaskSupport.EnabledStateEffectBytes : 0);
  }
}

internal sealed class ScheduledTaskEnabledSetCapabilityAdapter(
  ScheduledTaskPolicy policy,
  IHostRecoveryVault recoveryVault,
  GovernedSystemToolRunner runner) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = ScheduledTaskSchemas.Descriptor(
    "scheduled-task.enabled.set",
    "Enable or disable approved scheduled task",
    "Changes the enabled flag of one approved scheduled task after snapshotting its XML.",
    CapabilityEffect.Administrative,
    RecoveryKind.Snapshot,
    ScheduledTaskSchemas.EnableArguments,
    ScheduledTaskSchemas.DefinitionResult,
    ["windows-task-scheduler", "host-recovery-record"],
    ScheduledTaskSchemas.MetadataCapabilityVersion);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    ScheduledTaskSchemas.ValidateEnable(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    ScheduledTaskSchemas.ValidateDefinitionResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var target = policy.Resolve(arguments, requireEnable: true);
    var before = await ScheduledTaskSupport.ReadAsync(runner, target, cancellationToken)
      .ConfigureAwait(false);
    RegistryValueSetCapabilityAdapter.MatchExpected(context, before.StateSha256);
    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      before.StateSha256,
      CreateRecoveryRecord(target, before),
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    var enabled = arguments.GetProperty("enabled").GetBoolean();
    await ScheduledTaskSupport.SetEnabledAsync(runner, target, enabled, cancellationToken)
      .ConfigureAwait(false);
    var after = await ScheduledTaskSupport.ReadAsync(runner, target, cancellationToken)
      .ConfigureAwait(false);
    if (after.Enabled != enabled)
    {
      throw new InvalidOperationException("scheduled_task_change_not_observed");
    }

    return ScheduledTaskDefinitionReadCapabilityAdapter.Result(
      target,
      after,
      mutation: true,
      recovery,
      before.StateSha256,
      before.Bytes);
  }

  internal static ScheduledTaskEnabledRecoveryRecord CreateRecoveryRecord(
    AllowedScheduledTask target,
    ScheduledTaskDefinition definition) => new(
      ScheduledTaskSchemas.RecoveryRecordContract,
      target.Id,
      target.Path,
      definition.Enabled,
      definition.Xml,
      definition.DefinitionSha256,
      definition.StateSha256);
}

internal sealed class ScheduledTaskRunCapabilityAdapter(
  ScheduledTaskPolicy policy,
  IHostRecoveryVault recoveryVault,
  GovernedSystemToolRunner runner) : IHostCapabilityAdapter
{
  internal const string CapabilityId = "scheduled-task.run";

  public CapabilityDescriptor Descriptor { get; } = ScheduledTaskSchemas.Descriptor(
    CapabilityId,
    "Run approved scheduled task",
    "Dispatches one approved scheduled task; downstream effects are explicitly unknown.",
    CapabilityEffect.Irreversible,
    RecoveryKind.Irreversible,
    ScheduledTaskSchemas.TargetArguments,
    ScheduledTaskSchemas.RunResult,
    ["windows-task-scheduler", "host-recovery-record"],
    ScheduledTaskSchemas.RunCapabilityVersion);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    ScheduledTaskSchemas.ValidateTarget(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    ScheduledTaskSchemas.ValidateRunResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var target = policy.Resolve(arguments, requireRun: true);
    var before = await ScheduledTaskSupport.ReadAsync(runner, target, cancellationToken)
      .ConfigureAwait(false);
    RegistryValueSetCapabilityAdapter.MatchExpected(context, before.StateSha256);
    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      before.StateSha256,
      new { target.Id, target.Path, before.StateSha256, note = "irreversible_dispatch" },
      irreversible: true,
      cancellationToken).ConfigureAwait(false);
    await ScheduledTaskSupport.RunAsync(runner, target, cancellationToken)
      .ConfigureAwait(false);
    var output = JsonSerializer.Serialize(new
    {
      dispatched = true,
      definitionSha256 = before.DefinitionSha256,
    });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: true,
      OutcomeUncertain: true,
      Provenance:
      [
        new DataProvenance(
          "windows-task-scheduler",
          PayloadDigest.Sha256Hex(target.Id),
          before.StateSha256,
          ProvenanceTrust.TrustedSystem,
          DateTimeOffset.UtcNow),
        RegistryValueSetCapabilityAdapter.RecoveryProvenance(recovery),
      ],
      OpaqueRecoveryHandle: recovery.OpaqueHandle,
      PreStateSha256: before.StateSha256,
      RecoveryProvenanceSha256: recovery.RecordSha256,
      LocalBytesRead: before.Bytes);
  }
}
