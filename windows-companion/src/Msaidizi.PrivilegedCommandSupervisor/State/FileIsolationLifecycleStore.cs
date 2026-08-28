using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.State;

/// <summary>
/// Single-writer, write-through, hash-chained supervisor ledger. It stores only
/// signed action identities and enforcement evidence; command text, output,
/// tokens, credentials, and model content never enter this file.
/// </summary>
public sealed partial class FileIsolationLifecycleStore : IIsolationLifecycleStore
{
  private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
  {
    MaxDepth = 64,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
  };

  private const uint FileAttributeDirectory = 0x00000010;
  private const uint FileAttributeReparsePoint = 0x00000400;
  private readonly FileStream _ownershipLock;
  private readonly FileStream _stream;
  private readonly Dictionary<string, IsolationLifecycleState> _byRequest =
    new(StringComparer.Ordinal);
  private readonly Dictionary<string, IsolationLifecycleState> _byAction =
    new(StringComparer.Ordinal);
  private string _headSha256 = new('0', 64);
  private long _lastSequence;
  private int _disposed;

  public FileIsolationLifecycleStore(
    string path,
    bool requirePreprovisionedFiles = true)
  {
    ArgumentException.ThrowIfNullOrWhiteSpace(path);
    var fullPath = Path.GetFullPath(path);
    var directory = Path.GetDirectoryName(fullPath)
      ?? throw new InvalidOperationException("The isolation journal has no parent.");
    var lockPath = fullPath + ".lock";
    WindowsIsolationJournalProtection? protection = null;
    if (requirePreprovisionedFiles)
    {
      if (!Directory.Exists(directory)
        || !File.Exists(fullPath)
        || !File.Exists(lockPath))
      {
        throw new UnauthorizedAccessException(
          "The isolation lifecycle journal and ownership lock must be preprovisioned.");
      }
      protection = new WindowsIsolationJournalProtection();
      protection.ValidatePreOpen(directory, fullPath, lockPath);
    }
    else
    {
      Directory.CreateDirectory(directory);
    }

    var ownershipLock = new FileStream(
      lockPath,
      requirePreprovisionedFiles ? FileMode.Open : FileMode.OpenOrCreate,
      FileAccess.ReadWrite,
      FileShare.None,
      bufferSize: 1,
      FileOptions.WriteThrough);
    FileStream stream;
    try
    {
      stream = new FileStream(
        fullPath,
        requirePreprovisionedFiles ? FileMode.Open : FileMode.OpenOrCreate,
        FileAccess.ReadWrite,
        FileShare.Read,
        16_384,
        FileOptions.WriteThrough | FileOptions.SequentialScan);
    }
    catch
    {
      ownershipLock.Dispose();
      throw;
    }

    _ownershipLock = ownershipLock;
    _stream = stream;
    try
    {
      ValidateFileHandle(_ownershipLock.SafeFileHandle, lockPath, "ownership lock");
      ValidateFileHandle(_stream.SafeFileHandle, fullPath, "journal");
      protection?.ValidateOpened(
        directory,
        fullPath,
        lockPath,
        _stream,
        _ownershipLock);
      LoadAndVerify();
      _stream.Position = _stream.Length;
    }
    catch
    {
      _stream.Dispose();
      _ownershipLock.Dispose();
      throw;
    }
  }

  public long NextSequence
  {
    get
    {
      ThrowIfDisposed();
      return checked(_lastSequence + 1);
    }
  }

  public IReadOnlyCollection<IsolationLifecycleState> Snapshot
  {
    get
    {
      ThrowIfDisposed();
      return Array.AsReadOnly(_byRequest.Values.OrderBy(value => value.Sequence).ToArray());
    }
  }

  public IsolationLifecycleState? FindByRequestId(string requestId)
  {
    ThrowIfDisposed();
    return _byRequest.GetValueOrDefault(requestId);
  }

  public IsolationLifecycleState? FindByActionId(string actionId)
  {
    ThrowIfDisposed();
    return _byAction.GetValueOrDefault(actionId);
  }

  public async ValueTask AppendAsync(
    IsolationLifecycleState state,
    CancellationToken cancellationToken)
  {
    ThrowIfDisposed();
    ArgumentNullException.ThrowIfNull(state);
    if (state.Sequence != NextSequence)
    {
      throw new InvalidOperationException("The isolation journal sequence is stale.");
    }
    ValidateTransition(state);

    var stateJson = JsonSerializer.Serialize(state, JsonOptions);
    var entrySha256 = EntrySha256(state.Sequence, _headSha256, stateJson);
    var envelope = new JournalEnvelope(
      state.Sequence,
      _headSha256,
      stateJson,
      entrySha256);
    var bytes = JsonSerializer.SerializeToUtf8Bytes(envelope, JsonOptions);
    await _stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
    await _stream.WriteAsync("\n"u8.ToArray(), cancellationToken).ConfigureAwait(false);
    await _stream.FlushAsync(cancellationToken).ConfigureAwait(false);
    _stream.Flush(flushToDisk: true);

    _lastSequence = state.Sequence;
    _headSha256 = entrySha256;
    _byRequest[state.Request.RequestId] = state;
    _byAction[state.Request.Action.ActionId] = state;
  }

