using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Journal;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Channel;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Execution;

public interface IActionResultStore
{
  ValueTask StoreAsync(
    ActionRequest request,
    ActionResult result,
    long maximumExternalEgressBytes,
    CancellationToken cancellationToken);

  ValueTask<ActionResult?> TryLoadAsync(
    ActionRequest request,
    JournalTerminalReceipt receipt,
    CancellationToken cancellationToken);

  ValueTask<bool> TryBeginDeliverySessionAsync(
    ActionRequest request,
    JournalTerminalReceipt receipt,
    int maximumDeliverySessions,
    CancellationToken cancellationToken);
}

/// <summary>
/// DPAPI-protected terminal payload cache. The hash-chain journal still stores
/// digests only; this supervisor-owned cache allows an idempotent replay to
/// return the exact prior output and provenance without re-executing a host
/// action or persisting plaintext results. This local session count is defense
/// in depth; the broker's persisted dispatch count is the anti-rollback cap.
/// </summary>
public sealed class FileProtectedActionResultStore : IActionResultStore, IDisposable
{
  private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);
  private readonly string _directory;
  private readonly SemaphoreSlim _gate = new(1, 1);

  public FileProtectedActionResultStore(IOptions<CompanionOptions> options)
  {
    _directory = Path.GetFullPath(Environment.ExpandEnvironmentVariables(
      options.Value.ResultCachePath));
  }

  public async ValueTask StoreAsync(
    ActionRequest request,
    ActionResult result,
    long maximumExternalEgressBytes,
    CancellationToken cancellationToken)
  {
    AssertCredentialEphemeral(request);
    if (maximumExternalEgressBytes <= 0
      || result.ExternalEgressBytes < 0
      || result.BrokerExternalEgressBytes < 0
      || result.BrokerMaxDeliverySessions is < 1 or > 16
      || result.BrokerMaxRequestAttemptsPerSession is < 1 or > 5
      || result.BrokerSerializedResultUpperBoundBytes <= 0
      || !BrokerReservationMatches(result)
      || result.ActionTokenSha256 is null
      || !PayloadDigest.IsSha256Hex(result.ActionTokenSha256)
      || CompanionWireJson.ResultUpperBoundBytes(result)
        > result.BrokerSerializedResultUpperBoundBytes
      || result.UncertainExternalEgressBytes < 0
      || result.ExternalEgressBytes > maximumExternalEgressBytes
      || result.BrokerExternalEgressBytes
        > maximumExternalEgressBytes - result.ExternalEgressBytes
      || result.UncertainExternalEgressBytes
        > maximumExternalEgressBytes
          - result.ExternalEgressBytes
          - result.BrokerExternalEgressBytes)
    {
      throw new ArgumentOutOfRangeException(
        nameof(maximumExternalEgressBytes),
        "The result egress values must fit the verified action ceiling.");
    }

    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      await WriteEnvelopeAsync(
        request.IdempotencyKey,
        new StoredResultEnvelope(
          RequestSha256(request),
          result,
          maximumExternalEgressBytes,
          DeliverySessions: 0),
        cancellationToken).ConfigureAwait(false);
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<ActionResult?> TryLoadAsync(
    ActionRequest request,
    JournalTerminalReceipt receipt,
    CancellationToken cancellationToken)
  {
    AssertCredentialEphemeral(request);
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var envelope = await LoadEnvelopeAsync(request.IdempotencyKey, cancellationToken)
        .ConfigureAwait(false);
      return EnvelopeMatches(envelope, request, receipt) ? envelope!.Result : null;
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<bool> TryBeginDeliverySessionAsync(
    ActionRequest request,
    JournalTerminalReceipt receipt,
    int maximumDeliverySessions,
    CancellationToken cancellationToken)
  {
    AssertCredentialEphemeral(request);
    if (maximumDeliverySessions is < 1 or > 16)
    {
      throw new ArgumentOutOfRangeException(nameof(maximumDeliverySessions));
    }
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var envelope = await LoadEnvelopeAsync(request.IdempotencyKey, cancellationToken)
        .ConfigureAwait(false);
      if (!EnvelopeMatches(envelope, request, receipt)
        || envelope!.DeliverySessions >= Math.Min(
          maximumDeliverySessions,
          receipt.BrokerMaxDeliverySessions))
      {
        return false;
      }
      await WriteEnvelopeAsync(
        request.IdempotencyKey,
        envelope with { DeliverySessions = envelope.DeliverySessions + 1 },
        cancellationToken).ConfigureAwait(false);
      return true;
    }
    finally
    {
      _gate.Release();
    }
  }

  private static bool EnvelopeMatches(
    StoredResultEnvelope? envelope,
    ActionRequest request,
    JournalTerminalReceipt receipt) =>
    envelope is not null
    && PayloadDigest.FixedTimeEqualsHex(envelope.RequestSha256, RequestSha256(request))
    && envelope.MaximumExternalEgressBytes == receipt.MaximumExternalEgressBytes
    && envelope.Result.ActionId == receipt.ActionId
    && envelope.Result.TaskId == receipt.TaskId
    && envelope.Result.StepId == receipt.StepId
    && envelope.Result.Outcome == receipt.Outcome
    && envelope.Result.OutputSha256 == receipt.OutputSha256
    && envelope.Result.MutationCommitted == receipt.MutationCommitted
    && envelope.Result.OutcomeUncertain == receipt.OutcomeUncertain
    && envelope.Result.ErrorCode == receipt.ErrorCode
    && envelope.Result.PreStateSha256 == receipt.PreStateSha256
    && envelope.Result.RecoveryProvenanceSha256 == receipt.RecoveryProvenanceSha256
    && envelope.Result.RecoveryHandleSha256 == receipt.RecoveryHandleSha256
    && envelope.Result.LocalBytesRead == receipt.LocalBytesRead
    && envelope.Result.LocalBytesWritten == receipt.LocalBytesWritten
    && envelope.Result.ExternalEgressBytes == receipt.ExternalEgressBytes
    && envelope.Result.BrokerExternalEgressBytes == receipt.BrokerExternalEgressBytes
    && envelope.Result.BrokerMaxDeliverySessions == receipt.BrokerMaxDeliverySessions
    && envelope.Result.BrokerMaxRequestAttemptsPerSession
      == receipt.BrokerMaxRequestAttemptsPerSession
    && envelope.Result.BrokerSerializedResultUpperBoundBytes
      == receipt.BrokerSerializedResultUpperBoundBytes
    && envelope.Result.UncertainExternalEgressBytes == receipt.UncertainExternalEgressBytes
    && receipt.ActionTokenSha256 is not null
    && envelope.Result.ActionTokenSha256 is not null
    && PayloadDigest.FixedTimeEqualsHex(
      envelope.Result.ActionTokenSha256,
      receipt.ActionTokenSha256)
    && EgressEvidenceMatches(envelope.Result, receipt)
    && receipt.Provenance is not null
    && envelope.Result.Provenance.SequenceEqual(receipt.Provenance);

  private static bool EgressEvidenceMatches(
    ActionResult result,
    JournalTerminalReceipt receipt)
  {
    if (result.EgressEvidence is null
      || receipt.EgressEvidence is null
      || receipt.EgressEvidenceSha256 is null
      || result.ActionTokenSha256 is null)
    {
      return result.EgressEvidence is null
        && receipt.EgressEvidence is null
        && receipt.EgressEvidenceSha256 is null;
    }

    return PayloadDigest.FixedTimeEqualsHex(
        receipt.EgressEvidenceSha256,
        EgressBoundaryCanonical.EvidenceSha256(
          result.ActionTokenSha256,
          result.EgressEvidence))
      && PayloadDigest.FixedTimeEqualsHex(
        receipt.EgressEvidenceSha256,
        EgressBoundaryCanonical.EvidenceSha256(
          receipt.ActionTokenSha256!,
          receipt.EgressEvidence));
  }

  private static bool BrokerReservationMatches(ActionResult result)
  {
    try
    {
      return checked(
        result.BrokerSerializedResultUpperBoundBytes
        * result.BrokerMaxRequestAttemptsPerSession
        * result.BrokerMaxDeliverySessions) == result.BrokerExternalEgressBytes;
    }
    catch (OverflowException)
    {
      return false;
    }
  }

  private async ValueTask<StoredResultEnvelope?> LoadEnvelopeAsync(
    string idempotencyKey,
    CancellationToken cancellationToken)
  {
    var path = GetPath(idempotencyKey);
    if (!File.Exists(path))
    {
      return null;
    }
    var protectedPayload = await File.ReadAllBytesAsync(path, cancellationToken)
      .ConfigureAwait(false);
    byte[] plaintext;
    try
    {
      plaintext = WindowsDataProtection.Unprotect(protectedPayload);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(protectedPayload);
    }
    try
    {
      return JsonSerializer.Deserialize<StoredResultEnvelope>(plaintext, SerializerOptions);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(plaintext);
    }
  }

  private async ValueTask WriteEnvelopeAsync(
    string idempotencyKey,
    StoredResultEnvelope envelope,
    CancellationToken cancellationToken)
  {
    Directory.CreateDirectory(_directory);
    var plaintext = JsonSerializer.SerializeToUtf8Bytes(envelope, SerializerOptions);
    byte[] protectedPayload;
    try
    {
      protectedPayload = WindowsDataProtection.Protect(plaintext);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(plaintext);
    }
    try
    {
      var path = GetPath(idempotencyKey);
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
        File.Move(temporary, path, overwrite: true);
      }
      finally
      {
        if (File.Exists(temporary))
        {
          File.Delete(temporary);
        }
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(protectedPayload);
    }
  }

  private string GetPath(string idempotencyKey) =>
    Path.Combine(_directory, $"{PayloadDigest.Sha256Hex(idempotencyKey)}.bin");

  private static void AssertCredentialEphemeral(ActionRequest request)
  {
    if (HostCredentialEphemeralityPolicy.IsForbiddenFileContentCapability(
        request.CapabilityId))
    {
      throw new InvalidOperationException(HostCredentialEphemeralityPolicy.ErrorCode);
    }
  }

  public void Dispose() => _gate.Dispose();

  private static string RequestSha256(ActionRequest request) =>
    PayloadDigest.Sha256Hex(JsonSerializer.Serialize(new
    {
      request.ActionId,
      request.TaskId,
      request.PlanVersionId,
      request.StepId,
      request.DeviceId,
      request.MandateId,
      request.CapabilityId,
      request.CapabilityVersion,
      request.ArgumentsSha256,
      request.ExpectedPreStateSha256,
      request.InputProvenanceSha256,
      request.IdempotencyKey,
    }, SerializerOptions));

  private sealed record StoredResultEnvelope(
    string RequestSha256,
    ActionResult Result,
    long MaximumExternalEgressBytes,
    int DeliverySessions);
}
