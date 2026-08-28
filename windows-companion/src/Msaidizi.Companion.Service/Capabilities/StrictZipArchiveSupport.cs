using System.Buffers;
using System.Buffers.Binary;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal sealed record StrictZipArchiveLimits(
  int MaximumEntries,
  int MaximumEntryPathLength,
  long MaximumExpandedBytes,
  long MaximumSingleEntryBytes,
  int MaximumCompressionRatio);

internal sealed record StrictZipArchiveEntry(
  int ArchiveIndex,
  string ArchiveName,
  string RelativePath,
  bool IsDirectory,
  ushort Flags,
  ushort CompressionMethod,
  long CompressedLength,
  long ExpandedLength,
  uint Crc32,
  int LocalHeaderOffset,
  byte[] RawName);

internal sealed record StrictZipArchivePlan(
  IReadOnlyList<StrictZipArchiveEntry> Entries,
  IReadOnlyList<string> Directories,
  IReadOnlyList<string> TreeEntries,
  long ExpandedBytes,
  long CompressedBytes);

/// <summary>
/// Parses the ZIP wire format before any filesystem effect. The deliberately
/// narrow profile supports only single-disk, non-ZIP64 store/deflate archives
/// with unambiguous ASCII or strict UTF-8 names and safe timestamp extras.
/// Unknown metadata fails closed instead of being delegated to ZipArchive.
/// </summary>
internal static class StrictZipArchiveInspector
{
  private const uint EndOfCentralDirectorySignature = 0x06054b50;
  private const uint CentralDirectorySignature = 0x02014b50;
  private const uint LocalHeaderSignature = 0x04034b50;
  private const uint DataDescriptorSignature = 0x08074b50;
  private const ushort Utf8Flag = 0x0800;
  private const ushort DataDescriptorFlag = 0x0008;
  private const ushort StoredMethod = 0;
  private const ushort DeflateMethod = 8;
  private const uint Zip64Sentinel = uint.MaxValue;
  private static readonly UTF8Encoding StrictUtf8 = new(
    encoderShouldEmitUTF8Identifier: false,
    throwOnInvalidBytes: true);

  public static StrictZipArchivePlan Inspect(
    ReadOnlyMemory<byte> archive,
    StrictZipArchiveLimits limits)
  {
    ValidateLimits(limits);
    var bytes = archive.Span;
    var endOffset = FindEndOfCentralDirectory(bytes);
    var diskNumber = ReadUInt16(bytes, endOffset + 4);
    var centralDisk = ReadUInt16(bytes, endOffset + 6);
    var entriesOnDisk = ReadUInt16(bytes, endOffset + 8);
    var entryCount = ReadUInt16(bytes, endOffset + 10);
    var centralLength = ReadUInt32(bytes, endOffset + 12);
    var centralOffset = ReadUInt32(bytes, endOffset + 16);
    var commentLength = ReadUInt16(bytes, endOffset + 20);
    if (commentLength != 0)
    {
      throw new HostPolicyException("archive_comments_not_supported");
    }
    if (diskNumber != 0 || centralDisk != 0 || entriesOnDisk != entryCount)
    {
      throw new HostPolicyException("archive_multidisk_not_supported");
    }
    if (entryCount == ushort.MaxValue
      || centralLength == Zip64Sentinel
      || centralOffset == Zip64Sentinel)
    {
      throw new HostPolicyException("archive_zip64_not_supported");
    }
    if (entryCount > limits.MaximumEntries)
    {
      throw new HostPolicyException("archive_entry_limit_exceeded");
    }

    var centralStart = checked((int)centralOffset);
    var centralEnd = checked(centralStart + checked((int)centralLength));
    if (centralStart < 0 || centralEnd != endOffset || centralEnd > bytes.Length)
    {
      throw new HostPolicyException("archive_central_directory_invalid");
    }

    var entries = new List<StrictZipArchiveEntry>(entryCount);
    var centralCursor = centralStart;
    long totalExpanded = 0;
    long totalCompressed = 0;
    for (var index = 0; index < entryCount; index++)
    {
      EnsureRange(bytes, centralCursor, 46);
      if (ReadUInt32(bytes, centralCursor) != CentralDirectorySignature)
      {
        throw new HostPolicyException("archive_central_directory_invalid");
      }

      var versionMadeBy = ReadUInt16(bytes, centralCursor + 4);
      var versionNeeded = ReadUInt16(bytes, centralCursor + 6);
      var flags = ReadUInt16(bytes, centralCursor + 8);
      var method = ReadUInt16(bytes, centralCursor + 10);
      var crc32 = ReadUInt32(bytes, centralCursor + 16);
      var compressedLength = ReadUInt32(bytes, centralCursor + 20);
      var expandedLength = ReadUInt32(bytes, centralCursor + 24);
      var nameLength = ReadUInt16(bytes, centralCursor + 28);
      var extraLength = ReadUInt16(bytes, centralCursor + 30);
      var entryCommentLength = ReadUInt16(bytes, centralCursor + 32);
      var startDisk = ReadUInt16(bytes, centralCursor + 34);
      var externalAttributes = ReadUInt32(bytes, centralCursor + 38);
      var localOffset = ReadUInt32(bytes, centralCursor + 42);
      if (versionNeeded > 20)
      {
        throw new HostPolicyException("archive_version_not_supported");
      }
      ValidateFlagsAndMethod(flags, method);
      if (compressedLength == Zip64Sentinel
        || expandedLength == Zip64Sentinel
        || localOffset == Zip64Sentinel)
      {
        throw new HostPolicyException("archive_zip64_not_supported");
      }
      if (startDisk != 0)
      {
        throw new HostPolicyException("archive_multidisk_not_supported");
      }
      if (entryCommentLength != 0)
      {
        throw new HostPolicyException("archive_comments_not_supported");
      }

      var variableLength = checked(nameLength + extraLength + entryCommentLength);
      EnsureRange(bytes, centralCursor + 46, variableLength);
      var rawName = bytes.Slice(centralCursor + 46, nameLength).ToArray();
      var archiveName = DecodeName(rawName, flags);
      var isDirectory = archiveName.EndsWith('/');
      ValidatePlatformMetadata(versionMadeBy, externalAttributes, isDirectory);
      ValidateExtraFields(bytes.Slice(
        centralCursor + 46 + nameLength,
        extraLength));
      var relativePath = NormalizeArchivePath(
        archiveName,
        isDirectory,
        limits.MaximumEntryPathLength);
      if (isDirectory && (compressedLength != 0 || expandedLength != 0 || crc32 != 0))
      {
        throw new HostPolicyException("archive_directory_payload_forbidden");
      }
      if (expandedLength > limits.MaximumSingleEntryBytes)
      {
        throw new HostPolicyException("archive_single_entry_limit_exceeded");
      }
      if (ExceedsRatio(expandedLength, compressedLength, limits.MaximumCompressionRatio))
      {
        throw new HostPolicyException("archive_compression_ratio_exceeded");
      }

      totalExpanded = CheckedAdd(
        totalExpanded,
        expandedLength,
        "archive_expanded_byte_limit_exceeded");
      totalCompressed = CheckedAdd(
        totalCompressed,
        compressedLength,
        "archive_compressed_byte_count_invalid");
      if (totalExpanded > limits.MaximumExpandedBytes)
      {
        throw new HostPolicyException("archive_expanded_byte_limit_exceeded");
      }

      entries.Add(new StrictZipArchiveEntry(
        index,
        archiveName,
        relativePath,
        isDirectory,
        flags,
        method,
        compressedLength,
        expandedLength,
        crc32,
        checked((int)localOffset),
        rawName));
      centralCursor = checked(centralCursor + 46 + variableLength);
    }
    if (centralCursor != centralEnd)
    {
      throw new HostPolicyException("archive_central_directory_invalid");
    }
    if (ExceedsRatio(totalExpanded, totalCompressed, limits.MaximumCompressionRatio))
    {
      throw new HostPolicyException("archive_compression_ratio_exceeded");
    }

    ValidateLocalRecords(bytes, entries, centralStart);
    return BuildTreePlan(entries, totalExpanded, totalCompressed, limits.MaximumEntries);
  }

