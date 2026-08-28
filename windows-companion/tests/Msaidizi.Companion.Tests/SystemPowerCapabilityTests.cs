using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class SystemPowerCapabilityTests
{
  private static readonly Guid BootIdentifier =
    new("7c55ea09-a4d2-4a76-ae87-b22e82ba8694");

  [Fact]
  public void PackagedServiceDefaultsKeepSystemPowerDisabledAndClosed()
  {
    var path = Path.Combine(
      AppContext.BaseDirectory,
      "test-assets",
      "service-appsettings.json");
    using var document = JsonDocument.Parse(File.ReadAllText(path));
    var section = document.RootElement.GetProperty("SystemPower");

    Assert.Equal(
      ["Enabled", "RestartDelaySeconds"],
      section.EnumerateObject().Select(property => property.Name).ToArray());
    Assert.False(section.GetProperty("Enabled").GetBoolean());
    Assert.Equal(120, section.GetProperty("RestartDelaySeconds").GetInt32());
  }

  [Fact]
  public async Task BootSessionReadIsStrictDigestOnlyAndDeviceBound()
  {
    var manager = new RecordingSystemPowerManager(BootIdentifier);
    var adapter = new BootSessionReadCapabilityAdapter(manager);

    Assert.Equal("system.boot-session.read", adapter.Descriptor.Id);
    Assert.Equal(CapabilityDataClass.Internal, adapter.Descriptor.DataClass);
    Assert.Equal(CapabilityEffect.LocalRead, adapter.Descriptor.Effect);
    Assert.Equal(ConsentRequirement.SignedMandate, adapter.Descriptor.Consent);
    Assert.Equal(RecoveryKind.NotApplicable, adapter.Descriptor.Recovery);
    Assert.Equal(RequiredPrivilege.LocalSystem, adapter.Descriptor.RequiredPrivilege);
    Assert.Equal(IdempotencySemantics.Required, adapter.Descriptor.Idempotency);
    Assert.False(adapter.Descriptor.TouchesTrustedRoot);
    Assert.True(adapter.ValidateArguments(Parse("{}")).IsValid);
    Assert.False(adapter.ValidateArguments(Parse("{\"unexpected\":true}")).IsValid);

    var result = await adapter.ExecuteAsync(
      Context(expectedPreStateSha256: null),
      Parse("{}"),
      CancellationToken.None);
    using var output = JsonDocument.Parse(result.OutputJson);
    var expectedState = BootSessionReadCapabilityAdapter.State("device-1", BootIdentifier);
    var expectedBootDigest =
      BootSessionReadCapabilityAdapter.BootSessionSha256(BootIdentifier);

    Assert.Equal(expectedBootDigest, output.RootElement.GetProperty(
      "bootSessionSha256").GetString());
    Assert.Equal(expectedState, output.RootElement.GetProperty("stateSha256").GetString());
    Assert.DoesNotContain(
      BootIdentifier.ToString("D"),
      result.OutputJson,
      StringComparison.OrdinalIgnoreCase);
    Assert.NotEqual(
      expectedState,
      BootSessionReadCapabilityAdapter.State("device-2", BootIdentifier));
    Assert.False(result.MutationCommitted);
    Assert.False(result.OutcomeUncertain);
    Assert.Equal(expectedState, result.PreStateSha256);
    Assert.Null(result.OpaqueRecoveryHandle);
    Assert.Equal(0, result.ExternalEgressBytes);
    Assert.True(adapter.ValidateResult(output.RootElement).IsValid);
    Assert.Equal(1, manager.ReadCount);
  }

  [Fact]
  public void RestartDescriptorIsIrreversibleOneShotAndStrict()
  {
    var adapter = CreateRestartAdapter(new RecordingSystemPowerManager(BootIdentifier));

    Assert.Equal("system.power.restart.schedule", adapter.Descriptor.Id);
    Assert.Equal(CapabilityDataClass.Internal, adapter.Descriptor.DataClass);
    Assert.Equal(CapabilityEffect.Irreversible, adapter.Descriptor.Effect);
    Assert.Equal(ConsentRequirement.OneShotApproval, adapter.Descriptor.Consent);
    Assert.Equal(RecoveryKind.Irreversible, adapter.Descriptor.Recovery);
    Assert.Equal(RequiredPrivilege.LocalSystem, adapter.Descriptor.RequiredPrivilege);
    Assert.Equal(IdempotencySemantics.Required, adapter.Descriptor.Idempotency);
    Assert.False(adapter.Descriptor.TouchesTrustedRoot);
    Assert.True(adapter.ValidateArguments(Parse("{}")).IsValid);
    Assert.False(adapter.ValidateArguments(Parse("{\"delaySeconds\":120}")).IsValid);
    Assert.False(adapter.ValidateArguments(Parse("{\"message\":\"now\"}")).IsValid);
    Assert.False(adapter.ValidateArguments(Parse("{\"forceAppsClosed\":true}")).IsValid);
  }

  [Fact]
  public async Task RestartRequiresMatchingCurrentBootSessionBeforeNativeCall()
  {
    var manager = new RecordingSystemPowerManager(BootIdentifier);
    var adapter = CreateRestartAdapter(manager);

    await Assert.ThrowsAsync<HostPreconditionException>(() => adapter.ExecuteAsync(
      Context(expectedPreStateSha256: null),
      Parse("{}"),
      CancellationToken.None).AsTask());
    await Assert.ThrowsAsync<HostPreconditionException>(() => adapter.ExecuteAsync(
      Context(PayloadDigest.Sha256Hex("stale-boot")),
      Parse("{}"),
      CancellationToken.None).AsTask());

    Assert.Equal(0, manager.ScheduleCount);
  }

  [Fact]
  public async Task RestartHonorsCancellationAtFinalPreNativeBoundary()
  {
    using var cancellation = new CancellationTokenSource();
    var manager = new RecordingSystemPowerManager(BootIdentifier)
    {
      AfterRead = cancellation.Cancel,
    };
    var adapter = CreateRestartAdapter(manager);
    var expectedState = BootSessionReadCapabilityAdapter.State("device-1", BootIdentifier);

    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => adapter.ExecuteAsync(
      Context(expectedState),
      Parse("{}"),
      cancellation.Token).AsTask());

    Assert.Equal(1, manager.ReadCount);
    Assert.Equal(0, manager.ScheduleCount);
  }

  [Fact]
  public async Task RestartSchedulesExactlyOnceWithFixedSupervisorDelay()
  {
    var manager = new RecordingSystemPowerManager(BootIdentifier);
    var adapter = CreateRestartAdapter(manager, restartDelaySeconds: 240);
    var expectedState = BootSessionReadCapabilityAdapter.State("device-1", BootIdentifier);

    var result = await adapter.ExecuteAsync(
      Context(expectedState),
      Parse("{}"),
      CancellationToken.None);
    using var output = JsonDocument.Parse(result.OutputJson);

    Assert.Equal(1, manager.ScheduleCount);
    Assert.Equal(240, manager.LastDelaySeconds);
    Assert.True(output.RootElement.GetProperty("scheduled").GetBoolean());
    Assert.Equal(240, output.RootElement.GetProperty("delaySeconds").GetInt32());
    Assert.Equal(expectedState, output.RootElement.GetProperty("stateSha256").GetString());
    Assert.True(result.MutationCommitted);
    Assert.False(result.OutcomeUncertain);
    Assert.Equal(expectedState, result.PreStateSha256);
    Assert.Null(result.OpaqueRecoveryHandle);
    Assert.Null(result.RecoveryProvenanceSha256);
    Assert.Equal(0, result.ExternalEgressBytes);
    Assert.True(adapter.ValidateResult(output.RootElement).IsValid);
  }

  [Theory]
  [InlineData(119, false)]
  [InlineData(120, true)]
  [InlineData(600, true)]
  [InlineData(601, false)]
  public void RestartDelayPolicyIsClosedAndBounded(int delaySeconds, bool valid)
  {
    var options = Options.Create(new SystemPowerOptions
    {
      Enabled = true,
      RestartDelaySeconds = delaySeconds,
    });

    if (valid)
    {
      Assert.Equal(delaySeconds, new SystemPowerPolicy(options).RestartDelaySeconds);
    }
    else
    {
      Assert.Throws<InvalidOperationException>(() => new SystemPowerPolicy(options));
    }
  }

  [Fact]
  public void DisabledSystemPowerPolicyCannotBeResolved()
  {
    Assert.Throws<InvalidOperationException>(() => new SystemPowerPolicy(
      Options.Create(new SystemPowerOptions
      {
        Enabled = false,
        RestartDelaySeconds = 120,
      })));
  }

  private static SystemRestartScheduleCapabilityAdapter CreateRestartAdapter(
    IWindowsSystemPowerManager manager,
    int restartDelaySeconds = 120) => new(
      new SystemPowerPolicy(Options.Create(new SystemPowerOptions
      {
        Enabled = true,
        RestartDelaySeconds = restartDelaySeconds,
      })),
      manager);

  private static ActionExecutionContext Context(string? expectedPreStateSha256) => new(
    ActionId: "action-1",
    TaskId: "task-1",
    PlanVersionId: "plan-version-1",
    StepId: "step-1",
    DeviceId: "device-1",
    MandateId: "mandate-1",
    IdempotencyKey: "idempotency-1",
    ExpectedPreStateSha256: expectedPreStateSha256,
    InputProvenanceSha256: null,
    Budgets: new ActionBudget(7_200, 200, 500, 100, 5_368_709_120, 262_144_000, 20m));

  private static JsonElement Parse(string json)
  {
    using var document = JsonDocument.Parse(json);
    return document.RootElement.Clone();
  }

  internal sealed class RecordingSystemPowerManager(Guid bootIdentifier)
    : IWindowsSystemPowerManager
  {
    public Action? AfterRead { get; init; }

    public int ReadCount { get; private set; }

    public int ScheduleCount { get; private set; }

    public int? LastDelaySeconds { get; private set; }

    public Guid ReadBootIdentifier()
    {
      ReadCount++;
      AfterRead?.Invoke();
      return bootIdentifier;
    }

    public void ScheduleRestart(int delaySeconds)
    {
      ScheduleCount++;
      LastDelaySeconds = delaySeconds;
    }
  }
}
