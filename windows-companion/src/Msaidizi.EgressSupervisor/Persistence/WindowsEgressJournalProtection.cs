using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.EgressSupervisor.Persistence;

/// <summary>
/// Verifies the installer-owned NTFS journal boundary before and after opening
/// it. The handle checks close the path-swap, reparse-point, and hard-link gap;
/// the exact ACL keeps the companion and ordinary administrators from writing
/// supervisor evidence.
/// </summary>
public sealed partial class WindowsEgressJournalProtection : IEgressJournalProtection
{
  private const string RecoveryOperatorsGroup =
    "Itemba Msaidizi Recovery Operators";
  private const uint FileAttributeDirectory = 0x00000010;
  private const uint FileAttributeReparsePoint = 0x00000400;
  private readonly string _journalPath;
  private readonly string _lockPath;
  private readonly DirectorySecurity _expectedDirectory;
  private readonly FileSecurity _expectedFile;

  public WindowsEgressJournalProtection(EgressSupervisorOptions options)
  {
    ArgumentNullException.ThrowIfNull(options);
    if (!OperatingSystem.IsWindows()
      || string.IsNullOrWhiteSpace(options.JournalPath)
      || !Path.IsPathFullyQualified(options.JournalPath))
    {
      throw new InvalidOperationException(
        "The protected egress journal enrollment is invalid.");
    }

    _journalPath = Path.GetFullPath(options.JournalPath);
    _lockPath = _journalPath + ".lock";
    var systemSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
    var serviceSid = Resolve(new NTAccount(
      "NT SERVICE",
      options.SupervisorServiceName));
    var recoveryOperatorsSid = Resolve(new NTAccount(RecoveryOperatorsGroup));
    _expectedDirectory = BuildDirectorySecurity(
      systemSid,
      serviceSid,
      recoveryOperatorsSid);
    _expectedFile = BuildFileSecurity(
      systemSid,
      serviceSid,
      recoveryOperatorsSid);
  }

  public void ValidatePreOpen(
    string directory,
    string journalPath,
    string lockPath)
  {
    RequireExactPaths(directory, journalPath, lockPath);
    var volumeRoot = Path.GetPathRoot(directory);
    if (string.IsNullOrWhiteSpace(volumeRoot)
      || !string.Equals(
        new DriveInfo(volumeRoot).DriveFormat,
        "NTFS",
        StringComparison.OrdinalIgnoreCase))
    {
      throw new UnauthorizedAccessException(
        "The protected egress journal requires NTFS.");
    }

    RequireExact(
      new DirectoryInfo(directory).GetAccessControl(
        AccessControlSections.Owner | AccessControlSections.Access),
      _expectedDirectory,
      "directory");
    RequireExact(
      new FileInfo(journalPath).GetAccessControl(
        AccessControlSections.Owner | AccessControlSections.Access),
      _expectedFile,
      "journal");
    RequireExact(
      new FileInfo(lockPath).GetAccessControl(
        AccessControlSections.Owner | AccessControlSections.Access),
      _expectedFile,
      "ownership lock");
  }

  public void ValidateOpened(FileStream journal, FileStream ownershipLock)
  {
    ArgumentNullException.ThrowIfNull(journal);
    ArgumentNullException.ThrowIfNull(ownershipLock);
    ValidateFileIdentity(journal.SafeFileHandle, _journalPath, "journal");
    ValidateFileIdentity(ownershipLock.SafeFileHandle, _lockPath, "ownership lock");
    RequireExact(journal.GetAccessControl(), _expectedFile, "journal handle");
    RequireExact(ownershipLock.GetAccessControl(), _expectedFile, "ownership lock handle");
  }

  private void RequireExactPaths(
    string directory,
    string journalPath,
    string lockPath)
  {
    var expectedDirectory = Path.GetDirectoryName(_journalPath)
      ?? throw new InvalidOperationException("The protected journal has no parent.");
    if (!string.Equals(
        Path.GetFullPath(directory),
        expectedDirectory,
        StringComparison.OrdinalIgnoreCase)
      || !string.Equals(
        Path.GetFullPath(journalPath),
        _journalPath,
        StringComparison.OrdinalIgnoreCase)
      || !string.Equals(
        Path.GetFullPath(lockPath),
        _lockPath,
        StringComparison.OrdinalIgnoreCase))
    {
      throw new UnauthorizedAccessException(
        "The protected egress journal path changed before open.");
    }
  }

