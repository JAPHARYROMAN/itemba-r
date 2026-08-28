using System.Security.Cryptography;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

public interface IArchiveExtractCommitObserver
{
  ValueTask BeforeCommitAsync(
    string sourcePath,
    string destinationPath,
    string stagingPath,
    CancellationToken cancellationToken);

  ValueTask AfterCommitBeforeVerificationAsync(
    string sourcePath,
    string destinationPath,
    CancellationToken cancellationToken) => ValueTask.CompletedTask;
}

public sealed class NoOpArchiveExtractCommitObserver : IArchiveExtractCommitObserver
{
  public ValueTask BeforeCommitAsync(
    string sourcePath,
    string destinationPath,
    string stagingPath,
    CancellationToken cancellationToken) => ValueTask.CompletedTask;

  public ValueTask AfterCommitBeforeVerificationAsync(
    string sourcePath,
    string destinationPath,
    CancellationToken cancellationToken) => ValueTask.CompletedTask;
}

/// <summary>
/// Extracts a deliberately narrow ZIP profile into an absent governed
/// directory. The source is read once through a non-following, write/rename
/// locked NTFS handle. All entries are staged as an exact sibling tree and the
/// only commit effect is one no-overwrite handle rename.
/// </summary>
public sealed class FileSystemArchiveExtractCapabilityAdapter : IHostCapabilityAdapter
{
  public const string CapabilityId = "filesystem.archive.extract";
  public const string CapabilityVersion = "1.0.0";

