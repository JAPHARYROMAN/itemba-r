using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Execution;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;
using Microsoft.Win32;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class DurableValueSecretBoundaryTests
{
  private static readonly string ZeroSha256 = new('0', 64);
  private static readonly string OneSha256 = new('1', 64);

  [Fact]
  public void RegistryV3AndEnvironmentV2DescriptorsAreExactAndOlderVersionsFail()
  {
    var registryPolicy = new RegistryTargetPolicy(
      Options.Create(ValidRegistryOptions()));
    var environmentPolicy = new MachineEnvironmentPolicy(
      Options.Create(ValidEnvironmentOptions()));
    var recovery = new NeverCalledRecoveryVault();
    var registryAdapters = new IHostCapabilityAdapter[]
    {
      new RegistryValueReadCapabilityAdapter(registryPolicy),
      new RegistryValueSetCapabilityAdapter(registryPolicy, recovery),
      new RegistryValueDeleteCapabilityAdapter(registryPolicy, recovery),
    };
    var environmentAdapters = new IHostCapabilityAdapter[]
    {
      new MachineEnvironmentReadCapabilityAdapter(environmentPolicy),
      new MachineEnvironmentSetCapabilityAdapter(environmentPolicy, recovery),
      new MachineEnvironmentDeleteCapabilityAdapter(environmentPolicy, recovery),
    };

    AssertDescriptors(
      registryAdapters,
      RegistryCapabilitySchemas.CapabilityVersion,
      "windows-registry");
    AssertDescriptors(
      environmentAdapters,
      MachineEnvironmentSchemas.CapabilityVersion,
      "machine-environment");
    Assert.Equal("3.0.0", RegistryCapabilitySchemas.CapabilityVersion);
    Assert.Equal("2.0.0", MachineEnvironmentSchemas.CapabilityVersion);
    Assert.Equal(
      "windows-registry-value-recovery/v2",
      RegistryCapabilitySchemas.RecoveryRecordContract);
    Assert.Equal(
      "windows-machine-environment-recovery/v1",
      MachineEnvironmentSchemas.RecoveryRecordContract);
  }

  [Fact]
  public void BroadRegistryRootCannotEscapeTheExactDurableTargetOrType()
  {
    var policy = new RegistryTargetPolicy(Options.Create(ValidRegistryOptions()));
    using var exactRead = JsonDocument.Parse(
      """{"rootId":"managed","relativeKey":"Public","valueName":"Mode"}""");
    using var exactSet = JsonDocument.Parse(
      """{"rootId":"managed","relativeKey":"Public","valueName":"Mode","valueType":"DWord","value":7}""");
    var readTarget = policy.Resolve(exactRead.RootElement, requireRead: true);
    var writeTarget = policy.Resolve(exactSet.RootElement, requireWrite: true);

    Assert.Equal(@"SOFTWARE\Contoso\Managed\Public", readTarget.SubKey);
    Assert.Contains(RegistryValueKind.DWord, readTarget.DurableAllowedValueTypes!);
    Assert.Equal(readTarget, writeTarget);

    var rejected = new[]
    {
      """{"rootId":"managed","relativeKey":"Private","valueName":"Mode"}""",
      """{"rootId":"managed","relativeKey":"Public","valueName":"Alternate"}""",
      """{"rootId":"managed","relativeKey":"Public\\Child","valueName":"Mode"}""",
    };
    foreach (var json in rejected)
    {
      using var arguments = JsonDocument.Parse(json);
      var error = Assert.Throws<HostPreconditionException>(() =>
        policy.Resolve(arguments.RootElement, requireRead: true));
      Assert.Equal("registry_durable_target_not_allowed", error.ErrorCode);
    }

    using var wrongType = JsonDocument.Parse(
      """{"rootId":"managed","relativeKey":"Public","valueName":"Mode","valueType":"String","value":"west"}""");
    var typeError = Assert.Throws<HostPreconditionException>(() =>
      policy.Resolve(wrongType.RootElement, requireWrite: true));
    Assert.Equal("registry_durable_value_type_not_allowed", typeError.ErrorCode);

    using var delete = JsonDocument.Parse(
      """{"rootId":"managed","relativeKey":"Private","valueName":"AnyValue"}""");
    var deleteTarget = policy.Resolve(delete.RootElement, requireDelete: true);
    Assert.Equal(@"SOFTWARE\Contoso\Managed\Private", deleteTarget.SubKey);
    Assert.Null(deleteTarget.DurableAllowedValueTypes);
  }

  [Fact]
  public void RegistryConfigOmissionClassificationAndTypeTyposFailClosed()
  {
    var noTarget = ValidRegistryOptions();
    noTarget.AllowedRegistryDurableValueTargets = [];
    AssertRegistryConfigInvalid(noTarget);

    var typo = ValidRegistryOptions();
    typo.AllowedRegistryDurableValueTargets[0].Classification =
      "durable-non-secert";
    AssertRegistryConfigInvalid(typo);

    var noTypes = ValidRegistryOptions();
    noTypes.AllowedRegistryDurableValueTargets[0].AllowedValueTypes = [];
    AssertRegistryConfigInvalid(noTypes);

    var unknownType = ValidRegistryOptions();
    unknownType.AllowedRegistryDurableValueTargets[0].AllowedValueTypes =
      ["DWORD"];
    AssertRegistryConfigInvalid(unknownType);

    var duplicateType = ValidRegistryOptions();
    duplicateType.AllowedRegistryDurableValueTargets[0].AllowedValueTypes =
      ["DWord", "DWord"];
    AssertRegistryConfigInvalid(duplicateType);

    var binaryType = ValidRegistryOptions();
    binaryType.AllowedRegistryDurableValueTargets[0].AllowedValueTypes =
      ["Binary"];
    AssertRegistryConfigInvalid(binaryType);

    var duplicateAlias = ValidRegistryOptions();
    duplicateAlias.AllowedRegistryDurableValueTargets.Add(
      new AllowedRegistryDurableValueTargetOptions
      {
        RootId = "managed",
        RelativeKey = "public",
        ValueName = "mode",
        Classification = DurableNonSecretValuePolicy.Classification,
        AllowedValueTypes = ["DWord"],
      });
    AssertRegistryConfigInvalid(duplicateAlias);

    var physicalAlias = ValidRegistryOptions();
    physicalAlias.AllowedRegistryRoots.Add(new AllowedRegistryRootOptions
    {
      Id = "managed-alias",
      Hive = "LocalMachine",
      SubKey = @"SOFTWARE\Contoso",
      AllowRead = true,
    });
    physicalAlias.AllowedRegistryDurableValueTargets.Add(
      new AllowedRegistryDurableValueTargetOptions
      {
        RootId = "managed-alias",
        RelativeKey = @"Managed\Public",
        ValueName = "Mode",
        Classification = DurableNonSecretValuePolicy.Classification,
        AllowedValueTypes = ["DWord"],
      });
    AssertRegistryConfigInvalid(physicalAlias);
  }

  [Theory]
  [InlineData("root", @"SOFTWARE\Contoso\ConnectionString", "Public", "Mode")]
  [InlineData("relative", @"SOFTWARE\Contoso\Managed", "PrivateKeys", "Mode")]
  [InlineData("value", @"SOFTWARE\Contoso\Managed", "Public", "AccessToken")]
  public void CredentialLikeRegistrySegmentsFailEvenWhenClassified(
    string _,
    string rootSubKey,
    string relativeKey,
    string valueName)
  {
    var options = ValidRegistryOptions();
    options.AllowedRegistryRoots[0].SubKey = rootSubKey;
    options.AllowedRegistryDurableValueTargets[0].RelativeKey = relativeKey;
    options.AllowedRegistryDurableValueTargets[0].ValueName = valueName;

    AssertRegistryConfigInvalid(options);
  }

  [Fact]
  public void RegistrySetAndReadValidationRejectSecretBearingPayloads()
  {
    var sensitive = SensitiveValue();
    using var benignSet = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      rootId = "managed",
      relativeKey = "Public",
      valueName = "Mode",
      valueType = "String",
      value = "site=west",
    }));
    using var sensitiveSet = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      rootId = "managed",
      relativeKey = "Public",
      valueName = "Mode",
      valueType = "String",
      value = sensitive,
    }));
    using var sensitiveBinary = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      rootId = "managed",
      relativeKey = "Public",
      valueName = "Mode",
      valueType = "Binary",
      value = Convert.ToBase64String(Encoding.UTF8.GetBytes(sensitive)),
    }));
    using var sensitiveMultiString = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      rootId = "managed",
      relativeKey = "Public",
      valueName = "Mode",
      valueType = "MultiString",
      value = new[] { "site=west", sensitive },
    }));

    Assert.True(RegistryCapabilitySchemas.ValidateSet(benignSet.RootElement).IsValid);
    Assert.False(RegistryCapabilitySchemas.ValidateSet(sensitiveSet.RootElement).IsValid);
    Assert.False(RegistryCapabilitySchemas.ValidateSet(sensitiveBinary.RootElement).IsValid);
    Assert.False(RegistryCapabilitySchemas.ValidateSet(
      sensitiveMultiString.RootElement).IsValid);

    using var sensitiveResult = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      exists = true,
      valueType = "String",
      value = sensitive,
      stateSha256 = ZeroSha256,
    }));
    Assert.False(RegistryCapabilitySchemas.ValidateReadResult(
      sensitiveResult.RootElement).IsValid);
  }

  [Fact]
  public void RegistryReadResultTreatsValuesAsUntrustedAndRejectsSecretState()
  {
    var target = RegistryTarget();
    var benign = RegistryState("site=west");
    var result = RegistryValueReadCapabilityAdapter.Result(target, benign);
    using var output = JsonDocument.Parse(result.OutputJson);

    Assert.True(RegistryCapabilitySchemas.ValidateReadResult(output.RootElement).IsValid);
    Assert.Equal("site=west", output.RootElement.GetProperty("value").GetString());
    var provenance = Assert.Single(result.Provenance);
    Assert.Equal("windows-registry", provenance.SourceType);
    Assert.Equal(ProvenanceTrust.UntrustedContent, provenance.Trust);

    var error = Assert.Throws<HostPreconditionException>(() =>
      RegistryValueReadCapabilityAdapter.Result(
        target,
        RegistryState(SensitiveValue())));
    Assert.Equal("registry_durable_value_secret_detected", error.ErrorCode);

    var observedTypeDrift = new RegistryState(
      KeyExists: true,
      Exists: true,
      ValueType: "DWord",
      Value: 7,
      LegacyStateSha256: ZeroSha256,
      StateSha256: OneSha256,
      ByteCount: 32);
    Assert.Throws<HostPreconditionException>(() =>
      RegistryValueReadCapabilityAdapter.Result(target, observedTypeDrift));
  }

  [Fact]
  public void RegistryMutationResultKeepsPriorRawValueOnlyInRecoveryRecord()
  {
    var sensitive = SensitiveValue();
    var target = RegistryTarget();
    var before = RegistryState(sensitive);
    var after = new RegistryState(
      KeyExists: true,
      Exists: true,
      ValueType: "DWord",
      Value: 7,
      LegacyStateSha256: ZeroSha256,
      StateSha256: OneSha256,
      ByteCount: 32);
    var recovery = RecoveryReceipt();
    var result = RegistryValueSetCapabilityAdapter.Result(
      target,
      new RegistrySetMutation(before, after, recovery));
    var serializedResult = JsonSerializer.Serialize(result);
    var recoveryRecord = JsonSerializer.Serialize(
      RegistryValueMutationSupport.CreateRecoveryRecord(target, before));
    using var recoveryDocument = JsonDocument.Parse(recoveryRecord);

    AssertNoSensitivePlaintext(serializedResult, sensitive);
    Assert.True(recoveryRecord.Contains(sensitive, StringComparison.Ordinal));
    Assert.Equal(2, result.Provenance.Count);
    Assert.Equal(ProvenanceTrust.UntrustedContent, result.Provenance[0].Trust);
    Assert.Equal(ProvenanceTrust.TrustedSystem, result.Provenance[1].Trust);
    Assert.Equal(
      RegistryCapabilitySchemas.RecoveryRecordContract,
      recoveryDocument.RootElement
        .GetProperty("recordContract")
        .GetString());
  }

  [Fact]
  public void RegistryRecoveryRemainsAvailableWithoutDurableReadTargets()
  {
    var options = new HostCapabilityOptions
    {
      AllowedRegistryRoots =
      [
        new AllowedRegistryRootOptions
        {
          Id = "cleanup-only",
          Hive = "LocalMachine",
          SubKey = @"SOFTWARE\Contoso\Cleanup",
          AllowDelete = true,
        },
      ],
    };
    var policy = new RegistryTargetPolicy(Options.Create(options));
    using var recovery = JsonDocument.Parse(
      $$"""{"recordContract":"{{RegistryCapabilitySchemas.RecoveryRecordContract}}","rootId":"cleanup-only","subKey":"SOFTWARE\\Contoso\\Cleanup\\Retired","valueName":"PriorValue","keyExisted":true,"exists":false,"valueType":null,"value":null}""");

    var target = policy.ResolveRecovery(recovery.RootElement);

    Assert.Equal(@"SOFTWARE\Contoso\Cleanup\Retired", target.SubKey);
    Assert.Null(target.DurableAllowedValueTypes);
    Assert.True(RegistryRecoverySupport.HasKeyExistenceSnapshot(
      recovery.RootElement));
  }

  [Fact]
  public void CredentialLikeRegistryCleanupRequiresAnExactDeleteOnlyTarget()
  {
    var options = new HostCapabilityOptions
    {
      AllowedRegistryRoots =
      [
        new AllowedRegistryRootOptions
        {
          Id = "cleanup-only",
          Hive = "LocalMachine",
          SubKey = @"SOFTWARE\Contoso\Cleanup",
          AllowDelete = true,
        },
      ],
      AllowedRegistryDeleteTargets =
      [
        new AllowedRegistryDeleteTargetOptions
        {
          RootId = "cleanup-only",
          RelativeKey = "RetiredSecrets",
          ValueName = "AccessToken",
        },
      ],
    };
    using var arguments = JsonDocument.Parse(
      """{"rootId":"cleanup-only","relativeKey":"RetiredSecrets","valueName":"AccessToken"}""");
    var allowed = new RegistryTargetPolicy(Options.Create(options));

    var target = allowed.Resolve(arguments.RootElement, requireDelete: true);

    Assert.Equal(@"SOFTWARE\Contoso\Cleanup\RetiredSecrets", target.SubKey);
    Assert.Null(target.DurableAllowedValueTypes);

    options.AllowedRegistryDeleteTargets = [];
    var denied = new RegistryTargetPolicy(Options.Create(options));
    var error = Assert.Throws<HostPreconditionException>(() =>
      denied.Resolve(arguments.RootElement, requireDelete: true));
    Assert.Equal("registry_delete_target_not_allowed", error.ErrorCode);
  }

  [Fact]
  public void MachineEnvironmentClassificationOmissionTypoAndAliasesFailClosed()
  {
    var omitted = ValidEnvironmentOptions();
    omitted.AllowedMachineEnvironmentVariables[0].Classification = string.Empty;
    AssertEnvironmentConfigInvalid(omitted);

    var typo = ValidEnvironmentOptions();
    typo.AllowedMachineEnvironmentVariables[0].Classification =
      "durable-non-secert";
    AssertEnvironmentConfigInvalid(typo);

    var alias = ValidEnvironmentOptions();
    alias.AllowedMachineEnvironmentVariables.Add(
      new AllowedMachineEnvironmentVariableOptions
      {
        Id = "site-mode-alias",
        Name = "itemba_site_mode",
        Classification = DurableNonSecretValuePolicy.Classification,
        AllowRead = true,
      });
    AssertEnvironmentConfigInvalid(alias);

    var duplicateId = ValidEnvironmentOptions();
    duplicateId.AllowedMachineEnvironmentVariables.Add(
      new AllowedMachineEnvironmentVariableOptions
      {
        Id = "site-mode",
        Name = "ITEMBA_SECOND_SITE_MODE",
        Classification = DurableNonSecretValuePolicy.Classification,
        AllowRead = true,
      });
    AssertEnvironmentConfigInvalid(duplicateId);
  }

  [Theory]
  [InlineData("SERVICE_TOKEN")]
  [InlineData("DATABASE_PASSWORD")]
  [InlineData("CLIENT_SECRET")]
  [InlineData("API_PRIVATE_KEY")]
  [InlineData("CLOUD_ACCESS_KEY")]
  [InlineData("DATABASE_CONNECTION_STRING")]
  [InlineData("AUTH_CREDENTIAL")]
  [InlineData("BEARER_AUTH")]
  public void CredentialLikeEnvironmentNamesFailEvenWhenClassified(string name)
  {
    var options = ValidEnvironmentOptions();
    options.AllowedMachineEnvironmentVariables[0].Name = name;

    AssertEnvironmentConfigInvalid(options);
  }

  [Fact]
  public void EnvironmentDeleteOnlyAuthorityNeedsNoRawClassification()
  {
    var options = new HostCapabilityOptions
    {
      AllowedMachineEnvironmentVariables =
      [
        new AllowedMachineEnvironmentVariableOptions
        {
          Id = "retired-site-mode",
          Name = "ITEMBA_RETIRED_ACCESS_TOKEN",
          AllowDelete = true,
        },
      ],
    };
    var policy = new MachineEnvironmentPolicy(Options.Create(options));
    using var arguments = JsonDocument.Parse(
      """{"variableId":"retired-site-mode"}""");

    var target = policy.Resolve(arguments.RootElement, requireDelete: true);
    Assert.True(target.AllowDelete);
    var error = Assert.Throws<HostPreconditionException>(() =>
      policy.Resolve(arguments.RootElement, requireRead: true));
    Assert.Equal("machine_environment_target_not_allowed", error.ErrorCode);

    using var recovery = JsonDocument.Parse(
      """{"id":"retired-site-mode","name":"ITEMBA_RETIRED_ACCESS_TOKEN","value":"protected-only"}""");
    Assert.Equal(
      target,
      policy.ResolveRecovery(recovery.RootElement));
  }

  [Fact]
  public void EnvironmentSchemasAndReadResultRejectSecretBearingPayloads()
  {
    var sensitive = SensitiveValue();
    using var benignSet = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      variableId = "site-mode",
      value = "site=west",
    }));
    using var sensitiveSet = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      variableId = "site-mode",
      value = sensitive,
    }));
    using var sensitiveResult = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      exists = true,
      value = sensitive,
      stateSha256 = ZeroSha256,
    }));

    Assert.True(MachineEnvironmentSchemas.ValidateSet(benignSet.RootElement).IsValid);
    Assert.False(MachineEnvironmentSchemas.ValidateSet(sensitiveSet.RootElement).IsValid);
    Assert.False(MachineEnvironmentSchemas.ValidateReadResult(
      sensitiveResult.RootElement).IsValid);
  }

  [Fact]
  public void EnvironmentReadAndMutationProvenanceKeepsContentUntrusted()
  {
    var target = EnvironmentTarget();
    var benign = EnvironmentState("site=west", ZeroSha256);
    var read = MachineEnvironmentReadCapabilityAdapter.Result(target, benign);
    Assert.Equal(
      ProvenanceTrust.UntrustedContent,
      Assert.Single(read.Provenance).Trust);

    var error = Assert.Throws<HostPreconditionException>(() =>
      MachineEnvironmentReadCapabilityAdapter.Result(
        target,
        EnvironmentState(SensitiveValue(), ZeroSha256)));
    Assert.Equal(
      "machine_environment_durable_value_secret_detected",
      error.ErrorCode);

    var sensitive = SensitiveValue();
    var before = EnvironmentState(sensitive, ZeroSha256);
    var after = EnvironmentState("site=east", OneSha256);
    var mutation = MachineEnvironmentSetCapabilityAdapter.Result(
      JsonSerializer.Serialize(new { committed = true, stateSha256 = OneSha256 }),
      target,
      before,
      after,
      RecoveryReceipt());
    AssertNoSensitivePlaintext(JsonSerializer.Serialize(mutation), sensitive);
    Assert.Equal(ProvenanceTrust.UntrustedContent, mutation.Provenance[0].Trust);
    Assert.Equal(ProvenanceTrust.TrustedSystem, mutation.Provenance[1].Trust);
  }

  [Fact]
  public void EnvironmentRecoveryAcceptsLegacyAndVersionedProtectedRecords()
  {
    var policy = new MachineEnvironmentPolicy(
      Options.Create(ValidEnvironmentOptions()));
    using var legacy = JsonDocument.Parse(
      """{"id":"site-mode","name":"ITEMBA_SITE_MODE","exists":true,"value":"legacy"}""");
    using var versioned = JsonDocument.Parse(
      $$"""{"recordContract":"{{MachineEnvironmentSchemas.RecoveryRecordContract}}","id":"site-mode","name":"ITEMBA_SITE_MODE","exists":true,"value":"current"}""");
    using var unsupported = JsonDocument.Parse(
      """{"recordContract":"windows-machine-environment-recovery/v2","id":"site-mode","name":"ITEMBA_SITE_MODE","exists":true,"value":"future"}""");

    Assert.Equal("ITEMBA_SITE_MODE", policy.ResolveRecovery(legacy.RootElement).Name);
    Assert.Equal("ITEMBA_SITE_MODE", policy.ResolveRecovery(versioned.RootElement).Name);
    var error = Assert.Throws<HostRecoveryException>(() =>
      policy.ResolveRecovery(unsupported.RootElement));
    Assert.Equal("recovery_record_version_unsupported", error.ErrorCode);
  }

  [Fact]
  public async Task AllowedReadOutputIsProtectedInTheResultCacheFixture()
  {
    var directory = Path.Combine(
      Path.GetTempPath(),
      $"msaidizi-durable-result-{Guid.NewGuid():N}");
    var safeValue = $"site-{Guid.NewGuid():N}";
    try
    {
      using var store = new FileProtectedActionResultStore(
        Options.Create(new CompanionOptions { ResultCachePath = directory }));
      var capabilityResult = MachineEnvironmentReadCapabilityAdapter.Result(
        EnvironmentTarget(),
        EnvironmentState(safeValue, ZeroSha256));
      var request = ActionTokenVerifierTests.CreateRequest(
        """{"variableId":"site-mode"}""") with
      {
        CapabilityId = "environment.machine.read",
        CapabilityVersion = MachineEnvironmentSchemas.CapabilityVersion,
      };
      const long resultUpperBound = 16_384;
      var result = new ActionResult(
        request.ActionId,
        request.TaskId,
        request.StepId,
        ActionOutcome.Completed,
        capabilityResult.OutputJson,
        PayloadDigest.Sha256Hex(capabilityResult.OutputJson),
        MutationCommitted: false,
        OutcomeUncertain: false,
        IsIdempotentReplay: false,
        ErrorCode: null,
        capabilityResult.Provenance,
        PreStateSha256: capabilityResult.PreStateSha256,
        LocalBytesRead: capabilityResult.LocalBytesRead,
        BrokerExternalEgressBytes: resultUpperBound,
        BrokerMaxDeliverySessions: 1,
        BrokerMaxRequestAttemptsPerSession: 1,
        BrokerSerializedResultUpperBoundBytes: resultUpperBound,
        ActionTokenSha256: OneSha256);

      await store.StoreAsync(
        request,
        result,
        maximumExternalEgressBytes: resultUpperBound,
        CancellationToken.None);

      var protectedBytes = await File.ReadAllBytesAsync(
        Assert.Single(Directory.GetFiles(directory, "*.bin")));
      Assert.False(ContainsSequence(
        protectedBytes,
        Encoding.UTF8.GetBytes(safeValue)));
    }
    finally
    {
      if (Directory.Exists(directory))
      {
        Directory.Delete(directory, recursive: true);
      }
    }
  }

  [Fact]
  public void PackagedServiceConfigsAreDefaultOffAndDurableAllowlistsAreEmpty()
  {
    var root = FindRepositoryRoot();
    var paths = new[]
    {
      Path.Combine(
        root,
        "windows-companion",
        "src",
        "Msaidizi.Companion.Service",
        "appsettings.json"),
      Path.Combine(
        root,
        "windows-companion",
        "installer",
        "config",
        "service",
        "appsettings.json"),
      Path.Combine(
        root,
        "windows-companion",
        "config",
        "service.production.example.json"),
    };

    foreach (var path in paths)
    {
      using var document = JsonDocument.Parse(File.ReadAllText(path));
      var host = document.RootElement.GetProperty("HostCapabilities");
      Assert.False(host.GetProperty("Enabled").GetBoolean());
      Assert.Equal(
        512,
        host.GetProperty("MaximumInstalledSoftwareInventoryEntries").GetInt32());
      Assert.Empty(host.GetProperty("AllowedRegistryRoots").EnumerateArray());
      Assert.Empty(host.GetProperty("AllowedRegistryDurableValueTargets")
        .EnumerateArray());
      Assert.Empty(host.GetProperty("AllowedRegistryDeleteTargets")
        .EnumerateArray());
      Assert.Empty(host.GetProperty("AllowedMachineEnvironmentVariables")
        .EnumerateArray());
    }
  }

  private static void AssertDescriptors(
    IReadOnlyList<IHostCapabilityAdapter> adapters,
    string version,
    string systemProvenance)
  {
    var registry = new CapabilityRegistry(adapters);
    foreach (var adapter in adapters)
    {
      var descriptor = adapter.Descriptor;
      Assert.Equal(version, descriptor.Version);
      Assert.Equal(CapabilityDataClass.Confidential, descriptor.DataClass);
      Assert.Equal(ConsentRequirement.SignedMandate, descriptor.Consent);
      Assert.Equal(RequiredPrivilege.LocalSystem, descriptor.RequiredPrivilege);
      Assert.Equal(IdempotencySemantics.Required, descriptor.Idempotency);
      Assert.NotEmpty(descriptor.SupportedOperatingSystems);
      Assert.NotEmpty(descriptor.ProvenanceOutputs);
      Assert.Equal(systemProvenance, descriptor.ProvenanceOutputs[0]);
      if (descriptor.IsMutation)
      {
        Assert.Equal(
          [systemProvenance, "host-recovery-record"],
          descriptor.ProvenanceOutputs);
      }
      else
      {
        Assert.Equal([systemProvenance], descriptor.ProvenanceOutputs);
      }
      Assert.False(registry.TryResolve(descriptor.Id, "1.0.0", out _));
      if (version == "3.0.0")
      {
        Assert.False(registry.TryResolve(descriptor.Id, "2.0.0", out _));
      }
      Assert.True(registry.TryResolve(descriptor.Id, version, out _));
    }
  }

  private static HostCapabilityOptions ValidRegistryOptions() => new()
  {
    AllowedRegistryRoots =
    [
      new AllowedRegistryRootOptions
      {
        Id = "managed",
        Hive = "LocalMachine",
        SubKey = @"SOFTWARE\Contoso\Managed",
        AllowRead = true,
        AllowWrite = true,
        AllowDelete = true,
      },
    ],
    AllowedRegistryDurableValueTargets =
    [
      new AllowedRegistryDurableValueTargetOptions
      {
        RootId = "managed",
        RelativeKey = "Public",
        ValueName = "Mode",
        Classification = DurableNonSecretValuePolicy.Classification,
        AllowedValueTypes = ["DWord"],
      },
    ],
  };

  private static HostCapabilityOptions ValidEnvironmentOptions() => new()
  {
    AllowedMachineEnvironmentVariables =
    [
      new AllowedMachineEnvironmentVariableOptions
      {
        Id = "site-mode",
        Name = "ITEMBA_SITE_MODE",
        Classification = DurableNonSecretValuePolicy.Classification,
        AllowRead = true,
        AllowWrite = true,
        AllowDelete = true,
      },
    ],
  };

  private static ResolvedRegistryTarget RegistryTarget() => new(
    RegistryHive.LocalMachine,
    "managed",
    @"SOFTWARE\Contoso\Managed\Public",
    "Mode",
    AllowRead: true,
    AllowWrite: true,
    AllowDelete: true)
  {
    DurableAllowedValueTypes = new HashSet<RegistryValueKind>
    {
      RegistryValueKind.String,
    },
  };

  private static RegistryState RegistryState(string value) => new(
    KeyExists: true,
    Exists: true,
    ValueType: "String",
    Value: value,
    LegacyStateSha256: ZeroSha256,
    StateSha256: OneSha256,
    ByteCount: Encoding.UTF8.GetByteCount(value));

  private static MachineEnvironmentTarget EnvironmentTarget() => new(
    "site-mode",
    "ITEMBA_SITE_MODE",
    AllowRead: true,
    AllowWrite: true,
    AllowDelete: true);

  private static MachineEnvironmentState EnvironmentState(
    string value,
    string digest) => new(
      Exists: true,
      Value: value,
      StateSha256: digest,
      Bytes: Encoding.UTF8.GetByteCount(value));

  private static HostRecoveryReceipt RecoveryReceipt() => new(
    "opaque-handle",
    ZeroSha256,
    "protected-record.bin");

  private static string SensitiveValue() => string.Concat(
    "password=",
    Guid.NewGuid().ToString("N"));

  private static void AssertNoSensitivePlaintext(string value, string sensitive) =>
    Assert.False(value.Contains(sensitive, StringComparison.Ordinal));

  private static void AssertRegistryConfigInvalid(HostCapabilityOptions options) =>
    Assert.Throws<InvalidOperationException>(() =>
      new RegistryTargetPolicy(Options.Create(options)));

  private static void AssertEnvironmentConfigInvalid(HostCapabilityOptions options) =>
    Assert.Throws<InvalidOperationException>(() =>
      new MachineEnvironmentPolicy(Options.Create(options)));

  private static bool ContainsSequence(byte[] haystack, byte[] needle) =>
    haystack.AsSpan().IndexOf(needle) >= 0;

  private static string FindRepositoryRoot()
  {
    for (var current = new DirectoryInfo(AppContext.BaseDirectory);
      current is not null;
      current = current.Parent)
    {
      if (File.Exists(Path.Combine(
        current.FullName,
        "windows-companion",
        "src",
        "Msaidizi.Companion.Service",
        "appsettings.json")))
      {
        return current.FullName;
      }
    }
    throw new DirectoryNotFoundException("Repository root was not found.");
  }

  private sealed class NeverCalledRecoveryVault : IHostRecoveryVault
  {
    public ValueTask<HostRecoveryReceipt> PrepareAsync(
      ActionExecutionContext context,
      string operation,
      string preStateSha256,
      object recoveryRecord,
      bool irreversible,
      CancellationToken cancellationToken) =>
      ValueTask.FromException<HostRecoveryReceipt>(
        new InvalidOperationException("Recovery vault should not be invoked."));
  }
}
