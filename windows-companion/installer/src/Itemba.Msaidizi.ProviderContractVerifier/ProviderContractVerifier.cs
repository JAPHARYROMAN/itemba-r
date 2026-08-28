using System.Buffers;
using System.ComponentModel;
using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.ProviderContractVerification;

public sealed record ProviderContractVerificationRequest(
  string AttestationPath,
  string PublicKeyPath,
  string ContractDocumentPath,
  DateTimeOffset RequiredWindowStartUtc,
  DateTimeOffset RequiredWindowEndUtc,
  DateTimeOffset ValidationTimeUtc);

public sealed record ProviderContractVerificationResult(
  int SchemaVersion,
  string Status,
  string Contract,
  string KeyId,
  string SignatureAlgorithm,
  string AttestationArtifactSha256,
  string PublicKeyArtifactSha256,
  string SignerSpkiSha256,
  string ContractDocumentSha256,
  string AttestationId,
  string Provider,
  string ApiOrigin,
  string ApiAccountId,
  string ApiCredentialKeyId,
  IReadOnlyList<string> PermittedModelIds,
  IReadOnlyList<string> CoveredDataClasses,
  bool ZeroTraining,
  int ProviderRetentionSeconds,
  string ImmutableLegalReference,
  string IssuedAt,
  string EffectiveAt,
  string ExpiresAt,
  string RequiredWindowStartUtc,
  string RequiredWindowEndUtc,
  string VerifiedAtUtc);

public sealed class ProviderContractVerificationException : Exception
{
  public ProviderContractVerificationException(string code, string message)
    : base($"{code}: {message}")
  {
    Code = code;
  }

  public ProviderContractVerificationException(string code, string message, Exception innerException)
    : base($"{code}: {message}", innerException)
  {
    Code = code;
  }

  public string Code { get; }
}

public static partial class ProviderContractVerifier
{
  public const string Contract = "msaidizi-provider-contract-attestation/v2";
  public const string SignatureAlgorithm = "ES256";
  public const string Provider = "anthropic";
  public const string ApiOrigin = "https://api.anthropic.com";

  private const int MaximumAttestationBytes = 64 * 1024;
  private const int MaximumPublicKeyBytes = 16 * 1024;
  private const int MaximumContractDocumentBytes = 16 * 1024 * 1024;

  private static readonly byte[] SignatureDomain =
    Encoding.UTF8.GetBytes("ITEMBA\0MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION\0V2\0");

  private static readonly string[] RequiredDataClasses =
  [
    "audio",
    "browser_sessions",
    "business_records",
    "clipboard",
    "credentials",
    "documents",
    "email",
    "financial_data",
    "personal_data",
    "screenshots",
  ];

  private static readonly string[] EnvelopeKeys =
  [
    "claims",
    "contract",
    "keyId",
    "signatureAlgorithm",
    "signatureBase64",
  ];

  private static readonly string[] ClaimKeys =
  [
    "apiAccountId",
    "apiCredentialKeyId",
    "apiOrigin",
    "attestationId",
    "contractDocumentSha256",
    "coveredDataClasses",
    "effectiveAt",
    "expiresAt",
    "immutableLegalReference",
    "issuedAt",
    "permittedModelIds",
    "provider",
    "providerRetentionSeconds",
    "zeroTraining",
  ];

