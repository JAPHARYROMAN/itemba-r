using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;

namespace Itemba.Msaidizi.Companion.Contracts.Security;

public static class EgressBoundaryFeatures
{
  public const string NetworkEgressEnforced = "network-egress-enforced";
  public const string ProcessTreeAttributed = "process-tree-attributed";
  public const string SignedEgressReceipts = "signed-egress-receipts";
  public const string BrowserOriginAttested = "browser-origin-attested";
  public const string BrowserCompletionAttested = "browser-completion-attested";

  public static IReadOnlyList<string> CommandRequired { get; } =
  [
    NetworkEgressEnforced,
    ProcessTreeAttributed,
    SignedEgressReceipts,
  ];

  public static IReadOnlyList<string> BrowserRequired { get; } =
  [
    BrowserCompletionAttested,
    BrowserOriginAttested,
    NetworkEgressEnforced,
    ProcessTreeAttributed,
    SignedEgressReceipts,
  ];

  public static IReadOnlyList<string> RequiredFor(
    bool browserExternalEffects,
    bool emergencyCommand) =>
    (browserExternalEffects ? BrowserRequired : Array.Empty<string>())
      .Concat(emergencyCommand ? CommandRequired : Array.Empty<string>())
      .Distinct(StringComparer.Ordinal)
      .Order(StringComparer.Ordinal)
      .ToArray();

  internal static IReadOnlySet<string> Allowed { get; } = new HashSet<string>(
  [
    BrowserCompletionAttested,
    BrowserOriginAttested,
    NetworkEgressEnforced,
    ProcessTreeAttributed,
    SignedEgressReceipts,
  ], StringComparer.Ordinal);

  public static bool IsAllowed(string feature) => Allowed.Contains(feature);
}

public sealed record BoundaryAttestationV1(
  int ContractVersion,
  string AttestationId,
  string DeviceId,
  string SupervisorInstanceId,
  string BootId,
  long IssuedAtUnixMilliseconds,
  long ExpiresAtUnixMilliseconds,
  bool SecureBootEnabled,
  bool HvciEnabled,
  bool DriverActive,
  bool ServiceActive,
  string DriverMeasurementSha256,
  string ServiceMeasurementSha256,
  [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)]
  string? BrowserBrokerBuildSha256,
  string ReceiptKeyId,
  string ReceiptPublicKeySpkiBase64,
  string ReceiptPublicKeySha256,
  IReadOnlyList<string> Features);

public sealed record SignedBoundaryAttestation(
  BoundaryAttestationV1 Attestation,
  string KeyId,
  string SignatureBase64);

public sealed record EgressLeaseV1(
  int ContractVersion,
  string LeaseId,
  string AttestationSha256,
  string ActionTokenSha256,
  string ActionId,
  string TaskId,
  string PlanVersionId,
  string StepId,
  string DeviceId,
  string MandateId,
  string CapabilityId,
  string CapabilityVersion,
  int DispatchCount,
  string DestinationPolicySha256,
  string ExecutionIdentitySha256,
  string ArgumentsSha256,
  string? ExpectedPreStateSha256,
  string IdempotencyKeySha256,
  string DestinationScopeSha256,
  string RequestBodySha256,
  string ExactRequestPolicySha256,
  string ReservationDnsAnswerSetSha256,
  long ReservedCapabilityEgressBytes,
  long IssuedAtUnixMilliseconds,
  long ExpiresAtUnixMilliseconds);

public sealed record SignedEgressLease(
  EgressLeaseV1 Lease,
  string KeyId,
  string SignatureBase64);

public sealed record EgressReceiptV1(
  int ContractVersion,
  string ReceiptId,
  string LeaseSha256,
  string AttestationSha256,
  string ActionTokenSha256,
  string ActionId,
  string TaskId,
  string PlanVersionId,
  string StepId,
  string DeviceId,
  string MandateId,
  string CapabilityId,
  string CapabilityVersion,
  int DispatchCount,
  string DestinationPolicySha256,
  string ExecutionIdentitySha256,
  string ArgumentsSha256,
  string? ExpectedPreStateSha256,
  string IdempotencyKeySha256,
  string DestinationScopeSha256,
  string RequestBodySha256,
  string ExactRequestPolicySha256,
  string ReservationDnsAnswerSetSha256,
  string ConnectionDnsAnswerSetSha256,
  string SelectedAddressSha256,
  string RegistrationSha256,
  string DispositionSha256,
  long ReservedCapabilityEgressBytes,
  long MeasuredExternalEgressBytes,
  long UncertainExternalEgressBytes,
  long ChargedExternalEgressBytes,
  long StartedAtUnixMilliseconds,
  long EndedAtUnixMilliseconds,
  long Sequence,
  string FlowLogSha256,
  string Outcome);

public sealed record SignedEgressReceipt(
  EgressReceiptV1 Receipt,
  string KeyId,
  string SignatureBase64);

public sealed record EgressExecutionAuthorization(
  SignedBoundaryAttestation Attestation,
  SignedEgressLease Lease);

