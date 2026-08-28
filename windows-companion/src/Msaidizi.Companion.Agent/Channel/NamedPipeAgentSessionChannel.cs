using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text.Json;
using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Agent.Configuration;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Contracts.SessionBridge;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Agent.Channel;

public sealed record SessionAgentCommand(
  SessionActionInvocation? Execute,
  SessionCancelInvocation? Cancel,
  IReadOnlyList<SessionResolvedSecret> ResolvedSecrets);

public sealed class SessionResolvedSecret : IDisposable
{
  private byte[]? _plaintext;

  internal SessionResolvedSecret(string bindingId, byte[] plaintext)
  {
    BindingId = bindingId;
    _plaintext = plaintext;
  }

  public string BindingId { get; }

  [JsonIgnore]
  internal ReadOnlyMemory<byte> Plaintext => _plaintext
    ?? throw new ObjectDisposedException(nameof(SessionResolvedSecret));

  public void Dispose()
  {
    var plaintext = Interlocked.Exchange(ref _plaintext, null);
    if (plaintext is not null)
    {
      CryptographicOperations.ZeroMemory(plaintext);
    }
  }
}

public interface IAgentSessionChannel : IAsyncDisposable
{
  bool IsConnected { get; }

  VerifiedCapabilityBoundaryAttestation? CapabilityBoundaryAttestation => null;

  ValueTask ConnectAsync(CancellationToken cancellationToken);

  IAsyncEnumerable<SessionAgentCommand> ReadCommandsAsync(CancellationToken cancellationToken);

  ValueTask SendCompletionAsync(
    SessionActionCompletion completion,
    CancellationToken cancellationToken);

  ValueTask SendManifestAsync(
    SessionAgentManifest manifest,
    CancellationToken cancellationToken);

  ValueTask SendHeartbeatAsync(
    SessionAgentHeartbeat heartbeat,
    CancellationToken cancellationToken);
}

/// <summary>
/// Connects outward to the LocalSystem-owned named pipe. Windows authenticates
/// the client identity to the service; an ECDSA device-identity proof plus
/// ephemeral ECDH authenticates the service and keys every subsequent frame.
/// No TCP/HTTP listener is created by either process.
/// </summary>
public sealed class NamedPipeAgentSessionChannel : IAgentSessionChannel
{
  private static readonly JsonSerializerOptions SerializerOptions =
    new(JsonSerializerDefaults.Web);
  private readonly AgentOptions _agentOptions;
  private readonly SessionBridgeOptions _bridgeOptions;
  private readonly CapabilityBoundaryTrustOptions _boundaryTrust;
  private readonly CapabilityBoundaryAttestationVerifier _boundaryVerifier;
  private readonly ILogger<NamedPipeAgentSessionChannel> _logger;
  private readonly SemaphoreSlim _sendGate = new(1, 1);
  private readonly object _stateGate = new();
  private NamedPipeClientStream? _pipe;
  private byte[]? _sessionKey;
  private VerifiedCapabilityBoundaryAttestation? _capabilityBoundaryAttestation;
  private long _outboundSequence;
  private long _inboundSequence;

  public NamedPipeAgentSessionChannel(
    IOptions<AgentOptions> agentOptions,
    IOptions<SessionBridgeOptions> bridgeOptions,
    IOptions<CapabilityBoundaryTrustOptions> boundaryTrust,
    CapabilityBoundaryAttestationVerifier boundaryVerifier,
    ILogger<NamedPipeAgentSessionChannel> logger)
  {
    _agentOptions = agentOptions.Value;
    _bridgeOptions = bridgeOptions.Value;
    _boundaryTrust = boundaryTrust.Value;
    _boundaryVerifier = boundaryVerifier;
    _logger = logger;
  }

  public VerifiedCapabilityBoundaryAttestation? CapabilityBoundaryAttestation
  {
    get
    {
      lock (_stateGate)
      {
        return _capabilityBoundaryAttestation;
      }
    }
  }

  public bool IsConnected
  {
    get
    {
      lock (_stateGate)
      {
        return _pipe is { IsConnected: true } && _sessionKey is not null;
      }
    }
  }

