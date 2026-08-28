using System.Net;
using System.Globalization;

namespace Itemba.Msaidizi.Companion.Contracts.Security;

/// <summary>
/// Canonical, deployment-wide network destination floor shared by governed
/// external-action preparation and the independent egress supervisor. Browser
/// automation remains limited to deployment-configured static origins until a
/// separate live-origin boundary exists. Dynamic external authority can narrow
/// this policy, but cannot admit non-HTTPS or non-public destinations.
/// </summary>
public static class PublicNetworkDestinationPolicy
{
  private static readonly string[] ProhibitedHostSuffixes =
  [
    ".arpa",
    ".corp",
    ".example",
    ".home",
    ".internal",
    ".invalid",
    ".lan",
    ".local",
    ".localhost",
    ".onion",
    ".test",
  ];

  public static bool TryCanonicalizeHttpsUri(
    string value,
    int maximumLength,
    out Uri canonical)
  {
    canonical = null!;
    if (string.IsNullOrWhiteSpace(value)
      || value.Length > maximumLength
      || value.Contains('\\')
      || value.Any(character => char.IsControl(character)))
    {
      return false;
    }

    if (!Uri.TryCreate(value, UriKind.Absolute, out var parsed)
      || !string.Equals(parsed.Scheme, Uri.UriSchemeHttps, StringComparison.Ordinal)
      || string.IsNullOrEmpty(parsed.IdnHost)
      || !string.IsNullOrEmpty(parsed.UserInfo)
      || !string.IsNullOrEmpty(parsed.Fragment)
      || !IsPublicHost(parsed.IdnHost)
      || parsed.Port is < 1 or > 65_535)
    {
      return false;
    }

    var pathAndQuery = parsed.PathAndQuery;
    if (pathAndQuery.Length is < 1 or > 2_048
      || pathAndQuery[0] != '/'
      || pathAndQuery.Contains('\\')
      || pathAndQuery.Contains('#')
      || pathAndQuery.Any(character => character > 0x7f || char.IsControl(character)))
    {
      return false;
    }

    var host = parsed.IdnHost.ToLowerInvariant();
    var builder = new UriBuilder(Uri.UriSchemeHttps, host, parsed.Port)
    {
      Path = parsed.AbsolutePath,
      Query = parsed.Query.Length > 0 ? parsed.Query[1..] : string.Empty,
      Fragment = string.Empty,
      UserName = string.Empty,
      Password = string.Empty,
    };
    canonical = builder.Uri;
    // Uri canonicalizes case, default ports, dot segments, IDN hosts, and
    // percent-encoded unreserved characters while parsing. Compare the signed
    // raw value with the one canonical representation, not with another Uri
    // projection, so equivalent spellings cannot produce different argument
    // digests for the same network authority.
    return string.Equals(canonical.AbsoluteUri, value, StringComparison.Ordinal);
  }

  public static bool TryCanonicalizeHttpsOrigin(string value, out Uri canonical)
  {
    canonical = null!;
    if (!TryCanonicalizeHttpsUri(value, 2_048, out var parsed)
      || parsed.AbsolutePath != "/"
      || !string.IsNullOrEmpty(parsed.Query))
    {
      return false;
    }
    canonical = parsed;
    return true;
  }

  public static bool IsPublicHost(string value)
  {
    if (string.IsNullOrWhiteSpace(value)
      || value.Length > 253
      || value.EndsWith('.')
      || value.Any(character => char.IsControl(character) || char.IsWhiteSpace(character)))
    {
      return false;
    }

    if (IPAddress.TryParse(value, out var address))
    {
      return IsPublicAddress(address);
    }

    string host;
    try
    {
      host = new IdnMapping().GetAscii(value).ToLowerInvariant();
    }
    catch (ArgumentException)
    {
      return false;
    }

    if (!host.Contains('.')
      || host.Length > 253
      || ProhibitedHostSuffixes.Any(suffix => host.EndsWith(suffix,
        StringComparison.OrdinalIgnoreCase)))
    {
      return false;
    }

    return host.Split('.').All(label => label.Length is >= 1 and <= 63
      && char.IsAsciiLetterOrDigit(label[0])
      && char.IsAsciiLetterOrDigit(label[^1])
      && label.All(character => char.IsAsciiLetterOrDigit(character) || character == '-'));
  }

