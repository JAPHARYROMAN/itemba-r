using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.Security;

public interface IEgressBoundaryClient
{
  ValueTask<SignedCapabilityBoundaryAttestation?> TryAttestCapabilitiesAsync(
    CapabilityBoundaryAttestationRequestV1 request,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    return ValueTask.FromResult<SignedCapabilityBoundaryAttestation?>(null);
  }

  ValueTask<IEgressBoundarySession?> TryReserveAsync(
    string compactActionToken,
    string argumentsJsonUtf8,
    EgressActionBinding binding,
    CancellationToken cancellationToken);

  /// <summary>
  /// Reconstructs a local session around an already signed authorization. The
  /// external supervisor remains the authoritative durable lifecycle owner;
  /// repeating an exact registration or terminal operation must be idempotent.
  /// </summary>
  ValueTask<IEgressBoundarySession?> TryResumeAsync(
    EgressExecutionAuthorization authorization,
    EgressActionBinding binding,
    CancellationToken cancellationToken);
}

/// <summary>
/// Marker for adapters that understand the independent supervisor lifecycle.
/// Classified adapters without this contract are refused before adapter entry,
/// even when a production supervisor transport is configured.
/// </summary>
public interface IEgressLifecycleCapabilityAdapter : IHostCapabilityAdapter
{
  ValueTask<CapabilityExecutionResult> ExecuteWithEgressAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    IEgressBoundarySession session,
    CancellationToken cancellationToken);
}

/// <summary>
/// Production default until a deployment-owned WFP supervisor is installed
/// and independently attested. It can never mint or accept an authorization.
/// </summary>
internal sealed class DisabledEgressBoundaryClient : IEgressBoundaryClient
{
  public ValueTask<SignedCapabilityBoundaryAttestation?> TryAttestCapabilitiesAsync(
    CapabilityBoundaryAttestationRequestV1 request,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    return ValueTask.FromResult<SignedCapabilityBoundaryAttestation?>(null);
  }

  public ValueTask<IEgressBoundarySession?> TryReserveAsync(
    string compactActionToken,
    string argumentsJsonUtf8,
    EgressActionBinding binding,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    return ValueTask.FromResult<IEgressBoundarySession?>(null);
  }

  public ValueTask<IEgressBoundarySession?> TryResumeAsync(
    EgressExecutionAuthorization authorization,
    EgressActionBinding binding,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    return ValueTask.FromResult<IEgressBoundarySession?>(null);
  }
}

internal interface IEgressReceiptReplayStore
{
  ValueTask InitializeAsync(CancellationToken cancellationToken);

  ValueTask<bool> TryCommitAsync(
    string receiptId,
    string actionId,
    string receiptSha256,
    string authorizationLeaseId,
    string boundaryBootId,
    long receiptSequence,
    CancellationToken cancellationToken);
}

public interface ILocalSystemEgressEvidenceVerifier
{
  EgressVerificationResult<VerifiedEgressAuthorization> VerifyAuthorization(
    EgressExecutionAuthorization authorization,
    EgressActionBinding binding,
    IReadOnlyCollection<string> requiredFeatures);

  ValueTask<EgressVerificationResult<VerifiedEgressReceipt>> VerifyAndCommitReceiptAsync(
    EgressExecutionEvidence evidence,
    EgressActionBinding binding,
    IReadOnlyCollection<string> requiredFeatures,
    CancellationToken cancellationToken);
}

