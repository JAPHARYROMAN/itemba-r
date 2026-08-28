using System.Security.Cryptography;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class LocalUserRightsCapabilityTests
{
  [Fact]
  public async Task LogonRightMutationUsesExactSidAndRestoresSnapshot()
  {
    var options = Options.Create(ValidOptions());
    var identities = new LocalIdentityPolicy(options);
    var policy = new LocalUserRightPolicy(options, identities);
    var manager = new FakeLocalUserRightManager(assigned: false);

    var readAdapter = new LocalUserRightReadCapabilityAdapter(policy, manager);
    using var readArguments = JsonDocument.Parse("""{"rightId":"service-logon"}""");
    var readResult = await readAdapter.ExecuteAsync(
      ReadContext,
      readArguments.RootElement,
      CancellationToken.None);
    using (var output = JsonDocument.Parse(readResult.OutputJson))
    {
      Assert.True(readAdapter.ValidateResult(output.RootElement).IsValid);
      Assert.False(output.RootElement.GetProperty("assigned").GetBoolean());
      Assert.Equal(manager.Principal.SidSha256,
        output.RootElement.GetProperty("principalSidSha256").GetString());
    }

    var vault = new RecordingRecoveryVault();
    var setAdapter = new LocalUserRightSetCapabilityAdapter(policy, manager, vault);
    using var setArguments = JsonDocument.Parse(
      """{"rightId":"service-logon","assigned":true}""");
    var setResult = await setAdapter.ExecuteAsync(
      MutationContext(readResult.PreStateSha256!),
      setArguments.RootElement,
      CancellationToken.None);
    using (var output = JsonDocument.Parse(setResult.OutputJson))
    {
      Assert.True(setAdapter.ValidateResult(output.RootElement).IsValid);
    }
    Assert.True(setResult.MutationCommitted);
    Assert.True(manager.Assigned);
    Assert.Equal("local-principal.right.set", vault.Operation);
    Assert.False(vault.Irreversible);

    var recovery = new LocalUserRightAdministrativeRecoveryOperation(policy, manager);
    Assert.True(recovery.Supports(vault.Operation));
    Assert.NotEqual(readResult.PreStateSha256, await recovery.ReadStateAsync(
      vault.Record(),
      CancellationToken.None));
    await recovery.RestoreAsync(vault.Record(), CancellationToken.None);
    Assert.False(manager.Assigned);
    Assert.Equal(readResult.PreStateSha256, await recovery.ReadStateAsync(
      vault.Record(),
      CancellationToken.None));
  }

  [Fact]
  public async Task RecoveryRejectsARecreatedPrincipalSid()
  {
    var options = Options.Create(ValidOptions());
    var identities = new LocalIdentityPolicy(options);
    var policy = new LocalUserRightPolicy(options, identities);
    var manager = new FakeLocalUserRightManager(assigned: false);
    var right = policy.Resolve("service-logon");
    var before = manager.Read(manager.Principal, right.RightName);
    var beforeSha256 = LocalUserRightReadCapabilityAdapter.State(right, before);
    var vault = new RecordingRecoveryVault();
    var adapter = new LocalUserRightSetCapabilityAdapter(policy, manager, vault);
    using var arguments = JsonDocument.Parse(
      """{"rightId":"service-logon","assigned":true}""");
    _ = await adapter.ExecuteAsync(
      MutationContext(beforeSha256),
      arguments.RootElement,
      CancellationToken.None);

    manager.ReplacePrincipalSid(CreateSid(1_501));
    var recovery = new LocalUserRightAdministrativeRecoveryOperation(policy, manager);
    var failure = await Assert.ThrowsAsync<HostRecoveryException>(() =>
      recovery.ReadStateAsync(vault.Record(), CancellationToken.None).AsTask());
    Assert.Equal("recovery_target_identity_changed", failure.ErrorCode);
    Assert.True(manager.Assigned);
  }

  [Fact]
  public async Task MutationRechecksRightStateAfterPreparingRecovery()
  {
    var options = Options.Create(ValidOptions());
    var identities = new LocalIdentityPolicy(options);
    var policy = new LocalUserRightPolicy(options, identities);
    var manager = new FakeLocalUserRightManager(assigned: false);
    var right = policy.Resolve("service-logon");
    var before = manager.Read(manager.Principal, right.RightName);
    var beforeSha256 = LocalUserRightReadCapabilityAdapter.State(right, before);
    var vault = new RecordingRecoveryVault(() => manager.SetExternally(assignedValue: true));
    var adapter = new LocalUserRightSetCapabilityAdapter(policy, manager, vault);
    using var arguments = JsonDocument.Parse(
      """{"rightId":"service-logon","assigned":true}""");

    var failure = await Assert.ThrowsAsync<HostPreconditionException>(() =>
      adapter.ExecuteAsync(
        MutationContext(beforeSha256),
        arguments.RootElement,
        CancellationToken.None).AsTask());

    Assert.Equal("local_user_right_state_changed", failure.ErrorCode);
    Assert.Equal(0, manager.SetCalls);
  }

  [Fact]
  public void PolicyAndSchemasRejectRawOrDangerousRights()
  {
    var options = ValidOptions();
    options.AllowedLocalUserRights[0].RightName = "SeDebugPrivilege";
    var configured = Options.Create(options);
    var identities = new LocalIdentityPolicy(configured);
    Assert.Throws<InvalidOperationException>(() =>
      new LocalUserRightPolicy(configured, identities));

    using var rawRight = JsonDocument.Parse(
      """{"rightId":"service-logon","principalId":"worker","rightName":"SeServiceLogonRight"}""");
    using var rawPrincipal = JsonDocument.Parse(
      """{"rightId":"service-logon","assigned":true,"principalName":"Administrator"}""");
    Assert.False(LocalUserRightCapabilitySchemas.ValidateTarget(
      rawRight.RootElement).IsValid);
    Assert.False(LocalUserRightCapabilitySchemas.ValidateSet(
      rawPrincipal.RootElement).IsValid);
  }

  [Fact]
  public void ProtectedRecoveryIdentityCannotBackAUserRightBinding()
  {
    var options = ValidOptions();
    options.AllowedLocalAccounts[0].AccountName =
      "ItembaMsaidiziRecoveryOperator";
    Assert.Throws<InvalidOperationException>(() =>
      new LocalIdentityPolicy(Options.Create(options)));
  }

  [Theory]
  [InlineData("service-appsettings.json")]
  [InlineData("recovery-appsettings.json")]
  public void PackagedLocalUserRightAllowlistsAreEmpty(string fileName)
  {
    var path = Path.Combine(AppContext.BaseDirectory, "test-assets", fileName);
    using var document = JsonDocument.Parse(File.ReadAllText(path));
    var host = document.RootElement.GetProperty("HostCapabilities");
    Assert.False(host.GetProperty("Enabled").GetBoolean());
    Assert.Empty(host.GetProperty("AllowedLocalUserRights").EnumerateArray());
  }

  private static readonly ActionExecutionContext ReadContext = new(
    "action",
    "task",
    "plan",
    "step",
    "device",
    "mandate",
    "idempotency",
    null,
    null,
    new ActionBudget(60, 10, 10, 0, 1_048_576, 1_048_576, 1));

  private static ActionExecutionContext MutationContext(string expectedPreState) =>
    ReadContext with
    {
      ActionId = Guid.NewGuid().ToString("N"),
      ExpectedPreStateSha256 = expectedPreState,
    };

  private static HostCapabilityOptions ValidOptions() => new()
  {
    AllowedLocalAccounts =
    [
      new AllowedLocalAccountOptions
      {
        Id = "worker",
        AccountName = "ManagedWorker",
        AllowRead = true,
      },
    ],
    AllowedLocalUserRights =
    [
      new AllowedLocalUserRightOptions
      {
        Id = "service-logon",
        PrincipalType = "account",
        PrincipalId = "worker",
        RightName = "SeServiceLogonRight",
        AllowRead = true,
        AllowGrant = true,
        AllowRevoke = true,
      },
    ],
  };

  private static byte[] CreateSid(uint rid)
  {
    var sid = new byte[28]
    {
      1, 5, 0, 0, 0, 0, 0, 5,
      21, 0, 0, 0,
      1, 0, 0, 0,
      2, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    };
    BitConverter.TryWriteBytes(sid.AsSpan(24), rid);
    return sid;
  }

  private sealed class FakeLocalUserRightManager(bool assigned) :
    IWindowsLocalUserRightManager
  {
    public LocalRightPrincipal Principal { get; private set; } =
      PrincipalFrom(CreateSid(1_500));

    public bool Assigned { get; private set; } = assigned;

    public int SetCalls { get; private set; }

    public LocalRightPrincipal ResolvePrincipal(
      string principalName,
      string principalType) => Principal;

    public LocalUserRightState Read(
      LocalRightPrincipal principal,
      string rightName) => new(Assigned, principal.SidSha256, 128);

    public void SetAssigned(
      LocalRightPrincipal principal,
      string rightName,
      bool assignedValue)
    {
      SetCalls++;
      Assigned = assignedValue;
    }

    public void SetExternally(bool assignedValue) => Assigned = assignedValue;

    public void ReplacePrincipalSid(byte[] sid) => Principal = PrincipalFrom(sid);

    private static LocalRightPrincipal PrincipalFrom(byte[] sid) => new(
      sid,
      Convert.ToHexString(SHA256.HashData(sid)).ToLowerInvariant());
  }

  private sealed class RecordingRecoveryVault(Action? afterPrepare = null) :
    IHostRecoveryVault
  {
    private static readonly JsonSerializerOptions WebSerializerOptions =
      new(JsonSerializerDefaults.Web);
    private ActionExecutionContext? _context;
    private JsonElement _recoveryRecord;
    private string _recordSha256 = string.Empty;

    public string Operation { get; private set; } = string.Empty;

    public bool Irreversible { get; private set; }

    public ValueTask<HostRecoveryReceipt> PrepareAsync(
      ActionExecutionContext context,
      string operation,
      string preStateSha256,
      object recoveryRecord,
      bool irreversible,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      _context = context;
      Operation = operation;
      Irreversible = irreversible;
      _recoveryRecord = JsonSerializer.SerializeToElement(
        recoveryRecord,
        WebSerializerOptions);
      _recordSha256 = PayloadDigest.Sha256Hex(_recoveryRecord.GetRawText());
      afterPrepare?.Invoke();
      return ValueTask.FromResult(new HostRecoveryReceipt(
        "opaque-right-handle",
        _recordSha256,
        "protected-right-record"));
    }

    public TrustedHostRecoveryRecord Record()
    {
      var context = Assert.IsType<ActionExecutionContext>(_context);
      return new TrustedHostRecoveryRecord(
        context.ActionId,
        context.TaskId,
        context.PlanVersionId,
        context.StepId,
        context.DeviceId,
        context.MandateId,
        Operation,
        context.ExpectedPreStateSha256!,
        Irreversible,
        _recordSha256,
        _recoveryRecord);
    }
  }
}
