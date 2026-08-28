using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

/// <summary>
/// Exact local action facts presented to the separately trusted isolation
/// client before any native child exists. Policy and binary measurements come
/// back only inside a cryptographically verified reservation.
/// </summary>
public sealed record PrivilegedCommandIsolationRequestBinding(
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
  [property: JsonIgnore]
  PrivilegedCommandIsolationEphemeralBinding? EphemeralBinding = null);

/// <summary>
/// Live-channel-only material. The redacted wrapper prevents record diagnostic
/// formatting from expanding the compact token, argv, or environment and the
/// JsonIgnore annotations keep all persistence serializers blind to it.
/// </summary>
public sealed class PrivilegedCommandIsolationEphemeralBinding
{
  public PrivilegedCommandIsolationEphemeralBinding(
    EphemeralActionAuthorization actionAuthorization,
    PrivilegedCommandIsolationInvocationV2 invocation)
  {
    ActionAuthorization = actionAuthorization
      ?? throw new ArgumentNullException(nameof(actionAuthorization));
    Invocation = invocation ?? throw new ArgumentNullException(nameof(invocation));
  }

  [JsonIgnore]
  public EphemeralActionAuthorization ActionAuthorization { get; }

  [JsonIgnore]
  public PrivilegedCommandIsolationInvocationV2 Invocation { get; }

  public override string ToString() => "[ephemeral-isolation-binding-redacted]";
}

/// <summary>
/// Facts the LocalSystem runner independently observes while the primary
/// thread is still suspended and atomically assigned to its kill-on-close job.
/// The supervisor supplies its own logical job and kernel-object identities in
/// the signed process binding; managed code must never invent those values.
/// </summary>
public sealed record PrivilegedCommandSuspendedProcessObservation(
  int ParentProcessId,
  long ParentProcessCreationTimeUtcFileTime,
  int ChildProcessId,
  long ChildProcessCreationTimeUtcFileTime,
  int PrimaryThreadId,
  string ImagePathSha256,
  string ImageSha256,
  uint ImageVolumeSerialNumber,
  ulong ImageFileId,
  string CommandLineSha256,
  string WorkingDirectorySha256,
  string EnvironmentBlockSha256,
  string InvocationSha256,
  bool CreatedSuspended,
  bool AssignedToJob);

public sealed record PrivilegedCommandTerminalObservation(
  bool ProcessResumed,
  bool ExitCodeKnown,
  int ExitCode,
  string Outcome);

/// <summary>
/// A single reservation-scoped transport session. An accepting implementation
/// must verify the purpose-separated P-256 contracts before returning any
/// verified marker and make all methods idempotent by their canonical digests.
/// </summary>
public interface IPrivilegedCommandTrustedRootIsolationSession : IAsyncDisposable
{
  VerifiedPrivilegedCommandIsolationReservation Reservation { get; }

  ValueTask<VerifiedPrivilegedCommandIsolationPreBindRelease?>
    TryReleaseBeforeBindAsync(
      string outcome,
      CancellationToken cancellationToken);

  ValueTask<VerifiedPrivilegedCommandIsolationBindAcknowledgement?>
    TryBindSuspendedProcessAsync(
      PrivilegedCommandSuspendedProcessObservation observation,
      CancellationToken cancellationToken);

  ValueTask<VerifiedPrivilegedCommandIsolationTerminalReceipt?> TrySettleAsync(
    VerifiedPrivilegedCommandIsolationBindAcknowledgement bindAcknowledgement,
    PrivilegedCommandTerminalObservation observation,
    CancellationToken cancellationToken);
}

/// <summary>
/// Non-model, non-configuration boundary implemented only by a separately
/// trusted deployment component. Reserving is phase one; no reservation alone
/// permits native process creation or resume.
/// </summary>
public interface IPrivilegedCommandTrustedRootIsolationGate
{
  ValueTask<IPrivilegedCommandTrustedRootIsolationSession?> TryReserveAsync(
    PrivilegedCommandIsolationRequestBinding binding,
    CancellationToken cancellationToken);
}

