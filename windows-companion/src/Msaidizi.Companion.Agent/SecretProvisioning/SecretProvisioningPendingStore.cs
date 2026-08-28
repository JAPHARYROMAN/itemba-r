using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Agent.Capabilities;
using Itemba.Msaidizi.Companion.Agent.Configuration;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Agent.SecretProvisioning;

internal sealed record SecretProvisioningPendingRequest(
  int Version,
  string RequestId,
  string Operation,
  string BindingId,
  string? VaultReferenceId,
  DateTimeOffset CreatedAt);

internal interface ISecretProvisioningPendingStore
{
  ValueTask<SecretProvisioningPendingRequest?> LoadAsync(
    CancellationToken cancellationToken);

  ValueTask StoreAsync(
    SecretProvisioningPendingRequest request,
    CancellationToken cancellationToken);

  ValueTask ClearAsync(CancellationToken cancellationToken);
}

/// <summary>
/// Persists only non-secret request identity so a lost local result or process
/// restart can reuse the same server idempotency key. The record is current-
/// user DPAPI protected; secret bytes are never accepted by this interface.
/// </summary>
internal sealed class DpapiSecretProvisioningPendingStore :
  ISecretProvisioningPendingStore,
  IDisposable
{
  private const int FormatVersion = 1;
  private const int MaximumRecordBytes = 65_536;
  private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web)
  {
    MaxDepth = 8,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
  };
  private readonly string _path;
  private readonly SemaphoreSlim _gate = new(1, 1);

  public DpapiSecretProvisioningPendingStore(IOptions<SecretProvisioningOptions> options)
  {
    var configuredPath = options.Value.PendingRequestPath;
    if (string.IsNullOrWhiteSpace(configuredPath))
    {
      throw new InvalidOperationException(
        "The local secret pending-request path must be absolute.");
    }
    var expandedPath = Environment.ExpandEnvironmentVariables(configuredPath);
    if (!Path.IsPathFullyQualified(expandedPath)
      || expandedPath.StartsWith(@"\\", StringComparison.Ordinal)
      || expandedPath.AsSpan(Math.Min(3, expandedPath.Length)).Contains(':'))
    {
      throw new InvalidOperationException(
        "The local secret pending-request path must be a local absolute file path.");
    }
    _path = Path.GetFullPath(expandedPath);
  }

  public async ValueTask<SecretProvisioningPendingRequest?> LoadAsync(
    CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      if (!File.Exists(_path))
      {
        return null;
      }

      var info = new FileInfo(_path);
      if (info.Length is <= 0 or > MaximumRecordBytes)
      {
        throw new SecretProvisioningClientException("secret_pending_record_invalid");
      }
      var protectedPayload = await File.ReadAllBytesAsync(_path, cancellationToken)
        .ConfigureAwait(false);
      byte[] plaintext;
      try
      {
        plaintext = CurrentUserDataProtection.Unprotect(protectedPayload);
      }
      catch (Exception exception) when (exception is CryptographicException
        or System.ComponentModel.Win32Exception)
      {
        throw new SecretProvisioningClientException("secret_pending_record_unreadable");
      }
      finally
      {
        CryptographicOperations.ZeroMemory(protectedPayload);
      }

      try
      {
        SecretProvisioningPendingRequest request;
        try
        {
          request = JsonSerializer.Deserialize<SecretProvisioningPendingRequest>(
            plaintext,
            SerializerOptions) ?? throw new JsonException();
        }
        catch (JsonException)
        {
          throw new SecretProvisioningClientException("secret_pending_record_invalid");
        }
        Validate(request);
        return request;
      }
      finally
      {
        CryptographicOperations.ZeroMemory(plaintext);
      }
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask StoreAsync(
    SecretProvisioningPendingRequest request,
    CancellationToken cancellationToken)
  {
    Validate(request);
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var plaintext = JsonSerializer.SerializeToUtf8Bytes(request, SerializerOptions);
      byte[] protectedPayload;
      try
      {
        protectedPayload = CurrentUserDataProtection.Protect(plaintext);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(plaintext);
      }

      var parent = Path.GetDirectoryName(_path)
        ?? throw new InvalidOperationException("The pending-request path has no parent.");
      Directory.CreateDirectory(parent);
      var temporary = Path.Combine(parent, $".{Guid.NewGuid():N}.tmp");
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
        File.Move(temporary, _path, overwrite: true);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(protectedPayload);
        if (File.Exists(temporary)) File.Delete(temporary);
      }
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask ClearAsync(CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      if (File.Exists(_path)) File.Delete(_path);
    }
    finally
    {
      _gate.Release();
    }
  }

  public void Dispose() => _gate.Dispose();

  private static void Validate(SecretProvisioningPendingRequest request)
  {
    if (request.Version != FormatVersion
      || !Guid.TryParseExact(request.RequestId, "D", out _)
      || !SecretProvisioningOperations.IsKnown(request.Operation)
      || string.IsNullOrWhiteSpace(request.BindingId)
      || request.BindingId.Length > 80
      || request.BindingId.Any(character => !(char.IsAsciiLetterOrDigit(character)
        || character is '.' or '-' or '_' or ':'))
      || (request.Operation == SecretProvisioningOperations.Create
        ? request.VaultReferenceId is not null
        : !Guid.TryParseExact(request.VaultReferenceId, "D", out _))
      || request.CreatedAt > DateTimeOffset.UtcNow.AddMinutes(5)
      || request.CreatedAt < DateTimeOffset.UtcNow.AddYears(-1))
    {
      throw new SecretProvisioningClientException("secret_pending_record_invalid");
    }
  }
}
