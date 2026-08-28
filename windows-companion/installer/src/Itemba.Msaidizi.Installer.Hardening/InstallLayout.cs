using System.Security;

namespace Itemba.Msaidizi.Installer.Hardening;

public sealed record InstallLayout(string BinaryRoot, string DataRoot)
{
  public string CommonDataRoot => Path.GetDirectoryName(DataParent)
    ?? throw new SecurityException("The data parent has no canonical parent.");

  public string DataParent => Path.GetDirectoryName(DataRoot)
    ?? throw new SecurityException("The data root has no canonical parent.");

  public static InstallLayout ValidateForInstall(string binaryRoot, string dataRoot)
  {
    var expectedBinary = Path.Combine(
      Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
      "Itemba",
      "Msaidizi Companion");
    var expectedData = Path.Combine(
      Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
      "Itemba",
      "Msaidizi");
    return new InstallLayout(
      ValidateExactRoot(binaryRoot, expectedBinary, "binary"),
      ValidateExactRoot(dataRoot, expectedData, "data"));
  }

  public static string ValidateBinaryRoot(string binaryRoot)
  {
    var expected = Path.Combine(
      Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
      "Itemba",
      "Msaidizi Companion");
    return ValidateExactRoot(binaryRoot, expected, "binary");
  }

  public string PathInBinaryRoot(params string[] segments) =>
    ResolveWithin(BinaryRoot, segments);

  public string PathInDataRoot(params string[] segments) =>
    ResolveWithin(DataRoot, segments);

  public static void RejectReparsePoints(string path)
  {
    var fullPath = Normalize(path);
    var root = Path.GetPathRoot(fullPath)
      ?? throw new SecurityException("The path has no volume root.");
    var relative = Path.GetRelativePath(root, fullPath);
    var current = root;
    foreach (var segment in relative.Split(
      Path.DirectorySeparatorChar,
      StringSplitOptions.RemoveEmptyEntries))
    {
      current = Path.Combine(current, segment);
      if (!Directory.Exists(current) && !File.Exists(current))
        continue;
      if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
        throw new SecurityException($"Reparse points are forbidden in installer roots: {current}");
    }
  }

  private static string ResolveWithin(string root, IReadOnlyList<string> segments)
  {
    if (segments.Count == 0 || segments.Any(segment =>
          string.IsNullOrWhiteSpace(segment) ||
          segment is "." or ".." ||
          segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 ||
          segment.Contains(Path.DirectorySeparatorChar) ||
          segment.Contains(Path.AltDirectorySeparatorChar)))
      throw new SecurityException("Installer path segments must be non-empty leaf names.");

    var candidate = Normalize(Path.Combine([root, .. segments]));
    var prefix = Path.TrimEndingDirectorySeparator(root) + Path.DirectorySeparatorChar;
    if (!candidate.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
      throw new SecurityException("The resolved path escaped the trusted root.");
    return candidate;
  }

  private static string ValidateExactRoot(string supplied, string expected, string label)
  {
    if (string.IsNullOrWhiteSpace(supplied) ||
        supplied.StartsWith(@"\\", StringComparison.Ordinal) ||
        supplied.StartsWith(@"\\?\", StringComparison.Ordinal) ||
        supplied.StartsWith(@"\\.\", StringComparison.Ordinal))
      throw new SecurityException($"The {label} root is not a local absolute path.");

    var normalized = Normalize(supplied);
    var normalizedExpected = Normalize(expected);
    if (!string.Equals(normalized, normalizedExpected, StringComparison.OrdinalIgnoreCase))
      throw new SecurityException(
        $"The {label} root must be the installer-owned canonical location.");
    RejectReparsePoints(normalized);
    return normalized;
  }

  private static string Normalize(string value) =>
    Path.TrimEndingDirectorySeparator(Path.GetFullPath(value));
}
