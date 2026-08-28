using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Contracts.SessionBridge;

public static class SessionBridgeProtocol
{
  public const int Version = 2;
  public const string Execute = "execute";
  public const string Cancel = "cancel";
  public const string Completion = "completion";
  public const string Manifest = "manifest";
  public const string Heartbeat = "heartbeat";
}

public sealed record SessionAgentHello(
  int ProtocolVersion,
  string DeviceId,
  int ProcessId,
  long ProcessCreationTimeUnixMilliseconds,
  string SubjectImageSha256,
  int SessionId,
  string UserSid,
  string AgentNonceBase64,
  string AgentEphemeralPublicKeyBase64,
  bool BrowserExternalEffectsRequested,
  bool EmergencyCommandRequested,
  string CapabilityManifestSha256,
  string DestinationPolicySha256,
  DateTimeOffset CreatedAt);

public sealed record SessionServiceChallenge(
  int ProtocolVersion,
  string DeviceId,
  int SessionId,
  string AgentNonceBase64,
  string ServiceNonceBase64,
  string ServiceEphemeralPublicKeyBase64,
  string ServiceCertificateThumbprint,
  string ServiceCertificateSha256,
  DateTimeOffset ExpiresAt,
  SignedCapabilityBoundaryAttestation? CapabilityBoundaryAttestation,
  string SignatureBase64);

public sealed record SessionAgentReady(
  int ProtocolVersion,
  string DeviceId,
  int SessionId,
  string TranscriptSha256,
  string MacSha256);

public sealed record AuthenticatedSessionFrame(
  long Sequence,
  string Kind,
  string CorrelationId,
  string PayloadJson,
  string MacSha256);

public sealed record SessionActionInvocation(
  string CapabilityId,
  string CapabilityVersion,
  ActionExecutionContext Context,
  string ArgumentsJson,
  IReadOnlyList<SessionSecretEnvelope> SecretEnvelopes,
  DateTimeOffset ExpiresAt);

/// <summary>
/// Ciphertext-only secret binding for one interactive action. Plaintext is
/// never a session DTO field and therefore cannot enter frame/log/journal JSON.
/// </summary>
public sealed record SessionSecretEnvelope(
  string BindingId,
  string DestinationScopeSha256,
  string NonceBase64,
  string CiphertextBase64,
  string TagBase64);

public sealed record SessionCancelInvocation(
  string ActionId,
  string TaskId,
  string ReasonCode,
  DateTimeOffset RequestedAt);

public sealed record SessionActionCompletion(
  string ActionId,
  string TaskId,
  string StepId,
  ActionOutcome Outcome,
  CapabilityExecutionResult? Result,
  string? ErrorCode);

public sealed record SessionAgentManifest(
  string DeviceId,
  int SessionId,
  string ManifestSha256,
  IReadOnlyList<CapabilityDescriptor> Capabilities,
  DateTimeOffset GeneratedAt);

public sealed record SessionAgentHeartbeat(
  string DeviceId,
  int SessionId,
  bool ExecutionEnabled,
  bool KillSwitchEngaged,
  int RunningActionCount,
  DateTimeOffset SentAt);

