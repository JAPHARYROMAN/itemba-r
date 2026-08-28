using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Agent.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Channel;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Journal;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Contracts.SessionBridge;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Execution;
using Itemba.Msaidizi.Companion.Service.Journal;
using Itemba.Msaidizi.Companion.Service.Security;
using Itemba.Msaidizi.Companion.Service.SessionBridge;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class ActionExecutionCoordinatorTests : IDisposable
{
  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"msaidizi-coordinator-tests-{Guid.NewGuid():N}");

  [Fact]
  public async Task CancellationStopsReadActionAndPersistsTerminalReceipt()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now);
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}");
    var adapter = new BlockingReadAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(Path.Combine(_directory, "actions.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);

    var execution = coordinator.ExecuteAsync(
      new SignedActionRequest(request, "test-token"),
      CancellationToken.None);
    await adapter.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
    var cancellationAccepted = coordinator.RequestCancellation(new CancelRequest(
      request.ActionId,
      request.TaskId,
      request.DeviceId,
      "operator_cancelled",
      DateTimeOffset.UtcNow));
    await execution.WaitAsync(TimeSpan.FromSeconds(5));

    Assert.True(cancellationAccepted);
    var result = Assert.Single(channel.Results);
    Assert.Equal(ActionOutcome.NeedsAttention, result.Outcome);
    Assert.Equal("cancelled_egress_outcome_unknown", result.ErrorCode);
    Assert.True(result.BrokerExternalEgressBytes > 0);
    Assert.Equal(
      claims.Budgets.MaxExternalEgressBytes,
      result.ExternalEgressBytes
        + result.BrokerExternalEgressBytes
        + result.UncertainExternalEgressBytes);
    Assert.Equal(1L, result.JournalPrepareSequence);
    Assert.Equal(
      result.JournalPrepareEntryHash,
      result.JournalPreviousHash);
    Assert.Equal(2L, result.JournalSequence);
    Assert.Equal(0, coordinator.RunningActionCount);
  }

  [Fact]
  public async Task RunningActionEmitsLeaseHeartbeatBeforeItsSignedAuthorizationExpires()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now);
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}");
    var adapter = new BlockingReadAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(Path.Combine(_directory, "lease-heartbeat.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);

    var execution = coordinator.ExecuteAsync(
      new SignedActionRequest(request, "test-token"),
      CancellationToken.None);
    await adapter.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
    await channel.LeaseHeartbeatObserved.Task.WaitAsync(TimeSpan.FromSeconds(5));

    Assert.Contains(
      channel.Progress,
      progress => progress.State == ActionProgressState.Started
        && progress.MessageCode == "lease_heartbeat"
        && progress.LeaseId == request.LeaseId
        && progress.FencingToken == request.FencingToken
        && progress.LeaseExpiresAt == request.LeaseExpiresAt);

    Assert.True(coordinator.RequestCancellation(new CancelRequest(
      request.ActionId,
      request.TaskId,
      request.DeviceId,
      "operator_cancelled",
      DateTimeOffset.UtcNow)));
    await execution.WaitAsync(TimeSpan.FromSeconds(5));
  }

  [Fact]
  public async Task RunningPrivilegedMutationCannotUseLegacyConfigToSurviveLedgerLoss()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now) with
    {
      CapabilityId = "example.blocking-mutation",
    };
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
    {
      CapabilityId = request.CapabilityId,
    };
    var adapter = new BlockingMutationAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "ledger-disconnect.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(
      adapter,
      channel,
      journal,
      claims,
      requireCentralLedgerForMutations: false);

    var execution = coordinator.ExecuteAsync(
      new SignedActionRequest(request, "test-token"),
      CancellationToken.None);
    await adapter.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
    channel.DisconnectLedger();
    await execution.WaitAsync(TimeSpan.FromSeconds(5));

    var result = Assert.Single(channel.Results);
    Assert.Equal(ActionOutcome.NeedsAttention, result.Outcome);
    Assert.Equal("cancelled_write_outcome_unknown", result.ErrorCode);
    Assert.True(result.OutcomeUncertain);
    Assert.Equal(0, coordinator.RunningActionCount);
  }

  [Fact]
  public async Task IsolationUnsafeFailurePersistsNeedsAttentionThenEscapesCoordinator()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now) with
    {
      CapabilityId = "example.isolation-unsafe",
    };
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
    {
      CapabilityId = request.CapabilityId,
    };
    var latch = new PrivilegedCommandIsolationDispatchLatch();
    var adapter = new IsolationUnsafeMutationAdapter(latch);
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "isolation-unsafe.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(
      adapter,
      channel,
      journal,
      claims,
      isolationDispatchLatch: latch);

    var failure = await Assert.ThrowsAsync<PrivilegedCommandIsolationUnsafeException>(() =>
      coordinator.ExecuteAsync(
        new SignedActionRequest(request, "test-token"),
        CancellationToken.None));

    Assert.Equal("trusted_root_isolation_terminal_receipt_invalid", failure.ErrorCode);
    Assert.True(latch.IsTripped);
    var result = Assert.Single(channel.Results);
    Assert.Equal(ActionOutcome.NeedsAttention, result.Outcome);
    Assert.Equal(failure.ErrorCode, result.ErrorCode);
    Assert.True(result.MutationCommitted);
    Assert.True(result.OutcomeUncertain);
    Assert.Equal(2L, result.JournalSequence);
    Assert.Equal(0, coordinator.RunningActionCount);
  }

  [Fact]
  public async Task MutationIsRejectedBeforeAdapterWhenLedgerIsDisconnected()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now) with
    {
      CapabilityId = "example.mutation",
    };
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
    {
      CapabilityId = "example.mutation",
    };
    var adapter = new RecordingMutationAdapter();
    var channel = new RecordingChannel(ledgerConnected: false);
    using var journal = new FileHashChainActionJournal(Path.Combine(_directory, "actions.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);

    await coordinator.ExecuteAsync(
      new SignedActionRequest(request, "test-token"),
      CancellationToken.None);

    Assert.False(adapter.WasInvoked);
    var result = Assert.Single(channel.Results);
    Assert.Equal(ActionOutcome.Rejected, result.Outcome);
    Assert.Equal("central_ledger_disconnected", result.ErrorCode);
    Assert.True(result.BrokerExternalEgressBytes > 0);
    Assert.Equal(1L, result.JournalPrepareSequence);
    Assert.Equal(2L, result.JournalSequence);
    Assert.Equal(2L, (await journal.GetHeadAsync(CancellationToken.None)).Sequence);
  }

  [Fact]
  public async Task ClipboardWritePublishesNoRecoveryEvidenceThroughCoordinator()
  {
    const string previous = "prior clipboard";
    const string replacement = "replacement clipboard";
    var argumentsJson = JsonSerializer.Serialize(new { text = replacement });
    var now = DateTimeOffset.UtcNow;
    var expectedPreState = ClipboardTextReadCapabilityAdapter.ClipboardState(previous);
    var descriptor = StandardUserCapabilityCatalog.ClipboardWrite;
    var request = ActionTokenVerifierTests.CreateRequest(argumentsJson, now) with
    {
      CapabilityId = descriptor.Id,
      CapabilityVersion = descriptor.Version,
      ExpectedPreStateSha256 = expectedPreState,
    };
    var claims = ActionTokenVerifierTests.CreateClaims(now, argumentsJson) with
    {
      CapabilityId = descriptor.Id,
      CapabilityVersion = descriptor.Version,
      ExpectedPreStateSha256 = expectedPreState,
      ConsentGrant = "active_user",
    };
    var writes = 0;
    var adapter = new ClipboardTextWriteCapabilityAdapter(
      _ => Task.FromResult(previous),
      (_, cancellationToken) =>
      {
        cancellationToken.ThrowIfCancellationRequested();
        writes++;
        return Task.CompletedTask;
      });
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "clipboard-write-irreversible.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);

    await coordinator.ExecuteAsync(
      new SignedActionRequest(request, "test-token"),
      CancellationToken.None);

    Assert.Equal(1, writes);
    var result = Assert.Single(channel.Results);
    Assert.Equal(ActionOutcome.Completed, result.Outcome);
    Assert.True(result.MutationCommitted);
    Assert.False(result.OutcomeUncertain);
    Assert.Equal(expectedPreState, result.PreStateSha256);
    Assert.Null(result.RecoveryHandleSha256);
    Assert.Null(result.RecoveryProvenanceSha256);
    Assert.Null(result.JournalRecoveryPreparedSequence);
    Assert.Null(result.JournalRecoveryPreparedEntryHash);
    Assert.Null(result.JournalRecoveryPreparedPreviousHash);
  }

  [Fact]
  public async Task LegacyConfigurationCannotDisableTheMutationLedgerInvariant()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now) with
    {
      CapabilityId = "example.mutation",
    };
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
    {
      CapabilityId = request.CapabilityId,
    };
    var adapter = new RecordingMutationAdapter();
    var channel = new RecordingChannel(ledgerConnected: false);
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "disabled-ledger-policy.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(
      adapter,
      channel,
      journal,
      claims,
      requireCentralLedgerForMutations: false);

    await coordinator.ExecuteAsync(
      new SignedActionRequest(request, "test-token"),
      CancellationToken.None);

    Assert.False(adapter.WasInvoked);
    Assert.Equal("central_ledger_disconnected", Assert.Single(channel.Results).ErrorCode);
  }

  [Fact]
  public async Task MutationRequiresAcknowledgedStartedProgressAndReplaysKnownNoEffectFailure()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now) with
    {
      CapabilityId = "example.mutation",
    };
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
    {
      CapabilityId = request.CapabilityId,
    };
    var adapter = new RecordingMutationAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    channel.FailNextActionStartedAcknowledgement();
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "started-ack-failure.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);
    var signed = new SignedActionRequest(request, "test-token");

    await coordinator.ExecuteAsync(signed, CancellationToken.None);

    Assert.False(adapter.WasInvoked);
    var failure = Assert.Single(channel.Results);
    Assert.Equal(ActionOutcome.Failed, failure.Outcome);
    Assert.Equal(
      "central_ledger_not_acknowledged_before_execution",
      failure.ErrorCode);
    Assert.False(failure.MutationCommitted);
    Assert.False(failure.OutcomeUncertain);
    Assert.Equal(1L, failure.JournalPrepareSequence);
    Assert.Equal(2L, failure.JournalSequence);
    Assert.Equal(2L, (await journal.GetHeadAsync(CancellationToken.None)).Sequence);

    channel.ConnectLedger();
    await coordinator.ExecuteAsync(signed, CancellationToken.None);

    Assert.False(adapter.WasInvoked);
    Assert.Equal(2, channel.Results.Count);
    var replay = channel.Results[1];
    Assert.True(replay.IsIdempotentReplay);
    Assert.Equal(failure.Outcome, replay.Outcome);
    Assert.Equal(failure.ErrorCode, replay.ErrorCode);
    Assert.Equal(failure.JournalEntryHash, replay.JournalEntryHash);
    Assert.Equal(2L, (await journal.GetHeadAsync(CancellationToken.None)).Sequence);
  }

  [Theory]
  [InlineData("generic")]
  [InlineData("wrong-hash")]
  [InlineData("stale-generation")]
  public async Task MutationRejectsNonExactPreparedAcknowledgementBeforeAdapter(
    string acknowledgementKind)
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now) with
    {
      CapabilityId = "example.mutation",
    };
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
    {
      CapabilityId = request.CapabilityId,
    };
    var adapter = new RecordingMutationAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    switch (acknowledgementKind)
    {
      case "generic":
        channel.ReturnGenericNextActionStartedAcknowledgement();
        break;
      case "wrong-hash":
        channel.ReturnWrongHashNextActionStartedAcknowledgement();
        break;
      case "stale-generation":
        channel.ReturnStaleNextActionStartedAcknowledgement();
        break;
      default:
        throw new InvalidOperationException("Unknown acknowledgement fixture.");
    }
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, $"started-ack-{acknowledgementKind}.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);

    await coordinator.ExecuteAsync(
      new SignedActionRequest(request, "test-token"),
      CancellationToken.None);

    Assert.False(adapter.WasInvoked);
    var started = Assert.Single(
      channel.Progress,
      progress => string.Equals(progress.MessageCode, "action_started", StringComparison.Ordinal));
    Assert.Equal(1L, started.JournalPrepareSequence);
    Assert.Equal(new string('0', 64), started.JournalPreparePreviousHash);
    Assert.NotNull(started.JournalPrepareEntryHash);
    Assert.Equal(
      "central_ledger_not_acknowledged_before_execution",
      Assert.Single(channel.Results).ErrorCode);
  }

  [Fact]
  public async Task MutationDoesNotEnterAdapterWhenLedgerDropsAfterStartedAcknowledgement()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now) with
    {
      CapabilityId = "example.mutation",
    };
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
    {
      CapabilityId = request.CapabilityId,
    };
    var adapter = new RecordingMutationAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    channel.DisconnectAfterNextActionStartedAcknowledgement();
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "started-ack-disconnect.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);

    await coordinator.ExecuteAsync(
      new SignedActionRequest(request, "test-token"),
      CancellationToken.None);

    Assert.False(adapter.WasInvoked);
    var result = Assert.Single(channel.Results);
    Assert.Equal(ActionOutcome.Failed, result.Outcome);
    Assert.Equal(
      "central_ledger_not_acknowledged_before_execution",
      result.ErrorCode);
    Assert.False(result.MutationCommitted);
    Assert.False(result.OutcomeUncertain);
    Assert.Equal(2L, (await journal.GetHeadAsync(CancellationToken.None)).Sequence);
  }

  [Fact]
  public async Task ReadMayProceedWhenStartedProgressIsNotAcknowledged()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now);
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}");
    var adapter = new CountingAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    channel.FailNextActionStartedAcknowledgement();
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "read-started-ack-failure.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);

    await coordinator.ExecuteAsync(
      new SignedActionRequest(request, "test-token"),
      CancellationToken.None);

    Assert.Equal(1, adapter.InvocationCount);
    var result = Assert.Single(channel.Results);
    Assert.Equal(ActionOutcome.Completed, result.Outcome);
    Assert.False(result.MutationCommitted);
    Assert.False(result.OutcomeUncertain);
  }

  [Fact]
  public async Task IdempotentReplayReturnsExactPriorOutputWithoutExecutingAgain()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now);
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}");
    var adapter = new CountingAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(Path.Combine(_directory, "replay.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);
    var signed = new SignedActionRequest(request, "test-token");

    await coordinator.ExecuteAsync(signed, CancellationToken.None);
    await coordinator.ExecuteAsync(signed, CancellationToken.None);

    Assert.Equal(1, adapter.InvocationCount);
    Assert.Equal(2, channel.Results.Count);
    Assert.Equal("{\"value\":\"prior-result\"}", channel.Results[0].OutputJson);
    Assert.Equal(channel.Results[0].OutputJson, channel.Results[1].OutputJson);
    Assert.True(channel.Results[1].IsIdempotentReplay);
    Assert.Equal(channel.Results[0].JournalEntryHash, channel.Results[1].JournalEntryHash);
    Assert.Equal(17, channel.Results[0].ExternalEgressBytes);
    Assert.Equal(17, channel.Results[1].ExternalEgressBytes);
    Assert.Equal(
      channel.Results[0].BrokerExternalEgressBytes,
      channel.Results[1].BrokerExternalEgressBytes);
    Assert.True(
      channel.Results[0].BrokerExternalEgressBytes
        > System.Text.Encoding.UTF8.GetByteCount(channel.Results[0].OutputJson!) * 9L);
  }

  [Fact]
  public async Task ScheduledTaskMetadataReplayNeverPersistsDefinitionOrTargetArguments()
  {
    const string secret = "SCHEDULED_TASK_COORDINATOR_SECRET_4ce2";
    const string taskId = "finance-daily";
    const string taskPath = @"\Itemba\Finance\Daily";
    var xml = $$"""
      <?xml version="1.0" encoding="UTF-16"?>
      <Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
        <RegistrationInfo><URI>{{taskPath}}\{{secret}}</URI></RegistrationInfo>
        <Settings><Enabled>true</Enabled></Settings>
        <Actions Context="Author"><Exec>
          <Command>C:\Finance\daily.exe</Command>
          <Arguments>--password {{secret}} --token known-secret https://user:password@example.invalid/private C:\Users\Finance\credentials.txt</Arguments>
        </Exec></Actions>
      </Task>
      """;
    var definition = ScheduledTaskSupport.ParseDefinition(xml);
    var adapter = new ScheduledTaskMetadataProbeAdapter(
      new AllowedScheduledTask(
        taskId,
        taskPath,
        AllowRun: false,
        AllowEnableDisable: false),
      definition);
    const string argumentsJson = "{\"taskId\":\"finance-daily\"}";
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest(argumentsJson, now) with
    {
      CapabilityId = adapter.Descriptor.Id,
      CapabilityVersion = adapter.Descriptor.Version,
    };
    var claims = ActionTokenVerifierTests.CreateClaims(now, argumentsJson) with
    {
      CapabilityId = adapter.Descriptor.Id,
      CapabilityVersion = adapter.Descriptor.Version,
    };
    var channel = new RecordingChannel(ledgerConnected: true);
    var journalPath = Path.Combine(_directory, "scheduled-task-metadata.jsonl");
    var cachePath = Path.Combine(_directory, "scheduled-task-cache");
    using var journal = new FileHashChainActionJournal(journalPath);
    using var resultStore = new FileProtectedActionResultStore(Options.Create(
      new CompanionOptions { ResultCachePath = cachePath }));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(
      adapter,
      channel,
      journal,
      claims,
      resultStore: resultStore);
    var signed = new SignedActionRequest(request, "test-token");

    await coordinator.ExecuteAsync(signed, CancellationToken.None);
    await coordinator.ExecuteAsync(signed, CancellationToken.None);

    Assert.Equal(1, adapter.InvocationCount);
    Assert.Equal(2, channel.Results.Count);
    Assert.False(channel.Results[0].IsIdempotentReplay);
    Assert.True(channel.Results[1].IsIdempotentReplay);
    Assert.Equal(channel.Results[0].OutputJson, channel.Results[1].OutputJson);
    using (var output = JsonDocument.Parse(channel.Results[0].OutputJson!))
    {
      Assert.True(ScheduledTaskSchemas.ValidateDefinitionResult(
        output.RootElement).IsValid);
      Assert.Equal(3, output.RootElement.EnumerateObject().Count());
    }

    var persistedJournal = await File.ReadAllTextAsync(journalPath);
    var brokerPayloads = JsonSerializer.Serialize(new
    {
      channel.Results,
      channel.Progress,
    });
    var forbiddenValues = new[]
    {
      secret,
      "definitionXml",
      "--password",
      "known-secret",
      "https://user:password@example.invalid/private",
      @"C:\Users\Finance\credentials.txt",
      taskId,
      taskPath,
    };
    foreach (var forbidden in forbiddenValues)
    {
      Assert.DoesNotContain(forbidden, persistedJournal, StringComparison.Ordinal);
      Assert.DoesNotContain(forbidden, brokerPayloads, StringComparison.Ordinal);
    }

    Assert.True(Directory.Exists(cachePath));
    var cacheFiles = Directory.GetFiles(cachePath, "*", SearchOption.AllDirectories);
    Assert.NotEmpty(cacheFiles);
    foreach (var file in cacheFiles)
    {
      var protectedPayload = System.Text.Encoding.UTF8.GetString(
        await File.ReadAllBytesAsync(file));
      foreach (var forbidden in forbiddenValues)
      {
        Assert.DoesNotContain(forbidden, protectedPayload, StringComparison.Ordinal);
      }
    }
  }

  [Fact]
  public async Task ReplayResultCommandReturnsProtectedTerminalWithoutBeginningOrExecutingAgain()
  {
    var now = DateTimeOffset.UtcNow;
    var executeRequest = ActionTokenVerifierTests.CreateRequest("{}", now);
    var executeClaims = ActionTokenVerifierTests.CreateClaims(now, "{}");
    var replayRequest = executeRequest with
    {
      DispatchCount = 2,
      ExecutionMode = ActionExecutionModes.ReplayResultOnly,
    };
    var replayClaims = executeClaims with
    {
      DispatchCount = 2,
      ExecutionMode = ActionExecutionModes.ReplayResultOnly,
    };
    var adapter = new CountingAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    var resultStore = new InMemoryActionResultStore();
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "replay-result-only.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var executeCoordinator = CreateCoordinator(
      adapter,
      channel,
      journal,
      executeClaims,
      resultStore: resultStore);

    await executeCoordinator.ExecuteAsync(
      new SignedActionRequest(executeRequest, "execute-token"),
      CancellationToken.None);
    var terminalHead = await journal.GetHeadAsync(CancellationToken.None);

    using var replayCoordinator = CreateCoordinator(
      adapter,
      channel,
      journal,
      replayClaims,
      resultStore: resultStore);
    await replayCoordinator.ReplayResultAsync(
      new SignedActionRequest(replayRequest, "replay-token"),
      CancellationToken.None);

    Assert.Equal(1, adapter.InvocationCount);
    Assert.Equal(terminalHead, await journal.GetHeadAsync(CancellationToken.None));
    Assert.Equal(2, channel.Results.Count);
    Assert.False(channel.Results[0].IsIdempotentReplay);
    Assert.True(channel.Results[1].IsIdempotentReplay);
    Assert.Equal(channel.Results[0].OutputJson, channel.Results[1].OutputJson);
    Assert.Equal(channel.Results[0].JournalEntryHash, channel.Results[1].JournalEntryHash);
    Assert.Equal(replayRequest.LeaseId, channel.Results[1].LeaseId);
    Assert.Equal(replayRequest.FencingToken, channel.Results[1].FencingToken);
  }

  [Fact]
  public async Task ReplayResultWithoutTerminalIsAReadOnlyNoOp()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now) with
    {
      ExecutionMode = ActionExecutionModes.ReplayResultOnly,
    };
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
    {
      ExecutionMode = ActionExecutionModes.ReplayResultOnly,
    };
    var adapter = new CountingAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "missing-replay-terminal.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);

    await coordinator.ReplayResultAsync(
      new SignedActionRequest(request, "replay-token"),
      CancellationToken.None);

    Assert.Equal(0, adapter.InvocationCount);
    Assert.Empty(channel.Progress);
    Assert.Empty(channel.Results);
    Assert.Equal(0L, (await journal.GetHeadAsync(CancellationToken.None)).Sequence);
  }

  [Fact]
  public async Task ReplayResultWithoutProtectedTerminalBindingDoesNotSendOrExecute()
  {
    var now = DateTimeOffset.UtcNow;
    var executeRequest = ActionTokenVerifierTests.CreateRequest("{}", now);
    var executeClaims = ActionTokenVerifierTests.CreateClaims(now, "{}");
    var replayRequest = executeRequest with
    {
      DispatchCount = 2,
      ExecutionMode = ActionExecutionModes.ReplayResultOnly,
    };
    var replayClaims = executeClaims with
    {
      DispatchCount = 2,
      ExecutionMode = ActionExecutionModes.ReplayResultOnly,
    };
    var adapter = new CountingAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "missing-protected-replay.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using (var executeCoordinator = CreateCoordinator(
      adapter,
      channel,
      journal,
      executeClaims))
    {
      await executeCoordinator.ExecuteAsync(
        new SignedActionRequest(executeRequest, "execute-token"),
        CancellationToken.None);
    }
    var terminalHead = await journal.GetHeadAsync(CancellationToken.None);

    using var replayCoordinator = CreateCoordinator(
      adapter,
      channel,
      journal,
      replayClaims,
      resultStore: new InMemoryActionResultStore());
    await replayCoordinator.ReplayResultAsync(
      new SignedActionRequest(replayRequest, "replay-token"),
      CancellationToken.None);

    Assert.Equal(1, adapter.InvocationCount);
    Assert.Single(channel.Results);
    Assert.Equal(terminalHead, await journal.GetHeadAsync(CancellationToken.None));
  }

  [Fact]
  public async Task ReplayResultRejectsTokenExecutionModeMismatchWithoutJournalMutation()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now) with
    {
      ExecutionMode = ActionExecutionModes.ReplayResultOnly,
    };
    var executeClaims = ActionTokenVerifierTests.CreateClaims(now, "{}");
    var adapter = new CountingAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "replay-mode-mismatch.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(
      adapter,
      channel,
      journal,
      executeClaims);

    await coordinator.ReplayResultAsync(
      new SignedActionRequest(request, "wrong-mode-token"),
      CancellationToken.None);

    Assert.Equal(0, adapter.InvocationCount);
    Assert.Empty(channel.Results);
    Assert.Equal(0L, (await journal.GetHeadAsync(CancellationToken.None)).Sequence);
  }

  [Fact]
  public async Task CommandKindCannotInvokeTheOppositeExecutionModePath()
  {
    var now = DateTimeOffset.UtcNow;
    var executeRequest = ActionTokenVerifierTests.CreateRequest("{}", now);
    var executeClaims = ActionTokenVerifierTests.CreateClaims(now, "{}");
    var replayRequest = executeRequest with
    {
      ExecutionMode = ActionExecutionModes.ReplayResultOnly,
    };
    var replayClaims = executeClaims with
    {
      ExecutionMode = ActionExecutionModes.ReplayResultOnly,
    };
    var adapter = new CountingAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "wrong-command-mode-path.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);

    using (var replayClaimsCoordinator = CreateCoordinator(
      adapter,
      channel,
      journal,
      replayClaims))
    {
      await replayClaimsCoordinator.ExecuteAsync(
        new SignedActionRequest(replayRequest, "replay-token"),
        CancellationToken.None);
    }
    using (var executeClaimsCoordinator = CreateCoordinator(
      adapter,
      channel,
      journal,
      executeClaims))
    {
      await executeClaimsCoordinator.ReplayResultAsync(
        new SignedActionRequest(executeRequest, "execute-token"),
        CancellationToken.None);
    }

    Assert.Equal(0, adapter.InvocationCount);
    Assert.Empty(channel.Results);
    Assert.Equal(0L, (await journal.GetHeadAsync(CancellationToken.None)).Sequence);
  }

  [Fact]
  public async Task NormalExecuteDefaultsToExecuteModeAndStillRunsAdapter()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now);
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}");
    var adapter = new CountingAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "normal-execute-mode.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);

    await coordinator.ExecuteAsync(
      new SignedActionRequest(request, "execute-token"),
      CancellationToken.None);

    Assert.Equal(ActionExecutionModes.Execute, request.ExecutionMode);
    Assert.Equal(ActionExecutionModes.Execute, claims.ExecutionMode);
    Assert.Equal(1, adapter.InvocationCount);
    Assert.Equal(ActionOutcome.Completed, Assert.Single(channel.Results).Outcome);
    Assert.Equal(2L, (await journal.GetHeadAsync(CancellationToken.None)).Sequence);
  }

  [Fact]
  public async Task ScheduledRestartReplayNeverInvokesNativeBoundaryTwice()
  {
    var now = DateTimeOffset.UtcNow;
    var bootIdentifier = new Guid("97002dfb-1c30-4d27-b5c2-9f47fbdb9707");
    var expectedPreState = BootSessionReadCapabilityAdapter.State(
      "device-1",
      bootIdentifier);
    var request = ActionTokenVerifierTests.CreateRequest("{}", now) with
    {
      CapabilityId = "system.power.restart.schedule",
      ExpectedPreStateSha256 = expectedPreState,
    };
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
    {
      CapabilityId = "system.power.restart.schedule",
      ExpectedPreStateSha256 = expectedPreState,
      ConsentGrant = "one_shot_approval",
    };
    var manager = new SystemPowerCapabilityTests.RecordingSystemPowerManager(
      bootIdentifier);
    var adapter = new SystemRestartScheduleCapabilityAdapter(
      new SystemPowerPolicy(Options.Create(new SystemPowerOptions
      {
        Enabled = true,
        RestartDelaySeconds = 120,
      })),
      manager);
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "scheduled-restart-replay.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);

    var signedRequest = new SignedActionRequest(request, "test-token");
    await coordinator.ExecuteAsync(signedRequest, CancellationToken.None);
    await coordinator.ExecuteAsync(signedRequest, CancellationToken.None);

    Assert.Equal(1, manager.ScheduleCount);
    Assert.Equal(120, manager.LastDelaySeconds);
    Assert.Equal(2, channel.Results.Count);
    Assert.False(channel.Results[0].IsIdempotentReplay);
    Assert.True(channel.Results[1].IsIdempotentReplay);
    Assert.Equal(ActionOutcome.Completed, channel.Results[0].Outcome);
    Assert.Equal(channel.Results[0].OutputJson, channel.Results[1].OutputJson);
  }

  [Fact]
  public async Task ServiceStartModeReplayNeverInvokesNativeBoundaryTwice()
  {
    const string argumentsJson =
      "{\"serviceId\":\"business-worker\",\"startMode\":\"disabled\"}";
    var now = DateTimeOffset.UtcNow;
    var policy = WindowsServiceStartModeCapabilityTests.Policy(["disabled"]);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    var expectedPreState = WindowsServiceStartModeSupport.Snapshot(
      target,
      "manual").StateSha256;
    var request = ActionTokenVerifierTests.CreateRequest(argumentsJson, now) with
    {
      CapabilityId = "windows.service.start-mode.set",
      CapabilityVersion = "2.0.0",
      ExpectedPreStateSha256 = expectedPreState,
    };
    var claims = ActionTokenVerifierTests.CreateClaims(now, argumentsJson) with
    {
      CapabilityId = request.CapabilityId,
      CapabilityVersion = request.CapabilityVersion,
      ExpectedPreStateSha256 = expectedPreState,
      ConsentGrant = "one_shot_approval",
    };
    var manager = new WindowsServiceStartModeCapabilityTests
      .RecordingStartModeManager("manual");
    var adapter = new WindowsServiceStartModeSetCapabilityAdapter(
      policy,
      manager,
      new WindowsServiceStartModeCapabilityTests.RecordingRecoveryVault());
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "service-start-mode-replay.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);
    var signedRequest = new SignedActionRequest(request, "test-token");

    await coordinator.ExecuteAsync(signedRequest, CancellationToken.None);
    await coordinator.ExecuteAsync(signedRequest, CancellationToken.None);

    Assert.Equal(1, manager.SetCount);
    Assert.Equal("disabled", manager.CurrentMode);
    Assert.Equal(2, channel.Results.Count);
    Assert.Equal(ActionOutcome.Completed, channel.Results[0].Outcome);
    Assert.False(channel.Results[0].IsIdempotentReplay);
    Assert.True(channel.Results[1].IsIdempotentReplay);
    Assert.Equal(channel.Results[0].OutputJson, channel.Results[1].OutputJson);
  }

  [Fact]
  public async Task AmbiguousServiceStartModeCommitNeedsAttentionAndNeverRemutates()
  {
    const string argumentsJson =
      "{\"serviceId\":\"business-worker\",\"startMode\":\"disabled\"}";
    var now = DateTimeOffset.UtcNow;
    var policy = WindowsServiceStartModeCapabilityTests.Policy(["disabled"]);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    var expectedPreState = WindowsServiceStartModeSupport.Snapshot(
      target,
      "manual").StateSha256;
    var request = ActionTokenVerifierTests.CreateRequest(argumentsJson, now) with
    {
      CapabilityId = "windows.service.start-mode.set",
      CapabilityVersion = "2.0.0",
      ExpectedPreStateSha256 = expectedPreState,
    };
    var claims = ActionTokenVerifierTests.CreateClaims(now, argumentsJson) with
    {
      CapabilityId = request.CapabilityId,
      CapabilityVersion = request.CapabilityVersion,
      ExpectedPreStateSha256 = expectedPreState,
      ConsentGrant = "one_shot_approval",
    };
    var manager = new WindowsServiceStartModeCapabilityTests
      .RecordingStartModeManager("manual")
    {
      ThrowAfterSet = true,
    };
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "service-start-mode-ambiguous.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    var recoveryVault = new JournaledHostRecoveryVault(
      new FileHostRecoveryVault(Options.Create(new HostCapabilityOptions
      {
        RecoveryVaultPath = Path.Combine(
          _directory,
          "service-start-mode-ambiguous-recovery"),
      })),
      journal);
    var adapter = new WindowsServiceStartModeSetCapabilityAdapter(
      policy,
      manager,
      recoveryVault);
    var channel = new RecordingChannel(ledgerConnected: true);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);
    var signedRequest = new SignedActionRequest(request, "test-token");

    await coordinator.ExecuteAsync(signedRequest, CancellationToken.None);
    await coordinator.ExecuteAsync(signedRequest, CancellationToken.None);

    Assert.Equal(1, manager.SetCount);
    Assert.Equal("disabled", manager.CurrentMode);
    Assert.Equal(2, channel.Results.Count);
    Assert.Equal(ActionOutcome.NeedsAttention, channel.Results[0].Outcome);
    Assert.Equal("write_outcome_unknown", channel.Results[0].ErrorCode);
    Assert.True(channel.Results[0].OutcomeUncertain);
    Assert.False(channel.Results[0].IsIdempotentReplay);
    Assert.True(channel.Results[1].IsIdempotentReplay);
    Assert.Equal(channel.Results[0].ErrorCode, channel.Results[1].ErrorCode);
    Assert.Equal(expectedPreState, channel.Results[0].PreStateSha256);
    Assert.True(PayloadDigest.IsSha256Hex(
      channel.Results[0].RecoveryProvenanceSha256 ?? string.Empty));
    Assert.True(PayloadDigest.IsSha256Hex(
      channel.Results[0].RecoveryHandleSha256 ?? string.Empty));
    Assert.Equal(2L, channel.Results[0].JournalRecoveryPreparedSequence);
    Assert.True(PayloadDigest.IsSha256Hex(
      channel.Results[0].JournalRecoveryPreparedEntryHash ?? string.Empty));
    Assert.Equal(
      channel.Results[0].JournalPrepareEntryHash,
      channel.Results[0].JournalRecoveryPreparedPreviousHash);
    Assert.Equal(3L, channel.Results[0].JournalSequence);
    Assert.Equal(
      channel.Results[0].JournalRecoveryPreparedEntryHash,
      channel.Results[0].JournalPreviousHash);
    Assert.Equal(
      channel.Results[0].PreStateSha256,
      channel.Results[1].PreStateSha256);
    Assert.Equal(
      channel.Results[0].RecoveryProvenanceSha256,
      channel.Results[1].RecoveryProvenanceSha256);
    Assert.Equal(
      channel.Results[0].RecoveryHandleSha256,
      channel.Results[1].RecoveryHandleSha256);
    Assert.Equal(
      channel.Results[0].JournalRecoveryPreparedSequence,
      channel.Results[1].JournalRecoveryPreparedSequence);
    Assert.Equal(
      channel.Results[0].JournalRecoveryPreparedEntryHash,
      channel.Results[1].JournalRecoveryPreparedEntryHash);
    Assert.Equal(
      channel.Results[0].JournalRecoveryPreparedPreviousHash,
      channel.Results[1].JournalRecoveryPreparedPreviousHash);
  }

  [Fact]
  public async Task UnsupportedPostCommitServiceModeNeedsAttentionAndNeverRemutates()
  {
    const string argumentsJson =
      "{\"serviceId\":\"business-worker\",\"startMode\":\"disabled\"}";
    var now = DateTimeOffset.UtcNow;
    var policy = WindowsServiceStartModeCapabilityTests.Policy(["disabled"]);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    var expectedPreState = WindowsServiceStartModeSupport.Snapshot(
      target,
      "manual").StateSha256;
    var request = ActionTokenVerifierTests.CreateRequest(argumentsJson, now) with
    {
      CapabilityId = "windows.service.start-mode.set",
      CapabilityVersion = "2.0.0",
      ExpectedPreStateSha256 = expectedPreState,
    };
    var claims = ActionTokenVerifierTests.CreateClaims(now, argumentsJson) with
    {
      CapabilityId = request.CapabilityId,
      CapabilityVersion = request.CapabilityVersion,
      ExpectedPreStateSha256 = expectedPreState,
      ConsentGrant = "one_shot_approval",
    };
    var manager = new WindowsServiceStartModeCapabilityTests
      .RecordingStartModeManager("manual")
    {
      ThrowPreconditionOnPostSetRead = true,
    };
    var adapter = new WindowsServiceStartModeSetCapabilityAdapter(
      policy,
      manager,
      new WindowsServiceStartModeCapabilityTests.RecordingRecoveryVault());
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "service-start-mode-post-read.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);
    var signedRequest = new SignedActionRequest(request, "test-token");

    await coordinator.ExecuteAsync(signedRequest, CancellationToken.None);
    await coordinator.ExecuteAsync(signedRequest, CancellationToken.None);

    Assert.Equal(1, manager.SetCount);
    Assert.Equal("disabled", manager.CurrentMode);
    Assert.Equal(2, channel.Results.Count);
    Assert.Equal(ActionOutcome.NeedsAttention, channel.Results[0].Outcome);
    Assert.Equal("write_outcome_unknown", channel.Results[0].ErrorCode);
    Assert.True(channel.Results[0].OutcomeUncertain);
    Assert.False(channel.Results[0].IsIdempotentReplay);
    Assert.True(channel.Results[1].IsIdempotentReplay);
    Assert.Equal(channel.Results[0].ErrorCode, channel.Results[1].ErrorCode);
  }

  [Fact]
  public async Task TerminalReplayRemainsRunningUntilResultDeliveryFinishes()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now);
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}");
    var adapter = new CountingAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "tracked-terminal-replay.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);
    var signed = new SignedActionRequest(request, "test-token");

    await coordinator.ExecuteAsync(signed, CancellationToken.None);
    channel.BlockNextResult();
    var replay = coordinator.ExecuteAsync(signed, CancellationToken.None);
    await channel.ResultSendStarted.Task.WaitAsync(TimeSpan.FromSeconds(5));

    Assert.Equal(1, coordinator.RunningActionCount);
    channel.ReleaseBlockedResult();
    await replay.WaitAsync(TimeSpan.FromSeconds(5));
    Assert.Equal(0, coordinator.RunningActionCount);
  }

  [Fact]
  public async Task PrepaidDeliverySessionsAreDurablyCapped()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now);
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}");
    var adapter = new CountingAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(Path.Combine(_directory, "sessions.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);
    var signed = new SignedActionRequest(request, "test-token");

    await coordinator.ExecuteAsync(signed, CancellationToken.None);
    await coordinator.ExecuteAsync(signed, CancellationToken.None);
    await coordinator.ExecuteAsync(signed, CancellationToken.None);
    await coordinator.ExecuteAsync(signed, CancellationToken.None);

    Assert.Equal(1, adapter.InvocationCount);
    Assert.Equal(3, channel.Results.Count);
    Assert.All(
      channel.Results,
      result => Assert.Equal(
        channel.Results[0].BrokerExternalEgressBytes,
        result.BrokerExternalEgressBytes));
  }

  [Fact]
  public async Task RaisingLocalDeliverySettingsCannotExpandSignedSessionAllowance()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now);
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
    {
      Budgets = ActionTokenVerifierTests.CreateClaims(now, "{}")
        .Budgets with
      {
        BrokerMaxDeliverySessions = 1,
        BrokerMaxRequestAttemptsPerSession = 1,
        BrokerSerializedResultUpperBoundBytes = 1_048_576,
      },
    };
    var adapter = new CountingAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(Path.Combine(_directory, "signed-sessions.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);
    var signed = new SignedActionRequest(request, "test-token");

    await coordinator.ExecuteAsync(signed, CancellationToken.None);
    await coordinator.ExecuteAsync(signed, CancellationToken.None);
    await coordinator.ExecuteAsync(signed, CancellationToken.None);

    Assert.Equal(1, adapter.InvocationCount);
    Assert.Single(channel.Results);
    Assert.Equal(1, channel.Results[0].BrokerMaxDeliverySessions);
    Assert.Equal(1, channel.Results[0].BrokerMaxRequestAttemptsPerSession);
    Assert.Equal(1_048_576, channel.Results[0].BrokerExternalEgressBytes);
  }

  [Fact]
  public async Task MutationResultWithMismatchedObservedPreStateCannotComplete()
  {
    var now = DateTimeOffset.UtcNow;
    var expected = PayloadDigest.Sha256Hex("expected-state");
    var observed = PayloadDigest.Sha256Hex("different-state");
    var request = ActionTokenVerifierTests.CreateRequest("{}", now) with
    {
      CapabilityId = "example.pre-state-mutation",
      ExpectedPreStateSha256 = expected,
    };
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
    {
      CapabilityId = request.CapabilityId,
      ExpectedPreStateSha256 = expected,
    };
    var adapter = new MismatchedPreStateMutationAdapter(observed);
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(Path.Combine(_directory, "pre-state.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);

    await coordinator.ExecuteAsync(
      new SignedActionRequest(request, "test-token"),
      CancellationToken.None);

    var result = Assert.Single(channel.Results);
    Assert.True(adapter.WasInvoked);
    Assert.Equal(ActionOutcome.NeedsAttention, result.Outcome);
    Assert.Equal("capability_result_policy_invalid", result.ErrorCode);
    Assert.Equal(observed, result.PreStateSha256);
    Assert.Equal(2L, result.JournalSequence);
  }

  [Fact]
  public async Task AmbiguousTerminalPersistenceNeverAttemptsASecondTerminal()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now);
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}");
    var adapter = new CountingAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    var journal = new AmbiguousTerminalJournal(request);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);

    await Assert.ThrowsAnyAsync<Exception>(() => coordinator.ExecuteAsync(
      new SignedActionRequest(request, "test-token"),
      CancellationToken.None));

    Assert.Equal(1, adapter.InvocationCount);
    Assert.Equal(1, journal.TerminalAttempts);
    Assert.Empty(channel.Results);
  }

  [Fact]
  public async Task TooSmallBrokerReservationRefusesExecutionAndEmitsNothing()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now);
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
    {
      Budgets = ActionTokenVerifierTests.CreateClaims(now, "{}")
        .Budgets with
      {
        MaxExternalEgressBytes = System.Text.Encoding.UTF8.GetByteCount(
            "{\"value\":\"prior-result\"}") + 16,
      },
    };
    var adapter = new CountingAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(Path.Combine(_directory, "egress.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);

    await coordinator.ExecuteAsync(
      new SignedActionRequest(request, "test-token"),
      CancellationToken.None);

    Assert.Equal(0, adapter.InvocationCount);
    Assert.Empty(channel.Results);
    Assert.Equal(0L, (await journal.GetHeadAsync(CancellationToken.None)).Sequence);
  }

  [Fact]
  public async Task DescriptorConsentIsEnforcedBeforeJournalOrAdapterExecution()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now);
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
    {
      ConsentGrant = null,
    };
    var adapter = new EmergencyConsentAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(Path.Combine(_directory, "consent.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);

    await coordinator.ExecuteAsync(
      new SignedActionRequest(request, "test-token"),
      CancellationToken.None);

    Assert.False(adapter.WasInvoked);
    var result = Assert.Single(channel.Results);
    Assert.Equal("capability_consent_missing", result.ErrorCode);
    Assert.True(result.BrokerExternalEgressBytes > 0);
    Assert.Equal(1L, result.JournalPrepareSequence);
    Assert.Equal(2L, result.JournalSequence);
    Assert.Equal(2L, (await journal.GetHeadAsync(CancellationToken.None)).Sequence);
  }

  [Fact]
  public async Task DynamicHostFailureCodeIsNormalizedBeforeBrokerDelivery()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now);
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}");
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "invalid-error-code.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(
      new InvalidErrorCodeAdapter(),
      channel,
      journal,
      claims);

    await coordinator.ExecuteAsync(
      new SignedActionRequest(request, "test-token"),
      CancellationToken.None);

    var result = Assert.Single(channel.Results);
    Assert.Equal(ActionOutcome.Failed, result.Outcome);
    Assert.Equal("device_error_code_invalid", result.ErrorCode);
    Assert.All(channel.Progress, progress =>
      Assert.True(CompanionWireContract.IsSafeIdentifier(progress.MessageCode)));
  }

  [Fact]
  public async Task PrivilegedCommandCannotLaunchWithoutTheAttestedCommandBoundary()
  {
    var now = DateTimeOffset.UtcNow;
    var expectedPreState =
      PrivilegedCommandExecuteCapabilityAdapter.UnboundedHostPreStateSha256;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now) with
    {
      CapabilityId = PrivilegedCommandExecuteCapabilityAdapter.CapabilityId,
      ExpectedPreStateSha256 = expectedPreState,
    };
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
    {
      CapabilityId = request.CapabilityId,
      ExpectedPreStateSha256 = expectedPreState,
      ConsentGrant = "one_shot_approval",
    };
    var adapter = new PrivilegedCommandProbeAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "privileged-command-egress.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);

    await coordinator.ExecuteAsync(
      new SignedActionRequest(request, "test-token"),
      CancellationToken.None);

    Assert.False(adapter.WasInvoked);
    var result = Assert.Single(channel.Results);
    Assert.Equal(ActionOutcome.NeedsAttention, result.Outcome);
    Assert.Equal("egress_boundary_unavailable", result.ErrorCode);
    Assert.True(result.OutcomeUncertain);
    Assert.Equal(
      claims.Budgets.MaxExternalEgressBytes - result.BrokerExternalEgressBytes,
      result.UncertainExternalEgressBytes);
  }

  public static IEnumerable<object[]> IndependentlyMeteredLocalSystemCapabilities()
  {
    yield return [OwnedProcessLaunchCapabilityAdapter.CapabilityId];
    yield return [MsiSoftwareInstallCapabilityAdapter.CapabilityId];
    yield return [MsiSoftwareUninstallCapabilityAdapter.CapabilityId];
    yield return [ScheduledTaskRunCapabilityAdapter.CapabilityId];
    yield return [WindowsServiceStartCapabilityAdapter.CapabilityId];
    foreach (var descriptor in ExternalActionCapabilityCatalog.All)
    {
      yield return [descriptor.Id];
    }
  }

  [Theory]
  [MemberData(nameof(IndependentlyMeteredLocalSystemCapabilities))]
  public async Task NetworkCapableLocalSystemAdapterCannotRunWithoutTheAttestedBoundary(
    string capabilityId)
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now) with
    {
      CapabilityId = capabilityId,
    };
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
    {
      CapabilityId = capabilityId,
    };
    var adapter = new BoundaryProbeAdapter(capabilityId);
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, $"egress-boundary-{Guid.NewGuid():N}.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, channel, journal, claims);

    await coordinator.ExecuteAsync(
      new SignedActionRequest(request, "test-token"),
      CancellationToken.None);

    Assert.Equal(0, adapter.InvocationCount);
    var result = Assert.Single(channel.Results);
    Assert.Equal(ActionOutcome.NeedsAttention, result.Outcome);
    Assert.Equal("egress_boundary_unavailable", result.ErrorCode);
    Assert.True(result.OutcomeUncertain);
    Assert.Equal(
      claims.Budgets.MaxExternalEgressBytes - result.BrokerExternalEgressBytes,
      result.UncertainExternalEgressBytes);
  }

  [Fact]
  public async Task TrippedEgressReplayLatchPreventsAdapterExecutionAndStopsTheWorkerPath()
  {
    var now = DateTimeOffset.UtcNow;
    var capabilityId = OwnedProcessLaunchCapabilityAdapter.CapabilityId;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now) with
    {
      CapabilityId = capabilityId,
    };
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
    {
      CapabilityId = capabilityId,
    };
    var adapter = new BoundaryProbeAdapter(capabilityId);
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "egress-replay-fenced.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    var latch = new EgressBoundaryDispatchLatch();
    latch.Trip();
    using var coordinator = CreateCoordinator(
      adapter,
      channel,
      journal,
      claims,
      egressDispatchLatch: latch);

    var refusal = await Assert.ThrowsAsync<EgressBoundaryUnsafeException>(() =>
      coordinator.ExecuteAsync(
        new SignedActionRequest(request, "test-token"),
        CancellationToken.None));

    Assert.Equal("egress_replay_reconciliation_required", refusal.ErrorCode);
    Assert.Equal(0, adapter.InvocationCount);
    var result = Assert.Single(channel.Results);
    Assert.Equal(ActionOutcome.Failed, result.Outcome);
    Assert.Equal("egress_replay_reconciliation_required", result.ErrorCode);
    Assert.False(result.OutcomeUncertain);
    Assert.Equal(0, result.UncertainExternalEgressBytes);
  }

  [Fact]
  public void NetworkCapableLocalSystemPolicyRequiresExactProcessTreeBoundaryFeatures()
  {
    var capabilityIds = IndependentlyMeteredLocalSystemCapabilities()
      .Select(values => Assert.IsType<string>(values[0]))
      .ToArray();

    Assert.All(capabilityIds, capabilityId =>
    {
      Assert.True(ActionExecutionCoordinator.RequiresEgressBoundary(capabilityId));
      Assert.Equal(
        EgressBoundaryFeatures.CommandRequired,
        ActionExecutionCoordinator.RequiredBoundaryFeatures(capabilityId));
    });
    Assert.False(ActionExecutionCoordinator.RequiresEgressBoundary("process.owned.status"));
    Assert.False(ActionExecutionCoordinator.RequiresEgressBoundary("process.owned.terminate"));
    Assert.False(ActionExecutionCoordinator.RequiresEgressBoundary("software.msi.status"));
    Assert.False(ActionExecutionCoordinator.RequiresEgressBoundary("scheduled-task.definition.read"));
    Assert.False(ActionExecutionCoordinator.RequiresEgressBoundary("windows.service.status"));
    Assert.False(ActionExecutionCoordinator.RequiresEgressBoundary("windows.service.stop"));
    Assert.Empty(ActionExecutionCoordinator.RequiredBoundaryFeatures("process.owned.status"));
    Assert.Empty(ActionExecutionCoordinator.RequiredBoundaryFeatures("process.owned.terminate"));
    Assert.Empty(ActionExecutionCoordinator.RequiredBoundaryFeatures("software.msi.status"));
    Assert.Empty(ActionExecutionCoordinator.RequiredBoundaryFeatures(
      "scheduled-task.definition.read"));
    Assert.Empty(ActionExecutionCoordinator.RequiredBoundaryFeatures("windows.service.status"));
    Assert.Empty(ActionExecutionCoordinator.RequiredBoundaryFeatures("windows.service.stop"));
  }

  [Fact]
  public void OnlyReviewedAdaptersExposeTheMatchingLifecycleEntryPoint()
  {
    Assert.True(typeof(IEgressLifecycleCapabilityAdapter).IsAssignableFrom(
      typeof(ExternalEmailSendCapabilityAdapter)));
    Assert.True(typeof(IEgressLifecycleCapabilityAdapter).IsAssignableFrom(
      typeof(ExternalMessageSendCapabilityAdapter)));
    Assert.True(typeof(IEgressLifecycleCapabilityAdapter).IsAssignableFrom(
      typeof(ExternalPublishCreateCapabilityAdapter)));
    Assert.True(typeof(IEgressLifecycleCapabilityAdapter).IsAssignableFrom(
      typeof(ExternalPurchaseSubmitCapabilityAdapter)));

    Assert.False(typeof(IEgressLifecycleCapabilityAdapter).IsAssignableFrom(
      typeof(OwnedProcessLaunchCapabilityAdapter)));
    Assert.False(typeof(IEgressLifecycleCapabilityAdapter).IsAssignableFrom(
      typeof(MsiSoftwareInstallCapabilityAdapter)));
    Assert.False(typeof(IEgressLifecycleCapabilityAdapter).IsAssignableFrom(
      typeof(ScheduledTaskRunCapabilityAdapter)));
    Assert.False(typeof(IEgressLifecycleCapabilityAdapter).IsAssignableFrom(
      typeof(WindowsServiceStartCapabilityAdapter)));
    Assert.True(typeof(IEgressLifecycleCapabilityAdapter).IsAssignableFrom(
      typeof(SessionCapabilityProxyAdapter)));
    Assert.True(SessionCapabilityProxyAdapter.SupportsBrowserEgressLifecycle(
      StandardUserCapabilityCatalog.BrowserFileUpload));
    Assert.False(SessionCapabilityProxyAdapter.SupportsBrowserEgressLifecycle(
      StandardUserCapabilityCatalog.EmergencyCommandExecute));
  }

  [Fact]
  public async Task SessionProxyCannotBypassLifecycleOrInventARegistrationKind()
  {
    var adapter = new SessionCapabilityProxyAdapter(
      StandardUserCapabilityCatalog.EmergencyCommandExecute,
      null!,
      null!,
      null!);
    using var arguments = JsonDocument.Parse(
      """{"executable":"cmd","argv":["/d","/s","/c","echo hello"],"workingDirectoryId":"scratch"}""");

    var direct = await Assert.ThrowsAsync<HostPreconditionException>(() =>
      adapter.ExecuteAsync(null!, arguments.RootElement, CancellationToken.None).AsTask());
    Assert.Equal("session_egress_lifecycle_entry_point_required", direct.ErrorCode);

    await using var session = new NeverInvokedEgressBoundarySession();
    var lifecycle = await Assert.ThrowsAsync<HostPreconditionException>(() =>
      adapter.ExecuteWithEgressAsync(
        null!,
        arguments.RootElement,
        session,
        CancellationToken.None).AsTask());
    Assert.Equal("session_egress_registration_kind_unsupported", lifecycle.ErrorCode);
  }

  [Fact]
  public async Task SessionProxyRegistersTheExactBrowserBindingBeforeTheUserSessionEffect()
  {
    const string actionId = "10000000-0000-4000-8000-000000000001";
    const string taskId = "20000000-0000-4000-8000-000000000002";
    const string planId = "30000000-0000-4000-8000-000000000003";
    const string stepId = "40000000-0000-4000-8000-000000000004";
    const string deviceId = "50000000-0000-4000-8000-000000000005";
    const string mandateId = "60000000-0000-4000-8000-000000000006";
    const string sourceStepId = "70000000-0000-4000-8000-000000000007";
    const string sourceAttemptId = "attempt-7";
    const string artifactId = "80000000-0000-4000-8000-000000000008";
    var content = new byte[] { 0x89, 0x50, 0x4e, 0x47 };
    var contentSha256 = Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
    var artifactScopeSha256 = GovernedArtifactEnvelope.ScopeSha256(
      taskId,
      planId,
      stepId,
      deviceId,
      sourceStepId,
      sourceAttemptId,
      artifactId,
      contentSha256,
      content.Length,
      "image/png",
      "reviewed.png",
      "SCREENSHOT",
      "Restricted");
    var originSha256 = new string('a', 64);
    using var arguments = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      originId = "itemba",
      originSha256,
      processId = 77,
      automationId = "reviewed-upload-field",
      artifact = new
      {
        schemaVersion = GovernedArtifactEnvelope.SchemaVersion,
        taskId,
        planVersionId = planId,
        targetStepId = stepId,
        deviceId,
        sourceStepId,
        sourceAttemptId,
        artifactId,
        sha256 = contentSha256,
        byteSize = content.Length,
        mimeType = "image/png",
        name = "reviewed.png",
        kind = "SCREENSHOT",
        dataClass = "Restricted",
        scopeSha256 = artifactScopeSha256,
        contentBase64 = Convert.ToBase64String(content),
      },
    }));
    var argumentsSha256 = PayloadDigest.Sha256Hex(arguments.RootElement.GetRawText());
    var actionTokenSha256 = new string('b', 64);
    var policySha256 = new string('c', 64);
    var executionIdentitySha256 = new string('d', 64);
    var browserBuildSha256 = new string('e', 64);
    var now = DateTimeOffset.UtcNow;
    var attestation = new BoundaryAttestationV1(
      EgressBoundaryCanonical.ContractVersion,
      "90000000-0000-4000-8000-000000000009",
      deviceId,
      "a0000000-0000-4000-8000-00000000000a",
      "b0000000-0000-4000-8000-00000000000b",
      now.AddMinutes(-1).ToUnixTimeMilliseconds(),
      now.AddMinutes(1).ToUnixTimeMilliseconds(),
      true,
      true,
      true,
      true,
      new string('1', 64),
      new string('2', 64),
      browserBuildSha256,
      "test-receipt",
      "AQ==",
      new string('3', 64),
      EgressBoundaryFeatures.BrowserRequired);
    var signedAttestation = new SignedBoundaryAttestation(
      attestation,
      "test-root",
      "test-signature");
    var lease = new EgressLeaseV1(
      EgressBoundaryCanonical.ContractVersion,
      "c0000000-0000-4000-8000-00000000000c",
      EgressBoundaryCanonical.AttestationSha256(attestation),
      actionTokenSha256,
      actionId,
      taskId,
      planId,
      stepId,
      deviceId,
      mandateId,
      StandardUserCapabilityCatalog.BrowserFileUpload.Id,
      StandardUserCapabilityCatalog.BrowserFileUpload.Version,
      1,
      policySha256,
      executionIdentitySha256,
      argumentsSha256,
      new string('f', 64),
      new string('4', 64),
      new string('5', 64),
      new string('6', 64),
      new string('7', 64),
      new string('8', 64),
      1_024,
      now.AddSeconds(-5).ToUnixTimeMilliseconds(),
      now.AddMinutes(1).ToUnixTimeMilliseconds());
    var authorization = new EgressExecutionAuthorization(
      signedAttestation,
      new SignedEgressLease(lease, "test-receipt", "test-signature"));
    var context = new ActionExecutionContext(
      actionId,
      taskId,
      planId,
      stepId,
      deviceId,
      mandateId,
      "idempotency-browser",
      new string('f', 64),
      new string('9', 64),
      new ActionBudget(60, 1, 1, 1, 1_024, 1_024, 1),
      ActionTokenSha256: actionTokenSha256,
      DispatchCount: 1,
      EgressAuthorization: authorization,
      EgressDestinationPolicySha256: policySha256,
      EgressExecutionIdentitySha256: executionIdentitySha256,
      ArgumentsSha256: argumentsSha256);
    var bridge = new RecordingUserSessionBridge(sessionId: 42);
    var session = new RecordingBrowserEgressBoundarySession(authorization, actionId);
    var adapter = new SessionCapabilityProxyAdapter(
      StandardUserCapabilityCatalog.BrowserFileUpload,
      bridge,
      null!,
      null!);

    try
    {
      Assert.True(adapter.ValidateArguments(arguments.RootElement).IsValid);
      var result = await adapter.ExecuteWithEgressAsync(
        context,
        arguments.RootElement,
        session,
        CancellationToken.None);

      Assert.Equal(1, bridge.ExecutionCount);
      var registration = Assert.Single(session.BrowserRegistrations);
      Assert.Equal(42, registration.WindowsSessionId);
      Assert.Equal(77, registration.BrowserBrokerProcessId);
      Assert.Equal(originSha256, registration.OriginSha256);
      Assert.Equal(browserBuildSha256, registration.BrowserBrokerBuildSha256);
      Assert.Null(result.EgressReceipt);

      var mismatch = await Assert.ThrowsAsync<HostPreconditionException>(() =>
        adapter.ExecuteWithEgressAsync(
          context with { ArgumentsSha256 = new string('0', 64) },
          arguments.RootElement,
          session,
          CancellationToken.None).AsTask());
      Assert.Equal("session_browser_egress_binding_invalid", mismatch.ErrorCode);
      Assert.Equal(1, bridge.ExecutionCount);
      Assert.Single(session.BrowserRegistrations);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(content);
      await session.DisposeAsync();
    }
  }

  [Fact]
  public async Task LifecycleAdapterSettlesFromBoundarySessionReceipt()
  {
    var fixture = CoordinatorEgressFixture.Create(LifecycleProbeBehavior.Complete);
    using (fixture)
    using (var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "egress-lifecycle-settle.jsonl")))
    {
      await journal.InitializeAsync(CancellationToken.None);
      var channel = new RecordingChannel(ledgerConnected: true);
      using var coordinator = CreateCoordinator(
        fixture.Adapter,
        channel,
        journal,
        fixture.Claims,
        egressBoundary: fixture.Client,
        egressVerifier: fixture.Verifier);

      await coordinator.ExecuteAsync(
        new SignedActionRequest(fixture.Request, "test-token"),
        CancellationToken.None);

      var result = Assert.Single(channel.Results);
      Assert.Equal(ActionOutcome.Completed, result.Outcome);
      Assert.Equal(123, result.ExternalEgressBytes);
      Assert.NotNull(result.EgressEvidence);
      Assert.Equal(123, result.EgressEvidence!.Receipt.Receipt.MeasuredExternalEgressBytes);
      Assert.Equal(1, fixture.Client.Session!.SettleAttempts);
      Assert.Equal(0, fixture.Client.Session.AbortAttempts);
      Assert.Equal(1, fixture.Adapter.EffectCount);
      Assert.Same(result.EgressEvidence, fixture.Verifier.LastEvidence);
    }
  }

  [Fact]
  public async Task TrustedSupervisorMeasurementAboveAdapterFloorIsChargedExactlyOnce()
  {
    var fixture = CoordinatorEgressFixture.Create(
      LifecycleProbeBehavior.Complete,
      supervisorMeasuredExternalEgressBytes: 321);
    using (fixture)
    using (var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "egress-lifecycle-supervisor-floor.jsonl")))
    {
      await journal.InitializeAsync(CancellationToken.None);
      var channel = new RecordingChannel(ledgerConnected: true);
      using var coordinator = CreateCoordinator(
        fixture.Adapter,
        channel,
        journal,
        fixture.Claims,
        egressBoundary: fixture.Client,
        egressVerifier: fixture.Verifier);

      await coordinator.ExecuteAsync(
        new SignedActionRequest(fixture.Request, "test-token"),
        CancellationToken.None);

      var result = Assert.Single(channel.Results);
      var receipt = result.EgressEvidence!.Receipt.Receipt;
      Assert.Equal(ActionOutcome.Completed, result.Outcome);
      Assert.Equal(321, result.ExternalEgressBytes);
      Assert.Equal(0, result.UncertainExternalEgressBytes);
      Assert.Equal(321, receipt.MeasuredExternalEgressBytes);
      Assert.Equal(321, receipt.ChargedExternalEgressBytes);
      Assert.Equal(
        receipt.ChargedExternalEgressBytes,
        result.ExternalEgressBytes + result.UncertainExternalEgressBytes);
    }
  }

  [Fact]
  public async Task MissingTerminalReceiptAfterEffectIsUncertainAndTripsDispatchLatch()
  {
    var fixture = CoordinatorEgressFixture.Create(
      LifecycleProbeBehavior.Complete,
      omitTerminalReceipt: true);
    using (fixture)
    using (var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "egress-lifecycle-missing-receipt.jsonl")))
    {
      await journal.InitializeAsync(CancellationToken.None);
      var channel = new RecordingChannel(ledgerConnected: true);
      var latch = new EgressBoundaryDispatchLatch();
      using var coordinator = CreateCoordinator(
        fixture.Adapter,
        channel,
        journal,
        fixture.Claims,
        egressDispatchLatch: latch,
        egressBoundary: fixture.Client,
        egressVerifier: fixture.Verifier);

      var error = await Assert.ThrowsAsync<EgressBoundaryUnsafeException>(() =>
        coordinator.ExecuteAsync(
          new SignedActionRequest(fixture.Request, "test-token"),
          CancellationToken.None));

      Assert.Equal("egress_terminal_receipt_missing", error.ErrorCode);
      Assert.Equal(1, fixture.Adapter.EffectCount);
      Assert.True(latch.IsTripped);
      var result = Assert.Single(channel.Results);
      Assert.Equal(ActionOutcome.NeedsAttention, result.Outcome);
      Assert.True(result.OutcomeUncertain);
      Assert.Equal(
        fixture.Claims.Budgets.MaxExternalEgressBytes,
        result.ExternalEgressBytes
          + result.BrokerExternalEgressBytes
          + result.UncertainExternalEgressBytes);
    }
  }

  [Fact]
  public async Task SupervisorReceiptBelowAdapterFloorIsRejectedAfterEffect()
  {
    var fixture = CoordinatorEgressFixture.Create(
      LifecycleProbeBehavior.Complete,
      supervisorMeasuredExternalEgressBytes: 122);
    using (fixture)
    using (var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "egress-lifecycle-below-floor.jsonl")))
    {
      await journal.InitializeAsync(CancellationToken.None);
      var channel = new RecordingChannel(ledgerConnected: true);
      var latch = new EgressBoundaryDispatchLatch();
      using var coordinator = CreateCoordinator(
        fixture.Adapter,
        channel,
        journal,
        fixture.Claims,
        egressDispatchLatch: latch,
        egressBoundary: fixture.Client,
        egressVerifier: fixture.Verifier);

      var error = await Assert.ThrowsAsync<EgressBoundaryUnsafeException>(() =>
        coordinator.ExecuteAsync(
          new SignedActionRequest(fixture.Request, "test-token"),
          CancellationToken.None));

      Assert.Equal("egress_receipt_measurement_mismatch", error.ErrorCode);
      Assert.Equal(1, fixture.Adapter.EffectCount);
      Assert.True(latch.IsTripped);
      var result = Assert.Single(channel.Results);
      Assert.Equal(ActionOutcome.NeedsAttention, result.Outcome);
      Assert.True(result.OutcomeUncertain);
    }
  }

  [Fact]
  public async Task AdapterSuppliedTerminalReceiptIsRejectedEvenAfterSupervisorSettlement()
  {
    var fixture = CoordinatorEgressFixture.Create(
      LifecycleProbeBehavior.AdapterSuppliedReceipt);
    using (fixture)
    using (var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "egress-lifecycle-adapter-receipt.jsonl")))
    {
      await journal.InitializeAsync(CancellationToken.None);
      var channel = new RecordingChannel(ledgerConnected: true);
      using var coordinator = CreateCoordinator(
        fixture.Adapter,
        channel,
        journal,
        fixture.Claims,
        egressBoundary: fixture.Client,
        egressVerifier: fixture.Verifier);

      await coordinator.ExecuteAsync(
        new SignedActionRequest(fixture.Request, "test-token"),
        CancellationToken.None);

      Assert.Equal(1, fixture.Adapter.EffectCount);
      Assert.Equal(1, fixture.Client.Session!.SettleAttempts);
      var result = Assert.Single(channel.Results);
      Assert.Equal(ActionOutcome.NeedsAttention, result.Outcome);
      Assert.True(result.OutcomeUncertain);
      Assert.Equal("capability_result_policy_invalid", result.ErrorCode);
      Assert.Equal(123, result.ExternalEgressBytes);
      Assert.NotNull(result.EgressEvidence);
    }
  }

  [Fact]
  public async Task SupervisorMayDowngradeCompletedAdapterToUnknownWithoutLosingReceipt()
  {
    var fixture = CoordinatorEgressFixture.Create(
      LifecycleProbeBehavior.Complete,
      EgressSupervisorLifecycleContract.Unknown);
    using (fixture)
    using (var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "egress-lifecycle-supervisor-unknown.jsonl")))
    {
      await journal.InitializeAsync(CancellationToken.None);
      var channel = new RecordingChannel(ledgerConnected: true);
      var latch = new EgressBoundaryDispatchLatch();
      using var coordinator = CreateCoordinator(
        fixture.Adapter,
        channel,
        journal,
        fixture.Claims,
        egressDispatchLatch: latch,
        egressBoundary: fixture.Client,
        egressVerifier: fixture.Verifier);

      await coordinator.ExecuteAsync(
        new SignedActionRequest(fixture.Request, "test-token"),
        CancellationToken.None);

      var result = Assert.Single(channel.Results);
      Assert.Equal(ActionOutcome.NeedsAttention, result.Outcome);
      Assert.True(result.OutcomeUncertain);
      Assert.Equal(123, result.ExternalEgressBytes);
      Assert.True(result.UncertainExternalEgressBytes > 0);
      Assert.Equal(
        EgressSupervisorLifecycleContract.Unknown,
        result.EgressEvidence!.Receipt.Receipt.Outcome);
      Assert.False(latch.IsTripped);
      Assert.Equal(1, fixture.Adapter.EffectCount);
    }
  }

  [Fact]
  public async Task UncertainDispositionRejectsSignedCompletedReceiptAndTripsLatch()
  {
    var fixture = CoordinatorEgressFixture.Create(
      LifecycleProbeBehavior.Uncertain,
      EgressSupervisorLifecycleContract.Completed);
    using (fixture)
    using (var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "egress-lifecycle-wrong-outcome.jsonl")))
    {
      await journal.InitializeAsync(CancellationToken.None);
      var channel = new RecordingChannel(ledgerConnected: true);
      var latch = new EgressBoundaryDispatchLatch();
      using var coordinator = CreateCoordinator(
        fixture.Adapter,
        channel,
        journal,
        fixture.Claims,
        egressDispatchLatch: latch,
        egressBoundary: fixture.Client,
        egressVerifier: fixture.Verifier);

      var exception = await Assert.ThrowsAsync<EgressBoundaryUnsafeException>(() =>
        coordinator.ExecuteAsync(
          new SignedActionRequest(fixture.Request, "test-token"),
          CancellationToken.None));

      Assert.Equal("egress_terminal_disposition_mismatch", exception.ErrorCode);
      Assert.True(latch.IsTripped);
      var result = Assert.Single(channel.Results);
      Assert.Equal(ActionOutcome.NeedsAttention, result.Outcome);
      Assert.Equal("egress_terminal_disposition_mismatch", result.ErrorCode);
      Assert.True(result.UncertainExternalEgressBytes > 0);
    }
  }

  [Fact]
  public async Task PreEffectFailureAbortsWithSignedZeroReceiptWithoutTrippingLatch()
  {
    var fixture = CoordinatorEgressFixture.Create(
      LifecycleProbeBehavior.FailBeforeRegistration);
    using (fixture)
    using (var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "egress-lifecycle-abort-before.jsonl")))
    {
      await journal.InitializeAsync(CancellationToken.None);
      var channel = new RecordingChannel(ledgerConnected: true);
      var latch = new EgressBoundaryDispatchLatch();
      using var coordinator = CreateCoordinator(
        fixture.Adapter,
        channel,
        journal,
        fixture.Claims,
        egressDispatchLatch: latch,
        egressBoundary: fixture.Client,
        egressVerifier: fixture.Verifier);

      await coordinator.ExecuteAsync(
        new SignedActionRequest(fixture.Request, "test-token"),
        CancellationToken.None);

      var result = Assert.Single(channel.Results);
      Assert.Equal(ActionOutcome.Failed, result.Outcome);
      Assert.False(result.OutcomeUncertain);
      Assert.Equal(0, result.ExternalEgressBytes);
      Assert.Equal(0, result.UncertainExternalEgressBytes);
      Assert.Equal(EgressSupervisorLifecycleContract.Failed,
        result.EgressEvidence!.Receipt.Receipt.Outcome);
      Assert.Equal(1, fixture.Client.Session!.AbortAttempts);
      Assert.Equal(0, fixture.Client.Session.DirectRegistrationAttempts);
      Assert.Equal(0, fixture.Adapter.EffectCount);
      Assert.False(latch.IsTripped);
    }
  }

  [Fact]
  public async Task PostRegistrationFailureAbortsUnknownAndUsesFullSignedCharge()
  {
    var fixture = CoordinatorEgressFixture.Create(
      LifecycleProbeBehavior.FailAfterRegistration);
    using (fixture)
    using (var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "egress-lifecycle-abort-unknown.jsonl")))
    {
      await journal.InitializeAsync(CancellationToken.None);
      var channel = new RecordingChannel(ledgerConnected: true);
      var latch = new EgressBoundaryDispatchLatch();
      using var coordinator = CreateCoordinator(
        fixture.Adapter,
        channel,
        journal,
        fixture.Claims,
        egressDispatchLatch: latch,
        egressBoundary: fixture.Client,
        egressVerifier: fixture.Verifier);

      await coordinator.ExecuteAsync(
        new SignedActionRequest(fixture.Request, "test-token"),
        CancellationToken.None);

      var result = Assert.Single(channel.Results);
      var receipt = result.EgressEvidence!.Receipt.Receipt;
      Assert.Equal(ActionOutcome.NeedsAttention, result.Outcome);
      Assert.True(result.OutcomeUncertain);
      Assert.Equal(EgressSupervisorLifecycleContract.Unknown, receipt.Outcome);
      Assert.Equal(receipt.ReservedCapabilityEgressBytes, receipt.ChargedExternalEgressBytes);
      Assert.Equal(receipt.ReservedCapabilityEgressBytes,
        result.ExternalEgressBytes + result.UncertainExternalEgressBytes);
      Assert.Equal(1, fixture.Client.Session!.AbortAttempts);
      Assert.Equal(1, fixture.Client.Session.DirectRegistrationAttempts);
      Assert.Equal(0, fixture.Adapter.EffectCount);
      Assert.False(latch.IsTripped);
    }
  }

  [Fact]
  public async Task AuthenticatedFenceReceiptPreventsDelayedStaleExecuteFromInvokingAdapter()
  {
    var now = DateTimeOffset.UtcNow;
    var request = ActionTokenVerifierTests.CreateRequest("{}", now);
    var claims = ActionTokenVerifierTests.CreateClaims(now, "{}");
    var adapter = new CountingAdapter();
    var channel = new RecordingChannel(ledgerConnected: true);
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "authenticated-action-fence.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    var predecessor = await journal.GetHeadAsync(CancellationToken.None);
    var fenceRequest = new FenceActionRequest(
      FenceId: "fence-1",
      DeviceId: request.DeviceId,
      ActionId: request.ActionId,
      TaskId: request.TaskId,
      StepId: request.StepId,
      OldLeaseId: request.LeaseId,
      OldFencingToken: request.FencingToken,
      OldActionTokenSha256: PayloadDigest.Sha256Hex("test-token"),
      JournalPreviousSequence: predecessor.Sequence,
      JournalPreviousHash: predecessor.EntryHash,
      DispatchCount: 1,
      ExpiresAt: now.AddMinutes(2));
    const string compactFenceToken = "signed-fence-token";
    using var coordinator = CreateCoordinator(
      adapter,
      channel,
      journal,
      claims,
      fenceTokenVerifier: new StaticFenceTokenVerifier(
        FenceTokenVerifierTests.CreateClaims(fenceRequest)));

    await coordinator.FenceAsync(
      new SignedFenceActionRequest(fenceRequest, compactFenceToken),
      CancellationToken.None);
    await coordinator.ExecuteAsync(
      new SignedActionRequest(request, "test-token"),
      CancellationToken.None);

    var receipt = Assert.Single(channel.FenceReceipts);
    Assert.Equal(fenceRequest.FenceId, receipt.FenceId);
    Assert.Equal(fenceRequest.OldLeaseId, receipt.OldLeaseId);
    Assert.Equal(fenceRequest.OldFencingToken, receipt.OldFencingToken);
    Assert.Equal(fenceRequest.OldActionTokenSha256, receipt.OldActionTokenSha256);
    Assert.Equal(fenceRequest.DispatchCount, receipt.FenceDispatchCount);
    Assert.Equal(compactFenceToken, receipt.CompactToken);
    Assert.Equal(PayloadDigest.Sha256Hex(compactFenceToken), receipt.FenceTokenSha256);
    Assert.Equal(ActionFenceOutcomes.NoPrepared, receipt.Outcome);
    Assert.Equal(predecessor.Sequence, receipt.JournalPreviousSequence);
    Assert.Equal(predecessor.EntryHash, receipt.JournalPreviousHash);
    Assert.Equal(predecessor.Sequence + 1, receipt.TombstoneSequence);
    Assert.Equal(predecessor.EntryHash, receipt.TombstonePreviousHash);
    Assert.Equal(receipt.TombstoneEntryHash,
      (await journal.GetHeadAsync(CancellationToken.None)).EntryHash);
    Assert.Equal(0, adapter.InvocationCount);
    Assert.Empty(channel.Progress);
    Assert.Empty(channel.Results);
  }

  public void Dispose()
  {
    if (Directory.Exists(_directory))
    {
      Directory.Delete(_directory, recursive: true);
    }
  }

  private static ActionExecutionCoordinator CreateCoordinator(
    IHostCapabilityAdapter adapter,
    RecordingChannel channel,
    IActionJournal journal,
    ActionTokenClaims claims,
    bool requireCentralLedgerForMutations = true,
    IActionResultStore? resultStore = null,
    IFenceTokenVerifier? fenceTokenVerifier = null,
    EgressBoundaryDispatchLatch? egressDispatchLatch = null,
    PrivilegedCommandIsolationDispatchLatch? isolationDispatchLatch = null,
    IEgressBoundaryClient? egressBoundary = null,
    ILocalSystemEgressEvidenceVerifier? egressVerifier = null)
  {
    var companionOptions = Options.Create(new CompanionOptions
    {
      DeviceId = claims.DeviceId,
      ExecutionEnabled = true,
      LeaseHeartbeatSeconds = 1,
      RequireCentralLedgerForMutations = requireCentralLedgerForMutations,
      EgressDestinationPolicySha256 = new string('a', 64),
      EgressExecutionIdentitySha256 = new string('b', 64),
      KillSwitchPath = Path.Combine(Path.GetTempPath(), $"absent-{Guid.NewGuid():N}"),
    });
    return new ActionExecutionCoordinator(
      companionOptions,
      Options.Create(new BrokerChannelOptions { MaxRequestAttempts = 3 }),
      new StaticTokenVerifier(claims),
      fenceTokenVerifier ?? new RejectingFenceTokenVerifier(),
      journal,
      resultStore ?? new InMemoryActionResultStore(),
      new CapabilityRegistry([adapter]),
      new TrustedRootGuard(companionOptions),
      egressBoundary ?? new NullEgressBoundaryClient(),
      egressVerifier ?? new RejectingEgressVerifier(),
      egressDispatchLatch ?? new EgressBoundaryDispatchLatch(),
      isolationDispatchLatch ?? new PrivilegedCommandIsolationDispatchLatch(),
      channel,
      NullLogger<ActionExecutionCoordinator>.Instance);
  }

  private enum LifecycleProbeBehavior
  {
    Complete,
    AdapterSuppliedReceipt,
    Uncertain,
    FailBeforeRegistration,
    FailAfterRegistration,
  }

  private sealed class NeverInvokedEgressBoundarySession : IEgressBoundarySession
  {
    public EgressExecutionAuthorization Authorization => throw new InvalidOperationException();

    public bool HasRegistration => false;

    public bool IsTerminal => false;

    public SignedEgressReceipt? TerminalReceipt => null;

    public ValueTask<EgressRegistrationAcknowledgementV1?> TryRegisterProcessAsync(
      EgressProcessRegistrationV1 registration,
      CancellationToken cancellationToken) => throw new InvalidOperationException();

    public ValueTask<EgressRegistrationAcknowledgementV1?> TryRegisterDirectAsync(
      EgressDirectRegistrationV1 registration,
      CancellationToken cancellationToken) => throw new InvalidOperationException();

    public ValueTask<EgressRegistrationAcknowledgementV1?> TryRegisterBrowserAsync(
      EgressBrowserRegistrationV1 registration,
      CancellationToken cancellationToken) => throw new InvalidOperationException();

    public ValueTask<SignedEgressReceipt?> TrySettleAsync(
      EgressTerminalDispositionV1 disposition,
      CancellationToken cancellationToken) => throw new InvalidOperationException();

    public ValueTask<SignedEgressReceipt?> TryAbortAsync(
      EgressTerminalDispositionV1 disposition,
      CancellationToken cancellationToken) => throw new InvalidOperationException();

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
  }

  private sealed class RecordingUserSessionBridge(int sessionId) : IUserSessionBridge
  {
    public bool IsConnected => true;

    public int? SessionId => sessionId;

    public SessionAgentHeartbeat? LatestHeartbeat => null;

    public int ExecutionCount { get; private set; }

    public ValueTask<CapabilityExecutionResult> ExecuteAsync(
      CapabilityDescriptor descriptor,
      ActionExecutionContext context,
      JsonElement arguments,
      SessionSecretBinding? secretBinding,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      ExecutionCount++;
      return ValueTask.FromResult(new CapabilityExecutionResult(
        "{}",
        MutationCommitted: true,
        OutcomeUncertain: false,
        Provenance: [],
        PreStateSha256: context.ExpectedPreStateSha256));
    }
  }

  private sealed class RecordingBrowserEgressBoundarySession(
    EgressExecutionAuthorization authorization,
    string actionId) : IEgressBoundarySession
  {
    public EgressExecutionAuthorization Authorization { get; } = authorization;

    public bool HasRegistration => BrowserRegistrations.Count > 0;

    public bool IsTerminal => false;

    public SignedEgressReceipt? TerminalReceipt => null;

    public List<EgressBrowserRegistrationV1> BrowserRegistrations { get; } = [];

    public ValueTask<EgressRegistrationAcknowledgementV1?> TryRegisterProcessAsync(
      EgressProcessRegistrationV1 registration,
      CancellationToken cancellationToken) => throw new InvalidOperationException();

    public ValueTask<EgressRegistrationAcknowledgementV1?> TryRegisterDirectAsync(
      EgressDirectRegistrationV1 registration,
      CancellationToken cancellationToken) => throw new InvalidOperationException();

    public ValueTask<EgressRegistrationAcknowledgementV1?> TryRegisterBrowserAsync(
      EgressBrowserRegistrationV1 registration,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      BrowserRegistrations.Add(registration);
      return ValueTask.FromResult<EgressRegistrationAcknowledgementV1?>(new(
        EgressSupervisorLifecycleContract.Version,
        EgressSupervisorLifecycleCanonical.OperationId(
          actionId,
          $"register:{EgressSupervisorLifecycleContract.BrowserRegistration}:{registration.RegistrationId}"),
        registration.RegistrationId,
        EgressSupervisorLifecycleContract.BrowserRegistration,
        EgressBoundaryCanonical.LeaseSha256(Authorization.Lease.Lease),
        EgressSupervisorLifecycleCanonical.RegistrationSha256(registration),
        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
    }

    public ValueTask<SignedEgressReceipt?> TrySettleAsync(
      EgressTerminalDispositionV1 disposition,
      CancellationToken cancellationToken) => throw new InvalidOperationException();

    public ValueTask<SignedEgressReceipt?> TryAbortAsync(
      EgressTerminalDispositionV1 disposition,
      CancellationToken cancellationToken) => throw new InvalidOperationException();

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
  }

  private sealed class CoordinatorEgressFixture : IDisposable
  {
    private readonly ECDsa _attestationKey;
    private readonly ECDsa _receiptKey;

    private CoordinatorEgressFixture(
      ActionRequest request,
      ActionTokenClaims claims,
      LifecycleProbeAdapter adapter,
      CoordinatorEgressClient client,
      CoordinatorEgressVerifier verifier,
      ECDsa attestationKey,
      ECDsa receiptKey)
    {
      Request = request;
      Claims = claims;
      Adapter = adapter;
      Client = client;
      Verifier = verifier;
      _attestationKey = attestationKey;
      _receiptKey = receiptKey;
    }

    public ActionRequest Request { get; }

    public ActionTokenClaims Claims { get; }

    public LifecycleProbeAdapter Adapter { get; }

    public CoordinatorEgressClient Client { get; }

    public CoordinatorEgressVerifier Verifier { get; }

    public static CoordinatorEgressFixture Create(
      LifecycleProbeBehavior behavior,
      string? receiptOutcomeOverride = null,
      long? supervisorMeasuredExternalEgressBytes = null,
      bool omitTerminalReceipt = false)
    {
      var now = DateTimeOffset.UtcNow;
      var descriptor = ExternalActionCapabilityCatalog.EmailSend;
      var request = ActionTokenVerifierTests.CreateRequest("{}", now) with
      {
        ActionId = "10000000-0000-4000-8000-000000000001",
        TaskId = "20000000-0000-4000-8000-000000000002",
        PlanVersionId = "30000000-0000-4000-8000-000000000003",
        StepId = "40000000-0000-4000-8000-000000000004",
        DeviceId = "50000000-0000-4000-8000-000000000005",
        MandateId = "60000000-0000-4000-8000-000000000006",
        CapabilityId = descriptor.Id,
        CapabilityVersion = descriptor.Version,
        ExpectedPreStateSha256 = new string('f', 64),
      };
      var claims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
      {
        ActionId = request.ActionId,
        TaskId = request.TaskId,
        PlanVersionId = request.PlanVersionId,
        StepId = request.StepId,
        DeviceId = request.DeviceId,
        MandateId = request.MandateId,
        CapabilityId = request.CapabilityId,
        CapabilityVersion = request.CapabilityVersion,
        ExpectedPreStateSha256 = request.ExpectedPreStateSha256,
      };
      var attestationKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
      var receiptKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
      var resolver = new StaticEgressKeyResolver(
        "test-egress-root",
        attestationKey.ExportSubjectPublicKeyInfo());
      var contracts = new EgressBoundaryContractVerifier(
        EgressBoundaryVerificationSettings.Strict(request.DeviceId),
        resolver,
        new FixedEgressTimeProvider(now));
      var verifier = new CoordinatorEgressVerifier(contracts);
      var client = new CoordinatorEgressClient(
        now,
        attestationKey,
        receiptKey,
        receiptOutcomeOverride,
        supervisorMeasuredExternalEgressBytes,
        omitTerminalReceipt);
      return new CoordinatorEgressFixture(
        request,
        claims,
        new LifecycleProbeAdapter(behavior),
        client,
        verifier,
        attestationKey,
        receiptKey);
    }

    public void Dispose()
    {
      _attestationKey.Dispose();
      _receiptKey.Dispose();
    }
  }

  private sealed class LifecycleProbeAdapter(
    LifecycleProbeBehavior behavior) : IEgressLifecycleCapabilityAdapter
  {
    public CapabilityDescriptor Descriptor => ExternalActionCapabilityCatalog.EmailSend;

    public int EffectCount { get; private set; }

    public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
      CapabilityArgumentValidation.Success;

    public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
      CapabilityArgumentValidation.Success;

    public ValueTask<CapabilityExecutionResult> ExecuteAsync(
      ActionExecutionContext context,
      JsonElement arguments,
      CancellationToken cancellationToken) => throw new InvalidOperationException(
        "The lifecycle entry point is required.");

    public async ValueTask<CapabilityExecutionResult> ExecuteWithEgressAsync(
      ActionExecutionContext context,
      JsonElement arguments,
      IEgressBoundarySession session,
      CancellationToken cancellationToken)
    {
      if (behavior == LifecycleProbeBehavior.FailBeforeRegistration)
      {
        throw new HostPreconditionException("probe_failed_before_registration");
      }

      var registration = new EgressDirectRegistrationV1(
        EgressSupervisorLifecycleContract.Version,
        EgressSupervisorLifecycleCanonical.OperationId(context.ActionId, "probe-direct"),
        Environment.ProcessId,
        DateTimeOffset.UtcNow.AddMinutes(-1).ToUnixTimeMilliseconds(),
        "https",
        "gateway.example",
        443,
        context.EgressDestinationPolicySha256!,
        new string('c', 64),
        session.Authorization.Lease.Lease.ReservationDnsAnswerSetSha256,
        new string('d', 64));
      if (await session.TryRegisterDirectAsync(registration, cancellationToken)
        .ConfigureAwait(false) is null)
      {
        throw new HostPreconditionException("probe_registration_not_acknowledged");
      }
      if (behavior == LifecycleProbeBehavior.FailAfterRegistration)
      {
        throw new HostPreconditionException("probe_failed_after_registration");
      }

      EffectCount++;
      var outcomeUncertain = behavior == LifecycleProbeBehavior.Uncertain;
      return new CapabilityExecutionResult(
        "{}",
        MutationCommitted: !outcomeUncertain,
        OutcomeUncertain: outcomeUncertain,
        Provenance: [],
        PreStateSha256: context.ExpectedPreStateSha256,
        ExternalEgressBytes: 123,
        EgressReceipt: behavior == LifecycleProbeBehavior.AdapterSuppliedReceipt
          ? new SignedEgressReceipt(null!, "adapter", "adapter")
          : null);
    }
  }

  private sealed class CoordinatorEgressClient(
    DateTimeOffset now,
    ECDsa attestationKey,
    ECDsa receiptKey,
    string? receiptOutcomeOverride,
    long? supervisorMeasuredExternalEgressBytes,
    bool omitTerminalReceipt) : IEgressBoundaryClient
  {
    public CoordinatorEgressSession? Session { get; private set; }

    public ValueTask<IEgressBoundarySession?> TryReserveAsync(
      string compactActionToken,
      string argumentsJsonUtf8,
      EgressActionBinding binding,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      Session ??= CreateSession(binding);
      return ValueTask.FromResult<IEgressBoundarySession?>(Session);
    }

    public ValueTask<IEgressBoundarySession?> TryResumeAsync(
      EgressExecutionAuthorization authorization,
      EgressActionBinding binding,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      return ValueTask.FromResult<IEgressBoundarySession?>(Session);
    }

    private CoordinatorEgressSession CreateSession(EgressActionBinding binding)
    {
      var receiptPublicKey = receiptKey.ExportSubjectPublicKeyInfo();
      var attestation = new BoundaryAttestationV1(
        EgressBoundaryCanonical.ContractVersion,
        "70000000-0000-4000-8000-000000000007",
        binding.DeviceId,
        "80000000-0000-4000-8000-000000000008",
        "90000000-0000-4000-8000-000000000009",
        now.AddSeconds(-10).ToUnixTimeMilliseconds(),
        now.AddMinutes(2).ToUnixTimeMilliseconds(),
        true,
        true,
        true,
        true,
        new string('1', 64),
        new string('2', 64),
        null,
        "test-egress-receipt",
        Convert.ToBase64String(receiptPublicKey),
        Convert.ToHexString(SHA256.HashData(receiptPublicKey)).ToLowerInvariant(),
        EgressBoundaryFeatures.CommandRequired);
      var signedAttestation = EgressBoundaryCanonical.SignAttestation(
        attestation,
        "test-egress-root",
        attestationKey);
      var lease = new EgressLeaseV1(
        EgressBoundaryCanonical.ContractVersion,
        "a0000000-0000-4000-8000-00000000000a",
        EgressBoundaryCanonical.AttestationSha256(attestation),
        binding.ActionTokenSha256,
        binding.ActionId,
        binding.TaskId,
        binding.PlanVersionId,
        binding.StepId,
        binding.DeviceId,
        binding.MandateId,
        binding.CapabilityId,
        binding.CapabilityVersion,
        binding.DispatchCount,
        binding.DestinationPolicySha256,
        binding.ExecutionIdentitySha256,
        binding.ArgumentsSha256,
        binding.ExpectedPreStateSha256,
        binding.IdempotencyKeySha256,
        new string('3', 64),
        new string('4', 64),
        new string('5', 64),
        new string('6', 64),
        binding.ReservedCapabilityEgressBytes,
        now.AddSeconds(-5).ToUnixTimeMilliseconds(),
        now.AddMinutes(1).ToUnixTimeMilliseconds());
      var authorization = new EgressExecutionAuthorization(
        signedAttestation,
        EgressBoundaryCanonical.SignLease(
          lease,
          "test-egress-receipt",
          receiptKey));
      return new CoordinatorEgressSession(
        authorization,
        receiptKey,
        now,
        receiptOutcomeOverride,
        supervisorMeasuredExternalEgressBytes,
        omitTerminalReceipt);
    }
  }

  private sealed class CoordinatorEgressSession(
    EgressExecutionAuthorization authorization,
    ECDsa receiptKey,
    DateTimeOffset now,
    string? receiptOutcomeOverride,
    long? supervisorMeasuredExternalEgressBytes,
    bool omitTerminalReceipt) : IEgressBoundarySession
  {
    private SignedEgressReceipt? _terminalReceipt;
    private string? _terminalOperationId;
    private string _registrationSha256 = EgressSupervisorLifecycleCanonical.ZeroSha256;

    public EgressExecutionAuthorization Authorization { get; } = authorization;

    public bool HasRegistration { get; private set; }

    public bool IsTerminal => _terminalReceipt is not null;

    public SignedEgressReceipt? TerminalReceipt => _terminalReceipt;

    public int DirectRegistrationAttempts { get; private set; }

    public int SettleAttempts { get; private set; }

    public int AbortAttempts { get; private set; }

    public ValueTask<EgressRegistrationAcknowledgementV1?> TryRegisterProcessAsync(
      EgressProcessRegistrationV1 registration,
      CancellationToken cancellationToken) => throw new NotSupportedException();

    public ValueTask<EgressRegistrationAcknowledgementV1?> TryRegisterDirectAsync(
      EgressDirectRegistrationV1 registration,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      DirectRegistrationAttempts++;
      HasRegistration = true;
      _registrationSha256 = EgressSupervisorLifecycleCanonical.RegistrationSha256(registration);
      var lease = Authorization.Lease.Lease;
      return ValueTask.FromResult<EgressRegistrationAcknowledgementV1?>(new(
        EgressSupervisorLifecycleContract.Version,
        EgressSupervisorLifecycleCanonical.OperationId(
          lease.ActionId,
          $"register:{EgressSupervisorLifecycleContract.DirectRegistration}:{registration.RegistrationId}"),
        registration.RegistrationId,
        EgressSupervisorLifecycleContract.DirectRegistration,
        EgressBoundaryCanonical.LeaseSha256(lease),
        _registrationSha256,
        now.ToUnixTimeMilliseconds()));
    }

    public ValueTask<EgressRegistrationAcknowledgementV1?> TryRegisterBrowserAsync(
      EgressBrowserRegistrationV1 registration,
      CancellationToken cancellationToken) => throw new NotSupportedException();

    public ValueTask<SignedEgressReceipt?> TrySettleAsync(
      EgressTerminalDispositionV1 disposition,
      CancellationToken cancellationToken)
    {
      SettleAttempts++;
      return TerminalAsync(disposition, cancellationToken);
    }

    public ValueTask<SignedEgressReceipt?> TryAbortAsync(
      EgressTerminalDispositionV1 disposition,
      CancellationToken cancellationToken)
    {
      AbortAttempts++;
      return TerminalAsync(disposition, cancellationToken);
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private ValueTask<SignedEgressReceipt?> TerminalAsync(
      EgressTerminalDispositionV1 disposition,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      if (omitTerminalReceipt)
      {
        return ValueTask.FromResult<SignedEgressReceipt?>(null);
      }
      if (_terminalReceipt is not null)
      {
        if (!string.Equals(
          _terminalOperationId,
          disposition.OperationId,
          StringComparison.Ordinal))
        {
          throw new InvalidOperationException("Conflicting terminal operation.");
        }
        return ValueTask.FromResult<SignedEgressReceipt?>(_terminalReceipt);
      }

      var lease = Authorization.Lease.Lease;
      var measured = supervisorMeasuredExternalEgressBytes
        ?? disposition.ReportedExternalEgressBytes;
      var receiptOutcome = receiptOutcomeOverride ?? disposition.Outcome;
      var uncertain = string.Equals(
        receiptOutcome,
        EgressSupervisorLifecycleContract.Unknown,
        StringComparison.Ordinal)
        ? lease.ReservedCapabilityEgressBytes - measured
        : 0;
      var receipt = new EgressReceiptV1(
        EgressBoundaryCanonical.ContractVersion,
        EgressSupervisorLifecycleCanonical.OperationId(
          lease.ActionId,
          $"receipt:{disposition.OperationId}"),
        EgressBoundaryCanonical.LeaseSha256(lease),
        EgressBoundaryCanonical.AttestationSha256(Authorization.Attestation.Attestation),
        lease.ActionTokenSha256,
        lease.ActionId,
        lease.TaskId,
        lease.PlanVersionId,
        lease.StepId,
        lease.DeviceId,
        lease.MandateId,
        lease.CapabilityId,
        lease.CapabilityVersion,
        lease.DispatchCount,
        lease.DestinationPolicySha256,
        lease.ExecutionIdentitySha256,
        lease.ArgumentsSha256,
        lease.ExpectedPreStateSha256,
        lease.IdempotencyKeySha256,
        lease.DestinationScopeSha256,
        lease.RequestBodySha256,
        lease.ExactRequestPolicySha256,
        lease.ReservationDnsAnswerSetSha256,
        lease.ReservationDnsAnswerSetSha256,
        new string('7', 64),
        _registrationSha256,
        EgressSupervisorLifecycleCanonical.DispositionSha256(disposition),
        lease.ReservedCapabilityEgressBytes,
        measured,
        uncertain,
        checked(measured + uncertain),
        lease.IssuedAtUnixMilliseconds,
        now.ToUnixTimeMilliseconds(),
        1,
        new string('e', 64),
        receiptOutcome);
      _terminalOperationId = disposition.OperationId;
      _terminalReceipt = EgressBoundaryCanonical.SignReceipt(
        receipt,
        "test-egress-receipt",
        receiptKey);
      return ValueTask.FromResult<SignedEgressReceipt?>(_terminalReceipt);
    }
  }

  private sealed class CoordinatorEgressVerifier(
    EgressBoundaryContractVerifier contracts) : ILocalSystemEgressEvidenceVerifier
  {
    public EgressExecutionEvidence? LastEvidence { get; private set; }

    public EgressVerificationResult<VerifiedEgressAuthorization> VerifyAuthorization(
      EgressExecutionAuthorization authorization,
      EgressActionBinding binding,
      IReadOnlyCollection<string> requiredFeatures) => contracts.VerifyAuthorization(
        authorization,
        binding,
        requiredFeatures);

    public ValueTask<EgressVerificationResult<VerifiedEgressReceipt>>
      VerifyAndCommitReceiptAsync(
        EgressExecutionEvidence evidence,
        EgressActionBinding binding,
        IReadOnlyCollection<string> requiredFeatures,
        CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      LastEvidence = evidence;
      return ValueTask.FromResult(contracts.VerifyReceipt(
        evidence,
        binding,
        requiredFeatures));
    }
  }

  private sealed class StaticEgressKeyResolver(
    string expectedKeyId,
    byte[] publicKeySpki) : IEgressAttestationKeyResolver
  {
    public bool TryResolve(string keyId, out ECDsa? publicKey)
    {
      if (!string.Equals(keyId, expectedKeyId, StringComparison.Ordinal))
      {
        publicKey = null;
        return false;
      }
      publicKey = ECDsa.Create();
      publicKey.ImportSubjectPublicKeyInfo(publicKeySpki, out _);
      return true;
    }
  }

  private sealed class FixedEgressTimeProvider(DateTimeOffset now) : TimeProvider
  {
    public override DateTimeOffset GetUtcNow() => now;
  }

  private sealed class NullEgressBoundaryClient : IEgressBoundaryClient
  {
    public ValueTask<IEgressBoundarySession?> TryReserveAsync(
      string compactActionToken,
      string argumentsJsonUtf8,
      EgressActionBinding binding,
      CancellationToken cancellationToken) =>
      ValueTask.FromResult<IEgressBoundarySession?>(null);

    public ValueTask<IEgressBoundarySession?> TryResumeAsync(
      EgressExecutionAuthorization authorization,
      EgressActionBinding binding,
      CancellationToken cancellationToken) =>
      ValueTask.FromResult<IEgressBoundarySession?>(null);
  }

  private sealed class RejectingEgressVerifier : ILocalSystemEgressEvidenceVerifier
  {
    public EgressVerificationResult<VerifiedEgressAuthorization> VerifyAuthorization(
      EgressExecutionAuthorization authorization,
      EgressActionBinding binding,
      IReadOnlyCollection<string> requiredFeatures) =>
      EgressVerificationResult.Invalid<VerifiedEgressAuthorization>(
        "egress_boundary_unavailable");

    public ValueTask<EgressVerificationResult<VerifiedEgressReceipt>>
      VerifyAndCommitReceiptAsync(
        EgressExecutionEvidence evidence,
        EgressActionBinding binding,
        IReadOnlyCollection<string> requiredFeatures,
        CancellationToken cancellationToken) =>
      ValueTask.FromResult(EgressVerificationResult.Invalid<VerifiedEgressReceipt>(
        "egress_boundary_unavailable"));
  }

  private sealed class InMemoryActionResultStore : IActionResultStore
  {
    private readonly Dictionary<string, ActionResult> _results = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> _deliverySessions = new(StringComparer.Ordinal);

    public ValueTask StoreAsync(
      ActionRequest request,
      ActionResult result,
      long maximumExternalEgressBytes,
      CancellationToken cancellationToken)
    {
      _results[request.IdempotencyKey] = result;
      _deliverySessions[request.IdempotencyKey] = 0;
      return ValueTask.CompletedTask;
    }

    public ValueTask<ActionResult?> TryLoadAsync(
      ActionRequest request,
      JournalTerminalReceipt receipt,
      CancellationToken cancellationToken) =>
      ValueTask.FromResult(_results.GetValueOrDefault(request.IdempotencyKey));

    public ValueTask<bool> TryBeginDeliverySessionAsync(
      ActionRequest request,
      JournalTerminalReceipt receipt,
      int maximumDeliverySessions,
      CancellationToken cancellationToken)
    {
      if (!_deliverySessions.TryGetValue(request.IdempotencyKey, out var sessions)
        || sessions >= Math.Min(maximumDeliverySessions, receipt.BrokerMaxDeliverySessions))
      {
        return ValueTask.FromResult(false);
      }
      _deliverySessions[request.IdempotencyKey] = sessions + 1;
      return ValueTask.FromResult(true);
    }
  }

  private sealed class StaticTokenVerifier(ActionTokenClaims claims) : IActionTokenVerifier
  {
    public ValueTask<ActionTokenVerificationResult> VerifyAsync(
      string compactToken,
      CancellationToken cancellationToken) =>
      ValueTask.FromResult(ActionTokenVerificationResult.Valid(claims));
  }

  private sealed class StaticFenceTokenVerifier(FenceTokenClaims claims) : IFenceTokenVerifier
  {
    public ValueTask<FenceTokenVerificationResult> VerifyAsync(
      string compactToken,
      CancellationToken cancellationToken) =>
      ValueTask.FromResult(FenceTokenVerificationResult.Valid(claims));
  }

  private sealed class AmbiguousTerminalJournal(ActionRequest request) : IActionJournal
  {
    private readonly JournalRecord _prepared = new(
      1,
      DateTimeOffset.UtcNow,
      JournalEntryKind.Prepared,
      request.ActionId,
      request.IdempotencyKey,
      new string('0', 64),
      PayloadDigest.Sha256Hex("prepared-payload"),
      PayloadDigest.Sha256Hex("prepared-entry"));

    public int TerminalAttempts { get; private set; }

    public ValueTask InitializeAsync(CancellationToken cancellationToken) =>
      ValueTask.CompletedTask;

    public ValueTask<JournalBeginResult> TryBeginAsync(
      ActionRequest actionRequest,
      string compactTokenSha256,
      long maximumExternalEgressBytes,
      long reservedBrokerExternalEgressBytes,
      int brokerMaxDeliverySessions,
      int brokerMaxRequestAttemptsPerSession,
      long brokerSerializedResultUpperBoundBytes,
      CancellationToken cancellationToken) => ValueTask.FromResult(new JournalBeginResult(
        JournalBeginDisposition.Started,
        _prepared,
        null));

    public ValueTask<JournalTerminalReceipt?> TryGetTerminalAsync(
      ActionRequest actionRequest,
      CancellationToken cancellationToken) =>
      ValueTask.FromResult<JournalTerminalReceipt?>(null);

    public ValueTask<bool> IsFencedAsync(
      ActionRequest actionRequest,
      CancellationToken cancellationToken) => ValueTask.FromResult(false);

    public ValueTask<JournalTerminalReceipt> AppendTerminalAsync(
      ActionRequest actionRequest,
      ActionResult result,
      JournalEntryKind kind,
      CancellationToken cancellationToken)
    {
      TerminalAttempts++;
      throw new IOException("Simulated ambiguous terminal fsync failure");
    }

    public ValueTask<JournalRecord> AppendRecoveryPreparedAsync(
      JournalRecoveryPreparedCheckpoint checkpoint,
      CancellationToken cancellationToken) => throw new InvalidOperationException(
        "This terminal-failure test does not prepare host recovery.");

    public ValueTask<JournalHead> GetHeadAsync(CancellationToken cancellationToken) =>
      ValueTask.FromResult(new JournalHead(_prepared.Sequence, _prepared.EntryHash));

    public ValueTask<JournalVerificationResult> VerifyAsync(
      CancellationToken cancellationToken) =>
      ValueTask.FromResult(new JournalVerificationResult(true, 1, null, null));
  }

  private sealed class RecordingChannel(bool ledgerConnected) : IOutboundCompanionChannel
  {
    private int _ledgerConnected = ledgerConnected ? 1 : 0;
    private int _failNextActionStartedAcknowledgement;
    private int _disconnectAfterNextActionStartedAcknowledgement;
    private Func<ActionProgress, ActionProgressAcknowledgement>? _nextStartedAcknowledgement;
    private readonly ConcurrentQueue<ActionProgress> _progress = new();
    private readonly ConcurrentQueue<ActionResult> _results = new();
    private readonly ConcurrentQueue<ActionFencedReceipt> _fenceReceipts = new();
    private TaskCompletionSource<bool>? _blockedResultRelease;

    public IReadOnlyList<ActionResult> Results => _results.ToArray();

    public IReadOnlyList<ActionProgress> Progress => _progress.ToArray();

    public IReadOnlyList<ActionFencedReceipt> FenceReceipts => _fenceReceipts.ToArray();

    public TaskCompletionSource<bool> LeaseHeartbeatObserved { get; } =
      new(TaskCreationOptions.RunContinuationsAsynchronously);

    public TaskCompletionSource<bool> ResultSendStarted { get; private set; } =
      new(TaskCreationOptions.RunContinuationsAsynchronously);

    public void BlockNextResult()
    {
      ResultSendStarted = new(TaskCreationOptions.RunContinuationsAsynchronously);
      _blockedResultRelease = new(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    public void ReleaseBlockedResult() => _blockedResultRelease?.TrySetResult(true);

    public OutboundChannelState State => OutboundChannelState.Connected;

    public bool IsCentralLedgerConnected => Volatile.Read(ref _ledgerConnected) == 1;

    public void DisconnectLedger() => Volatile.Write(ref _ledgerConnected, 0);

    public void ConnectLedger() => Volatile.Write(ref _ledgerConnected, 1);

    public void FailNextActionStartedAcknowledgement() =>
      Volatile.Write(ref _failNextActionStartedAcknowledgement, 1);

    public void DisconnectAfterNextActionStartedAcknowledgement() =>
      Volatile.Write(ref _disconnectAfterNextActionStartedAcknowledgement, 1);

    public void ReturnGenericNextActionStartedAcknowledgement() =>
      _nextStartedAcknowledgement = _ => new ActionProgressAcknowledgement(Accepted: true);

    public void ReturnWrongHashNextActionStartedAcknowledgement() =>
      _nextStartedAcknowledgement = progress => ExactAcknowledgement(progress) with
      {
        JournalPrepareEntryHash = new string('f', 64),
      };

    public void ReturnStaleNextActionStartedAcknowledgement() =>
      _nextStartedAcknowledgement = progress => ExactAcknowledgement(progress) with
      {
        DispatchCount = Math.Max(0, progress.DispatchCount - 1),
      };

    public ValueTask ConnectAsync(CancellationToken cancellationToken) => ValueTask.CompletedTask;

    public async IAsyncEnumerable<DeviceCommand> ReadCommandsAsync(
      [EnumeratorCancellation] CancellationToken cancellationToken)
    {
      await Task.Yield();
      yield break;
    }

    public ValueTask<ActionProgressAcknowledgement> SendProgressAsync(
      ActionProgress progress,
      CancellationToken cancellationToken)
    {
      _progress.Enqueue(progress);
      if (string.Equals(progress.MessageCode, "action_started", StringComparison.Ordinal))
      {
        if (Interlocked.Exchange(ref _failNextActionStartedAcknowledgement, 0) == 1)
        {
          DisconnectLedger();
          return ValueTask.FromException<ActionProgressAcknowledgement>(
            new IOException("Simulated action-start acknowledgement failure."));
        }
        if (Interlocked.Exchange(
          ref _disconnectAfterNextActionStartedAcknowledgement,
          0) == 1)
        {
          DisconnectLedger();
        }
      }
      if (string.Equals(progress.MessageCode, "lease_heartbeat", StringComparison.Ordinal))
      {
        LeaseHeartbeatObserved.TrySetResult(true);
      }
      if (string.Equals(progress.MessageCode, "action_started", StringComparison.Ordinal)
        && _nextStartedAcknowledgement is not null)
      {
        var factory = _nextStartedAcknowledgement;
        _nextStartedAcknowledgement = null;
        return ValueTask.FromResult(factory(progress));
      }
      return ValueTask.FromResult(ExactAcknowledgement(progress));
    }

    private static ActionProgressAcknowledgement ExactAcknowledgement(
      ActionProgress progress) => new(
        true,
        progress.ActionId,
        progress.DispatchCount,
        progress.JournalPrepareSequence,
        progress.JournalPreparePreviousHash,
        progress.JournalPrepareEntryHash);

    public async ValueTask SendResultAsync(ActionResult result, CancellationToken cancellationToken)
    {
      if (_blockedResultRelease is not null)
      {
        ResultSendStarted.TrySetResult(true);
        await _blockedResultRelease.Task.ConfigureAwait(false);
        _blockedResultRelease = null;
      }
      _results.Enqueue(result);
    }

    public ValueTask SendActionFencedAsync(
      ActionFencedReceipt receipt,
      CancellationToken cancellationToken)
    {
      _fenceReceipts.Enqueue(receipt);
      return ValueTask.CompletedTask;
    }

    public ValueTask SendHeartbeatAsync(
      CompanionHeartbeat heartbeat,
      CancellationToken cancellationToken) => ValueTask.CompletedTask;

    public ValueTask SendManifestAsync(
      CapabilityManifestSnapshot manifest,
      CancellationToken cancellationToken) => ValueTask.CompletedTask;

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
  }

  private sealed class BlockingReadAdapter : IHostCapabilityAdapter
  {
    private static readonly JsonElement Schema = ParseSchema();

    public TaskCompletionSource<bool> Started { get; } =
      new(TaskCreationOptions.RunContinuationsAsynchronously);

    public CapabilityDescriptor Descriptor { get; } = new(
      "companion.noop",
      "1.0.0",
      "Blocking read",
      "Test only",
      CapabilityDataClass.Internal,
      CapabilityEffect.LocalRead,
      ConsentRequirement.SignedMandate,
      RecoveryKind.NotApplicable,
      RequiredPrivilege.StandardUser,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      Schema,
      Schema,
      ["test"],
      false);

    public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
      CapabilityArgumentValidation.Success;

    public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
      CapabilityArgumentValidation.Success;

    public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
      ActionExecutionContext context,
      JsonElement arguments,
      CancellationToken cancellationToken)
    {
      Started.TrySetResult(true);
      await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
      throw new InvalidOperationException("The infinite delay returned unexpectedly.");
    }

    private static JsonElement ParseSchema()
    {
      using var document = JsonDocument.Parse(
        "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}");
      return document.RootElement.Clone();
    }
  }

  private sealed class InvalidErrorCodeAdapter : IHostCapabilityAdapter
  {
    private static readonly JsonElement Schema = ParseSchema();

    public CapabilityDescriptor Descriptor { get; } = new(
      "companion.noop",
      "1.0.0",
      "Invalid error-code adapter",
      "Test only",
      CapabilityDataClass.Internal,
      CapabilityEffect.LocalRead,
      ConsentRequirement.SignedMandate,
      RecoveryKind.NotApplicable,
      RequiredPrivilege.StandardUser,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      Schema,
      Schema,
      ["test"],
      false);

    public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
      CapabilityArgumentValidation.Success;

    public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
      CapabilityArgumentValidation.Success;

    public ValueTask<CapabilityExecutionResult> ExecuteAsync(
      ActionExecutionContext context,
      JsonElement arguments,
      CancellationToken cancellationToken) =>
      ValueTask.FromException<CapabilityExecutionResult>(
        new HostPreconditionException("invalid error code"));

    private static JsonElement ParseSchema()
    {
      using var document = JsonDocument.Parse(
        "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}");
      return document.RootElement.Clone();
    }
  }

  private sealed class IsolationUnsafeMutationAdapter(
    PrivilegedCommandIsolationDispatchLatch latch) : IHostCapabilityAdapter
  {
    private static readonly JsonElement Schema = ParseSchema();

    public CapabilityDescriptor Descriptor { get; } = new(
      "example.isolation-unsafe",
      "1.0.0",
      "Isolation unsafe mutation",
      "Test only",
      CapabilityDataClass.Internal,
      CapabilityEffect.LocalWrite,
      ConsentRequirement.SignedMandate,
      RecoveryKind.Quarantine,
      RequiredPrivilege.LocalSystem,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      Schema,
      Schema,
      ["test"],
      false);

    public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
      CapabilityArgumentValidation.Success;

    public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
      CapabilityArgumentValidation.Success;

    public ValueTask<CapabilityExecutionResult> ExecuteAsync(
      ActionExecutionContext context,
      JsonElement arguments,
      CancellationToken cancellationToken)
    {
      latch.Trip();
      return ValueTask.FromException<CapabilityExecutionResult>(
        new PrivilegedCommandIsolationUnsafeException(
          "trusted_root_isolation_terminal_receipt_invalid",
          "terminal-settlement",
          mayHaveExecuted: true));
    }

    private static JsonElement ParseSchema()
    {
      using var document = JsonDocument.Parse(
        "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}");
      return document.RootElement.Clone();
    }
  }

  private sealed class RecordingMutationAdapter : IHostCapabilityAdapter
  {
    private static readonly JsonElement Schema = ParseSchema();

    public bool WasInvoked { get; private set; }

    public CapabilityDescriptor Descriptor { get; } = new(
      "example.mutation",
      "1.0.0",
      "Example mutation",
      "Test only",
      CapabilityDataClass.Internal,
      CapabilityEffect.LocalWrite,
      ConsentRequirement.SignedMandate,
      RecoveryKind.Quarantine,
      RequiredPrivilege.LocalSystem,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      Schema,
      Schema,
      ["test"],
      false);

    public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
      CapabilityArgumentValidation.Success;

    public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
      CapabilityArgumentValidation.Success;

    public ValueTask<CapabilityExecutionResult> ExecuteAsync(
      ActionExecutionContext context,
      JsonElement arguments,
      CancellationToken cancellationToken)
    {
      WasInvoked = true;
      return ValueTask.FromResult(new CapabilityExecutionResult("{}", true, false, []));
    }

    private static JsonElement ParseSchema()
    {
      using var document = JsonDocument.Parse(
        "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}");
      return document.RootElement.Clone();
    }
  }

  private sealed class BlockingMutationAdapter : IHostCapabilityAdapter
  {
    private static readonly JsonElement Schema = ParseSchema();

    public TaskCompletionSource<bool> Started { get; } =
      new(TaskCreationOptions.RunContinuationsAsynchronously);

    public CapabilityDescriptor Descriptor { get; } = new(
      "example.blocking-mutation",
      "1.0.0",
      "Blocking mutation",
      "Test only",
      CapabilityDataClass.Internal,
      CapabilityEffect.LocalWrite,
      ConsentRequirement.SignedMandate,
      RecoveryKind.Quarantine,
      RequiredPrivilege.LocalSystem,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      Schema,
      Schema,
      ["test"],
      false);

    public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
      CapabilityArgumentValidation.Success;

    public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
      CapabilityArgumentValidation.Success;

    public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
      ActionExecutionContext context,
      JsonElement arguments,
      CancellationToken cancellationToken)
    {
      Started.TrySetResult(true);
      await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
      throw new InvalidOperationException("The infinite delay returned unexpectedly.");
    }

    private static JsonElement ParseSchema()
    {
      using var document = JsonDocument.Parse(
        "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}");
      return document.RootElement.Clone();
    }
  }

  private sealed class CountingAdapter : IHostCapabilityAdapter
  {
    private static readonly JsonElement Schema = ParseSchema();

    public int InvocationCount { get; private set; }

    public CapabilityDescriptor Descriptor { get; } = new(
      "companion.noop",
      "1.0.0",
      "Counting adapter",
      "Test only",
      CapabilityDataClass.Internal,
      CapabilityEffect.LocalRead,
      ConsentRequirement.SignedMandate,
      RecoveryKind.NotApplicable,
      RequiredPrivilege.StandardUser,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      Schema,
      Schema,
      ["test"],
      false);

    public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
      CapabilityArgumentValidation.Success;

    public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
      CapabilityArgumentValidation.Success;

    public ValueTask<CapabilityExecutionResult> ExecuteAsync(
      ActionExecutionContext context,
      JsonElement arguments,
      CancellationToken cancellationToken)
    {
      InvocationCount++;
      return ValueTask.FromResult(new CapabilityExecutionResult(
        "{\"value\":\"prior-result\"}",
        MutationCommitted: false,
        OutcomeUncertain: false,
        [],
        ExternalEgressBytes: 17));
    }

    private static JsonElement ParseSchema()
    {
      using var document = JsonDocument.Parse(
        "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}");
      return document.RootElement.Clone();
    }
  }

  private sealed class ScheduledTaskMetadataProbeAdapter(
    AllowedScheduledTask target,
    ScheduledTaskDefinition definition) : IHostCapabilityAdapter
  {
    public int InvocationCount { get; private set; }

    public CapabilityDescriptor Descriptor { get; } = ScheduledTaskSchemas.Descriptor(
      "scheduled-task.definition.read",
      "Read approved scheduled task metadata",
      "Reads secret-free enabled state and digests for one approved scheduled task.",
      CapabilityEffect.LocalRead,
      RecoveryKind.NotApplicable,
      ScheduledTaskSchemas.TargetArguments,
      ScheduledTaskSchemas.DefinitionResult,
      ["windows-task-scheduler"],
      ScheduledTaskSchemas.MetadataCapabilityVersion);

    public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
      ScheduledTaskSchemas.ValidateTarget(arguments);

    public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
      ScheduledTaskSchemas.ValidateDefinitionResult(result);

    public ValueTask<CapabilityExecutionResult> ExecuteAsync(
      ActionExecutionContext context,
      JsonElement arguments,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      InvocationCount++;
      return ValueTask.FromResult(ScheduledTaskDefinitionReadCapabilityAdapter.Result(
        target,
        definition,
        mutation: false));
    }
  }

  private sealed class MismatchedPreStateMutationAdapter(string observedPreState) :
    IHostCapabilityAdapter
  {
    private static readonly JsonElement Schema = ParseSchema();

    public bool WasInvoked { get; private set; }

    public CapabilityDescriptor Descriptor { get; } = new(
      "example.pre-state-mutation",
      "1.0.0",
      "Pre-state mutation",
      "Test only",
      CapabilityDataClass.Internal,
      CapabilityEffect.LocalWrite,
      ConsentRequirement.SignedMandate,
      RecoveryKind.Snapshot,
      RequiredPrivilege.LocalSystem,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      Schema,
      Schema,
      ["test"],
      false);

    public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
      CapabilityArgumentValidation.Success;

    public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
      CapabilityArgumentValidation.Success;

    public ValueTask<CapabilityExecutionResult> ExecuteAsync(
      ActionExecutionContext context,
      JsonElement arguments,
      CancellationToken cancellationToken)
    {
      WasInvoked = true;
      return ValueTask.FromResult(new CapabilityExecutionResult(
        "{}",
        MutationCommitted: true,
        OutcomeUncertain: false,
        [],
        PreStateSha256: observedPreState));
    }

    private static JsonElement ParseSchema()
    {
      using var document = JsonDocument.Parse(
        "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}");
      return document.RootElement.Clone();
    }
  }

  private sealed class EmergencyConsentAdapter : IHostCapabilityAdapter
  {
    private static readonly JsonElement Schema = ParseSchema();

    public bool WasInvoked { get; private set; }

    public CapabilityDescriptor Descriptor { get; } = new(
      "companion.noop",
      "1.0.0",
      "Emergency adapter",
      "Test only",
      CapabilityDataClass.Internal,
      CapabilityEffect.LocalRead,
      ConsentRequirement.EmergencyOperator,
      RecoveryKind.NotApplicable,
      RequiredPrivilege.StandardUser,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      Schema,
      Schema,
      ["test"],
      false);

    public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
      CapabilityArgumentValidation.Success;

    public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
      CapabilityArgumentValidation.Success;

    public ValueTask<CapabilityExecutionResult> ExecuteAsync(
      ActionExecutionContext context,
      JsonElement arguments,
      CancellationToken cancellationToken)
    {
      WasInvoked = true;
      return ValueTask.FromResult(new CapabilityExecutionResult("{}", false, false, []));
    }

    private static JsonElement ParseSchema()
    {
      using var document = JsonDocument.Parse(
        "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}");
      return document.RootElement.Clone();
    }
  }

  private sealed class PrivilegedCommandProbeAdapter : IHostCapabilityAdapter
  {
    private static readonly JsonElement Schema = ParseSchema();

    public bool WasInvoked { get; private set; }

    public CapabilityDescriptor Descriptor { get; } = new(
      PrivilegedCommandExecuteCapabilityAdapter.CapabilityId,
      PrivilegedCommandExecuteCapabilityAdapter.CapabilityVersion,
      "Privileged command probe",
      "Test only",
      CapabilityDataClass.Credential,
      CapabilityEffect.Irreversible,
      ConsentRequirement.OneShotApproval,
      RecoveryKind.Irreversible,
      RequiredPrivilege.LocalSystem,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      Schema,
      Schema,
      ["test"],
      false);

    public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
      CapabilityArgumentValidation.Success;

    public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
      CapabilityArgumentValidation.Success;

    public ValueTask<CapabilityExecutionResult> ExecuteAsync(
      ActionExecutionContext context,
      JsonElement arguments,
      CancellationToken cancellationToken)
    {
      WasInvoked = true;
      return ValueTask.FromResult(new CapabilityExecutionResult(
        "{}",
        MutationCommitted: true,
        OutcomeUncertain: true,
        [],
        PreStateSha256: context.ExpectedPreStateSha256));
    }

    private static JsonElement ParseSchema()
    {
      using var document = JsonDocument.Parse(
        "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}");
      return document.RootElement.Clone();
    }
  }

  private sealed class BoundaryProbeAdapter : IHostCapabilityAdapter
  {
    private static readonly JsonElement Schema = ParseSchema();

    public BoundaryProbeAdapter(string capabilityId)
    {
      Descriptor = new CapabilityDescriptor(
        capabilityId,
        "1.0.0",
        "Boundary probe",
        "Test only",
        CapabilityDataClass.Internal,
        CapabilityEffect.LocalRead,
        ConsentRequirement.SignedMandate,
        RecoveryKind.NotApplicable,
        RequiredPrivilege.LocalSystem,
        IdempotencySemantics.Required,
        ["windows-11-x64"],
        Schema,
        Schema,
        ["test"],
        false);
    }

    public int InvocationCount { get; private set; }

    public CapabilityDescriptor Descriptor { get; }

    public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
      CapabilityArgumentValidation.Success;

    public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
      CapabilityArgumentValidation.Success;

    public ValueTask<CapabilityExecutionResult> ExecuteAsync(
      ActionExecutionContext context,
      JsonElement arguments,
      CancellationToken cancellationToken)
    {
      InvocationCount++;
      return ValueTask.FromResult(new CapabilityExecutionResult("{}", false, false, []));
    }

    private static JsonElement ParseSchema()
    {
      using var document = JsonDocument.Parse(
        "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}");
      return document.RootElement.Clone();
    }
  }
}
