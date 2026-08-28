using System.Reflection;
using System.Security.Cryptography;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class PrivilegedCommandIsolationContractTests
{
  private const long NowUnixMilliseconds = 1_800_000_000_000;
  private const string DeviceId = "10000000-0000-4000-8000-000000000001";
  private const string PolicySha256 =
    "1111111111111111111111111111111111111111111111111111111111111111";
  private const string DriverSha256 =
    "2222222222222222222222222222222222222222222222222222222222222222";
  private const string ServiceSha256 =
    "3333333333333333333333333333333333333333333333333333333333333333";

  [Fact]
  public void VerifiesReservationBindResumeAndTerminalReceipt()
  {
    using var harness = CreateHarness();

    var reservation = harness.VerifyReservation();
    var bind = harness.VerifyBind(reservation);
    var terminal = harness.Verifier.VerifyTerminalReceipt(bind, harness.SignedReceipt);

    Assert.True(terminal.IsValid, terminal.ErrorCode);
    Assert.NotNull(terminal.Value);
    Assert.True(terminal.Value.IsIsolationIntact);
    Assert.Equal(
      PrivilegedCommandIsolationCanonical.TerminalReceiptSha256(
        harness.SignedReceipt.Receipt),
      terminal.Value.ReceiptSha256);
    Assert.Equal(
      new[]
      {
        PrivilegedCommandIsolationSignaturePurposes.ReservationLease,
        PrivilegedCommandIsolationSignaturePurposes.SuspendedProcessBindAcknowledgement,
        PrivilegedCommandIsolationSignaturePurposes.TerminalEnforcementReceipt,
      },
      harness.Resolver.RequestedPurposes);
  }

  [Fact]
  public void VerifiesSignedPreBindReleaseAsTheOnlyTruthfulNoChildSettlement()
  {
    using var harness = CreateHarness();
    var reservation = harness.VerifyReservation();

    var released = harness.Verifier.VerifyPreBindRelease(
      reservation,
      harness.SignedRelease);

    Assert.True(released.IsValid, released.ErrorCode);
    Assert.NotNull(released.Value);
    Assert.Equal(
      PrivilegedCommandIsolationCanonical.PreBindReleaseSha256(
        harness.SignedRelease.Release),
      released.Value.ReleaseSha256);
    Assert.Equal(
      PrivilegedCommandIsolationSignaturePurposes.PreBindReservationRelease,
      harness.Resolver.RequestedPurposes[^1]);
  }

  [Fact]
  public void VerifiesPostBindCancellationWithoutFabricatingAResume()
  {
    using var harness = CreateHarness();
    var reservation = harness.VerifyReservation();
    var bind = harness.VerifyBind(reservation);
    var neverResumed = harness.SignedReceipt.Receipt with
    {
      ProcessResumed = false,
      ResumedAtUnixMilliseconds = 0,
      EndedAtUnixMilliseconds = NowUnixMilliseconds - 1_500,
      IssuedAtUnixMilliseconds = NowUnixMilliseconds - 1_000,
      ExitCodeKnown = false,
      ExitCode = 0,
      Outcome = PrivilegedCommandIsolationTerminalOutcomes.Cancelled,
    };

    var verified = harness.Verifier.VerifyTerminalReceipt(
      bind,
      PrivilegedCommandIsolationCanonical.SignTerminalReceipt(
        neverResumed,
        TestHarness.ReceiptKeyId,
        harness.ReceiptKey));

    Assert.True(verified.IsValid, verified.ErrorCode);
    Assert.NotNull(verified.Value);
    Assert.True(verified.Value.IsIsolationIntact);

    var falseCompletion = neverResumed with
    {
      ExitCodeKnown = true,
      Outcome = PrivilegedCommandIsolationTerminalOutcomes.Completed,
    };
    Assert.Equal(
      "isolation_terminal_receipt_invalid",
      harness.Verifier.VerifyTerminalReceipt(
        bind,
        PrivilegedCommandIsolationCanonical.SignTerminalReceipt(
          falseCompletion,
          TestHarness.ReceiptKeyId,
          harness.ReceiptKey)).ErrorCode);
  }

  [Fact]
  public void ExactActionTaskDeviceTokenInvocationPolicyDriverAndServiceBindingsAreRequired()
  {
    using var harness = CreateHarness();
    var mutations = new PrivilegedCommandIsolationActionBinding[]
    {
      harness.Action with { ActionId = "20000000-0000-4000-8000-000000000099" },
      harness.Action with { TaskId = "30000000-0000-4000-8000-000000000099" },
      harness.Action with { PlanVersionId = "40000000-0000-4000-8000-000000000099" },
      harness.Action with { StepId = "50000000-0000-4000-8000-000000000099" },
      harness.Action with { DeviceId = "10000000-0000-4000-8000-000000000099" },
      harness.Action with { MandateId = "60000000-0000-4000-8000-000000000099" },
      harness.Action with { ActionTokenSha256 = new string('a', 64) },
      harness.Action with { InvocationSha256 = new string('b', 64) },
      harness.Action with { ExpectedImagePathSha256 = new string('c', 64) },
      harness.Action with { ExpectedImageSha256 = new string('d', 64) },
      harness.Action with { IsolationPolicySha256 = new string('e', 64) },
      harness.Action with { DriverMeasurementSha256 = new string('a', 64) },
      harness.Action with { ServiceMeasurementSha256 = new string('b', 64) },
    };

    foreach (var mutation in mutations)
    {
      var result = harness.Verifier.VerifyReservation(
        harness.Request with { Action = mutation },
        harness.SignedLease,
        harness.Action);
      Assert.Equal("isolation_reservation_request_binding_invalid", result.ErrorCode);
    }
  }

  [Fact]
  public void ExactSupervisorBootParentChildJobAndImageBindingsAreRequired()
  {
    using var harness = CreateHarness();
    var reservation = harness.VerifyReservation();
    var processMutations = new PrivilegedCommandIsolationProcessBinding[]
    {
      harness.Process with { ParentProcessId = 401 },
      harness.Process with { ParentProcessCreationTimeUtcFileTime = 101 },
      harness.Process with { ChildProcessId = 501 },
      harness.Process with { ChildProcessCreationTimeUtcFileTime = 201 },
      harness.Process with { PrimaryThreadId = 601 },
      harness.Process with { JobObjectId = "a0000000-0000-4000-8000-000000000099" },
      harness.Process with { JobObjectIdentitySha256 = new string('a', 64) },
      harness.Process with { ImagePathSha256 = new string('b', 64) },
      harness.Process with { ImageSha256 = new string('c', 64) },
    };

    foreach (var mutation in processMutations)
    {
      var result = harness.Verifier.VerifyBindAcknowledgement(
        reservation,
        harness.Binding with { Process = mutation },
        harness.SignedAcknowledgement);
      var imageChanged = !string.Equals(
          mutation.ImagePathSha256,
          harness.Action.ExpectedImagePathSha256,
          StringComparison.Ordinal)
        || !string.Equals(
          mutation.ImageSha256,
          harness.Action.ExpectedImageSha256,
          StringComparison.Ordinal);
      Assert.Equal(
        imageChanged
          ? "isolation_suspended_process_binding_mismatch"
          : "isolation_bind_acknowledgement_binding_invalid",
        result.ErrorCode);
    }

    Assert.Equal(
      "isolation_suspended_process_binding_mismatch",
      harness.Verifier.VerifyBindAcknowledgement(
        reservation,
        harness.Binding with
        {
          SupervisorInstanceId = "80000000-0000-4000-8000-000000000099",
        },
        harness.SignedAcknowledgement).ErrorCode);
    Assert.Equal(
      "isolation_suspended_process_binding_mismatch",
      harness.Verifier.VerifyBindAcknowledgement(
        reservation,
        harness.Binding with { BootId = "90000000-0000-4000-8000-000000000099" },
        harness.SignedAcknowledgement).ErrorCode);
  }

  [Fact]
  public void BindRequiresAStillSuspendedJobAssignedChildAndLiveKernelEnforcement()
  {
    using var harness = CreateHarness();
    var reservation = harness.VerifyReservation();

    Assert.Equal(
      "isolation_suspended_process_binding_invalid",
      harness.Verifier.VerifyBindAcknowledgement(
        reservation,
        harness.Binding with { CreatedSuspended = false },
        harness.SignedAcknowledgement).ErrorCode);
    Assert.Equal(
      "isolation_suspended_process_binding_invalid",
      harness.Verifier.VerifyBindAcknowledgement(
        reservation,
        harness.Binding with { AssignedToJob = false },
        harness.SignedAcknowledgement).ErrorCode);

    foreach (var acknowledgement in new[]
    {
      harness.Acknowledgement with { ChildStillSuspended = false },
      harness.Acknowledgement with { KernelEnforcementActive = false },
      harness.Acknowledgement with { MayResume = false },
    })
    {
      Assert.Equal(
        "isolation_bind_acknowledgement_invalid",
        harness.Verifier.VerifyBindAcknowledgement(
          reservation,
          harness.Binding,
          PrivilegedCommandIsolationCanonical.SignBindAcknowledgement(
            acknowledgement,
            TestHarness.BindKeyId,
            harness.BindKey)).ErrorCode);
    }
  }

  [Fact]
  public void BoundImageMustMatchTheImagePinnedBeforeReservation()
  {
    using var harness = CreateHarness();
    var reservation = harness.VerifyReservation();
    var process = harness.Process with { ImageSha256 = new string('a', 64) };
    var binding = harness.Binding with { Process = process };
    var acknowledgement = harness.Acknowledgement with
    {
      Process = process,
      SuspendedProcessBindingSha256 =
        PrivilegedCommandIsolationCanonical.SuspendedProcessBindingSha256(binding),
    };

    Assert.Equal(
      "isolation_suspended_process_binding_mismatch",
      harness.Verifier.VerifyBindAcknowledgement(
        reservation,
        binding,
        PrivilegedCommandIsolationCanonical.SignBindAcknowledgement(
          acknowledgement,
          TestHarness.BindKeyId,
          harness.BindKey)).ErrorCode);
  }

  [Fact]
  public void PurposeScopedP256KeysCannotBeSubstitutedAcrossStages()
  {
    using var harness = CreateHarness();
    var signedWithBindKey = PrivilegedCommandIsolationCanonical.SignReservationLease(
      harness.Lease,
      TestHarness.BindKeyId,
      harness.BindKey);

    Assert.Equal(
      "isolation_reservation_lease_key_untrusted",
      harness.Verifier.VerifyReservation(
        harness.Request,
        signedWithBindKey,
        harness.Action).ErrorCode);

    var crossDomainSignature = Convert.ToBase64String(harness.LeaseKey.SignData(
      PrivilegedCommandIsolationCanonical.BindAcknowledgementBytes(
        harness.Acknowledgement),
      HashAlgorithmName.SHA256,
      DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
    Assert.Equal(
      "isolation_reservation_lease_signature_invalid",
      harness.Verifier.VerifyReservation(
        harness.Request,
        harness.SignedLease with { SignatureBase64 = crossDomainSignature },
        harness.Action).ErrorCode);

    const string aliasKeyId = "isolation-reservation-alias-v1";
    var aliasResolver = new StaticPurposeKeyResolver(
    [
      (aliasKeyId,
        PrivilegedCommandIsolationSignaturePurposes.ReservationLease,
        harness.LeaseKey),
    ]);
    var aliasVerifier = new PrivilegedCommandIsolationContractVerifier(
      PrivilegedCommandIsolationVerificationSettings.Strict(
        DeviceId,
        PolicySha256,
        DriverSha256,
        ServiceSha256),
      aliasResolver,
      new FixedTimeProvider(
        DateTimeOffset.FromUnixTimeMilliseconds(NowUnixMilliseconds)));
    Assert.Equal(
      "isolation_reservation_lease_signature_invalid",
      aliasVerifier.VerifyReservation(
        harness.Request,
        harness.SignedLease with { KeyId = aliasKeyId },
        harness.Action).ErrorCode);
    Assert.Equal(
      "isolation_reservation_lease_signature_invalid",
      harness.Verifier.VerifyReservation(
        harness.Request,
        harness.SignedLease with { SignatureBase64 = null! },
        harness.Action).ErrorCode);
    Assert.Equal(
      "isolation_reservation_lease_signature_invalid",
      harness.Verifier.VerifyReservation(
        harness.Request,
        harness.SignedLease with { SignatureBase64 = new string('a', 10_000) },
        harness.Action).ErrorCode);

    using var p384 = ECDsa.Create(ECCurve.NamedCurves.nistP384);
    Assert.Throws<CryptographicException>(() =>
      PrivilegedCommandIsolationCanonical.SignReservationLease(
        harness.Lease,
        "p384-forbidden",
        p384));
  }

  [Fact]
  public void NonceFeaturesLifetimesAndSequencesAreBoundedAndCanonical()
  {
    using var harness = CreateHarness();
    Assert.Equal(
      "isolation_reservation_request_invalid",
      harness.Verifier.VerifyReservation(
        harness.Request with { RequestNonceBase64Url = "not-a-32-byte-nonce" },
        harness.SignedLease,
        harness.Action).ErrorCode);
    Assert.Equal(
      "isolation_reservation_request_invalid",
      harness.Verifier.VerifyReservation(
        harness.Request with
        {
          Action = harness.Action with
          {
            RequiredFeatures = harness.Action.RequiredFeatures.Reverse().ToArray(),
          },
        },
        harness.SignedLease,
        harness.Action).ErrorCode);

    var stale = harness.Request with
    {
      RequestedAtUnixMilliseconds = NowUnixMilliseconds - 120_000,
      RequestedExpiresAtUnixMilliseconds = NowUnixMilliseconds + 1_000,
    };
    Assert.Equal(
      "isolation_reservation_request_stale",
      harness.Verifier.VerifyReservation(stale, harness.SignedLease, harness.Action).ErrorCode);

    var excessiveSettings = PrivilegedCommandIsolationVerificationSettings.Strict(
      DeviceId,
      PolicySha256,
      DriverSha256,
      ServiceSha256) with
    {
      MaximumExecutionDuration = TimeSpan.FromHours(2) + TimeSpan.FromMilliseconds(1),
    };
    Assert.Throws<ArgumentOutOfRangeException>(() =>
      new PrivilegedCommandIsolationContractVerifier(
        excessiveSettings,
        harness.Resolver));

    var reservation = harness.VerifyReservation();
    var staleSequence = harness.Acknowledgement with { Sequence = harness.Lease.Sequence };
    Assert.Equal(
      "isolation_bind_acknowledgement_binding_invalid",
      harness.Verifier.VerifyBindAcknowledgement(
        reservation,
        harness.Binding,
        PrivilegedCommandIsolationCanonical.SignBindAcknowledgement(
          staleSequence,
          TestHarness.BindKeyId,
        harness.BindKey)).ErrorCode);
  }

  [Fact]
  public void LeaseBindAndReceiptFreshnessWindowsFailClosed()
  {
    using var harness = CreateHarness();
    var expiredLease = harness.Lease with
    {
      ExpiresAtUnixMilliseconds = NowUnixMilliseconds - 1,
    };
    Assert.Equal(
      "isolation_reservation_lease_stale",
      harness.Verifier.VerifyReservation(
        harness.Request,
        PrivilegedCommandIsolationCanonical.SignReservationLease(
          expiredLease,
          TestHarness.LeaseKeyId,
          harness.LeaseKey),
        harness.Action).ErrorCode);

    var reservation = harness.VerifyReservation();
    var overlongAcknowledgement = harness.Acknowledgement with
    {
      ExpiresAtUnixMilliseconds = NowUnixMilliseconds + 40_000,
    };
    Assert.Equal(
      "isolation_bind_acknowledgement_stale",
      harness.Verifier.VerifyBindAcknowledgement(
        reservation,
        harness.Binding,
        PrivilegedCommandIsolationCanonical.SignBindAcknowledgement(
          overlongAcknowledgement,
          TestHarness.BindKeyId,
          harness.BindKey)).ErrorCode);

    var bind = harness.VerifyBind(reservation);
    var futureReceipt = harness.SignedReceipt.Receipt with
    {
      IssuedAtUnixMilliseconds = NowUnixMilliseconds + 31_000,
    };
    Assert.Equal(
      "isolation_terminal_receipt_stale",
      harness.Verifier.VerifyTerminalReceipt(
        bind,
        PrivilegedCommandIsolationCanonical.SignTerminalReceipt(
          futureReceipt,
          TestHarness.ReceiptKeyId,
          harness.ReceiptKey)).ErrorCode);
  }

  [Fact]
  public void TerminalReceiptRequiresEveryPriorDigestAndTheSameSupervisorGeneration()
  {
    using var harness = CreateHarness();
    var reservation = harness.VerifyReservation();
    var bind = harness.VerifyBind(reservation);
    var mutations = new PrivilegedCommandIsolationTerminalReceiptV1[]
    {
      harness.SignedReceipt.Receipt with
      {
        ReservationRequestSha256 = new string('a', 64),
      },
      harness.SignedReceipt.Receipt with { RequestNonceSha256 = new string('b', 64) },
      harness.SignedReceipt.Receipt with { LeaseSha256 = new string('c', 64) },
      harness.SignedReceipt.Receipt with
      {
        SuspendedProcessBindingSha256 = new string('d', 64),
      },
      harness.SignedReceipt.Receipt with
      {
        BindAcknowledgementSha256 = new string('e', 64),
      },
      harness.SignedReceipt.Receipt with
      {
        SupervisorInstanceId = "80000000-0000-4000-8000-000000000099",
      },
      harness.SignedReceipt.Receipt with
      {
        BootId = "90000000-0000-4000-8000-000000000099",
      },
      harness.SignedReceipt.Receipt with { Sequence = harness.Acknowledgement.Sequence },
    };

    foreach (var mutation in mutations)
    {
      Assert.Equal(
        "isolation_terminal_receipt_binding_invalid",
        harness.Verifier.VerifyTerminalReceipt(
          bind,
          PrivilegedCommandIsolationCanonical.SignTerminalReceipt(
            mutation,
            TestHarness.ReceiptKeyId,
            harness.ReceiptKey)).ErrorCode);
    }
  }

  [Fact]
  public void AuthenticatedIsolationViolationIsEvidenceButNeverAnIntactExecution()
  {
    using var harness = CreateHarness();
    var reservation = harness.VerifyReservation();
    var bind = harness.VerifyBind(reservation);
    var violation = harness.SignedReceipt.Receipt with
    {
      EnforcementContinuous = false,
      ExitCodeKnown = false,
      ExitCode = 0,
      Outcome = PrivilegedCommandIsolationTerminalOutcomes.IsolationViolation,
    };

    var verified = harness.Verifier.VerifyTerminalReceipt(
      bind,
      PrivilegedCommandIsolationCanonical.SignTerminalReceipt(
        violation,
        TestHarness.ReceiptKeyId,
        harness.ReceiptKey));

    Assert.True(verified.IsValid, verified.ErrorCode);
    Assert.NotNull(verified.Value);
    Assert.False(verified.Value.IsIsolationIntact);

    var falseSuccess = violation with
    {
      ExitCodeKnown = true,
      EnforcementContinuous = false,
      Outcome = PrivilegedCommandIsolationTerminalOutcomes.Completed,
    };
    Assert.Equal(
      "isolation_terminal_receipt_invalid",
      harness.Verifier.VerifyTerminalReceipt(
        bind,
        PrivilegedCommandIsolationCanonical.SignTerminalReceipt(
          falseSuccess,
          TestHarness.ReceiptKeyId,
        harness.ReceiptKey)).ErrorCode);
  }

  [Theory]
  [InlineData("completed", true, true, 0, true)]
  [InlineData("failed", true, true, 1, true)]
  [InlineData("cancelled", false, false, 0, true)]
  [InlineData("crashed", true, false, 0, true)]
  [InlineData("timed-out", true, false, 0, true)]
  [InlineData("isolation-violation", false, false, 0, false)]
  [InlineData("unknown", false, false, 0, false)]
  public void EveryDeclaredTerminalOutcomeHasStrictVerifiableSemantics(
    string outcome,
    bool processResumed,
    bool exitCodeKnown,
    int exitCode,
    bool enforcementContinuous)
  {
    using var harness = CreateHarness();
    var reservation = harness.VerifyReservation();
    var bind = harness.VerifyBind(reservation);
    var receipt = harness.SignedReceipt.Receipt with
    {
      ProcessResumed = processResumed,
      ResumedAtUnixMilliseconds = processResumed ? NowUnixMilliseconds - 2_500 : 0,
      ExitCodeKnown = exitCodeKnown,
      ExitCode = exitCode,
      EnforcementContinuous = enforcementContinuous,
      Outcome = outcome,
    };

    var verified = harness.Verifier.VerifyTerminalReceipt(
      bind,
      PrivilegedCommandIsolationCanonical.SignTerminalReceipt(
        receipt,
        TestHarness.ReceiptKeyId,
        harness.ReceiptKey));

    Assert.True(verified.IsValid, verified.ErrorCode);
    Assert.NotNull(verified.Value);
    Assert.Equal(enforcementContinuous, verified.Value.IsIsolationIntact);
  }

  [Fact]
  public void VerifiedMarkersHaveNoPublicConstructors()
  {
    var markers = new[]
    {
      typeof(VerifiedPrivilegedCommandIsolationReservation),
      typeof(VerifiedPrivilegedCommandIsolationPreBindRelease),
      typeof(VerifiedPrivilegedCommandIsolationBindAcknowledgement),
      typeof(VerifiedPrivilegedCommandIsolationTerminalReceipt),
    };

    foreach (var marker in markers)
    {
      Assert.Empty(marker.GetConstructors(BindingFlags.Public | BindingFlags.Instance));
      Assert.NotEmpty(marker.GetConstructors(BindingFlags.NonPublic | BindingFlags.Instance));
    }
  }

  [Fact]
  public void VerifierSnapshotsMutableFeatureCollectionsBeforeReturningMarkers()
  {
    using var harness = CreateHarness();
    var mutableFeatures = harness.Action.RequiredFeatures.ToList();
    var action = harness.Action with { RequiredFeatures = mutableFeatures };
    var request = harness.Request with { Action = action };
    var lease = harness.Lease with
    {
      ReservationRequestSha256 =
        PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
      Action = action,
      EnforcedFeatures = mutableFeatures,
    };
    var verified = harness.Verifier.VerifyReservation(
      request,
      PrivilegedCommandIsolationCanonical.SignReservationLease(
        lease,
        TestHarness.LeaseKeyId,
        harness.LeaseKey),
      action);
    Assert.True(verified.IsValid, verified.ErrorCode);
    Assert.NotNull(verified.Value);

    mutableFeatures.Clear();

    Assert.Equal(
      PrivilegedCommandIsolationFeatures.Required,
      verified.Value.Request.Action.RequiredFeatures);
    Assert.Equal(
      PrivilegedCommandIsolationFeatures.Required,
      verified.Value.SignedLease.Lease.EnforcedFeatures);
  }

  [Fact]
  public void ReplayCommitResultAllowsOnlyCommittedOrExactIdempotentEvidence()
  {
    var evidence = new string('1', 64);
    Assert.True(new PrivilegedCommandIsolationReplayCommitResult(
      PrivilegedCommandIsolationReplayCommitStatus.Committed,
      evidence,
      ExistingEvidenceSha256: null).AllowsProgressFor(evidence));
    Assert.True(new PrivilegedCommandIsolationReplayCommitResult(
      PrivilegedCommandIsolationReplayCommitStatus.AlreadyCommitted,
      evidence,
      evidence).AllowsProgressFor(evidence));
    Assert.False(new PrivilegedCommandIsolationReplayCommitResult(
      PrivilegedCommandIsolationReplayCommitStatus.AlreadyCommitted,
      evidence,
      new string('2', 64)).AllowsProgressFor(evidence));
    Assert.False(new PrivilegedCommandIsolationReplayCommitResult(
      PrivilegedCommandIsolationReplayCommitStatus.Conflict,
      evidence,
      new string('2', 64)).AllowsProgressFor(evidence));
    Assert.False(new PrivilegedCommandIsolationReplayCommitResult(
      PrivilegedCommandIsolationReplayCommitStatus.StaleSequence,
      evidence,
      ExistingEvidenceSha256: null).AllowsProgressFor(evidence));
    Assert.False(new PrivilegedCommandIsolationReplayCommitResult(
      PrivilegedCommandIsolationReplayCommitStatus.Unavailable,
      evidence,
      ExistingEvidenceSha256: null).AllowsProgressFor(evidence));
  }

  [Fact]
  public async Task SignedRunnerTestGateUsesTheProductionVerifierForTheFullLifecycle()
  {
    using var gate = new RunnerPrivilegedCommandIsolationTestGate();
    var replay = new InMemoryPrivilegedCommandIsolationReplayStore();
    var runnerBinding = CreateRunnerBinding();
    var invocation = runnerBinding.EphemeralBinding!.Invocation;
    var session = await gate.TryReserveAsync(
      runnerBinding,
      CancellationToken.None);
    Assert.NotNull(session);
    await using var sessionScope = session;

    var reservationCommit = await replay.CommitReservationAsync(
      session.Reservation,
      CancellationToken.None);
    Assert.True(reservationCommit.AllowsProgressFor(session.Reservation.LeaseSha256));
    var duplicateReservation = await replay.CommitReservationAsync(
      session.Reservation,
      CancellationToken.None);
    Assert.Equal(
      PrivilegedCommandIsolationReplayCommitStatus.AlreadyCommitted,
      duplicateReservation.Status);
    Assert.True(duplicateReservation.AllowsProgressFor(session.Reservation.LeaseSha256));

    var process = new PrivilegedCommandSuspendedProcessObservation(
      ParentProcessId: 40,
      ParentProcessCreationTimeUtcFileTime: 100,
      ChildProcessId: 50,
      ChildProcessCreationTimeUtcFileTime: 200,
      PrimaryThreadId: 60,
      runnerBinding.ExpectedImagePathSha256,
      runnerBinding.ExpectedImageSha256,
      invocation.ExecutableVolumeSerialNumber,
      invocation.ExecutableFileId,
      invocation.CommandLineSha256,
      PrivilegedCommandIsolationCanonical.WorkingDirectorySha256(
        invocation.WorkingDirectory),
      invocation.EnvironmentBlockSha256,
      runnerBinding.InvocationSha256,
      CreatedSuspended: true,
      AssignedToJob: true);
    var bind = await session.TryBindSuspendedProcessAsync(
      process,
      CancellationToken.None);
    Assert.NotNull(bind);
    var bindCommit = await replay.CommitBindAcknowledgementAsync(
      bind,
      CancellationToken.None);
    Assert.True(bindCommit.AllowsProgressFor(bind.AcknowledgementSha256));

    var receipt = await session.TrySettleAsync(
      bind,
      new PrivilegedCommandTerminalObservation(
        ProcessResumed: true,
        ExitCodeKnown: true,
        ExitCode: 0,
        PrivilegedCommandIsolationTerminalOutcomes.Completed),
      CancellationToken.None);
    Assert.NotNull(receipt);
    Assert.True(receipt.IsIsolationIntact);
    var receiptCommit = await replay.CommitTerminalReceiptAsync(
      receipt,
      CancellationToken.None);
    Assert.True(receiptCommit.AllowsProgressFor(receipt.ReceiptSha256));

    Assert.Equal(["reserve", "bind", "terminal"], gate.Calls);
    Assert.Equal(["reservation", "reservation", "bind", "terminal"], replay.Calls);
  }

  [Fact]
  public async Task ReplayStoreAtomicallyExcludesPreBindReleaseAfterBind()
  {
    using var gate = new RunnerPrivilegedCommandIsolationTestGate();
    var replay = new InMemoryPrivilegedCommandIsolationReplayStore();
    var runnerBinding = CreateRunnerBinding();
    var invocation = runnerBinding.EphemeralBinding!.Invocation;
    var session = await gate.TryReserveAsync(
      runnerBinding,
      CancellationToken.None);
    Assert.NotNull(session);
    await using var sessionScope = session;
    Assert.Equal(
      PrivilegedCommandIsolationReplayCommitStatus.Committed,
      (await replay.CommitReservationAsync(
        session.Reservation,
        CancellationToken.None)).Status);

    var bind = await session.TryBindSuspendedProcessAsync(
      new PrivilegedCommandSuspendedProcessObservation(
        40,
        100,
        50,
        200,
        60,
        runnerBinding.ExpectedImagePathSha256,
        runnerBinding.ExpectedImageSha256,
        invocation.ExecutableVolumeSerialNumber,
        invocation.ExecutableFileId,
        invocation.CommandLineSha256,
        PrivilegedCommandIsolationCanonical.WorkingDirectorySha256(
          invocation.WorkingDirectory),
        invocation.EnvironmentBlockSha256,
        runnerBinding.InvocationSha256,
        CreatedSuspended: true,
        AssignedToJob: true),
      CancellationToken.None);
    Assert.NotNull(bind);
    Assert.Equal(
      PrivilegedCommandIsolationReplayCommitStatus.Committed,
      (await replay.CommitBindAcknowledgementAsync(bind, CancellationToken.None)).Status);

    var release = await session.TryReleaseBeforeBindAsync(
      PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeBind,
      CancellationToken.None);
    Assert.NotNull(release);
    var conflict = await replay.CommitPreBindReleaseAsync(
      release,
      CancellationToken.None);
    Assert.Equal(PrivilegedCommandIsolationReplayCommitStatus.Conflict, conflict.Status);
    Assert.False(conflict.AllowsProgressFor(release.ReleaseSha256));
  }

  [Fact]
  public async Task RunnerTestGateExposesDeterministicBlockNullAndSignatureTamperModes()
  {
    using var blocking = new RunnerPrivilegedCommandIsolationTestGate(
      new RunnerPrivilegedCommandIsolationTestBehavior(
        BlockAt: RunnerPrivilegedCommandIsolationStage.Reserve));
    var pending = blocking.TryReserveAsync(
      CreateRunnerBinding(),
      CancellationToken.None).AsTask();
    await blocking.WaitUntilBlockedAsync();
    Assert.False(pending.IsCompleted);
    blocking.Unblock();
    var session = await pending;
    Assert.NotNull(session);
    await session.DisposeAsync();

    using var nullGate = new RunnerPrivilegedCommandIsolationTestGate(
      new RunnerPrivilegedCommandIsolationTestBehavior(
        ReturnNullAt: RunnerPrivilegedCommandIsolationStage.Reserve));
    Assert.Null(await nullGate.TryReserveAsync(
      CreateRunnerBinding(),
      CancellationToken.None));

    using var tampered = new RunnerPrivilegedCommandIsolationTestGate(
      new RunnerPrivilegedCommandIsolationTestBehavior(
        Tamper: RunnerPrivilegedCommandIsolationTamperMode.ReservationSignature));
    Assert.Null(await tampered.TryReserveAsync(
      CreateRunnerBinding(),
      CancellationToken.None));
    Assert.Equal(
      "isolation_reservation_lease_signature_invalid",
      tampered.LastVerificationErrorCode);
  }

  [Fact]
  public void CanonicalReservationRequestVectorIsStable()
  {
    using var harness = CreateHarness();

    Assert.Equal(
      "3c8a76d58dfb56a7b0e059bc70e250c98bc53acb4f93018dd3f77748ca788967",
      PrivilegedCommandIsolationCanonical.ReservationRequestSha256(harness.Request));
  }

  private static TestHarness CreateHarness()
  {
    var leaseKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var releaseKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var bindKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var receiptKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var action = new PrivilegedCommandIsolationActionBinding(
      "20000000-0000-4000-8000-000000000002",
      "30000000-0000-4000-8000-000000000003",
      "40000000-0000-4000-8000-000000000004",
      "50000000-0000-4000-8000-000000000005",
      DeviceId,
      "60000000-0000-4000-8000-000000000006",
      new string('4', 64),
      new string('5', 64),
      new string('7', 64),
      new string('8', 64),
      PolicySha256,
      DriverSha256,
      ServiceSha256,
      PrivilegedCommandIsolationFeatures.Required,
      PrivilegedCommandIsolationTestContracts.Authorization());
    var nonce = Enumerable.Range(0, 32).Select(value => (byte)value).ToArray();
    var nonceBase64Url = Convert.ToBase64String(nonce)
      .TrimEnd('=')
      .Replace('+', '-')
      .Replace('/', '_');
    var request = new PrivilegedCommandIsolationReservationRequestV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      "70000000-0000-4000-8000-000000000007",
      nonceBase64Url,
      action,
      NowUnixMilliseconds - 10_000,
      NowUnixMilliseconds + 90_000);
    var lease = new PrivilegedCommandIsolationReservationLeaseV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      "71000000-0000-4000-8000-000000000007",
      Sequence: 10,
      PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
      PrivilegedCommandIsolationCanonical.RequestNonceSha256(request),
      action,
      "80000000-0000-4000-8000-000000000008",
      "90000000-0000-4000-8000-000000000009",
      PrivilegedCommandIsolationFeatures.Required,
      NowUnixMilliseconds - 5_000,
      NowUnixMilliseconds + 60_000);
    var signedLease = PrivilegedCommandIsolationCanonical.SignReservationLease(
      lease,
      TestHarness.LeaseKeyId,
      leaseKey);
    var release = new PrivilegedCommandIsolationPreBindReleaseV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      "72000000-0000-4000-8000-000000000007",
      Sequence: 11,
      PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
      PrivilegedCommandIsolationCanonical.RequestNonceSha256(request),
      PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(lease),
      action,
      lease.SupervisorInstanceId,
      lease.BootId,
      NowUnixMilliseconds - 1_000,
      PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeProcess);
    var signedRelease = PrivilegedCommandIsolationCanonical.SignPreBindRelease(
      release,
      TestHarness.ReleaseKeyId,
      releaseKey);
    var process = new PrivilegedCommandIsolationProcessBinding(
      ParentProcessId: 400,
      ParentProcessCreationTimeUtcFileTime: 100,
      ChildProcessId: 500,
      ChildProcessCreationTimeUtcFileTime: 200,
      PrimaryThreadId: 600,
      "a0000000-0000-4000-8000-00000000000a",
      new string('6', 64),
      new string('7', 64),
      new string('8', 64),
      42,
      43,
      new string('9', 64),
      new string('a', 64),
      new string('b', 64),
      new string('5', 64));
    var binding = new PrivilegedCommandSuspendedProcessBindingV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      "b0000000-0000-4000-8000-00000000000b",
      PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
      PrivilegedCommandIsolationCanonical.RequestNonceSha256(request),
      PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(lease),
      action,
      lease.SupervisorInstanceId,
      lease.BootId,
      process,
      CreatedSuspended: true,
      AssignedToJob: true,
      NowUnixMilliseconds - 4_000);
    var acknowledgement = new PrivilegedCommandIsolationBindAcknowledgementV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      "c0000000-0000-4000-8000-00000000000c",
      Sequence: 11,
      PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
      PrivilegedCommandIsolationCanonical.RequestNonceSha256(request),
      PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(lease),
      PrivilegedCommandIsolationCanonical.SuspendedProcessBindingSha256(binding),
      action,
      lease.SupervisorInstanceId,
      lease.BootId,
      process,
      PrivilegedCommandIsolationFeatures.Required,
      ChildStillSuspended: true,
      KernelEnforcementActive: true,
      MayResume: true,
      NowUnixMilliseconds - 3_000,
      NowUnixMilliseconds + 20_000);
    var signedAcknowledgement =
      PrivilegedCommandIsolationCanonical.SignBindAcknowledgement(
        acknowledgement,
        TestHarness.BindKeyId,
        bindKey);
    var receipt = new PrivilegedCommandIsolationTerminalReceiptV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      "d0000000-0000-4000-8000-00000000000d",
      Sequence: 12,
      PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
      PrivilegedCommandIsolationCanonical.RequestNonceSha256(request),
      PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(lease),
      PrivilegedCommandIsolationCanonical.SuspendedProcessBindingSha256(binding),
      PrivilegedCommandIsolationCanonical.BindAcknowledgementSha256(acknowledgement),
      action,
      lease.SupervisorInstanceId,
      lease.BootId,
      process,
      PrivilegedCommandIsolationFeatures.Required,
      ProcessResumed: true,
      NowUnixMilliseconds - 2_500,
      NowUnixMilliseconds - 1_000,
      NowUnixMilliseconds - 500,
      ProcessTreeTerminal: true,
      EnforcementContinuous: true,
      ExitCodeKnown: true,
      ExitCode: 0,
      new string('9', 64),
      PrivilegedCommandIsolationTerminalOutcomes.Completed);
    var signedReceipt = PrivilegedCommandIsolationCanonical.SignTerminalReceipt(
      receipt,
      TestHarness.ReceiptKeyId,
      receiptKey);
    var resolver = new StaticPurposeKeyResolver(
    [
      (TestHarness.LeaseKeyId,
        PrivilegedCommandIsolationSignaturePurposes.ReservationLease,
        leaseKey),
      (TestHarness.ReleaseKeyId,
        PrivilegedCommandIsolationSignaturePurposes.PreBindReservationRelease,
        releaseKey),
      (TestHarness.BindKeyId,
        PrivilegedCommandIsolationSignaturePurposes.SuspendedProcessBindAcknowledgement,
        bindKey),
      (TestHarness.ReceiptKeyId,
        PrivilegedCommandIsolationSignaturePurposes.TerminalEnforcementReceipt,
        receiptKey),
    ]);
    var verifier = new PrivilegedCommandIsolationContractVerifier(
      PrivilegedCommandIsolationVerificationSettings.Strict(
        DeviceId,
        PolicySha256,
        DriverSha256,
        ServiceSha256),
      resolver,
      new FixedTimeProvider(
        DateTimeOffset.FromUnixTimeMilliseconds(NowUnixMilliseconds)));
    return new TestHarness(
      leaseKey,
      releaseKey,
      bindKey,
      receiptKey,
      resolver,
      verifier,
      action,
      request,
      lease,
      signedLease,
      signedRelease,
      process,
      binding,
      acknowledgement,
      signedAcknowledgement,
      signedReceipt);
  }

  private static PrivilegedCommandIsolationRequestBinding CreateRunnerBinding()
  {
    const string actionId = "20000000-0000-4000-8000-000000000002";
    const string taskId = "30000000-0000-4000-8000-000000000003";
    const string planVersionId = "40000000-0000-4000-8000-000000000004";
    const string stepId = "50000000-0000-4000-8000-000000000005";
    const string mandateId = "60000000-0000-4000-8000-000000000006";
    const string compactToken = "runner.contract.compact-token";
    const string argumentsJson = "{\"test\":\"runner-contract\"}";
    var argumentsSha256 = PayloadDigest.Sha256Hex(argumentsJson);
    var authorization = PrivilegedCommandIsolationTestContracts.Authorization(
      argumentsSha256);
    var leaseExpiresAt = DateTimeOffset.FromUnixTimeMilliseconds(
      NowUnixMilliseconds + 120_000);
    var request = new ActionRequest(
      actionId,
      taskId,
      planVersionId,
      stepId,
      DeviceId,
      mandateId,
      authorization.CapabilityId,
      authorization.CapabilityVersion,
      argumentsJson,
      argumentsSha256,
      authorization.ExpectedPreStateSha256,
      authorization.InputProvenanceSha256,
      "test-isolation-action",
      authorization.DispatchCount,
      authorization.LeaseId,
      authorization.FencingToken,
      leaseExpiresAt,
      authorization.ExecutionMode);
    var claims = new ActionTokenClaims
    {
      Issuer = "itemba-msaidizi-broker",
      Audience = "itemba-windows-companion",
      Subject = "msaidizi-global",
      TokenId = "runner-contract-token",
      ActionId = actionId,
      TaskId = taskId,
      PlanVersionId = planVersionId,
      StepId = stepId,
      DeviceId = DeviceId,
      MandateId = mandateId,
      CapabilityId = request.CapabilityId,
      CapabilityVersion = request.CapabilityVersion,
      ArgumentsSha256 = argumentsSha256,
      ExpectedPreStateSha256 = request.ExpectedPreStateSha256,
      InputProvenanceSha256 = request.InputProvenanceSha256,
      IdempotencyKey = request.IdempotencyKey,
      LeaseId = request.LeaseId,
      FencingToken = request.FencingToken,
      LeaseExpiresAtUnixSeconds = leaseExpiresAt.ToUnixTimeSeconds(),
      DispatchCount = request.DispatchCount,
      ExecutionMode = request.ExecutionMode,
      Budgets = authorization.Budgets,
      IssuedAtUnixSeconds = DateTimeOffset.FromUnixTimeMilliseconds(
        NowUnixMilliseconds - 30_000).ToUnixTimeSeconds(),
      ExpiresAtUnixSeconds = DateTimeOffset.FromUnixTimeMilliseconds(
        NowUnixMilliseconds + 60_000).ToUnixTimeSeconds(),
    };
    var environment = new[]
    {
      new PrivilegedCommandIsolationEnvironmentVariableV2(
        "COMSPEC",
        @"C:\Windows\System32\test-host.exe"),
    };
    var draft = new PrivilegedCommandIsolationInvocationV2(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      "cmd",
      @"C:\Windows\System32\test-host.exe",
      new string('8', 64),
      42,
      43,
      ["/d", "/s", "/c", "echo test"],
      @"C:\Windows\System32",
      environment,
      30,
      1_024,
      30,
      1_024,
      16,
      536_870_912,
      string.Empty,
      string.Empty);
    var invocation = draft with
    {
      CommandLineSha256 = PayloadDigest.Sha256Hex(
        PrivilegedCommandIsolationCanonical.BuildCommandLine(draft)),
      EnvironmentBlockSha256 =
        PrivilegedCommandIsolationCanonical.EnvironmentBlockSha256(environment),
    };
    return new PrivilegedCommandIsolationRequestBinding(
      actionId,
      taskId,
      planVersionId,
      stepId,
      DeviceId,
      mandateId,
      PayloadDigest.Sha256Hex(compactToken),
      PrivilegedCommandIsolationCanonical.InvocationSha256(invocation),
      PayloadDigest.Sha256Hex(invocation.ExecutablePath),
      invocation.ExecutableImageSha256,
      new PrivilegedCommandIsolationEphemeralBinding(
        new EphemeralActionAuthorization(
          new SignedActionRequest(request, compactToken),
          claims),
        invocation));
  }

  private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
  {
    public override DateTimeOffset GetUtcNow() => now;
  }

  private sealed class StaticPurposeKeyResolver :
    IPrivilegedCommandIsolationVerificationKeyResolver
  {
    private readonly Dictionary<(string KeyId, string Purpose), ECParameters> _keys;

    public StaticPurposeKeyResolver(
      IEnumerable<(string KeyId, string Purpose, ECDsa Key)> keys)
    {
      _keys = keys.ToDictionary(
        item => (item.KeyId, item.Purpose),
        item => item.Key.ExportParameters(includePrivateParameters: false));
    }

    public List<string> RequestedPurposes { get; } = [];

    public bool TryResolve(string keyId, string signaturePurpose, out ECDsa? publicKey)
    {
      RequestedPurposes.Add(signaturePurpose);
      if (!_keys.TryGetValue((keyId, signaturePurpose), out var parameters))
      {
        publicKey = null;
        return false;
      }

      publicKey = ECDsa.Create(parameters);
      return true;
    }
  }

  private sealed record TestHarness(
    ECDsa LeaseKey,
    ECDsa ReleaseKey,
    ECDsa BindKey,
    ECDsa ReceiptKey,
    StaticPurposeKeyResolver Resolver,
    PrivilegedCommandIsolationContractVerifier Verifier,
    PrivilegedCommandIsolationActionBinding Action,
    PrivilegedCommandIsolationReservationRequestV1 Request,
    PrivilegedCommandIsolationReservationLeaseV1 Lease,
    SignedPrivilegedCommandIsolationReservationLease SignedLease,
    SignedPrivilegedCommandIsolationPreBindRelease SignedRelease,
    PrivilegedCommandIsolationProcessBinding Process,
    PrivilegedCommandSuspendedProcessBindingV1 Binding,
    PrivilegedCommandIsolationBindAcknowledgementV1 Acknowledgement,
    SignedPrivilegedCommandIsolationBindAcknowledgement SignedAcknowledgement,
    SignedPrivilegedCommandIsolationTerminalReceipt SignedReceipt) : IDisposable
  {
    public const string LeaseKeyId = "isolation-reservation-v1";
    public const string ReleaseKeyId = "isolation-release-v1";
    public const string BindKeyId = "isolation-bind-v1";
    public const string ReceiptKeyId = "isolation-terminal-v1";

    public VerifiedPrivilegedCommandIsolationReservation VerifyReservation()
    {
      var result = Verifier.VerifyReservation(Request, SignedLease, Action);
      Assert.True(result.IsValid, result.ErrorCode);
      return Assert.IsType<VerifiedPrivilegedCommandIsolationReservation>(result.Value);
    }

    public VerifiedPrivilegedCommandIsolationBindAcknowledgement VerifyBind(
      VerifiedPrivilegedCommandIsolationReservation reservation)
    {
      var result = Verifier.VerifyBindAcknowledgement(
        reservation,
        Binding,
        SignedAcknowledgement);
      Assert.True(result.IsValid, result.ErrorCode);
      return Assert.IsType<VerifiedPrivilegedCommandIsolationBindAcknowledgement>(
        result.Value);
    }

    public void Dispose()
    {
      LeaseKey.Dispose();
      ReleaseKey.Dispose();
      BindKey.Dispose();
      ReceiptKey.Dispose();
    }
  }
}
