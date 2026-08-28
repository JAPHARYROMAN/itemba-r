using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Security;

public sealed class CertificateStoreActionVerificationKeyResolver : IActionVerificationKeyResolver
{
  private readonly Dictionary<string, TrustedSigningCertificateOptions> _certificates;

  public CertificateStoreActionVerificationKeyResolver(IOptions<TokenVerificationOptions> options)
  {
    _certificates = options.Value.TrustedSigningCertificates.ToDictionary(
      certificate => certificate.KeyId,
      StringComparer.Ordinal);
  }

  public bool TryResolve(string keyId, out ECDsa? publicKey)
  {
    publicKey = null;
    if (!_certificates.TryGetValue(keyId, out var configuration)
      || string.IsNullOrWhiteSpace(configuration.Thumbprint)
      || !Enum.TryParse<StoreName>(configuration.StoreName, ignoreCase: false, out var storeName)
      || !Enum.TryParse<StoreLocation>(configuration.StoreLocation, ignoreCase: false, out var storeLocation))
    {
      return false;
    }

    using var store = new X509Store(storeName, storeLocation);
    store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
    var matches = store.Certificates.Find(
      X509FindType.FindByThumbprint,
      NormalizeThumbprint(configuration.Thumbprint),
      validOnly: true);

    var certificates = matches.Cast<X509Certificate2>().ToArray();
    try
    {
      var certificate = certificates
        .OrderByDescending(candidate => candidate.NotAfter)
        .FirstOrDefault();
      if (certificate is null)
      {
        return false;
      }

      using var certificateKey = certificate.GetECDsaPublicKey();
      if (certificateKey is null)
      {
        return false;
      }

      var subjectPublicKeyInfo = certificateKey.ExportSubjectPublicKeyInfo();
      var detachedKey = ECDsa.Create();
      detachedKey.ImportSubjectPublicKeyInfo(subjectPublicKeyInfo, out _);
      publicKey = detachedKey;
      return true;
    }
    finally
    {
      foreach (var certificate in certificates)
      {
        certificate.Dispose();
      }
    }
  }

  private static string NormalizeThumbprint(string thumbprint) =>
    thumbprint.Replace(" ", string.Empty, StringComparison.Ordinal).ToUpperInvariant();
}
