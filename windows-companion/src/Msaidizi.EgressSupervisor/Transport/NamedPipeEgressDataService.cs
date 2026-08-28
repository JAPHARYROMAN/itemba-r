using System.Collections.Concurrent;
using System.ComponentModel;
using System.IO.Pipes;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.EgressSupervisor.Core;
using Itemba.Msaidizi.EgressSupervisor.Security;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Itemba.Msaidizi.EgressSupervisor.Transport;

public interface IEgressOutboundConnection : IAsyncDisposable
{
  Stream Stream { get; }

  void Abort();
}

public interface IEgressOutboundConnector
{
  ValueTask<EgressOutboundRouteConnection> ConnectAsync(
    string destinationHost,
    int destinationPort,
    string reservationDnsAnswerSetSha256,
    TimeSpan timeout,
    CancellationToken cancellationToken);
}

public sealed record EgressOutboundRouteConnection(
  IEgressOutboundConnection Connection,
  string ConnectionDnsAnswerSetSha256,
  string SelectedAddressSha256);

public interface IEgressTcpDialer
{
  ValueTask<IEgressOutboundConnection> ConnectAsync(
    IPAddress destinationAddress,
    int destinationPort,
    CancellationToken cancellationToken);
}

public sealed class EgressTcpDialer : IEgressTcpDialer
{
  public async ValueTask<IEgressOutboundConnection> ConnectAsync(
    IPAddress destinationAddress,
    int destinationPort,
    CancellationToken cancellationToken)
  {
    var client = destinationAddress.AddressFamily switch
    {
      AddressFamily.InterNetwork => new TcpClient(AddressFamily.InterNetwork),
      AddressFamily.InterNetworkV6 => new TcpClient(AddressFamily.InterNetworkV6),
      _ => throw new ArgumentException(
        "Only exact IPv4 or IPv6 destination addresses are supported.",
        nameof(destinationAddress)),
    };
    client.NoDelay = true;
    try
    {
      await client.ConnectAsync(
        destinationAddress,
        destinationPort,
        cancellationToken).ConfigureAwait(false);
      return new TcpOutboundConnection(client);
    }
    catch
    {
      client.Dispose();
      throw;
    }
  }

  private sealed class TcpOutboundConnection(TcpClient client) : IEgressOutboundConnection
  {
    private int _disposed;

    public Stream Stream { get; } = client.GetStream();

    public void Abort()
    {
      try
      {
        client.Client.Shutdown(SocketShutdown.Both);
      }
      catch (SocketException)
      {
        // The connection is already gone.
      }
      client.Dispose();
    }

    public ValueTask DisposeAsync()
    {
      if (Interlocked.Exchange(ref _disposed, 1) == 0)
      {
        client.Dispose();
      }
      return ValueTask.CompletedTask;
    }
  }
}

public sealed class TcpEgressOutboundConnector : IEgressOutboundConnector
{
  private readonly IEgressDestinationResolver _resolver;
  private readonly IEgressTcpDialer _dialer;

  public TcpEgressOutboundConnector(
    IEgressDestinationResolver? resolver = null,
    IEgressTcpDialer? dialer = null)
  {
    _resolver = resolver ?? new DnsEgressDestinationResolver();
    _dialer = dialer ?? new EgressTcpDialer();
  }

