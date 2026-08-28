using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.IO.Pipes;
using Itemba.Msaidizi.EgressSupervisor.Core;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Itemba.Msaidizi.EgressSupervisor.Transport;

public sealed class NamedPipeEgressControlService(
  EgressSupervisorOptions options,
  EgressSupervisorEngine engine,
  EgressControlProtocolHandler handler,
  IEgressPipePeerAuthenticator peerAuthenticator,
  ILogger<NamedPipeEgressControlService> logger) : BackgroundService
{
  private readonly ConcurrentDictionary<long, Task> _connections = new();
  private long _connectionId;

  protected override async Task ExecuteAsync(CancellationToken stoppingToken)
  {
    if (!options.Enabled)
    {
      EgressSupervisorLog.ControlDisabled(logger);
      await Task.Delay(Timeout.InfiniteTimeSpan, stoppingToken).ConfigureAwait(false);
      return;
    }

    ValidateActiveOptions();
    await engine.InitializeAsync(stoppingToken).ConfigureAwait(false);
    using var slots = new SemaphoreSlim(
      options.MaximumConcurrentFlows,
      options.MaximumConcurrentFlows);
    try
    {
      while (!stoppingToken.IsCancellationRequested)
      {
        await slots.WaitAsync(stoppingToken).ConfigureAwait(false);
        NamedPipeServerStream? pipe = null;
        try
        {
          pipe = RestrictedEgressPipeFactory.Create(
            options.PipeName,
            options.CompanionServiceName,
            options.MaximumConcurrentFlows);
          await pipe.WaitForConnectionAsync(stoppingToken).ConfigureAwait(false);
        }
        catch
        {
          if (pipe is not null)
          {
            await pipe.DisposeAsync().ConfigureAwait(false);
          }
          slots.Release();
          throw;
        }

        var id = Interlocked.Increment(ref _connectionId);
        var task = HandleConnectionAsync(pipe, stoppingToken);
        _connections[id] = task;
        _ = task.ContinueWith(
          completedTask =>
          {
            _connections.TryRemove(id, out _);
            slots.Release();
          },
          CancellationToken.None,
          TaskContinuationOptions.ExecuteSynchronously,
          TaskScheduler.Default);
      }
    }
    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
    {
      // Normal service stop.
    }
    finally
    {
      await Task.WhenAll(_connections.Values).ConfigureAwait(false);
    }
  }

  private async Task HandleConnectionAsync(
    NamedPipeServerStream pipe,
    CancellationToken cancellationToken)
  {
    await using (pipe.ConfigureAwait(false))
    {
      try
      {
        using var peer = peerAuthenticator.Authenticate(pipe.SafePipeHandle);
        peer.ThrowIfUnavailable();
        var request = await ReadFrameAsync(
          pipe,
          options.MaximumControlFrameBytes,
          cancellationToken).ConfigureAwait(false);
        var response = await handler.HandleAsync(
          request,
          peer.ProcessId,
          peer.ProcessCreationTimeUnixMilliseconds,
          cancellationToken).ConfigureAwait(false);
        if (response.Length > options.MaximumControlFrameBytes)
        {
          throw new InvalidDataException("The egress control response is oversized.");
        }
        peer.ThrowIfUnavailable();
        await WriteFrameAsync(pipe, response, cancellationToken).ConfigureAwait(false);
      }
      catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
      {
        // Normal service stop.
      }
      catch (EgressSupervisorException exception)
      {
        EgressSupervisorLog.ControlRefused(logger, exception.Code);
      }
      catch (Exception exception) when (exception is IOException
        or UnauthorizedAccessException
        or InvalidDataException)
      {
        EgressSupervisorLog.ControlMalformed(logger);
      }
    }
  }

  internal static async ValueTask<byte[]> ReadFrameAsync(
    Stream stream,
    int maximumBytes,
    CancellationToken cancellationToken)
  {
    var prefix = new byte[sizeof(int)];
    await ReadExactlyAsync(stream, prefix, cancellationToken).ConfigureAwait(false);
    var length = BinaryPrimitives.ReadInt32BigEndian(prefix);
    if (length <= 0 || length > maximumBytes)
    {
      throw new InvalidDataException("The egress frame length is invalid.");
    }
    var frame = new byte[length];
    await ReadExactlyAsync(stream, frame, cancellationToken).ConfigureAwait(false);
    return frame;
  }

  internal static async ValueTask WriteFrameAsync(
    Stream stream,
    ReadOnlyMemory<byte> frame,
    CancellationToken cancellationToken)
  {
    var prefix = new byte[sizeof(int)];
    BinaryPrimitives.WriteInt32BigEndian(prefix, frame.Length);
    await stream.WriteAsync(prefix, cancellationToken).ConfigureAwait(false);
    await stream.WriteAsync(frame, cancellationToken).ConfigureAwait(false);
    await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
  }

  private static async ValueTask ReadExactlyAsync(
    Stream stream,
    Memory<byte> buffer,
    CancellationToken cancellationToken)
  {
    var offset = 0;
    while (offset < buffer.Length)
    {
      var read = await stream.ReadAsync(buffer[offset..], cancellationToken)
        .ConfigureAwait(false);
      if (read == 0)
      {
        throw new EndOfStreamException("The egress pipe disconnected mid-frame.");
      }
      offset += read;
    }
  }

  private void ValidateActiveOptions()
  {
    if (!RestrictedEgressPipeFactory.IsSafePipeName(options.PipeName)
      || !RestrictedEgressPipeFactory.IsSafePipeName(options.DataPipeName)
      || string.Equals(options.PipeName, options.DataPipeName, StringComparison.Ordinal)
      || options.MaximumControlFrameBytes
        is < EgressSupervisorWireProtocol.MinimumFrameBytes
        or > EgressSupervisorWireProtocol.MaximumFrameBytes
      || options.MaximumConcurrentFlows is < 1 or > 254)
    {
      throw new InvalidOperationException("Active egress-supervisor options are invalid.");
    }
  }
}
