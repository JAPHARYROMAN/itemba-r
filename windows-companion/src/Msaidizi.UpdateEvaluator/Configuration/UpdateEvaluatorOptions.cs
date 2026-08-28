namespace Itemba.Msaidizi.UpdateEvaluator.Configuration;

public sealed class UpdateEvaluatorOptions
{
  public const string SectionName = "MsaidiziUpdateEvaluator";

  public bool Enabled { get; init; }
  public string BrokerBaseUri { get; init; } = string.Empty;
  public string TransportCertificateThumbprint { get; init; } = string.Empty;
  public string PinnedBrokerCertificateSha256 { get; init; } = string.Empty;
  public string PinnedBrokerSpkiSha256 { get; init; } = string.Empty;
  public string EvaluatorRoot { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\update-evaluator";
  public string StatePath { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\update-evaluator\state";
  public string TransferPath { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\update-evaluator\transfer";
  public string KillSwitchPath { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\DISABLED";
  public int PollIntervalSeconds { get; init; } = 10;
  public int HeartbeatIntervalSeconds { get; init; } = 30;
  public int AttestationTtlSeconds { get; init; } = 600;
  public string ProtectedPolicyVersion { get; init; } =
    "msaidizi-generated-update-policy/v1";
  public string ProtectedPolicySha256 { get; init; } = string.Empty;
  public AttestationSignerOptions ArtifactSigner { get; init; } = new();
  public AttestationSignerOptions RunnerSigner { get; init; } = new();
  public IReadOnlyList<ReviewerOptions> Reviewers { get; init; } = [];
  public HyperVEvaluationOptions HyperV { get; init; } = new();
  public IReadOnlyList<EvaluationCommandOptions> Commands { get; init; } = [];

  public UpdateEvaluatorOptions Expand()
  {
    static string E(string value) => Environment.ExpandEnvironmentVariables(value);
    return new UpdateEvaluatorOptions
    {
      Enabled = Enabled,
      BrokerBaseUri = BrokerBaseUri,
      TransportCertificateThumbprint = TransportCertificateThumbprint,
      PinnedBrokerCertificateSha256 = PinnedBrokerCertificateSha256,
      PinnedBrokerSpkiSha256 = PinnedBrokerSpkiSha256,
      EvaluatorRoot = E(EvaluatorRoot),
      StatePath = E(StatePath),
      TransferPath = E(TransferPath),
      KillSwitchPath = E(KillSwitchPath),
      PollIntervalSeconds = PollIntervalSeconds,
      HeartbeatIntervalSeconds = HeartbeatIntervalSeconds,
      AttestationTtlSeconds = AttestationTtlSeconds,
      ProtectedPolicyVersion = ProtectedPolicyVersion,
      ProtectedPolicySha256 = ProtectedPolicySha256,
      ArtifactSigner = ArtifactSigner,
      RunnerSigner = RunnerSigner,
      Reviewers = Reviewers.Select(reviewer => reviewer.Expand()).ToArray(),
      HyperV = HyperV.Expand(),
      Commands = Commands.ToArray(),
    };
  }
}

public sealed class AttestationSignerOptions
{
  public string KeyId { get; init; } = string.Empty;
  public string CertificateThumbprint { get; init; } = string.Empty;
  public string HardwareKeyProvider { get; init; } = "Microsoft Platform Crypto Provider";
}

public sealed class ReviewerOptions
{
  public string ProviderId { get; init; } = string.Empty;
  public string ReviewerId { get; init; } = string.Empty;
  public string ModelId { get; init; } = string.Empty;
  public string Endpoint { get; init; } = string.Empty;
  public string PinnedServerSpkiSha256 { get; init; } = string.Empty;
  public string ApiKeyEnvironmentVariable { get; init; } = string.Empty;
  public int TimeoutSeconds { get; init; } = 120;
  public AttestationSignerOptions Signer { get; init; } = new();

  internal ReviewerOptions Expand() => new()
  {
    ProviderId = ProviderId,
    ReviewerId = ReviewerId,
    ModelId = ModelId,
    Endpoint = Environment.ExpandEnvironmentVariables(Endpoint),
    PinnedServerSpkiSha256 = PinnedServerSpkiSha256,
    ApiKeyEnvironmentVariable = ApiKeyEnvironmentVariable,
    TimeoutSeconds = TimeoutSeconds,
    Signer = Signer,
  };
}

public sealed class HyperVEvaluationOptions
{
  public string VmName { get; init; } = string.Empty;
  public string CleanSnapshotName { get; init; } = string.Empty;
  public string CleanSnapshotId { get; init; } = string.Empty;
  public string GuestCredentialPath { get; init; } = string.Empty;
  public string GuestRepositoryPath { get; init; } = @"C:\Itemba\repository";
  public string GuestWorkspaceRoot { get; init; } = @"C:\Itemba\evaluation";
  public string PowerShellExecutablePath { get; init; } = string.Empty;
  public string ProviderScriptPath { get; init; } = string.Empty;
  public string ProviderScriptSha256 { get; init; } = string.Empty;
  public int VmReadyTimeoutSeconds { get; init; } = 180;
  public int ProviderOperationTimeoutSeconds { get; init; } = 900;

  internal HyperVEvaluationOptions Expand()
  {
    static string E(string value) => Environment.ExpandEnvironmentVariables(value);
    return new HyperVEvaluationOptions
    {
      VmName = VmName,
      CleanSnapshotName = CleanSnapshotName,
      CleanSnapshotId = CleanSnapshotId,
      GuestCredentialPath = E(GuestCredentialPath),
      GuestRepositoryPath = GuestRepositoryPath,
      GuestWorkspaceRoot = GuestWorkspaceRoot,
      PowerShellExecutablePath = E(PowerShellExecutablePath),
      ProviderScriptPath = E(ProviderScriptPath),
      ProviderScriptSha256 = ProviderScriptSha256,
      VmReadyTimeoutSeconds = VmReadyTimeoutSeconds,
      ProviderOperationTimeoutSeconds = ProviderOperationTimeoutSeconds,
    };
  }
}

public sealed class EvaluationCommandOptions
{
  public string Check { get; init; } = string.Empty;
  public string FileName { get; init; } = string.Empty;
  public IReadOnlyList<string> Arguments { get; init; } = [];
  public string WorkingDirectory { get; init; } = ".";
  public int TimeoutSeconds { get; init; } = 300;
}
