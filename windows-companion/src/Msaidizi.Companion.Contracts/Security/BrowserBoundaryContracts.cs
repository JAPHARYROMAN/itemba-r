using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Itemba.Msaidizi.Companion.Contracts.Security;

/// <summary>
/// Source contract for the independently observed managed-browser boundary.
/// This contract grants no capability by itself. Production activation still
/// requires an independently measured broker, network boundary, and signed
/// boundary posture carrying every <see cref="EgressBoundaryFeatures.BrowserRequired"/>
/// feature.
/// </summary>
public static class ManagedBrowserBoundaryContract
{
  public const int Version = 1;
  public const string CapabilityId = "browser.managed.navigate";
  public const string CapabilityVersion = "1.0.0";

  public const string NavigationStarting = "navigation-starting";
  public const string Redirect = "redirect";
  public const string SourceChanged = "source-changed";
  public const string NavigationCompleted = "navigation-completed";

  public const string CompletionNotApplicable = "not-applicable";
  public const string CompletionSucceeded = "succeeded";

  public const int MaximumRedirects = 64;
  public const int MaximumEvents = MaximumRedirects + 3;
}

public sealed record BrowserActionPolicyV1(
  int ContractVersion,
  string CapabilityId,
  string CapabilityVersion,
  string OriginId,
  string ExpectedOriginSha256,
  string ExpectedTargetUriSha256,
  string ExpectedServerCertificateSha256,
  string RelativePathSha256,
  string DestinationScopeSha256,
  string ArgumentsSha256,
  string ExpectedPreStateSha256,
  string IdempotencyKeySha256);

public sealed record BrowserBrokerIdentityV1(
  int ContractVersion,
  int WindowsSessionId,
  int ProcessId,
  long ProcessCreationTimeUnixMilliseconds,
  string ImageSha256,
  string BuildSha256);

/// <summary>
/// Evidence returned by the independently trusted provider after it has
/// observed and pinned the exact action-scoped broker. The caller-provided
/// registration is only an expectation and cannot create this evidence.
/// </summary>
public sealed record BrowserBoundaryRegistrationEvidenceV1(
  int ContractVersion,
  string ProviderSessionId,
  string LeaseSha256,
  string RegistrationSha256,
  string ActionPolicySha256,
  BrowserBrokerIdentityV1 BrokerIdentity,
  string CompletionChallengeSha256,
  long ObservedAtUnixMilliseconds);

public sealed record BrowserNavigationObservationV1(
  int ContractVersion,
  int Sequence,
  string EventKind,
  long NavigationId,
  bool IsTopLevel,
  string OriginSha256,
  string UriSha256,
  string CompletionStatus,
  long ObservedAtUnixMilliseconds);

/// <summary>
/// Provider-owned terminal observation. No equivalent record is accepted from
/// the Companion or tray process. A successful record proves only exact
/// authorized top-level navigation completion; it never proves a purchase,
/// form submission, publication, upload, download, or other remote mutation.
/// </summary>
public sealed record BrowserBoundaryCompletionEvidenceV1(
  int ContractVersion,
  string ProviderSessionId,
  string LeaseSha256,
  string RegistrationSha256,
  string ActionPolicySha256,
  string CompletionChallengeSha256,
  IReadOnlyList<BrowserNavigationObservationV1> Events,
  string ConnectionDnsAnswerSetSha256,
  string SelectedAddressSha256,
  string ObservedServerCertificateSha256,
  long MeasuredExternalEgressBytes,
  bool MeasurementUncertain,
  long ObservedAtUnixMilliseconds);

/// <summary>
/// Strict, length-delimited canonicalization shared by the supervisor and
/// provider. Raw URLs never enter a durable record; only exact SHA-256 bindings
/// and bounded event metadata are canonicalized. Certificate digests are over
/// the DER-encoded leaf certificate observed by the independent provider.
/// </summary>
public static class BrowserBoundaryCanonical
{
  private const string ActionPolicyDomain = "MSAIDIZI-BROWSER-ACTION-POLICY-V1";
  private const string BrokerIdentityDomain = "MSAIDIZI-BROWSER-BROKER-IDENTITY-V1";
  private const string RegistrationEvidenceDomain =
    "MSAIDIZI-BROWSER-REGISTRATION-EVIDENCE-V1";
  private const string ObservationDomain = "MSAIDIZI-BROWSER-NAVIGATION-OBSERVATION-V1";
  private const string EventLogDomain = "MSAIDIZI-BROWSER-EVENT-LOG-V1";