/// <summary>
/// Settlement-only restart surface. Unlike the live gate/session interfaces it
/// exposes no reservation, process-bind, or resume-capable operation.
/// </summary>
public interface IPrivilegedCommandTrustedRootIsolationRecovery
{
  /// <summary>
  /// Reconciles a durable reservation left pending by a companion restart.
  /// Implementations may only return a verified, signed pre-bind release for
  /// this exact reservation; they must not create a process or a new lease.
  /// The fail-closed default keeps older or unavailable supervisors rejecting.
  /// </summary>
  ValueTask<VerifiedPrivilegedCommandIsolationPreBindRelease?>
    TryRecoverPendingReservationAsync(
      PrivilegedCommandIsolationPendingReservation pending,
      CancellationToken cancellationToken) => default;

  /// <summary>
  /// Reconciles a durable bind left pending by a companion restart.
  /// Implementations may only return a verified, signed terminal receipt for
  /// the exact bound process tree; they must never recreate or resume it. The
  /// fail-closed default keeps older or unavailable supervisors rejecting.
  /// </summary>
  ValueTask<VerifiedPrivilegedCommandIsolationTerminalReceipt?>
    TryRecoverPendingBindAsync(
      PrivilegedCommandIsolationPendingBind pending,
      CancellationToken cancellationToken) => default;
}

/// <summary>
/// Process-lifetime fuse for a broken isolation lifecycle. It is deliberately
/// one-way: only a clean service restart followed by startup replay
/// reconciliation can create a fresh, untripped instance.
/// </summary>
public sealed class PrivilegedCommandIsolationDispatchLatch
{
  private int _tripped;

  public bool IsTripped => Volatile.Read(ref _tripped) != 0;

  public void Trip() => Interlocked.Exchange(ref _tripped, 1);

  public void ThrowIfTripped()
  {
    if (IsTripped)
    {
      throw new PrivilegedCommandIsolationUnsafeException(
        "trusted_root_isolation_reconciliation_required",
        "dispatch-latch",
        mayHaveExecuted: false);
    }
  }
}

/// <summary>
/// A signed isolation lifecycle could not be closed safely, or its terminal
/// evidence proved enforcement was broken. The coordinator must persist
/// NEEDS_ATTENTION and rethrow so the worker stops accepting more commands.
/// </summary>
internal sealed class PrivilegedCommandIsolationUnsafeException : Exception
{
  public PrivilegedCommandIsolationUnsafeException(
    string errorCode,
    string phase,
    bool mayHaveExecuted,
    Exception? innerException = null)
    : base(errorCode, innerException)
  {
    ErrorCode = errorCode;
    Phase = phase;
    MayHaveExecuted = mayHaveExecuted;
  }

  public string ErrorCode { get; }

  public string Phase { get; }

  public bool MayHaveExecuted { get; }
}

/// <summary>
/// The only production implementation currently shipped. No option or action
/// can turn it into an accepting gate, so configuration cannot enable a raw
/// LocalSystem command until an independently signed supervisor/driver client
/// is installed and this explicit registration is replaced.
/// </summary>
public sealed class RejectingPrivilegedCommandTrustedRootIsolationGate :
  IPrivilegedCommandTrustedRootIsolationGate,
  IPrivilegedCommandTrustedRootIsolationRecovery
{
  public ValueTask<IPrivilegedCommandTrustedRootIsolationSession?> TryReserveAsync(
    PrivilegedCommandIsolationRequestBinding binding,
    CancellationToken cancellationToken) => default;

  public ValueTask<VerifiedPrivilegedCommandIsolationPreBindRelease?>
    TryRecoverPendingReservationAsync(
      PrivilegedCommandIsolationPendingReservation pending,
      CancellationToken cancellationToken) => default;

  public ValueTask<VerifiedPrivilegedCommandIsolationTerminalReceipt?>
    TryRecoverPendingBindAsync(
      PrivilegedCommandIsolationPendingBind pending,
      CancellationToken cancellationToken) => default;
}

