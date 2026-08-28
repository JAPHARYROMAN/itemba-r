using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Itemba.Msaidizi.RecoverySupervisor.Journal;

public sealed record RecoveryJournalEntry(
  long Sequence,
  string PreviousHash,
  string Hash,
  string RecoveryId,
  string ManifestSha256,
  string Phase,
  DateTimeOffset OccurredAt,
  IReadOnlyDictionary<string, string?> Data);

public interface IRecoveryJournal
{
  string Head { get; }
  Task<RecoveryJournalEntry> AppendAsync(
    string recoveryId,
    string manifestSha256,
    string phase,
    IReadOnlyDictionary<string, string?> data,
    CancellationToken cancellationToken);
}

public sealed class FileRecoveryJournal : IRecoveryJournal
{
  private readonly string _path;
  private readonly object _gate = new();
  private readonly List<RecoveryJournalEntry> _entries;

  public FileRecoveryJournal(string path)
  {
    _path = Path.GetFullPath(path);
    Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
    var loaded = LoadAndVerify(_path);
    _entries = loaded.Entries;
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

  public string Head
  {
    get { lock (_gate) return _entries.LastOrDefault()?.Hash ?? new string('0', 64); }
  }

  public Task<RecoveryJournalEntry> AppendAsync(
    string recoveryId,
    string manifestSha256,
    string phase,
    IReadOnlyDictionary<string, string?> data,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    lock (_gate)
    {
      var sequence = _entries.Count == 0 ? 1 : _entries[^1].Sequence + 1;
      var previous = _entries.Count == 0 ? new string('0', 64) : _entries[^1].Hash;
      var occurredAt = DateTimeOffset.UtcNow;
      var material = Material(sequence, previous, recoveryId, manifestSha256, phase, occurredAt, data);
      var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(material)))
        .ToLowerInvariant();
      var entry = new RecoveryJournalEntry(
        sequence,
        previous,
        hash,
        recoveryId,
        manifestSha256,
        phase,
        occurredAt,
        data);
      using var stream = new FileStream(
        _path,
        FileMode.Append,
        FileAccess.Write,
        FileShare.Read,
        4096,
        FileOptions.WriteThrough);
      using var writer = new StreamWriter(stream, new UTF8Encoding(false), leaveOpen: true);
      writer.WriteLine(JsonSerializer.Serialize(entry));
      writer.Flush();
      stream.Flush(flushToDisk: true);
      _entries.Add(entry);
      return Task.FromResult(entry);
    }
  }

  private static JournalLoad LoadAndVerify(string path)
  {
    if (!File.Exists(path)) return new JournalLoad([], 0);
    var entries = new List<RecoveryJournalEntry>();
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
      var entry = JsonSerializer.Deserialize<RecoveryJournalEntry>(line)
        ?? throw new InvalidDataException("The recovery journal contains an empty record.");
      var expectedSequence = entries.Count == 0 ? 1 : entries[^1].Sequence + 1;
      var expectedPrevious = entries.Count == 0 ? new string('0', 64) : entries[^1].Hash;
      var expectedHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        Material(
          entry.Sequence,
          entry.PreviousHash,
          entry.RecoveryId,
          entry.ManifestSha256,
          entry.Phase,
          entry.OccurredAt,
          entry.Data)))).ToLowerInvariant();
      if (entry.Sequence != expectedSequence ||
          !string.Equals(entry.PreviousHash, expectedPrevious, StringComparison.Ordinal) ||
          !string.Equals(entry.Hash, expectedHash, StringComparison.Ordinal))
        throw new InvalidDataException("The recovery journal hash chain is invalid.");
      entries.Add(entry);
    }
    return new JournalLoad(entries, validLength);
  }

  private static string Material(
    long sequence,
    string previous,
    string recoveryId,
    string manifestSha256,
    string phase,
    DateTimeOffset occurredAt,
    IReadOnlyDictionary<string, string?> data) => JsonSerializer.Serialize(new
    {
      sequence,
      previousHash = previous,
      recoveryId,
      manifestSha256,
      phase,
      occurredAt,
      data = data.OrderBy(pair => pair.Key)
        .ToDictionary(pair => pair.Key, pair => pair.Value),
    });

  private sealed record JournalLoad(List<RecoveryJournalEntry> Entries, int ValidLength);
}
