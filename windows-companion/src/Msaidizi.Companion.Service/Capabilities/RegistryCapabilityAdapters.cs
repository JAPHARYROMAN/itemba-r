using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal static class RegistryCapabilitySchemas
{
  public const string CapabilityVersion = "3.0.0";
  public const string RecoveryRecordContract =
    "windows-registry-value-recovery/v2";

  public static readonly JsonElement TargetArguments = Parse(
    """
    {
      "type": "object",
      "properties": {
        "rootId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "relativeKey": { "type": "string", "maxLength": 1024 },
        "valueName": { "type": "string", "maxLength": 256 }
      },
      "required": ["rootId", "relativeKey", "valueName"],
      "additionalProperties": false
    }
    """);

  public static readonly JsonElement SetArguments = Parse(
    """
    {
      "type": "object",
      "properties": {
        "rootId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "relativeKey": { "type": "string", "maxLength": 1024 },
        "valueName": { "type": "string", "maxLength": 256 },
        "valueType": { "enum": ["String", "ExpandString", "DWord", "QWord", "Binary", "MultiString"] },
        "value": {}
      },
      "required": ["rootId", "relativeKey", "valueName", "valueType", "value"],
      "additionalProperties": false
    }
    """);

  public static readonly JsonElement ReadResult = Parse(
    """
    {
      "type": "object",
      "properties": {
        "exists": { "type": "boolean" },
        "valueType": { "type": ["string", "null"] },
        "value": {},
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["exists", "valueType", "value", "stateSha256"],
      "additionalProperties": false
    }
    """);

  public static readonly JsonElement MutationResult = Parse(
    """
    {
      "type": "object",
      "properties": {
        "committed": { "type": "boolean" },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["committed", "stateSha256"],
      "additionalProperties": false
    }
    """);

  public static CapabilityDescriptor Descriptor(
    string id,
    string name,
    string description,
    CapabilityEffect effect,
    RecoveryKind recovery,
    JsonElement arguments,
    JsonElement result) => new(
      id,
      CapabilityVersion,
      name,
      description,
      CapabilityDataClass.Confidential,
      effect,
      ConsentRequirement.SignedMandate,
      recovery,
      RequiredPrivilege.LocalSystem,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      arguments,
      result,
      recovery == RecoveryKind.NotApplicable
        ? ["windows-registry"]
        : ["windows-registry", "host-recovery-record"],
      TouchesTrustedRoot: false);

  public static CapabilityArgumentValidation ValidateTarget(JsonElement arguments)
  {
    if (!Exact(arguments, "rootId", "relativeKey", "valueName")
      || !String(arguments, "rootId", 1, 80)
      || !String(arguments, "relativeKey", 0, 1_024)
      || !String(arguments, "valueName", 0, 256))
    {
      return Invalid("Registry target arguments are invalid.");
    }

    return RegistryTargetPolicy.IsValidRelativeKey(
      arguments.GetProperty("relativeKey").GetString()!)
        ? CapabilityArgumentValidation.Success
        : Invalid("Registry relative key is invalid.");
  }

  public static CapabilityArgumentValidation ValidateSet(JsonElement arguments)
  {
    if (!Exact(arguments, "rootId", "relativeKey", "valueName", "valueType", "value"))
    {
      return Invalid("Registry set arguments contain unknown or missing fields.");
    }

    using var targetDocument = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      rootId = arguments.GetProperty("rootId").GetString(),
      relativeKey = arguments.GetProperty("relativeKey").GetString(),
      valueName = arguments.GetProperty("valueName").GetString(),
    }));
    if (!ValidateTarget(targetDocument.RootElement).IsValid)
    {
      return Invalid("Registry set target is invalid.");
    }

    var kind = arguments.GetProperty("valueType").GetString();
    var value = arguments.GetProperty("value");
    var valid = kind switch
    {
      "String" or "ExpandString" => value.ValueKind == JsonValueKind.String
        && value.GetString()!.Length <= 32_767,
      "DWord" => value.TryGetInt32(out _),
      "QWord" => value.TryGetInt64(out _),
      "Binary" => IsBoundedBase64(value, 1_048_576),
      "MultiString" => value.ValueKind == JsonValueKind.Array
        && value.GetArrayLength() <= 1_024
        && value.EnumerateArray().All(item => item.ValueKind == JsonValueKind.String
          && item.GetString()!.Length <= 32_767),
      _ => false,
    };
    return valid && RegistryStateSupport.IsDurableArgumentValueSafe(kind, value)
      ? CapabilityArgumentValidation.Success
      : Invalid("Registry value does not match its durable non-secret contract.");
  }

  public static CapabilityArgumentValidation ValidateReadResult(JsonElement result)
  {
    if (!Exact(result, "exists", "valueType", "value", "stateSha256")
      || result.GetProperty("exists").ValueKind is not (
        JsonValueKind.True or JsonValueKind.False)
      || result.GetProperty("stateSha256").ValueKind != JsonValueKind.String
      || result.GetProperty("stateSha256").GetString() is not { } digest
      || !PayloadDigest.IsSha256Hex(digest))
    {
      return InvalidResult("Registry read result is invalid.");
    }

    var exists = result.GetProperty("exists").GetBoolean();
    var valueType = result.GetProperty("valueType");
    var value = result.GetProperty("value");
    var safe = !exists
      ? valueType.ValueKind == JsonValueKind.Null
        && value.ValueKind == JsonValueKind.Null
      : valueType.ValueKind == JsonValueKind.String
        && RegistryStateSupport.IsDurableArgumentValueSafe(
          valueType.GetString(),
          value);
    return safe
      ? CapabilityArgumentValidation.Success
      : InvalidResult("Registry read result violates the durable-value boundary.");
  }

  public static CapabilityArgumentValidation ValidateMutationResult(JsonElement result) =>
    Exact(result, "committed", "stateSha256")
    && result.GetProperty("committed").ValueKind == JsonValueKind.True
    && result.GetProperty("stateSha256").GetString() is { } digest
    && PayloadDigest.IsSha256Hex(digest)
      ? CapabilityArgumentValidation.Success
      : InvalidResult("Registry mutation result is invalid.");

  private static bool Exact(JsonElement value, params string[] names) =>
    value.ValueKind == JsonValueKind.Object
    && value.EnumerateObject().Count() == names.Length
    && value.EnumerateObject().Select(property => property.Name)
      .ToHashSet(StringComparer.Ordinal).SetEquals(names);

  private static bool String(JsonElement value, string name, int minimum, int maximum) =>
    value.TryGetProperty(name, out var property)
    && property.ValueKind == JsonValueKind.String
    && property.GetString() is { } parsed
    && parsed.Length >= minimum
    && parsed.Length <= maximum;

  private static bool IsBoundedBase64(JsonElement value, int maximumBytes)
  {
    if (value.ValueKind != JsonValueKind.String)
    {
      return false;
    }

    try
    {
      return Convert.FromBase64String(value.GetString()!).Length <= maximumBytes;
    }
    catch (FormatException)
    {
      return false;
    }
  }

  private static CapabilityArgumentValidation Invalid(string message) =>
    CapabilityArgumentValidation.Invalid("arguments_schema_invalid", message);

  private static CapabilityArgumentValidation InvalidResult(string message) =>
    CapabilityArgumentValidation.Invalid("result_schema_invalid", message);

  private static JsonElement Parse(string json)
  {
    using var document = JsonDocument.Parse(json);
    return document.RootElement.Clone();
  }
}