public sealed record EgressExecutionEvidence(
  EgressExecutionAuthorization Authorization,
  SignedEgressReceipt Receipt);

public sealed record EgressActionBinding(
  string ActionTokenSha256,
  string ActionId,
  string TaskId,
  string PlanVersionId,
  string StepId,
  string DeviceId,
  string MandateId,
  string CapabilityId,
  string CapabilityVersion,
  int DispatchCount,
  long ReservedCapabilityEgressBytes,
  string DestinationPolicySha256,
  string ExecutionIdentitySha256,
  string ArgumentsSha256,
  string? ExpectedPreStateSha256,
  string IdempotencyKeySha256);

public sealed record EgressBoundaryVerificationSettings(
  string ExpectedDeviceId,
  TimeSpan AllowedClockSkew,
  TimeSpan MaximumAttestationLifetime,
  TimeSpan MaximumLeaseLifetime,
  TimeSpan MaximumReceiptDelay)
{
  public static EgressBoundaryVerificationSettings Strict(string deviceId) => new(
    deviceId,
    TimeSpan.FromSeconds(30),
    TimeSpan.FromMinutes(5),
    TimeSpan.FromMinutes(16),
    TimeSpan.FromMinutes(5));
}

public interface IEgressAttestationKeyResolver
{
  /// <summary>
  /// Resolves a separately enrolled boundary-supervisor signing key. A paired
  /// device identity key must never be returned from this trust store.
  /// </summary>
  bool TryResolve(string keyId, out ECDsa? publicKey);
}

public sealed class VerifiedBoundaryAttestation
{
  internal VerifiedBoundaryAttestation(
    SignedBoundaryAttestation signedAttestation,
    string digestSha256)
  {
    SignedAttestation = signedAttestation;
    DigestSha256 = digestSha256;
  }

  public SignedBoundaryAttestation SignedAttestation { get; }

  public string DigestSha256 { get; }

  public bool IsFresh(DateTimeOffset now)
  {
    var unixMilliseconds = now.ToUnixTimeMilliseconds();
    return SignedAttestation.Attestation.IssuedAtUnixMilliseconds <= unixMilliseconds
      && SignedAttestation.Attestation.ExpiresAtUnixMilliseconds > unixMilliseconds;
  }

  public bool HasAllFeatures(IEnumerable<string> required) => required.All(feature =>
    SignedAttestation.Attestation.Features.Contains(feature, StringComparer.Ordinal));
}

public sealed class VerifiedEgressAuthorization
{
  internal VerifiedEgressAuthorization(
    EgressExecutionAuthorization authorization,
    VerifiedBoundaryAttestation attestation,
    string leaseSha256)
  {
    Authorization = authorization;
    Attestation = attestation;
    LeaseSha256 = leaseSha256;
  }

  public EgressExecutionAuthorization Authorization { get; }

  public VerifiedBoundaryAttestation Attestation { get; }

  public string LeaseSha256 { get; }
}

public sealed class VerifiedEgressReceipt
{
  internal VerifiedEgressReceipt(
    EgressExecutionEvidence evidence,
    VerifiedEgressAuthorization authorization,
    string receiptSha256)
  {
    Evidence = evidence;
    Authorization = authorization;
    ReceiptSha256 = receiptSha256;
  }

  public EgressExecutionEvidence Evidence { get; }

  public VerifiedEgressAuthorization Authorization { get; }

  public string ReceiptSha256 { get; }
}

public sealed record EgressVerificationResult<T>(
  bool IsValid,
  T? Value,
  string? ErrorCode)
  where T : class;

public static class EgressVerificationResult
{
  public static EgressVerificationResult<T> Valid<T>(T value) where T : class =>
    new(true, value, null);

  public static EgressVerificationResult<T> Invalid<T>(string errorCode) where T : class =>
    new(false, null, errorCode);
}

/// <summary>
/// Strict v3 verifier shared by the LocalSystem coordinator and the standard-
/// user session agent. It verifies only signed contracts; it does not claim to
/// implement, emulate, or attest a Windows network boundary.
/// </summary>
public sealed class EgressBoundaryContractVerifier
{
  private readonly EgressBoundaryVerificationSettings _settings;
  private readonly IEgressAttestationKeyResolver _attestationKeys;
  private readonly TimeProvider _timeProvider;

  public EgressBoundaryContractVerifier(
    EgressBoundaryVerificationSettings settings,
    IEgressAttestationKeyResolver attestationKeys,
    TimeProvider? timeProvider = null)
  {
    _settings = settings;
    _attestationKeys = attestationKeys;
    _timeProvider = timeProvider ?? TimeProvider.System;
  }

