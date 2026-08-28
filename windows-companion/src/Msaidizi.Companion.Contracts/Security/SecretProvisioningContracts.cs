using System.Buffers;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Itemba.Msaidizi.Companion.Contracts.Security;

public static class SecretProvisioningProtocol
{
  public const int Version = 1;
  public const string CatalogRequest = "secret-catalog-request";
  public const string CatalogResponse = "secret-catalog-response";
  public const string Begin = "secret-begin";
  public const string Challenge = "secret-challenge";
  public const string Commit = "secret-commit";
  public const string Result = "secret-result";
}

public sealed record SecretProvisioningAgentHello(
  int ProtocolVersion,
  string DeviceId,
  int ProcessId,
  int SessionId,
  string UserSid,
  string AgentNonceBase64,
  string AgentEphemeralPublicKeyBase64,
  DateTimeOffset CreatedAt);

public sealed record SecretProvisioningServiceChallenge(
  int ProtocolVersion,
  string DeviceId,
  int SessionId,
  string AgentNonceBase64,
  string ServiceNonceBase64,
  string ServiceEphemeralPublicKeyBase64,
  string ServiceCertificateThumbprint,
  string ServiceCertificateSha256,
  DateTimeOffset ExpiresAt,
  string SignatureBase64);

public sealed record SecretProvisioningAgentReady(
  int ProtocolVersion,
  string DeviceId,
  int SessionId,
  string TranscriptSha256,
  string MacSha256);

public static class SecretProvisioningAuthentication
{
  public static byte[] CreateChallengeTranscript(
    SecretProvisioningAgentHello hello,
    SecretProvisioningServiceChallenge challenge) => Encoding.UTF8.GetBytes(string.Join('\n',
      "itemba-msaidizi-secret-provisioning-handshake-v1",
      hello.ProtocolVersion.ToString(CultureInfo.InvariantCulture),
      hello.DeviceId,
      hello.ProcessId.ToString(CultureInfo.InvariantCulture),
      hello.SessionId.ToString(CultureInfo.InvariantCulture),
      hello.UserSid,
      hello.AgentNonceBase64,
      hello.AgentEphemeralPublicKeyBase64,
      challenge.ServiceNonceBase64,
      challenge.ServiceEphemeralPublicKeyBase64,
      challenge.ServiceCertificateThumbprint,
      challenge.ServiceCertificateSha256,
      challenge.ExpiresAt.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture)));

  public static byte[] DeriveSessionKey(
    ECDiffieHellman localKey,
    ECDiffieHellmanPublicKey remoteKey,
    string agentNonceBase64,
    string serviceNonceBase64,
    string transcriptSha256)
  {
    var agentNonce = Convert.FromBase64String(agentNonceBase64);
    var serviceNonce = Convert.FromBase64String(serviceNonceBase64);
    var transcript = Convert.FromHexString(transcriptSha256);
    try
    {
      if (agentNonce.Length != 32 || serviceNonce.Length != 32 || transcript.Length != 32)
      {
        throw new CryptographicException("The local provisioning handshake is invalid.");
      }

      var prepend = new byte[agentNonce.Length + serviceNonce.Length + transcript.Length];
      try
      {
        agentNonce.CopyTo(prepend, 0);
        serviceNonce.CopyTo(prepend, agentNonce.Length);
        transcript.CopyTo(prepend, agentNonce.Length + serviceNonce.Length);
        return localKey.DeriveKeyFromHash(
          remoteKey,
          HashAlgorithmName.SHA256,
          prepend,
          "itemba-msaidizi-secret-provisioning-session-key-v1"u8.ToArray());
      }
      finally
      {
        CryptographicOperations.ZeroMemory(prepend);
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(agentNonce);
      CryptographicOperations.ZeroMemory(serviceNonce);
      CryptographicOperations.ZeroMemory(transcript);
    }
  }

  public static string ComputeReadyMac(
    ReadOnlySpan<byte> sessionKey,
    string deviceId,
    int sessionId,
    string transcriptSha256)
  {
    var canonical = Encoding.UTF8.GetBytes(string.Join('\n',
      "itemba-msaidizi-secret-provisioning-ready-v1",
      deviceId,
      sessionId.ToString(CultureInfo.InvariantCulture),
      transcriptSha256));
    try
    {
      return Convert.ToHexString(HMACSHA256.HashData(sessionKey, canonical)).ToLowerInvariant();
    }
    finally
    {
      CryptographicOperations.ZeroMemory(canonical);
    }
  }
}

