using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.AccessControl;
using System.Security.Principal;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.EgressSupervisor.Security;

public interface IEgressSupervisorSigningKeys : IDisposable
{
  string AttestationKeyId { get; }

  string ReceiptKeyId { get; }

  string ReceiptPublicKeySpkiBase64 { get; }

  string ReceiptPublicKeySha256 { get; }

  SignedBoundaryAttestation SignAttestation(BoundaryAttestationV1 attestation);

  SignedCapabilityBoundaryAttestation SignCapabilityAttestation(
    CapabilityBoundaryAttestationV1 attestation);

  SignedEgressLease SignLease(EgressLeaseV1 lease);

  SignedEgressReceipt SignReceipt(EgressReceiptV1 receipt);

  bool VerifyAttestation(SignedBoundaryAttestation attestation);

  bool VerifyCapabilityAttestation(SignedCapabilityBoundaryAttestation attestation);

  bool VerifyLease(SignedEgressLease lease);

  bool VerifyReceipt(SignedEgressReceipt receipt);
}

/// <summary>
/// Purpose-separated ECDSA P-256 keys loaded from LocalMachine\My. A production
/// deployment should provision non-exportable TPM/CNG keys and grant private-
/// key access only to the egress-supervisor service SID.
/// </summary>
public sealed class CertificateStoreEgressSupervisorSigningKeys :
  IEgressSupervisorSigningKeys
{
  private readonly X509Certificate2 _attestationCertificate;
  private readonly X509Certificate2 _receiptCertificate;
  private readonly ECDsaCng _attestationKey;
  private readonly ECDsaCng _receiptKey;
  private readonly object _signingGate = new();
  private int _disposed;

  public CertificateStoreEgressSupervisorSigningKeys(
    EgressSupervisorOptions options,
    IActionVerificationKeyResolver actionVerificationKeys)
  {
    ArgumentNullException.ThrowIfNull(options);
    ArgumentNullException.ThrowIfNull(actionVerificationKeys);
    if (!OperatingSystem.IsWindows()
      || !IsSafeKeyId(options.AttestationKeyId)
      || !IsSafeKeyId(options.ReceiptKeyId)
      || !IsSafeKeyId(options.TokenVerificationKeyId)
      || string.Equals(options.AttestationKeyId, options.ReceiptKeyId, StringComparison.Ordinal)
      || string.Equals(
        options.AttestationKeyId,
        options.TokenVerificationKeyId,
        StringComparison.Ordinal)
      || string.Equals(
        options.ReceiptKeyId,
        options.TokenVerificationKeyId,
        StringComparison.Ordinal)
      || !TryNormalizeThumbprint(options.AttestationCertificateThumbprint,
        out var attestationThumbprint)
      || !TryNormalizeThumbprint(options.ReceiptCertificateThumbprint,
        out var receiptThumbprint)
      || string.Equals(attestationThumbprint, receiptThumbprint, StringComparison.Ordinal))
    {
      throw new InvalidOperationException("Egress signing-key enrollment is invalid.");
    }

    AttestationKeyId = options.AttestationKeyId;
    ReceiptKeyId = options.ReceiptKeyId;
    _attestationCertificate = ResolveUnique(attestationThumbprint);
    try
    {
      _receiptCertificate = ResolveUnique(receiptThumbprint);
    }
    catch
    {
      _attestationCertificate.Dispose();
      throw;
    }

    ECDsaCng? attestationKey = null;
    ECDsaCng? receiptKey = null;
    try
    {
      var supervisorSid = (SecurityIdentifier)new NTAccount(
        $@"NT SERVICE\{options.SupervisorServiceName}").Translate(
          typeof(SecurityIdentifier));
      attestationKey = ResolvePrivateP256(_attestationCertificate, supervisorSid);
      receiptKey = ResolvePrivateP256(_receiptCertificate, supervisorSid);
      if (!actionVerificationKeys.TryResolve(
        options.TokenVerificationKeyId,
        out var actionVerificationKey)
        || actionVerificationKey is null)
      {
        throw new InvalidOperationException(
          "The broker action-verification key is unavailable for separation proof.");
      }

      using (actionVerificationKey)
      {
        var attestationSpki = attestationKey.ExportSubjectPublicKeyInfo();
        var receiptSpki = receiptKey.ExportSubjectPublicKeyInfo();
        var actionVerificationSpki = actionVerificationKey.ExportSubjectPublicKeyInfo();
        try
        {
          if (!ArePurposeSeparatedPublicSpkis(
            attestationSpki,
            receiptSpki,
            actionVerificationSpki))
          {
            throw new InvalidOperationException(
              "Egress attestation, receipt, and broker action keys must be distinct.");
          }
          ReceiptPublicKeySpkiBase64 = Convert.ToBase64String(receiptSpki);
          ReceiptPublicKeySha256 = Convert.ToHexString(SHA256.HashData(receiptSpki))
            .ToLowerInvariant();
        }
        finally
        {
          CryptographicOperations.ZeroMemory(attestationSpki);
          CryptographicOperations.ZeroMemory(receiptSpki);
          CryptographicOperations.ZeroMemory(actionVerificationSpki);
        }
      }
      _attestationKey = attestationKey;
      _receiptKey = receiptKey;
      attestationKey = null;
      receiptKey = null;
    }
    catch
    {
      attestationKey?.Dispose();
      receiptKey?.Dispose();
      _attestationCertificate.Dispose();
      _receiptCertificate.Dispose();
      throw;
    }
  }

  public string AttestationKeyId { get; }

  public string ReceiptKeyId { get; }

  public string ReceiptPublicKeySpkiBase64 { get; }

  public string ReceiptPublicKeySha256 { get; }

  public SignedBoundaryAttestation SignAttestation(BoundaryAttestationV1 attestation)
  {
    ThrowIfDisposed();
    lock (_signingGate)
    {
      return EgressBoundaryCanonical.SignAttestation(
        attestation,
        AttestationKeyId,
        _attestationKey);
    }
  }

  public SignedCapabilityBoundaryAttestation SignCapabilityAttestation(
    CapabilityBoundaryAttestationV1 attestation)
  {
    ThrowIfDisposed();
    lock (_signingGate)
    {
      return CapabilityBoundaryAttestationCanonical.Sign(
        attestation,
        AttestationKeyId,
        _attestationKey);
    }
  }

  public SignedEgressLease SignLease(EgressLeaseV1 lease)
  {
    ThrowIfDisposed();
    lock (_signingGate)
    {
      return EgressBoundaryCanonical.SignLease(lease, ReceiptKeyId, _receiptKey);
    }
  }

  public SignedEgressReceipt SignReceipt(EgressReceiptV1 receipt)
  {
    ThrowIfDisposed();
    lock (_signingGate)
    {
      return EgressBoundaryCanonical.SignReceipt(receipt, ReceiptKeyId, _receiptKey);
    }
  }

  public bool VerifyAttestation(SignedBoundaryAttestation attestation)
  {
    ThrowIfDisposed();
    lock (_signingGate)
    {
      return string.Equals(attestation.KeyId, AttestationKeyId, StringComparison.Ordinal)
        && Verify(
          _attestationKey,
          EgressBoundaryCanonical.AttestationBytes(attestation.Attestation),
          attestation.SignatureBase64);
    }
  }

  public bool VerifyCapabilityAttestation(
    SignedCapabilityBoundaryAttestation attestation)
  {
    ThrowIfDisposed();
    lock (_signingGate)
    {
      return string.Equals(attestation.KeyId, AttestationKeyId, StringComparison.Ordinal)
        && string.Equals(
          attestation.SignaturePurpose,
          CapabilityBoundaryAttestationContract.SignaturePurpose,
          StringComparison.Ordinal)
        && CapabilityBoundaryAttestationCanonical.Verify(
          _attestationKey,
          CapabilityBoundaryAttestationCanonical.Bytes(attestation.Attestation),
          attestation.SignatureBase64);
    }
  }

  public bool VerifyLease(SignedEgressLease lease)
  {
    ThrowIfDisposed();
    lock (_signingGate)
    {
      return string.Equals(lease.KeyId, ReceiptKeyId, StringComparison.Ordinal)
        && Verify(
          _receiptKey,
          EgressBoundaryCanonical.LeaseBytes(lease.Lease),
          lease.SignatureBase64);
    }
  }

  public bool VerifyReceipt(SignedEgressReceipt receipt)
  {
    ThrowIfDisposed();
    lock (_signingGate)
    {
      return string.Equals(receipt.KeyId, ReceiptKeyId, StringComparison.Ordinal)
        && Verify(
          _receiptKey,
          EgressBoundaryCanonical.ReceiptBytes(receipt.Receipt),
          receipt.SignatureBase64);
    }
  }

  public void Dispose()
  {
    if (Interlocked.Exchange(ref _disposed, 1) != 0)
    {
      return;
    }

    _attestationKey.Dispose();
    _receiptKey.Dispose();
    _attestationCertificate.Dispose();
    _receiptCertificate.Dispose();
  }

  private static X509Certificate2 ResolveUnique(string thumbprint)
  {
    using var store = new X509Store(StoreName.My, StoreLocation.LocalMachine);
    store.Open(OpenFlags.OpenExistingOnly | OpenFlags.ReadOnly);
    var matches = store.Certificates.Find(
      X509FindType.FindByThumbprint,
      thumbprint,
      validOnly: true);
    try
    {
      if (matches.Count != 1)
      {
        throw new InvalidOperationException(
          "Each egress signing-key thumbprint must resolve exactly once.");
      }
      return new X509Certificate2(matches[0]);
    }
    finally
    {
      foreach (var match in matches)
      {
        match.Dispose();
      }
    }
  }

  private static ECDsaCng ResolvePrivateP256(
    X509Certificate2 certificate,
    SecurityIdentifier supervisorSid)
  {
    if (!certificate.HasPrivateKey
      || certificate.NotBefore.ToUniversalTime() > DateTime.UtcNow
      || certificate.NotAfter.ToUniversalTime() <= DateTime.UtcNow
      || certificate.Extensions.OfType<X509BasicConstraintsExtension>()
        .Any(extension => extension.CertificateAuthority))
    {
      throw new InvalidOperationException("An egress signing certificate is invalid.");
    }

    var cng = certificate.GetECDsaPrivateKey() as ECDsaCng;
    var privateKey = cng?.Key;
    var provider = privateKey?.Provider;
    if (cng is null
      || privateKey is null
      || provider is null
      || cng.KeySize != 256
      || !privateKey.IsMachineKey
      || !string.Equals(
        provider.Provider,
        "Microsoft Platform Crypto Provider",
        StringComparison.Ordinal)
      || privateKey.ExportPolicy != CngExportPolicies.None
      || !HasExactPrivateKeyAcl(privateKey, supervisorSid))
    {
      cng?.Dispose();
      throw new InvalidOperationException(
        "Egress signing keys must be non-exportable, machine-scoped TPM P-256 keys "
        + "with an exact restricted-service-only ACL.");
    }
    return cng;
  }

  private static bool HasExactPrivateKeyAcl(
    CngKey key,
    SecurityIdentifier supervisorSid)
  {
    try
    {
      // NCRYPT_SECURITY_DESCR_PROPERTY with DACL_SECURITY_INFORMATION (0x4).
      var property = key.GetProperty("Security Descr", (CngPropertyOptions)0x4);
      var value = property.GetValue();
      if (value is null)
      {
        return false;
      }
      return IsExactPrivateKeyDescriptor(
        new RawSecurityDescriptor(value, 0),
        supervisorSid);
    }
    catch (Exception exception) when (exception is CryptographicException
      or ArgumentException)
    {
      return false;
    }
  }

  internal static bool IsExactPrivateKeyDescriptor(
    RawSecurityDescriptor descriptor,
    SecurityIdentifier supervisorSid)
  {
    const int GenericAll = unchecked((int)0x10000000);
    var systemSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
    if (descriptor.Owner is null
      || !descriptor.Owner.Equals(systemSid)
      || !descriptor.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclProtected)
      || descriptor.DiscretionaryAcl is null
      || descriptor.DiscretionaryAcl.Count != 1)
    {
      return false;
    }

    var observed = new HashSet<SecurityIdentifier>();
    foreach (GenericAce genericAce in descriptor.DiscretionaryAcl)
    {
      // The restricted service SID is present in both the normal and
      // restricting SID sets. Its one explicit grant satisfies both access
      // checks without making the private key directly usable by arbitrary
      // LocalSystem processes. Rejecting every other ACE shape also prevents
      // an ObjectAce or inherited grant from being silently skipped.
      if (genericAce is not CommonAce ace
        || ace.AceQualifier != AceQualifier.AccessAllowed
        || ace.AceFlags != AceFlags.None
        || ace.IsCallback
        || ace.AccessMask != GenericAll
        || ace.SecurityIdentifier is null
        || !ace.SecurityIdentifier.Equals(supervisorSid)
        || !observed.Add(ace.SecurityIdentifier))
      {
        return false;
      }
    }
    return observed.SetEquals([supervisorSid]);
  }

  internal static bool ArePurposeSeparatedPublicSpkis(
    ReadOnlySpan<byte> attestationSpki,
    ReadOnlySpan<byte> receiptSpki,
    ReadOnlySpan<byte> actionVerificationSpki) =>
    !attestationSpki.IsEmpty
    && !receiptSpki.IsEmpty
    && !actionVerificationSpki.IsEmpty
    && !SamePublicSpki(attestationSpki, receiptSpki)
    && !SamePublicSpki(attestationSpki, actionVerificationSpki)
    && !SamePublicSpki(receiptSpki, actionVerificationSpki);

  private static bool SamePublicSpki(ReadOnlySpan<byte> left, ReadOnlySpan<byte> right) =>
    left.Length == right.Length
    && CryptographicOperations.FixedTimeEquals(left, right);

  private static bool TryNormalizeThumbprint(string value, out string normalized)
  {
    normalized = string.Concat(value.Where(character => !char.IsWhiteSpace(character)))
      .ToUpperInvariant();
    return normalized.Length == 40
      && normalized.All(Uri.IsHexDigit);
  }

  private static bool IsSafeKeyId(string value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 128
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_' or ':');

  private static bool Verify(ECDsa key, byte[] data, string signatureBase64)
  {
    try
    {
      var signature = Convert.FromBase64String(signatureBase64);
      try
      {
        return signature.Length == 64
          && key.VerifyData(
            data,
            signature,
            HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(signature);
      }
    }
    catch (FormatException)
    {
      return false;
    }
    finally
    {
      CryptographicOperations.ZeroMemory(data);
    }
  }

  private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(
    Volatile.Read(ref _disposed) != 0,
    this);
}
