using System.Collections.Concurrent;
using System.Reflection;
using Itemba.Msaidizi.Companion.Contracts.Channel;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Journal;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Channel;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Execution;
using Itemba.Msaidizi.Companion.Service.Journal;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service;

public sealed class CompanionWorker(
  IOptions<CompanionOptions> options,
  IActionJournal journal,
  CapabilityRegistry capabilities,
  ITrustedRootGuard trustedRoot,
  IOutboundCompanionChannel channel,
  IJournalReconciliationGate reconciliationGate,
  CapabilityManifestPublisher manifestPublisher,
  ActionExecutionCoordinator coordinator,
  IHostApplicationLifetime applicationLifetime,
  ILogger<CompanionWorker> logger) : BackgroundService
{
  private static readonly Action<ILogger, Exception?> LogUnknownBrokerCommand =
    LoggerMessage.Define(
      LogLevel.Warning,
      new EventId(1100, nameof(LogUnknownBrokerCommand)),
      "Ignored an unknown broker command type.");

  private static readonly Action<ILogger, string, Exception?> LogActionAlreadyDispatched =
    LoggerMessage.Define<string>(
      LogLevel.Warning,
      new EventId(1101, nameof(LogActionAlreadyDispatched)),
      "Action {ActionId} is already dispatched in this process.");

  private static readonly Action<ILogger, string, string, Exception?> LogCoordinatorFailure =
    LoggerMessage.Define<string, string>(
      LogLevel.Error,
      new EventId(1102, nameof(LogCoordinatorFailure)),
      "Action coordinator failed for {ActionId} with {ExceptionType}.");

  private static readonly Action<ILogger, string, string, Exception?> LogFenceFailure =
    LoggerMessage.Define<string, string>(
      LogLevel.Error,
      new EventId(1105, nameof(LogFenceFailure)),
      "Action fence {FenceId} failed with {ExceptionType}.");

  private static readonly Action<ILogger, string, Exception?> LogHeartbeatSendFailure =
    LoggerMessage.Define<string>(
      LogLevel.Warning,
      new EventId(1104, nameof(LogHeartbeatSendFailure)),
      "Could not send a companion heartbeat; transport raised {ExceptionType}.");

  private readonly ConcurrentDictionary<string, Task> _actionTasks = new(StringComparer.Ordinal);
  private readonly ConcurrentDictionary<string, Task> _fenceTasks = new(StringComparer.Ordinal);

  protected override async Task ExecuteAsync(CancellationToken stoppingToken)
  {
    await journal.InitializeAsync(stoppingToken).ConfigureAwait(false);
    var integrity = await journal.VerifyAsync(stoppingToken).ConfigureAwait(false);
    if (!integrity.IsValid)
    {
      throw new InvalidDataException(
        $"Action journal verification failed at sequence {integrity.InvalidSequence}: {integrity.ErrorCode}.");
    }

    await channel.ConnectAsync(stoppingToken).ConfigureAwait(false);
    // Broker intake is forbidden until the central ledger has acknowledged
    // the exact verified local head. An unavailable or disagreeing ACK fails
    // service startup without modifying either history.
    if (channel.State != OutboundChannelState.Disabled)
    {
      await reconciliationGate.ReconcileExactHeadAsync(stoppingToken).ConfigureAwait(false);
    }
    var acknowledgedManifestSha256 = await manifestPublisher
      .PublishUntilAcknowledgedAsync(stoppingToken).ConfigureAwait(false);
    var manifestTask = manifestPublisher.PublishChangesAsync(
      acknowledgedManifestSha256,
      stoppingToken);
    var heartbeatTask = RunHeartbeatLoopAsync(stoppingToken);

    try
    {
      await foreach (var command in channel.ReadCommandsAsync(stoppingToken).ConfigureAwait(false))
      {
        switch (command)
        {
          case ExecuteActionCommand execute:
            await reconciliationGate.ReconcileExactHeadAsync(stoppingToken).ConfigureAwait(false);
            StartAction(execute.Action, replayResultOnly: false, stoppingToken);
            break;
          case ReplayResultCommand replay:
            await reconciliationGate.ReconcileExactHeadAsync(stoppingToken).ConfigureAwait(false);
            StartAction(replay.Action, replayResultOnly: true, stoppingToken);
            break;
          case FenceActionCommand fence:
            await reconciliationGate.ReconcileExactHeadAsync(stoppingToken).ConfigureAwait(false);
            StartFence(fence.Fence, stoppingToken);
            break;
          case CancelActionCommand cancel:
            coordinator.RequestCancellation(cancel.Request);
            break;
          case PingCommand _:
            // A prior action may have advanced the local journal after the
            // last ACK. Reconcile before advertising connectivity; failure
            // escapes the intake loop and stops further command handling.
            await reconciliationGate.ReconcileExactHeadAsync(stoppingToken).ConfigureAwait(false);
            await SendHeartbeatSafelyAsync(stoppingToken).ConfigureAwait(false);
            break;
          default:
            LogUnknownBrokerCommand(logger, null);
            break;
        }
      }
    }
    finally
    {
      try
      {
        await Task.WhenAll(
          _actionTasks.Values
            .Concat(_fenceTasks.Values)
            .Append(heartbeatTask)
            .Append(manifestTask))
          .ConfigureAwait(false);
      }
      catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
      {
        // Expected service shutdown.
      }
    }
  }

  private void StartAction(
    SignedActionRequest action,
    bool replayResultOnly,
    CancellationToken stoppingToken)
  {
    var start = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
    var task = RunRegisteredActionAsync(
      action,
      replayResultOnly,
      start.Task,
      stoppingToken);
    if (!_actionTasks.TryAdd(action.Request.ActionId, task))
    {
      LogActionAlreadyDispatched(logger, action.Request.ActionId, null);
      start.TrySetResult(false);
      return;
    }

    start.SetResult(true);
    _ = ObserveActionAsync(
      action.Request.ActionId,
      task,
      removeTrackedEntry: true,
      stoppingToken);
  }

  private async Task RunRegisteredActionAsync(
    SignedActionRequest action,
    bool replayResultOnly,
    Task<bool> start,
    CancellationToken stoppingToken)
  {
    if (!await start.ConfigureAwait(false)) return;
    if (replayResultOnly)
    {
      await coordinator.ReplayResultAsync(action, stoppingToken).ConfigureAwait(false);
    }
    else
    {
      await coordinator.ExecuteAsync(action, stoppingToken).ConfigureAwait(false);
    }
  }

  private void StartFence(
    SignedFenceActionRequest fence,
    CancellationToken stoppingToken)
  {
    var start = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
    var task = RunRegisteredFenceAsync(fence, start.Task, stoppingToken);
    if (!_fenceTasks.TryAdd(fence.Request.FenceId, task))
    {
      start.TrySetResult(false);
      return;
    }

    start.SetResult(true);
    _ = ObserveFenceAsync(fence.Request.FenceId, task, stoppingToken);
  }

  private async Task RunRegisteredFenceAsync(
    SignedFenceActionRequest fence,
    Task<bool> start,
    CancellationToken stoppingToken)
  {
    if (!await start.ConfigureAwait(false)) return;
    await coordinator.FenceAsync(fence, stoppingToken).ConfigureAwait(false);
  }

  private async Task ObserveFenceAsync(
    string fenceId,
    Task fenceTask,
    CancellationToken stoppingToken)
  {
    try
    {
      await fenceTask.ConfigureAwait(false);
      await reconciliationGate.ReconcileExactHeadAsync(stoppingToken).ConfigureAwait(false);
      _fenceTasks.TryRemove(fenceId, out _);
      await SendHeartbeatSafelyAsync(stoppingToken).ConfigureAwait(false);
    }
    catch (Exception exception)
    {
      LogFenceFailure(logger, fenceId, exception.GetType().Name, exception);
      applicationLifetime.StopApplication();
    }
    finally
    {
      _fenceTasks.TryRemove(fenceId, out _);
    }
  }

  private async Task ObserveActionAsync(
    string actionId,
    Task actionTask,
    bool removeTrackedEntry,
    CancellationToken stoppingToken)
  {
    try
    {
      await actionTask.ConfigureAwait(false);
      await reconciliationGate.ReconcileExactHeadAsync(stoppingToken).ConfigureAwait(false);
      if (removeTrackedEntry)
      {
        _actionTasks.TryRemove(actionId, out _);
      }
      await SendHeartbeatSafelyAsync(stoppingToken).ConfigureAwait(false);
    }
    catch (Exception exception)
    {
      LogCoordinatorFailure(logger, actionId, exception.GetType().Name, exception);
      applicationLifetime.StopApplication();
    }
    finally
    {
      if (removeTrackedEntry)
      {
        _actionTasks.TryRemove(actionId, out _);
      }
    }
  }

  private async Task RunHeartbeatLoopAsync(CancellationToken stoppingToken)
  {
    var interval = TimeSpan.FromSeconds(Math.Clamp(options.Value.HeartbeatSeconds, 5, 300));
    using var timer = new PeriodicTimer(interval);
    do
    {
      await SendHeartbeatSafelyAsync(stoppingToken).ConfigureAwait(false);
    }
    while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false));
  }

  private async Task SendHeartbeatSafelyAsync(CancellationToken cancellationToken)
  {
    try
    {
      var head = await journal.GetHeadAsync(cancellationToken).ConfigureAwait(false);
      var version = Assembly.GetExecutingAssembly()
        .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
        ?? "unknown";
      var capabilitySnapshot = capabilities.Snapshot();
      await channel.SendHeartbeatAsync(new CompanionHeartbeat(
        options.Value.DeviceId,
        Component: "local-system-service",
        ComponentVersion: version,
        ExecutionEnabled: options.Value.ExecutionEnabled,
        KillSwitchEngaged: trustedRoot.IsKillSwitchEngaged,
        CentralLedgerConnected: channel.IsCentralLedgerConnected
          && reconciliationGate.IsExactHeadReconciled(head),
        // Count the entire broker command lifetime, including durable terminal
        // replay/result delivery before and after capability execution.
        RunningActionCount: Math.Max(coordinator.RunningActionCount, _actionTasks.Count),
        JournalSequence: head.Sequence,
        JournalHeadHash: head.EntryHash,
        CapabilityManifestSha256: capabilitySnapshot.ManifestSha256,
        SentAt: DateTimeOffset.UtcNow), cancellationToken).ConfigureAwait(false);
    }
    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
    {
      throw;
    }
    catch (Exception exception)
    {
      LogHeartbeatSendFailure(logger, exception.GetType().Name, exception);
    }
  }
}
