using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class FenceTokenVerifierTests
{
  private static readonly DateTimeOffset Now =
    new(2026, 8, 27, 10, 0, 0, TimeSpan.Zero);
  private static readonly JsonSerializerOptions WebJson =
    new(JsonSerializerDefaults.Web);

  [Fact]
  public async Task ValidEs256FenceJwtAuthorizesOnlyTheExactFenceRequest()
  {
    using var signingKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var request = CreateRequest();
    var verification = await CreateVerifier(signingKey).VerifyAsync(
      CreateToken(signingKey, CreateClaims(request)),
      CancellationToken.None);

    Assert.True(verification.IsValid);
    var claims = Assert.IsType<FenceTokenClaims>(verification.Claims);
    Assert.Null(FenceActionRequestAuthorizer.Validate(request, claims, Now));

    var mismatches = new[]
    {
      request with { FenceId = "fence-2" },
      request with { DeviceId = "device-2" },
      request with { ActionId = "action-2" },
      request with { TaskId = "task-2" },
      request with { StepId = "step-2" },
      request with { OldLeaseId = "lease-2" },
      request with { OldFencingToken = "8" },
      request with { OldActionTokenSha256 = PayloadDigest.Sha256Hex("other-action-token") },
      request with { JournalPreviousSequence = request.JournalPreviousSequence + 1 },
      request with { JournalPreviousHash = PayloadDigest.Sha256Hex("other-journal-head") },
      request with { DispatchCount = request.DispatchCount + 1 },
      request with { ExpiresAt = request.ExpiresAt.AddSeconds(1) },
    };

    Assert.All(mismatches, mismatch => Assert.Equal(
      "fence_claim_mismatch",
      FenceActionRequestAuthorizer.Validate(mismatch, claims, Now)));
  }

  [Fact]
  public async Task VerifierRejectsWrongTypeAlgorithmAndNonStrictHeaders()
  {
    using var signingKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var payload = JsonSerializer.SerializeToUtf8Bytes(
      CreateClaims(CreateRequest()),
      WebJson);
    var verifier = CreateVerifier(signingKey);
    var invalidHeaders = new[]
    {
      "{\"alg\":\"ES256\",\"kid\":\"test-key\",\"typ\":\"at+jwt\"}",
      "{\"alg\":\"ES384\",\"kid\":\"test-key\",\"typ\":\"fence+jwt\"}",
      "{\"alg\":\"ES256\",\"kid\":\"test-key\",\"typ\":\"fence+jwt\",\"cty\":\"JWT\"}",
      "{\"alg\":\"ES256\",\"kid\":\"test-key\",\"typ\":\"fence+jwt\",\"typ\":\"fence+jwt\"}",
    };

    foreach (var header in invalidHeaders)
    {
      var verification = await verifier.VerifyAsync(
        CreateToken(signingKey, Encoding.UTF8.GetBytes(header), payload),
        CancellationToken.None);

      Assert.False(verification.IsValid);
      Assert.Equal("fence_token_header_invalid", verification.ErrorCode);
    }
  }

  [Fact]
  public async Task VerifierRequiresAnExactClosedFenceClaimSet()
  {
    using var signingKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var claims = JsonSerializer.SerializeToNode(
      CreateClaims(CreateRequest()),
      WebJson)!.AsObject();
    var missing = (JsonObject)claims.DeepClone();
    missing.Remove("old_action_token_sha256");
    var extended = (JsonObject)claims.DeepClone();
    extended["execution_mode"] = ActionExecutionModes.Execute;
    var verifier = CreateVerifier(signingKey);

    foreach (var payload in new[] { missing, extended })
    {
      var verification = await verifier.VerifyAsync(
        CreateToken(signingKey, JsonSerializer.SerializeToUtf8Bytes(payload, WebJson)),
        CancellationToken.None);

      Assert.False(verification.IsValid);
      Assert.Equal("fence_token_claims_not_strict", verification.ErrorCode);
    }
  }

  [Fact]
  public async Task VerifierRejectsAValidlyShapedTokenWithTheWrongEs256Signature()
  {
    using var trustedKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    using var attackerKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var token = CreateToken(attackerKey, CreateClaims(CreateRequest()));

    var verification = await CreateVerifier(trustedKey).VerifyAsync(
      token,
      CancellationToken.None);

    Assert.False(verification.IsValid);
    Assert.Equal("fence_token_signature_invalid", verification.ErrorCode);
  }

  private static Es256FenceTokenVerifier CreateVerifier(ECDsa signingKey) => new(
    new ActionTokenVerificationSettings(
      "itemba-msaidizi-broker",
      "itemba-windows-companion",
      "msaidizi-global",
      TimeSpan.FromSeconds(30),
      TimeSpan.FromMinutes(5)),
    new DetachedKeyResolver("test-key", signingKey),
    new FixedTimeProvider(Now));

  internal static FenceActionRequest CreateRequest(
    string fenceId = "fence-1",
    string oldFencingToken = "7",
    long journalPreviousSequence = 11,
    string? journalPreviousHash = null,
    int dispatchCount = 2) => new(
      FenceId: fenceId,
      DeviceId: "device-1",
      ActionId: "action-1",
      TaskId: "task-1",
      StepId: "step-1",
      OldLeaseId: "lease-1",
      OldFencingToken: oldFencingToken,
      OldActionTokenSha256: PayloadDigest.Sha256Hex("old-action-token"),
      JournalPreviousSequence: journalPreviousSequence,
      JournalPreviousHash: journalPreviousHash ?? PayloadDigest.Sha256Hex("journal-head"),
      DispatchCount: dispatchCount,
      ExpiresAt: Now.AddMinutes(2));

  internal static FenceTokenClaims CreateClaims(FenceActionRequest request) => new()
  {
    Issuer = "itemba-msaidizi-broker",
    Audience = "itemba-windows-companion",
    Subject = "msaidizi-global",
    TokenId = request.FenceId,
    CommandType = "FENCE_ACTION",
    FenceId = request.FenceId,
    DeviceId = request.DeviceId,
    ActionId = request.ActionId,
    TaskId = request.TaskId,
    StepId = request.StepId,
    OldLeaseId = request.OldLeaseId,
    OldFencingToken = request.OldFencingToken,
    OldActionTokenSha256 = request.OldActionTokenSha256,
    JournalPreviousSequence = request.JournalPreviousSequence,
    JournalPreviousHash = request.JournalPreviousHash,
    DispatchCount = request.DispatchCount,
    IssuedAtUnixSeconds = Now.ToUnixTimeSeconds(),
    ExpiresAtUnixSeconds = request.ExpiresAt.ToUnixTimeSeconds(),
  };

  private static string CreateToken(ECDsa signingKey, FenceTokenClaims claims) =>
    CreateToken(
      signingKey,
      Encoding.UTF8.GetBytes(
        "{\"alg\":\"ES256\",\"kid\":\"test-key\",\"typ\":\"fence+jwt\"}"),
      JsonSerializer.SerializeToUtf8Bytes(claims, WebJson));

  private static string CreateToken(ECDsa signingKey, byte[] payload) =>
    CreateToken(
      signingKey,
      Encoding.UTF8.GetBytes(
        "{\"alg\":\"ES256\",\"kid\":\"test-key\",\"typ\":\"fence+jwt\"}"),
      payload);

  private static string CreateToken(ECDsa signingKey, byte[] header, byte[] payload)
  {
    var encodedHeader = Base64UrlEncode(header);
    var encodedPayload = Base64UrlEncode(payload);
    var signedBytes = Encoding.ASCII.GetBytes($"{encodedHeader}.{encodedPayload}");
    var signature = signingKey.SignData(
      signedBytes,
      HashAlgorithmName.SHA256,
      DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
    return $"{encodedHeader}.{encodedPayload}.{Base64UrlEncode(signature)}";
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
