using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.RecoverySupervisor.Configuration;
using Itemba.Msaidizi.RecoverySupervisor.Contracts;
using Itemba.Msaidizi.RecoverySupervisor.Journal;
using Itemba.Msaidizi.RecoverySupervisor.Security;

namespace Itemba.Msaidizi.RecoverySupervisor.Execution;

public sealed class TrustedRecoveryEngine : IDisposable
{
  private readonly RecoverySupervisorOptions _options;
  private readonly RecoveryManifestVerifier _verifier;
  private readonly ITrustedQuarantineRecoveryExecutor _quarantine;
  private readonly ITrustedFileSystemRecoveryExecutor _fileSystem;
  private readonly ITrustedAdministrativeRecoveryExecutor _administrative;
  private readonly IRecoveryJournal _journal;
  private readonly IRecoveryResultStore _results;
  private readonly SemaphoreSlim _singleWriter = new(1, 1);

  public TrustedRecoveryEngine(
    RecoverySupervisorOptions options,
    RecoveryManifestVerifier verifier,
    ITrustedQuarantineRecoveryExecutor quarantine,
    ITrustedFileSystemRecoveryExecutor fileSystem,
    ITrustedAdministrativeRecoveryExecutor administrative,
    IRecoveryJournal journal,
    IRecoveryResultStore results)
  {
    _options = options.Expand();
    _verifier = verifier;
    _quarantine = quarantine;
    _fileSystem = fileSystem;
    _administrative = administrative;
    _journal = journal;
    _results = results;
  }

