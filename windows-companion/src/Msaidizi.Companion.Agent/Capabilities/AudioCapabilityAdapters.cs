using System.Buffers.Binary;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Contracts.SessionBridge;

namespace Itemba.Msaidizi.Companion.Agent.Capabilities;

public interface IInteractiveAudioDevice
{
  ValueTask<byte[]> CapturePcmWavAsync(
    int durationMilliseconds,
    long maximumBytes,
    CancellationToken cancellationToken);

  ValueTask PlayPcmWavAsync(
    byte[] content,
    int maximumDurationMilliseconds,
    CancellationToken cancellationToken);
}

public sealed class WinMmInteractiveAudioDevice : IInteractiveAudioDevice, IDisposable
{
  private const uint SoundSync = 0x0000;
  private const uint SoundMemory = 0x0004;
  private const uint SoundNodefault = 0x0002;
  private const uint SoundPurge = 0x0040;
  private readonly SemaphoreSlim _captureGate = new(1, 1);

  public async ValueTask<byte[]> CapturePcmWavAsync(
    int durationMilliseconds,
    long maximumBytes,
    CancellationToken cancellationToken)
  {
    await _captureGate.WaitAsync(cancellationToken).ConfigureAwait(false);
    var alias = $"msaidizi{Guid.NewGuid():N}";
    var path = Path.Combine(Path.GetTempPath(), $"{alias}.wav");
    try
    {
      ExecuteMci($"open new type waveaudio alias {alias}");
      ExecuteMci($"set {alias} time format milliseconds");
      ExecuteMci($"set {alias} bitspersample 16 channels 1 samplespersec 16000 bytespersec 32000 alignment 2");
      ExecuteMci($"record {alias}");
      try
      {
        await Task.Delay(durationMilliseconds, cancellationToken).ConfigureAwait(false);
      }
      finally
      {
        _ = MciSendString($"stop {alias}", IntPtr.Zero, 0, IntPtr.Zero);
      }

      cancellationToken.ThrowIfCancellationRequested();
      ExecuteMci($"save {alias} \"{path}\"");
      var fileInfo = new FileInfo(path);
      if (!fileInfo.Exists
        || fileInfo.Length <= 44
        || fileInfo.Length > maximumBytes
        || fileInfo.Length > int.MaxValue)
      {
        throw new InvalidOperationException("microphone_capture_exceeds_budget");
      }

      var content = await File.ReadAllBytesAsync(path, cancellationToken).ConfigureAwait(false);
      _ = PcmWavInspector.Inspect(content, durationMilliseconds + 2_000);
      return content;
    }
    finally
    {
      _ = MciSendString($"close {alias}", IntPtr.Zero, 0, IntPtr.Zero);
      if (File.Exists(path))
      {
        File.Delete(path);
      }

      _captureGate.Release();
    }
  }

  public async ValueTask PlayPcmWavAsync(
    byte[] content,
    int maximumDurationMilliseconds,
    CancellationToken cancellationToken)
  {
    _ = PcmWavInspector.Inspect(content, maximumDurationMilliseconds);
    using var registration = cancellationToken.Register(
      () => _ = PlaySound(null, IntPtr.Zero, SoundPurge));
    var played = await Task.Run(
      () => PlaySound(content, IntPtr.Zero, SoundSync | SoundMemory | SoundNodefault),
      CancellationToken.None).ConfigureAwait(false);
    cancellationToken.ThrowIfCancellationRequested();
    if (!played)
    {
      throw new InvalidOperationException("audio_playback_failed");
    }
  }

  public void Dispose() => _captureGate.Dispose();

  private static void ExecuteMci(string command)
  {
    var code = MciSendString(command, IntPtr.Zero, 0, IntPtr.Zero);
    if (code != 0)
    {
      throw new InvalidOperationException($"winmm_mci_error_{code}");
    }
  }

  [DllImport("winmm.dll", EntryPoint = "mciSendStringW", CharSet = CharSet.Unicode)]
  private static extern int MciSendString(
    string command,
    IntPtr returnValue,
    int returnLength,
    IntPtr callbackWindow);

