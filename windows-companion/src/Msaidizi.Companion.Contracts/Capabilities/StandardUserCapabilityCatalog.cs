using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Contracts.Capabilities;

/// <summary>
/// The reviewed standard-user capability surface shared by the LocalSystem
/// proxy and the interactive-session agent. Keeping the descriptors in the
/// contracts assembly prevents either side from silently widening a schema.
/// </summary>
public static class StandardUserCapabilityCatalog
{
  private static readonly JsonSerializerOptions ManifestSerializerOptions =
    new(JsonSerializerDefaults.Web);
  public static CapabilityDescriptor SessionStatus { get; } = Descriptor(
    "session.status.read",
    "Read interactive session status",
    "Reports whether the authenticated standard-user session is interactive.",
    CapabilityDataClass.Internal,
    CapabilityEffect.LocalRead,
    ConsentRequirement.ActiveUser,
    RecoveryKind.NotApplicable,
    EmptyObject,
    """
    {
      "type": "object",
      "properties": {
        "interactive": { "type": "boolean" },
        "sessionId": { "type": "integer", "minimum": 0 }
      },
      "required": ["interactive", "sessionId"],
      "additionalProperties": false
    }
    """,
    ["interactive-session-runtime"]);

  public static CapabilityDescriptor ClipboardRead { get; } = Descriptor(
    "clipboard.text.read",
    "Read clipboard text",
    "Reads bounded Unicode text from the active user's clipboard.",
    CapabilityDataClass.Restricted,
    CapabilityEffect.LocalRead,
    ConsentRequirement.ActiveUser,
    RecoveryKind.NotApplicable,
    """
    {
      "type": "object",
      "properties": {
        "maxCharacters": { "type": "integer", "minimum": 1, "maximum": 262144 }
      },
      "required": ["maxCharacters"],
      "additionalProperties": false
    }
    """,
    """
    {
      "type": "object",
      "properties": {
        "hasText": { "type": "boolean" },
        "text": { "type": ["string", "null"] },
        "truncated": { "type": "boolean" },
        "characterCount": { "type": "integer", "minimum": 0 },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["hasText", "text", "truncated", "characterCount", "stateSha256"],
      "additionalProperties": false
    }
    """,
    ["interactive-clipboard"]);

  public static CapabilityDescriptor ClipboardWrite { get; } = Descriptor(
    "clipboard.text.write",
    "Write clipboard text",
    "Irreversibly replaces the active user's clipboard text after exact pre-state validation.",
    CapabilityDataClass.Restricted,
    CapabilityEffect.LocalWrite,
    ConsentRequirement.ActiveUser,
    RecoveryKind.Irreversible,
    """
    {
      "type": "object",
      "properties": {
        "text": { "type": "string", "maxLength": 262144 }
      },
      "required": ["text"],
      "additionalProperties": false
    }
    """,
    """
    {
      "type": "object",
      "properties": {
        "written": { "type": "boolean" },
        "characterCount": { "type": "integer", "minimum": 0 },
        "contentSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["written", "characterCount", "contentSha256"],
      "additionalProperties": false
    }
    """,
    ["interactive-clipboard"]);

  public static CapabilityDescriptor ScreenCapture { get; } = Descriptor(
    "screen.primary.capture",
    "Capture primary screen",
    "Captures a bounded PNG of the primary interactive display.",
    CapabilityDataClass.Restricted,
    CapabilityEffect.LocalRead,
    ConsentRequirement.ActiveUser,
    RecoveryKind.NotApplicable,
    """
    {
      "type": "object",
      "properties": {
        "maxWidth": { "type": "integer", "minimum": 320, "maximum": 7680 },
        "maxHeight": { "type": "integer", "minimum": 200, "maximum": 4320 }
      },
      "required": ["maxWidth", "maxHeight"],
      "additionalProperties": false
    }
    """,
    """
    {
      "type": "object",
      "properties": {
        "mediaType": { "const": "image/png" },
        "contentBase64": { "type": "string" },
        "width": { "type": "integer", "minimum": 1 },
        "height": { "type": "integer", "minimum": 1 },
        "contentSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["mediaType", "contentBase64", "width", "height", "contentSha256"],
      "additionalProperties": false
    }
    """,
    ["interactive-screen"]);

