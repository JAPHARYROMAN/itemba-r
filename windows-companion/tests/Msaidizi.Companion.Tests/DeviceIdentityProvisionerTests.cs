using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class DeviceIdentityProvisionerTests : IDisposable
{
  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"msaidizi-device-identity-{Guid.NewGuid():N}");

  [Fact]
  public void ProductionDefaultsSelectOnlyTheTpmProvider()
  {
    var options = new BrokerChannelOptions();

    Assert.True(options.RequireHardwareBackedDeviceIdentity);
    Assert.False(options.DevelopmentOnlyAllowSoftwareDeviceIdentity);
    Assert.True(options.PreferTpm);
    var provider = Assert.Single(DeviceIdentityPolicy.ProvisioningProviders(options));
    Assert.Equal(CngProvider.MicrosoftPlatformCryptoProvider.Provider, provider.Provider);
  }

  [Theory]
  [InlineData(true, true, true)]
  [InlineData(false, false, true)]
  [InlineData(true, false, false)]
  public void ContradictoryOrWeakenedIdentityPolicyFailsClosed(
    bool requireHardware,
    bool developmentSoftware,
    bool preferTpm)
  {
    var options = new BrokerChannelOptions
    {
      RequireHardwareBackedDeviceIdentity = requireHardware,
      DevelopmentOnlyAllowSoftwareDeviceIdentity = developmentSoftware,
      PreferTpm = preferTpm,
    };

    Assert.Throws<InvalidOperationException>(() =>
      DeviceIdentityPolicy.ProvisioningProviders(options));
  }

  [Fact]
  public void ExplicitDevelopmentOverrideCanSelectSoftwareOrTpmFirstFallback()
  {
    var options = new BrokerChannelOptions
    {
      RequireHardwareBackedDeviceIdentity = false,
      DevelopmentOnlyAllowSoftwareDeviceIdentity = true,
      PreferTpm = false,
    };

    var softwareOnly = DeviceIdentityPolicy.ProvisioningProviders(options);
    Assert.Equal(
      CngProvider.MicrosoftSoftwareKeyStorageProvider.Provider,
      Assert.Single(softwareOnly).Provider);

    options.PreferTpm = true;
    var tpmFirst = DeviceIdentityPolicy.ProvisioningProviders(options);
    Assert.Equal(2, tpmFirst.Count);
    Assert.Equal(CngProvider.MicrosoftPlatformCryptoProvider.Provider, tpmFirst[0].Provider);
    Assert.Equal(CngProvider.MicrosoftSoftwareKeyStorageProvider.Provider, tpmFirst[1].Provider);
  }

  [Fact]
  public async Task ExplicitDevelopmentSoftwareIdentityIsNonExportablePersistedAndRejectedByProductionPolicy()
  {
    var prefix = $"Itemba.Msaidizi.Test.{Guid.NewGuid():N}";
    var options = new BrokerChannelOptions
    {
      BootstrapIdentityEnabled = true,
      RequireHardwareBackedDeviceIdentity = false,
      DevelopmentOnlyAllowSoftwareDeviceIdentity = true,
      PreferTpm = false,
      DeviceIdentityRecordPath = Path.Combine(_directory, "identity.bin"),
      DeviceKeyNamePrefix = prefix,
      DeviceCertificateStoreName = StoreName.My.ToString(),
      DeviceCertificateStoreLocation = StoreLocation.CurrentUser.ToString(),
      CertificateValidityDays = 30,
    };
    string? thumbprint = null;
    string? keyName = null;
    try
    {
      using var provisioner = new DeviceIdentityProvisioner(Options.Create(options));
      using (var first = await provisioner.GetOrCreateAsync(
        "device-software-ksp",
        CancellationToken.None))
      {
        thumbprint = first.Certificate.Thumbprint;
        keyName = first.KeyName;
        Assert.False(first.HardwareBacked);
        Assert.False(first.IsPaired);
        Assert.Equal(
          CngProvider.MicrosoftSoftwareKeyStorageProvider.Provider,
          first.KeyProvider);
        Assert.Equal(256, first.Certificate.GetECDsaPublicKey()!.KeySize);
        using var privateKey = Assert.IsType<ECDsaCng>(first.Certificate.GetECDsaPrivateKey());
        Assert.Throws<CryptographicException>(() => privateKey.ExportPkcs8PrivateKey());
        Assert.Matches("^[0-9A-F]{64}$", first.CertificateSha256);
        Assert.Matches("^[0-9A-F]{64}$", first.SubjectPublicKeyInfoSha256);
        await provisioner.MarkPairedAsync(first, CancellationToken.None);
      }

      using var replay = await provisioner.GetOrCreateAsync(
        "device-software-ksp",
        CancellationToken.None);
      Assert.True(replay.IsPaired);
      Assert.Equal(thumbprint, replay.Certificate.Thumbprint);
      Assert.Equal(keyName, replay.KeyName);

      var productionOptions = new BrokerChannelOptions
      {
        BootstrapIdentityEnabled = true,
        RequireHardwareBackedDeviceIdentity = true,
        DevelopmentOnlyAllowSoftwareDeviceIdentity = false,
        PreferTpm = true,
        DeviceIdentityRecordPath = options.DeviceIdentityRecordPath,
        DeviceKeyNamePrefix = prefix,
        DeviceCertificateStoreName = StoreName.My.ToString(),
        DeviceCertificateStoreLocation = StoreLocation.CurrentUser.ToString(),
        CertificateValidityDays = 30,
      };
      using var productionProvisioner = new DeviceIdentityProvisioner(
        Options.Create(productionOptions));
      var exception = await Assert.ThrowsAsync<CryptographicException>(async () =>
      {
        using var _ = await productionProvisioner.GetOrCreateAsync(
          "device-software-ksp",
          CancellationToken.None);
      });
      Assert.Contains("hardware-backed key policy", exception.Message, StringComparison.Ordinal);

      var protectedRecord = await File.ReadAllBytesAsync(options.DeviceIdentityRecordPath);
      Assert.DoesNotContain(
        "device-software-ksp",
        Encoding.UTF8.GetString(protectedRecord),
        StringComparison.Ordinal);
    }
    finally
    {
      if (thumbprint is not null)
      {
        using var store = new X509Store(StoreName.My, StoreLocation.CurrentUser);
        store.Open(OpenFlags.ReadWrite);
        foreach (var certificate in store.Certificates.Find(
          X509FindType.FindByThumbprint,
          thumbprint,
          validOnly: false))
        {
          store.Remove(certificate);
          certificate.Dispose();
        }
      }

      if (keyName is not null
        && CngKey.Exists(
          keyName,
          CngProvider.MicrosoftSoftwareKeyStorageProvider,
          CngKeyOpenOptions.None))
      {
        using var key = CngKey.Open(
          keyName,
          CngProvider.MicrosoftSoftwareKeyStorageProvider,
          CngKeyOpenOptions.None);
        key.Delete();
      }
    }
  }

  public void Dispose()
  {
    if (Directory.Exists(_directory))
    {
      Directory.Delete(_directory, recursive: true);
    }
  }
}
