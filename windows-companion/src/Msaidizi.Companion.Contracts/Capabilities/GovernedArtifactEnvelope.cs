using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Contracts.Capabilities;

public sealed record GovernedArtifactDescriptor(
  string TaskId,
  string PlanVersionId,
  string TargetStepId,
  string DeviceId,
  string SourceStepId,
  string SourceAttemptId,
  string ArtifactId,
  string Sha256,
  int ByteSize,
  string MimeType,
  string Name,
  string Kind,
  string DataClass,
  string ScopeSha256);

/// <summary>
/// Value-carrying artifact envelope accepted only inside one broker-signed
/// action. It is intentionally small enough for the existing authenticated
/// command and egress-supervisor frames. Every consumer decodes and rehashes
/// the bytes before use; no path or remote URL is accepted as authority.
/// </summary>
public static class GovernedArtifactEnvelope
{
  public const int SchemaVersion = 1;
  public const int MaximumContentBytes = 128 * 1024;
  public const int MaximumContentBase64Characters =
    ((MaximumContentBytes + 2) / 3) * 4;

  private static readonly string[] Fields =
  [
    "schemaVersion",
    "taskId",
    "planVersionId",
    "targetStepId",
    "deviceId",
    "sourceStepId",
    "sourceAttemptId",
    "artifactId",
    "sha256",
    "byteSize",
    "mimeType",
    "name",
    "kind",
    "dataClass",
    "scopeSha256",
    "contentBase64",
  ];

  private static readonly HashSet<string> Kinds = new(StringComparer.Ordinal)
  {
    "FILE",
    "SCREENSHOT",
    "REPORT",
    "AUDIO",
    "DOCUMENT",
    "OTHER",
  };

  public static bool TryDecode(
    JsonElement value,
    ActionExecutionContext? context,
    string? requiredKind,
    out GovernedArtifactDescriptor descriptor,
    out byte[] content)
  {
    descriptor = null!;
    content = [];
    if (!HasExactly(value, Fields)
      || !value.TryGetProperty("schemaVersion", out var schemaVersion)
      || !schemaVersion.TryGetInt32(out var parsedVersion)
      || parsedVersion != SchemaVersion
      || !CanonicalUuid(value, "taskId", out var taskId)
      || !CanonicalUuid(value, "planVersionId", out var planVersionId)
      || !CanonicalUuid(value, "targetStepId", out var targetStepId)
      || !CanonicalUuid(value, "deviceId", out var deviceId)
      || !CanonicalUuid(value, "sourceStepId", out var sourceStepId)
      || !SafeAttempt(value, "sourceAttemptId", out var sourceAttemptId)
      || !CanonicalUuid(value, "artifactId", out var artifactId)
      || !CanonicalSha256(value, "sha256", out var sha256)
      || !value.TryGetProperty("byteSize", out var byteSizeValue)
      || !byteSizeValue.TryGetInt32(out var byteSize)
      || byteSize is < 1 or > MaximumContentBytes
      || !SafeMimeType(value, "mimeType", out var mimeType)
      || !SafeFileName(value, "name", out var name)
      || !SafeBoundedString(value, "kind", 1, 32, out var kind)
      || !Kinds.Contains(kind)
      || (requiredKind is not null && !string.Equals(kind, requiredKind, StringComparison.Ordinal))
      || !SafeDataClass(value, out var dataClass)
      || !CanonicalSha256(value, "scopeSha256", out var scopeSha256)
      || !value.TryGetProperty("contentBase64", out var encodedValue)
      || encodedValue.ValueKind != JsonValueKind.String
      || encodedValue.GetString() is not { } encoded
      || encoded.Length != ((byteSize + 2) / 3) * 4
      || encoded.Length > MaximumContentBase64Characters)
    {
      return false;
    }

    if (context is not null
      && (!string.Equals(taskId, context.TaskId, StringComparison.Ordinal)
        || !string.Equals(planVersionId, context.PlanVersionId, StringComparison.Ordinal)
        || !string.Equals(targetStepId, context.StepId, StringComparison.Ordinal)
        || !string.Equals(deviceId, context.DeviceId, StringComparison.Ordinal)))
    {
      return false;
    }

    var expectedScope = ScopeSha256(
      taskId,
      planVersionId,
      targetStepId,
      deviceId,
      sourceStepId,
      sourceAttemptId,
      artifactId,
      sha256,
      byteSize,
      mimeType,
      name,
      kind,
      dataClass);
    if (!PayloadDigest.FixedTimeEqualsHex(scopeSha256, expectedScope))
    {
      return false;
    }

    try
    {
      content = Convert.FromBase64String(encoded);
      if (content.Length != byteSize
        || !string.Equals(Convert.ToBase64String(content), encoded, StringComparison.Ordinal)
        || !PayloadDigest.FixedTimeEqualsHex(
          sha256,
          Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant()))
      {
        CryptographicOperations.ZeroMemory(content);
        content = [];
        return false;
      }
    }
    catch (FormatException)
    {
      content = [];
      return false;
    }

    descriptor = new GovernedArtifactDescriptor(
      taskId,
      planVersionId,
      targetStepId,
      deviceId,
      sourceStepId,
      sourceAttemptId,
      artifactId,
      sha256,
      byteSize,
      mimeType,
      name,
      kind,
      dataClass,
      scopeSha256);
    return true;
  }

