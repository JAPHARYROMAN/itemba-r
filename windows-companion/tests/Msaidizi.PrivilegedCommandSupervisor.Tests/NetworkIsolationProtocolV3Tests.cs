using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Channel;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Configuration;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Enforcement;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Security;
using Xunit;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Tests;

public sealed partial class NetworkIsolationProtocolV3Tests
{
  [Fact]
  public void ManagedAbiMatchesFrozenNativeHeaderAndPortableAssertions()
  {
    var header = File.ReadAllText(FindRepositoryFile(
      "windows-companion",
      "native",
      "Msaidizi.NetworkIsolationDriver",
      "include",
      "msaidizi_network_isolation_protocol.h"));
    var portable = File.ReadAllText(FindRepositoryFile(
      "windows-companion",
      "native",
      "Msaidizi.NetworkIsolationDriver",
      "tests",
      "protocol_contract_tests.cpp"));

    Assert.Equal(3, Define(header, "MNI_PROTOCOL_VERSION"));
    Assert.Equal(262_144, Define(header, "MNI_MAX_FRAME_BYTES"));
    Assert.Equal(512, Define(header, "MNI_MAX_POLICY_ENTRIES"));
    Assert.Contains("MNI_IOCTL_GET_PROTOCOL == 0x0022e040u", portable);
    Assert.Contains("MNI_IOCTL_GET_HEALTH == 0x0022e044u", portable);
    Assert.Contains("MNI_IOCTL_REPLACE_POLICY == 0x0022e048u", portable);
    Assert.Contains("MNI_IOCTL_ENROLL_PROCESS == 0x0022e04cu", portable);
    Assert.Contains("MNI_IOCTL_REMOVE_PROCESS == 0x0022e050u", portable);
    Assert.Contains("MNI_IOCTL_SET_KILL_STATE == 0x0022e054u", portable);
    Assert.Contains("sizeof(MNI_MESSAGE_HEADER) == 64u", portable);
    Assert.Contains("offsetof(MNI_MESSAGE_HEADER, RequestSequence) == 16u", portable);
    Assert.Contains("offsetof(MNI_MESSAGE_HEADER, RequestId) == 32u", portable);
    Assert.Contains("offsetof(MNI_MESSAGE_HEADER, BootId) == 48u", portable);
    Assert.Contains("sizeof(MNI_PROTOCOL_RESPONSE) == 104u", portable);
    Assert.Contains("sizeof(MNI_MUTATION_RESPONSE) == 120u", portable);
    Assert.Contains("sizeof(MNI_POLICY_ENTRY) == 64u", portable);
    Assert.Contains("offsetof(MNI_POLICY_ENTRY, RemoteAddress) == 40u", portable);
    Assert.Contains("offsetof(MNI_POLICY_ENTRY, ExpiresAtFileTime100ns) == 56u", portable);
    Assert.Contains("MNI_POLICY_REPLACE_BASE_SIZE == 112u", portable);
    Assert.Contains("offsetof(MNI_POLICY_REPLACE_REQUEST, Entries) == 112u", portable);
    Assert.Contains("sizeof(MNI_PROCESS_ENROLL_REQUEST) == 2248u", portable);
    Assert.Contains(
      "offsetof(MNI_PROCESS_ENROLL_REQUEST, NormalizedImageNtPath) == 168u",
      portable);
    Assert.Contains(
      "offsetof(MNI_PROCESS_ENROLL_REQUEST, NormalizedAppId) == 1208u",
      portable);
    Assert.Contains("sizeof(MNI_PROCESS_REMOVE_REQUEST) == 104u", portable);
    Assert.Contains("sizeof(MNI_KILL_REQUEST) == 80u", portable);
    Assert.Contains("sizeof(MNI_HEALTH_REQUEST) == 96u", portable);
    Assert.Contains("sizeof(MNI_HEALTH_COUNTERS) == 96u", portable);
    Assert.Contains("sizeof(MNI_HEALTH_RESPONSE) == 360u", portable);

    Assert.Equal(0x0022E040U, NetworkIsolationProtocolV3.IoctlGetProtocol);
    Assert.Equal(0x0022E044U, NetworkIsolationProtocolV3.IoctlGetHealth);
    Assert.Equal(0x0022E048U, NetworkIsolationProtocolV3.IoctlReplacePolicy);
    Assert.Equal(0x0022E04CU, NetworkIsolationProtocolV3.IoctlEnrollProcess);
    Assert.Equal(0x0022E050U, NetworkIsolationProtocolV3.IoctlRemoveProcess);
    Assert.Equal(0x0022E054U, NetworkIsolationProtocolV3.IoctlSetKillState);
    Assert.Equal(64, NetworkIsolationProtocolV3.MessageHeaderSize);
    Assert.Equal(104, NetworkIsolationProtocolV3.ProtocolResponseSize);
    Assert.Equal(120, NetworkIsolationProtocolV3.MutationResponseSize);
    Assert.Equal(64, NetworkIsolationProtocolV3.PolicyEntrySize);
    Assert.Equal(112, NetworkIsolationProtocolV3.PolicyReplaceBaseSize);
    Assert.Equal(2_248, NetworkIsolationProtocolV3.ProcessEnrollmentRequestSize);
    Assert.Equal(104, NetworkIsolationProtocolV3.ProcessRemoveRequestSize);
    Assert.Equal(80, NetworkIsolationProtocolV3.KillRequestSize);
    Assert.Equal(96, NetworkIsolationProtocolV3.HealthRequestSize);
    Assert.Equal(96, NetworkIsolationProtocolV3.HealthCountersSize);
    Assert.Equal(360, NetworkIsolationProtocolV3.HealthResponseSize);
    Assert.Equal(16, NetworkIsolationProtocolV3.MessageRequestSequenceOffset);
    Assert.Equal(32, NetworkIsolationProtocolV3.MessageRequestIdOffset);
    Assert.Equal(48, NetworkIsolationProtocolV3.MessageBootIdOffset);
    Assert.Equal(40, NetworkIsolationProtocolV3.PolicyRemoteAddressOffset);
    Assert.Equal(56, NetworkIsolationProtocolV3.PolicyExpiryOffset);
    Assert.Equal(112, NetworkIsolationProtocolV3.PolicyEntriesOffset);
    Assert.Equal(168, NetworkIsolationProtocolV3.EnrollmentImagePathOffset);
    Assert.Equal(1_208, NetworkIsolationProtocolV3.EnrollmentAppIdOffset);
  }

