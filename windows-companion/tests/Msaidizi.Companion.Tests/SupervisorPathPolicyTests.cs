using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed partial class SupervisorPathPolicyTests : IDisposable
{
  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"msaidizi-path-policy-{Guid.NewGuid():N}");
  private readonly string _root;
  private readonly string _supervisor;
  private readonly string _quarantine;

  public SupervisorPathPolicyTests()
  {
    _root = Path.Combine(_directory, "allowed");
    _supervisor = Path.Combine(_directory, "supervisor");
    _quarantine = Path.Combine(_directory, "quarantine");
    Directory.CreateDirectory(_root);
    Directory.CreateDirectory(_supervisor);
  }

  [Theory]
  [InlineData("..\\escape.txt")]
  [InlineData("folder\\..\\escape.txt")]
  [InlineData("C:\\Windows\\win.ini")]
  [InlineData("\\\\server\\share\\file.txt")]
  [InlineData("\\\\?\\C:\\Windows\\win.ini")]
  [InlineData("\\\\.\\PhysicalDrive0")]
  [InlineData("file.txt:secret")]
  [InlineData("CON")]
  [InlineData("nul.txt")]
  [InlineData("folder. ")]
  [InlineData("trailing.")]
  public void RejectsTraversalNamespacesAdsAndReservedNames(string untrustedPath)
  {
    var policy = CreatePolicy();

    var exception = Assert.Throws<HostPolicyException>(() =>
      policy.Resolve("managed", untrustedPath, HostPathAccess.Read));

    Assert.NotEmpty(exception.ErrorCode);
  }

  [Fact]
  public void RejectsReparsePointEscape()
  {
    var outside = Path.Combine(_directory, "outside");
    Directory.CreateDirectory(outside);
    var link = Path.Combine(_root, "linked");
    CreateJunction(link, outside);
    var policy = CreatePolicy();
    var resolved = policy.Resolve("managed", "linked", HostPathAccess.Read);

    var exception = Assert.Throws<HostPolicyException>(() => policy.OpenExisting(resolved));

    Assert.Equal("reparse_point_forbidden", exception.ErrorCode);
  }

  [Fact]
  public void RejectsHardLinkedFile()
  {
    var original = Path.Combine(_root, "original.txt");
    var linked = Path.Combine(_root, "linked.txt");
    File.WriteAllText(original, "sensitive");
    Assert.True(CreateHardLink(linked, original, IntPtr.Zero));
    var policy = CreatePolicy();
    var resolved = policy.Resolve("managed", "linked.txt", HostPathAccess.Read);

    var exception = Assert.Throws<HostPolicyException>(() => policy.OpenExisting(resolved));

    Assert.Equal("hard_link_forbidden", exception.ErrorCode);
  }

  [Fact]
  public void ParentHandlePreventsRenameDuringCreateBoundary()
  {
    var parentPath = Path.Combine(_root, "stable-parent");
    Directory.CreateDirectory(parentPath);
    var policy = CreatePolicy();
    var child = policy.Resolve("managed", "stable-parent\\new.txt", HostPathAccess.Write);
    using var parent = policy.OpenParentForCreate(child);

    try
    {
      Directory.Move(parentPath, Path.Combine(_root, "renamed-parent"));
    }
    catch (IOException)
    {
      return;
    }

    var exception = Assert.Throws<HostPolicyException>(() =>
      SupervisorPathPolicy.EnsureHandleStillNames(parent, parentPath));
    Assert.Equal("path_handle_moved", exception.ErrorCode);
  }

  [Fact]
  public void ModelAddressableRootCannotReachTrustedSupervisorPath()
  {
    var governedRoot = Path.Combine(_directory, "broad-root");
    var trustedInsideRoot = Path.Combine(governedRoot, "supervisor");
    Directory.CreateDirectory(trustedInsideRoot);
    var broadOptions = CreateHostOptions(governedRoot);
    var policy = new SupervisorPathPolicy(
      Options.Create(broadOptions),
      Options.Create(new CompanionOptions
      {
        JournalPath = Path.Combine(trustedInsideRoot, "journal.jsonl"),
        KillSwitchPath = Path.Combine(trustedInsideRoot, "DISABLED"),
        ResultCachePath = Path.Combine(trustedInsideRoot, "results"),
      }));

    var exception = Assert.Throws<HostPolicyException>(() => policy.Resolve(
      "managed",
      "supervisor\\DISABLED",
      HostPathAccess.Write));

    Assert.Equal("trusted_root_path_forbidden", exception.ErrorCode);
  }

  public void Dispose()
  {
    var junction = Path.Combine(_root, "linked");
    if (Directory.Exists(junction))
    {
      Directory.Delete(junction, recursive: false);
    }

    if (Directory.Exists(_directory))
    {
      Directory.Delete(_directory, recursive: true);
    }
  }

  private SupervisorPathPolicy CreatePolicy() => new(
    Options.Create(CreateHostOptions(_root)),
    Options.Create(CreateCompanionOptions()));

  private HostCapabilityOptions CreateHostOptions(string root) => new()
  {
    Enabled = true,
    RecoveryVaultPath = Path.Combine(_supervisor, "recovery"),
    AllowedRoots =
    [
      new AllowedHostRootOptions
      {
        Id = "managed",
        Path = root,
        QuarantinePath = _quarantine,
        AllowRead = true,
        AllowWrite = true,
        AllowDelete = true,
      },
    ],
  };

  private CompanionOptions CreateCompanionOptions() => new()
  {
    JournalPath = Path.Combine(_supervisor, "journal.jsonl"),
    KillSwitchPath = Path.Combine(_supervisor, "DISABLED"),
    ResultCachePath = Path.Combine(_supervisor, "result-cache"),
  };

  private static void CreateJunction(string junctionPath, string targetPath)
  {
    Directory.CreateDirectory(junctionPath);
    using var handle = OpenDirectoryForReparsePoint(junctionPath);
    Assert.False(handle.IsInvalid);
    var substituteName = $@"\??\{Path.GetFullPath(targetPath)}";
    var printName = Path.GetFullPath(targetPath);
    var substituteBytes = Encoding.Unicode.GetBytes(substituteName);
    var printBytes = Encoding.Unicode.GetBytes(printName);
    var pathBufferLength = checked(substituteBytes.Length + 2 + printBytes.Length + 2);
    var reparseDataLength = checked((ushort)(8 + pathBufferLength));
    var buffer = new byte[checked(8 + reparseDataLength)];
    BitConverter.GetBytes(0xA0000003u).CopyTo(buffer, 0);
    BitConverter.GetBytes(reparseDataLength).CopyTo(buffer, 4);
    BitConverter.GetBytes((ushort)0).CopyTo(buffer, 6);
    BitConverter.GetBytes((ushort)0).CopyTo(buffer, 8);
    BitConverter.GetBytes(checked((ushort)substituteBytes.Length)).CopyTo(buffer, 10);
    BitConverter.GetBytes(checked((ushort)(substituteBytes.Length + 2))).CopyTo(buffer, 12);
    BitConverter.GetBytes(checked((ushort)printBytes.Length)).CopyTo(buffer, 14);
    substituteBytes.CopyTo(buffer, 16);
    printBytes.CopyTo(buffer, checked(16 + substituteBytes.Length + 2));
    var unmanaged = Marshal.AllocHGlobal(buffer.Length);
    try
    {
      Marshal.Copy(buffer, 0, unmanaged, buffer.Length);
      Assert.True(SetReparsePoint(
        handle,
        0x000900A4,
        unmanaged,
        checked((uint)buffer.Length),
        IntPtr.Zero,
        0,
        out _,
        IntPtr.Zero));
    }
    finally
    {
      Marshal.FreeHGlobal(unmanaged);
    }
  }

  [LibraryImport("kernel32.dll", EntryPoint = "CreateHardLinkW", SetLastError = true,
    StringMarshalling = StringMarshalling.Utf16)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool CreateHardLink(
    string fileName,
    string existingFileName,
    IntPtr securityAttributes);

  [LibraryImport("kernel32.dll", EntryPoint = "CreateFileW", SetLastError = true,
    StringMarshalling = StringMarshalling.Utf16)]
  private static partial SafeFileHandle OpenDirectoryForReparsePoint(
    string fileName,
    uint desiredAccess = 0x40000000,
    uint shareMode = 0,
    IntPtr securityAttributes = default,
    uint creationDisposition = 3,
    uint flagsAndAttributes = 0x02200000,
    IntPtr templateFile = default);

  [LibraryImport("kernel32.dll", EntryPoint = "DeviceIoControl", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool SetReparsePoint(
    SafeFileHandle device,
    uint controlCode,
    IntPtr inputBuffer,
    uint inputBufferSize,
    IntPtr outputBuffer,
    uint outputBufferSize,
    out uint bytesReturned,
    IntPtr overlapped);
}
