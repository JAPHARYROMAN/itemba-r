using System.Security.Cryptography;
using System.Text;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Channel;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Configuration;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Security;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Enforcement;

internal interface IV3SignedDriverAttestationSource
{
  ValueTask<SignedPrivilegedCommandDriverAttestationV2> AttestAsync(
    string challengeNonceSha256,
    NetworkIsolationHealthV3 health,
    WindowsIsolationHostPosture posture,
    PrivilegedCommandSupervisorOptions options,
    string operatingSystemBootId,
    CancellationToken cancellationToken);
}

internal interface IWindowsIsolationHostPostureSource
{
  WindowsIsolationHostPosture GetVerified(
    PrivilegedCommandSupervisorOptions options);
}

internal sealed class WindowsIsolationHostPostureSource :
  IWindowsIsolationHostPostureSource
{
  public WindowsIsolationHostPosture GetVerified(
    PrivilegedCommandSupervisorOptions options) =>
    WindowsIsolationHostPostureVerifier.GetVerified(options);
}

/// <summary>
/// The frozen network driver intentionally has no signing key or attestation
/// IOCTL. Until a separately provisioned, hardware-backed signer is connected,
/// production remains safe-off after completing v3 protocol/health validation.
/// Tests inject a signer to prove that the existing signed-v2 verifier remains
/// mandatory; this fallback never fabricates or downgrades signed evidence.
/// </summary>
internal sealed class UnavailableV3SignedDriverAttestationSource :
  IV3SignedDriverAttestationSource
{
  public ValueTask<SignedPrivilegedCommandDriverAttestationV2> AttestAsync(
    string challengeNonceSha256,
    NetworkIsolationHealthV3 health,
    WindowsIsolationHostPosture posture,
    PrivilegedCommandSupervisorOptions options,
    string operatingSystemBootId,
    CancellationToken cancellationToken) =>
    ValueTask.FromException<SignedPrivilegedCommandDriverAttestationV2>(
      new UnauthorizedAccessException(
        "The v3 driver signed-attestation authority is not provisioned."));
}

