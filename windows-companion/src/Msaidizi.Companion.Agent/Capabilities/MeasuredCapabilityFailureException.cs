using Itemba.Msaidizi.Companion.Contracts.Capabilities;

namespace Itemba.Msaidizi.Companion.Agent.Capabilities;

/// <summary>
/// Carries non-content resource measurements for a capability that failed
/// after consuming signed budgets. The safe code and counters may cross the
/// session bridge; captured content and the originating exception may not.
/// </summary>
internal sealed class MeasuredCapabilityFailureException : Exception
{
  public string ErrorCode { get; }
  public CapabilityExecutionResult Measurement { get; }

  public MeasuredCapabilityFailureException(
    string errorCode,
    long localBytesRead,
    long localBytesWritten,
    long externalEgressBytes = 0) : base(errorCode)
  {
    ErrorCode = errorCode;
    Measurement = new CapabilityExecutionResult(
      "{}",
      MutationCommitted: false,
      OutcomeUncertain: true,
      Provenance: [],
      LocalBytesRead: localBytesRead,
      LocalBytesWritten: localBytesWritten,
      ExternalEgressBytes: externalEgressBytes);
  }
}
