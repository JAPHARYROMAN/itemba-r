using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal static class FileSystemAclCapabilitySchemas
{
  public const string TargetArguments =
    """
    {
      "type": "object",
      "properties": {
        "rootId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "relativePath": { "type": "string", "maxLength": 4096 }
      },
      "required": ["rootId", "relativePath"],
      "additionalProperties": false
    }
    """;

  public const string SetArguments =
    """
    {
      "type": "object",
      "properties": {
        "rootId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "relativePath": { "type": "string", "maxLength": 4096 },
        "profileId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" }
      },
      "required": ["rootId", "relativePath", "profileId"],
      "additionalProperties": false
    }
    """;

  public const string ReadResult =
    """
    {
      "type": "object",
      "properties": {
        "ownerSid": { "type": ["string", "null"], "maxLength": 184 },
        "groupSid": { "type": ["string", "null"], "maxLength": 184 },
        "daclSddl": { "type": "string", "maxLength": 65536 },
        "daclProtected": { "type": "boolean" },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["ownerSid", "groupSid", "daclSddl", "daclProtected", "stateSha256"],
      "additionalProperties": false
    }
    """;

  public const string MutationResult =
    """
    {
      "type": "object",
      "properties": {
        "committed": { "const": true },
        "profileId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["committed", "profileId", "stateSha256"],
      "additionalProperties": false
    }
    """;

  public static CapabilityArgumentValidation ValidateTarget(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(value, "rootId", "relativePath")
    && GovernedWindowsCapabilitySupport.String(value, "rootId", 1, 80)
    && GovernedWindowsCapabilitySupport.String(value, "relativePath", 0, 4_096)
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidArguments(
        "File permission target arguments are invalid.");

  public static CapabilityArgumentValidation ValidateSet(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(value, "rootId", "relativePath", "profileId")
    && GovernedWindowsCapabilitySupport.String(value, "rootId", 1, 80)
    && GovernedWindowsCapabilitySupport.String(value, "relativePath", 0, 4_096)
    && GovernedWindowsCapabilitySupport.String(value, "profileId", 1, 80)
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidArguments(
        "File permission mutation arguments are invalid.");

  public static CapabilityArgumentValidation ValidateReadResult(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(
      value,
      "ownerSid",
      "groupSid",
      "daclSddl",
      "daclProtected",
      "stateSha256")
    && NullableSid(value, "ownerSid")
    && NullableSid(value, "groupSid")
    && GovernedWindowsCapabilitySupport.String(value, "daclSddl", 1, 65_536)
    && GovernedWindowsCapabilitySupport.Boolean(value, "daclProtected")
    && GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidResult(
        "File permission inspection result is invalid.");

  public static CapabilityArgumentValidation ValidateMutationResult(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(value, "committed", "profileId", "stateSha256")
    && value.GetProperty("committed").ValueKind == JsonValueKind.True
    && GovernedWindowsCapabilitySupport.String(value, "profileId", 1, 80)
    && GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidResult(
        "File permission mutation result is invalid.");

  private static bool NullableSid(JsonElement value, string property)
  {
    if (!value.TryGetProperty(property, out var candidate))
    {
      return false;
    }
    if (candidate.ValueKind == JsonValueKind.Null)
    {
      return true;
    }
    return candidate.ValueKind == JsonValueKind.String
      && candidate.GetString() is { Length: > 0 and <= 184 } sid
      && TrySid(sid);
  }

  private static bool TrySid(string value)
  {
    try
    {
      _ = new SecurityIdentifier(value);
      return true;
    }
    catch (ArgumentException)
    {
      return false;
    }
  }
}

internal sealed record ResolvedFileAclProfile(
  string Id,
  string CanonicalDaclSddl,
  bool DaclProtected,
  IReadOnlySet<string> RootIds,
  string StateSha256);

internal sealed class FileAclPolicy
{
  private const int ReadControlAndWriteDac = 0x00060000;
  private static readonly SecurityIdentifier LocalSystemSid =
    new(WellKnownSidType.LocalSystemSid, null);
  private readonly Dictionary<string, ResolvedFileAclProfile> _profiles;

  public FileAclPolicy(IOptions<HostCapabilityOptions> options)
  {
    var allowedRoots = options.Value.AllowedRoots
      .Where(root => root.AllowWrite)
      .Select(root => root.Id)
      .ToHashSet(StringComparer.Ordinal);
    var profiles = new Dictionary<string, ResolvedFileAclProfile>(StringComparer.Ordinal);
    foreach (var configured in options.Value.AllowedFileAclProfiles)
    {
      if (!GovernedWindowsCapabilitySupport.IsSafeId(configured.Id)
        || configured.RootIds.Count == 0
        || configured.RootIds.Count > 64
        || configured.RootIds.Distinct(StringComparer.Ordinal).Count() != configured.RootIds.Count
        || configured.RootIds.Any(rootId => !allowedRoots.Contains(rootId))
        || !profiles.TryAdd(configured.Id, Parse(configured)))
      {
        throw new InvalidOperationException("A file ACL profile is invalid or duplicated.");
      }
    }
    _profiles = profiles;
  }

  public ResolvedFileAclProfile Resolve(string profileId, string rootId)
  {
    if (!_profiles.TryGetValue(profileId, out var profile)
      || !profile.RootIds.Contains(rootId))
    {
      throw new HostPreconditionException("file_acl_profile_not_allowed");
    }
    return profile;
  }

  public static string ValidateRecoverySddl(string sddl, bool expectedProtectedDacl)
  {
    if (string.IsNullOrWhiteSpace(sddl) || sddl.Length > 65_536)
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }
    try
    {
      var descriptor = new RawSecurityDescriptor(sddl);
      if (descriptor.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclProtected)
        != expectedProtectedDacl)
      {
        throw new HostRecoveryException("recovery_record_format_invalid");
      }
      return CanonicalDacl(descriptor);
    }
    catch (ArgumentException)
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }
  }

  private static ResolvedFileAclProfile Parse(AllowedFileAclProfileOptions configured)
  {
    RawSecurityDescriptor descriptor;
    try
    {
      descriptor = new RawSecurityDescriptor(configured.Sddl);
    }
    catch (ArgumentException exception)
    {
      throw new InvalidOperationException("A file ACL profile contains invalid SDDL.", exception);
    }
    if (descriptor.Owner is not null
      || descriptor.Group is not null
      || descriptor.SystemAcl is not null
      || descriptor.DiscretionaryAcl is null
      || !descriptor.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclPresent))
    {
      throw new InvalidOperationException(
        "File ACL profiles may contain one DACL only; ownership and audit policy remain supervisor-owned.");
    }

    var systemAllowed = false;
    foreach (GenericAce ace in descriptor.DiscretionaryAcl)
    {
      if (ace is not QualifiedAce qualified
        || qualified.AceQualifier != AceQualifier.AccessAllowed
        || qualified.IsCallback)
      {
        throw new InvalidOperationException(
          "File ACL profiles may contain only unconditional allow entries; deny, callback, and unknown entries could lock out trusted recovery.");
      }
      if (qualified.SecurityIdentifier.Equals(LocalSystemSid)
        && (qualified.AccessMask & ReadControlAndWriteDac) == ReadControlAndWriteDac)
      {
        systemAllowed = true;
      }
    }
    if (!systemAllowed)
    {
      throw new InvalidOperationException(
        "File ACL profiles must preserve LocalSystem READ_CONTROL and WRITE_DAC recovery access.");
    }

    var canonical = CanonicalDacl(descriptor);
    var protectedDacl = descriptor.ControlFlags.HasFlag(
      ControlFlags.DiscretionaryAclProtected);
    return new ResolvedFileAclProfile(
      configured.Id,
      canonical,
      protectedDacl,
      configured.RootIds.ToHashSet(StringComparer.Ordinal),
      FileAclState.State(canonical, protectedDacl));
  }

  private static string CanonicalDacl(RawSecurityDescriptor descriptor)
  {
    var canonical = descriptor.GetSddlForm(AccessControlSections.Access);
    if (string.IsNullOrWhiteSpace(canonical) || !canonical.StartsWith("D:", StringComparison.Ordinal))
    {
      throw new ArgumentException("A present DACL is required.");
    }
    return canonical;
  }
}