  [DllImport("winmm.dll", EntryPoint = "PlaySoundW", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool PlaySound(
    byte[]? sound,
    IntPtr module,
    uint flags);
}

public sealed class MicrophoneCaptureCapabilityAdapter(
  IInteractiveAudioDevice audio) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor => StandardUserCapabilityCatalog.MicrophoneCapture;

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    InteractiveJsonValidation.HasExactProperties(arguments, "durationMilliseconds")
      && arguments.GetProperty("durationMilliseconds").TryGetInt32(out var duration)
      && duration is >= 100 and <= 30_000
        ? CapabilityArgumentValidation.Success
        : InteractiveJsonValidation.Invalid("Microphone duration is outside policy.");

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    ValidateMediaResult(result, "audio/wav");

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var requestedDuration = arguments.GetProperty("durationMilliseconds").GetInt32();
    var maximumBytes = Math.Min(
      context.Budgets.MaxLocalBytes,
      context.Budgets.MaxExternalEgressBytes);
    var content = await audio.CapturePcmWavAsync(
      requestedDuration,
      maximumBytes,
      cancellationToken).ConfigureAwait(false);
    try
    {
      var inspected = PcmWavInspector.Inspect(content, requestedDuration + 2_000);
      var digest = Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
      var output = JsonSerializer.Serialize(new
      {
        mediaType = "audio/wav",
        contentBase64 = Convert.ToBase64String(content),
        durationMilliseconds = inspected.DurationMilliseconds,
        contentSha256 = digest,
      });
      return new CapabilityExecutionResult(
        output,
        MutationCommitted: false,
        OutcomeUncertain: false,
        Provenance:
        [
          new DataProvenance(
            "interactive-microphone",
            PayloadDigest.Sha256Hex($"default-microphone:{Environment.ProcessId}"),
            digest,
            ProvenanceTrust.UntrustedContent,
            DateTimeOffset.UtcNow),
        ],
        LocalBytesRead: content.LongLength);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(content);
    }
  }

  private static CapabilityArgumentValidation ValidateMediaResult(
    JsonElement result,
    string mediaType)
  {
    if (!InteractiveJsonValidation.HasExactProperties(
      result,
      "mediaType",
      "contentBase64",
      "durationMilliseconds",
      "contentSha256")
      || result.GetProperty("mediaType").GetString() != mediaType
      || result.GetProperty("contentBase64").ValueKind != JsonValueKind.String
      || !result.GetProperty("durationMilliseconds").TryGetInt32(out var duration)
      || duration <= 0
      || !InteractiveJsonValidation.IsSha256(result.GetProperty("contentSha256")))
    {
      return InteractiveJsonValidation.InvalidResult("Audio capture result is invalid.");
    }

    try
    {
      var content = Convert.FromBase64String(result.GetProperty("contentBase64").GetString()!);
      return SessionBridgeAuthentication.FixedTimeEqualsHex(
        result.GetProperty("contentSha256").GetString()!,
        Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant())
          ? CapabilityArgumentValidation.Success
          : InteractiveJsonValidation.InvalidResult("Audio content digest does not match.");
    }
    catch (FormatException)
    {
      return InteractiveJsonValidation.InvalidResult("Audio content is not Base64.");
    }
  }
}

