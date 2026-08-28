using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Itemba.Msaidizi.ProviderContractVerification;

namespace Itemba.Msaidizi.Installer.Hardening.Tests;

public sealed partial class ProviderContractVerifierTests
{
  [Fact]
  public void ExactCanonicalSignedAttestationAndRealFilesAreVerified()
  {
    using var fixture = ProviderFixture.Create();

    var result = ProviderContractVerifier.Verify(fixture.Request);

    Assert.Equal("VERIFIED", result.Status);
    Assert.Equal(Hash(fixture.AttestationPath), result.AttestationArtifactSha256);
    Assert.Equal(Hash(fixture.PublicKeyPath), result.PublicKeyArtifactSha256);
    Assert.Equal(Hash(fixture.ContractDocumentPath), result.ContractDocumentSha256);
    Assert.Equal("https://api.anthropic.com", result.ApiOrigin);
    Assert.Equal("anthropic-credential/key-v1", result.ApiCredentialKeyId);
    Assert.Equal("urn:sha256:" + result.ContractDocumentSha256, result.ImmutableLegalReference);
    Assert.Equal(["claude-sonnet-4-5"], result.PermittedModelIds);
    Assert.Equal(10, result.CoveredDataClasses.Count);
  }

  [Fact]
  public void TamperedSignatureIsRejected()
  {
    using var fixture = ProviderFixture.Create();
    var bytes = File.ReadAllBytes(fixture.AttestationPath);
    var signatureOffset = bytes.Length - 4;
    bytes[signatureOffset] = bytes[signatureOffset] == (byte)'A' ? (byte)'B' : (byte)'A';
    File.WriteAllBytes(fixture.AttestationPath, bytes);

    var error = Assert.Throws<ProviderContractVerificationException>(
      () => ProviderContractVerifier.Verify(fixture.Request));

    Assert.Equal("PROVIDER_CONTRACT_SIGNATURE_INVALID", error.Code);
  }

  [Fact]
  public void DifferentContractDocumentBytesAreRejected()
  {
    using var fixture = ProviderFixture.Create();
    File.AppendAllText(fixture.ContractDocumentPath, "tamper", Encoding.UTF8);

    var error = Assert.Throws<ProviderContractVerificationException>(
      () => ProviderContractVerifier.Verify(fixture.Request));

    Assert.Equal("PROVIDER_CONTRACT_DOCUMENT_DIGEST_MISMATCH", error.Code);
  }

