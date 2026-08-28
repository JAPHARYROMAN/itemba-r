using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.EgressSupervisor.Core;

public interface IEgressDestinationResolver
{
  ValueTask<ResolvedPublicDestination> ResolvePublicAsync(
    string destinationHost,
    CancellationToken cancellationToken);
}

public sealed record ResolvedPublicDestination(
  IReadOnlyList<IPAddress> Addresses,
  string AnswerSetSha256)
{
  public ResolvedPublicDestination(IReadOnlyList<IPAddress> addresses)
    : this(addresses, EgressRouteAttestation.AnswerSetSha256(addresses))
  {
  }
}

/// <summary>
/// Produces privacy-preserving route evidence. Only these digests are durable;
/// the canonical address tokens and raw DNS answers remain process-local.
/// </summary>
public static class EgressRouteAttestation
{
  private const string AnswerSetDomain = "MSAIDIZI-EGRESS-DNS-ANSWER-SET-V1";
  private const string SelectedAddressDomain = "MSAIDIZI-EGRESS-SELECTED-ADDRESS-V1";

  public static ResolvedPublicDestination Create(IEnumerable<IPAddress> addresses)
  {
    var normalized = NormalizePublic(addresses);
    return new ResolvedPublicDestination(
      normalized.Select(value => value.Address).ToArray(),
      AnswerSetSha256(normalized));
  }

  public static string AnswerSetSha256(IEnumerable<IPAddress> addresses) =>
    AnswerSetSha256(NormalizePublic(addresses));

  private static (IPAddress Address, string Token)[] NormalizePublic(
    IEnumerable<IPAddress> addresses)
  {
    ArgumentNullException.ThrowIfNull(addresses);
    var normalized = addresses
      .Select(Normalize)
      .Select(address => (Address: address, Token: Token(address)))
      .DistinctBy(value => value.Token, StringComparer.Ordinal)
      .OrderBy(value => value.Token, StringComparer.Ordinal)
      .ToArray();
    if (normalized.Length == 0
      || normalized.Any(value => !PublicNetworkDestinationPolicy.IsPublicAddress(
        value.Address)))
    {
      throw new InvalidDataException("egress_dynamic_destination_address_denied");
    }

    return normalized;
  }

  private static string AnswerSetSha256(
    IReadOnlyCollection<(IPAddress Address, string Token)> normalized)
  {
    var canonical = string.Join('\n',
      new[] { AnswerSetDomain, normalized.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) }
        .Concat(normalized.Select(value => value.Token)));
    return Digest(canonical);
  }

  public static string SelectedAddressSha256(IPAddress address)
  {
    var normalized = Normalize(address);
    if (!PublicNetworkDestinationPolicy.IsPublicAddress(normalized))
    {
      throw new InvalidDataException("egress_selected_destination_address_denied");
    }
    return Digest(string.Join('\n', SelectedAddressDomain, Token(normalized)));
  }

  private static IPAddress Normalize(IPAddress address)
  {
    ArgumentNullException.ThrowIfNull(address);
    var normalized = address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address;
    return normalized.AddressFamily is AddressFamily.InterNetwork
      or AddressFamily.InterNetworkV6
        ? normalized
        : throw new InvalidDataException("egress_destination_address_family_denied");
  }

  private static string Token(IPAddress address) =>
    (address.AddressFamily == AddressFamily.InterNetwork ? "4:" : "6:")
      + Convert.ToHexString(address.GetAddressBytes()).ToLowerInvariant();

  private static string Digest(string canonical)
  {
    var bytes = Encoding.UTF8.GetBytes(canonical);
    try
    {
      return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }
    finally
    {
      CryptographicOperations.ZeroMemory(bytes);
    }
  }
}

/// <summary>
/// Resolves every A/AAAA answer and rejects the complete set if even one
/// address is not public. Connection-time resolution is repeated by the
/// outbound connection owner immediately before it connects. The current
/// returned answer set is canonicalized and accompanied by a digest so the
/// reservation and connection-time resolutions can be durably compared.
/// </summary>
public sealed class DnsEgressDestinationResolver : IEgressDestinationResolver
{
  public async ValueTask<ResolvedPublicDestination> ResolvePublicAsync(
    string destinationHost,
    CancellationToken cancellationToken)
  {
    if (!PublicNetworkDestinationPolicy.IsPublicHost(destinationHost))
    {
      throw new InvalidDataException("egress_dynamic_destination_host_denied");
    }

    IPAddress[] addresses;
    try
    {
      addresses = IPAddress.TryParse(destinationHost, out var literal)
        ? [literal]
        : await Dns.GetHostAddressesAsync(destinationHost, cancellationToken)
          .ConfigureAwait(false);
    }
    catch (Exception exception) when (exception is SocketException or ArgumentException)
    {
      throw new InvalidDataException("egress_dynamic_destination_resolution_failed", exception);
    }

    return EgressRouteAttestation.Create(addresses);
  }
}
