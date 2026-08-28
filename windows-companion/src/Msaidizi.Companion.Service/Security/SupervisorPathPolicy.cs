using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Microsoft.Extensions.Options;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.Security;

public enum HostPathAccess
{
  Read,
  Write,
  Delete,
}

public sealed record ResolvedHostPath(
  string RootId,
  string RootPath,
  string FullPath,
  string RelativePath,
  string QuarantinePath,
  HostPathAccess Access);

public sealed record ValidatedPathHandle(
  SafeFileHandle Handle,
  string FinalPath,
  uint VolumeSerialNumber,
  ulong FileId,
  uint LinkCount,
  bool IsDirectory) : IDisposable
{
  public void Dispose() => Handle.Dispose();
}

/// <summary>
/// Resolves untrusted relative paths only beneath supervisor-owned root IDs.
/// Existing objects are verified through non-following Windows handles. Parent
/// directory handles intentionally omit FILE_SHARE_DELETE so a validated
/// parent cannot be renamed out from beneath a bounded mutation.
/// </summary>
public sealed partial class SupervisorPathPolicy
{
  private static readonly HashSet<string> ReservedDeviceNames = BuildReservedNames();
  private readonly Dictionary<string, RootPolicy> _roots;
  private readonly IReadOnlyList<string> _protectedPaths;