  private static DirectorySecurity BuildDirectorySecurity(
    SecurityIdentifier systemSid,
    SecurityIdentifier serviceSid,
    SecurityIdentifier recoveryOperatorsSid)
  {
    var security = new DirectorySecurity();
    security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
    security.SetOwner(systemSid);
    AddDirectoryGrant(security, systemSid, FileSystemRights.FullControl);
    AddDirectoryGrant(security, serviceSid, FileSystemRights.Modify);
    AddDirectoryGrant(security, recoveryOperatorsSid, FileSystemRights.ReadAndExecute);
    return security;
  }

  private static FileSecurity BuildFileSecurity(
    SecurityIdentifier systemSid,
    SecurityIdentifier serviceSid,
    SecurityIdentifier recoveryOperatorsSid)
  {
    var security = new FileSecurity();
    security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
    security.SetOwner(systemSid);
    security.AddAccessRule(new FileSystemAccessRule(
      systemSid,
      FileSystemRights.FullControl,
      AccessControlType.Allow));
    security.AddAccessRule(new FileSystemAccessRule(
      serviceSid,
      FileSystemRights.Modify,
      AccessControlType.Allow));
    security.AddAccessRule(new FileSystemAccessRule(
      recoveryOperatorsSid,
      FileSystemRights.ReadAndExecute,
      AccessControlType.Allow));
    return security;
  }

  private static void AddDirectoryGrant(
    DirectorySecurity security,
    SecurityIdentifier sid,
    FileSystemRights rights) => security.AddAccessRule(new FileSystemAccessRule(
      sid,
      rights,
      InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
      PropagationFlags.None,
      AccessControlType.Allow));

  private static void RequireExact(
    FileSystemSecurity actual,
    ObjectSecurity expected,
    string description)
  {
    var actualRaw = new RawSecurityDescriptor(
      actual.GetSecurityDescriptorBinaryForm(),
      0);
    var expectedRaw = new RawSecurityDescriptor(
      expected.GetSecurityDescriptorBinaryForm(),
      0);
    if (actualRaw.Owner is null
      || expectedRaw.Owner is null
      || !actualRaw.Owner.Equals(expectedRaw.Owner)
      || !actualRaw.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclProtected)
      || actualRaw.DiscretionaryAcl is null
      || expectedRaw.DiscretionaryAcl is null
      || !string.Equals(
        actualRaw.GetSddlForm(AccessControlSections.Access),
        expectedRaw.GetSddlForm(AccessControlSections.Access),
        StringComparison.Ordinal))
    {
      throw new UnauthorizedAccessException(
        $"The protected egress {description} has unexpected ACL state.");
    }
  }

  private static void ValidateFileIdentity(
    SafeFileHandle handle,
    string expectedPath,
    string description)
  {
    if (!GetFileInformationByHandle(handle, out var information))
    {
      throw new IOException(
        $"The protected egress {description} identity is unavailable.",
        new Win32Exception(Marshal.GetLastWin32Error()));
    }
    if ((information.FileAttributes & FileAttributeReparsePoint) != 0
      || (information.FileAttributes & FileAttributeDirectory) != 0
      || information.NumberOfLinks != 1)
    {
      throw new UnauthorizedAccessException(
        $"The protected egress {description} is indirect or hard-linked.");
    }

    var actualPath = GetFinalPath(handle);
    if (!string.Equals(
      Path.TrimEndingDirectorySeparator(actualPath),
      Path.TrimEndingDirectorySeparator(Path.GetFullPath(expectedPath)),
      StringComparison.OrdinalIgnoreCase))
    {
      throw new UnauthorizedAccessException(
        $"The protected egress {description} resolved to an unexpected path.");
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
          length = GetFinalPathNameByHandle(
            handle,
            pointer,
            checked((uint)buffer.Length),
            0);
        }
      }
      if (length == 0)
      {
        throw new IOException(
          "The protected egress file final path is unavailable.",
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
    throw new IOException("The protected egress file final path is too long.");
  }

  private static SecurityIdentifier Resolve(NTAccount account) =>
    (SecurityIdentifier)account.Translate(typeof(SecurityIdentifier));

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetFileInformationByHandle(
    SafeFileHandle file,
    out FileInformation fileInformation);

  [LibraryImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW",
    SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
  private static unsafe partial uint GetFinalPathNameByHandle(
    SafeFileHandle file,
    char* filePath,
    uint filePathLength,
    uint flags);

  [StructLayout(LayoutKind.Sequential)]
  private struct FileInformation
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
}
