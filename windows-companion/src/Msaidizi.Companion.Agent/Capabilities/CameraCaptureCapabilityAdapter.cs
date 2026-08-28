using System.Drawing.Imaging;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Agent.Configuration;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Microsoft.Extensions.Options;
using Windows.Media.Capture;
using Windows.Media.MediaProperties;
using Windows.Storage.Streams;

namespace Itemba.Msaidizi.Companion.Agent.Capabilities;

internal sealed record ApprovedCamera(string Id, string DeviceId);

internal sealed class CameraPolicy
{
  private readonly Dictionary<string, ApprovedCamera> _cameras;
  public long MaximumCameraBytes { get; }

  public CameraPolicy(IOptions<AgentOptions> options)
  {
    MaximumCameraBytes = Math.Clamp(options.Value.MaximumCameraBytes, 65_536, 67_108_864);
    _cameras = options.Value.AllowedCameras
      .Select(Parse)
      .ToDictionary(camera => camera.Id, StringComparer.Ordinal);
    if (_cameras.Values.Select(camera => camera.DeviceId)
        .Distinct(StringComparer.Ordinal).Count() != _cameras.Count)
    {
      throw new InvalidOperationException("Camera allowlist contains duplicate device identities.");
    }
  }

  public ApprovedCamera Resolve(string id) => _cameras.TryGetValue(id, out var camera)
    ? camera
    : throw new InvalidOperationException("camera_not_allowed");

  private static ApprovedCamera Parse(AllowedCameraOptions camera)
  {
    if (string.IsNullOrWhiteSpace(camera.Id)
      || camera.Id.Length > 80
      || !camera.Id.All(character => char.IsAsciiLetterOrDigit(character)
        || character is '.' or '-' or '_')
      || string.IsNullOrWhiteSpace(camera.DeviceId)
      || camera.DeviceId.Length > 4_096
      || camera.DeviceId.Contains('\0'))
    {
      throw new InvalidOperationException("An allowed camera is invalid.");
    }
    return new ApprovedCamera(camera.Id, camera.DeviceId);
  }
}

internal sealed record CameraFrame(
  byte[] JpegContent,
  int Width,
  int Height,
  long SourceByteCount);

internal interface IInteractiveCameraDevice
{
  ValueTask<CameraFrame> CaptureJpegAsync(
    string deviceId,
    int maximumWidth,
    int maximumHeight,
    long maximumBytes,
    CancellationToken cancellationToken);
}

