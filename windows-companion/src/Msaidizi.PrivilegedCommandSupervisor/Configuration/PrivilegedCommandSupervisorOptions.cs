using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Security;
using System.Security.Cryptography;
using System.Security.Principal;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Configuration;

public sealed record PrivilegedCommandSupervisorOptions
{
  public const string SectionName = "PrivilegedCommandSupervisor";

  public bool Enabled { get; init; }

  public string DeviceId { get; init; } = string.Empty;

  public string SupervisorInstanceId { get; init; } = string.Empty;

  public string SupervisorServiceSid { get; init; } = string.Empty;

  public string PipeName { get; init; } = "Itemba.Msaidizi.PrivilegedCommandIsolation.v2";

  public string StateRoot { get; init; } = string.Empty;

  public string JournalPath { get; init; } = string.Empty;

  public string KillSwitchPath { get; init; } = string.Empty;

  public PrivilegedCommandSigningKeyOptions ReservationLeaseSigningKey
  { get; init; } = new();

  public PrivilegedCommandSigningKeyOptions PreBindReservationReleaseSigningKey
  { get; init; } = new();

  public PrivilegedCommandSigningKeyOptions
    SuspendedProcessBindAcknowledgementSigningKey
  { get; init; } = new();

  public PrivilegedCommandSigningKeyOptions TerminalEnforcementReceiptSigningKey
  { get; init; } = new();

  public PrivilegedCommandVerificationKeyOptions ActionTokenVerificationKey
  { get; init; } = new();

  public string ActionTokenExpectedIssuer { get; init; } =
    PrivilegedCommandIsolationActionTokenTrust.Issuer;

  public string ActionTokenExpectedAudience { get; init; } =
    PrivilegedCommandIsolationActionTokenTrust.Audience;

  public string ActionTokenExpectedSubject { get; init; } =
    PrivilegedCommandIsolationActionTokenTrust.Subject;

  public TimeSpan ActionTokenAllowedClockSkew { get; init; } = TimeSpan.FromSeconds(30);

  public TimeSpan ActionTokenMaximumLifetime { get; init; } = TimeSpan.FromMinutes(5);

  public string ExpectedCompanionImagePath { get; init; } = string.Empty;

  public string ExpectedCompanionImageSha256 { get; init; } = string.Empty;

  public string AllowedCompanionServiceSid { get; init; } = string.Empty;

  public string ExpectedSupervisorImageSha256 { get; init; } = string.Empty;

  public string IsolationPolicySha256 { get; init; } = string.Empty;

  public string DriverMeasurementSha256 { get; init; } = string.Empty;

  public string DriverImagePath { get; init; } = string.Empty;

  public string DriverServiceName { get; init; } = string.Empty;

  public string DriverPolicyEpoch { get; init; } = string.Empty;

  public PrivilegedCommandVerificationKeyOptions DriverAttestationVerificationKey
  { get; init; } = new();

  public TimeSpan DriverAttestationAllowedClockSkew { get; init; } =
    TimeSpan.FromSeconds(30);

  public TimeSpan DriverAttestationMaximumLifetime { get; init; } =
    TimeSpan.FromMinutes(1);

  public string DriverDevicePath { get; init; } = string.Empty;

  public int MaximumFrameBytes { get; init; } = 131_072;

  public int MaximumConcurrentClients { get; init; } = 8;

  public TimeSpan OperationTimeout { get; init; } = TimeSpan.FromSeconds(10);

  public TimeSpan SessionIdleTimeout { get; init; } = TimeSpan.FromMinutes(2);

  public TimeSpan ReservationLeaseLifetime { get; init; } = TimeSpan.FromMinutes(1);

  public TimeSpan BindAcknowledgementLifetime { get; init; } = TimeSpan.FromSeconds(20);

  public TimeSpan MaximumExecutionDuration { get; init; } = TimeSpan.FromHours(2);

  public TimeSpan MaximumReceiptDelay { get; init; } = TimeSpan.FromMinutes(5);

  public TimeSpan DriverOperationTimeout { get; init; } = TimeSpan.FromSeconds(10);

  public int MaximumInvocationTimeoutSeconds { get; init; } = 300;

  public long MaximumInvocationOutputBytes { get; init; } = 1_048_576;

  public int MaximumInvocationProcesses { get; init; } = 16;

