using System.Runtime.CompilerServices;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Channel;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Channel;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class CapabilityManifestPublisherTests
{
  [Fact]
  public async Task RetriesAnUnacknowledgedInitialManifestWithoutAServiceRestart()
  {
    var channel = new ManifestChannel(failuresBeforeAcknowledgement: 2);
    var publisher = CreatePublisher(channel);

    await publisher.PublishUntilAcknowledgedAsync(CancellationToken.None);

    Assert.Equal(3, channel.Attempts);
    Assert.Equal(3, channel.Manifests.Count);
    Assert.All(channel.Manifests, manifest =>
    {
      Assert.Equal("20000000-0000-4000-8000-000000000002", manifest.DeviceId);
      Assert.Equal(CompanionCommandProtocol.CurrentVersion, manifest.CommandProtocolVersion);
      Assert.Empty(manifest.Capabilities);
      Assert.Equal(channel.Manifests[0].ManifestSha256, manifest.ManifestSha256);
    });
    Assert.True(channel.Manifests[1].GeneratedAt >= channel.Manifests[0].GeneratedAt);
    Assert.True(channel.Manifests[2].GeneratedAt >= channel.Manifests[1].GeneratedAt);
  }

  [Fact]
  public async Task CancellationStopsManifestReconciliationAndIsNotSwallowed()
  {
    var channel = new ManifestChannel(failuresBeforeAcknowledgement: int.MaxValue);
    var publisher = CreatePublisher(channel);
    using var cancellation = new CancellationTokenSource();
    var publishing = publisher.PublishUntilAcknowledgedAsync(cancellation.Token);

    await channel.FirstAttempt.Task.WaitAsync(TimeSpan.FromSeconds(5));
    cancellation.Cancel();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => publishing);
    Assert.True(channel.Attempts >= 1);
  }

  [Fact]
  public async Task RuntimeWithdrawalPublishesAReplacementManifest()
  {
    var channel = new ManifestChannel(failuresBeforeAcknowledgement: 0);
    var adapter = new RuntimeAdapter(
      StandardUserCapabilityCatalog.EmergencyCommandExecute);
    var registry = new CapabilityRegistry([adapter]);
    var publisher = CreatePublisher(channel, registry);
    var acknowledged = await publisher.PublishUntilAcknowledgedAsync(
      CancellationToken.None);
    Assert.Single(channel.Manifests[0].Capabilities);

    using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(5));
    var changes = publisher.PublishChangesAsync(acknowledged, cancellation.Token);
    adapter.IsAvailable = false;
    while (channel.Manifests.Count < 2)
    {
      await Task.Delay(20, cancellation.Token);
    }
    await cancellation.CancelAsync();
    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => changes);

    Assert.Empty(channel.Manifests[1].Capabilities);
    Assert.NotEqual(
      channel.Manifests[0].ManifestSha256,
      channel.Manifests[1].ManifestSha256);
    Assert.False(registry.TryResolve(
      adapter.Descriptor.Id,
      adapter.Descriptor.Version,
      out _));
  }

  private static CapabilityManifestPublisher CreatePublisher(
    ManifestChannel channel,
    CapabilityRegistry? registry = null) => new(
    Options.Create(new CompanionOptions
    {
      DeviceId = "20000000-0000-4000-8000-000000000002",
    }),
    Options.Create(new BrokerChannelOptions
    {
      InitialRetryDelayMilliseconds = 1,
      MaximumRetryDelaySeconds = 1,
    }),
    registry ?? new CapabilityRegistry([]),
    channel,
    NullLogger<CapabilityManifestPublisher>.Instance);

  private sealed class RuntimeAdapter(CapabilityDescriptor descriptor) :
    IHostCapabilityAdapter,
    IRuntimeCapabilityAvailability
  {
    public CapabilityDescriptor Descriptor { get; } = descriptor;

    public bool IsAvailable { get; set; } = true;

    public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
      CapabilityArgumentValidation.Success;

    public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
      CapabilityArgumentValidation.Success;

    public ValueTask<CapabilityExecutionResult> ExecuteAsync(
      ActionExecutionContext context,
      JsonElement arguments,
      CancellationToken cancellationToken) =>
      throw new NotSupportedException();
  }

  private sealed class ManifestChannel(int failuresBeforeAcknowledgement) :
    IOutboundCompanionChannel
  {
    private int _attempts;

    public int Attempts => Volatile.Read(ref _attempts);

    public List<CapabilityManifestSnapshot> Manifests { get; } = [];

    public TaskCompletionSource FirstAttempt { get; } = new(
      TaskCreationOptions.RunContinuationsAsynchronously);

    public OutboundChannelState State => OutboundChannelState.Connected;

    public bool IsCentralLedgerConnected => true;

    public ValueTask ConnectAsync(CancellationToken cancellationToken) => ValueTask.CompletedTask;

    public async IAsyncEnumerable<DeviceCommand> ReadCommandsAsync(
      [EnumeratorCancellation] CancellationToken cancellationToken)
    {
      await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
      yield break;
    }

    public ValueTask<ActionProgressAcknowledgement> SendProgressAsync(
      ActionProgress progress,
      CancellationToken cancellationToken) => ValueTask.FromResult(
        new ActionProgressAcknowledgement(Accepted: true));

    public ValueTask SendResultAsync(
      ActionResult result,
      CancellationToken cancellationToken) => ValueTask.CompletedTask;

    public ValueTask SendHeartbeatAsync(
      CompanionHeartbeat heartbeat,
      CancellationToken cancellationToken) => ValueTask.CompletedTask;

    public ValueTask SendManifestAsync(
      CapabilityManifestSnapshot manifest,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      Manifests.Add(manifest);
      var attempt = Interlocked.Increment(ref _attempts);
      FirstAttempt.TrySetResult();
      return attempt <= failuresBeforeAcknowledgement
        ? ValueTask.FromException(new HttpRequestException("simulated response loss"))
        : ValueTask.CompletedTask;
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
  }
}
