using Itemba.Msaidizi.UpdateSupervisor.Contracts;

namespace Itemba.Msaidizi.UpdateSupervisor.Execution;

public interface IUpdateArtifactProvider
{
  Task FetchAsync(
    TrustedUpdateManifest manifest,
    string role,
    string destination,
    CancellationToken cancellationToken);
}

public sealed class HttpUpdateArtifactProvider(HttpClient client) : IUpdateArtifactProvider
{
  public async Task FetchAsync(
    TrustedUpdateManifest manifest,
    string role,
    string destination,
    CancellationToken cancellationToken)
  {
    if (role is not ("source" or "rollback")) throw new ArgumentOutOfRangeException(nameof(role));
    using var response = await client.GetAsync(
      $"msaidizi/update-supervisor/channel/deployments/{Uri.EscapeDataString(manifest.DeploymentId)}/artifact?role={role}",
      HttpCompletionOption.ResponseHeadersRead,
      cancellationToken);
    response.EnsureSuccessStatusCode();
    await using var input = await response.Content.ReadAsStreamAsync(cancellationToken);
    await using var output = new FileStream(
      destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1024 * 64,
      FileOptions.Asynchronous | FileOptions.WriteThrough);
    await input.CopyToAsync(output, cancellationToken);
    await output.FlushAsync(cancellationToken);
    output.Flush(flushToDisk: true);
  }
}
