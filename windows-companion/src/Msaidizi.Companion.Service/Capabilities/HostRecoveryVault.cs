using System.Security.Cryptography;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

public sealed record HostRecoveryReceipt(
  string OpaqueHandle,
  string RecordSha256,
  string RecordPath);

public interface IHostRecoveryVault
{
  ValueTask<HostRecoveryReceipt> PrepareAsync(
    ActionExecutionContext context,
    string operation,
    string preStateSha256,
    object recoveryRecord,
    bool irreversible,
    CancellationToken cancellationToken);
}

public sealed record TrustedHostRecoveryRecord(
  string ActionId,
  string TaskId,
  string PlanVersionId,
  string StepId,
  string DeviceId,
  string MandateId,
  string Operation,
  string PreStateSha256,
  bool Irreversible,
  string RecordSha256,
  JsonElement RecoveryRecord);

/// <summary>
/// Supervisor-only reader used by the recovery executor. It is deliberately
/// not an IHostCapabilityAdapter: model plans receive only recovery digests,
/// never vault paths, opaque handles, or the protected recovery document.
/// </summary>
public interface ITrustedHostRecoveryRecordReader
{
  ValueTask<TrustedHostRecoveryRecord> ReadAsync(
    string actionId,
    string expectedRecordSha256,
    CancellationToken cancellationToken);
}

