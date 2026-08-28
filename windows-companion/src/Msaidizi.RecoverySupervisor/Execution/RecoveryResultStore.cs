using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.RecoverySupervisor.Contracts;

namespace Itemba.Msaidizi.RecoverySupervisor.Execution;

public interface IRecoveryResultStore
{
  RecoveryExecutionResult? Find(string recoveryId, string manifestSha256);
  void Put(RecoveryExecutionResult result);
}

public sealed class FileRecoveryResultStore : IRecoveryResultStore
{
  private readonly string _root;

  public FileRecoveryResultStore(string root)
  {
    _root = Path.GetFullPath(root);
    Directory.CreateDirectory(_root);
  }

  public RecoveryExecutionResult? Find(string recoveryId, string manifestSha256)
  {
    var path = ResultPath(recoveryId);
    if (!File.Exists(path)) return null;
    var result = JsonSerializer.Deserialize<RecoveryExecutionResult>(File.ReadAllText(path))
      ?? throw new InvalidDataException("The recovery result cache is corrupt.");
    if (!string.Equals(result.ManifestSha256, manifestSha256, StringComparison.Ordinal))
      throw new InvalidDataException("A recovery ID was replayed with a different manifest.");
    return result;
  }

  public void Put(RecoveryExecutionResult result)
  {
    var existing = Find(result.RecoveryId, result.ManifestSha256);
    if (existing is not null)
    {
      if (!string.Equals(
            JsonSerializer.Serialize(existing),
            JsonSerializer.Serialize(result),
            StringComparison.Ordinal))
        throw new InvalidDataException("A recovery result is immutable.");
      return;
    }
    var path = ResultPath(result.RecoveryId);
    var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
    using (var stream = new FileStream(
      temporary,
      FileMode.CreateNew,
      FileAccess.Write,
      FileShare.None,
      4096,
      FileOptions.WriteThrough))
    {
      var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(result));
      stream.Write(bytes);
      stream.Flush(flushToDisk: true);
    }
    File.Move(temporary, path, overwrite: false);
  }

  private string ResultPath(string recoveryId)
  {
    if (!Guid.TryParse(recoveryId, out var id))
      throw new InvalidDataException("Invalid recovery ID.");
    return Path.Combine(_root, id.ToString("D") + ".json");
  }
}
