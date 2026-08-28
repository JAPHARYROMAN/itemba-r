namespace Itemba.Msaidizi.AuditSigner.Configuration;

public sealed class AuditSignerOptions
{
  public const string SectionName = "MsaidiziAuditSigner";

  public string BrokerBaseUri { get; init; } = string.Empty;
  public string ClientCertificateThumbprint { get; init; } = string.Empty;
  public string SignerKeyId { get; init; } = string.Empty;
  public string HardwareKeyProvider { get; init; } = "Microsoft Platform Crypto Provider";
  public string PinnedBrokerCertificateSha256 { get; init; } = string.Empty;
  public string PinnedBrokerSpkiSha256 { get; init; } = string.Empty;
  public string SupervisorRoot { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\audit-signer";
  public string JournalPath { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\audit-signer\journal.jsonl";
  public string KillSwitchPath { get; init; } =
    @"%ProgramData%\Itemba\Msaidizi\supervisor\DISABLED";
  public int MaxSegmentEvents { get; init; } = 256;
  public int CheckpointTtlSeconds { get; init; } = 300;
  public int PollIntervalSeconds { get; init; } = 10;

  public AuditSignerOptions Expand()
  {
    static string E(string value) => Environment.ExpandEnvironmentVariables(value);
    return new AuditSignerOptions
    {
      BrokerBaseUri = BrokerBaseUri,
      ClientCertificateThumbprint = ClientCertificateThumbprint,
      SignerKeyId = SignerKeyId,
      HardwareKeyProvider = HardwareKeyProvider,
      PinnedBrokerCertificateSha256 = PinnedBrokerCertificateSha256,
      PinnedBrokerSpkiSha256 = PinnedBrokerSpkiSha256,
      SupervisorRoot = E(SupervisorRoot),
      JournalPath = E(JournalPath),
      KillSwitchPath = E(KillSwitchPath),
      MaxSegmentEvents = MaxSegmentEvents,
      CheckpointTtlSeconds = CheckpointTtlSeconds,
      PollIntervalSeconds = PollIntervalSeconds,
    };
  }
}
