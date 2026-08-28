using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Execution;
using Itemba.Msaidizi.Companion.Service.Security;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal sealed record DisplaySnapshot(
  string DisplayId,
  bool Primary,
  int X,
  int Y,
  uint Width,
  uint Height,
  uint BitsPerPixel,
  uint RefreshHertz,
  string Orientation);

internal interface IWindowsDisplayInventory
{
  IReadOnlyList<DisplaySnapshot> Read();
}

internal sealed class WindowsDisplayInventory : IWindowsDisplayInventory
{
  private const int MaximumDisplays = 16;
  private const int EnumCurrentSettings = -1;
  private const uint MonitorInfoPrimary = 0x1;

  public IReadOnlyList<DisplaySnapshot> Read()
  {
    var displays = new List<DisplaySnapshot>();
    var exceeded = false;
    MonitorEnumerationCallback callback = (monitor, _, _, _) =>
    {
      if (displays.Count == MaximumDisplays)
      {
        exceeded = true;
        return false;
      }
      var info = new MonitorInfoEx { Size = Marshal.SizeOf<MonitorInfoEx>() };
      if (!GetMonitorInfo(monitor, ref info))
      {
        throw NativeFailure("display_inventory_unavailable");
      }
      var mode = new DeviceMode { Size = checked((ushort)Marshal.SizeOf<DeviceMode>()) };
      if (!EnumDisplaySettings(info.DeviceName, EnumCurrentSettings, ref mode))
      {
        throw NativeFailure("display_mode_unavailable");
      }
      displays.Add(new DisplaySnapshot(
        PayloadDigest.Sha256Hex(info.DeviceName),
        (info.Flags & MonitorInfoPrimary) != 0,
        info.Monitor.Left,
        info.Monitor.Top,
        mode.PixelsWidth,
        mode.PixelsHeight,
        mode.BitsPerPixel,
        mode.DisplayFrequency,
        mode.DisplayOrientation switch
        {
          0 => "landscape",
          1 => "portrait",
          2 => "landscape-flipped",
          3 => "portrait-flipped",
          _ => "unknown",
        }));
      return true;
    };
    if (!EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, callback, IntPtr.Zero) && !exceeded)
    {
      throw NativeFailure("display_inventory_unavailable");
    }
    if (exceeded)
    {
      throw new HostPreconditionException("display_inventory_limit_exceeded");
    }
    return displays
      .OrderByDescending(display => display.Primary)
      .ThenBy(display => display.DisplayId, StringComparer.Ordinal)
      .ToArray();
  }

  private static HostPreconditionException NativeFailure(string errorCode) =>
    new($"{errorCode}_{new Win32Exception(Marshal.GetLastWin32Error()).NativeErrorCode}");

  [DllImport("user32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool EnumDisplayMonitors(
    IntPtr deviceContext,
    IntPtr clippingRectangle,
    MonitorEnumerationCallback callback,
    IntPtr data);

  [DllImport("user32.dll", EntryPoint = "GetMonitorInfoW", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetMonitorInfo(
    IntPtr monitor,
    ref MonitorInfoEx monitorInfo);

  [DllImport("user32.dll", EntryPoint = "EnumDisplaySettingsW", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool EnumDisplaySettings(
    string deviceName,
    int modeNumber,
    ref DeviceMode deviceMode);

  [return: MarshalAs(UnmanagedType.Bool)]
  private delegate bool MonitorEnumerationCallback(
    IntPtr monitor,
    IntPtr deviceContext,
    IntPtr monitorRectangle,
    IntPtr data);

  [StructLayout(LayoutKind.Sequential)]
  private struct Rectangle
  {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct MonitorInfoEx
  {
    public int Size;
    public Rectangle Monitor;
    public Rectangle WorkArea;
    public uint Flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
    public string DeviceName;
  }

  [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode, Size = 220)]
  private struct DeviceMode
  {
    [FieldOffset(68)]
    public ushort Size;
    [FieldOffset(84)]
    public uint DisplayOrientation;
    [FieldOffset(168)]
    public uint BitsPerPixel;
    [FieldOffset(172)]
    public uint PixelsWidth;
    [FieldOffset(176)]
    public uint PixelsHeight;
    [FieldOffset(184)]
    public uint DisplayFrequency;
  }
}

internal sealed class DisplayInventoryReadCapabilityAdapter(
  IWindowsDisplayInventory displays) : IHostCapabilityAdapter
{
  private const string ResultSchema =
    """
    {
      "type": "object",
      "properties": {
        "displays": {
          "type": "array",
          "maxItems": 16,
          "items": {
            "type": "object",
            "properties": {
              "displayId": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
              "primary": { "type": "boolean" },
              "x": { "type": "integer" },
              "y": { "type": "integer" },
              "width": { "type": "integer", "minimum": 1 },
              "height": { "type": "integer", "minimum": 1 },
              "bitsPerPixel": { "type": "integer", "minimum": 1 },
              "refreshHertz": { "type": "integer", "minimum": 0 },
              "orientation": { "enum": ["landscape", "portrait", "landscape-flipped", "portrait-flipped", "unknown"] }
            },
            "required": ["displayId", "primary", "x", "y", "width", "height", "bitsPerPixel", "refreshHertz", "orientation"],
            "additionalProperties": false
          }
        },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["displays", "stateSha256"],
      "additionalProperties": false
    }
    """;

  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "display.inventory.read",
    "Read display inventory",
    "Reads a bounded inventory of active display geometry and modes without changing session state.",
    CapabilityDataClass.Internal,
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    PowerAndSettingsSchemas.EmptyArguments,
    ResultSchema,
    ["windows-display-inventory"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    PowerAndSettingsSchemas.ValidateEmpty(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result)
  {
    if (!GovernedWindowsCapabilitySupport.Exact(result, "displays", "stateSha256")
      || result.GetProperty("displays").ValueKind != JsonValueKind.Array
      || result.GetProperty("displays").GetArrayLength() > 16
      || !result.GetProperty("displays").EnumerateArray().All(display =>
        GovernedWindowsCapabilitySupport.Exact(
          display,
          "displayId",
          "primary",
          "x",
          "y",
          "width",
          "height",
          "bitsPerPixel",
          "refreshHertz",
          "orientation")
        && GovernedWindowsCapabilitySupport.Sha256(display, "displayId")
        && GovernedWindowsCapabilitySupport.Boolean(display, "primary")
        && display.GetProperty("x").TryGetInt32(out _)
        && display.GetProperty("y").TryGetInt32(out _)
        && display.GetProperty("width").TryGetUInt32(out var width)
        && width > 0
        && display.GetProperty("height").TryGetUInt32(out var height)
        && height > 0
        && display.GetProperty("bitsPerPixel").TryGetUInt32(out var bits)
        && bits > 0
        && display.GetProperty("refreshHertz").TryGetUInt32(out _)
        && display.GetProperty("orientation").GetString() is
          "landscape" or "portrait" or "landscape-flipped" or "portrait-flipped" or "unknown")
      || !GovernedWindowsCapabilitySupport.Sha256(result, "stateSha256"))
    {
      return GovernedWindowsCapabilitySupport.InvalidResult("Display inventory result is invalid.");
    }
    return CapabilityArgumentValidation.Success;
  }

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var inventory = displays.Read();
    var stateSha256 = GovernedWindowsCapabilitySupport.StateSha256(inventory);
    var output = JsonSerializer.Serialize(new
    {
      displays = inventory.Select(display => new
      {
        displayId = display.DisplayId,
        primary = display.Primary,
        x = display.X,
        y = display.Y,
        width = display.Width,
        height = display.Height,
        bitsPerPixel = display.BitsPerPixel,
        refreshHertz = display.RefreshHertz,
        orientation = display.Orientation,
      }),
      stateSha256,
    });
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance:
      [
        GovernedWindowsCapabilitySupport.Provenance(
          "windows-display-inventory",
          Environment.MachineName,
          stateSha256),
      ],
      PreStateSha256: stateSha256,
      LocalBytesRead: GovernedWindowsCapabilitySupport.JsonByteCount(output)));
  }
}
