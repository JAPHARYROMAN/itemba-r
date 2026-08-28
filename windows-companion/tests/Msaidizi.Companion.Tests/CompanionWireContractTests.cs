using System.Text.Json;
using System.Text.Json.Nodes;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Channel;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class CompanionWireContractTests
{
  private const string ActionId = "60000000-0000-4000-8000-000000000006";
  private const string TaskId = "70000000-0000-4000-8000-000000000007";
  private const string PlanVersionId = "80000000-0000-4000-8000-000000000008";
  private const string StepId = "90000000-0000-4000-8000-000000000009";
  private const string DeviceId = "20000000-0000-4000-8000-000000000002";
  private const string MandateId = "a0000000-0000-4000-8000-00000000000a";
  private const string ActionTokenSha256 =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  private const string SignatureBase64 =
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

  [Fact]
  public void NonBrowserAttestationSerializesExplicitNullAndMatchesBackendFixture()
  {
    var serialized = JsonSerializer.SerializeToNode(CreateActionResult(), CompanionWireJson.Options);
    var fixturePath = Path.Combine(
      AppContext.BaseDirectory,
      "test-assets",
      "egress-non-browser-action-result.json");
    var fixture = JsonNode.Parse(File.ReadAllText(fixturePath));

    var attestation = serialized?["egressEvidence"]?["authorization"]?["attestation"]?["attestation"]
      ?.AsObject();

    Assert.NotNull(attestation);
    Assert.True(attestation.ContainsKey("browserBrokerBuildSha256"));
    Assert.Null(attestation["browserBrokerBuildSha256"]);
    Assert.True(JsonNode.DeepEquals(fixture, serialized));
  }

  [Theory]
  [InlineData("")]
  [InlineData("contains whitespace")]
  [InlineData("_cannot-start-with-punctuation")]
  public void CapabilityValidationRejectsBrokerUnsafeErrorCodes(string errorCode)
  {
    Assert.Throws<ArgumentException>(() =>
      Itemba.Msaidizi.Companion.Contracts.Capabilities.CapabilityArgumentValidation.Invalid(
        errorCode,
        "Rejected by the adapter."));
  }

  [Fact]
  public void SharedTextLimitsMatchTheBrokerBoundary()
  {
    Assert.True(CompanionWireContract.IsSafeIdentifier($"a{new string('-', 127)}"));
    Assert.False(CompanionWireContract.IsSafeIdentifier($"a{new string('-', 128)}"));
    Assert.True(CompanionWireContract.IsValidProvenanceSourceType(new string('s', 120)));
    Assert.False(CompanionWireContract.IsValidProvenanceSourceType(new string('s', 121)));
  }

  private static ActionResult CreateActionResult()
  {
    var attestation = new BoundaryAttestationV1(
      ContractVersion: EgressBoundaryCanonical.ContractVersion,
      AttestationId: "10000000-0000-4000-8000-000000000001",
      DeviceId,
      SupervisorInstanceId: "30000000-0000-4000-8000-000000000003",
      BootId: "40000000-0000-4000-8000-000000000004",
      IssuedAtUnixMilliseconds: 1_800_000_000_000,
      ExpiresAtUnixMilliseconds: 1_800_000_120_000,
      SecureBootEnabled: true,
      HvciEnabled: true,
      DriverActive: true,
      ServiceActive: true,
      DriverMeasurementSha256: new string('1', 64),
      ServiceMeasurementSha256: new string('2', 64),
      BrowserBrokerBuildSha256: null,
      ReceiptKeyId: "boundary-receipt-v1",
      ReceiptPublicKeySpkiBase64: "AQID",
      ReceiptPublicKeySha256: new string('3', 64),
      Features: EgressBoundaryFeatures.CommandRequired);
    var lease = new EgressLeaseV1(
      ContractVersion: EgressBoundaryCanonical.ContractVersion,
      LeaseId: "50000000-0000-4000-8000-000000000005",
      AttestationSha256: new string('4', 64),
      ActionTokenSha256: ActionTokenSha256,
      ActionId,
      TaskId,
      PlanVersionId,
      StepId,
      DeviceId,
      MandateId,
      CapabilityId: "command.emergency.execute",
      CapabilityVersion: "1.0.0",
      DispatchCount: 1,
      DestinationPolicySha256: new string('5', 64),
      ExecutionIdentitySha256: new string('6', 64),
      ArgumentsSha256: new string('a', 64),
      ExpectedPreStateSha256: new string('b', 64),
      IdempotencyKeySha256: new string('c', 64),
      DestinationScopeSha256: new string('d', 64),
      RequestBodySha256: new string('e', 64),
      ExactRequestPolicySha256: new string('f', 64),
      ReservationDnsAnswerSetSha256: new string('1', 64),
      ReservedCapabilityEgressBytes: 1_000,
      IssuedAtUnixMilliseconds: 1_800_000_010_000,
      ExpiresAtUnixMilliseconds: 1_800_000_060_000);
    var receipt = new EgressReceiptV1(
      ContractVersion: EgressBoundaryCanonical.ContractVersion,
      ReceiptId: "b0000000-0000-4000-8000-00000000000b",
      LeaseSha256: new string('7', 64),
      AttestationSha256: new string('4', 64),
      ActionTokenSha256,
      ActionId,
      TaskId,
      PlanVersionId,
      StepId,
      DeviceId,
      MandateId,
      CapabilityId: "command.emergency.execute",
      CapabilityVersion: "1.0.0",
      DispatchCount: 1,
      DestinationPolicySha256: new string('5', 64),
      ExecutionIdentitySha256: new string('6', 64),
      ArgumentsSha256: lease.ArgumentsSha256,
      ExpectedPreStateSha256: lease.ExpectedPreStateSha256,
      IdempotencyKeySha256: lease.IdempotencyKeySha256,
      DestinationScopeSha256: lease.DestinationScopeSha256,
      RequestBodySha256: lease.RequestBodySha256,
      ExactRequestPolicySha256: lease.ExactRequestPolicySha256,
      ReservationDnsAnswerSetSha256: lease.ReservationDnsAnswerSetSha256,
      ConnectionDnsAnswerSetSha256: lease.ReservationDnsAnswerSetSha256,
      SelectedAddressSha256: new string('2', 64),
      RegistrationSha256: new string('9', 64),
      DispositionSha256: new string('a', 64),
      ReservedCapabilityEgressBytes: 1_000,
      MeasuredExternalEgressBytes: 100,
      UncertainExternalEgressBytes: 0,
      ChargedExternalEgressBytes: 100,
      StartedAtUnixMilliseconds: 1_800_000_020_000,
      EndedAtUnixMilliseconds: 1_800_000_030_000,
      Sequence: 1,
      FlowLogSha256: new string('8', 64),
      Outcome: "completed");

    return new ActionResult(
      ActionId,
      TaskId,
      StepId,
      ActionOutcome.Completed,
      OutputJson: "{}",
      OutputSha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
      MutationCommitted: false,
      OutcomeUncertain: false,
      IsIdempotentReplay: false,
      ErrorCode: null,
      Provenance: [],
      JournalPrepareSequence: 1,
      JournalPrepareEntryHash: new string('9', 64),
      JournalPreparePreviousHash: new string('0', 64),
      JournalSequence: 2,
      JournalEntryHash: new string('b', 64),
      JournalPreviousHash: new string('9', 64),
      PreStateSha256: new string('c', 64),
      LocalBytesRead: 0,
      LocalBytesWritten: 0,
      ExternalEgressBytes: 100,
      BrokerExternalEgressBytes: 65_536,
      BrokerMaxDeliverySessions: 1,
      BrokerMaxRequestAttemptsPerSession: 1,
      BrokerSerializedResultUpperBoundBytes: 65_536,
      UncertainExternalEgressBytes: 0,
      ActionTokenSha256: ActionTokenSha256,
      EgressEvidence: new EgressExecutionEvidence(
        new EgressExecutionAuthorization(
          new SignedBoundaryAttestation(attestation, "boundary-supervisor-v1", SignatureBase64),
          new SignedEgressLease(lease, "boundary-receipt-v1", SignatureBase64)),
        new SignedEgressReceipt(receipt, "boundary-receipt-v1", SignatureBase64)),
      LeaseId: "lease-fixture-1",
      FencingToken: "1",
      LeaseExpiresAt: new DateTimeOffset(2099, 1, 1, 0, 0, 0, TimeSpan.Zero));
  }
}
