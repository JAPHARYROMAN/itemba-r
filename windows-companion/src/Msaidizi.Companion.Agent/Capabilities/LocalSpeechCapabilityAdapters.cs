using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Itemba.Msaidizi.Companion.Agent.Configuration;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Agent.Capabilities;

internal sealed record ApprovedSpeechVoice(
  string Id,
  string InstalledVoiceName,
  string CultureName);

internal sealed record ApprovedSpeechRecognizer(
  string Id,
  string InstalledRecognizerId,
  string CultureName);

internal sealed class LocalSpeechPolicy
{
  private readonly Dictionary<string, ApprovedSpeechVoice> _voices;
  private readonly Dictionary<string, ApprovedSpeechRecognizer> _recognizers;
  public long MaximumAudioBytes { get; }
  public int MaximumTranscriptCharacters { get; }

  public LocalSpeechPolicy(IOptions<AgentOptions> options)
  {
    MaximumAudioBytes = Math.Clamp(
      options.Value.MaximumSpeechAudioBytes,
      65_536,
      16_777_216);
    MaximumTranscriptCharacters = Math.Clamp(
      options.Value.MaximumTranscriptCharacters,
      1,
      32_768);
    _voices = options.Value.AllowedSpeechVoices
      .Select(ParseVoice)
      .ToDictionary(voice => voice.Id, StringComparer.Ordinal);
    _recognizers = options.Value.AllowedOfflineSpeechRecognizers
      .Select(ParseRecognizer)
      .ToDictionary(recognizer => recognizer.Id, StringComparer.Ordinal);
    if (_voices.Values.Select(voice => voice.InstalledVoiceName)
        .Distinct(StringComparer.Ordinal).Count() != _voices.Count
      || _recognizers.Values.Select(recognizer => recognizer.InstalledRecognizerId)
        .Distinct(StringComparer.Ordinal).Count() != _recognizers.Count)
    {
      throw new InvalidOperationException("Local speech allowlists contain duplicate installed identities.");
    }
  }

  public ApprovedSpeechVoice ResolveVoice(string id) => _voices.TryGetValue(id, out var voice)
    ? voice
    : throw new InvalidOperationException("speech_voice_not_allowed");

  public ApprovedSpeechRecognizer ResolveRecognizer(string id) =>
    _recognizers.TryGetValue(id, out var recognizer)
      ? recognizer
      : throw new InvalidOperationException("speech_recognizer_not_allowed");

  private static ApprovedSpeechVoice ParseVoice(AllowedSpeechVoiceOptions voice)
  {
    if (!IsSafeId(voice.Id)
      || string.IsNullOrWhiteSpace(voice.InstalledVoiceName)
      || voice.InstalledVoiceName.Length > 256
      || voice.InstalledVoiceName.Contains('\0')
      || string.IsNullOrWhiteSpace(voice.CultureName)
      || voice.CultureName.Length > 64)
    {
      throw new InvalidOperationException("An allowed speech voice is invalid.");
    }
    try
    {
      _ = CultureInfo.GetCultureInfo(voice.CultureName);
    }
    catch (CultureNotFoundException exception)
    {
      throw new InvalidOperationException("An allowed speech voice culture is invalid.", exception);
    }
    return new ApprovedSpeechVoice(
      voice.Id,
      voice.InstalledVoiceName,
      voice.CultureName);
  }

  private static ApprovedSpeechRecognizer ParseRecognizer(
    AllowedOfflineSpeechRecognizerOptions recognizer)
  {
    if (!IsSafeId(recognizer.Id)
      || string.IsNullOrWhiteSpace(recognizer.InstalledRecognizerId)
      || recognizer.InstalledRecognizerId.Length > 1_024
      || recognizer.InstalledRecognizerId.Contains('\0')
      || string.IsNullOrWhiteSpace(recognizer.CultureName)
      || recognizer.CultureName.Length > 64)
    {
      throw new InvalidOperationException("An allowed offline speech recognizer is invalid.");
    }
    try
    {
      _ = CultureInfo.GetCultureInfo(recognizer.CultureName);
    }
    catch (CultureNotFoundException exception)
    {
      throw new InvalidOperationException(
        "An allowed offline speech recognizer culture is invalid.",
        exception);
    }
    return new ApprovedSpeechRecognizer(
      recognizer.Id,
      recognizer.InstalledRecognizerId,
      recognizer.CultureName);
  }

