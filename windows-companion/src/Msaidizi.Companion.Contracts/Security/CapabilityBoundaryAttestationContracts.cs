using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Itemba.Msaidizi.Companion.Contracts.Security;

/// <summary>
/// Purpose-separated startup evidence for exposing standard-user capabilities
/// whose effects require the independently privileged egress boundary. This
/// contract is not an action authorization and cannot replace an egress lease.
/// </summary>
public static class CapabilityBoundaryAttestationContract
{
  public const int Version = 1;
  public const int CapabilityCatalogVersion = 1;
  public const string CompanionServiceRole = "companion-service";
  public const string SessionAgentRole = "session-agent";
  public const string SignaturePurpose = "standard-user-capability-activation-v1";
  public const string RequiredSupervisorServiceSid =
    "S-1-5-80-2691216044-51290016-1044150087-1430489630-3303720160";

  internal static IReadOnlySet<string> Roles { get; } = new HashSet<string>(
  [
    CompanionServiceRole,
    SessionAgentRole,
  ],
  StringComparer.Ordinal);

  public static bool IsRole(string value) => Roles.Contains(value);
}

public sealed record CapabilityBoundaryAttestationRequestV1(
  int ContractVersion,
  string RequestId,
  string RequestNonceSha256,
  string DeviceId,
  string SubjectRole,
  int SubjectProcessId,
  long SubjectProcessCreationTimeUnixMilliseconds,
  string SubjectImageSha256,
  bool BrowserExternalEffectsRequested,
  bool EmergencyCommandRequested,
  string CapabilityManifestSha256,
  string DestinationPolicySha256,
  int CapabilityCatalogVersion,
  int EgressBoundaryContractVersion,
  int EgressSupervisorProtocolVersion,
  int SessionBridgeProtocolVersion,
  long RequestedAtUnixMilliseconds);

public sealed record CapabilityBoundaryAttestationV1(
  int ContractVersion,
  string AttestationId,
  string RequestId,
  string RequestNonceSha256,
  string DeviceId,
  string SupervisorInstanceId,
  string BootId,
  string SubjectRole,
  int SubjectProcessId,
  long SubjectProcessCreationTimeUnixMilliseconds,
  string SubjectImageSha256,
  bool BrowserExternalEffectsEnabled,
  bool EmergencyCommandEnabled,
  string CapabilityManifestSha256,
  string DestinationPolicySha256,
  int CapabilityCatalogVersion,
  int EgressBoundaryContractVersion,
  int EgressSupervisorProtocolVersion,
  int SessionBridgeProtocolVersion,
  string SupervisorServiceSid,
  string SupervisorPipeSecuritySha256,
  bool SecureBootEnabled,
  bool HvciEnabled,
  bool DriverActive,
  bool ServiceActive,
  string DriverMeasurementSha256,
  string ServiceMeasurementSha256,
  string? BrowserBrokerBuildSha256,
  IReadOnlyList<string> Features,
  long IssuedAtUnixMilliseconds,
  long ExpiresAtUnixMilliseconds);

public sealed record SignedCapabilityBoundaryAttestation(
  CapabilityBoundaryAttestationV1 Attestation,
  string KeyId,
  string SignaturePurpose,
  string SignatureBase64);

public sealed record CapabilityBoundaryAttestationExpectation(
  CapabilityBoundaryAttestationRequestV1 Request,
  string ExpectedSupervisorServiceSid,
  string ExpectedSupervisorPipeSecuritySha256,
  IReadOnlyList<string> RequiredFeatures);

public interface ICapabilityBoundaryAttestationReplayGuard
{
  bool TryConsume(
    string attestationId,
    string attestationSha256,
    long expiresAtUnixMilliseconds);
}

