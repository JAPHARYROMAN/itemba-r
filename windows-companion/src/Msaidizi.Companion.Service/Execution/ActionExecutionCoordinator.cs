using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Channel;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Journal;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Channel;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Execution;

public sealed class ActionExecutionCoordinator : IDisposable
{
  private static readonly TimeSpan LeaseSettlementGrace = TimeSpan.FromSeconds(15);
  private static readonly Action<ILogger, string, string, string, Exception?> LogCapabilityFailure =
    LoggerMessage.Define<string, string, string>(
      LogLevel.Error,
      new EventId(1200, nameof(LogCapabilityFailure)),
      "Capability {CapabilityId} failed for action {ActionId} with {ExceptionType}.");

  private static readonly Action<ILogger, string, string, Exception?> LogProgressSendFailure =
    LoggerMessage.Define<string, string>(
      LogLevel.Warning,
      new EventId(1201, nameof(LogProgressSendFailure)),
      "Could not send progress for action {ActionId}; transport raised {ExceptionType}.");

  private static readonly Action<ILogger, string, string, Exception?> LogResultSendFailure =
    LoggerMessage.Define<string, string>(
      LogLevel.Warning,
      new EventId(1202, nameof(LogResultSendFailure)),
      "Could not send result for action {ActionId}; transport raised {ExceptionType}.");

  private readonly CompanionOptions _options;
  private readonly BrokerChannelOptions _brokerOptions;
  private readonly IActionTokenVerifier _tokenVerifier;
  private readonly IFenceTokenVerifier _fenceTokenVerifier;
  private readonly IActionJournal _journal;
  private readonly IActionResultStore _resultStore;
  private readonly CapabilityRegistry _capabilities;
  private readonly ITrustedRootGuard _trustedRoot;
  private readonly IEgressBoundaryClient _egressBoundary;
  private readonly ILocalSystemEgressEvidenceVerifier _egressEvidence;
  private readonly EgressBoundaryDispatchLatch _egressDispatchLatch;
  private readonly PrivilegedCommandIsolationDispatchLatch _isolationDispatchLatch;
  private readonly IOutboundCompanionChannel _channel;
  private readonly ILogger<ActionExecutionCoordinator> _logger;
  private readonly TimeSpan _leaseHeartbeatInterval;
  private readonly SemaphoreSlim _concurrencyGate;
  private readonly SemaphoreSlim _journalActionGate = new(1, 1);
  private readonly ConcurrentDictionary<string, RunningAction> _running =
    new(StringComparer.Ordinal);
  private readonly ConcurrentDictionary<string, CancelRequest> _pendingCancellations =
    new(StringComparer.Ordinal);

  public ActionExecutionCoordinator(
    IOptions<CompanionOptions> options,
    IOptions<BrokerChannelOptions> brokerOptions,
    IActionTokenVerifier tokenVerifier,
    IFenceTokenVerifier fenceTokenVerifier,
    IActionJournal journal,
    IActionResultStore resultStore,
    CapabilityRegistry capabilities,
    ITrustedRootGuard trustedRoot,
    IEgressBoundaryClient egressBoundary,
    ILocalSystemEgressEvidenceVerifier egressEvidence,
    EgressBoundaryDispatchLatch egressDispatchLatch,
    PrivilegedCommandIsolationDispatchLatch isolationDispatchLatch,
    IOutboundCompanionChannel channel,
    ILogger<ActionExecutionCoordinator> logger)
  {
    _options = options.Value;
    _brokerOptions = brokerOptions.Value;
    if (_options.MaxConcurrentActions != 1
      || _options.MaxResultDeliverySessions is < 1 or > 16
      || _options.MaxBrokerResultEgressBytes is < 1 or > 262_144_000
      || _options.LeaseHeartbeatSeconds is < 1 or > 10
      || _brokerOptions.MaxRequestAttempts is < 1 or > 5)
    {
      throw new InvalidOperationException(
        "The companion result-delivery and journal concurrency policy is invalid.");
    }
    _tokenVerifier = tokenVerifier;
    _fenceTokenVerifier = fenceTokenVerifier;
    _journal = journal;
    _resultStore = resultStore;
    _capabilities = capabilities;
    _trustedRoot = trustedRoot;
    _egressBoundary = egressBoundary;
    _egressEvidence = egressEvidence;
    _egressDispatchLatch = egressDispatchLatch;
    _isolationDispatchLatch = isolationDispatchLatch;
    _channel = channel;
    _logger = logger;
    _leaseHeartbeatInterval = TimeSpan.FromSeconds(_options.LeaseHeartbeatSeconds);
    _concurrencyGate = new SemaphoreSlim(
      _options.MaxConcurrentActions,
      _options.MaxConcurrentActions);
  }

  public int RunningActionCount => _running.Count;

  public bool RequestCancellation(CancelRequest request)
  {
    if (!string.Equals(request.DeviceId, _options.DeviceId, StringComparison.Ordinal))
    {
      return false;
    }

    var now = DateTimeOffset.UtcNow;
    if (string.IsNullOrWhiteSpace(request.ActionId)
      || string.IsNullOrWhiteSpace(request.TaskId)
      || string.IsNullOrWhiteSpace(request.ReasonCode)
      || request.ReasonCode.Length > 128
      || request.RequestedAt < now.AddMinutes(-10)
      || request.RequestedAt > now.AddMinutes(1))
    {
      return false;
    }

    foreach (var pending in _pendingCancellations)
    {
      if (pending.Value.RequestedAt < now.AddMinutes(-10))
      {
        _pendingCancellations.TryRemove(pending.Key, out _);
      }
    }

    if (_pendingCancellations.Count >= 10_000)
    {
      return false;
    }

    _pendingCancellations[request.ActionId] = request;
    if (_running.TryGetValue(request.ActionId, out var running)
      && string.Equals(running.TaskId, request.TaskId, StringComparison.Ordinal))
    {
      running.Cancellation.Cancel();
    }

    return true;
  }

  public async Task FenceAsync(
    SignedFenceActionRequest signedFence,
    CancellationToken stoppingToken)
  {
    var request = signedFence.Request;
    var verification = await _fenceTokenVerifier.VerifyAsync(
      signedFence.CompactToken,
      stoppingToken).ConfigureAwait(false);
    if (!verification.IsValid || verification.Claims is null)
    {
      return;
    }

    if (FenceActionRequestAuthorizer.Validate(request, verification.Claims) is not null
      || !string.Equals(request.DeviceId, _options.DeviceId, StringComparison.Ordinal))
    {
      return;
    }

    if (_running.TryGetValue(request.ActionId, out var running)
      && string.Equals(running.TaskId, request.TaskId, StringComparison.Ordinal)
      && string.Equals(running.LeaseId, request.OldLeaseId, StringComparison.Ordinal)
      && string.Equals(
        running.FencingToken,
        request.OldFencingToken,
        StringComparison.Ordinal))
    {
      running.Cancellation.Cancel();
    }

    using var journalActionLease = await AcquireJournalActionAsync(stoppingToken)
      .ConfigureAwait(false);
    var fenced = await _journal.TryFenceAsync(request, stoppingToken).ConfigureAwait(false);
    if (fenced.Disposition is not (
        JournalFenceDisposition.FencedNoPrepared
        or JournalFenceDisposition.AlreadyFencedNoPrepared)
      || fenced.TombstoneRecord is not { } tombstone)
    {
      return;
    }

    await _channel.SendActionFencedAsync(new ActionFencedReceipt(
      request.FenceId,
      request.DeviceId,
      request.ActionId,
      request.TaskId,
      request.StepId,
      request.OldLeaseId,
      request.OldFencingToken,
      request.OldActionTokenSha256,
      request.DispatchCount,
      signedFence.CompactToken,
      PayloadDigest.Sha256Hex(signedFence.CompactToken),
      ActionFenceOutcomes.NoPrepared,
      request.JournalPreviousSequence,
      request.JournalPreviousHash,
      tombstone.Sequence,
      tombstone.PreviousHash,
      tombstone.EntryHash,
      DateTimeOffset.UtcNow), CancellationToken.None).ConfigureAwait(false);
  }

