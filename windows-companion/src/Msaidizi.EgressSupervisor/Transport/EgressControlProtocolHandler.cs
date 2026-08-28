using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.EgressSupervisor.Core;

namespace Itemba.Msaidizi.EgressSupervisor.Transport;

public sealed class EgressControlProtocolHandler(EgressSupervisorEngine engine)
{
  public async ValueTask<byte[]> HandleAsync(
    ReadOnlyMemory<byte> frameBytes,
    int authenticatedClientProcessId,
    long authenticatedClientProcessCreationTimeUnixMilliseconds,
    CancellationToken cancellationToken)
  {
    EgressSupervisorPipeFrameV1 frame;
    try
    {
      frame = JsonSerializer.Deserialize<EgressSupervisorPipeFrameV1>(
        frameBytes.Span,
        EgressSupervisorWireProtocol.StrictJson) ?? throw new JsonException();
    }
    catch (JsonException exception)
    {
      throw new InvalidDataException("The egress control frame is malformed.", exception);
    }
    if (frame.ProtocolVersion != EgressSupervisorWireProtocol.Version
      || frame.Sequence != 1
      || !Guid.TryParseExact(frame.MessageId, "D", out _)
      || !Guid.TryParseExact(frame.CorrelationId, "D", out _))
    {
      throw new InvalidDataException("The egress control frame is out of phase.");
    }

    return frame.Kind switch
    {
      EgressSupervisorWireProtocol.ReserveRequest => await ReserveAsync(
        frame,
        cancellationToken).ConfigureAwait(false),
      EgressSupervisorWireProtocol.DirectRegisterRequest => await RegisterDirectAsync(
        frame,
        authenticatedClientProcessId,
        authenticatedClientProcessCreationTimeUnixMilliseconds,
        cancellationToken).ConfigureAwait(false),
      EgressSupervisorWireProtocol.ProcessRegisterRequest => await RejectProcessAsync(frame)
        .ConfigureAwait(false),
      EgressSupervisorWireProtocol.BrowserRegisterRequest => await RegisterBrowserAsync(
        frame,
        cancellationToken).ConfigureAwait(false),
      EgressSupervisorWireProtocol.SettleRequest => await TerminalAsync(
        frame,
        abort: false,
        cancellationToken).ConfigureAwait(false),
      EgressSupervisorWireProtocol.AbortRequest => await TerminalAsync(
        frame,
        abort: true,
        cancellationToken).ConfigureAwait(false),
      EgressSupervisorWireProtocol.CapabilityAttestationRequest =>
        await CapabilityAttestationAsync(
          frame,
          authenticatedClientProcessId,
          authenticatedClientProcessCreationTimeUnixMilliseconds,
          cancellationToken).ConfigureAwait(false),
      _ => throw new InvalidDataException("The egress control operation is unsupported."),
    };
  }

  private async ValueTask<byte[]> ReserveAsync(
    EgressSupervisorPipeFrameV1 frame,
    CancellationToken cancellationToken)
  {
    var payload = Deserialize<EgressReserveRequestPayload>(frame.PayloadJson);
    if (!string.Equals(frame.CorrelationId, payload.OperationId, StringComparison.Ordinal))
    {
      throw new InvalidDataException("The egress reservation correlation is invalid.");
    }
    var authorization = await engine.ReserveAsync(payload, cancellationToken)
      .ConfigureAwait(false);
    return SerializeResponse(
      EgressSupervisorWireProtocol.ReserveResponse,
      frame.CorrelationId,
      new EgressReserveResponsePayload(authorization));
  }

  private async ValueTask<byte[]> RegisterDirectAsync(
    EgressSupervisorPipeFrameV1 frame,
    int authenticatedClientProcessId,
    long authenticatedClientProcessCreationTimeUnixMilliseconds,
    CancellationToken cancellationToken)
  {
    var payload = Deserialize<EgressDirectRegistrationRequestPayload>(frame.PayloadJson);
    var expectedCorrelation = EgressSupervisorLifecycleCanonical.OperationId(
      payload.Authorization.Lease.Lease.ActionId,
      $"register:{EgressSupervisorLifecycleContract.DirectRegistration}:"
        + payload.Registration.RegistrationId);
    if (!string.Equals(frame.CorrelationId, expectedCorrelation, StringComparison.Ordinal))
    {
      throw new InvalidDataException("The egress registration correlation is invalid.");
    }
    var acknowledgement = await engine.RegisterDirectAsync(
      payload,
      authenticatedClientProcessId,
      authenticatedClientProcessCreationTimeUnixMilliseconds,
      cancellationToken).ConfigureAwait(false);
    return SerializeResponse(
      EgressSupervisorWireProtocol.RegisterResponse,
      frame.CorrelationId,
      new EgressRegistrationResponsePayload(acknowledgement));
  }

