using System.Security.Cryptography;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

/// <summary>
/// Deployment-owned selection for the separate egress data plane. Identity
/// pins and operation timeouts remain owned by EgressSupervisorClient; this
/// section selects only the distinct, local-only flow pipe and frame ceiling.
/// </summary>
public sealed class EgressSupervisorFlowClientOptions
{
  public const string SectionName = "EgressSupervisorFlowClient";

  public bool Enabled { get; set; }

  public int ProtocolVersion { get; set; } = EgressSupervisorLifecycleContract.Version;

  public string PipeName { get; set; } = string.Empty;

  public int MaximumFlowFrameBytes { get; set; } = 16_384;
}

public static class ExternalActionTransportFactory
{
  public static IExternalActionTransport Create(
    IOptions<EgressSupervisorClientOptions> controlOptions,
    IOptions<EgressSupervisorFlowClientOptions> flowOptions)
  {
    ArgumentNullException.ThrowIfNull(controlOptions);
    ArgumentNullException.ThrowIfNull(flowOptions);
    var control = controlOptions.Value;
    var flow = flowOptions.Value;
    if (!control.Enabled || !flow.Enabled)
    {
      return new RejectingExternalActionTransport();
    }

    Validate(control, flow);
    return new NamedPipeEgressSupervisorExternalActionTransport(control, flow);
  }

  internal static void Validate(
    EgressSupervisorClientOptions control,
    EgressSupervisorFlowClientOptions flow)
  {
    if (!string.Equals(control.Transport, "named-pipe-v2", StringComparison.Ordinal)
      || control.ProtocolVersion != EgressSupervisorPipeProtocol.Version
      || flow.ProtocolVersion != EgressSupervisorLifecycleContract.Version
      || !EgressSupervisorPipeProtocol.IsSafePipeName(control.PipeName)
      || !EgressSupervisorPipeProtocol.IsSafePipeName(flow.PipeName)
      || string.Equals(control.PipeName, flow.PipeName, StringComparison.Ordinal)
      || flow.MaximumFlowFrameBytes is < 1_024 or > 65_536
      || !Path.IsPathFullyQualified(control.ExpectedSupervisorImagePath)
      || !PayloadDigest.IsSha256Hex(control.ExpectedSupervisorImageSha256)
      || !string.Equals(
        control.ExpectedSupervisorServiceSid,
        EgressSupervisorClientOptions.RequiredSupervisorServiceSid,
        StringComparison.Ordinal)
      || control.ConnectTimeoutMilliseconds is < 100 or > 30_000
      || control.OperationTimeoutMilliseconds is < 100 or > 30_000)
    {
      throw new InvalidOperationException(
        "The supervisor-owned external-action transport is not safely configured.");
    }
  }
}

public sealed class RejectingExternalActionTransport : IExternalActionTransport
{
  public ValueTask<ExternalActionTransportResult> SendAsync(
    ExternalActionEndpoint endpoint,
    ExternalActionEgressFlowBinding flowBinding,
    ReadOnlyMemory<byte> requestBytes,
    int maximumResponseBytes,
    TimeSpan connectTimeout,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    return ValueTask.FromException<ExternalActionTransportResult>(
      new HostPreconditionException("egress_supervisor_flow_transport_unconfigured"));
  }
}

