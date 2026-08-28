using Itemba.Msaidizi.Companion.Contracts.Channel;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Channel;

/// <summary>
/// Reconciles the immutable, process-local capability manifest with the broker.
/// A failed initial HTTP response must not leave the device ping-only until the
/// Windows service restarts. Manifest publication is idempotent, so it is safe
/// to retry in bounded transport sessions until one is acknowledged.
/// </summary>
public sealed class CapabilityManifestPublisher(
  IOptions<CompanionOptions> companionOptions,
  IOptions<BrokerChannelOptions> brokerOptions,
  CapabilityRegistry capabilities,
  IOutboundCompanionChannel channel,
  ILogger<CapabilityManifestPublisher> logger)
{
  private static readonly Action<ILogger, int, string, Exception?> LogManifestSendFailure =
    LoggerMessage.Define<int, string>(
      LogLevel.Warning,
      new EventId(1103, nameof(LogManifestSendFailure)),
      "Could not publish the capability manifest in reconciliation session {Session}; transport raised {ExceptionType}.");

  private readonly TimeSpan _initialRetryDelay = TimeSpan.FromMilliseconds(Math.Clamp(
    brokerOptions.Value.InitialRetryDelayMilliseconds,
    1,
    checked(Math.Clamp(brokerOptions.Value.MaximumRetryDelaySeconds, 1, 300) * 1_000)));
  private readonly TimeSpan _maximumRetryDelay = TimeSpan.FromSeconds(Math.Clamp(
    brokerOptions.Value.MaximumRetryDelaySeconds,
    1,
    300));

  public async Task<string> PublishUntilAcknowledgedAsync(
    CancellationToken cancellationToken)
  {
    var session = 0;
    while (true)
    {
      cancellationToken.ThrowIfCancellationRequested();
      session++;
      try
      {
        var snapshot = capabilities.Snapshot();
        await channel.SendManifestAsync(new CapabilityManifestSnapshot(
          companionOptions.Value.DeviceId,
          snapshot.ManifestSha256,
          snapshot.Descriptors,
          DateTimeOffset.UtcNow,
          CompanionCommandProtocol.CurrentVersion), cancellationToken).ConfigureAwait(false);
        return snapshot.ManifestSha256;
      }
      catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
      {
        throw;
      }
      catch (Exception exception)
      {
        LogManifestSendFailure(logger, session, exception.GetType().Name, exception);
      }

      await Task.Delay(RetryDelay(session), cancellationToken).ConfigureAwait(false);
    }
  }

  public async Task PublishChangesAsync(
    string lastAcknowledgedManifestSha256,
    CancellationToken cancellationToken)
  {
    var acknowledged = lastAcknowledgedManifestSha256;
    using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
    while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
    {
      var snapshot = capabilities.Snapshot();
      if (string.Equals(
        snapshot.ManifestSha256,
        acknowledged,
        StringComparison.Ordinal))
      {
        continue;
      }

      try
      {
        await channel.SendManifestAsync(new CapabilityManifestSnapshot(
          companionOptions.Value.DeviceId,
          snapshot.ManifestSha256,
          snapshot.Descriptors,
          DateTimeOffset.UtcNow,
          CompanionCommandProtocol.CurrentVersion), cancellationToken).ConfigureAwait(false);
        acknowledged = snapshot.ManifestSha256;
      }
      catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
      {
        throw;
      }
      catch (Exception exception)
      {
        LogManifestSendFailure(logger, 0, exception.GetType().Name, exception);
      }
    }
  }

  private TimeSpan RetryDelay(int failedSession)
  {
    var exponent = Math.Min(Math.Max(0, failedSession - 1), 10);
    var delayMilliseconds = Math.Min(
      _maximumRetryDelay.TotalMilliseconds,
      _initialRetryDelay.TotalMilliseconds * (1L << exponent));
    return TimeSpan.FromMilliseconds(delayMilliseconds);
  }
}