  private static StrictZipArchivePlan BuildTreePlan(
    IReadOnlyList<StrictZipArchiveEntry> entries,
    long totalExpanded,
    long totalCompressed,
    int maximumEntries)
  {
    var explicitPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    var nodes = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
    var canonicalPaths = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    foreach (var entry in entries)
    {
      if (!explicitPaths.Add(entry.RelativePath))
      {
        throw new HostPolicyException("archive_duplicate_path");
      }

      var segments = entry.RelativePath.Split(Path.DirectorySeparatorChar);
      var current = string.Empty;
      for (var index = 0; index < segments.Length - 1; index++)
      {
        current = current.Length == 0
          ? segments[index]
          : Path.Combine(current, segments[index]);
        EnsureCanonicalCase(canonicalPaths, current);
        if (nodes.TryGetValue(current, out var ancestorIsDirectory)
          && !ancestorIsDirectory)
        {
          throw new HostPolicyException("archive_file_directory_conflict");
        }
        nodes[current] = true;
      }

      EnsureCanonicalCase(canonicalPaths, entry.RelativePath);
      if (nodes.TryGetValue(entry.RelativePath, out var existingIsDirectory))
      {
        if (!existingIsDirectory || !entry.IsDirectory)
        {
          throw new HostPolicyException("archive_file_directory_conflict");
        }
      }
      else
      {
        nodes.Add(entry.RelativePath, entry.IsDirectory);
      }
      if (nodes.Count > maximumEntries)
      {
        throw new HostPolicyException("archive_entry_limit_exceeded");
      }
    }

    var directories = nodes
      .Where(node => node.Value)
      .Select(node => node.Key)
      .OrderBy(PathDepth)
      .ThenBy(path => path, StringComparer.OrdinalIgnoreCase)
      .ThenBy(path => path, StringComparer.Ordinal)
      .ToArray();
    var treeEntries = nodes.Keys
      .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
      .ThenBy(path => path, StringComparer.Ordinal)
      .ToArray();
    return new StrictZipArchivePlan(
      entries,
      directories,
      treeEntries,
      totalExpanded,
      totalCompressed);
  }

  private static void EnsureCanonicalCase(
    Dictionary<string, string> canonicalPaths,
    string path)
  {
    if (canonicalPaths.TryGetValue(path, out var canonical)
      && !string.Equals(canonical, path, StringComparison.Ordinal))
    {
      throw new HostPolicyException("archive_case_ambiguous_path");
    }
    canonicalPaths[path] = path;
  }

