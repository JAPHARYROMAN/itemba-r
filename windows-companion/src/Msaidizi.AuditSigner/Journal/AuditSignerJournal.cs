using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.AuditSigner.Contracts;
using Itemba.Msaidizi.AuditSigner.Security;

namespace Itemba.Msaidizi.AuditSigner.Journal;

public sealed record AuditSignerHead(string Cursor, string EventHash, string ManifestSha256)
{
  public static AuditSignerHead Genesis { get; } = new(
    "0",
    AuditSignerProtocol.ZeroSha256,
    AuditSignerProtocol.ZeroSha256);
}

public sealed record PendingAuditCheckpoint(
  SignedAuditCheckpoint Checkpoint,
  AuditSignerHead NewHead);

public sealed record AuditSignerJournalState(
  AuditSignerHead AcceptedHead,
  PendingAuditCheckpoint? Pending);

public sealed record AuditSignerJournalRecord(
  long Sequence,
  string PreviousJournalHash,
  string JournalHash,
  string Kind,
  string CheckpointId,
  string ManifestSha256,
  string Cursor,
  string EventHash,
  string PreviousCheckpointSha256,
  string PreviousEventHash,
  string? ManifestJson,
  string? Signature,
  DateTimeOffset OccurredAt);

public interface IAuditSignerJournal
{
  AuditSignerJournalState State { get; }
  Task AppendSignedAsync(SignedAuditCheckpoint checkpoint, CancellationToken cancellationToken);
  Task AppendAcceptedAsync(string manifestSha256, CancellationToken cancellationToken);
}

