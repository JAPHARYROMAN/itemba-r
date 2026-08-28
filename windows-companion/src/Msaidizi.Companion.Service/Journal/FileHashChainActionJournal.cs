using System.Globalization;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Journal;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Service.Journal;

/// <summary>
/// Append-only JSONL journal with a SHA-256 hash chain and a process-local
/// idempotency index. It stores no raw arguments or output; bounded typed
/// provenance is retained so cache-loss replay cannot erase the source chain.
/// </summary>
public sealed class FileHashChainActionJournal : IActionJournal, IDisposable
{
  private const int LegacyHashVersion = 1;
  private const int DigestOnlyHashVersion = 2;
  private const string GenesisHash =
    "0000000000000000000000000000000000000000000000000000000000000000";

  private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

  private readonly string _path;
  private readonly Func<string, ReadOnlyMemory<byte>, CancellationToken, ValueTask> _appendBytes;
  private readonly SemaphoreSlim _gate = new(1, 1);
  private readonly Dictionary<string, ActiveAction> _activeActions = new(StringComparer.Ordinal);
  private readonly Dictionary<string, JournalTerminalReceipt> _terminalReceipts =
    new(StringComparer.Ordinal);
  private readonly Dictionary<string, FenceTombstone> _fenceTombstones =
    new(StringComparer.Ordinal);
  private readonly Dictionary<string, long> _fenceFloorByDevice =
    new(StringComparer.Ordinal);
  private readonly List<JournalRecord> _records = [];

  private JournalHead _head = new(0, GenesisHash);
  private FileStream? _ownershipLock;
  private bool _initialized;
  private bool _faulted;

  public FileHashChainActionJournal(string path) : this(path, AppendBytesAsync)
  {
  }

  internal FileHashChainActionJournal(
    string path,
    Func<string, ReadOnlyMemory<byte>, CancellationToken, ValueTask> appendBytes)
  {
    _path = Environment.ExpandEnvironmentVariables(path);
    _appendBytes = appendBytes ?? throw new ArgumentNullException(nameof(appendBytes));
    if (!Path.IsPathFullyQualified(_path))
    {
      throw new ArgumentException("The action journal path must be absolute.", nameof(path));
    }
  }

