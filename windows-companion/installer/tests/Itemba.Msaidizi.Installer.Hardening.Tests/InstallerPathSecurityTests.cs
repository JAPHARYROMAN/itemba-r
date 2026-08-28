using System.Security;
using System.Security.AccessControl;
using System.Text;
using System.Text.Json;

namespace Itemba.Msaidizi.Installer.Hardening.Tests;

public sealed class InstallerPathSecurityTests
{
  [Fact]
  public void EveryEmbeddedFirstInstallConfigurationPassesContentPolicy()
  {
    foreach (var name in ConfigurationProvenance.ConfigurationNames)
    {
      var packaged = ConfigurationProvenance.ReadPackagedConfiguration(name);

      ConfigurationProvenance.ValidateConfiguration(
        name,
        packaged,
        requirePackagedSafeContent: true);
    }
  }

  [Fact]
  public void PrivilegedCommandKeyPurposesRemainDistinctAndUnprovisioned()
  {
    using var supervisorDocument = JsonDocument.Parse(
      ConfigurationProvenance.ReadPackagedConfiguration(
        "privileged-command-supervisor"));
    using var companionDocument = JsonDocument.Parse(
      ConfigurationProvenance.ReadPackagedConfiguration("service"));
    var supervisor = supervisorDocument.RootElement.GetProperty(
      "PrivilegedCommandSupervisor");
    var companion = companionDocument.RootElement.GetProperty(
      "PrivilegedCommandIsolationClient");
    var bindings = new[]
    {
      ("ReservationLeaseSigningKey", "reservation-lease-v1", '0',
        "ReservationLeasePublicKey"),
      ("PreBindReservationReleaseSigningKey",
        "pre-bind-reservation-release-v1", '1',
        "PreBindReservationReleasePublicKey"),
      ("SuspendedProcessBindAcknowledgementSigningKey",
        "suspended-process-bind-acknowledgement-v1", '2',
        "SuspendedProcessBindAcknowledgementPublicKey"),
      ("TerminalEnforcementReceiptSigningKey",
        "terminal-enforcement-receipt-v1", '3',
        "TerminalEnforcementReceiptPublicKey"),
    };
    var keyIds = new HashSet<string>(StringComparer.Ordinal);
    var thumbprints = new HashSet<string>(StringComparer.Ordinal);

    foreach (var (bindingName, expectedKeyId, placeholder, publicKeyName) in bindings)
    {
      var binding = supervisor.GetProperty(bindingName);
      Assert.Equal(3, binding.EnumerateObject().Count());
      var keyId = binding.GetProperty("KeyId").GetString();
      var thumbprint = binding.GetProperty("CertificateThumbprint").GetString();
      Assert.Equal(expectedKeyId, keyId);
      Assert.Equal(new string(placeholder, 40), thumbprint);
      Assert.Equal(string.Empty,
        binding.GetProperty("SubjectPublicKeyInfoBase64").GetString());
      Assert.True(keyIds.Add(keyId!));
      Assert.True(thumbprints.Add(thumbprint!));

      var publicKey = companion.GetProperty(publicKeyName);
      Assert.Equal(string.Empty, publicKey.GetProperty("KeyId").GetString());
      Assert.Equal(string.Empty,
        publicKey.GetProperty("SubjectPublicKeyInfoBase64").GetString());
    }

    var verificationBindings = new[]
    {
      ("ActionTokenVerificationKey", "msaidizi-action-token-v1", '4'),
      ("DriverAttestationVerificationKey", "isolation-driver-attestation-v2", '5'),
    };
    foreach (var (bindingName, expectedKeyId, placeholder) in verificationBindings)
    {
      var binding = supervisor.GetProperty(bindingName);
      Assert.Equal(3, binding.EnumerateObject().Count());
      var keyId = binding.GetProperty("KeyId").GetString();
      var thumbprint = binding.GetProperty("CertificateThumbprint").GetString();
      Assert.Equal(expectedKeyId, keyId);
      Assert.Equal(new string(placeholder, 40), thumbprint);
      Assert.Equal(string.Empty,
        binding.GetProperty("SubjectPublicKeyInfoBase64").GetString());
      Assert.True(keyIds.Add(keyId!));
      Assert.True(thumbprints.Add(thumbprint!));
    }

    Assert.Equal(6, keyIds.Count);
    Assert.Equal(6, thumbprints.Count);
    Assert.Equal("itemba-msaidizi-broker",
      supervisor.GetProperty("ActionTokenExpectedIssuer").GetString());
    Assert.Equal("itemba-windows-companion",
      supervisor.GetProperty("ActionTokenExpectedAudience").GetString());
    Assert.Equal("msaidizi-global",
      supervisor.GetProperty("ActionTokenExpectedSubject").GetString());
    Assert.Equal("Itemba Msaidizi Privileged Command Isolation Driver",
      supervisor.GetProperty("DriverServiceName").GetString());
    Assert.Equal("isolation-policy-v2",
      supervisor.GetProperty("DriverPolicyEpoch").GetString());
    Assert.Equal(300,
      supervisor.GetProperty("MaximumInvocationTimeoutSeconds").GetInt32());
    Assert.Equal(1_048_576,
      supervisor.GetProperty("MaximumInvocationOutputBytes").GetInt64());
    Assert.Equal(16,
      supervisor.GetProperty("MaximumInvocationProcesses").GetInt32());
    Assert.Equal(536_870_912,
      supervisor.GetProperty("MaximumInvocationProcessMemoryBytes").GetInt64());

    Assert.False(supervisor.TryGetProperty("SigningKeyId", out _));
    Assert.False(supervisor.TryGetProperty(
      "SigningCertificateThumbprint", out _));
  }

