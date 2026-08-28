using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class FileSystemCapabilityAdaptersTests : IDisposable
{
  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"msaidizi-filesystem-capabilities-{Guid.NewGuid():N}");
  private readonly string _root;
  private readonly SupervisorPathPolicy _paths;
  private readonly RecordingRecoveryVault _recovery = new();
  private readonly HostCapabilityOptions _hostOptions;

  public FileSystemCapabilityAdaptersTests()
  {
    _root = Path.Combine(_directory, "allowed");
    var supervisor = Path.Combine(_directory, "supervisor");
    Directory.CreateDirectory(_root);
    Directory.CreateDirectory(supervisor);
    _hostOptions = new HostCapabilityOptions
    {
      Enabled = true,
      PermanentDeleteEnabled = false,
      RecoveryVaultPath = Path.Combine(supervisor, "recovery"),
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
    };
    _paths = new SupervisorPathPolicy(
      Options.Create(_hostOptions),
      Options.Create(new CompanionOptions
      {
        JournalPath = Path.Combine(supervisor, "journal.jsonl"),
        KillSwitchPath = Path.Combine(supervisor, "DISABLED"),
        ResultCachePath = Path.Combine(supervisor, "results"),
      }));
  }

  [Fact]
  public async Task CreateStatListSearchCopyArchiveAndQuarantineRemainInsideGovernedRoot()
  {
    var createFolder = new FileSystemFolderCreateCapabilityAdapter(_paths, _recovery);
    using var folderArguments = JsonDocument.Parse(
      """{"rootId":"managed","relativePath":"sales"}""");
    var folderResult = await createFolder.ExecuteAsync(
      Context("folder", HostFileSystemSupport.AbsentStateSha256),
      folderArguments.RootElement,
      CancellationToken.None);
    using (var output = JsonDocument.Parse(folderResult.OutputJson))
    {
      Assert.True(createFolder.ValidateResult(output.RootElement).IsValid);
    }

    var write = new FileSystemFileWriteCapabilityAdapter(
      _paths,
      _recovery,
      Options.Create(_hostOptions));
    using var writeArguments = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      rootId = "managed",
      relativePath = "sales\\quantity.txt",
      contentBase64 = Convert.ToBase64String("12.50"u8.ToArray()),
      mode = "create",
    }));
    var writeResult = await write.ExecuteAsync(
      Context("write", HostFileSystemSupport.AbsentStateSha256),
      writeArguments.RootElement,
      CancellationToken.None);

    Assert.True(writeResult.MutationCommitted);
    using (var output = JsonDocument.Parse(writeResult.OutputJson))
    {
      Assert.True(write.ValidateResult(output.RootElement).IsValid);
    }
    Assert.Equal("12.50", await File.ReadAllTextAsync(Path.Combine(_root, "sales", "quantity.txt")));
    Assert.NotNull(writeResult.RecoveryProvenanceSha256);

    var copy = new FileSystemEntryCopyCapabilityAdapter(_paths, _recovery);
    using var copyArguments = JsonDocument.Parse(
      """{"sourceRootId":"managed","sourceRelativePath":"sales\\quantity.txt","destinationRootId":"managed","destinationRelativePath":"sales\\quantity-copy.txt"}""");
    var copyResult = await copy.ExecuteAsync(
      Context("copy", HostFileSystemSupport.AbsentStateSha256),
      copyArguments.RootElement,
      CancellationToken.None);
    Assert.True(copyResult.MutationCommitted);
    using (var output = JsonDocument.Parse(copyResult.OutputJson))
    {
      Assert.True(copy.ValidateResult(output.RootElement).IsValid);
    }
    Assert.True(File.Exists(Path.Combine(_root, "sales", "quantity-copy.txt")));

    var stat = new FileSystemEntryStatCapabilityAdapter(_paths);
    using var copiedStatArguments = JsonDocument.Parse(
      """{"rootId":"managed","relativePath":"sales\\quantity-copy.txt"}""");
    var copiedStatResult = await stat.ExecuteAsync(
      Context("copy-stat", expectedPreState: null),
      copiedStatArguments.RootElement,
      CancellationToken.None);
    using var copiedStatOutput = JsonDocument.Parse(copiedStatResult.OutputJson);
    var copiedStateSha256 = copiedStatOutput.RootElement.GetProperty("stateSha256").GetString()!;
    var move = new FileSystemEntryMoveCapabilityAdapter(_paths, _recovery);
    using var moveArguments = JsonDocument.Parse(
      """{"sourceRootId":"managed","sourceRelativePath":"sales\\quantity-copy.txt","destinationRootId":"managed","destinationRelativePath":"sales\\quantity-moved.txt"}""");
    var moveResult = await move.ExecuteAsync(
      Context("move", copiedStateSha256),
      moveArguments.RootElement,
      CancellationToken.None);
    using (var output = JsonDocument.Parse(moveResult.OutputJson))
    {
      Assert.True(move.ValidateResult(output.RootElement).IsValid);
    }

    Assert.False(File.Exists(Path.Combine(_root, "sales", "quantity-copy.txt")));
    Assert.True(File.Exists(Path.Combine(_root, "sales", "quantity-moved.txt")));

    var list = new FileSystemFolderListCapabilityAdapter(
      _paths,
      Options.Create(_hostOptions));
    using var listArguments = JsonDocument.Parse(
      """{"rootId":"managed","relativePath":"sales","maxResults":20}""");
    var listResult = await list.ExecuteAsync(
      Context("list", expectedPreState: null),
      listArguments.RootElement,
      CancellationToken.None);
    using (var output = JsonDocument.Parse(listResult.OutputJson))
    {
      Assert.True(list.ValidateResult(output.RootElement).IsValid);
      Assert.Equal(2, output.RootElement.GetProperty("entries").GetArrayLength());
    }

    var search = new FileSystemSearchCapabilityAdapter(
      _paths,
      Options.Create(_hostOptions));
    using var searchArguments = JsonDocument.Parse(
      """{"rootId":"managed","relativePath":"sales","pattern":"*.txt","maxResults":20}""");
    var searchResult = await search.ExecuteAsync(
      Context("search", expectedPreState: null),
      searchArguments.RootElement,
      CancellationToken.None);
    using (var output = JsonDocument.Parse(searchResult.OutputJson))
    {
      Assert.True(search.ValidateResult(output.RootElement).IsValid);
      Assert.Equal(2, output.RootElement.GetProperty("matches").GetArrayLength());
    }

    var archive = new FileSystemArchiveCreateCapabilityAdapter(_paths, _recovery);
    using var archiveArguments = JsonDocument.Parse(
      """{"sourceRootId":"managed","sourceRelativePath":"sales","destinationRootId":"managed","destinationRelativePath":"sales.zip"}""");
    var archiveResult = await archive.ExecuteAsync(
      Context("archive", HostFileSystemSupport.AbsentStateSha256),
      archiveArguments.RootElement,
      CancellationToken.None);
    Assert.True(archiveResult.MutationCommitted);
    using (var output = JsonDocument.Parse(archiveResult.OutputJson))
    {
      Assert.True(archive.ValidateResult(output.RootElement).IsValid);
    }
    Assert.True(new FileInfo(Path.Combine(_root, "sales.zip")).Length > 0);

    using var statArguments = JsonDocument.Parse(
      """{"rootId":"managed","relativePath":"sales\\quantity-moved.txt"}""");
    var statResult = await stat.ExecuteAsync(
      Context("stat", expectedPreState: null),
      statArguments.RootElement,
      CancellationToken.None);
    using var statOutput = JsonDocument.Parse(statResult.OutputJson);
    Assert.True(stat.ValidateResult(statOutput.RootElement).IsValid);
    var stateSha256 = statOutput.RootElement.GetProperty("stateSha256").GetString()!;
    var quarantine = new FileSystemEntryQuarantineCapabilityAdapter(_paths, _recovery);
    var quarantineResult = await quarantine.ExecuteAsync(
      Context("quarantine", stateSha256),
      statArguments.RootElement,
      CancellationToken.None);

    Assert.True(quarantineResult.MutationCommitted);
    using (var output = JsonDocument.Parse(quarantineResult.OutputJson))
    {
      Assert.True(quarantine.ValidateResult(output.RootElement).IsValid);
    }
    Assert.False(File.Exists(Path.Combine(_root, "sales", "quantity-moved.txt")));
    Assert.Equal(6, _recovery.Records.Count);
  }

  [Fact]
  public void PermanentDeleteIsFailClosedWithoutExternalSupervisorFlag()
  {
    var target = Path.Combine(_root, "do-not-delete.txt");
    File.WriteAllText(target, "recoverable");
    var adapter = new FileSystemEntryPermanentDeleteCapabilityAdapter(
      _paths,
      _recovery,
      Options.Create(_hostOptions));
    using var arguments = JsonDocument.Parse(
      """{"rootId":"managed","relativePath":"do-not-delete.txt"}""");

    var validation = adapter.ValidateArguments(arguments.RootElement);

    Assert.False(validation.IsValid);
    Assert.Equal("permanent_delete_disabled", validation.ErrorCode);
    Assert.True(File.Exists(target));
    Assert.Equal(CapabilityEffect.Irreversible, adapter.Descriptor.Effect);
    Assert.Equal(RecoveryKind.Irreversible, adapter.Descriptor.Recovery);
    Assert.Equal(ConsentRequirement.EmergencyOperator, adapter.Descriptor.Consent);
  }

  [Fact]
  public async Task ConcurrentChildSwapIsBlockedByExactTargetHandle()
  {
    var target = Path.Combine(_root, "replace-me.txt");
    var displaced = Path.Combine(_root, "displaced-original.txt");
    await File.WriteAllTextAsync(target, "trusted-original");
    var governed = _paths.Resolve("managed", "replace-me.txt", HostPathAccess.Read);
    var preState = await HostFileSystemSupport.ComputeStateAsync(
      _paths,
      governed,
      1_000_000,
      CancellationToken.None);
    var observer = new SwapBeforeReplaceObserver(target, displaced);
    var adapter = new FileSystemFileWriteCapabilityAdapter(
      _paths,
      _recovery,
      Options.Create(_hostOptions),
      observer);
    using var arguments = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      rootId = "managed",
      relativePath = "replace-me.txt",
      contentBase64 = Convert.ToBase64String("generated-content"u8.ToArray()),
      mode = "replace",
    }));

    var result = await adapter.ExecuteAsync(
      Context("replace-race", preState.Sha256),
      arguments.RootElement,
      CancellationToken.None);

    Assert.True(result.MutationCommitted);
    Assert.True(observer.SwapWasBlocked);
    Assert.Equal("generated-content", await File.ReadAllTextAsync(target));
    Assert.False(File.Exists(displaced));
  }

  [Fact]
  public async Task NormalReplacementSnapshotsExactPriorNtfsIdentity()
  {
    var target = Path.Combine(_root, "replace-normal.txt");
    await File.WriteAllTextAsync(target, "before");
    var governed = _paths.Resolve("managed", "replace-normal.txt", HostPathAccess.Read);
    var preState = await HostFileSystemSupport.ComputeStateAsync(
      _paths,
      governed,
      1_000_000,
      CancellationToken.None);
    var adapter = new FileSystemFileWriteCapabilityAdapter(
      _paths,
      _recovery,
      Options.Create(_hostOptions));
    using var arguments = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      rootId = "managed",
      relativePath = "replace-normal.txt",
      contentBase64 = Convert.ToBase64String("after"u8.ToArray()),
      mode = "replace",
    }));

    var result = await adapter.ExecuteAsync(
      Context("replace-normal", preState.Sha256),
      arguments.RootElement,
      CancellationToken.None);

    Assert.True(result.MutationCommitted);
    Assert.Equal(preState.Sha256, result.PreStateSha256);
    Assert.Equal("after", await File.ReadAllTextAsync(target));
  }

  [Fact]
  public async Task SupervisorEnabledPermanentDeleteDeletesExactFileHandle()
  {
    var target = Path.Combine(_root, "permanent.txt");
    await File.WriteAllTextAsync(target, "irreversible");
    var governed = _paths.Resolve("managed", "permanent.txt", HostPathAccess.Read);
    var preState = await HostFileSystemSupport.ComputeStateAsync(
      _paths,
      governed,
      1_000_000,
      CancellationToken.None);
    _hostOptions.PermanentDeleteEnabled = true;
    var adapter = new FileSystemEntryPermanentDeleteCapabilityAdapter(
      _paths,
      _recovery,
      Options.Create(_hostOptions));
    using var arguments = JsonDocument.Parse(
      """{"rootId":"managed","relativePath":"permanent.txt"}""");

    var result = await adapter.ExecuteAsync(
      Context("permanent", preState.Sha256),
      arguments.RootElement,
      CancellationToken.None);

    Assert.True(result.MutationCommitted);
    Assert.False(File.Exists(target));
    Assert.Equal(preState.Sha256, result.PreStateSha256);
  }

  [Fact]
  public void MutationDescriptorsDeclareConsentRecoveryPrivilegeAndStrictSchemas()
  {
    IHostCapabilityAdapter[] adapters =
    [
      new FileSystemFileWriteCapabilityAdapter(
        _paths,
        _recovery,
        Options.Create(_hostOptions)),
      new FileSystemFolderCreateCapabilityAdapter(_paths, _recovery),
      new FileSystemEntryCopyCapabilityAdapter(_paths, _recovery),
      new FileSystemEntryMoveCapabilityAdapter(_paths, _recovery),
      new FileSystemArchiveCreateCapabilityAdapter(_paths, _recovery),
      new FileSystemArchiveExtractCapabilityAdapter(
        _paths,
        _recovery,
        Options.Create(_hostOptions)),
      new FileSystemEntryQuarantineCapabilityAdapter(_paths, _recovery),
    ];

    var registry = new CapabilityRegistry(adapters);

    Assert.Equal(adapters.Length, registry.Descriptors.Count);
    Assert.All(registry.Descriptors, descriptor =>
    {
      Assert.NotEqual(ConsentRequirement.None, descriptor.Consent);
      Assert.NotEqual(RecoveryKind.NotApplicable, descriptor.Recovery);
      Assert.Equal(RequiredPrivilege.LocalSystem, descriptor.RequiredPrivilege);
      Assert.False(descriptor.TouchesTrustedRoot);
      Assert.False(descriptor.ArgumentsSchema.GetProperty("additionalProperties").GetBoolean());
      Assert.False(descriptor.ResultSchema.GetProperty("additionalProperties").GetBoolean());
    });
  }

  public void Dispose()
  {
    if (Directory.Exists(_directory))
    {
      Directory.Delete(_directory, recursive: true);
    }
  }

  private static ActionExecutionContext Context(
    string actionId,
    string? expectedPreState) => new(
      actionId,
      "task-1",
      "plan-1",
      "step-1",
      "device-1",
      "mandate-1",
      $"idempotency-{actionId}",
      expectedPreState,
      InputProvenanceSha256: null,
      new ActionBudget(
        60,
        10,
        20,
        10,
        100_000_000,
        100_000_000,
        1m));

  private sealed class RecordingRecoveryVault : IHostRecoveryVault
  {
    public List<(string Operation, string PreStateSha256)> Records { get; } = [];

    public ValueTask<HostRecoveryReceipt> PrepareAsync(
      ActionExecutionContext context,
      string operation,
      string preStateSha256,
      object recoveryRecord,
      bool irreversible,
      CancellationToken cancellationToken)
    {
      Records.Add((operation, preStateSha256));
      return ValueTask.FromResult(new HostRecoveryReceipt(
        PayloadDigest.Sha256Hex(context.ActionId),
        PayloadDigest.Sha256Hex($"record:{context.ActionId}"),
        $"record:{context.ActionId}"));
    }
  }

  private sealed class SwapBeforeReplaceObserver(
    string target,
    string displaced) : IHostMutationCommitObserver
  {
    public bool SwapWasBlocked { get; private set; }

    public async ValueTask BeforeFileReplaceAsync(
      string targetPath,
      CancellationToken cancellationToken)
    {
      Assert.Equal(target, targetPath);
      await Task.Run(() =>
      {
        cancellationToken.ThrowIfCancellationRequested();
        try
        {
          File.Move(target, displaced, overwrite: false);
          File.WriteAllText(target, "attacker-swap");
        }
        catch (IOException)
        {
          SwapWasBlocked = true;
        }
      }, cancellationToken);
    }
  }
}
