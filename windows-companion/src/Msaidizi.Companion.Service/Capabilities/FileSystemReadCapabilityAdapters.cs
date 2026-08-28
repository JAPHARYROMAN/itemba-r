using System.IO.Enumeration;
using System.Security.Cryptography;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal static class FileSystemCapabilitySchemas
{
  public static readonly JsonElement PathArguments = HostFileSystemSupport.ParseSchema(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "rootId": { "type": "string", "minLength": 1, "maxLength": 64 },
        "relativePath": { "type": "string", "maxLength": 32767 }
      },
      "required": ["rootId", "relativePath"],
      "additionalProperties": false
    }
    """);

  public static JsonElement Parse(string json) => HostFileSystemSupport.ParseSchema(json);

  public static CapabilityArgumentValidation ValidatePathArguments(
    JsonElement arguments,
    SupervisorPathPolicy paths,
    HostPathAccess access,
    bool allowRoot,
    bool? requireDirectory)
  {
    try
    {
      if (!HostFileSystemSupport.HasExactProperties(
        arguments,
        new HashSet<string>(["rootId", "relativePath"], StringComparer.Ordinal)))
      {
        return Invalid();
      }

      var resolved = paths.Resolve(
        HostFileSystemSupport.RequiredString(arguments, "rootId", 64),
        arguments.GetProperty("relativePath").GetString()
          ?? throw new HostPolicyException("arguments_schema_invalid"),
        access,
        allowRoot);
      using var handle = paths.OpenExisting(resolved, requireDirectory);
      return CapabilityArgumentValidation.Success;
    }
    catch (HostPolicyException exception)
    {
      return CapabilityArgumentValidation.Invalid(exception.ErrorCode, exception.Message);
    }
  }

  public static CapabilityArgumentValidation ValidateSimpleResult(
    JsonElement result,
    params string[] requiredProperties) =>
    HostFileSystemSupport.HasExactProperties(
      result,
      new HashSet<string>(requiredProperties, StringComparer.Ordinal))
      ? CapabilityArgumentValidation.Success
      : CapabilityArgumentValidation.Invalid(
        "result_schema_invalid",
        "Result did not match the declared strict schema.");

  public static CapabilityArgumentValidation Invalid() =>
    CapabilityArgumentValidation.Invalid(
      "arguments_schema_invalid",
      "Arguments did not match the declared strict schema.");

  public static bool IsString(JsonElement value, string property) =>
    value.TryGetProperty(property, out var item)
    && item.ValueKind == JsonValueKind.String;

  public static bool IsNonNegativeInteger(JsonElement value, string property) =>
    value.TryGetProperty(property, out var item)
    && item.ValueKind == JsonValueKind.Number
    && item.TryGetInt64(out var parsed)
    && parsed >= 0;

  public static bool IsSha256(JsonElement value, string property) =>
    IsString(value, property)
    && PayloadDigest.IsSha256Hex(value.GetProperty(property).GetString());

  public static CapabilityDescriptor Descriptor(
    string id,
    string displayName,
    string description,
    CapabilityEffect effect,
    RecoveryKind recovery,
    RequiredPrivilege privilege,
    JsonElement arguments,
    JsonElement result,
    string provenance,
    ConsentRequirement consent = ConsentRequirement.SignedMandate) => new(
      id,
      "1.0.0",
      displayName,
      description,
      CapabilityDataClass.Restricted,
      effect,
      consent,
      recovery,
      privilege,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      arguments,
      result,
      [provenance],
      TouchesTrustedRoot: false);
}

public sealed class FileSystemEntryStatCapabilityAdapter : IHostCapabilityAdapter
{
  private static readonly JsonElement ResultSchema = FileSystemCapabilitySchemas.Parse(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "rootId": { "type": "string" },
        "relativePath": { "type": "string" },
        "entryType": { "enum": ["file", "directory"] },
        "length": { "type": "integer", "minimum": 0 },
        "stateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["rootId", "relativePath", "entryType", "length", "stateSha256"],
      "additionalProperties": false
    }
    """);
  private readonly SupervisorPathPolicy _paths;

  public FileSystemEntryStatCapabilityAdapter(SupervisorPathPolicy paths)
  {
    _paths = paths;
  }

  public CapabilityDescriptor Descriptor { get; } = FileSystemCapabilitySchemas.Descriptor(
    "filesystem.entry.stat",
    "Inspect file or folder state",
    "Returns a content-derived state digest beneath a supervisor-owned root.",
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    RequiredPrivilege.LocalSystem,
    FileSystemCapabilitySchemas.PathArguments,
    ResultSchema,
    "windows-filesystem");

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    FileSystemCapabilitySchemas.ValidatePathArguments(
      arguments,
      _paths,
      HostPathAccess.Read,
      allowRoot: true,
      requireDirectory: null);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    FileSystemCapabilitySchemas.ValidateSimpleResult(
        result,
        "rootId",
        "relativePath",
        "entryType",
        "length",
        "stateSha256").IsValid
      && FileSystemCapabilitySchemas.IsString(result, "rootId")
      && FileSystemCapabilitySchemas.IsString(result, "relativePath")
      && FileSystemCapabilitySchemas.IsString(result, "entryType")
      && result.GetProperty("entryType").GetString() is "file" or "directory"
      && FileSystemCapabilitySchemas.IsNonNegativeInteger(result, "length")
      && FileSystemCapabilitySchemas.IsSha256(result, "stateSha256")
        ? CapabilityArgumentValidation.Success
        : CapabilityArgumentValidation.Invalid("result_schema_invalid", "Invalid stat result.");

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var target = _paths.Resolve(
      arguments.GetProperty("rootId").GetString()!,
      arguments.GetProperty("relativePath").GetString()!,
      HostPathAccess.Read,
      allowRoot: true);
    var state = await HostFileSystemSupport.ComputeStateAsync(
      _paths,
      target,
      context.Budgets.MaxLocalBytes,
      cancellationToken).ConfigureAwait(false);
    var output = JsonSerializer.Serialize(new
    {
      rootId = target.RootId,
      relativePath = target.RelativePath,
      entryType = state.EntryType,
      length = state.Length,
      stateSha256 = state.Sha256,
    });
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      [HostFileSystemSupport.CreateProvenance("windows-filesystem", target, state.Sha256)],
      LocalBytesRead: state.BytesRead);
  }
}

