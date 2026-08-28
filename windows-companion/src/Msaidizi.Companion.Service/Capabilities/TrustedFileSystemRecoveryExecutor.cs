using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

public sealed record TrustedFileSystemRecoveryRequest(
  string OriginalActionId,
  string RecoveryRecordSha256,
  string ExpectedCurrentStateSha256);

public sealed record TrustedFileSystemRecoveryResult(
  string OriginalActionId,
  string Operation,
  string RestoredStateSha256,
  bool IdempotentReplay);

/// <summary>
/// Supervisor-only recovery for reversible filesystem mutations. The executor
/// is deliberately absent from the model capability registry. It accepts only
/// a signed recovery command's digests and re-resolves the protected record
/// through the same exact-handle NTFS policy used by the original mutation.
/// </summary>
public interface ITrustedFileSystemRecoveryExecutor
{
  ValueTask<TrustedFileSystemRecoveryResult> RestoreAsync(
    TrustedFileSystemRecoveryRequest request,
    CancellationToken cancellationToken);
}

public sealed class TrustedFileSystemRecoveryExecutor : ITrustedFileSystemRecoveryExecutor
{
  private const string CompensatedEntryName = "compensated-entry";
  private const string ReplacedTargetName = "replaced-target";
  private static readonly string EmptyCreatedFolderStateSha256 =
    PayloadDigest.Sha256Hex("msaidizi-host-state:empty-directory:v1");
  private static readonly HashSet<string> SupportedOperations = new(StringComparer.Ordinal)
  {
    "filesystem.file.write",
    "filesystem.folder.create",
    "filesystem.entry.copy",
    "filesystem.entry.move",
    "filesystem.archive.create",
    "filesystem.archive.extract",
  };

  private readonly ITrustedHostRecoveryRecordReader _records;
  private readonly SupervisorPathPolicy _paths;
  private readonly long _maximumBytes;

  public TrustedFileSystemRecoveryExecutor(
    ITrustedHostRecoveryRecordReader records,
    SupervisorPathPolicy paths,
    IOptions<HostCapabilityOptions> options)
  {
    _records = records;
    _paths = paths;
    _maximumBytes = options.Value.MaximumRecoveryBytes;
  }