  public static CapabilityDescriptor CameraCapture { get; } = Descriptor(
    "camera.photo.capture",
    "Capture approved camera photo",
    "Captures one bounded JPEG from a supervisor-approved camera in the active user session.",
    CapabilityDataClass.Biometric,
    CapabilityEffect.LocalRead,
    ConsentRequirement.ActiveUser,
    RecoveryKind.NotApplicable,
    """
    {
      "type": "object",
      "properties": {
        "cameraId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "maxWidth": { "type": "integer", "minimum": 320, "maximum": 3840 },
        "maxHeight": { "type": "integer", "minimum": 240, "maximum": 2160 }
      },
      "required": ["cameraId", "maxWidth", "maxHeight"],
      "additionalProperties": false
    }
    """,
    """
    {
      "type": "object",
      "properties": {
        "cameraId": { "type": "string" },
        "mediaType": { "const": "image/jpeg" },
        "contentBase64": { "type": "string" },
        "width": { "type": "integer", "minimum": 1 },
        "height": { "type": "integer", "minimum": 1 },
        "contentSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["cameraId", "mediaType", "contentBase64", "width", "height", "contentSha256"],
      "additionalProperties": false
    }
    """,
    ["interactive-camera"]);

  public static CapabilityDescriptor MicrophoneCapture { get; } = Descriptor(
    "audio.microphone.capture",
    "Capture microphone audio",
    "Records a bounded mono PCM WAV clip from the active user's default microphone.",
    CapabilityDataClass.Biometric,
    CapabilityEffect.LocalRead,
    ConsentRequirement.ActiveUser,
    RecoveryKind.NotApplicable,
    """
    {
      "type": "object",
      "properties": {
        "durationMilliseconds": { "type": "integer", "minimum": 100, "maximum": 30000 }
      },
      "required": ["durationMilliseconds"],
      "additionalProperties": false
    }
    """,
    """
    {
      "type": "object",
      "properties": {
        "mediaType": { "const": "audio/wav" },
        "contentBase64": { "type": "string" },
        "durationMilliseconds": { "type": "integer", "minimum": 1 },
        "contentSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["mediaType", "contentBase64", "durationMilliseconds", "contentSha256"],
      "additionalProperties": false
    }
    """,
    ["interactive-microphone"]);

  public static CapabilityDescriptor AudioPlayback { get; } = Descriptor(
    "audio.wav.play",
    "Play WAV audio",
    "Plays a bounded PCM WAV payload in the active user's session; elapsed audible output cannot be undone, and cancellation stops only remaining playback.",
    CapabilityDataClass.Restricted,
    CapabilityEffect.LocalWrite,
    ConsentRequirement.ActiveUser,
    RecoveryKind.Irreversible,
    """
    {
      "type": "object",
      "properties": {
        "contentBase64": { "type": "string" },
        "maxDurationMilliseconds": { "type": "integer", "minimum": 100, "maximum": 120000 }
      },
      "required": ["contentBase64", "maxDurationMilliseconds"],
      "additionalProperties": false
    }
    """,
    """
    {
      "type": "object",
      "properties": {
        "played": { "type": "boolean" },
        "contentSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["played", "contentSha256"],
      "additionalProperties": false
    }
    """,
    ["interactive-audio-output"]);

  public static CapabilityDescriptor SpeechSynthesize { get; } = Descriptor(
    "speech.text.synthesize",
    "Synthesize speech locally",
    "Uses one supervisor-approved Windows-installed voice to synthesize a bounded PCM WAV without an adapter network call.",
    CapabilityDataClass.Restricted,
    CapabilityEffect.LocalRead,
    ConsentRequirement.ActiveUser,
    RecoveryKind.NotApplicable,
    """
    {
      "type": "object",
      "properties": {
        "voiceId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "text": { "type": "string", "minLength": 1, "maxLength": 4096 },
        "rate": { "type": "integer", "minimum": -10, "maximum": 10 },
        "volume": { "type": "integer", "minimum": 0, "maximum": 100 }
      },
      "required": ["voiceId", "text", "rate", "volume"],
      "additionalProperties": false
    }
    """,
    """
    {
      "type": "object",
      "properties": {
        "voiceId": { "type": "string" },
        "mediaType": { "const": "audio/wav" },
        "contentBase64": { "type": "string" },
        "durationMilliseconds": { "type": "integer", "minimum": 1 },
        "contentSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["voiceId", "mediaType", "contentBase64", "durationMilliseconds", "contentSha256"],
      "additionalProperties": false
    }
    """,
    ["windows-installed-voice"]);