  private static bool IsSafeId(string value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 80
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_');
}

internal sealed record LocalSpeechSynthesis(byte[] WavContent, int DurationMilliseconds);

internal sealed record LocalSpeechRecognition(string Transcript, double Confidence);

internal interface ILocalSpeechEngine
{
  ValueTask<LocalSpeechSynthesis> SynthesizeAsync(
    ApprovedSpeechVoice voice,
    string text,
    int rate,
    int volume,
    long maximumBytes,
    CancellationToken cancellationToken);

  ValueTask<LocalSpeechRecognition> RecognizeAsync(
    ApprovedSpeechRecognizer recognizer,
    byte[] wavContent,
    int maximumDurationMilliseconds,
    int maximumCharacters,
    CancellationToken cancellationToken);
}

internal sealed class SystemSpeechLocalEngine : ILocalSpeechEngine, IDisposable
{
  private readonly SemaphoreSlim _gate = new(1, 1);

  public async ValueTask<LocalSpeechSynthesis> SynthesizeAsync(
    ApprovedSpeechVoice voice,
    string text,
    int rate,
    int volume,
    long maximumBytes,
    CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      using var synthesizer = new SpeechSynthesizer();
      var installed = synthesizer.GetInstalledVoices(
          CultureInfo.GetCultureInfo(voice.CultureName))
        .Where(candidate => candidate.Enabled)
        .Select(candidate => candidate.VoiceInfo.Name)
        .SingleOrDefault(name => string.Equals(
          name,
          voice.InstalledVoiceName,
          StringComparison.Ordinal))
        ?? throw new InvalidOperationException("speech_voice_unavailable");
      synthesizer.SelectVoice(installed);
      synthesizer.Rate = rate;
      synthesizer.Volume = volume;
      using var output = new BoundedMemoryStream(maximumBytes);
      synthesizer.SetOutputToWaveStream(output);
      var completion = new TaskCompletionSource<SpeakCompletedEventArgs>(
        TaskCreationOptions.RunContinuationsAsynchronously);
      EventHandler<SpeakCompletedEventArgs>? handler = null;
      handler = (_, eventArgs) => completion.TrySetResult(eventArgs);
      synthesizer.SpeakCompleted += handler;
      try
      {
        var prompt = synthesizer.SpeakAsync(text);
        using var registration = cancellationToken.Register(() =>
          synthesizer.SpeakAsyncCancel(prompt));
        var completed = await completion.Task.ConfigureAwait(false);
        if (completed.Cancelled)
        {
          throw new OperationCanceledException(cancellationToken);
        }
        if (completed.Error is not null)
        {
          throw new InvalidOperationException("speech_synthesis_failed", completed.Error);
        }
      }
      finally
      {
        synthesizer.SpeakCompleted -= handler;
        synthesizer.SetOutputToNull();
      }
      var content = output.ToArray();
      var inspected = PcmWavInspector.Inspect(content, 120_000);
      return new LocalSpeechSynthesis(content, inspected.DurationMilliseconds);
    }
    catch (OperationCanceledException)
    {
      throw;
    }
    catch (InvalidOperationException exception) when (
      exception.Message.StartsWith("speech_", StringComparison.Ordinal))
    {
      throw;
    }
    catch (Exception exception)
    {
      throw new InvalidOperationException("speech_synthesis_failed", exception);
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<LocalSpeechRecognition> RecognizeAsync(
    ApprovedSpeechRecognizer recognizer,
    byte[] wavContent,
    int maximumDurationMilliseconds,
    int maximumCharacters,
    CancellationToken cancellationToken)
  {
    _ = PcmWavInspector.Inspect(wavContent, maximumDurationMilliseconds);
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var installed = SpeechRecognitionEngine.InstalledRecognizers()
        .SingleOrDefault(candidate => string.Equals(
            candidate.Id,
            recognizer.InstalledRecognizerId,
            StringComparison.Ordinal)
          && string.Equals(
            candidate.Culture.Name,
            recognizer.CultureName,
            StringComparison.OrdinalIgnoreCase))
        ?? throw new InvalidOperationException("speech_recognizer_unavailable");
      using var engine = new SpeechRecognitionEngine(installed);
      var grammar = new DictationGrammar();
      engine.LoadGrammar(grammar);
      using var input = new MemoryStream(wavContent, writable: false);
      engine.SetInputToWaveStream(input);
      var completion = new TaskCompletionSource<RecognizeCompletedEventArgs>(
        TaskCreationOptions.RunContinuationsAsynchronously);
      EventHandler<RecognizeCompletedEventArgs>? handler = null;
      handler = (_, eventArgs) => completion.TrySetResult(eventArgs);
      engine.RecognizeCompleted += handler;
      try
      {
        engine.RecognizeAsync(RecognizeMode.Single);
        using var registration = cancellationToken.Register(engine.RecognizeAsyncCancel);
        var completed = await completion.Task.ConfigureAwait(false);
        if (completed.Cancelled)
        {
          throw new OperationCanceledException(cancellationToken);
        }
        if (completed.Error is not null)
        {
          throw new InvalidOperationException("speech_recognition_failed", completed.Error);
        }
        var transcript = completed.Result?.Text ?? string.Empty;
        if (transcript.Length > maximumCharacters)
        {
          SensitiveUtf8.ZeroString(transcript);
          throw new InvalidOperationException("speech_transcript_exceeds_budget");
        }
        return new LocalSpeechRecognition(
          transcript,
          Math.Clamp(completed.Result?.Confidence ?? 0, 0, 1));
      }
      finally
      {
        engine.RecognizeCompleted -= handler;
      }
    }
    catch (OperationCanceledException)
    {
      throw;
    }
    catch (InvalidOperationException exception) when (
      exception.Message.StartsWith("speech_", StringComparison.Ordinal))
    {
      throw;
    }
    catch (Exception exception)
    {
      throw new InvalidOperationException("speech_recognition_failed", exception);
    }
    finally
    {
      _gate.Release();
    }
  }

