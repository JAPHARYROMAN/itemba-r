using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Installer.Hardening;

internal sealed class LockedInstallerPath : IDisposable
{
  private const uint OwnerSecurityInformation = 0x00000001;
  private const uint GroupSecurityInformation = 0x00000002;
  private const uint DaclSecurityInformation = 0x00000004;
  private const uint ProtectedDaclSecurityInformation = 0x80000000;
  private const int ErrorInsufficientBuffer = 122;
  private const int MaximumSecurityDescriptorBytes = 1_048_576;

  private readonly SafeFileHandle _handle;

  internal LockedInstallerPath(
    SafeFileHandle handle,
    string path,
    bool isDirectory,
    uint numberOfLinks)
  {
    _handle = handle;
    Path = path;
    IsDirectory = isDirectory;
    NumberOfLinks = numberOfLinks;
  }

  public string Path { get; }

  public bool IsDirectory { get; }

  public uint NumberOfLinks { get; }

  public RawSecurityDescriptor ReadSecurityDescriptor()
  {
    var information = OwnerSecurityInformation
      | GroupSecurityInformation
      | DaclSecurityInformation;
    _ = NativeMethods.GetKernelObjectSecurity(
      _handle,
      information,
      null,
      0,
      out var required);
    var error = Marshal.GetLastWin32Error();
    if (required == 0
      || required > MaximumSecurityDescriptorBytes
      || error != ErrorInsufficientBuffer)
    {
      throw NativeFailure("Could not size a protected path security descriptor.", error);
    }

    var binary = new byte[required];
    if (!NativeMethods.GetKernelObjectSecurity(
      _handle,
      information,
      binary,
      checked((uint)binary.Length),
      out var actual)
      || actual == 0
      || actual > binary.Length)
    {
      throw NativeFailure(
        "Could not read a protected path security descriptor.",
        Marshal.GetLastWin32Error());
    }

    var descriptor = new RawSecurityDescriptor(binary, 0);
    if (descriptor.Owner is null
      || descriptor.DiscretionaryAcl is null
      || !descriptor.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclPresent))
    {
      throw new SecurityException("Installer-owned paths require an owner and a non-null DACL.");
    }
    return descriptor;
  }

  public void SetSecurityDescriptor(ObjectSecurity security)
  {
    var binary = security.GetSecurityDescriptorBinaryForm();
    var information = OwnerSecurityInformation
      | DaclSecurityInformation
      | ProtectedDaclSecurityInformation;
    if (!NativeMethods.SetKernelObjectSecurity(_handle, information, binary))
    {
      throw NativeFailure(
        "Could not apply handle-bound installer path security.",
        Marshal.GetLastWin32Error());
    }
  }

  public byte[] ReadAllBytes(int maximumBytes)
  {
    if (IsDirectory)
      throw new InvalidOperationException("A directory handle cannot be read as a file.");

    var length = RandomAccess.GetLength(_handle);
    if (length < 0 || length > maximumBytes)
      throw new InvalidDataException("A protected installer file exceeds its size limit.");

    var bytes = new byte[checked((int)length)];
    var offset = 0;
    while (offset < bytes.Length)
    {
      var read = RandomAccess.Read(_handle, bytes.AsSpan(offset), offset);
      if (read == 0)
        throw new EndOfStreamException("A protected installer file changed while it was read.");
      offset += read;
    }
    if (RandomAccess.GetLength(_handle) != length)
      throw new IOException("A protected installer file changed length while it was read.");
    return bytes;
  }

  public void Dispose() => _handle.Dispose();

  private static Win32Exception NativeFailure(string message, int nativeError) =>
    new(nativeError, message);

  private static class NativeMethods
  {
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetKernelObjectSecurity(
      SafeFileHandle handle,
      uint requestedInformation,
      [Out] byte[]? securityDescriptor,
      uint length,
      out uint lengthNeeded);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetKernelObjectSecurity(
      SafeFileHandle handle,
      uint securityInformation,
      byte[] securityDescriptor);
  }
}

internal static class HandleBoundPathSecurity
{
  private const uint FileReadAttributes = 0x00000080;
  private const uint FileReadData = 0x00000001;
  private const uint ReadControl = 0x00020000;
  private const uint WriteDac = 0x00040000;
  private const uint WriteOwner = 0x00080000;
  private const uint OpenExisting = 3;
  private const uint FileFlagOpenReparsePoint = 0x00200000;
  private const uint FileFlagBackupSemantics = 0x02000000;
  private const int ErrorAlreadyExists = 183;
  private const int ErrorFileExists = 80;
  private const int MaximumFinalPathCharacters = 32_768;

