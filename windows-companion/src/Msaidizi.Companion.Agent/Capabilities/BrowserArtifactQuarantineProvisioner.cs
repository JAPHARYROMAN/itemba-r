using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Principal;
using Itemba.Msaidizi.Companion.Agent.Configuration;

namespace Itemba.Msaidizi.Companion.Agent.Capabilities;

/// <summary>
/// One-time per-user enrollment provisioning for the browser artifact
/// quarantine. It runs only for an enabled, enrolled device and only at the
/// fixed LocalAppData path. Runtime subsequently verifies the protected ACL on
/// every use; it never creates or relaxes the root itself.
/// </summary>
public static class BrowserArtifactQuarantineProvisioner
{
  public static bool EnsureProvisionedForEnrolledDevice(
    AgentOptions options,
    out string statusCode) => EnsureProvisionedForEnrolledDevice(
      options,
      Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
      out statusCode);

  internal static bool EnsureProvisionedForEnrolledDevice(
    AgentOptions options,
    string localAppDataRoot,
    out string statusCode)
  {
    if (!OperatingSystem.IsWindows()
      || !options.ExecutionEnabled
      || !Guid.TryParseExact(options.DeviceId, "D", out _))
    {
      statusCode = "ARTIFACT_QUARANTINE_DEVICE_NOT_ENROLLED";
      return false;
    }

    var localAppData = Path.TrimEndingDirectorySeparator(Path.GetFullPath(localAppDataRoot));
    var expected = Path.GetFullPath(Path.Combine(
      localAppData,
      "Itemba",
      "Msaidizi",
      "artifact-quarantine"));
    var configured = Path.TrimEndingDirectorySeparator(Path.GetFullPath(
      Environment.ExpandEnvironmentVariables(options.ArtifactQuarantineRoot)));
    if (!string.Equals(configured, expected, StringComparison.OrdinalIgnoreCase))
    {
      statusCode = "ARTIFACT_QUARANTINE_ROOT_NOT_CANONICAL";
      return false;
    }

    try
    {
      AssertNoExistingReparseComponents(localAppData, configured);
      Directory.CreateDirectory(configured);
      AssertNoExistingReparseComponents(localAppData, configured);

      var quarantine = new BrowserArtifactQuarantine(configured, requireHardenedAcl: true);
      if (quarantine.IsReady(out _))
      {
        statusCode = "READY";
        return true;
      }
      if (Directory.EnumerateFileSystemEntries(configured).Any())
      {
        statusCode = "ARTIFACT_QUARANTINE_UNTRUSTED_EXISTING_CONTENT";
        return false;
      }

      ApplyExactAcl(configured);
      if (!quarantine.IsReady(out statusCode)) return false;
      statusCode = "READY";
      return true;
    }
    catch
    {
      statusCode = "ARTIFACT_QUARANTINE_PROVISIONING_FAILED";
      return false;
    }
  }

  private static void AssertNoExistingReparseComponents(string anchor, string path)
  {
    if (!path.StartsWith(anchor + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
      throw new InvalidOperationException("artifact_quarantine_path_escape");
    var current = anchor;
    foreach (var component in Path.GetRelativePath(anchor, path)
      .Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
    {
      current = Path.Combine(current, component);
      if (Directory.Exists(current)
        && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
      {
        throw new InvalidOperationException("artifact_quarantine_reparse_forbidden");
      }
    }
  }

  private static void ApplyExactAcl(string path)
  {
    using var identity = WindowsIdentity.GetCurrent(TokenAccessLevels.Query);
    var currentSid = identity.User
      ?? throw new InvalidOperationException("artifact_quarantine_identity_unavailable");
    var systemSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
    var administratorsSid = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
    var inheritance = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
    var security = new DirectorySecurity();
    security.SetOwner(currentSid);
    security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
    security.AddAccessRule(new FileSystemAccessRule(
      currentSid,
      FileSystemRights.Modify | FileSystemRights.Synchronize,
      inheritance,
      PropagationFlags.None,
      AccessControlType.Allow));
    security.AddAccessRule(new FileSystemAccessRule(
      systemSid,
      FileSystemRights.FullControl,
      inheritance,
      PropagationFlags.None,
      AccessControlType.Allow));
    security.AddAccessRule(new FileSystemAccessRule(
      administratorsSid,
      FileSystemRights.FullControl,
      inheritance,
      PropagationFlags.None,
      AccessControlType.Allow));
    new DirectoryInfo(path).SetAccessControl(security);
  }
}
