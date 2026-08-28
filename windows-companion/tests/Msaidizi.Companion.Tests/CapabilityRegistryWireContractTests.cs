using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class CapabilityRegistryWireContractTests
{
  private static readonly JsonElement StrictSchema = JsonSerializer.Deserialize<JsonElement>(
    """{"type":"object","properties":{},"additionalProperties":false}""");

  public static IEnumerable<object[]> InvalidDescriptors()
  {
    yield return [ValidDescriptor() with { Id = "unsafe identifier" }];
    yield return [ValidDescriptor() with { Version = new string('v', 129) }];
    yield return [ValidDescriptor() with { DisplayName = new string('d', 161) }];
    yield return [ValidDescriptor() with { Description = new string('d', 1_001) }];
    yield return [ValidDescriptor() with
    {
      SupportedOperatingSystems = Enumerable.Range(0, 21).Select(index => $"windows-{index}").ToArray(),
    }];
    yield return [ValidDescriptor() with
    {
      ProvenanceOutputs = Enumerable.Range(0, 101).Select(index => $"output-{index}").ToArray(),
    }];
    yield return [ValidDescriptor() with { TouchesTrustedRoot = true }];
    yield return [ValidDescriptor() with { Id = "supervisor.test" }];
    yield return [ValidDescriptor() with { Id = "powershell.execute" }];
    yield return [ValidDescriptor() with { Id = "audio.microphone.capture" }];
    yield return [ValidDescriptor() with
    {
      Id = HostCredentialEphemeralityPolicy.LegacyFileReadCapabilityId,
      Version = HostCredentialEphemeralityPolicy.LegacyFileReadCapabilityVersion,
    }];
    yield return [ValidDescriptor() with
    {
      Id = HostCredentialEphemeralityPolicy.EphemeralFileDisclosureCapabilityId,
      Version = HostCredentialEphemeralityPolicy.EphemeralFileDisclosureCapabilityVersion,
    }];
  }

  [Theory]
  [MemberData(nameof(InvalidDescriptors))]
  public void RegistryRejectsDescriptorsTheBrokerCannotEnroll(CapabilityDescriptor descriptor)
  {
    Assert.Throws<InvalidOperationException>(() =>
      new CapabilityRegistry([new StubAdapter(descriptor)]));
  }

  public static IEnumerable<object[]> ProtectedCapabilityIds() =>
    TrustedRootComponents.CapabilityNamespaceIds
      .Concat(TrustedRootComponents.CapabilityNamespacePrefixes.Select(prefix => $"{prefix}test"))
      .Distinct(StringComparer.Ordinal)
      .Order(StringComparer.Ordinal)
      .Select(identifier => new object[] { identifier });

  [Theory]
  [MemberData(nameof(ProtectedCapabilityIds))]
  public void RegistryRejectsEveryTrustedRootIdAndNamespacePrefix(string capabilityId)
  {
    Assert.Throws<InvalidOperationException>(() =>
      new CapabilityRegistry([new StubAdapter(ValidDescriptor() with { Id = capabilityId })]));
  }

  [Fact]
  public void EveryCanonicalTrustedRootComponentOwnsAProtectedCapabilityNamespace()
  {
    Assert.Contains(TrustedRootComponents.KillSwitch, TrustedRootComponents.All);
    Assert.Contains(TrustedRootComponents.UpdateVerifier, TrustedRootComponents.All);
    Assert.All(
      TrustedRootComponents.All,
      identifier =>
      {
        Assert.Contains(identifier, TrustedRootComponents.CapabilityNamespaceIds);
        Assert.Contains(
          $"{identifier}.",
          TrustedRootComponents.CapabilityNamespacePrefixes);
        Assert.True(TrustedRootComponents.IsProtectedCapabilityId(identifier));
        Assert.True(TrustedRootComponents.IsProtectedCapabilityId($"{identifier}.test"));
      });
  }

  [Fact]
  public void RegistryAcceptsBrokerBoundaryValues()
  {
    var descriptor = ValidDescriptor() with
    {
      Id = $"a{new string('-', 127)}",
      Version = $"v{new string('.', 127)}",
      DisplayName = new string('d', 160),
      Description = new string('d', 1_000),
      SupportedOperatingSystems = Enumerable.Range(0, 20)
        .Select(index => $"windows-{index}")
        .ToArray(),
      ProvenanceOutputs = Enumerable.Range(0, 100)
        .Select(index => $"output-{index}")
        .ToArray(),
    };

    var registry = new CapabilityRegistry([new StubAdapter(descriptor)]);

    Assert.Equal(descriptor, Assert.Single(registry.Descriptors));
  }

  [Fact]
  public void RegistryRejectsManifestLargerThanBrokerArrayLimit()
  {
    var adapters = Enumerable.Range(0, 501)
      .Select(index => new StubAdapter(ValidDescriptor() with
      {
        Id = $"example.capability.{index:D3}",
      }))
      .ToArray();

    Assert.Throws<InvalidOperationException>(() => new CapabilityRegistry(adapters));
  }

  [Theory]
  [InlineData(
    HostCredentialEphemeralityPolicy.LegacyFileReadCapabilityId,
    HostCredentialEphemeralityPolicy.LegacyFileReadCapabilityVersion)]
  [InlineData(
    HostCredentialEphemeralityPolicy.EphemeralFileDisclosureCapabilityId,
    HostCredentialEphemeralityPolicy.EphemeralFileDisclosureCapabilityVersion)]
  public void ForgedFileContentTokenCannotResolveAgainstPublishedCapabilities(
    string capabilityId,
    string capabilityVersion)
  {
    var registry = new CapabilityRegistry([new StubAdapter(ValidDescriptor())]);

    var resolved = registry.TryResolve(
      capabilityId,
      capabilityVersion,
      out var adapter);

    Assert.False(resolved);
    Assert.Null(adapter);
    Assert.DoesNotContain(
      registry.Descriptors,
      descriptor => string.Equals(
        descriptor.Id,
        capabilityId,
        StringComparison.Ordinal));
  }

  [Theory]
  [InlineData(
    HostCredentialEphemeralityPolicy.LegacyFileReadCapabilityId,
    HostCredentialEphemeralityPolicy.LegacyFileReadCapabilityVersion)]
  [InlineData(
    HostCredentialEphemeralityPolicy.EphemeralFileDisclosureCapabilityId,
    HostCredentialEphemeralityPolicy.EphemeralFileDisclosureCapabilityVersion)]
  public void FileContentManifestRefusalUsesTheStableCrossBoundaryReason(
    string capabilityId,
    string capabilityVersion)
  {
    var error = Assert.Throws<InvalidOperationException>(() =>
      new CapabilityRegistry([new StubAdapter(ValidDescriptor() with
      {
        Id = capabilityId,
        Version = capabilityVersion,
      })]));

    Assert.Equal(HostCredentialEphemeralityPolicy.ErrorCode, error.Message);
  }

  private static CapabilityDescriptor ValidDescriptor() => new(
    Id: "example.capability",
    Version: "1.0.0",
    DisplayName: "Example capability",
    Description: "A test-only capability.",
    DataClass: CapabilityDataClass.Internal,
    Effect: CapabilityEffect.Observe,
    Consent: ConsentRequirement.None,
    Recovery: RecoveryKind.NotApplicable,
    RequiredPrivilege: RequiredPrivilege.StandardUser,
    Idempotency: IdempotencySemantics.NotApplicable,
    SupportedOperatingSystems: ["windows-11-x64"],
    ArgumentsSchema: StrictSchema,
    ResultSchema: StrictSchema,
    ProvenanceOutputs: ["example-output"]);

  private sealed class StubAdapter(CapabilityDescriptor descriptor) : IHostCapabilityAdapter
  {
    public CapabilityDescriptor Descriptor { get; } = descriptor;

    public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
      CapabilityArgumentValidation.Success;

    public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
      CapabilityArgumentValidation.Success;

    public ValueTask<CapabilityExecutionResult> ExecuteAsync(
      ActionExecutionContext context,
      JsonElement arguments,
      CancellationToken cancellationToken) =>
      ValueTask.FromResult(new CapabilityExecutionResult("{}", false, false, []));
  }
}
