using System.Security.Cryptography;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;

namespace Itemba.Msaidizi.Companion.Tests;

internal enum RunnerPrivilegedCommandIsolationStage
{
  None = 0,
  Reserve = 1,
  PreBindRelease = 2,
  Bind = 3,
  Terminal = 4,
}

internal enum RunnerPrivilegedCommandIsolationTamperMode
{
  None = 0,
  ReservationAction = 1,
  ReservationSignature = 2,
  PreBindReleaseOutcome = 3,
  PreBindReleaseSignature = 4,
  BindProcess = 5,
  BindSignature = 6,
  TerminalObservation = 7,
  TerminalSignature = 8,
  TerminalIsolationViolation = 9,
}

internal sealed record RunnerPrivilegedCommandIsolationTestBehavior(
  RunnerPrivilegedCommandIsolationStage ReturnNullAt =
    RunnerPrivilegedCommandIsolationStage.None,
  RunnerPrivilegedCommandIsolationStage BlockAt =
    RunnerPrivilegedCommandIsolationStage.None,
  RunnerPrivilegedCommandIsolationTamperMode Tamper =
    RunnerPrivilegedCommandIsolationTamperMode.None);

/// <summary>
/// Fully signed test-only two-phase supervisor. It never manufactures a
/// verified marker: every returned value was accepted by the production
/// contract verifier using purpose-scoped P-256 public keys.
/// </summary>
internal sealed class RunnerPrivilegedCommandIsolationTestGate :
  IPrivilegedCommandTrustedRootIsolationGate,
  IDisposable
{
  internal const string PolicySha256 =
    "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
  internal const string DriverSha256 =
    "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
  internal const string ServiceSha256 =
    "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

  private const string LeaseKeyId = "runner-test-isolation-lease-v1";
  private const string ReleaseKeyId = "runner-test-isolation-release-v1";
  private const string BindKeyId = "runner-test-isolation-bind-v1";
  private const string TerminalKeyId = "runner-test-isolation-terminal-v1";

  private readonly object _sync = new();
  private readonly List<string> _calls = [];
  private readonly List<PrivilegedCommandIsolationRequestBinding> _requests = [];
  private readonly List<string> _releaseOutcomes = [];
  private readonly List<PrivilegedCommandSuspendedProcessObservation>
    _processObservations = [];
  private readonly List<PrivilegedCommandTerminalObservation> _terminalObservations = [];
  private readonly ECDsa _leaseKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
  private readonly ECDsa _releaseKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
  private readonly ECDsa _bindKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
  private readonly ECDsa _terminalKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
  private readonly PurposeKeyResolver _keys;
  private readonly TimeProvider _timeProvider;
  private readonly TaskCompletionSource _blocked = new(
    TaskCreationOptions.RunContinuationsAsynchronously);
  private readonly TaskCompletionSource _unblocked = new(
    TaskCreationOptions.RunContinuationsAsynchronously);
  private long _sequence;
  private bool _disposed;
  private string? _lastVerificationErrorCode;

  public RunnerPrivilegedCommandIsolationTestGate(
    RunnerPrivilegedCommandIsolationTestBehavior? behavior = null,
    TimeProvider? timeProvider = null)
  {
    Behavior = behavior ?? new RunnerPrivilegedCommandIsolationTestBehavior();
    _timeProvider = timeProvider ?? TimeProvider.System;
    SupervisorInstanceId = NewCanonicalGuid();
    BootId = NewCanonicalGuid();
    _keys = new PurposeKeyResolver(
    [
      (LeaseKeyId,
        PrivilegedCommandIsolationSignaturePurposes.ReservationLease,
        _leaseKey),
      (ReleaseKeyId,
        PrivilegedCommandIsolationSignaturePurposes.PreBindReservationRelease,
        _releaseKey),
      (BindKeyId,
        PrivilegedCommandIsolationSignaturePurposes.SuspendedProcessBindAcknowledgement,
        _bindKey),
      (TerminalKeyId,
        PrivilegedCommandIsolationSignaturePurposes.TerminalEnforcementReceipt,
        _terminalKey),
    ]);
  }

  public RunnerPrivilegedCommandIsolationTestBehavior Behavior { get; }

  public string SupervisorInstanceId { get; }

  public string BootId { get; }

  public IReadOnlyList<string> Calls
  {
    get
    {
      lock (_sync)
      {
        return _calls.ToArray();
      }
    }
  }

  public IReadOnlyList<PrivilegedCommandIsolationRequestBinding> Requests
  {
    get
    {
      lock (_sync)
      {
        return _requests.ToArray();
      }
    }
  }

  public IReadOnlyList<string> ReleaseOutcomes
  {
    get
    {
      lock (_sync)
      {
        return _releaseOutcomes.ToArray();
      }
    }
  }

  public IReadOnlyList<PrivilegedCommandSuspendedProcessObservation> ProcessObservations
  {
    get
    {
      lock (_sync)
      {
        return _processObservations.ToArray();
      }
    }
  }

  public IReadOnlyList<PrivilegedCommandTerminalObservation> TerminalObservations
  {
    get
    {
      lock (_sync)
      {
        return _terminalObservations.ToArray();
      }
    }
  }

  public string? LastVerificationErrorCode
  {
    get
    {
      lock (_sync)
      {
        return _lastVerificationErrorCode;
      }
    }
  }

  public int ReserveCallCount => Count("reserve");

  public int PreBindReleaseCallCount => Count("pre-bind-release");

  public int BindCallCount => Count("bind");

  public int TerminalCallCount => Count("terminal");

  public Task WaitUntilBlockedAsync(CancellationToken cancellationToken = default) =>
    _blocked.Task.WaitAsync(cancellationToken);

  public void Unblock() => _unblocked.TrySetResult();

  public async ValueTask<IPrivilegedCommandTrustedRootIsolationSession?> TryReserveAsync(
    PrivilegedCommandIsolationRequestBinding binding,
    CancellationToken cancellationToken)
  {
    ObjectDisposedException.ThrowIf(_disposed, this);
    ArgumentNullException.ThrowIfNull(binding);
    Record("reserve", () => _requests.Add(binding));
    await BlockIfConfiguredAsync(
      RunnerPrivilegedCommandIsolationStage.Reserve,
      cancellationToken).ConfigureAwait(false);
    if (ReturnsNull(RunnerPrivilegedCommandIsolationStage.Reserve))
    {
      return null;
    }

    var now = NowUnixMilliseconds();
    var expectedAction = ActionFrom(binding);
    var signedAction = Behavior.Tamper
        == RunnerPrivilegedCommandIsolationTamperMode.ReservationAction
      ? expectedAction with { InvocationSha256 = new string('0', 64) }
      : expectedAction;
    var request = new PrivilegedCommandIsolationReservationRequestV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      NewCanonicalGuid(),
      NewNonceBase64Url(),
      signedAction,
      now - 1_000,
      now + 90_000);
    var lease = new PrivilegedCommandIsolationReservationLeaseV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      NewCanonicalGuid(),
      NextSequence(),
      PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
      PrivilegedCommandIsolationCanonical.RequestNonceSha256(request),
      signedAction,
      SupervisorInstanceId,
      BootId,
      PrivilegedCommandIsolationFeatures.Required,
      now - 500,
      now + 60_000);
    var signedLease = PrivilegedCommandIsolationCanonical.SignReservationLease(
      lease,
      LeaseKeyId,
      _leaseKey);
    if (Behavior.Tamper
      == RunnerPrivilegedCommandIsolationTamperMode.ReservationSignature)
    {
      signedLease = signedLease with { SignatureBase64 = InvalidSignatureBase64 };
    }

    var verifier = CreateVerifier(signedAction);
    var verified = verifier.VerifyReservation(request, signedLease, signedAction);
    if (!verified.IsValid || verified.Value is null)
    {
      SetVerificationError(verified.ErrorCode);
      return null;
    }

    return new Session(this, verifier, verified.Value);
  }

  public void Dispose()
  {
    if (_disposed)
    {
      return;
    }

    _disposed = true;
    _unblocked.TrySetResult();
    _leaseKey.Dispose();
    _releaseKey.Dispose();
    _bindKey.Dispose();
    _terminalKey.Dispose();
  }

  private PrivilegedCommandIsolationContractVerifier CreateVerifier(
    PrivilegedCommandIsolationActionBinding action) => new(
      PrivilegedCommandIsolationVerificationSettings.Strict(
        action.DeviceId,
        PolicySha256,
        DriverSha256,
        ServiceSha256),
      _keys,
      _timeProvider);

  private static PrivilegedCommandIsolationActionBinding ActionFrom(
    PrivilegedCommandIsolationRequestBinding binding)
  {
    var ephemeral = binding.EphemeralBinding
      ?? throw new InvalidOperationException("The runner test binding lacks authorization.");
    var signedAction = ephemeral.ActionAuthorization.SignedAction;
    var request = signedAction.Request;
    var claims = ephemeral.ActionAuthorization.VerifiedClaims;
    if (!PayloadDigest.FixedTimeEqualsHex(
        binding.ActionTokenSha256,
        PayloadDigest.Sha256Hex(signedAction.CompactToken))
      || !PayloadDigest.FixedTimeEqualsHex(
        binding.InvocationSha256,
        PrivilegedCommandIsolationCanonical.InvocationSha256(ephemeral.Invocation))
      || ActionRequestAuthorizer.Validate(request, claims) is not null
      || !string.Equals(request.ActionId, binding.ActionId, StringComparison.Ordinal)
      || !string.Equals(request.TaskId, binding.TaskId, StringComparison.Ordinal)
      || !string.Equals(
        request.PlanVersionId,
        binding.PlanVersionId,
        StringComparison.Ordinal)
      || !string.Equals(request.StepId, binding.StepId, StringComparison.Ordinal)
      || !string.Equals(request.DeviceId, binding.DeviceId, StringComparison.Ordinal)
      || !string.Equals(request.MandateId, binding.MandateId, StringComparison.Ordinal))
    {
      throw new InvalidOperationException(
        "The runner test binding authorization does not match the action.");
    }

    return new PrivilegedCommandIsolationActionBinding(
      binding.ActionId,
      binding.TaskId,
      binding.PlanVersionId,
      binding.StepId,
      binding.DeviceId,
      binding.MandateId,
      binding.ActionTokenSha256,
      binding.InvocationSha256,
      binding.ExpectedImagePathSha256,
      binding.ExpectedImageSha256,
      PolicySha256,
      DriverSha256,
      ServiceSha256,
      PrivilegedCommandIsolationFeatures.Required,
      new PrivilegedCommandIsolationActionAuthorizationV2(
        request.CapabilityId,
        request.CapabilityVersion,
        request.ArgumentsSha256,
        request.ExpectedPreStateSha256,
        request.InputProvenanceSha256,
        PayloadDigest.Sha256Hex(request.IdempotencyKey),
        request.LeaseId,
        request.FencingToken,
        request.LeaseExpiresAt.ToUnixTimeSeconds(),
        request.DispatchCount,
        request.ExecutionMode,
        claims.Budgets with { }));
  }

  private async ValueTask BlockIfConfiguredAsync(
    RunnerPrivilegedCommandIsolationStage stage,
    CancellationToken cancellationToken)
  {
    if (Behavior.BlockAt != stage)
    {
      return;
    }

    _blocked.TrySetResult();
    await _unblocked.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
  }

  private bool ReturnsNull(RunnerPrivilegedCommandIsolationStage stage) =>
    Behavior.ReturnNullAt == stage;

  private long NextSequence() => Interlocked.Increment(ref _sequence);

  private long NowUnixMilliseconds() =>
    _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();

  private int Count(string call)
  {
    lock (_sync)
    {
      return _calls.Count(item => string.Equals(item, call, StringComparison.Ordinal));
    }
  }

  private void Record(string call, Action? append = null)
  {
    lock (_sync)
    {
      _calls.Add(call);
      append?.Invoke();
    }
  }

  private void SetVerificationError(string? errorCode)
  {
    lock (_sync)
    {
      _lastVerificationErrorCode = errorCode;
    }
  }

  private static string NewCanonicalGuid() => Guid.NewGuid().ToString("D");

  private static string NewNonceBase64Url()
  {
    var nonce = RandomNumberGenerator.GetBytes(32);
    try
    {
      return Convert.ToBase64String(nonce)
        .TrimEnd('=')
        .Replace('+', '-')
        .Replace('/', '_');
    }
    finally
    {
      CryptographicOperations.ZeroMemory(nonce);
    }
  }

  private static string InvalidSignatureBase64 => Convert.ToBase64String(new byte[64]);

  private sealed class Session : IPrivilegedCommandTrustedRootIsolationSession
  {
    private readonly RunnerPrivilegedCommandIsolationTestGate _owner;
    private readonly PrivilegedCommandIsolationContractVerifier _verifier;
    private bool _disposed;

    public Session(
      RunnerPrivilegedCommandIsolationTestGate owner,
      PrivilegedCommandIsolationContractVerifier verifier,
      VerifiedPrivilegedCommandIsolationReservation reservation)
    {
      _owner = owner;
      _verifier = verifier;
      Reservation = reservation;
    }

    public VerifiedPrivilegedCommandIsolationReservation Reservation { get; }

    public async ValueTask<VerifiedPrivilegedCommandIsolationPreBindRelease?>
      TryReleaseBeforeBindAsync(
        string outcome,
        CancellationToken cancellationToken)
    {
      ObjectDisposedException.ThrowIf(_disposed, this);
      _owner.Record("pre-bind-release", () => _owner._releaseOutcomes.Add(outcome));
      await _owner.BlockIfConfiguredAsync(
        RunnerPrivilegedCommandIsolationStage.PreBindRelease,
        cancellationToken).ConfigureAwait(false);
      if (_owner.ReturnsNull(RunnerPrivilegedCommandIsolationStage.PreBindRelease))
      {
        return null;
      }

      var effectiveOutcome = _owner.Behavior.Tamper
          == RunnerPrivilegedCommandIsolationTamperMode.PreBindReleaseOutcome
        ? AlternateReleaseOutcome(outcome)
        : outcome;
      var release = new PrivilegedCommandIsolationPreBindReleaseV1(
        PrivilegedCommandIsolationCanonical.ContractVersion,
        NewCanonicalGuid(),
        _owner.NextSequence(),
        Reservation.ReservationRequestSha256,
        Reservation.RequestNonceSha256,
        Reservation.LeaseSha256,
        Reservation.Request.Action,
        Reservation.SignedLease.Lease.SupervisorInstanceId,
        Reservation.SignedLease.Lease.BootId,
        _owner.NowUnixMilliseconds(),
        effectiveOutcome);
      var signedRelease = PrivilegedCommandIsolationCanonical.SignPreBindRelease(
        release,
        ReleaseKeyId,
        _owner._releaseKey);
      if (_owner.Behavior.Tamper
        == RunnerPrivilegedCommandIsolationTamperMode.PreBindReleaseSignature)
      {
        signedRelease = signedRelease with { SignatureBase64 = InvalidSignatureBase64 };
      }

      var verified = _verifier.VerifyPreBindRelease(Reservation, signedRelease);
      if (!verified.IsValid || verified.Value is null)
      {
        _owner.SetVerificationError(verified.ErrorCode);
        return null;
      }
      return verified.Value;
    }

    public async ValueTask<VerifiedPrivilegedCommandIsolationBindAcknowledgement?>
      TryBindSuspendedProcessAsync(
        PrivilegedCommandSuspendedProcessObservation observation,
        CancellationToken cancellationToken)
    {
      ObjectDisposedException.ThrowIf(_disposed, this);
      _owner.Record("bind", () => _owner._processObservations.Add(observation));
      await _owner.BlockIfConfiguredAsync(
        RunnerPrivilegedCommandIsolationStage.Bind,
        cancellationToken).ConfigureAwait(false);
      if (_owner.ReturnsNull(RunnerPrivilegedCommandIsolationStage.Bind))
      {
        return null;
      }

      var process = ProcessFrom(observation, Reservation.LeaseSha256);
      if (_owner.Behavior.Tamper
        == RunnerPrivilegedCommandIsolationTamperMode.BindProcess)
      {
        process = process with { ChildProcessId = checked(process.ChildProcessId + 1) };
      }
      var now = _owner.NowUnixMilliseconds();
      var binding = new PrivilegedCommandSuspendedProcessBindingV1(
        PrivilegedCommandIsolationCanonical.ContractVersion,
        NewCanonicalGuid(),
        Reservation.ReservationRequestSha256,
        Reservation.RequestNonceSha256,
        Reservation.LeaseSha256,
        Reservation.Request.Action,
        Reservation.SignedLease.Lease.SupervisorInstanceId,
        Reservation.SignedLease.Lease.BootId,
        process,
        observation.CreatedSuspended,
        observation.AssignedToJob,
        now);
      var acknowledgement = new PrivilegedCommandIsolationBindAcknowledgementV1(
        PrivilegedCommandIsolationCanonical.ContractVersion,
        NewCanonicalGuid(),
        _owner.NextSequence(),
        Reservation.ReservationRequestSha256,
        Reservation.RequestNonceSha256,
        Reservation.LeaseSha256,
        PrivilegedCommandIsolationCanonical.SuspendedProcessBindingSha256(binding),
        Reservation.Request.Action,
        Reservation.SignedLease.Lease.SupervisorInstanceId,
        Reservation.SignedLease.Lease.BootId,
        process,
        PrivilegedCommandIsolationFeatures.Required,
        ChildStillSuspended: true,
        KernelEnforcementActive: true,
        MayResume: true,
        now,
        Math.Min(
          now + 20_000,
          Reservation.SignedLease.Lease.ExpiresAtUnixMilliseconds));
      var signedAcknowledgement =
        PrivilegedCommandIsolationCanonical.SignBindAcknowledgement(
          acknowledgement,
          BindKeyId,
          _owner._bindKey);
      if (_owner.Behavior.Tamper
        == RunnerPrivilegedCommandIsolationTamperMode.BindSignature)
      {
        signedAcknowledgement = signedAcknowledgement with
        {
          SignatureBase64 = InvalidSignatureBase64,
        };
      }

      var verified = _verifier.VerifyBindAcknowledgement(
        Reservation,
        binding,
        signedAcknowledgement);
      if (!verified.IsValid || verified.Value is null)
      {
        _owner.SetVerificationError(verified.ErrorCode);
        return null;
      }
      return verified.Value;
    }

    public async ValueTask<VerifiedPrivilegedCommandIsolationTerminalReceipt?>
      TrySettleAsync(
        VerifiedPrivilegedCommandIsolationBindAcknowledgement bindAcknowledgement,
        PrivilegedCommandTerminalObservation observation,
        CancellationToken cancellationToken)
    {
      ObjectDisposedException.ThrowIf(_disposed, this);
      _owner.Record("terminal", () => _owner._terminalObservations.Add(observation));
      await _owner.BlockIfConfiguredAsync(
        RunnerPrivilegedCommandIsolationStage.Terminal,
        cancellationToken).ConfigureAwait(false);
      if (_owner.ReturnsNull(RunnerPrivilegedCommandIsolationStage.Terminal))
      {
        return null;
      }

      var effective = _owner.Behavior.Tamper switch
      {
        RunnerPrivilegedCommandIsolationTamperMode.TerminalObservation =>
          AlternateTerminalObservation(observation),
        RunnerPrivilegedCommandIsolationTamperMode.TerminalIsolationViolation =>
          observation with
          {
            Outcome = PrivilegedCommandIsolationTerminalOutcomes.IsolationViolation,
          },
        _ => observation,
      };
      var acknowledgement = bindAcknowledgement.SignedAcknowledgement.Acknowledgement;
      var now = _owner.NowUnixMilliseconds();
      var resumedAt = effective.ProcessResumed
        ? Math.Max(now, acknowledgement.IssuedAtUnixMilliseconds + 1)
        : 0;
      var endedAt = Math.Max(
        now,
        effective.ProcessResumed
          ? resumedAt
          : acknowledgement.IssuedAtUnixMilliseconds);
      var receipt = new PrivilegedCommandIsolationTerminalReceiptV1(
        PrivilegedCommandIsolationCanonical.ContractVersion,
        NewCanonicalGuid(),
        _owner.NextSequence(),
        Reservation.ReservationRequestSha256,
        Reservation.RequestNonceSha256,
        Reservation.LeaseSha256,
        bindAcknowledgement.SuspendedProcessBindingSha256,
        bindAcknowledgement.AcknowledgementSha256,
        bindAcknowledgement.Binding.Action,
        Reservation.SignedLease.Lease.SupervisorInstanceId,
        Reservation.SignedLease.Lease.BootId,
        bindAcknowledgement.Binding.Process,
        PrivilegedCommandIsolationFeatures.Required,
        effective.ProcessResumed,
        resumedAt,
        endedAt,
        endedAt,
        ProcessTreeTerminal: true,
        EnforcementContinuous: !string.Equals(
          effective.Outcome,
          PrivilegedCommandIsolationTerminalOutcomes.IsolationViolation,
          StringComparison.Ordinal),
        effective.ExitCodeKnown,
        effective.ExitCode,
        PayloadDigest.Sha256Hex(string.Join(':',
          "runner-test-terminal",
          Reservation.LeaseSha256,
          bindAcknowledgement.AcknowledgementSha256,
          effective.Outcome,
          effective.ExitCode)),
        effective.Outcome);
      var signedReceipt = PrivilegedCommandIsolationCanonical.SignTerminalReceipt(
        receipt,
        TerminalKeyId,
        _owner._terminalKey);
      if (_owner.Behavior.Tamper
        == RunnerPrivilegedCommandIsolationTamperMode.TerminalSignature)
      {
        signedReceipt = signedReceipt with { SignatureBase64 = InvalidSignatureBase64 };
      }

      var verified = _verifier.VerifyTerminalReceipt(bindAcknowledgement, signedReceipt);
      if (!verified.IsValid || verified.Value is null)
      {
        _owner.SetVerificationError(verified.ErrorCode);
        return null;
      }
      return verified.Value;
    }

    public ValueTask DisposeAsync()
    {
      if (!_disposed)
      {
        _disposed = true;
        _owner.Record("dispose");
      }
      return ValueTask.CompletedTask;
    }

    private static PrivilegedCommandIsolationProcessBinding ProcessFrom(
      PrivilegedCommandSuspendedProcessObservation observation,
      string leaseSha256)
    {
      var jobObjectId = NewCanonicalGuid();
      return new PrivilegedCommandIsolationProcessBinding(
        observation.ParentProcessId,
        observation.ParentProcessCreationTimeUtcFileTime,
        observation.ChildProcessId,
        observation.ChildProcessCreationTimeUtcFileTime,
        observation.PrimaryThreadId,
        jobObjectId,
        PayloadDigest.Sha256Hex(string.Join(':',
          "runner-test-kernel-job",
          leaseSha256,
          jobObjectId,
          observation.ChildProcessId)),
        observation.ImagePathSha256,
        observation.ImageSha256,
        observation.ImageVolumeSerialNumber,
        observation.ImageFileId,
        observation.CommandLineSha256,
        observation.WorkingDirectorySha256,
        observation.EnvironmentBlockSha256,
        observation.InvocationSha256);
    }

    private static string AlternateReleaseOutcome(string outcome) =>
      string.Equals(
        outcome,
        PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeProcess,
        StringComparison.Ordinal)
        ? PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeBind
        : PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeProcess;

    private static PrivilegedCommandTerminalObservation AlternateTerminalObservation(
      PrivilegedCommandTerminalObservation observation) =>
      string.Equals(
        observation.Outcome,
        PrivilegedCommandIsolationTerminalOutcomes.Completed,
        StringComparison.Ordinal)
        ? observation with
        {
          ExitCodeKnown = true,
          ExitCode = 1,
          Outcome = PrivilegedCommandIsolationTerminalOutcomes.Failed,
        }
        : observation with
        {
          Outcome = PrivilegedCommandIsolationTerminalOutcomes.Unknown,
        };
  }

  private sealed class PurposeKeyResolver :
    IPrivilegedCommandIsolationVerificationKeyResolver
  {
    private readonly Dictionary<(string KeyId, string Purpose), ECParameters> _keys;

    public PurposeKeyResolver(IEnumerable<(string KeyId, string Purpose, ECDsa Key)> keys)
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
}

