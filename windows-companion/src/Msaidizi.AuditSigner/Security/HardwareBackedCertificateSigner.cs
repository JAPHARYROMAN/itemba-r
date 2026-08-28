using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;

namespace Itemba.Msaidizi.AuditSigner.Security;

public interface IAuditCheckpointSigner
{
  X509Certificate2 Certificate { get; }
  string CertificateSha256 { get; }
  string SubjectPublicKeySha256 { get; }
  byte[] Sign(byte[] canonicalManifest);
}

public sealed class HardwareBackedCertificateSigner : IAuditCheckpointSigner, IDisposable
{
  private const string ClientAuthenticationOid = "1.3.6.1.5.5.7.3.2";
  private readonly ECDsaCng _privateKey;

  private HardwareBackedCertificateSigner(X509Certificate2 certificate, ECDsaCng privateKey)
  {
    Certificate = certificate;
    _privateKey = privateKey;
    CertificateSha256 = AuditSignerProtocol.Sha256(certificate.RawData);
    SubjectPublicKeySha256 = AuditSignerProtocol.Sha256(ExportSignerSubjectPublicKey(certificate));
  }

  public X509Certificate2 Certificate { get; }
  public string CertificateSha256 { get; }
  public string SubjectPublicKeySha256 { get; }

  public static HardwareBackedCertificateSigner LoadFromLocalMachine(
    string thumbprint,
    string requiredProvider)
  {
    if (!OperatingSystem.IsWindows())
      throw new PlatformNotSupportedException("The audit signer requires the Windows certificate store.");
    var normalized = thumbprint.Replace(" ", string.Empty, StringComparison.Ordinal)
      .ToUpperInvariant();
    using var store = new X509Store(StoreName.My, StoreLocation.LocalMachine);
    store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
    var matches = store.Certificates.Find(
      X509FindType.FindByThumbprint,
      normalized,
      validOnly: true);
    if (matches.Count != 1 || !matches[0].HasPrivateKey)
      throw new InvalidOperationException(
        "Exactly one valid LocalMachine audit-signer certificate with a private key is required.");
    var certificate = matches[0];
    ValidateCertificateUsage(certificate);
    var key = certificate.GetECDsaPrivateKey() as ECDsaCng
      ?? throw new InvalidOperationException("Audit signer private key must be Windows CNG ECDSA.");
    var exportPolicy = key.Key.ExportPolicy;
    const CngExportPolicies exportable =
      CngExportPolicies.AllowExport |
      CngExportPolicies.AllowPlaintextExport |
      CngExportPolicies.AllowArchiving |
      CngExportPolicies.AllowPlaintextArchiving;
    if (key.Key.KeySize != 256 ||
        !string.Equals(key.Key.AlgorithmGroup?.AlgorithmGroup,
          CngAlgorithmGroup.ECDsa.AlgorithmGroup,
          StringComparison.Ordinal) ||
        (exportPolicy & exportable) != 0 ||
        !string.Equals(key.Key.Provider?.Provider, requiredProvider, StringComparison.Ordinal))
    {
      key.Dispose();
      throw new InvalidOperationException(
        "Audit signer key must be non-exportable P-256 in the pinned hardware provider.");
    }
    return new HardwareBackedCertificateSigner(certificate, key);
  }

  public byte[] Sign(byte[] canonicalManifest) => _privateKey.SignData(
    canonicalManifest,
    HashAlgorithmName.SHA256,
    DSASignatureFormat.IeeeP1363FixedFieldConcatenation);

  public void Dispose()
  {
    _privateKey.Dispose();
    Certificate.Dispose();
  }

  private static void ValidateCertificateUsage(X509Certificate2 certificate)
  {
    if (certificate.NotBefore.ToUniversalTime() > DateTime.UtcNow ||
        certificate.NotAfter.ToUniversalTime() <= DateTime.UtcNow)
      throw new InvalidOperationException("Audit signer certificate is outside its validity window.");
    var usages = certificate.Extensions.OfType<X509EnhancedKeyUsageExtension>()
      .SelectMany(extension => extension.EnhancedKeyUsages.Cast<Oid>())
      .Select(oid => oid.Value)
      .ToHashSet(StringComparer.Ordinal);
    if (!usages.Contains(ClientAuthenticationOid))
      throw new InvalidOperationException("Audit signer certificate lacks client-authentication EKU.");
    var keyUsage = certificate.Extensions.OfType<X509KeyUsageExtension>().SingleOrDefault();
    if (keyUsage is not null &&
        !keyUsage.KeyUsages.HasFlag(X509KeyUsageFlags.DigitalSignature))
      throw new InvalidOperationException("Audit signer certificate cannot produce digital signatures.");
    using var publicKey = certificate.GetECDsaPublicKey();
    if (publicKey?.KeySize != 256)
      throw new InvalidOperationException("Audit signer certificate must expose an ECDSA P-256 key.");
  }

  private static byte[] ExportSignerSubjectPublicKey(X509Certificate2 certificate)
  {
    using var key = certificate.GetECDsaPublicKey();
    return key?.ExportSubjectPublicKeyInfo()
      ?? throw new CryptographicException("Audit signer certificate must use ECDSA.");
  }
}

public static class BrokerCertificatePinValidator
{
  public static bool Validate(
    X509Certificate2? certificate,
    SslPolicyErrors errors,
    string expectedCertificateSha256,
    string expectedSpkiSha256)
  {
    if (certificate is null || errors != SslPolicyErrors.None) return false;
    try
    {
      var certificateHash = AuditSignerProtocol.Sha256(certificate.RawData);
      var spkiHash = AuditSignerProtocol.Sha256(ExportSubjectPublicKey(certificate));
      return FixedHex(certificateHash, expectedCertificateSha256) &&
        FixedHex(spkiHash, expectedSpkiSha256);
    }
    catch (CryptographicException)
    {
      return false;
    }
  }

  private static bool FixedHex(string left, string right)
  {
    if (!AuditSignerProtocol.IsSha256(left) || !AuditSignerProtocol.IsSha256(right)) return false;
    return CryptographicOperations.FixedTimeEquals(
      Encoding.ASCII.GetBytes(left),
      Encoding.ASCII.GetBytes(right));
  }

  private static byte[] ExportSubjectPublicKey(X509Certificate2 certificate)
  {
    using var key = certificate.GetECDsaPublicKey();
    return key?.ExportSubjectPublicKeyInfo()
      ?? throw new CryptographicException("Broker certificate must use ECDSA.");
  }
}
