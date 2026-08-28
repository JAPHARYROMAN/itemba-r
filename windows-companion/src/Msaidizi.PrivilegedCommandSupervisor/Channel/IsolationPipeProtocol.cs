using System.Text.Json;
using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Channel;

internal static class IsolationPipeProtocol
{
  public const int Version = 2;
  public const string ReserveRequest = "reserve.request.v2";
  public const string ReserveResponse = "reserve.response.v2";
  public const string ReleaseRequest = "pre-bind-release.request.v2";
  public const string ReleaseResponse = "pre-bind-release.response.v2";
  public const string BindRequest = "suspended-bind.request.v2";
  public const string BindResponse = "suspended-bind.response.v2";
  public const string SettleRequest = "terminal-settle.request.v2";
  public const string SettleResponse = "terminal-settle.response.v2";
  public const string RecoverReservationRequest =
    "recover-pending-reservation.request.v2";
  public const string RecoverReservationResponse =
    "recover-pending-reservation.response.v2";
  public const string RecoverBindRequest = "recover-pending-bind.request.v2";
  public const string RecoverBindResponse = "recover-pending-bind.response.v2";

  public static JsonSerializerOptions SerializerOptions { get; } = new(
    JsonSerializerDefaults.Web)
  {
    MaxDepth = 32,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
  };
}

internal sealed record IsolationPipeFrameV1(
  int ProtocolVersion,
  long Sequence,
  string Kind,
  string MessageId,
  string CorrelationId,
  string PayloadJson);

internal sealed record ReserveRequestPayload(
  PrivilegedCommandIsolationReservationRequestV1 Request,
  string CompactActionToken,
  ActionRequest ActionRequest,
  PrivilegedCommandIsolationInvocationV2 Invocation);

internal sealed record ReserveResponsePayload(
  SignedPrivilegedCommandIsolationReservationLease SignedLease);

internal sealed record ReleaseRequestPayload(
  PrivilegedCommandIsolationReservationRequestV1 Request,
  SignedPrivilegedCommandIsolationReservationLease SignedLease,
  string Outcome);

internal sealed record ReleaseResponsePayload(
  SignedPrivilegedCommandIsolationPreBindRelease SignedRelease);

public sealed record SuspendedProcessObservation(
  int ParentProcessId,
  long ParentProcessCreationTimeUtcFileTime,
  int ChildProcessId,
  long ChildProcessCreationTimeUtcFileTime,
  int PrimaryThreadId,
  string ImagePathSha256,
  string ImageSha256,
  uint ImageVolumeSerialNumber,
  ulong ImageFileId,
  string CommandLineSha256,
  string WorkingDirectorySha256,
  string EnvironmentBlockSha256,
  string InvocationSha256,
  bool CreatedSuspended,
  bool AssignedToJob);

internal sealed record BindRequestPayload(
  PrivilegedCommandIsolationReservationRequestV1 Request,
  SignedPrivilegedCommandIsolationReservationLease SignedLease,
  SuspendedProcessObservation Observation,
  PrivilegedCommandIsolationInvocationV2 Invocation);

public sealed record BindResponsePayload(
  PrivilegedCommandSuspendedProcessBindingV1 Binding,
  SignedPrivilegedCommandIsolationBindAcknowledgement SignedAcknowledgement);

public sealed record TerminalObservation(
  bool ProcessResumed,
  bool ExitCodeKnown,
  int ExitCode,
  string Outcome);

internal sealed record SettleRequestPayload(
  PrivilegedCommandIsolationReservationRequestV1 Request,
  SignedPrivilegedCommandIsolationReservationLease SignedLease,
  PrivilegedCommandSuspendedProcessBindingV1 Binding,
  SignedPrivilegedCommandIsolationBindAcknowledgement SignedAcknowledgement,
  TerminalObservation Observation);

internal sealed record SettleResponsePayload(
  SignedPrivilegedCommandIsolationTerminalReceipt SignedReceipt);

internal sealed record RecoverReservationRequestPayload(
  PrivilegedCommandIsolationPendingReservation Pending);

internal sealed record RecoverBindRequestPayload(
  PrivilegedCommandIsolationPendingBind Pending);

public sealed record PipePeerIdentity(
  int ProcessId,
  long ProcessCreationTimeUtcFileTime,
  string ImagePathSha256,
  string ImageSha256);
