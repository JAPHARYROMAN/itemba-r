using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.UpdateEvaluator.Configuration;
using Itemba.Msaidizi.UpdateEvaluator.Contracts;
using Itemba.Msaidizi.UpdateEvaluator.Protocol;

namespace Itemba.Msaidizi.UpdateEvaluator.Evaluation;

public interface IEvaluationVmProvider
{
  Task<VmEvaluationSession> PrepareAsync(
    EvaluationLease lease,
    CancellationToken cancellationToken);
  Task<MaterializationEvidence> MaterializeAsync(
    VmEvaluationSession session,
    GeneratedUpdateManifest manifest,
    ReadOnlyMemory<byte> canonicalManifest,
    CancellationToken cancellationToken);
  Task<CheckExecutionEvidence> RunCheckAsync(
    VmEvaluationSession session,
    EvaluationCommandOptions command,
    CancellationToken cancellationToken);
  Task<ExportedWorkspace> ExportAsync(
    VmEvaluationSession session,
    string purpose,
    CancellationToken cancellationToken);
  Task CleanupAsync(VmEvaluationSession session, CancellationToken cancellationToken);
}

public sealed class HyperVPowerShellEvaluationProvider(
  UpdateEvaluatorOptions evaluatorOptions) : IEvaluationVmProvider
{
  private readonly HyperVEvaluationOptions _options = evaluatorOptions.HyperV;
  private readonly string _transferRoot =
    Path.TrimEndingDirectorySeparator(Path.GetFullPath(evaluatorOptions.TransferPath));

  public Task<VmEvaluationSession> PrepareAsync(
    EvaluationLease lease,
    CancellationToken cancellationToken) =>
    InvokeAsync<VmEvaluationSession>(new
    {
      action = "PREPARE",
      runId = lease.Id,
      vmName = _options.VmName,
      snapshotName = _options.CleanSnapshotName,
      cleanSnapshotId = _options.CleanSnapshotId,
      guestCredentialPath = _options.GuestCredentialPath,
      guestRepositoryPath = _options.GuestRepositoryPath,
      guestWorkspaceRoot = _options.GuestWorkspaceRoot,
      readyTimeoutSeconds = _options.VmReadyTimeoutSeconds,
    }, cancellationToken);

  public Task<MaterializationEvidence> MaterializeAsync(
    VmEvaluationSession session,
    GeneratedUpdateManifest manifest,
    ReadOnlyMemory<byte> canonicalManifest,
    CancellationToken cancellationToken) =>
    WithManifestAsync(session.RunId, canonicalManifest,
      manifestPath => InvokeAsync<MaterializationEvidence>(new
      {
        action = "MATERIALIZE",
        runId = session.RunId,
        vmName = _options.VmName,
        guestCredentialPath = _options.GuestCredentialPath,
        guestWorkspaceRoot = _options.GuestWorkspaceRoot,
        manifestPath,
      }, cancellationToken));

  public Task<CheckExecutionEvidence> RunCheckAsync(
    VmEvaluationSession session,
    EvaluationCommandOptions command,
    CancellationToken cancellationToken) =>
    InvokeAsync<CheckExecutionEvidence>(new
    {
      action = "RUN",
      runId = session.RunId,
      vmName = _options.VmName,
      guestCredentialPath = _options.GuestCredentialPath,
      guestWorkspaceRoot = _options.GuestWorkspaceRoot,
      check = command.Check,
      fileName = command.FileName,
      arguments = command.Arguments,
      workingDirectory = command.WorkingDirectory,
      timeoutSeconds = command.TimeoutSeconds,
    }, cancellationToken);

  public async Task<ExportedWorkspace> ExportAsync(
    VmEvaluationSession session,
    string purpose,
    CancellationToken cancellationToken)
  {
    if (purpose is not ("SOURCE" or "ROLLBACK"))
      throw new ArgumentOutOfRangeException(nameof(purpose));
    var destination = OwnedRunPath(session.RunId,
      purpose == "SOURCE" ? "source-tree" : "rollback-tree");
    if (Directory.Exists(destination)) Directory.Delete(destination, recursive: true);
    Directory.CreateDirectory(destination);
    var result = await InvokeAsync<ExportedWorkspace>(new
    {
      action = "EXPORT",
      runId = session.RunId,
      vmName = _options.VmName,
      guestCredentialPath = _options.GuestCredentialPath,
      guestWorkspaceRoot = _options.GuestWorkspaceRoot,
      purpose,
      destination,
    }, cancellationToken).ConfigureAwait(false);
    var actual = Path.TrimEndingDirectorySeparator(Path.GetFullPath(result.DirectoryPath));
    if (!string.Equals(actual, Path.TrimEndingDirectorySeparator(destination),
          StringComparison.OrdinalIgnoreCase))
      throw new InvalidDataException("Hyper-V evaluator returned an unowned export path.");
    WorkspaceExportGuard.AssertRegularTree(actual);
    return result with { DirectoryPath = actual };
  }

  public Task CleanupAsync(VmEvaluationSession session, CancellationToken cancellationToken) =>
    InvokeAsync<JsonElement>(new
    {
      action = "CLEANUP",
      runId = session.RunId,
      vmName = _options.VmName,
      snapshotName = _options.CleanSnapshotName,
      guestCredentialPath = _options.GuestCredentialPath,
      guestWorkspaceRoot = _options.GuestWorkspaceRoot,
    }, cancellationToken);

  private async Task<T> WithManifestAsync<T>(
    string runId,
    ReadOnlyMemory<byte> content,
    Func<string, Task<T>> action)
  {
    var path = OwnedRunPath(runId, "generation-manifest.json");
    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    await File.WriteAllBytesAsync(path, content.ToArray()).ConfigureAwait(false);
    try
    {
      return await action(path).ConfigureAwait(false);
    }
    finally
    {
      File.Delete(path);
    }
  }

  private async Task<T> InvokeAsync<T>(object request, CancellationToken cancellationToken)
  {
    AssertProviderScript();
    var operationId = Guid.NewGuid().ToString("N");
    var operationRoot = Path.Combine(_transferRoot, "operations");
    Directory.CreateDirectory(operationRoot);
    var inputPath = Path.Combine(operationRoot, operationId + ".request.json");
    var outputPath = Path.Combine(operationRoot, operationId + ".response.json");
    var input = JsonSerializer.SerializeToUtf8Bytes(request, JsonDefaults.Options);
    await File.WriteAllBytesAsync(inputPath, input, cancellationToken).ConfigureAwait(false);
    CryptographicOperations.ZeroMemory(input);
    try
    {
      var start = new ProcessStartInfo
      {
        FileName = _options.PowerShellExecutablePath,
        UseShellExecute = false,
        CreateNoWindow = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        WorkingDirectory = _transferRoot,
      };
      foreach (var argument in new[]
      {
        "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "AllSigned",
        "-File", _options.ProviderScriptPath,
        "-RequestPath", inputPath,
        "-ResponsePath", outputPath,
      }) start.ArgumentList.Add(argument);
      using var process = new Process { StartInfo = start, EnableRaisingEvents = true };
      if (!process.Start()) throw new InvalidOperationException("Hyper-V evaluator did not start.");
      var stdout = ReadBoundedAsync(process.StandardOutput, 64 * 1024, cancellationToken);
      var stderr = ReadBoundedAsync(process.StandardError, 64 * 1024, cancellationToken);
      using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
      timeout.CancelAfter(TimeSpan.FromSeconds(_options.ProviderOperationTimeoutSeconds));
      try
      {
        await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
      }
      catch (OperationCanceledException)
      {
        if (!process.HasExited) process.Kill(entireProcessTree: true);
        throw;
      }
      var standardOutput = await stdout.ConfigureAwait(false);
      var standardError = await stderr.ConfigureAwait(false);
      if (process.ExitCode != 0)
        throw new InvalidOperationException(
          $"Hyper-V evaluator operation failed ({process.ExitCode}, stdout {Digest(standardOutput)}, " +
          $"stderr {Digest(standardError)}).");
      if (!File.Exists(outputPath) || new FileInfo(outputPath).Length is <= 0 or > 256 * 1024)
        throw new InvalidDataException("Hyper-V evaluator response is missing or oversized.");
      var response = await File.ReadAllBytesAsync(outputPath, cancellationToken).ConfigureAwait(false);
      try
      {
        return JsonSerializer.Deserialize<T>(response, JsonDefaults.Options)
          ?? throw new InvalidDataException("Hyper-V evaluator response is empty.");
      }
      finally
      {
        CryptographicOperations.ZeroMemory(response);
      }
    }
    finally
    {
      File.Delete(inputPath);
      File.Delete(outputPath);
    }
  }

  private void AssertProviderScript()
  {
    var executable = Path.GetFullPath(_options.PowerShellExecutablePath);
    var expected = Path.GetFullPath(
      @"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");
    if (!string.Equals(executable, expected, StringComparison.OrdinalIgnoreCase) ||
        !File.Exists(executable))
      throw new InvalidOperationException("Evaluator PowerShell host is not the fixed Windows path.");
    var script = Path.GetFullPath(_options.ProviderScriptPath);
    if (!File.Exists(script) || !GeneratedManifestValidator.IsSha256(_options.ProviderScriptSha256))
      throw new InvalidOperationException("Evaluator provider script is unavailable.");
    var actual = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(script))).ToLowerInvariant();
    if (!GeneratedManifestValidator.FixedHex(actual, _options.ProviderScriptSha256))
      throw new CryptographicException("Evaluator provider script pin does not match.");
  }

  private string OwnedRunPath(string runId, string name)
  {
    if (!Guid.TryParseExact(runId, "D", out _))
      throw new InvalidDataException("Evaluator run id is invalid.");
    var runRoot = Path.GetFullPath(Path.Combine(_transferRoot, runId.ToLowerInvariant()));
    var path = Path.GetFullPath(Path.Combine(runRoot, name));
    if (!path.StartsWith(runRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
      throw new InvalidDataException("Evaluator transfer path escaped its root.");
    return path;
  }

  private static async Task<string> ReadBoundedAsync(
    StreamReader reader,
    int maximumCharacters,
    CancellationToken cancellationToken)
  {
    var buffer = new char[4096];
    var output = new StringBuilder();
    while (true)
    {
      var read = await reader.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
      if (read == 0) break;
      if (output.Length + read > maximumCharacters)
        throw new InvalidDataException("Hyper-V evaluator process output exceeded its bound.");
      output.Append(buffer, 0, read);
    }
    return output.ToString();
  }

  private static string Digest(string value) =>
    Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}

public static class WorkspaceExportGuard
{
  public static void AssertRegularTree(string root)
  {
    var canonicalRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
    var rootInfo = new DirectoryInfo(canonicalRoot);
    if (!rootInfo.Exists || rootInfo.Attributes.HasFlag(FileAttributes.ReparsePoint))
      throw new InvalidDataException("Evaluator export root is not a regular directory.");
    foreach (var entry in rootInfo.EnumerateFileSystemInfos("*", SearchOption.AllDirectories))
    {
      var path = Path.GetFullPath(entry.FullName);
      if (!path.StartsWith(canonicalRoot + Path.DirectorySeparatorChar,
            StringComparison.OrdinalIgnoreCase) ||
          entry.Attributes.HasFlag(FileAttributes.ReparsePoint))
        throw new InvalidDataException("Evaluator export contains a reparse point or path escape.");
      if (entry is FileInfo file)
      {
        using var stream = new FileStream(file.FullName, FileMode.Open, FileAccess.Read,
          FileShare.Read, 1, FileOptions.SequentialScan);
        if (stream.Length != file.Length)
          throw new InvalidDataException("Evaluator export changed while inspected.");
      }
    }
  }
}
