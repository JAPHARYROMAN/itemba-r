using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Journal;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

/// <summary>
/// Makes recovery preparation part of the append-only action history before
/// an adapter can enter its host-effect boundary. Only digests cross from the
/// protected recovery vault into the journal.
/// </summary>
public sealed class JournaledHostRecoveryVault(
  FileHostRecoveryVault inner,
  IActionJournal journal) : IHostRecoveryVault
{
  public async ValueTask<HostRecoveryReceipt> PrepareAsync(
    ActionExecutionContext context,
    string operation,
    string preStateSha256,
    object recoveryRecord,
    bool irreversible,
    CancellationToken cancellationToken)
  {
    var receipt = await inner.PrepareAsync(
      context,
      operation,
      preStateSha256,
      recoveryRecord,
      irreversible,
      cancellationToken).ConfigureAwait(false);

    await journal.AppendRecoveryPreparedAsync(
      new JournalRecoveryPreparedCheckpoint(
        context.ActionId,
        context.IdempotencyKey,
        context.TaskId,
        context.PlanVersionId,
        context.StepId,
        context.DeviceId,
        context.MandateId,
        preStateSha256,
        receipt.RecordSha256,
        PayloadDigest.Sha256Hex(receipt.OpaqueHandle)),
      CancellationToken.None).ConfigureAwait(false);

    return receipt;
  }
}
