using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Journal;

namespace Itemba.Msaidizi.Companion.Contracts.Channel;

public enum OutboundChannelState
{
  Disabled,
  Disconnected,
  Connecting,
  Connected,
  Faulted,
}

public sealed record MutualTlsChannelConfiguration(
  Uri BrokerEndpoint,
  string DeviceCertificateThumbprint,
  string ServerCertificateSha256Pin,
  TimeSpan ConnectTimeout,
  TimeSpan HeartbeatInterval);

/// <summary>
/// An outbound-only, mutually authenticated transport. Implementations must not
/// bind or listen on a local TCP/HTTP endpoint.
/// </summary>
public interface IOutboundCompanionChannel : IAsyncDisposable
{
  OutboundChannelState State { get; }

  bool IsCentralLedgerConnected { get; }

  ValueTask ConnectAsync(CancellationToken cancellationToken);

  ValueTask<JournalCentralHead> GetJournalHeadAsync(
    JournalCentralHeadRequest request,
    CancellationToken cancellationToken) =>
    ValueTask.FromException<JournalCentralHead>(
      new NotSupportedException("The channel does not implement journal-head lookup."));

  ValueTask<JournalReconciliationAcknowledgement> ReconcileJournalAsync(
    JournalReconciliationRequest request,
    CancellationToken cancellationToken) =>
    ValueTask.FromException<JournalReconciliationAcknowledgement>(
      new NotSupportedException("The channel does not implement journal reconciliation."));

  IAsyncEnumerable<DeviceCommand> ReadCommandsAsync(CancellationToken cancellationToken);

  ValueTask<ActionProgressAcknowledgement> SendProgressAsync(
    ActionProgress progress,
    CancellationToken cancellationToken);

  ValueTask SendResultAsync(ActionResult result, CancellationToken cancellationToken);

  ValueTask SendActionFencedAsync(
    ActionFencedReceipt receipt,
    CancellationToken cancellationToken) => ValueTask.FromException(
      new NotSupportedException("The channel does not implement protocol-v3 action fencing."));

  ValueTask SendHeartbeatAsync(CompanionHeartbeat heartbeat, CancellationToken cancellationToken);

  ValueTask SendManifestAsync(
    CapabilityManifestSnapshot manifest,
    CancellationToken cancellationToken);
}

/// <summary>
/// Low-level seam for an HTTP/2, WebSocket, or gRPC implementation with mTLS.
/// The service and tray agent depend on this seam, not on an inbound listener.
/// </summary>
public interface IMutualTlsClientTransport : IAsyncDisposable
{
  bool IsConnected { get; }

  ValueTask ConnectOutboundAsync(
    MutualTlsChannelConfiguration configuration,
    CancellationToken cancellationToken);

  IAsyncEnumerable<ReadOnlyMemory<byte>> ReceiveAsync(
    CancellationToken cancellationToken);

  ValueTask SendAsync(ReadOnlyMemory<byte> message, CancellationToken cancellationToken);
}