  public async ValueTask ConnectAsync(CancellationToken cancellationToken)
  {
    ValidateConfiguration();
    await ResetAsync().ConfigureAwait(false);

    var pipe = new NamedPipeClientStream(
      ".",
      _bridgeOptions.PipeName,
      PipeDirection.InOut,
      PipeOptions.Asynchronous | PipeOptions.WriteThrough,
      TokenImpersonationLevel.Identification);
    try
    {
      using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
      timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(
        _bridgeOptions.ConnectTimeoutSeconds,
        1,
        60)));
      await pipe.ConnectAsync(timeout.Token).ConfigureAwait(false);
      pipe.ReadMode = PipeTransmissionMode.Byte;
      var authenticated = await AuthenticateAsync(pipe, cancellationToken)
        .ConfigureAwait(false);
      lock (_stateGate)
      {
        _pipe = pipe;
        _sessionKey = authenticated.SessionKey;
        _capabilityBoundaryAttestation = authenticated.CapabilityBoundaryAttestation;
        _outboundSequence = 0;
        _inboundSequence = 0;
      }
    }
    catch
    {
      await pipe.DisposeAsync().ConfigureAwait(false);
      throw;
    }
  }

  public async IAsyncEnumerable<SessionAgentCommand> ReadCommandsAsync(
    [EnumeratorCancellation] CancellationToken cancellationToken)
  {
    while (!cancellationToken.IsCancellationRequested)
    {
      var frame = await ReadFrameAsync(cancellationToken).ConfigureAwait(false);
      switch (frame.Kind)
      {
        case SessionBridgeProtocol.Execute:
          yield return ResolveInvocation(
            Deserialize<SessionActionInvocation>(frame.PayloadJson));
          break;
        case SessionBridgeProtocol.Cancel:
          yield return new SessionAgentCommand(
            null,
            Deserialize<SessionCancelInvocation>(frame.PayloadJson),
            Array.Empty<SessionResolvedSecret>());
          break;
        default:
          throw new InvalidDataException("The service sent an unsupported session command.");
      }
    }
  }

  public ValueTask SendCompletionAsync(
    SessionActionCompletion completion,
    CancellationToken cancellationToken) => SendAsync(
      SessionBridgeProtocol.Completion,
      completion.ActionId,
      completion,
      cancellationToken);

  public ValueTask SendManifestAsync(
    SessionAgentManifest manifest,
    CancellationToken cancellationToken) => SendAsync(
      SessionBridgeProtocol.Manifest,
      manifest.ManifestSha256,
      manifest,
      cancellationToken);

  public ValueTask SendHeartbeatAsync(
    SessionAgentHeartbeat heartbeat,
    CancellationToken cancellationToken) => SendAsync(
      SessionBridgeProtocol.Heartbeat,
      heartbeat.SessionId.ToString(System.Globalization.CultureInfo.InvariantCulture),
      heartbeat,
      cancellationToken);

  public async ValueTask DisposeAsync()
  {
    await ResetAsync().ConfigureAwait(false);
    _sendGate.Dispose();
  }

  private async ValueTask<AuthenticatedChannelState> AuthenticateAsync(
    NamedPipeClientStream pipe,
    CancellationToken cancellationToken)
  {
    using var process = Process.GetCurrentProcess();
    using var identity = WindowsIdentity.GetCurrent(TokenAccessLevels.Query);
    var sid = identity.User?.Value
      ?? throw new InvalidOperationException("The interactive user SID is unavailable.");
    using var ecdh = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    var agentNonce = RandomNumberGenerator.GetBytes(32);
    var processPath = Environment.ProcessPath
      ?? throw new InvalidOperationException("The Agent process image is unavailable.");
    string subjectImageSha256;
    using (var image = new FileStream(
      processPath,
      FileMode.Open,
      FileAccess.Read,
      FileShare.Read,
      16_384,
      FileOptions.SequentialScan))
    {
      subjectImageSha256 = Convert.ToHexString(SHA256.HashData(image))
        .ToLowerInvariant();
    }
    var createdAt = DateTimeOffset.UtcNow;
    var hello = new SessionAgentHello(
      SessionBridgeProtocol.Version,
      _agentOptions.DeviceId,
      process.Id,
      new DateTimeOffset(process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds(),
      subjectImageSha256,
      process.SessionId,
      sid,
      Convert.ToBase64String(agentNonce),
      Convert.ToBase64String(ecdh.ExportSubjectPublicKeyInfo()),
      _bridgeOptions.BrowserExternalEffectsEnabled,
      _bridgeOptions.EmergencyCommandEnabled,
      StandardUserCapabilityCatalog.RequestedManifestSha256(
        _bridgeOptions.BrowserExternalEffectsEnabled,
        _bridgeOptions.EmergencyCommandEnabled),
      _agentOptions.EgressDestinationPolicySha256,
      createdAt);
    CryptographicOperations.ZeroMemory(agentNonce);
    await SessionBridgeWire.WriteAsync(
      pipe,
      hello,
      MaximumFrameBytes,
      cancellationToken).ConfigureAwait(false);

    var challenge = await SessionBridgeWire.ReadAsync<SessionServiceChallenge>(
      pipe,
      MaximumFrameBytes,
      cancellationToken).ConfigureAwait(false);
    ValidateChallenge(hello, challenge);

    using var certificate = ResolveServiceCertificate(challenge);
    var transcript = SessionBridgeAuthentication.CreateChallengeTranscript(hello, challenge);
    var transcriptSha256 = Convert.ToHexString(SHA256.HashData(transcript)).ToLowerInvariant();
    using var signingKey = certificate.GetECDsaPublicKey()
      ?? throw new CryptographicException("The pinned service certificate is not ECDSA.");
    var signature = Convert.FromBase64String(challenge.SignatureBase64);
    try
    {
      if (!signingKey.VerifyData(transcript, signature, HashAlgorithmName.SHA256))
      {
        throw new CryptographicException("The session service identity proof is invalid.");
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(signature);
      CryptographicOperations.ZeroMemory(transcript);
    }

    var capabilityBoundaryAttestation = VerifyCapabilityBoundaryAttestation(
      hello,
      challenge);

    using var remoteKey = ECDiffieHellman.Create();
    var remotePublicKey = Convert.FromBase64String(challenge.ServiceEphemeralPublicKeyBase64);
    try
    {
      remoteKey.ImportSubjectPublicKeyInfo(remotePublicKey, out var consumed);
      if (consumed != remotePublicKey.Length)
      {
        throw new CryptographicException("The service ephemeral key has trailing data.");
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(remotePublicKey);
    }

    var sessionKey = SessionBridgeAuthentication.DeriveSessionKey(
      ecdh,
      remoteKey.PublicKey,
      hello.AgentNonceBase64,
      challenge.ServiceNonceBase64,
      transcriptSha256);
    var ready = new SessionAgentReady(
      SessionBridgeProtocol.Version,
      _agentOptions.DeviceId,
      process.SessionId,
      transcriptSha256,
      SessionBridgeAuthentication.ComputeReadyMac(
        sessionKey,
        _agentOptions.DeviceId,
        process.SessionId,
        transcriptSha256));
    await SessionBridgeWire.WriteAsync(
      pipe,
      ready,
      MaximumFrameBytes,
      cancellationToken).ConfigureAwait(false);
    return new AuthenticatedChannelState(sessionKey, capabilityBoundaryAttestation);
  }

  private VerifiedCapabilityBoundaryAttestation? VerifyCapabilityBoundaryAttestation(
    SessionAgentHello hello,
    SessionServiceChallenge challenge)
  {
    if (!hello.BrowserExternalEffectsRequested && !hello.EmergencyCommandRequested)
    {
      if (challenge.CapabilityBoundaryAttestation is not null)
      {
        throw new CryptographicException(
          "Unexpected capability-boundary evidence was supplied.");
      }
      return null;
    }

    var envelope = challenge.CapabilityBoundaryAttestation
      ?? throw new CryptographicException(
        "Capability-boundary evidence is unavailable.");
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
      envelope.Attestation.RequestId,
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
      2,
      SessionBridgeProtocol.Version,
      hello.CreatedAt.ToUnixTimeMilliseconds());
    var required = EgressBoundaryFeatures.RequiredFor(
      hello.BrowserExternalEffectsRequested,
      hello.EmergencyCommandRequested);
    var verified = _boundaryVerifier.Verify(
      envelope,
      new CapabilityBoundaryAttestationExpectation(
        request,
        CapabilityBoundaryAttestationContract.RequiredSupervisorServiceSid,
        _boundaryTrust.ExpectedSupervisorPipeSecuritySha256,
        required));
    return verified.IsValid && verified.Value is not null
      ? verified.Value
      : throw new CryptographicException(
        verified.ErrorCode ?? "Capability-boundary evidence is invalid.");
  }

  private void ValidateChallenge(
    SessionAgentHello hello,
    SessionServiceChallenge challenge)
  {
    var now = DateTimeOffset.UtcNow;
    if (challenge.ProtocolVersion != SessionBridgeProtocol.Version
      || !string.Equals(challenge.DeviceId, hello.DeviceId, StringComparison.Ordinal)
      || challenge.SessionId != hello.SessionId
      || !string.Equals(
        challenge.AgentNonceBase64,
        hello.AgentNonceBase64,
        StringComparison.Ordinal)
      || challenge.ExpiresAt <= now
      || challenge.ExpiresAt > now.AddMinutes(2)
      || string.IsNullOrWhiteSpace(challenge.SignatureBase64)
      || string.IsNullOrWhiteSpace(challenge.ServiceEphemeralPublicKeyBase64))
    {
      throw new CryptographicException("The session service challenge is invalid.");
    }

    var configured = NormalizeThumbprint(_bridgeOptions.ServiceCertificateThumbprint);
    var presented = NormalizeThumbprint(challenge.ServiceCertificateThumbprint);
    if (configured.Length != 40
      || !CryptographicOperations.FixedTimeEquals(
        Convert.FromHexString(configured),
        Convert.FromHexString(presented)))
    {
      throw new CryptographicException("The session service certificate pin did not match.");
    }
  }

  private X509Certificate2 ResolveServiceCertificate(SessionServiceChallenge challenge)
  {
    if (!Enum.TryParse<StoreName>(_bridgeOptions.ServiceCertificateStoreName, out var storeName)
      || !Enum.TryParse<StoreLocation>(
        _bridgeOptions.ServiceCertificateStoreLocation,
        out var storeLocation))
    {
      throw new InvalidOperationException("The session service certificate store is invalid.");
    }

    using var store = new X509Store(storeName, storeLocation);
    store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
    var matches = store.Certificates.Find(
      X509FindType.FindByThumbprint,
      NormalizeThumbprint(challenge.ServiceCertificateThumbprint),
      validOnly: false);
    var candidates = matches.Cast<X509Certificate2>().ToArray();
    if (candidates.Length != 1)
    {
      foreach (var candidate in candidates)
      {
        candidate.Dispose();
      }

      throw new CryptographicException("The pinned session service certificate is unavailable.");
    }

    var certificate = candidates[0];
    var certificateSha256 = Convert.ToHexString(SHA256.HashData(certificate.RawData))
      .ToLowerInvariant();
    if (!SessionBridgeAuthentication.FixedTimeEqualsHex(
      challenge.ServiceCertificateSha256,
      certificateSha256)
      || certificate.NotBefore.ToUniversalTime() > DateTime.UtcNow
      || certificate.NotAfter.ToUniversalTime() <= DateTime.UtcNow)
    {
      certificate.Dispose();
      throw new CryptographicException("The session service certificate failed validation.");
    }

    return certificate;
  }

  private async ValueTask<AuthenticatedSessionFrame> ReadFrameAsync(
    CancellationToken cancellationToken)
  {
    NamedPipeClientStream pipe;
    byte[] key;
    lock (_stateGate)
    {
      pipe = _pipe ?? throw new IOException("The session bridge is disconnected.");
      key = _sessionKey ?? throw new IOException("The session bridge is unauthenticated.");
    }

    var frame = await SessionBridgeWire.ReadAsync<AuthenticatedSessionFrame>(
      pipe,
      MaximumFrameBytes,
      cancellationToken).ConfigureAwait(false);
    var expectedSequence = Interlocked.Increment(ref _inboundSequence);
    if (frame.Sequence != expectedSequence
      || !IsSafeToken(frame.Kind, 40)
      || !IsSafeToken(frame.CorrelationId, 256)
      || !SessionBridgeAuthentication.FixedTimeEqualsHex(
        SessionBridgeAuthentication.ComputeFrameMac(
          key,
          frame.Sequence,
          frame.Kind,
          frame.CorrelationId,
          frame.PayloadJson),
        frame.MacSha256))
    {
      throw new CryptographicException("The session bridge frame failed authentication.");
    }

    return frame;
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
      NamedPipeClientStream pipe;
      byte[] key;
      lock (_stateGate)
      {
        pipe = _pipe ?? throw new IOException("The session bridge is disconnected.");
        key = _sessionKey ?? throw new IOException("The session bridge is unauthenticated.");
      }

      var sequence = Interlocked.Increment(ref _outboundSequence);
      var payloadJson = JsonSerializer.Serialize(payload, SerializerOptions);
      var frame = new AuthenticatedSessionFrame(
        sequence,
        kind,
        correlationId,
        payloadJson,
        SessionBridgeAuthentication.ComputeFrameMac(
          key,
          sequence,
          kind,
          correlationId,
          payloadJson));
      await SessionBridgeWire.WriteAsync(
        pipe,
        frame,
        MaximumFrameBytes,
        cancellationToken).ConfigureAwait(false);
    }
    finally
    {
      _sendGate.Release();
    }
  }

  private async ValueTask ResetAsync()
  {
    NamedPipeClientStream? pipe;
    byte[]? key;
    lock (_stateGate)
    {
      pipe = _pipe;
      key = _sessionKey;
      _pipe = null;
      _sessionKey = null;
      _capabilityBoundaryAttestation = null;
      _outboundSequence = 0;
      _inboundSequence = 0;
    }

    if (key is not null)
    {
      CryptographicOperations.ZeroMemory(key);
    }

    if (pipe is not null)
    {
      await pipe.DisposeAsync().ConfigureAwait(false);
    }
  }

  private void ValidateConfiguration()
  {
    if (!_bridgeOptions.Enabled
      || string.IsNullOrWhiteSpace(_agentOptions.DeviceId)
      || string.Equals(_agentOptions.DeviceId, "UNENROLLED", StringComparison.Ordinal)
      || !IsSafeToken(_bridgeOptions.PipeName, 240)
      || NormalizeThumbprint(_bridgeOptions.ServiceCertificateThumbprint).Length != 40
      || _bridgeOptions.MaximumFrameBytes is < 65_536 or > 16_777_216
      || ((_bridgeOptions.BrowserExternalEffectsEnabled
          || _bridgeOptions.EmergencyCommandEnabled)
        && (!_boundaryTrust.Enabled
          || !PayloadDigest.IsSha256Hex(_agentOptions.EgressDestinationPolicySha256)
          || !PayloadDigest.IsSha256Hex(
            _boundaryTrust.ExpectedSupervisorPipeSecuritySha256))))
    {
      throw new InvalidOperationException("The authenticated session bridge is not configured.");
    }
  }

  private sealed record AuthenticatedChannelState(
    byte[] SessionKey,
    VerifiedCapabilityBoundaryAttestation? CapabilityBoundaryAttestation);

  private int MaximumFrameBytes => Math.Clamp(
    _bridgeOptions.MaximumFrameBytes,
    65_536,
    16_777_216);

  private static T Deserialize<T>(string json)
  {
    using var document = JsonDocument.Parse(json, new JsonDocumentOptions
    {
      AllowTrailingCommas = false,
      CommentHandling = JsonCommentHandling.Disallow,
      MaxDepth = 32,
    });
    return document.Deserialize<T>(SerializerOptions)
      ?? throw new InvalidDataException("The session command payload was empty.");
  }

  private SessionAgentCommand ResolveInvocation(SessionActionInvocation invocation)
  {
    using var arguments = JsonDocument.Parse(invocation.ArgumentsJson, new JsonDocumentOptions
    {
      AllowTrailingCommas = false,
      CommentHandling = JsonCommentHandling.Disallow,
      MaxDepth = 32,
    });
    var requirement = BrowserSecretDestination.Resolve(
      invocation.CapabilityId,
      arguments.RootElement);
    if (requirement is null)
    {
      if (invocation.SecretEnvelopes.Count != 0)
      {
        throw new CryptographicException(
          "A non-secret session capability received a secret envelope.");
      }
      return new SessionAgentCommand(
        invocation,
        null,
        Array.Empty<SessionResolvedSecret>());
    }

    if (invocation.SecretEnvelopes.Count != 1)
    {
      throw new CryptographicException(
        "A browser secret capability requires exactly one secret envelope.");
    }

    var envelope = invocation.SecretEnvelopes[0];
    if (!string.Equals(envelope.BindingId, requirement.BindingId, StringComparison.Ordinal)
      || !SessionBridgeAuthentication.FixedTimeEqualsHex(
        envelope.DestinationScopeSha256,
        requirement.DestinationScopeSha256))
    {
      throw new CryptographicException("The browser secret destination binding is invalid.");
    }

    byte[] key;
    lock (_stateGate)
    {
      key = _sessionKey
        ?? throw new IOException("The session bridge is unauthenticated.");
    }
    var plaintext = SessionSecretEnvelopeProtection.Unprotect(
      key,
      invocation.Context.ActionId,
      invocation.CapabilityId,
      envelope);
    return new SessionAgentCommand(
      invocation,
      null,
      [new SessionResolvedSecret(requirement.BindingId, plaintext)]);
  }

  private static string NormalizeThumbprint(string value) => value
    .Replace(":", string.Empty, StringComparison.Ordinal)
    .Replace(" ", string.Empty, StringComparison.Ordinal)
    .ToUpperInvariant();

  private static bool IsSafeToken(string value, int maximumLength) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= maximumLength
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_' or ':');
}
