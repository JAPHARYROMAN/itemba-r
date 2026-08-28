using System.Security;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Supervision;

/// <summary>
/// Reads the out-of-bound supervisor kill switch fail-closed. A missing marker
/// is the only affirmative safe state; an unreadable or indeterminate path is
/// treated as engaged.
/// </summary>
internal static class TrustedKillSwitch
{
  public static bool IsEngaged(string? path)
  {
    if (string.IsNullOrWhiteSpace(path))
    {
      return true;
    }

    try
    {
      if (!MarkerParentIsPresentAndOrdinary(path))
      {
        return true;
      }
      _ = File.GetAttributes(path);
      return true;
    }
    catch (FileNotFoundException)
    {
      return !MarkerParentIsPresentAndOrdinary(path);
    }
    catch (DirectoryNotFoundException)
    {
      return true;
    }
    catch (Exception exception) when (exception is IOException
      or UnauthorizedAccessException
      or SecurityException)
    {
      return true;
    }
  }

  private static bool MarkerParentIsPresentAndOrdinary(string path)
  {
    var fullPath = Path.GetFullPath(path);
    var parent = Path.GetDirectoryName(fullPath);
    if (string.IsNullOrWhiteSpace(parent) || !Directory.Exists(parent))
    {
      return false;
    }
    var attributes = File.GetAttributes(parent);
    return (attributes & FileAttributes.Directory) != 0
      && (attributes & FileAttributes.ReparsePoint) == 0;
  }
}