  public void Dispose() => _gate.Dispose();

  private sealed class BoundedMemoryStream(long maximumBytes) : Stream
  {
    private readonly MemoryStream _inner = new();

    public override bool CanRead => _inner.CanRead;
    public override bool CanSeek => _inner.CanSeek;
    public override bool CanWrite => _inner.CanWrite;
    public override long Length => _inner.Length;
    public override long Position
    {
      get => _inner.Position;
      set => _inner.Position = value;
    }

    public byte[] ToArray() => _inner.ToArray();

    public override void Flush() => _inner.Flush();

    public override int Read(byte[] buffer, int offset, int count) =>
      _inner.Read(buffer, offset, count);

    public override long Seek(long offset, SeekOrigin origin) => _inner.Seek(offset, origin);

    public override void SetLength(long value)
    {
      EnsureLength(value);
      _inner.SetLength(value);
    }

    public override void Write(byte[] buffer, int offset, int count)
    {
      EnsureLength(checked(Position + count));
      _inner.Write(buffer, offset, count);
    }

    public override void Write(ReadOnlySpan<byte> buffer)
    {
      EnsureLength(checked(Position + buffer.Length));
      _inner.Write(buffer);
    }

    protected override void Dispose(bool disposing)
    {
      if (disposing)
      {
        if (_inner.TryGetBuffer(out var content)
          && content.Array is not null
          && _inner.Length > 0)
        {
          CryptographicOperations.ZeroMemory(content.Array.AsSpan(
            content.Offset,
            checked((int)_inner.Length)));
        }
        _inner.Dispose();
      }
      base.Dispose(disposing);
    }

