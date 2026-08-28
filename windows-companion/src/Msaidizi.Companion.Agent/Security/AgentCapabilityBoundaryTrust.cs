using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Itemba.Msaidizi.Companion.Agent.Configuration;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Agent.Security;

internal sealed class AgentCapabilityBoundaryKeyResolver : IEgressAttestationKeyResolver
{
  private readonly CapabilityBoundaryTrustOptions _options;
  private readonly SessionBridgeOptions _bridge;

  public AgentCapabilityBoundaryKeyResolver(
    IOptions<CapabilityBoundaryTrustOptions> options,
    IOptions<SessionBridgeOptions> bridge)
  {
    _options = options.Value;
    _bridge = bridge.Value;
  }

  public bool TryResolve(string keyId, out ECDsa? publicKey)
  {
    publicKey = null;
    if (!_options.Enabled
      || !SafeKeyId(_options.KeyId)
      || !string.Equals(keyId, _options.KeyId, StringComparison.Ordinal)
      || !TryNormalizeThumbprint(_options.CertificateThumbprint, out var thumbprint)
      || !TryNormalizeThumbprint(
        _bridge.ServiceCertificateThumbprint,
        out var serviceThumbprint)
      || string.Equals(thumbprint, serviceThumbprint, StringComparison.Ordinal)
      || !Enum.TryParse<StoreName>(_options.CertificateStoreName, out var storeName)
      || !Enum.TryParse<StoreLocation>(
        _options.CertificateStoreLocation,
        out var storeLocation))
    {
      return false;
    }

    try
    {
      using var store = new X509Store(storeName, storeLocation);
      store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
      var matches = store.Certificates.Find(
        X509FindType.FindByThumbprint,
        thumbprint,
        validOnly: false);
      try
      {
        if (matches.Count != 1
          || DateTimeOffset.UtcNow < matches[0].NotBefore
          || DateTimeOffset.UtcNow > matches[0].NotAfter)
        {
          return false;
        }

        using var certificateKey = matches[0].GetECDsaPublicKey();
        if (certificateKey is null || !EgressBoundaryCanonical.IsExactP256(certificateKey))
        {
          return false;
        }
        var spki = certificateKey.ExportSubjectPublicKeyInfo();
        try
        {
          publicKey = ECDsa.Create();
          publicKey.ImportSubjectPublicKeyInfo(spki, out var consumed);
          if (consumed != spki.Length
            || !EgressBoundaryCanonical.IsExactP256(publicKey))
          {
            publicKey.Dispose();
            publicKey = null;
            return false;
          }
          return true;
        }
        finally
        {
          CryptographicOperations.ZeroMemory(spki);
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
    catch (Exception exception) when (exception is CryptographicException
      or InvalidOperationException
      or UnauthorizedAccessException)
    {
      publicKey?.Dispose();
      publicKey = null;
      return false;
    }
  }

  private static bool SafeKeyId(string value) => value.Length is >= 1 and <= 128
    && char.IsAsciiLetterOrDigit(value[0])
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_' or ':');

  private static bool TryNormalizeThumbprint(string value, out string normalized)
  {
    normalized = value.Replace(" ", string.Empty, StringComparison.Ordinal)
      .ToUpperInvariant();
    return normalized.Length == 40 && normalized.All(char.IsAsciiHexDigit);
  }
}

internal sealed class RejectingAgentCapabilityBoundaryKeyResolver :
  IEgressAttestationKeyResolver
{
  public bool TryResolve(string keyId, out ECDsa? publicKey)
  {
    publicKey = null;
    return false;
  }
}

internal static class StandardUserEgressVerifierFactory
{
  public static IStandardUserEgressVerifier Create(
    IOptions<AgentOptions> agent,
    IOptions<CapabilityBoundaryTrustOptions> trust,
    IEgressAttestationKeyResolver keys)
  {
    var options = trust.Value;
    if (!options.Enabled
      || !PayloadDigest.IsSha256Hex(agent.Value.EgressDestinationPolicySha256)
      || !PayloadDigest.IsSha256Hex(options.ExpectedSupervisorPipeSecuritySha256)
      || options.AllowedClockSkewSeconds is < 0 or > 120
      || options.MaximumAttestationLifetimeSeconds is < 5 or > 120)
    {
      return new RejectingStandardUserEgressVerifier();
    }

    return new StandardUserEgressVerifier(new EgressBoundaryContractVerifier(
      EgressBoundaryVerificationSettings.Strict(agent.Value.DeviceId),
      keys));
  }
}
