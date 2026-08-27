using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Service.Security;

/// <summary>
/// Protected consuming-service replay ledger for the independently signed
/// privileged-command isolation lifecycle. A verified reservation is committed
/// before process creation, a verified bind before ResumeThread, and a verified
/// release or terminal receipt before reporting a terminal action outcome.
/// The persisted recovery material contains signed contracts and digests only;
/// it never contains a raw action token, command line, output, or secret.
/// Deployment must ACL the containing directory to SYSTEM and the exact
/// restricted companion service SID, with audit-only operator access, before
/// enabling privileged command execution.
/// </summary>
internal sealed class FilePrivilegedCommandIsolationReplayStore :
  IPrivilegedCommandIsolationReplayStore,
  IDisposable
{
  private const int FormatVersion = 1;
  private const long MaximumLedgerBytes = 67_108_864;
  private const int MaximumLineCharacters = 131_072;
  private const int MaximumEntries = 200_000;
  private const string GenesisHash =
    "0000000000000000000000000000000000000000000000000000000000000000";
  private static readonly JsonSerializerOptions SerializerOptions = new(
    JsonSerializerDefaults.Web)
  {
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
  };

  private readonly string _path;
  private readonly SemaphoreSlim _gate = new(1, 1);
  private readonly Dictionary<string, LifecycleState> _states = new(StringComparer.Ordinal);
  private readonly Dictionary<string, ReplayRecord> _requestOwners = new(StringComparer.Ordinal);
  private readonly Dictionary<string, ReplayRecord> _leaseOwners = new(StringComparer.Ordinal);
  private readonly Dictionary<string, ReplayRecord> _bindingOwners = new(StringComparer.Ordinal);
  private readonly Dictionary<string, ReplayRecord> _acknowledgementOwners =
    new(StringComparer.Ordinal);
  private readonly Dictionary<string, ReplayRecord> _releaseOwners = new(StringComparer.Ordinal);
  private readonly Dictionary<string, ReplayRecord> _receiptOwners = new(StringComparer.Ordinal);
  private readonly Dictionary<string, ReplayRecord> _nonceOwners =
    new(StringComparer.OrdinalIgnoreCase);
  private readonly Dictionary<string, ReplayRecord> _requestDigestOwners =
    new(StringComparer.OrdinalIgnoreCase);
  private readonly Dictionary<string, ReplayRecord> _leaseDigestOwners =
    new(StringComparer.OrdinalIgnoreCase);
  private readonly Dictionary<string, ReplayRecord> _bindingDigestOwners =
    new(StringComparer.OrdinalIgnoreCase);
  private readonly Dictionary<string, ReplayRecord> _acknowledgementDigestOwners =
    new(StringComparer.OrdinalIgnoreCase);
  private readonly Dictionary<string, ReplayRecord> _releaseDigestOwners =
    new(StringComparer.OrdinalIgnoreCase);
  private readonly Dictionary<string, ReplayRecord> _receiptDigestOwners =
    new(StringComparer.OrdinalIgnoreCase);
  private readonly Dictionary<string, ReplayRecord> _lastSupervisorRecord =
    new(StringComparer.Ordinal);
  private FileStream? _ownershipLock;
  private FileStream? _ledger;
  private long _entrySequence;
  private string _head = GenesisHash;
  private bool _initialized;
  private bool _faulted;
  private bool _disposed;

  public FilePrivilegedCommandIsolationReplayStore(string path)
  {
    _path = ResolveProtectedPath(path);
  }

  public async ValueTask<PrivilegedCommandIsolationPendingSnapshot> ReadPendingAsync(
    CancellationToken cancellationToken)
  {
    await EnsureInitializedAsync(cancellationToken).ConfigureAwait(false);
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      if (_faulted)
      {
        throw new InvalidDataException("The isolation replay ledger is faulted.");
      }
      cancellationToken.ThrowIfCancellationRequested();

      var reservations = new List<PrivilegedCommandIsolationPendingReservation>();
      var binds = new List<PrivilegedCommandIsolationPendingBind>();
      var integrityViolations =
        new List<PrivilegedCommandIsolationIntegrityViolation>();
      foreach (var state in _states.Values
        .OrderBy(item => item.Reservation.SupervisorSequence)
        .ThenBy(item => item.Reservation.ActionId, StringComparer.Ordinal))
      {
        if (state.TerminalReceipt is not null)
        {
          // Terminal material is still recovery-critical even though it closes
          // the pending lifecycle. Re-read and canonical-validate every signed
          // receipt so an authenticated enforcement failure becomes a durable
          // startup fence rather than disappearing behind terminal state.
          var terminal = ReadTerminalRecovery(state.TerminalReceipt).SignedReceipt;
          if (!terminal.Receipt.EnforcementContinuous
            || string.Equals(
              terminal.Receipt.Outcome,
              PrivilegedCommandIsolationTerminalOutcomes.IsolationViolation,
              StringComparison.Ordinal))
          {
            integrityViolations.Add(new(
              state.TerminalReceipt.ActionId,
              state.TerminalReceipt.EvidenceSha256,
              terminal.Receipt.Outcome,
              terminal.Receipt.EnforcementContinuous));
          }
          continue;
        }
        if (state.PreBindRelease is not null)
        {
          continue;
        }

        var reservation = ReadReservationRecovery(state.Reservation);
        if (state.BindAcknowledgement is null)
        {
          reservations.Add(new(
            reservation.Request,
            reservation.SignedLease));
          continue;
        }

        var bind = ReadBindRecovery(state.BindAcknowledgement);
        binds.Add(new(
          reservation.Request,
          reservation.SignedLease,
          bind.Binding,
          bind.SignedAcknowledgement));
      }

      return new(
        reservations.ToArray(),
        binds.ToArray(),
        integrityViolations.ToArray());
    }
    catch (Exception exception) when (IsStorageFailure(exception))
    {
      _faulted = true;
      throw;
    }
    finally
    {
      _gate.Release();
    }
  }

  public ValueTask<PrivilegedCommandIsolationReplayCommitResult> CommitReservationAsync(
    VerifiedPrivilegedCommandIsolationReservation reservation,
    CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(reservation);
    var lease = reservation.SignedLease.Lease;
    var action = lease.Action;
    var recoveryMaterial = JsonSerializer.Serialize(
      new ReservationRecoveryMaterial(reservation.Request, reservation.SignedLease),
      SerializerOptions);
    return CommitAsync(new ReplayRecord(
      ReplayKind.Reservation,
      action.ActionId,
      lease.SupervisorInstanceId,
      lease.BootId,
      lease.Sequence,
      reservation.ReservationRequestSha256,
      reservation.RequestNonceSha256,
      lease.LeaseId,
      reservation.LeaseSha256,
      EvidenceId: lease.LeaseId,
      EvidenceSha256: reservation.LeaseSha256,
      BindingRequestId: null,
      SuspendedProcessBindingSha256: null,
      AcknowledgementId: null,
      BindAcknowledgementSha256: null,
      ChildProcessId: null,
      ChildProcessCreationTimeUtcFileTime: null,
      PrimaryThreadId: null,
      JobObjectId: null,
      JobObjectIdentitySha256: null,
      RecoveryMaterialJson: recoveryMaterial,
      RecoveryMaterialSha256: PayloadDigest.Sha256Hex(recoveryMaterial)), cancellationToken);
  }

  public ValueTask<PrivilegedCommandIsolationReplayCommitResult> CommitPreBindReleaseAsync(
    VerifiedPrivilegedCommandIsolationPreBindRelease release,
    CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(release);
    var reservation = release.Reservation;
    var lease = reservation.SignedLease.Lease;
    var signedRelease = release.SignedRelease;
    var recoveryMaterial = JsonSerializer.Serialize(
      new PreBindReleaseRecoveryMaterial(signedRelease),
      SerializerOptions);
    return CommitAsync(new ReplayRecord(
      ReplayKind.PreBindRelease,
      lease.Action.ActionId,
      lease.SupervisorInstanceId,
      lease.BootId,
      signedRelease.Release.Sequence,
      reservation.ReservationRequestSha256,
      reservation.RequestNonceSha256,
      lease.LeaseId,
      reservation.LeaseSha256,
      EvidenceId: signedRelease.Release.ReleaseId,
      EvidenceSha256: release.ReleaseSha256,
      BindingRequestId: null,
      SuspendedProcessBindingSha256: null,
      AcknowledgementId: null,
      BindAcknowledgementSha256: null,
      ChildProcessId: null,
      ChildProcessCreationTimeUtcFileTime: null,
      PrimaryThreadId: null,
      JobObjectId: null,
      JobObjectIdentitySha256: null,
      RecoveryMaterialJson: recoveryMaterial,
      RecoveryMaterialSha256: PayloadDigest.Sha256Hex(recoveryMaterial)), cancellationToken);
  }

  public ValueTask<PrivilegedCommandIsolationReplayCommitResult>
    CommitBindAcknowledgementAsync(
      VerifiedPrivilegedCommandIsolationBindAcknowledgement bindAcknowledgement,
      CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(bindAcknowledgement);
    var reservation = bindAcknowledgement.Reservation;
    var lease = reservation.SignedLease.Lease;
    var binding = bindAcknowledgement.Binding;
    var acknowledgement = bindAcknowledgement.SignedAcknowledgement;
    var process = binding.Process;
    var recoveryMaterial = JsonSerializer.Serialize(
      new BindRecoveryMaterial(binding, acknowledgement),
      SerializerOptions);
    return CommitAsync(new ReplayRecord(
      ReplayKind.BindAcknowledgement,
      lease.Action.ActionId,
      lease.SupervisorInstanceId,
      lease.BootId,
      acknowledgement.Acknowledgement.Sequence,
      reservation.ReservationRequestSha256,
      reservation.RequestNonceSha256,
      lease.LeaseId,
      reservation.LeaseSha256,
      EvidenceId: acknowledgement.Acknowledgement.AcknowledgementId,
      EvidenceSha256: bindAcknowledgement.AcknowledgementSha256,
      BindingRequestId: binding.BindingRequestId,
      SuspendedProcessBindingSha256: bindAcknowledgement.SuspendedProcessBindingSha256,
      AcknowledgementId: acknowledgement.Acknowledgement.AcknowledgementId,
      BindAcknowledgementSha256: bindAcknowledgement.AcknowledgementSha256,
      ChildProcessId: process.ChildProcessId,
      ChildProcessCreationTimeUtcFileTime: process.ChildProcessCreationTimeUtcFileTime,
      PrimaryThreadId: process.PrimaryThreadId,
      JobObjectId: process.JobObjectId,
      JobObjectIdentitySha256: process.JobObjectIdentitySha256,
      RecoveryMaterialJson: recoveryMaterial,
      RecoveryMaterialSha256: PayloadDigest.Sha256Hex(recoveryMaterial)), cancellationToken);
  }

  public ValueTask<PrivilegedCommandIsolationReplayCommitResult> CommitTerminalReceiptAsync(
    VerifiedPrivilegedCommandIsolationTerminalReceipt terminalReceipt,
    CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(terminalReceipt);
    var bind = terminalReceipt.BindAcknowledgement;
    var reservation = bind.Reservation;
    var lease = reservation.SignedLease.Lease;
    var receipt = terminalReceipt.SignedReceipt;
    var recoveryMaterial = JsonSerializer.Serialize(
      new TerminalRecoveryMaterial(receipt),
      SerializerOptions);
    return CommitAsync(new ReplayRecord(
      ReplayKind.TerminalReceipt,
      lease.Action.ActionId,
      lease.SupervisorInstanceId,
      lease.BootId,
      receipt.Receipt.Sequence,
      reservation.ReservationRequestSha256,
      reservation.RequestNonceSha256,
      lease.LeaseId,
      reservation.LeaseSha256,
      EvidenceId: receipt.Receipt.ReceiptId,
      EvidenceSha256: terminalReceipt.ReceiptSha256,
      BindingRequestId: bind.Binding.BindingRequestId,
      SuspendedProcessBindingSha256: bind.SuspendedProcessBindingSha256,
      AcknowledgementId: bind.SignedAcknowledgement.Acknowledgement.AcknowledgementId,
      BindAcknowledgementSha256: bind.AcknowledgementSha256,
      ChildProcessId: bind.Binding.Process.ChildProcessId,
      ChildProcessCreationTimeUtcFileTime:
        bind.Binding.Process.ChildProcessCreationTimeUtcFileTime,
      PrimaryThreadId: bind.Binding.Process.PrimaryThreadId,
      JobObjectId: bind.Binding.Process.JobObjectId,
      JobObjectIdentitySha256: bind.Binding.Process.JobObjectIdentitySha256,
      RecoveryMaterialJson: recoveryMaterial,
      RecoveryMaterialSha256: PayloadDigest.Sha256Hex(recoveryMaterial)), cancellationToken);
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

  private async ValueTask<PrivilegedCommandIsolationReplayCommitResult> CommitAsync(
    ReplayRecord record,
    CancellationToken cancellationToken)
  {
    ValidateRecord(record);
    try
    {
      await EnsureInitializedAsync(cancellationToken).ConfigureAwait(false);
    }
    catch (Exception exception) when (IsStorageFailure(exception))
    {
      return Unavailable(record.EvidenceSha256);
    }

    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      if (_faulted)
      {
        return Unavailable(record.EvidenceSha256);
      }
      cancellationToken.ThrowIfCancellationRequested();
      var advancement = ValidateAdvance(record);
      if (advancement is not null)
      {
        return advancement;
      }

      var payloadSha256 = PayloadDigest.Sha256Hex(
        JsonSerializer.Serialize(record, SerializerOptions));
      var unsigned = new LedgerEntry(
        FormatVersion,
        checked(_entrySequence + 1),
        record,
        payloadSha256,
        _head,
        string.Empty);
      var entry = unsigned with { EntrySha256 = EntrySha256(unsigned) };
      try
      {
        AppendDurably(entry);
      }
      catch (Exception exception) when (IsStorageFailure(exception))
      {
        _faulted = true;
        return Unavailable(record.EvidenceSha256);
      }

      Accept(entry);
      return new(
        PrivilegedCommandIsolationReplayCommitStatus.Committed,
        record.EvidenceSha256,
        ExistingEvidenceSha256: null);
    }
    finally
    {
      _gate.Release();
    }
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
        throw new InvalidDataException("The isolation replay ledger is faulted.");
      }

      try
      {
        PrepareProtectedPath();
        _ownershipLock = OpenOwnedFile($"{_path}.lock", FileMode.OpenOrCreate);
        _ledger = OpenOwnedFile(_path, FileMode.OpenOrCreate);
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

  private void AppendDurably(LedgerEntry entry)
  {
    PrepareProtectedPath();
    if (_ledger is null)
    {
      throw new IOException("The isolation replay ledger is not open.");
    }

    var line = JsonSerializer.Serialize(entry, SerializerOptions);
    if (line.Length > MaximumLineCharacters)
    {
      throw new InvalidDataException("The isolation replay record is too large.");
    }
    var bytes = Encoding.UTF8.GetBytes(line + "\n");
    try
    {
      if (_ledger.Length > MaximumLedgerBytes - bytes.Length)
      {
        throw new InvalidDataException("The isolation replay ledger is full.");
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
      throw new InvalidDataException("The isolation replay ledger is too large.");
    }
    if (stream.Length > 0)
    {
      stream.Seek(-1, SeekOrigin.End);
      if (stream.ReadByte() != '\n')
      {
        throw new InvalidDataException("The isolation replay ledger has a partial record.");
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
        throw new InvalidDataException("The isolation replay ledger is malformed.");
      }

      LedgerEntry entry;
      try
      {
        entry = JsonSerializer.Deserialize<LedgerEntry>(line, SerializerOptions)
          ?? throw new InvalidDataException("The isolation replay record is empty.");
      }
      catch (JsonException exception)
      {
        throw new InvalidDataException(
          "The isolation replay ledger contains invalid JSON.",
          exception);
      }

      if (entry.Record is null
        || !string.Equals(
          JsonSerializer.Serialize(entry, SerializerOptions),
          line,
          StringComparison.Ordinal)
        || !EntryValid(entry, checked(_entrySequence + 1), _head))
      {
        throw new InvalidDataException(
          "The isolation replay ledger failed hash-chain verification.");
      }

      try
      {
        ValidateRecord(entry.Record);
      }
      catch (ArgumentException exception)
      {
        throw new InvalidDataException(
          "The isolation replay ledger contains invalid lifecycle evidence.",
          exception);
      }
      if (ValidateAdvance(entry.Record) is not null)
      {
        throw new InvalidDataException(
          "The isolation replay ledger contains a replay or invalid transition.");
      }
      Accept(entry);
    }
  }

  private PrivilegedCommandIsolationReplayCommitResult? ValidateAdvance(ReplayRecord record)
  {
    if (_states.TryGetValue(record.ActionId, out var state))
    {
      var existing = record.Kind switch
      {
        ReplayKind.Reservation => state.Reservation,
        ReplayKind.PreBindRelease => state.PreBindRelease,
        ReplayKind.BindAcknowledgement => state.BindAcknowledgement,
        ReplayKind.TerminalReceipt => state.TerminalReceipt,
        _ => null,
      };
      if (existing is not null
        && DigestEquals(existing.EvidenceSha256, record.EvidenceSha256))
      {
        return new(
          PrivilegedCommandIsolationReplayCommitStatus.AlreadyCommitted,
          record.EvidenceSha256,
          existing.EvidenceSha256);
      }
    }

    var ownershipConflict = FindOwnershipConflict(record);
    if (ownershipConflict is not null)
    {
      return Conflict(record.EvidenceSha256, ownershipConflict.EvidenceSha256);
    }

    switch (record.Kind)
    {
      case ReplayKind.Reservation:
        if (state is not null)
        {
          return Conflict(record.EvidenceSha256, state.Reservation.EvidenceSha256);
        }
        break;
      case ReplayKind.PreBindRelease:
        if (state is null)
        {
          return Conflict(record.EvidenceSha256, existingEvidenceSha256: null);
        }
        if (state.PreBindRelease is not null
          || state.BindAcknowledgement is not null
          || state.TerminalReceipt is not null
          || !ReservationMatches(state.Reservation, record))
        {
          return Conflict(record.EvidenceSha256,
            state.PreBindRelease?.EvidenceSha256
              ?? state.BindAcknowledgement?.EvidenceSha256
              ?? state.TerminalReceipt?.EvidenceSha256
              ?? state.Reservation.EvidenceSha256);
        }
        break;
      case ReplayKind.BindAcknowledgement:
        if (state is null)
        {
          return Conflict(record.EvidenceSha256, existingEvidenceSha256: null);
        }
        if (state.PreBindRelease is not null
          || state.BindAcknowledgement is not null
          || state.TerminalReceipt is not null
          || !ReservationMatches(state.Reservation, record))
        {
          return Conflict(record.EvidenceSha256,
            state.PreBindRelease?.EvidenceSha256
              ?? state.BindAcknowledgement?.EvidenceSha256
              ?? state.TerminalReceipt?.EvidenceSha256
              ?? state.Reservation.EvidenceSha256);
        }
        break;
      case ReplayKind.TerminalReceipt:
        if (state?.BindAcknowledgement is null)
        {
          return Conflict(record.EvidenceSha256, state?.Reservation.EvidenceSha256);
        }
        if (state.TerminalReceipt is not null
          || !BindMatches(state.Reservation, state.BindAcknowledgement, record))
        {
          return Conflict(record.EvidenceSha256,
            state.TerminalReceipt?.EvidenceSha256
              ?? state.BindAcknowledgement.EvidenceSha256);
        }
        break;
      default:
        return Conflict(record.EvidenceSha256, existingEvidenceSha256: null);
    }

    var sequenceKey = SequenceKey(record.SupervisorInstanceId, record.BootId);
    if (_lastSupervisorRecord.TryGetValue(sequenceKey, out var last)
      && record.SupervisorSequence <= last.SupervisorSequence)
    {
      return new(
        PrivilegedCommandIsolationReplayCommitStatus.StaleSequence,
        record.EvidenceSha256,
        last.EvidenceSha256);
    }
    return null;
  }

  private ReplayRecord? FindOwnershipConflict(ReplayRecord record)
  {
    foreach (var pair in Owners(record))
    {
      if (pair.Owners.TryGetValue(pair.Value, out var owner)
        && !Exact(owner.ActionId, record.ActionId))
      {
        return owner;
      }
    }
    return null;
  }

  private IEnumerable<(IReadOnlyDictionary<string, ReplayRecord> Owners, string Value)>
    Owners(ReplayRecord record)
  {
    yield return (_nonceOwners, record.RequestNonceSha256);
    yield return (_requestDigestOwners, record.ReservationRequestSha256);
    yield return (_leaseOwners, record.LeaseId);
    yield return (_leaseDigestOwners, record.LeaseSha256);
    switch (record.Kind)
    {
      case ReplayKind.Reservation:
        yield return (_requestOwners, record.EvidenceId);
        break;
      case ReplayKind.PreBindRelease:
        yield return (_releaseOwners, record.EvidenceId);
        yield return (_releaseDigestOwners, record.EvidenceSha256);
        break;
      case ReplayKind.BindAcknowledgement:
        yield return (_bindingOwners, record.BindingRequestId!);
        yield return (_bindingDigestOwners, record.SuspendedProcessBindingSha256!);
        yield return (_acknowledgementOwners, record.AcknowledgementId!);
        yield return (_acknowledgementDigestOwners, record.BindAcknowledgementSha256!);
        break;
      case ReplayKind.TerminalReceipt:
        yield return (_receiptOwners, record.EvidenceId);
        yield return (_receiptDigestOwners, record.EvidenceSha256);
        break;
    }
  }

  private void Accept(LedgerEntry entry)
  {
    var record = entry.Record;
    switch (record.Kind)
    {
      case ReplayKind.Reservation:
        _states.Add(record.ActionId, new(record, null, null, null));
        break;
      case ReplayKind.PreBindRelease:
        _states[record.ActionId] = _states[record.ActionId] with
        {
          PreBindRelease = record,
        };
        break;
      case ReplayKind.BindAcknowledgement:
        _states[record.ActionId] = _states[record.ActionId] with
        {
          BindAcknowledgement = record,
        };
        break;
      case ReplayKind.TerminalReceipt:
        _states[record.ActionId] = _states[record.ActionId] with
        {
          TerminalReceipt = record,
        };
        break;
    }

    foreach (var pair in Owners(record))
    {
      if (!pair.Owners.ContainsKey(pair.Value))
      {
        ((IDictionary<string, ReplayRecord>)pair.Owners).Add(pair.Value, record);
      }
    }
    _lastSupervisorRecord[SequenceKey(record.SupervisorInstanceId, record.BootId)] = record;
    _entrySequence = entry.EntrySequence;
    _head = entry.EntrySha256;
  }

  private static bool ReservationMatches(ReplayRecord reservation, ReplayRecord next) =>
    Exact(reservation.ActionId, next.ActionId)
    && Exact(reservation.SupervisorInstanceId, next.SupervisorInstanceId)
    && Exact(reservation.BootId, next.BootId)
    && Exact(reservation.LeaseId, next.LeaseId)
    && DigestEquals(reservation.ReservationRequestSha256, next.ReservationRequestSha256)
    && DigestEquals(reservation.RequestNonceSha256, next.RequestNonceSha256)
    && DigestEquals(reservation.LeaseSha256, next.LeaseSha256)
    && next.SupervisorSequence > reservation.SupervisorSequence;

  private static bool BindMatches(
    ReplayRecord reservation,
    ReplayRecord bind,
    ReplayRecord terminal) => ReservationMatches(reservation, terminal)
    && Exact(bind.BindingRequestId!, terminal.BindingRequestId!)
    && Exact(bind.AcknowledgementId!, terminal.AcknowledgementId!)
    && DigestEquals(
      bind.SuspendedProcessBindingSha256!,
      terminal.SuspendedProcessBindingSha256!)
    && DigestEquals(bind.BindAcknowledgementSha256!, terminal.BindAcknowledgementSha256!)
    && terminal.SupervisorSequence > bind.SupervisorSequence;

  private static ReservationRecoveryMaterial ReadReservationRecovery(
    ReplayRecord record)
  {
    var material = DeserializeRecoveryMaterial<ReservationRecoveryMaterial>(record);
    var request = material.Request;
    var signedLease = material.SignedLease;
    var lease = signedLease?.Lease;
    try
    {
      if (request?.Action is null
        || lease?.Action is null
        || !Exact(request.Action.ActionId, record.ActionId)
        || !Exact(lease.Action.ActionId, record.ActionId)
        || !Exact(lease.SupervisorInstanceId, record.SupervisorInstanceId)
        || !Exact(lease.BootId, record.BootId)
        || lease.Sequence != record.SupervisorSequence
        || !Exact(lease.LeaseId, record.LeaseId)
        || !Exact(record.EvidenceId, record.LeaseId)
        || !DigestEquals(
          PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
          record.ReservationRequestSha256)
        || !DigestEquals(
          PrivilegedCommandIsolationCanonical.RequestNonceSha256(request),
          record.RequestNonceSha256)
        || !DigestEquals(lease.ReservationRequestSha256, record.ReservationRequestSha256)
        || !DigestEquals(lease.RequestNonceSha256, record.RequestNonceSha256)
        || !DigestEquals(
          PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(lease),
          record.LeaseSha256)
        || !DigestEquals(record.EvidenceSha256, record.LeaseSha256))
      {
        throw new InvalidDataException(
          "Pending isolation reservation recovery material does not match its ledger record.");
      }
    }
    catch (Exception exception) when (exception is ArgumentException
      or FormatException
      or InvalidOperationException
      or NullReferenceException)
    {
      throw new InvalidDataException(
        "Pending isolation reservation recovery material is invalid.",
        exception);
    }
    return material;
  }

  private static BindRecoveryMaterial ReadBindRecovery(ReplayRecord record)
  {
    var material = DeserializeRecoveryMaterial<BindRecoveryMaterial>(record);
    var binding = material.Binding;
    var signedAcknowledgement = material.SignedAcknowledgement;
    var acknowledgement = signedAcknowledgement?.Acknowledgement;
    var process = binding?.Process;
    try
    {
      if (binding?.Action is null
        || acknowledgement?.Action is null
        || process is null
        || !Exact(binding.Action.ActionId, record.ActionId)
        || !Exact(acknowledgement.Action.ActionId, record.ActionId)
        || !Exact(binding.SupervisorInstanceId, record.SupervisorInstanceId)
        || !Exact(acknowledgement.SupervisorInstanceId, record.SupervisorInstanceId)
        || !Exact(binding.BootId, record.BootId)
        || !Exact(acknowledgement.BootId, record.BootId)
        || acknowledgement.Sequence != record.SupervisorSequence
        || !Exact(binding.BindingRequestId, record.BindingRequestId!)
        || !Exact(acknowledgement.AcknowledgementId, record.AcknowledgementId!)
        || !Exact(record.EvidenceId, record.AcknowledgementId!)
        || !DigestEquals(binding.ReservationRequestSha256, record.ReservationRequestSha256)
        || !DigestEquals(binding.RequestNonceSha256, record.RequestNonceSha256)
        || !DigestEquals(binding.LeaseSha256, record.LeaseSha256)
        || !DigestEquals(
          acknowledgement.ReservationRequestSha256,
          record.ReservationRequestSha256)
        || !DigestEquals(acknowledgement.RequestNonceSha256, record.RequestNonceSha256)
        || !DigestEquals(acknowledgement.LeaseSha256, record.LeaseSha256)
        || !DigestEquals(
          PrivilegedCommandIsolationCanonical.SuspendedProcessBindingSha256(binding),
          record.SuspendedProcessBindingSha256!)
        || !DigestEquals(
          acknowledgement.SuspendedProcessBindingSha256,
          record.SuspendedProcessBindingSha256!)
        || !DigestEquals(
          PrivilegedCommandIsolationCanonical.BindAcknowledgementSha256(acknowledgement),
          record.BindAcknowledgementSha256!)
        || !DigestEquals(record.EvidenceSha256, record.BindAcknowledgementSha256!)
        || process.ChildProcessId != record.ChildProcessId
        || process.ChildProcessCreationTimeUtcFileTime
          != record.ChildProcessCreationTimeUtcFileTime
        || process.PrimaryThreadId != record.PrimaryThreadId
        || !Exact(process.JobObjectId, record.JobObjectId!)
        || !DigestEquals(
          process.JobObjectIdentitySha256,
          record.JobObjectIdentitySha256!))
      {
        throw new InvalidDataException(
          "Pending isolation bind recovery material does not match its ledger record.");
      }
    }
    catch (Exception exception) when (exception is ArgumentException
      or FormatException
      or InvalidOperationException
      or NullReferenceException)
    {
      throw new InvalidDataException(
        "Pending isolation bind recovery material is invalid.",
        exception);
    }
    return material;
  }

  private static TerminalRecoveryMaterial ReadTerminalRecovery(ReplayRecord record)
  {
    var material = DeserializeRecoveryMaterial<TerminalRecoveryMaterial>(record);
    var signedReceipt = material.SignedReceipt;
    var receipt = signedReceipt?.Receipt;
    var process = receipt?.Process;
    try
    {
      if (!PrivilegedCommandIsolationCanonical.IsCanonicalSignedTerminalReceipt(
          signedReceipt)
        || receipt?.Action is null
        || process is null
        || !Exact(receipt.Action.ActionId, record.ActionId)
        || !Exact(receipt.SupervisorInstanceId, record.SupervisorInstanceId)
        || !Exact(receipt.BootId, record.BootId)
        || receipt.Sequence != record.SupervisorSequence
        || !Exact(receipt.ReceiptId, record.EvidenceId)
        || !DigestEquals(
          receipt.ReservationRequestSha256,
          record.ReservationRequestSha256)
        || !DigestEquals(receipt.RequestNonceSha256, record.RequestNonceSha256)
        || !DigestEquals(receipt.LeaseSha256, record.LeaseSha256)
        || !DigestEquals(
          receipt.SuspendedProcessBindingSha256,
          record.SuspendedProcessBindingSha256!)
        || !DigestEquals(
          receipt.BindAcknowledgementSha256,
          record.BindAcknowledgementSha256!)
        || !DigestEquals(
          PrivilegedCommandIsolationCanonical.TerminalReceiptSha256(receipt),
          record.EvidenceSha256)
        || process.ChildProcessId != record.ChildProcessId
        || process.ChildProcessCreationTimeUtcFileTime
          != record.ChildProcessCreationTimeUtcFileTime
        || process.PrimaryThreadId != record.PrimaryThreadId
        || !Exact(process.JobObjectId, record.JobObjectId!)
        || !DigestEquals(
          process.JobObjectIdentitySha256,
          record.JobObjectIdentitySha256!))
      {
        throw new InvalidDataException(
          "Terminal isolation recovery material does not match its ledger record.");
      }
    }
    catch (Exception exception) when (exception is ArgumentException
      or FormatException
      or InvalidOperationException
      or NullReferenceException)
    {
      throw new InvalidDataException(
        "Terminal isolation recovery material is invalid.",
        exception);
    }
    return material;
  }

  private static T DeserializeRecoveryMaterial<T>(ReplayRecord record)
    where T : class
  {
    try
    {
      var material = JsonSerializer.Deserialize<T>(
        record.RecoveryMaterialJson,
        SerializerOptions)
        ?? throw new InvalidDataException("Isolation recovery material is empty.");
      if (!string.Equals(
          JsonSerializer.Serialize(material, SerializerOptions),
          record.RecoveryMaterialJson,
          StringComparison.Ordinal))
      {
        throw new InvalidDataException("Isolation recovery material is noncanonical.");
      }
      return material;
    }
    catch (JsonException exception)
    {
      throw new InvalidDataException("Isolation recovery material contains invalid JSON.", exception);
    }
  }

  private static void ValidateRecord(ReplayRecord record)
  {
    ValidateGuid(record.ActionId, nameof(record.ActionId));
    ValidateGuid(record.SupervisorInstanceId, nameof(record.SupervisorInstanceId));
    ValidateGuid(record.BootId, nameof(record.BootId));
    ValidatePositive(record.SupervisorSequence, nameof(record.SupervisorSequence));
    ValidateDigest(record.ReservationRequestSha256, nameof(record.ReservationRequestSha256));
    ValidateDigest(record.RequestNonceSha256, nameof(record.RequestNonceSha256));
    ValidateGuid(record.LeaseId, nameof(record.LeaseId));
    ValidateDigest(record.LeaseSha256, nameof(record.LeaseSha256));
    ValidateGuid(record.EvidenceId, nameof(record.EvidenceId));
    ValidateDigest(record.EvidenceSha256, nameof(record.EvidenceSha256));
    if (string.IsNullOrWhiteSpace(record.RecoveryMaterialJson)
      || record.RecoveryMaterialJson.Length > 65_536
      || !DigestEquals(
        record.RecoveryMaterialSha256,
        PayloadDigest.Sha256Hex(record.RecoveryMaterialJson)))
    {
      throw new ArgumentException("Isolation recovery material is absent or noncanonical.");
    }

    if (record.Kind is ReplayKind.BindAcknowledgement or ReplayKind.TerminalReceipt)
    {
      ValidateGuid(record.BindingRequestId!, nameof(record.BindingRequestId));
      ValidateDigest(
        record.SuspendedProcessBindingSha256!,
        nameof(record.SuspendedProcessBindingSha256));
      ValidateGuid(record.AcknowledgementId!, nameof(record.AcknowledgementId));
      ValidateDigest(
        record.BindAcknowledgementSha256!,
        nameof(record.BindAcknowledgementSha256));
      ValidatePositive(record.ChildProcessId!.Value, nameof(record.ChildProcessId));
      ValidatePositive(
        record.ChildProcessCreationTimeUtcFileTime!.Value,
        nameof(record.ChildProcessCreationTimeUtcFileTime));
      ValidatePositive(record.PrimaryThreadId!.Value, nameof(record.PrimaryThreadId));
      ValidateGuid(record.JobObjectId!, nameof(record.JobObjectId));
      ValidateDigest(
        record.JobObjectIdentitySha256!,
        nameof(record.JobObjectIdentitySha256));
    }
    else if (record.BindingRequestId is not null
      || record.SuspendedProcessBindingSha256 is not null
      || record.AcknowledgementId is not null
      || record.BindAcknowledgementSha256 is not null
      || record.ChildProcessId is not null
      || record.ChildProcessCreationTimeUtcFileTime is not null
      || record.PrimaryThreadId is not null
      || record.JobObjectId is not null
      || record.JobObjectIdentitySha256 is not null)
    {
      throw new ArgumentException("Pre-bind replay records cannot contain process material.");
    }
  }

  private static bool EntryValid(LedgerEntry entry, long sequence, string previous) =>
    entry.FormatVersion == FormatVersion
    && entry.EntrySequence == sequence
    && IsCanonicalDigest(entry.PayloadSha256)
    && IsCanonicalDigest(entry.PreviousSha256)
    && IsCanonicalDigest(entry.EntrySha256)
    && DigestEquals(
      entry.PayloadSha256,
      PayloadDigest.Sha256Hex(JsonSerializer.Serialize(entry.Record, SerializerOptions)))
    && DigestEquals(entry.PreviousSha256, previous)
    && DigestEquals(entry.EntrySha256, EntrySha256(entry));

  private static string EntrySha256(LedgerEntry entry) => PayloadDigest.Sha256Hex(
    string.Join('\n',
      "itemba-msaidizi-privileged-command-isolation-replay/v1",
      entry.FormatVersion.ToString(CultureInfo.InvariantCulture),
      entry.EntrySequence.ToString(CultureInfo.InvariantCulture),
      entry.Record.Kind.ToString(),
      entry.PayloadSha256,
      entry.PreviousSha256));

  private static string ResolveProtectedPath(string configured)
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
        "The isolation replay ledger path must be a canonical local DOS path.",
        nameof(configured));
    }

    var configuredRoot = Path.GetPathRoot(expanded);
    var configuredRelative = configuredRoot is null
      ? string.Empty
      : expanded[configuredRoot.Length..];
    if (ContainsUnsafeDosSegments(configuredRelative))
    {
      throw new ArgumentException(
        "The isolation replay ledger cannot use a DOS device or aliased path.",
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
        "The isolation replay ledger cannot use a network, device, directory, or alternate-data-stream path.",
        nameof(configured));
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
      ?? throw new InvalidOperationException("The isolation replay path has no parent.");
    EnsureDirectoryTreeHasNoReparsePoints(directory);
    VerifyCanonicalExistingPath(directory, expectDirectory: true);
    VerifyCanonicalExistingPath(_path, expectDirectory: false, allowMissing: true);
    VerifyCanonicalExistingPath($"{_path}.lock", expectDirectory: false, allowMissing: true);
  }

  private static void EnsureDirectoryTreeHasNoReparsePoints(string directory)
  {
    var full = Path.GetFullPath(directory);
    var root = Path.GetPathRoot(full)
      ?? throw new ArgumentException("The protected replay path has no volume root.");
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
        "A protected isolation replay path is indirect or has the wrong type.");
    }
  }

  private static bool IsAbsentPath(Exception exception) => exception is
    FileNotFoundException or DirectoryNotFoundException;

  private static FileStream OpenOwnedFile(string path, FileMode mode) => new(
    path,
    mode,
    FileAccess.ReadWrite,
    FileShare.Read,
    bufferSize: 4_096,
    FileOptions.WriteThrough);

  private static PrivilegedCommandIsolationReplayCommitResult Conflict(
    string evidenceSha256,
    string? existingEvidenceSha256) => new(
      PrivilegedCommandIsolationReplayCommitStatus.Conflict,
      evidenceSha256,
      existingEvidenceSha256);

  private static PrivilegedCommandIsolationReplayCommitResult Unavailable(
    string evidenceSha256) => new(
      PrivilegedCommandIsolationReplayCommitStatus.Unavailable,
      evidenceSha256,
      ExistingEvidenceSha256: null);

  private static string SequenceKey(string supervisorInstanceId, string bootId) =>
    $"{supervisorInstanceId}\n{bootId}";

  private static bool IsStorageFailure(Exception exception) => exception is IOException
    or UnauthorizedAccessException
    or InvalidDataException
    or JsonException
    or DecoderFallbackException;

  private static bool Exact(string left, string right) =>
    string.Equals(left, right, StringComparison.Ordinal);

  private static bool DigestEquals(string left, string right) =>
    IsCanonicalDigest(left)
    && IsCanonicalDigest(right)
    && PayloadDigest.FixedTimeEqualsHex(left, right);

  private static bool IsCanonicalDigest(string? value) =>
    PayloadDigest.IsSha256Hex(value)
    && value!.All(character => char.IsAsciiDigit(character)
      || character is >= 'a' and <= 'f');

  private static void ValidateDigest(string value, string name)
  {
    if (!IsCanonicalDigest(value))
    {
      throw new ArgumentException($"{name} must be canonical lowercase SHA-256.", name);
    }
  }

  private static void ValidateGuid(string value, string name)
  {
    if (!Guid.TryParseExact(value, "D", out var parsed)
      || !Exact(parsed.ToString("D"), value))
    {
      throw new ArgumentException($"{name} must be a canonical GUID.", name);
    }
  }

  private static void ValidatePositive(long value, string name)
  {
    if (value <= 0)
    {
      throw new ArgumentOutOfRangeException(name, "The value must be positive.");
    }
  }

  private static void ValidatePositive(int value, string name) =>
    ValidatePositive((long)value, name);

  [JsonConverter(typeof(JsonStringEnumConverter<ReplayKind>))]
  private enum ReplayKind
  {
    Reservation,
    PreBindRelease,
    BindAcknowledgement,
    TerminalReceipt,
  }

  private sealed record ReplayRecord(
    ReplayKind Kind,
    string ActionId,
    string SupervisorInstanceId,
    string BootId,
    long SupervisorSequence,
    string ReservationRequestSha256,
    string RequestNonceSha256,
    string LeaseId,
    string LeaseSha256,
    string EvidenceId,
    string EvidenceSha256,
    string? BindingRequestId,
    string? SuspendedProcessBindingSha256,
    string? AcknowledgementId,
    string? BindAcknowledgementSha256,
    int? ChildProcessId,
    long? ChildProcessCreationTimeUtcFileTime,
    int? PrimaryThreadId,
    string? JobObjectId,
    string? JobObjectIdentitySha256,
    string RecoveryMaterialJson,
    string RecoveryMaterialSha256);

  private sealed record LifecycleState(
    ReplayRecord Reservation,
    ReplayRecord? PreBindRelease,
    ReplayRecord? BindAcknowledgement,
    ReplayRecord? TerminalReceipt);

  private sealed record LedgerEntry(
    int FormatVersion,
    long EntrySequence,
    ReplayRecord Record,
    string PayloadSha256,
    string PreviousSha256,
    string EntrySha256);

  private sealed record ReservationRecoveryMaterial(
    PrivilegedCommandIsolationReservationRequestV1 Request,
    SignedPrivilegedCommandIsolationReservationLease SignedLease);

  private sealed record PreBindReleaseRecoveryMaterial(
    SignedPrivilegedCommandIsolationPreBindRelease SignedRelease);

  private sealed record BindRecoveryMaterial(
    PrivilegedCommandSuspendedProcessBindingV1 Binding,
    SignedPrivilegedCommandIsolationBindAcknowledgement SignedAcknowledgement);

  private sealed record TerminalRecoveryMaterial(
    SignedPrivilegedCommandIsolationTerminalReceipt SignedReceipt);
}
