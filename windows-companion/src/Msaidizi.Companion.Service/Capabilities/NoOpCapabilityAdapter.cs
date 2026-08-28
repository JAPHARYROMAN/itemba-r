using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

/// <summary>
/// Safe wiring probe. It performs no host, ERP, network, or external mutation.
/// </summary>
public sealed class NoOpCapabilityAdapter : IHostCapabilityAdapter
{
  private static readonly JsonElement ArgumentsSchema = ParseSchema(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "correlationLabel": { "type": "string", "maxLength": 128 }
      },
      "additionalProperties": false
    }
    """);

  private static readonly JsonElement ResultSchema = ParseSchema(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "status": { "const": "ok" }
      },
      "required": ["status"],
      "additionalProperties": false
    }
    """);

  public CapabilityDescriptor Descriptor { get; } = new(
    Id: "companion.noop",
    Version: "1.0.0",
    DisplayName: "No operation",
    Description: "Verifies governed dispatch without observing or changing the host.",
    DataClass: CapabilityDataClass.Public,
    Effect: CapabilityEffect.Observe,
    Consent: ConsentRequirement.None,
    Recovery: RecoveryKind.NotApplicable,
    RequiredPrivilege: RequiredPrivilege.StandardUser,
    Idempotency: IdempotencySemantics.Required,
    SupportedOperatingSystems: ["windows-11-x64"],
    ArgumentsSchema: ArgumentsSchema,
    ResultSchema: ResultSchema,
    ProvenanceOutputs: ["companion-runtime"],
    TouchesTrustedRoot: false);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments)
  {
    if (arguments.ValueKind != JsonValueKind.Object)
    {
      return CapabilityArgumentValidation.Invalid("arguments_not_object", "Arguments must be an object.");
    }

    foreach (var property in arguments.EnumerateObject())
    {
      if (property.Name != "correlationLabel"
        || property.Value.ValueKind != JsonValueKind.String
        || (property.Value.GetString()?.Length ?? 0) > 128)
      {
        return CapabilityArgumentValidation.Invalid(
          "arguments_schema_invalid",
          "Only an optional correlationLabel string of at most 128 characters is accepted.");
      }
    }

    return CapabilityArgumentValidation.Success;
  }

  public CapabilityArgumentValidation ValidateResult(JsonElement result)
  {
    if (result.ValueKind != JsonValueKind.Object
      || result.EnumerateObject().Count() != 1
      || !result.TryGetProperty("status", out var status)
      || status.ValueKind != JsonValueKind.String
      || status.GetString() != "ok")
    {
      return CapabilityArgumentValidation.Invalid(
        "result_schema_invalid",
        "The no-op result must contain status=ok only.");
    }

    return CapabilityArgumentValidation.Success;
  }

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var output = "{\"status\":\"ok\"}";
    var provenance = new DataProvenance(
      SourceType: "companion-runtime",
      SourceIdentifierHash: PayloadDigest.Sha256Hex(Environment.MachineName),
      ContentSha256: PayloadDigest.Sha256Hex(output),
      Trust: ProvenanceTrust.TrustedSystem,
      ObservedAt: DateTimeOffset.UtcNow);

    return ValueTask.FromResult(new CapabilityExecutionResult(
      OutputJson: output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance: [provenance]));
  }

  private static JsonElement ParseSchema(string json)
  {
    using var document = JsonDocument.Parse(json);
    return document.RootElement.Clone();
  }
}
