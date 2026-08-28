using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class ActionTokenVerifierTests
{
  private static readonly DateTimeOffset Now = new(2026, 8, 25, 10, 0, 0, TimeSpan.Zero);
  private static readonly JsonSerializerOptions WebSerializerOptions =
    new(JsonSerializerDefaults.Web);

  [Fact]
  public async Task ValidTokenBindsTheExactActionRequest()
  {
    using var signingKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var claims = CreateClaims(Now, "{}");
    var verifier = CreateVerifier(signingKey, Now);
    var token = CreateToken(signingKey, claims);

    var verification = await verifier.VerifyAsync(token, CancellationToken.None);

    Assert.True(verification.IsValid);
    Assert.NotNull(verification.Claims);
    Assert.Null(ActionRequestAuthorizer.Validate(CreateRequest("{}", Now), verification.Claims!, Now));
  }

  [Fact]
  public async Task TokenWithoutExecutionModeCannotDefaultUpwardToExecute()
  {
    using var signingKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var payload = JsonSerializer.SerializeToNode(
      CreateClaims(Now, "{}"),
      WebSerializerOptions)!.AsObject();
    payload.Remove("execution_mode");
    var verifier = CreateVerifier(signingKey, Now);

    var verification = await verifier.VerifyAsync(
      CreateToken(signingKey, JsonSerializer.SerializeToUtf8Bytes(payload)),
      CancellationToken.None);

    Assert.False(verification.IsValid);
    Assert.Null(verification.Claims);
    Assert.Equal("token_claims_invalid", verification.ErrorCode);
  }

  [Fact]
  public void RequestAuthorizerBindsExecutionModeExactly()
  {
    var request = CreateRequest("{}", Now) with
    {
      ExecutionMode = ActionExecutionModes.ReplayResultOnly,
    };
    var executeClaims = CreateClaims(Now, "{}");
    var replayClaims = executeClaims with
    {
      ExecutionMode = ActionExecutionModes.ReplayResultOnly,
    };

    Assert.Equal(
      "action_claim_mismatch",
      ActionRequestAuthorizer.Validate(request, executeClaims, Now));
    Assert.Null(ActionRequestAuthorizer.Validate(request, replayClaims, Now));
  }

  [Fact]
  public async Task VerifiedReplayTokenCannotAuthorizeNormalExecutionMode()
  {
    using var signingKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var replayClaims = CreateClaims(Now, "{}") with
    {
      ExecutionMode = ActionExecutionModes.ReplayResultOnly,
    };
    var verification = await CreateVerifier(signingKey, Now).VerifyAsync(
      CreateToken(signingKey, replayClaims),
      CancellationToken.None);

    Assert.True(verification.IsValid);
    Assert.Equal(
      "action_claim_mismatch",
      ActionRequestAuthorizer.Validate(CreateRequest("{}", Now), verification.Claims!, Now));
    Assert.Null(ActionRequestAuthorizer.Validate(
      CreateRequest("{}", Now) with
      {
        ExecutionMode = ActionExecutionModes.ReplayResultOnly,
      },
      verification.Claims!,
      Now));
  }

  [Fact]
  public async Task TamperedArgumentsAreRejectedAfterSignatureVerification()
  {
    using var signingKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var claims = CreateClaims(Now, "{}");
    var verifier = CreateVerifier(signingKey, Now);
    var verification = await verifier.VerifyAsync(
      CreateToken(signingKey, claims),
      CancellationToken.None);
    var tampered = CreateRequest("{\"unexpected\":true}", Now) with
    {
      ArgumentsSha256 = claims.ArgumentsSha256,
    };

    var error = ActionRequestAuthorizer.Validate(tampered, verification.Claims!, Now);

    Assert.Equal("arguments_digest_mismatch", error);
  }

  [Fact]
  public async Task ExpiredTokenIsRejected()
  {
    using var signingKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var claims = CreateClaims(Now.AddMinutes(-10), "{}") with
    {
      ExpiresAtUnixSeconds = Now.AddMinutes(-5).ToUnixTimeSeconds(),
    };
    var verifier = CreateVerifier(signingKey, Now);

    var verification = await verifier.VerifyAsync(
      CreateToken(signingKey, claims),
      CancellationToken.None);

    Assert.False(verification.IsValid);
    Assert.Equal("token_time_invalid", verification.ErrorCode);
  }

  [Fact]
  public async Task UnknownSigningKeyIsRejected()
  {
    using var signingKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var settings = CreateSettings();
    var verifier = new Es256ActionTokenVerifier(
      settings,
      new DetachedKeyResolver("different-key", signingKey),
      new FixedTimeProvider(Now));

    var verification = await verifier.VerifyAsync(
      CreateToken(signingKey, CreateClaims(Now, "{}")),
      CancellationToken.None);

    Assert.False(verification.IsValid);
    Assert.Equal("token_key_untrusted", verification.ErrorCode);
  }

  [Fact]
  public async Task BrokerDeliveryBudgetFieldsAreRequiredByTheSignedContract()
  {
    using var signingKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var payload = JsonSerializer.SerializeToNode(
      CreateClaims(Now, "{}"),
      WebSerializerOptions)!.AsObject();
    payload["budgets"]!.AsObject().Remove("brokerMaxDeliverySessions");
    var verifier = CreateVerifier(signingKey, Now);

    var verification = await verifier.VerifyAsync(
      CreateToken(signingKey, JsonSerializer.SerializeToUtf8Bytes(payload)),
      CancellationToken.None);

    Assert.False(verification.IsValid);
    Assert.Equal("token_budgets_not_strict", verification.ErrorCode);
  }

  [Fact]
  public async Task LeaseClaimsAreRequiredAndMustRemainLiveForTheWholeToken()
  {
    using var signingKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var verifier = CreateVerifier(signingKey, Now);
    var missing = JsonSerializer.SerializeToNode(
      CreateClaims(Now, "{}"),
      WebSerializerOptions)!.AsObject();
    missing.Remove("lease_id");

    var missingVerification = await verifier.VerifyAsync(
      CreateToken(signingKey, JsonSerializer.SerializeToUtf8Bytes(missing)),
      CancellationToken.None);
    var malformedVerification = await verifier.VerifyAsync(
      CreateToken(signingKey, CreateClaims(Now, "{}") with { FencingToken = "01" }),
      CancellationToken.None);
    var malformedLeaseIdVerification = await verifier.VerifyAsync(
      CreateToken(signingKey, CreateClaims(Now, "{}") with { LeaseId = ":lease-1" }),
      CancellationToken.None);
    var outOfRangeFenceVerification = await verifier.VerifyAsync(
      CreateToken(signingKey, CreateClaims(Now, "{}") with
      {
        FencingToken = "9223372036854775808",
      }),
      CancellationToken.None);
    var expiredVerification = await verifier.VerifyAsync(
      CreateToken(signingKey, CreateClaims(Now, "{}") with
      {
        LeaseExpiresAtUnixSeconds = Now.ToUnixTimeSeconds(),
      }),
      CancellationToken.None);
    var outlivesLeaseVerification = await verifier.VerifyAsync(
      CreateToken(signingKey, CreateClaims(Now, "{}") with
      {
        LeaseExpiresAtUnixSeconds = Now.AddMinutes(1).ToUnixTimeSeconds(),
      }),
      CancellationToken.None);

    Assert.Equal("token_claims_invalid", missingVerification.ErrorCode);
    Assert.Equal("token_claims_invalid", malformedVerification.ErrorCode);
    Assert.Equal("token_claims_invalid", malformedLeaseIdVerification.ErrorCode);
    Assert.Equal("token_claims_invalid", outOfRangeFenceVerification.ErrorCode);
    Assert.Equal("token_lease_invalid", expiredVerification.ErrorCode);
    Assert.Equal("token_lease_invalid", outlivesLeaseVerification.ErrorCode);
  }

  [Fact]
  public async Task SignedClaimsRejectMalformedRequiredAndOptionalDigests()
  {
    using var signingKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var verifier = CreateVerifier(signingKey, Now);

    foreach (var claims in new[]
    {
      CreateClaims(Now, "{}") with { ArgumentsSha256 = "abcd" },
      CreateClaims(Now, "{}") with { ExpectedPreStateSha256 = "not-a-digest" },
      CreateClaims(Now, "{}") with { InputProvenanceSha256 = new string('0', 63) },
    })
    {
      var verification = await verifier.VerifyAsync(
        CreateToken(signingKey, claims),
        CancellationToken.None);

      Assert.False(verification.IsValid);
      Assert.Equal("token_claims_invalid", verification.ErrorCode);
    }
  }

  [Fact]
  public void RequestAuthorizerRejectsMatchingButMalformedOptionalDigests()
  {
    var claims = CreateClaims(Now, "{}") with { ExpectedPreStateSha256 = "abcd" };
    var request = CreateRequest("{}", Now) with { ExpectedPreStateSha256 = "abcd" };

    Assert.Equal("action_request_invalid", ActionRequestAuthorizer.Validate(request, claims, Now));
  }

  [Fact]
  public void RequestAuthorizerBindsTheSignedDispatchGeneration()
  {
    var claims = CreateClaims(Now, "{}") with { DispatchCount = 2 };
    var request = CreateRequest("{}", Now) with { DispatchCount = 1 };

    Assert.Equal("action_claim_mismatch", ActionRequestAuthorizer.Validate(request, claims, Now));
    Assert.Null(ActionRequestAuthorizer.Validate(request with { DispatchCount = 2 }, claims, Now));
  }

  [Fact]
  public void RequestAuthorizerRejectsMissingExpiredAndMismatchedLeaseFences()
  {
    var claims = CreateClaims(Now, "{}");
    var request = CreateRequest("{}", Now);

    Assert.Equal(
      "action_request_invalid",
      ActionRequestAuthorizer.Validate(request with { LeaseId = "" }, claims, Now));
    Assert.Equal(
      "lease_expired",
      ActionRequestAuthorizer.Validate(
        request with { LeaseExpiresAt = Now.AddSeconds(-1) },
        claims,
        Now));
    Assert.Equal(
      "lease_claim_mismatch",
      ActionRequestAuthorizer.Validate(request with { LeaseId = "lease-2" }, claims, Now));
    Assert.Equal(
      "lease_claim_mismatch",
      ActionRequestAuthorizer.Validate(request with { FencingToken = "8" }, claims, Now));
    Assert.Equal(
      "lease_claim_mismatch",
      ActionRequestAuthorizer.Validate(
        request with { LeaseExpiresAt = request.LeaseExpiresAt.AddSeconds(1) },
        claims,
        Now));
  }

  [Fact]
  public async Task SignedDispatchGenerationCannotExceedTheDeliverySessionCeiling()
  {
    using var signingKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var claims = CreateClaims(Now, "{}") with { DispatchCount = 4 };

    var verification = await CreateVerifier(signingKey, Now).VerifyAsync(
      CreateToken(signingKey, claims),
      CancellationToken.None);

    Assert.False(verification.IsValid);
    Assert.Equal("token_claims_invalid", verification.ErrorCode);
  }

  private static Es256ActionTokenVerifier CreateVerifier(ECDsa signingKey, DateTimeOffset now) =>
    new(
      CreateSettings(),
      new DetachedKeyResolver("test-key", signingKey),
      new FixedTimeProvider(now));

  private static ActionTokenVerificationSettings CreateSettings() => new(
    "itemba-msaidizi-broker",
    "itemba-windows-companion",
    "msaidizi-global",
    TimeSpan.FromSeconds(30),
    TimeSpan.FromMinutes(5));

  internal static ActionTokenClaims CreateClaims(DateTimeOffset now, string argumentsJson) => new()
  {
    Issuer = "itemba-msaidizi-broker",
    Audience = "itemba-windows-companion",
    Subject = "msaidizi-global",
    TokenId = "token-1",
    ActionId = "action-1",
    TaskId = "task-1",
    PlanVersionId = "plan-version-1",
    StepId = "step-1",
    DeviceId = "device-1",
    MandateId = "mandate-1",
    CapabilityId = "companion.noop",
    CapabilityVersion = "1.0.0",
    ArgumentsSha256 = PayloadDigest.Sha256Hex(argumentsJson),
    ExpectedPreStateSha256 = null,
    InputProvenanceSha256 = null,
    IdempotencyKey = "idempotency-1",
    LeaseId = "lease-1",
    FencingToken = "7",
    LeaseExpiresAtUnixSeconds = now.AddMinutes(3).ToUnixTimeSeconds(),
    Budgets = new ActionBudget(7_200, 200, 500, 100, 5_368_709_120, 262_144_000, 20m),
    DispatchCount = 1,
    ExecutionMode = ActionExecutionModes.Execute,
    IssuedAtUnixSeconds = now.ToUnixTimeSeconds(),
    ExpiresAtUnixSeconds = now.AddMinutes(2).ToUnixTimeSeconds(),
  };

  internal static ActionRequest CreateRequest(
    string argumentsJson,
    DateTimeOffset? issuedAt = null) => new(
    ActionId: "action-1",
    TaskId: "task-1",
    PlanVersionId: "plan-version-1",
    StepId: "step-1",
    DeviceId: "device-1",
    MandateId: "mandate-1",
    CapabilityId: "companion.noop",
    CapabilityVersion: "1.0.0",
    ArgumentsJsonUtf8: argumentsJson,
    ArgumentsSha256: PayloadDigest.Sha256Hex(argumentsJson),
    ExpectedPreStateSha256: null,
    InputProvenanceSha256: null,
    IdempotencyKey: "idempotency-1",
    LeaseId: "lease-1",
    FencingToken: "7",
    LeaseExpiresAt: (issuedAt ?? DateTimeOffset.UtcNow).AddMinutes(3));

  private static string CreateToken(ECDsa signingKey, ActionTokenClaims claims)
    => CreateToken(
      signingKey,
      JsonSerializer.SerializeToUtf8Bytes(claims, WebSerializerOptions));

  private static string CreateToken(ECDsa signingKey, byte[] payloadBytes)
  {
    var header = Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(new
    {
      alg = "ES256",
      kid = "test-key",
      typ = "at+jwt",
    }));
    var payload = Base64UrlEncode(payloadBytes);
    var signedBytes = Encoding.ASCII.GetBytes($"{header}.{payload}");
    var signature = signingKey.SignData(
      signedBytes,
      HashAlgorithmName.SHA256,
      DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
    return $"{header}.{payload}.{Base64UrlEncode(signature)}";
  }

  private static string Base64UrlEncode(byte[] value) =>
    Convert.ToBase64String(value)
      .TrimEnd('=')
      .Replace('+', '-')
      .Replace('/', '_');

  private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
  {
    public override DateTimeOffset GetUtcNow() => now;
  }

  private sealed class DetachedKeyResolver : IActionVerificationKeyResolver
  {
    private readonly string _keyId;
    private readonly byte[] _subjectPublicKeyInfo;

    public DetachedKeyResolver(string keyId, ECDsa key)
    {
      _keyId = keyId;
      _subjectPublicKeyInfo = key.ExportSubjectPublicKeyInfo();
    }

    public bool TryResolve(string keyId, out ECDsa? publicKey)
    {
      publicKey = null;
      if (!string.Equals(_keyId, keyId, StringComparison.Ordinal))
      {
        return false;
      }

      publicKey = ECDsa.Create();
      publicKey.ImportSubjectPublicKeyInfo(_subjectPublicKeyInfo, out _);
      return true;
    }
  }
}
