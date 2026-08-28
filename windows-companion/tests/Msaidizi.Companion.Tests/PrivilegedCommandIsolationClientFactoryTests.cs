using System.Security.Cryptography;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class PrivilegedCommandIsolationClientFactoryTests : IDisposable
{
  private const string DeviceId = "10000000-0000-4000-8000-000000000001";
  private readonly ECDsa[] _keys =
  [
    ECDsa.Create(ECCurve.NamedCurves.nistP256),
    ECDsa.Create(ECCurve.NamedCurves.nistP256),
    ECDsa.Create(ECCurve.NamedCurves.nistP256),
    ECDsa.Create(ECCurve.NamedCurves.nistP256),
  ];

  [Fact]
  public void PackagedConfigurationRetainsTheDisabledRejectingDefault()
  {
    var path = Path.Combine(
      AppContext.BaseDirectory,
      "test-assets",
      "service-appsettings.json");
    using var document = JsonDocument.Parse(File.ReadAllText(path));
    var configured = document.RootElement.GetProperty(
      PrivilegedCommandIsolationClientOptions.SectionName);

    Assert.False(configured.GetProperty("Enabled").GetBoolean());
    Assert.Equal("disabled", configured.GetProperty("Transport").GetString());
    Assert.Equal(string.Empty, configured.GetProperty("PipeName").GetString());
    Assert.Equal(
      string.Empty,
      configured.GetProperty("ExpectedSupervisorImageSha256").GetString());
    Assert.Equal(
      string.Empty,
      configured.GetProperty("ReservationLeasePublicKey")
        .GetProperty("SubjectPublicKeyInfoBase64").GetString());
  }

  [Fact]
  public void FactorySelectsNamedPipeOnlyForACompleteExactTrustBundle()
  {
    var fallback = new RejectingPrivilegedCommandTrustedRootIsolationGate();
    var selected = PrivilegedCommandIsolationClientFactory.Create(
      ValidOptions(),
      new CompanionOptions { DeviceId = DeviceId },
      fallback);

    Assert.IsType<NamedPipePrivilegedCommandTrustedRootIsolationClient>(selected);

    Action<PrivilegedCommandIsolationClientOptions>[] makeIncomplete =
    [
      options => options.Enabled = false,
      options => options.Transport = "named-pipe",
      options => options.ProtocolVersion = 1,
      options => options.PipeName = string.Empty,
      options => options.ExpectedSupervisorImagePath = string.Empty,
      options => options.ExpectedSupervisorImageSha256 = string.Empty,
      options => options.ExpectedSupervisorServiceSid = "S-1-5-80-1-2-3-4-5",
      options => options.ExpectedDeviceId = Guid.NewGuid().ToString("D"),
      options => options.ExpectedIsolationPolicySha256 = string.Empty,
      options => options.ExpectedDriverMeasurementSha256 = string.Empty,
      options => options.ExpectedServiceMeasurementSha256 = string.Empty,
      options => options.MaximumFrameBytes = 1024,
      options => options.ConnectTimeoutMilliseconds = 99,
      options => options.OperationTimeoutMilliseconds = 30_001,
      options => options.ReservationRequestLifetimeSeconds = 0,
      options => options.AllowedClockSkewSeconds = 121,
      options => options.MaximumReservationRequestAgeSeconds = 301,
      options => options.MaximumReservationLeaseLifetimeSeconds = 601,
      options => options.MaximumBindAcknowledgementLifetimeSeconds = 121,
      options => options.MaximumExecutionDurationSeconds = 7_201,
      options => options.MaximumReceiptDelaySeconds = 1_801,
      options => options.ReservationLeasePublicKey.KeyId = string.Empty,
      options => options.PreBindReservationReleasePublicKey
        .SubjectPublicKeyInfoBase64 = string.Empty,
      options => options.SuspendedProcessBindAcknowledgementPublicKey = null!,
      options => options.TerminalEnforcementReceiptPublicKey
        .SubjectPublicKeyInfoBase64 = "not-base64",
    ];

    foreach (var mutate in makeIncomplete)
    {
      var options = ValidOptions();
      mutate(options);
      Assert.Same(
        fallback,
        PrivilegedCommandIsolationClientFactory.Create(
          options,
          new CompanionOptions { DeviceId = DeviceId },
          fallback));
    }

    Assert.Same(
      fallback,
      PrivilegedCommandIsolationClientFactory.Create(
        ValidOptions(),
        new CompanionOptions { DeviceId = Guid.NewGuid().ToString("D") },
        fallback));
  }

  [Fact]
  public void FactoryRequiresFourIndependentPublicOnlyP256Pins()
  {
    var fallback = new RejectingPrivilegedCommandTrustedRootIsolationGate();
    var duplicateKeyId = ValidOptions();
    duplicateKeyId.TerminalEnforcementReceiptPublicKey.KeyId =
      duplicateKeyId.ReservationLeasePublicKey.KeyId;
    Assert.Same(
      fallback,
      PrivilegedCommandIsolationClientFactory.Create(
        duplicateKeyId,
        new CompanionOptions { DeviceId = DeviceId },
        fallback));

    var duplicateSpki = ValidOptions();
    duplicateSpki.TerminalEnforcementReceiptPublicKey.SubjectPublicKeyInfoBase64 =
      duplicateSpki.ReservationLeasePublicKey.SubjectPublicKeyInfoBase64;
    Assert.Same(
      fallback,
      PrivilegedCommandIsolationClientFactory.Create(
        duplicateSpki,
        new CompanionOptions { DeviceId = DeviceId },
        fallback));

    using var p384 = ECDsa.Create(ECCurve.NamedCurves.nistP384);
    var wrongCurve = ValidOptions();
    wrongCurve.TerminalEnforcementReceiptPublicKey.SubjectPublicKeyInfoBase64 =
      Convert.ToBase64String(p384.ExportSubjectPublicKeyInfo());
    Assert.Same(
      fallback,
      PrivilegedCommandIsolationClientFactory.Create(
        wrongCurve,
        new CompanionOptions { DeviceId = DeviceId },
        fallback));

    var privateKey = ValidOptions();
    privateKey.TerminalEnforcementReceiptPublicKey.SubjectPublicKeyInfoBase64 =
      Convert.ToBase64String(_keys[3].ExportPkcs8PrivateKey());
    Assert.Same(
      fallback,
      PrivilegedCommandIsolationClientFactory.Create(
        privateKey,
        new CompanionOptions { DeviceId = DeviceId },
        fallback));
  }

  [Fact]
  public void DependencyInjectionSharesOneSelectedInstanceAcrossLiveAndRecovery()
  {
    var services = new ServiceCollection();
    services.AddSingleton<IOptions<PrivilegedCommandIsolationClientOptions>>(
      Options.Create(ValidOptions()));
    services.AddSingleton<IOptions<CompanionOptions>>(
      Options.Create(new CompanionOptions { DeviceId = DeviceId }));
    PrivilegedCommandIsolationClientFactory.Register(services);

    using var provider = services.BuildServiceProvider();
    var gate = provider.GetRequiredService<
      IPrivilegedCommandTrustedRootIsolationGate>();
    var recovery = provider.GetRequiredService<
      IPrivilegedCommandTrustedRootIsolationRecovery>();

    Assert.IsType<NamedPipePrivilegedCommandTrustedRootIsolationClient>(gate);
    Assert.Same(gate, recovery);
  }

  [Fact]
  public void DependencyInjectionSharesTheRejectingFallbackWhenDisabled()
  {
    var options = ValidOptions();
    options.Enabled = false;
    var services = new ServiceCollection();
    services.AddSingleton<IOptions<PrivilegedCommandIsolationClientOptions>>(
      Options.Create(options));
    services.AddSingleton<IOptions<CompanionOptions>>(
      Options.Create(new CompanionOptions { DeviceId = DeviceId }));
    PrivilegedCommandIsolationClientFactory.Register(services);

    using var provider = services.BuildServiceProvider();
    var fallback = provider.GetRequiredService<
      RejectingPrivilegedCommandTrustedRootIsolationGate>();
    var gate = provider.GetRequiredService<
      IPrivilegedCommandTrustedRootIsolationGate>();
    var recovery = provider.GetRequiredService<
      IPrivilegedCommandTrustedRootIsolationRecovery>();

    Assert.Same(fallback, gate);
    Assert.Same(gate, recovery);
  }

  public void Dispose()
  {
    foreach (var key in _keys)
    {
      key.Dispose();
    }
  }

  private PrivilegedCommandIsolationClientOptions ValidOptions() => new()
  {
    Enabled = true,
    Transport = PrivilegedCommandIsolationClientFactory.NamedPipeTransport,
    ProtocolVersion = PrivilegedCommandIsolationPipeProtocol.Version,
    PipeName = "Itemba.Msaidizi.PrivilegedCommandIsolation.v2",
    ExpectedSupervisorImagePath = Path.GetFullPath(Environment.ProcessPath!),
    ExpectedSupervisorImageSha256 = new string('a', 64),
    ExpectedSupervisorServiceSid =
      PrivilegedCommandIsolationSupervisorIdentity.ServiceSid,
    ExpectedDeviceId = DeviceId,
    ExpectedIsolationPolicySha256 = new string('b', 64),
    ExpectedDriverMeasurementSha256 = new string('c', 64),
    ExpectedServiceMeasurementSha256 = new string('d', 64),
    MaximumFrameBytes = 131_072,
    ConnectTimeoutMilliseconds = 5_000,
    OperationTimeoutMilliseconds = 10_000,
    ReservationRequestLifetimeSeconds = 60,
    AllowedClockSkewSeconds = 30,
    MaximumReservationRequestAgeSeconds = 60,
    MaximumReservationLeaseLifetimeSeconds = 120,
    MaximumBindAcknowledgementLifetimeSeconds = 30,
    MaximumExecutionDurationSeconds = 7_200,
    MaximumReceiptDelaySeconds = 300,
    ReservationLeasePublicKey = PublicKey("reservation-v1", _keys[0]),
    PreBindReservationReleasePublicKey = PublicKey("release-v1", _keys[1]),
    SuspendedProcessBindAcknowledgementPublicKey = PublicKey("bind-v1", _keys[2]),
    TerminalEnforcementReceiptPublicKey = PublicKey("terminal-v1", _keys[3]),
  };

  private static PrivilegedCommandIsolationPublicKeyOptions PublicKey(
    string keyId,
    ECDsa key) => new()
    {
      KeyId = keyId,
      SubjectPublicKeyInfoBase64 = Convert.ToBase64String(
      key.ExportSubjectPublicKeyInfo()),
    };
}
