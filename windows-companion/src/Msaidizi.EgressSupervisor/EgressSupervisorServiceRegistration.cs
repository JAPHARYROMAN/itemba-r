using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.EgressSupervisor.Core;
using Itemba.Msaidizi.EgressSupervisor.Persistence;
using Itemba.Msaidizi.EgressSupervisor.Security;
using Itemba.Msaidizi.EgressSupervisor.Transport;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Itemba.Msaidizi.EgressSupervisor;

public static class EgressSupervisorServiceRegistration
{
  public static IServiceCollection AddEgressSupervisor(
    this IServiceCollection services,
    EgressSupervisorOptions options)
  {
    ArgumentNullException.ThrowIfNull(services);
    ArgumentNullException.ThrowIfNull(options);
    services.AddSingleton(options);
    if (!options.Enabled)
    {
      services.AddHostedService<DisabledEgressSupervisorService>();
      return services;
    }

    services.AddSingleton(_ => EgressDestinationPolicy.Load(
      options.DestinationPolicyPath));
    services.AddSingleton(_ => new DurableEgressJournal(
      options.JournalPath,
      requirePreprovisionedFiles: true,
      protection: new WindowsEgressJournalProtection(options)));
    services.AddSingleton<IActionVerificationKeyResolver>(
      _ => new CertificateStoreActionVerificationKeyResolver(options));
    services.AddSingleton<IActionTokenVerifier>(provider =>
      new Es256ActionTokenVerifier(
        new ActionTokenVerificationSettings(
          options.ExpectedIssuer,
          options.ExpectedAudience,
          options.ExpectedSubject,
          TimeSpan.FromSeconds(Math.Clamp(options.AllowedClockSkewSeconds, 0, 120)),
          TimeSpan.FromSeconds(Math.Clamp(options.MaximumTokenLifetimeSeconds, 30, 900))),
        provider.GetRequiredService<IActionVerificationKeyResolver>()));
    services.AddSingleton<IEgressSupervisorSigningKeys>(
      provider => new CertificateStoreEgressSupervisorSigningKeys(
        options,
        provider.GetRequiredService<IActionVerificationKeyResolver>()));
    services.AddSingleton<IEgressHostPostureProvider>(provider =>
      new WindowsEgressHostPostureProvider(
        options,
        provider.GetRequiredService<EgressDestinationPolicy>().Sha256));
    services.AddSingleton<IEgressProcessIdentityVerifier,
      WindowsEgressProcessIdentityVerifier>();
    // Source support deliberately remains safe-off until an independently
    // installed and measured browser broker replaces this rejecting provider.
    services.AddSingleton<IBrowserBoundaryEvidenceProvider,
      RejectingBrowserBoundaryEvidenceProvider>();
    services.AddSingleton<IEgressDestinationResolver, DnsEgressDestinationResolver>();
    services.AddSingleton<IEgressPipePeerAuthenticator>(
      _ => new WindowsEgressPipePeerAuthenticator(options));
    services.AddSingleton<IEgressControlPipeSecurityEvidence,
      WindowsEgressControlPipeSecurityEvidence>();
    services.AddSingleton<IEgressOutboundConnector, TcpEgressOutboundConnector>();
    services.AddSingleton<IEgressSupervisorSecretVault, EgressSupervisorSecretVault>();
    services.AddSingleton<EgressSupervisorEngine>();
    services.AddSingleton<EgressControlProtocolHandler>();
    services.AddHostedService<EgressKillSwitchMonitor>();
    services.AddHostedService<NamedPipeEgressControlService>();
    services.AddHostedService<NamedPipeEgressDataService>();
    return services;
  }
}

internal sealed class DisabledEgressSupervisorService(
  ILogger<DisabledEgressSupervisorService> logger) : BackgroundService
{
  protected override async Task ExecuteAsync(CancellationToken stoppingToken)
  {
    EgressSupervisorLog.ServiceDisabled(logger);
    await Task.Delay(Timeout.InfiniteTimeSpan, stoppingToken).ConfigureAwait(false);
  }
}