  public static string ActionPolicySha256(BrowserActionPolicyV1 value) => Hash(
    ActionPolicyDomain,
    Number(value.ContractVersion),
    value.CapabilityId,
    value.CapabilityVersion,
    value.OriginId,
    value.ExpectedOriginSha256,
    value.ExpectedTargetUriSha256,
    value.ExpectedServerCertificateSha256,
    value.RelativePathSha256,
    value.DestinationScopeSha256,
    value.ArgumentsSha256,
    value.ExpectedPreStateSha256,
    value.IdempotencyKeySha256);

  public static string BrokerIdentitySha256(BrowserBrokerIdentityV1 value) => Hash(
    BrokerIdentityDomain,
    Number(value.ContractVersion),
    Number(value.WindowsSessionId),
    Number(value.ProcessId),
    Number(value.ProcessCreationTimeUnixMilliseconds),
    value.ImageSha256,
    value.BuildSha256);

  public static string RegistrationEvidenceSha256(
    BrowserBoundaryRegistrationEvidenceV1 value) => Hash(
      RegistrationEvidenceDomain,
      Number(value.ContractVersion),
      value.ProviderSessionId,
      value.LeaseSha256,
      value.RegistrationSha256,
      value.ActionPolicySha256,
      BrokerIdentitySha256(value.BrokerIdentity),
      value.CompletionChallengeSha256,
      Number(value.ObservedAtUnixMilliseconds));

  public static string ObservationSha256(BrowserNavigationObservationV1 value) => Hash(
    ObservationDomain,
    Number(value.ContractVersion),
    Number(value.Sequence),
    value.EventKind,
    Number(value.NavigationId),
    Boolean(value.IsTopLevel),
    value.OriginSha256,
    value.UriSha256,
    value.CompletionStatus,
    Number(value.ObservedAtUnixMilliseconds));

  /// <summary>
  /// Replay key intentionally excludes sequence and timestamp so a caller
  /// cannot disguise the same semantic browser event by renumbering it.
  /// </summary>
  public static string ObservationSemanticSha256(
    BrowserNavigationObservationV1 value) => Hash(
      "MSAIDIZI-BROWSER-NAVIGATION-SEMANTIC-V1",
      Number(value.ContractVersion),
      value.EventKind,
      Number(value.NavigationId),
      Boolean(value.IsTopLevel),
      value.OriginSha256,
      value.UriSha256,
      value.CompletionStatus);

  /// <summary>
  /// Digest placed in the existing signed egress receipt's flowLogSha256. It
  /// binds the provider session, challenge, ordered observations, route, and
  /// independently measured byte count without changing receipt contract v4.
  /// </summary>
  public static string EventLogSha256(
    BrowserBoundaryRegistrationEvidenceV1 registration,
    BrowserBoundaryCompletionEvidenceV1 completion)
  {
    var fields = new List<string>(completion.Events.Count + 12)
    {
      RegistrationEvidenceSha256(registration),
      Number(completion.ContractVersion),
      completion.ProviderSessionId,
      completion.LeaseSha256,
      completion.RegistrationSha256,
      completion.ActionPolicySha256,
      completion.CompletionChallengeSha256,
      completion.ConnectionDnsAnswerSetSha256,
      completion.SelectedAddressSha256,
      completion.ObservedServerCertificateSha256,
      Number(completion.MeasuredExternalEgressBytes),
      Boolean(completion.MeasurementUncertain),
      Number(completion.ObservedAtUnixMilliseconds),
      Number(completion.Events.Count),
    };
    fields.AddRange(completion.Events.Select(ObservationSha256));
    return Hash(EventLogDomain, [.. fields]);
  }

  private static string Hash(string domain, params string[] fields)
  {
    var canonical = string.Join('\n', new[] { domain }.Concat(fields.Select(Field)));
    var bytes = Encoding.UTF8.GetBytes(canonical);
    try
    {
      return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }
    finally
    {
      CryptographicOperations.ZeroMemory(bytes);
    }
  }

