using System.Collections.Concurrent;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Agent.Configuration;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Contracts.SessionBridge;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Agent.Capabilities;

internal static class InteractiveJsonValidation
{
  public static bool HasExactProperties(JsonElement value, params string[] expected)
  {
    if (value.ValueKind != JsonValueKind.Object)
    {
      return false;
    }

    var names = value.EnumerateObject().Select(property => property.Name).ToArray();
    return names.Length == expected.Length
      && names.ToHashSet(StringComparer.Ordinal).SetEquals(expected);
  }

  public static CapabilityArgumentValidation Invalid(string message) =>
    CapabilityArgumentValidation.Invalid("arguments_schema_invalid", message);

  public static CapabilityArgumentValidation InvalidResult(string message) =>
    CapabilityArgumentValidation.Invalid("result_schema_invalid", message);

  public static bool IsSha256(JsonElement value) =>
    value.ValueKind == JsonValueKind.String
    && value.GetString() is { Length: 64 } digest
    && digest.All(character => char.IsAsciiHexDigit(character))
    && digest.All(character => !char.IsAsciiLetter(character) || char.IsLower(character));
}

/// <summary>
/// Serializes OLE, clipboard, screen, and UI Automation calls onto one STA
/// thread in the interactive process. No delegate crosses the service pipe.
/// </summary>
public sealed class InteractiveStaDispatcher : IDisposable
{
  private readonly BlockingCollection<Action> _work = new();
  private readonly Thread _thread;
  private bool _disposed;

  public InteractiveStaDispatcher()
  {
    _thread = new Thread(Run)
    {
      IsBackground = true,
      Name = "Msaidizi Interactive STA",
    };
    _thread.SetApartmentState(ApartmentState.STA);
    _thread.Start();
  }

  public Task<T> InvokeAsync<T>(Func<T> operation, CancellationToken cancellationToken)
  {
    ObjectDisposedException.ThrowIf(_disposed, this);
    var completion = new TaskCompletionSource<T>(
      TaskCreationOptions.RunContinuationsAsynchronously);
    var registration = cancellationToken.Register(
      () => completion.TrySetCanceled(cancellationToken));
    _work.Add(() =>
    {
      if (completion.Task.IsCompleted)
      {
        return;
      }

      try
      {
        completion.TrySetResult(operation());
      }
      catch (Exception exception)
      {
        completion.TrySetException(exception);
      }
    }, cancellationToken);
    return AwaitAndDisposeRegistrationAsync(completion.Task, registration);
  }

  public void Dispose()
  {
    if (_disposed)
    {
      return;
    }

    _disposed = true;
    _work.CompleteAdding();
    if (!_thread.Join(TimeSpan.FromSeconds(5)))
    {
      // The host process owns this background thread and may still terminate.
    }

    _work.Dispose();
  }

  private void Run()
  {
    _ = Application.OleRequired();
    foreach (var operation in _work.GetConsumingEnumerable())
    {
      operation();
    }
  }

  private static async Task<T> AwaitAndDisposeRegistrationAsync<T>(
    Task<T> task,
    CancellationTokenRegistration registration)
  {
    try
    {
      return await task.ConfigureAwait(false);
    }
    finally
    {
      registration.Dispose();
    }
  }
}

public sealed record SessionRecoveryReceipt(string OpaqueHandle, string RecordSha256);

public interface ISessionRecoveryStore
{
  ValueTask<SessionRecoveryReceipt> StoreAsync(
    ActionExecutionContext context,
    string capabilityId,
    byte[] sensitivePreState,
    CancellationToken cancellationToken);
}

/// <summary>
/// Current-user DPAPI storage for local session compensation. Only an opaque
/// handle and record digest leave this process; plaintext is zeroed promptly.
/// </summary>
public sealed class DpapiSessionRecoveryStore : ISessionRecoveryStore
{
  private readonly string _directory;

  public DpapiSessionRecoveryStore(IOptions<AgentOptions> options)
  {
    _directory = Path.GetFullPath(Environment.ExpandEnvironmentVariables(
      options.Value.SessionRecoveryPath));
    if (!Path.IsPathFullyQualified(_directory))
    {
      throw new InvalidOperationException("Session recovery storage must use an absolute path.");
    }
  }

