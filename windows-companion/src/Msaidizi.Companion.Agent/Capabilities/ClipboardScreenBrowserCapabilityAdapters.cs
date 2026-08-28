using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Contracts.SessionBridge;

namespace Itemba.Msaidizi.Companion.Agent.Capabilities;

public sealed class ClipboardTextReadCapabilityAdapter(
  InteractiveStaDispatcher dispatcher) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor => StandardUserCapabilityCatalog.ClipboardRead;

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    InteractiveJsonValidation.HasExactProperties(arguments, "maxCharacters")
      && arguments.GetProperty("maxCharacters").TryGetInt32(out var maximum)
      && maximum is >= 1 and <= 262_144
        ? CapabilityArgumentValidation.Success
        : InteractiveJsonValidation.Invalid("maxCharacters must be between 1 and 262144.");

  public CapabilityArgumentValidation ValidateResult(JsonElement result)
  {
    if (!InteractiveJsonValidation.HasExactProperties(
      result,
      "hasText",
      "text",
      "truncated",
      "characterCount",
      "stateSha256")
      || result.GetProperty("hasText").ValueKind is not (JsonValueKind.True or JsonValueKind.False)
      || result.GetProperty("truncated").ValueKind is not (JsonValueKind.True or JsonValueKind.False)
      || !result.GetProperty("characterCount").TryGetInt32(out var count)
      || count < 0
      || !InteractiveJsonValidation.IsSha256(result.GetProperty("stateSha256")))
    {
      return InteractiveJsonValidation.InvalidResult("Clipboard read result is invalid.");
    }

    var hasText = result.GetProperty("hasText").GetBoolean();
    var text = result.GetProperty("text");
    return hasText == (text.ValueKind == JsonValueKind.String)
      ? CapabilityArgumentValidation.Success
      : InteractiveJsonValidation.InvalidResult("Clipboard text presence is inconsistent.");
  }

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var maximum = arguments.GetProperty("maxCharacters").GetInt32();
    var snapshot = await dispatcher.InvokeAsync(() =>
    {
      var hasText = Clipboard.ContainsText(TextDataFormat.UnicodeText);
      var text = hasText ? Clipboard.GetText(TextDataFormat.UnicodeText) : string.Empty;
      return (hasText, text);
    }, cancellationToken).ConfigureAwait(false);
    var stateSha256 = ClipboardState(snapshot.text);
    var truncated = snapshot.text.Length > maximum;
    var visibleText = snapshot.hasText
      ? snapshot.text[..Math.Min(snapshot.text.Length, maximum)]
      : null;
    var output = JsonSerializer.Serialize(new
    {
      hasText = snapshot.hasText,
      text = visibleText,
      truncated,
      characterCount = snapshot.text.Length,
      stateSha256,
    });
    var bytesRead = Encoding.UTF8.GetByteCount(snapshot.text);
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance:
      [
        new DataProvenance(
          "interactive-clipboard",
          PayloadDigest.Sha256Hex($"clipboard:{Environment.ProcessId}"),
          PayloadDigest.Sha256Hex(snapshot.text),
          ProvenanceTrust.UntrustedContent,
          DateTimeOffset.UtcNow),
      ],
      PreStateSha256: stateSha256,
      LocalBytesRead: bytesRead);
  }

  internal static string ClipboardState(string text) =>
    PayloadDigest.Sha256Hex($"itemba-clipboard-state-v1\n{text}");
}

public sealed class ClipboardTextWriteCapabilityAdapter : IHostCapabilityAdapter
{
  private readonly Func<CancellationToken, Task<string>> _readClipboard;
  private readonly Func<string, CancellationToken, Task> _writeClipboard;

  public ClipboardTextWriteCapabilityAdapter(InteractiveStaDispatcher dispatcher)
    : this(
      cancellationToken => dispatcher.InvokeAsync(
        () => Clipboard.ContainsText(TextDataFormat.UnicodeText)
          ? Clipboard.GetText(TextDataFormat.UnicodeText)
          : string.Empty,
        cancellationToken),
      async (text, cancellationToken) =>
      {
        await dispatcher.InvokeAsync(() =>
        {
          Clipboard.SetText(text, TextDataFormat.UnicodeText);
          return true;
        }, cancellationToken).ConfigureAwait(false);
      })
  {
  }