  public static CapabilityDescriptor SpeechTranscribe { get; } = Descriptor(
    "speech.audio.transcribe",
    "Transcribe speech locally",
    "Captures a bounded PCM WAV and transcribes it with one supervisor-approved in-process Windows-installed recognizer. Raw audio never enters the action arguments, session bridge, journal, result, or broker channel.",
    CapabilityDataClass.Biometric,
    CapabilityEffect.LocalRead,
    ConsentRequirement.OneShotApproval,
    RecoveryKind.NotApplicable,
    """
    {
      "type": "object",
      "properties": {
        "recognizerId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "durationMilliseconds": { "type": "integer", "minimum": 100, "maximum": 30000 },
        "maxCharacters": { "type": "integer", "minimum": 1, "maximum": 32768 }
      },
      "required": ["recognizerId", "durationMilliseconds", "maxCharacters"],
      "additionalProperties": false
    }
    """,
    """
    {
      "type": "object",
      "properties": {
        "protocol": { "const": "msaidizi-local-stt/v1" },
        "taskId": { "type": "string" },
        "planVersionId": { "type": "string" },
        "stepId": { "type": "string" },
        "deviceId": { "type": "string" },
        "actionId": { "type": "string" },
        "recognizerId": { "type": "string" },
        "audioBytes": { "type": "integer", "minimum": 44, "maximum": 16777216 },
        "durationMilliseconds": { "type": "integer", "minimum": 1 },
        "transcript": { "type": "string", "maxLength": 32768 },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
        "audioSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "transcriptSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "audioBindingSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "redactionsApplied": { "type": "boolean" },
        "trustLevel": { "const": "UNTRUSTED" },
        "instructionAuthority": { "const": "NONE" }
      },
      "required": ["protocol", "taskId", "planVersionId", "stepId", "deviceId", "actionId", "recognizerId", "audioBytes", "durationMilliseconds", "transcript", "confidence", "audioSha256", "transcriptSha256", "audioBindingSha256", "redactionsApplied", "trustLevel", "instructionAuthority"],
      "additionalProperties": false
    }
    """,
    ["windows-installed-speech-recognizer", "speech-input-audio"]);

  public static CapabilityDescriptor BrowserNavigate { get; } = Descriptor(
    "browser.uri.open",
    "Open approved browser URI",
    "Opens an allowlisted HTTPS origin and relative path in the user's authenticated browser session; query, fragment, user info, and raw credentials are rejected.",
    CapabilityDataClass.Restricted,
    CapabilityEffect.Irreversible,
    ConsentRequirement.SignedMandate,
    RecoveryKind.Irreversible,
    """
    {
      "type": "object",
      "properties": {
        "originId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "relativePath": { "type": "string", "minLength": 1, "maxLength": 2048 }
      },
      "required": ["originId", "relativePath"],
      "additionalProperties": false
    }
    """,
    """
    {
      "type": "object",
      "properties": {
        "dispatched": { "type": "boolean" },
        "originId": { "type": "string" },
        "uriSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["dispatched", "originId", "uriSha256"],
      "additionalProperties": false
    }
    """,
    ["authenticated-browser-session"]);

  public static CapabilityDescriptor ForegroundInspect { get; } = Descriptor(
    "ui.foreground.inspect",
    "Inspect foreground UI",
    "Returns a bounded UI Automation tree for the active foreground window as untrusted content.",
    CapabilityDataClass.Restricted,
    CapabilityEffect.LocalRead,
    ConsentRequirement.ActiveUser,
    RecoveryKind.NotApplicable,
    """
    {
      "type": "object",
      "properties": {
        "maxElements": { "type": "integer", "minimum": 1, "maximum": 500 },
        "maxDepth": { "type": "integer", "minimum": 0, "maximum": 12 }
      },
      "required": ["maxElements", "maxDepth"],
      "additionalProperties": false
    }
    """,
    """
    {
      "type": "object",
      "properties": {
        "processId": { "type": "integer", "minimum": 1 },
        "windowStateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "elements": { "type": "array", "maxItems": 500 }
      },
      "required": ["processId", "windowStateSha256", "elements"],
      "additionalProperties": false
    }
    """,
    ["ui-automation-tree"]);

