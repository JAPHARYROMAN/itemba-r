using System.IO.Compression;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.UpdateSupervisor.Configuration;
using Itemba.Msaidizi.UpdateSupervisor.Contracts;
using Itemba.Msaidizi.UpdateSupervisor.Journal;
using Itemba.Msaidizi.UpdateSupervisor.Security;

namespace Itemba.Msaidizi.UpdateSupervisor.Execution;

public sealed class TrustedUpdateEngine : IDisposable
{
  private const string DigestMarkerName = ".msaidizi-package.sha256";
  private const string VersionMarkerName = ".msaidizi-package.version";

  private static readonly HashSet<string> TerminalPhases = new(StringComparer.Ordinal)
  {
    "COMMITTED", "ROLLED_BACK", "FAILED", "NEEDS_ATTENTION", "RECOVERED_ROLLBACK",
  };
  private static readonly HashSet<string> RetryablePreActivationPhases = new(StringComparer.Ordinal)
  {
    "APPLYING_FENCED", "FENCE_DEFERRED",
  };

  private readonly UpdateSupervisorOptions _options;
  private readonly ManifestVerifier _verifier;
  private readonly ImmutableTargetPolicy _policy;
  private readonly IUpdateArtifactProvider _artifacts;
  private readonly IUpdateHealthProbe _health;
  private readonly IUpdateTargetActivator _activator;
  private readonly IUpdateJournal _journal;
  private readonly IUpdateResultStore _results;
  private readonly SemaphoreSlim _singleWriter = new(1, 1);

  public TrustedUpdateEngine(
    UpdateSupervisorOptions options,
    ManifestVerifier verifier,
    ImmutableTargetPolicy policy,
    IUpdateArtifactProvider artifacts,
    IUpdateHealthProbe health,
    IUpdateTargetActivator activator,
    IUpdateJournal journal,
    IUpdateResultStore results)
  {
    _options = options.Expand();
    _verifier = verifier;
    _policy = policy;
    _artifacts = artifacts;
    _health = health;
    _activator = activator;
    _journal = journal;
    _results = results;
  }

  public async Task<UpdateExecutionResult> ExecuteAsync(
    SignedUpdateCommand command,
    Func<UpdateProgress, CancellationToken, Task>? progress,
    CancellationToken cancellationToken) => await ExecuteAsync(
      command, null, progress, cancellationToken);

  public async Task<UpdateExecutionResult> ExecuteAsync(
    SignedUpdateCommand command,
    Func<UpdateDeliveryAcknowledgement, CancellationToken, Task>? acknowledgeDelivery,
    Func<UpdateProgress, CancellationToken, Task>? progress,
    CancellationToken cancellationToken)
  {
    EnsureEnabled();
    var manifest = HasPersistedApplyingFence(command)
      ? _verifier.VerifyPersistedInFlight(command)
      : _verifier.Verify(command);
    var target = _policy.Resolve(
      manifest.TargetId,
      manifest.HealthTimeoutSeconds,
      manifest.MinimumHealthySoakSeconds);
    var actionClaimsSha256 = UpdateActionIdentity.Compute(manifest);

    await _singleWriter.WaitAsync(cancellationToken);
    try
    {
      RefuseWhileRecoveryIsPending(command, manifest, actionClaimsSha256);
      if (acknowledgeDelivery is not null)
      {
        await acknowledgeDelivery(new UpdateDeliveryAcknowledgement(
          manifest.DeviceId,
          manifest.DeploymentId,
          manifest.DeliveryLeaseId,
          command.ManifestSha256), cancellationToken);
      }
      var cached = _results.Find(
        command.DeploymentId, manifest.IdempotencyKey, actionClaimsSha256);
      if (cached is not null) return cached;
      return await ExecuteVerifiedAsync(
        command, manifest, target, actionClaimsSha256, progress, cancellationToken);
    }
    finally
    {
      _singleWriter.Release();
    }
  }

  public async Task<IReadOnlyList<UpdateExecutionResult>> RecoverAsync(CancellationToken cancellationToken)
  {
    var recovered = new List<UpdateExecutionResult>();
    await _singleWriter.WaitAsync(cancellationToken);
    try
    {
      foreach (var entry in _journal.LatestByDeployment().Values)
      {
        var idempotencyKey = RequiredData(entry, "idempotencyKey");
        var actionClaimsSha256 = RequiredData(entry, "actionClaimsSha256");
        if (_results.Find(entry.DeploymentId, idempotencyKey, actionClaimsSha256) is { } cached)
        {
          recovered.Add(cached);
          continue;
        }
        if (TerminalPhases.Contains(entry.Phase))
        {
          var reconciled = RebuildTerminalResult(entry);
          _results.Put(idempotencyKey, actionClaimsSha256, reconciled);
          recovered.Add(reconciled);
          continue;
        }
        if (RetryablePreActivationPhases.Contains(entry.Phase)) continue;

        recovered.Add(await RecoverEntryAsync(entry, cancellationToken));
      }
      return recovered;
    }
    finally
    {
      _singleWriter.Release();
    }
  }

