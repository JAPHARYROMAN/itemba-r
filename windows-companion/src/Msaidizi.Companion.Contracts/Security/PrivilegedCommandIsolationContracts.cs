using System.Collections.Frozen;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Itemba.Msaidizi.Companion.Contracts.Commands;

namespace Itemba.Msaidizi.Companion.Contracts.Security;

/// <summary>
/// Kernel-enforced capabilities that a v2 privileged-command isolation
/// supervisor must attest. The ordered list is part of the signed protocol.
/// </summary>
public static class PrivilegedCommandIsolationFeatures
{
  public const string ExactInvocationMeasurement =
    "exact-invocation-measurement-v2";
  public const string FileSystemDeny = "filesystem-trusted-root-deny-v1";
  public const string JobKillOnClose = "job-kill-on-close-v1";
  public const string KernelProcessTreeBinding = "kernel-process-tree-binding-v1";
  public const string ProcessImageFileIdentity = "process-image-file-identity-v2";
  public const string RegistryDeny = "registry-trusted-root-deny-v1";
  public const string ServiceControlDeny = "service-control-deny-v1";
  public const string SignedTerminalReceipt = "signed-terminal-enforcement-receipt-v1";
  public const string SignedDriverAttestation = "signed-driver-attestation-v2";
  public const string SupervisorBootReplayProtection =
    "supervisor-boot-replay-protection-v1";
  public const string SupervisorProcessDeny = "supervisor-process-control-deny-v1";
  public const string SuspendedBindBeforeResume =
    "suspended-process-bind-before-resume-v1";
  public const string WindowsSecurityPosture = "windows-security-posture-v1";

  public static IReadOnlyList<string> Required { get; } = Array.AsReadOnly(
  [
    ExactInvocationMeasurement,
    FileSystemDeny,
    JobKillOnClose,
    KernelProcessTreeBinding,
    ProcessImageFileIdentity,
    RegistryDeny,
    ServiceControlDeny,
    SignedDriverAttestation,
    SignedTerminalReceipt,
    SupervisorBootReplayProtection,
    SupervisorProcessDeny,
    SuspendedBindBeforeResume,
    WindowsSecurityPosture,
  ]);

  internal static IReadOnlySet<string> Allowed { get; } = Required.ToFrozenSet(
    StringComparer.Ordinal);
}

/// <summary>
/// Trust-store purposes are independent even when deployment chooses one
/// hardware-backed isolation authority key. A resolver must authorize a key
/// for the exact purpose; device, egress, update, recovery, and audit keys are
/// never valid substitutes.
/// </summary>
public static class PrivilegedCommandIsolationSignaturePurposes
{
  public const string DriverAttestation =
    "msaidizi.privileged-command-isolation.driver-attestation.v2";
  public const string ReservationLease =
    "msaidizi.privileged-command-isolation.reservation-lease.v1";
  public const string SuspendedProcessBindAcknowledgement =
    "msaidizi.privileged-command-isolation.suspended-bind-acknowledgement.v1";
  public const string PreBindReservationRelease =
    "msaidizi.privileged-command-isolation.pre-bind-reservation-release.v1";
  public const string TerminalEnforcementReceipt =
    "msaidizi.privileged-command-isolation.terminal-enforcement-receipt.v1";
}

public static class PrivilegedCommandIsolationCapability
{
  public const string Id = "command.privileged.execute";
  public const string Version = "1.0.0";
}

public static class PrivilegedCommandIsolationActionTokenTrust
{
  public const string Issuer = "itemba-msaidizi-broker";
  public const string Audience = "itemba-windows-companion";
  public const string Subject = "msaidizi-global";
}

/// <summary>
/// Compile-time trust anchors shared by the LocalSystem companion and the
/// separately installed isolation supervisor. Configuration may repeat these
/// values for deployment evidence, but it may never select a different peer.
/// </summary>
public static class PrivilegedCommandIsolationSupervisorIdentity
{
  public const string ServiceSid =
    "S-1-5-80-1792805186-3282615177-1795010573-3676175622-4117989893";

  public const string DriverServiceName =
    "Itemba Msaidizi Privileged Command Isolation Driver";
}

public static class PrivilegedCommandIsolationPreBindReleaseOutcomes
{
  public const string AbortedBeforeProcess = "aborted-before-process";
  public const string AbortedBeforeBind = "aborted-before-bind";
  public const string ExpiredUnused = "expired-unused";

  public static IReadOnlySet<string> All { get; } = new[]
  {
    AbortedBeforeProcess,
    AbortedBeforeBind,
    ExpiredUnused,
  }.ToFrozenSet(StringComparer.Ordinal);
}

public static class PrivilegedCommandIsolationTerminalOutcomes
{
  public const string Cancelled = "cancelled";
  public const string Completed = "completed";
  public const string Crashed = "crashed";
  public const string Failed = "failed";
  public const string IsolationViolation = "isolation-violation";
  public const string TimedOut = "timed-out";
  public const string Unknown = "unknown";

  public static IReadOnlySet<string> All { get; } = new[]
  {
    Cancelled,
    Completed,
    Crashed,
    Failed,
    IsolationViolation,
    TimedOut,
    Unknown,
  }.ToFrozenSet(StringComparer.Ordinal);
}

/// <summary>
/// Immutable-by-convention action facts supplied by the companion and copied
/// by the verifier before use. Every digest is lowercase canonical SHA-256.
/// </summary>
public sealed record PrivilegedCommandIsolationActionAuthorizationV2(
  string CapabilityId,
  string CapabilityVersion,
  string ArgumentsSha256,
  string? ExpectedPreStateSha256,
  string? InputProvenanceSha256,
  string IdempotencyKeySha256,
  string LeaseId,
  string FencingToken,
  long LeaseExpiresAtUnixSeconds,
  int DispatchCount,
  string ExecutionMode,
  ActionBudget Budgets);

public sealed record PrivilegedCommandIsolationEnvironmentVariableV2(
  string Name,
  string Value);

/// <summary>
/// Exact invocation facts carried only on the live reserve/bind channel. The
/// supervisor persists only <see cref="PrivilegedCommandIsolationCanonical.InvocationSha256"/>,
/// so argv and environment values never enter its journal.
/// </summary>
public sealed record PrivilegedCommandIsolationInvocationV2(
  int ContractVersion,
  string ExecutableId,
  string ExecutablePath,
  string ExecutableImageSha256,
  uint ExecutableVolumeSerialNumber,
  ulong ExecutableFileId,
  IReadOnlyList<string> Arguments,
  string WorkingDirectory,
  IReadOnlyList<PrivilegedCommandIsolationEnvironmentVariableV2> Environment,
  int RequestedTimeoutSeconds,
  long RequestedMaximumOutputBytes,
  int EffectiveTimeoutSeconds,
  long EffectiveMaximumOutputBytes,
  int MaximumProcesses,
  long MaximumProcessMemoryBytes,
  string CommandLineSha256,
  string EnvironmentBlockSha256);

public sealed record PrivilegedCommandIsolationActionBinding(
  string ActionId,
  string TaskId,
  string PlanVersionId,
  string StepId,
  string DeviceId,
  string MandateId,
  string ActionTokenSha256,
  string InvocationSha256,
  string ExpectedImagePathSha256,
  string ExpectedImageSha256,
  string IsolationPolicySha256,
  string DriverMeasurementSha256,
  string ServiceMeasurementSha256,
  IReadOnlyList<string> RequiredFeatures,
  PrivilegedCommandIsolationActionAuthorizationV2 Authorization);

/// <summary>
/// Exact native identities observed while the child primary thread is still
/// suspended. JobObjectId is a supervisor-issued logical GUID;
/// JobObjectIdentitySha256 is derived by the native supervisor from its
/// non-exported kernel object identity and creation nonce.
/// </summary>
public sealed record PrivilegedCommandIsolationProcessBinding(
  int ParentProcessId,
  long ParentProcessCreationTimeUtcFileTime,
  int ChildProcessId,
  long ChildProcessCreationTimeUtcFileTime,
  int PrimaryThreadId,
  string JobObjectId,
  string JobObjectIdentitySha256,
  string ImagePathSha256,
  string ImageSha256,
  uint ImageVolumeSerialNumber,
  ulong ImageFileId,
  string CommandLineSha256,
  string WorkingDirectorySha256,
  string EnvironmentBlockSha256,
  string InvocationSha256);

public sealed record PrivilegedCommandDriverAttestationEvidenceV2(
  int ContractVersion,
  string SignaturePurpose,
  string KeyId,
  string DeviceId,
  string SupervisorInstanceId,
  string BootId,
  string PolicyEpoch,
  string ChallengeNonceSha256,
  string IsolationPolicySha256,
  string DriverMeasurementSha256,
  string ServiceMeasurementSha256,
  string DriverServiceName,
  string DriverImagePathSha256,
  bool SecureBootEnabled,
  bool HvciEnabled,
  bool WdacEnforced,
  IReadOnlyList<string> EnforcedFeatures,
  long IssuedAtUnixMilliseconds,
  long ExpiresAtUnixMilliseconds);

public sealed record SignedPrivilegedCommandDriverAttestationV2(
  PrivilegedCommandDriverAttestationEvidenceV2 Evidence,
  string SignatureBase64);

public sealed record PrivilegedCommandIsolationReservationRequestV1(
  int ContractVersion,
  string RequestId,
  string RequestNonceBase64Url,
  PrivilegedCommandIsolationActionBinding Action,
  long RequestedAtUnixMilliseconds,
  long RequestedExpiresAtUnixMilliseconds);

public sealed record PrivilegedCommandIsolationReservationLeaseV1(
  int ContractVersion,
  string LeaseId,
  long Sequence,
  string ReservationRequestSha256,
  string RequestNonceSha256,
  PrivilegedCommandIsolationActionBinding Action,
  string SupervisorInstanceId,
  string BootId,
  IReadOnlyList<string> EnforcedFeatures,
  long IssuedAtUnixMilliseconds,
  long ExpiresAtUnixMilliseconds);

public sealed record SignedPrivilegedCommandIsolationReservationLease(
  PrivilegedCommandIsolationReservationLeaseV1 Lease,
  string KeyId,
  string SignatureBase64);

/// <summary>
/// Signed alternative settlement when a reservation is consumed without ever
/// producing a resume-capable bind acknowledgement. The supervisor replay
/// store must atomically make release and bind mutually exclusive.
/// </summary>
public sealed record PrivilegedCommandIsolationPreBindReleaseV1(
  int ContractVersion,
  string ReleaseId,
  long Sequence,
  string ReservationRequestSha256,
  string RequestNonceSha256,
  string LeaseSha256,
  PrivilegedCommandIsolationActionBinding Action,
  string SupervisorInstanceId,
  string BootId,
  long ReleasedAtUnixMilliseconds,
  string Outcome);

public sealed record SignedPrivilegedCommandIsolationPreBindRelease(
  PrivilegedCommandIsolationPreBindReleaseV1 Release,
  string KeyId,
  string SignatureBase64);

public sealed record PrivilegedCommandSuspendedProcessBindingV1(
  int ContractVersion,
  string BindingRequestId,
  string ReservationRequestSha256,
  string RequestNonceSha256,
  string LeaseSha256,
  PrivilegedCommandIsolationActionBinding Action,
  string SupervisorInstanceId,
  string BootId,
  PrivilegedCommandIsolationProcessBinding Process,
  bool CreatedSuspended,
  bool AssignedToJob,
  long ObservedAtUnixMilliseconds);

public sealed record PrivilegedCommandIsolationBindAcknowledgementV1(
  int ContractVersion,
  string AcknowledgementId,
  long Sequence,
  string ReservationRequestSha256,
  string RequestNonceSha256,
  string LeaseSha256,
  string SuspendedProcessBindingSha256,
  PrivilegedCommandIsolationActionBinding Action,
  string SupervisorInstanceId,
  string BootId,
  PrivilegedCommandIsolationProcessBinding Process,
  IReadOnlyList<string> EnforcedFeatures,
  bool ChildStillSuspended,
  bool KernelEnforcementActive,
  bool MayResume,
  long IssuedAtUnixMilliseconds,
  long ExpiresAtUnixMilliseconds);

public sealed record SignedPrivilegedCommandIsolationBindAcknowledgement(
  PrivilegedCommandIsolationBindAcknowledgementV1 Acknowledgement,
  string KeyId,
  string SignatureBase64);

public sealed record PrivilegedCommandIsolationTerminalReceiptV1(
  int ContractVersion,
  string ReceiptId,
  long Sequence,
  string ReservationRequestSha256,
  string RequestNonceSha256,
  string LeaseSha256,
  string SuspendedProcessBindingSha256,
  string BindAcknowledgementSha256,
  PrivilegedCommandIsolationActionBinding Action,
  string SupervisorInstanceId,
  string BootId,
  PrivilegedCommandIsolationProcessBinding Process,
  IReadOnlyList<string> EnforcedFeatures,
  bool ProcessResumed,
  long ResumedAtUnixMilliseconds,
  long EndedAtUnixMilliseconds,
  long IssuedAtUnixMilliseconds,
  bool ProcessTreeTerminal,
  bool EnforcementContinuous,
  bool ExitCodeKnown,
  int ExitCode,
  string EnforcementEvidenceSha256,
  string Outcome);

public sealed record SignedPrivilegedCommandIsolationTerminalReceipt(
  PrivilegedCommandIsolationTerminalReceiptV1 Receipt,
  string KeyId,
  string SignatureBase64);

