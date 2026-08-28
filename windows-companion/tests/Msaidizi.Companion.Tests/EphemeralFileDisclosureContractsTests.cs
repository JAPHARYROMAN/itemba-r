using System.Text;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class EphemeralFileDisclosureContractsTests
{
  private static readonly DateTimeOffset FixtureNow = new(
    2030,
    1,
    1,
    0,
    0,
    0,
    TimeSpan.Zero);

  private const string CanonicalFixture =
    "{\"actionId\":\"11111111-1111-4111-8111-111111111111\",\"allowedMimeTypes\":[\"application/pdf\",\"text/plain\"],\"argumentsSha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"capability\":\"filesystem.file.disclose.ephemeral\",\"capabilityVersion\":\"1.0.0\",\"deviceId\":\"22222222-2222-4222-8222-222222222222\",\"expectedFileIdentitySha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"expectedPreStateSha256\":\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\",\"expiresAt\":\"2030-01-01T00:01:00.000Z\",\"idempotencyKey\":\"ephemeral-file-1\",\"issuanceGeneration\":7,\"mandateId\":\"33333333-3333-4333-8333-333333333333\",\"maximumBytes\":524288,\"nonce\":\"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc\",\"planVersionId\":\"44444444-4444-4444-8444-444444444444\",\"protocol\":\"msaidizi-ephemeral-file-disclosure/v1\",\"providerContractArtifactSha256\":\"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd\",\"providerModelId\":\"claude-sonnet-4-5\",\"relativePathSha256\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"rootId\":\"managed\",\"stepId\":\"55555555-5555-4555-8555-555555555555\",\"taskId\":\"66666666-6666-4666-8666-666666666666\"}";
  private const string CanonicalFixtureSha256 =
    "EF8147671CF19E5B242730CADBBE8C0760B73BD8C3435F18919AEED3D0F84724";

  [Fact]
  public void CanonicalBytesMatchBackendVectorAndContainNoPathOrContent()
  {
    var grant = FixtureGrant();

    Assert.Equal(CanonicalFixture, EphemeralFileDisclosureProtocol.CanonicalJson(grant));
    Assert.Equal(CanonicalFixtureSha256, EphemeralFileDisclosureProtocol.Sha256(grant));
    Assert.DoesNotContain("finance/credentials.pdf", CanonicalFixture, StringComparison.Ordinal);
    Assert.DoesNotContain("known-secret-file-canary", CanonicalFixture, StringComparison.Ordinal);
    Assert.DoesNotContain("contentBase64", CanonicalFixture, StringComparison.Ordinal);
  }

  [Fact]
  public void AuthorizesOnlyCanonicalBytesAndExactSignedAuthority()
  {
    var grant = FixtureGrant();
    var parsed = EphemeralFileDisclosureProtocol.ParseAgainstExpectedBinding(
      Encoding.UTF8.GetBytes(CanonicalFixture),
      Expected(grant),
      FixtureNow);

    Assert.Equal(CanonicalFixture, EphemeralFileDisclosureProtocol.CanonicalJson(parsed));
  }

  [Fact]
  public void RejectsEveryTaskPlanStepDevicePathStateProviderNonceAndGenerationDrift()
  {
    var grant = FixtureGrant();
    var otherId = "77777777-7777-4777-8777-777777777777";
    var otherDigest = new string('f', 64);
    var expected = Expected(grant);
    EphemeralFileDisclosureExpectedBinding[] drifted =
    [
      expected with { AllowedMimeTypes = ["text/plain"] },
      expected with { ActionId = otherId },
      expected with { TaskId = otherId },
      expected with { PlanVersionId = otherId },
      expected with { StepId = otherId },
      expected with { DeviceId = otherId },
      expected with { MandateId = otherId },
      expected with { Nonce = Base64Url(new byte[32]) },
      expected with { IdempotencyKey = "ephemeral-file-2" },
      expected with { ArgumentsSha256 = otherDigest },
      expected with { Capability = "filesystem.file.read" },
      expected with { CapabilityVersion = "2.0.0" },
      expected with { ExpectedPreStateSha256 = otherDigest },
      expected with { ExpectedFileIdentitySha256 = otherDigest },
      expected with { RelativePathSha256 = otherDigest },
      expected with { RootId = "other-root" },
      expected with { ProviderContractArtifactSha256 = otherDigest },
      expected with { ProviderModelId = "claude-opus-4-1" },
      expected with { ExpiresAt = "2030-01-01T00:01:01.000Z" },
      expected with { IssuanceGeneration = 8 },
      expected with { MaximumBytes = EphemeralFileDisclosureContract.MaximumBytes - 1 },
    ];

    foreach (var mismatch in drifted)
    {
      var error = Assert.Throws<EphemeralFileDisclosureProtocolException>(() =>
        EphemeralFileDisclosureProtocol.ParseAgainstExpectedBinding(
          Encoding.UTF8.GetBytes(CanonicalFixture),
          mismatch,
          FixtureNow));
      Assert.Equal("EPHEMERAL_FILE_GRANT_BINDING_MISMATCH", error.Code);
    }
  }

  [Fact]
  public void RejectsRawPdfBinaryAndKnownSecretFieldsBeforeAuthorityConsumption()
  {
    const string knownSecret = "known-secret-file-canary-7u3X";
    var pdfBytes = Encoding.UTF8.GetBytes($"%PDF-1.7\n{knownSecret}\n%%EOF");
    var forged = CanonicalFixture[..^1]
      + $",\"contentBase64\":\"{Convert.ToBase64String(pdfBytes)}\"}}";

    var error = Assert.Throws<EphemeralFileDisclosureProtocolException>(() =>
      EphemeralFileDisclosureProtocol.ParseAgainstExpectedBinding(
        Encoding.UTF8.GetBytes(forged),
        Expected(FixtureGrant()),
        FixtureNow));

    Assert.Equal("EPHEMERAL_FILE_GRANT_SHAPE_INVALID", error.Code);
    Assert.DoesNotContain(knownSecret, CanonicalFixture, StringComparison.Ordinal);

    var binaryGrant = FixtureGrant() with { AllowedMimeTypes = ["application/octet-stream"] };
    var binaryError = Assert.Throws<EphemeralFileDisclosureProtocolException>(() =>
      EphemeralFileDisclosureProtocol.ParseAgainstExpectedBinding(
        EphemeralFileDisclosureProtocol.CanonicalBytes(binaryGrant),
        Expected(binaryGrant),
        FixtureNow));
    Assert.Equal("EPHEMERAL_FILE_GRANT_MIME_INVALID", binaryError.Code);
  }

  [Fact]
  public void RejectsNoncanonicalOversizedExpiredAndLongLivedGrants()
  {
    var grant = FixtureGrant();
    var reordered = CanonicalFixture.Replace(
      "{\"actionId\":",
      "{\"taskId\":\"66666666-6666-4666-8666-666666666666\",\"actionId\":",
      StringComparison.Ordinal).Replace(
        ",\"taskId\":\"66666666-6666-4666-8666-666666666666\"}",
        "}",
        StringComparison.Ordinal);
    AssertCode("EPHEMERAL_FILE_GRANT_NONCANONICAL", reordered, Expected(grant));

    var oversized = grant with
    {
      MaximumBytes = EphemeralFileDisclosureContract.MaximumBytes + 1,
    };
    AssertCode(
      "EPHEMERAL_FILE_GRANT_SIZE_INVALID",
      EphemeralFileDisclosureProtocol.CanonicalJson(oversized),
      Expected(oversized));

    AssertCode(
      "EPHEMERAL_FILE_GRANT_EXPIRED",
      CanonicalFixture,
      Expected(grant),
      new DateTimeOffset(2030, 1, 1, 0, 1, 0, TimeSpan.Zero));

    var longLived = grant with { ExpiresAt = "2030-01-01T00:02:01.000Z" };
    AssertCode(
      "EPHEMERAL_FILE_GRANT_LIFETIME_INVALID",
      EphemeralFileDisclosureProtocol.CanonicalJson(longLived),
      Expected(longLived));
  }

  [Fact]
  public void RestartAndReplayStayClosedBecauseProductionPortNeverConsumesAuthority()
  {
    var firstProcess = new RejectingEphemeralFileDisclosurePort();
    var restartedProcess = new RejectingEphemeralFileDisclosurePort();

    Assert.False(firstProcess.Provisioned);
    Assert.False(restartedProcess.Provisioned);
    Assert.Equal(
      RejectingEphemeralFileDisclosurePort.ErrorCode,
      Assert.Throws<EphemeralFileDisclosureProtocolException>(firstProcess.Authorize).Code);
    Assert.Equal(
      RejectingEphemeralFileDisclosurePort.ErrorCode,
      Assert.Throws<EphemeralFileDisclosureProtocolException>(firstProcess.Authorize).Code);
    Assert.Equal(
      RejectingEphemeralFileDisclosurePort.ErrorCode,
      Assert.Throws<EphemeralFileDisclosureProtocolException>(restartedProcess.Authorize).Code);
  }

  private static void AssertCode(
    string code,
    string json,
    EphemeralFileDisclosureExpectedBinding expected,
    DateTimeOffset? now = null)
  {
    var error = Assert.Throws<EphemeralFileDisclosureProtocolException>(() =>
      EphemeralFileDisclosureProtocol.ParseAgainstExpectedBinding(
        Encoding.UTF8.GetBytes(json),
        expected,
        now ?? FixtureNow));
    Assert.Equal(code, error.Code);
  }

  private static EphemeralFileDisclosureGrantV1 FixtureGrant() => new(
    "11111111-1111-4111-8111-111111111111",
    ["application/pdf", "text/plain"],
    new string('a', 64),
    EphemeralFileDisclosureContract.CapabilityId,
    EphemeralFileDisclosureContract.CapabilityVersion,
    "22222222-2222-4222-8222-222222222222",
    new string('b', 64),
    new string('c', 64),
    "2030-01-01T00:01:00.000Z",
    "ephemeral-file-1",
    7,
    "33333333-3333-4333-8333-333333333333",
    EphemeralFileDisclosureContract.MaximumBytes,
    Base64Url(Enumerable.Repeat((byte)7, 32).ToArray()),
    "44444444-4444-4444-8444-444444444444",
    EphemeralFileDisclosureContract.Protocol,
    new string('d', 64),
    "claude-sonnet-4-5",
    new string('e', 64),
    "managed",
    "55555555-5555-4555-8555-555555555555",
    "66666666-6666-4666-8666-666666666666");

  private static EphemeralFileDisclosureExpectedBinding Expected(
    EphemeralFileDisclosureGrantV1 grant) => new(
      grant.ActionId,
      grant.AllowedMimeTypes,
      grant.ArgumentsSha256,
      grant.Capability,
      grant.CapabilityVersion,
      grant.DeviceId,
      grant.ExpectedFileIdentitySha256,
      grant.ExpectedPreStateSha256,
      grant.ExpiresAt,
      grant.IdempotencyKey,
      grant.IssuanceGeneration,
      grant.MandateId,
      grant.MaximumBytes,
      grant.Nonce,
      grant.PlanVersionId,
      grant.ProviderContractArtifactSha256,
      grant.ProviderModelId,
      grant.RelativePathSha256,
      grant.RootId,
      grant.StepId,
      grant.TaskId);

  private static string Base64Url(byte[] value) => Convert.ToBase64String(value)
    .TrimEnd('=')
    .Replace('+', '-')
    .Replace('/', '_');
}
