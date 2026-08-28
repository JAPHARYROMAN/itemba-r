using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.UpdateEvaluator.Contracts;
using Itemba.Msaidizi.UpdateEvaluator.Protocol;

namespace Itemba.Msaidizi.UpdateEvaluator.Channel;

public sealed record GenerationArtifactPayload(
  byte[] Content,
  string Sha256,
  long BytesReadFloor,
  long ExternalEgressBytesFloor);

public interface IEvaluationBrokerClient
{
  Task<EvaluationLease?> PollAsync(CancellationToken cancellationToken);
  Task StartAsync(EvaluationLease lease, CancellationToken cancellationToken);
  Task<EvaluationHeartbeatResponse> HeartbeatAsync(
    EvaluationLease lease,
    EvaluationUsageSnapshot usage,
    CancellationToken cancellationToken);
  Task<GenerationArtifactPayload> DownloadGenerationArtifactAsync(
    EvaluationLease lease,
    CancellationToken cancellationToken);
  Task UploadArtifactAsync(ArtifactDescriptor artifact, CancellationToken cancellationToken);
  Task<EvaluationRunResult> SubmitAsync(
    string candidateId,
    SignedAttestationEnvelope runner,
    IReadOnlyList<SignedAttestationEnvelope> reviews,
    CancellationToken cancellationToken);
}

public sealed class EvaluationBrokerClient(HttpClient client) : IEvaluationBrokerClient
{
  private const int MaximumJsonResponseBytes = 256 * 1024;
  private const int MaximumManifestBytes = 5 * 1024 * 1024;

