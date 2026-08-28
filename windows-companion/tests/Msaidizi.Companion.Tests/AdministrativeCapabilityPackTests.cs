using System.Buffers.Binary;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Agent.Capabilities;
using Itemba.Msaidizi.Companion.Agent.Configuration;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class AdministrativeCapabilityPackTests
{
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
    new ActionBudget(60, 10, 10, 0, 16_777_216, 16_777_216, 1));

  [Fact]
  public async Task RegistryReadHasARealPositiveControl()
  {
    var options = Options.Create(new HostCapabilityOptions
    {
      AllowedRegistryRoots =
      [
        new AllowedRegistryRootOptions
        {
          Id = "windows-version",
          Hive = "LocalMachine",
          SubKey = @"SOFTWARE\Microsoft\Windows NT\CurrentVersion",
          AllowRead = true,
        },
      ],
      AllowedRegistryDurableValueTargets =
      [
        new AllowedRegistryDurableValueTargetOptions
        {
          RootId = "windows-version",
          RelativeKey = string.Empty,
          ValueName = "ProductName",
          Classification = DurableNonSecretValuePolicy.Classification,
          AllowedValueTypes = ["String"],
        },
      ],
    });
    var adapter = new RegistryValueReadCapabilityAdapter(new RegistryTargetPolicy(options));
    using var arguments = JsonDocument.Parse(
      """{"rootId":"windows-version","relativeKey":"","valueName":"ProductName"}""");

    var result = await adapter.ExecuteAsync(ReadContext, arguments.RootElement, CancellationToken.None);
    using var output = JsonDocument.Parse(result.OutputJson);
    Assert.True(adapter.ValidateResult(output.RootElement).IsValid);
    Assert.True(output.RootElement.GetProperty("exists").GetBoolean());
    Assert.False(result.MutationCommitted);
  }

  [Fact]
  public async Task EnvironmentAndMsiStatusReadsHavePositiveControls()
  {
    var environmentOptions = Options.Create(new HostCapabilityOptions
    {
      AllowedMachineEnvironmentVariables =
      [
        new AllowedMachineEnvironmentVariableOptions
        {
          Id = "known-absent",
          Name = $"ITEMBA_MSAIDIZI_TEST_{Guid.NewGuid():N}",
          Classification = DurableNonSecretValuePolicy.Classification,
          AllowRead = true,
        },
      ],
    });
    var environment = new MachineEnvironmentReadCapabilityAdapter(
      new MachineEnvironmentPolicy(environmentOptions));
    using var environmentArguments = JsonDocument.Parse(
      """{"variableId":"known-absent"}""");
    var environmentResult = await environment.ExecuteAsync(
      ReadContext,
      environmentArguments.RootElement,
      CancellationToken.None);
    using var environmentOutput = JsonDocument.Parse(environmentResult.OutputJson);
    Assert.False(environmentOutput.RootElement.GetProperty("exists").GetBoolean());

    var msiOptions = Options.Create(new HostCapabilityOptions
    {
      AllowedMsiPackages =
      [
        new AllowedMsiPackageOptions
        {
          Id = "absent-product",
          InstallerPath = Path.Combine(Path.GetTempPath(), "absent.msi"),
          Sha256 = new string('0', 64),
          SignerCertificateThumbprint = new string('0', 40),
          ProductCode = "{11111111-1111-1111-1111-111111111111}",
        },
      ],
    });
    var msi = new MsiSoftwareStatusCapabilityAdapter(new MsiPackagePolicy(msiOptions));
    using var msiArguments = JsonDocument.Parse(
      """{"packageId":"absent-product"}""");
    var msiResult = await msi.ExecuteAsync(
      ReadContext,
      msiArguments.RootElement,
      CancellationToken.None);
    using var msiOutput = JsonDocument.Parse(msiResult.OutputJson);
    Assert.True(msi.ValidateResult(msiOutput.RootElement).IsValid);
    Assert.False(msiOutput.RootElement.GetProperty("installed").GetBoolean());
  }

  [Fact]
  public void MsiMutationsDoNotClaimAnUnavailableCompensator()
  {
    var options = Options.Create(new HostCapabilityOptions
    {
      RecoveryVaultPath = Path.Combine(Path.GetTempPath(), $"msaidizi-msi-{Guid.NewGuid():N}"),
    });
    var policy = new MsiPackagePolicy(options);
    var vault = new FileHostRecoveryVault(options);
    using var runner = new GovernedSystemToolRunner();
    var descriptors = new[]
    {
      new MsiSoftwareInstallCapabilityAdapter(policy, vault, runner).Descriptor,
      new MsiSoftwareUninstallCapabilityAdapter(policy, vault, runner).Descriptor,
    };

    Assert.All(descriptors, descriptor =>
    {
      Assert.Equal(CapabilityEffect.Irreversible, descriptor.Effect);
      Assert.Equal(RecoveryKind.Irreversible, descriptor.Recovery);
      Assert.Equal(ConsentRequirement.SignedMandate, descriptor.Consent);
    });
  }

  [Fact]
  public async Task WindowsServiceStatusHasARealPositiveControl()
  {
    var options = Options.Create(new HostCapabilityOptions
    {
      AllowedWindowsServices =
      [
        new AllowedWindowsServiceOptions
        {
          Id = "task-scheduler",
          ServiceName = "Schedule",
        },
      ],
    });
    var adapter = new WindowsServiceStatusCapabilityAdapter(
      new WindowsServicePolicy(options));
    using var arguments = JsonDocument.Parse(
      """{"serviceId":"task-scheduler"}""");

    var result = await adapter.ExecuteAsync(
      ReadContext,
      arguments.RootElement,
      CancellationToken.None);
    using var output = JsonDocument.Parse(result.OutputJson);
    Assert.True(adapter.ValidateResult(output.RootElement).IsValid);
    Assert.True(output.RootElement.GetProperty("status").GetString() is
      "Stopped" or "StartPending" or "StopPending" or "Running"
      or "ContinuePending" or "PausePending" or "Paused");
    Assert.False(result.MutationCommitted);
  }

  [Fact]
  public void SupervisorSensitiveTargetsFailClosed()
  {
    Assert.Throws<InvalidOperationException>(() => new RegistryTargetPolicy(Options.Create(
      new HostCapabilityOptions
      {
        AllowedRegistryRoots =
        [
          new AllowedRegistryRootOptions
          {
            Id = "bad",
            Hive = "LocalMachine",
            SubKey = @"SOFTWARE\Itemba",
            AllowRead = true,
          },
        ],
      })));
    Assert.Throws<InvalidOperationException>(() => new MachineEnvironmentPolicy(Options.Create(
      new HostCapabilityOptions
      {
        AllowedMachineEnvironmentVariables =
        [
          new AllowedMachineEnvironmentVariableOptions
          {
            Id = "path",
            Name = "PATH",
            Classification = DurableNonSecretValuePolicy.Classification,
            AllowWrite = true,
          },
        ],
      })));
    Assert.Throws<InvalidOperationException>(() => new WindowsServicePolicy(Options.Create(
      new HostCapabilityOptions
      {
        AllowedWindowsServices =
        [
          new AllowedWindowsServiceOptions
          {
            Id = "supervisor",
            ServiceName = "Itemba Msaidizi Companion",
            AllowStop = true,
          },
        ],
      })));
    Assert.Throws<InvalidOperationException>(() => new ScheduledTaskPolicy(Options.Create(
      new HostCapabilityOptions
      {
        AllowedScheduledTasks =
        [
          new AllowedScheduledTaskOptions
          {
            Id = "supervisor",
            TaskPath = @"\Itemba\Msaidizi\Supervisor\Update",
            AllowRun = true,
          },
        ],
      })));
  }

  [Fact]
  public void ScheduledTaskV2DescriptorsAreConfidentialAndV1IsNotResolvable()
  {
    var options = ScheduledTaskOptions();
    var policy = new ScheduledTaskPolicy(options);
    var vault = new FileHostRecoveryVault(options);
    using var runner = new GovernedSystemToolRunner();
    var read = new ScheduledTaskDefinitionReadCapabilityAdapter(policy, runner);
    var set = new ScheduledTaskEnabledSetCapabilityAdapter(policy, vault, runner);
    var run = new ScheduledTaskRunCapabilityAdapter(policy, vault, runner);
    var registry = new CapabilityRegistry([read, set, run]);

    Assert.Equal("2.0.0", read.Descriptor.Version);
    Assert.Equal(CapabilityDataClass.Confidential, read.Descriptor.DataClass);
    Assert.Equal(CapabilityEffect.LocalRead, read.Descriptor.Effect);
    Assert.Equal(RecoveryKind.NotApplicable, read.Descriptor.Recovery);
    Assert.Collection(
      read.Descriptor.ProvenanceOutputs,
      value => Assert.Equal("windows-task-scheduler", value));

    Assert.Equal("2.0.0", set.Descriptor.Version);
    Assert.Equal(CapabilityDataClass.Confidential, set.Descriptor.DataClass);
    Assert.Equal(CapabilityEffect.Administrative, set.Descriptor.Effect);
    Assert.Equal(RecoveryKind.Snapshot, set.Descriptor.Recovery);
    Assert.Collection(
      set.Descriptor.ProvenanceOutputs,
      value => Assert.Equal("windows-task-scheduler", value),
      value => Assert.Equal("host-recovery-record", value));

    Assert.Equal("2.0.0", run.Descriptor.Version);
    Assert.Equal(CapabilityDataClass.Confidential, run.Descriptor.DataClass);
    Assert.Equal(CapabilityEffect.Irreversible, run.Descriptor.Effect);
    Assert.Equal(RecoveryKind.Irreversible, run.Descriptor.Recovery);
    Assert.Equal(ConsentRequirement.SignedMandate, run.Descriptor.Consent);
    Assert.Equal(RequiredPrivilege.LocalSystem, run.Descriptor.RequiredPrivilege);

    Assert.All(new[] { read.Descriptor.Id, set.Descriptor.Id, run.Descriptor.Id }, id =>
      Assert.False(registry.TryResolve(id, "1.0.0", out _)));
    Assert.All(new[] { read.Descriptor.Id, set.Descriptor.Id, run.Descriptor.Id }, id =>
      Assert.True(registry.TryResolve(id, "2.0.0", out _)));
  }

  [Fact]
  public async Task ScheduledTaskResultsExposeOnlyBoundMetadataAndProtectRawXmlInVault()
  {
    const string secret = "SCHEDULED_TASK_SECRET_7f3a9d";
    var xml = ScheduledTaskXml(secret, enabled: true);
    var definition = ScheduledTaskSupport.ParseDefinition(xml);
    var target = new AllowedScheduledTask(
      "finance-daily",
      @"\Itemba\Finance\Daily",
      AllowRun: true,
      AllowEnableDisable: true);
    var directory = Path.Combine(
      Path.GetTempPath(),
      $"msaidizi-scheduled-task-vault-{Guid.NewGuid():N}");
    var options = Options.Create(new HostCapabilityOptions
    {
      RecoveryVaultPath = directory,
    });
    var vault = new FileHostRecoveryVault(options);

    try
    {
      var recoveryRecord = ScheduledTaskEnabledSetCapabilityAdapter.CreateRecoveryRecord(
        target,
        definition);
      var receipt = await vault.PrepareAsync(
        ReadContext,
        "scheduled-task.enabled.set",
        definition.StateSha256,
        recoveryRecord,
        irreversible: false,
        CancellationToken.None);
      var result = ScheduledTaskDefinitionReadCapabilityAdapter.Result(
        target,
        definition,
        mutation: true,
        receipt,
        definition.StateSha256,
        definition.Bytes);
      using var output = JsonDocument.Parse(result.OutputJson);

      Assert.True(ScheduledTaskSchemas.ValidateDefinitionResult(output.RootElement).IsValid);
      Assert.Equal(3, output.RootElement.EnumerateObject().Count());
      Assert.Equal(definition.Enabled, output.RootElement.GetProperty("enabled").GetBoolean());
      Assert.Equal(
        definition.DefinitionSha256,
        output.RootElement.GetProperty("definitionSha256").GetString());
      Assert.Equal(
        definition.StateSha256,
        output.RootElement.GetProperty("stateSha256").GetString());
      Assert.DoesNotContain(secret, result.OutputJson, StringComparison.Ordinal);
      Assert.DoesNotContain("definitionXml", result.OutputJson, StringComparison.Ordinal);
      Assert.DoesNotContain("--password", result.OutputJson, StringComparison.Ordinal);
      Assert.DoesNotContain("https://", result.OutputJson, StringComparison.Ordinal);
      Assert.DoesNotContain(@"C:\Users\", result.OutputJson, StringComparison.Ordinal);
      Assert.DoesNotContain(
        secret,
        JsonSerializer.Serialize(result.Provenance),
        StringComparison.Ordinal);
      Assert.Equal(definition.Bytes * 2, result.LocalBytesRead);
      Assert.Equal(ScheduledTaskSupport.EnabledStateEffectBytes, result.LocalBytesWritten);

      var protectedBytes = await File.ReadAllBytesAsync(receipt.RecordPath);
      Assert.DoesNotContain(
        secret,
        Encoding.UTF8.GetString(protectedBytes),
        StringComparison.Ordinal);
      var restored = await vault.ReadAsync(
        ReadContext.ActionId,
        receipt.RecordSha256,
        CancellationToken.None);
      Assert.Equal(
        xml,
        restored.RecoveryRecord.GetProperty("definitionXml").GetString());
      Assert.Equal(
        ScheduledTaskSchemas.RecoveryRecordContract,
        restored.RecoveryRecord.GetProperty("contract").GetString());
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
  public void ScheduledTaskResultValidationRejectsRawXmlBadRelationsAndWrongKinds()
  {
    var definition = ScheduledTaskSupport.ParseDefinition(
      ScheduledTaskXml("validation-secret", enabled: false));
    var valid = JsonSerializer.Serialize(new
    {
      enabled = definition.Enabled,
      definitionSha256 = definition.DefinitionSha256,
      stateSha256 = definition.StateSha256,
    });
    using var validDocument = JsonDocument.Parse(valid);
    Assert.True(ScheduledTaskSchemas.ValidateDefinitionResult(
      validDocument.RootElement).IsValid);

    var invalidResults = new[]
    {
      $$"""{"enabled":false,"definitionSha256":"{{definition.DefinitionSha256}}","stateSha256":"{{definition.StateSha256}}","definitionXml":"secret"}""",
      $$"""{"enabled":true,"definitionSha256":"{{definition.DefinitionSha256}}","stateSha256":"{{definition.StateSha256}}"}""",
      $$"""{"enabled":false,"definitionSha256":1,"stateSha256":"{{definition.StateSha256}}"}""",
      $$"""{"enabled":false,"definitionSha256":"{{definition.DefinitionSha256}}","stateSha256":"{{definition.StateSha256}}","stateSha256":"{{definition.StateSha256}}"}""",
    };
    foreach (var invalid in invalidResults)
    {
      using var document = JsonDocument.Parse(invalid);
      Assert.False(ScheduledTaskSchemas.ValidateDefinitionResult(
        document.RootElement).IsValid);
    }
  }

  [Fact]
  public void ScheduledTaskDefinitionParseErrorsAreSecretFreeAndStable()
  {
    const string secret = "SCHEDULED_TASK_PARSE_SECRET_130f";
    var malformed = Assert.Throws<HostPreconditionException>(() =>
      ScheduledTaskSupport.ParseDefinition($"<Task><Arguments>{secret}"));
    Assert.Equal("scheduled_task_definition_invalid", malformed.ErrorCode);
    Assert.Equal("scheduled_task_definition_invalid", malformed.Message);
    Assert.DoesNotContain(secret, malformed.ToString(), StringComparison.Ordinal);

    var oversized = Assert.Throws<HostPreconditionException>(() =>
      ScheduledTaskSupport.ParseDefinition(new string('x', 524_289)));
    Assert.Equal("scheduled_task_definition_too_large", oversized.ErrorCode);
    Assert.Equal("scheduled_task_definition_too_large", oversized.Message);
  }

  [Fact]
  public async Task ScheduledTaskRecoveryRejectsLegacyAndIdentityDriftBeforeCompensation()
  {
    var options = ScheduledTaskOptions();
    var policy = new ScheduledTaskPolicy(options);
    var definition = ScheduledTaskSupport.ParseDefinition(
      ScheduledTaskXml("recovery-secret", enabled: true));
    var target = new AllowedScheduledTask(
      "finance-daily",
      @"\Itemba\Finance\Daily",
      AllowRun: true,
      AllowEnableDisable: true);
    var validRecord = JsonSerializer.SerializeToElement(
      ScheduledTaskEnabledSetCapabilityAdapter.CreateRecoveryRecord(target, definition));
    var valid = policy.ResolveRecovery(validRecord, definition.StateSha256);
    Assert.Equal(target, valid.Target);
    Assert.True(valid.Enabled);

    using var runner = new GovernedSystemToolRunner();
    var operation = new ScheduledTaskAdministrativeRecoveryOperation(policy, runner);
    var forgedRecords = new[]
    {
      RecoveryRecord(validRecord, preStateSha256: new string('0', 64)),
      RecoveryRecord(ReplaceJsonString(
        validRecord,
        "definitionXml",
        definition.Xml.Replace("recovery-secret", "changed-secret", StringComparison.Ordinal)),
        definition.StateSha256),
      RecoveryRecord(ReplaceJsonString(
        validRecord,
        "definitionSha256",
        new string('1', 64)),
        definition.StateSha256),
      RecoveryRecord(ReplaceJsonString(
        validRecord,
        "stateSha256",
        new string('2', 64)),
        definition.StateSha256),
      RecoveryRecord(ReplaceJsonString(
        validRecord,
        "definitionXml",
        "<Task><Arguments>recovery-secret"),
        definition.StateSha256),
      RecoveryRecord(ReplaceJsonString(
        validRecord,
        "definitionXml",
        new string('x', 524_289)),
        definition.StateSha256),
      RecoveryRecord(JsonSerializer.SerializeToElement(new
      {
        id = target.Id,
        path = target.Path,
        enabled = definition.Enabled,
        xml = definition.Xml,
      }), definition.StateSha256),
    };

    foreach (var record in forgedRecords)
    {
      var exception = await Assert.ThrowsAsync<HostRecoveryException>(() =>
        operation.RestoreAsync(record, CancellationToken.None).AsTask());
      Assert.Equal("recovery_record_format_invalid", exception.ErrorCode);
      Assert.Equal("recovery_record_format_invalid", exception.Message);
      Assert.DoesNotContain("secret", exception.Message, StringComparison.OrdinalIgnoreCase);
    }
  }

  [Theory]
  [InlineData("Itemba Msaidizi Update Supervisor")]
  [InlineData("Itemba.Msaidizi.UpdateSupervisor")]
  [InlineData("Itemba-Msaidizi.RecoverySupervisor")]
  [InlineData("Itemba Msaidizi Recovery")]
  [InlineData("Itemba Msaidizi Companion")]
  public void TrustedServiceNamesCannotEnterTheServiceAllowlist(string serviceName)
  {
    Assert.Throws<InvalidOperationException>(() => new WindowsServicePolicy(Options.Create(
      new HostCapabilityOptions
      {
        AllowedWindowsServices =
        [
          new AllowedWindowsServiceOptions
          {
            Id = "trusted",
            ServiceName = serviceName,
            AllowStart = true,
          },
        ],
      })));
  }

  [Theory]
  [InlineData(@"SYSTEM\CurrentControlSet\Services")]
  [InlineData(@"SYSTEM\CurrentControlSet\Services\Itemba Msaidizi Update Supervisor")]
  [InlineData(@"SYSTEM\CurrentControlSet\Services\Itemba.Msaidizi.RecoverySupervisor\Parameters")]
  [InlineData(@"SYSTEM\CurrentControlSet\Services\Itemba-Msaidizi.RecoverySupervisor")]
  [InlineData(@"SYSTEM\ControlSet001")]
  [InlineData(@"SYSTEM\ControlSet002\Services")]
  [InlineData(@"SYSTEM\ControlSet001\Services\Itemba.Msaidizi.UpdateSupervisor")]
  [InlineData(@"SYSTEM\Select")]
  public void TrustedServiceRegistryTreesCannotEnterTheRegistryAllowlist(string subKey)
  {
    Assert.Throws<InvalidOperationException>(() => new RegistryTargetPolicy(Options.Create(
      new HostCapabilityOptions
      {
        AllowedRegistryRoots =
        [
          new AllowedRegistryRootOptions
          {
            Id = "trusted",
            Hive = "LocalMachine",
            SubKey = subKey,
            AllowRead = true,
          },
        ],
      })));
  }

  [Theory]
  [InlineData("Itemba Msaidizi Recovery Operators", true)]
  [InlineData("Itemba.Msaidizi.EmergencyOperator", true)]
  [InlineData("ItembaMsaidiziRecoveryOperators", true)]
  [InlineData("Itemba-Msaidizi Update Supervisor", false)]
  [InlineData("ItembaMsaidiziEmergencyOperator", false)]
  public void RecoveryAndEmergencyIdentitiesCannotEnterTheIdentityAllowlists(
    string windowsName,
    bool asGroup)
  {
    var options = new HostCapabilityOptions();
    if (asGroup)
    {
      options.AllowedLocalGroups =
      [
        new AllowedLocalGroupOptions
        {
          Id = "trusted",
          GroupName = windowsName,
          AllowMembershipChange = true,
        },
      ];
    }
    else
    {
      options.AllowedLocalAccounts =
      [
        new AllowedLocalAccountOptions
        {
          Id = "trusted",
          AccountName = windowsName,
          AllowEnableDisable = true,
        },
      ];
    }

    Assert.Throws<InvalidOperationException>(
      () => new LocalIdentityPolicy(Options.Create(options)));
  }

  [Fact]
  public void RegistryTraversalAndUnknownFieldsAreRejected()
  {
    using var traversal = JsonDocument.Parse(
      """{"rootId":"managed","relativeKey":"..\\Secrets","valueName":"x"}""");
    using var extra = JsonDocument.Parse(
      """{"rootId":"managed","relativeKey":"Good","valueName":"x","rawHive":"HKLM"}""");
    Assert.False(RegistryCapabilitySchemas.ValidateTarget(traversal.RootElement).IsValid);
    Assert.False(RegistryCapabilitySchemas.ValidateTarget(extra.RootElement).IsValid);
  }

  [Fact]
  public void BrowserPolicyNeverAcceptsRawOriginOrQueryFromTheAction()
  {
    var policy = new InteractiveTargetPolicy(Options.Create(new AgentOptions
    {
      AllowedBrowserOrigins =
      [
        new AllowedBrowserOriginOptions
        {
          Id = "itemba",
          Origin = "https://itemba.example.invalid/",
        },
      ],
    }));
    Assert.Equal(
      "https://itemba.example.invalid/sales/today",
      policy.ResolveBrowserUri("itemba", "/sales/today").AbsoluteUri);
    policy.ValidateBrowserOriginDigest(
      "itemba",
      PayloadDigest.Sha256Hex("https://itemba.example.invalid/"));
    Assert.Throws<InvalidOperationException>(() =>
      policy.ValidateBrowserOriginDigest("itemba", new string('0', 64)));
    Assert.Throws<InvalidOperationException>(() =>
      policy.ResolveBrowserUri("itemba", "/sales?token=raw"));
    Assert.Throws<InvalidOperationException>(() =>
      policy.ResolveBrowserUri("unknown", "/sales"));
  }

  [Fact]
  public void PcmWavParserAcceptsBoundedPcmAndRejectsExcessDuration()
  {
    var wav = CreatePcmWav(dataBytes: 3_200, byteRate: 32_000);
    Assert.Equal(100, PcmWavInspector.Inspect(wav, 100).DurationMilliseconds);
    Assert.Throws<InvalidDataException>(() => PcmWavInspector.Inspect(wav, 99));
  }

  [Fact]
  public async Task EmergencyCommandRunsInStandardUserJobAndReturnsDigestsOnly()
  {
    var directory = Path.Combine(
      Path.GetTempPath(),
      $"itemba-command-test-{Guid.NewGuid():N}");
    Directory.CreateDirectory(directory);
    try
    {
      var options = Options.Create(new AgentOptions
      {
        MaximumCommandOutputBytes = 65_536,
        MaximumCommandProcesses = 4,
        MaximumCommandWorkingSetBytes = 134_217_728,
        AllowedCommandWorkingDirectories =
        [
          new AllowedCommandWorkingDirectoryOptions
          {
            Id = "scratch",
            Path = directory,
          },
        ],
      });
      var policy = new StandardUserCommandPolicy(options);
      var adapter = new EmergencyCommandExecuteCapabilityAdapter(
        policy,
        new StandardUserOwnedCommandRunner(options));
      using var arguments = JsonDocument.Parse(
        """{"executable":"cmd","argv":["/d","/s","/c","echo hello"],"workingDirectoryId":"scratch"}""");

      var result = await adapter.ExecuteAsync(
        ReadContext,
        arguments.RootElement,
        CancellationToken.None);
      using var output = JsonDocument.Parse(result.OutputJson);
      Assert.True(adapter.ValidateResult(output.RootElement).IsValid);
      Assert.True(result.MutationCommitted);
      Assert.True(result.OutcomeUncertain);
      Assert.True(output.RootElement.GetProperty("stdoutBytes").GetInt64() > 0);
      Assert.True(InteractiveJsonValidation.IsSha256(
        output.RootElement.GetProperty("stdoutSha256")));
      Assert.False(output.RootElement.TryGetProperty("stdout", out _));
      Assert.False(output.RootElement.TryGetProperty("stderr", out _));
    }
    finally
    {
      Directory.Delete(directory, recursive: true);
    }
  }

  [Fact]
  public void EmergencyCommandPolicyRejectsProtectedPathsAndEncodedPayloads()
  {
    var protectedPath = Path.Combine(
      Path.GetTempPath(),
      $"itemba-command-protected-{Guid.NewGuid():N}");
    Assert.Throws<InvalidOperationException>(() => new StandardUserCommandPolicy(
      Options.Create(new AgentOptions
      {
        ProtectedSupervisorPaths = [protectedPath],
        AllowedCommandWorkingDirectories =
        [
          new AllowedCommandWorkingDirectoryOptions
          {
            Id = "protected",
            Path = Path.Combine(protectedPath, "child"),
          },
        ],
      })));
    Assert.Throws<InvalidOperationException>(() =>
      StandardUserCommandPolicy.ValidateArguments(
        "windows-powershell",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "RemoteSigned",
          "-EncodedCommand",
          "ZQBjAGgAbwA=",
        ]));
    Assert.Throws<InvalidOperationException>(() =>
      StandardUserCommandPolicy.ValidateArguments(
        "cmd",
        ["/d", "/s", "/c", @"type %ProgramData%\Itemba\Msaidizi\vault"]));
  }

  [Fact]
  public async Task EmergencyCommandOutputCeilingTerminatesTheOwnedJob()
  {
    var directory = Path.Combine(
      Path.GetTempPath(),
      $"itemba-command-limit-{Guid.NewGuid():N}");
    Directory.CreateDirectory(directory);
    try
    {
      var options = Options.Create(new AgentOptions
      {
        MaximumCommandOutputBytes = 128,
        MaximumCommandProcesses = 4,
        MaximumCommandWorkingSetBytes = 134_217_728,
        AllowedCommandWorkingDirectories =
        [
          new AllowedCommandWorkingDirectoryOptions
          {
            Id = "scratch",
            Path = directory,
          },
        ],
      });
      var adapter = new EmergencyCommandExecuteCapabilityAdapter(
        new StandardUserCommandPolicy(options),
        new StandardUserOwnedCommandRunner(options));
      using var arguments = JsonDocument.Parse(
        """{"executable":"cmd","argv":["/d","/s","/c","(for /L %i in (1,1,100) do @echo 012345678901234567890123456789) & ping -n 20 127.0.0.1 >nul"],"workingDirectoryId":"scratch"}""");

      var elapsed = Stopwatch.StartNew();
      await Assert.ThrowsAsync<InvalidDataException>(() => adapter.ExecuteAsync(
        ReadContext,
        arguments.RootElement,
        CancellationToken.None).AsTask());
      elapsed.Stop();
      Assert.True(elapsed.Elapsed < TimeSpan.FromSeconds(5));
    }
    finally
    {
      Directory.Delete(directory, recursive: true);
    }
  }

  [Fact]
  public void BrowserUploadPolicyPinsAnAllowlistedLocalFileAndRejectsEscapes()
  {
    var root = Path.Combine(
      Path.GetTempPath(),
      $"itemba-upload-root-{Guid.NewGuid():N}");
    Directory.CreateDirectory(root);
    var file = Path.Combine(root, "report.txt");
    File.WriteAllText(file, "bounded upload");
    try
    {
      var policy = new InteractiveTargetPolicy(Options.Create(new AgentOptions
      {
        AllowedBrowserUploadRoots =
        [
          new AllowedBrowserUploadRootOptions
          {
            Id = "exports",
            Path = root,
          },
        ],
      }));

      using (var approved = policy.OpenUploadFile("exports", file))
      {
        Assert.Equal("report.txt", Path.GetFileName(approved.Path));
        Assert.Equal(new FileInfo(file).Length, approved.Length);
      }
      Assert.Throws<InvalidOperationException>(() => policy.OpenUploadFile(
        "exports",
        Path.Combine(root, "..", "outside.txt")));
      Assert.Throws<InvalidOperationException>(() => policy.OpenUploadFile(
        "exports",
        file + ":alternate"));
      Assert.Throws<InvalidOperationException>(() => policy.OpenUploadFile(
        "unknown",
        file));
    }
    finally
    {
      Directory.Delete(root, recursive: true);
    }
  }

  private static IOptions<HostCapabilityOptions> ScheduledTaskOptions() =>
    Options.Create(new HostCapabilityOptions
    {
      RecoveryVaultPath = Path.Combine(
        Path.GetTempPath(),
        $"msaidizi-scheduled-task-unused-{Guid.NewGuid():N}"),
      AllowedScheduledTasks =
      [
        new AllowedScheduledTaskOptions
        {
          Id = "finance-daily",
          TaskPath = @"\Itemba\Finance\Daily",
          AllowRun = true,
          AllowEnableDisable = true,
        },
      ],
    });

  private static string ScheduledTaskXml(string secret, bool enabled) => $$"""
    <?xml version="1.0" encoding="UTF-16"?>
    <Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
      <RegistrationInfo>
        <URI>\Itemba\Finance\{{secret}}</URI>
      </RegistrationInfo>
      <Settings>
        <Enabled>{{enabled.ToString().ToLowerInvariant()}}</Enabled>
      </Settings>
      <Actions Context="Author">
        <Exec>
          <Command>C:\Finance\daily.exe</Command>
          <Arguments>--password {{secret}} --token bearer-credential --upload https://user:password@example.invalid/private C:\Users\Finance\credentials.txt</Arguments>
        </Exec>
      </Actions>
    </Task>
    """;

  private static JsonElement ReplaceJsonString(
    JsonElement source,
    string propertyName,
    string replacement)
  {
    var values = new Dictionary<string, object?>(StringComparer.Ordinal);
    foreach (var property in source.EnumerateObject())
    {
      values[property.Name] = property.Value.ValueKind switch
      {
        JsonValueKind.String => property.Value.GetString(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        _ => throw new InvalidOperationException("Unexpected recovery-record property kind."),
      };
    }
    values[propertyName] = replacement;
    return JsonSerializer.SerializeToElement(values);
  }

  private static TrustedHostRecoveryRecord RecoveryRecord(
    JsonElement recoveryRecord,
    string preStateSha256) => new(
      "scheduled-task-action",
      "scheduled-task",
      "plan",
      "step",
      "device",
      "mandate",
      "scheduled-task.enabled.set",
      preStateSha256,
      Irreversible: false,
      PayloadDigest.Sha256Hex(recoveryRecord.GetRawText()),
      recoveryRecord.Clone());

  private static byte[] CreatePcmWav(int dataBytes, int byteRate)
  {
    var output = new byte[44 + dataBytes];
    "RIFF"u8.CopyTo(output);
    BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(4), checked((uint)(36 + dataBytes)));
    "WAVEfmt "u8.CopyTo(output.AsSpan(8));
    BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(16), 16);
    BinaryPrimitives.WriteUInt16LittleEndian(output.AsSpan(20), 1);
    BinaryPrimitives.WriteUInt16LittleEndian(output.AsSpan(22), 1);
    BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(24), 16_000);
    BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(28), checked((uint)byteRate));
    BinaryPrimitives.WriteUInt16LittleEndian(output.AsSpan(32), 2);
    BinaryPrimitives.WriteUInt16LittleEndian(output.AsSpan(34), 16);
    "data"u8.CopyTo(output.AsSpan(36));
    BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(40), checked((uint)dataBytes));
    return output;
  }
}
