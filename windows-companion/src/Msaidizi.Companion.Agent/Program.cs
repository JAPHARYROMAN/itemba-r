using Itemba.Msaidizi.Companion.Agent;
using Itemba.Msaidizi.Companion.Agent.Capabilities;
using Itemba.Msaidizi.Companion.Agent.Channel;
using Itemba.Msaidizi.Companion.Agent.Configuration;
using Itemba.Msaidizi.Companion.Agent.SecretProvisioning;
using Itemba.Msaidizi.Companion.Agent.Security;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Agent;

internal static class Program
{
  [STAThread]
  private static void Main(string[] args)
  {
    ApplicationConfiguration.Initialize();
    var builder = Host.CreateApplicationBuilder(args);
    builder.Services.AddOptions<AgentOptions>()
      .Bind(builder.Configuration.GetSection(AgentOptions.SectionName));
    builder.Services.AddOptions<SessionBridgeOptions>()
      .Bind(builder.Configuration.GetSection(SessionBridgeOptions.SectionName));
    builder.Services.AddOptions<SecretProvisioningOptions>()
      .Bind(builder.Configuration.GetSection(SecretProvisioningOptions.SectionName));
    builder.Services.AddOptions<CapabilityBoundaryTrustOptions>()
      .Bind(builder.Configuration.GetSection(CapabilityBoundaryTrustOptions.SectionName));
    var browserExternalEffectsEnabled = builder.Configuration.GetValue<bool>(
      $"{SessionBridgeOptions.SectionName}:BrowserExternalEffectsEnabled");
    var emergencyCommandEnabled = builder.Configuration.GetValue<bool>(
      $"{SessionBridgeOptions.SectionName}:EmergencyCommandEnabled");
    if (browserExternalEffectsEnabled)
    {
      var enrollment = builder.Configuration
        .GetSection(AgentOptions.SectionName)
        .Get<AgentOptions>() ?? new AgentOptions();
      if (!BrowserArtifactQuarantineProvisioner.EnsureProvisionedForEnrolledDevice(
          enrollment,
          out var quarantineStatus))
      {
        throw new InvalidOperationException(
          $"Browser artifact capability cannot be published: {quarantineStatus}");
      }
    }
    builder.Services.AddSingleton<InteractiveStaDispatcher>();
    builder.Services.AddSingleton<InteractiveUiDispatcher>();
    builder.Services.AddSingleton<ISessionRecoveryStore, DpapiSessionRecoveryStore>();
    builder.Services.AddSingleton<InteractiveTargetPolicy>();
    builder.Services.AddSingleton<IInteractiveAudioDevice, WinMmInteractiveAudioDevice>();
    builder.Services.AddSingleton<CameraPolicy>();
    builder.Services.AddSingleton<IInteractiveCameraDevice, WinRtInteractiveCameraDevice>();
    builder.Services.AddSingleton<LocalSpeechPolicy>();
    builder.Services.AddSingleton<ILocalSpeechEngine, SystemSpeechLocalEngine>();
    builder.Services.AddSingleton<ApprovedBrowserLauncher>();
    builder.Services.AddSingleton<StandardUserCommandPolicy>();
    builder.Services.AddSingleton<StandardUserOwnedCommandRunner>();
    builder.Services.AddSingleton<SessionSecretAccessor>();
    builder.Services.AddSingleton<BrowserArtifactQuarantine>();
    builder.Services.AddSingleton<IEgressAttestationKeyResolver>(services =>
      services.GetRequiredService<IOptions<CapabilityBoundaryTrustOptions>>()
        .Value.Enabled
          ? new AgentCapabilityBoundaryKeyResolver(
            services.GetRequiredService<IOptions<CapabilityBoundaryTrustOptions>>(),
            services.GetRequiredService<IOptions<SessionBridgeOptions>>())
          : new RejectingAgentCapabilityBoundaryKeyResolver());
    builder.Services.AddSingleton<ICapabilityBoundaryAttestationReplayGuard,
      InMemoryCapabilityBoundaryAttestationReplayGuard>();
    builder.Services.AddSingleton(services =>
    {
      var trust = services.GetRequiredService<IOptions<CapabilityBoundaryTrustOptions>>()
        .Value;
      return new CapabilityBoundaryAttestationVerifier(
        services.GetRequiredService<IOptions<AgentOptions>>().Value.DeviceId,
        TimeSpan.FromSeconds(Math.Clamp(trust.AllowedClockSkewSeconds, 0, 120)),
        TimeSpan.FromSeconds(Math.Clamp(
          trust.MaximumAttestationLifetimeSeconds,
          5,
          120)),
        services.GetRequiredService<IEgressAttestationKeyResolver>(),
        services.GetRequiredService<ICapabilityBoundaryAttestationReplayGuard>());
    });
    builder.Services.AddSingleton<IStandardUserEgressVerifier>(services =>
      StandardUserEgressVerifierFactory.Create(
        services.GetRequiredService<IOptions<AgentOptions>>(),
        services.GetRequiredService<IOptions<CapabilityBoundaryTrustOptions>>(),
        services.GetRequiredService<IEgressAttestationKeyResolver>()));
    builder.Services.AddSingleton<ISecretProvisioningClient,
      NamedPipeSecretProvisioningClient>();
    builder.Services.AddSingleton<ISecretProvisioningPendingStore,
      DpapiSecretProvisioningPendingStore>();
    builder.Services.AddSingleton<ISecretProvisioningUserInteraction,
      WinFormsSecretProvisioningInteraction>();
    builder.Services.AddSingleton<SecretProvisioningWorkflow>();
    builder.Services.AddSingleton<IHostCapabilityAdapter, ForegroundSessionStatusCapability>();
    builder.Services.AddSingleton<IHostCapabilityAdapter, ClipboardTextReadCapabilityAdapter>();
    builder.Services.AddSingleton<IHostCapabilityAdapter, ClipboardTextWriteCapabilityAdapter>();
    builder.Services.AddSingleton<IHostCapabilityAdapter, PrimaryScreenCaptureCapabilityAdapter>();
    builder.Services.AddSingleton<IHostCapabilityAdapter, CameraPhotoCaptureCapabilityAdapter>();
    builder.Services.AddSingleton<IHostCapabilityAdapter, WavAudioPlaybackCapabilityAdapter>();
    builder.Services.AddSingleton<IHostCapabilityAdapter, LocalSpeechSynthesizeCapabilityAdapter>();
    builder.Services.AddSingleton<IHostCapabilityAdapter, LocalSpeechTranscribeCapabilityAdapter>();
    builder.Services.AddSingleton<IHostCapabilityAdapter, ForegroundUiInspectCapabilityAdapter>();
    if (browserExternalEffectsEnabled)
    {
      builder.Services.AddSingleton<IHostCapabilityAdapter, BrowserUriOpenCapabilityAdapter>();
      builder.Services.AddSingleton<IHostCapabilityAdapter, UiElementInvokeCapabilityAdapter>();
      builder.Services.AddSingleton<IHostCapabilityAdapter, BrowserFormTextSetCapabilityAdapter>();
      builder.Services.AddSingleton<IHostCapabilityAdapter, BrowserFormSecretSetCapabilityAdapter>();
      builder.Services.AddSingleton<IHostCapabilityAdapter, BrowserFileUploadCapabilityAdapter>();
      builder.Services.AddSingleton<IHostCapabilityAdapter, BrowserDownloadInvokeCapabilityAdapter>();
    }
    if (emergencyCommandEnabled)
    {
      builder.Services.AddSingleton<IHostCapabilityAdapter,
        EmergencyCommandExecuteCapabilityAdapter>();
    }
    if (builder.Configuration.GetValue<bool>($"{SessionBridgeOptions.SectionName}:Enabled"))
    {
      builder.Services.AddSingleton<IAgentSessionChannel, NamedPipeAgentSessionChannel>();
      builder.Services.AddHostedService<AgentWorker>();
    }
    builder.Services.AddSingleton<CompanionTrayContext>();

    using var host = builder.Build();
    var trayContext = host.Services.GetRequiredService<CompanionTrayContext>();
    _ = host.Services.GetRequiredService<InteractiveUiDispatcher>();
    host.Start();
    Application.Run(trayContext);
    host.StopAsync(TimeSpan.FromSeconds(10)).GetAwaiter().GetResult();
  }
}
