using System.Security.Cryptography;
using System.Net;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.RecoverySupervisor.Channel;
using Itemba.Msaidizi.RecoverySupervisor.Configuration;
using Itemba.Msaidizi.RecoverySupervisor.Contracts;
using Itemba.Msaidizi.RecoverySupervisor.Execution;
using Itemba.Msaidizi.RecoverySupervisor.Journal;
using Itemba.Msaidizi.RecoverySupervisor.Security;
using Xunit;

namespace Itemba.Msaidizi.RecoverySupervisor.Tests;

public sealed class TrustedRecoverySupervisorTests : IDisposable
{
  private readonly string _root = Path.Combine(
    Path.GetTempPath(),
    "msaidizi-recovery-supervisor-tests",
    Guid.NewGuid().ToString("N"));
  private readonly ECDsa _signingKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);

  [Fact]
  public async Task EnrollmentUsesDedicatedRecoveryRoleAndOneTimeChallenge()
  {
    var handler = new RecordingHandler();
    var client = new RecoveryBrokerClient(new HttpClient(handler)
    {
      BaseAddress = new Uri("https://itemba.invalid/api/v1/"),
    });

    await client.EnrollAsync("device-2", "enrollment-2", "one-time-code", CancellationToken.None);

    Assert.Equal(HttpMethod.Post, handler.Method);
    Assert.Equal(
      "/api/v1/msaidizi/devices/supervisor-enrollment/complete",
      handler.Path);
    using var body = JsonDocument.Parse(handler.Body!);
    Assert.Equal("device-2", body.RootElement.GetProperty("deviceId").GetString());
    Assert.Equal("enrollment-2", body.RootElement.GetProperty("enrollmentId").GetString());
    Assert.Equal("RECOVERY", body.RootElement.GetProperty("role").GetString());
    Assert.Equal("one-time-code", body.RootElement.GetProperty("enrollmentCode").GetString());
  }

  [Fact]
  public void ManifestVerifierRejectsTamperingAndUnpinnedKeys()
  {
    var fixture = CreateFixture();
    var verified = fixture.Verifier.Verify(fixture.Command);
    Assert.Equal(fixture.Command.RecoveryId, verified.RecoveryId);

    Assert.Throws<CryptographicException>(() => fixture.Verifier.Verify(
      fixture.Command with { ManifestJson = fixture.Command.ManifestJson + " " }));
    Assert.Throws<CryptographicException>(() => fixture.Verifier.Verify(
      fixture.Command with { SigningKeyId = "different-key" }));
  }

  [Fact]
  public void ManifestVerifierRejectsExpiredAndExtraClaims()
  {
    var expired = CreateFixture(
      issuedAt: DateTimeOffset.UtcNow.AddMinutes(-20),
      expiresAt: DateTimeOffset.UtcNow.AddMinutes(-10));
    Assert.Throws<InvalidDataException>(() => expired.Verifier.Verify(expired.Command));

    var fixture = CreateFixture();
    var objectValue = JsonSerializer.Deserialize<Dictionary<string, object?>>(fixture.Command.ManifestJson)!;
    objectValue["unplanned"] = "side-effect";
    var manifest = JsonSerializer.Serialize(objectValue);
    var command = Sign(fixture.Options, fixture.Command.RecoveryId, manifest);
    Assert.Throws<JsonException>(() => fixture.Verifier.Verify(command));
  }

  [Fact]
  public void ManifestVerifierRejectsLegacyOrMissingRestoredStateBinding()
  {
    var fixture = CreateFixture();
    var legacy = JsonSerializer.Serialize(new
    {
      schemaVersion = 1,
      recoveryId = fixture.Command.RecoveryId,
      deviceId = fixture.Options.DeviceId,
      originalActionId = "88888888-8888-4888-8888-888888888888",
      recoveryRecordSha256 = new string('a', 64),
      expectedCurrentStateSha256 = new string('b', 64),
      idempotencyKey = new string('c', 64),
      issuedAt = DateTimeOffset.UtcNow.AddSeconds(-5),
      expiresAt = DateTimeOffset.UtcNow.AddMinutes(5),
    });

    Assert.Throws<InvalidDataException>(() => fixture.Verifier.Verify(
      Sign(fixture.Options, fixture.Command.RecoveryId, legacy)));
  }

  [Fact]
  public async Task EngineJournalsBeforeRestoreAndReplaysCachedResultExactly()
  {
    var fixture = CreateFixture();
    var journal = new FileRecoveryJournal(fixture.Options.JournalPath);
    var results = new FileRecoveryResultStore(fixture.Options.ResultCachePath);
    var quarantine = new FakeQuarantine();
    using var engine = new TrustedRecoveryEngine(
      fixture.Options,
      fixture.Verifier,
      quarantine,
      new FakeFileSystem(),
      new FakeAdministrative(),
      journal,
      results);

    var first = await engine.ExecuteAsync(fixture.Command, null, CancellationToken.None);
    var second = await engine.ExecuteAsync(fixture.Command, null, CancellationToken.None);

    Assert.Equal("SUCCEEDED", first.Outcome);
    Assert.Equal(first, second);
    Assert.Equal(1, quarantine.Calls);
    Assert.NotEqual(new string('0', 64), first.JournalHeadSha256);
    var phases = File.ReadLines(fixture.Options.JournalPath)
      .Select(line => JsonDocument.Parse(line).RootElement.GetProperty("Phase").GetString())
      .ToArray();
    Assert.Collection(
      phases,
      phase => Assert.Equal("PREPARED", phase),
      phase => Assert.Equal("COMMITTED", phase));
  }

  [Fact]
  public async Task UnsupportedQuarantineRoutesOnlyToTypedAdministrativeRecovery()
  {
    var fixture = CreateFixture(expectedRestoredStateSha256: new string('e', 64));
    var quarantine = new FakeQuarantine(unsupported: true);
    var fileSystem = new FakeFileSystem();
    var administrative = new FakeAdministrative();
    using var engine = new TrustedRecoveryEngine(
      fixture.Options,
      fixture.Verifier,
      quarantine,
      fileSystem,
      administrative,
      new FileRecoveryJournal(fixture.Options.JournalPath),
      new FileRecoveryResultStore(fixture.Options.ResultCachePath));

    var result = await engine.ExecuteAsync(fixture.Command, null, CancellationToken.None);

    Assert.Equal("SUCCEEDED", result.Outcome);
    Assert.Equal(1, quarantine.Calls);
    Assert.Equal(1, fileSystem.Calls);
    Assert.Equal(1, administrative.Calls);
  }

  [Fact]
  public async Task UnsupportedQuarantineRoutesToTypedFilesystemRecoveryBeforeAdministrative()
  {
    var fixture = CreateFixture(expectedRestoredStateSha256: new string('f', 64));
    var quarantine = new FakeQuarantine(unsupported: true);
    var fileSystem = new FakeFileSystem(unsupported: false);
    var administrative = new FakeAdministrative();
    using var engine = new TrustedRecoveryEngine(
      fixture.Options,
      fixture.Verifier,
      quarantine,
      fileSystem,
      administrative,
      new FileRecoveryJournal(fixture.Options.JournalPath),
      new FileRecoveryResultStore(fixture.Options.ResultCachePath));

    var result = await engine.ExecuteAsync(fixture.Command, null, CancellationToken.None);

    Assert.Equal("SUCCEEDED", result.Outcome);
    Assert.Equal(1, quarantine.Calls);
    Assert.Equal(1, fileSystem.Calls);
    Assert.Equal(0, administrative.Calls);
  }

  [Fact]
  public async Task EngineRefusesToCommitWhenExecutorMissesSignedRestoredState()
  {
    var fixture = CreateFixture(expectedRestoredStateSha256: new string('e', 64));
    var journal = new FileRecoveryJournal(fixture.Options.JournalPath);
    using var engine = new TrustedRecoveryEngine(
      fixture.Options,
      fixture.Verifier,
      new FakeQuarantine(),
      new FakeFileSystem(),
      new FakeAdministrative(),
      journal,
      new FileRecoveryResultStore(fixture.Options.ResultCachePath));

    var result = await engine.ExecuteAsync(fixture.Command, null, CancellationToken.None);

    Assert.Equal("NEEDS_ATTENTION", result.Outcome);
    Assert.Equal("recovery_postcondition_mismatch", result.Reason);
    Assert.Null(result.RestoredStateSha256);
    var phases = File.ReadLines(fixture.Options.JournalPath)
      .Select(line => JsonDocument.Parse(line).RootElement.GetProperty("Phase").GetString())
      .ToArray();
    Assert.Collection(
      phases,
      phase => Assert.Equal("PREPARED", phase),
      phase => Assert.Equal("NEEDS_ATTENTION", phase));
  }

  [Fact]
  public async Task KillSwitchBlocksBeforeAnyRecoveryExecutorIsCalled()
  {
    var fixture = CreateFixture();
    Directory.CreateDirectory(Path.GetDirectoryName(fixture.Options.KillSwitchPath)!);
    await File.WriteAllTextAsync(fixture.Options.KillSwitchPath, "disabled");
    var quarantine = new FakeQuarantine();
    using var engine = new TrustedRecoveryEngine(
      fixture.Options,
      fixture.Verifier,
      quarantine,
      new FakeFileSystem(),
      new FakeAdministrative(),
      new FileRecoveryJournal(fixture.Options.JournalPath),
      new FileRecoveryResultStore(fixture.Options.ResultCachePath));

    await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
      engine.ExecuteAsync(fixture.Command, null, CancellationToken.None));
    Assert.Equal(0, quarantine.Calls);
  }

  [Fact]
  public void ResultCacheRejectsSameIdWithDifferentManifest()
  {
    var fixture = CreateFixture();
    var store = new FileRecoveryResultStore(fixture.Options.ResultCachePath);
    store.Put(new RecoveryExecutionResult(
      fixture.Options.DeviceId,
      fixture.Command.RecoveryId,
      "SUCCEEDED",
      fixture.Command.ManifestSha256,
      new string('a', 64),
      new string('b', 64),
      null));

    Assert.Throws<InvalidDataException>(() =>
      store.Find(fixture.Command.RecoveryId, new string('f', 64)));
  }

  [Fact]
  public async Task JournalDetectsTamperingAndTruncatesOnlyPartialAppend()
  {
    var fixture = CreateFixture();
    var journal = new FileRecoveryJournal(fixture.Options.JournalPath);
    await journal.AppendAsync(
      fixture.Command.RecoveryId,
      fixture.Command.ManifestSha256,
      "PREPARED",
      new Dictionary<string, string?> { ["digest"] = new string('a', 64) },
      CancellationToken.None);
    await File.AppendAllTextAsync(fixture.Options.JournalPath, "partial-without-newline");
    _ = new FileRecoveryJournal(fixture.Options.JournalPath);
    Assert.DoesNotContain("partial", await File.ReadAllTextAsync(fixture.Options.JournalPath));

    var content = await File.ReadAllTextAsync(fixture.Options.JournalPath);
    await File.WriteAllTextAsync(
      fixture.Options.JournalPath,
      content.Replace("PREPARED", "COMMITTED", StringComparison.Ordinal));
    Assert.Throws<InvalidDataException>(() =>
      new FileRecoveryJournal(fixture.Options.JournalPath));
  }

  private Fixture CreateFixture(
    DateTimeOffset? issuedAt = null,
    DateTimeOffset? expiresAt = null,
    string? expectedRestoredStateSha256 = null)
  {
    Directory.CreateDirectory(_root);
    var supervisorRoot = Path.Combine(_root, "recovery");
    Directory.CreateDirectory(supervisorRoot);
    var publicKeyPath = Path.Combine(supervisorRoot, "recovery-public.pem");
    File.WriteAllText(publicKeyPath, _signingKey.ExportSubjectPublicKeyInfoPem());
    var options = new RecoverySupervisorOptions
    {
      DeviceId = "55555555-5555-4555-8555-555555555555",
      BrokerBaseUri = "https://itemba.invalid/",
      SupervisorRoot = supervisorRoot,
      JournalPath = Path.Combine(supervisorRoot, Guid.NewGuid().ToString("N") + ".journal"),
      ResultCachePath = Path.Combine(supervisorRoot, Guid.NewGuid().ToString("N") + ".results"),
      KillSwitchPath = Path.Combine(_root, "DISABLED"),
      PinnedRecoveryPublicKeyPath = publicKeyPath,
      PinnedRecoveryPublicKeySha256 = Convert.ToHexString(
        SHA256.HashData(_signingKey.ExportSubjectPublicKeyInfo())).ToLowerInvariant(),
      RecoveryKeyId = "recovery-root-1",
    };
    var recoveryId = Guid.NewGuid().ToString("D");
    var manifest = JsonSerializer.Serialize(new
    {
      schemaVersion = 2,
      recoveryId,
      deviceId = options.DeviceId,
      originalActionId = "88888888-8888-4888-8888-888888888888",
      recoveryRecordSha256 = new string('a', 64),
      expectedCurrentStateSha256 = new string('b', 64),
      expectedRestoredStateSha256 = expectedRestoredStateSha256 ?? new string('d', 64),
      idempotencyKey = new string('c', 64),
      issuedAt = issuedAt ?? DateTimeOffset.UtcNow.AddSeconds(-5),
      expiresAt = expiresAt ?? DateTimeOffset.UtcNow.AddMinutes(5),
    });
    var command = Sign(options, recoveryId, manifest);
    return new Fixture(options, new RecoveryManifestVerifier(options), command);
  }

  private SignedRecoveryCommand Sign(
    RecoverySupervisorOptions options,
    string recoveryId,
    string manifest)
  {
    var bytes = Encoding.UTF8.GetBytes(manifest);
    var signature = _signingKey.SignData(
      bytes,
      HashAlgorithmName.SHA256,
      DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
    return new SignedRecoveryCommand(
      recoveryId,
      manifest,
      Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
      Convert.ToBase64String(signature).TrimEnd('=').Replace('+', '-').Replace('/', '_'),
      options.RecoveryKeyId);
  }

  public void Dispose()
  {
    _signingKey.Dispose();
    if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
  }

  private sealed record Fixture(
    RecoverySupervisorOptions Options,
    RecoveryManifestVerifier Verifier,
    SignedRecoveryCommand Command);

  private sealed class FakeQuarantine(bool unsupported = false) :
    ITrustedQuarantineRecoveryExecutor
  {
    public int Calls { get; private set; }

    public ValueTask<TrustedQuarantineRecoveryResult> RestoreAsync(
      TrustedQuarantineRecoveryRequest request,
      CancellationToken cancellationToken)
    {
      Calls++;
      if (unsupported) throw new HostRecoveryException("recovery_operation_not_supported");
      return ValueTask.FromResult(new TrustedQuarantineRecoveryResult(
        request.OriginalActionId,
        "filesystem.entry.quarantine",
        new string('d', 64),
        false));
    }
  }

  private sealed class FakeAdministrative : ITrustedAdministrativeRecoveryExecutor
  {
    public int Calls { get; private set; }

    public ValueTask<TrustedAdministrativeRecoveryResult> RestoreAsync(
      TrustedAdministrativeRecoveryRequest request,
      CancellationToken cancellationToken)
    {
      Calls++;
      return ValueTask.FromResult(new TrustedAdministrativeRecoveryResult(
        request.OriginalActionId,
        "registry.value.set",
        new string('e', 64),
        false));
    }
  }

  private sealed class FakeFileSystem(bool unsupported = true) :
    ITrustedFileSystemRecoveryExecutor
  {
    public int Calls { get; private set; }

    public ValueTask<TrustedFileSystemRecoveryResult> RestoreAsync(
      TrustedFileSystemRecoveryRequest request,
      CancellationToken cancellationToken)
    {
      Calls++;
      if (unsupported) throw new HostRecoveryException("recovery_operation_not_supported");
      return ValueTask.FromResult(new TrustedFileSystemRecoveryResult(
        request.OriginalActionId,
        "filesystem.file.write",
        new string('f', 64),
        false));
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