/// <summary>
/// Absolute protocol ceilings are enforced in addition to these deployment
/// settings. Configuration can tighten, but cannot raise, those ceilings.
/// </summary>
public sealed record PrivilegedCommandIsolationVerificationSettings(
  string ExpectedDeviceId,
  string ExpectedIsolationPolicySha256,
  string ExpectedDriverMeasurementSha256,
  string ExpectedServiceMeasurementSha256,
  TimeSpan AllowedClockSkew,
  TimeSpan MaximumReservationRequestAge,
  TimeSpan MaximumReservationLeaseLifetime,
  TimeSpan MaximumBindAcknowledgementLifetime,
  TimeSpan MaximumExecutionDuration,
  TimeSpan MaximumReceiptDelay)
{
  public static PrivilegedCommandIsolationVerificationSettings Strict(
    string deviceId,
    string isolationPolicySha256,
    string driverMeasurementSha256,
    string serviceMeasurementSha256) => new(
      deviceId,
      isolationPolicySha256,
      driverMeasurementSha256,
      serviceMeasurementSha256,
      TimeSpan.FromSeconds(30),
      TimeSpan.FromMinutes(1),
      TimeSpan.FromMinutes(2),
      TimeSpan.FromSeconds(30),
      TimeSpan.FromHours(2),
      TimeSpan.FromMinutes(5));
}

/// <summary>
/// Resolves a separately pinned isolation-supervisor public key for one exact
/// signature purpose. The caller owns and disposes the returned key.
/// </summary>
public interface IPrivilegedCommandIsolationVerificationKeyResolver
{
  bool TryResolve(
    string keyId,
    string signaturePurpose,
    out ECDsa? publicKey);
}

public sealed class VerifiedPrivilegedCommandIsolationReservation
{
  internal VerifiedPrivilegedCommandIsolationReservation(
    PrivilegedCommandIsolationReservationRequestV1 request,
    SignedPrivilegedCommandIsolationReservationLease signedLease,
    string requestNonceSha256,
    string reservationRequestSha256,
    string leaseSha256)
  {
    Request = request;
    SignedLease = signedLease;
    RequestNonceSha256 = requestNonceSha256;
    ReservationRequestSha256 = reservationRequestSha256;
    LeaseSha256 = leaseSha256;
  }

  public PrivilegedCommandIsolationReservationRequestV1 Request { get; }

  public SignedPrivilegedCommandIsolationReservationLease SignedLease { get; }

  public string RequestNonceSha256 { get; }

  public string ReservationRequestSha256 { get; }

  public string LeaseSha256 { get; }
}

/// <summary>
/// Recovery-only marker for a signed reservation already present in the
/// durable replay ledger. It is intentionally not interchangeable with the
/// live reservation marker used to authorize bind/resume operations.
/// </summary>
public sealed class VerifiedPrivilegedCommandIsolationRecoveryReservation
{
  internal VerifiedPrivilegedCommandIsolationRecoveryReservation(
    VerifiedPrivilegedCommandIsolationReservation reservation)
  {
    Reservation = reservation;
  }

  internal VerifiedPrivilegedCommandIsolationReservation Reservation { get; }
}

public sealed class VerifiedPrivilegedCommandIsolationBindAcknowledgement
{
  internal VerifiedPrivilegedCommandIsolationBindAcknowledgement(
    VerifiedPrivilegedCommandIsolationReservation reservation,
    PrivilegedCommandSuspendedProcessBindingV1 binding,
    SignedPrivilegedCommandIsolationBindAcknowledgement signedAcknowledgement,
    string suspendedProcessBindingSha256,
    string acknowledgementSha256)
  {
    Reservation = reservation;
    Binding = binding;
    SignedAcknowledgement = signedAcknowledgement;
    SuspendedProcessBindingSha256 = suspendedProcessBindingSha256;
    AcknowledgementSha256 = acknowledgementSha256;
  }

  public VerifiedPrivilegedCommandIsolationReservation Reservation { get; }

  public PrivilegedCommandSuspendedProcessBindingV1 Binding { get; }

  public SignedPrivilegedCommandIsolationBindAcknowledgement SignedAcknowledgement { get; }

  public string SuspendedProcessBindingSha256 { get; }

  public string AcknowledgementSha256 { get; }
}

/// <summary>
/// Recovery-only marker for a signed bind already present in the durable
/// replay ledger. It cannot be passed to the live terminal-settlement API.
/// </summary>
public sealed class VerifiedPrivilegedCommandIsolationRecoveryBindAcknowledgement
{
  internal VerifiedPrivilegedCommandIsolationRecoveryBindAcknowledgement(
    VerifiedPrivilegedCommandIsolationBindAcknowledgement bindAcknowledgement)
  {
    BindAcknowledgement = bindAcknowledgement;
  }

  internal VerifiedPrivilegedCommandIsolationBindAcknowledgement BindAcknowledgement
  {
    get;
  }
}

public sealed class VerifiedPrivilegedCommandIsolationPreBindRelease
{
  internal VerifiedPrivilegedCommandIsolationPreBindRelease(
    VerifiedPrivilegedCommandIsolationReservation reservation,
    SignedPrivilegedCommandIsolationPreBindRelease signedRelease,
    string releaseSha256)
  {
    Reservation = reservation;
    SignedRelease = signedRelease;
    ReleaseSha256 = releaseSha256;
  }

  public VerifiedPrivilegedCommandIsolationReservation Reservation { get; }

  public SignedPrivilegedCommandIsolationPreBindRelease SignedRelease { get; }

  public string ReleaseSha256 { get; }
}

public sealed class VerifiedPrivilegedCommandIsolationTerminalReceipt
{
  internal VerifiedPrivilegedCommandIsolationTerminalReceipt(
    VerifiedPrivilegedCommandIsolationBindAcknowledgement bindAcknowledgement,
    SignedPrivilegedCommandIsolationTerminalReceipt signedReceipt,
    string receiptSha256)
  {
    BindAcknowledgement = bindAcknowledgement;
    SignedReceipt = signedReceipt;
    ReceiptSha256 = receiptSha256;
  }

  public VerifiedPrivilegedCommandIsolationBindAcknowledgement BindAcknowledgement { get; }

  public SignedPrivilegedCommandIsolationTerminalReceipt SignedReceipt { get; }

  public string ReceiptSha256 { get; }

  /// <summary>
  /// Signature verification authenticates violation evidence too. Consumers
  /// must use this property, not IsValid alone, before treating an execution as
  /// continuously governed.
  /// </summary>
  public bool IsIsolationIntact => SignedReceipt.Receipt.EnforcementContinuous
    && !string.Equals(
      SignedReceipt.Receipt.Outcome,
      PrivilegedCommandIsolationTerminalOutcomes.IsolationViolation,
      StringComparison.Ordinal);
}

public sealed record PrivilegedCommandIsolationVerificationResult<T>(
  bool IsValid,
  T? Value,
  string? ErrorCode)
  where T : class;

public static class PrivilegedCommandIsolationVerificationResult
{
  public static PrivilegedCommandIsolationVerificationResult<T> Valid<T>(T value)
    where T : class => new(true, value, null);

  public static PrivilegedCommandIsolationVerificationResult<T> Invalid<T>(
    string errorCode)
    where T : class => new(false, null, errorCode);
}

public enum PrivilegedCommandIsolationReplayCommitStatus
{
  Committed = 0,
  AlreadyCommitted = 1,
  Conflict = 2,
  StaleSequence = 3,
  Unavailable = 4,
}

public sealed record PrivilegedCommandIsolationReplayCommitResult(
  PrivilegedCommandIsolationReplayCommitStatus Status,
  string EvidenceSha256,
  string? ExistingEvidenceSha256)
{
  /// <summary>
  /// An exact durable duplicate is safe to continue. The caller supplies the
  /// digest from its verified marker so a shaped or stale store response cannot
  /// authorize progress for different evidence.
  /// </summary>
  public bool AllowsProgressFor(string expectedEvidenceSha256)
  {
    if (!PrivilegedCommandIsolationCanonical.IsCanonicalSha256(expectedEvidenceSha256)
      || !PrivilegedCommandIsolationCanonical.FixedDigestEquals(
        EvidenceSha256,
        expectedEvidenceSha256))
    {
      return false;
    }

    return Status switch
    {
      PrivilegedCommandIsolationReplayCommitStatus.Committed =>
        ExistingEvidenceSha256 is null,
      PrivilegedCommandIsolationReplayCommitStatus.AlreadyCommitted =>
        ExistingEvidenceSha256 is not null
        && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
          ExistingEvidenceSha256,
          expectedEvidenceSha256),
      _ => false,
    };
  }
}

/// <summary>
/// Durable signed material for a reservation that has no mutually exclusive
/// pre-bind release or bind acknowledgement yet. It is recovery input only: it
/// does not authorize process creation or resume after a companion restart.
/// </summary>
public sealed record PrivilegedCommandIsolationPendingReservation(
  PrivilegedCommandIsolationReservationRequestV1 Request,
  SignedPrivilegedCommandIsolationReservationLease SignedLease);

/// <summary>
/// Durable signed material for a bind acknowledgement that has no terminal
/// receipt yet. Recovery may only ask the trusted supervisor to prove a
/// terminal process tree; it must never recreate or resume the child.
/// </summary>
public sealed record PrivilegedCommandIsolationPendingBind(
  PrivilegedCommandIsolationReservationRequestV1 Request,
  SignedPrivilegedCommandIsolationReservationLease SignedLease,
  PrivilegedCommandSuspendedProcessBindingV1 Binding,
  SignedPrivilegedCommandIsolationBindAcknowledgement SignedAcknowledgement);

/// <summary>
/// Durable terminal evidence proving that trusted-root enforcement was not
/// continuous. This is an integrity fence, not pending work: the signed receipt
/// remains committed for audit, but ordinary dispatch must not resume until an
/// out-of-band trusted recovery ceremony restores the device.
/// </summary>
public sealed record PrivilegedCommandIsolationIntegrityViolation(
  string ActionId,
  string ReceiptSha256,
  string Outcome,
  bool EnforcementContinuous);

/// <summary>
/// Point-in-time pending lifecycle snapshot read while the replay-store owner
/// excludes another companion process. Startup must settle every entry before
/// accepting broker work.
/// </summary>
public sealed record PrivilegedCommandIsolationPendingSnapshot(
  IReadOnlyList<PrivilegedCommandIsolationPendingReservation> Reservations,
  IReadOnlyList<PrivilegedCommandIsolationPendingBind> Binds,
  IReadOnlyList<PrivilegedCommandIsolationIntegrityViolation> IntegrityViolations);

/// <summary>
/// Durable consuming-service replay boundary. Implementations must atomically
/// key by supervisor instance, boot, request nonce/digest, lease, and sequence;
/// make pre-bind release and bind mutually exclusive; and accept an idempotent
/// duplicate only when its canonical evidence digest is identical.
/// </summary>
public interface IPrivilegedCommandIsolationReplayStore
{
  ValueTask<PrivilegedCommandIsolationPendingSnapshot> ReadPendingAsync(
    CancellationToken cancellationToken);

  ValueTask<PrivilegedCommandIsolationReplayCommitResult> CommitReservationAsync(
    VerifiedPrivilegedCommandIsolationReservation reservation,
    CancellationToken cancellationToken);

  ValueTask<PrivilegedCommandIsolationReplayCommitResult> CommitPreBindReleaseAsync(
    VerifiedPrivilegedCommandIsolationPreBindRelease release,
    CancellationToken cancellationToken);

  ValueTask<PrivilegedCommandIsolationReplayCommitResult> CommitBindAcknowledgementAsync(
    VerifiedPrivilegedCommandIsolationBindAcknowledgement bindAcknowledgement,
    CancellationToken cancellationToken);

  ValueTask<PrivilegedCommandIsolationReplayCommitResult> CommitTerminalReceiptAsync(
    VerifiedPrivilegedCommandIsolationTerminalReceipt terminalReceipt,
    CancellationToken cancellationToken);
}

/// <summary>
/// Stateless v1 verifier for the signed isolation protocol. Replay persistence
/// belongs to the external supervisor and consuming service; the verified
/// markers expose the nonce, request, lease, bind, and sequence material needed
/// to make those commits transactional.
/// </summary>
public sealed class PrivilegedCommandIsolationContractVerifier
{
  private static readonly TimeSpan AbsoluteMaximumClockSkew = TimeSpan.FromMinutes(2);
  private static readonly TimeSpan AbsoluteMaximumRequestAge = TimeSpan.FromMinutes(5);
  private static readonly TimeSpan AbsoluteMaximumLeaseLifetime = TimeSpan.FromMinutes(10);
  private static readonly TimeSpan AbsoluteMaximumBindLifetime = TimeSpan.FromMinutes(2);
  private static readonly TimeSpan AbsoluteMaximumExecutionDuration = TimeSpan.FromHours(2);
  private static readonly TimeSpan AbsoluteMaximumReceiptDelay = TimeSpan.FromMinutes(30);

  private readonly PrivilegedCommandIsolationVerificationSettings _settings;
  private readonly IPrivilegedCommandIsolationVerificationKeyResolver _keys;
  private readonly TimeProvider _timeProvider;

  public PrivilegedCommandIsolationContractVerifier(
    PrivilegedCommandIsolationVerificationSettings settings,
    IPrivilegedCommandIsolationVerificationKeyResolver keys,
    TimeProvider? timeProvider = null)
  {
    ArgumentNullException.ThrowIfNull(settings);
    ArgumentNullException.ThrowIfNull(keys);
    ValidateSettings(settings);
    _settings = settings;
    _keys = keys;
    _timeProvider = timeProvider ?? TimeProvider.System;
  }

