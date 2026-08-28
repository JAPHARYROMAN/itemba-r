using System.Net.Http.Json;
using System.Text.Json;
using Itemba.Msaidizi.RecoverySupervisor.Contracts;

namespace Itemba.Msaidizi.RecoverySupervisor.Channel;

public interface IRecoveryBrokerClient
{
  Task EnrollAsync(
    string deviceId,
    string enrollmentId,
    string enrollmentCode,
    CancellationToken cancellationToken);
  Task<SignedRecoveryCommand?> PollAsync(string deviceId, CancellationToken cancellationToken);
  Task ReportProgressAsync(RecoveryProgress progress, CancellationToken cancellationToken);
  Task ReportResultAsync(RecoveryExecutionResult result, CancellationToken cancellationToken);
}

public sealed class RecoveryBrokerClient(HttpClient client) : IRecoveryBrokerClient
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
      new { deviceId, enrollmentId, role = "RECOVERY", enrollmentCode },
      Json,
      cancellationToken).ConfigureAwait(false);
    response.EnsureSuccessStatusCode();
  }

  public async Task<SignedRecoveryCommand?> PollAsync(
    string deviceId,
    CancellationToken cancellationToken)
  {
    using var response = await client.PostAsJsonAsync(
      "msaidizi/recovery-supervisor/channel/poll",
      new { deviceId },
      Json,
      cancellationToken).ConfigureAwait(false);
    response.EnsureSuccessStatusCode();
    var body = await response.Content.ReadFromJsonAsync<PollResponse>(
      Json,
      cancellationToken).ConfigureAwait(false);
    if (body?.RecoveryId is null) return null;
    return new SignedRecoveryCommand(
      body.RecoveryId,
      body.ManifestJson ?? throw new InvalidDataException("Broker omitted recovery manifest bytes."),
      body.ManifestSha256 ?? throw new InvalidDataException("Broker omitted recovery manifest digest."),
      body.Signature ?? throw new InvalidDataException("Broker omitted recovery manifest signature."),
      body.SigningKeyId ?? throw new InvalidDataException("Broker omitted recovery signing key id."));
  }

  public async Task ReportProgressAsync(
    RecoveryProgress progress,
    CancellationToken cancellationToken)
  {
    using var response = await client.PostAsJsonAsync(
      "msaidizi/recovery-supervisor/channel/progress",
      progress,
      Json,
      cancellationToken).ConfigureAwait(false);
    response.EnsureSuccessStatusCode();
  }

  public async Task ReportResultAsync(
    RecoveryExecutionResult result,
    CancellationToken cancellationToken)
  {
    using var response = await client.PostAsJsonAsync(
      "msaidizi/recovery-supervisor/channel/result",
      result,
      Json,
      cancellationToken).ConfigureAwait(false);
    response.EnsureSuccessStatusCode();
  }

  private sealed record PollResponse(
    string? RecoveryId,
    string? ManifestJson,
    string? ManifestSha256,
    string? Signature,
    string? SigningKeyId);
}
