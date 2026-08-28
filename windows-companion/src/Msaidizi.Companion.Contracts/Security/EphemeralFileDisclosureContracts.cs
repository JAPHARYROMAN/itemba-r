using System.Buffers;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Itemba.Msaidizi.Companion.Contracts.Security;

/// <summary>
/// Metadata-only wire contract reserved for a future single-session file-to-provider
/// disclosure channel. It is deliberately not a companion capability result.
/// </summary>
public static class EphemeralFileDisclosureContract
{
  public const string CapabilityId = "filesystem.file.disclose.ephemeral";
  public const string CapabilityVersion = "1.0.0";
  public const string Protocol = "msaidizi-ephemeral-file-disclosure/v1";
  public const string ReceiptProtocol = "msaidizi-ephemeral-file-disclosure-receipt/v1";
  public const int NonceBytes = 32;
  public const int MaximumBytes = 512 * 1024;
  public static readonly TimeSpan MaximumLifetime = TimeSpan.FromSeconds(120);

  public static IReadOnlySet<string> AllowedMimeTypes { get; } = new HashSet<string>(
  [
    "application/json",
    "application/pdf",
    "text/csv",
    "text/markdown",
    "text/plain",
  ], StringComparer.Ordinal);
}

public sealed record EphemeralFileDisclosureGrantV1(
  string ActionId,
  IReadOnlyList<string> AllowedMimeTypes,
  string ArgumentsSha256,
  string Capability,
  string CapabilityVersion,
  string DeviceId,
  string ExpectedFileIdentitySha256,
  string ExpectedPreStateSha256,
  string ExpiresAt,
  string IdempotencyKey,
  int IssuanceGeneration,
  string MandateId,
  int MaximumBytes,
  string Nonce,
  string PlanVersionId,
  string Protocol,
  string ProviderContractArtifactSha256,
  string ProviderModelId,
  string RelativePathSha256,
  string RootId,
  string StepId,
  string TaskId);

public sealed record EphemeralFileDisclosureExpectedBinding(
  string ActionId,
  IReadOnlyList<string> AllowedMimeTypes,
  string ArgumentsSha256,
  string Capability,
  string CapabilityVersion,
  string DeviceId,
  string ExpectedFileIdentitySha256,
  string ExpectedPreStateSha256,
  string ExpiresAt,
  string IdempotencyKey,
  int IssuanceGeneration,
  string MandateId,
  int MaximumBytes,
  string Nonce,
  string PlanVersionId,
  string ProviderContractArtifactSha256,
  string ProviderModelId,
  string RelativePathSha256,
  string RootId,
  string StepId,
  string TaskId);

/// <summary>
/// Permitted durable evidence contains digests and counters only. File bytes,
/// decoded text, raw paths, prompts and model responses are not contract fields.
/// </summary>
public sealed record EphemeralFileDisclosureReceiptV1(
  string Protocol,
  string ActionId,
  string TaskId,
  string PlanVersionId,
  string StepId,
  string DeviceId,
  string NonceSha256,
  string ContentSha256,
  int ContentBytes,
  string MimeType,
  string ProviderContractArtifactSha256,
  string ProviderRequestSha256,
  string Outcome);

public sealed class EphemeralFileDisclosureProtocolException(
  string code,
  string message) : Exception($"{code}: {message}")
{
  public string Code { get; } = code;
}

public static class EphemeralFileDisclosureProtocol
{
  private static readonly string[] GrantFields =
  [
    "actionId",
    "allowedMimeTypes",
    "argumentsSha256",
    "capability",
    "capabilityVersion",
    "deviceId",
    "expectedFileIdentitySha256",
    "expectedPreStateSha256",
    "expiresAt",
    "idempotencyKey",
    "issuanceGeneration",
    "mandateId",
    "maximumBytes",
    "nonce",
    "planVersionId",
    "protocol",
    "providerContractArtifactSha256",
    "providerModelId",
    "relativePathSha256",
    "rootId",
    "stepId",
    "taskId",
  ];

