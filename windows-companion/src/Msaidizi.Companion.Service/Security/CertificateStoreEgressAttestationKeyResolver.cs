using System.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Security;

/// <summary>
/// Resolves purpose-separated, public-only boundary-supervisor keys from exact
/// supervisor-owned certificate-store bindings. It never resolves a signing
/// key and it does not provide an egress enforcement boundary.
/// </summary>
internal sealed class CertificateStoreEgressAttestationKeyResolver
  : IEgressAttestationKeyResolver
{
  private const int CertificateThumbprintCharacters = 40;
  private const string P256Oid = "1.2.840.10045.3.1.7";
  private readonly Dictionary<string, CertificateBinding> _bindings;
  private readonly IReadOnlyList<CertificateBinding> _pairedDeviceBindings;

  public CertificateStoreEgressAttestationKeyResolver(
    IOptions<EgressAttestationTrustOptions> options,
    IOptions<BrokerChannelOptions> brokerOptions)
    : this(options.Value, brokerOptions.Value)
  {
  }

  internal CertificateStoreEgressAttestationKeyResolver(
    EgressAttestationTrustOptions options,
    BrokerChannelOptions brokerOptions)
  {
    ArgumentNullException.ThrowIfNull(options);
    ArgumentNullException.ThrowIfNull(brokerOptions);
    if (!options.Enabled)
    {
      throw new InvalidOperationException(
        "Certificate-backed egress attestation trust is not enabled.");
    }
    if (options.TrustedSupervisorCertificates.Count == 0)
    {
      throw new InvalidOperationException(
        "Enabled egress attestation trust requires at least one certificate binding.");
    }

    var pairedDevices = NormalizePairedDeviceCertificates(options, brokerOptions);
    var keyIds = new HashSet<string>(StringComparer.Ordinal);
    var trustedThumbprints = new HashSet<string>(StringComparer.Ordinal);
    var bindings = new Dictionary<string, CertificateBinding>(StringComparer.Ordinal);
    foreach (var configured in options.TrustedSupervisorCertificates)
    {
      if (!IsSafeKeyId(configured.KeyId))
      {
        throw new InvalidOperationException(
          "Every egress attestation certificate requires a canonical key ID.");
      }
      if (!keyIds.Add(configured.KeyId))
      {
        throw new InvalidOperationException(
          "Egress attestation certificate key IDs must be unique.");
      }

      var thumbprint = NormalizeConfiguredThumbprint(configured.Thumbprint);
      if (!trustedThumbprints.Add(thumbprint))
      {
        throw new InvalidOperationException(
          "An egress attestation certificate may be bound to only one key ID.");
      }
      if (pairedDevices.Thumbprints.Contains(thumbprint))
      {
        throw new InvalidOperationException(
          "A paired-device certificate cannot be reused for egress attestation.");
      }
      if (!TryParseStoreName(configured.StoreName, out var storeName)
        || !TryParseStoreLocation(configured.StoreLocation, out var storeLocation))
      {
        throw new InvalidOperationException(
          "Every egress attestation certificate requires an exact Windows store.");
      }

      bindings.Add(
        configured.KeyId,
        new CertificateBinding(thumbprint, storeName, storeLocation));
    }

    _bindings = bindings;
    _pairedDeviceBindings = pairedDevices.Bindings;
  }

  public bool TryResolve(string keyId, out ECDsa? publicKey)
  {
    publicKey = null;
    if (!IsSafeKeyId(keyId) || !_bindings.TryGetValue(keyId, out var binding))
    {
      return false;
    }

    try
    {
      using var store = new X509Store(binding.StoreName, binding.StoreLocation);
      store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
      var matches = store.Certificates
        .Find(X509FindType.FindByThumbprint, binding.Thumbprint, validOnly: false)
        .Cast<X509Certificate2>()
        .Where(certificate => string.Equals(
          NormalizeObservedThumbprint(certificate.Thumbprint),
          binding.Thumbprint,
          StringComparison.Ordinal))
        .ToArray();
      try
      {
        if (!TryCreateDetachedPublicKey(matches, DateTimeOffset.UtcNow, out publicKey)
          || publicKey is null)
        {
          return false;
        }
        if (!IsPurposeSeparatedFromPairedDevices(publicKey))
        {
          publicKey.Dispose();
          publicKey = null;
          return false;
        }
        return true;
      }
      finally
      {
        foreach (var certificate in matches)
        {
          certificate.Dispose();
        }
      }
    }
    catch (Exception exception) when (exception is CryptographicException
      or SecurityException
      or UnauthorizedAccessException
      or PlatformNotSupportedException)
    {
      publicKey?.Dispose();
      publicKey = null;
      return false;
    }
  }

  private bool IsPurposeSeparatedFromPairedDevices(ECDsa attestationKey)
  {
    if (_pairedDeviceBindings.Count == 0)
    {
      return true;
    }

    var attestationSpki = attestationKey.ExportSubjectPublicKeyInfo();
    try
    {
      foreach (var binding in _pairedDeviceBindings)
      {
        using var store = new X509Store(binding.StoreName, binding.StoreLocation);
        store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
        var matches = store.Certificates
          .Find(X509FindType.FindByThumbprint, binding.Thumbprint, validOnly: false)
          .Cast<X509Certificate2>()
          .Where(certificate => string.Equals(
            NormalizeObservedThumbprint(certificate.Thumbprint),
            binding.Thumbprint,
            StringComparison.Ordinal))
          .ToArray();
        try
        {
          if (matches.Length != 1)
          {
            return false;
          }

          using var pairedDeviceKey = matches[0].GetECDsaPublicKey();
          if (pairedDeviceKey is null)
          {
            return false;
          }
          var pairedDeviceSpki = pairedDeviceKey.ExportSubjectPublicKeyInfo();
          try
          {
            if (CryptographicOperations.FixedTimeEquals(
              attestationSpki,
              pairedDeviceSpki))
            {
              return false;
            }
          }
          finally
          {
            CryptographicOperations.ZeroMemory(pairedDeviceSpki);
          }
        }
        finally
        {
          foreach (var certificate in matches)
          {
            certificate.Dispose();
          }
        }
      }
      return true;
    }
    finally
    {
      CryptographicOperations.ZeroMemory(attestationSpki);
    }
  }

  internal static bool TryCreateDetachedPublicKey(
    IReadOnlyCollection<X509Certificate2> certificates,
    DateTimeOffset now,
    out ECDsa? publicKey)
  {
    publicKey = null;
    if (certificates.Count != 1)
    {
      return false;
    }

    try
    {
      var certificate = certificates.Single();
      if (certificate.HasPrivateKey
        || certificate.NotBefore.ToUniversalTime() > now.UtcDateTime
        || certificate.NotAfter.ToUniversalTime() <= now.UtcDateTime
        || certificate.Extensions.OfType<X509BasicConstraintsExtension>()
          .Any(extension => extension.CertificateAuthority))
      {
        return false;
      }

      var keyUsageExtensions = certificate.Extensions
        .OfType<X509KeyUsageExtension>()
        .ToArray();
      if (keyUsageExtensions.Length != 1
        || !keyUsageExtensions[0].KeyUsages.HasFlag(
          X509KeyUsageFlags.DigitalSignature))
      {
        return false;
      }

      using var certificateKey = certificate.GetECDsaPublicKey();
      if (certificateKey is null || certificateKey.KeySize != 256)
      {
        return false;
      }

      var parameters = certificateKey.ExportParameters(includePrivateParameters: false);
      if (!string.Equals(parameters.Curve.Oid.Value, P256Oid, StringComparison.Ordinal)
        || parameters.Q.X is not { Length: 32 }
        || parameters.Q.Y is not { Length: 32 })
      {
        return false;
      }

      var subjectPublicKeyInfo = certificateKey.ExportSubjectPublicKeyInfo();
      try
      {
        var detached = ECDsa.Create();
        try
        {
          detached.ImportSubjectPublicKeyInfo(subjectPublicKeyInfo, out var bytesRead);
          if (bytesRead != subjectPublicKeyInfo.Length || detached.KeySize != 256)
          {
            detached.Dispose();
            return false;
          }
          publicKey = detached;
          return true;
        }
        catch
        {
          detached.Dispose();
          throw;
        }
      }
      finally
      {
        CryptographicOperations.ZeroMemory(subjectPublicKeyInfo);
      }
    }
    catch (Exception exception) when (exception is CryptographicException
      or InvalidOperationException)
    {
      publicKey = null;
      return false;
    }
  }

  private static PairedDeviceCertificates NormalizePairedDeviceCertificates(
    EgressAttestationTrustOptions options,
    BrokerChannelOptions brokerOptions)
  {
    var pairedThumbprints = new HashSet<string>(StringComparer.Ordinal);
    foreach (var configuredThumbprint in options.PairedDeviceCertificateThumbprints)
    {
      var thumbprint = NormalizeConfiguredThumbprint(configuredThumbprint);
      if (!pairedThumbprints.Add(thumbprint))
      {
        throw new InvalidOperationException(
          "Paired-device certificate thumbprints must be unique.");
      }
    }

    if (!string.IsNullOrWhiteSpace(brokerOptions.DeviceCertificateThumbprint))
    {
      pairedThumbprints.Add(NormalizeConfiguredThumbprint(
        brokerOptions.DeviceCertificateThumbprint));
    }
    if (pairedThumbprints.Count == 0)
    {
      return new PairedDeviceCertificates(pairedThumbprints, []);
    }
    if (!TryParseStoreName(brokerOptions.DeviceCertificateStoreName, out var storeName)
      || !TryParseStoreLocation(
        brokerOptions.DeviceCertificateStoreLocation,
        out var storeLocation))
    {
      throw new InvalidOperationException(
        "Paired-device identity comparison requires an exact Windows store.");
    }
    return new PairedDeviceCertificates(
      pairedThumbprints,
      pairedThumbprints
        .Select(thumbprint => new CertificateBinding(
          thumbprint,
          storeName,
          storeLocation))
        .ToArray());
  }

  private static string NormalizeConfiguredThumbprint(string value)
  {
    if (string.IsNullOrWhiteSpace(value))
    {
      throw new InvalidOperationException("Certificate thumbprints cannot be empty.");
    }
    var normalized = value.Replace(" ", string.Empty, StringComparison.Ordinal)
      .ToUpperInvariant();
    if (normalized.Length != CertificateThumbprintCharacters
      || !normalized.All(char.IsAsciiHexDigit))
    {
      throw new InvalidOperationException(
        "Certificate thumbprints must be exact SHA-1 certificate thumbprints.");
    }
    return normalized;
  }

  private static string NormalizeObservedThumbprint(string? value) =>
    value?.Replace(" ", string.Empty, StringComparison.Ordinal).ToUpperInvariant()
    ?? string.Empty;

  private static bool TryParseStoreName(string value, out StoreName storeName) =>
    Enum.TryParse(value, ignoreCase: false, out storeName)
    && Enum.IsDefined(storeName)
    && string.Equals(value, storeName.ToString(), StringComparison.Ordinal);

  private static bool TryParseStoreLocation(
    string value,
    out StoreLocation storeLocation) =>
    Enum.TryParse(value, ignoreCase: false, out storeLocation)
    && Enum.IsDefined(storeLocation)
    && string.Equals(value, storeLocation.ToString(), StringComparison.Ordinal);

  private static bool IsSafeKeyId(string value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 128
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_' or ':');

  private sealed record CertificateBinding(
    string Thumbprint,
    StoreName StoreName,
    StoreLocation StoreLocation);

  private sealed record PairedDeviceCertificates(
    HashSet<string> Thumbprints,
    IReadOnlyList<CertificateBinding> Bindings);
}
