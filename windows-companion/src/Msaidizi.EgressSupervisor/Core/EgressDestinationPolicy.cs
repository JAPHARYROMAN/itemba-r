using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.EgressSupervisor.Core;

public sealed record EgressDestinationPolicyEntryV1(
  string EndpointId,
  string CapabilityId,
  string DestinationHost,
  int DestinationPort,
  string DestinationPathAndQuery,
  string ServerCertificateSha256Pin,
  string CredentialReferenceId,
  string CredentialRecordSha256,
  string CredentialPrefix,
  string DestinationScopeSha256);

public sealed record EgressDestinationPolicyV1(
  int ContractVersion,
  string PolicyId,
  IReadOnlyList<EgressDestinationPolicyEntryV1> Entries,
  EgressDynamicDestinationPolicyV1? DynamicDestinations = null);

public sealed record EgressDynamicDestinationPolicyV1(
  bool Enabled,
  IReadOnlyList<string> CapabilityIds,
  IReadOnlyList<int> AllowedPorts,
  int MaximumPathAndQueryLength,
  int MaximumRequestBodyBytes,
  string CredentialMode,
  int MaximumCredentialPrefixLength);

/// <summary>
/// Immutable destination authority independently loaded by the supervisor.
/// The digest is placed in every egress lease. Static entries are allowlisted;
/// the optional dynamic section can authorize a closed capability set to
/// derive one exact ephemeral destination from broker-signed action arguments.
/// </summary>
public sealed class EgressDestinationPolicy
{
  private const string Domain = "MSAIDIZI-EGRESS-DESTINATION-POLICY-V1";
  private static readonly HashSet<string> SupportedDynamicCapabilities =
  [
    "external.email.send",
    "external.message.send",
    "external.publish.create",
    "external.purchase.submit",
  ];
  private static readonly JsonSerializerOptions StrictJson = new(JsonSerializerDefaults.Web)
  {
    MaxDepth = 16,
    PropertyNameCaseInsensitive = false,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
  };
  private readonly HashSet<DestinationKey> _entries;
  private readonly Dictionary<EndpointKey, EgressDestinationPolicyEntryV1> _endpoints;
  private readonly EgressDynamicDestinationPolicyV1? _dynamic;

  public EgressDestinationPolicy(EgressDestinationPolicyV1 policy)
  {
    ArgumentNullException.ThrowIfNull(policy);
    if (policy.ContractVersion != 1
      || !IsSafeId(policy.PolicyId, 128)
      || policy.Entries.Count > 512)
    {
      throw new InvalidDataException("The egress destination policy is invalid.");
    }

    _dynamic = CanonicalDynamicPolicy(policy.DynamicDestinations);
    if (policy.Entries.Count == 0 && _dynamic is not { Enabled: true })
    {
      throw new InvalidDataException("The egress destination policy grants no destinations.");
    }

    var canonicalEntries = new List<EgressDestinationPolicyEntryV1>(policy.Entries.Count);
    _entries = new HashSet<DestinationKey>();
    _endpoints = new Dictionary<EndpointKey, EgressDestinationPolicyEntryV1>();
    foreach (var entry in policy.Entries)
    {
      var host = CanonicalHost(entry.DestinationHost);
      if (!IsSafeId(entry.EndpointId, 80)
        || !IsSafeId(entry.CapabilityId, 160)
        || host is null
        || entry.DestinationPort is < 1 or > 65_535
        || !IsSafePathAndQuery(entry.DestinationPathAndQuery)
        || !IsCanonicalSha256(entry.ServerCertificateSha256Pin)
        || !Guid.TryParseExact(entry.CredentialReferenceId, "D", out _)
        || !IsCanonicalSha256(entry.CredentialRecordSha256)
        || !IsSafeCredentialPrefix(entry.CredentialPrefix)
        || !IsCanonicalSha256(entry.DestinationScopeSha256))
      {
        throw new InvalidDataException("An egress destination-policy entry is invalid.");
      }

      var canonical = entry with
      {
        DestinationHost = host,
        ServerCertificateSha256Pin = entry.ServerCertificateSha256Pin.ToLowerInvariant(),
        CredentialRecordSha256 = entry.CredentialRecordSha256.ToLowerInvariant(),
        DestinationScopeSha256 = entry.DestinationScopeSha256.ToLowerInvariant(),
      };
      var expectedScope = ComputeDestinationScopeSha256(canonical);
      if (!FixedTimeHex(expectedScope, canonical.DestinationScopeSha256))
      {
        throw new InvalidDataException(
          "An egress destination-policy scope does not match its exact endpoint.");
      }
      var key = DestinationKey.From(canonical);
      if (!_entries.Add(key)
        || !_endpoints.TryAdd(
          new EndpointKey(canonical.CapabilityId, canonical.EndpointId),
          canonical))
      {
        throw new InvalidDataException("Egress destination-policy entries must be unique.");
      }
      canonicalEntries.Add(canonical);
    }

    canonicalEntries.Sort(static (left, right) => StringComparer.Ordinal.Compare(
      CanonicalEntry(left),
      CanonicalEntry(right)));
    Value = policy with { Entries = canonicalEntries, DynamicDestinations = _dynamic };
    Sha256 = ComputeSha256(Value);
  }

