using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal static class GovernedWindowsCapabilitySupport
{
  public static CapabilityDescriptor Descriptor(
    string id,
    string displayName,
    string description,
    CapabilityDataClass dataClass,
    CapabilityEffect effect,
    RecoveryKind recovery,
    string argumentsSchema,
    string resultSchema,
    IReadOnlyList<string> provenanceOutputs,
    string version = "1.0.0") => new(
      Id: id,
      Version: version,
      DisplayName: displayName,
      Description: description,
      DataClass: dataClass,
      Effect: effect,
      Consent: effect is CapabilityEffect.LocalRead
        ? ConsentRequirement.SignedMandate
        : ConsentRequirement.OneShotApproval,
      Recovery: recovery,
      RequiredPrivilege: RequiredPrivilege.LocalSystem,
      Idempotency: IdempotencySemantics.Required,
      SupportedOperatingSystems: ["windows-11-x64"],
      ArgumentsSchema: Parse(argumentsSchema),
      ResultSchema: Parse(resultSchema),
      ProvenanceOutputs: provenanceOutputs,
      TouchesTrustedRoot: false);

  public static JsonElement Parse(string json)
  {
    using var document = JsonDocument.Parse(json);
    return document.RootElement.Clone();
  }

  public static bool Exact(JsonElement value, params string[] expected)
  {
    if (value.ValueKind != JsonValueKind.Object)
    {
      return false;
    }

    var names = value.EnumerateObject().Select(property => property.Name).ToArray();
    return names.Length == expected.Length
      && names.ToHashSet(StringComparer.Ordinal).SetEquals(expected);
  }

  public static bool String(
    JsonElement value,
    string property,
    int minimumLength,
    int maximumLength) =>
    value.TryGetProperty(property, out var candidate)
    && candidate.ValueKind == JsonValueKind.String
    && candidate.GetString() is { } parsed
    && parsed.Length >= minimumLength
    && parsed.Length <= maximumLength;

  public static bool Boolean(JsonElement value, string property) =>
    value.TryGetProperty(property, out var candidate)
    && candidate.ValueKind is JsonValueKind.True or JsonValueKind.False;

  public static bool Integer(
    JsonElement value,
    string property,
    int minimum,
    int maximum) =>
    value.TryGetProperty(property, out var candidate)
    && candidate.TryGetInt32(out var parsed)
    && parsed >= minimum
    && parsed <= maximum;

  public static bool Integer64(
    JsonElement value,
    string property,
    long minimum,
    long maximum) =>
    value.TryGetProperty(property, out var candidate)
    && candidate.TryGetInt64(out var parsed)
    && parsed >= minimum
    && parsed <= maximum;

  public static bool Sha256(JsonElement value, string property) =>
    value.TryGetProperty(property, out var candidate)
    && candidate.ValueKind == JsonValueKind.String
    && candidate.GetString() is { } digest
    && PayloadDigest.IsSha256Hex(digest);

  public static CapabilityArgumentValidation InvalidArguments(string message) =>
    CapabilityArgumentValidation.Invalid("arguments_schema_invalid", message);

  public static CapabilityArgumentValidation InvalidResult(string message) =>
    CapabilityArgumentValidation.Invalid("result_schema_invalid", message);

  public static bool IsSafeId(string value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 80
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_');

  public static bool IsSafeSamName(string value, int maximumLength) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= maximumLength
    && string.Equals(value, value.Trim(), StringComparison.Ordinal)
    && value.All(character => !char.IsControl(character)
      && character is not '"' and not '/' and not '\\' and not '[' and not ']'
        and not ':' and not ';' and not '|' and not '=' and not ',' and not '+'
        and not '*' and not '?' and not '<' and not '>' and not '@');

  public static string StateSha256<T>(T value) =>
    PayloadDigest.Sha256Hex(JsonSerializer.Serialize(value));

  public static long JsonByteCount(string value) => Encoding.UTF8.GetByteCount(value);

  public static DataProvenance Provenance(
    string sourceType,
    string sourceIdentity,
    string stateSha256) => new(
      sourceType,
      PayloadDigest.Sha256Hex(sourceIdentity),
      stateSha256,
      ProvenanceTrust.TrustedSystem,
      DateTimeOffset.UtcNow);
}
