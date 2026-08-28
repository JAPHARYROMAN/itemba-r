using System.Security.Cryptography;
using System.Diagnostics;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class EgressSupervisorExternalActionTransportTests
{
  private static readonly JsonSerializerOptions WebJson = new(
    JsonSerializerDefaults.Web);

  [Fact]
  public async Task DisabledFlowClientReturnsNonAcceptingTransport()
  {
    var transport = ExternalActionTransportFactory.Create(
      Options.Create(Control(enabled: false)),
      Options.Create(Flow(enabled: false)));
    using var binding = Binding();

    var exception = await Assert.ThrowsAsync<HostPreconditionException>(async () =>
      await transport.SendAsync(
        Endpoint(),
        binding,
        "request"u8.ToArray(),
        1_024,
        TimeSpan.FromSeconds(1),
        CancellationToken.None));

    Assert.IsType<RejectingExternalActionTransport>(transport);
    Assert.Equal("egress_supervisor_flow_transport_unconfigured", exception.ErrorCode);
  }

  [Fact]
  public void ActiveFactoryRequiresDistinctExactControlAndDataPipes()
  {
    var flow = Flow(enabled: true);
    flow.PipeName = "Itemba.Msaidizi.EgressSupervisor.v2";

    Assert.Throws<InvalidOperationException>(() =>
      ExternalActionTransportFactory.Create(
        Options.Create(Control(enabled: true)),
        Options.Create(flow)));
  }

  [Fact]
  public void ActiveFactoryRejectsAnotherCanonicalRestrictedServiceSid()
  {
    var control = Control(enabled: true);
    control.ExpectedSupervisorServiceSid = "S-1-5-80-1-2-3-4-5";

    Assert.Throws<InvalidOperationException>(() =>
      ExternalActionTransportFactory.Create(
        Options.Create(control),
        Options.Create(Flow(enabled: true))));
  }

  [Fact]
  public async Task RefusedFlowSendsExactOneTimeClaimWithoutOpeningTls()
  {
    var connector = new RefusingConnector();
    var transport = new NamedPipeEgressSupervisorExternalActionTransport(
      Control(enabled: true),
      Flow(enabled: true),
      connector);
    var nonce = Enumerable.Range(1, 32).Select(value => (byte)value).ToArray();
    using var binding = Binding(nonce);

    var exception = await Assert.ThrowsAsync<HostPreconditionException>(async () =>
      await transport.SendAsync(
        Endpoint(),
        binding,
        "request"u8.ToArray(),
        1_024,
        TimeSpan.FromSeconds(1),
        CancellationToken.None));

    Assert.Equal("test_flow_refused", exception.ErrorCode);
    Assert.Equal("Itemba.Msaidizi.EgressSupervisor.Flow.v2", connector.PipeName);
    var claim = JsonSerializer.Deserialize<EgressFlowOpenRequestV1>(
      connector.Request ?? throw new InvalidOperationException(),
      WebJson);
    Assert.NotNull(claim);
    Assert.Equal(binding.LeaseSha256, claim.LeaseSha256);
    Assert.Equal(binding.RegistrationId, claim.RegistrationId);
    Assert.Equal(Convert.ToBase64String(nonce), claim.ConnectionNonceBase64);
    Assert.Equal("gateway.example", claim.DestinationHost);
    Assert.Equal(443, claim.DestinationPort);
  }

  [Fact]
  public void FlowBindingZeroesNonceOnDispose()
  {
    var nonce = RandomNumberGenerator.GetBytes(32);
    var binding = Binding(nonce);

    binding.Dispose();

    Assert.All(nonce, value => Assert.Equal(0, value));
    Assert.Throws<ObjectDisposedException>(() => binding.ConnectionNonce.ToArray());
  }

  [Fact]
  public async Task AcceptedFlowRelaysOnlyExactFramedRequestAndSupervisorMeasurement()
  {
    var connector = new RelayingConnector();
    var transport = new NamedPipeEgressSupervisorExternalActionTransport(
      Control(enabled: true),
      Flow(enabled: true),
      connector);
    using var binding = Binding();
    var exactRequest = "exact-supervisor-validated-template"u8.ToArray();

    var result = await transport.SendAsync(
      Endpoint(),
      binding,
      exactRequest,
      1_024,
      TimeSpan.FromSeconds(1),
      CancellationToken.None);

    Assert.True(result.RequestDispatched);
    Assert.Equal(321, result.ChargedEgressBytes);
    Assert.Equal("HTTP/1.1 204 No Content\r\n\r\n"u8.ToArray(), result.ResponseBytes);
    Assert.Equal(exactRequest, connector.ExactRequest);
    Assert.False(connector.RawStreamRequested);
  }

  [Theory]
  [InlineData(true, 100, 1_000, 5_000)]
  [InlineData(false, 1_000, 100, 5_000)]
  [InlineData(false, 1_000, 5_000, 100)]
  public async Task PipeConnectOverallAndLeaseDeadlinesCancelSlowPaths(
    bool blockConnect,
    int pipeConnectMilliseconds,
    int operationMilliseconds,
    int leaseRemainingMilliseconds)
  {
    var connector = new BlockingConnector(blockConnect);
    var control = Control(enabled: true);
    control.ConnectTimeoutMilliseconds = pipeConnectMilliseconds;
    control.OperationTimeoutMilliseconds = operationMilliseconds;
    var transport = new NamedPipeEgressSupervisorExternalActionTransport(
      control,
      Flow(enabled: true),
      connector);
    using var binding = Binding(
      leaseExpiresAtUnixMilliseconds:
        DateTimeOffset.UtcNow.AddMilliseconds(leaseRemainingMilliseconds)
          .ToUnixTimeMilliseconds());
    var stopwatch = Stopwatch.StartNew();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
      await transport.SendAsync(
        Endpoint(),
        binding,
        "request"u8.ToArray(),
        1_024,
        TimeSpan.FromSeconds(1),
        CancellationToken.None));

    Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(2));
    Assert.True(connector.CancellationObserved);
  }

  [Theory]
  [InlineData("S-1-5-80-1-2-3-4-5", true)]
  [InlineData("S-1-5-80-0-0-0-0-0", false)]
  [InlineData("S-1-5-18", false)]
  [InlineData("S-1-5-80-not-a-sid", false)]
  public void ProcessPeerGrantAcceptsOnlyCanonicalNonPlaceholderServiceSids(
    string value,
    bool expected) => Assert.Equal(
      expected,
      TrustedSupervisorProcessAccessGrant.IsCanonicalRestrictedServiceSid(value));

  private static EgressSupervisorClientOptions Control(bool enabled) => new()
  {
    Enabled = enabled,
    Transport = enabled ? "named-pipe-v2" : "disabled",
    ProtocolVersion = EgressSupervisorPipeProtocol.Version,
    PipeName = enabled ? "Itemba.Msaidizi.EgressSupervisor.v2" : string.Empty,
    ExpectedSupervisorImagePath = enabled
      ? @"C:\Program Files\Itemba\Msaidizi Egress Supervisor\Itemba.Msaidizi.EgressSupervisor.exe"
      : string.Empty,
    ExpectedSupervisorImageSha256 = enabled ? new string('a', 64) : string.Empty,
    ExpectedSupervisorServiceSid = enabled
      ? EgressSupervisorClientOptions.RequiredSupervisorServiceSid
      : string.Empty,
    AttestationKeyId = enabled ? "egress-attestation-v1" : string.Empty,
    MaximumFrameBytes = 131_072,
    ConnectTimeoutMilliseconds = 5_000,
    OperationTimeoutMilliseconds = 10_000,
  };

  private static EgressSupervisorFlowClientOptions Flow(bool enabled) => new()
  {
    Enabled = enabled,
    ProtocolVersion = EgressSupervisorLifecycleContract.Version,
    PipeName = enabled
      ? "Itemba.Msaidizi.EgressSupervisor.Flow.v2"
      : string.Empty,
    MaximumFlowFrameBytes = 16_384,
  };

  private static ExternalActionEgressFlowBinding Binding(
    byte[]? nonce = null,
    long? leaseExpiresAtUnixMilliseconds = null) => new(
    new string('b', 64),
    "10000000-0000-4000-8000-000000000001",
    nonce ?? RandomNumberGenerator.GetBytes(32),
    "gateway.example",
    443,
    new string('c', 64),
    100_000,
    leaseExpiresAtUnixMilliseconds
      ?? DateTimeOffset.UtcNow.AddMinutes(1).ToUnixTimeMilliseconds());

  private static ExternalActionEndpoint Endpoint() => new(
    "gateway",
    "email",
    "external.email.send",
    new Uri("https://gateway.example/v1/action"),
    new string('d', 64),
    "20000000-0000-4000-8000-000000000002",
    new string('e', 64),
    "Bearer ",
    new string('c', 64));

  private sealed class RefusingConnector : IEgressSupervisorPipeConnector
  {
    public string? PipeName { get; private set; }

    public byte[]? Request { get; private set; }

    public ValueTask<IEgressSupervisorPipeConnection> ConnectAsync(
      EgressSupervisorClientOptions options,
      CancellationToken cancellationToken)
    {
      PipeName = options.PipeName;
      return ValueTask.FromResult<IEgressSupervisorPipeConnection>(
        new Connection(this));
    }

    private sealed class Connection(RefusingConnector owner) :
      IEgressSupervisorPipeConnection
    {
      public Stream RawStream => throw new InvalidOperationException(
        "TLS must not start after a refused flow claim.");

      public void ThrowIfUnavailable() => throw new InvalidOperationException(
        "TLS must not start after a refused flow claim.");

      public ValueTask WriteFrameAsync(
        ReadOnlyMemory<byte> frame,
        CancellationToken cancellationToken)
      {
        owner.Request = frame.ToArray();
        return ValueTask.CompletedTask;
      }

      public ValueTask<ReadOnlyMemory<byte>> ReadFrameAsync(
        int maximumFrameBytes,
        CancellationToken cancellationToken) =>
        ValueTask.FromResult<ReadOnlyMemory<byte>>(
          JsonSerializer.SerializeToUtf8Bytes(
            new EgressFlowOpenResponseV1(
              EgressSupervisorLifecycleContract.Version,
              false,
              string.Empty,
              "test_flow_refused"),
            WebJson));

      public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
  }

  private sealed class RelayingConnector : IEgressSupervisorPipeConnector
  {
    public byte[]? ExactRequest { get; private set; }

    public bool RawStreamRequested { get; private set; }

    public ValueTask<IEgressSupervisorPipeConnection> ConnectAsync(
      EgressSupervisorClientOptions options,
      CancellationToken cancellationToken) =>
      ValueTask.FromResult<IEgressSupervisorPipeConnection>(new Connection(this));

    private sealed class Connection(RelayingConnector owner) :
      IEgressSupervisorPipeConnection
    {
      private int _writeCount;
      private int _readCount;

      public Stream RawStream
      {
        get
        {
          owner.RawStreamRequested = true;
          throw new InvalidOperationException("Companion must never own TLS.");
        }
      }

      public void ThrowIfUnavailable()
      {
      }

      public ValueTask WriteFrameAsync(
        ReadOnlyMemory<byte> frame,
        CancellationToken cancellationToken)
      {
        cancellationToken.ThrowIfCancellationRequested();
        if (Interlocked.Increment(ref _writeCount) == 2)
        {
          owner.ExactRequest = frame.ToArray();
        }
        return ValueTask.CompletedTask;
      }

      public ValueTask<ReadOnlyMemory<byte>> ReadFrameAsync(
        int maximumFrameBytes,
        CancellationToken cancellationToken)
      {
        cancellationToken.ThrowIfCancellationRequested();
        return Interlocked.Increment(ref _readCount) switch
        {
          1 => ValueTask.FromResult<ReadOnlyMemory<byte>>(
            JsonSerializer.SerializeToUtf8Bytes(
              new EgressFlowOpenResponseV1(
                EgressSupervisorLifecycleContract.Version,
                true,
                Guid.NewGuid().ToString("D"),
                "accepted"),
              WebJson)),
          2 => ValueTask.FromResult<ReadOnlyMemory<byte>>(
            JsonSerializer.SerializeToUtf8Bytes(
              new EgressFlowTransferResponseV1(
                EgressSupervisorLifecycleContract.Version,
                true,
                321,
                "HTTP/1.1 204 No Content\r\n\r\n"u8.Length,
                "completed"),
              WebJson)),
          3 => ValueTask.FromResult<ReadOnlyMemory<byte>>(
            "HTTP/1.1 204 No Content\r\n\r\n"u8.ToArray()),
          _ => throw new InvalidOperationException(),
        };
      }

      public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
  }

  private sealed class BlockingConnector(bool blockConnect) : IEgressSupervisorPipeConnector
  {
    public bool CancellationObserved { get; private set; }

    public async ValueTask<IEgressSupervisorPipeConnection> ConnectAsync(
      EgressSupervisorClientOptions options,
      CancellationToken cancellationToken)
    {
      if (blockConnect)
      {
        try
        {
          await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        }
        catch (OperationCanceledException)
        {
          CancellationObserved = true;
          throw;
        }
      }
      return new Connection(this);
    }

    private sealed class Connection(BlockingConnector owner) :
      IEgressSupervisorPipeConnection
    {
      public Stream RawStream => throw new InvalidOperationException();

      public void ThrowIfUnavailable()
      {
      }

      public ValueTask WriteFrameAsync(
        ReadOnlyMemory<byte> frame,
        CancellationToken cancellationToken) => ValueTask.CompletedTask;

      public async ValueTask<ReadOnlyMemory<byte>> ReadFrameAsync(
        int maximumFrameBytes,
        CancellationToken cancellationToken)
      {
        try
        {
          await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
          throw new InvalidOperationException();
        }
        catch (OperationCanceledException)
        {
          owner.CancellationObserved = true;
          throw;
        }
      }

      public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
  }
}
