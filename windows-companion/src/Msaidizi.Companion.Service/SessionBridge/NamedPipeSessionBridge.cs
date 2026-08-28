using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Contracts.SessionBridge;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.SessionBridge;

internal sealed record SessionSecretBinding(
  string BindingId,
  string DestinationScopeSha256,
  ReadOnlyMemory<byte> Plaintext);

internal interface IUserSessionBridge
{
  bool IsConnected { get; }

  int? SessionId { get; }

  SessionAgentHeartbeat? LatestHeartbeat { get; }

  ValueTask<CapabilityExecutionResult> ExecuteAsync(
    CapabilityDescriptor descriptor,
    ActionExecutionContext context,
    JsonElement arguments,
    SessionSecretBinding? secretBinding,
    CancellationToken cancellationToken);
}

/// <summary>
/// LocalSystem-owned, local-only bridge for the active standard-user session.
/// Pipe ACLs deny network logons; the service verifies the kernel-reported
/// client PID/SID/session and a pinned executable hash. The agent separately
/// verifies a device-certificate signature. Ephemeral ECDH keys authenticate
/// and sequence every subsequent frame.
/// </summary>
internal sealed class NamedPipeSessionBridge : BackgroundService, IUserSessionBridge
{
  private static readonly JsonSerializerOptions SerializerOptions =
    new(JsonSerializerDefaults.Web);
  private static readonly Action<ILogger, string, Exception?> LogConnectionFailure =
    LoggerMessage.Define<string>(
      LogLevel.Warning,
      new EventId(3100, nameof(LogConnectionFailure)),
      "A local session bridge connection failed with {ExceptionType}.");
  private readonly SessionBridgeOptions _options;
  private readonly CompanionOptions _companion;
  private readonly EgressSupervisorClientOptions _egressOptions;
  private readonly IDeviceIdentityProvisioner _identity;
  private readonly ICapabilityBoundaryAttestationProvider _capabilityBoundary;
  private readonly ILogger<NamedPipeSessionBridge> _logger;
  private readonly object _sessionGate = new();
  private readonly ConcurrentDictionary<long, Task> _connections = new();
  private AgentSession? _session;
  private long _connectionSequence;

  public NamedPipeSessionBridge(
    IOptions<SessionBridgeOptions> options,
    IOptions<CompanionOptions> companion,
    IOptions<EgressSupervisorClientOptions> egressOptions,
    IDeviceIdentityProvisioner identity,
    ICapabilityBoundaryAttestationProvider capabilityBoundary,
    ILogger<NamedPipeSessionBridge> logger)
  {
    _options = options.Value;
    _companion = companion.Value;
    _egressOptions = egressOptions.Value;
    _identity = identity;
    _capabilityBoundary = capabilityBoundary;
    _logger = logger;
  }

  public bool IsConnected
  {
    get
    {
      lock (_sessionGate)
      {
        return _session?.IsReady == true;
      }
    }
  }

  public int? SessionId
  {
    get
    {
      lock (_sessionGate)
      {
        return _session?.SessionId;
      }
    }
  }

