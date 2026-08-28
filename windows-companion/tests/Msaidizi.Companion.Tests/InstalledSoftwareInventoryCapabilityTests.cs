using System.Text.Json;
using System.Text.Json.Nodes;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Win32;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class InstalledSoftwareInventoryCapabilityTests
{
  private static readonly DateTimeOffset ObservedAt =
    new(2026, 8, 28, 11, 45, 0, TimeSpan.Zero);
  private const string ProductCode =
    "{01234567-89AB-CDEF-0123-456789ABCDEF}";
  private static readonly string[] AllowedRegistryValueNames =
    ["DisplayName", "DisplayVersion", "Publisher"];

  [Fact]
  public void DescriptorIsExactConfidentialMandatedLocalSystemRead()
  {
    var adapter = CreateAdapter(new FakeInventory([]));
    var descriptor = adapter.Descriptor;

    Assert.Equal("software.installed.inventory.read", descriptor.Id);
    Assert.Equal("1.0.0", descriptor.Version);
    Assert.Equal("Read installed software inventory", descriptor.DisplayName);
    Assert.Contains("read-only", descriptor.Description, StringComparison.Ordinal);
    Assert.Contains("HKLM", descriptor.Description, StringComparison.Ordinal);
    Assert.Contains("no recovery", descriptor.Description, StringComparison.Ordinal);
    Assert.Equal(CapabilityDataClass.Confidential, descriptor.DataClass);
    Assert.Equal(CapabilityEffect.LocalRead, descriptor.Effect);
    Assert.Equal(ConsentRequirement.SignedMandate, descriptor.Consent);
    Assert.Equal(RecoveryKind.NotApplicable, descriptor.Recovery);
    Assert.Equal(RequiredPrivilege.LocalSystem, descriptor.RequiredPrivilege);
    Assert.Equal(IdempotencySemantics.Required, descriptor.Idempotency);
    Assert.Equal(["windows-11-x64"], descriptor.SupportedOperatingSystems);
    Assert.Equal(
      ["windows-machine-installed-software-inventory"],
      descriptor.ProvenanceOutputs);
    Assert.False(descriptor.TouchesTrustedRoot);
    Assert.False(descriptor.IsMutation);
    Assert.False(TrustedRootComponents.IsProtectedCapabilityId(descriptor.Id));

    var argumentSchema = descriptor.ArgumentsSchema;
    Assert.False(argumentSchema.GetProperty("additionalProperties").GetBoolean());
    Assert.Equal(
      ["maxEntries"],
      argumentSchema.GetProperty("required")
        .EnumerateArray()
        .Select(value => value.GetString())
        .ToArray());
    var maximum = argumentSchema.GetProperty("properties")
      .GetProperty("maxEntries");
    Assert.Equal(1, maximum.GetProperty("minimum").GetInt32());
    Assert.Equal(2_048, maximum.GetProperty("maximum").GetInt32());

    var resultSchema = descriptor.ResultSchema;
    Assert.False(resultSchema.GetProperty("additionalProperties").GetBoolean());
    var applicationSchema = resultSchema.GetProperty("properties")
      .GetProperty("applications")
      .GetProperty("items");
    Assert.False(applicationSchema.GetProperty("additionalProperties").GetBoolean());
    Assert.Equal(
      ["displayName", "displayVersion", "publisher", "productCode"],
      applicationSchema.GetProperty("properties")
        .EnumerateObject()
        .Select(property => property.Name)
        .ToArray());
    var schemaText = descriptor.ResultSchema.GetRawText();
    Assert.DoesNotContain("uninstall", schemaText, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("location", schemaText, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("url", schemaText, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("command", schemaText, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("registryPath", schemaText, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("credential", schemaText, StringComparison.OrdinalIgnoreCase);

    var registry = new CapabilityRegistry([adapter]);
    Assert.True(registry.TryResolve(descriptor.Id, descriptor.Version, out var resolved));
    Assert.Same(adapter, resolved);
  }

  [Theory]
  [InlineData("{}")]
  [InlineData("{\"maxEntries\":0}")]
  [InlineData("{\"maxEntries\":513}")]
  [InlineData("{\"maxEntries\":2049}")]
  [InlineData("{\"maxEntries\":1.5}")]
  [InlineData("{\"maxEntries\":\"1\"}")]
  [InlineData("{\"maxEntries\":true}")]
  [InlineData("{\"maxEntries\":1,\"extra\":true}")]
  [InlineData("{\"maxEntries\":1,\"maxEntries\":1}")]
  public void ArgumentsAreStrictAndDeploymentBounded(string json)
  {
    var adapter = CreateAdapter(new FakeInventory([]), maximumEntries: 512);
    using var document = JsonDocument.Parse(json);

    Assert.False(adapter.ValidateArguments(document.RootElement).IsValid);
  }

  [Fact]
  public void HardBoundaryIsAcceptedWithoutClamping()
  {
    var adapter = CreateAdapter(
      new FakeInventory([]),
      InstalledSoftwareInventoryRules.MaximumReturnedEntries);
    using var arguments = JsonDocument.Parse("""{"maxEntries":2048}""");

    Assert.True(adapter.ValidateArguments(arguments.RootElement).IsValid);
  }

  [Theory]
  [InlineData(0)]
  [InlineData(2049)]
  public void InvalidDeploymentMaximumFailsClosed(int maximumEntries)
  {
    Assert.Throws<ArgumentOutOfRangeException>(() =>
      CreateAdapter(new FakeInventory([]), maximumEntries));
  }

  [Fact]
  public async Task ReaderUsesOnlyHklmMachineViewsAndAllowlistedValues()
  {
    var backend = new TrackingRegistryBackend();
    backend.Subkeys[RegistryView.Registry64] =
      [ProductCode, "not-a-product-code"];
    backend.Subkeys[RegistryView.Registry32] = ["legacy-product"];
    backend.SetValue(
      RegistryView.Registry64,
      ProductCode,
      "DisplayName",
      "Safe Product");
    backend.SetValue(
      RegistryView.Registry64,
      ProductCode,
      "DisplayVersion",
      "2.0");
    backend.SetValue(
      RegistryView.Registry64,
      ProductCode,
      "Publisher",
      "Safe Publisher");
    backend.SetValue(
      RegistryView.Registry64,
      "not-a-product-code",
      "DisplayName",
      "No Product Code");
    backend.SetValue(
      RegistryView.Registry32,
      "legacy-product",
      "DisplayName",
      "Legacy Product");
    backend.SetSensitiveValue(
      RegistryView.Registry64,
      ProductCode,
      "UninstallString",
      "cmd /c remove --password top-secret");
    backend.SetSensitiveValue(
      RegistryView.Registry64,
      ProductCode,
      "QuietUninstallString",
      "powershell -token top-secret");
    backend.SetSensitiveValue(
      RegistryView.Registry64,
      ProductCode,
      "InstallLocation",
      @"C:\Secret\Product");
    backend.SetSensitiveValue(
      RegistryView.Registry64,
      ProductCode,
      "URLInfoAbout",
      "https://example.invalid/private");
    backend.SetSensitiveValue(
      RegistryView.Registry64,
      ProductCode,
      "Password",
      "top-secret");
    var inventory = new WindowsInstalledSoftwareInventory(
      backend,
      static () => true);
    var adapter = CreateAdapter(inventory);
    using var arguments = JsonDocument.Parse("""{"maxEntries":10}""");

    var result = await adapter.ExecuteAsync(
      ReadContext,
      arguments.RootElement,
      CancellationToken.None);

    Assert.Equal(2, backend.EnumerationCalls.Count);
    Assert.All(backend.EnumerationCalls, call =>
    {
      Assert.Equal(RegistryHive.LocalMachine, call.Hive);
      Assert.Equal(WindowsInstalledSoftwareInventory.UninstallKeyPath, call.KeyPath);
    });
    Assert.Equal(
      [RegistryView.Registry64, RegistryView.Registry32],
      backend.EnumerationCalls.Select(call => call.View).ToArray());
    Assert.All(backend.ValueReads, read =>
    {
      Assert.Equal(RegistryHive.LocalMachine, read.Hive);
      Assert.Equal(WindowsInstalledSoftwareInventory.UninstallKeyPath, read.KeyPath);
      Assert.Contains(
        read.ValueName,
        AllowedRegistryValueNames);
    });
    Assert.Equal(9, backend.ValueReads.Count);
    Assert.DoesNotContain(
      backend.ValueReads,
      read => backend.SensitiveValueNames.Contains(read.ValueName));

    using var output = JsonDocument.Parse(result.OutputJson);
    Assert.True(adapter.ValidateResult(output.RootElement).IsValid);
    var applications = output.RootElement.GetProperty("applications")
      .EnumerateArray()
      .ToArray();
    Assert.Equal(3, applications.Length);
    var product = Assert.Single(applications, application =>
      application.GetProperty("displayName").GetString() == "Safe Product");
    Assert.Equal(ProductCode, product.GetProperty("productCode").GetString());
    var noProductCode = Assert.Single(applications, application =>
      application.GetProperty("displayName").GetString() == "No Product Code");
    Assert.False(noProductCode.TryGetProperty("productCode", out _));
    Assert.DoesNotContain("top-secret", result.OutputJson, StringComparison.Ordinal);
    Assert.DoesNotContain("UninstallString", result.OutputJson, StringComparison.Ordinal);
    Assert.DoesNotContain("InstallLocation", result.OutputJson, StringComparison.Ordinal);
    Assert.DoesNotContain("URLInfoAbout", result.OutputJson, StringComparison.Ordinal);
    Assert.DoesNotContain("cmd /c", result.OutputJson, StringComparison.Ordinal);
    Assert.DoesNotContain(@"C:\Secret", result.OutputJson, StringComparison.Ordinal);
    Assert.DoesNotContain("not-a-product-code", result.OutputJson, StringComparison.Ordinal);
    Assert.DoesNotContain("legacy-product", result.OutputJson, StringComparison.Ordinal);
  }

  [Fact]
  public async Task ReadNormalizesDeduplicatesSortsTruncatesAndBindsFullInventory()
  {
    var raw = new InstalledSoftwareRegistryEntry[]
    {
      new("zulu", "  Zulu   Tool ", null, "  Zed   Corp  "),
      new(ProductCode.ToLowerInvariant(), " Alpha   Suite ", " 1.0 ", " Acme "),
      new(ProductCode, "Alpha Suite", "1.0", "Acme"),
      new("hidden", null, "should-not-appear", "Hidden Publisher"),
    };
    var inventory = new FakeInventory(raw);
    var adapter = CreateAdapter(inventory, maximumEntries: 1);
    using var arguments = JsonDocument.Parse("""{"maxEntries":1}""");

    var result = await adapter.ExecuteAsync(
      ReadContext,
      arguments.RootElement,
      CancellationToken.None);

    Assert.False(result.MutationCommitted);
    Assert.False(result.OutcomeUncertain);
    Assert.Null(result.OpaqueRecoveryHandle);
    Assert.Null(result.RecoveryProvenanceSha256);
    Assert.Equal(0, result.LocalBytesWritten);
    Assert.Equal(0, result.ExternalEgressBytes);
    Assert.Equal(1, inventory.Calls);
    using var output = JsonDocument.Parse(result.OutputJson);
    Assert.True(adapter.ValidateResult(output.RootElement).IsValid);
    Assert.Equal(2, output.RootElement.GetProperty("totalObserved").GetInt32());
    Assert.Equal(1, output.RootElement.GetProperty("returnedEntries").GetInt32());
    Assert.Equal(1, output.RootElement.GetProperty("omittedEntries").GetInt32());
    Assert.Equal(1, output.RootElement.GetProperty("requestedMaxEntries").GetInt32());
    Assert.True(output.RootElement.GetProperty("truncated").GetBoolean());
    var application = Assert.Single(
      output.RootElement.GetProperty("applications").EnumerateArray());
    Assert.Equal("Alpha Suite", application.GetProperty("displayName").GetString());
    Assert.Equal("1.0", application.GetProperty("displayVersion").GetString());
    Assert.Equal("Acme", application.GetProperty("publisher").GetString());
    Assert.Equal(ProductCode, application.GetProperty("productCode").GetString());

    var expectedFull = new InstalledSoftwareInventoryEntry[]
    {
      new("Alpha Suite", "1.0", "Acme", ProductCode),
      new("Zulu Tool", null, "Zed Corp", null),
    };
    var fullDigest = InstalledSoftwareInventoryRules.FullSnapshotSha256(expectedFull);
    Assert.Equal(fullDigest, output.RootElement.GetProperty("inventorySha256").GetString());
    Assert.Equal(fullDigest, result.PreStateSha256);
    Assert.Equal(
      InstalledSoftwareInventoryRules.RawObservationCanonicalByteCount(raw),
      result.LocalBytesRead);
    var provenance = Assert.Single(result.Provenance);
    Assert.Equal(
      "windows-machine-installed-software-inventory",
      provenance.SourceType);
    Assert.Equal(
      InstalledSoftwareInventoryRules.DeviceSourceIdentifierSha256(
        ReadContext.DeviceId),
      provenance.SourceIdentifierHash);
    Assert.Equal(fullDigest, provenance.ContentSha256);
    Assert.Equal(ProvenanceTrust.UntrustedContent, provenance.Trust);
    Assert.Equal(ObservedAt, provenance.ObservedAt);
  }

  [Fact]
  public async Task FilteredAndExactDuplicateRawRowsRemainByteAccounted()
  {
    var publishable = new InstalledSoftwareRegistryEntry(
      ProductCode,
      "Alpha",
      "1",
      "Publisher");
    var baselineRaw = new InstalledSoftwareRegistryEntry[] { publishable };
    var expandedRaw = new InstalledSoftwareRegistryEntry[]
    {
      publishable,
      publishable,
      new("blank-display-name", "   ", "filtered-version", "filtered-publisher"),
    };
    var baseline = CreateAdapter(new FakeInventory(baselineRaw));
    var expanded = CreateAdapter(new FakeInventory(expandedRaw));
    using var arguments = JsonDocument.Parse("""{"maxEntries":10}""");

    var baselineResult = await baseline.ExecuteAsync(
      ReadContext,
      arguments.RootElement,
      CancellationToken.None);
    var expandedResult = await expanded.ExecuteAsync(
      ReadContext,
      arguments.RootElement,
      CancellationToken.None);
    using var baselineOutput = JsonDocument.Parse(baselineResult.OutputJson);
    using var expandedOutput = JsonDocument.Parse(expandedResult.OutputJson);

    Assert.Equal(
      baselineOutput.RootElement.GetProperty("applications").GetRawText(),
      expandedOutput.RootElement.GetProperty("applications").GetRawText());
    Assert.Equal(baselineResult.PreStateSha256, expandedResult.PreStateSha256);
    Assert.Equal(
      InstalledSoftwareInventoryRules.RawObservationCanonicalByteCount(baselineRaw),
      baselineResult.LocalBytesRead);
    Assert.Equal(
      InstalledSoftwareInventoryRules.RawObservationCanonicalByteCount(expandedRaw),
      expandedResult.LocalBytesRead);
    Assert.True(expandedResult.LocalBytesRead > baselineResult.LocalBytesRead);
  }

  [Fact]
  public async Task ConflictingMetadataForOneProductCodeFailsClosed()
  {
    var adapter = CreateAdapter(new FakeInventory(
    [
      new InstalledSoftwareRegistryEntry(ProductCode, "Alpha", "1", "Publisher"),
      new InstalledSoftwareRegistryEntry(
        ProductCode.ToLowerInvariant(),
        "Alpha",
        "2",
        "Publisher"),
    ]));
    using var arguments = JsonDocument.Parse("""{"maxEntries":10}""");

    var error = await Assert.ThrowsAsync<HostPreconditionException>(() =>
      adapter.ExecuteAsync(
        ReadContext,
        arguments.RootElement,
        CancellationToken.None).AsTask());

    Assert.Equal("software_inventory_snapshot_invalid", error.ErrorCode);
  }

  [Theory]
  [InlineData("displayName", @"C:\Sensitive\application.exe")]
  [InlineData("displayVersion", @"\\server\private\application.exe")]
  [InlineData("publisher", @"\\?\C:\Sensitive\application.exe")]
  [InlineData("displayName", @"\\.\GLOBALROOT\Device\HarddiskVolumeShadowCopy1")]
  [InlineData("displayVersion", "https://example.invalid/private")]
  [InlineData("publisher", "http://example.invalid/private")]
  [InlineData("displayName", "file:///C:/Sensitive/application.exe")]
  [InlineData("publisher", @"HKLM\Software\Sensitive")]
  public async Task AbsolutePathUriAndRegistryPathMetadataFailsClosed(
    string property,
    string value)
  {
    var displayName = property == "displayName" ? value : "Safe Product";
    var displayVersion = property == "displayVersion" ? value : "1";
    var publisher = property == "publisher" ? value : "Safe Publisher";
    var adapter = CreateAdapter(new FakeInventory(
    [
      new InstalledSoftwareRegistryEntry(
        "malicious",
        displayName,
        displayVersion,
        publisher),
    ]));
    using var arguments = JsonDocument.Parse("""{"maxEntries":1}""");

    var error = await Assert.ThrowsAsync<HostPreconditionException>(() =>
      adapter.ExecuteAsync(
        ReadContext,
        arguments.RootElement,
        CancellationToken.None).AsTask());

    Assert.Equal("software_inventory_snapshot_invalid", error.ErrorCode);
    Assert.DoesNotContain(value, error.ToString(), StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("C++ Redistributable")]
  [InlineData("Node.js 22 / x64")]
  [InlineData("PowerShell 7")]
  [InlineData("HTTPS Toolkit")]
  [InlineData("Version 1/2")]
  public async Task OrdinaryProductMetadataIsNotOverRejected(string displayName)
  {
    var adapter = CreateAdapter(new FakeInventory(
    [
      new InstalledSoftwareRegistryEntry("ordinary", displayName, "1/2", "A/B Labs"),
    ]));
    using var arguments = JsonDocument.Parse("""{"maxEntries":1}""");

    var result = await adapter.ExecuteAsync(
      ReadContext,
      arguments.RootElement,
      CancellationToken.None);

    using var output = JsonDocument.Parse(result.OutputJson);
    Assert.True(adapter.ValidateResult(output.RootElement).IsValid);
    Assert.Equal(
      displayName,
      Assert.Single(output.RootElement.GetProperty("applications").EnumerateArray())
        .GetProperty("displayName")
        .GetString());
  }

  [Fact]
  public async Task SnapshotAndReturnedSliceAreStableAcrossSourceOrder()
  {
    var alpha = new InstalledSoftwareRegistryEntry(
      "alpha",
      "Alpha",
      "1",
      "Publisher A");
    var beta = new InstalledSoftwareRegistryEntry(
      "beta",
      "Beta",
      "2",
      "Publisher B");
    var first = CreateAdapter(new FakeInventory([beta, alpha]));
    var second = CreateAdapter(new FakeInventory([alpha, beta]));
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
    Assert.Equal(firstResult.LocalBytesRead, secondResult.LocalBytesRead);
  }

  [Fact]
  public async Task OmittedEntryChangesFullDigestAndCanonicalReadChargeOnly()
  {
    var returned = new InstalledSoftwareRegistryEntry(
      "returned",
      "Alpha",
      "1",
      "Publisher");
    var first = CreateAdapter(new FakeInventory(
    [
      returned,
      new InstalledSoftwareRegistryEntry("omitted-a", "Beta", null, null),
    ]));
    var second = CreateAdapter(new FakeInventory(
    [
      returned,
      new InstalledSoftwareRegistryEntry(
        "omitted-b",
        "Beta With A Much Longer Name",
        null,
        null),
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
    using var firstOutput = JsonDocument.Parse(firstResult.OutputJson);
    using var secondOutput = JsonDocument.Parse(secondResult.OutputJson);

    Assert.Equal(
      firstOutput.RootElement.GetProperty("applications").GetRawText(),
      secondOutput.RootElement.GetProperty("applications").GetRawText());
    Assert.Equal(
      firstOutput.RootElement.GetProperty("returnedEntriesSha256").GetString(),
      secondOutput.RootElement.GetProperty("returnedEntriesSha256").GetString());
    Assert.NotEqual(
      firstOutput.RootElement.GetProperty("inventorySha256").GetString(),
      secondOutput.RootElement.GetProperty("inventorySha256").GetString());
    Assert.NotEqual(firstResult.PreStateSha256, secondResult.PreStateSha256);
    Assert.NotEqual(firstResult.LocalBytesRead, secondResult.LocalBytesRead);
    Assert.NotEqual(
      Assert.Single(firstResult.Provenance).ContentSha256,
      Assert.Single(secondResult.Provenance).ContentSha256);
  }

  [Fact]
  public async Task ResultValidationRejectsForgedSlicesDigestsAndSensitiveFields()
  {
    var adapter = CreateAdapter(new FakeInventory(
    [
      new InstalledSoftwareRegistryEntry("alpha", "Alpha", "1", "Publisher"),
    ]));
    using var arguments = JsonDocument.Parse("""{"maxEntries":1}""");
    var result = await adapter.ExecuteAsync(
      ReadContext,
      arguments.RootElement,
      CancellationToken.None);

    var changedEntry = JsonNode.Parse(result.OutputJson)!.AsObject();
    changedEntry["applications"]![0]!["displayName"] = "Forged";
    AssertInvalidResult(adapter, changedEntry);

    var forgedSliceDigest = JsonNode.Parse(result.OutputJson)!.AsObject();
    forgedSliceDigest["returnedEntriesSha256"] = new string('0', 64);
    AssertInvalidResult(adapter, forgedSliceDigest);

    var malformedFullDigest = JsonNode.Parse(result.OutputJson)!.AsObject();
    malformedFullDigest["inventorySha256"] = "not-a-digest";
    AssertInvalidResult(adapter, malformedFullDigest);

    var sensitiveField = JsonNode.Parse(result.OutputJson)!.AsObject();
    sensitiveField["applications"]![0]!["uninstallString"] =
      "cmd /c remove --token secret";
    AssertInvalidResult(adapter, sensitiveField);

    var unknownTopLevel = JsonNode.Parse(result.OutputJson)!.AsObject();
    unknownTopLevel["registryPath"] = @"HKLM\Sensitive";
    AssertInvalidResult(adapter, unknownTopLevel);
  }

  [Theory]
  [InlineData("[]")]
  [InlineData("{}")]
  [InlineData("{\"applications\":\"wrong\",\"totalObserved\":0,\"returnedEntries\":0,\"omittedEntries\":0,\"requestedMaxEntries\":1,\"truncated\":false,\"inventorySha256\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"returnedEntriesSha256\":\"0000000000000000000000000000000000000000000000000000000000000000\"}")]
  [InlineData("{\"applications\":[{\"displayName\":null}],\"totalObserved\":1,\"returnedEntries\":1,\"omittedEntries\":0,\"requestedMaxEntries\":1,\"truncated\":false,\"inventorySha256\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"returnedEntriesSha256\":\"0000000000000000000000000000000000000000000000000000000000000000\"}")]
  public void ResultValidationRejectsWrongKindsWithoutThrowing(string json)
  {
    var adapter = CreateAdapter(new FakeInventory([]));
    using var document = JsonDocument.Parse(json);

    Assert.False(adapter.ValidateResult(document.RootElement).IsValid);
  }

  [Fact]
  public void NonWindowsProviderFailsBeforeRegistryEnumeration()
  {
    var backend = new TrackingRegistryBackend();
    var inventory = new WindowsInstalledSoftwareInventory(
      backend,
      static () => false);

    var error = Assert.Throws<HostPreconditionException>(() =>
      inventory.Read(CancellationToken.None));

    Assert.Equal("software_inventory_windows_required", error.ErrorCode);
    Assert.Empty(backend.EnumerationCalls);
    Assert.Empty(backend.ValueReads);
  }

  [Fact]
  public void RegistryFailureIsSanitizedAndFailsClosed()
  {
    var backend = new TrackingRegistryBackend
    {
      EnumerationFailure = new InvalidOperationException(
        @"failed C:\Secret\registry --password top-secret"),
    };
    var inventory = new WindowsInstalledSoftwareInventory(
      backend,
      static () => true);

    var error = Assert.Throws<HostPreconditionException>(() =>
      inventory.Read(CancellationToken.None));

    Assert.Equal("software_inventory_registry_unavailable", error.ErrorCode);
    Assert.Null(error.InnerException);
    Assert.DoesNotContain("Secret", error.ToString(), StringComparison.Ordinal);
    Assert.Empty(backend.ValueReads);
  }

  [Fact]
  public async Task ProviderFailureIsSanitizedAndProducesNoResult()
  {
    var inventory = new ThrowingInventory(
      new InvalidOperationException(@"C:\Secret\token=top-secret"));
    var adapter = CreateAdapter(inventory);
    using var arguments = JsonDocument.Parse("""{"maxEntries":1}""");

    var error = await Assert.ThrowsAsync<HostPreconditionException>(() =>
      adapter.ExecuteAsync(
        ReadContext,
        arguments.RootElement,
        CancellationToken.None).AsTask());

    Assert.Equal("software_inventory_provider_failed", error.ErrorCode);
    Assert.Null(error.InnerException);
    Assert.DoesNotContain("top-secret", error.ToString(), StringComparison.Ordinal);
  }

  [Fact]
  public async Task CancellationFailsBeforeOrDuringEnumerationWithoutAResult()
  {
    var neverCalled = new FakeInventory([]);
    var adapter = CreateAdapter(neverCalled);
    using var arguments = JsonDocument.Parse("""{"maxEntries":1}""");
    using var preCancelled = new CancellationTokenSource();
    preCancelled.Cancel();

    await Assert.ThrowsAsync<OperationCanceledException>(() =>
      adapter.ExecuteAsync(
        ReadContext,
        arguments.RootElement,
        preCancelled.Token).AsTask());
    Assert.Equal(0, neverCalled.Calls);

    using var midCancellation = new CancellationTokenSource();
    var backend = new TrackingRegistryBackend
    {
      AfterEnumeration = midCancellation.Cancel,
    };
    backend.Subkeys[RegistryView.Registry64] = ["alpha"];
    var provider = new WindowsInstalledSoftwareInventory(
      backend,
      static () => true);
    Assert.Throws<OperationCanceledException>(() =>
      provider.Read(midCancellation.Token));
    Assert.Single(backend.EnumerationCalls);
    Assert.Empty(backend.ValueReads);
  }

  private static InstalledSoftwareInventoryReadCapabilityAdapter CreateAdapter(
    IInstalledSoftwareInventory inventory,
    int maximumEntries = 512) => new(
      inventory,
      maximumEntries,
      new FixedTimeProvider(ObservedAt));

  private static void AssertInvalidResult(
    InstalledSoftwareInventoryReadCapabilityAdapter adapter,
    JsonNode value)
  {
    using var document = JsonDocument.Parse(value.ToJsonString());
    Assert.False(adapter.ValidateResult(document.RootElement).IsValid);
  }

  private static readonly ActionExecutionContext ReadContext = new(
    "action",
    "task",
    "plan",
    "step",
    "device-77",
    "mandate",
    "idempotency",
    null,
    null,
    new ActionBudget(60, 10, 10, 0, 1_048_576, 1_048_576, 1));

  private sealed class FakeInventory(
    IReadOnlyList<InstalledSoftwareRegistryEntry> entries) :
    IInstalledSoftwareInventory
  {
    public int Calls { get; private set; }

    public IReadOnlyList<InstalledSoftwareRegistryEntry> Read(
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      Calls++;
      return entries;
    }
  }

  private sealed class ThrowingInventory(Exception exception) :
    IInstalledSoftwareInventory
  {
    public IReadOnlyList<InstalledSoftwareRegistryEntry> Read(
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      throw exception;
    }
  }

  private sealed class TrackingRegistryBackend : IMachineSoftwareRegistryBackend
  {
    private readonly Dictionary<(RegistryView View, string Subkey, string Name), string?>
      _values = [];
    private readonly Dictionary<(RegistryView View, string Subkey, string Name), string?>
      _sensitiveValues = [];

    public Dictionary<RegistryView, IReadOnlyList<string>> Subkeys { get; } = [];

    public List<RegistryEnumerationCall> EnumerationCalls { get; } = [];

    public List<RegistryValueRead> ValueReads { get; } = [];

    public HashSet<string> SensitiveValueNames { get; } = new(StringComparer.Ordinal);

    public Exception? EnumerationFailure { get; init; }

    public Action? AfterEnumeration { get; init; }

    public IReadOnlyList<string> GetSubKeyNames(
      RegistryHive hive,
      RegistryView view,
      string keyPath)
    {
      EnumerationCalls.Add(new RegistryEnumerationCall(hive, view, keyPath));
      if (EnumerationFailure is not null)
      {
        throw EnumerationFailure;
      }
      AfterEnumeration?.Invoke();
      return Subkeys.TryGetValue(view, out var names) ? names : [];
    }

    public string? ReadStringValue(
      RegistryHive hive,
      RegistryView view,
      string keyPath,
      string subkeyName,
      string valueName)
    {
      ValueReads.Add(new RegistryValueRead(
        hive,
        view,
        keyPath,
        subkeyName,
        valueName));
      return _values.TryGetValue((view, subkeyName, valueName), out var value)
        ? value
        : null;
    }

    public void SetValue(
      RegistryView view,
      string subkey,
      string name,
      string value) => _values[(view, subkey, name)] = value;

    public void SetSensitiveValue(
      RegistryView view,
      string subkey,
      string name,
      string value)
    {
      _sensitiveValues[(view, subkey, name)] = value;
      SensitiveValueNames.Add(name);
    }
  }

  private sealed record RegistryEnumerationCall(
    RegistryHive Hive,
    RegistryView View,
    string KeyPath);

  private sealed record RegistryValueRead(
    RegistryHive Hive,
    RegistryView View,
    string KeyPath,
    string SubkeyName,
    string ValueName);

  private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
  {
    public override DateTimeOffset GetUtcNow() => now;
  }
}