public static class SecretProvisioningOperations
{
  public const string Create = "create";
  public const string Rotate = "rotate";
  public const string Delete = "delete";

  public static bool IsKnown(string value) => value is Create or Rotate or Delete;

  public static bool RequiresSecret(string value) => value is Create or Rotate;
}

public sealed record SecretProvisioningCatalogRequest(string RequestId);

public sealed record SecretProvisioningBindingPreview(
  string BindingId,
  string DisplayName,
  string Kind,
  string Destination,
  string DestinationScopeSha256,
  IReadOnlyList<string> AllowedCapabilities);

public sealed record SecretProvisioningCatalogResponse(
  string RequestId,
  IReadOnlyList<SecretProvisioningBindingPreview> Bindings);

public sealed record SecretProvisioningBeginRequest(
  string RequestId,
  string Operation,
  string BindingId,
  string? VaultReferenceId);

public sealed record SecretProvisioningChallenge(
  string RequestId,
  string ConfirmationId,
  string Operation,
  SecretProvisioningBindingPreview Binding,
  string? VaultReferenceId,
  string ManifestSha256,
  DateTimeOffset ExpiresAt);

/// <summary>
/// Ciphertext-only envelope used exclusively on the authenticated local pipe.
/// Plaintext is deliberately absent from every provisioning DTO.
/// </summary>
public sealed record SecretProvisioningSecretEnvelope(
  string NonceBase64,
  string CiphertextBase64,
  string TagBase64);

public sealed record SecretProvisioningCommitRequest(
  string RequestId,
  string ConfirmationId,
  string ManifestSha256,
  SecretProvisioningSecretEnvelope? SecretEnvelope);

public sealed record SecretProvisioningResultMetadata(
  string VaultReferenceId,
  string Kind,
  string DestinationScopeSha256,
  IReadOnlyList<string> AllowedCapabilities,
  int Version,
  DateTimeOffset CreatedAt,
  DateTimeOffset UpdatedAt);

public sealed record SecretProvisioningResult(
  string RequestId,
  string Operation,
  string Outcome,
  bool Replayed,
  string? ErrorCode,
  SecretProvisioningResultMetadata? Metadata);

public static class SecretProvisioningManifest
{
  public static string ComputeSha256(
    string requestId,
    string operation,
    SecretProvisioningBindingPreview binding,
    string? vaultReferenceId)
  {
    var writer = new ArrayBufferWriter<byte>();
    Write(writer, "itemba-msaidizi-secret-provisioning-manifest-v1");
    Write(writer, requestId);
    Write(writer, operation);
    Write(writer, binding.BindingId);
    Write(writer, binding.DisplayName);
    Write(writer, binding.Kind);
    Write(writer, binding.Destination);
    Write(writer, binding.DestinationScopeSha256.ToLowerInvariant());
    Write(writer, vaultReferenceId ?? string.Empty);
    Write(writer, binding.AllowedCapabilities.Count.ToString(CultureInfo.InvariantCulture));
    foreach (var capability in binding.AllowedCapabilities)
    {
      Write(writer, capability);
    }

    return Convert.ToHexString(SHA256.HashData(writer.WrittenSpan)).ToLowerInvariant();
  }

  private static void Write(ArrayBufferWriter<byte> writer, string value)
  {
    var maximum = Encoding.UTF8.GetMaxByteCount(value.Length);
    var span = writer.GetSpan(sizeof(int) + maximum);
    var length = Encoding.UTF8.GetBytes(value, span[sizeof(int)..]);
    System.Buffers.Binary.BinaryPrimitives.WriteInt32LittleEndian(span, length);
    writer.Advance(sizeof(int) + length);
  }
}

public static class SecretProvisioningEnvelopeProtection
{
  private const int NonceBytes = 12;
  private const int TagBytes = 16;
  private const int MaximumSecretBytes = 262_144;

