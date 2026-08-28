namespace Itemba.Msaidizi.RecoverySupervisor.Configuration;

public sealed class RecoverySupervisorOptions
{
  public const string SectionName = "MsaidiziRecoverySupervisor";

  public string DeviceId { get; init; } = string.Empty;
  public string BrokerBaseUri { get; init; } = string.Empty;
  public string ClientCertificateThumbprint { get; init; } = string.Empty;
  public string EnrollmentId { get; init; } = string.Empty;
  public string EnrollmentCode { get; init; } = string.Empty;
  public string SupervisorRoot { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\recovery";
  public string JournalPath { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\recovery\journal.jsonl";
  public string ResultCachePath { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\recovery\results";
  public string KillSwitchPath { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\DISABLED";
  public string PinnedRecoveryPublicKeyPath { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\recovery\recovery-public.pem";
  public string PinnedRecoveryPublicKeySha256 { get; init; } = string.Empty;
  public string RecoveryKeyId { get; init; } = string.Empty;
  public int PollIntervalSeconds { get; init; } = 10;

  public RecoverySupervisorOptions Expand()
  {
    static string E(string value) => Environment.ExpandEnvironmentVariables(value);
    return new RecoverySupervisorOptions
    {
      DeviceId = DeviceId,
      BrokerBaseUri = BrokerBaseUri,
      ClientCertificateThumbprint = ClientCertificateThumbprint,
      EnrollmentId = EnrollmentId,
      EnrollmentCode = EnrollmentCode,
      SupervisorRoot = E(SupervisorRoot),
      JournalPath = E(JournalPath),
      ResultCachePath = E(ResultCachePath),
      KillSwitchPath = E(KillSwitchPath),
      PinnedRecoveryPublicKeyPath = E(PinnedRecoveryPublicKeyPath),
      PinnedRecoveryPublicKeySha256 = PinnedRecoveryPublicKeySha256,
      RecoveryKeyId = RecoveryKeyId,
      PollIntervalSeconds = PollIntervalSeconds,
    };
  }
}