internal sealed record ResolvedRegistryTarget(
  RegistryHive Hive,
  string RootId,
  string SubKey,
  string ValueName,
  bool AllowRead,
  bool AllowWrite,
  bool AllowDelete)
{
  public IReadOnlySet<RegistryValueKind>? DurableAllowedValueTypes { get; init; }
}

internal sealed record RegistryDurableValueTarget(
  string RootId,
  string RelativeKey,
  string ValueName,
  IReadOnlySet<RegistryValueKind> AllowedValueTypes);

internal sealed class RegistryTargetPolicy
{
  private static readonly string[] ProtectedSubKeys =
  [
    @"SOFTWARE\Itemba\Msaidizi",
    @"SYSTEM\Select",
    @"SYSTEM\CurrentControlSet\Services\Itemba Msaidizi Companion",
    @"SYSTEM\CurrentControlSet\Services\Itemba.Msaidizi.Companion",
    @"SYSTEM\CurrentControlSet\Services\Itemba Msaidizi Update Supervisor",
    @"SYSTEM\CurrentControlSet\Services\Itemba.Msaidizi.UpdateSupervisor",
    @"SYSTEM\CurrentControlSet\Services\Itemba Msaidizi Recovery Supervisor",
    @"SYSTEM\CurrentControlSet\Services\Itemba.Msaidizi.RecoverySupervisor",
  ];
  private readonly Dictionary<string, AllowedRegistryRootOptions> _roots;
  private readonly Dictionary<string, RegistryDurableValueTarget> _durableTargets;
  private readonly HashSet<string> _deleteTargets;

  public RegistryTargetPolicy(IOptions<HostCapabilityOptions> options)
  {
    ArgumentNullException.ThrowIfNull(options);
    _roots = options.Value.AllowedRegistryRoots.ToDictionary(
      root => ValidateRoot(root).Id,
      StringComparer.Ordinal);
    var durableTargets = options.Value.AllowedRegistryDurableValueTargets
      .Select(target => ValidateDurableTarget(target, _roots))
      .ToArray();
    if (durableTargets
      .GroupBy(
        target => DurableTargetKey(
          target.RootId,
          target.RelativeKey,
          target.ValueName),
        StringComparer.OrdinalIgnoreCase)
      .Any(group => group.Count() != 1)
      || durableTargets
        .GroupBy(
          target => PhysicalTargetKey(
            _roots[target.RootId],
            target.RelativeKey,
            target.ValueName),
          StringComparer.OrdinalIgnoreCase)
        .Any(group => group.Count() != 1)
      || _roots.Values.Any(root => (root.AllowRead || root.AllowWrite)
        && !durableTargets.Any(target => string.Equals(
          target.RootId,
          root.Id,
          StringComparison.Ordinal))))
    {
      throw InvalidDurableTargetConfiguration();
    }
    _durableTargets = durableTargets.ToDictionary(
      target => DurableTargetKey(
        target.RootId,
        target.RelativeKey,
      target.ValueName),
      StringComparer.OrdinalIgnoreCase);
    var deleteTargets = options.Value.AllowedRegistryDeleteTargets
      .Select(target => ValidateDeleteTarget(target, _roots))
      .ToArray();
    if (deleteTargets
      .GroupBy(
        target => DurableTargetKey(
          target.RootId,
          target.RelativeKey,
          target.ValueName),
        StringComparer.OrdinalIgnoreCase)
      .Any(group => group.Count() != 1)
      || deleteTargets
        .GroupBy(
          target => PhysicalTargetKey(
            _roots[target.RootId],
            target.RelativeKey,
            target.ValueName),
          StringComparer.OrdinalIgnoreCase)
        .Any(group => group.Count() != 1))
    {
      throw InvalidDeleteTargetConfiguration();
    }
    _deleteTargets = deleteTargets
      .Select(target => DurableTargetKey(
        target.RootId,
        target.RelativeKey,
        target.ValueName))
      .ToHashSet(StringComparer.OrdinalIgnoreCase);
  }