/// <summary>
/// Per-process replay fence. A fresh request nonce prevents cross-startup reuse;
/// this guard additionally refuses a repeated signed response within a process.
/// </summary>
public sealed class InMemoryCapabilityBoundaryAttestationReplayGuard(
  TimeProvider? timeProvider = null) : ICapabilityBoundaryAttestationReplayGuard
{
  private readonly TimeProvider _timeProvider = timeProvider ?? TimeProvider.System;
  private readonly ConcurrentDictionary<string, ReplayEntry> _entries =
    new(StringComparer.Ordinal);

  public bool TryConsume(
    string attestationId,
    string attestationSha256,
    long expiresAtUnixMilliseconds)
  {
    var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
    foreach (var entry in _entries)
    {
      if (entry.Value.ExpiresAtUnixMilliseconds <= now)
      {
        _entries.TryRemove(entry.Key, out _);
      }
    }

    return expiresAtUnixMilliseconds > now
      && _entries.TryAdd(
        attestationId,
        new ReplayEntry(attestationSha256, expiresAtUnixMilliseconds));
  }

  private sealed record ReplayEntry(
    string AttestationSha256,
    long ExpiresAtUnixMilliseconds);
}

public sealed class VerifiedCapabilityBoundaryAttestation
{
  internal VerifiedCapabilityBoundaryAttestation(
    SignedCapabilityBoundaryAttestation signedAttestation,
    string digestSha256)
  {
    SignedAttestation = signedAttestation;
    DigestSha256 = digestSha256;
  }

  public SignedCapabilityBoundaryAttestation SignedAttestation { get; }

  public string DigestSha256 { get; }

  public bool IsFresh(DateTimeOffset now)
  {
    var milliseconds = now.ToUnixTimeMilliseconds();
    return SignedAttestation.Attestation.IssuedAtUnixMilliseconds <= milliseconds
      && SignedAttestation.Attestation.ExpiresAtUnixMilliseconds > milliseconds;
  }

  public bool HasAllFeatures(IEnumerable<string> required) => required.All(feature =>
    SignedAttestation.Attestation.Features.Contains(feature, StringComparer.Ordinal));
}

public sealed class CapabilityBoundaryAttestationVerifier
{
  private readonly string _expectedDeviceId;
  private readonly TimeSpan _allowedClockSkew;
  private readonly TimeSpan _maximumLifetime;
  private readonly IEgressAttestationKeyResolver _keys;
  private readonly ICapabilityBoundaryAttestationReplayGuard _replay;
  private readonly TimeProvider _timeProvider;

  public CapabilityBoundaryAttestationVerifier(
    string expectedDeviceId,
    TimeSpan allowedClockSkew,
    TimeSpan maximumLifetime,
    IEgressAttestationKeyResolver keys,
    ICapabilityBoundaryAttestationReplayGuard replay,
    TimeProvider? timeProvider = null)
  {
    _expectedDeviceId = expectedDeviceId;
    _allowedClockSkew = allowedClockSkew;
    _maximumLifetime = maximumLifetime;
    _keys = keys;
    _replay = replay;
    _timeProvider = timeProvider ?? TimeProvider.System;
  }

