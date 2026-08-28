using System.Runtime.InteropServices;
using System.IO.Compression;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed partial class TrustedFileSystemRecoveryExecutorTests : IDisposable
{
  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"msaidizi-filesystem-recovery-{Guid.NewGuid():N}");
  private readonly string _root;
  private readonly string _supervisor;
  private readonly string _quarantine;
  private readonly IOptions<HostCapabilityOptions> _host;
  private readonly SupervisorPathPolicy _paths;
  private readonly FileHostRecoveryVault _vault;
  private readonly TrustedFileSystemRecoveryExecutor _executor;

  public TrustedFileSystemRecoveryExecutorTests()
  {
    _root = Path.Combine(_directory, "managed");
    _supervisor = Path.Combine(_directory, "supervisor");
    _quarantine = Path.Combine(_directory, "quarantine");
    Directory.CreateDirectory(_root);
    Directory.CreateDirectory(_supervisor);
    _host = Options.Create(new HostCapabilityOptions
    {
      Enabled = true,
      RecoveryVaultPath = Path.Combine(_supervisor, "recovery-vault"),
      MaximumRecoveryBytes = 10_000_000,
      MaximumSingleFileBytes = 1_000_000,
      AllowedRoots =
      [
        new AllowedHostRootOptions
        {
          Id = "managed",
          Path = _root,
          QuarantinePath = _quarantine,
          AllowRead = true,
          AllowWrite = true,
          AllowDelete = true,
        },
      ],
    });
    _paths = new SupervisorPathPolicy(_host, Options.Create(new CompanionOptions
    {
      JournalPath = Path.Combine(_supervisor, "journal.jsonl"),
      KillSwitchPath = Path.Combine(_supervisor, "DISABLED"),
      ResultCachePath = Path.Combine(_supervisor, "results"),
    }));
    _vault = new FileHostRecoveryVault(_host);
    _executor = new TrustedFileSystemRecoveryExecutor(_vault, _paths, _host);
  }

  [Theory]
  [InlineData("filesystem.file.write")]
  [InlineData("filesystem.folder.create")]
  [InlineData("filesystem.entry.copy")]
  [InlineData("filesystem.entry.copy-directory")]
  [InlineData("filesystem.archive.create")]
  [InlineData("filesystem.archive.extract")]
  public async Task RemovesExactCreatedTargetAndReplaysWithoutAnotherMutation(string scenario)
  {
    var actionId = $"action-{scenario}";
    var execution = await ExecuteCreatedTargetScenarioAsync(scenario, actionId);
    using var output = JsonDocument.Parse(execution.Result.OutputJson);
    var expectedCurrent = output.RootElement.GetProperty("stateSha256").GetString()!;

    var restored = await _executor.RestoreAsync(
      new TrustedFileSystemRecoveryRequest(
        actionId,
        execution.Result.RecoveryProvenanceSha256!,
        expectedCurrent),
      CancellationToken.None);
    var replay = await _executor.RestoreAsync(
      new TrustedFileSystemRecoveryRequest(
        actionId,
        execution.Result.RecoveryProvenanceSha256!,
        expectedCurrent),
      CancellationToken.None);

    Assert.False(File.Exists(execution.TargetPath));
    Assert.False(Directory.Exists(execution.TargetPath));
    Assert.Equal(HostFileSystemSupport.AbsentStateSha256, restored.RestoredStateSha256);
    Assert.False(restored.IdempotentReplay);
    Assert.True(replay.IdempotentReplay);
    Assert.True(Directory.Exists(Path.Combine(
      _quarantine,
      PayloadDigest.Sha256Hex(actionId),
      "compensated-entry")) || File.Exists(Path.Combine(
        _quarantine,
        PayloadDigest.Sha256Hex(actionId),
        "compensated-entry")));
  }

  [Fact]
  public async Task RestoresReplacedFileSnapshotAndReplaysWithoutOverwritingItAgain()
  {
    var targetPath = Path.Combine(_root, "replace.txt");
    await File.WriteAllTextAsync(targetPath, "before");
    var before = await StateAsync("replace.txt");
    using var arguments = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      rootId = "managed",
      relativePath = "replace.txt",
      contentBase64 = Convert.ToBase64String("after"u8.ToArray()),
      mode = "replace",
    }));
    var actionId = "replace-action";
    var adapter = new FileSystemFileWriteCapabilityAdapter(_paths, _vault, _host);
    var written = await adapter.ExecuteAsync(
      Context(actionId, before.Sha256),
      arguments.RootElement,
      CancellationToken.None);
    using var output = JsonDocument.Parse(written.OutputJson);
    var expectedCurrent = output.RootElement.GetProperty("stateSha256").GetString()!;
    var request = new TrustedFileSystemRecoveryRequest(
      actionId,
      written.RecoveryProvenanceSha256!,
      expectedCurrent);

    var restored = await _executor.RestoreAsync(request, CancellationToken.None);
    var replay = await _executor.RestoreAsync(request, CancellationToken.None);

    Assert.Equal("before", await File.ReadAllTextAsync(targetPath));
    Assert.Equal(before.Sha256, restored.RestoredStateSha256);
    Assert.False(restored.IdempotentReplay);
    Assert.True(replay.IdempotentReplay);
    Assert.Equal("after", await File.ReadAllTextAsync(Path.Combine(
      _quarantine,
      PayloadDigest.Sha256Hex(actionId),
      "replaced-target")));
  }

  [Fact]
  public async Task MovesDestinationBackToItsExactOriginalSourceAndReplays()
  {
    var sourcePath = Path.Combine(_root, "source.txt");
    var destinationPath = Path.Combine(_root, "destination.txt");
    await File.WriteAllTextAsync(sourcePath, "movable");
    var before = await StateAsync("source.txt", HostPathAccess.Delete);
    using var arguments = JsonDocument.Parse(
      """{"sourceRootId":"managed","sourceRelativePath":"source.txt","destinationRootId":"managed","destinationRelativePath":"destination.txt"}""");
    var actionId = "move-action";
    var adapter = new FileSystemEntryMoveCapabilityAdapter(_paths, _vault);
    var moved = await adapter.ExecuteAsync(
      Context(actionId, before.Sha256),
      arguments.RootElement,
      CancellationToken.None);
    using var output = JsonDocument.Parse(moved.OutputJson);
    var expectedCurrent = output.RootElement.GetProperty("stateSha256").GetString()!;
    var request = new TrustedFileSystemRecoveryRequest(
      actionId,
      moved.RecoveryProvenanceSha256!,
      expectedCurrent);

    var restored = await _executor.RestoreAsync(request, CancellationToken.None);
    var replay = await _executor.RestoreAsync(request, CancellationToken.None);

    Assert.Equal("movable", await File.ReadAllTextAsync(sourcePath));
    Assert.False(File.Exists(destinationPath));
    Assert.Equal(before.Sha256, restored.RestoredStateSha256);
    Assert.False(restored.IdempotentReplay);
    Assert.True(replay.IdempotentReplay);
  }

  [Fact]
  public async Task RefusesRecoveryWhenTheCreatedTargetNoLongerMatchesCentralState()
  {
    var execution = await ExecuteCreatedTargetScenarioAsync(
      "filesystem.file.write",
      "precondition-action");
    using var output = JsonDocument.Parse(execution.Result.OutputJson);
    var expectedCurrent = output.RootElement.GetProperty("stateSha256").GetString()!;
    await File.WriteAllTextAsync(execution.TargetPath, "changed-after-action");

    var error = await Assert.ThrowsAsync<HostRecoveryException>(() =>
      _executor.RestoreAsync(
        new TrustedFileSystemRecoveryRequest(
          "precondition-action",
          execution.Result.RecoveryProvenanceSha256!,
          expectedCurrent),
        CancellationToken.None).AsTask());

    Assert.Equal("recovery_precondition_mismatch", error.ErrorCode);
    Assert.Equal("changed-after-action", await File.ReadAllTextAsync(execution.TargetPath));
  }

  [Fact]
  public async Task RejectsMalformedProtectedRecordWithoutTouchingTheTarget()
  {
    var targetPath = Path.Combine(_root, "untouched.txt");
    await File.WriteAllTextAsync(targetPath, "safe");
    using var malformed = JsonDocument.Parse("""{"rootId":"managed"}""");
    var record = Record(
      "malformed-action",
      "filesystem.file.write",
      HostFileSystemSupport.AbsentStateSha256,
      malformed.RootElement);
    var executor = new TrustedFileSystemRecoveryExecutor(
      new FakeRecordReader(record),
      _paths,
      _host);

    var error = await Assert.ThrowsAsync<HostRecoveryException>(() =>
      executor.RestoreAsync(
        Request("malformed-action"),
        CancellationToken.None).AsTask());

    Assert.Equal("recovery_record_format_invalid", error.ErrorCode);
    Assert.Equal("safe", await File.ReadAllTextAsync(targetPath));
  }

  [Theory]
  [InlineData("..\\outside.txt")]
  [InlineData("C:\\Windows\\win.ini")]
  [InlineData("\\\\server\\share\\file.txt")]
  [InlineData("\\\\?\\C:\\Windows\\win.ini")]
  [InlineData("file.txt:secret")]
  [InlineData("CON.txt")]
  public async Task RejectsAdversarialRecoveryPaths(string relativePath)
  {
    var recoveryRecord = JsonSerializer.SerializeToElement(new
    {
      rootId = "managed",
      relativePath,
      recovery = "remove-empty-created-folder",
    });
    var record = Record(
      "adversarial-action",
      "filesystem.folder.create",
      HostFileSystemSupport.AbsentStateSha256,
      recoveryRecord);
    var executor = new TrustedFileSystemRecoveryExecutor(
      new FakeRecordReader(record),
      _paths,
      _host);

    var error = await Assert.ThrowsAsync<HostRecoveryException>(() =>
      executor.RestoreAsync(
        Request("adversarial-action"),
        CancellationToken.None).AsTask());

    Assert.Equal("recovery_record_path_invalid", error.ErrorCode);
  }

  [Fact]
  public async Task RejectsHardLinkedRecoveryTarget()
  {
    var original = Path.Combine(_root, "original.txt");
    var linked = Path.Combine(_root, "linked.txt");
    await File.WriteAllTextAsync(original, "same-file");
    Assert.True(CreateHardLink(linked, original, IntPtr.Zero));
    var recoveryRecord = JsonSerializer.SerializeToElement(new
    {
      rootId = "managed",
      relativePath = "linked.txt",
      mode = "create",
      backupPath = (string?)null,
      recovery = "delete-created-target",
    });
    var record = Record(
      "hard-link-action",
      "filesystem.file.write",
      HostFileSystemSupport.AbsentStateSha256,
      recoveryRecord);
    var executor = new TrustedFileSystemRecoveryExecutor(
      new FakeRecordReader(record),
      _paths,
      _host);

    var error = await Assert.ThrowsAsync<HostRecoveryException>(() =>
      executor.RestoreAsync(
        Request("hard-link-action"),
        CancellationToken.None).AsTask());

    Assert.Equal("recovery_record_path_invalid", error.ErrorCode);
    Assert.True(File.Exists(original));
    Assert.True(File.Exists(linked));
  }

  private async Task<(CapabilityExecutionResult Result, string TargetPath)>
    ExecuteCreatedTargetScenarioAsync(string scenario, string actionId)
  {
    IHostCapabilityAdapter adapter;
    JsonDocument arguments;
    string targetRelative;
    switch (scenario)
    {
      case "filesystem.file.write":
        targetRelative = "created.txt";
        adapter = new FileSystemFileWriteCapabilityAdapter(_paths, _vault, _host);
        arguments = JsonDocument.Parse(JsonSerializer.Serialize(new
        {
          rootId = "managed",
          relativePath = targetRelative,
          contentBase64 = Convert.ToBase64String("created"u8.ToArray()),
          mode = "create",
        }));
        break;
      case "filesystem.folder.create":
        targetRelative = "created-folder";
        adapter = new FileSystemFolderCreateCapabilityAdapter(_paths, _vault);
        arguments = JsonDocument.Parse(
          """{"rootId":"managed","relativePath":"created-folder"}""");
        break;
      case "filesystem.entry.copy":
        await File.WriteAllTextAsync(Path.Combine(_root, "copy-source.txt"), "copied");
        targetRelative = "copied.txt";
        adapter = new FileSystemEntryCopyCapabilityAdapter(_paths, _vault);
        arguments = JsonDocument.Parse(
          """{"sourceRootId":"managed","sourceRelativePath":"copy-source.txt","destinationRootId":"managed","destinationRelativePath":"copied.txt"}""");
        break;
      case "filesystem.entry.copy-directory":
        Directory.CreateDirectory(Path.Combine(_root, "copy-source-folder", "nested"));
        await File.WriteAllTextAsync(
          Path.Combine(_root, "copy-source-folder", "nested", "data.txt"),
          "tree");
        targetRelative = "copied-folder";
        adapter = new FileSystemEntryCopyCapabilityAdapter(_paths, _vault);
        arguments = JsonDocument.Parse(
          """{"sourceRootId":"managed","sourceRelativePath":"copy-source-folder","destinationRootId":"managed","destinationRelativePath":"copied-folder"}""");
        break;
      case "filesystem.archive.create":
        await File.WriteAllTextAsync(Path.Combine(_root, "archive-source.txt"), "archived");
        targetRelative = "created.zip";
        adapter = new FileSystemArchiveCreateCapabilityAdapter(_paths, _vault);
        arguments = JsonDocument.Parse(
          """{"sourceRootId":"managed","sourceRelativePath":"archive-source.txt","destinationRootId":"managed","destinationRelativePath":"created.zip"}""");
        break;
      case "filesystem.archive.extract":
        await using (var archiveStream = new FileStream(
          Path.Combine(_root, "extract-source.zip"),
          FileMode.CreateNew,
          FileAccess.Write,
          FileShare.None))
        {
          using var archive = new ZipArchive(
            archiveStream,
            ZipArchiveMode.Create,
            leaveOpen: true);
          var entry = archive.CreateEntry("nested/data.txt", CompressionLevel.NoCompression);
          await using var content = entry.Open();
          await content.WriteAsync("tree"u8.ToArray());
        }
        targetRelative = "extracted-folder";
        adapter = new FileSystemArchiveExtractCapabilityAdapter(_paths, _vault, _host);
        arguments = JsonDocument.Parse(
          """{"sourceRootId":"managed","sourceRelativePath":"extract-source.zip","destinationRootId":"managed","destinationRelativePath":"extracted-folder"}""");
        break;
      default:
        throw new ArgumentOutOfRangeException(nameof(scenario));
    }

    using (arguments)
    {
      var result = await adapter.ExecuteAsync(
        Context(actionId, HostFileSystemSupport.AbsentStateSha256),
        arguments.RootElement,
        CancellationToken.None);
      return (result, Path.Combine(_root, targetRelative));
    }
  }

  private ValueTask<HostStateDigest> StateAsync(
    string relativePath,
    HostPathAccess access = HostPathAccess.Write) =>
    HostFileSystemSupport.ComputeStateAsync(
      _paths,
      _paths.Resolve("managed", relativePath, access),
      10_000_000,
      CancellationToken.None);

  private static ActionExecutionContext Context(string actionId, string expectedPreState) => new(
    actionId,
    "task-1",
    "plan-1",
    $"step-{actionId}",
    "device-1",
    "mandate-1",
    $"idempotency-{actionId}",
    expectedPreState,
    InputProvenanceSha256: null,
    new ActionBudget(60, 10, 20, 10, 10_000_000, 1_000_000, 1m));

  private static TrustedFileSystemRecoveryRequest Request(string actionId) => new(
    actionId,
    new string('a', 64),
    new string('b', 64));

  private static TrustedHostRecoveryRecord Record(
    string actionId,
    string operation,
    string preStateSha256,
    JsonElement recoveryRecord) => new(
      actionId,
      "task-1",
      "plan-1",
      "step-1",
      "device-1",
      "mandate-1",
      operation,
      preStateSha256,
      Irreversible: false,
      new string('a', 64),
      recoveryRecord.Clone());

  private sealed class FakeRecordReader(TrustedHostRecoveryRecord record) :
    ITrustedHostRecoveryRecordReader
  {
    public ValueTask<TrustedHostRecoveryRecord> ReadAsync(
      string actionId,
      string expectedRecordSha256,
      CancellationToken cancellationToken) => ValueTask.FromResult(record);
  }

  [LibraryImport("kernel32.dll", EntryPoint = "CreateHardLinkW", SetLastError = true,
    StringMarshalling = StringMarshalling.Utf16)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool CreateHardLink(
    string fileName,
    string existingFileName,
    IntPtr securityAttributes);

  public void Dispose()
  {
    if (Directory.Exists(_directory))
    {
      Directory.Delete(_directory, recursive: true);
    }
  }
}
