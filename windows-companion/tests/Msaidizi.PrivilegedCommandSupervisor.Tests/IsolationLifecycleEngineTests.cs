using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Channel;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Configuration;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Enforcement;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Execution;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Security;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.State;
using Xunit;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Tests;

public sealed class IsolationLifecycleEngineTests
{
  [Fact]
  public async Task ExactLifecycleIsSignedVerifiedAndIdempotent()
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = fixture.Request();

    var lease = await fixture.ReserveAsync(request);
    var duplicateLease = await fixture.ReserveAsync(request);
    Assert.Equal(lease.SignatureBase64, duplicateLease.SignatureBase64);
    Assert.Equal(2, fixture.Enforcer.AttestationCount);

    var verifier = fixture.Verifier();
    var reservation = verifier.VerifyReservation(request, lease, request.Action);
    Assert.True(reservation.IsValid, reservation.ErrorCode);

    var observation = fixture.Observation();
    var bind = await fixture.BindAsync(request, lease, observation);
    var duplicateBind = await fixture.BindAsync(request, lease, observation);
    Assert.Equal(
      bind.SignedAcknowledgement.SignatureBase64,
      duplicateBind.SignedAcknowledgement.SignatureBase64);
    Assert.NotEqual(lease.KeyId, bind.SignedAcknowledgement.KeyId);
    Assert.Equal(1, fixture.Enforcer.BindCount);

    var verifiedBind = verifier.VerifyBindAcknowledgement(
      reservation.Value!,
      bind.Binding,
      bind.SignedAcknowledgement);
    Assert.True(verifiedBind.IsValid, verifiedBind.ErrorCode);

    var terminalObservation = new TerminalObservation(
      ProcessResumed: true,
      ExitCodeKnown: true,
      ExitCode: 0,
      PrivilegedCommandIsolationTerminalOutcomes.Completed);
    fixture.Enforcer.Terminal = fixture.Terminal(
      PrivilegedCommandIsolationTerminalOutcomes.Completed,
      exitCodeKnown: true,
      exitCode: 0,
      processResumed: true);
    var receipt = await fixture.Engine.SettleAsync(
      request,
      lease,
      bind.Binding,
      bind.SignedAcknowledgement,
      terminalObservation,
      CancellationToken.None);
    var duplicateReceipt = await fixture.Engine.SettleAsync(
      request,
      lease,
      bind.Binding,
      bind.SignedAcknowledgement,
      terminalObservation,
      CancellationToken.None);
    Assert.Equal(receipt.SignatureBase64, duplicateReceipt.SignatureBase64);
    Assert.NotEqual(lease.KeyId, receipt.KeyId);
    Assert.NotEqual(bind.SignedAcknowledgement.KeyId, receipt.KeyId);
    Assert.Equal(1, fixture.Enforcer.SettleCount);