internal sealed record FileAclState(
  string? OwnerSid,
  string? GroupSid,
  string DaclSddl,
  bool DaclProtected,
  string StateSha256,
  long BytesRead)
{
  public static string State(string daclSddl, bool daclProtected) =>
    GovernedWindowsCapabilitySupport.StateSha256(new { daclSddl, daclProtected });
}

internal interface IWindowsFileAclManager
{
  FileAclState Read(ValidatedPathHandle target);

  void SetDacl(ValidatedPathHandle target, string canonicalDaclSddl, bool protectedDacl);
}

internal sealed class WindowsFileAclManager : IWindowsFileAclManager
{
  private const uint OwnerSecurityInformation = 0x00000001;
  private const uint GroupSecurityInformation = 0x00000002;
  private const uint DaclSecurityInformation = 0x00000004;
  private const uint UnprotectedDaclSecurityInformation = 0x20000000;
  private const uint ProtectedDaclSecurityInformation = 0x80000000;
  private const int ErrorInsufficientBuffer = 122;
  private const int MaximumSecurityDescriptorBytes = 1_048_576;

  public FileAclState Read(ValidatedPathHandle target)
  {
    var information = OwnerSecurityInformation | GroupSecurityInformation
      | DaclSecurityInformation;
    _ = GetKernelObjectSecurity(target.Handle, information, null, 0, out var required);
    var error = Marshal.GetLastWin32Error();
    if (required == 0 || required > MaximumSecurityDescriptorBytes
      || error != ErrorInsufficientBuffer)
    {
      throw NativeFailure("file_acl_read_failed", error);
    }
    var binary = new byte[required];
    if (!GetKernelObjectSecurity(
      target.Handle,
      information,
      binary,
      checked((uint)binary.Length),
      out var actual)
      || actual == 0
      || actual > binary.Length)
    {
      throw NativeFailure("file_acl_read_failed", Marshal.GetLastWin32Error());
    }
    var descriptor = new RawSecurityDescriptor(binary, 0);
    if (descriptor.DiscretionaryAcl is null
      || !descriptor.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclPresent))
    {
      throw new HostPreconditionException("null_file_dacl_forbidden");
    }
    var daclSddl = descriptor.GetSddlForm(AccessControlSections.Access);
    var protectedDacl = descriptor.ControlFlags.HasFlag(
      ControlFlags.DiscretionaryAclProtected);
    return new FileAclState(
      descriptor.Owner?.Value,
      descriptor.Group?.Value,
      daclSddl,
      protectedDacl,
      FileAclState.State(daclSddl, protectedDacl),
      actual);
  }

  public void SetDacl(
    ValidatedPathHandle target,
    string canonicalDaclSddl,
    bool protectedDacl)
  {
    var descriptor = new RawSecurityDescriptor(canonicalDaclSddl);
    var binary = new byte[descriptor.BinaryLength];
    descriptor.GetBinaryForm(binary, 0);
    var information = DaclSecurityInformation
      | (protectedDacl
        ? ProtectedDaclSecurityInformation
        : UnprotectedDaclSecurityInformation);
    if (!SetKernelObjectSecurity(target.Handle, information, binary))
    {
      throw NativeFailure("file_acl_write_failed", Marshal.GetLastWin32Error());
    }
  }

  private static HostPolicyException NativeFailure(string code, int nativeError) =>
    new(code, new Win32Exception(nativeError));

  [DllImport("advapi32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetKernelObjectSecurity(
    SafeFileHandle handle,
    uint requestedInformation,
    [Out] byte[]? securityDescriptor,
    uint length,
    out uint lengthNeeded);

  [DllImport("advapi32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SetKernelObjectSecurity(
    SafeFileHandle handle,
    uint securityInformation,
    byte[] securityDescriptor);
}

internal sealed class FileSystemAclReadCapabilityAdapter(
  SupervisorPathPolicy paths,
  IWindowsFileAclManager permissions) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } =
    GovernedWindowsCapabilitySupport.Descriptor(
      "filesystem.acl.read",
      "Inspect governed NTFS permissions",
      "Reads owner, group, and DACL metadata through a non-following handle for one approved path.",
      CapabilityDataClass.Restricted,
      CapabilityEffect.LocalRead,
      RecoveryKind.NotApplicable,
      FileSystemAclCapabilitySchemas.TargetArguments,
      FileSystemAclCapabilitySchemas.ReadResult,
      ["ntfs-security-descriptor"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    FileSystemAclCapabilitySchemas.ValidateTarget(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    FileSystemAclCapabilitySchemas.ValidateReadResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var path = Resolve(paths, arguments, HostPathAccess.Read);
    using var handle = paths.OpenExisting(
      path,
      lockAgainstMutation: true,
      readSecurityAccess: true);
    var state = permissions.Read(handle);
    var output = JsonSerializer.Serialize(new
    {
      ownerSid = state.OwnerSid,
      groupSid = state.GroupSid,
      daclSddl = state.DaclSddl,
      daclProtected = state.DaclProtected,
      stateSha256 = state.StateSha256,
    });
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance: [Provenance(path, state.StateSha256)],
      PreStateSha256: state.StateSha256,
      LocalBytesRead: state.BytesRead));
  }

  internal static ResolvedHostPath Resolve(
    SupervisorPathPolicy paths,
    JsonElement arguments,
    HostPathAccess access) => paths.Resolve(
      arguments.GetProperty("rootId").GetString()!,
      arguments.GetProperty("relativePath").GetString()!,
      access,
      allowRoot: true);

  internal static DataProvenance Provenance(ResolvedHostPath path, string stateSha256) =>
    HostFileSystemSupport.CreateProvenance("ntfs-security-descriptor", path, stateSha256);
}

