using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.UpdateSupervisor.Channel;
using Itemba.Msaidizi.UpdateSupervisor.Configuration;
using Itemba.Msaidizi.UpdateSupervisor.Contracts;
using Itemba.Msaidizi.UpdateSupervisor.Execution;
using Itemba.Msaidizi.UpdateSupervisor.Journal;
using Itemba.Msaidizi.UpdateSupervisor.Security;
using Xunit;

namespace Itemba.Msaidizi.UpdateSupervisor.Tests;

public sealed class TrustedUpdateSupervisorTests : IDisposable
{
  private readonly string _root = Path.Combine(Path.GetTempPath(), "msaidizi-updater-" + Guid.NewGuid().ToString("N"));
  private readonly ECDsa _signingKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);

  public TrustedUpdateSupervisorTests() => Directory.CreateDirectory(_root);

  [Fact]
  public async Task EnrollmentUsesDedicatedUpdateRoleAndOneTimeChallenge()
  {
    var handler = new RecordingHandler();
    var client = new UpdateBrokerClient(new HttpClient(handler)
    {
      BaseAddress = new Uri("https://itemba.invalid/api/v1/"),
    });

    await client.EnrollAsync("device-1", "enrollment-1", "one-time-code", CancellationToken.None);

    Assert.Equal(HttpMethod.Post, handler.Method);
    Assert.Equal(
      "/api/v1/msaidizi/devices/supervisor-enrollment/complete",
      handler.Path);
    using var body = JsonDocument.Parse(handler.Body!);
    Assert.Equal("device-1", body.RootElement.GetProperty("deviceId").GetString());
    Assert.Equal("enrollment-1", body.RootElement.GetProperty("enrollmentId").GetString());
    Assert.Equal("UPDATE", body.RootElement.GetProperty("role").GetString());
    Assert.Equal("one-time-code", body.RootElement.GetProperty("enrollmentCode").GetString());
  }

  [Fact]
  public async Task DeliveryAcknowledgementCarriesTheSignedLeaseAndManifestDigest()
  {
    var handler = new RecordingHandler();
    var client = new UpdateBrokerClient(new HttpClient(handler)
    {
      BaseAddress = new Uri("https://itemba.invalid/api/v1/"),
    });
    var acknowledgement = new UpdateDeliveryAcknowledgement(
      "device-1", Guid.NewGuid().ToString("D"), Guid.NewGuid().ToString("D"),
      new string('a', 64));

    await client.AcknowledgeDeliveryAsync(acknowledgement, CancellationToken.None);

    Assert.Equal("/api/v1/msaidizi/update-supervisor/channel/ack", handler.Path);
    using var body = JsonDocument.Parse(handler.Body!);
    Assert.Equal(acknowledgement.DeviceId, body.RootElement.GetProperty("deviceId").GetString());
    Assert.Equal(acknowledgement.DeploymentId,
      body.RootElement.GetProperty("deploymentId").GetString());
    Assert.Equal(acknowledgement.DeliveryLeaseId,
      body.RootElement.GetProperty("deliveryLeaseId").GetString());
    Assert.Equal(acknowledgement.ManifestSha256,
      body.RootElement.GetProperty("manifestSha256").GetString());
  }

  [Fact]
  public async Task ResultWireSanitizesAndBoundsTerminalReasonForBackendDto()
  {
    var handler = new RecordingHandler();
    var client = new UpdateBrokerClient(new HttpClient(handler)
    {
      BaseAddress = new Uri("https://itemba.invalid/api/v1/"),
    });
    var unsafeReason = "failed\r\n\0\u202E" + new string('x', 2_500);
    var result = new UpdateExecutionResult(
      "device-1", Guid.NewGuid().ToString("D"), "FAILED", new string('a', 64),
      new string('b', 64), null, null, new Dictionary<string, object?>(), unsafeReason);

    await client.ReportResultAsync(result, CancellationToken.None);

    using var body = JsonDocument.Parse(handler.Body!);
    var reason = body.RootElement.GetProperty("reason").GetString();
    Assert.NotNull(reason);
    Assert.Equal(UpdateTerminalReason.MaximumLength, reason!.Length);
    Assert.EndsWith(UpdateTerminalReason.TruncationMarker, reason,
      StringComparison.Ordinal);
    Assert.DoesNotContain(reason, char.IsControl);
    Assert.DoesNotContain('\u202E', reason);
  }

  [Fact]
  public void RejectsManifestTampering()
  {
    var fixture = CreateFixture(healthy: true);
    var command = CreateCommand(fixture.Options, fixture.SourceDigest, fixture.RollbackDigest);
    var tamperedJson = command.ManifestJson.Replace("1.0.0", "9.9.9", StringComparison.Ordinal);
    var tampered = command with
    {
      ManifestJson = tamperedJson,
      ManifestSha256 = Sha256(Encoding.UTF8.GetBytes(tamperedJson)),
    };

    Assert.Throws<CryptographicException>(() => fixture.Verifier.Verify(tampered));
  }

  [Fact]
  public void RejectsSignedRingDwellBelowTheProtectedMinimum()
  {
    var fixture = CreateFixture(healthy: true);
    var command = CreateCommand(
      fixture.Options, fixture.SourceDigest, fixture.RollbackDigest, ring: 25);
    var manifest = JsonSerializer.Deserialize<TrustedUpdateManifest>(command.ManifestJson)!;
    var insufficient = CloneManifest(
      manifest, manifest.DeliveryLeaseId, manifest.DeliveryAttempt,
      minimumRingDwellSeconds: 86_400);

    Assert.Throws<InvalidDataException>(() =>
      fixture.Verifier.Verify(SignManifest(fixture.Options, insufficient)));
  }

  [Fact]
  public async Task RejectsArtifactTamperingBeforeActivation()
  {
    var fixture = CreateFixture(healthy: true);
    SeedOldVersion(fixture);
    var command = CreateCommand(fixture.Options, new string('f', 64), fixture.RollbackDigest);

    var result = await fixture.Engine.ExecuteAsync(command, null, CancellationToken.None);

    Assert.Equal("FAILED", result.Outcome);
    Assert.Equal(VersionPointer("0.9.0", fixture.RollbackDigest),
      File.ReadAllText(fixture.Options.Targets[0].ActivePointerPath).Trim());
  }

  [Fact]
  public async Task LocalKillSwitchStopsNewUpdateWorkBeforeArtifactRead()
  {
    var fixture = CreateFixture(healthy: true);
    SeedOldVersion(fixture);
    File.WriteAllText(fixture.Options.KillSwitchPath, "disabled");
    var command = CreateCommand(fixture.Options, fixture.SourceDigest, fixture.RollbackDigest);

    await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
      fixture.Engine.ExecuteAsync(command, null, CancellationToken.None));
    Assert.Equal(0, fixture.Artifacts.FetchCount);
    Assert.Equal(VersionPointer("0.9.0", fixture.RollbackDigest),
      File.ReadAllText(fixture.Options.Targets[0].ActivePointerPath).Trim());
  }

  [Fact]
  public async Task SignedDeliveryIsAcknowledgedBeforeAnyArtifactRead()
  {
    var fixture = CreateFixture(healthy: true);
    SeedOldVersion(fixture);
    var command = CreateCommand(fixture.Options, fixture.SourceDigest, fixture.RollbackDigest);
    UpdateDeliveryAcknowledgement? observed = null;

    var result = await fixture.Engine.ExecuteAsync(
      command,
      (acknowledgement, _) =>
      {
        Assert.Equal(0, fixture.Artifacts.FetchCount);
        observed = acknowledgement;
        return Task.CompletedTask;
      },
      null,
      CancellationToken.None);

    Assert.Equal("SUCCEEDED", result.Outcome);
    Assert.NotNull(observed);
    Assert.Equal(command.DeliveryLeaseId, observed!.DeliveryLeaseId);
    Assert.Equal(command.ManifestSha256, observed.ManifestSha256);
  }

  [Fact]
  public async Task FailedDeliveryAcknowledgementCannotReadArtifactsOrMutateThePointer()
  {
    var fixture = CreateFixture(healthy: true);
    SeedOldVersion(fixture);
    var before = File.ReadAllText(fixture.Options.Targets[0].ActivePointerPath);
    var command = CreateCommand(fixture.Options, fixture.SourceDigest, fixture.RollbackDigest);

    await Assert.ThrowsAsync<HttpRequestException>(() => fixture.Engine.ExecuteAsync(
      command,
      (_, _) => throw new HttpRequestException("acknowledgement failed"),
      null,
      CancellationToken.None));

    Assert.Equal(0, fixture.Artifacts.FetchCount);
    Assert.Equal(before, File.ReadAllText(fixture.Options.Targets[0].ActivePointerPath));
    Assert.Empty(fixture.Journal.LatestByDeployment());
  }

  [Fact]
  public async Task UnconfirmedApplyingFenceNeverActivatesAndCanResumeFromDurableCommand()
  {
    var fixture = CreateFixture(healthy: true);
    SeedOldVersion(fixture);
    var originalPointer = File.ReadAllText(fixture.Options.Targets[0].ActivePointerPath);
    var command = CreateCommand(fixture.Options, fixture.SourceDigest, fixture.RollbackDigest);

    await Assert.ThrowsAsync<UpdateDeliveryFenceException>(() => fixture.Engine.ExecuteAsync(
      command,
      (_, _) => Task.CompletedTask,
      (_, _) => throw new HttpRequestException("APPLYING response was lost"),
      CancellationToken.None));

    Assert.Equal(0, fixture.Activator.ActivationCount);
    Assert.Equal(0, fixture.Artifacts.FetchAttemptCount);
    Assert.Equal(originalPointer,
      File.ReadAllText(fixture.Options.Targets[0].ActivePointerPath));
    Assert.Equal("FENCE_DEFERRED",
      fixture.Journal.LatestByDeployment()[command.DeploymentId].Phase);

    var result = await fixture.Engine.ExecuteAsync(
      command,
      (_, _) => Task.CompletedTask,
      (_, _) => Task.CompletedTask,
      CancellationToken.None);

    Assert.Equal("SUCCEEDED", result.Outcome);
    Assert.Equal(1, fixture.Activator.ActivationCount);
  }

  [Fact]
  public async Task ApplyingFencePrecedesArtifactReadsAndCanReplayAfterDeliveryExpiry()
  {
    var clock = new AdjustableTimeProvider(DateTimeOffset.UtcNow);
    var fixture = CreateFixture(new FixedHealthProbe(true), verifierTime: clock);
    SeedOldVersion(fixture);
    var command = CreateCommand(fixture.Options, fixture.SourceDigest, fixture.RollbackDigest);
    fixture.Artifacts.NextError = new OperationCanceledException("simulated service stop");
    var firstApplying = false;

    await Assert.ThrowsAsync<OperationCanceledException>(() => fixture.Engine.ExecuteAsync(
      command,
      (_, _) => Task.CompletedTask,
      (progress, _) =>
      {
        Assert.Equal("APPLYING", progress.Status);
        Assert.Equal(0, fixture.Artifacts.FetchAttemptCount);
        firstApplying = true;
        return Task.CompletedTask;
      },
      CancellationToken.None));

    Assert.True(firstApplying);
    Assert.Equal("APPLYING_FENCED",
      fixture.Journal.LatestByDeployment()[command.DeploymentId].Phase);
    Assert.Equal(0, fixture.Activator.ActivationCount);

    clock.Advance(TimeSpan.FromMinutes(20));
    Assert.Throws<InvalidDataException>(() => fixture.Verifier.Verify(command));
    var replayedApplying = false;

    var result = await fixture.Engine.ExecuteAsync(
      command,
      (_, _) => Task.CompletedTask,
      (progress, _) =>
      {
        if (progress.Status == "APPLYING") replayedApplying = true;
        return Task.CompletedTask;
      },
      CancellationToken.None);

    Assert.True(replayedApplying);
    Assert.Equal("SUCCEEDED", result.Outcome);
    Assert.Equal(2, fixture.Artifacts.FetchCount);
    Assert.Equal(1, fixture.Activator.ActivationCount);
  }

  [Fact]
  public async Task ExpiredDeliveryWithoutPersistedApplyingFenceCannotAcknowledgeOrReadArtifacts()
  {
    var clock = new AdjustableTimeProvider(DateTimeOffset.UtcNow);
    var fixture = CreateFixture(new FixedHealthProbe(true), verifierTime: clock);
    var command = CreateCommand(fixture.Options, fixture.SourceDigest, fixture.RollbackDigest);
    var acknowledged = false;
    clock.Advance(TimeSpan.FromMinutes(20));

    await Assert.ThrowsAsync<InvalidDataException>(() => fixture.Engine.ExecuteAsync(
      command,
      (_, _) =>
      {
        acknowledged = true;
        return Task.CompletedTask;
      },
      (_, _) => Task.CompletedTask,
      CancellationToken.None));

    Assert.False(acknowledged);
    Assert.Equal(0, fixture.Artifacts.FetchAttemptCount);
    Assert.Empty(fixture.Journal.LatestByDeployment());
  }

  [Fact]
  public async Task RejectedHealthCheckFenceRestoresSignedRollbackAndNeedsAttention()
  {
    var probe = new FixedHealthProbe(true);
    var fixture = CreateFixture(probe);
    SeedOldVersion(fixture);
    var command = CreateCommand(fixture.Options, fixture.SourceDigest, fixture.RollbackDigest);

    var result = await fixture.Engine.ExecuteAsync(
      command,
      (_, _) => Task.CompletedTask,
      (progress, _) => progress.Status == "HEALTH_CHECK"
        ? throw new HttpRequestException("KILLED rejects health progress")
        : Task.CompletedTask,
      CancellationToken.None);

    Assert.Equal("NEEDS_ATTENTION", result.Outcome);
    Assert.Equal(fixture.RollbackDigest, result.ActivatedArtifactSha256);
    Assert.Equal("0.9.0", result.ObservedVersion);
    Assert.Equal("0.9.0", probe.ExpectedVersions.Single());
    Assert.Equal(2, fixture.Activator.ActivationCount);
    Assert.Equal(VersionPointer("0.9.0", fixture.RollbackDigest),
      File.ReadAllText(fixture.Options.Targets[0].ActivePointerPath).Trim());
  }

  [Fact]
  public void RefusesTargetThatOverlapsProtectedSupervisorRoot()
  {
    var options = Options(Path.Combine(_root, "supervisor", "agent-versions"));
    Assert.Throws<UnauthorizedAccessException>(() => new ImmutableTargetPolicy(options));
  }

  [Fact]
  public void SignedSoakCannotReduceInstallerOwnedMinimum()
  {
    var options = Options(
      Path.Combine(_root, "application", "versions"), minimumHealthySoakSeconds: 5);
    var policy = new ImmutableTargetPolicy(options);

    Assert.Throws<UnauthorizedAccessException>(() =>
      policy.Resolve(options.Targets[0].TargetId, requestedHealthTimeoutSeconds: 30,
        requestedMinimumHealthySoakSeconds: 4));
  }

  [Fact]
  public async Task HealthFailureAutomaticallyRestoresPreviousPointer()
  {
    var probe = new SequencedFixedHealthProbe(false, true);
    var fixture = CreateFixture(probe);
    SeedOldVersion(fixture);
    var command = CreateCommand(fixture.Options, fixture.SourceDigest, fixture.RollbackDigest);

    var result = await fixture.Engine.ExecuteAsync(command, null, CancellationToken.None);

    Assert.Equal("ROLLED_BACK", result.Outcome);
    Assert.Equal(VersionPointer("0.9.0", fixture.RollbackDigest),
      File.ReadAllText(fixture.Options.Targets[0].ActivePointerPath).Trim());
    Assert.Equal("ROLLED_BACK", fixture.Journal.LatestByDeployment()[command.DeploymentId].Phase);
    Assert.Equal(2, fixture.Activator.ActivationCount);
    Assert.Equal(fixture.RollbackDigest, result.ActivatedArtifactSha256);
    Assert.Equal("0.9.0", result.ObservedVersion);
    Assert.Equal(["1.0.0", "0.9.0"], probe.ExpectedVersions);
  }

  [Fact]
  public async Task ReplaysPriorResultWithoutRepeatingArtifactOrPointerMutation()
  {
    var fixture = CreateFixture(healthy: true);
    SeedOldVersion(fixture);
    var command = CreateCommand(fixture.Options, fixture.SourceDigest, fixture.RollbackDigest);

    var first = await fixture.Engine.ExecuteAsync(command, null, CancellationToken.None);
    var pointerWrite = File.GetLastWriteTimeUtc(fixture.Options.Targets[0].ActivePointerPath);
    var second = await fixture.Engine.ExecuteAsync(command, null, CancellationToken.None);

    Assert.Equal(JsonSerializer.Serialize(first), JsonSerializer.Serialize(second));
    Assert.Equal(2, fixture.Artifacts.FetchCount);
    Assert.Equal(1, fixture.Activator.ActivationCount);
    Assert.Equal(pointerWrite, File.GetLastWriteTimeUtc(fixture.Options.Targets[0].ActivePointerPath));
  }

  [Fact]
  public async Task ResignedDeliveryLeaseReturnsStablePriorResultWithoutReexecution()
  {
    var fixture = CreateFixture(healthy: true);
    SeedOldVersion(fixture);
    var firstCommand = CreateCommand(
      fixture.Options, fixture.SourceDigest, fixture.RollbackDigest);
    var firstManifest = JsonSerializer.Deserialize<TrustedUpdateManifest>(firstCommand.ManifestJson)!;
    var secondCommand = ReissueCommand(fixture.Options, firstManifest, deliveryAttempt: 2);
    var acknowledgements = new List<UpdateDeliveryAcknowledgement>();

    var first = await fixture.Engine.ExecuteAsync(
      firstCommand, (ack, _) => { acknowledgements.Add(ack); return Task.CompletedTask; },
      null, CancellationToken.None);
    var second = await fixture.Engine.ExecuteAsync(
      secondCommand, (ack, _) => { acknowledgements.Add(ack); return Task.CompletedTask; },
      null, CancellationToken.None);

    Assert.Equal(JsonSerializer.Serialize(first), JsonSerializer.Serialize(second));
    Assert.Equal(2, acknowledgements.Count);
    Assert.NotEqual(acknowledgements[0].DeliveryLeaseId, acknowledgements[1].DeliveryLeaseId);
    Assert.Equal(2, fixture.Artifacts.FetchCount);
    Assert.Equal(1, fixture.Activator.ActivationCount);
  }

  [Fact]
  public async Task StableIdempotencyKeyRejectsImmutableActionClaimDrift()
  {
    var fixture = CreateFixture(healthy: true);
    SeedOldVersion(fixture);
    var firstCommand = CreateCommand(
      fixture.Options, fixture.SourceDigest, fixture.RollbackDigest);
    var firstManifest = JsonSerializer.Deserialize<TrustedUpdateManifest>(firstCommand.ManifestJson)!;
    await fixture.Engine.ExecuteAsync(firstCommand, null, CancellationToken.None);
    var drifted = CloneManifest(firstManifest,
      deliveryLeaseId: Guid.NewGuid().ToString("D"), deliveryAttempt: 2, version: "2.0.0");
    var driftedCommand = SignManifest(fixture.Options, drifted);
    var acknowledged = false;

    await Assert.ThrowsAsync<InvalidDataException>(() => fixture.Engine.ExecuteAsync(
      driftedCommand,
      (_, _) => { acknowledged = true; return Task.CompletedTask; },
      null,
      CancellationToken.None));

    Assert.False(acknowledged);
    Assert.Equal(2, fixture.Artifacts.FetchCount);
    Assert.Equal(1, fixture.Activator.ActivationCount);
  }

  [Fact]
  public async Task NonterminalJournalRefusesAllNewExecutionUntilRecoveryRuns()
  {
    var fixture = CreateFixture(healthy: true);
    SeedOldVersion(fixture);
    await fixture.Journal.AppendAsync(
      Guid.NewGuid().ToString("D"), new string('a', 64), "PREPARED",
      new Dictionary<string, string?> { ["test"] = "pending" }, CancellationToken.None);
    var command = CreateCommand(fixture.Options, fixture.SourceDigest, fixture.RollbackDigest);
    var acknowledged = false;

    await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Engine.ExecuteAsync(
      command,
      (_, _) => { acknowledged = true; return Task.CompletedTask; },
      null,
      CancellationToken.None));

    Assert.False(acknowledged);
    Assert.Equal(0, fixture.Artifacts.FetchCount);
    Assert.Equal(0, fixture.Activator.ActivationCount);
  }

  [Fact]
  public async Task LostAckAndResultResponsesSurviveRestartWithoutReexecution()
  {
    var fixture = CreateFixture(healthy: true);
    SeedOldVersion(fixture);
    var command = CreateCommand(fixture.Options, fixture.SourceDigest, fixture.RollbackDigest);
    var manifest = fixture.Verifier.Verify(command);
    var pendingRoot = Path.Combine(_root, "durable-pending");
    var outboxRoot = Path.Combine(_root, "durable-outbox");
    var pending = new FilePendingUpdateCommandStore(pendingRoot);
    pending.Put(command, manifest);
    var acknowledgement = new UpdateDeliveryAcknowledgement(
      manifest.DeviceId, manifest.DeploymentId, manifest.DeliveryLeaseId,
      command.ManifestSha256);
    var acknowledgementJson = JsonSerializer.Serialize(acknowledgement);
    var ackId = $"ACK:{manifest.DeploymentId}:{manifest.DeliveryLeaseId}:" +
      command.ManifestSha256;
    using (var firstOutbox = new FileUpdateOutbox(outboxRoot))
    {
      firstOutbox.Enqueue(ackId, "ACK", acknowledgementJson);
      var drained = await firstOutbox.TryDrainAsync(
        (_, _) => throw new HttpRequestException("response was lost after broker receipt"),
        CancellationToken.None);
      Assert.False(drained);
      Assert.Equal(1, firstOutbox.PendingCount);
    }

    using var restartedOutbox = new FileUpdateOutbox(outboxRoot);
    Assert.True(await restartedOutbox.TryDrainAsync(
      (_, _) => Task.CompletedTask, CancellationToken.None));
    var persistedCommand = Assert.Single(
      new FilePendingUpdateCommandStore(pendingRoot).ReadAll());
    var result = await fixture.Engine.ExecuteAsync(
      persistedCommand, (_, _) => Task.CompletedTask, null, CancellationToken.None);
    var resultId = $"RESULT:{result.DeploymentId}:{result.ManifestSha256}:" +
      result.JournalHeadSha256;
    restartedOutbox.Enqueue(resultId, "RESULT", JsonSerializer.Serialize(result));
    pending.RemoveDeployment(result.DeploymentId);
    Assert.False(await restartedOutbox.TryDrainAsync(
      (_, _) => throw new HttpRequestException("result response was lost"),
      CancellationToken.None));

    var restartActivator = new CountingActivator();
    using var restartedEngine = new TrustedUpdateEngine(
      fixture.Options,
      fixture.Verifier,
      new ImmutableTargetPolicy(fixture.Options),
      fixture.Artifacts,
      new FixedHealthProbe(true),
      restartActivator,
      new FileUpdateJournal(fixture.Options.JournalPath),
      new FileUpdateResultStore(fixture.Options.ResultCachePath));
    var restartResults = await restartedEngine.RecoverAsync(CancellationToken.None);

    Assert.Equal(result.Outcome, Assert.Single(restartResults).Outcome);
    Assert.True(await restartedOutbox.TryDrainAsync(
      (_, _) => Task.CompletedTask, CancellationToken.None));
    Assert.Equal(0, restartedOutbox.PendingCount);
    Assert.Empty(new FilePendingUpdateCommandStore(pendingRoot).ReadAll());
    Assert.Equal(1, fixture.Activator.ActivationCount);
    Assert.Equal(0, restartActivator.ActivationCount);
  }

  [Fact]
  public void PendingCommandAdoptsOnlyANewerLeaseForTheSameImmutableAction()
  {
    var fixture = CreateFixture(healthy: true);
    var first = CreateCommand(fixture.Options, fixture.SourceDigest, fixture.RollbackDigest);
    var firstManifest = fixture.Verifier.Verify(first);
    var second = ReissueCommand(fixture.Options, firstManifest, deliveryAttempt: 2);
    var secondManifest = fixture.Verifier.Verify(second);
    var store = new FilePendingUpdateCommandStore(Path.Combine(_root, "lease-adoption"));

    store.Put(first, firstManifest);
    var adoption = store.Put(second, secondManifest);

    Assert.True(adoption.Adopted);
    Assert.Equal(first.ManifestSha256, adoption.SupersededManifestSha256);
    Assert.Equal(second.ManifestSha256, Assert.Single(store.ReadAll()).ManifestSha256);
  }

  [Fact]
  public async Task TerminalResultSupersedesRejectedHealthProgressAfterKill()
  {
    var manifestSha256 = new string('a', 64);
    var deploymentId = Guid.NewGuid().ToString("D");
    var leaseId = Guid.NewGuid().ToString("D");
    using var outbox = new FileUpdateOutbox(Path.Combine(_root, "kill-terminal-outbox"));
    outbox.Enqueue(
      $"PROGRESS:{deploymentId}:{leaseId}:{manifestSha256}:HEALTH_CHECK:{new string('b', 64)}",
      "PROGRESS",
      "{\"status\":\"HEALTH_CHECK\"}");
    Assert.False(await outbox.TryDrainAsync(
      (_, _) => throw new HttpRequestException("KILLED rejects progress"),
      CancellationToken.None));

    outbox.DiscardDeliveryAttempt(manifestSha256);
    outbox.Enqueue(
      $"RESULT:{deploymentId}:{manifestSha256}:{new string('c', 64)}",
      "RESULT",
      "{\"outcome\":\"NEEDS_ATTENTION\"}");
    var deliveredKinds = new List<string>();

    Assert.True(await outbox.TryDrainAsync(
      (record, _) => { deliveredKinds.Add(record.Kind); return Task.CompletedTask; },
      CancellationToken.None));
    Assert.Equal(["RESULT"], deliveredKinds);
    Assert.Equal(0, outbox.PendingCount);
  }

  [Fact]
  public async Task UnrelatedRejectedProgressCannotHeadOfLineBlockATerminalResult()
  {
    using var outbox = new FileUpdateOutbox(Path.Combine(_root, "independent-outbox"));
    var progressManifest = new string('a', 64);
    var resultManifest = new string('b', 64);
    var progressId = $"PROGRESS:{Guid.NewGuid():D}:{Guid.NewGuid():D}:" +
      $"{progressManifest}:HEALTH_CHECK:{new string('c', 64)}";
    var resultId = $"RESULT:{Guid.NewGuid():D}:{resultManifest}:{new string('d', 64)}";
    outbox.Enqueue(progressId, "PROGRESS", "{\"status\":\"HEALTH_CHECK\"}");
    outbox.Enqueue(resultId, "RESULT", "{\"outcome\":\"NEEDS_ATTENTION\"}");
    var delivered = new List<string>();

    var completelyDrained = await outbox.TryDrainAsync(
      (record, _) => record.Kind == "PROGRESS"
        ? throw new HttpRequestException("progress is rejected")
        : AddDeliveredAsync(record),
      CancellationToken.None);

    Assert.False(completelyDrained);
    Assert.Equal(["RESULT"], delivered);
    Assert.True(outbox.Contains(progressId));
    Assert.False(outbox.Contains(resultId));

    Task AddDeliveredAsync(UpdateOutboxRecord record)
    {
      delivered.Add(record.Kind);
      return Task.CompletedTask;
    }
  }

  [Fact]
  public async Task SuccessfulCanaryCommitsExactSignedArtifact()
  {
    var fixture = CreateFixture(healthy: true);
    SeedOldVersion(fixture);
    var command = CreateCommand(fixture.Options, fixture.SourceDigest, fixture.RollbackDigest, ring: 0);

    var result = await fixture.Engine.ExecuteAsync(command, null, CancellationToken.None);

    Assert.Equal("SUCCEEDED", result.Outcome);
    Assert.Equal(fixture.SourceDigest, result.ActivatedArtifactSha256);
    Assert.StartsWith("1.0.0-", File.ReadAllText(fixture.Options.Targets[0].ActivePointerPath).Trim(),
      StringComparison.Ordinal);
    Assert.Equal("COMMITTED", fixture.Journal.LatestByDeployment()[command.DeploymentId].Phase);
    Assert.Equal(1, fixture.Activator.ActivationCount);
  }

  [Fact]
  public async Task ExplicitRollbackMustSoakTheSignedRollbackVersion()
  {
    var probe = new FixedHealthProbe(true);
    var fixture = CreateFixture(probe);
    var target = fixture.Options.Targets[0];
    var sourcePointer = SeedVersion(target, "1.0.0", fixture.SourceDigest);
    Directory.CreateDirectory(Path.GetDirectoryName(target.ActivePointerPath)!);
    File.WriteAllText(target.ActivePointerPath, sourcePointer);
    var command = CreateCommand(
      fixture.Options, fixture.SourceDigest, fixture.RollbackDigest,
      operation: "ROLLBACK");

    var result = await fixture.Engine.ExecuteAsync(command, null, CancellationToken.None);

    Assert.Equal("ROLLED_BACK", result.Outcome);
    Assert.Equal(fixture.RollbackDigest, result.ActivatedArtifactSha256);
    Assert.Equal("0.9.0", result.ObservedVersion);
    Assert.Equal("0.9.0", probe.ExpectedVersions.Single());
    Assert.Equal(VersionPointer("0.9.0", fixture.RollbackDigest),
      File.ReadAllText(target.ActivePointerPath).Trim());
  }

  [Fact]
  public async Task UnsignedPreviousVersionIsNeverReportedAsTheSignedRollback()
  {
    var probe = new SequencedFixedHealthProbe(false, true);
    var fixture = CreateFixture(probe);
    var target = fixture.Options.Targets[0];
    var unrelatedDigest = new string('d', 64);
    var unrelatedPointer = SeedVersion(target, "0.8.0", unrelatedDigest);
    Directory.CreateDirectory(Path.GetDirectoryName(target.ActivePointerPath)!);
    File.WriteAllText(target.ActivePointerPath, unrelatedPointer);
    var command = CreateCommand(fixture.Options, fixture.SourceDigest, fixture.RollbackDigest);

    var result = await fixture.Engine.ExecuteAsync(command, null, CancellationToken.None);

    Assert.Equal("ROLLED_BACK", result.Outcome);
    Assert.Equal(fixture.RollbackDigest, result.ActivatedArtifactSha256);
    Assert.Equal("0.9.0", result.ObservedVersion);
    Assert.Equal(VersionPointer("0.9.0", fixture.RollbackDigest),
      File.ReadAllText(target.ActivePointerPath).Trim());
    Assert.DoesNotContain("0.8.0", probe.ExpectedVersions);
  }

  [Fact]
  public async Task NonIoRestorationExceptionPersistsIdempotentNeedsAttention()
  {
    var health = new ThrowOnceHealthProbe(new FormatException("invalid health payload"));
    var activator = new CountingActivator(
      null,
      new InvalidOperationException("service restart state is uncertain"));
    var fixture = CreateFixture(health, activator);
    SeedOldVersion(fixture);
    var command = CreateCommand(fixture.Options, fixture.SourceDigest, fixture.RollbackDigest);

    var first = await fixture.Engine.ExecuteAsync(command, null, CancellationToken.None);
    var second = await fixture.Engine.ExecuteAsync(command, null, CancellationToken.None);

    Assert.Equal("NEEDS_ATTENTION", first.Outcome);
    Assert.Equal(JsonSerializer.Serialize(first), JsonSerializer.Serialize(second));
    Assert.Equal("NEEDS_ATTENTION",
      fixture.Journal.LatestByDeployment()[command.DeploymentId].Phase);
    Assert.Equal(2, fixture.Activator.ActivationCount);
    Assert.Contains("InvalidOperationException", first.Reason ?? string.Empty,
      StringComparison.Ordinal);
  }

  [Fact]
  public async Task TerminalReasonsAreSanitizedBoundedAndStableAcrossReplay()
  {
    var unsafeReason = "  failed\r\n\0\u202E" + new string('x', 2_500);
    var fixture = CreateFixture(new ReasonThenHealthyProbe(unsafeReason));
    SeedOldVersion(fixture);
    var command = CreateCommand(fixture.Options, fixture.SourceDigest, fixture.RollbackDigest);

    var first = await fixture.Engine.ExecuteAsync(command, null, CancellationToken.None);
    var second = await fixture.Engine.ExecuteAsync(command, null, CancellationToken.None);

    Assert.Equal("ROLLED_BACK", first.Outcome);
    Assert.NotNull(first.Reason);
    Assert.Equal(UpdateTerminalReason.MaximumLength, first.Reason!.Length);
    Assert.EndsWith(UpdateTerminalReason.TruncationMarker, first.Reason,
      StringComparison.Ordinal);
    Assert.DoesNotContain(first.Reason, char.IsControl);
    Assert.DoesNotContain('\u202E', first.Reason);
    Assert.Equal(first.Reason, second.Reason);
    Assert.Equal(first.Reason,
      fixture.Journal.LatestByDeployment()[command.DeploymentId].Data["reason"]);
    Assert.Equal(first.Reason, UpdateTerminalReason.Normalize(unsafeReason));
  }

  [Fact]
  public async Task CrashRecoveryRollsBackInsteadOfResettingOrShorteningSignedSoak()
  {
    var fixture = CreateFixture(healthy: true);
    var target = fixture.Options.Targets[0];
    var rollbackPointer = SeedVersion(target, "0.9.0", fixture.RollbackDigest);
    var sourcePointer = SeedVersion(target, "1.0.0", fixture.SourceDigest);
    Directory.CreateDirectory(Path.GetDirectoryName(target.ActivePointerPath)!);
    File.WriteAllText(target.ActivePointerPath, sourcePointer);
    var deploymentId = Guid.NewGuid().ToString("D");
    var manifestDigest = new string('a', 64);
    var data = new Dictionary<string, string?>
    {
      ["deviceId"] = fixture.Options.DeviceId,
      ["targetId"] = target.TargetId,
      ["operation"] = "APPLY",
      ["idempotencyKey"] = new string('b', 64),
      ["actionClaimsSha256"] = new string('c', 64),
      ["healthTimeoutSeconds"] = "30",
      ["minimumHealthySoakSeconds"] = "5",
      ["preActionPointer"] = rollbackPointer,
      ["previousPointer"] = rollbackPointer,
      ["previousVersion"] = "0.9.0",
      ["previousArtifactSha256"] = fixture.RollbackDigest,
      ["nextPointer"] = sourcePointer,
      ["nextVersion"] = "1.0.0",
      ["nextArtifactSha256"] = fixture.SourceDigest,
      ["rollbackPointer"] = rollbackPointer,
      ["rollbackVersion"] = "0.9.0",
      ["rollbackArtifactSha256"] = fixture.RollbackDigest,
    };
    await fixture.Journal.AppendAsync(deploymentId, manifestDigest, "PREPARED", data,
      CancellationToken.None);
    await fixture.Journal.AppendAsync(deploymentId, manifestDigest, "ACTIVATED", data,
      CancellationToken.None);
    File.AppendAllText(fixture.Options.JournalPath, "{\"interrupted\":", Encoding.UTF8);
    var reopenedJournal = new FileUpdateJournal(fixture.Options.JournalPath);
    var healthProbe = new FixedHealthProbe(true);
    using var recoveredEngine = new TrustedUpdateEngine(
      fixture.Options,
      fixture.Verifier,
      new ImmutableTargetPolicy(fixture.Options),
      fixture.Artifacts,
      healthProbe,
      new NoopActivator(),
      reopenedJournal,
      new FileUpdateResultStore(fixture.Options.ResultCachePath));

    var recovered = await recoveredEngine.RecoverAsync(CancellationToken.None);

    Assert.Single(recovered);
    Assert.Equal("ROLLED_BACK", recovered[0].Outcome);
    Assert.Equal(rollbackPointer, File.ReadAllText(target.ActivePointerPath).Trim());
    var recoveredEntry = reopenedJournal.LatestByDeployment()[deploymentId];
    Assert.Equal("RECOVERED_ROLLBACK", recoveredEntry.Phase);
    Assert.Equal("5", recoveredEntry.Data["minimumHealthySoakSeconds"]);
    Assert.Equal(1, healthProbe.CallCount);
    Assert.Equal(TimeSpan.FromSeconds(5), healthProbe.MinimumSoaks.Single());
    Assert.Equal("0.9.0", healthProbe.ExpectedVersions.Single());
  }

  [Fact]
  public async Task CrashRestorationHealthFailureBecomesNeedsAttention()
  {
    var fixture = CreateFixture(healthy: true);
    var target = fixture.Options.Targets[0];
    var rollbackPointer = SeedVersion(target, "0.9.0", fixture.RollbackDigest);
    var sourcePointer = SeedVersion(target, "1.0.0", fixture.SourceDigest);
    Directory.CreateDirectory(Path.GetDirectoryName(target.ActivePointerPath)!);
    File.WriteAllText(target.ActivePointerPath, sourcePointer);
    var deploymentId = Guid.NewGuid().ToString("D");
    var data = InterruptedActivationData(
      fixture, target, sourcePointer, rollbackPointer, minimumHealthySoakSeconds: 1);
    await fixture.Journal.AppendAsync(
      deploymentId, new string('a', 64), "ACTIVATED", data, CancellationToken.None);
    var healthProbe = new FixedHealthProbe(false);
    using var recoveredEngine = new TrustedUpdateEngine(
      fixture.Options,
      fixture.Verifier,
      new ImmutableTargetPolicy(fixture.Options),
      fixture.Artifacts,
      healthProbe,
      new NoopActivator(),
      fixture.Journal,
      new FileUpdateResultStore(Path.Combine(_root, "crash-failure-results")));

    var recovered = await recoveredEngine.RecoverAsync(CancellationToken.None);

    Assert.Single(recovered);
    Assert.Equal("NEEDS_ATTENTION", recovered[0].Outcome);
    Assert.Equal("NEEDS_ATTENTION",
      fixture.Journal.LatestByDeployment()[deploymentId].Phase);
    Assert.Equal(1, healthProbe.CallCount);
  }

  [Fact]
  public async Task ExactSignedVersionMustRemainHealthyForTheContinuousSoak()
  {
    var handler = new SequencedHealthHandler(
      HealthResponse(HttpStatusCode.OK, "1.0.0"),
      HealthResponse(HttpStatusCode.OK, "1.0.0"));
    var probe = new ConfiguredUpdateHealthProbe(new HttpClient(handler));
    var target = HttpHealthTarget();
    var stopwatch = Stopwatch.StartNew();

    var result = await probe.WaitForHealthyAsync(
      target, _root, "1.0.0", TimeSpan.FromSeconds(3), TimeSpan.FromSeconds(1),
      CancellationToken.None);

    stopwatch.Stop();
    Assert.True(result.Healthy);
    Assert.Equal("1.0.0", result.ObservedVersion);
    Assert.True(Assert.IsType<int>(result.Metrics["healthyProbeCount"]) >= 2);
    Assert.True(Assert.IsType<double>(result.Metrics["continuousHealthySeconds"]) >= 1);
    Assert.Matches("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$",
      Assert.IsType<string>(result.Metrics["healthySince"]));
    Assert.Matches("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$",
      Assert.IsType<string>(result.Metrics["healthyThrough"]));
    Assert.True(stopwatch.Elapsed >= TimeSpan.FromSeconds(1));
  }

  [Fact]
  public async Task HealthRegressionDuringSoakFailsImmediately()
  {
    var handler = new SequencedHealthHandler(
      HealthResponse(HttpStatusCode.OK, "1.0.0"),
      HealthResponse(HttpStatusCode.OK, "0.9.0"));
    var probe = new ConfiguredUpdateHealthProbe(new HttpClient(handler));
    var stopwatch = Stopwatch.StartNew();

    var result = await probe.WaitForHealthyAsync(
      HttpHealthTarget(), _root, "1.0.0", TimeSpan.FromSeconds(5),
      TimeSpan.FromSeconds(3), CancellationToken.None);

    stopwatch.Stop();
    Assert.False(result.Healthy);
    Assert.Contains("regressed", result.Reason ?? string.Empty,
      StringComparison.OrdinalIgnoreCase);
    Assert.Equal("0.9.0", result.ObservedVersion);
    Assert.Equal(2, handler.RequestCount);
    Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(4));
  }

  [Fact]
  public async Task WrongObservedVersionNeverStartsAHealthySoak()
  {
    var handler = new SequencedHealthHandler(
      HealthResponse(HttpStatusCode.OK, "0.9.0"),
      HealthResponse(HttpStatusCode.OK, "0.9.0"));
    var probe = new ConfiguredUpdateHealthProbe(new HttpClient(handler));

    var result = await probe.WaitForHealthyAsync(
      HttpHealthTarget(), _root, "1.0.0", TimeSpan.FromMilliseconds(1_200),
      TimeSpan.FromSeconds(1), CancellationToken.None);

    Assert.False(result.Healthy);
    Assert.Equal("0.9.0", result.ObservedVersion);
    Assert.Equal(0, Assert.IsType<int>(result.Metrics["healthyProbeCount"]));
    Assert.Contains("signed version", result.Reason ?? string.Empty,
      StringComparison.OrdinalIgnoreCase);
  }

  [Fact]
  public async Task AProbeThatIgnoresCancellationCannotExceedTheSignedDeadline()
  {
    var probe = new ConfiguredUpdateHealthProbe(
      new HttpClient(new NeverCompletingHealthHandler()));
    var stopwatch = Stopwatch.StartNew();

    var result = await probe.WaitForHealthyAsync(
      HttpHealthTarget(), _root, "1.0.0", TimeSpan.FromMilliseconds(250),
      TimeSpan.FromMilliseconds(100), CancellationToken.None);

    stopwatch.Stop();
    Assert.False(result.Healthy);
    Assert.True(Assert.IsType<bool>(result.Metrics["probeDeadlineExceeded"]));
    Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(2));
  }

  [Fact]
  public async Task WallClockRegressionCannotShortenTheMonotonicHealthySoak()
  {
    var handler = new SequencedHealthHandler(
      HealthResponse(HttpStatusCode.OK, "1.0.0"),
      HealthResponse(HttpStatusCode.OK, "1.0.0"));
    var probe = new ConfiguredUpdateHealthProbe(
      new HttpClient(handler), new RegressingWallClockTimeProvider());

    var result = await probe.WaitForHealthyAsync(
      HttpHealthTarget(), _root, "1.0.0", TimeSpan.FromSeconds(3),
      TimeSpan.FromSeconds(1), CancellationToken.None);

    Assert.True(result.Healthy);
    Assert.True(Assert.IsType<double>(result.Metrics["continuousHealthySeconds"]) >= 1);
    var since = DateTimeOffset.Parse(
      Assert.IsType<string>(result.Metrics["healthySince"]),
      System.Globalization.CultureInfo.InvariantCulture);
    var through = DateTimeOffset.Parse(
      Assert.IsType<string>(result.Metrics["healthyThrough"]),
      System.Globalization.CultureInfo.InvariantCulture);
    Assert.True(through - since >= TimeSpan.FromSeconds(1));
  }

  private Fixture CreateFixture(bool healthy) => CreateFixture(new FixedHealthProbe(healthy));

  private Fixture CreateFixture(
    IUpdateHealthProbe health,
    CountingActivator? configuredActivator = null,
    TimeProvider? verifierTime = null)
  {
    var versions = Path.Combine(_root, "application", "versions");
    var options = Options(versions);
    Directory.CreateDirectory(options.SupervisorRoot);
    var publicKeyPath = options.PinnedBootstrapPublicKeyPath;
    File.WriteAllText(publicKeyPath, _signingKey.ExportSubjectPublicKeyInfoPem());
    var source = ZipBytes(("app.txt", "new"), ("health.ready", "ready"));
    var rollback = ZipBytes(("app.txt", "old"), ("health.ready", "ready"));
    var sourceDigest = Sha256(source);
    var rollbackDigest = Sha256(rollback);
    var artifacts = new MemoryArtifactProvider(source, rollback);
    var verifier = new ManifestVerifier(options, verifierTime);
    var policy = new ImmutableTargetPolicy(options);
    var journal = new FileUpdateJournal(options.JournalPath);
    var results = new FileUpdateResultStore(options.ResultCachePath);
    var activator = configuredActivator ?? new CountingActivator();
    var engine = new TrustedUpdateEngine(options, verifier, policy, artifacts,
      health, activator, journal, results);
    return new Fixture(
      options, verifier, journal, artifacts, activator, engine, sourceDigest, rollbackDigest);
  }

  private UpdateSupervisorOptions Options(
    string versionsRoot,
    int minimumHealthySoakSeconds = 1)
  {
    var supervisor = Path.Combine(_root, "supervisor");
    var publicDigest = Sha256(_signingKey.ExportSubjectPublicKeyInfo());
    return new UpdateSupervisorOptions
    {
      DeviceId = "11111111-1111-4111-8111-111111111111",
      BrokerBaseUri = "https://example.invalid/api/v1/",
      SupervisorRoot = supervisor,
      JournalPath = Path.Combine(supervisor, "journal.jsonl"),
      ResultCachePath = Path.Combine(supervisor, "results"),
      KillSwitchPath = Path.Combine(supervisor, "DISABLED"),
      PinnedBootstrapPublicKeyPath = Path.Combine(supervisor, "bootstrap-public.pem"),
      PinnedBootstrapPublicKeySha256 = publicDigest,
      BootstrapKeyId = "bootstrap-test",
      ProtectedRoots = [supervisor],
      Targets =
      [
        new UpdateTargetOptions
        {
          TargetId = "itemba.msaidizi.application",
          VersionsRoot = versionsRoot,
          ActivePointerPath = Path.Combine(_root, "application", "active.txt"),
          HealthProbeRelativePath = "health.ready",
          ExpectedHealthContent = "ready",
          RequireObservedVersion = false,
          MaxHealthTimeoutSeconds = 300,
          MinimumHealthySoakSeconds = minimumHealthySoakSeconds,
          HealthProbeIntervalSeconds = 1,
        },
      ],
    };
  }

  private SignedUpdateCommand CreateCommand(
    UpdateSupervisorOptions options,
    string sourceDigest,
    string rollbackDigest,
    int ring = 0,
    string operation = "APPLY",
    string? deploymentId = null,
    string? candidateId = null,
    string? deliveryLeaseId = null,
    int deliveryAttempt = 1,
    string? idempotencyKey = null,
    string version = "1.0.0",
    string rollbackVersion = "0.9.0")
  {
    deploymentId ??= Guid.NewGuid().ToString("D");
    deliveryLeaseId ??= Guid.NewGuid().ToString("D");
    var manifest = new TrustedUpdateManifest
    {
      SchemaVersion = 2,
      DeploymentId = deploymentId,
      CandidateId = candidateId ?? Guid.NewGuid().ToString("D"),
      DeviceId = options.DeviceId,
      Operation = operation,
      Ring = ring,
      TargetId = options.Targets[0].TargetId,
      Version = version,
      SourceArtifactSha256 = sourceDigest,
      RollbackArtifactSha256 = rollbackDigest,
      RollbackVersion = rollbackVersion,
      DeliveryLeaseId = deliveryLeaseId,
      DeliveryAttempt = deliveryAttempt,
      HealthTimeoutSeconds = 30,
      MinimumHealthySoakSeconds = 1,
      MinimumRingDwellSeconds = RequiredRingDwellSeconds(ring),
      IssuedAt = DateTimeOffset.UtcNow.AddSeconds(-5),
      ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(10),
      IdempotencyKey = idempotencyKey ?? Sha256(Encoding.UTF8.GetBytes(deploymentId)),
    };
    return SignManifest(options, manifest);
  }

  private SignedUpdateCommand ReissueCommand(
    UpdateSupervisorOptions options,
    TrustedUpdateManifest manifest,
    int deliveryAttempt) => SignManifest(
      options,
      CloneManifest(
        manifest,
        Guid.NewGuid().ToString("D"),
        deliveryAttempt));

  private static TrustedUpdateManifest CloneManifest(
    TrustedUpdateManifest manifest,
    string deliveryLeaseId,
    int deliveryAttempt,
    string? version = null,
    int? minimumRingDwellSeconds = null) => new()
    {
      SchemaVersion = manifest.SchemaVersion,
      DeploymentId = manifest.DeploymentId,
      CandidateId = manifest.CandidateId,
      DeviceId = manifest.DeviceId,
      Operation = manifest.Operation,
      Ring = manifest.Ring,
      TargetId = manifest.TargetId,
      Version = version ?? manifest.Version,
      SourceArtifactSha256 = manifest.SourceArtifactSha256,
      RollbackArtifactSha256 = manifest.RollbackArtifactSha256,
      RollbackVersion = manifest.RollbackVersion,
      DeliveryLeaseId = deliveryLeaseId,
      DeliveryAttempt = deliveryAttempt,
      HealthTimeoutSeconds = manifest.HealthTimeoutSeconds,
      MinimumHealthySoakSeconds = manifest.MinimumHealthySoakSeconds,
      MinimumRingDwellSeconds =
        minimumRingDwellSeconds ?? manifest.MinimumRingDwellSeconds,
      IssuedAt = DateTimeOffset.UtcNow.AddSeconds(-1),
      ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(10),
      IdempotencyKey = manifest.IdempotencyKey,
    };

  private static int RequiredRingDwellSeconds(int ring) => ring switch
  {
    0 or 5 => 86_400,
    25 => 172_800,
    100 => 259_200,
    _ => throw new ArgumentOutOfRangeException(nameof(ring)),
  };

  private SignedUpdateCommand SignManifest(
    UpdateSupervisorOptions options,
    TrustedUpdateManifest manifest)
  {
    var json = JsonSerializer.Serialize(manifest);
    var signature = _signingKey.SignData(
      Encoding.UTF8.GetBytes(json), HashAlgorithmName.SHA256,
      DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
    return new SignedUpdateCommand(
      manifest.DeploymentId, manifest.DeliveryLeaseId, json,
      Sha256(Encoding.UTF8.GetBytes(json)), Base64Url(signature),
      options.BootstrapKeyId);
  }

  private static void SeedOldVersion(Fixture fixture)
  {
    var target = fixture.Options.Targets[0];
    var pointer = SeedVersion(target, "0.9.0", fixture.RollbackDigest);
    Directory.CreateDirectory(Path.GetDirectoryName(target.ActivePointerPath)!);
    File.WriteAllText(target.ActivePointerPath, pointer);
  }

  private static string SeedVersion(
    UpdateTargetOptions target,
    string version,
    string digest)
  {
    var pointer = VersionPointer(version, digest);
    var directory = Path.Combine(target.VersionsRoot, pointer);
    Directory.CreateDirectory(directory);
    File.WriteAllText(Path.Combine(directory, ".msaidizi-package.sha256"), digest);
    File.WriteAllText(Path.Combine(directory, ".msaidizi-package.version"), version);
    File.WriteAllText(Path.Combine(directory, "health.ready"), "ready");
    return pointer;
  }

  private static string VersionPointer(string version, string digest) =>
    $"{version}-{digest[..16]}";

  private static Dictionary<string, string?> InterruptedActivationData(
    Fixture fixture,
    UpdateTargetOptions target,
    string sourcePointer,
    string rollbackPointer,
    int minimumHealthySoakSeconds) => new(StringComparer.Ordinal)
    {
      ["deviceId"] = fixture.Options.DeviceId,
      ["targetId"] = target.TargetId,
      ["operation"] = "APPLY",
      ["idempotencyKey"] = new string('b', 64),
      ["actionClaimsSha256"] = new string('c', 64),
      ["healthTimeoutSeconds"] = "30",
      ["minimumHealthySoakSeconds"] =
        minimumHealthySoakSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture),
      ["preActionPointer"] = rollbackPointer,
      ["previousPointer"] = rollbackPointer,
      ["previousVersion"] = "0.9.0",
      ["previousArtifactSha256"] = fixture.RollbackDigest,
      ["nextPointer"] = sourcePointer,
      ["nextVersion"] = "1.0.0",
      ["nextArtifactSha256"] = fixture.SourceDigest,
      ["rollbackPointer"] = rollbackPointer,
      ["rollbackVersion"] = "0.9.0",
      ["rollbackArtifactSha256"] = fixture.RollbackDigest,
    };

  private static byte[] ZipBytes(params (string Name, string Content)[] files)
  {
    using var stream = new MemoryStream();
    using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
      foreach (var (name, content) in files)
      {
        var entry = archive.CreateEntry(name);
        using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
        writer.Write(content);
      }
    return stream.ToArray();
  }

  private static string Sha256(byte[] value) =>
    Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();

  private static string Base64Url(byte[] value) =>
    Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

  private UpdateTargetOptions HttpHealthTarget() => new()
  {
    TargetId = "itemba.msaidizi.application",
    VersionsRoot = Path.Combine(_root, "http-health", "versions"),
    ActivePointerPath = Path.Combine(_root, "http-health", "active.txt"),
    HealthProbeUri = "https://127.0.0.1:7443/health",
    RequireObservedVersion = true,
    ObservedVersionHeaderName = "X-Itemba-Version",
    MaxHealthTimeoutSeconds = 30,
    MinimumHealthySoakSeconds = 1,
    HealthProbeIntervalSeconds = 1,
  };

  private static HttpResponseMessage HealthResponse(HttpStatusCode status, string version)
  {
    var response = new HttpResponseMessage(status);
    response.Headers.Add("X-Itemba-Version", version);
    return response;
  }

  public void Dispose()
  {
    _signingKey.Dispose();
    if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
  }

  private sealed record Fixture(
    UpdateSupervisorOptions Options,
    ManifestVerifier Verifier,
    FileUpdateJournal Journal,
    MemoryArtifactProvider Artifacts,
    CountingActivator Activator,
    TrustedUpdateEngine Engine,
    string SourceDigest,
    string RollbackDigest);

  private sealed class MemoryArtifactProvider(byte[] source, byte[] rollback) : IUpdateArtifactProvider
  {
    public int FetchCount { get; private set; }
    public int FetchAttemptCount { get; private set; }
    public Exception? NextError { get; set; }

    public Task FetchAsync(TrustedUpdateManifest manifest, string role, string destination,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      FetchAttemptCount++;
      if (NextError is { } error)
      {
        NextError = null;
        throw error;
      }
      File.WriteAllBytes(destination, role == "source" ? source : rollback);
      FetchCount++;
      return Task.CompletedTask;
    }
  }

  private sealed class FixedHealthProbe(bool healthy) : IUpdateHealthProbe
  {
    public int CallCount { get; private set; }
    public List<string> ExpectedVersions { get; } = [];
    public List<TimeSpan> MinimumSoaks { get; } = [];

    public Task<HealthProbeResult> WaitForHealthyAsync(UpdateTargetOptions target,
      string activeVersionDirectory, string expectedVersion, TimeSpan timeout,
      TimeSpan minimumHealthySoak, CancellationToken cancellationToken)
    {
      CallCount++;
      ExpectedVersions.Add(expectedVersion);
      MinimumSoaks.Add(minimumHealthySoak);
      return Task.FromResult(new HealthProbeResult(healthy,
        new Dictionary<string, object?> { ["test"] = true },
        healthy ? null : "test failure", expectedVersion));
    }
  }

  private sealed class SequencedFixedHealthProbe(params bool[] outcomes) : IUpdateHealthProbe
  {
    private int _calls;
    public List<string> ExpectedVersions { get; } = [];

    public Task<HealthProbeResult> WaitForHealthyAsync(UpdateTargetOptions target,
      string activeVersionDirectory, string expectedVersion, TimeSpan timeout,
      TimeSpan minimumHealthySoak, CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      ExpectedVersions.Add(expectedVersion);
      var healthy = outcomes[Math.Min(_calls++, outcomes.Length - 1)];
      return Task.FromResult(new HealthProbeResult(
        healthy,
        new Dictionary<string, object?> { ["test"] = true },
        healthy ? null : "test failure",
        expectedVersion));
    }
  }

  private sealed class ReasonThenHealthyProbe(string reason) : IUpdateHealthProbe
  {
    private int _calls;

    public Task<HealthProbeResult> WaitForHealthyAsync(UpdateTargetOptions target,
      string activeVersionDirectory, string expectedVersion, TimeSpan timeout,
      TimeSpan minimumHealthySoak, CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      var healthy = Interlocked.Increment(ref _calls) > 1;
      return Task.FromResult(new HealthProbeResult(
        healthy,
        new Dictionary<string, object?> { ["test"] = true },
        healthy ? null : reason,
        expectedVersion));
    }
  }

  private sealed class ThrowOnceHealthProbe(Exception firstError) : IUpdateHealthProbe
  {
    private int _calls;

    public Task<HealthProbeResult> WaitForHealthyAsync(UpdateTargetOptions target,
      string activeVersionDirectory, string expectedVersion, TimeSpan timeout,
      TimeSpan minimumHealthySoak, CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      if (Interlocked.Increment(ref _calls) == 1) throw firstError;
      return Task.FromResult(new HealthProbeResult(
        true, new Dictionary<string, object?> { ["test"] = true }, null, expectedVersion));
    }
  }

  private sealed class SequencedHealthHandler(params HttpResponseMessage[] responses)
    : HttpMessageHandler
  {
    private int _requestCount;
    public int RequestCount => Volatile.Read(ref _requestCount);

    protected override Task<HttpResponseMessage> SendAsync(
      HttpRequestMessage request,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      var index = Interlocked.Increment(ref _requestCount) - 1;
      var selected = responses[Math.Min(index, responses.Length - 1)];
      return Task.FromResult(Clone(selected));
    }

    private static HttpResponseMessage Clone(HttpResponseMessage source)
    {
      var response = new HttpResponseMessage(source.StatusCode);
      foreach (var header in source.Headers)
        response.Headers.TryAddWithoutValidation(header.Key, header.Value);
      return response;
    }
  }

  private sealed class NeverCompletingHealthHandler : HttpMessageHandler
  {
    protected override Task<HttpResponseMessage> SendAsync(
      HttpRequestMessage request,
      CancellationToken cancellationToken) =>
      new TaskCompletionSource<HttpResponseMessage>(
        TaskCreationOptions.RunContinuationsAsynchronously).Task;
  }

  private sealed class RegressingWallClockTimeProvider : TimeProvider
  {
    private int _reads;

    public override DateTimeOffset GetUtcNow() =>
      DateTimeOffset.UtcNow.AddDays(-Interlocked.Increment(ref _reads));
  }

  private sealed class AdjustableTimeProvider(DateTimeOffset initial) : TimeProvider
  {
    private DateTimeOffset _now = initial;

    public override DateTimeOffset GetUtcNow() => _now;

    public void Advance(TimeSpan duration) => _now = _now.Add(duration);
  }

  private sealed class NoopActivator : IUpdateTargetActivator
  {
    public Task ActivateAsync(UpdateTargetOptions target, CancellationToken cancellationToken) =>
      Task.CompletedTask;
  }

  private sealed class CountingActivator(params Exception?[] errors) : IUpdateTargetActivator
  {
    public int ActivationCount { get; private set; }

    public Task ActivateAsync(UpdateTargetOptions target, CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      ActivationCount++;
      var error = errors.ElementAtOrDefault(ActivationCount - 1);
      if (error is not null) throw error;
      return Task.CompletedTask;
    }
  }

  private sealed class RecordingHandler : HttpMessageHandler
  {
    public HttpMethod? Method { get; private set; }
    public string? Path { get; private set; }
    public string? Body { get; private set; }

    protected override async Task<HttpResponseMessage> SendAsync(
      HttpRequestMessage request,
      CancellationToken cancellationToken)
    {
      Method = request.Method;
      Path = request.RequestUri?.AbsolutePath;
      Body = request.Content is null
        ? null
        : await request.Content.ReadAsStringAsync(cancellationToken);
      return new HttpResponseMessage(HttpStatusCode.OK);
    }
  }
}