  public static EphemeralFileDisclosureGrantV1 ParseAndAuthorize(
    ReadOnlySpan<byte> utf8Json,
    EphemeralFileDisclosureExpectedBinding expected,
    DateTimeOffset now)
  {
    ArgumentNullException.ThrowIfNull(expected);
    EphemeralFileDisclosureGrantV1 grant;
    try
    {
      var reader = new Utf8JsonReader(utf8Json, new JsonReaderOptions
      {
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = 8,
      });
      using var document = JsonDocument.ParseValue(ref reader);
      grant = ParseExact(document.RootElement);
    }
    catch (JsonException)
    {
      throw Error("EPHEMERAL_FILE_GRANT_INVALID", "grant must be strict JSON");
    }

    if (!utf8Json.SequenceEqual(CanonicalBytes(grant)))
    {
      throw Error(
        "EPHEMERAL_FILE_GRANT_NONCANONICAL",
        "grant bytes must equal the canonical v1 representation");
    }

    AssertBinding(grant, expected);
    var expiry = DateTimeOffset.ParseExact(
      grant.ExpiresAt,
      "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
      CultureInfo.InvariantCulture,
      DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
    if (expiry <= now)
    {
      throw Error("EPHEMERAL_FILE_GRANT_EXPIRED", "grant has expired");
    }
    if (expiry - now > EphemeralFileDisclosureContract.MaximumLifetime)
    {
      throw Error(
        "EPHEMERAL_FILE_GRANT_LIFETIME_INVALID",
        "grant lifetime exceeds 120 seconds");
    }
    return grant;
  }

  public static byte[] CanonicalBytes(EphemeralFileDisclosureGrantV1 value)
  {
    ArgumentNullException.ThrowIfNull(value);
    var output = new ArrayBufferWriter<byte>();
    using (var writer = new Utf8JsonWriter(output, new JsonWriterOptions
    {
      Indented = false,
      SkipValidation = false,
    }))
    {
      writer.WriteStartObject();
      writer.WriteString("actionId", value.ActionId);
      writer.WritePropertyName("allowedMimeTypes");
      writer.WriteStartArray();
      foreach (var mimeType in value.AllowedMimeTypes)
      {
        writer.WriteStringValue(mimeType);
      }
      writer.WriteEndArray();
      writer.WriteString("argumentsSha256", value.ArgumentsSha256);
      writer.WriteString("capability", value.Capability);
      writer.WriteString("capabilityVersion", value.CapabilityVersion);
      writer.WriteString("deviceId", value.DeviceId);
      writer.WriteString("expectedFileIdentitySha256", value.ExpectedFileIdentitySha256);
      writer.WriteString("expectedPreStateSha256", value.ExpectedPreStateSha256);
      writer.WriteString("expiresAt", value.ExpiresAt);
      writer.WriteString("idempotencyKey", value.IdempotencyKey);
      writer.WriteNumber("issuanceGeneration", value.IssuanceGeneration);
      writer.WriteString("mandateId", value.MandateId);
      writer.WriteNumber("maximumBytes", value.MaximumBytes);
      writer.WriteString("nonce", value.Nonce);
      writer.WriteString("planVersionId", value.PlanVersionId);
      writer.WriteString("protocol", value.Protocol);
      writer.WriteString(
        "providerContractArtifactSha256",
        value.ProviderContractArtifactSha256);
      writer.WriteString("providerModelId", value.ProviderModelId);
      writer.WriteString("relativePathSha256", value.RelativePathSha256);
      writer.WriteString("rootId", value.RootId);
      writer.WriteString("stepId", value.StepId);
      writer.WriteString("taskId", value.TaskId);
      writer.WriteEndObject();
    }
    return output.WrittenSpan.ToArray();
  }

  public static string CanonicalJson(EphemeralFileDisclosureGrantV1 value) =>
    Encoding.UTF8.GetString(CanonicalBytes(value));

  public static string Sha256(EphemeralFileDisclosureGrantV1 value) =>
    Convert.ToHexString(SHA256.HashData(CanonicalBytes(value)));

  private static EphemeralFileDisclosureGrantV1 ParseExact(JsonElement root)
  {
    if (root.ValueKind != JsonValueKind.Object)
    {
      throw Error("EPHEMERAL_FILE_GRANT_INVALID", "grant must be an object");
    }
    var seen = new HashSet<string>(StringComparer.Ordinal);
    foreach (var property in root.EnumerateObject())
    {
      if (!seen.Add(property.Name))
      {
        throw Error("EPHEMERAL_FILE_GRANT_SHAPE_INVALID", "duplicate grant field");
      }
    }
    if (seen.Count != GrantFields.Length || GrantFields.Any(field => !seen.Contains(field)))
    {
      throw Error(
        "EPHEMERAL_FILE_GRANT_SHAPE_INVALID",
        "grant fields do not match the v1 contract");
    }

    var mimeElement = root.GetProperty("allowedMimeTypes");
    if (mimeElement.ValueKind != JsonValueKind.Array)
    {
      throw Error("EPHEMERAL_FILE_GRANT_MIME_INVALID", "allowed MIME types must be an array");
    }
    var mimeTypes = mimeElement.EnumerateArray().Select(item => RequiredStringValue(
      item,
      "allowedMimeTypes")).ToArray();
    if (mimeTypes.Length is <= 0
      || mimeTypes.Length > EphemeralFileDisclosureContract.AllowedMimeTypes.Count
      || !mimeTypes.SequenceEqual(mimeTypes.Order(StringComparer.Ordinal), StringComparer.Ordinal)
      || mimeTypes.Distinct(StringComparer.Ordinal).Count() != mimeTypes.Length
      || mimeTypes.Any(mime => !EphemeralFileDisclosureContract.AllowedMimeTypes.Contains(mime)))
    {
      throw Error(
        "EPHEMERAL_FILE_GRANT_MIME_INVALID",
        "allowed MIME types must be supported, sorted and unique");
    }

    var maximumBytes = RequiredInt(root, "maximumBytes");
    if (maximumBytes is <= 0 or > EphemeralFileDisclosureContract.MaximumBytes)
    {
      throw Error("EPHEMERAL_FILE_GRANT_SIZE_INVALID", "maximumBytes exceeds 512 KiB");
    }
    var protocol = RequiredString(root, "protocol");
    if (!Exact(protocol, EphemeralFileDisclosureContract.Protocol))
    {
      throw Error("EPHEMERAL_FILE_GRANT_PROTOCOL_INVALID", "unsupported protocol");
    }
    var capability = RequiredString(root, "capability");
    var capabilityVersion = RequiredString(root, "capabilityVersion");
    if (!Exact(capability, EphemeralFileDisclosureContract.CapabilityId)
      || !Exact(capabilityVersion, EphemeralFileDisclosureContract.CapabilityVersion))
    {
      throw Error(
        "EPHEMERAL_FILE_GRANT_CAPABILITY_INVALID",
        "unsupported capability identity");
    }

    return new EphemeralFileDisclosureGrantV1(
      RequiredGuid(root, "actionId"),
      Array.AsReadOnly(mimeTypes),
      RequiredDigest(root, "argumentsSha256"),
      capability,
      capabilityVersion,
      RequiredGuid(root, "deviceId"),
      RequiredDigest(root, "expectedFileIdentitySha256"),
      RequiredDigest(root, "expectedPreStateSha256"),
      RequiredInstant(root, "expiresAt"),
      RequiredSafeString(root, "idempotencyKey", 200),
      RequiredPositiveInt(root, "issuanceGeneration"),
      RequiredGuid(root, "mandateId"),
      maximumBytes,
      RequiredNonce(root, "nonce"),
      RequiredGuid(root, "planVersionId"),
      protocol,
      RequiredDigest(root, "providerContractArtifactSha256"),
      RequiredSafeString(root, "providerModelId", 200),
      RequiredDigest(root, "relativePathSha256"),
      RequiredSafeString(root, "rootId", 64),
      RequiredGuid(root, "stepId"),
      RequiredGuid(root, "taskId"));
  }

  private static void AssertBinding(
    EphemeralFileDisclosureGrantV1 value,
    EphemeralFileDisclosureExpectedBinding expected)
  {
    if (expected.AllowedMimeTypes is null
      || !Exact(value.ActionId, expected.ActionId)
      || !value.AllowedMimeTypes.SequenceEqual(
        expected.AllowedMimeTypes,
        StringComparer.Ordinal)
      || !Digest(value.ArgumentsSha256, expected.ArgumentsSha256)
      || !Exact(value.Capability, expected.Capability)
      || !Exact(value.CapabilityVersion, expected.CapabilityVersion)
      || !Exact(value.DeviceId, expected.DeviceId)
      || !Digest(value.ExpectedFileIdentitySha256, expected.ExpectedFileIdentitySha256)
      || !Digest(value.ExpectedPreStateSha256, expected.ExpectedPreStateSha256)
      || !Exact(value.ExpiresAt, expected.ExpiresAt)
      || !Exact(value.IdempotencyKey, expected.IdempotencyKey)
      || value.IssuanceGeneration != expected.IssuanceGeneration
      || !Exact(value.MandateId, expected.MandateId)
      || value.MaximumBytes != expected.MaximumBytes
      || !Exact(value.Nonce, expected.Nonce)
      || !Exact(value.PlanVersionId, expected.PlanVersionId)
      || !Digest(
        value.ProviderContractArtifactSha256,
        expected.ProviderContractArtifactSha256)
      || !Exact(value.ProviderModelId, expected.ProviderModelId)
      || !Digest(value.RelativePathSha256, expected.RelativePathSha256)
      || !Exact(value.RootId, expected.RootId)
      || !Exact(value.StepId, expected.StepId)
      || !Exact(value.TaskId, expected.TaskId))
    {
      throw Error(
        "EPHEMERAL_FILE_GRANT_BINDING_MISMATCH",
        "grant does not match exact signed authority");
    }
  }

  private static string RequiredGuid(JsonElement root, string name)
  {
    var value = RequiredString(root, name);
    if (value.Length != 36
      || !Guid.TryParseExact(value, "D", out var parsed)
      || !Exact(parsed.ToString("D"), value)
      || value[14] is < '1' or > '5'
      || value[19] is not ('8' or '9' or 'a' or 'b'))
    {
      throw Error("EPHEMERAL_FILE_GRANT_ID_INVALID", $"{name} must be a canonical UUID");
    }
    return value;
  }

  private static string RequiredDigest(JsonElement root, string name)
  {
    var value = RequiredString(root, name);
    if (value.Length != 64 || value.Any(character => character is not (
      >= '0' and <= '9' or >= 'a' and <= 'f')))
    {
      throw Error(
        "EPHEMERAL_FILE_GRANT_DIGEST_INVALID",
        $"{name} must be lowercase SHA-256");
    }
    return value;
  }

  private static string RequiredInstant(JsonElement root, string name)
  {
    var value = RequiredString(root, name);
    if (!DateTimeOffset.TryParseExact(
      value,
      "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
      CultureInfo.InvariantCulture,
      DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
      out var parsed)
      || !Exact(parsed.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture), value))
    {
      throw Error(
        "EPHEMERAL_FILE_GRANT_EXPIRY_INVALID",
        "expiresAt must be a canonical UTC instant");
    }
    return value;
  }

