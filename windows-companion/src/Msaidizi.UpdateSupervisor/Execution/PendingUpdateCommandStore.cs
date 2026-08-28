using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.UpdateSupervisor.Contracts;

namespace Itemba.Msaidizi.UpdateSupervisor.Execution;

public sealed record PendingCommandAdoption(
  bool Adopted,
  string? SupersededManifestSha256);

public interface IPendingUpdateCommandStore
{
  PendingCommandAdoption Put(
    SignedUpdateCommand command,
    TrustedUpdateManifest verifiedManifest);
  IReadOnlyList<SignedUpdateCommand> ReadAll();
  void RemoveDeployment(string deploymentId);
}

/// <summary>
/// Retains the exact verified command across an ACK-response loss or service
/// restart. A later lease may replace it only when the stable idempotency key
/// and every immutable action claim remain identical.
/// </summary>
public sealed class FilePendingUpdateCommandStore : IPendingUpdateCommandStore
{
  private readonly string _root;
  private readonly object _gate = new();

  public FilePendingUpdateCommandStore(string root)
  {
    _root = Path.GetFullPath(root);
    Directory.CreateDirectory(_root);
    if (new DirectoryInfo(_root).Attributes.HasFlag(FileAttributes.ReparsePoint))
      throw new UnauthorizedAccessException(
        "The pending update-command store may not be a reparse point.");
  }

  public PendingCommandAdoption Put(
    SignedUpdateCommand command,
    TrustedUpdateManifest verifiedManifest)
  {
    var actionClaimsSha256 = UpdateActionIdentity.Compute(verifiedManifest);
    var path = Path.Combine(_root, verifiedManifest.IdempotencyKey + ".json");
    var replacement = new StoredPendingUpdateCommand(
      verifiedManifest.IdempotencyKey,
      actionClaimsSha256,
      verifiedManifest.DeliveryAttempt,
      command);
    lock (_gate)
    {
      if (File.Exists(path))
      {
        var current = Read(path);
        if (!string.Equals(current.ActionClaimsSha256, actionClaimsSha256,
              StringComparison.Ordinal) ||
            !string.Equals(current.IdempotencyKey, verifiedManifest.IdempotencyKey,
              StringComparison.Ordinal))
          throw new InvalidDataException(
            "A pending idempotency key was reused with different immutable action claims.");
        if (current.DeliveryAttempt > verifiedManifest.DeliveryAttempt)
          return new PendingCommandAdoption(false, null);
        if (current.DeliveryAttempt == verifiedManifest.DeliveryAttempt)
        {
          if (!string.Equals(JsonSerializer.Serialize(current.Command),
                JsonSerializer.Serialize(command), StringComparison.Ordinal))
            throw new InvalidDataException(
              "A delivery attempt was replayed with different signed command bytes.");
          return new PendingCommandAdoption(false, null);
        }
        ReplaceAtomically(path, JsonSerializer.Serialize(replacement));
        return new PendingCommandAdoption(true, current.Command.ManifestSha256);
      }
      WriteAtomically(path, JsonSerializer.Serialize(replacement));
      return new PendingCommandAdoption(true, null);
    }
  }

  public IReadOnlyList<SignedUpdateCommand> ReadAll()
  {
    lock (_gate)
      return Directory.EnumerateFiles(_root, "*.json")
        .OrderBy(path => path, StringComparer.Ordinal)
        .Select(path => Read(path).Command)
        .ToArray();
  }

  public void RemoveDeployment(string deploymentId)
  {
    lock (_gate)
      foreach (var path in Directory.EnumerateFiles(_root, "*.json"))
        if (string.Equals(Read(path).Command.DeploymentId, deploymentId,
              StringComparison.Ordinal))
          File.Delete(path);
  }

  private static StoredPendingUpdateCommand Read(string path) =>
    JsonSerializer.Deserialize<StoredPendingUpdateCommand>(File.ReadAllText(path))
    ?? throw new InvalidDataException("The pending update-command store is corrupt.");

  private static void WriteAtomically(string path, string value)
  {
    var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
    WriteThrough(temporary, value);
    File.Move(temporary, path, overwrite: false);
  }

  private static void ReplaceAtomically(string path, string value)
  {
    var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
    WriteThrough(temporary, value);
    File.Move(temporary, path, overwrite: true);
  }

  private static void WriteThrough(string path, string value)
  {
    using var stream = new FileStream(
      path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096,
      FileOptions.WriteThrough);
    var bytes = Encoding.UTF8.GetBytes(value);
    stream.Write(bytes);
    stream.Flush(flushToDisk: true);
  }

  private sealed record StoredPendingUpdateCommand(
    string IdempotencyKey,
    string ActionClaimsSha256,
    int DeliveryAttempt,
    SignedUpdateCommand Command);
}

public static class UpdateActionIdentity
{
  public static string Compute(TrustedUpdateManifest manifest)
  {
    var material = JsonSerializer.Serialize(new
    {
      manifest.SchemaVersion,
      manifest.DeploymentId,
      manifest.CandidateId,
      manifest.DeviceId,
      manifest.Operation,
      manifest.Ring,
      manifest.TargetId,
      manifest.Version,
      manifest.SourceArtifactSha256,
      manifest.RollbackArtifactSha256,
      manifest.RollbackVersion,
      manifest.HealthTimeoutSeconds,
      manifest.MinimumHealthySoakSeconds,
      manifest.MinimumRingDwellSeconds,
      manifest.IdempotencyKey,
    });
    return Convert.ToHexString(
      SHA256.HashData(Encoding.UTF8.GetBytes(material))).ToLowerInvariant();
  }
}
