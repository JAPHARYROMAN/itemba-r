using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;
using Microsoft.Win32;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class RegistryRecoveryCheckpointTests : IDisposable
{
  private static readonly JsonSerializerOptions WebJson = new(
    JsonSerializerDefaults.Web);

  private readonly string _parentSubKey;
  private readonly string _subKey;

  public RegistryRecoveryCheckpointTests()
  {
    _parentSubKey =
      $@"Software\Itemba\MsaidiziTests\RegistryCheckpoint\{Guid.NewGuid():N}";
    _subKey = $@"{_parentSubKey}\ManagedTarget";
    using var parent = Registry.CurrentUser.CreateSubKey(
      _parentSubKey,
      writable: true);
  }

  [Fact]
  public void StateDigestDistinguishesMissingKeyFromExistingKeyWithAbsentValue()
  {
    var missing = RegistryStateSupport.Read(key: null, "ManagedValue");
    using var existingKey = Registry.CurrentUser.CreateSubKey(_subKey, writable: true);
    Assert.NotNull(existingKey);
    var existing = RegistryStateSupport.Read(existingKey, "ManagedValue");

    Assert.False(missing.KeyExists);
    Assert.True(existing.KeyExists);
    Assert.False(missing.Exists);
    Assert.False(existing.Exists);
    Assert.NotEqual(missing.StateSha256, existing.StateSha256);
    Assert.Equal(missing.LegacyStateSha256, existing.LegacyStateSha256);
  }

  [Fact]
  public void RegistryV1CapabilityLookupFailsClosedAfterStateContractUpgrade()
  {
    var policy = new RegistryTargetPolicy(Options.Create(new HostCapabilityOptions
    {
      AllowedRegistryRoots =
      [
        new AllowedRegistryRootOptions
        {
          Id = "contract-test",
          Hive = "LocalMachine",
          SubKey = @"SOFTWARE\Contoso\MsaidiziContractTest",
          AllowRead = true,
        },
      ],
      AllowedRegistryDurableValueTargets =
      [
        new AllowedRegistryDurableValueTargetOptions
        {
          RootId = "contract-test",
          RelativeKey = string.Empty,
          ValueName = "ProductName",
          Classification = DurableNonSecretValuePolicy.Classification,
          AllowedValueTypes = ["String"],
        },
      ],
    }));
    var adapter = new RegistryValueReadCapabilityAdapter(policy);
    var registry = new CapabilityRegistry([adapter]);

    Assert.False(registry.TryResolve(adapter.Descriptor.Id, "1.0.0", out _));
    Assert.False(registry.TryResolve(adapter.Descriptor.Id, "2.0.0", out _));
    Assert.True(registry.TryResolve(
      adapter.Descriptor.Id,
      RegistryCapabilitySchemas.CapabilityVersion,
      out var resolved));
    Assert.Same(adapter, resolved);
  }

  [Fact]
  public async Task RecoveryPreparationFailureLeavesPreviouslyAbsentKeyAbsent()
  {
    var target = Target();
    var before = RegistryStateSupport.Read(key: null, target.ValueName);
    using var arguments = Arguments();

    await Assert.ThrowsAsync<IOException>(() => RegistryValueMutationSupport.SetAsync(
      Context(before.StateSha256),
      "registry.value.set",
      target,
      arguments.RootElement,
      new ThrowingRecoveryVault(),
      CancellationToken.None).AsTask());

    using var key = Registry.CurrentUser.OpenSubKey(_subKey, writable: false);
    Assert.Null(key);
  }

  [Fact]
  public async Task MissingParentIsRefusedWithoutCreatingAKeyHierarchyOrCheckpoint()
  {
    Registry.CurrentUser.DeleteSubKeyTree(
      _parentSubKey,
      throwOnMissingSubKey: false);
    var target = Target();
    var before = RegistryStateSupport.Read(key: null, target.ValueName);
    using var arguments = Arguments();
    var recovery = new RecordingRecoveryVault();

    var failure = await Assert.ThrowsAsync<HostPreconditionException>(() =>
      RegistryValueMutationSupport.SetAsync(
        Context(before.StateSha256),
        "registry.value.set",
        target,
        arguments.RootElement,
        recovery,
        CancellationToken.None).AsTask());

    Assert.Equal("registry_parent_key_unavailable", failure.ErrorCode);
    Assert.Equal(0, recovery.Count);
    Assert.Null(Registry.CurrentUser.OpenSubKey(_parentSubKey, writable: false));
  }

  [Fact]
  public async Task ConditionalCreateRefusesAKeyCreatedDuringRecoveryPreparation()
  {
    var target = Target();
    var before = RegistryStateSupport.Read(key: null, target.ValueName);
    using var arguments = Arguments();
    var recovery = new RecordingRecoveryVault
    {
      AfterPrepare = () =>
      {
        using var raced = Registry.CurrentUser.CreateSubKey(_subKey, writable: true);
        raced.SetValue("ExternalValue", 7, RegistryValueKind.DWord);
        raced.Flush();
      },
    };

    var failure = await Assert.ThrowsAsync<HostPreconditionException>(() =>
      RegistryValueMutationSupport.SetAsync(
        Context(before.StateSha256),
        "registry.value.set",
        target,
        arguments.RootElement,
        recovery,
        CancellationToken.None).AsTask());

    Assert.Equal("registry_key_changed_before_set", failure.ErrorCode);
    using var key = Registry.CurrentUser.OpenSubKey(_subKey, writable: false);
    Assert.NotNull(key);
    Assert.Equal(7, key.GetValue("ExternalValue"));
    Assert.Null(key.GetValue(target.ValueName));
  }

  [Fact]
  public async Task SuccessfulConditionalCreateSnapshotsKeyAbsenceBeforeCreatingTarget()
  {
    var target = Target();
    var before = RegistryStateSupport.Read(key: null, target.ValueName);
    using var arguments = Arguments();
    var recovery = new RecordingRecoveryVault
    {
      AfterPrepare = () => Assert.Null(
        Registry.CurrentUser.OpenSubKey(_subKey, writable: false)),
    };

    var mutation = await RegistryValueMutationSupport.SetAsync(
      Context(before.StateSha256),
      "registry.value.set",
      target,
      arguments.RootElement,
      recovery,
      CancellationToken.None);

    Assert.False(mutation.Before.KeyExists);
    Assert.True(mutation.After.KeyExists);
    Assert.True(mutation.After.Exists);
    Assert.False(recovery.Record.GetProperty("keyExisted").GetBoolean());
    Assert.Equal(
      RegistryCapabilitySchemas.RecoveryRecordContract,
      recovery.Record.GetProperty("recordContract").GetString());
    using var key = Registry.CurrentUser.OpenSubKey(_subKey, writable: false);
    Assert.NotNull(key);
    Assert.Equal(42, key.GetValue(target.ValueName));
  }

  [Fact]
  public async Task SuccessfulSetOnExistingEmptyKeySnapshotsKeyExistence()
  {
    using (var existing = Registry.CurrentUser.CreateSubKey(_subKey, writable: true))
    {
      Assert.NotNull(existing);
    }
    var target = Target();
    using var observedKey = Registry.CurrentUser.OpenSubKey(_subKey, writable: false);
    var before = RegistryStateSupport.Read(observedKey, target.ValueName);
    using var arguments = Arguments();
    var recovery = new RecordingRecoveryVault();

    var mutation = await RegistryValueMutationSupport.SetAsync(
      Context(before.StateSha256),
      "registry.value.set",
      target,
      arguments.RootElement,
      recovery,
      CancellationToken.None);

    Assert.True(mutation.Before.KeyExists);
    Assert.True(recovery.Record.GetProperty("keyExisted").GetBoolean());
    Assert.Equal(
      RegistryCapabilitySchemas.RecoveryRecordContract,
      recovery.Record.GetProperty("recordContract").GetString());
    Assert.False(recovery.Record.GetProperty("exists").GetBoolean());
    using var key = Registry.CurrentUser.OpenSubKey(_subKey, writable: false);
    Assert.NotNull(key);
    Assert.Equal(42, key.GetValue(target.ValueName));
  }

  [Fact]
  public void RecoveryRemovesAnExactActionCreatedKey()
  {
    var target = Target();
    using (var key = Registry.CurrentUser.CreateSubKey(_subKey, writable: true))
    {
      key.SetValue(target.ValueName, 42, RegistryValueKind.DWord);
      key.Flush();
    }
    using var baseKey = RegistryKey.OpenBaseKey(
      RegistryHive.CurrentUser,
      RegistryView.Registry64);

    RegistryRecoverySupport.RemoveActionCreatedKey(
      baseKey,
      target,
      CancellationToken.None);

    Assert.Null(Registry.CurrentUser.OpenSubKey(_subKey, writable: false));
  }

  [Fact]
  public void RecoveryRemovesAnEmptyKeyLeftAfterConditionalCreate()
  {
    var target = Target();
    using (var key = Registry.CurrentUser.CreateSubKey(_subKey, writable: true))
    {
      Assert.NotNull(key);
    }
    using var baseKey = RegistryKey.OpenBaseKey(
      RegistryHive.CurrentUser,
      RegistryView.Registry64);

    RegistryRecoverySupport.RemoveActionCreatedKey(
      baseKey,
      target,
      CancellationToken.None);

    Assert.Null(Registry.CurrentUser.OpenSubKey(_subKey, writable: false));
  }

  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public void RecoveryRefusesUnrelatedKeyStateWithoutDeletingAnything(bool addSubKey)
  {
    var target = Target();
    using (var key = Registry.CurrentUser.CreateSubKey(_subKey, writable: true))
    {
      key.SetValue(target.ValueName, 42, RegistryValueKind.DWord);
      if (addSubKey)
      {
        using var child = key.CreateSubKey("ExternalChild", writable: true);
      }
      else
      {
        key.SetValue("ExternalValue", 9, RegistryValueKind.DWord);
      }
      key.Flush();
    }
    using var baseKey = RegistryKey.OpenBaseKey(
      RegistryHive.CurrentUser,
      RegistryView.Registry64);

    var failure = Assert.Throws<HostRecoveryException>(() =>
      RegistryRecoverySupport.RemoveActionCreatedKey(
        baseKey,
        target,
        CancellationToken.None));

    Assert.Equal("recovery_precondition_mismatch", failure.ErrorCode);
    using var remaining = Registry.CurrentUser.OpenSubKey(_subKey, writable: false);
    Assert.NotNull(remaining);
    Assert.Equal(42, remaining.GetValue(target.ValueName));
    if (addSubKey)
    {
      Assert.Contains("ExternalChild", remaining.GetSubKeyNames());
    }
    else
    {
      Assert.Equal(9, remaining.GetValue("ExternalValue"));
    }
  }

  [Fact]
  public void LegacyRecoveryRecordRetainsValueOnlyStateDigest()
  {
    using var legacy = JsonDocument.Parse(
      """{"rootId":"legacy","subKey":"Software\\Legacy","valueName":"Value","exists":false,"valueType":null,"value":null}""");
    using var current = JsonDocument.Parse(
      """{"recordContract":"windows-registry-value-recovery/v2","rootId":"current","subKey":"Software\\Current","valueName":"Value","keyExisted":false,"exists":false,"valueType":null,"value":null}""");
    var state = RegistryStateSupport.Read(key: null, "Value");

    Assert.Equal(
      state.LegacyStateSha256,
      RegistryRecoverySupport.StateSha256(legacy.RootElement, state));
    Assert.Equal(
      state.StateSha256,
      RegistryRecoverySupport.StateSha256(current.RootElement, state));
  }

  [Fact]
  public void UnversionedKeyExistenceRecoveryRecordIsRejected()
  {
    using var unversioned = JsonDocument.Parse(
      """{"rootId":"current","subKey":"Software\\Current","valueName":"Value","keyExisted":false,"exists":false,"valueType":null,"value":null}""");
    var state = RegistryStateSupport.Read(key: null, "Value");

    var failure = Assert.Throws<HostRecoveryException>(() =>
      RegistryRecoverySupport.StateSha256(unversioned.RootElement, state));

    Assert.Equal("recovery_record_version_unsupported", failure.ErrorCode);
  }

  private ResolvedRegistryTarget Target() => new(
    RegistryHive.CurrentUser,
    "test-root",
    _subKey,
    "ManagedValue",
    AllowRead: true,
    AllowWrite: true,
    AllowDelete: true);

  private static JsonDocument Arguments() => JsonDocument.Parse(
    """{"rootId":"test-root","relativeKey":"","valueName":"ManagedValue","valueType":"DWord","value":42}""");

  private static ActionExecutionContext Context(string expectedPreStateSha256) => new(
    "registry-checkpoint-action",
    "task",
    "plan",
    "step",
    "device",
    "mandate",
    "registry-checkpoint-idempotency",
    expectedPreStateSha256,
    null,
    new ActionBudget(60, 10, 20, 10, 1_000_000, 1_000_000, 1m));

  public void Dispose()
  {
    Registry.CurrentUser.DeleteSubKeyTree(
      _parentSubKey,
      throwOnMissingSubKey: false);
  }

  private sealed class ThrowingRecoveryVault : IHostRecoveryVault
  {
    public ValueTask<HostRecoveryReceipt> PrepareAsync(
      ActionExecutionContext context,
      string operation,
      string preStateSha256,
      object recoveryRecord,
      bool irreversible,
      CancellationToken cancellationToken) =>
      ValueTask.FromException<HostRecoveryReceipt>(
        new IOException("Simulated RecoveryPrepared failure."));
  }

  private sealed class RecordingRecoveryVault : IHostRecoveryVault
  {
    public Action? AfterPrepare { get; init; }

    public int Count { get; private set; }

    public JsonElement Record { get; private set; }

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
      Record = JsonSerializer.SerializeToElement(
        recoveryRecord,
        WebJson);
      AfterPrepare?.Invoke();
      return ValueTask.FromResult(new HostRecoveryReceipt(
        PayloadDigest.Sha256Hex("opaque-handle"),
        PayloadDigest.Sha256Hex("recovery-record"),
        "protected-record"));
    }
  }
}
