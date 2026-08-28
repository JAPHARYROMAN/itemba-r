using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.AccessControl;
using System.Security.Principal;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Configuration;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Security;

public interface IIsolationEvidenceSigner : IDisposable
{
  SignedPrivilegedCommandIsolationReservationLease Sign(
    PrivilegedCommandIsolationReservationLeaseV1 lease);

  SignedPrivilegedCommandIsolationPreBindRelease Sign(
    PrivilegedCommandIsolationPreBindReleaseV1 release);

  SignedPrivilegedCommandIsolationBindAcknowledgement Sign(
    PrivilegedCommandIsolationBindAcknowledgementV1 acknowledgement);

  SignedPrivilegedCommandIsolationTerminalReceipt Sign(
    PrivilegedCommandIsolationTerminalReceiptV1 receipt);
}

/// <summary>
/// The production signer accepts four purpose-distinct non-exportable
/// LocalMachine P-256 keys held by the Microsoft Platform Crypto Provider.
/// Every key's ACL grants use only to this supervisor's restricted service SID.
/// </summary>
public sealed class CertificateStoreIsolationEvidenceSigner : IIsolationEvidenceSigner
{
  private readonly PurposeSigningKey _reservationLeaseKey;
  private readonly PurposeSigningKey _preBindReleaseKey;
  private readonly PurposeSigningKey _bindAcknowledgementKey;
  private readonly PurposeSigningKey _terminalReceiptKey;
  private readonly object _gate = new();
  private int _disposed;

  public CertificateStoreIsolationEvidenceSigner(
    PrivilegedCommandSupervisorOptions options)
  {
    ArgumentNullException.ThrowIfNull(options);
    if (!options.Enabled)
    {
      throw new InvalidOperationException(
        "Isolation signing keys cannot load while the supervisor is safe-off.");
    }
    options.Validate();
    var supervisorSid = new SecurityIdentifier(
      SupervisorServiceIdentity.RequiredServiceSid);
    _reservationLeaseKey = ResolvePurposeKey(
      options.ReservationLeaseSigningKey,
      supervisorSid);
    try
    {
      _preBindReleaseKey = ResolvePurposeKey(
        options.PreBindReservationReleaseSigningKey,
        supervisorSid);
    }
    catch
    {
      _reservationLeaseKey.Dispose();
      throw;
    }
    try
    {
      _bindAcknowledgementKey = ResolvePurposeKey(
        options.SuspendedProcessBindAcknowledgementSigningKey,
        supervisorSid);
    }
    catch
    {
      _preBindReleaseKey.Dispose();
      _reservationLeaseKey.Dispose();
      throw;
    }
    try
    {
      _terminalReceiptKey = ResolvePurposeKey(
        options.TerminalEnforcementReceiptSigningKey,
        supervisorSid);
    }
    catch
    {
      _bindAcknowledgementKey.Dispose();
      _preBindReleaseKey.Dispose();
      _reservationLeaseKey.Dispose();
      throw;
    }
  }

  public SignedPrivilegedCommandIsolationReservationLease Sign(
    PrivilegedCommandIsolationReservationLeaseV1 lease) => WithKey(
      _reservationLeaseKey,
      key => PrivilegedCommandIsolationCanonical.SignReservationLease(
        lease,
        _reservationLeaseKey.KeyId,
        key));

  public SignedPrivilegedCommandIsolationPreBindRelease Sign(
    PrivilegedCommandIsolationPreBindReleaseV1 release) => WithKey(
      _preBindReleaseKey,
      key => PrivilegedCommandIsolationCanonical.SignPreBindRelease(
        release,
        _preBindReleaseKey.KeyId,
        key));

  public SignedPrivilegedCommandIsolationBindAcknowledgement Sign(
    PrivilegedCommandIsolationBindAcknowledgementV1 acknowledgement) => WithKey(
      _bindAcknowledgementKey,
      key => PrivilegedCommandIsolationCanonical.SignBindAcknowledgement(
        acknowledgement,
        _bindAcknowledgementKey.KeyId,
        key));

  public SignedPrivilegedCommandIsolationTerminalReceipt Sign(
    PrivilegedCommandIsolationTerminalReceiptV1 receipt) => WithKey(
      _terminalReceiptKey,
      key => PrivilegedCommandIsolationCanonical.SignTerminalReceipt(
        receipt,
        _terminalReceiptKey.KeyId,
        key));

