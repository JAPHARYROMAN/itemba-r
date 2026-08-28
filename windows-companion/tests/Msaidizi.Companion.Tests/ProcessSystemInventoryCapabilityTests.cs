using System.Text.Json;
using System.Text.Json.Nodes;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class ProcessSystemInventoryCapabilityTests
{
  private static readonly DateTimeOffset ObservedAt =
    new(2026, 8, 28, 9, 30, 0, TimeSpan.Zero);

  [Fact]
  public void DescriptorIsConfidentialMandatedLocalSystemReadAndRegistrySafe()
  {
    var adapter = CreateAdapter(new FakeInventory([]));
    var descriptor = adapter.Descriptor;

    Assert.Equal("process.system.inventory.read", descriptor.Id);
    Assert.Equal("1.0.0", descriptor.Version);
    Assert.Equal(CapabilityDataClass.Confidential, descriptor.DataClass);
    Assert.Equal(CapabilityEffect.LocalRead, descriptor.Effect);
    Assert.Equal(ConsentRequirement.SignedMandate, descriptor.Consent);
    Assert.Equal(RecoveryKind.NotApplicable, descriptor.Recovery);
    Assert.Equal(RequiredPrivilege.LocalSystem, descriptor.RequiredPrivilege);
    Assert.Equal(IdempotencySemantics.Required, descriptor.Idempotency);
    Assert.False(descriptor.TouchesTrustedRoot);
    Assert.False(TrustedRootComponents.IsProtectedCapabilityId(descriptor.Id));
    Assert.False(descriptor.IsMutation);
    Assert.False(descriptor.ArgumentsSchema.GetProperty("additionalProperties").GetBoolean());
    Assert.False(descriptor.ResultSchema.GetProperty("additionalProperties").GetBoolean());

    var schema = descriptor.ResultSchema.GetRawText();
    Assert.DoesNotContain("commandLine", schema, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("environment", schema, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("executablePath", schema, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("owner", schema, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("windowText", schema, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("module", schema, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("memory", schema, StringComparison.OrdinalIgnoreCase);

    var registry = new CapabilityRegistry([adapter]);
    Assert.True(registry.TryResolve(descriptor.Id, descriptor.Version, out var resolved));
    Assert.Same(adapter, resolved);
  }

  [Fact]
  public void PackagedPostureKeepsTheLocalSystemPackOffAndBoundsInventory()
  {
    var path = Path.Combine(
      AppContext.BaseDirectory,
      "test-assets",
      "service-appsettings.json");
    using var document = JsonDocument.Parse(File.ReadAllText(path));
    var host = document.RootElement.GetProperty("HostCapabilities");

    Assert.False(host.GetProperty("Enabled").GetBoolean());
    Assert.Equal(512, host.GetProperty("MaximumProcessInventoryEntries").GetInt32());
  }

  [Fact]
  public async Task ReadSortsTruncatesAccountsAndProvesExactSnapshot()
  {
    var inventory = new FakeInventory(
    [
      new SystemProcessSnapshot(42, 3, "worker.exe"),
      new SystemProcessSnapshot(7, null, "transient.exe"),
      new SystemProcessSnapshot(100, 1, "service.exe"),
    ]);
    var adapter = CreateAdapter(inventory, configuredMaximum: 2);
    using var arguments = JsonDocument.Parse("""{"maxEntries":2}""");

    var result = await adapter.ExecuteAsync(
      ReadContext,
      arguments.RootElement,
      CancellationToken.None);

    Assert.False(result.MutationCommitted);
    Assert.False(result.OutcomeUncertain);
    Assert.Equal(0, result.LocalBytesWritten);
    Assert.Equal(0, result.ExternalEgressBytes);
    Assert.Equal(
      SystemProcessInventoryRules.FullSnapshotCommitment(
      [
        new SystemProcessSnapshot(7, null, "transient.exe"),
        new SystemProcessSnapshot(42, 3, "worker.exe"),
        new SystemProcessSnapshot(100, 1, "service.exe"),
      ]).CanonicalBytes,
      result.LocalBytesRead);
    using var output = JsonDocument.Parse(result.OutputJson);
    Assert.True(adapter.ValidateResult(output.RootElement).IsValid);
    Assert.Equal(3, output.RootElement.GetProperty("totalObserved").GetInt32());
    Assert.Equal(2, output.RootElement.GetProperty("returnedEntries").GetInt32());
    Assert.Equal(1, output.RootElement.GetProperty("omittedEntries").GetInt32());
    Assert.Equal(2, output.RootElement.GetProperty("requestedMaxEntries").GetInt32());
    Assert.True(output.RootElement.GetProperty("truncated").GetBoolean());
    var processes = output.RootElement.GetProperty("processes").EnumerateArray().ToArray();
    Assert.Equal([7u, 42u], processes.Select(process =>
      process.GetProperty("processId").GetUInt32()).ToArray());
    Assert.Equal(JsonValueKind.Null, processes[0].GetProperty("sessionId").ValueKind);
    Assert.Equal("transient.exe", processes[0].GetProperty("name").GetString());
    Assert.Equal("worker.exe", processes[1].GetProperty("name").GetString());
    Assert.DoesNotContain("path", result.OutputJson, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("commandLine", result.OutputJson, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("environment", result.OutputJson, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("owner", result.OutputJson, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("window", result.OutputJson, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("module", result.OutputJson, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("memory", result.OutputJson, StringComparison.OrdinalIgnoreCase);

    var snapshotSha256 = output.RootElement.GetProperty("snapshotSha256").GetString();
    var returnedEntriesSha256 = output.RootElement
      .GetProperty("returnedEntriesSha256")
      .GetString();
    Assert.Equal(
      SystemProcessInventoryRules.ReturnedEntriesSha256(2, 3,
      [
        new SystemProcessSnapshot(7, null, "transient.exe"),
        new SystemProcessSnapshot(42, 3, "worker.exe"),
      ]),
      returnedEntriesSha256);
    Assert.Equal(result.PreStateSha256, snapshotSha256);
    var provenance = Assert.Single(result.Provenance);
    Assert.Equal("windows-system-process-snapshot", provenance.SourceType);
    Assert.Equal(snapshotSha256, provenance.ContentSha256);
    Assert.Equal(ProvenanceTrust.UntrustedContent, provenance.Trust);
    Assert.Equal(ObservedAt, provenance.ObservedAt);
    Assert.Equal(
      PayloadDigest.Sha256Hex($"msaidizi-device:v1:{ReadContext.DeviceId}"),
      provenance.SourceIdentifierHash);
    Assert.Equal(1, inventory.Calls);
  }

  [Theory]
  [InlineData("{}")]
  [InlineData("{\"maxEntries\":0}")]
  [InlineData("{\"maxEntries\":3}")]
  [InlineData("{\"maxEntries\":1.5}")]
  [InlineData("{\"maxEntries\":\"1\"}")]
  [InlineData("{\"maxEntries\":1,\"extra\":true}")]
  [InlineData("{\"maxEntries\":1,\"maxEntries\":1}")]
  public void ArgumentsAreStrictClosedAndDeploymentBounded(string json)
  {
    var adapter = CreateAdapter(new FakeInventory([]), configuredMaximum: 2);
    using var document = JsonDocument.Parse(json);

    Assert.False(adapter.ValidateArguments(document.RootElement).IsValid);
  }

  [Theory]
  [InlineData(0)]
  [InlineData(2049)]
  public void InvalidDeploymentMaximumFailsClosedAtConstruction(int configuredMaximum)
  {
    Assert.Throws<ArgumentOutOfRangeException>(() =>
      CreateAdapter(new FakeInventory([]), configuredMaximum));
  }

  [Fact]
  public async Task ProviderCannotInjectRawPathOrUnboundedOrDuplicateIdentity()
  {
    using var arguments = JsonDocument.Parse("""{"maxEntries":1}""");
    var rawPath = CreateAdapter(new FakeInventory(
    [
      new SystemProcessSnapshot(10, 0, @"C:\Sensitive\secret.exe"),
    ]));
    var pathFailure = await Assert.ThrowsAsync<HostPreconditionException>(() =>
      rawPath.ExecuteAsync(ReadContext, arguments.RootElement, CancellationToken.None).AsTask());
    Assert.Equal("process_inventory_snapshot_invalid", pathFailure.ErrorCode);
    Assert.DoesNotContain("Sensitive", pathFailure.ToString(), StringComparison.Ordinal);

    var duplicate = CreateAdapter(new FakeInventory(
    [
      new SystemProcessSnapshot(10, 0, "first.exe"),
      new SystemProcessSnapshot(10, 1, "second.exe"),
    ]));
    var duplicateFailure = await Assert.ThrowsAsync<HostPreconditionException>(() =>
      duplicate.ExecuteAsync(
        ReadContext,
        arguments.RootElement,
        CancellationToken.None).AsTask());
    Assert.Equal("process_inventory_snapshot_invalid", duplicateFailure.ErrorCode);

    var tooMany = Enumerable.Range(
        0,
        WindowsSystemProcessInventory.MaximumObservedEntries + 1)
      .Select(index => new SystemProcessSnapshot(
        checked((uint)index),
        0,
        $"process-{index}.exe"))
      .ToArray();
    var bound = CreateAdapter(new FakeInventory(tooMany));
    var boundFailure = await Assert.ThrowsAsync<HostPreconditionException>(() =>
      bound.ExecuteAsync(ReadContext, arguments.RootElement, CancellationToken.None).AsTask());
    Assert.Equal("process_inventory_snapshot_invalid", boundFailure.ErrorCode);
  }

  [Fact]
  public async Task SnapshotIsDeterministicAcrossProviderEnumerationOrder()
  {
    var first = CreateAdapter(new FakeInventory(
    [
      new SystemProcessSnapshot(20, 2, "beta.exe"),
      new SystemProcessSnapshot(10, 1, "alpha.exe"),
    ]));
    var second = CreateAdapter(new FakeInventory(
    [
      new SystemProcessSnapshot(10, 1, "alpha.exe"),
      new SystemProcessSnapshot(20, 2, "beta.exe"),
    ]));
    using var arguments = JsonDocument.Parse("""{"maxEntries":2}""");

    var firstResult = await first.ExecuteAsync(
      ReadContext,
      arguments.RootElement,
      CancellationToken.None);
    var secondResult = await second.ExecuteAsync(
      ReadContext,
      arguments.RootElement,
      CancellationToken.None);

    Assert.Equal(firstResult.OutputJson, secondResult.OutputJson);
    Assert.Equal(firstResult.PreStateSha256, secondResult.PreStateSha256);
  }

  [Fact]
  public async Task FullSnapshotDigestCommitsAnOmittedIdentity()
  {
    var first = CreateAdapter(new FakeInventory(
    [
      new SystemProcessSnapshot(1, 0, "returned.exe"),
      new SystemProcessSnapshot(2, 0, "omitted-a.exe"),
    ]));
    var second = CreateAdapter(new FakeInventory(
    [
      new SystemProcessSnapshot(1, 0, "returned.exe"),
      new SystemProcessSnapshot(2, 0, "omitted-b.exe"),
    ]));
    var withoutOmitted = CreateAdapter(new FakeInventory(
    [
      new SystemProcessSnapshot(1, 0, "returned.exe"),
    ]));
    using var arguments = JsonDocument.Parse("""{"maxEntries":1}""");

    var firstResult = await first.ExecuteAsync(
      ReadContext,
      arguments.RootElement,
      CancellationToken.None);
    var secondResult = await second.ExecuteAsync(
      ReadContext,
      arguments.RootElement,
      CancellationToken.None);
    var withoutOmittedResult = await withoutOmitted.ExecuteAsync(
      ReadContext,
      arguments.RootElement,
      CancellationToken.None);
    using var firstOutput = JsonDocument.Parse(firstResult.OutputJson);
    using var secondOutput = JsonDocument.Parse(secondResult.OutputJson);

    Assert.Equal(
      firstOutput.RootElement.GetProperty("processes").GetRawText(),
      secondOutput.RootElement.GetProperty("processes").GetRawText());
    Assert.Equal(
      firstOutput.RootElement.GetProperty("returnedEntriesSha256").GetString(),
      secondOutput.RootElement.GetProperty("returnedEntriesSha256").GetString());
    Assert.NotEqual(
      firstOutput.RootElement.GetProperty("snapshotSha256").GetString(),
      secondOutput.RootElement.GetProperty("snapshotSha256").GetString());
    Assert.NotEqual(firstResult.PreStateSha256, secondResult.PreStateSha256);
    Assert.NotEqual(
      Assert.Single(firstResult.Provenance).ContentSha256,
      Assert.Single(secondResult.Provenance).ContentSha256);
    Assert.True(firstResult.LocalBytesRead > withoutOmittedResult.LocalBytesRead);
  }

  [Fact]
  public async Task ResultValidatorRejectsUnknownSensitiveFieldsAndStateMutation()
  {
    var adapter = CreateAdapter(new FakeInventory(
    [
      new SystemProcessSnapshot(1, 0, "safe.exe"),
    ]));
    using var arguments = JsonDocument.Parse("""{"maxEntries":1}""");
    var result = await adapter.ExecuteAsync(
      ReadContext,
      arguments.RootElement,
      CancellationToken.None);
    var unknown = JsonNode.Parse(result.OutputJson)!.AsObject();
    unknown["commandLine"] = "secret --token";
    using var unknownDocument = JsonDocument.Parse(unknown.ToJsonString());
    Assert.False(adapter.ValidateResult(unknownDocument.RootElement).IsValid);

    var changedName = JsonNode.Parse(result.OutputJson)!.AsObject();
    changedName["processes"]![0]!["name"] = "changed.exe";
    using var changedDocument = JsonDocument.Parse(changedName.ToJsonString());
    Assert.False(adapter.ValidateResult(changedDocument.RootElement).IsValid);

    var rawPath = JsonNode.Parse(result.OutputJson)!.AsObject();
    rawPath["processes"]![0]!["name"] = @"C:\Sensitive\secret.exe";
    using var rawPathDocument = JsonDocument.Parse(rawPath.ToJsonString());
    Assert.False(adapter.ValidateResult(rawPathDocument.RootElement).IsValid);

    var falseTruncation = JsonNode.Parse(result.OutputJson)!.AsObject();
    falseTruncation["truncated"] = true;
    using var falseTruncationDocument = JsonDocument.Parse(falseTruncation.ToJsonString());
    Assert.False(adapter.ValidateResult(falseTruncationDocument.RootElement).IsValid);
  }

  [Theory]
  [InlineData("[]")]
  [InlineData("{\"processes\":[],\"totalObserved\":\"0\",\"returnedEntries\":0,\"omittedEntries\":0,\"requestedMaxEntries\":1,\"truncated\":false,\"snapshotSha256\":\"0000000000000000000000000000000000000000000000000000000000000000\"}")]
  [InlineData("{\"processes\":[{\"processId\":\"1\",\"sessionId\":0,\"name\":\"safe.exe\"}],\"totalObserved\":1,\"returnedEntries\":1,\"omittedEntries\":0,\"requestedMaxEntries\":1,\"truncated\":false,\"snapshotSha256\":\"0000000000000000000000000000000000000000000000000000000000000000\"}")]
  [InlineData("{\"processes\":[{\"processId\":1,\"sessionId\":\"0\",\"name\":\"safe.exe\"}],\"totalObserved\":1,\"returnedEntries\":1,\"omittedEntries\":0,\"requestedMaxEntries\":1,\"truncated\":false,\"snapshotSha256\":\"0000000000000000000000000000000000000000000000000000000000000000\"}")]
  [InlineData("{\"processes\":[{\"processId\":1,\"sessionId\":0,\"name\":1}],\"totalObserved\":1,\"returnedEntries\":1,\"omittedEntries\":0,\"requestedMaxEntries\":1,\"truncated\":false,\"snapshotSha256\":\"0000000000000000000000000000000000000000000000000000000000000000\"}")]
  public void ResultValidatorRejectsWrongKindsWithoutThrowing(string json)
  {
    var adapter = CreateAdapter(new FakeInventory([]));
    using var document = JsonDocument.Parse(json);

    Assert.False(adapter.ValidateResult(document.RootElement).IsValid);
  }

  [Fact]
  public void RealWindowsReaderUsesOnlyBoundedSafeSnapshotFields()
  {
    if (!OperatingSystem.IsWindows())
    {
      return;
    }

    var inventory = new WindowsSystemProcessInventory();
    var processes = inventory.Read(CancellationToken.None);

    Assert.InRange(
      processes.Count,
      1,
      WindowsSystemProcessInventory.MaximumObservedEntries);
    Assert.Equal(processes.Count, processes.Select(process => process.ProcessId).Distinct().Count());
    Assert.All(processes, process =>
    {
      Assert.True(SystemProcessInventoryRules.IsSafeName(process.Name));
      Assert.DoesNotContain('\\', process.Name);
      Assert.DoesNotContain('/', process.Name);
      Assert.DoesNotContain(':', process.Name);
    });
  }

  [Fact]
  public void RealWindowsReaderHonorsPreCancelledRequestWithoutEnumeration()
  {
    using var cancellation = new CancellationTokenSource();
    cancellation.Cancel();

    Assert.Throws<OperationCanceledException>(() =>
      new WindowsSystemProcessInventory().Read(cancellation.Token));
  }

  private static ProcessSystemInventoryReadCapabilityAdapter CreateAdapter(
    IWindowsSystemProcessInventory inventory,
    int configuredMaximum = 512) => new(
      inventory,
      Options.Create(new HostCapabilityOptions
      {
        MaximumProcessInventoryEntries = configuredMaximum,
      }),
      new FixedTimeProvider(ObservedAt));

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

  private sealed class FakeInventory(IReadOnlyList<SystemProcessSnapshot> processes) :
    IWindowsSystemProcessInventory
  {
    public int Calls { get; private set; }

    public IReadOnlyList<SystemProcessSnapshot> Read(CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      Calls++;
      return processes;
    }
  }

  private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
  {
    public override DateTimeOffset GetUtcNow() => now;
  }
}
