using System.Reflection;
using System.Security;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Itemba.Msaidizi.Installer.Hardening;

internal enum ConfigurationTrustMode
{
  FirstInstall,
  TrustedLegacyInstall,
  TrustedMarkedInstall,
}

internal static class ConfigurationProvenance
{
  public const int MaximumConfigurationBytes = 1_048_576;
  public const string MarkerFileName = ".installer-provenance.v1.json";

  private const string ResourcePrefix = "Itemba.Msaidizi.InstallerDefaults.";
  private const string MarkerText =
    "{\"schemaVersion\":1,\"product\":\"Itemba.Msaidizi.WindowsCompanion\"," +
    "\"configurationPolicy\":\"system-owned-preserved-config-v1\"}\n";

  public static IReadOnlyList<string> ConfigurationNames { get; } =
    [
      "service",
      "agent",
      "update",
      "recovery",
      "audit-signer",
      "egress-supervisor",
      "privileged-command-supervisor",
    ];

  public static byte[] MarkerBytes { get; } = Encoding.UTF8.GetBytes(MarkerText);

  public static string MarkerPath(InstallLayout layout) =>
    layout.PathInDataRoot("config", MarkerFileName);

  public static string ConfigurationPath(InstallLayout layout, string name) =>
    layout.PathInDataRoot("config", name, "appsettings.json");

  public static void ValidateConfiguration(
    string name,
    byte[] actual,
    bool requirePackagedSafeContent)
  {
    if (actual.Length == 0 || actual.Length > MaximumConfigurationBytes)
      throw new InvalidDataException($"The preserved {name} configuration has an invalid size.");

    ValidateUnambiguousJson(actual, name, out var document);
    using (document)
    {
      if (requirePackagedSafeContent)
      {
        var expected = ReadPackagedConfiguration(name);
        var actualDigest = SHA256.HashData(actual);
        var expectedDigest = SHA256.HashData(expected);
        if (!CryptographicOperations.FixedTimeEquals(actualDigest, expectedDigest)
          || !actual.AsSpan().SequenceEqual(expected))
        {
          throw new SecurityException(
            $"A first-install {name} configuration was not supplied by the signed package.");
        }
        ValidateFailClosedContent(name, document.RootElement);
      }
    }
  }

  public static void ValidateMarker(byte[] actual)
  {
    if (!actual.AsSpan().SequenceEqual(MarkerBytes))
      throw new SecurityException("The preserved installer-provenance marker is invalid.");
  }

  public static void ValidateFirstInstallInventory(
    InstallLayout layout,
    IEnumerable<string> allowedDirectoryRelativePaths)
  {
    var allowedDirectories = new HashSet<string>(
      allowedDirectoryRelativePaths.Select(NormalizeRelative),
      StringComparer.OrdinalIgnoreCase)
    {
      ".",
    };
    var allowedFiles = new HashSet<string>(
      ConfigurationNames.Select(name => NormalizeRelative(
        Path.Combine("config", name, "appsettings.json"))),
      StringComparer.OrdinalIgnoreCase);

    var pending = new Stack<string>();
    pending.Push(layout.DataRoot);
    while (pending.Count > 0)
    {
      var directory = pending.Pop();
      foreach (var entry in Directory.EnumerateFileSystemEntries(directory))
      {
        var attributes = File.GetAttributes(entry);
        if ((attributes & FileAttributes.ReparsePoint) != 0)
          throw new SecurityException("First-install ProgramData cannot contain a reparse point.");

        var relative = NormalizeRelative(Path.GetRelativePath(layout.DataRoot, entry));
        if ((attributes & FileAttributes.Directory) != 0)
        {
          if (!allowedDirectories.Contains(relative))
            throw new SecurityException(
              $"First-install ProgramData contains an unexpected directory: {relative}");
          pending.Push(entry);
        }
        else if (!allowedFiles.Contains(relative))
        {
          throw new SecurityException(
            $"First-install ProgramData contains an unexpected file: {relative}");
        }
      }
    }
  }

  internal static byte[] ReadPackagedConfiguration(string name)
  {
    if (!ConfigurationNames.Contains(name, StringComparer.Ordinal))
      throw new ArgumentException("The configuration name is not allowlisted.", nameof(name));

    var resourceName = ResourcePrefix + name + ".appsettings.json";
    using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName)
      ?? throw new InvalidOperationException(
        $"The signed installer is missing its embedded {name} configuration baseline.");
    if (stream.Length <= 0 || stream.Length > MaximumConfigurationBytes)
      throw new InvalidDataException("An embedded installer configuration has an invalid size.");