public sealed class WavAudioPlaybackCapabilityAdapter(
  IInteractiveAudioDevice audio) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor => StandardUserCapabilityCatalog.AudioPlayback;

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments)
  {
    if (!InteractiveJsonValidation.HasExactProperties(
      arguments,
      "contentBase64",
      "maxDurationMilliseconds")
      || arguments.GetProperty("contentBase64").ValueKind != JsonValueKind.String
      || !arguments.GetProperty("maxDurationMilliseconds").TryGetInt32(out var maximum)
      || maximum is < 100 or > 120_000)
    {
      return InteractiveJsonValidation.Invalid("WAV playback arguments are invalid.");
    }

    try
    {
      var content = Convert.FromBase64String(arguments.GetProperty("contentBase64").GetString()!);
      _ = PcmWavInspector.Inspect(content, maximum);
      return content.LongLength <= 67_108_864
        ? CapabilityArgumentValidation.Success
        : InteractiveJsonValidation.Invalid("WAV playback payload is too large.");
    }
    catch (FormatException)
    {
      return InteractiveJsonValidation.Invalid("WAV playback payload is not Base64.");
    }
    catch (InvalidDataException)
    {
      return InteractiveJsonValidation.Invalid("WAV playback payload is invalid.");
    }
  }

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    InteractiveJsonValidation.HasExactProperties(result, "played", "contentSha256")
    && result.GetProperty("played").ValueKind == JsonValueKind.True
    && InteractiveJsonValidation.IsSha256(result.GetProperty("contentSha256"))
      ? CapabilityArgumentValidation.Success
      : InteractiveJsonValidation.InvalidResult("Audio playback result is invalid.");

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var content = Convert.FromBase64String(arguments.GetProperty("contentBase64").GetString()!);
    try
    {
      var localBytesWritten = content.LongLength;
      if (localBytesWritten > context.Budgets.MaxLocalBytes)
      {
        throw new InvalidOperationException("audio_playback_exceeds_local_budget");
      }

      await audio.PlayPcmWavAsync(
        content,
        arguments.GetProperty("maxDurationMilliseconds").GetInt32(),
        cancellationToken).ConfigureAwait(false);
      var digest = Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
      var output = JsonSerializer.Serialize(new { played = true, contentSha256 = digest });
      return new CapabilityExecutionResult(
        output,
        MutationCommitted: true,
        OutcomeUncertain: false,
        Provenance:
        [
          new DataProvenance(
            "interactive-audio-output",
            PayloadDigest.Sha256Hex($"default-audio-output:{Environment.ProcessId}"),
            digest,
            ProvenanceTrust.UserSupplied,
            DateTimeOffset.UtcNow),
        ],
        LocalBytesWritten: localBytesWritten);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(content);
    }
  }
}

internal static class PcmWavInspector
{
  public static PcmWavInfo Inspect(ReadOnlySpan<byte> content, int maximumDurationMilliseconds)
  {
    if (content.Length < 44
      || !content[..4].SequenceEqual("RIFF"u8)
      || !content.Slice(8, 4).SequenceEqual("WAVE"u8))
    {
      throw new InvalidDataException("The payload is not a RIFF/WAVE file.");
    }

    var offset = 12;
    uint byteRate = 0;
    uint dataLength = 0;
    var pcm = false;
    while (offset <= content.Length - 8)
    {
      var id = content.Slice(offset, 4);
      var length = BinaryPrimitives.ReadUInt32LittleEndian(content.Slice(offset + 4, 4));
      var dataOffset = checked(offset + 8);
      if (length > int.MaxValue
        || dataOffset > content.Length
        || checked(dataOffset + (int)length) > content.Length)
      {
        throw new InvalidDataException("A WAV chunk exceeds the payload.");
      }

      if (id.SequenceEqual("fmt "u8))
      {
        if (length < 16)
        {
          throw new InvalidDataException("The WAV format chunk is truncated.");
        }

        var format = BinaryPrimitives.ReadUInt16LittleEndian(content.Slice(dataOffset, 2));
        var channels = BinaryPrimitives.ReadUInt16LittleEndian(content.Slice(dataOffset + 2, 2));
        var sampleRate = BinaryPrimitives.ReadUInt32LittleEndian(content.Slice(dataOffset + 4, 4));
        byteRate = BinaryPrimitives.ReadUInt32LittleEndian(content.Slice(dataOffset + 8, 4));
        var bitsPerSample = BinaryPrimitives.ReadUInt16LittleEndian(content.Slice(dataOffset + 14, 2));
        pcm = format == 1
          && channels is >= 1 and <= 2
          && sampleRate is >= 8_000 and <= 48_000
          && bitsPerSample is 8 or 16 or 24 or 32
          && byteRate > 0;
      }
      else if (id.SequenceEqual("data"u8))
      {
        dataLength = length;
      }

      offset = checked(dataOffset + (int)length + ((length & 1) == 0 ? 0 : 1));
    }

    if (!pcm || dataLength == 0 || byteRate == 0)
    {
      throw new InvalidDataException("Only bounded PCM WAV audio is supported.");
    }

    var duration = checked((int)Math.Ceiling(dataLength * 1000d / byteRate));
    if (duration <= 0 || duration > maximumDurationMilliseconds)
    {
      throw new InvalidDataException("WAV duration exceeds the declared bound.");
    }

    return new PcmWavInfo(duration);
  }
}

public sealed record PcmWavInfo(int DurationMilliseconds);