internal sealed class LocalSystemEgressEvidenceVerifier(
  EgressBoundaryContractVerifier contracts,
  IEgressReceiptReplayStore replayStore,
  EgressBoundaryDispatchLatch dispatchLatch) : ILocalSystemEgressEvidenceVerifier
{
  public EgressVerificationResult<VerifiedEgressAuthorization> VerifyAuthorization(
    EgressExecutionAuthorization authorization,
    EgressActionBinding binding,
    IReadOnlyCollection<string> requiredFeatures) => contracts.VerifyAuthorization(
      authorization,
      binding,
      requiredFeatures);

  public async ValueTask<EgressVerificationResult<VerifiedEgressReceipt>>
    VerifyAndCommitReceiptAsync(
      EgressExecutionEvidence evidence,
      EgressActionBinding binding,
      IReadOnlyCollection<string> requiredFeatures,
      CancellationToken cancellationToken)
  {
    var verified = contracts.VerifyReceipt(evidence, binding, requiredFeatures);
    if (!verified.IsValid || verified.Value is null)
    {
      dispatchLatch.Trip();
      throw new EgressBoundaryUnsafeException(
        verified.ErrorCode ?? "egress_receipt_invalid",
        mayHaveExecuted: true);
    }

    dispatchLatch.ThrowIfTripped();
    try
    {
      var committed = await replayStore.TryCommitAsync(
        verified.Value.Evidence.Receipt.Receipt.ReceiptId,
        verified.Value.Evidence.Receipt.Receipt.ActionId,
        verified.Value.ReceiptSha256,
        verified.Value.Evidence.Authorization.Lease.Lease.LeaseId,
        verified.Value.Authorization.Attestation.SignedAttestation.Attestation.BootId,
        verified.Value.Evidence.Receipt.Receipt.Sequence,
        cancellationToken).ConfigureAwait(false);
      if (committed)
      {
        return verified;
      }

      dispatchLatch.Trip();
      throw new EgressBoundaryUnsafeException(
        "egress_receipt_replay_conflict",
        mayHaveExecuted: true);
    }
    catch (EgressBoundaryUnsafeException)
    {
      throw;
    }
    catch (Exception exception)
    {
      dispatchLatch.Trip();
      throw new EgressBoundaryUnsafeException(
        "egress_receipt_replay_unavailable",
        mayHaveExecuted: true,
        exception);
    }
  }
}

/// <summary>
/// Process-lifetime fuse for egress evidence integrity. It is deliberately
/// one-way: startup must verify the durable replay ledger before broker intake,
/// and any later replay failure permanently refuses further egress dispatch.
/// </summary>
public sealed class EgressBoundaryDispatchLatch
{
  private int _tripped;

  public bool IsTripped => Volatile.Read(ref _tripped) != 0;

  public void Trip() => Interlocked.Exchange(ref _tripped, 1);

  public void ThrowIfTripped()
  {
    if (IsTripped)
    {
      throw new EgressBoundaryUnsafeException(
        "egress_replay_reconciliation_required",
        mayHaveExecuted: false);
    }
  }
}

/// <summary>
/// Durable egress evidence could not be committed or verified. The coordinator
/// must persist conservative ambiguity and rethrow so broker intake stops.
/// </summary>
internal sealed class EgressBoundaryUnsafeException : Exception
{
  public EgressBoundaryUnsafeException(
    string errorCode,
    bool mayHaveExecuted,
    Exception? innerException = null)
    : base(errorCode, innerException)
  {
    ErrorCode = errorCode;
    MayHaveExecuted = mayHaveExecuted;
  }

  public string ErrorCode { get; }

  public bool MayHaveExecuted { get; }
}

/// <summary>
/// Append-only receipt replay ledger. Hash-chain verification makes corruption
/// fail closed; the deployment installer must additionally ACL its directory
/// to LocalSystem, the restricted companion service, and read-only recovery
/// operators while excluding interactive administrators and ordinary users.
/// </summary>
internal sealed partial class FileEgressReceiptReplayStore : IEgressReceiptReplayStore, IDisposable
{
  private const int FormatVersion = 1;
  private const long MaximumLedgerBytes = 67_108_864;
  private const int MaximumLineCharacters = 16_384;
  private const int MaximumEntries = 200_000;
  private const string GenesisHash =
    "0000000000000000000000000000000000000000000000000000000000000000";
  private static readonly JsonSerializerOptions SerializerOptions = new(
    JsonSerializerDefaults.Web)
  {
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
  };

  private readonly string _path;
  private readonly bool _requireInstallerBoundary;
  private readonly SemaphoreSlim _gate = new(1, 1);
  private readonly Dictionary<string, ReplayEntry> _receiptIds = new(StringComparer.Ordinal);
  private readonly Dictionary<string, ReplayEntry> _actionIds = new(StringComparer.Ordinal);
  private readonly Dictionary<string, ReplayEntry> _receiptDigests =
    new(StringComparer.OrdinalIgnoreCase);
  private readonly Dictionary<string, ReplayEntry> _authorizationLeaseIds =
    new(StringComparer.Ordinal);
  private readonly Dictionary<string, long> _lastReceiptSequenceByBootId =
    new(StringComparer.Ordinal);
  private FileStream? _ownershipLock;
  private FileStream? _ledger;
  private bool _initialized;
  private bool _faulted;
  private bool _disposed;
  private long _sequence;
  private string _head = GenesisHash;