  private static string RequiredNonce(JsonElement root, string name)
  {
    var value = RequiredString(root, name);
    byte[] decoded;
    try
    {
      decoded = Base64Url.Decode(value);
    }
    catch (FormatException)
    {
      throw Error(
        "EPHEMERAL_FILE_GRANT_NONCE_INVALID",
        "nonce must be canonical Base64url");
    }
    try
    {
      var canonical = Convert.ToBase64String(decoded)
        .TrimEnd('=')
        .Replace('+', '-')
        .Replace('/', '_');
      if (decoded.Length != EphemeralFileDisclosureContract.NonceBytes
        || value.Length != 43
        || !Exact(canonical, value))
      {
        throw Error(
          "EPHEMERAL_FILE_GRANT_NONCE_INVALID",
          "nonce must encode exactly 32 bytes");
      }
      return value;
    }
    finally
    {
      CryptographicOperations.ZeroMemory(decoded);
    }
  }

  private static string RequiredSafeString(JsonElement root, string name, int maximumLength)
  {
    var value = RequiredString(root, name);
    if (value.Length is <= 0 || value.Length > maximumLength || value.Any(character =>
      !(char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or ':' or '@' or '/' or '-')))
    {
      throw Error("EPHEMERAL_FILE_GRANT_STRING_INVALID", $"{name} is not canonical");
    }
    return value;
  }