  [Fact]
  public void CanonicalFramesUseExactOffsetsAndLittleEndianScalars()
  {
    var bootId = Enumerable.Range(1, 16).Select(value => (byte)value).ToArray();
    var processIdentity = Enumerable.Repeat((byte)0xA5, 32).ToArray();
    var requestId = Guid.Parse("00112233-4455-6677-8899-aabbccddeeff");
    var request = NetworkIsolationProtocolV3.CreateRemovalRequest(
      0x0102030405060708UL,
      0x1112131415161718UL,
      requestId,
      bootId,
      0x2122232425262728UL,
      processIdentity);

    Assert.Equal(104, request.Length);
    Assert.Equal("68000000030007000000000000000000", Convert.ToHexString(request[..16]));
    Assert.Equal("0807060504030201", Convert.ToHexString(request[16..24]));
    Assert.Equal("1817161514131211", Convert.ToHexString(request[24..32]));
    Assert.Equal(requestId.ToByteArray(), request[32..48]);
    Assert.Equal(bootId, request[48..64]);
    Assert.Equal("2827262524232221", Convert.ToHexString(request[64..72]));
    Assert.Equal(processIdentity, request[72..104]);

    var address = new byte[16];
    address[0] = 192;
    address[1] = 168;
    address[2] = 1;
    var expiry = 0x3132333435363738UL;
    var policyRequest = NetworkIsolationProtocolV3.CreatePolicyReplaceRequest(
      0x0102030405060708UL,
      0x1112131415161718UL,
      requestId,
      bootId,
      expiry,
      [new NetworkIsolationPolicyEntryV3(
        processIdentity,
        EndpointKind: 1,
        AddressFamily: 4,
        IpProtocol: 6,
        PrefixLength: 24,
        RemotePort: 0x1234,
        address,
        expiry)],
      out var policySha256);
    Assert.Equal(176, policyRequest.Length);
    Assert.Equal("0807060504030201", Convert.ToHexString(policyRequest[16..24]));
    Assert.Equal("1817161514131211", Convert.ToHexString(policyRequest[24..32]));
    Assert.Equal(policySha256, policyRequest[64..96]);
    Assert.Equal("3837363534333231", Convert.ToHexString(policyRequest[96..104]));
    Assert.Equal("01000000", Convert.ToHexString(policyRequest[104..108]));
    Assert.Equal("01040618", Convert.ToHexString(policyRequest[144..148]));
    Assert.Equal("3412", Convert.ToHexString(policyRequest[148..150]));
    Assert.Equal(address, policyRequest[152..168]);
    Assert.Equal("3837363534333231", Convert.ToHexString(policyRequest[168..176]));
  }

  [Fact]
  public async Task BinaryBindSettleAndHealthAreMonotonicAndIdempotent()
  {
    var transport = new FakeV3DeviceTransport();
    await using var session = new NetworkIsolationDriverSessionV3(
      transport,
      transport.DriverMeasurementSha256Hex);
    var initial = await session.GetVerifiedHealthAsync(CancellationToken.None);
    Assert.Equal(0UL, initial.CurrentPolicyGeneration);

    var expiry = checked((ulong)DateTime.UtcNow.AddMinutes(10).ToFileTimeUtc());
    var policy = await session.EnsureDenyAllPolicyAsync(
      expiry,
      Guid.Parse("10000000-0000-0000-0000-000000000001"),
      CancellationToken.None);
    Assert.Equal(1UL, policy.CurrentPolicyGeneration);
    Assert.Equal(0U, policy.PolicyEntryCount);

    var path = @"\DEVICE\HARDDISKVOLUME3\WINDOWS\SYSTEM32\CMD.EXE";
    var appId = Encoding.Unicode.GetBytes(path + '\0');
    var image = Enumerable.Repeat((byte)0xC3, 32).ToArray();
    var processIdentity = NetworkIsolationProtocolV3.ComputeProcessIdentitySha256(
      5_000,
      0x01DC000000000001,
      0x1020304050607080,
      image,
      path,
      appId);
    var enrollment = new NetworkIsolationProcessEnrollmentV3(
      5_000,
      0x01DC000000000001,
      0x1020304050607080,
      expiry,
      image,
      processIdentity,
      path,
      appId);
    var enrollId = Guid.Parse("20000000-0000-0000-0000-000000000002");
    var first = await session.EnrollProcessAsync(
      enrollment,
      enrollId,
      CancellationToken.None);
    var replay = await session.EnrollProcessAsync(
      enrollment,
      enrollId,
      CancellationToken.None);

    Assert.Equal(first, replay);
    Assert.Equal(1, transport.EnrollmentIoctls);
    Assert.Equal(1U, (await session.GetVerifiedHealthAsync(
      CancellationToken.None)).EnrolledProcessCount);

    _ = await session.RemoveProcessAsync(
      enrollment.ProcessId,
      enrollment.ProcessIdentitySha256,
      Guid.Parse("30000000-0000-0000-0000-000000000003"),
      CancellationToken.None);
    var settled = await session.GetVerifiedHealthAsync(CancellationToken.None);
    Assert.Equal(0U, settled.EnrolledProcessCount);
    Assert.Equal([1UL, 2UL, 3UL], transport.AcceptedMutationSequences);
    Assert.DoesNotContain(
      transport.ControlCodes,
      value => value is 0x00222000U or 0x00222004U or 0x00222008U or 0x0022200CU);
  }

