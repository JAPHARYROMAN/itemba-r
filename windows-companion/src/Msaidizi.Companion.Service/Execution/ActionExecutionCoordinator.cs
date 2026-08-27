using System.Collections.Concurrent;
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
        CancellationToken.None)
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
      try
      {
        await _concurrencyGate.WaitAsync(actionCancellation.Token).ConfigureAwait(false);
        enteredConcurrencyGate = true;
        // The gate is intentionally checked only after this action owns the
        // single execution slot. An earlier check could race with the preceding
        // privileged command tripping the fuse while this action waited.
        _isolationDispatchLatch.ThrowIfTripped();
        var startedAcknowledged = await SendProgressSafelyAsync(
          request,
          ActionProgressState.Started,
          "action_started",
          CancellationToken.None)
          .ConfigureAwait(false);
        if (adapter.Descriptor.IsMutation
          && (!startedAcknowledged || !_channel.IsCentralLedgerConnected))
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
          actionCancellation,
          leaseHeartbeatCancellation.Token);

        var egressBinding = new EgressActionBinding(
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
          _options.EgressExecutionIdentitySha256);
        EgressExecutionAuthorization? egressAuthorization = null;
        if (requiresEgressBoundary)
        {
          egressAuthorization = await _egressBoundary.TryAcquireAuthorizationAsync(
            signedAction.CompactToken,
            egressBinding,
            actionCancellation.Token).ConfigureAwait(false);
          var authorizationVerification = egressAuthorization is null
            ? EgressVerificationResult.Invalid<VerifiedEgressAuthorization>(
              "egress_boundary_unavailable")
            : _egressEvidence.VerifyAuthorization(
              egressAuthorization,
              egressBinding,
              RequiredBoundaryFeatures(adapter.Descriptor.Id));
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
          _options.EgressExecutionIdentitySha256);
        if (await _journal.IsFencedAsync(request, actionCancellation.Token)
          .ConfigureAwait(false))
        {
          await CompleteKnownFailureAsync(
            request,
            ActionOutcome.Failed,
            "action_fenced_before_adapter",
            mutationCommitted: false,
            outcomeUncertain: false,
            budgets: claims.Budgets,
            actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
          return;
        }
        var executed = await adapter.ExecuteAsync(
          executionContext,
          argumentsDocument.RootElement,
          actionCancellation.Token).ConfigureAwait(false);

        EgressExecutionEvidence? egressEvidence = null;
        long receiptUncertainEgressBytes = 0;
        var receiptOutcomeUncertain = false;
        if (requiresEgressBoundary)
        {
          if (egressAuthorization is null || executed.EgressReceipt is null)
          {
            await CompleteKnownFailureAsync(
              request,
              ActionOutcome.NeedsAttention,
              "egress_receipt_missing",
              mutationCommitted: executed.MutationCommitted,
              outcomeUncertain: true,
              budgets: claims.Budgets,
              localBytesRead: Math.Max(0, executed.LocalBytesRead),
              localBytesWritten: Math.Max(0, executed.LocalBytesWritten),
              uncertainExternalEgressBytes: capabilityBudgets.MaxExternalEgressBytes,
              preStateSha256: ValidDigestOrNull(executed.PreStateSha256),
              recoveryProvenanceSha256: ValidDigestOrNull(
                executed.RecoveryProvenanceSha256),
              recoveryHandleSha256: executed.OpaqueRecoveryHandle is null
                ? null
                : PayloadDigest.Sha256Hex(executed.OpaqueRecoveryHandle),
              actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
            return;
          }

          egressEvidence = new EgressExecutionEvidence(
            egressAuthorization,
            executed.EgressReceipt);
          var receiptVerification = await _egressEvidence.VerifyAndCommitReceiptAsync(
            egressEvidence,
            egressBinding,
            RequiredBoundaryFeatures(adapter.Descriptor.Id),
            actionCancellation.Token).ConfigureAwait(false);
          if (!receiptVerification.IsValid
            || receiptVerification.Value is null
            || receiptVerification.Value.Evidence.Receipt.Receipt.MeasuredExternalEgressBytes
              != executed.ExternalEgressBytes)
          {
            await CompleteKnownFailureAsync(
              request,
              ActionOutcome.NeedsAttention,
              receiptVerification.IsValid
                ? "egress_receipt_measurement_mismatch"
                : receiptVerification.ErrorCode ?? "egress_receipt_invalid",
              mutationCommitted: executed.MutationCommitted,
              outcomeUncertain: true,
              budgets: claims.Budgets,
              localBytesRead: Math.Max(0, executed.LocalBytesRead),
              localBytesWritten: Math.Max(0, executed.LocalBytesWritten),
              uncertainExternalEgressBytes: capabilityBudgets.MaxExternalEgressBytes,
              preStateSha256: ValidDigestOrNull(executed.PreStateSha256),
              recoveryProvenanceSha256: ValidDigestOrNull(
                executed.RecoveryProvenanceSha256),
              recoveryHandleSha256: executed.OpaqueRecoveryHandle is null
                ? null
                : PayloadDigest.Sha256Hex(executed.OpaqueRecoveryHandle),
              actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
            return;
          }

          var receipt = receiptVerification.Value.Evidence.Receipt.Receipt;
          receiptUncertainEgressBytes = receipt.UncertainExternalEgressBytes;
          receiptOutcomeUncertain = receiptUncertainEgressBytes > 0
            || !string.Equals(receipt.Outcome, "completed", StringComparison.Ordinal);
        }

        if (executed.OutputJson is null
          || executed.ExternalEgressBytes < 0
          || executed.ExternalEgressBytes > capabilityBudgets.MaxExternalEgressBytes
          || executed.Provenance.Count > 100
          || executed.LocalBytesRead < 0
          || executed.LocalBytesWritten < 0
          || executed.LocalBytesRead > claims.Budgets.MaxLocalBytes
          || executed.LocalBytesWritten > claims.Budgets.MaxLocalBytes
          || executed.LocalBytesRead > claims.Budgets.MaxLocalBytes
            - executed.LocalBytesWritten
          || (!requiresEgressBoundary && executed.EgressReceipt is not null)
          || (executed.PreStateSha256 is not null
            && !PayloadDigest.IsSha256Hex(executed.PreStateSha256))
          || (adapter.Descriptor.IsMutation
            && (request.ExpectedPreStateSha256 is null
              || executed.PreStateSha256 is null
              || !PayloadDigest.FixedTimeEqualsHex(
                request.ExpectedPreStateSha256,
                executed.PreStateSha256)))
          || (executed.RecoveryProvenanceSha256 is not null
            && !PayloadDigest.IsSha256Hex(executed.RecoveryProvenanceSha256))
          || executed.Provenance.Any(provenance =>
            !adapter.Descriptor.ProvenanceOutputs.Contains(
              provenance.SourceType,
              StringComparer.Ordinal)
            || !PayloadDigest.IsSha256Hex(provenance.SourceIdentifierHash)
            || !PayloadDigest.IsSha256Hex(provenance.ContentSha256)))
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
            externalEgressBytes: Math.Max(0, executed.ExternalEgressBytes),
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
            externalEgressBytes: executed.ExternalEgressBytes,
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
          externalEgressBytes: executed.ExternalEgressBytes,
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
            externalEgressBytes: executed.ExternalEgressBytes,
            uncertainExternalEgressBytes: requiresEgressBoundary
              ? capabilityBudgets.MaxExternalEgressBytes
              : 0,
            preStateSha256: executed.PreStateSha256,
            recoveryProvenanceSha256: executed.RecoveryProvenanceSha256,
            recoveryHandleSha256: executed.OpaqueRecoveryHandle is null
              ? null
              : PayloadDigest.Sha256Hex(executed.OpaqueRecoveryHandle),
            budgets: claims.Budgets,
            actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
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
      catch (HostPreconditionException exception)
      {
        var egressCouldBeUncertain = requiresEgressBoundary;
        await CompleteKnownFailureAsync(
          request,
          egressCouldBeUncertain ? ActionOutcome.NeedsAttention : ActionOutcome.Failed,
          exception.ErrorCode,
          mutationCommitted: false,
          outcomeUncertain: egressCouldBeUncertain,
          uncertainExternalEgressBytes: egressCouldBeUncertain
            ? capabilityBudgets.MaxExternalEgressBytes
            : 0,
          budgets: claims.Budgets,
          actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
      }
      catch (OperationCanceledException) when (actionCancellation.IsCancellationRequested)
      {
        var writeCouldBeUncertain = adapter.Descriptor.IsMutation;
        await CompleteKnownFailureAsync(
          request,
          ActionOutcome.NeedsAttention,
          writeCouldBeUncertain
            ? "cancelled_write_outcome_unknown"
            : "cancelled_egress_outcome_unknown",
          mutationCommitted: false,
          outcomeUncertain: true,
          uncertainExternalEgressBytes: capabilityBudgets.MaxExternalEgressBytes,
          budgets: claims.Budgets,
          actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
      }
      catch (Exception exception)
      {
        LogCapabilityFailure(
          _logger,
          adapter.Descriptor.Id,
          request.ActionId,
          exception.GetType().Name,
          exception);
        var writeCouldBeUncertain = adapter.Descriptor.IsMutation;
        await CompleteKnownFailureAsync(
          request,
          ActionOutcome.NeedsAttention,
          writeCouldBeUncertain ? "write_outcome_unknown" : "capability_egress_outcome_unknown",
          mutationCommitted: false,
          outcomeUncertain: true,
          uncertainExternalEgressBytes: capabilityBudgets.MaxExternalEgressBytes,
          budgets: claims.Budgets,
          actionTokenSha256: actionTokenSha256).ConfigureAwait(false);
      }
      finally
      {
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

  private async Task<bool> SendProgressSafelyAsync(
    ActionRequest request,
    ActionProgressState state,
    string messageCode,
    CancellationToken cancellationToken = default)
  {
    messageCode = BrokerSafeErrorCode(messageCode);
    try
    {
      await _channel.SendProgressAsync(new ActionProgress(
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
        request.LeaseExpiresAt), cancellationToken).ConfigureAwait(false);
      return true;
    }
    catch (Exception exception)
    {
      LogProgressSendFailure(
        _logger,
        request.ActionId,
        exception.GetType().Name,
        exception);
      return false;
    }
  }

  private async Task RunLeaseHeartbeatAsync(
    ActionRequest request,
    bool requireCentralLedger,
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
        deliveryDeadline.Token).ConfigureAwait(false);
      if (requireCentralLedger && (!delivered || !_channel.IsCentralLedgerConnected))
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
