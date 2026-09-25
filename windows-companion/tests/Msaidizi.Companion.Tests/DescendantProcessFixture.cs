namespace Itemba.Msaidizi.Companion.Tests;

internal static class DescendantProcessFixture
{
  public static string PowerShellCommand(string pidFile)
  {
    var escapedPath = pidFile.Replace("'", "''", StringComparison.Ordinal);
    // These tests measure Job Object ownership, cancellation and timeout. Start
    // the child directly, without importing Start-Process or asking ShellExecute
    // to create a console in a non-interactive test session.
    return "$ErrorActionPreference = 'Stop'; "
      + "$info = [Diagnostics.ProcessStartInfo]::new(); "
      + "$info.FileName = $env:COMSPEC; "
      + "$info.Arguments = '/d /s /c ping -n 30 127.0.0.1 >nul'; "
      + "$info.UseShellExecute = $false; $info.CreateNoWindow = $true; "
      + "$p = [Diagnostics.Process]::Start($info); "
      + $"[IO.File]::WriteAllText('{escapedPath}', [string]$p.Id); "
      + "$p.WaitForExit()";
  }
}