  private static async ValueTask<byte[]> RejectProcessAsync(
    EgressSupervisorPipeFrameV1 frame)
  {
    _ = Deserialize<EgressProcessRegistrationRequestPayload>(frame.PayloadJson);
    _ = await EgressSupervisorEngine.RejectProcessRegistrationAsync().ConfigureAwait(false);
    throw new InvalidOperationException("Unreachable process-registration response path.");
  }

  private async ValueTask<byte[]> RegisterBrowserAsync(
    EgressSupervisorPipeFrameV1 frame,
    CancellationToken cancellationToken)
  {
    var payload = Deserialize<EgressBrowserRegistrationRequestPayload>(frame.PayloadJson);
    var expectedCorrelation = EgressSupervisorLifecycleCanonical.OperationId(
      payload.Authorization.Lease.Lease.ActionId,
      $"register:{EgressSupervisorLifecycleContract.BrowserRegistration}:"
        + payload.Registration.RegistrationId);
    if (!string.Equals(frame.CorrelationId, expectedCorrelation, StringComparison.Ordinal))
    {
      throw new InvalidDataException("The browser registration correlation is invalid.");
    }
    var acknowledgement = await engine.RegisterBrowserAsync(
      payload,
      cancellationToken).ConfigureAwait(false);
    return SerializeResponse(
      EgressSupervisorWireProtocol.RegisterResponse,
      frame.CorrelationId,
      new EgressRegistrationResponsePayload(acknowledgement));
  }

  private async ValueTask<byte[]> TerminalAsync(
    EgressSupervisorPipeFrameV1 frame,
    bool abort,
    CancellationToken cancellationToken)
  {
    var payload = Deserialize<EgressTerminalRequestPayload>(frame.PayloadJson);
    if (!string.Equals(
      frame.CorrelationId,
      payload.Disposition.OperationId,
      StringComparison.Ordinal))
    {
      throw new InvalidDataException("The egress terminal correlation is invalid.");
    }
    var receipt = await engine.TerminalAsync(payload, abort, cancellationToken)
      .ConfigureAwait(false);
    return SerializeResponse(
      EgressSupervisorWireProtocol.TerminalResponse,
      frame.CorrelationId,
      new EgressTerminalResponsePayload(receipt));
  }

  private async ValueTask<byte[]> CapabilityAttestationAsync(
    EgressSupervisorPipeFrameV1 frame,
    int authenticatedClientProcessId,
    long authenticatedClientProcessCreationTimeUnixMilliseconds,
    CancellationToken cancellationToken)
  {
    var payload = Deserialize<EgressCapabilityAttestationRequestPayload>(
      frame.PayloadJson);
    if (!string.Equals(
      frame.CorrelationId,
      payload.Request.RequestId,
      StringComparison.Ordinal))
    {
      throw new InvalidDataException(
        "The capability-attestation correlation is invalid.");
    }
    var attestation = await engine.IssueCapabilityBoundaryAttestationAsync(
      payload.Request,
      authenticatedClientProcessId,
      authenticatedClientProcessCreationTimeUnixMilliseconds,
      cancellationToken).ConfigureAwait(false);
    return SerializeResponse(
      EgressSupervisorWireProtocol.CapabilityAttestationResponse,
      frame.CorrelationId,
      new EgressCapabilityAttestationResponsePayload(attestation));
  }

  private static T Deserialize<T>(string json)
  {
    try
    {
      return JsonSerializer.Deserialize<T>(json, EgressSupervisorWireProtocol.StrictJson)
        ?? throw new JsonException();
    }
    catch (JsonException exception)
    {
      throw new InvalidDataException("The egress control payload is malformed.", exception);
    }
  }

  private static byte[] SerializeResponse<T>(
    string kind,
    string correlationId,
    T payload) => JsonSerializer.SerializeToUtf8Bytes(
      new EgressSupervisorPipeFrameV1(
        EgressSupervisorWireProtocol.Version,
        1,
        kind,
        Guid.NewGuid().ToString("D"),
        correlationId,
        JsonSerializer.Serialize(payload, EgressSupervisorWireProtocol.StrictJson)),
      EgressSupervisorWireProtocol.StrictJson);
}