  [Fact]
  public async Task DriverReplayOrStaleGenerationTripsTheSessionWithoutRetry()
  {
    var transport = new FakeV3DeviceTransport
    {
      ForcedMutationStatus = NetworkIsolationProtocolV3.StatusReplay,
    };
    await using var session = new NetworkIsolationDriverSessionV3(
      transport,
      transport.DriverMeasurementSha256Hex);
    var expiry = checked((ulong)DateTime.UtcNow.AddMinutes(10).ToFileTimeUtc());

    var exception = await Assert.ThrowsAsync<NetworkIsolationDriverException>(
      async () => await session.EnsureDenyAllPolicyAsync(
        expiry,
        Guid.NewGuid(),
        CancellationToken.None));
    Assert.Equal(NetworkIsolationProtocolV3.StatusReplay, exception.Status);
    Assert.Equal(1, transport.PolicyIoctls);
    await Assert.ThrowsAsync<IOException>(
      async () => await session.GetVerifiedHealthAsync(CancellationToken.None));
    Assert.Equal(1, transport.PolicyIoctls);
  }

  [Fact]
  public async Task KillUsesOutOfBandGenerationAndLatchesTheSession()
  {
    var transport = new FakeV3DeviceTransport();
    await using var session = new NetworkIsolationDriverSessionV3(
      transport,
      transport.DriverMeasurementSha256Hex);
    _ = await session.GetVerifiedHealthAsync(CancellationToken.None);

    await session.KillAsync(Guid.NewGuid(), 7, CancellationToken.None);

    Assert.True(transport.KillActive);
    Assert.Equal(1, transport.KillIoctls);
    await Assert.ThrowsAsync<IOException>(
      async () => await session.GetVerifiedHealthAsync(CancellationToken.None));
  }

  [Fact]
  public async Task InvalidHealthChallengeFailsClosed()
  {
    var transport = new FakeV3DeviceTransport
    {
      CorruptHealthChallenge = true,
    };
    await using var session = new NetworkIsolationDriverSessionV3(
      transport,
      transport.DriverMeasurementSha256Hex);

    await Assert.ThrowsAsync<InvalidDataException>(
      async () => await session.GetVerifiedHealthAsync(CancellationToken.None));
    await Assert.ThrowsAsync<IOException>(
      async () => await session.GetVerifiedHealthAsync(CancellationToken.None));
  }

  [Fact]
  public async Task HighLevelBindAndSettleMapToV3AndKeepSignedAttestationMandatory()
  {
    var transport = new FakeV3DeviceTransport();
    await using var session = new NetworkIsolationDriverSessionV3(
      transport,
      transport.DriverMeasurementSha256Hex);
    using var signer = new FakeAttestationAuthority();
    var options = Options(transport.DriverMeasurementSha256Hex, signer.KeyId);
    var processFactory = new FakeProcessLeaseFactory();
    await using var client = new WindowsKernelIsolationDriverClient(
      options,
      new FakeBootIdentity(BootId),
      signer,
      signer,
      new FakePostureSource(DriverPathSha256),
      session,
      processFactory);
    var (request, invocation, observation, peer) = HighLevelRequest(options);

    var attestation = await client.AttestAsync(CancellationToken.None);
    KernelIsolationValidation.RequireExactAttestation(
      attestation,
      options.DeviceId,
      BootId,
      options.SupervisorInstanceId,
      options.DriverPolicyEpoch,
      options.DriverServiceName,
      options.IsolationPolicySha256,
      options.DriverMeasurementSha256,
      options.ExpectedSupervisorImageSha256);
    var binding = await client.BindSuspendedProcessAsync(
      request,
      observation,
      invocation,
      peer,
      CancellationToken.None);
    KernelIsolationValidation.RequireBinding(binding);
    var highLevelBinding = new PrivilegedCommandSuspendedProcessBindingV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      Guid.NewGuid().ToString("D"),
      PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
      PayloadDigest.Sha256Hex("nonce"),
      PayloadDigest.Sha256Hex("lease"),
      request.Action,
      options.SupervisorInstanceId,
      BootId,
      new PrivilegedCommandIsolationProcessBinding(
        observation.ParentProcessId,
        observation.ParentProcessCreationTimeUtcFileTime,
        observation.ChildProcessId,
        observation.ChildProcessCreationTimeUtcFileTime,
        observation.PrimaryThreadId,
        binding.JobObjectId,
        binding.JobObjectIdentitySha256,
        binding.ImagePathSha256,
        binding.ImageSha256,
        binding.ImageVolumeSerialNumber,
        binding.ImageFileId,
        binding.CommandLineSha256,
        binding.WorkingDirectorySha256,
        binding.EnvironmentBlockSha256,
        binding.InvocationSha256),
      CreatedSuspended: true,
      AssignedToJob: true,
      DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    var terminal = await client.SettleAsync(
      binding.EnforcementLeaseId,
      highLevelBinding,
      new TerminalObservation(
        ProcessResumed: true,
        ExitCodeKnown: true,
        ExitCode: 0,
        PrivilegedCommandIsolationTerminalOutcomes.Completed),
      CancellationToken.None);

    KernelIsolationValidation.RequireTerminal(terminal);
    Assert.True(terminal.ProcessTreeTerminal);
    Assert.True(terminal.EnforcementContinuous);
    Assert.Equal(1, transport.PolicyIoctls);
    Assert.Equal(1, transport.EnrollmentIoctls);
    Assert.Equal(1, transport.RemovalIoctls);
    Assert.True(processFactory.LastLease!.NestedJobAssigned);
    Assert.True(processFactory.LastLease.TerminalChecked);
  }

