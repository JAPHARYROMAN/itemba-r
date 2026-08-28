using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Itemba.Msaidizi.Companion.Service.Security;

internal static partial class WindowsDataProtection
{
  private const uint CryptProtectUiForbidden = 0x1;
  private const uint CryptProtectLocalMachine = 0x4;
  private static readonly byte[] Entropy =
    Encoding.UTF8.GetBytes("Itemba.Msaidizi.Companion.v1");

  public static byte[] Protect(ReadOnlySpan<byte> plaintext) =>
    Transform(plaintext, protect: true, localMachine: false);

  public static byte[] ProtectLocalMachine(ReadOnlySpan<byte> plaintext) =>
    Transform(plaintext, protect: true, localMachine: true);

  public static byte[] Unprotect(ReadOnlySpan<byte> ciphertext) =>
    Transform(ciphertext, protect: false, localMachine: false);

  private static byte[] Transform(
    ReadOnlySpan<byte> input,
    bool protect,
    bool localMachine)
  {
    if (!OperatingSystem.IsWindows())
    {
      throw new PlatformNotSupportedException("Windows DPAPI is required.");
    }

    var inputBytes = input.ToArray();
    var entropyBytes = Entropy.ToArray();
    var inputBlob = AllocateBlob(inputBytes);
    var entropyBlob = AllocateBlob(entropyBytes);
    var outputBlob = default(DataBlob);
    try
    {
      var succeeded = protect
        ? CryptProtectData(
          ref inputBlob,
          null,
          ref entropyBlob,
          IntPtr.Zero,
          IntPtr.Zero,
          CryptProtectUiForbidden | (localMachine ? CryptProtectLocalMachine : 0),
          out outputBlob)
        : CryptUnprotectData(
          ref inputBlob,
          IntPtr.Zero,
          ref entropyBlob,
          IntPtr.Zero,
          IntPtr.Zero,
          CryptProtectUiForbidden,
          out outputBlob);
      if (!succeeded)
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }

      var output = new byte[outputBlob.Length];
      try
      {
        Marshal.Copy(outputBlob.Data, output, 0, output.Length);
        return output;
      }
      catch
      {
        CryptographicOperations.ZeroMemory(output);
        throw;
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(inputBytes);
      CryptographicOperations.ZeroMemory(entropyBytes);
      FreeBlob(inputBlob);
      FreeBlob(entropyBlob);
      if (outputBlob.Data != IntPtr.Zero)
      {
        ZeroBlob(outputBlob);
        _ = LocalFree(outputBlob.Data);
      }
    }
  }

  private static DataBlob AllocateBlob(byte[] bytes)
  {
    var pointer = Marshal.AllocHGlobal(bytes.Length);
    Marshal.Copy(bytes, 0, pointer, bytes.Length);
    return new DataBlob(bytes.Length, pointer);
  }

  private static void FreeBlob(DataBlob blob)
  {
    if (blob.Data == IntPtr.Zero)
    {
      return;
    }

    var zeroes = new byte[blob.Length];
    Marshal.Copy(zeroes, 0, blob.Data, zeroes.Length);
    Marshal.FreeHGlobal(blob.Data);
  }

  private static void ZeroBlob(DataBlob blob)
  {
    if (blob.Data == IntPtr.Zero || blob.Length <= 0)
    {
      return;
    }

    var zeroes = new byte[blob.Length];
    Marshal.Copy(zeroes, 0, blob.Data, zeroes.Length);
  }

  [LibraryImport("crypt32.dll", EntryPoint = "CryptProtectData", SetLastError = true,
    StringMarshalling = StringMarshalling.Utf16)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool CryptProtectData(
    ref DataBlob dataIn,
    string? description,
    ref DataBlob optionalEntropy,
    IntPtr reserved,
    IntPtr promptStructure,
    uint flags,
    out DataBlob dataOut);

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

  [StructLayout(LayoutKind.Sequential)]
  private readonly struct DataBlob(int length, IntPtr data)
  {
    public int Length { get; } = length;

    public IntPtr Data { get; } = data;
  }
}
