using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class TrustedRootGuardTests : IDisposable
{
  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"msaidizi-trusted-root-tests-{Guid.NewGuid():N}");

  [Fact]
  public void KillSwitchAndTrustedRootDescriptorsAreDeniedIndependently()
  {
    Directory.CreateDirectory(_directory);
    var killSwitch = Path.Combine(_directory, "DISABLED");
    File.WriteAllText(killSwitch, "operator stop");
    var guard = new TrustedRootGuard(Options.Create(new CompanionOptions
    {
      KillSwitchPath = killSwitch,
    }));
    var descriptor = CreateDescriptor("files.read", touchesTrustedRoot: true);

    Assert.True(guard.IsKillSwitchEngaged);
    Assert.Equal("trusted_root_access_forbidden", guard.Validate(descriptor));
    Assert.Equal(
      "trusted_root_namespace_forbidden",
      guard.Validate(CreateDescriptor("supervisor.settings.read", touchesTrustedRoot: false)));
    Assert.Equal(
      "trusted_root_namespace_forbidden",
      guard.Validate(CreateDescriptor("kill-switch.status", touchesTrustedRoot: false)));
    Assert.Equal(
      "trusted_root_namespace_forbidden",
      guard.Validate(CreateDescriptor("update-verifier.keys.rotate", touchesTrustedRoot: false)));
  }

  public static IEnumerable<object[]> ProtectedCapabilityIds() =>
    TrustedRootComponents.CapabilityNamespaceIds
      .Concat(TrustedRootComponents.CapabilityNamespacePrefixes.Select(prefix => $"{prefix}test"))
      .Distinct(StringComparer.Ordinal)
      .Order(StringComparer.Ordinal)
      .Select(identifier => new object[] { identifier });

  [Theory]
  [MemberData(nameof(ProtectedCapabilityIds))]
  public void GuardRejectsEveryTrustedRootIdAndNamespacePrefix(string capabilityId)
  {
    var guard = new TrustedRootGuard(Options.Create(new CompanionOptions
    {
      KillSwitchPath = Path.Combine(_directory, "DISABLED"),
    }));

    Assert.Equal(
      "trusted_root_namespace_forbidden",
      guard.Validate(CreateDescriptor(capabilityId, touchesTrustedRoot: false)));
  }

  public void Dispose()
  {
    if (Directory.Exists(_directory))
    {
      Directory.Delete(_directory, recursive: true);
    }
  }

  private static CapabilityDescriptor CreateDescriptor(string id, bool touchesTrustedRoot)
  {
    using var document = JsonDocument.Parse(
      "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}");
    var schema = document.RootElement.Clone();
    return new CapabilityDescriptor(
      id,
      "1.0.0",
      id,
      "Test descriptor",
      CapabilityDataClass.Internal,
      CapabilityEffect.LocalRead,
      ConsentRequirement.SignedMandate,
      RecoveryKind.NotApplicable,
      RequiredPrivilege.StandardUser,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      schema,
      schema,
      ["test"],
      touchesTrustedRoot);
  }
}
