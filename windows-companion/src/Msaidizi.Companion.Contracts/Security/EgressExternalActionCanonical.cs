using System.Net.Mail;
using System.Security.Cryptography;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;

namespace Itemba.Msaidizi.Companion.Contracts.Security;

public sealed record ExactExternalActionDestination(
  string Authority,
  string EndpointId,
  string AbsoluteHttpsUri,
  string ServerCertificateSha256,
  string VaultReferenceId,
  string VaultRecordSha256,
  string HeaderPrefix)
{
  public bool IsDynamic => string.Equals(
    Authority,
    EgressExternalActionCanonical.DynamicHttpsAuthority,
    StringComparison.Ordinal);
}

/// <summary>
/// Canonicalizes the four externally effectful action payloads from the exact
/// UTF-8 JSON string whose digest is carried by the broker-signed action token.
/// Both the Companion adapter and the independent egress supervisor use this
/// implementation so the supervisor can prove the HTTP body is the authorized
/// action rather than trusting caller-selected plaintext.
/// </summary>
public static class EgressExternalActionCanonical
{
  public const string StaticEndpointAuthority = "static_endpoint_v1";
  public const string DynamicHttpsAuthority = "mandate_dynamic_https_v1";

  private static readonly string[] DynamicDestinationProperties =
  [
    "destinationAuthority",
    "destinationUri",
    "serverCertificateSha256",
    "vaultReferenceId",
    "vaultRecordSha256",
    "headerPrefix",
  ];

  private static readonly JsonDocumentOptions DocumentOptions = new()
  {
    AllowTrailingCommas = false,
    CommentHandling = JsonCommentHandling.Disallow,
    MaxDepth = 16,
  };

  public static bool TryCreate(
    string capabilityId,
    string argumentsJsonUtf8,
    out string endpointId,
    out byte[] requestBody,
    out string errorCode)
  {
    var created = TryCreate(
      capabilityId,
      argumentsJsonUtf8,
      out ExactExternalActionDestination destination,
      out requestBody,
      out errorCode);
    endpointId = created ? destination.EndpointId : string.Empty;
    return created;
  }

  public static bool TryCreate(
    string capabilityId,
    string argumentsJsonUtf8,
    out ExactExternalActionDestination destination,
    out byte[] requestBody,
    out string errorCode)
  {
    destination = null!;
    requestBody = [];
    errorCode = "egress_arguments_invalid";
    if (string.IsNullOrWhiteSpace(argumentsJsonUtf8)
      || argumentsJsonUtf8.Length > 1_048_576)
    {
      return false;
    }

    try
    {
      using var document = JsonDocument.Parse(argumentsJsonUtf8, DocumentOptions);
      var arguments = document.RootElement;
      if (arguments.ValueKind != JsonValueKind.Object
        || !TryDestination(arguments, out destination))
      {
        return false;
      }

      requestBody = capabilityId switch
      {
        "external.email.send" when ValidEmail(arguments) => EmailPayload(arguments),
        "external.message.send" when ValidMessage(arguments) =>
          JsonSerializer.SerializeToUtf8Bytes(new
          {
            kind = "message",
            conversationId = arguments.GetProperty("conversationId").GetString(),
            text = arguments.GetProperty("text").GetString(),
          }),
        "external.publish.create" when ValidPublish(arguments) =>
          JsonSerializer.SerializeToUtf8Bytes(new
          {
            kind = "publish",
            destinationId = arguments.GetProperty("destinationId").GetString(),
            title = arguments.GetProperty("title").GetString(),
            content = arguments.GetProperty("content").GetString(),
            visibility = arguments.GetProperty("visibility").GetString(),
          }),
        "external.purchase.submit" when ValidPurchase(arguments) =>
          JsonSerializer.SerializeToUtf8Bytes(new
          {
            kind = "purchase",
            vendorId = arguments.GetProperty("vendorId").GetString(),
            currency = arguments.GetProperty("currency").GetString(),
            totalAmountMinor = arguments.GetProperty("totalAmountMinor").GetInt64(),
            items = arguments.GetProperty("items").EnumerateArray().Select(item => new
            {
              sku = item.GetProperty("sku").GetString(),
              quantityMilli = item.GetProperty("quantityMilli").GetInt64(),
              unitAmountMinor = item.GetProperty("unitAmountMinor").GetInt64(),
            }).ToArray(),
          }),
        _ => [],
      };
      if (requestBody.Length == 0)
      {
        destination = null!;
        return false;
      }

      errorCode = string.Empty;
      return true;
    }
    catch (Exception exception) when (exception is JsonException
      or InvalidOperationException
      or OverflowException)
    {
      destination = null!;
      requestBody = [];
      return false;
    }
  }