  public EgressVerificationResult<VerifiedBoundaryAttestation> VerifyAttestation(
    SignedBoundaryAttestation signedAttestation,
    IReadOnlyCollection<string> requiredFeatures)
  {
    var attestation = signedAttestation.Attestation;
    if (!EgressBoundaryCanonical.IsValidAttestation(attestation)
      || !IsSafeKeyId(signedAttestation.KeyId)
      || !string.Equals(attestation.DeviceId, _settings.ExpectedDeviceId,
        StringComparison.Ordinal)
      || !HasFeatures(attestation.Features, requiredFeatures))
    {
      return EgressVerificationResult.Invalid<VerifiedBoundaryAttestation>(
        "egress_attestation_invalid");
    }

    using (var receiptKey = ImportReceiptKey(attestation))
    {
      if (receiptKey is null)
      {
        return EgressVerificationResult.Invalid<VerifiedBoundaryAttestation>(
          "egress_attestation_receipt_key_invalid");
      }
    }

    var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
    var skew = CheckedMilliseconds(_settings.AllowedClockSkew);
    var maximumLifetime = CheckedMilliseconds(_settings.MaximumAttestationLifetime);
    if (attestation.ExpiresAtUnixMilliseconds - attestation.IssuedAtUnixMilliseconds
        > maximumLifetime
      || attestation.IssuedAtUnixMilliseconds > CheckedAdd(now, skew)
      || attestation.ExpiresAtUnixMilliseconds <= CheckedSubtract(now, skew))
    {
      return EgressVerificationResult.Invalid<VerifiedBoundaryAttestation>(
        "egress_attestation_stale");
    }

    if (!_attestationKeys.TryResolve(signedAttestation.KeyId, out var publicKey)
      || publicKey is null)
    {
      return EgressVerificationResult.Invalid<VerifiedBoundaryAttestation>(
        "egress_attestation_key_untrusted");
    }

    using (publicKey)
    {
      if (!EgressBoundaryCanonical.Verify(
        publicKey,
        EgressBoundaryCanonical.AttestationBytes(attestation),
        signedAttestation.SignatureBase64))
      {
        return EgressVerificationResult.Invalid<VerifiedBoundaryAttestation>(
          "egress_attestation_signature_invalid");
      }
    }

    return EgressVerificationResult.Valid(
      new VerifiedBoundaryAttestation(
        signedAttestation,
        EgressBoundaryCanonical.AttestationSha256(attestation)));
  }

  public EgressVerificationResult<VerifiedEgressAuthorization> VerifyAuthorization(
    EgressExecutionAuthorization authorization,
    EgressActionBinding binding,
    IReadOnlyCollection<string> requiredFeatures)
  {
    var verifiedAttestation = VerifyAttestation(authorization.Attestation, requiredFeatures);
    if (!verifiedAttestation.IsValid || verifiedAttestation.Value is null)
    {
      return EgressVerificationResult.Invalid<VerifiedEgressAuthorization>(
        verifiedAttestation.ErrorCode ?? "egress_attestation_invalid");
    }

    var attestation = verifiedAttestation.Value.SignedAttestation.Attestation;
    var lease = authorization.Lease.Lease;
    if (!EgressBoundaryCanonical.IsValidLease(lease)
      || !BindingMatches(lease, binding)
      || !PayloadDigest.FixedTimeEqualsHex(
        lease.AttestationSha256,
        verifiedAttestation.Value.DigestSha256)
      || !string.Equals(authorization.Lease.KeyId, attestation.ReceiptKeyId,
        StringComparison.Ordinal))
    {
      return EgressVerificationResult.Invalid<VerifiedEgressAuthorization>(
        "egress_lease_binding_invalid");
    }

    var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
    var skew = CheckedMilliseconds(_settings.AllowedClockSkew);
    var maximumLifetime = CheckedMilliseconds(_settings.MaximumLeaseLifetime);
    if (lease.ExpiresAtUnixMilliseconds - lease.IssuedAtUnixMilliseconds > maximumLifetime
      || lease.IssuedAtUnixMilliseconds < attestation.IssuedAtUnixMilliseconds
      || lease.ExpiresAtUnixMilliseconds > attestation.ExpiresAtUnixMilliseconds
      || lease.IssuedAtUnixMilliseconds > CheckedAdd(now, skew)
      || lease.ExpiresAtUnixMilliseconds <= CheckedSubtract(now, skew))
    {
      return EgressVerificationResult.Invalid<VerifiedEgressAuthorization>(
        "egress_lease_stale");
    }

    using var receiptKey = ImportReceiptKey(attestation);
    if (receiptKey is null
      || !EgressBoundaryCanonical.Verify(
        receiptKey,
        EgressBoundaryCanonical.LeaseBytes(lease),
        authorization.Lease.SignatureBase64))
    {
      return EgressVerificationResult.Invalid<VerifiedEgressAuthorization>(
        "egress_lease_signature_invalid");
    }

    return EgressVerificationResult.Valid(
      new VerifiedEgressAuthorization(
        authorization,
        verifiedAttestation.Value,
        EgressBoundaryCanonical.LeaseSha256(lease)));
  }

