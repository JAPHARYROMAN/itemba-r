using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class WindowsServiceStartModeCapabilityTests
{
  [Fact]
  public async Task ReadIsStrictDigestOnlyAndBoundToExactConfiguredService()
  {
    var policy = Policy([]);
    var manager = new RecordingStartModeManager("manual");
    var adapter = new WindowsServiceStartModeReadCapabilityAdapter(policy, manager);
    using var arguments = JsonDocument.Parse("""{"serviceId":"business-worker"}""");

    var result = await adapter.ExecuteAsync(
      Context(expectedPreStateSha256: null),
      arguments.RootElement,
      CancellationToken.None);
    using var output = JsonDocument.Parse(result.OutputJson);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    var expected = WindowsServiceStartModeSupport.Snapshot(target, "manual");

    Assert.Equal("windows.service.start-mode.read", adapter.Descriptor.Id);
    Assert.Equal("2.0.0", adapter.Descriptor.Version);
    Assert.Equal(CapabilityEffect.LocalRead, adapter.Descriptor.Effect);
    Assert.Equal(ConsentRequirement.SignedMandate, adapter.Descriptor.Consent);
    Assert.Equal(RecoveryKind.NotApplicable, adapter.Descriptor.Recovery);
    Assert.Equal(RequiredPrivilege.LocalSystem, adapter.Descriptor.RequiredPrivilege);
    Assert.Equal(IdempotencySemantics.Required, adapter.Descriptor.Idempotency);
    Assert.False(adapter.Descriptor.TouchesTrustedRoot);
    Assert.Equal("manual", output.RootElement.GetProperty("startMode").GetString());
    Assert.Equal(expected.StateSha256, output.RootElement.GetProperty(
      "stateSha256").GetString());
    Assert.DoesNotContain("Itemba Business Worker", result.OutputJson);
    Assert.Equal(expected.StateSha256, result.PreStateSha256);
    Assert.False(result.MutationCommitted);
    Assert.False(result.OutcomeUncertain);
    Assert.True(adapter.ValidateArguments(arguments.RootElement).IsValid);
    Assert.True(adapter.ValidateResult(output.RootElement).IsValid);
    using var unknown = JsonDocument.Parse(
      """{"serviceId":"business-worker","serviceName":"Spooler"}""");
    Assert.False(adapter.ValidateArguments(unknown.RootElement).IsValid);
  }

  [Fact]
  public void StartModeV1CapabilityLookupFailsClosedAfterStateContractUpgrade()
  {
    var adapter = new WindowsServiceStartModeReadCapabilityAdapter(
      Policy([]),
      new RecordingStartModeManager("manual"));
    var registry = new CapabilityRegistry([adapter]);

    Assert.False(registry.TryResolve(
      adapter.Descriptor.Id,
      "1.0.0",
      out _));
    Assert.True(registry.TryResolve(
      adapter.Descriptor.Id,
      WindowsServiceStartModeSupport.CapabilityVersion,
      out var resolved));
    Assert.Same(adapter, resolved);
  }

  [Fact]
  public void DirectNativeReadHasARealPositiveControl()
  {
    var policy = new WindowsServicePolicy(Options.Create(new HostCapabilityOptions
    {
      AllowedWindowsServices =
      [
        new AllowedWindowsServiceOptions
        {
          Id = "windows-task-scheduler",
          ServiceName = "Schedule",
          AllowedStartModes = [],
        },
      ],
    }));
    var target = policy.ResolveStartMode(
      "windows-task-scheduler",
      string.Empty,
      requireChange: false);

    var observation = new WindowsServiceStartModeManager().ReadStartMode(target);

    Assert.True(WindowsServiceStartModeSupport.IsKnown(observation.StartMode));
    Assert.True(WindowsServiceStartModeSupport.IsSupportedServiceType(
      observation.ServiceType));
  }

  [Fact]
  public async Task SetUsesOnlyAllowedModeAndSnapshotsPriorState()
  {
    var policy = Policy(["automatic", "disabled"]);
    var manager = new RecordingStartModeManager("manual");
    var recovery = new RecordingRecoveryVault();
    var adapter = new WindowsServiceStartModeSetCapabilityAdapter(
      policy,
      manager,
      recovery);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    var before = WindowsServiceStartModeSupport.Snapshot(target, "manual");
    using var arguments = JsonDocument.Parse(
      """{"serviceId":"business-worker","startMode":"disabled"}""");

    var result = await adapter.ExecuteAsync(
      Context(before.StateSha256),
      arguments.RootElement,
      CancellationToken.None);
    using var output = JsonDocument.Parse(result.OutputJson);

    Assert.Equal("windows.service.start-mode.set", adapter.Descriptor.Id);
    Assert.Equal("2.0.0", adapter.Descriptor.Version);
    Assert.Equal(CapabilityEffect.Administrative, adapter.Descriptor.Effect);
    Assert.Equal(ConsentRequirement.OneShotApproval, adapter.Descriptor.Consent);
    Assert.Equal(RecoveryKind.Snapshot, adapter.Descriptor.Recovery);
    Assert.Equal(RequiredPrivilege.LocalSystem, adapter.Descriptor.RequiredPrivilege);
    Assert.Equal(IdempotencySemantics.Required, adapter.Descriptor.Idempotency);
    Assert.False(adapter.Descriptor.TouchesTrustedRoot);
    Assert.Equal(1, manager.SetCount);
    Assert.Equal("disabled", manager.CurrentMode);
    Assert.True(output.RootElement.GetProperty("updated").GetBoolean());
    Assert.Equal("disabled", output.RootElement.GetProperty("startMode").GetString());
    Assert.True(result.MutationCommitted);
    Assert.False(result.OutcomeUncertain);
    Assert.Equal(before.StateSha256, result.PreStateSha256);
    Assert.NotNull(result.OpaqueRecoveryHandle);
    Assert.NotNull(result.RecoveryProvenanceSha256);
    Assert.Equal("windows.service.start-mode.set", recovery.Operation);
    Assert.False(recovery.Irreversible);
    Assert.Equal(
      ["recordContract", "id", "name", "startMode", "serviceType", "configurationIdentitySha256"],
      recovery.Record.EnumerateObject().Select(property => property.Name).ToArray());
    Assert.Equal(
      WindowsServiceStartModeSupport.RecoveryRecordContract,
      recovery.Record.GetProperty("recordContract").GetString());
    Assert.Equal("manual", recovery.Record.GetProperty("startMode").GetString());
    Assert.Equal(
      WindowsServiceStartModeSupport.Win32OwnProcess,
      recovery.Record.GetProperty("serviceType").GetUInt32());
    Assert.True(PayloadDigest.IsSha256Hex(recovery.Record.GetProperty(
      "configurationIdentitySha256").GetString()!));
    Assert.True(adapter.ValidateArguments(arguments.RootElement).IsValid);
    Assert.True(adapter.ValidateResult(output.RootElement).IsValid);
  }

  [Fact]
  public async Task SetRejectsUnallowedModeAndStaleOrMissingPreStateBeforeCommit()
  {
    var policy = Policy(["manual"]);
    var manager = new RecordingStartModeManager("automatic");
    var recovery = new RecordingRecoveryVault();
    var adapter = new WindowsServiceStartModeSetCapabilityAdapter(
      policy,
      manager,
      recovery);
    using var disabled = JsonDocument.Parse(
      """{"serviceId":"business-worker","startMode":"disabled"}""");
    using var manual = JsonDocument.Parse(
      """{"serviceId":"business-worker","startMode":"manual"}""");

    await Assert.ThrowsAsync<HostPreconditionException>(() => adapter.ExecuteAsync(
      Context(WindowsServiceStartModeSupport.Snapshot(
        policy.ResolveStartMode("business-worker", string.Empty, false),
        "automatic").StateSha256),
      disabled.RootElement,
      CancellationToken.None).AsTask());
    await Assert.ThrowsAsync<HostPreconditionException>(() => adapter.ExecuteAsync(
      Context(expectedPreStateSha256: null),
      manual.RootElement,
      CancellationToken.None).AsTask());
    await Assert.ThrowsAsync<HostPreconditionException>(() => adapter.ExecuteAsync(
      Context(PayloadDigest.Sha256Hex("stale")),
      manual.RootElement,
      CancellationToken.None).AsTask());

    Assert.Equal(0, manager.SetCount);
    Assert.Equal(0, recovery.Count);
  }

  [Fact]
  public async Task SetRejectsDriverServicesBeforeRecoveryOrNativeCommit()
  {
    const uint kernelDriver = 0x00000001;
    var policy = Policy(["disabled"]);
    var manager = new RecordingStartModeManager("system", kernelDriver);
    var recovery = new RecordingRecoveryVault();
    var adapter = new WindowsServiceStartModeSetCapabilityAdapter(
      policy,
      manager,
      recovery);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    using var arguments = JsonDocument.Parse(
      """{"serviceId":"business-worker","startMode":"disabled"}""");

    var failure = await Assert.ThrowsAsync<HostPreconditionException>(() =>
      adapter.ExecuteAsync(
        Context(WindowsServiceStartModeSupport.Snapshot(
          target,
          "system",
          kernelDriver).StateSha256),
        arguments.RootElement,
        CancellationToken.None).AsTask());

    Assert.Equal("windows_service_type_not_allowed", failure.ErrorCode);
    Assert.Equal(0, recovery.Count);
    Assert.Equal(0, manager.SetCount);
  }

  [Fact]
  public async Task SetHonorsCancellationAtFinalPreNativeBoundary()
  {
    using var cancellation = new CancellationTokenSource();
    var policy = Policy(["disabled"]);
    var manager = new RecordingStartModeManager("manual");
    var recovery = new RecordingRecoveryVault
    {
      AfterPrepare = cancellation.Cancel,
    };
    var adapter = new WindowsServiceStartModeSetCapabilityAdapter(
      policy,
      manager,
      recovery);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    var before = WindowsServiceStartModeSupport.Snapshot(target, "manual");
    using var arguments = JsonDocument.Parse(
      """{"serviceId":"business-worker","startMode":"disabled"}""");

    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => adapter.ExecuteAsync(
      Context(before.StateSha256),
      arguments.RootElement,
      cancellation.Token).AsTask());

    Assert.Equal(1, recovery.Count);
    Assert.Equal(0, manager.SetCount);
    Assert.Equal("manual", manager.CurrentMode);
  }

  [Fact]
  public async Task SetRefusesPreStateChangeAtNativeCommitGuard()
  {
    var policy = Policy(["disabled"]);
    var manager = new RecordingStartModeManager("manual")
    {
      ChangeModeAtSetBoundary = "automatic",
    };
    var recovery = new RecordingRecoveryVault();
    var adapter = new WindowsServiceStartModeSetCapabilityAdapter(
      policy,
      manager,
      recovery);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    using var arguments = JsonDocument.Parse(
      """{"serviceId":"business-worker","startMode":"disabled"}""");

    var failure = await Assert.ThrowsAsync<HostPreconditionException>(() =>
      adapter.ExecuteAsync(
        Context(WindowsServiceStartModeSupport.Snapshot(
          target,
          "manual").StateSha256),
        arguments.RootElement,
        CancellationToken.None).AsTask());

    Assert.Equal("windows_service_pre_state_changed", failure.ErrorCode);
    Assert.Equal(1, recovery.Count);
    Assert.Equal(0, manager.SetCount);
    Assert.Equal("automatic", manager.CurrentMode);
  }

  [Fact]
  public async Task SetRefusesBaseConfigurationDriftAtNativeCommitGuard()
  {
    var policy = Policy(["disabled"]);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    var initialIdentity = WindowsServiceStartModeSupport
      .ConfiguredTargetIdentitySha256(target);
    var manager = new RecordingStartModeManager("manual")
    {
      ConfigurationIdentitySha256 = initialIdentity,
      ChangeConfigurationIdentityAtSetBoundary = PayloadDigest.Sha256Hex(
        "changed-service-base-configuration"),
    };
    var recovery = new RecordingRecoveryVault();
    var adapter = new WindowsServiceStartModeSetCapabilityAdapter(
      policy,
      manager,
      recovery);
    using var arguments = JsonDocument.Parse(
      """{"serviceId":"business-worker","startMode":"disabled"}""");

    var failure = await Assert.ThrowsAsync<HostPreconditionException>(() =>
      adapter.ExecuteAsync(
        Context(WindowsServiceStartModeSupport.Snapshot(
          target,
          "manual",
          WindowsServiceStartModeSupport.Win32OwnProcess,
          initialIdentity).StateSha256),
        arguments.RootElement,
        CancellationToken.None).AsTask());

    Assert.Equal("windows_service_pre_state_changed", failure.ErrorCode);
    Assert.Equal(1, recovery.Count);
    Assert.Equal(0, manager.SetCount);
    Assert.Equal("manual", manager.CurrentMode);
  }

  [Fact]
  public void StateDigestBindsBaseConfigurationIdentity()
  {
    var target = Policy([]).ResolveStartMode(
      "business-worker",
      string.Empty,
      requireChange: false);

    var first = WindowsServiceStartModeSupport.Snapshot(
      target,
      "manual",
      WindowsServiceStartModeSupport.Win32OwnProcess,
      PayloadDigest.Sha256Hex("base-configuration-one"));
    var second = WindowsServiceStartModeSupport.Snapshot(
      target,
      "manual",
      WindowsServiceStartModeSupport.Win32OwnProcess,
      PayloadDigest.Sha256Hex("base-configuration-two"));

    Assert.NotEqual(first.StateSha256, second.StateSha256);
  }

  [Theory]
  [InlineData("Itemba Msaidizi Companion")]
  [InlineData("Itemba.Msaidizi.UpdateSupervisor")]
  [InlineData("Itemba Msaidizi Recovery Worker")]
  [InlineData("Itemba Msaidizi Audit Signer")]
  [InlineData("ItembaMsaidiziAuditBroker")]
  [InlineData("ITEMBA-MSAIDIZI-GENERIC-SUPERVISOR")]
  [InlineData("Msaidizi Companion Service")]
  [InlineData("Contoso-Msaidizi-Recovery-Agent")]
  public void EveryMsaidiziServiceFamilyIsExcludedRegardlessOfConfig(string serviceName)
  {
    var options = Options.Create(new HostCapabilityOptions
    {
      AllowedWindowsServices =
      [
        new AllowedWindowsServiceOptions
        {
          Id = "forbidden",
          ServiceName = serviceName,
          AllowStart = true,
          AllowStop = true,
          AllowedStartModes = ["automatic", "manual", "disabled"],
        },
      ],
    });

    Assert.Throws<InvalidOperationException>(() => new WindowsServicePolicy(options));
  }

  [Theory]
  [InlineData("Automatic")]
  [InlineData("delayed-automatic")]
  [InlineData("automatic ")]
  public void StartModeAllowlistRequiresExactReviewedTokens(string mode)
  {
    Assert.Throws<InvalidOperationException>(() => Policy([mode]));
  }

  [Fact]
  public void DuplicateStartModesAreRejected()
  {
    Assert.Throws<InvalidOperationException>(() => Policy(["manual", "manual"]));
  }

  [Fact]
  public void EmptyStartModeAllowlistPreservesReadAndBlocksMutation()
  {
    var policy = Policy([]);

    Assert.NotNull(policy.ResolveStartMode(
      "business-worker",
      string.Empty,
      requireChange: false));
    var failure = Assert.Throws<HostPreconditionException>(() =>
      policy.ResolveStartMode(
        "business-worker",
        "manual",
        requireChange: true));

    Assert.Equal("windows_service_start_mode_not_allowed", failure.ErrorCode);
  }

  [Fact]
  public void SetSchemaRejectsRawNamesUnknownFieldsAndNonExactModes()
  {
    var adapter = new WindowsServiceStartModeSetCapabilityAdapter(
      Policy(["manual"]),
      new RecordingStartModeManager("automatic"),
      new RecordingRecoveryVault());
    using var rawName = JsonDocument.Parse(
      """{"serviceId":"business-worker","serviceName":"Schedule","startMode":"manual"}""");
    using var unknown = JsonDocument.Parse(
      """{"serviceId":"business-worker","startMode":"manual","force":true}""");
    using var wrongCase = JsonDocument.Parse(
      """{"serviceId":"business-worker","startMode":"Manual"}""");

    Assert.False(adapter.ValidateArguments(rawName.RootElement).IsValid);
    Assert.False(adapter.ValidateArguments(unknown.RootElement).IsValid);
    Assert.False(adapter.ValidateArguments(wrongCase.RootElement).IsValid);
  }

  [Fact]
  public async Task AlreadyDesiredModeMakesNoRecoveryOrNativeMutation()
  {
    var policy = Policy(["disabled"]);
    var manager = new RecordingStartModeManager("disabled");
    var recovery = new RecordingRecoveryVault();
    var adapter = new WindowsServiceStartModeSetCapabilityAdapter(
      policy,
      manager,
      recovery);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    using var arguments = JsonDocument.Parse(
      """{"serviceId":"business-worker","startMode":"disabled"}""");

    var failure = await Assert.ThrowsAsync<HostPreconditionException>(() =>
      adapter.ExecuteAsync(
        Context(WindowsServiceStartModeSupport.Snapshot(
          target,
          "disabled").StateSha256),
        arguments.RootElement,
        CancellationToken.None).AsTask());

    Assert.Equal("windows_service_start_mode_already_set", failure.ErrorCode);
    Assert.Equal(0, recovery.Count);
    Assert.Equal(0, manager.SetCount);
  }

  [Theory]
  [InlineData("service-appsettings.json")]
  [InlineData("recovery-appsettings.json")]
  public void PackagedConfigsContainNoServiceOrStartModeGrant(string asset)
  {
    var path = Path.Combine(AppContext.BaseDirectory, "test-assets", asset);
    using var document = JsonDocument.Parse(File.ReadAllText(path));
    var services = document.RootElement
      .GetProperty("HostCapabilities")
      .GetProperty("AllowedWindowsServices");

    Assert.Equal(JsonValueKind.Array, services.ValueKind);
    Assert.Empty(services.EnumerateArray());
  }

  internal static WindowsServicePolicy Policy(IReadOnlyList<string> allowedModes) => new(
    Options.Create(new HostCapabilityOptions
    {
      AllowedWindowsServices =
      [
        new AllowedWindowsServiceOptions
        {
          Id = "business-worker",
          ServiceName = "Itemba Business Worker",
          AllowStart = true,
          AllowStop = true,
          AllowedStartModes = allowedModes.ToList(),
        },
      ],
    }));

  internal static ActionExecutionContext Context(string? expectedPreStateSha256) => new(
    ActionId: "action-1",
    TaskId: "task-1",
    PlanVersionId: "plan-1",
    StepId: "step-1",
    DeviceId: "device-1",
    MandateId: "mandate-1",
    IdempotencyKey: "idempotency-1",
    ExpectedPreStateSha256: expectedPreStateSha256,
    InputProvenanceSha256: null,
    Budgets: new ActionBudget(60, 10, 20, 10, 1_000_000, 1_000_000, 1m));

  internal sealed class RecordingStartModeManager(
    string initialMode,
    uint serviceType = WindowsServiceStartModeSupport.Win32OwnProcess) :
    IWindowsServiceStartModeManager
  {
    private Action? _afterNextRead;

    public string CurrentMode { get; private set; } = initialMode;

    public int ReadCount { get; private set; }

    public int SetCount { get; private set; }

    public bool ThrowAfterSet { get; set; }

    public bool ThrowPreconditionOnPostSetRead { get; set; }

    public uint ServiceType { get; set; } = serviceType;

    public string? ConfigurationIdentitySha256 { get; set; }

    public string? ChangeModeAtSetBoundary { get; init; }

    public string? ChangeConfigurationIdentityAtSetBoundary { get; init; }

    public int? ChangeModeOnReadNumber { get; init; }

    public string? ModeOnNumberedRead { get; init; }

    public Action? AfterNextRead
    {
      get => _afterNextRead;
      init => _afterNextRead = value;
    }

    public WindowsServiceStartModeObservation ReadStartMode(
      AllowedWindowsService service)
    {
      ReadCount++;
      if (ReadCount == ChangeModeOnReadNumber && ModeOnNumberedRead is { } changedMode)
      {
        CurrentMode = changedMode;
      }
      if (SetCount > 0 && ThrowPreconditionOnPostSetRead)
      {
        throw new HostPreconditionException(
          "windows_service_start_mode_unsupported");
      }
      var callback = Interlocked.Exchange(ref _afterNextRead, null);
      callback?.Invoke();
      return new WindowsServiceStartModeObservation(
        CurrentMode,
        ServiceType,
        ConfigurationIdentitySha256
          ?? WindowsServiceStartModeSupport.ConfiguredTargetIdentitySha256(
            service,
            ServiceType));
    }

    public void SetStartMode(
      AllowedWindowsService service,
      string startMode,
      string expectedStartMode,
      uint expectedServiceType,
      string expectedConfigurationIdentitySha256,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      if (ChangeModeAtSetBoundary is { } changedMode)
      {
        CurrentMode = changedMode;
      }
      if (ChangeConfigurationIdentityAtSetBoundary is { } changedIdentity)
      {
        ConfigurationIdentitySha256 = changedIdentity;
      }
      var currentConfigurationIdentity = ConfigurationIdentitySha256
        ?? WindowsServiceStartModeSupport.ConfiguredTargetIdentitySha256(
          service,
          ServiceType);
      if (!string.Equals(CurrentMode, expectedStartMode, StringComparison.Ordinal)
        || ServiceType != expectedServiceType
        || !PayloadDigest.FixedTimeEqualsHex(
          currentConfigurationIdentity,
          expectedConfigurationIdentitySha256)
        || !WindowsServiceStartModeSupport.IsSupportedServiceType(ServiceType))
      {
        throw new HostPreconditionException("windows_service_pre_state_changed");
      }
      SetCount++;
      CurrentMode = startMode;
      if (ThrowAfterSet)
      {
        throw new IOException("Simulated ambiguous SCM commit result.");
      }
    }
  }

  internal sealed class RecordingRecoveryVault : IHostRecoveryVault
  {
    private static readonly JsonSerializerOptions WebSerializerOptions = new(
      JsonSerializerDefaults.Web);

    public int Count { get; private set; }

    public string? Operation { get; private set; }

    public bool Irreversible { get; private set; }

    public JsonElement Record { get; private set; }

    public Action? AfterPrepare { get; init; }

    public ValueTask<HostRecoveryReceipt> PrepareAsync(
      ActionExecutionContext context,
      string operation,
      string preStateSha256,
      object recoveryRecord,
      bool irreversible,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      Count++;
      Operation = operation;
      Irreversible = irreversible;
      Record = JsonSerializer.SerializeToElement(
        recoveryRecord,
        WebSerializerOptions);
      AfterPrepare?.Invoke();
      return ValueTask.FromResult(new HostRecoveryReceipt(
        PayloadDigest.Sha256Hex(context.ActionId),
        PayloadDigest.Sha256Hex($"record:{context.ActionId}"),
        $"record:{context.ActionId}"));
    }
  }
}
