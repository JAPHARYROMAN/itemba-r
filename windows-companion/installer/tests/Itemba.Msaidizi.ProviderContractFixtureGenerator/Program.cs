using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Itemba.Msaidizi.ProviderContractFixtureGenerator;

internal static class Program
{
  private static readonly UTF8Encoding Utf8WithoutBom = new(encoderShouldEmitUTF8Identifier: false);
  private static readonly JsonSerializerOptions BindingJsonOptions = new();

  private static readonly string[] DataClasses =
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

  public static int Main(string[] args)
  {
    if (args.Length != 6 ||
        args[0] != "--output" ||
        args[2] != "--window-start-utc" ||
        args[4] != "--expires-at-utc" ||
        !TryParseUtc(args[3], out var windowStart) ||
        !TryParseUtc(args[5], out var expiresAt) ||
        expiresAt <= windowStart)
    {
      Console.Error.WriteLine("TEST_FIXTURE_ARGUMENT_INVALID");
      return 2;
    }

    var output = Path.GetFullPath(args[1]);
    Directory.CreateDirectory(output);
    var documentPath = Path.Combine(output, "test-provider-contract-document.bin");
    var publicKeyPath = Path.Combine(output, "test-provider-contract-public.pem");
    var attestationPath = Path.Combine(output, "test-provider-contract-attestation.json");
    var bindingPath = Path.Combine(output, "test-provider-contract-binding.json");

    File.WriteAllBytes(documentPath, Encoding.UTF8.GetBytes("EPHEMERAL TEST PROVIDER CONTRACT; NOT LEGAL EVIDENCE"));
    var documentSha256 = Hash(File.ReadAllBytes(documentPath));
    using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    File.WriteAllText(publicKeyPath, key.ExportSubjectPublicKeyInfoPem(), Utf8WithoutBom);

    var issuedAt = windowStart.AddDays(-2);
    var effectiveAt = windowStart.AddDays(-1);
    var unsigned = WriteAttestation(
      signatureBase64: null,
      documentSha256,
      issuedAt,
      effectiveAt,
      expiresAt);
    var domain = Encoding.UTF8.GetBytes("ITEMBA\0MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION\0V2\0");
    var signingInput = new byte[domain.Length + unsigned.Length];
    domain.CopyTo(signingInput, 0);
    unsigned.CopyTo(signingInput, domain.Length);
    var signature = key.SignData(
      signingInput,
      HashAlgorithmName.SHA256,
      DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
    File.WriteAllBytes(
      attestationPath,
      WriteAttestation(
        Convert.ToBase64String(signature),
        documentSha256,
        issuedAt,
        effectiveAt,
        expiresAt));

    var binding = new
    {
      contract = "msaidizi-provider-contract-attestation/v2",
      attestationArtifactSha256 = Hash(File.ReadAllBytes(attestationPath)),
      publicKeyArtifactSha256 = Hash(File.ReadAllBytes(publicKeyPath)),
      signerSpkiSha256 = Hash(key.ExportSubjectPublicKeyInfo()),
      contractDocumentSha256 = documentSha256,
      attestationId = "ephemeral-test-attestation",
      keyId = "ephemeral-test-key",
      signatureAlgorithm = "ES256",
      provider = "anthropic",
      apiOrigin = "https://api.anthropic.com",
      apiAccountId = "ephemeral-test-account",
      apiCredentialKeyId = "ephemeral-test-credential/key-v1",
      permittedModelIds = new[] { "claude-sonnet-4-5" },
      coveredDataClasses = DataClasses,
      zeroTraining = true,
      providerRetentionSeconds = 0,
      immutableLegalReference = "urn:sha256:" + documentSha256,
      issuedAt = FormatClaimTime(issuedAt),
      effectiveAt = FormatClaimTime(effectiveAt),
      expiresAt = FormatClaimTime(expiresAt),
    };
    File.WriteAllText(
      bindingPath,
      JsonSerializer.Serialize(binding, BindingJsonOptions),
      Utf8WithoutBom);
    return 0;
  }

  private static byte[] WriteAttestation(
    string? signatureBase64,
    string documentSha256,
    DateTimeOffset issuedAt,
    DateTimeOffset effectiveAt,
    DateTimeOffset expiresAt)
  {
    using var stream = new MemoryStream();
    using (var writer = new Utf8JsonWriter(
             stream,
             new JsonWriterOptions
             {
               Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
               Indented = false,
             }))
    {
      writer.WriteStartObject();
      writer.WritePropertyName("claims");
      writer.WriteStartObject();
      writer.WriteString("apiAccountId", "ephemeral-test-account");
      writer.WriteString("apiCredentialKeyId", "ephemeral-test-credential/key-v1");
      writer.WriteString("apiOrigin", "https://api.anthropic.com");
      writer.WriteString("attestationId", "ephemeral-test-attestation");
      writer.WriteString("contractDocumentSha256", documentSha256);
      writer.WritePropertyName("coveredDataClasses");
      writer.WriteStartArray();
      foreach (var dataClass in DataClasses) writer.WriteStringValue(dataClass);
      writer.WriteEndArray();
      writer.WriteString("effectiveAt", FormatClaimTime(effectiveAt));
      writer.WriteString("expiresAt", FormatClaimTime(expiresAt));
      writer.WriteString("immutableLegalReference", "urn:sha256:" + documentSha256);
      writer.WriteString("issuedAt", FormatClaimTime(issuedAt));
      writer.WritePropertyName("permittedModelIds");
      writer.WriteStartArray();
      writer.WriteStringValue("claude-sonnet-4-5");
      writer.WriteEndArray();
      writer.WriteString("provider", "anthropic");
      writer.WriteNumber("providerRetentionSeconds", 0);
      writer.WriteBoolean("zeroTraining", true);
      writer.WriteEndObject();
      writer.WriteString("contract", "msaidizi-provider-contract-attestation/v2");
      writer.WriteString("keyId", "ephemeral-test-key");
      writer.WriteString("signatureAlgorithm", "ES256");
      if (signatureBase64 is not null) writer.WriteString("signatureBase64", signatureBase64);
      writer.WriteEndObject();
    }

    return stream.ToArray();
  }

  private static bool TryParseUtc(string value, out DateTimeOffset parsed) =>
    DateTimeOffset.TryParse(
      value,
      CultureInfo.InvariantCulture,
      DateTimeStyles.AssumeUniversal,
      out parsed) && parsed.Offset == TimeSpan.Zero;

  private static string FormatClaimTime(DateTimeOffset value) =>
    value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

  private static string Hash(byte[] value) =>
    Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();
}