internal static class PrivilegedCommandTrustedRootIsolationVerifier
{
  public static bool ReservationMatches(
    VerifiedPrivilegedCommandIsolationReservation reservation,
    PrivilegedCommandIsolationRequestBinding expected)
  {
    var action = reservation.Request.Action;
    return Exact(action.ActionId, expected.ActionId)
      && Exact(action.TaskId, expected.TaskId)
      && Exact(action.PlanVersionId, expected.PlanVersionId)
      && Exact(action.StepId, expected.StepId)
      && Exact(action.DeviceId, expected.DeviceId)
      && Exact(action.MandateId, expected.MandateId)
      && PayloadDigest.FixedTimeEqualsHex(
        action.ActionTokenSha256,
        expected.ActionTokenSha256)
      && PayloadDigest.FixedTimeEqualsHex(
        action.InvocationSha256,
        expected.InvocationSha256)
      && PayloadDigest.FixedTimeEqualsHex(
        action.ExpectedImagePathSha256,
        expected.ExpectedImagePathSha256)
      && PayloadDigest.FixedTimeEqualsHex(
        action.ExpectedImageSha256,
        expected.ExpectedImageSha256)
      && PayloadDigest.IsSha256Hex(action.IsolationPolicySha256)
      && PayloadDigest.IsSha256Hex(action.DriverMeasurementSha256)
      && PayloadDigest.IsSha256Hex(action.ServiceMeasurementSha256)
      && action.RequiredFeatures.SequenceEqual(
        PrivilegedCommandIsolationFeatures.Required,
        StringComparer.Ordinal)
      && expected.EphemeralBinding is not null
      && PrivilegedCommandIsolationCanonical.IsValidInvocation(
        expected.EphemeralBinding.Invocation)
      && PayloadDigest.FixedTimeEqualsHex(
        action.InvocationSha256,
        PrivilegedCommandIsolationCanonical.InvocationSha256(
          expected.EphemeralBinding.Invocation))
      && AuthorizationMatches(
        action.Authorization,
        expected.EphemeralBinding.ActionAuthorization);
  }

  public static bool BindMatches(
    VerifiedPrivilegedCommandIsolationBindAcknowledgement bindAcknowledgement,
    VerifiedPrivilegedCommandIsolationReservation reservation,
    PrivilegedCommandSuspendedProcessObservation expected)
  {
    var binding = bindAcknowledgement.Binding;
    var process = binding.Process;
    return PayloadDigest.FixedTimeEqualsHex(
        bindAcknowledgement.Reservation.LeaseSha256,
        reservation.LeaseSha256)
      && binding.CreatedSuspended
      && binding.AssignedToJob
      && expected.CreatedSuspended
      && expected.AssignedToJob
      && process.ParentProcessId == expected.ParentProcessId
      && process.ParentProcessCreationTimeUtcFileTime
        == expected.ParentProcessCreationTimeUtcFileTime
      && process.ChildProcessId == expected.ChildProcessId
      && process.ChildProcessCreationTimeUtcFileTime
        == expected.ChildProcessCreationTimeUtcFileTime
      && process.PrimaryThreadId == expected.PrimaryThreadId
      && PayloadDigest.FixedTimeEqualsHex(
        process.ImagePathSha256,
        expected.ImagePathSha256)
      && PayloadDigest.FixedTimeEqualsHex(process.ImageSha256, expected.ImageSha256)
      && process.ImageVolumeSerialNumber == expected.ImageVolumeSerialNumber
      && process.ImageFileId == expected.ImageFileId
      && PayloadDigest.FixedTimeEqualsHex(
        process.CommandLineSha256,
        expected.CommandLineSha256)
      && PayloadDigest.FixedTimeEqualsHex(
        process.WorkingDirectorySha256,
        expected.WorkingDirectorySha256)
      && PayloadDigest.FixedTimeEqualsHex(
        process.EnvironmentBlockSha256,
        expected.EnvironmentBlockSha256)
      && PayloadDigest.FixedTimeEqualsHex(
        process.InvocationSha256,
        expected.InvocationSha256)
      && Guid.TryParseExact(process.JobObjectId, "D", out _)
      && PayloadDigest.IsSha256Hex(process.JobObjectIdentitySha256);
  }