  private static string Field(string value) => $"{Encoding.UTF8.GetByteCount(value)}:{value}";

  private static string Number(long value) => value.ToString(CultureInfo.InvariantCulture);

  private static string Boolean(bool value) => value ? "true" : "false";
}

public static class BrowserBoundaryContractValidator
{
  private static readonly HashSet<string> EventKinds = new(
  [
    ManagedBrowserBoundaryContract.NavigationStarting,
    ManagedBrowserBoundaryContract.Redirect,
    ManagedBrowserBoundaryContract.SourceChanged,
    ManagedBrowserBoundaryContract.NavigationCompleted,
  ], StringComparer.Ordinal);

  public static bool IsActionPolicyValid(BrowserActionPolicyV1 value) => value is not null
    && value.ContractVersion == ManagedBrowserBoundaryContract.Version
    && string.Equals(
      value.CapabilityId,
      ManagedBrowserBoundaryContract.CapabilityId,
      StringComparison.Ordinal)
    && string.Equals(
      value.CapabilityVersion,
      ManagedBrowserBoundaryContract.CapabilityVersion,
      StringComparison.Ordinal)
    && IsSafeId(value.OriginId, 80)
    && IsSha256(value.ExpectedOriginSha256)
    && IsSha256(value.ExpectedTargetUriSha256)
    && IsSha256(value.ExpectedServerCertificateSha256)
    && IsSha256(value.RelativePathSha256)
    && IsSha256(value.DestinationScopeSha256)
    && IsSha256(value.ArgumentsSha256)
    && IsSha256(value.ExpectedPreStateSha256)
    && IsSha256(value.IdempotencyKeySha256);

  public static bool IsBrokerIdentityValid(BrowserBrokerIdentityV1 value) => value is not null
    && value.ContractVersion == ManagedBrowserBoundaryContract.Version
    && value.WindowsSessionId > 0
    && value.ProcessId > 0
    && value.ProcessCreationTimeUnixMilliseconds > 0
    && IsSha256(value.ImageSha256)
    && IsSha256(value.BuildSha256);

  public static bool IsRegistrationEvidenceValid(
    BrowserBoundaryRegistrationEvidenceV1 value) => value is not null
      && value.ContractVersion == ManagedBrowserBoundaryContract.Version
      && Guid.TryParseExact(value.ProviderSessionId, "D", out _)
      && IsSha256(value.LeaseSha256)
      && IsSha256(value.RegistrationSha256)
      && IsSha256(value.ActionPolicySha256)
      && IsBrokerIdentityValid(value.BrokerIdentity)
      && IsSha256(value.CompletionChallengeSha256)
      && !FixedTimeHex(value.CompletionChallengeSha256, new string('0', 64))
      && value.ObservedAtUnixMilliseconds > 0;

