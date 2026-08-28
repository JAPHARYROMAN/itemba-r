using System.ComponentModel;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal sealed record SystemProcessSnapshot(
  uint ProcessId,
  uint? SessionId,
  string Name);

internal sealed record SystemProcessInventoryCommitment(
  string Sha256,
  long CanonicalBytes);

internal interface IWindowsSystemProcessInventory
{
  IReadOnlyList<SystemProcessSnapshot> Read(CancellationToken cancellationToken);
}

/// <summary>
/// Reads only the process snapshot fields explicitly exposed by this capability.
/// It never opens a process handle or requests command lines, environments,
/// memory, owners, windows, modules, or executable paths.
/// </summary>
internal sealed class WindowsSystemProcessInventory : IWindowsSystemProcessInventory
{
  internal const int MaximumObservedEntries = 16_384;
  private const uint SnapshotProcesses = 0x00000002;
  private const int ErrorNoMoreFiles = 18;
  private const int ErrorAccessDenied = 5;
  private const int ErrorInvalidParameter = 87;

  public IReadOnlyList<SystemProcessSnapshot> Read(CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    if (!OperatingSystem.IsWindows())
    {
      throw new HostPreconditionException("process_inventory_windows_required");
    }

    using var snapshot = CreateToolhelp32Snapshot(SnapshotProcesses, 0);
    if (snapshot.IsInvalid)
    {
      throw NativeFailure("process_inventory_snapshot_unavailable");
    }

    var entry = new ProcessEntry32
    {
      Size = checked((uint)Marshal.SizeOf<ProcessEntry32>()),
      ExecutableFile = string.Empty,
    };
    if (!Process32First(snapshot, ref entry))
    {
      var error = Marshal.GetLastWin32Error();
      if (error == ErrorNoMoreFiles)
      {
        return [];
      }
      throw NativeFailure("process_inventory_snapshot_unavailable", error);
    }

    var entries = new List<SystemProcessSnapshot>();
    do
    {
      cancellationToken.ThrowIfCancellationRequested();
      if (entries.Count == MaximumObservedEntries)
      {
        throw new HostPreconditionException("process_inventory_observation_limit_exceeded");
      }

      var name = entry.ExecutableFile ?? string.Empty;
      if (!SystemProcessInventoryRules.IsSafeName(name))
      {
        throw new HostPreconditionException("process_inventory_snapshot_invalid");
      }

      uint? sessionId;
      if (entry.ProcessId == 0)
      {
        sessionId = 0;
      }
      else if (ProcessIdToSessionId(entry.ProcessId, out var observedSessionId))
      {
        sessionId = observedSessionId;
      }
      else
      {
        var error = Marshal.GetLastWin32Error();
        if (error is not (ErrorAccessDenied or ErrorInvalidParameter))
        {
          throw NativeFailure("process_inventory_session_unavailable", error);
        }
        // The process exited after the kernel snapshot. Preserve its bounded
        // snapshot identity without inventing a session claim.
        sessionId = null;
      }

      entries.Add(new SystemProcessSnapshot(entry.ProcessId, sessionId, name));
      entry.Size = checked((uint)Marshal.SizeOf<ProcessEntry32>());
    }
    while (Process32Next(snapshot, ref entry));

    var terminalError = Marshal.GetLastWin32Error();
    if (terminalError != ErrorNoMoreFiles)
    {
      throw NativeFailure("process_inventory_snapshot_unavailable", terminalError);
    }
    return entries;
  }

  private static HostPreconditionException NativeFailure(
    string errorCode,
    int? nativeError = null) => new(
      $"{errorCode}_{nativeError ?? new Win32Exception().NativeErrorCode}");

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern SafeSnapshotHandle CreateToolhelp32Snapshot(
    uint flags,
    uint processId);