/// <summary>
/// High-level signed v2 lifecycle backed by the frozen binary v3 network
/// driver. Attestation maps to GET_PROTOCOL + nonce-bound GET_HEALTH plus the
/// unchanged signed attestation verifier. Bind maps to a supervisor-owned
/// nested kill-on-close job, deny-all REPLACE_POLICY, and ENROLL_PROCESS.
/// Settle/recovery prove or terminate that job before REMOVE_PROCESS and a
/// final GET_HEALTH. Any uncertain transition latches SET_KILL_STATE, closes
/// the sole driver handle, and terminates all supervisor-owned jobs.
/// </summary>
public sealed class WindowsKernelIsolationDriverClient :
  IPrivilegedCommandKernelEnforcer
{
  private readonly PrivilegedCommandSupervisorOptions _options;
  private readonly IBootIdentity _bootIdentity;
  private readonly IDriverAttestationVerificationKeyResolver _attestationKeys;
  private readonly IV3SignedDriverAttestationSource _attestationSource;
  private readonly IWindowsIsolationHostPostureSource _postureSource;
  private readonly NetworkIsolationDriverSessionV3 _driver;
  private readonly IPrivilegedCommandProcessLeaseFactory _processLeases;
  private readonly SemaphoreSlim _lifecycleGate = new(1, 1);
  private readonly Dictionary<string, ActiveLease> _active = new(
    StringComparer.Ordinal);
  private readonly Dictionary<string, KernelIsolationTerminalEvidence> _terminal = new(
    StringComparer.Ordinal);
  private KernelIsolationAttestation? _lastAttestation;
  private int _unavailable;
  private int _disposed;

  public WindowsKernelIsolationDriverClient(
    PrivilegedCommandSupervisorOptions options,
    IBootIdentity bootIdentity,
    IDriverAttestationVerificationKeyResolver attestationKeys)
  {
    ArgumentNullException.ThrowIfNull(options);
    ArgumentNullException.ThrowIfNull(bootIdentity);
    ArgumentNullException.ThrowIfNull(attestationKeys);
    RuntimeMeasurementVerifier.VerifyDriverImage(
      options.DriverImagePath,
      options.DriverMeasurementSha256);
    _options = options;
    _bootIdentity = bootIdentity;
    _attestationKeys = attestationKeys;
    _attestationSource = new UnavailableV3SignedDriverAttestationSource();
    _postureSource = new WindowsIsolationHostPostureSource();
    _driver = new NetworkIsolationDriverSessionV3(
      new WindowsNetworkIsolationDeviceTransport(
        options.DriverDevicePath,
        options.DriverOperationTimeout),
      options.DriverMeasurementSha256);
    _processLeases = new WindowsPrivilegedCommandProcessLeaseFactory(
      options.DriverOperationTimeout);
  }

  internal WindowsKernelIsolationDriverClient(
    PrivilegedCommandSupervisorOptions options,
    IBootIdentity bootIdentity,
    IDriverAttestationVerificationKeyResolver attestationKeys,
    IV3SignedDriverAttestationSource attestationSource,
    IWindowsIsolationHostPostureSource postureSource,
    NetworkIsolationDriverSessionV3 driver,
    IPrivilegedCommandProcessLeaseFactory processLeases)
  {
    _options = options ?? throw new ArgumentNullException(nameof(options));
    _bootIdentity = bootIdentity ?? throw new ArgumentNullException(nameof(bootIdentity));
    _attestationKeys = attestationKeys
      ?? throw new ArgumentNullException(nameof(attestationKeys));
    _attestationSource = attestationSource
      ?? throw new ArgumentNullException(nameof(attestationSource));
    _postureSource = postureSource ?? throw new ArgumentNullException(nameof(postureSource));
    _driver = driver ?? throw new ArgumentNullException(nameof(driver));
    _processLeases = processLeases
      ?? throw new ArgumentNullException(nameof(processLeases));
  }

  public async ValueTask<KernelIsolationAttestation> AttestAsync(
    CancellationToken cancellationToken)
  {
    await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureAvailable();
      var posture = _postureSource.GetVerified(_options);
      var health = await _driver.GetVerifiedHealthAsync(cancellationToken)
        .ConfigureAwait(false);
      var nonce = RandomNumberGenerator.GetBytes(32);
      try
      {
        var nonceSha256 = Convert.ToHexString(SHA256.HashData(nonce))
          .ToLowerInvariant();
        var signed = await _attestationSource.AttestAsync(
          nonceSha256,
          health,
          posture,
          _options,
          _bootIdentity.BootId,
          cancellationToken).ConfigureAwait(false);
        if (!string.Equals(
          signed.Evidence.SignaturePurpose,
          PrivilegedCommandIsolationSignaturePurposes.DriverAttestation,
          StringComparison.Ordinal))
        {
          throw new UnauthorizedAccessException(
            "The v3 attestation source returned the wrong signature purpose.");
        }
        SignedDriverAttestationValidator.Validate(
          signed,
          nonceSha256,
          posture,
          _options,
          _bootIdentity.BootId,
          _attestationKeys,
          DateTimeOffset.UtcNow);
        var evidence = signed.Evidence;
        var attestation = new KernelIsolationAttestation(
          evidence.DeviceId,
          evidence.BootId,
          evidence.IsolationPolicySha256,
          evidence.DriverMeasurementSha256,
          evidence.ServiceMeasurementSha256,
          evidence.SupervisorInstanceId,
          evidence.PolicyEpoch,
          evidence.DriverServiceName,
          evidence.DriverImagePathSha256,
          evidence.SecureBootEnabled,
          evidence.HvciEnabled,
          evidence.WdacEnforced,
          evidence.EnforcedFeatures,
          PrivilegedCommandIsolationCanonical.DriverAttestationSha256(evidence),
          signed);
        _lastAttestation = attestation;
        return attestation;
      }
      finally
      {
        CryptographicOperations.ZeroMemory(nonce);
      }
    }
    catch
    {
      Interlocked.Exchange(ref _unavailable, 1);
      throw;
    }
    finally
    {
      _lifecycleGate.Release();
    }
  }

  public async ValueTask<KernelIsolationBinding> BindSuspendedProcessAsync(
    PrivilegedCommandIsolationReservationRequestV1 request,
    SuspendedProcessObservation observation,
    PrivilegedCommandIsolationInvocationV2 invocation,
    PipePeerIdentity peer,
    CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(request);
    ArgumentNullException.ThrowIfNull(observation);
    ArgumentNullException.ThrowIfNull(invocation);
    ArgumentNullException.ThrowIfNull(peer);
    await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
    IPrivilegedCommandProcessLease? processLease = null;
    try
    {
      EnsureAvailable();
      RequireCurrentAttestation();
      var enforcementLeaseId = NetworkIsolationProtocolV3.DeriveRequestId(
        "enforcement-lease",
        request.RequestId).ToString("D");
      if (_active.TryGetValue(enforcementLeaseId, out var replay))
      {
        if (!string.Equals(
          replay.ReservationRequestSha256,
          PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
          StringComparison.Ordinal))
        {
          throw new InvalidOperationException(
            "An enforcement lease ID was reused for a different reservation.");
        }
        return replay.Binding;
      }

      var nowFileTime = checked((ulong)DateTime.UtcNow.ToFileTimeUtc());
      var seconds = Math.Clamp(
        checked(invocation.EffectiveTimeoutSeconds + 60),
        120,
        7_190);
      var expiresAt = checked(nowFileTime + (checked((ulong)seconds) * 10_000_000UL));
      var policy = await _driver.EnsureDenyAllPolicyAsync(
        expiresAt,
        NetworkIsolationProtocolV3.DeriveRequestId("deny-policy", request.RequestId),
        cancellationToken).ConfigureAwait(false);
      processLease = await _processLeases.AcquireAsync(
        observation,
        invocation,
        expiresAt,
        cancellationToken).ConfigureAwait(false);
      var enrollmentResponse = await _driver.EnrollProcessAsync(
        processLease.Enrollment,
        NetworkIsolationProtocolV3.DeriveRequestId("enroll", request.RequestId),
        cancellationToken).ConfigureAwait(false);
      var evidenceSha256 = BindingEvidenceSha256(
        request,
        observation,
        invocation,
        processLease,
        policy,
        enrollmentResponse);
      var binding = new KernelIsolationBinding(
        enforcementLeaseId,
        processLease.JobObjectId.ToString("D"),
        processLease.JobObjectIdentitySha256,
        observation.ImagePathSha256,
        observation.ImageSha256,
        observation.ImageVolumeSerialNumber,
        observation.ImageFileId,
        observation.CommandLineSha256,
        observation.WorkingDirectorySha256,
        observation.EnvironmentBlockSha256,
        observation.InvocationSha256,
        observation.CreatedSuspended,
        AssignedToJob: true,
        KernelEnforcementActive: true,
        _lastAttestation!.EnforcedFeatures,
        evidenceSha256);
      _active.Add(
        enforcementLeaseId,
        new ActiveLease(
          PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
          processLease,
          binding,
          policy.CurrentPolicyGeneration,
          policy.CurrentPolicySha256));
      processLease = null;
      return binding;
    }
    catch
    {
      if (processLease is not null)
      {
        await BestEffortTerminateAsync(processLease).ConfigureAwait(false);
      }
      await TripKillAsync("bind").ConfigureAwait(false);
      throw;
    }
    finally
    {
      _lifecycleGate.Release();
    }
  }

  public ValueTask<KernelIsolationTerminalEvidence> SettleAsync(
    string enforcementLeaseId,
    PrivilegedCommandSuspendedProcessBindingV1 binding,
    TerminalObservation requestedObservation,
    CancellationToken cancellationToken) => SettleCoreAsync(
      enforcementLeaseId,
      binding,
      requestedObservation,
      recovery: false,
      cancellationToken);

  public ValueTask<KernelIsolationTerminalEvidence> RecoverAndTerminateAsync(
    string enforcementLeaseId,
    PrivilegedCommandSuspendedProcessBindingV1 binding,
    CancellationToken cancellationToken) => SettleCoreAsync(
      enforcementLeaseId,
      binding,
      new TerminalObservation(
        ProcessResumed: false,
        ExitCodeKnown: false,
        ExitCode: 0,
        PrivilegedCommandIsolationTerminalOutcomes.Cancelled),
      recovery: true,
      cancellationToken);

  public async ValueTask DisposeAsync()
  {
    if (Interlocked.Exchange(ref _disposed, 1) != 0)
    {
      return;
    }
    Interlocked.Exchange(ref _unavailable, 1);
    await _lifecycleGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
    try
    {
      await TripKillAsync("dispose").ConfigureAwait(false);
      foreach (var lease in _active.Values)
      {
        await BestEffortTerminateAsync(lease.ProcessLease).ConfigureAwait(false);
      }
      _active.Clear();
      await _driver.DisposeAsync().ConfigureAwait(false);
    }
    finally
    {
      _lifecycleGate.Release();
      _lifecycleGate.Dispose();
    }
  }

  private async ValueTask<KernelIsolationTerminalEvidence> SettleCoreAsync(
    string enforcementLeaseId,
    PrivilegedCommandSuspendedProcessBindingV1 binding,
    TerminalObservation requestedObservation,
    bool recovery,
    CancellationToken cancellationToken)
  {
    ArgumentException.ThrowIfNullOrWhiteSpace(enforcementLeaseId);
    ArgumentNullException.ThrowIfNull(binding);
    ArgumentNullException.ThrowIfNull(requestedObservation);
    await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureAvailable();
      if (_terminal.TryGetValue(enforcementLeaseId, out var replay))
      {
        return replay;
      }
      if (!_active.TryGetValue(enforcementLeaseId, out var active))
      {
        throw new InvalidOperationException(
          "The v3 enforcement lease is not active in this supervisor instance.");
      }
      var terminal = await active.ProcessLease.EnsureTerminalAsync(
        recovery,
        cancellationToken).ConfigureAwait(false);
      if (!terminal.ProcessTreeTerminal)
      {
        throw new UnauthorizedAccessException(
          "The supervisor-owned process tree is not terminal.");
      }
      var removal = await _driver.RemoveProcessAsync(
        active.ProcessLease.Enrollment.ProcessId,
        active.ProcessLease.Enrollment.ProcessIdentitySha256,
        NetworkIsolationProtocolV3.DeriveRequestId(
          "remove",
          enforcementLeaseId),
        cancellationToken).ConfigureAwait(false);
      var health = await _driver.GetVerifiedHealthAsync(cancellationToken)
        .ConfigureAwait(false);
      var policyContinuous = health.CurrentPolicyGeneration == active.PolicyGeneration
        && CryptographicOperations.FixedTimeEquals(
          health.CurrentPolicySha256,
          active.PolicySha256);
      var endedAt = terminal.EndedAtUnixMilliseconds;
      var processResumed = !recovery && requestedObservation.ProcessResumed;
      var exitCodeKnown = !recovery
        && requestedObservation.ExitCodeKnown
        && terminal.ExitCodeKnown;
      var exitCode = exitCodeKnown ? terminal.ExitCode : 0;
      var outcome = recovery
        ? PrivilegedCommandIsolationTerminalOutcomes.Cancelled
        : requestedObservation.Outcome;
      var evidence = new KernelIsolationTerminalEvidence(
        processResumed,
        processResumed ? endedAt : 0,
        endedAt,
        ProcessTreeTerminal: true,
        EnforcementContinuous: policyContinuous,
        exitCodeKnown,
        exitCode,
        TerminalEvidenceSha256(active, removal, health, terminal, outcome),
        outcome);
      _active.Remove(enforcementLeaseId);
      _terminal.Add(enforcementLeaseId, evidence);
      await active.ProcessLease.DisposeAsync().ConfigureAwait(false);
      return evidence;
    }
    catch
    {
      await TripKillAsync(recovery ? "recover" : "settle").ConfigureAwait(false);
      throw;
    }
    finally
    {
      _lifecycleGate.Release();
    }
  }

  private void RequireCurrentAttestation()
  {
    if (_lastAttestation is null
      || !_lastAttestation.EnforcedFeatures.SequenceEqual(
        PrivilegedCommandIsolationFeatures.Required,
        StringComparer.Ordinal))
    {
      throw new UnauthorizedAccessException(
        "A verified signed-v2 attestation is required before v3 binding.");
    }
  }

  private async ValueTask TripKillAsync(string purpose)
  {
    Interlocked.Exchange(ref _unavailable, 1);
    try
    {
      using var timeout = new CancellationTokenSource(_options.DriverOperationTimeout);
      await _driver.KillAsync(
        NetworkIsolationProtocolV3.DeriveRequestId(
          "kill",
          $"{_options.SupervisorInstanceId}:{purpose}"),
        KillReasonIntegrityFailure,
        timeout.Token).ConfigureAwait(false);
    }
    catch
    {
      // Closing the exclusive device handle in DisposeAsync remains the
      // independent driver-side latched-kill signal.
    }
    foreach (var active in _active.Values)
    {
      await BestEffortTerminateAsync(active.ProcessLease).ConfigureAwait(false);
    }
  }

  private static async ValueTask BestEffortTerminateAsync(
    IPrivilegedCommandProcessLease lease)
  {
    try
    {
      using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
      _ = await lease.EnsureTerminalAsync(terminate: true, timeout.Token)
        .ConfigureAwait(false);
    }
    catch
    {
      // Dispose closes the kill-on-close job even if explicit termination did
      // not produce a trustworthy receipt.
    }
    await lease.DisposeAsync().ConfigureAwait(false);
  }

  private static string BindingEvidenceSha256(
    PrivilegedCommandIsolationReservationRequestV1 request,
    SuspendedProcessObservation observation,
    PrivilegedCommandIsolationInvocationV2 invocation,
    IPrivilegedCommandProcessLease lease,
    NetworkIsolationHealthV3 health,
    NetworkIsolationMutationResponseV3 enrollment)
  {
    var canonical = Encoding.UTF8.GetBytes(string.Join('\n',
      "MSAIDIZI-NETWORK-V3-BINDING-V1",
      PrivilegedCommandIsolationCanonical.ReservationRequestSha256(request),
      observation.InvocationSha256,
      PrivilegedCommandIsolationCanonical.InvocationSha256(invocation),
      lease.JobObjectId.ToString("D"),
      lease.JobObjectIdentitySha256,
      health.CurrentPolicyGeneration,
      Convert.ToHexString(health.CurrentPolicySha256).ToLowerInvariant(),
      enrollment.AppliedRequestSequence,
      Convert.ToHexString(lease.Enrollment.ProcessIdentitySha256)
        .ToLowerInvariant()));
    try
    {
      return Convert.ToHexString(SHA256.HashData(canonical)).ToLowerInvariant();
    }
    finally
    {
      CryptographicOperations.ZeroMemory(canonical);
    }
  }

  private static string TerminalEvidenceSha256(
    ActiveLease active,
    NetworkIsolationMutationResponseV3 removal,
    NetworkIsolationHealthV3 health,
    PrivilegedCommandProcessTerminalFacts terminal,
    string outcome)
  {
    var canonical = Encoding.UTF8.GetBytes(string.Join('\n',
      "MSAIDIZI-NETWORK-V3-TERMINAL-V1",
      active.Binding.EnforcementLeaseId,
      active.Binding.EnforcementEvidenceSha256,
      removal.AppliedRequestSequence,
      health.CurrentPolicyGeneration,
      Convert.ToHexString(health.CurrentPolicySha256).ToLowerInvariant(),
      terminal.ProcessTreeTerminal,
      terminal.ExitCodeKnown,
      terminal.ExitCode,
      terminal.EndedAtUnixMilliseconds,
      outcome));
    try
    {
      return Convert.ToHexString(SHA256.HashData(canonical)).ToLowerInvariant();
    }
    finally
    {
      CryptographicOperations.ZeroMemory(canonical);
    }
  }

  private void EnsureAvailable()
  {
    ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
    if (Volatile.Read(ref _unavailable) != 0)
    {
      throw new IOException("The v3 privileged-command isolation client is unavailable.");
    }
  }

  private const uint KillReasonIntegrityFailure = 1;

  private sealed record ActiveLease(
    string ReservationRequestSha256,
    IPrivilegedCommandProcessLease ProcessLease,
    KernelIsolationBinding Binding,
    ulong PolicyGeneration,
    byte[] PolicySha256);
}
