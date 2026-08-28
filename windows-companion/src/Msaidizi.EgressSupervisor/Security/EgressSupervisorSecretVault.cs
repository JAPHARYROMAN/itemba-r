using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.EgressSupervisor.Security;

public interface IEgressSupervisorSecretVault
{
  ValueTask<T> UseAsync<T>(
    string referenceId,
    string capabilityId,
    string destinationScopeSha256,
    string credentialRecordSha256,
    Func<ReadOnlyMemory<byte>, CancellationToken, ValueTask<T>> consumer,
    CancellationToken cancellationToken);
}

/// <summary>
/// Read-only consumer for the LocalMachine-DPAPI vault provisioned by the
/// Companion. The egress supervisor, rather than the mutable Companion, selects
/// and unwraps the exact policy-bound credential immediately before TLS use.
/// Its unopened v2 ciphertext record must match the immutable digest pinned by
/// trusted destination policy, so provisioning access cannot substitute it.
/// </summary>
public sealed partial class EgressSupervisorSecretVault : IEgressSupervisorSecretVault
{
  private const int MaximumRecordBytes = 1_048_576;
  private const int MaximumSecretBytes = 262_144;
  private const int MaximumCapabilities = 32;
  private static readonly byte[] Magic = "IMSV"u8.ToArray();
  private static readonly byte[] Entropy =
    Encoding.UTF8.GetBytes("Itemba.Msaidizi.Companion.v1");
  private readonly string _directory;

  public EgressSupervisorSecretVault(EgressSupervisorOptions options)
  {
    var path = Environment.ExpandEnvironmentVariables(options.SecretVaultPath ?? string.Empty);
    if (!IsSafeAbsoluteLocalPath(path))
    {
      throw new InvalidOperationException("The supervisor credential vault path is invalid.");
    }
    _directory = Path.GetFullPath(path);
  }

  public async ValueTask<T> UseAsync<T>(
    string referenceId,
    string capabilityId,
    string destinationScopeSha256,
    string credentialRecordSha256,
    Func<ReadOnlyMemory<byte>, CancellationToken, ValueTask<T>> consumer,
    CancellationToken cancellationToken)
  {
    if (!Guid.TryParseExact(referenceId, "D", out _)
      || string.IsNullOrWhiteSpace(capabilityId)
      || capabilityId.Length > 256
      || !PayloadDigest.IsSha256Hex(destinationScopeSha256)
      || !IsCanonicalSha256(credentialRecordSha256)
      || consumer is null)
    {
      throw new InvalidDataException("The supervisor credential request is invalid.");
    }

    EnsureDirectoryBoundary();
    var path = Path.Combine(
      _directory,
      $"{PayloadDigest.Sha256Hex($"msaidizi-secret-reference/v1\0{referenceId.ToLowerInvariant()}")}.bin");
    byte[] protectedPayload;
    await using (var stream = OpenExactRecord(path))
    {
      if (stream.Length is <= 0 or > MaximumRecordBytes)
      {
        throw new InvalidDataException("The supervisor credential record is invalid.");
      }
      protectedPayload = new byte[checked((int)stream.Length)];
      await stream.ReadExactlyAsync(protectedPayload, cancellationToken).ConfigureAwait(false);
    }

    byte[] plaintext;
    try
    {
      var observedRecordSha256 = Convert.ToHexString(SHA256.HashData(protectedPayload))
        .ToLowerInvariant();
      if (!PayloadDigest.FixedTimeEqualsHex(
          observedRecordSha256,
          credentialRecordSha256))
      {
        throw new UnauthorizedAccessException(
          "The supervisor credential record does not match the active policy pin.");
      }
      plaintext = Unprotect(protectedPayload);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(protectedPayload);
    }
    try
    {
      var record = Parse(plaintext);
      if (!string.Equals(record.ReferenceId, referenceId, StringComparison.OrdinalIgnoreCase)
        || !record.Capabilities.Contains(capabilityId, StringComparer.Ordinal)
        || !PayloadDigest.FixedTimeEqualsHex(
          record.DestinationScopeSha256,
          destinationScopeSha256))
      {
        throw new UnauthorizedAccessException(
          "The supervisor credential is not bound to this exact action scope.");
      }
      return await consumer(
        plaintext.AsMemory(record.SecretOffset, record.SecretLength),
        cancellationToken).ConfigureAwait(false);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(plaintext);
    }
  }

