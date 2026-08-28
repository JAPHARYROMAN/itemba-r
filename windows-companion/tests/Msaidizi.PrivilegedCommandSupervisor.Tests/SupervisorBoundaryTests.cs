using System.Text.Json;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Channel;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Configuration;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.State;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Supervision;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Security;
using Xunit;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Tests;

public sealed class SupervisorBoundaryTests
{
  [Fact]
  public void PackagedConfigurationCanRemainStableAndSafeOff()
  {
    var options = new PrivilegedCommandSupervisorOptions
    {
      Enabled = false,
    };

    options.Validate();
    Assert.Equal("Itemba.Msaidizi.PrivilegedCommandIsolation.v2", options.PipeName);
    Assert.Equal(
      PrivilegedCommandIsolationActionTokenTrust.Issuer,
      options.ActionTokenExpectedIssuer);
    Assert.Equal(
      PrivilegedCommandIsolationActionTokenTrust.Audience,
      options.ActionTokenExpectedAudience);
    Assert.Equal(
      PrivilegedCommandIsolationActionTokenTrust.Subject,
      options.ActionTokenExpectedSubject);
    Assert.Equal(300, options.MaximumInvocationTimeoutSeconds);
    Assert.Equal(1_048_576, options.MaximumInvocationOutputBytes);
    Assert.Equal(16, options.MaximumInvocationProcesses);
    Assert.Equal(536_870_912, options.MaximumInvocationProcessMemoryBytes);
  }

  [Fact]
  public void EnabledConfigurationRejectsUnprovisionedIdentityAndPins()
  {
    var options = new PrivilegedCommandSupervisorOptions
    {
      Enabled = true,
    };

    Assert.Throws<InvalidOperationException>(options.Validate);
  }

  [Fact]
  public void CompleteActiveConfigurationIsAccepted()
  {
    var options = CompleteOptions();

    options.Validate();
  }

  [Fact]
  public void ActiveConfigurationCannotSelectAnotherSupervisorServiceSid()
  {
    var options = CompleteOptions() with
    {
      SupervisorServiceSid = "S-1-5-80-1-2-3-4-5",
    };

    Assert.Throws<InvalidOperationException>(options.Validate);
  }

  [Fact]
  public void ActiveConfigurationCannotSelectAnotherCompanionServiceSid()
  {
    var options = CompleteOptions() with
    {
      AllowedCompanionServiceSid = "S-1-5-80-6-7-8-9-10",
    };

    Assert.Throws<InvalidOperationException>(options.Validate);
  }

  [Fact]
  public void ActiveConfigurationCannotSelectAnotherActionTokenTrustScope()
  {
    var issuer = CompleteOptions() with { ActionTokenExpectedIssuer = "other-issuer" };
    var audience = CompleteOptions() with
    {
      ActionTokenExpectedAudience = "other-audience",
    };
    var subject = CompleteOptions() with { ActionTokenExpectedSubject = "other-subject" };

    Assert.Throws<InvalidOperationException>(issuer.Validate);
    Assert.Throws<InvalidOperationException>(audience.Validate);
    Assert.Throws<InvalidOperationException>(subject.Validate);
  }

  [Fact]
  public void ActiveConfigurationRejectsUnboundedInvocationResourcePolicy()
  {
    Assert.Throws<InvalidOperationException>((CompleteOptions() with
    {
      MaximumInvocationTimeoutSeconds = 7_201,
    }).Validate);
    Assert.Throws<InvalidOperationException>((CompleteOptions() with
    {
      MaximumInvocationOutputBytes = 16_777_217,
    }).Validate);
    Assert.Throws<InvalidOperationException>((CompleteOptions() with
    {
      MaximumInvocationProcesses = 33,
    }).Validate);
    Assert.Throws<InvalidOperationException>((CompleteOptions() with
    {
      MaximumInvocationProcessMemoryBytes = 2_147_483_649,
    }).Validate);
  }

