using System.Security.Cryptography;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

public interface IHostMutationCommitObserver
{
  ValueTask BeforeFileReplaceAsync(
    string targetPath,
    CancellationToken cancellationToken);
}

public sealed class NoOpHostMutationCommitObserver : IHostMutationCommitObserver
{
  public ValueTask BeforeFileReplaceAsync(
    string targetPath,
    CancellationToken cancellationToken) => ValueTask.CompletedTask;
}

public sealed class FileSystemFileWriteCapabilityAdapter : IHostCapabilityAdapter
{
  private static readonly HashSet<string> RequiredArguments = new(
    ["rootId", "relativePath", "contentBase64", "mode"],
    StringComparer.Ordinal);
  private static readonly JsonElement ArgumentsSchema = FileSystemCapabilitySchemas.Parse(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "rootId": { "type": "string", "minLength": 1, "maxLength": 64 },
        "relativePath": { "type": "string", "minLength": 1, "maxLength": 32767 },
        "contentBase64": { "type": "string" },
        "mode": { "enum": ["create", "replace"] }
      },
      "required": ["rootId", "relativePath", "contentBase64", "mode"],
      "additionalProperties": false
    }
    """);
  private static readonly JsonElement ResultSchema = MutationResultSchema();
  private readonly SupervisorPathPolicy _paths;
  private readonly IHostRecoveryVault _recovery;
  private readonly IHostMutationCommitObserver _commitObserver;
  private readonly long _maximumSingleFileBytes;

  public FileSystemFileWriteCapabilityAdapter(
    SupervisorPathPolicy paths,
    IHostRecoveryVault recovery,
    IOptions<HostCapabilityOptions> options,
    IHostMutationCommitObserver? commitObserver = null)
  {
    _paths = paths;
    _recovery = recovery;
    _commitObserver = commitObserver ?? new NoOpHostMutationCommitObserver();
    _maximumSingleFileBytes = Math.Clamp(
      options.Value.MaximumSingleFileBytes,
      1,
      67_108_864);
  }

  public CapabilityDescriptor Descriptor { get; } = FileSystemCapabilitySchemas.Descriptor(
    "filesystem.file.write",
    "Create or replace a file",
    "Atomically creates or replaces one file beneath a supervisor-owned root.",
    CapabilityEffect.LocalWrite,
    RecoveryKind.Snapshot,
    RequiredPrivilege.LocalSystem,
    ArgumentsSchema,
    ResultSchema,
    "windows-file-mutation");

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments)
  {
    try
    {
      if (!HostFileSystemSupport.HasExactProperties(arguments, RequiredArguments))
      {
        return FileSystemCapabilitySchemas.Invalid();
      }

      var mode = HostFileSystemSupport.RequiredString(arguments, "mode", 16);
      if (mode is not ("create" or "replace"))
      {
        return FileSystemCapabilitySchemas.Invalid();
      }

      var encoded = HostFileSystemSupport.RequiredString(
        arguments,
        "contentBase64",
        checked((int)Math.Min(int.MaxValue, _maximumSingleFileBytes * 2)));
      var content = Convert.FromBase64String(encoded);
      try
      {
        if (content.LongLength > _maximumSingleFileBytes)
        {
          return FileSystemCapabilitySchemas.Invalid();
        }
      }
      finally
      {
        CryptographicOperations.ZeroMemory(content);
      }

      var target = _paths.Resolve(
        HostFileSystemSupport.RequiredString(arguments, "rootId", 64),
        HostFileSystemSupport.RequiredString(arguments, "relativePath", 32_767),
        HostPathAccess.Write);
      using var parent = _paths.OpenParentForCreate(target);
      var exists = File.Exists(target.FullPath) || Directory.Exists(target.FullPath);
      if ((mode == "create" && exists) || (mode == "replace" && !File.Exists(target.FullPath)))
      {
        return CapabilityArgumentValidation.Invalid(
          "write_mode_precondition_failed",
          "The target did not match the requested write mode.");
      }

      if (mode == "replace")
      {
        using var existing = _paths.OpenExisting(target, requireDirectory: false);
      }

      return CapabilityArgumentValidation.Success;
    }
    catch (FormatException)
    {
      return FileSystemCapabilitySchemas.Invalid();
    }
    catch (HostPolicyException exception)
    {
      return CapabilityArgumentValidation.Invalid(exception.ErrorCode, exception.Message);
    }
  }

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var target = _paths.Resolve(
      arguments.GetProperty("rootId").GetString()!,
      arguments.GetProperty("relativePath").GetString()!,
      HostPathAccess.Write);
    using var parent = _paths.OpenParentForCreate(target);
    var mode = arguments.GetProperty("mode").GetString()!;
    var preState = await HostFileSystemSupport.ComputeStateAsync(
      _paths,
      target,
      context.Budgets.MaxLocalBytes,
      cancellationToken).ConfigureAwait(false);
    HostFileSystemSupport.EnsureExpectedPreState(context, preState);
    if ((mode == "create" && preState.EntryType != "absent")
      || (mode == "replace" && preState.EntryType != "file"))
    {
      throw new HostPolicyException("write_mode_precondition_failed");
    }

    using var originalTarget = mode == "replace"
      ? _paths.OpenExisting(
        target,
        requireDirectory: false,
        lockAgainstMutation: true,
        deleteAccess: true)
      : null;
    if (originalTarget is not null
      && (originalTarget.VolumeSerialNumber != preState.VolumeSerialNumber
        || originalTarget.FileId != preState.FileId))
    {
      throw new HostPreconditionException("target_changed_before_replace");
    }

    var content = Convert.FromBase64String(arguments.GetProperty("contentBase64").GetString()!);
    var availableBytes = context.Budgets.MaxLocalBytes - preState.BytesRead;
    if (content.LongLength > _maximumSingleFileBytes
      || content.LongLength > availableBytes / 2)
    {
      CryptographicOperations.ZeroMemory(content);
      throw new HostPolicyException("local_byte_budget_exceeded");
    }

    var recoveryDirectory = mode == "replace"
      ? _paths.CreateRecoveryDirectory(target, context.ActionId)
      : null;
    var backupPath = recoveryDirectory is null
      ? null
      : Path.Combine(recoveryDirectory, "prior-file.bin");
    using var recoveryParent = recoveryDirectory is null
      ? null
      : _paths.OpenRecoveryEntry(
        target,
        recoveryDirectory,
        requireDirectory: true);
    var recovery = await _recovery.PrepareAsync(
      context,
      "filesystem.file.write",
      preState.Sha256,
      new
      {
        target.RootId,
        target.RelativePath,
        mode,
        backupPath,
        recovery = mode == "create" ? "delete-created-target" : "restore-snapshot",
      },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    var temporary = HostFileSystemSupport.TemporarySiblingPath(target, context.ActionId);
    var committed = false;
    try
    {
      SupervisorPathPolicy.EnsureHandleStillNames(parent, Path.GetDirectoryName(target.FullPath)!);
      await using (var stream = new FileStream(
        temporary,
        FileMode.CreateNew,
        FileAccess.Write,
        FileShare.None,
        81920,
        FileOptions.Asynchronous | FileOptions.WriteThrough))
      {
        await stream.WriteAsync(content, cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
        stream.Flush(flushToDisk: true);
      }

      var temporaryTarget = _paths.Resolve(
        target.RootId,
        Path.GetRelativePath(target.RootPath, temporary),
        HostPathAccess.Write);
      using var staged = _paths.OpenExisting(
        temporaryTarget,
        requireDirectory: false,
        lockAgainstMutation: true,
        readData: true,
        deleteAccess: true);
      var stagedVolume = staged.VolumeSerialNumber;
      var stagedFileId = staged.FileId;

      if (mode == "create")
      {
        SupervisorPathPolicy.EnsureHandleStillNames(parent, Path.GetDirectoryName(target.FullPath)!);
        SupervisorPathPolicy.RenameExact(
          staged,
          parent,
          Path.GetFileName(target.FullPath));
      }
      else
      {
        SupervisorPathPolicy.EnsureHandleStillNames(parent, Path.GetDirectoryName(target.FullPath)!);
        SupervisorPathPolicy.EnsureHandleStillNames(originalTarget!, target.FullPath);
        SupervisorPathPolicy.EnsureHandleStillNames(recoveryParent!, recoveryDirectory!);
        await _commitObserver.BeforeFileReplaceAsync(target.FullPath, cancellationToken)
          .ConfigureAwait(false);
        SupervisorPathPolicy.EnsureHandleStillNames(originalTarget!, target.FullPath);
        SupervisorPathPolicy.RenameExact(
          originalTarget!,
          recoveryParent!,
          Path.GetFileName(backupPath!));
        try
        {
          SupervisorPathPolicy.RenameExact(
            staged,
            parent,
            Path.GetFileName(target.FullPath));
        }
        catch (Exception commitException) when (commitException is HostPolicyException
          or IOException
          or UnauthorizedAccessException)
        {
          try
          {
            SupervisorPathPolicy.RenameExact(
              originalTarget!,
              parent,
              Path.GetFileName(target.FullPath));
          }
          catch (Exception rollbackException) when (rollbackException is HostPolicyException
            or IOException
            or UnauthorizedAccessException)
          {
            throw new IOException(
              "Exact-handle replacement failed and the original could not be restored.",
              new AggregateException(commitException, rollbackException));
          }

          throw new HostPreconditionException(
            "target_changed_during_replace",
            commitException);
        }
      }

      SupervisorPathPolicy.EnsureHandleStillNames(staged, target.FullPath);
      var finalDigest = await HostFileSystemSupport.HashValidatedFileAsync(
        staged,
        content.LongLength,
        cancellationToken).ConfigureAwait(false);
      var contentSha256 = Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
      var finalMatches = staged.VolumeSerialNumber == stagedVolume
        && staged.FileId == stagedFileId
        && finalDigest.Length == content.LongLength
        && PayloadDigest.FixedTimeEqualsHex(finalDigest.Sha256, contentSha256);
      if (!finalMatches)
      {
        try
        {
          SupervisorPathPolicy.DeleteExact(staged);
          staged.Dispose();
          if (mode == "replace")
          {
            SupervisorPathPolicy.RenameExact(
              originalTarget!,
              parent,
              Path.GetFileName(target.FullPath));
          }
        }
        catch (Exception exception) when (exception is HostPolicyException
          or IOException
          or UnauthorizedAccessException)
        {
          throw new IOException(
            "Post-commit identity changed and exact-handle recovery failed.",
            exception);
        }

        throw new HostPreconditionException("target_changed_after_replace");

      }

      committed = true;
      var output = MutationOutput(target, "file", content.LongLength, contentSha256);
      return new CapabilityExecutionResult(
        output,
        MutationCommitted: true,
        OutcomeUncertain: false,
        [HostFileSystemSupport.CreateProvenance(
          "windows-file-mutation",
          target,
          contentSha256)],
        recovery.OpaqueHandle,
        preState.Sha256,
        recovery.RecordSha256,
        LocalBytesRead: checked(preState.BytesRead + finalDigest.Length),
        LocalBytesWritten: content.LongLength);
    }
    catch when (!committed)
    {
      if (File.Exists(temporary))
      {
        File.Delete(temporary);
      }

      throw;
    }
    finally
    {
      CryptographicOperations.ZeroMemory(content);
    }
  }

  internal static JsonElement MutationResultSchema() => FileSystemCapabilitySchemas.Parse(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "rootId": { "type": "string" },
        "relativePath": { "type": "string" },
        "entryType": { "enum": ["file", "directory", "archive"] },
        "length": { "type": "integer", "minimum": 0 },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["rootId", "relativePath", "entryType", "length", "stateSha256"],
      "additionalProperties": false
    }
    """);

  internal static CapabilityArgumentValidation ValidateMutationResult(JsonElement result) =>
    FileSystemCapabilitySchemas.ValidateSimpleResult(
        result,
        "rootId",
        "relativePath",
        "entryType",
        "length",
        "stateSha256").IsValid
      && FileSystemCapabilitySchemas.IsString(result, "rootId")
      && FileSystemCapabilitySchemas.IsString(result, "relativePath")
      && FileSystemCapabilitySchemas.IsString(result, "entryType")
      && result.GetProperty("entryType").GetString() is "file" or "directory" or "archive"
      && FileSystemCapabilitySchemas.IsNonNegativeInteger(result, "length")
      && FileSystemCapabilitySchemas.IsSha256(result, "stateSha256")
        ? CapabilityArgumentValidation.Success
        : CapabilityArgumentValidation.Invalid("result_schema_invalid", "Invalid mutation result.");

  internal static string MutationOutput(
    ResolvedHostPath target,
    string entryType,
    long length,
    string stateSha256) => JsonSerializer.Serialize(new
    {
      rootId = target.RootId,
      relativePath = target.RelativePath,
      entryType,
      length,
      stateSha256,
    });
}

