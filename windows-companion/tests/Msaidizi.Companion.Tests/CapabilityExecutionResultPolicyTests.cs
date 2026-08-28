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

public sealed class CapabilityExecutionResultPolicyTests
{
  private static readonly DateTimeOffset Now =
    new(2026, 8, 28, 12, 0, 0, TimeSpan.Zero);
  private static readonly JsonElement EmptySchema = ParseSchema();
  private static readonly string RecoveryHandle = new('a', 64);
  private static readonly string RecoveryDigest = PayloadDigest.Sha256Hex("recovery-record");

  [Fact]
  public void EmptyAndRepeatedDeclaredProvenanceRemainValid()
  {
    var descriptor = Descriptor(mutation: false, ["test-source"]);
    var empty = Result(provenance: []);
    var repeated = Enumerable.Repeat(Provenance(), CompanionWireContract.MaximumProvenanceOutputs)
      .ToArray();

    Assert.True(CapabilityExecutionResultPolicy.IsValid(descriptor, empty, Now));
    Assert.True(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      Result(repeated),
      Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      Result([.. repeated, Provenance()]),
      Now));
  }

  [Fact]
  public void NullRequiredFieldsAndEntriesFailClosed()
  {
    var descriptor = Descriptor(mutation: false, ["test-source"]);
    var valid = Result([Provenance()]);

    Assert.False(CapabilityExecutionResultPolicy.IsValid(null, valid, Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(descriptor, null, Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      valid with { OutputJson = null! },
      Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      valid with { Provenance = null! },
      Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      valid with { Provenance = new DataProvenance[] { null! } },
      Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      Result([Provenance() with { SourceType = null! }]),
      Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      Result([Provenance() with { SourceIdentifierHash = null! }]),
      Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      Result([Provenance() with { ContentSha256 = null! }]),
      Now));
  }

  [Fact]
  public void ProvenanceMustBeDeclaredCanonicalAndTrusted()
  {
    var descriptor = Descriptor(mutation: false, ["test-source"]);

    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      Result([Provenance() with { SourceType = "undeclared-source" }]),
      Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      Result([Provenance() with { SourceIdentifierHash = new string('A', 64) }]),
      Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      Result([Provenance() with { ContentSha256 = new string('b', 63) }]),
      Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      Result([Provenance() with { Trust = (ProvenanceTrust)int.MaxValue }]),
      Now));
  }

  [Fact]
  public void ObservationTimestampsMustBeUtcAndSane()
  {
    var descriptor = Descriptor(mutation: false, ["test-source"]);

    Assert.True(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      Result([Provenance() with { ObservedAt = DateTimeOffset.UnixEpoch }]),
      Now));
    Assert.True(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      Result(
      [
        Provenance() with
        {
          ObservedAt = Now + CapabilityExecutionResultPolicy.MaximumFutureObservationSkew,
        },
      ]),
      Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      Result([Provenance() with { ObservedAt = DateTimeOffset.UnixEpoch.AddTicks(-1) }]),
      Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      Result([Provenance() with { ObservedAt = Now.ToOffset(TimeSpan.FromHours(3)) }]),
      Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      Result(
      [
        Provenance() with
        {
          ObservedAt = Now
            + CapabilityExecutionResultPolicy.MaximumFutureObservationSkew
            + TimeSpan.FromTicks(1),
        },
      ]),
      Now));
  }

  [Fact]
  public void ReadDescriptorsCannotClaimMutation()
  {
    var result = Result(provenance: []) with { MutationCommitted = true };

    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      Descriptor(mutation: false, []),
      result,
      Now));
  }

  [Fact]
  public void RecoveryMetadataMustBePairedCanonicalAndCommitted()
  {
    var descriptor = Descriptor(mutation: true, ["host-recovery-record"]);
    var committed = Result(provenance: [], mutationCommitted: true);

    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      committed with { OpaqueRecoveryHandle = RecoveryHandle },
      Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      committed with { RecoveryProvenanceSha256 = RecoveryDigest },
      Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      committed with
      {
        OpaqueRecoveryHandle = RecoveryHandle.ToUpperInvariant(),
        RecoveryProvenanceSha256 = RecoveryDigest,
      },
      Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      committed with
      {
        OpaqueRecoveryHandle = RecoveryHandle,
        RecoveryProvenanceSha256 = RecoveryDigest.ToUpperInvariant(),
      },
      Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      Result(provenance: []) with
      {
        OpaqueRecoveryHandle = RecoveryHandle,
        RecoveryProvenanceSha256 = RecoveryDigest,
      },
      Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      Descriptor(mutation: false, ["host-recovery-record"]),
      committed with
      {
        OpaqueRecoveryHandle = RecoveryHandle,
        RecoveryProvenanceSha256 = RecoveryDigest,
      },
      Now));
  }

  [Fact]
  public void LegacyCommittedMutationMayCarryRecoveryPairWithoutProvenanceItem()
  {
    var result = Result(provenance: [], mutationCommitted: true) with
    {
      OpaqueRecoveryHandle = RecoveryHandle,
      RecoveryProvenanceSha256 = RecoveryDigest,
    };

    Assert.True(CapabilityExecutionResultPolicy.IsValid(
      Descriptor(mutation: true, ["host-recovery-record"]),
      result,
      Now));
  }

  [Theory]
  [InlineData("host-recovery-record")]
  [InlineData("session-recovery-record")]
  [InlineData("external-recovery-record")]
  public void ExactRepeatedRecoveryProvenancePatternsRemainValid(string sourceType)
  {
    var recovery = Provenance(sourceType) with
    {
      SourceIdentifierHash = PayloadDigest.Sha256Hex(RecoveryHandle),
      ContentSha256 = RecoveryDigest,
    };
    var result = Result([recovery, recovery], mutationCommitted: true) with
    {
      OpaqueRecoveryHandle = RecoveryHandle,
      RecoveryProvenanceSha256 = RecoveryDigest,
    };

    Assert.True(CapabilityExecutionResultPolicy.IsValid(
      Descriptor(mutation: true, [sourceType]),
      result,
      Now));
  }

  [Fact]
  public void RecoveryProvenanceRequiresAndMatchesRecoveryMetadata()
  {
    const string sourceType = "host-recovery-record";
    var descriptor = Descriptor(mutation: true, [sourceType]);
    var recovery = Provenance(sourceType) with
    {
      SourceIdentifierHash = PayloadDigest.Sha256Hex(RecoveryHandle),
      ContentSha256 = RecoveryDigest,
    };
    var committed = Result([recovery], mutationCommitted: true);

    Assert.False(CapabilityExecutionResultPolicy.IsValid(descriptor, committed, Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      committed with
      {
        OpaqueRecoveryHandle = new string('b', 64),
        RecoveryProvenanceSha256 = RecoveryDigest,
      },
      Now));
    Assert.False(CapabilityExecutionResultPolicy.IsValid(
      descriptor,
      committed with
      {
        Provenance = [recovery with { ContentSha256 = PayloadDigest.Sha256Hex("other") }],
        OpaqueRecoveryHandle = RecoveryHandle,
        RecoveryProvenanceSha256 = RecoveryDigest,
      },
      Now));
  }

  [Theory]
  [InlineData(false, ActionOutcome.Failed, false)]
  [InlineData(true, ActionOutcome.NeedsAttention, true)]
  public async Task CoordinatorClassifiesMalformedSuccessfulMetadataConservatively(
    bool mutation,
    ActionOutcome expectedOutcome,
    bool expectedUncertain)
  {
    var directory = Path.Combine(
      Path.GetTempPath(),
      $"msaidizi-result-policy-{Guid.NewGuid():N}");
    Directory.CreateDirectory(directory);
    try
    {
      var now = DateTimeOffset.UtcNow;
      var capabilityId = mutation ? "example.result-policy-mutation" : "companion.noop";
      var preState = mutation ? PayloadDigest.Sha256Hex("pre-state") : null;
      var request = ActionTokenVerifierTests.CreateRequest("{}", now) with
      {
        CapabilityId = capabilityId,
        ExpectedPreStateSha256 = preState,
      };
      var claims = ActionTokenVerifierTests.CreateClaims(now, "{}") with
      {
        CapabilityId = capabilityId,
        ExpectedPreStateSha256 = preState,
      };
      var adapter = new InvalidMetadataAdapter(mutation, preState);
      var channel = new RecordingChannel();
      var options = Options.Create(new CompanionOptions
      {
        DeviceId = claims.DeviceId,
        ExecutionEnabled = true,
        LeaseHeartbeatSeconds = 1,
        RequireCentralLedgerForMutations = true,
        EgressDestinationPolicySha256 = new string('a', 64),
        EgressExecutionIdentitySha256 = new string('b', 64),
        KillSwitchPath = Path.Combine(directory, "absent-kill-switch"),
      });
      using var journal = new FileHashChainActionJournal(
        Path.Combine(directory, "journal.jsonl"));
      await journal.InitializeAsync(CancellationToken.None);
      using var coordinator = new ActionExecutionCoordinator(
        options,
        Options.Create(new BrokerChannelOptions { MaxRequestAttempts = 3 }),
        new StaticTokenVerifier(claims),
        new RejectingFenceTokenVerifier(),
        journal,
        new InMemoryResultStore(),
        new CapabilityRegistry([adapter]),
        new TrustedRootGuard(options),
        new DisabledEgressBoundaryClient(),
        new RejectingEgressVerifier(),
        new EgressBoundaryDispatchLatch(),
        new PrivilegedCommandIsolationDispatchLatch(),
        channel,
        NullLogger<ActionExecutionCoordinator>.Instance);

      await coordinator.ExecuteAsync(
        new SignedActionRequest(request, "test-token"),
        CancellationToken.None);

      var result = Assert.Single(channel.Results);
      Assert.Equal(expectedOutcome, result.Outcome);
      Assert.Equal(expectedUncertain, result.OutcomeUncertain);
      Assert.Equal(mutation, result.MutationCommitted);
      Assert.Equal("capability_result_policy_invalid", result.ErrorCode);
    }
    finally
    {
      Directory.Delete(directory, recursive: true);
    }
  }

  private static CapabilityDescriptor Descriptor(
    bool mutation,
    IReadOnlyList<string> provenanceOutputs) => new(
      mutation ? "example.result-policy-mutation" : "companion.noop",
      "1.0.0",
      "Result policy test",
      "Test only",
      CapabilityDataClass.Internal,
      mutation ? CapabilityEffect.LocalWrite : CapabilityEffect.LocalRead,
      ConsentRequirement.SignedMandate,
      mutation ? RecoveryKind.Snapshot : RecoveryKind.NotApplicable,
      mutation ? RequiredPrivilege.LocalSystem : RequiredPrivilege.StandardUser,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      EmptySchema,
      EmptySchema,
      provenanceOutputs);

  private static CapabilityExecutionResult Result(
    IReadOnlyList<DataProvenance> provenance,
    bool mutationCommitted = false) => new(
      "{}",
      mutationCommitted,
      OutcomeUncertain: false,
      provenance);

  private static DataProvenance Provenance(string sourceType = "test-source") => new(
    sourceType,
    PayloadDigest.Sha256Hex("source"),
    PayloadDigest.Sha256Hex("content"),
    ProvenanceTrust.TrustedSystem,
    Now);

  private static JsonElement ParseSchema()
  {
    using var document = JsonDocument.Parse(
      "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}");
    return document.RootElement.Clone();
  }

  private sealed class InvalidMetadataAdapter(bool mutation, string? preState) :
    IHostCapabilityAdapter
  {
    public CapabilityDescriptor Descriptor { get; } =
      CapabilityExecutionResultPolicyTests.Descriptor(mutation, ["test-source"]);

    public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
      CapabilityArgumentValidation.Success;

    public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
      CapabilityArgumentValidation.Success;

    public ValueTask<CapabilityExecutionResult> ExecuteAsync(
      ActionExecutionContext context,
      JsonElement arguments,
      CancellationToken cancellationToken) => ValueTask.FromResult(new CapabilityExecutionResult(
        "{}",
        MutationCommitted: mutation,
        OutcomeUncertain: false,
        Provenance:
        [
          Provenance() with { SourceIdentifierHash = new string('A', 64) },
        ],
        PreStateSha256: preState));
  }

  private sealed class StaticTokenVerifier(ActionTokenClaims claims) : IActionTokenVerifier
  {
    public ValueTask<ActionTokenVerificationResult> VerifyAsync(
      string compactToken,
      CancellationToken cancellationToken) =>
      ValueTask.FromResult(ActionTokenVerificationResult.Valid(claims));
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
        CancellationToken cancellationToken) => ValueTask.FromResult(
          EgressVerificationResult.Invalid<VerifiedEgressReceipt>(
            "egress_boundary_unavailable"));
  }

  private sealed class InMemoryResultStore : IActionResultStore
  {
    private ActionResult? _stored;

    public ValueTask StoreAsync(
      ActionRequest request,
      ActionResult result,
      long maximumExternalEgressBytes,
      CancellationToken cancellationToken)
    {
      _stored = result;
      return ValueTask.CompletedTask;
    }

    public ValueTask<ActionResult?> TryLoadAsync(
      ActionRequest request,
      JournalTerminalReceipt receipt,
      CancellationToken cancellationToken) => ValueTask.FromResult(_stored);

    public ValueTask<bool> TryBeginDeliverySessionAsync(
      ActionRequest request,
      JournalTerminalReceipt receipt,
      int maximumDeliverySessions,
      CancellationToken cancellationToken) => ValueTask.FromResult(true);
  }

  private sealed class RecordingChannel : IOutboundCompanionChannel
  {
    private readonly List<ActionResult> _results = [];

    public IReadOnlyList<ActionResult> Results => _results;

    public OutboundChannelState State => OutboundChannelState.Connected;

    public bool IsCentralLedgerConnected => true;

    public ValueTask ConnectAsync(CancellationToken cancellationToken) =>
      ValueTask.CompletedTask;

    public async IAsyncEnumerable<DeviceCommand> ReadCommandsAsync(
      [EnumeratorCancellation] CancellationToken cancellationToken)
    {
      await Task.Yield();
      yield break;
    }

    public ValueTask<ActionProgressAcknowledgement> SendProgressAsync(
      ActionProgress progress,
      CancellationToken cancellationToken) => ValueTask.FromResult(
        new ActionProgressAcknowledgement(
          true,
          progress.ActionId,
          progress.DispatchCount,
          progress.JournalPrepareSequence,
          progress.JournalPreparePreviousHash,
          progress.JournalPrepareEntryHash));

    public ValueTask SendResultAsync(
      ActionResult result,
      CancellationToken cancellationToken)
    {
      _results.Add(result);
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
}
