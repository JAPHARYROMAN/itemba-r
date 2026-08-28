using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.State;

public enum IsolationLifecyclePhase
{
  Reserved = 1,
  Released = 2,
  Bound = 3,
  Settled = 4,
}

public sealed record IsolationLifecycleState(
  long Sequence,
  IsolationLifecyclePhase Phase,
  PrivilegedCommandIsolationReservationRequestV1 Request,
  SignedPrivilegedCommandIsolationReservationLease SignedLease,
  SignedPrivilegedCommandIsolationPreBindRelease? SignedRelease,
  PrivilegedCommandSuspendedProcessBindingV1? Binding,
  SignedPrivilegedCommandIsolationBindAcknowledgement? SignedAcknowledgement,
  string? EnforcementLeaseId,
  string? BindEnforcementEvidenceSha256,
  SignedPrivilegedCommandIsolationTerminalReceipt? SignedReceipt);

public interface IIsolationLifecycleStore : IAsyncDisposable
{
  long NextSequence { get; }

  IReadOnlyCollection<IsolationLifecycleState> Snapshot { get; }

  IsolationLifecycleState? FindByRequestId(string requestId);

  IsolationLifecycleState? FindByActionId(string actionId);

  ValueTask AppendAsync(
    IsolationLifecycleState state,
    CancellationToken cancellationToken);
}
