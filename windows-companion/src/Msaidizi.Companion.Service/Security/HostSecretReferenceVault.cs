using System.Security.Cryptography;
using System.Text;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Security;

public sealed record TrustedSecretProvisioningRequest(
  string Kind,
  string ScopeSha256,
  IReadOnlyList<string> AllowedCapabilities);

public sealed record HostSecretReferenceMetadata(
  string VaultReferenceId,
  string Kind,
  string ScopeSha256,
  IReadOnlyList<string> AllowedCapabilities,
  int Version,
  DateTimeOffset CreatedAt,
  DateTimeOffset UpdatedAt);

/// <summary>
/// Consumer boundary for a supervisor-owned secret. Callers receive the bytes
/// only inside the callback; the vault zeroes the DPAPI plaintext immediately
/// afterwards. A UUID reference is an identifier, not a bearer credential:
/// use is additionally bound to the exact capability and destination scope.
/// </summary>
public interface IHostSecretReferenceVault
{
  ValueTask<T> UseAsync<T>(
    string vaultReferenceId,
    string capabilityId,
    string scopeSha256,
    Func<ReadOnlyMemory<byte>, CancellationToken, ValueTask<T>> consumer,
    CancellationToken cancellationToken);
}

/// <summary>
/// Provisioning is intentionally a separate trusted interface and is never
/// registered as a model-addressable host capability. The tray/supervisor may
/// call it only after an explicit local-user credential interaction.
/// </summary>
public interface ITrustedSecretProvisioner
{
  ValueTask<HostSecretReferenceMetadata> ProvisionAsync(
    TrustedSecretProvisioningRequest request,
    ReadOnlyMemory<byte> secret,
    CancellationToken cancellationToken);

  ValueTask<HostSecretReferenceMetadata> ProvisionWithReferenceAsync(
    string vaultReferenceId,
    TrustedSecretProvisioningRequest request,
    ReadOnlyMemory<byte> secret,
    CancellationToken cancellationToken);

  ValueTask<HostSecretReferenceMetadata> RotateAsync(
    string vaultReferenceId,
    TrustedSecretProvisioningRequest request,
    ReadOnlyMemory<byte> secret,
    CancellationToken cancellationToken);

  ValueTask<HostSecretReferenceMetadata> DeleteAsync(
    string vaultReferenceId,
    TrustedSecretProvisioningRequest request,
    CancellationToken cancellationToken);

  ValueTask<HostSecretReferenceMetadata> GetMetadataAsync(
    string vaultReferenceId,
    CancellationToken cancellationToken);
}

