using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class NamedPipeEgressBoundaryClientTests : IDisposable
{
  private const string CompactActionToken = "compact-action-token";
  private const string ArgumentsJson = "{}";
  private static readonly DateTimeOffset Now =
    DateTimeOffset.FromUnixTimeMilliseconds(1_800_000_000_000);
  private readonly ECDsa _supervisorKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
  private readonly ECDsa _receiptKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);

  [Fact]
  public void PackagedConfigurationKeepsSupervisorTransportDisabled()
  {
    var path = Path.Combine(
      AppContext.BaseDirectory,
      "test-assets",
      "service-appsettings.json");
    using var document = JsonDocument.Parse(File.ReadAllText(path));
    var configured = document.RootElement.GetProperty(EgressSupervisorClientOptions.SectionName);

    Assert.False(configured.GetProperty("Enabled").GetBoolean());
    Assert.Equal("disabled", configured.GetProperty("Transport").GetString());
    Assert.Equal(string.Empty, configured.GetProperty("PipeName").GetString());
    Assert.Equal(
      string.Empty,
      configured.GetProperty("ExpectedSupervisorImageSha256").GetString());
    Assert.Equal(
      string.Empty,
      configured.GetProperty("ExpectedSupervisorPipeSecuritySha256").GetString());
    Assert.Equal(string.Empty, configured.GetProperty("AttestationKeyId").GetString());
  }

  [Fact]
  public void FactorySelectsNamedPipeOnlyWithEveryExactTransportAndTrustPin()
  {
    var configured = ClientOptions();
    var companion = Companion();
    var trust = Trust();

    Assert.IsType<NamedPipeEgressBoundaryClient>(EgressBoundaryClientFactory.Create(
      Options.Create(configured),
      Options.Create(companion),
      Options.Create(trust)));

    foreach (var incomplete in new[]
    {
      ClientOptions(enabled: false),
      ClientOptions(transport: "named-pipe"),
      ClientOptions(protocolVersion: 1),
      ClientOptions(pipeName: string.Empty),
      ClientOptions(supervisorImageSha256: string.Empty),
      ClientOptions(supervisorPipeSecuritySha256: string.Empty),
      ClientOptions(supervisorServiceSid: "S-1-5-80-1-2-3-4-5"),
      ClientOptions(attestationKeyId: "untrusted-key"),
    })
    {
      Assert.IsType<DisabledEgressBoundaryClient>(EgressBoundaryClientFactory.Create(
        Options.Create(incomplete),
        Options.Create(companion),
        Options.Create(trust)));
    }

    Assert.IsType<DisabledEgressBoundaryClient>(EgressBoundaryClientFactory.Create(
      Options.Create(configured),
      Options.Create(Companion(destinationPolicySha256: string.Empty)),
      Options.Create(trust)));
    Assert.IsType<DisabledEgressBoundaryClient>(EgressBoundaryClientFactory.Create(
      Options.Create(configured),
      Options.Create(companion),
      Options.Create(Trust(enabled: false))));
  }

  [Fact]
  public async Task RuntimeRejectsAuthorizationFromANonPinnedAttestationKey()
  {
    var fixture = Fixture();
    var supervisor = new FakeSupervisor(fixture, _receiptKey, Now);
    var client = new NamedPipeEgressBoundaryClient(
      ClientOptions(attestationKeyId: "different-trusted-key"),
      supervisor,
      new FixedTimeProvider(Now));

    Assert.Null(await client.TryReserveAsync(
      CompactActionToken,
      ArgumentsJson,
      fixture.Binding,
      CancellationToken.None));
  }

  [Fact]
  public async Task SessionUsesTypedRegistrationAndReturnsOnlySupervisorTerminalReceipt()
  {
    var fixture = Fixture();
    var supervisor = new FakeSupervisor(fixture, _receiptKey, Now);
    var client = new NamedPipeEgressBoundaryClient(
      ClientOptions(),
      supervisor,
      new FixedTimeProvider(Now));
    await using var session = Assert.IsAssignableFrom<IEgressBoundarySession>(
      await client.TryReserveAsync(
        CompactActionToken,
        ArgumentsJson,
        fixture.Binding,
        CancellationToken.None));
    var registration = DirectRegistration(fixture.Binding);

    var acknowledged = await session.TryRegisterDirectAsync(
      registration,
      CancellationToken.None);
    Assert.NotNull(acknowledged);
    Assert.Equal(
      EgressSupervisorLifecycleCanonical.RegistrationSha256(registration),
      acknowledged!.RegistrationSha256);

    var disposition = Disposition(fixture.Binding.ActionId, "settle", 100);
    var receipt = await session.TrySettleAsync(disposition, CancellationToken.None);

    Assert.NotNull(receipt);
    Assert.Same(receipt, session.TerminalReceipt);
    Assert.Equal(100, receipt!.Receipt.MeasuredExternalEgressBytes);
    Assert.Equal(fixture.Binding.ActionId, receipt.Receipt.ActionId);
    Assert.Equal(
      new[]
      {
        EgressSupervisorPipeProtocol.ReserveRequest,
        EgressSupervisorPipeProtocol.DirectRegisterRequest,
        EgressSupervisorPipeProtocol.SettleRequest,
      },
      supervisor.RequestKinds);
  }

  [Fact]
  public async Task ExactRegistrationAndTerminalRetriesAreLocallyIdempotent()
  {
    var fixture = Fixture();
    var supervisor = new FakeSupervisor(fixture, _receiptKey, Now);
    var client = new NamedPipeEgressBoundaryClient(
      ClientOptions(),
      supervisor,
      new FixedTimeProvider(Now));
    await using var session = (await client.TryReserveAsync(
      CompactActionToken,
      ArgumentsJson,
      fixture.Binding,
      CancellationToken.None))!;
    var registration = DirectRegistration(fixture.Binding);
    var firstRegistration = await session.TryRegisterDirectAsync(
      registration,
      CancellationToken.None);
    var secondRegistration = await session.TryRegisterDirectAsync(
      registration,
      CancellationToken.None);
    Assert.Same(firstRegistration, secondRegistration);

    var disposition = Disposition(fixture.Binding.ActionId, "settle", 100);
    var firstReceipt = await session.TrySettleAsync(disposition, CancellationToken.None);
    var secondReceipt = await session.TrySettleAsync(disposition, CancellationToken.None);
    Assert.Same(firstReceipt, secondReceipt);
    Assert.Equal(3, supervisor.RequestKinds.Count);

    await Assert.ThrowsAsync<InvalidOperationException>(async () =>
      await session.TryAbortAsync(
        Disposition(fixture.Binding.ActionId, "abort", 0),
        CancellationToken.None));
  }

  [Fact]
  public async Task RestartedClientCanRepeatRegistrationAndRecoverTerminalIdempotently()
  {
    var fixture = Fixture();
    var supervisor = new FakeSupervisor(fixture, _receiptKey, Now);
    var registration = DirectRegistration(fixture.Binding);
    var firstClient = new NamedPipeEgressBoundaryClient(
      ClientOptions(),
      supervisor,
      new FixedTimeProvider(Now));
    EgressExecutionAuthorization authorization;
    await using (var first = (await firstClient.TryReserveAsync(
      CompactActionToken,
      ArgumentsJson,
      fixture.Binding,
      CancellationToken.None))!)
    {
      authorization = first.Authorization;
      Assert.NotNull(await first.TryRegisterDirectAsync(registration, CancellationToken.None));
    }

    var restartedClient = new NamedPipeEgressBoundaryClient(
      ClientOptions(),
      supervisor,
      new FixedTimeProvider(Now));
    await using var resumed = (await restartedClient.TryResumeAsync(
      authorization,
      fixture.Binding,
      CancellationToken.None))!;
    Assert.NotNull(await resumed.TryRegisterDirectAsync(registration, CancellationToken.None));
    var receipt = await resumed.TrySettleAsync(
      Disposition(fixture.Binding.ActionId, "settle", 100),
      CancellationToken.None);

    Assert.NotNull(receipt);
    Assert.Equal(1, supervisor.DurableRegistrationCount);
    Assert.Equal(1, supervisor.DurableTerminalCount);
  }

  [Fact]
  public async Task WrongRegistrationEchoFailsClosedAndCannotSettle()
  {
    var fixture = Fixture();
    var supervisor = new FakeSupervisor(fixture, _receiptKey, Now)
    {
      CorruptNextRegistrationDigest = true,
    };
    var client = new NamedPipeEgressBoundaryClient(
      ClientOptions(),
      supervisor,
      new FixedTimeProvider(Now));
    await using var session = (await client.TryReserveAsync(
      CompactActionToken,
      ArgumentsJson,
      fixture.Binding,
      CancellationToken.None))!;

    Assert.Null(await session.TryRegisterDirectAsync(
      DirectRegistration(fixture.Binding),
      CancellationToken.None));
    await Assert.ThrowsAsync<InvalidOperationException>(async () =>
      await session.TrySettleAsync(
        Disposition(fixture.Binding.ActionId, "settle", 100),
        CancellationToken.None));
    Assert.DoesNotContain(EgressSupervisorPipeProtocol.SettleRequest, supervisor.RequestKinds);
  }

  [Fact]
  public async Task RegistrationAcknowledgementReceivedAfterLeaseExpiryFailsClosed()
  {
    var fixture = Fixture();
    var supervisor = new FakeSupervisor(fixture, _receiptKey, Now);
    var client = new NamedPipeEgressBoundaryClient(
      ClientOptions(),
      supervisor,
      new FixedTimeProvider(Now.AddMinutes(2)));
    await using var session = (await client.TryReserveAsync(
      CompactActionToken,
      ArgumentsJson,
      fixture.Binding,
      CancellationToken.None))!;

    Assert.Null(await session.TryRegisterDirectAsync(
      DirectRegistration(fixture.Binding),
      CancellationToken.None));
    Assert.False(session.HasRegistration);
  }

  [Fact]
  public async Task DirectRegistrationCannotSubstituteTheLeasedDestinationPolicy()
  {
    var fixture = Fixture();
    var supervisor = new FakeSupervisor(fixture, _receiptKey, Now);
    var client = new NamedPipeEgressBoundaryClient(
      ClientOptions(),
      supervisor,
      new FixedTimeProvider(Now));
    await using var session = (await client.TryReserveAsync(
      CompactActionToken,
      ArgumentsJson,
      fixture.Binding,
      CancellationToken.None))!;
    var registration = DirectRegistration(fixture.Binding) with
    {
      DestinationPolicySha256 = new string('f', 64),
    };

    await Assert.ThrowsAsync<ArgumentException>(async () =>
      await session.TryRegisterDirectAsync(registration, CancellationToken.None));

    Assert.False(session.HasRegistration);
    Assert.DoesNotContain(
      EgressSupervisorPipeProtocol.DirectRegisterRequest,
      supervisor.RequestKinds);
  }

  [Fact]
  public async Task CorruptTerminalBindingIsNotCachedAndExactRetryRecoversDurableReceipt()
  {
    var fixture = Fixture();
    var supervisor = new FakeSupervisor(fixture, _receiptKey, Now)
    {
      CorruptNextTerminalBinding = true,
    };
    var client = new NamedPipeEgressBoundaryClient(
      ClientOptions(),
      supervisor,
      new FixedTimeProvider(Now));
    await using var session = (await client.TryReserveAsync(
      CompactActionToken,
      ArgumentsJson,
      fixture.Binding,
      CancellationToken.None))!;
    Assert.NotNull(await session.TryRegisterDirectAsync(
      DirectRegistration(fixture.Binding),
      CancellationToken.None));
    var disposition = Disposition(fixture.Binding.ActionId, "settle", 100);

    Assert.Null(await session.TrySettleAsync(disposition, CancellationToken.None));
    Assert.False(session.IsTerminal);
    Assert.NotNull(await session.TrySettleAsync(disposition, CancellationToken.None));
    Assert.True(session.IsTerminal);
    Assert.Equal(1, supervisor.DurableTerminalCount);
  }

  [Theory]
  [InlineData(true, false)]
  [InlineData(false, true)]
  public async Task SignedReceiptMustBindExactRegistrationAndDisposition(
    bool wrongRegistration,
    bool wrongDisposition)
  {
    var fixture = Fixture();
    var supervisor = new FakeSupervisor(fixture, _receiptKey, Now)
    {
      CorruptNextReceiptRegistrationDigest = wrongRegistration,
      CorruptNextReceiptDispositionDigest = wrongDisposition,
    };
    var client = new NamedPipeEgressBoundaryClient(
      ClientOptions(),
      supervisor,
      new FixedTimeProvider(Now));
    await using var session = (await client.TryReserveAsync(
      CompactActionToken,
      ArgumentsJson,
      fixture.Binding,
      CancellationToken.None))!;
    Assert.NotNull(await session.TryRegisterDirectAsync(
      DirectRegistration(fixture.Binding),
      CancellationToken.None));

    Assert.Null(await session.TrySettleAsync(
      Disposition(fixture.Binding.ActionId, "settle", 100),
      CancellationToken.None));
    Assert.False(session.IsTerminal);
  }

  [Fact]
  public async Task GenericOrUncorrelatedResponsesFailClosed()
  {
    var fixture = Fixture();
    var supervisor = new FakeSupervisor(fixture, _receiptKey, Now)
    {
      WrongNextCorrelation = true,
    };
    var client = new NamedPipeEgressBoundaryClient(
      ClientOptions(),
      supervisor,
      new FixedTimeProvider(Now));

    await Assert.ThrowsAsync<InvalidDataException>(async () =>
      await client.TryReserveAsync(
        CompactActionToken,
        ArgumentsJson,
        fixture.Binding,
        CancellationToken.None));
  }

  public void Dispose()
  {
    _supervisorKey.Dispose();
    _receiptKey.Dispose();
  }

  private TestFixture Fixture()
  {
    var receiptPublicKey = _receiptKey.ExportSubjectPublicKeyInfo();
    var attestation = new BoundaryAttestationV1(
      EgressBoundaryCanonical.ContractVersion,
      "10000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000002",
      "30000000-0000-4000-8000-000000000003",
      "40000000-0000-4000-8000-000000000004",
      Now.AddMinutes(-1).ToUnixTimeMilliseconds(),
      Now.AddMinutes(2).ToUnixTimeMilliseconds(),
      SecureBootEnabled: true,
      HvciEnabled: true,
      DriverActive: true,
      ServiceActive: true,
      new string('1', 64),
      new string('2', 64),
      BrowserBrokerBuildSha256: null,
      "boundary-receipt-v1",
      Convert.ToBase64String(receiptPublicKey),
      Convert.ToHexString(SHA256.HashData(receiptPublicKey)).ToLowerInvariant(),
      EgressBoundaryFeatures.CommandRequired);
    var signedAttestation = EgressBoundaryCanonical.SignAttestation(
      attestation,
      "boundary-supervisor-v1",
      _supervisorKey);
    var lease = new EgressLeaseV1(
      EgressBoundaryCanonical.ContractVersion,
      "50000000-0000-4000-8000-000000000005",
      EgressBoundaryCanonical.AttestationSha256(attestation),
      PayloadDigest.Sha256Hex(CompactActionToken),
      "70000000-0000-4000-8000-000000000007",
      "80000000-0000-4000-8000-000000000008",
      "90000000-0000-4000-8000-000000000009",
      "a0000000-0000-4000-8000-00000000000a",
      attestation.DeviceId,
      "b0000000-0000-4000-8000-00000000000b",
      "command.emergency.execute",
      "1.0.0",
      1,
      new string('a', 64),
      new string('b', 64),
      PayloadDigest.Sha256Hex(ArgumentsJson),
      new string('c', 64),
      PayloadDigest.Sha256Hex("idempotency-test"),
      new string('d', 64),
      new string('e', 64),
      new string('f', 64),
      new string('1', 64),
      1_000,
      Now.AddSeconds(-10).ToUnixTimeMilliseconds(),
      Now.AddMinutes(1).ToUnixTimeMilliseconds());
    var authorization = new EgressExecutionAuthorization(
      signedAttestation,
      EgressBoundaryCanonical.SignLease(lease, "boundary-receipt-v1", _receiptKey));
    var binding = new EgressActionBinding(
      lease.ActionTokenSha256,
      lease.ActionId,
      lease.TaskId,
      lease.PlanVersionId,
      lease.StepId,
      lease.DeviceId,
      lease.MandateId,
      lease.CapabilityId,
      lease.CapabilityVersion,
      lease.DispatchCount,
      lease.ReservedCapabilityEgressBytes,
      lease.DestinationPolicySha256,
      lease.ExecutionIdentitySha256,
      lease.ArgumentsSha256,
      lease.ExpectedPreStateSha256,
      lease.IdempotencyKeySha256);
    return new TestFixture(binding, authorization);
  }

  private static EgressDirectRegistrationV1 DirectRegistration(EgressActionBinding binding) => new(
    EgressSupervisorLifecycleContract.Version,
    EgressSupervisorLifecycleCanonical.OperationId(binding.ActionId, "direct-registration"),
    Environment.ProcessId,
    Now.AddHours(-1).ToUnixTimeMilliseconds(),
    "https",
    "gateway.example",
    443,
    binding.DestinationPolicySha256,
    new string('d', 64),
    new string('1', 64),
    new string('c', 64));

  private static EgressTerminalDispositionV1 Disposition(
    string actionId,
    string purpose,
    long bytes) => new(
      EgressSupervisorLifecycleContract.Version,
      EgressSupervisorLifecycleCanonical.OperationId(actionId, purpose),
      purpose == "settle"
        ? EgressSupervisorLifecycleContract.Completed
        : EgressSupervisorLifecycleContract.Failed,
      bytes,
      OutcomeUncertain: false,
      OccurredAtUnixMilliseconds: Now.ToUnixTimeMilliseconds());

  private static EgressSupervisorClientOptions ClientOptions(
    bool enabled = true,
    string? transport = null,
    int protocolVersion = EgressSupervisorPipeProtocol.Version,
    string? pipeName = null,
    string? supervisorImageSha256 = null,
    string? supervisorPipeSecuritySha256 = null,
    string? supervisorServiceSid = null,
    string? attestationKeyId = null) => new()
    {
      Enabled = enabled,
      Transport = transport ?? NamedPipeEgressBoundaryClient.TransportName,
      ProtocolVersion = protocolVersion,
      PipeName = pipeName ?? "Itemba.Msaidizi.EgressSupervisor.v2",
      ExpectedSupervisorImagePath = @"C:\Program Files\Itemba\EgressSupervisor.exe",
      ExpectedSupervisorImageSha256 = supervisorImageSha256 ?? new string('d', 64),
      ExpectedSupervisorPipeSecuritySha256 = supervisorPipeSecuritySha256
        ?? new string('e', 64),
      ExpectedSupervisorServiceSid =
        supervisorServiceSid
          ?? EgressSupervisorClientOptions.RequiredSupervisorServiceSid,
      AttestationKeyId = attestationKeyId ?? "boundary-supervisor-v1",
    };

  private static CompanionOptions Companion(string? destinationPolicySha256 = null) => new()
  {
    DeviceId = "20000000-0000-4000-8000-000000000002",
    EgressDestinationPolicySha256 = destinationPolicySha256 ?? new string('a', 64),
    EgressExecutionIdentitySha256 = new string('b', 64),
  };

  private static EgressAttestationTrustOptions Trust(bool enabled = true) => new()
  {
    Enabled = enabled,
    TrustedSupervisorCertificates =
    [
      new TrustedEgressAttestationCertificateOptions
      {
        KeyId = "boundary-supervisor-v1",
        Thumbprint = new string('A', 40),
      },
    ],
  };

  private sealed record TestFixture(
    EgressActionBinding Binding,
    EgressExecutionAuthorization Authorization);

  private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
  {
    public override DateTimeOffset GetUtcNow() => now;
  }

  private sealed class FakeSupervisor(
    TestFixture fixture,
    ECDsa receiptKey,
    DateTimeOffset now) : IEgressSupervisorPipeConnector
  {
    private readonly ConcurrentDictionary<string, EgressRegistrationAcknowledgementV1>
      _registrations = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, SignedEgressReceipt> _terminals =
      new(StringComparer.Ordinal);
    private readonly ConcurrentQueue<string> _requestKinds = new();
    private long _receiptSequence;

    public bool CorruptNextRegistrationDigest { get; set; }

    public bool CorruptNextTerminalBinding { get; set; }

    public bool CorruptNextReceiptRegistrationDigest { get; set; }

    public bool CorruptNextReceiptDispositionDigest { get; set; }

    public bool WrongNextCorrelation { get; set; }

    public IReadOnlyList<string> RequestKinds => _requestKinds.ToArray();

    public int DurableRegistrationCount => _registrations.Count;

    public int DurableTerminalCount => _terminals.Count;

    public ValueTask<IEgressSupervisorPipeConnection> ConnectAsync(
      EgressSupervisorClientOptions options,
      CancellationToken cancellationToken) =>
      ValueTask.FromResult<IEgressSupervisorPipeConnection>(new Connection(this));

    private byte[] Respond(ReadOnlySpan<byte> requestBytes)
    {
      var frame = EgressSupervisorPipeExchange.DeserializeRequest(requestBytes);
      _requestKinds.Enqueue(frame.Kind);
      var correlation = WrongNextCorrelation
        ? EgressSupervisorLifecycleCanonical.OperationId(fixture.Binding.ActionId, "wrong")
        : frame.CorrelationId;
      WrongNextCorrelation = false;
      return frame.Kind switch
      {
        EgressSupervisorPipeProtocol.ReserveRequest =>
          EgressSupervisorPipeExchange.SerializeResponse(
            EgressSupervisorPipeProtocol.ReserveResponse,
            correlation,
            new EgressReserveResponsePayload(fixture.Authorization)),
        EgressSupervisorPipeProtocol.DirectRegisterRequest => RegisterDirect(frame, correlation),
        EgressSupervisorPipeProtocol.ProcessRegisterRequest => RegisterProcess(frame, correlation),
        EgressSupervisorPipeProtocol.BrowserRegisterRequest => RegisterBrowser(frame, correlation),
        EgressSupervisorPipeProtocol.SettleRequest or EgressSupervisorPipeProtocol.AbortRequest =>
          Terminal(frame, correlation),
        _ => throw new InvalidDataException("Unexpected test request kind."),
      };
    }

    private byte[] RegisterDirect(EgressSupervisorPipeFrameV1 frame, string correlation)
    {
      var payload = EgressSupervisorPipeExchange.DeserializePayload<
        EgressDirectRegistrationRequestPayload>(frame.PayloadJson);
      return RegistrationResponse(
        frame,
        correlation,
        payload.Registration.RegistrationId,
        EgressSupervisorLifecycleContract.DirectRegistration,
        EgressSupervisorLifecycleCanonical.RegistrationSha256(payload.Registration));
    }

    private byte[] RegisterProcess(EgressSupervisorPipeFrameV1 frame, string correlation)
    {
      var payload = EgressSupervisorPipeExchange.DeserializePayload<
        EgressProcessRegistrationRequestPayload>(frame.PayloadJson);
      return RegistrationResponse(
        frame,
        correlation,
        payload.Registration.RegistrationId,
        EgressSupervisorLifecycleContract.ProcessRegistration,
        EgressSupervisorLifecycleCanonical.RegistrationSha256(payload.Registration));
    }

    private byte[] RegisterBrowser(EgressSupervisorPipeFrameV1 frame, string correlation)
    {
      var payload = EgressSupervisorPipeExchange.DeserializePayload<
        EgressBrowserRegistrationRequestPayload>(frame.PayloadJson);
      return RegistrationResponse(
        frame,
        correlation,
        payload.Registration.RegistrationId,
        EgressSupervisorLifecycleContract.BrowserRegistration,
        EgressSupervisorLifecycleCanonical.RegistrationSha256(payload.Registration));
    }

    private byte[] RegistrationResponse(
      EgressSupervisorPipeFrameV1 frame,
      string correlation,
      string registrationId,
      string kind,
      string digest)
    {
      var stored = _registrations.GetOrAdd(registrationId, _ =>
        new EgressRegistrationAcknowledgementV1(
          EgressSupervisorLifecycleContract.Version,
          frame.CorrelationId,
          registrationId,
          kind,
          EgressBoundaryCanonical.LeaseSha256(fixture.Authorization.Lease.Lease),
          digest,
          now.ToUnixTimeMilliseconds()));
      var response = CorruptNextRegistrationDigest
        ? stored with { RegistrationSha256 = new string('f', 64) }
        : stored;
      CorruptNextRegistrationDigest = false;
      return EgressSupervisorPipeExchange.SerializeResponse(
        EgressSupervisorPipeProtocol.RegisterResponse,
        correlation,
        new EgressRegistrationResponsePayload(response));
    }

    private byte[] Terminal(EgressSupervisorPipeFrameV1 frame, string correlation)
    {
      var payload = EgressSupervisorPipeExchange.DeserializePayload<
        EgressTerminalRequestPayload>(frame.PayloadJson);
      var receipt = _terminals.GetOrAdd(payload.Disposition.OperationId, _ =>
      {
        var lease = fixture.Authorization.Lease.Lease;
        var measured = payload.Disposition.ReportedExternalEgressBytes;
        var uncertain = payload.Disposition.OutcomeUncertain
          ? lease.ReservedCapabilityEgressBytes - measured
          : 0;
        var value = new EgressReceiptV1(
          EgressBoundaryCanonical.ContractVersion,
          EgressSupervisorLifecycleCanonical.OperationId(
            fixture.Binding.ActionId,
            $"receipt:{payload.Disposition.OperationId}"),
          EgressBoundaryCanonical.LeaseSha256(lease),
          EgressBoundaryCanonical.AttestationSha256(
            fixture.Authorization.Attestation.Attestation),
          lease.ActionTokenSha256,
          lease.ActionId,
          lease.TaskId,
          lease.PlanVersionId,
          lease.StepId,
          lease.DeviceId,
          lease.MandateId,
          lease.CapabilityId,
          lease.CapabilityVersion,
          lease.DispatchCount,
          lease.DestinationPolicySha256,
          lease.ExecutionIdentitySha256,
          lease.ArgumentsSha256,
          lease.ExpectedPreStateSha256,
          lease.IdempotencyKeySha256,
          lease.DestinationScopeSha256,
          lease.RequestBodySha256,
          lease.ExactRequestPolicySha256,
          lease.ReservationDnsAnswerSetSha256,
          lease.ReservationDnsAnswerSetSha256,
          new string('2', 64),
          payload.Registration?.RegistrationSha256
            ?? EgressSupervisorLifecycleCanonical.ZeroSha256,
          EgressSupervisorLifecycleCanonical.DispositionSha256(payload.Disposition),
          lease.ReservedCapabilityEgressBytes,
          measured,
          uncertain,
          checked(measured + uncertain),
          now.AddSeconds(-1).ToUnixTimeMilliseconds(),
          now.ToUnixTimeMilliseconds(),
          Interlocked.Increment(ref _receiptSequence),
          new string('e', 64),
          payload.Disposition.Outcome);
        if (CorruptNextReceiptRegistrationDigest)
        {
          value = value with { RegistrationSha256 = new string('f', 64) };
        }
        if (CorruptNextReceiptDispositionDigest)
        {
          value = value with { DispositionSha256 = new string('f', 64) };
        }
        return EgressBoundaryCanonical.SignReceipt(value, "boundary-receipt-v1", receiptKey);
      });
      var responseReceipt = CorruptNextTerminalBinding
        ? receipt with
        {
          Receipt = receipt.Receipt with { ActionTokenSha256 = new string('f', 64) },
        }
        : receipt;
      CorruptNextTerminalBinding = false;
      return EgressSupervisorPipeExchange.SerializeResponse(
        EgressSupervisorPipeProtocol.TerminalResponse,
        correlation,
        new EgressTerminalResponsePayload(responseReceipt));
    }

    private sealed class Connection(FakeSupervisor owner) : IEgressSupervisorPipeConnection
    {
      private byte[]? _request;

      public Stream RawStream => Stream.Null;

      public void ThrowIfUnavailable()
      {
      }

      public ValueTask WriteFrameAsync(
        ReadOnlyMemory<byte> frame,
        CancellationToken cancellationToken)
      {
        _request = frame.ToArray();
        return ValueTask.CompletedTask;
      }

      public ValueTask<ReadOnlyMemory<byte>> ReadFrameAsync(
        int maximumFrameBytes,
        CancellationToken cancellationToken) =>
        ValueTask.FromResult<ReadOnlyMemory<byte>>(
          owner.Respond(_request ?? throw new InvalidOperationException()));

      public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
  }
}