  [Fact]
  public async Task MissingSignedV3AttestationSourceRejectsAfterBinaryHealth()
  {
    var transport = new FakeV3DeviceTransport();
    await using var session = new NetworkIsolationDriverSessionV3(
      transport,
      transport.DriverMeasurementSha256Hex);
    using var signer = new FakeAttestationAuthority();
    var options = Options(transport.DriverMeasurementSha256Hex, signer.KeyId);
    await using var client = new WindowsKernelIsolationDriverClient(
      options,
      new FakeBootIdentity(BootId),
      signer,
      new UnavailableV3SignedDriverAttestationSource(),
      new FakePostureSource(DriverPathSha256),
      session,
      new FakeProcessLeaseFactory());

    var exception = await Assert.ThrowsAsync<UnauthorizedAccessException>(
      async () => await client.AttestAsync(CancellationToken.None));

    Assert.Contains("not provisioned", exception.Message, StringComparison.Ordinal);
    Assert.Contains(NetworkIsolationProtocolV3.IoctlGetProtocol, transport.ControlCodes);
    Assert.Contains(NetworkIsolationProtocolV3.IoctlGetHealth, transport.ControlCodes);
    Assert.DoesNotContain(
      transport.ControlCodes,
      value => value is 0x00222000U or 0x00222004U or 0x00222008U or 0x0022200CU);
  }

  [Fact]
  public void ExecutableIdentityLockBlocksReplacementAndDetectsPostReleaseDrift()
  {
    if (!OperatingSystem.IsWindows())
    {
      return;
    }

    var directory = Path.Combine(
      Path.GetTempPath(),
      $"msaidizi-v3-image-{Guid.NewGuid():N}");
    var executablePath = Path.Combine(directory, "tool.exe");
    var replacementPath = Path.Combine(directory, "replacement.exe");
    Directory.CreateDirectory(directory);
    try
    {
      File.WriteAllBytes(executablePath, Enumerable.Repeat((byte)0x3C, 4_096).ToArray());
      File.WriteAllBytes(replacementPath, Enumerable.Repeat((byte)0xC3, 4_096).ToArray());
      var measured = WindowsPrivilegedCommandProcessLeaseFactory
        .MeasureExecutableIdentity(executablePath);

      using (var locked = WindowsPrivilegedCommandProcessLeaseFactory
        .OpenAndVerifyExecutableIdentity(
          executablePath,
          measured.Sha256,
          measured.VolumeSerialNumber,
          measured.FileId))
      {
        var matchingAppId = WindowsPrivilegedCommandProcessLeaseFactory
          .QueryWfpApplicationId(executablePath);
        locked.RequireWfpApplicationIdMatches(
          matchingAppId,
          measured.VolumeSerialNumber,
          measured.FileId);
        var wrongAppId = Encoding.Unicode.GetBytes(
          locked.NormalizedNtPath + ".replacement\0");
        Assert.Throws<UnauthorizedAccessException>(() =>
          locked.RequireWfpApplicationIdMatches(
            wrongAppId,
            measured.VolumeSerialNumber,
            measured.FileId));
        var replacementError = Record.Exception(() =>
          File.Move(replacementPath, executablePath, overwrite: true));
        Assert.True(replacementError is IOException or UnauthorizedAccessException);
        var writeError = Record.Exception(() =>
        {
          using var writer = new FileStream(
            executablePath,
            FileMode.Open,
            FileAccess.Write,
            FileShare.Read);
        });
        Assert.True(writeError is IOException or UnauthorizedAccessException);
        locked.RequireStillSame(measured.VolumeSerialNumber, measured.FileId);
      }

      File.Move(replacementPath, executablePath, overwrite: true);
      var replaced = WindowsPrivilegedCommandProcessLeaseFactory
        .MeasureExecutableIdentity(executablePath);
      Assert.NotEqual(measured.Sha256, replaced.Sha256);
      Assert.Throws<UnauthorizedAccessException>(() =>
        WindowsPrivilegedCommandProcessLeaseFactory.OpenAndVerifyExecutableIdentity(
          executablePath,
          measured.Sha256,
          measured.VolumeSerialNumber,
          measured.FileId));
    }
    finally
    {
      Directory.Delete(directory, recursive: true);
    }
  }