  private static readonly HashSet<string> RequiredArguments = new(
    ["sourceRootId", "sourceRelativePath", "destinationRootId", "destinationRelativePath"],
    StringComparer.Ordinal);
  private static readonly JsonElement ArgumentsSchema = FileSystemCapabilitySchemas.Parse(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "sourceRootId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,64}$" },
        "sourceRelativePath": { "type": "string", "minLength": 1, "maxLength": 32767 },
        "destinationRootId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,64}$" },
        "destinationRelativePath": { "type": "string", "minLength": 1, "maxLength": 32767 }
      },
      "required": ["sourceRootId", "sourceRelativePath", "destinationRootId", "destinationRelativePath"],
      "additionalProperties": false
    }
    """);
  private static readonly JsonElement ResultSchema = FileSystemCapabilitySchemas.Parse(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "rootId": { "type": "string", "minLength": 1, "maxLength": 64 },
        "relativePath": { "type": "string", "minLength": 1, "maxLength": 32767 },
        "entryType": { "const": "directory" },
        "entryCount": { "type": "integer", "minimum": 0, "maximum": 4096 },
        "expandedBytes": { "type": "integer", "minimum": 0, "maximum": 5368709120 },
        "sourceArchiveSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["rootId", "relativePath", "entryType", "entryCount", "expandedBytes", "sourceArchiveSha256", "stateSha256"],
      "additionalProperties": false
    }
    """);

  private readonly SupervisorPathPolicy _paths;
  private readonly IHostRecoveryVault _recovery;
  private readonly IArchiveExtractCommitObserver _commitObserver;
  private readonly StrictZipArchiveLimits _configuredLimits;
  private readonly long _maximumArchiveBytes;

  public FileSystemArchiveExtractCapabilityAdapter(
    SupervisorPathPolicy paths,
    IHostRecoveryVault recovery,
    IOptions<HostCapabilityOptions> options,
    IArchiveExtractCommitObserver? commitObserver = null)
  {
    _paths = paths;
    _recovery = recovery;
    _commitObserver = commitObserver ?? new NoOpArchiveExtractCommitObserver();
    _maximumArchiveBytes = Math.Clamp(
      options.Value.MaximumSingleFileBytes,
      1,
      67_108_864);
    _configuredLimits = new StrictZipArchiveLimits(
      Math.Clamp(options.Value.MaximumArchiveEntries, 1, 4_096),
      Math.Clamp(options.Value.MaximumArchiveEntryPathLength, 1, 4_096),
      Math.Clamp(options.Value.MaximumArchiveExpandedBytes, 1, 5_368_709_120),
      Math.Clamp(options.Value.MaximumSingleFileBytes, 1, 1_073_741_824),
      Math.Clamp(options.Value.MaximumArchiveCompressionRatio, 1, 1_000));
  }

  public CapabilityDescriptor Descriptor { get; } = new(
    CapabilityId,
    CapabilityVersion,
    "Extract a governed ZIP archive",
    "Strictly validates and atomically extracts a bounded ZIP into one absent governed directory.",
    CapabilityDataClass.Restricted,
    CapabilityEffect.LocalWrite,
    ConsentRequirement.SignedMandate,
    RecoveryKind.CompensatingAction,
    RequiredPrivilege.LocalSystem,
    IdempotencySemantics.Required,
    ["windows-11-x64"],
    ArgumentsSchema,
    ResultSchema,
    ["windows-zip-archive-source", "windows-zip-extracted-tree"],
    TouchesTrustedRoot: false);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments)
  {
    try
    {
      if (!HostFileSystemSupport.HasExactProperties(arguments, RequiredArguments))
      {
        return FileSystemCapabilitySchemas.Invalid();
      }
      var (source, destination) = Resolve(arguments);
      if (!source.RelativePath.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
      {
        return CapabilityArgumentValidation.Invalid(
          "archive_extension_required",
          "The source archive must end in .zip.");
      }
      using var sourceHandle = _paths.OpenExisting(
        source,
        requireDirectory: false,
        lockAgainstMutation: true,
        readData: true);
      var sourceLength = RandomAccess.GetLength(sourceHandle.Handle);
      if (sourceLength < 0 || sourceLength > _maximumArchiveBytes)
      {
        return CapabilityArgumentValidation.Invalid(
          "archive_source_byte_limit_exceeded",
          "The source archive exceeds the configured byte ceiling.");
      }
      using var parent = _paths.OpenParentForCreate(destination);
      return File.Exists(destination.FullPath) || Directory.Exists(destination.FullPath)
        ? CapabilityArgumentValidation.Invalid(
          "destination_already_exists",
          "The extraction destination must be absent.")
        : CapabilityArgumentValidation.Success;
    }
    catch (HostPolicyException exception)
    {
      return CapabilityArgumentValidation.Invalid(exception.ErrorCode, exception.Message);
    }
  }

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    HostFileSystemSupport.HasExactProperties(
        result,
        new HashSet<string>(
        [
          "rootId",
          "relativePath",
          "entryType",
          "entryCount",
          "expandedBytes",
          "sourceArchiveSha256",
          "stateSha256",
        ], StringComparer.Ordinal))
      && FileSystemCapabilitySchemas.IsString(result, "rootId")
      && result.GetProperty("rootId").GetString() is { Length: > 0 and <= 64 }
      && FileSystemCapabilitySchemas.IsString(result, "relativePath")
      && result.GetProperty("relativePath").GetString() is { Length: > 0 and <= 32_767 }
      && result.TryGetProperty("entryType", out var entryType)
      && entryType.ValueKind == JsonValueKind.String
      && entryType.GetString() == "directory"
      && IsBoundedInteger(result, "entryCount", 4_096)
      && IsBoundedInteger(result, "expandedBytes", 5_368_709_120)
      && FileSystemCapabilitySchemas.IsSha256(result, "sourceArchiveSha256")
      && FileSystemCapabilitySchemas.IsSha256(result, "stateSha256")
        ? CapabilityArgumentValidation.Success
        : CapabilityArgumentValidation.Invalid(
          "result_schema_invalid",
          "The archive extraction result did not match its strict schema.");

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var (source, destination) = Resolve(arguments);
    if (!source.RelativePath.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
    {
      throw new HostPolicyException("archive_extension_required");
    }
    using var destinationParent = _paths.OpenParentForCreate(destination);
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

    using var sourceHandle = _paths.OpenExisting(
      source,
      requireDirectory: false,
      lockAgainstMutation: true,
      readData: true);
    var maximumSourceBytes = Math.Min(_maximumArchiveBytes, context.Budgets.MaxLocalBytes);
    var (archiveBytes, sourceArchiveSha256) =
      await StrictZipArchiveExtractor.ReadExactArchiveAsync(
        sourceHandle,
        maximumSourceBytes,
        cancellationToken).ConfigureAwait(false);
    try
    {
      var remainingLocalBytes = context.Budgets.MaxLocalBytes - archiveBytes.LongLength;
      if (remainingLocalBytes < 0)
      {
        throw new HostPolicyException("local_byte_budget_exceeded");
      }
      StrictZipArchivePlan plan;
      try
      {
        plan = StrictZipArchiveInspector.Inspect(archiveBytes, _configuredLimits);
      }
      catch (OverflowException exception)
      {
        throw new HostPolicyException("archive_limits_exceeded", exception);
      }
      if (plan.ExpandedBytes > remainingLocalBytes / 2)
      {
        throw new HostPolicyException("local_byte_budget_exceeded");
      }

      var recovery = await _recovery.PrepareAsync(
        context,
        CapabilityId,
        destinationState.Sha256,
        new
        {
          destination.RootId,
          destination.RelativePath,
          sourceStateSha256 = sourceArchiveSha256,
          recovery = "delete-created-extracted-tree",
        },
        irreversible: false,
        cancellationToken).ConfigureAwait(false);
      var stagingPath = HostFileSystemSupport.TemporarySiblingPath(
        destination,
        context.ActionId);
      var staging = _paths.Resolve(
        destination.RootId,
        Path.GetRelativePath(destination.RootPath, stagingPath),
        HostPathAccess.Write);
      ArchiveExtractionLease? extraction = null;
      var committed = false;
      try
      {
        SupervisorPathPolicy.EnsureHandleStillNames(
          destinationParent,
          Path.GetDirectoryName(destination.FullPath)!);
        SupervisorPathPolicy.CreateDirectoryNoOverwrite(
          destinationParent,
          Path.GetFileName(staging.FullPath));
        extraction = await StrictZipArchiveExtractor.ExtractAsync(
          _paths,
          staging,
          archiveBytes,
          plan,
          cancellationToken).ConfigureAwait(false);
        await _commitObserver.BeforeCommitAsync(
          source.FullPath,
          destination.FullPath,
          staging.FullPath,
          cancellationToken).ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();

        SupervisorPathPolicy.EnsureHandleStillNames(sourceHandle, source.FullPath);
        SupervisorPathPolicy.EnsureHandleStillNames(
          destinationParent,
          Path.GetDirectoryName(destination.FullPath)!);
        StrictZipArchiveExtractor.EnsureExactTree(
          _paths,
          staging,
          extraction.ExpectedTreeEntries);
        if (File.Exists(destination.FullPath) || Directory.Exists(destination.FullPath))
        {
          throw new HostPreconditionException("destination_changed_before_commit");
        }

        // NTFS does not permit a parent-directory rename while descendants are
        // held without delete sharing. The tree was fully identity-checked
        // above; release only those descendant handles immediately before the
        // synchronous root rename, then hash the committed tree before return.
        extraction.ReleaseDescendantLocksForCommit();
        SupervisorPathPolicy.RenameExact(
          extraction.StagingRoot,
          destinationParent,
          Path.GetFileName(destination.FullPath));
        try
        {
          extraction.EnsureMovedTo(destination);
          extraction.ReleaseRootLockForPostCommitVerification();
          await _commitObserver.AfterCommitBeforeVerificationAsync(
            source.FullPath,
            destination.FullPath,
            CancellationToken.None).ConfigureAwait(false);
          var finalState = await HostFileSystemSupport.ComputeStateAsync(
            _paths,
            destination,
            plan.ExpandedBytes,
            CancellationToken.None).ConfigureAwait(false);
          if (finalState.EntryType != "directory"
            || finalState.Length != plan.TreeEntries.Count
            || finalState.BytesRead != plan.ExpandedBytes
            || !PayloadDigest.FixedTimeEqualsHex(
              finalState.Sha256,
              extraction.StateSha256))
          {
            throw new HostPreconditionException("archive_postcondition_mismatch");
          }
        }
        catch (Exception postconditionException) when (postconditionException is HostPolicyException
          or HostPreconditionException
          or IOException
          or UnauthorizedAccessException)
        {
          try
          {
            using var rollbackRoot = _paths.OpenExistingForAtomicTreeCommit(
              destination,
              requireDirectory: true,
              deleteAccess: true);
            if (rollbackRoot.VolumeSerialNumber != extraction.StagingVolumeSerialNumber
              || rollbackRoot.FileId != extraction.StagingFileId)
            {
              throw new HostPreconditionException("archive_postcommit_identity_changed");
            }
            SupervisorPathPolicy.RenameExact(
              rollbackRoot,
              destinationParent,
              Path.GetFileName(staging.FullPath));
            SupervisorPathPolicy.EnsureHandleStillNames(
              rollbackRoot,
              staging.FullPath);
          }
          catch (Exception rollbackException) when (rollbackException is HostPolicyException
            or HostPreconditionException
            or IOException
            or UnauthorizedAccessException)
          {
            throw new IOException(
              "Archive extraction postcondition failed and exact rollback was not provable.",
              new AggregateException(postconditionException, rollbackException));
          }
          throw new HostPreconditionException(
            "archive_postcondition_mismatch",
            postconditionException);
        }

        committed = true;
        var output = JsonSerializer.Serialize(new
        {
          rootId = destination.RootId,
          relativePath = destination.RelativePath,
          entryType = "directory",
          entryCount = plan.TreeEntries.Count,
          expandedBytes = extraction.ExpandedBytes,
          sourceArchiveSha256,
          stateSha256 = extraction.StateSha256,
        });
        return new CapabilityExecutionResult(
          output,
          MutationCommitted: true,
          OutcomeUncertain: false,
          Provenance:
          [
            HostFileSystemSupport.CreateProvenance(
              "windows-zip-archive-source",
              source,
              sourceArchiveSha256),
            HostFileSystemSupport.CreateProvenance(
              "windows-zip-extracted-tree",
              destination,
              extraction.StateSha256),
          ],
          OpaqueRecoveryHandle: recovery.OpaqueHandle,
          PreStateSha256: destinationState.Sha256,
          RecoveryProvenanceSha256: recovery.RecordSha256,
          LocalBytesRead: checked(archiveBytes.LongLength + extraction.ExpandedBytes),
          LocalBytesWritten: extraction.ExpandedBytes);
      }
      catch (Exception executionException) when (!committed)
      {
        extraction?.Dispose();
        extraction = null;
        try
        {
          StrictZipArchiveExtractor.RemoveOrQuarantineStaging(
            _paths,
            destination,
            staging,
            context.ActionId);
        }
        catch (Exception cleanupException) when (cleanupException is HostPolicyException
          or HostPreconditionException
          or IOException
          or UnauthorizedAccessException)
        {
          throw new IOException(
            "Archive extraction failed and staging cleanup was not provable.",
            new AggregateException(executionException, cleanupException));
        }
        throw;
      }
      finally
      {
        extraction?.Dispose();
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(archiveBytes);
    }
  }

  private (ResolvedHostPath Source, ResolvedHostPath Destination) Resolve(
    JsonElement arguments)
  {
    var source = _paths.Resolve(
      HostFileSystemSupport.RequiredString(arguments, "sourceRootId", 64),
      HostFileSystemSupport.RequiredString(arguments, "sourceRelativePath", 32_767),
      HostPathAccess.Read);
    var destination = _paths.Resolve(
      HostFileSystemSupport.RequiredString(arguments, "destinationRootId", 64),
      HostFileSystemSupport.RequiredString(arguments, "destinationRelativePath", 32_767),
      HostPathAccess.Write);
    if (string.Equals(source.FullPath, destination.FullPath, StringComparison.OrdinalIgnoreCase)
      || SupervisorPathPolicy.IsEqualOrDescendant(destination.FullPath, source.FullPath))
    {
      throw new HostPolicyException("archive_destination_invalid");
    }
    return (source, destination);
  }

  private static bool IsBoundedInteger(
    JsonElement result,
    string property,
    long maximum) => result.TryGetProperty(property, out var value)
    && value.ValueKind == JsonValueKind.Number
    && value.TryGetInt64(out var parsed)
    && parsed is >= 0
    && parsed <= maximum;
}