  [Fact]
  public void ActiveConfigurationRequiresFourDistinctCanonicalP256PurposeKeys()
  {
    var valid = CompleteOptions();
    var duplicateId = valid with
    {
      TerminalEnforcementReceiptSigningKey =
        valid.TerminalEnforcementReceiptSigningKey with
        {
          KeyId = valid.ReservationLeaseSigningKey.KeyId,
        },
    };
    var duplicateThumbprint = valid with
    {
      TerminalEnforcementReceiptSigningKey =
        valid.TerminalEnforcementReceiptSigningKey with
        {
          CertificateThumbprint =
            valid.ReservationLeaseSigningKey.CertificateThumbprint,
        },
    };
    var duplicateSpki = valid with
    {
      TerminalEnforcementReceiptSigningKey =
        valid.TerminalEnforcementReceiptSigningKey with
        {
          SubjectPublicKeyInfoBase64 =
            valid.ReservationLeaseSigningKey.SubjectPublicKeyInfoBase64,
        },
    };
    using var p384 = ECDsa.Create(ECCurve.NamedCurves.nistP384);
    var wrongCurve = valid with
    {
      TerminalEnforcementReceiptSigningKey =
        valid.TerminalEnforcementReceiptSigningKey with
        {
          SubjectPublicKeyInfoBase64 = Convert.ToBase64String(
            p384.ExportSubjectPublicKeyInfo()),
        },
    };
    var nonCanonical = valid with
    {
      TerminalEnforcementReceiptSigningKey =
        valid.TerminalEnforcementReceiptSigningKey with
        {
          SubjectPublicKeyInfoBase64 =
            valid.TerminalEnforcementReceiptSigningKey
              .SubjectPublicKeyInfoBase64 + "\n",
        },
    };

    Assert.Throws<InvalidOperationException>(duplicateId.Validate);
    Assert.Throws<InvalidOperationException>(duplicateThumbprint.Validate);
    Assert.Throws<InvalidOperationException>(duplicateSpki.Validate);
    Assert.Throws<InvalidOperationException>(wrongCurve.Validate);
    Assert.Throws<InvalidOperationException>(nonCanonical.Validate);
  }

  [Fact]
  public void ActiveConfigurationCannotMoveKillSwitchOutsideSharedTrustedRoot()
  {
    var options = CompleteOptions() with
    {
      KillSwitchPath = "C:\\ProgramData\\Itemba\\Msaidizi\\other\\DISABLED",
    };

    Assert.Throws<InvalidOperationException>(options.Validate);
  }

  [Fact]
  public void ActiveConfigurationRequiresTheFixedLifecycleJournalName()
  {
    var options = CompleteOptions() with
    {
      JournalPath =
        "C:\\ProgramData\\Itemba\\Msaidizi\\supervisor\\privileged-command-supervisor\\alternate.jsonl",
    };

    Assert.Throws<InvalidOperationException>(options.Validate);
  }

  [Fact]
  public void TrustedKillSwitchDistinguishesMissingAndEngagedMarkers()
  {
    var path = Path.Combine(
      Path.GetTempPath(),
      $"msaidizi-isolation-kill-switch-{Guid.NewGuid():N}");
    Assert.False(TrustedKillSwitch.IsEngaged(path));

    try
    {
      File.WriteAllText(path, "disabled");
      Assert.True(TrustedKillSwitch.IsEngaged(path));
    }
    finally
    {
      if (File.Exists(path))
      {
        File.Delete(path);
      }
    }
  }

  [Fact]
  public void TrustedKillSwitchFailsClosedWhenItsTrustedRootDisappears()
  {
    var missingRoot = Path.Combine(
      Path.GetTempPath(),
      $"msaidizi-missing-trusted-root-{Guid.NewGuid():N}");
    var marker = Path.Combine(missingRoot, "DISABLED");

    Assert.True(TrustedKillSwitch.IsEngaged(null));
    Assert.True(TrustedKillSwitch.IsEngaged(marker));
  }

  [Fact]
  public void SigningKeyAclAllowsOnlyTheFixedSupervisorServiceSid()
  {
    var supervisorSid = new SecurityIdentifier(
      SupervisorServiceIdentity.RequiredServiceSid);
    var exact = new RawSecurityDescriptor(
      $"O:SYD:P(A;;GA;;;{supervisorSid.Value})");
    var genericSystemAlsoGranted = new RawSecurityDescriptor(
      $"O:SYD:P(A;;GA;;;SY)(A;;GA;;;{supervisorSid.Value})");
    var companionSid = new SecurityIdentifier("S-1-5-80-6-7-8-9-10");
    var companionAlsoGranted = new RawSecurityDescriptor(
      $"O:SYD:P(A;;GA;;;{supervisorSid.Value})(A;;GA;;;{companionSid.Value})");

    Assert.True(CertificateStoreIsolationEvidenceSigner
      .IsExactPrivateKeyDescriptor(exact, supervisorSid));
    Assert.False(CertificateStoreIsolationEvidenceSigner
      .IsExactPrivateKeyDescriptor(genericSystemAlsoGranted, supervisorSid));
    Assert.False(CertificateStoreIsolationEvidenceSigner
      .IsExactPrivateKeyDescriptor(companionAlsoGranted, supervisorSid));
  }

