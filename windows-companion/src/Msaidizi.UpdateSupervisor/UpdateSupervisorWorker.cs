using System.Security.Cryptography;
using System.Text.Json;
using Itemba.Msaidizi.UpdateSupervisor.Channel;
using Itemba.Msaidizi.UpdateSupervisor.Configuration;
using Itemba.Msaidizi.UpdateSupervisor.Contracts;
using Itemba.Msaidizi.UpdateSupervisor.Execution;
using Itemba.Msaidizi.UpdateSupervisor.Security;

namespace Itemba.Msaidizi.UpdateSupervisor;

public sealed partial class UpdateSupervisorWorker(
  UpdateSupervisorOptions options,
  TrustedUpdateEngine engine,
  IUpdateBrokerClient broker,
  ManifestVerifier verifier,
  IUpdateOutbox outbox,
  IPendingUpdateCommandStore pendingCommands,
  ILogger<UpdateSupervisorWorker> logger) : BackgroundService
{
  private static readonly JsonSerializerOptions OutboxJson = new(JsonSerializerDefaults.Web);
  private readonly UpdateSupervisorOptions _options = options.Expand();

  protected override async Task ExecuteAsync(CancellationToken stoppingToken)
  {
    if (!string.IsNullOrWhiteSpace(_options.EnrollmentId) &&
        !string.IsNullOrWhiteSpace(_options.EnrollmentCode))
    {
      await broker.EnrollAsync(
        _options.DeviceId,
        _options.EnrollmentId,
        _options.EnrollmentCode,
        stoppingToken);
    }

    foreach (var recovered in await engine.RecoverAsync(stoppingToken))
    {
      await QueueResultAsync(recovered, stoppingToken);
    }
    await TryDrainOutboxAsync(stoppingToken);
    await ProcessPendingCommandsAsync(stoppingToken);

    while (!stoppingToken.IsCancellationRequested)
    {
      try
      {
        await TryDrainOutboxAsync(stoppingToken);
        await ProcessPendingCommandsAsync(stoppingToken);
        if (File.Exists(_options.KillSwitchPath))
        {
          await Task.Delay(
            TimeSpan.FromSeconds(Math.Clamp(_options.PollIntervalSeconds, 2, 300)), stoppingToken);
          continue;
        }
        var command = await broker.PollAsync(_options.DeviceId, stoppingToken);
        if (command is not null)
        {
          var manifest = verifier.Verify(command);
          var adoption = pendingCommands.Put(command, manifest);
          if (adoption.SupersededManifestSha256 is not null)
            outbox.DiscardDeliveryAttempt(adoption.SupersededManifestSha256);
          await ProcessPendingCommandsAsync(stoppingToken);
        }
      }
      catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
      {
        break;
      }
      catch (Exception error)
      {
        LogIterationFailure(logger, error);
      }
      await Task.Delay(TimeSpan.FromSeconds(Math.Clamp(_options.PollIntervalSeconds, 2, 300)),
        stoppingToken);
    }

    async Task ProcessPendingCommandsAsync(CancellationToken cancellationToken)
    {
      foreach (var command in pendingCommands.ReadAll())
      {
        try
        {
          var result = await engine.ExecuteAsync(
            command,
            DeliverAcknowledgementAsync,
            QueueProgressAsync,
            cancellationToken);
          await QueueResultAsync(result, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
          throw;
        }
        catch (Exception error) when (error is CryptographicException or InvalidDataException)
        {
          pendingCommands.RemoveDeployment(command.DeploymentId);
          outbox.DiscardDeliveryAttempt(command.ManifestSha256);
          LogInvalidPendingCommand(logger, error, command.DeploymentId);
        }
        catch (Exception error)
        {
          LogPendingCommandDeferred(logger, error, command.DeploymentId);
        }
      }
    }

    async Task DeliverAcknowledgementAsync(
      UpdateDeliveryAcknowledgement acknowledgement,
      CancellationToken cancellationToken)
    {
      var id = $"ACK:{acknowledgement.DeploymentId}:{acknowledgement.DeliveryLeaseId}:" +
        acknowledgement.ManifestSha256;
      outbox.Enqueue(
        id,
        "ACK",
        JsonSerializer.Serialize(acknowledgement, OutboxJson));
      await outbox.TryDrainAsync(SendOutboxRecordAsync, cancellationToken);
      if (outbox.Contains(id))
        throw new HttpRequestException(
          "The durable delivery acknowledgement has not been accepted by the broker.");
    }

    async Task QueueProgressAsync(UpdateProgress progress, CancellationToken cancellationToken)
    {
      var id = $"PROGRESS:{progress.DeploymentId}:{progress.DeliveryLeaseId}:" +
        $"{progress.ManifestSha256}:{progress.Status}:{progress.JournalHeadSha256}";
      outbox.Enqueue(
        id,
        "PROGRESS",
        JsonSerializer.Serialize(progress, OutboxJson));
      await outbox.TryDrainAsync(SendOutboxRecordAsync, cancellationToken);
      if (outbox.Contains(id) && progress.Status is ("APPLYING" or "HEALTH_CHECK"))
        throw new HttpRequestException(
          $"The durable {progress.Status} fence has not been accepted by the broker.");
    }

    async Task QueueResultAsync(
      UpdateExecutionResult result,
      CancellationToken cancellationToken)
    {
      result = result with { Reason = UpdateTerminalReason.Normalize(result.Reason) };
      // Terminal evidence supersedes delivery/progress records for this exact
      // attempt. In particular, a KILLED broker may reject HEALTH_CHECK while
      // still accepting the terminal reconciliation result.
      outbox.DiscardDeliveryAttempt(result.ManifestSha256);
      outbox.Enqueue(
        $"RESULT:{result.DeploymentId}:{result.ManifestSha256}:{result.JournalHeadSha256}",
        "RESULT",
        JsonSerializer.Serialize(result, OutboxJson));
      pendingCommands.RemoveDeployment(result.DeploymentId);
      await TryDrainOutboxAsync(cancellationToken);
    }

    async Task TryDrainOutboxAsync(CancellationToken cancellationToken)
    {
      if (!await outbox.TryDrainAsync(SendOutboxRecordAsync, cancellationToken))
        LogOutboxDeferred(logger, outbox.PendingCount);
    }

    async Task SendOutboxRecordAsync(
      UpdateOutboxRecord record,
      CancellationToken cancellationToken)
    {
      switch (record.Kind)
      {
        case "ACK":
          await broker.AcknowledgeDeliveryAsync(
            Deserialize<UpdateDeliveryAcknowledgement>(record), cancellationToken);
          break;
        case "PROGRESS":
          await broker.ReportProgressAsync(
            Deserialize<UpdateProgress>(record), cancellationToken);
          break;
        case "RESULT":
          await broker.ReportResultAsync(
            Deserialize<UpdateExecutionResult>(record), cancellationToken);
          break;
        default:
          throw new InvalidDataException("The update outbox kind is invalid.");
      }
    }
  }

  private static T Deserialize<T>(UpdateOutboxRecord record) =>
    JsonSerializer.Deserialize<T>(record.PayloadJson, OutboxJson)
    ?? throw new InvalidDataException("The update outbox payload is empty.");

  [LoggerMessage(EventId = 7103, Level = LogLevel.Warning,
    Message = "Pending update command {DeploymentId} is deferred")]
  private static partial void LogPendingCommandDeferred(
    ILogger logger, Exception error, string deploymentId);

  [LoggerMessage(EventId = 7104, Level = LogLevel.Error,
    Message = "Invalid pending update command {DeploymentId} was discarded")]
  private static partial void LogInvalidPendingCommand(
    ILogger logger, Exception error, string deploymentId);

  [LoggerMessage(EventId = 7105, Level = LogLevel.Warning,
    Message = "Trusted update outbox has {PendingCount} record(s) awaiting broker reconciliation")]
  private static partial void LogOutboxDeferred(ILogger logger, int pendingCount);

  [LoggerMessage(EventId = 7102, Level = LogLevel.Error,
    Message = "Trusted update-supervisor iteration failed closed")]
  private static partial void LogIterationFailure(ILogger logger, Exception error);
}
