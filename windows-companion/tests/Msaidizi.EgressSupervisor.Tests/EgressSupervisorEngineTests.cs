using System.Net;
using System.Diagnostics;
using System.Net.Security;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Contracts.SessionBridge;
using Itemba.Msaidizi.EgressSupervisor;
using Itemba.Msaidizi.EgressSupervisor.Core;
using Itemba.Msaidizi.EgressSupervisor.Persistence;
using Itemba.Msaidizi.EgressSupervisor.Security;
using Itemba.Msaidizi.EgressSupervisor.Transport;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Win32.SafeHandles;
using Xunit;

namespace Itemba.Msaidizi.EgressSupervisor.Tests;

public sealed partial class EgressSupervisorEngineTests : IDisposable
{
  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    "itemba-egress-supervisor-tests",
    Guid.NewGuid().ToString("N"));

  public EgressSupervisorEngineTests() => Directory.CreateDirectory(_directory);

  [Fact]
  public async Task DirectLifecycleBindsExactHashesAndProducesValidV2Receipt()
  {
    using var fixture = CreateFixture();
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var authorization = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    Assert.Equal(1_024, authorization.Lease.Lease.ReservedCapabilityEgressBytes);
    Assert.Equal(3_072, fixture.TokenVerifier.Claims.Budgets.MaxExternalEgressBytes);
    var registration = fixture.CreateRegistration(authorization);
    var acknowledgement = await fixture.Engine.RegisterDirectAsync(
      new EgressDirectRegistrationRequestPayload(EgressSupervisorLifecycleContract.Version, authorization, registration),
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    var flow = await fixture.Engine.BeginDirectFlowAsync(
      fixture.CreateFlowRequest(authorization, registration),
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    await fixture.AttestRouteAsync(flow);
    await fixture.AttestRouteAsync(flow);
    await fixture.Engine.CompleteDirectFlowAsync(
      flow,
      123,
      measurementUncertain: false,
      new string('d', 64),
      CancellationToken.None);
    var disposition = fixture.CreateDisposition(
      EgressSupervisorLifecycleContract.Completed,
      123,
      uncertain: false);
    var receipt = await fixture.Engine.TerminalAsync(
      new EgressTerminalRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        acknowledgement,
        disposition),
      abort: false,
      CancellationToken.None);

    Assert.Equal(EgressBoundaryCanonical.ContractVersion, receipt.Receipt.ContractVersion);
    Assert.Equal(
      EgressSupervisorLifecycleCanonical.RegistrationSha256(registration),
      receipt.Receipt.RegistrationSha256);
    Assert.Equal(
      EgressSupervisorLifecycleCanonical.DispositionSha256(disposition),
      receipt.Receipt.DispositionSha256);
    Assert.Equal(123, receipt.Receipt.MeasuredExternalEgressBytes);
    Assert.Equal(0, receipt.Receipt.UncertainExternalEgressBytes);
    Assert.Equal(123, receipt.Receipt.ChargedExternalEgressBytes);
    Assert.Equal(EgressSupervisorLifecycleContract.Completed, receipt.Receipt.Outcome);
    Assert.Equal(
      authorization.Lease.Lease.ReservationDnsAnswerSetSha256,
      receipt.Receipt.ReservationDnsAnswerSetSha256);
    Assert.Equal(
      receipt.Receipt.ReservationDnsAnswerSetSha256,
      receipt.Receipt.ConnectionDnsAnswerSetSha256);
    Assert.Equal(new string('9', 64), receipt.Receipt.SelectedAddressSha256);
    Assert.Equal(fixture.SigningKeys.ReceiptKeyId, receipt.KeyId);

    var verifier = new EgressBoundaryContractVerifier(
      EgressBoundaryVerificationSettings.Strict(fixture.DeviceId),
      fixture.SigningKeys,
      fixture.Time);
    var verified = verifier.VerifyReceipt(
      new EgressExecutionEvidence(authorization, receipt),
      fixture.Binding,
      EgressBoundaryFeatures.CommandRequired);
    Assert.True(verified.IsValid, verified.ErrorCode);
  }

  [Fact]
  public async Task FlowNonceIsOneTimeAndWrongPreimageDoesNotConsumeIt()
  {
    using var fixture = CreateFixture();
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var authorization = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    var registration = fixture.CreateRegistration(authorization);
    await fixture.Engine.RegisterDirectAsync(
      new EgressDirectRegistrationRequestPayload(EgressSupervisorLifecycleContract.Version, authorization, registration),
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);

    var wrong = fixture.CreateFlowRequest(authorization, registration) with
    {
      ConnectionNonceBase64 = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
    };
    var rejected = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.BeginDirectFlowAsync(
        wrong,
        fixture.ProcessId,
        fixture.ProcessCreationTime,
        CancellationToken.None).AsTask());
    Assert.Equal("egress_flow_binding_invalid", rejected.Code);

    var flow = await fixture.Engine.BeginDirectFlowAsync(
      fixture.CreateFlowRequest(authorization, registration),
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    var replay = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.BeginDirectFlowAsync(
        fixture.CreateFlowRequest(authorization, registration),
        fixture.ProcessId,
        fixture.ProcessCreationTime,
        CancellationToken.None).AsTask());
    Assert.Equal("egress_flow_binding_invalid", replay.Code);
    await fixture.AttestRouteAsync(flow);
    await fixture.Engine.CompleteDirectFlowAsync(
      flow,
      0,
      false,
      new string('e', 64),
      CancellationToken.None);
  }

  [Fact]
  public async Task SignedArgumentsAndAuthenticatedProcessCreationCannotBeSubstituted()
  {
    using var fixture = CreateFixture();
    await fixture.Engine.InitializeAsync(CancellationToken.None);

    var alteredArguments = fixture.Reservation with
    {
      ArgumentsJsonUtf8 = fixture.Reservation.ArgumentsJsonUtf8.Replace(
        "recipient@example.test",
        "attacker@example.test",
        StringComparison.Ordinal),
    };
    var argumentFailure = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.ReserveAsync(alteredArguments, CancellationToken.None).AsTask());
    Assert.Equal("egress_action_binding_invalid", argumentFailure.Code);

    var authorization = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    var registration = fixture.CreateRegistration(authorization);
    var creationFailure = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.RegisterDirectAsync(
        new EgressDirectRegistrationRequestPayload(EgressSupervisorLifecycleContract.Version, authorization, registration),
        fixture.ProcessId,
        fixture.ProcessCreationTime + 1,
        CancellationToken.None).AsTask());
    Assert.Equal("egress_direct_registration_invalid", creationFailure.Code);

    _ = await fixture.Engine.RegisterDirectAsync(
      new EgressDirectRegistrationRequestPayload(EgressSupervisorLifecycleContract.Version, authorization, registration),
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    var flowFailure = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.BeginDirectFlowAsync(
        fixture.CreateFlowRequest(authorization, registration),
        fixture.ProcessId,
        fixture.ProcessCreationTime + 1,
        CancellationToken.None).AsTask());
    Assert.Equal("egress_flow_binding_invalid", flowFailure.Code);
  }

  [Fact]
  public async Task SignedDynamicDestinationCannotBeSubstitutedAfterPlanning()
  {
    var resolver = new SequencedDestinationResolver(
      [new ResolvedPublicDestination([IPAddress.Parse("8.8.8.8")])]);
    using var fixture = CreateFixture(
      dynamicDestination: true,
      destinationResolver: resolver);
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var substituted = fixture.Reservation with
    {
      ArgumentsJsonUtf8 = fixture.Reservation.ArgumentsJsonUtf8.Replace(
        "https://api.itemba.com/v1/email/send",
        "https://api.itemba.com/v1/attacker",
        StringComparison.Ordinal),
    };

    var failure = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.ReserveAsync(substituted, CancellationToken.None).AsTask());

    Assert.Equal("egress_action_binding_invalid", failure.Code);
    Assert.Empty(resolver.Hosts);
  }

  [Theory]
  [InlineData("action-token")]
  [InlineData("action")]
  [InlineData("task")]
  [InlineData("plan")]
  [InlineData("step")]
  [InlineData("device")]
  [InlineData("mandate")]
  [InlineData("capability")]
  [InlineData("capability-version")]
  [InlineData("dispatch")]
  [InlineData("egress-budget")]
  [InlineData("arguments")]
  [InlineData("pre-state")]
  [InlineData("idempotency")]
  public async Task EverySignedActionBindingSubstitutionIsRejected(string field)
  {
    using var fixture = CreateFixture();
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var binding = field switch
    {
      "action-token" => fixture.Binding with { ActionTokenSha256 = new string('1', 64) },
      "action" => fixture.Binding with
      {
        ActionId = "12222222-2222-4222-8222-222222222222",
      },
      "task" => fixture.Binding with
      {
        TaskId = "13333333-3333-4333-8333-333333333333",
      },
      "plan" => fixture.Binding with
      {
        PlanVersionId = "14444444-4444-4444-8444-444444444444",
      },
      "step" => fixture.Binding with
      {
        StepId = "15555555-5555-4555-8555-555555555555",
      },
      "device" => fixture.Binding with
      {
        DeviceId = "11111111-1111-4111-8111-111111111112",
      },
      "mandate" => fixture.Binding with
      {
        MandateId = "16666666-6666-4666-8666-666666666666",
      },
      "capability" => fixture.Binding with { CapabilityId = "external.message.send" },
      "capability-version" => fixture.Binding with { CapabilityVersion = "1.0.1" },
      "dispatch" => fixture.Binding with { DispatchCount = 2 },
      "egress-budget" => fixture.Binding with { ReservedCapabilityEgressBytes = 1_025 },
      "arguments" => fixture.Binding with { ArgumentsSha256 = new string('6', 64) },
      "pre-state" => fixture.Binding with { ExpectedPreStateSha256 = new string('7', 64) },
      "idempotency" => fixture.Binding with { IdempotencyKeySha256 = new string('8', 64) },
      _ => throw new ArgumentOutOfRangeException(nameof(field)),
    };
    var request = fixture.Reservation with
    {
      OperationId = EgressSupervisorLifecycleCanonical.OperationId(
        binding.ActionId,
        "reserve"),
      Binding = binding,
    };

    var exception = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.ReserveAsync(request, CancellationToken.None).AsTask());

    Assert.Equal("egress_action_binding_invalid", exception.Code);
  }

  [Fact]
  public async Task ReplayOnlyTokenCannotAuthorizeARealExternalFlow()
  {
    using var fixture = CreateFixture();
    fixture.TokenVerifier.Claims = fixture.TokenVerifier.Claims with
    {
      ExecutionMode = ActionExecutionModes.ReplayResultOnly,
    };
    await fixture.Engine.InitializeAsync(CancellationToken.None);

    var exception = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.ReserveAsync(
        fixture.Reservation,
        CancellationToken.None).AsTask());

    Assert.Equal("egress_action_binding_invalid", exception.Code);
  }

  [Theory]
  [InlineData("maximum-external-egress")]
  [InlineData("delivery-sessions")]
  [InlineData("attempts-per-session")]
  [InlineData("serialized-result-bound")]
  [InlineData("capability-residual")]
  public async Task BrokerReservationInputsAndResidualAreBoundExactly(string field)
  {
    using var fixture = CreateFixture();
    var original = fixture.TokenVerifier.Claims.Budgets;
    if (field == "capability-residual")
    {
      fixture.Reservation = fixture.Reservation with
      {
        Binding = fixture.Binding with { ReservedCapabilityEgressBytes = 1_025 },
      };
    }
    else
    {
      fixture.TokenVerifier.Claims = fixture.TokenVerifier.Claims with
      {
        Budgets = field switch
        {
          "maximum-external-egress" => original with
          {
            MaxExternalEgressBytes = original.MaxExternalEgressBytes + 1,
          },
          "delivery-sessions" => original with
          {
            BrokerMaxDeliverySessions = original.BrokerMaxDeliverySessions + 1,
          },
          "attempts-per-session" => original with
          {
            BrokerMaxRequestAttemptsPerSession =
              original.BrokerMaxRequestAttemptsPerSession + 1,
          },
          "serialized-result-bound" => original with
          {
            BrokerSerializedResultUpperBoundBytes =
              original.BrokerSerializedResultUpperBoundBytes + 1,
          },
          _ => throw new ArgumentOutOfRangeException(nameof(field)),
        },
      };
    }
    await fixture.Engine.InitializeAsync(CancellationToken.None);

    var exception = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.ReserveAsync(
        fixture.Reservation,
        CancellationToken.None).AsTask());

    Assert.Equal("egress_action_binding_invalid", exception.Code);
  }

  [Theory]
  [InlineData("host")]
  [InlineData("port")]
  [InlineData("path")]
  [InlineData("certificate-pin")]
  [InlineData("scope")]
  [InlineData("body")]
  [InlineData("policy")]
  [InlineData("credential-record")]
  public async Task EveryExactFlowSubstitutionIsRejected(string field)
  {
    using var fixture = CreateFixture();
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var authorization = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    var registration = fixture.CreateRegistration(authorization);
    _ = await fixture.Engine.RegisterDirectAsync(
      new EgressDirectRegistrationRequestPayload(EgressSupervisorLifecycleContract.Version, authorization, registration),
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    var request = fixture.CreateFlowRequest(authorization, registration);
    if (field == "host")
    {
      request = request with { DestinationHost = "attacker.example.test" };
    }
    else if (field == "port")
    {
      request = request with { DestinationPort = 444 };
    }
    else if (field == "scope")
    {
      request = request with { DestinationScopeSha256 = new string('1', 64) };
    }
    else
    {
      // Path and certificate changes alter destination scope. Credential-file
      // substitutions alter the exact-request policy without changing scope.
      // Body and whole-policy changes have independent signed lease fields.
      var lease = authorization.Lease.Lease;
      var credentialReferenceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      var alteredCredentialEntry = new EgressDestinationPolicyEntryV1(
        "email-test",
        "external.email.send",
        "api.example.test",
        443,
        "/v1/email/send",
        new string('b', 64),
        credentialReferenceId,
        new string('1', 64),
        "Bearer ",
        lease.DestinationScopeSha256);
      var alteredLease = field switch
      {
        "path" => lease with
        {
          DestinationScopeSha256 = EgressExternalActionCanonical.DestinationScopeSha256(
            "external.email.send",
            "email-test",
            "https://api.example.test/v1/email/other",
            new string('b', 64),
            credentialReferenceId,
            "Bearer "),
        },
        "certificate-pin" => lease with
        {
          DestinationScopeSha256 = EgressExternalActionCanonical.DestinationScopeSha256(
            "external.email.send",
            "email-test",
            "https://api.example.test/v1/email/send",
            new string('1', 64),
            credentialReferenceId,
            "Bearer "),
        },
        "body" => lease with { RequestBodySha256 = Sha256("altered body") },
        "policy" => lease with { DestinationPolicySha256 = Sha256("altered policy") },
        "credential-record" => lease with
        {
          ExactRequestPolicySha256 = EgressDestinationPolicy.ExactRequestPolicySha256(
            alteredCredentialEntry,
            lease.ArgumentsSha256,
            lease.ExpectedPreStateSha256!,
            lease.IdempotencyKeySha256,
            lease.RequestBodySha256),
        },
        _ => throw new ArgumentOutOfRangeException(nameof(field)),
      };
      request = request with
      {
        LeaseSha256 = EgressBoundaryCanonical.LeaseSha256(alteredLease),
      };
    }

    var exception = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.BeginDirectFlowAsync(
        request,
        fixture.ProcessId,
        fixture.ProcessCreationTime,
        CancellationToken.None).AsTask());

    Assert.Equal("egress_flow_binding_invalid", exception.Code);
  }

  [Fact]
  public void ExactHttpTemplateRejectsPlaintextAndDestinationSubstitution()
  {
    var body =
      "{\"kind\":\"email\",\"to\":[\"recipient@example.test\"],\"cc\":[],\"subject\":\"Subject\",\"text\":\"Body\"}";
    var bodySha256 = Sha256(body);
    const string idempotencyKey = "exact-idempotency-key";
    var flow = new EgressFlowAuthorization(
      Guid.NewGuid().ToString("D"),
      new string('1', 64),
      "22222222-2222-4222-8222-222222222222",
      "external.email.send",
      "api.example.test",
      443,
      "/v1/email/send",
      new string('2', 64),
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      new string('3', 64),
      "Bearer ",
      new string('4', 64),
      bodySha256,
      new string('5', 64),
      PayloadDigest.Sha256Hex(idempotencyKey),
      new string('6', 64),
      new string('7', 64),
      100_000,
      DateTimeOffset.UtcNow.AddMinutes(1).ToUnixTimeMilliseconds());
    var request = Encoding.ASCII.GetBytes(string.Join("\r\n",
      "POST /v1/email/send HTTP/1.1",
      "Host: api.example.test",
      "Content-Type: application/json; charset=utf-8",
      $"Content-Length: {Encoding.UTF8.GetByteCount(body)}",
      "User-Agent: Itemba-Msaidizi-Companion/1.0",
      $"Idempotency-Key: {idempotencyKey}",
      $"X-Itemba-Action-Id: {flow.ActionId}",
      $"X-Itemba-Request-Sha256: {bodySha256}",
      $"X-Itemba-Expected-Pre-State-Sha256: {flow.ExpectedPreStateSha256}",
      "Connection: close",
      $"Authorization-Reference: {flow.CredentialReferenceId}",
      string.Empty,
      body));
    Assert.True(EgressExactHttpRequestValidator.IsAuthorized(flow, request));

    Assert.False(EgressExactHttpRequestValidator.IsAuthorized(
      flow,
      ReplaceAscii(request, "/v1/email/send", "/v1/email/other")));
    Assert.False(EgressExactHttpRequestValidator.IsAuthorized(
      flow,
      ReplaceAscii(request, "Host: api.example.test", "Host: evil.example.test")));
    Assert.False(EgressExactHttpRequestValidator.IsAuthorized(
      flow with { DestinationPort = 444 },
      request));
    Assert.False(EgressExactHttpRequestValidator.IsAuthorized(
      flow,
      ReplaceAscii(request, "recipient@example.test", "attacker@example.test")));
    Assert.False(EgressExactHttpRequestValidator.IsAuthorized(
      flow,
      ReplaceAscii(
        request,
        flow.CredentialReferenceId,
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")));
    Assert.False(EgressExactHttpRequestValidator.IsAuthorized(
      flow,
      ReplaceAscii(request, flow.ExpectedPreStateSha256, new string('7', 64))));

    var authorized = EgressExactHttpRequestValidator.CreateAuthorizedRequest(
      flow,
      request,
      "vault-secret"u8);
    try
    {
      var text = Encoding.ASCII.GetString(authorized);
      Assert.Contains("\r\nAuthorization: Bearer vault-secret\r\n\r\n", text);
      Assert.DoesNotContain("Authorization-Reference", text);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(authorized);
      CryptographicOperations.ZeroMemory(request);
    }
  }

  [Fact]
  public void TlsPolicyCannotCreateUnmeteredRevocationOrCertificateDownloads()
  {
    var flow = new EgressFlowAuthorization(
      Guid.NewGuid().ToString("D"),
      new string('1', 64),
      "22222222-2222-4222-8222-222222222222",
      "external.email.send",
      "api.example.test",
      443,
      "/v1/email/send",
      new string('2', 64),
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      new string('3', 64),
      "Bearer ",
      new string('4', 64),
      new string('5', 64),
      new string('6', 64),
      new string('7', 64),
      new string('8', 64),
      new string('9', 64),
      100_000,
      DateTimeOffset.UtcNow.AddMinutes(1).ToUnixTimeMilliseconds());

    var options = NamedPipeEgressDataService.CreateTlsOptions(flow);

    Assert.Equal(flow.DestinationHost, options.TargetHost);
    Assert.Equal(X509RevocationMode.NoCheck, options.CertificateRevocationCheckMode);
    Assert.NotNull(options.CertificateChainPolicy);
    Assert.True(options.CertificateChainPolicy!.DisableCertificateDownloads);
    Assert.Equal(X509RevocationMode.NoCheck, options.CertificateChainPolicy.RevocationMode);
    Assert.Equal(X509ChainTrustMode.System, options.CertificateChainPolicy.TrustMode);
    Assert.Equal(X509VerificationFlags.NoFlag, options.CertificateChainPolicy.VerificationFlags);
  }

  [Fact]
  public void TlsPolicyRequiresBothNormalHostnameValidationAndTheExactCertificatePin()
  {
    using var key = RSA.Create(2_048);
    var request = new CertificateRequest(
      "CN=api.itemba.com",
      key,
      HashAlgorithmName.SHA256,
      RSASignaturePadding.Pkcs1);
    using var certificate = request.CreateSelfSigned(
      DateTimeOffset.UtcNow.AddMinutes(-1),
      DateTimeOffset.UtcNow.AddMinutes(5));
    var pin = Convert.ToHexString(SHA256.HashData(certificate.RawData)).ToLowerInvariant();

    Assert.True(NamedPipeEgressDataService.CertificateAllowed(
      certificate,
      SslPolicyErrors.None,
      pin));
    Assert.False(NamedPipeEgressDataService.CertificateAllowed(
      certificate,
      SslPolicyErrors.RemoteCertificateNameMismatch,
      pin));
    Assert.False(NamedPipeEgressDataService.CertificateAllowed(
      certificate,
      SslPolicyErrors.None,
      new string('0', 64)));
  }

  [Fact]
  public void ServiceImageMeasurementRequiresTheCurrentMappedFileObject()
  {
    if (!OperatingSystem.IsWindows() || Environment.ProcessPath is not { } processPath)
    {
      return;
    }

    var expectedSha256 = Sha256File(processPath);
    Assert.True(WindowsEgressHostPostureProvider.CurrentProcessImageMatches(
      processPath,
      expectedSha256));

    var sameBytesAtAnotherPath = Path.Combine(_directory, "replacement.exe");
    File.Copy(processPath, sameBytesAtAnotherPath);
    Assert.Equal(expectedSha256, Sha256File(sameBytesAtAnotherPath));
    Assert.False(WindowsEgressHostPostureProvider.CurrentProcessImageMatches(
      sameBytesAtAnotherPath,
      expectedSha256));
  }

  [Fact]
  public async Task AlteredPolicyPinnedCredentialRecordIsRejectedBeforeDpapiOrUse()
  {
    var vaultPath = Path.Combine(_directory, "secret-vault");
    Directory.CreateDirectory(vaultPath);
    var referenceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    var fileName = $"{PayloadDigest.Sha256Hex($"msaidizi-secret-reference/v1\0{referenceId}")}.bin";
    var path = Path.Combine(vaultPath, fileName);
    var originallyPinned = RandomNumberGenerator.GetBytes(256);
    var pinnedSha256 = Convert.ToHexString(SHA256.HashData(originallyPinned))
      .ToLowerInvariant();
    await File.WriteAllBytesAsync(path, originallyPinned);
    var substituted = RandomNumberGenerator.GetBytes(256);
    await File.WriteAllBytesAsync(path, substituted);
    CryptographicOperations.ZeroMemory(originallyPinned);
    CryptographicOperations.ZeroMemory(substituted);

    var vault = new EgressSupervisorSecretVault(new EgressSupervisorOptions
    {
      SecretVaultPath = vaultPath,
    });
    var consumerCalled = false;
    var exception = await Assert.ThrowsAsync<UnauthorizedAccessException>(async () =>
      await vault.UseAsync(
        referenceId,
        "external.email.send",
        new string('a', 64),
        pinnedSha256,
        (secret, cancellationToken) =>
        {
          consumerCalled = true;
          return ValueTask.FromResult(0);
        },
        CancellationToken.None));
    Assert.Contains("active policy pin", exception.Message, StringComparison.Ordinal);
    Assert.False(consumerCalled);
  }

  [Fact]
  public async Task TrustedRootKillSwitchFailsClosedAtStartupAndDuringRuntime()
  {
    Assert.True(EgressTrustedKillSwitch.IsEngaged(
      Path.Combine(_directory, "missing-root", "DISABLED")));
    var killPath = Path.Combine(_directory, "DISABLED");
    Assert.False(EgressTrustedKillSwitch.IsEngaged(killPath));

    using var fixture = CreateFixture();
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    await File.WriteAllBytesAsync(killPath, []);
    var exception = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.ReserveAsync(fixture.Reservation, CancellationToken.None).AsTask());
    Assert.Equal("egress_kill_switch_engaged", exception.Code);
    Assert.True(exception.MayHaveEgressed);
  }

  [Fact]
  public void TrustedRootKillSwitchRejectsAnAncestorReparseBoundary()
  {
    if (!OperatingSystem.IsWindows())
    {
      return;
    }
    var target = Path.Combine(_directory, "real-trusted-root");
    var link = Path.Combine(_directory, "redirected-trusted-root");
    Directory.CreateDirectory(Path.Combine(target, "nested"));
    try
    {
      Directory.CreateSymbolicLink(link, target);
    }
    catch (Exception exception) when (exception is UnauthorizedAccessException
      or IOException
      or PlatformNotSupportedException)
    {
      return;
    }

    Assert.True(EgressTrustedKillSwitch.IsEngaged(
      Path.Combine(link, "nested", "DISABLED")));
  }

  [Fact]
  public async Task NonReadingPeerCannotOutliveOperationOrKillCancellation()
  {
    await using var peer = new BlockingWriteStream();
    using var operation = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));
    var stopwatch = Stopwatch.StartNew();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
      await NamedPipeEgressDataService.WriteTransferResponseAsync(
        peer,
        requestDispatched: false,
        measuredExternalEgressBytes: 0,
        [],
        "cancelled",
        operation.Token));

    Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(1));
    Assert.True(peer.CancellationObserved);
  }

  [Fact]
  public async Task ExactControlOperationsAreIdempotentAndConflictsFailClosed()
  {
    using var fixture = CreateFixture();
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var firstAuthorization = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    var replayAuthorization = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    Assert.Equal(firstAuthorization, replayAuthorization);

    var registration = fixture.CreateRegistration(firstAuthorization);
    var registrationRequest = new EgressDirectRegistrationRequestPayload(
      EgressSupervisorLifecycleContract.Version,
      firstAuthorization,
      registration);
    var firstAcknowledgement = await fixture.Engine.RegisterDirectAsync(
      registrationRequest,
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    var replayAcknowledgement = await fixture.Engine.RegisterDirectAsync(
      registrationRequest,
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    Assert.Equal(firstAcknowledgement, replayAcknowledgement);

    var flow = await fixture.Engine.BeginDirectFlowAsync(
      fixture.CreateFlowRequest(firstAuthorization, registration),
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    await fixture.AttestRouteAsync(flow);
    await fixture.Engine.CompleteDirectFlowAsync(
      flow,
      9,
      false,
      new string('a', 64),
      CancellationToken.None);
    var disposition = fixture.CreateDisposition("completed", 9, false);
    var terminalRequest = new EgressTerminalRequestPayload(
      EgressSupervisorLifecycleContract.Version,
      firstAuthorization,
      firstAcknowledgement,
      disposition);
    var firstReceipt = await fixture.Engine.TerminalAsync(
      terminalRequest,
      false,
      CancellationToken.None);
    var replayReceipt = await fixture.Engine.TerminalAsync(
      terminalRequest,
      false,
      CancellationToken.None);
    Assert.Equal(firstReceipt, replayReceipt);
    Assert.Equal(6, fixture.Journal.Snapshot().LastJournalSequence);

    var conflict = terminalRequest with
    {
      Disposition = disposition with { ReportedExternalEgressBytes = 10 },
    };
    var exception = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.TerminalAsync(conflict, false, CancellationToken.None).AsTask());
    Assert.Equal("egress_terminal_idempotency_conflict", exception.Code);
  }

  [Fact]
  public async Task ExactReservationReplayDoesNotReauthorizeAnExpiredToken()
  {
    using var fixture = CreateFixture();
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var first = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    Assert.Equal(1, fixture.TokenVerifier.VerificationCount);
    fixture.TokenVerifier.RejectAll = true;

    var replay = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    Assert.Equal(first, replay);
    Assert.Equal(1, fixture.TokenVerifier.VerificationCount);
  }

  [Fact]
  public async Task RestartTurnsActiveFlowIntoUnknownFullChargeWithoutDuplicateMutation()
  {
    using var signingKeys = new TestSigningKeys();
    var journalPath = Path.Combine(_directory, "restart.jsonl");
    EgressExecutionAuthorization authorization;
    EgressRegistrationAcknowledgementV1 acknowledgement;
    EgressDirectRegistrationV1 registration;
    EgressTerminalDispositionV1 disposition;
    Fixture first;
    using (first = CreateFixture(signingKeys, journalPath))
    {
      await first.Engine.InitializeAsync(CancellationToken.None);
      authorization = await first.Engine.ReserveAsync(
        first.Reservation,
        CancellationToken.None);
      registration = first.CreateRegistration(authorization);
      acknowledgement = await first.Engine.RegisterDirectAsync(
        new EgressDirectRegistrationRequestPayload(EgressSupervisorLifecycleContract.Version, authorization, registration),
        first.ProcessId,
        first.ProcessCreationTime,
        CancellationToken.None);
      _ = await first.Engine.BeginDirectFlowAsync(
        first.CreateFlowRequest(authorization, registration),
        first.ProcessId,
        first.ProcessCreationTime,
        CancellationToken.None);
      disposition = first.CreateDisposition(
        EgressSupervisorLifecycleContract.Unknown,
        0,
        uncertain: true);
    }

    using var recovered = CreateFixture(signingKeys, journalPath);
    await recovered.Engine.InitializeAsync(CancellationToken.None);
    recovered.Time.Advance(TimeSpan.FromDays(2));
    var receipt = await recovered.Engine.TerminalAsync(
      new EgressTerminalRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        acknowledgement,
        disposition),
      abort: false,
      CancellationToken.None);
    Assert.Equal(EgressSupervisorLifecycleContract.Unknown, receipt.Receipt.Outcome);
    Assert.Equal(recovered.Binding.ReservedCapabilityEgressBytes,
      receipt.Receipt.ChargedExternalEgressBytes);
    Assert.Equal(recovered.Binding.ReservedCapabilityEgressBytes,
      receipt.Receipt.UncertainExternalEgressBytes);
    Assert.Equal(
      EgressSupervisorLifecycleCanonical.RegistrationSha256(registration),
      receipt.Receipt.RegistrationSha256);

    var exactReplay = await recovered.Engine.TerminalAsync(
      new EgressTerminalRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        acknowledgement,
        disposition),
      abort: false,
      CancellationToken.None);
    Assert.Equal(receipt, exactReplay);
    Assert.Equal(1, recovered.Journal.Snapshot().LastReceiptSequence);
  }

  [Fact]
  public async Task UncertainMeasurementRequiresUnknownDispositionAndFullCharges()
  {
    using var fixture = CreateFixture();
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var authorization = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    var registration = fixture.CreateRegistration(authorization);
    var acknowledgement = await fixture.Engine.RegisterDirectAsync(
      new EgressDirectRegistrationRequestPayload(EgressSupervisorLifecycleContract.Version, authorization, registration),
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    var flow = await fixture.Engine.BeginDirectFlowAsync(
      fixture.CreateFlowRequest(authorization, registration),
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    await fixture.AttestRouteAsync(flow);
    await fixture.Engine.CompleteDirectFlowAsync(
      flow,
      25,
      measurementUncertain: true,
      new string('f', 64),
      CancellationToken.None);

    var knownDisposition = fixture.CreateDisposition("completed", 25, false);
    var rejected = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.TerminalAsync(
        new EgressTerminalRequestPayload(
          EgressSupervisorLifecycleContract.Version,
          authorization,
          acknowledgement,
          knownDisposition),
        false,
        CancellationToken.None).AsTask());
    Assert.Equal("egress_recovered_flow_requires_unknown_disposition", rejected.Code);

    var unknown = fixture.CreateDisposition("unknown", 25, true);
    var receipt = await fixture.Engine.TerminalAsync(
      new EgressTerminalRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        acknowledgement,
        unknown),
      false,
      CancellationToken.None);
    Assert.Equal(fixture.Binding.ReservedCapabilityEgressBytes,
      receipt.Receipt.ChargedExternalEgressBytes);
    Assert.Equal(
      fixture.Binding.ReservedCapabilityEgressBytes - 25,
      receipt.Receipt.UncertainExternalEgressBytes);
  }

  [Fact]
  public async Task ImmediateSettlementWaitsForExactFlowCloseAndReplaysIdempotently()
  {
    using var fixture = CreateFixture();
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var authorization = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    var registration = fixture.CreateRegistration(authorization);
    var acknowledgement = await fixture.Engine.RegisterDirectAsync(
      new EgressDirectRegistrationRequestPayload(EgressSupervisorLifecycleContract.Version, authorization, registration),
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    var flow = await fixture.Engine.BeginDirectFlowAsync(
      fixture.CreateFlowRequest(authorization, registration),
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    var disposition = fixture.CreateDisposition(
      EgressSupervisorLifecycleContract.Completed,
      31,
      uncertain: false);
    var request = new EgressTerminalRequestPayload(
      EgressSupervisorLifecycleContract.Version,
      authorization,
      acknowledgement,
      disposition);

    var settling = fixture.Engine.TerminalAsync(
      request,
      abort: false,
      CancellationToken.None).AsTask();
    Assert.False(settling.IsCompleted);
    await fixture.AttestRouteAsync(flow);
    await fixture.Engine.CompleteDirectFlowAsync(
      flow,
      31,
      measurementUncertain: false,
      new string('e', 64),
      CancellationToken.None);

    var receipt = await settling;
    Assert.Equal(31, receipt.Receipt.MeasuredExternalEgressBytes);
    var replay = await fixture.Engine.TerminalAsync(
      request,
      abort: false,
      CancellationToken.None);
    Assert.Equal(receipt, replay);
    Assert.Equal(1, fixture.Journal.Snapshot().LastReceiptSequence);
  }

  [Fact]
  public async Task UnknownDispositionUsesSupervisorMeasurementWhenCallerCountDiffers()
  {
    using var fixture = CreateFixture();
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var authorization = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    var registration = fixture.CreateRegistration(authorization);
    var acknowledgement = await fixture.Engine.RegisterDirectAsync(
      new EgressDirectRegistrationRequestPayload(EgressSupervisorLifecycleContract.Version, authorization, registration),
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    var flow = await fixture.Engine.BeginDirectFlowAsync(
      fixture.CreateFlowRequest(authorization, registration),
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    await fixture.AttestRouteAsync(flow);
    await fixture.Engine.CompleteDirectFlowAsync(
      flow,
      47,
      measurementUncertain: false,
      new string('a', 64),
      CancellationToken.None);
    var disposition = fixture.CreateDisposition(
      EgressSupervisorLifecycleContract.Unknown,
      reportedBytes: 0,
      uncertain: true);

    var receipt = await fixture.Engine.TerminalAsync(
      new EgressTerminalRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        acknowledgement,
        disposition),
      abort: false,
      CancellationToken.None);
    Assert.Equal(47, receipt.Receipt.MeasuredExternalEgressBytes);
    Assert.Equal(
      fixture.Binding.ReservedCapabilityEgressBytes - 47,
      receipt.Receipt.UncertainExternalEgressBytes);
    Assert.Equal(
      fixture.Binding.ReservedCapabilityEgressBytes,
      receipt.Receipt.ChargedExternalEgressBytes);
  }

  [Fact]
  public async Task JournalTamperingAndConcurrentOwnershipFailClosed()
  {
    var journalPath = Path.Combine(_directory, "tamper.jsonl");
    using (var fixture = CreateFixture(journalPath: journalPath))
    {
      await fixture.Engine.InitializeAsync(CancellationToken.None);
      _ = await fixture.Engine.ReserveAsync(fixture.Reservation, CancellationToken.None);

      var secondOwner = new DurableEgressJournal(journalPath, fixture.Time);
      try
      {
        Assert.Throws<IOException>(secondOwner.Initialize);
      }
      finally
      {
        secondOwner.Dispose();
      }
    }

    var original = File.ReadAllText(journalPath);
    File.WriteAllText(
      journalPath,
      original.Replace("reservation-created", "reservation-creaxed",
        StringComparison.Ordinal));
    using var tampered = new DurableEgressJournal(journalPath);
    Assert.Throws<InvalidDataException>(tampered.Initialize);
  }

  [Fact]
  public void ProductionJournalCannotSilentlyCreateANewGenesis()
  {
    var path = Path.Combine(_directory, "protected", "lifecycle.v1.jsonl");
    using (var absent = new DurableEgressJournal(
      path,
      requirePreprovisionedFiles: true,
      protection: NoOpJournalProtection.Instance))
    {
      Assert.Throws<InvalidDataException>(absent.Initialize);
    }

    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    File.WriteAllBytes(path, []);
    File.WriteAllBytes(path + ".lock", []);
    using var provisioned = new DurableEgressJournal(
      path,
      requirePreprovisionedFiles: true,
      protection: NoOpJournalProtection.Instance);
    provisioned.Initialize();
    Assert.Equal(0, provisioned.Snapshot().LastJournalSequence);
  }

  [Fact]
  public async Task UnsupportedProcessAndBrowserBoundariesStayUnavailable()
  {
    var process = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      EgressSupervisorEngine.RejectProcessRegistrationAsync().AsTask());
    var browser = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      EgressSupervisorEngine.RejectBrowserRegistrationAsync().AsTask());
    Assert.Equal("egress_process_boundary_not_implemented", process.Code);
    Assert.Equal("egress_browser_boundary_not_implemented", browser.Code);
  }

  [Fact]
  public async Task LivePostureChangePreventsARegisteredFlowFromOpening()
  {
    using var fixture = CreateFixture();
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var authorization = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    var registration = fixture.CreateRegistration(authorization);
    _ = await fixture.Engine.RegisterDirectAsync(
      new EgressDirectRegistrationRequestPayload(EgressSupervisorLifecycleContract.Version, authorization, registration),
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    fixture.Posture.Current = fixture.Posture.Current with
    {
      BootId = "99999999-9999-4999-8999-999999999999",
    };

    var exception = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.BeginDirectFlowAsync(
        fixture.CreateFlowRequest(authorization, registration),
        fixture.ProcessId,
        fixture.ProcessCreationTime,
        CancellationToken.None).AsTask());
    Assert.Equal("egress_attested_posture_changed", exception.Code);
    var session = Assert.Single(fixture.Journal.Snapshot().SessionsByLeaseSha256).Value;
    Assert.Equal(EgressSessionLifecycle.Registered, session.Lifecycle);
  }

  [Fact]
  public void DataPlaneHasRemoteRejectionFirstInstanceAndNoListenerState()
  {
    Assert.Equal(0x8u, RestrictedEgressPipeFactory.RequiredNativePipeMode);
    Assert.Equal(0x00080000u, RestrictedEgressPipeFactory.RequiredFirstInstanceOpenMode);
    Assert.DoesNotContain(
      typeof(NamedPipeEgressDataService).GetFields(
        BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public),
      field => field.FieldType == typeof(TcpListener)
        || field.FieldType == typeof(IPEndPoint));
  }

  [Fact]
  public async Task SupervisorConnectorOwnsTheOnlyOutboundSocket()
  {
    var resolver = new SequencedDestinationResolver(
      [new ResolvedPublicDestination([IPAddress.Parse("8.8.8.8")])]);
    var dialer = new RecordingTcpDialer();
    var connector = new TcpEgressOutboundConnector(resolver, dialer);

    var reservationDigest = EgressRouteAttestation.AnswerSetSha256(
      [IPAddress.Parse("8.8.8.8")]);
    await using var outbound = (await connector.ConnectAsync(
      "api.itemba.com",
      443,
      reservationDigest,
      TimeSpan.FromSeconds(5),
      CancellationToken.None)).Connection;

    Assert.Equal(["api.itemba.com"], resolver.Hosts);
    Assert.Equal(IPAddress.Parse("8.8.8.8"), Assert.Single(dialer.Addresses));
    Assert.Equal(443, dialer.Ports.Single());
    Assert.DoesNotContain(
      typeof(NamedPipeEgressDataService).GetFields(
        BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public),
      field => typeof(System.Net.Http.HttpMessageInvoker).IsAssignableFrom(field.FieldType)
        || typeof(IWebProxy).IsAssignableFrom(field.FieldType));
  }

  [Fact]
  public void RouteDigestsNormalizeSortAndDeduplicateWithoutPersistingAddressText()
  {
    var ipv4 = IPAddress.Parse("8.8.8.8");
    var mapped = ipv4.MapToIPv6();
    var ipv6 = IPAddress.Parse("2606:4700:4700::1111");
    var first = EgressRouteAttestation.AnswerSetSha256([ipv6, mapped, ipv4]);
    var second = EgressRouteAttestation.AnswerSetSha256([ipv4, ipv6]);

    Assert.Equal(first, second);
    Assert.Equal(
      EgressRouteAttestation.SelectedAddressSha256(ipv4),
      EgressRouteAttestation.SelectedAddressSha256(mapped));
    Assert.DoesNotContain("8.8.8.8", first, StringComparison.Ordinal);
  }

  [Fact]
  public async Task ConnectorRejectsPublicDnsAnswerSetChurnBeforeDial()
  {
    var reserved = EgressRouteAttestation.AnswerSetSha256(
      [IPAddress.Parse("8.8.8.8")]);
    var resolver = new SequencedDestinationResolver(
      [EgressRouteAttestation.Create([IPAddress.Parse("1.1.1.1")])]);
    var dialer = new RecordingTcpDialer();
    var connector = new TcpEgressOutboundConnector(resolver, dialer);

    await Assert.ThrowsAsync<IOException>(() => connector.ConnectAsync(
      "api.itemba.com",
      443,
      reserved,
      TimeSpan.FromSeconds(5),
      CancellationToken.None).AsTask());

    Assert.Empty(dialer.Addresses);
  }

  [Fact]
  public async Task ConsumedFlowWithoutRouteEvidenceCanOnlyTerminalizeUnknown()
  {
    using var fixture = CreateFixture();
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var authorization = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    var registration = fixture.CreateRegistration(authorization);
    var acknowledgement = await fixture.Engine.RegisterDirectAsync(
      new EgressDirectRegistrationRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        registration),
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    var flow = await fixture.Engine.BeginDirectFlowAsync(
      fixture.CreateFlowRequest(authorization, registration),
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    await fixture.Engine.CompleteDirectFlowAsync(
      flow,
      0,
      measurementUncertain: false,
      new string('a', 64),
      CancellationToken.None);
    var disposition = fixture.CreateDisposition(
      EgressSupervisorLifecycleContract.Unknown,
      0,
      uncertain: true);
    var receipt = await fixture.Engine.TerminalAsync(
      new EgressTerminalRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        authorization,
        acknowledgement,
        disposition),
      abort: false,
      CancellationToken.None);

    Assert.Equal(EgressSupervisorLifecycleContract.Unknown, receipt.Receipt.Outcome);
    Assert.Equal(
      EgressSupervisorLifecycleCanonical.ZeroSha256,
      receipt.Receipt.ConnectionDnsAnswerSetSha256);
    Assert.Equal(
      EgressSupervisorLifecycleCanonical.ZeroSha256,
      receipt.Receipt.SelectedAddressSha256);
    Assert.Equal(
      authorization.Lease.Lease.ReservedCapabilityEgressBytes,
      receipt.Receipt.ChargedExternalEgressBytes);
  }

  [Fact]
  public async Task DynamicReservationAndPreConnectDnsChecksAreIndependentAndRejectRebinding()
  {
    var resolver = new SequencedDestinationResolver(
    [
      new ResolvedPublicDestination([IPAddress.Parse("8.8.8.8")]),
      new ResolvedPublicDestination(
        [IPAddress.Parse("8.8.8.8"), IPAddress.Loopback],
        new string('a', 64)),
    ]);
    using var fixture = CreateFixture(
      dynamicDestination: true,
      destinationResolver: resolver);
    await fixture.Engine.InitializeAsync(CancellationToken.None);

    _ = await fixture.Engine.ReserveAsync(
      fixture.Reservation,
      CancellationToken.None);
    Assert.Equal(["api.itemba.com"], resolver.Hosts);

    var dialer = new RecordingTcpDialer();
    var connector = new TcpEgressOutboundConnector(resolver, dialer);
    await Assert.ThrowsAsync<IOException>(() => connector.ConnectAsync(
      "api.itemba.com",
      443,
      EgressRouteAttestation.AnswerSetSha256([IPAddress.Parse("8.8.8.8")]),
      TimeSpan.FromSeconds(5),
      CancellationToken.None).AsTask());

    Assert.Equal(["api.itemba.com", "api.itemba.com"], resolver.Hosts);
    Assert.Empty(dialer.Addresses);
  }

  [Fact]
  public async Task ControlWireMatchesCompanionNamedPipeProtocolExactly()
  {
    using var fixture = CreateFixture();
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var handler = new EgressControlProtocolHandler(fixture.Engine);
    var requestFrame = new EgressSupervisorPipeFrameV1(
      EgressSupervisorWireProtocol.Version,
      1,
      EgressSupervisorWireProtocol.ReserveRequest,
      Guid.NewGuid().ToString("D"),
      fixture.Reservation.OperationId,
      JsonSerializer.Serialize(
        fixture.Reservation,
        EgressSupervisorWireProtocol.StrictJson));
    var responseBytes = await handler.HandleAsync(
      JsonSerializer.SerializeToUtf8Bytes(
        requestFrame,
        EgressSupervisorWireProtocol.StrictJson),
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    var response = JsonSerializer.Deserialize<EgressSupervisorPipeFrameV1>(
      responseBytes,
      EgressSupervisorWireProtocol.StrictJson);
    Assert.NotNull(response);
    Assert.Equal(EgressSupervisorWireProtocol.ReserveResponse, response.Kind);
    Assert.Equal(fixture.Reservation.OperationId, response.CorrelationId);
    var payload = JsonSerializer.Deserialize<EgressReserveResponsePayload>(
      response.PayloadJson,
      EgressSupervisorWireProtocol.StrictJson);
    Assert.NotNull(payload);
    Assert.Equal(fixture.Binding.ActionId, payload.Authorization.Lease.Lease.ActionId);
    Assert.Equal(EgressBoundaryCanonical.ContractVersion,
      payload.Authorization.Lease.Lease.ContractVersion);
  }

  [Fact]
  public void PackagedDefaultsAreSafeOffAndProvisioningRequired()
  {
    var defaults = new EgressSupervisorOptions();
    Assert.False(defaults.Enabled);
    Assert.Equal("itemba-msaidizi-broker", defaults.ExpectedIssuer);
    Assert.Equal("itemba-windows-companion", defaults.ExpectedAudience);
    Assert.Equal("msaidizi-global", defaults.ExpectedSubject);
    Assert.Equal("Itemba Msaidizi Egress Supervisor", defaults.SupervisorServiceName);
    Assert.Equal("Itemba Msaidizi Companion", defaults.CompanionServiceName);
    Assert.Equal(
      "S-1-5-80-2691216044-51290016-1044150087-1430489630-3303720160",
      EgressSupervisorTrustIdentity.ServiceSid);
    Assert.Equal(
      "S-1-5-80-341263411-3719254221-1864525750-3877438856-2718495063",
      EgressSupervisorTrustIdentity.CompanionServiceSid);
    Assert.Null(typeof(EgressSupervisorOptions).GetProperty("ProxyPort"));
    Assert.Null(typeof(EgressSupervisorOptions).GetProperty("ProxyListenAddress"));
    var path = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
    using var document = JsonDocument.Parse(File.ReadAllBytes(path));
    Assert.False(document.RootElement.GetProperty("EgressSupervisor")
      .GetProperty("Enabled").GetBoolean());
    Assert.Equal(
      defaults.ExpectedIssuer,
      document.RootElement.GetProperty("EgressSupervisor")
        .GetProperty("ExpectedIssuer").GetString());
    Assert.Equal(
      defaults.ExpectedSubject,
      document.RootElement.GetProperty("EgressSupervisor")
        .GetProperty("ExpectedSubject").GetString());
  }

  [Fact]
  public async Task SafeDisabledHostStartsWithoutRegisteringAnyActiveBoundary()
  {
    var options = new EgressSupervisorOptions
    {
      Enabled = false,
      PipeName = $"Itemba.Test.Control.{Guid.NewGuid():N}",
      DataPipeName = $"Itemba.Test.Flow.{Guid.NewGuid():N}",
    };
    var builder = Host.CreateApplicationBuilder();
    builder.Services.AddEgressSupervisor(options);
    using var host = builder.Build();

    var hostedServices = host.Services.GetServices<IHostedService>().ToArray();
    Assert.Single(hostedServices);
    Assert.IsType<DisabledEgressSupervisorService>(hostedServices[0]);
    Assert.Null(host.Services.GetService<IEgressOutboundConnector>());
    Assert.Null(host.Services.GetService<IEgressPipePeerAuthenticator>());
    Assert.Null(host.Services.GetService<EgressSupervisorEngine>());

    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
    await host.StartAsync(timeout.Token);
    await host.StopAsync(timeout.Token);
  }

  [Fact]
  public void SigningKeyAclRequiresOnlyTheRestrictedServiceGrant()
  {
    var supervisorSid = new SecurityIdentifier(
      WellKnownSidType.NetworkServiceSid,
      null);
    var systemSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
    var exact = new RawSecurityDescriptor(
      "O:SYD:P(A;;GA;;;NS)");
    Assert.True(CertificateStoreEgressSupervisorSigningKeys
      .IsExactPrivateKeyDescriptor(exact, supervisorSid));

    var extraGrant = new RawSecurityDescriptor(
      "O:SYD:P(A;;GA;;;NS)(A;;GA;;;SY)");
    Assert.False(CertificateStoreEgressSupervisorSigningKeys
      .IsExactPrivateKeyDescriptor(extraGrant, supervisorSid));

    var objectAcl = new RawAcl(2, 1);
    objectAcl.InsertAce(0, new ObjectAce(
      AceFlags.None,
      AceQualifier.AccessAllowed,
      unchecked((int)0x10000000),
      supervisorSid,
      ObjectAceFlags.ObjectAceTypePresent,
      Guid.NewGuid(),
      Guid.Empty,
      isCallback: false,
      opaque: null));
    var hiddenObjectGrant = new RawSecurityDescriptor(
      ControlFlags.DiscretionaryAclPresent
        | ControlFlags.DiscretionaryAclProtected,
      systemSid,
      group: null,
      systemAcl: null,
      objectAcl);
    Assert.False(CertificateStoreEgressSupervisorSigningKeys
      .IsExactPrivateKeyDescriptor(hiddenObjectGrant, supervisorSid));
  }

  [Fact]
  public void SigningKeyPurposeSeparationUsesCanonicalPublicSpkis()
  {
    using var attestation = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    using var receipt = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    using var brokerAction = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    using var duplicateWrapper = ECDsa.Create();
    var attestationSpki = attestation.ExportSubjectPublicKeyInfo();
    var receiptSpki = receipt.ExportSubjectPublicKeyInfo();
    var brokerActionSpki = brokerAction.ExportSubjectPublicKeyInfo();
    byte[]? duplicateSpki = null;
    try
    {
      duplicateWrapper.ImportSubjectPublicKeyInfo(attestationSpki, out var bytesRead);
      Assert.Equal(attestationSpki.Length, bytesRead);
      duplicateSpki = duplicateWrapper.ExportSubjectPublicKeyInfo();

      Assert.True(CertificateStoreEgressSupervisorSigningKeys
        .ArePurposeSeparatedPublicSpkis(
          attestationSpki,
          receiptSpki,
          brokerActionSpki));
      Assert.False(CertificateStoreEgressSupervisorSigningKeys
        .ArePurposeSeparatedPublicSpkis(
          attestationSpki,
          duplicateSpki,
          brokerActionSpki));
      Assert.False(CertificateStoreEgressSupervisorSigningKeys
        .ArePurposeSeparatedPublicSpkis(
          attestationSpki,
          receiptSpki,
          duplicateSpki));
      Assert.False(CertificateStoreEgressSupervisorSigningKeys
        .ArePurposeSeparatedPublicSpkis(
          attestationSpki,
          receiptSpki,
          receiptSpki));
    }
    finally
    {
      CryptographicOperations.ZeroMemory(attestationSpki);
      CryptographicOperations.ZeroMemory(receiptSpki);
      CryptographicOperations.ZeroMemory(brokerActionSpki);
      if (duplicateSpki is not null)
      {
        CryptographicOperations.ZeroMemory(duplicateSpki);
      }
    }
  }

  [Fact]
  public void SupervisorProcessGrantReplacesEveryWiderCompanionAce()
  {
    var companionSid = new SecurityIdentifier(
      WellKnownSidType.NetworkServiceSid,
      null);
    var systemSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
    var existing = new RawAcl(2, 3);
    existing.InsertAce(0, new CommonAce(
      AceFlags.None,
      AceQualifier.AccessAllowed,
      unchecked((int)0x10000000),
      systemSid,
      isCallback: false,
      opaque: null));
    existing.InsertAce(1, new ObjectAce(
      AceFlags.None,
      AceQualifier.AccessAllowed,
      unchecked((int)0x10000000),
      companionSid,
      ObjectAceFlags.ObjectAceTypePresent,
      Guid.NewGuid(),
      Guid.Empty,
      isCallback: false,
      opaque: null));
    existing.InsertAce(2, new CommonAce(
      AceFlags.Inherited,
      AceQualifier.AccessAllowed,
      unchecked((int)0x10000000),
      companionSid,
      isCallback: false,
      opaque: null));

    var restricted = WindowsEgressProcessObjectBoundary.BuildRestrictedPeerDacl(
      existing,
      companionSid);
    Assert.True(WindowsEgressProcessObjectBoundary.HasExactPeerGrant(
      restricted,
      companionSid));
    Assert.Equal(2, restricted.Count);
    var systemGrant = Assert.IsType<CommonAce>(restricted[0]);
    Assert.Equal(systemSid, systemGrant.SecurityIdentifier);
    var companionGrant = Assert.IsType<CommonAce>(restricted[1]);
    Assert.Equal(
      WindowsEgressProcessObjectBoundary.CompanionProcessAccessMask,
      companionGrant.AccessMask);
    Assert.Equal(0x00100400, companionGrant.AccessMask);
  }

  [Fact]
  public void RestrictedTokenValidatorRequiresTheSidInTokenRestrictedSids()
  {
    if (!OperatingSystem.IsWindows())
    {
      return;
    }

    Assert.True(OpenProcessToken(
      GetCurrentProcess(),
      TokenDuplicate | TokenQuery,
      out var sourceToken));
    using (sourceToken)
    {
      var requiredSid = new SecurityIdentifier(WellKnownSidType.WorldSid, null);
      var otherSid = new SecurityIdentifier(WellKnownSidType.NetworkServiceSid, null);
      var binarySid = new byte[requiredSid.BinaryLength];
      requiredSid.GetBinaryForm(binarySid, 0);
      var pinnedSid = GCHandle.Alloc(binarySid, GCHandleType.Pinned);
      try
      {
        var restrictions = new[]
        {
          new TestSidAndAttributes
          {
            Sid = pinnedSid.AddrOfPinnedObject(),
            Attributes = 0,
          },
        };
        Assert.True(CreateRestrictedToken(
          sourceToken,
          flags: 0,
          disableSidCount: 0,
          sidsToDisable: IntPtr.Zero,
          deletePrivilegeCount: 0,
          privilegesToDelete: IntPtr.Zero,
          restrictedSidCount: 1,
          restrictions,
          out var restrictedToken));
        using (restrictedToken)
        {
          Assert.True(RestrictedServiceTokenValidator.IsRestrictedTo(
            restrictedToken,
            requiredSid));
          Assert.False(RestrictedServiceTokenValidator.IsRestrictedTo(
            restrictedToken,
            otherSid));
        }
      }
      finally
      {
        pinnedSid.Free();
        CryptographicOperations.ZeroMemory(binarySid);
      }
    }
  }

  [Fact]
  public async Task CapabilityActivationAttestsExactServiceAndAgentAndRejectsReplay()
  {
    using var fixture = CreateFixture();
    await fixture.Engine.InitializeAsync(CancellationToken.None);

    var serviceRequest = fixture.CreateCapabilityAttestationRequest(
      CapabilityBoundaryAttestationContract.CompanionServiceRole,
      browser: false,
      command: true);
    var service = await fixture.Engine.IssueCapabilityBoundaryAttestationAsync(
      serviceRequest,
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    Assert.True(fixture.SigningKeys.VerifyCapabilityAttestation(service));
    Assert.Equal(fixture.PipeSecurity.Sha256,
      service.Attestation.SupervisorPipeSecuritySha256);
    Assert.Equal(EgressBoundaryFeatures.CommandRequired,
      service.Attestation.Features);

    var replay = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.IssueCapabilityBoundaryAttestationAsync(
        serviceRequest,
        fixture.ProcessId,
        fixture.ProcessCreationTime,
        CancellationToken.None).AsTask());
    Assert.Equal("capability_attestation_request_replayed", replay.Code);

    var agentRequest = fixture.CreateCapabilityAttestationRequest(
      CapabilityBoundaryAttestationContract.SessionAgentRole,
      browser: false,
      command: true);
    var agent = await fixture.Engine.IssueCapabilityBoundaryAttestationAsync(
      agentRequest,
      fixture.ProcessId,
      fixture.ProcessCreationTime,
      CancellationToken.None);
    Assert.Equal(CapabilityBoundaryAttestationContract.SessionAgentRole,
      agent.Attestation.SubjectRole);
    Assert.Equal(fixture.ProcessId + 1, agent.Attestation.SubjectProcessId);
  }

  [Fact]
  public async Task CapabilityActivationRejectsPeerAclAndKillSwitchFailures()
  {
    using var fixture = CreateFixture();
    await fixture.Engine.InitializeAsync(CancellationToken.None);

    var peerRequest = fixture.CreateCapabilityAttestationRequest(
      CapabilityBoundaryAttestationContract.CompanionServiceRole,
      browser: false,
      command: true);
    var peer = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.IssueCapabilityBoundaryAttestationAsync(
        peerRequest,
        fixture.ProcessId + 10,
        fixture.ProcessCreationTime,
        CancellationToken.None).AsTask());
    Assert.Equal("capability_attestation_peer_mismatch", peer.Code);

    fixture.PipeSecurity.Sha256 = string.Empty;
    var aclRequest = fixture.CreateCapabilityAttestationRequest(
      CapabilityBoundaryAttestationContract.CompanionServiceRole,
      browser: false,
      command: true);
    var acl = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.IssueCapabilityBoundaryAttestationAsync(
        aclRequest,
        fixture.ProcessId,
        fixture.ProcessCreationTime,
        CancellationToken.None).AsTask());
    Assert.Equal("capability_attestation_pipe_acl_invalid", acl.Code);

    fixture.PipeSecurity.Sha256 = new string('8', 64);
    File.WriteAllText(fixture.Options.KillSwitchPath, "disabled");
    var killedRequest = fixture.CreateCapabilityAttestationRequest(
      CapabilityBoundaryAttestationContract.CompanionServiceRole,
      browser: false,
      command: true);
    var killed = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.IssueCapabilityBoundaryAttestationAsync(
        killedRequest,
        fixture.ProcessId,
        fixture.ProcessCreationTime,
        CancellationToken.None).AsTask());
    Assert.Equal("egress_kill_switch_engaged", killed.Code);
  }

  [Theory]
  [InlineData(true, false)]
  [InlineData(true, true)]
  public async Task BrowserActivationStaysOffWithoutNativeBrowserEvidence(
    bool browser,
    bool command)
  {
    using var fixture = CreateFixture();
    await fixture.Engine.InitializeAsync(CancellationToken.None);
    var request = fixture.CreateCapabilityAttestationRequest(
      CapabilityBoundaryAttestationContract.SessionAgentRole,
      browser,
      command);

    var failure = await Assert.ThrowsAsync<EgressSupervisorException>(() =>
      fixture.Engine.IssueCapabilityBoundaryAttestationAsync(
        request,
        fixture.ProcessId,
        fixture.ProcessCreationTime,
        CancellationToken.None).AsTask());

    Assert.Equal("capability_attestation_feature_unavailable", failure.Code);
  }

  public void Dispose()
  {
    if (Directory.Exists(_directory))
    {
      Directory.Delete(_directory, recursive: true);
    }
  }

  private static string Sha256(string value) => Convert.ToHexString(
    SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

  private static string Sha256File(string path)
  {
    using var stream = new FileStream(
      path,
      FileMode.Open,
      FileAccess.Read,
      FileShare.ReadWrite | FileShare.Delete);
    return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
  }

  private static byte[] ReplaceAscii(byte[] value, string oldValue, string newValue) =>
    Encoding.ASCII.GetBytes(
      Encoding.ASCII.GetString(value).Replace(oldValue, newValue, StringComparison.Ordinal));

  private Fixture CreateFixture(
    TestSigningKeys? signingKeys = null,
    string? journalPath = null,
    bool dynamicDestination = false,
    IEgressDestinationResolver? destinationResolver = null)
  {
    var time = new MutableTimeProvider(
      new DateTimeOffset(2026, 8, 27, 10, 0, 0, TimeSpan.Zero));
    var deviceId = "11111111-1111-4111-8111-111111111111";
    var actionId = "22222222-2222-4222-8222-222222222222";
    var token = "test.action.token";
    var credentialReferenceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    var credentialRecordSha256 = new string('9', 64);
    var argumentsJson = dynamicDestination
      ? $$"""{"endpointId":"dynamic-email","destinationAuthority":"mandate_dynamic_https_v1","destinationUri":"https://api.itemba.com/v1/email/send","serverCertificateSha256":"{{new string('b', 64)}}","vaultReferenceId":"{{credentialReferenceId}}","vaultRecordSha256":"{{credentialRecordSha256}}","headerPrefix":"Bearer ","to":["recipient@example.test"],"subject":"Subject","text":"Body"}"""
      : "{\"endpointId\":\"email-test\",\"to\":[\"recipient@example.test\"],\"subject\":\"Subject\",\"text\":\"Body\"}";
    var destinationScopeSha256 = PayloadDigest.Sha256Hex(string.Join('\n',
      "itemba-external-action-destination/v1",
      "external.email.send",
      "email-test",
      "https://api.example.test/v1/email/send",
      new string('b', 64),
      "credential-vault",
      credentialReferenceId,
      "Bearer "));
    var policy = new EgressDestinationPolicy(dynamicDestination
      ? new EgressDestinationPolicyV1(
        1,
        "dynamic-test-policy",
        [],
        new EgressDynamicDestinationPolicyV1(
          Enabled: true,
          CapabilityIds: ["external.email.send"],
          AllowedPorts: [443],
          MaximumPathAndQueryLength: 512,
          MaximumRequestBodyBytes: 64 * 1_024,
          CredentialMode: "vault-reference-required",
          MaximumCredentialPrefixLength: 16))
      : new EgressDestinationPolicyV1(
        1,
        "test-policy",
        [
          new EgressDestinationPolicyEntryV1(
            "email-test",
            "external.email.send",
            "api.example.test",
            443,
            "/v1/email/send",
            new string('b', 64),
            credentialReferenceId,
            credentialRecordSha256,
            "Bearer ",
            destinationScopeSha256),
        ]));
    var binding = new EgressActionBinding(
      PayloadDigest.Sha256Hex(token),
      actionId,
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
      deviceId,
      "66666666-6666-4666-8666-666666666666",
      "external.email.send",
      "1.0.0",
      1,
      1_024,
      policy.Sha256,
      new string('c', 64),
      PayloadDigest.Sha256Hex(argumentsJson),
      new string('2', 64),
      PayloadDigest.Sha256Hex("test-idempotency"));
    var claims = new ActionTokenClaims
    {
      Issuer = "issuer",
      Audience = "audience",
      Subject = "subject",
      TokenId = Guid.NewGuid().ToString("D"),
      ActionId = binding.ActionId,
      TaskId = binding.TaskId,
      PlanVersionId = binding.PlanVersionId,
      StepId = binding.StepId,
      DeviceId = binding.DeviceId,
      MandateId = binding.MandateId,
      CapabilityId = binding.CapabilityId,
      CapabilityVersion = binding.CapabilityVersion,
      ArgumentsSha256 = binding.ArgumentsSha256,
      ExpectedPreStateSha256 = new string('2', 64),
      InputProvenanceSha256 = new string('3', 64),
      IdempotencyKey = "test-idempotency",
      LeaseId = Guid.NewGuid().ToString("D"),
      FencingToken = "1",
      LeaseExpiresAtUnixSeconds = time.GetUtcNow().AddMinutes(15).ToUnixTimeSeconds(),
      DispatchCount = 1,
      ExecutionMode = ActionExecutionModes.Execute,
      Budgets = new ActionBudget(
        120,
        1,
        1,
        1,
        1_024,
        3_072,
        1,
        BrokerMaxDeliverySessions: 2,
        BrokerMaxRequestAttemptsPerSession: 2,
        BrokerSerializedResultUpperBoundBytes: 512),
      IssuedAtUnixSeconds = time.GetUtcNow().ToUnixTimeSeconds(),
      ExpiresAtUnixSeconds = time.GetUtcNow().AddMinutes(10).ToUnixTimeSeconds(),
    };
    var tokenVerifier = new StubActionTokenVerifier(token, claims);
    var keys = signingKeys ?? new TestSigningKeys();
    var ownsKeys = signingKeys is null;
    var posture = new StubPostureProvider(new EgressHostPosture(
      deviceId,
      "77777777-7777-4777-8777-777777777777",
      "88888888-8888-4888-8888-888888888888",
      true,
      true,
      true,
      true,
      new string('4', 64),
      new string('5', 64),
      null,
      EgressBoundaryFeatures.CommandRequired));
    var journal = new DurableEgressJournal(
      journalPath ?? Path.Combine(_directory, $"{Guid.NewGuid():N}.jsonl"),
      time);
    var options = new EgressSupervisorOptions
    {
      Enabled = true,
      DeviceId = deviceId,
      CompanionImagePath =
        @"C:\Program Files\Itemba\Msaidizi\Itemba.Msaidizi.Companion.Service.exe",
      CompanionImageSha256 = new string('6', 64),
      AgentImagePath =
        @"C:\Program Files\Itemba\Msaidizi\Itemba.Msaidizi.Companion.Agent.exe",
      AgentImageSha256 = new string('7', 64),
      AttestationLifetimeSeconds = 300,
      CapabilityAttestationLifetimeSeconds = 60,
      LeaseLifetimeSeconds = 600,
      KillSwitchPath = Path.Combine(_directory, "DISABLED"),
    };
    var pipeSecurity = new StubPipeSecurityEvidence(new string('8', 64));
    var engine = new EgressSupervisorEngine(
      tokenVerifier,
      keys,
      posture,
      new StubProcessVerifier(4_242, 1_700_000_000_000),
      policy,
      journal,
      options,
      time,
      destinationResolver ?? new FixedDestinationResolver(),
      pipeSecurity);
    var reservation = new EgressReserveRequestPayload(
      EgressSupervisorLifecycleContract.Version,
      EgressSupervisorLifecycleCanonical.OperationId(actionId, "reserve"),
      token,
      argumentsJson,
      binding);
    return new Fixture(
      engine,
      journal,
      keys,
      ownsKeys,
      time,
      binding,
      reservation,
      deviceId,
      tokenVerifier,
      posture,
      options,
      pipeSecurity,
      4_242,
      1_700_000_000_000,
      RandomNumberGenerator.GetBytes(32));
  }

  private sealed class Fixture(
    EgressSupervisorEngine engine,
    DurableEgressJournal journal,
    TestSigningKeys signingKeys,
    bool ownsSigningKeys,
    MutableTimeProvider time,
    EgressActionBinding binding,
    EgressReserveRequestPayload reservation,
    string deviceId,
    StubActionTokenVerifier tokenVerifier,
    StubPostureProvider posture,
    EgressSupervisorOptions options,
    StubPipeSecurityEvidence pipeSecurity,
    int processId,
    long processCreationTime,
    byte[] connectionNonce) : IDisposable
  {
    public EgressSupervisorEngine Engine { get; } = engine;
    public DurableEgressJournal Journal { get; } = journal;
    public TestSigningKeys SigningKeys { get; } = signingKeys;
    public MutableTimeProvider Time { get; } = time;
    public EgressActionBinding Binding { get; } = binding;
    public EgressReserveRequestPayload Reservation { get; set; } = reservation;
    public string DeviceId { get; } = deviceId;
    public StubActionTokenVerifier TokenVerifier { get; } = tokenVerifier;
    public StubPostureProvider Posture { get; } = posture;
    public EgressSupervisorOptions Options { get; } = options;
    public StubPipeSecurityEvidence PipeSecurity { get; } = pipeSecurity;
    public int ProcessId { get; } = processId;
    public long ProcessCreationTime { get; } = processCreationTime;

    public CapabilityBoundaryAttestationRequestV1 CreateCapabilityAttestationRequest(
      string role,
      bool browser,
      bool command)
    {
      var agent = string.Equals(
        role,
        CapabilityBoundaryAttestationContract.SessionAgentRole,
        StringComparison.Ordinal);
      return new CapabilityBoundaryAttestationRequestV1(
        CapabilityBoundaryAttestationContract.Version,
        Guid.NewGuid().ToString("D"),
        PayloadDigest.Sha256Hex(Guid.NewGuid().ToString("D")),
        DeviceId,
        role,
        agent ? ProcessId + 1 : ProcessId,
        agent ? ProcessCreationTime + 1 : ProcessCreationTime,
        agent ? Options.AgentImageSha256 : Options.CompanionImageSha256,
        browser,
        command,
        StandardUserCapabilityCatalog.RequestedManifestSha256(browser, command),
        Binding.DestinationPolicySha256,
        CapabilityBoundaryAttestationContract.CapabilityCatalogVersion,
        EgressBoundaryCanonical.ContractVersion,
        EgressSupervisorWireProtocol.Version,
        SessionBridgeProtocol.Version,
        Time.GetUtcNow().ToUnixTimeMilliseconds());
    }

    public EgressDirectRegistrationV1 CreateRegistration(
      EgressExecutionAuthorization authorization) => new(
        EgressSupervisorLifecycleContract.Version,
        EgressSupervisorLifecycleCanonical.OperationId(
          Binding.ActionId,
          "direct-registration"),
        ProcessId,
        ProcessCreationTime,
        "https",
        "api.example.test",
        443,
        authorization.Lease.Lease.DestinationPolicySha256,
        authorization.Lease.Lease.DestinationScopeSha256,
        authorization.Lease.Lease.ReservationDnsAnswerSetSha256,
        Convert.ToHexString(SHA256.HashData(connectionNonce)).ToLowerInvariant());

    public EgressFlowOpenRequestV1 CreateFlowRequest(
      EgressExecutionAuthorization authorization,
      EgressDirectRegistrationV1 registration) => new(
        EgressSupervisorLifecycleContract.Version,
        EgressBoundaryCanonical.LeaseSha256(authorization.Lease.Lease),
        registration.RegistrationId,
        Convert.ToBase64String(connectionNonce),
        registration.DestinationHost,
        registration.DestinationPort,
        registration.DestinationScopeSha256);

    public ValueTask AttestRouteAsync(EgressFlowAuthorization flow) =>
      Engine.RecordDirectRouteAsync(
        flow,
        flow.ReservationDnsAnswerSetSha256,
        new string('9', 64),
        CancellationToken.None);

    public EgressTerminalDispositionV1 CreateDisposition(
      string outcome,
      long reportedBytes,
      bool uncertain) => new(
        EgressSupervisorLifecycleContract.Version,
        EgressSupervisorLifecycleCanonical.OperationId(Binding.ActionId, "settle"),
        outcome,
        reportedBytes,
        uncertain,
        Time.GetUtcNow().ToUnixTimeMilliseconds());

    public void Dispose()
    {
      CryptographicOperations.ZeroMemory(connectionNonce);
      Engine.Dispose();
      Journal.Dispose();
      if (ownsSigningKeys)
      {
        SigningKeys.Dispose();
      }
    }
  }

  private sealed class TestSigningKeys :
    IEgressSupervisorSigningKeys,
    IEgressAttestationKeyResolver
  {
    private readonly ECDsa _attestation = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private readonly ECDsa _receipt = ECDsa.Create(ECCurve.NamedCurves.nistP256);

    public TestSigningKeys()
    {
      var spki = _receipt.ExportSubjectPublicKeyInfo();
      try
      {
        ReceiptPublicKeySpkiBase64 = Convert.ToBase64String(spki);
        ReceiptPublicKeySha256 = Convert.ToHexString(SHA256.HashData(spki))
          .ToLowerInvariant();
      }
      finally
      {
        CryptographicOperations.ZeroMemory(spki);
      }
    }

    public string AttestationKeyId => "test-attestation-key";
    public string ReceiptKeyId => "test-receipt-key";
    public string ReceiptPublicKeySpkiBase64 { get; }
    public string ReceiptPublicKeySha256 { get; }

    public SignedBoundaryAttestation SignAttestation(BoundaryAttestationV1 attestation) =>
      EgressBoundaryCanonical.SignAttestation(attestation, AttestationKeyId, _attestation);

    public SignedCapabilityBoundaryAttestation SignCapabilityAttestation(
      CapabilityBoundaryAttestationV1 attestation) =>
      CapabilityBoundaryAttestationCanonical.Sign(
        attestation,
        AttestationKeyId,
        _attestation);

    public SignedEgressLease SignLease(EgressLeaseV1 lease) =>
      EgressBoundaryCanonical.SignLease(lease, ReceiptKeyId, _receipt);

    public SignedEgressReceipt SignReceipt(EgressReceiptV1 receipt) =>
      EgressBoundaryCanonical.SignReceipt(receipt, ReceiptKeyId, _receipt);

    public bool VerifyAttestation(SignedBoundaryAttestation attestation) =>
      Verify(
        _attestation,
        EgressBoundaryCanonical.AttestationBytes(attestation.Attestation),
        attestation.SignatureBase64)
      && string.Equals(attestation.KeyId, AttestationKeyId, StringComparison.Ordinal);

    public bool VerifyCapabilityAttestation(
      SignedCapabilityBoundaryAttestation attestation) =>
      CapabilityBoundaryAttestationCanonical.Verify(
        _attestation,
        CapabilityBoundaryAttestationCanonical.Bytes(attestation.Attestation),
        attestation.SignatureBase64)
      && string.Equals(attestation.KeyId, AttestationKeyId, StringComparison.Ordinal)
      && string.Equals(
        attestation.SignaturePurpose,
        CapabilityBoundaryAttestationContract.SignaturePurpose,
        StringComparison.Ordinal);

    public bool VerifyLease(SignedEgressLease lease) => Verify(
      _receipt,
      EgressBoundaryCanonical.LeaseBytes(lease.Lease),
      lease.SignatureBase64)
      && string.Equals(lease.KeyId, ReceiptKeyId, StringComparison.Ordinal);

    public bool VerifyReceipt(SignedEgressReceipt receipt) => Verify(
      _receipt,
      EgressBoundaryCanonical.ReceiptBytes(receipt.Receipt),
      receipt.SignatureBase64)
      && string.Equals(receipt.KeyId, ReceiptKeyId, StringComparison.Ordinal);

    public bool TryResolve(string keyId, out ECDsa? publicKey)
    {
      publicKey = null;
      if (!string.Equals(keyId, AttestationKeyId, StringComparison.Ordinal))
      {
        return false;
      }
      publicKey = ECDsa.Create();
      publicKey.ImportSubjectPublicKeyInfo(_attestation.ExportSubjectPublicKeyInfo(), out _);
      return true;
    }

    public void Dispose()
    {
      _attestation.Dispose();
      _receipt.Dispose();
    }

    private static bool Verify(ECDsa key, byte[] data, string signatureBase64)
    {
      try
      {
        return key.VerifyData(
          data,
          Convert.FromBase64String(signatureBase64),
          HashAlgorithmName.SHA256,
          DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(data);
      }
    }
  }

  private sealed class BlockingWriteStream : Stream
  {
    public bool CancellationObserved { get; private set; }

    public override bool CanRead => false;
    public override bool CanSeek => false;
    public override bool CanWrite => true;
    public override long Length => throw new NotSupportedException();
    public override long Position
    {
      get => throw new NotSupportedException();
      set => throw new NotSupportedException();
    }

    public override void Flush()
    {
    }

    public override int Read(byte[] buffer, int offset, int count) =>
      throw new NotSupportedException();

    public override long Seek(long offset, SeekOrigin origin) =>
      throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) =>
      throw new NotSupportedException();

    public override async ValueTask WriteAsync(
      ReadOnlyMemory<byte> buffer,
      CancellationToken cancellationToken = default)
    {
      try
      {
        await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
      }
      catch (OperationCanceledException)
      {
        CancellationObserved = true;
        throw;
      }
    }
  }

  private sealed class SequencedDestinationResolver(
    IEnumerable<ResolvedPublicDestination> results) : IEgressDestinationResolver
  {
    private readonly Queue<ResolvedPublicDestination> _results = new(results);

    public List<string> Hosts { get; } = [];

    public ValueTask<ResolvedPublicDestination> ResolvePublicAsync(
      string destinationHost,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      Hosts.Add(destinationHost);
      if (_results.Count == 0)
      {
        throw new InvalidOperationException("No resolver result remains.");
      }
      return ValueTask.FromResult(_results.Dequeue());
    }
  }

  private sealed class FixedDestinationResolver : IEgressDestinationResolver
  {
    private static readonly ResolvedPublicDestination Result =
      EgressRouteAttestation.Create([IPAddress.Parse("8.8.8.8")]);

    public ValueTask<ResolvedPublicDestination> ResolvePublicAsync(
      string destinationHost,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      return ValueTask.FromResult(Result);
    }
  }

  private sealed class RecordingTcpDialer : IEgressTcpDialer
  {
    public List<IPAddress> Addresses { get; } = [];
    public List<int> Ports { get; } = [];

    public ValueTask<IEgressOutboundConnection> ConnectAsync(
      IPAddress destinationAddress,
      int destinationPort,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      Addresses.Add(destinationAddress);
      Ports.Add(destinationPort);
      return ValueTask.FromResult<IEgressOutboundConnection>(new MemoryOutboundConnection());
    }
  }

  private sealed class MemoryOutboundConnection : IEgressOutboundConnection
  {
    public Stream Stream { get; } = new MemoryStream();

    public void Abort() => Stream.Dispose();

    public ValueTask DisposeAsync()
    {
      Stream.Dispose();
      return ValueTask.CompletedTask;
    }
  }

  private sealed class StubActionTokenVerifier(
    string token,
    ActionTokenClaims claims) : IActionTokenVerifier
  {
    public bool RejectAll { get; set; }

    public ActionTokenClaims Claims { get; set; } = claims;

    public int VerificationCount { get; private set; }

    public ValueTask<ActionTokenVerificationResult> VerifyAsync(
      string compactToken,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      VerificationCount++;
      return ValueTask.FromResult(!RejectAll
        && string.Equals(token, compactToken, StringComparison.Ordinal)
        ? ActionTokenVerificationResult.Valid(Claims)
        : ActionTokenVerificationResult.Invalid("token_signature_invalid"));
    }
  }

  private sealed class StubPostureProvider(EgressHostPosture posture) :
    IEgressHostPostureProvider
  {
    public EgressHostPosture Current { get; set; } = posture;

    public EgressHostPosture GetVerifiedPosture() => Current;
  }

  private sealed class StubProcessVerifier(int processId, long creationTime) :
    IEgressProcessIdentityVerifier
  {
    public bool IsExactLiveProcess(int candidateProcessId, long candidateCreationTime) =>
      candidateProcessId == processId && candidateCreationTime == creationTime;

    public bool IsExactMeasuredProcess(
      int candidateProcessId,
      long candidateCreationTime,
      string expectedImagePath,
      string expectedImageSha256) =>
      (candidateProcessId == processId
        && candidateCreationTime == creationTime
        && expectedImagePath.EndsWith(
          "Itemba.Msaidizi.Companion.Service.exe",
          StringComparison.Ordinal)
        && expectedImageSha256 == new string('6', 64))
      || (candidateProcessId == processId + 1
        && candidateCreationTime == creationTime + 1
        && expectedImagePath.EndsWith(
          "Itemba.Msaidizi.Companion.Agent.exe",
          StringComparison.Ordinal)
        && expectedImageSha256 == new string('7', 64));
  }

  private sealed class StubPipeSecurityEvidence(string sha256) :
    IEgressControlPipeSecurityEvidence
  {
    public string Sha256 { get; set; } = sha256;

    public string GetVerifiedSecurityDescriptorSha256() => Sha256;
  }

  private sealed class NoOpJournalProtection : IEgressJournalProtection
  {
    public static NoOpJournalProtection Instance { get; } = new();

    public void ValidatePreOpen(
      string directory,
      string journalPath,
      string lockPath)
    {
    }

    public void ValidateOpened(FileStream journal, FileStream ownershipLock)
    {
    }
  }

  public sealed class MutableTimeProvider(DateTimeOffset utcNow) : TimeProvider
  {
    private DateTimeOffset _utcNow = utcNow;

    public override DateTimeOffset GetUtcNow() => _utcNow;

    public void Advance(TimeSpan value) => _utcNow = _utcNow.Add(value);
  }

  private const uint TokenDuplicate = 0x0002;
  private const uint TokenQuery = 0x0008;

  [StructLayout(LayoutKind.Sequential)]
  private struct TestSidAndAttributes
  {
    public IntPtr Sid;
    public uint Attributes;
  }

  [DllImport("kernel32.dll")]
  private static extern IntPtr GetCurrentProcess();

  [DllImport("advapi32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool OpenProcessToken(
    IntPtr processHandle,
    uint desiredAccess,
    out SafeAccessTokenHandle tokenHandle);

  [DllImport("advapi32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool CreateRestrictedToken(
    SafeAccessTokenHandle existingTokenHandle,
    uint flags,
    uint disableSidCount,
    IntPtr sidsToDisable,
    uint deletePrivilegeCount,
    IntPtr privilegesToDelete,
    uint restrictedSidCount,
    [In] TestSidAndAttributes[] sidsToRestrict,
    out SafeAccessTokenHandle newTokenHandle);
}
