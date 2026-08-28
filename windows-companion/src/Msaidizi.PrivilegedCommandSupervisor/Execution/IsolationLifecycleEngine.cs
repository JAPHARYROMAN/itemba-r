using System.Security.Cryptography;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Channel;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Configuration;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Enforcement;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Security;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.State;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Supervision;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Execution;

public sealed class IsolationSupervisorFatalException : Exception
{
  public IsolationSupervisorFatalException(string errorCode, Exception? inner = null)
    : base(errorCode, inner)
  {
    ErrorCode = errorCode;
  }

  public string ErrorCode { get; }
}

/// <summary>
/// Serializes the exact signed reservation -> release|bind -> terminal state
/// machine. Only the independent kernel enforcer may supply process/job facts;
/// the companion cannot self-assert an enforcement feature or terminal tree.
/// </summary>
public sealed class IsolationLifecycleEngine : IDisposable
{
  private static readonly JsonSerializerOptions FreezeOptions = new(
    JsonSerializerDefaults.Web)
  {
    MaxDepth = 64,
  };

  private readonly PrivilegedCommandSupervisorOptions _options;
  private readonly IIsolationEvidenceSigner _signer;
  private readonly IPrivilegedCommandKernelEnforcer _enforcer;
  private readonly IIsolationLifecycleStore _store;
  private readonly IBootIdentity _bootIdentity;
  private readonly IActionTokenVerifier _actionTokenVerifier;
  private readonly TimeProvider _timeProvider;
  private readonly SemaphoreSlim _gate = new(1, 1);
  private int _unsafe;
  private int _initialized;
  private int _disposed;

  public IsolationLifecycleEngine(
    PrivilegedCommandSupervisorOptions options,
    IIsolationEvidenceSigner signer,
    IPrivilegedCommandKernelEnforcer enforcer,
    IIsolationLifecycleStore store,
    IBootIdentity bootIdentity,
    IActionTokenVerifier actionTokenVerifier,
    TimeProvider? timeProvider = null)
  {
    ArgumentNullException.ThrowIfNull(options);
    ArgumentNullException.ThrowIfNull(signer);
    ArgumentNullException.ThrowIfNull(enforcer);
    ArgumentNullException.ThrowIfNull(store);
    ArgumentNullException.ThrowIfNull(bootIdentity);
    ArgumentNullException.ThrowIfNull(actionTokenVerifier);
    _options = options;
    _signer = signer;
    _enforcer = enforcer;
    _store = store;
    _bootIdentity = bootIdentity;
    _actionTokenVerifier = actionTokenVerifier;
    _timeProvider = timeProvider ?? TimeProvider.System;
  }