  public static string DestinationScopeSha256(
    string capabilityId,
    string endpointId,
    string absoluteHttpsUri,
    string serverCertificateSha256,
    string vaultReferenceId,
    string headerPrefix) => PayloadDigest.Sha256Hex(string.Join('\n',
      "itemba-external-action-destination/v1",
      capabilityId,
      endpointId,
      absoluteHttpsUri,
      serverCertificateSha256,
      "credential-vault",
      vaultReferenceId,
      headerPrefix));

  private static bool ValidEmail(JsonElement value) =>
    HasExternalActionProperties(value, ["to", "subject", "text"], ["cc", "attachment"])
    && SafeId(value.GetProperty("endpointId"))
    && EmailArray(value.GetProperty("to"), 1, 100)
    && (!value.TryGetProperty("cc", out var cc) || EmailArray(cc, 0, 100))
    && BoundedText(value.GetProperty("subject"), 1, 998, allowNewLines: false)
    && BoundedText(value.GetProperty("text"), 1, 100_000, allowNewLines: true)
    && (!value.TryGetProperty("attachment", out var attachment)
      || ValidArtifact(attachment));

  private static byte[] EmailPayload(JsonElement arguments)
  {
    var to = StringArray(arguments.GetProperty("to"));
    var cc = arguments.TryGetProperty("cc", out var ccValue) ? StringArray(ccValue) : [];
    var subject = arguments.GetProperty("subject").GetString();
    var text = arguments.GetProperty("text").GetString();
    if (!arguments.TryGetProperty("attachment", out var attachment))
    {
      return JsonSerializer.SerializeToUtf8Bytes(new { kind = "email", to, cc, subject, text });
    }
    return JsonSerializer.SerializeToUtf8Bytes(new
    {
      kind = "email",
      to,
      cc,
      subject,
      text,
      attachment = new
      {
        artifactId = attachment.GetProperty("artifactId").GetString(),
        sha256 = attachment.GetProperty("sha256").GetString(),
        byteSize = attachment.GetProperty("byteSize").GetInt32(),
        mimeType = attachment.GetProperty("mimeType").GetString(),
        name = attachment.GetProperty("name").GetString(),
        contentBase64 = attachment.GetProperty("contentBase64").GetString(),
      },
    });
  }

  private static bool ValidArtifact(JsonElement value)
  {
    if (!GovernedArtifactEnvelope.TryDecode(
      value,
      context: null,
      requiredKind: null,
      out _,
      out var content))
    {
      return false;
    }
    CryptographicOperations.ZeroMemory(content);
    return true;
  }

  private static bool ValidMessage(JsonElement value) =>
    HasExternalActionProperties(value, ["conversationId", "text"], [])
    && SafeId(value.GetProperty("endpointId"))
    && BoundedText(value.GetProperty("conversationId"), 1, 256, false)
    && BoundedText(value.GetProperty("text"), 1, 100_000, true);

