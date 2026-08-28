using System.Security;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Supervision;

/// <summary>
/// Reads the out-of-bound supervisor kill switch fail-closed. A missing marker
/// is the only affirmative safe state; an unreadable or indeterminate path is
/// treated as engaged.
///
/// "Missing" is only trustworthy if the directory it was looked for in is
/// itself trustworthy, so the whole ancestor chain is checked for reparse
/// points before an absent marker is believed. Checking only the immediate
/// parent would let a redirect planted higher up hide the marker. This mirrors
/// <c>EgressTrustedKillSwitch</c>; the two implement the same primitive and are
/// deliberately kept identical in rigour.
/// </summary>
internal static class TrustedKillSwitch
{
  public static bool IsEngaged(string? path)
  {
    // A relative path would resolve against the process working directory,
    // which is not a trusted input for a boundary decision.
    if (string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path))
    {
      return true;
    }

    try
    {
      if (!MarkerRootIsTrustworthy(path))
      {
        return true;
      }
      _ = File.GetAttributes(path);
      return true;
    }
    catch (FileNotFoundException)
    {
      return !MarkerRootIsTrustworthy(path);
    }
    catch (DirectoryNotFoundException)
    {
      return true;
    }
    catch (Exception exception) when (exception is IOException
      or UnauthorizedAccessException
      or ArgumentException
      or NotSupportedException
      or PathTooLongException
      or SecurityException)
    {
      return true;
    }
  }

  private static bool MarkerRootIsTrustworthy(string path)
  {
    var fullPath = Path.GetFullPath(path);
    var root = Path.GetDirectoryName(fullPath);
    if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
    {
      return false;
    }

    for (var current = new DirectoryInfo(root); current is not null; current = current.Parent)
    {
      var attributes = current.Attributes;
      if ((attributes & FileAttributes.Directory) == 0
        || (attributes & FileAttributes.ReparsePoint) != 0)
      {
        return false;
      }
    }

    return true;
  }
}