public sealed class FileSystemFolderCreateCapabilityAdapter : IHostCapabilityAdapter
{
  private static readonly JsonElement ResultSchema =
    FileSystemFileWriteCapabilityAdapter.MutationResultSchema();
  private readonly SupervisorPathPolicy _paths;
  private readonly IHostRecoveryVault _recovery;

  public FileSystemFolderCreateCapabilityAdapter(
    SupervisorPathPolicy paths,
    IHostRecoveryVault recovery)
  {
    _paths = paths;
    _recovery = recovery;
  }

  public CapabilityDescriptor Descriptor { get; } = FileSystemCapabilitySchemas.Descriptor(
    "filesystem.folder.create",
    "Create a folder",
    "Creates exactly one folder beneath an existing validated parent.",
    CapabilityEffect.LocalWrite,
    RecoveryKind.CompensatingAction,
    RequiredPrivilege.LocalSystem,
    FileSystemCapabilitySchemas.PathArguments,
    ResultSchema,
    "windows-directory-mutation");

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments)
  {
    try
    {
      if (!HostFileSystemSupport.HasExactProperties(
        arguments,
        new HashSet<string>(["rootId", "relativePath"], StringComparer.Ordinal)))
      {
        return FileSystemCapabilitySchemas.Invalid();
      }

      var target = _paths.Resolve(
        HostFileSystemSupport.RequiredString(arguments, "rootId", 64),
        HostFileSystemSupport.RequiredString(arguments, "relativePath", 32_767),
        HostPathAccess.Write);
      using var parent = _paths.OpenParentForCreate(target);
      return File.Exists(target.FullPath) || Directory.Exists(target.FullPath)
        ? CapabilityArgumentValidation.Invalid("target_already_exists", "Target already exists.")
        : CapabilityArgumentValidation.Success;
    }
    catch (HostPolicyException exception)
    {
      return CapabilityArgumentValidation.Invalid(exception.ErrorCode, exception.Message);
    }
  }

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    FileSystemFileWriteCapabilityAdapter.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var target = _paths.Resolve(
      arguments.GetProperty("rootId").GetString()!,
      arguments.GetProperty("relativePath").GetString()!,
      HostPathAccess.Write);
    using var parent = _paths.OpenParentForCreate(target);
    var preState = await HostFileSystemSupport.ComputeStateAsync(
      _paths,
      target,
      context.Budgets.MaxLocalBytes,
      cancellationToken).ConfigureAwait(false);
    HostFileSystemSupport.EnsureExpectedPreState(context, preState);
    if (preState.EntryType != "absent")
    {
      throw new HostPolicyException("target_already_exists");
    }

    var recovery = await _recovery.PrepareAsync(
      context,
      "filesystem.folder.create",
      preState.Sha256,
      new
      {
        target.RootId,
        target.RelativePath,
        recovery = "remove-empty-created-folder",
      },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    SupervisorPathPolicy.EnsureHandleStillNames(parent, Path.GetDirectoryName(target.FullPath)!);
    SupervisorPathPolicy.CreateDirectoryNoOverwrite(
      parent,
      Path.GetFileName(target.FullPath));
    using var final = _paths.OpenExisting(target, requireDirectory: true, lockAgainstMutation: true);
    var state = PayloadDigest.Sha256Hex("msaidizi-host-state:empty-directory:v1");
    return new CapabilityExecutionResult(
      FileSystemFileWriteCapabilityAdapter.MutationOutput(
        target,
        "directory",
        0,
        state),
      MutationCommitted: true,
      OutcomeUncertain: false,
      [HostFileSystemSupport.CreateProvenance(
        "windows-directory-mutation",
        target,
        state)],
      recovery.OpaqueHandle,
      preState.Sha256,
      recovery.RecordSha256);
  }
}

