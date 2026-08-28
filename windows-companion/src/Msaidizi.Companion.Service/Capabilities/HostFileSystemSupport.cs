using System.Buffers;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Security;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal sealed record HostStateDigest(
  string Sha256,
  string EntryType,
  long Length,
  long BytesRead,
  uint? VolumeSerialNumber = null,
  ulong? FileId = null);

internal static class HostFileSystemSupport
{
  public static readonly string AbsentStateSha256 =
    PayloadDigest.Sha256Hex("msaidizi-host-state:absent:v1");

  public static async ValueTask<HostStateDigest> ComputeStateAsync(
    SupervisorPathPolicy paths,
    ResolvedHostPath target,
    long maximumBytes,
    CancellationToken cancellationToken)
  {
    if (!File.Exists(target.FullPath) && !Directory.Exists(target.FullPath))
    {
      return new HostStateDigest(AbsentStateSha256, "absent", 0, 0);
    }

    using var handle = paths.OpenExisting(target, lockAgainstMutation: true, readData: true);
    if (!handle.IsDirectory)
    {
      var digest = await HashFileAsync(handle, maximumBytes, cancellationToken)
        .ConfigureAwait(false);
      return new HostStateDigest(
        digest.Sha256,
        "file",
        digest.Length,
        digest.Length,
        handle.VolumeSerialNumber,
        handle.FileId);
    }

    using var aggregate = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
    var entries = EnumerateTree(paths, target)
      .OrderBy(entry => entry.RelativePath, StringComparer.OrdinalIgnoreCase)
      .ThenBy(entry => entry.RelativePath, StringComparer.Ordinal)
      .ToArray();
    long bytesRead = 0;
    foreach (var entry in entries)
    {
      cancellationToken.ThrowIfCancellationRequested();
      using var entryHandle = paths.OpenExisting(
        entry,
        lockAgainstMutation: true,
        readData: true);
      var marker = entryHandle.IsDirectory ? "D" : "F";
      var subtreeRelativePath = Path.GetRelativePath(target.FullPath, entry.FullPath);
      AppendUtf8(aggregate, $"{marker}\0{subtreeRelativePath}\0");
      if (!entryHandle.IsDirectory)
      {
        var remaining = checked(maximumBytes - bytesRead);
        var fileDigest = await HashFileAsync(entryHandle, remaining, cancellationToken)
          .ConfigureAwait(false);
        bytesRead = checked(bytesRead + fileDigest.Length);
        AppendUtf8(aggregate, $"{fileDigest.Length}\0{fileDigest.Sha256}\0");
      }
    }

    return new HostStateDigest(
      Convert.ToHexString(aggregate.GetHashAndReset()).ToLowerInvariant(),
      "directory",
      entries.LongLength,
      bytesRead,
      handle.VolumeSerialNumber,
      handle.FileId);
  }

  public static async ValueTask<(byte[] Content, string Sha256)> ReadFileAsync(
    SupervisorPathPolicy paths,
    ResolvedHostPath target,
    long maximumBytes,
    CancellationToken cancellationToken)
  {
    using var handle = paths.OpenExisting(
      target,
      requireDirectory: false,
      lockAgainstMutation: true,
      readData: true);
    var length = RandomAccess.GetLength(handle.Handle);
    if (length < 0 || length > maximumBytes || length > int.MaxValue)
    {
      throw new HostPolicyException("file_exceeds_read_budget");
    }

    var content = new byte[checked((int)length)];
    var offset = 0;
    while (offset < content.Length)
    {
      var read = await RandomAccess.ReadAsync(
        handle.Handle,
        content.AsMemory(offset),
        offset,
        cancellationToken).ConfigureAwait(false);
      if (read == 0)
      {
        break;
      }

      offset += read;
    }

    if (offset != content.Length)
    {
      throw new IOException("File length changed during the governed read.");
    }

    return (
      content,
      Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant());
  }

  public static IReadOnlyList<ResolvedHostPath> EnumerateTree(
    SupervisorPathPolicy paths,
    ResolvedHostPath root)
  {
    var output = new List<ResolvedHostPath>();
    var pending = new Stack<ResolvedHostPath>();
    pending.Push(root);
    while (pending.Count > 0)
    {
      var current = pending.Pop();
      using var currentHandle = paths.OpenExisting(
        current,
        requireDirectory: true,
        lockAgainstMutation: true);
      foreach (var path in Directory.EnumerateFileSystemEntries(current.FullPath))
      {
        var relativeToAllowedRoot = Path.GetRelativePath(current.RootPath, path);
        var child = paths.Resolve(
          current.RootId,
          relativeToAllowedRoot,
          current.Access);
        using var childHandle = paths.OpenExisting(child, lockAgainstMutation: true);
        output.Add(child);
        if (childHandle.IsDirectory)
        {
          pending.Push(child);
        }
      }
    }

    return output;
  }

