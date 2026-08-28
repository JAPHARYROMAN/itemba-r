using System.Collections.Frozen;

namespace Itemba.Msaidizi.Companion.Contracts.Security;

public static class TrustedRootComponents
{
  public const string DeviceIdentity = "device-identity";
  public const string KillSwitch = "kill-switch";
  public const string AuditSigner = "audit-signer";
  public const string RecoveryVault = "recovery-vault";
  public const string BootstrapVerifier = "bootstrap-verifier";
  public const string UpdateVerifier = "update-verifier";

  public static IReadOnlySet<string> All { get; } = new[]
  {
    DeviceIdentity,
    KillSwitch,
    AuditSigner,
    RecoveryVault,
    BootstrapVerifier,
    UpdateVerifier,
  }.ToFrozenSet(StringComparer.Ordinal);

  /// <summary>
  /// Exact capability namespace roots reserved for the trusted supervisor.
  /// This includes the canonical component IDs plus intentionally broader
  /// namespaces that cover bootstrap and supervisor implementation surfaces.
  /// </summary>
  public static IReadOnlySet<string> CapabilityNamespaceIds { get; } = All
    .Concat(["supervisor", "trusted-root", "bootstrap"])
    .ToFrozenSet(StringComparer.Ordinal);

  public static IReadOnlySet<string> CapabilityNamespacePrefixes { get; } =
    CapabilityNamespaceIds
      .Select(identifier => $"{identifier}.")
      .ToFrozenSet(StringComparer.Ordinal);

  /// <summary>
  /// Returns true for an exact trusted-root namespace ID or any capability
  /// nested below one. Manifest construction and execution-time policy must
  /// both use this predicate so their protected surfaces cannot drift.
  /// </summary>
  public static bool IsProtectedCapabilityId(string capabilityId) =>
    CapabilityNamespaceIds.Contains(capabilityId)
    || CapabilityNamespacePrefixes.Any(prefix =>
      capabilityId.StartsWith(prefix, StringComparison.Ordinal));
}

public interface IDeviceIdentityProvider
{
  string DeviceId { get; }

  string DeviceCertificateThumbprint { get; }

  bool IsHardwareBacked { get; }
}