  private static PrivilegedCommandSupervisorOptions Options(
    string driverSha256,
    string attestationKeyId) => new()
    {
      Enabled = true,
      DeviceId = DeviceId,
      SupervisorInstanceId = SupervisorId,
      DriverPolicyEpoch = "isolation-policy-v3-bridge",
      IsolationPolicySha256 = PolicySha256,
      DriverMeasurementSha256 = driverSha256,
      ExpectedSupervisorImageSha256 = ServiceSha256,
      DriverServiceName = PrivilegedCommandIsolationSupervisorIdentity.DriverServiceName,
      DriverAttestationVerificationKey = new PrivilegedCommandVerificationKeyOptions
      {
        KeyId = attestationKeyId,
      },
      DriverAttestationAllowedClockSkew = TimeSpan.FromSeconds(30),
      DriverAttestationMaximumLifetime = TimeSpan.FromMinutes(1),
      DriverOperationTimeout = TimeSpan.FromSeconds(2),
    };

  private static (
    PrivilegedCommandIsolationReservationRequestV1 Request,
    PrivilegedCommandIsolationInvocationV2 Invocation,
    SuspendedProcessObservation Observation,
    PipePeerIdentity Peer) HighLevelRequest(PrivilegedCommandSupervisorOptions options)
  {
    var environment = Array.Empty<PrivilegedCommandIsolationEnvironmentVariableV2>();
    var draft = new PrivilegedCommandIsolationInvocationV2(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      "cmd",
      @"C:\Windows\System32\cmd.exe",
      ImageSha256,
      42,
      43,
      ["/d", "/s", "/c", "echo test"],
      @"C:\Windows\System32",
      environment,
      30,
      1_024,
      30,
      1_024,
      4,
      134_217_728,
      string.Empty,
      string.Empty);
    var invocation = draft with
    {
      CommandLineSha256 = PayloadDigest.Sha256Hex(
        PrivilegedCommandIsolationCanonical.BuildCommandLine(draft)),
      EnvironmentBlockSha256 =
        PrivilegedCommandIsolationCanonical.EnvironmentBlockSha256(environment),
    };
    var authorization = new PrivilegedCommandIsolationActionAuthorizationV2(
      PrivilegedCommandIsolationCapability.Id,
      PrivilegedCommandIsolationCapability.Version,
      PayloadDigest.Sha256Hex("arguments"),
      null,
      null,
      PayloadDigest.Sha256Hex("idempotency"),
      "lease:test",
      "1",
      DateTimeOffset.UtcNow.AddMinutes(2).ToUnixTimeSeconds(),
      1,
      ActionExecutionModes.Execute,
      new ActionBudget(120, 10, 20, 5, 1_024, 0, 1m));
    var action = new PrivilegedCommandIsolationActionBinding(
      Guid.NewGuid().ToString("D"),
      Guid.NewGuid().ToString("D"),
      Guid.NewGuid().ToString("D"),
      Guid.NewGuid().ToString("D"),
      options.DeviceId,
      Guid.NewGuid().ToString("D"),
      PayloadDigest.Sha256Hex("token"),
      PrivilegedCommandIsolationCanonical.InvocationSha256(invocation),
      PayloadDigest.Sha256Hex(invocation.ExecutablePath),
      ImageSha256,
      options.IsolationPolicySha256,
      options.DriverMeasurementSha256,
      options.ExpectedSupervisorImageSha256,
      PrivilegedCommandIsolationFeatures.Required,
      authorization);
    var now = DateTimeOffset.UtcNow;
    var request = new PrivilegedCommandIsolationReservationRequestV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      Guid.NewGuid().ToString("D"),
      Convert.ToBase64String(Enumerable.Repeat((byte)7, 32).ToArray())
        .TrimEnd('=').Replace('+', '-').Replace('/', '_'),
      action,
      now.ToUnixTimeMilliseconds(),
      now.AddMinutes(1).ToUnixTimeMilliseconds());
    var peer = new PipePeerIdentity(
      4_000,
      0x01DC000000000010,
      PayloadDigest.Sha256Hex("peer-path"),
      PayloadDigest.Sha256Hex("peer-image"));
    var observation = new SuspendedProcessObservation(
      peer.ProcessId,
      peer.ProcessCreationTimeUtcFileTime,
      5_000,
      0x01DC000000000020,
      6_000,
      PayloadDigest.Sha256Hex(invocation.ExecutablePath),
      ImageSha256,
      invocation.ExecutableVolumeSerialNumber,
      invocation.ExecutableFileId,
      invocation.CommandLineSha256,
      PrivilegedCommandIsolationCanonical.WorkingDirectorySha256(
        invocation.WorkingDirectory),
      invocation.EnvironmentBlockSha256,
      PrivilegedCommandIsolationCanonical.InvocationSha256(invocation),
      CreatedSuspended: true,
      AssignedToJob: true);
    return (request, invocation, observation, peer);
  }

  private static int Define(string header, string name)
  {
    var match = Regex.Match(
      header,
      $@"#define\s+{Regex.Escape(name)}\s+(?<value>\d+)u");
    Assert.True(match.Success, $"Missing native define {name}.");
    return int.Parse(match.Groups["value"].Value, System.Globalization.CultureInfo.InvariantCulture);
  }

  private static string FindRepositoryFile(params string[] segments)
  {
    foreach (var start in new[] { Environment.CurrentDirectory, AppContext.BaseDirectory })
    {
      var current = new DirectoryInfo(Path.GetFullPath(start));
      while (current is not null)
      {
        var candidate = Path.Combine([current.FullName, .. segments]);
        if (File.Exists(candidate))
        {
          return candidate;
        }
        current = current.Parent;
      }
    }
    throw new FileNotFoundException(
      $"Repository file was not found: {string.Join('/', segments)}");
  }

  private const string DeviceId = "10000000-0000-0000-0000-000000000001";
  private const string SupervisorId = "20000000-0000-0000-0000-000000000002";
  private const string BootId = "30000000-0000-0000-0000-000000000003";
  private const string PolicySha256 =
    "1111111111111111111111111111111111111111111111111111111111111111";
  private const string ServiceSha256 =
    "2222222222222222222222222222222222222222222222222222222222222222";
  private const string DriverPathSha256 =
    "3333333333333333333333333333333333333333333333333333333333333333";
  private const string ImageSha256 =
    "4444444444444444444444444444444444444444444444444444444444444444";

  private sealed class FakeBootIdentity(string bootId) : IBootIdentity
  {
    public string BootId { get; } = bootId;
  }

  private sealed class FakePostureSource(string driverPathSha256) :
    IWindowsIsolationHostPostureSource
  {
    public WindowsIsolationHostPosture GetVerified(
      PrivilegedCommandSupervisorOptions options) => new(
        driverPathSha256,
        SecureBootEnabled: true,
        HvciEnabled: true,
        WdacEnforced: true);
  }

  private sealed class FakeAttestationAuthority :
    IV3SignedDriverAttestationSource,
    IDriverAttestationVerificationKeyResolver,
    IDisposable
  {
    private readonly ECDsa _privateKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private readonly byte[] _publicKey;

    public FakeAttestationAuthority()
    {
      _publicKey = _privateKey.ExportSubjectPublicKeyInfo();
    }

    public string KeyId { get; } = "driver-attestation-v3-test";

    public ValueTask<SignedPrivilegedCommandDriverAttestationV2> AttestAsync(
      string challengeNonceSha256,
      NetworkIsolationHealthV3 health,
      WindowsIsolationHostPosture posture,
      PrivilegedCommandSupervisorOptions options,
      string operatingSystemBootId,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      var now = DateTimeOffset.UtcNow;
      var evidence = new PrivilegedCommandDriverAttestationEvidenceV2(
        PrivilegedCommandIsolationCanonical.ContractVersion,
        PrivilegedCommandIsolationSignaturePurposes.DriverAttestation,
        KeyId,
        options.DeviceId,
        options.SupervisorInstanceId,
        operatingSystemBootId,
        options.DriverPolicyEpoch,
        challengeNonceSha256,
        options.IsolationPolicySha256,
        options.DriverMeasurementSha256,
        options.ExpectedSupervisorImageSha256,
        options.DriverServiceName,
        posture.DriverImagePathSha256,
        posture.SecureBootEnabled,
        posture.HvciEnabled,
        posture.WdacEnforced,
        PrivilegedCommandIsolationFeatures.Required,
        now.ToUnixTimeMilliseconds(),
        now.AddSeconds(30).ToUnixTimeMilliseconds());
      return ValueTask.FromResult(
        PrivilegedCommandIsolationCanonical.SignDriverAttestation(
          evidence,
          _privateKey));
    }

    public bool TryResolve(string keyId, out ECDsa? publicKey)
    {
      publicKey = null;
      if (!string.Equals(keyId, KeyId, StringComparison.Ordinal))
      {
        return false;
      }
      publicKey = ECDsa.Create();
      publicKey.ImportSubjectPublicKeyInfo(_publicKey, out _);
      return true;
    }

    public void Dispose()
    {
      _privateKey.Dispose();
      CryptographicOperations.ZeroMemory(_publicKey);
    }
  }

  private sealed class FakeProcessLeaseFactory :
    IPrivilegedCommandProcessLeaseFactory
  {
    public FakeProcessLease? LastLease { get; private set; }

    public ValueTask<IPrivilegedCommandProcessLease> AcquireAsync(
      SuspendedProcessObservation observation,
      PrivilegedCommandIsolationInvocationV2 invocation,
      ulong enrollmentExpiresAtFileTime100ns,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      var path = @"\DEVICE\HARDDISKVOLUME3\WINDOWS\SYSTEM32\CMD.EXE";
      var appId = Encoding.Unicode.GetBytes(path + '\0');
      var image = Convert.FromHexString(observation.ImageSha256);
      var identity = NetworkIsolationProtocolV3.ComputeProcessIdentitySha256(
        checked((ulong)observation.ChildProcessId),
        checked((ulong)observation.ChildProcessCreationTimeUtcFileTime),
        0x1020304050607080,
        image,
        path,
        appId);
      LastLease = new FakeProcessLease(
        new NetworkIsolationProcessEnrollmentV3(
          checked((ulong)observation.ChildProcessId),
          checked((ulong)observation.ChildProcessCreationTimeUtcFileTime),
          0x1020304050607080,
          enrollmentExpiresAtFileTime100ns,
          image,
          identity,
          path,
          appId));
      return ValueTask.FromResult<IPrivilegedCommandProcessLease>(LastLease);
    }
  }

  private sealed class FakeProcessLease(
    NetworkIsolationProcessEnrollmentV3 enrollment) :
    IPrivilegedCommandProcessLease
  {
    public Guid JobObjectId { get; } = Guid.NewGuid();

    public string JobObjectIdentitySha256 { get; } = PayloadDigest.Sha256Hex("job");

    public NetworkIsolationProcessEnrollmentV3 Enrollment { get; } = enrollment;

    public bool NestedJobAssigned { get; } = true;

    public bool TerminalChecked { get; private set; }

    public ValueTask<PrivilegedCommandProcessTerminalFacts> EnsureTerminalAsync(
      bool terminate,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      TerminalChecked = true;
      return ValueTask.FromResult(new PrivilegedCommandProcessTerminalFacts(
        ProcessTreeTerminal: true,
        ExitCodeKnown: true,
        ExitCode: 0,
        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
  }

  private sealed class FakeV3DeviceTransport : INetworkIsolationDeviceTransport
  {
    private static readonly byte[] HealthDomain =
      Encoding.ASCII.GetBytes("MSAIDIZI-NETWORK-DRIVER-HEALTH-V1\0");
    private readonly byte[] _bootId = Enumerable.Range(1, 16)
      .Select(value => (byte)value).ToArray();
    private readonly byte[] _bootMeasurement = Enumerable.Repeat((byte)0xB2, 32)
      .ToArray();
    private readonly byte[] _driverMeasurement = Enumerable.Repeat((byte)0xD4, 32)
      .ToArray();
    private readonly Dictionary<ulong, byte[]> _processes = [];
    private byte[] _policySha256 = new byte[32];
    private ulong _policyGeneration;
    private ulong _policyExpiresAt;
    private ulong _lastSequence;
    private ulong _killGeneration;

    public string DriverMeasurementSha256Hex =>
      Convert.ToHexString(_driverMeasurement).ToLowerInvariant();

    public List<uint> ControlCodes { get; } = [];

    public List<ulong> AcceptedMutationSequences { get; } = [];

    public int PolicyIoctls { get; private set; }

    public int EnrollmentIoctls { get; private set; }

    public int RemovalIoctls { get; private set; }

    public int KillIoctls { get; private set; }

    public bool KillActive { get; private set; }

    public bool CorruptHealthChallenge { get; init; }

    public uint? ForcedMutationStatus { get; init; }

    public ValueTask<byte[]> ExchangeAsync(
      uint controlCode,
      ReadOnlyMemory<byte> input,
      int expectedOutputBytes,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      ControlCodes.Add(controlCode);
      var request = input.Span;
      var output = controlCode switch
      {
        NetworkIsolationProtocolV3.IoctlGetProtocol => Protocol(request),
        NetworkIsolationProtocolV3.IoctlGetHealth => Health(request),
        NetworkIsolationProtocolV3.IoctlReplacePolicy => ReplacePolicy(request),
        NetworkIsolationProtocolV3.IoctlEnrollProcess => Enroll(request),
        NetworkIsolationProtocolV3.IoctlRemoveProcess => Remove(request),
        NetworkIsolationProtocolV3.IoctlSetKillState => Kill(request),
        _ => throw new InvalidOperationException("Unexpected fake IOCTL."),
      };
      Assert.Equal(expectedOutputBytes, output.Length);
      return ValueTask.FromResult(output);
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private byte[] Protocol(ReadOnlySpan<byte> request)
    {
      var output = ResponseHeader(
        request,
        NetworkIsolationProtocolV3.ProtocolResponseSize,
        NetworkIsolationProtocolV3.MessageProtocolResponse);
      BinaryPrimitives.WriteUInt16LittleEndian(output.AsSpan(64, 2), 3);
      BinaryPrimitives.WriteUInt16LittleEndian(output.AsSpan(66, 2), 3);
      BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(68, 4), 262_144);
      BinaryPrimitives.WriteUInt64LittleEndian(
        output.AsSpan(72, 8),
        NetworkIsolationProtocolV3.RequiredFeatures);
      BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(80, 4), 64);
      BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(84, 4), 64);
      BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(88, 4), 112);
      BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(92, 4), 2_248);
      BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(96, 4), 360);
      return output;
    }

    private byte[] Health(ReadOnlySpan<byte> request)
    {
      var output = ResponseHeader(
        request,
        NetworkIsolationProtocolV3.HealthResponseSize,
        NetworkIsolationProtocolV3.MessageHealthResponse);
      var flags = NetworkIsolationProtocolV3.HealthWfpRegistered
        | NetworkIsolationProtocolV3.HealthDriverMeasurementProvisioned
        | NetworkIsolationProtocolV3.HealthBootMeasurementProvisioned;
      if (_policyGeneration != 0)
      {
        flags |= NetworkIsolationProtocolV3.HealthPolicyActive;
      }
      if (KillActive)
      {
        flags |= NetworkIsolationProtocolV3.HealthKillActive;
      }
      BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(68, 4), flags);
      BinaryPrimitives.WriteUInt64LittleEndian(output.AsSpan(72, 8), 0x01DC000000000000);
      BinaryPrimitives.WriteUInt64LittleEndian(output.AsSpan(80, 8), _policyGeneration);
      BinaryPrimitives.WriteUInt64LittleEndian(output.AsSpan(88, 8), _killGeneration);
      BinaryPrimitives.WriteUInt64LittleEndian(output.AsSpan(96, 8), _policyExpiresAt);
      BinaryPrimitives.WriteUInt64LittleEndian(output.AsSpan(104, 8), _lastSequence);
      _policySha256.CopyTo(output.AsSpan(112, 32));
      _bootMeasurement.CopyTo(output.AsSpan(144, 32));
      _driverMeasurement.CopyTo(output.AsSpan(176, 32));
      BinaryPrimitives.WriteUInt32LittleEndian(
        output.AsSpan(208, 4),
        checked((uint)_processes.Count));
      BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(216, 4), 11);
      BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(220, 4), 12);
      using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
      hash.AppendData(HealthDomain);
      hash.AppendData(request[64..96]);
      hash.AppendData(output.AsSpan(0, 328));
      var challenge = hash.GetHashAndReset();
      if (CorruptHealthChallenge)
      {
        challenge[0] ^= 0xFF;
      }
      challenge.CopyTo(output.AsSpan(328, 32));
      return output;
    }

    private byte[] ReplacePolicy(ReadOnlySpan<byte> request)
    {
      PolicyIoctls++;
      var status = MutationStatus(request);
      if (status == NetworkIsolationProtocolV3.StatusOk)
      {
        _policyGeneration = BinaryPrimitives.ReadUInt64LittleEndian(request[24..32]);
        _policyExpiresAt = BinaryPrimitives.ReadUInt64LittleEndian(request[96..104]);
        _policySha256 = request[64..96].ToArray();
      }
      return Mutation(request, status);
    }

    private byte[] Enroll(ReadOnlySpan<byte> request)
    {
      EnrollmentIoctls++;
      var status = MutationStatus(request);
      if (status == NetworkIsolationProtocolV3.StatusOk)
      {
        var processId = BinaryPrimitives.ReadUInt64LittleEndian(request[64..72]);
        _processes[processId] = request[128..160].ToArray();
      }
      return Mutation(request, status);
    }

    private byte[] Remove(ReadOnlySpan<byte> request)
    {
      RemovalIoctls++;
      var status = MutationStatus(request);
      var processId = BinaryPrimitives.ReadUInt64LittleEndian(request[64..72]);
      if (status == NetworkIsolationProtocolV3.StatusOk
        && (!_processes.TryGetValue(processId, out var identity)
          || !CryptographicOperations.FixedTimeEquals(identity, request[72..104])))
      {
        status = NetworkIsolationProtocolV3.StatusProcessNotFound;
      }
      if (status == NetworkIsolationProtocolV3.StatusOk)
      {
        _processes.Remove(processId);
      }
      return Mutation(request, status);
    }

    private byte[] Kill(ReadOnlySpan<byte> request)
    {
      KillIoctls++;
      var status = MutationStatus(request);
      if (status == NetworkIsolationProtocolV3.StatusOk)
      {
        _killGeneration = BinaryPrimitives.ReadUInt64LittleEndian(request[64..72]);
        KillActive = true;
      }
      return Mutation(request, status);
    }

    private uint MutationStatus(ReadOnlySpan<byte> request)
    {
      if (ForcedMutationStatus is uint forced)
      {
        return forced;
      }
      var sequence = BinaryPrimitives.ReadUInt64LittleEndian(request[16..24]);
      return sequence > _lastSequence
        ? NetworkIsolationProtocolV3.StatusOk
        : NetworkIsolationProtocolV3.StatusReplay;
    }

    private byte[] Mutation(ReadOnlySpan<byte> request, uint status)
    {
      var output = ResponseHeader(
        request,
        NetworkIsolationProtocolV3.MutationResponseSize,
        NetworkIsolationProtocolV3.MessageMutationResponse);
      var sequence = BinaryPrimitives.ReadUInt64LittleEndian(request[16..24]);
      if (status == NetworkIsolationProtocolV3.StatusOk)
      {
        _lastSequence = sequence;
        AcceptedMutationSequences.Add(sequence);
      }
      BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(64, 4), status);
      BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(68, 4), 0xC0000022);
      BinaryPrimitives.WriteUInt64LittleEndian(output.AsSpan(72, 8), _policyGeneration);
      BinaryPrimitives.WriteUInt64LittleEndian(
        output.AsSpan(80, 8),
        status == NetworkIsolationProtocolV3.StatusOk ? sequence : _lastSequence);
      _policySha256.CopyTo(output.AsSpan(88, 32));
      return output;
    }

    private byte[] ResponseHeader(
      ReadOnlySpan<byte> request,
      int size,
      ushort messageType)
    {
      var output = new byte[size];
      BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(0, 4), checked((uint)size));
      BinaryPrimitives.WriteUInt16LittleEndian(output.AsSpan(4, 2), 3);
      BinaryPrimitives.WriteUInt16LittleEndian(output.AsSpan(6, 2), messageType);
      request[16..32].CopyTo(output.AsSpan(16, 16));
      request[32..48].CopyTo(output.AsSpan(32, 16));
      _bootId.CopyTo(output.AsSpan(48, 16));
      return output;
    }
  }
}
