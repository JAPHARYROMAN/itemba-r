using System.Net.Http.Json;
using System.Text.Json;
using Itemba.Msaidizi.UpdateSupervisor.Contracts;

namespace Itemba.Msaidizi.UpdateSupervisor.Channel;

public interface IUpdateBrokerClient
{
  Task EnrollAsync(
    string deviceId,
    string enrollmentId,
    string enrollmentCode,
    CancellationToken cancellationToken);
  Task<SignedUpdateCommand?> PollAsync(string deviceId, CancellationToken cancellationToken);
  Task AcknowledgeDeliveryAsync(
    UpdateDeliveryAcknowledgement acknowledgement,
    CancellationToken cancellationToken);
  Task ReportProgressAsync(UpdateProgress progress, CancellationToken cancellationToken);
  Task ReportResultAsync(UpdateExecutionResult result, CancellationToken cancellationToken);
}

public sealed class UpdateBrokerClient(HttpClient client) : IUpdateBrokerClient
{
  private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

  public async Task EnrollAsync(
    string deviceId,
    string enrollmentId,
    string enrollmentCode,
    CancellationToken cancellationToken)
  {
    using var response = await client.PostAsJsonAsync(
      "msaidizi/devices/supervisor-enrollment/complete",
      new { deviceId, enrollmentId, role = "UPDATE", enrollmentCode },
      Json,
      cancellationToken);
    response.EnsureSuccessStatusCode();
  }

  public async Task<SignedUpdateCommand?> PollAsync(
    string deviceId,
    CancellationToken cancellationToken)
  {
    using var response = await client.PostAsJsonAsync(
      "msaidizi/update-supervisor/channel/poll", new { deviceId }, Json, cancellationToken);
    response.EnsureSuccessStatusCode();
    var body = await response.Content.ReadFromJsonAsync<PollResponse>(Json, cancellationToken);
    if (body?.DeploymentId is null) return null;
    return new SignedUpdateCommand(
      body.DeploymentId,
      body.DeliveryLeaseId ?? throw new InvalidDataException("Broker omitted delivery lease ID."),
      body.ManifestJson ?? throw new InvalidDataException("Broker omitted manifest bytes."),
      body.ManifestSha256 ?? throw new InvalidDataException("Broker omitted manifest digest."),
      body.Signature ?? throw new InvalidDataException("Broker omitted manifest signature."),
      body.SigningKeyId ?? throw new InvalidDataException("Broker omitted signing key id."));
  }

  public async Task AcknowledgeDeliveryAsync(
    UpdateDeliveryAcknowledgement acknowledgement,
    CancellationToken cancellationToken)
  {
    using var response = await client.PostAsJsonAsync(
      "msaidizi/update-supervisor/channel/ack", acknowledgement, Json, cancellationToken);
    response.EnsureSuccessStatusCode();
  }

  public async Task ReportProgressAsync(UpdateProgress progress, CancellationToken cancellationToken)
  {
    using var response = await client.PostAsJsonAsync(
      "msaidizi/update-supervisor/channel/progress", progress, Json, cancellationToken);
    response.EnsureSuccessStatusCode();
  }

  public async Task ReportResultAsync(UpdateExecutionResult result, CancellationToken cancellationToken)
  {
    result = result with { Reason = UpdateTerminalReason.Normalize(result.Reason) };
    using var response = await client.PostAsJsonAsync(
      "msaidizi/update-supervisor/channel/result", result, Json, cancellationToken);
    response.EnsureSuccessStatusCode();
  }

  private sealed record PollResponse(
    string? DeploymentId,
    string? DeliveryLeaseId,
    string? ManifestJson,
    string? ManifestSha256,
    string? Signature,
    string? SigningKeyId);
}