  public EgressVerificationResult<VerifiedCapabilityBoundaryAttestation> Verify(
    SignedCapabilityBoundaryAttestation envelope,
    CapabilityBoundaryAttestationExpectation expectation)
  {
    ArgumentNullException.ThrowIfNull(envelope);
    ArgumentNullException.ThrowIfNull(expectation);
    var value = envelope.Attestation;
    if (!CapabilityBoundaryAttestationCanonical.IsValid(value)
      || !string.Equals(
        envelope.SignaturePurpose,
        CapabilityBoundaryAttestationContract.SignaturePurpose,
        StringComparison.Ordinal)
      || !SafeToken(envelope.KeyId, 128)
      || !Matches(value, expectation)
      || !string.Equals(value.DeviceId, _expectedDeviceId, StringComparison.Ordinal))
    {
      return EgressVerificationResult.Invalid<VerifiedCapabilityBoundaryAttestation>(
        "capability_boundary_attestation_binding_invalid");
    }

    var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
    var skew = Milliseconds(_allowedClockSkew);
    var maximumLifetime = Milliseconds(_maximumLifetime);
    if (skew < 0
      || maximumLifetime <= 0
      || value.ExpiresAtUnixMilliseconds - value.IssuedAtUnixMilliseconds
        > maximumLifetime
      || value.IssuedAtUnixMilliseconds > Add(now, skew)
      || value.ExpiresAtUnixMilliseconds <= Subtract(now, skew))
    {
      return EgressVerificationResult.Invalid<VerifiedCapabilityBoundaryAttestation>(
        "capability_boundary_attestation_stale");
    }

    if (!_keys.TryResolve(envelope.KeyId, out var publicKey) || publicKey is null)
    {
      return EgressVerificationResult.Invalid<VerifiedCapabilityBoundaryAttestation>(
        "capability_boundary_attestation_key_untrusted");
    }

    using (publicKey)
    {
      if (!CapabilityBoundaryAttestationCanonical.Verify(
        publicKey,
        CapabilityBoundaryAttestationCanonical.Bytes(value),
        envelope.SignatureBase64))
      {
        return EgressVerificationResult.Invalid<VerifiedCapabilityBoundaryAttestation>(
          "capability_boundary_attestation_signature_invalid");
      }
    }

    var digest = CapabilityBoundaryAttestationCanonical.Sha256(value);
    if (!_replay.TryConsume(
      value.AttestationId,
      digest,
      value.ExpiresAtUnixMilliseconds))
    {
      return EgressVerificationResult.Invalid<VerifiedCapabilityBoundaryAttestation>(
        "capability_boundary_attestation_replayed");
    }

    return EgressVerificationResult.Valid(
      new VerifiedCapabilityBoundaryAttestation(envelope, digest));
  }

  private static bool Matches(
    CapabilityBoundaryAttestationV1 value,
    CapabilityBoundaryAttestationExpectation expectation)
  {
    var request = expectation.Request;
    return request.ContractVersion == CapabilityBoundaryAttestationContract.Version
      && Exact(value.RequestId, request.RequestId)
      && DigestEquals(value.RequestNonceSha256, request.RequestNonceSha256)
      && Exact(value.DeviceId, request.DeviceId)
      && Exact(value.SubjectRole, request.SubjectRole)
      && value.SubjectProcessId == request.SubjectProcessId
      && value.SubjectProcessCreationTimeUnixMilliseconds
        == request.SubjectProcessCreationTimeUnixMilliseconds
      && DigestEquals(value.SubjectImageSha256, request.SubjectImageSha256)
      && value.BrowserExternalEffectsEnabled
        == request.BrowserExternalEffectsRequested
      && value.EmergencyCommandEnabled == request.EmergencyCommandRequested
      && DigestEquals(value.CapabilityManifestSha256, request.CapabilityManifestSha256)
      && DigestEquals(value.DestinationPolicySha256, request.DestinationPolicySha256)
      && value.CapabilityCatalogVersion == request.CapabilityCatalogVersion
      && value.EgressBoundaryContractVersion == request.EgressBoundaryContractVersion
      && value.EgressSupervisorProtocolVersion == request.EgressSupervisorProtocolVersion
      && value.SessionBridgeProtocolVersion == request.SessionBridgeProtocolVersion
      && Exact(value.SupervisorServiceSid, expectation.ExpectedSupervisorServiceSid)
      && DigestEquals(
        value.SupervisorPipeSecuritySha256,
        expectation.ExpectedSupervisorPipeSecuritySha256)
      && value.Features.SequenceEqual(
        expectation.RequiredFeatures.Order(StringComparer.Ordinal),
        StringComparer.Ordinal);
  }

  private static bool Exact(string left, string right) =>
    string.Equals(left, right, StringComparison.Ordinal);

  private static bool DigestEquals(string left, string right) =>
    PayloadDigest.FixedTimeEqualsHex(left, right);

  private static bool SafeToken(string value, int maximumLength) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= maximumLength
    && char.IsAsciiLetterOrDigit(value[0])
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_' or ':');

