using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class FileSystemArchiveExtractCapabilityTests : IDisposable
{
  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"msaidizi-archive-extract-{Guid.NewGuid():N}");
  private readonly string _root;
  private readonly HostCapabilityOptions _options;
  private readonly SupervisorPathPolicy _paths;
  private readonly RecordingRecoveryVault _recovery = new();

  public FileSystemArchiveExtractCapabilityTests()
  {
    _root = Path.Combine(_directory, "managed");
    var supervisor = Path.Combine(_directory, "supervisor");
    Directory.CreateDirectory(_root);
    Directory.CreateDirectory(supervisor);
    _options = new HostCapabilityOptions
    {
      Enabled = true,
      RecoveryVaultPath = Path.Combine(supervisor, "recovery"),
      MaximumSingleFileBytes = 2_000_000,
      MaximumArchiveEntries = 32,
      MaximumArchiveEntryPathLength = 256,
      MaximumArchiveExpandedBytes = 2_000_000,
      MaximumArchiveCompressionRatio = 100,
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
      Options.Create(_options),
      Options.Create(new CompanionOptions
      {
        JournalPath = Path.Combine(supervisor, "journal.jsonl"),
        KillSwitchPath = Path.Combine(supervisor, "DISABLED"),
        ResultCachePath = Path.Combine(supervisor, "results"),
      }));
  }

  [Fact]
  public async Task ExtractsNestedTreeWithExactAccountingStateRecoveryAndProvenance()
  {
    var archive = CreateZip(
      Entry("reports/", []),
      Entry("reports/sales.csv", "sku,quantity\nA,12.50"u8.ToArray()),
      Entry("readme.txt", "trusted"u8.ToArray()));
    await File.WriteAllBytesAsync(Path.Combine(_root, "input.zip"), archive);
    var adapter = Adapter();
    using var arguments = Arguments("input.zip", "expanded");

    Assert.True(adapter.ValidateArguments(arguments.RootElement).IsValid);
    var result = await adapter.ExecuteAsync(
      Context("happy", HostFileSystemSupport.AbsentStateSha256),
      arguments.RootElement,
      CancellationToken.None);

    Assert.True(result.MutationCommitted);
    Assert.False(result.OutcomeUncertain);
    Assert.Equal(archive.LongLength + 27, result.LocalBytesRead);
    Assert.Equal(27, result.LocalBytesWritten);
    Assert.Equal(2, result.Provenance.Count);
    Assert.Equal(
      ["windows-zip-archive-source", "windows-zip-extracted-tree"],
      result.Provenance.Select(value => value.SourceType).ToArray());
    Assert.Equal("sku,quantity\nA,12.50", await File.ReadAllTextAsync(
      Path.Combine(_root, "expanded", "reports", "sales.csv")));
    Assert.Equal("trusted", await File.ReadAllTextAsync(
      Path.Combine(_root, "expanded", "readme.txt")));
    using var output = JsonDocument.Parse(result.OutputJson);
    Assert.True(adapter.ValidateResult(output.RootElement).IsValid);
    Assert.Equal(3, output.RootElement.GetProperty("entryCount").GetInt32());
    Assert.Equal(27, output.RootElement.GetProperty("expandedBytes").GetInt64());
    var destination = _paths.Resolve("managed", "expanded", HostPathAccess.Read);
    var finalState = await HostFileSystemSupport.ComputeStateAsync(
      _paths,
      destination,
      2_000_000,
      CancellationToken.None);
    Assert.Equal(
      output.RootElement.GetProperty("stateSha256").GetString(),
      finalState.Sha256);
    Assert.Equal(FileSystemArchiveExtractCapabilityAdapter.CapabilityId, _recovery.Operation);
    Assert.Equal(HostFileSystemSupport.AbsentStateSha256, _recovery.PreStateSha256);
    Assert.Equal("delete-created-extracted-tree", _recovery.Record
      .GetProperty("recovery").GetString());
    Assert.Equal(output.RootElement.GetProperty("sourceArchiveSha256").GetString(),
      _recovery.Record.GetProperty("sourceStateSha256").GetString());
  }

  [Fact]
  public async Task EmptyArchiveCreatesAnEmptyRecoverableDirectory()
  {
    var archive = CreateZip();
    await File.WriteAllBytesAsync(Path.Combine(_root, "empty.zip"), archive);
    var adapter = Adapter();
    using var arguments = Arguments("empty.zip", "empty-output");

    var result = await adapter.ExecuteAsync(
      Context("empty", HostFileSystemSupport.AbsentStateSha256),
      arguments.RootElement,
      CancellationToken.None);

    Assert.True(Directory.Exists(Path.Combine(_root, "empty-output")));
    Assert.Equal(0, result.LocalBytesWritten);
    using var output = JsonDocument.Parse(result.OutputJson);
    Assert.Equal(0, output.RootElement.GetProperty("entryCount").GetInt32());
  }

  [Fact]
  public async Task AggregateLocalByteBudgetHasAnExactTwoPassBoundary()
  {
    var payload = Enumerable.Range(0, 128).Select(value => (byte)value).ToArray();
    var archive = CreateZip(Entry(
      "bounded.bin",
      payload,
      CompressionLevel.NoCompression));
    await WriteArchiveAsync("budget.zip", archive);
    var exactBudget = checked(archive.LongLength + (2 * payload.LongLength));
    var adapter = Adapter();
    using (var rejectedArguments = Arguments("budget.zip", "budget-rejected"))
    {
      var error = await Assert.ThrowsAsync<HostPolicyException>(() => adapter.ExecuteAsync(
        Context(
          "budget-rejected",
          HostFileSystemSupport.AbsentStateSha256,
          exactBudget - 1),
        rejectedArguments.RootElement,
        CancellationToken.None).AsTask());
      Assert.Equal("local_byte_budget_exceeded", error.ErrorCode);
      Assert.False(Directory.Exists(Path.Combine(_root, "budget-rejected")));
      AssertNoStagingEntries();
    }

    using var acceptedArguments = Arguments("budget.zip", "budget-accepted");
    var result = await adapter.ExecuteAsync(
      Context(
        "budget-accepted",
        HostFileSystemSupport.AbsentStateSha256,
        exactBudget),
      acceptedArguments.RootElement,
      CancellationToken.None);
    Assert.Equal(exactBudget, result.LocalBytesRead + result.LocalBytesWritten);
    Assert.Equal(archive.LongLength + payload.LongLength, result.LocalBytesRead);
    Assert.Equal(payload.LongLength, result.LocalBytesWritten);
  }

  [Theory]
  [InlineData("../escape.txt")]
  [InlineData("/rooted.txt")]
  [InlineData("//server/share.txt")]
  [InlineData("C:/device.txt")]
  [InlineData("folder/file.txt:stream")]
  [InlineData("CON.txt")]
  [InlineData("folder\\backslash.txt")]
  public async Task RejectsTraversalRootedDeviceUncAdsAndAmbiguousPaths(string entryName)
  {
    await WriteArchiveAsync("malicious.zip", CreateZip(Entry(entryName, "x"u8.ToArray())));
    var adapter = Adapter();
    using var arguments = Arguments("malicious.zip", "must-not-exist");

    var error = await Assert.ThrowsAsync<HostPolicyException>(() => adapter.ExecuteAsync(
      Context("bad-path", HostFileSystemSupport.AbsentStateSha256),
      arguments.RootElement,
      CancellationToken.None).AsTask());

    Assert.Equal("archive_entry_path_forbidden", error.ErrorCode);
    Assert.False(Directory.Exists(Path.Combine(_root, "must-not-exist")));
    AssertNoStagingEntries();
  }

  [Fact]
  public async Task RejectsCaseInsensitiveDuplicatesBeforeCreatingStaging()
  {
    await WriteArchiveAsync("duplicates.zip", CreateZip(
      Entry("Report.txt", "first"u8.ToArray()),
      Entry("report.TXT", "second"u8.ToArray())));
    var error = await ExecutePolicyFailureAsync("duplicates.zip", "duplicate-output");

    Assert.Equal("archive_duplicate_path", error.ErrorCode);
    AssertNoStagingEntries();
  }

  [Fact]
  public async Task RejectsFileDirectoryConflictsIncludingImplicitParents()
  {
    await WriteArchiveAsync("conflict.zip", CreateZip(
      Entry("node", "file"u8.ToArray()),
      Entry("node/child.txt", "child"u8.ToArray())));
    var error = await ExecutePolicyFailureAsync("conflict.zip", "conflict-output");

    Assert.Equal("archive_file_directory_conflict", error.ErrorCode);
    AssertNoStagingEntries();
  }

  [Fact]
  public async Task RejectsCaseVariantImplicitAncestorsBeforeAnyWrite()
  {
    await WriteArchiveAsync("ancestor-case.zip", CreateZip(
      Entry("Folder/first.txt", "first"u8.ToArray()),
      Entry("folder/second.txt", "second"u8.ToArray())));

    var error = await ExecutePolicyFailureAsync(
      "ancestor-case.zip",
      "ancestor-case-output");

    Assert.Equal("archive_case_ambiguous_path", error.ErrorCode);
    AssertNoStagingEntries();
  }

  [Fact]
  public async Task RejectsCompressionBombByPerEntryRatioBeforeAnyWrite()
  {
    _options.MaximumArchiveCompressionRatio = 4;
    var expanded = new byte[100_000];
    await WriteArchiveAsync("bomb.zip", CreateZip(
      Entry("bomb.bin", expanded, CompressionLevel.SmallestSize)));

    var error = await ExecutePolicyFailureAsync("bomb.zip", "bomb-output");

    Assert.Equal("archive_compression_ratio_exceeded", error.ErrorCode);
    AssertNoStagingEntries();
  }

  [Fact]
  public async Task RejectsExpandedByteEntryAndPathCeilingsBeforeAnyWrite()
  {
    _options.MaximumArchiveExpandedBytes = 4;
    await WriteArchiveAsync("expanded.zip", CreateZip(
      Entry("data.bin", "12345"u8.ToArray(), CompressionLevel.NoCompression)));
    var expandedError = await ExecutePolicyFailureAsync("expanded.zip", "expanded-output");
    Assert.Equal("archive_expanded_byte_limit_exceeded", expandedError.ErrorCode);

    _options.MaximumArchiveExpandedBytes = 2_000_000;
    _options.MaximumArchiveEntryPathLength = 12;
    await WriteArchiveAsync("path.zip", CreateZip(
      Entry("folder/very-long-name.txt", "x"u8.ToArray())));
    var pathError = await ExecutePolicyFailureAsync("path.zip", "path-output");
    Assert.Equal("archive_entry_path_too_long", pathError.ErrorCode);
    AssertNoStagingEntries();
  }

  [Fact]
  public async Task CountsImplicitDirectoriesAgainstTheEntryCeiling()
  {
    _options.MaximumArchiveEntries = 2;
    await WriteArchiveAsync("implicit.zip", CreateZip(
      Entry("one/two/file.txt", "x"u8.ToArray())));

    var error = await ExecutePolicyFailureAsync("implicit.zip", "implicit-output");

    Assert.Equal("archive_entry_limit_exceeded", error.ErrorCode);
  }

  [Theory]
  [InlineData(ArchiveMutation.Encrypted, "archive_encryption_forbidden")]
  [InlineData(ArchiveMutation.UnsupportedCompression, "archive_compression_method_unsupported")]
  [InlineData(ArchiveMutation.UnixSymlink, "archive_link_metadata_forbidden")]
  [InlineData(ArchiveMutation.UnixSpecialFile, "archive_link_metadata_forbidden")]
  [InlineData(ArchiveMutation.WindowsReparsePoint, "archive_link_metadata_forbidden")]
  public async Task RejectsEncryptedUnsupportedAndLinkLikeMetadata(
    ArchiveMutation mutation,
    string expectedError)
  {
    var bytes = CreateZip(Entry(
      "entry.txt",
      "payload"u8.ToArray(),
      CompressionLevel.NoCompression));
    MutateArchive(bytes, mutation);
    await WriteArchiveAsync("metadata.zip", bytes);

    var error = await ExecutePolicyFailureAsync("metadata.zip", "metadata-output");

    Assert.Equal(expectedError, error.ErrorCode);
    AssertNoStagingEntries();
  }

  [Fact]
  public async Task RejectsCorruptPayloadByCentralCrcAndRemovesStaging()
  {
    var bytes = CreateZip(Entry(
      "entry.txt",
      "payload"u8.ToArray(),
      CompressionLevel.NoCompression));
    var local = FindSignature(bytes, 0x04034b50);
    var nameLength = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(local + 26));
    var extraLength = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(local + 28));
    bytes[local + 30 + nameLength + extraLength] ^= 0x7f;
    await WriteArchiveAsync("corrupt.zip", bytes);

    var error = await ExecutePolicyFailureAsync("corrupt.zip", "corrupt-output");

    Assert.Equal("archive_entry_integrity_mismatch", error.ErrorCode);
    AssertNoStagingEntries();
  }

  [Fact]
  public async Task CancellationBeforeCommitRemovesAllGovernedStaging()
  {
    await WriteArchiveAsync("cancel.zip", CreateZip(
      Entry("nested/data.txt", "cancel-me"u8.ToArray())));
    using var source = new CancellationTokenSource();
    var observer = new CancellingObserver(source);
    var adapter = Adapter(observer);
    using var arguments = Arguments("cancel.zip", "cancel-output");

    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => adapter.ExecuteAsync(
      Context("cancel", HostFileSystemSupport.AbsentStateSha256),
      arguments.RootElement,
      source.Token).AsTask());

    Assert.False(Directory.Exists(Path.Combine(_root, "cancel-output")));
    AssertNoStagingEntries();
  }

  [Fact]
  public async Task DestinationRaceNeverOverwritesAndCleansOnlyOwnedStaging()
  {
    await WriteArchiveAsync("race.zip", CreateZip(
      Entry("data.txt", "trusted"u8.ToArray())));
    var observer = new DestinationRaceObserver();
    var adapter = Adapter(observer);
    using var arguments = Arguments("race.zip", "raced-output");

    var error = await Assert.ThrowsAsync<HostPreconditionException>(() => adapter.ExecuteAsync(
      Context("destination-race", HostFileSystemSupport.AbsentStateSha256),
      arguments.RootElement,
      CancellationToken.None).AsTask());

    Assert.Equal("destination_changed_before_commit", error.ErrorCode);
    Assert.Equal("attacker-owned", await File.ReadAllTextAsync(
      Path.Combine(_root, "raced-output", "owner.txt")));
    AssertNoStagingEntries();
  }

  [Fact]
  public async Task SourceWriteAndRenameRaceIsBlockedByExactLockedHandle()
  {
    await WriteArchiveAsync("locked.zip", CreateZip(
      Entry("data.txt", "trusted"u8.ToArray())));
    var observer = new SourceMutationObserver();
    var adapter = Adapter(observer);
    using var arguments = Arguments("locked.zip", "locked-output");

    var result = await adapter.ExecuteAsync(
      Context("source-race", HostFileSystemSupport.AbsentStateSha256),
      arguments.RootElement,
      CancellationToken.None);

    Assert.True(result.MutationCommitted);
    Assert.True(observer.WriteBlocked);
    Assert.True(observer.RenameBlocked);
    Assert.Equal("trusted", await File.ReadAllTextAsync(
      Path.Combine(_root, "locked-output", "data.txt")));
  }

  [Fact]
  public async Task UnexpectedStagingEntryFailsClosedAndIsCleaned()
  {
    await WriteArchiveAsync("staging-race.zip", CreateZip(
      Entry("data.txt", "trusted"u8.ToArray())));
    var adapter = Adapter(new StagingInjectionObserver());
    using var arguments = Arguments("staging-race.zip", "staging-race-output");

    var error = await Assert.ThrowsAsync<HostPreconditionException>(() => adapter.ExecuteAsync(
      Context("staging-race", HostFileSystemSupport.AbsentStateSha256),
      arguments.RootElement,
      CancellationToken.None).AsTask());

    Assert.Equal("archive_staging_tree_changed", error.ErrorCode);
    Assert.False(Directory.Exists(Path.Combine(_root, "staging-race-output")));
    AssertNoStagingEntries();
  }

  [Fact]
  public async Task PostCommitRollbackFailureSurfacesAsUnknownWriteOutcome()
  {
    await WriteArchiveAsync("rollback.zip", CreateZip(
      Entry("data.txt", "trusted"u8.ToArray())));
    using var observer = new PostCommitRollbackBlockObserver();
    var adapter = Adapter(observer);
    using var arguments = Arguments("rollback.zip", "rollback-output");

    var error = await Assert.ThrowsAsync<IOException>(() => adapter.ExecuteAsync(
      Context("rollback-unknown", HostFileSystemSupport.AbsentStateSha256),
      arguments.RootElement,
      CancellationToken.None).AsTask());

    Assert.Contains("exact rollback was not provable", error.Message, StringComparison.Ordinal);
    Assert.True(Directory.Exists(Path.Combine(_root, "rollback-output")));
    // ActionExecutionCoordinator classifies every non-precondition exception
    // from a mutation adapter as write_outcome_unknown / NEEDS_ATTENTION.
    Assert.True(adapter.Descriptor.IsMutation);
  }

  [Fact]
  public async Task MissingOrWrongExpectedDestinationStateFailsBeforeMutation()
  {
    await WriteArchiveAsync("prestate.zip", CreateZip(
      Entry("data.txt", "trusted"u8.ToArray())));
    var adapter = Adapter();
    using var arguments = Arguments("prestate.zip", "prestate-output");

    var error = await Assert.ThrowsAsync<HostPreconditionException>(() => adapter.ExecuteAsync(
      Context("prestate", new string('a', 64)),
      arguments.RootElement,
      CancellationToken.None).AsTask());

    Assert.Equal("expected_pre_state_mismatch", error.ErrorCode);
    Assert.False(Directory.Exists(Path.Combine(_root, "prestate-output")));
    Assert.Empty(_recovery.Operation);
  }

  [Fact]
  public void DescriptorAndSchemasAreClosedVersionedAndGoverned()
  {
    var adapter = Adapter();
    Assert.Equal("filesystem.archive.extract", adapter.Descriptor.Id);
    Assert.Equal("1.0.0", adapter.Descriptor.Version);
    Assert.Equal(CapabilityEffect.LocalWrite, adapter.Descriptor.Effect);
    Assert.Equal(ConsentRequirement.SignedMandate, adapter.Descriptor.Consent);
    Assert.Equal(RecoveryKind.CompensatingAction, adapter.Descriptor.Recovery);
    Assert.Equal(RequiredPrivilege.LocalSystem, adapter.Descriptor.RequiredPrivilege);
    Assert.Equal(IdempotencySemantics.Required, adapter.Descriptor.Idempotency);
    Assert.False(adapter.Descriptor.TouchesTrustedRoot);
    Assert.False(adapter.Descriptor.ArgumentsSchema
      .GetProperty("additionalProperties").GetBoolean());
    Assert.False(adapter.Descriptor.ResultSchema
      .GetProperty("additionalProperties").GetBoolean());

    using var extraArgument = JsonDocument.Parse(
      """{"sourceRootId":"managed","sourceRelativePath":"x.zip","destinationRootId":"managed","destinationRelativePath":"out","extra":true}""");
    Assert.False(adapter.ValidateArguments(extraArgument.RootElement).IsValid);
    using var extraResult = JsonDocument.Parse(
      """{"rootId":"managed","relativePath":"out","entryType":"directory","entryCount":0,"expandedBytes":0,"sourceArchiveSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","stateSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","extra":true}""");
    Assert.False(adapter.ValidateResult(extraResult.RootElement).IsValid);
  }

  private FileSystemArchiveExtractCapabilityAdapter Adapter(
    IArchiveExtractCommitObserver? observer = null) => new(
      _paths,
      _recovery,
      Options.Create(_options),
      observer);

  private async Task<HostPolicyException> ExecutePolicyFailureAsync(
    string source,
    string destination)
  {
    var adapter = Adapter();
    using var arguments = Arguments(source, destination);
    return await Assert.ThrowsAsync<HostPolicyException>(() => adapter.ExecuteAsync(
      Context($"failure-{destination}", HostFileSystemSupport.AbsentStateSha256),
      arguments.RootElement,
      CancellationToken.None).AsTask());
  }

  private async Task WriteArchiveAsync(string name, byte[] content) =>
    await File.WriteAllBytesAsync(Path.Combine(_root, name), content);

  private static JsonDocument Arguments(string source, string destination) =>
    JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      sourceRootId = "managed",
      sourceRelativePath = source,
      destinationRootId = "managed",
      destinationRelativePath = destination,
    }));

  private static ActionExecutionContext Context(
    string actionId,
    string expectedPreState,
    long maximumLocalBytes = 10_000_000) => new(
      actionId,
      "task-archive",
      "plan-archive",
      "step-archive",
      "device-archive",
      "mandate-archive",
      $"idempotency-{actionId}",
      expectedPreState,
      InputProvenanceSha256: null,
      new ActionBudget(60, 10, 20, 10, maximumLocalBytes, 1_000_000, 1m));

  private static ZipInput Entry(
    string name,
    byte[] content,
    CompressionLevel compression = CompressionLevel.Optimal) => new(
      name,
      content,
      compression);

  private static byte[] CreateZip(params ZipInput[] inputs)
  {
    using var stream = new MemoryStream();
    using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
    {
      foreach (var input in inputs)
      {
        var entry = archive.CreateEntry(input.Name, input.Compression);
        if (input.Name.EndsWith('/'))
        {
          continue;
        }
        using var output = entry.Open();
        output.Write(input.Content);
      }
    }
    return stream.ToArray();
  }

  private static void MutateArchive(byte[] bytes, ArchiveMutation mutation)
  {
    var local = FindSignature(bytes, 0x04034b50);
    var central = FindSignature(bytes, 0x02014b50);
    switch (mutation)
    {
      case ArchiveMutation.Encrypted:
        WriteUInt16(bytes, local + 6, (ushort)(ReadUInt16(bytes, local + 6) | 1));
        WriteUInt16(bytes, central + 8, (ushort)(ReadUInt16(bytes, central + 8) | 1));
        break;
      case ArchiveMutation.UnsupportedCompression:
        WriteUInt16(bytes, local + 8, 12);
        WriteUInt16(bytes, central + 10, 12);
        break;
      case ArchiveMutation.UnixSymlink:
        WriteUInt16(bytes, central + 4, 0x0314);
        WriteUInt32(bytes, central + 38, 0xa1ff0000);
        break;
      case ArchiveMutation.UnixSpecialFile:
        WriteUInt16(bytes, central + 4, 0x0314);
        WriteUInt32(bytes, central + 38, 0x61ff0000);
        break;
      case ArchiveMutation.WindowsReparsePoint:
        WriteUInt32(bytes, central + 38, 0x00000400);
        break;
      default:
        throw new ArgumentOutOfRangeException(nameof(mutation));
    }
  }

  private static int FindSignature(byte[] bytes, uint signature)
  {
    for (var index = 0; index <= bytes.Length - sizeof(uint); index++)
    {
      if (BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(index)) == signature)
      {
        return index;
      }
    }
    throw new InvalidOperationException("ZIP test signature not found.");
  }

  private static ushort ReadUInt16(byte[] bytes, int offset) =>
    BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(offset));

  private static void WriteUInt16(byte[] bytes, int offset, ushort value) =>
    BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(offset), value);

  private static void WriteUInt32(byte[] bytes, int offset, uint value) =>
    BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(offset), value);

  private void AssertNoStagingEntries() => Assert.DoesNotContain(
    Directory.EnumerateFileSystemEntries(_root),
    path => Path.GetFileName(path).StartsWith(".msaidizi-", StringComparison.Ordinal));

  public void Dispose()
  {
    if (Directory.Exists(_directory))
    {
      Directory.Delete(_directory, recursive: true);
    }
  }

  public enum ArchiveMutation
  {
    Encrypted,
    UnsupportedCompression,
    UnixSymlink,
    UnixSpecialFile,
    WindowsReparsePoint,
  }

  private sealed record ZipInput(
    string Name,
    byte[] Content,
    CompressionLevel Compression);

  private sealed class RecordingRecoveryVault : IHostRecoveryVault
  {
    public string Operation { get; private set; } = string.Empty;

    public string PreStateSha256 { get; private set; } = string.Empty;

    public JsonElement Record { get; private set; }

    public ValueTask<HostRecoveryReceipt> PrepareAsync(
      ActionExecutionContext context,
      string operation,
      string preStateSha256,
      object recoveryRecord,
      bool irreversible,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      Operation = operation;
      PreStateSha256 = preStateSha256;
      Record = JsonSerializer.SerializeToElement(recoveryRecord);
      return ValueTask.FromResult(new HostRecoveryReceipt(
        PayloadDigest.Sha256Hex(context.ActionId),
        PayloadDigest.Sha256Hex($"record:{context.ActionId}"),
        $"record:{context.ActionId}"));
    }
  }

  private sealed class CancellingObserver(CancellationTokenSource source) :
    IArchiveExtractCommitObserver
  {
    public ValueTask BeforeCommitAsync(
      string sourcePath,
      string destinationPath,
      string stagingPath,
      CancellationToken cancellationToken)
    {
      source.Cancel();
      return ValueTask.CompletedTask;
    }
  }

  private sealed class DestinationRaceObserver : IArchiveExtractCommitObserver
  {
    public ValueTask BeforeCommitAsync(
      string sourcePath,
      string destinationPath,
      string stagingPath,
      CancellationToken cancellationToken)
    {
      Directory.CreateDirectory(destinationPath);
      File.WriteAllText(Path.Combine(destinationPath, "owner.txt"), "attacker-owned");
      return ValueTask.CompletedTask;
    }
  }

  private sealed class StagingInjectionObserver : IArchiveExtractCommitObserver
  {
    public ValueTask BeforeCommitAsync(
      string sourcePath,
      string destinationPath,
      string stagingPath,
      CancellationToken cancellationToken)
    {
      File.WriteAllText(Path.Combine(stagingPath, "unexpected.txt"), "injected");
      return ValueTask.CompletedTask;
    }
  }

  private sealed class SourceMutationObserver : IArchiveExtractCommitObserver
  {
    public bool WriteBlocked { get; private set; }

    public bool RenameBlocked { get; private set; }

    public ValueTask BeforeCommitAsync(
      string sourcePath,
      string destinationPath,
      string stagingPath,
      CancellationToken cancellationToken)
    {
      try
      {
        File.WriteAllText(sourcePath, "replacement");
      }
      catch (IOException)
      {
        WriteBlocked = true;
      }
      try
      {
        File.Move(sourcePath, sourcePath + ".moved", overwrite: false);
      }
      catch (IOException)
      {
        RenameBlocked = true;
      }
      return ValueTask.CompletedTask;
    }
  }

  private sealed class PostCommitRollbackBlockObserver :
    IArchiveExtractCommitObserver,
    IDisposable
  {
    private FileStream? _lock;

    public ValueTask BeforeCommitAsync(
      string sourcePath,
      string destinationPath,
      string stagingPath,
      CancellationToken cancellationToken) => ValueTask.CompletedTask;

    public ValueTask AfterCommitBeforeVerificationAsync(
      string sourcePath,
      string destinationPath,
      CancellationToken cancellationToken)
    {
      var injected = Path.Combine(destinationPath, "unexpected-and-locked.txt");
      File.WriteAllText(injected, "force-postcondition-failure");
      _lock = new FileStream(
        injected,
        FileMode.Open,
        FileAccess.Read,
        FileShare.None);
      return ValueTask.CompletedTask;
    }

    public void Dispose() => _lock?.Dispose();
  }
}
