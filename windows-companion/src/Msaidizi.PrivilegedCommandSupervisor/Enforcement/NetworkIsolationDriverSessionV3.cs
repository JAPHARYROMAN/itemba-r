using System.Security.Cryptography;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Enforcement;

internal interface INetworkIsolationDeviceTransport : IAsyncDisposable
{
  ValueTask<byte[]> ExchangeAsync(
    uint controlCode,
    ReadOnlyMemory<byte> input,
    int expectedOutputBytes,
    CancellationToken cancellationToken);
}

internal sealed class NetworkIsolationDriverException : UnauthorizedAccessException
{
  public NetworkIsolationDriverException(uint status, uint detail)
    : base($"network_isolation_driver_refused:{StatusName(status)}:0x{detail:x8}")
  {
    Status = status;
    Detail = detail;
  }

  public uint Status { get; }

  public uint Detail { get; }

  private static string StatusName(uint status) => status switch
  {
    NetworkIsolationProtocolV3.StatusInvalidFrame => "invalid_frame",
    NetworkIsolationProtocolV3.StatusVersionMismatch => "version_mismatch",
    NetworkIsolationProtocolV3.StatusAccessDenied => "access_denied",
    NetworkIsolationProtocolV3.StatusBootMismatch => "boot_mismatch",
    NetworkIsolationProtocolV3.StatusReplay => "replay",
    NetworkIsolationProtocolV3.StatusStaleGeneration => "stale_generation",
    NetworkIsolationProtocolV3.StatusKillActive => "kill_active",
    NetworkIsolationProtocolV3.StatusPolicyInvalid => "policy_invalid",
    NetworkIsolationProtocolV3.StatusProcessIdentityMismatch =>
      "process_identity_mismatch",
    NetworkIsolationProtocolV3.StatusProcessNotFound => "process_not_found",
    NetworkIsolationProtocolV3.StatusCapacity => "capacity",
    NetworkIsolationProtocolV3.StatusInternalError => "internal_error",
    NetworkIsolationProtocolV3.StatusLegacyNotProvisioned =>
      "legacy_not_provisioned",
    _ => "unknown_status",
  };
}

/// <summary>
/// Stateful v3 driver session. The sole device handle is the security lease.
/// It serializes all exchanges, starts its monotonic sequence from nonce-bound
/// live health, rejects stale/replayed outcomes without retry, and caches only
/// exact successful mutations for caller idempotency.
/// </summary>
internal sealed class NetworkIsolationDriverSessionV3 : IAsyncDisposable
{
  private readonly INetworkIsolationDeviceTransport _transport;
  private readonly byte[] _expectedDriverMeasurementSha256;
  private readonly SemaphoreSlim _gate = new(1, 1);
  private readonly Dictionary<Guid, CachedMutation> _successfulMutations = [];
  private NetworkIsolationProtocolDescriptorV3? _protocol;
  private NetworkIsolationHealthV3? _health;
  private ulong _lastRequestSequence;
  private int _unavailable;
  private int _disposed;

  public NetworkIsolationDriverSessionV3(
    INetworkIsolationDeviceTransport transport,
    string expectedDriverMeasurementSha256)
  {
    ArgumentNullException.ThrowIfNull(transport);
    if (!IsCanonicalSha256(expectedDriverMeasurementSha256))
    {
      throw new ArgumentException(
        "The expected driver measurement must be canonical SHA-256.",
        nameof(expectedDriverMeasurementSha256));
    }
    _transport = transport;
    _expectedDriverMeasurementSha256 = Convert.FromHexString(
      expectedDriverMeasurementSha256);
  }

