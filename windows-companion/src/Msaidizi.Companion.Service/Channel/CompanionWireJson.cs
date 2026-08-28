using System.Text.Json;
using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Contracts.Commands;

namespace Itemba.Msaidizi.Companion.Service.Channel;

/// <summary>
/// The single JSON wire contract used by the outbound broker channel and by
/// result-egress accounting. Keeping them together prevents escaped outer JSON,
/// enum strings, provenance, or journal metadata from being omitted from the
/// signed budget calculation.
/// </summary>
internal static class CompanionWireJson
{
  internal static JsonSerializerOptions Options { get; } = CreateOptions();

  internal static long ResultUpperBoundBytes(ActionResult result)
  {
    const string maximumDigest =
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    var upperBound = result with
    {
      BrokerExternalEgressBytes = long.MaxValue,
      BrokerMaxDeliverySessions = int.MaxValue,
      BrokerMaxRequestAttemptsPerSession = int.MaxValue,
      BrokerSerializedResultUpperBoundBytes = long.MaxValue,
      JournalPrepareSequence = long.MaxValue,
      JournalPrepareEntryHash = maximumDigest,
      JournalPreparePreviousHash = maximumDigest,
      JournalSequence = long.MaxValue,
      JournalEntryHash = maximumDigest,
      JournalPreviousHash = maximumDigest,
      JournalRecoveryPreparedSequence = long.MaxValue,
      JournalRecoveryPreparedEntryHash = maximumDigest,
      JournalRecoveryPreparedPreviousHash = maximumDigest,
      PreStateSha256 = result.PreStateSha256 ?? maximumDigest,
      RecoveryProvenanceSha256 = result.RecoveryProvenanceSha256 ?? maximumDigest,
      RecoveryHandleSha256 = result.RecoveryHandleSha256 ?? maximumDigest,
    };
    return JsonSerializer.SerializeToUtf8Bytes(upperBound, Options).LongLength;
  }

  private static JsonSerializerOptions CreateOptions()
  {
    var options = new JsonSerializerOptions(JsonSerializerDefaults.Web)
    {
      AllowTrailingCommas = false,
      DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
      MaxDepth = 32,
      PropertyNameCaseInsensitive = false,
      ReadCommentHandling = JsonCommentHandling.Disallow,
      UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };
    options.Converters.Add(new JsonStringEnumConverter(allowIntegerValues: false));
    return options;
  }
}
