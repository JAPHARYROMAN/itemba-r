using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text.Json;
using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Contracts.SessionBridge;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.SessionBridge;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.Security;

/// <summary>
/// A separately enabled, LocalSystem-owned provisioning channel. It is local
/// named-pipe IPC only: no broker command, model tool, CLI argument, config
/// value, or environment variable can carry secret plaintext into this path.
/// </summary>
internal sealed partial class NamedPipeSecretProvisioningService : BackgroundService
{
  private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web)
  {
    MaxDepth = 32,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
  };
  private static readonly Action<ILogger, string, Exception?> LogConnectionFailure =
    LoggerMessage.Define<string>(
      LogLevel.Warning,
      new EventId(3600, nameof(LogConnectionFailure)),
      "A local secret provisioning connection failed with {ExceptionType}.");
  private readonly SecretProvisioningOptions _options;
  private readonly CompanionOptions _companion;
  private readonly HostCapabilityOptions _host;
  private readonly IDeviceIdentityProvisioner _identity;
  private readonly ITrustedSecretProvisioner _provisioner;
  private readonly SecretProvisioningBindingCatalog _catalog;
  private readonly FileSecretProvisioningAuditJournal _auditJournal;
  private readonly SecretProvisioningCoordinator _coordinator;
  private readonly ILogger<NamedPipeSecretProvisioningService> _logger;
  private readonly ConcurrentDictionary<long, Task> _connections = new();
  private long _connectionSequence;

  public NamedPipeSecretProvisioningService(
    IOptions<SecretProvisioningOptions> options,
    IOptions<CompanionOptions> companion,
    IOptions<HostCapabilityOptions> host,
    IDeviceIdentityProvisioner identity,
    ITrustedSecretProvisioner provisioner,
    SecretProvisioningBindingCatalog catalog,
    FileSecretProvisioningAuditJournal auditJournal,
    SecretProvisioningCoordinator coordinator,
    ILogger<NamedPipeSecretProvisioningService> logger)
  {
    _options = options.Value;
    _companion = companion.Value;
    _host = host.Value;
    _identity = identity;
    _provisioner = provisioner;
    _catalog = catalog;
    _auditJournal = auditJournal;
    _coordinator = coordinator;
    _logger = logger;
  }

  protected override async Task ExecuteAsync(CancellationToken stoppingToken)
  {
    ValidateConfigurationAndBoundary();
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
    await base.StopAsync(cancellationToken).ConfigureAwait(false);
    await Task.WhenAll(_connections.Values.Select(ObserveAsync)).ConfigureAwait(false);
  }

  private async Task HandleConnectionAsync(
    NamedPipeServerStream pipe,
    CancellationToken stoppingToken)
  {
    ProvisioningSession? session = null;
    try
    {
      session = await AuthenticateAsync(pipe, stoppingToken).ConfigureAwait(false);
      await RunSessionAsync(session, stoppingToken).ConfigureAwait(false);
    }
    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
    {
      // Normal service shutdown.
    }
    catch (Exception exception)
    {
      // Never attach the exception object: a pre-authentication parser or OS
      // message is not permitted to place caller-controlled material in logs.
      LogConnectionFailure(_logger, exception.GetType().Name, null);
    }
    finally
    {
      if (session is not null)
      {
        await session.DisposeAsync().ConfigureAwait(false);
      }
      else
      {
        await pipe.DisposeAsync().ConfigureAwait(false);
      }
    }
  }

  private async ValueTask RunSessionAsync(
    ProvisioningSession session,
    CancellationToken cancellationToken)
  {
    SecretProvisioningChallenge? pending = null;
    while (!cancellationToken.IsCancellationRequested)
    {
      var frame = await session.ReadAsync(cancellationToken).ConfigureAwait(false);
      switch (frame.Kind)
      {
        case SecretProvisioningProtocol.CatalogRequest:
          {
            var request = Deserialize<SecretProvisioningCatalogRequest>(frame.PayloadJson);
            ValidateRequestId(request.RequestId, frame.CorrelationId);
            await session.SendAsync(
              SecretProvisioningProtocol.CatalogResponse,
              request.RequestId,
              new SecretProvisioningCatalogResponse(request.RequestId, _catalog.List()),
              cancellationToken).ConfigureAwait(false);
            break;
          }
        case SecretProvisioningProtocol.Begin:
          {
            var request = Deserialize<SecretProvisioningBeginRequest>(frame.PayloadJson);
            ValidateRequestId(request.RequestId, frame.CorrelationId);
            pending = null;
            try
            {
              pending = await CreateChallengeAsync(
                request,
                session.Caller,
                cancellationToken)
                .ConfigureAwait(false);
              await session.SendAsync(
                SecretProvisioningProtocol.Challenge,
                request.RequestId,
                pending,
                cancellationToken).ConfigureAwait(false);
            }
            catch (Exception exception) when (exception is SecretProvisioningException
              or HostSecretReferenceException)
            {
              var errorCode = exception is SecretProvisioningException provisioning
                ? provisioning.ErrorCode
                : ((HostSecretReferenceException)exception).ErrorCode;
              await session.SendAsync(
                SecretProvisioningProtocol.Result,
                request.RequestId,
                new SecretProvisioningResult(
                  request.RequestId,
                  SecretProvisioningOperations.IsKnown(request.Operation)
                    ? request.Operation
                    : "invalid",
                  "failed",
                  Replayed: false,
                  errorCode,
                  null),
                cancellationToken).ConfigureAwait(false);
            }
            break;
          }
        case SecretProvisioningProtocol.Commit:
          {
            var request = Deserialize<SecretProvisioningCommitRequest>(frame.PayloadJson);
            ValidateRequestId(request.RequestId, frame.CorrelationId);
            if (pending is null
              || !string.Equals(pending.RequestId, request.RequestId, StringComparison.Ordinal)
              || !string.Equals(
                pending.ConfirmationId,
                request.ConfirmationId,
                StringComparison.Ordinal)
              || !PayloadDigest.FixedTimeEqualsHex(
                pending.ManifestSha256,
                request.ManifestSha256)
              || pending.ExpiresAt <= DateTimeOffset.UtcNow)
            {
              throw new SecretProvisioningException("secret_confirmation_invalid_or_expired");
            }

            var requiresSecret = SecretProvisioningOperations.RequiresSecret(pending.Operation);
            if (requiresSecret != (request.SecretEnvelope is not null))
            {
              throw new SecretProvisioningException("secret_envelope_presence_invalid");
            }

            byte[]? plaintext = null;
            try
            {
              if (request.SecretEnvelope is not null)
              {
                plaintext = SecretProvisioningEnvelopeProtection.Unprotect(
                  session.SessionKey,
                  request.RequestId,
                  request.ManifestSha256,
                  request.SecretEnvelope);
              }

              SecretProvisioningResult result;
              try
              {
                result = await _coordinator.ExecuteAsync(
                  pending,
                  session.Caller,
                  plaintext ?? ReadOnlyMemory<byte>.Empty,
                  cancellationToken).ConfigureAwait(false);
              }
              catch (SecretProvisioningException exception)
              {
                result = new SecretProvisioningResult(
                  request.RequestId,
                  pending.Operation,
                  exception.ErrorCode is "secret_request_outcome_uncertain"
                    or "secret_audit_journal_invalid"
                    or "secret_audit_journal_full"
                    or "secret_audit_state_invalid"
                      ? "needs_attention"
                      : "failed",
                  Replayed: false,
                  exception.ErrorCode,
                  null);
              }
              await session.SendAsync(
                SecretProvisioningProtocol.Result,
                request.RequestId,
                result,
                cancellationToken).ConfigureAwait(false);
            }
            finally
            {
              if (plaintext is not null)
              {
                CryptographicOperations.ZeroMemory(plaintext);
              }
            }
            break;
          }
        default:
          throw new InvalidDataException("The local provisioning frame kind is invalid.");
      }
    }
  }

  private async ValueTask<SecretProvisioningChallenge> CreateChallengeAsync(
    SecretProvisioningBeginRequest request,
    SecretProvisioningCallerIdentity caller,
    CancellationToken cancellationToken)
  {
    if (!SecretProvisioningOperations.IsKnown(request.Operation)
      || (request.Operation == SecretProvisioningOperations.Create
        && request.VaultReferenceId is not null)
      || (request.Operation != SecretProvisioningOperations.Create
        && !Guid.TryParseExact(request.VaultReferenceId, "D", out _)))
    {
      throw new SecretProvisioningException("secret_operation_invalid");
    }

    if (IsKillSwitchEngaged())
    {
      throw new SecretProvisioningException("secret_provisioning_kill_switch_engaged");
    }

    var binding = _catalog.Resolve(request.BindingId);
    var confirmationId = Guid.NewGuid().ToString("D");
    var expiresAt = DateTimeOffset.UtcNow.AddSeconds(Math.Clamp(
      _options.ConfirmationTtlSeconds,
      30,
      300));
    var challenge = new SecretProvisioningChallenge(
      request.RequestId,
      confirmationId,
      request.Operation,
      binding,
      request.VaultReferenceId,
      SecretProvisioningManifest.ComputeSha256(
        request.RequestId,
        request.Operation,
        binding,
        request.VaultReferenceId),
      expiresAt);
    var known = await _auditJournal.ContainsExactAsync(
      SecretProvisioningCoordinator.CreateIntent(challenge, caller),
      cancellationToken).ConfigureAwait(false);
    if (!known && request.VaultReferenceId is not null)
    {
      var metadata = await _provisioner.GetMetadataAsync(
        request.VaultReferenceId,
        cancellationToken).ConfigureAwait(false);
      if (!string.Equals(metadata.Kind, binding.Kind, StringComparison.Ordinal)
        || !PayloadDigest.FixedTimeEqualsHex(
          metadata.ScopeSha256,
          binding.DestinationScopeSha256)
        || !metadata.AllowedCapabilities.SequenceEqual(
          binding.AllowedCapabilities,
          StringComparer.Ordinal))
      {
        throw new SecretProvisioningException("secret_reference_scope_denied");
      }
    }
    return challenge;
  }

  private async ValueTask<ProvisioningSession> AuthenticateAsync(
    NamedPipeServerStream pipe,
    CancellationToken cancellationToken)
  {
    var hello = await SessionBridgeWire.ReadAsync<SecretProvisioningAgentHello>(
      pipe,
      MaximumFrameBytes,
      cancellationToken).ConfigureAwait(false);
    var processId = GetClientProcessId(pipe.SafePipeHandle);
    using var process = Process.GetProcessById(processId);
    var sessionId = process.SessionId;
    string? sid = null;
    pipe.RunAsClient(() =>
    {
      using var identity = WindowsIdentity.GetCurrent(TokenAccessLevels.Query);
      sid = identity.User?.Value;
    });
    var executableSha256 = ValidateHelloAndImage(hello, process, processId, sessionId, sid);

    using var deviceIdentity = await _identity.GetOrCreateAsync(
      _companion.DeviceId,
      cancellationToken).ConfigureAwait(false);
    if (!deviceIdentity.IsPaired)
    {
      throw new CryptographicException("The device identity is not paired.");
    }

    using var localKey = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    using var remoteKey = ECDiffieHellman.Create();
    var remotePublicKey = Convert.FromBase64String(hello.AgentEphemeralPublicKeyBase64);
    try
    {
      remoteKey.ImportSubjectPublicKeyInfo(remotePublicKey, out var consumed);
      if (consumed != remotePublicKey.Length)
      {
        throw new CryptographicException("The agent provisioning key has trailing data.");
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(remotePublicKey);
    }

    var serviceNonce = RandomNumberGenerator.GetBytes(32);
    SecretProvisioningServiceChallenge unsigned;
    try
    {
      unsigned = new SecretProvisioningServiceChallenge(
        SecretProvisioningProtocol.Version,
        _companion.DeviceId,
        sessionId,
        hello.AgentNonceBase64,
        Convert.ToBase64String(serviceNonce),
        Convert.ToBase64String(localKey.ExportSubjectPublicKeyInfo()),
        deviceIdentity.Certificate.Thumbprint,
        deviceIdentity.CertificateSha256.ToLowerInvariant(),
        DateTimeOffset.UtcNow.AddSeconds(60),
        string.Empty);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(serviceNonce);
    }

    var transcript = SecretProvisioningAuthentication.CreateChallengeTranscript(hello, unsigned);
    var transcriptSha256 = Convert.ToHexString(SHA256.HashData(transcript))
      .ToLowerInvariant();
    string signature;
    using (var signingKey = deviceIdentity.Certificate.GetECDsaPrivateKey()
      ?? throw new CryptographicException("The device identity key is unavailable."))
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
    var sessionKey = SecretProvisioningAuthentication.DeriveSessionKey(
      localKey,
      remoteKey.PublicKey,
      hello.AgentNonceBase64,
      challenge.ServiceNonceBase64,
      transcriptSha256);
    try
    {
      var ready = await SessionBridgeWire.ReadAsync<SecretProvisioningAgentReady>(
        pipe,
        MaximumFrameBytes,
        cancellationToken).ConfigureAwait(false);
      var expectedMac = SecretProvisioningAuthentication.ComputeReadyMac(
        sessionKey,
        _companion.DeviceId,
        sessionId,
        transcriptSha256);
      if (ready.ProtocolVersion != SecretProvisioningProtocol.Version
        || !string.Equals(ready.DeviceId, _companion.DeviceId, StringComparison.Ordinal)
        || ready.SessionId != sessionId
        || !PayloadDigest.FixedTimeEqualsHex(ready.TranscriptSha256, transcriptSha256)
        || !PayloadDigest.FixedTimeEqualsHex(ready.MacSha256, expectedMac))
      {
        throw new CryptographicException("The provisioning agent ready proof is invalid.");
      }

      return new ProvisioningSession(
        pipe,
        sessionKey,
        new SecretProvisioningCallerIdentity(
          sid!,
          processId,
          sessionId,
          executableSha256),
        MaximumFrameBytes);
    }
    catch
    {
      CryptographicOperations.ZeroMemory(sessionKey);
      throw;
    }
  }

  private string ValidateHelloAndImage(
    SecretProvisioningAgentHello hello,
    Process process,
    int actualProcessId,
    int actualSessionId,
    string? actualSid)
  {
    var now = DateTimeOffset.UtcNow;
    if (hello.ProtocolVersion != SecretProvisioningProtocol.Version
      || !string.Equals(hello.DeviceId, _companion.DeviceId, StringComparison.Ordinal)
      || hello.ProcessId != actualProcessId
      || hello.SessionId != actualSessionId
      || !string.Equals(hello.UserSid, actualSid, StringComparison.Ordinal)
      || hello.CreatedAt < now.AddMinutes(-1)
      || hello.CreatedAt > now.AddMinutes(1)
      || !TryDecodeExact(hello.AgentNonceBase64, 32)
      || string.IsNullOrWhiteSpace(hello.AgentEphemeralPublicKeyBase64)
      || actualSid is null
      || actualSid is "S-1-5-18" or "S-1-5-19" or "S-1-5-20"
      || (_options.RequireActiveConsoleSession
        && actualSessionId != checked((int)GetActiveConsoleSessionId())))
    {
      throw new UnauthorizedAccessException("The local provisioning agent identity is invalid.");
    }

    var path = process.MainModule?.FileName
      ?? throw new UnauthorizedAccessException("The local provisioning agent image is unavailable.");
    using var stream = new FileStream(
      Path.GetFullPath(path),
      FileMode.Open,
      FileAccess.Read,
      FileShare.Read | FileShare.Delete);
    var actualSha256 = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    if (!PayloadDigest.FixedTimeEqualsHex(
      _options.AllowedAgentExecutableSha256,
      actualSha256))
    {
      throw new UnauthorizedAccessException("The local provisioning agent image is not approved.");
    }

    return actualSha256;
  }

  private NamedPipeServerStream CreatePipe() => NamedPipeServerStreamAcl.Create(
    _options.PipeName,
    PipeDirection.InOut,
    4,
    PipeTransmissionMode.Byte,
    PipeOptions.Asynchronous | PipeOptions.WriteThrough,
    65_536,
    65_536,
    SessionPipeSecurity.Create(),
    HandleInheritability.None,
    PipeAccessRights.ChangePermissions);

  private void ValidateConfigurationAndBoundary()
  {
    if (!_options.Enabled
      || !IsSafePipeName(_options.PipeName)
      || !PayloadDigest.IsSha256Hex(_options.AllowedAgentExecutableSha256)
      || _options.MaximumFrameBytes is < 65_536 or > 1_048_576
      || _options.ConfirmationTtlSeconds is < 30 or > 300
      || string.IsNullOrWhiteSpace(_companion.DeviceId)
      || string.Equals(_companion.DeviceId, "UNENROLLED", StringComparison.Ordinal))
    {
      throw new InvalidOperationException(
        "The local secret provisioning channel is not configured.");
    }

    SecretProvisioningRuntimeBoundary.ValidateLocalSystemAndAcl(
      _host.SecretVaultPath,
      Path.GetDirectoryName(Environment.ExpandEnvironmentVariables(
        _options.AuditJournalPath)) ?? string.Empty);
    _ = _catalog.List();
  }

  private bool IsKillSwitchEngaged() => File.Exists(Path.GetFullPath(
    Environment.ExpandEnvironmentVariables(_companion.KillSwitchPath)));

  private int MaximumFrameBytes => Math.Clamp(
    _options.MaximumFrameBytes,
    65_536,
    1_048_576);

  private static T Deserialize<T>(string json)
  {
    try
    {
      return JsonSerializer.Deserialize<T>(json, SerializerOptions)
        ?? throw new JsonException();
    }
    catch (JsonException)
    {
      throw new InvalidDataException("The local provisioning payload is invalid.");
    }
  }

  private static void ValidateRequestId(string requestId, string correlationId)
  {
    if (!Guid.TryParseExact(requestId, "D", out _)
      || !string.Equals(requestId, correlationId, StringComparison.Ordinal))
    {
      throw new InvalidDataException("The local provisioning request identifier is invalid.");
    }
  }

  private static int GetClientProcessId(SafePipeHandle pipe)
  {
    if (!GetNamedPipeClientProcessId(pipe, out var processId)
      || processId is 0 or > int.MaxValue)
    {
      throw new UnauthorizedAccessException("The provisioning client PID is unavailable.");
    }
    return checked((int)processId);
  }

  private static uint GetActiveConsoleSessionId()
  {
    var sessionId = WTSGetActiveConsoleSessionId();
    return sessionId == uint.MaxValue
      ? throw new UnauthorizedAccessException("No active console session is available.")
      : sessionId;
  }

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
      // Logged at the connection boundary.
    }
  }

  [LibraryImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool GetNamedPipeClientProcessId(
    SafePipeHandle pipe,
    out uint clientProcessId);

  [LibraryImport("kernel32.dll")]
  private static partial uint WTSGetActiveConsoleSessionId();

  private sealed class ProvisioningSession : IAsyncDisposable
  {
    private readonly NamedPipeServerStream _pipe;
    private readonly byte[] _sessionKey;
    private readonly int _maximumFrameBytes;
    private readonly SemaphoreSlim _sendGate = new(1, 1);
    private long _inboundSequence;
    private long _outboundSequence;

    public ProvisioningSession(
      NamedPipeServerStream pipe,
      byte[] sessionKey,
      SecretProvisioningCallerIdentity caller,
      int maximumFrameBytes)
    {
      _pipe = pipe;
      _sessionKey = sessionKey;
      Caller = caller;
      _maximumFrameBytes = maximumFrameBytes;
    }

    public SecretProvisioningCallerIdentity Caller { get; }

    public ReadOnlySpan<byte> SessionKey => _sessionKey;

    public async ValueTask<AuthenticatedSessionFrame> ReadAsync(
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
        throw new CryptographicException("The local provisioning frame is unauthenticated.");
      }
      return frame;
    }

    public async ValueTask SendAsync<T>(
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

    public async ValueTask DisposeAsync()
    {
      CryptographicOperations.ZeroMemory(_sessionKey);
      _sendGate.Dispose();
      await _pipe.DisposeAsync().ConfigureAwait(false);
    }
  }
}

