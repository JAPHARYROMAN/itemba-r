using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;

namespace Itemba.Msaidizi.Companion.Contracts.Security;

/// <summary>
/// Versioned operations exchanged with the independently installed egress
/// supervisor. These records describe lifecycle and one-time flow claims only;
/// they do not themselves provide WFP enforcement, process attribution, byte
/// metering, or a browser broker.
/// </summary>
public static class EgressSupervisorLifecycleContract
{
  public const int Version = 2;

  public const string ProcessRegistration = "process";
  public const string DirectRegistration = "direct";
  public const string BrowserRegistration = "browser";

  public const string Completed = "completed";
  public const string Failed = "failed";
  public const string Cancelled = "cancelled";
  public const string Unknown = "unknown";

  public static IReadOnlySet<string> TerminalOutcomes { get; } = new HashSet<string>(
    [Completed, Failed, Cancelled, Unknown],
    StringComparer.Ordinal);
}

public sealed record EgressProcessRegistrationV1(
  int ContractVersion,
  string RegistrationId,
  int ProcessId,
  long ProcessCreationTimeUnixMilliseconds,
  string ExecutableSha256,
  string ExecutablePathSha256,
  string OwnedJobIdentitySha256,
  bool CreatedSuspended);

public sealed record EgressDirectRegistrationV1(
  int ContractVersion,
  string RegistrationId,
  int ProcessId,
  long ProcessCreationTimeUnixMilliseconds,
  string NetworkProtocol,
  string DestinationHost,
  int DestinationPort,
  string DestinationPolicySha256,
  string DestinationScopeSha256,
  string ReservationDnsAnswerSetSha256,
  string ConnectionNonceSha256,
  [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  ExactExternalActionDestination? ExactDestination = null);

/// <summary>
/// One-time claim used to consume an acknowledged direct registration on the
/// supervisor-owned named-pipe data plane. The nonce preimage is never written
/// to either service's durable journal.
/// </summary>
public sealed record EgressFlowOpenRequestV1(
  int ContractVersion,
  string LeaseSha256,
  string RegistrationId,
  string ConnectionNonceBase64,
  string DestinationHost,
  int DestinationPort,
  string DestinationScopeSha256);

public sealed record EgressFlowOpenResponseV1(
  int ContractVersion,
  bool Accepted,
  string FlowId,
  string Code);

/// <summary>
/// Result of the supervisor-owned TLS exchange. The following framed payload
/// contains exactly <see cref="ResponseBytes"/> remote HTTP bytes. The byte
/// count is the supervisor's ciphertext measurement, not caller telemetry.
/// </summary>
public sealed record EgressFlowTransferResponseV1(
  int ContractVersion,
  bool RequestDispatched,
  long MeasuredExternalEgressBytes,
  int ResponseBytes,
  string Code);

public sealed record EgressBrowserRegistrationV1(
  int ContractVersion,
  string RegistrationId,
  int WindowsSessionId,
  int BrowserBrokerProcessId,
  string OriginSha256,
  string BrowserBrokerBuildSha256,
  string CompletionNonceSha256,
  long BrowserBrokerProcessCreationTimeUnixMilliseconds = 0,
  string BrowserBrokerImageSha256 = "",
  string ActionPolicySha256 = "");

public sealed record EgressRegistrationAcknowledgementV1(
  int ContractVersion,
  string OperationId,
  string RegistrationId,
  string RegistrationKind,
  string LeaseSha256,
  string RegistrationSha256,
  long AcceptedAtUnixMilliseconds);

public sealed record EgressTerminalDispositionV1(
  int ContractVersion,
  string OperationId,
  string Outcome,
  long ReportedExternalEgressBytes,
  bool OutcomeUncertain,
  long OccurredAtUnixMilliseconds);

/// <summary>
/// One exact supervisor reservation. A capability using this session must
/// register the real effect boundary before native or remote execution. The
/// only terminal evidence accepted by the coordinator is returned by this
/// session, never by a capability result.
/// </summary>
public interface IEgressBoundarySession : IAsyncDisposable
{
  EgressExecutionAuthorization Authorization { get; }

  bool HasRegistration { get; }

  bool IsTerminal { get; }

  SignedEgressReceipt? TerminalReceipt { get; }

  ValueTask<EgressRegistrationAcknowledgementV1?> TryRegisterProcessAsync(
    EgressProcessRegistrationV1 registration,
    CancellationToken cancellationToken);

  ValueTask<EgressRegistrationAcknowledgementV1?> TryRegisterDirectAsync(
    EgressDirectRegistrationV1 registration,
    CancellationToken cancellationToken);

  ValueTask<EgressRegistrationAcknowledgementV1?> TryRegisterBrowserAsync(
    EgressBrowserRegistrationV1 registration,
    CancellationToken cancellationToken);

  ValueTask<SignedEgressReceipt?> TrySettleAsync(
    EgressTerminalDispositionV1 disposition,
    CancellationToken cancellationToken);

  ValueTask<SignedEgressReceipt?> TryAbortAsync(
    EgressTerminalDispositionV1 disposition,
    CancellationToken cancellationToken);
}

public static class EgressSupervisorLifecycleCanonical
{
  public static readonly string ZeroSha256 = new('0', 64);

  public static string OperationId(string actionId, string purpose)
  {
    var bytes = Encoding.UTF8.GetBytes($"{actionId}\n{purpose}");
    try
    {
      var digest = SHA256.HashData(bytes);
      try
      {
        // Set RFC 4122 version/variant bits. The resulting identifier is a
        // deterministic idempotency key, not a source of authorization.
        digest[6] = (byte)((digest[6] & 0x0f) | 0x50);
        digest[8] = (byte)((digest[8] & 0x3f) | 0x80);
        return new Guid(digest.AsSpan(0, 16), bigEndian: true).ToString("D");
      }
      finally
      {
        CryptographicOperations.ZeroMemory(digest);
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(bytes);
    }
  }

  public static string RegistrationSha256(EgressProcessRegistrationV1 value) => Digest(
    EgressSupervisorLifecycleContract.ProcessRegistration,
    Number(value.ContractVersion),
    value.RegistrationId,
    Number(value.ProcessId),
    Number(value.ProcessCreationTimeUnixMilliseconds),
    value.ExecutableSha256,
    value.ExecutablePathSha256,
    value.OwnedJobIdentitySha256,
    Boolean(value.CreatedSuspended));

  public static string RegistrationSha256(EgressDirectRegistrationV1 value)
  {
    var fields = new List<string>
    {
      EgressSupervisorLifecycleContract.DirectRegistration,
      Number(value.ContractVersion),
      value.RegistrationId,
      Number(value.ProcessId),
      Number(value.ProcessCreationTimeUnixMilliseconds),
      value.NetworkProtocol,
      value.DestinationHost,
      Number(value.DestinationPort),
      value.DestinationPolicySha256,
      value.DestinationScopeSha256,
      value.ReservationDnsAnswerSetSha256,
      value.ConnectionNonceSha256,
    };
    if (value.ExactDestination is { } exact)
    {
      fields.Add("exact-external-destination-v1");
      fields.Add(exact.Authority);
      fields.Add(exact.EndpointId);
      fields.Add(exact.AbsoluteHttpsUri);
      fields.Add(exact.ServerCertificateSha256);
      fields.Add(exact.VaultReferenceId);
      fields.Add(exact.VaultRecordSha256);
      fields.Add(exact.HeaderPrefix);
    }
    return Digest([.. fields]);
  }

  public static string RegistrationSha256(EgressBrowserRegistrationV1 value) => Digest(
    EgressSupervisorLifecycleContract.BrowserRegistration,
    Number(value.ContractVersion),
    value.RegistrationId,
    Number(value.WindowsSessionId),
    Number(value.BrowserBrokerProcessId),
    value.OriginSha256,
    value.BrowserBrokerBuildSha256,
    value.CompletionNonceSha256,
    Number(value.BrowserBrokerProcessCreationTimeUnixMilliseconds),
    value.BrowserBrokerImageSha256,
    value.ActionPolicySha256);

  public static string DispositionSha256(EgressTerminalDispositionV1 value) => Digest(
    Number(value.ContractVersion),
    value.OperationId,
    value.Outcome,
    Number(value.ReportedExternalEgressBytes),
    Boolean(value.OutcomeUncertain),
    Number(value.OccurredAtUnixMilliseconds));

  private static string Digest(params string[] fields)
  {
    var bytes = Encoding.UTF8.GetBytes(string.Join('\n', fields));
    try
    {
      return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }
    finally
    {
      CryptographicOperations.ZeroMemory(bytes);
    }
  }

  private static string Number(long value) => value.ToString(CultureInfo.InvariantCulture);

  private static string Boolean(bool value) => value ? "true" : "false";
}