  [DllImport(
    "kernel32.dll",
    EntryPoint = "Process32FirstW",
    CharSet = CharSet.Unicode,
    SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool Process32First(
    SafeSnapshotHandle snapshot,
    ref ProcessEntry32 entry);

  [DllImport(
    "kernel32.dll",
    EntryPoint = "Process32NextW",
    CharSet = CharSet.Unicode,
    SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool Process32Next(
    SafeSnapshotHandle snapshot,
    ref ProcessEntry32 entry);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool ProcessIdToSessionId(
    uint processId,
    out uint sessionId);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool CloseHandle(IntPtr handle);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct ProcessEntry32
  {
    public uint Size;
    public uint Usage;
    public uint ProcessId;
    public UIntPtr DefaultHeapId;
    public uint ModuleId;
    public uint Threads;
    public uint ParentProcessId;
    public int BasePriority;
    public uint Flags;

    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
    public string ExecutableFile;
  }

  private sealed class SafeSnapshotHandle : SafeHandleZeroOrMinusOneIsInvalid
  {
    private SafeSnapshotHandle() : base(ownsHandle: true)
    {
    }

    protected override bool ReleaseHandle() => CloseHandle(handle);
  }
}

internal static class SystemProcessInventoryRules
{
  private static readonly string[] FullSnapshotDomain =
    ["MSAIDIZI-PROCESS-SYSTEM-INVENTORY-FULL-V1"];
  private static readonly string[] ReturnedEntriesDomain =
    ["MSAIDIZI-PROCESS-SYSTEM-INVENTORY-RETURNED-V1"];
  internal const int MaximumReturnedEntries = 2_048;
  internal const int MaximumNameLength = 260;

  public static bool IsSafeName(string? value) => value is
      { Length: >= 1 and <= MaximumNameLength }
    && string.Equals(value, value.Trim(), StringComparison.Ordinal)
    && value is not "." and not ".."
    && !value.Any(character => char.IsControl(character)
      || char.IsSurrogate(character)
      || character is '\\' or '/' or ':');

  public static IReadOnlyList<SystemProcessSnapshot> Normalize(
    IReadOnlyList<SystemProcessSnapshot>? entries)
  {
    if (entries is null
      || entries.Count > WindowsSystemProcessInventory.MaximumObservedEntries
      || entries.Any(entry => entry is null || !IsSafeName(entry.Name))
      || entries.Select(entry => entry.ProcessId).Distinct().Count() != entries.Count)
    {
      throw new HostPreconditionException("process_inventory_snapshot_invalid");
    }

    return entries
      .OrderBy(entry => entry.ProcessId)
      .ThenBy(entry => entry.SessionId ?? uint.MaxValue)
      .ThenBy(entry => entry.Name, StringComparer.Ordinal)
      .ToArray();
  }

  public static SystemProcessInventoryCommitment FullSnapshotCommitment(
    IReadOnlyList<SystemProcessSnapshot> entries)
  {
    var fields = new List<string>(entries.Count * 3 + 2)
    {
      "1",
      entries.Count.ToString(CultureInfo.InvariantCulture),
    };
    AddEntries(fields, entries);
    return Digest(FullSnapshotDomain, fields);
  }

  public static string ReturnedEntriesSha256(
    int requestedMaxEntries,
    int totalObserved,
    IReadOnlyList<SystemProcessSnapshot> entries)
  {
    var omittedEntries = checked(totalObserved - entries.Count);
    var fields = new List<string>(entries.Count * 3 + 6)
    {
      "1",
      requestedMaxEntries.ToString(CultureInfo.InvariantCulture),
      totalObserved.ToString(CultureInfo.InvariantCulture),
      entries.Count.ToString(CultureInfo.InvariantCulture),
      omittedEntries.ToString(CultureInfo.InvariantCulture),
      omittedEntries > 0 ? "true" : "false",
    };
    AddEntries(fields, entries);
    return Digest(ReturnedEntriesDomain, fields).Sha256;
  }

  private static void AddEntries(
    List<string> fields,
    IEnumerable<SystemProcessSnapshot> entries)
  {
    foreach (var entry in entries)
    {
      fields.Add(entry.ProcessId.ToString(CultureInfo.InvariantCulture));
      fields.Add(entry.SessionId?.ToString(CultureInfo.InvariantCulture) ?? "null");
      fields.Add(entry.Name);
    }
  }

  private static SystemProcessInventoryCommitment Digest(
    IEnumerable<string> domain,
    IEnumerable<string> fields)
  {
    var canonical = string.Join('\n', domain
      .Concat(fields.Select(field => $"{Encoding.UTF8.GetByteCount(field)}:{field}")));
    return new SystemProcessInventoryCommitment(
      PayloadDigest.Sha256Hex(canonical),
      checked((long)Encoding.UTF8.GetByteCount(canonical)));
  }
}

internal sealed class ProcessSystemInventoryReadCapabilityAdapter : IHostCapabilityAdapter
{
  private const string ArgumentsSchema =
    """
    {
      "type": "object",
      "properties": {
        "maxEntries": { "type": "integer", "minimum": 1, "maximum": 2048 }
      },
      "required": ["maxEntries"],
      "additionalProperties": false
    }
    """;

  private const string ResultSchema =
    """
    {
      "type": "object",
      "properties": {
        "processes": {
          "type": "array",
          "maxItems": 2048,
          "items": {
            "type": "object",
            "properties": {
              "processId": { "type": "integer", "minimum": 0, "maximum": 4294967295 },
              "sessionId": { "type": ["integer", "null"], "minimum": 0, "maximum": 4294967295 },
              "name": {
                "type": "string",
                "minLength": 1,
                "maxLength": 260,
                "pattern": "^[^\\\\/:\\u0000-\\u001f\\u007f]+$"
              }
            },
            "required": ["processId", "sessionId", "name"],
            "additionalProperties": false
          }
        },
        "totalObserved": { "type": "integer", "minimum": 0, "maximum": 16384 },
        "returnedEntries": { "type": "integer", "minimum": 0, "maximum": 2048 },
        "omittedEntries": { "type": "integer", "minimum": 0, "maximum": 16384 },
        "requestedMaxEntries": { "type": "integer", "minimum": 1, "maximum": 2048 },
        "truncated": { "type": "boolean" },
        "snapshotSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "returnedEntriesSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["processes", "totalObserved", "returnedEntries", "omittedEntries", "requestedMaxEntries", "truncated", "snapshotSha256", "returnedEntriesSha256"],
      "additionalProperties": false
    }
    """;

  private readonly IWindowsSystemProcessInventory _inventory;
  private readonly int _maximumEntries;
  private readonly TimeProvider _timeProvider;

  public ProcessSystemInventoryReadCapabilityAdapter(
    IWindowsSystemProcessInventory inventory,
    IOptions<HostCapabilityOptions> options,
    TimeProvider? timeProvider = null)
  {
    _inventory = inventory ?? throw new ArgumentNullException(nameof(inventory));
    ArgumentNullException.ThrowIfNull(options);
    _maximumEntries = options.Value.MaximumProcessInventoryEntries;
    if (_maximumEntries is < 1 or > SystemProcessInventoryRules.MaximumReturnedEntries)
    {
      throw new ArgumentOutOfRangeException(
        nameof(options),
        $"MaximumProcessInventoryEntries must be between 1 and {SystemProcessInventoryRules.MaximumReturnedEntries}.");
    }
    _timeProvider = timeProvider ?? TimeProvider.System;
  }

  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "process.system.inventory.read",
    "Read system process inventory",
    "Reads a bounded LocalSystem process snapshot containing only PID, session ID, and process name.",
    CapabilityDataClass.Confidential,
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    ArgumentsSchema,
    ResultSchema,
    ["windows-system-process-snapshot"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    GovernedWindowsCapabilitySupport.Exact(arguments, "maxEntries")
    && arguments.GetProperty("maxEntries").ValueKind == JsonValueKind.Number
    && GovernedWindowsCapabilitySupport.Integer(arguments, "maxEntries", 1, _maximumEntries)
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidArguments(
        "Process inventory arguments exceed the deployment-owned entry limit.");

  public CapabilityArgumentValidation ValidateResult(JsonElement result)
  {
    if (!GovernedWindowsCapabilitySupport.Exact(
        result,
        "processes",
        "totalObserved",
        "returnedEntries",
        "omittedEntries",
        "requestedMaxEntries",
        "truncated",
        "snapshotSha256",
        "returnedEntriesSha256")
      || result.GetProperty("processes").ValueKind != JsonValueKind.Array
      || result.GetProperty("totalObserved").ValueKind != JsonValueKind.Number
      || !result.GetProperty("totalObserved").TryGetInt32(out var totalObserved)
      || totalObserved is < 0 or > WindowsSystemProcessInventory.MaximumObservedEntries
      || result.GetProperty("returnedEntries").ValueKind != JsonValueKind.Number
      || !result.GetProperty("returnedEntries").TryGetInt32(out var returnedEntries)
      || returnedEntries is < 0 or > SystemProcessInventoryRules.MaximumReturnedEntries
      || result.GetProperty("omittedEntries").ValueKind != JsonValueKind.Number
      || !result.GetProperty("omittedEntries").TryGetInt32(out var omittedEntries)
      || omittedEntries is < 0 or > WindowsSystemProcessInventory.MaximumObservedEntries
      || result.GetProperty("requestedMaxEntries").ValueKind != JsonValueKind.Number
      || !result.GetProperty("requestedMaxEntries").TryGetInt32(out var requestedMaxEntries)
      || requestedMaxEntries is < 1 or > SystemProcessInventoryRules.MaximumReturnedEntries
      || requestedMaxEntries > _maximumEntries
      || !GovernedWindowsCapabilitySupport.Boolean(result, "truncated")
      || !GovernedWindowsCapabilitySupport.Sha256(result, "snapshotSha256")
      || !GovernedWindowsCapabilitySupport.Sha256(result, "returnedEntriesSha256"))
    {
      return InvalidResult();
    }

    var processes = new List<SystemProcessSnapshot>();
    foreach (var process in result.GetProperty("processes").EnumerateArray())
    {
      if (!GovernedWindowsCapabilitySupport.Exact(process, "processId", "sessionId", "name")
        || process.GetProperty("processId").ValueKind != JsonValueKind.Number
        || !process.GetProperty("processId").TryGetUInt32(out var processId)
        || !TryGetSessionId(process.GetProperty("sessionId"), out var sessionId)
        || process.GetProperty("name").ValueKind != JsonValueKind.String
        || process.GetProperty("name").GetString() is not { } name
        || !SystemProcessInventoryRules.IsSafeName(name))
      {
        return InvalidResult();
      }
      processes.Add(new SystemProcessSnapshot(processId, sessionId, name));
    }

    if (processes.Count != returnedEntries
      || returnedEntries != Math.Min(totalObserved, requestedMaxEntries)
      || omittedEntries != totalObserved - returnedEntries
      || result.GetProperty("truncated").GetBoolean() != (omittedEntries > 0)
      || processes.Select(process => process.ProcessId).Distinct().Count() != processes.Count)
    {
      return InvalidResult();
    }
    var sorted = processes
      .OrderBy(process => process.ProcessId)
      .ThenBy(process => process.SessionId ?? uint.MaxValue)
      .ThenBy(process => process.Name, StringComparer.Ordinal)
      .ToArray();
    if (!processes.SequenceEqual(sorted)
      || !PayloadDigest.FixedTimeEqualsHex(
        result.GetProperty("returnedEntriesSha256").GetString()!,
        SystemProcessInventoryRules.ReturnedEntriesSha256(
          requestedMaxEntries,
          totalObserved,
          processes)))
    {
      return InvalidResult();
    }
    return CapabilityArgumentValidation.Success;
  }

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(context);
    cancellationToken.ThrowIfCancellationRequested();
    var argumentValidation = ValidateArguments(arguments);
    if (!argumentValidation.IsValid)
    {
      throw new HostPreconditionException(
        argumentValidation.ErrorCode ?? "arguments_schema_invalid");
    }

    var requestedMaxEntries = arguments.GetProperty("maxEntries").GetInt32();
    var normalized = SystemProcessInventoryRules.Normalize(
      _inventory.Read(cancellationToken));
    cancellationToken.ThrowIfCancellationRequested();
    var selected = normalized.Take(requestedMaxEntries).ToArray();
    var omittedEntries = normalized.Count - selected.Length;
    var fullSnapshot = SystemProcessInventoryRules.FullSnapshotCommitment(normalized);
    var snapshotSha256 = fullSnapshot.Sha256;
    var returnedEntriesSha256 = SystemProcessInventoryRules.ReturnedEntriesSha256(
      requestedMaxEntries,
      normalized.Count,
      selected);
    var output = JsonSerializer.Serialize(new
    {
      processes = selected.Select(process => new
      {
        processId = process.ProcessId,
        sessionId = process.SessionId,
        name = process.Name,
      }),
      totalObserved = normalized.Count,
      returnedEntries = selected.Length,
      omittedEntries,
      requestedMaxEntries,
      truncated = omittedEntries > 0,
      snapshotSha256,
      returnedEntriesSha256,
    });
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance:
      [
        new DataProvenance(
          "windows-system-process-snapshot",
          PayloadDigest.Sha256Hex($"msaidizi-device:v1:{context.DeviceId}"),
          snapshotSha256,
          // Executable basenames are administrator-controlled strings. The
          // kernel authenticates the observation, not instruction authority.
          ProvenanceTrust.UntrustedContent,
          _timeProvider.GetUtcNow()),
      ],
      PreStateSha256: snapshotSha256,
      LocalBytesRead: fullSnapshot.CanonicalBytes));
  }

  private static bool TryGetSessionId(JsonElement value, out uint? sessionId)
  {
    if (value.ValueKind == JsonValueKind.Null)
    {
      sessionId = null;
      return true;
    }
    if (value.ValueKind == JsonValueKind.Number && value.TryGetUInt32(out var parsed))
    {
      sessionId = parsed;
      return true;
    }
    sessionId = null;
    return false;
  }

  private static CapabilityArgumentValidation InvalidResult() =>
    GovernedWindowsCapabilitySupport.InvalidResult(
      "Process inventory result did not match the bounded snapshot contract.");
}
