using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Globalization;
using Itemba.Msaidizi.Companion.Contracts.Commands;

namespace Itemba.Msaidizi.Companion.Contracts.Security;

public sealed record ActionTokenVerificationSettings(
  string ExpectedIssuer,
  string ExpectedAudience,
  string ExpectedSubject,
  TimeSpan AllowedClockSkew,
  TimeSpan MaximumTokenLifetime);

public sealed record ActionTokenClaims
{
  [JsonPropertyName("iss")]
  public required string Issuer { get; init; }

  [JsonPropertyName("aud")]
  public required string Audience { get; init; }

  [JsonPropertyName("sub")]
  public required string Subject { get; init; }

  [JsonPropertyName("jti")]
  public required string TokenId { get; init; }

  [JsonPropertyName("action_id")]
  public required string ActionId { get; init; }

  [JsonPropertyName("task_id")]
  public required string TaskId { get; init; }

  [JsonPropertyName("plan_version_id")]
  public required string PlanVersionId { get; init; }

  [JsonPropertyName("step_id")]
  public required string StepId { get; init; }

  [JsonPropertyName("device_id")]
  public required string DeviceId { get; init; }

  [JsonPropertyName("mandate_id")]
  public required string MandateId { get; init; }

  [JsonPropertyName("capability_id")]
  public required string CapabilityId { get; init; }

  [JsonPropertyName("capability_version")]
  public required string CapabilityVersion { get; init; }

  [JsonPropertyName("arguments_sha256")]
  public required string ArgumentsSha256 { get; init; }

  [JsonPropertyName("expected_pre_state_sha256")]
  public string? ExpectedPreStateSha256 { get; init; }

  [JsonPropertyName("input_provenance_sha256")]
  public string? InputProvenanceSha256 { get; init; }

  [JsonPropertyName("idempotency_key")]
  public required string IdempotencyKey { get; init; }

  [JsonPropertyName("lease_id")]
  public required string LeaseId { get; init; }

  [JsonPropertyName("fencing_token")]
  public required string FencingToken { get; init; }

  [JsonPropertyName("lease_expires_at")]
  public long LeaseExpiresAtUnixSeconds { get; init; }

  [JsonPropertyName("dispatch_count")]
  public int DispatchCount { get; init; }

  [JsonPropertyName("execution_mode")]
  public required string ExecutionMode { get; init; }

  [JsonPropertyName("consent_grant")]
  public string? ConsentGrant { get; init; }

  [JsonPropertyName("budgets")]
  public required ActionBudget Budgets { get; init; }

  [JsonPropertyName("iat")]
  public long IssuedAtUnixSeconds { get; init; }

  [JsonPropertyName("exp")]
  public long ExpiresAtUnixSeconds { get; init; }
}

public sealed record ActionTokenVerificationResult(
  bool IsValid,
  ActionTokenClaims? Claims,
  string? ErrorCode)
{
  public static ActionTokenVerificationResult Valid(ActionTokenClaims claims) =>
    new(true, claims, null);

  public static ActionTokenVerificationResult Invalid(string errorCode) =>
    new(false, null, errorCode);
}

public interface IActionTokenVerifier
{
  ValueTask<ActionTokenVerificationResult> VerifyAsync(
    string compactToken,
    CancellationToken cancellationToken);
}

/// <summary>
/// Resolves an ES256 verification key from a trusted OS certificate store.
/// The caller owns and disposes the returned key.
/// </summary>
public interface IActionVerificationKeyResolver
{
  bool TryResolve(string keyId, out ECDsa? publicKey);
}

