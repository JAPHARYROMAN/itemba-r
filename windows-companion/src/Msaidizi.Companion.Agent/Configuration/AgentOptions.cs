namespace Itemba.Msaidizi.Companion.Agent.Configuration;

public sealed class AgentOptions
{
  public const string SectionName = "Agent";

  public string DeviceId { get; set; } = "UNENROLLED";

  public bool ExecutionEnabled { get; set; }

  public int HeartbeatSeconds { get; set; } = 15;

  public string KillSwitchPath { get; set; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\DISABLED";

  public string EgressDestinationPolicySha256 { get; set; } = string.Empty;

  public int MaximumActionWallTimeSeconds { get; set; } = 900;

  public long MaximumActionBytes { get; set; } = 67_108_864;

  public long MaximumCameraBytes { get; set; } = 16_777_216;

  public long MaximumSpeechAudioBytes { get; set; } = 16_777_216;

  public int MaximumTranscriptCharacters { get; set; } = 32_768;

  public string SessionRecoveryPath { get; set; } =
    @"%LocalAppData%\Itemba\Msaidizi\session-recovery";

  /// <summary>
  /// Existing installer/enrollment-provisioned directory with a protected ACL
  /// granting write access only to the interactive user, SYSTEM, and local
  /// administrators. Runtime never creates or relaxes this trust root.
  /// </summary>
  public string ArtifactQuarantineRoot { get; set; } =
    @"%LocalAppData%\Itemba\Msaidizi\artifact-quarantine";

  public List<AllowedBrowserOriginOptions> AllowedBrowserOrigins { get; set; } = [];

  public List<AllowedUiProcessOptions> AllowedUiProcesses { get; set; } = [];

  public List<AllowedBrowserUploadRootOptions> AllowedBrowserUploadRoots { get; set; } = [];

  public List<AllowedCameraOptions> AllowedCameras { get; set; } = [];

  public List<AllowedSpeechVoiceOptions> AllowedSpeechVoices { get; set; } = [];

  public List<AllowedOfflineSpeechRecognizerOptions> AllowedOfflineSpeechRecognizers
  { get; set; } = [];

  public long MaximumCommandOutputBytes { get; set; } = 1_048_576;

  public int MaximumCommandProcesses { get; set; } = 16;

  public long MaximumCommandWorkingSetBytes { get; set; } = 536_870_912;

  public List<AllowedCommandWorkingDirectoryOptions> AllowedCommandWorkingDirectories { get; set; } = [];

  public List<string> ProtectedSupervisorPaths { get; set; } =
  [
    @"%ProgramData%\Itemba\Msaidizi",
    @"%LocalAppData%\Itemba\Msaidizi",
  ];
}

public sealed class SessionBridgeOptions
{
  public const string SectionName = "SessionBridge";

  public bool Enabled { get; set; }

  public string PipeName { get; set; } = "Itemba.Msaidizi.Session.v2";

  public string ServiceCertificateThumbprint { get; set; } = string.Empty;

  public string ServiceCertificateStoreName { get; set; } = "My";

  public string ServiceCertificateStoreLocation { get; set; } = "LocalMachine";

  public int ConnectTimeoutSeconds { get; set; } = 15;

  public int MaximumFrameBytes { get; set; } = 8_388_608;

  public int ReconnectDelayMilliseconds { get; set; } = 1_000;

  public bool BrowserExternalEffectsEnabled { get; set; }

  public bool EmergencyCommandEnabled { get; set; }
}

/// <summary>
/// Public-only trust pins for capability-boundary evidence delivered through
/// the already authenticated session bridge. These pins verify evidence; they
/// never enable an effect without a matching fresh supervisor signature.
/// </summary>
public sealed class CapabilityBoundaryTrustOptions
{
  public const string SectionName = "CapabilityBoundaryTrust";

  public bool Enabled { get; set; }

  public string KeyId { get; set; } = string.Empty;

  public string CertificateThumbprint { get; set; } = string.Empty;

  public string CertificateStoreName { get; set; } = "TrustedPeople";

  public string CertificateStoreLocation { get; set; } = "LocalMachine";

  public string ExpectedSupervisorPipeSecuritySha256 { get; set; } = string.Empty;

  public int AllowedClockSkewSeconds { get; set; } = 30;

  public int MaximumAttestationLifetimeSeconds { get; set; } = 120;
}

public sealed class SecretProvisioningOptions
{
  public const string SectionName = "SecretProvisioning";

  public bool Enabled { get; set; }

  public string PipeName { get; set; } = "Itemba.Msaidizi.SecretProvisioning.v1";

  public string ServiceCertificateThumbprint { get; set; } = string.Empty;

  public string ServiceCertificateStoreName { get; set; } = "My";

  public string ServiceCertificateStoreLocation { get; set; } = "LocalMachine";

  public int ConnectTimeoutSeconds { get; set; } = 15;

  public int MaximumFrameBytes { get; set; } = 1_048_576;

  public string PendingRequestPath { get; set; } =
    @"%LocalAppData%\Itemba\Msaidizi\secret-provisioning\pending.bin";
}

public sealed class AllowedBrowserOriginOptions
{
  public string Id { get; set; } = string.Empty;

  public string Origin { get; set; } = string.Empty;
}

public sealed class AllowedUiProcessOptions
{
  public string Id { get; set; } = string.Empty;

  public string ExecutablePath { get; set; } = string.Empty;

  public string Sha256 { get; set; } = string.Empty;
}

public sealed class AllowedCommandWorkingDirectoryOptions
{
  public string Id { get; set; } = string.Empty;

  public string Path { get; set; } = string.Empty;
}

public sealed class AllowedBrowserUploadRootOptions
{
  public string Id { get; set; } = string.Empty;

  public string Path { get; set; } = string.Empty;
}

public sealed class AllowedCameraOptions
{
  public string Id { get; set; } = string.Empty;

  public string DeviceId { get; set; } = string.Empty;
}

public sealed class AllowedSpeechVoiceOptions
{
  public string Id { get; set; } = string.Empty;

  public string InstalledVoiceName { get; set; } = string.Empty;

  public string CultureName { get; set; } = string.Empty;
}

public sealed class AllowedOfflineSpeechRecognizerOptions
{
  public string Id { get; set; } = string.Empty;

  public string InstalledRecognizerId { get; set; } = string.Empty;

  public string CultureName { get; set; } = string.Empty;
}
