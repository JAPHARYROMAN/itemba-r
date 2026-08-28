using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class TrustedQuarantineRecoveryExecutorTests : IDisposable
{
  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"msaidizi-recovery-executor-{Guid.NewGuid():N}");

  [Fact]
  public async Task RestoresExactQuarantinedEntryAndTreatsLostAckAsReplay()
  {
    var root = Path.Combine(_directory, "managed");
    var supervisor = Path.Combine(_directory, "supervisor");
    var quarantine = Path.Combine(_directory, "quarantine");
    Directory.CreateDirectory(root);
    Directory.CreateDirectory(supervisor);
    var targetPath = Path.Combine(root, "recover-me.txt");
    await File.WriteAllTextAsync(targetPath, "recoverable-state");

    var hostOptions = new HostCapabilityOptions
    {
      Enabled = true,
      RecoveryVaultPath = Path.Combine(supervisor, "recovery-vault"),
      MaximumRecoveryBytes = 1_000_000,
      AllowedRoots =
      [
        new AllowedHostRootOptions
        {
          Id = "managed",
          Path = root,
          QuarantinePath = quarantine,
          AllowRead = true,
          AllowWrite = true,
          AllowDelete = true,
        },
      ],
    };
    var host = Options.Create(hostOptions);
    var paths = new SupervisorPathPolicy(host, Options.Create(new CompanionOptions
    {
      JournalPath = Path.Combine(supervisor, "journal.jsonl"),
      KillSwitchPath = Path.Combine(supervisor, "DISABLED"),
      ResultCachePath = Path.Combine(supervisor, "results"),
    }));
    var vault = new FileHostRecoveryVault(host);
    var stat = new FileSystemEntryStatCapabilityAdapter(paths);
    using var arguments = JsonDocument.Parse(
      """{"rootId":"managed","relativePath":"recover-me.txt"}""");
    var observed = await stat.ExecuteAsync(
      Context("observe", expectedPreState: null),
      arguments.RootElement,
      CancellationToken.None);
    using var observedJson = JsonDocument.Parse(observed.OutputJson);
    var originalState = observedJson.RootElement.GetProperty("stateSha256").GetString()!;

    var delete = new FileSystemEntryQuarantineCapabilityAdapter(paths, vault);
    var deleted = await delete.ExecuteAsync(
      Context("original-action", originalState),
      arguments.RootElement,
      CancellationToken.None);
    Assert.False(File.Exists(targetPath));
    Assert.NotNull(deleted.RecoveryProvenanceSha256);

    var executor = new TrustedQuarantineRecoveryExecutor(vault, paths, host);
    var request = new TrustedQuarantineRecoveryRequest(
      "original-action",
      deleted.RecoveryProvenanceSha256!,
      HostFileSystemSupport.AbsentStateSha256);
    var restored = await executor.RestoreAsync(request, CancellationToken.None);
    var replay = await executor.RestoreAsync(request, CancellationToken.None);

    Assert.Equal("recoverable-state", await File.ReadAllTextAsync(targetPath));
    Assert.Equal(originalState, restored.RestoredStateSha256);
    Assert.False(restored.IdempotentReplay);
    Assert.True(replay.IdempotentReplay);
  }

  [Fact]
  public async Task RejectsTamperedCentralRecoveryDigest()
  {
    var vaultPath = Path.Combine(_directory, "vault");
    var options = Options.Create(new HostCapabilityOptions { RecoveryVaultPath = vaultPath });
    var vault = new FileHostRecoveryVault(options);
    await vault.PrepareAsync(
      Context("original-action", PayloadDigest.Sha256Hex("before")),
      "filesystem.entry.quarantine",
      PayloadDigest.Sha256Hex("before"),
      new
      {
        rootId = "managed",
        relativePath = "file.txt",
        quarantinedPath = "C:\\not-used",
        entryType = "file",
      },
      irreversible: false,
      CancellationToken.None);

    await Assert.ThrowsAsync<HostRecoveryException>(() => vault.ReadAsync(
      "original-action",
      PayloadDigest.Sha256Hex("wrong-record"),
      CancellationToken.None).AsTask());
  }

  private static ActionExecutionContext Context(string actionId, string? expectedPreState) => new(
    actionId,
    "task-1",
    "plan-1",
    $"step-{actionId}",
    "device-1",
    "mandate-1",
    $"idempotency-{actionId}",
    expectedPreState,
    InputProvenanceSha256: null,
    new ActionBudget(60, 10, 20, 10, 1_000_000, 1_000_000, 1m));

  public void Dispose()
  {
    if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
  }
}