public static class SessionBridgeAuthentication
{
  public static byte[] CreateChallengeTranscript(
    SessionAgentHello hello,
    SessionServiceChallenge challenge)
  {
    var canonical = string.Join('\n',
      "itemba-msaidizi-session-bridge-v2",
      hello.ProtocolVersion.ToString(System.Globalization.CultureInfo.InvariantCulture),
      hello.DeviceId,
      hello.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture),
      hello.ProcessCreationTimeUnixMilliseconds.ToString(
        System.Globalization.CultureInfo.InvariantCulture),
      hello.SubjectImageSha256,
      hello.SessionId.ToString(System.Globalization.CultureInfo.InvariantCulture),
      hello.UserSid,
      hello.AgentNonceBase64,
      hello.AgentEphemeralPublicKeyBase64,
      hello.BrowserExternalEffectsRequested ? "1" : "0",
      hello.EmergencyCommandRequested ? "1" : "0",
      hello.CapabilityManifestSha256,
      hello.DestinationPolicySha256,
      challenge.ServiceNonceBase64,
      challenge.ServiceEphemeralPublicKeyBase64,
      challenge.ServiceCertificateThumbprint,
      challenge.ServiceCertificateSha256,
      challenge.CapabilityBoundaryAttestation is null
        ? string.Empty
        : CapabilityBoundaryAttestationCanonical.EnvelopeSha256(
          challenge.CapabilityBoundaryAttestation),
      challenge.ExpiresAt.ToUniversalTime().ToString("O",
        System.Globalization.CultureInfo.InvariantCulture));
    return Encoding.UTF8.GetBytes(canonical);
  }

  public static byte[] DeriveSessionKey(
    ECDiffieHellman localKey,
    ECDiffieHellmanPublicKey remoteKey,
    string agentNonceBase64,
    string serviceNonceBase64,
    string transcriptSha256)
  {
    var agentNonce = Convert.FromBase64String(agentNonceBase64);
    var serviceNonce = Convert.FromBase64String(serviceNonceBase64);
    try
    {
      if (agentNonce.Length != 32 || serviceNonce.Length != 32)
      {
        throw new CryptographicException("Session nonces must be exactly 256 bits.");
      }

      var transcript = Convert.FromHexString(transcriptSha256);
      if (transcript.Length != 32)
      {
        throw new CryptographicException("The session transcript digest is invalid.");
      }

      var prepend = new byte[agentNonce.Length + serviceNonce.Length + transcript.Length];
      agentNonce.CopyTo(prepend, 0);
      serviceNonce.CopyTo(prepend, agentNonce.Length);
      transcript.CopyTo(prepend, agentNonce.Length + serviceNonce.Length);
      try
      {
        return localKey.DeriveKeyFromHash(
          remoteKey,
          HashAlgorithmName.SHA256,
          prepend,
          Encoding.UTF8.GetBytes("itemba-msaidizi-session-key-v2"));
      }
      finally
      {
        CryptographicOperations.ZeroMemory(prepend);
        CryptographicOperations.ZeroMemory(transcript);
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(agentNonce);
      CryptographicOperations.ZeroMemory(serviceNonce);
    }
  }

  public static string ComputeReadyMac(
    ReadOnlySpan<byte> sessionKey,
    string deviceId,
    int sessionId,
    string transcriptSha256)
  {
    var value = Encoding.UTF8.GetBytes(string.Join('\n',
      "ready",
      deviceId,
      sessionId.ToString(System.Globalization.CultureInfo.InvariantCulture),
      transcriptSha256));
    try
    {
      return Convert.ToHexString(HMACSHA256.HashData(sessionKey, value)).ToLowerInvariant();
    }
    finally
    {
      CryptographicOperations.ZeroMemory(value);
    }
  }

  public static string ComputeFrameMac(
    ReadOnlySpan<byte> sessionKey,
    long sequence,
    string kind,
    string correlationId,
    string payloadJson)
  {
    var payloadSha256 = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payloadJson)))
      .ToLowerInvariant();
    var canonical = Encoding.UTF8.GetBytes(string.Join('\n',
      "frame",
      sequence.ToString(System.Globalization.CultureInfo.InvariantCulture),
      kind,
      correlationId,
      payloadSha256));
    try
    {
      return Convert.ToHexString(HMACSHA256.HashData(sessionKey, canonical)).ToLowerInvariant();
    }
    finally
    {
      CryptographicOperations.ZeroMemory(canonical);
    }
  }

  public static bool FixedTimeEqualsHex(string expected, string actual)
  {
    try
    {
      var left = Convert.FromHexString(expected);
      var right = Convert.FromHexString(actual);
      try
      {
        return left.Length == 32
          && right.Length == 32
          && CryptographicOperations.FixedTimeEquals(left, right);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(left);
        CryptographicOperations.ZeroMemory(right);
      }
    }
    catch (FormatException)
    {
      return false;
    }
  }
}

public static class SessionSecretEnvelopeProtection
{
  private const int NonceBytes = 12;
  private const int TagBytes = 16;

  public static SessionSecretEnvelope Protect(
    ReadOnlySpan<byte> sessionKey,
    string actionId,
    string capabilityId,
    string bindingId,
    string destinationScopeSha256,
    ReadOnlySpan<byte> plaintext)
  {
    ValidateMetadata(actionId, capabilityId, bindingId, destinationScopeSha256);
    if (plaintext.Length is <= 0 or > 262_144)
    {
      throw new CryptographicException("Session secret length is invalid.");
    }

    var nonce = RandomNumberGenerator.GetBytes(NonceBytes);
    var ciphertext = new byte[plaintext.Length];
    var tag = new byte[TagBytes];
    var encryptionKey = DeriveEncryptionKey(sessionKey);
    var associatedData = AssociatedData(
      actionId,
      capabilityId,
      bindingId,
      destinationScopeSha256);
    try
    {
      using var cipher = new AesGcm(encryptionKey, TagBytes);
      cipher.Encrypt(nonce, plaintext, ciphertext, tag, associatedData);
      return new SessionSecretEnvelope(
        bindingId,
        destinationScopeSha256.ToLowerInvariant(),
        Convert.ToBase64String(nonce),
        Convert.ToBase64String(ciphertext),
        Convert.ToBase64String(tag));
    }
    finally
    {
      CryptographicOperations.ZeroMemory(encryptionKey);
      CryptographicOperations.ZeroMemory(associatedData);
      CryptographicOperations.ZeroMemory(nonce);
      CryptographicOperations.ZeroMemory(ciphertext);
      CryptographicOperations.ZeroMemory(tag);
    }
  }

