using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.SessionBridge;

namespace Itemba.Msaidizi.Companion.Contracts.Capabilities;

/// <summary>
/// Shared fail-closed validator used by both the LocalSystem proxy and tests.
/// Adapters may impose additional live-state checks, but cannot accept a wider
/// wire shape than this reviewed catalog contract.
/// </summary>
public static class StandardUserCapabilityContractValidator
{
  private static readonly string[] BaseMediaFields =
    ["mediaType", "contentBase64", "contentSha256"];

  public static CapabilityArgumentValidation ValidateArguments(
    string capabilityId,
    JsonElement arguments) => capabilityId switch
    {
      "session.status.read" => Exact(arguments)
        ? CapabilityArgumentValidation.Success
        : InvalidArguments("Session status accepts an empty object only."),
      "clipboard.text.read" => IntegerArguments(
        arguments,
        "maxCharacters",
        1,
        262_144),
      "clipboard.text.write" => StringArguments(arguments, "text", 0, 262_144),
      "screen.primary.capture" => TwoIntegerArguments(
        arguments,
        "maxWidth",
        320,
        7_680,
        "maxHeight",
        200,
        4_320),
      "camera.photo.capture" => ValidateCameraArguments(arguments),
      "audio.microphone.capture" => IntegerArguments(
        arguments,
        "durationMilliseconds",
        100,
        30_000),
      "audio.wav.play" => ValidateAudioPlayback(arguments),
      "speech.text.synthesize" => ValidateSpeechSynthesis(arguments),
      "speech.audio.transcribe" => ValidateSpeechTranscription(arguments),
      "browser.uri.open" => ValidateBrowser(arguments),
      "ui.foreground.inspect" => TwoIntegerArguments(
        arguments,
        "maxElements",
        1,
        500,
        "maxDepth",
        0,
        12),
      "ui.element.invoke" => ValidateUiInvoke(arguments),
      "command.emergency.execute" => ValidateEmergencyCommand(arguments),
      "browser.form.text.set" => ValidateBrowserText(arguments),
      "browser.form.secret.set" => ValidateBrowserSecret(arguments, includeUploadRoot: false),
      "browser.file.upload" => ValidateBrowserFileUpload(arguments),
      "browser.download.invoke" => ValidateBrowserDownload(arguments),
      _ => InvalidArguments("Unknown standard-user capability."),
    };

  public static CapabilityArgumentValidation ValidateResult(
    string capabilityId,
    JsonElement result) => capabilityId switch
    {
      "session.status.read" => Exact(result, "interactive", "sessionId")
        && IsBoolean(result, "interactive")
        && IsInteger(result, "sessionId", 0, int.MaxValue)
          ? CapabilityArgumentValidation.Success
          : InvalidResult("Session status result is invalid."),
      "clipboard.text.read" => ValidateClipboardRead(result),
      "clipboard.text.write" => Exact(result, "written", "characterCount", "contentSha256")
        && result.GetProperty("written").ValueKind == JsonValueKind.True
        && IsInteger(result, "characterCount", 0, 262_144)
        && IsSha256(result, "contentSha256")
          ? CapabilityArgumentValidation.Success
          : InvalidResult("Clipboard write result is invalid."),
      "screen.primary.capture" => ValidateMediaResult(
        result,
        "image/png",
        "width",
        "height"),
      "camera.photo.capture" => ValidateCameraResult(result),
      "audio.microphone.capture" => ValidateMediaResult(
        result,
        "audio/wav",
        "durationMilliseconds"),
      "audio.wav.play" => Exact(result, "played", "contentSha256")
        && result.GetProperty("played").ValueKind == JsonValueKind.True
        && IsSha256(result, "contentSha256")
          ? CapabilityArgumentValidation.Success
          : InvalidResult("Audio playback result is invalid."),
      "speech.text.synthesize" => ValidateSpeechSynthesisResult(result),
      "speech.audio.transcribe" => ValidateSpeechTranscriptionResult(result),
      "browser.uri.open" => Exact(result, "dispatched", "originId", "uriSha256")
        && result.GetProperty("dispatched").ValueKind == JsonValueKind.True
        && IsString(result, "originId", 1, 80)
        && IsSha256(result, "uriSha256")
          ? CapabilityArgumentValidation.Success
          : InvalidResult("Browser dispatch result is invalid."),
      "ui.foreground.inspect" => Exact(result, "processId", "windowStateSha256", "elements")
        && IsInteger(result, "processId", 1, int.MaxValue)
        && IsSha256(result, "windowStateSha256")
        && result.GetProperty("elements").ValueKind == JsonValueKind.Array
        && result.GetProperty("elements").GetArrayLength() <= 500
          ? CapabilityArgumentValidation.Success
          : InvalidResult("UI inspection result is invalid."),
      "ui.element.invoke" => Exact(result, "invoked", "processId", "automationIdSha256")
        && result.GetProperty("invoked").ValueKind == JsonValueKind.True
        && IsInteger(result, "processId", 1, int.MaxValue)
        && IsSha256(result, "automationIdSha256")
          ? CapabilityArgumentValidation.Success
          : InvalidResult("UI invocation result is invalid."),
      "command.emergency.execute" => ValidateEmergencyCommandResult(result),
      "browser.form.text.set" => ValidateBrowserTextResult(result),
      "browser.form.secret.set" => ValidateBrowserSecretResult(result),
      "browser.file.upload" => ValidateBrowserFileUploadResult(result),
      "browser.download.invoke" => Exact(result, "dispatched", "destinationScopeSha256")
        && result.GetProperty("dispatched").ValueKind == JsonValueKind.True
        && IsSha256(result, "destinationScopeSha256")
          ? CapabilityArgumentValidation.Success
          : InvalidResult("Browser download result is invalid."),
      _ => InvalidResult("Unknown standard-user capability."),
    };

