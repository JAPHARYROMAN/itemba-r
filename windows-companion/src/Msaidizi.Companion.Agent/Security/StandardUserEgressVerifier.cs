using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Agent.Security;

public interface IStandardUserEgressVerifier
{
  string? ValidateAuthorization(
    ActionExecutionContext context,
    string capabilityId,
    string capabilityVersion);
}

internal sealed class StandardUserEgressVerifier(
  EgressBoundaryContractVerifier contracts) : IStandardUserEgressVerifier
{
  public string? ValidateAuthorization(
    ActionExecutionContext context,
    string capabilityId,
    string capabilityVersion)
  {
    if (!StandardUserCapabilityCatalog.RequiresEgressBoundary(capabilityId))
    {
      return context.EgressAuthorization is null ? null : "session_egress_authorization_unexpected";
    }

    if (context.EgressAuthorization is null)
    {
      return "session_egress_authorization_missing";
    }

    var binding = Binding(context, capabilityId, capabilityVersion);
    if (binding is null)
    {
      return "session_egress_action_binding_invalid";
    }

    var result = contracts.VerifyAuthorization(
      context.EgressAuthorization,
      binding,
      StandardUserCapabilityCatalog.RequiredBoundaryFeatures(capabilityId));
    return result.IsValid ? null : result.ErrorCode ?? "session_egress_authorization_invalid";
  }

  private static EgressActionBinding? Binding(
    ActionExecutionContext context,
    string capabilityId,
    string capabilityVersion)
  {
    if (!PayloadDigest.IsSha256Hex(context.ActionTokenSha256)
      || !PayloadDigest.IsSha256Hex(context.ArgumentsSha256)
      || context.DispatchCount is < 1 or > 16
      || context.Budgets.MaxExternalEgressBytes < 0
      || !PayloadDigest.IsSha256Hex(context.EgressDestinationPolicySha256)
      || !PayloadDigest.IsSha256Hex(context.EgressExecutionIdentitySha256))
    {
      return null;
    }

    return new EgressActionBinding(
      context.ActionTokenSha256!,
      context.ActionId,
      context.TaskId,
      context.PlanVersionId,
      context.StepId,
      context.DeviceId,
      context.MandateId,
      capabilityId,
      capabilityVersion,
      context.DispatchCount,
      context.Budgets.MaxExternalEgressBytes,
      context.EgressDestinationPolicySha256!,
      context.EgressExecutionIdentitySha256!,
      context.ArgumentsSha256!,
      context.ExpectedPreStateSha256,
      PayloadDigest.Sha256Hex(context.IdempotencyKey));
  }
}

/// <summary>
/// Production default while no externally validated boundary exists. Ordinary
/// capabilities remain usable; every metered capability fails closed.
/// </summary>
internal sealed class RejectingStandardUserEgressVerifier : IStandardUserEgressVerifier
{
  public string? ValidateAuthorization(
    ActionExecutionContext context,
    string capabilityId,
    string capabilityVersion) =>
    StandardUserCapabilityCatalog.RequiresEgressBoundary(capabilityId)
      ? "session_egress_boundary_unavailable"
      : context.EgressAuthorization is null
        ? null
        : "session_egress_authorization_unexpected";

}