public sealed class FileSystemEntryCopyCapabilityAdapter : IHostCapabilityAdapter
{
  private static readonly HashSet<string> RequiredArguments = new(
    ["sourceRootId", "sourceRelativePath", "destinationRootId", "destinationRelativePath"],
    StringComparer.Ordinal);
  private static readonly JsonElement ArgumentsSchema = TwoPathArgumentsSchema();
  private static readonly JsonElement ResultSchema =
    FileSystemFileWriteCapabilityAdapter.MutationResultSchema();
  private readonly SupervisorPathPolicy _paths;
  private readonly IHostRecoveryVault _recovery;

  public FileSystemEntryCopyCapabilityAdapter(
    SupervisorPathPolicy paths,
    IHostRecoveryVault recovery)
  {
    _paths = paths;
    _recovery = recovery;
  }

  public CapabilityDescriptor Descriptor { get; } = FileSystemCapabilitySchemas.Descriptor(
    "filesystem.entry.copy",
    "Copy a file or folder",
    "Copies a validated tree to an absent destination and never follows links.",
    CapabilityEffect.LocalWrite,
    RecoveryKind.CompensatingAction,
    RequiredPrivilege.LocalSystem,
    ArgumentsSchema,
    ResultSchema,
    "windows-filesystem-copy");

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    ValidateTwoPaths(arguments, _paths, sourceAccess: HostPathAccess.Read);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    FileSystemFileWriteCapabilityAdapter.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var (source, destination) = ResolveTwoPaths(arguments, _paths, HostPathAccess.Read);
    using var parent = _paths.OpenParentForCreate(destination);
    var destinationState = await HostFileSystemSupport.ComputeStateAsync(
      _paths,
      destination,
      context.Budgets.MaxLocalBytes,
      cancellationToken).ConfigureAwait(false);
    HostFileSystemSupport.EnsureExpectedPreState(context, destinationState);
    if (destinationState.EntryType != "absent")
    {
      throw new HostPolicyException("destination_already_exists");
    }

