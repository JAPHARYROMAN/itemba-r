using Itemba.Msaidizi.AuditSigner.Configuration;
using Itemba.Msaidizi.AuditSigner.Execution;

namespace Itemba.Msaidizi.AuditSigner;

public sealed partial class AuditSignerWorker(
  AuditSignerOptions options,
  TrustedAuditSignerEngine engine,
  ILogger<AuditSignerWorker> logger) : BackgroundService
{
  private readonly AuditSignerOptions _options = options.Expand();

  protected override async Task ExecuteAsync(CancellationToken stoppingToken)
  {
    while (!stoppingToken.IsCancellationRequested)
    {
      try
      {
        await engine.RunOnceAsync(stoppingToken).ConfigureAwait(false);
      }
      catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
      {
        break;
      }
      catch (Exception error)
      {
        LogIterationFailure(logger, error);
      }
      await Task.Delay(
        TimeSpan.FromSeconds(Math.Clamp(_options.PollIntervalSeconds, 2, 300)),
        stoppingToken).ConfigureAwait(false);
    }
  }

  [LoggerMessage(
    EventId = 7301,
    Level = LogLevel.Error,
    Message = "Trusted audit-signer iteration failed closed")]
  private static partial void LogIterationFailure(ILogger logger, Exception error);
}