public sealed class Es256ActionTokenVerifier : IActionTokenVerifier
{
  private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web)
  {
    PropertyNameCaseInsensitive = false,
  };

  private static readonly HashSet<string> AllowedHeaderProperties = new(StringComparer.Ordinal)
  {
    "alg",
    "kid",
    "typ",
  };

  private static readonly HashSet<string> AllowedClaimProperties = new(StringComparer.Ordinal)
  {
    "iss",
    "aud",
    "sub",
    "jti",
    "action_id",
    "task_id",
    "plan_version_id",
    "step_id",
    "device_id",
    "mandate_id",
    "capability_id",
    "capability_version",
    "arguments_sha256",
    "expected_pre_state_sha256",
    "input_provenance_sha256",
    "idempotency_key",
    "lease_id",
    "fencing_token",
    "lease_expires_at",
    "dispatch_count",
    "execution_mode",
    "consent_grant",
    "budgets",
    "iat",
    "exp",
  };

  private static readonly HashSet<string> RequiredBudgetProperties = new(StringComparer.Ordinal)
  {
    "maxWallTimeSeconds",
    "maxModelTurns",
    "maxAttemptedToolCalls",
    "maxMutations",
    "maxLocalBytes",
    "maxExternalEgressBytes",
    "maxModelSpendUsd",
    "brokerMaxDeliverySessions",
    "brokerMaxRequestAttemptsPerSession",
    "brokerSerializedResultUpperBoundBytes",
  };

  private readonly ActionTokenVerificationSettings _settings;
  private readonly IActionVerificationKeyResolver _keyResolver;
  private readonly TimeProvider _timeProvider;

  public Es256ActionTokenVerifier(
    ActionTokenVerificationSettings settings,
    IActionVerificationKeyResolver keyResolver,
    TimeProvider? timeProvider = null)
  {
    _settings = settings;
    _keyResolver = keyResolver;
    _timeProvider = timeProvider ?? TimeProvider.System;
  }

  public ValueTask<ActionTokenVerificationResult> VerifyAsync(
    string compactToken,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();

    if (string.IsNullOrWhiteSpace(compactToken) || compactToken.Length > 16_384)
    {
      return ValueTask.FromResult(ActionTokenVerificationResult.Invalid("token_malformed"));
    }

    var segments = compactToken.Split('.');
    if (segments.Length != 3 || segments.Any(string.IsNullOrEmpty))
    {
      return ValueTask.FromResult(ActionTokenVerificationResult.Invalid("token_malformed"));
    }

    try
    {
      var headerBytes = Base64Url.Decode(segments[0]);
      var payloadBytes = Base64Url.Decode(segments[1]);
      var signature = Base64Url.Decode(segments[2]);

      using var headerDocument = JsonDocument.Parse(headerBytes);
      if (!HasOnlyUniqueProperties(headerDocument.RootElement, AllowedHeaderProperties))
      {
        return ValueTask.FromResult(ActionTokenVerificationResult.Invalid("token_header_not_strict"));
      }

      var header = headerDocument.RootElement;
      if (!header.TryGetProperty("alg", out var algorithm)
        || algorithm.GetString() != "ES256"
        || !header.TryGetProperty("typ", out var tokenType)
        || tokenType.GetString() != "at+jwt"
        || !header.TryGetProperty("kid", out var keyIdProperty))
      {
        return ValueTask.FromResult(ActionTokenVerificationResult.Invalid("token_header_invalid"));
      }

      var keyId = keyIdProperty.GetString();
      if (string.IsNullOrWhiteSpace(keyId)
        || keyId.Length > 128
        || !_keyResolver.TryResolve(keyId, out var publicKey)
        || publicKey is null)
      {
        return ValueTask.FromResult(ActionTokenVerificationResult.Invalid("token_key_untrusted"));
      }

      using (publicKey)
      {
        var signedBytes = Encoding.ASCII.GetBytes($"{segments[0]}.{segments[1]}");
        if (publicKey.KeySize != 256
          || signature.Length != 64
          || !publicKey.VerifyData(
          signedBytes,
          signature,
          HashAlgorithmName.SHA256,
          DSASignatureFormat.IeeeP1363FixedFieldConcatenation))
        {
          return ValueTask.FromResult(ActionTokenVerificationResult.Invalid("token_signature_invalid"));
        }
      }

      using var claimsDocument = JsonDocument.Parse(payloadBytes);
      if (!HasOnlyUniqueProperties(claimsDocument.RootElement, AllowedClaimProperties))
      {
        return ValueTask.FromResult(ActionTokenVerificationResult.Invalid("token_claims_not_strict"));
      }

      if (!claimsDocument.RootElement.TryGetProperty("budgets", out var budgets)
        || !HasExactUniqueProperties(budgets, RequiredBudgetProperties))
      {
        return ValueTask.FromResult(ActionTokenVerificationResult.Invalid("token_budgets_not_strict"));
      }

      if (!claimsDocument.RootElement.TryGetProperty("lease_id", out _)
        || !claimsDocument.RootElement.TryGetProperty("fencing_token", out _)
        || !claimsDocument.RootElement.TryGetProperty("lease_expires_at", out _)
        || !claimsDocument.RootElement.TryGetProperty("execution_mode", out _))
      {
        return ValueTask.FromResult(ActionTokenVerificationResult.Invalid("token_claims_invalid"));
      }

      var claims = claimsDocument.RootElement.Deserialize<ActionTokenClaims>(SerializerOptions);
      if (claims is null || !HasRequiredClaims(claims))
      {
        return ValueTask.FromResult(ActionTokenVerificationResult.Invalid("token_claims_invalid"));
      }

      if (!string.Equals(claims.Issuer, _settings.ExpectedIssuer, StringComparison.Ordinal)
        || !string.Equals(claims.Audience, _settings.ExpectedAudience, StringComparison.Ordinal)
        || !string.Equals(claims.Subject, _settings.ExpectedSubject, StringComparison.Ordinal))
      {
        return ValueTask.FromResult(ActionTokenVerificationResult.Invalid("token_scope_invalid"));
      }

      var issuedAt = DateTimeOffset.FromUnixTimeSeconds(claims.IssuedAtUnixSeconds);
      var expiresAt = DateTimeOffset.FromUnixTimeSeconds(claims.ExpiresAtUnixSeconds);
      var leaseExpiresAt = DateTimeOffset.FromUnixTimeSeconds(claims.LeaseExpiresAtUnixSeconds);
      var now = _timeProvider.GetUtcNow();

      if (expiresAt <= issuedAt
        || expiresAt - issuedAt > _settings.MaximumTokenLifetime
        || issuedAt > now + _settings.AllowedClockSkew
        || expiresAt <= now - _settings.AllowedClockSkew)
      {
        return ValueTask.FromResult(ActionTokenVerificationResult.Invalid("token_time_invalid"));
      }

      if (leaseExpiresAt <= issuedAt || leaseExpiresAt <= now || expiresAt > leaseExpiresAt)
      {
        return ValueTask.FromResult(ActionTokenVerificationResult.Invalid("token_lease_invalid"));
      }

      return ValueTask.FromResult(ActionTokenVerificationResult.Valid(claims));
    }
    catch (Exception exception) when (exception is FormatException
      or JsonException
      or ArgumentOutOfRangeException
      or InvalidOperationException
      or UnauthorizedAccessException
      or IOException
      or CryptographicException)
    {
      return ValueTask.FromResult(ActionTokenVerificationResult.Invalid("token_malformed"));
    }
  }

  private static bool HasOnlyUniqueProperties(JsonElement element, IReadOnlySet<string> allowed)
  {
    if (element.ValueKind != JsonValueKind.Object)
    {
      return false;
    }

    var seen = new HashSet<string>(StringComparer.Ordinal);
    foreach (var property in element.EnumerateObject())
    {
      if (!allowed.Contains(property.Name) || !seen.Add(property.Name))
      {
        return false;
      }
    }

    return true;
  }

  private static bool HasExactUniqueProperties(JsonElement element, IReadOnlySet<string> required)
  {
    if (!HasOnlyUniqueProperties(element, required))
    {
      return false;
    }

    var count = 0;
    foreach (var _ in element.EnumerateObject())
    {
      count++;
    }

    return count == required.Count;
  }

  private static bool HasRequiredClaims(ActionTokenClaims claims) =>
    Required(claims.TokenId)
    && Required(claims.ActionId)
    && Required(claims.TaskId)
    && Required(claims.PlanVersionId)
    && Required(claims.StepId)
    && Required(claims.DeviceId)
    && Required(claims.MandateId)
    && Required(claims.CapabilityId)
    && Required(claims.CapabilityVersion)
    && PayloadDigest.IsSha256Hex(claims.ArgumentsSha256)
    && (claims.ExpectedPreStateSha256 is null
      || PayloadDigest.IsSha256Hex(claims.ExpectedPreStateSha256))
    && (claims.InputProvenanceSha256 is null
      || PayloadDigest.IsSha256Hex(claims.InputProvenanceSha256))
    && Required(claims.IdempotencyKey)
    && LeaseFenceContract.HasValidIdentity(claims.LeaseId, claims.FencingToken)
    && claims.Budgets is not null
    && ActionExecutionModes.IsSupported(claims.ExecutionMode)
    && claims.DispatchCount >= 1
    && claims.DispatchCount <= claims.Budgets.BrokerMaxDeliverySessions;

  private static bool Required(string? value) =>
    !string.IsNullOrWhiteSpace(value) && value.Length <= 512;
}