  private static readonly SecurityIdentifier SystemSid =
    new(WellKnownSidType.LocalSystemSid, null);
  private static readonly SecurityIdentifier AdministratorsSid =
    new(WellKnownSidType.BuiltinAdministratorsSid, null);

  public static LockedInstallerPath OpenDirectory(string path) =>
    Open(path, expectDirectory: true, requireSingleLink: false);

  public static LockedInstallerPath OpenSingleLinkFile(string path) =>
    Open(path, expectDirectory: false, requireSingleLink: true);

  public static void CreateDirectoryAtomically(string path, DirectorySecurity security)
  {
    var binary = security.GetSecurityDescriptorBinaryForm();
    var pin = GCHandle.Alloc(binary, GCHandleType.Pinned);
    try
    {
      var attributes = new SecurityAttributes
      {
        Length = checked((uint)Marshal.SizeOf<SecurityAttributes>()),
        SecurityDescriptor = pin.AddrOfPinnedObject(),
        InheritHandle = false,
      };
      if (NativeMethods.CreateDirectory(path, ref attributes))
        return;

      var error = Marshal.GetLastWin32Error();
      if (error is not (ErrorAlreadyExists or ErrorFileExists))
        throw new Win32Exception(error, "Could not atomically create an installer-owned directory.");
    }
    finally
    {
      pin.Free();
    }
  }

  public static bool HasTrustedBootstrapOwner(RawSecurityDescriptor descriptor) =>
    descriptor.Owner is not null
    && (descriptor.Owner.Equals(SystemSid) || descriptor.Owner.Equals(AdministratorsSid));

