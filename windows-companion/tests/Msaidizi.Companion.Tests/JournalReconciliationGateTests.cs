using System.Globalization;
using System.Runtime.CompilerServices;
using Itemba.Msaidizi.Companion.Contracts.Channel;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Journal;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Journal;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class JournalReconciliationGateTests
{
  private static readonly int[] ExpectedRangeCounts = [128, 2];

  [Fact]
  public async Task ReconcilesBoundedContiguousRangesAndReconfirmsOnReconnect()
  {
    var journal = new DigestJournal(Enumerable.Range(1, 130).Select(CreateRecord).ToArray());
    var channel = new RecordingChannel();
    using var gate = new JournalReconciliationGate(
      Options.Create(new CompanionOptions { DeviceId = "device-1" }),
      journal,
      channel);

    await gate.ReconcileExactHeadAsync(CancellationToken.None);

    Assert.Equal(
      ExpectedRangeCounts,
      channel.Requests.Select(request => request.Entries.Count).ToArray());
    Assert.All(channel.Requests, request =>
      Assert.InRange(request.Entries.Count, 0, JournalReconciliationContract.MaximumEntriesPerRange));
    Assert.True(gate.IsExactHeadReconciled(journal.Head));

    await gate.ReconcileExactHeadAsync(CancellationToken.None);

    var reconnect = channel.Requests[^1];
    Assert.Empty(reconnect.Entries);
    Assert.Equal(journal.Head.Sequence, reconnect.StartingPreviousSequence);
    Assert.Equal(reconnect.FinalSequence, reconnect.LocalHeadSequence);
    Assert.True(gate.IsExactHeadReconciled(journal.Head));
  }

  [Fact]
  public async Task FailsClosedWhenAcknowledgementDoesNotBindTheRequestedHead()
  {
    var journal = new DigestJournal([CreateRecord(1)]);
    var channel = new RecordingChannel { ReturnWrongDevice = true };
    using var gate = new JournalReconciliationGate(
      Options.Create(new CompanionOptions { DeviceId = "device-1" }),
      journal,
      channel);

    await Assert.ThrowsAsync<InvalidDataException>(async () =>
      await gate.ReconcileExactHeadAsync(CancellationToken.None));
    Assert.False(gate.IsExactHeadReconciled(journal.Head));
  }

  [Fact]
  public async Task LocalTerminalAdvanceInvalidatesFreshnessUntilTheNextExactAck()
  {
    var journal = new DigestJournal([CreateRecord(1)]);
    var channel = new RecordingChannel();
    using var gate = new JournalReconciliationGate(
      Options.Create(new CompanionOptions { DeviceId = "device-1" }),
      journal,
      channel);
    await gate.ReconcileExactHeadAsync(CancellationToken.None);
    Assert.True(gate.IsExactHeadReconciled(journal.Head));

    journal.Append(CreateRecord(2));

    Assert.False(gate.IsExactHeadReconciled(journal.Head));
    await gate.ReconcileExactHeadAsync(CancellationToken.None);
    Assert.Equal(2, channel.Requests[^1].FinalSequence);
    Assert.True(gate.IsExactHeadReconciled(journal.Head));
  }

  [Fact]
  public async Task RestartResumesFromCentralHeadInsteadOfReplayingGenesis()
  {
    var journal = new DigestJournal(Enumerable.Range(1, 130).Select(CreateRecord).ToArray());
    var channel = new RecordingChannel();
    channel.SetCentralHead(new JournalHead(128, CreateRecord(128).EntryHash), 2);
    using var gate = new JournalReconciliationGate(
      Options.Create(new CompanionOptions { DeviceId = "device-1" }),
      journal,
      channel);

    await gate.ReconcileExactHeadAsync(CancellationToken.None);

    var request = Assert.Single(channel.Requests);
    Assert.Equal(128, request.StartingPreviousSequence);
    Assert.Equal(2, request.Entries.Count);
    Assert.True(gate.IsExactHeadReconciled(journal.Head));
  }

  [Fact]
  public async Task FailsClosedWhenCentralHeadIsNotInTheVerifiedLocalChain()
  {
    var journal = new DigestJournal([CreateRecord(1)]);
    var channel = new RecordingChannel();
    channel.SetCentralHead(new JournalHead(1, new string('f', 64)), 2);
    using var gate = new JournalReconciliationGate(
      Options.Create(new CompanionOptions { DeviceId = "device-1" }),
      journal,
      channel);

    await Assert.ThrowsAsync<InvalidDataException>(async () =>
      await gate.ReconcileExactHeadAsync(CancellationToken.None));
    Assert.Empty(channel.Requests);
    Assert.False(gate.IsExactHeadReconciled(journal.Head));
  }

  private static JournalRecord CreateRecord(int sequence)
  {
    var previousHash = sequence == 1
      ? new string('0', 64)
      : (sequence - 1).ToString("x64", CultureInfo.InvariantCulture);
    return new JournalRecord(
      sequence,
      new DateTimeOffset(2026, 8, 27, 10, 0, 0, TimeSpan.Zero).AddMilliseconds(sequence),
      JournalEntryKind.Prepared,
      $"action-{sequence}",
      $"idempotency-{sequence}",
      previousHash,
      (sequence + 1_000).ToString("x64", CultureInfo.InvariantCulture),
      sequence.ToString("x64", CultureInfo.InvariantCulture));
  }

  private sealed class DigestJournal : IActionJournal
  {
    private readonly List<JournalRecord> _records;

    public DigestJournal(IEnumerable<JournalRecord> records)
    {
      _records = records.ToList();
    }

    public JournalHead Head => _records.Count == 0
      ? new JournalHead(0, new string('0', 64))
      : new JournalHead(_records[^1].Sequence, _records[^1].EntryHash);

    public void Append(JournalRecord record) => _records.Add(record);

    public ValueTask InitializeAsync(CancellationToken cancellationToken) => ValueTask.CompletedTask;

    public ValueTask<JournalBeginResult> TryBeginAsync(
      ActionRequest request,
      string compactTokenSha256,
      long maximumExternalEgressBytes,
      long reservedBrokerExternalEgressBytes,
      int brokerMaxDeliverySessions,
      int brokerMaxRequestAttemptsPerSession,
      long brokerSerializedResultUpperBoundBytes,
      CancellationToken cancellationToken) => throw new NotSupportedException();

    public ValueTask<JournalTerminalReceipt?> TryGetTerminalAsync(
      ActionRequest request,
      CancellationToken cancellationToken) => throw new NotSupportedException();

    public ValueTask<JournalRecord> AppendRecoveryPreparedAsync(
      JournalRecoveryPreparedCheckpoint checkpoint,
      CancellationToken cancellationToken) => throw new NotSupportedException();

    public ValueTask<JournalTerminalReceipt> AppendTerminalAsync(
      ActionRequest request,
      ActionResult result,
      JournalEntryKind kind,
      CancellationToken cancellationToken) => throw new NotSupportedException();

    public ValueTask<JournalHead> GetHeadAsync(CancellationToken cancellationToken) =>
      ValueTask.FromResult(Head);

    public ValueTask<JournalRecordRange> ReadRangeAsync(
      long afterSequence,
      int maximumEntries,
      CancellationToken cancellationToken)
    {
      var predecessor = afterSequence == 0
        ? new JournalHead(0, new string('0', 64))
        : new JournalHead(afterSequence, _records[checked((int)afterSequence - 1)].EntryHash);
      var entries = _records.Skip(checked((int)afterSequence)).Take(maximumEntries).ToArray();
      var final = entries.Length == 0
        ? predecessor
        : new JournalHead(entries[^1].Sequence, entries[^1].EntryHash);
      return ValueTask.FromResult(new JournalRecordRange(predecessor, entries, final, Head));
    }

    public ValueTask<JournalVerificationResult> VerifyAsync(CancellationToken cancellationToken) =>
      ValueTask.FromResult(new JournalVerificationResult(true, _records.Count, null, null));
  }

  private sealed class RecordingChannel : IOutboundCompanionChannel
  {
    private JournalHead _centralHead = new(0, new string('0', 64));
    private int _centralHashVersion;

    public List<JournalReconciliationRequest> Requests { get; } = [];
    public bool ReturnWrongDevice { get; init; }
    public OutboundChannelState State => OutboundChannelState.Connected;
    public bool IsCentralLedgerConnected => true;
    public ValueTask ConnectAsync(CancellationToken cancellationToken) => ValueTask.CompletedTask;

    public void SetCentralHead(JournalHead head, int hashVersion)
    {
      _centralHead = head;
      _centralHashVersion = hashVersion;
    }

    public ValueTask<JournalCentralHead> GetJournalHeadAsync(
      JournalCentralHeadRequest request,
      CancellationToken cancellationToken) => ValueTask.FromResult(new JournalCentralHead(
        request.DeviceId,
        _centralHead.Sequence,
        _centralHashVersion,
        _centralHead.EntryHash));

    public ValueTask<JournalReconciliationAcknowledgement> ReconcileJournalAsync(
      JournalReconciliationRequest request,
      CancellationToken cancellationToken)
    {
      Requests.Add(request);
      _centralHead = new JournalHead(request.FinalSequence, request.FinalHash);
      if (request.Entries.Count > 0)
      {
        _centralHashVersion = request.Entries[request.Entries.Count - 1].HashVersion;
      }
      return ValueTask.FromResult(new JournalReconciliationAcknowledgement(
        true,
        ReturnWrongDevice ? "other-device" : request.DeviceId,
        request.StartingPreviousSequence,
        request.StartingPreviousHash,
        request.FinalSequence,
        request.FinalHash,
        request.LocalHeadSequence,
        request.LocalHeadHash,
        request.FinalSequence == request.LocalHeadSequence));
    }

    public async IAsyncEnumerable<DeviceCommand> ReadCommandsAsync(
      [EnumeratorCancellation] CancellationToken cancellationToken)
    {
      await Task.CompletedTask;
      yield break;
    }

    public ValueTask<ActionProgressAcknowledgement> SendProgressAsync(
      ActionProgress progress,
      CancellationToken cancellationToken) => throw new NotSupportedException();

    public ValueTask SendResultAsync(ActionResult result, CancellationToken cancellationToken) =>
      ValueTask.CompletedTask;

    public ValueTask SendHeartbeatAsync(
      CompanionHeartbeat heartbeat,
      CancellationToken cancellationToken) => ValueTask.CompletedTask;

    public ValueTask SendManifestAsync(
      CapabilityManifestSnapshot manifest,
      CancellationToken cancellationToken) => ValueTask.CompletedTask;

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
  }
}