  public EgressDestinationPolicyV1 Value { get; }

  public string Sha256 { get; }

  public bool Allows(
    string capabilityId,
    string destinationHost,
    int destinationPort,
    string destinationScopeSha256)
  {
    var host = CanonicalHost(destinationHost);
    return host is not null
      && _entries.Contains(new DestinationKey(
        capabilityId,
        host,
        destinationPort,
        destinationScopeSha256));
  }

  public bool AllowsCapability(string capabilityId) =>
    _entries.Any(entry => string.Equals(
      entry.CapabilityId,
      capabilityId,
      StringComparison.Ordinal))
    || (_dynamic is { Enabled: true }
      && _dynamic.CapabilityIds.Contains(capabilityId, StringComparer.Ordinal));

  public bool AllowsDynamicRequestBody(string capabilityId, int requestBodyBytes) =>
    _dynamic is { Enabled: true }
    && _dynamic.CapabilityIds.Contains(capabilityId, StringComparer.Ordinal)
    && requestBodyBytes >= 0
    && requestBodyBytes <= _dynamic.MaximumRequestBodyBytes;

  public EgressDestinationPolicyEntryV1 Resolve(
    string capabilityId,
    string endpointId)
  {
    if (!_endpoints.TryGetValue(new EndpointKey(capabilityId, endpointId), out var entry))
    {
      throw new InvalidDataException("The exact egress endpoint is not authorized.");
    }
    return entry;
  }

  public EgressDestinationPolicyEntryV1 Resolve(
    string capabilityId,
    ExactExternalActionDestination destination)
  {
    ArgumentNullException.ThrowIfNull(destination);
    if (!destination.IsDynamic)
    {
      if (!string.Equals(
          destination.Authority,
          EgressExternalActionCanonical.StaticEndpointAuthority,
          StringComparison.Ordinal)
        || destination.AbsoluteHttpsUri.Length != 0
        || destination.ServerCertificateSha256.Length != 0
        || destination.VaultReferenceId.Length != 0
        || destination.VaultRecordSha256.Length != 0
        || destination.HeaderPrefix.Length != 0)
      {
        throw new InvalidDataException("The static egress destination is not canonical.");
      }
      return Resolve(capabilityId, destination.EndpointId);
    }

    if (_dynamic is not { Enabled: true } dynamic
      || !dynamic.CapabilityIds.Contains(capabilityId, StringComparer.Ordinal)
      || !PublicNetworkDestinationPolicy.TryCanonicalizeHttpsUri(
        destination.AbsoluteHttpsUri,
        2_048,
        out var uri)
      || !dynamic.AllowedPorts.Contains(uri.Port)
      || uri.PathAndQuery.Length > dynamic.MaximumPathAndQueryLength
      || dynamic.CredentialMode != "vault-reference-required"
      || !IsSafeId(destination.EndpointId, 80)
      || !IsCanonicalSha256(destination.ServerCertificateSha256)
      || !Guid.TryParseExact(destination.VaultReferenceId, "D", out var reference)
      || !string.Equals(
        reference.ToString("D"),
        destination.VaultReferenceId,
        StringComparison.Ordinal)
      || !IsCanonicalSha256(destination.VaultRecordSha256)
      || destination.HeaderPrefix.Length > dynamic.MaximumCredentialPrefixLength
      || !IsSafeCredentialPrefix(destination.HeaderPrefix))
    {
      throw new InvalidDataException("The dynamic egress destination is denied by policy.");
    }

    var entry = new EgressDestinationPolicyEntryV1(
      destination.EndpointId,
      capabilityId,
      uri.IdnHost.ToLowerInvariant(),
      uri.Port,
      uri.PathAndQuery,
      destination.ServerCertificateSha256,
      destination.VaultReferenceId,
      destination.VaultRecordSha256,
      destination.HeaderPrefix,
      EgressExternalActionCanonical.DestinationScopeSha256(
        capabilityId,
        destination.EndpointId,
        uri.AbsoluteUri,
        destination.ServerCertificateSha256,
        destination.VaultReferenceId,
        destination.HeaderPrefix));
    return entry;
  }

