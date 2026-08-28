using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class FileSystemAclCapabilityTests : IDisposable
{
  private readonly string _testRoot = Path.Combine(
    Path.GetTempPath(),
    $"itemba-msaidizi-acl-{Guid.NewGuid():N}");

  [Fact]
  public async Task AclMutationUsesProfileAndExactRecoveryRecord()
  {
    var managed = Path.Combine(_testRoot, "managed");
    var quarantine = Path.Combine(_testRoot, "quarantine");
    Directory.CreateDirectory(managed);
    Directory.CreateDirectory(quarantine);
    File.WriteAllText(Path.Combine(managed, "invoice.txt"), "governed");

    var hostOptions = new HostCapabilityOptions
    {
      Enabled = true,
      AllowedRoots =
      [
        new AllowedHostRootOptions
        {
          Id = "managed",
          Path = managed,
          QuarantinePath = quarantine,
          AllowRead = true,
          AllowWrite = true,
        },
      ],
      AllowedFileAclProfiles =
      [
        new AllowedFileAclProfileOptions
        {
          Id = "system-only",
          Sddl = "D:P(A;;FA;;;SY)",
          RootIds = ["managed"],
        },
      ],
    };
    var paths = new SupervisorPathPolicy(
      Options.Create(hostOptions),
      Options.Create(new CompanionOptions
      {
        JournalPath = Path.Combine(_testRoot, "supervisor", "journal.jsonl"),
        KillSwitchPath = Path.Combine(_testRoot, "supervisor", "DISABLED"),
        ResultCachePath = Path.Combine(_testRoot, "supervisor", "results"),
      }));
    var policy = new FileAclPolicy(Options.Create(hostOptions));
    var permissions = new FakeFileAclManager(
      "D:P(A;;FA;;;SY)(A;;FA;;;BA)",
      protectedDacl: true);
    var recoveryVault = new RecordingRecoveryVault();
    var adapter = new FileSystemAclSetCapabilityAdapter(
      paths,
      policy,
      permissions,
      recoveryVault);
    using var arguments = JsonDocument.Parse(
      """{"rootId":"managed","relativePath":"invoice.txt","profileId":"system-only"}""");
    var before = permissions.Current.StateSha256;

    var result = await adapter.ExecuteAsync(
      Context(before),
      arguments.RootElement,
      CancellationToken.None);

    Assert.True(result.MutationCommitted);
    Assert.Equal(before, result.PreStateSha256);
    Assert.NotEqual(before, permissions.Current.StateSha256);
    using (var output = JsonDocument.Parse(result.OutputJson))
    {
      Assert.True(adapter.ValidateResult(output.RootElement).IsValid);
      Assert.Equal("system-only", output.RootElement.GetProperty("profileId").GetString());
    }
    Assert.Equal("filesystem.acl.set", recoveryVault.Operation);
    Assert.Equal("managed", recoveryVault.Record.GetProperty("rootId").GetString());
    Assert.Equal("invoice.txt", recoveryVault.Record.GetProperty("relativePath").GetString());
    Assert.Equal(
      "D:P(A;;FA;;;SY)(A;;FA;;;BA)",
      recoveryVault.Record.GetProperty("daclSddl").GetString());

    var recovery = new FileAclAdministrativeRecoveryOperation(paths, permissions);
    var record = recoveryVault.TrustedRecord();
    var changedState = await recovery.ReadStateAsync(record, CancellationToken.None);
    Assert.Equal(permissions.Current.StateSha256, changedState);
    await recovery.RestoreAsync(record, CancellationToken.None);
    Assert.Equal(before, await recovery.ReadStateAsync(record, CancellationToken.None));
  }

  [Fact]
  public void AclPolicyRejectsTemplatesThatCanLockOutTrustedRecovery()
  {
    var options = Options.Create(new HostCapabilityOptions
    {
      Enabled = true,
      AllowedRoots =
      [
        new AllowedHostRootOptions
        {
          Id = "managed",
          Path = Path.GetTempPath(),
          QuarantinePath = Path.Combine(Path.GetTempPath(), $"q-{Guid.NewGuid():N}"),
          AllowWrite = true,
        },
      ],
      AllowedFileAclProfiles =
      [
        new AllowedFileAclProfileOptions
        {
          Id = "unsafe",
          Sddl = "D:P(A;;FA;;;BA)",
          RootIds = ["managed"],
        },
      ],
    });

    var error = Assert.Throws<InvalidOperationException>(() => new FileAclPolicy(options));
    Assert.Contains("LocalSystem", error.Message, StringComparison.Ordinal);
  }

  [Fact]
  public void AclPolicyRejectsGenericDenyThatWouldApplyToLocalSystem()
  {
    var options = Options.Create(new HostCapabilityOptions
    {
      Enabled = true,
      AllowedRoots =
      [
        new AllowedHostRootOptions
        {
          Id = "managed",
          Path = Path.GetTempPath(),
          QuarantinePath = Path.Combine(Path.GetTempPath(), $"q-{Guid.NewGuid():N}"),
          AllowWrite = true,
        },
      ],
      AllowedFileAclProfiles =
      [
        new AllowedFileAclProfileOptions
        {
          Id = "generic-deny",
          Sddl = "D:P(D;;GA;;;WD)(A;;FA;;;SY)",
          RootIds = ["managed"],
        },
      ],
    });

    var error = Assert.Throws<InvalidOperationException>(() => new FileAclPolicy(options));
    Assert.Contains("unconditional allow", error.Message, StringComparison.Ordinal);
  }

  [Fact]
  public void AclSchemasRejectRawSddlAndAbsolutePathOverrides()
  {
    using var rawSddl = JsonDocument.Parse(
      """{"rootId":"managed","relativePath":"invoice.txt","profileId":"safe","sddl":"D:(A;;FA;;;WD)"}""");
    using var rawPath = JsonDocument.Parse(
      """{"rootId":"managed","relativePath":"invoice.txt","absolutePath":"C:\\Windows"}""");

    Assert.False(FileSystemAclCapabilitySchemas.ValidateSet(rawSddl.RootElement).IsValid);
    Assert.False(FileSystemAclCapabilitySchemas.ValidateTarget(rawPath.RootElement).IsValid);
  }

  [Fact]
  public void NativeAclReaderUsesTheValidatedFileHandle()
  {
    var managed = Path.Combine(_testRoot, "native-managed");
    var quarantine = Path.Combine(_testRoot, "native-quarantine");
    Directory.CreateDirectory(managed);
    Directory.CreateDirectory(quarantine);
    File.WriteAllText(Path.Combine(managed, "sample.txt"), "acl");
    var host = Options.Create(new HostCapabilityOptions
    {
      Enabled = true,
      AllowedRoots =
      [
        new AllowedHostRootOptions
        {
          Id = "native",
          Path = managed,
          QuarantinePath = quarantine,
          AllowRead = true,
          AllowWrite = true,
        },
      ],
    });
    var paths = new SupervisorPathPolicy(
      host,
      Options.Create(new CompanionOptions
      {
        JournalPath = Path.Combine(_testRoot, "native-supervisor", "journal.jsonl"),
        KillSwitchPath = Path.Combine(_testRoot, "native-supervisor", "DISABLED"),
        ResultCachePath = Path.Combine(_testRoot, "native-supervisor", "results"),
      }));
    var target = paths.Resolve("native", "sample.txt", HostPathAccess.Read);
    using var handle = paths.OpenExisting(
      target,
      lockAgainstMutation: true,
      readSecurityAccess: true);

    var manager = new WindowsFileAclManager();
    var state = manager.Read(handle);

    Assert.StartsWith("D:", state.DaclSddl, StringComparison.Ordinal);
    Assert.True(PayloadDigest.IsSha256Hex(state.StateSha256));
    Assert.True(state.BytesRead > 0);
  }

  public void Dispose()
  {
    if (Directory.Exists(_testRoot))
    {
      Directory.Delete(_testRoot, recursive: true);
    }
    GC.SuppressFinalize(this);
  }

  private static ActionExecutionContext Context(string expectedPreStateSha256) => new(
    Guid.NewGuid().ToString("N"),
    "task",
    "plan",
    "step",
    "device",
    "mandate",
    "idempotency",
    expectedPreStateSha256,
    null,
    new ActionBudget(60, 10, 10, 1, 1_048_576, 1_048_576, 1));

  private sealed class FakeFileAclManager(
    string daclSddl,
    bool protectedDacl) : IWindowsFileAclManager
  {
    public FileAclState Current { get; private set; } = State(daclSddl, protectedDacl);

    public FileAclState Read(ValidatedPathHandle target)
    {
      _ = target;
      return Current;
    }

    public void SetDacl(
      ValidatedPathHandle target,
      string canonicalDaclSddl,
      bool protectedDacl)
    {
      _ = target;
      Current = State(canonicalDaclSddl, protectedDacl);
    }

    private static FileAclState State(string sddl, bool protectedDacl) => new(
      "S-1-5-18",
      "S-1-5-32-544",
      sddl,
      protectedDacl,
      FileAclState.State(sddl, protectedDacl),
      sddl.Length);
  }

  private sealed class RecordingRecoveryVault : IHostRecoveryVault
  {
    private static readonly JsonSerializerOptions WebSerializerOptions =
      new(JsonSerializerDefaults.Web);
    public string Operation { get; private set; } = string.Empty;
    public string PreStateSha256 { get; private set; } = string.Empty;
    public JsonElement Record { get; private set; }
    private ActionExecutionContext? _context;

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
      PreStateSha256 = preStateSha256;
      Record = JsonSerializer.SerializeToElement(
        recoveryRecord,
        WebSerializerOptions);
      return ValueTask.FromResult(new HostRecoveryReceipt(
        "opaque",
        new string('a', 64),
        "protected"));
    }

    public TrustedHostRecoveryRecord TrustedRecord()
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
        PreStateSha256,
        Irreversible: false,
        new string('a', 64),
        Record);
    }
  }
}