  public static bool IsPublicAddress(IPAddress value)
  {
    ArgumentNullException.ThrowIfNull(value);
    if (value.IsIPv4MappedToIPv6)
    {
      value = value.MapToIPv4();
    }

    var bytes = value.GetAddressBytes();
    if (bytes.Length == 4)
    {
      var first = bytes[0];
      var second = bytes[1];
      return first is not 0 and not 10 and not 127
        && !(first == 100 && second is >= 64 and <= 127)
        && !(first == 169 && second == 254)
        && !(first == 172 && second is >= 16 and <= 31)
        && !(first == 192 && second == 0)
        && !(first == 192 && second == 31 && bytes[2] == 196)
        && !(first == 192 && second == 52 && bytes[2] == 193)
        && !(first == 192 && second == 88 && bytes[2] == 99)
        && !(first == 192 && second == 175 && bytes[2] == 48)
        && !(first == 192 && second == 168)
        && !(first == 198 && second is 18 or 19)
        && !(first == 198 && second == 51 && bytes[2] == 100)
        && !(first == 203 && second == 0 && bytes[2] == 113)
        && first < 224;
    }

    if (bytes.Length != 16
      || value.Equals(IPAddress.IPv6Any)
      || value.Equals(IPAddress.IPv6Loopback)
      || value.Equals(IPAddress.IPv6None)
      || value.IsIPv6LinkLocal
      || value.IsIPv6Multicast
      || value.IsIPv6SiteLocal)
    {
      return false;
    }

    // Reject address forms that embed or tunnel IPv4 as a whole. Otherwise a
    // syntactically public IPv6 endpoint can be translated into a private IPv4
    // destination below this policy boundary.
    if (Prefix(bytes, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 80)
      || Prefix(bytes, [0x20, 0x02], 16) // 6to4
      || Prefix(bytes, [0x20, 0x01, 0, 0], 32) // Teredo
      || Prefix(bytes, [0, 0x64, 0xff, 0x9b], 32)
      || Prefix(bytes, [0, 0x64, 0xff, 0x9b, 0, 1], 48))
    {
      return false;
    }

    // Only IANA global-unicast space (2000::/3) can pass. Then subtract its
    // documentation, benchmarking, ORCHID, and other special-use prefixes.
    return Prefix(bytes, [0x20], 3)
      && !Prefix(bytes, [0x20, 0x01, 0x00], 23)
      && !Prefix(bytes, [0x20, 0x01, 0x0d, 0xb8], 32)
      && !Prefix(bytes, [0x20, 0x01, 0x00, 0x02], 48)
      && !Prefix(bytes, [0x20, 0x01, 0x00, 0x10], 28)
      && !Prefix(bytes, [0x20, 0x01, 0x00, 0x20], 28)
      && !Prefix(bytes, [0x3f, 0xff, 0x00], 20)
      && !Prefix(bytes, [0x5f, 0x00], 16)
      && !Prefix(bytes, [0x01, 0x00, 0, 0, 0, 0, 0, 0], 64);
  }

  private static bool Prefix(byte[] value, byte[] prefix, int bitCount)
  {
    var completeBytes = bitCount / 8;
    var remainingBits = bitCount % 8;
    if (prefix.Length < completeBytes + (remainingBits == 0 ? 0 : 1)
      || value.Length < completeBytes + (remainingBits == 0 ? 0 : 1))
    {
      return false;
    }
    for (var index = 0; index < completeBytes; index += 1)
    {
      if (value[index] != prefix[index]) return false;
    }
    if (remainingBits == 0) return true;
    var mask = (byte)(0xff << (8 - remainingBits));
    return (value[completeBytes] & mask) == (prefix[completeBytes] & mask);
  }
}
