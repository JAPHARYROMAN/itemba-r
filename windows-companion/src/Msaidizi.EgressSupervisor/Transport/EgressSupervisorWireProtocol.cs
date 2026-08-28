using System.Text.Json;
using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.EgressSupervisor.Transport;

public static class EgressSupervisorWireProtocol
{
  public const int Version = 2;
  public const int MinimumFrameBytes = 4_096;
  public const int MaximumFrameBytes = 262_144;

  public const string ReserveRequest = "reserve.request.v2";
  public const string ReserveResponse = "reserve.response.v2";
  public const string ProcessRegisterRequest = "register.process.request.v2";
  public const string DirectRegisterRequest = "register.direct.request.v2";
  public const string BrowserRegisterRequest = "register.browser.request.v2";
  public const string RegisterResponse = "register.response.v2";
  public const string SettleRequest = "settle.request.v2";
  public const string AbortRequest = "abort.request.v2";
  public const string TerminalResponse = "terminal.response.v2";
  public const string CapabilityAttestationRequest =
    "capability-attestation.request.v1";
  public const string CapabilityAttestationResponse =
    "capability-attestation.response.v1";

  public static JsonSerializerOptions StrictJson { get; } = new(JsonSerializerDefaults.Web)
  {
    MaxDepth = 32,
    PropertyNameCaseInsensitive = false,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
  };
}

public sealed record EgressSupervisorPipeFrameV1(
  int ProtocolVersion,
  long Sequence,
  string Kind,
  string MessageId,
  string CorrelationId,
  string PayloadJson);

public sealed record EgressReserveRequestPayload(
  int ContractVersion,
  string OperationId,
  string CompactActionToken,
  string ArgumentsJsonUtf8,
  EgressActionBinding Binding);

public sealed record EgressReserveResponsePayload(EgressExecutionAuthorization Authorization);

public sealed record EgressProcessRegistrationRequestPayload(
  int ContractVersion,
  EgressExecutionAuthorization Authorization,
  EgressProcessRegistrationV1 Registration);

public sealed record EgressDirectRegistrationRequestPayload(
  int ContractVersion,
  EgressExecutionAuthorization Authorization,
  EgressDirectRegistrationV1 Registration);

public sealed record EgressBrowserRegistrationRequestPayload(
  int ContractVersion,
  EgressExecutionAuthorization Authorization,
  EgressBrowserRegistrationV1 Registration);

public sealed record EgressRegistrationResponsePayload(
  EgressRegistrationAcknowledgementV1 Acknowledgement);

public sealed record EgressTerminalRequestPayload(
  int ContractVersion,
  EgressExecutionAuthorization Authorization,
  EgressRegistrationAcknowledgementV1? Registration,
  EgressTerminalDispositionV1 Disposition);

public sealed record EgressTerminalResponsePayload(SignedEgressReceipt Receipt);

public sealed record EgressCapabilityAttestationRequestPayload(
  CapabilityBoundaryAttestationRequestV1 Request);

public sealed record EgressCapabilityAttestationResponsePayload(
  SignedCapabilityBoundaryAttestation Attestation);
