using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Service.Execution;

internal static class CapabilityExecutionResultPolicy
{
  internal static readonly TimeSpan MaximumFutureObservationSkew = TimeSpan.FromMinutes(5);

  internal static bool IsValid(
    CapabilityDescriptor? descriptor,
    CapabilityExecutionResult? result,
    DateTimeOffset utcNow)
  {
    if (descriptor?.ProvenanceOutputs is null
      || result?.OutputJson is null
      || result.Provenance is null
      || result.Provenance.Count > CompanionWireContract.MaximumProvenanceOutputs
      || (!descriptor.IsMutation && result.MutationCommitted))
    {
      return false;
    }

    var hasRecoveryHandle = result.OpaqueRecoveryHandle is not null;
    var hasRecoveryDigest = result.RecoveryProvenanceSha256 is not null;
    if (hasRecoveryHandle != hasRecoveryDigest)
    {
      return false;
    }

    if (hasRecoveryHandle
      && (!descriptor.IsMutation
        || !result.MutationCommitted
        || !IsCanonicalSha256(result.OpaqueRecoveryHandle)
        || !IsCanonicalSha256(result.RecoveryProvenanceSha256)))
    {
      return false;
    }

    var latestObservation = utcNow.ToUniversalTime() + MaximumFutureObservationSkew;
    foreach (var provenance in result.Provenance)
    {
      if (provenance is null
        || !CompanionWireContract.IsValidProvenanceSourceType(provenance.SourceType)
        || !descriptor.ProvenanceOutputs.Contains(
          provenance.SourceType,
          StringComparer.Ordinal)
        || !IsCanonicalSha256(provenance.SourceIdentifierHash)
        || !IsCanonicalSha256(provenance.ContentSha256)
        || !Enum.IsDefined(provenance.Trust)
        || provenance.ObservedAt.Offset != TimeSpan.Zero
        || provenance.ObservedAt < DateTimeOffset.UnixEpoch
        || provenance.ObservedAt > latestObservation)
      {
        return false;
      }

      if (provenance.SourceType.EndsWith("-recovery-record", StringComparison.Ordinal)
        && (!hasRecoveryHandle
          || !PayloadDigest.FixedTimeEqualsHex(
            provenance.SourceIdentifierHash,
            PayloadDigest.Sha256Hex(result.OpaqueRecoveryHandle!))
          || !PayloadDigest.FixedTimeEqualsHex(
            provenance.ContentSha256,
            result.RecoveryProvenanceSha256!)))
      {
        return false;
      }
    }

    return true;
  }

  private static bool IsCanonicalSha256(string? value) =>
    value is { Length: 64 }
    && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');
}