  public static async ValueTask<long> CopyEntryAsync(
    SupervisorPathPolicy paths,
    ResolvedHostPath source,
    string destination,
    bool destinationDirectoryPrepared,
    long maximumBytes,
    CancellationToken cancellationToken)
  {
    using var sourceHandle = paths.OpenExisting(
      source,
      lockAgainstMutation: true,
      readData: true);
    if (!sourceHandle.IsDirectory)
    {
      return await CopyFileHandleAsync(
        sourceHandle,
        destination,
        maximumBytes,
        cancellationToken).ConfigureAwait(false);
    }

    if (!destinationDirectoryPrepared || !Directory.Exists(destination))
    {
      throw new HostPolicyException("copy_staging_directory_missing");
    }
    long copied = 0;
    foreach (var entry in EnumerateTree(paths, source)
      .OrderBy(entry => entry.RelativePath.Count(character => character == Path.DirectorySeparatorChar))
      .ThenBy(entry => entry.RelativePath, StringComparer.OrdinalIgnoreCase))
    {
      cancellationToken.ThrowIfCancellationRequested();
      var relative = Path.GetRelativePath(source.FullPath, entry.FullPath);
      var target = Path.Combine(destination, relative);
      using var entryHandle = paths.OpenExisting(
        entry,
        lockAgainstMutation: true,
        readData: true);
      if (entryHandle.IsDirectory)
      {
        Directory.CreateDirectory(target);
        continue;
      }

      copied = checked(copied + await CopyFileHandleAsync(
        entryHandle,
        target,
        checked(maximumBytes - copied),
        cancellationToken).ConfigureAwait(false));
    }

    return copied;
  }

  public static async ValueTask<long> CreateArchiveAsync(
    SupervisorPathPolicy paths,
    ResolvedHostPath source,
    string archivePath,
    long maximumBytes,
    CancellationToken cancellationToken)
  {
    long bytesRead = 0;
    await using var archiveStream = new FileStream(
      archivePath,
      FileMode.CreateNew,
      FileAccess.ReadWrite,
      FileShare.None,
      81920,
      FileOptions.Asynchronous | FileOptions.WriteThrough);
    using var archive = new ZipArchive(archiveStream, ZipArchiveMode.Create, leaveOpen: true);
    using var sourceHandle = paths.OpenExisting(
      source,
      lockAgainstMutation: true,
      readData: true);
    if (!sourceHandle.IsDirectory)
    {
      bytesRead = await AddFileToArchiveAsync(
        archive,
        Path.GetFileName(source.FullPath),
        sourceHandle,
        maximumBytes,
        cancellationToken).ConfigureAwait(false);
    }
    else
    {
      foreach (var entry in EnumerateTree(paths, source)
        .OrderBy(entry => entry.RelativePath, StringComparer.OrdinalIgnoreCase))
      {
        using var entryHandle = paths.OpenExisting(
          entry,
          lockAgainstMutation: true,
          readData: true);
        var relative = Path.GetRelativePath(source.FullPath, entry.FullPath)
          .Replace(Path.DirectorySeparatorChar, '/');
        if (entryHandle.IsDirectory)
        {
          _ = archive.CreateEntry($"{relative.TrimEnd('/')}/");
          continue;
        }

        bytesRead = checked(bytesRead + await AddFileToArchiveAsync(
          archive,
          relative,
          entryHandle,
          checked(maximumBytes - bytesRead),
          cancellationToken).ConfigureAwait(false));
      }
    }

    return bytesRead;
  }

  public static string TemporarySiblingPath(ResolvedHostPath destination, string actionId)
  {
    var parent = Path.GetDirectoryName(destination.FullPath)
      ?? throw new HostPolicyException("parent_path_invalid");
    var actionDigest = PayloadDigest.Sha256Hex(actionId)[..16];
    return Path.Combine(parent, $".msaidizi-{actionDigest}-{Guid.NewGuid():N}.tmp");
  }

  public static ValueTask<(string Sha256, long Length)> HashValidatedFileAsync(
    ValidatedPathHandle handle,
    long maximumBytes,
    CancellationToken cancellationToken) =>
    HashFileAsync(handle, maximumBytes, cancellationToken);

  public static DataProvenance CreateProvenance(
    string sourceType,
    ResolvedHostPath path,
    string contentSha256,
    ProvenanceTrust trust = ProvenanceTrust.TrustedSystem) => new(
      sourceType,
      PayloadDigest.Sha256Hex($"{path.RootId}:{path.RelativePath}"),
      contentSha256,
      trust,
      DateTimeOffset.UtcNow);

  public static void EnsureExpectedPreState(
    ActionExecutionContext context,
    HostStateDigest actual)
  {
    if (context.ExpectedPreStateSha256 is null
      || !PayloadDigest.FixedTimeEqualsHex(context.ExpectedPreStateSha256, actual.Sha256))
    {
      throw new HostPreconditionException("expected_pre_state_mismatch");
    }
  }

  public static JsonElement ParseSchema(string json)
  {
    using var document = JsonDocument.Parse(json);
    return document.RootElement.Clone();
  }

