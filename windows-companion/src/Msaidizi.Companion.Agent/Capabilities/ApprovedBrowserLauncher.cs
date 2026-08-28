using System.Diagnostics;
using System.Text.Json;

namespace Itemba.Msaidizi.Companion.Agent.Capabilities;

/// <summary>
/// The only shell-activation boundary in the interactive agent. The action
/// supplies a supervisor-owned origin ID and a credential-free relative path;
/// target resolution happens inside this boundary immediately before launch.
/// </summary>
public sealed class ApprovedBrowserLauncher(InteractiveTargetPolicy targets)
{
  public Uri Open(string originId, string relativePath)
  {
    var target = targets.ResolveBrowserUri(originId, relativePath);
    using var process = Process.Start(new ProcessStartInfo
    {
      FileName = target.AbsoluteUri,
      UseShellExecute = true,
      Verb = "open",
      ErrorDialog = false,
    });
    return target;
  }

  public Uri Open(JsonElement arguments)
    => Open(
      arguments.GetProperty("originId").GetString()!,
      arguments.GetProperty("relativePath").GetString()!);
}