  public EgressVerificationResult<VerifiedEgressReceipt> VerifyReceipt(
    EgressExecutionEvidence evidence,
    EgressActionBinding binding,
    IReadOnlyCollection<string> requiredFeatures)
  {
    var verifiedAuthorization = VerifyAuthorization(
      evidence.Authorization,
      binding,
      requiredFeatures);
    if (!verifiedAuthorization.IsValid || verifiedAuthorization.Value is null)
    {
      return EgressVerificationResult.Invalid<VerifiedEgressReceipt>(
        verifiedAuthorization.ErrorCode ?? "egress_authorization_invalid");
    }

    var attestation = verifiedAuthorization.Value.Attestation.SignedAttestation.Attestation;
    var lease = verifiedAuthorization.Value.Authorization.Lease.Lease;
    var receipt = evidence.Receipt.Receipt;
    if (!EgressBoundaryCanonical.IsValidReceipt(receipt)
      || !ReceiptBindingMatches(receipt, binding)
      || !PayloadDigest.FixedTimeEqualsHex(
        receipt.LeaseSha256,
        verifiedAuthorization.Value.LeaseSha256)
      || !PayloadDigest.FixedTimeEqualsHex(
        receipt.AttestationSha256,
        verifiedAuthorization.Value.Attestation.DigestSha256)
      || !PayloadDigest.FixedTimeEqualsHex(
        receipt.DestinationPolicySha256,
        lease.DestinationPolicySha256)
      || !PayloadDigest.FixedTimeEqualsHex(
        receipt.ExecutionIdentitySha256,
        lease.ExecutionIdentitySha256)
      || !PayloadDigest.FixedTimeEqualsHex(
        receipt.ArgumentsSha256,
        lease.ArgumentsSha256)
      || !OptionalDigestMatches(
        receipt.ExpectedPreStateSha256,
        lease.ExpectedPreStateSha256)
      || !PayloadDigest.FixedTimeEqualsHex(
        receipt.IdempotencyKeySha256,
        lease.IdempotencyKeySha256)
      || !PayloadDigest.FixedTimeEqualsHex(
        receipt.DestinationScopeSha256,
        lease.DestinationScopeSha256)
      || !PayloadDigest.FixedTimeEqualsHex(
        receipt.RequestBodySha256,
        lease.RequestBodySha256)
      || !PayloadDigest.FixedTimeEqualsHex(
        receipt.ExactRequestPolicySha256,
        lease.ExactRequestPolicySha256)
      || !PayloadDigest.FixedTimeEqualsHex(
        receipt.ReservationDnsAnswerSetSha256,
        lease.ReservationDnsAnswerSetSha256)
      || !string.Equals(evidence.Receipt.KeyId, attestation.ReceiptKeyId,
        StringComparison.Ordinal))
    {
      return EgressVerificationResult.Invalid<VerifiedEgressReceipt>(
        "egress_receipt_binding_invalid");
    }

    var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
    var skew = CheckedMilliseconds(_settings.AllowedClockSkew);
    var maximumDelay = CheckedMilliseconds(_settings.MaximumReceiptDelay);
    if (receipt.StartedAtUnixMilliseconds < lease.IssuedAtUnixMilliseconds
      || receipt.EndedAtUnixMilliseconds > CheckedAdd(lease.ExpiresAtUnixMilliseconds, skew)
      || receipt.EndedAtUnixMilliseconds > CheckedAdd(now, skew)
      || CheckedSubtract(now, receipt.EndedAtUnixMilliseconds) > maximumDelay)
    {
      return EgressVerificationResult.Invalid<VerifiedEgressReceipt>(
        "egress_receipt_stale");
    }

    using var receiptKey = ImportReceiptKey(attestation);
    if (receiptKey is null
      || !EgressBoundaryCanonical.Verify(
        receiptKey,
        EgressBoundaryCanonical.ReceiptBytes(receipt),
        evidence.Receipt.SignatureBase64))
    {
      return EgressVerificationResult.Invalid<VerifiedEgressReceipt>(
        "egress_receipt_signature_invalid");
    }

    return EgressVerificationResult.Valid(
      new VerifiedEgressReceipt(
        evidence,
        verifiedAuthorization.Value,
        EgressBoundaryCanonical.ReceiptSha256(receipt)));
  }

  private static bool BindingMatches(EgressLeaseV1 lease, EgressActionBinding binding) =>
    PayloadDigest.FixedTimeEqualsHex(lease.ActionTokenSha256, binding.ActionTokenSha256)
    && Exact(lease.ActionId, binding.ActionId)
    && Exact(lease.TaskId, binding.TaskId)
    && Exact(lease.PlanVersionId, binding.PlanVersionId)
    && Exact(lease.StepId, binding.StepId)
    && Exact(lease.DeviceId, binding.DeviceId)
    && Exact(lease.MandateId, binding.MandateId)
    && Exact(lease.CapabilityId, binding.CapabilityId)
    && Exact(lease.CapabilityVersion, binding.CapabilityVersion)
    && lease.DispatchCount == binding.DispatchCount
    && lease.ReservedCapabilityEgressBytes == binding.ReservedCapabilityEgressBytes
    && PayloadDigest.FixedTimeEqualsHex(
      lease.DestinationPolicySha256,
      binding.DestinationPolicySha256)
    && PayloadDigest.FixedTimeEqualsHex(
      lease.ExecutionIdentitySha256,
      binding.ExecutionIdentitySha256)
    && PayloadDigest.FixedTimeEqualsHex(lease.ArgumentsSha256, binding.ArgumentsSha256)
    && OptionalDigestMatches(
      lease.ExpectedPreStateSha256,
      binding.ExpectedPreStateSha256)
    && PayloadDigest.FixedTimeEqualsHex(
      lease.IdempotencyKeySha256,
      binding.IdempotencyKeySha256);

