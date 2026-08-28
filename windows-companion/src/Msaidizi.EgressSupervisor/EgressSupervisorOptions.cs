namespace Itemba.Msaidizi.EgressSupervisor;

public sealed class EgressSupervisorOptions
{
  public const string SectionName = "EgressSupervisor";

  public bool Enabled { get; set; }

  public string PipeName { get; set; } = "Itemba.Msaidizi.EgressSupervisor.v2";

  public string DataPipeName { get; set; } = "Itemba.Msaidizi.EgressSupervisor.Flow.v2";

  public string CompanionServiceName { get; set; } =
    EgressSupervisorTrustIdentity.CompanionServiceName;

  public string SupervisorServiceName { get; set; } =
    EgressSupervisorTrustIdentity.ServiceName;

  public string CompanionImagePath { get; set; } = string.Empty;

  public string CompanionImageSha256 { get; set; } = string.Empty;

  /// <summary>
  /// Exact standard-user Agent image admitted as the subject of a signed
  /// capability-activation attestation. Empty packaged pins keep that path off.
  /// </summary>
  public string AgentImagePath { get; set; } = string.Empty;

  public string AgentImageSha256 { get; set; } = string.Empty;

  public int MaximumControlFrameBytes { get; set; } = 262_144;

  public int MaximumFlowHeaderBytes { get; set; } = 16_384;

  public int MaximumConcurrentFlows { get; set; } = 64;

  public int ConnectTimeoutSeconds { get; set; } = 30;

  public int FlowOperationTimeoutSeconds { get; set; } = 120;

  public int MaximumRequestBytes { get; set; } = 1_048_576;

  public int MaximumResponseBytes { get; set; } = 16_777_216;

  public int FlowCompletionSettlementTimeoutMilliseconds { get; set; } = 5_000;

  public string JournalPath { get; set; } = string.Empty;

  public string KillSwitchPath { get; set; } = string.Empty;

  public string SecretVaultPath { get; set; } = string.Empty;

  public string DestinationPolicyPath { get; set; } = string.Empty;

  public string ExpectedIssuer { get; set; } = "itemba-msaidizi-broker";

  public string ExpectedAudience { get; set; } = "itemba-windows-companion";

  public string ExpectedSubject { get; set; } = "msaidizi-global";

  public int AllowedClockSkewSeconds { get; set; } = 30;

  public int MaximumTokenLifetimeSeconds { get; set; } = 900;

  public int AttestationLifetimeSeconds { get; set; } = 300;

  public int CapabilityAttestationLifetimeSeconds { get; set; } = 60;

  public int LeaseLifetimeSeconds { get; set; } = 600;

  public string TokenVerificationCertificateThumbprint { get; set; } = string.Empty;

  public string TokenVerificationKeyId { get; set; } = string.Empty;

  public string AttestationKeyId { get; set; } = string.Empty;

  public string AttestationCertificateThumbprint { get; set; } = string.Empty;

  public string ReceiptKeyId { get; set; } = string.Empty;

  public string ReceiptCertificateThumbprint { get; set; } = string.Empty;

  public string DeviceId { get; set; } = string.Empty;

  public string SupervisorInstanceId { get; set; } = string.Empty;

  public bool SecureBootEnabled { get; set; }

  public bool HvciEnabled { get; set; }

  public bool DriverActive { get; set; }

  public string DriverServiceName { get; set; } = string.Empty;

  public string DriverImagePath { get; set; } = string.Empty;

  public string DriverDevicePath { get; set; } = string.Empty;

  public uint DriverHealthIoControlCode { get; set; }

  public string DriverMeasurementSha256 { get; set; } = string.Empty;

  public string ServiceMeasurementSha256 { get; set; } = string.Empty;
}
