using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Configuration;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Security;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Enforcement;

/// <summary>
/// Pure verifier for the native driver's purpose-specific, nonce-bound
/// attestation. Keeping it independent of the device handle lets release tests
/// prove every trust claim without pretending that the native IOCTL exists.
/// </summary>
internal static class SignedDriverAttestationValidator
{
  public static void Validate(
    SignedPrivilegedCommandDriverAttestationV2 signed,
    string expectedNonceSha256,
    WindowsIsolationHostPosture posture,
    PrivilegedCommandSupervisorOptions options,
    string bootId,
    IDriverAttestationVerificationKeyResolver keys,
    DateTimeOffset nowUtc)
  {
    ArgumentNullException.ThrowIfNull(signed);
    ArgumentNullException.ThrowIfNull(posture);
    ArgumentNullException.ThrowIfNull(options);
    ArgumentNullException.ThrowIfNull(keys);
    var evidence = signed.Evidence;
    if (!keys.TryResolve(evidence.KeyId, out var key) || key is null)
    {
      throw new UnauthorizedAccessException(
        "The kernel isolation driver attestation key is not pinned.");
    }
    using (key)
    {
      if (!PrivilegedCommandIsolationCanonical.VerifyDriverAttestation(signed, key))
      {
        throw new UnauthorizedAccessException(
          "The kernel isolation driver attestation signature is invalid.");
      }
    }

    var now = nowUtc.ToUnixTimeMilliseconds();
    var skew = checked((long)options.DriverAttestationAllowedClockSkew.TotalMilliseconds);
    var maximumLifetime = checked(
      (long)options.DriverAttestationMaximumLifetime.TotalMilliseconds);
    if (!string.Equals(
        evidence.SignaturePurpose,
        PrivilegedCommandIsolationSignaturePurposes.DriverAttestation,
        StringComparison.Ordinal)
      || !string.Equals(
        evidence.KeyId,
        options.DriverAttestationVerificationKey.KeyId,
        StringComparison.Ordinal)
      || !string.Equals(evidence.DeviceId, options.DeviceId, StringComparison.Ordinal)
      || !string.Equals(
        evidence.SupervisorInstanceId,
        options.SupervisorInstanceId,
        StringComparison.Ordinal)
      || !string.Equals(evidence.BootId, bootId, StringComparison.Ordinal)
      || !string.Equals(
        evidence.PolicyEpoch,
        options.DriverPolicyEpoch,
        StringComparison.Ordinal)
      || !PayloadDigest.FixedTimeEqualsHex(
        evidence.ChallengeNonceSha256,
        expectedNonceSha256)
      || !PayloadDigest.FixedTimeEqualsHex(
        evidence.IsolationPolicySha256,
        options.IsolationPolicySha256)
      || !PayloadDigest.FixedTimeEqualsHex(
        evidence.DriverMeasurementSha256,
        options.DriverMeasurementSha256)
      || !PayloadDigest.FixedTimeEqualsHex(
        evidence.ServiceMeasurementSha256,
        options.ExpectedSupervisorImageSha256)
      || !string.Equals(
        evidence.DriverServiceName,
        options.DriverServiceName,
        StringComparison.Ordinal)
      || !PayloadDigest.FixedTimeEqualsHex(
        evidence.DriverImagePathSha256,
        posture.DriverImagePathSha256)
      || !evidence.SecureBootEnabled
      || !evidence.HvciEnabled
      || !evidence.WdacEnforced
      || !posture.SecureBootEnabled
      || !posture.HvciEnabled
      || !posture.WdacEnforced
      || !evidence.EnforcedFeatures.SequenceEqual(
        PrivilegedCommandIsolationFeatures.Required,
        StringComparer.Ordinal)
      || evidence.IssuedAtUnixMilliseconds > checked(now + skew)
      || evidence.ExpiresAtUnixMilliseconds <= checked(now - skew)
      || evidence.ExpiresAtUnixMilliseconds - evidence.IssuedAtUnixMilliseconds
        > maximumLifetime)
    {
      throw new UnauthorizedAccessException(
        "The signed kernel isolation driver attestation does not match live pins.");
    }
  }
}