  private static void ValidateLocalRecords(
    ReadOnlySpan<byte> bytes,
    IReadOnlyList<StrictZipArchiveEntry> entries,
    int centralOffset)
  {
    var regions = new List<(int Start, int End)>(entries.Count);
    foreach (var entry in entries)
    {
      var cursor = entry.LocalHeaderOffset;
      EnsureRange(bytes, cursor, 30);
      if (ReadUInt32(bytes, cursor) != LocalHeaderSignature)
      {
        throw new HostPolicyException("archive_local_header_invalid");
      }

      var versionNeeded = ReadUInt16(bytes, cursor + 4);
      var flags = ReadUInt16(bytes, cursor + 6);
      var method = ReadUInt16(bytes, cursor + 8);
      var localCrc = ReadUInt32(bytes, cursor + 14);
      var localCompressed = ReadUInt32(bytes, cursor + 18);
      var localExpanded = ReadUInt32(bytes, cursor + 22);
      var nameLength = ReadUInt16(bytes, cursor + 26);
      var extraLength = ReadUInt16(bytes, cursor + 28);
      if (versionNeeded > 20
        || flags != entry.Flags
        || method != entry.CompressionMethod)
      {
        throw new HostPolicyException("archive_local_header_mismatch");
      }
      EnsureRange(bytes, cursor + 30, checked(nameLength + extraLength));
      if (!bytes.Slice(cursor + 30, nameLength).SequenceEqual(entry.RawName))
      {
        throw new HostPolicyException("archive_local_header_mismatch");
      }
      ValidateExtraFields(bytes.Slice(cursor + 30 + nameLength, extraLength));

      var usesDescriptor = (flags & DataDescriptorFlag) != 0;
      if (!usesDescriptor
        && (localCrc != entry.Crc32
          || localCompressed != entry.CompressedLength
          || localExpanded != entry.ExpandedLength))
      {
        throw new HostPolicyException("archive_local_header_mismatch");
      }
      if (usesDescriptor
        && ((localCrc != 0 && localCrc != entry.Crc32)
          || (localCompressed != 0 && localCompressed != entry.CompressedLength)
          || (localExpanded != 0 && localExpanded != entry.ExpandedLength)))
      {
        throw new HostPolicyException("archive_local_header_mismatch");
      }

      var dataStart = checked(cursor + 30 + nameLength + extraLength);
      var dataEnd = checked(dataStart + checked((int)entry.CompressedLength));
      if (dataEnd > centralOffset)
      {
        throw new HostPolicyException("archive_entry_data_invalid");
      }
      var regionEnd = usesDescriptor
        ? ValidateDataDescriptor(bytes, dataEnd, entry)
        : dataEnd;
      if (regionEnd > centralOffset)
      {
        throw new HostPolicyException("archive_entry_data_invalid");
      }
      regions.Add((cursor, regionEnd));
    }

    var ordered = regions.OrderBy(region => region.Start).ToArray();
    var expectedStart = 0;
    foreach (var region in ordered)
    {
      if (region.Start != expectedStart || region.End <= region.Start)
      {
        throw new HostPolicyException("archive_local_record_layout_invalid");
      }
      expectedStart = region.End;
    }
    if (expectedStart != centralOffset)
    {
      throw new HostPolicyException("archive_local_record_layout_invalid");
    }
  }

  private static int ValidateDataDescriptor(
    ReadOnlySpan<byte> bytes,
    int offset,
    StrictZipArchiveEntry entry)
  {
    EnsureRange(bytes, offset, 12);
    var hasSignature = ReadUInt32(bytes, offset) == DataDescriptorSignature;
    var valueOffset = hasSignature ? offset + 4 : offset;
    EnsureRange(bytes, valueOffset, 12);
    if (ReadUInt32(bytes, valueOffset) != entry.Crc32
      || ReadUInt32(bytes, valueOffset + 4) != entry.CompressedLength
      || ReadUInt32(bytes, valueOffset + 8) != entry.ExpandedLength)
    {
      throw new HostPolicyException("archive_data_descriptor_invalid");
    }
    return checked(valueOffset + 12);
  }

  private static void ValidateFlagsAndMethod(ushort flags, ushort method)
  {
    if (method is not (StoredMethod or DeflateMethod))
    {
      throw new HostPolicyException("archive_compression_method_unsupported");
    }
    var allowed = method == DeflateMethod
      ? (ushort)0x080e
      : (ushort)0x0808;
    if ((flags & ~allowed) != 0)
    {
      throw (flags & 0x2041) != 0
        ? new HostPolicyException("archive_encryption_forbidden")
        : new HostPolicyException("archive_entry_flags_unsupported");
    }
  }

  private static string DecodeName(ReadOnlySpan<byte> rawName, ushort flags)
  {
    if (rawName.Length == 0)
    {
      throw new HostPolicyException("archive_entry_path_invalid");
    }
    try
    {
      if ((flags & Utf8Flag) != 0)
      {
        return StrictUtf8.GetString(rawName);
      }
      if (ContainsNonAsciiPathByte(rawName))
      {
        throw new HostPolicyException("archive_legacy_name_encoding_forbidden");
      }
      return Encoding.ASCII.GetString(rawName);
    }
    catch (DecoderFallbackException exception)
    {
      throw new HostPolicyException("archive_entry_name_encoding_invalid", exception);
    }
  }