  [Fact]
  public void ProcessPeerGrantRejectsBroaderDuplicateCallbackAndObjectAces()
  {
    const int exactRights = 0x00100400;
    var companionSid = new SecurityIdentifier(
      SupervisorServiceIdentity.RequiredCompanionServiceSid);
    var unrelatedSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
    var exact = Acl(
      new CommonAce(
        AceFlags.None,
        AceQualifier.AccessAllowed,
        exactRights,
        unrelatedSid,
        isCallback: false,
        opaque: null),
      PeerAce(companionSid, exactRights));
    var broader = Acl(PeerAce(companionSid, unchecked((int)0x101F0FFF)));
    var duplicate = Acl(
      PeerAce(companionSid, exactRights),
      PeerAce(companionSid, exactRights));
    var callback = Acl(new CommonAce(
      AceFlags.None,
      AceQualifier.AccessAllowed,
      exactRights,
      companionSid,
      isCallback: true,
      opaque: new byte[4]));
    var objectAce = Acl(new ObjectAce(
      AceFlags.None,
      AceQualifier.AccessAllowed,
      exactRights,
      companionSid,
      ObjectAceFlags.ObjectAceTypePresent,
      Guid.NewGuid(),
      Guid.Empty,
      isCallback: false,
      opaque: null));

    Assert.True(ProcessIdentityAccessPolicy.IsExactPeerAceSet(exact, companionSid));
    Assert.False(ProcessIdentityAccessPolicy.IsExactPeerAceSet(broader, companionSid));
    Assert.False(ProcessIdentityAccessPolicy.IsExactPeerAceSet(duplicate, companionSid));
    Assert.False(ProcessIdentityAccessPolicy.IsExactPeerAceSet(callback, companionSid));
    Assert.False(ProcessIdentityAccessPolicy.IsExactPeerAceSet(objectAce, companionSid));
  }

  [Fact]
  public void PeerAndSelfMeasurementsBindRetainedFilesToMappedProcessImages()
  {
    const BindingFlags flags = BindingFlags.NonPublic | BindingFlags.Static;
    Assert.NotNull(typeof(ValidatedIsolationPipePeer).GetMethod(
      "OpenAndBindMappedImage",
      flags));
    Assert.NotNull(typeof(ValidatedIsolationPipePeer).GetMethod(
      "NtQueryInformationProcess",
      flags));
    Assert.Equal(
      44,
      typeof(ValidatedIsolationPipePeer)
        .GetField("ProcessImageFileMapping", flags)!
        .GetRawConstantValue());
    Assert.Equal(
      0x0400u,
      typeof(ValidatedIsolationPipePeer)
        .GetField("ProcessQueryInformation", flags)!
        .GetRawConstantValue());

    if (!OperatingSystem.IsWindows())
    {
      return;
    }

    var currentImage = Assert.IsType<string>(Environment.ProcessPath);
    Assert.True(RuntimeMeasurementVerifier.IsCurrentProcessMappedImageCandidate(
      currentImage));
    var copiedImage = Path.Combine(
      Path.GetTempPath(),
      $"msaidizi-unmapped-supervisor-{Guid.NewGuid():N}.exe");
    File.Copy(currentImage, copiedImage, overwrite: false);
    try
    {
      Assert.False(RuntimeMeasurementVerifier.IsCurrentProcessMappedImageCandidate(
        copiedImage));
    }
    finally
    {
      File.Delete(copiedImage);
    }
  }

  [Fact]
  public void ProtectedJournalDescriptorRejectsInheritanceOwnerDriftAndExtraAces()
  {
    var expected = new RawSecurityDescriptor("O:SYD:P(A;;FA;;;SY)");
    var exact = new RawSecurityDescriptor("O:SYD:P(A;;FA;;;SY)");
    var inherited = new RawSecurityDescriptor("O:SYD:(A;;FA;;;SY)");
    var wrongOwner = new RawSecurityDescriptor("O:BAD:P(A;;FA;;;SY)");
    var extraAce = new RawSecurityDescriptor(
      "O:SYD:P(A;;FA;;;SY)(A;;FR;;;BA)");

    Assert.True(WindowsIsolationJournalProtection.HasExactDescriptor(
      exact,
      expected));
    Assert.False(WindowsIsolationJournalProtection.HasExactDescriptor(
      inherited,
      expected));
    Assert.False(WindowsIsolationJournalProtection.HasExactDescriptor(
      wrongOwner,
      expected));
    Assert.False(WindowsIsolationJournalProtection.HasExactDescriptor(
      extraAce,
      expected));
  }