internal static class SecretProvisioningRuntimeBoundary
{
  private static readonly SecurityIdentifier LocalSystemSid = new(
    WellKnownSidType.LocalSystemSid,
    null);
  private static readonly SecurityIdentifier[] BroadSids =
  [
    new(WellKnownSidType.WorldSid, null),
    new(WellKnownSidType.AuthenticatedUserSid, null),
    new(WellKnownSidType.BuiltinUsersSid, null),
    new(WellKnownSidType.BuiltinAdministratorsSid, null),
    new(WellKnownSidType.BuiltinGuestsSid, null),
    new(WellKnownSidType.InteractiveSid, null),
    new(WellKnownSidType.NetworkSid, null),
    new(WellKnownSidType.AnonymousSid, null),
    new(WellKnownSidType.LocalServiceSid, null),
    new(WellKnownSidType.NetworkServiceSid, null),
  ];
  private const FileSystemRights MutationRights = FileSystemRights.WriteData
    | FileSystemRights.AppendData
    | FileSystemRights.WriteExtendedAttributes
    | FileSystemRights.WriteAttributes
    | FileSystemRights.DeleteSubdirectoriesAndFiles
    | FileSystemRights.ChangePermissions
    | FileSystemRights.TakeOwnership
    | FileSystemRights.Delete;