  public ValueTask DisposeAsync()
  {
    if (Interlocked.Exchange(ref _disposed, 1) == 0)
    {
      _stream.Dispose();
      _ownershipLock.Dispose();
    }
    return ValueTask.CompletedTask;
  }

  private void LoadAndVerify()
  {
    _stream.Position = 0;
    if (_stream.Length != 0)
    {
      _stream.Position = _stream.Length - 1;
      if (_stream.ReadByte() != '\n')
      {
        throw new InvalidDataException(
          "The isolation journal has an incomplete final record.");
      }
      _stream.Position = 0;
    }
    using var reader = new StreamReader(
      _stream,
      new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true),
      detectEncodingFromByteOrderMarks: false,
      bufferSize: 16_384,
      leaveOpen: true);
    string? line;
    while ((line = reader.ReadLine()) is not null)
    {
      if (string.IsNullOrWhiteSpace(line))
      {
        throw new InvalidDataException("The isolation journal contains an empty record.");
      }
      if (Encoding.UTF8.GetByteCount(line) > 1_048_576)
      {
        throw new InvalidDataException("The isolation journal record is oversized.");
      }

      JournalEnvelope envelope;
      IsolationLifecycleState state;
      try
      {
        envelope = JsonSerializer.Deserialize<JournalEnvelope>(line, JsonOptions)
          ?? throw new JsonException();
        state = JsonSerializer.Deserialize<IsolationLifecycleState>(
          envelope.StateJson,
          JsonOptions) ?? throw new JsonException();
      }
      catch (JsonException exception)
      {
        throw new InvalidDataException("The isolation journal is malformed.", exception);
      }

      var expectedSequence = checked(_lastSequence + 1);
      var expectedSha256 = EntrySha256(
        envelope.Sequence,
        envelope.PreviousSha256,
        envelope.StateJson);
      if (envelope.Sequence != expectedSequence
        || state.Sequence != envelope.Sequence
        || !DigestEquals(envelope.PreviousSha256, _headSha256)
        || !DigestEquals(envelope.EntrySha256, expectedSha256))
      {
        throw new InvalidDataException(
          "The isolation journal hash chain is discontinuous.");
      }

      ValidateTransition(state);
      _lastSequence = envelope.Sequence;
      _headSha256 = envelope.EntrySha256;
      _byRequest[state.Request.RequestId] = state;
      _byAction[state.Request.Action.ActionId] = state;
    }
  }

  private void ValidateTransition(IsolationLifecycleState next)
  {
    ValidateShape(next);
    var existing = _byRequest.GetValueOrDefault(next.Request.RequestId);
    var actionExisting = _byAction.GetValueOrDefault(next.Request.Action.ActionId);
    if (existing is null)
    {
      if (next.Phase != IsolationLifecyclePhase.Reserved
        || actionExisting is not null)
      {
        throw new InvalidDataException(
          "An isolation lifecycle must begin with one unique reservation.");
      }
      return;
    }

    if (actionExisting is null
      || !string.Equals(
        actionExisting.Request.RequestId,
        existing.Request.RequestId,
        StringComparison.Ordinal)
      || !RequestEquals(existing.Request, next.Request)
      || !SignedLeaseEquals(existing.SignedLease, next.SignedLease))
    {
      throw new InvalidDataException("The isolation lifecycle identity changed.");
    }

    var allowed = existing.Phase switch
    {
      IsolationLifecyclePhase.Reserved => next.Phase is
        IsolationLifecyclePhase.Released or IsolationLifecyclePhase.Bound,
      IsolationLifecyclePhase.Bound => next.Phase == IsolationLifecyclePhase.Settled,
      _ => false,
    };
    if (!allowed)
    {
      throw new InvalidDataException("The isolation lifecycle transition is invalid.");
    }
  }

  private static void ValidateShape(IsolationLifecycleState state)
  {
    if (state.Sequence <= 0
      || state.Request is null
      || state.SignedLease is null
      || state.SignedLease.Lease.Sequence > state.Sequence
      || !RequestEquals(state.Request, state.SignedLease.Lease)
      || state.Phase switch
      {
        IsolationLifecyclePhase.Reserved => state.SignedRelease is not null
          || state.Binding is not null
          || state.SignedAcknowledgement is not null
          || state.EnforcementLeaseId is not null
          || state.BindEnforcementEvidenceSha256 is not null
          || state.SignedReceipt is not null,
        IsolationLifecyclePhase.Released => state.SignedRelease is null
          || state.Binding is not null
          || state.SignedAcknowledgement is not null
          || state.EnforcementLeaseId is not null
          || state.BindEnforcementEvidenceSha256 is not null
          || state.SignedReceipt is not null,
        IsolationLifecyclePhase.Bound => state.SignedRelease is not null
          || state.Binding is null
          || state.SignedAcknowledgement is null
          || !CanonicalGuid(state.EnforcementLeaseId)
          || !CanonicalSha256(state.BindEnforcementEvidenceSha256)
          || state.SignedReceipt is not null,
        IsolationLifecyclePhase.Settled => state.SignedRelease is not null
          || state.Binding is null
          || state.SignedAcknowledgement is null
          || !CanonicalGuid(state.EnforcementLeaseId)
          || !CanonicalSha256(state.BindEnforcementEvidenceSha256)
          || state.SignedReceipt is null,
        _ => true,
      })
    {
      throw new InvalidDataException("The isolation lifecycle record shape is invalid.");
    }

    if (state.SignedRelease is not null
      && state.SignedRelease.Release.Sequence != state.Sequence
      || state.SignedAcknowledgement is not null
      && state.SignedAcknowledgement.Acknowledgement.Sequence
        > state.Sequence
      || state.SignedReceipt is not null
      && state.SignedReceipt.Receipt.Sequence != state.Sequence)
    {
      throw new InvalidDataException("The isolation evidence sequence is inconsistent.");
    }
  }

  private static bool RequestEquals(
    PrivilegedCommandIsolationReservationRequestV1 request,
    PrivilegedCommandIsolationReservationLeaseV1 lease) =>
    DigestEquals(
      PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
      lease.ReservationRequestSha256);

  private static bool RequestEquals(
    PrivilegedCommandIsolationReservationRequestV1 left,
    PrivilegedCommandIsolationReservationRequestV1 right) =>
    DigestEquals(
      PrivilegedCommandIsolationCanonical.ReservationRequestSha256(left),
      PrivilegedCommandIsolationCanonical.ReservationRequestSha256(right));

  private static bool SignedLeaseEquals(
    SignedPrivilegedCommandIsolationReservationLease left,
    SignedPrivilegedCommandIsolationReservationLease right) =>
    string.Equals(left.KeyId, right.KeyId, StringComparison.Ordinal)
    && string.Equals(left.SignatureBase64, right.SignatureBase64, StringComparison.Ordinal)
    && DigestEquals(
      PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(left.Lease),
      PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(right.Lease));

  private static string EntrySha256(long sequence, string previous, string stateJson) =>
    Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
      $"msaidizi-isolation-supervisor-journal/v1\n{sequence}\n{previous}\n{stateJson}")))
      .ToLowerInvariant();

  private static bool CanonicalSha256(string? value) =>
    value is not null
    && PayloadDigest.IsSha256Hex(value)
    && string.Equals(value, value.ToLowerInvariant(), StringComparison.Ordinal);

  private static bool CanonicalGuid(string? value) =>
    value is not null
    && Guid.TryParseExact(value, "D", out var parsed)
    && parsed != Guid.Empty
    && string.Equals(parsed.ToString("D"), value, StringComparison.Ordinal);

  private static bool DigestEquals(string left, string right) =>
    CanonicalSha256(left)
    && CanonicalSha256(right)
    && PayloadDigest.FixedTimeEqualsHex(left, right);

  private void ThrowIfDisposed() =>
    ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);

  private static void ValidateFileHandle(
    SafeFileHandle handle,
    string expectedPath,
    string description)
  {
    if (!GetFileInformationByHandle(handle, out var information))
    {
      throw new IOException(
        $"The isolation lifecycle {description} identity is unavailable.",
        new Win32Exception(Marshal.GetLastWin32Error()));
    }
    if (information.NumberOfLinks != 1
      || (information.FileAttributes & FileAttributeReparsePoint) != 0
      || (information.FileAttributes & FileAttributeDirectory) != 0)
    {
      throw new UnauthorizedAccessException(
        $"The isolation lifecycle {description} must be a single-link non-reparse file.");
    }

    var actualPath = GetFinalPath(handle);
    if (!string.Equals(
      Path.TrimEndingDirectorySeparator(actualPath),
      Path.TrimEndingDirectorySeparator(Path.GetFullPath(expectedPath)),
      StringComparison.OrdinalIgnoreCase))
    {
      throw new UnauthorizedAccessException(
        $"The isolation lifecycle {description} resolved to an unexpected path.");
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
          "The isolation lifecycle file final path is unavailable.",
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
    throw new IOException("The isolation lifecycle file final path is too long.");
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetFileInformationByHandle(
    SafeFileHandle file,
    out ByHandleFileInformation fileInformation);

  [LibraryImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW",
    SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
  private static unsafe partial uint GetFinalPathNameByHandle(
    SafeFileHandle file,
    char* filePath,
    uint filePathLength,
    uint flags);

  [StructLayout(LayoutKind.Sequential)]
  private struct ByHandleFileInformation
  {
    public uint FileAttributes;
    public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
    public uint VolumeSerialNumber;
    public uint FileSizeHigh;
    public uint FileSizeLow;
    public uint NumberOfLinks;
    public uint FileIndexHigh;
    public uint FileIndexLow;
  }

  private sealed record JournalEnvelope(
    long Sequence,
    string PreviousSha256,
    string StateJson,
    string EntrySha256);
}