  [Fact]
  public void WireKindsRemainExactlyCompatibleWithCompanionClientV2()
  {
    Assert.Equal("reserve.request.v2", IsolationPipeProtocol.ReserveRequest);
    Assert.Equal("reserve.response.v2", IsolationPipeProtocol.ReserveResponse);
    Assert.Equal("pre-bind-release.request.v2", IsolationPipeProtocol.ReleaseRequest);
    Assert.Equal("pre-bind-release.response.v2", IsolationPipeProtocol.ReleaseResponse);
    Assert.Equal("suspended-bind.request.v2", IsolationPipeProtocol.BindRequest);
    Assert.Equal("suspended-bind.response.v2", IsolationPipeProtocol.BindResponse);
    Assert.Equal("terminal-settle.request.v2", IsolationPipeProtocol.SettleRequest);
    Assert.Equal("terminal-settle.response.v2", IsolationPipeProtocol.SettleResponse);
    Assert.Equal(
      "recover-pending-reservation.request.v2",
      IsolationPipeProtocol.RecoverReservationRequest);
    Assert.Equal(
      "recover-pending-bind.request.v2",
      IsolationPipeProtocol.RecoverBindRequest);

    var frame = new IsolationPipeFrameV1(
      2,
      7,
      IsolationPipeProtocol.ReserveRequest,
      "10000000-0000-0000-0000-000000000001",
      "20000000-0000-0000-0000-000000000002",
      "{}");
    var json = JsonSerializer.Serialize(frame, IsolationPipeProtocol.SerializerOptions);
    Assert.Contains("\"protocolVersion\":2", json, StringComparison.Ordinal);
    Assert.Contains("\"sequence\":7", json, StringComparison.Ordinal);
    Assert.DoesNotContain("ProtocolVersion", json, StringComparison.Ordinal);
  }

  [Fact]
  public void PipeFactoryRequiresRemoteRejectionAndAProcessOwnedFirstInstance()
  {
    Assert.Equal(0x00000008u, SecureIsolationPipeFactory.RequiredNativePipeMode);
    Assert.Equal(
      0x00080000u,
      SecureIsolationPipeFactory.RequiredFirstInstanceOpenMode);
  }

  [Fact]
  public async Task JournalPermitsOnlyOneWriterProcess()
  {
    var root = Path.Combine(
      Path.GetTempPath(),
      $"msaidizi-isolation-store-lock-{Guid.NewGuid():N}");
    Directory.CreateDirectory(root);
    var path = Path.Combine(root, "lifecycle.v1.jsonl");
    try
    {
      await using var first = new FileIsolationLifecycleStore(
        path,
        requirePreprovisionedFiles: false);
      Assert.Throws<IOException>(() => new FileIsolationLifecycleStore(
        path,
        requirePreprovisionedFiles: false));
    }
    finally
    {
      var fullRoot = Path.GetFullPath(root);
      if (fullRoot.StartsWith(
          Path.GetFullPath(Path.GetTempPath()),
          StringComparison.OrdinalIgnoreCase)
        && Directory.Exists(fullRoot))
      {
        Directory.Delete(fullRoot, recursive: true);
      }
    }
  }

  [Fact]
  public void ProductionJournalRefusesToCreateANewGenesisOrOwnershipLock()
  {
    var root = Path.Combine(
      Path.GetTempPath(),
      $"msaidizi-isolation-store-preprovisioned-{Guid.NewGuid():N}");
    Directory.CreateDirectory(root);
    var path = Path.Combine(root, "lifecycle.v1.jsonl");
    try
    {
      Assert.Throws<UnauthorizedAccessException>(() =>
        new FileIsolationLifecycleStore(
          path,
          requirePreprovisionedFiles: true));
      Assert.False(File.Exists(path));
      Assert.False(File.Exists(path + ".lock"));
    }
    finally
    {
      var fullRoot = Path.GetFullPath(root);
      if (fullRoot.StartsWith(
          Path.GetFullPath(Path.GetTempPath()),
          StringComparison.OrdinalIgnoreCase)
        && Directory.Exists(fullRoot))
      {
        Directory.Delete(fullRoot, recursive: true);
      }
    }
  }

