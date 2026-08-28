using System.Drawing;
using Itemba.Msaidizi.Companion.Agent.Configuration;
using Itemba.Msaidizi.Companion.Agent.SecretProvisioning;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Agent;

internal sealed class CompanionTrayContext : ApplicationContext
{
  private readonly AgentOptions _options;
  private readonly SecretProvisioningOptions _secretOptions;
  private readonly SecretProvisioningWorkflow _secretWorkflow;
  private readonly ContextMenuStrip _menu;
  private readonly NotifyIcon _notifyIcon;
  private readonly CancellationTokenSource _lifetime = new();
  private int _secretWorkflowRunning;

  public CompanionTrayContext(
    IOptions<AgentOptions> options,
    IOptions<SecretProvisioningOptions> secretOptions,
    SecretProvisioningWorkflow secretWorkflow)
  {
    _options = options.Value;
    _secretOptions = secretOptions.Value;
    _secretWorkflow = secretWorkflow;
    _menu = new ContextMenuStrip();
    _menu.Items.Add("Status", null, ShowStatus);
    var secrets = _menu.Items.Add("Manage local secrets", null, ManageSecrets);
    secrets.Enabled = _secretOptions.Enabled;
    _menu.Items.Add(new ToolStripSeparator());
    _menu.Items.Add("Exit", null, ExitAgent);

    _notifyIcon = new NotifyIcon
    {
      Icon = SystemIcons.Shield,
      Text = "Itemba Msaidizi Companion",
      ContextMenuStrip = _menu,
      Visible = true,
    };
    _notifyIcon.DoubleClick += ShowStatus;
  }

  protected override void ExitThreadCore()
  {
    _lifetime.Cancel();
    _notifyIcon.Visible = false;
    _notifyIcon.Dispose();
    _menu.Dispose();
    _lifetime.Dispose();
    base.ExitThreadCore();
  }

  private void ShowStatus(object? sender, EventArgs eventArgs)
  {
    var state = _options.ExecutionEnabled
      ? "Configured, but action execution remains disabled until the authenticated session bridge is installed."
      : "Execution is disabled.";
    var secretState = _secretOptions.Enabled
      ? "Local secret provisioning is enabled and requires an explicit on-screen confirmation."
      : "Local secret provisioning is disabled.";
    MessageBox.Show(
      $"Device: {_options.DeviceId}\n{state}\n{secretState}",
      "Msaidizi Companion",
      MessageBoxButtons.OK,
      MessageBoxIcon.Information);
  }

  private async void ManageSecrets(object? sender, EventArgs eventArgs)
  {
    if (Interlocked.CompareExchange(ref _secretWorkflowRunning, 1, 0) != 0)
    {
      return;
    }

    try
    {
      await _secretWorkflow.RunAsync(_lifetime.Token);
    }
    catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
    {
      // Tray shutdown.
    }
    finally
    {
      Interlocked.Exchange(ref _secretWorkflowRunning, 0);
    }
  }

  private void ExitAgent(object? sender, EventArgs eventArgs) => ExitThread();
}