  public PrivilegedCommandIsolationVerificationResult<
    VerifiedPrivilegedCommandIsolationReservation> VerifyReservation(
      PrivilegedCommandIsolationReservationRequestV1 request,
      SignedPrivilegedCommandIsolationReservationLease signedLease,
      PrivilegedCommandIsolationActionBinding expectedAction) =>
    VerifyReservationCore(request, signedLease, expectedAction, historicalRecovery: false);

  /// <summary>
  /// Verifies a reservation already committed to the durable replay ledger.
  /// Historical recovery accepts an expired request and lease, but it never
  /// accepts future-dated evidence, invalid internal lifetimes, changed action
  /// measurements, or an untrusted/wrong-purpose signature. It must not be used
  /// to authorize a new process launch.
  /// </summary>
  public PrivilegedCommandIsolationVerificationResult<
    VerifiedPrivilegedCommandIsolationRecoveryReservation>
      VerifyReservationForRecovery(
      PrivilegedCommandIsolationReservationRequestV1 request,
      SignedPrivilegedCommandIsolationReservationLease signedLease,
      PrivilegedCommandIsolationActionBinding expectedAction)
  {
    var verified = VerifyReservationCore(
      request,
      signedLease,
      expectedAction,
      historicalRecovery: true);
    return verified.IsValid && verified.Value is not null
      ? PrivilegedCommandIsolationVerificationResult.Valid(
        new VerifiedPrivilegedCommandIsolationRecoveryReservation(verified.Value))
      : PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationRecoveryReservation>(
          verified.ErrorCode ?? "isolation_recovery_reservation_invalid");
  }

  private PrivilegedCommandIsolationVerificationResult<
    VerifiedPrivilegedCommandIsolationReservation> VerifyReservationCore(
      PrivilegedCommandIsolationReservationRequestV1 request,
      SignedPrivilegedCommandIsolationReservationLease signedLease,
      PrivilegedCommandIsolationActionBinding expectedAction,
      bool historicalRecovery)
  {
    if (!PrivilegedCommandIsolationCanonical.IsValidAction(expectedAction)
      || !ExpectedPinsMatch(expectedAction))
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationReservation>(
          "isolation_expected_action_invalid");
    }

