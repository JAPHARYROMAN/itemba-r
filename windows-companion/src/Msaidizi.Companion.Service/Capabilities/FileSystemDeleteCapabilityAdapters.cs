using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

public sealed class FileSystemEntryQuarantineCapabilityAdapter : IHostCapabilityAdapter
{
  private static readonly JsonElement ResultSchema = FileSystemCapabilitySchemas.Parse(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "rootId": { "type": "string" },
        "relativePath": { "type": "string" },
        "entryType": { "enum": ["file", "directory"] },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "quarantined": { "const": true }
      },
      "required": ["rootId", "relativePath", "entryType", "stateSha256", "quarantined"],
      "additionalProperties": false
    }
    """);
  private readonly SupervisorPathPolicy _paths;
  private readonly IHostRecoveryVault _recovery;

  public FileSystemEntryQuarantineCapabilityAdapter(
    SupervisorPathPolicy paths,
    IHostRecoveryVault recovery)
  {
    _paths = paths;
    _recovery = recovery;
  }

  public CapabilityDescriptor Descriptor { get; } = FileSystemCapabilitySchemas.Descriptor(
    "filesystem.entry.quarantine",
    "Quarantine a file or folder",
    "Atomically removes an entry from its governed root while preserving a local recovery copy.",
    CapabilityEffect.LocalWrite,
    RecoveryKind.Quarantine,
    RequiredPrivilege.LocalSystem,
    FileSystemCapabilitySchemas.PathArguments,
    ResultSchema,
    "windows-filesystem-quarantine");

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    FileSystemCapabilitySchemas.ValidatePathArguments(
      arguments,
      _paths,
      HostPathAccess.Delete,
      allowRoot: false,
      requireDirectory: null);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    FileSystemCapabilitySchemas.ValidateSimpleResult(
        result,
        "rootId",
        "relativePath",
        "entryType",
        "stateSha256",
        "quarantined").IsValid
      && FileSystemCapabilitySchemas.IsString(result, "rootId")
      && FileSystemCapabilitySchemas.IsString(result, "relativePath")
      && FileSystemCapabilitySchemas.IsString(result, "entryType")
      && result.GetProperty("entryType").GetString() is "file" or "directory"
      && FileSystemCapabilitySchemas.IsSha256(result, "stateSha256")
      && result.GetProperty("quarantined").ValueKind == JsonValueKind.True
        ? CapabilityArgumentValidation.Success
        : CapabilityArgumentValidation.Invalid("result_schema_invalid", "Invalid quarantine result.");

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var target = _paths.Resolve(
      arguments.GetProperty("rootId").GetString()!,
      arguments.GetProperty("relativePath").GetString()!,
      HostPathAccess.Delete);
    using var parent = _paths.OpenParentForCreate(target);
    var preState = await HostFileSystemSupport.ComputeStateAsync(
      _paths,
      target,
      context.Budgets.MaxLocalBytes,
      cancellationToken).ConfigureAwait(false);
    HostFileSystemSupport.EnsureExpectedPreState(context, preState);
    using var targetHandle = _paths.OpenExisting(
      target,
      lockAgainstMutation: true,
      deleteAccess: true);
    if (targetHandle.VolumeSerialNumber != preState.VolumeSerialNumber
      || targetHandle.FileId != preState.FileId)
    {
      throw new HostPreconditionException("target_changed_before_quarantine");
    }
    var recoveryDirectory = _paths.CreateRecoveryDirectory(target, context.ActionId);
    using var recoveryParent = _paths.OpenRecoveryEntry(
      target,
      recoveryDirectory,
      requireDirectory: true);
    var quarantinedPath = Path.Combine(recoveryDirectory, "payload");
    if (File.Exists(quarantinedPath) || Directory.Exists(quarantinedPath))
    {
      throw new HostPolicyException("quarantine_collision");
    }

    var recovery = await _recovery.PrepareAsync(
      context,
      "filesystem.entry.quarantine",
      preState.Sha256,
      new
      {
        target.RootId,
        target.RelativePath,
        quarantinedPath,
        preState.EntryType,
        recovery = "move-quarantined-payload-to-original-path",
      },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    SupervisorPathPolicy.EnsureHandleStillNames(parent, Path.GetDirectoryName(target.FullPath)!);
    SupervisorPathPolicy.EnsureHandleStillNames(targetHandle, target.FullPath);
    SupervisorPathPolicy.EnsureHandleStillNames(recoveryParent, recoveryDirectory);
    SupervisorPathPolicy.RenameExact(targetHandle, recoveryParent, "payload");

    if (File.Exists(target.FullPath) || Directory.Exists(target.FullPath))
    {
      throw new IOException("Quarantine move did not remove the original target.");
    }

    var output = JsonSerializer.Serialize(new
    {
      rootId = target.RootId,
      relativePath = target.RelativePath,
      entryType = preState.EntryType,
      stateSha256 = preState.Sha256,
      quarantined = true,
    });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: true,
      OutcomeUncertain: false,
      [HostFileSystemSupport.CreateProvenance(
        "windows-filesystem-quarantine",
        target,
        preState.Sha256)],
      recovery.OpaqueHandle,
      preState.Sha256,
      recovery.RecordSha256,
      LocalBytesRead: preState.BytesRead);
  }
}

public sealed class FileSystemEntryPermanentDeleteCapabilityAdapter : IHostCapabilityAdapter
{
  private static readonly JsonElement ResultSchema = FileSystemCapabilitySchemas.Parse(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "rootId": { "type": "string" },
        "relativePath": { "type": "string" },
        "entryType": { "enum": ["file", "directory"] },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "irreversible": { "const": true }
      },
      "required": ["rootId", "relativePath", "entryType", "stateSha256", "irreversible"],
      "additionalProperties": false
    }
    """);
  private readonly SupervisorPathPolicy _paths;
  private readonly IHostRecoveryVault _recovery;
  private readonly bool _enabled;

  public FileSystemEntryPermanentDeleteCapabilityAdapter(
    SupervisorPathPolicy paths,
    IHostRecoveryVault recovery,
    IOptions<HostCapabilityOptions> options)
  {
    _paths = paths;
    _recovery = recovery;
    _enabled = options.Value.PermanentDeleteEnabled;
  }

  public CapabilityDescriptor Descriptor { get; } = FileSystemCapabilitySchemas.Descriptor(
    "filesystem.entry.delete-permanently",
    "Permanently delete a file or folder",
    "Irreversibly deletes one governed entry. Requires an external supervisor flag and emergency grant.",
    CapabilityEffect.Irreversible,
    RecoveryKind.Irreversible,
    RequiredPrivilege.LocalSystem,
    FileSystemCapabilitySchemas.PathArguments,
    ResultSchema,
    "windows-filesystem-permanent-delete",
    ConsentRequirement.EmergencyOperator);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments)
  {
    if (!_enabled)
    {
      return CapabilityArgumentValidation.Invalid(
        "permanent_delete_disabled",
        "Permanent deletion is disabled by the external supervisor.");
    }

    return FileSystemCapabilitySchemas.ValidatePathArguments(
      arguments,
      _paths,
      HostPathAccess.Delete,
      allowRoot: false,
      requireDirectory: null);
  }

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    FileSystemCapabilitySchemas.ValidateSimpleResult(
        result,
        "rootId",
        "relativePath",
        "entryType",
        "stateSha256",
        "irreversible").IsValid
      && FileSystemCapabilitySchemas.IsString(result, "rootId")
      && FileSystemCapabilitySchemas.IsString(result, "relativePath")
      && FileSystemCapabilitySchemas.IsString(result, "entryType")
      && result.GetProperty("entryType").GetString() is "file" or "directory"
      && FileSystemCapabilitySchemas.IsSha256(result, "stateSha256")
      && result.GetProperty("irreversible").ValueKind == JsonValueKind.True
        ? CapabilityArgumentValidation.Success
        : CapabilityArgumentValidation.Invalid("result_schema_invalid", "Invalid delete result.");

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    if (!_enabled)
    {
      throw new HostPolicyException("permanent_delete_disabled");
    }

    var target = _paths.Resolve(
      arguments.GetProperty("rootId").GetString()!,
      arguments.GetProperty("relativePath").GetString()!,
      HostPathAccess.Delete);
    using var parent = _paths.OpenParentForCreate(target);
    var preState = await HostFileSystemSupport.ComputeStateAsync(
      _paths,
      target,
      context.Budgets.MaxLocalBytes,
      cancellationToken).ConfigureAwait(false);
    HostFileSystemSupport.EnsureExpectedPreState(context, preState);
    using var targetHandle = _paths.OpenExisting(
      target,
      lockAgainstMutation: true,
      deleteAccess: true);
    if (targetHandle.VolumeSerialNumber != preState.VolumeSerialNumber
      || targetHandle.FileId != preState.FileId)
    {
      throw new HostPreconditionException("target_changed_before_permanent_delete");
    }
    var recovery = await _recovery.PrepareAsync(
      context,
      "filesystem.entry.delete-permanently",
      preState.Sha256,
      new
      {
        target.RootId,
        target.RelativePath,
        preState.EntryType,
        recovery = "none",
      },
      irreversible: true,
      cancellationToken).ConfigureAwait(false);
    SupervisorPathPolicy.EnsureHandleStillNames(parent, Path.GetDirectoryName(target.FullPath)!);

    // Enumerating and hashing above rejects links. Permanent deletion remains
    // opt-in and is intentionally separate from the default quarantine path.
    if (preState.EntryType == "directory")
    {
      DeleteDirectoryBottomUp(_paths, target, targetHandle, cancellationToken);
    }
    else
    {
      SupervisorPathPolicy.DeleteExact(targetHandle);
    }

    var output = JsonSerializer.Serialize(new
    {
      rootId = target.RootId,
      relativePath = target.RelativePath,
      entryType = preState.EntryType,
      stateSha256 = preState.Sha256,
      irreversible = true,
    });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: true,
      OutcomeUncertain: false,
      [HostFileSystemSupport.CreateProvenance(
        "windows-filesystem-permanent-delete",
        target,
        preState.Sha256)],
      recovery.OpaqueHandle,
      preState.Sha256,
      recovery.RecordSha256,
      LocalBytesRead: preState.BytesRead);
  }

  private static void DeleteDirectoryBottomUp(
    SupervisorPathPolicy paths,
    ResolvedHostPath target,
    ValidatedPathHandle rootHandle,
    CancellationToken cancellationToken)
  {
    var entries = HostFileSystemSupport.EnumerateTree(paths, target)
      .OrderByDescending(entry => entry.RelativePath.Count(character =>
        character == Path.DirectorySeparatorChar))
      .ThenByDescending(entry => entry.RelativePath, StringComparer.OrdinalIgnoreCase)
      .ToArray();
    foreach (var entry in entries)
    {
      cancellationToken.ThrowIfCancellationRequested();
      using var checkedHandle = paths.OpenExisting(
        entry,
        lockAgainstMutation: true,
        deleteAccess: true);
      SupervisorPathPolicy.DeleteExact(checkedHandle);
    }

    SupervisorPathPolicy.DeleteExact(rootHandle);
  }
}