  public static CapabilityDescriptor ElementInvoke { get; } = Descriptor(
    "ui.element.invoke",
    "Invoke approved UI element",
    "Invokes one exact UI Automation element in an allowlisted process after matching the expected foreground-window state.",
    CapabilityDataClass.Restricted,
    CapabilityEffect.Irreversible,
    ConsentRequirement.SignedMandate,
    RecoveryKind.Irreversible,
    """
    {
      "type": "object",
      "properties": {
        "processId": { "type": "integer", "minimum": 1 },
        "automationId": { "type": "string", "minLength": 1, "maxLength": 512 },
        "controlType": { "type": "string", "enum": ["Button", "Hyperlink", "MenuItem", "TabItem"] }
      },
      "required": ["processId", "automationId", "controlType"],
      "additionalProperties": false
    }
    """,
    """
    {
      "type": "object",
      "properties": {
        "invoked": { "type": "boolean" },
        "processId": { "type": "integer", "minimum": 1 },
        "automationIdSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["invoked", "processId", "automationIdSha256"],
      "additionalProperties": false
    }
    """,
    ["ui-automation-action"]);

  public static CapabilityDescriptor EmergencyCommandExecute { get; } = Descriptor(
    "command.emergency.execute",
    "Execute emergency standard-user command",
    "Runs one exact argv vector through Command Prompt or Windows PowerShell in the authenticated interactive user session. Output content is never returned or journalled; only bounded byte counts and digests leave the process.",
    CapabilityDataClass.Credential,
    CapabilityEffect.Irreversible,
    ConsentRequirement.EmergencyOperator,
    RecoveryKind.Irreversible,
    """
    {
      "type": "object",
      "properties": {
        "executable": { "type": "string", "enum": ["cmd", "windows-powershell"] },
        "argv": {
          "type": "array",
          "minItems": 1,
          "maxItems": 64,
          "items": { "type": "string", "maxLength": 4096 }
        },
        "workingDirectoryId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" }
      },
      "required": ["executable", "argv", "workingDirectoryId"],
      "additionalProperties": false
    }
    """,
    """
    {
      "type": "object",
      "properties": {
        "executable": { "type": "string", "enum": ["cmd", "windows-powershell"] },
        "exitCode": { "type": "integer" },
        "stdoutBytes": { "type": "integer", "minimum": 0 },
        "stderrBytes": { "type": "integer", "minimum": 0 },
        "stdoutSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "stderrSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["executable", "exitCode", "stdoutBytes", "stderrBytes", "stdoutSha256", "stderrSha256"],
      "additionalProperties": false
    }
    """,
    ["standard-user-command-output"]);

  public static CapabilityDescriptor BrowserFormSecretSet { get; } = Descriptor(
    "browser.form.secret.set",
    "Set browser form secret",
    "Sets one exact browser UI Automation edit field from a scoped vault handle. Raw values and clipboard fallback are prohibited.",
    CapabilityDataClass.Credential,
    CapabilityEffect.Irreversible,
    ConsentRequirement.SignedMandate,
    RecoveryKind.Irreversible,
    BrowserSecretArguments(includeUploadRoot: false),
    BrowserSecretResult,
    ["browser-ui-secret-action"]);

  public static CapabilityDescriptor BrowserFormTextSet { get; } = Descriptor(
    "browser.form.text.set",
    "Set browser form text",
    "Sets one exact browser UI Automation edit field to bounded public or internal text after matching the signed foreground-window pre-state. Credentials and other restricted values must use an ephemeral reference capability instead.",
    CapabilityDataClass.Internal,
    CapabilityEffect.Irreversible,
    ConsentRequirement.SignedMandate,
    RecoveryKind.Irreversible,
    """
    {
      "type": "object",
      "properties": {
        "originId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "originSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "processId": { "type": "integer", "minimum": 1 },
        "automationId": { "type": "string", "minLength": 1, "maxLength": 512 },
        "contentClass": { "type": "string", "enum": ["public", "internal"] },
        "text": { "type": "string", "maxLength": 4096 }
      },
      "required": ["originId", "originSha256", "processId", "automationId", "contentClass", "text"],
      "additionalProperties": false
    }
    """,
    """
    {
      "type": "object",
      "properties": {
        "set": { "type": "boolean" },
        "contentSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "destinationScopeSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["set", "contentSha256", "destinationScopeSha256"],
      "additionalProperties": false
    }
    """,
    ["browser-ui-text-action"]);

