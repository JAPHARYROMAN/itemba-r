using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Contracts.Commands;

public sealed record ActionBudget(
  long MaxWallTimeSeconds,
  int MaxModelTurns,
  int MaxAttemptedToolCalls,
  int MaxMutations,
  long MaxLocalBytes,
  long MaxExternalEgressBytes,
  decimal MaxModelSpendUsd,
  int BrokerMaxDeliverySessions = 3,
  int BrokerMaxRequestAttemptsPerSession = 3,
  long BrokerSerializedResultUpperBoundBytes = 1_048_576);

public static class ActionExecutionModes
{
  public const string Execute = "EXECUTE";
  public const string ReplayResultOnly = "REPLAY_RESULT_ONLY";

  public static bool IsSupported(string? value) =>
    string.Equals(value, Execute, StringComparison.Ordinal)
    || string.Equals(value, ReplayResultOnly, StringComparison.Ordinal);
}

public static class CompanionCommandProtocol
{
  public const int LegacyVersion = 1;
  public const int ReplayResultOnlyVersion = 2;
  public const int DurableActionFenceVersion = 3;
  public const int CurrentVersion = DurableActionFenceVersion;
}

/// <summary>
/// Text limits shared with the broker DTO contract. Keeping these checks in
/// the contracts assembly prevents a locally accepted result or manifest from
/// becoming permanently undeliverable at the broker boundary.
/// </summary>
public static class CompanionWireContract
{
  public const int MaximumSafeIdentifierLength = 128;
  public const int MaximumProvenanceSourceTypeLength = 120;
  public const int MaximumCapabilityManifestEntries = 500;
  public const int MaximumCapabilityDisplayNameLength = 160;
  public const int MaximumCapabilityDescriptionLength = 1_000;
  public const int MaximumSupportedOperatingSystems = 20;
  public const int MaximumProvenanceOutputs = 100;

  public static bool IsSafeIdentifier(string? value) =>
    value is { Length: >= 1 and <= MaximumSafeIdentifierLength }
    && char.IsAsciiLetterOrDigit(value[0])
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '_' or ':' or '-');

  public static bool IsValidProvenanceSourceType(string? value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= MaximumProvenanceSourceTypeLength;
}

public sealed record ActionRequest(
  string ActionId,
  string TaskId,
  string PlanVersionId,
  string StepId,
  string DeviceId,
  string MandateId,
  string CapabilityId,
  string CapabilityVersion,
  string ArgumentsJsonUtf8,
  string ArgumentsSha256,
  string? ExpectedPreStateSha256,
  string? InputProvenanceSha256,
  string IdempotencyKey,
  int DispatchCount = 1,
  string LeaseId = "",
  string FencingToken = "",
  DateTimeOffset LeaseExpiresAt = default,
  string ExecutionMode = ActionExecutionModes.Execute);

public sealed record SignedActionRequest(ActionRequest Request, string CompactToken);

[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(ExecuteActionCommand), "execute")]
[JsonDerivedType(typeof(ReplayResultCommand), "replay-result")]
[JsonDerivedType(typeof(FenceActionCommand), "fence-action")]
[JsonDerivedType(typeof(CancelActionCommand), "cancel")]
[JsonDerivedType(typeof(PingCommand), "ping")]
public abstract record DeviceCommand;

public sealed record ExecuteActionCommand(SignedActionRequest Action) : DeviceCommand;

public sealed record ReplayResultCommand(SignedActionRequest Action) : DeviceCommand;

public sealed record FenceActionCommand(SignedFenceActionRequest Fence) : DeviceCommand;

public sealed record CancelActionCommand(CancelRequest Request) : DeviceCommand;

public sealed record PingCommand(string CorrelationId, DateTimeOffset SentAt) : DeviceCommand;

public sealed record FenceActionRequest(
  string FenceId,
  string DeviceId,
  string ActionId,
  string TaskId,
  string StepId,
  string OldLeaseId,
  string OldFencingToken,
  string OldActionTokenSha256,
  long JournalPreviousSequence,
  string JournalPreviousHash,
  int DispatchCount,
  DateTimeOffset ExpiresAt);

public sealed record SignedFenceActionRequest(
  FenceActionRequest Request,
  string CompactToken);

public static class ActionFenceOutcomes
{
  public const string NoPrepared = "NoPrepared";
}

/// <summary>
/// Authenticated evidence that the companion durably fenced an old lease while
/// its action journal still matched the broker-pinned predecessor. The compact
/// fence token is echoed for exact immutable dispatch-history verification; it
/// is never written to the local journal.
/// </summary>
public sealed record ActionFencedReceipt(
  string FenceId,
  string DeviceId,
  string ActionId,
  string TaskId,
  string StepId,
  string OldLeaseId,
  string OldFencingToken,
  string OldActionTokenSha256,
  int FenceDispatchCount,
  string CompactToken,
  string FenceTokenSha256,
  string Outcome,
  long JournalPreviousSequence,
  string JournalPreviousHash,
  long TombstoneSequence,
  string TombstonePreviousHash,
  string TombstoneEntryHash,
  DateTimeOffset RecordedAt);

