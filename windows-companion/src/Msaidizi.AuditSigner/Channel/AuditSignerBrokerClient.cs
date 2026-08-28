using System.Net.Http.Json;
using System.Text.Json;
using Itemba.Msaidizi.AuditSigner.Contracts;
using Itemba.Msaidizi.AuditSigner.Journal;

namespace Itemba.Msaidizi.AuditSigner.Channel;

public interface IAuditSignerBrokerClient
{
  Task<AuditSegmentResponse> FetchSegmentAsync(
    AuditSignerHead head,
    int limit,
    CancellationToken cancellationToken);
  Task<AuditCheckpointReceipt> SubmitCheckpointAsync(
    SignedAuditCheckpoint checkpoint,
    CancellationToken cancellationToken);
}

public sealed class AuditSignerBrokerClient(HttpClient client) : IAuditSignerBrokerClient
{
  private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

  public async Task<AuditSegmentResponse> FetchSegmentAsync(
    AuditSignerHead head,
    int limit,
    CancellationToken cancellationToken)
  {
    using var response = await client.PostAsJsonAsync(
      "msaidizi/audit-signer/channel/segment",
      new FetchAuditSegmentRequest(
        head.Cursor,
        head.EventHash,
        head.ManifestSha256,
        limit),
      Json,
      cancellationToken).ConfigureAwait(false);
    response.EnsureSuccessStatusCode();
    return await response.Content.ReadFromJsonAsync<AuditSegmentResponse>(Json, cancellationToken)
      .ConfigureAwait(false)
      ?? throw new InvalidDataException("Broker returned an empty audit segment response.");
  }

  public async Task<AuditCheckpointReceipt> SubmitCheckpointAsync(
    SignedAuditCheckpoint checkpoint,
    CancellationToken cancellationToken)
  {
    using var response = await client.PostAsJsonAsync(
      "msaidizi/audit-signer/channel/checkpoint",
      new SubmitAuditCheckpointRequest(
        checkpoint.ManifestJson,
        checkpoint.ManifestSha256,
        checkpoint.Signature),
      Json,
      cancellationToken).ConfigureAwait(false);
    response.EnsureSuccessStatusCode();
    return await response.Content.ReadFromJsonAsync<AuditCheckpointReceipt>(Json, cancellationToken)
      .ConfigureAwait(false)
      ?? throw new InvalidDataException("Broker returned an empty audit checkpoint receipt.");
  }
}
