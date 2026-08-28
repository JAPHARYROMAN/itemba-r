using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Configuration;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Security;

public interface IDriverAttestationVerificationKeyResolver
{
  bool TryResolve(string keyId, out ECDsa? publicKey);
}

/// <summary>
/// Resolves the one action-token ES256 key from LocalMachine\TrustedPeople and
/// requires both its exact certificate thumbprint and canonical public SPKI.
/// A certificate carrying a private key is rejected at this verifier boundary.
/// </summary>
public sealed class PinnedActionTokenVerificationKeyResolver :
  IActionVerificationKeyResolver
{
  private readonly ExactTrustedPeopleP256Key _key;

  public PinnedActionTokenVerificationKeyResolver(
    PrivilegedCommandSupervisorOptions options)
  {
    ArgumentNullException.ThrowIfNull(options);
    _key = new ExactTrustedPeopleP256Key(options.ActionTokenVerificationKey);
  }

  public bool TryResolve(string keyId, out ECDsa? publicKey) =>
    _key.TryResolve(keyId, out publicKey);
}

/// <summary>
/// Purpose-distinct verifier for nonce-bound driver attestations. It is never
/// accepted as an action-token or supervisor evidence-signing key.
/// </summary>
public sealed class PinnedDriverAttestationVerificationKeyResolver :
  IDriverAttestationVerificationKeyResolver
{
  private readonly ExactTrustedPeopleP256Key _key;

  public PinnedDriverAttestationVerificationKeyResolver(
    PrivilegedCommandSupervisorOptions options)
  {
    ArgumentNullException.ThrowIfNull(options);
    _key = new ExactTrustedPeopleP256Key(options.DriverAttestationVerificationKey);
  }

  public bool TryResolve(string keyId, out ECDsa? publicKey) =>
    _key.TryResolve(keyId, out publicKey);
}

internal sealed class ExactTrustedPeopleP256Key
{
  private readonly string _keyId;
  private readonly string _thumbprint;
  private readonly byte[] _subjectPublicKeyInfo;

  public ExactTrustedPeopleP256Key(PrivilegedCommandVerificationKeyOptions options)
  {
    ArgumentNullException.ThrowIfNull(options);
    _keyId = options.KeyId;
    _thumbprint = options.CertificateThumbprint;
    _subjectPublicKeyInfo = Convert.FromBase64String(
      options.SubjectPublicKeyInfoBase64);
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
      using var certificateKey = matches[0].GetECDsaPublicKey();
      if (certificateKey is null || certificateKey.KeySize != 256)
      {
        return false;
      }
      var observedSpki = certificateKey.ExportSubjectPublicKeyInfo();
      try
      {
        if (observedSpki.Length != _subjectPublicKeyInfo.Length
          || !CryptographicOperations.FixedTimeEquals(
            observedSpki,
            _subjectPublicKeyInfo))
        {
          return false;
        }
        var detached = ECDsa.Create();
        detached.ImportSubjectPublicKeyInfo(_subjectPublicKeyInfo, out var consumed);
        if (consumed != _subjectPublicKeyInfo.Length || detached.KeySize != 256)
        {
          detached.Dispose();
          return false;
        }
        publicKey = detached;
        return true;
      }
      finally
      {
        CryptographicOperations.ZeroMemory(observedSpki);
      }
    }
    catch (Exception exception) when (exception is CryptographicException
      or InvalidOperationException
      or UnauthorizedAccessException)
    {
      return false;
    }
    finally
    {
      foreach (var certificate in matches)
      {
        certificate.Dispose();
      }
    }
  }
}
