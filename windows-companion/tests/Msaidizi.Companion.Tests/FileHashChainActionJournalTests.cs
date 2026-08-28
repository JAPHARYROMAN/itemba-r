using System.Text.Json;
using System.Text.Json.Nodes;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Journal;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Journal;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class FileHashChainActionJournalTests : IDisposable
{
  private const long MaximumEgress = 100_000;
  private const long BrokerReservation = 10_000;
  private const int BrokerDeliverySessions = 2;
  private const int BrokerRequestAttempts = 2;
  private const long BrokerResultUpperBoundBytes = 2_500;
  private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"msaidizi-journal-tests-{Guid.NewGuid():N}");

  [Fact]
  public void DigestOnlyHashMatchesTheBackendCrossRuntimeVector()
  {
    var hash = FileHashChainActionJournal.ComputeDigestOnlyEntryHash(
      hashVersion: 2,
      sequence: 1,
      occurredAtUnixMilliseconds: 1_787_824_800_000,
      kind: (int)JournalEntryKind.Prepared,
      actionId: "action-1",
      idempotencyKey: "idempotency-1",
      previousHash: new string('0', 64),
      payloadSha256: new string('b', 64));

    Assert.Equal("7728d40c10166f74bf729ec19ee0c3d9306017cbb69d57b6a62f7ccca445eefa", hash);
  }

  [Fact]
  public async Task ReconciliationRangeIsBoundedVerifiedAndDigestOnly()
  {
    var path = Path.Combine(_directory, "actions.jsonl");
    using var journal = new FileHashChainActionJournal(path);
    await journal.InitializeAsync(CancellationToken.None);
    var request = ActionTokenVerifierTests.CreateRequest("{}");
    var started = await journal.TryBeginAsync(
      request,
      PayloadDigest.Sha256Hex("signed-token"),
      MaximumEgress,
      BrokerReservation,
      BrokerDeliverySessions,
      BrokerRequestAttempts,
      BrokerResultUpperBoundBytes,
      CancellationToken.None);

    var range = await journal.ReadRangeAsync(0, 1, CancellationToken.None);
    Assert.Equal(0, range.StartingPredecessor.Sequence);
    Assert.Equal(new string('0', 64), range.StartingPredecessor.EntryHash);
    var entry = Assert.Single(range.Entries);
    Assert.Equal(started.PreparedRecord, entry);
    Assert.Equal(entry.Sequence, range.FinalHead.Sequence);
    Assert.Equal(range.FinalHead, range.LocalHead);
    var serialized = JsonSerializer.Serialize(range, WebJson);
    Assert.DoesNotContain("payloadJson", serialized, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("argumentsJson", serialized, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("outputJson", serialized, StringComparison.OrdinalIgnoreCase);

    var empty = await journal.ReadRangeAsync(
      range.FinalHead.Sequence,
      JournalReconciliationContract.MaximumEntriesPerRange,
      CancellationToken.None);
    Assert.Empty(empty.Entries);
    Assert.Equal(range.FinalHead, empty.StartingPredecessor);
    await Assert.ThrowsAsync<ArgumentOutOfRangeException>(async () =>
      await journal.ReadRangeAsync(
        0,
        JournalReconciliationContract.MaximumEntriesPerRange + 1,
        CancellationToken.None));
  }

  [Fact]
  public async Task LegacyV1RestartAppendsDigestOnlyV2AuthorizationBridge()
  {
    var path = Path.Combine(_directory, "legacy-actions.jsonl");
    var request = ActionTokenVerifierTests.CreateRequest("{}");
    using (var journal = new FileHashChainActionJournal(path))
    {
      await journal.InitializeAsync(CancellationToken.None);
      await BeginAsync(journal, request);
      await journal.AppendTerminalAsync(
        request,
        TerminalResult(request),
        JournalEntryKind.NeedsAttention,
        CancellationToken.None);
    }

    var lines = File.ReadAllLines(path).Select(ParseLine).ToArray();
    lines[0].Remove("hashVersion");
    lines[0] = Rechain(lines[0], 1, new string('0', 64));
    lines[1].Remove("hashVersion");
    lines[1] = Rechain(lines[1], 2, lines[0]["entryHash"]!.GetValue<string>());
    File.WriteAllLines(path, lines.Select(line => line.ToJsonString(WebJson)));

    using var restarted = new FileHashChainActionJournal(path);
    await restarted.InitializeAsync(CancellationToken.None);
    var range = await restarted.ReadRangeAsync(
      0,
      JournalReconciliationContract.MaximumEntriesPerRange,
      CancellationToken.None);

    Assert.Equal(3, range.Entries.Count);
    Assert.All(range.Entries.Take(2), entry => Assert.Equal(1, entry.HashVersion));
    Assert.Equal(JournalEntryKind.ChainUpgraded, range.Entries[^1].Kind);
    Assert.Equal(2, range.Entries[^1].HashVersion);
    Assert.Equal(range.Entries[1].EntryHash, range.Entries[^1].PreviousHash);
  }

  [Fact]
  public async Task LegacyPreparedRestartBridgesBeforeWritingUncertainTerminal()
  {
    var path = Path.Combine(_directory, "legacy-prepared-actions.jsonl");
    var request = ActionTokenVerifierTests.CreateRequest("{}");
    using (var journal = new FileHashChainActionJournal(path))
    {
      await journal.InitializeAsync(CancellationToken.None);
      await BeginAsync(journal, request);
    }

    var prepared = ParseLine(File.ReadAllLines(path).Single());
    prepared.Remove("hashVersion");
    prepared = Rechain(prepared, 1, new string('0', 64));
    File.WriteAllText(path, $"{prepared.ToJsonString(WebJson)}{Environment.NewLine}");

    using var restarted = new FileHashChainActionJournal(path);
    await restarted.InitializeAsync(CancellationToken.None);
    var range = await restarted.ReadRangeAsync(
      0,
      JournalReconciliationContract.MaximumEntriesPerRange,
      CancellationToken.None);

    Assert.Equal(3, range.Entries.Count);
    Assert.Equal(1, range.Entries[0].HashVersion);
    Assert.Equal(JournalEntryKind.ChainUpgraded, range.Entries[1].Kind);
    Assert.Equal(2, range.Entries[1].HashVersion);
    Assert.Equal(JournalEntryKind.NeedsAttention, range.Entries[2].Kind);
    Assert.Equal(range.Entries[1].EntryHash, range.Entries[2].PreviousHash);
  }

  [Fact]
  public async Task RestartRejectsRechainedDigestOnlyToLegacyDowngrade()
  {
    var path = Path.Combine(_directory, "downgraded-actions.jsonl");
    var request = ActionTokenVerifierTests.CreateRequest("{}");
    using (var journal = new FileHashChainActionJournal(path))
    {
      await journal.InitializeAsync(CancellationToken.None);
      await BeginAsync(journal, request);
      await journal.AppendTerminalAsync(
        request,
        TerminalResult(request),
        JournalEntryKind.NeedsAttention,
        CancellationToken.None);
    }

    var lines = File.ReadAllLines(path).Select(ParseLine).ToArray();
    lines[1].Remove("hashVersion");
    lines[1] = Rechain(lines[1], 2, lines[0]["entryHash"]!.GetValue<string>());
    File.WriteAllLines(path, lines.Select(line => line.ToJsonString(WebJson)));

    using var restarted = new FileHashChainActionJournal(path);
    var failure = await Assert.ThrowsAnyAsync<Exception>(() =>
      restarted.InitializeAsync(CancellationToken.None).AsTask());
    Assert.Equal("journal_hash_version_downgrade", failure.Message);
  }

  [Fact]
  public async Task TerminalOutcomeIsReplayedWithoutRepeatingExecution()
  {
    var path = Path.Combine(_directory, "actions.jsonl");
    using var journal = new FileHashChainActionJournal(path);
    await journal.InitializeAsync(CancellationToken.None);
    var request = ActionTokenVerifierTests.CreateRequest("{}");

    var started = await journal.TryBeginAsync(
      request,
      PayloadDigest.Sha256Hex("signed-token"),
      MaximumEgress,
      BrokerReservation,
      BrokerDeliverySessions,
      BrokerRequestAttempts,
      BrokerResultUpperBoundBytes,
      CancellationToken.None);
    var alreadyRunning = await journal.TryBeginAsync(
      request,
      PayloadDigest.Sha256Hex("signed-token"),
      MaximumEgress,
      BrokerReservation,
      BrokerDeliverySessions,
      BrokerRequestAttempts,
      BrokerResultUpperBoundBytes,
      CancellationToken.None);
    var provenance = new DataProvenance(
      "test",
      PayloadDigest.Sha256Hex("source"),
      PayloadDigest.Sha256Hex("content"),
      ProvenanceTrust.AuthenticatedRemote,
      new DateTimeOffset(2026, 8, 25, 10, 0, 0, TimeSpan.Zero));
    var result = new ActionResult(
      request.ActionId,
      request.TaskId,
      request.StepId,
      ActionOutcome.Completed,
      "{\"status\":\"ok\"}",
      PayloadDigest.Sha256Hex("{\"status\":\"ok\"}"),
      MutationCommitted: false,
      OutcomeUncertain: false,
      IsIdempotentReplay: false,
      ErrorCode: null,
      Provenance: [provenance],
      BrokerExternalEgressBytes: BrokerReservation,
      BrokerMaxDeliverySessions: BrokerDeliverySessions,
      BrokerMaxRequestAttemptsPerSession: BrokerRequestAttempts,
      BrokerSerializedResultUpperBoundBytes: BrokerResultUpperBoundBytes,
      ActionTokenSha256: PayloadDigest.Sha256Hex("signed-token"));
    var terminal = await journal.AppendTerminalAsync(
      request,
      result,
      JournalEntryKind.Completed,
      CancellationToken.None);
    var replay = await journal.TryBeginAsync(
      request,
      PayloadDigest.Sha256Hex("signed-token"),
      MaximumEgress,
      BrokerReservation,
      BrokerDeliverySessions,
      BrokerRequestAttempts,
      BrokerResultUpperBoundBytes,
      CancellationToken.None);
    var generationReplay = await journal.TryBeginAsync(
      request with { DispatchCount = 2 },
      PayloadDigest.Sha256Hex("redelivery-token"),
      MaximumEgress,
      BrokerReservation,
      BrokerDeliverySessions,
      BrokerRequestAttempts,
      BrokerResultUpperBoundBytes,
      CancellationToken.None);
    var conflictingReplay = await journal.TryBeginAsync(
      request with
      {
        ArgumentsSha256 = PayloadDigest.Sha256Hex("{\"changed\":true}"),
      },
      PayloadDigest.Sha256Hex("signed-token"),
      MaximumEgress,
      BrokerReservation,
      BrokerDeliverySessions,
      BrokerRequestAttempts,
      BrokerResultUpperBoundBytes,
      CancellationToken.None);

    Assert.Equal(JournalBeginDisposition.Started, started.Disposition);
    Assert.Equal(JournalBeginDisposition.AlreadyRunning, alreadyRunning.Disposition);
    Assert.Equal(JournalBeginDisposition.TerminalReplay, replay.Disposition);
    Assert.Equal(JournalBeginDisposition.TerminalReplay, generationReplay.Disposition);
    Assert.Equal(JournalBeginDisposition.IdempotencyConflict, conflictingReplay.Disposition);
    Assert.Equal(ActionOutcome.Completed, replay.TerminalReceipt!.Outcome);
    Assert.Equal([provenance], replay.TerminalReceipt.Provenance);
    var prepared = Assert.IsType<JournalRecord>(started.PreparedRecord);
    Assert.Equal(prepared.Sequence, terminal.JournalPrepareSequence);
    Assert.Equal(prepared.EntryHash, terminal.JournalPrepareEntryHash);
    Assert.Equal(prepared.PreviousHash, terminal.JournalPreparePreviousHash);
    Assert.Equal(prepared.EntryHash, terminal.JournalPreviousHash);
    Assert.Equal(terminal.JournalPreviousHash, replay.TerminalReceipt.JournalPreviousHash);
    Assert.True((await journal.VerifyAsync(CancellationToken.None)).IsValid);
  }

  [Fact]
  public async Task ReplaysRequireTheExactSignedEgressAndDeliveryContract()
  {
    var path = Path.Combine(_directory, "contract-bound-replay.jsonl");
    using var journal = new FileHashChainActionJournal(path);
    await journal.InitializeAsync(CancellationToken.None);
    var request = ActionTokenVerifierTests.CreateRequest("{}");
    var tokenSha256 = PayloadDigest.Sha256Hex("signed-token");

    await journal.TryBeginAsync(
      request,
      tokenSha256,
      MaximumEgress,
      BrokerReservation,
      BrokerDeliverySessions,
      BrokerRequestAttempts,
      BrokerResultUpperBoundBytes,
      CancellationToken.None);

    var activeMismatch = await journal.TryBeginAsync(
      request,
      tokenSha256,
      MaximumEgress + 1,
      BrokerReservation,
      BrokerDeliverySessions,
      BrokerRequestAttempts,
      BrokerResultUpperBoundBytes,
      CancellationToken.None);

    var result = new ActionResult(
      request.ActionId,
      request.TaskId,
      request.StepId,
      ActionOutcome.Completed,
      "{}",
      PayloadDigest.Sha256Hex("{}"),
      false,
      false,
      false,
      null,
      [],
      BrokerExternalEgressBytes: BrokerReservation,
      BrokerMaxDeliverySessions: BrokerDeliverySessions,
      BrokerMaxRequestAttemptsPerSession: BrokerRequestAttempts,
      BrokerSerializedResultUpperBoundBytes: BrokerResultUpperBoundBytes,
      ActionTokenSha256: tokenSha256);
    await journal.AppendTerminalAsync(
      request,
      result,
      JournalEntryKind.Completed,
      CancellationToken.None);

    var terminalMismatch = await journal.TryBeginAsync(
      request,
      tokenSha256,
      MaximumEgress,
      BrokerReservation,
      BrokerDeliverySessions + 2,
      BrokerRequestAttempts,
      BrokerReservation / ((BrokerDeliverySessions + 2) * BrokerRequestAttempts),
      CancellationToken.None);

    Assert.Equal(JournalBeginDisposition.IdempotencyConflict, activeMismatch.Disposition);
    Assert.Equal(JournalBeginDisposition.IdempotencyConflict, terminalMismatch.Disposition);
  }

  [Fact]
  public async Task PreparationRejectsMalformedDigestMaterialBeforePersistence()
  {
    var path = Path.Combine(_directory, "malformed-digests.jsonl");
    using var journal = new FileHashChainActionJournal(path);
    await journal.InitializeAsync(CancellationToken.None);
    var malformed = ActionTokenVerifierTests.CreateRequest("{}") with
    {
      InputProvenanceSha256 = "abcd",
    };

    await Assert.ThrowsAsync<ArgumentOutOfRangeException>(async () =>
      await journal.TryBeginAsync(
        malformed,
        PayloadDigest.Sha256Hex("signed-token"),
        MaximumEgress,
        BrokerReservation,
        BrokerDeliverySessions,
        BrokerRequestAttempts,
        BrokerResultUpperBoundBytes,
        CancellationToken.None));

    Assert.False(File.Exists(path));
  }

  [Fact]
  public async Task JournalNeverPersistsRawArgumentsOrOutputs()
  {
    var path = Path.Combine(_directory, "actions.jsonl");
    using var journal = new FileHashChainActionJournal(path);
    await journal.InitializeAsync(CancellationToken.None);
    const string governedArtifactBytesBase64 = "cmV2aWV3ZWQtYXJ0aWZhY3QtYnl0ZXM=";
    var rawArguments = $$"""
      {
        "password":"never-store-this",
        "attachment":{
          "artifactId":"10000000-0000-4000-8000-000000000007",
          "sha256":"{{new string('A', 64)}}",
          "contentBase64":"{{governedArtifactBytesBase64}}"
        }
      }
      """;
    var request = ActionTokenVerifierTests.CreateRequest(rawArguments);
    await journal.TryBeginAsync(
      request,
      PayloadDigest.Sha256Hex("signed-token"),
      MaximumEgress,
      BrokerReservation,
      BrokerDeliverySessions,
      BrokerRequestAttempts,
      BrokerResultUpperBoundBytes,
      CancellationToken.None);
    var result = new ActionResult(
      request.ActionId,
      request.TaskId,
      request.StepId,
      ActionOutcome.Completed,
      "{\"secretOutput\":\"also-never-store-this\"}",
      PayloadDigest.Sha256Hex("{\"secretOutput\":\"also-never-store-this\"}"),
      false,
      false,
      false,
      null,
      [],
      BrokerExternalEgressBytes: BrokerReservation,
      BrokerMaxDeliverySessions: BrokerDeliverySessions,
      BrokerMaxRequestAttemptsPerSession: BrokerRequestAttempts,
      BrokerSerializedResultUpperBoundBytes: BrokerResultUpperBoundBytes,
      ActionTokenSha256: PayloadDigest.Sha256Hex("signed-token"));
    await journal.AppendTerminalAsync(
      request,
      result,
      JournalEntryKind.Completed,
      CancellationToken.None);

    var persisted = await File.ReadAllTextAsync(path);

    Assert.DoesNotContain("never-store-this", persisted);
    Assert.DoesNotContain("also-never-store-this", persisted);
    Assert.DoesNotContain(governedArtifactBytesBase64, persisted);
    Assert.DoesNotContain("contentBase64", persisted);
    Assert.DoesNotContain("password", persisted);
    Assert.DoesNotContain("secretOutput", persisted);
  }

  [Fact]
  public async Task JournalRejectsInterleavedPreparationsSoReceiptIsAdjacent()
  {
    var path = Path.Combine(_directory, "interleaved-actions.jsonl");
    using var journal = new FileHashChainActionJournal(path);
    await journal.InitializeAsync(CancellationToken.None);
    var firstRequest = ActionTokenVerifierTests.CreateRequest("{}") with
    {
      ActionId = "action-first",
      IdempotencyKey = "idempotency-first",
    };
    var secondRequest = ActionTokenVerifierTests.CreateRequest("{}") with
    {
      ActionId = "action-second",
      IdempotencyKey = "idempotency-second",
    };
    var firstBegin = await journal.TryBeginAsync(
      firstRequest,
      PayloadDigest.Sha256Hex("first-token"),
      MaximumEgress,
      BrokerReservation,
      BrokerDeliverySessions,
      BrokerRequestAttempts,
      BrokerResultUpperBoundBytes,
      CancellationToken.None);
    var secondBegin = await journal.TryBeginAsync(
      secondRequest,
      PayloadDigest.Sha256Hex("second-token"),
      MaximumEgress,
      BrokerReservation,
      BrokerDeliverySessions,
      BrokerRequestAttempts,
      BrokerResultUpperBoundBytes,
      CancellationToken.None);
    var firstResult = new ActionResult(
      firstRequest.ActionId,
      firstRequest.TaskId,
      firstRequest.StepId,
      ActionOutcome.Completed,
      "{}",
      PayloadDigest.Sha256Hex("{}"),
      false,
      false,
      false,
      null,
      [],
      BrokerExternalEgressBytes: BrokerReservation,
      BrokerMaxDeliverySessions: BrokerDeliverySessions,
      BrokerMaxRequestAttemptsPerSession: BrokerRequestAttempts,
      BrokerSerializedResultUpperBoundBytes: BrokerResultUpperBoundBytes,
      ActionTokenSha256: PayloadDigest.Sha256Hex("first-token"));

    var receipt = await journal.AppendTerminalAsync(
      firstRequest,
      firstResult,
      JournalEntryKind.Completed,
      CancellationToken.None);

    var firstPrepared = Assert.IsType<JournalRecord>(firstBegin.PreparedRecord);
    Assert.Equal(JournalBeginDisposition.JournalBusy, secondBegin.Disposition);
    Assert.Equal(firstPrepared.Sequence, receipt.JournalPrepareSequence);
    Assert.Equal(firstPrepared.EntryHash, receipt.JournalPrepareEntryHash);
    Assert.Equal(firstPrepared.PreviousHash, receipt.JournalPreparePreviousHash);
    Assert.Equal(firstPrepared.EntryHash, receipt.JournalPreviousHash);
    Assert.Equal(receipt.JournalPrepareEntryHash, receipt.JournalPreviousHash);
  }

  [Fact]
  public async Task TamperingBreaksHashChainVerification()
  {
    var path = Path.Combine(_directory, "actions.jsonl");
    using var journal = new FileHashChainActionJournal(path);
    await journal.InitializeAsync(CancellationToken.None);
    await journal.TryBeginAsync(
      ActionTokenVerifierTests.CreateRequest("{}"),
      PayloadDigest.Sha256Hex("signed-token"),
      MaximumEgress,
      BrokerReservation,
      BrokerDeliverySessions,
      BrokerRequestAttempts,
      BrokerResultUpperBoundBytes,
      CancellationToken.None);
    await File.AppendAllTextAsync(path, "{}\n");

    var verification = await journal.VerifyAsync(CancellationToken.None);

    Assert.False(verification.IsValid);
    Assert.Equal(2L, verification.InvalidSequence);
  }

  [Fact]
  public async Task AmbiguousAppendFaultsTheInstanceUntilRestartVerification()
  {
    var path = Path.Combine(_directory, "ambiguous-append.jsonl");
    var request = ActionTokenVerifierTests.CreateRequest("{}");
    using (var journal = new FileHashChainActionJournal(
      path,
      async (target, bytes, cancellationToken) =>
      {
        await using var stream = new FileStream(
          target,
          FileMode.Append,
          FileAccess.Write,
          FileShare.Read,
          4096,
          FileOptions.Asynchronous | FileOptions.WriteThrough);
        await stream.WriteAsync(bytes, cancellationToken);
        await stream.FlushAsync(cancellationToken);
        stream.Flush(flushToDisk: true);
        throw new IOException("Simulated acknowledgement loss after durable append");
      }))
    {
      await journal.InitializeAsync(CancellationToken.None);
      await Assert.ThrowsAsync<IOException>(async () => await journal.TryBeginAsync(
        request,
        PayloadDigest.Sha256Hex("signed-token"),
        MaximumEgress,
        BrokerReservation,
        BrokerDeliverySessions,
        BrokerRequestAttempts,
        BrokerResultUpperBoundBytes,
        CancellationToken.None));
      var fault = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        await journal.GetHeadAsync(CancellationToken.None));
      Assert.Contains("requires process restart", fault.Message, StringComparison.Ordinal);
    }

    Assert.Single(File.ReadLines(path));
    using var restarted = new FileHashChainActionJournal(path);
    await restarted.InitializeAsync(CancellationToken.None);

    Assert.True((await restarted.VerifyAsync(CancellationToken.None)).IsValid);
    Assert.Equal(2L, (await restarted.GetHeadAsync(CancellationToken.None)).Sequence);
  }

  [Fact]
  public async Task RestartClosesOrphanedPreparedActionAsNeedsAttention()
  {
    var path = Path.Combine(_directory, "actions.jsonl");
    var request = ActionTokenVerifierTests.CreateRequest("{}");
    using (var firstProcess = new FileHashChainActionJournal(path))
    {
      await firstProcess.InitializeAsync(CancellationToken.None);
      await firstProcess.TryBeginAsync(
        request,
        PayloadDigest.Sha256Hex("signed-token"),
        MaximumEgress,
        BrokerReservation,
        BrokerDeliverySessions,
        BrokerRequestAttempts,
        BrokerResultUpperBoundBytes,
        CancellationToken.None);
    }

    using var restartedProcess = new FileHashChainActionJournal(path);
    await restartedProcess.InitializeAsync(CancellationToken.None);
    var replay = await restartedProcess.TryBeginAsync(
      request,
      PayloadDigest.Sha256Hex("signed-token"),
      MaximumEgress,
      BrokerReservation,
      BrokerDeliverySessions,
      BrokerRequestAttempts,
      BrokerResultUpperBoundBytes,
      CancellationToken.None);

    Assert.Equal(JournalBeginDisposition.TerminalReplay, replay.Disposition);
    Assert.Equal(ActionOutcome.NeedsAttention, replay.TerminalReceipt!.Outcome);
    Assert.True(replay.TerminalReceipt.OutcomeUncertain);
    Assert.Equal("companion_restarted_before_terminal", replay.TerminalReceipt.ErrorCode);
    Assert.Equal(BrokerReservation, replay.TerminalReceipt.BrokerExternalEgressBytes);
    Assert.Equal(
      MaximumEgress - BrokerReservation,
      replay.TerminalReceipt.UncertainExternalEgressBytes);
    Assert.Equal(
      MaximumEgress,
      replay.TerminalReceipt.BrokerExternalEgressBytes
        + replay.TerminalReceipt.UncertainExternalEgressBytes);
    Assert.Equal(2L, (await restartedProcess.GetHeadAsync(CancellationToken.None)).Sequence);
  }

  [Fact]
  public async Task RestartAfterRecoveryCheckpointPreservesRecoveryDigests()
  {
    var path = Path.Combine(_directory, "recovery-checkpoint-restart.jsonl");
    var preState = PayloadDigest.Sha256Hex("pre-state");
    var recoveryRecord = PayloadDigest.Sha256Hex("recovery-record");
    const string rawRecoveryHandle = "vault/forbidden-opaque-handle";
    var recoveryHandle = PayloadDigest.Sha256Hex(rawRecoveryHandle);
    var request = ActionTokenVerifierTests.CreateRequest("{}") with
    {
      ExpectedPreStateSha256 = preState,
    };
    JournalRecord checkpointRecord;
    using (var firstProcess = new FileHashChainActionJournal(path))
    {
      await firstProcess.InitializeAsync(CancellationToken.None);
      await BeginAsync(firstProcess, request);
      checkpointRecord = await firstProcess.AppendRecoveryPreparedAsync(
        Checkpoint(request, preState, recoveryRecord, recoveryHandle),
        CancellationToken.None);
    }

    using var restarted = new FileHashChainActionJournal(path);
    await restarted.InitializeAsync(CancellationToken.None);
    var replay = await BeginAsync(restarted, request);

    Assert.Equal(JournalEntryKind.RecoveryPrepared, checkpointRecord.Kind);
    Assert.Equal(2L, checkpointRecord.Sequence);
    Assert.Equal(JournalBeginDisposition.TerminalReplay, replay.Disposition);
    Assert.Equal(ActionOutcome.NeedsAttention, replay.TerminalReceipt!.Outcome);
    Assert.True(replay.TerminalReceipt.OutcomeUncertain);
    Assert.False(replay.TerminalReceipt.MutationCommitted);
    Assert.Equal(
      "companion_restarted_before_terminal",
      replay.TerminalReceipt.ErrorCode);
    Assert.Equal(preState, replay.TerminalReceipt.PreStateSha256);
    Assert.Equal(recoveryRecord, replay.TerminalReceipt.RecoveryProvenanceSha256);
    Assert.Equal(recoveryHandle, replay.TerminalReceipt.RecoveryHandleSha256);
    Assert.Equal(
      checkpointRecord.Sequence,
      replay.TerminalReceipt.JournalRecoveryPreparedSequence);
    Assert.Equal(
      checkpointRecord.EntryHash,
      replay.TerminalReceipt.JournalRecoveryPreparedEntryHash);
    Assert.Equal(
      checkpointRecord.PreviousHash,
      replay.TerminalReceipt.JournalRecoveryPreparedPreviousHash);
    Assert.Equal(checkpointRecord.EntryHash, replay.TerminalReceipt.JournalPreviousHash);
    Assert.True((await restarted.VerifyAsync(CancellationToken.None)).IsValid);
    Assert.DoesNotContain(
      rawRecoveryHandle,
      await File.ReadAllTextAsync(path),
      StringComparison.Ordinal);
    Assert.Equal(3L, (await restarted.GetHeadAsync(CancellationToken.None)).Sequence);
  }

  [Fact]
  public async Task TerminalMergesCheckpointAndRejectsConflictingMetadata()
  {
    var path = Path.Combine(_directory, "recovery-checkpoint-conflict.jsonl");
    var preState = PayloadDigest.Sha256Hex("pre-state");
    var recoveryRecord = PayloadDigest.Sha256Hex("recovery-record");
    var recoveryHandle = PayloadDigest.Sha256Hex("opaque-handle");
    var request = ActionTokenVerifierTests.CreateRequest("{}") with
    {
      ExpectedPreStateSha256 = preState,
    };
    using var journal = new FileHashChainActionJournal(path);
    await journal.InitializeAsync(CancellationToken.None);
    await BeginAsync(journal, request);
    await journal.AppendRecoveryPreparedAsync(
      Checkpoint(request, preState, recoveryRecord, recoveryHandle),
      CancellationToken.None);
    var conflicting = TerminalResult(request) with
    {
      RecoveryProvenanceSha256 = PayloadDigest.Sha256Hex("other-record"),
    };

    await Assert.ThrowsAsync<InvalidOperationException>(async () =>
      await journal.AppendTerminalAsync(
        request,
        conflicting,
        JournalEntryKind.NeedsAttention,
        CancellationToken.None));
    Assert.Equal(2L, (await journal.GetHeadAsync(CancellationToken.None)).Sequence);

    var receipt = await journal.AppendTerminalAsync(
      request,
      TerminalResult(request),
      JournalEntryKind.NeedsAttention,
      CancellationToken.None);
    Assert.Equal(preState, receipt.PreStateSha256);
    Assert.Equal(recoveryRecord, receipt.RecoveryProvenanceSha256);
    Assert.Equal(recoveryHandle, receipt.RecoveryHandleSha256);
  }

  [Fact]
  public async Task CheckpointRejectsMalformedDuplicateOrUnsignedPreState()
  {
    var path = Path.Combine(_directory, "recovery-checkpoint-api-invalid.jsonl");
    var preState = PayloadDigest.Sha256Hex("pre-state");
    var request = ActionTokenVerifierTests.CreateRequest("{}") with
    {
      ExpectedPreStateSha256 = preState,
    };
    using var journal = new FileHashChainActionJournal(path);
    await journal.InitializeAsync(CancellationToken.None);
    var valid = Checkpoint(
      request,
      preState,
      PayloadDigest.Sha256Hex("record"),
      PayloadDigest.Sha256Hex("handle"));

    await Assert.ThrowsAsync<InvalidOperationException>(async () =>
      await journal.AppendRecoveryPreparedAsync(valid, CancellationToken.None));
    await BeginAsync(journal, request);
    await Assert.ThrowsAsync<ArgumentException>(async () =>
      await journal.AppendRecoveryPreparedAsync(
        valid with { RecoveryHandleSha256 = "not-a-digest" },
        CancellationToken.None));
    await journal.AppendRecoveryPreparedAsync(valid, CancellationToken.None);
    await Assert.ThrowsAsync<InvalidOperationException>(async () =>
      await journal.AppendRecoveryPreparedAsync(valid, CancellationToken.None));
    Assert.Equal(2L, (await journal.GetHeadAsync(CancellationToken.None)).Sequence);

    var unsignedPath = Path.Combine(_directory, "unsigned-recovery-prestate.jsonl");
    var unsignedRequest = ActionTokenVerifierTests.CreateRequest("{}") with
    {
      ActionId = "unsigned-action",
      IdempotencyKey = "unsigned-idempotency",
    };
    using var unsignedJournal = new FileHashChainActionJournal(unsignedPath);
    await unsignedJournal.InitializeAsync(CancellationToken.None);
    await BeginAsync(unsignedJournal, unsignedRequest);
    await Assert.ThrowsAsync<InvalidOperationException>(async () =>
      await unsignedJournal.AppendRecoveryPreparedAsync(
        Checkpoint(
          unsignedRequest,
          preState,
          PayloadDigest.Sha256Hex("unsigned-record"),
          PayloadDigest.Sha256Hex("unsigned-handle")),
        CancellationToken.None));
    Assert.Equal(1L, (await unsignedJournal.GetHeadAsync(
      CancellationToken.None)).Sequence);
  }

  [Theory]
  [InlineData("malformed", "journal_recovery_checkpoint_malformed")]
  [InlineData("duplicate", "journal_recovery_checkpoint_duplicate")]
  [InlineData("orphan", "journal_recovery_checkpoint_without_prepare")]
  public async Task ReloadRejectsInvalidRecoveryCheckpointSequence(
    string corruption,
    string expectedError)
  {
    var path = Path.Combine(_directory, $"checkpoint-{corruption}.jsonl");
    var preState = PayloadDigest.Sha256Hex("pre-state");
    var request = ActionTokenVerifierTests.CreateRequest("{}") with
    {
      ExpectedPreStateSha256 = preState,
    };
    using (var journal = new FileHashChainActionJournal(path))
    {
      await journal.InitializeAsync(CancellationToken.None);
      await BeginAsync(journal, request);
      await journal.AppendRecoveryPreparedAsync(
        Checkpoint(
          request,
          preState,
          PayloadDigest.Sha256Hex("record"),
          PayloadDigest.Sha256Hex("handle")),
        CancellationToken.None);
    }

    var lines = File.ReadAllLines(path).Select(ParseLine).ToList();
    switch (corruption)
    {
      case "malformed":
        var payload = JsonNode.Parse(lines[1]["payloadJson"]!.GetValue<string>())!
          .AsObject();
        payload["recordPath"] = @"C:\forbidden\raw-path.bin";
        lines[1]["payloadJson"] = payload.ToJsonString(WebJson);
        lines[1] = Rechain(
          lines[1],
          2,
          lines[0]["entryHash"]!.GetValue<string>());
        break;
      case "duplicate":
        lines.Add(Rechain(
          lines[1].DeepClone().AsObject(),
          3,
          lines[1]["entryHash"]!.GetValue<string>()));
        break;
      case "orphan":
        lines =
        [
          Rechain(
            lines[1].DeepClone().AsObject(),
            1,
            new string('0', 64)),
        ];
        break;
      default:
        throw new InvalidOperationException("Unknown test corruption.");
    }
    File.WriteAllLines(path, lines.Select(line => line.ToJsonString(WebJson)));

    using var restarted = new FileHashChainActionJournal(path);
    var failure = await Assert.ThrowsAnyAsync<Exception>(() =>
      restarted.InitializeAsync(CancellationToken.None).AsTask());
    Assert.Equal(expectedError, failure.Message);
  }

  [Fact]
  public async Task TerminalAppendRejectsBrokerInvalidErrorAndProvenanceText()
  {
    var path = Path.Combine(_directory, "invalid-wire-text.jsonl");
    using var journal = new FileHashChainActionJournal(path);
    await journal.InitializeAsync(CancellationToken.None);
    var request = ActionTokenVerifierTests.CreateRequest("{}");
    await BeginAsync(journal, request);

    await Assert.ThrowsAsync<ArgumentException>(async () =>
      await journal.AppendTerminalAsync(
        request,
        TerminalResult(request) with { ErrorCode = "invalid error code" },
        JournalEntryKind.NeedsAttention,
        CancellationToken.None));

    var invalidProvenance = new DataProvenance(
      new string('s', 121),
      PayloadDigest.Sha256Hex("source"),
      PayloadDigest.Sha256Hex("content"),
      ProvenanceTrust.TrustedSystem,
      DateTimeOffset.UtcNow);
    await Assert.ThrowsAsync<ArgumentException>(async () =>
      await journal.AppendTerminalAsync(
        request,
        TerminalResult(request) with { Provenance = [invalidProvenance] },
        JournalEntryKind.NeedsAttention,
        CancellationToken.None));

    Assert.Equal(1L, (await journal.GetHeadAsync(CancellationToken.None)).Sequence);
  }

  private static ValueTask<JournalBeginResult> BeginAsync(
    FileHashChainActionJournal journal,
    ActionRequest request) => journal.TryBeginAsync(
      request,
      PayloadDigest.Sha256Hex("signed-token"),
      MaximumEgress,
      BrokerReservation,
      BrokerDeliverySessions,
      BrokerRequestAttempts,
      BrokerResultUpperBoundBytes,
      CancellationToken.None);

  private static JournalRecoveryPreparedCheckpoint Checkpoint(
    ActionRequest request,
    string preStateSha256,
    string recoveryProvenanceSha256,
    string recoveryHandleSha256) => new(
      request.ActionId,
      request.IdempotencyKey,
      request.TaskId,
      request.PlanVersionId,
      request.StepId,
      request.DeviceId,
      request.MandateId,
      preStateSha256,
      recoveryProvenanceSha256,
      recoveryHandleSha256);

  private static ActionResult TerminalResult(ActionRequest request) => new(
    ActionId: request.ActionId,
    TaskId: request.TaskId,
    StepId: request.StepId,
    Outcome: ActionOutcome.NeedsAttention,
    OutputJson: null,
    OutputSha256: null,
    MutationCommitted: false,
    OutcomeUncertain: true,
    IsIdempotentReplay: false,
    ErrorCode: "write_outcome_unknown",
    Provenance: [],
    BrokerExternalEgressBytes: BrokerReservation,
    BrokerMaxDeliverySessions: BrokerDeliverySessions,
    BrokerMaxRequestAttemptsPerSession: BrokerRequestAttempts,
    BrokerSerializedResultUpperBoundBytes: BrokerResultUpperBoundBytes,
    UncertainExternalEgressBytes: MaximumEgress - BrokerReservation,
    ActionTokenSha256: PayloadDigest.Sha256Hex("signed-token"));

  private static JsonObject ParseLine(string line) =>
    JsonNode.Parse(line)?.AsObject()
      ?? throw new InvalidOperationException("Journal test line was null JSON.");

  private static JsonObject Rechain(
    JsonObject line,
    long sequence,
    string previousHash)
  {
    line["sequence"] = sequence;
    line["previousHash"] = previousHash;
    var payloadJson = line["payloadJson"]!.GetValue<string>();
    var payloadSha256 = PayloadDigest.Sha256Hex(payloadJson);
    line["payloadSha256"] = payloadSha256;
    var hashVersion = line["hashVersion"]?.GetValue<int>() ?? 1;
    var material = hashVersion == 2
      ? JsonSerializer.Serialize(new
      {
        HashVersion = hashVersion,
        Sequence = sequence,
        OccurredAtUnixMilliseconds =
          line["occurredAtUnixMilliseconds"]!.GetValue<long>(),
        Kind = line["kind"]!.GetValue<int>(),
        ActionId = line["actionId"]!.GetValue<string>(),
        IdempotencyKey = line["idempotencyKey"]!.GetValue<string>(),
        PreviousHash = previousHash,
        PayloadSha256 = payloadSha256,
      }, WebJson)
      : JsonSerializer.Serialize(new
      {
        Sequence = sequence,
        OccurredAtUnixMilliseconds =
          line["occurredAtUnixMilliseconds"]!.GetValue<long>(),
        Kind = line["kind"]!.GetValue<int>(),
        ActionId = line["actionId"]!.GetValue<string>(),
        IdempotencyKey = line["idempotencyKey"]!.GetValue<string>(),
        PreviousHash = previousHash,
        PayloadSha256 = payloadSha256,
        PayloadJson = payloadJson,
      }, WebJson);
    line["entryHash"] = PayloadDigest.Sha256Hex(material);
    return line;
  }

  public void Dispose()
  {
    if (Directory.Exists(_directory))
    {
      Directory.Delete(_directory, recursive: true);
    }
  }
}