  public async ValueTask<NetworkIsolationHealthV3> GetVerifiedHealthAsync(
    CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureAvailable();
      await EnsureProtocolCoreAsync(cancellationToken).ConfigureAwait(false);
      return await GetVerifiedHealthCoreAsync(cancellationToken).ConfigureAwait(false);
    }
    catch
    {
      Interlocked.Exchange(ref _unavailable, 1);
      throw;
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<NetworkIsolationHealthV3> EnsureDenyAllPolicyAsync(
    ulong minimumExpiryFileTime100ns,
    Guid requestId,
    CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureAvailable();
      await EnsureProtocolCoreAsync(cancellationToken).ConfigureAwait(false);
      var health = await GetVerifiedHealthCoreAsync(cancellationToken).ConfigureAwait(false);
      if ((health.HealthFlags & NetworkIsolationProtocolV3.HealthPolicyActive) != 0
        && health.PolicyEntryCount == 0
        && health.PolicyExpiresAtFileTime100ns >= minimumExpiryFileTime100ns
        && health.CurrentPolicyGeneration != 0
        && health.CurrentPolicySha256.AsSpan().IndexOfAnyExcept((byte)0) >= 0)
      {
        return health;
      }
      if (health.EnrolledProcessCount != 0)
      {
        throw new InvalidOperationException(
          "A live v3 policy cannot be replaced while enrolled process identities remain.");
      }

      var generation = checked(health.CurrentPolicyGeneration + 1);
      var sequence = NextSequence();
      var request = NetworkIsolationProtocolV3.CreatePolicyReplaceRequest(
        sequence,
        generation,
        requestId,
        _protocol!.BootId,
        minimumExpiryFileTime100ns,
        Array.Empty<NetworkIsolationPolicyEntryV3>(),
        out var policySha256);
      try
      {
        var response = await ExchangeMutationCoreAsync(
          NetworkIsolationProtocolV3.IoctlReplacePolicy,
          requestId,
          sequence,
          generation,
          request,
          cancellationToken).ConfigureAwait(false);
        RequireAccepted(response, sequence);
        if (response.CurrentPolicyGeneration != generation
          || !CryptographicOperations.FixedTimeEquals(
            response.CurrentPolicySha256,
            policySha256))
        {
          throw new InvalidDataException(
            "The v3 policy replacement response does not bind the exact deny-all policy.");
        }
        return await GetVerifiedHealthCoreAsync(cancellationToken).ConfigureAwait(false);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(policySha256);
        CryptographicOperations.ZeroMemory(request);
      }
    }
    catch
    {
      Interlocked.Exchange(ref _unavailable, 1);
      throw;
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<NetworkIsolationMutationResponseV3> EnrollProcessAsync(
    NetworkIsolationProcessEnrollmentV3 enrollment,
    Guid requestId,
    CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(enrollment);
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureAvailable();
      await EnsureProtocolCoreAsync(cancellationToken).ConfigureAwait(false);
      var health = await GetVerifiedHealthCoreAsync(cancellationToken).ConfigureAwait(false);
      if ((health.HealthFlags & NetworkIsolationProtocolV3.HealthPolicyActive) == 0
        || health.CurrentPolicyGeneration == 0
        || enrollment.ExpiresAtFileTime100ns > health.PolicyExpiresAtFileTime100ns)
      {
        throw new InvalidOperationException(
          "The process enrollment is not contained by the live v3 policy.");
      }
      var semanticRequest = NetworkIsolationProtocolV3.CreateEnrollmentRequest(
        0,
        health.CurrentPolicyGeneration,
        requestId,
        _protocol!.BootId,
        enrollment);
      var semanticSha256 = SHA256.HashData(semanticRequest);
      CryptographicOperations.ZeroMemory(semanticRequest);
      if (TryGetSuccessfulMutation(requestId, semanticSha256, out var replay))
      {
        CryptographicOperations.ZeroMemory(semanticSha256);
        return replay;
      }
      var sequence = NextSequence();
      var request = NetworkIsolationProtocolV3.CreateEnrollmentRequest(
        sequence,
        health.CurrentPolicyGeneration,
        requestId,
        _protocol!.BootId,
        enrollment);
      try
      {
        var response = await ExchangeMutationCoreAsync(
          NetworkIsolationProtocolV3.IoctlEnrollProcess,
          requestId,
          sequence,
          health.CurrentPolicyGeneration,
          request,
          cancellationToken).ConfigureAwait(false);
        RequireAccepted(response, sequence);
        if (response.CurrentPolicyGeneration != health.CurrentPolicyGeneration
          || !CryptographicOperations.FixedTimeEquals(
            response.CurrentPolicySha256,
            health.CurrentPolicySha256))
        {
          throw new InvalidDataException(
            "The v3 enrollment response changed the bound policy identity.");
        }
        RememberSuccessfulMutation(requestId, semanticSha256, response);
        return response;
      }
      finally
      {
        CryptographicOperations.ZeroMemory(semanticSha256);
        CryptographicOperations.ZeroMemory(request);
      }
    }
    catch
    {
      Interlocked.Exchange(ref _unavailable, 1);
      throw;
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<NetworkIsolationMutationResponseV3> RemoveProcessAsync(
    ulong processId,
    ReadOnlyMemory<byte> processIdentitySha256,
    Guid requestId,
    CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureAvailable();
      await EnsureProtocolCoreAsync(cancellationToken).ConfigureAwait(false);
      var health = await GetVerifiedHealthCoreAsync(cancellationToken).ConfigureAwait(false);
      if ((health.HealthFlags & NetworkIsolationProtocolV3.HealthPolicyActive) == 0
        || health.CurrentPolicyGeneration == 0)
      {
        throw new InvalidOperationException(
          "No live v3 policy exists for process removal.");
      }
      var semanticRequest = NetworkIsolationProtocolV3.CreateRemovalRequest(
        0,
        health.CurrentPolicyGeneration,
        requestId,
        _protocol!.BootId,
        processId,
        processIdentitySha256.Span);
      var semanticSha256 = SHA256.HashData(semanticRequest);
      CryptographicOperations.ZeroMemory(semanticRequest);
      if (TryGetSuccessfulMutation(requestId, semanticSha256, out var replay))
      {
        CryptographicOperations.ZeroMemory(semanticSha256);
        return replay;
      }
      var sequence = NextSequence();
      var request = NetworkIsolationProtocolV3.CreateRemovalRequest(
        sequence,
        health.CurrentPolicyGeneration,
        requestId,
        _protocol!.BootId,
        processId,
        processIdentitySha256.Span);
      try
      {
        var response = await ExchangeMutationCoreAsync(
          NetworkIsolationProtocolV3.IoctlRemoveProcess,
          requestId,
          sequence,
          health.CurrentPolicyGeneration,
          request,
          cancellationToken).ConfigureAwait(false);
        RequireAccepted(response, sequence);
        RememberSuccessfulMutation(requestId, semanticSha256, response);
        return response;
      }
      finally
      {
        CryptographicOperations.ZeroMemory(semanticSha256);
        CryptographicOperations.ZeroMemory(request);
      }
    }
    catch
    {
      Interlocked.Exchange(ref _unavailable, 1);
      throw;
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask KillAsync(
    Guid requestId,
    uint reasonCode,
    CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
      if (_protocol is null)
      {
        return;
      }
      var health = _health;
      var killGeneration = checked((health?.KillGeneration ?? 0) + 1);
      var sequence = NextSequence();
      var request = NetworkIsolationProtocolV3.CreateKillRequest(
        sequence,
        requestId,
        _protocol.BootId,
        killGeneration,
        reasonCode);
      try
      {
        var response = await ExchangeMutationCoreAsync(
          NetworkIsolationProtocolV3.IoctlSetKillState,
          requestId,
          sequence,
          0,
          request,
          cancellationToken).ConfigureAwait(false);
        RequireAccepted(response, sequence);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(request);
      }
    }
    finally
    {
      Interlocked.Exchange(ref _unavailable, 1);
      _gate.Release();
    }
  }

  public async ValueTask DisposeAsync()
  {
    if (Interlocked.Exchange(ref _disposed, 1) != 0)
    {
      return;
    }
    Interlocked.Exchange(ref _unavailable, 1);
    try
    {
      await _transport.DisposeAsync().ConfigureAwait(false);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(_expectedDriverMeasurementSha256);
      _gate.Dispose();
    }
  }

  private async ValueTask EnsureProtocolCoreAsync(CancellationToken cancellationToken)
  {
    if (_protocol is not null)
    {
      return;
    }
    var requestId = Guid.NewGuid();
    var request = NetworkIsolationProtocolV3.CreateProtocolRequest(requestId);
    try
    {
      var response = await _transport.ExchangeAsync(
        NetworkIsolationProtocolV3.IoctlGetProtocol,
        request,
        NetworkIsolationProtocolV3.ProtocolResponseSize,
        cancellationToken).ConfigureAwait(false);
      try
      {
        _protocol = NetworkIsolationProtocolV3.ParseProtocolResponse(response, requestId);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(response);
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(request);
    }
  }

  private async ValueTask<NetworkIsolationHealthV3> GetVerifiedHealthCoreAsync(
    CancellationToken cancellationToken)
  {
    var requestId = Guid.NewGuid();
    var challenge = RandomNumberGenerator.GetBytes(32);
    var request = NetworkIsolationProtocolV3.CreateHealthRequest(
      requestId,
      _protocol!.BootId,
      challenge);
    try
    {
      var response = await _transport.ExchangeAsync(
        NetworkIsolationProtocolV3.IoctlGetHealth,
        request,
        NetworkIsolationProtocolV3.HealthResponseSize,
        cancellationToken).ConfigureAwait(false);
      NetworkIsolationHealthV3 health;
      try
      {
        health = NetworkIsolationProtocolV3.ParseHealthResponse(
          response,
          requestId,
          _protocol.BootId,
          challenge);
      }
      finally
      {
        CryptographicOperations.ZeroMemory(response);
      }
      RequireReadyHealth(health);
      if (health.LastAcceptedRequestSequence < _lastRequestSequence)
      {
        throw new InvalidDataException(
          "The v3 health sequence moved backwards.");
      }
      _lastRequestSequence = health.LastAcceptedRequestSequence;
      _health = health;
      return health;
    }
    finally
    {
      CryptographicOperations.ZeroMemory(challenge);
      CryptographicOperations.ZeroMemory(request);
    }
  }

  private async ValueTask<NetworkIsolationMutationResponseV3>
    ExchangeMutationCoreAsync(
      uint controlCode,
      Guid requestId,
      ulong sequence,
      ulong headerPolicyGeneration,
      byte[] request,
      CancellationToken cancellationToken)
  {
    var bytes = await _transport.ExchangeAsync(
      controlCode,
      request,
      NetworkIsolationProtocolV3.MutationResponseSize,
      cancellationToken).ConfigureAwait(false);
    try
    {
      return NetworkIsolationProtocolV3.ParseMutationResponse(
        bytes,
        requestId,
        _protocol!.BootId,
        sequence,
        headerPolicyGeneration);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(bytes);
    }
  }

  private bool TryGetSuccessfulMutation(
    Guid requestId,
    ReadOnlySpan<byte> semanticSha256,
    out NetworkIsolationMutationResponseV3 response)
  {
    if (!_successfulMutations.TryGetValue(requestId, out var cached))
    {
      response = null!;
      return false;
    }
    if (!CryptographicOperations.FixedTimeEquals(
      semanticSha256,
      cached.RequestSha256))
    {
      throw new InvalidOperationException(
        "A v3 idempotency request ID was reused for a different semantic mutation.");
    }
    response = cached.Response;
    return true;
  }

  private void RememberSuccessfulMutation(
    Guid requestId,
    ReadOnlySpan<byte> semanticSha256,
    NetworkIsolationMutationResponseV3 response)
  {
    _successfulMutations.Add(
      requestId,
      new CachedMutation(semanticSha256.ToArray(), response));
  }

  private void RequireReadyHealth(NetworkIsolationHealthV3 health)
  {
    const uint requiredFlags = NetworkIsolationProtocolV3.HealthWfpRegistered
      | NetworkIsolationProtocolV3.HealthDriverMeasurementProvisioned
      | NetworkIsolationProtocolV3.HealthBootMeasurementProvisioned;
    if (health.Status != NetworkIsolationProtocolV3.StatusOk
      || (health.HealthFlags & requiredFlags) != requiredFlags
      || (health.HealthFlags & (NetworkIsolationProtocolV3.HealthKillActive
        | NetworkIsolationProtocolV3.HealthUnloading)) != 0
      || health.BootTimeFileTime100ns == 0
      || health.CalloutIdV4 == 0
      || health.CalloutIdV6 == 0
      || health.BootMeasurementSha256.AsSpan().IndexOfAnyExcept((byte)0) < 0
      || !CryptographicOperations.FixedTimeEquals(
        health.DriverImageSha256,
        _expectedDriverMeasurementSha256))
    {
      throw new UnauthorizedAccessException(
        "The v3 network-isolation driver health or measurement posture is incomplete.");
    }
  }

  private ulong NextSequence()
  {
    _lastRequestSequence = checked(_lastRequestSequence + 1);
    return _lastRequestSequence;
  }

  private static void RequireAccepted(
    NetworkIsolationMutationResponseV3 response,
    ulong expectedSequence)
  {
    if (response.Status != NetworkIsolationProtocolV3.StatusOk)
    {
      throw new NetworkIsolationDriverException(response.Status, response.ErrorDetail);
    }
    if (response.AppliedRequestSequence != expectedSequence)
    {
      throw new InvalidDataException(
        "The v3 driver did not commit the exact monotonic request sequence.");
    }
  }

  private void EnsureAvailable()
  {
    ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
    if (Volatile.Read(ref _unavailable) != 0)
    {
      throw new IOException("The v3 network-isolation session is unavailable.");
    }
  }

  private static bool IsCanonicalSha256(string value) =>
    value.Length == 64
    && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');

  private sealed record CachedMutation(
    byte[] RequestSha256,
    NetworkIsolationMutationResponseV3 Response);
}