  internal ClipboardTextWriteCapabilityAdapter(
    Func<CancellationToken, Task<string>> readClipboard,
    Func<string, CancellationToken, Task> writeClipboard)
  {
    _readClipboard = readClipboard ?? throw new ArgumentNullException(nameof(readClipboard));
    _writeClipboard = writeClipboard ?? throw new ArgumentNullException(nameof(writeClipboard));
  }

  public CapabilityDescriptor Descriptor => StandardUserCapabilityCatalog.ClipboardWrite;

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    InteractiveJsonValidation.HasExactProperties(arguments, "text")
      && arguments.GetProperty("text").ValueKind == JsonValueKind.String
      && arguments.GetProperty("text").GetString() is { Length: <= 262_144 }
        ? CapabilityArgumentValidation.Success
        : InteractiveJsonValidation.Invalid("text must be a bounded string.");

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    InteractiveJsonValidation.HasExactProperties(
      result,
      "written",
      "characterCount",
      "contentSha256")
    && result.GetProperty("written").ValueKind == JsonValueKind.True
    && result.GetProperty("characterCount").TryGetInt32(out var count)
    && count >= 0
    && InteractiveJsonValidation.IsSha256(result.GetProperty("contentSha256"))
      ? CapabilityArgumentValidation.Success
      : InteractiveJsonValidation.InvalidResult("Clipboard write result is invalid.");

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    if (!PayloadDigest.IsSha256Hex(context.ExpectedPreStateSha256 ?? string.Empty))
    {
      throw new InvalidOperationException("expected_pre_state_required");
    }

    var next = arguments.GetProperty("text").GetString()!;
    var previous = await _readClipboard(cancellationToken).ConfigureAwait(false);
    var preStateSha256 = ClipboardTextReadCapabilityAdapter.ClipboardState(previous);
    if (!PayloadDigest.FixedTimeEqualsHex(context.ExpectedPreStateSha256!, preStateSha256))
    {
      throw new InvalidOperationException("expected_pre_state_mismatch");
    }

    cancellationToken.ThrowIfCancellationRequested();
    await _writeClipboard(next, cancellationToken).ConfigureAwait(false);
    var contentSha256 = PayloadDigest.Sha256Hex(next);
    var output = JsonSerializer.Serialize(new
    {
      written = true,
      characterCount = next.Length,
      contentSha256,
    });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: true,
      OutcomeUncertain: false,
      Provenance:
      [
        new DataProvenance(
          "interactive-clipboard",
          PayloadDigest.Sha256Hex($"clipboard:{Environment.ProcessId}"),
          contentSha256,
          ProvenanceTrust.UserSupplied,
          DateTimeOffset.UtcNow),
      ],
      PreStateSha256: preStateSha256,
      LocalBytesRead: Encoding.UTF8.GetByteCount(previous),
      LocalBytesWritten: Encoding.UTF8.GetByteCount(next));
  }
}

