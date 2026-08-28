using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Agent.Channel;
using Itemba.Msaidizi.Companion.Agent.Capabilities;
using Itemba.Msaidizi.Companion.Agent.Configuration;
using Itemba.Msaidizi.Companion.Agent.Security;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Contracts.SessionBridge;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Agent;

public sealed class AgentWorker(
  IOptions<AgentOptions> options,
  IOptions<SessionBridgeOptions> sessionBridgeOptions,
  IEnumerable<IHostCapabilityAdapter> adapters,
  IAgentSessionChannel channel,
  SessionSecretAccessor secretAccessor,
  IStandardUserEgressVerifier egressVerifier,
  ILogger<AgentWorker> logger) : BackgroundService
{
  private static readonly Action<ILogger, string, Exception?> LogSessionFailure =
    LoggerMessage.Define<string>(
      LogLevel.Warning,
      new EventId(2100, nameof(LogSessionFailure)),
      "The authenticated session bridge disconnected with {ExceptionType}; reconnecting.");
  private static readonly Action<ILogger, string, string, Exception?> LogCapabilityFailure =
    LoggerMessage.Define<string, string>(
      LogLevel.Error,
      new EventId(2101, nameof(LogCapabilityFailure)),
      "Session capability {CapabilityId} failed with {ExceptionType}.");
  private readonly AgentOptions _options = options.Value;
  private readonly SessionBridgeOptions _sessionBridgeOptions = sessionBridgeOptions.Value;
  private readonly Dictionary<string, IHostCapabilityAdapter> _adapters = adapters
    .ToDictionary(
      adapter => Key(adapter.Descriptor.Id, adapter.Descriptor.Version),
      StringComparer.Ordinal);
  private readonly ConcurrentDictionary<string, RunningAction> _running =
    new(StringComparer.Ordinal);

  protected override async Task ExecuteAsync(CancellationToken stoppingToken)
  {
    ValidateAdapters();
    while (!stoppingToken.IsCancellationRequested)
    {
      try
      {
        await channel.ConnectAsync(stoppingToken).ConfigureAwait(false);
        var activation = channel.CapabilityBoundaryAttestation;
        var descriptors = StandardUserCapabilityCatalog.SelectEnabled(
            _sessionBridgeOptions.BrowserExternalEffectsEnabled,
            _sessionBridgeOptions.EmergencyCommandEnabled,
            activation)
          .OrderBy(descriptor => descriptor.Id, StringComparer.Ordinal)
          .ThenBy(descriptor => descriptor.Version, StringComparer.Ordinal)
          .ToArray();
        var enabled = descriptors
          .Select(descriptor => Key(descriptor.Id, descriptor.Version))
          .ToHashSet(StringComparer.Ordinal);
        var manifestHash = StandardUserCapabilityCatalog.ManifestSha256(descriptors);
        using var connection = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        var activationExpiry = activation?.SignedAttestation.Attestation
          .ExpiresAtUnixMilliseconds;
        if (activationExpiry is not null)
        {
          var remaining = DateTimeOffset.FromUnixTimeMilliseconds(activationExpiry.Value)
            - DateTimeOffset.UtcNow;
          if (remaining <= TimeSpan.Zero)
          {
            throw new CryptographicException(
              "Capability-boundary evidence expired before manifest publication.");
          }
          connection.CancelAfter(remaining);
        }
        var heartbeat = RunHeartbeatAsync(connection.Token);
        await channel.SendManifestAsync(new SessionAgentManifest(
          _options.DeviceId,
          CurrentSessionId(),
          manifestHash,
          descriptors,
          DateTimeOffset.UtcNow), stoppingToken).ConfigureAwait(false);
        try
        {
          await foreach (var command in channel.ReadCommandsAsync(connection.Token)
            .ConfigureAwait(false))
          {
            if (command.Cancel is not null)
            {
              Cancel(command.Cancel);
            }
            else if (command.Execute is not null)
            {
              Start(
                command.Execute,
                command.ResolvedSecrets,
                enabled,
                activation,
                connection.Token);
            }
          }
        }
        finally
        {
          await connection.CancelAsync().ConfigureAwait(false);
          await ObserveAsync(heartbeat).ConfigureAwait(false);
          CancelAll();
        }
      }
      catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
      {
        break;
      }
      catch (Exception exception)
      {
        LogSessionFailure(logger, exception.GetType().Name, exception);
      }

      try
      {
        await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken).ConfigureAwait(false);
      }
      catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
      {
        break;
      }
    }

    CancelAll();
    await Task.WhenAll(_running.Values.Select(action => ObserveAsync(action.Task)))
      .ConfigureAwait(false);
  }

  private void Start(
    SessionActionInvocation invocation,
    IReadOnlyList<SessionResolvedSecret> resolvedSecrets,
    HashSet<string> enabledCapabilities,
    VerifiedCapabilityBoundaryAttestation? activation,
    CancellationToken stoppingToken)
  {
    if (!enabledCapabilities.Contains(Key(
          invocation.CapabilityId,
          invocation.CapabilityVersion))
      || (StandardUserCapabilityCatalog.RequiresEgressBoundary(invocation.CapabilityId)
        && (activation is null || !activation.IsFresh(DateTimeOffset.UtcNow))))
    {
      DisposeSecrets(resolvedSecrets);
      _ = ObserveAsync(channel.SendCompletionAsync(new SessionActionCompletion(
        invocation.Context.ActionId,
        invocation.Context.TaskId,
        invocation.Context.StepId,
        ActionOutcome.Rejected,
        null,
        "session_capability_boundary_unavailable"), CancellationToken.None).AsTask());
      return;
    }

    var cancellation = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
    var running = new RunningAction(invocation.Context.TaskId, cancellation);
    if (!_running.TryAdd(invocation.Context.ActionId, running))
    {
      cancellation.Dispose();
      DisposeSecrets(resolvedSecrets);
      _ = ObserveAsync(channel.SendCompletionAsync(new SessionActionCompletion(
        invocation.Context.ActionId,
        invocation.Context.TaskId,
        invocation.Context.StepId,
        ActionOutcome.AlreadyRunning,
        null,
        "session_action_already_running"), CancellationToken.None).AsTask());
      return;
    }

    running.Task = ExecuteAsync(invocation, resolvedSecrets, cancellation.Token);
    _ = running.Task.ContinueWith(
      completedTask =>
      {
        _running.TryRemove(invocation.Context.ActionId, out _);
        _ = completedTask.Exception;
        cancellation.Dispose();
        DisposeSecrets(resolvedSecrets);
      },
      CancellationToken.None,
      TaskContinuationOptions.ExecuteSynchronously,
      TaskScheduler.Default);
  }

  private void Cancel(SessionCancelInvocation request)
  {
    if (_running.TryGetValue(request.ActionId, out var running)
      && string.Equals(running.TaskId, request.TaskId, StringComparison.Ordinal))
    {
      running.Cancellation.Cancel();
    }
  }

  private async Task ExecuteAsync(
    SessionActionInvocation invocation,
    IReadOnlyList<SessionResolvedSecret> resolvedSecrets,
    CancellationToken cancellationToken)
  {
    var context = invocation.Context;
    IHostCapabilityAdapter? adapter = null;
    try
    {
      if (!_options.ExecutionEnabled
        || File.Exists(Environment.ExpandEnvironmentVariables(_options.KillSwitchPath)))
      {
        await SendFailureAsync(invocation, ActionOutcome.Rejected, "session_execution_disabled")
          .ConfigureAwait(false);
        return;
      }

      if (invocation.ExpiresAt <= DateTimeOffset.UtcNow
        || invocation.ExpiresAt > DateTimeOffset.UtcNow.AddMinutes(16)
        || !string.Equals(context.DeviceId, _options.DeviceId, StringComparison.Ordinal)
        || context.Budgets.MaxWallTimeSeconds is <= 0
        || context.Budgets.MaxWallTimeSeconds > _options.MaximumActionWallTimeSeconds
        || context.Budgets.MaxLocalBytes < 0
        || context.Budgets.MaxLocalBytes > _options.MaximumActionBytes
        || context.Budgets.MaxExternalEgressBytes < 0
        || context.Budgets.MaxExternalEgressBytes > _options.MaximumActionBytes)
      {
        await SendFailureAsync(invocation, ActionOutcome.Rejected, "session_action_policy_invalid")
          .ConfigureAwait(false);
        return;
      }

      if (!_adapters.TryGetValue(
        Key(invocation.CapabilityId, invocation.CapabilityVersion),
        out adapter)
        || adapter.Descriptor.RequiredPrivilege != RequiredPrivilege.StandardUser)
      {
        await SendFailureAsync(invocation, ActionOutcome.Rejected, "session_capability_unavailable")
          .ConfigureAwait(false);
        return;
      }

      var egressAuthorizationError = egressVerifier.ValidateAuthorization(
        context,
        invocation.CapabilityId,
        invocation.CapabilityVersion);
      if (egressAuthorizationError is not null)
      {
        await SendFailureAsync(
          invocation,
          ActionOutcome.NeedsAttention,
          egressAuthorizationError).ConfigureAwait(false);
        return;
      }

      using var arguments = JsonDocument.Parse(invocation.ArgumentsJson, new JsonDocumentOptions
      {
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = 32,
      });
      var argumentValidation = adapter.ValidateArguments(arguments.RootElement);
      if (!argumentValidation.IsValid)
      {
        await SendFailureAsync(
          invocation,
          ActionOutcome.Rejected,
          argumentValidation.ErrorCode ?? "arguments_schema_invalid").ConfigureAwait(false);
        return;
      }

      using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
      deadline.CancelAfter(TimeSpan.FromSeconds(context.Budgets.MaxWallTimeSeconds));
      using var secretScope = secretAccessor.Open(context.ActionId, resolvedSecrets);
      var result = await adapter.ExecuteAsync(
          context,
          arguments.RootElement,
          deadline.Token)
        .ConfigureAwait(false);
      if (!IsExecutionResultValid(adapter, context, result))
      {
        await SendMeasuredFailureAsync(
          invocation,
          result,
          "session_capability_result_policy_invalid").ConfigureAwait(false);
        return;
      }

      JsonDocument output;
      try
      {
        output = JsonDocument.Parse(result.OutputJson, new JsonDocumentOptions
        {
          AllowTrailingCommas = false,
          CommentHandling = JsonCommentHandling.Disallow,
          MaxDepth = 32,
        });
      }
      catch (JsonException)
      {
        await SendMeasuredFailureAsync(
          invocation,
          result,
          "session_result_json_invalid").ConfigureAwait(false);
        return;
      }
      using (output)
      {
        var resultValidation = adapter.ValidateResult(output.RootElement);
        if (!resultValidation.IsValid)
        {
          await SendMeasuredFailureAsync(
            invocation,
            result,
            resultValidation.ErrorCode ?? "result_schema_invalid").ConfigureAwait(false);
          return;
        }
      }

      await channel.SendCompletionAsync(new SessionActionCompletion(
        context.ActionId,
        context.TaskId,
        context.StepId,
        result.OutcomeUncertain ? ActionOutcome.NeedsAttention : ActionOutcome.Completed,
        result,
        null), CancellationToken.None).ConfigureAwait(false);
    }
    catch (MeasuredCapabilityFailureException exception)
    {
      // Do not attach the originating exception: a device/recognizer failure
      // must never make captured speech or recognizer internals log-visible.
      LogCapabilityFailure(
        logger,
        invocation.CapabilityId,
        nameof(MeasuredCapabilityFailureException),
        null);
      await SendMeasuredFailureAsync(
        invocation,
        exception.Measurement,
        exception.ErrorCode).ConfigureAwait(false);
    }
    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
    {
      await SendFailureAsync(
        invocation,
        adapter?.Descriptor.IsMutation == true
          ? ActionOutcome.NeedsAttention
          : ActionOutcome.Cancelled,
        adapter?.Descriptor.IsMutation == true
          ? "session_mutation_cancelled_outcome_unknown"
          : "session_action_cancelled").ConfigureAwait(false);
    }
    catch (Exception exception)
    {
      LogCapabilityFailure(
        logger,
        invocation.CapabilityId,
        exception.GetType().Name,
        exception);
      await SendFailureAsync(
        invocation,
        adapter?.Descriptor.IsMutation == true
          ? ActionOutcome.NeedsAttention
          : ActionOutcome.Failed,
        SafeErrorCode(exception)).ConfigureAwait(false);
    }
  }

  private async Task SendFailureAsync(
    SessionActionInvocation invocation,
    ActionOutcome outcome,
    string errorCode)
  {
    try
    {
      await channel.SendCompletionAsync(new SessionActionCompletion(
        invocation.Context.ActionId,
        invocation.Context.TaskId,
        invocation.Context.StepId,
        outcome,
        null,
        errorCode), CancellationToken.None).ConfigureAwait(false);
    }
    catch (Exception exception)
    {
      LogSessionFailure(logger, exception.GetType().Name, exception);
    }
  }

  /// <summary>
  /// A capability may have consumed local or external budgets before returning
  /// an invalid result. Forward only its measurements and recovery metadata to
  /// LocalSystem; deliberately null the model-visible payload so the service
  /// rejects the result while still journalling and reconciling actual usage.
  /// </summary>
  private async Task SendMeasuredFailureAsync(
    SessionActionInvocation invocation,
    CapabilityExecutionResult result,
    string errorCode)
  {
    try
    {
      await channel.SendCompletionAsync(new SessionActionCompletion(
        invocation.Context.ActionId,
        invocation.Context.TaskId,
        invocation.Context.StepId,
        ActionOutcome.NeedsAttention,
        result with
        {
          OutputJson = null!,
          OutcomeUncertain = true,
          Provenance = [],
        },
        errorCode), CancellationToken.None).ConfigureAwait(false);
    }
    catch (Exception exception)
    {
      LogSessionFailure(logger, exception.GetType().Name, exception);
    }
  }

  private async Task RunHeartbeatAsync(CancellationToken cancellationToken)
  {
    using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Clamp(
      _options.HeartbeatSeconds,
      5,
      300)));
    do
    {
      await channel.SendHeartbeatAsync(new SessionAgentHeartbeat(
        _options.DeviceId,
        CurrentSessionId(),
        _options.ExecutionEnabled,
        File.Exists(Environment.ExpandEnvironmentVariables(_options.KillSwitchPath)),
        _running.Count,
        DateTimeOffset.UtcNow), cancellationToken).ConfigureAwait(false);
    }
    while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false));
  }

  private void ValidateAdapters()
  {
    var expected = StandardUserCapabilityCatalog.DescribeRequestedSurface(
        _sessionBridgeOptions.BrowserExternalEffectsEnabled,
        _sessionBridgeOptions.EmergencyCommandEnabled)
      .Select(descriptor => Key(descriptor.Id, descriptor.Version))
      .ToHashSet(StringComparer.Ordinal);
    if (!_adapters.Keys.ToHashSet(StringComparer.Ordinal).SetEquals(expected)
      || _adapters.Values.Any(adapter => adapter.Descriptor.TouchesTrustedRoot))
    {
      throw new InvalidOperationException(
        "The interactive agent capability surface differs from the reviewed catalog.");
    }
  }

  private static bool IsExecutionResultValid(
    IHostCapabilityAdapter adapter,
    ActionExecutionContext context,
    CapabilityExecutionResult result)
  {
    var outputBytes = result.OutputJson is null
      ? 0
      : Encoding.UTF8.GetByteCount(result.OutputJson);
    return result.OutputJson is not null
      && outputBytes <= context.Budgets.MaxExternalEgressBytes
      && result.ExternalEgressBytes >= 0
      && result.ExternalEgressBytes <= context.Budgets.MaxExternalEgressBytes - outputBytes
      // The independently privileged LocalSystem coordinator owns the one
      // terminal boundary session. A standard-user adapter may consume only
      // its signed pre-action authorization; it can never mint or inject the
      // terminal receipt that the coordinator verifies and journals.
      && result.EgressReceipt is null
      && result.LocalBytesRead >= 0
      && result.LocalBytesWritten >= 0
      && result.LocalBytesRead <= context.Budgets.MaxLocalBytes
      && result.LocalBytesWritten <= context.Budgets.MaxLocalBytes - result.LocalBytesRead
      && result.Provenance.Count <= 100
      && !result.Provenance.Any(provenance =>
        !adapter.Descriptor.ProvenanceOutputs.Contains(
          provenance.SourceType,
          StringComparer.Ordinal)
        || !PayloadDigest.IsSha256Hex(provenance.SourceIdentifierHash)
        || !PayloadDigest.IsSha256Hex(provenance.ContentSha256));
  }

  private void CancelAll()
  {
    foreach (var action in _running.Values)
    {
      action.Cancellation.Cancel();
    }
  }

  private static int CurrentSessionId()
  {
    using var process = Process.GetCurrentProcess();
    return process.SessionId;
  }

  private static string Key(string id, string version) => $"{id}\u001f{version}";

  private static string SafeErrorCode(Exception exception)
  {
    var candidate = exception.Message;
    return candidate.Length is >= 1 and <= 100
      && candidate.All(character => char.IsAsciiLetterOrDigit(character)
        || character is '.' or '-' or '_' or ':')
        ? candidate
        : "session_capability_failed";
  }

  private static async Task ObserveAsync(Task task)
  {
    try
    {
      await task.ConfigureAwait(false);
    }
    catch (OperationCanceledException)
    {
      // Expected during bridge reconnect or process shutdown.
    }
    catch
    {
      // The owner logs the primary exception before this observation point.
    }
  }

  private static void DisposeSecrets(IReadOnlyList<SessionResolvedSecret> secrets)
  {
    foreach (var secret in secrets)
    {
      secret.Dispose();
    }
  }

  private sealed class RunningAction(
    string taskId,
    CancellationTokenSource cancellation)
  {
    public string TaskId { get; } = taskId;

    public CancellationTokenSource Cancellation { get; } = cancellation;

    public Task Task { get; set; } = Task.CompletedTask;
  }
}