public sealed class FileSystemFileReadCapabilityAdapter : IHostCapabilityAdapter
{
  private static readonly JsonElement ArgumentsSchema = FileSystemCapabilitySchemas.Parse(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "rootId": { "type": "string", "minLength": 1, "maxLength": 64 },
        "relativePath": { "type": "string", "minLength": 1, "maxLength": 32767 },
        "maxBytes": { "type": "integer", "minimum": 1, "maximum": 67108864 }
      },
      "required": ["rootId", "relativePath", "maxBytes"],
      "additionalProperties": false
    }
    """);
  private static readonly JsonElement ResultSchema = FileSystemCapabilitySchemas.Parse(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "rootId": { "type": "string" },
        "relativePath": { "type": "string" },
        "contentBase64": { "type": "string" },
        "length": { "type": "integer", "minimum": 0 },
        "contentSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      },
      "required": ["rootId", "relativePath", "contentBase64", "length", "contentSha256"],
      "additionalProperties": false
    }
    """);
  private readonly SupervisorPathPolicy _paths;
  private readonly long _maximumSingleFileBytes;

  public FileSystemFileReadCapabilityAdapter(
    SupervisorPathPolicy paths,
    IOptions<HostCapabilityOptions> options)
  {
    _paths = paths;
    _maximumSingleFileBytes = Math.Clamp(
      options.Value.MaximumSingleFileBytes,
      1,
      67_108_864);
  }

  public CapabilityDescriptor Descriptor { get; } = FileSystemCapabilitySchemas.Descriptor(
    "filesystem.file.read",
    "Read a file",
    "Reads bounded file bytes beneath a supervisor-owned root and returns Base64.",
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    RequiredPrivilege.LocalSystem,
    ArgumentsSchema,
    ResultSchema,
    "windows-file-content");

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments)
  {
    try
    {
      if (!HostFileSystemSupport.HasExactProperties(
          arguments,
          new HashSet<string>(["rootId", "relativePath", "maxBytes"], StringComparer.Ordinal))
        || arguments.GetProperty("maxBytes").ValueKind != JsonValueKind.Number
        || !arguments.GetProperty("maxBytes").TryGetInt64(out var maxBytes)
        || maxBytes <= 0
        || maxBytes > _maximumSingleFileBytes)
      {
        return FileSystemCapabilitySchemas.Invalid();
      }

      var resolved = _paths.Resolve(
        HostFileSystemSupport.RequiredString(arguments, "rootId", 64),
        HostFileSystemSupport.RequiredString(arguments, "relativePath", 32_767),
        HostPathAccess.Read);
      using var handle = _paths.OpenExisting(resolved, requireDirectory: false);
      return CapabilityArgumentValidation.Success;
    }
    catch (HostPolicyException exception)
    {
      return CapabilityArgumentValidation.Invalid(exception.ErrorCode, exception.Message);
    }
  }

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    FileSystemCapabilitySchemas.ValidateSimpleResult(
        result,
        "rootId",
        "relativePath",
        "contentBase64",
        "length",
        "contentSha256").IsValid
      && FileSystemCapabilitySchemas.IsString(result, "rootId")
      && FileSystemCapabilitySchemas.IsString(result, "relativePath")
      && FileSystemCapabilitySchemas.IsString(result, "contentBase64")
      && FileSystemCapabilitySchemas.IsNonNegativeInteger(result, "length")
      && FileSystemCapabilitySchemas.IsSha256(result, "contentSha256")
      && PayloadMatchesMetadata(result)
        ? CapabilityArgumentValidation.Success
        : CapabilityArgumentValidation.Invalid("result_schema_invalid", "Invalid file read result.");

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var target = _paths.Resolve(
      arguments.GetProperty("rootId").GetString()!,
      arguments.GetProperty("relativePath").GetString()!,
      HostPathAccess.Read);
    var requested = arguments.GetProperty("maxBytes").GetInt64();
    var maximum = Math.Min(requested, Math.Min(
      _maximumSingleFileBytes,
      context.Budgets.MaxLocalBytes));
    var (content, sha256) = await HostFileSystemSupport.ReadFileAsync(
      _paths,
      target,
      maximum,
      cancellationToken).ConfigureAwait(false);
    try
    {
      var output = JsonSerializer.Serialize(new
      {
        rootId = target.RootId,
        relativePath = target.RelativePath,
        contentBase64 = Convert.ToBase64String(content),
        length = content.LongLength,
        contentSha256 = sha256,
      });
      return new CapabilityExecutionResult(
        output,
        MutationCommitted: false,
        OutcomeUncertain: false,
        [HostFileSystemSupport.CreateProvenance(
          "windows-file-content",
          target,
          sha256,
          ProvenanceTrust.UntrustedContent)],
        LocalBytesRead: content.LongLength);
    }
    finally
    {
      System.Security.Cryptography.CryptographicOperations.ZeroMemory(content);
    }
  }

  private static bool PayloadMatchesMetadata(JsonElement result)
  {
    byte[]? content = null;
    try
    {
      var encoded = result.GetProperty("contentBase64").GetString()!;
      content = Convert.FromBase64String(encoded);
      if (!string.Equals(Convert.ToBase64String(content), encoded, StringComparison.Ordinal)
        || result.GetProperty("length").GetInt64() != content.LongLength)
      {
        return false;
      }

      var declared = Convert.FromHexString(result.GetProperty("contentSha256").GetString()!);
      var actual = SHA256.HashData(content);
      try
      {
        return CryptographicOperations.FixedTimeEquals(actual, declared);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(actual);
        CryptographicOperations.ZeroMemory(declared);
      }
    }
    catch (FormatException)
    {
      return false;
    }
    finally
    {
      if (content is not null)
      {
        CryptographicOperations.ZeroMemory(content);
      }
    }
  }
}