  public async ValueTask<SessionRecoveryReceipt> StoreAsync(
    ActionExecutionContext context,
    string capabilityId,
    byte[] sensitivePreState,
    CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(sensitivePreState);
    Directory.CreateDirectory(_directory);
    var opaqueHandle = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    var envelope = JsonSerializer.SerializeToUtf8Bytes(new
    {
      version = 1,
      context.ActionId,
      context.TaskId,
      context.StepId,
      context.DeviceId,
      capabilityId,
      opaqueHandle,
      preparedAt = DateTimeOffset.UtcNow,
      contentBase64 = Convert.ToBase64String(sensitivePreState),
    });
    var digest = Convert.ToHexString(SHA256.HashData(envelope)).ToLowerInvariant();
    var protectedPayload = CurrentUserDataProtection.Protect(envelope);
    CryptographicOperations.ZeroMemory(envelope);
    var path = Path.Combine(
      _directory,
      $"{PayloadDigest.Sha256Hex(context.ActionId)}.bin");
    var temporary = Path.Combine(_directory, $".{Guid.NewGuid():N}.tmp");
    try
    {
      await using (var stream = new FileStream(
        temporary,
        FileMode.CreateNew,
        FileAccess.Write,
        FileShare.None,
        4096,
        FileOptions.Asynchronous | FileOptions.WriteThrough))
      {
        await stream.WriteAsync(protectedPayload, cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
        stream.Flush(flushToDisk: true);
      }

      File.Move(temporary, path, overwrite: false);
      return new SessionRecoveryReceipt(opaqueHandle, digest);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(protectedPayload);
      if (File.Exists(temporary))
      {
        File.Delete(temporary);
      }
    }
  }
}

public sealed class InteractiveTargetPolicy
{
  private readonly Dictionary<string, Uri> _browserOrigins;
  private readonly Dictionary<string, AllowedUiProcess> _uiProcesses;
  private readonly Dictionary<string, string> _browserUploadRoots;

  public InteractiveTargetPolicy(IOptions<AgentOptions> options)
  {
    _browserOrigins = options.Value.AllowedBrowserOrigins
      .Select(ParseOrigin)
      .ToDictionary(item => item.Id, item => item.Origin, StringComparer.Ordinal);
    _uiProcesses = options.Value.AllowedUiProcesses
      .Select(ParseUiProcess)
      .ToDictionary(item => item.Id, StringComparer.Ordinal);
    var protectedPaths = options.Value.ProtectedSupervisorPaths
      .Select(path => Path.TrimEndingDirectorySeparator(Path.GetFullPath(
        Environment.ExpandEnvironmentVariables(path))))
      .ToArray();
    _browserUploadRoots = options.Value.AllowedBrowserUploadRoots
      .Select(item => ParseUploadRoot(item, protectedPaths))
      .ToDictionary(item => item.Id, item => item.Path, StringComparer.Ordinal);
  }

  public Uri ResolveBrowserUri(string originId, string relativePath)
  {
    if (!_browserOrigins.TryGetValue(originId, out var origin)
      || string.IsNullOrWhiteSpace(relativePath)
      || !relativePath.StartsWith('/')
      || relativePath.Contains('\\')
      || relativePath.Contains('?')
      || relativePath.Contains('#')
      || !Uri.TryCreate(origin, relativePath, out var result)
      || !string.Equals(result.Scheme, Uri.UriSchemeHttps, StringComparison.Ordinal)
      || !string.Equals(result.GetLeftPart(UriPartial.Authority),
        origin.GetLeftPart(UriPartial.Authority),
        StringComparison.OrdinalIgnoreCase)
      || !string.IsNullOrEmpty(result.UserInfo)
      || !string.IsNullOrEmpty(result.Query)
      || !string.IsNullOrEmpty(result.Fragment))
    {
      throw new InvalidOperationException("browser_target_not_allowed");
    }

    return result;
  }

  public BrowserOriginBinding ResolveBrowserOrigin(JsonElement arguments)
  {
    var originId = arguments.GetProperty("originId").GetString()!;
    if (!_browserOrigins.TryGetValue(originId, out var origin))
    {
      throw new InvalidOperationException("browser_target_not_allowed");
    }
    var digest = PayloadDigest.Sha256Hex(origin.AbsoluteUri);
    if (arguments.TryGetProperty("originSha256", out var expected)
      && (!PayloadDigest.IsSha256Hex(expected.GetString() ?? string.Empty)
        || !SessionBridgeAuthentication.FixedTimeEqualsHex(
          expected.GetString()!,
          digest)))
    {
      throw new InvalidOperationException("browser_origin_digest_mismatch");
    }
    return new BrowserOriginBinding(originId, origin, digest);
  }

