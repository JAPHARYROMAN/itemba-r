using System.Net;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class PublicNetworkDestinationPolicyTests
{
  [Theory]
  [InlineData("https://api.itemba.com/v1/send", true)]
  [InlineData("https://api.itemba.com/v1/send?format=json", true)]
  [InlineData("https://xn--bcher-kva.de/v1/send", true)]
  [InlineData("HTTPS://API.ITEMBA.COM/v1/send", false)]
  [InlineData("https://api.itemba.com:443/v1/send", false)]
  [InlineData("https://api.itemba.com/a/../v1/send", false)]
  [InlineData("https://api.itemba.com/%2e%2e/v1/send", false)]
  [InlineData("https://api.itemba.com/%7euser", false)]
  [InlineData("https://api.itemba.example/v1/send", false)]
  [InlineData("https://bücher.de/v1/send", false)]
  public void HttpsUriRequiresOneExactCanonicalSignedSpelling(string value, bool expected)
  {
    var accepted = PublicNetworkDestinationPolicy.TryCanonicalizeHttpsUri(
      value,
      2_048,
      out var canonical);

    Assert.Equal(expected, accepted);
    if (expected)
    {
      Assert.Equal(value, canonical.AbsoluteUri);
    }
  }

  [Theory]
  [InlineData("8.8.8.8", true)]
  [InlineData("1.1.1.1", true)]
  [InlineData("0.0.0.0", false)]
  [InlineData("10.0.0.1", false)]
  [InlineData("100.64.0.1", false)]
  [InlineData("127.0.0.1", false)]
  [InlineData("169.254.169.254", false)]
  [InlineData("172.16.0.1", false)]
  [InlineData("192.0.2.1", false)]
  [InlineData("192.88.99.1", false)]
  [InlineData("192.168.1.1", false)]
  [InlineData("198.18.0.1", false)]
  [InlineData("198.51.100.1", false)]
  [InlineData("203.0.113.1", false)]
  [InlineData("224.0.0.1", false)]
  [InlineData("255.255.255.255", false)]
  [InlineData("2001:4860:4860::8888", true)]
  [InlineData("2606:4700:4700::1111", true)]
  [InlineData("::", false)]
  [InlineData("::1", false)]
  [InlineData("::ffff:10.0.0.1", false)]
  [InlineData("::10.0.0.1", false)]
  [InlineData("64:ff9b::10.0.0.1", false)]
  [InlineData("64:ff9b:1::c000:0201", false)]
  [InlineData("100::1", false)]
  [InlineData("1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", false)]
  [InlineData("2000::1", true)]
  [InlineData("2001::1", false)]
  [InlineData("2001:1ff:ffff::1", false)]
  [InlineData("2000:ffff:ffff::1", true)]
  [InlineData("2001:200::1", true)]
  [InlineData("2001:2::1", false)]
  [InlineData("2001:10::1", false)]
  [InlineData("2001:20::1", false)]
  [InlineData("2001:db8::1", false)]
  [InlineData("2002:0a00:0001::1", false)]
  [InlineData("3fff::1", false)]
  [InlineData("3fff:0fff:ffff::1", false)]
  [InlineData("3fff:1000::1", true)]
  [InlineData("3ffe:ffff::1", true)]
  [InlineData("4000::1", false)]
  [InlineData("8000::1", false)]
  [InlineData("e000::1", false)]
  [InlineData("5f00::1", false)]
  [InlineData("fc00::1", false)]
  [InlineData("fe80::1", false)]
  [InlineData("ff02::1", false)]
  public void AddressClassificationRejectsSpecialAndEmbeddedPrivateRanges(
    string address,
    bool expected)
  {
    Assert.Equal(
      expected,
      PublicNetworkDestinationPolicy.IsPublicAddress(IPAddress.Parse(address)));
  }

  [Theory]
  [InlineData("api.itemba.com", true)]
  [InlineData("localhost", false)]
  [InlineData("metadata.internal", false)]
  [InlineData("printer.local", false)]
  [InlineData("single-label", false)]
  [InlineData("api.itemba.com.", false)]
  public void HostClassificationRequiresCanonicalPublicDnsName(
    string host,
    bool expected)
  {
    Assert.Equal(expected, PublicNetworkDestinationPolicy.IsPublicHost(host));
  }
}