public sealed class PrimaryScreenCaptureCapabilityAdapter(
  InteractiveStaDispatcher dispatcher) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor => StandardUserCapabilityCatalog.ScreenCapture;

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    InteractiveJsonValidation.HasExactProperties(arguments, "maxWidth", "maxHeight")
      && arguments.GetProperty("maxWidth").TryGetInt32(out var width)
      && width is >= 320 and <= 7_680
      && arguments.GetProperty("maxHeight").TryGetInt32(out var height)
      && height is >= 200 and <= 4_320
        ? CapabilityArgumentValidation.Success
        : InteractiveJsonValidation.Invalid("Screen bounds are outside policy.");

  public CapabilityArgumentValidation ValidateResult(JsonElement result)
  {
    if (!InteractiveJsonValidation.HasExactProperties(
      result,
      "mediaType",
      "contentBase64",
      "width",
      "height",
      "contentSha256")
      || result.GetProperty("mediaType").GetString() != "image/png"
      || result.GetProperty("contentBase64").ValueKind != JsonValueKind.String
      || !result.GetProperty("width").TryGetInt32(out var width)
      || width <= 0
      || !result.GetProperty("height").TryGetInt32(out var height)
      || height <= 0
      || !InteractiveJsonValidation.IsSha256(result.GetProperty("contentSha256")))
    {
      return InteractiveJsonValidation.InvalidResult("Screen capture result is invalid.");
    }

    try
    {
      var bytes = Convert.FromBase64String(result.GetProperty("contentBase64").GetString()!);
      return SessionBridgeAuthentication.FixedTimeEqualsHex(
        result.GetProperty("contentSha256").GetString()!,
        Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant())
          ? CapabilityArgumentValidation.Success
          : InteractiveJsonValidation.InvalidResult("Screen content digest does not match.");
    }
    catch (FormatException)
    {
      return InteractiveJsonValidation.InvalidResult("Screen content is not Base64.");
    }
  }

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var maximumWidth = arguments.GetProperty("maxWidth").GetInt32();
    var maximumHeight = arguments.GetProperty("maxHeight").GetInt32();
    var capture = await dispatcher.InvokeAsync(() => Capture(maximumWidth, maximumHeight),
      cancellationToken).ConfigureAwait(false);
    if (capture.Bytes.LongLength > context.Budgets.MaxExternalEgressBytes)
    {
      CryptographicOperations.ZeroMemory(capture.Bytes);
      throw new InvalidOperationException("screen_capture_exceeds_egress_budget");
    }

    try
    {
      var digest = Convert.ToHexString(SHA256.HashData(capture.Bytes)).ToLowerInvariant();
      var output = JsonSerializer.Serialize(new
      {
        mediaType = "image/png",
        contentBase64 = Convert.ToBase64String(capture.Bytes),
        width = capture.Width,
        height = capture.Height,
        contentSha256 = digest,
      });
      return new CapabilityExecutionResult(
        output,
        MutationCommitted: false,
        OutcomeUncertain: false,
        Provenance:
        [
          new DataProvenance(
            "interactive-screen",
            PayloadDigest.Sha256Hex($"primary-screen:{Environment.ProcessId}"),
            digest,
            ProvenanceTrust.UntrustedContent,
            DateTimeOffset.UtcNow),
        ],
        LocalBytesRead: capture.Bytes.LongLength);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(capture.Bytes);
    }
  }

  private static ScreenCapture Capture(int maximumWidth, int maximumHeight)
  {
    var screen = Screen.PrimaryScreen
      ?? throw new InvalidOperationException("primary_screen_unavailable");
    var sourceBounds = screen.Bounds;
    var scale = Math.Min(
      1d,
      Math.Min(
        (double)maximumWidth / sourceBounds.Width,
        (double)maximumHeight / sourceBounds.Height));
    var width = Math.Max(1, (int)Math.Floor(sourceBounds.Width * scale));
    var height = Math.Max(1, (int)Math.Floor(sourceBounds.Height * scale));
    using var source = new Bitmap(sourceBounds.Width, sourceBounds.Height);
    using (var graphics = Graphics.FromImage(source))
    {
      graphics.CopyFromScreen(sourceBounds.Location, Point.Empty, sourceBounds.Size);
    }

    using var output = new Bitmap(width, height);
    using (var graphics = Graphics.FromImage(output))
    {
      graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
      graphics.DrawImage(source, 0, 0, width, height);
    }

    using var stream = new MemoryStream();
    output.Save(stream, ImageFormat.Png);
    return new ScreenCapture(stream.ToArray(), width, height);
  }

  private sealed record ScreenCapture(byte[] Bytes, int Width, int Height);
}

public sealed class BrowserUriOpenCapabilityAdapter(
  ApprovedBrowserLauncher launcher) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor => StandardUserCapabilityCatalog.BrowserNavigate;

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    StandardUserCapabilityContractValidator.ValidateArguments(Descriptor.Id, arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    InteractiveJsonValidation.HasExactProperties(
      result,
      "dispatched",
      "originId",
      "uriSha256")
    && result.GetProperty("dispatched").ValueKind == JsonValueKind.True
    && result.GetProperty("originId").ValueKind == JsonValueKind.String
    && InteractiveJsonValidation.IsSha256(result.GetProperty("uriSha256"))
      ? CapabilityArgumentValidation.Success
      : InteractiveJsonValidation.InvalidResult("Browser dispatch result is invalid.");

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var originId = arguments.GetProperty("originId").GetString()!;
    var target = launcher.Open(arguments);
    var digest = PayloadDigest.Sha256Hex(target.AbsoluteUri);
    var output = JsonSerializer.Serialize(new
    {
      dispatched = true,
      originId,
      uriSha256 = digest,
    });
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: true,
      // OS activation confirms dispatch, not remote completion or response size.
      OutcomeUncertain: true,
      Provenance:
      [
        new DataProvenance(
          "authenticated-browser-session",
          PayloadDigest.Sha256Hex(originId),
          digest,
          ProvenanceTrust.AuthenticatedRemote,
          DateTimeOffset.UtcNow),
      ]));
  }
}