  public async ValueTask InitializeAsync(CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      if (_initialized)
      {
        return;
      }

      var directory = Path.GetDirectoryName(_path)
        ?? throw new InvalidOperationException("The action journal path has no parent directory.");
      Directory.CreateDirectory(directory);

      _ownershipLock = new FileStream(
        $"{_path}.lock",
        FileMode.OpenOrCreate,
        FileAccess.ReadWrite,
        FileShare.None,
        bufferSize: 1,
        options: FileOptions.WriteThrough);

      var loaded = LoadAndVerify();
      _head = loaded.Head;
      _records.Clear();
      _records.AddRange(loaded.Records);
      foreach (var terminal in loaded.TerminalReceipts)
      {
        _terminalReceipts.Add(terminal.Key, terminal.Value);
      }
      foreach (var fence in loaded.FenceTombstones)
      {
        AcceptFence(fence.Key, fence.Value);
      }

      // A legacy v1 line remains restart-verifiable with its original raw
      // local payload, but the broker must never authorize from an opaque v1
      // head. Append one payload-safe v2 bridge that commits the verified v1
      // predecessor before writing any restart terminal. Later reconciliation
      // can recompute and authorize only the v2 suffix.
      if (loaded.Records.Count > 0
        && loaded.Records[^1].HashVersion == LegacyHashVersion)
      {
        var legacyHead = _head;
        await AppendInternalAsync(
          JournalEntryKind.ChainUpgraded,
          "journal-chain-upgrade",
          $"journal-chain-upgrade-{legacyHead.Sequence + 1}",
          JsonSerializer.Serialize(
            new ChainUpgradePayload(LegacyHashVersion, legacyHead.EntryHash),
            SerializerOptions)).ConfigureAwait(false);
      }

      // A Prepared record without a terminal record means the prior process
      // stopped after accepting an action. Never retry it blindly. Close it as
      // NeedsAttention so a replay returns a durable uncertainty receipt.
      foreach (var active in loaded.ActivePreparations)
      {
        var brokerReservation = active.Value.Payload.ReservedBrokerExternalEgressBytes;
        var maximumEgress = active.Value.Payload.MaximumExternalEgressBytes;
        var recovery = active.Value.RecoveryCheckpoint?.Payload;
        var interrupted = new TerminalPayload(
          active.Value.Payload.TaskId,
          active.Value.Payload.StepId,
          RequestFingerprint(active.Value.ActionId, active.Key, active.Value.Payload),
          ActionOutcome.NeedsAttention,
          OutputSha256: null,
          MutationCommitted: false,
          OutcomeUncertain: true,
          ErrorCode: "companion_restarted_before_terminal",
          PreStateSha256: recovery?.PreStateSha256
            ?? active.Value.Payload.ExpectedPreStateSha256,
          RecoveryProvenanceSha256: recovery?.RecoveryProvenanceSha256,
          RecoveryHandleSha256: recovery?.RecoveryHandleSha256,
          LocalBytesRead: 0,
          LocalBytesWritten: 0,
          ExternalEgressBytes: 0,
          BrokerExternalEgressBytes: brokerReservation,
          UncertainExternalEgressBytes: maximumEgress - brokerReservation,
          BrokerMaxDeliverySessions: active.Value.Payload.BrokerMaxDeliverySessions,
          BrokerMaxRequestAttemptsPerSession:
            active.Value.Payload.BrokerMaxRequestAttemptsPerSession,
          BrokerSerializedResultUpperBoundBytes:
            active.Value.Payload.BrokerSerializedResultUpperBoundBytes,
          Provenance: [],
          EgressEvidenceSha256: null,
          EgressEvidence: null);
        var record = await AppendInternalAsync(
          JournalEntryKind.NeedsAttention,
          active.Value.ActionId,
          active.Key,
          JsonSerializer.Serialize(interrupted, SerializerOptions)).ConfigureAwait(false);
        _terminalReceipts.Add(active.Key, ToReceipt(
          active.Value.Record,
          active.Value.RecoveryCheckpoint?.Record,
          record,
          interrupted,
          maximumEgress,
          active.Value.Payload.CompactTokenSha256));
      }

      _initialized = true;
    }
    catch
    {
      _ownershipLock?.Dispose();
      _ownershipLock = null;
      throw;
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<JournalBeginResult> TryBeginAsync(
    ActionRequest request,
    string compactTokenSha256,
    long maximumExternalEgressBytes,
    long reservedBrokerExternalEgressBytes,
    int brokerMaxDeliverySessions,
    int brokerMaxRequestAttemptsPerSession,
    long brokerSerializedResultUpperBoundBytes,
    CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureInitialized();

      if (maximumExternalEgressBytes <= 0
        || reservedBrokerExternalEgressBytes <= 0
        || reservedBrokerExternalEgressBytes > maximumExternalEgressBytes
        || !PayloadDigest.IsSha256Hex(request.ArgumentsSha256)
        || !PayloadDigest.IsSha256Hex(compactTokenSha256)
        || (request.ExpectedPreStateSha256 is not null
          && !PayloadDigest.IsSha256Hex(request.ExpectedPreStateSha256))
        || (request.InputProvenanceSha256 is not null
          && !PayloadDigest.IsSha256Hex(request.InputProvenanceSha256))
        || !BrokerReservationMatches(
          reservedBrokerExternalEgressBytes,
          brokerMaxDeliverySessions,
          brokerMaxRequestAttemptsPerSession,
          brokerSerializedResultUpperBoundBytes))
      {
        throw new ArgumentOutOfRangeException(
          nameof(reservedBrokerExternalEgressBytes),
          "The verified digest and broker reservation contract must be canonical and fit inside the external-egress ceiling.");
      }

      if (_terminalReceipts.TryGetValue(request.IdempotencyKey, out var terminal))
      {
        return terminal.ActionId == request.ActionId
          && PayloadDigest.FixedTimeEqualsHex(
            terminal.RequestSha256,
            RequestFingerprint(request))
          && terminal.MaximumExternalEgressBytes == maximumExternalEgressBytes
          && terminal.BrokerExternalEgressBytes == reservedBrokerExternalEgressBytes
          && terminal.BrokerMaxDeliverySessions == brokerMaxDeliverySessions
          && terminal.BrokerMaxRequestAttemptsPerSession == brokerMaxRequestAttemptsPerSession
          && terminal.BrokerSerializedResultUpperBoundBytes
            == brokerSerializedResultUpperBoundBytes
          ? new JournalBeginResult(JournalBeginDisposition.TerminalReplay, null, terminal)
          : new JournalBeginResult(JournalBeginDisposition.IdempotencyConflict, null, null);
      }

      if (IsFenced(request))
      {
        return new JournalBeginResult(JournalBeginDisposition.Fenced, null, null);
      }

      if (_activeActions.TryGetValue(request.IdempotencyKey, out var activeAction))
      {
        return new JournalBeginResult(
          activeAction.ActionId == request.ActionId
            && PayloadDigest.FixedTimeEqualsHex(
              activeAction.RequestSha256,
              RequestFingerprint(request))
            && activeAction.MaximumExternalEgressBytes == maximumExternalEgressBytes
            && activeAction.ReservedBrokerExternalEgressBytes
              == reservedBrokerExternalEgressBytes
            && activeAction.BrokerMaxDeliverySessions == brokerMaxDeliverySessions
            && activeAction.BrokerMaxRequestAttemptsPerSession
              == brokerMaxRequestAttemptsPerSession
            && activeAction.BrokerSerializedResultUpperBoundBytes
              == brokerSerializedResultUpperBoundBytes
            ? JournalBeginDisposition.AlreadyRunning
            : JournalBeginDisposition.IdempotencyConflict,
          null,
          null);
      }

      if (_activeActions.Count != 0)
      {
        return new JournalBeginResult(JournalBeginDisposition.JournalBusy, null, null);
      }

      var preparedPayload = new PreparedPayload(
        request.TaskId,
        request.PlanVersionId,
        request.StepId,
        request.DeviceId,
        request.MandateId,
        request.CapabilityId,
        request.CapabilityVersion,
        request.ArgumentsSha256,
        request.ExpectedPreStateSha256,
        request.InputProvenanceSha256,
        compactTokenSha256,
        maximumExternalEgressBytes,
        reservedBrokerExternalEgressBytes,
        brokerMaxDeliverySessions,
        brokerMaxRequestAttemptsPerSession,
        brokerSerializedResultUpperBoundBytes);
      var payload = JsonSerializer.Serialize(preparedPayload, SerializerOptions);

      var record = await AppendInternalAsync(
        JournalEntryKind.Prepared,
        request.ActionId,
        request.IdempotencyKey,
        payload).ConfigureAwait(false);
      _activeActions.Add(
        request.IdempotencyKey,
        new ActiveAction(
           request.ActionId,
           RequestFingerprint(request),
           record,
           preparedPayload,
           null,
           compactTokenSha256,
           maximumExternalEgressBytes,
          reservedBrokerExternalEgressBytes,
          brokerMaxDeliverySessions,
          brokerMaxRequestAttemptsPerSession,
          brokerSerializedResultUpperBoundBytes));
      return new JournalBeginResult(JournalBeginDisposition.Started, record, null);
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<JournalTerminalReceipt?> TryGetTerminalAsync(
    ActionRequest request,
    CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureInitialized();

      if (!_terminalReceipts.TryGetValue(request.IdempotencyKey, out var terminal)
        || terminal.ActionId != request.ActionId
        || !PayloadDigest.FixedTimeEqualsHex(
          terminal.RequestSha256,
          RequestFingerprint(request)))
      {
        return null;
      }

      return terminal;
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<JournalFenceResult> TryFenceAsync(
    FenceActionRequest request,
    CancellationToken cancellationToken)
  {
    if (!FenceRequestIsCanonical(request))
    {
      throw new ArgumentException("The action-fence request is not canonical.", nameof(request));
    }

    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureInitialized();
      if (_fenceTombstones.TryGetValue(request.FenceId, out var existing))
      {
        return FenceMatchesRequest(existing.Payload, request)
          ? new JournalFenceResult(
            JournalFenceDisposition.AlreadyFencedNoPrepared,
            existing.Record)
          : new JournalFenceResult(JournalFenceDisposition.FenceConflict, null);
      }

      if (_activeActions.Values.Any(active =>
          string.Equals(active.ActionId, request.ActionId, StringComparison.Ordinal))
        || _terminalReceipts.Values.Any(terminal =>
          string.Equals(terminal.ActionId, request.ActionId, StringComparison.Ordinal)))
      {
        return new JournalFenceResult(JournalFenceDisposition.ActionAlreadyPrepared, null);
      }

      if (_head.Sequence != request.JournalPreviousSequence
        || !PayloadDigest.FixedTimeEqualsHex(_head.EntryHash, request.JournalPreviousHash))
      {
        return new JournalFenceResult(
          JournalFenceDisposition.JournalPredecessorMismatch,
          null);
      }

      var payload = FencePayload(request);
      var record = await AppendInternalAsync(
        JournalEntryKind.ActionFenced,
        request.ActionId,
        request.FenceId,
        JsonSerializer.Serialize(payload, SerializerOptions)).ConfigureAwait(false);
      AcceptFence(request.FenceId, new FenceTombstone(payload, record));
      return new JournalFenceResult(JournalFenceDisposition.FencedNoPrepared, record);
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<bool> IsFencedAsync(
    ActionRequest request,
    CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureInitialized();
      return IsFenced(request);
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<JournalRecord> AppendRecoveryPreparedAsync(
    JournalRecoveryPreparedCheckpoint checkpoint,
    CancellationToken cancellationToken)
  {
    if (!RecoveryCheckpointIsValid(checkpoint))
    {
      throw new ArgumentException(
        "Recovery checkpoint context and digests must be canonical.",
        nameof(checkpoint));
    }

    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureInitialized();
      if (!_activeActions.TryGetValue(checkpoint.IdempotencyKey, out var active)
        || !CheckpointMatchesPreparation(checkpoint, active))
      {
        throw new InvalidOperationException(
          "Recovery checkpoint does not match the active prepared action.");
      }
      if (active.RecoveryCheckpoint is not null)
      {
        throw new InvalidOperationException(
          "The active action already has a recovery checkpoint.");
      }

      var payload = new RecoveryPreparedPayload(
        checkpoint.TaskId,
        checkpoint.PlanVersionId,
        checkpoint.StepId,
        checkpoint.DeviceId,
        checkpoint.MandateId,
        checkpoint.PreStateSha256,
        checkpoint.RecoveryProvenanceSha256,
        checkpoint.RecoveryHandleSha256);
      var record = await AppendInternalAsync(
        JournalEntryKind.RecoveryPrepared,
        checkpoint.ActionId,
        checkpoint.IdempotencyKey,
        JsonSerializer.Serialize(payload, SerializerOptions)).ConfigureAwait(false);
      _activeActions[checkpoint.IdempotencyKey] = active with
      {
        RecoveryCheckpoint = new RecoveryCheckpoint(payload, record),
      };
      return record;
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<JournalTerminalReceipt> AppendTerminalAsync(
    ActionRequest request,
    ActionResult result,
    JournalEntryKind kind,
    CancellationToken cancellationToken)
  {
    if (kind is JournalEntryKind.Prepared or JournalEntryKind.RecoveryPrepared)
    {
      throw new ArgumentOutOfRangeException(
        nameof(kind),
        "A terminal append requires a terminal journal kind.");
    }

    if (!TerminalKindMatchesOutcome(kind, result.Outcome))
    {
      throw new ArgumentException("Terminal journal kind does not match the action outcome.", nameof(kind));
    }
    if (result.LocalBytesRead < 0
      || result.LocalBytesWritten < 0
      || result.ExternalEgressBytes < 0
      || result.BrokerExternalEgressBytes <= 0
      || result.UncertainExternalEgressBytes < 0
      || result.ActionTokenSha256 is null
      || !PayloadDigest.IsSha256Hex(result.ActionTokenSha256)
      || (result.ErrorCode is not null
        && !CompanionWireContract.IsSafeIdentifier(result.ErrorCode))
      || (result.PreStateSha256 is not null
        && !PayloadDigest.IsSha256Hex(result.PreStateSha256))
      || (result.RecoveryProvenanceSha256 is not null
        && !PayloadDigest.IsSha256Hex(result.RecoveryProvenanceSha256))
      || (result.RecoveryHandleSha256 is not null
        && !PayloadDigest.IsSha256Hex(result.RecoveryHandleSha256))
      || !ProvenanceIsValid(result.Provenance))
    {
      throw new ArgumentException(
        "Terminal result usage, digests, error code, or provenance violate the wire contract.",
        nameof(result));
    }

    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureInitialized();
      if (!_activeActions.TryGetValue(request.IdempotencyKey, out var activeAction)
        || activeAction.ActionId != request.ActionId
        || !PayloadDigest.FixedTimeEqualsHex(
          activeAction.RequestSha256,
          RequestFingerprint(request))
         || result.ActionId != request.ActionId
         || result.TaskId != request.TaskId
         || result.StepId != request.StepId
         || !PayloadDigest.FixedTimeEqualsHex(
           result.ActionTokenSha256,
           activeAction.CompactTokenSha256))
      {
        throw new InvalidOperationException("Terminal outcome does not match a prepared action.");
      }
      if (result.BrokerExternalEgressBytes > activeAction.ReservedBrokerExternalEgressBytes
        || result.BrokerExternalEgressBytes != activeAction.ReservedBrokerExternalEgressBytes
        || result.BrokerMaxDeliverySessions != activeAction.BrokerMaxDeliverySessions
        || result.BrokerMaxRequestAttemptsPerSession
          != activeAction.BrokerMaxRequestAttemptsPerSession
        || result.BrokerSerializedResultUpperBoundBytes
          != activeAction.BrokerSerializedResultUpperBoundBytes
        || !BrokerReservationMatches(
          result.BrokerExternalEgressBytes,
          result.BrokerMaxDeliverySessions,
          result.BrokerMaxRequestAttemptsPerSession,
          result.BrokerSerializedResultUpperBoundBytes)
        || result.ExternalEgressBytes > activeAction.MaximumExternalEgressBytes
        || result.BrokerExternalEgressBytes
          > activeAction.MaximumExternalEgressBytes - result.ExternalEgressBytes
        || result.UncertainExternalEgressBytes
          > activeAction.MaximumExternalEgressBytes
            - result.ExternalEgressBytes
            - result.BrokerExternalEgressBytes
        || (result.UncertainExternalEgressBytes > 0
          && result.Outcome != ActionOutcome.NeedsAttention))
      {
        throw new InvalidOperationException("Terminal egress usage exceeds its prepared reservation.");
      }

      var recoveryCheckpoint = activeAction.RecoveryCheckpoint?.Payload;
      var mergedPreState = MergeCheckpointDigest(
        result.PreStateSha256,
        recoveryCheckpoint?.PreStateSha256,
        "pre-state");
      var mergedRecoveryProvenance = MergeCheckpointDigest(
        result.RecoveryProvenanceSha256,
        recoveryCheckpoint?.RecoveryProvenanceSha256,
        "recovery record");
      var mergedRecoveryHandle = MergeCheckpointDigest(
        result.RecoveryHandleSha256,
        recoveryCheckpoint?.RecoveryHandleSha256,
        "recovery handle");

      var terminalPayload = new TerminalPayload(
        result.TaskId,
        result.StepId,
        RequestFingerprint(request),
        result.Outcome,
        result.OutputSha256,
        result.MutationCommitted,
        result.OutcomeUncertain,
        result.ErrorCode,
        mergedPreState,
        mergedRecoveryProvenance,
        mergedRecoveryHandle,
        result.LocalBytesRead,
        result.LocalBytesWritten,
        result.ExternalEgressBytes,
        result.BrokerExternalEgressBytes,
        result.UncertainExternalEgressBytes,
        result.BrokerMaxDeliverySessions,
        result.BrokerMaxRequestAttemptsPerSession,
        result.BrokerSerializedResultUpperBoundBytes,
        result.Provenance,
        result.EgressEvidence is null
          ? null
          : EgressBoundaryCanonical.EvidenceSha256(
            result.ActionTokenSha256,
            result.EgressEvidence),
        result.EgressEvidence);
      var payload = JsonSerializer.Serialize(terminalPayload, SerializerOptions);
      var record = await AppendInternalAsync(
        kind,
        request.ActionId,
        request.IdempotencyKey,
        payload).ConfigureAwait(false);

      var receipt = ToReceipt(
        activeAction.PreparedRecord,
        activeAction.RecoveryCheckpoint?.Record,
        record,
        terminalPayload,
        activeAction.MaximumExternalEgressBytes,
        activeAction.CompactTokenSha256);
      _activeActions.Remove(request.IdempotencyKey);
      _terminalReceipts.Add(request.IdempotencyKey, receipt);
      return receipt;
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<JournalHead> GetHeadAsync(CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureInitialized();
      return _head;
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<JournalRecordRange> ReadRangeAsync(
    long afterSequence,
    int maximumEntries,
    CancellationToken cancellationToken)
  {
    ArgumentOutOfRangeException.ThrowIfNegative(afterSequence);
    if (maximumEntries is < 1 or > JournalReconciliationContract.MaximumEntriesPerRange)
    {
      throw new ArgumentOutOfRangeException(nameof(maximumEntries));
    }

    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureInitialized();
      if (afterSequence > _head.Sequence)
      {
        throw new ArgumentOutOfRangeException(
          nameof(afterSequence),
          "The reconciliation cursor is beyond the local journal head.");
      }

      var predecessor = afterSequence == 0
        ? new JournalHead(0, GenesisHash)
        : new JournalHead(
          afterSequence,
          _records[checked((int)afterSequence - 1)].EntryHash);
      var entries = _records
        .Skip(checked((int)afterSequence))
        .Take(maximumEntries)
        .ToArray();
      var finalHead = entries.Length == 0
        ? predecessor
        : new JournalHead(entries[^1].Sequence, entries[^1].EntryHash);
      return new JournalRecordRange(predecessor, entries, finalHead, _head);
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<JournalVerificationResult> VerifyAsync(CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureInitialized();
      try
      {
        var loaded = LoadAndVerify();
        if (loaded.Head != _head)
        {
          return new JournalVerificationResult(
            false,
            loaded.Head.Sequence,
            loaded.Head.Sequence + 1,
            "journal_head_changed");
        }

        return new JournalVerificationResult(true, loaded.Head.Sequence, null, null);
      }
      catch (JournalIntegrityException exception)
      {
        return new JournalVerificationResult(
          false,
          exception.Sequence - 1,
          exception.Sequence,
          exception.ErrorCode);
      }
    }
    finally
    {
      _gate.Release();
    }
  }

  public void Dispose()
  {
    _ownershipLock?.Dispose();
    _gate.Dispose();
  }

  private LoadedJournalState LoadAndVerify()
  {
    var head = new JournalHead(0, GenesisHash);
    var records = new List<JournalRecord>();
    var active = new Dictionary<string, ActivePreparation>(StringComparer.Ordinal);
    var terminal = new Dictionary<string, JournalTerminalReceipt>(StringComparer.Ordinal);
    var fences = new Dictionary<string, FenceTombstone>(StringComparer.Ordinal);

    if (!File.Exists(_path))
    {
      return new LoadedJournalState(head, records, active, terminal, fences);
    }

    foreach (var line in File.ReadLines(_path, Encoding.UTF8))
    {
      var expectedSequence = head.Sequence + 1;
      if (string.IsNullOrWhiteSpace(line))
      {
        throw new JournalIntegrityException(expectedSequence, "journal_blank_record");
      }

      PersistedJournalLine persisted;
      try
      {
        persisted = JsonSerializer.Deserialize<PersistedJournalLine>(line, SerializerOptions)
          ?? throw new JsonException("Journal line deserialized to null.");
      }
      catch (JsonException)
      {
        throw new JournalIntegrityException(expectedSequence, "journal_record_malformed");
      }

      if (persisted.Sequence != expectedSequence
        || string.IsNullOrWhiteSpace(persisted.ActionId)
        || string.IsNullOrWhiteSpace(persisted.IdempotencyKey)
        || string.IsNullOrWhiteSpace(persisted.PreviousHash)
        || string.IsNullOrWhiteSpace(persisted.PayloadSha256)
        || persisted.PayloadJson is null
        || string.IsNullOrWhiteSpace(persisted.EntryHash)
        || !string.Equals(persisted.PreviousHash, head.EntryHash, StringComparison.Ordinal)
        || !PayloadDigest.FixedTimeEqualsHex(
          persisted.PayloadSha256,
          PayloadDigest.Sha256Hex(persisted.PayloadJson)))
      {
        throw new JournalIntegrityException(expectedSequence, "journal_chain_invalid");
      }

      var expectedEntryHash = ComputeEntryHash(persisted with { EntryHash = string.Empty });
      if (!PayloadDigest.FixedTimeEqualsHex(persisted.EntryHash, expectedEntryHash))
      {
        throw new JournalIntegrityException(expectedSequence, "journal_entry_hash_invalid");
      }

      var record = ToRecord(persisted);
      var previousHashVersion = records.Count == 0 ? 0 : records[^1].HashVersion;
      if (record.HashVersion == LegacyHashVersion
        && previousHashVersion == DigestOnlyHashVersion)
      {
        throw new JournalIntegrityException(expectedSequence, "journal_hash_version_downgrade");
      }
      if (record.HashVersion == DigestOnlyHashVersion
        && previousHashVersion == LegacyHashVersion
        && record.Kind != JournalEntryKind.ChainUpgraded)
      {
        throw new JournalIntegrityException(expectedSequence, "journal_chain_upgrade_missing");
      }
      if (record.Kind == JournalEntryKind.ChainUpgraded
        && previousHashVersion != LegacyHashVersion)
      {
        throw new JournalIntegrityException(expectedSequence, "journal_chain_upgrade_invalid");
      }
      records.Add(record);
      head = new JournalHead(record.Sequence, record.EntryHash);

      if (record.Kind == JournalEntryKind.Prepared)
      {
        if (active.Count != 0)
        {
          throw new JournalIntegrityException(expectedSequence, "journal_interleaved_prepare");
        }
        if (active.ContainsKey(record.IdempotencyKey) || terminal.ContainsKey(record.IdempotencyKey))
        {
          throw new JournalIntegrityException(expectedSequence, "journal_idempotency_duplicate");
        }

        PreparedPayload preparedPayload;
        try
        {
          preparedPayload = JsonSerializer.Deserialize<PreparedPayload>(
            persisted.PayloadJson,
            SerializerOptions) ?? throw new JsonException("Prepared payload deserialized to null.");
        }
        catch (JsonException)
        {
          throw new JournalIntegrityException(expectedSequence, "journal_prepare_malformed");
        }

        if (!PreparedPayloadIsValid(preparedPayload))
        {
          throw new JournalIntegrityException(expectedSequence, "journal_prepare_invalid");
        }

        active.Add(
          record.IdempotencyKey,
          new ActivePreparation(
            record.ActionId,
            preparedPayload,
            record,
            null));
        continue;
      }

      if (record.Kind == JournalEntryKind.RecoveryPrepared)
      {
        if (!active.TryGetValue(record.IdempotencyKey, out var checkpointPreparation)
          || checkpointPreparation.ActionId != record.ActionId)
        {
          throw new JournalIntegrityException(
            expectedSequence,
            "journal_recovery_checkpoint_without_prepare");
        }
        if (checkpointPreparation.RecoveryCheckpoint is not null)
        {
          throw new JournalIntegrityException(
            expectedSequence,
            "journal_recovery_checkpoint_duplicate");
        }

        RecoveryPreparedPayload recoveryPayload;
        try
        {
          recoveryPayload = DeserializeRecoveryPreparedPayload(
            persisted.PayloadJson);
        }
        catch (JsonException)
        {
          throw new JournalIntegrityException(
            expectedSequence,
            "journal_recovery_checkpoint_malformed");
        }
        if (!RecoveryPayloadMatchesPreparation(
          recoveryPayload,
          checkpointPreparation.Payload))
        {
          throw new JournalIntegrityException(
            expectedSequence,
            "journal_recovery_checkpoint_invalid");
        }

        active[record.IdempotencyKey] = checkpointPreparation with
        {
          RecoveryCheckpoint = new RecoveryCheckpoint(recoveryPayload, record),
        };
        continue;
      }

      if (record.Kind == JournalEntryKind.ActionFenced)
      {
        if (active.Count != 0 || fences.ContainsKey(record.IdempotencyKey))
        {
          throw new JournalIntegrityException(
            expectedSequence,
            "journal_action_fence_conflict");
        }

        ActionFencePayload fencePayload;
        try
        {
          fencePayload = DeserializeActionFencePayload(persisted.PayloadJson);
        }
        catch (JsonException)
        {
          throw new JournalIntegrityException(
            expectedSequence,
            "journal_action_fence_malformed");
        }

        if (!FencePayloadIsCanonical(fencePayload)
          || !string.Equals(fencePayload.ActionId, record.ActionId, StringComparison.Ordinal)
          || !string.Equals(fencePayload.FenceId, record.IdempotencyKey, StringComparison.Ordinal)
          || fencePayload.JournalPreviousSequence != record.Sequence - 1
          || !PayloadDigest.FixedTimeEqualsHex(
            fencePayload.JournalPreviousHash,
            record.PreviousHash))
        {
          throw new JournalIntegrityException(
            expectedSequence,
            "journal_action_fence_invalid");
        }

        fences.Add(record.IdempotencyKey, new FenceTombstone(fencePayload, record));
        continue;
      }

      if (record.Kind == JournalEntryKind.ChainUpgraded)
      {
        ChainUpgradePayload upgrade;
        try
        {
          upgrade = JsonSerializer.Deserialize<ChainUpgradePayload>(
            persisted.PayloadJson,
            SerializerOptions) ?? throw new JsonException("Chain upgrade deserialized to null.");
        }
        catch (JsonException)
        {
          throw new JournalIntegrityException(expectedSequence, "journal_chain_upgrade_malformed");
        }
        if (record.HashVersion != DigestOnlyHashVersion
          || upgrade.FromHashVersion != LegacyHashVersion
          || !PayloadDigest.FixedTimeEqualsHex(upgrade.PreviousEntryHash, record.PreviousHash))
        {
          throw new JournalIntegrityException(expectedSequence, "journal_chain_upgrade_invalid");
        }
        continue;
      }

      if (!Enum.IsDefined(record.Kind)
        || !active.Remove(record.IdempotencyKey, out var preparation)
        || preparation.ActionId != record.ActionId)
      {
        throw new JournalIntegrityException(expectedSequence, "journal_terminal_without_prepare");
      }

      TerminalPayload terminalPayload;
      try
      {
        terminalPayload = JsonSerializer.Deserialize<TerminalPayload>(
          persisted.PayloadJson,
          SerializerOptions) ?? throw new JsonException("Terminal payload deserialized to null.");
      }
      catch (JsonException)
      {
        throw new JournalIntegrityException(expectedSequence, "journal_terminal_malformed");
      }

      if (string.IsNullOrWhiteSpace(terminalPayload.TaskId)
        || string.IsNullOrWhiteSpace(terminalPayload.StepId)
        || terminalPayload.TaskId != preparation.Payload.TaskId
        || terminalPayload.StepId != preparation.Payload.StepId
        || !PayloadDigest.IsSha256Hex(terminalPayload.RequestSha256)
        || (terminalPayload.OutputSha256 is not null
          && !PayloadDigest.IsSha256Hex(terminalPayload.OutputSha256))
        || !Enum.IsDefined(terminalPayload.Outcome)
        || (terminalPayload.ErrorCode is not null
          && !CompanionWireContract.IsSafeIdentifier(terminalPayload.ErrorCode))
        || (terminalPayload.PreStateSha256 is not null
          && !PayloadDigest.IsSha256Hex(terminalPayload.PreStateSha256))
        || (terminalPayload.RecoveryProvenanceSha256 is not null
          && !PayloadDigest.IsSha256Hex(terminalPayload.RecoveryProvenanceSha256))
        || (terminalPayload.RecoveryHandleSha256 is not null
          && !PayloadDigest.IsSha256Hex(terminalPayload.RecoveryHandleSha256))
        || terminalPayload.LocalBytesRead < 0
        || terminalPayload.LocalBytesWritten < 0
        || terminalPayload.ExternalEgressBytes < 0
        || terminalPayload.BrokerExternalEgressBytes <= 0
        || terminalPayload.UncertainExternalEgressBytes < 0
        || (terminalPayload.EgressEvidenceSha256 is null)
          != (terminalPayload.EgressEvidence is null)
        || (terminalPayload.EgressEvidenceSha256 is not null
          && (!PayloadDigest.IsSha256Hex(terminalPayload.EgressEvidenceSha256)
            || !PayloadDigest.FixedTimeEqualsHex(
              terminalPayload.EgressEvidenceSha256,
              EgressBoundaryCanonical.EvidenceSha256(
                preparation.Payload.CompactTokenSha256,
                terminalPayload.EgressEvidence!))))
        || terminalPayload.BrokerExternalEgressBytes
          != preparation.Payload.ReservedBrokerExternalEgressBytes
        || terminalPayload.BrokerMaxDeliverySessions
          != preparation.Payload.BrokerMaxDeliverySessions
        || terminalPayload.BrokerMaxRequestAttemptsPerSession
          != preparation.Payload.BrokerMaxRequestAttemptsPerSession
        || terminalPayload.BrokerSerializedResultUpperBoundBytes
          != preparation.Payload.BrokerSerializedResultUpperBoundBytes
        || !BrokerReservationMatches(
          terminalPayload.BrokerExternalEgressBytes,
          terminalPayload.BrokerMaxDeliverySessions,
          terminalPayload.BrokerMaxRequestAttemptsPerSession,
          terminalPayload.BrokerSerializedResultUpperBoundBytes)
        || !ProvenanceIsValid(terminalPayload.Provenance)
        || terminalPayload.ExternalEgressBytes
          > preparation.Payload.MaximumExternalEgressBytes
        || terminalPayload.BrokerExternalEgressBytes
          > preparation.Payload.MaximumExternalEgressBytes
            - terminalPayload.ExternalEgressBytes
        || terminalPayload.UncertainExternalEgressBytes
          > preparation.Payload.MaximumExternalEgressBytes
            - terminalPayload.ExternalEgressBytes
            - terminalPayload.BrokerExternalEgressBytes
        || (terminalPayload.UncertainExternalEgressBytes > 0
          && terminalPayload.Outcome != ActionOutcome.NeedsAttention))
      {
        throw new JournalIntegrityException(expectedSequence, "journal_terminal_invalid");
      }

      if (!TerminalKindMatchesOutcome(record.Kind, terminalPayload.Outcome))
      {
        throw new JournalIntegrityException(expectedSequence, "journal_terminal_kind_mismatch");
      }

      if (preparation.RecoveryCheckpoint is { } recoveryCheckpoint
        && !TerminalMatchesRecoveryCheckpoint(
          terminalPayload,
          recoveryCheckpoint.Payload))
      {
        throw new JournalIntegrityException(
          expectedSequence,
          "journal_terminal_recovery_checkpoint_conflict");
      }

      if (!PayloadDigest.FixedTimeEqualsHex(
        terminalPayload.RequestSha256,
        RequestFingerprint(record.ActionId, record.IdempotencyKey, preparation.Payload)))
      {
        throw new JournalIntegrityException(expectedSequence, "journal_request_fingerprint_mismatch");
      }

      terminal.Add(
        record.IdempotencyKey,
         ToReceipt(
           preparation.Record,
           preparation.RecoveryCheckpoint?.Record,
           record,
          terminalPayload,
          preparation.Payload.MaximumExternalEgressBytes,
          preparation.Payload.CompactTokenSha256));
    }

    return new LoadedJournalState(head, records, active, terminal, fences);
  }

  private async ValueTask<JournalRecord> AppendInternalAsync(
    JournalEntryKind kind,
    string actionId,
    string idempotencyKey,
    string payloadJson)
  {
    var persisted = new PersistedJournalLine(
      Sequence: _head.Sequence + 1,
      OccurredAtUnixMilliseconds: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
      Kind: kind,
      ActionId: actionId,
      IdempotencyKey: idempotencyKey,
      PreviousHash: _head.EntryHash,
      PayloadSha256: PayloadDigest.Sha256Hex(payloadJson),
      PayloadJson: payloadJson,
      EntryHash: string.Empty,
      HashVersion: DigestOnlyHashVersion);
    persisted = persisted with { EntryHash = ComputeEntryHash(persisted) };

    var serialized = $"{JsonSerializer.Serialize(persisted, SerializerOptions)}\n";
    var bytes = Encoding.UTF8.GetBytes(serialized);
    try
    {
      await _appendBytes(_path, bytes, CancellationToken.None).ConfigureAwait(false);
    }
    catch
    {
      // The bytes may already be durable even though write/flush/close failed.
      // The in-memory head is now unknowable: fail every later operation until
      // a fresh process reopens and verifies the physical journal.
      _faulted = true;
      throw;
    }

    var record = ToRecord(persisted);
    _head = new JournalHead(record.Sequence, record.EntryHash);
    _records.Add(record);
    return record;
  }

  private static string ComputeEntryHash(PersistedJournalLine line)
  {
    if (line.HashVersion is 0 or LegacyHashVersion)
    {
      var legacyMaterial = JsonSerializer.Serialize(new EntryHashMaterial(
        line.Sequence,
        line.OccurredAtUnixMilliseconds,
        line.Kind,
        line.ActionId,
        line.IdempotencyKey,
        line.PreviousHash,
        line.PayloadSha256,
        line.PayloadJson), SerializerOptions);
      return PayloadDigest.Sha256Hex(legacyMaterial);
    }
    if (line.HashVersion != DigestOnlyHashVersion)
    {
      throw new JournalIntegrityException(line.Sequence, "journal_hash_version_unsupported");
    }

    return ComputeDigestOnlyEntryHash(
      line.HashVersion,
      line.Sequence,
      line.OccurredAtUnixMilliseconds,
      (int)line.Kind,
      line.ActionId,
      line.IdempotencyKey,
      line.PreviousHash,
      line.PayloadSha256);
  }

  internal static string ComputeDigestOnlyEntryHash(
    int hashVersion,
    long sequence,
    long occurredAtUnixMilliseconds,
    int kind,
    string actionId,
    string idempotencyKey,
    string previousHash,
    string payloadSha256) => PayloadDigest.Sha256Hex(JsonSerializer.Serialize(
      new DigestOnlyEntryHashMaterial(
        hashVersion,
        sequence,
        occurredAtUnixMilliseconds,
        kind,
        actionId,
        idempotencyKey,
        previousHash,
        payloadSha256),
      SerializerOptions));

  private static JournalRecord ToRecord(PersistedJournalLine line) => new(
    line.Sequence,
    DateTimeOffset.FromUnixTimeMilliseconds(line.OccurredAtUnixMilliseconds),
    line.Kind,
    line.ActionId,
    line.IdempotencyKey,
    line.PreviousHash,
    line.PayloadSha256,
    line.EntryHash,
    line.HashVersion is 0 or LegacyHashVersion ? LegacyHashVersion : line.HashVersion);

  private static JournalTerminalReceipt ToReceipt(
    JournalRecord preparedRecord,
    JournalRecord? recoveryPreparedRecord,
    JournalRecord terminalRecord,
    TerminalPayload payload,
    long maximumExternalEgressBytes,
    string actionTokenSha256) => new(
      terminalRecord.ActionId,
      payload.TaskId,
      payload.StepId,
      payload.RequestSha256,
      payload.Outcome,
      payload.OutputSha256,
      payload.MutationCommitted,
      payload.OutcomeUncertain,
      payload.ErrorCode,
      preparedRecord.Sequence,
      preparedRecord.EntryHash,
      preparedRecord.PreviousHash,
      terminalRecord.Sequence,
      terminalRecord.EntryHash,
      terminalRecord.PreviousHash,
      payload.PreStateSha256,
      payload.RecoveryProvenanceSha256,
      payload.RecoveryHandleSha256,
      payload.LocalBytesRead,
      payload.LocalBytesWritten,
      payload.ExternalEgressBytes,
      payload.BrokerExternalEgressBytes,
      payload.UncertainExternalEgressBytes,
      maximumExternalEgressBytes,
      payload.BrokerMaxDeliverySessions,
      payload.BrokerMaxRequestAttemptsPerSession,
      payload.BrokerSerializedResultUpperBoundBytes,
      payload.Provenance,
      actionTokenSha256,
      payload.EgressEvidenceSha256,
      payload.EgressEvidence,
      recoveryPreparedRecord?.Sequence,
      recoveryPreparedRecord?.EntryHash,
      recoveryPreparedRecord?.PreviousHash);

  private static bool TerminalKindMatchesOutcome(JournalEntryKind kind, ActionOutcome outcome) =>
    (kind, outcome) switch
    {
      (JournalEntryKind.Completed, ActionOutcome.Completed) => true,
      (JournalEntryKind.Rejected, ActionOutcome.Rejected) => true,
      (JournalEntryKind.Cancelled, ActionOutcome.Cancelled) => true,
      (JournalEntryKind.NeedsAttention, ActionOutcome.NeedsAttention) => true,
      (JournalEntryKind.Failed, ActionOutcome.Failed) => true,
      _ => false,
    };

  private static string? MergeCheckpointDigest(
    string? terminalValue,
    string? checkpointValue,
    string field)
  {
    if (checkpointValue is null)
    {
      return terminalValue;
    }
    if (terminalValue is null)
    {
      return checkpointValue;
    }
    if (!PayloadDigest.FixedTimeEqualsHex(terminalValue, checkpointValue))
    {
      throw new InvalidOperationException(
        $"Terminal {field} metadata conflicts with the durable recovery checkpoint.");
    }
    return terminalValue;
  }

  private static bool RecoveryCheckpointIsValid(
    JournalRecoveryPreparedCheckpoint checkpoint) =>
    ContextValueIsValid(checkpoint.ActionId)
    && ContextValueIsValid(checkpoint.IdempotencyKey)
    && ContextValueIsValid(checkpoint.TaskId)
    && ContextValueIsValid(checkpoint.PlanVersionId)
    && ContextValueIsValid(checkpoint.StepId)
    && ContextValueIsValid(checkpoint.DeviceId)
    && ContextValueIsValid(checkpoint.MandateId)
    && PayloadDigest.IsSha256Hex(checkpoint.PreStateSha256)
    && PayloadDigest.IsSha256Hex(checkpoint.RecoveryProvenanceSha256)
    && PayloadDigest.IsSha256Hex(checkpoint.RecoveryHandleSha256);

  private static bool ContextValueIsValid(string value) =>
    !string.IsNullOrWhiteSpace(value) && value.Length <= 512;

  private static bool CheckpointMatchesPreparation(
    JournalRecoveryPreparedCheckpoint checkpoint,
    ActiveAction active) =>
    checkpoint.ActionId == active.ActionId
    && checkpoint.TaskId == active.Payload.TaskId
    && checkpoint.PlanVersionId == active.Payload.PlanVersionId
    && checkpoint.StepId == active.Payload.StepId
    && checkpoint.DeviceId == active.Payload.DeviceId
    && checkpoint.MandateId == active.Payload.MandateId
    && active.Payload.ExpectedPreStateSha256 is not null
    && PayloadDigest.FixedTimeEqualsHex(
      checkpoint.PreStateSha256,
      active.Payload.ExpectedPreStateSha256);

  private static bool RecoveryPayloadMatchesPreparation(
    RecoveryPreparedPayload checkpoint,
    PreparedPayload preparation) =>
    ContextValueIsValid(checkpoint.TaskId)
    && ContextValueIsValid(checkpoint.PlanVersionId)
    && ContextValueIsValid(checkpoint.StepId)
    && ContextValueIsValid(checkpoint.DeviceId)
    && ContextValueIsValid(checkpoint.MandateId)
    && checkpoint.TaskId == preparation.TaskId
    && checkpoint.PlanVersionId == preparation.PlanVersionId
    && checkpoint.StepId == preparation.StepId
    && checkpoint.DeviceId == preparation.DeviceId
    && checkpoint.MandateId == preparation.MandateId
    && PayloadDigest.IsSha256Hex(checkpoint.PreStateSha256)
    && PayloadDigest.IsSha256Hex(checkpoint.RecoveryProvenanceSha256)
    && PayloadDigest.IsSha256Hex(checkpoint.RecoveryHandleSha256)
    && preparation.ExpectedPreStateSha256 is not null
    && PayloadDigest.FixedTimeEqualsHex(
      checkpoint.PreStateSha256,
      preparation.ExpectedPreStateSha256);

  private static RecoveryPreparedPayload DeserializeRecoveryPreparedPayload(
    string payloadJson)
  {
    using var document = JsonDocument.Parse(payloadJson, new JsonDocumentOptions
    {
      AllowTrailingCommas = false,
      CommentHandling = JsonCommentHandling.Disallow,
      MaxDepth = 4,
    });
    var root = document.RootElement;
    var expected = new HashSet<string>(
      [
        "taskId",
        "planVersionId",
        "stepId",
        "deviceId",
        "mandateId",
        "preStateSha256",
        "recoveryProvenanceSha256",
        "recoveryHandleSha256",
      ],
      StringComparer.Ordinal);
    var properties = root.ValueKind == JsonValueKind.Object
      ? root.EnumerateObject().Select(property => property.Name).ToArray()
      : [];
    if (properties.Length != expected.Count
      || !properties.ToHashSet(StringComparer.Ordinal).SetEquals(expected))
    {
      throw new JsonException("Recovery checkpoint payload is not exact.");
    }

    return JsonSerializer.Deserialize<RecoveryPreparedPayload>(
      payloadJson,
      SerializerOptions) ?? throw new JsonException(
      "Recovery checkpoint payload deserialized to null.");
  }

  private static ActionFencePayload DeserializeActionFencePayload(string payloadJson)
  {
    using var document = JsonDocument.Parse(payloadJson, new JsonDocumentOptions
    {
      AllowTrailingCommas = false,
      CommentHandling = JsonCommentHandling.Disallow,
      MaxDepth = 4,
    });
    var root = document.RootElement;
    var expected = new HashSet<string>(
      [
        "fenceId",
        "deviceId",
        "actionId",
        "taskId",
        "stepId",
        "oldLeaseId",
        "oldFencingToken",
        "oldActionTokenSha256",
        "journalPreviousSequence",
        "journalPreviousHash",
      ],
      StringComparer.Ordinal);
    var properties = root.ValueKind == JsonValueKind.Object
      ? root.EnumerateObject().Select(property => property.Name).ToArray()
      : [];
    if (properties.Length != expected.Count
      || !properties.ToHashSet(StringComparer.Ordinal).SetEquals(expected))
    {
      throw new JsonException("Action-fence payload is not exact.");
    }

    return JsonSerializer.Deserialize<ActionFencePayload>(
      payloadJson,
      SerializerOptions) ?? throw new JsonException(
        "Action-fence payload deserialized to null.");
  }

  private static bool TerminalMatchesRecoveryCheckpoint(
    TerminalPayload terminal,
    RecoveryPreparedPayload checkpoint) =>
    terminal.PreStateSha256 is not null
    && terminal.RecoveryProvenanceSha256 is not null
    && terminal.RecoveryHandleSha256 is not null
    && PayloadDigest.FixedTimeEqualsHex(
      terminal.PreStateSha256,
      checkpoint.PreStateSha256)
    && PayloadDigest.FixedTimeEqualsHex(
      terminal.RecoveryProvenanceSha256,
      checkpoint.RecoveryProvenanceSha256)
    && PayloadDigest.FixedTimeEqualsHex(
      terminal.RecoveryHandleSha256,
      checkpoint.RecoveryHandleSha256);

  private static bool BrokerReservationMatches(
    long reservation,
    int deliverySessions,
    int requestAttemptsPerSession,
    long serializedResultUpperBoundBytes)
  {
    if (reservation <= 0
      || deliverySessions is < 1 or > 16
      || requestAttemptsPerSession is < 1 or > 5
      || serializedResultUpperBoundBytes <= 0)
    {
      return false;
    }
    try
    {
      return checked(
        serializedResultUpperBoundBytes
        * deliverySessions
        * requestAttemptsPerSession) == reservation;
    }
    catch (OverflowException)
    {
      return false;
    }
  }

  private static bool ProvenanceIsValid(IReadOnlyList<DataProvenance>? provenance) =>
    provenance is not null
    && provenance.Count <= 100
    && provenance.All(item =>
      CompanionWireContract.IsValidProvenanceSourceType(item.SourceType)
      && PayloadDigest.IsSha256Hex(item.SourceIdentifierHash)
      && PayloadDigest.IsSha256Hex(item.ContentSha256)
      && Enum.IsDefined(item.Trust));

  private static bool PreparedPayloadIsValid(PreparedPayload payload) =>
    !string.IsNullOrWhiteSpace(payload.TaskId)
    && !string.IsNullOrWhiteSpace(payload.PlanVersionId)
    && !string.IsNullOrWhiteSpace(payload.StepId)
    && !string.IsNullOrWhiteSpace(payload.DeviceId)
    && !string.IsNullOrWhiteSpace(payload.MandateId)
    && !string.IsNullOrWhiteSpace(payload.CapabilityId)
    && !string.IsNullOrWhiteSpace(payload.CapabilityVersion)
    && PayloadDigest.IsSha256Hex(payload.ArgumentsSha256)
    && (payload.ExpectedPreStateSha256 is null
      || PayloadDigest.IsSha256Hex(payload.ExpectedPreStateSha256))
    && (payload.InputProvenanceSha256 is null
      || PayloadDigest.IsSha256Hex(payload.InputProvenanceSha256))
    && PayloadDigest.IsSha256Hex(payload.CompactTokenSha256)
    && payload.MaximumExternalEgressBytes > 0
    && payload.ReservedBrokerExternalEgressBytes > 0
    && payload.ReservedBrokerExternalEgressBytes <= payload.MaximumExternalEgressBytes
    && BrokerReservationMatches(
      payload.ReservedBrokerExternalEgressBytes,
      payload.BrokerMaxDeliverySessions,
      payload.BrokerMaxRequestAttemptsPerSession,
      payload.BrokerSerializedResultUpperBoundBytes);

  private static string RequestFingerprint(ActionRequest request) =>
    PayloadDigest.Sha256Hex(JsonSerializer.Serialize(new RequestFingerprintPayload(
      request.ActionId,
      request.TaskId,
      request.PlanVersionId,
      request.StepId,
      request.DeviceId,
      request.MandateId,
      request.CapabilityId,
      request.CapabilityVersion,
      request.ArgumentsSha256,
      request.ExpectedPreStateSha256,
      request.InputProvenanceSha256,
      request.IdempotencyKey), SerializerOptions));

  private static string RequestFingerprint(
    string actionId,
    string idempotencyKey,
    PreparedPayload payload) =>
    PayloadDigest.Sha256Hex(JsonSerializer.Serialize(new RequestFingerprintPayload(
      actionId,
      payload.TaskId,
      payload.PlanVersionId,
      payload.StepId,
      payload.DeviceId,
      payload.MandateId,
      payload.CapabilityId,
      payload.CapabilityVersion,
      payload.ArgumentsSha256,
      payload.ExpectedPreStateSha256,
      payload.InputProvenanceSha256,
      idempotencyKey), SerializerOptions));

  private static bool FenceRequestIsCanonical(FenceActionRequest request) =>
    FenceActionWireContract.IsSafeIdentifier(request.FenceId)
    && FenceActionWireContract.IsSafeIdentifier(request.DeviceId)
    && FenceActionWireContract.IsSafeIdentifier(request.ActionId)
    && FenceActionWireContract.IsSafeIdentifier(request.TaskId)
    && FenceActionWireContract.IsSafeIdentifier(request.StepId)
    && LeaseFenceContract.HasValidIdentity(request.OldLeaseId, request.OldFencingToken)
    && PayloadDigest.IsSha256Hex(request.OldActionTokenSha256)
    && request.JournalPreviousSequence >= 0
    && PayloadDigest.IsSha256Hex(request.JournalPreviousHash)
    && request.DispatchCount is >= 1 and <= 3
    && request.ExpiresAt != default;

  private static ActionFencePayload FencePayload(FenceActionRequest request) => new(
    request.FenceId,
    request.DeviceId,
    request.ActionId,
    request.TaskId,
    request.StepId,
    request.OldLeaseId,
    request.OldFencingToken,
    request.OldActionTokenSha256,
    request.JournalPreviousSequence,
    request.JournalPreviousHash);

  private static bool FencePayloadIsCanonical(ActionFencePayload payload) =>
    FenceActionWireContract.IsSafeIdentifier(payload.FenceId)
    && FenceActionWireContract.IsSafeIdentifier(payload.DeviceId)
    && FenceActionWireContract.IsSafeIdentifier(payload.ActionId)
    && FenceActionWireContract.IsSafeIdentifier(payload.TaskId)
    && FenceActionWireContract.IsSafeIdentifier(payload.StepId)
    && LeaseFenceContract.HasValidIdentity(payload.OldLeaseId, payload.OldFencingToken)
    && PayloadDigest.IsSha256Hex(payload.OldActionTokenSha256)
    && payload.JournalPreviousSequence >= 0
    && PayloadDigest.IsSha256Hex(payload.JournalPreviousHash);

  private static bool FenceMatchesRequest(
    ActionFencePayload payload,
    FenceActionRequest request) =>
    string.Equals(payload.FenceId, request.FenceId, StringComparison.Ordinal)
    && string.Equals(payload.DeviceId, request.DeviceId, StringComparison.Ordinal)
    && string.Equals(payload.ActionId, request.ActionId, StringComparison.Ordinal)
    && string.Equals(payload.TaskId, request.TaskId, StringComparison.Ordinal)
    && string.Equals(payload.StepId, request.StepId, StringComparison.Ordinal)
    && string.Equals(payload.OldLeaseId, request.OldLeaseId, StringComparison.Ordinal)
    && string.Equals(
      payload.OldFencingToken,
      request.OldFencingToken,
      StringComparison.Ordinal)
    && PayloadDigest.FixedTimeEqualsHex(
      payload.OldActionTokenSha256,
      request.OldActionTokenSha256)
    && payload.JournalPreviousSequence == request.JournalPreviousSequence
    && PayloadDigest.FixedTimeEqualsHex(
      payload.JournalPreviousHash,
      request.JournalPreviousHash);

  private void AcceptFence(string fenceId, FenceTombstone tombstone)
  {
    _fenceTombstones.Add(fenceId, tombstone);
    if (!long.TryParse(
      tombstone.Payload.OldFencingToken,
      NumberStyles.None,
      CultureInfo.InvariantCulture,
      out var fencingToken))
    {
      throw new InvalidOperationException("A verified action fence has an invalid fencing token.");
    }

    if (!_fenceFloorByDevice.TryGetValue(tombstone.Payload.DeviceId, out var currentFloor)
      || fencingToken > currentFloor)
    {
      _fenceFloorByDevice[tombstone.Payload.DeviceId] = fencingToken;
    }
  }

  private bool IsFenced(ActionRequest request)
  {
    if (!_fenceFloorByDevice.TryGetValue(request.DeviceId, out var fenceFloor)
      || !long.TryParse(
        request.FencingToken,
        NumberStyles.None,
        CultureInfo.InvariantCulture,
        out var requestFence))
    {
      return false;
    }

    return requestFence <= fenceFloor;
  }

  private void EnsureInitialized()
  {
    if (!_initialized)
    {
      throw new InvalidOperationException("The action journal has not been initialized.");
    }
    if (_faulted)
    {
      throw new InvalidOperationException(
        "The action journal has an ambiguous append and requires process restart verification.");
    }
  }

  private static async ValueTask AppendBytesAsync(
    string path,
    ReadOnlyMemory<byte> bytes,
    CancellationToken cancellationToken)
  {
    await using var stream = new FileStream(
      path,
      FileMode.Append,
      FileAccess.Write,
      FileShare.Read,
      4096,
      FileOptions.Asynchronous | FileOptions.WriteThrough);
    await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
    await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
    stream.Flush(flushToDisk: true);
  }

  private sealed record PreparedPayload(
    string TaskId,
    string PlanVersionId,
    string StepId,
    string DeviceId,
    string MandateId,
    string CapabilityId,
    string CapabilityVersion,
    string ArgumentsSha256,
    string? ExpectedPreStateSha256,
    string? InputProvenanceSha256,
    string CompactTokenSha256,
    long MaximumExternalEgressBytes,
    long ReservedBrokerExternalEgressBytes,
    int BrokerMaxDeliverySessions,
    int BrokerMaxRequestAttemptsPerSession,
    long BrokerSerializedResultUpperBoundBytes);

  private sealed record RecoveryPreparedPayload(
    string TaskId,
    string PlanVersionId,
    string StepId,
    string DeviceId,
    string MandateId,
    string PreStateSha256,
    string RecoveryProvenanceSha256,
    string RecoveryHandleSha256);

  private sealed record TerminalPayload(
    string TaskId,
    string StepId,
    string RequestSha256,
    ActionOutcome Outcome,
    string? OutputSha256,
    bool MutationCommitted,
    bool OutcomeUncertain,
    string? ErrorCode,
    string? PreStateSha256 = null,
    string? RecoveryProvenanceSha256 = null,
    string? RecoveryHandleSha256 = null,
    long LocalBytesRead = 0,
    long LocalBytesWritten = 0,
    long ExternalEgressBytes = 0,
    long BrokerExternalEgressBytes = 0,
    long UncertainExternalEgressBytes = 0,
    int BrokerMaxDeliverySessions = 0,
    int BrokerMaxRequestAttemptsPerSession = 0,
    long BrokerSerializedResultUpperBoundBytes = 0,
    IReadOnlyList<DataProvenance>? Provenance = null,
    string? EgressEvidenceSha256 = null,
    EgressExecutionEvidence? EgressEvidence = null);

  private sealed record RequestFingerprintPayload(
    string ActionId,
    string TaskId,
    string PlanVersionId,
    string StepId,
    string DeviceId,
    string MandateId,
    string CapabilityId,
    string CapabilityVersion,
    string ArgumentsSha256,
    string? ExpectedPreStateSha256,
    string? InputProvenanceSha256,
    string IdempotencyKey);

  private sealed record ActionFencePayload(
    string FenceId,
    string DeviceId,
    string ActionId,
    string TaskId,
    string StepId,
    string OldLeaseId,
    string OldFencingToken,
    string OldActionTokenSha256,
    long JournalPreviousSequence,
    string JournalPreviousHash);

  private sealed record PersistedJournalLine(
    long Sequence,
    long OccurredAtUnixMilliseconds,
    JournalEntryKind Kind,
    string ActionId,
    string IdempotencyKey,
    string PreviousHash,
    string PayloadSha256,
    string PayloadJson,
    string EntryHash,
    int HashVersion = LegacyHashVersion);

  private sealed record EntryHashMaterial(
    long Sequence,
    long OccurredAtUnixMilliseconds,
    JournalEntryKind Kind,
    string ActionId,
    string IdempotencyKey,
    string PreviousHash,
    string PayloadSha256,
    string PayloadJson);

  private sealed record DigestOnlyEntryHashMaterial(
    int HashVersion,
    long Sequence,
    long OccurredAtUnixMilliseconds,
    int Kind,
    string ActionId,
    string IdempotencyKey,
    string PreviousHash,
    string PayloadSha256);

  private sealed record ChainUpgradePayload(
    int FromHashVersion,
    string PreviousEntryHash);

  private sealed record LoadedJournalState(
    JournalHead Head,
    IReadOnlyList<JournalRecord> Records,
    IReadOnlyDictionary<string, ActivePreparation> ActivePreparations,
    IReadOnlyDictionary<string, JournalTerminalReceipt> TerminalReceipts,
    IReadOnlyDictionary<string, FenceTombstone> FenceTombstones);

  private sealed record FenceTombstone(
    ActionFencePayload Payload,
    JournalRecord Record);

  private sealed record ActivePreparation(
    string ActionId,
    PreparedPayload Payload,
    JournalRecord Record,
    RecoveryCheckpoint? RecoveryCheckpoint);

  private sealed record ActiveAction(
    string ActionId,
    string RequestSha256,
    JournalRecord PreparedRecord,
    PreparedPayload Payload,
    RecoveryCheckpoint? RecoveryCheckpoint,
    string CompactTokenSha256,
    long MaximumExternalEgressBytes,
    long ReservedBrokerExternalEgressBytes,
    int BrokerMaxDeliverySessions,
    int BrokerMaxRequestAttemptsPerSession,
    long BrokerSerializedResultUpperBoundBytes);

  private sealed record RecoveryCheckpoint(
    RecoveryPreparedPayload Payload,
    JournalRecord Record);

  private sealed class JournalIntegrityException(long sequence, string errorCode) : Exception(errorCode)
  {
    public long Sequence { get; } = sequence;

    public string ErrorCode { get; } = errorCode;
  }
}