  public long MaximumInvocationProcessMemoryBytes { get; init; } = 536_870_912;

  public void Validate()
  {
    if (!Enabled)
    {
      return;
    }

    if (!CanonicalGuid(DeviceId)
      || !CanonicalGuid(SupervisorInstanceId)
      || !ServiceSid(SupervisorServiceSid)
      || !string.Equals(
        SupervisorServiceSid,
        SupervisorServiceIdentity.RequiredServiceSid,
        StringComparison.Ordinal)
      || !SafePipeName(PipeName)
      || !ValidSigningKey(ReservationLeaseSigningKey)
      || !ValidSigningKey(PreBindReservationReleaseSigningKey)
      || !ValidSigningKey(SuspendedProcessBindAcknowledgementSigningKey)
      || !ValidSigningKey(TerminalEnforcementReceiptSigningKey)
      || !ValidVerificationKey(ActionTokenVerificationKey)
      || !string.Equals(
        ActionTokenExpectedIssuer,
        PrivilegedCommandIsolationActionTokenTrust.Issuer,
        StringComparison.Ordinal)
      || !string.Equals(
        ActionTokenExpectedAudience,
        PrivilegedCommandIsolationActionTokenTrust.Audience,
        StringComparison.Ordinal)
      || !string.Equals(
        ActionTokenExpectedSubject,
        PrivilegedCommandIsolationActionTokenTrust.Subject,
        StringComparison.Ordinal)
      || !SafeAbsoluteLocalPath(ExpectedCompanionImagePath)
      || !ServiceSid(AllowedCompanionServiceSid)
      || !string.Equals(
        AllowedCompanionServiceSid,
        SupervisorServiceIdentity.RequiredCompanionServiceSid,
        StringComparison.Ordinal)
      || !SafeAbsoluteLocalPath(DriverImagePath)
      || !string.Equals(
        DriverServiceName,
        PrivilegedCommandIsolationSupervisorIdentity.DriverServiceName,
        StringComparison.Ordinal)
      || !SafeKeyId(DriverPolicyEpoch)
      || !ValidVerificationKey(DriverAttestationVerificationKey)
      || !SafeAbsoluteLocalPath(JournalPath)
      || !SafeAbsoluteLocalPath(KillSwitchPath)
      || !SafeDevicePath(DriverDevicePath)
      || !CanonicalSha256(ExpectedCompanionImageSha256)
      || !CanonicalSha256(ExpectedSupervisorImageSha256)
      || !CanonicalSha256(IsolationPolicySha256)
      || !CanonicalSha256(DriverMeasurementSha256)
      || MaximumFrameBytes is < 4_096 or > 262_144
      || MaximumConcurrentClients is < 1 or > 32
      || !Duration(OperationTimeout, TimeSpan.FromMilliseconds(100), TimeSpan.FromSeconds(30))
      || !Duration(SessionIdleTimeout, TimeSpan.FromSeconds(1), TimeSpan.FromMinutes(10))
      || !Duration(ReservationLeaseLifetime, TimeSpan.FromSeconds(1), TimeSpan.FromMinutes(2))
      || !Duration(BindAcknowledgementLifetime, TimeSpan.FromSeconds(1), TimeSpan.FromMinutes(1))
      || !Duration(MaximumExecutionDuration, TimeSpan.FromSeconds(1), TimeSpan.FromHours(2))
      || !Duration(MaximumReceiptDelay, TimeSpan.FromSeconds(1), TimeSpan.FromMinutes(30))
      || !Duration(
        ActionTokenAllowedClockSkew,
        TimeSpan.Zero,
        TimeSpan.FromMinutes(2))
      || !Duration(
        ActionTokenMaximumLifetime,
        TimeSpan.FromSeconds(30),
        TimeSpan.FromMinutes(15))
      || !Duration(
        DriverAttestationAllowedClockSkew,
        TimeSpan.Zero,
        TimeSpan.FromMinutes(2))
      || !Duration(
        DriverAttestationMaximumLifetime,
        TimeSpan.FromSeconds(1),
        TimeSpan.FromMinutes(2))
      || !Duration(DriverOperationTimeout, TimeSpan.FromMilliseconds(100), TimeSpan.FromSeconds(30))
      || MaximumInvocationTimeoutSeconds is < 1 or > 7_200
      || MaximumInvocationOutputBytes is < 1 or > 16_777_216
      || MaximumInvocationProcesses is < 1 or > 32
      || MaximumInvocationProcessMemoryBytes is < 16_777_216 or > 2_147_483_648)
    {
      throw new InvalidOperationException(
        "Privileged-command isolation supervisor configuration is invalid.");
    }

    var signingKeys = new[]
    {
      ReservationLeaseSigningKey,
      PreBindReservationReleaseSigningKey,
      SuspendedProcessBindAcknowledgementSigningKey,
      TerminalEnforcementReceiptSigningKey,
    };
    if (signingKeys.Select(value => value.KeyId)
        .Distinct(StringComparer.Ordinal).Count() != signingKeys.Length
      || signingKeys.Select(value => value.CertificateThumbprint)
        .Distinct(StringComparer.Ordinal).Count() != signingKeys.Length
      || signingKeys.Select(value => value.SubjectPublicKeyInfoBase64)
        .Distinct(StringComparer.Ordinal).Count() != signingKeys.Length)
    {
      throw new InvalidOperationException(
        "Each isolation signature purpose requires a distinct key ID, certificate, and public key.");
    }
    var verificationKeys = new[]
    {
      ActionTokenVerificationKey,
      DriverAttestationVerificationKey,
    };
    if (verificationKeys.Select(value => value.KeyId)
        .Distinct(StringComparer.Ordinal).Count() != verificationKeys.Length
      || verificationKeys.Select(value => value.CertificateThumbprint)
        .Distinct(StringComparer.Ordinal).Count() != verificationKeys.Length
      || verificationKeys.Select(value => value.SubjectPublicKeyInfoBase64)
        .Distinct(StringComparer.Ordinal).Count() != verificationKeys.Length
      || signingKeys.Select(value => value.KeyId)
        .Intersect(verificationKeys.Select(value => value.KeyId), StringComparer.Ordinal).Any()
      || signingKeys.Select(value => value.CertificateThumbprint)
        .Intersect(
          verificationKeys.Select(value => value.CertificateThumbprint),
          StringComparer.Ordinal).Any()
      || signingKeys.Select(value => value.SubjectPublicKeyInfoBase64)
        .Intersect(
          verificationKeys.Select(value => value.SubjectPublicKeyInfoBase64),
          StringComparer.Ordinal).Any())
    {
      throw new InvalidOperationException(
        "Action-token, driver-attestation, and evidence-signing keys must be purpose-distinct.");
    }

    var root = CanonicalDirectory(StateRoot);
    var journal = Path.GetFullPath(JournalPath);
    var expectedJournal = Path.GetFullPath(Path.Combine(root, "lifecycle.v1.jsonl"));
    var parent = Directory.GetParent(root)?.FullName
      ?? throw new InvalidOperationException("The isolation state root has no parent.");
    var expectedKillSwitch = Path.GetFullPath(Path.Combine(parent, "DISABLED"));
    if (!string.Equals(journal, expectedJournal, StringComparison.OrdinalIgnoreCase))
    {
      throw new InvalidOperationException(
        "The isolation lifecycle journal must use the fixed supervisor journal path.");
    }
    if (!string.Equals(
        Path.GetFullPath(KillSwitchPath),
        expectedKillSwitch,
        StringComparison.OrdinalIgnoreCase))
    {
      throw new InvalidOperationException(
        "The isolation supervisor must use the shared trusted-root kill switch.");
    }
  }