  public ResolvedRegistryTarget Resolve(
    JsonElement arguments,
    bool requireRead = false,
    bool requireWrite = false,
    bool requireDelete = false)
  {
    var id = arguments.GetProperty("rootId").GetString()!;
    if (!_roots.TryGetValue(id, out var root)
      || (requireRead && !root.AllowRead)
      || (requireWrite && !root.AllowWrite)
      || (requireDelete && !root.AllowDelete))
    {
      throw new HostPreconditionException("registry_root_not_allowed");
    }

    var relative = arguments.GetProperty("relativeKey").GetString()!;
    var valueName = arguments.GetProperty("valueName").GetString()!;
    if (!IsValidRelativeKey(relative))
    {
      throw new HostPreconditionException("registry_relative_key_invalid");
    }

    RegistryDurableValueTarget? durableTarget = null;
    if (requireRead || requireWrite)
    {
      if (!IsSafeDurableValueName(valueName)
        || !_durableTargets.TryGetValue(
          DurableTargetKey(root.Id, relative, valueName),
          out durableTarget))
      {
        throw new HostPreconditionException(
          "registry_durable_target_not_allowed");
      }
      if (requireWrite)
      {
        var valueType = arguments.TryGetProperty("valueType", out var configuredType)
          && configuredType.ValueKind == JsonValueKind.String
            ? RegistryValueType(configuredType.GetString())
            : null;
        if (valueType is null
          || !durableTarget.AllowedValueTypes.Contains(valueType.Value))
        {
          throw new HostPreconditionException(
            "registry_durable_value_type_not_allowed");
        }
      }
    }
    if (requireDelete && !IsSafeValueNameSyntax(valueName))
    {
      throw new HostPreconditionException("registry_delete_target_not_allowed");
    }
    if (requireDelete
      && IsCredentialLikeRegistryTarget(root, relative, valueName)
      && !_deleteTargets.Contains(DurableTargetKey(root.Id, relative, valueName)))
    {
      throw new HostPreconditionException(
        "registry_delete_target_not_allowed");
    }

    var subKey = string.IsNullOrEmpty(relative)
      ? root.SubKey
      : $"{root.SubKey}\\{relative}";
    return new ResolvedRegistryTarget(
      RegistryHive.LocalMachine,
      id,
      subKey,
      valueName,
      root.AllowRead,
      root.AllowWrite,
      root.AllowDelete)
    {
      DurableAllowedValueTypes = durableTarget?.AllowedValueTypes,
    };
  }