    if (!PrivilegedCommandIsolationCanonical.IsValidReservationRequest(request))
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationReservation>(
          "isolation_reservation_request_invalid");
    }

    var actionSnapshot = SnapshotAction(expectedAction);
    var requestSnapshot = SnapshotRequest(request);
    if (!ActionMatches(requestSnapshot.Action, actionSnapshot))
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationReservation>(
          "isolation_reservation_request_binding_invalid");
    }

    var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
    var skew = Milliseconds(_settings.AllowedClockSkew);
    var maximumRequestAge = Milliseconds(_settings.MaximumReservationRequestAge);
    var maximumLeaseLifetime = Milliseconds(
      _settings.MaximumReservationLeaseLifetime);
    if (requestSnapshot.RequestedAtUnixMilliseconds > Add(now, skew)
      || (!historicalRecovery
        && Subtract(now, requestSnapshot.RequestedAtUnixMilliseconds)
          > Add(maximumRequestAge, skew))
      || (!historicalRecovery
        && requestSnapshot.RequestedExpiresAtUnixMilliseconds <= now)
      || Subtract(
          requestSnapshot.RequestedExpiresAtUnixMilliseconds,
          requestSnapshot.RequestedAtUnixMilliseconds) > maximumLeaseLifetime)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationReservation>(
          "isolation_reservation_request_stale");
    }

    if (signedLease is null
      || !PrivilegedCommandIsolationCanonical.IsValidReservationLease(
        signedLease.Lease)
      || !PrivilegedCommandIsolationCanonical.IsSafeKeyId(signedLease.KeyId))
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationReservation>(
          "isolation_reservation_lease_invalid");
    }

    var leaseSnapshot = SnapshotLease(signedLease.Lease);
    var signedLeaseSnapshot = signedLease with { Lease = leaseSnapshot };
    var requestSha256 = PrivilegedCommandIsolationCanonical.ReservationRequestSha256(
      requestSnapshot);
    var nonceSha256 = PrivilegedCommandIsolationCanonical.RequestNonceSha256(
      requestSnapshot);
    if (!PrivilegedCommandIsolationCanonical.FixedDigestEquals(
        leaseSnapshot.ReservationRequestSha256,
        requestSha256)
      || !PrivilegedCommandIsolationCanonical.FixedDigestEquals(
        leaseSnapshot.RequestNonceSha256,
        nonceSha256)
      || !ActionMatches(leaseSnapshot.Action, actionSnapshot)
      || !leaseSnapshot.EnforcedFeatures.SequenceEqual(
        actionSnapshot.RequiredFeatures,
        StringComparer.Ordinal))
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationReservation>(
          "isolation_reservation_lease_binding_invalid");
    }

    if (leaseSnapshot.IssuedAtUnixMilliseconds
        < Subtract(requestSnapshot.RequestedAtUnixMilliseconds, skew)
      || leaseSnapshot.IssuedAtUnixMilliseconds > Add(now, skew)
      || (!historicalRecovery && leaseSnapshot.ExpiresAtUnixMilliseconds <= now)
      || leaseSnapshot.ExpiresAtUnixMilliseconds
        > requestSnapshot.RequestedExpiresAtUnixMilliseconds
      || Subtract(
          leaseSnapshot.ExpiresAtUnixMilliseconds,
          leaseSnapshot.IssuedAtUnixMilliseconds) > maximumLeaseLifetime)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationReservation>(
          "isolation_reservation_lease_stale");
    }

    var signature = VerifySignature(
      signedLeaseSnapshot.KeyId,
      PrivilegedCommandIsolationSignaturePurposes.ReservationLease,
      PrivilegedCommandIsolationCanonical.ReservationLeaseBytes(leaseSnapshot),
      signedLeaseSnapshot.SignatureBase64);
    if (signature == SignatureStatus.KeyUntrusted)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationReservation>(
          "isolation_reservation_lease_key_untrusted");
    }
    if (signature != SignatureStatus.Valid)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationReservation>(
          "isolation_reservation_lease_signature_invalid");
    }

    return PrivilegedCommandIsolationVerificationResult.Valid(
      new VerifiedPrivilegedCommandIsolationReservation(
        requestSnapshot,
        signedLeaseSnapshot,
        nonceSha256,
        requestSha256,
        PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(leaseSnapshot)));
  }

  public PrivilegedCommandIsolationVerificationResult<
    VerifiedPrivilegedCommandIsolationPreBindRelease> VerifyPreBindRelease(
      VerifiedPrivilegedCommandIsolationReservation reservation,
      SignedPrivilegedCommandIsolationPreBindRelease signedRelease) =>
    VerifyPreBindReleaseCore(reservation, signedRelease, historicalRecovery: false);

  /// <summary>
  /// Verifies a newly issued settlement for an already-persisted reservation.
  /// The old lease may have expired, but the release itself must still be fresh
  /// relative to the verifier clock and signed by the exact release-purpose key.
  /// </summary>
  public PrivilegedCommandIsolationVerificationResult<
    VerifiedPrivilegedCommandIsolationPreBindRelease> VerifyPreBindReleaseForRecovery(
      VerifiedPrivilegedCommandIsolationRecoveryReservation reservation,
      SignedPrivilegedCommandIsolationPreBindRelease signedRelease)
  {
    if (reservation is null)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationPreBindRelease>(
          "isolation_verified_recovery_reservation_required");
    }
    return VerifyPreBindReleaseCore(
      reservation.Reservation,
      signedRelease,
      historicalRecovery: true);
  }

  private PrivilegedCommandIsolationVerificationResult<
    VerifiedPrivilegedCommandIsolationPreBindRelease> VerifyPreBindReleaseCore(
      VerifiedPrivilegedCommandIsolationReservation reservation,
      SignedPrivilegedCommandIsolationPreBindRelease signedRelease,
      bool historicalRecovery)
  {
    if (reservation is null)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationPreBindRelease>(
          "isolation_verified_reservation_required");
    }
    if (signedRelease is null
      || !PrivilegedCommandIsolationCanonical.IsValidPreBindRelease(
        signedRelease.Release)
      || !PrivilegedCommandIsolationCanonical.IsSafeKeyId(signedRelease.KeyId))
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationPreBindRelease>(
          "isolation_pre_bind_release_invalid");
    }

    var releaseSnapshot = SnapshotRelease(signedRelease.Release);
    var signedReleaseSnapshot = signedRelease with { Release = releaseSnapshot };
    var lease = reservation.SignedLease.Lease;
    if (!PrivilegedCommandIsolationCanonical.FixedDigestEquals(
        releaseSnapshot.ReservationRequestSha256,
        reservation.ReservationRequestSha256)
      || !PrivilegedCommandIsolationCanonical.FixedDigestEquals(
        releaseSnapshot.RequestNonceSha256,
        reservation.RequestNonceSha256)
      || !PrivilegedCommandIsolationCanonical.FixedDigestEquals(
        releaseSnapshot.LeaseSha256,
        reservation.LeaseSha256)
      || !ActionMatches(releaseSnapshot.Action, lease.Action)
      || !Exact(releaseSnapshot.SupervisorInstanceId, lease.SupervisorInstanceId)
      || !Exact(releaseSnapshot.BootId, lease.BootId)
      || releaseSnapshot.Sequence <= lease.Sequence)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationPreBindRelease>(
          "isolation_pre_bind_release_binding_invalid");
    }

    var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
    var skew = Milliseconds(_settings.AllowedClockSkew);
    var maximumDelay = Milliseconds(_settings.MaximumReceiptDelay);
    if (releaseSnapshot.ReleasedAtUnixMilliseconds
        < Subtract(lease.IssuedAtUnixMilliseconds, skew)
      || releaseSnapshot.ReleasedAtUnixMilliseconds > Add(now, skew)
      || (!historicalRecovery
        && releaseSnapshot.ReleasedAtUnixMilliseconds
          > Add(lease.ExpiresAtUnixMilliseconds, maximumDelay))
      || Subtract(now, releaseSnapshot.ReleasedAtUnixMilliseconds)
        > Add(maximumDelay, skew)
      || (Exact(
          releaseSnapshot.Outcome,
          PrivilegedCommandIsolationPreBindReleaseOutcomes.ExpiredUnused)
        && releaseSnapshot.ReleasedAtUnixMilliseconds
          < lease.ExpiresAtUnixMilliseconds))
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationPreBindRelease>(
          "isolation_pre_bind_release_stale");
    }

    var signature = VerifySignature(
      signedReleaseSnapshot.KeyId,
      PrivilegedCommandIsolationSignaturePurposes.PreBindReservationRelease,
      PrivilegedCommandIsolationCanonical.PreBindReleaseBytes(releaseSnapshot),
      signedReleaseSnapshot.SignatureBase64);
    if (signature == SignatureStatus.KeyUntrusted)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationPreBindRelease>(
          "isolation_pre_bind_release_key_untrusted");
    }
    if (signature != SignatureStatus.Valid)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationPreBindRelease>(
          "isolation_pre_bind_release_signature_invalid");
    }

    return PrivilegedCommandIsolationVerificationResult.Valid(
      new VerifiedPrivilegedCommandIsolationPreBindRelease(
        reservation,
        signedReleaseSnapshot,
        PrivilegedCommandIsolationCanonical.PreBindReleaseSha256(releaseSnapshot)));
  }

  public PrivilegedCommandIsolationVerificationResult<
    VerifiedPrivilegedCommandIsolationBindAcknowledgement> VerifyBindAcknowledgement(
      VerifiedPrivilegedCommandIsolationReservation reservation,
      PrivilegedCommandSuspendedProcessBindingV1 binding,
      SignedPrivilegedCommandIsolationBindAcknowledgement signedAcknowledgement) =>
    VerifyBindAcknowledgementCore(
      reservation,
      binding,
      signedAcknowledgement,
      historicalRecovery: false);

  /// <summary>
  /// Verifies bind evidence already committed to the durable replay ledger.
  /// The lease and acknowledgement may be expired, while their signatures,
  /// action/process binding, measurements, sequence, and bounded historical
  /// lifetimes remain mandatory. It must not authorize a process resume.
  /// </summary>
  public PrivilegedCommandIsolationVerificationResult<
    VerifiedPrivilegedCommandIsolationRecoveryBindAcknowledgement>
      VerifyBindAcknowledgementForRecovery(
        VerifiedPrivilegedCommandIsolationRecoveryReservation reservation,
        PrivilegedCommandSuspendedProcessBindingV1 binding,
        SignedPrivilegedCommandIsolationBindAcknowledgement signedAcknowledgement)
  {
    if (reservation is null)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationRecoveryBindAcknowledgement>(
          "isolation_verified_recovery_reservation_required");
    }
    var verified = VerifyBindAcknowledgementCore(
      reservation.Reservation,
      binding,
      signedAcknowledgement,
      historicalRecovery: true);
    return verified.IsValid && verified.Value is not null
      ? PrivilegedCommandIsolationVerificationResult.Valid(
        new VerifiedPrivilegedCommandIsolationRecoveryBindAcknowledgement(
          verified.Value))
      : PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationRecoveryBindAcknowledgement>(
          verified.ErrorCode ?? "isolation_recovery_bind_invalid");
  }

  private PrivilegedCommandIsolationVerificationResult<
    VerifiedPrivilegedCommandIsolationBindAcknowledgement>
      VerifyBindAcknowledgementCore(
        VerifiedPrivilegedCommandIsolationReservation reservation,
        PrivilegedCommandSuspendedProcessBindingV1 binding,
        SignedPrivilegedCommandIsolationBindAcknowledgement signedAcknowledgement,
        bool historicalRecovery)
  {
    if (reservation is null)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationBindAcknowledgement>(
          "isolation_verified_reservation_required");
    }
    if (!PrivilegedCommandIsolationCanonical.IsValidSuspendedProcessBinding(binding))
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationBindAcknowledgement>(
          "isolation_suspended_process_binding_invalid");
    }

    var bindingSnapshot = SnapshotBinding(binding);
    var lease = reservation.SignedLease.Lease;
    if (!PrivilegedCommandIsolationCanonical.FixedDigestEquals(
        bindingSnapshot.ReservationRequestSha256,
        reservation.ReservationRequestSha256)
      || !PrivilegedCommandIsolationCanonical.FixedDigestEquals(
        bindingSnapshot.RequestNonceSha256,
        reservation.RequestNonceSha256)
      || !PrivilegedCommandIsolationCanonical.FixedDigestEquals(
        bindingSnapshot.LeaseSha256,
        reservation.LeaseSha256)
      || !ActionMatches(bindingSnapshot.Action, lease.Action)
      || !ProcessImageMatchesAction(bindingSnapshot.Process, bindingSnapshot.Action)
      || !Exact(bindingSnapshot.SupervisorInstanceId, lease.SupervisorInstanceId)
      || !Exact(bindingSnapshot.BootId, lease.BootId))
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationBindAcknowledgement>(
          "isolation_suspended_process_binding_mismatch");
    }

    var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
    var skew = Milliseconds(_settings.AllowedClockSkew);
    if (bindingSnapshot.ObservedAtUnixMilliseconds
        < Subtract(lease.IssuedAtUnixMilliseconds, skew)
      || bindingSnapshot.ObservedAtUnixMilliseconds > Add(now, skew)
      || bindingSnapshot.ObservedAtUnixMilliseconds >= lease.ExpiresAtUnixMilliseconds
      || (!historicalRecovery && lease.ExpiresAtUnixMilliseconds <= now))
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationBindAcknowledgement>(
          "isolation_suspended_process_binding_stale");
    }

    if (signedAcknowledgement is null
      || !PrivilegedCommandIsolationCanonical.IsValidBindAcknowledgement(
        signedAcknowledgement.Acknowledgement)
      || !PrivilegedCommandIsolationCanonical.IsSafeKeyId(signedAcknowledgement.KeyId))
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationBindAcknowledgement>(
          "isolation_bind_acknowledgement_invalid");
    }

    var acknowledgementSnapshot = SnapshotAcknowledgement(
      signedAcknowledgement.Acknowledgement);
    var signedAcknowledgementSnapshot = signedAcknowledgement with
    {
      Acknowledgement = acknowledgementSnapshot,
    };
    var bindingSha256 =
      PrivilegedCommandIsolationCanonical.SuspendedProcessBindingSha256(bindingSnapshot);
    if (!PrivilegedCommandIsolationCanonical.FixedDigestEquals(
        acknowledgementSnapshot.ReservationRequestSha256,
        reservation.ReservationRequestSha256)
      || !PrivilegedCommandIsolationCanonical.FixedDigestEquals(
        acknowledgementSnapshot.RequestNonceSha256,
        reservation.RequestNonceSha256)
      || !PrivilegedCommandIsolationCanonical.FixedDigestEquals(
        acknowledgementSnapshot.LeaseSha256,
        reservation.LeaseSha256)
      || !PrivilegedCommandIsolationCanonical.FixedDigestEquals(
        acknowledgementSnapshot.SuspendedProcessBindingSha256,
        bindingSha256)
      || !ActionMatches(acknowledgementSnapshot.Action, bindingSnapshot.Action)
      || !ProcessMatches(acknowledgementSnapshot.Process, bindingSnapshot.Process)
      || !Exact(acknowledgementSnapshot.SupervisorInstanceId, lease.SupervisorInstanceId)
      || !Exact(acknowledgementSnapshot.BootId, lease.BootId)
      || !acknowledgementSnapshot.EnforcedFeatures.SequenceEqual(
        lease.EnforcedFeatures,
        StringComparer.Ordinal)
      || acknowledgementSnapshot.Sequence <= lease.Sequence)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationBindAcknowledgement>(
          "isolation_bind_acknowledgement_binding_invalid");
    }

    var maximumBindLifetime = Milliseconds(
      _settings.MaximumBindAcknowledgementLifetime);
    if (acknowledgementSnapshot.IssuedAtUnixMilliseconds
        < lease.IssuedAtUnixMilliseconds
      || acknowledgementSnapshot.IssuedAtUnixMilliseconds
        < Subtract(bindingSnapshot.ObservedAtUnixMilliseconds, skew)
      || acknowledgementSnapshot.IssuedAtUnixMilliseconds > Add(now, skew)
      || (!historicalRecovery
        && acknowledgementSnapshot.ExpiresAtUnixMilliseconds <= now)
      || acknowledgementSnapshot.ExpiresAtUnixMilliseconds
        > lease.ExpiresAtUnixMilliseconds
      || Subtract(
          acknowledgementSnapshot.ExpiresAtUnixMilliseconds,
          acknowledgementSnapshot.IssuedAtUnixMilliseconds) > maximumBindLifetime)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationBindAcknowledgement>(
          "isolation_bind_acknowledgement_stale");
    }

    var signature = VerifySignature(
      signedAcknowledgementSnapshot.KeyId,
      PrivilegedCommandIsolationSignaturePurposes.SuspendedProcessBindAcknowledgement,
      PrivilegedCommandIsolationCanonical.BindAcknowledgementBytes(
        acknowledgementSnapshot),
      signedAcknowledgementSnapshot.SignatureBase64);
    if (signature == SignatureStatus.KeyUntrusted)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationBindAcknowledgement>(
          "isolation_bind_acknowledgement_key_untrusted");
    }
    if (signature != SignatureStatus.Valid)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationBindAcknowledgement>(
          "isolation_bind_acknowledgement_signature_invalid");
    }

    return PrivilegedCommandIsolationVerificationResult.Valid(
      new VerifiedPrivilegedCommandIsolationBindAcknowledgement(
        reservation,
        bindingSnapshot,
        signedAcknowledgementSnapshot,
        bindingSha256,
        PrivilegedCommandIsolationCanonical.BindAcknowledgementSha256(
          acknowledgementSnapshot)));
  }

  public PrivilegedCommandIsolationVerificationResult<
    VerifiedPrivilegedCommandIsolationTerminalReceipt> VerifyTerminalReceipt(
      VerifiedPrivilegedCommandIsolationBindAcknowledgement bindAcknowledgement,
      SignedPrivilegedCommandIsolationTerminalReceipt signedReceipt) =>
    VerifyTerminalReceiptCore(
      bindAcknowledgement,
      signedReceipt,
      historicalRecovery: false);

  /// <summary>
  /// Verifies a newly issued terminal settlement for historical bind evidence.
  /// The terminal receipt must be fresh and preserve the original bounded
  /// execution timeline, but it may report a process that ended while the
  /// companion was offline longer than the ordinary receipt-delivery window.
  /// </summary>
  public PrivilegedCommandIsolationVerificationResult<
    VerifiedPrivilegedCommandIsolationTerminalReceipt>
      VerifyTerminalReceiptForRecovery(
        VerifiedPrivilegedCommandIsolationRecoveryBindAcknowledgement
          bindAcknowledgement,
        SignedPrivilegedCommandIsolationTerminalReceipt signedReceipt)
  {
    if (bindAcknowledgement is null)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationTerminalReceipt>(
          "isolation_verified_recovery_bind_acknowledgement_required");
    }
    return VerifyTerminalReceiptCore(
      bindAcknowledgement.BindAcknowledgement,
      signedReceipt,
      historicalRecovery: true);
  }

  private PrivilegedCommandIsolationVerificationResult<
    VerifiedPrivilegedCommandIsolationTerminalReceipt> VerifyTerminalReceiptCore(
      VerifiedPrivilegedCommandIsolationBindAcknowledgement bindAcknowledgement,
      SignedPrivilegedCommandIsolationTerminalReceipt signedReceipt,
      bool historicalRecovery)
  {
    if (bindAcknowledgement is null)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationTerminalReceipt>(
          "isolation_verified_bind_acknowledgement_required");
    }
    if (signedReceipt is null
      || !PrivilegedCommandIsolationCanonical.IsValidTerminalReceipt(
        signedReceipt.Receipt)
      || !PrivilegedCommandIsolationCanonical.IsSafeKeyId(signedReceipt.KeyId))
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationTerminalReceipt>(
          "isolation_terminal_receipt_invalid");
    }

    var receiptSnapshot = SnapshotReceipt(signedReceipt.Receipt);
    var signedReceiptSnapshot = signedReceipt with { Receipt = receiptSnapshot };
    var reservation = bindAcknowledgement.Reservation;
    var lease = reservation.SignedLease.Lease;
    var binding = bindAcknowledgement.Binding;
    var acknowledgement = bindAcknowledgement.SignedAcknowledgement.Acknowledgement;
    if (!PrivilegedCommandIsolationCanonical.FixedDigestEquals(
        receiptSnapshot.ReservationRequestSha256,
        reservation.ReservationRequestSha256)
      || !PrivilegedCommandIsolationCanonical.FixedDigestEquals(
        receiptSnapshot.RequestNonceSha256,
        reservation.RequestNonceSha256)
      || !PrivilegedCommandIsolationCanonical.FixedDigestEquals(
        receiptSnapshot.LeaseSha256,
        reservation.LeaseSha256)
      || !PrivilegedCommandIsolationCanonical.FixedDigestEquals(
        receiptSnapshot.SuspendedProcessBindingSha256,
        bindAcknowledgement.SuspendedProcessBindingSha256)
      || !PrivilegedCommandIsolationCanonical.FixedDigestEquals(
        receiptSnapshot.BindAcknowledgementSha256,
        bindAcknowledgement.AcknowledgementSha256)
      || !ActionMatches(receiptSnapshot.Action, binding.Action)
      || !ProcessMatches(receiptSnapshot.Process, binding.Process)
      || !Exact(receiptSnapshot.SupervisorInstanceId, lease.SupervisorInstanceId)
      || !Exact(receiptSnapshot.BootId, lease.BootId)
      || !receiptSnapshot.EnforcedFeatures.SequenceEqual(
        acknowledgement.EnforcedFeatures,
        StringComparer.Ordinal)
      || receiptSnapshot.Sequence <= acknowledgement.Sequence)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationTerminalReceipt>(
          "isolation_terminal_receipt_binding_invalid");
    }

    var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
    var skew = Milliseconds(_settings.AllowedClockSkew);
    var maximumExecution = Milliseconds(_settings.MaximumExecutionDuration);
    var maximumReceiptDelay = Milliseconds(_settings.MaximumReceiptDelay);
    var executionAnchor = receiptSnapshot.ProcessResumed
      ? receiptSnapshot.ResumedAtUnixMilliseconds
      : acknowledgement.IssuedAtUnixMilliseconds;
    if ((receiptSnapshot.ProcessResumed
        && (receiptSnapshot.ResumedAtUnixMilliseconds
            < acknowledgement.IssuedAtUnixMilliseconds
          || receiptSnapshot.ResumedAtUnixMilliseconds
            >= acknowledgement.ExpiresAtUnixMilliseconds))
      || (!receiptSnapshot.ProcessResumed
        && receiptSnapshot.ResumedAtUnixMilliseconds != 0)
      || receiptSnapshot.EndedAtUnixMilliseconds < executionAnchor
      || Subtract(receiptSnapshot.EndedAtUnixMilliseconds, executionAnchor)
        > maximumExecution
      || receiptSnapshot.IssuedAtUnixMilliseconds
        < receiptSnapshot.EndedAtUnixMilliseconds
      || receiptSnapshot.IssuedAtUnixMilliseconds > Add(now, skew)
      || Subtract(now, receiptSnapshot.IssuedAtUnixMilliseconds)
        > Add(maximumReceiptDelay, skew)
      || (!historicalRecovery
        && Subtract(
            receiptSnapshot.IssuedAtUnixMilliseconds,
            receiptSnapshot.EndedAtUnixMilliseconds) > maximumReceiptDelay))
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationTerminalReceipt>(
          "isolation_terminal_receipt_stale");
    }

    var signature = VerifySignature(
      signedReceiptSnapshot.KeyId,
      PrivilegedCommandIsolationSignaturePurposes.TerminalEnforcementReceipt,
      PrivilegedCommandIsolationCanonical.TerminalReceiptBytes(receiptSnapshot),
      signedReceiptSnapshot.SignatureBase64);
    if (signature == SignatureStatus.KeyUntrusted)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationTerminalReceipt>(
          "isolation_terminal_receipt_key_untrusted");
    }
    if (signature != SignatureStatus.Valid)
    {
      return PrivilegedCommandIsolationVerificationResult.Invalid<
        VerifiedPrivilegedCommandIsolationTerminalReceipt>(
          "isolation_terminal_receipt_signature_invalid");
    }

    return PrivilegedCommandIsolationVerificationResult.Valid(
      new VerifiedPrivilegedCommandIsolationTerminalReceipt(
        bindAcknowledgement,
        signedReceiptSnapshot,
        PrivilegedCommandIsolationCanonical.TerminalReceiptSha256(receiptSnapshot)));
  }

  private bool ExpectedPinsMatch(PrivilegedCommandIsolationActionBinding action) =>
    Exact(action.DeviceId, _settings.ExpectedDeviceId)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      action.IsolationPolicySha256,
      _settings.ExpectedIsolationPolicySha256)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      action.DriverMeasurementSha256,
      _settings.ExpectedDriverMeasurementSha256)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      action.ServiceMeasurementSha256,
      _settings.ExpectedServiceMeasurementSha256);

  private SignatureStatus VerifySignature(
    string keyId,
    string purpose,
    byte[] data,
    string signatureBase64)
  {
    ECDsa? key;
    try
    {
      if (!_keys.TryResolve(keyId, purpose, out key) || key is null)
      {
        return SignatureStatus.KeyUntrusted;
      }
    }
    catch (Exception exception) when (exception is CryptographicException
      or IOException
      or InvalidOperationException
      or NotSupportedException
      or ObjectDisposedException
      or UnauthorizedAccessException)
    {
      return SignatureStatus.KeyUntrusted;
    }

    using (key)
    {
      var signatureBytes = PrivilegedCommandIsolationCanonical.PurposeSignatureBytes(
        purpose,
        keyId,
        data);
      return PrivilegedCommandIsolationCanonical.Verify(
        key,
        signatureBytes,
        signatureBase64)
        ? SignatureStatus.Valid
        : SignatureStatus.Invalid;
    }
  }

  private static bool ActionMatches(
    PrivilegedCommandIsolationActionBinding left,
    PrivilegedCommandIsolationActionBinding right) =>
    Exact(left.ActionId, right.ActionId)
    && Exact(left.TaskId, right.TaskId)
    && Exact(left.PlanVersionId, right.PlanVersionId)
    && Exact(left.StepId, right.StepId)
    && Exact(left.DeviceId, right.DeviceId)
    && Exact(left.MandateId, right.MandateId)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      left.ActionTokenSha256,
      right.ActionTokenSha256)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      left.InvocationSha256,
      right.InvocationSha256)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      left.ExpectedImagePathSha256,
      right.ExpectedImagePathSha256)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      left.ExpectedImageSha256,
      right.ExpectedImageSha256)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      left.IsolationPolicySha256,
      right.IsolationPolicySha256)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      left.DriverMeasurementSha256,
      right.DriverMeasurementSha256)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      left.ServiceMeasurementSha256,
      right.ServiceMeasurementSha256)
    && left.RequiredFeatures.SequenceEqual(right.RequiredFeatures, StringComparer.Ordinal)
    && AuthorizationMatches(left.Authorization, right.Authorization);

  private static bool ProcessMatches(
    PrivilegedCommandIsolationProcessBinding left,
    PrivilegedCommandIsolationProcessBinding right) =>
    left.ParentProcessId == right.ParentProcessId
    && left.ParentProcessCreationTimeUtcFileTime
      == right.ParentProcessCreationTimeUtcFileTime
    && left.ChildProcessId == right.ChildProcessId
    && left.ChildProcessCreationTimeUtcFileTime == right.ChildProcessCreationTimeUtcFileTime
    && left.PrimaryThreadId == right.PrimaryThreadId
    && Exact(left.JobObjectId, right.JobObjectId)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      left.JobObjectIdentitySha256,
      right.JobObjectIdentitySha256)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      left.ImagePathSha256,
      right.ImagePathSha256)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      left.ImageSha256,
      right.ImageSha256)
    && left.ImageVolumeSerialNumber == right.ImageVolumeSerialNumber
    && left.ImageFileId == right.ImageFileId
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      left.CommandLineSha256,
      right.CommandLineSha256)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      left.WorkingDirectorySha256,
      right.WorkingDirectorySha256)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      left.EnvironmentBlockSha256,
      right.EnvironmentBlockSha256)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      left.InvocationSha256,
      right.InvocationSha256);

  private static bool ProcessImageMatchesAction(
    PrivilegedCommandIsolationProcessBinding process,
    PrivilegedCommandIsolationActionBinding action) =>
    PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      process.ImagePathSha256,
      action.ExpectedImagePathSha256)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      process.ImageSha256,
      action.ExpectedImageSha256)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      process.InvocationSha256,
      action.InvocationSha256);

  private static bool AuthorizationMatches(
    PrivilegedCommandIsolationActionAuthorizationV2 left,
    PrivilegedCommandIsolationActionAuthorizationV2 right) =>
    Exact(left.CapabilityId, right.CapabilityId)
    && Exact(left.CapabilityVersion, right.CapabilityVersion)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      left.ArgumentsSha256,
      right.ArgumentsSha256)
    && OptionalDigestMatches(left.ExpectedPreStateSha256, right.ExpectedPreStateSha256)
    && OptionalDigestMatches(left.InputProvenanceSha256, right.InputProvenanceSha256)
    && PrivilegedCommandIsolationCanonical.FixedDigestEquals(
      left.IdempotencyKeySha256,
      right.IdempotencyKeySha256)
    && Exact(left.LeaseId, right.LeaseId)
    && Exact(left.FencingToken, right.FencingToken)
    && left.LeaseExpiresAtUnixSeconds == right.LeaseExpiresAtUnixSeconds
    && left.DispatchCount == right.DispatchCount
    && Exact(left.ExecutionMode, right.ExecutionMode)
    && left.Budgets == right.Budgets;

  private static bool OptionalDigestMatches(string? left, string? right) =>
    left is null || right is null
      ? left is null && right is null
      : PrivilegedCommandIsolationCanonical.FixedDigestEquals(left, right);

  private static PrivilegedCommandIsolationActionBinding SnapshotAction(
    PrivilegedCommandIsolationActionBinding action) => action with
    {
      RequiredFeatures = Array.AsReadOnly(action.RequiredFeatures.ToArray()),
      Authorization = action.Authorization with
      {
        Budgets = action.Authorization.Budgets with { },
      },
    };

  private static PrivilegedCommandIsolationReservationRequestV1 SnapshotRequest(
    PrivilegedCommandIsolationReservationRequestV1 request) => request with
    {
      Action = SnapshotAction(request.Action),
    };

  private static PrivilegedCommandIsolationReservationLeaseV1 SnapshotLease(
    PrivilegedCommandIsolationReservationLeaseV1 lease) => lease with
    {
      Action = SnapshotAction(lease.Action),
      EnforcedFeatures = Array.AsReadOnly(lease.EnforcedFeatures.ToArray()),
    };

  private static PrivilegedCommandIsolationPreBindReleaseV1 SnapshotRelease(
    PrivilegedCommandIsolationPreBindReleaseV1 release) => release with
    {
      Action = SnapshotAction(release.Action),
    };

  private static PrivilegedCommandSuspendedProcessBindingV1 SnapshotBinding(
    PrivilegedCommandSuspendedProcessBindingV1 binding) => binding with
    {
      Action = SnapshotAction(binding.Action),
      Process = binding.Process with { },
    };

  private static PrivilegedCommandIsolationBindAcknowledgementV1 SnapshotAcknowledgement(
    PrivilegedCommandIsolationBindAcknowledgementV1 acknowledgement) => acknowledgement with
    {
      Action = SnapshotAction(acknowledgement.Action),
      Process = acknowledgement.Process with { },
      EnforcedFeatures = Array.AsReadOnly(acknowledgement.EnforcedFeatures.ToArray()),
    };

  private static PrivilegedCommandIsolationTerminalReceiptV1 SnapshotReceipt(
    PrivilegedCommandIsolationTerminalReceiptV1 receipt) => receipt with
    {
      Action = SnapshotAction(receipt.Action),
      Process = receipt.Process with { },
      EnforcedFeatures = Array.AsReadOnly(receipt.EnforcedFeatures.ToArray()),
    };

  private static void ValidateSettings(
    PrivilegedCommandIsolationVerificationSettings settings)
  {
    if (!PrivilegedCommandIsolationCanonical.IsCanonicalGuid(settings.ExpectedDeviceId)
      || !PrivilegedCommandIsolationCanonical.IsCanonicalSha256(
        settings.ExpectedIsolationPolicySha256)
      || !PrivilegedCommandIsolationCanonical.IsCanonicalSha256(
        settings.ExpectedDriverMeasurementSha256)
      || !PrivilegedCommandIsolationCanonical.IsCanonicalSha256(
        settings.ExpectedServiceMeasurementSha256))
    {
      throw new ArgumentException(
        "Isolation verification settings contain non-canonical identity or digest pins.",
        nameof(settings));
    }

    ValidateDuration(
      settings.AllowedClockSkew,
      TimeSpan.Zero,
      AbsoluteMaximumClockSkew,
      nameof(settings.AllowedClockSkew));
    ValidateDuration(
      settings.MaximumReservationRequestAge,
      TimeSpan.FromMilliseconds(1),
      AbsoluteMaximumRequestAge,
      nameof(settings.MaximumReservationRequestAge));
    ValidateDuration(
      settings.MaximumReservationLeaseLifetime,
      TimeSpan.FromMilliseconds(1),
      AbsoluteMaximumLeaseLifetime,
      nameof(settings.MaximumReservationLeaseLifetime));
    ValidateDuration(
      settings.MaximumBindAcknowledgementLifetime,
      TimeSpan.FromMilliseconds(1),
      AbsoluteMaximumBindLifetime,
      nameof(settings.MaximumBindAcknowledgementLifetime));
    ValidateDuration(
      settings.MaximumExecutionDuration,
      TimeSpan.FromMilliseconds(1),
      AbsoluteMaximumExecutionDuration,
      nameof(settings.MaximumExecutionDuration));
    ValidateDuration(
      settings.MaximumReceiptDelay,
      TimeSpan.FromMilliseconds(1),
      AbsoluteMaximumReceiptDelay,
      nameof(settings.MaximumReceiptDelay));
  }

  private static void ValidateDuration(
    TimeSpan value,
    TimeSpan minimum,
    TimeSpan maximum,
    string name)
  {
    if (value < minimum || value > maximum)
    {
      throw new ArgumentOutOfRangeException(name);
    }
  }

  private static long Milliseconds(TimeSpan value) => checked((long)value.TotalMilliseconds);

  private static long Add(long left, long right)
  {
    try
    {
      return checked(left + right);
    }
    catch (OverflowException)
    {
      return long.MaxValue;
    }
  }

  private static long Subtract(long left, long right)
  {
    try
    {
      return checked(left - right);
    }
    catch (OverflowException)
    {
      return long.MaxValue;
    }
  }

  private static bool Exact(string left, string right) =>
    string.Equals(left, right, StringComparison.Ordinal);

  private enum SignatureStatus
  {
    Invalid,
    KeyUntrusted,
    Valid,
  }
}