  public static CapabilityDescriptor BrowserFileUpload { get; } = Descriptor(
    "browser.file.upload",
    "Select browser upload file",
    "Sets one exact browser file field from either a scoped vault path handle or a broker-signed, digest-bound small artifact envelope. Raw paths, URLs, and clipboard fallback are prohibited.",
    CapabilityDataClass.Restricted,
    CapabilityEffect.Irreversible,
    ConsentRequirement.SignedMandate,
    RecoveryKind.Irreversible,
    BrowserFileUploadArguments,
    BrowserFileUploadResult,
    ["browser-ui-file-action", "governed-artifact-upload"]);

  public static CapabilityDescriptor BrowserDownloadInvoke { get; } = Descriptor(
    "browser.download.invoke",
    "Invoke browser download",
    "Invokes one exact download control in the approved foreground browser after matching its signed pre-state.",
    CapabilityDataClass.Restricted,
    CapabilityEffect.Irreversible,
    ConsentRequirement.SignedMandate,
    RecoveryKind.Irreversible,
    """
    {
      "type": "object",
      "properties": {
        "originId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "originSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "processId": { "type": "integer", "minimum": 1 },
        "automationId": { "type": "string", "minLength": 1, "maxLength": 512 },
        "controlType": { "type": "string", "enum": ["Button", "Hyperlink", "MenuItem"] }
      },
      "required": ["originId", "originSha256", "processId", "automationId", "controlType"],
      "additionalProperties": false
    }
    """,
    """
    {
      "type": "object",
      "properties": {
        "dispatched": { "type": "boolean" },
        "destinationScopeSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["dispatched", "destinationScopeSha256"],
      "additionalProperties": false
    }
    """,
    ["browser-ui-download-action"]);

  public static IReadOnlyList<CapabilityDescriptor> All { get; } =
  [
    SessionStatus,
    ClipboardRead,
    ClipboardWrite,
    ScreenCapture,
    CameraCapture,
    AudioPlayback,
    SpeechSynthesize,
    SpeechTranscribe,
    BrowserNavigate,
    ForegroundInspect,
    ElementInvoke,
    EmergencyCommandExecute,
    BrowserFormTextSet,
    BrowserFormSecretSet,
    BrowserFileUpload,
    BrowserDownloadInvoke,
  ];

  private static readonly HashSet<string> MeteredBrowserEffectIds = new(
  [
    BrowserNavigate.Id,
    ElementInvoke.Id,
    BrowserFormTextSet.Id,
    BrowserFormSecretSet.Id,
    BrowserFileUpload.Id,
    BrowserDownloadInvoke.Id,
  ],
  StringComparer.Ordinal);

  /// <summary>
  /// Returns the exact manifest allowed by supervisor configuration. External
  /// browser effects and the emergency command path stay absent unless an
  /// independently enforced egress boundary has been attested.
  /// </summary>
  public static IReadOnlyList<CapabilityDescriptor> SelectEnabled(
    bool browserExternalEffectsEnabled,
    bool emergencyCommandEnabled) => SelectEnabled(
      browserExternalEffectsEnabled,
      emergencyCommandEnabled,
      verifiedBoundaryAttestation: null);