  public async Task ExecuteAsync(
    SignedActionRequest signedAction,
    CancellationToken stoppingToken)
  {
    var request = signedAction.Request;
    if (!string.Equals(
      request.ExecutionMode,
      ActionExecutionModes.Execute,
      StringComparison.Ordinal))
    {
      return;
    }

    var tokenVerification = await _tokenVerifier.VerifyAsync(
      signedAction.CompactToken,
      stoppingToken).ConfigureAwait(false);
    if (!tokenVerification.IsValid || tokenVerification.Claims is null)
    {
      return;
    }

    var claims = tokenVerification.Claims;
    var authorizationError = ActionRequestAuthorizer.Validate(request, claims);
    if (authorizationError is not null)
    {
      return;
    }

    var policyError = ValidateLocalPolicy(request, claims);
    if (policyError is not null)
    {
      if (BudgetsWithinHardPolicy(claims.Budgets))
      {
        await RejectVerifiedAsync(request, signedAction, claims, policyError).ConfigureAwait(false);
      }
      return;
    }

    if (!_capabilities.TryResolve(
      request.CapabilityId,
      request.CapabilityVersion,
      out var adapter)
      || adapter is null)
    {
      await RejectVerifiedAsync(request, signedAction, claims, "capability_not_available")
        .ConfigureAwait(false);
      return;
    }

    var trustedRootError = _trustedRoot.Validate(adapter.Descriptor);
    if (trustedRootError is not null)
    {
      await RejectVerifiedAsync(request, signedAction, claims, trustedRootError)
        .ConfigureAwait(false);
      return;
    }

    var consentError = ValidateConsent(adapter.Descriptor, claims);
    if (consentError is not null)
    {
      await RejectVerifiedAsync(request, signedAction, claims, consentError)
        .ConfigureAwait(false);
      return;
    }

    if (adapter.Descriptor.IsMutation && !_channel.IsCentralLedgerConnected)
    {
      await RejectVerifiedAsync(request, signedAction, claims, "central_ledger_disconnected")
        .ConfigureAwait(false);
      return;
    }

    JsonDocument argumentsDocument;
    try
    {
      argumentsDocument = JsonDocument.Parse(request.ArgumentsJsonUtf8, new JsonDocumentOptions
      {
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = 32,
      });
    }
    catch (JsonException)
    {
      await RejectVerifiedAsync(request, signedAction, claims, "arguments_json_invalid")
        .ConfigureAwait(false);
      return;
    }

    using (argumentsDocument)
    {
      var validation = adapter.ValidateArguments(argumentsDocument.RootElement);
      if (!validation.IsValid)
      {
        await RejectVerifiedAsync(
          request,
          signedAction,
          claims,
          validation.ErrorCode ?? "arguments_schema_invalid")
          .ConfigureAwait(false);
        return;
      }

      var brokerReservation = BrokerReservationBytes(claims.Budgets);
      if (brokerReservation is null)
      {
        // Sending the rejection would itself exceed the verified ceiling. The
        // central reservation remains authoritative and expires fail-closed.
        return;
      }

      var actionTokenSha256 = PayloadDigest.Sha256Hex(signedAction.CompactToken);

      using var journalActionLease = await AcquireJournalActionAsync(stoppingToken)
        .ConfigureAwait(false);
      var begin = await _journal.TryBeginAsync(
        request,
        actionTokenSha256,
        claims.Budgets.MaxExternalEgressBytes,
        brokerReservation.Value,
        claims.Budgets.BrokerMaxDeliverySessions,
        claims.Budgets.BrokerMaxRequestAttemptsPerSession,
        claims.Budgets.BrokerSerializedResultUpperBoundBytes,
        stoppingToken).ConfigureAwait(false);
      if (begin.Disposition != JournalBeginDisposition.Started)
      {
        await HandleNonStartingDispositionAsync(request, begin).ConfigureAwait(false);
        return;
      }
      var preparedRecord = begin.PreparedRecord;
      if (preparedRecord is null)
      {
        await CompleteKnownFailureAsync(
          request,
          ActionOutcome.Failed,
          "journal_prepared_receipt_missing",
          mutationCommitted: false,
          outcomeUncertain: false,
          budgets: claims.Budgets,
          actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
        return;
      }

      if (_pendingCancellations.TryRemove(request.ActionId, out var pendingCancellation)
        && string.Equals(pendingCancellation.TaskId, request.TaskId, StringComparison.Ordinal))
      {
        await CompleteKnownFailureAsync(
          request,
          ActionOutcome.Cancelled,
          "cancelled_before_start",
           mutationCommitted: false,
           outcomeUncertain: false,
           budgets: claims.Budgets,
           actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
        return;
      }

      using var actionCancellation = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
      var remainingLeaseAuthorization =
        request.LeaseExpiresAt - DateTimeOffset.UtcNow - LeaseSettlementGrace;
      var executionTimeout = TimeSpan.FromSeconds(claims.Budgets.MaxWallTimeSeconds);
      if (remainingLeaseAuthorization < executionTimeout)
      {
        executionTimeout = remainingLeaseAuthorization;
      }
      actionCancellation.CancelAfter(executionTimeout > TimeSpan.Zero
        ? executionTimeout
        : TimeSpan.FromMilliseconds(1));
      var running = new RunningAction(
        request.TaskId,
        request.LeaseId,
        request.FencingToken,
        actionCancellation);
      if (!_running.TryAdd(request.ActionId, running))
      {
        await CompleteKnownFailureAsync(
          request,
          ActionOutcome.Failed,
          "action_id_already_running",
           mutationCommitted: false,
           outcomeUncertain: false,
           budgets: claims.Budgets,
           actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
        return;
      }

      await SendProgressSafelyAsync(
        request,
        ActionProgressState.Accepted,
        "action_accepted",
        cancellationToken: CancellationToken.None)
        .ConfigureAwait(false);

      var capabilityBudgets = claims.Budgets with
      {
        MaxExternalEgressBytes = claims.Budgets.MaxExternalEgressBytes
          - brokerReservation.Value,
      };
      var enteredConcurrencyGate = false;
      CancellationTokenSource? leaseHeartbeatCancellation = null;
      Task? leaseHeartbeatTask = null;
      var requiresEgressBoundary = RequiresEgressBoundary(adapter.Descriptor.Id);
      IEgressBoundarySession? egressSession = null;
      EgressActionBinding? egressBinding = null;
      IReadOnlyList<string>? requiredEgressFeatures = null;
      EgressExecutionEvidence? egressEvidence = null;
      try
      {
        await _concurrencyGate.WaitAsync(actionCancellation.Token).ConfigureAwait(false);
        enteredConcurrencyGate = true;
        // The gate is intentionally checked only after this action owns the
        // single execution slot. An earlier check could race with the preceding
        // privileged command tripping the fuse while this action waited.
        _isolationDispatchLatch.ThrowIfTripped();
        if (requiresEgressBoundary)
        {
          _egressDispatchLatch.ThrowIfTripped();
        }
        var startedAcknowledged = await SendProgressSafelyAsync(
          request,
          ActionProgressState.Started,
          "action_started",
          preparedRecord,
          CancellationToken.None)
          .ConfigureAwait(false);
        if (adapter.Descriptor.IsMutation
          && (!ExactPreparedAcknowledgement(
              startedAcknowledged,
              request,
              preparedRecord)
            || !_channel.IsCentralLedgerConnected))
        {
          // The earlier connectivity check can become stale while the action
          // waits for the local concurrency gate. Require one immediately
          // acknowledged broker round trip before entering a mutation adapter.
          // This is an adapter-boundary liveness gate, not proof that the
          // connection will remain live until the adapter's native commit.
          await CompleteKnownFailureAsync(
            request,
            ActionOutcome.Failed,
            "central_ledger_not_acknowledged_before_execution",
            mutationCommitted: false,
            outcomeUncertain: false,
            budgets: claims.Budgets,
            actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
          return;
        }
        leaseHeartbeatCancellation = CancellationTokenSource.CreateLinkedTokenSource(
          actionCancellation.Token);
        leaseHeartbeatTask = RunLeaseHeartbeatAsync(
          request,
          adapter.Descriptor.IsMutation,
          preparedRecord,
          actionCancellation,
          leaseHeartbeatCancellation.Token);

        egressBinding = new EgressActionBinding(
          actionTokenSha256,
          request.ActionId,
          request.TaskId,
          request.PlanVersionId,
          request.StepId,
          request.DeviceId,
          request.MandateId,
          request.CapabilityId,
          request.CapabilityVersion,
          request.DispatchCount,
          capabilityBudgets.MaxExternalEgressBytes,
          _options.EgressDestinationPolicySha256,
          _options.EgressExecutionIdentitySha256,
          request.ArgumentsSha256.ToLowerInvariant(),
          request.ExpectedPreStateSha256?.ToLowerInvariant(),
          PayloadDigest.Sha256Hex(request.IdempotencyKey));
        EgressExecutionAuthorization? egressAuthorization = null;
        if (requiresEgressBoundary)
        {
          requiredEgressFeatures = RequiredBoundaryFeatures(adapter.Descriptor.Id);
          egressSession = await _egressBoundary.TryReserveAsync(
            signedAction.CompactToken,
            request.ArgumentsJsonUtf8,
            egressBinding,
            actionCancellation.Token).ConfigureAwait(false);
          egressAuthorization = egressSession?.Authorization;
          var authorizationVerification = egressAuthorization is null
            ? EgressVerificationResult.Invalid<VerifiedEgressAuthorization>(
              "egress_boundary_unavailable")
            : _egressEvidence.VerifyAuthorization(
              egressAuthorization,
              egressBinding,
              requiredEgressFeatures);
          if (!authorizationVerification.IsValid)
          {
            await CompleteKnownFailureAsync(
              request,
              ActionOutcome.NeedsAttention,
              authorizationVerification.ErrorCode ?? "egress_authorization_invalid",
              mutationCommitted: false,
              outcomeUncertain: true,
              budgets: claims.Budgets,
              uncertainExternalEgressBytes: capabilityBudgets.MaxExternalEgressBytes,
              actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
            return;
          }
          if (adapter is not IEgressLifecycleCapabilityAdapter)
          {
            egressEvidence = await AbortEgressBeforeAdapterAsync(
              egressSession!,
              egressBinding,
              requiredEgressFeatures,
              request.ActionId,
              actionCancellation.Token).ConfigureAwait(false);
            await CompleteKnownFailureAsync(
              request,
              ActionOutcome.Failed,
              "egress_lifecycle_adapter_required",
              mutationCommitted: false,
              outcomeUncertain: false,
              budgets: claims.Budgets,
              actionTokenSha256: actionTokenSha256,
              egressEvidence: egressEvidence).ConfigureAwait(false);
            return;
          }
        }

        var executionContext = new ActionExecutionContext(
          request.ActionId,
          request.TaskId,
          request.PlanVersionId,
          request.StepId,
          request.DeviceId,
          request.MandateId,
          request.IdempotencyKey,
          request.ExpectedPreStateSha256,
          request.InputProvenanceSha256,
          capabilityBudgets,
          actionTokenSha256,
          request.DispatchCount,
          egressAuthorization,
          _options.EgressDestinationPolicySha256,
          _options.EgressExecutionIdentitySha256,
          request.ArgumentsSha256,
          new EphemeralActionAuthorization(signedAction, claims));
        if (await _journal.IsFencedAsync(request, actionCancellation.Token)
          .ConfigureAwait(false))
        {
          if (requiresEgressBoundary)
          {
            egressEvidence = await AbortEgressBeforeAdapterAsync(
              egressSession!,
              egressBinding,
              requiredEgressFeatures!,
              request.ActionId,
              CancellationToken.None).ConfigureAwait(false);
          }
          await CompleteKnownFailureAsync(
            request,
            ActionOutcome.Failed,
            "action_fenced_before_adapter",
            mutationCommitted: false,
            outcomeUncertain: false,
            budgets: claims.Budgets,
            actionTokenSha256: actionTokenSha256,
            egressEvidence: egressEvidence).ConfigureAwait(false);
          return;
        }
        var conservativeEgressFloor = ConservativeEgressFloor(
          adapter.Descriptor,
          executionContext,
          argumentsDocument.RootElement);
        var executed = requiresEgressBoundary
          ? await ((IEgressLifecycleCapabilityAdapter)adapter).ExecuteWithEgressAsync(
            executionContext,
            argumentsDocument.RootElement,
            egressSession!,
            actionCancellation.Token).ConfigureAwait(false)
          : await adapter.ExecuteAsync(
            executionContext,
            argumentsDocument.RootElement,
            actionCancellation.Token).ConfigureAwait(false);

        var settledExternalEgressBytes = Math.Max(
          Math.Max(0, executed.ExternalEgressBytes),
          conservativeEgressFloor);
        long receiptUncertainEgressBytes = 0;
        var receiptOutcomeUncertain = false;
        if (requiresEgressBoundary)
        {
          if (egressAuthorization is null || egressSession is null)
          {
            _egressDispatchLatch.Trip();
            throw new EgressBoundaryUnsafeException(
              "egress_session_missing",
              mayHaveExecuted: true);
          }
          if (!egressSession.HasRegistration)
          {
            _egressDispatchLatch.Trip();
            throw new EgressBoundaryUnsafeException(
              "egress_registration_missing_after_adapter",
              mayHaveExecuted: true);
          }

          var disposition = new EgressTerminalDispositionV1(
            EgressSupervisorLifecycleContract.Version,
            EgressSupervisorLifecycleCanonical.OperationId(request.ActionId, "settle"),
            executed.OutcomeUncertain
              ? EgressSupervisorLifecycleContract.Unknown
              : EgressSupervisorLifecycleContract.Completed,
            settledExternalEgressBytes,
            executed.OutcomeUncertain,
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
          var signedReceipt = await egressSession.TrySettleAsync(
            disposition,
            actionCancellation.Token).ConfigureAwait(false);
          if (signedReceipt is null)
          {
            _egressDispatchLatch.Trip();
            throw new EgressBoundaryUnsafeException(
              "egress_terminal_receipt_missing",
              mayHaveExecuted: true);
          }
          egressEvidence = new EgressExecutionEvidence(
            egressAuthorization,
            signedReceipt);
          var receiptVerification = await _egressEvidence.VerifyAndCommitReceiptAsync(
            egressEvidence,
            egressBinding,
            requiredEgressFeatures!,
            actionCancellation.Token).ConfigureAwait(false);
          if (!receiptVerification.IsValid || receiptVerification.Value is null)
          {
            _egressDispatchLatch.Trip();
            throw new EgressBoundaryUnsafeException(
              receiptVerification.ErrorCode ?? "egress_receipt_invalid",
              mayHaveExecuted: true);
          }
          var receipt = receiptVerification.Value.Evidence.Receipt.Receipt;
          var receiptUnknown = string.Equals(
            receipt.Outcome,
            EgressSupervisorLifecycleContract.Unknown,
            StringComparison.Ordinal);
          if (receipt.MeasuredExternalEgressBytes < settledExternalEgressBytes)
          {
            _egressDispatchLatch.Trip();
            throw new EgressBoundaryUnsafeException(
              "egress_receipt_measurement_mismatch",
              mayHaveExecuted: true);
          }
          // The independently trusted supervisor may observe transport bytes
          // above the LocalSystem floor. Charge the maximum exactly once: the
          // receipt's measured field becomes capability usage, while its
          // separate uncertain field accounts only the remaining reservation.
          settledExternalEgressBytes = receipt.MeasuredExternalEgressBytes;

          var dispositionSha256 = EgressSupervisorLifecycleCanonical.DispositionSha256(
            disposition);
          if (!PayloadDigest.FixedTimeEqualsHex(
              receipt.DispositionSha256,
              dispositionSha256)
            || PayloadDigest.FixedTimeEqualsHex(
              receipt.RegistrationSha256,
              EgressSupervisorLifecycleCanonical.ZeroSha256)
            || (!receiptUnknown
              && !string.Equals(
                receipt.Outcome,
                disposition.Outcome,
                StringComparison.Ordinal))
            || (receiptUnknown
              && receipt.ChargedExternalEgressBytes
                != receipt.ReservedCapabilityEgressBytes))
          {
            _egressDispatchLatch.Trip();
            throw new EgressBoundaryUnsafeException(
              "egress_terminal_disposition_mismatch",
              mayHaveExecuted: true);
          }
          receiptUncertainEgressBytes = receipt.UncertainExternalEgressBytes;
          receiptOutcomeUncertain = receiptUncertainEgressBytes > 0
            || !string.Equals(receipt.Outcome, "completed", StringComparison.Ordinal);
        }

        if (!CapabilityExecutionResultPolicy.IsValid(
            adapter.Descriptor,
            executed,
            DateTimeOffset.UtcNow)
          || executed.ExternalEgressBytes < 0
          || executed.ExternalEgressBytes > capabilityBudgets.MaxExternalEgressBytes
          || settledExternalEgressBytes > capabilityBudgets.MaxExternalEgressBytes
          || executed.LocalBytesRead < 0
          || executed.LocalBytesWritten < 0
          || executed.LocalBytesRead > claims.Budgets.MaxLocalBytes
          || executed.LocalBytesWritten > claims.Budgets.MaxLocalBytes
          || executed.LocalBytesRead > claims.Budgets.MaxLocalBytes
            - executed.LocalBytesWritten
          || executed.EgressReceipt is not null
          || (executed.PreStateSha256 is not null
            && !PayloadDigest.IsSha256Hex(executed.PreStateSha256))
          || (adapter.Descriptor.IsMutation
            && (request.ExpectedPreStateSha256 is null
              || executed.PreStateSha256 is null
              || !PayloadDigest.FixedTimeEqualsHex(
                request.ExpectedPreStateSha256,
                executed.PreStateSha256)))
          || (executed.RecoveryProvenanceSha256 is not null
            && !PayloadDigest.IsSha256Hex(executed.RecoveryProvenanceSha256)))
        {
          var committedWrite = adapter.Descriptor.IsMutation && executed.MutationCommitted;
          var resultOutcomeUncertain = committedWrite
            || requiresEgressBoundary
            || receiptOutcomeUncertain;
          await CompleteKnownFailureAsync(
            request,
            resultOutcomeUncertain ? ActionOutcome.NeedsAttention : ActionOutcome.Failed,
            "capability_result_policy_invalid",
            mutationCommitted: executed.MutationCommitted,
            outcomeUncertain: resultOutcomeUncertain,
            localBytesRead: Math.Max(0, executed.LocalBytesRead),
            localBytesWritten: Math.Max(0, executed.LocalBytesWritten),
            externalEgressBytes: settledExternalEgressBytes,
            uncertainExternalEgressBytes: receiptUncertainEgressBytes,
            preStateSha256: ValidDigestOrNull(executed.PreStateSha256),
            recoveryProvenanceSha256: ValidDigestOrNull(
              executed.RecoveryProvenanceSha256),
            recoveryHandleSha256: executed.OpaqueRecoveryHandle is null
              ? null
              : PayloadDigest.Sha256Hex(executed.OpaqueRecoveryHandle),
            budgets: claims.Budgets,
            actionTokenSha256: actionTokenSha256,
            egressEvidence: egressEvidence)
            .ConfigureAwait(false);
          return;
        }

        using var resultDocument = JsonDocument.Parse(executed.OutputJson, new JsonDocumentOptions
        {
          AllowTrailingCommas = false,
          CommentHandling = JsonCommentHandling.Disallow,
          MaxDepth = 32,
        });
        var resultValidation = adapter.ValidateResult(resultDocument.RootElement);
        if (!resultValidation.IsValid)
        {
          var committedWrite = adapter.Descriptor.IsMutation && executed.MutationCommitted;
          var resultOutcomeUncertain = committedWrite
            || requiresEgressBoundary
            || receiptOutcomeUncertain;
          await CompleteKnownFailureAsync(
            request,
            resultOutcomeUncertain ? ActionOutcome.NeedsAttention : ActionOutcome.Failed,
            resultValidation.ErrorCode ?? "result_schema_invalid",
            mutationCommitted: executed.MutationCommitted,
            outcomeUncertain: resultOutcomeUncertain,
            localBytesRead: executed.LocalBytesRead,
            localBytesWritten: executed.LocalBytesWritten,
            externalEgressBytes: settledExternalEgressBytes,
            uncertainExternalEgressBytes: receiptUncertainEgressBytes,
            preStateSha256: executed.PreStateSha256,
            recoveryProvenanceSha256: executed.RecoveryProvenanceSha256,
            recoveryHandleSha256: executed.OpaqueRecoveryHandle is null
              ? null
              : PayloadDigest.Sha256Hex(executed.OpaqueRecoveryHandle),
            budgets: claims.Budgets,
            actionTokenSha256: actionTokenSha256,
            egressEvidence: egressEvidence)
            .ConfigureAwait(false);
          return;
        }

        var outcome = executed.OutcomeUncertain || receiptOutcomeUncertain
          ? ActionOutcome.NeedsAttention
          : ActionOutcome.Completed;
        var result = CreateResult(
          request,
          outcome,
          outputJson: executed.OutputJson,
          outputSha256: PayloadDigest.Sha256Hex(executed.OutputJson),
          mutationCommitted: executed.MutationCommitted,
          outcomeUncertain: executed.OutcomeUncertain || receiptOutcomeUncertain,
          provenance: executed.Provenance,
          preStateSha256: executed.PreStateSha256,
          recoveryProvenanceSha256: executed.RecoveryProvenanceSha256,
          recoveryHandleSha256: executed.OpaqueRecoveryHandle is null
            ? null
            : PayloadDigest.Sha256Hex(executed.OpaqueRecoveryHandle),
          localBytesRead: executed.LocalBytesRead,
          localBytesWritten: executed.LocalBytesWritten,
          externalEgressBytes: settledExternalEgressBytes,
          uncertainExternalEgressBytes: receiptUncertainEgressBytes,
          actionTokenSha256: actionTokenSha256,
          egressEvidence: egressEvidence);
        if (!TryPrepayBrokerResult(result, claims.Budgets, out var prepaidResult))
        {
          var resultCouldBeUncertain = adapter.Descriptor.IsMutation
            && executed.MutationCommitted
            || requiresEgressBoundary;
          await CompleteKnownFailureAsync(
            request,
            resultCouldBeUncertain
              ? ActionOutcome.NeedsAttention
              : ActionOutcome.Failed,
            "broker_result_egress_reservation_exceeded",
            mutationCommitted: executed.MutationCommitted,
            outcomeUncertain: resultCouldBeUncertain,
            localBytesRead: executed.LocalBytesRead,
            localBytesWritten: executed.LocalBytesWritten,
            externalEgressBytes: settledExternalEgressBytes,
            uncertainExternalEgressBytes: requiresEgressBoundary
              ? Math.Max(
                receiptUncertainEgressBytes,
                capabilityBudgets.MaxExternalEgressBytes - settledExternalEgressBytes)
              : 0,
            preStateSha256: executed.PreStateSha256,
            recoveryProvenanceSha256: executed.RecoveryProvenanceSha256,
            recoveryHandleSha256: executed.OpaqueRecoveryHandle is null
              ? null
              : PayloadDigest.Sha256Hex(executed.OpaqueRecoveryHandle),
            budgets: claims.Budgets,
            actionTokenSha256: actionTokenSha256,
            egressEvidence: egressEvidence).ConfigureAwait(false);
          return;
        }
        await PersistAndSendAsync(
          request,
          prepaidResult,
          claims.Budgets.MaxExternalEgressBytes).ConfigureAwait(false);
      }
      catch (TerminalPersistenceException)
      {
        // The journal may already contain the terminal record even when the
        // final fsync/close reported an error. Never attempt a second terminal;
        // fail the service so restart verification resolves the durable state.
        throw;
      }
      catch (PrivilegedCommandIsolationUnsafeException exception)
      {
        await CompleteKnownFailureAsync(
          request,
          ActionOutcome.NeedsAttention,
          exception.ErrorCode,
          mutationCommitted: exception.MayHaveExecuted,
          outcomeUncertain: true,
          uncertainExternalEgressBytes: requiresEgressBoundary
            ? capabilityBudgets.MaxExternalEgressBytes
            : 0,
          budgets: claims.Budgets,
          actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
        // Persist the durable ambiguity first, then fail the background worker
        // so it stops broker intake. The process-lifetime latch also closes the
        // race for an action already queued on the concurrency gate.
        throw;
      }
      catch (EgressBoundaryUnsafeException exception)
      {
        await CompleteKnownFailureAsync(
          request,
          exception.MayHaveExecuted ? ActionOutcome.NeedsAttention : ActionOutcome.Failed,
          exception.ErrorCode,
          mutationCommitted: adapter.Descriptor.IsMutation && exception.MayHaveExecuted,
          outcomeUncertain: exception.MayHaveExecuted,
          uncertainExternalEgressBytes: exception.MayHaveExecuted
            ? capabilityBudgets.MaxExternalEgressBytes
            : 0,
          budgets: claims.Budgets,
          actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
        // Persist ambiguity before stopping the worker. The one-way latch also
        // closes the race for an egress action waiting on the execution slot.
        throw;
      }
      catch (HostPreconditionException exception)
      {
        var resolution = await ResolveEgressFailureAsync(
          egressSession,
          egressBinding,
          requiredEgressFeatures,
          egressEvidence,
          request.ActionId,
          EgressSupervisorLifecycleContract.Failed,
          "host-precondition").ConfigureAwait(false);
        if (requiresEgressBoundary && !resolution.IsResolved)
        {
          await CompleteKnownFailureAsync(
            request,
            ActionOutcome.NeedsAttention,
            resolution.ErrorCode ?? "egress_abort_unresolved",
            mutationCommitted: false,
            outcomeUncertain: true,
            uncertainExternalEgressBytes: capabilityBudgets.MaxExternalEgressBytes,
            budgets: claims.Budgets,
            actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
          _egressDispatchLatch.Trip();
          throw new EgressBoundaryUnsafeException(
            resolution.ErrorCode ?? "egress_abort_unresolved",
            mayHaveExecuted: egressSession?.HasRegistration == true);
        }
        var egressCouldBeUncertain = resolution.OutcomeUncertain;
        await CompleteKnownFailureAsync(
          request,
          egressCouldBeUncertain ? ActionOutcome.NeedsAttention : ActionOutcome.Failed,
          exception.ErrorCode,
          mutationCommitted: false,
          outcomeUncertain: egressCouldBeUncertain,
          externalEgressBytes: resolution.MeasuredExternalEgressBytes,
          uncertainExternalEgressBytes: resolution.UncertainExternalEgressBytes,
          budgets: claims.Budgets,
          actionTokenSha256: actionTokenSha256,
          egressEvidence: resolution.Evidence).ConfigureAwait(false);
      }
      catch (OperationCanceledException) when (actionCancellation.IsCancellationRequested)
      {
        if (!requiresEgressBoundary)
        {
          var legacyWriteCouldBeUncertain = adapter.Descriptor.IsMutation;
          await CompleteKnownFailureAsync(
            request,
            ActionOutcome.NeedsAttention,
            legacyWriteCouldBeUncertain
              ? "cancelled_write_outcome_unknown"
              : "cancelled_egress_outcome_unknown",
            mutationCommitted: false,
            outcomeUncertain: true,
            uncertainExternalEgressBytes: capabilityBudgets.MaxExternalEgressBytes,
            budgets: claims.Budgets,
            actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
          return;
        }
        var resolution = await ResolveEgressFailureAsync(
          egressSession,
          egressBinding,
          requiredEgressFeatures,
          egressEvidence,
          request.ActionId,
          EgressSupervisorLifecycleContract.Cancelled,
          "cancelled").ConfigureAwait(false);
        if (requiresEgressBoundary && !resolution.IsResolved)
        {
          await CompleteKnownFailureAsync(
            request,
            ActionOutcome.NeedsAttention,
            resolution.ErrorCode ?? "cancelled_egress_outcome_unknown",
            mutationCommitted: false,
            outcomeUncertain: true,
            uncertainExternalEgressBytes: capabilityBudgets.MaxExternalEgressBytes,
            budgets: claims.Budgets,
            actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
          _egressDispatchLatch.Trip();
          throw new EgressBoundaryUnsafeException(
            resolution.ErrorCode ?? "cancelled_egress_outcome_unknown",
            mayHaveExecuted: egressSession?.HasRegistration == true);
        }
        var writeCouldBeUncertain = adapter.Descriptor.IsMutation;
        await CompleteKnownFailureAsync(
          request,
          resolution.OutcomeUncertain || writeCouldBeUncertain
            ? ActionOutcome.NeedsAttention
            : ActionOutcome.Cancelled,
          writeCouldBeUncertain || resolution.OutcomeUncertain
            ? "cancelled_write_outcome_unknown"
            : "cancelled_before_external_effect",
          mutationCommitted: false,
          outcomeUncertain: writeCouldBeUncertain || resolution.OutcomeUncertain,
          externalEgressBytes: resolution.MeasuredExternalEgressBytes,
          uncertainExternalEgressBytes: resolution.UncertainExternalEgressBytes,
          budgets: claims.Budgets,
          actionTokenSha256: actionTokenSha256,
          egressEvidence: resolution.Evidence).ConfigureAwait(false);
      }
      catch (Exception exception)
      {
        LogCapabilityFailure(
          _logger,
          adapter.Descriptor.Id,
          request.ActionId,
          exception.GetType().Name,
          exception);
        if (!requiresEgressBoundary)
        {
          var legacyWriteCouldBeUncertain = adapter.Descriptor.IsMutation;
          await CompleteKnownFailureAsync(
            request,
            ActionOutcome.NeedsAttention,
            legacyWriteCouldBeUncertain
              ? "write_outcome_unknown"
              : "capability_egress_outcome_unknown",
            mutationCommitted: false,
            outcomeUncertain: true,
            uncertainExternalEgressBytes: capabilityBudgets.MaxExternalEgressBytes,
            budgets: claims.Budgets,
            actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
          return;
        }
        var resolution = await ResolveEgressFailureAsync(
          egressSession,
          egressBinding,
          requiredEgressFeatures,
          egressEvidence,
          request.ActionId,
          EgressSupervisorLifecycleContract.Failed,
          "capability-failure").ConfigureAwait(false);
        if (requiresEgressBoundary && !resolution.IsResolved)
        {
          await CompleteKnownFailureAsync(
            request,
            ActionOutcome.NeedsAttention,
            resolution.ErrorCode ?? "capability_egress_outcome_unknown",
            mutationCommitted: false,
            outcomeUncertain: true,
            uncertainExternalEgressBytes: capabilityBudgets.MaxExternalEgressBytes,
            budgets: claims.Budgets,
            actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
          _egressDispatchLatch.Trip();
          throw new EgressBoundaryUnsafeException(
            resolution.ErrorCode ?? "capability_egress_outcome_unknown",
            mayHaveExecuted: egressSession?.HasRegistration == true,
            exception);
        }
        var writeCouldBeUncertain = adapter.Descriptor.IsMutation;
        var outcomeUncertain = writeCouldBeUncertain || resolution.OutcomeUncertain;
        await CompleteKnownFailureAsync(
          request,
          outcomeUncertain ? ActionOutcome.NeedsAttention : ActionOutcome.Failed,
          writeCouldBeUncertain ? "write_outcome_unknown" : "capability_egress_outcome_unknown",
          mutationCommitted: false,
          outcomeUncertain: outcomeUncertain,
          externalEgressBytes: resolution.MeasuredExternalEgressBytes,
          uncertainExternalEgressBytes: resolution.UncertainExternalEgressBytes,
          budgets: claims.Budgets,
          actionTokenSha256: actionTokenSha256,
          egressEvidence: resolution.Evidence).ConfigureAwait(false);
      }
      finally
      {
        if (egressSession is not null)
        {
          await egressSession.DisposeAsync().ConfigureAwait(false);
        }
        if (leaseHeartbeatCancellation is not null)
        {
          await leaseHeartbeatCancellation.CancelAsync().ConfigureAwait(false);
          if (leaseHeartbeatTask is not null)
          {
            try
            {
              await leaseHeartbeatTask.ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (leaseHeartbeatCancellation.IsCancellationRequested)
            {
              // Normal completion stops the periodic liveness proof.
            }
          }
          leaseHeartbeatCancellation.Dispose();
        }

        if (enteredConcurrencyGate)
        {
          _concurrencyGate.Release();
        }

        _running.TryRemove(request.ActionId, out _);
        _pendingCancellations.TryRemove(request.ActionId, out _);
      }
    }
  }

  /// <summary>
  /// Re-delivers a prior terminal result under a separately signed replay-only
  /// authorization. This path is intentionally incapable of preparing or
  /// executing a host action: both the verified terminal journal receipt and
  /// its protected result binding must already exist.
  /// </summary>
  public async Task ReplayResultAsync(
    SignedActionRequest signedAction,
    CancellationToken stoppingToken)
  {
    var request = signedAction.Request;
    if (!string.Equals(
      request.ExecutionMode,
      ActionExecutionModes.ReplayResultOnly,
      StringComparison.Ordinal))
    {
      return;
    }

    var tokenVerification = await _tokenVerifier.VerifyAsync(
      signedAction.CompactToken,
      stoppingToken).ConfigureAwait(false);
    if (!tokenVerification.IsValid || tokenVerification.Claims is null)
    {
      return;
    }

    var claims = tokenVerification.Claims;
    if (ActionRequestAuthorizer.Validate(request, claims) is not null
      || ValidateLocalPolicy(request, claims) is not null
      || !_channel.IsCentralLedgerConnected)
    {
      return;
    }

    var receipt = await _journal.TryGetTerminalAsync(request, stoppingToken)
      .ConfigureAwait(false);
    if (receipt is null || !ReplayBudgetMatches(claims.Budgets, receipt))
    {
      return;
    }

    var stored = await _resultStore.TryLoadAsync(
      request,
      receipt,
      stoppingToken).ConfigureAwait(false);
    if (stored is null)
    {
      return;
    }

    await SendJournaledResultSafelyAsync(
      request,
      BindJournaledReplay(request, stored, receipt),
      receipt).ConfigureAwait(false);
  }

  private static bool ReplayBudgetMatches(
    ActionBudget budgets,
    JournalTerminalReceipt receipt) =>
    budgets.MaxExternalEgressBytes == receipt.MaximumExternalEgressBytes
    && budgets.BrokerMaxDeliverySessions == receipt.BrokerMaxDeliverySessions
    && budgets.BrokerMaxRequestAttemptsPerSession
      == receipt.BrokerMaxRequestAttemptsPerSession
    && budgets.BrokerSerializedResultUpperBoundBytes
      == receipt.BrokerSerializedResultUpperBoundBytes
    && BrokerReservationBytes(budgets) == receipt.BrokerExternalEgressBytes;

  public void Dispose()
  {
    foreach (var running in _running.Values)
    {
      running.Cancellation.Cancel();
    }

    _concurrencyGate.Dispose();
    _journalActionGate.Dispose();
  }

  private string? ValidateLocalPolicy(ActionRequest request, ActionTokenClaims claims)
  {
    if (!_options.ExecutionEnabled)
    {
      return "execution_disabled";
    }

    if (_trustedRoot.IsKillSwitchEngaged)
    {
      return "kill_switch_engaged";
    }

    if (!string.Equals(request.DeviceId, _options.DeviceId, StringComparison.Ordinal))
    {
      return "wrong_device";
    }

    if (Encoding.UTF8.GetByteCount(request.ArgumentsJsonUtf8) > _options.MaximumArgumentsBytes)
    {
      return "arguments_too_large";
    }

    if (!BudgetsWithinHardPolicy(claims.Budgets))
    {
      return "budget_exceeds_device_policy";
    }

    return null;
  }

  private static string? ValidateConsent(
    CapabilityDescriptor descriptor,
    ActionTokenClaims claims) => descriptor.Consent switch
    {
      ConsentRequirement.None => null,
      ConsentRequirement.SignedMandate when !string.IsNullOrWhiteSpace(claims.MandateId) => null,
      ConsentRequirement.ActiveUser when claims.ConsentGrant == "active_user" => null,
      ConsentRequirement.OneShotApproval when claims.ConsentGrant == "one_shot_approval" => null,
      ConsentRequirement.EmergencyOperator when claims.ConsentGrant == "emergency_operator" => null,
      _ => "capability_consent_missing",
    };

  private bool BudgetsWithinHardPolicy(ActionBudget budget) =>
    budget.MaxWallTimeSeconds is > 0
    && budget.MaxWallTimeSeconds <= _options.HardMaxWallTimeSeconds
    && budget.MaxModelTurns is > 0
    && budget.MaxModelTurns <= _options.HardMaxModelTurns
    && budget.MaxAttemptedToolCalls is > 0
    && budget.MaxAttemptedToolCalls <= _options.HardMaxAttemptedToolCalls
    && budget.MaxMutations >= 0
    && budget.MaxMutations <= _options.HardMaxMutations
    && budget.MaxLocalBytes >= 0
    && budget.MaxLocalBytes <= _options.HardMaxLocalBytes
    && budget.MaxExternalEgressBytes >= 0
    && budget.MaxExternalEgressBytes <= _options.HardMaxExternalEgressBytes
    && budget.MaxModelSpendUsd >= 0
    && budget.MaxModelSpendUsd <= _options.HardMaxModelSpendUsd
    && budget.BrokerMaxDeliverySessions is >= 1 and <= 16
    && budget.BrokerMaxDeliverySessions <= _options.MaxResultDeliverySessions
    && budget.BrokerMaxRequestAttemptsPerSession is >= 1 and <= 5
    && budget.BrokerMaxRequestAttemptsPerSession <= _brokerOptions.MaxRequestAttempts
    && budget.BrokerSerializedResultUpperBoundBytes > 0
    && BrokerReservationBytes(budget) is { } brokerReservation
    && brokerReservation <= _options.MaxBrokerResultEgressBytes
    && brokerReservation <= budget.MaxExternalEgressBytes;

  private async Task RejectVerifiedAsync(
    ActionRequest request,
    SignedActionRequest signedAction,
    ActionTokenClaims claims,
    string errorCode)
  {
    errorCode = BrokerSafeErrorCode(errorCode);
    var brokerReservation = BrokerReservationBytes(claims.Budgets);
    var rejection = CreateResult(
      request,
      ActionOutcome.Rejected,
      errorCode: errorCode);
    if (brokerReservation is null
      || !TryPrepayBrokerResult(rejection, claims.Budgets, out _))
    {
      // The rejection cannot be reported without exceeding the signed budget.
      // Leave the centrally reserved ceiling to expire fail-closed.
      return;
    }

    using var journalActionLease = await AcquireJournalActionAsync(CancellationToken.None)
      .ConfigureAwait(false);
    var begin = await _journal.TryBeginAsync(
      request,
      PayloadDigest.Sha256Hex(signedAction.CompactToken),
      claims.Budgets.MaxExternalEgressBytes,
      brokerReservation.Value,
      claims.Budgets.BrokerMaxDeliverySessions,
      claims.Budgets.BrokerMaxRequestAttemptsPerSession,
      claims.Budgets.BrokerSerializedResultUpperBoundBytes,
      CancellationToken.None).ConfigureAwait(false);
    if (begin.Disposition != JournalBeginDisposition.Started)
    {
      await HandleNonStartingDispositionAsync(request, begin).ConfigureAwait(false);
      return;
    }

    await SendProgressSafelyAsync(request, ActionProgressState.Rejected, errorCode)
      .ConfigureAwait(false);
    await CompleteKnownFailureAsync(
      request,
      ActionOutcome.Rejected,
      errorCode,
      mutationCommitted: false,
      outcomeUncertain: false,
      budgets: claims.Budgets,
      actionTokenSha256: PayloadDigest.Sha256Hex(signedAction.CompactToken)).ConfigureAwait(false);
  }

  private async Task HandleNonStartingDispositionAsync(
    ActionRequest request,
    JournalBeginResult begin)
  {
    if (begin.Disposition == JournalBeginDisposition.TerminalReplay
      && begin.TerminalReceipt is not null)
    {
      using var replayCancellation = new CancellationTokenSource();
      var replay = new RunningAction(
        request.TaskId,
        request.LeaseId,
        request.FencingToken,
        replayCancellation);
      if (!_running.TryAdd(request.ActionId, replay))
      {
        return;
      }
      try
      {
        await ReplayTerminalResultAsync(request, begin.TerminalReceipt).ConfigureAwait(false);
      }
      finally
      {
        _running.TryRemove(request.ActionId, out _);
        _pendingCancellations.TryRemove(request.ActionId, out _);
      }
      return;
    }

    // Non-terminal begin dispositions have no new prepared budget record.
    // Sending a fresh result here would bypass the prepaid delivery-session
    // limit. The broker retains/redelivers the authoritative action instead.
  }

  private async Task ReplayTerminalResultAsync(
    ActionRequest request,
    JournalTerminalReceipt receipt)
  {
    var stored = await _resultStore.TryLoadAsync(
      request,
      receipt,
      CancellationToken.None).ConfigureAwait(false);
    var replayResult = stored ?? new ActionResult(
        ActionId: receipt.ActionId,
        TaskId: receipt.TaskId,
        StepId: receipt.StepId,
        Outcome: receipt.Outcome,
        OutputJson: null,
        OutputSha256: receipt.OutputSha256,
        MutationCommitted: receipt.MutationCommitted,
        OutcomeUncertain: receipt.OutcomeUncertain,
        IsIdempotentReplay: true,
        ErrorCode: receipt.ErrorCode,
        Provenance: receipt.Provenance ?? [],
        JournalPrepareSequence: receipt.JournalPrepareSequence,
        JournalPrepareEntryHash: receipt.JournalPrepareEntryHash,
        JournalPreparePreviousHash: receipt.JournalPreparePreviousHash,
        JournalSequence: receipt.JournalSequence,
        JournalEntryHash: receipt.JournalEntryHash,
        JournalPreviousHash: receipt.JournalPreviousHash,
        JournalRecoveryPreparedSequence: receipt.JournalRecoveryPreparedSequence,
        JournalRecoveryPreparedEntryHash: receipt.JournalRecoveryPreparedEntryHash,
        JournalRecoveryPreparedPreviousHash:
          receipt.JournalRecoveryPreparedPreviousHash,
        PreStateSha256: receipt.PreStateSha256,
        RecoveryProvenanceSha256: receipt.RecoveryProvenanceSha256,
        RecoveryHandleSha256: receipt.RecoveryHandleSha256,
        LocalBytesRead: receipt.LocalBytesRead,
        LocalBytesWritten: receipt.LocalBytesWritten,
        ExternalEgressBytes: receipt.ExternalEgressBytes,
        BrokerExternalEgressBytes: receipt.BrokerExternalEgressBytes,
        BrokerMaxDeliverySessions: receipt.BrokerMaxDeliverySessions,
        BrokerMaxRequestAttemptsPerSession: receipt.BrokerMaxRequestAttemptsPerSession,
        BrokerSerializedResultUpperBoundBytes:
          receipt.BrokerSerializedResultUpperBoundBytes,
        UncertainExternalEgressBytes: receipt.UncertainExternalEgressBytes,
        ActionTokenSha256: receipt.ActionTokenSha256,
        EgressEvidence: receipt.EgressEvidence,
        LeaseId: request.LeaseId,
        FencingToken: request.FencingToken,
        LeaseExpiresAt: request.LeaseExpiresAt);
    if (stored is null)
    {
      await _resultStore.StoreAsync(
        request,
        replayResult,
        receipt.MaximumExternalEgressBytes,
        CancellationToken.None).ConfigureAwait(false);
    }
    var journaledReplay = BindJournaledReplay(request, replayResult, receipt);
    await SendJournaledResultSafelyAsync(request, journaledReplay, receipt)
      .ConfigureAwait(false);
  }

  private static ActionResult BindJournaledReplay(
    ActionRequest request,
    ActionResult replayResult,
    JournalTerminalReceipt receipt) => replayResult with
    {
      IsIdempotentReplay = true,
      JournalPrepareSequence = receipt.JournalPrepareSequence,
      JournalPrepareEntryHash = receipt.JournalPrepareEntryHash,
      JournalPreparePreviousHash = receipt.JournalPreparePreviousHash,
      JournalSequence = receipt.JournalSequence,
      JournalEntryHash = receipt.JournalEntryHash,
      JournalPreviousHash = receipt.JournalPreviousHash,
      JournalRecoveryPreparedSequence = receipt.JournalRecoveryPreparedSequence,
      JournalRecoveryPreparedEntryHash = receipt.JournalRecoveryPreparedEntryHash,
      JournalRecoveryPreparedPreviousHash =
      receipt.JournalRecoveryPreparedPreviousHash,
      PreStateSha256 = receipt.PreStateSha256,
      RecoveryProvenanceSha256 = receipt.RecoveryProvenanceSha256,
      RecoveryHandleSha256 = receipt.RecoveryHandleSha256,
      LeaseId = request.LeaseId,
      FencingToken = request.FencingToken,
      LeaseExpiresAt = request.LeaseExpiresAt,
    };

  private async Task CompleteKnownFailureAsync(
    ActionRequest request,
    ActionOutcome outcome,
    string errorCode,
    bool mutationCommitted,
    bool outcomeUncertain,
    ActionBudget budgets,
    long localBytesRead = 0,
    long localBytesWritten = 0,
    long externalEgressBytes = 0,
    long uncertainExternalEgressBytes = 0,
    string? preStateSha256 = null,
    string? recoveryProvenanceSha256 = null,
    string? recoveryHandleSha256 = null,
    string? actionTokenSha256 = null,
    EgressExecutionEvidence? egressEvidence = null)
  {
    errorCode = BrokerSafeErrorCode(errorCode);
    var result = CreateResult(
      request,
      outcome,
      mutationCommitted: mutationCommitted,
      outcomeUncertain: outcomeUncertain,
      errorCode: errorCode,
      localBytesRead: localBytesRead,
      localBytesWritten: localBytesWritten,
      externalEgressBytes: externalEgressBytes,
      uncertainExternalEgressBytes: uncertainExternalEgressBytes,
      preStateSha256: preStateSha256 ?? request.ExpectedPreStateSha256,
      recoveryProvenanceSha256: recoveryProvenanceSha256,
      recoveryHandleSha256: recoveryHandleSha256,
      actionTokenSha256: actionTokenSha256,
      egressEvidence: egressEvidence);
    var chargeUnknownReservation = outcomeUncertain
      && uncertainExternalEgressBytes > 0
      && egressEvidence is null;
    if (chargeUnknownReservation)
    {
      result = result with { UncertainExternalEgressBytes = long.MaxValue };
    }
    if (!TryPrepayBrokerResult(result, budgets, out var prepaidResult))
    {
      throw new InvalidOperationException("The minimal terminal result exceeds its broker reservation.");
    }
    if (chargeUnknownReservation)
    {
      if (externalEgressBytes > budgets.MaxExternalEgressBytes
        || prepaidResult.BrokerExternalEgressBytes
          > budgets.MaxExternalEgressBytes - externalEgressBytes)
      {
        throw new InvalidOperationException("Unknown egress cannot fit its verified reservation.");
      }
      prepaidResult = prepaidResult with
      {
        UncertainExternalEgressBytes = budgets.MaxExternalEgressBytes
          - externalEgressBytes
          - prepaidResult.BrokerExternalEgressBytes,
      };
    }
    await PersistAndSendAsync(request, prepaidResult, budgets.MaxExternalEgressBytes)
      .ConfigureAwait(false);
  }

  private async Task PersistAndSendAsync(
    ActionRequest request,
    ActionResult result,
    long maximumExternalEgressBytes)
  {
    var kind = result.Outcome switch
    {
      ActionOutcome.Completed => JournalEntryKind.Completed,
      ActionOutcome.Cancelled => JournalEntryKind.Cancelled,
      ActionOutcome.NeedsAttention => JournalEntryKind.NeedsAttention,
      ActionOutcome.Rejected => JournalEntryKind.Rejected,
      _ => JournalEntryKind.Failed,
    };
    try
    {
      await _resultStore.StoreAsync(
        request,
        result,
        maximumExternalEgressBytes,
        CancellationToken.None)
        .ConfigureAwait(false);
      var receipt = await _journal.AppendTerminalAsync(
        request,
        result,
        kind,
        CancellationToken.None).ConfigureAwait(false);
      var journaledResult = result with
      {
        JournalPrepareSequence = receipt.JournalPrepareSequence,
        JournalPrepareEntryHash = receipt.JournalPrepareEntryHash,
        JournalPreparePreviousHash = receipt.JournalPreparePreviousHash,
        JournalSequence = receipt.JournalSequence,
        JournalEntryHash = receipt.JournalEntryHash,
        JournalPreviousHash = receipt.JournalPreviousHash,
        JournalRecoveryPreparedSequence = receipt.JournalRecoveryPreparedSequence,
        JournalRecoveryPreparedEntryHash = receipt.JournalRecoveryPreparedEntryHash,
        JournalRecoveryPreparedPreviousHash =
          receipt.JournalRecoveryPreparedPreviousHash,
        PreStateSha256 = receipt.PreStateSha256,
        RecoveryProvenanceSha256 = receipt.RecoveryProvenanceSha256,
        RecoveryHandleSha256 = receipt.RecoveryHandleSha256,
      };
      if (result.PreStateSha256 != receipt.PreStateSha256
        || result.RecoveryProvenanceSha256 != receipt.RecoveryProvenanceSha256
        || result.RecoveryHandleSha256 != receipt.RecoveryHandleSha256)
      {
        // The result cache is intentionally written before the terminal journal
        // so raw output is not lost on a terminal-append crash. If the journal
        // authoritatively merged a recovery checkpoint, overwrite that cache
        // before delivery so replay and broker projection retain its digests.
        await _resultStore.StoreAsync(
          request,
          journaledResult,
          maximumExternalEgressBytes,
          CancellationToken.None).ConfigureAwait(false);
      }
      await SendJournaledResultSafelyAsync(request, journaledResult, receipt)
        .ConfigureAwait(false);
    }
    catch (TerminalPersistenceException)
    {
      throw;
    }
    catch (Exception exception)
    {
      throw new TerminalPersistenceException(exception);
    }
  }

  private static bool TryPrepayBrokerResult(
    ActionResult result,
    ActionBudget budgets,
    out ActionResult prepaidResult)
  {
    prepaidResult = result;
    var reservation = BrokerReservationBytes(budgets);
    if (reservation is null
      || CompanionWireJson.ResultUpperBoundBytes(result)
        > budgets.BrokerSerializedResultUpperBoundBytes)
    {
      return false;
    }
    prepaidResult = result with
    {
      BrokerExternalEgressBytes = reservation.Value,
      BrokerMaxDeliverySessions = budgets.BrokerMaxDeliverySessions,
      BrokerMaxRequestAttemptsPerSession = budgets.BrokerMaxRequestAttemptsPerSession,
      BrokerSerializedResultUpperBoundBytes = budgets.BrokerSerializedResultUpperBoundBytes,
    };
    return true;
  }

  private static long? BrokerReservationBytes(ActionBudget budgets)
  {
    try
    {
      var reservation = checked(
        budgets.BrokerSerializedResultUpperBoundBytes
        * budgets.BrokerMaxRequestAttemptsPerSession
        * budgets.BrokerMaxDeliverySessions);
      return reservation > 0 ? reservation : null;
    }
    catch (OverflowException)
    {
      return null;
    }
  }

  private async ValueTask<IDisposable> AcquireJournalActionAsync(
    CancellationToken cancellationToken)
  {
    await _journalActionGate.WaitAsync(cancellationToken).ConfigureAwait(false);
    return new SemaphoreLease(_journalActionGate);
  }

  private async Task<ActionProgressAcknowledgement?> SendProgressSafelyAsync(
    ActionRequest request,
    ActionProgressState state,
    string messageCode,
    JournalRecord? preparedRecord = null,
    CancellationToken cancellationToken = default)
  {
    messageCode = BrokerSafeErrorCode(messageCode);
    try
    {
      return await _channel.SendProgressAsync(new ActionProgress(
        request.ActionId,
        request.TaskId,
        request.StepId,
        state,
        state == ActionProgressState.Completed ? 100 : 0,
        messageCode,
        request.DispatchCount,
        DateTimeOffset.UtcNow,
        request.LeaseId,
        request.FencingToken,
        request.LeaseExpiresAt,
        preparedRecord?.Sequence,
        preparedRecord?.PreviousHash,
        preparedRecord?.EntryHash), cancellationToken).ConfigureAwait(false);
    }
    catch (Exception exception)
    {
      LogProgressSendFailure(
        _logger,
        request.ActionId,
        exception.GetType().Name,
        exception);
      return null;
    }
  }

  private async Task RunLeaseHeartbeatAsync(
    ActionRequest request,
    bool requireCentralLedger,
    JournalRecord preparedRecord,
    CancellationTokenSource actionCancellation,
    CancellationToken cancellationToken)
  {
    using var timer = new PeriodicTimer(_leaseHeartbeatInterval);
    while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
    {
      using var deliveryDeadline = CancellationTokenSource.CreateLinkedTokenSource(
        cancellationToken);
      deliveryDeadline.CancelAfter(_leaseHeartbeatInterval);
      var delivered = await SendProgressSafelyAsync(
        request,
        ActionProgressState.Started,
        "lease_heartbeat",
        preparedRecord,
        deliveryDeadline.Token).ConfigureAwait(false);
      if (requireCentralLedger
        && (!ExactPreparedAcknowledgement(delivered, request, preparedRecord)
          || !_channel.IsCentralLedgerConnected))
      {
        // A privileged action may not continue merely because it was connected
        // when it started. Cancellation is cooperative, and its terminal
        // disposition is conservative because the write outcome may already be
        // uncertain when connectivity is lost.
        actionCancellation.Cancel();
        return;
      }
    }
  }

  private static bool ExactPreparedAcknowledgement(
    ActionProgressAcknowledgement? acknowledgement,
    ActionRequest request,
    JournalRecord preparedRecord) => acknowledgement is
    {
      Accepted: true,
      ActionId: not null,
      DispatchCount: not null,
      JournalPrepareSequence: not null,
      JournalPreparePreviousHash: not null,
      JournalPrepareEntryHash: not null,
    }
    && string.Equals(acknowledgement.ActionId, request.ActionId, StringComparison.Ordinal)
    && acknowledgement.DispatchCount == request.DispatchCount
    && acknowledgement.JournalPrepareSequence == preparedRecord.Sequence
    && PayloadDigest.FixedTimeEqualsHex(
      acknowledgement.JournalPreparePreviousHash,
      preparedRecord.PreviousHash)
    && PayloadDigest.FixedTimeEqualsHex(
      acknowledgement.JournalPrepareEntryHash,
      preparedRecord.EntryHash);

  private async ValueTask<EgressExecutionEvidence> AbortEgressBeforeAdapterAsync(
    IEgressBoundarySession session,
    EgressActionBinding binding,
    IReadOnlyList<string> requiredFeatures,
    string actionId,
    CancellationToken cancellationToken)
  {
    var disposition = new EgressTerminalDispositionV1(
      EgressSupervisorLifecycleContract.Version,
      EgressSupervisorLifecycleCanonical.OperationId(actionId, "abort-before-adapter"),
      EgressSupervisorLifecycleContract.Failed,
      ReportedExternalEgressBytes: 0,
      OutcomeUncertain: false,
      OccurredAtUnixMilliseconds: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    var signedReceipt = await session.TryAbortAsync(
      disposition,
      cancellationToken).ConfigureAwait(false);
    if (signedReceipt is null)
    {
      _egressDispatchLatch.Trip();
      throw new EgressBoundaryUnsafeException(
        "egress_abort_receipt_missing",
        mayHaveExecuted: false);
    }

    var evidence = new EgressExecutionEvidence(session.Authorization, signedReceipt);
    var verified = await _egressEvidence.VerifyAndCommitReceiptAsync(
      evidence,
      binding,
      requiredFeatures,
      cancellationToken).ConfigureAwait(false);
    if (!verified.IsValid
      || verified.Value is null
      || !PayloadDigest.FixedTimeEqualsHex(
        verified.Value.Evidence.Receipt.Receipt.RegistrationSha256,
        EgressSupervisorLifecycleCanonical.ZeroSha256)
      || !PayloadDigest.FixedTimeEqualsHex(
        verified.Value.Evidence.Receipt.Receipt.DispositionSha256,
        EgressSupervisorLifecycleCanonical.DispositionSha256(disposition))
      || verified.Value.Evidence.Receipt.Receipt.MeasuredExternalEgressBytes != 0
      || verified.Value.Evidence.Receipt.Receipt.UncertainExternalEgressBytes != 0
      || verified.Value.Evidence.Receipt.Receipt.ChargedExternalEgressBytes != 0
      || !string.Equals(
        verified.Value.Evidence.Receipt.Receipt.Outcome,
        EgressSupervisorLifecycleContract.Failed,
        StringComparison.Ordinal))
    {
      _egressDispatchLatch.Trip();
      throw new EgressBoundaryUnsafeException(
        verified.ErrorCode ?? "egress_abort_receipt_invalid",
        mayHaveExecuted: true);
    }
    return evidence;
  }

  private async ValueTask<EgressFailureResolution> ResolveEgressFailureAsync(
    IEgressBoundarySession? session,
    EgressActionBinding? binding,
    IReadOnlyList<string>? requiredFeatures,
    EgressExecutionEvidence? existingEvidence,
    string actionId,
    string preEffectOutcome,
    string purpose)
  {
    if (requiredFeatures is null)
    {
      return existingEvidence is null
        ? EgressFailureResolution.NotApplicable
        : new EgressFailureResolution(
          true,
          existingEvidence,
          existingEvidence.Receipt.Receipt.MeasuredExternalEgressBytes,
          existingEvidence.Receipt.Receipt.UncertainExternalEgressBytes,
          existingEvidence.Receipt.Receipt.UncertainExternalEgressBytes > 0
            || string.Equals(
              existingEvidence.Receipt.Receipt.Outcome,
              EgressSupervisorLifecycleContract.Unknown,
              StringComparison.Ordinal),
          null);
    }
    if (session is null || binding is null)
    {
      return EgressFailureResolution.Unresolved("egress_session_unavailable_for_abort");
    }

    try
    {
      var terminalAlreadyExisted = existingEvidence is not null || session.IsTerminal;
      EgressTerminalDispositionV1? requestedDisposition = null;
      SignedEgressReceipt? signedReceipt;
      if (existingEvidence is not null)
      {
        signedReceipt = existingEvidence.Receipt;
      }
      else if (session.IsTerminal)
      {
        signedReceipt = session.TerminalReceipt;
      }
      else
      {
        var registered = session.HasRegistration;
        var outcome = registered
          ? EgressSupervisorLifecycleContract.Unknown
          : preEffectOutcome;
        var operationPurpose = registered
          ? $"abort-unknown:{purpose}"
          : $"abort-before-effect:{purpose}";
        var disposition = new EgressTerminalDispositionV1(
          EgressSupervisorLifecycleContract.Version,
          EgressSupervisorLifecycleCanonical.OperationId(actionId, operationPurpose),
          outcome,
          ReportedExternalEgressBytes: 0,
          OutcomeUncertain: registered,
          OccurredAtUnixMilliseconds: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        requestedDisposition = disposition;
        signedReceipt = await session.TryAbortAsync(
          disposition,
          CancellationToken.None).ConfigureAwait(false);
      }

      if (signedReceipt is null)
      {
        return EgressFailureResolution.Unresolved("egress_abort_receipt_missing");
      }

      var evidence = existingEvidence
        ?? new EgressExecutionEvidence(session.Authorization, signedReceipt);
      var verified = await _egressEvidence.VerifyAndCommitReceiptAsync(
        evidence,
        binding,
        requiredFeatures,
        CancellationToken.None).ConfigureAwait(false);
      if (!verified.IsValid || verified.Value is null)
      {
        return EgressFailureResolution.Unresolved(
          verified.ErrorCode ?? "egress_abort_receipt_invalid");
      }

      var receipt = verified.Value.Evidence.Receipt.Receipt;
      var registeredBoundary = session.HasRegistration;
      if (requestedDisposition is not null
        && (!PayloadDigest.FixedTimeEqualsHex(
            receipt.DispositionSha256,
            EgressSupervisorLifecycleCanonical.DispositionSha256(requestedDisposition))
          || !string.Equals(
            receipt.Outcome,
            requestedDisposition.Outcome,
            StringComparison.Ordinal)
          || registeredBoundary == PayloadDigest.FixedTimeEqualsHex(
            receipt.RegistrationSha256,
            EgressSupervisorLifecycleCanonical.ZeroSha256)))
      {
        return EgressFailureResolution.Unresolved(
          "egress_abort_disposition_mismatch");
      }
      if (!terminalAlreadyExisted && registeredBoundary)
      {
        if (!string.Equals(
            receipt.Outcome,
            EgressSupervisorLifecycleContract.Unknown,
            StringComparison.Ordinal)
          || receipt.ChargedExternalEgressBytes
            != receipt.ReservedCapabilityEgressBytes)
        {
          return EgressFailureResolution.Unresolved(
            "egress_unknown_abort_receipt_invalid");
        }
      }
      else if (!terminalAlreadyExisted
        && (receipt.MeasuredExternalEgressBytes != 0
        || receipt.UncertainExternalEgressBytes != 0
        || !string.Equals(receipt.Outcome, preEffectOutcome, StringComparison.Ordinal)))
      {
        return EgressFailureResolution.Unresolved(
          "egress_pre_effect_abort_receipt_invalid");
      }

      return new EgressFailureResolution(
        true,
        verified.Value.Evidence,
        receipt.MeasuredExternalEgressBytes,
        receipt.UncertainExternalEgressBytes,
        receipt.UncertainExternalEgressBytes > 0
          || string.Equals(
            receipt.Outcome,
            EgressSupervisorLifecycleContract.Unknown,
            StringComparison.Ordinal),
        null);
    }
    catch (Exception exception) when (exception is not TerminalPersistenceException)
    {
      return EgressFailureResolution.Unresolved(
        $"egress_abort_{exception.GetType().Name.ToLowerInvariant()}");
    }
  }

  private sealed record EgressFailureResolution(
    bool IsResolved,
    EgressExecutionEvidence? Evidence,
    long MeasuredExternalEgressBytes,
    long UncertainExternalEgressBytes,
    bool OutcomeUncertain,
    string? ErrorCode)
  {
    public static EgressFailureResolution NotApplicable { get; } = new(
      true,
      null,
      0,
      0,
      false,
      null);

    public static EgressFailureResolution Unresolved(string errorCode) => new(
      false,
      null,
      0,
      0,
      true,
      errorCode);
  }

  private async Task SendJournaledResultSafelyAsync(
    ActionRequest request,
    ActionResult result,
    JournalTerminalReceipt receipt)
  {
    try
    {
      var allowed = await _resultStore.TryBeginDeliverySessionAsync(
        request,
        receipt,
        _options.MaxResultDeliverySessions,
        CancellationToken.None).ConfigureAwait(false);
      if (!allowed)
      {
        throw new InvalidOperationException(
          "The prepaid result-delivery session allowance is exhausted or untrusted.");
      }
      await _channel.SendResultAsync(result, CancellationToken.None).ConfigureAwait(false);
    }
    catch (Exception exception)
    {
      LogResultSendFailure(
        _logger,
        result.ActionId,
        exception.GetType().Name,
        exception);
    }
  }

  private static ActionResult CreateResult(
    ActionRequest request,
    ActionOutcome outcome,
    string? outputJson = null,
    string? outputSha256 = null,
    bool mutationCommitted = false,
    bool outcomeUncertain = false,
    string? errorCode = null,
    IReadOnlyList<DataProvenance>? provenance = null,
    string? preStateSha256 = null,
    string? recoveryProvenanceSha256 = null,
    string? recoveryHandleSha256 = null,
    long localBytesRead = 0,
    long localBytesWritten = 0,
    long externalEgressBytes = 0,
    long brokerExternalEgressBytes = 0,
    long uncertainExternalEgressBytes = 0,
    string? actionTokenSha256 = null,
    EgressExecutionEvidence? egressEvidence = null) => new(
      ActionId: request.ActionId,
      TaskId: request.TaskId,
      StepId: request.StepId,
      Outcome: outcome,
      OutputJson: outputJson,
      OutputSha256: outputSha256,
      MutationCommitted: mutationCommitted,
      OutcomeUncertain: outcomeUncertain,
      IsIdempotentReplay: false,
      ErrorCode: errorCode,
      Provenance: provenance ?? [],
      JournalPrepareSequence: null,
      JournalPrepareEntryHash: null,
      JournalPreparePreviousHash: null,
      JournalSequence: null,
      JournalEntryHash: null,
      JournalPreviousHash: null,
      PreStateSha256: preStateSha256,
      RecoveryProvenanceSha256: recoveryProvenanceSha256,
      RecoveryHandleSha256: recoveryHandleSha256,
      LocalBytesRead: localBytesRead,
      LocalBytesWritten: localBytesWritten,
      ExternalEgressBytes: externalEgressBytes,
      BrokerExternalEgressBytes: brokerExternalEgressBytes,
      UncertainExternalEgressBytes: uncertainExternalEgressBytes,
      ActionTokenSha256: actionTokenSha256,
      EgressEvidence: egressEvidence,
      LeaseId: request.LeaseId,
      FencingToken: request.FencingToken,
      LeaseExpiresAt: request.LeaseExpiresAt);

  private static string BrokerSafeErrorCode(string value) =>
    CompanionWireContract.IsSafeIdentifier(value)
      ? value
      : "device_error_code_invalid";

  /// <summary>
  /// Derives a LocalSystem-owned egress floor from the already token-bound
  /// argument bytes. The standard-user process may report more, but it cannot
  /// lower this amount or substitute a different task/device artifact scope.
  /// </summary>
  internal static long ConservativeEgressFloor(
    CapabilityDescriptor descriptor,
    ActionExecutionContext context,
    JsonElement arguments)
  {
    if (!string.Equals(descriptor.Id, "browser.file.upload", StringComparison.Ordinal)
      || !arguments.TryGetProperty("artifact", out var artifactValue))
    {
      return 0;
    }

    if (!GovernedArtifactEnvelope.TryDecode(
        artifactValue,
        context,
        requiredKind: "SCREENSHOT",
        out var artifact,
        out var content))
    {
      throw new HostPreconditionException("browser_artifact_envelope_scope_invalid");
    }
    try
    {
      return artifact.ByteSize;
    }
    finally
    {
      CryptographicOperations.ZeroMemory(content);
    }
  }

  internal static bool RequiresEgressBoundary(string capabilityId) =>
    StandardUserCapabilityCatalog.RequiresEgressBoundary(capabilityId)
    || string.Equals(
      capabilityId,
      PrivilegedCommandExecuteCapabilityAdapter.CapabilityId,
      StringComparison.Ordinal)
    || string.Equals(
      capabilityId,
      OwnedProcessLaunchCapabilityAdapter.CapabilityId,
      StringComparison.Ordinal)
    || string.Equals(
      capabilityId,
      MsiSoftwareInstallCapabilityAdapter.CapabilityId,
      StringComparison.Ordinal)
    || string.Equals(
      capabilityId,
      MsiSoftwareUninstallCapabilityAdapter.CapabilityId,
      StringComparison.Ordinal)
    || string.Equals(
      capabilityId,
      ScheduledTaskRunCapabilityAdapter.CapabilityId,
      StringComparison.Ordinal)
    || string.Equals(
      capabilityId,
      WindowsServiceStartCapabilityAdapter.CapabilityId,
      StringComparison.Ordinal)
    || ExternalActionCapabilityCatalog.All.Any(descriptor =>
      string.Equals(descriptor.Id, capabilityId, StringComparison.Ordinal));

  internal static IReadOnlyList<string> RequiredBoundaryFeatures(string capabilityId) =>
    StandardUserCapabilityCatalog.RequiresEgressBoundary(capabilityId)
      ? StandardUserCapabilityCatalog.RequiredBoundaryFeatures(capabilityId)
      : string.Equals(
          capabilityId,
          PrivilegedCommandExecuteCapabilityAdapter.CapabilityId,
          StringComparison.Ordinal)
        || string.Equals(
          capabilityId,
          OwnedProcessLaunchCapabilityAdapter.CapabilityId,
          StringComparison.Ordinal)
        || string.Equals(
          capabilityId,
          MsiSoftwareInstallCapabilityAdapter.CapabilityId,
          StringComparison.Ordinal)
        || string.Equals(
          capabilityId,
          MsiSoftwareUninstallCapabilityAdapter.CapabilityId,
          StringComparison.Ordinal)
        || string.Equals(
          capabilityId,
          ScheduledTaskRunCapabilityAdapter.CapabilityId,
          StringComparison.Ordinal)
        || string.Equals(
          capabilityId,
          WindowsServiceStartCapabilityAdapter.CapabilityId,
          StringComparison.Ordinal)
        || ExternalActionCapabilityCatalog.All.Any(descriptor =>
          string.Equals(descriptor.Id, capabilityId, StringComparison.Ordinal))
          ? EgressBoundaryFeatures.CommandRequired
          : Array.Empty<string>();

  private static string? ValidDigestOrNull(string? value) =>
    value is not null && PayloadDigest.IsSha256Hex(value) ? value : null;

  private sealed class SemaphoreLease(SemaphoreSlim semaphore) : IDisposable
  {
    private int _released;

    public void Dispose()
    {
      if (Interlocked.Exchange(ref _released, 1) == 0)
      {
        semaphore.Release();
      }
    }
  }

  private sealed record RunningAction(
    string TaskId,
    string LeaseId,
    string FencingToken,
    CancellationTokenSource Cancellation);

  private sealed class TerminalPersistenceException(Exception innerException) :
    Exception("Terminal result persistence failed; restart reconciliation is required.", innerException);
}