  private static bool IsCanonicalSha256(string value) =>
    PayloadDigest.IsSha256Hex(value)
    && string.Equals(value, value.ToLowerInvariant(), StringComparison.Ordinal);

  private void EnsureDirectoryBoundary()
  {
    if (!Directory.Exists(_directory))
    {
      throw new DirectoryNotFoundException("The supervisor credential vault is missing.");
    }
    var current = new DirectoryInfo(_directory);
    while (current is not null)
    {
      if ((current.Attributes & FileAttributes.ReparsePoint) != 0)
      {
        throw new UnauthorizedAccessException(
          "The supervisor credential vault has an indirect path.");
      }
      current = current.Parent;
    }
  }

  private static FileStream OpenExactRecord(string path)
  {
    var stream = new FileStream(
      path,
      FileMode.Open,
      FileAccess.Read,
      FileShare.Read,
      4_096,
      FileOptions.Asynchronous | FileOptions.SequentialScan);
    try
    {
      if (!GetFileInformationByHandle(stream.SafeFileHandle, out var information)
        || (information.FileAttributes & 0x00000400) != 0
        || (information.FileAttributes & 0x00000010) != 0
        || information.NumberOfLinks != 1)
      {
        throw new UnauthorizedAccessException(
          "The supervisor credential record is indirect or hard-linked.");
      }
      var finalPath = GetFinalPath(stream.SafeFileHandle);
      if (!string.Equals(
        Path.GetFullPath(path),
        finalPath,
        StringComparison.OrdinalIgnoreCase))
      {
        throw new UnauthorizedAccessException(
          "The supervisor credential record resolved to another file.");
      }
      return stream;
    }
    catch
    {
      stream.Dispose();
      throw;
    }
  }

  private static ParsedRecord Parse(byte[] plaintext)
  {
    try
    {
      using var stream = new MemoryStream(plaintext, writable: false);
      using var reader = new BinaryReader(stream, new UTF8Encoding(false, true));
      if (!reader.ReadBytes(Magic.Length).AsSpan().SequenceEqual(Magic))
      {
        throw new InvalidDataException();
      }
      var formatVersion = reader.ReadInt32();
      if (formatVersion != 2)
      {
        throw new InvalidDataException();
      }
      var referenceId = reader.ReadString();
      var kind = reader.ReadString();
      var scope = reader.ReadString();
      var createdAt = DateTimeOffset.FromUnixTimeMilliseconds(reader.ReadInt64());
      var updatedAt = DateTimeOffset.FromUnixTimeMilliseconds(reader.ReadInt64());
      var recordVersion = reader.ReadInt32();
      var capabilityCount = reader.ReadInt32();
      if (!Guid.TryParseExact(referenceId, "D", out _)
        || !IsBoundedIdentifier(kind, 128)
        || !PayloadDigest.IsSha256Hex(scope)
        || recordVersion < 1
        || updatedAt < createdAt
        || capabilityCount is < 1 or > MaximumCapabilities)
      {
        throw new InvalidDataException();
      }
      var capabilities = new string[capabilityCount];
      for (var index = 0; index < capabilityCount; index++)
      {
        capabilities[index] = reader.ReadString();
        if (!IsBoundedIdentifier(capabilities[index], 256))
        {
          throw new InvalidDataException();
        }
      }
      if (capabilities.Distinct(StringComparer.Ordinal).Count() != capabilities.Length)
      {
        throw new InvalidDataException();
      }
      var secretLength = reader.ReadInt32();
      var secretOffset = checked((int)stream.Position);
      if (secretLength is <= 0 or > MaximumSecretBytes
        || secretOffset + secretLength != plaintext.Length)
      {
        throw new InvalidDataException();
      }
      return new ParsedRecord(referenceId, scope, capabilities, secretOffset, secretLength);
    }
    catch (Exception exception) when (exception is EndOfStreamException
      or IOException
      or DecoderFallbackException
      or ArgumentOutOfRangeException
      or OverflowException)
    {
      throw new InvalidDataException("The supervisor credential record is malformed.", exception);
    }
  }