public sealed record CancelRequest(
  string ActionId,
  string TaskId,
  string DeviceId,
  string ReasonCode,
  DateTimeOffset RequestedAt);

public enum ActionProgressState
{
  Accepted,
  Started,
  Cancelling,
  Completed,
  Failed,
  Cancelled,
  NeedsAttention,
  Rejected,
}

public sealed record ActionProgress(
  string ActionId,
  string TaskId,
  string StepId,
  ActionProgressState State,
  int Percent,
  string MessageCode,
  int DispatchCount,
  DateTimeOffset OccurredAt,
  string LeaseId = "",
  string FencingToken = "",
  DateTimeOffset LeaseExpiresAt = default,
  long? JournalPrepareSequence = null,
  string? JournalPreparePreviousHash = null,
  string? JournalPrepareEntryHash = null);

/// <summary>
/// Authenticated broker acknowledgement for an <see cref="ActionProgress"/>.
/// A mutation may enter its adapter only when the Started acknowledgement
/// echoes the exact locally durable Prepared record and dispatch generation.
/// Nullable binding fields make an older/generic peer deserialize safely while
/// still failing the exact-match execution gate.
/// </summary>
public sealed record ActionProgressAcknowledgement(
  bool Accepted,
  string? ActionId = null,
  int? DispatchCount = null,
  long? JournalPrepareSequence = null,
  string? JournalPreparePreviousHash = null,
  string? JournalPrepareEntryHash = null);

public enum ActionOutcome
{
  Completed,
  Rejected,
  Cancelled,
  Failed,
  NeedsAttention,
  AlreadyRunning,
}

public sealed record ActionResult(
  string ActionId,
  string TaskId,
  string StepId,
  ActionOutcome Outcome,
  string? OutputJson,
  string? OutputSha256,
  bool MutationCommitted,
  bool OutcomeUncertain,
  bool IsIdempotentReplay,
  string? ErrorCode,
  IReadOnlyList<DataProvenance> Provenance,
  long? JournalPrepareSequence = null,
  string? JournalPrepareEntryHash = null,
  string? JournalPreparePreviousHash = null,
  long? JournalSequence = null,
  string? JournalEntryHash = null,
  string? JournalPreviousHash = null,
  string? PreStateSha256 = null,
  string? RecoveryProvenanceSha256 = null,
  string? RecoveryHandleSha256 = null,
  long LocalBytesRead = 0,
  long LocalBytesWritten = 0,
  /// <summary>
  /// Conservatively metered capability-side application egress to a
  /// non-Itemba destination.
  /// </summary>
  long ExternalEgressBytes = 0,
  /// <summary>
  /// A conservative, pre-charged upper bound for every permitted delivery of
  /// this complete terminal result to the Itemba broker, including retries.
  /// The protected result store limits delivery sessions to this reservation.
  /// </summary>
  long BrokerExternalEgressBytes = 0,
  /// <summary>Broker-signed maximum separately initiated result deliveries.</summary>
  int BrokerMaxDeliverySessions = 0,
  /// <summary>Broker-signed maximum HTTP attempts within one delivery session.</summary>
  int BrokerMaxRequestAttemptsPerSession = 0,
  /// <summary>Broker-signed upper bound for one serialized result request body.</summary>
  long BrokerSerializedResultUpperBoundBytes = 0,
  /// <summary>
  /// Egress charged when a crash or other unknown outcome prevents exact
  /// measurement. Together with the broker reservation it never exceeds the
  /// verified action ceiling.
  /// </summary>
  long UncertainExternalEgressBytes = 0,
  /// <summary>SHA-256 of the exact broker-signed at+jwt used for this dispatch.</summary>
  string? ActionTokenSha256 = null,
  /// <summary>
  /// Full signed authorization and independently signed meter receipt for a
  /// reviewed metered capability. Absent for every ordinary capability.
  /// </summary>
  EgressExecutionEvidence? EgressEvidence = null,
  string LeaseId = "",
  string FencingToken = "",
  DateTimeOffset LeaseExpiresAt = default,
  long? JournalRecoveryPreparedSequence = null,
  string? JournalRecoveryPreparedEntryHash = null,
  string? JournalRecoveryPreparedPreviousHash = null);

public sealed record CapabilityManifestSnapshot(
  string DeviceId,
  string ManifestSha256,
  IReadOnlyList<CapabilityDescriptor> Capabilities,
  DateTimeOffset GeneratedAt,
  int CommandProtocolVersion = CompanionCommandProtocol.LegacyVersion);

public sealed record CompanionHeartbeat(
  string DeviceId,
  string Component,
  string ComponentVersion,
  bool ExecutionEnabled,
  bool KillSwitchEngaged,
  bool CentralLedgerConnected,
  int RunningActionCount,
  long JournalSequence,
  string JournalHeadHash,
  string CapabilityManifestSha256,
  DateTimeOffset SentAt);