    var verifiedReceipt = verifier.VerifyTerminalReceipt(
      verifiedBind.Value!,
      receipt);
    Assert.True(verifiedReceipt.IsValid, verifiedReceipt.ErrorCode);
    Assert.True(verifiedReceipt.Value!.IsIsolationIntact);
    Assert.Equal(
      IsolationLifecyclePhase.Settled,
      Assert.Single(fixture.Store.Snapshot).Phase);
  }

  [Fact]
  public async Task ReleaseIsMutuallyExclusiveWithBindAndExactOnReplay()
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = fixture.Request();
    var lease = await fixture.ReserveAsync(request);

    var release = await fixture.Engine.ReleaseAsync(
      request,
      lease,
      PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeProcess,
      CancellationToken.None);
    var duplicate = await fixture.Engine.ReleaseAsync(
      request,
      lease,
      PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeProcess,
      CancellationToken.None);
    Assert.Equal(release.SignatureBase64, duplicate.SignatureBase64);
    Assert.NotEqual(lease.KeyId, release.KeyId);

    await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Engine.ReleaseAsync(
      request,
      lease,
      PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeBind,
      CancellationToken.None).AsTask());
    await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.BindAsync(
      request,
      lease,
      fixture.Observation()).AsTask());

    var verifier = fixture.Verifier();
    var reservation = verifier.VerifyReservation(request, lease, request.Action);
    var verified = verifier.VerifyPreBindRelease(reservation.Value!, release);
    Assert.True(verified.IsValid, verified.ErrorCode);
  }

  [Fact]
  public async Task DuplicateActionWithDifferentRequestIsRejected()
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = fixture.Request();
    _ = await fixture.ReserveAsync(request);
    var conflicting = fixture.Request(
      request.Action.ActionId,
      Guid.NewGuid().ToString("D"));

    await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.ReserveAsync(
      conflicting).AsTask());
  }

  [Fact]
  public async Task RestartRecoversAndTerminatesExactBoundTreeBeforeNewDispatch()
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = fixture.Request();
    var lease = await fixture.ReserveAsync(request);
    var bind = await fixture.BindAsync(request, lease, fixture.Observation());
    fixture.Enforcer.RecoveryTerminal = fixture.Terminal(
      PrivilegedCommandIsolationTerminalOutcomes.Unknown,
      exitCodeKnown: false,
      exitCode: 0,
      processResumed: false);

    await fixture.RestartAsync();

    Assert.Equal(1, fixture.Enforcer.RecoverCount);
    var recovered = await fixture.Engine.RecoverBindAsync(
      new PrivilegedCommandIsolationPendingBind(
        request,
        lease,
        bind.Binding,
        bind.SignedAcknowledgement),
      CancellationToken.None);
    Assert.Equal(
      PrivilegedCommandIsolationTerminalOutcomes.Unknown,
      recovered.Receipt.Outcome);

    var verifier = fixture.Verifier();
    var reservation = verifier.VerifyReservationForRecovery(
      request,
      lease,
      request.Action);
    Assert.True(reservation.IsValid, reservation.ErrorCode);
    var verifiedBind = verifier.VerifyBindAcknowledgementForRecovery(
      reservation.Value!,
      bind.Binding,
      bind.SignedAcknowledgement);
    Assert.True(verifiedBind.IsValid, verifiedBind.ErrorCode);
    var terminal = verifier.VerifyTerminalReceiptForRecovery(
      verifiedBind.Value!,
      recovered);
    Assert.True(terminal.IsValid, terminal.ErrorCode);
    Assert.True(terminal.Value!.IsIsolationIntact);
  }

  [Fact]
  public async Task RestartReleasesPendingReservationBeforeServingRecovery()
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = fixture.Request();
    var lease = await fixture.ReserveAsync(request);

    await fixture.RestartAsync();

    var release = await fixture.Engine.RecoverReservationAsync(
      new PrivilegedCommandIsolationPendingReservation(request, lease),
      CancellationToken.None);
    Assert.Equal(
      PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeBind,
      release.Release.Outcome);
    Assert.Equal(
      IsolationLifecyclePhase.Released,
      Assert.Single(fixture.Store.Snapshot).Phase);
  }

  [Fact]
  public async Task DriverUnavailableFailsBeforeAnyReservationIsIssued()
  {
    await using var fixture = new Fixture();
    fixture.Enforcer.AttestationFailure = new IOException("driver unavailable");

    await Assert.ThrowsAsync<IsolationSupervisorFatalException>(() =>
      fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None).AsTask());
    Assert.Empty(fixture.Store.Snapshot);
  }

  [Fact]
  public async Task SharedKillSwitchStopsBeforeDriverOrJournalAccess()
  {
    var killSwitch = Path.Combine(
      Path.GetTempPath(),
      $"msaidizi-isolation-kill-{Guid.NewGuid():N}");
    await File.WriteAllTextAsync(killSwitch, "disabled");
    try
    {
      await using var fixture = new Fixture(killSwitch);
      var failure = await Assert.ThrowsAsync<IsolationSupervisorFatalException>(() =>
        fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None).AsTask());
      Assert.Equal("trusted_root_kill_switch_engaged", failure.ErrorCode);
      Assert.Equal(0, fixture.Enforcer.AttestationCount);
      Assert.Empty(fixture.Store.Snapshot);
    }
    finally
    {
      var fullPath = Path.GetFullPath(killSwitch);
      if (fullPath.StartsWith(
          Path.GetFullPath(Path.GetTempPath()),
          StringComparison.OrdinalIgnoreCase)
        && File.Exists(fullPath))
      {
        File.Delete(fullPath);
      }
    }
  }

  [Fact]
  public async Task DriverLossAfterStartupFencesBeforeReservationCommit()
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    fixture.Enforcer.AttestationFailure = new IOException("driver disconnected");

    await Assert.ThrowsAsync<IsolationSupervisorFatalException>(() =>
      fixture.ReserveAsync(fixture.Request()).AsTask());
    Assert.Empty(fixture.Store.Snapshot);
  }

  [Fact]
  public async Task ParentCreationIdentityMismatchNeverReachesKernelBind()
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = fixture.Request();
    var lease = await fixture.ReserveAsync(request);
    var observation = fixture.Observation() with
    {
      ParentProcessCreationTimeUtcFileTime = fixture.Peer.ProcessCreationTimeUtcFileTime + 1,
    };

    await Assert.ThrowsAsync<UnauthorizedAccessException>(() => fixture.BindAsync(
      request,
      lease,
      observation).AsTask());
    Assert.Equal(0, fixture.Enforcer.BindCount);
    Assert.Equal(
      IsolationLifecyclePhase.Reserved,
      Assert.Single(fixture.Store.Snapshot).Phase);
  }

  [Fact]
  public async Task UncertainKernelBindOutcomeTripsFatalFenceWithoutDurableBind()
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = fixture.Request();
    var lease = await fixture.ReserveAsync(request);
    fixture.Enforcer.BindFailure = new InvalidDataException(
      "malformed response after bind dispatch");

    var failure = await Assert.ThrowsAsync<IsolationSupervisorFatalException>(() =>
      fixture.BindAsync(request, lease, fixture.Observation()).AsTask());

    Assert.Equal("kernel_isolation_bind_unavailable", failure.ErrorCode);
    Assert.Equal(
      IsolationLifecyclePhase.Reserved,
      Assert.Single(fixture.Store.Snapshot).Phase);
    await Assert.ThrowsAsync<IsolationSupervisorFatalException>(() =>
      fixture.ReserveAsync(fixture.Request()).AsTask());
  }

  [Fact]
  public async Task SettlementTransportLossLeavesExactBindPendingAndTripsFatalFence()
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = fixture.Request();
    var lease = await fixture.ReserveAsync(request);
    var bind = await fixture.BindAsync(request, lease, fixture.Observation());
    fixture.Enforcer.SettleFailure = new IOException("driver disconnected");

    await Assert.ThrowsAsync<IsolationSupervisorFatalException>(() => fixture.Engine.SettleAsync(
      request,
      lease,
      bind.Binding,
      bind.SignedAcknowledgement,
      new TerminalObservation(
        true,
        true,
        0,
        PrivilegedCommandIsolationTerminalOutcomes.Completed),
      CancellationToken.None).AsTask());
    Assert.Equal(
      IsolationLifecyclePhase.Bound,
      Assert.Single(fixture.Store.Snapshot).Phase);
  }

  [Fact]
  public async Task TerminalMismatchCommitsSignedViolationAndFencesFutureDispatch()
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = fixture.Request();
    var lease = await fixture.ReserveAsync(request);
    var bind = await fixture.BindAsync(request, lease, fixture.Observation());
    fixture.Enforcer.Terminal = fixture.Terminal(
      PrivilegedCommandIsolationTerminalOutcomes.Failed,
      exitCodeKnown: true,
      exitCode: 9,
      processResumed: true);

    var receipt = await fixture.Engine.SettleAsync(
      request,
      lease,
      bind.Binding,
      bind.SignedAcknowledgement,
      new TerminalObservation(
        true,
        true,
        0,
        PrivilegedCommandIsolationTerminalOutcomes.Completed),
      CancellationToken.None);

    Assert.False(receipt.Receipt.EnforcementContinuous);
    Assert.Equal(
      PrivilegedCommandIsolationTerminalOutcomes.IsolationViolation,
      receipt.Receipt.Outcome);
    await Assert.ThrowsAsync<IsolationSupervisorFatalException>(() =>
      fixture.ReserveAsync(fixture.Request()).AsTask());
  }

  [Fact]
  public async Task InvalidActionTokenSignatureIsRejectedBeforeReservation()
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = fixture.Request();

    await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
      fixture.ReserveWithInvalidSignatureAsync(request).AsTask());

    Assert.Empty(fixture.Store.Snapshot);
    Assert.Equal(1, fixture.Enforcer.AttestationCount);
  }

  public static TheoryData<string> SignedClaimMutations => new()
  {
    "issuer",
    "audience",
    "subject",
    "actionId",
    "taskId",
    "planVersionId",
    "stepId",
    "deviceId",
    "mandateId",
    "capabilityId",
    "capabilityVersion",
    "argumentsSha256",
    "expectedPreStateSha256",
    "inputProvenanceSha256",
    "idempotencyKey",
    "leaseId",
    "fencingToken",
    "leaseExpiresAt",
    "dispatchCount",
    "executionMode",
    "maxWallTimeSeconds",
    "maxModelTurns",
    "maxAttemptedToolCalls",
    "maxMutations",
    "maxLocalBytes",
    "maxExternalEgressBytes",
    "maxModelSpendUsd",
    "brokerMaxDeliverySessions",
    "brokerMaxRequestAttemptsPerSession",
    "brokerSerializedResultUpperBoundBytes",
  };

  [Theory]
  [MemberData(nameof(SignedClaimMutations))]
  public async Task EverySignedAuthorizationClaimMutationIsRejected(string claim)
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = fixture.Request();

    await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
      fixture.ReserveWithClaimMutationAsync(request, claim).AsTask());

    Assert.Empty(fixture.Store.Snapshot);
  }

  public static TheoryData<string> InvalidCanonicalReservationShapes => new()
  {
    "expectedPreStateSha256",
    "inputProvenanceSha256",
    "leaseId",
    "fencingToken",
    "maxWallTimeSeconds",
    "maxModelTurns",
    "maxAttemptedToolCalls",
    "maxMutations",
    "maxLocalBytes",
    "maxExternalEgressBytes",
    "maxModelSpendUsd",
    "brokerMaxDeliverySessions",
    "brokerMaxRequestAttemptsPerSession",
    "brokerSerializedResultUpperBoundBytes",
    "dispatchExceedsBrokerDeliverySessions",
  };

  [Theory]
  [MemberData(nameof(InvalidCanonicalReservationShapes))]
  public async Task InvalidCanonicalAuthorizationShapeIsRejectedBeforeReservation(
    string field)
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = fixture.Request();
    var invalid = MutateReservationShape(request, field);

    Assert.False(PrivilegedCommandIsolationCanonical.IsValidReservationRequest(invalid));
    await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
      fixture.ReserveAsync(invalid).AsTask());

    Assert.Empty(fixture.Store.Snapshot);
    Assert.Equal(0, fixture.Enforcer.BindCount);
  }

  [Theory]
  [InlineData("token")]
  [InlineData("action-lease")]
  public async Task BindAfterSignedAuthorizationLifetimeNeverReachesKernel(
    string lifetime)
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = string.Equals(lifetime, "token", StringComparison.Ordinal)
      ? fixture.Request(
        tokenLifetime: TimeSpan.FromSeconds(10),
        actionLeaseLifetime: TimeSpan.FromMinutes(2))
      : fixture.Request(
        // The action-token contract requires token exp <= task-lease exp. Equal
        // bounds exercise the independent task-lease clamp without creating an
        // otherwise-invalid token.
        tokenLifetime: TimeSpan.FromSeconds(10),
        actionLeaseLifetime: TimeSpan.FromSeconds(10));
    var lease = await fixture.ReserveAsync(request);
    Assert.Equal(
      fixture.UtcNow.AddSeconds(10).ToUnixTimeMilliseconds(),
      lease.Lease.ExpiresAtUnixMilliseconds);

    fixture.Advance(TimeSpan.FromSeconds(11));

    await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.BindAsync(
      request,
      lease,
      fixture.Observation()).AsTask());
    Assert.Equal(0, fixture.Enforcer.BindCount);
  }

  [Fact]
  public async Task ExpiredIdempotentReservationReplayIsExplicitlyRejected()
  {
    await using var fixture = new Fixture(
      reservationLeaseLifetime: TimeSpan.FromSeconds(5));
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = fixture.Request();
    _ = await fixture.ReserveAsync(request);
    fixture.Advance(TimeSpan.FromSeconds(6));

    var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
      fixture.ReserveAsync(request).AsTask());

    Assert.Contains("expired", error.Message, StringComparison.OrdinalIgnoreCase);
    Assert.Single(fixture.Store.Snapshot);
  }

  [Fact]
  public async Task AttestationLossBetweenReserveAndBindFailsSafeBeforeKernelDispatch()
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = fixture.Request();
    var lease = await fixture.ReserveAsync(request);
    fixture.Enforcer.AttestationFailure = new IOException("live posture unavailable");

    var failure = await Assert.ThrowsAsync<IsolationSupervisorFatalException>(() =>
      fixture.BindAsync(request, lease, fixture.Observation()).AsTask());

    Assert.Equal("kernel_isolation_attestation_failed", failure.ErrorCode);
    Assert.Equal(0, fixture.Enforcer.BindCount);
    Assert.Equal(
      IsolationLifecyclePhase.Reserved,
      Assert.Single(fixture.Store.Snapshot).Phase);
  }

  [Fact]
  public async Task DurableJournalNeverContainsCompactTokenArgvOrEnvironment()
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = fixture.Request();
    var compactToken = fixture.CompactTokenFor(request);
    var rawIdempotencyKey = fixture.IdempotencyKeyFor(request);
    var idempotencyKeySha256 = PayloadDigest.Sha256Hex(rawIdempotencyKey);
    _ = await fixture.ReserveAsync(request);
    await fixture.CloseStateAsync();

    var journal = await File.ReadAllTextAsync(fixture.JournalPath);

    Assert.DoesNotContain(compactToken, journal, StringComparison.Ordinal);
    Assert.DoesNotContain(rawIdempotencyKey, journal, StringComparison.Ordinal);
    Assert.DoesNotContain("echo test", journal, StringComparison.Ordinal);
    Assert.DoesNotContain("COMSPEC", journal, StringComparison.Ordinal);
    Assert.DoesNotContain("argumentsJsonUtf8", journal, StringComparison.OrdinalIgnoreCase);
    Assert.Contains(request.Action.ActionTokenSha256, journal, StringComparison.Ordinal);
    Assert.Contains(request.Action.InvocationSha256, journal, StringComparison.Ordinal);
    Assert.Contains(idempotencyKeySha256, journal, StringComparison.Ordinal);
  }

  public static TheoryData<string> ReservationInvocationMutations => new()
  {
    "argv",
    "commandLineSha256",
    "workingDirectory",
    "environment",
    "effectiveTimeoutSeconds",
    "effectiveMaximumOutputBytes",
    "maximumProcesses",
    "maximumProcessMemoryBytes",
  };

  [Theory]
  [MemberData(nameof(ReservationInvocationMutations))]
  public async Task CanonicalInvocationMutationIsRejectedBeforeReservation(
    string field)
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = fixture.Request();

    await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
      fixture.ReserveWithInvocationMutationAsync(request, field).AsTask());

    Assert.Empty(fixture.Store.Snapshot);
    Assert.Equal(0, fixture.Enforcer.BindCount);
  }

  public static TheoryData<string> SuspendedObservationMutations => new()
  {
    "imagePathSha256",
    "imageSha256",
    "imageVolumeSerialNumber",
    "imageFileId",
    "commandLineSha256",
    "workingDirectorySha256",
    "environmentBlockSha256",
    "invocationSha256",
  };

  [Theory]
  [MemberData(nameof(SuspendedObservationMutations))]
  public async Task CompanionObservationMutationIsRejectedBeforeKernelBind(
    string field)
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = fixture.Request();
    var lease = await fixture.ReserveAsync(request);

    await Assert.ThrowsAsync<UnauthorizedAccessException>(() => fixture.BindAsync(
      request,
      lease,
      Fixture.MutateObservation(fixture.Observation(), field)).AsTask());

    Assert.Equal(0, fixture.Enforcer.BindCount);
  }

  [Theory]
  [MemberData(nameof(SuspendedObservationMutations))]
  public async Task IndependentDriverMeasurementMutationFencesKernelBind(
    string field)
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    var request = fixture.Request();
    var lease = await fixture.ReserveAsync(request);
    fixture.Enforcer.BindingMutation = field;

    var error = await Assert.ThrowsAsync<IsolationSupervisorFatalException>(() =>
      fixture.BindAsync(request, lease, fixture.Observation()).AsTask());

    Assert.Equal("kernel_isolation_bind_unavailable", error.ErrorCode);
    Assert.Equal(1, fixture.Enforcer.BindCount);
  }

  [Fact]
  public async Task HashChainTamperFailsClosedOnReload()
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    _ = await fixture.ReserveAsync(fixture.Request());
    await fixture.CloseStateAsync();

    var text = await File.ReadAllTextAsync(fixture.JournalPath);
    var tampered = text.Replace(
      "isolation-supervisor-reservation-key",
      "isolation-supervisor-reservation-kez",
      StringComparison.Ordinal);
    Assert.NotEqual(text, tampered);
    await File.WriteAllTextAsync(fixture.JournalPath, tampered);

    Assert.Throws<InvalidDataException>(() =>
      new FileIsolationLifecycleStore(
        fixture.JournalPath,
        requirePreprovisionedFiles: false));
  }

  [Fact]
  public async Task TornJournalTailFailsClosedOnReload()
  {
    await using var fixture = new Fixture();
    await fixture.Engine.InitializeAndRecoverAsync(CancellationToken.None);
    _ = await fixture.ReserveAsync(fixture.Request());
    await fixture.CloseStateAsync();

    var bytes = await File.ReadAllBytesAsync(fixture.JournalPath);
    Assert.Equal((byte)'\n', bytes[^1]);
    await File.WriteAllBytesAsync(fixture.JournalPath, bytes[..^1]);

    var failure = Assert.Throws<InvalidDataException>(() =>
      new FileIsolationLifecycleStore(
        fixture.JournalPath,
        requirePreprovisionedFiles: false));
    Assert.Contains("incomplete final record", failure.Message, StringComparison.Ordinal);
  }

  private static PrivilegedCommandIsolationReservationRequestV1 MutateReservationShape(
    PrivilegedCommandIsolationReservationRequestV1 request,
    string field)
  {
    var authorization = request.Action.Authorization;
    var budgets = authorization.Budgets;
    var invalidAuthorization = field switch
    {
      "expectedPreStateSha256" => authorization with
      {
        ExpectedPreStateSha256 = new string('A', 64),
      },
      "inputProvenanceSha256" => authorization with
      {
        InputProvenanceSha256 = new string('B', 64),
      },
      "leaseId" => authorization with { LeaseId = " invalid" },
      "fencingToken" => authorization with { FencingToken = "01" },
      "maxWallTimeSeconds" => authorization with
      {
        Budgets = budgets with { MaxWallTimeSeconds = 7_201 },
      },
      "maxModelTurns" => authorization with
      {
        Budgets = budgets with { MaxModelTurns = 201 },
      },
      "maxAttemptedToolCalls" => authorization with
      {
        Budgets = budgets with { MaxAttemptedToolCalls = 501 },
      },
      "maxMutations" => authorization with
      {
        Budgets = budgets with { MaxMutations = 101 },
      },
      "maxLocalBytes" => authorization with
      {
        Budgets = budgets with { MaxLocalBytes = 5_368_709_121 },
      },
      "maxExternalEgressBytes" => authorization with
      {
        Budgets = budgets with { MaxExternalEgressBytes = 262_144_001 },
      },
      "maxModelSpendUsd" => authorization with
      {
        Budgets = budgets with { MaxModelSpendUsd = 20.01m },
      },
      "brokerMaxDeliverySessions" => authorization with
      {
        Budgets = budgets with { BrokerMaxDeliverySessions = 33 },
      },
      "brokerMaxRequestAttemptsPerSession" => authorization with
      {
        Budgets = budgets with { BrokerMaxRequestAttemptsPerSession = 33 },
      },
      "brokerSerializedResultUpperBoundBytes" => authorization with
      {
        Budgets = budgets with { BrokerSerializedResultUpperBoundBytes = 16_777_217 },
      },
      "dispatchExceedsBrokerDeliverySessions" => authorization with
      {
        DispatchCount = 2,
        Budgets = budgets with { BrokerMaxDeliverySessions = 1 },
      },
      _ => throw new ArgumentOutOfRangeException(nameof(field)),
    };
    return request with
    {
      Action = request.Action with { Authorization = invalidAuthorization },
    };
  }

  private sealed class Fixture : IAsyncDisposable
  {
    private static readonly string DeviceId = "10000000-0000-0000-0000-000000000001";
    private static readonly string SupervisorId =
      "20000000-0000-0000-0000-000000000002";
    private static readonly string BootId = "30000000-0000-0000-0000-000000000003";
    private static readonly string PolicySha = new('a', 64);
    private static readonly string DriverSha = new('b', 64);
    private static readonly string ServiceSha = new('c', 64);
    private static readonly string ImageSha = new('e', 64);
    private static readonly string DriverImagePathSha = new('6', 64);
    private readonly string _root;
    private readonly TestSigner _signer;
    private readonly TestActionTokenAuthority _actionTokens = new();
    private readonly TestBootIdentity _boot = new(BootId);
    private readonly FixedTimeProvider _time;
    private readonly Dictionary<string, LiveAuthorization> _live =
      new(StringComparer.Ordinal);
    private bool _stateClosed;

    public Fixture(
      string? killSwitchPath = null,
      TimeSpan? reservationLeaseLifetime = null)
    {
      _root = Path.Combine(
        Path.GetTempPath(),
        $"msaidizi-isolation-supervisor-tests-{Guid.NewGuid():N}");
      Directory.CreateDirectory(_root);
      JournalPath = Path.Combine(_root, "lifecycle.v1.jsonl");
      Options = new PrivilegedCommandSupervisorOptions
      {
        Enabled = true,
        DeviceId = DeviceId,
        SupervisorInstanceId = SupervisorId,
        IsolationPolicySha256 = PolicySha,
        DriverMeasurementSha256 = DriverSha,
        ExpectedSupervisorImageSha256 = ServiceSha,
        DriverServiceName =
          PrivilegedCommandIsolationSupervisorIdentity.DriverServiceName,
        DriverPolicyEpoch = "isolation-policy-v2",
        ActionTokenExpectedIssuer = TestActionTokenAuthority.Issuer,
        ActionTokenExpectedAudience = TestActionTokenAuthority.Audience,
        ActionTokenExpectedSubject = TestActionTokenAuthority.Subject,
        ActionTokenAllowedClockSkew = TimeSpan.FromSeconds(30),
        ActionTokenMaximumLifetime = TimeSpan.FromMinutes(5),
        KillSwitchPath = killSwitchPath ?? Path.Combine(_root, "DISABLED"),
        ReservationLeaseLifetime = reservationLeaseLifetime ?? TimeSpan.FromMinutes(1),
        BindAcknowledgementLifetime = TimeSpan.FromSeconds(20),
        MaximumExecutionDuration = TimeSpan.FromHours(2),
      };
      _time = new FixedTimeProvider(
        DateTimeOffset.FromUnixTimeMilliseconds(2_000_000_000_000));
      _signer = new TestSigner();
      var attestationEvidence = new PrivilegedCommandDriverAttestationEvidenceV2(
        PrivilegedCommandIsolationCanonical.ContractVersion,
        PrivilegedCommandIsolationSignaturePurposes.DriverAttestation,
        "driver-attestation-key-v2",
        DeviceId,
        SupervisorId,
        BootId,
        Options.DriverPolicyEpoch,
        new string('0', 64),
        PolicySha,
        DriverSha,
        ServiceSha,
        Options.DriverServiceName,
        DriverImagePathSha,
        SecureBootEnabled: true,
        HvciEnabled: true,
        WdacEnforced: true,
        PrivilegedCommandIsolationFeatures.Required,
        _time.GetUtcNow().ToUnixTimeMilliseconds(),
        _time.GetUtcNow().AddMinutes(1).ToUnixTimeMilliseconds());
      var signedAttestation = new SignedPrivilegedCommandDriverAttestationV2(
        attestationEvidence,
        Convert.ToBase64String(new byte[64]));
      Enforcer = new FakeEnforcer(
        new KernelIsolationAttestation(
          DeviceId,
          BootId,
          PolicySha,
          DriverSha,
          ServiceSha,
          SupervisorId,
          Options.DriverPolicyEpoch,
          Options.DriverServiceName,
          DriverImagePathSha,
          SecureBootEnabled: true,
          HvciEnabled: true,
          WdacEnforced: true,
          PrivilegedCommandIsolationFeatures.Required,
          PrivilegedCommandIsolationCanonical.DriverAttestationSha256(
            attestationEvidence),
          signedAttestation));
      Store = new FileIsolationLifecycleStore(
        JournalPath,
        requirePreprovisionedFiles: false);
      Engine = NewEngine();
      Peer = new PipePeerIdentity(
        4000,
        123_456_789,
        new string('1', 64),
        new string('2', 64));
    }

    public string JournalPath { get; }

    public PrivilegedCommandSupervisorOptions Options { get; }

    public FakeEnforcer Enforcer { get; }

    public FileIsolationLifecycleStore Store { get; private set; }

    public IsolationLifecycleEngine Engine { get; private set; }

    public PipePeerIdentity Peer { get; }

    public DateTimeOffset UtcNow => _time.GetUtcNow();

    public PrivilegedCommandIsolationReservationRequestV1 Request(
      string? actionId = null,
      string? requestId = null,
      TimeSpan? tokenLifetime = null,
      TimeSpan? actionLeaseLifetime = null,
      TimeSpan? requestLifetime = null)
    {
      var nowUtc = _time.GetUtcNow();
      var now = nowUtc.ToUnixTimeMilliseconds();
      var actualActionId = actionId ?? Guid.NewGuid().ToString("D");
      var actualRequestId = requestId ?? Guid.NewGuid().ToString("D");
      var taskId = Guid.NewGuid().ToString("D");
      var planVersionId = Guid.NewGuid().ToString("D");
      var stepId = Guid.NewGuid().ToString("D");
      var mandateId = Guid.NewGuid().ToString("D");
      const string argumentsJson =
        "{\"executable\":\"cmd\",\"argv\":[\"/d\",\"/s\",\"/c\",\"echo test\"],\"timeoutSeconds\":30,\"maximumOutputBytes\":1024}";
      var argumentsSha = PayloadDigest.Sha256Hex(argumentsJson);
      var budgets = new ActionBudget(
        120,
        20,
        50,
        10,
        1_048_576,
        0,
        1m,
        3,
        3,
        1_048_576);
      var actionRequest = new ActionRequest(
        actualActionId,
        taskId,
        planVersionId,
        stepId,
        DeviceId,
        mandateId,
        PrivilegedCommandIsolationCapability.Id,
        PrivilegedCommandIsolationCapability.Version,
        argumentsJson,
        argumentsSha,
        ExpectedPreStateSha256: null,
        InputProvenanceSha256: null,
        IdempotencyKey: $"command:{actualActionId}",
        DispatchCount: 1,
        LeaseId: $"lease:{actualActionId}",
        FencingToken: "1",
        LeaseExpiresAt: nowUtc.Add(
          actionLeaseLifetime ?? TimeSpan.FromMinutes(2)),
        ExecutionMode: ActionExecutionModes.Execute);
      var claims = TestActionTokenAuthority.Claims(actionRequest, budgets, nowUtc) with
      {
        ExpiresAtUnixSeconds = nowUtc.Add(
          tokenLifetime ?? TimeSpan.FromMinutes(1)).ToUnixTimeSeconds(),
      };
      var compactToken = _actionTokens.Issue(claims);
      var invocation = CreateInvocation();
      var reservation = new PrivilegedCommandIsolationReservationRequestV1(
        PrivilegedCommandIsolationCanonical.ContractVersion,
        actualRequestId,
        Nonce(),
        new PrivilegedCommandIsolationActionBinding(
          actualActionId,
          taskId,
          planVersionId,
          stepId,
          DeviceId,
          mandateId,
          PayloadDigest.Sha256Hex(compactToken),
          PrivilegedCommandIsolationCanonical.InvocationSha256(invocation),
          PayloadDigest.Sha256Hex(invocation.ExecutablePath),
          ImageSha,
          PolicySha,
          DriverSha,
          ServiceSha,
          PrivilegedCommandIsolationFeatures.Required,
          new PrivilegedCommandIsolationActionAuthorizationV2(
            actionRequest.CapabilityId,
            actionRequest.CapabilityVersion,
            argumentsSha,
            actionRequest.ExpectedPreStateSha256,
            actionRequest.InputProvenanceSha256,
            PayloadDigest.Sha256Hex(actionRequest.IdempotencyKey),
            actionRequest.LeaseId,
            actionRequest.FencingToken,
            actionRequest.LeaseExpiresAt.ToUnixTimeSeconds(),
            actionRequest.DispatchCount,
            actionRequest.ExecutionMode,
            budgets)),
        now,
        now + checked((long)(requestLifetime ?? TimeSpan.FromMinutes(1)).TotalMilliseconds));
      _live.Add(actualRequestId, new LiveAuthorization(
        compactToken,
        actionRequest,
        invocation));
      return reservation;
    }

    public void Advance(TimeSpan duration) => _time.Advance(duration);

    public SuspendedProcessObservation Observation()
    {
      var invocation = _live.Values.Last().Invocation;
      return new SuspendedProcessObservation(
        Peer.ProcessId,
        Peer.ProcessCreationTimeUtcFileTime,
        5000,
        Peer.ProcessCreationTimeUtcFileTime + 10,
        6000,
        PayloadDigest.Sha256Hex(invocation.ExecutablePath),
        ImageSha,
        invocation.ExecutableVolumeSerialNumber,
        invocation.ExecutableFileId,
        invocation.CommandLineSha256,
        PrivilegedCommandIsolationCanonical.WorkingDirectorySha256(
          invocation.WorkingDirectory),
        invocation.EnvironmentBlockSha256,
        PrivilegedCommandIsolationCanonical.InvocationSha256(invocation),
        CreatedSuspended: true,
        AssignedToJob: true);
    }

    public ValueTask<SignedPrivilegedCommandIsolationReservationLease> ReserveAsync(
      PrivilegedCommandIsolationReservationRequestV1 request)
    {
      var live = _live[request.RequestId];
      return Engine.ReserveAsync(
        request,
        live.CompactToken,
        live.ActionRequest,
        live.Invocation,
        CancellationToken.None);
    }

    public string CompactTokenFor(
      PrivilegedCommandIsolationReservationRequestV1 request) =>
      _live[request.RequestId].CompactToken;

    public string IdempotencyKeyFor(
      PrivilegedCommandIsolationReservationRequestV1 request) =>
      _live[request.RequestId].ActionRequest.IdempotencyKey;

    public ValueTask<SignedPrivilegedCommandIsolationReservationLease>
      ReserveWithInvalidSignatureAsync(
        PrivilegedCommandIsolationReservationRequestV1 request)
    {
      var live = _live[request.RequestId];
      var segments = live.CompactToken.Split('.');
      segments[2] = (segments[2][0] == 'A' ? "B" : "A") + segments[2][1..];
      var tampered = string.Join('.', segments);
      var matchingHashRequest = request with
      {
        Action = request.Action with
        {
          ActionTokenSha256 = PayloadDigest.Sha256Hex(tampered),
        },
      };
      return Engine.ReserveAsync(
        matchingHashRequest,
        tampered,
        live.ActionRequest,
        live.Invocation,
        CancellationToken.None);
    }

    public ValueTask<SignedPrivilegedCommandIsolationReservationLease>
      ReserveWithClaimMutationAsync(
        PrivilegedCommandIsolationReservationRequestV1 request,
        string claim)
    {
      var live = _live[request.RequestId];
      var original = TestActionTokenAuthority.Claims(
        live.ActionRequest,
        request.Action.Authorization.Budgets,
        _time.GetUtcNow());
      var mutated = MutateClaim(original, claim);
      var compactToken = _actionTokens.Issue(mutated);
      var matchingHashRequest = request with
      {
        Action = request.Action with
        {
          ActionTokenSha256 = PayloadDigest.Sha256Hex(compactToken),
        },
      };
      return Engine.ReserveAsync(
        matchingHashRequest,
        compactToken,
        live.ActionRequest,
        live.Invocation,
        CancellationToken.None);
    }

    public ValueTask<SignedPrivilegedCommandIsolationReservationLease>
      ReserveWithInvocationMutationAsync(
        PrivilegedCommandIsolationReservationRequestV1 request,
        string field)
    {
      var live = _live[request.RequestId];
      var invocation = MutateInvocation(live.Invocation, field);
      var matchingRequest = request with
      {
        Action = request.Action with
        {
          InvocationSha256 =
            PrivilegedCommandIsolationCanonical.InvocationSha256(invocation),
        },
      };
      return Engine.ReserveAsync(
        matchingRequest,
        live.CompactToken,
        live.ActionRequest,
        invocation,
        CancellationToken.None);
    }

    public ValueTask<BindResponsePayload> BindAsync(
      PrivilegedCommandIsolationReservationRequestV1 request,
      SignedPrivilegedCommandIsolationReservationLease lease,
      SuspendedProcessObservation observation)
    {
      var live = _live[request.RequestId];
      return Engine.BindAsync(
        request,
        lease,
        observation,
        live.Invocation,
        Peer,
        CancellationToken.None);
    }

    public KernelIsolationTerminalEvidence Terminal(
      string outcome,
      bool exitCodeKnown,
      int exitCode,
      bool processResumed)
    {
      var now = _time.GetUtcNow().ToUnixTimeMilliseconds();
      return new KernelIsolationTerminalEvidence(
        processResumed,
        processResumed ? now : 0,
        now,
        ProcessTreeTerminal: true,
        EnforcementContinuous: true,
        exitCodeKnown,
        exitCode,
        new string('9', 64),
        outcome);
    }

    public PrivilegedCommandIsolationContractVerifier Verifier() => new(
      PrivilegedCommandIsolationVerificationSettings.Strict(
        DeviceId,
        PolicySha,
        DriverSha,
        ServiceSha),
      _signer,
      _time);

    public async ValueTask RestartAsync()
    {
      Engine.Dispose();
      await Store.DisposeAsync();
      Store = new FileIsolationLifecycleStore(
        JournalPath,
        requirePreprovisionedFiles: false);
      Engine = NewEngine();
      await Engine.InitializeAndRecoverAsync(CancellationToken.None);
    }

    public async ValueTask CloseStateAsync()
    {
      if (!_stateClosed)
      {
        Engine.Dispose();
        await Store.DisposeAsync();
        _stateClosed = true;
      }
    }

    public async ValueTask DisposeAsync()
    {
      if (!_stateClosed)
      {
        Engine.Dispose();
        await Store.DisposeAsync();
      }
      _signer.Dispose();
      _actionTokens.Dispose();
      await Enforcer.DisposeAsync();
      var fullRoot = Path.GetFullPath(_root);
      var tempRoot = Path.GetFullPath(Path.GetTempPath());
      if (fullRoot.StartsWith(tempRoot, StringComparison.OrdinalIgnoreCase)
        && Directory.Exists(fullRoot))
      {
        Directory.Delete(fullRoot, recursive: true);
      }
    }

    private IsolationLifecycleEngine NewEngine() => new(
      Options,
      _signer,
      Enforcer,
      Store,
      _boot,
      new Es256ActionTokenVerifier(
        new ActionTokenVerificationSettings(
          TestActionTokenAuthority.Issuer,
          TestActionTokenAuthority.Audience,
          TestActionTokenAuthority.Subject,
          TimeSpan.FromSeconds(30),
          TimeSpan.FromMinutes(5)),
        _actionTokens,
        _time),
      _time);

    private static PrivilegedCommandIsolationInvocationV2 CreateInvocation()
    {
      var windows = Path.TrimEndingDirectorySeparator(Path.GetFullPath(
        Environment.GetFolderPath(Environment.SpecialFolder.Windows)));
      var system32 = Path.TrimEndingDirectorySeparator(Path.GetFullPath(
        Environment.SystemDirectory));
      var powershell = Path.Combine(system32, "WindowsPowerShell", "v1.0");
      var systemDrive = Path.TrimEndingDirectorySeparator(
        Path.GetPathRoot(windows)!);
      var environment = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
      {
        ["COMSPEC"] = Path.Combine(system32, "cmd.exe"),
        ["OS"] = "Windows_NT",
        ["PATH"] = string.Join(Path.PathSeparator, system32, windows, powershell),
        ["PATHEXT"] = ".COM;.EXE;.BAT;.CMD",
        ["POWERSHELL_TELEMETRY_OPTOUT"] = "1",
        ["PSModulePath"] = Path.Combine(
          system32,
          "WindowsPowerShell",
          "v1.0",
          "Modules"),
        ["SystemDrive"] = systemDrive,
        ["SystemRoot"] = windows,
        ["WINDIR"] = windows,
      }.OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
        .ThenBy(pair => pair.Key, StringComparer.Ordinal)
        .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);
      var values = environment.Select(pair =>
        new PrivilegedCommandIsolationEnvironmentVariableV2(pair.Key, pair.Value)).ToArray();
      var draft = new PrivilegedCommandIsolationInvocationV2(
        PrivilegedCommandIsolationCanonical.ContractVersion,
        "cmd",
        Path.Combine(system32, "cmd.exe"),
        ImageSha,
        42,
        43,
        ["/d", "/s", "/c", "echo test"],
        system32,
        values,
        30,
        1_024,
        30,
        1_024,
        16,
        536_870_912,
        string.Empty,
        string.Empty);
      return draft with
      {
        CommandLineSha256 = PayloadDigest.Sha256Hex(
          PrivilegedCommandIsolationCanonical.BuildCommandLine(draft)),
        EnvironmentBlockSha256 =
          PrivilegedCommandIsolationCanonical.EnvironmentBlockSha256(values),
      };
    }

    private static PrivilegedCommandIsolationInvocationV2 MutateInvocation(
      PrivilegedCommandIsolationInvocationV2 value,
      string field)
    {
      var mutated = field switch
      {
        "argv" => value with
        {
          Arguments = value.Arguments
            .Select((argument, index) => index == value.Arguments.Count - 1
              ? argument + " altered"
              : argument)
            .ToArray(),
        },
        "commandLineSha256" => value with
        {
          CommandLineSha256 = new string('1', 64),
        },
        "workingDirectory" => value with
        {
          WorkingDirectory = Path.GetPathRoot(value.WorkingDirectory)!,
        },
        "environment" => value with
        {
          Environment = value.Environment
            .Select(variable => string.Equals(
                variable.Name,
                "OS",
                StringComparison.OrdinalIgnoreCase)
              ? variable with { Value = "Windows_Altered" }
              : variable)
            .ToArray(),
        },
        "effectiveTimeoutSeconds" => value with
        {
          EffectiveTimeoutSeconds = value.EffectiveTimeoutSeconds - 1,
        },
        "effectiveMaximumOutputBytes" => value with
        {
          EffectiveMaximumOutputBytes = value.EffectiveMaximumOutputBytes - 1,
        },
        "maximumProcesses" => value with
        {
          MaximumProcesses = value.MaximumProcesses - 1,
        },
        "maximumProcessMemoryBytes" => value with
        {
          MaximumProcessMemoryBytes = value.MaximumProcessMemoryBytes - 1,
        },
        _ => throw new ArgumentOutOfRangeException(nameof(field)),
      };
      return mutated with
      {
        CommandLineSha256 = string.Equals(
            field,
            "commandLineSha256",
            StringComparison.Ordinal)
          ? mutated.CommandLineSha256
          : PayloadDigest.Sha256Hex(
            PrivilegedCommandIsolationCanonical.BuildCommandLine(mutated)),
        EnvironmentBlockSha256 =
          PrivilegedCommandIsolationCanonical.EnvironmentBlockSha256(
            mutated.Environment),
      };
    }

    public static SuspendedProcessObservation MutateObservation(
      SuspendedProcessObservation value,
      string field) => field switch
      {
        "imagePathSha256" => value with { ImagePathSha256 = new string('3', 64) },
        "imageSha256" => value with { ImageSha256 = new string('4', 64) },
        "imageVolumeSerialNumber" => value with
        {
          ImageVolumeSerialNumber = value.ImageVolumeSerialNumber + 1,
        },
        "imageFileId" => value with { ImageFileId = value.ImageFileId + 1 },
        "commandLineSha256" => value with
        {
          CommandLineSha256 = new string('5', 64),
        },
        "workingDirectorySha256" => value with
        {
          WorkingDirectorySha256 = new string('6', 64),
        },
        "environmentBlockSha256" => value with
        {
          EnvironmentBlockSha256 = new string('7', 64),
        },
        "invocationSha256" => value with
        {
          InvocationSha256 = new string('8', 64),
        },
        _ => throw new ArgumentOutOfRangeException(nameof(field)),
      };

    private static ActionTokenClaims MutateClaim(
      ActionTokenClaims value,
      string claim) => claim switch
      {
        "issuer" => value with { Issuer = value.Issuer + ".other" },
        "audience" => value with { Audience = value.Audience + ".other" },
        "subject" => value with { Subject = value.Subject + ".other" },
        "actionId" => value with { ActionId = Guid.NewGuid().ToString("D") },
        "taskId" => value with { TaskId = Guid.NewGuid().ToString("D") },
        "planVersionId" => value with
        {
          PlanVersionId = Guid.NewGuid().ToString("D"),
        },
        "stepId" => value with { StepId = Guid.NewGuid().ToString("D") },
        "deviceId" => value with { DeviceId = Guid.NewGuid().ToString("D") },
        "mandateId" => value with { MandateId = Guid.NewGuid().ToString("D") },
        "capabilityId" => value with { CapabilityId = "command.other" },
        "capabilityVersion" => value with { CapabilityVersion = "9.9.9" },
        "argumentsSha256" => value with { ArgumentsSha256 = new string('1', 64) },
        "expectedPreStateSha256" => value with
        {
          ExpectedPreStateSha256 = new string('2', 64),
        },
        "inputProvenanceSha256" => value with
        {
          InputProvenanceSha256 = new string('3', 64),
        },
        "idempotencyKey" => value with
        {
          IdempotencyKey = value.IdempotencyKey + ":other",
        },
        "leaseId" => value with { LeaseId = value.LeaseId + ":other" },
        "fencingToken" => value with { FencingToken = "2" },
        "leaseExpiresAt" => value with
        {
          LeaseExpiresAtUnixSeconds = value.LeaseExpiresAtUnixSeconds + 1,
        },
        "dispatchCount" => value with { DispatchCount = 2 },
        "executionMode" => value with
        {
          ExecutionMode = ActionExecutionModes.ReplayResultOnly,
        },
        "maxWallTimeSeconds" => value with
        {
          Budgets = value.Budgets with
          {
            MaxWallTimeSeconds = value.Budgets.MaxWallTimeSeconds + 1,
          },
        },
        "maxModelTurns" => value with
        {
          Budgets = value.Budgets with { MaxModelTurns = value.Budgets.MaxModelTurns + 1 },
        },
        "maxAttemptedToolCalls" => value with
        {
          Budgets = value.Budgets with
          {
            MaxAttemptedToolCalls = value.Budgets.MaxAttemptedToolCalls + 1,
          },
        },
        "maxMutations" => value with
        {
          Budgets = value.Budgets with { MaxMutations = value.Budgets.MaxMutations + 1 },
        },
        "maxLocalBytes" => value with
        {
          Budgets = value.Budgets with { MaxLocalBytes = value.Budgets.MaxLocalBytes + 1 },
        },
        "maxExternalEgressBytes" => value with
        {
          Budgets = value.Budgets with
          {
            MaxExternalEgressBytes = value.Budgets.MaxExternalEgressBytes + 1,
          },
        },
        "maxModelSpendUsd" => value with
        {
          Budgets = value.Budgets with
          {
            MaxModelSpendUsd = value.Budgets.MaxModelSpendUsd + 1,
          },
        },
        "brokerMaxDeliverySessions" => value with
        {
          Budgets = value.Budgets with
          {
            BrokerMaxDeliverySessions = value.Budgets.BrokerMaxDeliverySessions + 1,
          },
        },
        "brokerMaxRequestAttemptsPerSession" => value with
        {
          Budgets = value.Budgets with
          {
            BrokerMaxRequestAttemptsPerSession =
              value.Budgets.BrokerMaxRequestAttemptsPerSession + 1,
          },
        },
        "brokerSerializedResultUpperBoundBytes" => value with
        {
          Budgets = value.Budgets with
          {
            BrokerSerializedResultUpperBoundBytes =
              value.Budgets.BrokerSerializedResultUpperBoundBytes + 1,
          },
        },
        _ => throw new ArgumentOutOfRangeException(nameof(claim)),
      };

    private static string Nonce()
    {
      var bytes = RandomNumberGenerator.GetBytes(32);
      return Convert.ToBase64String(bytes)
        .TrimEnd('=')
        .Replace('+', '-')
        .Replace('/', '_');
    }

    private sealed record LiveAuthorization(
      string CompactToken,
      ActionRequest ActionRequest,
      PrivilegedCommandIsolationInvocationV2 Invocation);
  }

  private sealed class TestSigner :
    IIsolationEvidenceSigner,
    IPrivilegedCommandIsolationVerificationKeyResolver
  {
    private const string ReservationKeyId =
      "isolation-supervisor-reservation-key";
    private const string ReleaseKeyId = "isolation-supervisor-release-key";
    private const string BindKeyId = "isolation-supervisor-bind-key";
    private const string TerminalKeyId = "isolation-supervisor-terminal-key";
    private readonly ECDsa _reservationKey =
      ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private readonly ECDsa _releaseKey =
      ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private readonly ECDsa _bindKey =
      ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private readonly ECDsa _terminalKey =
      ECDsa.Create(ECCurve.NamedCurves.nistP256);

    public SignedPrivilegedCommandIsolationReservationLease Sign(
      PrivilegedCommandIsolationReservationLeaseV1 lease) =>
      PrivilegedCommandIsolationCanonical.SignReservationLease(
        lease,
        ReservationKeyId,
        _reservationKey);

    public SignedPrivilegedCommandIsolationPreBindRelease Sign(
      PrivilegedCommandIsolationPreBindReleaseV1 release) =>
      PrivilegedCommandIsolationCanonical.SignPreBindRelease(
        release,
        ReleaseKeyId,
        _releaseKey);

    public SignedPrivilegedCommandIsolationBindAcknowledgement Sign(
      PrivilegedCommandIsolationBindAcknowledgementV1 acknowledgement) =>
      PrivilegedCommandIsolationCanonical.SignBindAcknowledgement(
        acknowledgement,
        BindKeyId,
        _bindKey);

    public SignedPrivilegedCommandIsolationTerminalReceipt Sign(
      PrivilegedCommandIsolationTerminalReceiptV1 receipt) =>
      PrivilegedCommandIsolationCanonical.SignTerminalReceipt(
        receipt,
        TerminalKeyId,
        _terminalKey);

    public bool TryResolve(
      string keyId,
      string signaturePurpose,
      out ECDsa? publicKey)
    {
      var source = (keyId, signaturePurpose) switch
      {
        (ReservationKeyId,
          PrivilegedCommandIsolationSignaturePurposes.ReservationLease) =>
          _reservationKey,
        (ReleaseKeyId,
          PrivilegedCommandIsolationSignaturePurposes.PreBindReservationRelease) =>
          _releaseKey,
        (BindKeyId,
          PrivilegedCommandIsolationSignaturePurposes
            .SuspendedProcessBindAcknowledgement) => _bindKey,
        (TerminalKeyId,
          PrivilegedCommandIsolationSignaturePurposes.TerminalEnforcementReceipt) =>
          _terminalKey,
        _ => null,
      };
      if (source is null)
      {
        publicKey = null;
        return false;
      }
      publicKey = ECDsa.Create(source.ExportParameters(false));
      return true;
    }

    public void Dispose()
    {
      _terminalKey.Dispose();
      _bindKey.Dispose();
      _releaseKey.Dispose();
      _reservationKey.Dispose();
    }
  }

  private sealed class TestActionTokenAuthority :
    IActionVerificationKeyResolver,
    IDisposable
  {
    public const string Issuer = "itemba-msaidizi-broker";
    public const string Audience = "itemba-windows-companion";
    public const string Subject = "msaidizi-global";
    private const string KeyId = "test-action-token-key";
    private static readonly JsonSerializerOptions JsonOptions = new(
      JsonSerializerDefaults.Web);
    private readonly ECDsa _key = ECDsa.Create(ECCurve.NamedCurves.nistP256);

    public static ActionTokenClaims Claims(
      ActionRequest request,
      ActionBudget budgets,
      DateTimeOffset now) => new()
      {
        Issuer = Issuer,
        Audience = Audience,
        Subject = Subject,
        TokenId = Guid.NewGuid().ToString("D"),
        ActionId = request.ActionId,
        TaskId = request.TaskId,
        PlanVersionId = request.PlanVersionId,
        StepId = request.StepId,
        DeviceId = request.DeviceId,
        MandateId = request.MandateId,
        CapabilityId = request.CapabilityId,
        CapabilityVersion = request.CapabilityVersion,
        ArgumentsSha256 = request.ArgumentsSha256,
        ExpectedPreStateSha256 = request.ExpectedPreStateSha256,
        InputProvenanceSha256 = request.InputProvenanceSha256,
        IdempotencyKey = request.IdempotencyKey,
        LeaseId = request.LeaseId,
        FencingToken = request.FencingToken,
        LeaseExpiresAtUnixSeconds = request.LeaseExpiresAt.ToUnixTimeSeconds(),
        DispatchCount = request.DispatchCount,
        ExecutionMode = request.ExecutionMode,
        ConsentGrant = null,
        Budgets = budgets,
        IssuedAtUnixSeconds = now.ToUnixTimeSeconds(),
        ExpiresAtUnixSeconds = now.AddMinutes(1).ToUnixTimeSeconds(),
      };

    public string Issue(ActionTokenClaims claims)
    {
      var header = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new
      {
        alg = "ES256",
        kid = KeyId,
        typ = "at+jwt",
      }, JsonOptions));
      var payload = Base64Url(JsonSerializer.SerializeToUtf8Bytes(claims, JsonOptions));
      var signed = Encoding.ASCII.GetBytes($"{header}.{payload}");
      var signature = _key.SignData(
        signed,
        HashAlgorithmName.SHA256,
        DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
      return $"{header}.{payload}.{Base64Url(signature)}";
    }

    public bool TryResolve(string keyId, out ECDsa? publicKey)
    {
      if (!string.Equals(keyId, KeyId, StringComparison.Ordinal))
      {
        publicKey = null;
        return false;
      }
      publicKey = ECDsa.Create(_key.ExportParameters(false));
      return true;
    }

    public void Dispose() => _key.Dispose();

    private static string Base64Url(byte[] value) => Convert.ToBase64String(value)
      .TrimEnd('=')
      .Replace('+', '-')
      .Replace('/', '_');
  }

  private sealed class FakeEnforcer(KernelIsolationAttestation attestation) :
    IPrivilegedCommandKernelEnforcer
  {
    public int AttestationCount { get; private set; }
    public int BindCount { get; private set; }
    public int SettleCount { get; private set; }
    public int RecoverCount { get; private set; }
    public Exception? AttestationFailure { get; set; }
    public Exception? BindFailure { get; set; }
    public KernelIsolationTerminalEvidence? Terminal { get; set; }
    public KernelIsolationTerminalEvidence? RecoveryTerminal { get; set; }
    public Exception? SettleFailure { get; set; }
    public string? BindingMutation { get; set; }

    public ValueTask<KernelIsolationAttestation> AttestAsync(
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      AttestationCount++;
      return AttestationFailure is null
        ? ValueTask.FromResult(attestation)
        : ValueTask.FromException<KernelIsolationAttestation>(AttestationFailure);
    }

    public ValueTask<KernelIsolationBinding> BindSuspendedProcessAsync(
      PrivilegedCommandIsolationReservationRequestV1 request,
      SuspendedProcessObservation observation,
      PrivilegedCommandIsolationInvocationV2 invocation,
      PipePeerIdentity peer,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      BindCount++;
      if (BindFailure is not null)
      {
        return ValueTask.FromException<KernelIsolationBinding>(BindFailure);
      }
      var binding = new KernelIsolationBinding(
        "70000000-0000-0000-0000-000000000007",
        "80000000-0000-0000-0000-000000000008",
        new string('8', 64),
        observation.ImagePathSha256,
        observation.ImageSha256,
        observation.ImageVolumeSerialNumber,
        observation.ImageFileId,
        observation.CommandLineSha256,
        observation.WorkingDirectorySha256,
        observation.EnvironmentBlockSha256,
        observation.InvocationSha256,
        ChildStillSuspended: true,
        AssignedToJob: true,
        KernelEnforcementActive: true,
        PrivilegedCommandIsolationFeatures.Required,
        new string('7', 64));
      return ValueTask.FromResult(BindingMutation is null
        ? binding
        : MutateBinding(binding, BindingMutation));
    }

    private static KernelIsolationBinding MutateBinding(
      KernelIsolationBinding value,
      string field) => field switch
      {
        "imagePathSha256" => value with { ImagePathSha256 = new string('3', 64) },
        "imageSha256" => value with { ImageSha256 = new string('4', 64) },
        "imageVolumeSerialNumber" => value with
        {
          ImageVolumeSerialNumber = value.ImageVolumeSerialNumber + 1,
        },
        "imageFileId" => value with { ImageFileId = value.ImageFileId + 1 },
        "commandLineSha256" => value with
        {
          CommandLineSha256 = new string('5', 64),
        },
        "workingDirectorySha256" => value with
        {
          WorkingDirectorySha256 = new string('6', 64),
        },
        "environmentBlockSha256" => value with
        {
          EnvironmentBlockSha256 = new string('7', 64),
        },
        "invocationSha256" => value with
        {
          InvocationSha256 = new string('8', 64),
        },
        _ => throw new ArgumentOutOfRangeException(nameof(field)),
      };

    public ValueTask<KernelIsolationTerminalEvidence> SettleAsync(
      string enforcementLeaseId,
      PrivilegedCommandSuspendedProcessBindingV1 binding,
      TerminalObservation requestedObservation,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      SettleCount++;
      if (SettleFailure is not null)
      {
        return ValueTask.FromException<KernelIsolationTerminalEvidence>(SettleFailure);
      }
      return ValueTask.FromResult(Terminal
        ?? throw new InvalidOperationException("The fake terminal evidence is missing."));
    }

    public ValueTask<KernelIsolationTerminalEvidence> RecoverAndTerminateAsync(
      string enforcementLeaseId,
      PrivilegedCommandSuspendedProcessBindingV1 binding,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      RecoverCount++;
      return ValueTask.FromResult(RecoveryTerminal
        ?? throw new InvalidOperationException("The fake recovery evidence is missing."));
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
  }

  private sealed class TestBootIdentity(string bootId) : IBootIdentity
  {
    public string BootId { get; } = bootId;
  }

  private sealed class FixedTimeProvider(DateTimeOffset value) : TimeProvider
  {
    private DateTimeOffset _value = value;

    public override DateTimeOffset GetUtcNow() => _value;

    public void Advance(TimeSpan duration) => _value = _value.Add(duration);
  }
}