    var result = new byte[checked((int)stream.Length)];
    stream.ReadExactly(result);
    return result;
  }

  private static void ValidateUnambiguousJson(
    byte[] bytes,
    string name,
    out JsonDocument document)
  {
    try
    {
      document = JsonDocument.Parse(bytes, new JsonDocumentOptions
      {
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = 64,
      });
    }
    catch (JsonException error)
    {
      throw new InvalidDataException($"The preserved {name} configuration is invalid JSON.", error);
    }

    try
    {
      if (document.RootElement.ValueKind != JsonValueKind.Object)
        throw new InvalidDataException($"The preserved {name} configuration must be a JSON object.");
      RejectDuplicateProperties(document.RootElement, name);
    }
    catch
    {
      document.Dispose();
      throw;
    }
  }

  private static void RejectDuplicateProperties(JsonElement element, string name)
  {
    if (element.ValueKind == JsonValueKind.Object)
    {
      var properties = new HashSet<string>(StringComparer.Ordinal);
      foreach (var property in element.EnumerateObject())
      {
        if (!properties.Add(property.Name))
          throw new InvalidDataException(
            $"The preserved {name} configuration contains a duplicate property.");
        RejectDuplicateProperties(property.Value, name);
      }
    }
    else if (element.ValueKind == JsonValueKind.Array)
    {
      foreach (var item in element.EnumerateArray())
        RejectDuplicateProperties(item, name);
    }
  }

  private static void ValidateFailClosedContent(string name, JsonElement root)
  {
    var safe = name switch
    {
      "service" => IsSafeService(root),
      "agent" => IsSafeAgent(root),
      "update" => IsSafeUpdate(root),
      "recovery" => IsSafeRecovery(root),
      "audit-signer" => IsSafeAuditSigner(root),
      "egress-supervisor" => IsSafeEgressSupervisor(root),
      "privileged-command-supervisor" => IsSafePrivilegedCommandSupervisor(root),
      _ => false,
    };
    if (!safe)
      throw new SecurityException(
        $"The packaged {name} configuration does not satisfy the first-install fail-closed policy.");
  }

  private static bool IsSafeService(JsonElement root) =>
    IsFalse(root, "Companion", "ExecutionEnabled")
    && IsFalse(root, "HostCapabilities", "Enabled")
    && IsFalse(root, "HostCapabilities", "PermanentDeleteEnabled")
    && AllAllowedArraysEmpty(root, "HostCapabilities")
    && IsFalse(root, "PrivilegedCommand", "Enabled")
    && IsFalse(root, "SystemPower", "Enabled")
    && IsFalse(root, "ExternalActions", "Enabled")
    && IsEmptyArray(root, "ExternalActions", "Endpoints")
    && IsFalse(root, "BrokerChannel", "Enabled")
    && IsString(
      root,
      "BrokerChannel",
      "Endpoint",
      "https://provisioning-required.invalid:3443/api/v1/msaidizi/devices/channel")
    && IsEmptyString(root, "BrokerChannel", "DeviceCertificateThumbprint")
    && IsFalse(root, "SessionBridge", "Enabled")
    && IsString(root, "SessionBridge", "PipeName", "Itemba.Msaidizi.Session.v2")
    && IsFalse(root, "SessionBridge", "BrowserExternalEffectsEnabled")
    && IsFalse(root, "SessionBridge", "EmergencyCommandEnabled")
    && IsFalse(root, "SecretProvisioning", "Enabled")
    && IsEmptyArray(root, "SecretProvisioning", "Bindings")
    && IsEmptyArray(root, "TokenVerification", "TrustedSigningCertificates")
    && IsFalse(root, "EgressAttestationTrust", "Enabled")
    && IsEmptyArray(root, "EgressAttestationTrust", "TrustedSupervisorCertificates")
    && IsEmptyArray(root, "EgressAttestationTrust", "PairedDeviceCertificateThumbprints")
    && IsFalse(root, "EgressSupervisorClient", "Enabled")
    && IsString(root, "EgressSupervisorClient", "Transport", "disabled")
    && IsEmptyString(root, "EgressSupervisorClient", "PipeName")
    && IsEmptyString(root, "EgressSupervisorClient", "ExpectedSupervisorImagePath")
    && IsEmptyString(root, "EgressSupervisorClient", "ExpectedSupervisorImageSha256")
    && IsEmptyString(root, "EgressSupervisorClient", "ExpectedSupervisorServiceSid")
    && IsEmptyString(
      root,
      "EgressSupervisorClient",
      "ExpectedSupervisorPipeSecuritySha256")
    && IsEmptyString(root, "EgressSupervisorClient", "AttestationKeyId")
    && IsFalse(root, "EgressSupervisorFlowClient", "Enabled")
    && IsEmptyString(root, "EgressSupervisorFlowClient", "PipeName")
    && IsFalse(root, "PrivilegedCommandIsolationClient", "Enabled")
    && IsString(root, "PrivilegedCommandIsolationClient", "Transport", "disabled")
    && IsInt32(root, "PrivilegedCommandIsolationClient", "ProtocolVersion", 2)
    && IsEmptyString(root, "PrivilegedCommandIsolationClient", "PipeName")
    && IsEmptyString(
      root,
      "PrivilegedCommandIsolationClient",
      "ExpectedSupervisorImagePath")
    && IsEmptyString(
      root,
      "PrivilegedCommandIsolationClient",
      "ExpectedSupervisorImageSha256")
    && IsEmptyString(
      root,
      "PrivilegedCommandIsolationClient",
      "ExpectedSupervisorServiceSid")
    && IsEmptyString(root, "PrivilegedCommandIsolationClient", "ExpectedDeviceId")
    && IsEmptyString(
      root,
      "PrivilegedCommandIsolationClient",
      "ExpectedIsolationPolicySha256")
    && IsEmptyString(
      root,
      "PrivilegedCommandIsolationClient",
      "ExpectedDriverMeasurementSha256")
    && IsEmptyString(
      root,
      "PrivilegedCommandIsolationClient",
      "ExpectedServiceMeasurementSha256")
    && IsEmptyPublicKey(root, "PrivilegedCommandIsolationClient", "ReservationLeasePublicKey")
    && IsEmptyPublicKey(
      root,
      "PrivilegedCommandIsolationClient",
      "PreBindReservationReleasePublicKey")
    && IsEmptyPublicKey(
      root,
      "PrivilegedCommandIsolationClient",
      "SuspendedProcessBindAcknowledgementPublicKey")
    && IsEmptyPublicKey(
      root,
      "PrivilegedCommandIsolationClient",
      "TerminalEnforcementReceiptPublicKey");

  private static bool IsSafeAgent(JsonElement root) =>
    IsString(root, "Agent", "DeviceId", "UNENROLLED")
    && IsFalse(root, "Agent", "ExecutionEnabled")
    && IsEmptyString(root, "Agent", "EgressDestinationPolicySha256")
    && AllAllowedArraysEmpty(root, "Agent")
    && IsFalse(root, "SessionBridge", "Enabled")
    && IsString(root, "SessionBridge", "PipeName", "Itemba.Msaidizi.Session.v2")
    && IsFalse(root, "SessionBridge", "BrowserExternalEffectsEnabled")
    && IsFalse(root, "SessionBridge", "EmergencyCommandEnabled")
    && IsEmptyString(root, "SessionBridge", "ServiceCertificateThumbprint")
    && IsFalse(root, "CapabilityBoundaryTrust", "Enabled")
    && IsEmptyString(root, "CapabilityBoundaryTrust", "KeyId")
    && IsEmptyString(root, "CapabilityBoundaryTrust", "CertificateThumbprint")
    && IsEmptyString(
      root,
      "CapabilityBoundaryTrust",
      "ExpectedSupervisorPipeSecuritySha256")
    && IsFalse(root, "SecretProvisioning", "Enabled")
    && IsEmptyString(root, "SecretProvisioning", "ServiceCertificateThumbprint");

  private static bool IsSafeUpdate(JsonElement root)
  {
    if (!TrySection(root, "MsaidiziUpdateSupervisor", out var supervisor)
      || !StringEquals(supervisor, "DeviceId", "00000000-0000-0000-0000-000000000000")
      || !StringEquals(supervisor, "ClientCertificateThumbprint", string.Empty)
      || !StringEquals(supervisor, "BootstrapKeyId", "PROVISIONING_REQUIRED")
      || !StringEquals(supervisor, "PinnedBootstrapPublicKeySha256", new string('0', 64))
      || !StringEquals(
        supervisor,
        "BrokerBaseUri",
        "https://provisioning-required.invalid:3443/api/v1/"))
      return false;

    if (!supervisor.TryGetProperty("Targets", out var targets)
      || targets.ValueKind != JsonValueKind.Array
      || targets.GetArrayLength() != 1)
      return false;
    var target = targets[0];
    return StringEquals(target, "TargetId", "PROVISIONING_REQUIRED")
      && StringEquals(target, "WindowsServiceName", "PROVISIONING_REQUIRED");
  }

  private static bool IsSafeRecovery(JsonElement root) =>
    IsString(root, "MsaidiziRecoverySupervisor", "DeviceId", "00000000-0000-0000-0000-000000000000")
    && IsString(
      root,
      "MsaidiziRecoverySupervisor",
      "BrokerBaseUri",
      "https://provisioning-required.invalid:3443/api/v1/")
    && IsEmptyString(root, "MsaidiziRecoverySupervisor", "ClientCertificateThumbprint")
    && IsString(root, "MsaidiziRecoverySupervisor", "RecoveryKeyId", "PROVISIONING_REQUIRED")
    && IsString(root, "MsaidiziRecoverySupervisor", "PinnedRecoveryPublicKeySha256", new string('0', 64))
    && IsFalse(root, "Companion", "ExecutionEnabled")
    && IsFalse(root, "BrokerChannel", "Enabled")
    && IsTrue(root, "BrokerChannel", "RequireHardwareBackedDeviceIdentity")
    && IsFalse(root, "BrokerChannel", "DevelopmentOnlyAllowSoftwareDeviceIdentity")
    && IsFalse(root, "HostCapabilities", "PermanentDeleteEnabled")
    && AllAllowedArraysEmpty(root, "HostCapabilities");

  private static bool IsSafeAuditSigner(JsonElement root) =>
    IsString(
      root,
      "MsaidiziAuditSigner",
      "BrokerBaseUri",
      "https://provisioning-required.invalid:3443/api/v1/")
    && IsEmptyString(root, "MsaidiziAuditSigner", "ClientCertificateThumbprint")
    && IsString(root, "MsaidiziAuditSigner", "SignerKeyId", "PROVISIONING_REQUIRED")
    && IsString(
      root,
      "MsaidiziAuditSigner",
      "HardwareKeyProvider",
      "Microsoft Platform Crypto Provider")
    && IsString(root, "MsaidiziAuditSigner", "PinnedBrokerCertificateSha256", new string('0', 64))
    && IsString(root, "MsaidiziAuditSigner", "PinnedBrokerSpkiSha256", new string('0', 64));

  private static bool IsSafeEgressSupervisor(JsonElement root) =>
    IsFalse(root, "EgressSupervisor", "Enabled")
    && IsString(
      root,
      "EgressSupervisor",
      "JournalPath",
      @"C:\ProgramData\Itemba\Msaidizi\supervisor\egress-supervisor\lifecycle.v2.jsonl")
    && IsString(
      root,
      "EgressSupervisor",
      "KillSwitchPath",
      @"C:\ProgramData\Itemba\Msaidizi\supervisor\DISABLED")
    && IsString(
      root,
      "EgressSupervisor",
      "SecretVaultPath",
      @"C:\ProgramData\Itemba\Msaidizi\supervisor\secret-vault")
    && IsEmptyString(root, "EgressSupervisor", "DestinationPolicyPath")
    && IsEmptyString(root, "EgressSupervisor", "AgentImagePath")
    && IsEmptyString(root, "EgressSupervisor", "AgentImageSha256")
    && IsInt32(root, "EgressSupervisor", "CapabilityAttestationLifetimeSeconds", 60)
    && IsString(root, "EgressSupervisor", "ExpectedIssuer", "itemba-msaidizi-broker")
    && IsString(root, "EgressSupervisor", "ExpectedAudience", "itemba-windows-companion")
    && IsString(root, "EgressSupervisor", "ExpectedSubject", "msaidizi-global")
    && IsInt32(
      root,
      "EgressSupervisor",
      "FlowCompletionSettlementTimeoutMilliseconds",
      5_000)
    && IsInt32(root, "EgressSupervisor", "FlowOperationTimeoutSeconds", 120)
    && IsInt32(root, "EgressSupervisor", "MaximumRequestBytes", 1_048_576)
    && IsInt32(root, "EgressSupervisor", "MaximumResponseBytes", 16_777_216)
    && IsEmptyString(root, "EgressSupervisor", "TokenVerificationKeyId")
    && IsEmptyString(root, "EgressSupervisor", "TokenVerificationCertificateThumbprint")
    && IsEmptyString(root, "EgressSupervisor", "AttestationKeyId")
    && IsEmptyString(root, "EgressSupervisor", "AttestationCertificateThumbprint")
    && IsEmptyString(root, "EgressSupervisor", "ReceiptKeyId")
    && IsEmptyString(root, "EgressSupervisor", "ReceiptCertificateThumbprint")
    && IsEmptyString(root, "EgressSupervisor", "DeviceId")
    && IsEmptyString(root, "EgressSupervisor", "SupervisorInstanceId")
    && IsFalse(root, "EgressSupervisor", "SecureBootEnabled")
    && IsFalse(root, "EgressSupervisor", "HvciEnabled")
    && IsFalse(root, "EgressSupervisor", "DriverActive")
    && IsEmptyString(root, "EgressSupervisor", "DriverServiceName")
    && IsEmptyString(root, "EgressSupervisor", "DriverImagePath")
    && IsEmptyString(root, "EgressSupervisor", "DriverDevicePath")
    && IsEmptyString(root, "EgressSupervisor", "DriverMeasurementSha256")
    && IsEmptyString(root, "EgressSupervisor", "ServiceMeasurementSha256");

  private static bool IsSafePrivilegedCommandSupervisor(JsonElement root) =>
    IsFalse(root, "PrivilegedCommandSupervisor", "Enabled")
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "DeviceId",
      "00000000-0000-0000-0000-000000000000")
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "SupervisorInstanceId",
      "00000000-0000-0000-0000-000000000000")
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "SupervisorServiceSid",
      "S-1-5-80-1792805186-3282615177-1795010573-3676175622-4117989893")
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "AllowedCompanionServiceSid",
      "S-1-5-80-341263411-3719254221-1864525750-3877438856-2718495063")
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "StateRoot",
      @"C:\ProgramData\Itemba\Msaidizi\supervisor\privileged-command-supervisor")
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "JournalPath",
      @"C:\ProgramData\Itemba\Msaidizi\supervisor\privileged-command-supervisor\lifecycle.v1.jsonl")
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "KillSwitchPath",
      @"C:\ProgramData\Itemba\Msaidizi\supervisor\DISABLED")
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "PipeName",
      "Itemba.Msaidizi.PrivilegedCommandIsolation.v2")
    && IsSafeUnprovisionedKeyBinding(
      root,
      "ReservationLeaseSigningKey",
      "reservation-lease-v1",
      '0')
    && IsSafeUnprovisionedKeyBinding(
      root,
      "PreBindReservationReleaseSigningKey",
      "pre-bind-reservation-release-v1",
      '1')
    && IsSafeUnprovisionedKeyBinding(
      root,
      "SuspendedProcessBindAcknowledgementSigningKey",
      "suspended-process-bind-acknowledgement-v1",
      '2')
    && IsSafeUnprovisionedKeyBinding(
      root,
      "TerminalEnforcementReceiptSigningKey",
      "terminal-enforcement-receipt-v1",
      '3')
    && IsSafeUnprovisionedKeyBinding(
      root,
      "ActionTokenVerificationKey",
      "msaidizi-action-token-v1",
      '4')
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "ActionTokenExpectedIssuer",
      "itemba-msaidizi-broker")
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "ActionTokenExpectedAudience",
      "itemba-windows-companion")
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "ActionTokenExpectedSubject",
      "msaidizi-global")
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "ActionTokenAllowedClockSkew",
      "00:00:30")
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "ActionTokenMaximumLifetime",
      "00:05:00")
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "ExpectedCompanionImageSha256",
      new string('0', 64))
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "ExpectedSupervisorImageSha256",
      new string('0', 64))
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "IsolationPolicySha256",
      new string('0', 64))
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "DriverMeasurementSha256",
      new string('0', 64))
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "DriverServiceName",
      "Itemba Msaidizi Privileged Command Isolation Driver")
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "DriverPolicyEpoch",
      "isolation-policy-v2")
    && IsSafeUnprovisionedKeyBinding(
      root,
      "DriverAttestationVerificationKey",
      "isolation-driver-attestation-v2",
      '5')
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "DriverAttestationAllowedClockSkew",
      "00:00:30")
    && IsString(
      root,
      "PrivilegedCommandSupervisor",
      "DriverAttestationMaximumLifetime",
      "00:01:00")
    && IsInt32(
      root,
      "PrivilegedCommandSupervisor",
      "MaximumInvocationTimeoutSeconds",
      300)
    && IsInt64(
      root,
      "PrivilegedCommandSupervisor",
      "MaximumInvocationOutputBytes",
      1_048_576)
    && IsInt32(
      root,
      "PrivilegedCommandSupervisor",
      "MaximumInvocationProcesses",
      16)
    && IsInt64(
      root,
      "PrivilegedCommandSupervisor",
      "MaximumInvocationProcessMemoryBytes",
      536_870_912);

  private static bool IsSafeUnprovisionedKeyBinding(
    JsonElement root,
    string keyProperty,
    string expectedKeyId,
    char placeholderDigit) =>
    IsNestedString(
      root,
      "PrivilegedCommandSupervisor",
      keyProperty,
      "KeyId",
      expectedKeyId)
    && IsNestedString(
      root,
      "PrivilegedCommandSupervisor",
      keyProperty,
      "CertificateThumbprint",
      new string(placeholderDigit, 40))
    && IsNestedString(
      root,
      "PrivilegedCommandSupervisor",
      keyProperty,
      "SubjectPublicKeyInfoBase64",
      string.Empty);

  private static bool AllAllowedArraysEmpty(JsonElement root, string sectionName)
  {
    if (!TrySection(root, sectionName, out var section))
      return false;
    foreach (var property in section.EnumerateObject())
    {
      if (property.Name.StartsWith("Allowed", StringComparison.Ordinal)
        && (property.Value.ValueKind != JsonValueKind.Array
          || property.Value.GetArrayLength() != 0))
        return false;
    }
    return true;
  }

  private static bool IsFalse(JsonElement root, string section, string property) =>
    TrySection(root, section, out var value)
    && value.TryGetProperty(property, out var item)
    && item.ValueKind == JsonValueKind.False;

  private static bool IsTrue(JsonElement root, string section, string property) =>
    TrySection(root, section, out var value)
    && value.TryGetProperty(property, out var item)
    && item.ValueKind == JsonValueKind.True;

  private static bool IsEmptyString(JsonElement root, string section, string property) =>
    IsString(root, section, property, string.Empty);

  private static bool IsNestedString(
    JsonElement root,
    string section,
    string nestedProperty,
    string property,
    string expected) =>
    TrySection(root, section, out var value)
    && value.TryGetProperty(nestedProperty, out var nested)
    && nested.ValueKind == JsonValueKind.Object
    && StringEquals(nested, property, expected);

  private static bool IsString(
    JsonElement root,
    string section,
    string property,
    string expected) =>
    TrySection(root, section, out var value)
    && StringEquals(value, property, expected);

  private static bool IsInt32(
    JsonElement root,
    string section,
    string property,
    int expected) =>
    TrySection(root, section, out var value)
    && value.TryGetProperty(property, out var item)
    && item.ValueKind == JsonValueKind.Number
    && item.TryGetInt32(out var actual)
    && actual == expected;

  private static bool IsInt64(
    JsonElement root,
    string section,
    string property,
    long expected) =>
    TrySection(root, section, out var value)
    && value.TryGetProperty(property, out var item)
    && item.ValueKind == JsonValueKind.Number
    && item.TryGetInt64(out var actual)
    && actual == expected;

  private static bool IsEmptyArray(JsonElement root, string section, string property) =>
    TrySection(root, section, out var value)
    && value.TryGetProperty(property, out var item)
    && item.ValueKind == JsonValueKind.Array
    && item.GetArrayLength() == 0;

  private static bool IsEmptyPublicKey(
    JsonElement root,
    string section,
    string property) =>
    TrySection(root, section, out var value)
    && value.TryGetProperty(property, out var key)
    && key.ValueKind == JsonValueKind.Object
    && StringEquals(key, "KeyId", string.Empty)
    && StringEquals(key, "SubjectPublicKeyInfoBase64", string.Empty);

  private static bool TrySection(JsonElement root, string name, out JsonElement section) =>
    root.TryGetProperty(name, out section)
    && section.ValueKind == JsonValueKind.Object;

  private static bool StringEquals(JsonElement element, string property, string expected) =>
    element.TryGetProperty(property, out var value)
    && value.ValueKind == JsonValueKind.String
    && string.Equals(value.GetString(), expected, StringComparison.Ordinal);

  private static bool StringStartsWith(JsonElement element, string property, string expected) =>
    element.TryGetProperty(property, out var value)
    && value.ValueKind == JsonValueKind.String
    && value.GetString() is { } text
    && text.StartsWith(expected, StringComparison.Ordinal);

  private static string NormalizeRelative(string value) =>
    value.Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar)
      .TrimEnd(Path.DirectorySeparatorChar);
}
