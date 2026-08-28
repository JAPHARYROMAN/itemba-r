using System.Security.Cryptography;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Contracts.SessionBridge;
using Itemba.Msaidizi.Companion.Service.Security;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class CapabilityBoundaryAttestationTests : IDisposable
{
  private static readonly DateTimeOffset Now = DateTimeOffset.UtcNow;
  private readonly ECDsa _key = ECDsa.Create(ECCurve.NamedCurves.nistP256);

  [Fact]
  public void FreshPurposeBoundCommandEvidenceEnablesOnlyRequestedSurface()
  {
    var request = Request(browser: false, command: true);
    var verifier = Verifier(Now);
    var verified = verifier.Verify(
      Sign(request, Now, Now.AddMinutes(1)),
      Expectation(request));

    Assert.True(verified.IsValid, verified.ErrorCode);
    var enabled = StandardUserCapabilityCatalog.SelectEnabled(
      browserExternalEffectsEnabled: false,
      emergencyCommandEnabled: true,
      verified.Value);
    Assert.Contains(enabled, descriptor =>
      descriptor.Id == StandardUserCapabilityCatalog.EmergencyCommandExecute.Id);
    Assert.DoesNotContain(enabled, descriptor =>
      descriptor.Id == StandardUserCapabilityCatalog.BrowserNavigate.Id);
  }

  [Fact]
  public void StaleMismatchedAndReplayedEvidenceFailsClosed()
  {
    var request = Request(browser: false, command: true);
    var signed = Sign(request, Now, Now.AddMinutes(1));
    var stale = Verifier(Now.AddMinutes(2)).Verify(signed, Expectation(request));
    Assert.Equal("capability_boundary_attestation_stale", stale.ErrorCode);

    var mismatched = Verifier(Now).Verify(
      signed,
      Expectation(request with { SubjectProcessId = request.SubjectProcessId + 1 }));
    Assert.Equal("capability_boundary_attestation_binding_invalid", mismatched.ErrorCode);

    var replayVerifier = Verifier(Now);
    Assert.True(replayVerifier.Verify(signed, Expectation(request)).IsValid);
    var replay = replayVerifier.Verify(signed, Expectation(request));
    Assert.Equal("capability_boundary_attestation_replayed", replay.ErrorCode);
  }

  [Fact]
  public void BothEffectsBindTheSortedFeatureUnionAndRequireBrowserEvidence()
  {
    var required = EgressBoundaryFeatures.RequiredFor(
      browserExternalEffects: true,
      emergencyCommand: true);

    Assert.Equal(EgressBoundaryFeatures.BrowserRequired, required);
    Assert.All(EgressBoundaryFeatures.CommandRequired, feature =>
      Assert.Contains(feature, required));

    var request = Request(browser: true, command: true);
    var commandOnly = Sign(
      request,
      Now,
      Now.AddMinutes(1),
      EgressBoundaryFeatures.CommandRequired,
      browserBrokerBuildSha256: null);
    Assert.Equal(
      "capability_boundary_attestation_binding_invalid",
      Verifier(Now).Verify(commandOnly, Expectation(request)).ErrorCode);
  }

  [Fact]
  public void EmergencyActivationCannotOmitCommandFeatures()
  {
    var request = Request(browser: false, command: true);
    var invalid = Sign(
      request,
      Now,
      Now.AddMinutes(1),
      [EgressBoundaryFeatures.NetworkEgressEnforced]);

    Assert.Equal(
      "capability_boundary_attestation_binding_invalid",
      Verifier(Now).Verify(invalid, Expectation(request)).ErrorCode);
  }

  [Fact]
  public void ServiceActivationStateWithdrawsOnExpiryOrSupervisorLoss()
  {
    var request = Request(browser: false, command: true);
    var fresh = Verifier(Now).Verify(
      Sign(request, Now, Now.AddMinutes(1)),
      Expectation(request)).Value!;
    var state = new CapabilityBoundaryActivationState(
      browserExternalEffectsRequested: false,
      emergencyCommandRequested: true,
      fresh);
    Assert.True(state.IsCapabilityAvailable(
      StandardUserCapabilityCatalog.EmergencyCommandExecute));

    state.Replace(null);
    Assert.False(state.IsCapabilityAvailable(
      StandardUserCapabilityCatalog.EmergencyCommandExecute));

    var expired = Verifier(Now.Subtract(TimeSpan.FromSeconds(90))).Verify(
      Sign(request, Now.Subtract(TimeSpan.FromMinutes(2)),
        Now.Subtract(TimeSpan.FromMinutes(1))),
      Expectation(request)).Value!;
    state.Replace(expired);
    Assert.False(state.IsCapabilityAvailable(
      StandardUserCapabilityCatalog.EmergencyCommandExecute));
  }

  public void Dispose() => _key.Dispose();

  private CapabilityBoundaryAttestationVerifier Verifier(DateTimeOffset now) => new(
    DeviceId,
    TimeSpan.FromSeconds(1),
    TimeSpan.FromMinutes(2),
    new StaticKeyResolver(_key),
    new InMemoryCapabilityBoundaryAttestationReplayGuard(new FixedTimeProvider(now)),
    new FixedTimeProvider(now));

  private SignedCapabilityBoundaryAttestation Sign(
    CapabilityBoundaryAttestationRequestV1 request,
    DateTimeOffset issuedAt,
    DateTimeOffset expiresAt,
    IReadOnlyList<string>? features = null,
    string? browserBrokerBuildSha256 = null)
  {
    var enabledFeatures = (features ?? EgressBoundaryFeatures.RequiredFor(
        request.BrowserExternalEffectsRequested,
        request.EmergencyCommandRequested))
      .Order(StringComparer.Ordinal)
      .ToArray();
    var attestation = new CapabilityBoundaryAttestationV1(
      CapabilityBoundaryAttestationContract.Version,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      request.RequestId,
      request.RequestNonceSha256,
      request.DeviceId,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      request.SubjectRole,
      request.SubjectProcessId,
      request.SubjectProcessCreationTimeUnixMilliseconds,
      request.SubjectImageSha256,
      request.BrowserExternalEffectsRequested,
      request.EmergencyCommandRequested,
      request.CapabilityManifestSha256,
      request.DestinationPolicySha256,
      request.CapabilityCatalogVersion,
      request.EgressBoundaryContractVersion,
      request.EgressSupervisorProtocolVersion,
      request.SessionBridgeProtocolVersion,
      CapabilityBoundaryAttestationContract.RequiredSupervisorServiceSid,
      PipeSecuritySha256,
      SecureBootEnabled: true,
      HvciEnabled: true,
      DriverActive: true,
      ServiceActive: true,
      new string('4', 64),
      new string('5', 64),
      browserBrokerBuildSha256,
      enabledFeatures,
      issuedAt.ToUnixTimeMilliseconds(),
      expiresAt.ToUnixTimeMilliseconds());
    return CapabilityBoundaryAttestationCanonical.Sign(attestation, KeyId, _key);
  }

  private static CapabilityBoundaryAttestationExpectation Expectation(
    CapabilityBoundaryAttestationRequestV1 request) => new(
      request,
      CapabilityBoundaryAttestationContract.RequiredSupervisorServiceSid,
      PipeSecuritySha256,
      EgressBoundaryFeatures.RequiredFor(
        request.BrowserExternalEffectsRequested,
        request.EmergencyCommandRequested));

  private static CapabilityBoundaryAttestationRequestV1 Request(
    bool browser,
    bool command) => new(
      CapabilityBoundaryAttestationContract.Version,
      "99999999-9999-4999-8999-999999999999",
      new string('1', 64),
      DeviceId,
      CapabilityBoundaryAttestationContract.SessionAgentRole,
      4_242,
      1_700_000_000_000,
      new string('2', 64),
      browser,
      command,
      StandardUserCapabilityCatalog.RequestedManifestSha256(browser, command),
      new string('3', 64),
      CapabilityBoundaryAttestationContract.CapabilityCatalogVersion,
      EgressBoundaryCanonical.ContractVersion,
      2,
      SessionBridgeProtocol.Version,
      Now.ToUnixTimeMilliseconds());

  private sealed class StaticKeyResolver : IEgressAttestationKeyResolver
  {
    private readonly byte[] _spki;

    public StaticKeyResolver(ECDsa key) => _spki = key.ExportSubjectPublicKeyInfo();

    public bool TryResolve(string keyId, out ECDsa? publicKey)
    {
      publicKey = null;
      if (!string.Equals(keyId, KeyId, StringComparison.Ordinal))
      {
        return false;
      }
      publicKey = ECDsa.Create();
      publicKey.ImportSubjectPublicKeyInfo(_spki, out _);
      return true;
    }
  }

  private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
  {
    public override DateTimeOffset GetUtcNow() => now;
  }

  private const string DeviceId = "11111111-1111-4111-8111-111111111111";
  private const string KeyId = "activation-test-key";
  private const string PipeSecuritySha256 =
    "6666666666666666666666666666666666666666666666666666666666666666";
}
