using System.Text.Json;
using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Contracts.Capabilities;

public sealed record BrowserOriginBinding(
  string OriginId,
  Uri Origin,
  string OriginSha256);

public enum CapabilityDataClass
{
  Public,
  Internal,
  Confidential,
  Restricted,
  Credential,
  Biometric,
}

public enum CapabilityEffect
{
  Observe,
  LocalRead,
  LocalWrite,
  ExternalWrite,
  Financial,
  Administrative,
  Irreversible,
}

public enum ConsentRequirement
{
  None,
  ActiveUser,
  SignedMandate,
  OneShotApproval,
  EmergencyOperator,
}

public enum RecoveryKind
{
  NotApplicable,
  IdempotentReplay,
  Snapshot,
  Quarantine,
  CompensatingAction,
  Irreversible,
}

public enum RequiredPrivilege
{
  StandardUser,
  ElevatedUser,
  LocalSystem,
}

public enum IdempotencySemantics
{
  NotApplicable,
  Supported,
  Required,
}

/// <summary>
/// Manifest metadata for one typed capability. <c>TouchesTrustedRoot=false</c>
/// declares that the operation is not authorized to target the supervisor's
/// trusted roots directly. It is not a containment or non-interference
/// attestation for a general interpreter; such capabilities require a separate
/// independently enforced isolation boundary before execution.
/// </summary>
public sealed record CapabilityDescriptor(
  string Id,
  string Version,
  string DisplayName,
  string Description,
  CapabilityDataClass DataClass,
  CapabilityEffect Effect,
  ConsentRequirement Consent,
  RecoveryKind Recovery,
  RequiredPrivilege RequiredPrivilege,
  IdempotencySemantics Idempotency,
  IReadOnlyList<string> SupportedOperatingSystems,
  JsonElement ArgumentsSchema,
  JsonElement ResultSchema,
  IReadOnlyList<string> ProvenanceOutputs,
  bool TouchesTrustedRoot = false)
{
  public bool IsMutation => Effect is CapabilityEffect.LocalWrite
    or CapabilityEffect.ExternalWrite
    or CapabilityEffect.Financial
    or CapabilityEffect.Administrative
    or CapabilityEffect.Irreversible;
}

public sealed record CapabilityArgumentValidation(bool IsValid, string? ErrorCode, string? Message)
{
  public static CapabilityArgumentValidation Success { get; } = new(true, null, null);

  public static CapabilityArgumentValidation Invalid(string errorCode, string message)
  {
    if (!CompanionWireContract.IsSafeIdentifier(errorCode))
    {
      throw new ArgumentException(
        "Capability validation error codes must match the broker wire contract.",
        nameof(errorCode));
    }

    return new(false, errorCode, message);
  }
}

/// <summary>
/// In-memory-only authorization material passed from the coordinator that
/// already verified the broker token to a second, independently verifying
/// privileged supervisor. Serialization and diagnostic formatting are
/// intentionally redacted so compact credentials cannot enter journals.
/// </summary>
public sealed class EphemeralActionAuthorization
{
  public EphemeralActionAuthorization(
    SignedActionRequest signedAction,
    ActionTokenClaims verifiedClaims)
  {
    SignedAction = signedAction ?? throw new ArgumentNullException(nameof(signedAction));
    VerifiedClaims = verifiedClaims
      ?? throw new ArgumentNullException(nameof(verifiedClaims));
  }

  [JsonIgnore]
  public SignedActionRequest SignedAction { get; }

  [JsonIgnore]
  public ActionTokenClaims VerifiedClaims { get; }

  public override string ToString() => "[ephemeral-action-authorization-redacted]";
}

public sealed record ActionExecutionContext(
  string ActionId,
  string TaskId,
  string PlanVersionId,
  string StepId,
  string DeviceId,
  string MandateId,
  string IdempotencyKey,
  string? ExpectedPreStateSha256,
  string? InputProvenanceSha256,
  ActionBudget Budgets,
    string? ActionTokenSha256 = null,
    int DispatchCount = 1,
    EgressExecutionAuthorization? EgressAuthorization = null,
    string? EgressDestinationPolicySha256 = null,
    string? EgressExecutionIdentitySha256 = null,
    string? ArgumentsSha256 = null,
    [property: JsonIgnore] EphemeralActionAuthorization? EphemeralAuthorization = null);

public sealed record CapabilityExecutionResult(
  string OutputJson,
  bool MutationCommitted,
  bool OutcomeUncertain,
  IReadOnlyList<DataProvenance> Provenance,
  string? OpaqueRecoveryHandle = null,
  string? PreStateSha256 = null,
  string? RecoveryProvenanceSha256 = null,
  long LocalBytesRead = 0,
  long LocalBytesWritten = 0,
  /// <summary>
  /// Conservatively measured application-payload bytes sent by the capability
  /// to a destination other than the Itemba broker. A completed write is exact;
  /// an ambiguous partial write charges its entire pre-bounded buffer so usage
  /// cannot be undercounted. The coordinator separately accounts for the
  /// serialized result returned to the broker.
  /// </summary>
  long ExternalEgressBytes = 0,
  /// <summary>
  /// Independently signed meter receipt. It is mandatory only for capabilities
  /// classified by the reviewed catalog as requiring an egress boundary.
  /// </summary>
  SignedEgressReceipt? EgressReceipt = null);

public interface IHostCapabilityAdapter
{
  CapabilityDescriptor Descriptor { get; }

  CapabilityArgumentValidation ValidateArguments(JsonElement arguments);

  CapabilityArgumentValidation ValidateResult(JsonElement result);

  ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken);
}

public enum ProvenanceTrust
{
  TrustedSystem,
  AuthenticatedRemote,
  UserSupplied,
  UntrustedContent,
}

public sealed record DataProvenance(
  string SourceType,
  string SourceIdentifierHash,
  string ContentSha256,
  ProvenanceTrust Trust,
  DateTimeOffset ObservedAt);
