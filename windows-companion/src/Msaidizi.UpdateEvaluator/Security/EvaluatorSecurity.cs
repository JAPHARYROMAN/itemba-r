using System.Net.Security;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Itemba.Msaidizi.UpdateEvaluator.Configuration;
using Itemba.Msaidizi.UpdateEvaluator.Contracts;
using Itemba.Msaidizi.UpdateEvaluator.Protocol;

namespace Itemba.Msaidizi.UpdateEvaluator.Security;

public interface IAttestationSigner : IDisposable
{
  string KeyId { get; }
  string SubjectPublicKeySha256 { get; }
  SignedAttestationEnvelope Sign(object claims);
}

public sealed class CertificateAttestationSigner : IAttestationSigner
{
  private static readonly byte[] Domain =
    Encoding.UTF8.GetBytes("MSAIDIZI-EVALUATOR-ATTESTATION-V1\0");
  private readonly X509Certificate2 _certificate;
  private readonly ECDsaCng _key;

  private CertificateAttestationSigner(
    string keyId,
    X509Certificate2 certificate,
    ECDsaCng key)
  {
    KeyId = keyId;
    _certificate = certificate;
    _key = key;
    SubjectPublicKeySha256 = EvaluatorSecurity.Sha256(ExportSpki(certificate));
  }

  public string KeyId { get; }
  public string SubjectPublicKeySha256 { get; }

  public static CertificateAttestationSigner Load(AttestationSignerOptions options)
  {
    if (!OperatingSystem.IsWindows())
      throw new PlatformNotSupportedException("Evaluator attestation keys require Windows CNG.");
    if (!GeneratedManifestValidator.IsIdentifier(options.KeyId) ||
        string.IsNullOrWhiteSpace(options.CertificateThumbprint) ||
        string.IsNullOrWhiteSpace(options.HardwareKeyProvider))
      throw new InvalidOperationException("Evaluator signer configuration is invalid.");
    var thumbprint = options.CertificateThumbprint.Replace(" ", string.Empty,
      StringComparison.Ordinal).ToUpperInvariant();
    using var store = new X509Store(StoreName.My, StoreLocation.LocalMachine);
    store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
    var matches = store.Certificates.Find(X509FindType.FindByThumbprint, thumbprint,
      validOnly: true);
    if (matches.Count != 1 || !matches[0].HasPrivateKey)
      throw new InvalidOperationException(
        "Exactly one valid LocalMachine evaluator signing certificate is required.");
    var certificate = matches[0];
    var key = certificate.GetECDsaPrivateKey() as ECDsaCng
      ?? throw new InvalidOperationException("Evaluator signer must use Windows CNG ECDSA.");
    const CngExportPolicies exportable =
      CngExportPolicies.AllowExport | CngExportPolicies.AllowPlaintextExport |
      CngExportPolicies.AllowArchiving | CngExportPolicies.AllowPlaintextArchiving;
    var keyUsage = certificate.Extensions.OfType<X509KeyUsageExtension>().SingleOrDefault();
    if (key.KeySize != 256 || (key.Key.ExportPolicy & exportable) != 0 ||
        !string.Equals(key.Key.Provider?.Provider, options.HardwareKeyProvider,
          StringComparison.Ordinal) ||
        keyUsage is not null && !keyUsage.KeyUsages.HasFlag(X509KeyUsageFlags.DigitalSignature))
    {
      key.Dispose();
      certificate.Dispose();
      throw new InvalidOperationException(
        "Evaluator signer must be non-exportable P-256 in the pinned hardware provider.");
    }
    return new(options.KeyId, certificate, key);
  }

