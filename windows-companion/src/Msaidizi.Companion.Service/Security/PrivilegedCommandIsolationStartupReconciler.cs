using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Microsoft.Extensions.Hosting;

namespace Itemba.Msaidizi.Companion.Service.Security;

/// <summary>
/// Startup fence for privileged-command isolation state. The host starts this
/// service before the broker worker, so no new action can create or resume a
/// child until every durable reservation/bind left by an earlier process has a
/// signed settlement committed to the local replay ledger.
/// </summary>
internal sealed class PrivilegedCommandIsolationStartupReconciler(
  IPrivilegedCommandIsolationReplayStore replayStore,
  IPrivilegedCommandTrustedRootIsolationRecovery trustedRootRecovery) : IHostedService
{
  public async Task StartAsync(CancellationToken cancellationToken)
  {
    var pending = await replayStore.ReadPendingAsync(cancellationToken)
      .ConfigureAwait(false);
    RefuseIntegrityViolations(pending);

    // Bound process trees carry the higher-risk mutation ambiguity and are
    // settled first. Recovery is settlement-only: this component never calls
    // TryReserveAsync, creates a process, or resumes a thread.
    foreach (var bind in pending.Binds)
    {
      var expected = PendingBindExpectation.Freeze(bind);
      var receipt = await trustedRootRecovery.TryRecoverPendingBindAsync(
        bind,
        cancellationToken).ConfigureAwait(false);
      if (receipt is null || !Matches(expected, receipt))
      {
        throw Unreconciled("bind", expected.ActionId);
      }

      var commit = await replayStore.CommitTerminalReceiptAsync(
        receipt,
        cancellationToken).ConfigureAwait(false);
      if (!commit.AllowsProgressFor(receipt.ReceiptSha256))
      {
        throw Unreconciled("bind", expected.ActionId);
      }
      if (!receipt.IsIsolationIntact)
      {
        // The authenticated receipt is committed first so every subsequent
        // restart retains the violation fence. It can never authorize startup.
        throw IntegrityViolation(
          expected.ActionId,
          receipt.ReceiptSha256,
          receipt.SignedReceipt.Receipt.Outcome);
      }
    }

    foreach (var reservation in pending.Reservations)
    {
      var expected = PendingReservationExpectation.Freeze(reservation);
      var release = await trustedRootRecovery.TryRecoverPendingReservationAsync(
        reservation,
        cancellationToken).ConfigureAwait(false);
      if (release is null || !Matches(expected, release))
      {
        throw Unreconciled("reservation", expected.ActionId);
      }

      var commit = await replayStore.CommitPreBindReleaseAsync(
        release,
        cancellationToken).ConfigureAwait(false);
      if (!commit.AllowsProgressFor(release.ReleaseSha256))
      {
        throw Unreconciled("reservation", expected.ActionId);
      }
    }

    // Do not infer success from individual commit responses. In particular, an
    // unrelated but already-committed signed receipt would otherwise produce
    // AlreadyCommitted for itself while leaving the snapshot entry unresolved.
    var remaining = await replayStore.ReadPendingAsync(cancellationToken)
      .ConfigureAwait(false);
    RefuseIntegrityViolations(remaining);
    if (remaining.Binds.Count != 0 || remaining.Reservations.Count != 0)
    {
      throw new InvalidOperationException(
        "Privileged-command isolation recovery completed with unresolved replay state.");
    }
  }

  public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

  private static InvalidOperationException Unreconciled(string phase, string actionId) =>
    new($"Privileged-command isolation {phase} for action {actionId} remains pending; "
      + "trusted supervisor recovery is unavailable or invalid.");

  private static void RefuseIntegrityViolations(
    PrivilegedCommandIsolationPendingSnapshot snapshot)
  {
    if (snapshot.IntegrityViolations.Count == 0)
    {
      return;
    }

    var violation = snapshot.IntegrityViolations[0];
    throw IntegrityViolation(
      violation.ActionId,
      violation.ReceiptSha256,
      violation.Outcome);
  }

  private static InvalidOperationException IntegrityViolation(
    string actionId,
    string receiptSha256,
    string outcome) => new(
      $"Privileged-command isolation enforcement was not continuous for action "
      + $"{actionId}; signed receipt {receiptSha256} reported {outcome}. "
      + "Trusted out-of-band recovery is required before dispatch can resume.");

  private static bool Matches(
    PendingReservationExpectation expected,
    VerifiedPrivilegedCommandIsolationPreBindRelease release)
  {
    var recovered = release.Reservation;
    return Exact(expected.RequestId, recovered.Request.RequestId)
      && Exact(expected.LeaseId, recovered.SignedLease.Lease.LeaseId)
      && DigestEquals(
        expected.ReservationRequestSha256,
        recovered.ReservationRequestSha256)
      && DigestEquals(
        expected.RequestNonceSha256,
        recovered.RequestNonceSha256)
      && DigestEquals(
        expected.LeaseSha256,
        recovered.LeaseSha256);
  }

  private static bool Matches(
    PendingBindExpectation expected,
    VerifiedPrivilegedCommandIsolationTerminalReceipt receipt)
  {
    var recovered = receipt.BindAcknowledgement;
    return Exact(expected.RequestId, recovered.Reservation.Request.RequestId)
      && Exact(expected.LeaseId, recovered.Reservation.SignedLease.Lease.LeaseId)
      && Exact(expected.BindingRequestId, recovered.Binding.BindingRequestId)
      && Exact(
        expected.AcknowledgementId,
        recovered.SignedAcknowledgement.Acknowledgement.AcknowledgementId)
      && DigestEquals(
        expected.ReservationRequestSha256,
        recovered.Reservation.ReservationRequestSha256)
      && DigestEquals(
        expected.RequestNonceSha256,
        recovered.Reservation.RequestNonceSha256)
      && DigestEquals(
        expected.LeaseSha256,
        recovered.Reservation.LeaseSha256)
      && DigestEquals(
        expected.SuspendedProcessBindingSha256,
        recovered.SuspendedProcessBindingSha256)
      && DigestEquals(
        expected.BindAcknowledgementSha256,
        recovered.AcknowledgementSha256);
  }

  private static bool Exact(string left, string right) =>
    string.Equals(left, right, StringComparison.Ordinal);

  private static bool DigestEquals(string left, string right) =>
    PayloadDigest.IsSha256Hex(left)
    && PayloadDigest.IsSha256Hex(right)
    && PayloadDigest.FixedTimeEqualsHex(left, right);

  private sealed record PendingReservationExpectation(
    string ActionId,
    string RequestId,
    string LeaseId,
    string ReservationRequestSha256,
    string RequestNonceSha256,
    string LeaseSha256)
  {
    public static PendingReservationExpectation Freeze(
      PrivilegedCommandIsolationPendingReservation pending) => new(
        pending.Request.Action.ActionId,
        pending.Request.RequestId,
        pending.SignedLease.Lease.LeaseId,
        PrivilegedCommandIsolationCanonical.ReservationRequestSha256(pending.Request),
        PrivilegedCommandIsolationCanonical.RequestNonceSha256(pending.Request),
        PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(
          pending.SignedLease.Lease));
  }

  private sealed record PendingBindExpectation(
    string ActionId,
    string RequestId,
    string LeaseId,
    string BindingRequestId,
    string AcknowledgementId,
    string ReservationRequestSha256,
    string RequestNonceSha256,
    string LeaseSha256,
    string SuspendedProcessBindingSha256,
    string BindAcknowledgementSha256)
  {
    public static PendingBindExpectation Freeze(
      PrivilegedCommandIsolationPendingBind pending) => new(
        pending.Request.Action.ActionId,
        pending.Request.RequestId,
        pending.SignedLease.Lease.LeaseId,
        pending.Binding.BindingRequestId,
        pending.SignedAcknowledgement.Acknowledgement.AcknowledgementId,
        PrivilegedCommandIsolationCanonical.ReservationRequestSha256(pending.Request),
        PrivilegedCommandIsolationCanonical.RequestNonceSha256(pending.Request),
        PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(
          pending.SignedLease.Lease),
        PrivilegedCommandIsolationCanonical.SuspendedProcessBindingSha256(
          pending.Binding),
        PrivilegedCommandIsolationCanonical.BindAcknowledgementSha256(
          pending.SignedAcknowledgement.Acknowledgement));
  }
}