/// <summary>
/// Authenticates the independent LocalSystem supervisor, consumes one exact
/// registration nonce, and relays only the credential-free exact request
/// template through its named-pipe data plane. This process never opens an
/// Internet socket or owns TLS.
/// </summary>
public sealed class NamedPipeEgressSupervisorExternalActionTransport :
  IExternalActionTransport
{
  private static readonly JsonSerializerOptions StrictJson = new(JsonSerializerDefaults.Web)
  {
    MaxDepth = 16,
    PropertyNameCaseInsensitive = false,
    UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow,
  };

  private readonly EgressSupervisorClientOptions _controlOptions;
  private readonly EgressSupervisorFlowClientOptions _flowOptions;
  private readonly IEgressSupervisorPipeConnector _connector;

  public NamedPipeEgressSupervisorExternalActionTransport(
    EgressSupervisorClientOptions controlOptions,
    EgressSupervisorFlowClientOptions flowOptions)
    : this(controlOptions, flowOptions, new WindowsEgressSupervisorPipeConnector())
  {
  }

  internal NamedPipeEgressSupervisorExternalActionTransport(
    EgressSupervisorClientOptions controlOptions,
    EgressSupervisorFlowClientOptions flowOptions,
    IEgressSupervisorPipeConnector connector)
  {
    ArgumentNullException.ThrowIfNull(controlOptions);
    ArgumentNullException.ThrowIfNull(flowOptions);
    ArgumentNullException.ThrowIfNull(connector);
    ExternalActionTransportFactory.Validate(controlOptions, flowOptions);
    _controlOptions = controlOptions;
    _flowOptions = flowOptions;
    _connector = connector;
  }

  public async ValueTask<ExternalActionTransportResult> SendAsync(
    ExternalActionEndpoint endpoint,
    ExternalActionEgressFlowBinding flowBinding,
    ReadOnlyMemory<byte> requestBytes,
    int maximumResponseBytes,
    TimeSpan connectTimeout,
    CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(endpoint);
    ArgumentNullException.ThrowIfNull(flowBinding);
    if (!string.Equals(
        endpoint.Destination.IdnHost,
        flowBinding.DestinationHost,
        StringComparison.OrdinalIgnoreCase)
      || endpoint.Destination.Port != flowBinding.DestinationPort
      || !PayloadDigest.FixedTimeEqualsHex(
        endpoint.DestinationScopeSha256,
        flowBinding.DestinationScopeSha256)
      || maximumResponseBytes is < 1 or > 16_777_216
      || connectTimeout < TimeSpan.FromMilliseconds(100)
      || connectTimeout > TimeSpan.FromMinutes(2))
    {
      throw new HostPreconditionException("egress_supervisor_flow_binding_invalid");
    }

    using var operation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
    var leaseRemaining = flowBinding.LeaseExpiresAtUnixMilliseconds
      - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    operation.CancelAfter(TimeSpan.FromMilliseconds(Math.Max(1, Math.Min(
      leaseRemaining,
      _controlOptions.OperationTimeoutMilliseconds))));
    using var pipeConnect = CancellationTokenSource.CreateLinkedTokenSource(operation.Token);
    pipeConnect.CancelAfter(TimeSpan.FromMilliseconds(
      _controlOptions.ConnectTimeoutMilliseconds));
    var dataOptions = CloneForDataPipe(_controlOptions, _flowOptions.PipeName);
    await using var connection = await _connector.ConnectAsync(
      dataOptions,
      pipeConnect.Token).ConfigureAwait(false);

    var nonceBase64 = Convert.ToBase64String(flowBinding.ConnectionNonce.Span);
    var request = new EgressFlowOpenRequestV1(
      EgressSupervisorLifecycleContract.Version,
      flowBinding.LeaseSha256,
      flowBinding.RegistrationId,
      nonceBase64,
      flowBinding.DestinationHost,
      flowBinding.DestinationPort,
      flowBinding.DestinationScopeSha256);
    var claimBytes = JsonSerializer.SerializeToUtf8Bytes(request, StrictJson);
    try
    {
      if (claimBytes.Length > _flowOptions.MaximumFlowFrameBytes)
      {
        throw new HostPreconditionException("egress_supervisor_flow_claim_oversized");
      }
      await connection.WriteFrameAsync(claimBytes, operation.Token).ConfigureAwait(false);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(claimBytes);
    }

    var responseBytes = await connection.ReadFrameAsync(
      _flowOptions.MaximumFlowFrameBytes,
      operation.Token).ConfigureAwait(false);
    EgressFlowOpenResponseV1 response;
    try
    {
      response = JsonSerializer.Deserialize<EgressFlowOpenResponseV1>(
        responseBytes.Span,
        StrictJson) ?? throw new JsonException();
    }
    catch (JsonException exception)
    {
      throw new HostPreconditionException(
        "egress_supervisor_flow_response_invalid",
        exception);
    }

    if (response.ContractVersion != EgressSupervisorLifecycleContract.Version
      || !response.Accepted
      || !Guid.TryParseExact(response.FlowId, "D", out _)
      || !string.Equals(response.Code, "accepted", StringComparison.Ordinal))
    {
      throw new HostPreconditionException(
        response.Code.Length is >= 1 and <= 160
          ? response.Code
          : "egress_supervisor_flow_refused");
    }

    connection.ThrowIfUnavailable();
    await connection.WriteFrameAsync(requestBytes, operation.Token).ConfigureAwait(false);
    var transferBytes = await connection.ReadFrameAsync(
      _flowOptions.MaximumFlowFrameBytes,
      operation.Token).ConfigureAwait(false);
    EgressFlowTransferResponseV1 transfer;
    try
    {
      transfer = JsonSerializer.Deserialize<EgressFlowTransferResponseV1>(
        transferBytes.Span,
        StrictJson) ?? throw new JsonException();
    }
    catch (JsonException exception)
    {
      throw new HostPreconditionException(
        "egress_supervisor_transfer_response_invalid",
        exception);
    }
    if (transfer.ContractVersion != EgressSupervisorLifecycleContract.Version
      || transfer.MeasuredExternalEgressBytes < 0
      || transfer.MeasuredExternalEgressBytes > flowBinding.MaximumExternalEgressBytes
      || transfer.ResponseBytes < 0
      || transfer.ResponseBytes > maximumResponseBytes
      || transfer.Code.Length is < 1 or > 160)
    {
      throw new HostPreconditionException("egress_supervisor_transfer_response_invalid");
    }
    var responsePayload = transfer.ResponseBytes == 0
      ? []
      : (await connection.ReadFrameAsync(
          maximumResponseBytes,
          operation.Token).ConfigureAwait(false)).ToArray();
    if (responsePayload.Length != transfer.ResponseBytes)
    {
      CryptographicOperations.ZeroMemory(responsePayload);
      throw new HostPreconditionException("egress_supervisor_transfer_response_invalid");
    }
    return new ExternalActionTransportResult(
      transfer.RequestDispatched,
      transfer.MeasuredExternalEgressBytes,
      responsePayload,
      transfer.Code);
  }

  private static EgressSupervisorClientOptions CloneForDataPipe(
    EgressSupervisorClientOptions source,
    string pipeName) => new()
    {
      Enabled = source.Enabled,
      Transport = source.Transport,
      ProtocolVersion = source.ProtocolVersion,
      PipeName = pipeName,
      ExpectedSupervisorImagePath = source.ExpectedSupervisorImagePath,
      ExpectedSupervisorImageSha256 = source.ExpectedSupervisorImageSha256,
      ExpectedSupervisorServiceSid = source.ExpectedSupervisorServiceSid,
      AttestationKeyId = source.AttestationKeyId,
      MaximumFrameBytes = source.MaximumFrameBytes,
      ConnectTimeoutMilliseconds = source.ConnectTimeoutMilliseconds,
      OperationTimeoutMilliseconds = source.OperationTimeoutMilliseconds,
    };

}
