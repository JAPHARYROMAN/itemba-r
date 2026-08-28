using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Agent.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class AudioPlaybackDescriptorTests
{
  [Fact]
  public void CatalogAndAdapterDeclareTruthfulIrreversibleDefaultSurface()
  {
    var adapter = new WavAudioPlaybackCapabilityAdapter(
      new RecordingAudioDevice(waitForCancellation: false));
    var descriptor = StandardUserCapabilityCatalog.AudioPlayback;

    Assert.Same(descriptor, adapter.Descriptor);
    Assert.Equal("audio.wav.play", descriptor.Id);
    Assert.Equal("1.0.0", descriptor.Version);
    Assert.Equal(CapabilityDataClass.Restricted, descriptor.DataClass);
    Assert.Equal(CapabilityEffect.LocalWrite, descriptor.Effect);
    Assert.Equal(ConsentRequirement.ActiveUser, descriptor.Consent);
    Assert.Equal(RecoveryKind.Irreversible, descriptor.Recovery);
    Assert.Equal(RequiredPrivilege.StandardUser, descriptor.RequiredPrivilege);
    Assert.Equal(IdempotencySemantics.Required, descriptor.Idempotency);
    Assert.False(descriptor.TouchesTrustedRoot);
    Assert.Contains("cannot be undone", descriptor.Description, StringComparison.Ordinal);
    Assert.Contains("cancellation", descriptor.Description, StringComparison.Ordinal);
    Assert.False(descriptor.ArgumentsSchema.GetProperty("additionalProperties").GetBoolean());
    Assert.False(descriptor.ResultSchema.GetProperty("additionalProperties").GetBoolean());
    Assert.Contains(
      StandardUserCapabilityCatalog.DescribeRequestedSurface(
        browserExternalEffectsEnabled: false,
        emergencyCommandEnabled: false),
      candidate => candidate == descriptor);
    Assert.Contains(
      StandardUserCapabilityCatalog.SelectEnabled(
        browserExternalEffectsEnabled: false,
        emergencyCommandEnabled: false),
      candidate => candidate == descriptor);
  }

  [Fact]
  public async Task SuccessfulPlaybackAtExactBudgetClaimsWriteAccountingAndNoRecovery()
  {
    var device = new RecordingAudioDevice(waitForCancellation: false);
    var adapter = new WavAudioPlaybackCapabilityAdapter(device);
    var content = BuildPcmWav(durationMilliseconds: 100);
    using var arguments = Arguments(content);
    var context = ContextWithMaxLocalBytes(content.LongLength);

    Assert.True(adapter.ValidateArguments(arguments.RootElement).IsValid);
    var result = await adapter.ExecuteAsync(
      context,
      arguments.RootElement,
      CancellationToken.None);

    Assert.True(result.MutationCommitted);
    Assert.False(result.OutcomeUncertain);
    Assert.Null(result.OpaqueRecoveryHandle);
    Assert.Null(result.RecoveryProvenanceSha256);
    Assert.Null(result.EgressReceipt);
    Assert.Null(result.PreStateSha256);
    Assert.Equal(0, result.LocalBytesRead);
    Assert.Equal(content.LongLength, result.LocalBytesWritten);
    Assert.Equal(context.Budgets.MaxLocalBytes, result.LocalBytesRead + result.LocalBytesWritten);
    Assert.DoesNotContain(
      result.Provenance,
      provenance => provenance.SourceType.Contains("recovery", StringComparison.OrdinalIgnoreCase));
    using var output = JsonDocument.Parse(result.OutputJson);
    Assert.True(adapter.ValidateResult(output.RootElement).IsValid);
    Assert.True(output.RootElement.GetProperty("played").GetBoolean());
    Assert.Equal(1, device.PlayInvocationCount);
    Assert.All(device.PlaybackBuffer!, value => Assert.Equal(0, value));
  }

  [Fact]
  public async Task OneByteShortBudgetRejectsBeforeAudioDeviceWrite()
  {
    var device = new RecordingAudioDevice(waitForCancellation: false);
    var adapter = new WavAudioPlaybackCapabilityAdapter(device);
    var content = BuildPcmWav(durationMilliseconds: 100);
    using var arguments = Arguments(content);

    var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
      adapter.ExecuteAsync(
        ContextWithMaxLocalBytes(content.LongLength - 1),
        arguments.RootElement,
        CancellationToken.None).AsTask());

    Assert.Equal("audio_playback_exceeds_local_budget", exception.Message);
    Assert.Equal(0, device.PlayInvocationCount);
    Assert.False(device.PartialAudibleOutputOccurred);
    Assert.Null(device.PlaybackBuffer);
  }

  [Fact]
  public async Task CancellationAfterPartialAudibleOutputHasNoResultAndRemainsIrreversible()
  {
    var device = new RecordingAudioDevice(waitForCancellation: true);
    var adapter = new WavAudioPlaybackCapabilityAdapter(device);
    using var arguments = Arguments(BuildPcmWav(durationMilliseconds: 100));
    using var cancellation = new CancellationTokenSource();
    CapabilityExecutionResult? result = null;

    var playback = Task.Run(async () =>
    {
      result = await adapter.ExecuteAsync(
        Context,
        arguments.RootElement,
        cancellation.Token);
    });
    await device.Started.Task.WaitAsync(TimeSpan.FromSeconds(2));
    cancellation.Cancel();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => playback);
    Assert.True(device.PartialAudibleOutputOccurred);
    Assert.Null(result);
    Assert.Equal(RecoveryKind.Irreversible, adapter.Descriptor.Recovery);
    Assert.All(device.PlaybackBuffer!, value => Assert.Equal(0, value));
  }

  private static JsonDocument Arguments(byte[] content) => JsonDocument.Parse(
    JsonSerializer.Serialize(new
    {
      contentBase64 = Convert.ToBase64String(content),
      maxDurationMilliseconds = 1_000,
    }));

  private static byte[] BuildPcmWav(int durationMilliseconds)
  {
    const int samplesPerSecond = 16_000;
    const short bitsPerSample = 16;
    const short channels = 1;
    var dataBytes = checked(
      samplesPerSecond * durationMilliseconds / 1_000 * bitsPerSample / 8);
    using var stream = new MemoryStream(44 + dataBytes);
    using var writer = new BinaryWriter(stream, Encoding.ASCII, leaveOpen: true);
    writer.Write("RIFF"u8);
    writer.Write(checked(36 + dataBytes));
    writer.Write("WAVE"u8);
    writer.Write("fmt "u8);
    writer.Write(16);
    writer.Write((short)1);
    writer.Write(channels);
    writer.Write(samplesPerSecond);
    writer.Write(samplesPerSecond * channels * bitsPerSample / 8);
    writer.Write((short)(channels * bitsPerSample / 8));
    writer.Write(bitsPerSample);
    writer.Write("data"u8);
    writer.Write(dataBytes);
    writer.Write(new byte[dataBytes]);
    writer.Flush();
    return stream.ToArray();
  }

  private static ActionExecutionContext Context =>
    ContextWithMaxLocalBytes(67_108_864);

  private static ActionExecutionContext ContextWithMaxLocalBytes(long maximumLocalBytes) =>
    new(
      "audio-action",
      "task",
      "plan",
      "step",
      "device",
      "mandate",
      "audio-idempotency",
      null,
      null,
      new ActionBudget(60, 10, 10, 0, maximumLocalBytes, 67_108_864, 1));

  private sealed class RecordingAudioDevice(bool waitForCancellation) :
    IInteractiveAudioDevice
  {
    public TaskCompletionSource Started { get; } = new(
      TaskCreationOptions.RunContinuationsAsynchronously);

    public byte[]? PlaybackBuffer { get; private set; }

    public bool PartialAudibleOutputOccurred { get; private set; }

    public int PlayInvocationCount { get; private set; }

    public ValueTask<byte[]> CapturePcmWavAsync(
      int durationMilliseconds,
      long maximumBytes,
      CancellationToken cancellationToken) => throw new NotSupportedException();

    public async ValueTask PlayPcmWavAsync(
      byte[] content,
      int maximumDurationMilliseconds,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      PlayInvocationCount++;
      PlaybackBuffer = content;
      PartialAudibleOutputOccurred = true;
      Started.TrySetResult();
      if (waitForCancellation)
      {
        await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
      }
    }
  }
}
