using System.Runtime.CompilerServices;
using Itemba.Msaidizi.Companion.Contracts.Channel;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Journal;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Channel;

/// <summary>
/// Fail-closed transport used until the broker-specific mTLS stream is supplied.
/// It accepts no commands and never reports ledger connectivity.
/// </summary>
public sealed class DisabledOutboundCompanionChannel(
  IOptions<BrokerChannelOptions> options,
  ILogger<DisabledOutboundCompanionChannel> logger) : IOutboundCompanionChannel
{
  private static readonly Action<ILogger, Exception?> LogChannelDisabled =
    LoggerMessage.Define(
      LogLevel.Warning,
      new EventId(1000, nameof(LogChannelDisabled)),
      "The broker channel is disabled. The companion will heartbeat locally and execute no mutations.");

  public OutboundChannelState State => OutboundChannelState.Disabled;

  public bool IsCentralLedgerConnected => false;

  public ValueTask ConnectAsync(CancellationToken cancellationToken)
  {
    if (options.Value.Enabled)
    {
      throw new InvalidOperationException(
        "BrokerChannel.Enabled is true, but no reviewed mTLS broker transport is installed.");
    }

    LogChannelDisabled(logger, null);
    return ValueTask.CompletedTask;
  }

  public ValueTask<JournalReconciliationAcknowledgement> ReconcileJournalAsync(
    JournalReconciliationRequest request,
    CancellationToken cancellationToken) =>
    ValueTask.FromException<JournalReconciliationAcknowledgement>(
      new InvalidOperationException("The central journal ledger is unavailable."));

  public ValueTask<JournalCentralHead> GetJournalHeadAsync(
    JournalCentralHeadRequest request,
    CancellationToken cancellationToken) =>
    ValueTask.FromException<JournalCentralHead>(
      new InvalidOperationException("The central journal ledger is unavailable."));

  public async IAsyncEnumerable<DeviceCommand> ReadCommandsAsync(
    [EnumeratorCancellation] CancellationToken cancellationToken)
  {
    await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken).ConfigureAwait(false);
    yield break;
  }

  public ValueTask<ActionProgressAcknowledgement> SendProgressAsync(
    ActionProgress progress,
    CancellationToken cancellationToken) => ValueTask.FromResult(
      new ActionProgressAcknowledgement(Accepted: false));

  public ValueTask SendResultAsync(
    ActionResult result,
    CancellationToken cancellationToken) => ValueTask.CompletedTask;

  public ValueTask SendActionFencedAsync(
    ActionFencedReceipt receipt,
    CancellationToken cancellationToken) => ValueTask.CompletedTask;

  public ValueTask SendHeartbeatAsync(
    CompanionHeartbeat heartbeat,
    CancellationToken cancellationToken) => ValueTask.CompletedTask;

  public ValueTask SendManifestAsync(
    CapabilityManifestSnapshot manifest,
    CancellationToken cancellationToken) => ValueTask.CompletedTask;

  public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