  public ResolvedRegistryTarget ResolveRecovery(JsonElement recoveryRecord)
  {
    var id = recoveryRecord.GetProperty("rootId").GetString()!;
    var subKey = recoveryRecord.GetProperty("subKey").GetString()!;
    var valueName = recoveryRecord.GetProperty("valueName").GetString()!;
    if (!_roots.TryGetValue(id, out var root)
      || valueName.Length > 256
      || !IsValidRelativeKey(subKey)
      || !(string.Equals(subKey, root.SubKey, StringComparison.OrdinalIgnoreCase)
        || subKey.StartsWith(root.SubKey + "\\", StringComparison.OrdinalIgnoreCase)))
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }
    return new ResolvedRegistryTarget(
      RegistryHive.LocalMachine,
      id,
      subKey,
      valueName,
      root.AllowRead,
      root.AllowWrite,
      root.AllowDelete);
  }

  public static bool IsValidRelativeKey(string value) => value.Length <= 1_024
    && !value.StartsWith('\\')
    && !value.EndsWith('\\')
    && !value.Contains(@"\\", StringComparison.Ordinal)
    && !value.Contains('/')
    && !value.Contains('\0')
    && value.Split('\\', StringSplitOptions.RemoveEmptyEntries)
      .All(segment => segment is not "." and not ".."
        && !segment.StartsWith(' ')
        && !segment.EndsWith(' ')
        && !segment.Any(character => char.IsControl(character)
          || char.IsSurrogate(character))
        && segment.Length <= 255);

  internal static bool IsSafeDurableValueName(string value) =>
    IsSafeValueNameSyntax(value)
    && !DurableNonSecretValuePolicy.IsCredentialLikeName(value);

  private static bool IsSafeValueNameSyntax(string value) => value.Length <= 256
    && (value.Length == 0
      || !char.IsWhiteSpace(value[0]) && !char.IsWhiteSpace(value[^1]))
    && !value.Any(character => char.IsControl(character)
      || char.IsSurrogate(character)
      || character is '\\' or '/');

  private static AllowedRegistryRootOptions ValidateRoot(AllowedRegistryRootOptions root)
  {
    var normalized = root.SubKey.Trim('\\');
    if (!IsSafeId(root.Id)
      || !string.Equals(root.Hive, "LocalMachine", StringComparison.Ordinal)
      || string.IsNullOrWhiteSpace(normalized)
      || !IsValidRelativeKey(normalized)
      || ProtectedSubKeys.Any(protectedKey => Overlaps(normalized, protectedKey))
      || ReachesTrustedServiceKey(normalized))
    {
      throw new InvalidOperationException("An allowed registry root is invalid or overlaps the trusted root.");
    }

    root.SubKey = normalized;
    return root;
  }

  private static RegistryDurableValueTarget ValidateDurableTarget(
    AllowedRegistryDurableValueTargetOptions target,
    Dictionary<string, AllowedRegistryRootOptions> roots)
  {
    if (!roots.TryGetValue(target.RootId, out var root)
      || !(root.AllowRead || root.AllowWrite)
      || !DurableNonSecretValuePolicy.IsClassified(target.Classification)
      || !IsValidRelativeKey(target.RelativeKey)
      || !IsSafeDurableValueName(target.ValueName)
      || root.SubKey.Split('\\').Any(
        DurableNonSecretValuePolicy.IsCredentialLikeName)
      || target.RelativeKey.Split(
          '\\',
          StringSplitOptions.RemoveEmptyEntries)
        .Any(DurableNonSecretValuePolicy.IsCredentialLikeName)
      || target.AllowedValueTypes.Count is < 1 or > 6)
    {
      throw InvalidDurableTargetConfiguration();
    }

    var allowedTypes = target.AllowedValueTypes
      .Select(RegistryValueType)
      .ToArray();
    if (allowedTypes.Any(value => value is null)
      || allowedTypes.Select(value => value!.Value).Distinct().Count()
        != allowedTypes.Length
      || allowedTypes.Any(value => value == RegistryValueKind.Binary))
    {
      throw InvalidDurableTargetConfiguration();
    }
    return new RegistryDurableValueTarget(
      target.RootId,
      target.RelativeKey,
      target.ValueName,
      allowedTypes.Select(value => value!.Value).ToHashSet());
  }

  private static RegistryDurableValueTarget ValidateDeleteTarget(
    AllowedRegistryDeleteTargetOptions target,
    Dictionary<string, AllowedRegistryRootOptions> roots)
  {
    if (!roots.TryGetValue(target.RootId, out var root)
      || !root.AllowDelete
      || !IsValidRelativeKey(target.RelativeKey)
      || !IsSafeValueNameSyntax(target.ValueName))
    {
      throw InvalidDeleteTargetConfiguration();
    }
    return new RegistryDurableValueTarget(
      target.RootId,
      target.RelativeKey,
      target.ValueName,
      new HashSet<RegistryValueKind>());
  }

  private static bool IsCredentialLikeRegistryTarget(
    AllowedRegistryRootOptions root,
    string relativeKey,
    string valueName) => root.SubKey.Split('\\')
      .Any(DurableNonSecretValuePolicy.IsCredentialLikeName)
    || relativeKey.Split('\\', StringSplitOptions.RemoveEmptyEntries)
      .Any(DurableNonSecretValuePolicy.IsCredentialLikeName)
    || DurableNonSecretValuePolicy.IsCredentialLikeName(valueName);

  private static RegistryValueKind? RegistryValueType(string? value) => value switch
  {
    "String" => RegistryValueKind.String,
    "ExpandString" => RegistryValueKind.ExpandString,
    "DWord" => RegistryValueKind.DWord,
    "QWord" => RegistryValueKind.QWord,
    "Binary" => RegistryValueKind.Binary,
    "MultiString" => RegistryValueKind.MultiString,
    _ => null,
  };

  private static string DurableTargetKey(
    string rootId,
    string relativeKey,
    string valueName) => string.Concat(
      rootId.Length.ToString(System.Globalization.CultureInfo.InvariantCulture),
      ":",
      rootId,
      relativeKey.Length.ToString(System.Globalization.CultureInfo.InvariantCulture),
      ":",
      relativeKey,
      valueName.Length.ToString(System.Globalization.CultureInfo.InvariantCulture),
      ":",
      valueName);

  private static string PhysicalTargetKey(
    AllowedRegistryRootOptions root,
    string relativeKey,
    string valueName)
  {
    var subKey = relativeKey.Length == 0
      ? root.SubKey
      : $"{root.SubKey}\\{relativeKey}";
    return string.Concat(
      subKey.Length.ToString(System.Globalization.CultureInfo.InvariantCulture),
      ":",
      subKey,
      valueName.Length.ToString(System.Globalization.CultureInfo.InvariantCulture),
      ":",
      valueName);
  }

  private static InvalidOperationException InvalidDurableTargetConfiguration() => new(
    "A registry durable-value target is missing, ambiguous, secret-like, or invalid.");

  private static InvalidOperationException InvalidDeleteTargetConfiguration() => new(
    "A registry delete-only target is missing, ambiguous, or invalid.");

  private static bool Overlaps(string left, string right) =>
    left.Equals(right, StringComparison.OrdinalIgnoreCase)
    || left.StartsWith($"{right}\\", StringComparison.OrdinalIgnoreCase)
    || right.StartsWith($"{left}\\", StringComparison.OrdinalIgnoreCase);

  private static bool ReachesTrustedServiceKey(string subKey)
  {
    var segments = subKey.Split('\\');
    if (segments.Length < 2
      || !segments[0].Equals("SYSTEM", StringComparison.OrdinalIgnoreCase)
      || !IsControlSet(segments[1]))
    {
      return false;
    }

    if (segments.Length == 2)
    {
      return true;
    }
    if (!segments[2].Equals("Services", StringComparison.OrdinalIgnoreCase))
    {
      return false;
    }
    return segments.Length == 3
      || WindowsServicePolicy.IsTrustedServiceName(segments[3]);
  }

  private static bool IsControlSet(string segment) =>
    segment.Equals("CurrentControlSet", StringComparison.OrdinalIgnoreCase)
    || (segment.Length == "ControlSet000".Length
      && segment.StartsWith("ControlSet", StringComparison.OrdinalIgnoreCase)
      && segment["ControlSet".Length..].All(char.IsAsciiDigit));

  private static bool IsSafeId(string value) => !string.IsNullOrWhiteSpace(value)
    && value.Length <= 80
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_');
}

