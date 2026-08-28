using System.Runtime.InteropServices;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

/// <summary>
/// Read-only example that reports coarse runtime status and no user content.
/// </summary>
public sealed class SystemStatusCapabilityAdapter : IHostCapabilityAdapter
{
  private static readonly JsonElement EmptyObjectSchema = ParseSchema(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
    """);

  private static readonly JsonElement StatusResultSchema = ParseSchema(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "osDescription": { "type": "string" },
        "osArchitecture": { "type": "string" },
        "processArchitecture": { "type": "string" },
        "frameworkDescription": { "type": "string" }
      },
      "required": ["osDescription", "osArchitecture", "processArchitecture", "frameworkDescription"],
      "additionalProperties": false
    }
    """);

  public CapabilityDescriptor Descriptor { get; } = new(
    Id: "system.runtime-status.read",
    Version: "1.0.0",
    DisplayName: "Read runtime status",
    Description: "Returns coarse OS and runtime versions without inspecting user data.",
    DataClass: CapabilityDataClass.Internal,
    Effect: CapabilityEffect.LocalRead,
    Consent: ConsentRequirement.SignedMandate,
    Recovery: RecoveryKind.NotApplicable,
    RequiredPrivilege: RequiredPrivilege.StandardUser,
    Idempotency: IdempotencySemantics.Required,
    SupportedOperatingSystems: ["windows-11-x64"],
    ArgumentsSchema: EmptyObjectSchema,
    ResultSchema: StatusResultSchema,
    ProvenanceOutputs: ["operating-system-runtime"],
    TouchesTrustedRoot: false);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    arguments.ValueKind == JsonValueKind.Object && !arguments.EnumerateObject().Any()
      ? CapabilityArgumentValidation.Success
      : CapabilityArgumentValidation.Invalid(
        "arguments_schema_invalid",
        "This capability accepts an empty object only.");

  public CapabilityArgumentValidation ValidateResult(JsonElement result)
  {
    var expected = new HashSet<string>(StringComparer.Ordinal)
    {
      "osDescription",
      "osArchitecture",
      "processArchitecture",
      "frameworkDescription",
    };
    if (result.ValueKind != JsonValueKind.Object)
    {
      return CapabilityArgumentValidation.Invalid("result_schema_invalid", "Result must be an object.");
    }

    foreach (var property in result.EnumerateObject())
    {
      if (!expected.Remove(property.Name) || property.Value.ValueKind != JsonValueKind.String)
      {
        return CapabilityArgumentValidation.Invalid(
          "result_schema_invalid",
          "Runtime status result did not match its declared schema.");
      }
    }

    return expected.Count == 0
      ? CapabilityArgumentValidation.Success
      : CapabilityArgumentValidation.Invalid(
        "result_schema_invalid",
        "Runtime status result omitted a required field.");
  }

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var output = JsonSerializer.Serialize(new
    {
      osDescription = RuntimeInformation.OSDescription,
      osArchitecture = RuntimeInformation.OSArchitecture.ToString(),
      processArchitecture = RuntimeInformation.ProcessArchitecture.ToString(),
      frameworkDescription = RuntimeInformation.FrameworkDescription,
    });

    return ValueTask.FromResult(new CapabilityExecutionResult(
      OutputJson: output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance:
      [
        new DataProvenance(
          SourceType: "operating-system-runtime",
          SourceIdentifierHash: PayloadDigest.Sha256Hex("local-os"),
          ContentSha256: PayloadDigest.Sha256Hex(output),
          Trust: ProvenanceTrust.TrustedSystem,
          ObservedAt: DateTimeOffset.UtcNow),
      ]));
  }

  private static JsonElement ParseSchema(string json)
  {
    using var document = JsonDocument.Parse(json);
    return document.RootElement.Clone();
  }
}
