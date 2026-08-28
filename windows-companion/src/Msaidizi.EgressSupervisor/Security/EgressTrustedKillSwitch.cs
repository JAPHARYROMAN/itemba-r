using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Itemba.Msaidizi.EgressSupervisor.Security;

/// <summary>
/// Reads the supervisor-wide trusted-root kill switch without treating an
/// absent or unreadable trusted root as permission to continue.
/// </summary>
public static class EgressTrustedKillSwitch
{
  public static bool IsEngaged(string configuredPath)
  {
    if (string.IsNullOrWhiteSpace(configuredPath)
      || !Path.IsPathFullyQualified(configuredPath))
    {
      return true;
    }

    try
    {
      var path = Path.GetFullPath(configuredPath);
      var root = Path.GetDirectoryName(path);
      if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
      {
        return true;
      }

      for (var current = new DirectoryInfo(root);
        current is not null;
        current = current.Parent)
      {
        var attributes = current.Attributes;
        if ((attributes & FileAttributes.Directory) == 0
          || (attributes & FileAttributes.ReparsePoint) != 0)
        {
          return true;
        }
      }

      try
      {
        _ = File.GetAttributes(path);
        return true;
      }
      catch (FileNotFoundException)
      {
        return false;
      }
      catch (DirectoryNotFoundException)
      {
        return true;
      }
    }
    catch (Exception exception) when (exception is IOException
      or UnauthorizedAccessException
      or ArgumentException
      or NotSupportedException
      or PathTooLongException
      or System.Security.SecurityException)
    {
      return true;
    }
  }
}

internal sealed partial class EgressKillSwitchMonitor(
  EgressSupervisorOptions options,
  IHostApplicationLifetime applicationLifetime,
  ILogger<EgressKillSwitchMonitor> logger) : BackgroundService
{
  protected override async Task ExecuteAsync(CancellationToken stoppingToken)
  {
    while (!stoppingToken.IsCancellationRequested)
    {
      if (EgressTrustedKillSwitch.IsEngaged(options.KillSwitchPath))
      {
        Log.KillSwitchEngaged(logger);
        applicationLifetime.StopApplication();
        return;
      }

      try
      {
        await Task.Delay(TimeSpan.FromMilliseconds(100), stoppingToken)
          .ConfigureAwait(false);
      }
      catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
      {
        return;
      }
    }
  }

  private static partial class Log
  {
    [LoggerMessage(
      EventId = 1,
      Level = LogLevel.Critical,
      Message = "The trusted-root kill switch is engaged or unavailable; stopping egress supervision.")]
    public static partial void KillSwitchEngaged(ILogger logger);
  }
}
