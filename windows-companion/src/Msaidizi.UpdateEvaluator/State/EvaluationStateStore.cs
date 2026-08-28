using System.Security.Cryptography;
using System.Text.Json;
using Itemba.Msaidizi.UpdateEvaluator.Contracts;
using Itemba.Msaidizi.UpdateEvaluator.Protocol;
using Itemba.Msaidizi.UpdateEvaluator.Security;

namespace Itemba.Msaidizi.UpdateEvaluator.State;

public interface IEvaluationStateStore
{
  IReadOnlyList<EvaluationCheckpoint> ReadPending();
  EvaluationCheckpoint? Read(string runId);
  void Put(EvaluationCheckpoint checkpoint);
  void Complete(string runId, string terminalStatus);
}

public sealed class FileEvaluationStateStore : IEvaluationStateStore
{
  private readonly string _root;
  private readonly IStateProtector _protector;
  private readonly object _gate = new();

  public FileEvaluationStateStore(string root, IStateProtector protector)
  {
    _root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
    if (!Directory.Exists(_root))
      throw new InvalidOperationException(
        "The evaluator state root must be pre-created with its service-only ACL.");
    _protector = protector;
  }

  public IReadOnlyList<EvaluationCheckpoint> ReadPending()
  {
    lock (_gate)
      return Directory.EnumerateFiles(_root, "*.state", SearchOption.TopDirectoryOnly)
        .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
        .Select(ReadFile)
        .Where(checkpoint => checkpoint.TerminalStatus is null)
        .ToArray();
  }

  public EvaluationCheckpoint? Read(string runId)
  {
    var path = StatePath(runId);
    lock (_gate) return File.Exists(path) ? ReadFile(path) : null;
  }

  public void Put(EvaluationCheckpoint checkpoint)
  {
    if (!Guid.TryParseExact(checkpoint.Lease.Id, "D", out _))
      throw new InvalidDataException("Evaluator checkpoint run id is invalid.");
    var plaintext = JsonSerializer.SerializeToUtf8Bytes(checkpoint, JsonDefaults.Options);
    try
    {
      var protectedBytes = _protector.Protect(plaintext);
      try
      {
        lock (_gate) AtomicWrite(StatePath(checkpoint.Lease.Id), protectedBytes);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(protectedBytes);
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(plaintext);
    }
  }

  public void Complete(string runId, string terminalStatus)
  {
    var current = Read(runId) ?? throw new InvalidDataException("Evaluator checkpoint is missing.");
    Put(current with { Stage = "COMPLETED", TerminalStatus = terminalStatus });
  }

  private EvaluationCheckpoint ReadFile(string path)
  {
    var ciphertext = File.ReadAllBytes(path);
    try
    {
      var plaintext = _protector.Unprotect(ciphertext);
      try
      {
        return JsonSerializer.Deserialize<EvaluationCheckpoint>(plaintext, JsonDefaults.Options)
          ?? throw new InvalidDataException("Evaluator checkpoint is empty.");
      }
      finally
      {
        CryptographicOperations.ZeroMemory(plaintext);
      }
    }
    catch (JsonException exception)
    {
      throw new InvalidDataException("Evaluator checkpoint is invalid.", exception);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(ciphertext);
    }
  }

  private string StatePath(string runId)
  {
    if (!Guid.TryParseExact(runId, "D", out _))
      throw new InvalidDataException("Evaluator run id is invalid.");
    var path = Path.GetFullPath(Path.Combine(_root, $"{runId.ToLowerInvariant()}.state"));
    if (!path.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
      throw new InvalidDataException("Evaluator state path escaped its root.");
    return path;
  }

  private static void AtomicWrite(string destination, byte[] value)
  {
    var temporary = destination + "." + Guid.NewGuid().ToString("N") + ".tmp";
    try
    {
      using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write,
        FileShare.None, 4096, FileOptions.WriteThrough))
      {
        stream.Write(value);
        stream.Flush(flushToDisk: true);
      }
      File.Move(temporary, destination, overwrite: true);
    }
    finally
    {
      File.Delete(temporary);
    }
  }
}
