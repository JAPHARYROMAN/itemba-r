using Itemba.Msaidizi.RecoverySupervisor.Channel;
using Itemba.Msaidizi.RecoverySupervisor.Configuration;
using Itemba.Msaidizi.RecoverySupervisor.Execution;

namespace Itemba.Msaidizi.RecoverySupervisor;

public sealed partial class RecoverySupervisorWorker(
  RecoverySupervisorOptions options,
  TrustedRecoveryEngine engine,
  IRecoveryBrokerClient broker,
  ILogger<RecoverySupervisorWorker> logger) : BackgroundService
{
  private readonly RecoverySupervisorOptions _options = options.Expand();

  protected override async Task ExecuteAsync(CancellationToken stoppingToken)
  {
    if (!string.IsNullOrWhiteSpace(_options.EnrollmentId) &&
        !string.IsNullOrWhiteSpace(_options.EnrollmentCode))
    {
      await broker.EnrollAsync(
        _options.DeviceId,
        _options.EnrollmentId,
        _options.EnrollmentCode,
        stoppingToken).ConfigureAwait(false);
    }

    while (!stoppingToken.IsCancellationRequested)
    {
      try
      {
        if (File.Exists(_options.KillSwitchPath))
        {
          await Delay(stoppingToken).ConfigureAwait(false);
          continue;
        }
        var command = await broker.PollAsync(_options.DeviceId, stoppingToken)
          .ConfigureAwait(false);
        if (command is not null)
        {
          var result = await engine.ExecuteAsync(
            command,
            broker.ReportProgressAsync,
            stoppingToken).ConfigureAwait(false);
          await broker.ReportResultAsync(result, stoppingToken).ConfigureAwait(false);
        }
      }
      catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
      {
        break;
      }
      catch (Exception error)
      {
        LogIterationFailure(logger, error);
      }
      await Delay(stoppingToken).ConfigureAwait(false);
    }
  }

  private Task Delay(CancellationToken cancellationToken) => Task.Delay(
    TimeSpan.FromSeconds(Math.Clamp(_options.PollIntervalSeconds, 2, 300)),
    cancellationToken);

  [LoggerMessage(
    EventId = 7201,
    Level = LogLevel.Error,
    Message = "Trusted recovery-supervisor iteration failed closed")]
  private static partial void LogIterationFailure(ILogger logger, Exception error);
}