internal sealed record RegistryState(
  bool KeyExists,
  bool Exists,
  string? ValueType,
  object? Value,
  string LegacyStateSha256,
  string StateSha256,
  long ByteCount);

internal static class RegistryStateSupport
{
  public static RegistryState Read(
    RegistryKey? key,
    string valueName,
    IReadOnlySet<RegistryValueKind>? durableAllowedValueTypes = null)
  {
    var keyExists = key is not null;
    if (key is null || !key.GetValueNames().Contains(valueName, StringComparer.OrdinalIgnoreCase))
    {
      var legacyAbsent = JsonSerializer.Serialize(new { exists = false });
      var absent = JsonSerializer.Serialize(new
      {
        contract = "windows-registry-value-state/v2",
        keyExists,
        exists = false,
      });
      return new RegistryState(
        keyExists,
        false,
        null,
        null,
        PayloadDigest.Sha256Hex(legacyAbsent),
        PayloadDigest.Sha256Hex(absent),
        Encoding.UTF8.GetByteCount(absent));
    }

    var kind = key.GetValueKind(valueName);
    if (durableAllowedValueTypes is not null
      && !durableAllowedValueTypes.Contains(kind))
    {
      throw new HostPreconditionException(
        "registry_durable_value_type_not_allowed");
    }
    var raw = key.GetValue(valueName, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
    var encoded = Encode(kind, raw);
    var legacyCanonical = JsonSerializer.Serialize(new
    {
      exists = true,
      valueType = kind.ToString(),
      value = encoded,
    });
    var canonical = JsonSerializer.Serialize(new
    {
      contract = "windows-registry-value-state/v2",
      keyExists = true,
      exists = true,
      valueType = kind.ToString(),
      value = encoded,
    });
    return new RegistryState(
      true,
      true,
      kind.ToString(),
      encoded,
      PayloadDigest.Sha256Hex(legacyCanonical),
      PayloadDigest.Sha256Hex(canonical),
      Encoding.UTF8.GetByteCount(canonical));
  }

  public static (RegistryValueKind Kind, object Value) Decode(JsonElement arguments)
  {
    return Decode(
      arguments.GetProperty("valueType").GetString()!,
      arguments.GetProperty("value"));
  }

  public static (RegistryValueKind Kind, object Value) Decode(
    string valueType,
    JsonElement value)
  {
    var kind = valueType switch
    {
      "String" => RegistryValueKind.String,
      "ExpandString" => RegistryValueKind.ExpandString,
      "DWord" => RegistryValueKind.DWord,
      "QWord" => RegistryValueKind.QWord,
      "Binary" => RegistryValueKind.Binary,
      "MultiString" => RegistryValueKind.MultiString,
      _ => throw new HostPreconditionException("registry_value_type_invalid"),
    };
    return (kind, kind switch
    {
      RegistryValueKind.String or RegistryValueKind.ExpandString => value.GetString()!,
      RegistryValueKind.DWord => value.GetInt32(),
      RegistryValueKind.QWord => value.GetInt64(),
      RegistryValueKind.Binary => Convert.FromBase64String(value.GetString()!),
      RegistryValueKind.MultiString => value.EnumerateArray()
        .Select(item => item.GetString()!).ToArray(),
      _ => throw new HostPreconditionException("registry_value_type_invalid"),
    });
  }

  public static bool IsDurableArgumentValueSafe(
    string? valueType,
    JsonElement value) => valueType switch
    {
      "String" or "ExpandString" => value.ValueKind == JsonValueKind.String
        && !DurableNonSecretValuePolicy.AppearsSecretBearingText(value.GetString()),
      "DWord" => value.TryGetInt32(out _),
      "QWord" => value.TryGetInt64(out _),
      "Binary" => TrySafeBinary(value),
      "MultiString" => value.ValueKind == JsonValueKind.Array
        && value.EnumerateArray().All(item => item.ValueKind == JsonValueKind.String
          && !DurableNonSecretValuePolicy.AppearsSecretBearingText(item.GetString())),
      _ => false,
    };

  public static bool IsDurableStateValueSafe(
    RegistryState state,
    IReadOnlySet<RegistryValueKind>? allowedValueTypes = null)
  {
    if (!state.Exists)
    {
      return true;
    }
    var observedType = state.ValueType switch
    {
      "String" => RegistryValueKind.String,
      "ExpandString" => RegistryValueKind.ExpandString,
      "DWord" => RegistryValueKind.DWord,
      "QWord" => RegistryValueKind.QWord,
      "Binary" => RegistryValueKind.Binary,
      "MultiString" => RegistryValueKind.MultiString,
      _ => (RegistryValueKind?)null,
    };
    if (observedType is null
      || allowedValueTypes is not null
        && !allowedValueTypes.Contains(observedType.Value))
    {
      return false;
    }
    return state.ValueType switch
    {
      "String" or "ExpandString" => state.Value is string text
        && !DurableNonSecretValuePolicy.AppearsSecretBearingText(text),
      "DWord" => state.Value is int,
      "QWord" => state.Value is long,
      "Binary" => state.Value is string encoded && TrySafeBinary(encoded),
      "MultiString" => state.Value is string[] values
        && values.All(value => !DurableNonSecretValuePolicy
          .AppearsSecretBearingText(value)),
      _ => false,
    };
  }

  private static bool TrySafeBinary(JsonElement value)
  {
    if (value.ValueKind != JsonValueKind.String)
    {
      return false;
    }
    try
    {
      return TrySafeBinary(value.GetString()!);
    }
    catch (FormatException)
    {
      return false;
    }
  }

  private static bool TrySafeBinary(string encoded)
  {
    try
    {
      return !DurableNonSecretValuePolicy.AppearsSecretBearingBytes(
        Convert.FromBase64String(encoded));
    }
    catch (FormatException)
    {
      return false;
    }
  }

  private static object? Encode(RegistryValueKind kind, object? value) => kind switch
  {
    RegistryValueKind.String or RegistryValueKind.ExpandString => value as string,
    RegistryValueKind.DWord => Convert.ToInt32(value,
      System.Globalization.CultureInfo.InvariantCulture),
    RegistryValueKind.QWord => Convert.ToInt64(value,
      System.Globalization.CultureInfo.InvariantCulture),
    RegistryValueKind.Binary => Convert.ToBase64String((byte[])value!),
    RegistryValueKind.MultiString => (string[])value!,
    _ => throw new HostPreconditionException("registry_value_type_unsupported"),
  };
}

internal sealed record RegistrySetMutation(
  RegistryState Before,
  RegistryState After,
  HostRecoveryReceipt Recovery);

/// <summary>
/// Keeps registry observation and recovery preparation ahead of the first
/// target mutation. RegCreateKeyExW's disposition is required when the key was
/// absent: RegistryKey.CreateSubKey cannot distinguish a newly-created key
/// from one concurrently created by another writer.
/// </summary>
internal static partial class RegistryValueMutationSupport
{
  private const uint RegistryOptionNonVolatile = 0;
  private const uint RegistryCreatedNewKey = 1;
  private const uint RegistryOpenedExistingKey = 2;
  private const int KeyQueryValue = 0x0001;
  private const int KeySetValue = 0x0002;
  private const int KeyEnumerateSubKeys = 0x0008;
  private const int KeyWow6464Key = 0x0100;