public sealed class FileHostSecretReferenceVault :
  IHostSecretReferenceVault,
  ITrustedSecretProvisioner,
  IDisposable
{
  private const int LegacyFormatVersion = 1;
  private const int FormatVersion = 2;
  private const int MaximumRecordBytes = 1_048_576;
  private const int MaximumSecretBytes = 262_144;
  private const int MaximumCapabilities = 32;
  private static readonly byte[] Magic = "IMSV"u8.ToArray();
  private readonly string _directory;
  private readonly SemaphoreSlim _mutationGate = new(1, 1);

  public FileHostSecretReferenceVault(IOptions<HostCapabilityOptions> options)
  {
    _directory = Path.GetFullPath(Environment.ExpandEnvironmentVariables(
      options.Value.SecretVaultPath));
  }

  public void Dispose() => _mutationGate.Dispose();

  public async ValueTask<HostSecretReferenceMetadata> ProvisionAsync(
    TrustedSecretProvisioningRequest request,
    ReadOnlyMemory<byte> secret,
    CancellationToken cancellationToken)
  {
    return await ProvisionCoreAsync(
      Guid.NewGuid().ToString("D"),
      request,
      secret,
      cancellationToken).ConfigureAwait(false);
  }

  public async ValueTask<HostSecretReferenceMetadata> ProvisionWithReferenceAsync(
    string vaultReferenceId,
    TrustedSecretProvisioningRequest request,
    ReadOnlyMemory<byte> secret,
    CancellationToken cancellationToken)
  {
    ValidateReferenceId(vaultReferenceId);
    return await ProvisionCoreAsync(
      vaultReferenceId,
      request,
      secret,
      cancellationToken).ConfigureAwait(false);
  }

  private async ValueTask<HostSecretReferenceMetadata> ProvisionCoreAsync(
    string referenceId,
    TrustedSecretProvisioningRequest request,
    ReadOnlyMemory<byte> secret,
    CancellationToken cancellationToken)
  {
    ValidateProvisioningRequest(request, secret.Length);
    cancellationToken.ThrowIfCancellationRequested();
    await _mutationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      Directory.CreateDirectory(_directory);
      var createdAt = DateTimeOffset.UtcNow;
      return await WriteRecordAsync(
        referenceId,
        request,
        version: 1,
        createdAt,
        createdAt,
        secret,
        overwrite: false,
        cancellationToken).ConfigureAwait(false);
    }
    finally
    {
      _mutationGate.Release();
    }
  }

  public async ValueTask<HostSecretReferenceMetadata> RotateAsync(
    string vaultReferenceId,
    TrustedSecretProvisioningRequest request,
    ReadOnlyMemory<byte> secret,
    CancellationToken cancellationToken)
  {
    ValidateReferenceId(vaultReferenceId);
    ValidateProvisioningRequest(request, secret.Length);
    await _mutationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var current = await ReadRecordAsync(vaultReferenceId, cancellationToken)
        .ConfigureAwait(false);
      try
      {
        EnsureSameBinding(current.Record, request);
        return await WriteRecordAsync(
          vaultReferenceId,
          request,
          checked(current.Record.Version + 1),
          current.Record.CreatedAt,
          DateTimeOffset.UtcNow,
          secret,
          overwrite: true,
          cancellationToken).ConfigureAwait(false);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(current.Plaintext);
      }
    }
    finally
    {
      _mutationGate.Release();
    }
  }

  public async ValueTask<HostSecretReferenceMetadata> DeleteAsync(
    string vaultReferenceId,
    TrustedSecretProvisioningRequest request,
    CancellationToken cancellationToken)
  {
    ValidateReferenceId(vaultReferenceId);
    ValidateProvisioningRequest(request, secretLength: 1);
    await _mutationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var current = await ReadRecordAsync(vaultReferenceId, cancellationToken)
        .ConfigureAwait(false);
      try
      {
        EnsureSameBinding(current.Record, request);
        var path = RecordPath(vaultReferenceId);
        var tombstone = Path.Combine(_directory, $".{Guid.NewGuid():N}.deleted");
        File.Move(path, tombstone, overwrite: false);
        try
        {
          File.Delete(tombstone);
        }
        catch
        {
          try
          {
            File.Move(tombstone, path, overwrite: false);
          }
          catch
          {
            // The coordinator will record an uncertain outcome. The only
            // remaining payload is still DPAPI protected and ACL confined.
          }
          throw;
        }

        return ToMetadata(current.Record);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(current.Plaintext);
      }
    }
    finally
    {
      _mutationGate.Release();
    }
  }

  public async ValueTask<HostSecretReferenceMetadata> GetMetadataAsync(
    string vaultReferenceId,
    CancellationToken cancellationToken)
  {
    ValidateReferenceId(vaultReferenceId);
    await _mutationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var current = await ReadRecordAsync(vaultReferenceId, cancellationToken)
        .ConfigureAwait(false);
      try
      {
        return ToMetadata(current.Record);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(current.Plaintext);
      }
    }
    finally
    {
      _mutationGate.Release();
    }
  }

  public async ValueTask<T> UseAsync<T>(
    string vaultReferenceId,
    string capabilityId,
    string scopeSha256,
    Func<ReadOnlyMemory<byte>, CancellationToken, ValueTask<T>> consumer,
    CancellationToken cancellationToken)
  {
    if (!Guid.TryParseExact(vaultReferenceId, "D", out _)
      || !IsBoundedIdentifier(capabilityId, 256)
      || !PayloadDigest.IsSha256Hex(scopeSha256)
      || consumer is null)
    {
      throw new HostSecretReferenceException("secret_reference_request_invalid");
    }

    await _mutationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      return await UseLockedAsync(
        vaultReferenceId,
        capabilityId,
        scopeSha256,
        consumer,
        cancellationToken).ConfigureAwait(false);
    }
    finally
    {
      _mutationGate.Release();
    }
  }

  private async ValueTask<T> UseLockedAsync<T>(
    string vaultReferenceId,
    string capabilityId,
    string scopeSha256,
    Func<ReadOnlyMemory<byte>, CancellationToken, ValueTask<T>> consumer,
    CancellationToken cancellationToken)
  {
    var path = RecordPath(vaultReferenceId);
    byte[] protectedPayload;
    try
    {
      var info = new FileInfo(path);
      if (!info.Exists || info.Length is <= 0 or > MaximumRecordBytes)
      {
        throw new HostSecretReferenceException("secret_reference_not_found");
      }
      protectedPayload = await File.ReadAllBytesAsync(path, cancellationToken)
        .ConfigureAwait(false);
    }
    catch (HostSecretReferenceException)
    {
      throw;
    }
    catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
    {
      throw new HostSecretReferenceException("secret_reference_not_found");
    }

    byte[] plaintext;
    try
    {
      plaintext = WindowsDataProtection.Unprotect(protectedPayload);
    }
    catch (CryptographicException)
    {
      throw new HostSecretReferenceException("secret_reference_unreadable");
    }
    finally
    {
      CryptographicOperations.ZeroMemory(protectedPayload);
    }

    try
    {
      var record = Parse(plaintext);
      if (!string.Equals(record.ReferenceId, vaultReferenceId, StringComparison.OrdinalIgnoreCase)
        || !record.AllowedCapabilities.Contains(capabilityId, StringComparer.Ordinal)
        || !PayloadDigest.FixedTimeEqualsHex(record.ScopeSha256, scopeSha256))
      {
        throw new HostSecretReferenceException("secret_reference_scope_denied");
      }

      return await consumer(
        plaintext.AsMemory(record.SecretOffset, record.SecretLength),
        cancellationToken).ConfigureAwait(false);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(plaintext);
    }
  }

  private string RecordPath(string referenceId) => Path.Combine(
    _directory,
    $"{PayloadDigest.Sha256Hex($"msaidizi-secret-reference/v1\0{referenceId.ToLowerInvariant()}")}.bin");

  private static byte[] Serialize(
    string referenceId,
    TrustedSecretProvisioningRequest request,
    int version,
    DateTimeOffset createdAt,
    DateTimeOffset updatedAt,
    ReadOnlySpan<byte> secret)
  {
    using var stream = new MemoryStream();
    try
    {
      using (var writer = new BinaryWriter(
        stream,
        new UTF8Encoding(false, true),
        leaveOpen: true))
      {
        writer.Write(Magic);
        writer.Write(FormatVersion);
        writer.Write(referenceId);
        writer.Write(request.Kind);
        writer.Write(request.ScopeSha256.ToLowerInvariant());
        writer.Write(createdAt.ToUnixTimeMilliseconds());
        writer.Write(updatedAt.ToUnixTimeMilliseconds());
        writer.Write(version);
        writer.Write(request.AllowedCapabilities.Count);
        foreach (var capability in request.AllowedCapabilities) writer.Write(capability);
        writer.Write(secret.Length);
        writer.Write(secret);
        writer.Flush();
      }

      if (stream.Length > MaximumRecordBytes)
      {
        throw new HostSecretReferenceException("secret_reference_record_too_large");
      }
      return stream.ToArray();
    }
    finally
    {
      if (stream.TryGetBuffer(out var buffer) && buffer.Array is not null)
      {
        CryptographicOperations.ZeroMemory(buffer.Array);
      }
    }
  }

  private static ParsedSecretRecord Parse(byte[] plaintext)
  {
    try
    {
      using var stream = new MemoryStream(plaintext, writable: false);
      using var reader = new BinaryReader(stream, new UTF8Encoding(false, true), leaveOpen: true);
      if (!reader.ReadBytes(Magic.Length).AsSpan().SequenceEqual(Magic))
      {
        throw new HostSecretReferenceException("secret_reference_format_invalid");
      }

      var formatVersion = reader.ReadInt32();
      if (formatVersion is not LegacyFormatVersion and not FormatVersion)
      {
        throw new HostSecretReferenceException("secret_reference_format_invalid");
      }

      var referenceId = reader.ReadString();
      var kind = reader.ReadString();
      var scopeSha256 = reader.ReadString();
      var createdAt = DateTimeOffset.FromUnixTimeMilliseconds(reader.ReadInt64());
      var updatedAt = formatVersion == LegacyFormatVersion
        ? createdAt
        : DateTimeOffset.FromUnixTimeMilliseconds(reader.ReadInt64());
      var version = formatVersion == LegacyFormatVersion ? 1 : reader.ReadInt32();
      var capabilityCount = reader.ReadInt32();
      if (!Guid.TryParseExact(referenceId, "D", out _)
        || !IsBoundedIdentifier(kind, 128)
        || !PayloadDigest.IsSha256Hex(scopeSha256)
        || version < 1
        || updatedAt < createdAt
        || capabilityCount is < 1 or > MaximumCapabilities)
      {
        throw new HostSecretReferenceException("secret_reference_format_invalid");
      }

      var capabilities = new string[capabilityCount];
      for (var index = 0; index < capabilityCount; index++)
      {
        capabilities[index] = reader.ReadString();
        if (!IsBoundedIdentifier(capabilities[index], 256))
        {
          throw new HostSecretReferenceException("secret_reference_format_invalid");
        }
      }

      var secretLength = reader.ReadInt32();
      var secretOffset = checked((int)stream.Position);
      if (secretLength is <= 0 or > MaximumSecretBytes
        || secretOffset + secretLength != plaintext.Length)
      {
        throw new HostSecretReferenceException("secret_reference_format_invalid");
      }
      return new ParsedSecretRecord(
        referenceId,
        kind,
        scopeSha256,
        capabilities,
        version,
        createdAt,
        updatedAt,
        secretOffset,
        secretLength);
    }
    catch (HostSecretReferenceException)
    {
      throw;
    }
    catch (Exception exception) when (exception is EndOfStreamException
      or IOException
      or DecoderFallbackException
      or ArgumentOutOfRangeException)
    {
      throw new HostSecretReferenceException("secret_reference_format_invalid");
    }
  }

  private static void ValidateProvisioningRequest(
    TrustedSecretProvisioningRequest request,
    int secretLength)
  {
    if (!IsBoundedIdentifier(request.Kind, 128)
      || !PayloadDigest.IsSha256Hex(request.ScopeSha256)
      || request.AllowedCapabilities.Count is < 1 or > MaximumCapabilities
      || request.AllowedCapabilities.Any(value => !IsBoundedIdentifier(value, 256))
      || request.AllowedCapabilities.Distinct(StringComparer.Ordinal).Count()
        != request.AllowedCapabilities.Count
      || secretLength is <= 0 or > MaximumSecretBytes)
    {
      throw new HostSecretReferenceException("secret_reference_provisioning_invalid");
    }
  }

  private static bool IsBoundedIdentifier(string value, int maximumLength) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= maximumLength
    && value.All(character => !char.IsControl(character));

  private async ValueTask<HostSecretReferenceMetadata> WriteRecordAsync(
    string referenceId,
    TrustedSecretProvisioningRequest request,
    int version,
    DateTimeOffset createdAt,
    DateTimeOffset updatedAt,
    ReadOnlyMemory<byte> secret,
    bool overwrite,
    CancellationToken cancellationToken)
  {
    var plaintext = Serialize(
      referenceId,
      request,
      version,
      createdAt,
      updatedAt,
      secret.Span);
    byte[] protectedPayload;
    try
    {
      protectedPayload = WindowsDataProtection.ProtectLocalMachine(plaintext);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(plaintext);
    }

    var path = RecordPath(referenceId);
    var temporary = Path.Combine(_directory, $".{Guid.NewGuid():N}.tmp");
    try
    {
      await using (var stream = new FileStream(
        temporary,
        FileMode.CreateNew,
        FileAccess.Write,
        FileShare.None,
        4096,
        FileOptions.Asynchronous | FileOptions.WriteThrough))
      {
        await stream.WriteAsync(protectedPayload, cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
        stream.Flush(flushToDisk: true);
      }

      File.Move(temporary, path, overwrite);
      return new HostSecretReferenceMetadata(
        referenceId,
        request.Kind,
        request.ScopeSha256.ToLowerInvariant(),
        request.AllowedCapabilities.ToArray(),
        version,
        createdAt,
        updatedAt);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(protectedPayload);
      if (File.Exists(temporary)) File.Delete(temporary);
    }
  }

  private async ValueTask<DecryptedSecretRecord> ReadRecordAsync(
    string referenceId,
    CancellationToken cancellationToken)
  {
    var path = RecordPath(referenceId);
    byte[] protectedPayload;
    try
    {
      var info = new FileInfo(path);
      if (!info.Exists || info.Length is <= 0 or > MaximumRecordBytes)
      {
        throw new HostSecretReferenceException("secret_reference_not_found");
      }

      protectedPayload = await File.ReadAllBytesAsync(path, cancellationToken)
        .ConfigureAwait(false);
    }
    catch (HostSecretReferenceException)
    {
      throw;
    }
    catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
    {
      throw new HostSecretReferenceException("secret_reference_not_found");
    }

    try
    {
      var plaintext = WindowsDataProtection.Unprotect(protectedPayload);
      try
      {
        var record = Parse(plaintext);
        if (!string.Equals(record.ReferenceId, referenceId, StringComparison.OrdinalIgnoreCase))
        {
          throw new HostSecretReferenceException("secret_reference_format_invalid");
        }

        return new DecryptedSecretRecord(record, plaintext);
      }
      catch
      {
        CryptographicOperations.ZeroMemory(plaintext);
        throw;
      }
    }
    catch (HostSecretReferenceException)
    {
      throw;
    }
    catch (CryptographicException)
    {
      throw new HostSecretReferenceException("secret_reference_unreadable");
    }
    finally
    {
      CryptographicOperations.ZeroMemory(protectedPayload);
    }
  }

  private static void EnsureSameBinding(
    ParsedSecretRecord record,
    TrustedSecretProvisioningRequest request)
  {
    if (!string.Equals(record.Kind, request.Kind, StringComparison.Ordinal)
      || !PayloadDigest.FixedTimeEqualsHex(record.ScopeSha256, request.ScopeSha256)
      || !record.AllowedCapabilities.SequenceEqual(
        request.AllowedCapabilities,
        StringComparer.Ordinal))
    {
      throw new HostSecretReferenceException("secret_reference_scope_denied");
    }
  }

  private static HostSecretReferenceMetadata ToMetadata(ParsedSecretRecord record) => new(
    record.ReferenceId,
    record.Kind,
    record.ScopeSha256,
    record.AllowedCapabilities.ToArray(),
    record.Version,
    record.CreatedAt,
    record.UpdatedAt);

  private static void ValidateReferenceId(string referenceId)
  {
    if (!Guid.TryParseExact(referenceId, "D", out _))
    {
      throw new HostSecretReferenceException("secret_reference_request_invalid");
    }
  }

  private sealed record ParsedSecretRecord(
    string ReferenceId,
    string Kind,
    string ScopeSha256,
    IReadOnlyList<string> AllowedCapabilities,
    int Version,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    int SecretOffset,
    int SecretLength);

  private sealed record DecryptedSecretRecord(
    ParsedSecretRecord Record,
    byte[] Plaintext);
}

public sealed class HostSecretReferenceException(string errorCode) : Exception(errorCode)
{
  public string ErrorCode { get; } = errorCode;
}