  private static string NormalizeArchivePath(
    string archiveName,
    bool isDirectory,
    int maximumLength)
  {
    if (archiveName.Contains('\\', StringComparison.Ordinal)
      || archiveName.Contains('\0')
      || archiveName.StartsWith('/')
      || archiveName.StartsWith("//", StringComparison.Ordinal)
      || archiveName.Contains(':', StringComparison.Ordinal))
    {
      throw new HostPolicyException("archive_entry_path_forbidden");
    }
    var withoutTerminator = isDirectory ? archiveName[..^1] : archiveName;
    if (withoutTerminator.Length == 0 || withoutTerminator.Length > maximumLength)
    {
      throw new HostPolicyException(
        withoutTerminator.Length == 0
          ? "archive_entry_path_invalid"
          : "archive_entry_path_too_long");
    }
    try
    {
      var normalized = SupervisorPathPolicy.NormalizeRelativePath(withoutTerminator);
      return normalized.Length <= maximumLength
        ? normalized
        : throw new HostPolicyException("archive_entry_path_too_long");
    }
    catch (HostPolicyException exception) when (
      exception.ErrorCode != "archive_entry_path_too_long")
    {
      throw new HostPolicyException("archive_entry_path_forbidden", exception);
    }
  }

  private static void ValidatePlatformMetadata(
    ushort versionMadeBy,
    uint externalAttributes,
    bool isDirectory)
  {
    var platform = versionMadeBy >> 8;
    if (platform is not (0 or 3 or 10))
    {
      throw new HostPolicyException("archive_entry_platform_unsupported");
    }

    var dosAttributes = externalAttributes & 0xffff;
    const uint allowedDosAttributes = 0x00b7;
    if ((dosAttributes & ~allowedDosAttributes) != 0)
    {
      throw new HostPolicyException("archive_link_metadata_forbidden");
    }
    var dosDirectory = (dosAttributes & 0x0010) != 0;
    if (dosDirectory && !isDirectory)
    {
      throw new HostPolicyException("archive_file_directory_conflict");
    }

    if (platform != 3)
    {
      return;
    }
    var unixMode = (externalAttributes >> 16) & 0xffff;
    var fileType = unixMode & 0xf000;
    if (fileType is not (0 or 0x4000 or 0x8000))
    {
      throw new HostPolicyException("archive_link_metadata_forbidden");
    }
    if ((fileType == 0x4000) != isDirectory && fileType != 0)
    {
      throw new HostPolicyException("archive_file_directory_conflict");
    }
  }

  private static bool ContainsNonAsciiPathByte(ReadOnlySpan<byte> value)
  {
    foreach (var item in value)
    {
      if (item is < 0x20 or > 0x7e)
      {
        return true;
      }
    }
    return false;
  }

  private static void ValidateExtraFields(ReadOnlySpan<byte> fields)
  {
    var cursor = 0;
    var seen = new HashSet<ushort>();
    while (cursor < fields.Length)
    {
      if (fields.Length - cursor < 4)
      {
        throw new HostPolicyException("archive_extra_field_invalid");
      }
      var identifier = ReadUInt16(fields, cursor);
      var length = ReadUInt16(fields, cursor + 2);
      cursor += 4;
      if (fields.Length - cursor < length || !seen.Add(identifier))
      {
        throw new HostPolicyException("archive_extra_field_invalid");
      }
      var payload = fields.Slice(cursor, length);
      switch (identifier)
      {
        case 0x5455:
          ValidateExtendedTimestamp(payload);
          break;
        case 0x000a:
          ValidateNtfsTimestamp(payload);
          break;
        default:
          throw new HostPolicyException("archive_extra_field_unsupported");
      }
      cursor += length;
    }
  }

  private static void ValidateExtendedTimestamp(ReadOnlySpan<byte> payload)
  {
    if (payload.Length == 0 || (payload[0] & ~0x07) != 0)
    {
      throw new HostPolicyException("archive_extra_field_invalid");
    }
    var expected = 1 + (4 * PopCount(payload[0]));
    if (payload.Length != expected)
    {
      throw new HostPolicyException("archive_extra_field_invalid");
    }
  }

  private static void ValidateNtfsTimestamp(ReadOnlySpan<byte> payload)
  {
    if (payload.Length != 32
      || ReadUInt32(payload, 0) != 0
      || ReadUInt16(payload, 4) != 1
      || ReadUInt16(payload, 6) != 24)
    {
      throw new HostPolicyException("archive_extra_field_invalid");
    }
  }

  private static int FindEndOfCentralDirectory(ReadOnlySpan<byte> bytes)
  {
    if (bytes.Length < 22)
    {
      throw new HostPolicyException("archive_format_invalid");
    }
    var minimum = Math.Max(0, bytes.Length - 22 - ushort.MaxValue);
    for (var offset = bytes.Length - 22; offset >= minimum; offset--)
    {
      if (ReadUInt32(bytes, offset) != EndOfCentralDirectorySignature)
      {
        continue;
      }
      var commentLength = ReadUInt16(bytes, offset + 20);
      if (offset + 22 + commentLength == bytes.Length)
      {
        return offset;
      }
    }
    throw new HostPolicyException("archive_format_invalid");
  }

