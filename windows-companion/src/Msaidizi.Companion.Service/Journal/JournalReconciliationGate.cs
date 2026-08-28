using Itemba.Msaidizi.Companion.Contracts.Channel;
using Itemba.Msaidizi.Companion.Contracts.Journal;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Journal;

public interface IJournalReconciliationGate
{
  bool IsExactHeadReconciled(JournalHead head);

  ValueTask ReconcileExactHeadAsync(CancellationToken cancellationToken);
}

/// <summary>
/// Fail-closed gate between the local digest chain and broker command
/// execution. It never edits either ledger and does not advance its cursor
/// until the broker returns an acknowledgement bound to the exact range.
/// </summary>
public sealed class JournalReconciliationGate(
  IOptions<CompanionOptions> options,
  IActionJournal journal,
  IOutboundCompanionChannel channel) : IJournalReconciliationGate, IDisposable
{
  private const string GenesisHash =
    "0000000000000000000000000000000000000000000000000000000000000000";
  private readonly SemaphoreSlim _gate = new(1, 1);
  private JournalHead _acknowledgedHead = new(0, GenesisHash);
  private int _isExact;

  public bool IsExactHeadReconciled(JournalHead head) =>
    Volatile.Read(ref _isExact) == 1
    && head.Sequence == _acknowledgedHead.Sequence
    && string.Equals(
      head.EntryHash,
      _acknowledgedHead.EntryHash,
      StringComparison.Ordinal);

  public async ValueTask ReconcileExactHeadAsync(CancellationToken cancellationToken)
  {
    Volatile.Write(ref _isExact, 0);
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var localHead = await journal.GetHeadAsync(cancellationToken).ConfigureAwait(false);
      var centralHead = await channel.GetJournalHeadAsync(
        new JournalCentralHeadRequest(options.Value.DeviceId),
        cancellationToken).ConfigureAwait(false);
      if (centralHead.Sequence > localHead.Sequence)
      {
        throw new InvalidDataException("The central journal head is ahead of the local journal.");
      }
      var centralCursor = await journal.ReadRangeAsync(
        centralHead.Sequence,
        1,
        cancellationToken).ConfigureAwait(false);
      if (centralCursor.StartingPredecessor.Sequence != centralHead.Sequence
        || !string.Equals(
          centralCursor.StartingPredecessor.EntryHash,
          centralHead.EntryHash,
          StringComparison.Ordinal))
      {
        throw new InvalidDataException(
          "The central journal head does not exist in the verified local chain.");
      }
      _acknowledgedHead = new JournalHead(centralHead.Sequence, centralHead.EntryHash);

      while (true)
      {
        var previousAcknowledgedSequence = _acknowledgedHead.Sequence;
        var range = await journal.ReadRangeAsync(
          _acknowledgedHead.Sequence,
          JournalReconciliationContract.MaximumEntriesPerRange,
          cancellationToken).ConfigureAwait(false);
        if (range.StartingPredecessor.Sequence != _acknowledgedHead.Sequence
          || !string.Equals(
            range.StartingPredecessor.EntryHash,
            _acknowledgedHead.EntryHash,
            StringComparison.Ordinal))
        {
          throw new InvalidDataException(
            "The local journal no longer contains the acknowledged reconciliation predecessor.");
        }

        var request = new JournalReconciliationRequest(
          options.Value.DeviceId,
          range.StartingPredecessor.Sequence,
          range.StartingPredecessor.EntryHash,
          range.Entries,
          range.FinalHead.Sequence,
          range.FinalHead.EntryHash,
          range.LocalHead.Sequence,
          range.LocalHead.EntryHash);
        var acknowledgement = await channel.ReconcileJournalAsync(
          request,
          cancellationToken).ConfigureAwait(false);
        var shouldBeExact = request.FinalSequence == request.LocalHeadSequence
          && string.Equals(
            request.FinalHash,
            request.LocalHeadHash,
            StringComparison.Ordinal);
        if (!acknowledgement.Accepted
          || !string.Equals(
            acknowledgement.DeviceId,
            request.DeviceId,
            StringComparison.Ordinal)
          || acknowledgement.StartingPreviousSequence != request.StartingPreviousSequence
          || !string.Equals(
            acknowledgement.StartingPreviousHash,
            request.StartingPreviousHash,
            StringComparison.Ordinal)
          || acknowledgement.AcceptedThroughSequence != request.FinalSequence
          || !string.Equals(
            acknowledgement.AcceptedThroughHash,
            request.FinalHash,
            StringComparison.Ordinal)
          || acknowledgement.LocalHeadSequence != request.LocalHeadSequence
          || !string.Equals(
            acknowledgement.LocalHeadHash,
            request.LocalHeadHash,
            StringComparison.Ordinal)
          || acknowledgement.ExactHead != shouldBeExact)
        {
          throw new InvalidDataException(
            "The broker reconciliation acknowledgement does not bind the exact range.");
        }
        _acknowledgedHead = new JournalHead(
          acknowledgement.AcceptedThroughSequence,
          acknowledgement.AcceptedThroughHash);

        if (!acknowledgement.ExactHead)
        {
          if (_acknowledgedHead.Sequence <= previousAcknowledgedSequence)
          {
            throw new InvalidDataException(
              "Journal reconciliation did not make monotonic progress.");
          }
          continue;
        }

        var current = await journal.GetHeadAsync(cancellationToken).ConfigureAwait(false);
        if (current.Sequence == _acknowledgedHead.Sequence
          && string.Equals(
            current.EntryHash,
            _acknowledgedHead.EntryHash,
              StringComparison.Ordinal))
        {
          Volatile.Write(ref _isExact, 1);
          return;
        }
      }
    }
    finally
    {
      _gate.Release();
    }
  }

  public void Dispose() => _gate.Dispose();
}