  public async ValueTask<TrustedFileSystemRecoveryResult> RestoreAsync(
    TrustedFileSystemRecoveryRequest request,
    CancellationToken cancellationToken)
  {
    if (string.IsNullOrWhiteSpace(request.OriginalActionId)
      || request.OriginalActionId.Length > 512
      || !PayloadDigest.IsSha256Hex(request.RecoveryRecordSha256)
      || !PayloadDigest.IsSha256Hex(request.ExpectedCurrentStateSha256)
      || _maximumBytes <= 0)
    {
      throw new HostRecoveryException("recovery_request_invalid");
    }

    var record = await _records.ReadAsync(
      request.OriginalActionId,
      request.RecoveryRecordSha256,
      cancellationToken).ConfigureAwait(false);
    if (record.Irreversible || !SupportedOperations.Contains(record.Operation))
    {
      throw new HostRecoveryException("recovery_operation_not_supported");
    }

    try
    {
      return record.Operation switch
      {
        "filesystem.file.write" => await RestoreFileWriteAsync(
          record,
          request.ExpectedCurrentStateSha256,
          cancellationToken).ConfigureAwait(false),
        "filesystem.folder.create" => await RemoveCreatedTargetAsync(
          record,
          request.ExpectedCurrentStateSha256,
          expectedEntryType: "directory",
          usesSyntheticEmptyDirectoryDigest: true,
          expectedRecoveryMarker: "remove-empty-created-folder",
          cancellationToken).ConfigureAwait(false),
        "filesystem.entry.copy" => await RemoveCreatedTargetAsync(
          record,
          request.ExpectedCurrentStateSha256,
          expectedEntryType: null,
          usesSyntheticEmptyDirectoryDigest: false,
          expectedRecoveryMarker: "delete-created-copy",
          cancellationToken).ConfigureAwait(false),
        "filesystem.archive.create" => await RemoveCreatedTargetAsync(
          record,
          request.ExpectedCurrentStateSha256,
          expectedEntryType: "file",
          usesSyntheticEmptyDirectoryDigest: false,
          expectedRecoveryMarker: "delete-created-archive",
          cancellationToken).ConfigureAwait(false),
        "filesystem.archive.extract" => await RemoveCreatedTargetAsync(
          record,
          request.ExpectedCurrentStateSha256,
          expectedEntryType: "directory",
          usesSyntheticEmptyDirectoryDigest: false,
          expectedRecoveryMarker: "delete-created-extracted-tree",
          cancellationToken).ConfigureAwait(false),
        "filesystem.entry.move" => await RestoreMoveAsync(
          record,
          request.ExpectedCurrentStateSha256,
          cancellationToken).ConfigureAwait(false),
        _ => throw new HostRecoveryException("recovery_operation_not_supported"),
      };
    }
    catch (HostRecoveryException)
    {
      throw;
    }
    catch (Exception exception) when (exception is JsonException
      or KeyNotFoundException
      or InvalidOperationException
      or FormatException
      or ArgumentException
      or NotSupportedException
      or PathTooLongException)
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }
    catch (Exception exception) when (exception is HostPolicyException
      or HostPreconditionException)
    {
      throw new HostRecoveryException("recovery_record_path_invalid");
    }
    catch (Exception exception) when (exception is IOException
      or UnauthorizedAccessException)
    {
      throw new HostRecoveryException("recovery_outcome_unknown");
    }
  }

  private async ValueTask<TrustedFileSystemRecoveryResult> RestoreFileWriteAsync(
    TrustedHostRecoveryRecord record,
    string expectedCurrentStateSha256,
    CancellationToken cancellationToken)
  {
    EnsureExactProperties(
      record.RecoveryRecord,
      "rootId",
      "relativePath",
      "mode",
      "backupPath",
      "recovery");
    var mode = RequiredString(record.RecoveryRecord, "mode", 16);
    var marker = RequiredString(record.RecoveryRecord, "recovery", 64);
    if (mode == "create")
    {
      if (marker != "delete-created-target"
        || record.RecoveryRecord.GetProperty("backupPath").ValueKind != JsonValueKind.Null)
      {
        throw new HostRecoveryException("recovery_record_format_invalid");
      }
      return await RemoveCreatedTargetAsync(
        record,
        expectedCurrentStateSha256,
        expectedEntryType: "file",
        usesSyntheticEmptyDirectoryDigest: false,
        expectedRecoveryMarker: "delete-created-target",
        cancellationToken,
        recordAlreadyValidated: true).ConfigureAwait(false);
    }

    if (mode != "replace" || marker != "restore-snapshot")
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }

    var target = ResolveTarget(record.RecoveryRecord, HostPathAccess.Write);
    var recoveryDirectory = _paths.CreateRecoveryDirectory(target, record.ActionId);
    var expectedBackupPath = Path.Combine(recoveryDirectory, "prior-file.bin");
    var backupPath = RequiredString(record.RecoveryRecord, "backupPath", 32_767);
    if (!string.Equals(
      Path.GetFullPath(backupPath),
      expectedBackupPath,
      StringComparison.OrdinalIgnoreCase))
    {
      throw new HostRecoveryException("recovery_record_path_invalid");
    }

    var current = await ReadTargetStateAsync(target, cancellationToken).ConfigureAwait(false);
    if (current.EntryType == "file"
      && PayloadDigest.FixedTimeEqualsHex(current.Sha256, record.PreStateSha256))
    {
      return Result(record, record.PreStateSha256, idempotentReplay: true);
    }
    if (current.EntryType == "absent")
    {
      if (!PayloadDigest.FixedTimeEqualsHex(
        expectedCurrentStateSha256,
        HostFileSystemSupport.AbsentStateSha256))
      {
        throw new HostRecoveryException("recovery_precondition_mismatch");
      }
    }
    else if (current.EntryType != "file"
      || !PayloadDigest.FixedTimeEqualsHex(current.Sha256, expectedCurrentStateSha256))
    {
      throw new HostRecoveryException("recovery_precondition_mismatch");
    }

    var backup = await ReadRecoveryStateAsync(
      target,
      backupPath,
      cancellationToken).ConfigureAwait(false);
    if (backup.EntryType != "file"
      || !PayloadDigest.FixedTimeEqualsHex(backup.Sha256, record.PreStateSha256))
    {
      throw new HostRecoveryException("recovery_target_unavailable");
    }

    var replacedPath = Path.Combine(recoveryDirectory, ReplacedTargetName);
    if (File.Exists(replacedPath) || Directory.Exists(replacedPath))
    {
      throw new HostRecoveryException("recovery_precondition_mismatch");
    }

    using var targetParent = _paths.OpenParentForCreate(target);
    using var recoveryParent = _paths.OpenRecoveryEntry(
      target,
      recoveryDirectory,
      requireDirectory: true);
    using var backupHandle = _paths.OpenRecoveryEntry(
      target,
      backupPath,
      requireDirectory: false,
      deleteAccess: true,
      readData: true,
      lockAgainstMutation: true);
    EnsureIdentity(backup, backupHandle);

    ValidatedPathHandle? currentHandle = null;
    var currentMoved = false;
    try
    {
      if (current.EntryType == "file")
      {
        currentHandle = _paths.OpenExisting(
          target,
          requireDirectory: false,
          lockAgainstMutation: true,
          readData: true,
          deleteAccess: true);
        EnsureIdentity(current, currentHandle);
        SupervisorPathPolicy.EnsureHandleStillNames(currentHandle, target.FullPath);
        SupervisorPathPolicy.EnsureHandleStillNames(recoveryParent, recoveryDirectory);
        RenameOrUnknown(currentHandle, recoveryParent, ReplacedTargetName);
        currentMoved = true;
        EnsurePostRenameOrUnknown(currentHandle, replacedPath);
        HostStateDigest moved;
        try
        {
          moved = await ReadRecoveryStateAsync(
            target,
            replacedPath,
            cancellationToken,
            currentHandle).ConfigureAwait(false);
        }
        catch (Exception exception) when (exception is HostPolicyException
          or HostPreconditionException
          or IOException
          or UnauthorizedAccessException)
        {
          RollBackRename(currentHandle, targetParent, Path.GetFileName(target.FullPath));
          currentMoved = false;
          throw new HostRecoveryException("recovery_precondition_mismatch");
        }
        if (moved.EntryType != "file"
          || !PayloadDigest.FixedTimeEqualsHex(moved.Sha256, expectedCurrentStateSha256))
        {
          RollBackRename(currentHandle, targetParent, Path.GetFileName(target.FullPath));
          currentMoved = false;
          throw new HostRecoveryException("recovery_precondition_mismatch");
        }
      }

      SupervisorPathPolicy.EnsureHandleStillNames(targetParent, Path.GetDirectoryName(target.FullPath)!);
      SupervisorPathPolicy.EnsureHandleStillNames(backupHandle, backupPath);
      try
      {
        SupervisorPathPolicy.RenameExact(
          backupHandle,
          targetParent,
          Path.GetFileName(target.FullPath));
      }
      catch (Exception exception) when (exception is HostPolicyException
        or IOException
        or UnauthorizedAccessException)
      {
        if (currentMoved && !File.Exists(target.FullPath) && !Directory.Exists(target.FullPath))
        {
          RollBackRename(currentHandle!, targetParent, Path.GetFileName(target.FullPath));
        }
        throw new HostRecoveryException("recovery_outcome_unknown");
      }

      EnsurePostRenameOrUnknown(backupHandle, target.FullPath);
      HostStateDigest restored;
      try
      {
        restored = await ReadKnownTargetStateAsync(
          target,
          backupHandle,
          cancellationToken).ConfigureAwait(false);
      }
      catch (Exception exception) when (exception is HostPolicyException
        or HostPreconditionException
        or IOException
        or UnauthorizedAccessException)
      {
        throw new HostRecoveryException("recovery_outcome_unknown");
      }
      if (restored.EntryType != "file"
        || !PayloadDigest.FixedTimeEqualsHex(restored.Sha256, record.PreStateSha256))
      {
        throw new HostRecoveryException("recovery_postcondition_mismatch");
      }
      return Result(record, restored.Sha256, idempotentReplay: false);
    }
    finally
    {
      currentHandle?.Dispose();
    }
  }

  private async ValueTask<TrustedFileSystemRecoveryResult> RemoveCreatedTargetAsync(
    TrustedHostRecoveryRecord record,
    string expectedCurrentStateSha256,
    string? expectedEntryType,
    bool usesSyntheticEmptyDirectoryDigest,
    string expectedRecoveryMarker,
    CancellationToken cancellationToken,
    bool recordAlreadyValidated = false)
  {
    if (!recordAlreadyValidated)
    {
      var hasSourceDigest = record.Operation is
        "filesystem.entry.copy"
        or "filesystem.archive.create"
        or "filesystem.archive.extract";
      EnsureExactProperties(
        record.RecoveryRecord,
        hasSourceDigest
          ? ["rootId", "relativePath", "sourceStateSha256", "recovery"]
          : ["rootId", "relativePath", "recovery"]);
      if (hasSourceDigest
        && !PayloadDigest.IsSha256Hex(
          RequiredString(record.RecoveryRecord, "sourceStateSha256", 64)))
      {
        throw new HostRecoveryException("recovery_record_format_invalid");
      }
    }
    if (!PayloadDigest.FixedTimeEqualsHex(
      record.PreStateSha256,
      HostFileSystemSupport.AbsentStateSha256)
      || RequiredString(record.RecoveryRecord, "recovery", 64) != expectedRecoveryMarker)
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }

    var target = ResolveTarget(record.RecoveryRecord, HostPathAccess.Write);
    var current = await ReadTargetStateAsync(target, cancellationToken).ConfigureAwait(false);
    if (current.EntryType == "absent")
    {
      return Result(record, HostFileSystemSupport.AbsentStateSha256, idempotentReplay: true);
    }
    EnsureCreatedTargetMatches(
      current,
      expectedCurrentStateSha256,
      expectedEntryType,
      usesSyntheticEmptyDirectoryDigest);

    var recoveryDirectory = _paths.CreateRecoveryDirectory(target, record.ActionId);
    var compensatedPath = Path.Combine(recoveryDirectory, CompensatedEntryName);
    if (File.Exists(compensatedPath) || Directory.Exists(compensatedPath))
    {
      throw new HostRecoveryException("recovery_precondition_mismatch");
    }

    using var targetParent = _paths.OpenParentForCreate(target);
    using var recoveryParent = _paths.OpenRecoveryEntry(
      target,
      recoveryDirectory,
      requireDirectory: true);
    using var currentHandle = _paths.OpenExisting(
      target,
      requireDirectory: expectedEntryType == "directory"
        ? true
        : expectedEntryType == "file"
          ? false
          : null,
      lockAgainstMutation: true,
      readData: true,
      deleteAccess: true);
    EnsureIdentity(current, currentHandle);
    SupervisorPathPolicy.EnsureHandleStillNames(currentHandle, target.FullPath);
    SupervisorPathPolicy.EnsureHandleStillNames(recoveryParent, recoveryDirectory);
    RenameOrUnknown(currentHandle, recoveryParent, CompensatedEntryName);
    EnsurePostRenameOrUnknown(currentHandle, compensatedPath);

    HostStateDigest moved;
    try
    {
      moved = await ReadRecoveryStateAsync(
        target,
        compensatedPath,
        cancellationToken,
        currentHandle).ConfigureAwait(false);
    }
    catch (Exception exception) when (exception is HostPolicyException
      or HostPreconditionException
      or IOException
      or UnauthorizedAccessException)
    {
      RollBackRename(currentHandle, targetParent, Path.GetFileName(target.FullPath));
      throw new HostRecoveryException("recovery_precondition_mismatch");
    }
    try
    {
      EnsureCreatedTargetMatches(
        moved,
        expectedCurrentStateSha256,
        expectedEntryType,
        usesSyntheticEmptyDirectoryDigest);
    }
    catch (HostRecoveryException)
    {
      RollBackRename(currentHandle, targetParent, Path.GetFileName(target.FullPath));
      throw;
    }

    HostStateDigest restored;
    try
    {
      restored = await ReadTargetStateAsync(target, cancellationToken).ConfigureAwait(false);
    }
    catch (Exception exception) when (exception is HostPolicyException
      or HostPreconditionException
      or IOException
      or UnauthorizedAccessException)
    {
      throw new HostRecoveryException("recovery_postcondition_mismatch");
    }
    if (restored.EntryType != "absent"
      || !PayloadDigest.FixedTimeEqualsHex(
        restored.Sha256,
        HostFileSystemSupport.AbsentStateSha256))
    {
      throw new HostRecoveryException("recovery_postcondition_mismatch");
    }
    return Result(record, restored.Sha256, idempotentReplay: false);
  }

  private async ValueTask<TrustedFileSystemRecoveryResult> RestoreMoveAsync(
    TrustedHostRecoveryRecord record,
    string expectedCurrentStateSha256,
    CancellationToken cancellationToken)
  {
    EnsureExactProperties(
      record.RecoveryRecord,
      "rootId",
      "relativePath",
      "destinationRootId",
      "destinationRelativePath",
      "recovery");
    if (RequiredString(record.RecoveryRecord, "recovery", 64)
      != "move-destination-back-to-source")
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }

    var source = ResolveTarget(record.RecoveryRecord, HostPathAccess.Delete);
    var destination = _paths.Resolve(
      RequiredString(record.RecoveryRecord, "destinationRootId", 64),
      RequiredString(record.RecoveryRecord, "destinationRelativePath", 32_767),
      HostPathAccess.Write);
    if (SupervisorPathPolicy.IsEqualOrDescendant(destination.FullPath, source.FullPath))
    {
      throw new HostRecoveryException("recovery_record_path_invalid");
    }

    var sourceState = await ReadTargetStateAsync(source, cancellationToken).ConfigureAwait(false);
    var destinationState = await ReadTargetStateAsync(destination, cancellationToken)
      .ConfigureAwait(false);
    if (PayloadDigest.FixedTimeEqualsHex(sourceState.Sha256, record.PreStateSha256)
      && destinationState.EntryType == "absent")
    {
      return Result(record, record.PreStateSha256, idempotentReplay: true);
    }
    if (sourceState.EntryType != "absent"
      || destinationState.EntryType == "absent"
      || !PayloadDigest.FixedTimeEqualsHex(destinationState.Sha256, record.PreStateSha256)
      || !PayloadDigest.FixedTimeEqualsHex(destinationState.Sha256, expectedCurrentStateSha256))
    {
      throw new HostRecoveryException("recovery_precondition_mismatch");
    }

    using var sourceParent = _paths.OpenParentForCreate(source);
    using var destinationParent = _paths.OpenParentForCreate(destination);
    using var destinationHandle = _paths.OpenExisting(
      destination,
      lockAgainstMutation: true,
      readData: true,
      deleteAccess: true);
    EnsureIdentity(destinationState, destinationHandle);
    if (destinationHandle.VolumeSerialNumber != sourceParent.VolumeSerialNumber)
    {
      throw new HostRecoveryException("recovery_record_path_invalid");
    }

    SupervisorPathPolicy.EnsureHandleStillNames(destinationHandle, destination.FullPath);
    SupervisorPathPolicy.EnsureHandleStillNames(sourceParent, Path.GetDirectoryName(source.FullPath)!);
    RenameOrUnknown(
      destinationHandle,
      sourceParent,
      Path.GetFileName(source.FullPath));
    EnsurePostRenameOrUnknown(destinationHandle, source.FullPath);

    HostStateDigest restored;
    try
    {
      restored = await ReadKnownTargetStateAsync(
        source,
        destinationHandle,
        cancellationToken).ConfigureAwait(false);
    }
    catch (Exception exception) when (exception is HostPolicyException
      or HostPreconditionException
      or IOException
      or UnauthorizedAccessException)
    {
      RollBackRename(
        destinationHandle,
        destinationParent,
        Path.GetFileName(destination.FullPath));
      throw new HostRecoveryException("recovery_precondition_mismatch");
    }
    HostStateDigest cleared;
    try
    {
      cleared = await ReadTargetStateAsync(destination, cancellationToken).ConfigureAwait(false);
    }
    catch (Exception exception) when (exception is HostPolicyException
      or HostPreconditionException
      or IOException
      or UnauthorizedAccessException)
    {
      throw new HostRecoveryException("recovery_postcondition_mismatch");
    }
    if (!PayloadDigest.FixedTimeEqualsHex(restored.Sha256, record.PreStateSha256)
      || cleared.EntryType != "absent")
    {
      RollBackRename(
        destinationHandle,
        destinationParent,
        Path.GetFileName(destination.FullPath));
      throw new HostRecoveryException("recovery_postcondition_mismatch");
    }
    return Result(record, restored.Sha256, idempotentReplay: false);
  }

  private async ValueTask<HostStateDigest> ReadTargetStateAsync(
    ResolvedHostPath target,
    CancellationToken cancellationToken) => await HostFileSystemSupport.ComputeStateAsync(
      _paths,
      target,
      _maximumBytes,
      cancellationToken).ConfigureAwait(false);

  private async ValueTask<HostStateDigest> ReadRecoveryStateAsync(
    ResolvedHostPath governedTarget,
    string recoveryPath,
    CancellationToken cancellationToken,
    ValidatedPathHandle? knownRoot = null)
  {
    if (!File.Exists(recoveryPath) && !Directory.Exists(recoveryPath))
    {
      return new HostStateDigest(
        HostFileSystemSupport.AbsentStateSha256,
        "absent",
        0,
        0);
    }

    var root = knownRoot ?? _paths.OpenRecoveryEntry(
      governedTarget,
      recoveryPath,
      lockAgainstMutation: true,
      readData: true);
    try
    {
      if (!root.IsDirectory)
      {
        var digest = await HostFileSystemSupport.HashValidatedFileAsync(
          root,
          _maximumBytes,
          cancellationToken).ConfigureAwait(false);
        return new HostStateDigest(
          digest.Sha256,
          "file",
          digest.Length,
          digest.Length,
          root.VolumeSerialNumber,
          root.FileId);
      }

      var entries = new List<(string FullPath, string RelativePath, bool IsDirectory)>();
      var pending = new Stack<string>();
      pending.Push(recoveryPath);
      while (pending.Count > 0)
      {
        var directory = pending.Pop();
        using var directoryHandle = string.Equals(
          Path.TrimEndingDirectorySeparator(directory),
          Path.TrimEndingDirectorySeparator(recoveryPath),
          StringComparison.OrdinalIgnoreCase)
          ? null
          : _paths.OpenRecoveryEntry(
            governedTarget,
            directory,
            requireDirectory: true,
            lockAgainstMutation: true);
        foreach (var child in Directory.EnumerateFileSystemEntries(directory))
        {
          using var childHandle = _paths.OpenRecoveryEntry(
            governedTarget,
            child,
            lockAgainstMutation: true);
          var relative = Path.GetRelativePath(recoveryPath, child);
          entries.Add((child, relative, childHandle.IsDirectory));
          if (childHandle.IsDirectory)
          {
            pending.Push(child);
          }
        }
      }

      using var aggregate = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
      long bytesRead = 0;
      foreach (var entry in entries
        .OrderBy(value => value.RelativePath, StringComparer.OrdinalIgnoreCase)
        .ThenBy(value => value.RelativePath, StringComparer.Ordinal))
      {
        cancellationToken.ThrowIfCancellationRequested();
        using var entryHandle = _paths.OpenRecoveryEntry(
          governedTarget,
          entry.FullPath,
          requireDirectory: entry.IsDirectory,
          lockAgainstMutation: true,
          readData: true);
        AppendUtf8(aggregate, $"{(entry.IsDirectory ? "D" : "F")}\0{entry.RelativePath}\0");
        if (!entry.IsDirectory)
        {
          var digest = await HostFileSystemSupport.HashValidatedFileAsync(
            entryHandle,
            checked(_maximumBytes - bytesRead),
            cancellationToken).ConfigureAwait(false);
          bytesRead = checked(bytesRead + digest.Length);
          AppendUtf8(aggregate, $"{digest.Length}\0{digest.Sha256}\0");
        }
      }

      return new HostStateDigest(
        Convert.ToHexString(aggregate.GetHashAndReset()).ToLowerInvariant(),
        "directory",
        entries.Count,
        bytesRead,
        root.VolumeSerialNumber,
        root.FileId);
    }
    finally
    {
      if (knownRoot is null)
      {
        root.Dispose();
      }
    }
  }

  private async ValueTask<HostStateDigest> ReadKnownTargetStateAsync(
    ResolvedHostPath target,
    ValidatedPathHandle knownRoot,
    CancellationToken cancellationToken)
  {
    if (!knownRoot.IsDirectory)
    {
      var digest = await HostFileSystemSupport.HashValidatedFileAsync(
        knownRoot,
        _maximumBytes,
        cancellationToken).ConfigureAwait(false);
      return new HostStateDigest(
        digest.Sha256,
        "file",
        digest.Length,
        digest.Length,
        knownRoot.VolumeSerialNumber,
        knownRoot.FileId);
    }

    var entries = new List<(ResolvedHostPath Path, string RelativePath, bool IsDirectory)>();
    var pending = new Stack<ResolvedHostPath>();
    pending.Push(target);
    while (pending.Count > 0)
    {
      var directory = pending.Pop();
      using var directoryHandle = string.Equals(
        directory.FullPath,
        target.FullPath,
        StringComparison.OrdinalIgnoreCase)
        ? null
        : _paths.OpenExisting(
          directory,
          requireDirectory: true,
          lockAgainstMutation: true);
      foreach (var childPath in Directory.EnumerateFileSystemEntries(directory.FullPath))
      {
        var child = _paths.Resolve(
          target.RootId,
          Path.GetRelativePath(target.RootPath, childPath),
          target.Access);
        using var childHandle = _paths.OpenExisting(child, lockAgainstMutation: true);
        var relative = Path.GetRelativePath(target.FullPath, child.FullPath);
        entries.Add((child, relative, childHandle.IsDirectory));
        if (childHandle.IsDirectory)
        {
          pending.Push(child);
        }
      }
    }

    using var aggregate = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
    long bytesRead = 0;
    foreach (var entry in entries
      .OrderBy(value => value.RelativePath, StringComparer.OrdinalIgnoreCase)
      .ThenBy(value => value.RelativePath, StringComparer.Ordinal))
    {
      cancellationToken.ThrowIfCancellationRequested();
      using var entryHandle = _paths.OpenExisting(
        entry.Path,
        requireDirectory: entry.IsDirectory,
        lockAgainstMutation: true,
        readData: true);
      AppendUtf8(aggregate, $"{(entry.IsDirectory ? "D" : "F")}\0{entry.RelativePath}\0");
      if (!entry.IsDirectory)
      {
        var digest = await HostFileSystemSupport.HashValidatedFileAsync(
          entryHandle,
          checked(_maximumBytes - bytesRead),
          cancellationToken).ConfigureAwait(false);
        bytesRead = checked(bytesRead + digest.Length);
        AppendUtf8(aggregate, $"{digest.Length}\0{digest.Sha256}\0");
      }
    }
    return new HostStateDigest(
      Convert.ToHexString(aggregate.GetHashAndReset()).ToLowerInvariant(),
      "directory",
      entries.Count,
      bytesRead,
      knownRoot.VolumeSerialNumber,
      knownRoot.FileId);
  }

  private ResolvedHostPath ResolveTarget(JsonElement recoveryRecord, HostPathAccess access) =>
    _paths.Resolve(
      RequiredString(recoveryRecord, "rootId", 64),
      RequiredString(recoveryRecord, "relativePath", 32_767),
      access);

  private static void EnsureCreatedTargetMatches(
    HostStateDigest state,
    string expectedCurrentStateSha256,
    string? expectedEntryType,
    bool usesSyntheticEmptyDirectoryDigest)
  {
    if (expectedEntryType is not null && state.EntryType != expectedEntryType)
    {
      throw new HostRecoveryException("recovery_precondition_mismatch");
    }
    if (usesSyntheticEmptyDirectoryDigest)
    {
      if (state.EntryType != "directory"
        || state.Length != 0
        || !PayloadDigest.FixedTimeEqualsHex(
          expectedCurrentStateSha256,
          EmptyCreatedFolderStateSha256))
      {
        throw new HostRecoveryException("recovery_precondition_mismatch");
      }
      return;
    }
    if (!PayloadDigest.FixedTimeEqualsHex(state.Sha256, expectedCurrentStateSha256))
    {
      throw new HostRecoveryException("recovery_precondition_mismatch");
    }
  }

  private static void EnsureIdentity(HostStateDigest state, ValidatedPathHandle handle)
  {
    if (state.VolumeSerialNumber != handle.VolumeSerialNumber
      || state.FileId != handle.FileId)
    {
      throw new HostRecoveryException("recovery_precondition_mismatch");
    }
  }

  private static void RollBackRename(
    ValidatedPathHandle entry,
    ValidatedPathHandle originalParent,
    string originalName)
  {
    try
    {
      SupervisorPathPolicy.RenameExact(entry, originalParent, originalName);
    }
    catch (Exception exception) when (exception is HostPolicyException
      or IOException
      or UnauthorizedAccessException)
    {
      throw new HostRecoveryException("recovery_outcome_unknown");
    }
  }

  private static void RenameOrUnknown(
    ValidatedPathHandle entry,
    ValidatedPathHandle destinationParent,
    string destinationName)
  {
    try
    {
      SupervisorPathPolicy.RenameExact(entry, destinationParent, destinationName);
    }
    catch (Exception exception) when (exception is HostPolicyException
      or IOException
      or UnauthorizedAccessException)
    {
      throw new HostRecoveryException("recovery_outcome_unknown");
    }
  }

  private static void EnsurePostRenameOrUnknown(
    ValidatedPathHandle entry,
    string expectedPath)
  {
    try
    {
      SupervisorPathPolicy.EnsureHandleStillNames(entry, expectedPath);
    }
    catch (HostPolicyException)
    {
      throw new HostRecoveryException("recovery_outcome_unknown");
    }
  }

  private static TrustedFileSystemRecoveryResult Result(
    TrustedHostRecoveryRecord record,
    string restoredStateSha256,
    bool idempotentReplay) => new(
      record.ActionId,
      record.Operation,
      restoredStateSha256,
      idempotentReplay);

  private static void EnsureExactProperties(JsonElement value, params string[] properties)
  {
    if (value.ValueKind != JsonValueKind.Object)
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }
    var expected = new HashSet<string>(properties, StringComparer.Ordinal);
    var seen = new HashSet<string>(StringComparer.Ordinal);
    foreach (var property in value.EnumerateObject())
    {
      if (!expected.Contains(property.Name) || !seen.Add(property.Name))
      {
        throw new HostRecoveryException("recovery_record_format_invalid");
      }
    }
    if (!seen.SetEquals(expected))
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }
  }

  private static string RequiredString(
    JsonElement value,
    string property,
    int maximumLength)
  {
    if (!value.TryGetProperty(property, out var candidate)
      || candidate.ValueKind != JsonValueKind.String
      || string.IsNullOrWhiteSpace(candidate.GetString())
      || candidate.GetString()!.Length > maximumLength)
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }
    return candidate.GetString()!;
  }

  private static void AppendUtf8(IncrementalHash hash, string value)
  {
    var bytes = Encoding.UTF8.GetBytes(value);
    hash.AppendData(bytes);
  }
}
