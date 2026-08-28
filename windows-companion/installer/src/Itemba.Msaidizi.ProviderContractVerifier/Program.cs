using System.Globalization;
using System.Text.Json;

namespace Itemba.Msaidizi.ProviderContractVerification;

public static class Program
{
  private static readonly JsonSerializerOptions OutputJsonOptions = new()
  {
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
  };

  private static readonly string[] RequiredArguments =
  [
    "--attestation",
    "--contract-document",
    "--public-key",
    "--required-window-end-utc",
    "--required-window-start-utc",
    "--validation-time-utc",
  ];

  public static int Main(string[] args)
  {
    try
    {
      var values = ParseArguments(args);
      var request = new ProviderContractVerificationRequest(
        values["--attestation"],
        values["--public-key"],
        values["--contract-document"],
        ParseUtc(values["--required-window-start-utc"], "required window start"),
        ParseUtc(values["--required-window-end-utc"], "required window end"),
        ParseUtc(values["--validation-time-utc"], "validation time"));
      var result = ProviderContractVerifier.Verify(request);
      Console.Out.WriteLine(JsonSerializer.Serialize(result, OutputJsonOptions));
      return 0;
    }
    catch (ProviderContractVerificationException exception)
    {
      Console.Error.WriteLine(exception.Message);
      return 2;
    }
    catch (Exception exception) when (
      exception is ArgumentException or FormatException or OverflowException)
    {
      Console.Error.WriteLine($"PROVIDER_CONTRACT_ARGUMENT_INVALID: {exception.Message}");
      return 2;
    }
  }

  private static Dictionary<string, string> ParseArguments(IReadOnlyList<string> args)
  {
    if (args.Count != RequiredArguments.Length * 2)
    {
      throw new ArgumentException("Exactly the six reviewed provider-contract arguments are required.");
    }

    var values = new Dictionary<string, string>(StringComparer.Ordinal);
    for (var index = 0; index < args.Count; index += 2)
    {
      var name = args[index];
      var value = args[index + 1];
      if (!RequiredArguments.Contains(name, StringComparer.Ordinal) ||
          string.IsNullOrWhiteSpace(value) ||
          !values.TryAdd(name, value))
      {
        throw new ArgumentException("Provider-contract arguments are missing, duplicated, or unreviewed.");
      }
    }

    return values;
  }

  private static DateTimeOffset ParseUtc(string value, string description)
  {
    if (!DateTimeOffset.TryParse(
          value,
          CultureInfo.InvariantCulture,
          DateTimeStyles.AllowWhiteSpaces | DateTimeStyles.AssumeUniversal,
          out var parsed) ||
        parsed.Offset != TimeSpan.Zero)
    {
      throw new FormatException($"{description} must be an explicit UTC timestamp.");
    }

    return parsed;
  }
}
