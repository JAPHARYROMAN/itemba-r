using System.Text.Json;
using System.Text.Json.Nodes;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Journal;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Journal;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class DurableActionFenceJournalTests : IDisposable
{
  private const long MaximumEgress = 100_000;
  private const long BrokerReservation = 10_000;
  private const int BrokerDeliverySessions = 2;
  private const int BrokerRequestAttempts = 2;
  private const long BrokerResultUpperBoundBytes = 2_500;
  private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"msaidizi-fence-journal-tests-{Guid.NewGuid():N}");

  [Fact]
  public async Task FenceRequiresExactPredecessorAndGenerationReplayReturnsStableTombstone()
  {
    var path = Path.Combine(_directory, "exact-predecessor.jsonl");
    using var journal = new FileHashChainActionJournal(path);
    await journal.InitializeAsync(CancellationToken.None);
    var head = await journal.GetHeadAsync(CancellationToken.None);
    var request = CreateFence(head);

    var wrongSequence = await journal.TryFenceAsync(
      request with { JournalPreviousSequence = head.Sequence + 1 },
      CancellationToken.None);
    var wrongHash = await journal.TryFenceAsync(
      request with { JournalPreviousHash = PayloadDigest.Sha256Hex("wrong-head") },
      CancellationToken.None);
    var fenced = await journal.TryFenceAsync(request, CancellationToken.None);
    var generationReplay = await journal.TryFenceAsync(
      request with
      {
        DispatchCount = 2,
        ExpiresAt = request.ExpiresAt.AddMinutes(1),
      },
      CancellationToken.None);

    Assert.Equal(JournalFenceDisposition.JournalPredecessorMismatch, wrongSequence.Disposition);
    Assert.Equal(JournalFenceDisposition.JournalPredecessorMismatch, wrongHash.Disposition);
    Assert.Equal(JournalFenceDisposition.FencedNoPrepared, fenced.Disposition);
    Assert.Equal(JournalFenceDisposition.AlreadyFencedNoPrepared, generationReplay.Disposition);
    var tombstone = Assert.IsType<JournalRecord>(fenced.TombstoneRecord);
    var replayedTombstone = Assert.IsType<JournalRecord>(generationReplay.TombstoneRecord);
    Assert.Equal(head.Sequence + 1, tombstone.Sequence);
    Assert.Equal(head.EntryHash, tombstone.PreviousHash);
    Assert.Equal(tombstone, replayedTombstone);
    Assert.Equal(tombstone.EntryHash, (await journal.GetHeadAsync(CancellationToken.None)).EntryHash);
  }

  [Fact]
  public async Task ReusingFenceIdentityForDifferentOldLeaseIsAConflict()
  {
    var path = Path.Combine(_directory, "fence-conflict.jsonl");
    using var journal = new FileHashChainActionJournal(path);
    await journal.InitializeAsync(CancellationToken.None);
    var request = CreateFence(await journal.GetHeadAsync(CancellationToken.None));
    var first = await journal.TryFenceAsync(request, CancellationToken.None);

    var conflict = await journal.TryFenceAsync(
      request with { OldLeaseId = "lease-2" },
      CancellationToken.None);

    Assert.Equal(JournalFenceDisposition.FencedNoPrepared, first.Disposition);
    Assert.Equal(JournalFenceDisposition.FenceConflict, conflict.Disposition);
    Assert.Null(conflict.TombstoneRecord);
    Assert.Equal(first.TombstoneRecord!.EntryHash,
      (await journal.GetHeadAsync(CancellationToken.None)).EntryHash);
  }

  [Fact]
  public async Task FenceRefusesAnActionThatAlreadyHasAPreparedRecord()
  {
    var path = Path.Combine(_directory, "prepared-refusal.jsonl");
    using var journal = new FileHashChainActionJournal(path);
    await journal.InitializeAsync(CancellationToken.None);
    var predecessor = await journal.GetHeadAsync(CancellationToken.None);
    var action = ActionTokenVerifierTests.CreateRequest("{}");
    var started = await BeginAsync(journal, action);

    var fenced = await journal.TryFenceAsync(
      CreateFence(predecessor) with
      {
        ActionId = action.ActionId,
        TaskId = action.TaskId,
        StepId = action.StepId,
      },
      CancellationToken.None);

    Assert.Equal(JournalBeginDisposition.Started, started.Disposition);
    Assert.Equal(JournalFenceDisposition.ActionAlreadyPrepared, fenced.Disposition);
    Assert.Null(fenced.TombstoneRecord);
    Assert.Equal(started.PreparedRecord!.EntryHash,
      (await journal.GetHeadAsync(CancellationToken.None)).EntryHash);
  }

  [Fact]
  public async Task RestartRestoresDeviceFenceFloorAndAllowsOnlyHigherTokens()
  {
    var path = Path.Combine(_directory, "restart-floor.jsonl");
    JournalRecord tombstone;
    using (var journal = new FileHashChainActionJournal(path))
    {
      await journal.InitializeAsync(CancellationToken.None);
      var fenced = await journal.TryFenceAsync(
        CreateFence(await journal.GetHeadAsync(CancellationToken.None), oldFencingToken: "7"),
        CancellationToken.None);
      tombstone = Assert.IsType<JournalRecord>(fenced.TombstoneRecord);
    }

    using var restarted = new FileHashChainActionJournal(path);
    await restarted.InitializeAsync(CancellationToken.None);
    var lower = CreateAction("6");
    var equal = CreateAction("7");
    var higher = CreateAction("8");

    Assert.True(await restarted.IsFencedAsync(lower, CancellationToken.None));
    Assert.True(await restarted.IsFencedAsync(equal, CancellationToken.None));
    Assert.False(await restarted.IsFencedAsync(higher, CancellationToken.None));
    Assert.Equal(
      JournalBeginDisposition.Fenced,
      (await BeginAsync(restarted, lower)).Disposition);
    Assert.Equal(
      JournalBeginDisposition.Fenced,
      (await BeginAsync(restarted, equal)).Disposition);
    Assert.Equal(
      JournalBeginDisposition.Started,
      (await BeginAsync(restarted, higher)).Disposition);
    var persistedFence = JsonNode.Parse((await File.ReadAllLinesAsync(path))[0])!.AsObject();
    Assert.Equal(tombstone.EntryHash, persistedFence["entryHash"]!.GetValue<string>());
  }

  [Fact]
  public async Task RechainedFencePayloadTamperingIsDetectedByStrictVerification()
  {
    var path = Path.Combine(_directory, "tampered-fence.jsonl");
    using var journal = new FileHashChainActionJournal(path);
    await journal.InitializeAsync(CancellationToken.None);
    await journal.TryFenceAsync(
      CreateFence(await journal.GetHeadAsync(CancellationToken.None)),
      CancellationToken.None);
    var line = JsonNode.Parse(Assert.Single(await File.ReadAllLinesAsync(path)))!.AsObject();
    var payload = JsonNode.Parse(line["payloadJson"]!.GetValue<string>())!.AsObject();
    payload["dispatchCount"] = 1;
    Rechain(line, JsonSerializer.Serialize(payload, WebJson));
    await File.WriteAllTextAsync(path, $"{JsonSerializer.Serialize(line, WebJson)}{Environment.NewLine}");

    var verification = await journal.VerifyAsync(CancellationToken.None);

    Assert.False(verification.IsValid);
    Assert.Equal(1, verification.InvalidSequence);
    Assert.Equal("journal_action_fence_malformed", verification.ErrorCode);
  }

  private static FenceActionRequest CreateFence(
    JournalHead predecessor,
    string oldFencingToken = "7") => new(
      FenceId: "fence-1",
      DeviceId: "device-1",
      ActionId: "action-1",
      TaskId: "task-1",
      StepId: "step-1",
      OldLeaseId: "lease-1",
      OldFencingToken: oldFencingToken,
      OldActionTokenSha256: PayloadDigest.Sha256Hex("old-action-token"),
      JournalPreviousSequence: predecessor.Sequence,
      JournalPreviousHash: predecessor.EntryHash,
      DispatchCount: 1,
      ExpiresAt: DateTimeOffset.UtcNow.AddMinutes(2));

  private static ActionRequest CreateAction(string fencingToken) =>
    ActionTokenVerifierTests.CreateRequest("{}") with
    {
      FencingToken = fencingToken,
      IdempotencyKey = $"idempotency-{fencingToken}",
    };

  private static ValueTask<JournalBeginResult> BeginAsync(
    FileHashChainActionJournal journal,
    ActionRequest request) => journal.TryBeginAsync(
      request,
      PayloadDigest.Sha256Hex($"signed-token-{request.FencingToken}"),
      MaximumEgress,
      BrokerReservation,
      BrokerDeliverySessions,
      BrokerRequestAttempts,
      BrokerResultUpperBoundBytes,
      CancellationToken.None);

  private static void Rechain(JsonObject line, string payloadJson)
  {
    line["payloadJson"] = payloadJson;
    var payloadSha256 = PayloadDigest.Sha256Hex(payloadJson);
    line["payloadSha256"] = payloadSha256;
    var material = JsonSerializer.Serialize(new
    {
      HashVersion = line["hashVersion"]!.GetValue<int>(),
      Sequence = line["sequence"]!.GetValue<long>(),
      OccurredAtUnixMilliseconds = line["occurredAtUnixMilliseconds"]!.GetValue<long>(),
      Kind = line["kind"]!.GetValue<int>(),
      ActionId = line["actionId"]!.GetValue<string>(),
      IdempotencyKey = line["idempotencyKey"]!.GetValue<string>(),
      PreviousHash = line["previousHash"]!.GetValue<string>(),
      PayloadSha256 = payloadSha256,
    }, WebJson);
    line["entryHash"] = PayloadDigest.Sha256Hex(material);
  }

  public void Dispose()
  {
    if (Directory.Exists(_directory))
    {
      Directory.Delete(_directory, recursive: true);
    }
  }
}