public static class ActionRequestAuthorizer
{
  public static string? Validate(
    ActionRequest request,
    ActionTokenClaims claims,
    DateTimeOffset? nowUtc = null)
  {
    if (!RequiredRequestValue(request.ActionId)
      || !RequiredRequestValue(request.TaskId)
      || !RequiredRequestValue(request.PlanVersionId)
      || !RequiredRequestValue(request.StepId)
      || !RequiredRequestValue(request.DeviceId)
      || !RequiredRequestValue(request.MandateId)
      || !RequiredRequestValue(request.CapabilityId)
      || !RequiredRequestValue(request.CapabilityVersion)
      || !RequiredRequestValue(request.IdempotencyKey)
      || !LeaseFenceContract.HasValidIdentity(request.LeaseId, request.FencingToken)
      || request.LeaseExpiresAt == default
      || request.DispatchCount < 1
      || !ActionExecutionModes.IsSupported(request.ExecutionMode)
      || request.ArgumentsJsonUtf8 is null
      || !PayloadDigest.IsSha256Hex(request.ArgumentsSha256)
      || (request.ExpectedPreStateSha256 is not null
        && !PayloadDigest.IsSha256Hex(request.ExpectedPreStateSha256))
      || (request.InputProvenanceSha256 is not null
        && !PayloadDigest.IsSha256Hex(request.InputProvenanceSha256)))
    {
      return "action_request_invalid";
    }

    if (request.LeaseExpiresAt <= (nowUtc ?? DateTimeOffset.UtcNow))
    {
      return "lease_expired";
    }

    if (!Matches(request.ActionId, claims.ActionId)
      || !Matches(request.TaskId, claims.TaskId)
      || !Matches(request.PlanVersionId, claims.PlanVersionId)
      || !Matches(request.StepId, claims.StepId)
      || !Matches(request.DeviceId, claims.DeviceId)
      || !Matches(request.MandateId, claims.MandateId)
      || !Matches(request.CapabilityId, claims.CapabilityId)
      || !Matches(request.CapabilityVersion, claims.CapabilityVersion)
      || !Matches(request.IdempotencyKey, claims.IdempotencyKey)
      || !Matches(request.ExecutionMode, claims.ExecutionMode)
      || request.DispatchCount != claims.DispatchCount)
    {
      return "action_claim_mismatch";
    }

    if (!Matches(request.LeaseId, claims.LeaseId)
      || !Matches(request.FencingToken, claims.FencingToken)
      || request.LeaseExpiresAt.ToUnixTimeSeconds() != claims.LeaseExpiresAtUnixSeconds)
    {
      return "lease_claim_mismatch";
    }

    if (!PayloadDigest.FixedTimeEqualsHex(request.ArgumentsSha256, claims.ArgumentsSha256)
      || !PayloadDigest.FixedTimeEqualsHex(
        request.ArgumentsSha256,
        PayloadDigest.Sha256Hex(request.ArgumentsJsonUtf8)))
    {
      return "arguments_digest_mismatch";
    }

    if (!OptionalDigestMatches(request.ExpectedPreStateSha256, claims.ExpectedPreStateSha256))
    {
      return "pre_state_digest_mismatch";
    }

    if (!OptionalDigestMatches(request.InputProvenanceSha256, claims.InputProvenanceSha256))
    {
      return "provenance_digest_mismatch";
    }

    return null;
  }