  public Uri ResolveBrowserUri(JsonElement arguments)
    => ResolveBrowserUri(
      arguments.GetProperty("originId").GetString()!,
      arguments.GetProperty("relativePath").GetString()!);

  public void ValidateBrowserOriginDigest(string originId, string expectedSha256)
  {
    if (!_browserOrigins.TryGetValue(originId, out var origin)
      || !PayloadDigest.IsSha256Hex(expectedSha256)
      || !SessionBridgeAuthentication.FixedTimeEqualsHex(
        expectedSha256,
        PayloadDigest.Sha256Hex(origin.AbsoluteUri)))
    {
      throw new InvalidOperationException("browser_origin_digest_mismatch");
    }
  }

  public BrowserOriginBinding ValidateBrowserOriginDigest(JsonElement arguments) =>
    ResolveBrowserOrigin(arguments);

  public string ValidateUiProcess(int processId)
  {
    using var process = Process.GetProcessById(processId);
    var path = process.MainModule?.FileName
      ?? throw new InvalidOperationException("ui_process_identity_unavailable");
    var fullPath = Path.GetFullPath(path);
    using var stream = new FileStream(
      fullPath,
      FileMode.Open,
      FileAccess.Read,
      FileShare.Read | FileShare.Delete);
    var digest = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    var match = _uiProcesses.Values.SingleOrDefault(item =>
      string.Equals(item.Path, fullPath, StringComparison.OrdinalIgnoreCase)
      && SessionBridgeAuthentication.FixedTimeEqualsHex(item.Sha256, digest));
    return match?.Id ?? throw new InvalidOperationException("ui_process_not_allowed");
  }

  public ApprovedBrowserUploadFile OpenUploadFile(string uploadRootId, string candidatePath)
  {
    if (!_browserUploadRoots.TryGetValue(uploadRootId, out var root)
      || string.IsNullOrWhiteSpace(candidatePath)
      || !Path.IsPathFullyQualified(candidatePath)
      || candidatePath.StartsWith(@"\\", StringComparison.Ordinal)
      || candidatePath.StartsWith(@"\??\", StringComparison.Ordinal)
      || candidatePath.AsSpan(Math.Min(2, candidatePath.Length)).Contains(':')
      || candidatePath.Contains('\0'))
    {
      throw new InvalidOperationException("browser_upload_path_not_allowed");
    }

    var fullPath = new string(Path.GetFullPath(candidatePath).AsSpan());
    if (!fullPath.StartsWith(
        root + Path.DirectorySeparatorChar,
        StringComparison.OrdinalIgnoreCase)
      || !File.Exists(fullPath)
      || File.GetAttributes(fullPath).HasFlag(FileAttributes.ReparsePoint))
    {
      SensitiveUtf8.ZeroString(fullPath);
      throw new InvalidOperationException("browser_upload_path_not_allowed");
    }

    try
    {
      return new ApprovedBrowserUploadFile(
        fullPath,
        new FileStream(
          File.OpenHandle(
            fullPath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            FileOptions.None),
          FileAccess.Read));
    }
    catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
    {
      SensitiveUtf8.ZeroString(fullPath);
      throw new InvalidOperationException("browser_upload_path_unavailable", exception);
    }
  }

  private static (string Id, Uri Origin) ParseOrigin(AllowedBrowserOriginOptions item)
  {
    if (!IsSafeId(item.Id)
      || !Uri.TryCreate(item.Origin, UriKind.Absolute, out var origin)
      || !string.Equals(origin.Scheme, Uri.UriSchemeHttps, StringComparison.Ordinal)
      || !string.IsNullOrEmpty(origin.UserInfo)
      || origin.AbsolutePath != "/"
      || !string.IsNullOrEmpty(origin.Query)
      || !string.IsNullOrEmpty(origin.Fragment))
    {
      throw new InvalidOperationException("An allowed browser origin is invalid.");
    }

    return (item.Id, origin);
  }

  private static AllowedUiProcess ParseUiProcess(AllowedUiProcessOptions item)
  {
    var path = Path.GetFullPath(Environment.ExpandEnvironmentVariables(item.ExecutablePath));
    if (!IsSafeId(item.Id)
      || !Path.IsPathFullyQualified(path)
      || !PayloadDigest.IsSha256Hex(item.Sha256))
    {
      throw new InvalidOperationException("An allowed UI process is invalid.");
    }

    return new AllowedUiProcess(item.Id, path, item.Sha256.ToLowerInvariant());
  }

  private static (string Id, string Path) ParseUploadRoot(
    AllowedBrowserUploadRootOptions item,
    IReadOnlyList<string> protectedPaths)
  {
    var path = Path.TrimEndingDirectorySeparator(Path.GetFullPath(
      Environment.ExpandEnvironmentVariables(item.Path)));
    if (!IsSafeId(item.Id)
      || !Path.IsPathFullyQualified(path)
      || path.StartsWith(@"\\", StringComparison.Ordinal)
      || !Directory.Exists(path)
      || File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint)
      || protectedPaths.Any(protectedPath => string.Equals(
          path,
          protectedPath,
          StringComparison.OrdinalIgnoreCase)
        || path.StartsWith(
          protectedPath + Path.DirectorySeparatorChar,
          StringComparison.OrdinalIgnoreCase)
        || protectedPath.StartsWith(
          path + Path.DirectorySeparatorChar,
          StringComparison.OrdinalIgnoreCase)))
    {
      throw new InvalidOperationException("An allowed browser upload root is invalid.");
    }
    return (item.Id, path);
  }