internal sealed class FileSystemAclSetCapabilityAdapter(
  SupervisorPathPolicy paths,
  FileAclPolicy policy,
  IWindowsFileAclManager permissions,
  IHostRecoveryVault recoveryVault) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } =
    GovernedWindowsCapabilitySupport.Descriptor(
      "filesystem.acl.set",
      "Apply governed NTFS permission profile",
      "Replaces only the DACL with a supervisor-authored profile after recording exact recovery state.",
      CapabilityDataClass.Restricted,
      CapabilityEffect.Administrative,
      RecoveryKind.Snapshot,
      FileSystemAclCapabilitySchemas.SetArguments,
      FileSystemAclCapabilitySchemas.MutationResult,
      ["ntfs-security-descriptor", "host-recovery-record"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    FileSystemAclCapabilitySchemas.ValidateSet(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    FileSystemAclCapabilitySchemas.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var path = FileSystemAclReadCapabilityAdapter.Resolve(
      paths,
      arguments,
      HostPathAccess.Write);
    var profile = policy.Resolve(
      arguments.GetProperty("profileId").GetString()!,
      path.RootId);
    using var handle = paths.OpenExisting(
      path,
      lockAgainstMutation: true,
      readSecurityAccess: true,
      writeDacAccess: true);
    var before = permissions.Read(handle);
    RegistryValueSetCapabilityAdapter.MatchExpected(context, before.StateSha256);
    if (PayloadDigest.FixedTimeEqualsHex(before.StateSha256, profile.StateSha256))
    {
      throw new HostPreconditionException("file_acl_already_desired");
    }
    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      before.StateSha256,
      new
      {
        path.RootId,
        path.RelativePath,
        before.DaclSddl,
        before.DaclProtected,
      },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    cancellationToken.ThrowIfCancellationRequested();
    permissions.SetDacl(handle, profile.CanonicalDaclSddl, profile.DaclProtected);
    var after = permissions.Read(handle);
    if (!PayloadDigest.FixedTimeEqualsHex(after.StateSha256, profile.StateSha256))
    {
      throw new HostPreconditionException("file_acl_postcondition_failed");
    }
    var output = JsonSerializer.Serialize(new
    {
      committed = true,
      profileId = profile.Id,
      stateSha256 = after.StateSha256,
    });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: true,
      OutcomeUncertain: false,
      Provenance:
      [
        FileSystemAclReadCapabilityAdapter.Provenance(path, after.StateSha256),
        RegistryValueSetCapabilityAdapter.RecoveryProvenance(recovery),
      ],
      OpaqueRecoveryHandle: recovery.OpaqueHandle,
      PreStateSha256: before.StateSha256,
      RecoveryProvenanceSha256: recovery.RecordSha256,
      LocalBytesRead: before.BytesRead + after.BytesRead,
      LocalBytesWritten: Encoding.UTF8.GetByteCount(profile.CanonicalDaclSddl));
  }
}