  private static CapabilityArgumentValidation ValidateAudioPlayback(JsonElement arguments)
  {
    if (!Exact(arguments, "contentBase64", "maxDurationMilliseconds")
      || !IsString(arguments, "contentBase64", 1, 89_478_488)
      || !IsInteger(arguments, "maxDurationMilliseconds", 100, 120_000))
    {
      return InvalidArguments("Audio playback arguments are invalid.");
    }

    try
    {
      var bytes = Convert.FromBase64String(arguments.GetProperty("contentBase64").GetString()!);
      return bytes.LongLength <= 67_108_864
        ? CapabilityArgumentValidation.Success
        : InvalidArguments("Audio playback payload exceeds policy.");
    }
    catch (FormatException)
    {
      return InvalidArguments("Audio playback payload is not Base64.");
    }
  }

  private static CapabilityArgumentValidation ValidateCameraArguments(JsonElement arguments) =>
    Exact(arguments, "cameraId", "maxWidth", "maxHeight")
    && IsString(arguments, "cameraId", 1, 80)
    && IsSafeIdentifier(arguments.GetProperty("cameraId").GetString()!)
    && IsInteger(arguments, "maxWidth", 320, 3_840)
    && IsInteger(arguments, "maxHeight", 240, 2_160)
      ? CapabilityArgumentValidation.Success
      : InvalidArguments("Camera capture arguments are invalid.");

  private static CapabilityArgumentValidation ValidateCameraResult(JsonElement result)
  {
    if (!Exact(
        result,
        "cameraId",
        "mediaType",
        "contentBase64",
        "width",
        "height",
        "contentSha256")
      || !IsString(result, "cameraId", 1, 80)
      || !IsSafeIdentifier(result.GetProperty("cameraId").GetString()!)
      || result.GetProperty("mediaType").GetString() != "image/jpeg"
      || !IsString(result, "contentBase64", 1, 89_478_488)
      || !IsInteger(result, "width", 1, 3_840)
      || !IsInteger(result, "height", 1, 2_160)
      || !IsSha256(result, "contentSha256"))
    {
      return InvalidResult("Camera capture result is invalid.");
    }

    try
    {
      var content = Convert.FromBase64String(result.GetProperty("contentBase64").GetString()!);
      var digest = Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
      return SessionBridgeAuthentication.FixedTimeEqualsHex(
        result.GetProperty("contentSha256").GetString()!,
        digest)
          ? CapabilityArgumentValidation.Success
          : InvalidResult("Camera content digest does not match.");
    }
    catch (FormatException)
    {
      return InvalidResult("Camera content is not Base64.");
    }
  }