public sealed class FileAuditSignerJournal : IAuditSignerJournal
{
  private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);
  private readonly string _path;
  private readonly object _gate = new();
  private readonly List<AuditSignerJournalRecord> _records;
  private AuditSignerJournalState _state;

  public FileAuditSignerJournal(string path)
  {
    _path = Path.GetFullPath(path);
    Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
    var loaded = LoadAndVerify(_path);
    _records = loaded.Records;
    _state = loaded.State;
    if (File.Exists(_path) && new FileInfo(_path).Length != loaded.ValidLength)
    {
      using var stream = new FileStream(
        _path,
        FileMode.Open,
        FileAccess.Write,
        FileShare.Read,
        4096,
        FileOptions.WriteThrough);
      stream.SetLength(loaded.ValidLength);
      stream.Flush(flushToDisk: true);
    }
  }

  public AuditSignerJournalState State
  {
    get
    {
      lock (_gate) return _state;
    }
  }

  public Task AppendSignedAsync(
    SignedAuditCheckpoint checkpoint,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    lock (_gate)
    {
      if (_state.Pending is not null)
        throw new InvalidOperationException("A prior signed checkpoint is still awaiting broker receipt.");
      var manifest = checkpoint.Manifest;
      if (!string.Equals(
            manifest.PreviousCheckpointSha256,
            _state.AcceptedHead.ManifestSha256,
            StringComparison.Ordinal) ||
          !string.Equals(
            manifest.PreviousEventHash,
            _state.AcceptedHead.EventHash,
            StringComparison.Ordinal) ||
          AuditSignerProtocol.ParseCursor(manifest.ToCursor, allowZero: false) <=
          AuditSignerProtocol.ParseCursor(_state.AcceptedHead.Cursor, allowZero: true))
        throw new InvalidDataException("Signed checkpoint attempts a local rollback or fork.");
      var record = Append(
        "SIGNED",
        manifest.CheckpointId,
        checkpoint.ManifestSha256,
        manifest.ToCursor,
        manifest.EventHeadHash,
        manifest.PreviousCheckpointSha256,
        manifest.PreviousEventHash,
        checkpoint.ManifestJson,
        checkpoint.Signature);
      _state = Apply(_state, record);
      return Task.CompletedTask;
    }
  }

  public Task AppendAcceptedAsync(string manifestSha256, CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    lock (_gate)
    {
      var pending = _state.Pending
        ?? throw new InvalidOperationException("No signed checkpoint is awaiting acceptance.");
      if (!string.Equals(pending.Checkpoint.ManifestSha256, manifestSha256, StringComparison.Ordinal))
        throw new InvalidDataException("Broker receipt does not match the pending checkpoint.");
      var manifest = pending.Checkpoint.Manifest;
      var record = Append(
        "ACCEPTED",
        manifest.CheckpointId,
        manifestSha256,
        manifest.ToCursor,
        manifest.EventHeadHash,
        manifest.PreviousCheckpointSha256,
        manifest.PreviousEventHash,
        null,
        null);
      _state = Apply(_state, record);
      return Task.CompletedTask;
    }
  }

  private AuditSignerJournalRecord Append(
    string kind,
    string checkpointId,
    string manifestSha256,
    string cursor,
    string eventHash,
    string previousCheckpointSha256,
    string previousEventHash,
    string? manifestJson,
    string? signature)
  {
    var sequence = _records.Count == 0 ? 1 : _records[^1].Sequence + 1;
    var previous = _records.Count == 0
      ? AuditSignerProtocol.ZeroSha256
      : _records[^1].JournalHash;
    var occurredAt = DateTimeOffset.UtcNow;
    var hash = HashRecord(
      sequence,
      previous,
      kind,
      checkpointId,
      manifestSha256,
      cursor,
      eventHash,
      previousCheckpointSha256,
      previousEventHash,
      manifestJson,
      signature,
      occurredAt);
    var record = new AuditSignerJournalRecord(
      sequence,
      previous,
      hash,
      kind,
      checkpointId,
      manifestSha256,
      cursor,
      eventHash,
      previousCheckpointSha256,
      previousEventHash,
      manifestJson,
      signature,
      occurredAt);
    using var stream = new FileStream(
      _path,
      FileMode.Append,
      FileAccess.Write,
      FileShare.Read,
      4096,
      FileOptions.WriteThrough);
    using var writer = new StreamWriter(stream, new UTF8Encoding(false), leaveOpen: true);
    writer.WriteLine(JsonSerializer.Serialize(record));
    writer.Flush();
    stream.Flush(flushToDisk: true);
    _records.Add(record);
    return record;
  }

  private static JournalLoad LoadAndVerify(string path)
  {
    if (!File.Exists(path)) return new JournalLoad([], AuditSignerJournalStateFrom([]), 0);
    var records = new List<AuditSignerJournalRecord>();
    var bytes = File.ReadAllBytes(path);
    var start = 0;
    var validLength = 0;
    for (var index = 0; index < bytes.Length; index++)
    {
      if (bytes[index] != (byte)'\n') continue;
      var length = index - start;
      if (length > 0 && bytes[index - 1] == (byte)'\r') length--;
      var line = Encoding.UTF8.GetString(bytes, start, length);
      start = index + 1;
      validLength = start;
      if (string.IsNullOrWhiteSpace(line)) continue;
      var record = JsonSerializer.Deserialize<AuditSignerJournalRecord>(line)
        ?? throw new InvalidDataException("Audit signer journal contains an empty record.");
      var expectedSequence = records.Count == 0 ? 1 : records[^1].Sequence + 1;
      var expectedPrevious = records.Count == 0
        ? AuditSignerProtocol.ZeroSha256
        : records[^1].JournalHash;
      var expectedHash = HashRecord(
        record.Sequence,
        record.PreviousJournalHash,
        record.Kind,
        record.CheckpointId,
        record.ManifestSha256,
        record.Cursor,
        record.EventHash,
        record.PreviousCheckpointSha256,
        record.PreviousEventHash,
        record.ManifestJson,
        record.Signature,
        record.OccurredAt);
      if (record.Sequence != expectedSequence ||
          !string.Equals(record.PreviousJournalHash, expectedPrevious, StringComparison.Ordinal) ||
          !string.Equals(record.JournalHash, expectedHash, StringComparison.Ordinal))
        throw new InvalidDataException("Audit signer journal hash chain is invalid.");
      records.Add(record);
    }
    return new JournalLoad(records, AuditSignerJournalStateFrom(records), validLength);
  }

  private static AuditSignerJournalState AuditSignerJournalStateFrom(
    IReadOnlyList<AuditSignerJournalRecord> records)
  {
    var state = new AuditSignerJournalState(AuditSignerHead.Genesis, null);
    foreach (var record in records) state = Apply(state, record);
    return state;
  }

  private static AuditSignerJournalState Apply(
    AuditSignerJournalState state,
    AuditSignerJournalRecord record)
  {
    if (record.Kind == "SIGNED")
    {
      if (state.Pending is not null ||
          record.ManifestJson is null ||
          record.Signature is null ||
          !AuditSignerProtocol.IsSha256(record.ManifestSha256) ||
          !AuditSignerProtocol.IsSha256(record.EventHash) ||
          !string.Equals(
            record.PreviousCheckpointSha256,
            state.AcceptedHead.ManifestSha256,
            StringComparison.Ordinal) ||
          !string.Equals(
            record.PreviousEventHash,
            state.AcceptedHead.EventHash,
            StringComparison.Ordinal) ||
          !string.Equals(
            AuditSignerProtocol.Sha256(Encoding.UTF8.GetBytes(record.ManifestJson)),
            record.ManifestSha256,
            StringComparison.Ordinal))
        throw new InvalidDataException("Audit signer journal contains a forked signed record.");
      var manifest = JsonSerializer.Deserialize<AuditCheckpointManifest>(
        record.ManifestJson,
        WebJson)
        ?? throw new InvalidDataException("Signed checkpoint manifest is missing.");
      if (!string.Equals(AuditSignerProtocol.CanonicalManifestJson(manifest), record.ManifestJson,
            StringComparison.Ordinal) ||
          !string.Equals(manifest.CheckpointId, record.CheckpointId, StringComparison.Ordinal) ||
          !string.Equals(manifest.ToCursor, record.Cursor, StringComparison.Ordinal) ||
          !string.Equals(manifest.EventHeadHash, record.EventHash, StringComparison.Ordinal) ||
          !string.Equals(manifest.PreviousCheckpointSha256, record.PreviousCheckpointSha256,
            StringComparison.Ordinal) ||
          !string.Equals(manifest.PreviousEventHash, record.PreviousEventHash,
            StringComparison.Ordinal))
        throw new InvalidDataException("Signed checkpoint journal record conflicts with its manifest.");
      var checkpoint = new SignedAuditCheckpoint(
        manifest,
        record.ManifestJson,
        record.ManifestSha256,
        record.Signature);
      return state with
      {
        Pending = new PendingAuditCheckpoint(
          checkpoint,
          new AuditSignerHead(record.Cursor, record.EventHash, record.ManifestSha256)),
      };
    }
    if (record.Kind != "ACCEPTED" ||
        record.ManifestJson is not null ||
        record.Signature is not null ||
        state.Pending is null ||
        !string.Equals(state.Pending.Checkpoint.ManifestSha256, record.ManifestSha256,
          StringComparison.Ordinal) ||
        !string.Equals(state.Pending.NewHead.Cursor, record.Cursor, StringComparison.Ordinal) ||
        !string.Equals(state.Pending.NewHead.EventHash, record.EventHash, StringComparison.Ordinal))
      throw new InvalidDataException("Audit signer journal contains an invalid acceptance record.");
    return new AuditSignerJournalState(state.Pending.NewHead, null);
  }

  private static string HashRecord(
    long sequence,
    string previousJournalHash,
    string kind,
    string checkpointId,
    string manifestSha256,
    string cursor,
    string eventHash,
    string previousCheckpointSha256,
    string previousEventHash,
    string? manifestJson,
    string? signature,
    DateTimeOffset occurredAt)
  {
    var material = JsonSerializer.Serialize(new
    {
      sequence,
      previousJournalHash,
      kind,
      checkpointId,
      manifestSha256,
      cursor,
      eventHash,
      previousCheckpointSha256,
      previousEventHash,
      manifestJson,
      signature,
      occurredAt,
    });
    return AuditSignerProtocol.Sha256(Encoding.UTF8.GetBytes(material));
  }

  private sealed record JournalLoad(
    List<AuditSignerJournalRecord> Records,
    AuditSignerJournalState State,
    int ValidLength);
}
