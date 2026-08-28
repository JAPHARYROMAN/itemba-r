using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.UpdateSupervisor.Contracts;

namespace Itemba.Msaidizi.UpdateSupervisor.Execution;

public interface IUpdateResultStore
{
  UpdateExecutionResult? Find(
    string deploymentId,
    string idempotencyKey,
    string actionClaimsSha256);
  void Put(
    string idempotencyKey,
    string actionClaimsSha256,
    UpdateExecutionResult result);
}

public sealed class FileUpdateResultStore : IUpdateResultStore
{
  private readonly string _root;

  public FileUpdateResultStore(string root)
  {
    _root = Path.GetFullPath(root);
    Directory.CreateDirectory(_root);
  }

  public UpdateExecutionResult? Find(
    string deploymentId,
    string idempotencyKey,
    string actionClaimsSha256)
  {
    var path = ResultPath(deploymentId);
    if (!File.Exists(path)) return null;
    var stored = JsonSerializer.Deserialize<StoredUpdateResult>(File.ReadAllText(path))
      ?? throw new InvalidDataException("The update result cache is corrupt.");
    if (!string.Equals(stored.IdempotencyKey, idempotencyKey, StringComparison.Ordinal) ||
        !string.Equals(stored.ActionClaimsSha256, actionClaimsSha256, StringComparison.Ordinal))
      throw new InvalidDataException(
        "A deployment or idempotency key was replayed with different immutable action claims.");
    return stored.Result;
  }

  public void Put(
    string idempotencyKey,
    string actionClaimsSha256,
    UpdateExecutionResult result)
  {
    var existing = Find(result.DeploymentId, idempotencyKey, actionClaimsSha256);
    if (existing is not null)
    {
      if (!string.Equals(JsonSerializer.Serialize(existing), JsonSerializer.Serialize(result), StringComparison.Ordinal))
        throw new InvalidDataException("A deployment result is immutable.");
      return;
    }
    var path = ResultPath(result.DeploymentId);
    var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
    using (var stream = new FileStream(
      temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
    {
      var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(
        new StoredUpdateResult(idempotencyKey, actionClaimsSha256, result)));
      stream.Write(bytes);
      stream.Flush(flushToDisk: true);
    }
    File.Move(temporary, path, overwrite: false);
  }

  private string ResultPath(string deploymentId)
  {
    if (!Guid.TryParse(deploymentId, out var id)) throw new InvalidDataException("Invalid deployment ID.");
    return Path.Combine(_root, id.ToString("D") + ".json");
  }

  private sealed record StoredUpdateResult(
    string IdempotencyKey,
    string ActionClaimsSha256,
    UpdateExecutionResult Result);
}