  public SessionAgentHeartbeat? LatestHeartbeat
  {
    get
    {
      lock (_sessionGate)
      {
        return _session?.LatestHeartbeat;
      }
    }
  }

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    CapabilityDescriptor descriptor,
    ActionExecutionContext context,
    JsonElement arguments,
    SessionSecretBinding? secretBinding,
    CancellationToken cancellationToken)
  {
    AgentSession session;
    lock (_sessionGate)
    {
      session = _session is { IsReady: true } current
        ? current
        : throw new HostPreconditionException("interactive_session_agent_unavailable");
    }

    var heartbeat = session.LatestHeartbeat;
    if (heartbeat is null
      || heartbeat.SentAt < DateTimeOffset.UtcNow.Subtract(TimeSpan.FromSeconds(
        Math.Clamp(_options.HeartbeatTtlSeconds, 10, 300)))
      || !heartbeat.ExecutionEnabled
      || heartbeat.KillSwitchEngaged)
    {
      throw new HostPreconditionException("interactive_session_agent_unhealthy");
    }

    return await session.ExecuteAsync(
      descriptor,
      context,
      arguments,
      secretBinding,
      cancellationToken).ConfigureAwait(false);
  }

  protected override async Task ExecuteAsync(CancellationToken stoppingToken)
  {
    ValidateConfiguration();
    while (!stoppingToken.IsCancellationRequested)
    {
      var pipe = CreatePipe();
      try
      {
        await pipe.WaitForConnectionAsync(stoppingToken).ConfigureAwait(false);
      }
      catch
      {
        await pipe.DisposeAsync().ConfigureAwait(false);
        throw;
      }

      var id = Interlocked.Increment(ref _connectionSequence);
      var task = HandleConnectionAsync(pipe, stoppingToken);
      _connections.TryAdd(id, task);
      _ = task.ContinueWith(
        completed =>
        {
          _connections.TryRemove(id, out _);
          _ = completed.Exception;
        },
        CancellationToken.None,
        TaskContinuationOptions.ExecuteSynchronously,
        TaskScheduler.Default);
    }
  }

  public override async Task StopAsync(CancellationToken cancellationToken)
  {
    AgentSession? session;
    lock (_sessionGate)
    {
      session = _session;
      _session = null;
    }

    if (session is not null)
    {
      await session.DisposeAsync().ConfigureAwait(false);
    }

    await base.StopAsync(cancellationToken).ConfigureAwait(false);
    await Task.WhenAll(_connections.Values.Select(ObserveAsync)).ConfigureAwait(false);
  }

  private async Task HandleConnectionAsync(
    NamedPipeServerStream pipe,
    CancellationToken stoppingToken)
  {
    AgentSession? authenticated = null;
    try
    {
      authenticated = await AuthenticateAsync(pipe, stoppingToken).ConfigureAwait(false);
      AgentSession? replaced;
      lock (_sessionGate)
      {
        replaced = _session;
        _session = authenticated;
      }

      if (replaced is not null)
      {
        await replaced.DisposeAsync().ConfigureAwait(false);
      }

      await authenticated.RunReceiveLoopAsync(stoppingToken).ConfigureAwait(false);
    }
    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
    {
      // Expected on service shutdown.
    }
    catch (Exception exception)
    {
      LogConnectionFailure(_logger, exception.GetType().Name, exception);
    }
    finally
    {
      if (authenticated is not null)
      {
        lock (_sessionGate)
        {
          if (ReferenceEquals(_session, authenticated))
          {
            _session = null;
          }
        }

        await authenticated.DisposeAsync().ConfigureAwait(false);
      }
      else
      {
        await pipe.DisposeAsync().ConfigureAwait(false);
      }
    }
  }

  private async ValueTask<AgentSession> AuthenticateAsync(
    NamedPipeServerStream pipe,
    CancellationToken cancellationToken)
  {
    var hello = await SessionBridgeWire.ReadAsync<SessionAgentHello>(
      pipe,
      MaximumFrameBytes,
      cancellationToken).ConfigureAwait(false);
    var actualProcessId = GetClientProcessId(pipe.SafePipeHandle);
    using var process = Process.GetProcessById(actualProcessId);
    var actualSessionId = process.SessionId;
    var actualProcessCreationTimeUnixMilliseconds = new DateTimeOffset(
      process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds();
    string? actualSid = null;
    pipe.RunAsClient(() =>
    {
      using var identity = WindowsIdentity.GetCurrent(TokenAccessLevels.Query);
      actualSid = identity.User?.Value;
    });
    var actualImageSha256 = ValidateAgentExecutable(process);
    ValidateHello(
      hello,
      actualProcessId,
      actualProcessCreationTimeUnixMilliseconds,
      actualImageSha256,
      actualSessionId,
      actualSid);

    VerifiedCapabilityBoundaryAttestation? capabilityBoundaryAttestation = null;
    if (hello.BrowserExternalEffectsRequested || hello.EmergencyCommandRequested)
    {
      var nonce = Convert.FromBase64String(hello.AgentNonceBase64);
      string nonceSha256;
      try
      {
        nonceSha256 = Convert.ToHexString(SHA256.HashData(nonce)).ToLowerInvariant();
      }
      finally
      {
        CryptographicOperations.ZeroMemory(nonce);
      }
      var request = new CapabilityBoundaryAttestationRequestV1(
        CapabilityBoundaryAttestationContract.Version,
        Guid.NewGuid().ToString("D"),
        nonceSha256,
        hello.DeviceId,
        CapabilityBoundaryAttestationContract.SessionAgentRole,
        hello.ProcessId,
        hello.ProcessCreationTimeUnixMilliseconds,
        hello.SubjectImageSha256,
        hello.BrowserExternalEffectsRequested,
        hello.EmergencyCommandRequested,
        hello.CapabilityManifestSha256,
        hello.DestinationPolicySha256,
        CapabilityBoundaryAttestationContract.CapabilityCatalogVersion,
        EgressBoundaryCanonical.ContractVersion,
        _egressOptions.ProtocolVersion,
        SessionBridgeProtocol.Version,
        hello.CreatedAt.ToUnixTimeMilliseconds());
      capabilityBoundaryAttestation = await _capabilityBoundary.TryAttestAsync(
        request,
        cancellationToken).ConfigureAwait(false)
        ?? throw new CryptographicException(
          "The independently privileged capability boundary did not attest the session agent.");
    }

    using var deviceIdentity = await _identity.GetOrCreateAsync(
      _companion.DeviceId,
      cancellationToken).ConfigureAwait(false);
    if (!deviceIdentity.IsPaired)
    {
      throw new CryptographicException("The device identity is not paired.");
    }

    using var localEcdh = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    using var remoteEcdh = ECDiffieHellman.Create();
    var remotePublicKey = Convert.FromBase64String(hello.AgentEphemeralPublicKeyBase64);
    try
    {
      remoteEcdh.ImportSubjectPublicKeyInfo(remotePublicKey, out var consumed);
      if (consumed != remotePublicKey.Length)
      {
        throw new CryptographicException("The agent ephemeral key has trailing data.");
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(remotePublicKey);
    }

    var serviceNonce = RandomNumberGenerator.GetBytes(32);
    SessionServiceChallenge unsigned;
    try
    {
      unsigned = new SessionServiceChallenge(
        SessionBridgeProtocol.Version,
        _companion.DeviceId,
        actualSessionId,
        hello.AgentNonceBase64,
        Convert.ToBase64String(serviceNonce),
        Convert.ToBase64String(localEcdh.ExportSubjectPublicKeyInfo()),
        deviceIdentity.Certificate.Thumbprint,
        deviceIdentity.CertificateSha256.ToLowerInvariant(),
        DateTimeOffset.UtcNow.AddSeconds(60),
        capabilityBoundaryAttestation?.SignedAttestation,
        string.Empty);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(serviceNonce);
    }

    var transcript = SessionBridgeAuthentication.CreateChallengeTranscript(hello, unsigned);
    var transcriptSha256 = Convert.ToHexString(SHA256.HashData(transcript)).ToLowerInvariant();
    string signature;
    using (var signingKey = deviceIdentity.Certificate.GetECDsaPrivateKey()
      ?? throw new CryptographicException("The device identity private key is unavailable."))
    {
      signature = Convert.ToBase64String(signingKey.SignData(
        transcript,
        HashAlgorithmName.SHA256));
    }

    CryptographicOperations.ZeroMemory(transcript);
    var challenge = unsigned with { SignatureBase64 = signature };
    await SessionBridgeWire.WriteAsync(
      pipe,
      challenge,
      MaximumFrameBytes,
      cancellationToken).ConfigureAwait(false);
    var sessionKey = SessionBridgeAuthentication.DeriveSessionKey(
      localEcdh,
      remoteEcdh.PublicKey,
      hello.AgentNonceBase64,
      challenge.ServiceNonceBase64,
      transcriptSha256);
    try
    {
      var ready = await SessionBridgeWire.ReadAsync<SessionAgentReady>(
        pipe,
        MaximumFrameBytes,
        cancellationToken).ConfigureAwait(false);
      if (ready.ProtocolVersion != SessionBridgeProtocol.Version
        || !string.Equals(ready.DeviceId, _companion.DeviceId, StringComparison.Ordinal)
        || ready.SessionId != actualSessionId
        || !SessionBridgeAuthentication.FixedTimeEqualsHex(
          ready.TranscriptSha256,
          transcriptSha256)
        || !SessionBridgeAuthentication.FixedTimeEqualsHex(
          ready.MacSha256,
          SessionBridgeAuthentication.ComputeReadyMac(
            sessionKey,
            _companion.DeviceId,
            actualSessionId,
            transcriptSha256)))
      {
        throw new CryptographicException("The session agent ready proof is invalid.");
      }

      return new AgentSession(
        pipe,
        sessionKey,
        _companion.DeviceId,
        actualSessionId,
        _options,
        capabilityBoundaryAttestation,
        _logger);
    }
    catch
    {
      CryptographicOperations.ZeroMemory(sessionKey);
      throw;
    }
  }

  private void ValidateHello(
    SessionAgentHello hello,
    int actualProcessId,
    long actualProcessCreationTimeUnixMilliseconds,
    string actualImageSha256,
    int actualSessionId,
    string? actualSid)
  {
    var now = DateTimeOffset.UtcNow;
    if (hello.ProtocolVersion != SessionBridgeProtocol.Version
      || !string.Equals(hello.DeviceId, _companion.DeviceId, StringComparison.Ordinal)
      || hello.ProcessId != actualProcessId
      || hello.ProcessCreationTimeUnixMilliseconds
        != actualProcessCreationTimeUnixMilliseconds
      || !PayloadDigest.FixedTimeEqualsHex(
        hello.SubjectImageSha256,
        actualImageSha256)
      || hello.SessionId != actualSessionId
      || !string.Equals(hello.UserSid, actualSid, StringComparison.Ordinal)
      || hello.CreatedAt < now.AddMinutes(-1)
      || hello.CreatedAt > now.AddMinutes(1)
      || !TryDecodeExact(hello.AgentNonceBase64, 32)
      || string.IsNullOrWhiteSpace(hello.AgentEphemeralPublicKeyBase64)
      || hello.BrowserExternalEffectsRequested
        != _options.BrowserExternalEffectsEnabled
      || hello.EmergencyCommandRequested != _options.EmergencyCommandEnabled
      || !PayloadDigest.FixedTimeEqualsHex(
        hello.CapabilityManifestSha256,
        StandardUserCapabilityCatalog.RequestedManifestSha256(
          _options.BrowserExternalEffectsEnabled,
          _options.EmergencyCommandEnabled))
      || !string.Equals(
        hello.DestinationPolicySha256,
        _companion.EgressDestinationPolicySha256,
        StringComparison.Ordinal)
      || actualSid is null
      || IsServiceIdentity(actualSid)
      || (_options.RequireActiveConsoleSession
        && actualSessionId != checked((int)GetActiveConsoleSessionId())))
    {
      throw new UnauthorizedAccessException("The local session agent identity is invalid.");
    }
  }

  private string ValidateAgentExecutable(Process process)
  {
    var expected = _options.AllowedAgentExecutableSha256;
    var path = process.MainModule?.FileName
      ?? throw new UnauthorizedAccessException("The local session agent image is unavailable.");
    using var stream = new FileStream(
      Path.GetFullPath(path),
      FileMode.Open,
      FileAccess.Read,
      FileShare.Read | FileShare.Delete);
    var actual = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    if (!PayloadDigest.IsSha256Hex(expected)
      || !SessionBridgeAuthentication.FixedTimeEqualsHex(expected, actual))
    {
      throw new UnauthorizedAccessException("The local session agent image is not approved.");
    }

    return actual;
  }

  private NamedPipeServerStream CreatePipe()
  {
    var security = SessionPipeSecurity.Create();
    return NamedPipeServerStreamAcl.Create(
      _options.PipeName,
      PipeDirection.InOut,
      4,
      PipeTransmissionMode.Byte,
      PipeOptions.Asynchronous | PipeOptions.WriteThrough,
      65_536,
      65_536,
      security,
      HandleInheritability.None,
      PipeAccessRights.ChangePermissions);
  }

  private void ValidateConfiguration()
  {
    if (!_options.Enabled
      || string.IsNullOrWhiteSpace(_companion.DeviceId)
      || string.Equals(_companion.DeviceId, "UNENROLLED", StringComparison.Ordinal)
      || !IsSafePipeName(_options.PipeName)
      || !PayloadDigest.IsSha256Hex(_options.AllowedAgentExecutableSha256)
      || ((_options.BrowserExternalEffectsEnabled || _options.EmergencyCommandEnabled)
        && (!PayloadDigest.IsSha256Hex(_companion.EgressDestinationPolicySha256)
          || _egressOptions.ProtocolVersion <= 0
          || !PayloadDigest.IsSha256Hex(
            _egressOptions.ExpectedSupervisorPipeSecuritySha256)))
      || _options.MaximumFrameBytes is < 65_536 or > 16_777_216
      || _options.ActionTimeoutSeconds is < 1 or > 900
      || _options.HeartbeatTtlSeconds is < 10 or > 300)
    {
      throw new InvalidOperationException("The authenticated session bridge configuration is invalid.");
    }
  }

  private int MaximumFrameBytes => Math.Clamp(
    _options.MaximumFrameBytes,
    65_536,
    16_777_216);

  private static int GetClientProcessId(SafePipeHandle pipe)
  {
    if (!GetNamedPipeClientProcessId(pipe, out var processId)
      || processId is 0 or > int.MaxValue)
    {
      throw new UnauthorizedAccessException("The named-pipe client PID is unavailable.");
    }

    return checked((int)processId);
  }

  private static bool IsServiceIdentity(string sid) => sid is
    "S-1-5-18" or "S-1-5-19" or "S-1-5-20";

  private static bool TryDecodeExact(string value, int length)
  {
    try
    {
      var bytes = Convert.FromBase64String(value);
      try
      {
        return bytes.Length == length;
      }
      finally
      {
        CryptographicOperations.ZeroMemory(bytes);
      }
    }
    catch (FormatException)
    {
      return false;
    }
  }

  private static bool IsSafePipeName(string value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 240
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_');

  private static async Task ObserveAsync(Task task)
  {
    try
    {
      await task.ConfigureAwait(false);
    }
    catch
    {
      // Connection failures are logged at their origin.
    }
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetNamedPipeClientProcessId(
    SafePipeHandle pipe,
    out uint clientProcessId);

  [DllImport("kernel32.dll")]
  private static extern uint WTSGetActiveConsoleSessionId();

  private static uint GetActiveConsoleSessionId()
  {
    var sessionId = WTSGetActiveConsoleSessionId();
    return sessionId == uint.MaxValue
      ? throw new UnauthorizedAccessException("No active console session is available.")
      : sessionId;
  }

  private sealed class AgentSession : IAsyncDisposable
  {
    private readonly NamedPipeServerStream _pipe;
    private readonly byte[] _sessionKey;
    private readonly string _deviceId;
    private readonly int _sessionId;
    private readonly SessionBridgeOptions _options;
    private readonly VerifiedCapabilityBoundaryAttestation? _capabilityBoundaryAttestation;
    private readonly ILogger _logger;
    private readonly SemaphoreSlim _sendGate = new(1, 1);
    private readonly CancellationTokenSource _lifetime = new();
    private readonly ConcurrentDictionary<string, TaskCompletionSource<SessionActionCompletion>>
      _pending = new(StringComparer.Ordinal);
    private long _outboundSequence;
    private long _inboundSequence;
    private bool _manifestAccepted;
    private bool _disposed;

    public AgentSession(
      NamedPipeServerStream pipe,
      byte[] sessionKey,
      string deviceId,
      int sessionId,
      SessionBridgeOptions options,
      VerifiedCapabilityBoundaryAttestation? capabilityBoundaryAttestation,
      ILogger logger)
    {
      _pipe = pipe;
      _sessionKey = sessionKey;
      _deviceId = deviceId;
      _sessionId = sessionId;
      _options = options;
      _capabilityBoundaryAttestation = capabilityBoundaryAttestation;
      _logger = logger;
    }

    public bool IsReady => !_disposed
      && _pipe.IsConnected
      && _manifestAccepted
      && ((!_options.BrowserExternalEffectsEnabled && !_options.EmergencyCommandEnabled)
        || (_capabilityBoundaryAttestation?.IsFresh(DateTimeOffset.UtcNow) == true))
      && LatestHeartbeat is not null;

    public int SessionId => _sessionId;

    public SessionAgentHeartbeat? LatestHeartbeat { get; private set; }

    public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
      CapabilityDescriptor descriptor,
      ActionExecutionContext context,
      JsonElement arguments,
      SessionSecretBinding? secretBinding,
      CancellationToken cancellationToken)
    {
      if (!IsReady)
      {
        throw new HostPreconditionException("interactive_session_agent_unavailable");
      }

      var completion = new TaskCompletionSource<SessionActionCompletion>(
        TaskCreationOptions.RunContinuationsAsynchronously);
      if (!_pending.TryAdd(context.ActionId, completion))
      {
        throw new HostPreconditionException("interactive_session_action_duplicate");
      }

      var argumentsJson = arguments.GetRawText();
      var timeoutSeconds = Math.Min(
        context.Budgets.MaxWallTimeSeconds,
        _options.ActionTimeoutSeconds);
      var secretEnvelopes = secretBinding is null
        ? Array.Empty<SessionSecretEnvelope>()
        :
        [
          SessionSecretEnvelopeProtection.Protect(
            _sessionKey,
            context.ActionId,
            descriptor.Id,
            secretBinding.BindingId,
            secretBinding.DestinationScopeSha256,
            secretBinding.Plaintext.Span),
        ];
      var invocation = new SessionActionInvocation(
        descriptor.Id,
        descriptor.Version,
        context,
        argumentsJson,
        secretEnvelopes,
        DateTimeOffset.UtcNow.AddSeconds(timeoutSeconds));
      try
      {
        await SendAsync(
          SessionBridgeProtocol.Execute,
          context.ActionId,
          invocation,
          cancellationToken).ConfigureAwait(false);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
          cancellationToken,
          _lifetime.Token);
        timeout.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));
        SessionActionCompletion result;
        try
        {
          result = await completion.Task.WaitAsync(timeout.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
          await TrySendCancelAsync(context).ConfigureAwait(false);
          throw;
        }

        if (!string.Equals(result.ActionId, context.ActionId, StringComparison.Ordinal)
          || !string.Equals(result.TaskId, context.TaskId, StringComparison.Ordinal)
          || !string.Equals(result.StepId, context.StepId, StringComparison.Ordinal))
        {
          throw new CryptographicException("The session completion scope is invalid.");
        }

        return result.Outcome switch
        {
          ActionOutcome.Completed when result.Result is not null => result.Result,
          ActionOutcome.NeedsAttention when result.Result is not null => result.Result with
          {
            OutcomeUncertain = true,
          },
          ActionOutcome.NeedsAttention => throw new InvalidOperationException(
            result.ErrorCode ?? "interactive_session_outcome_unknown"),
          ActionOutcome.Cancelled => throw new OperationCanceledException(
            "The standard-user action was cancelled.",
            cancellationToken),
          _ => throw new HostPreconditionException(
            IsSafeErrorCode(result.ErrorCode)
              ? result.ErrorCode!
              : "interactive_session_action_failed"),
        };
      }
      finally
      {
        _pending.TryRemove(context.ActionId, out _);
      }
    }

    public async Task RunReceiveLoopAsync(CancellationToken stoppingToken)
    {
      using var linked = CancellationTokenSource.CreateLinkedTokenSource(
        stoppingToken,
        _lifetime.Token);
      while (!linked.Token.IsCancellationRequested)
      {
        var frame = await SessionBridgeWire.ReadAsync<AuthenticatedSessionFrame>(
          _pipe,
          Math.Clamp(_options.MaximumFrameBytes, 65_536, 16_777_216),
          linked.Token).ConfigureAwait(false);
        var sequence = Interlocked.Increment(ref _inboundSequence);
        if (frame.Sequence != sequence
          || !IsSafeToken(frame.Kind, 40)
          || !IsSafeToken(frame.CorrelationId, 256)
          || !SessionBridgeAuthentication.FixedTimeEqualsHex(
            frame.MacSha256,
            SessionBridgeAuthentication.ComputeFrameMac(
              _sessionKey,
              frame.Sequence,
              frame.Kind,
              frame.CorrelationId,
              frame.PayloadJson)))
        {
          throw new CryptographicException("A session agent frame failed authentication.");
        }

        switch (frame.Kind)
        {
          case SessionBridgeProtocol.Manifest:
            AcceptManifest(Deserialize<SessionAgentManifest>(frame.PayloadJson));
            break;
          case SessionBridgeProtocol.Heartbeat:
            AcceptHeartbeat(Deserialize<SessionAgentHeartbeat>(frame.PayloadJson));
            break;
          case SessionBridgeProtocol.Completion:
            AcceptCompletion(Deserialize<SessionActionCompletion>(frame.PayloadJson));
            break;
          default:
            throw new InvalidDataException("The session agent sent an unsupported frame.");
        }
      }
    }

    public async ValueTask DisposeAsync()
    {
      if (_disposed)
      {
        return;
      }

      _disposed = true;
      await _lifetime.CancelAsync().ConfigureAwait(false);
      foreach (var pending in _pending.Values)
      {
        pending.TrySetException(new IOException("The interactive session disconnected."));
      }

      CryptographicOperations.ZeroMemory(_sessionKey);
      await _pipe.DisposeAsync().ConfigureAwait(false);
      _sendGate.Dispose();
      _lifetime.Dispose();
    }

    private async ValueTask SendAsync<T>(
      string kind,
      string correlationId,
      T payload,
      CancellationToken cancellationToken)
    {
      await _sendGate.WaitAsync(cancellationToken).ConfigureAwait(false);
      try
      {
        var sequence = Interlocked.Increment(ref _outboundSequence);
        var payloadJson = JsonSerializer.Serialize(payload, SerializerOptions);
        var frame = new AuthenticatedSessionFrame(
          sequence,
          kind,
          correlationId,
          payloadJson,
          SessionBridgeAuthentication.ComputeFrameMac(
            _sessionKey,
            sequence,
            kind,
            correlationId,
            payloadJson));
        await SessionBridgeWire.WriteAsync(
          _pipe,
          frame,
          Math.Clamp(_options.MaximumFrameBytes, 65_536, 16_777_216),
          cancellationToken).ConfigureAwait(false);
      }
      finally
      {
        _sendGate.Release();
      }
    }

    private async Task TrySendCancelAsync(ActionExecutionContext context)
    {
      try
      {
        await SendAsync(
          SessionBridgeProtocol.Cancel,
          context.ActionId,
          new SessionCancelInvocation(
            context.ActionId,
            context.TaskId,
            "service_cancelled_or_timed_out",
            DateTimeOffset.UtcNow),
          CancellationToken.None).ConfigureAwait(false);
      }
      catch (Exception exception)
      {
        LogConnectionFailure(_logger, exception.GetType().Name, exception);
      }
    }

    private void AcceptManifest(SessionAgentManifest manifest)
    {
      var reviewedCapabilities = StandardUserCapabilityCatalog.SelectEnabled(
        _options.BrowserExternalEffectsEnabled,
        _options.EmergencyCommandEnabled,
        _capabilityBoundaryAttestation);
      var expected = reviewedCapabilities
        .Select(descriptor => $"{descriptor.Id}\u001f{descriptor.Version}")
        .ToHashSet(StringComparer.Ordinal);
      var actual = manifest.Capabilities
        .Select(descriptor => $"{descriptor.Id}\u001f{descriptor.Version}")
        .ToHashSet(StringComparer.Ordinal);
      var digest = StandardUserCapabilityCatalog.ManifestSha256(manifest.Capabilities);
      var reviewedDigest = StandardUserCapabilityCatalog.ManifestSha256(
        reviewedCapabilities);
      if (!string.Equals(manifest.DeviceId, _deviceId, StringComparison.Ordinal)
        || manifest.SessionId != _sessionId
        || !expected.SetEquals(actual)
        || manifest.Capabilities.Count != expected.Count
        || !PayloadDigest.FixedTimeEqualsHex(manifest.ManifestSha256, digest)
        || !PayloadDigest.FixedTimeEqualsHex(manifest.ManifestSha256, reviewedDigest)
        || manifest.Capabilities.Any(descriptor => descriptor.TouchesTrustedRoot))
      {
        throw new CryptographicException("The standard-user capability manifest is invalid.");
      }

      _manifestAccepted = true;
    }

    private void AcceptHeartbeat(SessionAgentHeartbeat heartbeat)
    {
      var now = DateTimeOffset.UtcNow;
      if (!_manifestAccepted
        || !string.Equals(heartbeat.DeviceId, _deviceId, StringComparison.Ordinal)
        || heartbeat.SessionId != _sessionId
        || heartbeat.RunningActionCount is < 0 or > 100
        || heartbeat.SentAt < now.AddMinutes(-2)
        || heartbeat.SentAt > now.AddMinutes(1))
      {
        throw new CryptographicException("The standard-user heartbeat is invalid.");
      }

      LatestHeartbeat = heartbeat;
    }

    private void AcceptCompletion(SessionActionCompletion completion)
    {
      if (!_pending.TryGetValue(completion.ActionId, out var pending))
      {
        throw new CryptographicException("The session completion was not requested.");
      }

      pending.TrySetResult(completion);
    }

    private static T Deserialize<T>(string json)
    {
      using var document = JsonDocument.Parse(json, new JsonDocumentOptions
      {
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = 32,
      });
      return document.Deserialize<T>(SerializerOptions)
        ?? throw new InvalidDataException("A session agent payload was empty.");
    }

    private static bool IsSafeToken(string value, int maximumLength) =>
      !string.IsNullOrWhiteSpace(value)
      && value.Length <= maximumLength
      && value.All(character => char.IsAsciiLetterOrDigit(character)
        || character is '.' or '-' or '_' or ':');

    private static bool IsSafeErrorCode(string? value) => value is not null
      && IsSafeToken(value, 100);
  }
}