internal sealed class FileAclAdministrativeRecoveryOperation(
  SupervisorPathPolicy paths,
  IWindowsFileAclManager permissions) : IAdministrativeRecoveryOperation
{
  public bool Supports(string operation) => operation == "filesystem.acl.set";

  public ValueTask<string> ReadStateAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var path = Resolve(record.RecoveryRecord);
    using var handle = paths.OpenExisting(
      path,
      lockAgainstMutation: true,
      readSecurityAccess: true);
    return ValueTask.FromResult(permissions.Read(handle).StateSha256);
  }

  public ValueTask RestoreAsync(
    TrustedHostRecoveryRecord record,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var path = Resolve(record.RecoveryRecord);
    var protectedDacl = LocalAccountAdministrativeRecoveryOperation.RequiredBoolean(
      record.RecoveryRecord,
      "daclProtected");
    var sddl = FileAclPolicy.ValidateRecoverySddl(
      RecoveryJson.RequiredString(record.RecoveryRecord, "daclSddl", 65_536),
      protectedDacl);
    using var handle = paths.OpenExisting(
      path,
      lockAgainstMutation: true,
      readSecurityAccess: true,
      writeDacAccess: true);
    permissions.SetDacl(handle, sddl, protectedDacl);
    return ValueTask.CompletedTask;
  }

  private ResolvedHostPath Resolve(JsonElement recoveryRecord) => paths.Resolve(
    RecoveryJson.RequiredString(recoveryRecord, "rootId", 80),
    RecoveryJson.RequiredString(recoveryRecord, "relativePath", 4_096),
    HostPathAccess.Write,
    allowRoot: true);
}