  private static CapabilityArgumentValidation ValidateSpeechSynthesis(JsonElement arguments) =>
    Exact(arguments, "voiceId", "text", "rate", "volume")
    && IsString(arguments, "voiceId", 1, 80)
    && IsSafeIdentifier(arguments.GetProperty("voiceId").GetString()!)
    && IsString(arguments, "text", 1, 4_096)
    && IsInteger(arguments, "rate", -10, 10)
    && IsInteger(arguments, "volume", 0, 100)
      ? CapabilityArgumentValidation.Success
      : InvalidArguments("Local speech synthesis arguments are invalid.");

  private static CapabilityArgumentValidation ValidateSpeechTranscription(
    JsonElement arguments) =>
    Exact(arguments, "recognizerId", "durationMilliseconds", "maxCharacters")
    && IsString(arguments, "recognizerId", 1, 80)
    && IsSafeIdentifier(arguments.GetProperty("recognizerId").GetString()!)
    && IsInteger(arguments, "durationMilliseconds", 100, 30_000)
    && IsInteger(arguments, "maxCharacters", 1, 32_768)
      ? CapabilityArgumentValidation.Success
      : InvalidArguments(
        "Local speech transcription arguments are invalid; raw audio is never accepted.");

  private static CapabilityArgumentValidation ValidateSpeechSynthesisResult(JsonElement result)
  {
    if (!Exact(
        result,
        "voiceId",
        "mediaType",
        "contentBase64",
        "durationMilliseconds",
        "contentSha256")
      || !IsString(result, "voiceId", 1, 80)
      || !IsSafeIdentifier(result.GetProperty("voiceId").GetString()!)
      || result.GetProperty("mediaType").GetString() != "audio/wav"
      || !IsString(result, "contentBase64", 1, 22_369_624)
      || !IsInteger(result, "durationMilliseconds", 1, 120_000)
      || !IsSha256(result, "contentSha256"))
    {
      return InvalidResult("Local speech synthesis result is invalid.");
    }
    try
    {
      var content = Convert.FromBase64String(result.GetProperty("contentBase64").GetString()!);
      var digest = Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
      return content.LongLength <= 16_777_216
        && SessionBridgeAuthentication.FixedTimeEqualsHex(
          result.GetProperty("contentSha256").GetString()!,
          digest)
          ? CapabilityArgumentValidation.Success
          : InvalidResult("Synthesized speech digest or size is invalid.");
    }
    catch (FormatException)
    {
      return InvalidResult("Synthesized speech is not Base64.");
    }
  }

