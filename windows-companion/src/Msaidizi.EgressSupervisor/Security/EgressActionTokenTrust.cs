using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.EgressSupervisor.Security;

public sealed class CertificateStoreActionVerificationKeyResolver :
  IActionVerificationKeyResolver
{
  private readonly string _keyId;
  private readonly string _thumbprint;

  public CertificateStoreActionVerificationKeyResolver(EgressSupervisorOptions options)
  {
    ArgumentNullException.ThrowIfNull(options);
    _keyId = options.TokenVerificationKeyId;
    _thumbprint = NormalizeThumbprint(options.TokenVerificationCertificateThumbprint);
    if (!IsSafeKeyId(_keyId) || _thumbprint.Length != 40 || !_thumbprint.All(Uri.IsHexDigit))
    {
      throw new InvalidOperationException("The action-token verification key is invalid.");
    }
  }

  public bool TryResolve(string keyId, out ECDsa? publicKey)
  {
    publicKey = null;
    if (!string.Equals(keyId, _keyId, StringComparison.Ordinal))
    {
      return false;
    }

    using var store = new X509Store(StoreName.TrustedPeople, StoreLocation.LocalMachine);
    store.Open(OpenFlags.OpenExistingOnly | OpenFlags.ReadOnly);
    var matches = store.Certificates.Find(
      X509FindType.FindByThumbprint,
      _thumbprint,
      validOnly: true);
    try
    {
      if (matches.Count != 1 || matches[0].HasPrivateKey)
      {
        return false;
      }
      publicKey = matches[0].GetECDsaPublicKey();
      if (publicKey?.KeySize != 256)
      {
        publicKey?.Dispose();
        publicKey = null;
      }
      return publicKey is not null;
    }
    finally
    {
      foreach (var match in matches)
      {
        match.Dispose();
      }
    }
  }

  private static string NormalizeThumbprint(string value) => string.Concat(
    value.Where(character => !char.IsWhiteSpace(character))).ToUpperInvariant();

  private static bool IsSafeKeyId(string value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 128
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_' or ':');
}