  private static bool ExceedsRatio(long expanded, long compressed, int maximumRatio) =>
    expanded > 0 && (compressed == 0 || (double)expanded / compressed > maximumRatio);

  private static int PathDepth(string path) =>
    path.Count(character => character == Path.DirectorySeparatorChar);

  private static int PopCount(byte value)
  {
    var count = 0;
    for (var current = value; current != 0; current >>= 1)
    {
      count += current & 1;
    }
    return count;
  }

  private static long CheckedAdd(long left, long right, string errorCode)
  {
    try
    {
      return checked(left + right);
    }
    catch (OverflowException exception)
    {
      throw new HostPolicyException(errorCode, exception);
    }
  }

  private static void ValidateLimits(StrictZipArchiveLimits limits)
  {
    if (limits.MaximumEntries is < 1 or > 4_096
      || limits.MaximumEntryPathLength is < 1 or > 4_096
      || limits.MaximumExpandedBytes < 0
      || limits.MaximumExpandedBytes > 5_368_709_120
      || limits.MaximumSingleEntryBytes is < 1 or > 1_073_741_824
      || limits.MaximumCompressionRatio is < 1 or > 1_000)
    {
      throw new HostPolicyException("archive_limits_invalid");
    }
  }

  private static void EnsureRange(ReadOnlySpan<byte> bytes, int offset, int length)
  {
    if (offset < 0 || length < 0 || offset > bytes.Length - length)
    {
      throw new HostPolicyException("archive_format_invalid");
    }
  }

  private static ushort ReadUInt16(ReadOnlySpan<byte> bytes, int offset)
  {
    EnsureRange(bytes, offset, sizeof(ushort));
    return BinaryPrimitives.ReadUInt16LittleEndian(bytes[offset..]);
  }

  private static uint ReadUInt32(ReadOnlySpan<byte> bytes, int offset)
  {
    EnsureRange(bytes, offset, sizeof(uint));
    return BinaryPrimitives.ReadUInt32LittleEndian(bytes[offset..]);
  }
}

internal sealed record ExtractedArchiveFile(
  string RelativePath,
  string Sha256,
  long Length,
  FileStream Stream);

internal sealed class ArchiveExtractionLease : IDisposable
{
  private readonly IReadOnlyList<ValidatedPathHandle> _directories;
  private readonly IReadOnlyList<ExtractedArchiveFile> _files;
  private bool _disposed;
  private bool _descendantLocksReleased;

  public ArchiveExtractionLease(
    ValidatedPathHandle stagingRoot,
    IReadOnlyList<ValidatedPathHandle> directories,
    IReadOnlyList<ExtractedArchiveFile> files,
    IReadOnlySet<string> expectedTreeEntries,
    string stateSha256,
    long expandedBytes)
  {
    StagingRoot = stagingRoot;
    _directories = directories;
    _files = files;
    ExpectedTreeEntries = expectedTreeEntries;
    StateSha256 = stateSha256;
    ExpandedBytes = expandedBytes;
  }

  public ValidatedPathHandle StagingRoot { get; }

  public IReadOnlySet<string> ExpectedTreeEntries { get; }

  public string StateSha256 { get; }

  public long ExpandedBytes { get; }

  public uint StagingVolumeSerialNumber => StagingRoot.VolumeSerialNumber;

  public ulong StagingFileId => StagingRoot.FileId;

  public void EnsureMovedTo(ResolvedHostPath destination)
  {
    SupervisorPathPolicy.EnsureHandleStillNames(StagingRoot, destination.FullPath);
    if (_descendantLocksReleased)
    {
      return;
    }
    foreach (var directory in _directories)
    {
      var relative = Path.GetRelativePath(StagingRoot.FinalPath, directory.FinalPath);
      SupervisorPathPolicy.EnsureHandleStillNames(
        directory,
        Path.Combine(destination.FullPath, relative));
    }
    foreach (var file in _files)
    {
      ArchiveCreatedFileGuard.EnsureExact(
        file.Stream.SafeFileHandle,
        Path.Combine(destination.FullPath, file.RelativePath),
        StagingRoot.VolumeSerialNumber,
        file.Length);
    }
  }

  public void ReleaseDescendantLocksForCommit()
  {
    if (_descendantLocksReleased)
    {
      return;
    }
    _descendantLocksReleased = true;
    foreach (var file in _files.Reverse())
    {
      file.Stream.Dispose();
    }
    foreach (var directory in _directories.Reverse())
    {
      directory.Dispose();
    }
  }

  public void ReleaseRootLockForPostCommitVerification() => StagingRoot.Dispose();

  public void Dispose()
  {
    if (_disposed)
    {
      return;
    }
    _disposed = true;
    if (!_descendantLocksReleased)
    {
      ReleaseDescendantLocksForCommit();
    }
    StagingRoot.Dispose();
  }
}