/// <summary>
/// Language-neutral canonical material and P-256 signing helpers for v1. Text
/// fields are base64url-without-padding, numbers are invariant decimal, lists
/// carry an explicit count, and signatures are fixed-width IEEE P1363.
/// </summary>
public static class PrivilegedCommandIsolationCanonical
{
  public const int ContractVersion = 2;
  private const int NonceBytes = 32;
  private const string InvocationDomain =
    "MSAIDIZI-PRIVILEGED-COMMAND-ISOLATION-INVOCATION-V2";
  private const string DriverAttestationDomain =
    "MSAIDIZI-PRIVILEGED-COMMAND-ISOLATION-DRIVER-ATTESTATION-V2";
  private const string ReservationRequestDomain =
    "MSAIDIZI-PRIVILEGED-COMMAND-ISOLATION-RESERVATION-REQUEST-V2";
  private const string ReservationLeaseDomain =
    "MSAIDIZI-PRIVILEGED-COMMAND-ISOLATION-RESERVATION-LEASE-V2";
  private const string PreBindReleaseDomain =
    "MSAIDIZI-PRIVILEGED-COMMAND-ISOLATION-PRE-BIND-RELEASE-V2";
  private const string SuspendedProcessBindingDomain =
    "MSAIDIZI-PRIVILEGED-COMMAND-ISOLATION-SUSPENDED-PROCESS-BINDING-V2";
  private const string BindAcknowledgementDomain =
    "MSAIDIZI-PRIVILEGED-COMMAND-ISOLATION-BIND-ACKNOWLEDGEMENT-V2";
  private const string TerminalReceiptDomain =
    "MSAIDIZI-PRIVILEGED-COMMAND-ISOLATION-TERMINAL-RECEIPT-V2";
  private const string SignatureEnvelopeDomain =
    "MSAIDIZI-PRIVILEGED-COMMAND-ISOLATION-PURPOSE-SIGNATURE-V2";

  public static byte[] InvocationBytes(PrivilegedCommandIsolationInvocationV2 value)
  {
    var fields = Start(
      InvocationDomain,
      value.ContractVersion,
      value.ExecutableId,
      value.ExecutablePath,
      value.ExecutableImageSha256);
    fields.Add(Number(value.ExecutableVolumeSerialNumber));
    fields.Add(Number(value.ExecutableFileId));
    fields.Add(Number(value.Arguments.Count));
    fields.AddRange(value.Arguments.Select(Field));
    fields.Add(Field(value.WorkingDirectory));
    fields.Add(Number(value.Environment.Count));
    foreach (var variable in value.Environment)
    {
      fields.Add(Field(variable.Name));
      fields.Add(Field(variable.Value));
    }
    fields.Add(Number(value.RequestedTimeoutSeconds));
    fields.Add(Number(value.RequestedMaximumOutputBytes));
    fields.Add(Number(value.EffectiveTimeoutSeconds));
    fields.Add(Number(value.EffectiveMaximumOutputBytes));
    fields.Add(Number(value.MaximumProcesses));
    fields.Add(Number(value.MaximumProcessMemoryBytes));
    fields.Add(Field(value.CommandLineSha256));
    fields.Add(Field(value.EnvironmentBlockSha256));
    return Bytes(fields);
  }

