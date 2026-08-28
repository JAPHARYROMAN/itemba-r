using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Security;

internal interface IDeviceIdentityProvisioner
{
  ValueTask<ProvisionedDeviceIdentity> GetOrCreateAsync(
    string deviceId,
    CancellationToken cancellationToken);

  ValueTask MarkPairedAsync(
    ProvisionedDeviceIdentity identity,
    CancellationToken cancellationToken);
}

internal sealed record ProvisionedDeviceIdentity(
  X509Certificate2 Certificate,
  string CertificateSha256,
  string SubjectPublicKeyInfoSha256,
  string KeyName,
  string KeyProvider,
  bool HardwareBacked,
  bool IsPaired) : IDisposable
{
  public void Dispose() => Certificate.Dispose();
}

/// <summary>
/// Creates the device's persistent P-256 CNG identity outside the adapter
/// namespace. Production policy requires Microsoft Platform Crypto Provider;
/// a non-exportable Windows Software KSP identity is available only through the
/// explicitly named development/test override.
/// The identity record contains no key material and is DPAPI-bound to the
/// service identity.
/// </summary>
internal sealed class DeviceIdentityProvisioner : IDeviceIdentityProvisioner, IDisposable
{
  private static readonly JsonSerializerOptions SerializerOptions =
    new(JsonSerializerDefaults.Web);

  private readonly BrokerChannelOptions _options;
  private readonly SemaphoreSlim _gate = new(1, 1);

  public DeviceIdentityProvisioner(IOptions<BrokerChannelOptions> options)
  {
    _options = options.Value;
  }

  public async ValueTask<ProvisionedDeviceIdentity> GetOrCreateAsync(
    string deviceId,
    CancellationToken cancellationToken)
  {
    ValidateBootstrapOptions(deviceId);
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var record = await TryLoadRecordAsync(cancellationToken).ConfigureAwait(false);
      if (record is not null)
      {
        return LoadRecordedIdentity(deviceId, record);
      }

      var providers = DeviceIdentityPolicy.ProvisioningProviders(_options);
      CryptographicException? platformFailure = null;
      foreach (var provider in providers)
      {
        try
        {
          var identity = CreateIdentity(deviceId, provider);
          try
          {
            await StoreRecordAsync(ToRecord(deviceId, identity, isPaired: false, pairedAt: null),
              cancellationToken).ConfigureAwait(false);
            return identity;
          }
          catch
          {
            RemoveCertificate(identity.Certificate.Thumbprint);
            identity.Dispose();
            DeleteKey(identity.KeyName, provider, StoreOpenOptions());
            throw;
          }
        }
        catch (CryptographicException exception) when (
          DeviceIdentityPolicy.IsHardwareProvider(provider))
        {
          platformFailure = exception;
        }
      }

      throw _options.RequireHardwareBackedDeviceIdentity
        ? new CryptographicException(
          "The required TPM Platform Crypto Provider could not create the hardware-backed device identity. Software KSP fallback is disabled.",
          platformFailure)
        : new CryptographicException(
          "Neither the TPM Platform Crypto Provider nor the explicitly allowed development-only Windows Software KSP could create the device identity.",
          platformFailure);
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask MarkPairedAsync(
    ProvisionedDeviceIdentity identity,
    CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var record = await TryLoadRecordAsync(cancellationToken).ConfigureAwait(false)
        ?? throw new InvalidOperationException("The device identity record is missing.");
      if (!RecordMatchesIdentity(record, identity))
      {
        throw new CryptographicException("The protected device identity record does not match the TLS identity.");
      }

      if (!record.IsPaired)
      {
        await StoreRecordAsync(record with
        {
          IsPaired = true,
          PairedAt = DateTimeOffset.UtcNow,
        }, cancellationToken).ConfigureAwait(false);
      }
    }
    finally
    {
      _gate.Release();
    }
  }

  public void Dispose() => _gate.Dispose();