  public static async ValueTask<RegistrySetMutation> SetAsync(
    ActionExecutionContext context,
    string operation,
    ResolvedRegistryTarget target,
    JsonElement arguments,
    IHostRecoveryVault recoveryVault,
    CancellationToken cancellationToken)
  {
    // Decode before preparing recovery so malformed data cannot strand a
    // recovery checkpoint and, more importantly, can never fail after key
    // creation but before the value commit is attempted.
    var decoded = RegistryStateSupport.Decode(arguments);
    using var baseKey = RegistryKey.OpenBaseKey(target.Hive, RegistryView.Registry64);
    using var observedKey = baseKey.OpenSubKey(target.SubKey, writable: false);
    var before = RegistryStateSupport.Read(observedKey, target.ValueName);
    RegistryValueSetCapabilityAdapter.MatchExpected(context, before.StateSha256);
    var creationTarget = before.KeyExists
      ? null
      : OpenCreationParent(target);
    using var creationParent = creationTarget?.Parent;

    var recovery = await recoveryVault.PrepareAsync(
      context,
      operation,
      before.StateSha256,
      CreateRecoveryRecord(target, before),
      irreversible: false,
      cancellationToken).ConfigureAwait(false);

    cancellationToken.ThrowIfCancellationRequested();
    RegistryKey? writableKey = null;
    try
    {
      if (before.KeyExists)
      {
        writableKey = baseKey.OpenSubKey(target.SubKey, writable: true)
          ?? throw new HostPreconditionException("registry_key_changed_before_set");
        var guarded = RegistryStateSupport.Read(writableKey, target.ValueName);
        if (!guarded.KeyExists
          || !PayloadDigest.FixedTimeEqualsHex(
            guarded.StateSha256,
            before.StateSha256))
        {
          throw new HostPreconditionException("registry_value_changed_before_set");
        }
      }
      else
      {
        writableKey = CreateNewKey(
          creationParent
            ?? throw new InvalidOperationException(
              "registry_creation_parent_not_bound"),
          creationTarget!.ChildName);
        var guarded = RegistryStateSupport.Read(writableKey, target.ValueName);
        if (guarded.Exists
          || writableKey.GetValueNames().Length != 0
          || writableKey.GetSubKeyNames().Length != 0)
        {
          // The conditional create already committed. Treat any impossible or
          // concurrent population as an unknown write outcome so the durable
          // checkpoint remains the source of recovery truth.
          throw new InvalidOperationException(
            "registry_key_changed_after_conditional_create");
        }
      }

      writableKey.SetValue(target.ValueName, decoded.Value, decoded.Kind);
      writableKey.Flush();
      var after = RegistryStateSupport.Read(writableKey, target.ValueName);
      return new RegistrySetMutation(before, after, recovery);
    }
    finally
    {
      writableKey?.Dispose();
    }
  }