internal static class StrictZipArchiveExtractor
{
  public static async ValueTask<(byte[] Content, string Sha256)> ReadExactArchiveAsync(
    ValidatedPathHandle source,
    long maximumBytes,
    CancellationToken cancellationToken)
  {
    var length = RandomAccess.GetLength(source.Handle);
    if (length < 0 || length > maximumBytes || length > int.MaxValue)
    {
      throw new HostPolicyException("archive_source_byte_limit_exceeded");
    }
    var content = new byte[checked((int)length)];
    var offset = 0;
    while (offset < content.Length)
    {
      var read = await RandomAccess.ReadAsync(
        source.Handle,
        content.AsMemory(offset),
        offset,
        cancellationToken).ConfigureAwait(false);
      if (read == 0)
      {
        throw new HostPreconditionException("archive_source_changed_during_read");
      }
      offset += read;
    }
    if (RandomAccess.GetLength(source.Handle) != length)
    {
      throw new HostPreconditionException("archive_source_changed_during_read");
    }
    return (
      content,
      Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant());
  }

  public static async ValueTask<ArchiveExtractionLease> ExtractAsync(
    SupervisorPathPolicy paths,
    ResolvedHostPath staging,
    byte[] archiveBytes,
    StrictZipArchivePlan plan,
    CancellationToken cancellationToken)
  {
    ValidatedPathHandle? stagingRoot = null;
    var directories = new List<ValidatedPathHandle>();
    var files = new List<ExtractedArchiveFile>();
    try
    {
      stagingRoot = paths.OpenExisting(
        staging,
        requireDirectory: true,
        lockAgainstMutation: true);
      var stagingVolume = stagingRoot.VolumeSerialNumber;
      var stagingFileId = stagingRoot.FileId;
      foreach (var relativePath in plan.Directories)
      {
        cancellationToken.ThrowIfCancellationRequested();
        var target = ResolveUnderStaging(paths, staging, relativePath);
        using var parent = paths.OpenParentForCreate(target);
        SupervisorPathPolicy.EnsureHandleStillNames(
          parent,
          Path.GetDirectoryName(target.FullPath)!);
        SupervisorPathPolicy.CreateDirectoryNoOverwrite(
          parent,
          Path.GetFileName(target.FullPath));
        directories.Add(paths.OpenExisting(
          target,
          requireDirectory: true,
          lockAgainstMutation: true));
      }

      using var memory = new MemoryStream(archiveBytes, writable: false);
      using var archive = new ZipArchive(
        memory,
        ZipArchiveMode.Read,
        leaveOpen: false,
        entryNameEncoding: StrictUtf8Encoding);
      if (archive.Entries.Count != plan.Entries.Count)
      {
        throw new HostPolicyException("archive_central_directory_mismatch");
      }
      long totalWritten = 0;
      foreach (var planned in plan.Entries.Where(entry => !entry.IsDirectory))
      {
        cancellationToken.ThrowIfCancellationRequested();
        var entry = archive.Entries[planned.ArchiveIndex];
        if (!string.Equals(entry.FullName, planned.ArchiveName, StringComparison.Ordinal)
          || entry.Length != planned.ExpandedLength
          || entry.CompressedLength != planned.CompressedLength)
        {
          throw new HostPolicyException("archive_central_directory_mismatch");
        }

        var target = ResolveUnderStaging(paths, staging, planned.RelativePath);
        using var parent = paths.OpenParentForCreate(target);
        SupervisorPathPolicy.EnsureHandleStillNames(
          parent,
          Path.GetDirectoryName(target.FullPath)!);
        var output = new FileStream(target.FullPath, new FileStreamOptions
        {
          Access = FileAccess.ReadWrite,
          Mode = FileMode.CreateNew,
          Share = FileShare.Read | FileShare.Delete,
          Options = FileOptions.Asynchronous | FileOptions.WriteThrough,
          BufferSize = 81_920,
        });
        try
        {
          ArchiveCreatedFileGuard.EnsureExact(
            output.SafeFileHandle,
            target.FullPath,
            stagingRoot.VolumeSerialNumber,
            expectedLength: 0);
          var digest = await ExtractEntryAsync(
            entry,
            planned,
            output,
            target.FullPath,
            stagingVolume,
            cancellationToken).ConfigureAwait(false);
          totalWritten = checked(totalWritten + digest.Length);
          if (totalWritten > plan.ExpandedBytes)
          {
            throw new HostPolicyException("archive_expanded_byte_limit_exceeded");
          }
          files.Add(new ExtractedArchiveFile(
            planned.RelativePath,
            digest.Sha256,
            digest.Length,
            output));
        }
        catch
        {
          output.Dispose();
          throw;
        }
      }
      if (totalWritten != plan.ExpandedBytes)
      {
        throw new HostPolicyException("archive_expanded_length_mismatch");
      }

      var stateSha256 = ComputeTreeState(plan, files);
      stagingRoot.Dispose();
      foreach (var directory in directories)
      {
        directory.Dispose();
      }
      directories.Clear();
      stagingRoot = paths.OpenExistingForAtomicTreeCommit(
        staging,
        requireDirectory: true,
        deleteAccess: true);
      if (stagingRoot.VolumeSerialNumber != stagingVolume
        || stagingRoot.FileId != stagingFileId)
      {
        throw new HostPreconditionException("archive_staging_root_changed");
      }
      foreach (var relativePath in plan.Directories)
      {
        directories.Add(paths.OpenExistingForAtomicTreeCommit(
          ResolveUnderStaging(paths, staging, relativePath),
          requireDirectory: true));
      }
      return new ArchiveExtractionLease(
        stagingRoot,
        directories,
        files,
        plan.TreeEntries.ToHashSet(StringComparer.Ordinal),
        stateSha256,
        totalWritten);
    }
    catch (InvalidDataException exception)
    {
      DisposePartial(stagingRoot, directories, files);
      throw new HostPolicyException("archive_entry_data_invalid", exception);
    }
    catch
    {
      DisposePartial(stagingRoot, directories, files);
      throw;
    }
  }

