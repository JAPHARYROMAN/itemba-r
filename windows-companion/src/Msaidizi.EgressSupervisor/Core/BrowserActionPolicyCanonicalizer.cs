using System.Security.Cryptography;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.EgressSupervisor.Core;

internal sealed record BrowserActionPolicyResolution(
  BrowserActionPolicyV1 Policy,
  EgressDestinationPolicyEntryV1 Destination);

/// <summary>
/// Resolves the only source-supported managed-browser action from the
/// supervisor-owned destination policy. The action cannot introduce a host,
/// port, query, fragment, credential, or destination authority.
/// </summary>
internal static class BrowserActionPolicyCanonicalizer
{
  private static readonly JsonDocumentOptions DocumentOptions = new()
  {
    AllowTrailingCommas = false,
    CommentHandling = JsonCommentHandling.Disallow,
    MaxDepth = 4,
  };

  public static bool TryCreate(
    string capabilityId,
    string capabilityVersion,
    string argumentsJsonUtf8,
    string argumentsSha256,
    string expectedPreStateSha256,
    string idempotencyKeySha256,
    EgressDestinationPolicy destinationPolicy,
    out BrowserActionPolicyResolution resolution,
    out string errorCode)
  {
    resolution = null!;
    errorCode = "egress_browser_action_arguments_invalid";
    if (!string.Equals(
        capabilityId,
        ManagedBrowserBoundaryContract.CapabilityId,
        StringComparison.Ordinal)
      || !string.Equals(
        capabilityVersion,
        ManagedBrowserBoundaryContract.CapabilityVersion,
        StringComparison.Ordinal)
      || string.IsNullOrWhiteSpace(argumentsJsonUtf8)
      || argumentsJsonUtf8.Length > 4_096
      || !BrowserBoundaryContractValidator.IsSha256(argumentsSha256)
      || !BrowserBoundaryContractValidator.IsSha256(expectedPreStateSha256)
      || !BrowserBoundaryContractValidator.IsSha256(idempotencyKeySha256))
    {
      return false;
    }

    try
    {
      using var document = JsonDocument.Parse(argumentsJsonUtf8, DocumentOptions);
      var arguments = document.RootElement;
      if (arguments.ValueKind != JsonValueKind.Object
        || arguments.EnumerateObject().Count() != 2
        || !arguments.TryGetProperty("originId", out var originIdValue)
        || originIdValue.ValueKind != JsonValueKind.String
        || !arguments.TryGetProperty("relativePath", out var relativePathValue)
        || relativePathValue.ValueKind != JsonValueKind.String
        || originIdValue.GetString() is not { } originId
        || relativePathValue.GetString() is not { } relativePath
        || !SafeId(originId)
        || !SafeRelativePath(relativePath))
      {
        return false;
      }

      var destination = destinationPolicy.Resolve(capabilityId, originId);
      if (!string.Equals(destination.CapabilityId, capabilityId, StringComparison.Ordinal)
        || destination.DestinationPort is < 1 or > 65_535
        || !string.Equals(
          destination.DestinationPathAndQuery,
          relativePath,
          StringComparison.Ordinal)
        || !string.IsNullOrEmpty(destination.CredentialPrefix))
      {
        return false;
      }

      var originBuilder = new UriBuilder(
        Uri.UriSchemeHttps,
        destination.DestinationHost,
        destination.DestinationPort,
        "/");
      var origin = originBuilder.Uri;
      if (!Uri.TryCreate(origin, relativePath, out var target)
        || !string.Equals(target.Scheme, Uri.UriSchemeHttps, StringComparison.Ordinal)
        || !string.Equals(
          target.GetLeftPart(UriPartial.Authority),
          origin.GetLeftPart(UriPartial.Authority),
          StringComparison.OrdinalIgnoreCase)
        || !string.Equals(target.PathAndQuery, relativePath, StringComparison.Ordinal)
        || !string.IsNullOrEmpty(target.Query)
        || !string.IsNullOrEmpty(target.Fragment)
        || !string.IsNullOrEmpty(target.UserInfo))
      {
        return false;
      }

      var policy = new BrowserActionPolicyV1(
        ManagedBrowserBoundaryContract.Version,
        capabilityId,
        capabilityVersion,
        originId,
        Sha256Hex(origin.AbsoluteUri),
        Sha256Hex(target.AbsoluteUri),
        destination.ServerCertificateSha256Pin,
        Sha256Hex(relativePath),
        destination.DestinationScopeSha256,
        argumentsSha256,
        expectedPreStateSha256,
        idempotencyKeySha256);
      if (!BrowserBoundaryContractValidator.IsActionPolicyValid(policy))
      {
        return false;
      }

      resolution = new BrowserActionPolicyResolution(policy, destination);
      errorCode = string.Empty;
      return true;
    }
    catch (Exception exception) when (exception is JsonException
      or InvalidDataException
      or InvalidOperationException
      or UriFormatException
      or ArgumentException)
    {
      return false;
    }
  }

  private static bool SafeId(string value) => value.Length is >= 1 and <= 80
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '_' or '-');

  private static bool SafeRelativePath(string value) => value.Length is >= 1 and <= 2_048
    && value[0] == '/'
    && !value.StartsWith("//", StringComparison.Ordinal)
    && !value.Contains('\\')
    && !value.Contains('?')
    && !value.Contains('#')
    && !value.Any(character => char.IsControl(character) || char.IsSurrogate(character));

  private static string Sha256Hex(string value) => PayloadDigest.Sha256Hex(value);
}
