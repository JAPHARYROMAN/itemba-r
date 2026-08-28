using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text.Json;
using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Agent.Configuration;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Contracts.SessionBridge;
using Microsoft.Extensions.Options;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Agent.SecretProvisioning;

internal interface ISecretProvisioningClient
{
  ValueTask<ISecretProvisioningClientSession> ConnectAsync(
    CancellationToken cancellationToken);
}

internal interface ISecretProvisioningClientSession : IAsyncDisposable
{
  ValueTask<IReadOnlyList<SecretProvisioningBindingPreview>> GetCatalogAsync(
    CancellationToken cancellationToken);

  ValueTask<SecretProvisioningChallenge> BeginAsync(
    SecretProvisioningBeginRequest request,
    CancellationToken cancellationToken);

  ValueTask<SecretProvisioningResult> CommitAsync(
    SecretProvisioningChallenge challenge,
    ReadOnlyMemory<byte> secret,
    CancellationToken cancellationToken);
}

internal sealed partial class NamedPipeSecretProvisioningClient : ISecretProvisioningClient
{
  private readonly AgentOptions _agent;
  private readonly SecretProvisioningOptions _options;

  public NamedPipeSecretProvisioningClient(
    IOptions<AgentOptions> agent,
    IOptions<SecretProvisioningOptions> options)
  {
    _agent = agent.Value;
    _options = options.Value;
  }

