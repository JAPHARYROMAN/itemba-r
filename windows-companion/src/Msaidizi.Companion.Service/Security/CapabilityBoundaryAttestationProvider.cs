using System.Diagnostics;
using System.Security.Cryptography;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Contracts.SessionBridge;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Security;

public interface ICapabilityBoundaryAttestationProvider
{
  ValueTask<VerifiedCapabilityBoundaryAttestation?> TryAttestAsync(
    CapabilityBoundaryAttestationRequestV1 request,
    CancellationToken cancellationToken);
}

internal sealed class CapabilityBoundaryAttestationProvider(
  IEgressBoundaryClient boundaryClient,
  CapabilityBoundaryAttestationVerifier verifier,
  IOptions<EgressSupervisorClientOptions> clientOptions) :
  ICapabilityBoundaryAttestationProvider
{
  private readonly EgressSupervisorClientOptions _options = clientOptions.Value;

  public async ValueTask<VerifiedCapabilityBoundaryAttestation?> TryAttestAsync(
    CapabilityBoundaryAttestationRequestV1 request,
    CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(request);
    if (!PayloadDigest.IsSha256Hex(_options.ExpectedSupervisorPipeSecuritySha256))
    {
      return null;
    }

    try
    {
      var envelope = await boundaryClient.TryAttestCapabilitiesAsync(
        request,
        cancellationToken).ConfigureAwait(false);
      if (envelope is null)
      {
        return null;
      }

      var required = EgressBoundaryFeatures.RequiredFor(
        request.BrowserExternalEffectsRequested,
        request.EmergencyCommandRequested);
      var verified = verifier.Verify(
        envelope,
        new CapabilityBoundaryAttestationExpectation(
          request,
          CapabilityBoundaryAttestationContract.RequiredSupervisorServiceSid,
          _options.ExpectedSupervisorPipeSecuritySha256,
          required));
      return verified.IsValid ? verified.Value : null;
    }
    catch (Exception exception) when (exception is IOException
      or InvalidDataException
      or InvalidOperationException
      or UnauthorizedAccessException
      or CryptographicException
      or TimeoutException)
    {
      return null;
    }
  }
}

public static class CapabilityBoundaryStartupRequest
{
  public static CapabilityBoundaryAttestationRequestV1 ForCurrentProcess(
    string deviceId,
    string destinationPolicySha256,
    bool browserExternalEffectsRequested,
    bool emergencyCommandRequested,
    int egressSupervisorProtocolVersion,
    TimeProvider? timeProvider = null)
  {
    if (!browserExternalEffectsRequested && !emergencyCommandRequested)
    {
      throw new ArgumentException(
        "A capability-boundary request must name at least one external effect.");
    }

    using var process = Process.GetCurrentProcess();
    var processPath = Environment.ProcessPath
      ?? throw new InvalidOperationException("The current process image is unavailable.");
    using var image = new FileStream(
      processPath,
      FileMode.Open,
      FileAccess.Read,
      FileShare.Read,
      16_384,
      FileOptions.SequentialScan);
    var imageSha256 = Convert.ToHexString(SHA256.HashData(image)).ToLowerInvariant();
    var nonce = RandomNumberGenerator.GetBytes(32);
    try
    {
      return new CapabilityBoundaryAttestationRequestV1(
        CapabilityBoundaryAttestationContract.Version,
        Guid.NewGuid().ToString("D"),
        Convert.ToHexString(SHA256.HashData(nonce)).ToLowerInvariant(),
        deviceId,
        CapabilityBoundaryAttestationContract.CompanionServiceRole,
        process.Id,
        new DateTimeOffset(process.StartTime.ToUniversalTime())
          .ToUnixTimeMilliseconds(),
        imageSha256,
        browserExternalEffectsRequested,
        emergencyCommandRequested,
        StandardUserCapabilityCatalog.RequestedManifestSha256(
          browserExternalEffectsRequested,
          emergencyCommandRequested),
        destinationPolicySha256,
        CapabilityBoundaryAttestationContract.CapabilityCatalogVersion,
        EgressBoundaryCanonical.ContractVersion,
        egressSupervisorProtocolVersion,
        SessionBridgeProtocol.Version,
        (timeProvider ?? TimeProvider.System).GetUtcNow().ToUnixTimeMilliseconds());
    }
    finally
    {
      CryptographicOperations.ZeroMemory(nonce);
    }
  }
}

internal static class CapabilityBoundaryProgramBootstrap
{
  public static async ValueTask<VerifiedCapabilityBoundaryAttestation?>
    TryResolveAsync(
      IConfiguration configuration,
      CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(configuration);
    var session = configuration.GetSection(SessionBridgeOptions.SectionName)
      .Get<SessionBridgeOptions>() ?? new SessionBridgeOptions();
    if (!session.Enabled
      || (!session.BrowserExternalEffectsEnabled && !session.EmergencyCommandEnabled))
    {
      return null;
    }

    try
    {
      var companion = configuration.GetSection(CompanionOptions.SectionName)
        .Get<CompanionOptions>() ?? new CompanionOptions();
      var clientOptions = configuration.GetSection(EgressSupervisorClientOptions.SectionName)
        .Get<EgressSupervisorClientOptions>() ?? new EgressSupervisorClientOptions();
      var trust = configuration.GetSection(EgressAttestationTrustOptions.SectionName)
        .Get<EgressAttestationTrustOptions>() ?? new EgressAttestationTrustOptions();
      var broker = configuration.GetSection(BrokerChannelOptions.SectionName)
        .Get<BrokerChannelOptions>() ?? new BrokerChannelOptions();
      var boundaryClient = EgressBoundaryClientFactory.Create(
        Options.Create(clientOptions),
        Options.Create(companion),
        Options.Create(trust));
      IEgressAttestationKeyResolver keys = trust.Enabled
        ? new CertificateStoreEgressAttestationKeyResolver(trust, broker)
        : new RejectingEgressAttestationKeyResolver();
      var replay = new InMemoryCapabilityBoundaryAttestationReplayGuard();
      var verifier = new CapabilityBoundaryAttestationVerifier(
        companion.DeviceId,
        TimeSpan.FromSeconds(30),
        TimeSpan.FromSeconds(120),
        keys,
        replay);
      var provider = new CapabilityBoundaryAttestationProvider(
        boundaryClient,
        verifier,
        Options.Create(clientOptions));
      var request = CapabilityBoundaryStartupRequest.ForCurrentProcess(
        companion.DeviceId,
        companion.EgressDestinationPolicySha256,
        session.BrowserExternalEffectsEnabled,
        session.EmergencyCommandEnabled,
        clientOptions.ProtocolVersion);
      return await provider.TryAttestAsync(request, cancellationToken)
        .ConfigureAwait(false);
    }
    catch (Exception exception) when (exception is ArgumentException
      or InvalidOperationException
      or IOException
      or UnauthorizedAccessException
      or CryptographicException
      or NotSupportedException)
    {
      return null;
    }
  }
}
