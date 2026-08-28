using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Channel;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Journal;
using Itemba.Msaidizi.Companion.Service.Channel;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class HttpPollingCompanionChannelTests
{
  [Fact]
  public async Task JournalHeadLookupUsesTheAuthenticatedDeviceChannel()
  {
    var handler = new RecordingHandler();
    await using var channel = new HttpPollingCompanionChannel(
      Options.Create(CreateBrokerOptions()),
      Options.Create(new CompanionOptions { DeviceId = "device-1" }),
      NullLogger<HttpPollingCompanionChannel>.Instance,
      new HttpClient(handler, disposeHandler: true));
    await channel.ConnectAsync(CancellationToken.None);

    var head = await channel.GetJournalHeadAsync(
      new JournalCentralHeadRequest("device-1"),
      CancellationToken.None);

    Assert.Equal("device-1", head.DeviceId);
    Assert.Equal(0, head.Sequence);
    Assert.Equal(0, head.HashVersion);
    Assert.Equal(new string('0', 64), head.EntryHash);
    Assert.Contains(handler.RequestUris, uri =>
      uri.AbsolutePath.EndsWith("/journal-head", StringComparison.Ordinal));
  }

  [Fact]
  public async Task JournalReconciliationUsesDigestOnlyExactBoundAcknowledgement()
  {
    var handler = new RecordingHandler();
    await using var channel = new HttpPollingCompanionChannel(
      Options.Create(CreateBrokerOptions()),
      Options.Create(new CompanionOptions { DeviceId = "device-1" }),
      NullLogger<HttpPollingCompanionChannel>.Instance,
      new HttpClient(handler, disposeHandler: true));
    await channel.ConnectAsync(CancellationToken.None);
    var genesis = new string('0', 64);
    var entryHash = new string('A', 64);
    var entry = new JournalRecord(
      1,
      new DateTimeOffset(2026, 8, 27, 10, 0, 0, TimeSpan.Zero),
      JournalEntryKind.Prepared,
      "action-1",
      "idempotency-1",
      genesis,
      new string('B', 64),
      entryHash);

    var acknowledgement = await channel.ReconcileJournalAsync(
      new JournalReconciliationRequest(
        "device-1",
        0,
        genesis,
        [entry],
        1,
        entryHash,
        1,
        entryHash),
      CancellationToken.None);

    Assert.True(acknowledgement.ExactHead);
    Assert.Equal(1, acknowledgement.AcceptedThroughSequence);
    Assert.Contains(handler.RequestUris, uri =>
      uri.AbsolutePath.EndsWith("/journal-reconcile", StringComparison.Ordinal));
    var body = Assert.Single(handler.Bodies);
    Assert.Contains("\"kind\":\"Prepared\"", body, StringComparison.Ordinal);
    Assert.DoesNotContain("payloadJson", body, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("argumentsJson", body, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("outputJson", body, StringComparison.OrdinalIgnoreCase);
  }

  [Fact]
  public async Task JournalReconciliationRejectsAcknowledgementForAnotherDevice()
  {
    var handler = new RecordingHandler(wrongReconciliationDevice: true);
    await using var channel = new HttpPollingCompanionChannel(
      Options.Create(CreateBrokerOptions()),
      Options.Create(new CompanionOptions { DeviceId = "device-1" }),
      NullLogger<HttpPollingCompanionChannel>.Instance,
      new HttpClient(handler, disposeHandler: true));
    await channel.ConnectAsync(CancellationToken.None);
    var genesis = new string('0', 64);

    await Assert.ThrowsAsync<JsonException>(async () =>
      await channel.ReconcileJournalAsync(
        new JournalReconciliationRequest(
          "device-1",
          0,
          genesis,
          [],
          0,
          genesis,
          0,
          genesis),
        CancellationToken.None));
    Assert.False(channel.IsCentralLedgerConnected);
  }

  [Fact]
  public async Task ManifestAdvertisesDurableActionFenceCommandProtocolVersion()
  {
    var handler = new RecordingHandler();
    await using var channel = new HttpPollingCompanionChannel(
      Options.Create(CreateBrokerOptions()),
      Options.Create(new CompanionOptions { DeviceId = "device-1" }),
      NullLogger<HttpPollingCompanionChannel>.Instance,
      new HttpClient(handler, disposeHandler: true));
    await channel.ConnectAsync(CancellationToken.None);

    await channel.SendManifestAsync(new CapabilityManifestSnapshot(
      "device-1",
      new string('a', 64),
      [],
      DateTimeOffset.UtcNow,
      CompanionCommandProtocol.CurrentVersion), CancellationToken.None);

    Assert.Contains(handler.Bodies, body =>
      body.Contains("\"commandProtocolVersion\":3", StringComparison.Ordinal));
  }

  [Fact]
  public async Task PollsOutboundAndUsesCamelCaseStringEnumJson()
  {
    var handler = new RecordingHandler();
    await using var channel = new HttpPollingCompanionChannel(
      Options.Create(CreateBrokerOptions()),
      Options.Create(new CompanionOptions { DeviceId = "device-1" }),
      NullLogger<HttpPollingCompanionChannel>.Instance,
      new HttpClient(handler, disposeHandler: true));
    await channel.ConnectAsync(CancellationToken.None);
    var leaseExpiresAt = DateTimeOffset.UtcNow.AddMinutes(5);

    var acknowledgement = await channel.SendProgressAsync(new ActionProgress(
      "action-1",
      "task-1",
      "step-1",
      ActionProgressState.Started,
      0,
      "action_started",
      1,
      new DateTimeOffset(2026, 8, 25, 10, 0, 0, TimeSpan.Zero),
      "lease-1",
      "7",
      leaseExpiresAt,
      12,
      new string('b', 64),
      new string('c', 64)), CancellationToken.None);

    Assert.Equal("action-1", acknowledgement.ActionId);
    Assert.Equal(1, acknowledgement.DispatchCount);
    Assert.Equal(12, acknowledgement.JournalPrepareSequence);
    Assert.Equal(new string('b', 64), acknowledgement.JournalPreparePreviousHash);
    Assert.Equal(new string('c', 64), acknowledgement.JournalPrepareEntryHash);

    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
    await using var commands = channel.ReadCommandsAsync(timeout.Token).GetAsyncEnumerator();
    Assert.True(await commands.MoveNextAsync());
    Assert.IsType<PingCommand>(commands.Current);
    Assert.True(channel.IsCentralLedgerConnected);
    Assert.Contains(handler.Bodies, body =>
      body.Contains("\"actionId\":\"action-1\"", StringComparison.Ordinal)
      && body.Contains("\"state\":\"Started\"", StringComparison.Ordinal)
      && body.Contains("\"dispatchCount\":1", StringComparison.Ordinal)
      && body.Contains("\"leaseId\":\"lease-1\"", StringComparison.Ordinal)
      && body.Contains("\"fencingToken\":\"7\"", StringComparison.Ordinal)
      && body.Contains("\"leaseExpiresAt\":", StringComparison.Ordinal)
      && body.Contains("\"journalPrepareSequence\":12", StringComparison.Ordinal)
      && body.Contains("\"journalPreparePreviousHash\":", StringComparison.Ordinal)
      && body.Contains("\"journalPrepareEntryHash\":", StringComparison.Ordinal));
    Assert.All(handler.RequestUris, uri =>
      Assert.StartsWith(
        "https://broker.example.test/msaidizi/devices/channel/",
        uri.AbsoluteUri,
        StringComparison.Ordinal));
    Assert.All(handler.Transports, transport =>
    {
      Assert.Equal(HttpVersion.Version11, transport.Version);
      Assert.Equal(HttpVersionPolicy.RequestVersionExact, transport.VersionPolicy);
      Assert.True(transport.ConnectionClose);
    });
  }

  [Fact]
  public async Task ResultRetriesCannotExceedTheBrokerSignedAttemptCount()
  {
    var handler = new RecordingHandler(resultFailures: 5);
    var options = CreateBrokerOptions();
    options.MaxRequestAttempts = 5;
    await using var channel = new HttpPollingCompanionChannel(
      Options.Create(options),
      Options.Create(new CompanionOptions { DeviceId = "device-1" }),
      NullLogger<HttpPollingCompanionChannel>.Instance,
      new HttpClient(handler, disposeHandler: true));
    await channel.ConnectAsync(CancellationToken.None);
    var result = new ActionResult(
      "action-1",
      "task-1",
      "step-1",
      ActionOutcome.Failed,
      OutputJson: null,
      OutputSha256: null,
      MutationCommitted: false,
      OutcomeUncertain: false,
      IsIdempotentReplay: false,
      ErrorCode: "test_failure",
      Provenance: [],
      BrokerExternalEgressBytes: 1_048_576,
      BrokerMaxDeliverySessions: 1,
      BrokerMaxRequestAttemptsPerSession: 1,
      BrokerSerializedResultUpperBoundBytes: 1_048_576,
      LeaseId: "lease-1",
      FencingToken: "7",
      LeaseExpiresAt: DateTimeOffset.UtcNow.AddMinutes(5));

    await Assert.ThrowsAnyAsync<HttpRequestException>(async () =>
      await channel.SendResultAsync(result, CancellationToken.None));

    Assert.Equal(1, handler.ResultRequests);
    var transport = Assert.Single(handler.Transports);
    Assert.Equal(HttpVersion.Version11, transport.Version);
    Assert.Equal(HttpVersionPolicy.RequestVersionExact, transport.VersionPolicy);
    Assert.True(transport.ConnectionClose);
  }

  [Fact]
  public async Task DeserializesTheBackendExecuteCommandEnvelopeStrictly()
  {
    const string executeResponse =
      """
      {"commands":[{"kind":"execute","action":{"request":{"actionId":"action-1","taskId":"task-1","planVersionId":"plan-1","stepId":"step-1","deviceId":"device-1","mandateId":"mandate-1","capabilityId":"companion.noop","capabilityVersion":"1.0.0","argumentsJsonUtf8":"{}","argumentsSha256":"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a","expectedPreStateSha256":null,"inputProvenanceSha256":null,"idempotencyKey":"idempotency-1","leaseId":"lease-1","fencingToken":"7","leaseExpiresAt":"2099-08-25T10:05:00Z"},"compactToken":"header.payload.signature"}}]}
      """;
    await using var channel = new HttpPollingCompanionChannel(
      Options.Create(CreateBrokerOptions()),
      Options.Create(new CompanionOptions { DeviceId = "device-1" }),
      NullLogger<HttpPollingCompanionChannel>.Instance,
      new HttpClient(new RecordingHandler(executeResponse), disposeHandler: true));
    await channel.ConnectAsync(CancellationToken.None);

    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
    await using var commands = channel.ReadCommandsAsync(timeout.Token).GetAsyncEnumerator();

    Assert.True(await commands.MoveNextAsync());
    var execute = Assert.IsType<ExecuteActionCommand>(commands.Current);
    Assert.Equal("action-1", execute.Action.Request.ActionId);
    Assert.Equal("lease-1", execute.Action.Request.LeaseId);
    Assert.Equal("7", execute.Action.Request.FencingToken);
    Assert.Equal(new DateTimeOffset(2099, 8, 25, 10, 5, 0, TimeSpan.Zero),
      execute.Action.Request.LeaseExpiresAt);
    Assert.Equal("header.payload.signature", execute.Action.CompactToken);
    Assert.Equal(ActionExecutionModes.Execute, execute.Action.Request.ExecutionMode);
  }

  [Fact]
  public async Task DeserializesReplayResultCommandWithExplicitReplayOnlyMode()
  {
    const string replayResponse =
      """
      {"commands":[{"kind":"replay-result","action":{"request":{"actionId":"action-1","taskId":"task-1","planVersionId":"plan-1","stepId":"step-1","deviceId":"device-1","mandateId":"mandate-1","capabilityId":"companion.noop","capabilityVersion":"1.0.0","argumentsJsonUtf8":"{}","argumentsSha256":"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a","expectedPreStateSha256":null,"inputProvenanceSha256":null,"idempotencyKey":"idempotency-1","leaseId":"lease-1","fencingToken":"7","leaseExpiresAt":"2099-08-25T10:05:00Z","executionMode":"REPLAY_RESULT_ONLY"},"compactToken":"header.payload.signature"}}]}
      """;
    await using var channel = new HttpPollingCompanionChannel(
      Options.Create(CreateBrokerOptions()),
      Options.Create(new CompanionOptions { DeviceId = "device-1" }),
      NullLogger<HttpPollingCompanionChannel>.Instance,
      new HttpClient(new RecordingHandler(replayResponse), disposeHandler: true));
    await channel.ConnectAsync(CancellationToken.None);

    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
    await using var commands = channel.ReadCommandsAsync(timeout.Token).GetAsyncEnumerator();

    Assert.True(await commands.MoveNextAsync());
    var replay = Assert.IsType<ReplayResultCommand>(commands.Current);
    Assert.Equal(ActionExecutionModes.ReplayResultOnly, replay.Action.Request.ExecutionMode);
    Assert.Equal("action-1", replay.Action.Request.ActionId);
    Assert.Equal("header.payload.signature", replay.Action.CompactToken);
  }

  [Fact]
  public async Task DeserializesCamelCaseFenceActionCommandPolymorphically()
  {
    const string fenceResponse =
      """
      {"commands":[{"kind":"fence-action","fence":{"request":{"fenceId":"fence-1","deviceId":"device-1","actionId":"action-1","taskId":"task-1","stepId":"step-1","oldLeaseId":"lease-1","oldFencingToken":"7","oldActionTokenSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","journalPreviousSequence":11,"journalPreviousHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","dispatchCount":2,"expiresAt":"2099-08-27T10:02:00Z"},"compactToken":"fence.header.payload.signature"}}]}
      """;
    await using var channel = new HttpPollingCompanionChannel(
      Options.Create(CreateBrokerOptions()),
      Options.Create(new CompanionOptions { DeviceId = "device-1" }),
      NullLogger<HttpPollingCompanionChannel>.Instance,
      new HttpClient(new RecordingHandler(fenceResponse), disposeHandler: true));
    await channel.ConnectAsync(CancellationToken.None);

    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
    await using var commands = channel.ReadCommandsAsync(timeout.Token).GetAsyncEnumerator();

    Assert.True(await commands.MoveNextAsync());
    var command = Assert.IsType<FenceActionCommand>(commands.Current);
    Assert.Equal("fence-1", command.Fence.Request.FenceId);
    Assert.Equal("lease-1", command.Fence.Request.OldLeaseId);
    Assert.Equal("7", command.Fence.Request.OldFencingToken);
    Assert.Equal(11, command.Fence.Request.JournalPreviousSequence);
    Assert.Equal(2, command.Fence.Request.DispatchCount);
    Assert.Equal(
      new DateTimeOffset(2099, 8, 27, 10, 2, 0, TimeSpan.Zero),
      command.Fence.Request.ExpiresAt);
    Assert.Equal("fence.header.payload.signature", command.Fence.CompactToken);
  }

  [Fact]
  public async Task SendsActionFencedReceiptWithExactCamelCaseWireNames()
  {
    var handler = new RecordingHandler();
    await using var channel = new HttpPollingCompanionChannel(
      Options.Create(CreateBrokerOptions()),
      Options.Create(new CompanionOptions { DeviceId = "device-1" }),
      NullLogger<HttpPollingCompanionChannel>.Instance,
      new HttpClient(handler, disposeHandler: true));
    await channel.ConnectAsync(CancellationToken.None);
    var receipt = new ActionFencedReceipt(
      FenceId: "fence-1",
      DeviceId: "device-1",
      ActionId: "action-1",
      TaskId: "task-1",
      StepId: "step-1",
      OldLeaseId: "lease-1",
      OldFencingToken: "7",
      OldActionTokenSha256: new string('a', 64),
      FenceDispatchCount: 2,
      CompactToken: "fence.header.payload.signature",
      FenceTokenSha256: new string('b', 64),
      Outcome: ActionFenceOutcomes.NoPrepared,
      JournalPreviousSequence: 11,
      JournalPreviousHash: new string('c', 64),
      TombstoneSequence: 12,
      TombstonePreviousHash: new string('c', 64),
      TombstoneEntryHash: new string('d', 64),
      RecordedAt: new DateTimeOffset(2026, 8, 27, 10, 0, 0, TimeSpan.Zero));

    await channel.SendActionFencedAsync(receipt, CancellationToken.None);

    var body = Assert.Single(
      handler.Bodies,
      candidate => candidate.Contains("\"fenceId\":\"fence-1\"", StringComparison.Ordinal));
    using var document = JsonDocument.Parse(body);
    var root = document.RootElement;
    Assert.Equal("fence-1", root.GetProperty("fenceId").GetString());
    Assert.Equal(2, root.GetProperty("fenceDispatchCount").GetInt32());
    Assert.Equal("NoPrepared", root.GetProperty("outcome").GetString());
    Assert.Equal(12, root.GetProperty("tombstoneSequence").GetInt64());
    Assert.Equal(new string('d', 64), root.GetProperty("tombstoneEntryHash").GetString());
    Assert.False(root.TryGetProperty("FenceId", out _));
    Assert.Contains(
      handler.RequestUris,
      uri => uri.AbsolutePath.EndsWith("/action-fenced", StringComparison.Ordinal));
  }

  [Fact]
  public async Task RefusesProgressAndResultsWithoutALiveLeaseFence()
  {
    var handler = new RecordingHandler();
    await using var channel = new HttpPollingCompanionChannel(
      Options.Create(CreateBrokerOptions()),
      Options.Create(new CompanionOptions { DeviceId = "device-1" }),
      NullLogger<HttpPollingCompanionChannel>.Instance,
      new HttpClient(handler, disposeHandler: true));
    await channel.ConnectAsync(CancellationToken.None);
    var progress = new ActionProgress(
      "action-1",
      "task-1",
      "step-1",
      ActionProgressState.Started,
      0,
      "action_started",
      1,
      DateTimeOffset.UtcNow);
    var result = new ActionResult(
      "action-1",
      "task-1",
      "step-1",
      ActionOutcome.Failed,
      null,
      null,
      false,
      false,
      false,
      "test_failure",
      [],
      BrokerExternalEgressBytes: 1_048_576,
      BrokerMaxDeliverySessions: 1,
      BrokerMaxRequestAttemptsPerSession: 1,
      BrokerSerializedResultUpperBoundBytes: 1_048_576,
      LeaseId: "lease-1",
      FencingToken: "7",
      LeaseExpiresAt: DateTimeOffset.UtcNow.AddSeconds(-1));

    await Assert.ThrowsAsync<InvalidOperationException>(async () =>
      await channel.SendProgressAsync(progress, CancellationToken.None));
    await Assert.ThrowsAsync<InvalidOperationException>(async () =>
      await channel.SendResultAsync(result, CancellationToken.None));
    Assert.Empty(handler.Bodies.Where(body => body.Contains("action-1", StringComparison.Ordinal)));
  }

  [Fact]
  public async Task UnpairedIdentityCompletesFirstTrustOnTheSameOutboundClient()
  {
    var handler = new RecordingHandler();
    using var provisioner = new RecordingIdentityProvisioner("device-1");
    var brokerOptions = CreateBrokerOptions();
    brokerOptions.DeviceCertificateThumbprint = string.Empty;
    brokerOptions.BootstrapIdentityEnabled = true;
    brokerOptions.PairingCode = "ABCD-EF12-3456";
    await using var channel = new HttpPollingCompanionChannel(
      Options.Create(brokerOptions),
      Options.Create(new CompanionOptions { DeviceId = "device-1" }),
      NullLogger<HttpPollingCompanionChannel>.Instance,
      new HttpClient(handler, disposeHandler: true),
      provisioner);

    await channel.ConnectAsync(CancellationToken.None);

    Assert.True(provisioner.MarkedPaired);
    var pairingUri = Assert.Single(
      handler.RequestUris,
      uri => uri.AbsolutePath.EndsWith("/msaidizi/devices/pairing/complete", StringComparison.Ordinal));
    Assert.Equal("https", pairingUri.Scheme);
    Assert.Contains(handler.Bodies, body =>
      body.Contains("\"pairingCode\":\"ABCD-EF12-3456\"", StringComparison.Ordinal)
      && body.Contains("\"deviceId\":\"device-1\"", StringComparison.Ordinal)
      && body.Contains("\"capabilities\":[]", StringComparison.Ordinal));
  }

  private static BrokerChannelOptions CreateBrokerOptions() => new()
  {
    Enabled = true,
    Endpoint = "https://broker.example.test/msaidizi/devices/channel",
    DeviceCertificateThumbprint = new string('A', 40),
    ServerCertificateSha256Pin = new string('B', 64),
    MaxRequestAttempts = 1,
    MaximumRetryDelaySeconds = 1,
    PollIntervalMilliseconds = 100,
  };

  private sealed class RecordingHandler(
    string? pollBody = null,
    int resultFailures = 0,
    bool wrongReconciliationDevice = false) :
    HttpMessageHandler
  {
    private int _resultRequests;

    public ConcurrentQueue<string> Bodies { get; } = new();

    public ConcurrentQueue<Uri> RequestUris { get; } = new();

    public ConcurrentQueue<RequestTransport> Transports { get; } = new();

    public int ResultRequests => Volatile.Read(ref _resultRequests);

    protected override async Task<HttpResponseMessage> SendAsync(
      HttpRequestMessage request,
      CancellationToken cancellationToken)
    {
      RequestUris.Enqueue(request.RequestUri!);
      Transports.Enqueue(new RequestTransport(
        request.Version,
        request.VersionPolicy,
        request.Headers.ConnectionClose == true));
      var requestBody = request.Content is null
        ? string.Empty
        : await request.Content.ReadAsStringAsync(cancellationToken);
      Bodies.Enqueue(requestBody);
      if (request.RequestUri!.AbsolutePath.EndsWith("/result", StringComparison.Ordinal)
        && Interlocked.Increment(ref _resultRequests) <= resultFailures)
      {
        return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
        {
          Content = new StringContent("{}", Encoding.UTF8, "application/json"),
        };
      }
      var body = request.RequestUri!.AbsolutePath.EndsWith("/poll", StringComparison.Ordinal)
        ? pollBody
          ?? "{\"commands\":[{\"kind\":\"ping\",\"correlationId\":\"correlation-1\",\"sentAt\":\"2026-08-25T10:00:00Z\"}]}"
        : request.RequestUri.AbsolutePath.EndsWith("/pairing/complete", StringComparison.Ordinal)
          ? "{\"deviceId\":\"device-1\",\"status\":\"ACTIVE\"}"
          : request.RequestUri.AbsolutePath.EndsWith("/progress", StringComparison.Ordinal)
            ? PreparedProgressAcknowledgement(requestBody)
            : request.RequestUri.AbsolutePath.EndsWith("/journal-reconcile", StringComparison.Ordinal)
              ? JournalReconciliationAcknowledgement(requestBody, wrongReconciliationDevice)
              : request.RequestUri.AbsolutePath.EndsWith("/journal-head", StringComparison.Ordinal)
                ? "{\"deviceId\":\"device-1\",\"sequence\":0,\"hashVersion\":0,\"entryHash\":\"0000000000000000000000000000000000000000000000000000000000000000\"}"
              : "{\"accepted\":true}";
      return new HttpResponseMessage(HttpStatusCode.OK)
      {
        Content = new StringContent(body, Encoding.UTF8, "application/json"),
      };
    }

    private static string PreparedProgressAcknowledgement(string requestBody)
    {
      using var document = JsonDocument.Parse(requestBody);
      var progress = document.RootElement;
      if (!progress.TryGetProperty("journalPrepareSequence", out var sequence)
        || !progress.TryGetProperty("journalPreparePreviousHash", out var previousHash)
        || !progress.TryGetProperty("journalPrepareEntryHash", out var entryHash))
      {
        return "{\"accepted\":true}";
      }
      return JsonSerializer.Serialize(new
      {
        accepted = true,
        actionId = progress.GetProperty("actionId").GetString(),
        dispatchCount = progress.GetProperty("dispatchCount").GetInt32(),
        journalPrepareSequence = sequence.GetInt64(),
        journalPreparePreviousHash = previousHash.GetString(),
        journalPrepareEntryHash = entryHash.GetString(),
      });
    }

    private static string JournalReconciliationAcknowledgement(
      string requestBody,
      bool wrongDevice)
    {
      using var document = JsonDocument.Parse(requestBody);
      var reconciliation = document.RootElement;
      var finalSequence = reconciliation.GetProperty("finalSequence").GetInt64();
      var finalHash = reconciliation.GetProperty("finalHash").GetString();
      var localHeadSequence = reconciliation.GetProperty("localHeadSequence").GetInt64();
      var localHeadHash = reconciliation.GetProperty("localHeadHash").GetString();
      return JsonSerializer.Serialize(new
      {
        accepted = true,
        deviceId = wrongDevice
          ? "other-device"
          : reconciliation.GetProperty("deviceId").GetString(),
        startingPreviousSequence = reconciliation.GetProperty("startingPreviousSequence").GetInt64(),
        startingPreviousHash = reconciliation.GetProperty("startingPreviousHash").GetString(),
        acceptedThroughSequence = finalSequence,
        acceptedThroughHash = finalHash,
        localHeadSequence,
        localHeadHash,
        exactHead = finalSequence == localHeadSequence
          && string.Equals(finalHash, localHeadHash, StringComparison.OrdinalIgnoreCase),
      });
    }
  }

  private sealed record RequestTransport(
    Version Version,
    HttpVersionPolicy VersionPolicy,
    bool ConnectionClose);

  private sealed class RecordingIdentityProvisioner : IDeviceIdentityProvisioner, IDisposable
  {
    private readonly ProvisionedDeviceIdentity _identity;

    public RecordingIdentityProvisioner(string deviceId)
    {
      using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
      var request = new CertificateRequest("CN=Test Device", key, HashAlgorithmName.SHA256);
      var certificate = request.CreateSelfSigned(
        DateTimeOffset.UtcNow.AddMinutes(-1),
        DateTimeOffset.UtcNow.AddDays(1));
      _identity = new ProvisionedDeviceIdentity(
        certificate,
        Convert.ToHexString(SHA256.HashData(certificate.RawData)),
        Convert.ToHexString(SHA256.HashData(certificate.PublicKey.ExportSubjectPublicKeyInfo())),
        $"test-{deviceId}",
        "test-provider",
        HardwareBacked: false,
        IsPaired: false);
    }

    public bool MarkedPaired { get; private set; }

    public ValueTask<ProvisionedDeviceIdentity> GetOrCreateAsync(
      string deviceId,
      CancellationToken cancellationToken) => ValueTask.FromResult(_identity);

    public ValueTask MarkPairedAsync(
      ProvisionedDeviceIdentity identity,
      CancellationToken cancellationToken)
    {
      Assert.Same(_identity, identity);
      MarkedPaired = true;
      return ValueTask.CompletedTask;
    }

    public void Dispose() => _identity.Dispose();
  }
}
