using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Channel;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Enforcement;

public sealed record KernelIsolationAttestation(
  string DeviceId,
  string BootId,
  string IsolationPolicySha256,
  string DriverMeasurementSha256,
  string ServiceMeasurementSha256,
  string SupervisorInstanceId,
  string PolicyEpoch,
  string DriverServiceName,
  string DriverImagePathSha256,
  bool SecureBootEnabled,
  bool HvciEnabled,
  bool WdacEnforced,
  IReadOnlyList<string> EnforcedFeatures,
  string EvidenceSha256,
  SignedPrivilegedCommandDriverAttestationV2 SignedEvidence);

public sealed record KernelIsolationBinding(
  string EnforcementLeaseId,
  string JobObjectId,
  string JobObjectIdentitySha256,
  string ImagePathSha256,
  string ImageSha256,
  uint ImageVolumeSerialNumber,
  ulong ImageFileId,
  string CommandLineSha256,
  string WorkingDirectorySha256,
  string EnvironmentBlockSha256,
  string InvocationSha256,
  bool ChildStillSuspended,
  bool AssignedToJob,
  bool KernelEnforcementActive,
  IReadOnlyList<string> EnforcedFeatures,
  string EnforcementEvidenceSha256);

public sealed record KernelIsolationTerminalEvidence(
  bool ProcessResumed,
  long ResumedAtUnixMilliseconds,
  long EndedAtUnixMilliseconds,
  bool ProcessTreeTerminal,
  bool EnforcementContinuous,
  bool ExitCodeKnown,
  int ExitCode,
  string EnforcementEvidenceSha256,
  string Outcome);

public interface IPrivilegedCommandKernelEnforcer : IAsyncDisposable
{
  ValueTask<KernelIsolationAttestation> AttestAsync(
    CancellationToken cancellationToken);

  ValueTask<KernelIsolationBinding> BindSuspendedProcessAsync(
    PrivilegedCommandIsolationReservationRequestV1 request,
    SuspendedProcessObservation observation,
    PrivilegedCommandIsolationInvocationV2 invocation,
    PipePeerIdentity peer,
    CancellationToken cancellationToken);

  ValueTask<KernelIsolationTerminalEvidence> SettleAsync(
    string enforcementLeaseId,
    PrivilegedCommandSuspendedProcessBindingV1 binding,
    TerminalObservation requestedObservation,
    CancellationToken cancellationToken);

  ValueTask<KernelIsolationTerminalEvidence> RecoverAndTerminateAsync(
    string enforcementLeaseId,
    PrivilegedCommandSuspendedProcessBindingV1 binding,
    CancellationToken cancellationToken);
}

internal static class KernelIsolationValidation
{
  public static void RequireExactAttestation(
    KernelIsolationAttestation attestation,
    string deviceId,
    string bootId,
    string supervisorInstanceId,
    string policyEpoch,
    string driverServiceName,
    string policySha256,
    string driverMeasurementSha256,
    string serviceMeasurementSha256)
  {
    if (attestation is null
      || !string.Equals(attestation.DeviceId, deviceId, StringComparison.Ordinal)
      || !string.Equals(attestation.BootId, bootId, StringComparison.Ordinal)
      || !string.Equals(
        attestation.SupervisorInstanceId,
        supervisorInstanceId,
        StringComparison.Ordinal)
      || !string.Equals(attestation.PolicyEpoch, policyEpoch, StringComparison.Ordinal)
      || !string.Equals(
        attestation.DriverServiceName,
        driverServiceName,
        StringComparison.Ordinal)
      || !Digest(attestation.IsolationPolicySha256, policySha256)
      || !Digest(attestation.DriverMeasurementSha256, driverMeasurementSha256)
      || !Digest(attestation.ServiceMeasurementSha256, serviceMeasurementSha256)
      || !DigestValue(attestation.DriverImagePathSha256)
      || !attestation.SecureBootEnabled
      || !attestation.HvciEnabled
      || !attestation.WdacEnforced
      || !DigestValue(attestation.EvidenceSha256)
      || attestation.SignedEvidence is null
      || !Digest(
        attestation.EvidenceSha256,
        PrivilegedCommandIsolationCanonical.DriverAttestationSha256(
          attestation.SignedEvidence.Evidence))
      || !ExactFeatures(attestation.EnforcedFeatures))
    {
      throw new UnauthorizedAccessException(
        "The kernel isolation provider attestation is unavailable or does not match deployment pins.");
    }
  }

  public static void RequireBinding(KernelIsolationBinding binding)
  {
    if (binding is null
      || !CanonicalGuid(binding.EnforcementLeaseId)
      || !CanonicalGuid(binding.JobObjectId)
      || !DigestValue(binding.JobObjectIdentitySha256)
      || !DigestValue(binding.ImagePathSha256)
      || !DigestValue(binding.ImageSha256)
      || binding.ImageVolumeSerialNumber == 0
      || binding.ImageFileId == 0
      || !DigestValue(binding.CommandLineSha256)
      || !DigestValue(binding.WorkingDirectorySha256)
      || !DigestValue(binding.EnvironmentBlockSha256)
      || !DigestValue(binding.InvocationSha256)
      || !binding.ChildStillSuspended
      || !binding.AssignedToJob
      || !binding.KernelEnforcementActive
      || !ExactFeatures(binding.EnforcedFeatures)
      || !DigestValue(binding.EnforcementEvidenceSha256))
    {
      throw new UnauthorizedAccessException(
        "The kernel isolation provider refused or returned incomplete bind evidence.");
    }
  }

  public static void RequireTerminal(KernelIsolationTerminalEvidence evidence)
  {
    if (evidence is null
      || evidence.EndedAtUnixMilliseconds <= 0
      || evidence.IssuedTimelineInvalid()
      || !evidence.ProcessTreeTerminal
      || !DigestValue(evidence.EnforcementEvidenceSha256)
      || !PrivilegedCommandIsolationTerminalOutcomes.All.Contains(evidence.Outcome)
      || (!evidence.EnforcementContinuous
        && evidence.Outcome is not PrivilegedCommandIsolationTerminalOutcomes.IsolationViolation
          and not PrivilegedCommandIsolationTerminalOutcomes.Unknown))
    {
      throw new UnauthorizedAccessException(
        "The kernel isolation provider did not prove a terminal process tree.");
    }
  }

  private static bool IssuedTimelineInvalid(this KernelIsolationTerminalEvidence evidence) =>
    evidence.ProcessResumed
      ? evidence.ResumedAtUnixMilliseconds <= 0
        || evidence.EndedAtUnixMilliseconds < evidence.ResumedAtUnixMilliseconds
      : evidence.ResumedAtUnixMilliseconds != 0;

  private static bool ExactFeatures(IReadOnlyList<string>? features) =>
    features is not null
    && features.SequenceEqual(PrivilegedCommandIsolationFeatures.Required, StringComparer.Ordinal);

  private static bool Digest(string left, string right) =>
    DigestValue(left)
    && DigestValue(right)
    && PayloadDigest.FixedTimeEqualsHex(left, right);

  private static bool DigestValue(string value) =>
    PayloadDigest.IsSha256Hex(value)
    && string.Equals(value, value.ToLowerInvariant(), StringComparison.Ordinal);

  private static bool CanonicalGuid(string? value) =>
    value is not null
    && Guid.TryParseExact(value, "D", out var parsed)
    && parsed != Guid.Empty
    && string.Equals(parsed.ToString("D"), value, StringComparison.Ordinal);
}