  public static void EnsureExactTree(
    SupervisorPathPolicy paths,
    ResolvedHostPath root,
    IReadOnlySet<string> expected)
  {
    var actual = HostFileSystemSupport.EnumerateTree(paths, root)
      .Select(entry => Path.GetRelativePath(root.FullPath, entry.FullPath))
      .ToHashSet(StringComparer.Ordinal);
    if (!actual.SetEquals(expected))
    {
      throw new HostPreconditionException("archive_staging_tree_changed");
    }
  }

  public static void RemoveOrQuarantineStaging(
    SupervisorPathPolicy paths,
    ResolvedHostPath destination,
    ResolvedHostPath staging,
    string actionId)
  {
    if (!Directory.Exists(staging.FullPath))
    {
      return;
    }
    try
    {
      var entries = HostFileSystemSupport.EnumerateTree(paths, staging)
        .OrderByDescending(entry => PathDepth(Path.GetRelativePath(
          staging.FullPath,
          entry.FullPath)))
        .ThenByDescending(entry => entry.FullPath, StringComparer.OrdinalIgnoreCase)
        .ToArray();
      foreach (var entry in entries)
      {
        using var handle = paths.OpenExisting(
          entry,
          lockAgainstMutation: true,
          deleteAccess: true);
        SupervisorPathPolicy.DeleteExact(handle);
      }
      using (var root = paths.OpenExisting(
        staging,
        requireDirectory: true,
        lockAgainstMutation: true,
        deleteAccess: true))
      {
        SupervisorPathPolicy.DeleteExact(root);
      }
      if (Directory.Exists(staging.FullPath))
      {
        throw new IOException("The staging root remained after exact deletion.");
      }
      return;
    }
    catch (Exception exception) when (exception is HostPolicyException
      or HostPreconditionException
      or IOException
      or UnauthorizedAccessException)
    {
      try
      {
        using var root = paths.OpenExisting(
          staging,
          requireDirectory: true,
          lockAgainstMutation: true,
          deleteAccess: true);
        var recoveryDirectory = paths.CreateRecoveryDirectory(destination, actionId);
        using var recoveryParent = paths.OpenRecoveryEntry(
          destination,
          recoveryDirectory,
          requireDirectory: true);
        SupervisorPathPolicy.RenameExact(
          root,
          recoveryParent,
          $"aborted-archive-extraction-{Guid.NewGuid():N}");
        if (Directory.Exists(staging.FullPath))
        {
          throw new IOException("Staging quarantine did not clear the governed path.");
        }
      }
      catch (Exception quarantineException) when (quarantineException is HostPolicyException
        or HostPreconditionException
        or IOException
        or UnauthorizedAccessException)
      {
        throw new IOException(
          "Exact archive staging cleanup and quarantine both failed.",
          new AggregateException(exception, quarantineException));
      }
    }
  }

  private static readonly UTF8Encoding StrictUtf8Encoding = new(
    encoderShouldEmitUTF8Identifier: false,
    throwOnInvalidBytes: true);

  private static ResolvedHostPath ResolveUnderStaging(
    SupervisorPathPolicy paths,
    ResolvedHostPath staging,
    string relativePath) => paths.Resolve(
      staging.RootId,
      Path.Combine(staging.RelativePath, relativePath),
      HostPathAccess.Write);

  private static async ValueTask<(string Sha256, long Length)> ExtractEntryAsync(
    ZipArchiveEntry entry,
    StrictZipArchiveEntry planned,
    FileStream output,
    string expectedPath,
    uint expectedVolume,
    CancellationToken cancellationToken)
  {
    await using var input = entry.Open();
    using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
    var crc = new ArchiveCrc32();
    var buffer = ArrayPool<byte>.Shared.Rent(81_920);
    long written = 0;
    try
    {
      while (true)
      {
        var read = await input.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
        if (read == 0)
        {
          break;
        }
        written = checked(written + read);
        if (written > planned.ExpandedLength)
        {
          throw new HostPolicyException("archive_expanded_length_mismatch");
        }
        hash.AppendData(buffer, 0, read);
        crc.Append(buffer.AsSpan(0, read));
        await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken)
          .ConfigureAwait(false);
      }
      if (written != planned.ExpandedLength || crc.Value != planned.Crc32)
      {
        throw new HostPolicyException("archive_entry_integrity_mismatch");
      }
      await output.FlushAsync(cancellationToken).ConfigureAwait(false);
      output.Flush(flushToDisk: true);
      ArchiveCreatedFileGuard.EnsureExact(
        output.SafeFileHandle,
        expectedPath,
        expectedVolume,
        expectedLength: written);
      return (
        Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant(),
        written);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(buffer);
      ArrayPool<byte>.Shared.Return(buffer);
    }
  }

  private static string ComputeTreeState(
    StrictZipArchivePlan plan,
    IReadOnlyList<ExtractedArchiveFile> files)
  {
    var fileStates = files.ToDictionary(
      file => file.RelativePath,
      StringComparer.OrdinalIgnoreCase);
    using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
    var directories = plan.Directories.ToHashSet(StringComparer.OrdinalIgnoreCase);
    foreach (var relativePath in plan.TreeEntries)
    {
      if (directories.Contains(relativePath))
      {
        AppendUtf8(hash, $"D\0{relativePath}\0");
      }
      else if (fileStates.TryGetValue(relativePath, out var file))
      {
        AppendUtf8(hash, $"F\0{relativePath}\0");
        AppendUtf8(hash, $"{file.Length}\0{file.Sha256}\0");
      }
      else
      {
        throw new HostPolicyException("archive_tree_plan_invalid");
      }
    }
    return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
  }

  private static void AppendUtf8(IncrementalHash hash, string value)
  {
    var bytes = Encoding.UTF8.GetBytes(value);
    hash.AppendData(bytes);
  }

  private static int PathDepth(string path) =>
    path.Count(character => character == Path.DirectorySeparatorChar);

  private static void DisposePartial(
    ValidatedPathHandle? stagingRoot,
    IEnumerable<ValidatedPathHandle> directories,
    IEnumerable<ExtractedArchiveFile> files)
  {
    foreach (var file in files.Reverse())
    {
      file.Stream.Dispose();
    }
    foreach (var directory in directories.Reverse())
    {
      directory.Dispose();
    }
    stagingRoot?.Dispose();
  }
}

