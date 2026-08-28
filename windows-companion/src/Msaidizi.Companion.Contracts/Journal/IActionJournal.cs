using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Contracts.Journal;

public enum JournalEntryKind
{
  Prepared = 0,
  Completed = 1,
  Rejected = 2,
  Cancelled = 3,
  Failed = 4,
  NeedsAttention = 5,
  // Append only. Numeric values are persisted in signed/hash-chained material.
  RecoveryPrepared = 6,
  ActionFenced = 7,
  ChainUpgraded = 8,
}

public sealed record JournalHead(long Sequence, string EntryHash);

public sealed record JournalRecord(
  long Sequence,
  DateTimeOffset OccurredAt,
  JournalEntryKind Kind,
  string ActionId,
  string IdempotencyKey,
  string PreviousHash,
  string PayloadSha256,
  string EntryHash,
  int HashVersion = 2);

/// <summary>
/// A verified, bounded view of the digest-only journal chain. The predecessor
/// and terminal heads make the range independently checkable without exposing
/// persisted payload JSON, arguments, output, credentials, or recovery data.
/// </summary>
public sealed record JournalRecordRange(
  JournalHead StartingPredecessor,
  IReadOnlyList<JournalRecord> Entries,
  JournalHead FinalHead,
  JournalHead LocalHead);

public static class JournalReconciliationContract
{
  public const int MaximumEntriesPerRange = 128;
}

public sealed record JournalCentralHeadRequest(string DeviceId);

public sealed record JournalCentralHead(
  string DeviceId,
  long Sequence,
  int HashVersion,
  string EntryHash);

public sealed record JournalReconciliationRequest(
  string DeviceId,
  long StartingPreviousSequence,
  string StartingPreviousHash,
  IReadOnlyList<JournalRecord> Entries,
  long FinalSequence,
  string FinalHash,
  long LocalHeadSequence,
  string LocalHeadHash);

public sealed record JournalReconciliationAcknowledgement(
  bool Accepted,
  string DeviceId,
  long StartingPreviousSequence,
  string StartingPreviousHash,
  long AcceptedThroughSequence,
  string AcceptedThroughHash,
  long LocalHeadSequence,
  string LocalHeadHash,
  bool ExactHead);

public sealed record JournalTerminalReceipt(
  string ActionId,
  string TaskId,
  string StepId,
  string RequestSha256,
  ActionOutcome Outcome,
  string? OutputSha256,
  bool MutationCommitted,
  bool OutcomeUncertain,
  string? ErrorCode,
  long JournalPrepareSequence,
  string JournalPrepareEntryHash,
  string JournalPreparePreviousHash,
  long JournalSequence,
  string JournalEntryHash,
  string JournalPreviousHash,
  string? PreStateSha256 = null,
  string? RecoveryProvenanceSha256 = null,
  string? RecoveryHandleSha256 = null,
  long LocalBytesRead = 0,
  long LocalBytesWritten = 0,
  long ExternalEgressBytes = 0,
  long BrokerExternalEgressBytes = 0,
  long UncertainExternalEgressBytes = 0,
  long MaximumExternalEgressBytes = 0,
  int BrokerMaxDeliverySessions = 0,
  int BrokerMaxRequestAttemptsPerSession = 0,
  long BrokerSerializedResultUpperBoundBytes = 0,
  IReadOnlyList<DataProvenance>? Provenance = null,
  string? ActionTokenSha256 = null,
  string? EgressEvidenceSha256 = null,
  EgressExecutionEvidence? EgressEvidence = null,
  long? JournalRecoveryPreparedSequence = null,
  string? JournalRecoveryPreparedEntryHash = null,
  string? JournalRecoveryPreparedPreviousHash = null);

public enum JournalBeginDisposition
{
  Started,
  AlreadyRunning,
  TerminalReplay,
  IdempotencyConflict,
  JournalBusy,
  Fenced,
}

