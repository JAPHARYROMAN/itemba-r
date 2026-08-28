using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Journal;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Execution;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class ProtectedPersistenceTests : IDisposable
{
  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"msaidizi-protected-persistence-{Guid.NewGuid():N}");

  [Fact]
  public async Task ResultCacheReturnsPriorOutputButNeverStoresItInPlaintext()
  {
    var cache = Path.Combine(_directory, "result-cache");
    using var store = new FileProtectedActionResultStore(Options.Create(new CompanionOptions
    {
      ResultCachePath = cache,
    }));
    var request = ActionTokenVerifierTests.CreateRequest("{}");
    const string output = "{\"credential\":\"never-store-plaintext\"}";
    var outputSha256 = PayloadDigest.Sha256Hex(output);
    var result = new ActionResult(
      request.ActionId,
      request.TaskId,
      request.StepId,
      ActionOutcome.Completed,
      output,
      outputSha256,
      MutationCommitted: false,
      OutcomeUncertain: false,
      IsIdempotentReplay: false,
      ErrorCode: null,
      Provenance: [],
      BrokerExternalEgressBytes: 10_000,
      BrokerMaxDeliverySessions: 2,
      BrokerMaxRequestAttemptsPerSession: 2,
      BrokerSerializedResultUpperBoundBytes: 2_500,
      ActionTokenSha256: PayloadDigest.Sha256Hex("signed-token"));
    await store.StoreAsync(request, result, 100_000, CancellationToken.None);
    var persisted = await File.ReadAllBytesAsync(Assert.Single(Directory.GetFiles(cache, "*.bin")));
    var receipt = new JournalTerminalReceipt(
      request.ActionId,
      request.TaskId,
      request.StepId,
      PayloadDigest.Sha256Hex("request"),
      ActionOutcome.Completed,
      outputSha256,
      MutationCommitted: false,
      OutcomeUncertain: false,
      ErrorCode: null,
      JournalPrepareSequence: 1,
      JournalPrepareEntryHash: PayloadDigest.Sha256Hex("prepare-entry"),
      JournalPreparePreviousHash: PayloadDigest.Sha256Hex("prepare-previous"),
      JournalSequence: 2,
      JournalEntryHash: PayloadDigest.Sha256Hex("entry"),
      JournalPreviousHash: PayloadDigest.Sha256Hex("previous"),
      BrokerExternalEgressBytes: 10_000,
      MaximumExternalEgressBytes: 100_000,
      BrokerMaxDeliverySessions: 2,
      BrokerMaxRequestAttemptsPerSession: 2,
      BrokerSerializedResultUpperBoundBytes: 2_500,
      Provenance: [],
      ActionTokenSha256: PayloadDigest.Sha256Hex("signed-token"));

    var replay = await store.TryLoadAsync(request, receipt, CancellationToken.None);

    Assert.NotNull(replay);
    Assert.Equal(output, replay.OutputJson);
    Assert.DoesNotContain("never-store-plaintext", Encoding.UTF8.GetString(persisted));
  }

  [Theory]
  [InlineData(
    HostCredentialEphemeralityPolicy.LegacyFileReadCapabilityId,
    HostCredentialEphemeralityPolicy.LegacyFileReadCapabilityVersion)]
  [InlineData(
    HostCredentialEphemeralityPolicy.EphemeralFileDisclosureCapabilityId,
    HostCredentialEphemeralityPolicy.EphemeralFileDisclosureCapabilityVersion)]
  public async Task ResultCacheRefusesFileContentBeforeCreatingAnyDurableFile(
    string capabilityId,
    string capabilityVersion)
  {
    var cache = Path.Combine(_directory, "forbidden-file-result-cache");
    using var store = new FileProtectedActionResultStore(Options.Create(new CompanionOptions
    {
      ResultCachePath = cache,
    }));
    var original = ActionTokenVerifierTests.CreateRequest("{}");
    var request = original with
    {
      CapabilityId = capabilityId,
      CapabilityVersion = capabilityVersion,
    };
    const string knownSecret = "known-secret-file-canary-7u3X";
    var output = JsonSerializer.Serialize(new
    {
      rootId = "managed",
      relativePath = "credential.pdf",
      contentBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(knownSecret)),
      length = Encoding.UTF8.GetByteCount(knownSecret),
      contentSha256 = PayloadDigest.Sha256Hex(knownSecret).ToLowerInvariant(),
    });
    var result = new ActionResult(
      request.ActionId,
      request.TaskId,
      request.StepId,
      ActionOutcome.Completed,
      output,
      PayloadDigest.Sha256Hex(output),
      MutationCommitted: false,
      OutcomeUncertain: false,
      IsIdempotentReplay: false,
      ErrorCode: null,
      Provenance: [],
      BrokerExternalEgressBytes: 10_000,
      BrokerMaxDeliverySessions: 2,
      BrokerMaxRequestAttemptsPerSession: 2,
      BrokerSerializedResultUpperBoundBytes: 2_500,
      ActionTokenSha256: PayloadDigest.Sha256Hex("signed-token"));

    var error = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
      await store.StoreAsync(request, result, 100_000, CancellationToken.None));

    var receipt = new JournalTerminalReceipt(
      request.ActionId,
      request.TaskId,
      request.StepId,
      PayloadDigest.Sha256Hex("request"),
      ActionOutcome.Completed,
      result.OutputSha256,
      MutationCommitted: false,
      OutcomeUncertain: false,
      ErrorCode: null,
      JournalPrepareSequence: 1,
      JournalPrepareEntryHash: PayloadDigest.Sha256Hex("prepare-entry"),
      JournalPreparePreviousHash: PayloadDigest.Sha256Hex("prepare-previous"),
      JournalSequence: 2,
      JournalEntryHash: PayloadDigest.Sha256Hex("entry"),
      JournalPreviousHash: PayloadDigest.Sha256Hex("previous"),
      BrokerExternalEgressBytes: 10_000,
      MaximumExternalEgressBytes: 100_000,
      BrokerMaxDeliverySessions: 2,
      BrokerMaxRequestAttemptsPerSession: 2,
      BrokerSerializedResultUpperBoundBytes: 2_500,
      Provenance: [],
      ActionTokenSha256: PayloadDigest.Sha256Hex("signed-token"));
    var replayError = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
      await store.TryLoadAsync(request, receipt, CancellationToken.None));
    var deliveryError = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
      await store.TryBeginDeliverySessionAsync(request, receipt, 2, CancellationToken.None));

    Assert.Equal(HostCredentialEphemeralityPolicy.ErrorCode, error.Message);
    Assert.Equal(HostCredentialEphemeralityPolicy.ErrorCode, replayError.Message);
    Assert.Equal(HostCredentialEphemeralityPolicy.ErrorCode, deliveryError.Message);
    Assert.False(Directory.Exists(cache));
  }

  [Fact]
  public async Task RecoveryVaultPersistsOnlyDpapiCiphertextBeforeMutation()
  {
    var vaultPath = Path.Combine(_directory, "recovery-vault");
    var vault = new FileHostRecoveryVault(Options.Create(new HostCapabilityOptions
    {
      RecoveryVaultPath = vaultPath,
    }));
    var context = new ActionExecutionContext(
      "action-1",
      "task-1",
      "plan-1",
      "step-1",
      "device-1",
      "mandate-1",
      "idempotency-1",
      PayloadDigest.Sha256Hex("before"),
      InputProvenanceSha256: null,
      new ActionBudget(60, 10, 20, 10, 1_000_000, 1_000_000, 1m));
    var receipt = await vault.PrepareAsync(
      context,
      "filesystem.entry.quarantine",
      PayloadDigest.Sha256Hex("before"),
      new { originalPath = "sensitive\\customer-list.csv" },
      irreversible: false,
      CancellationToken.None);
    var persisted = await File.ReadAllBytesAsync(receipt.RecordPath);

    Assert.True(PayloadDigest.IsSha256Hex(receipt.RecordSha256));
    Assert.True(PayloadDigest.IsSha256Hex(receipt.OpaqueHandle));
    Assert.DoesNotContain("customer-list", Encoding.UTF8.GetString(persisted));
  }

  public void Dispose()
  {
    if (Directory.Exists(_directory))
    {
      Directory.Delete(_directory, recursive: true);
    }
  }
}