  internal static bool CanonicalGuid(string? value) =>
    value is not null
    && Guid.TryParseExact(value, "D", out var parsed)
    && parsed != Guid.Empty
    && string.Equals(parsed.ToString("D"), value, StringComparison.Ordinal);

  internal static bool CanonicalSha256(string? value) =>
    value is not null
    && PayloadDigest.IsSha256Hex(value)
    && string.Equals(value, value.ToLowerInvariant(), StringComparison.Ordinal);

  internal static bool SafeKeyId(string? value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 128
    && char.IsAsciiLetterOrDigit(value[0])
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_' or ':');

  internal static bool SafePipeName(string? value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 240
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_');

  internal static bool SafeAbsoluteLocalPath(string? value)
  {
    if (string.IsNullOrWhiteSpace(value)
      || !Path.IsPathFullyQualified(value)
      || value.StartsWith("\\\\", StringComparison.Ordinal)
      || value.StartsWith("\\??\\", StringComparison.Ordinal)
      || value.StartsWith("\\\\?\\", StringComparison.Ordinal)
      || value.EndsWith(' ')
      || value.EndsWith('.'))
    {
      return false;
    }

    try
    {
      var full = Path.GetFullPath(value);
      return string.Equals(full, value, StringComparison.OrdinalIgnoreCase)
        && full.IndexOf(':', 3) < 0;
    }
    catch (Exception exception) when (exception is ArgumentException
      or NotSupportedException
      or PathTooLongException)
    {
      return false;
    }
  }

  private static string CanonicalDirectory(string value)
  {
    if (!SafeAbsoluteLocalPath(value))
    {
      throw new InvalidOperationException("The isolation state root is unsafe.");
    }
    return Path.TrimEndingDirectorySeparator(Path.GetFullPath(value));
  }

  private static bool CanonicalThumbprint(string? value) =>
    value is not null
    && value.Length == 40
    && value.All(character => character is >= '0' and <= '9' or >= 'A' and <= 'F');

  private static bool ValidSigningKey(PrivilegedCommandSigningKeyOptions? value) =>
    value is not null
    && SafeKeyId(value.KeyId)
    && CanonicalThumbprint(value.CertificateThumbprint)
    && CanonicalP256Spki(value.SubjectPublicKeyInfoBase64);

  private static bool ValidVerificationKey(
    PrivilegedCommandVerificationKeyOptions? value) =>
    value is not null
    && SafeKeyId(value.KeyId)
    && CanonicalThumbprint(value.CertificateThumbprint)
    && CanonicalP256Spki(value.SubjectPublicKeyInfoBase64);

  private static bool SafeTrustScope(string? value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 512
    && value.All(character => character >= ' ' && character != '\u007f');

  private static bool CanonicalP256Spki(string? value)
  {
    if (string.IsNullOrWhiteSpace(value) || value.Length > 1_024)
    {
      return false;
    }

    byte[]? encoded = null;
    byte[]? canonical = null;
    try
    {
      encoded = Convert.FromBase64String(value);
      if (!string.Equals(
          Convert.ToBase64String(encoded),
          value,
          StringComparison.Ordinal))
      {
        return false;
      }
      using var key = ECDsa.Create();
      key.ImportSubjectPublicKeyInfo(encoded, out var consumed);
      canonical = key.ExportSubjectPublicKeyInfo();
      return consumed == encoded.Length
        && key.KeySize == 256
        && key.ExportParameters(includePrivateParameters: false).Curve.Oid.Value
          == ECCurve.NamedCurves.nistP256.Oid.Value
        && encoded.AsSpan().SequenceEqual(canonical);
    }
    catch (Exception exception) when (exception is FormatException
      or CryptographicException
      or ArgumentException)
    {
      return false;
    }
    finally
    {
      if (encoded is not null)
      {
        CryptographicOperations.ZeroMemory(encoded);
      }
      if (canonical is not null)
      {
        CryptographicOperations.ZeroMemory(canonical);
      }
    }
  }

  private static bool SafeDevicePath(string? value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.StartsWith("\\\\.\\", StringComparison.Ordinal)
    && value.Length is >= 8 and <= 240
    && value[4..].All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_');

  private static bool ServiceSid(string? value)
  {
    if (string.IsNullOrWhiteSpace(value)
      || !value.StartsWith("S-1-5-80-", StringComparison.Ordinal))
    {
      return false;
    }

    try
    {
      var parsed = new SecurityIdentifier(value);
      return string.Equals(parsed.Value, value, StringComparison.Ordinal);
    }
    catch (ArgumentException)
    {
      return false;
    }
  }

  private static bool Duration(TimeSpan value, TimeSpan minimum, TimeSpan maximum) =>
    value >= minimum && value <= maximum;
}

public sealed record PrivilegedCommandSigningKeyOptions
{
  public string KeyId { get; init; } = string.Empty;

  public string CertificateThumbprint { get; init; } = string.Empty;

  public string SubjectPublicKeyInfoBase64 { get; init; } = string.Empty;
}

public sealed record PrivilegedCommandVerificationKeyOptions
{
  public string KeyId { get; init; } = string.Empty;

  public string CertificateThumbprint { get; init; } = string.Empty;

  public string SubjectPublicKeyInfoBase64 { get; init; } = string.Empty;
}