  internal static object CreateRecoveryRecord(
    ResolvedRegistryTarget target,
    RegistryState before) => new
    {
      recordContract = RegistryCapabilitySchemas.RecoveryRecordContract,
      target.RootId,
      target.SubKey,
      target.ValueName,
      keyExisted = before.KeyExists,
      before.Exists,
      before.ValueType,
      before.Value,
    };

  private static RegistryCreationTarget OpenCreationParent(
    ResolvedRegistryTarget target)
  {
    var separator = target.SubKey.LastIndexOf('\\');
    var parentPath = separator < 0 ? string.Empty : target.SubKey[..separator];
    var childName = separator < 0 ? target.SubKey : target.SubKey[(separator + 1)..];
    RegistryKey? parent = null;
    try
    {
      if (parentPath.Length == 0)
      {
        parent = RegistryKey.OpenBaseKey(target.Hive, RegistryView.Registry64);
      }
      else
      {
        using var baseKey = RegistryKey.OpenBaseKey(
          target.Hive,
          RegistryView.Registry64);
        parent = baseKey.OpenSubKey(parentPath, writable: true);
      }
      if (parent is null)
      {
        throw new HostPreconditionException("registry_parent_key_unavailable");
      }
      return new RegistryCreationTarget(parent, childName);
    }
    catch
    {
      parent?.Dispose();
      throw;
    }
  }

  private static RegistryKey CreateNewKey(RegistryKey baseKey, string subKey)
  {
    var error = RegCreateKeyExW(
      baseKey.Handle,
      subKey,
      reserved: 0,
      keyClass: null,
      options: RegistryOptionNonVolatile,
      desiredAccess: KeyQueryValue | KeySetValue | KeyEnumerateSubKeys | KeyWow6464Key,
      securityAttributes: IntPtr.Zero,
      out var handle,
      out var disposition);
    if (error != 0)
    {
      handle?.Dispose();
      throw new Win32Exception(error);
    }
    if (disposition == RegistryOpenedExistingKey)
    {
      handle.Dispose();
      throw new HostPreconditionException("registry_key_changed_before_set");
    }
    if (disposition != RegistryCreatedNewKey)
    {
      handle.Dispose();
      throw new InvalidOperationException("registry_key_create_disposition_invalid");
    }

    try
    {
      return RegistryKey.FromHandle(handle, RegistryView.Registry64);
    }
    catch
    {
      handle.Dispose();
      throw;
    }
  }

  [LibraryImport(
    "advapi32.dll",
    EntryPoint = "RegCreateKeyExW",
    StringMarshalling = StringMarshalling.Utf16)]
  private static partial int RegCreateKeyExW(
    SafeRegistryHandle key,
    string subKey,
    uint reserved,
    string? keyClass,
    uint options,
    int desiredAccess,
    IntPtr securityAttributes,
    out SafeRegistryHandle result,
    out uint disposition);

  private sealed record RegistryCreationTarget(
    RegistryKey Parent,
    string ChildName);
}

internal sealed class RegistryValueReadCapabilityAdapter(
  RegistryTargetPolicy targets) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = RegistryCapabilitySchemas.Descriptor(
    "registry.value.read",
    "Read approved registry value",
    "Reads one exactly classified durable non-secret HKLM value as untrusted content.",
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    RegistryCapabilitySchemas.TargetArguments,
    RegistryCapabilitySchemas.ReadResult);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    RegistryCapabilitySchemas.ValidateTarget(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    RegistryCapabilitySchemas.ValidateReadResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var target = targets.Resolve(arguments, requireRead: true);
    using var baseKey = RegistryKey.OpenBaseKey(target.Hive, RegistryView.Registry64);
    using var key = baseKey.OpenSubKey(target.SubKey, writable: false);
    var state = RegistryStateSupport.Read(
      key,
      target.ValueName,
      target.DurableAllowedValueTypes
        ?? throw new HostPreconditionException(
          "registry_durable_target_not_allowed"));
    return ValueTask.FromResult(Result(target, state));
  }

  internal static CapabilityExecutionResult Result(
    ResolvedRegistryTarget target,
    RegistryState state)
  {
    if (target.DurableAllowedValueTypes is null
      || !RegistryStateSupport.IsDurableStateValueSafe(
        state,
        target.DurableAllowedValueTypes))
    {
      throw new HostPreconditionException(
        "registry_durable_value_secret_detected");
    }
    var output = JsonSerializer.Serialize(new
    {
      exists = state.Exists,
      valueType = state.ValueType,
      value = state.Value,
      stateSha256 = state.StateSha256,
    });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance:
      [
        RegistryProvenance(target, state.StateSha256),
      ],
      PreStateSha256: state.StateSha256,
      LocalBytesRead: state.ByteCount);
  }

  internal static DataProvenance RegistryProvenance(
    ResolvedRegistryTarget target,
    string contentSha256) => new(
      "windows-registry",
      PayloadDigest.Sha256Hex($"{target.RootId}\n{target.SubKey}\n{target.ValueName}"),
      contentSha256,
      ProvenanceTrust.UntrustedContent,
      DateTimeOffset.UtcNow);
}

