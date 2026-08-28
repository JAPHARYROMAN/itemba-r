using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Agent.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class ClipboardTextWriteCapabilityTests
{
  [Fact]
  public void DescriptorMakesNoClipboardRecoveryClaim()
  {
    var descriptor = StandardUserCapabilityCatalog.ClipboardWrite;

    Assert.Equal(CapabilityEffect.LocalWrite, descriptor.Effect);
    Assert.Equal(RecoveryKind.Irreversible, descriptor.Recovery);
    Assert.Contains("Irreversibly", descriptor.Description, StringComparison.Ordinal);
    Assert.Equal(["interactive-clipboard"], descriptor.ProvenanceOutputs);
    Assert.DoesNotContain(
      StandardUserCapabilityCatalog.All,
      candidate => candidate.Id == descriptor.Id
        && candidate.ProvenanceOutputs.Contains(
          "session-recovery-record",
          StringComparer.Ordinal));
  }

  [Fact]
  public async Task AdapterRetainsPreStateAndByteAccountingWithoutRecoveryEvidence()
  {
    const string previous = "prior clipboard π";
    const string replacement = "replacement clipboard value";
    var written = new List<string>();
    var adapter = new ClipboardTextWriteCapabilityAdapter(
      _ => Task.FromResult(previous),
      (value, cancellationToken) =>
      {
        cancellationToken.ThrowIfCancellationRequested();
        written.Add(value);
        return Task.CompletedTask;
      });
    using var arguments = JsonDocument.Parse(
      JsonSerializer.Serialize(new { text = replacement }));
    var expectedPreState = ClipboardTextReadCapabilityAdapter.ClipboardState(previous);
    var context = new ActionExecutionContext(
      "10000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000002",
      "30000000-0000-4000-8000-000000000003",
      "40000000-0000-4000-8000-000000000004",
      "50000000-0000-4000-8000-000000000005",
      "60000000-0000-4000-8000-000000000006",
      "clipboard-write-1",
      expectedPreState,
      null,
      new ActionBudget(60, 1, 1, 1, 1_048_576, 0, 0));

    var result = await adapter.ExecuteAsync(
      context,
      arguments.RootElement,
      CancellationToken.None);

    Assert.Equal([replacement], written);
    Assert.True(result.MutationCommitted);
    Assert.False(result.OutcomeUncertain);
    Assert.Equal(expectedPreState, result.PreStateSha256);
    Assert.Equal(Encoding.UTF8.GetByteCount(previous), result.LocalBytesRead);
    Assert.Equal(Encoding.UTF8.GetByteCount(replacement), result.LocalBytesWritten);
    Assert.Null(result.OpaqueRecoveryHandle);
    Assert.Null(result.RecoveryProvenanceSha256);
    var provenance = Assert.Single(result.Provenance);
    Assert.Equal("interactive-clipboard", provenance.SourceType);

    var mismatch = await Assert.ThrowsAsync<InvalidOperationException>(() =>
      adapter.ExecuteAsync(
        context with { ExpectedPreStateSha256 = new string('0', 64) },
        arguments.RootElement,
        CancellationToken.None).AsTask());
    Assert.Equal("expected_pre_state_mismatch", mismatch.Message);
    Assert.Single(written);
  }
}
