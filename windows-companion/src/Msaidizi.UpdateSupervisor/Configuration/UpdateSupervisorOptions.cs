namespace Itemba.Msaidizi.UpdateSupervisor.Configuration;

public sealed class UpdateSupervisorOptions
{
  public const string SectionName = "MsaidiziUpdateSupervisor";

  public string DeviceId { get; init; } = string.Empty;
  public string BrokerBaseUri { get; init; } = string.Empty;
  public string ClientCertificateThumbprint { get; init; } = string.Empty;
  public string EnrollmentId { get; init; } = string.Empty;
  public string EnrollmentCode { get; init; } = string.Empty;
  public string SupervisorRoot { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\update";
  public string JournalPath { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\update\journal.jsonl";
  public string ResultCachePath { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\update\results";
  public string OutboxPath { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\update\outbox";
  public string PendingCommandPath { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\update\pending-commands";
  public string KillSwitchPath { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\DISABLED";
  public string PinnedBootstrapPublicKeyPath { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\update-bootstrap-public.pem";
  public string PinnedBootstrapPublicKeySha256 { get; init; } = string.Empty;
  public string BootstrapKeyId { get; init; } = string.Empty;
  public int PollIntervalSeconds { get; init; } = 10;
  public IReadOnlyList<string> ProtectedRoots { get; init; } = [];
  public IReadOnlyList<UpdateTargetOptions> Targets { get; init; } = [];

  public UpdateSupervisorOptions Expand()
  {
    static string E(string value) => Environment.ExpandEnvironmentVariables(value);
    return new UpdateSupervisorOptions
    {
      DeviceId = DeviceId,
      BrokerBaseUri = BrokerBaseUri,
      ClientCertificateThumbprint = ClientCertificateThumbprint,
      EnrollmentId = EnrollmentId,
      EnrollmentCode = EnrollmentCode,
      SupervisorRoot = E(SupervisorRoot),
      JournalPath = E(JournalPath),
      ResultCachePath = E(ResultCachePath),
      OutboxPath = E(OutboxPath),
      PendingCommandPath = E(PendingCommandPath),
      KillSwitchPath = E(KillSwitchPath),
      PinnedBootstrapPublicKeyPath = E(PinnedBootstrapPublicKeyPath),
      PinnedBootstrapPublicKeySha256 = PinnedBootstrapPublicKeySha256,
      BootstrapKeyId = BootstrapKeyId,
      PollIntervalSeconds = PollIntervalSeconds,
      ProtectedRoots = ProtectedRoots.Select(E).ToArray(),
      Targets = Targets.Select(target => target.Expand()).ToArray(),
    };
  }
}

public sealed class UpdateTargetOptions
{
  public string TargetId { get; init; } = string.Empty;
  public string VersionsRoot { get; init; } = string.Empty;
  public string ActivePointerPath { get; init; } = string.Empty;
  public string? HealthProbeRelativePath { get; init; }
  public string? HealthProbeUri { get; init; }
  public string? ExpectedHealthContent { get; init; }
  public bool RequireObservedVersion { get; init; } = true;
  public string ObservedVersionHeaderName { get; init; } = "X-Itemba-Version";
  public int MaxHealthTimeoutSeconds { get; init; } = 300;
  public int MinimumHealthySoakSeconds { get; init; } = 60;
  public int HealthProbeIntervalSeconds { get; init; } = 5;
  public long MaxPackageBytes { get; init; } = 262_144_000;
  public long MaxExpandedBytes { get; init; } = 2_147_483_648;
  public int MaxFileCount { get; init; } = 50_000;
  public string ActivationMode { get; init; } = "ExternalPointerWatcher";
  public string? WindowsServiceName { get; init; }

  internal UpdateTargetOptions Expand()
  {
    static string E(string value) => Environment.ExpandEnvironmentVariables(value);
    return new UpdateTargetOptions
    {
      TargetId = TargetId,
      VersionsRoot = E(VersionsRoot),
      ActivePointerPath = E(ActivePointerPath),
      HealthProbeRelativePath = HealthProbeRelativePath,
      HealthProbeUri = HealthProbeUri,
      ExpectedHealthContent = ExpectedHealthContent,
      RequireObservedVersion = RequireObservedVersion,
      ObservedVersionHeaderName = ObservedVersionHeaderName,
      MaxHealthTimeoutSeconds = MaxHealthTimeoutSeconds,
      MinimumHealthySoakSeconds = MinimumHealthySoakSeconds,
      HealthProbeIntervalSeconds = HealthProbeIntervalSeconds,
      MaxPackageBytes = MaxPackageBytes,
      MaxExpandedBytes = MaxExpandedBytes,
      MaxFileCount = MaxFileCount,
      ActivationMode = ActivationMode,
      WindowsServiceName = WindowsServiceName,
    };
  }
}