/// <summary>
/// Writes a DPAPI service-identity-protected pre-action recovery record before the
/// first host effect. The model-addressable path policy always excludes this
/// directory. Only hashes flow into the action journal and broker result.
/// </summary>
public sealed class FileHostRecoveryVault : IHostRecoveryVault, ITrustedHostRecoveryRecordReader
{
  private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);
  private const int MaximumProtectedRecordBytes = 4_194_304;
  private readonly string _directory;

  public FileHostRecoveryVault(IOptions<HostCapabilityOptions> options)
  {
    _directory = Path.GetFullPath(Environment.ExpandEnvironmentVariables(
      options.Value.RecoveryVaultPath));
  }

  public async ValueTask<HostRecoveryReceipt> PrepareAsync(
    ActionExecutionContext context,
    string operation,
    string preStateSha256,
    object recoveryRecord,
    bool irreversible,
    CancellationToken cancellationToken)
  {
    if (!PayloadDigest.IsSha256Hex(preStateSha256))
    {
      throw new ArgumentException("Pre-state must be a SHA-256 digest.", nameof(preStateSha256));
    }

    Directory.CreateDirectory(_directory);
    var opaqueHandle = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    var envelope = new
    {
      version = 1,
      context.ActionId,
      context.TaskId,
      context.PlanVersionId,
      context.StepId,
      context.DeviceId,
      context.MandateId,
      operation,
      preStateSha256,
      irreversible,
      opaqueHandle,
      preparedAt = DateTimeOffset.UtcNow,
      recoveryRecord,
    };
    var plaintext = JsonSerializer.SerializeToUtf8Bytes(envelope, SerializerOptions);
    if (plaintext.Length > MaximumProtectedRecordBytes)
    {
      CryptographicOperations.ZeroMemory(plaintext);
      throw new HostRecoveryException("recovery_record_too_large");
    }
    var recordSha256 = Convert.ToHexString(SHA256.HashData(plaintext)).ToLowerInvariant();
    byte[] protectedPayload;
    try
    {
      protectedPayload = WindowsDataProtection.Protect(plaintext);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(plaintext);
    }
    if (protectedPayload.Length is <= 0 or > MaximumProtectedRecordBytes)
    {
      CryptographicOperations.ZeroMemory(protectedPayload);
      throw new HostRecoveryException("recovery_record_too_large");
    }

    var path = Path.Combine(_directory, $"{PayloadDigest.Sha256Hex(context.ActionId)}.bin");
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

      File.Move(temporary, path, overwrite: false);
      return new HostRecoveryReceipt(opaqueHandle, recordSha256, path);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(protectedPayload);
      if (File.Exists(temporary))
      {
        File.Delete(temporary);
      }
    }
  }

  public async ValueTask<TrustedHostRecoveryRecord> ReadAsync(
    string actionId,
    string expectedRecordSha256,
    CancellationToken cancellationToken)
  {
    if (string.IsNullOrWhiteSpace(actionId)
      || actionId.Length > 512
      || !PayloadDigest.IsSha256Hex(expectedRecordSha256))
    {
      throw new HostRecoveryException("recovery_request_invalid");
    }

    var path = Path.Combine(_directory, $"{PayloadDigest.Sha256Hex(actionId)}.bin");
    byte[] protectedPayload;
    try
    {
      var info = new FileInfo(path);
      if (!info.Exists || info.Length is <= 0 or > MaximumProtectedRecordBytes)
      {
        throw new HostRecoveryException("recovery_record_not_found");
      }
      protectedPayload = await File.ReadAllBytesAsync(path, cancellationToken)
        .ConfigureAwait(false);
    }
    catch (HostRecoveryException)
    {
      throw;
    }
    catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
    {
      throw new HostRecoveryException("recovery_record_not_found");
    }

    byte[] plaintext;
    try
    {
      plaintext = WindowsDataProtection.Unprotect(protectedPayload);
    }
    catch (CryptographicException)
    {
      throw new HostRecoveryException("recovery_record_unreadable");
    }
    finally
    {
      CryptographicOperations.ZeroMemory(protectedPayload);
    }

    try
    {
      var actualDigest = Convert.ToHexString(SHA256.HashData(plaintext)).ToLowerInvariant();
      if (!PayloadDigest.FixedTimeEqualsHex(actualDigest, expectedRecordSha256))
      {
        throw new HostRecoveryException("recovery_record_digest_mismatch");
      }

      using var document = JsonDocument.Parse(plaintext, new JsonDocumentOptions
      {
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = 16,
      });
      var root = document.RootElement;
      if (root.ValueKind != JsonValueKind.Object
        || root.GetProperty("version").GetInt32() != 1
        || !string.Equals(root.GetProperty("actionId").GetString(), actionId, StringComparison.Ordinal)
        || !PayloadDigest.IsSha256Hex(root.GetProperty("preStateSha256").GetString() ?? string.Empty)
        || root.GetProperty("recoveryRecord").ValueKind != JsonValueKind.Object)
      {
        throw new HostRecoveryException("recovery_record_format_invalid");
      }

      return new TrustedHostRecoveryRecord(
        root.GetProperty("actionId").GetString()!,
        RequiredString(root, "taskId"),
        RequiredString(root, "planVersionId"),
        RequiredString(root, "stepId"),
        RequiredString(root, "deviceId"),
        RequiredString(root, "mandateId"),
        RequiredString(root, "operation"),
        root.GetProperty("preStateSha256").GetString()!,
        root.GetProperty("irreversible").GetBoolean(),
        actualDigest,
        root.GetProperty("recoveryRecord").Clone());
    }
    catch (HostRecoveryException)
    {
      throw;
    }
    catch (Exception exception) when (exception is JsonException
      or KeyNotFoundException
      or InvalidOperationException
      or FormatException)
    {
      throw new HostRecoveryException("recovery_record_format_invalid");
    }
    finally
    {
      CryptographicOperations.ZeroMemory(plaintext);
    }
  }

  private static string RequiredString(JsonElement root, string property)
  {
    var value = root.GetProperty(property).GetString();
    return !string.IsNullOrWhiteSpace(value) && value.Length <= 512
      ? value
      : throw new HostRecoveryException("recovery_record_format_invalid");
  }
}

public sealed class HostRecoveryException(string errorCode) : Exception(errorCode)
{
  public string ErrorCode { get; } = errorCode;
}
