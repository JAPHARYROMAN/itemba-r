using System.Buffers;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.AuditSigner.Configuration;
using Itemba.Msaidizi.AuditSigner.Contracts;
using Itemba.Msaidizi.AuditSigner.Journal;

namespace Itemba.Msaidizi.AuditSigner.Security;

public static class AuditSignerProtocol
{
  public const int SchemaVersion = 1;
  public static readonly string ZeroSha256 = new('0', 64);

  public static SignedAuditCheckpoint CreateCheckpoint(
    AuditSegmentResponse segment,
    AuditSignerHead localHead,
    AuditSignerOptions options,
    IAuditCheckpointSigner signer,
    DateTimeOffset now)
  {
    var events = ValidateSegment(segment, localHead, options);
    if (events.Count == 0)
      throw new InvalidOperationException("An empty audit segment cannot be signed.");
    var ttl = Math.Min(options.CheckpointTtlSeconds, segment.MaxCheckpointTtlSeconds);
    if (ttl is < 30 or > 3600)
      throw new InvalidDataException("Broker supplied an invalid checkpoint lifetime ceiling.");
    var issuedAt = CanonicalTimestamp(now);
    var expiresAt = CanonicalTimestamp(now.AddSeconds(ttl));
    var manifest = new AuditCheckpointManifest(
      SchemaVersion,
      Guid.NewGuid().ToString("D", CultureInfo.InvariantCulture),
      options.SignerKeyId,
      localHead.ManifestSha256,
      events[0].Cursor,
      events[^1].Cursor,
      localHead.EventHash,
      events[^1].EventHash,
      events.Count,
      SegmentSha256(events.Select(item => item.CanonicalMaterial)),
      issuedAt,
      expiresAt);
    var manifestJson = CanonicalManifestJson(manifest);
    var manifestBytes = Encoding.UTF8.GetBytes(manifestJson);
    var signatureBytes = signer.Sign(manifestBytes);
    if (signatureBytes.Length != 64)
      throw new CryptographicException("Audit signer did not emit canonical ES256 P1363 bytes.");
    return new SignedAuditCheckpoint(
      manifest,
      manifestJson,
      Sha256(manifestBytes),
      Base64Url(signatureBytes));
  }

  public static IReadOnlyList<UnsignedAuditEvent> ValidateSegment(
    AuditSegmentResponse segment,
    AuditSignerHead localHead,
    AuditSignerOptions options)
  {
    if (!string.Equals(segment.SignerKeyId, options.SignerKeyId, StringComparison.Ordinal) ||
        segment.Events.Count > options.MaxSegmentEvents ||
        segment.MaxCheckpointTtlSeconds is < 30 or > 3600 ||
        !string.Equals(segment.CheckpointHead.Cursor, localHead.Cursor, StringComparison.Ordinal) ||
        !FixedEquals(segment.CheckpointHead.EventHash, localHead.EventHash) ||
        !FixedEquals(segment.CheckpointHead.ManifestSha256, localHead.ManifestSha256))
      throw new InvalidDataException("Broker audit head conflicts with the protected local journal.");

    var previousCursor = ParseCursor(localHead.Cursor, allowZero: true);
    var previousHash = localHead.EventHash;
    foreach (var item in segment.Events)
    {
      var cursor = ParseCursor(item.Cursor, allowZero: false);
      if (item.IntegrityVersion != SchemaVersion ||
          cursor <= previousCursor ||
          !IsSha256(item.PreviousHash) ||
          !IsSha256(item.EventHash) ||
          !FixedEquals(item.PreviousHash, previousHash) ||
          !FixedEquals(Sha256(Encoding.UTF8.GetBytes(item.CanonicalMaterial)), item.EventHash))
        throw new InvalidDataException("Unsigned task-event canonical chain is invalid.");
      previousCursor = cursor;
      previousHash = item.EventHash;
    }
    return segment.Events;
  }

  public static string CanonicalManifestJson(AuditCheckpointManifest manifest)
  {
    var buffer = new ArrayBufferWriter<byte>();
    using var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions { Indented = false });
    writer.WriteStartObject();
    writer.WriteString("canonicalSegmentSha256", manifest.CanonicalSegmentSha256);
    writer.WriteString("checkpointId", manifest.CheckpointId);
    writer.WriteNumber("eventCount", manifest.EventCount);
    writer.WriteString("eventHeadHash", manifest.EventHeadHash);
    writer.WriteString("expiresAt", manifest.ExpiresAt);
    writer.WriteString("fromCursor", manifest.FromCursor);
    writer.WriteString("issuedAt", manifest.IssuedAt);
    writer.WriteString("previousCheckpointSha256", manifest.PreviousCheckpointSha256);
    writer.WriteString("previousEventHash", manifest.PreviousEventHash);
    writer.WriteNumber("schemaVersion", manifest.SchemaVersion);
    writer.WriteString("signerKeyId", manifest.SignerKeyId);
    writer.WriteString("toCursor", manifest.ToCursor);
    writer.WriteEndObject();
    writer.Flush();
    return Encoding.UTF8.GetString(buffer.WrittenSpan);
  }

  public static string SegmentSha256(IEnumerable<string> materials) =>
    Sha256(Encoding.UTF8.GetBytes(string.Join('\n', materials)));

  public static string Sha256(ReadOnlySpan<byte> value) =>
    Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();

  public static bool IsSha256(string value) =>
    value.Length == 64 && value.All(character =>
      character is >= '0' and <= '9' or >= 'a' and <= 'f');

  public static long ParseCursor(string value, bool allowZero)
  {
    if ((value.Length > 1 && value[0] == '0') ||
        !long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var cursor) ||
        cursor < (allowZero ? 0 : 1))
      throw new InvalidDataException("Audit cursor is not canonical.");
    return cursor;
  }

  public static string CanonicalTimestamp(DateTimeOffset value) =>
    value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

  private static bool FixedEquals(string left, string right)
  {
    if (!IsSha256(left) || !IsSha256(right)) return false;
    return CryptographicOperations.FixedTimeEquals(
      Encoding.ASCII.GetBytes(left),
      Encoding.ASCII.GetBytes(right));
  }

  private static string Base64Url(ReadOnlySpan<byte> value) =>
    Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
