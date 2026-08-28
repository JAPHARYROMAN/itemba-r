using System.IO.Compression;
using System.Security.Cryptography;

namespace Itemba.Msaidizi.UpdateEvaluator.Evaluation;

public static class DeterministicArchive
{
  private static readonly DateTimeOffset FixedTimestamp =
    new(2000, 1, 1, 0, 0, 0, TimeSpan.Zero);

  public static (long ByteSize, string Sha256, long SourceBytes) Create(
    string sourceRoot,
    string destination)
  {
    WorkspaceExportGuard.AssertRegularTree(sourceRoot);
    var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(sourceRoot));
    Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(destination))!);
    var temporary = destination + "." + Guid.NewGuid().ToString("N") + ".tmp";
    long sourceBytes = 0;
    try
    {
      using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write,
        FileShare.None, 64 * 1024, FileOptions.WriteThrough))
      using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: false))
      {
        foreach (var path in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
                   .OrderBy(path => Relative(root, path), StringComparer.Ordinal))
        {
          var relative = Relative(root, path);
          var entry = archive.CreateEntry(relative, CompressionLevel.Optimal);
          entry.LastWriteTime = FixedTimestamp;
          entry.ExternalAttributes = 0;
          using var source = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read,
            64 * 1024, FileOptions.SequentialScan);
          sourceBytes = checked(sourceBytes + source.Length);
          using var target = entry.Open();
          source.CopyTo(target);
        }
      }
      File.Move(temporary, destination, overwrite: true);
      var bytes = File.ReadAllBytes(destination);
      try
      {
        return (bytes.LongLength,
          Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), sourceBytes);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(bytes);
      }
    }
    finally
    {
      File.Delete(temporary);
    }
  }

  private static string Relative(string root, string path) =>
    Path.GetRelativePath(root, path).Replace('\\', '/').Normalize();
}