  public async Task<RecoveryExecutionResult> ExecuteAsync(
    SignedRecoveryCommand command,
    Func<RecoveryProgress, CancellationToken, Task>? progress,
    CancellationToken cancellationToken)
  {
    var cached = _results.Find(command.RecoveryId, command.ManifestSha256);
    if (cached is not null) return cached;
    EnsureEnabled();
    var manifest = _verifier.Verify(command);

    await _singleWriter.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      cached = _results.Find(command.RecoveryId, command.ManifestSha256);
      if (cached is not null) return cached;
      return await ExecuteVerifiedAsync(
        command,
        manifest,
        progress,
        cancellationToken).ConfigureAwait(false);
    }
    finally
    {
      _singleWriter.Release();
    }
  }

  private async Task<RecoveryExecutionResult> ExecuteVerifiedAsync(
    SignedRecoveryCommand command,
    TrustedRecoveryManifest manifest,
    Func<RecoveryProgress, CancellationToken, Task>? progress,
    CancellationToken cancellationToken)
  {
    var evidence = new Dictionary<string, string?>(StringComparer.Ordinal)
    {
      ["deviceId"] = manifest.DeviceId,
      ["originalActionId"] = manifest.OriginalActionId,
      ["recoveryRecordSha256"] = manifest.RecoveryRecordSha256,
      ["expectedCurrentStateSha256"] = manifest.ExpectedCurrentStateSha256,
      ["expectedRestoredStateSha256"] = manifest.ExpectedRestoredStateSha256,
    };
    var prepared = await _journal.AppendAsync(
      manifest.RecoveryId,
      command.ManifestSha256,
      "PREPARED",
      evidence,
      cancellationToken).ConfigureAwait(false);
    if (progress is not null)
    {
      await progress(
        new RecoveryProgress(
          manifest.DeviceId,
          manifest.RecoveryId,
          prepared.Hash),
        cancellationToken).ConfigureAwait(false);
    }

    EnsureEnabled();
    try
    {
      var restored = await RestoreAsync(manifest, cancellationToken).ConfigureAwait(false);
      if (!string.Equals(
            restored.RestoredStateSha256,
            manifest.ExpectedRestoredStateSha256,
            StringComparison.OrdinalIgnoreCase))
      {
        throw new HostRecoveryException("recovery_postcondition_mismatch");
      }
      var committed = await _journal.AppendAsync(
        manifest.RecoveryId,
        command.ManifestSha256,
        "COMMITTED",
        evidence.Concat(new[]
          {
            new KeyValuePair<string, string?>("operation", restored.Operation),
            new KeyValuePair<string, string?>("restoredStateSha256", restored.RestoredStateSha256),
            new KeyValuePair<string, string?>("idempotentReplay", restored.IdempotentReplay.ToString()),
          })
          .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
        cancellationToken).ConfigureAwait(false);
      var result = new RecoveryExecutionResult(
        manifest.DeviceId,
        manifest.RecoveryId,
        "SUCCEEDED",
        command.ManifestSha256,
        committed.Hash,
        restored.RestoredStateSha256,
        null);
      _results.Put(result);
      return result;
    }
    catch (Exception error) when (error is not OperationCanceledException)
    {
      var code = SafeErrorCode(error);
      var outcome = code is
        "recovery_postcondition_mismatch" or
        "recovery_target_unavailable" or
        "recovery_outcome_unknown"
          ? "NEEDS_ATTENTION"
          : "FAILED";
      var failed = await _journal.AppendAsync(
        manifest.RecoveryId,
        command.ManifestSha256,
        outcome,
        evidence.Concat(new[] { new KeyValuePair<string, string?>("errorCode", code) })
          .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
        CancellationToken.None).ConfigureAwait(false);
      var result = new RecoveryExecutionResult(
        manifest.DeviceId,
        manifest.RecoveryId,
        outcome,
        command.ManifestSha256,
        failed.Hash,
        null,
        code);
      _results.Put(result);
      return result;
    }
  }

  private async ValueTask<RecoveryAdapterResult> RestoreAsync(
    TrustedRecoveryManifest manifest,
    CancellationToken cancellationToken)
  {
    try
    {
      var restored = await _quarantine.RestoreAsync(
        new TrustedQuarantineRecoveryRequest(
          manifest.OriginalActionId,
          manifest.RecoveryRecordSha256,
          manifest.ExpectedCurrentStateSha256),
        cancellationToken).ConfigureAwait(false);
      return new RecoveryAdapterResult(
        restored.Operation,
        restored.RestoredStateSha256,
        restored.IdempotentReplay);
    }
    catch (HostRecoveryException error)
      when (error.Message == "recovery_operation_not_supported")
    {
      try
      {
        var restored = await _fileSystem.RestoreAsync(
          new TrustedFileSystemRecoveryRequest(
            manifest.OriginalActionId,
            manifest.RecoveryRecordSha256,
            manifest.ExpectedCurrentStateSha256),
          cancellationToken).ConfigureAwait(false);
        return new RecoveryAdapterResult(
          restored.Operation,
          restored.RestoredStateSha256,
          restored.IdempotentReplay);
      }
      catch (HostRecoveryException fileSystemError)
        when (fileSystemError.Message == "recovery_operation_not_supported")
      {
        var restored = await _administrative.RestoreAsync(
          new TrustedAdministrativeRecoveryRequest(
            manifest.OriginalActionId,
            manifest.RecoveryRecordSha256,
            manifest.ExpectedCurrentStateSha256),
          cancellationToken).ConfigureAwait(false);
        return new RecoveryAdapterResult(
          restored.Operation,
          restored.RestoredStateSha256,
          restored.IdempotentReplay);
      }
    }
  }

  private void EnsureEnabled()
  {
    if (File.Exists(_options.KillSwitchPath))
      throw new UnauthorizedAccessException("The local Msaidizi kill switch is active.");
  }

  private static string SafeErrorCode(Exception error)
  {
    if (error is HostRecoveryException &&
        error.Message.Length is > 0 and <= 160 &&
        error.Message.All(character => char.IsAsciiLetterOrDigit(character) || character == '_'))
      return error.Message;
    return error switch
    {
      UnauthorizedAccessException => "recovery_unauthorized",
      IOException => "recovery_io_failure",
      _ => "recovery_failed",
    };
  }

  public void Dispose() => _singleWriter.Dispose();

  private sealed record RecoveryAdapterResult(
    string Operation,
    string RestoredStateSha256,
    bool IdempotentReplay);
}
