using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed partial class PrivilegedCommandIsolationReplayStoreTests
{
  private const long NowUnixMilliseconds = 1_800_000_000_000;
  private const string DeviceId = "10000000-0000-4000-8000-000000000001";
  private const string PolicySha256 =
    "1111111111111111111111111111111111111111111111111111111111111111";
  private const string DriverSha256 =
    "2222222222222222222222222222222222222222222222222222222222222222";
  private const string ServiceSha256 =
    "3333333333333333333333333333333333333333333333333333333333333333";
  private const string ImagePathSha256 =
    "4444444444444444444444444444444444444444444444444444444444444444";
  private const string ImageSha256 =
    "5555555555555555555555555555555555555555555555555555555555555555";

  [Fact]
  public async Task FullLifecycleIsDurableIdempotentAndVerifiedAfterRestart()
  {
    var lifecycle = CreateLifecycle();
    var root = CreateTemporaryDirectory();
    var path = Path.Combine(root, "isolation-replay.jsonl");
    try
    {
      using (var concreteStore = new FilePrivilegedCommandIsolationReplayStore(path))
      {
        AssertCommitted(
          await concreteStore.CommitReservationAsync(lifecycle.Reservation, default),
          lifecycle.Reservation.LeaseSha256);
        AssertAlreadyCommitted(
          await concreteStore.CommitReservationAsync(lifecycle.Reservation, default),
          lifecycle.Reservation.LeaseSha256);
        AssertCommitted(
          await concreteStore.CommitBindAcknowledgementAsync(lifecycle.Bind, default),
          lifecycle.Bind.AcknowledgementSha256);
        AssertAlreadyCommitted(
          await concreteStore.CommitBindAcknowledgementAsync(lifecycle.Bind, default),
          lifecycle.Bind.AcknowledgementSha256);
        AssertCommitted(
          await concreteStore.CommitTerminalReceiptAsync(lifecycle.Terminal, default),
          lifecycle.Terminal.ReceiptSha256);
        AssertAlreadyCommitted(
          await concreteStore.CommitTerminalReceiptAsync(lifecycle.Terminal, default),
          lifecycle.Terminal.ReceiptSha256);
      }

      Assert.Equal(3, File.ReadLines(path).Count());

      using (var concreteRestarted = new FilePrivilegedCommandIsolationReplayStore(path))
      {
        AssertAlreadyCommitted(
          await concreteRestarted.CommitReservationAsync(lifecycle.Reservation, default),
          lifecycle.Reservation.LeaseSha256);
        AssertAlreadyCommitted(
          await concreteRestarted.CommitBindAcknowledgementAsync(lifecycle.Bind, default),
          lifecycle.Bind.AcknowledgementSha256);
        AssertAlreadyCommitted(
          await concreteRestarted.CommitTerminalReceiptAsync(lifecycle.Terminal, default),
          lifecycle.Terminal.ReceiptSha256);
      }

      Assert.Equal(3, File.ReadLines(path).Count());
    }
    finally
    {
      Directory.Delete(root, recursive: true);
    }
  }

  [Fact]
  public async Task IsolationViolationReceiptPermanentlyFencesRestart()
  {
    var lifecycle = CreateLifecycle(isolationIntact: false);
    var root = CreateTemporaryDirectory();
    var path = Path.Combine(root, "isolation-violation.jsonl");
    try
    {
      using (var store = new FilePrivilegedCommandIsolationReplayStore(path))
      {
        AssertCommitted(
          await store.CommitReservationAsync(lifecycle.Reservation, default),
          lifecycle.Reservation.LeaseSha256);
        AssertCommitted(
          await store.CommitBindAcknowledgementAsync(lifecycle.Bind, default),
          lifecycle.Bind.AcknowledgementSha256);
        AssertCommitted(
          await store.CommitTerminalReceiptAsync(lifecycle.Terminal, default),
          lifecycle.Terminal.ReceiptSha256);
      }

      using (var restarted = new FilePrivilegedCommandIsolationReplayStore(path))
      {
        var snapshot = await restarted.ReadPendingAsync(default);
        Assert.Empty(snapshot.Reservations);
        Assert.Empty(snapshot.Binds);
        var violation = Assert.Single(snapshot.IntegrityViolations);
        Assert.Equal(
          lifecycle.Reservation.Request.Action.ActionId,
          violation.ActionId);
        Assert.Equal(lifecycle.Terminal.ReceiptSha256, violation.ReceiptSha256);
        Assert.Equal(
          PrivilegedCommandIsolationTerminalOutcomes.IsolationViolation,
          violation.Outcome);
        Assert.False(violation.EnforcementContinuous);
      }

      var dispatch = new DispatchStartProbe();
      using var host = BuildRecoveryHost(
        path,
        new RejectingPrivilegedCommandTrustedRootIsolationGate(),
        dispatch);
      await Assert.ThrowsAsync<InvalidOperationException>(
        () => host.StartAsync(CancellationToken.None));
      Assert.False(dispatch.Started);
    }
    finally
    {
      Directory.Delete(root, recursive: true);
    }
  }

  [Fact]
  public async Task NewlyRecoveredIsolationViolationCommitsThenFencesEveryRestart()
  {
    var lifecycle = CreateLifecycle(isolationIntact: false);
    var root = CreateTemporaryDirectory();
    var path = Path.Combine(root, "recovered-isolation-violation.jsonl");
    try
    {
      using (var store = new FilePrivilegedCommandIsolationReplayStore(path))
      {
        AssertCommitted(
          await store.CommitReservationAsync(lifecycle.Reservation, default),
          lifecycle.Reservation.LeaseSha256);
        AssertCommitted(
          await store.CommitBindAcknowledgementAsync(lifecycle.Bind, default),
          lifecycle.Bind.AcknowledgementSha256);
      }

      var firstDispatch = new DispatchStartProbe();
      using (var recoveringHost = BuildRecoveryHost(
        path,
        new FixedRecoveryGate(lifecycle.Release, lifecycle.Terminal),
        firstDispatch))
      {
        await Assert.ThrowsAsync<InvalidOperationException>(
          () => recoveringHost.StartAsync(CancellationToken.None));
        Assert.False(firstDispatch.Started);
      }
      Assert.Equal(3, File.ReadLines(path).Count());

      var secondDispatch = new DispatchStartProbe();
      using var restartedHost = BuildRecoveryHost(
        path,
        new RejectingPrivilegedCommandTrustedRootIsolationGate(),
        secondDispatch);
      await Assert.ThrowsAsync<InvalidOperationException>(
        () => restartedHost.StartAsync(CancellationToken.None));
      Assert.False(secondDispatch.Started);
    }
    finally
    {
      Directory.Delete(root, recursive: true);
    }
  }

  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public async Task RestartFencesDispatchUntilPendingLifecycleIsSignedAndReconciled(
    bool bindWasCommitted)
  {
    var lifecycle = CreateLifecycle();
    var root = CreateTemporaryDirectory();
    var path = Path.Combine(root, bindWasCommitted
      ? "pending-bind.jsonl"
      : "pending-reservation.jsonl");
    try
    {
      using (var store = new FilePrivilegedCommandIsolationReplayStore(path))
      {
        AssertCommitted(
          await store.CommitReservationAsync(lifecycle.Reservation, default),
          lifecycle.Reservation.LeaseSha256);
        if (bindWasCommitted)
        {
          AssertCommitted(
            await store.CommitBindAcknowledgementAsync(lifecycle.Bind, default),
            lifecycle.Bind.AcknowledgementSha256);
        }
      }

      using (var restarted = new FilePrivilegedCommandIsolationReplayStore(path))
      {
        var pending = await restarted.ReadPendingAsync(default);
        if (bindWasCommitted)
        {
          Assert.Empty(pending.Reservations);
          var bind = Assert.Single(pending.Binds);
          Assert.Equal(
            lifecycle.Bind.SuspendedProcessBindingSha256,
            PrivilegedCommandIsolationCanonical.SuspendedProcessBindingSha256(
              bind.Binding));
          Assert.Equal(
            lifecycle.Bind.AcknowledgementSha256,
            PrivilegedCommandIsolationCanonical.BindAcknowledgementSha256(
              bind.SignedAcknowledgement.Acknowledgement));
        }
        else
        {
          Assert.Empty(pending.Binds);
          var reservation = Assert.Single(pending.Reservations);
          Assert.Equal(
            lifecycle.Reservation.ReservationRequestSha256,
            PrivilegedCommandIsolationCanonical.ReservationRequestSha256(
              reservation.Request));
          Assert.Equal(
            lifecycle.Reservation.LeaseSha256,
            PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(
              reservation.SignedLease.Lease));
        }
      }

      var blockedDispatch = new DispatchStartProbe();
      using (var blockedHost = BuildRecoveryHost(
        path,
        new RejectingPrivilegedCommandTrustedRootIsolationGate(),
        blockedDispatch))
      {
        await Assert.ThrowsAsync<InvalidOperationException>(
          () => blockedHost.StartAsync(CancellationToken.None));
        Assert.False(blockedDispatch.Started);
      }

      var recoveryGate = new FixedRecoveryGate(lifecycle.Release, lifecycle.Terminal);
      var admittedDispatch = new DispatchStartProbe();
      using (var recoveredHost = BuildRecoveryHost(path, recoveryGate, admittedDispatch))
      {
        await recoveredHost.StartAsync(CancellationToken.None);
        Assert.True(admittedDispatch.Started);
        Assert.Equal(0, recoveryGate.ReserveCallCount);
        Assert.Equal(bindWasCommitted ? 0 : 1, recoveryGate.ReservationRecoveryCallCount);
        Assert.Equal(bindWasCommitted ? 1 : 0, recoveryGate.BindRecoveryCallCount);
        await recoveredHost.StopAsync(CancellationToken.None);
      }

      using (var finalRestart = new FilePrivilegedCommandIsolationReplayStore(path))
      {
        var finalPending = await finalRestart.ReadPendingAsync(default);
        Assert.Empty(finalPending.Reservations);
        Assert.Empty(finalPending.Binds);
      }
      Assert.Equal(bindWasCommitted ? 3 : 2, File.ReadLines(path).Count());
    }
    finally
    {
      Directory.Delete(root, recursive: true);
    }
  }

  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public async Task UnrelatedAlreadyCommittedRecoveryEvidenceCannotClearStartupFence(
    bool bindWasCommitted)
  {
    var pendingLifecycle = CreateLifecycle();
    var unrelatedLifecycle = CreateLifecycle();
    var root = CreateTemporaryDirectory();
    var path = Path.Combine(root, bindWasCommitted
      ? "unrelated-bind-recovery.jsonl"
      : "unrelated-reservation-recovery.jsonl");
    try
    {
      using (var store = new FilePrivilegedCommandIsolationReplayStore(path))
      {
        AssertCommitted(
          await store.CommitReservationAsync(unrelatedLifecycle.Reservation, default),
          unrelatedLifecycle.Reservation.LeaseSha256);
        if (bindWasCommitted)
        {
          AssertCommitted(
            await store.CommitBindAcknowledgementAsync(unrelatedLifecycle.Bind, default),
            unrelatedLifecycle.Bind.AcknowledgementSha256);
          AssertCommitted(
            await store.CommitTerminalReceiptAsync(unrelatedLifecycle.Terminal, default),
            unrelatedLifecycle.Terminal.ReceiptSha256);
        }
        else
        {
          AssertCommitted(
            await store.CommitPreBindReleaseAsync(unrelatedLifecycle.Release, default),
            unrelatedLifecycle.Release.ReleaseSha256);
        }

        AssertCommitted(
          await store.CommitReservationAsync(pendingLifecycle.Reservation, default),
          pendingLifecycle.Reservation.LeaseSha256);
        if (bindWasCommitted)
        {
          AssertCommitted(
            await store.CommitBindAcknowledgementAsync(pendingLifecycle.Bind, default),
            pendingLifecycle.Bind.AcknowledgementSha256);
        }
      }

      var maliciousGate = new UnconditionalRecoveryGate(
        unrelatedLifecycle.Release,
        unrelatedLifecycle.Terminal);
      var dispatch = new DispatchStartProbe();
      using (var host = BuildRecoveryHost(path, maliciousGate, dispatch))
      {
        await Assert.ThrowsAsync<InvalidOperationException>(
          () => host.StartAsync(CancellationToken.None));
        Assert.False(dispatch.Started);
        Assert.Equal(0, maliciousGate.ReserveCallCount);
      }

      using var restarted = new FilePrivilegedCommandIsolationReplayStore(path);
      var stillPending = await restarted.ReadPendingAsync(default);
      if (bindWasCommitted)
      {
        Assert.Empty(stillPending.Reservations);
        Assert.Equal(
          pendingLifecycle.Reservation.Request.Action.ActionId,
          Assert.Single(stillPending.Binds).Request.Action.ActionId);
      }
      else
      {
        Assert.Empty(stillPending.Binds);
        Assert.Equal(
          pendingLifecycle.Reservation.Request.Action.ActionId,
          Assert.Single(stillPending.Reservations).Request.Action.ActionId);
      }
    }
    finally
    {
      Directory.Delete(root, recursive: true);
    }
  }

  [Fact]
  public async Task PreBindReleaseAndBindCommitAtomicallyAsMutuallyExclusive()
  {
    var lifecycle = CreateLifecycle();
    var root = CreateTemporaryDirectory();
    var path = Path.Combine(root, "isolation-replay.jsonl");
    try
    {
      using (var store = new FilePrivilegedCommandIsolationReplayStore(path))
      {
        AssertCommitted(
          await store.CommitReservationAsync(lifecycle.Reservation, default),
          lifecycle.Reservation.LeaseSha256);

        var releaseTask = store.CommitPreBindReleaseAsync(
          lifecycle.Release,
          default).AsTask();
        var bindTask = store.CommitBindAcknowledgementAsync(
          lifecycle.Bind,
          default).AsTask();
        var results = await Task.WhenAll(releaseTask, bindTask);

        Assert.Single(
          results,
          result => result.Status is
            PrivilegedCommandIsolationReplayCommitStatus.Committed);
        Assert.Single(
          results,
          result => result.Status is
            PrivilegedCommandIsolationReplayCommitStatus.Conflict);
        Assert.All(
          results,
          result => Assert.Equal(
            result.Status is PrivilegedCommandIsolationReplayCommitStatus.Committed,
            result.AllowsProgressFor(result.EvidenceSha256)));
      }

      Assert.Equal(2, File.ReadLines(path).Count());
      using var restarted = new FilePrivilegedCommandIsolationReplayStore(path);
      var releaseAfterRestart = await restarted.CommitPreBindReleaseAsync(
        lifecycle.Release,
        default);
      var bindAfterRestart = await restarted.CommitBindAcknowledgementAsync(
        lifecycle.Bind,
        default);
      Assert.Equal(
        1,
        new[] { releaseAfterRestart, bindAfterRestart }.Count(
          result => result.Status is
            PrivilegedCommandIsolationReplayCommitStatus.AlreadyCommitted));
      Assert.Equal(
        1,
        new[] { releaseAfterRestart, bindAfterRestart }.Count(
          result => result.Status is
            PrivilegedCommandIsolationReplayCommitStatus.Conflict));
    }
    finally
    {
      Directory.Delete(root, recursive: true);
    }
  }

  [Fact]
  public async Task StaleSequenceAndCrossActionNonceReplayFailClosed()
  {
    var supervisorInstanceId = NewId();
    var bootId = NewId();
    var first = CreateLifecycle(
      initialSequence: 20,
      supervisorInstanceId,
      bootId);
    var stale = CreateLifecycle(
      initialSequence: 19,
      supervisorInstanceId,
      bootId);
    var nonceReplay = CreateLifecycle(
      initialSequence: 21,
      supervisorInstanceId,
      bootId,
      first.RequestNonceBase64Url);
    var root = CreateTemporaryDirectory();
    try
    {
      using var store = new FilePrivilegedCommandIsolationReplayStore(
        Path.Combine(root, "isolation-replay.jsonl"));
      AssertCommitted(
        await store.CommitReservationAsync(first.Reservation, default),
        first.Reservation.LeaseSha256);

      var staleResult = await store.CommitReservationAsync(stale.Reservation, default);
      AssertRejected(
        staleResult,
        PrivilegedCommandIsolationReplayCommitStatus.StaleSequence,
        stale.Reservation.LeaseSha256,
        first.Reservation.LeaseSha256);

      var replayResult = await store.CommitReservationAsync(
        nonceReplay.Reservation,
        default);
      AssertRejected(
        replayResult,
        PrivilegedCommandIsolationReplayCommitStatus.Conflict,
        nonceReplay.Reservation.LeaseSha256,
        first.Reservation.LeaseSha256);
    }
    finally
    {
      Directory.Delete(root, recursive: true);
    }
  }

  [Fact]
  public async Task MissingPrerequisitesNeverWriteTerminalOrBindEvidence()
  {
    var lifecycle = CreateLifecycle();
    var root = CreateTemporaryDirectory();
    var path = Path.Combine(root, "isolation-replay.jsonl");
    try
    {
      using var store = new FilePrivilegedCommandIsolationReplayStore(path);
      AssertRejected(
        await store.CommitBindAcknowledgementAsync(lifecycle.Bind, default),
        PrivilegedCommandIsolationReplayCommitStatus.Conflict,
        lifecycle.Bind.AcknowledgementSha256,
        existingEvidenceSha256: null);
      AssertRejected(
        await store.CommitTerminalReceiptAsync(lifecycle.Terminal, default),
        PrivilegedCommandIsolationReplayCommitStatus.Conflict,
        lifecycle.Terminal.ReceiptSha256,
        existingEvidenceSha256: null);
      Assert.False(File.Exists(path) && new FileInfo(path).Length > 0);
    }
    finally
    {
      Directory.Delete(root, recursive: true);
    }
  }

  [Fact]
  public async Task TamperedHashChainIsUnavailableAfterRestart()
  {
    var lifecycle = CreateLifecycle();
    var root = CreateTemporaryDirectory();
    var path = Path.Combine(root, "isolation-replay.jsonl");
    try
    {
      using (var store = new FilePrivilegedCommandIsolationReplayStore(path))
      {
        AssertCommitted(
          await store.CommitReservationAsync(lifecycle.Reservation, default),
          lifecycle.Reservation.LeaseSha256);
      }

      var ledger = File.ReadAllText(path);
      Assert.Contains("\"entrySequence\":1", ledger, StringComparison.Ordinal);
      File.WriteAllText(
        path,
        ledger.Replace(
          "\"entrySequence\":1",
          "\"entrySequence\":2",
          StringComparison.Ordinal));

      using var restarted = new FilePrivilegedCommandIsolationReplayStore(path);
      var result = await restarted.CommitReservationAsync(
        lifecycle.Reservation,
        default);
      AssertRejected(
        result,
        PrivilegedCommandIsolationReplayCommitStatus.Unavailable,
        lifecycle.Reservation.LeaseSha256,
        existingEvidenceSha256: null);
    }
    finally
    {
      Directory.Delete(root, recursive: true);
    }
  }

  [Fact]
  public async Task ConcurrentLedgerOwnerFailsClosedWithoutBlockingTheOwner()
  {
    var lifecycle = CreateLifecycle();
    var root = CreateTemporaryDirectory();
    var path = Path.Combine(root, "isolation-replay.jsonl");
    try
    {
      using (var owner = new FilePrivilegedCommandIsolationReplayStore(path))
      using (var contender = new FilePrivilegedCommandIsolationReplayStore(path))
      {
        AssertCommitted(
          await owner.CommitReservationAsync(lifecycle.Reservation, default),
          lifecycle.Reservation.LeaseSha256);
        AssertRejected(
          await contender.CommitReservationAsync(lifecycle.Reservation, default),
          PrivilegedCommandIsolationReplayCommitStatus.Unavailable,
          lifecycle.Reservation.LeaseSha256,
          existingEvidenceSha256: null);
        AssertCommitted(
          await owner.CommitBindAcknowledgementAsync(lifecycle.Bind, default),
          lifecycle.Bind.AcknowledgementSha256);
      }

      using var restarted = new FilePrivilegedCommandIsolationReplayStore(path);
      AssertAlreadyCommitted(
        await restarted.CommitReservationAsync(lifecycle.Reservation, default),
        lifecycle.Reservation.LeaseSha256);
      AssertAlreadyCommitted(
        await restarted.CommitBindAcknowledgementAsync(lifecycle.Bind, default),
        lifecycle.Bind.AcknowledgementSha256);
    }
    finally
    {
      Directory.Delete(root, recursive: true);
    }
  }

  [Theory]
  [InlineData(@"\\server\share\isolation-replay.jsonl")]
  [InlineData(@"\\?\C:\ProgramData\Itemba\isolation-replay.jsonl")]
  [InlineData(@"\\.\C:\ProgramData\Itemba\isolation-replay.jsonl")]
  [InlineData(@"\??\C:\ProgramData\Itemba\isolation-replay.jsonl")]
  [InlineData(@"C:\ProgramData\Itemba\isolation-replay.jsonl:alternate")]
  [InlineData(@"C:\ProgramData\Itemba\NUL.jsonl")]
  [InlineData(@"C:\ProgramData\Itemba\isolation-replay.jsonl.")]
  public void RejectsNetworkDeviceAndAlternateDataStreamPaths(string path)
  {
    Assert.Throws<ArgumentException>(
      () => new FilePrivilegedCommandIsolationReplayStore(path));
  }

  [Fact]
  public async Task ReparsePointAncestorFailsClosedWithoutWritingTheTarget()
  {
    var lifecycle = CreateLifecycle();
    var root = CreateTemporaryDirectory();
    var outside = CreateTemporaryDirectory();
    var junction = Path.Combine(root, "linked");
    try
    {
      CreateJunction(junction, outside);
      using var store = new FilePrivilegedCommandIsolationReplayStore(
        Path.Combine(junction, "isolation-replay.jsonl"));

      var result = await store.CommitReservationAsync(lifecycle.Reservation, default);

      AssertRejected(
        result,
        PrivilegedCommandIsolationReplayCommitStatus.Unavailable,
        lifecycle.Reservation.LeaseSha256,
        existingEvidenceSha256: null);
      Assert.False(File.Exists(Path.Combine(outside, "isolation-replay.jsonl")));
    }
    finally
    {
      if (Directory.Exists(junction))
      {
        Directory.Delete(junction, recursive: false);
      }
      Directory.Delete(root, recursive: true);
      Directory.Delete(outside, recursive: true);
    }
  }

  private static Lifecycle CreateLifecycle(
    long initialSequence = 10,
    string? supervisorInstanceId = null,
    string? bootId = null,
    string? requestNonceBase64Url = null,
    bool isolationIntact = true)
  {
    using var leaseKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    using var releaseKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    using var bindKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    using var receiptKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    supervisorInstanceId ??= NewId();
    bootId ??= NewId();
    requestNonceBase64Url ??= NewNonce();
    var action = new PrivilegedCommandIsolationActionBinding(
      NewId(),
      NewId(),
      NewId(),
      NewId(),
      DeviceId,
      NewId(),
      new string('6', 64),
      new string('7', 64),
      ImagePathSha256,
      ImageSha256,
      PolicySha256,
      DriverSha256,
      ServiceSha256,
      PrivilegedCommandIsolationFeatures.Required,
      PrivilegedCommandIsolationTestContracts.Authorization());
    var request = new PrivilegedCommandIsolationReservationRequestV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      NewId(),
      requestNonceBase64Url,
      action,
      NowUnixMilliseconds - 10_000,
      NowUnixMilliseconds + 90_000);
    var lease = new PrivilegedCommandIsolationReservationLeaseV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      NewId(),
      initialSequence,
      PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
      PrivilegedCommandIsolationCanonical.RequestNonceSha256(request),
      action,
      supervisorInstanceId,
      bootId,
      PrivilegedCommandIsolationFeatures.Required,
      NowUnixMilliseconds - 5_000,
      NowUnixMilliseconds + 60_000);
    var signedLease = PrivilegedCommandIsolationCanonical.SignReservationLease(
      lease,
      LeaseKeyId,
      leaseKey);
    var release = new PrivilegedCommandIsolationPreBindReleaseV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      NewId(),
      initialSequence + 1,
      PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
      PrivilegedCommandIsolationCanonical.RequestNonceSha256(request),
      PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(lease),
      action,
      supervisorInstanceId,
      bootId,
      NowUnixMilliseconds - 1_000,
      PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeProcess);
    var signedRelease = PrivilegedCommandIsolationCanonical.SignPreBindRelease(
      release,
      ReleaseKeyId,
      releaseKey);
    var process = new PrivilegedCommandIsolationProcessBinding(
      ParentProcessId: 400,
      ParentProcessCreationTimeUtcFileTime: 100,
      ChildProcessId: 500,
      ChildProcessCreationTimeUtcFileTime: 200,
      PrimaryThreadId: 600,
      NewId(),
      new string('8', 64),
      ImagePathSha256,
      ImageSha256,
      42,
      43,
      new string('9', 64),
      new string('a', 64),
      new string('b', 64),
      new string('7', 64));
    var binding = new PrivilegedCommandSuspendedProcessBindingV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      NewId(),
      PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
      PrivilegedCommandIsolationCanonical.RequestNonceSha256(request),
      PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(lease),
      action,
      supervisorInstanceId,
      bootId,
      process,
      CreatedSuspended: true,
      AssignedToJob: true,
      NowUnixMilliseconds - 4_000);
    var acknowledgement = new PrivilegedCommandIsolationBindAcknowledgementV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      NewId(),
      initialSequence + 1,
      PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
      PrivilegedCommandIsolationCanonical.RequestNonceSha256(request),
      PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(lease),
      PrivilegedCommandIsolationCanonical.SuspendedProcessBindingSha256(binding),
      action,
      supervisorInstanceId,
      bootId,
      process,
      PrivilegedCommandIsolationFeatures.Required,
      ChildStillSuspended: true,
      KernelEnforcementActive: true,
      MayResume: true,
      NowUnixMilliseconds - 3_000,
      NowUnixMilliseconds + 20_000);
    var signedAcknowledgement =
      PrivilegedCommandIsolationCanonical.SignBindAcknowledgement(
        acknowledgement,
        BindKeyId,
        bindKey);
    var receipt = new PrivilegedCommandIsolationTerminalReceiptV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      NewId(),
      initialSequence + 2,
      PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
      PrivilegedCommandIsolationCanonical.RequestNonceSha256(request),
      PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(lease),
      PrivilegedCommandIsolationCanonical.SuspendedProcessBindingSha256(binding),
      PrivilegedCommandIsolationCanonical.BindAcknowledgementSha256(acknowledgement),
      action,
      supervisorInstanceId,
      bootId,
      process,
      PrivilegedCommandIsolationFeatures.Required,
      ProcessResumed: true,
      NowUnixMilliseconds - 2_500,
      NowUnixMilliseconds - 1_000,
      NowUnixMilliseconds - 500,
      ProcessTreeTerminal: true,
      EnforcementContinuous: isolationIntact,
      ExitCodeKnown: true,
      ExitCode: 0,
      new string('9', 64),
      isolationIntact
        ? PrivilegedCommandIsolationTerminalOutcomes.Completed
        : PrivilegedCommandIsolationTerminalOutcomes.IsolationViolation);
    var signedReceipt = PrivilegedCommandIsolationCanonical.SignTerminalReceipt(
      receipt,
      ReceiptKeyId,
      receiptKey);
    var verifier = new PrivilegedCommandIsolationContractVerifier(
      PrivilegedCommandIsolationVerificationSettings.Strict(
        DeviceId,
        PolicySha256,
        DriverSha256,
        ServiceSha256),
      new StaticPurposeKeyResolver(
      [
        (LeaseKeyId,
          PrivilegedCommandIsolationSignaturePurposes.ReservationLease,
          leaseKey),
        (ReleaseKeyId,
          PrivilegedCommandIsolationSignaturePurposes.PreBindReservationRelease,
          releaseKey),
        (BindKeyId,
          PrivilegedCommandIsolationSignaturePurposes.SuspendedProcessBindAcknowledgement,
          bindKey),
        (ReceiptKeyId,
          PrivilegedCommandIsolationSignaturePurposes.TerminalEnforcementReceipt,
          receiptKey),
      ]),
      new FixedTimeProvider(
        DateTimeOffset.FromUnixTimeMilliseconds(NowUnixMilliseconds)));

    var reservationResult = verifier.VerifyReservation(request, signedLease, action);
    Assert.True(reservationResult.IsValid, reservationResult.ErrorCode);
    var reservation = Assert.IsType<VerifiedPrivilegedCommandIsolationReservation>(
      reservationResult.Value);
    var releaseResult = verifier.VerifyPreBindRelease(reservation, signedRelease);
    Assert.True(releaseResult.IsValid, releaseResult.ErrorCode);
    var verifiedRelease = Assert.IsType<VerifiedPrivilegedCommandIsolationPreBindRelease>(
      releaseResult.Value);
    var bindResult = verifier.VerifyBindAcknowledgement(
      reservation,
      binding,
      signedAcknowledgement);
    Assert.True(bindResult.IsValid, bindResult.ErrorCode);
    var verifiedBind = Assert.IsType<VerifiedPrivilegedCommandIsolationBindAcknowledgement>(
      bindResult.Value);
    var terminalResult = verifier.VerifyTerminalReceipt(verifiedBind, signedReceipt);
    Assert.True(terminalResult.IsValid, terminalResult.ErrorCode);
    var terminal = Assert.IsType<VerifiedPrivilegedCommandIsolationTerminalReceipt>(
      terminalResult.Value);
    return new(
      requestNonceBase64Url,
      supervisorInstanceId,
      bootId,
      reservation,
      verifiedRelease,
      verifiedBind,
      terminal);
  }

  private static void AssertCommitted(
    PrivilegedCommandIsolationReplayCommitResult result,
    string evidenceSha256)
  {
    Assert.Equal(PrivilegedCommandIsolationReplayCommitStatus.Committed, result.Status);
    Assert.Equal(evidenceSha256, result.EvidenceSha256);
    Assert.Null(result.ExistingEvidenceSha256);
    Assert.True(result.AllowsProgressFor(evidenceSha256));
  }

  private static void AssertAlreadyCommitted(
    PrivilegedCommandIsolationReplayCommitResult result,
    string evidenceSha256)
  {
    Assert.Equal(
      PrivilegedCommandIsolationReplayCommitStatus.AlreadyCommitted,
      result.Status);
    Assert.Equal(evidenceSha256, result.EvidenceSha256);
    Assert.Equal(evidenceSha256, result.ExistingEvidenceSha256);
    Assert.True(result.AllowsProgressFor(evidenceSha256));
  }

  private static void AssertRejected(
    PrivilegedCommandIsolationReplayCommitResult result,
    PrivilegedCommandIsolationReplayCommitStatus status,
    string evidenceSha256,
    string? existingEvidenceSha256)
  {
    Assert.Equal(status, result.Status);
    Assert.Equal(evidenceSha256, result.EvidenceSha256);
    Assert.Equal(existingEvidenceSha256, result.ExistingEvidenceSha256);
    Assert.False(result.AllowsProgressFor(evidenceSha256));
  }

  private static string CreateTemporaryDirectory()
  {
    var path = Path.Combine(
      Path.GetTempPath(),
      $"itemba-isolation-replay-{Guid.NewGuid():N}");
    Directory.CreateDirectory(path);
    return path;
  }

  private static IHost BuildRecoveryHost(
    string path,
    IPrivilegedCommandTrustedRootIsolationRecovery recovery,
    DispatchStartProbe dispatch) => new HostBuilder()
    .ConfigureServices((_, services) =>
    {
      services.AddSingleton<IPrivilegedCommandIsolationReplayStore>(
        _ => new FilePrivilegedCommandIsolationReplayStore(path));
      services.AddSingleton(recovery);
      services.AddHostedService<PrivilegedCommandIsolationStartupReconciler>();
      services.AddSingleton(dispatch);
      services.AddSingleton<IHostedService>(services =>
        services.GetRequiredService<DispatchStartProbe>());
    })
    .Build();

  private static string NewId() => Guid.NewGuid().ToString("D");

  private static string NewNonce()
  {
    var bytes = RandomNumberGenerator.GetBytes(32);
    return Convert.ToBase64String(bytes)
      .TrimEnd('=')
      .Replace('+', '-')
      .Replace('/', '_');
  }

  private static void CreateJunction(string junctionPath, string targetPath)
  {
    Directory.CreateDirectory(junctionPath);
    using var handle = OpenDirectoryForReparsePoint(junctionPath);
    Assert.False(handle.IsInvalid);
    var substituteName = $@"\??\{Path.GetFullPath(targetPath)}";
    var printName = Path.GetFullPath(targetPath);
    var substituteBytes = Encoding.Unicode.GetBytes(substituteName);
    var printBytes = Encoding.Unicode.GetBytes(printName);
    var pathBufferLength = checked(substituteBytes.Length + 2 + printBytes.Length + 2);
    var reparseDataLength = checked((ushort)(8 + pathBufferLength));
    var buffer = new byte[checked(8 + reparseDataLength)];
    BitConverter.GetBytes(0xA0000003u).CopyTo(buffer, 0);
    BitConverter.GetBytes(reparseDataLength).CopyTo(buffer, 4);
    BitConverter.GetBytes((ushort)0).CopyTo(buffer, 6);
    BitConverter.GetBytes((ushort)0).CopyTo(buffer, 8);
    BitConverter.GetBytes(checked((ushort)substituteBytes.Length)).CopyTo(buffer, 10);
    BitConverter.GetBytes(checked((ushort)(substituteBytes.Length + 2))).CopyTo(buffer, 12);
    BitConverter.GetBytes(checked((ushort)printBytes.Length)).CopyTo(buffer, 14);
    substituteBytes.CopyTo(buffer, 16);
    printBytes.CopyTo(buffer, checked(16 + substituteBytes.Length + 2));
    var unmanaged = Marshal.AllocHGlobal(buffer.Length);
    try
    {
      Marshal.Copy(buffer, 0, unmanaged, buffer.Length);
      Assert.True(SetReparsePoint(
        handle,
        0x000900A4,
        unmanaged,
        checked((uint)buffer.Length),
        IntPtr.Zero,
        0,
        out _,
        IntPtr.Zero));
    }
    finally
    {
      Marshal.FreeHGlobal(unmanaged);
    }
  }

  [LibraryImport("kernel32.dll", EntryPoint = "CreateFileW", SetLastError = true,
    StringMarshalling = StringMarshalling.Utf16)]
  private static partial SafeFileHandle OpenDirectoryForReparsePoint(
    string fileName,
    uint desiredAccess = 0x40000000,
    uint shareMode = 0,
    IntPtr securityAttributes = default,
    uint creationDisposition = 3,
    uint flagsAndAttributes = 0x02200000,
    IntPtr templateFile = default);

  [LibraryImport("kernel32.dll", EntryPoint = "DeviceIoControl", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool SetReparsePoint(
    SafeFileHandle device,
    uint controlCode,
    IntPtr inputBuffer,
    uint inputBufferSize,
    IntPtr outputBuffer,
    uint outputBufferSize,
    out uint bytesReturned,
    IntPtr overlapped);

  private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
  {
    public override DateTimeOffset GetUtcNow() => now;
  }

  private sealed class DispatchStartProbe : IHostedService
  {
    public bool Started { get; private set; }

    public Task StartAsync(CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      Started = true;
      return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
  }

  private sealed class FixedRecoveryGate(
    VerifiedPrivilegedCommandIsolationPreBindRelease release,
    VerifiedPrivilegedCommandIsolationTerminalReceipt terminal) :
    IPrivilegedCommandTrustedRootIsolationGate,
    IPrivilegedCommandTrustedRootIsolationRecovery
  {
    public int ReserveCallCount { get; private set; }

    public int ReservationRecoveryCallCount { get; private set; }

    public int BindRecoveryCallCount { get; private set; }

    public ValueTask<IPrivilegedCommandTrustedRootIsolationSession?> TryReserveAsync(
      PrivilegedCommandIsolationRequestBinding binding,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      ReserveCallCount++;
      return default;
    }

    public ValueTask<VerifiedPrivilegedCommandIsolationPreBindRelease?>
      TryRecoverPendingReservationAsync(
        PrivilegedCommandIsolationPendingReservation pending,
        CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      ReservationRecoveryCallCount++;
      var expected = release.Reservation;
      var exact = string.Equals(
          PrivilegedCommandIsolationCanonical.ReservationRequestSha256(pending.Request),
          expected.ReservationRequestSha256,
          StringComparison.Ordinal)
        && string.Equals(
          PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(
            pending.SignedLease.Lease),
          expected.LeaseSha256,
          StringComparison.Ordinal);
      return ValueTask.FromResult<VerifiedPrivilegedCommandIsolationPreBindRelease?>(
        exact ? release : null);
    }

    public ValueTask<VerifiedPrivilegedCommandIsolationTerminalReceipt?>
      TryRecoverPendingBindAsync(
        PrivilegedCommandIsolationPendingBind pending,
        CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      BindRecoveryCallCount++;
      var expected = terminal.BindAcknowledgement;
      var exact = string.Equals(
          PrivilegedCommandIsolationCanonical.ReservationLeaseSha256(
            pending.SignedLease.Lease),
          expected.Reservation.LeaseSha256,
          StringComparison.Ordinal)
        && string.Equals(
          PrivilegedCommandIsolationCanonical.SuspendedProcessBindingSha256(
            pending.Binding),
          expected.SuspendedProcessBindingSha256,
          StringComparison.Ordinal)
        && string.Equals(
          PrivilegedCommandIsolationCanonical.BindAcknowledgementSha256(
            pending.SignedAcknowledgement.Acknowledgement),
          expected.AcknowledgementSha256,
          StringComparison.Ordinal);
      return ValueTask.FromResult<VerifiedPrivilegedCommandIsolationTerminalReceipt?>(
        exact ? terminal : null);
    }
  }

  /// <summary>
  /// Adversarial gate that ignores the pending input and returns a valid marker
  /// for another lifecycle. The consumer, not this test double, must reject it.
  /// </summary>
  private sealed class UnconditionalRecoveryGate(
    VerifiedPrivilegedCommandIsolationPreBindRelease release,
    VerifiedPrivilegedCommandIsolationTerminalReceipt terminal) :
    IPrivilegedCommandTrustedRootIsolationGate,
    IPrivilegedCommandTrustedRootIsolationRecovery
  {
    public int ReserveCallCount { get; private set; }

    public ValueTask<IPrivilegedCommandTrustedRootIsolationSession?> TryReserveAsync(
      PrivilegedCommandIsolationRequestBinding binding,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      ReserveCallCount++;
      return default;
    }

    public ValueTask<VerifiedPrivilegedCommandIsolationPreBindRelease?>
      TryRecoverPendingReservationAsync(
        PrivilegedCommandIsolationPendingReservation pending,
        CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      return ValueTask.FromResult<VerifiedPrivilegedCommandIsolationPreBindRelease?>(
        release);
    }

    public ValueTask<VerifiedPrivilegedCommandIsolationTerminalReceipt?>
      TryRecoverPendingBindAsync(
        PrivilegedCommandIsolationPendingBind pending,
        CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      return ValueTask.FromResult<VerifiedPrivilegedCommandIsolationTerminalReceipt?>(
        terminal);
    }
  }

  private sealed class StaticPurposeKeyResolver :
    IPrivilegedCommandIsolationVerificationKeyResolver
  {
    private readonly Dictionary<(string KeyId, string Purpose), ECParameters> _keys;

    public StaticPurposeKeyResolver(
      IEnumerable<(string KeyId, string Purpose, ECDsa Key)> keys)
    {
      _keys = keys.ToDictionary(
        item => (item.KeyId, item.Purpose),
        item => item.Key.ExportParameters(includePrivateParameters: false));
    }

    public bool TryResolve(string keyId, string signaturePurpose, out ECDsa? publicKey)
    {
      if (!_keys.TryGetValue((keyId, signaturePurpose), out var parameters))
      {
        publicKey = null;
        return false;
      }
      publicKey = ECDsa.Create(parameters);
      return true;
    }
  }

  private sealed record Lifecycle(
    string RequestNonceBase64Url,
    string SupervisorInstanceId,
    string BootId,
    VerifiedPrivilegedCommandIsolationReservation Reservation,
    VerifiedPrivilegedCommandIsolationPreBindRelease Release,
    VerifiedPrivilegedCommandIsolationBindAcknowledgement Bind,
    VerifiedPrivilegedCommandIsolationTerminalReceipt Terminal);

  private const string LeaseKeyId = "isolation-reservation-v1";
  private const string ReleaseKeyId = "isolation-release-v1";
  private const string BindKeyId = "isolation-bind-v1";
  private const string ReceiptKeyId = "isolation-terminal-v1";
}