/// <summary>
/// Exact-idempotent in-memory implementation of the consuming-service replay
/// contract. It models durable semantics for focused runner tests; production
/// code must use the file-backed store.
/// </summary>
internal sealed class InMemoryPrivilegedCommandIsolationReplayStore :
  IPrivilegedCommandIsolationReplayStore
{
  private readonly object _sync = new();
  private readonly Dictionary<string, ReplayState> _leases = new(StringComparer.Ordinal);
  private readonly Dictionary<string, string> _requestOwners = new(StringComparer.Ordinal);
  private readonly Dictionary<string, long> _generationSequences = new(
    StringComparer.Ordinal);
  private readonly List<string> _calls = [];

  public bool IsAvailable { get; set; } = true;

  public IReadOnlyList<string> Calls
  {
    get
    {
      lock (_sync)
      {
        return _calls.ToArray();
      }
    }
  }

  public ValueTask<PrivilegedCommandIsolationPendingSnapshot> ReadPendingAsync(
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    // This test-only store models a single uninterrupted runner invocation.
    // Restart recovery is exercised against the production file-backed store.
    return ValueTask.FromResult(
      new PrivilegedCommandIsolationPendingSnapshot([], [], []));
  }

  public ValueTask<PrivilegedCommandIsolationReplayCommitResult> CommitReservationAsync(
    VerifiedPrivilegedCommandIsolationReservation reservation,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    ArgumentNullException.ThrowIfNull(reservation);
    lock (_sync)
    {
      _calls.Add("reservation");
      var evidence = reservation.LeaseSha256;
      if (!IsAvailable)
      {
        return ValueTask.FromResult(Unavailable(evidence));
      }

      var lease = reservation.SignedLease.Lease;
      var requestKey = RequestKey(reservation);
      if (_requestOwners.TryGetValue(requestKey, out var existingOwner))
      {
        return ValueTask.FromResult(string.Equals(
          existingOwner,
          evidence,
          StringComparison.Ordinal)
          ? Already(evidence)
          : Conflict(evidence, existingOwner));
      }
      if (_leases.TryGetValue(lease.LeaseId, out var existingLease))
      {
        return ValueTask.FromResult(Conflict(evidence, existingLease.LeaseSha256));
      }
      var generation = GenerationKey(lease.SupervisorInstanceId, lease.BootId);
      if (IsStaleSequence(generation, lease.Sequence))
      {
        return ValueTask.FromResult(Stale(evidence));
      }

      _requestOwners.Add(requestKey, evidence);
      _leases.Add(lease.LeaseId, new ReplayState(
        lease.LeaseId,
        evidence,
        generation,
        lease.Sequence));
      AdvanceSequence(generation, lease.Sequence);
      return ValueTask.FromResult(Committed(evidence));
    }
  }

  public ValueTask<PrivilegedCommandIsolationReplayCommitResult> CommitPreBindReleaseAsync(
    VerifiedPrivilegedCommandIsolationPreBindRelease release,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    ArgumentNullException.ThrowIfNull(release);
    lock (_sync)
    {
      _calls.Add("pre-bind-release");
      var evidence = release.ReleaseSha256;
      if (!IsAvailable)
      {
        return ValueTask.FromResult(Unavailable(evidence));
      }

      var payload = release.SignedRelease.Release;
      if (!TryOwnsLease(
          release.Reservation.SignedLease.Lease.LeaseId,
          release.Reservation.LeaseSha256,
          out var state,
          out var conflict))
      {
        return ValueTask.FromResult(Conflict(evidence, conflict));
      }
      if (state.ReleaseSha256 is not null)
      {
        return ValueTask.FromResult(string.Equals(
          state.ReleaseSha256,
          evidence,
          StringComparison.Ordinal)
          ? Already(evidence)
          : Conflict(evidence, state.ReleaseSha256));
      }
      if (state.BindSha256 is not null)
      {
        return ValueTask.FromResult(Conflict(evidence, state.BindSha256));
      }
      if (IsStaleSequence(state.GenerationKey, payload.Sequence))
      {
        return ValueTask.FromResult(Stale(evidence));
      }

      state.ReleaseSha256 = evidence;
      AdvanceSequence(state.GenerationKey, payload.Sequence);
      return ValueTask.FromResult(Committed(evidence));
    }
  }

  public ValueTask<PrivilegedCommandIsolationReplayCommitResult>
    CommitBindAcknowledgementAsync(
      VerifiedPrivilegedCommandIsolationBindAcknowledgement bindAcknowledgement,
      CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    ArgumentNullException.ThrowIfNull(bindAcknowledgement);
    lock (_sync)
    {
      _calls.Add("bind");
      var evidence = bindAcknowledgement.AcknowledgementSha256;
      if (!IsAvailable)
      {
        return ValueTask.FromResult(Unavailable(evidence));
      }

      var payload = bindAcknowledgement.SignedAcknowledgement.Acknowledgement;
      var reservation = bindAcknowledgement.Reservation;
      if (!TryOwnsLease(
          reservation.SignedLease.Lease.LeaseId,
          reservation.LeaseSha256,
          out var state,
          out var conflict))
      {
        return ValueTask.FromResult(Conflict(evidence, conflict));
      }
      if (state.BindSha256 is not null)
      {
        return ValueTask.FromResult(string.Equals(
          state.BindSha256,
          evidence,
          StringComparison.Ordinal)
          ? Already(evidence)
          : Conflict(evidence, state.BindSha256));
      }
      if (state.ReleaseSha256 is not null)
      {
        return ValueTask.FromResult(Conflict(evidence, state.ReleaseSha256));
      }
      if (IsStaleSequence(state.GenerationKey, payload.Sequence))
      {
        return ValueTask.FromResult(Stale(evidence));
      }

      state.BindSha256 = evidence;
      AdvanceSequence(state.GenerationKey, payload.Sequence);
      return ValueTask.FromResult(Committed(evidence));
    }
  }

  public ValueTask<PrivilegedCommandIsolationReplayCommitResult> CommitTerminalReceiptAsync(
    VerifiedPrivilegedCommandIsolationTerminalReceipt terminalReceipt,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    ArgumentNullException.ThrowIfNull(terminalReceipt);
    lock (_sync)
    {
      _calls.Add("terminal");
      var evidence = terminalReceipt.ReceiptSha256;
      if (!IsAvailable)
      {
        return ValueTask.FromResult(Unavailable(evidence));
      }

      var bind = terminalReceipt.BindAcknowledgement;
      var reservation = bind.Reservation;
      if (!TryOwnsLease(
          reservation.SignedLease.Lease.LeaseId,
          reservation.LeaseSha256,
          out var state,
          out var conflict))
      {
        return ValueTask.FromResult(Conflict(evidence, conflict));
      }
      if (state.TerminalSha256 is not null)
      {
        return ValueTask.FromResult(string.Equals(
          state.TerminalSha256,
          evidence,
          StringComparison.Ordinal)
          ? Already(evidence)
          : Conflict(evidence, state.TerminalSha256));
      }
      if (!string.Equals(
        state.BindSha256,
        bind.AcknowledgementSha256,
        StringComparison.Ordinal))
      {
        return ValueTask.FromResult(Conflict(evidence, state.BindSha256));
      }

      var sequence = terminalReceipt.SignedReceipt.Receipt.Sequence;
      if (IsStaleSequence(state.GenerationKey, sequence))
      {
        return ValueTask.FromResult(Stale(evidence));
      }

      state.TerminalSha256 = evidence;
      AdvanceSequence(state.GenerationKey, sequence);
      return ValueTask.FromResult(Committed(evidence));
    }
  }

  private bool TryOwnsLease(
    string leaseId,
    string leaseSha256,
    out ReplayState state,
    out string? conflict)
  {
    if (!_leases.TryGetValue(leaseId, out var found))
    {
      state = null!;
      conflict = null;
      return false;
    }
    state = found;
    conflict = state.LeaseSha256;
    return string.Equals(state.LeaseSha256, leaseSha256, StringComparison.Ordinal);
  }

  private bool IsStaleSequence(string generation, long sequence) =>
    _generationSequences.TryGetValue(generation, out var current) && sequence <= current;

  private void AdvanceSequence(string generation, long sequence) =>
    _generationSequences[generation] = sequence;

  private static string RequestKey(
    VerifiedPrivilegedCommandIsolationReservation reservation) => string.Join('\n',
      reservation.SignedLease.Lease.SupervisorInstanceId,
      reservation.SignedLease.Lease.BootId,
      reservation.RequestNonceSha256,
      reservation.ReservationRequestSha256);

  private static string GenerationKey(string supervisorInstanceId, string bootId) =>
    $"{supervisorInstanceId}\n{bootId}";

  private static PrivilegedCommandIsolationReplayCommitResult Committed(string evidence) =>
    new(PrivilegedCommandIsolationReplayCommitStatus.Committed, evidence, null);

  private static PrivilegedCommandIsolationReplayCommitResult Already(string evidence) =>
    new(PrivilegedCommandIsolationReplayCommitStatus.AlreadyCommitted, evidence, evidence);

  private static PrivilegedCommandIsolationReplayCommitResult Conflict(
    string evidence,
    string? existing) => new(
      PrivilegedCommandIsolationReplayCommitStatus.Conflict,
      evidence,
      existing);

  private static PrivilegedCommandIsolationReplayCommitResult Stale(string evidence) =>
    new(PrivilegedCommandIsolationReplayCommitStatus.StaleSequence, evidence, null);

  private static PrivilegedCommandIsolationReplayCommitResult Unavailable(string evidence) =>
    new(PrivilegedCommandIsolationReplayCommitStatus.Unavailable, evidence, null);

  private sealed class ReplayState(
    string leaseId,
    string leaseSha256,
    string generationKey,
    long reservationSequence)
  {
    public string LeaseId { get; } = leaseId;

    public string LeaseSha256 { get; } = leaseSha256;

    public string GenerationKey { get; } = generationKey;

    public long ReservationSequence { get; } = reservationSequence;

    public string? ReleaseSha256 { get; set; }

    public string? BindSha256 { get; set; }

    public string? TerminalSha256 { get; set; }
  }
}