  private async Task<UpdateExecutionResult> ExecuteVerifiedAsync(
    SignedUpdateCommand command,
    TrustedUpdateManifest manifest,
    UpdateTargetOptions target,
    string actionClaimsSha256,
    Func<UpdateProgress, CancellationToken, Task>? progress,
    CancellationToken cancellationToken)
  {
    var cacheRoot = Path.Combine(_options.SupervisorRoot, "downloads", manifest.DeploymentId);
    Directory.CreateDirectory(cacheRoot);
    EnsureNoReparsePoint(cacheRoot, _options.SupervisorRoot);
    var sourcePackage = Path.Combine(cacheRoot, "source.zip");
    var rollbackPackage = Path.Combine(cacheRoot, "rollback.zip");
    var activated = false;
    string? previousPointer = null;
    StagedArtifactIdentity? previousIdentity = null;
    StagedArtifactIdentity? nextIdentity = null;
    StagedArtifactIdentity? rollbackIdentity = null;
    try
    {
      if (progress is not null)
      {
        var fenceData = RecoveryData(
          manifest, actionClaimsSha256, null, null, null, null);
        var fence = await _journal.AppendAsync(
          manifest.DeploymentId, command.ManifestSha256, "APPLYING_FENCED", fenceData,
          cancellationToken);
        try
        {
          await progress(new UpdateProgress(
            manifest.DeviceId, manifest.DeploymentId, manifest.DeliveryLeaseId,
            command.ManifestSha256, "APPLYING", fence.Hash), cancellationToken);
        }
        catch (Exception error)
        {
          await _journal.AppendAsync(
            manifest.DeploymentId, command.ManifestSha256, "FENCE_DEFERRED", fenceData,
            CancellationToken.None);
          throw new UpdateDeliveryFenceException(
            "The central APPLYING fence was not confirmed; artifact preparation did not start.",
            error);
        }
      }

      await FetchAndVerifyAsync(manifest, "source", sourcePackage,
        manifest.SourceArtifactSha256, target.MaxPackageBytes, cancellationToken);
      await FetchAndVerifyAsync(manifest, "rollback", rollbackPackage,
        manifest.RollbackArtifactSha256, target.MaxPackageBytes, cancellationToken);
      Directory.CreateDirectory(target.VersionsRoot);
      EnsureNoReparsePoint(target.VersionsRoot, Path.GetDirectoryName(target.VersionsRoot)!);
      var sourcePointer = await StagePackageAsync(
        sourcePackage, manifest.Version, manifest.SourceArtifactSha256, target, cancellationToken);
      var rollbackPointer = await StagePackageAsync(
        rollbackPackage, manifest.RollbackVersion, manifest.RollbackArtifactSha256,
        target, cancellationToken);
      var sourceIdentity = new StagedArtifactIdentity(
        sourcePointer, manifest.Version, manifest.SourceArtifactSha256);
      rollbackIdentity = new StagedArtifactIdentity(
        rollbackPointer, manifest.RollbackVersion, manifest.RollbackArtifactSha256);
      nextIdentity = manifest.Operation == "APPLY" ? sourceIdentity : rollbackIdentity;
      previousPointer = ReadPointer(target.ActivePointerPath);
      ValidatePointer(target, previousPointer);
      previousIdentity = TryReadStagedIdentity(target, previousPointer);
      var data = RecoveryData(
        manifest, actionClaimsSha256, previousPointer, previousIdentity, nextIdentity,
        rollbackIdentity);
      await _journal.AppendAsync(
        manifest.DeploymentId, command.ManifestSha256, "PREPARED", data, cancellationToken);

      EnsureEnabled();
      WritePointerAtomically(target.ActivePointerPath, nextIdentity.Pointer);
      activated = true;
      await _activator.ActivateAsync(target, cancellationToken);
      var active = await _journal.AppendAsync(
        manifest.DeploymentId, command.ManifestSha256, "ACTIVATED", data, cancellationToken);
      if (progress is not null)
        await progress(new UpdateProgress(
          manifest.DeviceId, manifest.DeploymentId, manifest.DeliveryLeaseId,
          command.ManifestSha256, "HEALTH_CHECK", active.Hash), cancellationToken);
      var health = await ProbeIdentityAsync(
        target, nextIdentity, manifest.HealthTimeoutSeconds,
        manifest.MinimumHealthySoakSeconds, cancellationToken);
      EnsureEnabled();
      if (!health.Healthy)
      {
        var restoration = await RestoreAndProveAsync(
          target, previousIdentity, rollbackIdentity,
          manifest.HealthTimeoutSeconds, manifest.MinimumHealthySoakSeconds);
        var rollbackProven = manifest.Operation == "APPLY" && restoration.Healthy;
        return await FinishAsync(
          manifest, command.ManifestSha256, actionClaimsSha256,
          rollbackProven ? "ROLLED_BACK" : "NEEDS_ATTENTION",
          restoration.Identity?.Digest,
          restoration.Identity?.Version,
          RestorationMetrics(health, restoration),
          rollbackProven
            ? health.Reason ?? "The activated version failed health and the prior version was restored."
            : restoration.Reason ?? "The requested activation and its restoration could not be proven healthy.",
          data,
          CancellationToken.None);
      }

      var successOutcome = manifest.Operation == "APPLY" ? "SUCCEEDED" : "ROLLED_BACK";
      return await FinishAsync(
        manifest, command.ManifestSha256, actionClaimsSha256, successOutcome,
        nextIdentity.Digest, nextIdentity.Version, health.Metrics, null, data,
        CancellationToken.None);
    }
    catch (Exception error) when (
      activated || error is not (OperationCanceledException or UpdateDeliveryFenceException))
    {
      var data = RecoveryData(
        manifest, actionClaimsSha256, previousPointer, previousIdentity, nextIdentity,
        rollbackIdentity);
      RestorationAttempt? restoration = null;
      if (activated)
      {
        restoration = await RestoreAndProveAsync(
          target, previousIdentity, rollbackIdentity,
          manifest.HealthTimeoutSeconds, manifest.MinimumHealthySoakSeconds);
      }
      var metrics = restoration is null
        ? new Dictionary<string, object?> { ["exceptionType"] = error.GetType().Name }
        : RestorationMetrics(
          new HealthProbeResult(false,
            new Dictionary<string, object?> { ["exceptionType"] = error.GetType().Name },
            error.Message),
          restoration);
      return await FinishAsync(
        manifest, command.ManifestSha256, actionClaimsSha256,
        activated ? "NEEDS_ATTENTION" : "FAILED",
        restoration?.Healthy == true ? restoration.Identity?.Digest : null,
        restoration?.Healthy == true ? restoration.Identity?.Version : null,
        metrics,
        activated
          ? $"An uncertain post-activation {error.GetType().Name} occurred. " +
            (restoration?.Reason ?? "Restoration completed but operator reconciliation is required.")
          : error.Message,
        data,
        CancellationToken.None);
    }
  }