  private static byte[] Unprotect(ReadOnlySpan<byte> ciphertext)
  {
    if (!OperatingSystem.IsWindows())
    {
      throw new PlatformNotSupportedException("Windows DPAPI is required.");
    }
    var input = ciphertext.ToArray();
    var entropy = Entropy.ToArray();
    var inputBlob = AllocateBlob(input);
    var entropyBlob = AllocateBlob(entropy);
    var output = default(DataBlob);
    try
    {
      if (!CryptUnprotectData(
          ref inputBlob,
          IntPtr.Zero,
          ref entropyBlob,
          IntPtr.Zero,
          IntPtr.Zero,
          0x1,
          out output))
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      var plaintext = new byte[output.Length];
      Marshal.Copy(output.Data, plaintext, 0, plaintext.Length);
      return plaintext;
    }
    finally
    {
      CryptographicOperations.ZeroMemory(input);
      CryptographicOperations.ZeroMemory(entropy);
      FreeBlob(inputBlob);
      FreeBlob(entropyBlob);
      if (output.Data != IntPtr.Zero)
      {
        ZeroBlob(output);
        _ = LocalFree(output.Data);
      }
    }
  }

  private static bool IsBoundedIdentifier(string value, int maximumLength) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= maximumLength
    && value.All(character => !char.IsControl(character));

  private static DataBlob AllocateBlob(byte[] bytes)
  {
    var pointer = Marshal.AllocHGlobal(bytes.Length);
    Marshal.Copy(bytes, 0, pointer, bytes.Length);
    return new DataBlob(bytes.Length, pointer);
  }

  private static void FreeBlob(DataBlob blob)
  {
    if (blob.Data == IntPtr.Zero) return;
    ZeroBlob(blob);
    Marshal.FreeHGlobal(blob.Data);
  }

  private static void ZeroBlob(DataBlob blob)
  {
    if (blob.Data == IntPtr.Zero || blob.Length <= 0) return;
    var zeros = new byte[blob.Length];
    Marshal.Copy(zeros, 0, blob.Data, zeros.Length);
  }

  private static string GetFinalPath(SafeFileHandle handle)
  {
    var buffer = new char[32_768];
    uint length;
    unsafe
    {
      fixed (char* pointer = buffer)
      {
        length = GetFinalPathNameByHandle(handle, pointer, (uint)buffer.Length, 0);
      }
    }
    if (length == 0 || length >= buffer.Length)
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    var value = new string(buffer, 0, checked((int)length));
    return value.StartsWith(@"\\?\", StringComparison.Ordinal) ? value[4..] : value;
  }

  private static bool IsSafeAbsoluteLocalPath(string path)
  {
    if (string.IsNullOrWhiteSpace(path)
      || !Path.IsPathFullyQualified(path)
      || path.StartsWith(@"\\", StringComparison.Ordinal)
      || path.StartsWith(@"\\?\", StringComparison.Ordinal)
      || path.StartsWith(@"\\.\", StringComparison.Ordinal))
    {
      return false;
    }
    try
    {
      return string.Equals(Path.GetFullPath(path), path, StringComparison.OrdinalIgnoreCase)
        && path.IndexOf(':', 3) < 0;
    }
    catch (Exception exception) when (exception is ArgumentException
      or NotSupportedException
      or PathTooLongException)
    {
      return false;
    }
  }

  private sealed record ParsedRecord(
    string ReferenceId,
    string DestinationScopeSha256,
    IReadOnlyList<string> Capabilities,
    int SecretOffset,
    int SecretLength);

  [StructLayout(LayoutKind.Sequential)]
  private readonly struct DataBlob(int length, IntPtr data)
  {
    public int Length { get; } = length;
    public IntPtr Data { get; } = data;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct FileInformation
  {
    public uint FileAttributes;
    public uint CreationTimeLow, CreationTimeHigh, LastAccessTimeLow, LastAccessTimeHigh;
    public uint LastWriteTimeLow, LastWriteTimeHigh, VolumeSerialNumber;
    public uint FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow;
  }

  [LibraryImport("crypt32.dll", EntryPoint = "CryptUnprotectData", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool CryptUnprotectData(
    ref DataBlob dataIn,
    IntPtr description,
    ref DataBlob optionalEntropy,
    IntPtr reserved,
    IntPtr promptStructure,
    uint flags,
    out DataBlob dataOut);

  [LibraryImport("kernel32.dll")]
  private static partial IntPtr LocalFree(IntPtr memory);

  [LibraryImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool GetFileInformationByHandle(
    SafeFileHandle file,
    out FileInformation information);

  [LibraryImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW",
    SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
  private static unsafe partial uint GetFinalPathNameByHandle(
    SafeFileHandle file,
    char* filePath,
    uint filePathLength,
    uint flags);
}
