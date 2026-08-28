using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Tests;

internal sealed class RejectingFenceTokenVerifier : IFenceTokenVerifier
{
  public ValueTask<FenceTokenVerificationResult> VerifyAsync(
    string compactToken,
    CancellationToken cancellationToken) =>
    ValueTask.FromResult(FenceTokenVerificationResult.Invalid("test_fence_token_rejected"));
}
