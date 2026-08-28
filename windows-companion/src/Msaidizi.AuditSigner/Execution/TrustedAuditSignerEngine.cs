using Itemba.Msaidizi.AuditSigner.Channel;
using Itemba.Msaidizi.AuditSigner.Configuration;
using Itemba.Msaidizi.AuditSigner.Contracts;
using Itemba.Msaidizi.AuditSigner.Journal;
using Itemba.Msaidizi.AuditSigner.Security;

namespace Itemba.Msaidizi.AuditSigner.Execution;

public sealed class TrustedAuditSignerEngine(
  AuditSignerOptions options,
  IAuditSignerJournal journal,
  IAuditSignerBrokerClient broker,
  IAuditCheckpointSigner signer)
{
  private readonly AuditSignerOptions _options = options.Expand();

  public async Task<bool> RunOnceAsync(CancellationToken cancellationToken)
  {
    if (File.Exists(_options.KillSwitchPath)) return false;

    var reconciledPending = false;
    var pending = journal.State.Pending;
    if (pending is not null)
    {
      await SubmitPendingAsync(pending.Checkpoint, cancellationToken).ConfigureAwait(false);
      reconciledPending = true;
      if (File.Exists(_options.KillSwitchPath)) return true;
    }

    var head = journal.State.AcceptedHead;
    var segment = await broker.FetchSegmentAsync(
      head,
      _options.MaxSegmentEvents,
      cancellationToken).ConfigureAwait(false);
    var events = AuditSignerProtocol.ValidateSegment(segment, head, _options);
    if (events.Count == 0) return reconciledPending;

    var checkpoint = AuditSignerProtocol.CreateCheckpoint(
      segment,
      head,
      _options,
      signer,
      DateTimeOffset.UtcNow);
    await journal.AppendSignedAsync(checkpoint, cancellationToken).ConfigureAwait(false);
    if (File.Exists(_options.KillSwitchPath)) return true;
    await SubmitPendingAsync(checkpoint, cancellationToken).ConfigureAwait(false);
    return true;
  }

  private async Task SubmitPendingAsync(
    SignedAuditCheckpoint checkpoint,
    CancellationToken cancellationToken)
  {
    var receipt = await broker.SubmitCheckpointAsync(checkpoint, cancellationToken)
      .ConfigureAwait(false);
    if (!receipt.Accepted ||
        !string.Equals(receipt.CheckpointId, checkpoint.Manifest.CheckpointId,
          StringComparison.Ordinal))
      throw new InvalidDataException("Broker returned a conflicting audit checkpoint receipt.");
    await journal.AppendAcceptedAsync(checkpoint.ManifestSha256, cancellationToken)
      .ConfigureAwait(false);
  }
}
