using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class OwnedProcessCapabilityTests : IDisposable
{
  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"msaidizi-owned-process-{Guid.NewGuid():N}");
  private readonly string _root;
  private readonly string _supervisor;
  private readonly string _approvedExecutable;
  private readonly HostCapabilityOptions _options;
  private readonly SupervisorPathPolicy _paths;

  public OwnedProcessCapabilityTests()
  {
    _root = Path.Combine(_directory, "managed");
    _supervisor = Path.Combine(_directory, "supervisor");
    Directory.CreateDirectory(_root);
    Directory.CreateDirectory(_supervisor);
    _approvedExecutable = Path.Combine(_directory, "approved-ping.exe");
    File.Copy(Path.Combine(Environment.SystemDirectory, "PING.EXE"), _approvedExecutable);
    _options = new HostCapabilityOptions
    {
      Enabled = true,
      RecoveryVaultPath = Path.Combine(_supervisor, "recovery"),
      AllowedRoots =
      [
        new AllowedHostRootOptions
        {
          Id = "managed",
          Path = _root,
          QuarantinePath = Path.Combine(_directory, "quarantine"),
          AllowRead = true,
          AllowWrite = true,
          AllowDelete = true,
        },
      ],
      AllowedExecutables =
      [
        new AllowedProcessExecutableOptions
        {
          Id = "network-probe",
          Path = _approvedExecutable,
          AllowLocalSystem = true,
        },
      ],
    };
    _paths = new SupervisorPathPolicy(
      Options.Create(_options),
      Options.Create(new CompanionOptions
      {
        JournalPath = Path.Combine(_supervisor, "journal.jsonl"),
        KillSwitchPath = Path.Combine(_supervisor, "DISABLED"),
        ResultCachePath = Path.Combine(_supervisor, "results"),
      }));
  }

  [Fact]
  public void LaunchStatusAndTerminationRemainBoundToOwnedTaskJob()
  {
    using var manager = new OwnedProcessManager(Options.Create(_options), _paths);
    var launched = manager.Launch(
      "network-probe",
      ["-t", "127.0.0.1"],
      _root,
      "task-owner",
      "launch-action",
      CancellationToken.None);
    var independent = manager.Launch(
      "network-probe",
      ["-t", "127.0.0.1"],
      _root,
      "task-owner",
      "independent-action",
      CancellationToken.None);

    Assert.True(launched.Running);
    Assert.Throws<HostPreconditionException>(() =>
      manager.GetStatus(launched.ProcessHandle, "different-task"));

    var terminated = manager.Terminate(launched.ProcessHandle, "task-owner");

    Assert.False(terminated.Running);
    Assert.NotNull(terminated.ExitCode);
    Assert.Equal(launched.ProcessId, terminated.ProcessId);
    Assert.True(manager.GetStatus(independent.ProcessHandle, "task-owner").Running);
    Assert.False(manager.Terminate(independent.ProcessHandle, "task-owner").Running);
  }

  [Fact]
  public void ProcessArgumentsUseWindowsArgvQuotingWithoutShellComposition()
  {
    var commandLine = OwnedProcessManager.BuildCommandLine(
      @"C:\Program Files\Itemba\worker.exe",
      ["plain", "two words", "&whoami", "quote\"inside", @"ends-with\\"]);

    Assert.Equal(
      "\"C:\\Program Files\\Itemba\\worker.exe\" plain \"two words\" &whoami \"quote\\\"inside\" ends-with\\\\",
      commandLine);
    Assert.DoesNotContain("cmd.exe", commandLine, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("/c", commandLine, StringComparison.OrdinalIgnoreCase);
  }

  [Fact]
  public void OwnedProcessUsesFixedResourceCeilingsAndDoesNotInheritServiceSecrets()
  {
    var policy = OwnedProcessManager.ResourcePolicy;
    var environmentBlock = OwnedProcessManager.BuildMinimalEnvironmentBlock(_root);
    var entries = new string(environmentBlock)
      .Split('\0', StringSplitOptions.RemoveEmptyEntries);

    Assert.Equal(TimeSpan.FromHours(2).Ticks, policy.MaximumJobCpuTime100Nanoseconds);
    Assert.Equal(16U, policy.MaximumProcesses);
    Assert.Equal((nuint)536_870_912, policy.MaximumJobMemoryBytes);
    Assert.Equal('\0', environmentBlock[^1]);
    Assert.Equal('\0', environmentBlock[^2]);
    Assert.Equal(6, entries.Length);
    Assert.Contains(entries, value => value == $"TEMP={_root}");
    Assert.Contains(entries, value => value == $"TMP={_root}");
    Assert.Contains(entries, value => value.StartsWith(
      "SystemRoot=",
      StringComparison.Ordinal));
    Assert.DoesNotContain(entries, value => value.StartsWith(
      "USERPROFILE=",
      StringComparison.OrdinalIgnoreCase));
    Assert.DoesNotContain(entries, value => value.StartsWith(
      "MSAIDIZI_",
      StringComparison.OrdinalIgnoreCase));
  }

  [Fact]
  public void SwappedExecutableIdentityIsRejectedBeforeLaunch()
  {
    var displaced = Path.Combine(_directory, "displaced-approved.exe");
    using (var manager = new OwnedProcessManager(Options.Create(_options), _paths))
    {
      File.Move(_approvedExecutable, displaced, overwrite: false);
      File.WriteAllBytes(_approvedExecutable, [0x4d, 0x5a]);

      var exception = Assert.Throws<HostPolicyException>(() => manager.Launch(
        "network-probe",
        [],
        _root,
        "task-owner",
        "swapped-executable",
        CancellationToken.None));
      Assert.Equal("path_handle_moved", exception.ErrorCode);
    }

    File.Delete(_approvedExecutable);
    File.Move(displaced, _approvedExecutable, overwrite: false);
    Assert.True(File.Exists(_approvedExecutable));
    Assert.False(File.Exists(displaced));
  }

  [Fact]
  public void RawShellExecutableCannotBeAddedEvenByConfiguration()
  {
    var disguisedShell = Path.Combine(_directory, "cmd.exe");
    File.Copy(_approvedExecutable, disguisedShell);
    _options.AllowedExecutables =
    [
      new AllowedProcessExecutableOptions
      {
        Id = "forbidden-shell",
        Path = disguisedShell,
        AllowLocalSystem = true,
      },
    ];

    var exception = Assert.Throws<InvalidOperationException>(() =>
      new OwnedProcessManager(Options.Create(_options), _paths));

    Assert.Contains("forbidden", exception.Message, StringComparison.OrdinalIgnoreCase);
  }

  [Fact]
  public void RenamedRawShellExecutableCannotBeAddedByConfiguration()
  {
    var renamedShell = Path.Combine(_directory, "approved-worker.exe");
    File.Copy(Path.Combine(Environment.SystemDirectory, "cmd.exe"), renamedShell);
    _options.AllowedExecutables =
    [
      new AllowedProcessExecutableOptions
      {
        Id = "renamed-shell",
        Path = renamedShell,
        AllowLocalSystem = true,
      },
    ];

    var exception = Assert.Throws<InvalidOperationException>(() =>
      new OwnedProcessManager(Options.Create(_options), _paths));

    Assert.Contains("forbidden", exception.Message, StringComparison.OrdinalIgnoreCase);
  }

  [Fact]
  public async Task ProcessAdaptersRequireExactPreStateAndRecordRecovery()
  {
    using var manager = new OwnedProcessManager(Options.Create(_options), _paths);
    var recovery = new RecordingRecoveryVault();
    var launch = new OwnedProcessLaunchCapabilityAdapter(manager, _paths, recovery);
    using var arguments = JsonDocument.Parse(
      """{"executableId":"network-probe","arguments":["-t","127.0.0.1"],"workingRootId":"managed","workingRelativePath":""}""");
    var launchResult = await launch.ExecuteAsync(
      Context("launch", OwnedProcessManager.AbsentStateSha256),
      arguments.RootElement,
      CancellationToken.None);
    using var launchOutput = JsonDocument.Parse(launchResult.OutputJson);
    Assert.True(launch.ValidateResult(launchOutput.RootElement).IsValid);
    var processHandle = launchOutput.RootElement.GetProperty("processHandle").GetString()!;
    var stateSha256 = launchOutput.RootElement.GetProperty("stateSha256").GetString()!;
    var terminate = new OwnedProcessTerminateCapabilityAdapter(manager, recovery);
    using var terminateArguments = JsonDocument.Parse(JsonSerializer.Serialize(new { processHandle }));
    var terminateResult = await terminate.ExecuteAsync(
      Context("terminate", stateSha256),
      terminateArguments.RootElement,
      CancellationToken.None);

    Assert.True(launchResult.MutationCommitted);
    Assert.True(terminateResult.MutationCommitted);
    using (var output = JsonDocument.Parse(terminateResult.OutputJson))
    {
      Assert.True(terminate.ValidateResult(output.RootElement).IsValid);
    }
    Assert.Equal(2, recovery.Count);
    Assert.Equal(RequiredPrivilege.LocalSystem, launch.Descriptor.RequiredPrivilege);
    Assert.Equal(CapabilityEffect.Irreversible, terminate.Descriptor.Effect);
    Assert.Equal(RecoveryKind.Irreversible, terminate.Descriptor.Recovery);
    Assert.Equal([false, true], recovery.IrreversibleFlags);
  }

  public void Dispose()
  {
    if (Directory.Exists(_directory))
    {
      Directory.Delete(_directory, recursive: true);
    }
  }

  private static ActionExecutionContext Context(string actionId, string expectedPreState) => new(
    actionId,
    "task-owner",
    "plan-1",
    "step-1",
    "device-1",
    "mandate-1",
    $"idempotency-{actionId}",
    expectedPreState,
    InputProvenanceSha256: null,
    new ActionBudget(60, 10, 20, 10, 1_000_000, 1_000_000, 1m));

  private sealed class RecordingRecoveryVault : IHostRecoveryVault
  {
    public int Count { get; private set; }

    public List<bool> IrreversibleFlags { get; } = [];

    public ValueTask<HostRecoveryReceipt> PrepareAsync(
      ActionExecutionContext context,
      string operation,
      string preStateSha256,
      object recoveryRecord,
      bool irreversible,
      CancellationToken cancellationToken)
    {
      Count++;
      IrreversibleFlags.Add(irreversible);
      return ValueTask.FromResult(new HostRecoveryReceipt(
        PayloadDigest.Sha256Hex(context.ActionId),
        PayloadDigest.Sha256Hex($"record:{context.ActionId}"),
        $"record:{context.ActionId}"));
    }
  }
}