  public async ValueTask<EgressOutboundRouteConnection> ConnectAsync(
    string destinationHost,
    int destinationPort,
    string reservationDnsAnswerSetSha256,
    TimeSpan timeout,
    CancellationToken cancellationToken)
  {
    if (!PayloadDigest.IsSha256Hex(reservationDnsAnswerSetSha256))
    {
      throw new IOException("The reservation DNS evidence is invalid.");
    }
    using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(
      cancellationToken);
    timeoutSource.CancelAfter(timeout);
    ResolvedPublicDestination resolved;
    try
    {
      resolved = await _resolver.ResolvePublicAsync(
        destinationHost,
        timeoutSource.Token).ConfigureAwait(false);
    }
    catch (Exception exception) when (exception is SocketException
      or ArgumentException
      or InvalidDataException)
    {
      throw new IOException("The egress destination could not be resolved.", exception);
    }
    if (resolved.Addresses.Count == 0
      || resolved.Addresses.Any(
        address => !PublicNetworkDestinationPolicy.IsPublicAddress(address)))
    {
      throw new IOException("The egress destination resolved outside the public network.");
    }
    ResolvedPublicDestination canonicalResolved;
    try
    {
      canonicalResolved = EgressRouteAttestation.Create(resolved.Addresses);
    }
    catch (InvalidDataException exception)
    {
      throw new IOException("The egress destination resolved outside the public network.", exception);
    }
    if (!PayloadDigest.FixedTimeEqualsHex(
      resolved.AnswerSetSha256,
      canonicalResolved.AnswerSetSha256))
    {
      throw new IOException("The resolver returned inconsistent route evidence.");
    }
    if (!PayloadDigest.FixedTimeEqualsHex(
      canonicalResolved.AnswerSetSha256,
      reservationDnsAnswerSetSha256))
    {
      // Exact equality is intentionally stricter than connection-set
      // containment and makes recovery verifiable without persisting raw IPs.
      throw new IOException("The connection DNS answer set changed after reservation.");
    }

    // Resolve again at the last responsible moment, connect to the validated
    // address itself (not the hostname), and leave SNI/hostname verification to
    // the caller's SslStream. This path has no HTTP proxy and never follows a
    // redirect; it transports exactly one raw request and response.
    Exception? lastFailure = null;
    foreach (var address in canonicalResolved.Addresses)
    {
      try
      {
        var connection = await _dialer.ConnectAsync(
          address,
          destinationPort,
          timeoutSource.Token).ConfigureAwait(false);
        return new EgressOutboundRouteConnection(
          connection,
          canonicalResolved.AnswerSetSha256,
          EgressRouteAttestation.SelectedAddressSha256(address));
      }
      catch (Exception exception) when (exception is SocketException
        or OperationCanceledException)
      {
        lastFailure = exception;
        if (timeoutSource.IsCancellationRequested)
        {
          throw;
        }
      }
    }
    throw new IOException("The public egress destination could not be reached.", lastFailure);
  }
}

