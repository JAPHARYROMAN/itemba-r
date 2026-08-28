using System.Security.Cryptography;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Configuration;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Enforcement;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Security;
using Xunit;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Tests;

public sealed class SignedDriverAttestationValidatorTests : IDisposable
{
  private const string DeviceId = "10000000-0000-4000-8000-000000000001";
  private const string SupervisorId = "20000000-0000-4000-8000-000000000002";
  private const string BootId = "30000000-0000-4000-8000-000000000003";
  private const string KeyId = "driver-attestation-test-v2";
  private static readonly DateTimeOffset Now =
    DateTimeOffset.FromUnixTimeSeconds(2_000_000_000);
  private readonly ECDsa _key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
  private readonly ECDsa _wrongKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
  private readonly PrivilegedCommandSupervisorOptions _options = new()
  {
    DeviceId = DeviceId,
    SupervisorInstanceId = SupervisorId,
    DriverPolicyEpoch = "driver-policy-epoch-v2",
    DriverServiceName =
      PrivilegedCommandIsolationSupervisorIdentity.DriverServiceName,
    IsolationPolicySha256 = new string('1', 64),
    DriverMeasurementSha256 = new string('2', 64),
    ExpectedSupervisorImageSha256 = new string('3', 64),
    DriverAttestationVerificationKey = new PrivilegedCommandVerificationKeyOptions
    {
      KeyId = KeyId,
    },
    DriverAttestationAllowedClockSkew = TimeSpan.FromSeconds(30),
    DriverAttestationMaximumLifetime = TimeSpan.FromMinutes(1),
  };
  private readonly WindowsIsolationHostPosture _posture = new(
    new string('4', 64),
    SecureBootEnabled: true,
    HvciEnabled: true,
    WdacEnforced: true);
  private readonly string _nonceSha256 = new string('5', 64);

  [Fact]
  public void ValidPinnedPurposeNonceBootPolicyAndPostureAttestationPasses()
  {
    var evidence = ValidEvidence();
    var signed = PrivilegedCommandIsolationCanonical.SignDriverAttestation(
      evidence,
      _key);

    SignedDriverAttestationValidator.Validate(
      signed,
      _nonceSha256,
      _posture,
      _options,
      BootId,
      new TestResolver(_key, KeyId),
      Now);
  }

  public static TheoryData<string> InvalidAttestationMutations => new()
  {
    "wrongSignatureKey",
    "nonce",
    "purpose",
    "keyId",
    "staleTime",
    "futureTime",
    "bootId",
    "policyEpoch",
    "driverService",
    "driverImagePathSha256",
    "isolationPolicySha256",
    "driverMeasurementSha256",
    "serviceMeasurementSha256",
    "deviceId",
    "supervisorInstanceId",
    "secureBoot",
    "hvci",
    "wdac",
    "features",
    "liveSecureBoot",
    "liveHvci",
    "liveWdac",
  };

  [Theory]
  [MemberData(nameof(InvalidAttestationMutations))]
  public void EverySignedAndLiveAttestationTrustMutationFailsClosed(string field)
  {
    var evidence = MutateEvidence(ValidEvidence(), field);
    var posture = field switch
    {
      "liveSecureBoot" => _posture with { SecureBootEnabled = false },
      "liveHvci" => _posture with { HvciEnabled = false },
      "liveWdac" => _posture with { WdacEnforced = false },
      _ => _posture,
    };
    var signingKey = string.Equals(
        field,
        "wrongSignatureKey",
        StringComparison.Ordinal)
      ? _wrongKey
      : _key;
    var signed = PrivilegedCommandIsolationCanonical.SignDriverAttestation(
      evidence,
      signingKey);
    var resolverKeyId = string.Equals(field, "keyId", StringComparison.Ordinal)
      ? evidence.KeyId
      : KeyId;

    Assert.Throws<UnauthorizedAccessException>(() =>
      SignedDriverAttestationValidator.Validate(
        signed,
        _nonceSha256,
        posture,
        _options,
        BootId,
        new TestResolver(_key, resolverKeyId),
        Now));
  }