  public SignedAttestationEnvelope Sign(object claims)
  {
    var claimsJson = CanonicalJson.Serialize(claims);
    var claimsBytes = Encoding.UTF8.GetBytes(claimsJson);
    var payload = new byte[Domain.Length + claimsBytes.Length];
    try
    {
      Domain.CopyTo(payload, 0);
      claimsBytes.CopyTo(payload, Domain.Length);
      var signature = _key.SignData(payload, HashAlgorithmName.SHA256,
        DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
      try
      {
        if (signature.Length != 64)
          throw new CryptographicException("Evaluator signer emitted a non-canonical signature.");
        return new(claimsJson, EvaluatorSecurity.Base64Url(signature));
      }
      finally
      {
        CryptographicOperations.ZeroMemory(signature);
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(payload);
      CryptographicOperations.ZeroMemory(claimsBytes);
    }
  }

  public void Dispose()
  {
    _key.Dispose();
    _certificate.Dispose();
  }

  private static byte[] ExportSpki(X509Certificate2 certificate)
  {
    using var publicKey = certificate.GetECDsaPublicKey();
    return publicKey?.ExportSubjectPublicKeyInfo()
      ?? throw new CryptographicException("Evaluator signer certificate must use ECDSA.");
  }
}

public static class EvaluatorSecurity
{
  public static string Sha256(ReadOnlySpan<byte> value) =>
    Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();

  public static string Base64Url(ReadOnlySpan<byte> value) =>
    Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

  public static bool ValidatePinnedBrokerCertificate(
    X509Certificate2? certificate,
    SslPolicyErrors errors,
    string expectedCertificateSha256,
    string expectedSpkiSha256)
  {
    if (certificate is null || errors != SslPolicyErrors.None) return false;
    try
    {
      using var key = certificate.GetECDsaPublicKey();
      if (key?.KeySize != 256) return false;
      var certificateDigest = Sha256(certificate.RawData);
      var spkiDigest = Sha256(key.ExportSubjectPublicKeyInfo());
      return FixedHex(certificateDigest, expectedCertificateSha256) &&
        FixedHex(spkiDigest, expectedSpkiSha256) &&
        !FixedHex(certificateDigest, spkiDigest);
    }
    catch (CryptographicException)
    {
      return false;
    }
  }

  public static bool ValidatePinnedServerSpki(
    X509Certificate2? certificate,
    SslPolicyErrors errors,
    string expectedSpkiSha256)
  {
    if (certificate is null || errors != SslPolicyErrors.None ||
        !GeneratedManifestValidator.IsSha256(expectedSpkiSha256)) return false;
    try
    {
      using var key = certificate.GetECDsaPublicKey();
      return key?.KeySize == 256 && FixedHex(Sha256(key.ExportSubjectPublicKeyInfo()),
        expectedSpkiSha256);
    }
    catch (CryptographicException)
    {
      return false;
    }
  }

  public static bool FixedHex(string left, string right) =>
    GeneratedManifestValidator.IsSha256(left) && GeneratedManifestValidator.IsSha256(right) &&
    CryptographicOperations.FixedTimeEquals(
      Encoding.ASCII.GetBytes(left), Encoding.ASCII.GetBytes(right));
}

public sealed class EvaluatorTransportIdentity : IDisposable
{
  private EvaluatorTransportIdentity(X509Certificate2 certificate)
  {
    Certificate = certificate;
    using var key = certificate.GetECDsaPublicKey();
    SubjectPublicKeySha256 = Sha256(key?.ExportSubjectPublicKeyInfo()
      ?? throw new CryptographicException("Evaluator transport identity must use ECDSA."));
  }

  public X509Certificate2 Certificate { get; }
  public string SubjectPublicKeySha256 { get; }

  public static EvaluatorTransportIdentity Load(string thumbprint)
  {
    var normalized = thumbprint.Replace(" ", string.Empty, StringComparison.Ordinal)
      .ToUpperInvariant();
    using var store = new X509Store(StoreName.My, StoreLocation.LocalMachine);
    store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
    var matches = store.Certificates.Find(X509FindType.FindByThumbprint, normalized,
      validOnly: true);
    if (matches.Count != 1 || !matches[0].HasPrivateKey)
      throw new InvalidOperationException("Exactly one valid evaluator mTLS certificate is required.");
    var certificate = matches[0];
    using var key = certificate.GetECDsaPublicKey();
    var usages = certificate.Extensions.OfType<X509EnhancedKeyUsageExtension>()
      .SelectMany(extension => extension.EnhancedKeyUsages.Cast<Oid>())
      .Select(oid => oid.Value).ToHashSet(StringComparer.Ordinal);
    if (key?.KeySize != 256 || !usages.Contains("1.3.6.1.5.5.7.3.2"))
    {
      certificate.Dispose();
      throw new InvalidOperationException("Evaluator mTLS certificate must be P-256 with client-auth EKU.");
    }
    return new(certificate);
  }

  public void Dispose() => Certificate.Dispose();

  private static string Sha256(byte[] value) =>
    Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();
}

public interface IStateProtector
{
  byte[] Protect(ReadOnlySpan<byte> plaintext);
  byte[] Unprotect(ReadOnlySpan<byte> ciphertext);
}

public sealed class WindowsMachineStateProtector : IStateProtector
{
  private const int CryptProtectLocalMachine = 0x4;
  private static readonly byte[] Entropy =
    SHA256.HashData(Encoding.UTF8.GetBytes("Itemba.Msaidizi.UpdateEvaluator.State.v1"));

  public byte[] Protect(ReadOnlySpan<byte> plaintext) => Transform(plaintext, protect: true);
  public byte[] Unprotect(ReadOnlySpan<byte> ciphertext) => Transform(ciphertext, protect: false);

  private static byte[] Transform(ReadOnlySpan<byte> input, bool protect)
  {
    if (!OperatingSystem.IsWindows())
      throw new PlatformNotSupportedException("Evaluator state protection requires Windows DPAPI.");
    var inputBlob = DataBlob.From(input);
    var entropyBlob = DataBlob.From(Entropy);
    try
    {
      DataBlob outputBlob;
      var ok = protect
        ? CryptProtectData(ref inputBlob, null, ref entropyBlob, IntPtr.Zero, IntPtr.Zero,
          CryptProtectLocalMachine, out outputBlob)
        : CryptUnprotectData(ref inputBlob, IntPtr.Zero, ref entropyBlob, IntPtr.Zero, IntPtr.Zero,
          CryptProtectLocalMachine, out outputBlob);
      if (!ok) throw new CryptographicException(Marshal.GetLastWin32Error());
      try
      {
        var output = new byte[outputBlob.Size];
        Marshal.Copy(outputBlob.Data, output, 0, output.Length);
        return output;
      }
      finally
      {
        if (outputBlob.Data != IntPtr.Zero) LocalFree(outputBlob.Data);
      }
    }
    finally
    {
      inputBlob.Dispose();
      entropyBlob.Dispose();
    }
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct DataBlob
  {
    public int Size;
    public IntPtr Data;

    public static DataBlob From(ReadOnlySpan<byte> value)
    {
      var blob = new DataBlob { Size = value.Length };
      if (value.Length == 0) return blob;
      blob.Data = Marshal.AllocHGlobal(value.Length);
      var copy = value.ToArray();
      try
      {
        Marshal.Copy(copy, 0, blob.Data, copy.Length);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(copy);
      }
      return blob;
    }

    public void Dispose()
    {
      if (Data == IntPtr.Zero) return;
      var zeros = new byte[Size];
      try
      {
        Marshal.Copy(zeros, 0, Data, Size);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(zeros);
      }
      Marshal.FreeHGlobal(Data);
      Data = IntPtr.Zero;
      Size = 0;
    }
  }

  [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool CryptProtectData(
    ref DataBlob dataIn,
    string? description,
    ref DataBlob optionalEntropy,
    IntPtr reserved,
    IntPtr prompt,
    int flags,
    out DataBlob dataOut);

  [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool CryptUnprotectData(
    ref DataBlob dataIn,
    IntPtr description,
    ref DataBlob optionalEntropy,
    IntPtr reserved,
    IntPtr prompt,
    int flags,
    out DataBlob dataOut);

  [DllImport("kernel32.dll")]
  private static extern IntPtr LocalFree(IntPtr memory);
}
