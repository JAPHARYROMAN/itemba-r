using System.Text.Json;
using System.Text;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Contracts.Capabilities;

public sealed record BrowserSecretRequirement(
  string ReferenceId,
  string BindingId,
  string DestinationScopeSha256);

/// <summary>
/// Computes the vault scope from normalized signed destination fields. The
/// caller cannot supply an alternate scope digest to widen a secret handle.
/// </summary>
public static class BrowserSecretDestination
{
  public static BrowserSecretRequirement? Resolve(
    string capabilityId,
    JsonElement arguments)
  {
    var bindingId = capabilityId switch
    {
      "browser.form.secret.set" => "value",
      "browser.file.upload" => "file-path",
      _ => null,
    };
    if (bindingId is null)
    {
      return null;
    }

    // browser.file.upload has a second, schema-disjoint governed-artifact
    // branch. That branch carries no vault handle and must reach the user
    // session without manufacturing a secret requirement.
    if (string.Equals(capabilityId, "browser.file.upload", StringComparison.Ordinal)
      && !arguments.TryGetProperty("secretReferenceId", out _))
    {
      return null;
    }

    var referenceId = arguments.GetProperty("secretReferenceId").GetString()!;
    var originId = arguments.GetProperty("originId").GetString()!;
    var originSha256 = arguments.GetProperty("originSha256").GetString()!;
    var automationId = arguments.GetProperty("automationId").GetString()!;
    var uploadRootId = capabilityId == "browser.file.upload"
      ? arguments.GetProperty("uploadRootId").GetString()!
      : string.Empty;
    return new BrowserSecretRequirement(
      referenceId,
      bindingId,
      PayloadDigest.Sha256Hex(string.Join('\n',
        "itemba-browser-secret-destination-v1",
        capabilityId,
        originId.Normalize(NormalizationForm.FormC),
        originSha256,
        automationId.Normalize(NormalizationForm.FormC),
        uploadRootId.Normalize(NormalizationForm.FormC))));
  }
}
