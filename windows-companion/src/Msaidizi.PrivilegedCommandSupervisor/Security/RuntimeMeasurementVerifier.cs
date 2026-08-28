using System.ComponentModel;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Security;

public static class RuntimeMeasurementVerifier
{
  public static void VerifyCurrentExecutable(string expectedSha256)
  {
    var path = Environment.ProcessPath;
    if (string.IsNullOrWhiteSpace(path))
    {
      throw new InvalidOperationException("The supervisor executable path is unavailable.");
    }

    var fullPath = Path.GetFullPath(path);
    EnsureNoReparsePoints(fullPath);
    using var process = new SafeProcessHandle(GetCurrentProcess(), ownsHandle: false);
    using var stream = OpenValidatedImage(fullPath);
    if (!IsExactMappedImage(process, stream.SafeFileHandle))
    {
      throw new UnauthorizedAccessException(
        "The measured supervisor file is not the image mapped into this process.");
    }
    VerifyStream(stream, expectedSha256, "supervisor");
  }

  public static void VerifyDriverImage(string path, string expectedSha256) =>
    VerifyPath(path, expectedSha256, "driver");

  public static void VerifyTrustedDirectory(string path)
  {
    var fullPath = Path.GetFullPath(path);
    if (!Directory.Exists(fullPath))
    {
      throw new DirectoryNotFoundException(
        "The protected supervisor state root must be provisioned before active mode.");
    }
    EnsureNoReparsePoints(fullPath);
    var volumePath = new char[261];
    var fileSystem = new char[32];
    unsafe
    {
      fixed (char* volumePointer = volumePath)
      fixed (char* fileSystemPointer = fileSystem)
      {
        if (!GetVolumePathName(
            fullPath,
            volumePointer,
            checked((uint)volumePath.Length)))
        {
          throw new IOException("The supervisor state volume is unavailable.");
        }
        var volumeLength = Array.IndexOf(volumePath, '\0');
        if (volumeLength <= 0
          || !GetVolumeInformation(
            new string(volumePath, 0, volumeLength),
            null,
            0,
            out _,
            out _,
            out _,
            fileSystemPointer,
            checked((uint)fileSystem.Length)))
        {
          throw new IOException("The supervisor state filesystem is unavailable.");
        }
      }
    }
    var fileSystemLength = Array.IndexOf(fileSystem, '\0');
    if (fileSystemLength <= 0
      || !string.Equals(
        new string(fileSystem, 0, fileSystemLength),
        "NTFS",
        StringComparison.OrdinalIgnoreCase))
    {
      throw new InvalidOperationException(
        "The privileged-command supervisor state root must be on NTFS.");
    }
  }

  private static void VerifyPath(string path, string expectedSha256, string component)
  {
    var fullPath = Path.GetFullPath(path);
    EnsureNoReparsePoints(fullPath);
    using var stream = OpenValidatedImage(fullPath);
    VerifyStream(stream, expectedSha256, component);
  }

  private static void VerifyStream(
    FileStream stream,
    string expectedSha256,
    string component)
  {
    var observed = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    if (!PayloadDigest.FixedTimeEqualsHex(observed, expectedSha256))
    {
      throw new UnauthorizedAccessException(
        $"The configured {component} measurement does not match the installed image.");
    }
  }

  internal static bool IsCurrentProcessMappedImageCandidate(string candidatePath)
  {
    var fullPath = Path.GetFullPath(candidatePath);
    EnsureNoReparsePoints(fullPath);
    using var process = new SafeProcessHandle(GetCurrentProcess(), ownsHandle: false);
    using var stream = OpenValidatedImage(fullPath);
    return IsExactMappedImage(process, stream.SafeFileHandle);
  }