  private static CapabilityArgumentValidation ValidateSpeechTranscriptionResult(
    JsonElement result)
  {
    if (!Exact(
        result,
        "protocol",
        "taskId",
        "planVersionId",
        "stepId",
        "deviceId",
        "actionId",
        "recognizerId",
        "audioBytes",
        "durationMilliseconds",
        "transcript",
        "confidence",
        "audioSha256",
        "transcriptSha256",
        "audioBindingSha256",
        "redactionsApplied",
        "trustLevel",
        "instructionAuthority")
      || result.GetProperty("protocol").GetString() != "msaidizi-local-stt/v1"
      || !IsString(result, "taskId", 1, 128)
      || !IsString(result, "planVersionId", 1, 128)
      || !IsString(result, "stepId", 1, 128)
      || !IsString(result, "deviceId", 1, 128)
      || !IsString(result, "actionId", 1, 128)
      || !IsString(result, "recognizerId", 1, 80)
      || !IsSafeIdentifier(result.GetProperty("recognizerId").GetString()!)
      || !IsInteger(result, "audioBytes", 44, 16_777_216)
      || !IsInteger(result, "durationMilliseconds", 1, 30_000)
      || !IsString(result, "transcript", 0, 32_768)
      || !result.GetProperty("confidence").TryGetDouble(out var confidence)
      || confidence is < 0 or > 1
      || !IsSha256(result, "audioSha256")
      || !IsSha256(result, "transcriptSha256")
      || !IsSha256(result, "audioBindingSha256")
      || result.GetProperty("redactionsApplied").ValueKind is not (
        JsonValueKind.True or JsonValueKind.False)
      || result.GetProperty("trustLevel").GetString() != "UNTRUSTED"
      || result.GetProperty("instructionAuthority").GetString() != "NONE")
    {
      return InvalidResult("Local speech transcription result is invalid.");
    }
    var transcript = result.GetProperty("transcript").GetString()!;
    return SessionBridgeAuthentication.FixedTimeEqualsHex(
      result.GetProperty("transcriptSha256").GetString()!,
      Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(transcript))).ToLowerInvariant())
        ? CapabilityArgumentValidation.Success
        : InvalidResult("Transcript digest does not match its content.");
  }

  private static CapabilityArgumentValidation ValidateBrowser(JsonElement arguments)
  {
    if (!Exact(arguments, "originId", "relativePath")
      || !IsString(arguments, "originId", 1, 80)
      || !IsSafeIdentifier(arguments.GetProperty("originId").GetString()!)
      || !IsString(arguments, "relativePath", 1, 2_048))
    {
      return InvalidArguments("Browser target arguments are invalid.");
    }

    var relativePath = arguments.GetProperty("relativePath").GetString()!;
    return relativePath.StartsWith('/')
      && !relativePath.Contains('\\')
      && !relativePath.Contains('?')
      && !relativePath.Contains('#')
      && Uri.TryCreate(relativePath, UriKind.Relative, out _)
        ? CapabilityArgumentValidation.Success
        : InvalidArguments("Browser path must be a credential-free relative path.");
  }

  private static CapabilityArgumentValidation ValidateUiInvoke(JsonElement arguments)
  {
    if (!Exact(arguments, "processId", "automationId", "controlType")
      || !IsInteger(arguments, "processId", 1, int.MaxValue)
      || !IsString(arguments, "automationId", 1, 512)
      || !IsString(arguments, "controlType", 1, 32))
    {
      return InvalidArguments("UI invocation arguments are invalid.");
    }

    return arguments.GetProperty("controlType").GetString() is
      "Button" or "Hyperlink" or "MenuItem" or "TabItem"
        ? CapabilityArgumentValidation.Success
        : InvalidArguments("UI control type is not allowed.");
  }

  private static CapabilityArgumentValidation ValidateEmergencyCommand(JsonElement arguments)
  {
    if (!Exact(arguments, "executable", "argv", "workingDirectoryId")
      || !IsString(arguments, "executable", 3, 32)
      || arguments.GetProperty("executable").GetString() is not ("cmd" or "windows-powershell")
      || !IsString(arguments, "workingDirectoryId", 1, 80)
      || !IsSafeIdentifier(arguments.GetProperty("workingDirectoryId").GetString()!)
      || arguments.GetProperty("argv").ValueKind != JsonValueKind.Array
      || arguments.GetProperty("argv").GetArrayLength() is < 1 or > 64)
    {
      return InvalidArguments("Emergency command arguments are invalid.");
    }

    var values = arguments.GetProperty("argv").EnumerateArray().Select(argument =>
      argument.ValueKind == JsonValueKind.String ? argument.GetString() : null).ToArray();
    if (!values.All(value => value is { Length: <= 4_096 } && !value.Contains('\0')))
    {
      return InvalidArguments("Emergency command argv is invalid.");
    }

    var executable = arguments.GetProperty("executable").GetString();
    if (executable == "cmd")
    {
      return values.Length >= 4
        && string.Equals(values[0], "/d", StringComparison.OrdinalIgnoreCase)
        && string.Equals(values[1], "/s", StringComparison.OrdinalIgnoreCase)
        && string.Equals(values[2], "/c", StringComparison.OrdinalIgnoreCase)
          ? CapabilityArgumentValidation.Success
          : InvalidArguments("Command Prompt requires the exact /d /s /c prefix.");
    }

    string[] powershellPrefix =
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "RemoteSigned",
      "-Command",
    ];
    return values.Length > powershellPrefix.Length
      && values.Take(powershellPrefix.Length).SequenceEqual(
        powershellPrefix,
        StringComparer.OrdinalIgnoreCase)
      && !values.Any(value => value is not null && value.Equals(
        "-EncodedCommand",
        StringComparison.OrdinalIgnoreCase))
      && !values.Any(value => value is not null && value.Equals(
        "-EncodedArguments",
        StringComparison.OrdinalIgnoreCase))
      && !values.Any(value => value is not null && value.Equals(
        "-File",
        StringComparison.OrdinalIgnoreCase))
        ? CapabilityArgumentValidation.Success
        : InvalidArguments("Windows PowerShell requires the reviewed exact prefix.");
  }

  private static CapabilityArgumentValidation ValidateEmergencyCommandResult(JsonElement result) =>
    Exact(
      result,
      "executable",
      "exitCode",
      "stdoutBytes",
      "stderrBytes",
      "stdoutSha256",
      "stderrSha256")
    && IsString(result, "executable", 3, 32)
    && result.GetProperty("executable").GetString() is "cmd" or "windows-powershell"
    && result.GetProperty("exitCode").TryGetInt32(out _)
    && IsInteger(result, "stdoutBytes", 0, int.MaxValue)
    && IsInteger(result, "stderrBytes", 0, int.MaxValue)
    && IsSha256(result, "stdoutSha256")
    && IsSha256(result, "stderrSha256")
      ? CapabilityArgumentValidation.Success
      : InvalidResult("Emergency command result is invalid.");

  private static CapabilityArgumentValidation ValidateBrowserSecret(
    JsonElement arguments,
    bool includeUploadRoot)
  {
    var fields = new List<string>
    {
      "originId",
      "originSha256",
      "processId",
      "automationId",
      "secretReferenceId",
    };
    if (includeUploadRoot) fields.Add("uploadRootId");
    var exact = Exact(arguments, [.. fields]);
    if (!exact
      || !IsString(arguments, "originId", 1, 80)
      || !IsSafeIdentifier(arguments.GetProperty("originId").GetString()!)
      || !IsSha256(arguments, "originSha256")
      || !IsInteger(arguments, "processId", 1, int.MaxValue)
      || !IsString(arguments, "automationId", 1, 512)
      || !IsString(arguments, "secretReferenceId", 36, 36)
      || !Guid.TryParseExact(
        arguments.GetProperty("secretReferenceId").GetString(),
        "D",
        out _)
      || (includeUploadRoot
        && (!IsString(arguments, "uploadRootId", 1, 80)
          || !IsSafeIdentifier(arguments.GetProperty("uploadRootId").GetString()!))))
    {
      return InvalidArguments("Browser secret arguments are invalid.");
    }
    return CapabilityArgumentValidation.Success;
  }

  private static CapabilityArgumentValidation ValidateBrowserFileUpload(JsonElement arguments)
  {
    if (!arguments.TryGetProperty("artifact", out var artifact))
    {
      return ValidateBrowserSecret(arguments, includeUploadRoot: true);
    }
    if (!ExactBrowserOriginFields(arguments, "processId", "automationId", "artifact")
      || !IsString(arguments, "originId", 1, 80)
      || !IsSafeIdentifier(arguments.GetProperty("originId").GetString()!)
      || !IsSha256(arguments, "originSha256")
      || !IsInteger(arguments, "processId", 1, int.MaxValue)
      || !IsString(arguments, "automationId", 1, 512)
      || !GovernedArtifactEnvelope.TryDecode(
        artifact,
        context: null,
        requiredKind: "SCREENSHOT",
        out _,
        out var content))
    {
      return InvalidArguments("Browser artifact upload arguments are invalid.");
    }
    CryptographicOperations.ZeroMemory(content);
    return CapabilityArgumentValidation.Success;
  }

  private static CapabilityArgumentValidation ValidateBrowserText(JsonElement arguments) =>
    ExactBrowserOriginFields(
      arguments,
      "processId",
      "automationId",
      "contentClass",
      "text")
    && IsString(arguments, "originId", 1, 80)
    && IsSafeIdentifier(arguments.GetProperty("originId").GetString()!)
    && IsSha256(arguments, "originSha256")
    && IsInteger(arguments, "processId", 1, int.MaxValue)
    && IsString(arguments, "automationId", 1, 512)
    && IsString(arguments, "contentClass", 6, 8)
    && arguments.GetProperty("contentClass").GetString() is "public" or "internal"
    && IsString(arguments, "text", 0, 4_096)
    && !arguments.GetProperty("text").GetString()!.Contains('\0')
      ? CapabilityArgumentValidation.Success
      : InvalidArguments(
        "Browser text arguments must contain bounded public or internal content only.");

  private static CapabilityArgumentValidation ValidateBrowserTextResult(JsonElement result) =>
    Exact(result, "set", "contentSha256", "destinationScopeSha256")
    && result.GetProperty("set").ValueKind == JsonValueKind.True
    && IsSha256(result, "contentSha256")
    && IsSha256(result, "destinationScopeSha256")
      ? CapabilityArgumentValidation.Success
      : InvalidResult("Browser text result is invalid.");

  private static CapabilityArgumentValidation ValidateBrowserSecretResult(JsonElement result) =>
    Exact(result, "set", "secretReferenceSha256", "destinationScopeSha256")
    && result.GetProperty("set").ValueKind == JsonValueKind.True
    && IsSha256(result, "secretReferenceSha256")
    && IsSha256(result, "destinationScopeSha256")
      ? CapabilityArgumentValidation.Success
      : InvalidResult("Browser secret result is invalid.");

  private static CapabilityArgumentValidation ValidateBrowserFileUploadResult(JsonElement result)
  {
    var secret = Exact(result, "set", "secretReferenceSha256", "destinationScopeSha256")
      && result.GetProperty("set").ValueKind == JsonValueKind.True
      && IsSha256(result, "secretReferenceSha256")
      && IsSha256(result, "destinationScopeSha256");
    var artifact = Exact(
        result,
        "set",
        "artifactSha256",
        "quarantineCleanupConfirmed",
        "destinationScopeSha256")
      && result.GetProperty("set").ValueKind == JsonValueKind.True
      && IsSha256(result, "artifactSha256")
      && result.GetProperty("quarantineCleanupConfirmed").ValueKind is
        JsonValueKind.True or JsonValueKind.False
      && IsSha256(result, "destinationScopeSha256");
    return secret ^ artifact
      ? CapabilityArgumentValidation.Success
      : InvalidResult("Browser file upload result is invalid.");
  }

  private static CapabilityArgumentValidation ValidateBrowserDownload(JsonElement arguments)
  {
    if (!ExactBrowserOriginFields(
        arguments,
        "processId",
        "automationId",
        "controlType")
      || !IsString(arguments, "originId", 1, 80)
      || !IsSafeIdentifier(arguments.GetProperty("originId").GetString()!)
      || !IsSha256(arguments, "originSha256")
      || !IsInteger(arguments, "processId", 1, int.MaxValue)
      || !IsString(arguments, "automationId", 1, 512)
      || !IsString(arguments, "controlType", 1, 32))
    {
      return InvalidArguments("Browser download arguments are invalid.");
    }
    return arguments.GetProperty("controlType").GetString() is
      "Button" or "Hyperlink" or "MenuItem"
        ? CapabilityArgumentValidation.Success
        : InvalidArguments("Browser download control type is not allowed.");
  }

  private static bool ExactBrowserOriginFields(
    JsonElement arguments,
    params string[] additional)
  {
    var fields = new List<string> { "originId", "originSha256" };
    fields.AddRange(additional);
    return Exact(arguments, [.. fields]);
  }

  private static CapabilityArgumentValidation ValidateClipboardRead(JsonElement result)
  {
    if (!Exact(
      result,
      "hasText",
      "text",
      "truncated",
      "characterCount",
      "stateSha256")
      || !IsBoolean(result, "hasText")
      || !IsBoolean(result, "truncated")
      || !IsInteger(result, "characterCount", 0, int.MaxValue)
      || !IsSha256(result, "stateSha256"))
    {
      return InvalidResult("Clipboard read result is invalid.");
    }

    var hasText = result.GetProperty("hasText").GetBoolean();
    var textKind = result.GetProperty("text").ValueKind;
    return (hasText && textKind == JsonValueKind.String)
      || (!hasText && textKind == JsonValueKind.Null)
        ? CapabilityArgumentValidation.Success
        : InvalidResult("Clipboard text presence is inconsistent.");
  }

  private static CapabilityArgumentValidation ValidateMediaResult(
    JsonElement result,
    string expectedMediaType,
    params string[] numericFields)
  {
    var expected = BaseMediaFields
      .Concat(numericFields)
      .ToArray();
    if (!Exact(result, expected)
      || result.GetProperty("mediaType").GetString() != expectedMediaType
      || !IsString(result, "contentBase64", 1, 89_478_488)
      || !IsSha256(result, "contentSha256")
      || numericFields.Any(field => !IsInteger(result, field, 1, int.MaxValue)))
    {
      return InvalidResult("Media result is invalid.");
    }

    try
    {
      var content = Convert.FromBase64String(result.GetProperty("contentBase64").GetString()!);
      var digest = Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
      return SessionBridgeAuthentication.FixedTimeEqualsHex(
        result.GetProperty("contentSha256").GetString()!,
        digest)
          ? CapabilityArgumentValidation.Success
          : InvalidResult("Media digest does not match its content.");
    }
    catch (FormatException)
    {
      return InvalidResult("Media content is not Base64.");
    }
  }

  private static CapabilityArgumentValidation IntegerArguments(
    JsonElement arguments,
    string name,
    int minimum,
    int maximum) => Exact(arguments, name) && IsInteger(arguments, name, minimum, maximum)
      ? CapabilityArgumentValidation.Success
      : InvalidArguments($"{name} is outside policy.");

  private static CapabilityArgumentValidation TwoIntegerArguments(
    JsonElement arguments,
    string firstName,
    int firstMinimum,
    int firstMaximum,
    string secondName,
    int secondMinimum,
    int secondMaximum) => Exact(arguments, firstName, secondName)
    && IsInteger(arguments, firstName, firstMinimum, firstMaximum)
    && IsInteger(arguments, secondName, secondMinimum, secondMaximum)
      ? CapabilityArgumentValidation.Success
      : InvalidArguments("Integer arguments are outside policy.");

  private static CapabilityArgumentValidation StringArguments(
    JsonElement arguments,
    string name,
    int minimumLength,
    int maximumLength) => Exact(arguments, name)
    && IsString(arguments, name, minimumLength, maximumLength)
      ? CapabilityArgumentValidation.Success
      : InvalidArguments($"{name} is outside policy.");

  private static bool Exact(JsonElement value, params string[] expected)
  {
    if (value.ValueKind != JsonValueKind.Object)
    {
      return false;
    }

    var names = value.EnumerateObject().Select(property => property.Name).ToArray();
    return names.Length == expected.Length
      && names.ToHashSet(StringComparer.Ordinal).SetEquals(expected);
  }

  private static bool IsBoolean(JsonElement value, string property) =>
    value.TryGetProperty(property, out var candidate)
    && candidate.ValueKind is JsonValueKind.True or JsonValueKind.False;

  private static bool IsInteger(
    JsonElement value,
    string property,
    int minimum,
    int maximum) => value.TryGetProperty(property, out var candidate)
    && candidate.TryGetInt32(out var parsed)
    && parsed >= minimum
    && parsed <= maximum;

  private static bool IsString(
    JsonElement value,
    string property,
    int minimumLength,
    int maximumLength) => value.TryGetProperty(property, out var candidate)
    && candidate.ValueKind == JsonValueKind.String
    && candidate.GetString() is { } parsed
    && parsed.Length >= minimumLength
    && parsed.Length <= maximumLength;

  private static bool IsSha256(JsonElement value, string property) =>
    value.TryGetProperty(property, out var candidate)
    && candidate.ValueKind == JsonValueKind.String
    && candidate.GetString() is { Length: 64 } digest
    && digest.All(character => char.IsAsciiHexDigit(character))
    && digest.All(character => !char.IsAsciiLetter(character) || char.IsLower(character));

  private static bool IsSafeIdentifier(string value) => value.All(character =>
    char.IsAsciiLetterOrDigit(character) || character is '.' or '-' or '_');

  private static CapabilityArgumentValidation InvalidArguments(string message) =>
    CapabilityArgumentValidation.Invalid("arguments_schema_invalid", message);

  private static CapabilityArgumentValidation InvalidResult(string message) =>
    CapabilityArgumentValidation.Invalid("result_schema_invalid", message);
}