  public void Dispose()
  {
    _key.Dispose();
    _wrongKey.Dispose();
  }

  private PrivilegedCommandDriverAttestationEvidenceV2 ValidEvidence() => new(
    PrivilegedCommandIsolationCanonical.ContractVersion,
    PrivilegedCommandIsolationSignaturePurposes.DriverAttestation,
    KeyId,
    DeviceId,
    SupervisorId,
    BootId,
    _options.DriverPolicyEpoch,
    _nonceSha256,
    _options.IsolationPolicySha256,
    _options.DriverMeasurementSha256,
    _options.ExpectedSupervisorImageSha256,
    _options.DriverServiceName,
    _posture.DriverImagePathSha256,
    SecureBootEnabled: true,
    HvciEnabled: true,
    WdacEnforced: true,
    PrivilegedCommandIsolationFeatures.Required,
    Now.AddSeconds(-1).ToUnixTimeMilliseconds(),
    Now.AddSeconds(29).ToUnixTimeMilliseconds());

  private static PrivilegedCommandDriverAttestationEvidenceV2 MutateEvidence(
    PrivilegedCommandDriverAttestationEvidenceV2 value,
    string field) => field switch
    {
      "wrongSignatureKey" or "liveSecureBoot" or "liveHvci" or "liveWdac" => value,
      "nonce" => value with { ChallengeNonceSha256 = new string('6', 64) },
      "purpose" => value with { SignaturePurpose = "driver-attestation.other" },
      "keyId" => value with { KeyId = "driver-attestation-other-v2" },
      "staleTime" => value with
      {
        IssuedAtUnixMilliseconds = Now.AddSeconds(-120).ToUnixTimeMilliseconds(),
        ExpiresAtUnixMilliseconds = Now.AddSeconds(-60).ToUnixTimeMilliseconds(),
      },
      "futureTime" => value with
      {
        IssuedAtUnixMilliseconds = Now.AddSeconds(31).ToUnixTimeMilliseconds(),
        ExpiresAtUnixMilliseconds = Now.AddSeconds(45).ToUnixTimeMilliseconds(),
      },
      "bootId" => value with { BootId = Guid.NewGuid().ToString("D") },
      "policyEpoch" => value with { PolicyEpoch = value.PolicyEpoch + ".other" },
      "driverService" => value with
      {
        DriverServiceName = value.DriverServiceName + " Other",
      },
      "driverImagePathSha256" => value with
      {
        DriverImagePathSha256 = new string('7', 64),
      },
      "isolationPolicySha256" => value with
      {
        IsolationPolicySha256 = new string('8', 64),
      },
      "driverMeasurementSha256" => value with
      {
        DriverMeasurementSha256 = new string('9', 64),
      },
      "serviceMeasurementSha256" => value with
      {
        ServiceMeasurementSha256 = new string('a', 64),
      },
      "deviceId" => value with { DeviceId = Guid.NewGuid().ToString("D") },
      "supervisorInstanceId" => value with
      {
        SupervisorInstanceId = Guid.NewGuid().ToString("D"),
      },
      "secureBoot" => value with { SecureBootEnabled = false },
      "hvci" => value with { HvciEnabled = false },
      "wdac" => value with { WdacEnforced = false },
      "features" => value with
      {
        EnforcedFeatures = value.EnforcedFeatures.Skip(1).ToArray(),
      },
      _ => throw new ArgumentOutOfRangeException(nameof(field)),
    };

  private sealed class TestResolver(
    ECDsa key,
    string acceptedKeyId) : IDriverAttestationVerificationKeyResolver
  {
    private readonly ECParameters _publicKey = key.ExportParameters(false);

    public bool TryResolve(string keyId, out ECDsa? publicKey)
    {
      if (!string.Equals(keyId, acceptedKeyId, StringComparison.Ordinal))
      {
        publicKey = null;
        return false;
      }
      publicKey = ECDsa.Create(_publicKey);
      return true;
    }
  }
}