  private static bool IsSafeId(string value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 80
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_');

  private sealed record AllowedUiProcess(string Id, string Path, string Sha256);
}

public sealed class ApprovedBrowserUploadFile(string path, FileStream identityLock) : IDisposable
{
  private string? _path = path;

  public string Path => _path
    ?? throw new ObjectDisposedException(nameof(ApprovedBrowserUploadFile));

  public long Length => identityLock.Length;

  public void Dispose()
  {
    identityLock.Dispose();
    var pathValue = Interlocked.Exchange(ref _path, null);
    if (pathValue is not null)
    {
      SensitiveUtf8.ZeroString(pathValue);
    }
  }
}

internal static class CurrentUserDataProtection
{
  private const int CryptProtectUiForbidden = 0x1;

  public static byte[] Protect(byte[] plaintext) => Transform(plaintext, protect: true);

  public static byte[] Unprotect(byte[] ciphertext) => Transform(ciphertext, protect: false);

  private static byte[] Transform(byte[] inputBytes, bool protect)
  {
    var input = DataBlob.From(inputBytes);
    try
    {
      var succeeded = protect
        ? CryptProtectData(
          ref input,
          null,
          IntPtr.Zero,
          IntPtr.Zero,
          IntPtr.Zero,
          CryptProtectUiForbidden,
          out var output)
        : CryptUnprotectData(
          ref input,
          IntPtr.Zero,
          IntPtr.Zero,
          IntPtr.Zero,
          IntPtr.Zero,
          CryptProtectUiForbidden,
          out output);
      if (!succeeded)
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }

      try
      {
        var result = new byte[output.Size];
        try
        {
          Marshal.Copy(output.Data, result, 0, output.Size);
          return result;
        }
        catch
        {
          CryptographicOperations.ZeroMemory(result);
          throw;
        }
      }
      finally
      {
        if (output.Data != IntPtr.Zero)
        {
          unsafe
          {
            CryptographicOperations.ZeroMemory(
              new Span<byte>(output.Data.ToPointer(), output.Size));
          }
          LocalFree(output.Data);
        }
      }
    }
    finally
    {
      input.Dispose();
    }
  }

  [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool CryptProtectData(
    ref DataBlob dataIn,
    string? description,
    IntPtr optionalEntropy,
    IntPtr reserved,
    IntPtr promptStruct,
    int flags,
    out DataBlob dataOut);

  [DllImport("crypt32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool CryptUnprotectData(
    ref DataBlob dataIn,
    IntPtr description,
    IntPtr optionalEntropy,
    IntPtr reserved,
    IntPtr promptStruct,
    int flags,
    out DataBlob dataOut);

  [DllImport("kernel32.dll")]
  private static extern IntPtr LocalFree(IntPtr memory);

  [StructLayout(LayoutKind.Sequential)]
  private struct DataBlob : IDisposable
  {
    public int Size;
    public IntPtr Data;

    public static DataBlob From(byte[] bytes)
    {
      var blob = new DataBlob
      {
        Size = bytes.Length,
        Data = Marshal.AllocHGlobal(bytes.Length),
      };
      Marshal.Copy(bytes, 0, blob.Data, bytes.Length);
      return blob;
    }

    public void Dispose()
    {
      if (Data == IntPtr.Zero)
      {
        return;
      }

      unsafe
      {
        CryptographicOperations.ZeroMemory(new Span<byte>(Data.ToPointer(), Size));
      }

      Marshal.FreeHGlobal(Data);
      Data = IntPtr.Zero;
      Size = 0;
    }
  }
}