  private ProvisionedDeviceIdentity CreateIdentity(string deviceId, CngProvider provider)
  {
    var keyName = KeyName(deviceId);
    var openOptions = StoreOpenOptions();
    CngKey? key = null;
    var created = false;
    try
    {
      if (CngKey.Exists(keyName, provider, openOptions))
      {
        key = CngKey.Open(keyName, provider, openOptions);
      }
      else
      {
        var creation = new CngKeyCreationParameters
        {
          ExportPolicy = CngExportPolicies.None,
          KeyCreationOptions = openOptions == CngKeyOpenOptions.MachineKey
            ? CngKeyCreationOptions.MachineKey
            : CngKeyCreationOptions.None,
          KeyUsage = CngKeyUsages.Signing,
          Provider = provider,
        };
        key = CngKey.Create(CngAlgorithm.ECDsaP256, keyName, creation);
        created = true;
      }

      EnsureKeyPolicy(key, provider);
      using var signingKey = new ECDsaCng(key);
      key = null; // ECDsaCng owns it.
      var request = new CertificateRequest(
        "CN=Itemba Msaidizi Device",
        signingKey,
        HashAlgorithmName.SHA256);
      request.CertificateExtensions.Add(new X509BasicConstraintsExtension(
        certificateAuthority: false,
        hasPathLengthConstraint: false,
        pathLengthConstraint: 0,
        critical: true));
      request.CertificateExtensions.Add(new X509KeyUsageExtension(
        X509KeyUsageFlags.DigitalSignature,
        critical: true));
      request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(
        new OidCollection { new("1.3.6.1.5.5.7.3.2", "Client Authentication") },
        critical: true));
      var subjectAlternativeName = new SubjectAlternativeNameBuilder();
      subjectAlternativeName.AddUri(new Uri(
        $"urn:itemba:msaidizi:device:{Uri.EscapeDataString(deviceId)}",
        UriKind.Absolute));
      request.CertificateExtensions.Add(subjectAlternativeName.Build(critical: false));

      var now = DateTimeOffset.UtcNow;
      using var createdCertificate = request.CreateSelfSigned(
        now.AddMinutes(-5),
        now.AddDays(_options.CertificateValidityDays));
      using (var store = OpenStore(OpenFlags.ReadWrite))
      {
        store.Add(createdCertificate);
      }

      var certificate = FindCertificate(createdCertificate.Thumbprint);
      var identity = DescribeIdentity(
        certificate,
        keyName,
        provider.Provider,
        hardwareBacked: DeviceIdentityPolicy.IsHardwareProvider(provider),
        isPaired: false);
      created = false;
      return identity;
    }
    catch
    {
      key?.Dispose();
      if (created)
      {
        DeleteKey(keyName, provider, openOptions);
      }
      throw;
    }
  }

  private ProvisionedDeviceIdentity LoadRecordedIdentity(
    string deviceId,
    DeviceIdentityRecord record)
  {
    if (!string.Equals(record.DeviceId, deviceId, StringComparison.Ordinal)
      || !PayloadDigest.IsSha256Hex(record.CertificateSha256)
      || !PayloadDigest.IsSha256Hex(record.SubjectPublicKeyInfoSha256)
      || string.IsNullOrWhiteSpace(record.CertificateThumbprint)
      || string.IsNullOrWhiteSpace(record.KeyName)
      || string.IsNullOrWhiteSpace(record.KeyProvider))
    {
      throw new CryptographicException("The protected device identity record is invalid.");
    }

    DeviceIdentityPolicy.EnsurePersistedIdentityAllowed(
      _options,
      record.KeyProvider,
      record.HardwareBacked);

    var certificate = FindCertificate(record.CertificateThumbprint);
    var identity = DescribeIdentity(
      certificate,
      record.KeyName,
      record.KeyProvider,
      record.HardwareBacked,
      record.IsPaired);
    if (!RecordMatchesIdentity(record, identity))
    {
      identity.Dispose();
      throw new CryptographicException("The protected device identity record does not match the certificate store.");
    }

    return identity;
  }

  private static ProvisionedDeviceIdentity DescribeIdentity(
    X509Certificate2 certificate,
    string keyName,
    string providerName,
    bool hardwareBacked,
    bool isPaired)
  {
    try
    {
      if (!certificate.HasPrivateKey
        || certificate.NotBefore.ToUniversalTime() > DateTime.UtcNow
        || certificate.NotAfter.ToUniversalTime() <= DateTime.UtcNow)
      {
        throw new CryptographicException("The device certificate is unavailable or expired.");
      }

      using var privateKey = certificate.GetECDsaPrivateKey();
      if (privateKey is not ECDsaCng ecdsa
        || ecdsa.KeySize != 256
        || !string.Equals(ecdsa.Key.KeyName, keyName, StringComparison.Ordinal)
        || !string.Equals(ecdsa.Key.Provider?.Provider, providerName, StringComparison.Ordinal)
        || !IsNonExportable(ecdsa.Key.ExportPolicy))
      {
        throw new CryptographicException("The device certificate is not bound to the expected non-exportable P-256 CNG key.");
      }

      return new ProvisionedDeviceIdentity(
        certificate,
        Convert.ToHexString(SHA256.HashData(certificate.RawData)),
        Convert.ToHexString(SHA256.HashData(certificate.PublicKey.ExportSubjectPublicKeyInfo())),
        keyName,
        providerName,
        hardwareBacked,
        isPaired);
    }
    catch
    {
      certificate.Dispose();
      throw;
    }
  }

  private X509Certificate2 FindCertificate(string thumbprint)
  {
    using var store = OpenStore(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
    var matches = store.Certificates.Find(
      X509FindType.FindByThumbprint,
      NormalizeHex(thumbprint),
      validOnly: false);
    var candidates = matches.Cast<X509Certificate2>().ToArray();
    if (candidates.Length != 1)
    {
      foreach (var candidate in candidates)
      {
        candidate.Dispose();
      }

      throw new CryptographicException(
        "Exactly one certificate must match the protected device identity record.");
    }

    return candidates[0];
  }

  private X509Store OpenStore(OpenFlags flags)
  {
    if (!Enum.TryParse<StoreName>(_options.DeviceCertificateStoreName, out var name)
      || !Enum.TryParse<StoreLocation>(_options.DeviceCertificateStoreLocation, out var location))
    {
      throw new InvalidOperationException("The configured device certificate store is invalid.");
    }

    var store = new X509Store(name, location);
    try
    {
      store.Open(flags);
      return store;
    }
    catch
    {
      store.Dispose();
      throw;
    }
  }

  private void RemoveCertificate(string thumbprint)
  {
    using var store = OpenStore(OpenFlags.ReadWrite);
    foreach (var certificate in store.Certificates.Find(
      X509FindType.FindByThumbprint,
      thumbprint,
      validOnly: false))
    {
      store.Remove(certificate);
      certificate.Dispose();
    }
  }

  private async ValueTask<DeviceIdentityRecord?> TryLoadRecordAsync(
    CancellationToken cancellationToken)
  {
    var path = IdentityRecordPath();
    if (!File.Exists(path))
    {
      return null;
    }

    var ciphertext = await File.ReadAllBytesAsync(path, cancellationToken).ConfigureAwait(false);
    byte[] plaintext;
    try
    {
      plaintext = WindowsDataProtection.Unprotect(ciphertext);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(ciphertext);
    }

    try
    {
      return JsonSerializer.Deserialize<DeviceIdentityRecord>(plaintext, SerializerOptions)
        ?? throw new CryptographicException("The protected device identity record is empty.");
    }
    catch (JsonException exception)
    {
      throw new CryptographicException("The protected device identity record is malformed.", exception);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(plaintext);
    }
  }

  private async ValueTask StoreRecordAsync(
    DeviceIdentityRecord record,
    CancellationToken cancellationToken)
  {
    var path = IdentityRecordPath();
    var directory = Path.GetDirectoryName(path)
      ?? throw new InvalidOperationException("The identity record has no parent directory.");
    Directory.CreateDirectory(directory);
    var plaintext = JsonSerializer.SerializeToUtf8Bytes(record, SerializerOptions);
    byte[] ciphertext;
    try
    {
      ciphertext = WindowsDataProtection.Protect(plaintext);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(plaintext);
    }

    try
    {
      var temporary = Path.Combine(directory, $".{Guid.NewGuid():N}.tmp");
      try
      {
        await using (var stream = new FileStream(
          temporary,
          FileMode.CreateNew,
          FileAccess.Write,
          FileShare.None,
          4096,
          FileOptions.Asynchronous | FileOptions.WriteThrough))
        {
          await stream.WriteAsync(ciphertext, cancellationToken).ConfigureAwait(false);
          await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
          stream.Flush(flushToDisk: true);
        }

        File.Move(temporary, path, overwrite: true);
      }
      finally
      {
        if (File.Exists(temporary))
        {
          File.Delete(temporary);
        }
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(ciphertext);
    }
  }

  private void ValidateBootstrapOptions(string deviceId)
  {
    DeviceIdentityPolicy.Validate(_options);
    if (!_options.BootstrapIdentityEnabled
      || string.IsNullOrWhiteSpace(deviceId)
      || string.Equals(deviceId, "UNENROLLED", StringComparison.Ordinal)
      || deviceId.Length > 160
      || string.IsNullOrWhiteSpace(_options.DeviceKeyNamePrefix)
      || _options.DeviceKeyNamePrefix.Length > 80
      || _options.DeviceKeyNamePrefix.Any(character =>
        !(char.IsAsciiLetterOrDigit(character) || character is '.' or '-' or '_'))
      || _options.CertificateValidityDays is < 30 or > 3_650)
    {
      throw new InvalidOperationException("The device identity bootstrap configuration is invalid.");
    }

    _ = IdentityRecordPath();
    _ = StoreOpenOptions();
  }

  private string IdentityRecordPath()
  {
    var path = Path.GetFullPath(Environment.ExpandEnvironmentVariables(
      _options.DeviceIdentityRecordPath));
    if (!Path.IsPathFullyQualified(path))
    {
      throw new InvalidOperationException("The protected device identity record path must be absolute.");
    }

    return path;
  }

  private CngKeyOpenOptions StoreOpenOptions()
  {
    if (!Enum.TryParse<StoreLocation>(_options.DeviceCertificateStoreLocation, out var location))
    {
      throw new InvalidOperationException("The configured device certificate store location is invalid.");
    }

    return location == StoreLocation.LocalMachine
      ? CngKeyOpenOptions.MachineKey
      : CngKeyOpenOptions.None;
  }

  private string KeyName(string deviceId) =>
    $"{_options.DeviceKeyNamePrefix}.{PayloadDigest.Sha256Hex(deviceId)[..32]}";

  private static DeviceIdentityRecord ToRecord(
    string deviceId,
    ProvisionedDeviceIdentity identity,
    bool isPaired,
    DateTimeOffset? pairedAt) => new(
      Version: 1,
      DeviceId: deviceId,
      CertificateThumbprint: identity.Certificate.Thumbprint,
      CertificateSha256: identity.CertificateSha256,
      SubjectPublicKeyInfoSha256: identity.SubjectPublicKeyInfoSha256,
      KeyName: identity.KeyName,
      KeyProvider: identity.KeyProvider,
      HardwareBacked: identity.HardwareBacked,
      IsPaired: isPaired,
      CreatedAt: DateTimeOffset.UtcNow,
      PairedAt: pairedAt);

  private static bool RecordMatchesIdentity(
    DeviceIdentityRecord record,
    ProvisionedDeviceIdentity identity) =>
    record.Version == 1
    && string.Equals(
      NormalizeHex(record.CertificateThumbprint),
      NormalizeHex(identity.Certificate.Thumbprint),
      StringComparison.Ordinal)
    && PayloadDigest.FixedTimeEqualsHex(record.CertificateSha256, identity.CertificateSha256)
    && PayloadDigest.FixedTimeEqualsHex(
      record.SubjectPublicKeyInfoSha256,
      identity.SubjectPublicKeyInfoSha256)
    && string.Equals(record.KeyName, identity.KeyName, StringComparison.Ordinal)
    && string.Equals(record.KeyProvider, identity.KeyProvider, StringComparison.Ordinal)
    && record.HardwareBacked == identity.HardwareBacked;

  private static void EnsureKeyPolicy(CngKey key, CngProvider provider)
  {
    if (key.AlgorithmGroup != CngAlgorithmGroup.ECDsa
      || key.KeySize != 256
      || !string.Equals(key.Provider?.Provider, provider.Provider, StringComparison.Ordinal)
      || !IsNonExportable(key.ExportPolicy)
      || (key.KeyUsage & CngKeyUsages.Signing) == 0)
    {
      throw new CryptographicException("The persisted CNG device key violates identity policy.");
    }
  }

  private static bool IsNonExportable(CngExportPolicies policy) =>
    (policy & (CngExportPolicies.AllowExport
      | CngExportPolicies.AllowPlaintextExport
      | CngExportPolicies.AllowArchiving
      | CngExportPolicies.AllowPlaintextArchiving)) == 0;

  private static void DeleteKey(
    string keyName,
    CngProvider provider,
    CngKeyOpenOptions options)
  {
    try
    {
      if (CngKey.Exists(keyName, provider, options))
      {
        using var key = CngKey.Open(keyName, provider, options);
        key.Delete();
      }
    }
    catch (CryptographicException)
    {
      // Preserve the original provisioning error. An installer/decommission
      // workflow must reconcile a provider key that could not be removed.
    }
  }

  private static string NormalizeHex(string value) => value
    .Replace(":", string.Empty, StringComparison.Ordinal)
    .Replace(" ", string.Empty, StringComparison.Ordinal)
    .ToUpperInvariant();

  private sealed record DeviceIdentityRecord(
    int Version,
    string DeviceId,
    string CertificateThumbprint,
    string CertificateSha256,
    string SubjectPublicKeyInfoSha256,
    string KeyName,
    string KeyProvider,
    bool HardwareBacked,
    bool IsPaired,
    DateTimeOffset CreatedAt,
    DateTimeOffset? PairedAt);
}

internal static class DeviceIdentityPolicy
{
  private static readonly CngProvider SoftwareProvider =
    CngProvider.MicrosoftSoftwareKeyStorageProvider;
  private static readonly CngProvider PlatformProvider =
    CngProvider.MicrosoftPlatformCryptoProvider;

  internal static void Validate(BrokerChannelOptions options)
  {
    ArgumentNullException.ThrowIfNull(options);
    if (options.RequireHardwareBackedDeviceIdentity
      == options.DevelopmentOnlyAllowSoftwareDeviceIdentity
      || (options.RequireHardwareBackedDeviceIdentity && !options.PreferTpm))
    {
      throw new InvalidOperationException(
        "Device identity policy must require hardware-backed identity for production, or explicitly enable the complementary development-only software identity override.");
    }
  }

  internal static IReadOnlyList<CngProvider> ProvisioningProviders(
    BrokerChannelOptions options)
  {
    Validate(options);
    if (options.RequireHardwareBackedDeviceIdentity)
    {
      return [PlatformProvider];
    }

    return options.PreferTpm
      ? [PlatformProvider, SoftwareProvider]
      : [SoftwareProvider];
  }

  internal static bool IsHardwareProvider(CngProvider provider) => string.Equals(
    provider.Provider,
    PlatformProvider.Provider,
    StringComparison.Ordinal);

  internal static void EnsurePersistedIdentityAllowed(
    BrokerChannelOptions options,
    string providerName,
    bool hardwareBacked)
  {
    Validate(options);
    var usesPlatformProvider = string.Equals(
      providerName,
      PlatformProvider.Provider,
      StringComparison.Ordinal);
    var usesSoftwareProvider = string.Equals(
      providerName,
      SoftwareProvider.Provider,
      StringComparison.Ordinal);
    if (hardwareBacked != usesPlatformProvider
      || (!usesPlatformProvider && !usesSoftwareProvider)
      || (options.RequireHardwareBackedDeviceIdentity && !usesPlatformProvider))
    {
      throw new CryptographicException(
        "The persisted device identity does not satisfy the configured hardware-backed key policy.");
    }
  }
}