internal sealed class WinRtInteractiveCameraDevice(
  InteractiveUiDispatcher uiDispatcher) : IInteractiveCameraDevice, IDisposable
{
  private const int MaximumSourceDimension = 8_192;
  private const long MaximumSourcePixels = 67_108_864;
  private readonly SemaphoreSlim _captureGate = new(1, 1);

  public async ValueTask<CameraFrame> CaptureJpegAsync(
    string deviceId,
    int maximumWidth,
    int maximumHeight,
    long maximumBytes,
    CancellationToken cancellationToken)
  {
    await _captureGate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var settings = new MediaCaptureInitializationSettings
      {
        VideoDeviceId = deviceId,
        StreamingCaptureMode = StreamingCaptureMode.Video,
        SharingMode = MediaCaptureSharingMode.ExclusiveControl,
        MemoryPreference = MediaCaptureMemoryPreference.Cpu,
      };
      using var capture = await uiDispatcher.InvokeAsync(async token =>
      {
        var initialized = new MediaCapture();
        try
        {
          await initialized.InitializeAsync(settings).AsTask(token).ConfigureAwait(true);
          return initialized;
        }
        catch
        {
          initialized.Dispose();
          throw;
        }
      }, cancellationToken).ConfigureAwait(false);
      using var randomAccess = new InMemoryRandomAccessStream();
      var encoding = ImageEncodingProperties.CreateJpeg();
      encoding.Width = checked((uint)maximumWidth);
      encoding.Height = checked((uint)maximumHeight);
      await capture.CapturePhotoToStreamAsync(encoding, randomAccess)
        .AsTask(cancellationToken).ConfigureAwait(false);
      if (randomAccess.Size == 0 || randomAccess.Size > checked((ulong)maximumBytes))
      {
        throw new InvalidOperationException("camera_source_exceeds_policy");
      }

      randomAccess.Seek(0);
      byte[] source;
      using (var input = randomAccess.GetInputStreamAt(0))
      using (var reader = new DataReader(input))
      {
        var sourceLength = checked((uint)randomAccess.Size);
        var loaded = await reader.LoadAsync(sourceLength)
          .AsTask(cancellationToken).ConfigureAwait(false);
        if (loaded != sourceLength)
        {
          throw new InvalidOperationException("camera_source_incomplete");
        }
        source = new byte[sourceLength];
        reader.ReadBytes(source);
      }

      try
      {
        using var sourceStream = new MemoryStream(source, writable: false);
        using var image = Image.FromStream(
          sourceStream,
          useEmbeddedColorManagement: false,
          validateImageData: true);
        if (image.Width is <= 0 or > MaximumSourceDimension
          || image.Height is <= 0 or > MaximumSourceDimension
          || (long)image.Width * image.Height > MaximumSourcePixels)
        {
          throw new InvalidOperationException("camera_dimensions_exceed_policy");
        }
        var scale = Math.Min(
          1d,
          Math.Min(
            (double)maximumWidth / image.Width,
            (double)maximumHeight / image.Height));
        var width = Math.Max(1, checked((int)Math.Floor(image.Width * scale)));
        var height = Math.Max(1, checked((int)Math.Floor(image.Height * scale)));
        using var bitmap = new Bitmap(width, height, PixelFormat.Format24bppRgb);
        using (var graphics = Graphics.FromImage(bitmap))
        {
          graphics.Clear(Color.Black);
          graphics.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
          graphics.CompositingQuality = System.Drawing.Drawing2D.CompositingQuality.HighQuality;
          graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
          graphics.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
          graphics.DrawImage(image, 0, 0, width, height);
        }
        using var output = new MemoryStream();
        bitmap.Save(output, ImageFormat.Jpeg);
        if (output.Length <= 0 || output.Length > maximumBytes)
        {
          throw new InvalidOperationException("camera_capture_exceeds_budget");
        }
        return new CameraFrame(
          output.ToArray(),
          width,
          height,
          source.LongLength);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(source);
      }
    }
    catch (OperationCanceledException)
    {
      throw;
    }
    catch (InvalidOperationException exception) when (
      exception.Message.StartsWith("camera_", StringComparison.Ordinal))
    {
      throw;
    }
    catch (Exception exception)
    {
      throw new InvalidOperationException("camera_capture_failed", exception);
    }
    finally
    {
      _captureGate.Release();
    }
  }

  public void Dispose() => _captureGate.Dispose();
}

internal sealed class CameraPhotoCaptureCapabilityAdapter(
  CameraPolicy policy,
  IInteractiveCameraDevice camera) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor => StandardUserCapabilityCatalog.CameraCapture;

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    StandardUserCapabilityContractValidator.ValidateArguments(Descriptor.Id, arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    StandardUserCapabilityContractValidator.ValidateResult(Descriptor.Id, result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var approved = policy.Resolve(arguments.GetProperty("cameraId").GetString()!);
    var maximumEgressPayload = Math.Max(
      0,
      (context.Budgets.MaxExternalEgressBytes - 4_096) / 4 * 3);
    var maximumBytes = Math.Min(
      policy.MaximumCameraBytes,
      Math.Min(context.Budgets.MaxLocalBytes, maximumEgressPayload));
    if (maximumBytes < 1_024)
    {
      throw new InvalidOperationException("camera_capture_budget_required");
    }
    var frame = await camera.CaptureJpegAsync(
      approved.DeviceId,
      arguments.GetProperty("maxWidth").GetInt32(),
      arguments.GetProperty("maxHeight").GetInt32(),
      maximumBytes,
      cancellationToken).ConfigureAwait(false);
    try
    {
      if (frame.JpegContent.LongLength > maximumBytes
        || frame.SourceByteCount > context.Budgets.MaxLocalBytes)
      {
        throw new InvalidOperationException("camera_capture_exceeds_budget");
      }
      var digest = Convert.ToHexString(SHA256.HashData(frame.JpegContent)).ToLowerInvariant();
      var output = JsonSerializer.Serialize(new
      {
        cameraId = approved.Id,
        mediaType = "image/jpeg",
        contentBase64 = Convert.ToBase64String(frame.JpegContent),
        width = frame.Width,
        height = frame.Height,
        contentSha256 = digest,
      });
      return new CapabilityExecutionResult(
        output,
        MutationCommitted: false,
        OutcomeUncertain: false,
        Provenance:
        [
          new DataProvenance(
            "interactive-camera",
            PayloadDigest.Sha256Hex($"{approved.Id}\n{approved.DeviceId}"),
            digest,
            ProvenanceTrust.UntrustedContent,
            DateTimeOffset.UtcNow),
        ],
        LocalBytesRead: frame.SourceByteCount);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(frame.JpegContent);
    }
  }
}
