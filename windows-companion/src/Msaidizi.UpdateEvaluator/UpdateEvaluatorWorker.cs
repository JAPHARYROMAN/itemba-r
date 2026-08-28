using System.Security.Cryptography;
using Itemba.Msaidizi.UpdateEvaluator.Channel;
using Itemba.Msaidizi.UpdateEvaluator.Configuration;
using Itemba.Msaidizi.UpdateEvaluator.Evaluation;
using Itemba.Msaidizi.UpdateEvaluator.Protocol;
using Itemba.Msaidizi.UpdateEvaluator.State;

namespace Itemba.Msaidizi.UpdateEvaluator;

public sealed partial class UpdateEvaluatorWorker(
  UpdateEvaluatorOptions options,
  IEvaluationBrokerClient broker,
  UpdateEvaluationEngine engine,
  IEvaluationStateStore state,
  ILogger<UpdateEvaluatorWorker> logger) : BackgroundService
{
  protected override async Task ExecuteAsync(CancellationToken stoppingToken)
  {
    while (!stoppingToken.IsCancellationRequested)
    {
      try
      {
        foreach (var checkpoint in state.ReadPending())
        {
          try
          {
            await engine.ExecuteAsync(checkpoint.Lease, stoppingToken).ConfigureAwait(false);
          }
          catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
          {
            throw;
          }
          catch (Exception error)
          {
            var code = SafeFailureCode(error);
            LogRunDeferred(logger, checkpoint.Lease.Id, code);
            if (error is EvaluationAuthorityLostException ||
                error is HttpRequestException
                {
                  StatusCode: System.Net.HttpStatusCode.Conflict or
                  System.Net.HttpStatusCode.NotFound or System.Net.HttpStatusCode.ServiceUnavailable
                })
              state.Complete(checkpoint.Lease.Id, code);
          }
        }

        if (!File.Exists(options.KillSwitchPath))
        {
          var lease = await broker.PollAsync(stoppingToken).ConfigureAwait(false);
          if (lease is not null)
            await engine.ExecuteAsync(lease, stoppingToken).ConfigureAwait(false);
        }
      }
      catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
      {
        break;
      }
      catch (Exception error)
      {
        LogIterationDeferred(logger, SafeFailureCode(error));
      }
      await Task.Delay(TimeSpan.FromSeconds(options.PollIntervalSeconds), stoppingToken)
        .ConfigureAwait(false);
    }
  }

  private static string SafeFailureCode(Exception error) => error switch
  {
    EvaluationProtocolException protocol => protocol.Code,
    EvaluationAuthorityLostException authority => authority.Code,
    HttpRequestException => "EVALUATOR_BROKER_UNAVAILABLE",
    CryptographicException => "EVALUATOR_CRYPTOGRAPHIC_FAILURE",
    InvalidDataException => "EVALUATOR_EVIDENCE_INVALID",
    _ => "EVALUATOR_INTERNAL_FAILURE",
  };

  [LoggerMessage(EventId = 7501, Level = LogLevel.Warning,
    Message = "Update evaluation run {RunId} deferred with {FailureCode}")]
  private static partial void LogRunDeferred(ILogger logger, string runId, string failureCode);

  [LoggerMessage(EventId = 7502, Level = LogLevel.Warning,
    Message = "Update evaluator iteration deferred with {FailureCode}")]
  private static partial void LogIterationDeferred(ILogger logger, string failureCode);
}

public sealed partial class DisabledUpdateEvaluatorWorker(
  ILogger<DisabledUpdateEvaluatorWorker> logger) : BackgroundService
{
  protected override async Task ExecuteAsync(CancellationToken stoppingToken)
  {
    LogDisabled(logger);
    await Task.Delay(Timeout.InfiniteTimeSpan, stoppingToken).ConfigureAwait(false);
  }

  [LoggerMessage(EventId = 7500, Level = LogLevel.Information,
    Message = "Update evaluator is disabled until operator provisioning is complete")]
  private static partial void LogDisabled(ILogger logger);
}