  private async Task FetchAndVerifyAsync(
    TrustedUpdateManifest manifest,
    string role,
    string path,
    string expectedDigest,
    long maxPackageBytes,
    CancellationToken cancellationToken)
  {
    if (File.Exists(path)) File.Delete(path);
    await _artifacts.FetchAsync(manifest, role, path, cancellationToken);
    if (new FileInfo(path).Length > maxPackageBytes)
    {
      File.Delete(path);
      throw new InvalidDataException($"The {role} package exceeds supervisor policy.");
    }
    await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
    var actual = Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken)).ToLowerInvariant();
    if (!CryptographicOperations.FixedTimeEquals(
          Convert.FromHexString(actual), Convert.FromHexString(expectedDigest)))
    {
      File.Delete(path);
      throw new CryptographicException($"The {role} artifact digest is invalid.");
    }
  }

  private static async Task<string> StagePackageAsync(
    string package,
    string version,
    string digest,
    UpdateTargetOptions target,
    CancellationToken cancellationToken)
  {
    var directoryName = VersionDirectoryName(version, digest);
    var final = Path.Combine(target.VersionsRoot, directoryName);
    var digestMarker = Path.Combine(final, DigestMarkerName);
    var versionMarker = Path.Combine(final, VersionMarkerName);
    if (Directory.Exists(final))
    {
      if (!File.Exists(digestMarker) || !File.Exists(versionMarker) ||
          !string.Equals((await File.ReadAllTextAsync(digestMarker, cancellationToken)).Trim(),
            digest, StringComparison.Ordinal) ||
          !string.Equals((await File.ReadAllTextAsync(versionMarker, cancellationToken)).Trim(),
            version, StringComparison.Ordinal))
        throw new InvalidDataException("An existing version directory has the wrong provenance.");
      return directoryName;
    }
    var staging = final + ".staging-" + Guid.NewGuid().ToString("N");
    Directory.CreateDirectory(staging);
    try
    {
      using var archive = ZipFile.OpenRead(package);
      if (archive.Entries.Count > target.MaxFileCount)
        throw new InvalidDataException("Update package contains too many entries.");
      long expandedBytes = 0;
      foreach (var entry in archive.Entries)
      {
        cancellationToken.ThrowIfCancellationRequested();
        expandedBytes = checked(expandedBytes + entry.Length);
        if (expandedBytes > target.MaxExpandedBytes)
          throw new InvalidDataException("Update package expands beyond supervisor policy.");
        var unixType = (entry.ExternalAttributes >> 16) & 0xF000;
        if (unixType == 0xA000 ||
            ((FileAttributes)entry.ExternalAttributes).HasFlag(FileAttributes.ReparsePoint))
          throw new InvalidDataException("Update packages may not contain links or reparse points.");
        var destination = SafeArchiveDestination(staging, entry.FullName);
        if (entry.FullName.EndsWith('/') || entry.FullName.EndsWith('\\'))
        {
          Directory.CreateDirectory(destination);
          continue;
        }
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        await using var input = entry.Open();
        await using var output = new FileStream(
          destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024,
          FileOptions.Asynchronous | FileOptions.WriteThrough);
        await input.CopyToAsync(output, cancellationToken);
        await output.FlushAsync(cancellationToken);
        output.Flush(flushToDisk: true);
      }
      await File.WriteAllTextAsync(Path.Combine(staging, DigestMarkerName), digest,
        Encoding.ASCII, cancellationToken);
      await File.WriteAllTextAsync(Path.Combine(staging, VersionMarkerName), version,
        Encoding.UTF8, cancellationToken);
      Directory.Move(staging, final);
      return directoryName;
    }
    catch
    {
      if (Directory.Exists(staging)) Directory.Delete(staging, recursive: true);
      throw;
    }
  }

  private async Task<UpdateExecutionResult> FinishAsync(
    TrustedUpdateManifest manifest,
    string manifestSha256,
    string actionClaimsSha256,
    string outcome,
    string? activatedDigest,
    string? observedVersion,
    IReadOnlyDictionary<string, object?> health,
    string? reason,
    IReadOnlyDictionary<string, string?> data,
    CancellationToken cancellationToken)
  {
    var normalizedReason = UpdateTerminalReason.Normalize(reason);
    var phase = outcome switch
    {
      "SUCCEEDED" => "COMMITTED",
      "ROLLED_BACK" => "ROLLED_BACK",
      "NEEDS_ATTENTION" => "NEEDS_ATTENTION",
      _ => "FAILED",
    };
    var terminalData = new Dictionary<string, string?>(data, StringComparer.Ordinal)
    {
      ["outcome"] = outcome,
      ["activatedArtifactSha256"] = activatedDigest,
      ["observedVersion"] = observedVersion,
      ["healthJson"] = JsonSerializer.Serialize(health),
      ["reason"] = normalizedReason,
    };
    var journal = await _journal.AppendAsync(
      manifest.DeploymentId, manifestSha256, phase, terminalData, cancellationToken);
    var result = new UpdateExecutionResult(
      manifest.DeviceId, manifest.DeploymentId, outcome, manifestSha256, journal.Hash,
      activatedDigest, observedVersion, health, normalizedReason);
    _results.Put(manifest.IdempotencyKey, actionClaimsSha256, result);
    return result;
  }

  private static Dictionary<string, string?> RecoveryData(
    TrustedUpdateManifest manifest,
    string actionClaimsSha256,
    string? previousPointer,
    StagedArtifactIdentity? previous,
    StagedArtifactIdentity? next,
    StagedArtifactIdentity? rollback)
  {
    var data = new Dictionary<string, string?>(StringComparer.Ordinal)
    {
      ["deviceId"] = manifest.DeviceId,
      ["targetId"] = manifest.TargetId,
      ["operation"] = manifest.Operation,
      ["idempotencyKey"] = manifest.IdempotencyKey,
      ["actionClaimsSha256"] = actionClaimsSha256,
      ["deliveryLeaseId"] = manifest.DeliveryLeaseId,
      ["deliveryAttempt"] = manifest.DeliveryAttempt.ToString(CultureInfo.InvariantCulture),
      ["healthTimeoutSeconds"] = manifest.HealthTimeoutSeconds.ToString(CultureInfo.InvariantCulture),
      ["minimumHealthySoakSeconds"] =
        manifest.MinimumHealthySoakSeconds.ToString(CultureInfo.InvariantCulture),
      ["minimumRingDwellSeconds"] =
        manifest.MinimumRingDwellSeconds.ToString(CultureInfo.InvariantCulture),
      ["preActionPointer"] = previousPointer,
    };
    AddIdentity(data, "previous", previous);
    AddIdentity(data, "next", next);
    AddIdentity(data, "rollback", rollback);
    return data;
  }

  private async Task<HealthProbeResult> ProbeIdentityAsync(
    UpdateTargetOptions target,
    StagedArtifactIdentity identity,
    int healthTimeoutSeconds,
    int minimumHealthySoakSeconds,
    CancellationToken cancellationToken)
  {
    ValidateStagedIdentity(target, identity);
    var health = await _health.WaitForHealthyAsync(
      target,
      Path.Combine(target.VersionsRoot, identity.Pointer),
      identity.Version,
      TimeSpan.FromSeconds(healthTimeoutSeconds),
      TimeSpan.FromSeconds(minimumHealthySoakSeconds),
      cancellationToken);
    if (!health.Healthy || !target.RequireObservedVersion ||
        string.Equals(health.ObservedVersion, identity.Version, StringComparison.Ordinal))
      return health;
    return new HealthProbeResult(
      false,
      new Dictionary<string, object?>(health.Metrics)
      {
        ["requiredVersion"] = identity.Version,
        ["observedVersion"] = health.ObservedVersion,
      },
      "The health probe reported healthy for a version other than the signed artifact.",
      health.ObservedVersion);
  }

  private async Task<RestorationAttempt> RestoreAndProveAsync(
    UpdateTargetOptions target,
    StagedArtifactIdentity? previous,
    StagedArtifactIdentity? rollback,
    int healthTimeoutSeconds,
    int minimumHealthySoakSeconds)
  {
    StagedArtifactIdentity? identity = null;
    try
    {
      identity = SelectRestorationIdentity(target, previous, rollback);
      WritePointerAtomically(target.ActivePointerPath, identity.Pointer);
      await _activator.ActivateAsync(target, CancellationToken.None);
      var health = await ProbeIdentityAsync(
        target, identity, healthTimeoutSeconds, minimumHealthySoakSeconds,
        CancellationToken.None);
      return new RestorationAttempt(
        health.Healthy,
        identity,
        health,
        health.Healthy
          ? "The restored version completed its continuous exact-version health soak."
          : health.Reason ?? "The restored version did not pass health.");
    }
    catch (Exception error)
    {
      return new RestorationAttempt(
        false,
        identity,
        null,
        $"Restoration raised {error.GetType().Name}: {error.Message}");
    }
  }

  private async Task<UpdateExecutionResult> RecoverEntryAsync(
    UpdateJournalEntry entry,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var idempotencyKey = RequiredData(entry, "idempotencyKey");
    var actionClaimsSha256 = RequiredData(entry, "actionClaimsSha256");
    var deviceId = RequiredData(entry, "deviceId");
    try
    {
      var timeoutSeconds = RequiredPositiveInt(entry, "healthTimeoutSeconds");
      var soakSeconds = RequiredPositiveInt(entry, "minimumHealthySoakSeconds");
      var target = _policy.Resolve(RequiredData(entry, "targetId"), timeoutSeconds, soakSeconds);
      var next = RequiredIdentity(entry, "next");
      var rollback = RequiredIdentity(entry, "rollback");
      var previous = OptionalIdentity(entry, "previous");
      var restore = SelectRestorationIdentity(target, previous, rollback);
      var current = ReadPointer(target.ActivePointerPath);
      ValidatePointer(target, current);

      if (!string.Equals(current, next.Pointer, StringComparison.Ordinal))
      {
        if (entry.Phase == "PREPARED" &&
            string.Equals(current, entry.Data.GetValueOrDefault("preActionPointer"),
              StringComparison.Ordinal))
          return await FinishRecoveryAsync(
            entry, idempotencyKey, actionClaimsSha256, deviceId, "FAILED", null, null,
            new Dictionary<string, object?>
            {
              ["crashRecovery"] = true,
              ["pointerChanged"] = false,
            },
            "Recovery proved that activation had not changed the active pointer.");
        if (!string.Equals(current, restore.Pointer, StringComparison.Ordinal))
          return await FinishRecoveryAsync(
            entry, idempotencyKey, actionClaimsSha256, deviceId, "NEEDS_ATTENTION", null, null,
            new Dictionary<string, object?>
            {
              ["crashRecovery"] = true,
              ["currentPointer"] = current,
            },
            "The active pointer does not match either the interrupted activation or its trusted restoration target.");
      }

      var restoration = await RestoreAndProveAsync(
        target, restore, rollback, timeoutSeconds, soakSeconds);
      var metrics = restoration.Health is null
        ? new Dictionary<string, object?>()
        : new Dictionary<string, object?>(restoration.Health.Metrics);
      metrics["crashRecovery"] = true;
      metrics["pointerChanged"] =
        !string.Equals(current, restore.Pointer, StringComparison.Ordinal);
      metrics["restoration"] = restoration.Health?.Metrics;
      metrics["restorationHealthy"] = restoration.Healthy;
      metrics["restoredVersion"] = restoration.Identity?.Version;
      return await FinishRecoveryAsync(
        entry, idempotencyKey, actionClaimsSha256, deviceId,
        restoration.Healthy ? "ROLLED_BACK" : "NEEDS_ATTENTION",
        restoration.Healthy ? restoration.Identity?.Digest : null,
        restoration.Healthy ? restoration.Identity?.Version : null,
        metrics,
        restoration.Reason);
    }
    catch (Exception error)
    {
      return await FinishRecoveryAsync(
        entry, idempotencyKey, actionClaimsSha256, deviceId, "NEEDS_ATTENTION", null, null,
        new Dictionary<string, object?>
        {
          ["crashRecovery"] = true,
          ["exceptionType"] = error.GetType().Name,
        },
        $"Crash recovery raised {error.GetType().Name}: {error.Message}");
    }
  }

  private async Task<UpdateExecutionResult> FinishRecoveryAsync(
    UpdateJournalEntry entry,
    string idempotencyKey,
    string actionClaimsSha256,
    string deviceId,
    string outcome,
    string? activatedDigest,
    string? observedVersion,
    IReadOnlyDictionary<string, object?> health,
    string? reason)
  {
    var normalizedReason = UpdateTerminalReason.Normalize(reason);
    var phase = outcome == "ROLLED_BACK" ? "RECOVERED_ROLLBACK" :
      outcome == "FAILED" ? "FAILED" : "NEEDS_ATTENTION";
    var data = new Dictionary<string, string?>(entry.Data, StringComparer.Ordinal)
    {
      ["outcome"] = outcome,
      ["activatedArtifactSha256"] = activatedDigest,
      ["observedVersion"] = observedVersion,
      ["healthJson"] = JsonSerializer.Serialize(health),
      ["reason"] = normalizedReason,
    };
    var journal = await _journal.AppendAsync(
      entry.DeploymentId, entry.ManifestSha256, phase, data, CancellationToken.None);
    var result = new UpdateExecutionResult(
      deviceId, entry.DeploymentId, outcome, entry.ManifestSha256, journal.Hash,
      activatedDigest, observedVersion, health, normalizedReason);
    _results.Put(idempotencyKey, actionClaimsSha256, result);
    return result;
  }

  private static UpdateExecutionResult RebuildTerminalResult(UpdateJournalEntry entry)
  {
    var outcome = entry.Data.GetValueOrDefault("outcome") ?? entry.Phase switch
    {
      "COMMITTED" => "SUCCEEDED",
      "ROLLED_BACK" or "RECOVERED_ROLLBACK" => "ROLLED_BACK",
      "NEEDS_ATTENTION" => "NEEDS_ATTENTION",
      _ => "FAILED",
    };
    return new UpdateExecutionResult(
      RequiredData(entry, "deviceId"),
      entry.DeploymentId,
      outcome,
      entry.ManifestSha256,
      entry.Hash,
      entry.Data.GetValueOrDefault("activatedArtifactSha256"),
      entry.Data.GetValueOrDefault("observedVersion"),
      RebuildTerminalHealth(entry),
      UpdateTerminalReason.Normalize(entry.Data.GetValueOrDefault("reason")));
  }

  private static Dictionary<string, object?> RebuildTerminalHealth(
    UpdateJournalEntry entry)
  {
    var json = entry.Data.GetValueOrDefault("healthJson");
    if (string.IsNullOrWhiteSpace(json))
      return new Dictionary<string, object?> { ["recoveredFromTerminalJournal"] = true };
    var health = JsonSerializer.Deserialize<Dictionary<string, object?>>(json)
      ?? throw new InvalidDataException("Terminal update health evidence is corrupt.");
    health["recoveredFromTerminalJournal"] = true;
    return health;
  }

  private void RefuseWhileRecoveryIsPending(
    SignedUpdateCommand command,
    TrustedUpdateManifest manifest,
    string actionClaimsSha256)
  {
    var latest = _journal.LatestByDeployment();
    var pending = latest.Values.FirstOrDefault(entry =>
      !TerminalPhases.Contains(entry.Phase) &&
      !RetryablePreActivationPhases.Contains(entry.Phase));
    if (pending is not null)
      throw new InvalidOperationException(
        $"Deployment {pending.DeploymentId} has nonterminal trusted state and must be recovered before any update executes.");
    if (!latest.TryGetValue(command.DeploymentId, out var terminal)) return;
    if (!string.Equals(RequiredData(terminal, "idempotencyKey"), manifest.IdempotencyKey,
          StringComparison.Ordinal) ||
        !string.Equals(RequiredData(terminal, "actionClaimsSha256"), actionClaimsSha256,
          StringComparison.Ordinal))
      throw new InvalidDataException(
        "A terminal deployment was replayed with different immutable action claims.");
    if (RetryablePreActivationPhases.Contains(terminal.Phase)) return;
    if (_results.Find(command.DeploymentId, manifest.IdempotencyKey, actionClaimsSha256) is null)
      _results.Put(
        manifest.IdempotencyKey, actionClaimsSha256, RebuildTerminalResult(terminal));
  }

  private bool HasPersistedApplyingFence(SignedUpdateCommand command)
  {
    if (!_journal.LatestByDeployment().TryGetValue(command.DeploymentId, out var latest))
      return false;
    return RetryablePreActivationPhases.Contains(latest.Phase) &&
      string.Equals(latest.ManifestSha256, command.ManifestSha256, StringComparison.Ordinal);
  }

  private static Dictionary<string, object?> RestorationMetrics(
    HealthProbeResult activation,
    RestorationAttempt restoration)
  {
    var metrics = restoration.Health is null
      ? new Dictionary<string, object?>()
      : new Dictionary<string, object?>(restoration.Health.Metrics);
    metrics["activation"] = activation.Metrics;
    metrics["activationReason"] = activation.Reason;
    metrics["restoration"] = restoration.Health?.Metrics;
    metrics["restorationHealthy"] = restoration.Healthy;
    metrics["restorationReason"] = restoration.Reason;
    metrics["restoredVersion"] = restoration.Identity?.Version;
    metrics["restoredArtifactSha256"] = restoration.Identity?.Digest;
    return metrics;
  }

  private static StagedArtifactIdentity SelectRestorationIdentity(
    UpdateTargetOptions target,
    StagedArtifactIdentity? previous,
    StagedArtifactIdentity? rollback)
  {
    if (previous is not null && rollback is not null &&
        string.Equals(previous.Version, rollback.Version, StringComparison.Ordinal) &&
        string.Equals(previous.Digest, rollback.Digest, StringComparison.Ordinal) &&
        IsStagedIdentityValid(target, previous))
      return previous;
    if (rollback is not null && IsStagedIdentityValid(target, rollback)) return rollback;
    throw new InvalidDataException("No version-and-digest-bound restoration target is available.");
  }

  private static StagedArtifactIdentity? TryReadStagedIdentity(
    UpdateTargetOptions target,
    string? pointer)
  {
    if (string.IsNullOrWhiteSpace(pointer)) return null;
    ValidatePointer(target, pointer);
    var directory = Path.Combine(target.VersionsRoot, pointer);
    if (!Directory.Exists(directory)) return null;
    EnsureNoReparsePoint(directory, target.VersionsRoot);
    var digestPath = Path.Combine(directory, DigestMarkerName);
    var versionPath = Path.Combine(directory, VersionMarkerName);
    if (!File.Exists(digestPath) || !File.Exists(versionPath)) return null;
    var identity = new StagedArtifactIdentity(
      pointer, File.ReadAllText(versionPath).Trim(), File.ReadAllText(digestPath).Trim());
    return IsStagedIdentityValid(target, identity) ? identity : null;
  }

  private static bool IsStagedIdentityValid(
    UpdateTargetOptions target,
    StagedArtifactIdentity identity)
  {
    try
    {
      ValidateStagedIdentity(target, identity);
      return true;
    }
    catch (Exception error) when (error is IOException or InvalidDataException)
    {
      return false;
    }
  }

  private static void ValidateStagedIdentity(
    UpdateTargetOptions target,
    StagedArtifactIdentity identity)
  {
    ValidatePointer(target, identity.Pointer);
    if (!IsSafeVersion(identity.Version) || !IsSha256(identity.Digest) ||
        !string.Equals(identity.Pointer, VersionDirectoryName(identity.Version, identity.Digest),
          StringComparison.Ordinal))
      throw new InvalidDataException("A staged update identity is invalid.");
    var directory = Path.Combine(target.VersionsRoot, identity.Pointer);
    if (!Directory.Exists(directory))
      throw new InvalidDataException("A staged update directory is missing.");
    EnsureNoReparsePoint(directory, target.VersionsRoot);
    var actualDigest = File.ReadAllText(Path.Combine(directory, DigestMarkerName)).Trim();
    var actualVersion = File.ReadAllText(Path.Combine(directory, VersionMarkerName)).Trim();
    if (!string.Equals(actualDigest, identity.Digest, StringComparison.Ordinal) ||
        !string.Equals(actualVersion, identity.Version, StringComparison.Ordinal))
      throw new InvalidDataException("A staged update no longer matches its trusted provenance.");
  }

  private static StagedArtifactIdentity RequiredIdentity(UpdateJournalEntry entry, string prefix) =>
    new(
      RequiredData(entry, prefix + "Pointer"),
      RequiredData(entry, prefix + "Version"),
      RequiredData(entry, prefix + "ArtifactSha256"));

  private static StagedArtifactIdentity? OptionalIdentity(UpdateJournalEntry entry, string prefix)
  {
    var pointer = entry.Data.GetValueOrDefault(prefix + "Pointer");
    var version = entry.Data.GetValueOrDefault(prefix + "Version");
    var digest = entry.Data.GetValueOrDefault(prefix + "ArtifactSha256");
    return string.IsNullOrWhiteSpace(pointer) || string.IsNullOrWhiteSpace(version) ||
      string.IsNullOrWhiteSpace(digest)
      ? null
      : new StagedArtifactIdentity(pointer, version, digest);
  }

  private static void AddIdentity(
    IDictionary<string, string?> data,
    string prefix,
    StagedArtifactIdentity? identity)
  {
    data[prefix + "Pointer"] = identity?.Pointer;
    data[prefix + "Version"] = identity?.Version;
    data[prefix + "ArtifactSha256"] = identity?.Digest;
  }

  private static string RequiredData(UpdateJournalEntry entry, string key) =>
    entry.Data.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
      ? value
      : throw new InvalidDataException($"Update journal recovery data is missing {key}.");

  private static int RequiredPositiveInt(UpdateJournalEntry entry, string key) =>
    int.TryParse(RequiredData(entry, key), NumberStyles.None, CultureInfo.InvariantCulture,
      out var value) && value > 0
      ? value
      : throw new InvalidDataException($"Update journal recovery data has invalid {key}.");

  private static string VersionDirectoryName(string version, string digest)
  {
    if (!IsSafeVersion(version) || !IsSha256(digest))
      throw new InvalidDataException("Update package identity is invalid.");
    return $"{version}-{digest[..16]}";
  }

  private static bool IsSafeVersion(string value) =>
    value.Length is >= 1 and <= 80 && char.IsLetterOrDigit(value[0]) &&
    value.All(ch => char.IsLetterOrDigit(ch) || ".-_+".Contains(ch));

  private static bool IsSha256(string value) =>
    value.Length == 64 && value.All(ch => ch is >= '0' and <= '9' or >= 'a' and <= 'f');

  private sealed record StagedArtifactIdentity(string Pointer, string Version, string Digest);

  private sealed record RestorationAttempt(
    bool Healthy,
    StagedArtifactIdentity? Identity,
    HealthProbeResult? Health,
    string Reason);

  private static string SafeArchiveDestination(string root, string entryName)
  {
    if (string.IsNullOrWhiteSpace(entryName) || Path.IsPathFullyQualified(entryName) ||
        entryName.Contains(':'))
      throw new InvalidDataException("Update package contains an invalid path.");
    var fullRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
    var destination = Path.GetFullPath(entryName.Replace('/', Path.DirectorySeparatorChar), fullRoot);
    if (!destination.StartsWith(fullRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
      throw new InvalidDataException("Update package path escapes its staging root.");
    return destination;
  }

  private static string? ReadPointer(string path)
  {
    if (!File.Exists(path)) return null;
    var value = File.ReadAllText(path).Trim();
    return string.IsNullOrEmpty(value) ? null : value;
  }

  private static void ValidatePointer(UpdateTargetOptions target, string? pointer)
  {
    if (pointer is null) return;
    if (Path.IsPathFullyQualified(pointer) || pointer.Contains(':') ||
        pointer.Contains(Path.DirectorySeparatorChar) || pointer.Contains(Path.AltDirectorySeparatorChar))
      throw new InvalidDataException("The active version pointer is invalid.");
    var path = Path.GetFullPath(pointer, target.VersionsRoot);
    var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(target.VersionsRoot));
    if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
      throw new InvalidDataException("The active version pointer escapes the allowlisted root.");
  }

  private static void WritePointerAtomically(string path, string value)
  {
    var parent = Path.GetDirectoryName(Path.GetFullPath(path))
      ?? throw new InvalidOperationException("The active pointer has no parent.");
    Directory.CreateDirectory(parent);
    var temporary = Path.Combine(parent, ".msaidizi-pointer-" + Guid.NewGuid().ToString("N") + ".tmp");
    using (var stream = new FileStream(
      temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
    {
      var bytes = Encoding.UTF8.GetBytes(value + Environment.NewLine);
      stream.Write(bytes);
      stream.Flush(flushToDisk: true);
    }
    File.Move(temporary, path, overwrite: true);
  }

  private static void EnsureNoReparsePoint(string path, string stopAt)
  {
    var stop = Path.TrimEndingDirectorySeparator(Path.GetFullPath(stopAt));
    var current = new DirectoryInfo(Path.GetFullPath(path));
    while (current.Exists)
    {
      if (current.Attributes.HasFlag(FileAttributes.ReparsePoint))
        throw new UnauthorizedAccessException("Update paths may not traverse a reparse point.");
      var full = Path.TrimEndingDirectorySeparator(current.FullName);
      if (string.Equals(full, stop, StringComparison.OrdinalIgnoreCase)) return;
      if (current.Parent is null) break;
      current = current.Parent;
    }
  }

  private void EnsureEnabled()
  {
    if (File.Exists(_options.KillSwitchPath))
      throw new UnauthorizedAccessException("The local Msaidizi kill switch is active.");
  }

  public void Dispose()
  {
    _singleWriter.Dispose();
  }
}