    private static void ThrowBudget() =>
      throw new InvalidOperationException("speech_synthesis_exceeds_budget");

    private void EnsureLength(long value)
    {
      if (value < 0 || value > maximumBytes)
      {
        ThrowBudget();
      }
    }
  }

}

internal sealed class LocalSpeechSynthesizeCapabilityAdapter(
  LocalSpeechPolicy policy,
  ILocalSpeechEngine speech) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor => StandardUserCapabilityCatalog.SpeechSynthesize;

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    StandardUserCapabilityContractValidator.ValidateArguments(Descriptor.Id, arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    StandardUserCapabilityContractValidator.ValidateResult(Descriptor.Id, result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var voice = policy.ResolveVoice(arguments.GetProperty("voiceId").GetString()!);
    var maximumEgressPayload = Math.Max(
      0,
      (context.Budgets.MaxExternalEgressBytes - 4_096) / 4 * 3);
    var maximumBytes = Math.Min(
      policy.MaximumAudioBytes,
      Math.Min(context.Budgets.MaxLocalBytes, maximumEgressPayload));
    if (maximumBytes < 1_024)
    {
      throw new InvalidOperationException("speech_synthesis_budget_required");
    }
    var synthesized = await speech.SynthesizeAsync(
      voice,
      arguments.GetProperty("text").GetString()!,
      arguments.GetProperty("rate").GetInt32(),
      arguments.GetProperty("volume").GetInt32(),
      maximumBytes,
      cancellationToken).ConfigureAwait(false);
    try
    {
      if (synthesized.WavContent.LongLength > maximumBytes)
      {
        throw new InvalidOperationException("speech_synthesis_exceeds_budget");
      }
      var digest = Convert.ToHexString(SHA256.HashData(synthesized.WavContent))
        .ToLowerInvariant();
      var output = JsonSerializer.Serialize(new
      {
        voiceId = voice.Id,
        mediaType = "audio/wav",
        contentBase64 = Convert.ToBase64String(synthesized.WavContent),
        durationMilliseconds = synthesized.DurationMilliseconds,
        contentSha256 = digest,
      });
      return new CapabilityExecutionResult(
        output,
        MutationCommitted: false,
        OutcomeUncertain: false,
        Provenance:
        [
          new DataProvenance(
            "windows-installed-voice",
            PayloadDigest.Sha256Hex(
              $"{voice.Id}\n{voice.InstalledVoiceName}\n{voice.CultureName}"),
            digest,
            ProvenanceTrust.TrustedSystem,
            DateTimeOffset.UtcNow),
        ],
        LocalBytesWritten: synthesized.WavContent.LongLength);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(synthesized.WavContent);
    }
  }
}

internal sealed class LocalSpeechTranscribeCapabilityAdapter(
  LocalSpeechPolicy policy,
  ILocalSpeechEngine speech,
  IInteractiveAudioDevice audio) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor => StandardUserCapabilityCatalog.SpeechTranscribe;

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    StandardUserCapabilityContractValidator.ValidateArguments(Descriptor.Id, arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    StandardUserCapabilityContractValidator.ValidateResult(Descriptor.Id, result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var recognizer = policy.ResolveRecognizer(
      arguments.GetProperty("recognizerId").GetString()!);
    var requestedDuration = arguments.GetProperty("durationMilliseconds").GetInt32();
    // Capturing writes a bounded local buffer and recognition reads the same
    // bytes. Reserve both halves before activating the microphone; raw audio is
    // never serialized into action arguments or a result envelope.
    var maximumAudioBytes = Math.Min(
      policy.MaximumAudioBytes,
      context.Budgets.MaxLocalBytes / 2);
    if (maximumAudioBytes < 1_024)
    {
      throw new InvalidOperationException("speech_transcription_local_budget_required");
    }
    var content = await audio.CapturePcmWavAsync(
      requestedDuration,
      maximumAudioBytes,
      cancellationToken).ConfigureAwait(false);
    try
    {
      if (content.LongLength > maximumAudioBytes)
      {
        throw new InvalidOperationException("speech_audio_exceeds_budget");
      }
      var inspected = PcmWavInspector.Inspect(content, requestedDuration + 2_000);
      var maximumCharacters = Math.Min(
        policy.MaximumTranscriptCharacters,
        arguments.GetProperty("maxCharacters").GetInt32());
      var recognized = await speech.RecognizeAsync(
        recognizer,
        content,
        requestedDuration + 2_000,
        maximumCharacters,
        cancellationToken).ConfigureAwait(false);
      try
      {
        if (recognized.Transcript.Length > maximumCharacters)
        {
          throw new InvalidOperationException("speech_transcript_exceeds_budget");
        }
        var audioSha256 = Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
        var sanitized = LocalTranscriptDlp.Sanitize(recognized.Transcript);
        if (sanitized.Text.Length > maximumCharacters)
        {
          SensitiveUtf8.ZeroString(sanitized.Text);
          throw new InvalidOperationException("speech_transcript_exceeds_budget");
        }
        var transcriptSha256 = PayloadDigest.Sha256Hex(sanitized.Text);
        var audioBindingSha256 = LocalSpeechAudioBinding.Sha256(context, audioSha256);
        var output = JsonSerializer.Serialize(new
        {
          protocol = LocalSpeechAudioBinding.Protocol,
          taskId = context.TaskId,
          planVersionId = context.PlanVersionId,
          stepId = context.StepId,
          deviceId = context.DeviceId,
          actionId = context.ActionId,
          recognizerId = recognizer.Id,
          audioBytes = content.LongLength,
          durationMilliseconds = inspected.DurationMilliseconds,
          transcript = sanitized.Text,
          confidence = recognized.Confidence,
          audioSha256,
          transcriptSha256,
          audioBindingSha256,
          redactionsApplied = sanitized.RedactionsApplied,
          trustLevel = "UNTRUSTED",
          instructionAuthority = "NONE",
        });
        SensitiveUtf8.ZeroString(sanitized.Text);
        if (Encoding.UTF8.GetByteCount(output) > context.Budgets.MaxExternalEgressBytes)
        {
          throw new InvalidOperationException("speech_transcript_exceeds_egress_budget");
        }
        return new CapabilityExecutionResult(
          output,
          MutationCommitted: false,
          OutcomeUncertain: false,
          Provenance:
          [
            new DataProvenance(
              "speech-input-audio",
              audioBindingSha256,
              audioSha256,
              ProvenanceTrust.UntrustedContent,
              DateTimeOffset.UtcNow),
            new DataProvenance(
              "windows-installed-speech-recognizer",
              PayloadDigest.Sha256Hex(
                $"{recognizer.Id}\n{recognizer.InstalledRecognizerId}\n{recognizer.CultureName}"),
              transcriptSha256,
              ProvenanceTrust.TrustedSystem,
              DateTimeOffset.UtcNow),
          ],
          LocalBytesRead: content.LongLength,
          LocalBytesWritten: content.LongLength);
      }
      finally
      {
        SensitiveUtf8.ZeroString(recognized.Transcript);
      }
    }
    catch (Exception exception)
    {
      throw new MeasuredCapabilityFailureException(
        SafeFailureCodeAfterCapture(exception),
        content.LongLength,
        content.LongLength);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(content);
    }
  }

  private static string SafeFailureCodeAfterCapture(Exception exception) =>
    exception is OperationCanceledException
      ? "speech_transcription_cancelled_after_capture"
      : exception is InvalidOperationException
        && exception.Message.Length is >= 1 and <= 100
        && exception.Message.StartsWith("speech_", StringComparison.Ordinal)
        && exception.Message.All(character => char.IsAsciiLetterOrDigit(character)
          || character is '.' or '-' or '_' or ':')
          ? exception.Message
          : "speech_transcription_failed_after_capture";
}

internal static class LocalSpeechAudioBinding
{
  public const string Protocol = "msaidizi-local-stt/v1";

