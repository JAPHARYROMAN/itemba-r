using System.ServiceProcess;
using Itemba.Msaidizi.UpdateSupervisor.Configuration;

namespace Itemba.Msaidizi.UpdateSupervisor.Execution;

public interface IUpdateTargetActivator
{
  Task ActivateAsync(UpdateTargetOptions target, CancellationToken cancellationToken);
}

/// <summary>
/// Restarts only the exact service name in the immutable target map. No
/// package-provided command, argument, executable, or script is ever launched.
/// </summary>
public sealed class ConfiguredUpdateTargetActivator : IUpdateTargetActivator
{
  public async Task ActivateAsync(UpdateTargetOptions target, CancellationToken cancellationToken)
  {
    if (target.ActivationMode == "ExternalPointerWatcher") return;
    if (target.ActivationMode != "WindowsServiceRestart" ||
        string.IsNullOrWhiteSpace(target.WindowsServiceName))
      throw new InvalidOperationException("The allowlisted activation policy is invalid.");

    using var service = new ServiceController(target.WindowsServiceName);
    await Task.Run(() => Restart(service, cancellationToken), cancellationToken);
  }

  private static void Restart(ServiceController service, CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    service.Refresh();
    if (service.Status != ServiceControllerStatus.Stopped)
    {
      if (service.Status != ServiceControllerStatus.StopPending) service.Stop();
      service.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(60));
    }
    cancellationToken.ThrowIfCancellationRequested();
    service.Start();
    service.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(60));
    cancellationToken.ThrowIfCancellationRequested();
  }
}
