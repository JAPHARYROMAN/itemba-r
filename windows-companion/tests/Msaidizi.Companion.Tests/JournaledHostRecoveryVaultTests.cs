using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Journal;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Journal;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class JournaledHostRecoveryVaultTests : IDisposable
{
  private const long MaximumEgress = 100_000;
  private const long BrokerReservation = 10_000;
  private const int BrokerDeliverySessions = 2;
  private const int BrokerRequestAttempts = 2;
  private const long BrokerResultUpperBoundBytes = 2_500;

  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"msaidizi-journaled-recovery-tests-{Guid.NewGuid():N}");

  [Fact]
  public async Task PreparePersistsDigestOnlyCheckpointBeforeReturningReceipt()
  {
    var journalPath = Path.Combine(_directory, "prepared.jsonl");
    var vaultPath = Path.Combine(_directory, "vault");
    var preState = PayloadDigest.Sha256Hex("pre-state");
    var request = ActionTokenVerifierTests.CreateRequest("{}") with
    {
      ExpectedPreStateSha256 = preState,
    };
    using var journal = new FileHashChainActionJournal(journalPath);
    await journal.InitializeAsync(CancellationToken.None);
    await BeginAsync(journal, request);
    var inner = new FileHostRecoveryVault(Options.Create(new HostCapabilityOptions
    {
      RecoveryVaultPath = vaultPath,
    }));
    var vault = new JournaledHostRecoveryVault(inner, journal);
    const string secretRecoveryContent = "TOP-SECRET-RECOVERY-CONTENT";

    var receipt = await vault.PrepareAsync(
      Context(request),
      "windows.service.start-mode.set",
      preState,
      new { startMode = "manual", secretRecoveryContent },
      irreversible: false,
      CancellationToken.None);

    var head = await journal.GetHeadAsync(CancellationToken.None);
    var persisted = await File.ReadAllTextAsync(journalPath);
    Assert.Equal(2L, head.Sequence);
    Assert.True((await journal.VerifyAsync(CancellationToken.None)).IsValid);
    Assert.True(File.Exists(receipt.RecordPath));
    Assert.Contains(receipt.RecordSha256, persisted, StringComparison.Ordinal);
    Assert.Contains(
      PayloadDigest.Sha256Hex(receipt.OpaqueHandle),
      persisted,
      StringComparison.Ordinal);
    Assert.DoesNotContain(receipt.OpaqueHandle, persisted, StringComparison.Ordinal);
    Assert.DoesNotContain(receipt.RecordPath, persisted, StringComparison.Ordinal);
    Assert.DoesNotContain(secretRecoveryContent, persisted, StringComparison.Ordinal);
    var recovered = await inner.ReadAsync(
      request.ActionId,
      receipt.RecordSha256,
      CancellationToken.None);
    Assert.Equal(secretRecoveryContent, recovered.RecoveryRecord
      .GetProperty("secretRecoveryContent").GetString());
  }

  [Fact]
  public async Task AmbiguousCheckpointAppendFaultsJournalAndPreventsNativeServiceSet()
  {
    var journalPath = Path.Combine(_directory, "ambiguous.jsonl");
    var vaultPath = Path.Combine(_directory, "ambiguous-vault");
    const string argumentsJson =
      "{\"serviceId\":\"business-worker\",\"startMode\":\"disabled\"}";
    var policy = WindowsServiceStartModeCapabilityTests.Policy(["disabled"]);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    var preState = WindowsServiceStartModeSupport.Snapshot(target, "manual").StateSha256;
    var request = ActionTokenVerifierTests.CreateRequest(argumentsJson) with
    {
      CapabilityId = "windows.service.start-mode.set",
      ExpectedPreStateSha256 = preState,
    };
    var appendCount = 0;
    using (var journal = new FileHashChainActionJournal(
      journalPath,
      async (path, bytes, cancellationToken) =>
      {
        await AppendDurablyAsync(path, bytes, cancellationToken);
        if (Interlocked.Increment(ref appendCount) == 2)
        {
          throw new IOException(
            "Simulated recovery-checkpoint acknowledgement loss after durable append.");
        }
      }))
    {
      await journal.InitializeAsync(CancellationToken.None);
      await BeginAsync(journal, request);
      var vault = new JournaledHostRecoveryVault(
        new FileHostRecoveryVault(Options.Create(new HostCapabilityOptions
        {
          RecoveryVaultPath = vaultPath,
        })),
        journal);
      var manager = new WindowsServiceStartModeCapabilityTests
        .RecordingStartModeManager("manual");
      var adapter = new WindowsServiceStartModeSetCapabilityAdapter(
        policy,
        manager,
        vault);

      await Assert.ThrowsAsync<IOException>(async () => await adapter.ExecuteAsync(
        Context(request),
        JsonDocument.Parse(argumentsJson).RootElement,
        CancellationToken.None));

      Assert.Equal(0, manager.SetCount);
      Assert.Equal("manual", manager.CurrentMode);
      var fault = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        await journal.GetHeadAsync(CancellationToken.None));
      Assert.Contains("requires process restart", fault.Message, StringComparison.Ordinal);
      Assert.Equal(2, File.ReadLines(journalPath).Count());
    }

    using var restarted = new FileHashChainActionJournal(journalPath);
    await restarted.InitializeAsync(CancellationToken.None);
    var replay = await BeginAsync(restarted, request);
    Assert.Equal(JournalBeginDisposition.TerminalReplay, replay.Disposition);
    Assert.Equal(ActionOutcome.NeedsAttention, replay.TerminalReceipt!.Outcome);
    Assert.True(replay.TerminalReceipt.OutcomeUncertain);
    Assert.Equal(preState, replay.TerminalReceipt.PreStateSha256);
    Assert.True(PayloadDigest.IsSha256Hex(
      replay.TerminalReceipt.RecoveryProvenanceSha256 ?? string.Empty));
    Assert.True(PayloadDigest.IsSha256Hex(
      replay.TerminalReceipt.RecoveryHandleSha256 ?? string.Empty));
    Assert.Equal(2L, replay.TerminalReceipt.JournalRecoveryPreparedSequence);
    Assert.Equal(
      replay.TerminalReceipt.JournalRecoveryPreparedEntryHash,
      replay.TerminalReceipt.JournalPreviousHash);
    Assert.True((await restarted.VerifyAsync(CancellationToken.None)).IsValid);
  }

  [Fact]
  public async Task OversizedRecoveryRecordIsRejectedBeforeCheckpoint()
  {
    var journalPath = Path.Combine(_directory, "oversized.jsonl");
    var vaultPath = Path.Combine(_directory, "oversized-vault");
    var preState = PayloadDigest.Sha256Hex("pre-state");
    var request = ActionTokenVerifierTests.CreateRequest("{}") with
    {
      ExpectedPreStateSha256 = preState,
    };
    using var journal = new FileHashChainActionJournal(journalPath);
    await journal.InitializeAsync(CancellationToken.None);
    await BeginAsync(journal, request);
    var vault = new JournaledHostRecoveryVault(
      new FileHostRecoveryVault(Options.Create(new HostCapabilityOptions
      {
        RecoveryVaultPath = vaultPath,
      })),
      journal);

    var exception = await Assert.ThrowsAsync<HostRecoveryException>(async () =>
      await vault.PrepareAsync(
        Context(request),
        "windows.service.start-mode.set",
        preState,
        new { snapshot = new string('x', 4_194_304) },
        irreversible: false,
        CancellationToken.None));

    Assert.Equal("recovery_record_too_large", exception.ErrorCode);
    Assert.Equal(1L, (await journal.GetHeadAsync(CancellationToken.None)).Sequence);
    Assert.Single(File.ReadLines(journalPath));
    Assert.False(Directory.Exists(vaultPath)
      && Directory.EnumerateFiles(vaultPath, "*.bin").Any());
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

  private static ActionExecutionContext Context(ActionRequest request) => new(
    request.ActionId,
    request.TaskId,
    request.PlanVersionId,
    request.StepId,
    request.DeviceId,
    request.MandateId,
    request.IdempotencyKey,
    request.ExpectedPreStateSha256,
    request.InputProvenanceSha256,
    new ActionBudget(60, 10, 20, 10, 1_000_000, MaximumEgress, 1m));

  private static async ValueTask AppendDurablyAsync(
    string path,
    ReadOnlyMemory<byte> bytes,
    CancellationToken cancellationToken)
  {
    await using var stream = new FileStream(
      path,
      FileMode.Append,
      FileAccess.Write,
      FileShare.Read,
      4096,
      FileOptions.Asynchronous | FileOptions.WriteThrough);
    await stream.WriteAsync(bytes, cancellationToken);
    await stream.FlushAsync(cancellationToken);
    stream.Flush(flushToDisk: true);
  }

  public void Dispose()
  {
    if (Directory.Exists(_directory))
    {
      Directory.Delete(_directory, recursive: true);
    }
  }
}