  public static string InvocationSha256(PrivilegedCommandIsolationInvocationV2 value) =>
    Digest(InvocationBytes(value));

  public static byte[] DriverAttestationBytes(
    PrivilegedCommandDriverAttestationEvidenceV2 value)
  {
    var fields = Start(
      DriverAttestationDomain,
      value.ContractVersion,
      value.SignaturePurpose,
      value.KeyId,
      value.DeviceId,
      value.SupervisorInstanceId,
      value.BootId,
      value.PolicyEpoch,
      value.ChallengeNonceSha256,
      value.IsolationPolicySha256,
      value.DriverMeasurementSha256,
      value.ServiceMeasurementSha256,
      value.DriverServiceName,
      value.DriverImagePathSha256);
    fields.Add(Number(value.SecureBootEnabled ? 1 : 0));
    fields.Add(Number(value.HvciEnabled ? 1 : 0));
    fields.Add(Number(value.WdacEnforced ? 1 : 0));
    AddFeatures(fields, value.EnforcedFeatures);
    fields.Add(Number(value.IssuedAtUnixMilliseconds));
    fields.Add(Number(value.ExpiresAtUnixMilliseconds));
    return Bytes(fields);
  }

  public static string DriverAttestationSha256(
    PrivilegedCommandDriverAttestationEvidenceV2 value) =>
    Digest(DriverAttestationBytes(value));

  public static byte[] ReservationRequestBytes(
    PrivilegedCommandIsolationReservationRequestV1 value)
  {
    var fields = Start(
      ReservationRequestDomain,
      value.ContractVersion,
      value.RequestId,
      value.RequestNonceBase64Url);
    AddAction(fields, value.Action);
    fields.Add(Number(value.RequestedAtUnixMilliseconds));
    fields.Add(Number(value.RequestedExpiresAtUnixMilliseconds));
    return Bytes(fields);
  }

  public static byte[] ReservationLeaseBytes(
    PrivilegedCommandIsolationReservationLeaseV1 value)
  {
    var fields = Start(
      ReservationLeaseDomain,
      value.ContractVersion,
      value.LeaseId);
    fields.Add(Number(value.Sequence));
    fields.Add(Field(value.ReservationRequestSha256));
    fields.Add(Field(value.RequestNonceSha256));
    AddAction(fields, value.Action);
    fields.Add(Field(value.SupervisorInstanceId));
    fields.Add(Field(value.BootId));
    AddFeatures(fields, value.EnforcedFeatures);
    fields.Add(Number(value.IssuedAtUnixMilliseconds));
    fields.Add(Number(value.ExpiresAtUnixMilliseconds));
    return Bytes(fields);
  }

  public static byte[] PreBindReleaseBytes(
    PrivilegedCommandIsolationPreBindReleaseV1 value)
  {
    var fields = Start(
      PreBindReleaseDomain,
      value.ContractVersion,
      value.ReleaseId);
    fields.Add(Number(value.Sequence));
    fields.Add(Field(value.ReservationRequestSha256));
    fields.Add(Field(value.RequestNonceSha256));
    fields.Add(Field(value.LeaseSha256));
    AddAction(fields, value.Action);
    fields.Add(Field(value.SupervisorInstanceId));
    fields.Add(Field(value.BootId));
    fields.Add(Number(value.ReleasedAtUnixMilliseconds));
    fields.Add(Field(value.Outcome));
    return Bytes(fields);
  }

  public static byte[] SuspendedProcessBindingBytes(
    PrivilegedCommandSuspendedProcessBindingV1 value)
  {
    var fields = Start(
      SuspendedProcessBindingDomain,
      value.ContractVersion,
      value.BindingRequestId,
      value.ReservationRequestSha256,
      value.RequestNonceSha256,
      value.LeaseSha256);
    AddAction(fields, value.Action);
    fields.Add(Field(value.SupervisorInstanceId));
    fields.Add(Field(value.BootId));
    AddProcess(fields, value.Process);
    fields.Add(Number(value.CreatedSuspended ? 1 : 0));
    fields.Add(Number(value.AssignedToJob ? 1 : 0));
    fields.Add(Number(value.ObservedAtUnixMilliseconds));
    return Bytes(fields);
  }

  public static byte[] BindAcknowledgementBytes(
    PrivilegedCommandIsolationBindAcknowledgementV1 value)
  {
    var fields = Start(
      BindAcknowledgementDomain,
      value.ContractVersion,
      value.AcknowledgementId);
    fields.Add(Number(value.Sequence));
    fields.Add(Field(value.ReservationRequestSha256));
    fields.Add(Field(value.RequestNonceSha256));
    fields.Add(Field(value.LeaseSha256));
    fields.Add(Field(value.SuspendedProcessBindingSha256));
    AddAction(fields, value.Action);
    fields.Add(Field(value.SupervisorInstanceId));
    fields.Add(Field(value.BootId));
    AddProcess(fields, value.Process);
    AddFeatures(fields, value.EnforcedFeatures);
    fields.Add(Number(value.ChildStillSuspended ? 1 : 0));
    fields.Add(Number(value.KernelEnforcementActive ? 1 : 0));
    fields.Add(Number(value.MayResume ? 1 : 0));
    fields.Add(Number(value.IssuedAtUnixMilliseconds));
    fields.Add(Number(value.ExpiresAtUnixMilliseconds));
    return Bytes(fields);
  }

  public static byte[] TerminalReceiptBytes(
    PrivilegedCommandIsolationTerminalReceiptV1 value)
  {
    var fields = Start(
      TerminalReceiptDomain,
      value.ContractVersion,
      value.ReceiptId);
    fields.Add(Number(value.Sequence));
    fields.Add(Field(value.ReservationRequestSha256));
    fields.Add(Field(value.RequestNonceSha256));
    fields.Add(Field(value.LeaseSha256));
    fields.Add(Field(value.SuspendedProcessBindingSha256));
    fields.Add(Field(value.BindAcknowledgementSha256));
    AddAction(fields, value.Action);
    fields.Add(Field(value.SupervisorInstanceId));
    fields.Add(Field(value.BootId));
    AddProcess(fields, value.Process);
    AddFeatures(fields, value.EnforcedFeatures);
    fields.Add(Number(value.ProcessResumed ? 1 : 0));
    fields.Add(Number(value.ResumedAtUnixMilliseconds));
    fields.Add(Number(value.EndedAtUnixMilliseconds));
    fields.Add(Number(value.IssuedAtUnixMilliseconds));
    fields.Add(Number(value.ProcessTreeTerminal ? 1 : 0));
    fields.Add(Number(value.EnforcementContinuous ? 1 : 0));
    fields.Add(Number(value.ExitCodeKnown ? 1 : 0));
    fields.Add(Number(value.ExitCode));
    fields.Add(Field(value.EnforcementEvidenceSha256));
    fields.Add(Field(value.Outcome));
    return Bytes(fields);
  }

  public static string ReservationRequestSha256(
    PrivilegedCommandIsolationReservationRequestV1 value) =>
    Digest(ReservationRequestBytes(value));

  public static string RequestNonceSha256(
    PrivilegedCommandIsolationReservationRequestV1 value) =>
    RequestNonceSha256(value.RequestNonceBase64Url);

  public static string RequestNonceSha256(string requestNonceBase64Url)
  {
    if (!TryDecodeNonce(requestNonceBase64Url, out var nonce))
    {
      throw new FormatException("The isolation request nonce is not canonical.");
    }

    try
    {
      return Convert.ToHexString(SHA256.HashData(nonce)).ToLowerInvariant();
    }
    finally
    {
      CryptographicOperations.ZeroMemory(nonce);
    }
  }

  public static string ReservationLeaseSha256(
    PrivilegedCommandIsolationReservationLeaseV1 value) =>
    Digest(ReservationLeaseBytes(value));

  public static string PreBindReleaseSha256(
    PrivilegedCommandIsolationPreBindReleaseV1 value) =>
    Digest(PreBindReleaseBytes(value));

  public static string SuspendedProcessBindingSha256(
    PrivilegedCommandSuspendedProcessBindingV1 value) =>
    Digest(SuspendedProcessBindingBytes(value));

  public static string BindAcknowledgementSha256(
    PrivilegedCommandIsolationBindAcknowledgementV1 value) =>
    Digest(BindAcknowledgementBytes(value));

  public static string TerminalReceiptSha256(
    PrivilegedCommandIsolationTerminalReceiptV1 value) =>
    Digest(TerminalReceiptBytes(value));

  /// <summary>
  /// Validates the canonical, self-consistent terminal contract and the fixed
  /// width signature envelope without re-authorizing its key. This is intended
  /// for durable stores that are re-reading evidence which was cryptographically
  /// verified before it was committed to an integrity-protected ledger.
  /// </summary>
  public static bool IsCanonicalSignedTerminalReceipt(
    SignedPrivilegedCommandIsolationTerminalReceipt? value) =>
    value is not null
    && IsValidTerminalReceipt(value.Receipt)
    && IsSafeKeyId(value.KeyId)
    && IsCanonicalP256Signature(value.SignatureBase64);

  public static byte[] ReservationLeaseSignatureBytes(
    PrivilegedCommandIsolationReservationLeaseV1 value,
    string keyId) => PurposeSignatureBytes(
      PrivilegedCommandIsolationSignaturePurposes.ReservationLease,
      keyId,
      ReservationLeaseBytes(value));

  public static byte[] PreBindReleaseSignatureBytes(
    PrivilegedCommandIsolationPreBindReleaseV1 value,
    string keyId) => PurposeSignatureBytes(
      PrivilegedCommandIsolationSignaturePurposes.PreBindReservationRelease,
      keyId,
      PreBindReleaseBytes(value));

  public static byte[] BindAcknowledgementSignatureBytes(
    PrivilegedCommandIsolationBindAcknowledgementV1 value,
    string keyId) => PurposeSignatureBytes(
      PrivilegedCommandIsolationSignaturePurposes.SuspendedProcessBindAcknowledgement,
      keyId,
      BindAcknowledgementBytes(value));

  public static byte[] TerminalReceiptSignatureBytes(
    PrivilegedCommandIsolationTerminalReceiptV1 value,
    string keyId) => PurposeSignatureBytes(
      PrivilegedCommandIsolationSignaturePurposes.TerminalEnforcementReceipt,
      keyId,
      TerminalReceiptBytes(value));

  public static byte[] DriverAttestationSignatureBytes(
    PrivilegedCommandDriverAttestationEvidenceV2 value) => PurposeSignatureBytes(
      PrivilegedCommandIsolationSignaturePurposes.DriverAttestation,
      value.KeyId,
      DriverAttestationBytes(value));

  public static SignedPrivilegedCommandDriverAttestationV2 SignDriverAttestation(
    PrivilegedCommandDriverAttestationEvidenceV2 value,
    ECDsa privateKey) => new(
      value,
      Sign(privateKey, DriverAttestationSignatureBytes(value)));

  public static bool VerifyDriverAttestation(
    SignedPrivilegedCommandDriverAttestationV2? value,
    ECDsa publicKey) =>
    value is not null
    && IsValidDriverAttestation(value.Evidence)
    && Verify(
      publicKey,
      DriverAttestationSignatureBytes(value.Evidence),
      value.SignatureBase64);

  public static SignedPrivilegedCommandIsolationReservationLease SignReservationLease(
    PrivilegedCommandIsolationReservationLeaseV1 value,
    string keyId,
    ECDsa privateKey) => new(
      value,
      keyId,
      Sign(privateKey, ReservationLeaseSignatureBytes(value, keyId)));

  public static SignedPrivilegedCommandIsolationPreBindRelease SignPreBindRelease(
    PrivilegedCommandIsolationPreBindReleaseV1 value,
    string keyId,
    ECDsa privateKey) => new(
      value,
      keyId,
      Sign(privateKey, PreBindReleaseSignatureBytes(value, keyId)));

  public static SignedPrivilegedCommandIsolationBindAcknowledgement
    SignBindAcknowledgement(
      PrivilegedCommandIsolationBindAcknowledgementV1 value,
      string keyId,
      ECDsa privateKey) => new(
        value,
        keyId,
        Sign(privateKey, BindAcknowledgementSignatureBytes(value, keyId)));

  public static SignedPrivilegedCommandIsolationTerminalReceipt SignTerminalReceipt(
    PrivilegedCommandIsolationTerminalReceiptV1 value,
    string keyId,
    ECDsa privateKey) => new(
      value,
      keyId,
      Sign(privateKey, TerminalReceiptSignatureBytes(value, keyId)));

  public static bool IsValidReservationRequest(
    PrivilegedCommandIsolationReservationRequestV1? value) =>
    value is not null
    && value.ContractVersion == ContractVersion
    && IsCanonicalGuid(value.RequestId)
    && IsCanonicalNonce(value.RequestNonceBase64Url)
    && IsValidAction(value.Action)
    && value.RequestedAtUnixMilliseconds > 0
    && value.RequestedExpiresAtUnixMilliseconds > value.RequestedAtUnixMilliseconds;