  public EgressDestinationPolicyEntryV1 ResolveByScope(
    string capabilityId,
    string destinationScopeSha256)
  {
    var matches = _endpoints.Values.Where(entry => string.Equals(
        entry.CapabilityId,
        capabilityId,
        StringComparison.Ordinal)
      && FixedTimeHex(entry.DestinationScopeSha256, destinationScopeSha256)).ToArray();
    return matches.Length == 1
      ? matches[0]
      : throw new InvalidDataException("The exact egress destination scope is ambiguous.");
  }

  public static string ExactRequestPolicySha256(
    EgressDestinationPolicyEntryV1 entry,
    string argumentsSha256,
    string expectedPreStateSha256,
    string idempotencyKeySha256,
    string requestBodySha256) => PayloadDigest.Sha256Hex(string.Join('\n',
      "MSAIDIZI-EGRESS-EXACT-REQUEST-POLICY-V1",
      entry.CapabilityId,
      entry.EndpointId,
      entry.DestinationHost,
      entry.DestinationPort.ToString(CultureInfo.InvariantCulture),
      entry.DestinationPathAndQuery,
      entry.ServerCertificateSha256Pin,
      entry.CredentialReferenceId,
      entry.CredentialRecordSha256,
      entry.CredentialPrefix,
      entry.DestinationScopeSha256,
      argumentsSha256,
      expectedPreStateSha256,
      idempotencyKeySha256,
      requestBodySha256));

  public static EgressDestinationPolicy Load(string path)
  {
    if (string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path))
    {
      throw new InvalidDataException("The egress destination-policy path is not absolute.");
    }