  public static string ScopeSha256(GovernedArtifactDescriptor descriptor) => ScopeSha256(
    descriptor.TaskId,
    descriptor.PlanVersionId,
    descriptor.TargetStepId,
    descriptor.DeviceId,
    descriptor.SourceStepId,
    descriptor.SourceAttemptId,
    descriptor.ArtifactId,
    descriptor.Sha256,
    descriptor.ByteSize,
    descriptor.MimeType,
    descriptor.Name,
    descriptor.Kind,
    descriptor.DataClass);

  public static string ScopeSha256(
    string taskId,
    string planVersionId,
    string targetStepId,
    string deviceId,
    string sourceStepId,
    string sourceAttemptId,
    string artifactId,
    string sha256,
    int byteSize,
    string mimeType,
    string name,
    string kind,
    string dataClass) => PayloadDigest.Sha256Hex(string.Join("\n",
      "itemba-governed-artifact-envelope/v1",
      taskId,
      planVersionId,
      targetStepId,
      deviceId,
      sourceStepId,
      sourceAttemptId,
      artifactId,
      sha256,
      byteSize.ToString(System.Globalization.CultureInfo.InvariantCulture),
      mimeType.Normalize(NormalizationForm.FormC),
      name.Normalize(NormalizationForm.FormC),
      kind,
      dataClass));

  private static bool HasExactly(JsonElement value, IReadOnlyCollection<string> fields)
  {
    if (value.ValueKind != JsonValueKind.Object)
    {
      return false;
    }
    var names = value.EnumerateObject().Select(property => property.Name).ToArray();
    return names.Distinct(StringComparer.Ordinal).Count() == names.Length
      && names.Length == fields.Count
      && names.All(name => fields.Contains(name, StringComparer.Ordinal));
  }

  private static bool CanonicalUuid(JsonElement value, string name, out string parsed)
  {
    parsed = string.Empty;
    if (!value.TryGetProperty(name, out var candidate)
      || candidate.ValueKind != JsonValueKind.String
      || candidate.GetString() is not { } text
      || !Guid.TryParseExact(text, "D", out var id)
      || !string.Equals(id.ToString("D"), text, StringComparison.Ordinal))
    {
      return false;
    }
    parsed = text;
    return true;
  }

  private static bool CanonicalSha256(JsonElement value, string name, out string parsed)
  {
    parsed = string.Empty;
    if (!value.TryGetProperty(name, out var candidate)
      || candidate.ValueKind != JsonValueKind.String
      || candidate.GetString() is not { } text
      || !PayloadDigest.IsSha256Hex(text)
      || !string.Equals(text, text.ToLowerInvariant(), StringComparison.Ordinal))
    {
      return false;
    }
    parsed = text;
    return true;
  }

  private static bool SafeAttempt(JsonElement value, string name, out string parsed)
  {
    if (!SafeBoundedString(value, name, 1, 200, out parsed))
    {
      return false;
    }
    return parsed.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '_' or ':' or '-');
  }

  private static bool SafeMimeType(JsonElement value, string name, out string parsed)
  {
    if (!SafeBoundedString(value, name, 3, 127, out parsed)
      || parsed.Count(character => character == '/') != 1)
    {
      return false;
    }
    return parsed.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '/' or '.' or '+' or '_' or '-');
  }

  private static bool SafeFileName(JsonElement value, string name, out string parsed)
  {
    if (!SafeBoundedString(value, name, 1, 255, out parsed)
      || !char.IsAsciiLetterOrDigit(parsed[0])
      || parsed[^1] is ' ' or '.')
    {
      return false;
    }
    return parsed.All(character => char.IsAsciiLetterOrDigit(character)
      || character is ' ' or '.' or '_' or '(' or ')' or '-');
  }

  private static bool SafeDataClass(JsonElement value, out string parsed)
  {
    if (!SafeBoundedString(value, "dataClass", 1, 64, out parsed))
    {
      return false;
    }
    return parsed.All(character => !char.IsControl(character));
  }

  private static bool SafeBoundedString(
    JsonElement value,
    string name,
    int minimum,
    int maximum,
    out string parsed)
  {
    parsed = string.Empty;
    if (!value.TryGetProperty(name, out var candidate)
      || candidate.ValueKind != JsonValueKind.String
      || candidate.GetString() is not { } text
      || text.Length < minimum
      || text.Length > maximum)
    {
      return false;
    }
    parsed = text;
    return true;
  }
}