  public static bool HasExactProperties(
    JsonElement value,
    IReadOnlySet<string> required,
    IReadOnlySet<string>? optional = null)
  {
    if (value.ValueKind != JsonValueKind.Object)
    {
      return false;
    }

    var remaining = new HashSet<string>(required, StringComparer.Ordinal);
    foreach (var property in value.EnumerateObject())
    {
      if (!remaining.Remove(property.Name)
        && (optional is null || !optional.Contains(property.Name)))
      {
        return false;
      }
    }

    return remaining.Count == 0;
  }

  public static string RequiredString(JsonElement arguments, string property, int maximumLength = 1024)
  {
    if (!arguments.TryGetProperty(property, out var value)
      || value.ValueKind != JsonValueKind.String
      || string.IsNullOrWhiteSpace(value.GetString())
      || value.GetString()!.Length > maximumLength)
    {
      throw new HostPolicyException("arguments_schema_invalid");
    }

    return value.GetString()!;
  }

  private static async ValueTask<(string Sha256, long Length)> HashFileAsync(
    ValidatedPathHandle handle,
    long maximumBytes,
    CancellationToken cancellationToken)
  {
    var length = RandomAccess.GetLength(handle.Handle);
    if (length < 0 || length > maximumBytes)
    {
      throw new HostPolicyException("local_byte_budget_exceeded");
    }

    using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
    var buffer = ArrayPool<byte>.Shared.Rent(81920);
    try
    {
      long offset = 0;
      while (offset < length)
      {
        var requested = checked((int)Math.Min(buffer.Length, length - offset));
        var read = await RandomAccess.ReadAsync(
          handle.Handle,
          buffer.AsMemory(0, requested),
          offset,
          cancellationToken).ConfigureAwait(false);
        if (read == 0)
        {
          throw new IOException("File changed during state hashing.");
        }

        hash.AppendData(buffer, 0, read);
        offset += read;
      }

      return (
        Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant(),
        length);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(buffer);
      ArrayPool<byte>.Shared.Return(buffer);
    }
  }

  private static async ValueTask<long> CopyFileHandleAsync(
    ValidatedPathHandle source,
    string destination,
    long maximumBytes,
    CancellationToken cancellationToken)
  {
    var length = RandomAccess.GetLength(source.Handle);
    if (length < 0 || length > maximumBytes)
    {
      throw new HostPolicyException("local_byte_budget_exceeded");
    }

    await using var output = new FileStream(
      destination,
      FileMode.CreateNew,
      FileAccess.Write,
      FileShare.None,
      81920,
      FileOptions.Asynchronous | FileOptions.WriteThrough);
    var buffer = ArrayPool<byte>.Shared.Rent(81920);
    try
    {
      long offset = 0;
      while (offset < length)
      {
        var requested = checked((int)Math.Min(buffer.Length, length - offset));
        var read = await RandomAccess.ReadAsync(
          source.Handle,
          buffer.AsMemory(0, requested),
          offset,
          cancellationToken).ConfigureAwait(false);
        if (read == 0)
        {
          throw new IOException("Source changed during copy.");
        }

        await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken)
          .ConfigureAwait(false);
        offset += read;
      }

      await output.FlushAsync(cancellationToken).ConfigureAwait(false);
      output.Flush(flushToDisk: true);
      return length;
    }
    finally
    {
      CryptographicOperations.ZeroMemory(buffer);
      ArrayPool<byte>.Shared.Return(buffer);
    }
  }

  private static async ValueTask<long> AddFileToArchiveAsync(
    ZipArchive archive,
    string entryName,
    ValidatedPathHandle source,
    long maximumBytes,
    CancellationToken cancellationToken)
  {
    var length = RandomAccess.GetLength(source.Handle);
    if (length < 0 || length > maximumBytes)
    {
      throw new HostPolicyException("local_byte_budget_exceeded");
    }

    var entry = archive.CreateEntry(entryName, CompressionLevel.Optimal);
    await using var output = entry.Open();
    var buffer = ArrayPool<byte>.Shared.Rent(81920);
    try
    {
      long offset = 0;
      while (offset < length)
      {
        var requested = checked((int)Math.Min(buffer.Length, length - offset));
        var read = await RandomAccess.ReadAsync(
          source.Handle,
          buffer.AsMemory(0, requested),
          offset,
          cancellationToken).ConfigureAwait(false);
        if (read == 0)
        {
          throw new IOException("Source changed during archive creation.");
        }

        await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken)
          .ConfigureAwait(false);
        offset += read;
      }

      return length;
    }
    finally
    {
      CryptographicOperations.ZeroMemory(buffer);
      ArrayPool<byte>.Shared.Return(buffer);
    }
  }

  private static void AppendUtf8(IncrementalHash hash, string value)
  {
    var bytes = Encoding.UTF8.GetBytes(value);
    hash.AppendData(bytes);
  }
}