  [Fact]
  public void PrivateKeyMaterialIsRejected()
  {
    using var fixture = ProviderFixture.Create();
    File.WriteAllText(
      fixture.PublicKeyPath,
      fixture.SigningKey.ExportPkcs8PrivateKeyPem(),
      new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

    var error = Assert.Throws<ProviderContractVerificationException>(
      () => ProviderContractVerifier.Verify(fixture.Request));

    Assert.Equal("PROVIDER_CONTRACT_PUBLIC_KEY_INVALID", error.Code);
  }

  [Fact]
  public void NonCanonicalAttestationBytesAreRejected()
  {
    using var fixture = ProviderFixture.Create();
    File.AppendAllText(fixture.AttestationPath, Environment.NewLine, Encoding.UTF8);

    var error = Assert.Throws<ProviderContractVerificationException>(
      () => ProviderContractVerifier.Verify(fixture.Request));

    Assert.Equal("PROVIDER_CONTRACT_NONCANONICAL_JSON", error.Code);
  }

  [Fact]
  public void UnsortedModelScopeIsRejectedEvenWhenSigned()
  {
    using var fixture = ProviderFixture.Create(
      permittedModelIds: ["claude-sonnet-4-5", "claude-haiku-4-5"]);

    var error = Assert.Throws<ProviderContractVerificationException>(
      () => ProviderContractVerifier.Verify(fixture.Request));

    Assert.Equal("PROVIDER_CONTRACT_FIELD_INVALID", error.Code);
  }

  [Fact]
  public void WrongApiOriginIsRejectedEvenWhenSigned()
  {
    using var fixture = ProviderFixture.Create(apiOrigin: "https://proxy.invalid");

    var error = Assert.Throws<ProviderContractVerificationException>(
      () => ProviderContractVerifier.Verify(fixture.Request));

    Assert.Equal("PROVIDER_CONTRACT_API_ORIGIN_INVALID", error.Code);
  }

  [Fact]
  public void MissingCredentialKeyIdentifierIsRejectedEvenWhenSigned()
  {
    using var fixture = ProviderFixture.Create(apiCredentialKeyId: null);

    var error = Assert.Throws<ProviderContractVerificationException>(
      () => ProviderContractVerifier.Verify(fixture.Request));

    Assert.Equal("PROVIDER_CONTRACT_SHAPE_INVALID", error.Code);
  }

  [Fact]
  public void CredentialKeyRotationIsVisibleOnlyThroughTheSignedOpaqueIdentifier()
  {
    using var first = ProviderFixture.Create(apiCredentialKeyId: "anthropic-credential/key-v1");
    using var rotated = ProviderFixture.Create(apiCredentialKeyId: "anthropic-credential/key-v2");

    Assert.Equal(
      "anthropic-credential/key-v1",
      ProviderContractVerifier.Verify(first.Request).ApiCredentialKeyId);
    Assert.Equal(
      "anthropic-credential/key-v2",
      ProviderContractVerifier.Verify(rotated.Request).ApiCredentialKeyId);
    Assert.NotEqual(Hash(first.AttestationPath), Hash(rotated.AttestationPath));
  }

  [Fact]
  public void ExpiryMustCoverTheCompleteOperationalAndRingWindow()
  {
    var now = DateTimeOffset.UtcNow;
    using var fixture = ProviderFixture.Create(
      expiresAt: now.AddHours(2),
      requiredWindowStart: now.AddHours(-1),
      requiredWindowEnd: now.AddHours(3),
      validationTime: now.AddHours(3));

    var error = Assert.Throws<ProviderContractVerificationException>(
      () => ProviderContractVerifier.Verify(fixture.Request));

    Assert.Equal("PROVIDER_CONTRACT_EXPIRED", error.Code);
  }

  [Fact]
  public void FutureVerificationWindowIsRejectedBeforeCryptography()
  {
    var now = DateTimeOffset.UtcNow;
    using var fixture = ProviderFixture.Create(
      requiredWindowStart: now.AddHours(-1),
      requiredWindowEnd: now.AddHours(1),
      validationTime: now);

    var error = Assert.Throws<ProviderContractVerificationException>(
      () => ProviderContractVerifier.Verify(fixture.Request));

    Assert.Equal("PROVIDER_CONTRACT_VERIFICATION_WINDOW_INVALID", error.Code);
  }

  [Fact]
  public void HardLinkedInputArtifactIsRejected()
  {
    using var fixture = ProviderFixture.Create();
    var hardLink = Path.Combine(fixture.Root, "hard-linked-attestation.json");
    Assert.True(CreateHardLink(hardLink, fixture.AttestationPath, IntPtr.Zero));

    var error = Assert.Throws<ProviderContractVerificationException>(
      () => ProviderContractVerifier.Verify(fixture.Request with { AttestationPath = hardLink }));

    Assert.Equal("PROVIDER_CONTRACT_FILE_IDENTITY_INVALID", error.Code);
  }

  [Fact]
  public void ThreeInputsMustResolveToDistinctFileIdentities()
  {
    using var fixture = ProviderFixture.Create();

    var error = Assert.Throws<ProviderContractVerificationException>(
      () => ProviderContractVerifier.Verify(
        fixture.Request with { ContractDocumentPath = fixture.PublicKeyPath }));

    Assert.Equal("PROVIDER_CONTRACT_FILE_IDENTITY_INVALID", error.Code);
  }

  [Fact]
  public void AttestationSizeCeilingMatchesBackendRuntime()
  {
    using var fixture = ProviderFixture.Create();
    File.WriteAllBytes(fixture.AttestationPath, new byte[(64 * 1024) + 1]);

    var error = Assert.Throws<ProviderContractVerificationException>(
      () => ProviderContractVerifier.Verify(fixture.Request));

    Assert.Equal("PROVIDER_CONTRACT_FILE_INVALID", error.Code);
  }

  [Fact]
  public void OpenedHandleMustStillResolveToTheRequestedCanonicalPath()
  {
    var error = Assert.Throws<ProviderContractVerificationException>(
      () => ProviderContractVerifier.ValidateOpenedPathIdentity(
        @"C:\release\provider-contract.json",
        @"C:\redirected\provider-contract.json",
        FileAttributes.Normal,
        "provider-contract attestation"));

    Assert.Equal("PROVIDER_CONTRACT_FILE_IDENTITY_INVALID", error.Code);
  }

  [Fact]
  public void OpenedHandleWithReparseAttributeIsRejected()
  {
    var error = Assert.Throws<ProviderContractVerificationException>(
      () => ProviderContractVerifier.ValidateOpenedPathIdentity(
        @"C:\release\provider-contract.json",
        @"C:\release\provider-contract.json",
        FileAttributes.ReparsePoint,
        "provider-contract attestation"));

    Assert.Equal("PROVIDER_CONTRACT_FILE_IDENTITY_INVALID", error.Code);
  }

  [Fact]
  public void CaseVariantPathIsRejectedByTheRealOpenedHandleCheck()
  {
    using var fixture = ProviderFixture.Create();
    var fileName = Path.GetFileName(fixture.AttestationPath);
    var firstLetter = fileName[0];
    var caseVariantName = char.IsLower(firstLetter)
      ? char.ToUpperInvariant(firstLetter) + fileName[1..]
      : char.ToLowerInvariant(firstLetter) + fileName[1..];
    var caseVariantPath = Path.Combine(fixture.Root, caseVariantName);

    var error = Assert.Throws<ProviderContractVerificationException>(() =>
      ProviderContractVerifier.Verify(
        fixture.Request with { AttestationPath = caseVariantPath }));

    Assert.Equal("PROVIDER_CONTRACT_FILE_IDENTITY_INVALID", error.Code);
  }

  private static string Hash(string path) =>
    Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();

  [LibraryImport("kernel32.dll", EntryPoint = "CreateHardLinkW", SetLastError = true,
    StringMarshalling = StringMarshalling.Utf16)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool CreateHardLink(
    string fileName,
    string existingFileName,
    IntPtr securityAttributes);

  private sealed class ProviderFixture : IDisposable
  {
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

    private ProviderFixture(
      string root,
      ECDsa signingKey,
      ProviderContractVerificationRequest request)
    {
      Root = root;
      SigningKey = signingKey;
      Request = request;
    }

    public string Root { get; }
    public ECDsa SigningKey { get; }
    public ProviderContractVerificationRequest Request { get; }
    public string AttestationPath => Request.AttestationPath;
    public string PublicKeyPath => Request.PublicKeyPath;
    public string ContractDocumentPath => Request.ContractDocumentPath;

    public static ProviderFixture Create(
      string apiOrigin = "https://api.anthropic.com",
      string? apiCredentialKeyId = "anthropic-credential/key-v1",
      string[]? permittedModelIds = null,
      DateTimeOffset? expiresAt = null,
      DateTimeOffset? requiredWindowStart = null,
      DateTimeOffset? requiredWindowEnd = null,
      DateTimeOffset? validationTime = null)
    {
      var root = Path.Combine(Path.GetTempPath(), "msaidizi-provider-contract-" + Guid.NewGuid().ToString("N"));
      Directory.CreateDirectory(root);
      var attestationPath = Path.Combine(root, "provider-contract.json");
      var publicKeyPath = Path.Combine(root, "provider-contract-public.pem");
      var contractDocumentPath = Path.Combine(root, "provider-contract-document.pdf");
      File.WriteAllBytes(contractDocumentPath, Encoding.UTF8.GetBytes("reviewed provider contract bytes"));
      var documentSha256 = Hash(contractDocumentPath);

      var signingKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
      File.WriteAllText(
        publicKeyPath,
        signingKey.ExportSubjectPublicKeyInfoPem(),
        new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

      var now = (validationTime ?? DateTimeOffset.UtcNow).ToUniversalTime();
      var windowStart = (requiredWindowStart ?? now.AddDays(-2)).ToUniversalTime();
      var windowEnd = (requiredWindowEnd ?? now.AddDays(-1)).ToUniversalTime();
      var issuedAt = windowStart.AddDays(-2);
      var effectiveAt = windowStart.AddDays(-1);
      var expiry = (expiresAt ?? now.AddDays(30)).ToUniversalTime();
      var models = permittedModelIds ?? ["claude-sonnet-4-5"];
      var unsigned = WriteAttestation(
        signatureBase64: null,
        apiOrigin,
        apiCredentialKeyId,
        models,
        documentSha256,
        issuedAt,
        effectiveAt,
        expiry);
      var domain = Encoding.UTF8.GetBytes("ITEMBA\0MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION\0V2\0");
      var signingInput = new byte[domain.Length + unsigned.Length];
      domain.CopyTo(signingInput, 0);
      unsigned.CopyTo(signingInput, domain.Length);
      var signature = signingKey.SignData(
        signingInput,
        HashAlgorithmName.SHA256,
        DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
      File.WriteAllBytes(
        attestationPath,
        WriteAttestation(
          Convert.ToBase64String(signature),
          apiOrigin,
          apiCredentialKeyId,
          models,
          documentSha256,
          issuedAt,
          effectiveAt,
          expiry));

      return new ProviderFixture(
        root,
        signingKey,
        new ProviderContractVerificationRequest(
          attestationPath,
          publicKeyPath,
          contractDocumentPath,
          windowStart,
          windowEnd,
          now));
    }

    public void Dispose()
    {
      SigningKey.Dispose();
      if (Directory.Exists(Root))
      {
        Directory.Delete(Root, recursive: true);
      }
    }

    private static byte[] WriteAttestation(
      string? signatureBase64,
      string apiOrigin,
      string? apiCredentialKeyId,
      IReadOnlyList<string> permittedModelIds,
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
        writer.WriteString("apiAccountId", "anthropic-account-1");
        if (apiCredentialKeyId is not null)
        {
          writer.WriteString("apiCredentialKeyId", apiCredentialKeyId);
        }
        writer.WriteString("apiOrigin", apiOrigin);
        writer.WriteString("attestationId", "attestation-1");
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
        foreach (var model in permittedModelIds) writer.WriteStringValue(model);
        writer.WriteEndArray();
        writer.WriteString("provider", "anthropic");
        writer.WriteNumber("providerRetentionSeconds", 0);
        writer.WriteBoolean("zeroTraining", true);
        writer.WriteEndObject();
        writer.WriteString("contract", "msaidizi-provider-contract-attestation/v2");
        writer.WriteString("keyId", "provider-contract-key-1");
        writer.WriteString("signatureAlgorithm", "ES256");
        if (signatureBase64 is not null) writer.WriteString("signatureBase64", signatureBase64);
        writer.WriteEndObject();
      }

      return stream.ToArray();
    }

    private static string FormatClaimTime(DateTimeOffset value) =>
      value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);
  }
}
