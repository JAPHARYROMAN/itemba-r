using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text.Json;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Configuration;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Execution;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Channel;

public sealed partial class NamedPipeIsolationSupervisorServer(
  PrivilegedCommandSupervisorOptions options,
  IsolationLifecycleEngine engine,
  IHostApplicationLifetime lifetime,
  ILogger<NamedPipeIsolationSupervisorServer> logger) : BackgroundService
{
  private readonly SemaphoreSlim _clientSlots = new(options.MaximumConcurrentClients);
  private readonly ConcurrentDictionary<long, Task> _clients = new();
  private long _clientSequence;

  protected override async Task ExecuteAsync(CancellationToken stoppingToken)
  {
    try
    {
      await engine.InitializeAndRecoverAsync(stoppingToken).ConfigureAwait(false);
      LogReady(logger, options.PipeName);
      while (!stoppingToken.IsCancellationRequested)
      {
        await _clientSlots.WaitAsync(stoppingToken).ConfigureAwait(false);
        NamedPipeServerStream? pipe = null;
        try
        {
          pipe = SecureIsolationPipeFactory.Create(options);
          await pipe.WaitForConnectionAsync(stoppingToken).ConfigureAwait(false);
          var id = Interlocked.Increment(ref _clientSequence);
          var task = HandleClientAsync(id, pipe, stoppingToken);
          pipe = null;
          _clients[id] = task;
          _ = task.ContinueWith(
            (completed, state) =>
            {
              var server = (NamedPipeIsolationSupervisorServer)state!;
              server._clients.TryRemove(id, out _);
              server._clientSlots.Release();
              if (completed.IsFaulted)
              {
                LogUnexpectedClientFailure(
                  logger,
                  completed.Exception?.GetBaseException()
                    ?? new InvalidOperationException("Isolation client task failed."),
                  id);
                lifetime.StopApplication();
              }
            },
            this,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
        }
        catch
        {
          pipe?.Dispose();
          _clientSlots.Release();
          throw;
        }
      }
    }
    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
    {
      // Normal SCM stop.
    }
    catch (Exception exception)
    {
      LogStoppedFailClosed(logger, exception);
      lifetime.StopApplication();
      throw;
    }
    finally
    {
      var clients = _clients.Values.ToArray();
      if (clients.Length != 0)
      {
        try
        {
          await Task.WhenAll(clients).WaitAsync(TimeSpan.FromSeconds(15), CancellationToken.None)
            .ConfigureAwait(false);
        }
        catch (Exception exception) when (exception is TimeoutException
          or IOException
          or OperationCanceledException)
        {
          LogDrainFailed(logger, exception);
        }
      }
    }
  }

  public override void Dispose()
  {
    _clientSlots.Dispose();
    base.Dispose();
  }

  private async Task HandleClientAsync(
    long clientId,
    NamedPipeServerStream pipe,
    CancellationToken stoppingToken)
  {
    await using (pipe.ConfigureAwait(false))
    using (var peer = ValidatedIsolationPipePeer.Create(pipe.SafePipeHandle, options))
    {
      long expectedSequence = 1;
      try
      {
        while (pipe.IsConnected && !stoppingToken.IsCancellationRequested)
        {
          peer.ThrowIfUnavailable();
          using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
          timeout.CancelAfter(expectedSequence == 1
            ? options.OperationTimeout
            : options.SessionIdleTimeout);
          var requestBytes = await ReadFrameAsync(pipe, timeout.Token).ConfigureAwait(false);
          try
          {
            var request = ParseFrame(requestBytes);
            if (request.ProtocolVersion != IsolationPipeProtocol.Version
              || request.Sequence != expectedSequence
              || !CanonicalGuid(request.MessageId)
              || !CanonicalGuid(request.CorrelationId))
            {
              throw new InvalidDataException(
                "The isolation request frame is out of phase or uncorrelated.");
            }

            var response = await DispatchAsync(request, peer.Identity, timeout.Token)
              .ConfigureAwait(false);
            try
            {
              await WriteFrameAsync(pipe, response, timeout.Token).ConfigureAwait(false);
            }
            finally
            {
              CryptographicOperations.ZeroMemory(response);
            }
          }
          finally
          {
            CryptographicOperations.ZeroMemory(requestBytes);
          }
          expectedSequence = checked(expectedSequence + 1);
        }
      }
      catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
      {
        // Host shutdown owns driver lease cleanup.
      }
      catch (EndOfStreamException)
      {
        LogDisconnected(logger, clientId);
      }
      catch (IsolationSupervisorFatalException exception)
      {
        LogTrustBoundaryFailed(logger, exception, clientId, exception.ErrorCode);
        lifetime.StopApplication();
        throw;
      }
      catch (Exception exception) when (exception is InvalidDataException
        or JsonException
        or UnauthorizedAccessException
        or InvalidOperationException
        or TimeoutException)
      {
        // Protocol/policy failures intentionally receive no shaped error frame.
        // Closing the pipe cannot grant progress to the companion verifier.
        LogRejected(logger, exception, clientId);
      }
    }
  }

  private async ValueTask<byte[]> DispatchAsync(
    IsolationPipeFrameV1 frame,
    PipePeerIdentity peer,
    CancellationToken cancellationToken)
  {
    switch (frame.Kind)
    {
      case IsolationPipeProtocol.ReserveRequest:
        {
          var payload = Payload<ReserveRequestPayload>(frame);
          var request = Required(payload.Request, "request");
          var compactActionToken = Required(
            payload.CompactActionToken,
            "compactActionToken");
          var actionRequest = Required(payload.ActionRequest, "actionRequest");
          var invocation = Required(payload.Invocation, "invocation");
          Correlate(frame, request.RequestId);
          var lease = await engine.ReserveAsync(
            request,
            compactActionToken,
            actionRequest,
            invocation,
            cancellationToken)
            .ConfigureAwait(false);
          return Response(
            frame,
            IsolationPipeProtocol.ReserveResponse,
            new ReserveResponsePayload(lease));
        }
      case IsolationPipeProtocol.ReleaseRequest:
        {
          var payload = Payload<ReleaseRequestPayload>(frame);
          var request = Required(payload.Request, "request");
          var signedLease = Required(payload.SignedLease, "signedLease");
          var outcome = Required(payload.Outcome, "outcome");
          Correlate(frame, request.RequestId);
          var release = await engine.ReleaseAsync(
            request,
            signedLease,
            outcome,
            cancellationToken).ConfigureAwait(false);
          return Response(
            frame,
            IsolationPipeProtocol.ReleaseResponse,
            new ReleaseResponsePayload(release));
        }
      case IsolationPipeProtocol.BindRequest:
        {
          var payload = Payload<BindRequestPayload>(frame);
          var request = Required(payload.Request, "request");
          var signedLease = Required(payload.SignedLease, "signedLease");
          var observation = Required(payload.Observation, "observation");
          var invocation = Required(payload.Invocation, "invocation");
          Correlate(frame, request.RequestId);
          var response = await engine.BindAsync(
            request,
            signedLease,
            observation,
            invocation,
            peer,
            cancellationToken).ConfigureAwait(false);
          return Response(frame, IsolationPipeProtocol.BindResponse, response);
        }
      case IsolationPipeProtocol.SettleRequest:
        {
          var payload = Payload<SettleRequestPayload>(frame);
          var request = Required(payload.Request, "request");
          var signedLease = Required(payload.SignedLease, "signedLease");
          var binding = Required(payload.Binding, "binding");
          var signedAcknowledgement = Required(
            payload.SignedAcknowledgement,
            "signedAcknowledgement");
          var observation = Required(payload.Observation, "observation");
          Correlate(frame, request.RequestId);
          var receipt = await engine.SettleAsync(
            request,
            signedLease,
            binding,
            signedAcknowledgement,
            observation,
            cancellationToken).ConfigureAwait(false);
          return Response(
            frame,
            IsolationPipeProtocol.SettleResponse,
            new SettleResponsePayload(receipt));
        }
      case IsolationPipeProtocol.RecoverReservationRequest:
        {
          var payload = Payload<RecoverReservationRequestPayload>(frame);
          var pending = Required(payload.Pending, "pending");
          var request = Required(pending.Request, "pending.request");
          _ = Required(pending.SignedLease, "pending.signedLease");
          Correlate(frame, request.RequestId);
          var release = await engine.RecoverReservationAsync(
            pending,
            cancellationToken).ConfigureAwait(false);
          return Response(
            frame,
            IsolationPipeProtocol.RecoverReservationResponse,
            new ReleaseResponsePayload(release));
        }
      case IsolationPipeProtocol.RecoverBindRequest:
        {
          var payload = Payload<RecoverBindRequestPayload>(frame);
          var pending = Required(payload.Pending, "pending");
          var request = Required(pending.Request, "pending.request");
          _ = Required(pending.SignedLease, "pending.signedLease");
          _ = Required(pending.Binding, "pending.binding");
          _ = Required(
            pending.SignedAcknowledgement,
            "pending.signedAcknowledgement");
          Correlate(frame, request.RequestId);
          var receipt = await engine.RecoverBindAsync(pending, cancellationToken)
            .ConfigureAwait(false);
          return Response(
            frame,
            IsolationPipeProtocol.RecoverBindResponse,
            new SettleResponsePayload(receipt));
        }
      default:
        throw new InvalidDataException("The isolation request kind is unsupported.");
    }
  }

  private async ValueTask<byte[]> ReadFrameAsync(
    NamedPipeServerStream pipe,
    CancellationToken cancellationToken)
  {
    var prefix = new byte[sizeof(int)];
    await ReadExactlyAsync(pipe, prefix, cancellationToken).ConfigureAwait(false);
    var length = BinaryPrimitives.ReadInt32BigEndian(prefix);
    if (length <= 0 || length > options.MaximumFrameBytes)
    {
      throw new InvalidDataException("The isolation request frame length is invalid.");
    }
    var frame = new byte[length];
    await ReadExactlyAsync(pipe, frame, cancellationToken).ConfigureAwait(false);
    return frame;
  }

  private static async ValueTask ReadExactlyAsync(
    Stream stream,
    Memory<byte> buffer,
    CancellationToken cancellationToken)
  {
    var read = 0;
    while (read < buffer.Length)
    {
      var count = await stream.ReadAsync(buffer[read..], cancellationToken)
        .ConfigureAwait(false);
      if (count == 0)
      {
        throw new EndOfStreamException();
      }
      read += count;
    }
  }

  private async ValueTask WriteFrameAsync(
    NamedPipeServerStream pipe,
    ReadOnlyMemory<byte> frame,
    CancellationToken cancellationToken)
  {
    if (frame.IsEmpty || frame.Length > options.MaximumFrameBytes)
    {
      throw new InvalidDataException("The isolation response frame is oversized.");
    }
    var prefix = new byte[sizeof(int)];
    BinaryPrimitives.WriteInt32BigEndian(prefix, frame.Length);
    await pipe.WriteAsync(prefix, cancellationToken).ConfigureAwait(false);
    await pipe.WriteAsync(frame, cancellationToken).ConfigureAwait(false);
    await pipe.FlushAsync(cancellationToken).ConfigureAwait(false);
  }

  private static IsolationPipeFrameV1 ParseFrame(ReadOnlySpan<byte> bytes)
  {
    try
    {
      return JsonSerializer.Deserialize<IsolationPipeFrameV1>(
        bytes,
        IsolationPipeProtocol.SerializerOptions) ?? throw new JsonException();
    }
    catch (JsonException exception)
    {
      throw new InvalidDataException("The isolation request frame is malformed.", exception);
    }
  }

  private static T Payload<T>(IsolationPipeFrameV1 frame)
  {
    try
    {
      return JsonSerializer.Deserialize<T>(
        frame.PayloadJson,
        IsolationPipeProtocol.SerializerOptions) ?? throw new JsonException();
    }
    catch (Exception exception) when (exception is JsonException
      or ArgumentException)
    {
      throw new InvalidDataException("The isolation request payload is malformed.", exception);
    }
  }

  private static byte[] Response<T>(
    IsolationPipeFrameV1 request,
    string kind,
    T payload) => JsonSerializer.SerializeToUtf8Bytes(
      new IsolationPipeFrameV1(
        IsolationPipeProtocol.Version,
        request.Sequence,
        kind,
        Guid.NewGuid().ToString("D"),
        request.CorrelationId,
        JsonSerializer.Serialize(payload, IsolationPipeProtocol.SerializerOptions)),
      IsolationPipeProtocol.SerializerOptions);

  private static void Correlate(IsolationPipeFrameV1 frame, string? requestId)
  {
    if (!CanonicalGuid(requestId)
      || !string.Equals(frame.CorrelationId, requestId, StringComparison.Ordinal))
    {
      throw new InvalidDataException("The isolation request correlation is invalid.");
    }
  }

  private static T Required<T>(T? value, string member) where T : class =>
    value ?? throw new InvalidDataException(
      $"The isolation request is missing {member}.");

  private static bool CanonicalGuid(string? value) =>
    value is not null
    && Guid.TryParseExact(value, "D", out var parsed)
    && parsed != Guid.Empty
    && string.Equals(parsed.ToString("D"), value, StringComparison.Ordinal);

  [LoggerMessage(
    EventId = 8110,
    Level = LogLevel.Information,
    Message = "Privileged-command isolation supervisor ready on pipe {PipeName}")]
  private static partial void LogReady(ILogger logger, string pipeName);

  [LoggerMessage(
    EventId = 8111,
    Level = LogLevel.Critical,
    Message = "Privileged-command isolation supervisor stopped fail-closed")]
  private static partial void LogStoppedFailClosed(ILogger logger, Exception exception);

  [LoggerMessage(
    EventId = 8112,
    Level = LogLevel.Warning,
    Message = "Isolation pipe clients did not drain cleanly")]
  private static partial void LogDrainFailed(ILogger logger, Exception exception);

  [LoggerMessage(
    EventId = 8113,
    Level = LogLevel.Debug,
    Message = "Isolation pipe client {ClientId} disconnected")]
  private static partial void LogDisconnected(ILogger logger, long clientId);

  [LoggerMessage(
    EventId = 8114,
    Level = LogLevel.Critical,
    Message = "Isolation trust boundary failed at client {ClientId}: {ErrorCode}")]
  private static partial void LogTrustBoundaryFailed(
    ILogger logger,
    Exception exception,
    long clientId,
    string errorCode);

  [LoggerMessage(
    EventId = 8115,
    Level = LogLevel.Warning,
    Message = "Isolation pipe client {ClientId} was rejected")]
  private static partial void LogRejected(
    ILogger logger,
    Exception exception,
    long clientId);

  [LoggerMessage(
    EventId = 8116,
    Level = LogLevel.Critical,
    Message = "Isolation pipe client {ClientId} failed outside the rejectable protocol boundary")]
  private static partial void LogUnexpectedClientFailure(
    ILogger logger,
    Exception exception,
    long clientId);
}
