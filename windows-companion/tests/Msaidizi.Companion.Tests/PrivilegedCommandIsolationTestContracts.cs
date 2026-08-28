using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Tests;

internal static class PrivilegedCommandIsolationTestContracts
{
  public static PrivilegedCommandIsolationActionAuthorizationV2 Authorization(
    string? argumentsSha256 = null) => new(
      PrivilegedCommandIsolationCapability.Id,
      PrivilegedCommandIsolationCapability.Version,
      argumentsSha256 ?? new string('a', 64),
      ExpectedPreStateSha256: null,
      InputProvenanceSha256: null,
      IdempotencyKeySha256: PayloadDigest.Sha256Hex("test-isolation-action"),
      LeaseId: "test-isolation-lease",
      FencingToken: "1",
      LeaseExpiresAtUnixSeconds: 2_000_000_000,
      DispatchCount: 1,
      ActionExecutionModes.Execute,
      new ActionBudget(
        120,
        20,
        50,
        10,
        1_048_576,
        0,
        1m,
        3,
        3,
        1_048_576));
}