  public static bool HasExactSecurity(
    RawSecurityDescriptor actual,
    ObjectSecurity expected)
  {
    var expectedBinary = expected.GetSecurityDescriptorBinaryForm();
    var expectedDescriptor = new RawSecurityDescriptor(expectedBinary, 0);
    return actual.Owner is not null
      && expectedDescriptor.Owner is not null
      && actual.Owner.Equals(expectedDescriptor.Owner)
      && actual.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclProtected)
      && expectedDescriptor.DiscretionaryAcl is not null
      && actual.DiscretionaryAcl is not null
      && string.Equals(
        actual.GetSddlForm(AccessControlSections.Access),
        expectedDescriptor.GetSddlForm(AccessControlSections.Access),
        StringComparison.Ordinal);
  }

  public static bool HasUntrustedDeleteChild(RawSecurityDescriptor descriptor)
  {
    if (descriptor.DiscretionaryAcl is null)
      return true;

    const int dangerous = (int)(
      FileSystemRights.DeleteSubdirectoriesAndFiles
      | FileSystemRights.Delete
      | FileSystemRights.ChangePermissions
      | FileSystemRights.TakeOwnership);
    foreach (var ace in descriptor.DiscretionaryAcl.OfType<CommonAce>())
    {
      if (ace.AceQualifier != AceQualifier.AccessAllowed
        || (ace.AccessMask & dangerous) == 0
        || ace.SecurityIdentifier.Equals(SystemSid)
        || ace.SecurityIdentifier.Equals(AdministratorsSid)
        || ace.AceFlags.HasFlag(AceFlags.InheritOnly))
      {
        continue;
      }
      return true;
    }
    return false;
  }

  public static bool HasUntrustedMutationAuthority(RawSecurityDescriptor descriptor)
  {
    if (descriptor.DiscretionaryAcl is null)
      return true;

    const int genericAll = 0x10000000;
    const int genericWrite = 0x40000000;
    const int dangerous = (int)(
      FileSystemRights.Write
      | FileSystemRights.DeleteSubdirectoriesAndFiles
      | FileSystemRights.Delete
      | FileSystemRights.ChangePermissions
      | FileSystemRights.TakeOwnership)
      | genericAll
      | genericWrite;
    foreach (var ace in descriptor.DiscretionaryAcl.OfType<CommonAce>())
    {
      if (ace.AceQualifier != AceQualifier.AccessAllowed
        || (ace.AccessMask & dangerous) == 0
        || ace.SecurityIdentifier.Equals(SystemSid)
        || ace.SecurityIdentifier.Equals(AdministratorsSid))
      {
        continue;
      }

      // Inherit-only write grants are still unsafe here: the installer is
      // about to create security-critical children beneath this directory.
      return true;
    }
    return false;
  }

  private static LockedInstallerPath Open(
    string path,
    bool expectDirectory,
    bool requireSingleLink)
  {
    var expected = Normalize(path);
    var handle = NativeMethods.CreateFile(
      expected,
      FileReadData | FileReadAttributes | ReadControl | WriteDac | WriteOwner,
      expectDirectory ? FileShare.Read | FileShare.Write : FileShare.Read,
      IntPtr.Zero,
      OpenExisting,
      FileFlagOpenReparsePoint | FileFlagBackupSemantics,
      IntPtr.Zero);
    if (handle.IsInvalid)
    {
      var error = Marshal.GetLastWin32Error();
      handle.Dispose();
      throw new Win32Exception(error, "Could not lock an installer-owned path.");
    }

    try
    {
      if (!NativeMethods.GetFileInformationByHandle(handle, out var information))
        throw new Win32Exception(
          Marshal.GetLastWin32Error(),
          "Could not inspect a locked installer-owned path.");

      var isDirectory = (information.FileAttributes & FileAttributes.Directory) != 0;
      if (isDirectory != expectDirectory
        || (information.FileAttributes & FileAttributes.ReparsePoint) != 0)
      {
        throw new SecurityException(
          "Installer-owned paths cannot be reparse points or have an unexpected type.");
      }
      if (requireSingleLink && information.NumberOfLinks != 1)
        throw new SecurityException("Installer-owned files must have exactly one hard link.");

      var finalPath = GetFinalPath(handle);
      if (!string.Equals(finalPath, expected, StringComparison.OrdinalIgnoreCase))
        throw new SecurityException("A locked installer path did not resolve to its canonical location.");

      return new LockedInstallerPath(
        handle,
        expected,
        isDirectory,
        information.NumberOfLinks);
    }
    catch
    {
      handle.Dispose();
      throw;
    }
  }

  private static string GetFinalPath(SafeFileHandle handle)
  {
    var buffer = new char[MaximumFinalPathCharacters];
    var length = NativeMethods.GetFinalPathNameByHandle(
      handle,
      buffer,
      checked((uint)buffer.Length),
      0);
    if (length == 0 || length >= buffer.Length)
      throw new Win32Exception(
        Marshal.GetLastWin32Error(),
        "Could not resolve a locked installer path.");

    var value = new string(buffer, 0, checked((int)length));
    if (!value.StartsWith(@"\\?\", StringComparison.Ordinal)
      || value.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase))
    {
      throw new SecurityException("Installer-owned paths must resolve to a local DOS volume.");
    }
    return Normalize(value[4..]);
  }

  private static string Normalize(string path) =>
    Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));

  [StructLayout(LayoutKind.Sequential)]
  private struct SecurityAttributes
  {
    public uint Length;
    public IntPtr SecurityDescriptor;
    [MarshalAs(UnmanagedType.Bool)] public bool InheritHandle;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct FileTime
  {
    public uint LowDateTime;
    public uint HighDateTime;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct ByHandleFileInformation
  {
    public FileAttributes FileAttributes;
    public FileTime CreationTime;
    public FileTime LastAccessTime;
    public FileTime LastWriteTime;
    public uint VolumeSerialNumber;
    public uint FileSizeHigh;
    public uint FileSizeLow;
    public uint NumberOfLinks;
    public uint FileIndexHigh;
    public uint FileIndexLow;
  }

  private static class NativeMethods
  {
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", SetLastError = true,
      CharSet = CharSet.Unicode)]
    internal static extern SafeFileHandle CreateFile(
      string fileName,
      uint desiredAccess,
      FileShare shareMode,
      IntPtr securityAttributes,
      uint creationDisposition,
      uint flagsAndAttributes,
      IntPtr templateFile);

    [DllImport("kernel32.dll", EntryPoint = "CreateDirectoryW", SetLastError = true,
      CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CreateDirectory(
      string path,
      ref SecurityAttributes securityAttributes);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetFileInformationByHandle(
      SafeFileHandle file,
      out ByHandleFileInformation information);

    [DllImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW",
      SetLastError = true, CharSet = CharSet.Unicode)]
    internal static extern uint GetFinalPathNameByHandle(
      SafeFileHandle file,
      [Out] char[] path,
      uint pathLength,
      uint flags);
  }
}