  public static IReadOnlyList<CapabilityDescriptor> SelectEnabled(
    bool browserExternalEffectsEnabled,
    bool emergencyCommandEnabled,
    VerifiedCapabilityBoundaryAttestation? verifiedBoundaryAttestation)
  {
    var requested = DescribeRequestedSurface(
      browserExternalEffectsEnabled,
      emergencyCommandEnabled);
    if (browserExternalEffectsEnabled || emergencyCommandEnabled)
    {
      var evidence = verifiedBoundaryAttestation?.SignedAttestation.Attestation;
      if (verifiedBoundaryAttestation is null
        || evidence is null
        || !verifiedBoundaryAttestation.IsFresh(DateTimeOffset.UtcNow)
        || evidence.BrowserExternalEffectsEnabled != browserExternalEffectsEnabled
        || evidence.EmergencyCommandEnabled != emergencyCommandEnabled
        || !PayloadDigest.FixedTimeEqualsHex(
          evidence.CapabilityManifestSha256,
          ManifestSha256(requested))
        || (browserExternalEffectsEnabled
          && !verifiedBoundaryAttestation.HasAllFeatures(
            EgressBoundaryFeatures.BrowserRequired))
        || (emergencyCommandEnabled
          && !verifiedBoundaryAttestation.HasAllFeatures(
            EgressBoundaryFeatures.CommandRequired)))
      {
        throw new InvalidOperationException(
          "Standard-user external effects require a fresh, process-bound, manifest-bound attestation from the independently privileged boundary supervisor.");
      }
    }

    return requested;
  }

  /// <summary>
  /// Computes a candidate manifest only. This method grants no authority; the
  /// candidate may be exposed only through <see cref="SelectEnabled(bool, bool,
  /// VerifiedCapabilityBoundaryAttestation?)"/> after signed evidence binds it.
  /// </summary>
  public static IReadOnlyList<CapabilityDescriptor> DescribeRequestedSurface(
    bool browserExternalEffectsEnabled,
    bool emergencyCommandEnabled) => All.Where(descriptor =>
      (browserExternalEffectsEnabled || !MeteredBrowserEffectIds.Contains(descriptor.Id))
      && (emergencyCommandEnabled || descriptor.Id != EmergencyCommandExecute.Id))
      .ToArray();

  public static string RequestedManifestSha256(
    bool browserExternalEffectsEnabled,
    bool emergencyCommandEnabled) => ManifestSha256(DescribeRequestedSurface(
      browserExternalEffectsEnabled,
      emergencyCommandEnabled));

  public static bool RequiresEgressBoundary(string capabilityId) =>
    MeteredBrowserEffectIds.Contains(capabilityId)
    || string.Equals(capabilityId, EmergencyCommandExecute.Id, StringComparison.Ordinal);

  public static IReadOnlyList<string> RequiredBoundaryFeatures(string capabilityId) =>
    MeteredBrowserEffectIds.Contains(capabilityId)
      ? EgressBoundaryFeatures.BrowserRequired
      : string.Equals(capabilityId, EmergencyCommandExecute.Id, StringComparison.Ordinal)
        ? EgressBoundaryFeatures.CommandRequired
        : Array.Empty<string>();

  public static string ManifestSha256(IEnumerable<CapabilityDescriptor> capabilities) =>
    PayloadDigest.Sha256Hex(JsonSerializer.Serialize(
      capabilities
        .OrderBy(descriptor => descriptor.Id, StringComparer.Ordinal)
        .ThenBy(descriptor => descriptor.Version, StringComparer.Ordinal),
      ManifestSerializerOptions));

  private const string BrowserSecretResult =
    """
    {
      "type": "object",
      "properties": {
        "set": { "type": "boolean" },
        "secretReferenceSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "destinationScopeSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["set", "secretReferenceSha256", "destinationScopeSha256"],
      "additionalProperties": false
    }
    """;