  public static ProviderContractVerificationResult Verify(
    ProviderContractVerificationRequest request)
  {
    ArgumentNullException.ThrowIfNull(request);
    ValidateWindow(request);

    RequireDistinctCanonicalPaths(request);
    using var attestationFile = OpenBoundedFile(
      request.AttestationPath,
      MaximumAttestationBytes,
      "provider-contract attestation");
    using var publicKeyFile = OpenBoundedFile(
      request.PublicKeyPath,
      MaximumPublicKeyBytes,
      "provider-contract public key");
    using var contractDocumentFile = OpenBoundedFile(
      request.ContractDocumentPath,
      MaximumContractDocumentBytes,
      "provider contract document");
    RequireDistinctFileIdentities(attestationFile, publicKeyFile, contractDocumentFile);

    var attestationBytes = attestationFile.Bytes;
    var publicKeyBytes = publicKeyFile.Bytes;
    var contractDocumentBytes = contractDocumentFile.Bytes;

    var attestationSha256 = Sha256(attestationBytes);
    var publicKeySha256 = Sha256(publicKeyBytes);
    var contractDocumentSha256 = Sha256(contractDocumentBytes);

    using var document = ParseCanonicalAttestation(attestationBytes);
    var envelope = document.RootElement;
    RequireExactKeys(envelope, EnvelopeKeys, "attestation envelope");
    RequireString(envelope, "contract", Contract, "PROVIDER_CONTRACT_VERSION_UNSUPPORTED");
    RequireString(
      envelope,
      "signatureAlgorithm",
      SignatureAlgorithm,
      "PROVIDER_CONTRACT_ALGORITHM_INVALID");

    var keyId = RequireBoundedAsciiIdentifier(
      envelope,
      "keyId",
      1,
      128,
      IsIdentifierCharacter);
    var signature = ReadCanonicalSignature(envelope);
    var claims = RequireObject(envelope, "claims");
    RequireExactKeys(claims, ClaimKeys, "provider-contract claims");

    var attestationId = RequireBoundedAsciiIdentifier(
      claims,
      "attestationId",
      1,
      128,
      IsIdentifierCharacter);
    RequireString(claims, "provider", Provider, "PROVIDER_CONTRACT_PROVIDER_INVALID");
    RequireString(claims, "apiOrigin", ApiOrigin, "PROVIDER_CONTRACT_API_ORIGIN_INVALID");
    var apiAccountId = RequireBoundedAsciiIdentifier(
      claims,
      "apiAccountId",
      1,
      256,
      IsAccountOrModelCharacter);
    var apiCredentialKeyId = RequireBoundedAsciiIdentifier(
      claims,
      "apiCredentialKeyId",
      1,
      256,
      IsAccountOrModelCharacter);
    var permittedModels = ReadSortedUniqueAsciiArray(
      claims,
      "permittedModelIds",
      1,
      16,
      IsAccountOrModelCharacter);
    var coveredDataClasses = ReadExactDataClasses(claims);

    if (!claims.TryGetProperty("zeroTraining", out var zeroTraining) ||
        zeroTraining.ValueKind is not JsonValueKind.True)
    {
      Fail("PROVIDER_CONTRACT_TRAINING_NOT_PROHIBITED", "zeroTraining must be true");
    }

    if (!claims.TryGetProperty("providerRetentionSeconds", out var retention) ||
        retention.ValueKind is not JsonValueKind.Number ||
        !retention.TryGetInt32(out var retentionSeconds) ||
        retentionSeconds != 0 ||
        retention.GetRawText() != "0")
    {
      Fail("PROVIDER_CONTRACT_RETENTION_NOT_ZERO", "providerRetentionSeconds must be canonical zero");
    }

    var claimedDocumentSha256 = RequireDigest(claims, "contractDocumentSha256");
    if (!string.Equals(claimedDocumentSha256, contractDocumentSha256, StringComparison.Ordinal))
    {
      Fail(
        "PROVIDER_CONTRACT_DOCUMENT_DIGEST_MISMATCH",
        "Contract document bytes do not match the signed claim");
    }

    var immutableLegalReference = RequireBoundedString(
      claims,
      "immutableLegalReference",
      1,
      2048);
    if (!string.Equals(
          immutableLegalReference,
          $"urn:sha256:{contractDocumentSha256}",
          StringComparison.Ordinal))
    {
      Fail(
        "PROVIDER_CONTRACT_LEGAL_REFERENCE_INVALID",
        "Legal reference must be the content-addressed contract-document digest");
    }

    var issuedAtText = RequireBoundedString(claims, "issuedAt", 24, 24);
    var effectiveAtText = RequireBoundedString(claims, "effectiveAt", 24, 24);
    var expiresAtText = RequireBoundedString(claims, "expiresAt", 24, 24);
    var issuedAt = ParseCanonicalInstant(issuedAtText, "issuedAt");
    var effectiveAt = ParseCanonicalInstant(effectiveAtText, "effectiveAt");
    var expiresAt = ParseCanonicalInstant(expiresAtText, "expiresAt");
    ValidateClaimTimes(issuedAt, effectiveAt, expiresAt, request);

    using var publicKey = ReadP256PublicKey(publicKeyBytes);
    var signerSpkiSha256 = Sha256(publicKey.ExportSubjectPublicKeyInfo());
    var signatureInput = BuildSignatureInput(envelope);
    if (!publicKey.VerifyData(
          signatureInput,
          signature,
          HashAlgorithmName.SHA256,
          DSASignatureFormat.IeeeP1363FixedFieldConcatenation))
    {
      Fail("PROVIDER_CONTRACT_SIGNATURE_INVALID", "Attestation signature is invalid");
    }

    return new ProviderContractVerificationResult(
      SchemaVersion: 2,
      Status: "VERIFIED",
      Contract,
      keyId,
      SignatureAlgorithm,
      attestationSha256,
      publicKeySha256,
      signerSpkiSha256,
      contractDocumentSha256,
      attestationId,
      Provider,
      ApiOrigin,
      apiAccountId,
      apiCredentialKeyId,
      permittedModels,
      coveredDataClasses,
      ZeroTraining: true,
      ProviderRetentionSeconds: 0,
      immutableLegalReference,
      issuedAtText,
      effectiveAtText,
      expiresAtText,
      FormatUtc(request.RequiredWindowStartUtc),
      FormatUtc(request.RequiredWindowEndUtc),
      FormatUtc(request.ValidationTimeUtc));
  }

