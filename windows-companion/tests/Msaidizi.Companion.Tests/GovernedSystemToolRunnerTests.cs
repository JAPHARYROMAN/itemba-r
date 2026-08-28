using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Security;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class GovernedSystemToolRunnerTests : IDisposable
{
  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"governed-system-tool-tests-{Guid.NewGuid():N}");

  public GovernedSystemToolRunnerTests()
  {
    Directory.CreateDirectory(_directory);
  }

  [Fact]
  public void ProductionPolicyPinsOnlyTheExactReviewedSystem32Images()
  {
    using var runner = new GovernedSystemToolRunner();

    Assert.Equal(
      [GovernedSystemTool.ScheduledTasks, GovernedSystemTool.WindowsInstaller],
      Enum.GetValues<GovernedSystemTool>());
    Assert.Equal(
      Path.Combine(Environment.SystemDirectory, "schtasks.exe"),
      runner.GetExecutablePath(GovernedSystemTool.ScheduledTasks),
      ignoreCase: true);
    Assert.Equal(
      Path.Combine(Environment.SystemDirectory, "msiexec.exe"),
      runner.GetExecutablePath(GovernedSystemTool.WindowsInstaller),
      ignoreCase: true);
  }

  [Fact]
  public async Task ProductionSurfaceHasNoShellExecutableOrPathOverride()
  {
    var constructor = Assert.Single(typeof(GovernedSystemToolRunner).GetConstructors());
    Assert.Empty(constructor.GetParameters());
    var run = typeof(GovernedSystemToolRunner).GetMethod(
      nameof(GovernedSystemToolRunner.RunAsync),
      BindingFlags.Instance | BindingFlags.Public | BindingFlags.DeclaredOnly);
    Assert.NotNull(run);
    Assert.Equal(
      [
        typeof(GovernedSystemTool),
        typeof(IReadOnlyList<string>),
        typeof(int),
        typeof(CancellationToken),
      ],
      run.GetParameters().Select(parameter => parameter.ParameterType));
    Assert.DoesNotContain(
      run.GetParameters(),
      parameter => parameter.Name!.Contains("path", StringComparison.OrdinalIgnoreCase)
        || parameter.Name.Contains("executable", StringComparison.OrdinalIgnoreCase)
        || parameter.Name.Contains("shell", StringComparison.OrdinalIgnoreCase));

    using var runner = new GovernedSystemToolRunner();
    var stages = new List<GovernedSystemToolStage>();
    using var controlled = CreatePowerShellRunner(stages.Add);
    var exception = await Assert.ThrowsAsync<HostPolicyException>(() => controlled.RunAsync(
      (GovernedSystemTool)int.MaxValue,
      PowerShellArguments("exit 0"),
      4_096,
      CancellationToken.None).AsTask());
    Assert.Equal("trusted_system_tool_not_allowed", exception.ErrorCode);
    Assert.Empty(stages);

    exception = await Assert.ThrowsAsync<HostPolicyException>(() => runner.RunAsync(
      GovernedSystemTool.ScheduledTasks,
      ["/Run", "/TN", @"\Itemba\Allowed", "unexpected"],
      4_096,
      CancellationToken.None).AsTask());
    Assert.Equal("trusted_system_command_arguments_invalid", exception.ErrorCode);
  }

  [Fact]
  public async Task ExactImageIsVerifiedAndJobIsAssignedBeforeResume()
  {
    var stages = new List<GovernedSystemToolStage>();
    using var runner = CreatePowerShellRunner(stages.Add);

    var result = await runner.RunAsync(
      GovernedSystemTool.ScheduledTasks,
      PowerShellArguments("exit 0"),
      4_096,
      CancellationToken.None);

    Assert.Equal(0, result.ExitCode);
    AssertOrdered(
      stages,
      GovernedSystemToolStage.CreatedSuspended,
      GovernedSystemToolStage.ImageVerified,
      GovernedSystemToolStage.JobAssigned,
      GovernedSystemToolStage.BeforeResume,
      GovernedSystemToolStage.Resumed);
  }

  [Fact]
  public async Task FailureAfterAssignmentButBeforeResumeCausesZeroToolEffects()
  {
    var marker = Path.Combine(_directory, "must-not-execute.txt");
    var stages = new List<GovernedSystemToolStage>();
    using var runner = CreatePowerShellRunner(stage =>
    {
      stages.Add(stage);
      if (stage == GovernedSystemToolStage.BeforeResume)
      {
        throw new InvalidOperationException("injected_pre_resume_failure");
      }
    });

    var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => runner.RunAsync(
      GovernedSystemTool.ScheduledTasks,
      PowerShellArguments(
        $"[IO.File]::WriteAllText('{EscapePowerShell(marker)}', 'executed')"),
      4_096,
      CancellationToken.None).AsTask());

    Assert.Equal("injected_pre_resume_failure", exception.Message);
    Assert.Contains(GovernedSystemToolStage.JobAssigned, stages);
    Assert.DoesNotContain(GovernedSystemToolStage.Resumed, stages);
    Assert.False(File.Exists(marker));
  }

  [Trait("Category", "ProcessTiming")]
  [Fact]
  public async Task CancellationTerminatesTheEntireDescendantTree()
  {
    var pidFile = Path.Combine(_directory, "cancel-descendant.pid");
    using var runner = CreatePowerShellRunner();
    using var cancellation = new CancellationTokenSource();
    var running = StartDescendantAsync(runner, pidFile, cancellation.Token);
    var processId = await ReadProcessIdAsync(pidFile);

    try
    {
      await cancellation.CancelAsync();
      await Assert.ThrowsAnyAsync<OperationCanceledException>(() => running);
      Assert.True(await ProcessExitedAsync(processId, TimeSpan.FromSeconds(3)));
    }
    finally
    {
      KillIfRunning(processId);
    }
  }

  [Fact]
  public async Task RunnerDisposalTerminatesTheEntireDescendantTree()
  {
    var pidFile = Path.Combine(_directory, "dispose-descendant.pid");
    var runner = CreatePowerShellRunner();
    var running = StartDescendantAsync(runner, pidFile, CancellationToken.None);
    var processId = await ReadProcessIdAsync(pidFile);

    try
    {
      runner.Dispose();
      await Assert.ThrowsAsync<ObjectDisposedException>(() => running);
      Assert.True(await ProcessExitedAsync(processId, TimeSpan.FromSeconds(3)));
    }
    finally
    {
      runner.Dispose();
      KillIfRunning(processId);
    }
  }

  [Fact]
  public async Task StandardOutputAndErrorShareOneAggregateByteCeiling()
  {
    const int charactersPerStream = 64;
    var command =
      "[Console]::OutputEncoding = [Text.Encoding]::Unicode; "
      + $"[Console]::Out.Write(('o' * {charactersPerStream})); "
      + $"[Console]::Error.Write(('e' * {charactersPerStream}))";
    using var runner = CreatePowerShellRunner();

    var compatible = await runner.RunAsync(
      GovernedSystemTool.ScheduledTasks,
      PowerShellArguments(command),
      1_024,
      CancellationToken.None);
    Assert.Equal(new string('o', charactersPerStream), compatible.StandardOutput);
    Assert.Equal(new string('e', charactersPerStream), compatible.StandardError);

    var exception = await Assert.ThrowsAsync<InvalidDataException>(() => runner.RunAsync(
      GovernedSystemTool.ScheduledTasks,
      PowerShellArguments(command),
      192,
      CancellationToken.None).AsTask());
    Assert.Equal("trusted_system_command_output_exceeded_limit", exception.Message);
  }

  public void Dispose()
  {
    if (Directory.Exists(_directory))
    {
      Directory.Delete(_directory, recursive: true);
    }
  }

  private static GovernedSystemToolRunner CreatePowerShellRunner(
    Action<GovernedSystemToolStage>? observer = null)
  {
    var powershell = Path.Combine(
      Environment.SystemDirectory,
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe");
    var definitions = Enum.GetValues<GovernedSystemTool>().ToDictionary(
      tool => tool,
      _ => new GovernedSystemToolDefinition(powershell, static _ => { }));
    return new GovernedSystemToolRunner(definitions, observer);
  }

  private static Task<GovernedCommandResult> StartDescendantAsync(
    GovernedSystemToolRunner runner,
    string pidFile,
    CancellationToken cancellationToken)
  {
    var command =
      "$p = Start-Process -PassThru -FilePath $env:COMSPEC "
      + "-ArgumentList @('/d','/s','/c','ping -n 30 127.0.0.1 >nul'); "
      + $"[IO.File]::WriteAllText('{EscapePowerShell(pidFile)}', [string]$p.Id); "
      + "$p.WaitForExit()";
    return runner.RunAsync(
      GovernedSystemTool.ScheduledTasks,
      PowerShellArguments(command),
      4_096,
      cancellationToken).AsTask();
  }

  private static string[] PowerShellArguments(string command) =>
  [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command,
  ];

  private static string EscapePowerShell(string value) =>
    value.Replace("'", "''", StringComparison.Ordinal);

  private static async Task<int> ReadProcessIdAsync(string path)
  {
    var deadline = DateTimeOffset.UtcNow.AddSeconds(5);
    while (!File.Exists(path) && DateTimeOffset.UtcNow < deadline)
    {
      await Task.Delay(25);
    }

    Assert.True(File.Exists(path));
    return int.Parse(await File.ReadAllTextAsync(path), CultureInfo.InvariantCulture);
  }

  private static async Task<bool> ProcessExitedAsync(int processId, TimeSpan timeout)
  {
    try
    {
      using var process = Process.GetProcessById(processId);
      using var cancellation = new CancellationTokenSource(timeout);
      await process.WaitForExitAsync(cancellation.Token);
      return true;
    }
    catch (ArgumentException)
    {
      return true;
    }
    catch (OperationCanceledException)
    {
      return false;
    }
  }

  private static void KillIfRunning(int processId)
  {
    try
    {
      using var process = Process.GetProcessById(processId);
      process.Kill(entireProcessTree: true);
      process.WaitForExit(3_000);
    }
    catch (ArgumentException)
    {
      // The Job Object already removed the process.
    }
    catch (InvalidOperationException)
    {
      // The process raced with test cleanup and has exited.
    }
  }

  private static void AssertOrdered(
    IReadOnlyList<GovernedSystemToolStage> actual,
    params GovernedSystemToolStage[] expected)
  {
    var last = -1;
    foreach (var stage in expected)
    {
      var index = Enumerable.Range(0, actual.Count)
        .FirstOrDefault(candidate => actual[candidate] == stage, -1);
      Assert.True(index > last, $"Stage {stage} was not observed in order.");
      last = index;
    }
  }
}