  public async ValueTask InitializeAndRecoverAsync(CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      if (Volatile.Read(ref _initialized) != 0)
      {
        return;
      }

      ThrowIfKillSwitchEngaged();

      await RequireAttestationAsync(cancellationToken).ConfigureAwait(false);

      foreach (var state in _store.Snapshot)
      {
        if (state.Phase == IsolationLifecyclePhase.Settled
          && state.SignedReceipt is not null
          && (!state.SignedReceipt.Receipt.EnforcementContinuous
            || string.Equals(
              state.SignedReceipt.Receipt.Outcome,
              PrivilegedCommandIsolationTerminalOutcomes.IsolationViolation,
              StringComparison.Ordinal)))
        {
          TripUnsafe("isolation_integrity_violation_requires_recovery");
        }
      }

      foreach (var state in _store.Snapshot
        .Where(value => value.Phase == IsolationLifecyclePhase.Bound)
        .OrderBy(value => value.Sequence))
      {
        await RecoverBindCoreAsync(state, cancellationToken).ConfigureAwait(false);
      }

      foreach (var state in _store.Snapshot
        .Where(value => value.Phase == IsolationLifecyclePhase.Reserved)
        .OrderBy(value => value.Sequence))
      {
        await ReleaseCoreAsync(
          state,
          RecoveryReleaseOutcome(state),
          cancellationToken).ConfigureAwait(false);
      }

      Interlocked.Exchange(ref _initialized, 1);
    }
    catch (IsolationSupervisorFatalException)
    {
      throw;
    }
    catch (Exception exception)
    {
      throw new IsolationSupervisorFatalException(
        "isolation_startup_reconciliation_failed",
        exception);
    }
    finally
    {
      _gate.Release();
    }
  }

  public void Dispose()
  {
    if (Interlocked.Exchange(ref _disposed, 1) == 0)
    {
      _gate.Dispose();
    }
  }

  public async ValueTask<SignedPrivilegedCommandIsolationReservationLease> ReserveAsync(
    PrivilegedCommandIsolationReservationRequestV1 request,
    string compactActionToken,
    ActionRequest actionRequest,
    PrivilegedCommandIsolationInvocationV2 invocation,
    CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureAvailable();
      var tokenVerification = await _actionTokenVerifier.VerifyAsync(
        compactActionToken,
        cancellationToken).ConfigureAwait(false);
      if (!tokenVerification.IsValid || tokenVerification.Claims is null)
      {
        throw new UnauthorizedAccessException("The action token is invalid.");
      }
      var claims = tokenVerification.Claims;
      var authorizationError = ActionRequestAuthorizer.Validate(
        actionRequest,
        claims,
        _timeProvider.GetUtcNow());
      if (authorizationError is not null)
      {
        throw new UnauthorizedAccessException(
          "The action request does not match its signed token.");
      }
      var snapshot = Freeze(request);
      ValidateReservationRequest(snapshot);
      ValidateExactAuthorization(
        snapshot,
        compactActionToken,
        Freeze(actionRequest),
        Freeze(claims),
        Freeze(invocation));
      var requestSha256 = PrivilegedCommandIsolationCanonical.ReservationRequestSha256(
        snapshot);
      var existing = _store.FindByRequestId(snapshot.RequestId);
      if (existing is not null)
      {
        if (!DigestEquals(
            requestSha256,
            PrivilegedCommandIsolationCanonical.ReservationRequestSha256(
              existing.Request)))
        {
          throw new InvalidOperationException(
            "An isolation request ID cannot identify different action facts.");
        }
        if (existing.SignedLease.Lease.ExpiresAtUnixMilliseconds <= Now())
        {
          throw new InvalidOperationException(
            "An expired isolation reservation lease cannot be replayed.");
        }
        return existing.SignedLease;
      }
      if (_store.FindByActionId(snapshot.Action.ActionId) is not null)
      {
        throw new InvalidOperationException(
          "An action can have only one isolation reservation request.");
      }

      await RequireAttestationAsync(cancellationToken).ConfigureAwait(false);

      var now = Now();
      long tokenExpiresAtUnixMilliseconds;
      long actionLeaseExpiresAtUnixMilliseconds;
      try
      {
        tokenExpiresAtUnixMilliseconds = checked(claims.ExpiresAtUnixSeconds * 1_000L);
        actionLeaseExpiresAtUnixMilliseconds = checked(
          claims.LeaseExpiresAtUnixSeconds * 1_000L);
      }
      catch (OverflowException exception)
      {
        throw new UnauthorizedAccessException(
          "The signed action lifetime cannot be represented safely.",
          exception);
      }
      var expiresAtUnixMilliseconds = Math.Min(
        Math.Min(
          snapshot.RequestedExpiresAtUnixMilliseconds,
          checked(now + Milliseconds(_options.ReservationLeaseLifetime))),
        Math.Min(tokenExpiresAtUnixMilliseconds, actionLeaseExpiresAtUnixMilliseconds));
      var lease = new PrivilegedCommandIsolationReservationLeaseV1(
        PrivilegedCommandIsolationCanonical.ContractVersion,
        NewGuid(),
        _store.NextSequence,
        requestSha256,
        PrivilegedCommandIsolationCanonical.RequestNonceSha256(snapshot),
        snapshot.Action,
        _options.SupervisorInstanceId,
        _bootIdentity.BootId,
        PrivilegedCommandIsolationFeatures.Required,
        now,
        expiresAtUnixMilliseconds);
      if (lease.ExpiresAtUnixMilliseconds <= lease.IssuedAtUnixMilliseconds)
      {
        throw new InvalidOperationException("The isolation request expired before lease issue.");
      }
      var signedLease = _signer.Sign(lease);
      await AppendFatalAsync(
        new IsolationLifecycleState(
          lease.Sequence,
          IsolationLifecyclePhase.Reserved,
          snapshot,
          signedLease,
          null,
          null,
          null,
          null,
          null,
          null),
        cancellationToken).ConfigureAwait(false);
      return signedLease;
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<SignedPrivilegedCommandIsolationPreBindRelease> ReleaseAsync(
    PrivilegedCommandIsolationReservationRequestV1 request,
    SignedPrivilegedCommandIsolationReservationLease signedLease,
    string outcome,
    CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureAvailable();
      var state = RequireExactReservation(request, signedLease);
      if (state.Phase == IsolationLifecyclePhase.Released)
      {
        return string.Equals(
          state.SignedRelease!.Release.Outcome,
          outcome,
          StringComparison.Ordinal)
          ? state.SignedRelease
          : throw new InvalidOperationException(
            "A reservation cannot be released with conflicting outcomes.");
      }
      return await ReleaseCoreAsync(state, outcome, cancellationToken)
        .ConfigureAwait(false);
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<BindResponsePayload> BindAsync(
    PrivilegedCommandIsolationReservationRequestV1 request,
    SignedPrivilegedCommandIsolationReservationLease signedLease,
    SuspendedProcessObservation observation,
    PrivilegedCommandIsolationInvocationV2 invocation,
    PipePeerIdentity peer,
    CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureAvailable();
      var state = RequireExactReservation(request, signedLease);
      ValidateObservation(state, observation, invocation, peer);
      if (state.Phase == IsolationLifecyclePhase.Bound)
      {
        if (!ObservationMatches(state.Binding!, observation))
        {
          throw new InvalidOperationException(
            "A reservation cannot bind two process identities.");
        }
        return new BindResponsePayload(state.Binding!, state.SignedAcknowledgement!);
      }
      if (state.Phase != IsolationLifecyclePhase.Reserved)
      {
        throw new InvalidOperationException("The isolation reservation is no longer bindable.");
      }
      if (state.SignedLease.Lease.ExpiresAtUnixMilliseconds <= Now())
      {
        throw new InvalidOperationException("The isolation reservation lease expired.");
      }

      await RequireAttestationAsync(cancellationToken).ConfigureAwait(false);

      KernelIsolationBinding enforcement;
      try
      {
        enforcement = await _enforcer.BindSuspendedProcessAsync(
          state.Request,
          Freeze(observation),
          Freeze(invocation),
          Freeze(peer),
          cancellationToken).ConfigureAwait(false);
        KernelIsolationValidation.RequireBinding(enforcement);
        ValidateKernelBinding(
          state,
          enforcement,
          invocation,
          observation);
      }
      catch (Exception exception) when (exception is not IsolationSupervisorFatalException)
      {
        // Once bind has been dispatched, every failed, refused, malformed, or
        // cancelled outcome is uncertain. Fence the service so disposal closes
        // the driver lease and kills any tree that may already have attached.
        Interlocked.Exchange(ref _unsafe, 1);
        throw new IsolationSupervisorFatalException(
          "kernel_isolation_bind_unavailable",
          exception);
      }

      var process = new PrivilegedCommandIsolationProcessBinding(
        observation.ParentProcessId,
        observation.ParentProcessCreationTimeUtcFileTime,
        observation.ChildProcessId,
        observation.ChildProcessCreationTimeUtcFileTime,
        observation.PrimaryThreadId,
        enforcement.JobObjectId,
        enforcement.JobObjectIdentitySha256,
        enforcement.ImagePathSha256,
        enforcement.ImageSha256,
        enforcement.ImageVolumeSerialNumber,
        enforcement.ImageFileId,
        enforcement.CommandLineSha256,
        enforcement.WorkingDirectorySha256,
        enforcement.EnvironmentBlockSha256,
        enforcement.InvocationSha256);
      var binding = new PrivilegedCommandSuspendedProcessBindingV1(
        PrivilegedCommandIsolationCanonical.ContractVersion,
        NewGuid(),
        PrivilegedCommandIsolationCanonical.ReservationRequestSha256(state.Request),
        PrivilegedCommandIsolationCanonical.RequestNonceSha256(state.Request),
        PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(
          state.SignedLease.Lease),
        state.Request.Action,
        state.SignedLease.Lease.SupervisorInstanceId,
        state.SignedLease.Lease.BootId,
        process,
        CreatedSuspended: true,
        AssignedToJob: true,
        ObservedAtUnixMilliseconds: Now());
      var issued = Now();
      var acknowledgement = new PrivilegedCommandIsolationBindAcknowledgementV1(
        PrivilegedCommandIsolationCanonical.ContractVersion,
        NewGuid(),
        _store.NextSequence,
        binding.ReservationRequestSha256,
        binding.RequestNonceSha256,
        binding.LeaseSha256,
        PrivilegedCommandIsolationCanonical.SuspendedProcessBindingSha256(binding),
        binding.Action,
        binding.SupervisorInstanceId,
        binding.BootId,
        binding.Process,
        enforcement.EnforcedFeatures,
        enforcement.ChildStillSuspended,
        enforcement.KernelEnforcementActive,
        MayResume: true,
        issued,
        Math.Min(
          state.SignedLease.Lease.ExpiresAtUnixMilliseconds,
          checked(issued + Milliseconds(_options.BindAcknowledgementLifetime))));
      if (acknowledgement.ExpiresAtUnixMilliseconds
        <= acknowledgement.IssuedAtUnixMilliseconds)
      {
        throw new IsolationSupervisorFatalException(
          "isolation_bind_lease_expired_after_kernel_attach");
      }

      var signedAcknowledgement = _signer.Sign(acknowledgement);
      await AppendFatalAsync(
        state with
        {
          Sequence = acknowledgement.Sequence,
          Phase = IsolationLifecyclePhase.Bound,
          Binding = binding,
          SignedAcknowledgement = signedAcknowledgement,
          EnforcementLeaseId = enforcement.EnforcementLeaseId,
          BindEnforcementEvidenceSha256 = enforcement.EnforcementEvidenceSha256,
        },
        cancellationToken).ConfigureAwait(false);
      return new BindResponsePayload(binding, signedAcknowledgement);
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<SignedPrivilegedCommandIsolationTerminalReceipt> SettleAsync(
    PrivilegedCommandIsolationReservationRequestV1 request,
    SignedPrivilegedCommandIsolationReservationLease signedLease,
    PrivilegedCommandSuspendedProcessBindingV1 binding,
    SignedPrivilegedCommandIsolationBindAcknowledgement signedAcknowledgement,
    TerminalObservation observation,
    CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureAvailable();
      var state = RequireExactBind(
        request,
        signedLease,
        binding,
        signedAcknowledgement);
      if (state.Phase == IsolationLifecyclePhase.Settled)
      {
        if (!TerminalMatches(state.SignedReceipt!.Receipt, observation))
        {
          throw new InvalidOperationException(
            "A process tree cannot settle with conflicting terminal facts.");
        }
        return state.SignedReceipt;
      }

      KernelIsolationTerminalEvidence evidence;
      try
      {
        evidence = await _enforcer.SettleAsync(
          state.EnforcementLeaseId!,
          state.Binding!,
          Freeze(observation),
          cancellationToken).ConfigureAwait(false);
      }
      catch (Exception exception) when (exception is not IsolationSupervisorFatalException)
      {
        Interlocked.Exchange(ref _unsafe, 1);
        throw new IsolationSupervisorFatalException(
          "kernel_isolation_terminal_settlement_unavailable",
          exception);
      }
      KernelIsolationValidation.RequireTerminal(evidence);
      if (!TerminalMatches(evidence, observation))
      {
        evidence = evidence with
        {
          EnforcementContinuous = false,
          Outcome = PrivilegedCommandIsolationTerminalOutcomes.IsolationViolation,
        };
      }
      return await CommitTerminalCoreAsync(
        state,
        evidence,
        historicalRecovery: false,
        cancellationToken)
        .ConfigureAwait(false);
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<SignedPrivilegedCommandIsolationPreBindRelease>
    RecoverReservationAsync(
      PrivilegedCommandIsolationPendingReservation pending,
      CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureInitializedForRecovery();
      var state = RequireExactReservation(pending.Request, pending.SignedLease);
      if (state.Phase != IsolationLifecyclePhase.Released)
      {
        throw new IsolationSupervisorFatalException(
          "isolation_pending_reservation_not_reconciled");
      }
      return state.SignedRelease!;
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<SignedPrivilegedCommandIsolationTerminalReceipt>
    RecoverBindAsync(
      PrivilegedCommandIsolationPendingBind pending,
      CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureInitializedForRecovery();
      var state = RequireExactBind(
        pending.Request,
        pending.SignedLease,
        pending.Binding,
        pending.SignedAcknowledgement);
      if (state.Phase != IsolationLifecyclePhase.Settled)
      {
        throw new IsolationSupervisorFatalException("isolation_pending_bind_not_reconciled");
      }
      return state.SignedReceipt!;
    }
    finally
    {
      _gate.Release();
    }
  }

  private async ValueTask<SignedPrivilegedCommandIsolationPreBindRelease>
    ReleaseCoreAsync(
      IsolationLifecycleState state,
      string outcome,
      CancellationToken cancellationToken)
  {
    if (state.Phase != IsolationLifecyclePhase.Reserved
      || !PrivilegedCommandIsolationPreBindReleaseOutcomes.All.Contains(outcome))
    {
      throw new InvalidOperationException("The reservation cannot be released.");
    }
    var now = Now();
    if (string.Equals(
        outcome,
        PrivilegedCommandIsolationPreBindReleaseOutcomes.ExpiredUnused,
        StringComparison.Ordinal)
      && now < state.SignedLease.Lease.ExpiresAtUnixMilliseconds)
    {
      throw new InvalidOperationException("An unexpired reservation is not expired-unused.");
    }
    var release = new PrivilegedCommandIsolationPreBindReleaseV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      NewGuid(),
      _store.NextSequence,
      PrivilegedCommandIsolationCanonical.ReservationRequestSha256(state.Request),
      PrivilegedCommandIsolationCanonical.RequestNonceSha256(state.Request),
      PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(
        state.SignedLease.Lease),
      state.Request.Action,
      state.SignedLease.Lease.SupervisorInstanceId,
      state.SignedLease.Lease.BootId,
      now,
      outcome);
    var signed = _signer.Sign(release);
    await AppendFatalAsync(
      state with
      {
        Sequence = release.Sequence,
        Phase = IsolationLifecyclePhase.Released,
        SignedRelease = signed,
      },
      cancellationToken).ConfigureAwait(false);
    return signed;
  }

  private async ValueTask RecoverBindCoreAsync(
    IsolationLifecycleState state,
    CancellationToken cancellationToken)
  {
    KernelIsolationTerminalEvidence evidence;
    try
    {
      evidence = await _enforcer.RecoverAndTerminateAsync(
        state.EnforcementLeaseId!,
        state.Binding!,
        cancellationToken).ConfigureAwait(false);
    }
    catch (Exception exception) when (exception is not IsolationSupervisorFatalException)
    {
      Interlocked.Exchange(ref _unsafe, 1);
      throw new IsolationSupervisorFatalException(
        "kernel_isolation_restart_settlement_unavailable",
        exception);
    }
    KernelIsolationValidation.RequireTerminal(evidence);
    await CommitTerminalCoreAsync(
      state,
      evidence,
      historicalRecovery: true,
      cancellationToken)
      .ConfigureAwait(false);
  }

  private async ValueTask<SignedPrivilegedCommandIsolationTerminalReceipt>
    CommitTerminalCoreAsync(
      IsolationLifecycleState state,
      KernelIsolationTerminalEvidence evidence,
      bool historicalRecovery,
      CancellationToken cancellationToken)
  {
    ValidateTerminalTimeline(state, evidence, historicalRecovery);
    var issued = Now();
    var acknowledgement = state.SignedAcknowledgement!.Acknowledgement;
    var receipt = new PrivilegedCommandIsolationTerminalReceiptV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      NewGuid(),
      _store.NextSequence,
      acknowledgement.ReservationRequestSha256,
      acknowledgement.RequestNonceSha256,
      acknowledgement.LeaseSha256,
      acknowledgement.SuspendedProcessBindingSha256,
      PrivilegedCommandIsolationCanonical.BindAcknowledgementSha256(acknowledgement),
      state.Request.Action,
      state.SignedLease.Lease.SupervisorInstanceId,
      state.SignedLease.Lease.BootId,
      acknowledgement.Process,
      acknowledgement.EnforcedFeatures,
      evidence.ProcessResumed,
      evidence.ResumedAtUnixMilliseconds,
      evidence.EndedAtUnixMilliseconds,
      issued,
      evidence.ProcessTreeTerminal,
      evidence.EnforcementContinuous,
      evidence.ExitCodeKnown,
      evidence.ExitCodeKnown ? evidence.ExitCode : 0,
      evidence.EnforcementEvidenceSha256,
      evidence.Outcome);
    var signed = _signer.Sign(receipt);
    await AppendFatalAsync(
      state with
      {
        Sequence = receipt.Sequence,
        Phase = IsolationLifecyclePhase.Settled,
        SignedReceipt = signed,
      },
      cancellationToken).ConfigureAwait(false);
    if (!receipt.EnforcementContinuous
      || string.Equals(
        receipt.Outcome,
        PrivilegedCommandIsolationTerminalOutcomes.IsolationViolation,
        StringComparison.Ordinal))
    {
      // Return the authenticated violation receipt for the companion to commit
      // before refusing every subsequent operation in this service instance.
      Interlocked.Exchange(ref _unsafe, 1);
    }
    return signed;
  }

  private IsolationLifecycleState RequireExactReservation(
    PrivilegedCommandIsolationReservationRequestV1 request,
    SignedPrivilegedCommandIsolationReservationLease signedLease)
  {
    ArgumentNullException.ThrowIfNull(request);
    ArgumentNullException.ThrowIfNull(signedLease);
    var state = _store.FindByRequestId(request.RequestId)
      ?? throw new InvalidOperationException("The isolation reservation is unknown.");
    if (!DigestEquals(
        PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
        PrivilegedCommandIsolationCanonical.ReservationRequestSha256(state.Request))
      || !SignedLeaseEquals(signedLease, state.SignedLease))
    {
      throw new InvalidOperationException("The isolation reservation evidence conflicts.");
    }
    return state;
  }

  private IsolationLifecycleState RequireExactBind(
    PrivilegedCommandIsolationReservationRequestV1 request,
    SignedPrivilegedCommandIsolationReservationLease signedLease,
    PrivilegedCommandSuspendedProcessBindingV1 binding,
    SignedPrivilegedCommandIsolationBindAcknowledgement signedAcknowledgement)
  {
    var state = RequireExactReservation(request, signedLease);
    if (state.Phase is not IsolationLifecyclePhase.Bound
        and not IsolationLifecyclePhase.Settled
      || state.Binding is null
      || state.SignedAcknowledgement is null
      || !DigestEquals(
        PrivilegedCommandIsolationCanonical.SuspendedProcessBindingSha256(binding),
        PrivilegedCommandIsolationCanonical.SuspendedProcessBindingSha256(state.Binding))
      || !SignedAcknowledgementEquals(
        signedAcknowledgement,
        state.SignedAcknowledgement))
    {
      throw new InvalidOperationException("The isolation bind evidence conflicts.");
    }
    return state;
  }

  private void ValidateExactAuthorization(
    PrivilegedCommandIsolationReservationRequestV1 reservation,
    string compactActionToken,
    ActionRequest actionRequest,
    ActionTokenClaims claims,
    PrivilegedCommandIsolationInvocationV2 invocation)
  {
    var action = reservation.Action;
    var authorization = action.Authorization;
    if (!DigestEquals(
        action.ActionTokenSha256,
        PayloadDigest.Sha256Hex(compactActionToken))
      || !string.Equals(action.ActionId, actionRequest.ActionId, StringComparison.Ordinal)
      || !string.Equals(action.TaskId, actionRequest.TaskId, StringComparison.Ordinal)
      || !string.Equals(
        action.PlanVersionId,
        actionRequest.PlanVersionId,
        StringComparison.Ordinal)
      || !string.Equals(action.StepId, actionRequest.StepId, StringComparison.Ordinal)
      || !string.Equals(action.DeviceId, actionRequest.DeviceId, StringComparison.Ordinal)
      || !string.Equals(action.MandateId, actionRequest.MandateId, StringComparison.Ordinal)
      || !string.Equals(
        authorization.CapabilityId,
        actionRequest.CapabilityId,
        StringComparison.Ordinal)
      || !string.Equals(
        authorization.CapabilityVersion,
        actionRequest.CapabilityVersion,
        StringComparison.Ordinal)
      || !DigestEquals(authorization.ArgumentsSha256, actionRequest.ArgumentsSha256)
      || !OptionalDigestEquals(
        authorization.ExpectedPreStateSha256,
        actionRequest.ExpectedPreStateSha256)
      || !OptionalDigestEquals(
        authorization.InputProvenanceSha256,
        actionRequest.InputProvenanceSha256)
      || !DigestEquals(
        authorization.IdempotencyKeySha256,
        PayloadDigest.Sha256Hex(actionRequest.IdempotencyKey))
      || !DigestEquals(
        authorization.IdempotencyKeySha256,
        PayloadDigest.Sha256Hex(claims.IdempotencyKey))
      || !string.Equals(authorization.LeaseId, actionRequest.LeaseId, StringComparison.Ordinal)
      || !string.Equals(
        authorization.FencingToken,
        actionRequest.FencingToken,
        StringComparison.Ordinal)
      || authorization.LeaseExpiresAtUnixSeconds
        != actionRequest.LeaseExpiresAt.ToUnixTimeSeconds()
      || authorization.DispatchCount != actionRequest.DispatchCount
      || !string.Equals(
        authorization.ExecutionMode,
        actionRequest.ExecutionMode,
        StringComparison.Ordinal)
      || authorization.Budgets != claims.Budgets
      || !PrivilegedCommandIsolationCanonical.IsValidInvocation(invocation)
      || !DigestEquals(
        action.InvocationSha256,
        PrivilegedCommandIsolationCanonical.InvocationSha256(invocation))
      || !DigestEquals(
        action.ExpectedImagePathSha256,
        PayloadDigest.Sha256Hex(invocation.ExecutablePath))
      || !DigestEquals(action.ExpectedImageSha256, invocation.ExecutableImageSha256)
      || invocation.EffectiveTimeoutSeconds != Math.Min(
        invocation.RequestedTimeoutSeconds,
        checked((int)Math.Min(
          claims.Budgets.MaxWallTimeSeconds,
          _options.MaximumInvocationTimeoutSeconds)))
      || invocation.EffectiveMaximumOutputBytes != Math.Min(
        invocation.RequestedMaximumOutputBytes,
        Math.Min(
          claims.Budgets.MaxLocalBytes,
          _options.MaximumInvocationOutputBytes))
      || invocation.MaximumProcesses != _options.MaximumInvocationProcesses
      || invocation.MaximumProcessMemoryBytes
        != _options.MaximumInvocationProcessMemoryBytes
      || !InvocationMatchesSignedArguments(actionRequest, invocation)
      || !InvocationMatchesFixedWindowsPolicy(invocation))
    {
      throw new UnauthorizedAccessException(
        "The signed action does not exactly authorize the privileged invocation.");
    }
  }

  private static bool InvocationMatchesSignedArguments(
    ActionRequest request,
    PrivilegedCommandIsolationInvocationV2 invocation)
  {
    try
    {
      using var document = JsonDocument.Parse(request.ArgumentsJsonUtf8);
      var root = document.RootElement;
      if (root.ValueKind != JsonValueKind.Object)
      {
        return false;
      }
      string[] expected =
      [
        "executable",
        "argv",
        "timeoutSeconds",
        "maximumOutputBytes",
      ];
      var names = root.EnumerateObject().Select(property => property.Name).ToArray();
      if (names.Length != expected.Length
        || names.Distinct(StringComparer.Ordinal).Count() != expected.Length
        || expected.Any(name => !names.Contains(name, StringComparer.Ordinal))
        || !root.TryGetProperty("executable", out var executable)
        || executable.ValueKind != JsonValueKind.String
        || !root.TryGetProperty("argv", out var arguments)
        || arguments.ValueKind != JsonValueKind.Array
        || !root.TryGetProperty("timeoutSeconds", out var timeout)
        || !timeout.TryGetInt32(out var timeoutSeconds)
        || !root.TryGetProperty("maximumOutputBytes", out var output)
        || !output.TryGetInt64(out var maximumOutputBytes))
      {
        return false;
      }

      var argumentValues = new List<string>();
      foreach (var argument in arguments.EnumerateArray())
      {
        if (argument.ValueKind != JsonValueKind.String)
        {
          return false;
        }
        argumentValues.Add(argument.GetString()!);
      }
      return string.Equals(
          executable.GetString(),
          invocation.ExecutableId,
          StringComparison.Ordinal)
        && argumentValues.SequenceEqual(invocation.Arguments, StringComparer.Ordinal)
        && timeoutSeconds == invocation.RequestedTimeoutSeconds
        && maximumOutputBytes == invocation.RequestedMaximumOutputBytes;
    }
    catch (JsonException)
    {
      return false;
    }
  }

  private static bool InvocationMatchesFixedWindowsPolicy(
    PrivilegedCommandIsolationInvocationV2 invocation)
  {
    if (!OperatingSystem.IsWindows())
    {
      return false;
    }
    var windows = Path.TrimEndingDirectorySeparator(Path.GetFullPath(
      Environment.GetFolderPath(Environment.SpecialFolder.Windows)));
    var system32 = Path.TrimEndingDirectorySeparator(Path.GetFullPath(
      Environment.SystemDirectory));
    var expectedPath = invocation.ExecutableId switch
    {
      "cmd" => Path.Combine(system32, "cmd.exe"),
      "windows-powershell" => Path.Combine(
        system32,
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe"),
      _ => string.Empty,
    };
    if (!string.Equals(
        invocation.ExecutablePath,
        expectedPath,
        StringComparison.OrdinalIgnoreCase)
      || !string.Equals(
        invocation.WorkingDirectory,
        system32,
        StringComparison.OrdinalIgnoreCase))
    {
      return false;
    }

    var powershell = Path.Combine(system32, "WindowsPowerShell", "v1.0");
    var systemDrive = Path.GetPathRoot(windows);
    if (string.IsNullOrWhiteSpace(systemDrive))
    {
      return false;
    }
    var expectedEnvironment = new Dictionary<string, string>(
      StringComparer.OrdinalIgnoreCase)
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
      ["SystemDrive"] = Path.TrimEndingDirectorySeparator(systemDrive),
      ["SystemRoot"] = windows,
      ["WINDIR"] = windows,
    };
    return invocation.Environment.Count == expectedEnvironment.Count
      && invocation.Environment.All(variable =>
        expectedEnvironment.TryGetValue(variable.Name, out var value)
        && string.Equals(variable.Value, value, StringComparison.Ordinal));
  }

  private void ValidateReservationRequest(
    PrivilegedCommandIsolationReservationRequestV1 request)
  {
    var now = Now();
    var action = request.Action;
    var nonceValid = false;
    try
    {
      nonceValid = CanonicalSha256(
        PrivilegedCommandIsolationCanonical.RequestNonceSha256(request));
    }
    catch (FormatException)
    {
      // Rejected below without reflecting raw nonce data.
    }
    if (!PrivilegedCommandIsolationCanonical.IsValidReservationRequest(request)
      || request.ContractVersion != PrivilegedCommandIsolationCanonical.ContractVersion
      || !CanonicalGuid(request.RequestId)
      || !nonceValid
      || action is null
      || !CanonicalGuid(action.ActionId)
      || !CanonicalGuid(action.TaskId)
      || !CanonicalGuid(action.PlanVersionId)
      || !CanonicalGuid(action.StepId)
      || !CanonicalGuid(action.DeviceId)
      || !CanonicalGuid(action.MandateId)
      || !string.Equals(action.DeviceId, _options.DeviceId, StringComparison.Ordinal)
      || !CanonicalSha256(action.ActionTokenSha256)
      || !CanonicalSha256(action.InvocationSha256)
      || !CanonicalSha256(action.ExpectedImagePathSha256)
      || !CanonicalSha256(action.ExpectedImageSha256)
      || action.Authorization is null
      || !string.Equals(
        action.Authorization.CapabilityId,
        PrivilegedCommandIsolationCapability.Id,
        StringComparison.Ordinal)
      || !string.Equals(
        action.Authorization.CapabilityVersion,
        PrivilegedCommandIsolationCapability.Version,
        StringComparison.Ordinal)
      || !CanonicalSha256(action.Authorization.ArgumentsSha256)
      || !CanonicalSha256(action.Authorization.IdempotencyKeySha256)
      || action.Authorization.LeaseExpiresAtUnixSeconds <= 0
      || action.Authorization.DispatchCount <= 0
      || !string.Equals(
        action.Authorization.ExecutionMode,
        ActionExecutionModes.Execute,
        StringComparison.Ordinal)
      || action.Authorization.Budgets is null
      || !DigestEquals(action.IsolationPolicySha256, _options.IsolationPolicySha256)
      || !DigestEquals(action.DriverMeasurementSha256, _options.DriverMeasurementSha256)
      || !DigestEquals(
        action.ServiceMeasurementSha256,
        _options.ExpectedSupervisorImageSha256)
      || action.RequiredFeatures is null
      || !action.RequiredFeatures.SequenceEqual(
        PrivilegedCommandIsolationFeatures.Required,
        StringComparer.Ordinal)
      || request.RequestedAtUnixMilliseconds > checked(now + 30_000)
      || request.RequestedAtUnixMilliseconds < checked(now - 300_000)
      || request.RequestedExpiresAtUnixMilliseconds <= now
      || request.RequestedExpiresAtUnixMilliseconds
        > checked(request.RequestedAtUnixMilliseconds + 120_000))
    {
      throw new UnauthorizedAccessException(
        "The privileged-command isolation request is invalid or outside deployment pins.");
    }
  }

  private static void ValidateObservation(
    IsolationLifecycleState state,
    SuspendedProcessObservation observation,
    PrivilegedCommandIsolationInvocationV2 invocation,
    PipePeerIdentity peer)
  {
    ArgumentNullException.ThrowIfNull(observation);
    ArgumentNullException.ThrowIfNull(peer);
    if (!observation.CreatedSuspended
      || !observation.AssignedToJob
      || observation.ParentProcessId != peer.ProcessId
      || observation.ParentProcessCreationTimeUtcFileTime
        != peer.ProcessCreationTimeUtcFileTime
      || observation.ChildProcessId <= 0
      || observation.ChildProcessId == observation.ParentProcessId
      || observation.ChildProcessCreationTimeUtcFileTime
        < observation.ParentProcessCreationTimeUtcFileTime
      || observation.PrimaryThreadId <= 0
      || !PrivilegedCommandIsolationCanonical.IsValidInvocation(invocation)
      || !DigestEquals(
        PrivilegedCommandIsolationCanonical.InvocationSha256(invocation),
        state.Request.Action.InvocationSha256)
      || !DigestEquals(
        observation.ImagePathSha256,
        state.Request.Action.ExpectedImagePathSha256)
      || !DigestEquals(
        observation.ImageSha256,
        state.Request.Action.ExpectedImageSha256)
      || observation.ImageVolumeSerialNumber != invocation.ExecutableVolumeSerialNumber
      || observation.ImageFileId != invocation.ExecutableFileId
      || !DigestEquals(observation.CommandLineSha256, invocation.CommandLineSha256)
      || !DigestEquals(
        observation.WorkingDirectorySha256,
        PrivilegedCommandIsolationCanonical.WorkingDirectorySha256(
          invocation.WorkingDirectory))
      || !DigestEquals(
        observation.EnvironmentBlockSha256,
        invocation.EnvironmentBlockSha256)
      || !DigestEquals(observation.InvocationSha256, state.Request.Action.InvocationSha256))
    {
      throw new UnauthorizedAccessException(
        "The suspended process observation is not bound to the authenticated companion peer.");
    }
  }

  private void ValidateTerminalTimeline(
    IsolationLifecycleState state,
    KernelIsolationTerminalEvidence evidence,
    bool historicalRecovery)
  {
    var acknowledgement = state.SignedAcknowledgement!.Acknowledgement;
    var anchor = evidence.ProcessResumed
      ? evidence.ResumedAtUnixMilliseconds
      : acknowledgement.IssuedAtUnixMilliseconds;
    var now = Now();
    if (evidence.EndedAtUnixMilliseconds < anchor
      || evidence.EndedAtUnixMilliseconds > now
      || evidence.EndedAtUnixMilliseconds - anchor
        > Milliseconds(_options.MaximumExecutionDuration)
      || (evidence.ProcessResumed
        && (evidence.ResumedAtUnixMilliseconds
            < acknowledgement.IssuedAtUnixMilliseconds
          || evidence.ResumedAtUnixMilliseconds
            >= acknowledgement.ExpiresAtUnixMilliseconds))
      || (!historicalRecovery
        && now - evidence.EndedAtUnixMilliseconds
          > Milliseconds(_options.MaximumReceiptDelay))
      || !TerminalOutcomeShape(evidence))
    {
      throw new IsolationSupervisorFatalException(
        "kernel_isolation_terminal_timeline_invalid");
    }
  }

  private static void ValidateKernelBinding(
    IsolationLifecycleState state,
    KernelIsolationBinding binding,
    PrivilegedCommandIsolationInvocationV2 invocation,
    SuspendedProcessObservation observation)
  {
    var action = state.Request.Action;
    if (!DigestEquals(binding.ImagePathSha256, action.ExpectedImagePathSha256)
      || !DigestEquals(binding.ImageSha256, action.ExpectedImageSha256)
      || binding.ImageVolumeSerialNumber != invocation.ExecutableVolumeSerialNumber
      || binding.ImageFileId != invocation.ExecutableFileId
      || binding.ImageVolumeSerialNumber != observation.ImageVolumeSerialNumber
      || binding.ImageFileId != observation.ImageFileId
      || !DigestEquals(binding.CommandLineSha256, invocation.CommandLineSha256)
      || !DigestEquals(
        binding.WorkingDirectorySha256,
        PrivilegedCommandIsolationCanonical.WorkingDirectorySha256(
          invocation.WorkingDirectory))
      || !DigestEquals(
        binding.EnvironmentBlockSha256,
        invocation.EnvironmentBlockSha256)
      || !DigestEquals(
        binding.InvocationSha256,
        PrivilegedCommandIsolationCanonical.InvocationSha256(invocation)))
    {
      throw new UnauthorizedAccessException(
        "The driver did not independently measure the exact still-suspended invocation.");
    }
  }

  private static bool TerminalOutcomeShape(KernelIsolationTerminalEvidence evidence) =>
    evidence.Outcome switch
    {
      PrivilegedCommandIsolationTerminalOutcomes.Completed =>
        evidence.ProcessResumed
        && evidence.EnforcementContinuous
        && evidence.ExitCodeKnown
        && evidence.ExitCode == 0,
      PrivilegedCommandIsolationTerminalOutcomes.Failed =>
        evidence.EnforcementContinuous
        && evidence.ExitCodeKnown
        && evidence.ExitCode != 0,
      PrivilegedCommandIsolationTerminalOutcomes.Crashed or
      PrivilegedCommandIsolationTerminalOutcomes.TimedOut => evidence.ProcessResumed,
      PrivilegedCommandIsolationTerminalOutcomes.IsolationViolation =>
        !evidence.EnforcementContinuous,
      _ => true,
    };

  private async ValueTask AppendFatalAsync(
    IsolationLifecycleState state,
    CancellationToken cancellationToken)
  {
    try
    {
      await _store.AppendAsync(state, cancellationToken).ConfigureAwait(false);
    }
    catch (Exception exception) when (exception is not IsolationSupervisorFatalException)
    {
      Interlocked.Exchange(ref _unsafe, 1);
      throw new IsolationSupervisorFatalException(
        "isolation_durable_commit_failed",
        exception);
    }
  }

  private async ValueTask RequireAttestationAsync(CancellationToken cancellationToken)
  {
    try
    {
      var attestation = await _enforcer.AttestAsync(cancellationToken)
        .ConfigureAwait(false);
      KernelIsolationValidation.RequireExactAttestation(
        attestation,
        _options.DeviceId,
        _bootIdentity.BootId,
        _options.SupervisorInstanceId,
        _options.DriverPolicyEpoch,
        _options.DriverServiceName,
        _options.IsolationPolicySha256,
        _options.DriverMeasurementSha256,
        _options.ExpectedSupervisorImageSha256);
    }
    catch (Exception exception) when (exception is not IsolationSupervisorFatalException)
    {
      Interlocked.Exchange(ref _unsafe, 1);
      throw new IsolationSupervisorFatalException(
        "kernel_isolation_attestation_failed",
        exception);
    }
  }

  private string RecoveryReleaseOutcome(IsolationLifecycleState state) =>
    Now() >= state.SignedLease.Lease.ExpiresAtUnixMilliseconds
      ? PrivilegedCommandIsolationPreBindReleaseOutcomes.ExpiredUnused
      : PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeBind;

  private void EnsureAvailable()
  {
    ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
    ThrowIfKillSwitchEngaged();
    if (Volatile.Read(ref _initialized) == 0)
    {
      throw new IsolationSupervisorFatalException("isolation_supervisor_not_initialized");
    }
    if (Volatile.Read(ref _unsafe) != 0)
    {
      throw new IsolationSupervisorFatalException(
        "isolation_integrity_violation_requires_recovery");
    }
  }

  private void EnsureInitializedForRecovery()
  {
    ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
    if (Volatile.Read(ref _initialized) == 0)
    {
      throw new IsolationSupervisorFatalException("isolation_supervisor_not_initialized");
    }
  }

  private void TripUnsafe(string errorCode)
  {
    Interlocked.Exchange(ref _unsafe, 1);
    throw new IsolationSupervisorFatalException(errorCode);
  }

  private void ThrowIfKillSwitchEngaged()
  {
    if (TrustedKillSwitch.IsEngaged(_options.KillSwitchPath))
    {
      TripUnsafe("trusted_root_kill_switch_engaged");
    }
  }

  private static bool ObservationMatches(
    PrivilegedCommandSuspendedProcessBindingV1 binding,
    SuspendedProcessObservation observation) =>
    binding.Process.ParentProcessId == observation.ParentProcessId
    && binding.Process.ParentProcessCreationTimeUtcFileTime
      == observation.ParentProcessCreationTimeUtcFileTime
    && binding.Process.ChildProcessId == observation.ChildProcessId
    && binding.Process.ChildProcessCreationTimeUtcFileTime
      == observation.ChildProcessCreationTimeUtcFileTime
    && binding.Process.PrimaryThreadId == observation.PrimaryThreadId
    && DigestEquals(binding.Process.ImagePathSha256, observation.ImagePathSha256)
    && DigestEquals(binding.Process.ImageSha256, observation.ImageSha256)
    && binding.Process.ImageVolumeSerialNumber == observation.ImageVolumeSerialNumber
    && binding.Process.ImageFileId == observation.ImageFileId
    && DigestEquals(binding.Process.CommandLineSha256, observation.CommandLineSha256)
    && DigestEquals(
      binding.Process.WorkingDirectorySha256,
      observation.WorkingDirectorySha256)
    && DigestEquals(
      binding.Process.EnvironmentBlockSha256,
      observation.EnvironmentBlockSha256)
    && DigestEquals(binding.Process.InvocationSha256, observation.InvocationSha256);

  private static bool TerminalMatches(
    KernelIsolationTerminalEvidence evidence,
    TerminalObservation observation) =>
    evidence.ProcessResumed == observation.ProcessResumed
    && evidence.ExitCodeKnown == observation.ExitCodeKnown
    && (!evidence.ExitCodeKnown || evidence.ExitCode == observation.ExitCode)
    && string.Equals(evidence.Outcome, observation.Outcome, StringComparison.Ordinal);

  private static bool TerminalMatches(
    PrivilegedCommandIsolationTerminalReceiptV1 receipt,
    TerminalObservation observation) =>
    receipt.ProcessResumed == observation.ProcessResumed
    && receipt.ExitCodeKnown == observation.ExitCodeKnown
    && (!receipt.ExitCodeKnown || receipt.ExitCode == observation.ExitCode)
    && string.Equals(receipt.Outcome, observation.Outcome, StringComparison.Ordinal);

  private static bool SignedLeaseEquals(
    SignedPrivilegedCommandIsolationReservationLease left,
    SignedPrivilegedCommandIsolationReservationLease right) =>
    string.Equals(left.KeyId, right.KeyId, StringComparison.Ordinal)
    && string.Equals(left.SignatureBase64, right.SignatureBase64, StringComparison.Ordinal)
    && DigestEquals(
      PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(left.Lease),
      PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(right.Lease));

  private static bool SignedAcknowledgementEquals(
    SignedPrivilegedCommandIsolationBindAcknowledgement left,
    SignedPrivilegedCommandIsolationBindAcknowledgement right) =>
    string.Equals(left.KeyId, right.KeyId, StringComparison.Ordinal)
    && string.Equals(left.SignatureBase64, right.SignatureBase64, StringComparison.Ordinal)
    && DigestEquals(
      PrivilegedCommandIsolationCanonical.BindAcknowledgementSha256(
        left.Acknowledgement),
      PrivilegedCommandIsolationCanonical.BindAcknowledgementSha256(
        right.Acknowledgement));

  private static T Freeze<T>(T value) =>
    JsonSerializer.Deserialize<T>(
      JsonSerializer.SerializeToUtf8Bytes(value, FreezeOptions),
      FreezeOptions) ?? throw new InvalidDataException(
        "The isolation protocol value cannot be snapshotted.");

  private static bool CanonicalGuid(string? value) =>
    value is not null
    && Guid.TryParseExact(value, "D", out var parsed)
    && parsed != Guid.Empty
    && string.Equals(parsed.ToString("D"), value, StringComparison.Ordinal);

  private static bool CanonicalSha256(string? value) =>
    value is not null
    && PayloadDigest.IsSha256Hex(value)
    && string.Equals(value, value.ToLowerInvariant(), StringComparison.Ordinal);

  private static bool DigestEquals(string left, string right) =>
    CanonicalSha256(left)
    && CanonicalSha256(right)
    && PayloadDigest.FixedTimeEqualsHex(left, right);

  private static bool OptionalDigestEquals(string? left, string? right) =>
    left is null || right is null
      ? left is null && right is null
      : DigestEquals(left, right);

  private long Now() => _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();

  private static long Milliseconds(TimeSpan value) => checked((long)value.TotalMilliseconds);

  private static string NewGuid() => Guid.NewGuid().ToString("D");
}