  public SupervisorPathPolicy(
    IOptions<HostCapabilityOptions> hostOptions,
    IOptions<CompanionOptions> companionOptions,
    IOptions<BrokerChannelOptions>? brokerOptions = null)
  {
    var options = hostOptions.Value;
    _protectedPaths = BuildProtectedPaths(
      options,
      companionOptions.Value,
      brokerOptions?.Value);
    if (!options.Enabled)
    {
      _roots = new Dictionary<string, RootPolicy>(StringComparer.Ordinal);
      return;
    }

    var roots = new Dictionary<string, RootPolicy>(StringComparer.Ordinal);
    foreach (var configured in options.AllowedRoots)
    {
      if (string.IsNullOrWhiteSpace(configured.Id)
        || configured.Id.Length > 64
        || configured.Id.Any(character =>
          !(char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.')))
      {
        throw new InvalidOperationException("Host root IDs must be non-empty safe identifiers.");
      }

      if (roots.ContainsKey(configured.Id))
      {
        throw new InvalidOperationException($"Duplicate host root ID '{configured.Id}'.");
      }

      var configuredPath = NormalizeAbsoluteSupervisorPath(configured.Path, "allowed root");
      if (!Directory.Exists(configuredPath))
      {
        throw new InvalidOperationException($"Allowed root '{configured.Id}' does not exist.");
      }

      var configuredDriveRoot = Path.GetPathRoot(configuredPath)
        ?? throw new InvalidOperationException($"Allowed root '{configured.Id}' has no volume.");
      EnsureExistingSegmentsAreSafe(configuredDriveRoot, configuredPath);
      using var rootHandle = OpenAndValidateAbsolute(
        configuredPath,
        expectedRoot: null,
        expectedVolume: null,
        requireDirectory: true,
        lockAgainstRename: true);
      if (!string.Equals(
        Path.TrimEndingDirectorySeparator(rootHandle.FinalPath),
        configuredPath,
        StringComparison.OrdinalIgnoreCase))
      {
        throw new InvalidOperationException(
          $"Allowed root '{configured.Id}' resolved to a different canonical path.");
      }

      var quarantinePath = NormalizeAbsoluteSupervisorPath(
        configured.QuarantinePath,
        "quarantine root");
      var quarantineParent = Path.GetDirectoryName(quarantinePath)
        ?? throw new InvalidOperationException(
          $"Quarantine for root '{configured.Id}' has no parent directory.");
      if (!Directory.Exists(quarantineParent))
      {
        throw new InvalidOperationException(
          $"Quarantine parent for root '{configured.Id}' must already exist.");
      }

      var quarantineDriveRoot = Path.GetPathRoot(quarantinePath)
        ?? throw new InvalidOperationException(
          $"Quarantine for root '{configured.Id}' has no volume.");
      EnsureExistingSegmentsAreSafe(quarantineDriveRoot, quarantineParent);
      if (!string.Equals(
        Path.GetPathRoot(rootHandle.FinalPath),
        Path.GetPathRoot(quarantinePath),
        StringComparison.OrdinalIgnoreCase))
      {
        throw new InvalidOperationException(
          $"Quarantine for root '{configured.Id}' must be on the same volume.");
      }

      if (IsEqualOrDescendant(quarantinePath, rootHandle.FinalPath))
      {
        throw new InvalidOperationException(
          $"Quarantine for root '{configured.Id}' must be outside the model-addressable root.");
      }

      roots.Add(configured.Id, new RootPolicy(
        configured.Id,
        rootHandle.FinalPath,
        quarantinePath,
        configured.AllowRead,
        configured.AllowWrite,
        configured.AllowDelete,
        rootHandle.VolumeSerialNumber));
    }

    _roots = roots;
  }

  public ResolvedHostPath Resolve(
    string rootId,
    string relativePath,
    HostPathAccess access,
    bool allowRoot = false)
  {
    if (!_roots.TryGetValue(rootId, out var root))
    {
      throw new HostPolicyException("root_not_allowed");
    }

    if ((access == HostPathAccess.Read && !root.AllowRead)
      || (access == HostPathAccess.Write && !root.AllowWrite)
      || (access == HostPathAccess.Delete && !root.AllowDelete))
    {
      throw new HostPolicyException("root_access_not_allowed");
    }

    var normalizedRelative = NormalizeRelativePath(relativePath, allowRoot);
    var combined = normalizedRelative.Length == 0
      ? root.Path
      : Path.GetFullPath(Path.Combine(root.Path, normalizedRelative));
    if (!IsEqualOrDescendant(combined, root.Path))
    {
      throw new HostPolicyException("path_outside_allowed_root");
    }

    if (_protectedPaths.Any(path =>
      IsEqualOrDescendant(combined, path) || IsEqualOrDescendant(path, combined)))
    {
      throw new HostPolicyException("trusted_root_path_forbidden");
    }

    return new ResolvedHostPath(
      root.Id,
      root.Path,
      combined,
      normalizedRelative,
      root.QuarantinePath,
      access);
  }

  public ValidatedPathHandle OpenSupervisorExecutablePath(string configuredPath)
  {
    var normalized = NormalizeAbsoluteSupervisorPath(configuredPath, "approved executable");
    if (!string.Equals(Path.GetExtension(normalized), ".exe", StringComparison.OrdinalIgnoreCase))
    {
      throw new InvalidOperationException("Approved process entries must be .exe files.");
    }

    var driveRoot = Path.GetPathRoot(normalized)
      ?? throw new InvalidOperationException("Approved executable has no local volume root.");
    EnsureExistingSegmentsAreSafe(driveRoot, normalized);
    var handle = OpenAndValidateAbsolute(
      normalized,
      expectedRoot: driveRoot,
      expectedVolume: null,
      requireDirectory: false,
      lockAgainstRename: true,
      lockAgainstWrite: true);
    try
    {
      if (_protectedPaths.Any(path =>
        IsEqualOrDescendant(handle.FinalPath, path) || IsEqualOrDescendant(path, handle.FinalPath)))
      {
        throw new InvalidOperationException("Approved executable overlaps the trusted root.");
      }

      return handle;
    }
    catch
    {
      handle.Dispose();
      throw;
    }
  }

  internal static ValidatedPathHandle OpenSystemExecutablePath(string configuredPath)
  {
    var system32 = Path.TrimEndingDirectorySeparator(Path.GetFullPath(
      Environment.SystemDirectory));
    var normalized = NormalizeAbsoluteSupervisorPath(
      configuredPath,
      "fixed system command executable");
    if (!SupervisorPathPolicy.IsEqualOrDescendant(normalized, system32)
      || !string.Equals(Path.GetExtension(normalized), ".exe", StringComparison.OrdinalIgnoreCase))
    {
      throw new HostPolicyException("command_executable_not_allowed");
    }

    // Windows component-store files legitimately have hard links. This narrow
    // exception is safe only when the caller has already selected an exact
    // reviewed System32 path. The privileged command policy has a two-value
    // enum; this handle blocks write/rename and launch rechecks the resulting
    // image path plus volume/file identity before resume.
    return OpenAndValidateAbsolute(
      normalized,
      expectedRoot: system32,
      expectedVolume: null,
      requireDirectory: false,
      lockAgainstRename: true,
      lockAgainstWrite: true,
      allowHardLinks: true);
  }

  public ValidatedPathHandle OpenExisting(
    ResolvedHostPath resolved,
    bool? requireDirectory = null,
    bool lockAgainstMutation = false,
    bool readData = false,
    bool deleteAccess = false,
    bool readSecurityAccess = false,
    bool writeDacAccess = false)
  {
    var root = _roots[resolved.RootId];
    EnsureExistingSegmentsAreSafe(root.Path, resolved.FullPath);
    return OpenAndValidateAbsolute(
      resolved.FullPath,
      root.Path,
      root.VolumeSerialNumber,
      requireDirectory,
      lockAgainstMutation,
      readData,
      deleteAccess,
      readSecurityAccess: readSecurityAccess,
      writeDacAccess: writeDacAccess,
      lockAgainstWrite: lockAgainstMutation);
  }

  /// <summary>
  /// Opens one already validated staging-tree entry for an atomic parent
  /// directory rename. Writes remain share-denied, while FILE_SHARE_DELETE is
  /// retained so an ancestor directory can move as one NTFS namespace effect.
  /// Callers must recheck the exact handle path immediately before and after
  /// the rename because this narrow mode intentionally permits rename sharing.
  /// </summary>
  public ValidatedPathHandle OpenExistingForAtomicTreeCommit(
    ResolvedHostPath resolved,
    bool? requireDirectory = null,
    bool readData = false,
    bool deleteAccess = false)
  {
    var root = _roots[resolved.RootId];
    EnsureExistingSegmentsAreSafe(root.Path, resolved.FullPath);
    return OpenAndValidateAbsolute(
      resolved.FullPath,
      root.Path,
      root.VolumeSerialNumber,
      requireDirectory,
      lockAgainstRename: false,
      readData,
      deleteAccess,
      lockAgainstWrite: true);
  }

  public ValidatedPathHandle OpenRecoveryEntry(
    ResolvedHostPath governedTarget,
    string recoveryPath,
    bool? requireDirectory = null,
    bool deleteAccess = false,
    bool readData = false,
    bool lockAgainstMutation = false)
  {
    var root = _roots[governedTarget.RootId];
    var normalized = Path.GetFullPath(recoveryPath);
    if (!IsEqualOrDescendant(normalized, root.QuarantinePath))
    {
      throw new HostPolicyException("recovery_path_outside_quarantine");
    }

    EnsureExistingSegmentsAreSafe(root.QuarantinePath, normalized);
    return OpenAndValidateAbsolute(
      normalized,
      root.QuarantinePath,
      root.VolumeSerialNumber,
      requireDirectory,
      lockAgainstRename: true,
      readData,
      deleteAccess,
      listDirectory: requireDirectory is true,
      lockAgainstWrite: lockAgainstMutation);
  }

  public static void RenameExact(
    ValidatedPathHandle source,
    ValidatedPathHandle destinationParent,
    string destinationName)
  {
    if (!destinationParent.IsDirectory
      || destinationName.Contains(Path.DirectorySeparatorChar)
      || destinationName.Contains(Path.AltDirectorySeparatorChar))
    {
      throw new HostPolicyException("rename_destination_invalid");
    }
    ValidateSegment(destinationName);

    // SetFileInformationByHandle does not reliably honor RootDirectory for a
    // rename on supported Windows builds. Keep the validated parent handle open
    // without FILE_SHARE_DELETE across the call instead: the absolute name can
    // only resolve to that same locked directory, while the destination leaf is
    // created atomically with ReplaceIfExists=false.
    EnsureHandleStillNames(destinationParent, destinationParent.FinalPath);
    var destination = Path.Combine(destinationParent.FinalPath, destinationName);
    var nameBytes = Encoding.Unicode.GetBytes(destination);
    var rootOffset = IntPtr.Size == 8 ? 8 : 4;
    var lengthOffset = checked(rootOffset + IntPtr.Size);
    var nameOffset = checked(lengthOffset + sizeof(uint));
    // FILE_RENAME_INFO has WCHAR FileName[1] plus native tail padding. Windows
    // validates the full native structure size even though FileNameLength does
    // not include a terminator.
    var bufferLength = checked(nameOffset + nameBytes.Length + sizeof(uint));
    var buffer = Marshal.AllocHGlobal(bufferLength);
    try
    {
      for (var offset = 0; offset < bufferLength; offset++)
      {
        Marshal.WriteByte(buffer, offset, 0);
      }

      Marshal.WriteInt32(buffer, 0, 0);
      Marshal.WriteIntPtr(buffer, rootOffset, IntPtr.Zero);
      Marshal.WriteInt32(buffer, lengthOffset, nameBytes.Length);
      Marshal.Copy(nameBytes, 0, IntPtr.Add(buffer, nameOffset), nameBytes.Length);
      if (!NativeMethods.SetFileInformationByHandle(
        source.Handle,
        NativeMethods.FileRenameInfoClass,
        buffer,
        checked((uint)bufferLength)))
      {
        throw new HostPolicyException(
          "handle_rename_failed",
          new Win32Exception(Marshal.GetLastWin32Error()));
      }
    }
    finally
    {
      Marshal.FreeHGlobal(buffer);
    }
  }

  public static void DeleteExact(ValidatedPathHandle target)
  {
    var disposition = new NativeMethods.FileDispositionInfoEx
    {
      Flags = NativeMethods.FileDispositionFlagDelete
        | NativeMethods.FileDispositionFlagPosixSemantics
        | NativeMethods.FileDispositionFlagIgnoreReadonly,
    };
    if (!NativeMethods.SetFileInformationByHandle(
      target.Handle,
      NativeMethods.FileDispositionInfoExClass,
      ref disposition,
      checked((uint)Marshal.SizeOf<NativeMethods.FileDispositionInfoEx>())))
    {
      throw new HostPolicyException(
        "handle_delete_failed",
        new Win32Exception(Marshal.GetLastWin32Error()));
    }
  }

  public static void CreateDirectoryNoOverwrite(
    ValidatedPathHandle parent,
    string destinationName)
  {
    if (!parent.IsDirectory
      || destinationName.Contains(Path.DirectorySeparatorChar)
      || destinationName.Contains(Path.AltDirectorySeparatorChar))
    {
      throw new HostPolicyException("directory_destination_invalid");
    }
    ValidateSegment(destinationName);
    EnsureHandleStillNames(parent, parent.FinalPath);
    var destination = Path.Combine(parent.FinalPath, destinationName);
    if (!NativeMethods.CreateDirectory(destination, IntPtr.Zero))
    {
      var error = Marshal.GetLastWin32Error();
      throw error == NativeMethods.ErrorAlreadyExists
        ? new HostPreconditionException("target_changed_before_create")
        : new HostPolicyException(
          "directory_create_failed",
          new Win32Exception(error));
    }
  }

  public ValidatedPathHandle OpenParentForCreate(ResolvedHostPath resolved)
  {
    if (resolved.RelativePath.Length == 0)
    {
      throw new HostPolicyException("root_mutation_forbidden");
    }

    var parent = Path.GetDirectoryName(resolved.FullPath)
      ?? throw new HostPolicyException("parent_path_invalid");
    var root = _roots[resolved.RootId];
    EnsureExistingSegmentsAreSafe(root.Path, parent);
    return OpenAndValidateAbsolute(
      parent,
      root.Path,
      root.VolumeSerialNumber,
      requireDirectory: true,
      lockAgainstRename: true,
      listDirectory: true);
  }

  public string CreateRecoveryDirectory(ResolvedHostPath resolved, string actionId)
  {
    var root = _roots[resolved.RootId];
    if (string.IsNullOrWhiteSpace(actionId) || actionId.Length > 512)
    {
      throw new HostPolicyException("action_id_invalid_for_recovery");
    }

    Directory.CreateDirectory(root.QuarantinePath);
    using (var quarantineHandle = OpenAndValidateAbsolute(
      root.QuarantinePath,
      expectedRoot: null,
      expectedVolume: root.VolumeSerialNumber,
      requireDirectory: true,
      lockAgainstRename: true))
    {
      if (quarantineHandle.VolumeSerialNumber != root.VolumeSerialNumber)
      {
        throw new HostPolicyException("quarantine_volume_changed");
      }

      if (!string.Equals(
        Path.TrimEndingDirectorySeparator(quarantineHandle.FinalPath),
        root.QuarantinePath,
        StringComparison.OrdinalIgnoreCase))
      {
        throw new HostPolicyException("quarantine_path_redirected");
      }
    }

    var actionDirectory = Path.Combine(root.QuarantinePath, PayloadDigest.Sha256Hex(actionId));
    Directory.CreateDirectory(actionDirectory);
    using var actionHandle = OpenAndValidateAbsolute(
      actionDirectory,
      root.QuarantinePath,
      root.VolumeSerialNumber,
      requireDirectory: true,
      lockAgainstRename: true);
    return actionHandle.FinalPath;
  }

  public static string NormalizeRelativePath(string relativePath, bool allowRoot = false)
  {
    if (relativePath is null
      || relativePath.Contains('\0')
      || relativePath.StartsWith('\\')
      || relativePath.StartsWith('/')
      || relativePath.StartsWith("//", StringComparison.Ordinal)
      || relativePath.StartsWith(@"\\?\", StringComparison.Ordinal)
      || relativePath.StartsWith(@"\\.\", StringComparison.Ordinal)
      || relativePath.StartsWith(@"\??\", StringComparison.OrdinalIgnoreCase)
      || Path.IsPathRooted(relativePath))
    {
      throw new HostPolicyException("path_must_be_relative");
    }

    var normalizedSeparators = relativePath.Replace('/', '\\');
    if (normalizedSeparators.Length == 0)
    {
      return allowRoot ? string.Empty : throw new HostPolicyException("path_empty");
    }

    var segments = normalizedSeparators.Split('\\', StringSplitOptions.None);
    foreach (var segment in segments)
    {
      ValidateSegment(segment);
    }

    return string.Join(Path.DirectorySeparatorChar, segments);
  }

  public static void ValidateSearchPattern(string pattern)
  {
    if (string.IsNullOrWhiteSpace(pattern)
      || pattern.Length > 128
      || pattern.Contains('\\', StringComparison.Ordinal)
      || pattern.Contains('/', StringComparison.Ordinal)
      || pattern.Contains(':', StringComparison.Ordinal)
      || pattern.Contains('\0')
      || pattern.EndsWith(' ')
      || pattern.EndsWith('.'))
    {
      throw new HostPolicyException("search_pattern_invalid");
    }

    foreach (var character in pattern)
    {
      if (character is '"' or '<' or '>' or '|')
      {
        throw new HostPolicyException("search_pattern_invalid");
      }
    }
  }

  public static bool IsEqualOrDescendant(string candidate, string root)
  {
    var normalizedCandidate = Path.TrimEndingDirectorySeparator(Path.GetFullPath(candidate));
    var normalizedRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
    var rootPrefix = Path.EndsInDirectorySeparator(normalizedRoot)
      ? normalizedRoot
      : normalizedRoot + Path.DirectorySeparatorChar;
    return string.Equals(normalizedCandidate, normalizedRoot, StringComparison.OrdinalIgnoreCase)
      || normalizedCandidate.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase);
  }

  public static void EnsureHandleStillNames(ValidatedPathHandle handle, string expectedPath)
  {
    var current = GetFinalPath(handle.Handle);
    if (!string.Equals(
      Path.TrimEndingDirectorySeparator(current),
      Path.TrimEndingDirectorySeparator(Path.GetFullPath(expectedPath)),
      StringComparison.OrdinalIgnoreCase))
    {
      throw new HostPolicyException("path_handle_moved");
    }
  }

  private static ValidatedPathHandle OpenAndValidateAbsolute(
    string path,
    string? expectedRoot,
    uint? expectedVolume,
    bool? requireDirectory,
    bool lockAgainstRename,
    bool readData = false,
    bool deleteAccess = false,
    bool listDirectory = false,
    bool readSecurityAccess = false,
    bool writeDacAccess = false,
    bool lockAgainstWrite = false,
    bool allowHardLinks = false)
  {
    var share = NativeMethods.FileShareRead;
    if (!lockAgainstWrite)
    {
      share |= NativeMethods.FileShareWrite;
    }
    if (!lockAgainstRename)
    {
      share |= NativeMethods.FileShareDelete;
    }

    var handle = NativeMethods.CreateFile(
      path,
      (readData ? NativeMethods.GenericRead : NativeMethods.FileReadAttributes)
        | (deleteAccess ? NativeMethods.DeleteAccess : 0)
        | (listDirectory ? NativeMethods.FileListDirectory : 0)
        | (readSecurityAccess ? NativeMethods.ReadControl : 0)
        | (writeDacAccess ? NativeMethods.WriteDac : 0),
      share,
      IntPtr.Zero,
      NativeMethods.OpenExisting,
      NativeMethods.FileFlagBackupSemantics | NativeMethods.FileFlagOpenReparsePoint,
      IntPtr.Zero);
    if (handle.IsInvalid)
    {
      var error = Marshal.GetLastWin32Error();
      handle.Dispose();
      throw new HostPolicyException("path_open_failed", new Win32Exception(error));
    }

    try
    {
      if (!NativeMethods.GetFileInformationByHandle(handle, out var information))
      {
        throw new HostPolicyException(
          "path_information_failed",
          new Win32Exception(Marshal.GetLastWin32Error()));
      }

      var isDirectory = (information.FileAttributes & NativeMethods.FileAttributeDirectory) != 0;
      if ((information.FileAttributes & NativeMethods.FileAttributeReparsePoint) != 0)
      {
        throw new HostPolicyException("reparse_point_forbidden");
      }

      if (requireDirectory.HasValue && requireDirectory.Value != isDirectory)
      {
        throw new HostPolicyException(
          requireDirectory.Value ? "directory_required" : "file_required");
      }

      if (!isDirectory && information.NumberOfLinks > 1 && !allowHardLinks)
      {
        throw new HostPolicyException("hard_link_forbidden");
      }

      var finalPath = GetFinalPath(handle);
      if (finalPath.StartsWith(@"\\", StringComparison.Ordinal)
        || finalPath.StartsWith(@"\Device\", StringComparison.OrdinalIgnoreCase))
      {
        throw new HostPolicyException("device_or_unc_path_forbidden");
      }

      if (expectedRoot is not null && !IsEqualOrDescendant(finalPath, expectedRoot))
      {
        throw new HostPolicyException("resolved_path_escaped_root");
      }

      if (expectedVolume.HasValue
        && information.VolumeSerialNumber != expectedVolume.Value)
      {
        throw new HostPolicyException("volume_changed");
      }

      var fileId = ((ulong)information.FileIndexHigh << 32) | information.FileIndexLow;
      return new ValidatedPathHandle(
        handle,
        finalPath,
        information.VolumeSerialNumber,
        fileId,
        information.NumberOfLinks,
        isDirectory);
    }
    catch
    {
      handle.Dispose();
      throw;
    }
  }

  private static string GetFinalPath(SafeFileHandle handle)
  {
    var capacity = 512;
    while (capacity <= 32_768)
    {
      var buffer = new char[capacity];
      uint length;
      unsafe
      {
        fixed (char* pointer = buffer)
        {
          length = NativeMethods.GetFinalPathNameByHandle(
            handle,
            pointer,
            (uint)buffer.Length,
            0);
        }
      }
      if (length == 0)
      {
        throw new HostPolicyException(
          "final_path_failed",
          new Win32Exception(Marshal.GetLastWin32Error()));
      }

      if (length < buffer.Length)
      {
        var result = new string(buffer, 0, checked((int)length));
        return result.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)
          ? @"\\" + result[8..]
          : result.StartsWith(@"\\?\", StringComparison.Ordinal)
            ? result[4..]
            : result;
      }

      capacity = checked((int)length + 1);
    }

    throw new HostPolicyException("final_path_too_long");
  }

  private static void EnsureExistingSegmentsAreSafe(string root, string target)
  {
    var relative = Path.GetRelativePath(root, target);
    var current = root;
    foreach (var segment in relative.Split(
      Path.DirectorySeparatorChar,
      StringSplitOptions.RemoveEmptyEntries))
    {
      current = Path.Combine(current, segment);
      if (!File.Exists(current) && !Directory.Exists(current))
      {
        throw new HostPolicyException("path_not_found");
      }

      var attributes = File.GetAttributes(current);
      if ((attributes & FileAttributes.ReparsePoint) != 0)
      {
        throw new HostPolicyException("reparse_point_forbidden");
      }
    }
  }

  private static void ValidateSegment(string segment)
  {
    if (segment.Length == 0
      || segment is "." or ".."
      || segment.Length > 255
      || segment.EndsWith(' ')
      || segment.EndsWith('.')
      || segment.Contains(':', StringComparison.Ordinal)
      || segment.Contains('\0'))
    {
      throw new HostPolicyException("path_segment_invalid");
    }

    foreach (var character in segment)
    {
      if (character < 32 || character is '"' or '<' or '>' or '|' or '*' or '?')
      {
        throw new HostPolicyException("path_segment_invalid");
      }
    }

    var deviceCandidate = segment.Split('.', 2)[0];
    if (ReservedDeviceNames.Contains(deviceCandidate))
    {
      throw new HostPolicyException("reserved_device_name_forbidden");
    }
  }

  internal static List<string> BuildProtectedPaths(
    HostCapabilityOptions host,
    CompanionOptions companion,
    BrokerChannelOptions? broker)
  {
    var killSwitch = NormalizeAbsoluteSupervisorPath(companion.KillSwitchPath, "kill switch");
    List<string> paths =
    [
      Path.GetDirectoryName(killSwitch) ?? killSwitch,
      NormalizeAbsoluteSupervisorPath(companion.JournalPath, "journal"),
      NormalizeAbsoluteSupervisorPath(companion.ResultCachePath, "result cache"),
      NormalizeAbsoluteSupervisorPath(
        companion.EgressReceiptReplayPath,
        "egress receipt replay journal"),
      NormalizeAbsoluteSupervisorPath(host.RecoveryVaultPath, "recovery vault"),
      NormalizeAbsoluteSupervisorPath(host.SecretVaultPath, "secret vault"),
    ];
    if (broker is not null && !string.IsNullOrWhiteSpace(broker.DeviceIdentityRecordPath))
    {
      paths.Add(NormalizeAbsoluteSupervisorPath(
        broker.DeviceIdentityRecordPath,
        "device identity record"));
    }
    return paths;
  }

  private static string NormalizeAbsoluteSupervisorPath(string path, string description)
  {
    if (string.IsNullOrWhiteSpace(path))
    {
      throw new InvalidOperationException($"The {description} path is required.");
    }

    var expanded = Environment.ExpandEnvironmentVariables(path);
    if (!Path.IsPathFullyQualified(expanded)
      || expanded.StartsWith(@"\\", StringComparison.Ordinal)
      || expanded.StartsWith(@"\\?\", StringComparison.Ordinal)
      || expanded.StartsWith(@"\\.\", StringComparison.Ordinal)
      || expanded.StartsWith(@"\??\", StringComparison.OrdinalIgnoreCase))
    {
      throw new InvalidOperationException($"The {description} path must be a local DOS path.");
    }

    return Path.TrimEndingDirectorySeparator(Path.GetFullPath(expanded));
  }

  private static HashSet<string> BuildReservedNames()
  {
    var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
      "CON",
      "PRN",
      "AUX",
      "NUL",
    };
    for (var index = 1; index <= 9; index++)
    {
      names.Add($"COM{index}");
      names.Add($"LPT{index}");
    }

    return names;
  }

  private sealed record RootPolicy(
    string Id,
    string Path,
    string QuarantinePath,
    bool AllowRead,
    bool AllowWrite,
    bool AllowDelete,
    uint VolumeSerialNumber);

  private static partial class NativeMethods
  {
    public const uint FileReadAttributes = 0x0080;
    public const uint FileListDirectory = 0x0001;
    public const uint GenericRead = 0x80000000;
    public const uint DeleteAccess = 0x00010000;
    public const uint ReadControl = 0x00020000;
    public const uint WriteDac = 0x00040000;
    public const uint FileShareRead = 0x00000001;
    public const uint FileShareWrite = 0x00000002;
    public const uint FileShareDelete = 0x00000004;
    public const uint OpenExisting = 3;
    public const uint FileFlagOpenReparsePoint = 0x00200000;
    public const uint FileFlagBackupSemantics = 0x02000000;
    public const uint FileAttributeDirectory = 0x00000010;
    public const uint FileAttributeReparsePoint = 0x00000400;
    public const int FileDispositionInfoExClass = 21;
    public const int FileRenameInfoClass = 3;
    public const uint FileDispositionFlagDelete = 0x00000001;
    public const uint FileDispositionFlagPosixSemantics = 0x00000002;
    public const uint FileDispositionFlagIgnoreReadonly = 0x00000010;
    public const int ErrorAlreadyExists = 183;

    [LibraryImport("kernel32.dll", EntryPoint = "CreateDirectoryW", SetLastError = true,
      StringMarshalling = StringMarshalling.Utf16)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool CreateDirectory(
      string path,
      IntPtr securityAttributes);

    [LibraryImport("kernel32.dll", EntryPoint = "CreateFileW", SetLastError = true,
      StringMarshalling = StringMarshalling.Utf16)]
    public static partial SafeFileHandle CreateFile(
      string fileName,
      uint desiredAccess,
      uint shareMode,
      IntPtr securityAttributes,
      uint creationDisposition,
      uint flagsAndAttributes,
      IntPtr templateFile);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool GetFileInformationByHandle(
      SafeFileHandle file,
      out ByHandleFileInformation fileInformation);

    [LibraryImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW",
      SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    public static unsafe partial uint GetFinalPathNameByHandle(
      SafeFileHandle file,
      char* filePath,
      uint filePathLength,
      uint flags);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool SetFileInformationByHandle(
      SafeFileHandle file,
      int fileInformationClass,
      IntPtr fileInformation,
      uint bufferSize);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool SetFileInformationByHandle(
      SafeFileHandle file,
      int fileInformationClass,
      ref FileDispositionInfoEx fileInformation,
      uint bufferSize);

    [StructLayout(LayoutKind.Sequential)]
    public struct ByHandleFileInformation
    {
      public uint FileAttributes;
      public uint CreationTimeLow;
      public uint CreationTimeHigh;
      public uint LastAccessTimeLow;
      public uint LastAccessTimeHigh;
      public uint LastWriteTimeLow;
      public uint LastWriteTimeHigh;
      public uint VolumeSerialNumber;
      public uint FileSizeHigh;
      public uint FileSizeLow;
      public uint NumberOfLinks;
      public uint FileIndexHigh;
      public uint FileIndexLow;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct FileDispositionInfoEx
    {
      public uint Flags;
    }
  }
}

public sealed class HostPolicyException : Exception
{
  public HostPolicyException(string errorCode, Exception? innerException = null)
    : base(errorCode, innerException)
  {
    ErrorCode = errorCode;
  }

  public string ErrorCode { get; }
}

public sealed class HostPreconditionException : Exception
{
  public HostPreconditionException(string errorCode, Exception? innerException = null)
    : base(errorCode, innerException)
  {
    ErrorCode = errorCode;
  }

  public string ErrorCode { get; }
}
