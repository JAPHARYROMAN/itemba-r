using System.Runtime.CompilerServices;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Channel;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Journal;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Execution;
using Itemba.Msaidizi.Companion.Service.Journal;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class ActionDispatchGenerationReplayTests : IDisposable
{
  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"msaidizi-dispatch-replay-tests-{Guid.NewGuid():N}");

  [Fact]
  public async Task NewDispatchGenerationReplaysTerminalWithoutInvokingAdapterTwice()
  {
    var now = DateTimeOffset.UtcNow;
    var firstRequest = ActionTokenVerifierTests.CreateRequest("{}", now) with
    {
      DispatchCount = 1,
    };
    var secondRequest = firstRequest with { DispatchCount = 2 };
    var firstClaims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
    {
      TokenId = "generation-1",
      DispatchCount = 1,
    };
    var secondClaims = firstClaims with
    {
      TokenId = "generation-2",
      DispatchCount = 2,
    };
    var verifier = new GenerationTokenVerifier(new Dictionary<string, ActionTokenClaims>
    {
      ["generation-1"] = firstClaims,
      ["generation-2"] = secondClaims,
    });
    var adapter = new CountingReadAdapter();
    var channel = new RecordingChannel();
    var resultStore = new InMemoryResultStore();
    using var journal = new FileHashChainActionJournal(
      Path.Combine(_directory, "dispatch-generations.jsonl"));
    await journal.InitializeAsync(CancellationToken.None);
    using var coordinator = CreateCoordinator(adapter, verifier, journal, resultStore, channel);

    await coordinator.ExecuteAsync(
      new SignedActionRequest(firstRequest, "generation-1"),
      CancellationToken.None);
    var terminalHead = await journal.GetHeadAsync(CancellationToken.None);
    await coordinator.ExecuteAsync(
      new SignedActionRequest(secondRequest, "generation-2"),
      CancellationToken.None);

    Assert.Equal(1, adapter.InvocationCount);
    Assert.Equal(2, channel.Results.Count);
    Assert.False(channel.Results[0].IsIdempotentReplay);
    Assert.True(channel.Results[1].IsIdempotentReplay);
    Assert.Equal(channel.Results[0].OutputJson, channel.Results[1].OutputJson);
    Assert.Equal(channel.Results[0].JournalEntryHash, channel.Results[1].JournalEntryHash);
    Assert.Equal(
      PayloadDigest.Sha256Hex("generation-1"),
      channel.Results[1].ActionTokenSha256);
    Assert.Equal(firstRequest.LeaseId, channel.Results[1].LeaseId);
    Assert.Equal(firstRequest.FencingToken, channel.Results[1].FencingToken);
    Assert.Equal(terminalHead, await journal.GetHeadAsync(CancellationToken.None));
  }

  private static ActionExecutionCoordinator CreateCoordinator(
    IHostCapabilityAdapter adapter,
    IActionTokenVerifier verifier,
    IActionJournal journal,
    IActionResultStore resultStore,
    IOutboundCompanionChannel channel)
  {
    var companionOptions = Options.Create(new CompanionOptions
    {
      DeviceId = "device-1",
      ExecutionEnabled = true,
      LeaseHeartbeatSeconds = 1,
      MaxResultDeliverySessions = 3,
      KillSwitchPath = Path.Combine(Path.GetTempPath(), $"absent-{Guid.NewGuid():N}"),
    });
    return new ActionExecutionCoordinator(
      companionOptions,
      Options.Create(new BrokerChannelOptions { MaxRequestAttempts = 3 }),
      verifier,
      new RejectingFenceTokenVerifier(),
      journal,
      resultStore,
      new CapabilityRegistry([adapter]),
      new TrustedRootGuard(companionOptions),
      new NullEgressBoundaryClient(),
      new RejectingEgressVerifier(),
      new EgressBoundaryDispatchLatch(),
      new PrivilegedCommandIsolationDispatchLatch(),
      channel,
      NullLogger<ActionExecutionCoordinator>.Instance);
  }

  public void Dispose()
  {
    if (Directory.Exists(_directory))
    {
      Directory.Delete(_directory, recursive: true);
    }
  }

  private sealed class GenerationTokenVerifier(
    IReadOnlyDictionary<string, ActionTokenClaims> claimsByToken) : IActionTokenVerifier
  {
    public ValueTask<ActionTokenVerificationResult> VerifyAsync(
      string compactToken,
      CancellationToken cancellationToken) =>
      ValueTask.FromResult(claimsByToken.TryGetValue(compactToken, out var claims)
        ? ActionTokenVerificationResult.Valid(claims)
        : ActionTokenVerificationResult.Invalid("test_token_unknown"));
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
      EgressVerificationResult.Invalid<VerifiedEgressAuthorization>("egress_not_used");

    public ValueTask<EgressVerificationResult<VerifiedEgressReceipt>> VerifyAndCommitReceiptAsync(
      EgressExecutionEvidence evidence,
      EgressActionBinding binding,
      IReadOnlyCollection<string> requiredFeatures,
      CancellationToken cancellationToken) =>
      ValueTask.FromResult(
        EgressVerificationResult.Invalid<VerifiedEgressReceipt>("egress_not_used"));
  }

  private sealed class InMemoryResultStore : IActionResultStore
  {
    private ActionResult? _result;
    private int _deliverySessions;

    public ValueTask StoreAsync(
      ActionRequest request,
      ActionResult result,
      long maximumExternalEgressBytes,
      CancellationToken cancellationToken)
    {
      _result = result;
      _deliverySessions = 0;
      return ValueTask.CompletedTask;
    }

    public ValueTask<ActionResult?> TryLoadAsync(
      ActionRequest request,
      JournalTerminalReceipt receipt,
      CancellationToken cancellationToken) => ValueTask.FromResult(_result);

    public ValueTask<bool> TryBeginDeliverySessionAsync(
      ActionRequest request,
      JournalTerminalReceipt receipt,
      int maximumDeliverySessions,
      CancellationToken cancellationToken)
    {
      if (_result is null
        || _deliverySessions >= Math.Min(maximumDeliverySessions, receipt.BrokerMaxDeliverySessions))
      {
        return ValueTask.FromResult(false);
      }
      _deliverySessions++;
      return ValueTask.FromResult(true);
    }
  }

  private sealed class RecordingChannel : IOutboundCompanionChannel
  {
    public List<ActionResult> Results { get; } = [];

    public OutboundChannelState State => OutboundChannelState.Connected;

    public bool IsCentralLedgerConnected => true;

    public ValueTask ConnectAsync(CancellationToken cancellationToken) => ValueTask.CompletedTask;

    public async IAsyncEnumerable<DeviceCommand> ReadCommandsAsync(
      [EnumeratorCancellation] CancellationToken cancellationToken)
    {
      await Task.Yield();
      yield break;
    }

    public ValueTask<ActionProgressAcknowledgement> SendProgressAsync(
      ActionProgress progress,
      CancellationToken cancellationToken) => ValueTask.FromResult(
        new ActionProgressAcknowledgement(Accepted: true));

    public ValueTask SendResultAsync(
      ActionResult result,
      CancellationToken cancellationToken)
    {
      Results.Add(result);
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

  private sealed class CountingReadAdapter : IHostCapabilityAdapter
  {
    private static readonly JsonElement Schema = ParseSchema();

    public int InvocationCount { get; private set; }

    public CapabilityDescriptor Descriptor { get; } = new(
      "companion.noop",
      "1.0.0",
      "Dispatch generation replay",
      "Test-only idempotency probe",
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
}