  private static int RequiredPositiveInt(JsonElement root, string name)
  {
    var value = RequiredInt(root, name);
    if (value <= 0)
    {
      throw Error("EPHEMERAL_FILE_GRANT_INTEGER_INVALID", $"{name} must be positive");
    }
    return value;
  }

  private static int RequiredInt(JsonElement root, string name)
  {
    var element = root.GetProperty(name);
    if (element.ValueKind != JsonValueKind.Number || !element.TryGetInt32(out var value))
    {
      throw Error("EPHEMERAL_FILE_GRANT_INTEGER_INVALID", $"{name} must be an integer");
    }
    return value;
  }

  private static string RequiredString(JsonElement root, string name) =>
    RequiredStringValue(root.GetProperty(name), name);

  private static string RequiredStringValue(JsonElement element, string name)
  {
    if (element.ValueKind != JsonValueKind.String || element.GetString() is not { } value)
    {
      throw Error("EPHEMERAL_FILE_GRANT_STRING_INVALID", $"{name} must be a string");
    }
    return value;
  }

  private static bool Exact(string? left, string? right) =>
    string.Equals(left, right, StringComparison.Ordinal);

  private static bool Digest(string? left, string? right) =>
    left is not null
    && right is not null
    && PayloadDigest.FixedTimeEqualsHex(left, right);

  private static EphemeralFileDisclosureProtocolException Error(
    string code,
    string message) => new(code, message);
}

/// <summary>
/// The only production-safe implementation until a durable nonce ledger and an
/// atomic device-to-provider byte stream are provisioned. It never authorizes a read.
/// </summary>
public sealed class RejectingEphemeralFileDisclosurePort
{
  public const string ErrorCode = "REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY";

  public bool Provisioned { get; }

  public void Authorize()
  {
    if (!Provisioned)
    {
      throw new EphemeralFileDisclosureProtocolException(
        ErrorCode,
        "no single-session device-to-provider disclosure transport is provisioned");
    }
    throw new InvalidOperationException("Rejecting disclosure port cannot become provisioned.");
  }
}