  private static bool Matches(string left, string right) =>
    string.Equals(left, right, StringComparison.Ordinal);

  private static bool RequiredRequestValue(string? value) =>
    !string.IsNullOrWhiteSpace(value) && value.Length <= 512;

  private static bool OptionalDigestMatches(string? left, string? right)
  {
    if (left is null || right is null)
    {
      return left is null && right is null;
    }

    return PayloadDigest.IsSha256Hex(left)
      && PayloadDigest.IsSha256Hex(right)
      && PayloadDigest.FixedTimeEqualsHex(left, right);
  }
}

public static class LeaseFenceContract
{
  public static bool IsLive(
    string? leaseId,
    string? fencingToken,
    DateTimeOffset leaseExpiresAt,
    DateTimeOffset nowUtc) =>
    HasValidIdentity(leaseId, fencingToken)
    && leaseExpiresAt != default
    && leaseExpiresAt > nowUtc;

  public static bool HasValidIdentity(string? leaseId, string? fencingToken) =>
    !string.IsNullOrWhiteSpace(leaseId)
    && leaseId.Length <= 160
    && char.IsAsciiLetterOrDigit(leaseId[0])
    && leaseId.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '_' or ':' or '-')
    && IsPositiveInt64Decimal(fencingToken);

  public static bool IsPositiveInt64Decimal(string? value) =>
    value is not null
    && value.Length is >= 1 and <= 19
    && value[0] is >= '1' and <= '9'
    && value.All(character => character is >= '0' and <= '9')
    && long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed)
    && parsed > 0;
}

public static class PayloadDigest
{
  public static string Sha256Hex(string value) =>
    Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

  public static bool FixedTimeEqualsHex(string left, string right)
  {
    try
    {
      var leftBytes = Convert.FromHexString(left);
      var rightBytes = Convert.FromHexString(right);
      return leftBytes.Length == rightBytes.Length
        && CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
    }
    catch (FormatException)
    {
      return false;
    }
  }

  public static bool IsSha256Hex(string? value)
  {
    if (value is null || value.Length != 64)
    {
      return false;
    }

    try
    {
      return Convert.FromHexString(value).Length == 32;
    }
    catch (FormatException)
    {
      return false;
    }
  }
}

internal static class Base64Url
{
  public static byte[] Decode(string value)
  {
    var padded = value.Replace('-', '+').Replace('_', '/');
    padded = (padded.Length % 4) switch
    {
      0 => padded,
      2 => $"{padded}==",
      3 => $"{padded}=",
      _ => throw new FormatException("Invalid Base64Url payload."),
    };

    return Convert.FromBase64String(padded);
  }
}
