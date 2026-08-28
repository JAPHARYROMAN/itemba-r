using System.Buffers.Binary;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Agent.Capabilities;
using Itemba.Msaidizi.Companion.Agent.Configuration;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Service.Execution;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class GovernedArtifactCapabilityTests
{
  [Fact]
  public void LocalSystemDerivesExactBrowserEgressFloorFromTheTokenBoundArtifact()
  {
    var content = Encoding.UTF8.GetBytes("exact browser upload floor");
    var context = Context();
    using var arguments = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      originId = "itemba",
      originSha256 = new string('a', 64),
      processId = 42,
      automationId = "reviewed-upload-field",
      artifact = Artifact(context, content),
    }));
    try
    {
      Assert.Equal(
        content.LongLength,
        ActionExecutionCoordinator.ConservativeEgressFloor(
          StandardUserCapabilityCatalog.BrowserFileUpload,
          context,
          arguments.RootElement));
      Assert.Throws<HostPreconditionException>(() =>
        ActionExecutionCoordinator.ConservativeEgressFloor(
          StandardUserCapabilityCatalog.BrowserFileUpload,
          context with { DeviceId = "70000000-0000-4000-8000-000000000007" },
          arguments.RootElement));
      Assert.Equal(
        0,
        ActionExecutionCoordinator.ConservativeEgressFloor(
          StandardUserCapabilityCatalog.BrowserFormTextSet,
          context,
          arguments.RootElement));
    }
    finally
    {
      CryptographicOperations.ZeroMemory(content);
    }
  }

  [Fact]
  public async Task BrowserArtifactContractRehashesAndCleansOneActionQuarantine()
  {
    var content = new byte[] { 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a };
    var context = Context();
    using var arguments = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      originId = "itemba",
      originSha256 = new string('a', 64),
      processId = 42,
      automationId = "reviewed-upload-field",
      artifact = Artifact(context, content),
    }));

    var validation = StandardUserCapabilityContractValidator.ValidateArguments(
      "browser.file.upload",
      arguments.RootElement);
    Assert.True(validation.IsValid);
    Assert.True(GovernedArtifactEnvelope.TryDecode(
      arguments.RootElement.GetProperty("artifact"),
      context,
      "SCREENSHOT",
      out var descriptor,
      out var decoded));
    string? quarantinePath = null;
    var quarantineRoot = TemporaryRoot();
    var quarantine = new BrowserArtifactQuarantine(quarantineRoot, requireHardenedAcl: false);
    try
    {
      var consumed = await quarantine.UseAsync(
        context.ActionId,
        descriptor,
        decoded,
        path =>
        {
          quarantinePath = path;
          Assert.True(File.Exists(path));
          using var reader = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
          var observed = new byte[content.Length];
          Assert.Equal(content.Length, reader.Read(observed));
          Assert.Equal(content, observed);
          return ValueTask.FromResult(true);
        },
        CancellationToken.None);
      Assert.True(consumed.Value);
      Assert.True(consumed.CleanupConfirmed);
      using var result = JsonDocument.Parse(JsonSerializer.Serialize(new
      {
        set = consumed.Value,
        artifactSha256 = descriptor.Sha256,
        quarantineCleanupConfirmed = consumed.CleanupConfirmed,
        destinationScopeSha256 = new string('d', 64),
      }));
      Assert.True(StandardUserCapabilityContractValidator.ValidateResult(
        "browser.file.upload",
        result.RootElement).IsValid);
      Assert.NotNull(quarantinePath);
      Assert.False(File.Exists(quarantinePath));
      Assert.False(Directory.Exists(Path.GetDirectoryName(quarantinePath)!));
      Assert.Empty(Directory.EnumerateFileSystemEntries(quarantineRoot));
    }
    finally
    {
      CryptographicOperations.ZeroMemory(decoded);
      CryptographicOperations.ZeroMemory(content);
      Directory.Delete(quarantineRoot, recursive: true);
    }
  }

  [Fact]
  public async Task BrowserArtifactQuarantineLocksLeafAgainstReplacementDuringConsumption()
  {
    var content = new byte[] { 0x89, 0x50, 0x4e, 0x47 };
    var context = Context();
    using var arguments = JsonDocument.Parse(JsonSerializer.Serialize(Artifact(context, content)));
    Assert.True(GovernedArtifactEnvelope.TryDecode(
      arguments.RootElement,
      context,
      "SCREENSHOT",
      out var descriptor,
      out var decoded));
    var quarantineRoot = TemporaryRoot();
    var quarantine = new BrowserArtifactQuarantine(quarantineRoot, requireHardenedAcl: false);
    try
    {
      var used = await quarantine.UseAsync(
        context.ActionId,
        descriptor,
        decoded,
        path =>
        {
          var replacement = path + ".replacement";
          Assert.ThrowsAny<IOException>(() => File.Delete(path));
          Assert.ThrowsAny<IOException>(() => File.Move(path, replacement));
          Assert.False(File.Exists(replacement));
          return ValueTask.FromResult(true);
        },
        CancellationToken.None);
      Assert.True(used.Value);
      Assert.True(used.CleanupConfirmed);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(decoded);
      CryptographicOperations.ZeroMemory(content);
      Directory.Delete(quarantineRoot, recursive: true);
    }
  }

  [Fact]
  public async Task BrowserArtifactCleanupFailurePreservesCompletedUiOutcomeAndZeroesBytes()
  {
    var content = new byte[] { 0x89, 0x50, 0x4e, 0x47 };
    var context = Context();
    using var arguments = JsonDocument.Parse(JsonSerializer.Serialize(Artifact(context, content)));
    Assert.True(GovernedArtifactEnvelope.TryDecode(
      arguments.RootElement,
      context,
      "SCREENSHOT",
      out var descriptor,
      out var decoded));
    var quarantineRoot = TemporaryRoot();
    var quarantine = new BrowserArtifactQuarantine(quarantineRoot, requireHardenedAcl: false);
    FileStream? deletionBlocker = null;
    string? quarantinePath = null;
    try
    {
      var used = await quarantine.UseAsync(
        context.ActionId,
        descriptor,
        decoded,
        path =>
        {
          quarantinePath = path;
          deletionBlocker = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite);
          return ValueTask.FromResult(true);
        },
        CancellationToken.None);
      Assert.True(used.Value);
      Assert.False(used.CleanupConfirmed);
      Assert.NotNull(quarantinePath);
      Assert.True(File.Exists(quarantinePath));
      Assert.All(File.ReadAllBytes(quarantinePath), value => Assert.Equal(0, value));
    }
    finally
    {
      deletionBlocker?.Dispose();
      if (quarantinePath is not null && File.Exists(quarantinePath)) File.Delete(quarantinePath);
      if (quarantinePath is not null)
      {
        var actionDirectory = Path.GetDirectoryName(quarantinePath)!;
        if (Directory.Exists(actionDirectory)) Directory.Delete(actionDirectory);
      }
      CryptographicOperations.ZeroMemory(decoded);
      CryptographicOperations.ZeroMemory(content);
      Directory.Delete(quarantineRoot, recursive: true);
    }
  }

  [Fact]
  public async Task BrowserArtifactQuarantineRejectsAReparseParentBeforeWriting()
  {
    var content = new byte[] { 0x89, 0x50, 0x4e, 0x47 };
    var context = Context();
    using var arguments = JsonDocument.Parse(JsonSerializer.Serialize(Artifact(context, content)));
    Assert.True(GovernedArtifactEnvelope.TryDecode(
      arguments.RootElement,
      context,
      "SCREENSHOT",
      out var descriptor,
      out var decoded));
    var container = TemporaryRoot();
    var actualRoot = Path.Combine(container, "actual");
    var reparseRoot = Path.Combine(container, "reparse");
    Directory.CreateDirectory(actualRoot);
    CreateDirectoryJunction(reparseRoot, actualRoot);
    var quarantine = new BrowserArtifactQuarantine(reparseRoot, requireHardenedAcl: false);
    try
    {
      await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        await quarantine.UseAsync(
          context.ActionId,
          descriptor,
          decoded,
          _ => ValueTask.FromResult(true),
          CancellationToken.None));
      Assert.Empty(Directory.EnumerateFileSystemEntries(actualRoot));
    }
    finally
    {
      CryptographicOperations.ZeroMemory(decoded);
      CryptographicOperations.ZeroMemory(content);
      Directory.Delete(reparseRoot);
      Directory.Delete(container, recursive: true);
    }
  }

  [Fact]
  public void EnrolledDeviceProvisioningCreatesTheCanonicalExactAclRoot()
  {
    var localAppData = TemporaryRoot();
    var canonical = Path.Combine(localAppData, "Itemba", "Msaidizi", "artifact-quarantine");
    var options = new AgentOptions
    {
      DeviceId = Context().DeviceId,
      ExecutionEnabled = true,
      ArtifactQuarantineRoot = canonical,
    };
    try
    {
      Assert.True(BrowserArtifactQuarantineProvisioner.EnsureProvisionedForEnrolledDevice(
        options,
        localAppData,
        out var status));
      Assert.Equal("READY", status);
      var quarantine = new BrowserArtifactQuarantine(canonical, requireHardenedAcl: true);
      Assert.True(quarantine.IsReady(out status));
      Assert.Equal("READY", status);
    }
    finally
    {
      Directory.Delete(localAppData, recursive: true);
    }
  }

  [Fact]
  public void EnrollmentRefusesToBlessExistingUntrustedQuarantineContent()
  {
    var localAppData = TemporaryRoot();
    var canonical = Path.Combine(localAppData, "Itemba", "Msaidizi", "artifact-quarantine");
    Directory.CreateDirectory(canonical);
    File.WriteAllText(Path.Combine(canonical, "attacker-controlled.txt"), "untrusted");
    var options = new AgentOptions
    {
      DeviceId = Context().DeviceId,
      ExecutionEnabled = true,
      ArtifactQuarantineRoot = canonical,
    };
    try
    {
      Assert.False(BrowserArtifactQuarantineProvisioner.EnsureProvisionedForEnrolledDevice(
        options,
        localAppData,
        out var status));
      Assert.Equal("ARTIFACT_QUARANTINE_UNTRUSTED_EXISTING_CONTENT", status);
      Assert.True(File.Exists(Path.Combine(canonical, "attacker-controlled.txt")));
    }
    finally
    {
      Directory.Delete(localAppData, recursive: true);
    }
  }

  private static string TemporaryRoot()
  {
    var root = Path.Combine(
      Path.GetTempPath(),
      "Itemba.Msaidizi.GovernedArtifactTests",
      Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(root);
    return root;
  }

  private static void CreateDirectoryJunction(string junctionPath, string targetPath)
  {
    const uint genericWrite = 0x40000000;
    const uint shareAll = 0x00000007;
    const uint openExisting = 3;
    const uint backupSemantics = 0x02000000;
    const uint openReparsePoint = 0x00200000;
    const uint setReparsePoint = 0x000900A4;
    const uint mountPointTag = 0xA0000003;

    Directory.CreateDirectory(junctionPath);
    using var handle = CreateFileW(
      junctionPath,
      genericWrite,
      shareAll,
      IntPtr.Zero,
      openExisting,
      backupSemantics | openReparsePoint,
      IntPtr.Zero);
    if (handle.IsInvalid)
      throw new Win32Exception(Marshal.GetLastWin32Error());

    var printName = Path.GetFullPath(targetPath);
    var substituteName = @"\??\" + printName;
    var substitute = Encoding.Unicode.GetBytes(substituteName);
    var printable = Encoding.Unicode.GetBytes(printName);
    var pathBytes = substitute.Length + sizeof(char) + printable.Length + sizeof(char);
    var buffer = new byte[16 + pathBytes];
    BinaryPrimitives.WriteUInt32LittleEndian(buffer.AsSpan(0, 4), mountPointTag);
    BinaryPrimitives.WriteUInt16LittleEndian(buffer.AsSpan(4, 2), checked((ushort)(8 + pathBytes)));
    BinaryPrimitives.WriteUInt16LittleEndian(buffer.AsSpan(8, 2), 0);
    BinaryPrimitives.WriteUInt16LittleEndian(buffer.AsSpan(10, 2), checked((ushort)substitute.Length));
    BinaryPrimitives.WriteUInt16LittleEndian(
      buffer.AsSpan(12, 2),
      checked((ushort)(substitute.Length + sizeof(char))));
    BinaryPrimitives.WriteUInt16LittleEndian(buffer.AsSpan(14, 2), checked((ushort)printable.Length));
    substitute.CopyTo(buffer, 16);
    printable.CopyTo(buffer, 16 + substitute.Length + sizeof(char));
    if (!DeviceIoControl(
        handle,
        setReparsePoint,
        buffer,
        buffer.Length,
        null,
        0,
        out _,
        IntPtr.Zero))
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern SafeFileHandle CreateFileW(
    string fileName,
    uint desiredAccess,
    uint shareMode,
    IntPtr securityAttributes,
    uint creationDisposition,
    uint flagsAndAttributes,
    IntPtr templateFile);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool DeviceIoControl(
    SafeFileHandle device,
    uint controlCode,
    byte[] input,
    int inputLength,
    byte[]? output,
    int outputLength,
    out int bytesReturned,
    IntPtr overlapped);

  [Fact]
  public void BrowserArtifactRejectsContentAndExecutionScopeSubstitution()
  {
    var content = new byte[] { 0x89, 0x50, 0x4e, 0x47 };
    var context = Context();
    var envelope = Artifact(context, content);
    envelope["contentBase64"] = Convert.ToBase64String([1, 2, 3, 4]);
    var tampered = JsonSerializer.SerializeToElement(envelope);
    Assert.False(GovernedArtifactEnvelope.TryDecode(
      tampered,
      context,
      "SCREENSHOT",
      out _,
      out _));

    envelope = Artifact(context, content);
    var valid = JsonSerializer.SerializeToElement(envelope);
    var wrongDevice = context with
    {
      DeviceId = "70000000-0000-4000-8000-000000000007",
    };
    Assert.False(GovernedArtifactEnvelope.TryDecode(
      valid,
      wrongDevice,
      "SCREENSHOT",
      out _,
      out _));
    CryptographicOperations.ZeroMemory(content);
  }

  private static ActionExecutionContext Context() => new(
    "10000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000002",
    "30000000-0000-4000-8000-000000000003",
    "40000000-0000-4000-8000-000000000004",
    "50000000-0000-4000-8000-000000000005",
    "60000000-0000-4000-8000-000000000006",
    "idempotency-1",
    new string('b', 64),
    new string('c', 64),
    new ActionBudget(300, 5, 5, 1, 1_000_000, 1_000_000, 1));

  private static Dictionary<string, object?> Artifact(
    ActionExecutionContext context,
    byte[] content)
  {
    const string sourceStepId = "80000000-0000-4000-8000-000000000008";
    const string sourceAttemptId = "attempt-source-1";
    const string artifactId = "90000000-0000-4000-8000-000000000009";
    var sha256 = Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
    var scope = GovernedArtifactEnvelope.ScopeSha256(
      context.TaskId,
      context.PlanVersionId,
      context.StepId,
      context.DeviceId,
      sourceStepId,
      sourceAttemptId,
      artifactId,
      sha256,
      content.Length,
      "image/png",
      "reviewed-screen.png",
      "SCREENSHOT",
      "Restricted");
    return new Dictionary<string, object?>
    {
      ["schemaVersion"] = 1,
      ["taskId"] = context.TaskId,
      ["planVersionId"] = context.PlanVersionId,
      ["targetStepId"] = context.StepId,
      ["deviceId"] = context.DeviceId,
      ["sourceStepId"] = sourceStepId,
      ["sourceAttemptId"] = sourceAttemptId,
      ["artifactId"] = artifactId,
      ["sha256"] = sha256,
      ["byteSize"] = content.Length,
      ["mimeType"] = "image/png",
      ["name"] = "reviewed-screen.png",
      ["kind"] = "SCREENSHOT",
      ["dataClass"] = "Restricted",
      ["scopeSha256"] = scope,
      ["contentBase64"] = Convert.ToBase64String(content),
    };
  }
}