public sealed class FileSystemFolderListCapabilityAdapter : IHostCapabilityAdapter
{
  private static readonly JsonElement ArgumentsSchema = FileSystemCapabilitySchemas.Parse(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "rootId": { "type": "string", "minLength": 1, "maxLength": 64 },
        "relativePath": { "type": "string", "maxLength": 32767 },
        "maxResults": { "type": "integer", "minimum": 1, "maximum": 1000 }
      },
      "required": ["rootId", "relativePath", "maxResults"],
      "additionalProperties": false
    }
    """);
  private static readonly JsonElement ResultSchema = FileSystemCapabilitySchemas.Parse(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "rootId": { "type": "string" },
        "relativePath": { "type": "string" },
        "entries": {
          "type": "array",
          "maxItems": 1000,
          "items": {
            "type": "object",
            "properties": {
              "relativePath": { "type": "string" },
              "entryType": { "enum": ["file", "directory"] },
              "length": { "type": "integer", "minimum": 0 }
            },
            "required": ["relativePath", "entryType", "length"],
            "additionalProperties": false
          }
        },
        "truncated": { "type": "boolean" }
      },
      "required": ["rootId", "relativePath", "entries", "truncated"],
      "additionalProperties": false
    }
    """);
  private readonly SupervisorPathPolicy _paths;
  private readonly int _maximumResults;

  public FileSystemFolderListCapabilityAdapter(
    SupervisorPathPolicy paths,
    IOptions<HostCapabilityOptions> options)
  {
    _paths = paths;
    _maximumResults = Math.Clamp(options.Value.MaximumSearchResults, 1, 1_000);
  }

  public CapabilityDescriptor Descriptor { get; } = FileSystemCapabilitySchemas.Descriptor(
    "filesystem.folder.list",
    "List a folder",
    "Lists immediate children beneath a supervisor-owned root.",
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    RequiredPrivilege.LocalSystem,
    ArgumentsSchema,
    ResultSchema,
    "windows-directory-listing");

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    ValidateListArguments(arguments, _paths, _maximumResults);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    ValidateListingResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var target = _paths.Resolve(
      arguments.GetProperty("rootId").GetString()!,
      arguments.GetProperty("relativePath").GetString()!,
      HostPathAccess.Read,
      allowRoot: true);
    using var directoryHandle = _paths.OpenExisting(target, requireDirectory: true, lockAgainstMutation: true);
    var limit = Math.Min(arguments.GetProperty("maxResults").GetInt32(), _maximumResults);
    var entries = new List<object>(limit);
    var truncated = false;
    foreach (var path in Directory.EnumerateFileSystemEntries(target.FullPath))
    {
      cancellationToken.ThrowIfCancellationRequested();
      if (entries.Count == limit)
      {
        truncated = true;
        break;
      }

      var child = _paths.Resolve(
        target.RootId,
        Path.GetRelativePath(target.RootPath, path),
        HostPathAccess.Read);
      using var childHandle = _paths.OpenExisting(child);
      entries.Add(new
      {
        relativePath = child.RelativePath,
        entryType = childHandle.IsDirectory ? "directory" : "file",
        length = childHandle.IsDirectory ? 0 : RandomAccess.GetLength(childHandle.Handle),
      });
    }

    var output = JsonSerializer.Serialize(new
    {
      rootId = target.RootId,
      relativePath = target.RelativePath,
      entries,
      truncated,
    });
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      [HostFileSystemSupport.CreateProvenance(
        "windows-directory-listing",
        target,
        PayloadDigest.Sha256Hex(output))]));
  }

  private static CapabilityArgumentValidation ValidateListArguments(
    JsonElement arguments,
    SupervisorPathPolicy paths,
    int maximumResults)
  {
    try
    {
      if (!HostFileSystemSupport.HasExactProperties(
          arguments,
          new HashSet<string>(["rootId", "relativePath", "maxResults"], StringComparer.Ordinal))
        || arguments.GetProperty("maxResults").ValueKind != JsonValueKind.Number
        || !arguments.GetProperty("maxResults").TryGetInt32(out var maxResults)
        || maxResults <= 0
        || maxResults > maximumResults)
      {
        return FileSystemCapabilitySchemas.Invalid();
      }

      var target = paths.Resolve(
        HostFileSystemSupport.RequiredString(arguments, "rootId", 64),
        arguments.GetProperty("relativePath").GetString()
          ?? throw new HostPolicyException("arguments_schema_invalid"),
        HostPathAccess.Read,
        allowRoot: true);
      using var handle = paths.OpenExisting(target, requireDirectory: true);
      return CapabilityArgumentValidation.Success;
    }
    catch (HostPolicyException exception)
    {
      return CapabilityArgumentValidation.Invalid(exception.ErrorCode, exception.Message);
    }
  }

  private static CapabilityArgumentValidation ValidateListingResult(JsonElement result)
  {
    if (!FileSystemCapabilitySchemas.ValidateSimpleResult(
        result,
        "rootId",
        "relativePath",
        "entries",
        "truncated").IsValid
      || !FileSystemCapabilitySchemas.IsString(result, "rootId")
      || !FileSystemCapabilitySchemas.IsString(result, "relativePath")
      || result.GetProperty("entries").ValueKind != JsonValueKind.Array
      || result.GetProperty("truncated").ValueKind is not (JsonValueKind.True or JsonValueKind.False))
    {
      return CapabilityArgumentValidation.Invalid("result_schema_invalid", "Invalid folder listing.");
    }

    foreach (var entry in result.GetProperty("entries").EnumerateArray())
    {
      if (!HostFileSystemSupport.HasExactProperties(
          entry,
          new HashSet<string>(["relativePath", "entryType", "length"], StringComparer.Ordinal))
        || !FileSystemCapabilitySchemas.IsString(entry, "relativePath")
        || !FileSystemCapabilitySchemas.IsString(entry, "entryType")
        || entry.GetProperty("entryType").GetString() is not ("file" or "directory")
        || !FileSystemCapabilitySchemas.IsNonNegativeInteger(entry, "length"))
      {
        return CapabilityArgumentValidation.Invalid("result_schema_invalid", "Invalid folder entry.");
      }
    }

    return CapabilityArgumentValidation.Success;
  }
}