    var sourceState = await HostFileSystemSupport.ComputeStateAsync(
      _paths,
      source,
      checked(context.Budgets.MaxLocalBytes - destinationState.BytesRead),
      cancellationToken).ConfigureAwait(false);
    var recovery = await _recovery.PrepareAsync(
      context,
      "filesystem.entry.copy",
      destinationState.Sha256,
      new
      {
        destination.RootId,
        destination.RelativePath,
        sourceStateSha256 = sourceState.Sha256,
        recovery = "delete-created-copy",
      },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    var temporary = HostFileSystemSupport.TemporarySiblingPath(destination, context.ActionId);
    var committed = false;
    try
    {
      SupervisorPathPolicy.EnsureHandleStillNames(parent, Path.GetDirectoryName(destination.FullPath)!);
      if (sourceState.EntryType == "directory")
      {
        SupervisorPathPolicy.CreateDirectoryNoOverwrite(
          parent,
          Path.GetFileName(temporary));
      }
      var copied = await HostFileSystemSupport.CopyEntryAsync(
        _paths,
        source,
        temporary,
        destinationDirectoryPrepared: sourceState.EntryType == "directory",
        checked(context.Budgets.MaxLocalBytes - sourceState.BytesRead),
        cancellationToken).ConfigureAwait(false);
      var temporaryTarget = _paths.Resolve(
        destination.RootId,
        Path.GetRelativePath(destination.RootPath, temporary),
        HostPathAccess.Write);
      var temporaryState = await HostFileSystemSupport.ComputeStateAsync(
        _paths,
        temporaryTarget,
        checked(context.Budgets.MaxLocalBytes - sourceState.BytesRead - copied),
        cancellationToken).ConfigureAwait(false);
      if (temporaryState.EntryType != sourceState.EntryType
        || !PayloadDigest.FixedTimeEqualsHex(temporaryState.Sha256, sourceState.Sha256))
      {
        throw new HostPreconditionException("source_changed_during_copy");
      }

      using var staged = _paths.OpenExisting(
        temporaryTarget,
        lockAgainstMutation: true,
        deleteAccess: true);
      SupervisorPathPolicy.EnsureHandleStillNames(parent, Path.GetDirectoryName(destination.FullPath)!);
      SupervisorPathPolicy.RenameExact(
        staged,
        parent,
        Path.GetFileName(destination.FullPath));
      SupervisorPathPolicy.EnsureHandleStillNames(staged, destination.FullPath);
      committed = true;
      using var final = _paths.OpenExisting(destination, lockAgainstMutation: true);
      if (final.VolumeSerialNumber != staged.VolumeSerialNumber
        || final.FileId != staged.FileId)
      {
        throw new IOException("Exact copy destination identity changed after commit.");
      }
      return new CapabilityExecutionResult(
        FileSystemFileWriteCapabilityAdapter.MutationOutput(
          destination,
          sourceState.EntryType,
          sourceState.Length,
          sourceState.Sha256),
        MutationCommitted: true,
        OutcomeUncertain: false,
        [HostFileSystemSupport.CreateProvenance(
          "windows-filesystem-copy",
          source,
          sourceState.Sha256)],
        recovery.OpaqueHandle,
        destinationState.Sha256,
        recovery.RecordSha256,
        LocalBytesRead: checked(sourceState.BytesRead + copied + temporaryState.BytesRead),
        LocalBytesWritten: copied);
    }
    catch when (!committed)
    {
      DeleteOwnedTemporary(temporary);
      throw;
    }
  }