  private static bool ReceiptBindingMatches(
    EgressReceiptV1 receipt,
    EgressActionBinding binding) =>
    PayloadDigest.FixedTimeEqualsHex(receipt.ActionTokenSha256, binding.ActionTokenSha256)
    && Exact(receipt.ActionId, binding.ActionId)
    && Exact(receipt.TaskId, binding.TaskId)
    && Exact(receipt.PlanVersionId, binding.PlanVersionId)
    && Exact(receipt.StepId, binding.StepId)
    && Exact(receipt.DeviceId, binding.DeviceId)
    && Exact(receipt.MandateId, binding.MandateId)
    && Exact(receipt.CapabilityId, binding.CapabilityId)
    && Exact(receipt.CapabilityVersion, binding.CapabilityVersion)
    && receipt.DispatchCount == binding.DispatchCount
    && receipt.ReservedCapabilityEgressBytes == binding.ReservedCapabilityEgressBytes
    && PayloadDigest.FixedTimeEqualsHex(
      receipt.DestinationPolicySha256,
      binding.DestinationPolicySha256)
    && PayloadDigest.FixedTimeEqualsHex(
      receipt.ExecutionIdentitySha256,
      binding.ExecutionIdentitySha256)
    && PayloadDigest.FixedTimeEqualsHex(
      receipt.ArgumentsSha256,
      binding.ArgumentsSha256)
    && OptionalDigestMatches(
      receipt.ExpectedPreStateSha256,
      binding.ExpectedPreStateSha256)
    && PayloadDigest.FixedTimeEqualsHex(
      receipt.IdempotencyKeySha256,
      binding.IdempotencyKeySha256);

  private static bool OptionalDigestMatches(string? left, string? right) =>
    left is null || right is null
      ? left is null && right is null
      : PayloadDigest.FixedTimeEqualsHex(left, right);

  private static bool HasFeatures(
    IReadOnlyList<string> actual,
    IReadOnlyCollection<string> required)
  {
    var expected = required.Order(StringComparer.Ordinal).ToArray();
    return expected.Length == actual.Count
      && expected.Distinct(StringComparer.Ordinal).Count() == expected.Length
      && actual.SequenceEqual(expected, StringComparer.Ordinal);
  }

  private static ECDsa? ImportReceiptKey(BoundaryAttestationV1 attestation)
  {
    try
    {
      var subjectPublicKeyInfo = Convert.FromBase64String(
        attestation.ReceiptPublicKeySpkiBase64);
      try
      {
        if (!PayloadDigest.FixedTimeEqualsHex(
          attestation.ReceiptPublicKeySha256,
          Convert.ToHexString(SHA256.HashData(subjectPublicKeyInfo)).ToLowerInvariant()))
        {
          return null;
        }

        var key = ECDsa.Create();
        try
        {
          key.ImportSubjectPublicKeyInfo(subjectPublicKeyInfo, out var bytesRead);
          if (bytesRead != subjectPublicKeyInfo.Length
            || !EgressBoundaryCanonical.IsExactP256(key))
          {
            key.Dispose();
            return null;
          }
          return key;
        }
        catch
        {
          key.Dispose();
          throw;
        }
      }
      finally
      {
        CryptographicOperations.ZeroMemory(subjectPublicKeyInfo);
      }
    }
    catch (Exception exception) when (exception is FormatException or CryptographicException)
    {
      return null;
    }
  }

  private static bool Exact(string left, string right) =>
    string.Equals(left, right, StringComparison.Ordinal);