internal sealed class ArchiveCrc32
{
  private static readonly uint[] Table = BuildTable();
  private uint _value = uint.MaxValue;

  public uint Value => _value ^ uint.MaxValue;

  public void Append(ReadOnlySpan<byte> bytes)
  {
    foreach (var value in bytes)
    {
      _value = Table[(byte)(_value ^ value)] ^ (_value >> 8);
    }
  }

  private static uint[] BuildTable()
  {
    var table = new uint[256];
    for (uint index = 0; index < table.Length; index++)
    {
      var value = index;
      for (var bit = 0; bit < 8; bit++)
      {
        value = (value & 1) != 0 ? 0xedb88320 ^ (value >> 1) : value >> 1;
      }
      table[index] = value;
    }
    return table;
  }
}

internal static partial class ArchiveCreatedFileGuard
{
  private const uint FileAttributeDirectory = 0x00000010;
  private const uint FileAttributeReparsePoint = 0x00000400;

  public static void EnsureExact(
    SafeFileHandle handle,
    string expectedPath,
    uint? expectedVolume,
    long expectedLength)
  {
    if (handle.IsInvalid
      || !GetFileInformationByHandle(handle, out var information))
    {
      throw new HostPolicyException("archive_created_file_identity_invalid");
    }
    if ((information.FileAttributes & (FileAttributeDirectory | FileAttributeReparsePoint)) != 0
      || information.NumberOfLinks != 1
      || (expectedVolume.HasValue
        && information.VolumeSerialNumber != expectedVolume.Value)
      || RandomAccess.GetLength(handle) != expectedLength)
    {
      throw new HostPolicyException("archive_created_file_identity_invalid");
    }
    var finalPath = GetFinalPath(handle);
    if (!string.Equals(
      Path.TrimEndingDirectorySeparator(finalPath),
      Path.TrimEndingDirectorySeparator(Path.GetFullPath(expectedPath)),
      StringComparison.OrdinalIgnoreCase))
    {
      throw new HostPolicyException("archive_created_file_identity_invalid");
    }
  }

  private static string GetFinalPath(SafeFileHandle handle)
  {
    var capacity = 512;
    while (capacity <= 32_768)
    {
      var buffer = new char[capacity];
      uint length;
      unsafe
      {
        fixed (char* pointer = buffer)
        {
          length = GetFinalPathNameByHandle(handle, pointer, (uint)buffer.Length, 0);
        }
      }
      if (length == 0)
      {
        throw new HostPolicyException("archive_created_file_identity_invalid");
      }
      if (length < buffer.Length)
      {
        var result = new string(buffer, 0, checked((int)length));
        return result.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)
          ? @"\\" + result[8..]
          : result.StartsWith(@"\\?\", StringComparison.Ordinal)
            ? result[4..]
            : result;
      }
      capacity = checked((int)length + 1);
    }
    throw new HostPolicyException("archive_created_file_identity_invalid");
  }

  [LibraryImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool GetFileInformationByHandle(
    SafeFileHandle file,
    out ByHandleFileInformation fileInformation);

  [LibraryImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW",
    SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
  private static unsafe partial uint GetFinalPathNameByHandle(
    SafeFileHandle file,
    char* filePath,
    uint filePathLength,
    uint flags);

  [StructLayout(LayoutKind.Sequential)]
  private struct ByHandleFileInformation
  {
    public uint FileAttributes;
    public uint CreationTimeLow;
    public uint CreationTimeHigh;
    public uint LastAccessTimeLow;
    public uint LastAccessTimeHigh;
    public uint LastWriteTimeLow;
    public uint LastWriteTimeHigh;
    public uint VolumeSerialNumber;
    public uint FileSizeHigh;
    public uint FileSizeLow;
    public uint NumberOfLinks;
    public uint FileIndexHigh;
    public uint FileIndexLow;
  }
}