  internal static JsonElement TwoPathArgumentsSchema() => FileSystemCapabilitySchemas.Parse(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "sourceRootId": { "type": "string", "minLength": 1, "maxLength": 64 },
        "sourceRelativePath": { "type": "string", "minLength": 1, "maxLength": 32767 },
        "destinationRootId": { "type": "string", "minLength": 1, "maxLength": 64 },
        "destinationRelativePath": { "type": "string", "minLength": 1, "maxLength": 32767 }
      },
      "required": ["sourceRootId", "sourceRelativePath", "destinationRootId", "destinationRelativePath"],
      "additionalProperties": false
    }
    """);

  internal static CapabilityArgumentValidation ValidateTwoPaths(
    JsonElement arguments,
    SupervisorPathPolicy paths,
    HostPathAccess sourceAccess)
  {
    try
    {
      if (!HostFileSystemSupport.HasExactProperties(arguments, RequiredArguments))
      {
        return FileSystemCapabilitySchemas.Invalid();
      }

      var (source, destination) = ResolveTwoPaths(arguments, paths, sourceAccess);
      using var sourceHandle = paths.OpenExisting(source);
      using var parent = paths.OpenParentForCreate(destination);
      return File.Exists(destination.FullPath) || Directory.Exists(destination.FullPath)
        ? CapabilityArgumentValidation.Invalid(
          "destination_already_exists",
          "Destination already exists.")
        : CapabilityArgumentValidation.Success;
    }
    catch (HostPolicyException exception)
    {
      return CapabilityArgumentValidation.Invalid(exception.ErrorCode, exception.Message);
    }
  }

  internal static (ResolvedHostPath Source, ResolvedHostPath Destination) ResolveTwoPaths(
    JsonElement arguments,
    SupervisorPathPolicy paths,
    HostPathAccess sourceAccess)
  {
    var source = paths.Resolve(
      HostFileSystemSupport.RequiredString(arguments, "sourceRootId", 64),
      HostFileSystemSupport.RequiredString(arguments, "sourceRelativePath", 32_767),
      sourceAccess);
    var destination = paths.Resolve(
      HostFileSystemSupport.RequiredString(arguments, "destinationRootId", 64),
      HostFileSystemSupport.RequiredString(arguments, "destinationRelativePath", 32_767),
      HostPathAccess.Write);
    if (SupervisorPathPolicy.IsEqualOrDescendant(destination.FullPath, source.FullPath))
    {
      throw new HostPolicyException("destination_inside_source_forbidden");
    }

    return (source, destination);
  }

  internal static void DeleteOwnedTemporary(string path)
  {
    if (File.Exists(path))
    {
      File.Delete(path);
    }
    else if (Directory.Exists(path))
    {
      Directory.Delete(path, recursive: true);
    }
  }
}

public sealed class FileSystemEntryMoveCapabilityAdapter : IHostCapabilityAdapter
{
  private static readonly JsonElement ArgumentsSchema =
    FileSystemEntryCopyCapabilityAdapter.TwoPathArgumentsSchema();
  private static readonly JsonElement ResultSchema =
    FileSystemFileWriteCapabilityAdapter.MutationResultSchema();
  private readonly SupervisorPathPolicy _paths;
  private readonly IHostRecoveryVault _recovery;

  public FileSystemEntryMoveCapabilityAdapter(
    SupervisorPathPolicy paths,
    IHostRecoveryVault recovery)
  {
    _paths = paths;
    _recovery = recovery;
  }

  public CapabilityDescriptor Descriptor { get; } = FileSystemCapabilitySchemas.Descriptor(
    "filesystem.entry.move",
    "Move a file or folder",
    "Atomically moves one entry on the same volume between governed roots.",
    CapabilityEffect.LocalWrite,
    RecoveryKind.CompensatingAction,
    RequiredPrivilege.LocalSystem,
    ArgumentsSchema,
    ResultSchema,
    "windows-filesystem-move");

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    FileSystemEntryCopyCapabilityAdapter.ValidateTwoPaths(
      arguments,
      _paths,
      HostPathAccess.Delete);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    FileSystemFileWriteCapabilityAdapter.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var (source, destination) = FileSystemEntryCopyCapabilityAdapter.ResolveTwoPaths(
      arguments,
      _paths,
      HostPathAccess.Delete);
    using var destinationParent = _paths.OpenParentForCreate(destination);
    var preState = await HostFileSystemSupport.ComputeStateAsync(
      _paths,
      source,
      context.Budgets.MaxLocalBytes,
      cancellationToken).ConfigureAwait(false);
    HostFileSystemSupport.EnsureExpectedPreState(context, preState);
    using var sourceHandle = _paths.OpenExisting(
      source,
      lockAgainstMutation: true,
      deleteAccess: true);
    if (sourceHandle.VolumeSerialNumber != preState.VolumeSerialNumber
      || sourceHandle.FileId != preState.FileId)
    {
      throw new HostPreconditionException("source_changed_before_move");
    }

    if (sourceHandle.VolumeSerialNumber != destinationParent.VolumeSerialNumber)
    {
      throw new HostPolicyException("cross_volume_move_forbidden");
    }
    if (File.Exists(destination.FullPath) || Directory.Exists(destination.FullPath))
    {
      throw new HostPolicyException("destination_already_exists");
    }

    var recovery = await _recovery.PrepareAsync(
      context,
      "filesystem.entry.move",
      preState.Sha256,
      new
      {
        source.RootId,
        source.RelativePath,
        destinationRootId = destination.RootId,
        destinationRelativePath = destination.RelativePath,
        recovery = "move-destination-back-to-source",
      },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    SupervisorPathPolicy.EnsureHandleStillNames(sourceHandle, source.FullPath);
    SupervisorPathPolicy.EnsureHandleStillNames(
      destinationParent,
      Path.GetDirectoryName(destination.FullPath)!);
    SupervisorPathPolicy.RenameExact(
      sourceHandle,
      destinationParent,
      Path.GetFileName(destination.FullPath));

    // The source handle excludes FILE_SHARE_DELETE, so the renamed child cannot
    // be swapped while this exact-identity postcondition is checked.
    using var final = _paths.OpenExisting(destination, lockAgainstMutation: true);
    if (final.VolumeSerialNumber != preState.VolumeSerialNumber
      || final.FileId != preState.FileId)
    {
      throw new IOException("Handle-based move produced an unexpected NTFS identity.");
    }
    return new CapabilityExecutionResult(
      FileSystemFileWriteCapabilityAdapter.MutationOutput(
        destination,
        preState.EntryType,
        preState.Length,
        preState.Sha256),
      MutationCommitted: true,
      OutcomeUncertain: false,
      [HostFileSystemSupport.CreateProvenance(
        "windows-filesystem-move",
        destination,
        preState.Sha256)],
      recovery.OpaqueHandle,
      preState.Sha256,
      recovery.RecordSha256,
      LocalBytesRead: preState.BytesRead);
  }
}

public sealed class FileSystemArchiveCreateCapabilityAdapter : IHostCapabilityAdapter
{
  private static readonly JsonElement ArgumentsSchema =
    FileSystemEntryCopyCapabilityAdapter.TwoPathArgumentsSchema();
  private static readonly JsonElement ResultSchema =
    FileSystemFileWriteCapabilityAdapter.MutationResultSchema();
  private readonly SupervisorPathPolicy _paths;
  private readonly IHostRecoveryVault _recovery;

  public FileSystemArchiveCreateCapabilityAdapter(
    SupervisorPathPolicy paths,
    IHostRecoveryVault recovery)
  {
    _paths = paths;
    _recovery = recovery;
  }

  public CapabilityDescriptor Descriptor { get; } = FileSystemCapabilitySchemas.Descriptor(
    "filesystem.archive.create",
    "Create a ZIP archive",
    "Creates a bounded ZIP archive from a governed file or folder tree.",
    CapabilityEffect.LocalWrite,
    RecoveryKind.CompensatingAction,
    RequiredPrivilege.LocalSystem,
    ArgumentsSchema,
    ResultSchema,
    "windows-filesystem-archive");

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments)
  {
    var validation = FileSystemEntryCopyCapabilityAdapter.ValidateTwoPaths(
      arguments,
      _paths,
      HostPathAccess.Read);
    if (!validation.IsValid)
    {
      return validation;
    }

    return arguments.GetProperty("destinationRelativePath").GetString()!
      .EndsWith(".zip", StringComparison.OrdinalIgnoreCase)
      ? CapabilityArgumentValidation.Success
      : CapabilityArgumentValidation.Invalid(
        "archive_extension_required",
        "Archive destination must end in .zip.");
  }

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    FileSystemFileWriteCapabilityAdapter.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var (source, destination) = FileSystemEntryCopyCapabilityAdapter.ResolveTwoPaths(
      arguments,
      _paths,
      HostPathAccess.Read);
    using var parent = _paths.OpenParentForCreate(destination);
    var destinationState = await HostFileSystemSupport.ComputeStateAsync(
      _paths,
      destination,
      context.Budgets.MaxLocalBytes,
      cancellationToken).ConfigureAwait(false);
    HostFileSystemSupport.EnsureExpectedPreState(context, destinationState);
    if (destinationState.EntryType != "absent")
    {
      throw new HostPolicyException("destination_already_exists");
    }

    var sourceState = await HostFileSystemSupport.ComputeStateAsync(
      _paths,
      source,
      checked(context.Budgets.MaxLocalBytes - destinationState.BytesRead),
      cancellationToken).ConfigureAwait(false);
    var recovery = await _recovery.PrepareAsync(
      context,
      "filesystem.archive.create",
      destinationState.Sha256,
      new
      {
        destination.RootId,
        destination.RelativePath,
        sourceStateSha256 = sourceState.Sha256,
        recovery = "delete-created-archive",
      },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    var temporary = HostFileSystemSupport.TemporarySiblingPath(destination, context.ActionId);
    var committed = false;
    try
    {
      SupervisorPathPolicy.EnsureHandleStillNames(parent, Path.GetDirectoryName(destination.FullPath)!);
      var bytesRead = await HostFileSystemSupport.CreateArchiveAsync(
        _paths,
        source,
        temporary,
        checked(context.Budgets.MaxLocalBytes - sourceState.BytesRead),
        cancellationToken).ConfigureAwait(false);
      var temporaryTarget = _paths.Resolve(
        destination.RootId,
        Path.GetRelativePath(destination.RootPath, temporary),
        HostPathAccess.Write);
      using var staged = _paths.OpenExisting(
        temporaryTarget,
        requireDirectory: false,
        lockAgainstMutation: true,
        readData: true,
        deleteAccess: true);
      var archiveLength = RandomAccess.GetLength(staged.Handle);
      if (archiveLength > context.Budgets.MaxLocalBytes)
      {
        throw new HostPolicyException("local_byte_budget_exceeded");
      }

      SupervisorPathPolicy.EnsureHandleStillNames(parent, Path.GetDirectoryName(destination.FullPath)!);
      SupervisorPathPolicy.RenameExact(
        staged,
        parent,
        Path.GetFileName(destination.FullPath));
      SupervisorPathPolicy.EnsureHandleStillNames(staged, destination.FullPath);
      committed = true;
      var finalState = await HostFileSystemSupport.HashValidatedFileAsync(
        staged,
        checked(context.Budgets.MaxLocalBytes - sourceState.BytesRead - bytesRead),
        cancellationToken).ConfigureAwait(false);
      return new CapabilityExecutionResult(
        FileSystemFileWriteCapabilityAdapter.MutationOutput(
          destination,
          "archive",
          archiveLength,
          finalState.Sha256),
        MutationCommitted: true,
        OutcomeUncertain: false,
        [HostFileSystemSupport.CreateProvenance(
          "windows-filesystem-archive",
          destination,
          finalState.Sha256)],
        recovery.OpaqueHandle,
        destinationState.Sha256,
        recovery.RecordSha256,
        LocalBytesRead: checked(sourceState.BytesRead + bytesRead + finalState.Length),
        LocalBytesWritten: archiveLength);
    }
    catch when (!committed)
    {
      FileSystemEntryCopyCapabilityAdapter.DeleteOwnedTemporary(temporary);
      throw;
    }
  }
}
