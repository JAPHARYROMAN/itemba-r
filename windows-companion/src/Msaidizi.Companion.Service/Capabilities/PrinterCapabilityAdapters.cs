using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Execution;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal static class PrinterCapabilitySchemas
{
  public const string DiscoveryArguments =
    """
    {
      "type": "object",
      "properties": {
        "maxResults": { "type": "integer", "minimum": 1, "maximum": 256 }
      },
      "required": ["maxResults"],
      "additionalProperties": false
    }
    """;

  public const string QueueArguments =
    """
    {
      "type": "object",
      "properties": {
        "printerId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" }
      },
      "required": ["printerId"],
      "additionalProperties": false
    }
    """;

  public const string QueueSetArguments =
    """
    {
      "type": "object",
      "properties": {
        "printerId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "paused": { "type": "boolean" }
      },
      "required": ["printerId", "paused"],
      "additionalProperties": false
    }
    """;

  public const string QueueResult =
    """
    {
      "type": "object",
      "properties": {
        "printerId": { "type": "string" },
        "paused": { "type": "boolean" },
        "queuedJobs": { "type": "integer", "minimum": 0 },
        "statusFlags": { "type": "integer", "minimum": 0 },
        "pauseStateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["printerId", "paused", "queuedJobs", "statusFlags", "pauseStateSha256", "stateSha256"],
      "additionalProperties": false
    }
    """;

  public const string DiscoveryResult =
    """
    {
      "type": "object",
      "properties": {
        "printers": {
          "type": "array",
          "maxItems": 256,
          "items": {
            "type": "object",
            "properties": {
              "printerId": { "type": "string" },
              "paused": { "type": "boolean" },
              "queuedJobs": { "type": "integer", "minimum": 0 },
              "statusFlags": { "type": "integer", "minimum": 0 },
              "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
            },
            "required": ["printerId", "paused", "queuedJobs", "statusFlags", "stateSha256"],
            "additionalProperties": false
          }
        },
        "truncated": { "type": "boolean" },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["printers", "truncated", "stateSha256"],
      "additionalProperties": false
    }
    """;

  public const string MutationResult =
    """
    {
      "type": "object",
      "properties": {
        "committed": { "const": true },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["committed", "stateSha256"],
      "additionalProperties": false
    }
    """;

  public static CapabilityArgumentValidation ValidateDiscoveryArguments(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(value, "maxResults")
    && GovernedWindowsCapabilitySupport.Integer(value, "maxResults", 1, 256)
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidArguments("Printer discovery bound is invalid.");

  public static CapabilityArgumentValidation ValidateQueueArguments(
    JsonElement value,
    bool mutation)
  {
    var exact = mutation
      ? GovernedWindowsCapabilitySupport.Exact(value, "printerId", "paused")
      : GovernedWindowsCapabilitySupport.Exact(value, "printerId");
    return exact
      && GovernedWindowsCapabilitySupport.String(value, "printerId", 1, 80)
      && GovernedWindowsCapabilitySupport.IsSafeId(value.GetProperty("printerId").GetString()!)
      && (!mutation || GovernedWindowsCapabilitySupport.Boolean(value, "paused"))
        ? CapabilityArgumentValidation.Success
        : GovernedWindowsCapabilitySupport.InvalidArguments("Printer queue target is invalid.");
  }

  public static CapabilityArgumentValidation ValidateQueueResult(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(
      value,
      "printerId",
      "paused",
      "queuedJobs",
      "statusFlags",
      "pauseStateSha256",
      "stateSha256")
    && ValidateQueueFields(value)
    && GovernedWindowsCapabilitySupport.Sha256(value, "pauseStateSha256")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidResult("Printer queue result is invalid.");

  public static CapabilityArgumentValidation ValidateDiscoveryResult(JsonElement value)
  {
    if (!GovernedWindowsCapabilitySupport.Exact(
        value,
        "printers",
        "truncated",
        "stateSha256")
      || value.GetProperty("printers").ValueKind != JsonValueKind.Array
      || value.GetProperty("printers").GetArrayLength() > 256
      || !value.GetProperty("printers").EnumerateArray().All(printer =>
        GovernedWindowsCapabilitySupport.Exact(
          printer,
          "printerId",
          "paused",
          "queuedJobs",
          "statusFlags",
          "stateSha256")
        && ValidateQueueFields(printer))
      || !GovernedWindowsCapabilitySupport.Boolean(value, "truncated")
      || !GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256"))
    {
      return GovernedWindowsCapabilitySupport.InvalidResult("Printer discovery result is invalid.");
    }
    return CapabilityArgumentValidation.Success;
  }

  public static CapabilityArgumentValidation ValidateMutationResult(JsonElement value) =>
    GovernedWindowsCapabilitySupport.Exact(value, "committed", "stateSha256")
    && value.GetProperty("committed").ValueKind == JsonValueKind.True
    && GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256")
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidResult("Printer mutation result is invalid.");

  private static bool ValidateQueueFields(JsonElement value) =>
    GovernedWindowsCapabilitySupport.String(value, "printerId", 1, 80)
    && GovernedWindowsCapabilitySupport.Boolean(value, "paused")
    && value.TryGetProperty("queuedJobs", out var jobs)
    && jobs.TryGetUInt32(out _)
    && value.TryGetProperty("statusFlags", out var status)
    && status.TryGetUInt32(out _)
    && GovernedWindowsCapabilitySupport.Sha256(value, "stateSha256");
}

internal sealed record ResolvedPrinter(
  string Id,
  string PrinterName,
  bool AllowReadQueue,
  bool AllowPauseResume);

internal sealed class PrinterPolicy
{
  private readonly Dictionary<string, ResolvedPrinter> _printers;
  public int MaximumDiscoveryResults { get; }

  public PrinterPolicy(IOptions<HostCapabilityOptions> options)
  {
    MaximumDiscoveryResults = Math.Clamp(
      options.Value.MaximumPrinterDiscoveryResults,
      1,
      256);
    _printers = options.Value.AllowedPrinters
      .Select(Parse)
      .ToDictionary(printer => printer.Id, StringComparer.Ordinal);
    if (_printers.Values.Select(printer => printer.PrinterName)
        .Distinct(StringComparer.OrdinalIgnoreCase).Count() != _printers.Count)
    {
      throw new InvalidOperationException("Printer allowlist contains duplicate queue names.");
    }
  }

  public IReadOnlyList<ResolvedPrinter> Discoverable => _printers.Values
    .Where(printer => printer.AllowReadQueue)
    .OrderBy(printer => printer.Id, StringComparer.Ordinal)
    .ToArray();

  public ResolvedPrinter Resolve(
    string id,
    bool requireRead = false,
    bool requirePauseResume = false)
  {
    if (!_printers.TryGetValue(id, out var printer)
      || (requireRead && !printer.AllowReadQueue)
      || (requirePauseResume && !printer.AllowPauseResume))
    {
      throw new HostPreconditionException("printer_not_allowed");
    }
    return printer;
  }

  public ResolvedPrinter ResolveRecovery(JsonElement recoveryRecord)
  {
    var id = RecoveryJson.RequiredString(recoveryRecord, "printerId", 80);
    var name = RecoveryJson.RequiredString(recoveryRecord, "printerName", 1_024);
    var printer = Resolve(id);
    return string.Equals(printer.PrinterName, name, StringComparison.OrdinalIgnoreCase)
      ? printer
      : throw new HostRecoveryException("recovery_record_format_invalid");
  }

  private static ResolvedPrinter Parse(AllowedPrinterOptions printer)
  {
    if (!GovernedWindowsCapabilitySupport.IsSafeId(printer.Id)
      || string.IsNullOrWhiteSpace(printer.PrinterName)
      || printer.PrinterName.Length > 1_024
      || !string.Equals(printer.PrinterName, printer.PrinterName.Trim(), StringComparison.Ordinal)
      || printer.PrinterName.Contains('\0'))
    {
      throw new InvalidOperationException("An allowed printer is invalid.");
    }
    return new ResolvedPrinter(
      printer.Id,
      printer.PrinterName,
      printer.AllowReadQueue,
      printer.AllowPauseResume);
  }
}

internal sealed record PrinterQueueSnapshot(bool Paused, uint QueuedJobs, uint StatusFlags)
{
  public string PauseStateSha256(string printerId) =>
    GovernedWindowsCapabilitySupport.StateSha256(new { printerId, paused = Paused });

  public string StateSha256(string printerId) =>
    GovernedWindowsCapabilitySupport.StateSha256(new
    {
      printerId,
      paused = Paused,
      queuedJobs = QueuedJobs,
      statusFlags = StatusFlags,
    });
}

internal interface IWindowsPrinterManager
{
  PrinterQueueSnapshot? TryInspect(string printerName);

  void SetPaused(string printerName, bool paused);
}

internal sealed class WindowsPrinterManager : IWindowsPrinterManager
{
  private const int ErrorInsufficientBuffer = 122;
  private const int ErrorInvalidPrinterName = 1801;
  private const int MaximumPrinterInfoBytes = 1_048_576;
  private const uint PrinterAccessAdminister = 0x4;
  private const uint PrinterAccessUse = 0x8;
  private const uint PrinterStatusPaused = 0x1;
  private const uint PrinterControlPause = 1;
  private const uint PrinterControlResume = 2;

  public PrinterQueueSnapshot? TryInspect(string printerName)
  {
    using var printer = Open(printerName, PrinterAccessUse, allowMissing: true);
    if (printer is null)
    {
      return null;
    }

    _ = GetPrinter(printer, 2, IntPtr.Zero, 0, out var required);
    var error = Marshal.GetLastWin32Error();
    if (required == 0 || required > MaximumPrinterInfoBytes || error != ErrorInsufficientBuffer)
    {
      throw NativeFailure("printer_queue_read_failed", error);
    }
    var buffer = Marshal.AllocHGlobal(checked((int)required));
    try
    {
      if (!GetPrinter(printer, 2, buffer, required, out _))
      {
        throw NativeFailure("printer_queue_read_failed", Marshal.GetLastWin32Error());
      }
      var info = Marshal.PtrToStructure<PrinterInfo2>(buffer);
      return new PrinterQueueSnapshot(
        Paused: (info.Status & PrinterStatusPaused) != 0,
        QueuedJobs: info.Jobs,
        StatusFlags: info.Status);
    }
    finally
    {
      Marshal.FreeHGlobal(buffer);
    }
  }

  public void SetPaused(string printerName, bool paused)
  {
    using var printer = Open(
      printerName,
      PrinterAccessUse | PrinterAccessAdminister,
      allowMissing: false)!;
    if (!SetPrinter(
      printer,
      0,
      IntPtr.Zero,
      paused ? PrinterControlPause : PrinterControlResume))
    {
      throw NativeFailure("printer_queue_update_failed", Marshal.GetLastWin32Error());
    }
  }

  private static SafePrinterHandle? Open(
    string printerName,
    uint desiredAccess,
    bool allowMissing)
  {
    var defaults = new PrinterDefaults { DesiredAccess = desiredAccess };
    if (OpenPrinter(printerName, out var printer, ref defaults))
    {
      return printer;
    }
    var error = Marshal.GetLastWin32Error();
    if (allowMissing && error == ErrorInvalidPrinterName)
    {
      printer?.Dispose();
      return null;
    }
    printer?.Dispose();
    throw NativeFailure("printer_queue_unavailable", error);
  }

  private static HostPreconditionException NativeFailure(string errorCode, int nativeCode) =>
    new($"{errorCode}_{new Win32Exception(nativeCode).NativeErrorCode}");

  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool OpenPrinter(
    string printerName,
    out SafePrinterHandle printer,
    ref PrinterDefaults defaults);

  [DllImport("winspool.drv", EntryPoint = "GetPrinterW", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetPrinter(
    SafePrinterHandle printer,
    uint level,
    IntPtr printerInfo,
    uint bufferSize,
    out uint requiredSize);

  [DllImport("winspool.drv", EntryPoint = "SetPrinterW", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SetPrinter(
    SafePrinterHandle printer,
    uint level,
    IntPtr printerInfo,
    uint command);

  [DllImport("winspool.drv", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool ClosePrinter(IntPtr printer);

  [StructLayout(LayoutKind.Sequential)]
  private struct PrinterDefaults
  {
    public IntPtr DataType;
    public IntPtr DeviceMode;
    public uint DesiredAccess;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct PrinterInfo2
  {
    public IntPtr ServerName;
    public IntPtr PrinterName;
    public IntPtr ShareName;
    public IntPtr PortName;
    public IntPtr DriverName;
    public IntPtr Comment;
    public IntPtr Location;
    public IntPtr DeviceMode;
    public IntPtr SeparatorFile;
    public IntPtr PrintProcessor;
    public IntPtr DataType;
    public IntPtr Parameters;
    public IntPtr SecurityDescriptor;
    public uint Attributes;
    public uint Priority;
    public uint DefaultPriority;
    public uint StartTime;
    public uint UntilTime;
    public uint Status;
    public uint Jobs;
    public uint AveragePagesPerMinute;
  }

  private sealed class SafePrinterHandle : SafeHandleZeroOrMinusOneIsInvalid
  {
    private SafePrinterHandle() : base(ownsHandle: true)
    {
    }

    protected override bool ReleaseHandle() => ClosePrinter(handle);
  }
}

internal sealed class PrinterDiscoveryCapabilityAdapter(
  PrinterPolicy policy,
  IWindowsPrinterManager printers) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "printer.discovery.list",
    "Discover approved printer queues",
    "Lists only installed printer queues already named by supervisor policy.",
    CapabilityDataClass.Confidential,
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    PrinterCapabilitySchemas.DiscoveryArguments,
    PrinterCapabilitySchemas.DiscoveryResult,
    ["windows-printer-inventory"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    PrinterCapabilitySchemas.ValidateDiscoveryArguments(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    PrinterCapabilitySchemas.ValidateDiscoveryResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var requested = Math.Min(
      arguments.GetProperty("maxResults").GetInt32(),
      policy.MaximumDiscoveryResults);
    var discovered = new List<object>();
    var candidates = policy.Discoverable;
    foreach (var printer in candidates)
    {
      cancellationToken.ThrowIfCancellationRequested();
      if (discovered.Count == requested)
      {
        break;
      }
      var state = printers.TryInspect(printer.PrinterName);
      if (state is null)
      {
        continue;
      }
      discovered.Add(new
      {
        printerId = printer.Id,
        paused = state.Paused,
        queuedJobs = state.QueuedJobs,
        statusFlags = state.StatusFlags,
        stateSha256 = state.StateSha256(printer.Id),
      });
    }
    var truncated = candidates.Count > requested;
    var inventoryStateSha256 = GovernedWindowsCapabilitySupport.StateSha256(new
    {
      printers = discovered,
      truncated,
    });
    var output = JsonSerializer.Serialize(new
    {
      printers = discovered,
      truncated,
      stateSha256 = inventoryStateSha256,
    });
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance:
      [
        GovernedWindowsCapabilitySupport.Provenance(
          "windows-printer-inventory",
          Environment.MachineName,
          inventoryStateSha256),
      ],
      PreStateSha256: inventoryStateSha256,
      LocalBytesRead: GovernedWindowsCapabilitySupport.JsonByteCount(output)));
  }
}

internal sealed class PrinterQueueStatusCapabilityAdapter(
  PrinterPolicy policy,
  IWindowsPrinterManager printers) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "printer.queue.status.read",
    "Read approved printer queue status",
    "Reads pause, job-count, and status flags for one approved printer queue.",
    CapabilityDataClass.Confidential,
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    PrinterCapabilitySchemas.QueueArguments,
    PrinterCapabilitySchemas.QueueResult,
    ["windows-printer-queue"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    PrinterCapabilitySchemas.ValidateQueueArguments(arguments, mutation: false);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    PrinterCapabilitySchemas.ValidateQueueResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var printer = policy.Resolve(
      arguments.GetProperty("printerId").GetString()!,
      requireRead: true);
    var state = printers.TryInspect(printer.PrinterName)
      ?? throw new HostPreconditionException("printer_queue_unavailable");
    var stateSha256 = state.StateSha256(printer.Id);
    var pauseStateSha256 = state.PauseStateSha256(printer.Id);
    var output = JsonSerializer.Serialize(new
    {
      printerId = printer.Id,
      paused = state.Paused,
      queuedJobs = state.QueuedJobs,
      statusFlags = state.StatusFlags,
      pauseStateSha256,
      stateSha256,
    });
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance:
      [
        Provenance(printer, stateSha256),
      ],
      PreStateSha256: pauseStateSha256,
      LocalBytesRead: GovernedWindowsCapabilitySupport.JsonByteCount(output)));
  }

  internal static DataProvenance Provenance(
    ResolvedPrinter printer,
    string stateSha256) => GovernedWindowsCapabilitySupport.Provenance(
      "windows-printer-queue",
      $"{printer.Id}\n{printer.PrinterName}",
      stateSha256);
}

internal sealed class PrinterQueuePausedSetCapabilityAdapter(
  PrinterPolicy policy,
  IWindowsPrinterManager printers,
  IHostRecoveryVault recoveryVault) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "printer.queue.paused.set",
    "Pause or resume approved printer queue",
    "Pauses or resumes one exact supervisor-approved printer queue without deleting jobs.",
    CapabilityDataClass.Confidential,
    CapabilityEffect.Administrative,
    RecoveryKind.Snapshot,
    PrinterCapabilitySchemas.QueueSetArguments,
    PrinterCapabilitySchemas.MutationResult,
    ["windows-printer-queue", "host-recovery-record"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    PrinterCapabilitySchemas.ValidateQueueArguments(arguments, mutation: true);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    PrinterCapabilitySchemas.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var printer = policy.Resolve(
      arguments.GetProperty("printerId").GetString()!,
      requirePauseResume: true);
    var before = printers.TryInspect(printer.PrinterName)
      ?? throw new HostPreconditionException("printer_queue_unavailable");
    var beforeSha256 = before.PauseStateSha256(printer.Id);
    RegistryValueSetCapabilityAdapter.MatchExpected(context, beforeSha256);
    var desired = arguments.GetProperty("paused").GetBoolean();
    if (before.Paused == desired)
    {
      throw new HostPreconditionException("printer_queue_already_desired");
    }
    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      beforeSha256,
      new
      {
        printerId = printer.Id,
        printer.PrinterName,
        paused = before.Paused,
      },
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    cancellationToken.ThrowIfCancellationRequested();
    printers.SetPaused(printer.PrinterName, desired);
    var after = printers.TryInspect(printer.PrinterName)
      ?? throw new HostPreconditionException("printer_queue_unavailable_after_update");
    if (after.Paused != desired)
    {
      throw new HostPreconditionException("printer_queue_postcondition_failed");
    }
    var afterSha256 = after.PauseStateSha256(printer.Id);
    var output = JsonSerializer.Serialize(new { committed = true, stateSha256 = afterSha256 });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: true,
      OutcomeUncertain: false,
      Provenance:
      [
        PrinterQueueStatusCapabilityAdapter.Provenance(printer, afterSha256),
        RegistryValueSetCapabilityAdapter.RecoveryProvenance(recovery),
      ],
      OpaqueRecoveryHandle: recovery.OpaqueHandle,
      PreStateSha256: beforeSha256,
      RecoveryProvenanceSha256: recovery.RecordSha256,
      LocalBytesRead: 64,
      LocalBytesWritten: 64);
  }
}