  private static bool ValidPublish(JsonElement value) =>
    HasExternalActionProperties(
      value,
      ["destinationId", "title", "content", "visibility"],
      [])
    && SafeId(value.GetProperty("endpointId"))
    && BoundedText(value.GetProperty("destinationId"), 1, 256, false)
    && BoundedText(value.GetProperty("title"), 1, 998, false)
    && BoundedText(value.GetProperty("content"), 1, 250_000, true)
    && value.GetProperty("visibility").ValueKind == JsonValueKind.String
    && value.GetProperty("visibility").GetString() is "public" or "unlisted" or "private";

  private static bool ValidPurchase(JsonElement value)
  {
    if (!HasExternalActionProperties(
        value,
        ["vendorId", "currency", "totalAmountMinor", "items"],
        [])
      || !SafeId(value.GetProperty("endpointId"))
      || !BoundedText(value.GetProperty("vendorId"), 1, 256, false)
      || value.GetProperty("currency").ValueKind != JsonValueKind.String
      || value.GetProperty("currency").GetString() is not { Length: 3 } currency
      || currency.Any(character => character is < 'A' or > 'Z')
      || !IntegerInRange(value.GetProperty("totalAmountMinor"), 1, 9_007_199_254_740_991)
      || value.GetProperty("items").ValueKind != JsonValueKind.Array
      || value.GetProperty("items").GetArrayLength() is < 1 or > 100)
    {
      return false;
    }

    long calculated = 0;
    try
    {
      foreach (var item in value.GetProperty("items").EnumerateArray())
      {
        if (!HasExactly(item, ["sku", "quantityMilli", "unitAmountMinor"])
          || !BoundedText(item.GetProperty("sku"), 1, 256, false)
          || !IntegerInRange(item.GetProperty("quantityMilli"), 1, 1_000_000_000)
          || !IntegerInRange(item.GetProperty("unitAmountMinor"), 1, 9_007_199_254_740_991))
        {
          return false;
        }
        var numerator = checked(
          item.GetProperty("quantityMilli").GetInt64()
          * item.GetProperty("unitAmountMinor").GetInt64());
        if (numerator % 1_000 != 0)
        {
          return false;
        }
        calculated = checked(calculated + numerator / 1_000);
      }
    }
    catch (OverflowException)
    {
      return false;
    }
    return calculated == value.GetProperty("totalAmountMinor").GetInt64();
  }

  private static bool HasExactly(JsonElement value, IReadOnlyCollection<string> names) =>
    HasOnlyRequiredAndOptional(value, names, []);

  private static bool HasExternalActionProperties(
    JsonElement value,
    IReadOnlyCollection<string> actionRequired,
    IReadOnlyCollection<string> actionOptional)
  {
    var dynamic = value.TryGetProperty("destinationAuthority", out _);
    var required = new List<string> { "endpointId" };
    if (dynamic)
    {
      required.AddRange(DynamicDestinationProperties);
    }
    required.AddRange(actionRequired);
    return HasOnlyRequiredAndOptional(value, required, actionOptional);
  }

