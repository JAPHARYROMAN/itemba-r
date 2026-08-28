using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Itemba.Msaidizi.UpdateSupervisor.Execution;

public sealed record UpdateOutboxRecord(
  string Id,
  string Kind,
  string PayloadJson,
  DateTimeOffset CreatedAt,
  string RecordSha256);

public interface IUpdateOutbox
{
  void Enqueue(string id, string kind, string payloadJson);
  bool Contains(string id);
  Task<bool> TryDrainAsync(
    Func<UpdateOutboxRecord, CancellationToken, Task> sender,
    CancellationToken cancellationToken);
  void DiscardDeliveryAttempt(string manifestSha256);
  int PendingCount { get; }
}

/// <summary>
/// Trusted-root store-and-forward boundary. A record is fsynced before it is
/// sent and is deleted only after a successful, idempotent broker response.
/// A crash after broker receipt therefore causes a safe duplicate send, never
/// a lost acknowledgement, progress transition, or terminal result.
/// </summary>
public sealed class FileUpdateOutbox : IUpdateOutbox, IDisposable
{
  private static readonly HashSet<string> Kinds = new(StringComparer.Ordinal)
  {
    "ACK", "PROGRESS", "RESULT",
  };

  private readonly string _root;
  private readonly SemaphoreSlim _gate = new(1, 1);

  public FileUpdateOutbox(string root)
  {
    _root = Path.GetFullPath(root);
    Directory.CreateDirectory(_root);
    if (new DirectoryInfo(_root).Attributes.HasFlag(FileAttributes.ReparsePoint))
      throw new UnauthorizedAccessException("The update outbox may not be a reparse point.");
  }

  public int PendingCount => Directory.EnumerateFiles(_root, "*.json").Count();

  public bool Contains(string id)
  {
    var identityHash = Sha256(id);
    return Directory.EnumerateFiles(_root, $"*-{identityHash}.json")
      .Select(Read)
      .Any(record => string.Equals(record.Id, id, StringComparison.Ordinal));
  }

  public void Enqueue(string id, string kind, string payloadJson)
  {
    if (string.IsNullOrWhiteSpace(id) || id.Length > 512 || !Kinds.Contains(kind) ||
        string.IsNullOrWhiteSpace(payloadJson))
      throw new InvalidDataException("The update outbox record is invalid.");
    var identityHash = Sha256(id);
    var existing = Directory.EnumerateFiles(_root, $"*-{identityHash}.json").SingleOrDefault();
    if (existing is not null)
    {
      var prior = Read(existing);
      if (!string.Equals(prior.Id, id, StringComparison.Ordinal) ||
          !string.Equals(prior.Kind, kind, StringComparison.Ordinal) ||
          !string.Equals(prior.PayloadJson, payloadJson, StringComparison.Ordinal))
        throw new InvalidDataException("An update outbox identity was reused with another payload.");
      return;
    }

    var createdAt = DateTimeOffset.UtcNow;
    var record = new UpdateOutboxRecord(
      id, kind, payloadJson, createdAt,
      RecordDigest(id, kind, payloadJson, createdAt));
    var fileName = $"{record.CreatedAt.UtcTicks:D19}-{Guid.NewGuid():N}-{identityHash}.json";
    WriteAtomically(Path.Combine(_root, fileName), JsonSerializer.Serialize(record));
  }

  public async Task<bool> TryDrainAsync(
    Func<UpdateOutboxRecord, CancellationToken, Task> sender,
    CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken);
    try
    {
      var allDelivered = true;
      foreach (var path in Directory.EnumerateFiles(_root, "*.json")
                 .OrderBy(value => value, StringComparer.Ordinal))
      {
        cancellationToken.ThrowIfCancellationRequested();
        var record = Read(path);
        try
        {
          await sender(record, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
          throw;
        }
        catch (Exception)
        {
          allDelivered = false;
          continue;
        }
        File.Delete(path);
      }
      return allDelivered;
    }
    finally
    {
      _gate.Release();
    }
  }

  public void DiscardDeliveryAttempt(string manifestSha256)
  {
    if (manifestSha256.Length != 64)
      throw new InvalidDataException("The superseded manifest digest is invalid.");
    foreach (var path in Directory.EnumerateFiles(_root, "*.json"))
    {
      var record = Read(path);
      if (record.Kind is not ("ACK" or "PROGRESS")) continue;
      var marker = ":" + manifestSha256;
      if (record.Id.EndsWith(marker, StringComparison.Ordinal) ||
          record.Id.Contains(marker + ":", StringComparison.Ordinal))
        File.Delete(path);
    }
  }

  private static UpdateOutboxRecord Read(string path)
  {
    var record = JsonSerializer.Deserialize<UpdateOutboxRecord>(File.ReadAllText(path))
      ?? throw new InvalidDataException("The update outbox contains an empty record.");
    var expected = RecordDigest(
      record.Id, record.Kind, record.PayloadJson, record.CreatedAt);
    if (record.RecordSha256.Length != 64 ||
        !CryptographicOperations.FixedTimeEquals(
          Convert.FromHexString(expected), Convert.FromHexString(record.RecordSha256)))
      throw new InvalidDataException("The update outbox record digest is invalid.");
    return record;
  }

  private static void WriteAtomically(string path, string value)
  {
    var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
    using (var stream = new FileStream(
      temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096,
      FileOptions.WriteThrough))
    {
      var bytes = Encoding.UTF8.GetBytes(value);
      stream.Write(bytes);
      stream.Flush(flushToDisk: true);
    }
    File.Move(temporary, path, overwrite: false);
  }

  private static string Sha256(string value) =>
    Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

  private static string RecordDigest(
    string id,
    string kind,
    string payloadJson,
    DateTimeOffset createdAt) => Sha256(
    id + "\0" + kind + "\0" + payloadJson + "\0" +
    createdAt.ToString("O", CultureInfo.InvariantCulture));

  public void Dispose() => _gate.Dispose();
}