  private const string BrowserFileUploadArguments =
    """
    {
      "type": "object",
      "properties": {
        "originId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "originSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "processId": { "type": "integer", "minimum": 1 },
        "automationId": { "type": "string", "minLength": 1, "maxLength": 512 },
        "secretReferenceId": { "type": "string", "format": "uuid" },
        "uploadRootId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "artifact": {
          "type": "object",
          "properties": {
            "schemaVersion": { "const": 1 },
            "taskId": { "type": "string", "format": "uuid" },
            "planVersionId": { "type": "string", "format": "uuid" },
            "targetStepId": { "type": "string", "format": "uuid" },
            "deviceId": { "type": "string", "format": "uuid" },
            "sourceStepId": { "type": "string", "format": "uuid" },
            "sourceAttemptId": { "type": "string", "minLength": 1, "maxLength": 200 },
            "artifactId": { "type": "string", "format": "uuid" },
            "sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
            "byteSize": { "type": "integer", "minimum": 1, "maximum": 131072 },
            "mimeType": { "type": "string", "minLength": 3, "maxLength": 127 },
            "name": { "type": "string", "minLength": 1, "maxLength": 255 },
            "kind": { "const": "SCREENSHOT" },
            "dataClass": { "type": "string", "minLength": 1, "maxLength": 64 },
            "scopeSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
            "contentBase64": { "type": "string", "minLength": 4, "maxLength": 174764 }
          },
          "required": ["schemaVersion", "taskId", "planVersionId", "targetStepId", "deviceId", "sourceStepId", "sourceAttemptId", "artifactId", "sha256", "byteSize", "mimeType", "name", "kind", "dataClass", "scopeSha256", "contentBase64"],
          "additionalProperties": false
        }
      },
      "oneOf": [
        {
          "required": ["originId", "originSha256", "processId", "automationId", "secretReferenceId", "uploadRootId"],
          "not": { "required": ["artifact"] }
        },
        {
          "required": ["originId", "originSha256", "processId", "automationId", "artifact"],
          "not": { "anyOf": [{ "required": ["secretReferenceId"] }, { "required": ["uploadRootId"] }] }
        }
      ],
      "additionalProperties": false
    }
    """;

  private const string BrowserFileUploadResult =
    """
    {
      "type": "object",
      "properties": {
        "set": { "type": "boolean" },
        "secretReferenceSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "artifactSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "quarantineCleanupConfirmed": { "type": "boolean" },
        "destinationScopeSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "oneOf": [
        {
          "required": ["set", "secretReferenceSha256", "destinationScopeSha256"],
          "not": { "anyOf": [{ "required": ["artifactSha256"] }, { "required": ["quarantineCleanupConfirmed"] }] }
        },
        {
          "required": ["set", "artifactSha256", "quarantineCleanupConfirmed", "destinationScopeSha256"],
          "not": { "required": ["secretReferenceSha256"] }
        }
      ],
      "additionalProperties": false
    }
    """;

  private const string EmptyObject =
    """
    {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
    """;

  private static CapabilityDescriptor Descriptor(
    string id,
    string displayName,
    string description,
    CapabilityDataClass dataClass,
    CapabilityEffect effect,
    ConsentRequirement consent,
    RecoveryKind recovery,
    string argumentsSchema,
    string resultSchema,
    IReadOnlyList<string> provenanceOutputs) => new(
      Id: id,
      Version: "1.0.0",
      DisplayName: displayName,
      Description: description,
      DataClass: dataClass,
      Effect: effect,
      Consent: consent,
      Recovery: recovery,
      RequiredPrivilege: RequiredPrivilege.StandardUser,
      Idempotency: IdempotencySemantics.Required,
      SupportedOperatingSystems: ["windows-11-x64"],
      ArgumentsSchema: Parse(argumentsSchema),
      ResultSchema: Parse(resultSchema),
      ProvenanceOutputs: provenanceOutputs,
      TouchesTrustedRoot: false);

  private static string BrowserSecretArguments(bool includeUploadRoot) => includeUploadRoot
    ?
    """
    {
      "type": "object",
      "properties": {
        "originId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "originSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "processId": { "type": "integer", "minimum": 1 },
        "automationId": { "type": "string", "minLength": 1, "maxLength": 512 },
        "secretReferenceId": { "type": "string", "format": "uuid" },
        "uploadRootId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" }
      },
      "required": ["originId", "originSha256", "processId", "automationId", "secretReferenceId", "uploadRootId"],
      "additionalProperties": false
    }
    """
    :
    """
    {
      "type": "object",
      "properties": {
        "originId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "originSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "processId": { "type": "integer", "minimum": 1 },
        "automationId": { "type": "string", "minLength": 1, "maxLength": 512 },
        "secretReferenceId": { "type": "string", "format": "uuid" }
      },
      "required": ["originId", "originSha256", "processId", "automationId", "secretReferenceId"],
      "additionalProperties": false
    }
    """;

  private static JsonElement Parse(string json)
  {
    using var document = JsonDocument.Parse(json);
    return document.RootElement.Clone();
  }
}
