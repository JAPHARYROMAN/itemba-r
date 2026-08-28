using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.EgressSupervisor.Core;

public sealed record BrowserBoundaryRegistrationRequest(
  EgressExecutionAuthorization Authorization,
  BrowserActionPolicyV1 ActionPolicy,
  EgressBrowserRegistrationV1 Registration);

public sealed record BrowserBoundaryCompletionRequest(
  EgressExecutionAuthorization Authorization,
  BrowserActionPolicyV1 ActionPolicy,
  EgressBrowserRegistrationV1 Registration,
  BrowserBoundaryRegistrationEvidenceV1 RegistrationEvidence);

/// <summary>
/// Independently trusted browser evidence source. Implementations must observe
/// the exact broker and browser event stream themselves; caller or tray claims
/// are expectations only. The production default is permanently rejecting.
/// </summary>
public interface IBrowserBoundaryEvidenceProvider
{
  bool IsAvailable { get; }

  ValueTask<BrowserBoundaryRegistrationEvidenceV1?> TryRegisterAsync(
    BrowserBoundaryRegistrationRequest request,
    CancellationToken cancellationToken);

  ValueTask<BrowserBoundaryCompletionEvidenceV1?> TryObserveCompletionAsync(
    BrowserBoundaryCompletionRequest request,
    CancellationToken cancellationToken);
}

/// <summary>
/// Fail-closed production default. Source contracts and deterministic tests do
/// not constitute a deployed, signed, measured WebView2 broker.
/// </summary>
public sealed class RejectingBrowserBoundaryEvidenceProvider :
  IBrowserBoundaryEvidenceProvider
{
  public bool IsAvailable => false;

  public ValueTask<BrowserBoundaryRegistrationEvidenceV1?> TryRegisterAsync(
    BrowserBoundaryRegistrationRequest request,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    return ValueTask.FromResult<BrowserBoundaryRegistrationEvidenceV1?>(null);
  }

  public ValueTask<BrowserBoundaryCompletionEvidenceV1?> TryObserveCompletionAsync(
    BrowserBoundaryCompletionRequest request,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    return ValueTask.FromResult<BrowserBoundaryCompletionEvidenceV1?>(null);
  }
}
