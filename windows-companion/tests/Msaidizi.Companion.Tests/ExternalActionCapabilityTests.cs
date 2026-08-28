using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class ExternalActionCapabilityTests : IDisposable
{
  private const string EndpointId = "email-gateway";
  private const string CredentialReference = "78ad31e5-b7d8-48f4-b606-bc6cd0e82c0f";
  private const string Pin = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  private static readonly string[] EmployeeRecipient = ["employee@example.com"];
  private readonly FakeExternalActionTransport _transport = new();

  [Fact]
  public async Task EmailSendsCredentialFreeExactTemplateForSupervisorOwnedTls()
  {
    var vault = new FakeSecretVault("secret-token");
    var policy = Policy("email", ExternalActionCapabilityCatalog.EmailSend.Id);
    var executor = new ExternalActionExecutor(
      policy,
      _transport,
      vault);
    var adapter = new ExternalEmailSendCapabilityAdapter();
    using var arguments = JsonDocument.Parse(
      """
      {
        "endpointId": "email-gateway",
        "to": ["employee@example.com"],
        "cc": [],
        "subject": "Inventory result",
        "text": "The governed task completed."
      }
      """);

    Assert.True(adapter.ValidateArguments(arguments.RootElement).IsValid);
    var governed = GovernedContext(adapter.Descriptor, maximumEgress: 100_000);
    var result = await ExecuteInternalsAsync(
      executor,
      adapter,
      "email",
      "external-email-action",
      governed,
      arguments.RootElement);

    Assert.True(result.MutationCommitted);
    Assert.False(result.OutcomeUncertain);
    Assert.Equal(_transport.CapturedRequest!.Length, result.ExternalEgressBytes);
    Assert.Single(result.Provenance);
    Assert.DoesNotContain("secret-token", result.OutputJson, StringComparison.Ordinal);
    Assert.DoesNotContain(
      "Authorization: ",
      Encoding.ASCII.GetString(_transport.CapturedRequest),
      StringComparison.Ordinal);
    Assert.Contains(
      $"Authorization-Reference: {CredentialReference}\r\n\r\n{{",
      Encoding.ASCII.GetString(_transport.CapturedRequest),
      StringComparison.Ordinal);
    Assert.Equal(1, _transport.InvocationCount);
    Assert.Null(vault.CapabilityId);
    var registration = Assert.IsType<EgressDirectRegistrationV1>(
      governed.Session.DirectRegistration);
    Assert.Equal(Environment.ProcessId, registration.ProcessId);
    Assert.True(registration.ProcessCreationTimeUnixMilliseconds > 0);
    Assert.Equal("gateway.example", registration.DestinationHost);
    Assert.Equal(443, registration.DestinationPort);
    Assert.Equal(
      governed.Context.EgressDestinationPolicySha256,
      registration.DestinationPolicySha256);
    Assert.Equal(
      policy.Resolve(EndpointId, adapter.Descriptor.Id).DestinationScopeSha256,
      registration.DestinationScopeSha256);
    using var output = JsonDocument.Parse(result.OutputJson);
    Assert.True(output.RootElement.GetProperty("confirmed").GetBoolean());
    Assert.True(adapter.ValidateResult(output.RootElement).IsValid);
  }

  [Fact]
  public async Task EmailConsumesDigestBoundArtifactAttachmentAndEmitsItsProvenance()
  {
    var policy = Policy("email", ExternalActionCapabilityCatalog.EmailSend.Id);
    var executor = new ExternalActionExecutor(
      policy,
      _transport,
      new FakeSecretVault("secret-token"));
    var adapter = new ExternalEmailSendCapabilityAdapter(executor);
    var governed = GovernedContext(adapter.Descriptor, maximumEgress: 500_000);
    var content = Encoding.UTF8.GetBytes("measured finance report");
    using var arguments = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      endpointId = EndpointId,
      to = EmployeeRecipient,
      subject = "Finance report",
      text = "The reviewed report is attached.",
      attachment = ArtifactEnvelope(governed.Context, content, "FILE", "report.txt"),
    }));

    Assert.True(adapter.ValidateArguments(arguments.RootElement).IsValid);
    var result = await adapter.ExecuteWithEgressAsync(
      governed.Context,
      arguments.RootElement,
      governed.Session,
      CancellationToken.None);

    Assert.True(result.MutationCommitted);
    Assert.Equal(2, result.Provenance.Count);
    Assert.Contains(result.Provenance, value =>
      value.SourceType == "governed-artifact-attachment"
      && value.ContentSha256 == Sha256Hex(content));
    var request = Encoding.ASCII.GetString(_transport.CapturedRequest!);
    Assert.Contains(Convert.ToBase64String(content), request, StringComparison.Ordinal);
    Assert.Contains("\"artifactId\":\"a1000000-0000-4000-8000-000000000001\"", request,
      StringComparison.Ordinal);
    CryptographicOperations.ZeroMemory(content);
  }

  [Fact]
  public async Task EmailRejectsArtifactWhoseDeviceScopeDoesNotMatchExecution()
  {
    var executor = new ExternalActionExecutor(
      Policy("email", ExternalActionCapabilityCatalog.EmailSend.Id),
      _transport,
      new FakeSecretVault("secret-token"));
    var adapter = new ExternalEmailSendCapabilityAdapter(executor);
    var governed = GovernedContext(adapter.Descriptor, maximumEgress: 500_000);
    var content = Encoding.UTF8.GetBytes("reviewed report");
    var wrongContext = governed.Context with
    {
      DeviceId = "a2000000-0000-4000-8000-000000000002",
    };
    using var arguments = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
      endpointId = EndpointId,
      to = EmployeeRecipient,
      subject = "Finance report",
      text = "The reviewed report is attached.",
      attachment = ArtifactEnvelope(wrongContext, content, "FILE", "report.txt"),
    }));

    Assert.True(adapter.ValidateArguments(arguments.RootElement).IsValid);
    var exception = await Assert.ThrowsAsync<HostPreconditionException>(async () =>
      await adapter.ExecuteWithEgressAsync(
        governed.Context,
        arguments.RootElement,
        governed.Session,
        CancellationToken.None));

    Assert.Equal("external_attachment_scope_invalid", exception.ErrorCode);
    Assert.Equal(0, _transport.InvocationCount);
    CryptographicOperations.ZeroMemory(content);
  }

  [Fact]
  public async Task CombinedEgressReserveRejectsBeforeNetworkDispatch()
  {
    var executor = new ExternalActionExecutor(
      Policy("email", ExternalActionCapabilityCatalog.EmailSend.Id),
      _transport,
      new FakeSecretVault("secret-token"));
    var adapter = new ExternalEmailSendCapabilityAdapter();
    using var arguments = JsonDocument.Parse(
      """
      {
        "endpointId": "email-gateway",
        "to": ["employee@example.com"],
        "subject": "A",
        "text": "B"
      }
      """);

    var governed = GovernedContext(adapter.Descriptor, maximumEgress: 4_096);
    var exception = await Assert.ThrowsAsync<HostPreconditionException>(async () =>
      await ExecuteInternalsAsync(
        executor,
        adapter,
        "email",
        "external-email-action",
        governed,
        arguments.RootElement));

    Assert.Equal("external_action_egress_budget_insufficient", exception.ErrorCode);
    Assert.Equal(0, _transport.InvocationCount);
    Assert.Equal(0, governed.Session.DirectRegistrationAttempts);
  }

  [Fact]
  public async Task ExplicitDynamicAuthorityCarriesExactDestinationIntoRegistration()
  {
    var policy = new ExternalActionPolicy(
      Options.Create(new ExternalActionOptions
      {
        Enabled = true,
        DynamicDestinationsEnabled = true,
        Endpoints = [],
      }),
      Options.Create(new CompanionOptions
      {
        EgressDestinationPolicySha256 = new string('d', 64),
      }));
    var executor = new ExternalActionExecutor(
      policy,
      _transport,
      new FakeSecretVault("secret-token"));
    var adapter = new ExternalEmailSendCapabilityAdapter(executor);
    using var arguments = JsonDocument.Parse(
      $$"""
      {
        "endpointId": "dynamic-email",
        "destinationAuthority": "mandate_dynamic_https_v1",
        "destinationUri": "https://api.itemba.com/v1/email/send",
        "serverCertificateSha256": "{{Pin}}",
        "vaultReferenceId": "{{CredentialReference}}",
        "vaultRecordSha256": "{{new string('f', 64)}}",
        "headerPrefix": "Bearer ",
        "to": ["employee@example.com"],
        "subject": "Inventory result",
        "text": "The governed task completed."
      }
      """);

    Assert.True(adapter.ValidateArguments(arguments.RootElement).IsValid);
    var governed = GovernedContext(adapter.Descriptor, maximumEgress: 100_000);
    var result = await adapter.ExecuteWithEgressAsync(
      governed.Context,
      arguments.RootElement,
      governed.Session,
      CancellationToken.None);

    Assert.True(result.MutationCommitted);
    var registration = Assert.IsType<EgressDirectRegistrationV1>(
      governed.Session.DirectRegistration);
    var exact = Assert.IsType<ExactExternalActionDestination>(
      registration.ExactDestination);
    Assert.True(exact.IsDynamic);
    Assert.Equal("https://api.itemba.com/v1/email/send", exact.AbsoluteHttpsUri);
    Assert.Equal("api.itemba.com", registration.DestinationHost);
    Assert.Contains(
      "POST /v1/email/send HTTP/1.1\r\nHost: api.itemba.com\r\n",
      Encoding.ASCII.GetString(_transport.CapturedRequest!),
      StringComparison.Ordinal);
  }

  [Fact]
  public void DynamicAuthorityRequiresProvisionedCanonicalSupervisorPolicyDigest()
  {
    var dynamicOptions = Options.Create(new ExternalActionOptions
    {
      Enabled = true,
      DynamicDestinationsEnabled = true,
      Endpoints = [],
    });

    var missing = Assert.Throws<InvalidOperationException>(() =>
      new ExternalActionPolicy(dynamicOptions));
    Assert.Contains("egress-policy digest", missing.Message, StringComparison.Ordinal);

    var nonCanonical = Assert.Throws<InvalidOperationException>(() =>
      new ExternalActionPolicy(
        dynamicOptions,
        Options.Create(new CompanionOptions
        {
          EgressDestinationPolicySha256 = new string('D', 64),
        })));
    Assert.Contains("egress-policy digest", nonCanonical.Message, StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("http://api.itemba.com/v1/send")]
  [InlineData("file:///C:/Windows/win.ini")]
  [InlineData("https://localhost/v1/send")]
  [InlineData("https://127.0.0.1/v1/send")]
  [InlineData("https://10.0.0.8/v1/send")]
  [InlineData("https://169.254.169.254/latest/meta-data")]
  [InlineData("https://user:pass@api.itemba.com/v1/send")]
  [InlineData("https://api.itemba.com\\server\\share")]
  public void DynamicAuthorityRejectsNonPublicAndCredentialBearingUris(string uri)
  {
    var adapter = new ExternalEmailSendCapabilityAdapter();
    using var arguments = JsonDocument.Parse(
      $$"""
      {
        "endpointId": "dynamic-email",
        "destinationAuthority": "mandate_dynamic_https_v1",
        "destinationUri": "{{uri.Replace("\\", "\\\\")}}",
        "serverCertificateSha256": "{{Pin}}",
        "vaultReferenceId": "{{CredentialReference}}",
        "vaultRecordSha256": "{{new string('f', 64)}}",
        "headerPrefix": "Bearer ",
        "to": ["employee@example.com"],
        "subject": "A",
        "text": "B"
      }
      """);

    Assert.False(adapter.ValidateArguments(arguments.RootElement).IsValid);
  }

  [Fact]
  public void DynamicAuthorityIsAllOrNothingForEveryExternalActionContract()
  {
    var common = new Dictionary<string, object?>
    {
      ["endpointId"] = "dynamic-action",
      ["destinationAuthority"] = "mandate_dynamic_https_v1",
      ["destinationUri"] = "https://api.itemba.com/v1/action",
      ["serverCertificateSha256"] = Pin,
      ["vaultReferenceId"] = CredentialReference,
      ["vaultRecordSha256"] = new string('f', 64),
      ["headerPrefix"] = "Bearer ",
    };
    var cases = new (IHostCapabilityAdapter Adapter, Dictionary<string, object?> Action)[]
    {
      (new ExternalEmailSendCapabilityAdapter(), new()
      {
        ["to"] = new[] { "employee@example.com" },
        ["subject"] = "Subject",
        ["text"] = "Body",
      }),
      (new ExternalMessageSendCapabilityAdapter(), new()
      {
        ["conversationId"] = "conversation-1",
        ["text"] = "Body",
      }),
      (new ExternalPublishCreateCapabilityAdapter(), new()
      {
        ["destinationId"] = "newsroom",
        ["title"] = "Title",
        ["content"] = "Body",
        ["visibility"] = "private",
      }),
      (new ExternalPurchaseSubmitCapabilityAdapter(), new()
      {
        ["vendorId"] = "vendor-1",
        ["currency"] = "USD",
        ["totalAmountMinor"] = 500L,
        ["items"] = new[]
        {
          new { sku = "sku-1", quantityMilli = 1_000L, unitAmountMinor = 500L },
        },
      }),
    };
    var dynamicFields = new[]
    {
      "destinationAuthority",
      "destinationUri",
      "serverCertificateSha256",
      "vaultReferenceId",
      "vaultRecordSha256",
      "headerPrefix",
    };

    foreach (var (adapter, action) in cases)
    {
      var dynamicRequired = adapter.Descriptor.ArgumentsSchema
        .GetProperty("oneOf")[1]
        .GetProperty("required")
        .EnumerateArray()
        .Select(value => value.GetString())
        .ToArray();
      Assert.Equal(dynamicFields, dynamicRequired);
      var complete = common.Concat(action).ToDictionary(pair => pair.Key, pair => pair.Value);
      Assert.True(adapter.ValidateArguments(JsonSerializer.SerializeToElement(complete)).IsValid);
      foreach (var field in dynamicFields)
      {
        var partial = new Dictionary<string, object?>(complete);
        partial.Remove(field);
        Assert.False(adapter.ValidateArguments(JsonSerializer.SerializeToElement(partial)).IsValid);
      }
    }
  }

  [Fact]
  public async Task MissingGatewayAcknowledgementBecomesUncertainWithoutRetry()
  {
    _transport.ReturnAcknowledgement = false;
    var executor = new ExternalActionExecutor(
      Policy("email", ExternalActionCapabilityCatalog.EmailSend.Id),
      _transport,
      new FakeSecretVault("secret-token"));
    var adapter = new ExternalEmailSendCapabilityAdapter();
    using var arguments = JsonDocument.Parse(
      """
      {
        "endpointId": "email-gateway",
        "to": ["employee@example.com"],
        "subject": "A",
        "text": "B"
      }
      """);

    var governed = GovernedContext(adapter.Descriptor, maximumEgress: 100_000);
    var result = await ExecuteInternalsAsync(
      executor,
      adapter,
      "email",
      "external-email-action",
      governed,
      arguments.RootElement);

    Assert.False(result.MutationCommitted);
    Assert.True(result.OutcomeUncertain);
    Assert.True(result.ExternalEgressBytes > 0);
    Assert.Equal(1, _transport.InvocationCount);
  }

  [Fact]
  public void ContractsRejectUnknownFieldsAndMismatchedPurchaseTotals()
  {
    var email = new ExternalEmailSendCapabilityAdapter();
    using var unknown = JsonDocument.Parse(
      """
      {
        "endpointId": "email-gateway",
        "to": ["employee@example.com"],
        "subject": "A",
        "text": "B",
        "rawCredential": "must-not-pass"
      }
      """);
    Assert.False(email.ValidateArguments(unknown.RootElement).IsValid);

    var purchase = new ExternalPurchaseSubmitCapabilityAdapter();
    using var mismatch = JsonDocument.Parse(
      """
      {
        "endpointId": "email-gateway",
        "vendorId": "vendor-1",
        "currency": "USD",
        "totalAmountMinor": 999,
        "items": [{ "sku": "sku-1", "quantityMilli": 1000, "unitAmountMinor": 500 }]
      }
      """);
    Assert.Equal(
      "external_purchase_total_mismatch",
      purchase.ValidateArguments(mismatch.RootElement).ErrorCode);
  }

  [Fact]
  public void PublishRejectsNonStringVisibilityWithoutThrowing()
  {
    var publish = new ExternalPublishCreateCapabilityAdapter();
    using var invalid = JsonDocument.Parse(
      """
      {
        "endpointId": "email-gateway",
        "destinationId": "newsroom",
        "title": "Quarterly update",
        "content": "Governed content",
        "visibility": 1
      }
      """);

    var validation = publish.ValidateArguments(invalid.RootElement);

    Assert.False(validation.IsValid);
    Assert.Equal("external_publish_arguments_invalid", validation.ErrorCode);
  }

  [Fact]
  public void FinancialEffectMayTruthfullyDeclareIrreversibleRecovery()
  {
    var descriptor = ExternalActionCapabilityCatalog.PurchaseSubmit;
    Assert.Equal(CapabilityEffect.Financial, descriptor.Effect);
    Assert.Equal(RecoveryKind.Irreversible, descriptor.Recovery);
    var registry = new CapabilityRegistry(
      [new ExternalPurchaseSubmitCapabilityAdapter()]);
    Assert.Contains(registry.Descriptors, value => value.Id == descriptor.Id);
  }

  [Fact]
  public void PolicyRejectsCrossOriginPathsAndMalformedCredentialReferences()
  {
    Assert.Throws<InvalidOperationException>(() => new ExternalActionPolicy(Options.Create(new
      ExternalActionOptions
    {
      Enabled = true,
      Endpoints =
        [
          Endpoint("email", "//attacker.invalid/submit"),
        ],
    })));
    var malformed = Endpoint("email", "/v1/action");
    malformed.CredentialReferenceId = "not-a-uuid";
    Assert.Throws<InvalidOperationException>(() => new ExternalActionPolicy(Options.Create(new
      ExternalActionOptions
    {
      Enabled = true,
      Endpoints = [malformed],
    })));
    var missing = Endpoint("email", "/v1/action");
    missing.CredentialReferenceId = string.Empty;
    Assert.Throws<InvalidOperationException>(() => new ExternalActionPolicy(Options.Create(new
      ExternalActionOptions
    {
      Enabled = true,
      Endpoints = [missing],
    })));
  }

  [Fact]
  public async Task Ipv6DestinationUsesAnUnambiguousBracketedHostHeader()
  {
    var endpoint = Endpoint("email", "/v1/action");
    endpoint.Origin = "https://[::1]:8443/";
    var policy = new ExternalActionPolicy(Options.Create(new ExternalActionOptions
    {
      Enabled = true,
      Endpoints = [endpoint],
    }));
    var executor = new ExternalActionExecutor(
      policy,
      _transport,
      new FakeSecretVault("secret-token"));
    var adapter = new ExternalEmailSendCapabilityAdapter();
    using var arguments = JsonDocument.Parse(
      """
      {
        "endpointId": "email-gateway",
        "to": ["employee@example.com"],
        "subject": "A",
        "text": "B"
      }
      """);

    var governed = GovernedContext(adapter.Descriptor, 100_000);
    await ExecuteInternalsAsync(
      executor,
      adapter,
      "email",
      "external-email-action",
      governed,
      arguments.RootElement);

    Assert.Contains(
      "\r\nHost: [::1]:8443\r\n",
      Encoding.ASCII.GetString(_transport.CapturedRequest!),
      StringComparison.Ordinal);
  }

  [Fact]
  public async Task DirectExecutionWithoutLifecycleSessionFailsBeforeSecretOrNetwork()
  {
    var vault = new FakeSecretVault("secret-token");
    var adapter = new ExternalEmailSendCapabilityAdapter();
    using var arguments = JsonDocument.Parse(
      """
      {
        "endpointId": "email-gateway",
        "to": ["employee@example.com"],
        "subject": "A",
        "text": "B"
      }
      """);

    var exception = await Assert.ThrowsAsync<HostPreconditionException>(async () =>
      await adapter.ExecuteAsync(
        GovernedContext(adapter.Descriptor, 100_000).Context,
        arguments.RootElement,
        CancellationToken.None));

    Assert.Equal("egress_supervisor_flow_handle_required", exception.ErrorCode);
    Assert.Equal(0, _transport.InvocationCount);
    Assert.Null(vault.CapabilityId);
  }

  [Theory]
  [InlineData(false, false)]
  [InlineData(true, true)]
  public async Task MissingOrWrongSupervisorAcknowledgementPreventsNetworkDispatch(
    bool returnAcknowledgement,
    bool corruptAcknowledgement)
  {
    var executor = new ExternalActionExecutor(
      Policy("email", ExternalActionCapabilityCatalog.EmailSend.Id),
      _transport,
      new FakeSecretVault("secret-token"));
    var adapter = new ExternalEmailSendCapabilityAdapter();
    var governed = GovernedContext(adapter.Descriptor, 100_000);
    governed.Session.ReturnAcknowledgement = returnAcknowledgement;
    governed.Session.CorruptAcknowledgement = corruptAcknowledgement;
    using var arguments = JsonDocument.Parse(
      """
      {
        "endpointId": "email-gateway",
        "to": ["employee@example.com"],
        "subject": "A",
        "text": "B"
      }
      """);

    var exception = await Assert.ThrowsAsync<HostPreconditionException>(async () =>
      await ExecuteInternalsAsync(
        executor,
        adapter,
        "email",
        "external-email-action",
        governed,
        arguments.RootElement));

    Assert.Equal("egress_direct_registration_not_acknowledged", exception.ErrorCode);
    Assert.Equal(1, governed.Session.DirectRegistrationAttempts);
    Assert.Equal(0, _transport.InvocationCount);
  }

  public void Dispose()
  {
    if (_transport.CapturedRequest is not null)
    {
      CryptographicOperations.ZeroMemory(_transport.CapturedRequest);
    }
  }

  private static ExternalActionPolicy Policy(string kind, string capabilityId)
  {
    var policy = new ExternalActionPolicy(Options.Create(new ExternalActionOptions
    {
      Enabled = true,
      Endpoints = [Endpoint(kind, "/v1/action")],
    }));
    Assert.Equal(capabilityId, policy.Resolve(EndpointId, capabilityId).CapabilityId);
    return policy;
  }

  private static ValueTask<CapabilityExecutionResult> ExecuteInternalsAsync(
    ExternalActionExecutor executor,
    ExternalActionCapabilityAdapter adapter,
    string endpointKind,
    string provenanceType,
    GovernedExecution governed,
    JsonElement arguments)
  {
    var validation = adapter.ValidateArguments(arguments);
    if (!validation.IsValid)
    {
      throw new HostPreconditionException(validation.ErrorCode ?? "external_arguments_invalid");
    }
    return executor.ExecuteAsync(
      adapter.Descriptor,
      endpointKind,
      provenanceType,
      governed.Context,
      governed.Session,
      arguments.GetProperty("endpointId").GetString()!,
      ExternalActionContractValidator.CanonicalPayload(adapter.Descriptor.Id, arguments),
      CancellationToken.None);
  }

  private static ExternalActionEndpointOptions Endpoint(string kind, string path) => new()
  {
    Id = EndpointId,
    Kind = kind,
    Origin = "https://gateway.example/",
    RelativePath = path,
    ServerCertificateSha256Pin = Pin,
    CredentialReferenceId = CredentialReference,
    CredentialRecordSha256 = new string('f', 64),
    CredentialPrefix = "Bearer ",
  };

  private static Dictionary<string, object?> ArtifactEnvelope(
    ActionExecutionContext context,
    byte[] content,
    string kind,
    string name)
  {
    const string sourceStepId = "a3000000-0000-4000-8000-000000000003";
    const string sourceAttemptId = "attempt-source-1";
    const string artifactId = "a1000000-0000-4000-8000-000000000001";
    var digest = Sha256Hex(content);
    var scope = GovernedArtifactEnvelope.ScopeSha256(
      context.TaskId,
      context.PlanVersionId,
      context.StepId,
      context.DeviceId,
      sourceStepId,
      sourceAttemptId,
      artifactId,
      digest,
      content.Length,
      "text/plain",
      name,
      kind,
      "Confidential");
    return new Dictionary<string, object?>
    {
      ["schemaVersion"] = 1,
      ["taskId"] = context.TaskId,
      ["planVersionId"] = context.PlanVersionId,
      ["targetStepId"] = context.StepId,
      ["deviceId"] = context.DeviceId,
      ["sourceStepId"] = sourceStepId,
      ["sourceAttemptId"] = sourceAttemptId,
      ["artifactId"] = artifactId,
      ["sha256"] = digest,
      ["byteSize"] = content.Length,
      ["mimeType"] = "text/plain",
      ["name"] = name,
      ["kind"] = kind,
      ["dataClass"] = "Confidential",
      ["scopeSha256"] = scope,
      ["contentBase64"] = Convert.ToBase64String(content),
    };
  }

  private static GovernedExecution GovernedContext(
    CapabilityDescriptor descriptor,
    long maximumEgress)
  {
    const string actionTokenSha256 =
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const string destinationPolicySha256 =
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    const string executionIdentitySha256 =
      "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    var now = DateTimeOffset.UtcNow;
    var attestation = new BoundaryAttestationV1(
      EgressBoundaryCanonical.ContractVersion,
      "10000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000002",
      "30000000-0000-4000-8000-000000000003",
      "40000000-0000-4000-8000-000000000004",
      now.AddMinutes(-1).ToUnixTimeMilliseconds(),
      now.AddMinutes(2).ToUnixTimeMilliseconds(),
      true,
      true,
      true,
      true,
      new string('1', 64),
      new string('2', 64),
      null,
      "receipt-key",
      Convert.ToBase64String([1]),
      new string('3', 64),
      EgressBoundaryFeatures.CommandRequired);
    var signedAttestation = new SignedBoundaryAttestation(
      attestation,
      "attestation-key",
      Convert.ToBase64String([1]));
    var lease = new EgressLeaseV1(
      EgressBoundaryCanonical.ContractVersion,
      "50000000-0000-4000-8000-000000000005",
      EgressBoundaryCanonical.AttestationSha256(attestation),
      actionTokenSha256,
      "60000000-0000-4000-8000-000000000006",
      "70000000-0000-4000-8000-000000000007",
      "80000000-0000-4000-8000-000000000008",
      "90000000-0000-4000-8000-000000000009",
      attestation.DeviceId,
      "a0000000-0000-4000-8000-00000000000a",
      descriptor.Id,
      descriptor.Version,
      1,
      destinationPolicySha256,
      executionIdentitySha256,
      new string('a', 64),
      new string('b', 64),
      PayloadDigest.Sha256Hex("idempotency-1"),
      new string('c', 64),
      new string('d', 64),
      new string('f', 64),
      new string('1', 64),
      maximumEgress,
      now.AddSeconds(-10).ToUnixTimeMilliseconds(),
      now.AddMinutes(1).ToUnixTimeMilliseconds());
    var authorization = new EgressExecutionAuthorization(
      signedAttestation,
      new SignedEgressLease(lease, "receipt-key", Convert.ToBase64String([1])));
    var context = new ActionExecutionContext(
      lease.ActionId,
      lease.TaskId,
      lease.PlanVersionId,
      lease.StepId,
      lease.DeviceId,
      lease.MandateId,
      "idempotency-1",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      null,
      new ActionBudget(300, 5, 5, 1, 100_000, maximumEgress, 1),
      actionTokenSha256,
      1,
      authorization,
      destinationPolicySha256,
      executionIdentitySha256);
    return new GovernedExecution(context, new FakeEgressBoundarySession(authorization));
  }

  private sealed record GovernedExecution(
    ActionExecutionContext Context,
    FakeEgressBoundarySession Session);

  private sealed class FakeEgressBoundarySession(
    EgressExecutionAuthorization authorization) : IEgressBoundarySession
  {
    public EgressExecutionAuthorization Authorization { get; } = authorization;

    public bool ReturnAcknowledgement { get; set; } = true;

    public bool CorruptAcknowledgement { get; set; }

    public int DirectRegistrationAttempts { get; private set; }

    public EgressDirectRegistrationV1? DirectRegistration { get; private set; }

    public bool HasRegistration { get; private set; }

    public bool IsTerminal => false;

    public SignedEgressReceipt? TerminalReceipt => null;

    public ValueTask<EgressRegistrationAcknowledgementV1?> TryRegisterProcessAsync(
      EgressProcessRegistrationV1 registration,
      CancellationToken cancellationToken) => throw new NotSupportedException();

    public ValueTask<EgressRegistrationAcknowledgementV1?> TryRegisterDirectAsync(
      EgressDirectRegistrationV1 registration,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      DirectRegistrationAttempts++;
      DirectRegistration = registration;
      if (!ReturnAcknowledgement)
      {
        return ValueTask.FromResult<EgressRegistrationAcknowledgementV1?>(null);
      }

      var digest = EgressSupervisorLifecycleCanonical.RegistrationSha256(registration);
      var acknowledgement = new EgressRegistrationAcknowledgementV1(
        EgressSupervisorLifecycleContract.Version,
        EgressSupervisorLifecycleCanonical.OperationId(
          Authorization.Lease.Lease.ActionId,
          $"register:{EgressSupervisorLifecycleContract.DirectRegistration}:{registration.RegistrationId}"),
        registration.RegistrationId,
        EgressSupervisorLifecycleContract.DirectRegistration,
        EgressBoundaryCanonical.LeaseSha256(Authorization.Lease.Lease),
        CorruptAcknowledgement ? new string('f', 64) : digest,
        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
      HasRegistration = !CorruptAcknowledgement;
      return ValueTask.FromResult<EgressRegistrationAcknowledgementV1?>(acknowledgement);
    }

    public ValueTask<EgressRegistrationAcknowledgementV1?> TryRegisterBrowserAsync(
      EgressBrowserRegistrationV1 registration,
      CancellationToken cancellationToken) => throw new NotSupportedException();

    public ValueTask<SignedEgressReceipt?> TrySettleAsync(
      EgressTerminalDispositionV1 disposition,
      CancellationToken cancellationToken) => throw new NotSupportedException();

    public ValueTask<SignedEgressReceipt?> TryAbortAsync(
      EgressTerminalDispositionV1 disposition,
      CancellationToken cancellationToken) => throw new NotSupportedException();

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
  }

  private sealed class FakeExternalActionTransport : IExternalActionTransport
  {
    public int InvocationCount { get; private set; }

    public byte[]? CapturedRequest { get; private set; }

    public bool ReturnAcknowledgement { get; set; } = true;

    public ValueTask<ExternalActionTransportResult> SendAsync(
      ExternalActionEndpoint endpoint,
      ExternalActionEgressFlowBinding flowBinding,
      ReadOnlyMemory<byte> requestBytes,
      int maximumResponseBytes,
      TimeSpan connectTimeout,
      CancellationToken cancellationToken)
    {
      InvocationCount++;
      CapturedRequest = requestBytes.ToArray();
      var request = Encoding.ASCII.GetString(requestBytes.Span);
      var separator = request.IndexOf("\r\n\r\n", StringComparison.Ordinal);
      var body = requestBytes.Span[(separator + 4)..];
      var idempotencyKey = Header(request, "Idempotency-Key");
      var expectedPreState = Header(request, "X-Itemba-Expected-Pre-State-Sha256");
      var bodySha256 = Sha256Hex(body);
      var acknowledgement = ReturnAcknowledgement
        ? string.Join("\r\n",
          $"X-Itemba-Idempotency-Key-Sha256: {Sha256Hex(idempotencyKey)}",
          $"X-Itemba-Request-Sha256: {bodySha256}",
          $"X-Itemba-Expected-Pre-State-Sha256: {expectedPreState}",
          $"X-Itemba-Post-State-Sha256: {'d'.ToString().PadLeft(64, 'd')}")
        : "X-Itemba-Acknowledgement: missing";
      var response = Encoding.ASCII.GetBytes(string.Join("\r\n",
        "HTTP/1.1 200 OK",
        acknowledgement,
        "Content-Length: 0",
        "Connection: close",
        string.Empty,
        string.Empty));
      return ValueTask.FromResult(new ExternalActionTransportResult(
        true,
        requestBytes.Length,
        response,
        "response_received"));
    }

    private static string Header(string request, string name)
    {
      var prefix = $"{name}: ";
      return request.Split("\r\n")
        .Single(line => line.StartsWith(prefix, StringComparison.Ordinal))[prefix.Length..];
    }
  }

  private sealed class FakeSecretVault(string secret) : IHostSecretReferenceVault
  {
    public string? CapabilityId { get; private set; }

    public string? ScopeSha256 { get; private set; }

    public ValueTask<T> UseAsync<T>(
      string vaultReferenceId,
      string capabilityId,
      string scopeSha256,
      Func<ReadOnlyMemory<byte>, CancellationToken, ValueTask<T>> consumer,
      CancellationToken cancellationToken)
    {
      Assert.Equal(CredentialReference, vaultReferenceId);
      CapabilityId = capabilityId;
      ScopeSha256 = scopeSha256;
      var bytes = Encoding.ASCII.GetBytes(secret);
      return UseAndZeroAsync(bytes, consumer, cancellationToken);
    }

    private static async ValueTask<T> UseAndZeroAsync<T>(
      byte[] bytes,
      Func<ReadOnlyMemory<byte>, CancellationToken, ValueTask<T>> consumer,
      CancellationToken cancellationToken)
    {
      try
      {
        return await consumer(bytes, cancellationToken);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(bytes);
      }
    }
  }

  private static string Sha256Hex(string value) => Sha256Hex(Encoding.UTF8.GetBytes(value));

  private static string Sha256Hex(ReadOnlySpan<byte> value) =>
    Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();
}
