using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class EgressAttestationKeyResolverTests : IDisposable
{
  private readonly List<(StoreName Name, StoreLocation Location, string Thumbprint)>
    _installedCertificates = [];

  [Fact]
  public void PackagedConfigurationKeepsAttestationTrustDisabledAndEmpty()
  {
    var path = Path.Combine(
      AppContext.BaseDirectory,
      "test-assets",
      "service-appsettings.json");
    using var document = JsonDocument.Parse(File.ReadAllText(path));
    var trust = document.RootElement.GetProperty("EgressAttestationTrust");

    Assert.False(trust.GetProperty("Enabled").GetBoolean());
    Assert.Empty(trust.GetProperty("TrustedSupervisorCertificates").EnumerateArray());
    Assert.Empty(trust.GetProperty("PairedDeviceCertificateThumbprints").EnumerateArray());
    Assert.False(document.RootElement.GetProperty("SessionBridge")
      .GetProperty("BrowserExternalEffectsEnabled").GetBoolean());
    Assert.False(document.RootElement.GetProperty("SessionBridge")
      .GetProperty("EmergencyCommandEnabled").GetBoolean());
  }

  [Fact]
  public void EnabledTrustRejectsAnEmptyCertificateList()
  {
    var options = new EgressAttestationTrustOptions { Enabled = true };

    Assert.Throws<InvalidOperationException>(() =>
      new CertificateStoreEgressAttestationKeyResolver(
        options,
        new BrokerChannelOptions()));
  }

  [Fact]
  public void RejectsDuplicateKeyIdsAndDuplicateCertificateBindings()
  {
    var duplicateKeyId = CreateTrust(
      Entry("supervisor", new string('A', 40)),
      Entry("supervisor", new string('B', 40)));
    var duplicateCertificate = CreateTrust(
      Entry("supervisor-a", new string('A', 40)),
      Entry("supervisor-b", new string('A', 40), StoreName.My));

    Assert.Throws<InvalidOperationException>(() =>
      new CertificateStoreEgressAttestationKeyResolver(
        duplicateKeyId,
        new BrokerChannelOptions()));
    Assert.Throws<InvalidOperationException>(() =>
      new CertificateStoreEgressAttestationKeyResolver(
        duplicateCertificate,
        new BrokerChannelOptions()));
  }

  [Fact]
  public void RejectsKnownPairedDeviceIdentityReuse()
  {
    var thumbprint = new string('C', 40);
    var trust = CreateTrust(Entry("supervisor", thumbprint));

    Assert.Throws<InvalidOperationException>(() =>
      new CertificateStoreEgressAttestationKeyResolver(
        trust,
        new BrokerChannelOptions { DeviceCertificateThumbprint = thumbprint }));

    trust.PairedDeviceCertificateThumbprints.Add(thumbprint);
    Assert.Throws<InvalidOperationException>(() =>
      new CertificateStoreEgressAttestationKeyResolver(
        trust,
        new BrokerChannelOptions()));
  }

  [Fact]
  public void RejectsMalformedThumbprintsStoresAndKeyIds()
  {
    var malformedThumbprint = CreateTrust(Entry("supervisor", "ABC"));
    var malformedStore = CreateTrust(Entry("supervisor", new string('D', 40)));
    malformedStore.TrustedSupervisorCertificates[0].StoreName = "trustedpeople";
    var malformedKeyId = CreateTrust(Entry("not safe", new string('E', 40)));

    Assert.Throws<InvalidOperationException>(() =>
      new CertificateStoreEgressAttestationKeyResolver(
        malformedThumbprint,
        new BrokerChannelOptions()));
    Assert.Throws<InvalidOperationException>(() =>
      new CertificateStoreEgressAttestationKeyResolver(
        malformedStore,
        new BrokerChannelOptions()));
    Assert.Throws<InvalidOperationException>(() =>
      new CertificateStoreEgressAttestationKeyResolver(
        malformedKeyId,
        new BrokerChannelOptions()));
  }

  [Fact]
  public void CertificateValidationAcceptsOnlyOneCurrentPublicOnlyP256Leaf()
  {
    using var p256 = CreateEcdsaCertificate(ECCurve.NamedCurves.nistP256);
    using var p384 = CreateEcdsaCertificate(ECCurve.NamedCurves.nistP384);
    using var rsa = CreateRsaCertificate();

    Assert.True(CertificateStoreEgressAttestationKeyResolver.TryCreateDetachedPublicKey(
      [p256.PublicOnly],
      DateTimeOffset.UtcNow,
      out var resolved));
    using (resolved)
    {
      Assert.NotNull(resolved);
      Assert.Equal(256, resolved.KeySize);
      var payload = "independent-boundary-attestation"u8.ToArray();
      var signature = p256.SigningKey.SignData(
        payload,
        HashAlgorithmName.SHA256,
        DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
      Assert.True(resolved.VerifyData(
        payload,
        signature,
        HashAlgorithmName.SHA256,
        DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
    }

    Assert.False(CertificateStoreEgressAttestationKeyResolver.TryCreateDetachedPublicKey(
      [p256.WithPrivateKey],
      DateTimeOffset.UtcNow,
      out _));
    Assert.False(CertificateStoreEgressAttestationKeyResolver.TryCreateDetachedPublicKey(
      [p384.PublicOnly],
      DateTimeOffset.UtcNow,
      out _));
    Assert.False(CertificateStoreEgressAttestationKeyResolver.TryCreateDetachedPublicKey(
      [rsa],
      DateTimeOffset.UtcNow,
      out _));
    Assert.False(CertificateStoreEgressAttestationKeyResolver.TryCreateDetachedPublicKey(
      [],
      DateTimeOffset.UtcNow,
      out _));
    Assert.False(CertificateStoreEgressAttestationKeyResolver.TryCreateDetachedPublicKey(
      [p256.PublicOnly, p384.PublicOnly],
      DateTimeOffset.UtcNow,
      out _));
  }

  [Fact]
  public void ResolvesAnExactPublicCertificateFromTheConfiguredStore()
  {
    using var material = CreateEcdsaCertificate(ECCurve.NamedCurves.nistP256);
    InstallPublicCertificate(
      material.PublicOnly,
      StoreName.TrustedPeople,
      StoreLocation.CurrentUser);
    var trust = CreateTrust(Entry(
      "boundary-supervisor-v1",
      material.PublicOnly.Thumbprint,
      StoreName.TrustedPeople,
      StoreLocation.CurrentUser));
    var resolver = new CertificateStoreEgressAttestationKeyResolver(
      trust,
      new BrokerChannelOptions());

    Assert.False(resolver.TryResolve("unknown", out _));
    Assert.True(resolver.TryResolve("boundary-supervisor-v1", out var resolved));
    using (resolved)
    {
      Assert.NotNull(resolved);
      Assert.Equal(256, resolved.KeySize);
    }
  }

  [Fact]
  public void RejectsAReissuedCertificateThatReusesThePairedDeviceKey()
  {
    using var supervisor = CreateEcdsaCertificate(ECCurve.NamedCurves.nistP256);
    using var pairedDevice = CreatePublicEcdsaCertificate(
      supervisor.SigningKey,
      "CN=Paired Device Reusing Supervisor Key");
    Assert.NotEqual(supervisor.PublicOnly.Thumbprint, pairedDevice.Thumbprint);
    InstallPublicCertificate(
      supervisor.PublicOnly,
      StoreName.TrustedPeople,
      StoreLocation.CurrentUser);
    InstallPublicCertificate(
      pairedDevice,
      StoreName.My,
      StoreLocation.CurrentUser);
    var trust = CreateTrust(Entry(
      "boundary-supervisor-v1",
      supervisor.PublicOnly.Thumbprint,
      StoreName.TrustedPeople,
      StoreLocation.CurrentUser));
    var resolver = new CertificateStoreEgressAttestationKeyResolver(
      trust,
      new BrokerChannelOptions
      {
        DeviceCertificateThumbprint = pairedDevice.Thumbprint,
        DeviceCertificateStoreName = StoreName.My.ToString(),
        DeviceCertificateStoreLocation = StoreLocation.CurrentUser.ToString(),
      });

    Assert.False(resolver.TryResolve("boundary-supervisor-v1", out _));
  }

  public void Dispose()
  {
    foreach (var installed in _installedCertificates)
    {
      using var store = new X509Store(installed.Name, installed.Location);
      store.Open(OpenFlags.ReadWrite | OpenFlags.OpenExistingOnly);
      var matches = store.Certificates.Find(
        X509FindType.FindByThumbprint,
        installed.Thumbprint,
        validOnly: false);
      foreach (var certificate in matches)
      {
        store.Remove(certificate);
        certificate.Dispose();
      }
    }
  }

  private void InstallPublicCertificate(
    X509Certificate2 certificate,
    StoreName storeName,
    StoreLocation storeLocation)
  {
    using var store = new X509Store(storeName, storeLocation);
    store.Open(OpenFlags.ReadWrite | OpenFlags.OpenExistingOnly);
    store.Add(certificate);
    _installedCertificates.Add((storeName, storeLocation, certificate.Thumbprint));
  }

  private static EgressAttestationTrustOptions CreateTrust(
    params TrustedEgressAttestationCertificateOptions[] entries) => new()
    {
      Enabled = true,
      TrustedSupervisorCertificates = [.. entries],
    };

  private static TrustedEgressAttestationCertificateOptions Entry(
    string keyId,
    string thumbprint,
    StoreName storeName = StoreName.TrustedPeople,
    StoreLocation storeLocation = StoreLocation.LocalMachine) => new()
    {
      KeyId = keyId,
      Thumbprint = thumbprint,
      StoreName = storeName.ToString(),
      StoreLocation = storeLocation.ToString(),
    };

  private static EcdsaCertificateMaterial CreateEcdsaCertificate(ECCurve curve)
  {
    var key = ECDsa.Create(curve);
    var request = CreateRequest("CN=Egress Attestation Test", key);
    var withPrivateKey = request.CreateSelfSigned(
      DateTimeOffset.UtcNow.AddMinutes(-1),
      DateTimeOffset.UtcNow.AddHours(1));
    var publicOnly = new X509Certificate2(withPrivateKey.Export(X509ContentType.Cert));
    return new EcdsaCertificateMaterial(key, withPrivateKey, publicOnly);
  }

  private static X509Certificate2 CreatePublicEcdsaCertificate(
    ECDsa key,
    string subject)
  {
    var request = CreateRequest(subject, key);
    using var withPrivateKey = request.CreateSelfSigned(
      DateTimeOffset.UtcNow.AddMinutes(-1),
      DateTimeOffset.UtcNow.AddHours(1));
    return new X509Certificate2(withPrivateKey.Export(X509ContentType.Cert));
  }

  private static X509Certificate2 CreateRsaCertificate()
  {
    using var key = RSA.Create(2048);
    var request = CreateRequest("CN=RSA Egress Attestation Test", key);
    using var withPrivateKey = request.CreateSelfSigned(
      DateTimeOffset.UtcNow.AddMinutes(-1),
      DateTimeOffset.UtcNow.AddHours(1));
    return new X509Certificate2(withPrivateKey.Export(X509ContentType.Cert));
  }

  private static CertificateRequest CreateRequest(string subject, ECDsa key)
  {
    var request = new CertificateRequest(subject, key, HashAlgorithmName.SHA256);
    AddLeafSigningExtensions(request);
    return request;
  }

  private static CertificateRequest CreateRequest(string subject, RSA key)
  {
    var request = new CertificateRequest(
      subject,
      key,
      HashAlgorithmName.SHA256,
      RSASignaturePadding.Pkcs1);
    AddLeafSigningExtensions(request);
    return request;
  }

  private static void AddLeafSigningExtensions(CertificateRequest request)
  {
    request.CertificateExtensions.Add(new X509BasicConstraintsExtension(
      certificateAuthority: false,
      hasPathLengthConstraint: false,
      pathLengthConstraint: 0,
      critical: true));
    request.CertificateExtensions.Add(new X509KeyUsageExtension(
      X509KeyUsageFlags.DigitalSignature,
      critical: true));
  }

  private sealed class EcdsaCertificateMaterial(
    ECDsa signingKey,
    X509Certificate2 withPrivateKey,
    X509Certificate2 publicOnly) : IDisposable
  {
    public ECDsa SigningKey { get; } = signingKey;

    public X509Certificate2 WithPrivateKey { get; } = withPrivateKey;

    public X509Certificate2 PublicOnly { get; } = publicOnly;

    public void Dispose()
    {
      PublicOnly.Dispose();
      WithPrivateKey.Dispose();
      SigningKey.Dispose();
    }
  }
}