    var bytes = File.ReadAllBytes(path);
    try
    {
      return new EgressDestinationPolicy(
        JsonSerializer.Deserialize<EgressDestinationPolicyV1>(bytes, StrictJson)
          ?? throw new InvalidDataException("The egress destination policy is empty."));
    }
    catch (JsonException exception)
    {
      throw new InvalidDataException("The egress destination policy is malformed.", exception);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(bytes);
    }
  }

  private static string ComputeSha256(EgressDestinationPolicyV1 policy)
  {
    var fields = new List<string>
    {
      Domain,
      policy.ContractVersion.ToString(CultureInfo.InvariantCulture),
      Field(policy.PolicyId),
    };
    fields.AddRange(policy.Entries.Select(CanonicalEntry));
    if (policy.DynamicDestinations is { } dynamic)
    {
      fields.Add("dynamic-destinations-v1");
      fields.Add(dynamic.Enabled ? "1" : "0");
      fields.Add(Field(dynamic.CredentialMode));
      fields.Add(dynamic.MaximumPathAndQueryLength.ToString(CultureInfo.InvariantCulture));
      fields.Add(dynamic.MaximumRequestBodyBytes.ToString(CultureInfo.InvariantCulture));
      fields.Add(dynamic.MaximumCredentialPrefixLength.ToString(CultureInfo.InvariantCulture));
      fields.AddRange(dynamic.CapabilityIds.Select(Field));
      fields.Add("dynamic-ports");
      fields.AddRange(dynamic.AllowedPorts.Select(port =>
        port.ToString(CultureInfo.InvariantCulture)));
    }
    var bytes = Encoding.UTF8.GetBytes(string.Join('\n', fields));
    try
    {
      return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }
    finally
    {
      CryptographicOperations.ZeroMemory(bytes);
    }
  }

  private static string CanonicalEntry(EgressDestinationPolicyEntryV1 entry) => string.Join('\n',
    Field(entry.EndpointId),
    Field(entry.CapabilityId),
    Field(entry.DestinationHost),
    entry.DestinationPort.ToString(CultureInfo.InvariantCulture),
    Field(entry.DestinationPathAndQuery),
    Field(entry.ServerCertificateSha256Pin),
    Field(entry.CredentialReferenceId),
    Field(entry.CredentialRecordSha256),
    Field(entry.CredentialPrefix),
    Field(entry.DestinationScopeSha256));

  private static string Field(string value) => $"{Encoding.UTF8.GetByteCount(value)}:{value}";

  private static string? CanonicalHost(string value)
  {
    if (string.IsNullOrWhiteSpace(value)
      || value.Length > 253
      || value.Any(character => char.IsControl(character) || char.IsWhiteSpace(character)))
    {
      return null;
    }

    try
    {
      var host = new UriBuilder(Uri.UriSchemeHttps, value).Uri.IdnHost
        .TrimEnd('.').ToLowerInvariant();
      return host.Length is >= 1 and <= 253
        && host.All(character => char.IsAsciiLetterOrDigit(character)
          || character is '.' or '-' or ':')
          ? host
          : null;
    }
    catch (UriFormatException)
    {
      return null;
    }
  }

  private static bool IsSafeId(string value, int maximumLength) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= maximumLength
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_' or ':');

  private static bool IsSafePathAndQuery(string value) => value.Length is >= 1 and <= 2_048
    && value[0] == '/'
    && !value.Contains('\\')
    && !value.Contains('#')
    && value.All(character => character <= 0x7f && !char.IsControl(character));

  private static bool IsSafeCredentialPrefix(string value) => value.Length <= 64
    && value.All(character => character is >= ' ' and <= '~')
    && !value.Contains('\r')
    && !value.Contains('\n');

  private static EgressDynamicDestinationPolicyV1? CanonicalDynamicPolicy(
    EgressDynamicDestinationPolicyV1? value)
  {
    if (value is null)
    {
      return null;
    }
    var capabilities = value.CapabilityIds
      .Distinct(StringComparer.Ordinal)
      .Order(StringComparer.Ordinal)
      .ToArray();
    var ports = value.AllowedPorts.Distinct().Order().ToArray();
    if (!value.Enabled
      || capabilities.Length is < 1 or > 32
      || capabilities.Length != value.CapabilityIds.Count
      || capabilities.Any(capability => !SupportedDynamicCapabilities.Contains(capability))
      || ports.Length is < 1 or > 16
      || ports.Length != value.AllowedPorts.Count
      || ports.Any(port => port is < 1 or > 65_535)
      || value.MaximumPathAndQueryLength is < 1 or > 2_048
      || value.MaximumRequestBodyBytes is < 1 or > 1_048_576
      || value.CredentialMode != "vault-reference-required"
      || value.MaximumCredentialPrefixLength is < 0 or > 64)
    {
      throw new InvalidDataException("The dynamic egress destination policy is invalid.");
    }
    return value with { CapabilityIds = capabilities, AllowedPorts = ports };
  }

  private static string ComputeDestinationScopeSha256(
    EgressDestinationPolicyEntryV1 entry)
  {
    var host = entry.DestinationHost.Contains(':', StringComparison.Ordinal)
      ? $"[{entry.DestinationHost}]"
      : entry.DestinationHost;
    var authority = entry.DestinationPort == 443
      ? host
      : $"{host}:{entry.DestinationPort.ToString(CultureInfo.InvariantCulture)}";
    return EgressExternalActionCanonical.DestinationScopeSha256(
      entry.CapabilityId,
      entry.EndpointId,
      $"https://{authority}{entry.DestinationPathAndQuery}",
      entry.ServerCertificateSha256Pin,
      entry.CredentialReferenceId,
      entry.CredentialPrefix);
  }

  private static bool IsCanonicalSha256(string value) =>
    PayloadDigest.IsSha256Hex(value)
    && string.Equals(value, value.ToLowerInvariant(), StringComparison.Ordinal);

  private sealed record DestinationKey(
    string CapabilityId,
    string DestinationHost,
    int DestinationPort,
    string DestinationScopeSha256)
  {
    public static DestinationKey From(EgressDestinationPolicyEntryV1 entry) => new(
      entry.CapabilityId,
      entry.DestinationHost,
      entry.DestinationPort,
      entry.DestinationScopeSha256);
  }

  private sealed record EndpointKey(string CapabilityId, string EndpointId);

  private static bool FixedTimeHex(string left, string right)
  {
    if (!IsCanonicalSha256(left) || !IsCanonicalSha256(right))
    {
      return false;
    }
    var leftBytes = Convert.FromHexString(left);
    var rightBytes = Convert.FromHexString(right);
    try
    {
      return CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(leftBytes);
      CryptographicOperations.ZeroMemory(rightBytes);
    }
  }
}