  public FileEgressReceiptReplayStore(
    string path,
    bool requireInstallerBoundary = false)
  {
    _path = ResolveProtectedPath(path, requireInstallerBoundary);
    _requireInstallerBoundary = requireInstallerBoundary;
  }

  public ValueTask InitializeAsync(CancellationToken cancellationToken) =>
    EnsureInitializedAsync(cancellationToken);

  public async ValueTask<bool> TryCommitAsync(
    string receiptId,
    string actionId,
    string receiptSha256,
    string authorizationLeaseId,
    string boundaryBootId,
    long receiptSequence,
    CancellationToken cancellationToken)
  {
    ObjectDisposedException.ThrowIf(_disposed, this);
    if (!CanonicalGuid(receiptId)
      || !CanonicalGuid(actionId)
      || !PayloadDigest.IsSha256Hex(receiptSha256)
      || !CanonicalGuid(authorizationLeaseId)
      || !CanonicalGuid(boundaryBootId)
      || receiptSequence <= 0)
    {
      return false;
    }

    await EnsureInitializedAsync(cancellationToken).ConfigureAwait(false);
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      if (_faulted)
      {
        throw new InvalidDataException("The egress receipt replay ledger is faulted.");
      }
      cancellationToken.ThrowIfCancellationRequested();

      if (_receiptIds.TryGetValue(receiptId, out var existing))
      {
        return ExactEvidence(
          existing,
          receiptId,
          actionId,
          receiptSha256,
          authorizationLeaseId,
          boundaryBootId,
          receiptSequence);
      }
      if (_actionIds.ContainsKey(actionId)
        || _receiptDigests.ContainsKey(receiptSha256)
        || _authorizationLeaseIds.ContainsKey(authorizationLeaseId)
        || (_lastReceiptSequenceByBootId.TryGetValue(boundaryBootId, out var lastSequence)
          && receiptSequence <= lastSequence))
      {
        return false;
      }
      if (_sequence >= MaximumEntries)
      {
        throw new InvalidDataException("The egress receipt replay ledger is full.");
      }

      var entry = CreateEntry(
        _sequence + 1,
        receiptId,
        actionId,
        receiptSha256,
        authorizationLeaseId,
        boundaryBootId,
        receiptSequence,
        _head);
      try
      {
        AppendDurably(entry);
        Accept(entry);
        return true;
      }
      catch (Exception exception) when (IsStorageFailure(exception))
      {
        _faulted = true;
        throw;
      }
    }
    finally
    {
      _gate.Release();
    }
  }

  public void Dispose()
  {
    if (_disposed)
    {
      return;
    }
    _disposed = true;
    _ledger?.Dispose();
    _ownershipLock?.Dispose();
    _gate.Dispose();
  }

  private async ValueTask EnsureInitializedAsync(CancellationToken cancellationToken)
  {
    ObjectDisposedException.ThrowIf(_disposed, this);
    if (_initialized)
    {
      return;
    }

    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      if (_initialized)
      {
        return;
      }
      if (_faulted)
      {
        throw new InvalidDataException("The egress receipt replay ledger is faulted.");
      }

      try
      {
        PrepareProtectedPath();
        if (_requireInstallerBoundary)
        {
          EgressReplayRuntimeBoundary.ValidateExactInstallerAcl(
            Path.GetDirectoryName(_path)
              ?? throw new InvalidOperationException("The egress replay path has no parent."),
            _path,
            $"{_path}.lock");
        }
        var openMode = _requireInstallerBoundary ? FileMode.Open : FileMode.OpenOrCreate;
        _ownershipLock = OpenOwnedFile($"{_path}.lock", openMode);
        _ledger = OpenOwnedFile(_path, openMode);
        VerifyCanonicalExistingPath(_path, expectDirectory: false);
        LoadAndVerify(_ledger);
        _ledger.Seek(0, SeekOrigin.End);
        _initialized = true;
      }
      catch
      {
        _faulted = true;
        _ledger?.Dispose();
        _ledger = null;
        _ownershipLock?.Dispose();
        _ownershipLock = null;
        throw;
      }
    }
    finally
    {
      _gate.Release();
    }
  }

  private void AppendDurably(ReplayEntry entry)
  {
    PrepareProtectedPath();
    if (_ledger is null)
    {
      throw new IOException("The egress receipt replay ledger is not open.");
    }

    var line = JsonSerializer.Serialize(entry, SerializerOptions);
    if (line.Length > MaximumLineCharacters)
    {
      throw new InvalidDataException("The egress receipt replay record is too large.");
    }
    var bytes = Encoding.UTF8.GetBytes(line + "\n");
    try
    {
      if (_ledger.Length > MaximumLedgerBytes - bytes.Length)
      {
        throw new InvalidDataException("The egress receipt replay ledger is full.");
      }
      _ledger.Write(bytes);
      _ledger.Flush(flushToDisk: true);
    }
    finally
    {
      Array.Clear(bytes);
    }
  }

  private void LoadAndVerify(FileStream stream)
  {
    if (stream.Length > MaximumLedgerBytes)
    {
      throw new InvalidDataException("The egress receipt replay ledger is too large.");
    }
    if (stream.Length > 0)
    {
      stream.Seek(-1, SeekOrigin.End);
      if (stream.ReadByte() != '\n')
      {
        throw new InvalidDataException("The egress receipt replay ledger has a partial record.");
      }
    }

    stream.Seek(0, SeekOrigin.Begin);
    using var reader = new StreamReader(
      stream,
      new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true),
      detectEncodingFromByteOrderMarks: false,
      bufferSize: 4_096,
      leaveOpen: true);
    string? line;
    var count = 0;
    while ((line = reader.ReadLine()) is not null)
    {
      count++;
      if (count > MaximumEntries
        || string.IsNullOrWhiteSpace(line)
        || line.Length > MaximumLineCharacters)
      {
        throw new InvalidDataException("The egress receipt replay ledger is malformed.");
      }

      ReplayEntry entry;
      try
      {
        entry = JsonSerializer.Deserialize<ReplayEntry>(line, SerializerOptions)
          ?? throw new InvalidDataException("The egress receipt replay record is empty.");
      }
      catch (JsonException exception)
      {
        throw new InvalidDataException(
          "The egress receipt replay ledger contains invalid JSON.",
          exception);
      }

      if (!string.Equals(
          JsonSerializer.Serialize(entry, SerializerOptions),
          line,
          StringComparison.Ordinal)
        || !EntryValid(entry, checked(_sequence + 1), _head)
        || _receiptIds.ContainsKey(entry.ReceiptId)
        || _actionIds.ContainsKey(entry.ActionId)
        || _receiptDigests.ContainsKey(entry.ReceiptSha256)
        || _authorizationLeaseIds.ContainsKey(entry.AuthorizationLeaseId)
        || (_lastReceiptSequenceByBootId.TryGetValue(
            entry.BoundaryBootId,
            out var lastSequence)
          && entry.ReceiptSequence <= lastSequence))
      {
        throw new InvalidDataException(
          "The egress receipt replay ledger failed hash-chain verification.");
      }
      Accept(entry);
    }
  }

  private void Accept(ReplayEntry entry)
  {
    _receiptIds.Add(entry.ReceiptId, entry);
    _actionIds.Add(entry.ActionId, entry);
    _receiptDigests.Add(entry.ReceiptSha256, entry);
    _authorizationLeaseIds.Add(entry.AuthorizationLeaseId, entry);
    _lastReceiptSequenceByBootId[entry.BoundaryBootId] = entry.ReceiptSequence;
    _sequence = entry.Sequence;
    _head = entry.EntrySha256;
  }

  private static ReplayEntry CreateEntry(
    long sequence,
    string receiptId,
    string actionId,
    string receiptSha256,
    string authorizationLeaseId,
    string boundaryBootId,
    long receiptSequence,
    string previousSha256)
  {
    var unsigned = new ReplayEntry(
      FormatVersion,
      sequence,
      receiptId,
      actionId,
      receiptSha256.ToLowerInvariant(),
      authorizationLeaseId,
      boundaryBootId,
      receiptSequence,
      previousSha256.ToLowerInvariant(),
      string.Empty);
    return unsigned with { EntrySha256 = EntrySha256(unsigned) };
  }

  private static bool EntryValid(ReplayEntry entry, long sequence, string previousSha256) =>
    entry.FormatVersion == FormatVersion
    && entry.Sequence == sequence
    && CanonicalGuid(entry.ReceiptId)
    && CanonicalGuid(entry.ActionId)
    && PayloadDigest.IsSha256Hex(entry.ReceiptSha256)
    && CanonicalGuid(entry.AuthorizationLeaseId)
    && CanonicalGuid(entry.BoundaryBootId)
    && entry.ReceiptSequence > 0
    && PayloadDigest.IsSha256Hex(entry.PreviousSha256)
    && PayloadDigest.IsSha256Hex(entry.EntrySha256)
    && PayloadDigest.FixedTimeEqualsHex(entry.PreviousSha256, previousSha256)
    && PayloadDigest.FixedTimeEqualsHex(entry.EntrySha256, EntrySha256(entry));

  private static bool ExactEvidence(
    ReplayEntry existing,
    string receiptId,
    string actionId,
    string receiptSha256,
    string authorizationLeaseId,
    string boundaryBootId,
    long receiptSequence) => string.Equals(
      existing.ReceiptId,
      receiptId,
      StringComparison.Ordinal)
    && string.Equals(existing.ActionId, actionId, StringComparison.Ordinal)
    && PayloadDigest.FixedTimeEqualsHex(existing.ReceiptSha256, receiptSha256)
    && string.Equals(
      existing.AuthorizationLeaseId,
      authorizationLeaseId,
      StringComparison.Ordinal)
    && string.Equals(existing.BoundaryBootId, boundaryBootId, StringComparison.Ordinal)
    && existing.ReceiptSequence == receiptSequence;

  private static string EntrySha256(ReplayEntry entry) => PayloadDigest.Sha256Hex(string.Join('\n',
    "itemba-msaidizi-egress-receipt-replay-v1",
    entry.FormatVersion.ToString(System.Globalization.CultureInfo.InvariantCulture),
    entry.Sequence.ToString(System.Globalization.CultureInfo.InvariantCulture),
    Convert.ToBase64String(Encoding.UTF8.GetBytes(entry.ReceiptId)),
    Convert.ToBase64String(Encoding.UTF8.GetBytes(entry.ActionId)),
    entry.ReceiptSha256.ToLowerInvariant(),
    Convert.ToBase64String(Encoding.UTF8.GetBytes(entry.AuthorizationLeaseId)),
    Convert.ToBase64String(Encoding.UTF8.GetBytes(entry.BoundaryBootId)),
    entry.ReceiptSequence.ToString(System.Globalization.CultureInfo.InvariantCulture),
    entry.PreviousSha256.ToLowerInvariant()));

  private static bool CanonicalGuid(string value) =>
    Guid.TryParseExact(value, "D", out var parsed)
    && string.Equals(parsed.ToString("D"), value, StringComparison.Ordinal);

  private static string ResolveProtectedPath(
    string configured,
    bool requireInstallerBoundary)
  {
    var expanded = Environment.ExpandEnvironmentVariables(configured ?? string.Empty);
    if (string.IsNullOrWhiteSpace(expanded)
      || !Path.IsPathFullyQualified(expanded)
      || expanded.StartsWith(@"\\", StringComparison.Ordinal)
      || expanded.StartsWith(@"\\?\", StringComparison.Ordinal)
      || expanded.StartsWith(@"\\.\", StringComparison.Ordinal)
      || expanded.StartsWith(@"\??\", StringComparison.OrdinalIgnoreCase))
    {
      throw new ArgumentException(
        "The egress replay ledger path must be a canonical local DOS path.",
        nameof(configured));
    }

    var configuredRoot = Path.GetPathRoot(expanded);
    var configuredRelative = configuredRoot is null
      ? string.Empty
      : expanded[configuredRoot.Length..];
    if (ContainsUnsafeDosSegments(configuredRelative))
    {
      throw new ArgumentException(
        "The egress replay ledger cannot use a DOS device or aliased path.",
        nameof(configured));
    }

    var full = Path.GetFullPath(expanded);
    var root = Path.GetPathRoot(full);
    var relative = root is null ? string.Empty : full[root.Length..];
    if (string.IsNullOrWhiteSpace(root)
      || root.StartsWith(@"\\", StringComparison.Ordinal)
      || relative.Contains(':', StringComparison.Ordinal)
      || ContainsUnsafeDosSegments(relative)
      || string.IsNullOrWhiteSpace(Path.GetFileName(full)))
    {
      throw new ArgumentException(
        "The egress replay ledger cannot use a network, device, directory, or alternate-data-stream path.",
        nameof(configured));
    }
    if (requireInstallerBoundary)
    {
      var programData = Environment.ExpandEnvironmentVariables("%ProgramData%");
      if (programData.Contains('%', StringComparison.Ordinal))
      {
        throw new ArgumentException(
          "The installer-owned ProgramData root is unavailable.",
          nameof(configured));
      }
      var expected = Path.GetFullPath(Path.Combine(
        programData,
        "Itemba",
        "Msaidizi",
        "supervisor",
        "egress-boundary",
        "receipts.v1.jsonl"));
      if (!string.Equals(full, expected, StringComparison.OrdinalIgnoreCase))
      {
        throw new ArgumentException(
          "Production egress replay state must use the exact installer-owned path.",
          nameof(configured));
      }
    }
    return full;
  }

  private static bool ContainsUnsafeDosSegments(string relative) => relative.Split(
      [Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar],
      StringSplitOptions.RemoveEmptyEntries)
    .Any(segment => segment.EndsWith(' ')
      || segment.EndsWith('.')
      || IsDosDeviceName(segment));

  private static bool IsDosDeviceName(string segment)
  {
    var stem = segment.Split('.', 2)[0];
    if (stem.Equals("CON", StringComparison.OrdinalIgnoreCase)
      || stem.Equals("PRN", StringComparison.OrdinalIgnoreCase)
      || stem.Equals("AUX", StringComparison.OrdinalIgnoreCase)
      || stem.Equals("NUL", StringComparison.OrdinalIgnoreCase)
      || stem.Equals("CONIN$", StringComparison.OrdinalIgnoreCase)
      || stem.Equals("CONOUT$", StringComparison.OrdinalIgnoreCase))
    {
      return true;
    }
    return stem.Length == 4
      && (stem.StartsWith("COM", StringComparison.OrdinalIgnoreCase)
        || stem.StartsWith("LPT", StringComparison.OrdinalIgnoreCase))
      && (stem[3] is >= '1' and <= '9' or '¹' or '²' or '³');
  }

  private void PrepareProtectedPath()
  {
    var directory = Path.GetDirectoryName(_path)
      ?? throw new InvalidOperationException("The egress replay path has no parent.");
    EnsureDirectoryTreeHasNoReparsePoints(directory, allowCreate: !_requireInstallerBoundary);
    VerifyCanonicalExistingPath(directory, expectDirectory: true);
    VerifyCanonicalExistingPath(_path, expectDirectory: false, allowMissing: true);
    VerifyCanonicalExistingPath($"{_path}.lock", expectDirectory: false, allowMissing: true);
  }

  private static void EnsureDirectoryTreeHasNoReparsePoints(
    string directory,
    bool allowCreate)
  {
    var full = Path.GetFullPath(directory);
    var root = Path.GetPathRoot(full)
      ?? throw new ArgumentException("The protected egress replay path has no volume root.");
    var current = root;
    foreach (var segment in full[root.Length..].Split(
      Path.DirectorySeparatorChar,
      StringSplitOptions.RemoveEmptyEntries))
    {
      current = Path.Combine(current, segment);
      try
      {
        _ = File.GetAttributes(current);
      }
      catch (Exception exception) when (IsAbsentPath(exception))
      {
        if (!allowCreate)
        {
          throw new UnauthorizedAccessException(
            "The installer-owned egress replay directory is missing.",
            exception);
        }
        Directory.CreateDirectory(current);
      }
      VerifyCanonicalExistingPath(current, expectDirectory: true);
    }
  }

  private static void VerifyCanonicalExistingPath(
    string path,
    bool expectDirectory,
    bool allowMissing = false)
  {
    FileAttributes attributes;
    try
    {
      attributes = File.GetAttributes(path);
    }
    catch (Exception exception) when (allowMissing && IsAbsentPath(exception))
    {
      return;
    }
    if ((attributes & FileAttributes.ReparsePoint) != 0
      || expectDirectory != ((attributes & FileAttributes.Directory) != 0))
    {
      throw new UnauthorizedAccessException(
        "A protected egress replay path is indirect or has the wrong type.");
    }
  }

  private static bool IsAbsentPath(Exception exception) => exception is
    FileNotFoundException or DirectoryNotFoundException;

  private static FileStream OpenOwnedFile(string path, FileMode mode)
  {
    var creationDisposition = mode switch
    {
      FileMode.Open => 3u,
      FileMode.OpenOrCreate => 4u,
      _ => throw new ArgumentOutOfRangeException(nameof(mode)),
    };
    var handle = CreateReplayFile(
      path,
      desiredAccess: 0xC0000000,
      shareMode: 0x00000001,
      securityAttributes: IntPtr.Zero,
      creationDisposition,
      flagsAndAttributes: 0x80200080,
      templateFile: IntPtr.Zero);
    if (handle.IsInvalid)
    {
      var error = Marshal.GetLastWin32Error();
      handle.Dispose();
      throw new IOException(
        "The protected egress replay file could not be opened.",
        new Win32Exception(error));
    }

    try
    {
      if (!GetReplayFileInformation(handle, out var information))
      {
        throw new IOException(
          "The protected egress replay file identity is unavailable.",
          new Win32Exception(Marshal.GetLastWin32Error()));
      }
      if ((information.FileAttributes & 0x00000400) != 0
        || (information.FileAttributes & 0x00000010) != 0
        || information.NumberOfLinks != 1)
      {
        throw new UnauthorizedAccessException(
          "The protected egress replay file is indirect, hard-linked, or has the wrong type.");
      }
      var finalPath = GetFinalReplayPath(handle);
      if (!string.Equals(
        Path.TrimEndingDirectorySeparator(finalPath),
        Path.TrimEndingDirectorySeparator(Path.GetFullPath(path)),
        StringComparison.OrdinalIgnoreCase))
      {
        throw new UnauthorizedAccessException(
          "The protected egress replay handle resolved to an unexpected path.");
      }
      return new FileStream(
        handle,
        FileAccess.ReadWrite,
        bufferSize: 4_096,
        isAsync: false);
    }
    catch
    {
      handle.Dispose();
      throw;
    }
  }

  private static string GetFinalReplayPath(SafeFileHandle handle)
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
          length = GetFinalReplayPathName(
            handle,
            pointer,
            checked((uint)buffer.Length),
            0);
        }
      }
      if (length == 0)
      {
        throw new IOException(
          "The protected egress replay final path is unavailable.",
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
    throw new IOException("The protected egress replay final path is too long.");
  }

  [LibraryImport("kernel32.dll", EntryPoint = "CreateFileW", SetLastError = true,
    StringMarshalling = StringMarshalling.Utf16)]
  private static partial SafeFileHandle CreateReplayFile(
    string fileName,
    uint desiredAccess,
    uint shareMode,
    IntPtr securityAttributes,
    uint creationDisposition,
    uint flagsAndAttributes,
    IntPtr templateFile);

  [LibraryImport("kernel32.dll", EntryPoint = "GetFileInformationByHandle",
    SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool GetReplayFileInformation(
    SafeFileHandle file,
    out ReplayFileInformation fileInformation);

  [LibraryImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW",
    SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
  private static unsafe partial uint GetFinalReplayPathName(
    SafeFileHandle file,
    char* filePath,
    uint filePathLength,
    uint flags);

  private static bool IsStorageFailure(Exception exception) => exception is
    IOException or UnauthorizedAccessException or InvalidDataException or JsonException;

  private sealed record ReplayEntry(
    int FormatVersion,
    long Sequence,
    string ReceiptId,
    string ActionId,
    string ReceiptSha256,
    string AuthorizationLeaseId,
    string BoundaryBootId,
    long ReceiptSequence,
    string PreviousSha256,
    string EntrySha256);

  [StructLayout(LayoutKind.Sequential)]
  private struct ReplayFileInformation
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

internal sealed class RejectingEgressAttestationKeyResolver : IEgressAttestationKeyResolver
{
  public bool TryResolve(string keyId, out System.Security.Cryptography.ECDsa? publicKey)
  {
    publicKey = null;
    return false;
  }
}