  private static PrivilegedCommandSupervisorOptions CompleteOptions() => new()
  {
    Enabled = true,
    DeviceId = "10000000-0000-0000-0000-000000000001",
    SupervisorInstanceId = "20000000-0000-0000-0000-000000000002",
    SupervisorServiceSid = SupervisorServiceIdentity.RequiredServiceSid,
    AllowedCompanionServiceSid =
      SupervisorServiceIdentity.RequiredCompanionServiceSid,
    PipeName = "Itemba.Msaidizi.PrivilegedCommandIsolation.v2",
    StateRoot =
      "C:\\ProgramData\\Itemba\\Msaidizi\\supervisor\\privileged-command-supervisor",
    JournalPath =
      "C:\\ProgramData\\Itemba\\Msaidizi\\supervisor\\privileged-command-supervisor\\lifecycle.v1.jsonl",
    KillSwitchPath = "C:\\ProgramData\\Itemba\\Msaidizi\\supervisor\\DISABLED",
    ReservationLeaseSigningKey = SigningKey(
      "reservation-lease-v1",
      new string('A', 40)),
    PreBindReservationReleaseSigningKey = SigningKey(
      "pre-bind-reservation-release-v1",
      new string('B', 40)),
    SuspendedProcessBindAcknowledgementSigningKey = SigningKey(
      "suspended-process-bind-acknowledgement-v1",
      new string('C', 40)),
    TerminalEnforcementReceiptSigningKey = SigningKey(
      "terminal-enforcement-receipt-v1",
      new string('D', 40)),
    ActionTokenVerificationKey = VerificationKey(
      "action-token-v1",
      new string('E', 40)),
    ActionTokenExpectedIssuer = "itemba-msaidizi-broker",
    ActionTokenExpectedAudience = "itemba-windows-companion",
    ActionTokenExpectedSubject = "msaidizi-global",
    ExpectedCompanionImagePath =
      "C:\\Program Files\\Itemba\\Msaidizi\\Itemba.Msaidizi.Companion.Service.exe",
    ExpectedCompanionImageSha256 = new('a', 64),
    ExpectedSupervisorImageSha256 = new('b', 64),
    IsolationPolicySha256 = new('c', 64),
    DriverMeasurementSha256 = new('d', 64),
    DriverImagePath =
      "C:\\Program Files\\Itemba\\Msaidizi\\Drivers\\ItembaMsaidiziIsolation.sys",
    DriverServiceName =
      PrivilegedCommandIsolationSupervisorIdentity.DriverServiceName,
    DriverPolicyEpoch = "isolation-policy-v2",
    DriverAttestationVerificationKey = VerificationKey(
      "driver-attestation-v2",
      new string('F', 40)),
    DriverDevicePath = "\\\\.\\ItembaMsaidiziIsolation",
  };

  private static PrivilegedCommandSigningKeyOptions SigningKey(
    string keyId,
    string thumbprint)
  {
    using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    return new PrivilegedCommandSigningKeyOptions
    {
      KeyId = keyId,
      CertificateThumbprint = thumbprint,
      SubjectPublicKeyInfoBase64 = Convert.ToBase64String(
        key.ExportSubjectPublicKeyInfo()),
    };
  }

  private static PrivilegedCommandVerificationKeyOptions VerificationKey(
    string keyId,
    string thumbprint)
  {
    using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    return new PrivilegedCommandVerificationKeyOptions
    {
      KeyId = keyId,
      CertificateThumbprint = thumbprint,
      SubjectPublicKeyInfoBase64 = Convert.ToBase64String(
        key.ExportSubjectPublicKeyInfo()),
    };
  }

  private static CommonAce PeerAce(SecurityIdentifier sid, int rights) => new(
    AceFlags.None,
    AceQualifier.AccessAllowed,
    rights,
    sid,
    isCallback: false,
    opaque: null);

  private static RawAcl Acl(params GenericAce[] aces)
  {
    var acl = new RawAcl(GenericAcl.AclRevision, aces.Length);
    for (var index = 0; index < aces.Length; index++)
    {
      acl.InsertAce(index, aces[index]);
    }
    return acl;
  }
}