  private static FileStream OpenValidatedImage(string fullPath)
  {
    var handle = CreateFile(
      fullPath,
      GenericRead | FileExecute | Synchronize,
      FileShareRead,
      IntPtr.Zero,
      OpenExisting,
      FileAttributeNormal | FileFlagSequentialScan,
      IntPtr.Zero);
    if (handle.IsInvalid)
    {
      var error = Marshal.GetLastWin32Error();
      handle.Dispose();
      throw new Win32Exception(error);
    }

    try
    {
      if (!GetFileInformationByHandle(handle, out var information)
        || information.NumberOfLinks != 1
        || (information.FileAttributes & FileAttributeReparsePoint) != 0
        || (information.FileAttributes & FileAttributeDirectory) != 0)
      {
        throw new UnauthorizedAccessException(
          "A measured image file identity is unsafe.");
      }
      var finalPath = GetFinalPath(handle);
      if (!string.Equals(
          finalPath,
          Path.GetFullPath(fullPath),
          StringComparison.OrdinalIgnoreCase))
      {
        throw new UnauthorizedAccessException(
          "A measured image handle resolved to an unexpected path.");
      }
      return new FileStream(handle, FileAccess.Read, 16_384, isAsync: false);
    }
    catch
    {
      handle.Dispose();
      throw;
    }
  }

  private static bool IsExactMappedImage(
    SafeProcessHandle process,
    SafeFileHandle image)
  {
    var fileHandle = image.DangerousGetHandle();
    return NtQueryInformationProcess(
      process,
      ProcessImageFileMapping,
      ref fileHandle,
      IntPtr.Size,
      IntPtr.Zero) == NtStatusSuccess;
  }

  private static string GetFinalPath(SafeFileHandle handle)
  {
    var buffer = new char[32_768];
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
    if (length == 0 || length >= buffer.Length)
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    var path = new string(buffer, 0, checked((int)length));
    return path.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)
      ? @"\\" + path[8..]
      : path.StartsWith(@"\\?\", StringComparison.Ordinal)
        ? path[4..]
        : path;
  }

  private static void EnsureNoReparsePoints(string path)
  {
    if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
    {
      throw new UnauthorizedAccessException("A measured image is a reparse point.");
    }

    for (var directory = Directory.GetParent(path);
      directory is not null;
      directory = directory.Parent)
    {
      if ((directory.Attributes & FileAttributes.ReparsePoint) != 0)
      {
        throw new UnauthorizedAccessException(
          "A measured image has a reparse-point ancestor.");
      }
    }
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern unsafe bool GetVolumePathName(
    string fileName,
    char* volumePathName,
    uint bufferLength);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern unsafe bool GetVolumeInformation(
    string rootPathName,
    char* volumeNameBuffer,
    uint volumeNameSize,
    out uint volumeSerialNumber,
    out uint maximumComponentLength,
    out uint fileSystemFlags,
    char* fileSystemNameBuffer,
    uint fileSystemNameSize);

  [DllImport("kernel32.dll")]
  private static extern IntPtr GetCurrentProcess();

  [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode,
    SetLastError = true)]
  private static extern SafeFileHandle CreateFile(
    string fileName,
    uint desiredAccess,
    uint shareMode,
    IntPtr securityAttributes,
    uint creationDisposition,
    uint flagsAndAttributes,
    IntPtr templateFile);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetFileInformationByHandle(
    SafeFileHandle file,
    out ByHandleFileInformation fileInformation);

  [DllImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW",
    CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern unsafe uint GetFinalPathNameByHandle(
    SafeFileHandle file,
    char* filePath,
    uint filePathLength,
    uint flags);

  [DllImport("ntdll.dll")]
  private static extern int NtQueryInformationProcess(
    SafeProcessHandle process,
    int processInformationClass,
    ref IntPtr processInformation,
    int processInformationLength,
    IntPtr returnLength);

  private const uint Synchronize = 0x00100000;
  private const uint GenericRead = 0x80000000;
  private const uint FileExecute = 0x00000020;
  private const uint FileShareRead = 0x00000001;
  private const uint OpenExisting = 3;
  private const uint FileAttributeDirectory = 0x00000010;
  private const uint FileAttributeNormal = 0x00000080;
  private const uint FileAttributeReparsePoint = 0x00000400;
  private const uint FileFlagSequentialScan = 0x08000000;
  private const int ProcessImageFileMapping = 44;
  private const int NtStatusSuccess = 0;

  [StructLayout(LayoutKind.Sequential)]
  private struct ByHandleFileInformation
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