  [Fact]
  public void PreplantedEnabledServiceConfigurationIsRejected()
  {
    var bytes = Encoding.UTF8.GetBytes(
      "{\"Companion\":{\"ExecutionEnabled\":true},\"HostCapabilities\":{\"Enabled\":true}}\n");

    Assert.Throws<SecurityException>(() => ConfigurationProvenance.ValidateConfiguration(
      "service",
      bytes,
      requirePackagedSafeContent: true));
  }

  [Fact]
  public void PreservedConfigurationRejectsAmbiguousDuplicateProperties()
  {
    var bytes = Encoding.UTF8.GetBytes("{\"Companion\":{},\"Companion\":{}}\n");

    Assert.Throws<InvalidDataException>(() => ConfigurationProvenance.ValidateConfiguration(
      "service",
      bytes,
      requirePackagedSafeContent: false));
  }

  [Fact]
  public void TamperedProvenanceMarkerIsRejected()
  {
    var marker = ConfigurationProvenance.MarkerBytes.ToArray();
    marker[^2] ^= 1;

    Assert.Throws<SecurityException>(() => ConfigurationProvenance.ValidateMarker(marker));
  }

  [Fact]
  public void AttackerOwnedParentIsNotATrustedBootstrapObject()
  {
    var attackerOwned = new RawSecurityDescriptor("O:BUG:BUD:P(A;OICI;FA;;;BU)");

    Assert.False(HandleBoundPathSecurity.HasTrustedBootstrapOwner(attackerOwned));
  }

  [Fact]
  public void UntrustedDeleteChildAuthorityIsRejected()
  {
    // Use the filesystem DELETE_CHILD access mask explicitly. The SDDL "DC"
    // mnemonic is parsed as the directory-service right (0x2) by the generic
    // RawSecurityDescriptor parser rather than FILE_DELETE_CHILD (0x40).
    var deleteChild = new RawSecurityDescriptor(
      "O:SYG:SYD:P(A;;0x40;;;BU)(A;OICI;FA;;;SY)");

    Assert.True(HandleBoundPathSecurity.HasUntrustedDeleteChild(deleteChild));
  }