  public static bool TryValidateSuccessfulCompletion(
    BrowserActionPolicyV1 policy,
    BrowserBoundaryRegistrationEvidenceV1 registration,
    BrowserBoundaryCompletionEvidenceV1 completion,
    out string errorCode)
  {
    errorCode = "browser_completion_evidence_invalid";
    if (!IsActionPolicyValid(policy)
      || !IsRegistrationEvidenceValid(registration)
      || !FixedTimeHex(
        registration.ActionPolicySha256,
        BrowserBoundaryCanonical.ActionPolicySha256(policy))
      || completion is null
      || completion.ContractVersion != ManagedBrowserBoundaryContract.Version
      || !string.Equals(
        completion.ProviderSessionId,
        registration.ProviderSessionId,
        StringComparison.Ordinal)
      || !FixedTimeHex(completion.LeaseSha256, registration.LeaseSha256)
      || !FixedTimeHex(completion.RegistrationSha256, registration.RegistrationSha256)
      || !FixedTimeHex(completion.ActionPolicySha256, registration.ActionPolicySha256)
      || !FixedTimeHex(
        completion.CompletionChallengeSha256,
        registration.CompletionChallengeSha256)
      || !IsSha256(completion.ConnectionDnsAnswerSetSha256)
      || !IsSha256(completion.SelectedAddressSha256)
      || !IsSha256(completion.ObservedServerCertificateSha256)
      || !FixedTimeHex(
        completion.ObservedServerCertificateSha256,
        policy.ExpectedServerCertificateSha256)
      || FixedTimeHex(completion.SelectedAddressSha256, new string('0', 64))
      || completion.MeasuredExternalEgressBytes < 0
      || completion.MeasurementUncertain
      || completion.ObservedAtUnixMilliseconds < registration.ObservedAtUnixMilliseconds
      || completion.Events is null
      || completion.Events.Count is < 3 or > ManagedBrowserBoundaryContract.MaximumEvents)
    {
      return false;
    }

    var navigationId = completion.Events[0].NavigationId;
    var observedAt = registration.ObservedAtUnixMilliseconds;
    var seen = new HashSet<string>(StringComparer.Ordinal);
    var phase = 0;
    for (var index = 0; index < completion.Events.Count; index++)
    {
      var observation = completion.Events[index];
      if (observation.ContractVersion != ManagedBrowserBoundaryContract.Version
        || observation.Sequence != index + 1
        || !EventKinds.Contains(observation.EventKind)
        || observation.NavigationId <= 0
        || observation.NavigationId != navigationId
        || !observation.IsTopLevel
        || !FixedTimeHex(observation.OriginSha256, policy.ExpectedOriginSha256)
        || !IsSha256(observation.UriSha256)
        || observation.ObservedAtUnixMilliseconds < observedAt
        || observation.ObservedAtUnixMilliseconds > completion.ObservedAtUnixMilliseconds
        || !seen.Add(BrowserBoundaryCanonical.ObservationSemanticSha256(observation)))
      {
        return false;
      }
      observedAt = observation.ObservedAtUnixMilliseconds;

      if (index == 0)
      {
        if (observation.EventKind != ManagedBrowserBoundaryContract.NavigationStarting
          || observation.CompletionStatus
            != ManagedBrowserBoundaryContract.CompletionNotApplicable
          || !FixedTimeHex(observation.UriSha256, policy.ExpectedTargetUriSha256))
        {
          return false;
        }
        phase = 1;
        continue;
      }

      if (observation.EventKind == ManagedBrowserBoundaryContract.Redirect && phase == 1)
      {
        if (observation.CompletionStatus
          != ManagedBrowserBoundaryContract.CompletionNotApplicable)
        {
          return false;
        }
        continue;
      }
      if (observation.EventKind == ManagedBrowserBoundaryContract.SourceChanged && phase == 1)
      {
        if (observation.CompletionStatus
            != ManagedBrowserBoundaryContract.CompletionNotApplicable
          || !FixedTimeHex(observation.UriSha256, policy.ExpectedTargetUriSha256))
        {
          return false;
        }
        phase = 2;
        continue;
      }
      if (observation.EventKind == ManagedBrowserBoundaryContract.NavigationCompleted
        && phase == 2
        && index == completion.Events.Count - 1
        && observation.CompletionStatus == ManagedBrowserBoundaryContract.CompletionSucceeded
        && FixedTimeHex(observation.UriSha256, policy.ExpectedTargetUriSha256))
      {
        phase = 3;
        continue;
      }
      return false;
    }

    if (phase != 3)
    {
      return false;
    }
    errorCode = string.Empty;
    return true;
  }

  public static bool IsSha256(string value) => value is { Length: 64 }
    && string.Equals(value, value.ToLowerInvariant(), StringComparison.Ordinal)
    && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');

  private static bool IsSafeId(string value, int maximumLength) => !string.IsNullOrWhiteSpace(value)
    && value.Length <= maximumLength
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '_' or '-');

  private static bool FixedTimeHex(string actual, string expected)
  {
    if (!IsSha256(actual) || !IsSha256(expected))
    {
      return false;
    }
    var actualBytes = Convert.FromHexString(actual);
    var expectedBytes = Convert.FromHexString(expected);
    try
    {
      return CryptographicOperations.FixedTimeEquals(actualBytes, expectedBytes);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(actualBytes);
      CryptographicOperations.ZeroMemory(expectedBytes);
    }
  }
}