  public static bool PreBindReleaseMatches(
    VerifiedPrivilegedCommandIsolationPreBindRelease release,
    VerifiedPrivilegedCommandIsolationReservation reservation,
    string expectedOutcome)
  {
    var signedRelease = release.SignedRelease.Release;
    return PayloadDigest.FixedTimeEqualsHex(
        release.Reservation.LeaseSha256,
        reservation.LeaseSha256)
      && PayloadDigest.FixedTimeEqualsHex(
        signedRelease.LeaseSha256,
        reservation.LeaseSha256)
      && Exact(signedRelease.Outcome, expectedOutcome);
  }

  public static bool TerminalReceiptMatches(
    VerifiedPrivilegedCommandIsolationTerminalReceipt terminalReceipt,
    VerifiedPrivilegedCommandIsolationBindAcknowledgement bindAcknowledgement,
    PrivilegedCommandTerminalObservation expected)
  {
    var receipt = terminalReceipt.SignedReceipt.Receipt;
    var bindingMatches = PayloadDigest.FixedTimeEqualsHex(
        terminalReceipt.BindAcknowledgement.AcknowledgementSha256,
        bindAcknowledgement.AcknowledgementSha256)
      && receipt.ProcessTreeTerminal;
    if (!bindingMatches || !terminalReceipt.IsIsolationIntact)
    {
      // Authenticated violation evidence is intentionally admissible here: the
      // caller must commit it before permanently fencing dispatch. A mismatch
      // on an intact receipt remains an ordinary invalid-receipt failure.
      return bindingMatches;
    }

    return receipt.ProcessResumed == expected.ProcessResumed
      && receipt.ExitCodeKnown == expected.ExitCodeKnown
      && receipt.ExitCode == expected.ExitCode
      && Exact(receipt.Outcome, expected.Outcome);
  }

  private static bool Exact(string left, string right) =>
    string.Equals(left, right, StringComparison.Ordinal);

  private static bool AuthorizationMatches(
    PrivilegedCommandIsolationActionAuthorizationV2 actual,
    EphemeralActionAuthorization ephemeral)
  {
    var request = ephemeral.SignedAction.Request;
    var claims = ephemeral.VerifiedClaims;
    return Exact(actual.CapabilityId, request.CapabilityId)
      && Exact(actual.CapabilityVersion, request.CapabilityVersion)
      && PayloadDigest.FixedTimeEqualsHex(actual.ArgumentsSha256, request.ArgumentsSha256)
      && OptionalDigest(actual.ExpectedPreStateSha256, request.ExpectedPreStateSha256)
      && OptionalDigest(actual.InputProvenanceSha256, request.InputProvenanceSha256)
      && PayloadDigest.FixedTimeEqualsHex(
        actual.IdempotencyKeySha256,
        PayloadDigest.Sha256Hex(request.IdempotencyKey))
      && Exact(actual.LeaseId, request.LeaseId)
      && Exact(actual.FencingToken, request.FencingToken)
      && actual.LeaseExpiresAtUnixSeconds == request.LeaseExpiresAt.ToUnixTimeSeconds()
      && actual.DispatchCount == request.DispatchCount
      && Exact(actual.ExecutionMode, request.ExecutionMode)
      && actual.Budgets == claims.Budgets;
  }

  private static bool OptionalDigest(string? left, string? right) =>
    left is null || right is null
      ? left is null && right is null
      : PayloadDigest.FixedTimeEqualsHex(left, right);
}