  public static SecretProvisioningSecretEnvelope Protect(
    ReadOnlySpan<byte> sessionKey,
    string requestId,
    string manifestSha256,
    ReadOnlySpan<byte> plaintext)
  {
    Validate(requestId, manifestSha256);
    if (plaintext.Length is <= 0 or > MaximumSecretBytes)
    {
      throw new CryptographicException("The local provisioning secret length is invalid.");
    }

    var nonce = RandomNumberGenerator.GetBytes(NonceBytes);
    var ciphertext = new byte[plaintext.Length];
    var tag = new byte[TagBytes];
    var key = DeriveKey(sessionKey);
    var associatedData = AssociatedData(requestId, manifestSha256);
    try
    {
      using var cipher = new AesGcm(key, TagBytes);
      cipher.Encrypt(nonce, plaintext, ciphertext, tag, associatedData);
      return new SecretProvisioningSecretEnvelope(
        Convert.ToBase64String(nonce),
        Convert.ToBase64String(ciphertext),
        Convert.ToBase64String(tag));
    }
    finally
    {
      CryptographicOperations.ZeroMemory(nonce);
      CryptographicOperations.ZeroMemory(ciphertext);
      CryptographicOperations.ZeroMemory(tag);
      CryptographicOperations.ZeroMemory(key);
      CryptographicOperations.ZeroMemory(associatedData);
    }
  }

  public static byte[] Unprotect(
    ReadOnlySpan<byte> sessionKey,
    string requestId,
    string manifestSha256,
    SecretProvisioningSecretEnvelope envelope)
  {
    Validate(requestId, manifestSha256);
    var nonce = DecodeExact(envelope.NonceBase64, NonceBytes);
    var tag = DecodeExact(envelope.TagBase64, TagBytes);
    byte[] ciphertext;
    try
    {
      ciphertext = Convert.FromBase64String(envelope.CiphertextBase64);
    }
    catch (FormatException exception)
    {
      CryptographicOperations.ZeroMemory(nonce);
      CryptographicOperations.ZeroMemory(tag);
      throw new CryptographicException("The local provisioning envelope is invalid.", exception);
    }

    if (ciphertext.Length is <= 0 or > MaximumSecretBytes)
    {
      CryptographicOperations.ZeroMemory(nonce);
      CryptographicOperations.ZeroMemory(tag);
      CryptographicOperations.ZeroMemory(ciphertext);
      throw new CryptographicException("The local provisioning envelope length is invalid.");
    }

    var plaintext = new byte[ciphertext.Length];
    var key = DeriveKey(sessionKey);
    var associatedData = AssociatedData(requestId, manifestSha256);
    try
    {
      using var cipher = new AesGcm(key, TagBytes);
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
      CryptographicOperations.ZeroMemory(nonce);
      CryptographicOperations.ZeroMemory(tag);
      CryptographicOperations.ZeroMemory(ciphertext);
      CryptographicOperations.ZeroMemory(key);
      CryptographicOperations.ZeroMemory(associatedData);
    }
  }

  private static byte[] DeriveKey(ReadOnlySpan<byte> sessionKey) =>
    HMACSHA256.HashData(
      sessionKey,
      "itemba-msaidizi-local-secret-provisioning-aes256-v1"u8);

  private static byte[] AssociatedData(string requestId, string manifestSha256) =>
    Encoding.UTF8.GetBytes(string.Join('\n',
      "itemba-msaidizi-local-secret-provisioning-envelope-v1",
      requestId,
      manifestSha256.ToLowerInvariant()));

  private static byte[] DecodeExact(string value, int expectedLength)
  {
    try
    {
      var decoded = Convert.FromBase64String(value);
      if (decoded.Length == expectedLength)
      {
        return decoded;
      }

      CryptographicOperations.ZeroMemory(decoded);
    }
    catch (FormatException)
    {
      // Emit one uniform cryptographic failure below.
    }

    throw new CryptographicException("The local provisioning envelope is invalid.");
  }

  private static void Validate(string requestId, string manifestSha256)
  {
    if (!Guid.TryParseExact(requestId, "D", out _)
      || !PayloadDigest.IsSha256Hex(manifestSha256))
    {
      throw new CryptographicException("The local provisioning envelope binding is invalid.");
    }
  }
}
