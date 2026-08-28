using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.EgressSupervisor;
using Itemba.Msaidizi.EgressSupervisor.Core;
using Itemba.Msaidizi.EgressSupervisor.Persistence;
using Itemba.Msaidizi.EgressSupervisor.Security;
using Itemba.Msaidizi.EgressSupervisor.Transport;
using Xunit;

namespace Itemba.Msaidizi.EgressSupervisor.Tests;

public sealed partial class EgressSupervisorEngineTests
{
  [Fact]
  public async Task ManagedBrowserExactNavigationProducesProviderBoundReceiptAndReplays()
  {
    var provider = new FakeBrowserBoundaryEvidenceProvider();
    using var fixture = CreateBrowserFixture(provider);
    provider.Time = fixture.Time;
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var authorization = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    var registration = fixture.CreateRegistration();
    var request = new EgressBrowserRegistrationRequestPayload(
      EgressSupervisorLifecycleContract.Version,
      authorization,
      registration);
    var acknowledgement = await fixture.Engine.RegisterBrowserAsync(
      request,
      CancellationToken.None);
    var replay = await fixture.Engine.RegisterBrowserAsync(request, CancellationToken.None);

    Assert.Equal(acknowledgement, replay);
    Assert.Equal(1, provider.RegistrationCalls);
    var registrationConflict = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.RegisterBrowserAsync(
        request with
        {
          Registration = registration with
          {
            BrowserBrokerImageSha256 = new string('1', 64),
          },
        },
        CancellationToken.None).AsTask());
    Assert.Equal("egress_registration_idempotency_conflict", registrationConflict.Code);
    Assert.Equal(1, provider.RegistrationCalls);

    var disposition = fixture.CreateDisposition(
      EgressSupervisorLifecycleContract.Completed,
      reportedBytes: 100,
      uncertain: false);
    var terminalRequest = new EgressTerminalRequestPayload(
      EgressSupervisorLifecycleContract.Version,
      authorization,
      acknowledgement,
      disposition);
    var receipt = await fixture.Engine.TerminalAsync(
      terminalRequest,
      abort: false,
      CancellationToken.None);
    var terminalReplay = await fixture.Engine.TerminalAsync(
      terminalRequest,
      abort: false,
      CancellationToken.None);