  public async Task<EvaluationLease?> PollAsync(CancellationToken cancellationToken)
  {
    using var request = new HttpRequestMessage(HttpMethod.Post, "runs/poll")
    {
      Content = new StringContent("{}", Encoding.UTF8, "application/json"),
    };
    using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead,
      cancellationToken).ConfigureAwait(false);
    await EnsureSuccessAsync(response, cancellationToken).ConfigureAwait(false);
    var payload = await ReadJsonAsync<EvaluationPollResponse>(response, cancellationToken)
      .ConfigureAwait(false);
    return payload.Run;
  }

  public async Task StartAsync(EvaluationLease lease, CancellationToken cancellationToken)
  {
    using var response = await client.PostAsJsonAsync($"runs/{lease.Id}/start",
      new { leaseId = lease.LeaseId }, JsonDefaults.Options, cancellationToken).ConfigureAwait(false);
    await EnsureSuccessAsync(response, cancellationToken).ConfigureAwait(false);
  }

  public async Task<EvaluationHeartbeatResponse> HeartbeatAsync(
    EvaluationLease lease,
    EvaluationUsageSnapshot usage,
    CancellationToken cancellationToken)
  {
    using var response = await client.PostAsJsonAsync($"runs/{lease.Id}/heartbeat",
      EvaluationHeartbeatRequest.From(lease.LeaseId, usage), JsonDefaults.Options,
      cancellationToken).ConfigureAwait(false);
    await EnsureSuccessAsync(response, cancellationToken).ConfigureAwait(false);
    return await ReadJsonAsync<EvaluationHeartbeatResponse>(response, cancellationToken)
      .ConfigureAwait(false);
  }

  public async Task<GenerationArtifactPayload> DownloadGenerationArtifactAsync(
    EvaluationLease lease,
    CancellationToken cancellationToken)
  {
    using var request = new HttpRequestMessage(HttpMethod.Get,
      $"runs/{lease.Id}/generation-artifact");
    request.Headers.Add("X-Msaidizi-Evaluation-Lease", lease.LeaseId);
    using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead,
      cancellationToken).ConfigureAwait(false);
    await EnsureSuccessAsync(response, cancellationToken).ConfigureAwait(false);
    var contentLength = response.Content.Headers.ContentLength;
    if (contentLength is not long expectedLength ||
        expectedLength is <= 0 or > MaximumManifestBytes)
      throw new InvalidDataException("Evaluation generation artifact size is invalid.");
    var digest = Header(response, "X-Msaidizi-Artifact-Sha256");
    var readFloor = CanonicalLongHeader(response, "X-Msaidizi-Usage-Bytes-Read-Floor");
    var egressFloor = CanonicalLongHeader(response, "X-Msaidizi-Usage-Egress-Bytes-Floor");
    await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken)
      .ConfigureAwait(false);
    using var output = new MemoryStream((int)expectedLength);
    await stream.CopyToAsync(output, cancellationToken).ConfigureAwait(false);
    if (output.Length != expectedLength)
      throw new InvalidDataException("Evaluation generation artifact was truncated.");
    return new(output.ToArray(), digest, readFloor, egressFloor);
  }

  public async Task UploadArtifactAsync(
    ArtifactDescriptor artifact,
    CancellationToken cancellationToken)
  {
    await using var stream = new FileStream(artifact.Path, FileMode.Open, FileAccess.Read,
      FileShare.Read, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
    if (stream.Length != artifact.ByteSize)
      throw new InvalidDataException("Evaluation artifact changed before upload.");
    using var multipart = new MultipartFormDataContent();
    multipart.Add(new StringContent(artifact.Attestation.ClaimsJson, Encoding.UTF8), "claimsJson");
    multipart.Add(new StringContent(artifact.Attestation.Signature, Encoding.ASCII), "signature");
    var file = new StreamContent(stream, 64 * 1024);
    file.Headers.ContentType = new(artifact.MimeType);
    multipart.Add(file, "file", artifact.Name);
    using var response = await client.PostAsync("artifacts", multipart, cancellationToken)
      .ConfigureAwait(false);
    await EnsureSuccessAsync(response, cancellationToken).ConfigureAwait(false);
  }

  public async Task<EvaluationRunResult> SubmitAsync(
    string candidateId,
    SignedAttestationEnvelope runner,
    IReadOnlyList<SignedAttestationEnvelope> reviews,
    CancellationToken cancellationToken)
  {
    using var response = await client.PostAsJsonAsync($"candidates/{candidateId}/evaluation",
      new { runner, reviews }, JsonDefaults.Options, cancellationToken).ConfigureAwait(false);
    await EnsureSuccessAsync(response, cancellationToken).ConfigureAwait(false);
    return await ReadJsonAsync<EvaluationRunResult>(response, cancellationToken)
      .ConfigureAwait(false);
  }

  private static async Task<T> ReadJsonAsync<T>(
    HttpResponseMessage response,
    CancellationToken cancellationToken)
  {
    if (response.Content.Headers.ContentLength > MaximumJsonResponseBytes)
      throw new InvalidDataException("Evaluator broker JSON response exceeds its bound.");
    await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken)
      .ConfigureAwait(false);
    using var bounded = new MemoryStream();
    var buffer = new byte[16 * 1024];
    while (true)
    {
      var read = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
      if (read == 0) break;
      if (bounded.Length + read > MaximumJsonResponseBytes)
        throw new InvalidDataException("Evaluator broker JSON response exceeds its bound.");
      bounded.Write(buffer, 0, read);
    }
    bounded.Position = 0;
    return await JsonSerializer.DeserializeAsync<T>(bounded, JsonDefaults.Options,
      cancellationToken).ConfigureAwait(false)
      ?? throw new InvalidDataException("Evaluator broker response is empty.");
  }

  private static async Task EnsureSuccessAsync(
    HttpResponseMessage response,
    CancellationToken cancellationToken)
  {
    if (response.IsSuccessStatusCode) return;
    var body = await response.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var digest = EvaluatorSecurityDigest(body);
      throw new HttpRequestException(
        $"Evaluator broker rejected the request ({(int)response.StatusCode}, body sha256 {digest}).",
        null, response.StatusCode);
    }
    finally
    {
      Array.Clear(body);
    }
  }

  private static string Header(HttpResponseMessage response, string name) =>
    response.Headers.TryGetValues(name, out var values) && values.SingleOrDefault() is { } value
      ? value
      : throw new InvalidDataException($"Evaluator broker omitted {name}.");

  private static long CanonicalLongHeader(HttpResponseMessage response, string name)
  {
    var value = Header(response, name);
    if ((value != "0" && (value.Length == 0 || value[0] == '0')) ||
        !long.TryParse(value, out var parsed) || parsed < 0)
      throw new InvalidDataException($"Evaluator broker returned an invalid {name}.");
    return parsed;
  }

  private static string EvaluatorSecurityDigest(byte[] value) =>
    Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(value)).ToLowerInvariant();
}
