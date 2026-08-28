using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Security;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class NamedPipePrivilegedCommandTrustedRootIsolationClientTests
{
  private const long NowUnixMilliseconds = 1_800_000_000_000;
  private const string DeviceId = "10000000-0000-4000-8000-000000000001";
  private const string PolicySha256 =
    "1111111111111111111111111111111111111111111111111111111111111111";
  private const string DriverSha256 =
    "2222222222222222222222222222222222222222222222222222222222222222";
  private const string ServiceSha256 =
    "3333333333333333333333333333333333333333333333333333333333333333";

  [Fact]
  public async Task SignedNamedPipeClientCompletesTheLiveLifecycleExactlyOnce()
  {
    using var supervisor = new ScriptedSupervisor();
    var client = supervisor.CreateClient();
    var session = await client.TryReserveAsync(CreateBinding(), CancellationToken.None);
    Assert.NotNull(session);
    await using var sessionScope = session;

    var bind = await session.TryBindSuspendedProcessAsync(
      CreateProcessObservation(),
      CancellationToken.None);
    Assert.NotNull(bind);
    var terminalObservation = new PrivilegedCommandTerminalObservation(
      ProcessResumed: true,
      ExitCodeKnown: true,
      ExitCode: 0,
      PrivilegedCommandIsolationTerminalOutcomes.Completed);
    var terminal = await session.TrySettleAsync(
      bind,
      terminalObservation,
      CancellationToken.None);

    Assert.NotNull(terminal);
    Assert.True(terminal.IsIsolationIntact);
    Assert.Same(
      terminal,
      await session.TrySettleAsync(bind, terminalObservation, CancellationToken.None));
    Assert.Equal(
      [
        PrivilegedCommandIsolationPipeProtocol.ReserveRequest,
        PrivilegedCommandIsolationPipeProtocol.BindRequest,
        PrivilegedCommandIsolationPipeProtocol.SettleRequest,
      ],
      supervisor.RequestKinds);
    Assert.Equal([1L, 2L, 3L], supervisor.RequestSequences);
  }

  [Fact]
  public async Task PreBindReleaseIsExactIdempotentAndExcludesBind()
  {
    using var supervisor = new ScriptedSupervisor();
    var client = supervisor.CreateClient();
    var session = await client.TryReserveAsync(CreateBinding(), CancellationToken.None);
    Assert.NotNull(session);
    await using var sessionScope = session;

    var release = await session.TryReleaseBeforeBindAsync(
      PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeProcess,
      CancellationToken.None);
    Assert.NotNull(release);
    Assert.Same(
      release,
      await session.TryReleaseBeforeBindAsync(
        PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeProcess,
        CancellationToken.None));
    await Assert.ThrowsAsync<InvalidOperationException>(() =>
      session.TryReleaseBeforeBindAsync(
        PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeBind,
        CancellationToken.None).AsTask());
    await Assert.ThrowsAsync<InvalidOperationException>(() =>
      session.TryBindSuspendedProcessAsync(
        CreateProcessObservation(),
        CancellationToken.None).AsTask());

    Assert.Equal(
      [
        PrivilegedCommandIsolationPipeProtocol.ReserveRequest,
        PrivilegedCommandIsolationPipeProtocol.ReleaseRequest,
      ],
      supervisor.RequestKinds);
  }

  [Fact]
  public async Task RestartRecoveryHasOnlyReservationAndBindSettlementSurfaces()
  {
    using var supervisor = new ScriptedSupervisor();
    var client = supervisor.CreateClient();

    var pendingReservationSession = await client.TryReserveAsync(
      CreateBinding(),
      CancellationToken.None);
    Assert.NotNull(pendingReservationSession);
    var pendingReservation = new PrivilegedCommandIsolationPendingReservation(
      pendingReservationSession.Reservation.Request,
      pendingReservationSession.Reservation.SignedLease);
    await pendingReservationSession.DisposeAsync();

    var recoveredRelease = await client.TryRecoverPendingReservationAsync(
      pendingReservation,
      CancellationToken.None);
    Assert.NotNull(recoveredRelease);
    Assert.Equal(
      PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeProcess,
      recoveredRelease.SignedRelease.Release.Outcome);

    var pendingBindSession = await client.TryReserveAsync(
      CreateBinding(),
      CancellationToken.None);
    Assert.NotNull(pendingBindSession);
    var bind = await pendingBindSession.TryBindSuspendedProcessAsync(
      CreateProcessObservation(),
      CancellationToken.None);
    Assert.NotNull(bind);
    var pendingBind = new PrivilegedCommandIsolationPendingBind(
      pendingBindSession.Reservation.Request,
      pendingBindSession.Reservation.SignedLease,
      bind.Binding,
      bind.SignedAcknowledgement);
    await pendingBindSession.DisposeAsync();

    var recoveredTerminal = await client.TryRecoverPendingBindAsync(
      pendingBind,
      CancellationToken.None);
    Assert.NotNull(recoveredTerminal);
    Assert.True(recoveredTerminal.SignedReceipt.Receipt.ProcessTreeTerminal);
    Assert.Equal(
      PrivilegedCommandIsolationTerminalOutcomes.Unknown,
      recoveredTerminal.SignedReceipt.Receipt.Outcome);
    Assert.Contains(
      PrivilegedCommandIsolationPipeProtocol.RecoverReservationRequest,
      supervisor.RequestKinds);
    Assert.Contains(
      PrivilegedCommandIsolationPipeProtocol.RecoverBindRequest,
      supervisor.RequestKinds);
  }

  [Fact]
  public async Task RestartRecoveryAcceptsExpiredHistoricalLeaseAndBindEvidence()
  {
    using var supervisor = new ScriptedSupervisor();
    var client = supervisor.CreateClient();

    var reservationSession = await client.TryReserveAsync(
      CreateBinding(),
      CancellationToken.None);
    Assert.NotNull(reservationSession);
    var pendingReservation = new PrivilegedCommandIsolationPendingReservation(
      reservationSession.Reservation.Request,
      reservationSession.Reservation.SignedLease);
    await reservationSession.DisposeAsync();

    var bindSession = await client.TryReserveAsync(
      CreateBinding(),
      CancellationToken.None);
    Assert.NotNull(bindSession);
    var bind = await bindSession.TryBindSuspendedProcessAsync(
      CreateProcessObservation(),
      CancellationToken.None);
    Assert.NotNull(bind);
    var pendingBind = new PrivilegedCommandIsolationPendingBind(
      bindSession.Reservation.Request,
      bindSession.Reservation.SignedLease,
      bind.Binding,
      bind.SignedAcknowledgement);
    await bindSession.DisposeAsync();

    supervisor.TimeProvider.Advance(TimeSpan.FromMinutes(10));

    var release = await client.TryRecoverPendingReservationAsync(
      pendingReservation,
      CancellationToken.None);
    var terminal = await client.TryRecoverPendingBindAsync(
      pendingBind,
      CancellationToken.None);

    Assert.NotNull(release);
    Assert.NotNull(terminal);
    Assert.Equal(
      supervisor.TimeProvider.GetUtcNow().ToUnixTimeMilliseconds(),
      release.SignedRelease.Release.ReleasedAtUnixMilliseconds);
    Assert.Equal(
      supervisor.TimeProvider.GetUtcNow().ToUnixTimeMilliseconds(),
      terminal.SignedReceipt.Receipt.IssuedAtUnixMilliseconds);
  }

  [Fact]
  public async Task RecoveryRejectsHistoricalEvidenceWithAnInvalidSignatureBeforeConnect()
  {
    using var supervisor = new ScriptedSupervisor();
    var client = supervisor.CreateClient();
    var session = await client.TryReserveAsync(CreateBinding(), CancellationToken.None);
    Assert.NotNull(session);
    var pending = new PrivilegedCommandIsolationPendingReservation(
      session.Reservation.Request,
      session.Reservation.SignedLease with
      {
        SignatureBase64 = Convert.ToBase64String(new byte[64]),
      });
    await session.DisposeAsync();
    var connectCount = supervisor.ConnectCount;

    Assert.Null(await client.TryRecoverPendingReservationAsync(
      pending,
      CancellationToken.None));
    Assert.Equal(connectCount, supervisor.ConnectCount);
  }

  [Fact]
  public async Task RecoveryRejectsHistoricalEvidenceWhenItsVersionedPinIsMissing()
  {
    using var supervisor = new ScriptedSupervisor();
    var session = await supervisor.CreateClient().TryReserveAsync(
      CreateBinding(),
      CancellationToken.None);
    Assert.NotNull(session);
    var pending = new PrivilegedCommandIsolationPendingReservation(
      session.Reservation.Request,
      session.Reservation.SignedLease);
    await session.DisposeAsync();
    var connectCount = supervisor.ConnectCount;
    var client = supervisor.CreateClient(
      resolver: new ExactPurposeP256PublicKeyResolver([]));

    Assert.Null(await client.TryRecoverPendingReservationAsync(
      pending,
      CancellationToken.None));
    Assert.Equal(connectCount, supervisor.ConnectCount);
  }

  [Fact]
  public async Task RecoveryRejectsHistoricalBindWhoseProcessBindingChanged()
  {
    using var supervisor = new ScriptedSupervisor();
    var client = supervisor.CreateClient();
    var session = await client.TryReserveAsync(CreateBinding(), CancellationToken.None);
    Assert.NotNull(session);
    var bind = await session.TryBindSuspendedProcessAsync(
      CreateProcessObservation(),
      CancellationToken.None);
    Assert.NotNull(bind);
    var pending = new PrivilegedCommandIsolationPendingBind(
      session.Reservation.Request,
      session.Reservation.SignedLease,
      bind.Binding with
      {
        Process = bind.Binding.Process with
        {
          ChildProcessId = bind.Binding.Process.ChildProcessId + 1,
        },
      },
      bind.SignedAcknowledgement);
    await session.DisposeAsync();
    var connectCount = supervisor.ConnectCount;

    Assert.Null(await client.TryRecoverPendingBindAsync(
      pending,
      CancellationToken.None));
    Assert.Equal(connectCount, supervisor.ConnectCount);
  }

  [Fact]
  public async Task RecoveryStillRejectsStaleNewReleaseAndTerminalReceipts()
  {
    using var supervisor = new ScriptedSupervisor();
    var client = supervisor.CreateClient();
    var reservationSession = await client.TryReserveAsync(
      CreateBinding(),
      CancellationToken.None);
    Assert.NotNull(reservationSession);
    var pendingReservation = new PrivilegedCommandIsolationPendingReservation(
      reservationSession.Reservation.Request,
      reservationSession.Reservation.SignedLease);
    await reservationSession.DisposeAsync();

    var bindSession = await client.TryReserveAsync(
      CreateBinding(),
      CancellationToken.None);
    Assert.NotNull(bindSession);
    var bind = await bindSession.TryBindSuspendedProcessAsync(
      CreateProcessObservation(),
      CancellationToken.None);
    Assert.NotNull(bind);
    var pendingBind = new PrivilegedCommandIsolationPendingBind(
      bindSession.Reservation.Request,
      bindSession.Reservation.SignedLease,
      bind.Binding,
      bind.SignedAcknowledgement);
    await bindSession.DisposeAsync();

    supervisor.TimeProvider.Advance(TimeSpan.FromMinutes(10));
    supervisor.ReturnStaleRecoveryReceipt = true;

    Assert.Null(await client.TryRecoverPendingReservationAsync(
      pendingReservation,
      CancellationToken.None));
    Assert.Null(await client.TryRecoverPendingBindAsync(
      pendingBind,
      CancellationToken.None));
  }

  [Fact]
  public async Task PackagedDefaultOffModeNeverOpensAPipe()
  {
    using var supervisor = new ScriptedSupervisor();
    var client = supervisor.CreateClient(supervisor.Options with { Enabled = false });

    Assert.Null(await client.TryReserveAsync(CreateBinding(), CancellationToken.None));
    Assert.Equal(0, supervisor.ConnectCount);
    Assert.Empty(supervisor.RequestKinds);
  }

  [Fact]
  public void PublicKeyResolverRequiresExactPurposeAndCanonicalP256Spki()
  {
    using var reservation = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var resolver = new ExactPurposeP256PublicKeyResolver(
    [
      Pin(
        "reservation-key-v1",
        PrivilegedCommandIsolationSignaturePurposes.ReservationLease,
        reservation),
    ]);

    Assert.True(resolver.TryResolve(
      "reservation-key-v1",
      PrivilegedCommandIsolationSignaturePurposes.ReservationLease,
      out var resolved));
    using (resolved)
    {
      Assert.NotNull(resolved);
      Assert.Equal(256, resolved.KeySize);
    }
    Assert.False(resolver.TryResolve(
      "reservation-key-v1",
      PrivilegedCommandIsolationSignaturePurposes.TerminalEnforcementReceipt,
      out var crossPurpose));
    Assert.Null(crossPurpose);

    using var p384 = ECDsa.Create(ECCurve.NamedCurves.nistP384);
    Assert.Throws<CryptographicException>(() =>
      new ExactPurposeP256PublicKeyResolver(
      [
        Pin(
          "p384-key-v1",
          PrivilegedCommandIsolationSignaturePurposes.ReservationLease,
          p384),
      ]));
    Assert.Throws<CryptographicException>(() =>
      new ExactPurposeP256PublicKeyResolver(
      [
        new PrivilegedCommandIsolationPublicKeyPin(
          "private-key-v1",
          PrivilegedCommandIsolationSignaturePurposes.ReservationLease,
          Convert.ToBase64String(reservation.ExportPkcs8PrivateKey())),
      ]));
    Assert.Throws<CryptographicException>(() =>
      new ExactPurposeP256PublicKeyResolver(
      [
        Pin(
          "duplicate-key-v1",
          PrivilegedCommandIsolationSignaturePurposes.ReservationLease,
          reservation),
        Pin(
          "duplicate-key-v1",
          PrivilegedCommandIsolationSignaturePurposes.ReservationLease,
          reservation),
      ]));
  }

  [Fact]
  public async Task SignatureSubstitutionFailsClosedBeforeReturningASession()
  {
    using var supervisor = new ScriptedSupervisor
    {
      Behavior = ResponseBehavior.InvalidSignature,
    };
    var client = supervisor.CreateClient();

    Assert.Null(await client.TryReserveAsync(CreateBinding(), CancellationToken.None));
    Assert.Equal(1, supervisor.DisposedConnectionCount);
  }

  [Theory]
  [InlineData(ResponseBehavior.Malformed)]
  [InlineData(ResponseBehavior.Oversized)]
  [InlineData(ResponseBehavior.Disconnect)]
  [InlineData(ResponseBehavior.WrongKind)]
  [InlineData(ResponseBehavior.WrongVersion)]
  [InlineData(ResponseBehavior.WrongSequence)]
  [InlineData(ResponseBehavior.UnknownPayloadMember)]
  public async Task MalformedOversizedDisconnectedAndOutOfPhaseFramesAreRejected(
    ResponseBehavior behavior)
  {
    using var supervisor = new ScriptedSupervisor { Behavior = behavior };
    var client = supervisor.CreateClient();

    var exception = await Record.ExceptionAsync(() =>
      client.TryReserveAsync(CreateBinding(), CancellationToken.None).AsTask());

    Assert.NotNull(exception);
    Assert.True(exception is InvalidDataException or EndOfStreamException, exception.ToString());
    Assert.Equal(1, supervisor.DisposedConnectionCount);
  }

  [Fact]
  public async Task OperationTimeoutCancelsAndPermanentlyDisposesTheSessionTransport()
  {
    using var supervisor = new ScriptedSupervisor
    {
      Behavior = ResponseBehavior.WaitForCancellation,
    };
    var client = supervisor.CreateClient(supervisor.Options with
    {
      OperationTimeout = TimeSpan.FromMilliseconds(100),
    });

    await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
      client.TryReserveAsync(CreateBinding(), CancellationToken.None).AsTask());
    Assert.Equal(1, supervisor.DisposedConnectionCount);
  }

  [Fact]
  public async Task ConnectTimeoutIsHardBoundedBeforeAnyLifecycleFrameExists()
  {
    using var supervisor = new ScriptedSupervisor();
    var client = new NamedPipePrivilegedCommandTrustedRootIsolationClient(
      supervisor.Options with
      {
        ConnectTimeout = TimeSpan.FromMilliseconds(100),
      },
      supervisor.Resolver,
      new NeverConnectingConnector(),
      supervisor.TimeProvider);

    await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
      client.TryReserveAsync(CreateBinding(), CancellationToken.None).AsTask());
  }

  [Trait("Category", "ProcessTiming")]
  [Fact]
  public async Task AUserControlledPipeSquatterCannotPassServerIdentityValidation()
  {
    using var supervisor = new ScriptedSupervisor();
    var pipeName = $"msaidizi-isolation-squatter-{Guid.NewGuid():N}";
    await using var pipe = new NamedPipeServerStream(
      pipeName,
      PipeDirection.InOut,
      1,
      PipeTransmissionMode.Byte,
      PipeOptions.Asynchronous);
    var connected = pipe.WaitForConnectionAsync();
    var wrongImagePath = Path.GetFullPath(
      Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.Windows),
        "System32",
        "notepad.exe"));
    var client = new NamedPipePrivilegedCommandTrustedRootIsolationClient(
      supervisor.Options with
      {
        PipeName = pipeName,
        ExpectedSupervisorImagePath = wrongImagePath,
        ExpectedSupervisorImageSha256 = new string('f', 64),
      },
      supervisor.Resolver,
      supervisor.TimeProvider);

    await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
      client.TryReserveAsync(CreateBinding(), CancellationToken.None).AsTask());
    await connected.WaitAsync(TimeSpan.FromSeconds(2));
  }

  [Fact]
  public async Task TerminalSettlementRejectsABindFromAnotherPipeSession()
  {
    using var supervisor = new ScriptedSupervisor();
    var client = supervisor.CreateClient();
    var first = await client.TryReserveAsync(CreateBinding(), CancellationToken.None);
    var second = await client.TryReserveAsync(CreateBinding(), CancellationToken.None);
    Assert.NotNull(first);
    Assert.NotNull(second);
    await using var firstScope = first;
    await using var secondScope = second;
    var firstBind = await first.TryBindSuspendedProcessAsync(
      CreateProcessObservation(),
      CancellationToken.None);
    var secondBind = await second.TryBindSuspendedProcessAsync(
      CreateProcessObservation(),
      CancellationToken.None);
    Assert.NotNull(firstBind);
    Assert.NotNull(secondBind);

    await Assert.ThrowsAsync<InvalidOperationException>(() => first.TrySettleAsync(
      secondBind,
      new PrivilegedCommandTerminalObservation(
        true,
        true,
        0,
        PrivilegedCommandIsolationTerminalOutcomes.Completed),
      CancellationToken.None).AsTask());
  }

  [Fact]
  public async Task ConcurrentReleaseAndBindCannotCrossTheSessionPhaseBoundary()
  {
    using var supervisor = new ScriptedSupervisor();
    var client = supervisor.CreateClient();
    var session = await client.TryReserveAsync(CreateBinding(), CancellationToken.None);
    Assert.NotNull(session);
    await using var sessionScope = session;

    async Task<bool> TryReleaseAsync()
    {
      try
      {
        return await session.TryReleaseBeforeBindAsync(
          PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeProcess,
          CancellationToken.None) is not null;
      }
      catch (InvalidOperationException)
      {
        return false;
      }
    }

    async Task<bool> TryBindAsync()
    {
      try
      {
        return await session.TryBindSuspendedProcessAsync(
          CreateProcessObservation(),
          CancellationToken.None) is not null;
      }
      catch (InvalidOperationException)
      {
        return false;
      }
    }

    var outcomes = await Task.WhenAll(TryReleaseAsync(), TryBindAsync());

    Assert.Single(outcomes, value => value);
    Assert.Equal(2, supervisor.RequestKinds.Count);
    Assert.True(supervisor.RequestKinds[^1]
      is PrivilegedCommandIsolationPipeProtocol.ReleaseRequest
        or PrivilegedCommandIsolationPipeProtocol.BindRequest);
  }

  [Fact]
  public async Task NonCanonicalOrWrongDeviceBindingIsRejectedBeforePipeConnect()
  {
    using var supervisor = new ScriptedSupervisor();
    var client = supervisor.CreateClient();

    await Assert.ThrowsAsync<ArgumentException>(() => client.TryReserveAsync(
      CreateBinding() with
      {
        DeviceId = "10000000-0000-4000-8000-000000000099",
      },
      CancellationToken.None).AsTask());
    await Assert.ThrowsAsync<ArgumentException>(() => client.TryReserveAsync(
      CreateBinding() with { InvocationSha256 = new string('A', 64) },
      CancellationToken.None).AsTask());
    Assert.Equal(0, supervisor.ConnectCount);
  }

  [Fact]
  public void PersistenceSerializationCannotSeeCompactTokenArgvOrEnvironment()
  {
    var binding = CreateBinding();
    var json = JsonSerializer.Serialize(binding);

    Assert.DoesNotContain("test.isolation.compact-token", json, StringComparison.Ordinal);
    Assert.DoesNotContain("echo test", json, StringComparison.Ordinal);
    Assert.DoesNotContain("COMSPEC", json, StringComparison.Ordinal);
    Assert.DoesNotContain("ephemeralBinding", json, StringComparison.OrdinalIgnoreCase);
    Assert.Contains(binding.ActionTokenSha256, json, StringComparison.Ordinal);
    Assert.Contains(binding.InvocationSha256, json, StringComparison.Ordinal);
  }

  private static PrivilegedCommandIsolationRequestBinding CreateBinding()
  {
    const string actionId = "20000000-0000-4000-8000-000000000002";
    const string taskId = "30000000-0000-4000-8000-000000000003";
    const string planVersionId = "40000000-0000-4000-8000-000000000004";
    const string stepId = "50000000-0000-4000-8000-000000000005";
    const string mandateId = "60000000-0000-4000-8000-000000000006";
    const string compactToken = "test.isolation.compact-token";
    const string argumentsJson =
      "{\"executable\":\"cmd\",\"argv\":[\"/d\",\"/s\",\"/c\",\"echo test\"],\"timeoutSeconds\":30,\"maximumOutputBytes\":1024}";
    var argumentsSha256 = PayloadDigest.Sha256Hex(argumentsJson);
    var budgets = PrivilegedCommandIsolationTestContracts.Authorization(
      argumentsSha256).Budgets;
    var leaseExpiresAt = DateTimeOffset.FromUnixTimeMilliseconds(
      NowUnixMilliseconds).AddMinutes(2);
    var request = new ActionRequest(
      actionId,
      taskId,
      planVersionId,
      stepId,
      DeviceId,
      mandateId,
      PrivilegedCommandIsolationCapability.Id,
      PrivilegedCommandIsolationCapability.Version,
      argumentsJson,
      argumentsSha256,
      ExpectedPreStateSha256: null,
      InputProvenanceSha256: null,
      IdempotencyKey: "pipe-client-test-action",
      DispatchCount: 1,
      LeaseId: "pipe-client-test-lease",
      FencingToken: "1",
      LeaseExpiresAt: leaseExpiresAt,
      ExecutionMode: ActionExecutionModes.Execute);
    var claims = new ActionTokenClaims
    {
      Issuer = "itemba-msaidizi-broker",
      Audience = "itemba-windows-companion",
      Subject = "msaidizi-global",
      TokenId = "pipe-client-test-token",
      ActionId = actionId,
      TaskId = taskId,
      PlanVersionId = planVersionId,
      StepId = stepId,
      DeviceId = DeviceId,
      MandateId = mandateId,
      CapabilityId = request.CapabilityId,
      CapabilityVersion = request.CapabilityVersion,
      ArgumentsSha256 = argumentsSha256,
      ExpectedPreStateSha256 = null,
      InputProvenanceSha256 = null,
      IdempotencyKey = request.IdempotencyKey,
      LeaseId = request.LeaseId,
      FencingToken = request.FencingToken,
      LeaseExpiresAtUnixSeconds = leaseExpiresAt.ToUnixTimeSeconds(),
      DispatchCount = 1,
      ExecutionMode = ActionExecutionModes.Execute,
      Budgets = budgets,
      IssuedAtUnixSeconds = DateTimeOffset.FromUnixTimeMilliseconds(
        NowUnixMilliseconds).ToUnixTimeSeconds(),
      ExpiresAtUnixSeconds = DateTimeOffset.FromUnixTimeMilliseconds(
        NowUnixMilliseconds).AddMinutes(1).ToUnixTimeSeconds(),
    };
    var invocation = CreateInvocation();
    return new PrivilegedCommandIsolationRequestBinding(
      actionId,
      taskId,
      planVersionId,
      stepId,
      DeviceId,
      mandateId,
      PayloadDigest.Sha256Hex(compactToken),
      PrivilegedCommandIsolationCanonical.InvocationSha256(invocation),
      PayloadDigest.Sha256Hex(invocation.ExecutablePath),
      invocation.ExecutableImageSha256,
      new PrivilegedCommandIsolationEphemeralBinding(
        new EphemeralActionAuthorization(
          new SignedActionRequest(request, compactToken),
          claims),
        invocation));
  }

  private static PrivilegedCommandSuspendedProcessObservation
    CreateProcessObservation()
  {
    var invocation = CreateInvocation();
    return new PrivilegedCommandSuspendedProcessObservation(
      ParentProcessId: 400,
      ParentProcessCreationTimeUtcFileTime: 100,
      ChildProcessId: 500,
      ChildProcessCreationTimeUtcFileTime: 200,
      PrimaryThreadId: 600,
      PayloadDigest.Sha256Hex(invocation.ExecutablePath),
      invocation.ExecutableImageSha256,
      invocation.ExecutableVolumeSerialNumber,
      invocation.ExecutableFileId,
      invocation.CommandLineSha256,
      PrivilegedCommandIsolationCanonical.WorkingDirectorySha256(
        invocation.WorkingDirectory),
      invocation.EnvironmentBlockSha256,
      PrivilegedCommandIsolationCanonical.InvocationSha256(invocation),
      CreatedSuspended: true,
      AssignedToJob: true);
  }

  private static PrivilegedCommandIsolationInvocationV2 CreateInvocation()
  {
    var environment = new[]
    {
      new PrivilegedCommandIsolationEnvironmentVariableV2(
        "COMSPEC",
        @"C:\Windows\System32\cmd.exe"),
    };
    var draft = new PrivilegedCommandIsolationInvocationV2(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      "cmd",
      @"C:\Windows\System32\cmd.exe",
      new string('8', 64),
      42,
      43,
      ["/d", "/s", "/c", "echo test"],
      @"C:\Windows\System32",
      environment,
      30,
      1_024,
      30,
      1_024,
      16,
      536_870_912,
      string.Empty,
      string.Empty);
    return draft with
    {
      CommandLineSha256 = PayloadDigest.Sha256Hex(
        PrivilegedCommandIsolationCanonical.BuildCommandLine(draft)),
      EnvironmentBlockSha256 =
        PrivilegedCommandIsolationCanonical.EnvironmentBlockSha256(environment),
    };
  }

  private static PrivilegedCommandIsolationPublicKeyPin Pin(
    string keyId,
    string purpose,
    ECDsa key) => new(
      keyId,
      purpose,
      Convert.ToBase64String(key.ExportSubjectPublicKeyInfo()));

  public enum ResponseBehavior
  {
    Valid = 0,
    InvalidSignature = 1,
    Malformed = 2,
    Oversized = 3,
    Disconnect = 4,
    WrongKind = 5,
    WrongVersion = 6,
    WrongSequence = 7,
    UnknownPayloadMember = 8,
    WaitForCancellation = 9,
  }

  private sealed class ScriptedSupervisor : IDisposable
  {
    private const string LeaseKeyId = "pipe-test-reservation-v1";
    private const string ReleaseKeyId = "pipe-test-release-v1";
    private const string BindKeyId = "pipe-test-bind-v1";
    private const string TerminalKeyId = "pipe-test-terminal-v1";

    private readonly ECDsa _leaseKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private readonly ECDsa _releaseKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private readonly ECDsa _bindKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private readonly ECDsa _terminalKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private readonly ScriptedConnector _connector;
    private long _sequence;
    private int _disposedConnections;

    public ScriptedSupervisor()
    {
      Resolver = new ExactPurposeP256PublicKeyResolver(
      [
        Pin(
          LeaseKeyId,
          PrivilegedCommandIsolationSignaturePurposes.ReservationLease,
          _leaseKey),
        Pin(
          ReleaseKeyId,
          PrivilegedCommandIsolationSignaturePurposes.PreBindReservationRelease,
          _releaseKey),
        Pin(
          BindKeyId,
          PrivilegedCommandIsolationSignaturePurposes
            .SuspendedProcessBindAcknowledgement,
          _bindKey),
        Pin(
          TerminalKeyId,
          PrivilegedCommandIsolationSignaturePurposes.TerminalEnforcementReceipt,
          _terminalKey),
      ]);
      TimeProvider = new FixedTimeProvider(
        DateTimeOffset.FromUnixTimeMilliseconds(NowUnixMilliseconds));
      Options = new PrivilegedCommandTrustedRootPipeClientOptions
      {
        Enabled = true,
        PipeName = "itemba-msaidizi-isolation-test-v1",
        ExpectedSupervisorImagePath = Path.GetFullPath(Environment.ProcessPath!),
        ExpectedSupervisorImageSha256 = new string('a', 64),
        ExpectedSupervisorServiceSid =
          PrivilegedCommandIsolationSupervisorIdentity.ServiceSid,
        MaximumFrameBytes = 131_072,
        ConnectTimeout = TimeSpan.FromSeconds(1),
        OperationTimeout = TimeSpan.FromSeconds(1),
        ReservationRequestLifetime = TimeSpan.FromMinutes(1),
        Verification = PrivilegedCommandIsolationVerificationSettings.Strict(
          DeviceId,
          PolicySha256,
          DriverSha256,
          ServiceSha256),
      };
      SupervisorInstanceId = Guid.NewGuid().ToString("D");
      BootId = Guid.NewGuid().ToString("D");
      _connector = new ScriptedConnector(this);
    }

    public ResponseBehavior Behavior { get; init; }

    public bool ReturnStaleRecoveryReceipt { get; set; }

    public ExactPurposeP256PublicKeyResolver Resolver { get; }

    public FixedTimeProvider TimeProvider { get; }

    public PrivilegedCommandTrustedRootPipeClientOptions Options { get; }

    public string SupervisorInstanceId { get; }

    public string BootId { get; }

    public List<string> RequestKinds { get; } = [];

    public List<long> RequestSequences { get; } = [];

    public int ConnectCount => _connector.ConnectCount;

    public int DisposedConnectionCount => Volatile.Read(ref _disposedConnections);

    public NamedPipePrivilegedCommandTrustedRootIsolationClient CreateClient(
      PrivilegedCommandTrustedRootPipeClientOptions? options = null,
      IPrivilegedCommandIsolationVerificationKeyResolver? resolver = null) => new(
        options ?? Options,
        resolver ?? Resolver,
        _connector,
        TimeProvider);

    public async ValueTask<ReadOnlyMemory<byte>> RespondAsync(
      ReadOnlyMemory<byte> requestBytes,
      int maximumFrameBytes,
      CancellationToken cancellationToken)
    {
      if (Behavior == ResponseBehavior.WaitForCancellation)
      {
        await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
      }
      if (Behavior == ResponseBehavior.Disconnect)
      {
        throw new EndOfStreamException("scripted disconnect");
      }
      if (Behavior == ResponseBehavior.Malformed)
      {
        return Encoding.UTF8.GetBytes("{");
      }
      if (Behavior == ResponseBehavior.Oversized)
      {
        return new byte[maximumFrameBytes + 1];
      }

      var frame = PrivilegedCommandIsolationPipeExchange.DeserializeRequest(
        requestBytes.Span);
      RequestKinds.Add(frame.Kind);
      RequestSequences.Add(frame.Sequence);
      var responseKind = ResponseKind(frame.Kind);
      object response = frame.Kind switch
      {
        PrivilegedCommandIsolationPipeProtocol.ReserveRequest =>
          Reserve(frame),
        PrivilegedCommandIsolationPipeProtocol.ReleaseRequest =>
          Release(frame),
        PrivilegedCommandIsolationPipeProtocol.BindRequest => Bind(frame),
        PrivilegedCommandIsolationPipeProtocol.SettleRequest => Settle(frame),
        PrivilegedCommandIsolationPipeProtocol.RecoverReservationRequest =>
          RecoverReservation(frame),
        PrivilegedCommandIsolationPipeProtocol.RecoverBindRequest =>
          RecoverBind(frame),
        _ => throw new InvalidDataException("unexpected request kind"),
      };
      if (Behavior == ResponseBehavior.UnknownPayloadMember)
      {
        var valid = Assert.IsType<ReserveResponsePayload>(response);
        var payload = JsonSerializer.Serialize(valid);
        var withUnknown = payload[..^1] + ",\"unknown\":true}";
        return SerializeRawResponse(
          frame,
          responseKind,
          withUnknown,
          frame.ProtocolVersion,
          frame.Sequence);
      }

      var validBytes = PrivilegedCommandIsolationPipeExchange.SerializeResponse(
        Behavior == ResponseBehavior.WrongSequence
          ? checked(frame.Sequence + 1)
          : frame.Sequence,
        Behavior == ResponseBehavior.WrongKind
          ? PrivilegedCommandIsolationPipeProtocol.SettleResponse
          : responseKind,
        frame.CorrelationId,
        response);
      if (Behavior != ResponseBehavior.WrongVersion)
      {
        return validBytes;
      }

      var validFrame = PrivilegedCommandIsolationPipeExchange.DeserializeRequest(
        validBytes);
      return SerializeRawResponse(
        validFrame,
        validFrame.Kind,
        validFrame.PayloadJson,
        PrivilegedCommandIsolationPipeProtocol.Version + 1,
        validFrame.Sequence);
    }

    public void Dispose()
    {
      _leaseKey.Dispose();
      _releaseKey.Dispose();
      _bindKey.Dispose();
      _terminalKey.Dispose();
    }

    private ReserveResponsePayload Reserve(
      PrivilegedCommandIsolationPipeFrameV1 frame)
    {
      var payload = PrivilegedCommandIsolationPipeExchange
        .DeserializePayload<ReserveRequestPayload>(frame.PayloadJson);
      var request = payload.Request;
      var now = CurrentUnixMilliseconds;
      var lease = new PrivilegedCommandIsolationReservationLeaseV1(
        PrivilegedCommandIsolationCanonical.ContractVersion,
        Guid.NewGuid().ToString("D"),
        NextSequence(),
        PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
        PrivilegedCommandIsolationCanonical.RequestNonceSha256(request),
        request.Action,
        SupervisorInstanceId,
        BootId,
        PrivilegedCommandIsolationFeatures.Required,
        now,
        Math.Min(
          now + 30_000,
          request.RequestedExpiresAtUnixMilliseconds));
      var signed = PrivilegedCommandIsolationCanonical.SignReservationLease(
        lease,
        LeaseKeyId,
        _leaseKey);
      if (Behavior == ResponseBehavior.InvalidSignature)
      {
        signed = signed with
        {
          SignatureBase64 = Convert.ToBase64String(new byte[64]),
        };
      }
      return new ReserveResponsePayload(signed);
    }

    private ReleaseResponsePayload Release(
      PrivilegedCommandIsolationPipeFrameV1 frame)
    {
      var payload = PrivilegedCommandIsolationPipeExchange
        .DeserializePayload<ReleaseRequestPayload>(frame.PayloadJson);
      return CreateRelease(
        payload.Request,
        payload.SignedLease,
        payload.Outcome);
    }

    private BindResponsePayload Bind(PrivilegedCommandIsolationPipeFrameV1 frame)
    {
      var payload = PrivilegedCommandIsolationPipeExchange
        .DeserializePayload<BindRequestPayload>(frame.PayloadJson);
      return CreateBind(
        payload.Request,
        payload.SignedLease,
        payload.Observation);
    }

    private SettleResponsePayload Settle(PrivilegedCommandIsolationPipeFrameV1 frame)
    {
      var payload = PrivilegedCommandIsolationPipeExchange
        .DeserializePayload<SettleRequestPayload>(frame.PayloadJson);
      return CreateTerminal(
        payload.Request,
        payload.SignedLease,
        payload.Binding,
        payload.SignedAcknowledgement,
        payload.Observation);
    }

    private ReleaseResponsePayload RecoverReservation(
      PrivilegedCommandIsolationPipeFrameV1 frame)
    {
      var payload = PrivilegedCommandIsolationPipeExchange
        .DeserializePayload<RecoverReservationRequestPayload>(frame.PayloadJson);
      return CreateRelease(
        payload.Pending.Request,
        payload.Pending.SignedLease,
        PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeProcess,
        RecoveryReceiptUnixMilliseconds);
    }

    private SettleResponsePayload RecoverBind(
      PrivilegedCommandIsolationPipeFrameV1 frame)
    {
      var payload = PrivilegedCommandIsolationPipeExchange
        .DeserializePayload<RecoverBindRequestPayload>(frame.PayloadJson);
      return CreateTerminal(
        payload.Pending.Request,
        payload.Pending.SignedLease,
        payload.Pending.Binding,
        payload.Pending.SignedAcknowledgement,
        new PrivilegedCommandTerminalObservation(
          ProcessResumed: false,
          ExitCodeKnown: false,
          ExitCode: 0,
          PrivilegedCommandIsolationTerminalOutcomes.Unknown),
        RecoveryReceiptUnixMilliseconds);
    }

    private ReleaseResponsePayload CreateRelease(
      PrivilegedCommandIsolationReservationRequestV1 request,
      SignedPrivilegedCommandIsolationReservationLease signedLease,
      string outcome,
      long? releasedAtUnixMilliseconds = null)
    {
      var lease = signedLease.Lease;
      var releasedAt = releasedAtUnixMilliseconds ?? CurrentUnixMilliseconds;
      var release = new PrivilegedCommandIsolationPreBindReleaseV1(
        PrivilegedCommandIsolationCanonical.ContractVersion,
        Guid.NewGuid().ToString("D"),
        NextSequence(),
        PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
        PrivilegedCommandIsolationCanonical.RequestNonceSha256(request),
        PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(lease),
        request.Action,
        lease.SupervisorInstanceId,
        lease.BootId,
        releasedAt,
        outcome);
      return new ReleaseResponsePayload(
        PrivilegedCommandIsolationCanonical.SignPreBindRelease(
          release,
          ReleaseKeyId,
          _releaseKey));
    }

    private BindResponsePayload CreateBind(
      PrivilegedCommandIsolationReservationRequestV1 request,
      SignedPrivilegedCommandIsolationReservationLease signedLease,
      PrivilegedCommandSuspendedProcessObservation observation)
    {
      var lease = signedLease.Lease;
      var now = CurrentUnixMilliseconds;
      var process = new PrivilegedCommandIsolationProcessBinding(
        observation.ParentProcessId,
        observation.ParentProcessCreationTimeUtcFileTime,
        observation.ChildProcessId,
        observation.ChildProcessCreationTimeUtcFileTime,
        observation.PrimaryThreadId,
        Guid.NewGuid().ToString("D"),
        new string('6', 64),
        observation.ImagePathSha256,
        observation.ImageSha256,
        observation.ImageVolumeSerialNumber,
        observation.ImageFileId,
        observation.CommandLineSha256,
        observation.WorkingDirectorySha256,
        observation.EnvironmentBlockSha256,
        observation.InvocationSha256);
      var binding = new PrivilegedCommandSuspendedProcessBindingV1(
        PrivilegedCommandIsolationCanonical.ContractVersion,
        Guid.NewGuid().ToString("D"),
        PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
        PrivilegedCommandIsolationCanonical.RequestNonceSha256(request),
        PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(lease),
        request.Action,
        lease.SupervisorInstanceId,
        lease.BootId,
        process,
        observation.CreatedSuspended,
        observation.AssignedToJob,
        now);
      var acknowledgement = new PrivilegedCommandIsolationBindAcknowledgementV1(
        PrivilegedCommandIsolationCanonical.ContractVersion,
        Guid.NewGuid().ToString("D"),
        NextSequence(),
        PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
        PrivilegedCommandIsolationCanonical.RequestNonceSha256(request),
        PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(lease),
        PrivilegedCommandIsolationCanonical.SuspendedProcessBindingSha256(binding),
        request.Action,
        lease.SupervisorInstanceId,
        lease.BootId,
        process,
        PrivilegedCommandIsolationFeatures.Required,
        ChildStillSuspended: true,
        KernelEnforcementActive: true,
        MayResume: true,
        now,
        Math.Min(now + 10_000, lease.ExpiresAtUnixMilliseconds));
      return new BindResponsePayload(
        binding,
        PrivilegedCommandIsolationCanonical.SignBindAcknowledgement(
          acknowledgement,
          BindKeyId,
          _bindKey));
    }

    private SettleResponsePayload CreateTerminal(
      PrivilegedCommandIsolationReservationRequestV1 request,
      SignedPrivilegedCommandIsolationReservationLease signedLease,
      PrivilegedCommandSuspendedProcessBindingV1 binding,
      SignedPrivilegedCommandIsolationBindAcknowledgement signedAcknowledgement,
      PrivilegedCommandTerminalObservation observation,
      long? issuedAtUnixMilliseconds = null)
    {
      var lease = signedLease.Lease;
      var acknowledgement = signedAcknowledgement.Acknowledgement;
      var issuedAt = issuedAtUnixMilliseconds ?? CurrentUnixMilliseconds;
      var resumedAt = observation.ProcessResumed
        ? acknowledgement.IssuedAtUnixMilliseconds + 1
        : 0;
      var endedAt = Math.Max(
        issuedAt,
        observation.ProcessResumed
          ? resumedAt
          : acknowledgement.IssuedAtUnixMilliseconds);
      var receiptIssuedAt = Math.Max(issuedAt, endedAt);
      var receipt = new PrivilegedCommandIsolationTerminalReceiptV1(
        PrivilegedCommandIsolationCanonical.ContractVersion,
        Guid.NewGuid().ToString("D"),
        NextSequence(),
        PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
        PrivilegedCommandIsolationCanonical.RequestNonceSha256(request),
        PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(lease),
        PrivilegedCommandIsolationCanonical.SuspendedProcessBindingSha256(binding),
        PrivilegedCommandIsolationCanonical.BindAcknowledgementSha256(acknowledgement),
        request.Action,
        lease.SupervisorInstanceId,
        lease.BootId,
        binding.Process,
        PrivilegedCommandIsolationFeatures.Required,
        observation.ProcessResumed,
        resumedAt,
        endedAt,
        receiptIssuedAt,
        ProcessTreeTerminal: true,
        EnforcementContinuous: true,
        observation.ExitCodeKnown,
        observation.ExitCode,
        new string('9', 64),
        observation.Outcome);
      return new SettleResponsePayload(
        PrivilegedCommandIsolationCanonical.SignTerminalReceipt(
          receipt,
          TerminalKeyId,
          _terminalKey));
    }

    private long NextSequence() => Interlocked.Increment(ref _sequence);

    private long CurrentUnixMilliseconds =>
      TimeProvider.GetUtcNow().ToUnixTimeMilliseconds();

    private long RecoveryReceiptUnixMilliseconds =>
      ReturnStaleRecoveryReceipt ? NowUnixMilliseconds : CurrentUnixMilliseconds;

    private void ConnectionDisposed() =>
      Interlocked.Increment(ref _disposedConnections);

    private static string ResponseKind(string requestKind) => requestKind switch
    {
      PrivilegedCommandIsolationPipeProtocol.ReserveRequest =>
        PrivilegedCommandIsolationPipeProtocol.ReserveResponse,
      PrivilegedCommandIsolationPipeProtocol.ReleaseRequest =>
        PrivilegedCommandIsolationPipeProtocol.ReleaseResponse,
      PrivilegedCommandIsolationPipeProtocol.BindRequest =>
        PrivilegedCommandIsolationPipeProtocol.BindResponse,
      PrivilegedCommandIsolationPipeProtocol.SettleRequest =>
        PrivilegedCommandIsolationPipeProtocol.SettleResponse,
      PrivilegedCommandIsolationPipeProtocol.RecoverReservationRequest =>
        PrivilegedCommandIsolationPipeProtocol.RecoverReservationResponse,
      PrivilegedCommandIsolationPipeProtocol.RecoverBindRequest =>
        PrivilegedCommandIsolationPipeProtocol.RecoverBindResponse,
      _ => throw new InvalidDataException("unexpected request kind"),
    };

    private static byte[] SerializeRawResponse(
      PrivilegedCommandIsolationPipeFrameV1 request,
      string kind,
      string payloadJson,
      int version,
      long sequence) => JsonSerializer.SerializeToUtf8Bytes(
        new PrivilegedCommandIsolationPipeFrameV1(
          version,
          sequence,
          kind,
          Guid.NewGuid().ToString("D"),
          request.CorrelationId,
          payloadJson));

    private sealed class ScriptedConnector(ScriptedSupervisor owner) :
      IPrivilegedCommandIsolationPipeConnector
    {
      private int _connectCount;

      public int ConnectCount => Volatile.Read(ref _connectCount);

      public ValueTask<IPrivilegedCommandIsolationPipeConnection> ConnectAsync(
        PrivilegedCommandTrustedRootPipeClientOptions options,
        CancellationToken cancellationToken)
      {
        cancellationToken.ThrowIfCancellationRequested();
        Interlocked.Increment(ref _connectCount);
        return ValueTask.FromResult<IPrivilegedCommandIsolationPipeConnection>(
          new ScriptedConnection(owner));
      }
    }

    private sealed class ScriptedConnection(ScriptedSupervisor owner) :
      IPrivilegedCommandIsolationPipeConnection
    {
      private byte[]? _request;
      private int _disposed;

      public ValueTask WriteFrameAsync(
        ReadOnlyMemory<byte> frame,
        CancellationToken cancellationToken)
      {
        cancellationToken.ThrowIfCancellationRequested();
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        _request = frame.ToArray();
        return ValueTask.CompletedTask;
      }

      public ValueTask<ReadOnlyMemory<byte>> ReadFrameAsync(
        int maximumFrameBytes,
        CancellationToken cancellationToken)
      {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        return owner.RespondAsync(
          _request ?? throw new InvalidOperationException("request missing"),
          maximumFrameBytes,
          cancellationToken);
      }

      public ValueTask DisposeAsync()
      {
        if (Interlocked.Exchange(ref _disposed, 1) == 0)
        {
          owner.ConnectionDisposed();
        }
        return ValueTask.CompletedTask;
      }
    }
  }

  private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
  {
    private long _unixMilliseconds = now.ToUnixTimeMilliseconds();

    public override DateTimeOffset GetUtcNow() =>
      DateTimeOffset.FromUnixTimeMilliseconds(
        Volatile.Read(ref _unixMilliseconds));

    public void Advance(TimeSpan duration) => Interlocked.Add(
      ref _unixMilliseconds,
      checked((long)duration.TotalMilliseconds));
  }

  private sealed class NeverConnectingConnector :
    IPrivilegedCommandIsolationPipeConnector
  {
    public async ValueTask<IPrivilegedCommandIsolationPipeConnection> ConnectAsync(
      PrivilegedCommandTrustedRootPipeClientOptions options,
      CancellationToken cancellationToken)
    {
      await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
      throw new InvalidOperationException("The infinite connect unexpectedly completed.");
    }
  }
}