    Assert.Equal(receipt, terminalReplay);
    Assert.Equal(1, provider.CompletionCalls);
    var terminalConflict = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.TerminalAsync(
        terminalRequest with
        {
          Disposition = disposition with
          {
            ReportedExternalEgressBytes = 101,
          },
        },
        abort: false,
        CancellationToken.None).AsTask());
    Assert.Equal("egress_terminal_idempotency_conflict", terminalConflict.Code);
    Assert.Equal(1, provider.CompletionCalls);
    Assert.Equal(EgressSupervisorLifecycleContract.Completed, receipt.Receipt.Outcome);
    Assert.Equal(123, receipt.Receipt.MeasuredExternalEgressBytes);
    Assert.Equal(0, receipt.Receipt.UncertainExternalEgressBytes);
    Assert.NotNull(provider.RegistrationEvidence);
    Assert.NotNull(provider.CompletionEvidence);
    Assert.Equal(
      fixture.ActionPolicy.ExpectedServerCertificateSha256,
      provider.CompletionEvidence!.ObservedServerCertificateSha256);
    Assert.Equal(
      BrowserBoundaryCanonical.EventLogSha256(
        provider.RegistrationEvidence!,
        provider.CompletionEvidence!),
      receipt.Receipt.FlowLogSha256);
    Assert.NotEqual(
      receipt.Receipt.FlowLogSha256,
      BrowserBoundaryCanonical.EventLogSha256(
        provider.RegistrationEvidence!,
        provider.CompletionEvidence! with
        {
          SelectedAddressSha256 = new string('c', 64),
        }));
    Assert.Equal(
      EgressSupervisorLifecycleCanonical.RegistrationSha256(registration),
      receipt.Receipt.RegistrationSha256);

    var verifier = new EgressBoundaryContractVerifier(
      EgressBoundaryVerificationSettings.Strict(fixture.DeviceId),
      fixture.SigningKeys,
      fixture.Time);
    var verified = verifier.VerifyReceipt(
      new EgressExecutionEvidence(authorization, receipt),
      fixture.Binding,
      EgressBoundaryFeatures.BrowserRequired);
    Assert.True(verified.IsValid, verified.ErrorCode);

    var mutatedFlowLog = receipt with
    {
      Receipt = receipt.Receipt with
      {
        FlowLogSha256 = new string('1', 64),
      },
    };
    var rejectedMutation = verifier.VerifyReceipt(
      new EgressExecutionEvidence(authorization, mutatedFlowLog),
      fixture.Binding,
      EgressBoundaryFeatures.BrowserRequired);
    Assert.False(rejectedMutation.IsValid);
  }

  [Theory]
  [InlineData(BrokerSubstitution.WindowsSession)]
  [InlineData(BrokerSubstitution.ProcessId)]
  [InlineData(BrokerSubstitution.ProcessCreationTime)]
  [InlineData(BrokerSubstitution.Image)]
  [InlineData(BrokerSubstitution.Build)]
  [InlineData(BrokerSubstitution.Lease)]
  [InlineData(BrokerSubstitution.Registration)]
  [InlineData(BrokerSubstitution.ActionPolicy)]
  [InlineData(BrokerSubstitution.Challenge)]
  [InlineData(BrokerSubstitution.ObservedFuture)]
  [InlineData(BrokerSubstitution.ObservedAfterLeaseExpiry)]
  public async Task ManagedBrowserRejectsProviderRegistrationBindingSubstitution(
    BrokerSubstitution substitution)
  {
    var provider = new FakeBrowserBoundaryEvidenceProvider
    {
      BrokerSubstitution = substitution,
    };
    using var fixture = CreateBrowserFixture(provider);
    provider.Time = fixture.Time;
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var authorization = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);

    var error = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.RegisterBrowserAsync(
        new EgressBrowserRegistrationRequestPayload(
          EgressSupervisorLifecycleContract.Version,
          authorization,
          fixture.CreateRegistration()),
        CancellationToken.None).AsTask());
    Assert.Equal("egress_browser_registration_unconfirmed", error.Code);
    Assert.True(error.MayHaveEgressed);

    var receipt = await fixture.Engine.TerminalAsync(
      new EgressTerminalRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        Registration: null,
        fixture.CreateDisposition(
          EgressSupervisorLifecycleContract.Unknown,
          reportedBytes: 0,
          uncertain: true)),
      abort: true,
      CancellationToken.None);
    Assert.Equal(EgressSupervisorLifecycleContract.Unknown, receipt.Receipt.Outcome);
    Assert.Equal(
      authorization.Lease.Lease.ReservedCapabilityEgressBytes,
      receipt.Receipt.ChargedExternalEgressBytes);
  }

  [Theory]
  [InlineData(RegistrationBehavior.Throw, false)]
  [InlineData(RegistrationBehavior.WaitForCancellation, false)]
  [InlineData(RegistrationBehavior.WaitForCancellation, true)]
  public async Task ManagedBrowserRegistrationProviderFailureSettlesUnknown(
    RegistrationBehavior behavior,
    bool cancel)
  {
    var provider = new FakeBrowserBoundaryEvidenceProvider
    {
      RegistrationBehavior = behavior,
    };
    using var fixture = CreateBrowserFixture(provider);
    provider.Time = fixture.Time;
    fixture.Options.FlowCompletionSettlementTimeoutMilliseconds = 100;
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var authorization = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    using var cancellation = new CancellationTokenSource();
    var registrationTask = fixture.Engine.RegisterBrowserAsync(
      new EgressBrowserRegistrationRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        fixture.CreateRegistration()),
      cancellation.Token).AsTask();
    await provider.RegistrationEntered.Task.WaitAsync(TimeSpan.FromSeconds(2));
    if (cancel)
    {
      cancellation.Cancel();
    }

    var error = await Assert.ThrowsAsync<EgressSupervisorException>(() => registrationTask);
    Assert.Equal("egress_browser_registration_unconfirmed", error.Code);
    Assert.True(error.MayHaveEgressed);
    var receipt = await fixture.Engine.TerminalAsync(
      new EgressTerminalRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        Registration: null,
        fixture.CreateDisposition(
          EgressSupervisorLifecycleContract.Unknown,
          reportedBytes: 0,
          uncertain: true)),
      abort: true,
      CancellationToken.None);
    Assert.Equal(EgressSupervisorLifecycleContract.Unknown, receipt.Receipt.Outcome);
    Assert.Equal(
      authorization.Lease.Lease.ReservedCapabilityEgressBytes,
      receipt.Receipt.ChargedExternalEgressBytes);
  }

  [Theory]
  [InlineData(CompletionMutation.RedirectAfterSource)]
  [InlineData(CompletionMutation.DuplicateRedirect)]
  [InlineData(CompletionMutation.CrossOriginRedirect)]
  [InlineData(CompletionMutation.ProviderSession)]
  [InlineData(CompletionMutation.CompletionChallenge)]
  [InlineData(CompletionMutation.RouteAnswerSet)]
  [InlineData(CompletionMutation.SelectedAddress)]
  [InlineData(CompletionMutation.ServerCertificate)]
  [InlineData(CompletionMutation.Lease)]
  [InlineData(CompletionMutation.Registration)]
  [InlineData(CompletionMutation.ActionPolicy)]
  [InlineData(CompletionMutation.NonTopLevel)]
  [InlineData(CompletionMutation.MeasuredOverReservation)]
  [InlineData(CompletionMutation.Future)]
  [InlineData(CompletionMutation.AfterLeaseExpiry)]
  public async Task ManagedBrowserInvalidCompletionEvidenceSettlesUnknown(
    CompletionMutation mutation)
  {
    var provider = new FakeBrowserBoundaryEvidenceProvider
    {
      CompletionMutation = mutation,
    };
    using var fixture = CreateBrowserFixture(provider);
    provider.Time = fixture.Time;
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var authorization = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    var acknowledgement = await fixture.Engine.RegisterBrowserAsync(
      new EgressBrowserRegistrationRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        fixture.CreateRegistration()),
      CancellationToken.None);

    var rejected = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.TerminalAsync(
        new EgressTerminalRequestPayload(
          EgressSupervisorLifecycleContract.Version,
          authorization,
          acknowledgement,
          fixture.CreateDisposition(
            EgressSupervisorLifecycleContract.Completed,
            reportedBytes: 100,
            uncertain: false)),
        abort: false,
        CancellationToken.None).AsTask());
    Assert.Equal("egress_recovered_flow_requires_unknown_disposition", rejected.Code);
    var receipt = await fixture.Engine.TerminalAsync(
      new EgressTerminalRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        acknowledgement,
        fixture.CreateDisposition(
          EgressSupervisorLifecycleContract.Unknown,
          reportedBytes: 0,
          uncertain: true)),
      abort: false,
      CancellationToken.None);

    Assert.Equal(EgressSupervisorLifecycleContract.Unknown, receipt.Receipt.Outcome);
    Assert.Equal(
      authorization.Lease.Lease.ReservedCapabilityEgressBytes,
      receipt.Receipt.ChargedExternalEgressBytes);
  }

  [Fact]
  public async Task CallerCompletedDispositionCannotForgeMissingProviderCompletion()
  {
    var provider = new FakeBrowserBoundaryEvidenceProvider
    {
      CompletionBehavior = CompletionBehavior.Missing,
    };
    using var fixture = CreateBrowserFixture(provider);
    provider.Time = fixture.Time;
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var authorization = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    var acknowledgement = await fixture.Engine.RegisterBrowserAsync(
      new EgressBrowserRegistrationRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        fixture.CreateRegistration()),
      CancellationToken.None);

    var rejected = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.TerminalAsync(
        new EgressTerminalRequestPayload(
          EgressSupervisorLifecycleContract.Version,
          authorization,
          acknowledgement,
          fixture.CreateDisposition(
            EgressSupervisorLifecycleContract.Completed,
            reportedBytes: 100,
            uncertain: false)),
        abort: false,
        CancellationToken.None).AsTask());
    Assert.Equal("egress_recovered_flow_requires_unknown_disposition", rejected.Code);
    var receipt = await fixture.Engine.TerminalAsync(
      new EgressTerminalRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        acknowledgement,
        fixture.CreateDisposition(
          EgressSupervisorLifecycleContract.Unknown,
          reportedBytes: 0,
          uncertain: true)),
      abort: false,
      CancellationToken.None);

    Assert.Equal(EgressSupervisorLifecycleContract.Unknown, receipt.Receipt.Outcome);
    Assert.Equal(
      authorization.Lease.Lease.ReservedCapabilityEgressBytes,
      receipt.Receipt.ChargedExternalEgressBytes);
  }

  [Fact]
  public async Task CompletionProviderThrowSettlesUnknown()
  {
    var provider = new FakeBrowserBoundaryEvidenceProvider
    {
      CompletionBehavior = CompletionBehavior.Throw,
    };
    using var fixture = CreateBrowserFixture(provider);
    provider.Time = fixture.Time;
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var authorization = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    var acknowledgement = await fixture.Engine.RegisterBrowserAsync(
      new EgressBrowserRegistrationRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        fixture.CreateRegistration()),
      CancellationToken.None);

    var rejected = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.TerminalAsync(
        new EgressTerminalRequestPayload(
          EgressSupervisorLifecycleContract.Version,
          authorization,
          acknowledgement,
          fixture.CreateDisposition(
            EgressSupervisorLifecycleContract.Completed,
            reportedBytes: 0,
            uncertain: false)),
        abort: false,
        CancellationToken.None).AsTask());
    Assert.Equal("egress_recovered_flow_requires_unknown_disposition", rejected.Code);
    var receipt = await fixture.Engine.TerminalAsync(
      new EgressTerminalRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        acknowledgement,
        fixture.CreateDisposition(
          EgressSupervisorLifecycleContract.Unknown,
          reportedBytes: 0,
          uncertain: true)),
      abort: false,
      CancellationToken.None);

    Assert.Equal(EgressSupervisorLifecycleContract.Unknown, receipt.Receipt.Outcome);
    Assert.Equal(
      authorization.Lease.Lease.ReservedCapabilityEgressBytes,
      receipt.Receipt.ChargedExternalEgressBytes);
  }

  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public async Task ManagedBrowserTimeoutOrCancellationSettlesUnknown(bool cancel)
  {
    var provider = new FakeBrowserBoundaryEvidenceProvider
    {
      CompletionBehavior = CompletionBehavior.WaitForCancellation,
    };
    using var fixture = CreateBrowserFixture(provider);
    provider.Time = fixture.Time;
    fixture.Options.FlowCompletionSettlementTimeoutMilliseconds = 100;
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var authorization = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    var acknowledgement = await fixture.Engine.RegisterBrowserAsync(
      new EgressBrowserRegistrationRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        fixture.CreateRegistration()),
      CancellationToken.None);
    using var cancellation = new CancellationTokenSource();
    if (cancel)
    {
      cancellation.Cancel();
    }

    var rejected = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.TerminalAsync(
        new EgressTerminalRequestPayload(
          EgressSupervisorLifecycleContract.Version,
          authorization,
          acknowledgement,
          fixture.CreateDisposition(
            EgressSupervisorLifecycleContract.Completed,
            reportedBytes: 0,
            uncertain: false)),
        abort: false,
        cancellation.Token).AsTask());
    Assert.Equal("egress_recovered_flow_requires_unknown_disposition", rejected.Code);
    var receipt = await fixture.Engine.TerminalAsync(
      new EgressTerminalRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        acknowledgement,
        fixture.CreateDisposition(
          EgressSupervisorLifecycleContract.Unknown,
          reportedBytes: 0,
          uncertain: true)),
      abort: false,
      CancellationToken.None);

    Assert.Equal(EgressSupervisorLifecycleContract.Unknown, receipt.Receipt.Outcome);
    Assert.Equal(
      authorization.Lease.Lease.ReservedCapabilityEgressBytes,
      receipt.Receipt.ChargedExternalEgressBytes);
  }

  [Fact]
  public async Task ManagedBrowserActiveJournalRecoversUnknownAfterRestart()
  {
    var journalPath = Path.Combine(_directory, $"{Guid.NewGuid():N}.browser.jsonl");
    using var signingKeys = new TestSigningKeys();
    var firstProvider = new FakeBrowserBoundaryEvidenceProvider();
    EgressExecutionAuthorization authorization;
    EgressRegistrationAcknowledgementV1 acknowledgement;
    using (var first = CreateBrowserFixture(firstProvider, signingKeys, journalPath))
    {
      firstProvider.Time = first.Time;
      await first.Engine.InitializeAsync(CancellationToken.None);
      authorization = await first.Engine.ReserveAsync(
        first.Reservation,
        CancellationToken.None);
      acknowledgement = await first.Engine.RegisterBrowserAsync(
        new EgressBrowserRegistrationRequestPayload(
          EgressSupervisorLifecycleContract.Version,
          authorization,
          first.CreateRegistration()),
        CancellationToken.None);
    }

    var recoveredProvider = new FakeBrowserBoundaryEvidenceProvider();
    using var recovered = CreateBrowserFixture(
      recoveredProvider,
      signingKeys,
      journalPath);
    recoveredProvider.Time = recovered.Time;
    await recovered.Engine.InitializeAsync(CancellationToken.None);
    var receipt = await recovered.Engine.TerminalAsync(
      new EgressTerminalRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        acknowledgement,
        recovered.CreateDisposition(
          EgressSupervisorLifecycleContract.Unknown,
          reportedBytes: 0,
          uncertain: true)),
      abort: false,
      CancellationToken.None);

    Assert.Equal(0, recoveredProvider.CompletionCalls);
    Assert.Equal(EgressSupervisorLifecycleContract.Unknown, receipt.Receipt.Outcome);
    Assert.Equal(
      authorization.Lease.Lease.ReservedCapabilityEgressBytes,
      receipt.Receipt.ChargedExternalEgressBytes);
  }

  [Fact]
  public async Task ManagedBrowserStartingJournalRecoversUnknownAfterCrash()
  {
    var journalPath = Path.Combine(_directory, $"{Guid.NewGuid():N}.browser.jsonl");
    using var signingKeys = new TestSigningKeys();
    var firstProvider = new FakeBrowserBoundaryEvidenceProvider
    {
      RegistrationBehavior = RegistrationBehavior.WaitForCancellation,
    };
    var first = CreateBrowserFixture(firstProvider, signingKeys, journalPath);
    firstProvider.Time = first.Time;
    await first.Engine.InitializeAsync(CancellationToken.None);
    var authorization = await first.Engine.ReserveAsync(
      first.Reservation,
      CancellationToken.None);
    using var cancellation = new CancellationTokenSource();
    var interrupted = first.Engine.RegisterBrowserAsync(
      new EgressBrowserRegistrationRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        first.CreateRegistration()),
      cancellation.Token).AsTask();
    await firstProvider.RegistrationEntered.Task.WaitAsync(TimeSpan.FromSeconds(2));
    first.Dispose();
    cancellation.Cancel();
    await Assert.ThrowsAnyAsync<Exception>(() => interrupted);

    var recoveredProvider = new FakeBrowserBoundaryEvidenceProvider();
    using var recovered = CreateBrowserFixture(
      recoveredProvider,
      signingKeys,
      journalPath);
    recoveredProvider.Time = recovered.Time;
    await recovered.Engine.InitializeAsync(CancellationToken.None);
    var receipt = await recovered.Engine.TerminalAsync(
      new EgressTerminalRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        Registration: null,
        recovered.CreateDisposition(
          EgressSupervisorLifecycleContract.Unknown,
          reportedBytes: 0,
          uncertain: true)),
      abort: true,
      CancellationToken.None);

    Assert.Equal(0, recoveredProvider.RegistrationCalls);
    Assert.Equal(EgressSupervisorLifecycleContract.Unknown, receipt.Receipt.Outcome);
    Assert.Equal(
      authorization.Lease.Lease.ReservedCapabilityEgressBytes,
      receipt.Receipt.ChargedExternalEgressBytes);
  }

  [Fact]
  public async Task RejectingProductionProviderCannotReserveManagedBrowser()
  {
    using var fixture = CreateBrowserFixture(
      new RejectingBrowserBoundaryEvidenceProvider());
    await fixture.Engine.InitializeAsync(CancellationToken.None);

    var error = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.ReserveAsync(
        fixture.Reservation,
        CancellationToken.None).AsTask());
    Assert.Equal("egress_browser_boundary_not_implemented", error.Code);
  }

  [Theory]
  [InlineData("{\"originId\":\"reports\",\"relativePath\":\"/approved\",\"extra\":true}")]
  [InlineData("{\"originId\":\"reports\",\"originId\":\"reports\",\"relativePath\":\"/approved\"}")]
  [InlineData("{\"OriginId\":\"reports\",\"relativePath\":\"/approved\"}")]
  [InlineData("{\"originId\":\"unknown\",\"relativePath\":\"/approved\"}")]
  [InlineData("{\"originId\":\"reports\",\"relativePath\":\"https://evil.test/\"}")]
  [InlineData("{\"originId\":\"reports\",\"relativePath\":\"//evil.test/\"}")]
  [InlineData("{\"originId\":\"reports\",\"relativePath\":\"/approved?x=1\"}")]
  [InlineData("{\"originId\":\"reports\",\"relativePath\":\"/approved#x\"}")]
  [InlineData("{\"originId\":\"reports\",\"relativePath\":\"/approved\\\\x\"}")]
  public async Task ManagedBrowserArgumentsSchemaIsStrictAndClosed(string argumentsJson)
  {
    var provider = new FakeBrowserBoundaryEvidenceProvider();
    using var fixture = CreateBrowserFixture(
      provider,
      argumentsJsonOverride: argumentsJson);
    provider.Time = fixture.Time;
    await fixture.Engine.InitializeAsync(CancellationToken.None);

    var error = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.ReserveAsync(fixture.Reservation, CancellationToken.None).AsTask());
    Assert.Equal("egress_browser_action_arguments_invalid", error.Code);
    Assert.Equal(0, provider.RegistrationCalls);
  }

  [Fact]
  public void ManagedBrowserCapabilityRemainsAbsentFromProductionCatalog()
  {
    Assert.DoesNotContain(
      StandardUserCapabilityCatalog.DescribeRequestedSurface(
        browserExternalEffectsEnabled: true,
        emergencyCommandEnabled: true),
      descriptor => string.Equals(
        descriptor.Id,
        ManagedBrowserBoundaryContract.CapabilityId,
        StringComparison.Ordinal));
    Assert.False(StandardUserCapabilityCatalog.RequiresEgressBoundary(
      ManagedBrowserBoundaryContract.CapabilityId));
  }

  private BrowserFixture CreateBrowserFixture(
    IBrowserBoundaryEvidenceProvider provider,
    TestSigningKeys? signingKeys = null,
    string? journalPath = null,
    string? argumentsJsonOverride = null)
  {
    var time = new MutableTimeProvider(
      new DateTimeOffset(2026, 8, 27, 10, 0, 0, TimeSpan.Zero));
    const string deviceId = "11111111-1111-4111-8111-111111111111";
    const string actionId = "22222222-2222-4222-8222-222222222222";
    const string token = "test.browser.action.token";
    const string originId = "reports";
    const string relativePath = "/approved";
    const string credentialReferenceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    var credentialRecordSha256 = new string('9', 64);
    var serverCertificateSha256 = new string('b', 64);
    var browserBuildSha256 = new string('d', 64);
    var argumentsJson = argumentsJsonOverride
      ?? $"{{\"originId\":\"{originId}\",\"relativePath\":\"{relativePath}\"}}";
    var destinationScopeSha256 = EgressExternalActionCanonical.DestinationScopeSha256(
      ManagedBrowserBoundaryContract.CapabilityId,
      originId,
      "https://reports.example.test/approved",
      serverCertificateSha256,
      credentialReferenceId,
      string.Empty);
    var policy = new EgressDestinationPolicy(new EgressDestinationPolicyV1(
      1,
      "browser-test-policy",
      [
        new EgressDestinationPolicyEntryV1(
          originId,
          ManagedBrowserBoundaryContract.CapabilityId,
          "reports.example.test",
          443,
          relativePath,
          serverCertificateSha256,
          credentialReferenceId,
          credentialRecordSha256,
          string.Empty,
          destinationScopeSha256),
      ]));
    var binding = new EgressActionBinding(
      PayloadDigest.Sha256Hex(token),
      actionId,
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
      deviceId,
      "66666666-6666-4666-8666-666666666666",
      ManagedBrowserBoundaryContract.CapabilityId,
      ManagedBrowserBoundaryContract.CapabilityVersion,
      1,
      1_024,
      policy.Sha256,
      new string('c', 64),
      PayloadDigest.Sha256Hex(argumentsJson),
      new string('2', 64),
      PayloadDigest.Sha256Hex("browser-idempotency"));
    var claims = new ActionTokenClaims
    {
      Issuer = "issuer",
      Audience = "audience",
      Subject = "subject",
      TokenId = Guid.NewGuid().ToString("D"),
      ActionId = binding.ActionId,
      TaskId = binding.TaskId,
      PlanVersionId = binding.PlanVersionId,
      StepId = binding.StepId,
      DeviceId = binding.DeviceId,
      MandateId = binding.MandateId,
      CapabilityId = binding.CapabilityId,
      CapabilityVersion = binding.CapabilityVersion,
      ArgumentsSha256 = binding.ArgumentsSha256,
      ExpectedPreStateSha256 = binding.ExpectedPreStateSha256,
      InputProvenanceSha256 = new string('3', 64),
      IdempotencyKey = "browser-idempotency",
      LeaseId = Guid.NewGuid().ToString("D"),
      FencingToken = "1",
      LeaseExpiresAtUnixSeconds = time.GetUtcNow().AddMinutes(15).ToUnixTimeSeconds(),
      DispatchCount = 1,
      ExecutionMode = ActionExecutionModes.Execute,
      Budgets = new ActionBudget(
        120,
        1,
        1,
        1,
        1_024,
        3_072,
        1,
        BrokerMaxDeliverySessions: 2,
        BrokerMaxRequestAttemptsPerSession: 2,
        BrokerSerializedResultUpperBoundBytes: 512),
      IssuedAtUnixSeconds = time.GetUtcNow().ToUnixTimeSeconds(),
      ExpiresAtUnixSeconds = time.GetUtcNow().AddMinutes(10).ToUnixTimeSeconds(),
    };
    var tokenVerifier = new StubActionTokenVerifier(token, claims);
    var keys = signingKeys ?? new TestSigningKeys();
    var posture = new StubPostureProvider(new EgressHostPosture(
      deviceId,
      "77777777-7777-4777-8777-777777777777",
      "88888888-8888-4888-8888-888888888888",
      true,
      true,
      true,
      true,
      new string('4', 64),
      new string('5', 64),
      browserBuildSha256,
      EgressBoundaryFeatures.BrowserRequired));
    var journal = new DurableEgressJournal(
      journalPath ?? Path.Combine(_directory, $"{Guid.NewGuid():N}.browser.jsonl"),
      time);
    var options = new EgressSupervisorOptions
    {
      Enabled = true,
      DeviceId = deviceId,
      AttestationLifetimeSeconds = 300,
      LeaseLifetimeSeconds = 600,
      FlowCompletionSettlementTimeoutMilliseconds = 1_000,
      KillSwitchPath = Path.Combine(_directory, "DISABLED"),
    };
    var engine = new EgressSupervisorEngine(
      tokenVerifier,
      keys,
      posture,
      new StubProcessVerifier(4_242, 1_700_000_000_000),
      policy,
      journal,
      options,
      time,
      new FixedDestinationResolver(),
      new StubPipeSecurityEvidence(new string('8', 64)),
      provider);
    var reservation = new EgressReserveRequestPayload(
      EgressSupervisorLifecycleContract.Version,
      EgressSupervisorLifecycleCanonical.OperationId(actionId, "reserve"),
      token,
      argumentsJson,
      binding);
    var actionPolicy = new BrowserActionPolicyV1(
      ManagedBrowserBoundaryContract.Version,
      ManagedBrowserBoundaryContract.CapabilityId,
      ManagedBrowserBoundaryContract.CapabilityVersion,
      originId,
      PayloadDigest.Sha256Hex("https://reports.example.test/"),
      PayloadDigest.Sha256Hex("https://reports.example.test/approved"),
      serverCertificateSha256,
      PayloadDigest.Sha256Hex(relativePath),
      destinationScopeSha256,
      binding.ArgumentsSha256,
      binding.ExpectedPreStateSha256!,
      binding.IdempotencyKeySha256);
    return new BrowserFixture(
      engine,
      journal,
      keys,
      signingKeys is null,
      time,
      binding,
      reservation,
      deviceId,
      options,
      actionPolicy,
      browserBuildSha256);
  }

  private sealed class BrowserFixture(
    EgressSupervisorEngine engine,
    DurableEgressJournal journal,
    TestSigningKeys signingKeys,
    bool ownsSigningKeys,
    MutableTimeProvider time,
    EgressActionBinding binding,
    EgressReserveRequestPayload reservation,
    string deviceId,
    EgressSupervisorOptions options,
    BrowserActionPolicyV1 actionPolicy,
    string browserBuildSha256) : IDisposable
  {
    public EgressSupervisorEngine Engine { get; } = engine;
    public DurableEgressJournal Journal { get; } = journal;
    public TestSigningKeys SigningKeys { get; } = signingKeys;
    public MutableTimeProvider Time { get; } = time;
    public EgressActionBinding Binding { get; } = binding;
    public EgressReserveRequestPayload Reservation { get; } = reservation;
    public string DeviceId { get; } = deviceId;
    public EgressSupervisorOptions Options { get; } = options;
    public BrowserActionPolicyV1 ActionPolicy { get; } = actionPolicy;

    public EgressBrowserRegistrationV1 CreateRegistration() => new(
      EgressSupervisorLifecycleContract.Version,
      EgressSupervisorLifecycleCanonical.OperationId(Binding.ActionId, "browser-registration"),
      WindowsSessionId: 12,
      BrowserBrokerProcessId: 7_777,
      ActionPolicy.ExpectedOriginSha256,
      browserBuildSha256,
      CompletionNonceSha256: new string('e', 64),
      BrowserBrokerProcessCreationTimeUnixMilliseconds: 1_800_000_000_000,
      BrowserBrokerImageSha256: new string('a', 64),
      ActionPolicySha256: BrowserBoundaryCanonical.ActionPolicySha256(ActionPolicy));

    public EgressTerminalDispositionV1 CreateDisposition(
      string outcome,
      long reportedBytes,
      bool uncertain) => new(
        EgressSupervisorLifecycleContract.Version,
        EgressSupervisorLifecycleCanonical.OperationId(Binding.ActionId, "settle"),
        outcome,
        reportedBytes,
        uncertain,
        Time.GetUtcNow().ToUnixTimeMilliseconds());

    public void Dispose()
    {
      Engine.Dispose();
      Journal.Dispose();
      if (ownsSigningKeys)
      {
        SigningKeys.Dispose();
      }
    }
  }

  public enum BrokerSubstitution
  {
    None,
    WindowsSession,
    ProcessId,
    ProcessCreationTime,
    Image,
    Build,
    Lease,
    Registration,
    ActionPolicy,
    Challenge,
    ObservedFuture,
    ObservedAfterLeaseExpiry,
  }

  public enum CompletionMutation
  {
    None,
    RedirectAfterSource,
    DuplicateRedirect,
    CrossOriginRedirect,
    ProviderSession,
    CompletionChallenge,
    RouteAnswerSet,
    SelectedAddress,
    ServerCertificate,
    Lease,
    Registration,
    ActionPolicy,
    NonTopLevel,
    MeasuredOverReservation,
    Future,
    AfterLeaseExpiry,
  }

  public enum RegistrationBehavior
  {
    Success,
    Throw,
    WaitForCancellation,
  }

  public enum CompletionBehavior
  {
    Success,
    Missing,
    Throw,
    WaitForCancellation,
  }

  private sealed class FakeBrowserBoundaryEvidenceProvider :
    IBrowserBoundaryEvidenceProvider
  {
    public bool IsAvailable => true;
    public MutableTimeProvider? Time { get; set; }
    public BrokerSubstitution BrokerSubstitution { get; set; }
    public RegistrationBehavior RegistrationBehavior { get; set; }
    public CompletionMutation CompletionMutation { get; set; }
    public CompletionBehavior CompletionBehavior { get; set; }
    public int RegistrationCalls { get; private set; }
    public int CompletionCalls { get; private set; }
    public BrowserBoundaryRegistrationEvidenceV1? RegistrationEvidence { get; private set; }
    public BrowserBoundaryCompletionEvidenceV1? CompletionEvidence { get; private set; }
    public TaskCompletionSource RegistrationEntered { get; } = new(
      TaskCreationOptions.RunContinuationsAsynchronously);

    public async ValueTask<BrowserBoundaryRegistrationEvidenceV1?> TryRegisterAsync(
      BrowserBoundaryRegistrationRequest request,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      RegistrationCalls++;
      RegistrationEntered.TrySetResult();
      if (RegistrationBehavior == RegistrationBehavior.Throw)
      {
        throw new InvalidOperationException("Synthetic registration-provider failure.");
      }
      if (RegistrationBehavior == RegistrationBehavior.WaitForCancellation)
      {
        await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        return null;
      }
      var registration = request.Registration;
      var identity = new BrowserBrokerIdentityV1(
        ManagedBrowserBoundaryContract.Version,
        registration.WindowsSessionId
          + (BrokerSubstitution == BrokerSubstitution.WindowsSession ? 1 : 0),
        registration.BrowserBrokerProcessId
          + (BrokerSubstitution == BrokerSubstitution.ProcessId ? 1 : 0),
        registration.BrowserBrokerProcessCreationTimeUnixMilliseconds
          + (BrokerSubstitution == BrokerSubstitution.ProcessCreationTime ? 1 : 0),
        BrokerSubstitution == BrokerSubstitution.Image
          ? new string('1', 64)
          : registration.BrowserBrokerImageSha256,
        BrokerSubstitution == BrokerSubstitution.Build
          ? new string('2', 64)
          : registration.BrowserBrokerBuildSha256);
      RegistrationEvidence = new BrowserBoundaryRegistrationEvidenceV1(
        ManagedBrowserBoundaryContract.Version,
        Guid.NewGuid().ToString("D"),
        BrokerSubstitution == BrokerSubstitution.Lease
          ? new string('1', 64)
          : EgressBoundaryCanonical.LeaseSha256(request.Authorization.Lease.Lease),
        BrokerSubstitution == BrokerSubstitution.Registration
          ? new string('1', 64)
          : EgressSupervisorLifecycleCanonical.RegistrationSha256(registration),
        BrokerSubstitution == BrokerSubstitution.ActionPolicy
          ? new string('1', 64)
          : BrowserBoundaryCanonical.ActionPolicySha256(request.ActionPolicy),
        identity,
        BrokerSubstitution == BrokerSubstitution.Challenge
          ? new string('0', 64)
          : new string('f', 64),
        BrokerSubstitution switch
        {
          BrokerSubstitution.ObservedFuture => Now() + 30_001,
          BrokerSubstitution.ObservedAfterLeaseExpiry =>
            request.Authorization.Lease.Lease.ExpiresAtUnixMilliseconds + 1,
          _ => Now(),
        });
      return RegistrationEvidence;
    }

    public async ValueTask<BrowserBoundaryCompletionEvidenceV1?> TryObserveCompletionAsync(
      BrowserBoundaryCompletionRequest request,
      CancellationToken cancellationToken)
    {
      CompletionCalls++;
      if (CompletionBehavior == CompletionBehavior.Missing)
      {
        return null;
      }
      if (CompletionBehavior == CompletionBehavior.Throw)
      {
        throw new InvalidOperationException("Synthetic completion-provider failure.");
      }
      if (CompletionBehavior == CompletionBehavior.WaitForCancellation)
      {
        await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        return null;
      }

      var policy = request.ActionPolicy;
      var redirectOrigin = CompletionMutation == CompletionMutation.CrossOriginRedirect
        ? new string('1', 64)
        : policy.ExpectedOriginSha256;
      var redirectUri = PayloadDigest.Sha256Hex("https://reports.example.test/login");
      var events = new List<BrowserNavigationObservationV1>
      {
        Observation(
          1,
          ManagedBrowserBoundaryContract.NavigationStarting,
          policy.ExpectedOriginSha256,
          policy.ExpectedTargetUriSha256,
          ManagedBrowserBoundaryContract.CompletionNotApplicable,
          topLevel: CompletionMutation != CompletionMutation.NonTopLevel),
      };
      if (CompletionMutation == CompletionMutation.RedirectAfterSource)
      {
        events.Add(Observation(
          2,
          ManagedBrowserBoundaryContract.SourceChanged,
          policy.ExpectedOriginSha256,
          policy.ExpectedTargetUriSha256,
          ManagedBrowserBoundaryContract.CompletionNotApplicable));
        events.Add(Observation(
          3,
          ManagedBrowserBoundaryContract.Redirect,
          redirectOrigin,
          redirectUri,
          ManagedBrowserBoundaryContract.CompletionNotApplicable));
      }
      else
      {
        events.Add(Observation(
          2,
          ManagedBrowserBoundaryContract.Redirect,
          redirectOrigin,
          redirectUri,
          ManagedBrowserBoundaryContract.CompletionNotApplicable));
        if (CompletionMutation == CompletionMutation.DuplicateRedirect)
        {
          events.Add(Observation(
            3,
            ManagedBrowserBoundaryContract.Redirect,
            redirectOrigin,
            redirectUri,
            ManagedBrowserBoundaryContract.CompletionNotApplicable));
        }
        events.Add(Observation(
          events.Count + 1,
          ManagedBrowserBoundaryContract.SourceChanged,
          policy.ExpectedOriginSha256,
          policy.ExpectedTargetUriSha256,
          ManagedBrowserBoundaryContract.CompletionNotApplicable));
      }
      events.Add(Observation(
        events.Count + 1,
        ManagedBrowserBoundaryContract.NavigationCompleted,
        policy.ExpectedOriginSha256,
        policy.ExpectedTargetUriSha256,
        ManagedBrowserBoundaryContract.CompletionSucceeded));

      CompletionEvidence = new BrowserBoundaryCompletionEvidenceV1(
        ManagedBrowserBoundaryContract.Version,
        CompletionMutation == CompletionMutation.ProviderSession
          ? Guid.NewGuid().ToString("D")
          : request.RegistrationEvidence.ProviderSessionId,
        CompletionMutation == CompletionMutation.Lease
          ? new string('1', 64)
          : request.RegistrationEvidence.LeaseSha256,
        CompletionMutation == CompletionMutation.Registration
          ? new string('1', 64)
          : request.RegistrationEvidence.RegistrationSha256,
        CompletionMutation == CompletionMutation.ActionPolicy
          ? new string('1', 64)
          : request.RegistrationEvidence.ActionPolicySha256,
        CompletionMutation == CompletionMutation.CompletionChallenge
          ? new string('1', 64)
          : request.RegistrationEvidence.CompletionChallengeSha256,
        events,
        CompletionMutation == CompletionMutation.RouteAnswerSet
          ? new string('1', 64)
          : request.Authorization.Lease.Lease.ReservationDnsAnswerSetSha256,
        CompletionMutation == CompletionMutation.SelectedAddress
          ? new string('0', 64)
          : new string('a', 64),
        CompletionMutation == CompletionMutation.ServerCertificate
          ? new string('1', 64)
          : policy.ExpectedServerCertificateSha256,
        CompletionMutation == CompletionMutation.MeasuredOverReservation
          ? request.Authorization.Lease.Lease.ReservedCapabilityEgressBytes + 1
          : 123,
        MeasurementUncertain: false,
        CompletionMutation switch
        {
          CompletionMutation.AfterLeaseExpiry =>
            request.Authorization.Lease.Lease.ExpiresAtUnixMilliseconds + 1,
          CompletionMutation.Future => Now() + 30_001,
          _ => Now(),
        });
      return CompletionEvidence;
    }

    private BrowserNavigationObservationV1 Observation(
      int sequence,
      string kind,
      string originSha256,
      string uriSha256,
      string completionStatus,
      bool topLevel = true) => new(
        ManagedBrowserBoundaryContract.Version,
        sequence,
        kind,
        NavigationId: 42,
        IsTopLevel: topLevel,
        originSha256,
        uriSha256,
        completionStatus,
        Now());

    private long Now() => (Time ?? throw new InvalidOperationException(
      "The fake browser provider has no authoritative test clock."))
      .GetUtcNow().ToUnixTimeMilliseconds();
  }
}