  internal static bool IsValidReservationLease(
    PrivilegedCommandIsolationReservationLeaseV1? value) =>
    value is not null
    && value.ContractVersion == ContractVersion
    && IsCanonicalGuid(value.LeaseId)
    && value.Sequence > 0
    && IsCanonicalSha256(value.ReservationRequestSha256)
    && IsCanonicalSha256(value.RequestNonceSha256)
    && IsValidAction(value.Action)
    && IsCanonicalGuid(value.SupervisorInstanceId)
    && IsCanonicalGuid(value.BootId)
    && IsValidFeatures(value.EnforcedFeatures)
    && value.EnforcedFeatures.SequenceEqual(
      value.Action.RequiredFeatures,
      StringComparer.Ordinal)
    && value.IssuedAtUnixMilliseconds > 0
    && value.ExpiresAtUnixMilliseconds > value.IssuedAtUnixMilliseconds;

  internal static bool IsValidPreBindRelease(
    PrivilegedCommandIsolationPreBindReleaseV1? value) =>
    value is not null
    && value.ContractVersion == ContractVersion
    && IsCanonicalGuid(value.ReleaseId)
    && value.Sequence > 0
    && IsCanonicalSha256(value.ReservationRequestSha256)
    && IsCanonicalSha256(value.RequestNonceSha256)
    && IsCanonicalSha256(value.LeaseSha256)
    && IsValidAction(value.Action)
    && IsCanonicalGuid(value.SupervisorInstanceId)
    && IsCanonicalGuid(value.BootId)
    && value.ReleasedAtUnixMilliseconds > 0
    && PrivilegedCommandIsolationPreBindReleaseOutcomes.All.Contains(value.Outcome);

  internal static bool IsValidSuspendedProcessBinding(
    PrivilegedCommandSuspendedProcessBindingV1? value) =>
    value is not null
    && value.ContractVersion == ContractVersion
    && IsCanonicalGuid(value.BindingRequestId)
    && IsCanonicalSha256(value.ReservationRequestSha256)
    && IsCanonicalSha256(value.RequestNonceSha256)
    && IsCanonicalSha256(value.LeaseSha256)
    && IsValidAction(value.Action)
    && IsCanonicalGuid(value.SupervisorInstanceId)
    && IsCanonicalGuid(value.BootId)
    && IsValidProcess(value.Process)
    && value.CreatedSuspended
    && value.AssignedToJob
    && value.ObservedAtUnixMilliseconds > 0;

  internal static bool IsValidBindAcknowledgement(
    PrivilegedCommandIsolationBindAcknowledgementV1? value) =>
    value is not null
    && value.ContractVersion == ContractVersion
    && IsCanonicalGuid(value.AcknowledgementId)
    && value.Sequence > 0
    && IsCanonicalSha256(value.ReservationRequestSha256)
    && IsCanonicalSha256(value.RequestNonceSha256)
    && IsCanonicalSha256(value.LeaseSha256)
    && IsCanonicalSha256(value.SuspendedProcessBindingSha256)
    && IsValidAction(value.Action)
    && IsCanonicalGuid(value.SupervisorInstanceId)
    && IsCanonicalGuid(value.BootId)
    && IsValidProcess(value.Process)
    && IsValidFeatures(value.EnforcedFeatures)
    && value.EnforcedFeatures.SequenceEqual(
      value.Action.RequiredFeatures,
      StringComparer.Ordinal)
    && value.ChildStillSuspended
    && value.KernelEnforcementActive
    && value.MayResume
    && value.IssuedAtUnixMilliseconds > 0
    && value.ExpiresAtUnixMilliseconds > value.IssuedAtUnixMilliseconds;

  internal static bool IsValidTerminalReceipt(
    PrivilegedCommandIsolationTerminalReceiptV1? value)
  {
    if (value is null
      || value.ContractVersion != ContractVersion
      || !IsCanonicalGuid(value.ReceiptId)
      || value.Sequence <= 0
      || !IsCanonicalSha256(value.ReservationRequestSha256)
      || !IsCanonicalSha256(value.RequestNonceSha256)
      || !IsCanonicalSha256(value.LeaseSha256)
      || !IsCanonicalSha256(value.SuspendedProcessBindingSha256)
      || !IsCanonicalSha256(value.BindAcknowledgementSha256)
      || !IsValidAction(value.Action)
      || !IsCanonicalGuid(value.SupervisorInstanceId)
      || !IsCanonicalGuid(value.BootId)
      || !IsValidProcess(value.Process)
      || !IsValidFeatures(value.EnforcedFeatures)
      || !value.EnforcedFeatures.SequenceEqual(
        value.Action.RequiredFeatures,
        StringComparer.Ordinal)
      || (value.ProcessResumed
        ? value.ResumedAtUnixMilliseconds <= 0
        : value.ResumedAtUnixMilliseconds != 0)
      || value.EndedAtUnixMilliseconds <= 0
      || (value.ProcessResumed
        && value.EndedAtUnixMilliseconds < value.ResumedAtUnixMilliseconds)
      || value.IssuedAtUnixMilliseconds < value.EndedAtUnixMilliseconds
      || !value.ProcessTreeTerminal
      || (!value.ExitCodeKnown && value.ExitCode != 0)
      || !IsCanonicalSha256(value.EnforcementEvidenceSha256)
      || !PrivilegedCommandIsolationTerminalOutcomes.All.Contains(value.Outcome))
    {
      return false;
    }

    if (!value.EnforcementContinuous
      && value.Outcome is not PrivilegedCommandIsolationTerminalOutcomes.IsolationViolation
        and not PrivilegedCommandIsolationTerminalOutcomes.Unknown)
    {
      return false;
    }

    return value.Outcome switch
    {
      PrivilegedCommandIsolationTerminalOutcomes.Completed =>
        value.ProcessResumed
          && value.EnforcementContinuous
          && value.ExitCodeKnown
          && value.ExitCode == 0,
      PrivilegedCommandIsolationTerminalOutcomes.Failed =>
        value.EnforcementContinuous && value.ExitCodeKnown && value.ExitCode != 0,
      PrivilegedCommandIsolationTerminalOutcomes.Crashed or
      PrivilegedCommandIsolationTerminalOutcomes.TimedOut => value.ProcessResumed,
      PrivilegedCommandIsolationTerminalOutcomes.IsolationViolation =>
        !value.EnforcementContinuous,
      _ => true,
    };
  }

  internal static bool IsValidAction(PrivilegedCommandIsolationActionBinding? value) =>
    value is not null
    && IsCanonicalGuid(value.ActionId)
    && IsCanonicalGuid(value.TaskId)
    && IsCanonicalGuid(value.PlanVersionId)
    && IsCanonicalGuid(value.StepId)
    && IsCanonicalGuid(value.DeviceId)
    && IsCanonicalGuid(value.MandateId)
    && IsCanonicalSha256(value.ActionTokenSha256)
    && IsCanonicalSha256(value.InvocationSha256)
    && IsCanonicalSha256(value.ExpectedImagePathSha256)
    && IsCanonicalSha256(value.ExpectedImageSha256)
    && IsCanonicalSha256(value.IsolationPolicySha256)
    && IsCanonicalSha256(value.DriverMeasurementSha256)
    && IsCanonicalSha256(value.ServiceMeasurementSha256)
    && IsValidFeatures(value.RequiredFeatures)
    && IsValidAuthorization(value.Authorization);

  internal static bool IsValidProcess(PrivilegedCommandIsolationProcessBinding? value) =>
    value is not null
    && value.ParentProcessId > 0
    && value.ParentProcessCreationTimeUtcFileTime > 0
    && value.ChildProcessId > 0
    && value.ChildProcessId != value.ParentProcessId
    && value.ChildProcessCreationTimeUtcFileTime
      >= value.ParentProcessCreationTimeUtcFileTime
    && value.PrimaryThreadId > 0
    && IsCanonicalGuid(value.JobObjectId)
    && IsCanonicalSha256(value.JobObjectIdentitySha256)
    && IsCanonicalSha256(value.ImagePathSha256)
    && IsCanonicalSha256(value.ImageSha256)
    && value.ImageVolumeSerialNumber > 0
    && value.ImageFileId > 0
    && IsCanonicalSha256(value.CommandLineSha256)
    && IsCanonicalSha256(value.WorkingDirectorySha256)
    && IsCanonicalSha256(value.EnvironmentBlockSha256)
    && IsCanonicalSha256(value.InvocationSha256);

  public static bool IsValidInvocation(PrivilegedCommandIsolationInvocationV2? value)
  {
    if (value is null
      || value.ContractVersion != ContractVersion
      || value.ExecutableId is not ("cmd" or "windows-powershell")
      || !IsSafeAbsoluteLocalPath(value.ExecutablePath)
      || !IsCanonicalSha256(value.ExecutableImageSha256)
      || value.ExecutableVolumeSerialNumber == 0
      || value.ExecutableFileId == 0
      || value.Arguments is null
      || value.Arguments.Count is < 1 or > 64
      || value.Arguments.Any(argument => !IsSafeInvocationValue(argument, 8_192))
      || !IsSafeAbsoluteLocalPath(value.WorkingDirectory)
      || value.Environment is null
      || value.Environment.Count is < 1 or > 64
      || !IsValidEnvironment(value.Environment)
      || value.RequestedTimeoutSeconds is < 1 or > 7_200
      || value.EffectiveTimeoutSeconds is < 1 or > 7_200
      || value.EffectiveTimeoutSeconds > value.RequestedTimeoutSeconds
      || value.RequestedMaximumOutputBytes is < 1 or > 16_777_216
      || value.EffectiveMaximumOutputBytes is < 1 or > 16_777_216
      || value.EffectiveMaximumOutputBytes > value.RequestedMaximumOutputBytes
      || value.MaximumProcesses is < 1 or > 32
      || value.MaximumProcessMemoryBytes is < 16_777_216 or > 2_147_483_648
      || !IsCanonicalSha256(value.CommandLineSha256)
      || !IsCanonicalSha256(value.EnvironmentBlockSha256))
    {
      return false;
    }

    return FixedDigestEquals(
        value.CommandLineSha256,
        PayloadDigest.Sha256Hex(BuildCommandLine(value)))
      && FixedDigestEquals(
        value.EnvironmentBlockSha256,
        EnvironmentBlockSha256(value.Environment));
  }

  public static bool IsValidDriverAttestation(
    PrivilegedCommandDriverAttestationEvidenceV2? value) =>
    value is not null
    && value.ContractVersion == ContractVersion
    && string.Equals(
      value.SignaturePurpose,
      PrivilegedCommandIsolationSignaturePurposes.DriverAttestation,
      StringComparison.Ordinal)
    && IsSafeKeyId(value.KeyId)
    && IsCanonicalGuid(value.DeviceId)
    && IsCanonicalGuid(value.SupervisorInstanceId)
    && IsCanonicalGuid(value.BootId)
    && IsSafeIdentifier(value.PolicyEpoch, 128)
    && IsCanonicalSha256(value.ChallengeNonceSha256)
    && IsCanonicalSha256(value.IsolationPolicySha256)
    && IsCanonicalSha256(value.DriverMeasurementSha256)
    && IsCanonicalSha256(value.ServiceMeasurementSha256)
    && string.Equals(
      value.DriverServiceName,
      PrivilegedCommandIsolationSupervisorIdentity.DriverServiceName,
      StringComparison.Ordinal)
    && IsCanonicalSha256(value.DriverImagePathSha256)
    && value.SecureBootEnabled
    && value.HvciEnabled
    && value.WdacEnforced
    && IsValidFeatures(value.EnforcedFeatures)
    && value.IssuedAtUnixMilliseconds > 0
    && value.ExpiresAtUnixMilliseconds > value.IssuedAtUnixMilliseconds;

  private static bool IsValidAuthorization(
    PrivilegedCommandIsolationActionAuthorizationV2? value) =>
    value is not null
    && string.Equals(
      value.CapabilityId,
      PrivilegedCommandIsolationCapability.Id,
      StringComparison.Ordinal)
    && string.Equals(
      value.CapabilityVersion,
      PrivilegedCommandIsolationCapability.Version,
      StringComparison.Ordinal)
    && IsCanonicalSha256(value.ArgumentsSha256)
    && (value.ExpectedPreStateSha256 is null
      || IsCanonicalSha256(value.ExpectedPreStateSha256))
    && (value.InputProvenanceSha256 is null
      || IsCanonicalSha256(value.InputProvenanceSha256))
    && IsCanonicalSha256(value.IdempotencyKeySha256)
    && LeaseFenceContract.HasValidIdentity(value.LeaseId, value.FencingToken)
    && value.LeaseExpiresAtUnixSeconds > 0
    && value.DispatchCount >= 1
    && ActionExecutionModes.IsSupported(value.ExecutionMode)
    && IsValidBudget(value.Budgets)
    && value.DispatchCount <= value.Budgets.BrokerMaxDeliverySessions;

  private static bool IsValidBudget(ActionBudget? value) =>
    value is not null
    && value.MaxWallTimeSeconds is >= 1 and <= 7_200
    && value.MaxModelTurns is >= 1 and <= 200
    && value.MaxAttemptedToolCalls is >= 1 and <= 500
    && value.MaxMutations is >= 1 and <= 100
    && value.MaxLocalBytes is >= 1 and <= 5_368_709_120
    && value.MaxExternalEgressBytes is >= 0 and <= 262_144_000
    && value.MaxModelSpendUsd is > 0 and <= 20
    && value.BrokerMaxDeliverySessions is >= 1 and <= 32
    && value.BrokerMaxRequestAttemptsPerSession is >= 1 and <= 32
    && value.BrokerSerializedResultUpperBoundBytes is >= 1 and <= 16_777_216;

