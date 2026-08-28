using System.Text.Json;
using Itemba.Msaidizi.Companion.Agent.Capabilities;
using Itemba.Msaidizi.Companion.Agent.Configuration;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class RemainingWindowsCapabilityPackTests
{
  private static readonly Guid AdapterGuid = new("f86f2563-e764-4c73-b556-277cad8ac1cb");
  private static readonly Guid SchemeA = new("381b4222-f694-41f0-9685-ff5bb260df2e");
  private static readonly Guid SchemeB = new("a1841308-3541-4fab-bc81-f71556f20b4a");

  [Fact]
  public async Task LocalIdentityMutationsProduceTypedResultsAndRestoreSnapshots()
  {
    var options = Options.Create(HostOptions());
    var policy = new LocalIdentityPolicy(options);
    var identities = new FakeLocalIdentityManager(enabled: true, member: false);

    var accountVault = new RecordingRecoveryVault();
    var accountBefore = identities.ReadAccount("ManagedAgent").StateSha256;
    var accountAdapter = new LocalAccountEnabledSetCapabilityAdapter(
      policy,
      identities,
      accountVault);
    using var accountArguments = JsonDocument.Parse(
      """{"accountId":"managed-user","enabled":false}""");
    var accountResult = await accountAdapter.ExecuteAsync(
      MutationContext(accountBefore),
      accountArguments.RootElement,
      CancellationToken.None);
    using (var output = JsonDocument.Parse(accountResult.OutputJson))
    {
      Assert.True(accountAdapter.ValidateResult(output.RootElement).IsValid);
    }
    Assert.True(accountResult.MutationCommitted);
    Assert.False(identities.Enabled);

    var accountRecovery = new LocalAccountAdministrativeRecoveryOperation(
      policy,
      identities);
    Assert.True(accountRecovery.Supports(accountVault.Operation));
    Assert.NotEqual(accountBefore, await accountRecovery.ReadStateAsync(
      accountVault.Record(),
      CancellationToken.None));
    await accountRecovery.RestoreAsync(accountVault.Record(), CancellationToken.None);
    Assert.True(identities.Enabled);
    Assert.Equal(accountBefore, await accountRecovery.ReadStateAsync(
      accountVault.Record(),
      CancellationToken.None));

    var groupVault = new RecordingRecoveryVault();
    var group = policy.ResolveGroup("managed-group");
    var account = policy.ResolveAccount("managed-user");
    var groupBefore = LocalGroupMembershipReadCapabilityAdapter.MembershipState(
      group,
      account,
      member: false);
    var groupAdapter = new LocalGroupMembershipSetCapabilityAdapter(
      policy,
      identities,
      groupVault);
    using var groupArguments = JsonDocument.Parse(
      """{"groupId":"managed-group","accountId":"managed-user","member":true}""");
    var groupResult = await groupAdapter.ExecuteAsync(
      MutationContext(groupBefore),
      groupArguments.RootElement,
      CancellationToken.None);
    using (var output = JsonDocument.Parse(groupResult.OutputJson))
    {
      Assert.True(groupAdapter.ValidateResult(output.RootElement).IsValid);
    }
    Assert.True(identities.Member);

    var groupRecovery = new LocalGroupAdministrativeRecoveryOperation(policy, identities);
    Assert.True(groupRecovery.Supports(groupVault.Operation));
    Assert.NotEqual(groupBefore, await groupRecovery.ReadStateAsync(
      groupVault.Record(),
      CancellationToken.None));
    await groupRecovery.RestoreAsync(groupVault.Record(), CancellationToken.None);
    Assert.False(identities.Member);
    Assert.Equal(groupBefore, await groupRecovery.ReadStateAsync(
      groupVault.Record(),
      CancellationToken.None));
  }

  [Fact]
  public async Task AdapterAndPrinterMutationsAreBoundedTypedAndRecoverable()
  {
    var options = Options.Create(HostOptions());
    var networkPolicy = new NetworkAdapterPolicy(options);
    var network = new FakeNetworkAdapterManager(enabled: true);
    var networkVault = new RecordingRecoveryVault();
    var networkBefore = network.Inspect(AdapterGuid, 8).EnabledStateSha256("ethernet");
    var networkAdapter = new NetworkAdapterEnabledSetCapabilityAdapter(
      networkPolicy,
      network,
      networkVault);
    using var networkArguments = JsonDocument.Parse(
      """{"adapterId":"ethernet","enabled":false}""");
    var networkResult = await networkAdapter.ExecuteAsync(
      MutationContext(networkBefore),
      networkArguments.RootElement,
      CancellationToken.None);
    using (var output = JsonDocument.Parse(networkResult.OutputJson))
    {
      Assert.True(networkAdapter.ValidateResult(output.RootElement).IsValid);
    }
    Assert.False(network.Enabled);

    var networkRecovery = new NetworkAdapterAdministrativeRecoveryOperation(
      networkPolicy,
      network);
    Assert.NotEqual(networkBefore, await networkRecovery.ReadStateAsync(
      networkVault.Record(),
      CancellationToken.None));
    await networkRecovery.RestoreAsync(networkVault.Record(), CancellationToken.None);
    Assert.True(network.Enabled);
    Assert.Equal(networkBefore, await networkRecovery.ReadStateAsync(
      networkVault.Record(),
      CancellationToken.None));

    var printerPolicy = new PrinterPolicy(options);
    var printers = new FakePrinterManager(paused: false);
    var discovery = new PrinterDiscoveryCapabilityAdapter(printerPolicy, printers);
    using var discoveryArguments = JsonDocument.Parse("""{"maxResults":8}""");
    var discoveryResult = await discovery.ExecuteAsync(
      ReadContext,
      discoveryArguments.RootElement,
      CancellationToken.None);
    using (var output = JsonDocument.Parse(discoveryResult.OutputJson))
    {
      Assert.True(discovery.ValidateResult(output.RootElement).IsValid);
      Assert.Single(output.RootElement.GetProperty("printers").EnumerateArray());
    }

    var printerVault = new RecordingRecoveryVault();
    var printerBefore = printers.TryInspect("Managed Queue")!.PauseStateSha256("office");
    var printerAdapter = new PrinterQueuePausedSetCapabilityAdapter(
      printerPolicy,
      printers,
      printerVault);
    using var printerArguments = JsonDocument.Parse(
      """{"printerId":"office","paused":true}""");
    var printerResult = await printerAdapter.ExecuteAsync(
      MutationContext(printerBefore),
      printerArguments.RootElement,
      CancellationToken.None);
    using (var output = JsonDocument.Parse(printerResult.OutputJson))
    {
      Assert.True(printerAdapter.ValidateResult(output.RootElement).IsValid);
    }
    Assert.True(printers.Paused);

    var printerRecovery = new PrinterAdministrativeRecoveryOperation(printerPolicy, printers);
    Assert.NotEqual(printerBefore, await printerRecovery.ReadStateAsync(
      printerVault.Record(),
      CancellationToken.None));
    await printerRecovery.RestoreAsync(printerVault.Record(), CancellationToken.None);
    Assert.False(printers.Paused);
    Assert.Equal(printerBefore, await printerRecovery.ReadStateAsync(
      printerVault.Record(),
      CancellationToken.None));
  }

  [Fact]
  public async Task PowerDisplayAndTimeZoneMutationsRestoreTheirExactPreState()
  {
    var displayAdapter = new DisplayInventoryReadCapabilityAdapter(
      new FakeDisplayInventory());
    using (var displayArguments = JsonDocument.Parse("{}"))
    {
      var displayResult = await displayAdapter.ExecuteAsync(
        ReadContext,
        displayArguments.RootElement,
        CancellationToken.None);
      using var output = JsonDocument.Parse(displayResult.OutputJson);
      Assert.True(displayAdapter.ValidateResult(output.RootElement).IsValid);
    }

    var hostOptions = HostOptions();
    var installedZones = TimeZoneInfo.GetSystemTimeZones().Take(2).ToArray();
    Assert.Equal(2, installedZones.Length);
    hostOptions.AllowedTimeZones =
    [
      new AllowedTimeZoneOptions
      {
        Id = "zone-a",
        WindowsTimeZoneId = installedZones[0].Id,
        AllowSet = true,
      },
      new AllowedTimeZoneOptions
      {
        Id = "zone-b",
        WindowsTimeZoneId = installedZones[1].Id,
        AllowSet = true,
      },
    ];
    var options = Options.Create(hostOptions);
    var powerPolicy = new PowerSchemePolicy(options);
    var power = new FakePowerSettingsManager(SchemeA, monitorSeconds: 600);

    var activeVault = new RecordingRecoveryVault();
    var activeBefore = ActivePowerSchemeReadCapabilityAdapter.ActiveState("balanced", SchemeA);
    var activeAdapter = new ActivePowerSchemeSetCapabilityAdapter(
      powerPolicy,
      power,
      activeVault);
    using var activeArguments = JsonDocument.Parse("""{"schemeId":"saver"}""");
    var activeResult = await activeAdapter.ExecuteAsync(
      MutationContext(activeBefore),
      activeArguments.RootElement,
      CancellationToken.None);
    using (var output = JsonDocument.Parse(activeResult.OutputJson))
    {
      Assert.True(activeAdapter.ValidateResult(output.RootElement).IsValid);
    }
    Assert.Equal(SchemeB, power.ActiveScheme);

    var powerRecovery = new PowerSettingsAdministrativeRecoveryOperation(
      powerPolicy,
      power);
    Assert.NotEqual(activeBefore, await powerRecovery.ReadStateAsync(
      activeVault.Record(),
      CancellationToken.None));
    await powerRecovery.RestoreAsync(activeVault.Record(), CancellationToken.None);
    Assert.Equal(SchemeA, power.ActiveScheme);
    Assert.Equal(activeBefore, await powerRecovery.ReadStateAsync(
      activeVault.Record(),
      CancellationToken.None));

    var timeoutVault = new RecordingRecoveryVault();
    var timeoutBefore = MonitorTimeoutReadCapabilityAdapter.TimeoutState(
      "balanced",
      "ac",
      600);
    var timeoutAdapter = new MonitorTimeoutSetCapabilityAdapter(
      powerPolicy,
      power,
      timeoutVault);
    using var timeoutArguments = JsonDocument.Parse(
      """{"schemeId":"balanced","powerSource":"ac","seconds":900}""");
    var timeoutResult = await timeoutAdapter.ExecuteAsync(
      MutationContext(timeoutBefore),
      timeoutArguments.RootElement,
      CancellationToken.None);
    using (var output = JsonDocument.Parse(timeoutResult.OutputJson))
    {
      Assert.True(timeoutAdapter.ValidateResult(output.RootElement).IsValid);
    }
    Assert.Equal(900u, power.ReadMonitorTimeout(SchemeA, acPower: true));
    Assert.NotEqual(timeoutBefore, await powerRecovery.ReadStateAsync(
      timeoutVault.Record(),
      CancellationToken.None));
    await powerRecovery.RestoreAsync(timeoutVault.Record(), CancellationToken.None);
    Assert.Equal(600u, power.ReadMonitorTimeout(SchemeA, acPower: true));
    Assert.Equal(timeoutBefore, await powerRecovery.ReadStateAsync(
      timeoutVault.Record(),
      CancellationToken.None));

    var timeZonePolicy = new TimeZonePolicy(options);
    var timeZones = new FakeTimeZoneManager(installedZones[0].Id);
    var timeZoneVault = new RecordingRecoveryVault();
    var timeZoneBefore = TimeZoneReadCapabilityAdapter.State("zone-a", installedZones[0].Id);
    var timeZoneAdapter = new TimeZoneSetCapabilityAdapter(
      timeZonePolicy,
      timeZones,
      timeZoneVault);
    using var timeZoneArguments = JsonDocument.Parse("""{"timeZoneId":"zone-b"}""");
    var timeZoneResult = await timeZoneAdapter.ExecuteAsync(
      MutationContext(timeZoneBefore),
      timeZoneArguments.RootElement,
      CancellationToken.None);
    using (var output = JsonDocument.Parse(timeZoneResult.OutputJson))
    {
      Assert.True(timeZoneAdapter.ValidateResult(output.RootElement).IsValid);
    }
    Assert.Equal(installedZones[1].Id, timeZones.WindowsId);

    var timeZoneRecovery = new TimeZoneAdministrativeRecoveryOperation(
      timeZonePolicy,
      timeZones);
    Assert.NotEqual(timeZoneBefore, await timeZoneRecovery.ReadStateAsync(
      timeZoneVault.Record(),
      CancellationToken.None));
    await timeZoneRecovery.RestoreAsync(timeZoneVault.Record(), CancellationToken.None);
    Assert.Equal(installedZones[0].Id, timeZones.WindowsId);
    Assert.Equal(timeZoneBefore, await timeZoneRecovery.ReadStateAsync(
      timeZoneVault.Record(),
      CancellationToken.None));
  }

  [Fact]
  public async Task CameraAndLocalSpeechReturnStrictBoundedResultsWithProvenance()
  {
    var options = Options.Create(new AgentOptions
    {
      MaximumActionBytes = 1_048_576,
      MaximumCameraBytes = 1_048_576,
      MaximumSpeechAudioBytes = 1_048_576,
      MaximumTranscriptCharacters = 128,
      AllowedCameras =
      [
        new AllowedCameraOptions { Id = "front", DeviceId = "device-identity" },
      ],
      AllowedSpeechVoices =
      [
        new AllowedSpeechVoiceOptions
        {
          Id = "voice",
          InstalledVoiceName = "Installed Voice",
          CultureName = "en-US",
        },
      ],
      AllowedOfflineSpeechRecognizers =
      [
        new AllowedOfflineSpeechRecognizerOptions
        {
          Id = "recognizer",
          InstalledRecognizerId = "recognizer-token",
          CultureName = "en-US",
        },
      ],
    });

    var cameraPolicy = new CameraPolicy(options);
    Assert.Throws<InvalidOperationException>(() => cameraPolicy.Resolve("missing"));
    var cameraAdapter = new CameraPhotoCaptureCapabilityAdapter(
      cameraPolicy,
      new FakeCameraDevice());
    using var cameraArguments = JsonDocument.Parse(
      """{"cameraId":"front","maxWidth":640,"maxHeight":480}""");
    var cameraResult = await cameraAdapter.ExecuteAsync(
      ReadContext,
      cameraArguments.RootElement,
      CancellationToken.None);
    using (var output = JsonDocument.Parse(cameraResult.OutputJson))
    {
      Assert.True(cameraAdapter.ValidateResult(output.RootElement).IsValid);
    }
    var cameraProvenance = Assert.Single(cameraResult.Provenance);
    Assert.Equal("interactive-camera", cameraProvenance.SourceType);
    Assert.Equal(ProvenanceTrust.UntrustedContent, cameraProvenance.Trust);

    var speechEngine = new FakeLocalSpeechEngine();
    var speechPolicy = new LocalSpeechPolicy(options);
    Assert.Throws<InvalidOperationException>(() =>
      speechPolicy.ResolveRecognizer("missing"));
    var synthesisAdapter = new LocalSpeechSynthesizeCapabilityAdapter(
      speechPolicy,
      speechEngine);
    using var synthesisArguments = JsonDocument.Parse(
      """{"voiceId":"voice","text":"hello","rate":0,"volume":80}""");
    var synthesisResult = await synthesisAdapter.ExecuteAsync(
      ReadContext,
      synthesisArguments.RootElement,
      CancellationToken.None);
    using (var output = JsonDocument.Parse(synthesisResult.OutputJson))
    {
      Assert.True(synthesisAdapter.ValidateResult(output.RootElement).IsValid);
    }
    Assert.Equal("windows-installed-voice", Assert.Single(synthesisResult.Provenance).SourceType);

    var audio = new FakeInteractiveAudioDevice();
    var transcriptionAdapter = new LocalSpeechTranscribeCapabilityAdapter(
      speechPolicy,
      speechEngine,
      audio);
    using var transcriptionArguments = JsonDocument.Parse(
      """{"recognizerId":"recognizer","durationMilliseconds":100,"maxCharacters":64}""");
    var transcriptionResult = await transcriptionAdapter.ExecuteAsync(
      ReadContext,
      transcriptionArguments.RootElement,
      CancellationToken.None);
    using (var output = JsonDocument.Parse(transcriptionResult.OutputJson))
    {
      var validation = transcriptionAdapter.ValidateResult(output.RootElement);
      Assert.True(validation.IsValid, $"{validation.ErrorCode}: {output.RootElement}");
      Assert.Equal("hello world", output.RootElement.GetProperty("transcript").GetString());
      Assert.Equal(ReadContext.TaskId, output.RootElement.GetProperty("taskId").GetString());
      Assert.Equal(ReadContext.PlanVersionId,
        output.RootElement.GetProperty("planVersionId").GetString());
      Assert.Equal(ReadContext.StepId, output.RootElement.GetProperty("stepId").GetString());
      Assert.Equal(ReadContext.DeviceId, output.RootElement.GetProperty("deviceId").GetString());
      Assert.Equal(ReadContext.ActionId, output.RootElement.GetProperty("actionId").GetString());
      Assert.Equal(audio.CapturedBytes, output.RootElement.GetProperty("audioBytes").GetInt64());
      Assert.Equal("UNTRUSTED", output.RootElement.GetProperty("trustLevel").GetString());
      Assert.Equal("NONE", output.RootElement.GetProperty("instructionAuthority").GetString());
      Assert.False(output.RootElement.TryGetProperty("contentBase64", out _));
      Assert.Equal(
        LocalSpeechAudioBinding.Sha256(
          ReadContext,
          output.RootElement.GetProperty("audioSha256").GetString()!),
        output.RootElement.GetProperty("audioBindingSha256").GetString());
    }
    Assert.Equal(2, transcriptionResult.Provenance.Count);
    Assert.Equal(ProvenanceTrust.UntrustedContent, transcriptionResult.Provenance[0].Trust);
    Assert.Equal(audio.CapturedBytes, transcriptionResult.LocalBytesRead);
    Assert.Equal(audio.CapturedBytes, transcriptionResult.LocalBytesWritten);
    Assert.Equal(0, transcriptionResult.ExternalEgressBytes);
    Assert.DoesNotContain("UklGR", transcriptionResult.OutputJson, StringComparison.Ordinal);
  }

  [Fact]
  public async Task LocalSpeechFailureAfterCaptureReturnsOnlySafeMeasuredAccounting()
  {
    var options = Options.Create(new AgentOptions
    {
      MaximumSpeechAudioBytes = 1_048_576,
      MaximumTranscriptCharacters = 256,
      AllowedOfflineSpeechRecognizers =
      [
        new AllowedOfflineSpeechRecognizerOptions
        {
          Id = "recognizer",
          InstalledRecognizerId = "recognizer-token",
          CultureName = "en-US",
        },
      ],
    });
    var audio = new FakeInteractiveAudioDevice();
    var adapter = new LocalSpeechTranscribeCapabilityAdapter(
      new LocalSpeechPolicy(options),
      new FailingLocalSpeechEngine(),
      audio);
    using var arguments = JsonDocument.Parse(
      """{"recognizerId":"recognizer","durationMilliseconds":100,"maxCharacters":256}""");

    var failure = await Assert.ThrowsAsync<MeasuredCapabilityFailureException>(() =>
      adapter.ExecuteAsync(ReadContext, arguments.RootElement, CancellationToken.None).AsTask());

    Assert.Equal("speech_recognition_failed", failure.ErrorCode);
    Assert.Equal(audio.CapturedBytes, failure.Measurement.LocalBytesRead);
    Assert.Equal(audio.CapturedBytes, failure.Measurement.LocalBytesWritten);
    Assert.Equal(0, failure.Measurement.ExternalEgressBytes);
    Assert.Empty(failure.Measurement.Provenance);
    Assert.DoesNotContain("spoken-secret", failure.ToString(), StringComparison.Ordinal);
  }

  [Fact]
  public async Task LocalSpeechTranscriptionRejectsRawAudioAndRedactsBeforeEgress()
  {
    var options = Options.Create(new AgentOptions
    {
      MaximumSpeechAudioBytes = 1_048_576,
      MaximumTranscriptCharacters = 256,
      AllowedOfflineSpeechRecognizers =
      [
        new AllowedOfflineSpeechRecognizerOptions
        {
          Id = "recognizer",
          InstalledRecognizerId = "recognizer-token",
          CultureName = "en-US",
        },
      ],
    });
    var policy = new LocalSpeechPolicy(options);
    var rawAudio = Convert.ToBase64String(BuildPcmWav(100));
    using var forbidden = JsonDocument.Parse($$"""
      {"recognizerId":"recognizer","durationMilliseconds":100,"maxCharacters":256,"contentBase64":"{{rawAudio}}"}
      """);
    Assert.False(StandardUserCapabilityContractValidator.ValidateArguments(
      StandardUserCapabilityCatalog.SpeechTranscribe.Id,
      forbidden.RootElement).IsValid);

    var adapter = new LocalSpeechTranscribeCapabilityAdapter(
      policy,
      new FakeLocalSpeechEngine("password is hunter2"),
      new FakeInteractiveAudioDevice());
    using var arguments = JsonDocument.Parse(
      """{"recognizerId":"recognizer","durationMilliseconds":100,"maxCharacters":256}""");
    var result = await adapter.ExecuteAsync(ReadContext, arguments.RootElement, CancellationToken.None);

    Assert.DoesNotContain("hunter2", result.OutputJson, StringComparison.Ordinal);
    using var output = JsonDocument.Parse(result.OutputJson);
    Assert.True(output.RootElement.GetProperty("redactionsApplied").GetBoolean());
    Assert.Contains("[REDACTED SECRET]",
      output.RootElement.GetProperty("transcript").GetString(),
      StringComparison.Ordinal);
  }

  [Fact]
  public void TypedSchemasRejectRawWindowsTargetsAndUnknownFields()
  {
    AssertInvalid(LocalIdentityCapabilitySchemas.ValidateAccount,
      """{"accountId":"managed-user","accountName":"Administrator"}""");
    AssertInvalid(
      value => NetworkAdapterCapabilitySchemas.ValidateArguments(value, mutation: false),
      $$"""{"adapterId":"ethernet","interfaceGuid":"{{AdapterGuid:D}}"}""");
    AssertInvalid(
      value => PrinterCapabilitySchemas.ValidateQueueArguments(value, mutation: false),
      """{"printerId":"office","printerName":"Raw Queue"}""");
    AssertInvalid(PowerAndSettingsSchemas.ValidateScheme,
      $$"""{"schemeId":"balanced","schemeGuid":"{{SchemeA:D}}"}""");
    AssertInvalid(PowerAndSettingsSchemas.ValidateTimeZoneSet,
      """{"timeZoneId":"zone-a","windowsTimeZoneId":"UTC"}""");
    AssertInvalid(
      value => StandardUserCapabilityContractValidator.ValidateArguments(
        StandardUserCapabilityCatalog.CameraCapture.Id,
        value),
      """{"cameraId":"front","maxWidth":640,"maxHeight":480,"deviceId":"raw"}""");
    AssertInvalid(
      value => StandardUserCapabilityContractValidator.ValidateArguments(
        StandardUserCapabilityCatalog.SpeechSynthesize.Id,
        value),
      """{"voiceId":"voice","text":"hi","rate":0,"volume":80,"installedVoice":"raw"}""");
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

  private static HostCapabilityOptions HostOptions() => new()
  {
    MaximumNetworkAddresses = 8,
    MaximumPrinterDiscoveryResults = 8,
    AllowedLocalAccounts =
    [
      new AllowedLocalAccountOptions
      {
        Id = "managed-user",
        AccountName = "ManagedAgent",
        AllowRead = true,
        AllowEnableDisable = true,
        AllowGroupMembershipChange = true,
      },
    ],
    AllowedLocalGroups =
    [
      new AllowedLocalGroupOptions
      {
        Id = "managed-group",
        GroupName = "ManagedOperators",
        AllowReadMembers = true,
        AllowMembershipChange = true,
      },
    ],
    AllowedNetworkAdapters =
    [
      new AllowedNetworkAdapterOptions
      {
        Id = "ethernet",
        InterfaceGuid = AdapterGuid.ToString("D"),
        AllowInspect = true,
        AllowEnable = true,
        AllowDisable = true,
      },
    ],
    AllowedPrinters =
    [
      new AllowedPrinterOptions
      {
        Id = "office",
        PrinterName = "Managed Queue",
        AllowReadQueue = true,
        AllowPauseResume = true,
      },
    ],
    AllowedPowerSchemes =
    [
      new AllowedPowerSchemeOptions
      {
        Id = "balanced",
        SchemeGuid = SchemeA.ToString("D"),
        AllowActivate = true,
        AllowDisplayTimeoutChange = true,
      },
      new AllowedPowerSchemeOptions
      {
        Id = "saver",
        SchemeGuid = SchemeB.ToString("D"),
        AllowActivate = true,
        AllowDisplayTimeoutChange = true,
      },
    ],
  };

  private static void AssertInvalid(
    Func<JsonElement, CapabilityArgumentValidation> validate,
    string json)
  {
    using var document = JsonDocument.Parse(json);
    Assert.False(validate(document.RootElement).IsValid);
  }

  private sealed class RecordingRecoveryVault : IHostRecoveryVault
  {
    private static readonly JsonSerializerOptions WebSerializerOptions =
      new(JsonSerializerDefaults.Web);
    private ActionExecutionContext? _context;
    private JsonElement _recoveryRecord;
    private string _recordSha256 = string.Empty;

    public string Operation { get; private set; } = string.Empty;

    public ValueTask<HostRecoveryReceipt> PrepareAsync(
      ActionExecutionContext context,
      string operation,
      string preStateSha256,
      object recoveryRecord,
      bool irreversible,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      Assert.False(irreversible);
      _context = context;
      Operation = operation;
      _recoveryRecord = JsonSerializer.SerializeToElement(
        recoveryRecord,
        WebSerializerOptions);
      _recordSha256 = PayloadDigest.Sha256Hex(_recoveryRecord.GetRawText());
      return ValueTask.FromResult(new HostRecoveryReceipt(
        "opaque-test-handle",
        _recordSha256,
        "protected-test-path"));
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
        Irreversible: false,
        _recordSha256,
        _recoveryRecord);
    }
  }

  private sealed class FakeLocalIdentityManager(bool enabled, bool member) :
    IWindowsLocalIdentityManager
  {
    public bool Enabled { get; private set; } = enabled;
    public bool Member { get; private set; } = member;

    public LocalAccountState ReadAccount(string accountName) =>
      new(Enabled, false, true, false, Enabled ? 0u : 2u);

    public void SetAccountEnabled(string accountName, bool enabledValue) =>
      Enabled = enabledValue;

    public bool IsGroupMember(string groupName, string accountName) => Member;

    public void SetGroupMember(string groupName, string accountName, bool memberValue) =>
      Member = memberValue;
  }

  private sealed class FakeNetworkAdapterManager(bool enabled) : IWindowsNetworkAdapterManager
  {
    public bool Enabled { get; private set; } = enabled;

    public NetworkAdapterSnapshot Inspect(Guid interfaceGuid, int maximumAddresses) => new(
      Enabled,
      Enabled ? "Up" : "Down",
      "Ethernet",
      1_000_000_000,
      [new NetworkUnicastAddress("IPv4", "192.0.2.10", 24)],
      ["192.0.2.1"],
      ["192.0.2.53"]);

    public void SetEnabled(Guid interfaceGuid, bool enabledValue) => Enabled = enabledValue;
  }

  private sealed class FakePrinterManager(bool paused) : IWindowsPrinterManager
  {
    public bool Paused { get; private set; } = paused;

    public PrinterQueueSnapshot? TryInspect(string printerName) => new(Paused, 2, 0);

    public void SetPaused(string printerName, bool pausedValue) => Paused = pausedValue;
  }

  private sealed class FakePowerSettingsManager(
    Guid activeScheme,
    uint monitorSeconds) : IWindowsPowerSettingsManager
  {
    private readonly Dictionary<(Guid Scheme, bool Ac), uint> _timeouts = new()
    {
      [(SchemeA, true)] = monitorSeconds,
      [(SchemeA, false)] = monitorSeconds,
      [(SchemeB, true)] = monitorSeconds,
      [(SchemeB, false)] = monitorSeconds,
    };

    public Guid ActiveScheme { get; private set; } = activeScheme;

    public Guid ReadActiveScheme() => ActiveScheme;

    public void SetActiveScheme(Guid schemeGuid) => ActiveScheme = schemeGuid;

    public uint ReadMonitorTimeout(Guid schemeGuid, bool acPower) =>
      _timeouts[(schemeGuid, acPower)];

    public void SetMonitorTimeout(Guid schemeGuid, bool acPower, uint seconds) =>
      _timeouts[(schemeGuid, acPower)] = seconds;
  }

  private sealed class FakeTimeZoneManager(string windowsId) : IWindowsTimeZoneManager
  {
    public string WindowsId { get; private set; } = windowsId;

    public string ReadWindowsTimeZoneId() => WindowsId;

    public void SetWindowsTimeZoneId(string windowsTimeZoneId) => WindowsId = windowsTimeZoneId;
  }

  private sealed class FakeDisplayInventory : IWindowsDisplayInventory
  {
    public IReadOnlyList<DisplaySnapshot> Read() =>
    [
      new DisplaySnapshot(
        PayloadDigest.Sha256Hex("display"),
        true,
        0,
        0,
        1_920,
        1_080,
        32,
        0,
        "landscape"),
    ];
  }

  private sealed class FakeCameraDevice : IInteractiveCameraDevice
  {
    public ValueTask<CameraFrame> CaptureJpegAsync(
      string deviceId,
      int maximumWidth,
      int maximumHeight,
      long maximumBytes,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      return ValueTask.FromResult(new CameraFrame(new byte[256], 640, 480, 512));
    }
  }

  private sealed class FakeInteractiveAudioDevice : IInteractiveAudioDevice
  {
    public long CapturedBytes { get; private set; }

    public ValueTask<byte[]> CapturePcmWavAsync(
      int durationMilliseconds,
      long maximumBytes,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      var content = BuildPcmWav(durationMilliseconds);
      Assert.True(content.LongLength <= maximumBytes);
      CapturedBytes = content.LongLength;
      return ValueTask.FromResult(content);
    }

    public ValueTask PlayPcmWavAsync(
      byte[] content,
      int maximumDurationMilliseconds,
      CancellationToken cancellationToken) => throw new NotSupportedException();
  }

  private static byte[] BuildPcmWav(int durationMilliseconds)
  {
    const int samplesPerSecond = 16_000;
    const short bitsPerSample = 16;
    const short channels = 1;
    var dataBytes = samplesPerSecond * durationMilliseconds / 1_000 * bitsPerSample / 8;
    using var stream = new MemoryStream(44 + dataBytes);
    using var writer = new BinaryWriter(stream, System.Text.Encoding.ASCII, leaveOpen: true);
    writer.Write("RIFF"u8);
    writer.Write(36 + dataBytes);
    writer.Write("WAVE"u8);
    writer.Write("fmt "u8);
    writer.Write(16);
    writer.Write((short)1);
    writer.Write(channels);
    writer.Write(samplesPerSecond);
    writer.Write(samplesPerSecond * channels * bitsPerSample / 8);
    writer.Write((short)(channels * bitsPerSample / 8));
    writer.Write(bitsPerSample);
    writer.Write("data"u8);
    writer.Write(dataBytes);
    writer.Write(new byte[dataBytes]);
    writer.Flush();
    return stream.ToArray();
  }

  private sealed class FakeLocalSpeechEngine(string transcript = "hello world") : ILocalSpeechEngine
  {
    public ValueTask<LocalSpeechSynthesis> SynthesizeAsync(
      ApprovedSpeechVoice voice,
      string text,
      int rate,
      int volume,
      long maximumBytes,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      return ValueTask.FromResult(new LocalSpeechSynthesis(new byte[1_024], 100));
    }

    public ValueTask<LocalSpeechRecognition> RecognizeAsync(
      ApprovedSpeechRecognizer recognizer,
      byte[] wavContent,
      int maximumDurationMilliseconds,
      int maximumCharacters,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      return ValueTask.FromResult(new LocalSpeechRecognition(
        new string(transcript.ToCharArray()),
        0.9));
    }
  }

  private sealed class FailingLocalSpeechEngine : ILocalSpeechEngine
  {
    public ValueTask<LocalSpeechSynthesis> SynthesizeAsync(
      ApprovedSpeechVoice voice,
      string text,
      int rate,
      int volume,
      long maximumBytes,
      CancellationToken cancellationToken) => throw new NotSupportedException();

    public ValueTask<LocalSpeechRecognition> RecognizeAsync(
      ApprovedSpeechRecognizer recognizer,
      byte[] wavContent,
      int maximumDurationMilliseconds,
      int maximumCharacters,
      CancellationToken cancellationToken) =>
      throw new InvalidOperationException(
        "speech_recognition_failed",
        new InvalidDataException("spoken-secret"));
  }
}