  private static long Milliseconds(TimeSpan value)
  {
    try
    {
      return checked((long)value.TotalMilliseconds);
    }
    catch (OverflowException)
    {
      return -1;
    }
  }

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
}

public static class CapabilityBoundaryAttestationCanonical
{
  private const string Domain = "MSAIDIZI-CAPABILITY-BOUNDARY-ATTESTATION-V1";
  private const string EnvelopeDomain =
    "MSAIDIZI-CAPABILITY-BOUNDARY-ATTESTATION-ENVELOPE-V1";

  public static byte[] Bytes(CapabilityBoundaryAttestationV1 value)
  {
    var fields = new List<string>
    {
      Domain,
      Number(value.ContractVersion),
      Field(value.AttestationId),
      Field(value.RequestId),
      Field(value.RequestNonceSha256),
      Field(value.DeviceId),
      Field(value.SupervisorInstanceId),
      Field(value.BootId),
      Field(value.SubjectRole),
      Number(value.SubjectProcessId),
      Number(value.SubjectProcessCreationTimeUnixMilliseconds),
      Field(value.SubjectImageSha256),
      Number(value.BrowserExternalEffectsEnabled ? 1 : 0),
      Number(value.EmergencyCommandEnabled ? 1 : 0),
      Field(value.CapabilityManifestSha256),
      Field(value.DestinationPolicySha256),
      Number(value.CapabilityCatalogVersion),
      Number(value.EgressBoundaryContractVersion),
      Number(value.EgressSupervisorProtocolVersion),
      Number(value.SessionBridgeProtocolVersion),
      Field(value.SupervisorServiceSid),
      Field(value.SupervisorPipeSecuritySha256),
      Number(value.SecureBootEnabled ? 1 : 0),
      Number(value.HvciEnabled ? 1 : 0),
      Number(value.DriverActive ? 1 : 0),
      Number(value.ServiceActive ? 1 : 0),
      Field(value.DriverMeasurementSha256),
      Field(value.ServiceMeasurementSha256),
      Field(value.BrowserBrokerBuildSha256),
      Number(value.IssuedAtUnixMilliseconds),
      Number(value.ExpiresAtUnixMilliseconds),
    };
    fields.AddRange(value.Features.Select(Field));
    return Encoding.UTF8.GetBytes(string.Join('\n', fields));
  }

  public static string Sha256(CapabilityBoundaryAttestationV1 value) =>
    Convert.ToHexString(SHA256.HashData(Bytes(value))).ToLowerInvariant();