internal static class SessionPipeSecurity
{
  public static PipeSecurity Create()
  {
    var security = new PipeSecurity();
    security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
    security.AddAccessRule(new PipeAccessRule(
      new SecurityIdentifier(WellKnownSidType.NetworkSid, null),
      PipeAccessRights.ReadWrite,
      AccessControlType.Deny));
    security.AddAccessRule(new PipeAccessRule(
      new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
      PipeAccessRights.FullControl,
      AccessControlType.Allow));
    security.AddAccessRule(new PipeAccessRule(
      new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null),
      PipeAccessRights.ReadWrite,
      AccessControlType.Allow));
    return security;
  }
}

internal sealed class SessionCapabilityProxyAdapter(
  CapabilityDescriptor descriptor,
  IUserSessionBridge bridge,
  IHostSecretReferenceVault secretVault,
  ICapabilityBoundaryActivationState activationState) :
  IHostCapabilityAdapter,
  IEgressLifecycleCapabilityAdapter,
  IRuntimeCapabilityAvailability
{
  public CapabilityDescriptor Descriptor { get; } = descriptor;

  public bool IsAvailable => activationState.IsCapabilityAvailable(Descriptor)
    && (!StandardUserCapabilityCatalog.RequiresEgressBoundary(Descriptor.Id)
      || bridge.IsConnected);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    StandardUserCapabilityContractValidator.ValidateArguments(Descriptor.Id, arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    StandardUserCapabilityContractValidator.ValidateResult(Descriptor.Id, result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    if (StandardUserCapabilityCatalog.RequiresEgressBoundary(Descriptor.Id))
    {
      throw new HostPreconditionException("session_egress_lifecycle_entry_point_required");
    }
    return ExecuteCoreAsync(context, arguments, cancellationToken);
  }

  public async ValueTask<CapabilityExecutionResult> ExecuteWithEgressAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    IEgressBoundarySession session,
    CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(session);
    if (!SupportsBrowserEgressLifecycle(Descriptor))
    {
      // A proxy cannot guess a process-tree boundary for emergency commands or
      // any future metered surface. Those adapters need their own reviewed
      // registration path before entering the standard-user process.
      throw new HostPreconditionException("session_egress_registration_kind_unsupported");
    }

    await RegisterBrowserBoundaryAsync(context, arguments, session, cancellationToken)
      .ConfigureAwait(false);
    return await ExecuteCoreAsync(context, arguments, cancellationToken).ConfigureAwait(false);
  }

  internal static bool SupportsBrowserEgressLifecycle(CapabilityDescriptor descriptor)
  {
    var required = StandardUserCapabilityCatalog.RequiredBoundaryFeatures(descriptor.Id);
    return required.Contains(EgressBoundaryFeatures.BrowserOriginAttested, StringComparer.Ordinal)
      && required.Contains(
        EgressBoundaryFeatures.BrowserCompletionAttested,
        StringComparer.Ordinal);
  }

  private ValueTask<CapabilityExecutionResult> ExecuteCoreAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var requirement = BrowserSecretDestination.Resolve(Descriptor.Id, arguments);
    if (requirement is null)
    {
      return bridge.ExecuteAsync(
        Descriptor,
        context,
        arguments,
        secretBinding: null,
        cancellationToken);
    }

    return secretVault.UseAsync(
      requirement.ReferenceId,
      Descriptor.Id,
      requirement.DestinationScopeSha256,
      (plaintext, callbackCancellation) => bridge.ExecuteAsync(
        Descriptor,
        context,
        arguments,
        new SessionSecretBinding(
          requirement.BindingId,
          requirement.DestinationScopeSha256,
          plaintext),
        callbackCancellation),
      cancellationToken);
  }

  private async ValueTask RegisterBrowserBoundaryAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    IEgressBoundarySession session,
    CancellationToken cancellationToken)
  {
    var lease = session.Authorization.Lease.Lease;
    var attestation = session.Authorization.Attestation.Attestation;
    var sessionId = bridge.SessionId;
    var browserBrokerBuildSha256 = attestation.BrowserBrokerBuildSha256;
    if (context.EgressAuthorization is null
      || sessionId is null or <= 0
      || browserBrokerBuildSha256 is null
      || !PayloadDigest.IsSha256Hex(browserBrokerBuildSha256)
      || !arguments.TryGetProperty("processId", out var processIdValue)
      || !processIdValue.TryGetInt32(out var processId)
      || processId <= 0
      || !arguments.TryGetProperty("originSha256", out var originValue)
      || originValue.ValueKind != JsonValueKind.String
      || originValue.GetString() is not { } originSha256
      || !PayloadDigest.IsSha256Hex(originSha256)
      || !PayloadDigest.IsSha256Hex(context.ActionTokenSha256 ?? string.Empty)
      || !PayloadDigest.IsSha256Hex(context.ArgumentsSha256 ?? string.Empty)
      || !PayloadDigest.FixedTimeEqualsHex(context.ActionTokenSha256!, lease.ActionTokenSha256)
      || !PayloadDigest.FixedTimeEqualsHex(context.ArgumentsSha256!, lease.ArgumentsSha256)
      || !PayloadDigest.FixedTimeEqualsHex(
        EgressBoundaryCanonical.LeaseSha256(context.EgressAuthorization.Lease.Lease),
        EgressBoundaryCanonical.LeaseSha256(lease))
      || !PayloadDigest.FixedTimeEqualsHex(
        EgressBoundaryCanonical.AttestationSha256(
          context.EgressAuthorization.Attestation.Attestation),
        EgressBoundaryCanonical.AttestationSha256(
          session.Authorization.Attestation.Attestation))
      || !string.Equals(context.ActionId, lease.ActionId, StringComparison.Ordinal)
      || !string.Equals(context.TaskId, lease.TaskId, StringComparison.Ordinal)
      || !string.Equals(context.PlanVersionId, lease.PlanVersionId, StringComparison.Ordinal)
      || !string.Equals(context.StepId, lease.StepId, StringComparison.Ordinal)
      || !string.Equals(context.DeviceId, lease.DeviceId, StringComparison.Ordinal)
      || !string.Equals(context.MandateId, lease.MandateId, StringComparison.Ordinal)
      || !string.Equals(Descriptor.Id, lease.CapabilityId, StringComparison.Ordinal)
      || !string.Equals(Descriptor.Version, lease.CapabilityVersion, StringComparison.Ordinal)
      || context.DispatchCount != lease.DispatchCount
      || context.Budgets.MaxExternalEgressBytes != lease.ReservedCapabilityEgressBytes)
    {
      throw new HostPreconditionException("session_browser_egress_binding_invalid");
    }

    var registrationId = EgressSupervisorLifecycleCanonical.OperationId(
      context.ActionId,
      $"browser:{sessionId.Value}:{processId}");
    var completionNonceSha256 = PayloadDigest.Sha256Hex(string.Join('\n',
      "itemba-browser-completion-nonce/v1",
      context.ActionId,
      context.ArgumentsSha256,
      sessionId.Value.ToString(System.Globalization.CultureInfo.InvariantCulture),
      processId.ToString(System.Globalization.CultureInfo.InvariantCulture)));
    var registration = new EgressBrowserRegistrationV1(
      EgressSupervisorLifecycleContract.Version,
      registrationId,
      sessionId.Value,
      processId,
      originSha256.ToLowerInvariant(),
      browserBrokerBuildSha256.ToLowerInvariant(),
      completionNonceSha256);
    var acknowledgement = await session.TryRegisterBrowserAsync(
      registration,
      cancellationToken).ConfigureAwait(false);
    var expectedOperationId = EgressSupervisorLifecycleCanonical.OperationId(
      context.ActionId,
      $"register:{EgressSupervisorLifecycleContract.BrowserRegistration}:{registrationId}");
    if (acknowledgement is null
      || acknowledgement.ContractVersion != EgressSupervisorLifecycleContract.Version
      || !string.Equals(acknowledgement.OperationId, expectedOperationId, StringComparison.Ordinal)
      || !string.Equals(acknowledgement.RegistrationId, registrationId, StringComparison.Ordinal)
      || !string.Equals(
        acknowledgement.RegistrationKind,
        EgressSupervisorLifecycleContract.BrowserRegistration,
        StringComparison.Ordinal)
      || !PayloadDigest.FixedTimeEqualsHex(
        acknowledgement.LeaseSha256,
        EgressBoundaryCanonical.LeaseSha256(lease))
      || !PayloadDigest.FixedTimeEqualsHex(
        acknowledgement.RegistrationSha256,
        EgressSupervisorLifecycleCanonical.RegistrationSha256(registration)))
    {
      throw new HostPreconditionException("session_browser_egress_registration_not_acknowledged");
    }
  }
}
