using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor;

/// <summary>
/// Packaged safe-off state. It keeps the SCM dependency healthy while opening
/// no pipe, key, journal, process, or driver handle. Provisioning must replace
/// the signed configuration and explicitly set Enabled=true.
/// </summary>
public sealed partial class DisabledSupervisorWorker(
  ILogger<DisabledSupervisorWorker> logger) : BackgroundService
{
  protected override async Task ExecuteAsync(CancellationToken stoppingToken)
  {
    LogSafeOff(logger);
    await Task.Delay(Timeout.InfiniteTimeSpan, stoppingToken).ConfigureAwait(false);
  }

  [LoggerMessage(
    EventId = 8100,
    Level = LogLevel.Warning,
    Message = "Privileged-command isolation supervisor is installed in safe-off mode")]
  private static partial void LogSafeOff(ILogger logger);
}
