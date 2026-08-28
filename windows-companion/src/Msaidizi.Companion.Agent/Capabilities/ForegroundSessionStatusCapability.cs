using System.Diagnostics;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Agent.Capabilities;

/// <summary>
/// Safe standard-user example. It does not capture screen, clipboard, audio,
/// keystrokes, window titles, usernames, or document content.
/// </summary>
public sealed class ForegroundSessionStatusCapability : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor => StandardUserCapabilityCatalog.SessionStatus;

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    arguments.ValueKind == JsonValueKind.Object && !arguments.EnumerateObject().Any()
      ? CapabilityArgumentValidation.Success
      : CapabilityArgumentValidation.Invalid(
        "arguments_schema_invalid",
        "This capability accepts an empty object only.");

  public CapabilityArgumentValidation ValidateResult(JsonElement result)
  {
    if (result.ValueKind != JsonValueKind.Object
      || result.EnumerateObject().Count() != 2
      || !result.TryGetProperty("interactive", out var interactive)
      || interactive.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
      || !result.TryGetProperty("sessionId", out var sessionId)
      || !sessionId.TryGetInt32(out var parsedSessionId)
      || parsedSessionId < 0)
    {
      return CapabilityArgumentValidation.Invalid(
        "result_schema_invalid",
        "Session result did not match its declared schema.");
    }

    return CapabilityArgumentValidation.Success;
  }

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    using var process = Process.GetCurrentProcess();
    var output = JsonSerializer.Serialize(new
    {
      interactive = Environment.UserInteractive,
      sessionId = process.SessionId,
    });
    return ValueTask.FromResult(new CapabilityExecutionResult(
      output,
      MutationCommitted: false,
      OutcomeUncertain: false,
      Provenance:
      [
        new DataProvenance(
          "interactive-session-runtime",
          PayloadDigest.Sha256Hex("current-session"),
          PayloadDigest.Sha256Hex(output),
          ProvenanceTrust.TrustedSystem,
          DateTimeOffset.UtcNow),
      ]));
  }
}
