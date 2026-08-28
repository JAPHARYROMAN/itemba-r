using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Itemba.Msaidizi.UpdateSupervisor.Journal;

public sealed record UpdateJournalEntry(
  long Sequence,
  string PreviousHash,
  string Hash,
  string DeploymentId,
  string ManifestSha256,
  string Phase,
  DateTimeOffset OccurredAt,
  IReadOnlyDictionary<string, string?> Data);

public interface IUpdateJournal
{
  string Head { get; }
  Task<UpdateJournalEntry> AppendAsync(
    string deploymentId,
    string manifestSha256,
    string phase,
    IReadOnlyDictionary<string, string?> data,
    CancellationToken cancellationToken);
  IReadOnlyDictionary<string, UpdateJournalEntry> LatestByDeployment();
}

public sealed class FileUpdateJournal : IUpdateJournal
{
  private readonly string _path;
  private readonly object _gate = new();
  private List<UpdateJournalEntry> _entries;

  public FileUpdateJournal(string path)
  {
    _path = Path.GetFullPath(path);
    Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
    var loaded = LoadAndVerify(_path);
    _entries = loaded.Entries;
    if (File.Exists(_path) && new FileInfo(_path).Length != loaded.ValidLength)
    {
      using var stream = new FileStream(
        _path, FileMode.Open, FileAccess.Write, FileShare.Read, 4096, FileOptions.WriteThrough);
      stream.SetLength(loaded.ValidLength);
      stream.Flush(flushToDisk: true);
    }
  }

  public string Head
  {
    get { lock (_gate) return _entries.LastOrDefault()?.Hash ?? new string('0', 64); }
  }

  public Task<UpdateJournalEntry> AppendAsync(
    string deploymentId,
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
      var material = JsonSerializer.Serialize(new
      {
        sequence,
        previousHash = previous,
        deploymentId,
        manifestSha256,
        phase,
        occurredAt,
        data = data.OrderBy(pair => pair.Key).ToDictionary(pair => pair.Key, pair => pair.Value),
      });
      var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(material))).ToLowerInvariant();
      var entry = new UpdateJournalEntry(
        sequence, previous, hash, deploymentId, manifestSha256, phase, occurredAt, data);
      using var stream = new FileStream(
        _path, FileMode.Append, FileAccess.Write, FileShare.Read, 4096, FileOptions.WriteThrough);
      using var writer = new StreamWriter(stream, new UTF8Encoding(false), leaveOpen: true);
      writer.WriteLine(JsonSerializer.Serialize(entry));
      writer.Flush();
      stream.Flush(flushToDisk: true);
      _entries.Add(entry);
      return Task.FromResult(entry);
    }
  }

  public IReadOnlyDictionary<string, UpdateJournalEntry> LatestByDeployment()
  {
    lock (_gate)
      return _entries.GroupBy(entry => entry.DeploymentId, StringComparer.Ordinal)
        .ToDictionary(group => group.Key, group => group.Last(), StringComparer.Ordinal);
  }

  private static JournalLoad LoadAndVerify(string path)
  {
    if (!File.Exists(path)) return new JournalLoad([], 0);
    var entries = new List<UpdateJournalEntry>();
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
      var entry = JsonSerializer.Deserialize<UpdateJournalEntry>(line)
        ?? throw new InvalidDataException("The update journal contains an empty record.");
      var expectedSequence = entries.Count == 0 ? 1 : entries[^1].Sequence + 1;
      var expectedPrevious = entries.Count == 0 ? new string('0', 64) : entries[^1].Hash;
      var material = JsonSerializer.Serialize(new
      {
        sequence = entry.Sequence,
        previousHash = entry.PreviousHash,
        deploymentId = entry.DeploymentId,
        manifestSha256 = entry.ManifestSha256,
        phase = entry.Phase,
        occurredAt = entry.OccurredAt,
        data = entry.Data.OrderBy(pair => pair.Key).ToDictionary(pair => pair.Key, pair => pair.Value),
      });
      var expectedHash = Convert.ToHexString(
        SHA256.HashData(Encoding.UTF8.GetBytes(material))).ToLowerInvariant();
      if (entry.Sequence != expectedSequence ||
          !string.Equals(entry.PreviousHash, expectedPrevious, StringComparison.Ordinal) ||
          !string.Equals(entry.Hash, expectedHash, StringComparison.Ordinal))
        throw new InvalidDataException("The update journal hash chain is invalid.");
      entries.Add(entry);
    }
    // Bytes after the last newline are an interrupted, never-committed append.
    // The preceding PREPARED entry still contains enough data to roll back a
    // pointer swap that happened just before the crash.
    return new JournalLoad(entries, validLength);
  }

  private sealed record JournalLoad(List<UpdateJournalEntry> Entries, long ValidLength);
}