  public static byte[] Unprotect(
    ReadOnlySpan<byte> sessionKey,
    string actionId,
    string capabilityId,
    SessionSecretEnvelope envelope)
  {
    ValidateMetadata(
      actionId,
      capabilityId,
      envelope.BindingId,
      envelope.DestinationScopeSha256);
    var nonce = DecodeExact(envelope.NonceBase64, NonceBytes);
    var tag = DecodeExact(envelope.TagBase64, TagBytes);
    var ciphertext = Convert.FromBase64String(envelope.CiphertextBase64);
    if (ciphertext.Length is <= 0 or > 262_144)
    {
      CryptographicOperations.ZeroMemory(nonce);
      CryptographicOperations.ZeroMemory(tag);
      CryptographicOperations.ZeroMemory(ciphertext);
      throw new CryptographicException("Session secret ciphertext length is invalid.");
    }

    var plaintext = new byte[ciphertext.Length];
    var encryptionKey = DeriveEncryptionKey(sessionKey);
    var associatedData = AssociatedData(
      actionId,
      capabilityId,
      envelope.BindingId,
      envelope.DestinationScopeSha256);
    try
    {
      using var cipher = new AesGcm(encryptionKey, TagBytes);
      cipher.Decrypt(nonce, ciphertext, tag, plaintext, associatedData);
      return plaintext;
    }
    catch
    {
      CryptographicOperations.ZeroMemory(plaintext);
      throw;
    }
    finally
    {
      CryptographicOperations.ZeroMemory(encryptionKey);
      CryptographicOperations.ZeroMemory(associatedData);
      CryptographicOperations.ZeroMemory(nonce);
      CryptographicOperations.ZeroMemory(ciphertext);
      CryptographicOperations.ZeroMemory(tag);
    }
  }

  private static byte[] DeriveEncryptionKey(ReadOnlySpan<byte> sessionKey) =>
    HMACSHA256.HashData(
      sessionKey,
      "itemba-msaidizi-session-secret-aes256-v1"u8);

  private static byte[] AssociatedData(
    string actionId,
    string capabilityId,
    string bindingId,
    string destinationScopeSha256) => Encoding.UTF8.GetBytes(string.Join('\n',
      "itemba-msaidizi-session-secret-envelope-v1",
      actionId,
      capabilityId,
      bindingId,
      destinationScopeSha256.ToLowerInvariant()));

  private static byte[] DecodeExact(string value, int length)
  {
    try
    {
      var decoded = Convert.FromBase64String(value);
      if (decoded.Length == length)
      {
        return decoded;
      }
      CryptographicOperations.ZeroMemory(decoded);
    }
    catch (FormatException)
    {
      // Converted to one uniform cryptographic failure below.
    }
    throw new CryptographicException("Session secret envelope encoding is invalid.");
  }

  private static void ValidateMetadata(
    string actionId,
    string capabilityId,
    string bindingId,
    string destinationScopeSha256)
  {
    if (!IsSafeToken(actionId, 256)
      || !IsSafeToken(capabilityId, 256)
      || !IsSafeToken(bindingId, 80)
      || destinationScopeSha256.Length != 64
      || !destinationScopeSha256.All(character => char.IsAsciiHexDigit(character)))
    {
      throw new CryptographicException("Session secret envelope metadata is invalid.");
    }
  }

  private static bool IsSafeToken(string value, int maximumLength) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= maximumLength
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_' or ':');
}

public static class SessionBridgeWire
{
  private static readonly JsonSerializerOptions SerializerOptions =
    new(JsonSerializerDefaults.Web);

  public static async ValueTask WriteAsync<T>(
    Stream stream,
    T message,
    int maximumFrameBytes,
    CancellationToken cancellationToken)
  {
    var payload = JsonSerializer.SerializeToUtf8Bytes(message, SerializerOptions);
    if (payload.Length is <= 0 || payload.Length > maximumFrameBytes)
    {
      throw new InvalidDataException("Session bridge frame exceeds its configured limit.");
    }

    var header = new byte[sizeof(int)];
    BinaryPrimitives.WriteInt32LittleEndian(header, payload.Length);
    await stream.WriteAsync(header, cancellationToken).ConfigureAwait(false);
    await stream.WriteAsync(payload, cancellationToken).ConfigureAwait(false);
    await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
  }

  public static async ValueTask<T> ReadAsync<T>(
    Stream stream,
    int maximumFrameBytes,
    CancellationToken cancellationToken)
  {
    var header = new byte[sizeof(int)];
    await stream.ReadExactlyAsync(header, cancellationToken).ConfigureAwait(false);
    var length = BinaryPrimitives.ReadInt32LittleEndian(header);
    if (length is <= 0 || length > maximumFrameBytes)
    {
      throw new InvalidDataException("Session bridge frame length is invalid.");
    }

    var payload = new byte[length];
    await stream.ReadExactlyAsync(payload, cancellationToken).ConfigureAwait(false);
    try
    {
      using var document = JsonDocument.Parse(payload, new JsonDocumentOptions
      {
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = 32,
      });
      return document.Deserialize<T>(SerializerOptions)
        ?? throw new InvalidDataException("Session bridge frame was empty.");
    }
    catch (JsonException exception)
    {
      throw new InvalidDataException("Session bridge frame JSON is invalid.", exception);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(payload);
    }
  }
}