  public async ValueTask<ISecretProvisioningClientSession> ConnectAsync(
    CancellationToken cancellationToken)
  {
    ValidateConfiguration();
    var pipe = new NamedPipeClientStream(
      ".",
      _options.PipeName,
      PipeDirection.InOut,
      PipeOptions.Asynchronous | PipeOptions.WriteThrough,
      TokenImpersonationLevel.Identification);
    try
    {
      using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
      timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(
        _options.ConnectTimeoutSeconds,
        1,
        60)));
      await pipe.ConnectAsync(timeout.Token).ConfigureAwait(false);
      ValidateServerProcess(pipe.SafePipeHandle);
      var sessionKey = await AuthenticateAsync(pipe, cancellationToken).ConfigureAwait(false);
      return new ClientSession(pipe, sessionKey, MaximumFrameBytes);
    }
    catch
    {
      await pipe.DisposeAsync().ConfigureAwait(false);
      throw;
    }
  }

  private async ValueTask<byte[]> AuthenticateAsync(
    NamedPipeClientStream pipe,
    CancellationToken cancellationToken)
  {
    using var process = Process.GetCurrentProcess();
    using var identity = WindowsIdentity.GetCurrent(TokenAccessLevels.Query);
    var userSid = identity.User?.Value
      ?? throw new UnauthorizedAccessException("The interactive user SID is unavailable.");
    using var localKey = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    var agentNonce = RandomNumberGenerator.GetBytes(32);
    SecretProvisioningAgentHello hello;
    try
    {
      hello = new SecretProvisioningAgentHello(
        SecretProvisioningProtocol.Version,
        _agent.DeviceId,
        process.Id,
        process.SessionId,
        userSid,
        Convert.ToBase64String(agentNonce),
        Convert.ToBase64String(localKey.ExportSubjectPublicKeyInfo()),
        DateTimeOffset.UtcNow);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(agentNonce);
    }

    await SessionBridgeWire.WriteAsync(
      pipe,
      hello,
      MaximumFrameBytes,
      cancellationToken).ConfigureAwait(false);
    var challenge = await SessionBridgeWire.ReadAsync<SecretProvisioningServiceChallenge>(
      pipe,
      MaximumFrameBytes,
      cancellationToken).ConfigureAwait(false);
    ValidateChallenge(hello, challenge);

    using var certificate = ResolveServiceCertificate(challenge);
    var transcript = SecretProvisioningAuthentication.CreateChallengeTranscript(
      hello,
      challenge);
    var transcriptSha256 = Convert.ToHexString(SHA256.HashData(transcript))
      .ToLowerInvariant();
    var signature = Convert.FromBase64String(challenge.SignatureBase64);
    try
    {
      using var signingKey = certificate.GetECDsaPublicKey()
        ?? throw new CryptographicException("The pinned service certificate is not ECDSA.");
      if (!signingKey.VerifyData(transcript, signature, HashAlgorithmName.SHA256))
      {
        throw new CryptographicException("The provisioning service proof is invalid.");
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(signature);
      CryptographicOperations.ZeroMemory(transcript);
    }

    using var remoteKey = ECDiffieHellman.Create();
    var remotePublicKey = Convert.FromBase64String(
      challenge.ServiceEphemeralPublicKeyBase64);
    try
    {
      remoteKey.ImportSubjectPublicKeyInfo(remotePublicKey, out var consumed);
      if (consumed != remotePublicKey.Length)
      {
        throw new CryptographicException("The provisioning service key has trailing data.");
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(remotePublicKey);
    }

    var sessionKey = SecretProvisioningAuthentication.DeriveSessionKey(
      localKey,
      remoteKey.PublicKey,
      hello.AgentNonceBase64,
      challenge.ServiceNonceBase64,
      transcriptSha256);
    var ready = new SecretProvisioningAgentReady(
      SecretProvisioningProtocol.Version,
      _agent.DeviceId,
      process.SessionId,
      transcriptSha256,
      SecretProvisioningAuthentication.ComputeReadyMac(
        sessionKey,
        _agent.DeviceId,
        process.SessionId,
        transcriptSha256));
    await SessionBridgeWire.WriteAsync(
      pipe,
      ready,
      MaximumFrameBytes,
      cancellationToken).ConfigureAwait(false);
    return sessionKey;
  }

  private void ValidateChallenge(
    SecretProvisioningAgentHello hello,
    SecretProvisioningServiceChallenge challenge)
  {
    var now = DateTimeOffset.UtcNow;
    if (challenge.ProtocolVersion != SecretProvisioningProtocol.Version
      || !string.Equals(challenge.DeviceId, hello.DeviceId, StringComparison.Ordinal)
      || challenge.SessionId != hello.SessionId
      || !string.Equals(
        challenge.AgentNonceBase64,
        hello.AgentNonceBase64,
        StringComparison.Ordinal)
      || challenge.ExpiresAt <= now
      || challenge.ExpiresAt > now.AddMinutes(2)
      || string.IsNullOrWhiteSpace(challenge.SignatureBase64)
      || string.IsNullOrWhiteSpace(challenge.ServiceEphemeralPublicKeyBase64)
      || !FixedTimeThumbprintEquals(
        _options.ServiceCertificateThumbprint,
        challenge.ServiceCertificateThumbprint))
    {
      throw new CryptographicException("The provisioning service challenge is invalid.");
    }
  }

  private X509Certificate2 ResolveServiceCertificate(
    SecretProvisioningServiceChallenge challenge)
  {
    if (!Enum.TryParse<StoreName>(_options.ServiceCertificateStoreName, out var storeName)
      || !Enum.TryParse<StoreLocation>(
        _options.ServiceCertificateStoreLocation,
        out var storeLocation))
    {
      throw new InvalidOperationException("The provisioning certificate store is invalid.");
    }

    using var store = new X509Store(storeName, storeLocation);
    store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
    var matches = store.Certificates.Find(
      X509FindType.FindByThumbprint,
      NormalizeThumbprint(challenge.ServiceCertificateThumbprint),
      validOnly: false).Cast<X509Certificate2>().ToArray();
    if (matches.Length != 1)
    {
      foreach (var item in matches) item.Dispose();
      throw new CryptographicException("The pinned provisioning certificate is unavailable.");
    }

    var certificate = matches[0];
    var digest = Convert.ToHexString(SHA256.HashData(certificate.RawData)).ToLowerInvariant();
    if (!PayloadDigest.FixedTimeEqualsHex(challenge.ServiceCertificateSha256, digest)
      || certificate.NotBefore.ToUniversalTime() > DateTime.UtcNow
      || certificate.NotAfter.ToUniversalTime() <= DateTime.UtcNow)
    {
      certificate.Dispose();
      throw new CryptographicException("The provisioning certificate failed validation.");
    }
    return certificate;
  }

  private void ValidateConfiguration()
  {
    if (!_options.Enabled
      || !IsSafePipeName(_options.PipeName)
      || NormalizeThumbprint(_options.ServiceCertificateThumbprint).Length != 40
      || _options.MaximumFrameBytes is < 65_536 or > 1_048_576
      || string.IsNullOrWhiteSpace(_agent.DeviceId)
      || string.Equals(_agent.DeviceId, "UNENROLLED", StringComparison.Ordinal))
    {
      throw new InvalidOperationException("Local secret provisioning is not configured.");
    }
  }

  private static void ValidateServerProcess(SafePipeHandle pipe)
  {
    if (!GetNamedPipeServerProcessId(pipe, out var processId)
      || processId is 0 or > int.MaxValue)
    {
      throw new UnauthorizedAccessException("The provisioning service PID is unavailable.");
    }

    if (!ProcessIdToSessionId(processId, out var sessionId) || sessionId != 0)
    {
      throw new UnauthorizedAccessException("The provisioning server process is invalid.");
    }

    using var process = OpenProcess(
      ProcessQueryLimitedInformation,
      inheritHandle: false,
      processId);
    if (process.IsInvalid
      || !OpenProcessToken(
        process.DangerousGetHandle(),
        TokenAccessLevels.Query,
        out var token))
    {
      throw new UnauthorizedAccessException("The provisioning server process is invalid.");
    }

    using (token)
    using (var identity = new WindowsIdentity(token.DangerousGetHandle()))
    {
      var systemSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
      if (identity.User is null || !systemSid.Equals(identity.User))
      {
        throw new UnauthorizedAccessException(
          "The provisioning server is not running as LocalSystem.");
      }
    }
  }

  private int MaximumFrameBytes => Math.Clamp(
    _options.MaximumFrameBytes,
    65_536,
    1_048_576);

  private static bool FixedTimeThumbprintEquals(string left, string right)
  {
    var normalizedLeft = NormalizeThumbprint(left);
    var normalizedRight = NormalizeThumbprint(right);
    if (normalizedLeft.Length != 40 || normalizedRight.Length != 40)
    {
      return false;
    }

    var leftBytes = Convert.FromHexString(normalizedLeft);
    var rightBytes = Convert.FromHexString(normalizedRight);
    try
    {
      return CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(leftBytes);
      CryptographicOperations.ZeroMemory(rightBytes);
    }
  }

  private static string NormalizeThumbprint(string value) => string.Concat(
    value.Where(character => !char.IsWhiteSpace(character))).ToUpperInvariant();

  private static bool IsSafePipeName(string value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 240
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_');

  [LibraryImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool GetNamedPipeServerProcessId(
    SafePipeHandle pipe,
    out uint serverProcessId);

  [LibraryImport("advapi32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool OpenProcessToken(
    IntPtr processHandle,
    TokenAccessLevels desiredAccess,
    out SafeAccessTokenHandle tokenHandle);

  private const uint ProcessQueryLimitedInformation = 0x1000;

  [LibraryImport("kernel32.dll", SetLastError = true)]
  private static partial SafeProcessHandle OpenProcess(
    uint desiredAccess,
    [MarshalAs(UnmanagedType.Bool)] bool inheritHandle,
    uint processId);

  [LibraryImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool ProcessIdToSessionId(
    uint processId,
    out uint sessionId);

  private sealed class ClientSession : ISecretProvisioningClientSession
  {
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web)
    {
      MaxDepth = 32,
      UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };
    private readonly NamedPipeClientStream _pipe;
    private readonly byte[] _sessionKey;
    private readonly int _maximumFrameBytes;
    private readonly SemaphoreSlim _sendGate = new(1, 1);
    private long _inboundSequence;
    private long _outboundSequence;

    public ClientSession(
      NamedPipeClientStream pipe,
      byte[] sessionKey,
      int maximumFrameBytes)
    {
      _pipe = pipe;
      _sessionKey = sessionKey;
      _maximumFrameBytes = maximumFrameBytes;
    }

    public async ValueTask<IReadOnlyList<SecretProvisioningBindingPreview>> GetCatalogAsync(
      CancellationToken cancellationToken)
    {
      var requestId = Guid.NewGuid().ToString("D");
      await SendAsync(
        SecretProvisioningProtocol.CatalogRequest,
        requestId,
        new SecretProvisioningCatalogRequest(requestId),
        cancellationToken).ConfigureAwait(false);
      var response = await ReadExpectedAsync<SecretProvisioningCatalogResponse>(
        SecretProvisioningProtocol.CatalogResponse,
        requestId,
        cancellationToken).ConfigureAwait(false);
      if (!string.Equals(response.RequestId, requestId, StringComparison.Ordinal))
      {
        throw new InvalidDataException("The provisioning catalog response is invalid.");
      }
      return response.Bindings;
    }

    public async ValueTask<SecretProvisioningChallenge> BeginAsync(
      SecretProvisioningBeginRequest request,
      CancellationToken cancellationToken)
    {
      await SendAsync(
        SecretProvisioningProtocol.Begin,
        request.RequestId,
        request,
        cancellationToken).ConfigureAwait(false);
      var frame = await ReadAsync(cancellationToken).ConfigureAwait(false);
      if (!string.Equals(frame.CorrelationId, request.RequestId, StringComparison.Ordinal))
      {
        throw new InvalidDataException("The provisioning response correlation is invalid.");
      }
      if (frame.Kind == SecretProvisioningProtocol.Result)
      {
        var failure = Deserialize<SecretProvisioningResult>(frame.PayloadJson);
        throw new SecretProvisioningClientException(
          failure.ErrorCode ?? "secret_provisioning_failed");
      }
      if (frame.Kind != SecretProvisioningProtocol.Challenge)
      {
        throw new InvalidDataException("The provisioning challenge is missing.");
      }

      var challenge = Deserialize<SecretProvisioningChallenge>(frame.PayloadJson);
      var expected = SecretProvisioningManifest.ComputeSha256(
        request.RequestId,
        request.Operation,
        challenge.Binding,
        request.VaultReferenceId);
      if (!string.Equals(challenge.RequestId, request.RequestId, StringComparison.Ordinal)
        || !string.Equals(challenge.Operation, request.Operation, StringComparison.Ordinal)
        || !string.Equals(
          challenge.Binding.BindingId,
          request.BindingId,
          StringComparison.Ordinal)
        || !string.Equals(
          challenge.VaultReferenceId,
          request.VaultReferenceId,
          StringComparison.Ordinal)
        || !PayloadDigest.FixedTimeEqualsHex(challenge.ManifestSha256, expected)
        || challenge.ExpiresAt <= DateTimeOffset.UtcNow)
      {
        throw new CryptographicException("The provisioning preview binding is invalid.");
      }
      return challenge;
    }

    public async ValueTask<SecretProvisioningResult> CommitAsync(
      SecretProvisioningChallenge challenge,
      ReadOnlyMemory<byte> secret,
      CancellationToken cancellationToken)
    {
      SecretProvisioningSecretEnvelope? envelope = null;
      if (SecretProvisioningOperations.RequiresSecret(challenge.Operation))
      {
        envelope = SecretProvisioningEnvelopeProtection.Protect(
          _sessionKey,
          challenge.RequestId,
          challenge.ManifestSha256,
          secret.Span);
      }
      else if (!secret.IsEmpty)
      {
        throw new InvalidOperationException("Delete must not carry secret material.");
      }

      await SendAsync(
        SecretProvisioningProtocol.Commit,
        challenge.RequestId,
        new SecretProvisioningCommitRequest(
          challenge.RequestId,
          challenge.ConfirmationId,
          challenge.ManifestSha256,
          envelope),
        cancellationToken).ConfigureAwait(false);
      var result = await ReadExpectedAsync<SecretProvisioningResult>(
        SecretProvisioningProtocol.Result,
        challenge.RequestId,
        cancellationToken).ConfigureAwait(false);
      if (!string.Equals(result.RequestId, challenge.RequestId, StringComparison.Ordinal)
        || !string.Equals(result.Operation, challenge.Operation, StringComparison.Ordinal)
        || result.Outcome is not ("completed" or "failed" or "needs_attention")
        || (result.Outcome == "completed" && result.Metadata is null)
        || (result.Metadata is not null
          && (!string.Equals(
            result.Metadata.Kind,
            challenge.Binding.Kind,
            StringComparison.Ordinal)
            || !PayloadDigest.FixedTimeEqualsHex(
              result.Metadata.DestinationScopeSha256,
              challenge.Binding.DestinationScopeSha256)
            || !result.Metadata.AllowedCapabilities.SequenceEqual(
              challenge.Binding.AllowedCapabilities,
              StringComparer.Ordinal))))
      {
        throw new InvalidDataException("The provisioning result is invalid.");
      }
      return result;
    }

    public async ValueTask DisposeAsync()
    {
      CryptographicOperations.ZeroMemory(_sessionKey);
      _sendGate.Dispose();
      await _pipe.DisposeAsync().ConfigureAwait(false);
    }

    private async ValueTask<T> ReadExpectedAsync<T>(
      string kind,
      string correlationId,
      CancellationToken cancellationToken)
    {
      var frame = await ReadAsync(cancellationToken).ConfigureAwait(false);
      if (!string.Equals(frame.Kind, kind, StringComparison.Ordinal)
        || !string.Equals(frame.CorrelationId, correlationId, StringComparison.Ordinal))
      {
        throw new InvalidDataException("The provisioning response is invalid.");
      }
      return Deserialize<T>(frame.PayloadJson);
    }

    private async ValueTask<AuthenticatedSessionFrame> ReadAsync(
      CancellationToken cancellationToken)
    {
      var frame = await SessionBridgeWire.ReadAsync<AuthenticatedSessionFrame>(
        _pipe,
        _maximumFrameBytes,
        cancellationToken).ConfigureAwait(false);
      var sequence = Interlocked.Increment(ref _inboundSequence);
      var expected = SessionBridgeAuthentication.ComputeFrameMac(
        _sessionKey,
        frame.Sequence,
        frame.Kind,
        frame.CorrelationId,
        frame.PayloadJson);
      if (frame.Sequence != sequence
        || !PayloadDigest.FixedTimeEqualsHex(frame.MacSha256, expected))
      {
        throw new CryptographicException("The provisioning response is unauthenticated.");
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
        var sequence = Interlocked.Increment(ref _outboundSequence);
        var json = JsonSerializer.Serialize(payload, SerializerOptions);
        var frame = new AuthenticatedSessionFrame(
          sequence,
          kind,
          correlationId,
          json,
          SessionBridgeAuthentication.ComputeFrameMac(
            _sessionKey,
            sequence,
            kind,
            correlationId,
            json));
        await SessionBridgeWire.WriteAsync(
          _pipe,
          frame,
          _maximumFrameBytes,
          cancellationToken).ConfigureAwait(false);
      }
      finally
      {
        _sendGate.Release();
      }
    }

    private static T Deserialize<T>(string json)
    {
      try
      {
        return JsonSerializer.Deserialize<T>(json, SerializerOptions)
          ?? throw new JsonException();
      }
      catch (JsonException)
      {
        throw new InvalidDataException("The provisioning response payload is invalid.");
      }
    }
  }
}

internal sealed class SecretProvisioningClientException(string errorCode) : Exception(errorCode)
{
  public string ErrorCode { get; } = errorCode;
}
