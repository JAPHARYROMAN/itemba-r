using System.Security.Cryptography;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Agent.SecretProvisioning;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Contracts.SessionBridge;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class SecretProvisioningSecurityTests : IDisposable
{
  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"msaidizi-secret-provisioning-{Guid.NewGuid():N}");

  [Fact]
  public void EnvelopeIsDomainBoundAndNeverSerializesPlaintext()
  {
    var key = RandomNumberGenerator.GetBytes(32);
    var secret = Encoding.UTF8.GetBytes("never-serialize-this-secret");
    var requestId = Guid.NewGuid().ToString("D");
    var manifest = PayloadDigest.Sha256Hex("manifest");
    try
    {
      var envelope = SecretProvisioningEnvelopeProtection.Protect(
        key,
        requestId,
        manifest,
        secret);
      var json = JsonSerializer.Serialize(envelope);
      Assert.DoesNotContain("never-serialize-this-secret", json, StringComparison.Ordinal);
      var plaintext = SecretProvisioningEnvelopeProtection.Unprotect(
        key,
        requestId,
        manifest,
        envelope);
      try
      {
        Assert.Equal(secret, plaintext);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(plaintext);
      }

      var tampered = envelope with { TagBase64 = Convert.ToBase64String(new byte[16]) };
      Assert.ThrowsAny<CryptographicException>(() =>
        SecretProvisioningEnvelopeProtection.Unprotect(
          key,
          requestId,
          manifest,
          tampered));
      Assert.ThrowsAny<CryptographicException>(() =>
        SecretProvisioningEnvelopeProtection.Unprotect(
          key,
          requestId,
          PayloadDigest.Sha256Hex("different-manifest"),
          envelope));
    }
    finally
    {
      CryptographicOperations.ZeroMemory(key);
      CryptographicOperations.ZeroMemory(secret);
    }
  }

  [Fact]
  public void ManifestBindsExactDestinationAndCapabilities()
  {
    var requestId = Guid.NewGuid().ToString("D");
    var binding = Binding();
    var first = SecretProvisioningManifest.ComputeSha256(
      requestId,
      SecretProvisioningOperations.Create,
      binding,
      null);
    var destinationChanged = SecretProvisioningManifest.ComputeSha256(
      requestId,
      SecretProvisioningOperations.Create,
      binding with { Destination = "https://other.example.test/login" },
      null);
    var capabilityChanged = SecretProvisioningManifest.ComputeSha256(
      requestId,
      SecretProvisioningOperations.Create,
      binding with { AllowedCapabilities = ["external.purchase.submit"] },
      null);

    Assert.NotEqual(first, destinationChanged);
    Assert.NotEqual(first, capabilityChanged);
  }

  [Fact]
  public void ProvisioningHandshakeDerivesMatchingPurposeSeparatedKeys()
  {
    using var agent = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    using var service = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    var agentNonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    var serviceNonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    var transcript = PayloadDigest.Sha256Hex("provisioning-transcript");
    var agentKey = SecretProvisioningAuthentication.DeriveSessionKey(
      agent,
      service.PublicKey,
      agentNonce,
      serviceNonce,
      transcript);
    var serviceKey = SecretProvisioningAuthentication.DeriveSessionKey(
      service,
      agent.PublicKey,
      agentNonce,
      serviceNonce,
      transcript);
    var ordinaryBridgeKey = SessionBridgeAuthentication.DeriveSessionKey(
      agent,
      service.PublicKey,
      agentNonce,
      serviceNonce,
      transcript);
    try
    {
      Assert.Equal(agentKey, serviceKey);
      Assert.False(agentKey.SequenceEqual(ordinaryBridgeKey));
    }
    finally
    {
      CryptographicOperations.ZeroMemory(agentKey);
      CryptographicOperations.ZeroMemory(serviceKey);
      CryptographicOperations.ZeroMemory(ordinaryBridgeKey);
    }
  }

  [Fact]
  public async Task JournalReplaysCompletedMutationAcrossRestartWithoutDuplicatingIt()
  {
    var path = Path.Combine(_directory, "audit.jsonl");
    var intent = Intent();
    var metadata = ResultMetadata();
    using (var journal = new FileSecretProvisioningAuditJournal(path))
    {
      Assert.Null(await journal.PrepareAsync(intent, CancellationToken.None));
      var completed = await journal.CompleteAsync(
        intent,
        "completed",
        null,
        metadata,
        CancellationToken.None);
      Assert.False(completed.Replayed);
    }

    using (var restarted = new FileSecretProvisioningAuditJournal(path))
    {
      var replay = await restarted.PrepareAsync(
        intent with
        {
          Caller = intent.Caller with { ProcessId = 9002, SessionId = 4 },
        },
        CancellationToken.None);
      Assert.NotNull(replay);
      Assert.True(replay.Replayed);
      Assert.NotNull(replay.Metadata);
      Assert.Equal(metadata.VaultReferenceId, replay.Metadata.VaultReferenceId);
      Assert.Equal(metadata.Kind, replay.Metadata.Kind);
      Assert.Equal(metadata.DestinationScopeSha256, replay.Metadata.DestinationScopeSha256);
      Assert.Equal(metadata.AllowedCapabilities, replay.Metadata.AllowedCapabilities);
      Assert.Equal(metadata.Version, replay.Metadata.Version);
    }

    Assert.Equal(2, File.ReadAllLines(path).Length);
  }

  [Fact]
  public async Task JournalRefusesRollbackForkConflictAndIncompleteRestart()
  {
    var path = Path.Combine(_directory, "uncertain.jsonl");
    var intent = Intent();
    using (var journal = new FileSecretProvisioningAuditJournal(path))
    {
      Assert.Null(await journal.PrepareAsync(intent, CancellationToken.None));
    }

    using (var restarted = new FileSecretProvisioningAuditJournal(path))
    {
      var uncertain = await Assert.ThrowsAsync<SecretProvisioningException>(() =>
        restarted.PrepareAsync(intent, CancellationToken.None).AsTask());
      Assert.Equal("secret_request_outcome_uncertain", uncertain.ErrorCode);
    }

    var conflictPath = Path.Combine(_directory, "conflict.jsonl");
    using (var journal = new FileSecretProvisioningAuditJournal(conflictPath))
    {
      Assert.Null(await journal.PrepareAsync(intent, CancellationToken.None));
      await journal.CompleteAsync(
        intent,
        "completed",
        null,
        ResultMetadata(),
        CancellationToken.None);
      var conflict = await Assert.ThrowsAsync<SecretProvisioningException>(() =>
        journal.PrepareAsync(
          intent with { ManifestSha256 = PayloadDigest.Sha256Hex("conflict") },
          CancellationToken.None).AsTask());
      Assert.Equal("secret_request_replay_conflict", conflict.ErrorCode);
    }

    var lines = File.ReadAllLines(conflictPath);
    File.WriteAllLines(conflictPath, [lines[0], lines[0]]);
    using var forked = new FileSecretProvisioningAuditJournal(conflictPath);
    var invalid = await Assert.ThrowsAsync<SecretProvisioningException>(() =>
      forked.PrepareAsync(Intent() with { RequestId = Guid.NewGuid().ToString("D") },
        CancellationToken.None).AsTask());
    Assert.Equal("secret_audit_journal_invalid", invalid.ErrorCode);
  }

  [Fact]
  public async Task CoordinatorAuditsMutationWithoutPersistingSecretAndReplayIsIdempotent()
  {
    Directory.CreateDirectory(_directory);
    var vaultPath = Path.Combine(_directory, "vault");
    var journalPath = Path.Combine(_directory, "journal", "audit.jsonl");
    var hostOptions = Options.Create(new HostCapabilityOptions
    {
      SecretVaultPath = vaultPath,
    });
    var provisioningOptions = Options.Create(new SecretProvisioningOptions
    {
      AuditJournalPath = journalPath,
    });
    var killPath = Path.Combine(_directory, "DISABLED");
    using var vault = new FileHostSecretReferenceVault(hostOptions);
    using var journal = new FileSecretProvisioningAuditJournal(provisioningOptions);
    var coordinator = new SecretProvisioningCoordinator(
      vault,
      journal,
      Options.Create(new CompanionOptions { KillSwitchPath = killPath }));
    var binding = Binding();
    var challenge = Challenge(binding);
    var caller = Caller();
    var secret = Encoding.UTF8.GetBytes("audit-must-never-contain-me");
    try
    {
      var result = await coordinator.ExecuteAsync(
        challenge,
        caller,
        secret,
        CancellationToken.None);
      Assert.Equal("completed", result.Outcome);
      Assert.False(result.Replayed);
      Assert.NotNull(result.Metadata);
      Assert.DoesNotContain(
        "audit-must-never-contain-me",
        File.ReadAllText(journalPath),
        StringComparison.Ordinal);

      var replay = await coordinator.ExecuteAsync(
        challenge,
        caller with { ProcessId = caller.ProcessId + 1 },
        Encoding.UTF8.GetBytes("different-replay-payload-is-ignored"),
        CancellationToken.None);
      Assert.True(replay.Replayed);
      Assert.Equal(result.Metadata, replay.Metadata);
      Assert.Single(Directory.GetFiles(vaultPath, "*.bin"));
      Assert.Equal(2, File.ReadAllLines(journalPath).Length);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(secret);
    }
  }

  [Fact]
  public async Task KillSwitchStopsMutationAndProducesAuditedFailure()
  {
    Directory.CreateDirectory(_directory);
    var vaultPath = Path.Combine(_directory, "kill-vault");
    var journalPath = Path.Combine(_directory, "kill-journal", "audit.jsonl");
    var killPath = Path.Combine(_directory, "DISABLED");
    await File.WriteAllTextAsync(killPath, "disabled");
    using var vault = new FileHostSecretReferenceVault(Options.Create(
      new HostCapabilityOptions { SecretVaultPath = vaultPath }));
    using var journal = new FileSecretProvisioningAuditJournal(journalPath);
    var coordinator = new SecretProvisioningCoordinator(
      vault,
      journal,
      Options.Create(new CompanionOptions { KillSwitchPath = killPath }));

    var result = await coordinator.ExecuteAsync(
      Challenge(Binding()),
      Caller(),
      Encoding.UTF8.GetBytes("must-not-be-written"),
      CancellationToken.None);

    Assert.Equal("failed", result.Outcome);
    Assert.Equal("secret_provisioning_kill_switch_engaged", result.ErrorCode);
    Assert.False(Directory.Exists(vaultPath));
    Assert.Equal(2, File.ReadAllLines(journalPath).Length);
  }

  [Fact]
  public async Task WorkflowCannotReadOrCommitSecretBeforeExplicitConfirmation()
  {
    var binding = Binding();
    var session = new FakeClientSession(binding);
    var interaction = new FakeInteraction(binding) { Confirm = false };
    var pendingStore = new InMemoryPendingStore();
    var workflow = new SecretProvisioningWorkflow(
      new FakeClient(session),
      interaction,
      pendingStore);

    await workflow.RunAsync(CancellationToken.None);

    Assert.Equal(1, interaction.ConfirmCount);
    Assert.Equal(0, interaction.SecretReadCount);
    Assert.Equal(0, session.CommitCount);
    Assert.Equal(binding.Destination, interaction.ObservedDestination);
    Assert.Equal(binding.AllowedCapabilities, interaction.ObservedCapabilities);
    Assert.Null(await pendingStore.LoadAsync(CancellationToken.None));
  }

  [Fact]
  public async Task PendingRequestIsDpapiProtectedAndSurvivesAgentRestart()
  {
    Directory.CreateDirectory(_directory);
    var path = Path.Combine(_directory, "pending", "request.bin");
    var options = Options.Create(
      new Itemba.Msaidizi.Companion.Agent.Configuration.SecretProvisioningOptions
      {
        PendingRequestPath = path,
      });
    var request = new SecretProvisioningPendingRequest(
      1,
      Guid.NewGuid().ToString("D"),
      SecretProvisioningOperations.Rotate,
      "finance-login",
      Guid.NewGuid().ToString("D"),
      DateTimeOffset.UtcNow);

    using (var store = new DpapiSecretProvisioningPendingStore(options))
    {
      await store.StoreAsync(request, CancellationToken.None);
    }

    var protectedBytes = await File.ReadAllBytesAsync(path);
    Assert.DoesNotContain(
      request.RequestId,
      Encoding.UTF8.GetString(protectedBytes),
      StringComparison.Ordinal);
    using (var restarted = new DpapiSecretProvisioningPendingStore(options))
    {
      Assert.Equal(request, await restarted.LoadAsync(CancellationToken.None));
      await restarted.ClearAsync(CancellationToken.None);
      Assert.Null(await restarted.LoadAsync(CancellationToken.None));
    }
  }

  [Fact]
  public async Task WorkflowReusesRequestIdAfterLostResultAndClearsItAfterReplay()
  {
    var binding = Binding();
    var pendingStore = new InMemoryPendingStore();
    var firstSession = new FakeClientSession(binding) { ThrowAfterCommit = true };
    var firstInteraction = new FakeInteraction(binding) { Confirm = true };
    var firstWorkflow = new SecretProvisioningWorkflow(
      new FakeClient(firstSession),
      firstInteraction,
      pendingStore);

    await firstWorkflow.RunAsync(CancellationToken.None);

    var pending = await pendingStore.LoadAsync(CancellationToken.None);
    Assert.NotNull(pending);
    Assert.Equal(firstSession.LastBeginRequestId, pending.RequestId);
    Assert.Equal(1, firstSession.CommitCount);

    var replaySession = new FakeClientSession(binding);
    var replayInteraction = new FakeInteraction(binding) { Confirm = true };
    var restartedWorkflow = new SecretProvisioningWorkflow(
      new FakeClient(replaySession),
      replayInteraction,
      pendingStore);

    await restartedWorkflow.RunAsync(CancellationToken.None);

    Assert.Equal(firstSession.LastBeginRequestId, replaySession.LastBeginRequestId);
    Assert.Equal(0, replayInteraction.SelectionCount);
    Assert.Equal(1, replaySession.CommitCount);
    Assert.Null(await pendingStore.LoadAsync(CancellationToken.None));
  }

  [Fact]
  public void ProvisioningDtosHaveNoPlaintextSecretProperty()
  {
    var dtoTypes = new[]
    {
      typeof(SecretProvisioningCommitRequest),
      typeof(SecretProvisioningResult),
      typeof(SecretProvisioningResultMetadata),
      typeof(SecretProvisioningChallenge),
    };
    foreach (var property in dtoTypes.SelectMany(type => type.GetProperties()))
    {
      Assert.DoesNotContain("plaintext", property.Name, StringComparison.OrdinalIgnoreCase);
      Assert.DoesNotContain("secretvalue", property.Name, StringComparison.OrdinalIgnoreCase);
      Assert.DoesNotContain("password", property.Name, StringComparison.OrdinalIgnoreCase);
    }
  }

  [Fact]
  public void RuntimeAclPolicyRejectsBroadWriteAccess()
  {
    var system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
    var authenticated = new SecurityIdentifier(
      WellKnownSidType.AuthenticatedUserSid,
      null);
    var safe = new DirectorySecurity();
    safe.SetOwner(system);
    safe.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
    safe.AddAccessRule(new FileSystemAccessRule(
      system,
      FileSystemRights.FullControl,
      AccessControlType.Allow));
    SecretProvisioningRuntimeBoundary.ValidateDirectorySecurity(safe);

    safe.AddAccessRule(new FileSystemAccessRule(
      authenticated,
      FileSystemRights.Read,
      AccessControlType.Allow));
    SecretProvisioningRuntimeBoundary.ValidateDirectorySecurity(safe);
    Assert.Throws<UnauthorizedAccessException>(() =>
      SecretProvisioningRuntimeBoundary.ValidateSecretVaultSecurity(safe));

    safe.AddAccessRule(new FileSystemAccessRule(
      authenticated,
      FileSystemRights.Write,
      AccessControlType.Allow));
    Assert.Throws<UnauthorizedAccessException>(() =>
      SecretProvisioningRuntimeBoundary.ValidateDirectorySecurity(safe));
  }

  [Fact]
  public void PackagedSecretProvisioningConfigurationIsFailClosed()
  {
    var servicePath = Path.Combine(AppContext.BaseDirectory, "test-assets",
      "service-appsettings.json");
    var agentPath = Path.Combine(AppContext.BaseDirectory, "test-assets",
      "agent-appsettings.json");
    using var service = JsonDocument.Parse(File.ReadAllText(servicePath));
    using var agent = JsonDocument.Parse(File.ReadAllText(agentPath));

    var serviceSection = service.RootElement.GetProperty("SecretProvisioning");
    var agentSection = agent.RootElement.GetProperty("SecretProvisioning");
    Assert.False(serviceSection.GetProperty("Enabled").GetBoolean());
    Assert.Empty(serviceSection.GetProperty("Bindings").EnumerateArray());
    Assert.Equal(string.Empty,
      serviceSection.GetProperty("AllowedAgentExecutableSha256").GetString());
    Assert.False(agentSection.GetProperty("Enabled").GetBoolean());
    Assert.Equal(string.Empty,
      agentSection.GetProperty("ServiceCertificateThumbprint").GetString());
  }

  [Fact]
  public async Task CoordinatorAuditsCreateRotateAndDeleteAsDistinctMutations()
  {
    Directory.CreateDirectory(_directory);
    var vaultPath = Path.Combine(_directory, "lifecycle-vault");
    var journalPath = Path.Combine(_directory, "lifecycle-journal", "audit.jsonl");
    using var vault = new FileHostSecretReferenceVault(Options.Create(
      new HostCapabilityOptions { SecretVaultPath = vaultPath }));
    using var journal = new FileSecretProvisioningAuditJournal(journalPath);
    var coordinator = new SecretProvisioningCoordinator(
      vault,
      journal,
      Options.Create(new CompanionOptions
      {
        KillSwitchPath = Path.Combine(_directory, "not-disabled"),
      }));
    var binding = Binding();
    var caller = Caller();

    var created = await coordinator.ExecuteAsync(
      Challenge(binding),
      caller,
      Encoding.UTF8.GetBytes("lifecycle-one"),
      CancellationToken.None);
    var referenceId = Assert.IsType<string>(created.Metadata?.VaultReferenceId);
    var rotated = await coordinator.ExecuteAsync(
      Challenge(binding, SecretProvisioningOperations.Rotate, referenceId),
      caller,
      Encoding.UTF8.GetBytes("lifecycle-two"),
      CancellationToken.None);
    var deleted = await coordinator.ExecuteAsync(
      Challenge(binding, SecretProvisioningOperations.Delete, referenceId),
      caller,
      ReadOnlyMemory<byte>.Empty,
      CancellationToken.None);

    Assert.Equal("completed", created.Outcome);
    Assert.Equal(2, rotated.Metadata?.Version);
    Assert.Equal("completed", deleted.Outcome);
    Assert.Equal(6, File.ReadAllLines(journalPath).Length);
    Assert.Empty(Directory.GetFiles(vaultPath));
  }

  private static SecretProvisioningBindingPreview Binding() => new(
    "finance-login",
    "Finance login",
    "browser-credential",
    "https://finance.example.test/login",
    PayloadDigest.Sha256Hex("finance-destination"),
    ["browser.form.secret.set"]);

  private static SecretProvisioningChallenge Challenge(
    SecretProvisioningBindingPreview binding,
    string operation = SecretProvisioningOperations.Create,
    string? referenceId = null)
  {
    var requestId = Guid.NewGuid().ToString("D");
    return new SecretProvisioningChallenge(
      requestId,
      Guid.NewGuid().ToString("D"),
      operation,
      binding,
      referenceId,
      SecretProvisioningManifest.ComputeSha256(
        requestId,
        operation,
        binding,
        referenceId),
      DateTimeOffset.UtcNow.AddMinutes(1));
  }

  private static SecretProvisioningCallerIdentity Caller() => new(
    "S-1-5-21-1000",
    8001,
    3,
    PayloadDigest.Sha256Hex("approved-agent"));

  private static SecretProvisioningMutationIntent Intent()
  {
    var binding = Binding();
    return new SecretProvisioningMutationIntent(
      Guid.NewGuid().ToString("D"),
      SecretProvisioningOperations.Create,
      binding.BindingId,
      null,
      PayloadDigest.Sha256Hex("manifest"),
      binding.DestinationScopeSha256,
      SecretProvisioningBindingCatalog.CapabilitySetSha256(binding),
      Caller());
  }

  private static SecretProvisioningResultMetadata ResultMetadata() => new(
    Guid.NewGuid().ToString("D"),
    "browser-credential",
    PayloadDigest.Sha256Hex("finance-destination"),
    ["browser.form.secret.set"],
    1,
    DateTimeOffset.UnixEpoch,
    DateTimeOffset.UnixEpoch);

  public void Dispose()
  {
    if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
  }

  private sealed class FakeClient(ISecretProvisioningClientSession session) :
    ISecretProvisioningClient
  {
    public ValueTask<ISecretProvisioningClientSession> ConnectAsync(
      CancellationToken cancellationToken) => ValueTask.FromResult(session);
  }

  private sealed class FakeClientSession(
    SecretProvisioningBindingPreview binding) : ISecretProvisioningClientSession
  {
    public int CommitCount { get; private set; }
    public string? LastBeginRequestId { get; private set; }
    public bool ThrowAfterCommit { get; init; }

    public ValueTask<IReadOnlyList<SecretProvisioningBindingPreview>> GetCatalogAsync(
      CancellationToken cancellationToken) =>
      ValueTask.FromResult<IReadOnlyList<SecretProvisioningBindingPreview>>([binding]);

    public ValueTask<SecretProvisioningChallenge> BeginAsync(
      SecretProvisioningBeginRequest request,
      CancellationToken cancellationToken)
    {
      LastBeginRequestId = request.RequestId;
      return ValueTask.FromResult(new SecretProvisioningChallenge(
        request.RequestId,
        Guid.NewGuid().ToString("D"),
        request.Operation,
        binding,
        request.VaultReferenceId,
        SecretProvisioningManifest.ComputeSha256(
          request.RequestId,
          request.Operation,
          binding,
          request.VaultReferenceId),
        DateTimeOffset.UtcNow.AddMinutes(1)));
    }

    public ValueTask<SecretProvisioningResult> CommitAsync(
      SecretProvisioningChallenge challenge,
      ReadOnlyMemory<byte> secret,
      CancellationToken cancellationToken)
    {
      CommitCount++;
      if (ThrowAfterCommit)
      {
        throw new IOException("simulated lost local result");
      }
      return ValueTask.FromResult(new SecretProvisioningResult(
        challenge.RequestId,
        challenge.Operation,
        "completed",
        false,
        null,
        ResultMetadata()));
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
  }

  private sealed class FakeInteraction(
    SecretProvisioningBindingPreview expected) : ISecretProvisioningUserInteraction
  {
    public bool Confirm { get; init; }
    public int ConfirmCount { get; private set; }
    public int SelectionCount { get; private set; }
    public int SecretReadCount { get; private set; }
    public string? ObservedDestination { get; private set; }
    public IReadOnlyList<string>? ObservedCapabilities { get; private set; }

    public ValueTask<SecretProvisioningSelection?> SelectAsync(
      IReadOnlyList<SecretProvisioningBindingPreview> bindings,
      CancellationToken cancellationToken)
    {
      SelectionCount++;
      return ValueTask.FromResult<SecretProvisioningSelection?>(
        new(SecretProvisioningOperations.Create, expected.BindingId, null));
    }

    public ValueTask<bool> ConfirmAsync(
      SecretProvisioningChallenge challenge,
      CancellationToken cancellationToken)
    {
      ConfirmCount++;
      ObservedDestination = challenge.Binding.Destination;
      ObservedCapabilities = challenge.Binding.AllowedCapabilities;
      return ValueTask.FromResult(Confirm);
    }

    public ValueTask<SecretBuffer?> ReadSecretAsync(CancellationToken cancellationToken)
    {
      SecretReadCount++;
      return ValueTask.FromResult<SecretBuffer?>(new(Encoding.UTF8.GetBytes("test")));
    }

    public ValueTask ShowResultAsync(
      SecretProvisioningResult result,
      CancellationToken cancellationToken) => ValueTask.CompletedTask;

    public ValueTask ShowFailureAsync(
      string errorCode,
      CancellationToken cancellationToken) => ValueTask.CompletedTask;
  }

  private sealed class InMemoryPendingStore : ISecretProvisioningPendingStore
  {
    private SecretProvisioningPendingRequest? _request;

    public ValueTask<SecretProvisioningPendingRequest?> LoadAsync(
      CancellationToken cancellationToken) => ValueTask.FromResult(_request);

    public ValueTask StoreAsync(
      SecretProvisioningPendingRequest request,
      CancellationToken cancellationToken)
    {
      _request = request;
      return ValueTask.CompletedTask;
    }

    public ValueTask ClearAsync(CancellationToken cancellationToken)
    {
      _request = null;
      return ValueTask.CompletedTask;
    }
  }
}
