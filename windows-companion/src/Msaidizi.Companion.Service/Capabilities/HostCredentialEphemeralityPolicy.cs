using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

/// <summary>
/// Fail-closed inventory for host capabilities whose normal action-result
/// lifecycle would durably cache credential-bearing bytes. File content may be
/// reintroduced only through a separately signed, one-shot ephemeral protocol.
/// </summary>
public static class HostCredentialEphemeralityPolicy
{
  public const string LegacyFileReadCapabilityId = "filesystem.file.read";
  public const string LegacyFileReadCapabilityVersion = "1.0.0";
  public const string EphemeralFileDisclosureCapabilityId =
    EphemeralFileDisclosureContract.CapabilityId;
  public const string EphemeralFileDisclosureCapabilityVersion =
    EphemeralFileDisclosureContract.CapabilityVersion;
  public const string ErrorCode = "REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY";

  public static bool IsForbiddenFileContentCapability(string? capabilityId) =>
    string.Equals(
      capabilityId,
      LegacyFileReadCapabilityId,
      StringComparison.Ordinal)
    || string.Equals(
      capabilityId,
      EphemeralFileDisclosureCapabilityId,
      StringComparison.Ordinal);
}