  private static bool TryDestination(
    JsonElement value,
    out ExactExternalActionDestination destination)
  {
    destination = null!;
    if (!value.TryGetProperty("endpointId", out var endpoint) || !SafeId(endpoint))
    {
      return false;
    }

    var endpointId = endpoint.GetString()!;
    if (!value.TryGetProperty("destinationAuthority", out var authority))
    {
      destination = new ExactExternalActionDestination(
        StaticEndpointAuthority,
        endpointId,
        string.Empty,
        string.Empty,
        string.Empty,
        string.Empty,
        string.Empty);
      return true;
    }

    if (authority.ValueKind != JsonValueKind.String
      || authority.GetString() != DynamicHttpsAuthority
      || !value.TryGetProperty("destinationUri", out var uriValue)
      || uriValue.ValueKind != JsonValueKind.String
      || !PublicNetworkDestinationPolicy.TryCanonicalizeHttpsUri(
        uriValue.GetString()!,
        2_048,
        out var uri)
      || !value.TryGetProperty("serverCertificateSha256", out var certificatePin)
      || !CanonicalSha256(certificatePin)
      || !value.TryGetProperty("vaultReferenceId", out var credentialReference)
      || credentialReference.ValueKind != JsonValueKind.String
      || !Guid.TryParseExact(credentialReference.GetString(), "D", out var parsedReference)
      || !string.Equals(
        parsedReference.ToString("D"),
        credentialReference.GetString(),
        StringComparison.Ordinal)
      || !value.TryGetProperty("vaultRecordSha256", out var credentialRecord)
      || !CanonicalSha256(credentialRecord)
      || !value.TryGetProperty("headerPrefix", out var headerPrefix)
      || headerPrefix.ValueKind != JsonValueKind.String
      || headerPrefix.GetString() is not { } prefix
      || prefix.Length > 64
      || prefix.Any(character => character is < ' ' or > '~')
      || prefix.Contains('\r')
      || prefix.Contains('\n'))
    {
      return false;
    }

    destination = new ExactExternalActionDestination(
      DynamicHttpsAuthority,
      endpointId,
      uri.AbsoluteUri,
      certificatePin.GetString()!,
      credentialReference.GetString()!,
      credentialRecord.GetString()!,
      prefix);
    return true;
  }

  private static bool HasOnlyRequiredAndOptional(
    JsonElement value,
    IReadOnlyCollection<string> required,
    IReadOnlyCollection<string> optional)
  {
    if (value.ValueKind != JsonValueKind.Object)
    {
      return false;
    }
    var properties = value.EnumerateObject().Select(property => property.Name).ToArray();
    return properties.Distinct(StringComparer.Ordinal).Count() == properties.Length
      && required.All(name => properties.Contains(name, StringComparer.Ordinal))
      && properties.All(name => required.Contains(name, StringComparer.Ordinal)
        || optional.Contains(name, StringComparer.Ordinal));
  }

  private static bool SafeId(JsonElement value) => value.ValueKind == JsonValueKind.String
    && value.GetString() is { Length: >= 1 and <= 80 } text
    && text.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_');

  private static bool CanonicalSha256(JsonElement value) =>
    value.ValueKind == JsonValueKind.String
    && value.GetString() is { } text
    && PayloadDigest.IsSha256Hex(text)
    && string.Equals(text, text.ToLowerInvariant(), StringComparison.Ordinal);

  private static bool BoundedText(
    JsonElement value,
    int minimum,
    int maximum,
    bool allowNewLines)
  {
    if (value.ValueKind != JsonValueKind.String
      || value.GetString() is not { } text
      || text.Length < minimum
      || text.Length > maximum)
    {
      return false;
    }
    return text.All(character => !char.IsControl(character)
      || (allowNewLines && character is '\r' or '\n' or '\t'));
  }

  private static bool EmailArray(JsonElement value, int minimum, int maximum)
  {
    if (value.ValueKind != JsonValueKind.Array
      || value.GetArrayLength() < minimum
      || value.GetArrayLength() > maximum)
    {
      return false;
    }
    var addresses = StringArray(value);
    return addresses.Distinct(StringComparer.OrdinalIgnoreCase).Count() == addresses.Length
      && addresses.All(address => address.Length <= 320
        && MailAddress.TryCreate(address, out var parsed)
        && string.Equals(parsed.Address, address, StringComparison.OrdinalIgnoreCase));
  }

  private static string[] StringArray(JsonElement value) => value.EnumerateArray()
    .Select(item => item.ValueKind == JsonValueKind.String ? item.GetString()! : string.Empty)
    .ToArray();

  private static bool IntegerInRange(JsonElement value, long minimum, long maximum) =>
    value.ValueKind == JsonValueKind.Number
    && value.TryGetInt64(out var number)
    && number >= minimum
    && number <= maximum;
}