  public static void ValidateLocalSystemAndAcl(
    string secretVaultDirectory,
    string auditDirectory)
  {
    if (!OperatingSystem.IsWindows())
    {
      throw new PlatformNotSupportedException("Local secret provisioning requires Windows.");
    }

    using var identity = WindowsIdentity.GetCurrent(TokenAccessLevels.Query);
    if (identity.User is null || !LocalSystemSid.Equals(identity.User))
    {
      throw new UnauthorizedAccessException(
        "Local secret provisioning must run as LocalSystem.");
    }

    ValidatePath(
      secretVaultDirectory,
      denyBroadRead: true,
      validateChildren: true);
    ValidatePath(
      auditDirectory,
      denyBroadRead: false,
      validateChildren: true);
  }

  private static void ValidatePath(
    string configured,
    bool denyBroadRead,
    bool validateChildren)
  {
    var path = Path.GetFullPath(Environment.ExpandEnvironmentVariables(configured));
    if (!Directory.Exists(path)
      || (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
    {
      throw new UnauthorizedAccessException(
        "A protected secret provisioning directory is absent or indirect.");
    }

    var security = new DirectoryInfo(path).GetAccessControl(
      AccessControlSections.Owner | AccessControlSections.Access);
    ValidateSecurity(security, denyBroadRead);
    if (!validateChildren)
    {
      return;
    }

    var children = Directory.EnumerateFiles(path, "*", SearchOption.TopDirectoryOnly)
      .Take(10_001)
      .ToArray();
    if (children.Length > 10_000)
    {
      throw new UnauthorizedAccessException(
        "A protected secret provisioning directory is unexpectedly large.");
    }

    foreach (var child in children)
    {
      if ((File.GetAttributes(child) & FileAttributes.ReparsePoint) != 0)
      {
        throw new UnauthorizedAccessException(
          "A protected secret provisioning record is indirect.");
      }
      var childSecurity = new FileInfo(child).GetAccessControl(
        AccessControlSections.Owner | AccessControlSections.Access);
      ValidateSecurity(childSecurity, denyBroadRead);
    }
  }

  internal static void ValidateDirectorySecurity(FileSystemSecurity security) =>
    ValidateSecurity(security, denyBroadRead: false);

  internal static void ValidateSecretVaultSecurity(FileSystemSecurity security) =>
    ValidateSecurity(security, denyBroadRead: true);

  private static void ValidateSecurity(
    FileSystemSecurity security,
    bool denyBroadRead)
  {
    var owner = security.GetOwner(typeof(SecurityIdentifier)) as SecurityIdentifier;
    if (owner is null || !LocalSystemSid.Equals(owner))
    {
      throw new UnauthorizedAccessException(
        "A protected secret provisioning object owner is invalid.");
    }

    var rules = security.GetAccessRules(
      includeExplicit: true,
      includeInherited: true,
      typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>();
    if (rules.Any(rule => rule.AccessControlType == AccessControlType.Allow
      && BroadSids.Any(sid => sid.Equals(rule.IdentityReference))
      && (denyBroadRead || (rule.FileSystemRights & MutationRights) != 0)))
    {
      throw new UnauthorizedAccessException(
        denyBroadRead
          ? "A secret-vault object grants broad access."
          : "A secret-provisioning audit object grants broad write access.");
    }
  }
}