  public static string EnvelopeSha256(SignedCapabilityBoundaryAttestation value) =>
    Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join('\n',
      EnvelopeDomain,
      Field(Sha256(value.Attestation)),
      Field(value.KeyId),
      Field(value.SignaturePurpose),
      Field(value.SignatureBase64))))).ToLowerInvariant();

  public static SignedCapabilityBoundaryAttestation Sign(
    CapabilityBoundaryAttestationV1 value,
    string keyId,
    ECDsa privateKey)
  {
    if (!EgressBoundaryCanonical.IsExactP256(privateKey))
    {
      throw new CryptographicException(
        "Capability-boundary attestations require a P-256 signing key.");
    }
    return new SignedCapabilityBoundaryAttestation(
      value,
      keyId,
      CapabilityBoundaryAttestationContract.SignaturePurpose,
      Convert.ToBase64String(privateKey.SignData(
        Bytes(value),
        HashAlgorithmName.SHA256,
        DSASignatureFormat.IeeeP1363FixedFieldConcatenation)));
  }

  public static bool Verify(ECDsa key, byte[] data, string signatureBase64)
  {
    try
    {
      var signature = Convert.FromBase64String(signatureBase64);
      try
      {
        return signature.Length == 64
          && Convert.ToBase64String(signature) == signatureBase64
          && EgressBoundaryCanonical.IsExactP256(key)
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
    catch (Exception exception) when (exception is FormatException or CryptographicException)
    {
      return false;
    }
  }

  internal static bool IsValid(CapabilityBoundaryAttestationV1 value)
  {
    if (value.ContractVersion != CapabilityBoundaryAttestationContract.Version
      || !CanonicalGuid(value.AttestationId)
      || !CanonicalGuid(value.RequestId)
      || !CanonicalSha256(value.RequestNonceSha256)
      || !CanonicalGuid(value.DeviceId)
      || !CanonicalGuid(value.SupervisorInstanceId)
      || !CanonicalGuid(value.BootId)
      || !CapabilityBoundaryAttestationContract.Roles.Contains(value.SubjectRole)
      || value.SubjectProcessId <= 0
      || value.SubjectProcessCreationTimeUnixMilliseconds <= 0
      || !CanonicalSha256(value.SubjectImageSha256)
      || (!value.BrowserExternalEffectsEnabled && !value.EmergencyCommandEnabled)
      || !CanonicalSha256(value.CapabilityManifestSha256)
      || !CanonicalSha256(value.DestinationPolicySha256)
      || value.CapabilityCatalogVersion
        != CapabilityBoundaryAttestationContract.CapabilityCatalogVersion
      || value.EgressBoundaryContractVersion != EgressBoundaryCanonical.ContractVersion
      || value.EgressSupervisorProtocolVersion <= 0
      || value.SessionBridgeProtocolVersion <= 0
      || !SafeSid(value.SupervisorServiceSid)
      || !CanonicalSha256(value.SupervisorPipeSecuritySha256)
      || !value.SecureBootEnabled
      || !value.HvciEnabled
      || !value.DriverActive
      || !value.ServiceActive
      || !CanonicalSha256(value.DriverMeasurementSha256)
      || !CanonicalSha256(value.ServiceMeasurementSha256)
      || (value.BrowserBrokerBuildSha256 is not null
        && !CanonicalSha256(value.BrowserBrokerBuildSha256))
      || value.Features.Count is <= 0 or > 20
      || value.IssuedAtUnixMilliseconds <= 0
      || value.ExpiresAtUnixMilliseconds <= value.IssuedAtUnixMilliseconds)
    {
      return false;
    }

    var hasBrowserOrigin = value.Features.Contains(
      EgressBoundaryFeatures.BrowserOriginAttested,
      StringComparer.Ordinal);
    var hasBrowserCompletion = value.Features.Contains(
      EgressBoundaryFeatures.BrowserCompletionAttested,
      StringComparer.Ordinal);
    var commandFeatures = EgressBoundaryFeatures.CommandRequired.All(feature =>
      value.Features.Contains(feature, StringComparer.Ordinal));
    return value.Features.SequenceEqual(
        value.Features.Order(StringComparer.Ordinal),
        StringComparer.Ordinal)
      && value.Features.Distinct(StringComparer.Ordinal).Count() == value.Features.Count
      && value.Features.All(EgressBoundaryFeatures.Allowed.Contains)
      && value.BrowserExternalEffectsEnabled == hasBrowserOrigin
      && value.BrowserExternalEffectsEnabled == hasBrowserCompletion
      && (!value.EmergencyCommandEnabled || commandFeatures)
      && (value.BrowserBrokerBuildSha256 is not null)
        == value.BrowserExternalEffectsEnabled;
  }

  private static bool CanonicalGuid(string value) =>
    Guid.TryParseExact(value, "D", out var parsed)
    && string.Equals(parsed.ToString("D"), value, StringComparison.Ordinal);

  private static bool CanonicalSha256(string? value) => value is { Length: 64 }
    && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');

  private static bool SafeSid(string value) =>
    value.Length is >= 5 and <= 184
    && value.StartsWith("S-1-", StringComparison.Ordinal)
    && value.Skip(1).All(character =>
      char.IsAsciiDigit(character) || character == '-');

  private static string Field(string? value)
  {
    var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? string.Empty));
    return encoded.TrimEnd('=').Replace('+', '-').Replace('/', '_');
  }

  private static string Number(long value) => value.ToString(CultureInfo.InvariantCulture);
}