  public void Dispose()
  {
    lock (_gate)
    {
      if (Interlocked.Exchange(ref _disposed, 1) == 0)
      {
        _terminalReceiptKey.Dispose();
        _bindAcknowledgementKey.Dispose();
        _preBindReleaseKey.Dispose();
        _reservationLeaseKey.Dispose();
      }
    }
  }

  private T WithKey<T>(PurposeSigningKey purposeKey, Func<ECDsa, T> operation)
  {
    lock (_gate)
    {
      ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
      return operation(purposeKey.PrivateKey);
    }
  }

  private static PurposeSigningKey ResolvePurposeKey(
    PrivilegedCommandSigningKeyOptions binding,
    SecurityIdentifier supervisorSid)
  {
    X509Certificate2 certificate;
    using (var store = new X509Store(StoreName.My, StoreLocation.LocalMachine))
    {
      store.Open(OpenFlags.OpenExistingOnly | OpenFlags.ReadOnly);
      var matches = store.Certificates.Find(
        X509FindType.FindByThumbprint,
        binding.CertificateThumbprint,
        validOnly: true);
      try
      {
        if (matches.Count != 1)
        {
          throw new InvalidOperationException(
            "Each isolation purpose certificate must resolve exactly once in LocalMachine\\My.");
        }
        certificate = new X509Certificate2(matches[0]);
      }
      finally
      {
        foreach (var match in matches)
        {
          match.Dispose();
        }
      }
    }

    ECDsa? key = null;
    ECDsaCng? privateKey = null;
    try
    {
      key = certificate.GetECDsaPrivateKey();
      privateKey = key as ECDsaCng;
      if (!certificate.HasPrivateKey
        || certificate.Extensions.OfType<X509BasicConstraintsExtension>()
          .Any(extension => extension.CertificateAuthority)
        || privateKey is null
        || privateKey.Key.KeySize != 256
        || privateKey.Key.Algorithm != CngAlgorithm.ECDsaP256
        || !privateKey.Key.IsMachineKey
        || !string.Equals(
          privateKey.Key.Provider?.Provider,
          CngProvider.MicrosoftPlatformCryptoProvider.Provider,
          StringComparison.Ordinal)
        || privateKey.Key.ExportPolicy != CngExportPolicies.None
        || !HasExactPrivateKeyAcl(privateKey.Key, supervisorSid))
      {
        throw new InvalidOperationException(
          "Each isolation signing key must be a non-exportable machine P-256 TPM key with an exact supervisor-only ACL.");
      }

      var spki = privateKey.ExportSubjectPublicKeyInfo();
      try
      {
        if (!string.Equals(
            Convert.ToBase64String(spki),
            binding.SubjectPublicKeyInfoBase64,
            StringComparison.Ordinal))
        {
          throw new InvalidOperationException(
            "An isolation purpose certificate does not match its pinned public SPKI.");
        }
      }
      finally
      {
        CryptographicOperations.ZeroMemory(spki);
      }
      return new PurposeSigningKey(binding.KeyId, certificate, privateKey);
    }
    catch
    {
      key?.Dispose();
      certificate.Dispose();
      throw;
    }
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
      return value is not null
        && IsExactPrivateKeyDescriptor(
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
    ArgumentNullException.ThrowIfNull(descriptor);
    ArgumentNullException.ThrowIfNull(supervisorSid);
    const int GenericAll = unchecked((int)0x10000000);
    var systemSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
    if (descriptor.Owner is null
      || !descriptor.Owner.Equals(systemSid)
      || !descriptor.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclProtected)
      || descriptor.DiscretionaryAcl is null
      || descriptor.DiscretionaryAcl.Count != 1
      || descriptor.DiscretionaryAcl[0] is not CommonAce ace
      || ace.AceQualifier != AceQualifier.AccessAllowed
      || ace.AceFlags != AceFlags.None
      || ace.IsCallback
      || ace.AccessMask != GenericAll
      || ace.SecurityIdentifier is null
      || !ace.SecurityIdentifier.Equals(supervisorSid))
    {
      return false;
    }
    return true;
  }

  private sealed class PurposeSigningKey(
    string keyId,
    X509Certificate2 certificate,
    ECDsaCng privateKey) : IDisposable
  {
    public string KeyId { get; } = keyId;

    public ECDsaCng PrivateKey { get; } = privateKey;

    public void Dispose()
    {
      PrivateKey.Dispose();
      certificate.Dispose();
    }
  }
}
