namespace Itemba.Msaidizi.AuditSigner.Contracts;

public sealed record AuditCheckpointHead(
  string Cursor,
  string EventHash,
  string ManifestSha256);

public sealed record UnsignedAuditEvent(
  string Cursor,
  int IntegrityVersion,
  string PreviousHash,
  string EventHash,
  string CanonicalMaterial);

public sealed record AuditSegmentResponse(
  AuditCheckpointHead CheckpointHead,
  IReadOnlyList<UnsignedAuditEvent> Events,
  bool HasMore,
  int MaxCheckpointTtlSeconds,
  string SignerKeyId);

public sealed record FetchAuditSegmentRequest(
  string AfterCursor,
  string AfterEventHash,
  string LastCheckpointSha256,
  int Limit);

public sealed record AuditCheckpointManifest(
  int SchemaVersion,
  string CheckpointId,
  string SignerKeyId,
  string PreviousCheckpointSha256,
  string FromCursor,
  string ToCursor,
  string PreviousEventHash,
  string EventHeadHash,
  int EventCount,
  string CanonicalSegmentSha256,
  string IssuedAt,
  string ExpiresAt);

public sealed record SignedAuditCheckpoint(
  AuditCheckpointManifest Manifest,
  string ManifestJson,
  string ManifestSha256,
  string Signature);

public sealed record SubmitAuditCheckpointRequest(
  string ManifestJson,
  string ManifestSha256,
  string Signature);

public sealed record AuditCheckpointReceipt(
  bool Accepted,
  bool Replay,
  string CheckpointId);