internal sealed class RegistryValueSetCapabilityAdapter(
  RegistryTargetPolicy targets,
  IHostRecoveryVault recoveryVault) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = RegistryCapabilitySchemas.Descriptor(
    "registry.value.set",
    "Set approved registry value",
    "Creates or replaces one exactly classified durable non-secret HKLM value.",
    CapabilityEffect.Administrative,
    RecoveryKind.Snapshot,
    RegistryCapabilitySchemas.SetArguments,
    RegistryCapabilitySchemas.MutationResult);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    RegistryCapabilitySchemas.ValidateSet(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    RegistryCapabilitySchemas.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var validation = ValidateArguments(arguments);
    if (!validation.IsValid)
    {
      throw new HostPreconditionException(
        validation.ErrorCode ?? "arguments_schema_invalid");
    }
    RequireExpectedState(context);
    var target = targets.Resolve(arguments, requireWrite: true);
    var mutation = await RegistryValueMutationSupport.SetAsync(
      context,
      Descriptor.Id,
      target,
      arguments,
      recoveryVault,
      cancellationToken).ConfigureAwait(false);
    return Result(target, mutation);
  }

  internal static CapabilityExecutionResult Result(
    ResolvedRegistryTarget target,
    RegistrySetMutation mutation)
  {
    var output = JsonSerializer.Serialize(new
    {
      committed = true,
      stateSha256 = mutation.After.StateSha256,
    });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: true,
      OutcomeUncertain: false,
      Provenance:
      [
        RegistryValueReadCapabilityAdapter.RegistryProvenance(
          target,
          mutation.After.StateSha256),
        RecoveryProvenance(mutation.Recovery),
      ],
      OpaqueRecoveryHandle: mutation.Recovery.OpaqueHandle,
      PreStateSha256: mutation.Before.StateSha256,
      RecoveryProvenanceSha256: mutation.Recovery.RecordSha256,
      LocalBytesRead: mutation.Before.ByteCount,
      LocalBytesWritten: mutation.After.ByteCount);
  }

  internal static void RequireExpectedState(ActionExecutionContext context)
  {
    if (!PayloadDigest.IsSha256Hex(context.ExpectedPreStateSha256 ?? string.Empty))
    {
      throw new HostPreconditionException("expected_pre_state_required");
    }
  }

  internal static void MatchExpected(ActionExecutionContext context, string actual)
  {
    if (!PayloadDigest.FixedTimeEqualsHex(context.ExpectedPreStateSha256!, actual))
    {
      throw new HostPreconditionException("expected_pre_state_mismatch");
    }
  }

  internal static DataProvenance RecoveryProvenance(HostRecoveryReceipt recovery) => new(
    "host-recovery-record",
    PayloadDigest.Sha256Hex(recovery.OpaqueHandle),
    recovery.RecordSha256,
    ProvenanceTrust.TrustedSystem,
    DateTimeOffset.UtcNow);
}

internal sealed class RegistryValueDeleteCapabilityAdapter(
  RegistryTargetPolicy targets,
  IHostRecoveryVault recoveryVault) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = RegistryCapabilitySchemas.Descriptor(
    "registry.value.delete",
    "Delete approved registry value",
    "Deletes one value beneath a supervisor-approved HKLM root after snapshotting it.",
    CapabilityEffect.Administrative,
    RecoveryKind.Snapshot,
    RegistryCapabilitySchemas.TargetArguments,
    RegistryCapabilitySchemas.MutationResult);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    RegistryCapabilitySchemas.ValidateTarget(arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    RegistryCapabilitySchemas.ValidateMutationResult(result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    RegistryValueSetCapabilityAdapter.RequireExpectedState(context);
    var target = targets.Resolve(arguments, requireDelete: true);
    using var baseKey = RegistryKey.OpenBaseKey(target.Hive, RegistryView.Registry64);
    using var key = baseKey.OpenSubKey(target.SubKey, writable: true)
      ?? throw new HostPreconditionException("registry_value_absent");
    var before = RegistryStateSupport.Read(key, target.ValueName);
    if (!before.Exists)
    {
      throw new HostPreconditionException("registry_value_absent");
    }

    RegistryValueSetCapabilityAdapter.MatchExpected(context, before.StateSha256);
    var recovery = await recoveryVault.PrepareAsync(
      context,
      Descriptor.Id,
      before.StateSha256,
      RegistryValueMutationSupport.CreateRecoveryRecord(target, before),
      irreversible: false,
      cancellationToken).ConfigureAwait(false);
    cancellationToken.ThrowIfCancellationRequested();
    var guarded = RegistryStateSupport.Read(key, target.ValueName);
    if (!PayloadDigest.FixedTimeEqualsHex(
      guarded.StateSha256,
      before.StateSha256))
    {
      throw new HostPreconditionException("registry_value_changed_before_delete");
    }
    key.DeleteValue(target.ValueName, throwOnMissingValue: true);
    key.Flush();
    var after = RegistryStateSupport.Read(key, target.ValueName);
    var output = JsonSerializer.Serialize(new { committed = true, stateSha256 = after.StateSha256 });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: true,
      OutcomeUncertain: false,
      Provenance:
      [
        RegistryValueReadCapabilityAdapter.RegistryProvenance(target, after.StateSha256),
        RegistryValueSetCapabilityAdapter.RecoveryProvenance(recovery),
      ],
      OpaqueRecoveryHandle: recovery.OpaqueHandle,
      PreStateSha256: before.StateSha256,
      RecoveryProvenanceSha256: recovery.RecordSha256,
      LocalBytesRead: before.ByteCount,
      LocalBytesWritten: after.ByteCount);
  }
}