  internal static bool IsCanonicalSha256(string? value) =>
    PayloadDigest.IsSha256Hex(value)
    && string.Equals(value, value?.ToLowerInvariant(), StringComparison.Ordinal);

  internal static bool IsCanonicalGuid(string? value) =>
    value is not null
    && Guid.TryParseExact(value, "D", out var parsed)
    && string.Equals(parsed.ToString("D"), value, StringComparison.Ordinal);

  internal static bool IsSafeKeyId(string? value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 128
    && char.IsAsciiLetterOrDigit(value[0])
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_' or ':');

  internal static bool FixedDigestEquals(string left, string right) =>
    IsCanonicalSha256(left)
    && IsCanonicalSha256(right)
    && PayloadDigest.FixedTimeEqualsHex(left, right);

  internal static bool Verify(
    ECDsa key,
    byte[] data,
    string signatureBase64)
  {
    if (signatureBase64 is null || signatureBase64.Length != 88)
    {
      return false;
    }

    try
    {
      var signature = Convert.FromBase64String(signatureBase64);
      try
      {
        return signature.Length == 64
          && Convert.ToBase64String(signature) == signatureBase64
          && IsP256(key)
          && key.VerifyData(
            data,
            signature,
            HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(signature);
      }
    }
    catch (Exception exception) when (exception is ArgumentNullException
      or FormatException
      or CryptographicException)
    {
      return false;
    }
  }

  private static bool IsCanonicalP256Signature(string? signatureBase64)
  {
    if (signatureBase64 is null || signatureBase64.Length != 88)
    {
      return false;
    }

    try
    {
      var signature = Convert.FromBase64String(signatureBase64);
      try
      {
        return signature.Length == 64
          && string.Equals(
            Convert.ToBase64String(signature),
            signatureBase64,
            StringComparison.Ordinal);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(signature);
      }
    }
    catch (FormatException)
    {
      return false;
    }
  }

  internal static byte[] PurposeSignatureBytes(
    string signaturePurpose,
    string keyId,
    byte[] canonicalPayload)
  {
    if (!IsSafeKeyId(keyId))
    {
      throw new ArgumentException("The isolation signing key ID is not canonical.", nameof(keyId));
    }
    ArgumentNullException.ThrowIfNull(canonicalPayload);

    return Bytes(
    [
      SignatureEnvelopeDomain,
      Field(signaturePurpose),
      Field(keyId),
      Field(Digest(canonicalPayload)),
    ]);
  }

  private static bool IsValidFeatures(IReadOnlyList<string>? features)
  {
    if (features is null
      || features.Count is < 1 or > 16
      || !features.SequenceEqual(features.Order(StringComparer.Ordinal), StringComparer.Ordinal)
      || features.Distinct(StringComparer.Ordinal).Count() != features.Count
      || features.Any(feature => !AllowedFeature(feature)))
    {
      return false;
    }

    return PrivilegedCommandIsolationFeatures.Required.All(required =>
      features.Contains(required, StringComparer.Ordinal));
  }

  private static bool AllowedFeature(string? value) =>
    value is not null && PrivilegedCommandIsolationFeatures.Allowed.Contains(value);

  private static bool IsCanonicalNonce(string? value) =>
    value is not null && TryDecodeNonce(value, out var bytes, clear: true);

  private static bool TryDecodeNonce(string value, out byte[] bytes, bool clear = false)
  {
    bytes = [];
    if (value.Length != 43
      || value.Any(character => !(char.IsAsciiLetterOrDigit(character)
        || character is '-' or '_')))
    {
      return false;
    }

    try
    {
      var base64 = value.Replace('-', '+').Replace('_', '/') + "=";
      bytes = Convert.FromBase64String(base64);
      var canonical = Convert.ToBase64String(bytes)
        .TrimEnd('=')
        .Replace('+', '-')
        .Replace('/', '_');
      var valid = bytes.Length == NonceBytes
        && string.Equals(canonical, value, StringComparison.Ordinal);
      if (!valid || clear)
      {
        CryptographicOperations.ZeroMemory(bytes);
        if (clear)
        {
          bytes = [];
        }
      }
      return valid;
    }
    catch (FormatException)
    {
      bytes = [];
      return false;
    }
  }

  private static void AddAction(
    List<string> fields,
    PrivilegedCommandIsolationActionBinding value)
  {
    fields.Add(Field(value.ActionId));
    fields.Add(Field(value.TaskId));
    fields.Add(Field(value.PlanVersionId));
    fields.Add(Field(value.StepId));
    fields.Add(Field(value.DeviceId));
    fields.Add(Field(value.MandateId));
    fields.Add(Field(value.ActionTokenSha256));
    fields.Add(Field(value.InvocationSha256));
    fields.Add(Field(value.ExpectedImagePathSha256));
    fields.Add(Field(value.ExpectedImageSha256));
    fields.Add(Field(value.IsolationPolicySha256));
    fields.Add(Field(value.DriverMeasurementSha256));
    fields.Add(Field(value.ServiceMeasurementSha256));
    AddFeatures(fields, value.RequiredFeatures);
    fields.Add(Field(value.Authorization.CapabilityId));
    fields.Add(Field(value.Authorization.CapabilityVersion));
    fields.Add(Field(value.Authorization.ArgumentsSha256));
    fields.Add(Field(value.Authorization.ExpectedPreStateSha256));
    fields.Add(Field(value.Authorization.InputProvenanceSha256));
    fields.Add(Field(value.Authorization.IdempotencyKeySha256));
    fields.Add(Field(value.Authorization.LeaseId));
    fields.Add(Field(value.Authorization.FencingToken));
    fields.Add(Number(value.Authorization.LeaseExpiresAtUnixSeconds));
    fields.Add(Number(value.Authorization.DispatchCount));
    fields.Add(Field(value.Authorization.ExecutionMode));
    AddBudget(fields, value.Authorization.Budgets);
  }

  private static void AddProcess(
    List<string> fields,
    PrivilegedCommandIsolationProcessBinding value)
  {
    fields.Add(Number(value.ParentProcessId));
    fields.Add(Number(value.ParentProcessCreationTimeUtcFileTime));
    fields.Add(Number(value.ChildProcessId));
    fields.Add(Number(value.ChildProcessCreationTimeUtcFileTime));
    fields.Add(Number(value.PrimaryThreadId));
    fields.Add(Field(value.JobObjectId));
    fields.Add(Field(value.JobObjectIdentitySha256));
    fields.Add(Field(value.ImagePathSha256));
    fields.Add(Field(value.ImageSha256));
    fields.Add(Number(value.ImageVolumeSerialNumber));
    fields.Add(Number(value.ImageFileId));
    fields.Add(Field(value.CommandLineSha256));
    fields.Add(Field(value.WorkingDirectorySha256));
    fields.Add(Field(value.EnvironmentBlockSha256));
    fields.Add(Field(value.InvocationSha256));
  }

  private static void AddBudget(List<string> fields, ActionBudget value)
  {
    fields.Add(Number(value.MaxWallTimeSeconds));
    fields.Add(Number(value.MaxModelTurns));
    fields.Add(Number(value.MaxAttemptedToolCalls));
    fields.Add(Number(value.MaxMutations));
    fields.Add(Number(value.MaxLocalBytes));
    fields.Add(Number(value.MaxExternalEgressBytes));
    fields.Add(Number(value.MaxModelSpendUsd));
    fields.Add(Number(value.BrokerMaxDeliverySessions));
    fields.Add(Number(value.BrokerMaxRequestAttemptsPerSession));
    fields.Add(Number(value.BrokerSerializedResultUpperBoundBytes));
  }

  private static void AddFeatures(
    List<string> fields,
    IReadOnlyCollection<string> features)
  {
    fields.Add(Number(features.Count));
    foreach (var feature in features)
    {
      fields.Add(Field(feature));
    }
  }

  private static List<string> Start(
    string domain,
    int contractVersion,
    params string[] fields)
  {
    var result = new List<string>(fields.Length + 2)
    {
      domain,
      Number(contractVersion),
    };
    result.AddRange(fields.Select(Field));
    return result;
  }

  private static byte[] Bytes(IEnumerable<string> fields) =>
    Encoding.UTF8.GetBytes(string.Join('\n', fields));

  private static string Digest(byte[] bytes) =>
    Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

  private static string Sign(ECDsa key, byte[] data)
  {
    if (!IsP256(key))
    {
      throw new CryptographicException(
        "Privileged-command isolation contracts require a P-256 signing key.");
    }

    return Convert.ToBase64String(key.SignData(
      data,
      HashAlgorithmName.SHA256,
      DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
  }

  private static bool IsP256(ECDsa key)
  {
    try
    {
      var parameters = key.ExportParameters(includePrivateParameters: false);
      return key.KeySize == 256
        && string.Equals(
          parameters.Curve.Oid.Value,
          ECCurve.NamedCurves.nistP256.Oid.Value,
          StringComparison.Ordinal);
    }
    catch (Exception exception) when (exception is CryptographicException
      or InvalidOperationException
      or NotSupportedException
      or ObjectDisposedException)
    {
      return false;
    }
  }

  private static string Field(string? value)
  {
    var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? string.Empty));
    return encoded.TrimEnd('=').Replace('+', '-').Replace('/', '_');
  }

  private static string Number(long value) => value.ToString(CultureInfo.InvariantCulture);

  private static string Number(ulong value) => value.ToString(CultureInfo.InvariantCulture);

  private static string Number(decimal value) =>
    value.ToString("G29", CultureInfo.InvariantCulture);

  public static string BuildCommandLine(PrivilegedCommandIsolationInvocationV2 value)
  {
    ArgumentNullException.ThrowIfNull(value);
    return string.Join(' ', new[] { QuoteWindowsArgument(value.ExecutablePath) }
      .Concat(value.Arguments.Select(QuoteWindowsArgument)));
  }

  public static string EnvironmentBlockSha256(
    IReadOnlyList<PrivilegedCommandIsolationEnvironmentVariableV2> environment)
  {
    ArgumentNullException.ThrowIfNull(environment);
    var ordered = environment
      .OrderBy(variable => variable.Name, StringComparer.OrdinalIgnoreCase)
      .ThenBy(variable => variable.Name, StringComparer.Ordinal)
      .Select(variable => $"{variable.Name}={variable.Value}");
    var block = string.Join('\0', ordered) + "\0\0";
    return Convert.ToHexString(SHA256.HashData(Encoding.Unicode.GetBytes(block)))
      .ToLowerInvariant();
  }

  public static string WorkingDirectorySha256(string workingDirectory) =>
    PayloadDigest.Sha256Hex(workingDirectory);

  private static string QuoteWindowsArgument(string value)
  {
    if (value.Length > 0
      && value.All(character => character is not (' ' or '\t' or '\n' or '\v' or '"')))
    {
      return value;
    }

    var builder = new StringBuilder(value.Length + 2);
    builder.Append('"');
    var backslashes = 0;
    foreach (var character in value)
    {
      if (character == '\\')
      {
        backslashes++;
        continue;
      }

      if (character == '"')
      {
        builder.Append('\\', checked((backslashes * 2) + 1));
        builder.Append('"');
        backslashes = 0;
        continue;
      }

      builder.Append('\\', backslashes);
      backslashes = 0;
      builder.Append(character);
    }
    builder.Append('\\', checked(backslashes * 2));
    builder.Append('"');
    return builder.ToString();
  }

  private static bool IsValidEnvironment(
    IReadOnlyList<PrivilegedCommandIsolationEnvironmentVariableV2> environment)
  {
    var ordered = environment
      .OrderBy(variable => variable.Name, StringComparer.OrdinalIgnoreCase)
      .ThenBy(variable => variable.Name, StringComparer.Ordinal)
      .ToArray();
    return environment.SequenceEqual(ordered)
      && environment.Select(variable => variable.Name)
        .Distinct(StringComparer.OrdinalIgnoreCase).Count() == environment.Count
      && environment.All(variable =>
        variable is not null
        && IsEnvironmentName(variable.Name)
        && IsSafeInvocationValue(variable.Value, 32_768));
  }

  private static bool IsEnvironmentName(string? value) =>
    value is { Length: >= 1 and <= 128 }
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '_' or '(' or ')' or '-')
    && !value.Contains('=');

  private static bool IsSafeInvocationValue(string? value, int maximumLength) =>
    value is not null
    && value.Length <= maximumLength
    && value.All(character => character != '\0'
      && (character >= ' ' || character is '\t'));

  private static bool IsSafeIdentifier(string? value, int maximumLength) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= maximumLength
    && value.All(character => character >= ' ' && character != '\u007f');

  private static bool IsSafeAbsoluteLocalPath(string? value)
  {
    if (string.IsNullOrWhiteSpace(value)
      || value.Length > 32_767
      || !Path.IsPathFullyQualified(value)
      || value.StartsWith("\\\\", StringComparison.Ordinal)
      || value.StartsWith("\\??\\", StringComparison.Ordinal)
      || value.StartsWith("\\\\?\\", StringComparison.Ordinal)
      || value.IndexOf(':', 3) >= 0
      || value.EndsWith(' ')
      || value.EndsWith('.'))
    {
      return false;
    }

    try
    {
      return string.Equals(
        Path.GetFullPath(value),
        value,
        StringComparison.OrdinalIgnoreCase);
    }
    catch (Exception exception) when (exception is ArgumentException
      or NotSupportedException
      or PathTooLongException)
    {
      return false;
    }
  }
}
