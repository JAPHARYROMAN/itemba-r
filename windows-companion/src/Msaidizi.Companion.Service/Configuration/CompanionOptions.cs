using System.Text;

namespace Itemba.Msaidizi.Companion.Service.Configuration;

public sealed class CompanionOptions
{
  public const string SectionName = "Companion";

  public string DeviceId { get; set; } = "UNENROLLED";

  public bool ExecutionEnabled { get; set; }

  public int HeartbeatSeconds { get; set; } = 15;

  /// <summary>
  /// Maximum interval between lease-renewal progress records while an action
  /// is executing. This renews only the broker's short-lived dispatch lease;
  /// it cannot extend the signed action authorization deadline.
  /// </summary>
  public int LeaseHeartbeatSeconds { get; set; } = 10;

  /// <summary>
  /// The local journal protocol intentionally permits only one prepared action
  /// at a time so every terminal receipt is adjacent to its preparation.
  /// </summary>
  public int MaxConcurrentActions { get; set; } = 1;

  /// <summary>Maximum separately initiated result-delivery generations.</summary>
  public int MaxResultDeliverySessions { get; set; } = 3;

  /// <summary>
  /// Absolute supervisor ceiling for the portion of an action egress budget
  /// withheld from capabilities for complete broker-result delivery.
  /// </summary>
  public long MaxBrokerResultEgressBytes { get; set; } = 16_777_216;

  public int MaximumArgumentsBytes { get; set; } = 1_048_576;

  public long HardMaxWallTimeSeconds { get; set; } = 7_200;

  public int HardMaxModelTurns { get; set; } = 200;

  public int HardMaxAttemptedToolCalls { get; set; } = 500;

  public int HardMaxMutations { get; set; } = 100;

  public long HardMaxLocalBytes { get; set; } = 5_368_709_120;

  public long HardMaxExternalEgressBytes { get; set; } = 262_144_000;

  public decimal HardMaxModelSpendUsd { get; set; } = 20m;

  /// <summary>
  /// Compatibility marker for deployed configuration. Privileged mutations
  /// always require the central ledger; setting this false never disables that
  /// invariant.
  /// </summary>
  public bool RequireCentralLedgerForMutations { get; set; } = true;

  public string JournalPath { get; set; } =
    @"%ProgramData%\Itemba\Msaidizi\journal\actions.jsonl";