  public static string Sha256(ActionExecutionContext context, string audioSha256) =>
    PayloadDigest.Sha256Hex(string.Join("\0",
    [
      Protocol,
      context.TaskId,
      context.PlanVersionId,
      context.StepId,
      context.DeviceId,
      context.ActionId,
      audioSha256,
    ]));
}

internal sealed record SanitizedLocalTranscript(string Text, bool RedactionsApplied);

/// <summary>
/// Final outbound DLP for locally recognised free-form speech. It is not a
/// credential vault: recognisers receive no secrets and browser/host actions
/// must still use opaque supervisor-owned references. This boundary prevents a
/// spoken credential from entering result delivery, logs, audit, persistence,
/// or a later model request.
/// </summary>
internal static partial class LocalTranscriptDlp
{
  private const string Placeholder = "[REDACTED SECRET]";

  public static SanitizedLocalTranscript Sanitize(string transcript)
  {
    var sanitized = LabelledSecret().Replace(
      transcript,
      match => $"{match.Groups[1].Value} {Placeholder}");
    sanitized = ProviderToken().Replace(sanitized, Placeholder);
    sanitized = CompactJwt().Replace(sanitized, Placeholder);
    sanitized = OpaqueCredential().Replace(sanitized, match =>
      LooksCredentialLike(match.Value) ? Placeholder : match.Value);
    return new SanitizedLocalTranscript(
      new string(sanitized.AsSpan()),
      !string.Equals(sanitized, transcript, StringComparison.Ordinal));
  }