public sealed record JournalBeginResult(
  JournalBeginDisposition Disposition,
  JournalRecord? PreparedRecord,
  JournalTerminalReceipt? TerminalReceipt);

/// <summary>
/// Digest-only durable proof that the protected recovery record exists before
/// a reversible host effect. Raw vault handles, paths, and recovery content are
/// forbidden here.
/// </summary>
public sealed record JournalRecoveryPreparedCheckpoint(
  string ActionId,
  string IdempotencyKey,
  string TaskId,
  string PlanVersionId,
  string StepId,
  string DeviceId,
  string MandateId,
  string PreStateSha256,
  string RecoveryProvenanceSha256,
  string RecoveryHandleSha256);

public enum JournalFenceDisposition
{
  FencedNoPrepared,
  AlreadyFencedNoPrepared,
  ActionAlreadyPrepared,
  JournalPredecessorMismatch,
  FenceConflict,
}

public sealed record JournalFenceResult(
  JournalFenceDisposition Disposition,
  JournalRecord? TombstoneRecord);

public sealed record JournalVerificationResult(
  bool IsValid,
  long RecordsChecked,
  long? InvalidSequence,
  string? ErrorCode);

/// <summary>
/// Append-only local journal. Implementations persist digests and outcome
/// receipts only; raw action arguments, credentials, and raw tool output are
/// forbidden journal content.
/// </summary>
public interface IActionJournal
{
  ValueTask InitializeAsync(CancellationToken cancellationToken);

  ValueTask<JournalBeginResult> TryBeginAsync(
    ActionRequest request,
    string compactTokenSha256,
    long maximumExternalEgressBytes,
    long reservedBrokerExternalEgressBytes,
    int brokerMaxDeliverySessions,
    int brokerMaxRequestAttemptsPerSession,
    long brokerSerializedResultUpperBoundBytes,
    CancellationToken cancellationToken);

  /// <summary>
  /// Finds an already verified terminal receipt for the exact host-action
  /// identity without creating a Prepared record or changing journal state.
  /// The delivery execution mode is deliberately not part of the persisted
  /// host-action identity, allowing a separately authorized replay command to
  /// retrieve the terminal produced by the original execute command.
  /// </summary>
  ValueTask<JournalTerminalReceipt?> TryGetTerminalAsync(
    ActionRequest request,
    CancellationToken cancellationToken);

  /// <summary>
  /// Persists a stable old-lease tombstone only while the journal still equals
  /// the broker-pinned predecessor and no Prepared record exists for the action.
  /// Delivery-generation token material is intentionally not persisted.
  /// </summary>
  ValueTask<JournalFenceResult> TryFenceAsync(
    FenceActionRequest request,
    CancellationToken cancellationToken) =>
    ValueTask.FromResult(new JournalFenceResult(
      JournalFenceDisposition.FenceConflict,
      null));

  /// <summary>
  /// Rechecks the durable monotonic device fence immediately before adapter
  /// entry. A true result permanently forbids this request from beginning.
  /// </summary>
  ValueTask<bool> IsFencedAsync(
    ActionRequest request,
    CancellationToken cancellationToken) => ValueTask.FromResult(true);

  ValueTask<JournalRecord> AppendRecoveryPreparedAsync(
    JournalRecoveryPreparedCheckpoint checkpoint,
    CancellationToken cancellationToken);

  ValueTask<JournalTerminalReceipt> AppendTerminalAsync(
    ActionRequest request,
    ActionResult result,
    JournalEntryKind kind,
    CancellationToken cancellationToken);

  ValueTask<JournalHead> GetHeadAsync(CancellationToken cancellationToken);

  ValueTask<JournalRecordRange> ReadRangeAsync(
    long afterSequence,
    int maximumEntries,
    CancellationToken cancellationToken) =>
    ValueTask.FromException<JournalRecordRange>(
      new NotSupportedException("The journal does not expose reconciliation ranges."));

  ValueTask<JournalVerificationResult> VerifyAsync(CancellationToken cancellationToken);
}