  [Theory]
  [InlineData("O:SYG:SYD:P(A;;0x2;;;BU)(A;OICI;FA;;;SY)")]
  [InlineData("O:SYG:SYD:P(A;OICIIO;0x2;;;BU)(A;OICI;FA;;;SY)")]
  [InlineData("O:SYG:SYD:P(A;;GW;;;BU)(A;OICI;FA;;;SY)")]
  public void UntrustedCurrentOrInheritedWriteAuthorityIsRejected(string sddl)
  {
    var writable = new RawSecurityDescriptor(sddl);

    Assert.True(HandleBoundPathSecurity.HasUntrustedMutationAuthority(writable));
  }

  [Fact]
  public void TrustedBootstrapWritersAreAccepted()
  {
    var trusted = new RawSecurityDescriptor(
      "O:SYG:SYD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;GR;;;BU)");

    Assert.False(HandleBoundPathSecurity.HasUntrustedMutationAuthority(trusted));
  }

  [Fact]
  public void LockedDirectoryCannotBeReplacedUntilValidationCompletes()
  {
    if (!OperatingSystem.IsWindows())
      return;

    var testRoot = Path.Combine(
      Path.GetTempPath(),
      "itemba-installer-path-test-" + Guid.NewGuid().ToString("N"));
    var moved = testRoot + "-moved";
    Directory.CreateDirectory(testRoot);
    try
    {
      using (HandleBoundPathSecurity.OpenDirectory(testRoot))
      {
        Assert.ThrowsAny<IOException>(() => Directory.Move(testRoot, moved));
      }
      Directory.Move(testRoot, moved);
    }
    finally
    {
      if (Directory.Exists(testRoot))
        Directory.Delete(testRoot);
      if (Directory.Exists(moved))
        Directory.Delete(moved);
    }
  }

  [Fact]
  public void LockedTrustedFileRejectsConcurrentWriters()
  {
    if (!OperatingSystem.IsWindows())
      return;

    var testRoot = Path.Combine(
      Path.GetTempPath(),
      "itemba-installer-file-test-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(testRoot);
    var path = Path.Combine(testRoot, "appsettings.json");
    File.WriteAllText(path, "{}", Encoding.UTF8);
    try
    {
      using (HandleBoundPathSecurity.OpenSingleLinkFile(path))
      {
        Assert.ThrowsAny<IOException>(() => new FileStream(
          path,
          FileMode.Open,
          FileAccess.Write,
          FileShare.ReadWrite | FileShare.Delete));
      }
    }
    finally
    {
      File.Delete(path);
      Directory.Delete(testRoot);
    }
  }

  [Fact]
  public void ReplayLedgerAndLockHaveInstallerOwnedExactFilePolicies()
  {
    Assert.Equal(
      [
        @"supervisor\egress-boundary\receipts.v1.jsonl",
        @"supervisor\egress-boundary\receipts.v1.jsonl.lock",
        @"supervisor\privileged-command-isolation\replay.v1.jsonl",
        @"supervisor\privileged-command-isolation\replay.v1.jsonl.lock",
        @"supervisor\egress-supervisor\lifecycle.v2.jsonl",
        @"supervisor\egress-supervisor\lifecycle.v2.jsonl.lock",
        @"supervisor\privileged-command-supervisor\lifecycle.v1.jsonl",
        @"supervisor\privileged-command-supervisor\lifecycle.v1.jsonl.lock",
      ],
      AclBlueprint.TrustedMutableFiles.Select(definition => definition.RelativePath));
    Assert.All(AclBlueprint.TrustedMutableFiles, definition =>
    {
      Assert.Contains(definition.Grants, grant =>
        grant.Principal == InstallerPrincipal.System
        && grant.Rights.HasFlag(FileSystemRights.FullControl));
      Assert.DoesNotContain(definition.Grants, grant =>
        grant.Principal is InstallerPrincipal.Users or InstallerPrincipal.Administrators);
    });
  }
}
