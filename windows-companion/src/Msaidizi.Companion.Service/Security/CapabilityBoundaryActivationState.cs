using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Security;

internal interface ICapabilityBoundaryActivationState
{
  bool IsCapabilityAvailable(CapabilityDescriptor descriptor);

  VerifiedCapabilityBoundaryAttestation? Current { get; }

  void Replace(VerifiedCapabilityBoundaryAttestation? value);
}

internal sealed class CapabilityBoundaryActivationState(
  bool browserExternalEffectsRequested,
  bool emergencyCommandRequested,
  VerifiedCapabilityBoundaryAttestation? initial = null) :
  ICapabilityBoundaryActivationState
{
  private readonly object _gate = new();
  private VerifiedCapabilityBoundaryAttestation? _current = initial;

  public VerifiedCapabilityBoundaryAttestation? Current
  {
    get
    {
      lock (_gate)
      {
        return _current;
      }
    }
  }

  public bool IsCapabilityAvailable(CapabilityDescriptor descriptor)
  {
    if (!StandardUserCapabilityCatalog.RequiresEgressBoundary(descriptor.Id))
    {
      return true;
    }

    var current = Current;
    try
    {
      return StandardUserCapabilityCatalog.SelectEnabled(
          browserExternalEffectsRequested,
          emergencyCommandRequested,
          current)
        .Any(candidate => string.Equals(candidate.Id, descriptor.Id, StringComparison.Ordinal)
          && string.Equals(
            candidate.Version,
            descriptor.Version,
            StringComparison.Ordinal));
    }
    catch (InvalidOperationException)
    {
      return false;
    }
  }

  public void Replace(VerifiedCapabilityBoundaryAttestation? value)
  {
    lock (_gate)
    {
      _current = value;
    }
  }
}

internal sealed class CapabilityBoundaryActivationRenewalService(
  IOptions<CompanionOptions> companion,
  IOptions<SessionBridgeOptions> session,
  IOptions<EgressSupervisorClientOptions> egress,
  ICapabilityBoundaryAttestationProvider provider,
  ICapabilityBoundaryActivationState state) : BackgroundService
{
  protected override async Task ExecuteAsync(CancellationToken stoppingToken)
  {
    var requested = session.Value.BrowserExternalEffectsEnabled
      || session.Value.EmergencyCommandEnabled;
    while (requested && !stoppingToken.IsCancellationRequested)
    {
      var current = state.Current;
      var now = DateTimeOffset.UtcNow;
      if (current is not null)
      {
        var refreshAt = DateTimeOffset.FromUnixTimeMilliseconds(
          current.SignedAttestation.Attestation.ExpiresAtUnixMilliseconds)
          .Subtract(TimeSpan.FromSeconds(20));
        if (refreshAt > now)
        {
          await Task.Delay(
            TimeSpan.FromMilliseconds(Math.Min(
              (refreshAt - now).TotalMilliseconds,
              TimeSpan.FromSeconds(10).TotalMilliseconds)),
            stoppingToken).ConfigureAwait(false);
          continue;
        }
      }

      var request = CapabilityBoundaryStartupRequest.ForCurrentProcess(
        companion.Value.DeviceId,
        companion.Value.EgressDestinationPolicySha256,
        session.Value.BrowserExternalEffectsEnabled,
        session.Value.EmergencyCommandEnabled,
        egress.Value.ProtocolVersion);
      var replacement = await provider.TryAttestAsync(request, stoppingToken)
        .ConfigureAwait(false);
      state.Replace(replacement);
      await Task.Delay(
        replacement is null ? TimeSpan.FromSeconds(5) : TimeSpan.FromSeconds(1),
        stoppingToken).ConfigureAwait(false);
    }
  }
}
