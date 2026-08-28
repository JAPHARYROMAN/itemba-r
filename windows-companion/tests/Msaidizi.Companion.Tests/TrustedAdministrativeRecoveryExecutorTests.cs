using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class TrustedAdministrativeRecoveryExecutorTests
{
  [Fact]
  public async Task ExactCurrentStateRestoresOnceThenReplaysIdempotently()
  {
    var preState = PayloadDigest.Sha256Hex("pre-state");
    var currentState = PayloadDigest.Sha256Hex("current-state");
    var record = CreateRecord(preState, irreversible: false);
    var operation = new FakeRecoveryOperation(currentState, preState);
    var executor = new TrustedAdministrativeRecoveryExecutor(
      new FakeRecordReader(record),
      [operation]);
    var request = new TrustedAdministrativeRecoveryRequest(
      record.ActionId,
      record.RecordSha256,
      currentState);

    var restored = await executor.RestoreAsync(request, CancellationToken.None);
    Assert.False(restored.IdempotentReplay);
    Assert.Equal(preState, restored.RestoredStateSha256);
    Assert.Equal(1, operation.RestoreCount);

    var replay = await executor.RestoreAsync(request, CancellationToken.None);
    Assert.True(replay.IdempotentReplay);
    Assert.Equal(preState, replay.RestoredStateSha256);
    Assert.Equal(1, operation.RestoreCount);
  }

  [Fact]
  public async Task CurrentStateMismatchNeverRunsCompensator()
  {
    var preState = PayloadDigest.Sha256Hex("pre-state");
    var actualState = PayloadDigest.Sha256Hex("actual-state");
    var record = CreateRecord(preState, irreversible: false);
    var operation = new FakeRecoveryOperation(actualState, preState);
    var executor = new TrustedAdministrativeRecoveryExecutor(
      new FakeRecordReader(record),
      [operation]);
    var request = new TrustedAdministrativeRecoveryRequest(
      record.ActionId,
      record.RecordSha256,
      PayloadDigest.Sha256Hex("stale-central-state"));

    var failure = await Assert.ThrowsAsync<HostRecoveryException>(() =>
      executor.RestoreAsync(request, CancellationToken.None).AsTask());
    Assert.Equal("recovery_precondition_mismatch", failure.ErrorCode);
    Assert.Equal(0, operation.RestoreCount);
  }

  [Fact]
  public async Task IrreversibleRecordsNeverReachAdministrativeCompensators()
  {
    var preState = PayloadDigest.Sha256Hex("pre-state");
    var current = PayloadDigest.Sha256Hex("current-state");
    var record = CreateRecord(preState, irreversible: true);
    var operation = new FakeRecoveryOperation(current, preState);
    var executor = new TrustedAdministrativeRecoveryExecutor(
      new FakeRecordReader(record),
      [operation]);
    var request = new TrustedAdministrativeRecoveryRequest(
      record.ActionId,
      record.RecordSha256,
      current);

    var failure = await Assert.ThrowsAsync<HostRecoveryException>(() =>
      executor.RestoreAsync(request, CancellationToken.None).AsTask());
    Assert.Equal("recovery_operation_not_supported", failure.ErrorCode);
    Assert.Equal(0, operation.RestoreCount);
  }

  [Fact]
  public async Task ServiceStartModeRecoveryRestoresSnapshotOnceThenReplays()
  {
    var policy = WindowsServiceStartModeCapabilityTests.Policy(["disabled"]);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    var preState = WindowsServiceStartModeSupport.Snapshot(
      target,
      "manual").StateSha256;
    var currentState = WindowsServiceStartModeSupport.Snapshot(
      target,
      "disabled").StateSha256;
    var record = CreateServiceStartModeRecord(preState);
    var manager = new WindowsServiceStartModeCapabilityTests
      .RecordingStartModeManager("disabled");
    var executor = new TrustedAdministrativeRecoveryExecutor(
      new FakeRecordReader(record),
      [new WindowsServiceStartModeAdministrativeRecoveryOperation(policy, manager)]);
    var request = new TrustedAdministrativeRecoveryRequest(
      record.ActionId,
      record.RecordSha256,
      currentState);

    var restored = await executor.RestoreAsync(request, CancellationToken.None);
    var replay = await executor.RestoreAsync(request, CancellationToken.None);

    Assert.False(restored.IdempotentReplay);
    Assert.Equal(preState, restored.RestoredStateSha256);
    Assert.True(replay.IdempotentReplay);
    Assert.Equal(preState, replay.RestoredStateSha256);
    Assert.Equal(1, manager.SetCount);
    Assert.Equal("manual", manager.CurrentMode);
  }

  [Fact]
  public async Task ServiceStartModeRecoveryRefusesStaleExpectedCurrentState()
  {
    var policy = WindowsServiceStartModeCapabilityTests.Policy(["disabled"]);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    var preState = WindowsServiceStartModeSupport.Snapshot(
      target,
      "manual").StateSha256;
    var record = CreateServiceStartModeRecord(preState);
    var manager = new WindowsServiceStartModeCapabilityTests
      .RecordingStartModeManager("disabled");
    var executor = new TrustedAdministrativeRecoveryExecutor(
      new FakeRecordReader(record),
      [new WindowsServiceStartModeAdministrativeRecoveryOperation(policy, manager)]);
    var request = new TrustedAdministrativeRecoveryRequest(
      record.ActionId,
      record.RecordSha256,
      WindowsServiceStartModeSupport.Snapshot(target, "automatic").StateSha256);

    var failure = await Assert.ThrowsAsync<HostRecoveryException>(() =>
      executor.RestoreAsync(request, CancellationToken.None).AsTask());

    Assert.Equal("recovery_precondition_mismatch", failure.ErrorCode);
    Assert.Equal(0, manager.SetCount);
    Assert.Equal("disabled", manager.CurrentMode);
  }

  [Fact]
  public async Task AmbiguousServiceStartModeRecoveryReportsUnknownOutcome()
  {
    var policy = WindowsServiceStartModeCapabilityTests.Policy(["disabled"]);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    var preState = WindowsServiceStartModeSupport.Snapshot(
      target,
      "manual").StateSha256;
    var currentState = WindowsServiceStartModeSupport.Snapshot(
      target,
      "disabled").StateSha256;
    var record = CreateServiceStartModeRecord(preState);
    var manager = new WindowsServiceStartModeCapabilityTests
      .RecordingStartModeManager("disabled")
    {
      ThrowAfterSet = true,
    };
    var executor = new TrustedAdministrativeRecoveryExecutor(
      new FakeRecordReader(record),
      [new WindowsServiceStartModeAdministrativeRecoveryOperation(policy, manager)]);
    var request = new TrustedAdministrativeRecoveryRequest(
      record.ActionId,
      record.RecordSha256,
      currentState);

    var failure = await Assert.ThrowsAsync<HostRecoveryException>(() =>
      executor.RestoreAsync(request, CancellationToken.None).AsTask());

    Assert.Equal("recovery_outcome_unknown", failure.ErrorCode);
    Assert.Equal(1, manager.SetCount);
  }

  [Fact]
  public async Task ServiceStartModeRecoveryRejectsNonExactProtectedRecord()
  {
    var policy = WindowsServiceStartModeCapabilityTests.Policy(["disabled"]);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    var preState = WindowsServiceStartModeSupport.Snapshot(
      target,
      "manual").StateSha256;
    var configurationIdentity = WindowsServiceStartModeSupport
      .ConfiguredTargetIdentitySha256(target);
    var recovery = JsonSerializer.SerializeToElement(new
    {
      recordContract = WindowsServiceStartModeSupport.RecoveryRecordContract,
      id = "business-worker",
      name = "Itemba Business Worker",
      startMode = "manual",
      serviceType = 16,
      configurationIdentitySha256 = configurationIdentity,
      serviceName = "Spooler",
    });
    var record = new TrustedHostRecoveryRecord(
      "action-service-start-mode",
      "task-1",
      "plan-1",
      "step-1",
      "device-1",
      "mandate-1",
      "windows.service.start-mode.set",
      preState,
      false,
      PayloadDigest.Sha256Hex("service-start-mode-record-invalid"),
      recovery);
    var manager = new WindowsServiceStartModeCapabilityTests
      .RecordingStartModeManager("disabled");
    var executor = new TrustedAdministrativeRecoveryExecutor(
      new FakeRecordReader(record),
      [new WindowsServiceStartModeAdministrativeRecoveryOperation(policy, manager)]);

    var failure = await Assert.ThrowsAsync<HostRecoveryException>(() =>
      executor.RestoreAsync(
        new TrustedAdministrativeRecoveryRequest(
          record.ActionId,
          record.RecordSha256,
          WindowsServiceStartModeSupport.Snapshot(target, "disabled").StateSha256),
        CancellationToken.None).AsTask());

    Assert.Equal("recovery_record_format_invalid", failure.ErrorCode);
    Assert.Equal(0, manager.SetCount);
  }

  [Fact]
  public async Task ServiceStartModeRecoveryRejectsConfiguredNameMismatch()
  {
    var policy = WindowsServiceStartModeCapabilityTests.Policy(["disabled"]);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    var preState = WindowsServiceStartModeSupport.Snapshot(
      target,
      "manual").StateSha256;
    var recovery = JsonSerializer.SerializeToElement(new
    {
      recordContract = WindowsServiceStartModeSupport.RecoveryRecordContract,
      id = "business-worker",
      name = "Schedule",
      startMode = "manual",
      serviceType = 16,
      configurationIdentitySha256 = WindowsServiceStartModeSupport
        .ConfiguredTargetIdentitySha256(target),
    });
    var record = new TrustedHostRecoveryRecord(
      "action-service-start-mode-name-mismatch",
      "task-1",
      "plan-1",
      "step-1",
      "device-1",
      "mandate-1",
      "windows.service.start-mode.set",
      preState,
      false,
      PayloadDigest.Sha256Hex("service-start-mode-name-mismatch"),
      recovery);
    var manager = new WindowsServiceStartModeCapabilityTests
      .RecordingStartModeManager("disabled");
    var executor = new TrustedAdministrativeRecoveryExecutor(
      new FakeRecordReader(record),
      [new WindowsServiceStartModeAdministrativeRecoveryOperation(policy, manager)]);

    var failure = await Assert.ThrowsAsync<HostRecoveryException>(() =>
      executor.RestoreAsync(
        new TrustedAdministrativeRecoveryRequest(
          record.ActionId,
          record.RecordSha256,
          WindowsServiceStartModeSupport.Snapshot(target, "disabled").StateSha256),
        CancellationToken.None).AsTask());

    Assert.Equal("recovery_record_format_invalid", failure.ErrorCode);
    Assert.Equal(0, manager.SetCount);
  }

  [Fact]
  public async Task ServiceStartModeRecoveryRejectsBaseConfigurationDrift()
  {
    var policy = WindowsServiceStartModeCapabilityTests.Policy(["disabled"]);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    var expectedIdentity = WindowsServiceStartModeSupport
      .ConfiguredTargetIdentitySha256(target);
    var preState = WindowsServiceStartModeSupport.Snapshot(
      target,
      "manual",
      WindowsServiceStartModeSupport.Win32OwnProcess,
      expectedIdentity).StateSha256;
    var currentIdentity = PayloadDigest.Sha256Hex(
      "externally-changed-service-base-configuration");
    var currentState = WindowsServiceStartModeSupport.Snapshot(
      target,
      "disabled",
      WindowsServiceStartModeSupport.Win32OwnProcess,
      currentIdentity).StateSha256;
    var record = CreateServiceStartModeRecord(preState);
    var manager = new WindowsServiceStartModeCapabilityTests
      .RecordingStartModeManager("disabled")
    {
      ConfigurationIdentitySha256 = currentIdentity,
    };
    var executor = new TrustedAdministrativeRecoveryExecutor(
      new FakeRecordReader(record),
      [new WindowsServiceStartModeAdministrativeRecoveryOperation(policy, manager)]);

    var failure = await Assert.ThrowsAsync<HostRecoveryException>(() =>
      executor.RestoreAsync(
        new TrustedAdministrativeRecoveryRequest(
          record.ActionId,
          record.RecordSha256,
          currentState),
        CancellationToken.None).AsTask());

    Assert.Equal("recovery_precondition_mismatch", failure.ErrorCode);
    Assert.Equal(0, manager.SetCount);
  }

  [Fact]
  public async Task ServiceStartModeRecoveryRejectsLateExpectedStateRebinding()
  {
    var policy = WindowsServiceStartModeCapabilityTests.Policy(["disabled"]);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    var preState = WindowsServiceStartModeSupport.Snapshot(
      target,
      "manual").StateSha256;
    var expectedCurrent = WindowsServiceStartModeSupport.Snapshot(
      target,
      "disabled").StateSha256;
    var record = CreateServiceStartModeRecord(preState);
    var manager = new WindowsServiceStartModeCapabilityTests
      .RecordingStartModeManager("disabled")
    {
      ChangeModeOnReadNumber = 2,
      ModeOnNumberedRead = "automatic",
    };
    var executor = new TrustedAdministrativeRecoveryExecutor(
      new FakeRecordReader(record),
      [new WindowsServiceStartModeAdministrativeRecoveryOperation(policy, manager)]);

    var failure = await Assert.ThrowsAsync<HostRecoveryException>(() =>
      executor.RestoreAsync(
        new TrustedAdministrativeRecoveryRequest(
          record.ActionId,
          record.RecordSha256,
          expectedCurrent),
        CancellationToken.None).AsTask());

    Assert.Equal("recovery_precondition_mismatch", failure.ErrorCode);
    Assert.Equal(0, manager.SetCount);
    Assert.Equal("automatic", manager.CurrentMode);
  }

  [Fact]
  public async Task ServiceStartModeRecoveryRejectsUnversionedLegacyRecord()
  {
    var policy = WindowsServiceStartModeCapabilityTests.Policy(["disabled"]);
    var target = policy.ResolveStartMode("business-worker", string.Empty, false);
    var preState = WindowsServiceStartModeSupport.Snapshot(target, "manual").StateSha256;
    var recovery = JsonSerializer.SerializeToElement(new
    {
      id = "business-worker",
      name = "Itemba Business Worker",
      startMode = "manual",
      serviceType = 16,
      configurationIdentitySha256 = WindowsServiceStartModeSupport
        .ConfiguredTargetIdentitySha256(target),
    });
    var record = new TrustedHostRecoveryRecord(
      "action-service-start-mode-legacy",
      "task-1",
      "plan-1",
      "step-1",
      "device-1",
      "mandate-1",
      "windows.service.start-mode.set",
      preState,
      false,
      PayloadDigest.Sha256Hex("service-start-mode-legacy-record"),
      recovery);
    var executor = new TrustedAdministrativeRecoveryExecutor(
      new FakeRecordReader(record),
      [new WindowsServiceStartModeAdministrativeRecoveryOperation(
        policy,
        new WindowsServiceStartModeCapabilityTests.RecordingStartModeManager("disabled"))]);

    var failure = await Assert.ThrowsAsync<HostRecoveryException>(() =>
      executor.RestoreAsync(
        new TrustedAdministrativeRecoveryRequest(
          record.ActionId,
          record.RecordSha256,
          WindowsServiceStartModeSupport.Snapshot(target, "disabled").StateSha256),
        CancellationToken.None).AsTask());

    Assert.Equal("recovery_record_version_unsupported", failure.ErrorCode);
  }

  private static TrustedHostRecoveryRecord CreateRecord(
    string preState,
    bool irreversible)
  {
    using var recovery = JsonDocument.Parse("""{"id":"managed"}""");
    return new TrustedHostRecoveryRecord(
      "action-1",
      "task-1",
      "plan-1",
      "step-1",
      "device-1",
      "mandate-1",
      "test.reversible.operation",
      preState,
      irreversible,
      PayloadDigest.Sha256Hex("record"),
      recovery.RootElement.Clone());
  }

  private static TrustedHostRecoveryRecord CreateServiceStartModeRecord(
    string preState)
  {
    var policy = WindowsServiceStartModeCapabilityTests.Policy([]);
    var target = policy.ResolveStartMode(
      "business-worker",
      string.Empty,
      requireChange: false);
    var recovery = JsonSerializer.SerializeToElement(new
    {
      recordContract = WindowsServiceStartModeSupport.RecoveryRecordContract,
      id = "business-worker",
      name = "Itemba Business Worker",
      startMode = "manual",
      serviceType = 16,
      configurationIdentitySha256 = WindowsServiceStartModeSupport
        .ConfiguredTargetIdentitySha256(target),
    });
    return new TrustedHostRecoveryRecord(
      "action-service-start-mode",
      "task-1",
      "plan-1",
      "step-1",
      "device-1",
      "mandate-1",
      "windows.service.start-mode.set",
      preState,
      false,
      PayloadDigest.Sha256Hex("service-start-mode-record"),
      recovery);
  }

  private sealed class FakeRecordReader(TrustedHostRecoveryRecord record) :
    ITrustedHostRecoveryRecordReader
  {
    public ValueTask<TrustedHostRecoveryRecord> ReadAsync(
      string actionId,
      string expectedRecordSha256,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      Assert.Equal(record.ActionId, actionId);
      Assert.Equal(record.RecordSha256, expectedRecordSha256);
      return ValueTask.FromResult(record);
    }
  }

  private sealed class FakeRecoveryOperation(
    string currentState,
    string restoredState) : IAdministrativeRecoveryOperation
  {
    private string _currentState = currentState;

    public int RestoreCount { get; private set; }

    public bool Supports(string operation) => operation == "test.reversible.operation";

    public ValueTask<string> ReadStateAsync(
      TrustedHostRecoveryRecord record,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      return ValueTask.FromResult(_currentState);
    }

    public ValueTask RestoreAsync(
      TrustedHostRecoveryRecord record,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      RestoreCount++;
      _currentState = restoredState;
      return ValueTask.CompletedTask;
    }
  }
}