  internal static byte[] Canonicalize(JsonElement element, string? excludedRootProperty = null)
  {
    var buffer = new ArrayBufferWriter<byte>();
    using (var writer = new Utf8JsonWriter(
             buffer,
             new JsonWriterOptions
             {
               Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
               Indented = false,
               SkipValidation = false,
             }))
    {
      WriteCanonical(element, writer, excludedRootProperty, isRoot: true);
    }

    return buffer.WrittenSpan.ToArray();
  }

  private static JsonDocument ParseCanonicalAttestation(byte[] bytes)
  {
    try
    {
      _ = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true)
        .GetString(bytes);
    }
    catch (DecoderFallbackException exception)
    {
      throw new ProviderContractVerificationException(
        "PROVIDER_CONTRACT_INVALID_UTF8",
        "Attestation must be valid UTF-8",
        exception);
    }

    JsonDocument document;
    try
    {
      document = JsonDocument.Parse(
        bytes,
        new JsonDocumentOptions
        {
          AllowTrailingCommas = false,
          CommentHandling = JsonCommentHandling.Disallow,
          MaxDepth = 32,
        });
    }
    catch (JsonException exception)
    {
      throw new ProviderContractVerificationException(
        "PROVIDER_CONTRACT_INVALID_JSON",
        "Attestation must be valid JSON",
        exception);
    }

    var canonical = Canonicalize(document.RootElement);
    if (!bytes.AsSpan().SequenceEqual(canonical))
    {
      document.Dispose();
      Fail(
        "PROVIDER_CONTRACT_NONCANONICAL_JSON",
        "Attestation bytes must be exact canonical JSON with no trailing data");
    }

