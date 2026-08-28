using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Agent.Capabilities;
using Itemba.Msaidizi.Companion.Agent.Channel;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Contracts.SessionBridge;
using Itemba.Msaidizi.Companion.Service.SessionBridge;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class SessionBridgeSecurityTests
{
  [Fact]
  public void CatalogIsClosedStrictAndExcludesTrustedRoot()
  {
    Assert.Equal(16, StandardUserCapabilityCatalog.All.Count);
    Assert.Equal(
      StandardUserCapabilityCatalog.All.Count,
      StandardUserCapabilityCatalog.All
        .Select(descriptor => $"{descriptor.Id}\u001f{descriptor.Version}")
        .Distinct(StringComparer.Ordinal)
        .Count());
    Assert.All(StandardUserCapabilityCatalog.All, descriptor =>
    {
      Assert.False(descriptor.TouchesTrustedRoot);
      Assert.Equal(RequiredPrivilege.StandardUser, descriptor.RequiredPrivilege);
      Assert.Equal(JsonValueKind.False,
        descriptor.ArgumentsSchema.GetProperty("additionalProperties").ValueKind);
      Assert.Equal(JsonValueKind.False,
        descriptor.ResultSchema.GetProperty("additionalProperties").ValueKind);
      if (descriptor.IsMutation)
      {
        Assert.NotEqual(ConsentRequirement.None, descriptor.Consent);
        Assert.NotEqual(RecoveryKind.NotApplicable, descriptor.Recovery);
      }
    });
  }

  [Fact]
  public void DefaultManifestOmitsEveryUnmeteredExternalEffect()
  {
    var enabled = StandardUserCapabilityCatalog.SelectEnabled(
      browserExternalEffectsEnabled: false,
      emergencyCommandEnabled: false);
    var ids = enabled.Select(descriptor => descriptor.Id).ToHashSet(StringComparer.Ordinal);

    Assert.Contains(StandardUserCapabilityCatalog.CameraCapture.Id, ids);
    Assert.Contains(StandardUserCapabilityCatalog.ForegroundInspect.Id, ids);
    Assert.Contains(StandardUserCapabilityCatalog.SpeechTranscribe.Id, ids);
    Assert.DoesNotContain(StandardUserCapabilityCatalog.MicrophoneCapture.Id, ids);
    Assert.Equal(
      ConsentRequirement.OneShotApproval,
      StandardUserCapabilityCatalog.SpeechTranscribe.Consent);
    Assert.DoesNotContain(StandardUserCapabilityCatalog.BrowserNavigate.Id, ids);
    Assert.DoesNotContain(StandardUserCapabilityCatalog.ElementInvoke.Id, ids);
    Assert.DoesNotContain(StandardUserCapabilityCatalog.BrowserFormTextSet.Id, ids);
    Assert.DoesNotContain(StandardUserCapabilityCatalog.BrowserFormSecretSet.Id, ids);
    Assert.DoesNotContain(StandardUserCapabilityCatalog.BrowserFileUpload.Id, ids);
    Assert.DoesNotContain(StandardUserCapabilityCatalog.BrowserDownloadInvoke.Id, ids);
    Assert.DoesNotContain(StandardUserCapabilityCatalog.EmergencyCommandExecute.Id, ids);

    Assert.Throws<InvalidOperationException>(() =>
      StandardUserCapabilityCatalog.SelectEnabled(
        browserExternalEffectsEnabled: true,
        emergencyCommandEnabled: false));
    Assert.Throws<InvalidOperationException>(() =>
      StandardUserCapabilityCatalog.SelectEnabled(
        browserExternalEffectsEnabled: false,
        emergencyCommandEnabled: true));
  }

  [Fact]
  public void PackagedConfigsDefaultExternalEffectsOffAndUseTheReviewedDigest()
  {
    AssertExternalEffectsDisabled("service-appsettings.json");
    AssertExternalEffectsDisabled("agent-appsettings.json");

    var reviewed = StandardUserCapabilityCatalog.SelectEnabled(
      browserExternalEffectsEnabled: false,
      emergencyCommandEnabled: false);
    var reviewedDigest = StandardUserCapabilityCatalog.ManifestSha256(reviewed);
    Assert.Equal(9, reviewed.Count);
    Assert.True(PayloadDigest.IsSha256Hex(reviewedDigest));
    Assert.Equal(
      reviewedDigest,
      StandardUserCapabilityCatalog.ManifestSha256(reviewed.Reverse()));
    Assert.NotEqual(
      StandardUserCapabilityCatalog.ManifestSha256(StandardUserCapabilityCatalog.All),
      reviewedDigest);
  }

  [Fact]
  public void EmergencyCommandRequiresStandardUserEmergencyGrantAndClosedArgv()
  {
    var descriptor = StandardUserCapabilityCatalog.EmergencyCommandExecute;
    Assert.Equal(RequiredPrivilege.StandardUser, descriptor.RequiredPrivilege);
    Assert.Equal(ConsentRequirement.EmergencyOperator, descriptor.Consent);
    Assert.Equal(CapabilityEffect.Irreversible, descriptor.Effect);
    Assert.Equal(RecoveryKind.Irreversible, descriptor.Recovery);

    using var valid = JsonDocument.Parse(
      """{"executable":"cmd","argv":["/d","/s","/c","echo hello"],"workingDirectoryId":"scratch"}""");
    using var rawEnvironment = JsonDocument.Parse(
      """{"executable":"cmd","argv":["/d","/s","/c","echo hello"],"workingDirectoryId":"scratch","environment":{"TOKEN":"raw"}}""");
    using var missingPrefix = JsonDocument.Parse(
      """{"executable":"cmd","argv":["/c","echo hello"],"workingDirectoryId":"scratch"}""");

    Assert.True(StandardUserCapabilityContractValidator.ValidateArguments(
      descriptor.Id,
      valid.RootElement).IsValid);
    Assert.False(StandardUserCapabilityContractValidator.ValidateArguments(
      descriptor.Id,
      rawEnvironment.RootElement).IsValid);
    Assert.False(StandardUserCapabilityContractValidator.ValidateArguments(
      descriptor.Id,
      missingPrefix.RootElement).IsValid);
    Assert.Throws<InvalidOperationException>(() =>
      StandardUserCommandPolicy.ValidateArguments(
        "cmd",
        ["/c", "echo hello"]));
  }

  private static void AssertExternalEffectsDisabled(string fileName)
  {
    var path = Path.Combine(AppContext.BaseDirectory, "test-assets", fileName);
    using var document = JsonDocument.Parse(File.ReadAllText(path));
    var sessionBridge = document.RootElement.GetProperty("SessionBridge");
    Assert.False(sessionBridge.GetProperty("BrowserExternalEffectsEnabled").GetBoolean());
    Assert.False(sessionBridge.GetProperty("EmergencyCommandEnabled").GetBoolean());
    Assert.Equal("Itemba.Msaidizi.Session.v2",
      sessionBridge.GetProperty("PipeName").GetString());
    if (document.RootElement.TryGetProperty("CapabilityBoundaryTrust", out var trust))
    {
      Assert.False(trust.GetProperty("Enabled").GetBoolean());
      Assert.Equal(string.Empty,
        trust.GetProperty("ExpectedSupervisorPipeSecuritySha256").GetString());
    }
  }

  [Fact]
  public void SecretEnvelopeAndJournalDtosNeverSerializePlaintext()
  {
    var key = RandomNumberGenerator.GetBytes(32);
    var plaintext = Encoding.UTF8.GetBytes("never-store-this-password");
    var referenceId = Guid.NewGuid().ToString("D");
    var originSha256 = PayloadDigest.Sha256Hex("https://itemba.example.invalid/");
    using var arguments = JsonDocument.Parse($$"""
      {
        "originId": "itemba",
        "originSha256": "{{originSha256}}",
        "processId": 123,
        "automationId": "password-field",
        "secretReferenceId": "{{referenceId}}"
      }
      """);
    var requirement = BrowserSecretDestination.Resolve(
      "browser.form.secret.set",
      arguments.RootElement)!;
    try
    {
      var envelope = SessionSecretEnvelopeProtection.Protect(
        key,
        "action-1",
        "browser.form.secret.set",
        requirement.BindingId,
        requirement.DestinationScopeSha256,
        plaintext);
      var context = new ActionExecutionContext(
        "action-1",
        "task-1",
        "plan-1",
        "step-1",
        "device-1",
        "mandate-1",
        "idempotency-1",
        new string('0', 64),
        null,
        new ActionBudget(60, 1, 1, 1, 1_048_576, 1_048_576, 1));
      var invocation = new SessionActionInvocation(
        "browser.form.secret.set",
        "1.0.0",
        context,
        arguments.RootElement.GetRawText(),
        [envelope],
        DateTimeOffset.UtcNow.AddMinutes(1));
      var payloadJson = JsonSerializer.Serialize(invocation);
      var frameJson = JsonSerializer.Serialize(new AuthenticatedSessionFrame(
        1,
        SessionBridgeProtocol.Execute,
        "action-1",
        payloadJson,
        new string('0', 64)));
      var journalDtoJson = JsonSerializer.Serialize(new ActionRequest(
        "action-1",
        "task-1",
        "plan-1",
        "step-1",
        "device-1",
        "mandate-1",
        "browser.form.secret.set",
        "1.0.0",
        arguments.RootElement.GetRawText(),
        PayloadDigest.Sha256Hex(arguments.RootElement.GetRawText()),
        new string('0', 64),
        null,
        "idempotency-1"));

      Assert.DoesNotContain("never-store-this-password", payloadJson, StringComparison.Ordinal);
      Assert.DoesNotContain("never-store-this-password", frameJson, StringComparison.Ordinal);
      Assert.DoesNotContain("never-store-this-password", journalDtoJson, StringComparison.Ordinal);
      Assert.Contains(referenceId, journalDtoJson, StringComparison.Ordinal);
      var recovered = SessionSecretEnvelopeProtection.Unprotect(
        key,
        "action-1",
        "browser.form.secret.set",
        envelope);
      try
      {
        Assert.Equal(plaintext, recovered);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(recovered);
      }
      Assert.ThrowsAny<CryptographicException>(() =>
        SessionSecretEnvelopeProtection.Unprotect(
          key,
          "action-1",
          "browser.file.upload",
          envelope));

      var agentCopy = Encoding.UTF8.GetBytes("agent-ephemeral-copy");
      var resolved = new SessionResolvedSecret("value", agentCopy);
      var resolvedDtoJson = JsonSerializer.Serialize(resolved);
      Assert.DoesNotContain("agent-ephemeral-copy", resolvedDtoJson, StringComparison.Ordinal);
      resolved.Dispose();
      Assert.All(agentCopy, value => Assert.Equal(0, value));
    }
    finally
    {
      CryptographicOperations.ZeroMemory(key);
      CryptographicOperations.ZeroMemory(plaintext);
    }
  }

  [Fact]
  public void BrowserSecretContractsRejectRawValuesPathsAndClipboardFallback()
  {
    var referenceId = Guid.NewGuid().ToString("D");
    var originSha256 = PayloadDigest.Sha256Hex("https://itemba.example.invalid/");
    using var form = JsonDocument.Parse($$"""
      {"originId":"itemba","originSha256":"{{originSha256}}","processId":7,"automationId":"password","secretReferenceId":"{{referenceId}}"}
      """);
    using var rawValue = JsonDocument.Parse($$"""
      {"originId":"itemba","originSha256":"{{originSha256}}","processId":7,"automationId":"password","secretReferenceId":"{{referenceId}}","value":"raw"}
      """);
    using var rawPath = JsonDocument.Parse($$"""
      {"originId":"itemba","originSha256":"{{originSha256}}","processId":7,"automationId":"upload","secretReferenceId":"{{referenceId}}","uploadRootId":"exports","path":"C:\\secret.txt"}
      """);

    Assert.True(StandardUserCapabilityContractValidator.ValidateArguments(
      "browser.form.secret.set",
      form.RootElement).IsValid);
    Assert.False(StandardUserCapabilityContractValidator.ValidateArguments(
      "browser.form.secret.set",
      rawValue.RootElement).IsValid);
    Assert.False(StandardUserCapabilityContractValidator.ValidateArguments(
      "browser.file.upload",
      rawPath.RootElement).IsValid);
    Assert.DoesNotContain(StandardUserCapabilityCatalog.All, descriptor =>
      descriptor.ArgumentsSchema.GetRawText().Contains(
        "clipboard",
        StringComparison.OrdinalIgnoreCase));
  }

  [Fact]
  public void BrowserTextContractIsBoundedClassifiedAndNeverReturnsPlaintext()
  {
    var originSha256 = PayloadDigest.Sha256Hex("https://itemba.example.invalid/");
    using var valid = JsonDocument.Parse($$"""
      {"originId":"itemba","originSha256":"{{originSha256}}","processId":7,"automationId":"customer-name","contentClass":"internal","text":"Ada"}
      """);
    using var credentialClass = JsonDocument.Parse($$"""
      {"originId":"itemba","originSha256":"{{originSha256}}","processId":7,"automationId":"password","contentClass":"credential","text":"raw-secret"}
      """);
    using var extraSecret = JsonDocument.Parse($$"""
      {"originId":"itemba","originSha256":"{{originSha256}}","processId":7,"automationId":"customer-name","contentClass":"internal","text":"Ada","secret":"raw-secret"}
      """);
    using var result = JsonDocument.Parse($$"""
      {"set":true,"contentSha256":"{{PayloadDigest.Sha256Hex("Ada")}}","destinationScopeSha256":"{{PayloadDigest.Sha256Hex("destination")}}"}
      """);

    Assert.True(StandardUserCapabilityContractValidator.ValidateArguments(
      StandardUserCapabilityCatalog.BrowserFormTextSet.Id,
      valid.RootElement).IsValid);
    Assert.False(StandardUserCapabilityContractValidator.ValidateArguments(
      StandardUserCapabilityCatalog.BrowserFormTextSet.Id,
      credentialClass.RootElement).IsValid);
    Assert.False(StandardUserCapabilityContractValidator.ValidateArguments(
      StandardUserCapabilityCatalog.BrowserFormTextSet.Id,
      extraSecret.RootElement).IsValid);
    Assert.True(StandardUserCapabilityContractValidator.ValidateResult(
      StandardUserCapabilityCatalog.BrowserFormTextSet.Id,
      result.RootElement).IsValid);
    Assert.DoesNotContain(
      "text",
      StandardUserCapabilityCatalog.BrowserFormTextSet.ResultSchema
        .GetProperty("properties")
        .EnumerateObject()
        .Select(property => property.Name));
    Assert.True(StandardUserCapabilityCatalog.RequiresEgressBoundary(
      StandardUserCapabilityCatalog.BrowserFormTextSet.Id));
  }

  [Fact]
  public void BrowserContractRejectsQueryFragmentCredentialsAndExtraFields()
  {
    using var valid = JsonDocument.Parse(
      """{"originId":"itemba","relativePath":"/sales/today"}""");
    using var query = JsonDocument.Parse(
      """{"originId":"itemba","relativePath":"/sales?token=secret"}""");
    using var fragment = JsonDocument.Parse(
      """{"originId":"itemba","relativePath":"/sales#confirm"}""");
    using var extra = JsonDocument.Parse(
      """{"originId":"itemba","relativePath":"/sales","credential":"raw"}""");

    Assert.True(StandardUserCapabilityContractValidator.ValidateArguments(
      "browser.uri.open",
      valid.RootElement).IsValid);
    Assert.False(StandardUserCapabilityContractValidator.ValidateArguments(
      "browser.uri.open",
      query.RootElement).IsValid);
    Assert.False(StandardUserCapabilityContractValidator.ValidateArguments(
      "browser.uri.open",
      fragment.RootElement).IsValid);
    Assert.False(StandardUserCapabilityContractValidator.ValidateArguments(
      "browser.uri.open",
      extra.RootElement).IsValid);
  }

  [Fact]
  public void DynamicBrowserDestinationsAreNotAdvertisedOrAcceptedWithoutLiveOriginContainment()
  {
    var originSha256 = PayloadDigest.Sha256Hex("https://itemba.example.invalid/");
    var referenceId = Guid.NewGuid().ToString("D");
    var cases = new (CapabilityDescriptor Descriptor, Dictionary<string, object?> Arguments)[]
    {
      (StandardUserCapabilityCatalog.BrowserNavigate, new()
      {
        ["originId"] = "itemba",
        ["relativePath"] = "/sales/today",
      }),
      (StandardUserCapabilityCatalog.BrowserFormTextSet, new()
      {
        ["originId"] = "itemba",
        ["originSha256"] = originSha256,
        ["processId"] = 7,
        ["automationId"] = "customer-name",
        ["contentClass"] = "internal",
        ["text"] = "Ada",
      }),
      (StandardUserCapabilityCatalog.BrowserFormSecretSet, new()
      {
        ["originId"] = "itemba",
        ["originSha256"] = originSha256,
        ["processId"] = 7,
        ["automationId"] = "password",
        ["secretReferenceId"] = referenceId,
      }),
      (StandardUserCapabilityCatalog.BrowserFileUpload, new()
      {
        ["originId"] = "itemba",
        ["originSha256"] = originSha256,
        ["processId"] = 7,
        ["automationId"] = "upload",
        ["secretReferenceId"] = referenceId,
        ["uploadRootId"] = "exports",
      }),
      (StandardUserCapabilityCatalog.BrowserDownloadInvoke, new()
      {
        ["originId"] = "itemba",
        ["originSha256"] = originSha256,
        ["processId"] = 7,
        ["automationId"] = "download",
        ["controlType"] = "Button",
      }),
    };

    foreach (var (descriptor, arguments) in cases)
    {
      Assert.DoesNotContain("destinationAuthority", descriptor.ArgumentsSchema.GetRawText());
      arguments["destinationAuthority"] = "mandate_dynamic_https_v1";
      arguments["origin"] = "https://reports.example.net/";
      Assert.False(StandardUserCapabilityContractValidator.ValidateArguments(
        descriptor.Id,
        JsonSerializer.SerializeToElement(arguments)).IsValid);
    }
  }

  [Fact]
  public void EphemeralKeyDerivationIsSymmetricAndTranscriptBound()
  {
    using var agent = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    using var service = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    var agentNonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    var serviceNonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    var transcript = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    var first = SessionBridgeAuthentication.DeriveSessionKey(
      agent,
      service.PublicKey,
      agentNonce,
      serviceNonce,
      transcript);
    var second = SessionBridgeAuthentication.DeriveSessionKey(
      service,
      agent.PublicKey,
      agentNonce,
      serviceNonce,
      transcript);
    try
    {
      Assert.True(CryptographicOperations.FixedTimeEquals(first, second));
      var original = SessionBridgeAuthentication.ComputeFrameMac(
        first,
        1,
        "execute",
        "action-1",
        "{}");
      var changed = SessionBridgeAuthentication.ComputeFrameMac(
        first,
        2,
        "execute",
        "action-1",
        "{}");
      Assert.False(SessionBridgeAuthentication.FixedTimeEqualsHex(original, changed));
    }
    finally
    {
      CryptographicOperations.ZeroMemory(first);
      CryptographicOperations.ZeroMemory(second);
    }
  }

  [Fact]
  public async Task WireCodecRoundTripsAndRejectsOversizedFrame()
  {
    await using var stream = new MemoryStream();
    var message = new SessionCancelInvocation(
      "action-1",
      "task-1",
      "test",
      DateTimeOffset.UtcNow);
    await SessionBridgeWire.WriteAsync(stream, message, 4_096, CancellationToken.None);
    stream.Position = 0;
    var decoded = await SessionBridgeWire.ReadAsync<SessionCancelInvocation>(
      stream,
      4_096,
      CancellationToken.None);
    Assert.Equal(message.ActionId, decoded.ActionId);

    await using var oversized = new MemoryStream();
    await Assert.ThrowsAsync<InvalidDataException>(() =>
      SessionBridgeWire.WriteAsync(
        oversized,
        new { content = new string('x', 4_096) },
        64,
        CancellationToken.None).AsTask());
  }

  [Fact]
  public void PipeAclDeniesNetworkAndGrantsOnlyAuthenticatedLocalClients()
  {
    var security = SessionPipeSecurity.Create();
    var rules = security.GetAccessRules(
        includeExplicit: true,
        includeInherited: false,
        typeof(SecurityIdentifier))
      .Cast<PipeAccessRule>()
      .ToArray();
    var network = new SecurityIdentifier(WellKnownSidType.NetworkSid, null);
    var system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
    var authenticated = new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null);

    Assert.Contains(rules, rule => rule.IdentityReference == network
      && rule.AccessControlType == AccessControlType.Deny
      && rule.PipeAccessRights.HasFlag(PipeAccessRights.ReadWrite));
    Assert.Contains(rules, rule => rule.IdentityReference == system
      && rule.AccessControlType == AccessControlType.Allow
      && rule.PipeAccessRights.HasFlag(PipeAccessRights.FullControl));
    Assert.Contains(rules, rule => rule.IdentityReference == authenticated
      && rule.AccessControlType == AccessControlType.Allow
      && rule.PipeAccessRights.HasFlag(PipeAccessRights.ReadWrite));
  }
}
