using Itemba.Msaidizi.PrivilegedCommandSupervisor.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Supervision;

/// <summary>
/// Independent one-second local kill-switch watch. Engagement stops pipe
/// dispatch and disposes the driver connection, whose close contract kills
/// every still-owned process tree.
/// </summary>
public sealed partial class IsolationKillSwitchMonitor(
  PrivilegedCommandSupervisorOptions options,
  IHostApplicationLifetime lifetime,
  ILogger<IsolationKillSwitchMonitor> logger) : BackgroundService
{
  protected override async Task ExecuteAsync(CancellationToken stoppingToken)
  {
    while (!stoppingToken.IsCancellationRequested)
    {
      if (TrustedKillSwitch.IsEngaged(options.KillSwitchPath))
      {
        LogEngaged(logger);
        lifetime.StopApplication();
        return;
      }
      await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken).ConfigureAwait(false);
    }
  }

  [LoggerMessage(
    EventId = 8120,
    Level = LogLevel.Critical,
    Message = "Privileged-command supervisor kill switch engaged; stopping fail-closed")]
  private static partial void LogEngaged(ILogger logger);
}