    return document;
  }

  private static byte[] BuildSignatureInput(JsonElement envelope)
  {
    var canonicalUnsigned = Canonicalize(envelope, "signatureBase64");
    var input = new byte[SignatureDomain.Length + canonicalUnsigned.Length];
    SignatureDomain.CopyTo(input, 0);
    canonicalUnsigned.CopyTo(input, SignatureDomain.Length);
    return input;
  }

  private static void WriteCanonical(
    JsonElement element,
    Utf8JsonWriter writer,
    string? excludedRootProperty,
    bool isRoot)
  {
    switch (element.ValueKind)
    {
      case JsonValueKind.Object:
        writer.WriteStartObject();
        foreach (var property in element.EnumerateObject().OrderBy(item => item.Name, StringComparer.Ordinal))
        {
          if (isRoot && string.Equals(property.Name, excludedRootProperty, StringComparison.Ordinal))
          {
            continue;
          }

          writer.WritePropertyName(property.Name);
          WriteCanonical(property.Value, writer, excludedRootProperty: null, isRoot: false);
        }

        writer.WriteEndObject();
        break;
      case JsonValueKind.Array:
        writer.WriteStartArray();
        foreach (var item in element.EnumerateArray())
        {
          WriteCanonical(item, writer, excludedRootProperty: null, isRoot: false);
        }

        writer.WriteEndArray();
        break;
      case JsonValueKind.String:
        writer.WriteStringValue(element.GetString());
        break;
      case JsonValueKind.Number:
        WriteCanonicalNumber(element, writer);
        break;
      case JsonValueKind.True:
        writer.WriteBooleanValue(true);
        break;
      case JsonValueKind.False:
        writer.WriteBooleanValue(false);
        break;
      case JsonValueKind.Null:
        writer.WriteNullValue();
        break;
      default:
        Fail("PROVIDER_CONTRACT_SHAPE_INVALID", "Unsupported canonical JSON value");
        break;
    }
  }

  private static void WriteCanonicalNumber(JsonElement element, Utf8JsonWriter writer)
  {
    if (element.TryGetInt64(out var integer))
    {
      writer.WriteNumberValue(integer);
      return;
    }

    if (element.TryGetDecimal(out var decimalValue))
    {
      writer.WriteNumberValue(decimalValue);
      return;
    }

    if (element.TryGetDouble(out var doubleValue) && double.IsFinite(doubleValue))
    {
      writer.WriteNumberValue(doubleValue);
      return;
    }

    Fail("PROVIDER_CONTRACT_SHAPE_INVALID", "Non-finite or unsupported JSON number");
  }

  private static void RequireExactKeys(JsonElement value, string[] expected, string description)
  {
    if (value.ValueKind is not JsonValueKind.Object)
    {
      Fail("PROVIDER_CONTRACT_SHAPE_INVALID", $"{description} must be an object");
    }

    var actual = value.EnumerateObject()
      .Select(property => property.Name)
      .OrderBy(name => name, StringComparer.Ordinal)
      .ToArray();
    var wanted = expected.OrderBy(name => name, StringComparer.Ordinal).ToArray();
    if (!actual.SequenceEqual(wanted, StringComparer.Ordinal))
    {
      Fail(
        "PROVIDER_CONTRACT_SHAPE_INVALID",
        $"{description} contains missing, duplicate, or unknown fields");
    }
  }

  private static JsonElement RequireObject(JsonElement parent, string propertyName)
  {
    if (!parent.TryGetProperty(propertyName, out var value) ||
        value.ValueKind is not JsonValueKind.Object)
    {
      Fail("PROVIDER_CONTRACT_SHAPE_INVALID", $"{propertyName} must be an object");
    }

    return value;
  }

  private static void RequireString(
    JsonElement parent,
    string propertyName,
    string expected,
    string errorCode)
  {
    if (!parent.TryGetProperty(propertyName, out var value) ||
        value.ValueKind is not JsonValueKind.String ||
        !string.Equals(value.GetString(), expected, StringComparison.Ordinal))
    {
      Fail(errorCode, $"{propertyName} must exactly equal {expected}");
    }
  }

  private static string RequireBoundedString(
    JsonElement parent,
    string propertyName,
    int minimumLength,
    int maximumLength)
  {
    if (!parent.TryGetProperty(propertyName, out var value) ||
        value.ValueKind is not JsonValueKind.String)
    {
      Fail("PROVIDER_CONTRACT_FIELD_INVALID", $"{propertyName} must be a string");
    }

    var text = value.GetString() ?? string.Empty;
    if (text.Length < minimumLength ||
        text.Length > maximumLength ||
        !string.Equals(text, text.Trim(), StringComparison.Ordinal))
    {
      Fail("PROVIDER_CONTRACT_FIELD_INVALID", $"{propertyName} is invalid");
    }

    return text;
  }

  private static string RequireBoundedAsciiIdentifier(
    JsonElement parent,
    string propertyName,
    int minimumLength,
    int maximumLength,
    Func<char, bool> allowedCharacter)
  {
    var text = RequireBoundedString(parent, propertyName, minimumLength, maximumLength);
    if (!text.All(allowedCharacter))
    {
      Fail("PROVIDER_CONTRACT_FIELD_INVALID", $"{propertyName} contains unsupported characters");
    }

    return text;
  }

  private static string[] ReadSortedUniqueAsciiArray(
    JsonElement parent,
    string propertyName,
    int minimumCount,
    int maximumCount,
    Func<char, bool> allowedCharacter)
  {
    if (!parent.TryGetProperty(propertyName, out var value) ||
        value.ValueKind is not JsonValueKind.Array)
    {
      Fail("PROVIDER_CONTRACT_FIELD_INVALID", $"{propertyName} must be an array");
    }

    var values = value.EnumerateArray().Select(item =>
    {
      if (item.ValueKind is not JsonValueKind.String)
      {
        Fail("PROVIDER_CONTRACT_FIELD_INVALID", $"{propertyName} must contain strings");
      }

      var text = item.GetString() ?? string.Empty;
      if (text.Length is < 1 or > 200 ||
          !string.Equals(text, text.Trim(), StringComparison.Ordinal) ||
          !text.All(allowedCharacter))
      {
        Fail("PROVIDER_CONTRACT_FIELD_INVALID", $"{propertyName} contains an invalid value");
      }

      return text;
    }).ToArray();

    if (values.Length < minimumCount || values.Length > maximumCount)
    {
      Fail("PROVIDER_CONTRACT_FIELD_INVALID", $"{propertyName} has invalid cardinality");
    }

    var sorted = values.Distinct(StringComparer.Ordinal).OrderBy(item => item, StringComparer.Ordinal).ToArray();
    if (!values.SequenceEqual(sorted, StringComparer.Ordinal))
    {
      Fail("PROVIDER_CONTRACT_FIELD_INVALID", $"{propertyName} must be sorted and unique");
    }

    return values;
  }

  private static string[] ReadExactDataClasses(JsonElement claims)
  {
    var actual = ReadSortedUniqueAsciiArray(
      claims,
      "coveredDataClasses",
      RequiredDataClasses.Length,
      RequiredDataClasses.Length,
      IsAccountOrModelCharacter);
    if (!actual.SequenceEqual(RequiredDataClasses, StringComparer.Ordinal))
    {
      Fail(
        "PROVIDER_CONTRACT_DATA_SCOPE_INCOMPLETE",
        "Contract does not cover every provider data class");
    }

    return actual;
  }

  private static string RequireDigest(JsonElement parent, string propertyName)
  {
    var value = RequireBoundedString(parent, propertyName, 64, 64);
    if (!value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f'))
    {
      Fail(
        "PROVIDER_CONTRACT_DIGEST_INVALID",
        $"{propertyName} must be canonical lowercase SHA-256");
    }

    return value;
  }

  private static byte[] ReadCanonicalSignature(JsonElement envelope)
  {
    var encoded = RequireBoundedString(envelope, "signatureBase64", 1, 512);
    byte[] signature;
    try
    {
      signature = Convert.FromBase64String(encoded);
    }
    catch (FormatException)
    {
      Fail("PROVIDER_CONTRACT_SIGNATURE_INVALID", "Signature is not standard Base64");
      throw;
    }

    if (signature.Length != 64 ||
        !string.Equals(Convert.ToBase64String(signature), encoded, StringComparison.Ordinal))
    {
      Fail(
        "PROVIDER_CONTRACT_SIGNATURE_INVALID",
        "Signature must be canonical 64-byte P1363 ES256");
    }

    return signature;
  }

  private static ECDsa ReadP256PublicKey(byte[] bytes)
  {
    string pem;
    try
    {
      pem = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true)
        .GetString(bytes);
    }
    catch (DecoderFallbackException exception)
    {
      throw new ProviderContractVerificationException(
        "PROVIDER_CONTRACT_PUBLIC_KEY_INVALID",
        "Verification key must be valid UTF-8 PEM",
        exception);
    }

    if (pem.Contains("PRIVATE KEY", StringComparison.Ordinal))
    {
      Fail("PROVIDER_CONTRACT_PUBLIC_KEY_INVALID", "Private-key material is forbidden");
    }

    var key = ECDsa.Create();
    try
    {
      key.ImportFromPem(pem);
      var parameters = key.ExportParameters(includePrivateParameters: false);
      if (key.KeySize != 256 ||
          !string.Equals(parameters.Curve.Oid.Value, "1.2.840.10045.3.1.7", StringComparison.Ordinal))
      {
        Fail(
          "PROVIDER_CONTRACT_PUBLIC_KEY_INVALID",
          "Verification key must be public EC P-256");
      }

      return key;
    }
    catch (ProviderContractVerificationException)
    {
      key.Dispose();
      throw;
    }
    catch (CryptographicException exception)
    {
      key.Dispose();
      throw new ProviderContractVerificationException(
        "PROVIDER_CONTRACT_PUBLIC_KEY_INVALID",
        "Verification key is unreadable",
        exception);
    }
  }

  private static DateTimeOffset ParseCanonicalInstant(string value, string field)
  {
    if (!DateTimeOffset.TryParseExact(
          value,
          "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
          CultureInfo.InvariantCulture,
          DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
          out var parsed) ||
        !string.Equals(
          parsed.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
          value,
          StringComparison.Ordinal))
    {
      Fail(
        "PROVIDER_CONTRACT_TIME_INVALID",
        $"{field} must be an exact millisecond UTC ISO-8601 instant");
    }

    return parsed;
  }

  private static void ValidateClaimTimes(
    DateTimeOffset issuedAt,
    DateTimeOffset effectiveAt,
    DateTimeOffset expiresAt,
    ProviderContractVerificationRequest request)
  {
    if (issuedAt >= expiresAt || effectiveAt >= expiresAt)
    {
      Fail("PROVIDER_CONTRACT_TIME_RANGE_INVALID", "Attestation validity range is incoherent");
    }

    if (request.ValidationTimeUtc < issuedAt || request.ValidationTimeUtc < effectiveAt)
    {
      Fail("PROVIDER_CONTRACT_NOT_YET_VALID", "Provider contract is not yet issued and effective");
    }

    if (request.ValidationTimeUtc >= expiresAt)
    {
      Fail("PROVIDER_CONTRACT_EXPIRED", "Provider contract has expired");
    }

    if (request.RequiredWindowStartUtc < issuedAt ||
        request.RequiredWindowStartUtc < effectiveAt ||
        request.RequiredWindowEndUtc >= expiresAt)
    {
      Fail(
        "PROVIDER_CONTRACT_WINDOW_NOT_COVERED",
        "Provider contract does not cover the complete operational and ring window");
    }
  }

  private static void ValidateWindow(ProviderContractVerificationRequest request)
  {
    if (request.RequiredWindowStartUtc.Offset != TimeSpan.Zero ||
        request.RequiredWindowEndUtc.Offset != TimeSpan.Zero ||
        request.ValidationTimeUtc.Offset != TimeSpan.Zero ||
        request.RequiredWindowStartUtc > request.RequiredWindowEndUtc ||
        request.RequiredWindowEndUtc > request.ValidationTimeUtc)
    {
      Fail(
        "PROVIDER_CONTRACT_VERIFICATION_WINDOW_INVALID",
        "Verification window must be ordered, completed, and expressed in UTC");
    }
  }

  private static void RequireDistinctCanonicalPaths(ProviderContractVerificationRequest request)
  {
    var paths = new[]
    {
      ResolveCanonicalLocalPath(request.AttestationPath, "provider-contract attestation"),
      ResolveCanonicalLocalPath(request.PublicKeyPath, "provider-contract public key"),
      ResolveCanonicalLocalPath(request.ContractDocumentPath, "provider contract document"),
    };
    if (paths.Distinct(StringComparer.OrdinalIgnoreCase).Count() != paths.Length)
    {
      Fail(
        "PROVIDER_CONTRACT_FILE_IDENTITY_INVALID",
        "Attestation, public key, and contract document must use distinct canonical paths");
    }
  }

  private static void RequireDistinctFileIdentities(params LockedInputFile[] files)
  {
    if (files.Select(file => file.Identity).Distinct().Count() != files.Length)
    {
      Fail(
        "PROVIDER_CONTRACT_FILE_IDENTITY_INVALID",
        "Attestation, public key, and contract document must be distinct files");
    }
  }

  private static LockedInputFile OpenBoundedFile(string path, int maximumBytes, string description)
  {
    if (string.IsNullOrWhiteSpace(path))
    {
      Fail("PROVIDER_CONTRACT_FILE_INVALID", $"{description} path is missing");
    }

    FileStream? stream = null;
    try
    {
      var canonicalPath = ResolveCanonicalLocalPath(path, description);
      stream = new FileStream(
        canonicalPath,
        FileMode.Open,
        FileAccess.Read,
        FileShare.Read,
        bufferSize: 4096,
        FileOptions.SequentialScan);
      if (!GetFileInformationByHandle(stream.SafeFileHandle, out var information))
      {
        throw new ProviderContractVerificationException(
          "PROVIDER_CONTRACT_FILE_IDENTITY_INVALID",
          $"{description} file identity is unavailable",
          new Win32Exception(Marshal.GetLastPInvokeError()));
      }

      var openedPath = GetOpenedFinalDosPath(stream.SafeFileHandle, description);
      ValidateOpenedPathIdentity(
        canonicalPath,
        openedPath,
        (FileAttributes)information.FileAttributes,
        description);

      if (information.NumberOfLinks != 1)
      {
        Fail(
          "PROVIDER_CONTRACT_FILE_IDENTITY_INVALID",
          $"{description} must be a single-link file");
      }

      if (stream.Length is < 1 || stream.Length > maximumBytes)
      {
        Fail("PROVIDER_CONTRACT_FILE_INVALID", $"{description} has an invalid size");
      }

      var bytes = new byte[checked((int)stream.Length)];
      stream.ReadExactly(bytes);
      if (stream.ReadByte() != -1)
      {
        Fail("PROVIDER_CONTRACT_FILE_CHANGED", $"{description} changed while it was read");
      }

      if (!GetFileInformationByHandle(stream.SafeFileHandle, out var finalInformation))
      {
        throw new ProviderContractVerificationException(
          "PROVIDER_CONTRACT_FILE_IDENTITY_INVALID",
          $"{description} final file identity is unavailable",
          new Win32Exception(Marshal.GetLastPInvokeError()));
      }
      if (!IsStableFileObservation(information, finalInformation))
      {
        Fail(
          "PROVIDER_CONTRACT_FILE_CHANGED",
          $"{description} identity or metadata changed while it was read");
      }
      if (finalInformation.NumberOfLinks != 1)
      {
        Fail(
          "PROVIDER_CONTRACT_FILE_IDENTITY_INVALID",
          $"{description} must remain a single-link file through verification");
      }

      return new LockedInputFile(
        stream,
        bytes,
        new FileIdentity(
          information.VolumeSerialNumber,
          ((ulong)information.FileIndexHigh << 32) | information.FileIndexLow));
    }
    catch (ProviderContractVerificationException)
    {
      stream?.Dispose();
      throw;
    }
    catch (Exception exception) when (
      exception is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
    {
      stream?.Dispose();
      throw new ProviderContractVerificationException(
        "PROVIDER_CONTRACT_FILE_INVALID",
        $"{description} could not be read as a regular local file",
        exception);
    }
  }

  private static unsafe string GetOpenedFinalDosPath(
    SafeFileHandle file,
    string description)
  {
    var requiredLength = GetFinalPathNameByHandle(
      file,
      filePath: null,
      filePathLength: 0,
      flags: 0);
    if (requiredLength is 0 or > 32768)
    {
      throw new ProviderContractVerificationException(
        "PROVIDER_CONTRACT_FILE_IDENTITY_INVALID",
        $"{description} final path is unavailable",
        new Win32Exception(Marshal.GetLastPInvokeError()));
    }

    var buffer = new char[requiredLength];
    fixed (char* bufferPointer = buffer)
    {
      var actualLength = GetFinalPathNameByHandle(
        file,
        bufferPointer,
        checked((uint)buffer.Length),
        flags: 0);
      if (actualLength is 0 || actualLength >= buffer.Length)
      {
        throw new ProviderContractVerificationException(
          "PROVIDER_CONTRACT_FILE_IDENTITY_INVALID",
          $"{description} final path changed while it was inspected",
          new Win32Exception(Marshal.GetLastPInvokeError()));
      }

      var nativePath = new string(bufferPointer, 0, checked((int)actualLength));
      const string extendedDosPrefix = @"\\?\";
      if (!nativePath.StartsWith(extendedDosPrefix, StringComparison.Ordinal) ||
          nativePath.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase))
      {
        Fail(
          "PROVIDER_CONTRACT_FILE_IDENTITY_INVALID",
          $"{description} did not resolve to a canonical local DOS path");
      }

      return nativePath[extendedDosPrefix.Length..];
    }
  }

  internal static void ValidateOpenedPathIdentity(
    string requestedCanonicalPath,
    string openedFinalDosPath,
    FileAttributes openedAttributes,
    string description)
  {
    if ((openedAttributes & FileAttributes.ReparsePoint) != 0 ||
        !string.Equals(
          requestedCanonicalPath,
          openedFinalDosPath,
          StringComparison.Ordinal))
    {
      Fail(
        "PROVIDER_CONTRACT_FILE_IDENTITY_INVALID",
        $"{description} resolved through a reparse point or changed before it was opened");
    }
  }

  private static bool IsStableFileObservation(
    ByHandleFileInformation initial,
    ByHandleFileInformation final) =>
    initial.FileAttributes == final.FileAttributes
    && initial.VolumeSerialNumber == final.VolumeSerialNumber
    && initial.FileSizeHigh == final.FileSizeHigh
    && initial.FileSizeLow == final.FileSizeLow
    && initial.NumberOfLinks == final.NumberOfLinks
    && initial.FileIndexHigh == final.FileIndexHigh
    && initial.FileIndexLow == final.FileIndexLow
    && initial.CreationTime.HighDateTime == final.CreationTime.HighDateTime
    && initial.CreationTime.LowDateTime == final.CreationTime.LowDateTime
    && initial.LastWriteTime.HighDateTime == final.LastWriteTime.HighDateTime
    && initial.LastWriteTime.LowDateTime == final.LastWriteTime.LowDateTime;

  private static string ResolveCanonicalLocalPath(string path, string description)
  {
    string fullPath;
    try
    {
      fullPath = Path.GetFullPath(path);
    }
    catch (Exception exception) when (exception is ArgumentException or NotSupportedException or PathTooLongException)
    {
      throw new ProviderContractVerificationException(
        "PROVIDER_CONTRACT_FILE_INVALID",
        $"{description} path is invalid",
        exception);
    }

    if (!Path.IsPathFullyQualified(path) ||
        path.StartsWith("\\\\", StringComparison.Ordinal) ||
        path.StartsWith("\\\\?\\", StringComparison.Ordinal) ||
        path.StartsWith("\\\\.\\", StringComparison.Ordinal) ||
        fullPath.IndexOf(':', 2) >= 0 ||
        !string.Equals(path, fullPath, StringComparison.OrdinalIgnoreCase))
    {
      Fail(
        "PROVIDER_CONTRACT_FILE_INVALID",
        $"{description} must use an exact canonical local path without device, UNC, or alternate-stream syntax");
    }

    var root = Path.GetPathRoot(fullPath);
    if (string.IsNullOrEmpty(root) || root.Length != 3 || root[1] != ':')
    {
      Fail("PROVIDER_CONTRACT_FILE_INVALID", $"{description} must be on a local drive");
    }

    try
    {
      var current = root;
      foreach (var component in fullPath[root.Length..].Split(
                 [Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar],
                 StringSplitOptions.RemoveEmptyEntries))
      {
        current = Path.Combine(current, component);
        if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
        {
          Fail(
            "PROVIDER_CONTRACT_FILE_IDENTITY_INVALID",
            $"{description} contains a reparse-point component");
        }
      }
    }
    catch (ProviderContractVerificationException)
    {
      throw;
    }
    catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
    {
      throw new ProviderContractVerificationException(
        "PROVIDER_CONTRACT_FILE_INVALID",
        $"{description} path identity could not be inspected",
        exception);
    }

    return fullPath;
  }

  private readonly record struct FileIdentity(uint VolumeSerialNumber, ulong FileIndex);

  private sealed class LockedInputFile : IDisposable
  {
    public LockedInputFile(FileStream stream, byte[] bytes, FileIdentity identity)
    {
      Stream = stream;
      Bytes = bytes;
      Identity = identity;
    }

    public byte[] Bytes { get; }
    public FileIdentity Identity { get; }
    private FileStream Stream { get; }

    public void Dispose() => Stream.Dispose();
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct NativeFileTime
  {
    public uint LowDateTime;
    public uint HighDateTime;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct ByHandleFileInformation
  {
    public uint FileAttributes;
    public NativeFileTime CreationTime;
    public NativeFileTime LastAccessTime;
    public NativeFileTime LastWriteTime;
    public uint VolumeSerialNumber;
    public uint FileSizeHigh;
    public uint FileSizeLow;
    public uint NumberOfLinks;
    public uint FileIndexHigh;
    public uint FileIndexLow;
  }

  [LibraryImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool GetFileInformationByHandle(
    SafeFileHandle file,
    out ByHandleFileInformation information);

  [LibraryImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW", SetLastError = true)]
  private static unsafe partial uint GetFinalPathNameByHandle(
    SafeFileHandle file,
    char* filePath,
    uint filePathLength,
    uint flags);

  private static bool IsIdentifierCharacter(char value) =>
    value is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '.' or '_' or ':' or '-';

  private static bool IsAccountOrModelCharacter(char value) =>
    IsIdentifierCharacter(value) || value is '@' or '/';

  private static string Sha256(byte[] value) =>
    Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();

  private static string FormatUtc(DateTimeOffset value) =>
    value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

  [DoesNotReturn]
  private static void Fail(string code, string message) =>
    throw new ProviderContractVerificationException(code, message);
}
