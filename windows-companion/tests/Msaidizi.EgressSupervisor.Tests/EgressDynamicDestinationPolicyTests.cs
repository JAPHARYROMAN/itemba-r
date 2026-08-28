using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.EgressSupervisor.Core;
using Xunit;

namespace Itemba.Msaidizi.EgressSupervisor.Tests;

public sealed class EgressDynamicDestinationPolicyTests
{
  private const string Capability = "external.email.send";
  private const string VaultReference = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  [Fact]
  public void ExplicitDynamicPolicyResolvesOneExactPublicHttpsDestination()
  {
    var policy = Policy();
    var destination = Destination("https://api.itemba.com/v1/email/send");

    var resolved = policy.Resolve(Capability, destination);

    Assert.Equal("api.itemba.com", resolved.DestinationHost);
    Assert.Equal(443, resolved.DestinationPort);
    Assert.Equal("/v1/email/send", resolved.DestinationPathAndQuery);
    Assert.Equal(destination.ServerCertificateSha256, resolved.ServerCertificateSha256Pin);
    Assert.Equal(destination.VaultReferenceId, resolved.CredentialReferenceId);
    Assert.Equal(destination.VaultRecordSha256, resolved.CredentialRecordSha256);
    Assert.Equal(destination.HeaderPrefix, resolved.CredentialPrefix);
    Assert.True(policy.AllowsDynamicRequestBody(Capability, 64 * 1_024));
    Assert.False(policy.AllowsDynamicRequestBody(Capability, 64 * 1_024 + 1));
  }

  [Theory]
  [InlineData("https://127.0.0.1/v1/send")]
  [InlineData("https://10.0.0.5/v1/send")]
  [InlineData("https://[::1]/v1/send")]
  [InlineData("https://metadata.internal/v1/send")]
  [InlineData("http://api.itemba.com/v1/send")]
  [InlineData("file:///C:/Windows/win.ini")]
  public void DynamicPolicyIndependentlyRejectsSsrFDestinations(string uri)
  {
    var policy = Policy();

    Assert.Throws<InvalidDataException>(() => policy.Resolve(Capability, Destination(uri)));
  }

  [Fact]
  public void StaticEndpointCompatibilityDoesNotImplyDynamicAuthority()
  {
    var staticPolicy = new EgressDestinationPolicy(new EgressDestinationPolicyV1(
      1,
      "static-only",
      [StaticEntry()]));

    Assert.Equal("email-static", staticPolicy.Resolve(Capability, "email-static").EndpointId);
    Assert.Throws<InvalidDataException>(() =>
      staticPolicy.Resolve(Capability, Destination("https://api.itemba.com/v1/email/send")));
  }

  [Theory]
  [InlineData("browser.uri.open")]
  [InlineData("external.unreviewed.send")]
  public void DynamicPolicyCannotAdvertiseAnUnimplementedCapability(string capability)
  {
    Assert.Throws<InvalidDataException>(() => new EgressDestinationPolicy(
      new EgressDestinationPolicyV1(
        1,
        "invalid-dynamic-capability",
        [],
        new EgressDynamicDestinationPolicyV1(
          true,
          [capability],
          [443],
          512,
          64 * 1_024,
          "vault-reference-required",
          16))));
  }

  [Fact]
  public void DynamicPolicyRejectsDuplicateCapabilitiesAndPorts()
  {
    Assert.Throws<InvalidDataException>(() => new EgressDestinationPolicy(
      new EgressDestinationPolicyV1(
        1,
        "duplicate-dynamic-policy",
        [],
        new EgressDynamicDestinationPolicyV1(
          true,
          [Capability, Capability],
          [443, 443],
          512,
          64 * 1_024,
          "vault-reference-required",
          16))));
  }

  private static EgressDestinationPolicy Policy() => new(new EgressDestinationPolicyV1(
    1,
    "dynamic-test",
    [],
    new EgressDynamicDestinationPolicyV1(
      Enabled: true,
      CapabilityIds: [Capability],
      AllowedPorts: [443],
      MaximumPathAndQueryLength: 512,
      MaximumRequestBodyBytes: 64 * 1_024,
      CredentialMode: "vault-reference-required",
      MaximumCredentialPrefixLength: 16)));

  private static ExactExternalActionDestination Destination(string uri) => new(
    EgressExternalActionCanonical.DynamicHttpsAuthority,
    "dynamic-email",
    uri,
    new string('b', 64),
    VaultReference,
    new string('9', 64),
    "Bearer ");

  private static EgressDestinationPolicyEntryV1 StaticEntry()
  {
    var scope = EgressExternalActionCanonical.DestinationScopeSha256(
      Capability,
      "email-static",
      "https://api.example.test/v1/email/send",
      new string('b', 64),
      VaultReference,
      "Bearer ");
    return new EgressDestinationPolicyEntryV1(
      "email-static",
      Capability,
      "api.example.test",
      443,
      "/v1/email/send",
      new string('b', 64),
      VaultReference,
      new string('9', 64),
      "Bearer ",
      scope);
  }
}
