using Microsoft.Extensions.Hosting;

namespace Itemba.Msaidizi.Companion.Service.Security;

/// <summary>
/// Opens and verifies the egress receipt replay ledger before the broker worker
/// starts. A malformed, unavailable, or concurrently owned ledger prevents the
/// service from accepting any action rather than being discovered after an
/// external effect.
/// </summary>
internal sealed class EgressReceiptReplayStartupVerifier(
  IEgressReceiptReplayStore replayStore,
  EgressBoundaryDispatchLatch dispatchLatch) : IHostedService
{
  public async Task StartAsync(CancellationToken cancellationToken)
  {
    try
    {
      await replayStore.InitializeAsync(cancellationToken).ConfigureAwait(false);
    }
    catch
    {
      dispatchLatch.Trip();
      throw;
    }
  }

  public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
