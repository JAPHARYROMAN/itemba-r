using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Win32;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal sealed record InstalledSoftwareRegistryEntry(
  string SubkeyName,
  string? DisplayName,
  string? DisplayVersion,
  string? Publisher);

internal sealed record InstalledSoftwareInventoryEntry(
  string DisplayName,
  string? DisplayVersion,
  string? Publisher,
  string? ProductCode);

internal interface IInstalledSoftwareInventory
{
  IReadOnlyList<InstalledSoftwareRegistryEntry> Read(
    CancellationToken cancellationToken);
}

/// <summary>
/// Narrow registry seam for the installed-software reader. The provider always
/// supplies <see cref="RegistryHive.LocalMachine"/> and the two machine views;
/// no current-user or user-SID hive is part of this contract.
/// </summary>
internal interface IMachineSoftwareRegistryBackend
{
  IReadOnlyList<string> GetSubKeyNames(
    RegistryHive hive,
    RegistryView view,
    string keyPath);

  string? ReadStringValue(
    RegistryHive hive,
    RegistryView view,
    string keyPath,
    string subkeyName,
    string valueName);
}

internal sealed class WindowsMachineSoftwareRegistryBackend :
  IMachineSoftwareRegistryBackend
{
  public IReadOnlyList<string> GetSubKeyNames(
    RegistryHive hive,
    RegistryView view,
    string keyPath)
  {
    using var baseKey = RegistryKey.OpenBaseKey(hive, view);
    using var uninstallKey = baseKey.OpenSubKey(keyPath, writable: false)
      ?? throw new HostPreconditionException(
        "software_inventory_uninstall_key_unavailable");
    return uninstallKey.GetSubKeyNames();
  }

  public string? ReadStringValue(
    RegistryHive hive,
    RegistryView view,
    string keyPath,
    string subkeyName,
    string valueName)
  {
    using var baseKey = RegistryKey.OpenBaseKey(hive, view);
    using var uninstallKey = baseKey.OpenSubKey(keyPath, writable: false)
      ?? throw new HostPreconditionException(
        "software_inventory_uninstall_key_unavailable");
    using var productKey = uninstallKey.OpenSubKey(subkeyName, writable: false)
      ?? throw new HostPreconditionException(
        "software_inventory_snapshot_changed");
    return productKey.GetValue(
      valueName,
      defaultValue: null,
      RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
  }
}

/// <summary>
/// Reads only DisplayName, DisplayVersion, and Publisher from machine-wide
/// uninstall keys. Product codes are derived from exact braced-GUID subkey
/// names; no raw registry path or other registry value is returned.
/// </summary>
internal sealed class WindowsInstalledSoftwareInventory : IInstalledSoftwareInventory
{
  internal const int MaximumObservedEntries = 16_384;
  internal const string UninstallKeyPath =
    @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
  private static readonly RegistryView[] MachineViews =
    [RegistryView.Registry64, RegistryView.Registry32];
  private readonly IMachineSoftwareRegistryBackend _registry;
  private readonly Func<bool> _isWindows;

  public WindowsInstalledSoftwareInventory()
    : this(
      new WindowsMachineSoftwareRegistryBackend(),
      static () => OperatingSystem.IsWindows())
  {
  }

  internal WindowsInstalledSoftwareInventory(
    IMachineSoftwareRegistryBackend registry,
    Func<bool>? isWindows = null)
  {
    _registry = registry ?? throw new ArgumentNullException(nameof(registry));
    _isWindows = isWindows ?? OperatingSystem.IsWindows;
  }

  public IReadOnlyList<InstalledSoftwareRegistryEntry> Read(
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    if (!_isWindows())
    {
      throw new HostPreconditionException(
        "software_inventory_windows_required");
    }

    try
    {
      var entries = new List<InstalledSoftwareRegistryEntry>();
      foreach (var view in MachineViews)
      {
        cancellationToken.ThrowIfCancellationRequested();
        var subkeyNames = _registry.GetSubKeyNames(
          RegistryHive.LocalMachine,
          view,
          UninstallKeyPath);
        if (subkeyNames is null)
        {
          throw new HostPreconditionException(
            "software_inventory_registry_response_invalid");
        }

        foreach (var subkeyName in subkeyNames)
        {
          cancellationToken.ThrowIfCancellationRequested();
          if (!InstalledSoftwareInventoryRules.IsSafeSubkeyName(subkeyName))
          {
            throw new HostPreconditionException(
              "software_inventory_registry_response_invalid");
          }
          if (entries.Count == MaximumObservedEntries)
          {
            throw new HostPreconditionException(
              "software_inventory_observation_limit_exceeded");
          }

          entries.Add(new InstalledSoftwareRegistryEntry(
            subkeyName,
            ReadAllowedValue(view, subkeyName, "DisplayName"),
            ReadAllowedValue(view, subkeyName, "DisplayVersion"),
            ReadAllowedValue(view, subkeyName, "Publisher")));
        }
      }
      cancellationToken.ThrowIfCancellationRequested();
      return entries;
    }
    catch (OperationCanceledException)
    {
      throw;
    }
    catch (HostPreconditionException)
    {
      throw;
    }
    catch
    {
      // Registry exception messages can contain local paths or account data.
      // Fail closed with a stable code and deliberately omit the inner error.
      throw new HostPreconditionException(
        "software_inventory_registry_unavailable");
    }
  }

  private string? ReadAllowedValue(RegistryView view, string subkeyName, string valueName) =>
    _registry.ReadStringValue(
      RegistryHive.LocalMachine,
      view,
      UninstallKeyPath,
      subkeyName,
      valueName);
}

internal static class InstalledSoftwareInventoryRules
{
  private const string FullSnapshotDomain =
    "MSAIDIZI-SOFTWARE-INSTALLED-INVENTORY-FULL-V1";
  private const string ReturnedEntriesDomain =
    "MSAIDIZI-SOFTWARE-INSTALLED-INVENTORY-RETURNED-V1";
  private const string DeviceIdentityDomain =
    "MSAIDIZI-SOFTWARE-INSTALLED-INVENTORY-DEVICE-V1";
  internal const int MaximumReturnedEntries = 2_048;
  internal const int MaximumDisplayNameLength = 512;
  internal const int MaximumDisplayVersionLength = 128;
  internal const int MaximumPublisherLength = 256;
  internal const int MaximumSubkeyNameLength = 255;

  public static IReadOnlyList<InstalledSoftwareInventoryEntry> Normalize(
    IReadOnlyList<InstalledSoftwareRegistryEntry>? entries)
  {
    ValidateRawObservation(entries);
    var validEntries = entries!;

    var normalized = new List<InstalledSoftwareInventoryEntry>(validEntries.Count);
    foreach (var entry in validEntries)
    {
      if (entry is null || !IsSafeSubkeyName(entry.SubkeyName))
      {
        throw InvalidSnapshot();
      }

      if (string.IsNullOrWhiteSpace(entry.DisplayName))
      {
        // Windows uninstall keys without DisplayName are system registration
        // details rather than publishable installed-product inventory rows.
        continue;
      }

      var displayName = NormalizeRequired(
        entry.DisplayName,
        MaximumDisplayNameLength);
      var displayVersion = NormalizeOptional(
        entry.DisplayVersion,
        MaximumDisplayVersionLength);
      var publisher = NormalizeOptional(
        entry.Publisher,
        MaximumPublisherLength);
      normalized.Add(new InstalledSoftwareInventoryEntry(
        displayName,
        displayVersion,
        publisher,
        ProductCode(entry.SubkeyName)));
    }

    return Canonicalize(normalized);
  }

  public static long RawObservationCanonicalByteCount(
    IReadOnlyList<InstalledSoftwareRegistryEntry>? entries)
  {
    ValidateRawObservation(entries);
    var validEntries = entries!;
    var fields = new List<string>(validEntries.Count * 4 + 2)
    {
      "1",
      validEntries.Count.ToString(CultureInfo.InvariantCulture),
    };
    foreach (var entry in validEntries
      .OrderBy(entry => entry.SubkeyName, StringComparer.Ordinal)
      .ThenBy(entry => entry.DisplayName ?? string.Empty, StringComparer.Ordinal)
      .ThenBy(entry => entry.DisplayVersion ?? string.Empty, StringComparer.Ordinal)
      .ThenBy(entry => entry.Publisher ?? string.Empty, StringComparer.Ordinal))
    {
      fields.Add(entry.SubkeyName);
      fields.Add(entry.DisplayName ?? "null");
      fields.Add(entry.DisplayVersion ?? "null");
      fields.Add(entry.Publisher ?? "null");
    }
    return Encoding.UTF8.GetByteCount(Canonical(
      "MSAIDIZI-SOFTWARE-INSTALLED-INVENTORY-RAW-OBSERVATION-V1",
      fields));
  }

  public static bool IsSafeSubkeyName(string? value) => value is
  { Length: >= 1 and <= MaximumSubkeyNameLength }
    && string.Equals(value, value.Trim(), StringComparison.Ordinal)
    && !value.Any(character => char.IsControl(character)
      || char.IsSurrogate(character)
      || character is '\0' or '\\' or '/');

  public static bool IsCanonicalEntry(InstalledSoftwareInventoryEntry entry)
  {
    if (!IsNormalized(entry.DisplayName, MaximumDisplayNameLength)
      || !IsOptionalNormalized(
        entry.DisplayVersion,
        MaximumDisplayVersionLength)
      || !IsOptionalNormalized(entry.Publisher, MaximumPublisherLength))
    {
      return false;
    }
    return entry.ProductCode is null
      || string.Equals(
        entry.ProductCode,
        ProductCode(entry.ProductCode),
        StringComparison.Ordinal);
  }

  public static bool IsCanonicalSequence(
    IReadOnlyList<InstalledSoftwareInventoryEntry> entries)
  {
    if (!entries.All(IsCanonicalEntry))
    {
      return false;
    }
    try
    {
      return entries.SequenceEqual(Canonicalize(entries));
    }
    catch (HostPreconditionException)
    {
      return false;
    }
  }

  public static string FullSnapshotSha256(
    IReadOnlyList<InstalledSoftwareInventoryEntry> entries) =>
    PayloadDigest.Sha256Hex(FullSnapshotCanonical(entries));

  public static long FullSnapshotCanonicalByteCount(
    IReadOnlyList<InstalledSoftwareInventoryEntry> entries) =>
    Encoding.UTF8.GetByteCount(FullSnapshotCanonical(entries));

  public static string ReturnedEntriesSha256(
    int requestedMaxEntries,
    int totalObserved,
    IReadOnlyList<InstalledSoftwareInventoryEntry> entries)
  {
    var omittedEntries = checked(totalObserved - entries.Count);
    var fields = new List<string>(entries.Count * 4 + 6)
    {
      "1",
      requestedMaxEntries.ToString(CultureInfo.InvariantCulture),
      totalObserved.ToString(CultureInfo.InvariantCulture),
      entries.Count.ToString(CultureInfo.InvariantCulture),
      omittedEntries.ToString(CultureInfo.InvariantCulture),
      omittedEntries > 0 ? "true" : "false",
    };
    AddEntries(fields, entries);
    return PayloadDigest.Sha256Hex(Canonical(ReturnedEntriesDomain, fields));
  }

  public static string DeviceSourceIdentifierSha256(string deviceId)
  {
    ArgumentException.ThrowIfNullOrWhiteSpace(deviceId);
    return PayloadDigest.Sha256Hex(Canonical(DeviceIdentityDomain, [deviceId]));
  }

  private static List<InstalledSoftwareInventoryEntry> Canonicalize(
    IEnumerable<InstalledSoftwareInventoryEntry> entries)
  {
    var ordered = entries
      .OrderBy(entry => entry.DisplayName, StringComparer.OrdinalIgnoreCase)
      .ThenBy(entry => entry.DisplayName, StringComparer.Ordinal)
      .ThenBy(entry => entry.DisplayVersion ?? string.Empty, StringComparer.OrdinalIgnoreCase)
      .ThenBy(entry => entry.DisplayVersion ?? string.Empty, StringComparer.Ordinal)
      .ThenBy(entry => entry.Publisher ?? string.Empty, StringComparer.OrdinalIgnoreCase)
      .ThenBy(entry => entry.Publisher ?? string.Empty, StringComparer.Ordinal)
      .ThenBy(entry => entry.ProductCode ?? string.Empty, StringComparer.Ordinal)
      .ToArray();
    foreach (var productGroup in ordered
      .Where(entry => entry.ProductCode is not null)
      .GroupBy(entry => entry.ProductCode!, StringComparer.Ordinal))
    {
      var first = productGroup.First();
      if (productGroup.Any(entry => !string.Equals(
          entry.DisplayName,
          first.DisplayName,
          StringComparison.Ordinal)
        || !string.Equals(
          entry.DisplayVersion,
          first.DisplayVersion,
          StringComparison.Ordinal)
        || !string.Equals(
          entry.Publisher,
          first.Publisher,
          StringComparison.Ordinal)))
      {
        throw InvalidSnapshot();
      }
    }

    var identities = new HashSet<InstalledSoftwareInventoryEntry>();
    var result = new List<InstalledSoftwareInventoryEntry>(ordered.Length);
    foreach (var entry in ordered)
    {
      if (identities.Add(entry))
      {
        result.Add(entry);
      }
    }
    return result;
  }

  private static string FullSnapshotCanonical(
    IReadOnlyList<InstalledSoftwareInventoryEntry> entries)
  {
    var fields = new List<string>(entries.Count * 4 + 2)
    {
      "1",
      entries.Count.ToString(CultureInfo.InvariantCulture),
    };
    AddEntries(fields, entries);
    return Canonical(FullSnapshotDomain, fields);
  }

  private static void AddEntries(
    List<string> fields,
    IEnumerable<InstalledSoftwareInventoryEntry> entries)
  {
    foreach (var entry in entries)
    {
      fields.Add(entry.DisplayName);
      fields.Add(entry.DisplayVersion ?? "null");
      fields.Add(entry.Publisher ?? "null");
      fields.Add(entry.ProductCode ?? "null");
    }
  }

  private static string Canonical(string domain, IEnumerable<string> fields) =>
    string.Join('\n', new[] { domain }.Concat(
      fields.Select(field => $"{Encoding.UTF8.GetByteCount(field)}:{field}")));

  private static string NormalizeRequired(string value, int maximumLength)
  {
    if (!TryNormalize(value, maximumLength, out var normalized))
    {
      throw InvalidSnapshot();
    }
    return normalized;
  }

  private static string? NormalizeOptional(string? value, int maximumLength)
  {
    if (string.IsNullOrWhiteSpace(value))
    {
      return null;
    }
    if (!TryNormalize(value, maximumLength, out var normalized))
    {
      throw InvalidSnapshot();
    }
    return normalized;
  }

  private static bool IsNormalized(string value, int maximumLength) =>
    TryNormalize(value, maximumLength, out var normalized)
    && string.Equals(value, normalized, StringComparison.Ordinal);

  private static bool IsOptionalNormalized(string? value, int maximumLength) =>
    value is null || IsNormalized(value, maximumLength);

  private static bool TryNormalize(
    string value,
    int maximumLength,
    out string normalized)
  {
    normalized = string.Empty;
    if (value.Length == 0
      || value.Any(character => char.IsControl(character)
        || char.IsSurrogate(character)))
    {
      return false;
    }

    var trimmed = value.Trim();
    if (trimmed.Length == 0)
    {
      return false;
    }
    var builder = new StringBuilder(trimmed.Length);
    var priorWasWhitespace = false;
    foreach (var character in trimmed)
    {
      if (char.IsWhiteSpace(character))
      {
        if (!priorWasWhitespace)
        {
          builder.Append(' ');
        }
        priorWasWhitespace = true;
      }
      else
      {
        builder.Append(character);
        priorWasWhitespace = false;
      }
    }

    normalized = builder.ToString().Normalize(NormalizationForm.FormC);
    return normalized.Length is >= 1 && normalized.Length <= maximumLength
      && !LooksLikeAbsolutePathOrUri(normalized);
  }

  private static void ValidateRawObservation(
    IReadOnlyList<InstalledSoftwareRegistryEntry>? entries)
  {
    if (entries is null
      || entries.Count > WindowsInstalledSoftwareInventory.MaximumObservedEntries
      || entries.Any(entry => entry is null
        || !IsSafeSubkeyName(entry.SubkeyName)
        || !IsBoundedRawMetadata(
          entry.DisplayName,
          MaximumDisplayNameLength,
          allowBlank: true)
        || !IsBoundedRawMetadata(
          entry.DisplayVersion,
          MaximumDisplayVersionLength,
          allowBlank: true)
        || !IsBoundedRawMetadata(
          entry.Publisher,
          MaximumPublisherLength,
          allowBlank: true)))
    {
      throw InvalidSnapshot();
    }
  }

  private static bool IsBoundedRawMetadata(
    string? value,
    int maximumLength,
    bool allowBlank)
  {
    if (value is null)
    {
      return true;
    }
    if (value.Length > maximumLength
      || value.Any(character => char.IsControl(character)
        || char.IsSurrogate(character)))
    {
      return false;
    }
    return allowBlank && string.IsNullOrWhiteSpace(value)
      || TryNormalize(value, maximumLength, out _);
  }

  private static bool LooksLikeAbsolutePathOrUri(string value)
  {
    if (value.StartsWith('\\')
      || value.StartsWith('/')
      || value.StartsWith("HKLM\\", StringComparison.OrdinalIgnoreCase)
      || value.StartsWith("HKCU\\", StringComparison.OrdinalIgnoreCase)
      || value.StartsWith("HKEY_LOCAL_MACHINE\\", StringComparison.OrdinalIgnoreCase)
      || value.StartsWith("HKEY_CURRENT_USER\\", StringComparison.OrdinalIgnoreCase)
      || value is { Length: >= 3 }
        && char.IsAsciiLetter(value[0])
        && value[1] == ':'
        && value[2] is '\\' or '/')
    {
      return true;
    }

    return Uri.TryCreate(value, UriKind.Absolute, out var uri)
      && (uri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
        || uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
        || uri.Scheme.Equals(Uri.UriSchemeFile, StringComparison.OrdinalIgnoreCase));
  }

  private static string? ProductCode(string value)
  {
    if (value.Length != 38
      || value[0] != '{'
      || value[^1] != '}'
      || !Guid.TryParseExact(value, "B", out var productCode))
    {
      return null;
    }
    return productCode.ToString("B", CultureInfo.InvariantCulture).ToUpperInvariant();
  }

  private static HostPreconditionException InvalidSnapshot() => new(
    "software_inventory_snapshot_invalid");
}

internal sealed class InstalledSoftwareInventoryReadCapabilityAdapter :
  IHostCapabilityAdapter
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
        "applications": {
          "type": "array",
          "maxItems": 2048,
          "items": {
            "type": "object",
            "properties": {
              "displayName": { "type": "string", "minLength": 1, "maxLength": 512 },
              "displayVersion": { "type": "string", "minLength": 1, "maxLength": 128 },
              "publisher": { "type": "string", "minLength": 1, "maxLength": 256 },
              "productCode": {
                "type": "string",
                "pattern": "^\\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\\}$"
              }
            },
            "required": ["displayName"],
            "additionalProperties": false
          }
        },
        "totalObserved": { "type": "integer", "minimum": 0, "maximum": 16384 },
        "returnedEntries": { "type": "integer", "minimum": 0, "maximum": 2048 },
        "omittedEntries": { "type": "integer", "minimum": 0, "maximum": 16384 },
        "requestedMaxEntries": { "type": "integer", "minimum": 1, "maximum": 2048 },
        "truncated": { "type": "boolean" },
        "inventorySha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "returnedEntriesSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["applications", "totalObserved", "returnedEntries", "omittedEntries", "requestedMaxEntries", "truncated", "inventorySha256", "returnedEntriesSha256"],
      "additionalProperties": false
    }
    """;

  private static readonly JsonSerializerOptions OutputJsonOptions = new()
  {
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
  };
  private static readonly HashSet<string> ApplicationProperties =
    new(StringComparer.Ordinal)
    {
      "displayName",
      "displayVersion",
      "publisher",
      "productCode",
    };
  private readonly IInstalledSoftwareInventory _inventory;
  private readonly int _maximumEntries;
  private readonly TimeProvider _timeProvider;

  public InstalledSoftwareInventoryReadCapabilityAdapter(
    IInstalledSoftwareInventory inventory,
    int maximumEntries,
    TimeProvider? timeProvider = null)
  {
    _inventory = inventory ?? throw new ArgumentNullException(nameof(inventory));
    if (maximumEntries is < 1 or > InstalledSoftwareInventoryRules.MaximumReturnedEntries)
    {
      throw new ArgumentOutOfRangeException(
        nameof(maximumEntries),
        $"Installed-software inventory maximum must be between 1 and {InstalledSoftwareInventoryRules.MaximumReturnedEntries}.");
    }
    _maximumEntries = maximumEntries;
    _timeProvider = timeProvider ?? TimeProvider.System;
  }

  public CapabilityDescriptor Descriptor { get; } = GovernedWindowsCapabilitySupport.Descriptor(
    "software.installed.inventory.read",
    "Read installed software inventory",
    "Reads bounded, read-only machine-wide installed-software metadata from allowlisted HKLM values; no recovery action applies.",
    CapabilityDataClass.Confidential,
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    ArgumentsSchema,
    ResultSchema,
    ["windows-machine-installed-software-inventory"]);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    GovernedWindowsCapabilitySupport.Exact(arguments, "maxEntries")
    && arguments.GetProperty("maxEntries").ValueKind == JsonValueKind.Number
    && GovernedWindowsCapabilitySupport.Integer(
      arguments,
      "maxEntries",
      1,
      _maximumEntries)
      ? CapabilityArgumentValidation.Success
      : GovernedWindowsCapabilitySupport.InvalidArguments(
        "Installed-software inventory arguments exceed the deployment-owned entry limit.");

  public CapabilityArgumentValidation ValidateResult(JsonElement result)
  {
    if (!GovernedWindowsCapabilitySupport.Exact(
        result,
        "applications",
        "totalObserved",
        "returnedEntries",
        "omittedEntries",
        "requestedMaxEntries",
        "truncated",
        "inventorySha256",
        "returnedEntriesSha256")
      || result.GetProperty("applications").ValueKind != JsonValueKind.Array
      || !TryBoundedInt(
        result,
        "totalObserved",
        0,
        WindowsInstalledSoftwareInventory.MaximumObservedEntries,
        out var totalObserved)
      || !TryBoundedInt(
        result,
        "returnedEntries",
        0,
        InstalledSoftwareInventoryRules.MaximumReturnedEntries,
        out var returnedEntries)
      || !TryBoundedInt(
        result,
        "omittedEntries",
        0,
        WindowsInstalledSoftwareInventory.MaximumObservedEntries,
        out var omittedEntries)
      || !TryBoundedInt(
        result,
        "requestedMaxEntries",
        1,
        _maximumEntries,
        out var requestedMaxEntries)
      || !GovernedWindowsCapabilitySupport.Boolean(result, "truncated")
      || !GovernedWindowsCapabilitySupport.Sha256(result, "inventorySha256")
      || !GovernedWindowsCapabilitySupport.Sha256(
        result,
        "returnedEntriesSha256"))
    {
      return InvalidResult();
    }

    var applications = new List<InstalledSoftwareInventoryEntry>();
    foreach (var application in result.GetProperty("applications").EnumerateArray())
    {
      if (!TryReadApplication(application, out var parsed))
      {
        return InvalidResult();
      }
      applications.Add(parsed);
    }

    if (applications.Count != returnedEntries
      || returnedEntries != Math.Min(totalObserved, requestedMaxEntries)
      || omittedEntries != totalObserved - returnedEntries
      || result.GetProperty("truncated").GetBoolean() != (omittedEntries > 0)
      || !InstalledSoftwareInventoryRules.IsCanonicalSequence(applications)
      || !PayloadDigest.FixedTimeEqualsHex(
        result.GetProperty("returnedEntriesSha256").GetString()!,
        InstalledSoftwareInventoryRules.ReturnedEntriesSha256(
          requestedMaxEntries,
          totalObserved,
          applications)))
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
    var validation = ValidateArguments(arguments);
    if (!validation.IsValid)
    {
      throw new HostPreconditionException(
        validation.ErrorCode ?? "arguments_schema_invalid");
    }

    IReadOnlyList<InstalledSoftwareRegistryEntry> rawObservation;
    IReadOnlyList<InstalledSoftwareInventoryEntry> normalized;
    long localBytesRead;
    try
    {
      rawObservation = _inventory.Read(cancellationToken);
      localBytesRead = InstalledSoftwareInventoryRules
        .RawObservationCanonicalByteCount(rawObservation);
      normalized = InstalledSoftwareInventoryRules.Normalize(rawObservation);
    }
    catch (OperationCanceledException)
    {
      throw;
    }
    catch (HostPreconditionException)
    {
      throw;
    }
    catch
    {
      throw new HostPreconditionException(
        "software_inventory_provider_failed");
    }
    cancellationToken.ThrowIfCancellationRequested();

    var requestedMaxEntries = arguments.GetProperty("maxEntries").GetInt32();
    var selected = normalized.Take(requestedMaxEntries).ToArray();
    var omittedEntries = normalized.Count - selected.Length;
    var inventorySha256 = InstalledSoftwareInventoryRules.FullSnapshotSha256(normalized);
    var returnedEntriesSha256 = InstalledSoftwareInventoryRules.ReturnedEntriesSha256(
      requestedMaxEntries,
      normalized.Count,
      selected);
    var output = JsonSerializer.Serialize(new
    {
      applications = selected,
      totalObserved = normalized.Count,
      returnedEntries = selected.Length,
      omittedEntries,
      requestedMaxEntries,
      truncated = omittedEntries > 0,
      inventorySha256,
      returnedEntriesSha256,
    }, OutputJsonOptions);
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance:
      [
        new DataProvenance(
          "windows-machine-installed-software-inventory",
          InstalledSoftwareInventoryRules.DeviceSourceIdentifierSha256(
            context.DeviceId),
          inventorySha256,
          // HKLM product metadata is administrator-controlled content. The
          // registry source is authenticated, but its strings are not trusted
          // as instructions.
          ProvenanceTrust.UntrustedContent,
          _timeProvider.GetUtcNow()),
      ],
      PreStateSha256: inventorySha256,
      LocalBytesRead: localBytesRead));
  }

  private static bool TryBoundedInt(
    JsonElement value,
    string property,
    int minimum,
    int maximum,
    out int parsed)
  {
    parsed = 0;
    return value.TryGetProperty(property, out var candidate)
      && candidate.ValueKind == JsonValueKind.Number
      && candidate.TryGetInt32(out parsed)
      && parsed >= minimum
      && parsed <= maximum;
  }

  private static bool TryReadApplication(
    JsonElement value,
    out InstalledSoftwareInventoryEntry application)
  {
    application = new InstalledSoftwareInventoryEntry(string.Empty, null, null, null);
    if (value.ValueKind != JsonValueKind.Object)
    {
      return false;
    }
    var properties = value.EnumerateObject().ToArray();
    if (properties.Length != properties
        .Select(property => property.Name)
        .Distinct(StringComparer.Ordinal)
        .Count()
      || properties.Any(property => !ApplicationProperties.Contains(property.Name))
      || !value.TryGetProperty("displayName", out var displayNameValue)
      || displayNameValue.ValueKind != JsonValueKind.String
      || displayNameValue.GetString() is not { } displayName
      || !TryOptionalString(value, "displayVersion", out var displayVersion)
      || !TryOptionalString(value, "publisher", out var publisher)
      || !TryOptionalString(value, "productCode", out var productCode))
    {
      return false;
    }

    application = new InstalledSoftwareInventoryEntry(
      displayName,
      displayVersion,
      publisher,
      productCode);
    return InstalledSoftwareInventoryRules.IsCanonicalEntry(application);
  }

  private static bool TryOptionalString(
    JsonElement value,
    string property,
    out string? parsed)
  {
    parsed = null;
    if (!value.TryGetProperty(property, out var candidate))
    {
      return true;
    }
    if (candidate.ValueKind != JsonValueKind.String)
    {
      return false;
    }
    parsed = candidate.GetString();
    return parsed is not null;
  }

  private static CapabilityArgumentValidation InvalidResult() =>
    GovernedWindowsCapabilitySupport.InvalidResult(
      "Installed-software inventory result did not match the bounded snapshot contract.");
}