/// <summary>
/// No TCP/UDP listener is exposed. The authenticated companion sends the
/// one-time flow claim and raw TLS bytes over this exact-DACL pipe; only this
/// independent service owns the outbound socket and byte meter.
/// </summary>
public sealed class NamedPipeEgressDataService(
  EgressSupervisorOptions options,
  EgressSupervisorEngine engine,
  IEgressPipePeerAuthenticator peerAuthenticator,
  IEgressOutboundConnector outboundConnector,
  IEgressSupervisorSecretVault secretVault,
  IHostApplicationLifetime applicationLifetime,
  ILogger<NamedPipeEgressDataService> logger) : BackgroundService
{
  private readonly ConcurrentDictionary<long, Task> _flows = new();
  private long _flowConnectionId;

  protected override async Task ExecuteAsync(CancellationToken stoppingToken)
  {
    if (!options.Enabled)
    {
      EgressSupervisorLog.DataDisabled(logger);
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
            options.DataPipeName,
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

        var id = Interlocked.Increment(ref _flowConnectionId);
        var task = HandleFlowAsync(pipe, stoppingToken);
        _flows[id] = task;
        _ = task.ContinueWith(
          completedTask =>
          {
            _flows.TryRemove(id, out _);
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
      await Task.WhenAll(_flows.Values).ConfigureAwait(false);
    }
  }

  private async Task HandleFlowAsync(
    NamedPipeServerStream pipe,
    CancellationToken stoppingToken)
  {
    await using (pipe.ConfigureAwait(false))
    {
      EgressFlowAuthorization? flow = null;
      IEgressOutboundConnection? outbound = null;
      SslStream? tls = null;
      long measured = 0;
      var measurementUncertain = false;
      var requestDispatched = false;
      var openAccepted = false;
      using var flowHash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
      try
      {
        using var peer = peerAuthenticator.Authenticate(pipe.SafePipeHandle);
        peer.ThrowIfUnavailable();
        using var claimCancellation = CancellationTokenSource.CreateLinkedTokenSource(
          stoppingToken);
        claimCancellation.CancelAfter(TimeSpan.FromSeconds(
          options.FlowOperationTimeoutSeconds));
        var header = await NamedPipeEgressControlService.ReadFrameAsync(
          pipe,
          options.MaximumFlowHeaderBytes,
          claimCancellation.Token).ConfigureAwait(false);
        EgressFlowOpenRequestV1 request;
        try
        {
          request = JsonSerializer.Deserialize<EgressFlowOpenRequestV1>(
            header,
            EgressSupervisorWireProtocol.StrictJson) ?? throw new JsonException();
        }
        catch (JsonException exception)
        {
          throw new InvalidDataException("The egress flow claim is malformed.", exception);
        }
        finally
        {
          CryptographicOperations.ZeroMemory(header);
        }

        flow = await engine.BeginDirectFlowAsync(
          request,
          peer.ProcessId,
          peer.ProcessCreationTimeUnixMilliseconds,
          claimCancellation.Token).ConfigureAwait(false);
        AppendFlowDomain(flowHash, flow);
        using var operationCancellation = CancellationTokenSource.CreateLinkedTokenSource(
          stoppingToken);
        var leaseRemaining = flow.ExpiresAtUnixMilliseconds
          - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var operationCeiling = checked(options.FlowOperationTimeoutSeconds * 1_000L);
        operationCancellation.CancelAfter(TimeSpan.FromMilliseconds(
          Math.Max(1, Math.Min(leaseRemaining, operationCeiling))));
        using var remoteConnectCancellation = CancellationTokenSource.CreateLinkedTokenSource(
          operationCancellation.Token);
        remoteConnectCancellation.CancelAfter(TimeSpan.FromSeconds(
          options.ConnectTimeoutSeconds));
        try
        {
          var routedConnection = await outboundConnector.ConnectAsync(
            flow.DestinationHost,
            flow.DestinationPort,
            flow.ReservationDnsAnswerSetSha256,
            TimeSpan.FromSeconds(options.ConnectTimeoutSeconds),
            remoteConnectCancellation.Token).ConfigureAwait(false);
          outbound = routedConnection.Connection;
          await engine.RecordDirectRouteAsync(
            flow,
            routedConnection.ConnectionDnsAnswerSetSha256,
            routedConnection.SelectedAddressSha256,
            operationCancellation.Token).ConfigureAwait(false);
          AppendRouteDomain(flowHash, routedConnection);
        }
        catch (Exception exception) when (exception is SocketException
          or IOException
          or OperationCanceledException)
        {
          await WriteOpenResponseAsync(
            pipe,
            accepted: false,
            flow.FlowId,
            "egress_destination_connect_failed",
            operationCancellation.Token).ConfigureAwait(false);
          return;
        }

        peer.ThrowIfUnavailable();
        var metered = new CiphertextMeteringStream(
          outbound.Stream,
          flow.MaximumExternalEgressBytes,
          flowHash,
          value => measured = value,
          () => measurementUncertain = true);
        tls = new SslStream(
          metered,
          leaveInnerStreamOpen: true,
          (_, certificate, _, errors) => CertificateAllowed(
            certificate,
            errors,
            flow.ServerCertificateSha256Pin));
        try
        {
          await tls.AuthenticateAsClientAsync(
            CreateTlsOptions(flow),
            operationCancellation.Token).ConfigureAwait(false);
        }
        catch (Exception exception) when (exception is AuthenticationException
          or IOException
          or OperationCanceledException)
        {
          await WriteOpenResponseAsync(
            pipe,
            accepted: false,
            flow.FlowId,
            "egress_destination_tls_failed",
            operationCancellation.Token).ConfigureAwait(false);
          return;
        }

        await WriteOpenResponseAsync(
          pipe,
          accepted: true,
          flow.FlowId,
          "accepted",
          operationCancellation.Token).ConfigureAwait(false);
        openAccepted = true;
        byte[] exactRequest = [];
        byte[] remoteResponse = [];
        var transferCode = "exact_request_invalid";
        try
        {
          exactRequest = await NamedPipeEgressControlService.ReadFrameAsync(
            pipe,
            options.MaximumRequestBytes,
            operationCancellation.Token).ConfigureAwait(false);
          peer.ThrowIfUnavailable();
          if (!EgressExactHttpRequestValidator.IsAuthorized(flow, exactRequest))
          {
            await WriteTransferResponseAsync(
              pipe,
              requestDispatched: false,
              measured,
              [],
              transferCode,
              operationCancellation.Token).ConfigureAwait(false);
            return;
          }

          try
          {
            requestDispatched = await secretVault.UseAsync(
              flow.CredentialReferenceId,
              flow.CapabilityId,
              flow.DestinationScopeSha256,
              flow.CredentialRecordSha256,
              async (credential, secretCancellation) =>
              {
                var authorizedRequest = EgressExactHttpRequestValidator.CreateAuthorizedRequest(
                  flow,
                  exactRequest,
                  credential.Span);
                try
                {
                  await tls.WriteAsync(authorizedRequest, secretCancellation)
                    .ConfigureAwait(false);
                  await tls.FlushAsync(secretCancellation).ConfigureAwait(false);
                  return true;
                }
                finally
                {
                  CryptographicOperations.ZeroMemory(authorizedRequest);
                }
              },
              operationCancellation.Token).ConfigureAwait(false);
          }
          catch (Exception exception) when (exception is UnauthorizedAccessException
            or InvalidDataException
            or CryptographicException
            or Win32Exception
            or DirectoryNotFoundException
            or FileNotFoundException)
          {
            await WriteTransferResponseAsync(
              pipe,
              requestDispatched: false,
              measured,
              [],
              "exact_credential_unavailable",
              operationCancellation.Token).ConfigureAwait(false);
            return;
          }
          catch (Exception exception) when (exception is IOException
            or OperationCanceledException)
          {
            requestDispatched = true;
            measurementUncertain = true;
            transferCode = "request_write_uncertain";
            await WriteTransferResponseAsync(
              pipe,
              requestDispatched,
              measured,
              [],
              transferCode,
              operationCancellation.Token).ConfigureAwait(false);
            return;
          }

          try
          {
            remoteResponse = await ReadBoundedResponseAsync(
              tls,
              options.MaximumResponseBytes,
              operationCancellation.Token).ConfigureAwait(false);
            transferCode = "response_received";
          }
          catch (InvalidDataException)
          {
            transferCode = "response_limit_exceeded";
            measurementUncertain = true;
          }
          catch (Exception exception) when (exception is IOException
            or OperationCanceledException
            or AuthenticationException)
          {
            transferCode = "response_read_uncertain";
            measurementUncertain = true;
          }

          await WriteTransferResponseAsync(
            pipe,
            requestDispatched,
            measured,
            remoteResponse,
            transferCode,
            operationCancellation.Token).ConfigureAwait(false);
        }
        finally
        {
          CryptographicOperations.ZeroMemory(exactRequest);
          CryptographicOperations.ZeroMemory(remoteResponse);
        }
      }
      catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
      {
        measurementUncertain = flow is not null && (requestDispatched || openAccepted);
      }
      catch (OperationCanceledException)
      {
        // The claim/operation/lease deadline is an expected per-flow terminal
        // condition. Do not fault the hosted service or attempt another pipe
        // write after its governing cancellation has fired.
        measurementUncertain = flow is not null && (requestDispatched || openAccepted);
      }
      catch (EgressSupervisorException exception)
      {
        EgressSupervisorLog.FlowRefused(logger, exception.Code);
        if (flow is null && pipe.IsConnected)
        {
          await TryWriteRefusalAsync(
            pipe,
            exception.Code,
            stoppingToken).ConfigureAwait(false);
        }
        measurementUncertain |= exception.MayHaveEgressed;
      }
      catch (Exception exception) when (exception is IOException
        or SocketException
        or UnauthorizedAccessException
        or InvalidDataException)
      {
        EgressSupervisorLog.FlowMalformed(logger);
        measurementUncertain |= flow is not null && (requestDispatched || openAccepted);
      }
      finally
      {
        if (outbound is not null)
        {
          outbound.Abort();
          if (tls is not null)
          {
            try
            {
              await tls.DisposeAsync().ConfigureAwait(false);
            }
            catch (Exception exception) when (exception is IOException
              or AuthenticationException)
            {
              measurementUncertain |= requestDispatched;
            }
          }
          await outbound.DisposeAsync().ConfigureAwait(false);
        }
        if (flow is not null)
        {
          var flowLogSha256 = Convert.ToHexString(flowHash.GetHashAndReset())
            .ToLowerInvariant();
          try
          {
            await engine.CompleteDirectFlowAsync(
              flow,
              measured,
              measurementUncertain,
              flowLogSha256,
              CancellationToken.None).ConfigureAwait(false);
          }
          catch (EgressSupervisorException exception)
          {
            EgressSupervisorLog.FlowReconciliationFailed(logger, exception.Code);
            applicationLifetime.StopApplication();
          }
        }
      }
    }
  }

  private static async Task<byte[]> ReadBoundedResponseAsync(
    Stream source,
    int maximumBytes,
    CancellationToken cancellationToken)
  {
    var buffer = new byte[16_384];
    using var response = new MemoryStream(Math.Min(maximumBytes, 65_536));
    try
    {
      while (true)
      {
        var read = await source.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
        if (read == 0)
        {
          return response.ToArray();
        }
        if (response.Length > maximumBytes - read)
        {
          throw new InvalidDataException("The external response exceeded its ceiling.");
        }
        await response.WriteAsync(buffer.AsMemory(0, read), cancellationToken)
          .ConfigureAwait(false);
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(buffer);
    }
  }

  private static void AppendFlowDomain(IncrementalHash hash, EgressFlowAuthorization flow)
  {
    var material = Encoding.UTF8.GetBytes(string.Join('\n',
      "MSAIDIZI-EGRESS-FLOW-LOG-V2",
      flow.FlowId,
      flow.LeaseSha256,
      flow.DestinationHost,
      flow.DestinationPort.ToString(System.Globalization.CultureInfo.InvariantCulture),
      flow.DestinationScopeSha256,
      flow.ReservationDnsAnswerSetSha256,
      flow.ExactRequestPolicySha256));
    try
    {
      hash.AppendData(material);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(material);
    }
  }

  private static void AppendRouteDomain(
    IncrementalHash hash,
    EgressOutboundRouteConnection route)
  {
    var material = Encoding.UTF8.GetBytes(string.Join('\n',
      "MSAIDIZI-EGRESS-FLOW-ROUTE-V1",
      route.ConnectionDnsAnswerSetSha256,
      route.SelectedAddressSha256));
    try
    {
      hash.AppendData(material);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(material);
    }
  }

  private static ValueTask WriteOpenResponseAsync(
    Stream pipe,
    bool accepted,
    string flowId,
    string code,
    CancellationToken cancellationToken)
  {
    var bytes = JsonSerializer.SerializeToUtf8Bytes(
      new EgressFlowOpenResponseV1(
        EgressSupervisorLifecycleContract.Version,
        accepted,
        flowId,
        code),
      EgressSupervisorWireProtocol.StrictJson);
    return WriteAndClearAsync(pipe, bytes, cancellationToken);
  }

  internal static async ValueTask WriteTransferResponseAsync(
    Stream pipe,
    bool requestDispatched,
    long measuredExternalEgressBytes,
    byte[] response,
    string code,
    CancellationToken cancellationToken)
  {
    var header = JsonSerializer.SerializeToUtf8Bytes(
      new EgressFlowTransferResponseV1(
        EgressSupervisorLifecycleContract.Version,
        requestDispatched,
        measuredExternalEgressBytes,
        response.Length,
        code),
      EgressSupervisorWireProtocol.StrictJson);
    await WriteAndClearAsync(pipe, header, cancellationToken).ConfigureAwait(false);
    if (response.Length > 0)
    {
      await NamedPipeEgressControlService.WriteFrameAsync(
        pipe,
        response,
        cancellationToken).ConfigureAwait(false);
    }
  }

  internal static bool CertificateAllowed(
    X509Certificate? certificate,
    SslPolicyErrors errors,
    string expectedPin)
  {
    if (certificate is null
      || errors != SslPolicyErrors.None
      || !PayloadDigest.IsSha256Hex(expectedPin))
    {
      return false;
    }
    var actual = SHA256.HashData(certificate.GetRawCertData());
    var expected = Convert.FromHexString(expectedPin);
    try
    {
      return CryptographicOperations.FixedTimeEquals(actual, expected);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(actual);
      CryptographicOperations.ZeroMemory(expected);
    }
  }

  internal static SslClientAuthenticationOptions CreateTlsOptions(
    EgressFlowAuthorization flow) => new()
    {
      TargetHost = flow.DestinationHost,
      EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13,
      CertificateRevocationCheckMode = X509RevocationMode.NoCheck,
      CertificateChainPolicy = new X509ChainPolicy
      {
        TrustMode = X509ChainTrustMode.System,
        VerificationFlags = X509VerificationFlags.NoFlag,
        RevocationMode = X509RevocationMode.NoCheck,
        DisableCertificateDownloads = true,
      },
      ApplicationProtocols = [SslApplicationProtocol.Http11],
    };

  private static async ValueTask WriteAndClearAsync(
    Stream pipe,
    byte[] bytes,
    CancellationToken cancellationToken)
  {
    try
    {
      await NamedPipeEgressControlService.WriteFrameAsync(
        pipe,
        bytes,
        cancellationToken).ConfigureAwait(false);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(bytes);
    }
  }

  private static async ValueTask TryWriteRefusalAsync(
    Stream pipe,
    string code,
    CancellationToken stoppingToken)
  {
    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
    timeout.CancelAfter(TimeSpan.FromSeconds(1));
    try
    {
      await WriteOpenResponseAsync(
        pipe,
        accepted: false,
        string.Empty,
        code,
        timeout.Token).ConfigureAwait(false);
    }
    catch (Exception exception) when (exception is IOException
      or OperationCanceledException)
    {
      // The unauthenticated peer may already have disconnected.
    }
  }

  private void ValidateActiveOptions()
  {
    if (!RestrictedEgressPipeFactory.IsSafePipeName(options.DataPipeName)
      || options.MaximumFlowHeaderBytes is < 1_024 or > 65_536
      || options.MaximumConcurrentFlows is < 1 or > 254
      || options.ConnectTimeoutSeconds is < 1 or > 120
      || options.FlowOperationTimeoutSeconds is < 1 or > 900
      || options.MaximumRequestBytes is < 1 or > 1_048_576
      || options.MaximumResponseBytes is < 1 or > 16_777_216
      || EgressTrustedKillSwitch.IsEngaged(options.KillSwitchPath))
    {
      throw new InvalidOperationException("Active egress data-plane options are invalid.");
    }
  }

  private sealed class CiphertextMeteringStream(
    Stream inner,
    long maximumBytes,
    IncrementalHash flowHash,
    Action<long> reportMeasured,
    Action markUncertain) : Stream
  {
    private long _bytesWritten;

    public override bool CanRead => inner.CanRead;
    public override bool CanSeek => false;
    public override bool CanWrite => inner.CanWrite;
    public override long Length => throw new NotSupportedException();
    public override long Position
    {
      get => throw new NotSupportedException();
      set => throw new NotSupportedException();
    }
    public override void Flush() => inner.Flush();
    public override Task FlushAsync(CancellationToken cancellationToken) =>
      inner.FlushAsync(cancellationToken);
    public override int Read(byte[] buffer, int offset, int count) =>
      inner.Read(buffer, offset, count);
    public override ValueTask<int> ReadAsync(
      Memory<byte> buffer,
      CancellationToken cancellationToken = default) =>
      inner.ReadAsync(buffer, cancellationToken);
    public override Task<int> ReadAsync(
      byte[] buffer,
      int offset,
      int count,
      CancellationToken cancellationToken) =>
      inner.ReadAsync(buffer, offset, count, cancellationToken);
    public override void Write(byte[] buffer, int offset, int count)
    {
      EnsureBudget(count);
      try
      {
        inner.Write(buffer, offset, count);
        Accept(buffer.AsSpan(offset, count));
      }
      catch
      {
        markUncertain();
        throw;
      }
    }
    public override async ValueTask WriteAsync(
      ReadOnlyMemory<byte> buffer,
      CancellationToken cancellationToken = default)
    {
      EnsureBudget(buffer.Length);
      try
      {
        await inner.WriteAsync(buffer, cancellationToken).ConfigureAwait(false);
        Accept(buffer.Span);
      }
      catch
      {
        markUncertain();
        throw;
      }
    }
    public override async Task WriteAsync(
      byte[] buffer,
      int offset,
      int count,
      CancellationToken cancellationToken)
    {
      await WriteAsync(buffer.AsMemory(offset, count), cancellationToken)
        .ConfigureAwait(false);
    }
    public override long Seek(long offset, SeekOrigin origin) =>
      throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();

    private void EnsureBudget(int count)
    {
      if (_bytesWritten > maximumBytes - count)
      {
        throw new IOException("The ciphertext egress budget was exceeded.");
      }
    }

    private void Accept(ReadOnlySpan<byte> bytes)
    {
      flowHash.AppendData(bytes);
      _bytesWritten = checked(_bytesWritten + bytes.Length);
      reportMeasured(_bytesWritten);
    }
  }
}