  private static bool IsSafeKeyId(string value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 128
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_' or ':');

  private static long CheckedMilliseconds(TimeSpan value)
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

  private static long CheckedAdd(long left, long right)
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

  private static long CheckedSubtract(long left, long right)
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

public static class EgressBoundaryCanonical
{
  public const int ContractVersion = 4;
  private const string AttestationDomain = "MSAIDIZI-EGRESS-BOUNDARY-ATTESTATION-V4";
  private const string LeaseDomain = "MSAIDIZI-EGRESS-AUTHORIZATION-LEASE-V4";
  private const string ReceiptDomain = "MSAIDIZI-EGRESS-RECEIPT-V4";
  private const string EvidenceDomain = "MSAIDIZI-EGRESS-EVIDENCE-BUNDLE-V4";
  private static readonly HashSet<string> ReceiptOutcomes = new(
    ["cancelled", "completed", "failed", "unknown"],
    StringComparer.Ordinal);
  private static readonly string ZeroSha256 = new('0', 64);

  public static byte[] AttestationBytes(BoundaryAttestationV1 value)
  {
    var fields = new List<string>
    {
      AttestationDomain,
      Number(value.ContractVersion),
      Field(value.AttestationId),
      Field(value.DeviceId),
      Field(value.SupervisorInstanceId),
      Field(value.BootId),
      Number(value.IssuedAtUnixMilliseconds),
      Number(value.ExpiresAtUnixMilliseconds),
      Number(value.SecureBootEnabled ? 1 : 0),
      Number(value.HvciEnabled ? 1 : 0),
      Number(value.DriverActive ? 1 : 0),
      Number(value.ServiceActive ? 1 : 0),
      Field(value.DriverMeasurementSha256),
      Field(value.ServiceMeasurementSha256),
      Field(value.BrowserBrokerBuildSha256),
      Field(value.ReceiptKeyId),
      Field(value.ReceiptPublicKeySpkiBase64),
      Field(value.ReceiptPublicKeySha256),
    };
    fields.AddRange(value.Features.Select(Field));
    return Encoding.UTF8.GetBytes(string.Join('\n', fields));
  }

  public static byte[] LeaseBytes(EgressLeaseV1 value) => Encoding.UTF8.GetBytes(string.Join('\n',
    LeaseDomain,
    Number(value.ContractVersion),
    Field(value.LeaseId),
    Field(value.AttestationSha256),
    Field(value.ActionTokenSha256),
    Field(value.ActionId),
    Field(value.TaskId),
    Field(value.PlanVersionId),
    Field(value.StepId),
    Field(value.DeviceId),
    Field(value.MandateId),
    Field(value.CapabilityId),
    Field(value.CapabilityVersion),
    Number(value.DispatchCount),
    Field(value.DestinationPolicySha256),
    Field(value.ExecutionIdentitySha256),
    Field(value.ArgumentsSha256),
    Field(value.ExpectedPreStateSha256 ?? string.Empty),
    Field(value.IdempotencyKeySha256),
    Field(value.DestinationScopeSha256),
    Field(value.RequestBodySha256),
    Field(value.ExactRequestPolicySha256),
    Field(value.ReservationDnsAnswerSetSha256),
    Number(value.ReservedCapabilityEgressBytes),
    Number(value.IssuedAtUnixMilliseconds),
    Number(value.ExpiresAtUnixMilliseconds)));

  public static byte[] ReceiptBytes(EgressReceiptV1 value) => Encoding.UTF8.GetBytes(string.Join('\n',
    ReceiptDomain,
    Number(value.ContractVersion),
    Field(value.ReceiptId),
    Field(value.LeaseSha256),
    Field(value.AttestationSha256),
    Field(value.ActionTokenSha256),
    Field(value.ActionId),
    Field(value.TaskId),
    Field(value.PlanVersionId),
    Field(value.StepId),
    Field(value.DeviceId),
    Field(value.MandateId),
    Field(value.CapabilityId),
    Field(value.CapabilityVersion),
    Number(value.DispatchCount),
    Field(value.DestinationPolicySha256),
    Field(value.ExecutionIdentitySha256),
    Field(value.ArgumentsSha256),
    Field(value.ExpectedPreStateSha256 ?? string.Empty),
    Field(value.IdempotencyKeySha256),
    Field(value.DestinationScopeSha256),
    Field(value.RequestBodySha256),
    Field(value.ExactRequestPolicySha256),
    Field(value.ReservationDnsAnswerSetSha256),
    Field(value.ConnectionDnsAnswerSetSha256),
    Field(value.SelectedAddressSha256),
    Field(value.RegistrationSha256),
    Field(value.DispositionSha256),
    Number(value.ReservedCapabilityEgressBytes),
    Number(value.MeasuredExternalEgressBytes),
    Number(value.UncertainExternalEgressBytes),
    Number(value.ChargedExternalEgressBytes),
    Number(value.StartedAtUnixMilliseconds),
    Number(value.EndedAtUnixMilliseconds),
    Number(value.Sequence),
    Field(value.FlowLogSha256),
    Field(value.Outcome)));

  public static byte[] EvidenceBytes(
    string actionTokenSha256,
    EgressExecutionEvidence value) => Encoding.UTF8.GetBytes(string.Join('\n',
      EvidenceDomain,
      Field(actionTokenSha256),
      Field(AttestationSha256(value.Authorization.Attestation.Attestation)),
      Field(value.Authorization.Attestation.KeyId),
      Field(value.Authorization.Attestation.SignatureBase64),
      Field(LeaseSha256(value.Authorization.Lease.Lease)),
      Field(value.Authorization.Lease.KeyId),
      Field(value.Authorization.Lease.SignatureBase64),
      Field(ReceiptSha256(value.Receipt.Receipt)),
      Field(value.Receipt.KeyId),
      Field(value.Receipt.SignatureBase64)));

  public static string AttestationSha256(BoundaryAttestationV1 value) =>
    Digest(AttestationBytes(value));

  public static string LeaseSha256(EgressLeaseV1 value) => Digest(LeaseBytes(value));

  public static string ReceiptSha256(EgressReceiptV1 value) => Digest(ReceiptBytes(value));

  public static string EvidenceSha256(
    string actionTokenSha256,
    EgressExecutionEvidence value) => Digest(EvidenceBytes(actionTokenSha256, value));

  public static SignedBoundaryAttestation SignAttestation(
    BoundaryAttestationV1 value,
    string keyId,
    ECDsa privateKey) => new(
      value,
      keyId,
      Sign(privateKey, AttestationBytes(value)));

  public static SignedEgressLease SignLease(
    EgressLeaseV1 value,
    string keyId,
    ECDsa privateKey) => new(value, keyId, Sign(privateKey, LeaseBytes(value)));

  public static SignedEgressReceipt SignReceipt(
    EgressReceiptV1 value,
    string keyId,
    ECDsa privateKey) => new(value, keyId, Sign(privateKey, ReceiptBytes(value)));

  internal static bool IsValidAttestation(BoundaryAttestationV1 value)
  {
    if (value.ContractVersion != ContractVersion
      || !CanonicalGuid(value.AttestationId)
      || !CanonicalGuid(value.DeviceId)
      || !CanonicalGuid(value.SupervisorInstanceId)
      || !CanonicalGuid(value.BootId)
      || value.IssuedAtUnixMilliseconds <= 0
      || value.ExpiresAtUnixMilliseconds <= value.IssuedAtUnixMilliseconds
      || !value.SecureBootEnabled
      || !value.HvciEnabled
      || !value.DriverActive
      || !value.ServiceActive
      || !CanonicalSha256(value.DriverMeasurementSha256)
      || !CanonicalSha256(value.ServiceMeasurementSha256)
      || (value.BrowserBrokerBuildSha256 is not null
        && !CanonicalSha256(value.BrowserBrokerBuildSha256))
      || !SafeKeyId(value.ReceiptKeyId)
      || string.IsNullOrWhiteSpace(value.ReceiptPublicKeySpkiBase64)
      || value.ReceiptPublicKeySpkiBase64.Length > 2_048
      || !CanonicalSha256(value.ReceiptPublicKeySha256)
      || value.Features.Count is <= 0 or > 20)
    {
      return false;
    }

    var expected = value.Features.Order(StringComparer.Ordinal).ToArray();
    return value.Features.SequenceEqual(expected, StringComparer.Ordinal)
      && value.Features.Distinct(StringComparer.Ordinal).Count() == value.Features.Count
      && value.Features.All(EgressBoundaryFeatures.Allowed.Contains)
      && (value.BrowserBrokerBuildSha256 is not null)
        == (value.Features.Contains(EgressBoundaryFeatures.BrowserOriginAttested,
            StringComparer.Ordinal)
          && value.Features.Contains(EgressBoundaryFeatures.BrowserCompletionAttested,
            StringComparer.Ordinal))
      && value.Features.Contains(EgressBoundaryFeatures.BrowserOriginAttested,
          StringComparer.Ordinal)
        == value.Features.Contains(EgressBoundaryFeatures.BrowserCompletionAttested,
          StringComparer.Ordinal);
  }

  internal static bool IsValidLease(EgressLeaseV1 value) =>
    value.ContractVersion == ContractVersion
    && CanonicalGuid(value.LeaseId)
    && CanonicalSha256(value.AttestationSha256)
    && CanonicalSha256(value.ActionTokenSha256)
    && CanonicalGuid(value.ActionId)
    && CanonicalGuid(value.TaskId)
    && CanonicalGuid(value.PlanVersionId)
    && CanonicalGuid(value.StepId)
    && CanonicalGuid(value.DeviceId)
    && CanonicalGuid(value.MandateId)
    && SafeCapabilityId(value.CapabilityId)
    && SafeCapabilityVersion(value.CapabilityVersion)
    && value.DispatchCount is >= 1 and <= 16
    && CanonicalSha256(value.DestinationPolicySha256)
    && CanonicalSha256(value.ExecutionIdentitySha256)
    && CanonicalSha256(value.ArgumentsSha256)
    && (value.ExpectedPreStateSha256 is null
      || CanonicalSha256(value.ExpectedPreStateSha256))
    && CanonicalSha256(value.IdempotencyKeySha256)
    && CanonicalSha256(value.DestinationScopeSha256)
    && CanonicalSha256(value.RequestBodySha256)
    && CanonicalSha256(value.ExactRequestPolicySha256)
    && CanonicalSha256(value.ReservationDnsAnswerSetSha256)
    && !string.Equals(value.ReservationDnsAnswerSetSha256, ZeroSha256,
      StringComparison.Ordinal)
    && value.ReservedCapabilityEgressBytes >= 0
    && value.IssuedAtUnixMilliseconds > 0
    && value.ExpiresAtUnixMilliseconds > value.IssuedAtUnixMilliseconds;

  internal static bool IsValidReceipt(EgressReceiptV1 value)
  {
    if (value.ContractVersion != ContractVersion
      || !CanonicalGuid(value.ReceiptId)
      || !CanonicalSha256(value.LeaseSha256)
      || !CanonicalSha256(value.AttestationSha256)
      || !CanonicalSha256(value.ActionTokenSha256)
      || !CanonicalGuid(value.ActionId)
      || !CanonicalGuid(value.TaskId)
      || !CanonicalGuid(value.PlanVersionId)
      || !CanonicalGuid(value.StepId)
      || !CanonicalGuid(value.DeviceId)
      || !CanonicalGuid(value.MandateId)
      || !SafeCapabilityId(value.CapabilityId)
      || !SafeCapabilityVersion(value.CapabilityVersion)
      || value.DispatchCount is < 1 or > 16
      || !CanonicalSha256(value.DestinationPolicySha256)
      || !CanonicalSha256(value.ExecutionIdentitySha256)
      || !CanonicalSha256(value.ArgumentsSha256)
      || (value.ExpectedPreStateSha256 is not null
        && !CanonicalSha256(value.ExpectedPreStateSha256))
      || !CanonicalSha256(value.IdempotencyKeySha256)
      || !CanonicalSha256(value.DestinationScopeSha256)
      || !CanonicalSha256(value.RequestBodySha256)
      || !CanonicalSha256(value.ExactRequestPolicySha256)
      || !CanonicalSha256(value.ReservationDnsAnswerSetSha256)
      || string.Equals(value.ReservationDnsAnswerSetSha256, ZeroSha256,
        StringComparison.Ordinal)
      || !CanonicalSha256(value.ConnectionDnsAnswerSetSha256)
      || !CanonicalSha256(value.SelectedAddressSha256)
      || !CanonicalSha256(value.RegistrationSha256)
      || !CanonicalSha256(value.DispositionSha256)
      || value.ReservedCapabilityEgressBytes < 0
      || value.MeasuredExternalEgressBytes < 0
      || value.UncertainExternalEgressBytes < 0
      || value.ChargedExternalEgressBytes < 0
      || value.StartedAtUnixMilliseconds <= 0
      || value.EndedAtUnixMilliseconds < value.StartedAtUnixMilliseconds
      || value.Sequence <= 0
      || !CanonicalSha256(value.FlowLogSha256)
      || !ReceiptOutcomes.Contains(value.Outcome))
    {
      return false;
    }

    try
    {
      var connectionMissing = string.Equals(
        value.ConnectionDnsAnswerSetSha256,
        ZeroSha256,
        StringComparison.Ordinal);
      var selectedMissing = string.Equals(
        value.SelectedAddressSha256,
        ZeroSha256,
        StringComparison.Ordinal);
      return (!connectionMissing && !selectedMissing
          ? PayloadDigest.FixedTimeEqualsHex(
            value.ReservationDnsAnswerSetSha256,
            value.ConnectionDnsAnswerSetSha256)
          : connectionMissing && selectedMissing
            && string.Equals(value.Outcome, "unknown", StringComparison.Ordinal))
        && checked(value.MeasuredExternalEgressBytes + value.UncertainExternalEgressBytes)
          == value.ChargedExternalEgressBytes
        && value.ChargedExternalEgressBytes <= value.ReservedCapabilityEgressBytes
        && (!string.Equals(value.Outcome, "unknown", StringComparison.Ordinal)
          || value.ChargedExternalEgressBytes == value.ReservedCapabilityEgressBytes);
    }
    catch (OverflowException)
    {
      return false;
    }
  }

  internal static bool Verify(ECDsa key, byte[] data, string signatureBase64)
  {
    try
    {
      var signature = Convert.FromBase64String(signatureBase64);
      try
      {
        return signature.Length == 64
          && Convert.ToBase64String(signature) == signatureBase64
          && IsExactP256(key)
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

  private static bool CanonicalSha256(string? value) => value is { Length: 64 }
    && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');

  private static string Sign(ECDsa key, byte[] data)
  {
    if (!IsExactP256(key))
    {
      throw new CryptographicException("Egress contracts require a P-256 signing key.");
    }
    return Convert.ToBase64String(key.SignData(
      data,
      HashAlgorithmName.SHA256,
      DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
  }

  private static string Digest(byte[] data) =>
    Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();

  public static bool IsExactP256(ECDsa key)
  {
    var parameters = key.ExportParameters(includePrivateParameters: false);
    return key.KeySize == 256
      && string.Equals(
        parameters.Curve.Oid.Value,
        ECCurve.NamedCurves.nistP256.Oid.Value,
        StringComparison.Ordinal);
  }

  private static string Field(string? value)
  {
    var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? string.Empty));
    return encoded.TrimEnd('=').Replace('+', '-').Replace('/', '_');
  }

  private static string Number(long value) => value.ToString(CultureInfo.InvariantCulture);

  private static bool CanonicalGuid(string value) => Guid.TryParseExact(value, "D", out var parsed)
    && string.Equals(parsed.ToString("D"), value, StringComparison.Ordinal);

  private static bool SafeKeyId(string value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 128
    && char.IsAsciiLetterOrDigit(value[0])
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_' or ':');

  private static bool SafeCapabilityId(string value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 160
    && char.IsAsciiLetterOrDigit(value[0])
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_' or ':' or '/');

  private static bool SafeCapabilityVersion(string value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 64
    && char.IsAsciiLetterOrDigit(value[0])
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '+' or '-' or '_');
}