public sealed class FileSystemSearchCapabilityAdapter : IHostCapabilityAdapter
{
  private static readonly JsonElement ArgumentsSchema = FileSystemCapabilitySchemas.Parse(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "rootId": { "type": "string", "minLength": 1, "maxLength": 64 },
        "relativePath": { "type": "string", "maxLength": 32767 },
        "pattern": { "type": "string", "minLength": 1, "maxLength": 128 },
        "maxResults": { "type": "integer", "minimum": 1, "maximum": 1000 }
      },
      "required": ["rootId", "relativePath", "pattern", "maxResults"],
      "additionalProperties": false
    }
    """);
  private static readonly JsonElement ResultSchema = FileSystemCapabilitySchemas.Parse(
    """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "rootId": { "type": "string" },
        "matches": {
          "type": "array",
          "maxItems": 1000,
          "items": {
            "type": "object",
            "properties": {
              "relativePath": { "type": "string" },
              "entryType": { "enum": ["file", "directory"] }
            },
            "required": ["relativePath", "entryType"],
            "additionalProperties": false
          }
        },
        "truncated": { "type": "boolean" }
      },
      "required": ["rootId", "matches", "truncated"],
      "additionalProperties": false
    }
    """);
  private readonly SupervisorPathPolicy _paths;
  private readonly int _maximumResults;

  public FileSystemSearchCapabilityAdapter(
    SupervisorPathPolicy paths,
    IOptions<HostCapabilityOptions> options)
  {
    _paths = paths;
    _maximumResults = Math.Clamp(options.Value.MaximumSearchResults, 1, 1_000);
  }

  public CapabilityDescriptor Descriptor { get; } = FileSystemCapabilitySchemas.Descriptor(
    "filesystem.search",
    "Search files and folders",
    "Recursively matches a bounded simple filename pattern without following links.",
    CapabilityEffect.LocalRead,
    RecoveryKind.NotApplicable,
    RequiredPrivilege.LocalSystem,
    ArgumentsSchema,
    ResultSchema,
    "windows-filesystem-search");

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments)
  {
    try
    {
      if (!HostFileSystemSupport.HasExactProperties(
          arguments,
          new HashSet<string>(
            ["rootId", "relativePath", "pattern", "maxResults"],
            StringComparer.Ordinal))
        || arguments.GetProperty("maxResults").ValueKind != JsonValueKind.Number
        || !arguments.GetProperty("maxResults").TryGetInt32(out var maxResults)
        || maxResults <= 0
        || maxResults > _maximumResults)
      {
        return FileSystemCapabilitySchemas.Invalid();
      }

      SupervisorPathPolicy.ValidateSearchPattern(
        HostFileSystemSupport.RequiredString(arguments, "pattern", 128));
      var target = _paths.Resolve(
        HostFileSystemSupport.RequiredString(arguments, "rootId", 64),
        arguments.GetProperty("relativePath").GetString()
          ?? throw new HostPolicyException("arguments_schema_invalid"),
        HostPathAccess.Read,
        allowRoot: true);
      using var handle = _paths.OpenExisting(target, requireDirectory: true);
      return CapabilityArgumentValidation.Success;
    }
    catch (HostPolicyException exception)
    {
      return CapabilityArgumentValidation.Invalid(exception.ErrorCode, exception.Message);
    }
  }

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    ValidateSearchResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var target = _paths.Resolve(
      arguments.GetProperty("rootId").GetString()!,
      arguments.GetProperty("relativePath").GetString()!,
      HostPathAccess.Read,
      allowRoot: true);
    using var rootHandle = _paths.OpenExisting(target, requireDirectory: true, lockAgainstMutation: true);
    var pattern = arguments.GetProperty("pattern").GetString()!;
    var limit = Math.Min(arguments.GetProperty("maxResults").GetInt32(), _maximumResults);
    var matches = new List<object>(limit);
    var truncated = false;
    foreach (var entry in HostFileSystemSupport.EnumerateTree(_paths, target))
    {
      cancellationToken.ThrowIfCancellationRequested();
      if (!FileSystemName.MatchesSimpleExpression(
        pattern,
        Path.GetFileName(entry.FullPath),
        ignoreCase: true))
      {
        continue;
      }

      if (matches.Count == limit)
      {
        truncated = true;
        break;
      }

      using var handle = _paths.OpenExisting(entry);
      matches.Add(new
      {
        relativePath = entry.RelativePath,
        entryType = handle.IsDirectory ? "directory" : "file",
      });
    }

    var output = JsonSerializer.Serialize(new
    {
      rootId = target.RootId,
      matches,
      truncated,
    });
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      [HostFileSystemSupport.CreateProvenance(
        "windows-filesystem-search",
        target,
        PayloadDigest.Sha256Hex(output))]));
  }

  private static CapabilityArgumentValidation ValidateSearchResult(JsonElement result)
  {
    if (!FileSystemCapabilitySchemas.ValidateSimpleResult(
        result,
        "rootId",
        "matches",
        "truncated").IsValid
      || !FileSystemCapabilitySchemas.IsString(result, "rootId")
      || result.GetProperty("matches").ValueKind != JsonValueKind.Array
      || result.GetProperty("truncated").ValueKind is not (JsonValueKind.True or JsonValueKind.False))
    {
      return CapabilityArgumentValidation.Invalid("result_schema_invalid", "Invalid search result.");
    }

    foreach (var match in result.GetProperty("matches").EnumerateArray())
    {
      if (!HostFileSystemSupport.HasExactProperties(
          match,
          new HashSet<string>(["relativePath", "entryType"], StringComparer.Ordinal))
        || !FileSystemCapabilitySchemas.IsString(match, "relativePath")
        || !FileSystemCapabilitySchemas.IsString(match, "entryType")
        || match.GetProperty("entryType").GetString() is not ("file" or "directory"))
      {
        return CapabilityArgumentValidation.Invalid("result_schema_invalid", "Invalid search match.");
      }
    }

    return CapabilityArgumentValidation.Success;
  }
}