  public string KillSwitchPath { get; set; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\DISABLED";

  public string ResultCachePath { get; set; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\result-cache";

  public string EgressReceiptReplayPath { get; set; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\egress-boundary\receipts.v1.jsonl";

  /// <summary>
  /// Deployment-owned digest of the WFP destination policy. This must match
  /// the centrally enrolled device pin before any metered capability is used.
  /// </summary>
  public string EgressDestinationPolicySha256 { get; set; } = string.Empty;

  /// <summary>
  /// Deployment-owned digest of the process-tree identity policy enforced by
  /// the boundary supervisor. It is intentionally unset in packaged defaults.
  /// </summary>
  public string EgressExecutionIdentitySha256 { get; set; } = string.Empty;
}

/// <summary>
/// Supervisor-owned host policy. The broker/model may select only an Id; it
/// can never introduce an absolute host path or executable at runtime.
/// </summary>
public sealed class HostCapabilityOptions
{
  public const string SectionName = "HostCapabilities";

  public bool Enabled { get; set; }

  public bool PermanentDeleteEnabled { get; set; }

  public string RecoveryVaultPath { get; set; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\recovery-vault";

  public string SecretVaultPath { get; set; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\secret-vault";

  public int MaximumSearchResults { get; set; } = 1_000;

  public int MaximumArgumentCount { get; set; } = 128;

  public int MaximumArgumentLength { get; set; } = 8_192;

  public int MaximumNetworkAddresses { get; set; } = 64;

  public int MaximumPrinterDiscoveryResults { get; set; } = 256;

  public int MaximumProcessInventoryEntries { get; set; } = 512;

  public int MaximumInstalledSoftwareInventoryEntries { get; set; } = 512;

  public long MaximumSingleFileBytes { get; set; } = 67_108_864;

  public int MaximumArchiveEntries { get; set; } = 2_048;

  public int MaximumArchiveEntryPathLength { get; set; } = 1_024;

  public long MaximumArchiveExpandedBytes { get; set; } = 536_870_912;

  public int MaximumArchiveCompressionRatio { get; set; } = 100;

  public long MaximumRecoveryBytes { get; set; } = 5_368_709_120;

  public List<AllowedHostRootOptions> AllowedRoots { get; set; } = [];

  public List<AllowedFileAclProfileOptions> AllowedFileAclProfiles { get; set; } = [];

  public List<AllowedProcessExecutableOptions> AllowedExecutables { get; set; } = [];

  public List<AllowedRegistryRootOptions> AllowedRegistryRoots { get; set; } = [];

  public List<AllowedRegistryDurableValueTargetOptions>
    AllowedRegistryDurableValueTargets
  { get; set; } = [];

  public List<AllowedRegistryDeleteTargetOptions>
    AllowedRegistryDeleteTargets
  { get; set; } = [];

  public List<AllowedMachineEnvironmentVariableOptions> AllowedMachineEnvironmentVariables
  { get; set; } = [];

  public List<AllowedWindowsServiceOptions> AllowedWindowsServices { get; set; } = [];

  public List<AllowedScheduledTaskOptions> AllowedScheduledTasks { get; set; } = [];

  public List<AllowedMsiPackageOptions> AllowedMsiPackages { get; set; } = [];

  public List<AllowedLocalAccountOptions> AllowedLocalAccounts { get; set; } = [];

  public List<AllowedLocalGroupOptions> AllowedLocalGroups { get; set; } = [];

  public List<AllowedLocalUserRightOptions> AllowedLocalUserRights { get; set; } = [];

  public List<AllowedNetworkAdapterOptions> AllowedNetworkAdapters { get; set; } = [];

  public List<AllowedPrinterOptions> AllowedPrinters { get; set; } = [];

  public List<AllowedPowerSchemeOptions> AllowedPowerSchemes { get; set; } = [];

  public List<AllowedTimeZoneOptions> AllowedTimeZones { get; set; } = [];
}

/// <summary>
/// Deployment-owned gate and hard local ceilings for the LocalSystem raw
/// command adapter. This is deliberately separate from HostCapabilities so a
/// workstation does not acquire shell authority merely by enabling the typed
/// host capability pack.
/// </summary>
public sealed class PrivilegedCommandOptions
{
  public const string SectionName = "PrivilegedCommand";

  public bool Enabled { get; set; }

  public int MaximumTimeoutSeconds { get; set; } = 300;

  public long MaximumOutputBytes { get; set; } = 1_048_576;

  public int MaximumProcesses { get; set; } = 16;

  public long MaximumProcessMemoryBytes { get; set; } = 536_870_912;

  public string IsolationReplayStorePath { get; set; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\privileged-command-isolation\replay.v1.jsonl";
}

/// <summary>
/// Deployment-owned trust and transport policy for the independently signed
/// privileged-command isolation supervisor. This section never enables the
/// raw-command capability by itself. The service selects the named-pipe client
/// only when every identity, measurement, time limit, and purpose-specific
/// public-key pin is complete and canonical.
/// </summary>
public sealed class PrivilegedCommandIsolationClientOptions
{
  public const string SectionName = "PrivilegedCommandIsolationClient";

  public bool Enabled { get; set; }

  public string Transport { get; set; } = "disabled";

  public int ProtocolVersion { get; set; } = 2;

  public string PipeName { get; set; } = string.Empty;

  public string ExpectedSupervisorImagePath { get; set; } = string.Empty;

  public string ExpectedSupervisorImageSha256 { get; set; } = string.Empty;

  public string ExpectedSupervisorServiceSid { get; set; } = string.Empty;

  public string ExpectedDeviceId { get; set; } = string.Empty;

  public string ExpectedIsolationPolicySha256 { get; set; } = string.Empty;

  public string ExpectedDriverMeasurementSha256 { get; set; } = string.Empty;

  public string ExpectedServiceMeasurementSha256 { get; set; } = string.Empty;

  public int MaximumFrameBytes { get; set; } = 131_072;

  public int ConnectTimeoutMilliseconds { get; set; } = 5_000;

  public int OperationTimeoutMilliseconds { get; set; } = 10_000;

  public int ReservationRequestLifetimeSeconds { get; set; } = 60;

  public int AllowedClockSkewSeconds { get; set; } = 30;

  public int MaximumReservationRequestAgeSeconds { get; set; } = 60;

  public int MaximumReservationLeaseLifetimeSeconds { get; set; } = 120;

  public int MaximumBindAcknowledgementLifetimeSeconds { get; set; } = 30;

  public int MaximumExecutionDurationSeconds { get; set; } = 7_200;

  public int MaximumReceiptDelaySeconds { get; set; } = 300;

  public PrivilegedCommandIsolationPublicKeyOptions ReservationLeasePublicKey
  { get; set; } = new();

  public PrivilegedCommandIsolationPublicKeyOptions
    PreBindReservationReleasePublicKey
  { get; set; } = new();

  public PrivilegedCommandIsolationPublicKeyOptions
    SuspendedProcessBindAcknowledgementPublicKey
  { get; set; } = new();

  public PrivilegedCommandIsolationPublicKeyOptions TerminalEnforcementReceiptPublicKey
  { get; set; } = new();
}

/// <summary>
/// Public-only P-256 SubjectPublicKeyInfo pin. Its signature purpose is fixed
/// by the containing property and cannot be supplied or changed by deployment
/// text, preventing cross-purpose key lookup.
/// </summary>
public sealed class PrivilegedCommandIsolationPublicKeyOptions
{
  public string KeyId { get; set; } = string.Empty;

  public string SubjectPublicKeyInfoBase64 { get; set; } = string.Empty;
}

/// <summary>
/// Deployment-owned policy for machine boot-session and restart capabilities.
/// This policy is deliberately separate from the general host-capability flag
/// so an enrolled host does not acquire restart authority implicitly.
/// </summary>
public sealed class SystemPowerOptions
{
  public const string SectionName = "SystemPower";

  public bool Enabled { get; set; }

  /// <summary>
  /// Fixed supervisor-selected restart delay. An action cannot override this
  /// value, the shutdown message, or Windows' application-close behavior.
  /// </summary>
  public int RestartDelaySeconds { get; set; } = 120;
}

public sealed class AllowedHostRootOptions
{
  public string Id { get; set; } = string.Empty;

  public string Path { get; set; } = string.Empty;

  public string QuarantinePath { get; set; } = string.Empty;

  public bool AllowRead { get; set; }

  public bool AllowWrite { get; set; }

  public bool AllowDelete { get; set; }
}

/// <summary>
/// A supervisor-authored DACL template. The model selects only the stable Id;
/// raw SDDL and Windows principals never cross the action boundary.
/// </summary>
public sealed class AllowedFileAclProfileOptions
{
  public string Id { get; set; } = string.Empty;

  public string Sddl { get; set; } = string.Empty;

  public List<string> RootIds { get; set; } = [];
}

public sealed class AllowedProcessExecutableOptions
{
  public string Id { get; set; } = string.Empty;

  public string Path { get; set; } = string.Empty;

  public bool AllowLocalSystem { get; set; }
}

public sealed class AllowedRegistryRootOptions
{
  public string Id { get; set; } = string.Empty;

  public string Hive { get; set; } = "LocalMachine";

  public string SubKey { get; set; } = string.Empty;

  public bool AllowRead { get; set; }

  public bool AllowWrite { get; set; }

  public bool AllowDelete { get; set; }
}

/// <summary>
/// Exact supervisor-owned authorization for a model-visible durable registry
/// value. A root grant alone never authorizes raw reads or writes.
/// </summary>
public sealed class AllowedRegistryDurableValueTargetOptions
{
  public string RootId { get; set; } = string.Empty;

  public string RelativeKey { get; set; } = string.Empty;

  public string ValueName { get; set; } = string.Empty;

  public string Classification { get; set; } = string.Empty;

  public List<string> AllowedValueTypes { get; set; } = [];
}

/// <summary>
/// Exact cleanup authorization for a registry value that may be secret-like.
/// It grants deletion only and never authorizes a raw read or write.
/// </summary>
public sealed class AllowedRegistryDeleteTargetOptions
{
  public string RootId { get; set; } = string.Empty;

  public string RelativeKey { get; set; } = string.Empty;

  public string ValueName { get; set; } = string.Empty;
}

public sealed class AllowedMachineEnvironmentVariableOptions
{
  public string Id { get; set; } = string.Empty;

  public string Name { get; set; } = string.Empty;

  public string Classification { get; set; } = string.Empty;

  public bool AllowRead { get; set; }

  public bool AllowWrite { get; set; }

  public bool AllowDelete { get; set; }
}

internal static class DurableNonSecretValuePolicy
{
  public const string Classification = "durable-non-secret";
  private static readonly string[] CredentialNameMarkers =
  [
    "password",
    "passphrase",
    "secret",
    "token",
    "apikey",
    "privatekey",
    "accesskey",
    "connectionstring",
    "credential",
    "bearer",
    "authorization",
  ];
  private static readonly UTF8Encoding StrictUtf8 = new(
    encoderShouldEmitUTF8Identifier: false,
    throwOnInvalidBytes: true);

  public static bool IsClassified(string? classification) => string.Equals(
    classification,
    Classification,
    StringComparison.Ordinal);

  public static bool IsCredentialLikeName(string? value)
  {
    if (string.IsNullOrWhiteSpace(value))
    {
      return false;
    }
    var compact = string.Concat(value
      .Where(char.IsAsciiLetterOrDigit)
      .Select(char.ToLowerInvariant));
    return CredentialNameMarkers.Any(marker => compact.Contains(
      marker,
      StringComparison.Ordinal));
  }

  public static bool AppearsSecretBearingText(string? value)
  {
    if (string.IsNullOrEmpty(value))
    {
      return false;
    }
    if (value.Contains("-----BEGIN PRIVATE KEY-----", StringComparison.OrdinalIgnoreCase)
      || value.Contains(
        "-----BEGIN RSA PRIVATE KEY-----",
        StringComparison.OrdinalIgnoreCase)
      || value.Contains("-----BEGIN OPENSSH PRIVATE KEY-----", StringComparison.OrdinalIgnoreCase)
      || value.Contains("Bearer ", StringComparison.OrdinalIgnoreCase)
      || Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && !string.IsNullOrEmpty(uri.UserInfo))
    {
      return true;
    }

    for (var index = 0; index < value.Length; index++)
    {
      if (value[index] is not ('=' or ':'))
      {
        continue;
      }
      var start = index - 1;
      while (start >= 0 && value[start] is not (';' or ',' or '\r' or '\n'
        or '{' or '[' or '?' or '&'))
      {
        start--;
      }
      if (IsCredentialLikeName(value[(start + 1)..index]))
      {
        return true;
      }
    }
    return false;
  }

  public static bool AppearsSecretBearingBytes(byte[] value)
  {
    ArgumentNullException.ThrowIfNull(value);
    try
    {
      return AppearsSecretBearingText(StrictUtf8.GetString(value));
    }
    catch (DecoderFallbackException)
    {
      // Opaque binary requires the explicit deployment type authorization;
      // invalid UTF-8 cannot be safely treated as textual credential syntax.
      return false;
    }
  }
}

public sealed class AllowedWindowsServiceOptions
{
  public string Id { get; set; } = string.Empty;

  public string ServiceName { get; set; } = string.Empty;

  public bool AllowStart { get; set; }

  public bool AllowStop { get; set; }

  /// <summary>
  /// Exact supervisor-owned base start modes this service may be changed to.
  /// An empty list keeps start-mode mutation disabled while preserving reads.
  /// </summary>
  public List<string> AllowedStartModes { get; set; } = [];
}

public sealed class AllowedScheduledTaskOptions
{
  public string Id { get; set; } = string.Empty;

  public string TaskPath { get; set; } = string.Empty;

  public bool AllowRun { get; set; }

  public bool AllowEnableDisable { get; set; }
}

public sealed class AllowedMsiPackageOptions
{
  public string Id { get; set; } = string.Empty;

  public string InstallerPath { get; set; } = string.Empty;

  public string Sha256 { get; set; } = string.Empty;

  public string SignerCertificateThumbprint { get; set; } = string.Empty;

  public string ProductCode { get; set; } = string.Empty;

  public bool AllowInstallOrUpdate { get; set; }

  public bool AllowUninstall { get; set; }
}

public sealed class AllowedLocalAccountOptions
{
  public string Id { get; set; } = string.Empty;

  public string AccountName { get; set; } = string.Empty;

  public bool AllowRead { get; set; }

  public bool AllowEnableDisable { get; set; }

  public bool AllowGroupMembershipChange { get; set; }
}

public sealed class AllowedLocalGroupOptions
{
  public string Id { get; set; } = string.Empty;

  public string GroupName { get; set; } = string.Empty;

  public bool AllowReadMembers { get; set; }

  public bool AllowMembershipChange { get; set; }
}

/// <summary>
/// Binds one stable supervisor ID to one exact non-built-in local principal and
/// one curated Windows logon right. Raw principal names and LSA right names are
/// never accepted from an action.
/// </summary>
public sealed class AllowedLocalUserRightOptions
{
  public string Id { get; set; } = string.Empty;

  public string PrincipalType { get; set; } = string.Empty;

  public string PrincipalId { get; set; } = string.Empty;

  public string RightName { get; set; } = string.Empty;

  public bool AllowRead { get; set; }

  public bool AllowGrant { get; set; }

  public bool AllowRevoke { get; set; }
}

public sealed class AllowedNetworkAdapterOptions
{
  public string Id { get; set; } = string.Empty;

  public string InterfaceGuid { get; set; } = string.Empty;

  public bool AllowInspect { get; set; }

  public bool AllowEnable { get; set; }

  public bool AllowDisable { get; set; }
}

public sealed class AllowedPrinterOptions
{
  public string Id { get; set; } = string.Empty;

  public string PrinterName { get; set; } = string.Empty;

  public bool AllowReadQueue { get; set; }

  public bool AllowPauseResume { get; set; }
}

public sealed class AllowedPowerSchemeOptions
{
  public string Id { get; set; } = string.Empty;

  public string SchemeGuid { get; set; } = string.Empty;

  public bool AllowActivate { get; set; }

  public bool AllowDisplayTimeoutChange { get; set; }
}

public sealed class AllowedTimeZoneOptions
{
  public string Id { get; set; } = string.Empty;

  public string WindowsTimeZoneId { get; set; } = string.Empty;

  public bool AllowSet { get; set; }
}

/// <summary>
/// Supervisor-owned destinations for typed external actions. Static actions
/// select only a stable endpoint ID. The separately enabled dynamic path
/// requires an exact signed destination plus an independently provisioned,
/// digest-pinned egress policy; it never infers destination authority.
/// </summary>
public sealed class ExternalActionOptions
{
  public const string SectionName = "ExternalActions";

  public bool Enabled { get; set; }

  public int ConnectTimeoutSeconds { get; set; } = 15;

  public int MaximumResponseBytes { get; set; } = 1_048_576;

  public int MaximumRequestBodyBytes { get; set; } = 1_048_576;

  /// <summary>
  /// Enables the signed mandate_dynamic_https_v1 argument envelope. The
  /// independent egress supervisor must separately enable and constrain the
  /// same authority in its digest-pinned destination policy.
  /// </summary>
  public bool DynamicDestinationsEnabled { get; set; }

  public List<ExternalActionEndpointOptions> Endpoints { get; set; } = [];
}

public sealed class ExternalActionEndpointOptions
{
  public string Id { get; set; } = string.Empty;

  /// <summary>One of email, message, publish, or purchase.</summary>
  public string Kind { get; set; } = string.Empty;

  /// <summary>HTTPS origin only, with no path, query, fragment, or user info.</summary>
  public string Origin { get; set; } = string.Empty;

  /// <summary>Fixed absolute path beneath Origin. It is never action input.</summary>
  public string RelativePath { get; set; } = string.Empty;

  /// <summary>SHA-256 of the exact leaf certificate DER bytes.</summary>
  public string ServerCertificateSha256Pin { get; set; } = string.Empty;

  /// <summary>
  /// Required UUID in the supervisor secret vault. Raw credentials are never
  /// accepted in configuration or action arguments.
  /// </summary>
  public string CredentialReferenceId { get; set; } = string.Empty;

  /// <summary>
  /// SHA-256 of the exact DPAPI-protected v2 vault record bytes. Rotation is
  /// activated only with a trusted destination-policy/configuration update.
  /// </summary>
  public string CredentialRecordSha256 { get; set; } = string.Empty;

  /// <summary>Supervisor-authored ASCII prefix such as "Bearer ".</summary>
  public string CredentialPrefix { get; set; } = "Bearer ";
}

public sealed class BrokerChannelOptions
{
  public const string SectionName = "BrokerChannel";

  public bool Enabled { get; set; }

  public string Endpoint { get; set; } =
    "https://localhost.invalid:3443/api/v1/msaidizi/devices/channel";

  public string DeviceCertificateThumbprint { get; set; } = string.Empty;

  /// <summary>
  /// Allows the service to create its first non-exportable device identity and
  /// bind it with a one-time pairing code. This is supervisor configuration,
  /// never action/model input.
  /// </summary>
  public bool BootstrapIdentityEnabled { get; set; } = true;

  public string PairingCode { get; set; } = string.Empty;

  /// <summary>
  /// Requires the device identity private key to be created by Microsoft
  /// Platform Crypto Provider. Production deployments must keep this enabled.
  /// </summary>
  public bool RequireHardwareBackedDeviceIdentity { get; set; } = true;

  /// <summary>
  /// Explicit escape hatch for isolated development and tests that do not have
  /// a TPM. It is invalid unless RequireHardwareBackedDeviceIdentity is false
  /// and must never be enabled in a packaged deployment configuration.
  /// </summary>
  public bool DevelopmentOnlyAllowSoftwareDeviceIdentity { get; set; }

  /// <summary>
  /// Selects TPM-first provisioning when the development-only software policy
  /// is active. Production hardware-required mode always uses the TPM provider.
  /// </summary>
  public bool PreferTpm { get; set; } = true;

  public string DeviceIdentityRecordPath { get; set; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\device-identity.bin";

  public string DeviceKeyNamePrefix { get; set; } = "Itemba.Msaidizi.Device";

  public int CertificateValidityDays { get; set; } = 730;

  public string DeviceCertificateStoreName { get; set; } = "My";

  public string DeviceCertificateStoreLocation { get; set; } = "LocalMachine";

  public string ServerCertificateSha256Pin { get; set; } = string.Empty;

  public int ConnectTimeoutSeconds { get; set; } = 15;

  public int RequestTimeoutSeconds { get; set; } = 30;

  public int MaxRequestAttempts { get; set; } = 3;

  public int InitialRetryDelayMilliseconds { get; set; } = 250;

  public int MaximumRetryDelaySeconds { get; set; } = 30;

  public int PollIntervalMilliseconds { get; set; } = 1_000;

  public int MaxCommandsPerPoll { get; set; } = 5;

  public int LedgerConnectivityTtlSeconds { get; set; } = 45;

  public int MaximumResponseBytes { get; set; } = 1_048_576;
}

/// <summary>
/// Supervisor-owned policy for the authenticated LocalSystem-to-interactive-
/// user named-pipe bridge. This channel is local-only and never binds a TCP or
/// HTTP listener.
/// </summary>
public sealed class SessionBridgeOptions
{
  public const string SectionName = "SessionBridge";

  public bool Enabled { get; set; }

  public string PipeName { get; set; } = "Itemba.Msaidizi.Session.v2";

  public string AllowedAgentExecutableSha256 { get; set; } = string.Empty;

  public int MaximumFrameBytes { get; set; } = 8_388_608;

  public int ActionTimeoutSeconds { get; set; } = 900;

  public int HeartbeatTtlSeconds { get; set; } = 45;

  public bool RequireActiveConsoleSession { get; set; } = true;

  public bool BrowserExternalEffectsEnabled { get; set; }

  public bool EmergencyCommandEnabled { get; set; }
}

/// <summary>
/// Local-only, LocalSystem-owned secret-vault provisioning policy. Bindings
/// are supervisor configuration and are never supplied by the broker/model.
/// </summary>
public sealed class SecretProvisioningOptions
{
  public const string SectionName = "SecretProvisioning";

  public bool Enabled { get; set; }

  public string PipeName { get; set; } = "Itemba.Msaidizi.SecretProvisioning.v1";

  public string AllowedAgentExecutableSha256 { get; set; } = string.Empty;

  public string AuditJournalPath { get; set; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\secret-provisioning\audit.jsonl";

  public int MaximumFrameBytes { get; set; } = 1_048_576;

  public int ConfirmationTtlSeconds { get; set; } = 120;

  public bool RequireActiveConsoleSession { get; set; } = true;

  public List<SecretProvisioningBindingOptions> Bindings { get; set; } = [];
}

public sealed class SecretProvisioningBindingOptions
{
  public string BindingId { get; set; } = string.Empty;

  public string DisplayName { get; set; } = string.Empty;

  public string Kind { get; set; } = string.Empty;

  public string Destination { get; set; } = string.Empty;

  public string DestinationScopeSha256 { get; set; } = string.Empty;

  public List<string> AllowedCapabilities { get; set; } = [];
}

public sealed class TokenVerificationOptions
{
  public const string SectionName = "TokenVerification";

  public string ExpectedIssuer { get; set; } = "itemba-msaidizi-broker";

  public string ExpectedAudience { get; set; } = "itemba-windows-companion";

  public string ExpectedSubject { get; set; } = "msaidizi-global";

  public int AllowedClockSkewSeconds { get; set; } = 30;

  public int MaximumTokenLifetimeSeconds { get; set; } = 300;

  public List<TrustedSigningCertificateOptions> TrustedSigningCertificates { get; set; } = [];
}

/// <summary>
/// Supervisor-owned trust anchors for the separately deployed egress-boundary
/// supervisor. This section does not enable an egress transport or WFP policy.
/// </summary>
public sealed class EgressAttestationTrustOptions
{
  public const string SectionName = "EgressAttestationTrust";

  public bool Enabled { get; set; }

  /// <summary>
  /// One-to-one key-id bindings to public-only certificates. The companion
  /// rejects an enabled section with no bindings.
  /// </summary>
  public List<TrustedEgressAttestationCertificateOptions> TrustedSupervisorCertificates
  { get; set; } = [];

  /// <summary>
  /// Additional enrolled device-certificate thumbprints to keep purpose-
  /// separated from the boundary supervisor. Use this for bootstrapped device
  /// identities whose thumbprint is not present in BrokerChannel configuration.
  /// </summary>
  public List<string> PairedDeviceCertificateThumbprints { get; set; } = [];
}

/// <summary>
/// Default-disabled transport to an independently installed egress supervisor.
/// Enabling this section does not install or emulate WFP enforcement; the
/// production client is selected only when every transport and trust pin is
/// exact and the separate attestation trust section contains the named key.
/// </summary>
public sealed class EgressSupervisorClientOptions
{
  public const string SectionName = "EgressSupervisorClient";

  /// <summary>
  /// The service SID compiled into both the companion and the independently
  /// installed egress supervisor. Deployment text cannot select another
  /// restricted LocalSystem service as the trusted peer.
  /// </summary>
  public const string RequiredSupervisorServiceSid =
    "S-1-5-80-2691216044-51290016-1044150087-1430489630-3303720160";

  public bool Enabled { get; set; }

  public string Transport { get; set; } = "disabled";

  public int ProtocolVersion { get; set; } = 2;

  public string PipeName { get; set; } = string.Empty;

  public string ExpectedSupervisorImagePath { get; set; } = string.Empty;

  public string ExpectedSupervisorImageSha256 { get; set; } = string.Empty;

  public string ExpectedSupervisorServiceSid { get; set; } = string.Empty;

  public string AttestationKeyId { get; set; } = string.Empty;

  /// <summary>
  /// Deployment pin for the protected LocalSystem + restricted Companion SID
  /// control-pipe DACL. It is compared to independently signed live evidence.
  /// </summary>
  public string ExpectedSupervisorPipeSecuritySha256 { get; set; } = string.Empty;

  public int MaximumFrameBytes { get; set; } = 131_072;

  public int ConnectTimeoutMilliseconds { get; set; } = 5_000;

  public int OperationTimeoutMilliseconds { get; set; } = 10_000;
}

public sealed class TrustedEgressAttestationCertificateOptions
{
  public string KeyId { get; set; } = string.Empty;

  public string Thumbprint { get; set; } = string.Empty;

  public string StoreName { get; set; } = "TrustedPeople";

  public string StoreLocation { get; set; } = "LocalMachine";
}

public sealed class TrustedSigningCertificateOptions
{
  public string KeyId { get; set; } = string.Empty;

  public string Thumbprint { get; set; } = string.Empty;

  public string StoreName { get; set; } = "TrustedPeople";

  public string StoreLocation { get; set; } = "LocalMachine";
}
