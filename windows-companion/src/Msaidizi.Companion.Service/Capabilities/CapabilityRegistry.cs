using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

public interface IRuntimeCapabilityAvailability
{
  bool IsAvailable { get; }
}

public sealed record CapabilityRegistrySnapshot(
  string ManifestSha256,
  IReadOnlyList<CapabilityDescriptor> Descriptors);

public sealed class CapabilityRegistry
{
  private static readonly string[] RawExecutionCapabilityPrefixes =
  [
    "shell.",
    "powershell.",
    "cmd.",
    "raw-command.",
  ];

  private readonly Dictionary<string, IHostCapabilityAdapter> _adapters;

  public CapabilityRegistry(IEnumerable<IHostCapabilityAdapter> adapters)
  {
    var materialized = adapters.ToArray();
    if (materialized.Length > CompanionWireContract.MaximumCapabilityManifestEntries)
    {
      throw new InvalidOperationException("The capability manifest exceeds the broker wire limit.");
    }
    foreach (var adapter in materialized)
    {
      ValidateDescriptor(adapter.Descriptor);
    }

    _adapters = materialized.ToDictionary(
      adapter => Key(adapter.Descriptor.Id, adapter.Descriptor.Version),
      StringComparer.Ordinal);

  }

  public string ManifestSha256 => Snapshot().ManifestSha256;

  public IReadOnlyList<CapabilityDescriptor> Descriptors => Snapshot().Descriptors;

  public CapabilityRegistrySnapshot Snapshot()
  {
    var descriptors = _adapters.Values
      .Where(IsAvailable)
      .Select(adapter => adapter.Descriptor)
      .OrderBy(descriptor => descriptor.Id, StringComparer.Ordinal)
      .ThenBy(descriptor => descriptor.Version, StringComparer.Ordinal)
      .ToArray();
    return new CapabilityRegistrySnapshot(
      PayloadDigest.Sha256Hex(JsonSerializer.Serialize(descriptors)),
      descriptors);
  }

  public bool TryResolve(string capabilityId, string capabilityVersion, out IHostCapabilityAdapter? adapter)
  {
    if (_adapters.TryGetValue(Key(capabilityId, capabilityVersion), out adapter)
      && IsAvailable(adapter))
    {
      return true;
    }
    adapter = null;
    return false;
  }

  private static bool IsAvailable(IHostCapabilityAdapter adapter) =>
    adapter is not IRuntimeCapabilityAvailability availability
    || availability.IsAvailable;

  private static string Key(string capabilityId, string capabilityVersion) =>
    $"{capabilityId}\u001f{capabilityVersion}";

  private static void ValidateDescriptor(CapabilityDescriptor descriptor)
  {
    if (HostCredentialEphemeralityPolicy.IsForbiddenFileContentCapability(descriptor.Id))
    {
      throw new InvalidOperationException(HostCredentialEphemeralityPolicy.ErrorCode);
    }

    if (!CompanionWireContract.IsSafeIdentifier(descriptor.Id)
      || !CompanionWireContract.IsSafeIdentifier(descriptor.Version)
      || string.IsNullOrEmpty(descriptor.DisplayName)
      || descriptor.DisplayName.Length > CompanionWireContract.MaximumCapabilityDisplayNameLength
      || descriptor.Description is null
      || descriptor.Description.Length > CompanionWireContract.MaximumCapabilityDescriptionLength
      || descriptor.SupportedOperatingSystems is null
      || descriptor.SupportedOperatingSystems.Count
        > CompanionWireContract.MaximumSupportedOperatingSystems
      || descriptor.SupportedOperatingSystems.Any(value => value is null)
      || descriptor.ProvenanceOutputs is null
      || descriptor.ProvenanceOutputs.Count > CompanionWireContract.MaximumProvenanceOutputs
      || descriptor.ProvenanceOutputs.Any(value => value is null))
    {
      throw new InvalidOperationException(
        "Capability descriptors must fit the exact broker manifest contract.");
    }

    if (descriptor.TouchesTrustedRoot
      || TrustedRootComponents.IsProtectedCapabilityId(descriptor.Id))
    {
      throw new InvalidOperationException("Trusted-root capabilities cannot enter the manifest.");
    }

    if (RawExecutionCapabilityPrefixes.Any(prefix =>
        descriptor.Id.StartsWith(prefix, StringComparison.Ordinal))
      || string.Equals(descriptor.Id, "audio.microphone.capture", StringComparison.Ordinal))
    {
      throw new InvalidOperationException(
        "Ungoverned raw execution and sensor capabilities cannot enter the manifest.");
    }

    EnsureStrictObjectSchema(descriptor.ArgumentsSchema, "arguments");
    EnsureStrictObjectSchema(descriptor.ResultSchema, "result");

    if (descriptor.IsMutation
      && (descriptor.Recovery == RecoveryKind.NotApplicable
        || descriptor.Consent == ConsentRequirement.None))
    {
      throw new InvalidOperationException(
        "Mutation capabilities require explicit consent and recovery metadata.");
    }

    if (descriptor.Effect == CapabilityEffect.Irreversible
      && descriptor.Recovery != RecoveryKind.Irreversible)
    {
      throw new InvalidOperationException(
        "An irreversible effect requires irreversible recovery metadata.");
    }

    if (!descriptor.IsMutation && descriptor.Recovery == RecoveryKind.Irreversible)
    {
      throw new InvalidOperationException(
        "A non-mutating capability cannot declare irreversible recovery metadata.");
    }
  }

  private static void EnsureStrictObjectSchema(JsonElement schema, string schemaName)
  {
    if (schema.ValueKind != JsonValueKind.Object
      || !schema.TryGetProperty("type", out var type)
      || type.GetString() != "object"
      || !schema.TryGetProperty("additionalProperties", out var additionalProperties)
      || additionalProperties.ValueKind != JsonValueKind.False)
    {
      throw new InvalidOperationException(
        $"Capability {schemaName} schemas must be strict object schemas with additionalProperties=false.");
    }
  }
}