  private static bool LooksCredentialLike(string candidate)
  {
    if (Guid.TryParse(candidate, out _) || PayloadDigest.IsSha256Hex(candidate))
    {
      return false;
    }
    var classes = (candidate.Any(char.IsLower) ? 1 : 0)
      + (candidate.Any(char.IsUpper) ? 1 : 0)
      + (candidate.Any(char.IsDigit) ? 1 : 0)
      + (candidate.Any(character => !char.IsLetterOrDigit(character)) ? 1 : 0);
    return classes == 4;
  }

  [GeneratedRegex(
    @"\b((?:password|passwd|passcode|pwd|client[ _-]?secret|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|authorization[ _-]?token|bearer|secret|private[ _-]?key|connection[ _-]?string|pairing[ _-]?code|enrollment[ _-]?code|cvv|pin)(?:\s+(?:is|equals))?|(?:password|token|secret)\s*[:=])\s*([^\s,;]+)",
    RegexOptions.IgnoreCase | RegexOptions.CultureInvariant,
    matchTimeoutMilliseconds: 100)]
  private static partial Regex LabelledSecret();

  [GeneratedRegex(
    @"\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[A-Z0-9]{16})\b",
    RegexOptions.CultureInvariant,
    matchTimeoutMilliseconds: 100)]
  private static partial Regex ProviderToken();

  [GeneratedRegex(
    @"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b",
    RegexOptions.CultureInvariant,
    matchTimeoutMilliseconds: 100)]
  private static partial Regex CompactJwt();

  [GeneratedRegex(
    @"\b[A-Za-z0-9_+/=.-]{32,}\b",
    RegexOptions.CultureInvariant,
    matchTimeoutMilliseconds: 100)]
  private static partial Regex OpaqueCredential();
}
