using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Contracts.SessionBridge;
using Itemba.Msaidizi.EgressSupervisor.Persistence;
using Itemba.Msaidizi.EgressSupervisor.Security;
using Itemba.Msaidizi.EgressSupervisor.Transport;

namespace Itemba.Msaidizi.EgressSupervisor.Core;

public sealed class EgressSupervisorException : Exception
{
  public EgressSupervisorException(string code, bool mayHaveEgressed = false)
    : base(code)
  {
    Code = code;
    MayHaveEgressed = mayHaveEgressed;
  }

  public string Code { get; }

  public bool MayHaveEgressed { get; }
}

public interface IEgressProcessIdentityVerifier
{
  bool IsExactLiveProcess(int processId, long creationTimeUnixMilliseconds);

  bool IsExactMeasuredProcess(
    int processId,
    long creationTimeUnixMilliseconds,
    string expectedImagePath,
    string expectedImageSha256) => false;
}

public sealed class WindowsEgressProcessIdentityVerifier : IEgressProcessIdentityVerifier
{
  public bool IsExactLiveProcess(int processId, long creationTimeUnixMilliseconds)
  {
    if (!OperatingSystem.IsWindows() || processId <= 0 || creationTimeUnixMilliseconds <= 0)
    {
      return false;
    }

    try
    {
      using var process = Process.GetProcessById(processId);
      return !process.HasExited
        && new DateTimeOffset(process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()
          == creationTimeUnixMilliseconds;
    }
    catch (Exception exception) when (exception is ArgumentException
      or InvalidOperationException
      or NotSupportedException
      or SystemException)
    {
      return false;
    }
  }

  public bool IsExactMeasuredProcess(
    int processId,
    long creationTimeUnixMilliseconds,
    string expectedImagePath,
    string expectedImageSha256)
  {
    if (!IsExactLiveProcess(processId, creationTimeUnixMilliseconds)
      || string.IsNullOrWhiteSpace(expectedImagePath)
      || !Path.IsPathFullyQualified(expectedImagePath)
      || expectedImagePath.StartsWith("\\\\", StringComparison.Ordinal)
      || expectedImageSha256.Length != 64
      || !expectedImageSha256.All(character =>
        character is >= '0' and <= '9' or >= 'a' and <= 'f'))
    {
      return false;
    }

    try
    {
      using var process = Process.GetProcessById(processId);
      var observedPath = process.MainModule?.FileName;
      if (observedPath is null
        || !string.Equals(
          Path.GetFullPath(observedPath),
          Path.GetFullPath(expectedImagePath),
          StringComparison.OrdinalIgnoreCase)
        || (File.GetAttributes(expectedImagePath) & FileAttributes.ReparsePoint) != 0)
      {
        return false;
      }

      using var image = new FileStream(
        expectedImagePath,
        FileMode.Open,
        FileAccess.Read,
        FileShare.Read,
        16_384,
        FileOptions.SequentialScan);
      var observedSha256 = Convert.ToHexString(SHA256.HashData(image)).ToLowerInvariant();
      return PayloadDigest.FixedTimeEqualsHex(observedSha256, expectedImageSha256);
    }
    catch (Exception exception) when (exception is ArgumentException
      or InvalidOperationException
      or NotSupportedException
      or UnauthorizedAccessException
      or IOException
      or SystemException)
    {
      return false;
    }
  }
}

public sealed record EgressFlowAuthorization(
  string FlowId,
  string LeaseSha256,
  string ActionId,
  string CapabilityId,
  string DestinationHost,
  int DestinationPort,
  string DestinationPathAndQuery,
  string ServerCertificateSha256Pin,
  string CredentialReferenceId,
  string CredentialRecordSha256,
  string CredentialPrefix,
  string DestinationScopeSha256,
  string RequestBodySha256,
  string ExpectedPreStateSha256,
  string IdempotencyKeySha256,
  string ExactRequestPolicySha256,
  string ReservationDnsAnswerSetSha256,
  long MaximumExternalEgressBytes,
  long ExpiresAtUnixMilliseconds);

/// <summary>
/// Authoritative lifecycle state machine. All mutation is serialized with the
/// write-through journal, and no raw action token, connection nonce, payload,
/// credential, or proxied byte is persisted.
/// </summary>
public sealed class EgressSupervisorEngine : IDisposable
{
  private static readonly string EmptySha256 = Convert.ToHexString(
    SHA256.HashData(ReadOnlySpan<byte>.Empty)).ToLowerInvariant();
  private readonly IActionTokenVerifier _tokenVerifier;
  private readonly IEgressSupervisorSigningKeys _signingKeys;
  private readonly IEgressHostPostureProvider _postureProvider;
  private readonly IEgressProcessIdentityVerifier _processVerifier;
  private readonly IBrowserBoundaryEvidenceProvider _browserBoundaryProvider;
  private readonly EgressDestinationPolicy _destinationPolicy;
  private readonly IEgressDestinationResolver _destinationResolver;
  private readonly IEgressControlPipeSecurityEvidence _pipeSecurityEvidence;
  private readonly DurableEgressJournal _journal;
  private readonly EgressSupervisorOptions _options;
  private readonly TimeProvider _timeProvider;
  private readonly SemaphoreSlim _gate = new(1, 1);
  private readonly SemaphoreSlim _initializationGate = new(1, 1);
  private Dictionary<string, PersistedEgressSession> _sessions = new(StringComparer.Ordinal);
  private readonly Dictionary<string, TaskCompletionSource> _flowCompletionSignals =
    new(StringComparer.Ordinal);
  private readonly HashSet<string> _capabilityAttestationRequestIds =
    new(StringComparer.Ordinal);
  private long _lastReceiptSequence;
  private int _initialized;
  private int _disposed;

  public EgressSupervisorEngine(
    IActionTokenVerifier tokenVerifier,
    IEgressSupervisorSigningKeys signingKeys,
    IEgressHostPostureProvider postureProvider,
    IEgressProcessIdentityVerifier processVerifier,
    EgressDestinationPolicy destinationPolicy,
    DurableEgressJournal journal,
    EgressSupervisorOptions options,
    TimeProvider? timeProvider = null,
    IEgressDestinationResolver? destinationResolver = null,
    IEgressControlPipeSecurityEvidence? pipeSecurityEvidence = null,
    IBrowserBoundaryEvidenceProvider? browserBoundaryProvider = null)
  {
    _tokenVerifier = tokenVerifier;
    _signingKeys = signingKeys;
    _postureProvider = postureProvider;
    _processVerifier = processVerifier;
    _browserBoundaryProvider = browserBoundaryProvider
      ?? new RejectingBrowserBoundaryEvidenceProvider();
    _destinationPolicy = destinationPolicy;
    _destinationResolver = destinationResolver ?? new DnsEgressDestinationResolver();
    _pipeSecurityEvidence = pipeSecurityEvidence
      ?? new WindowsEgressControlPipeSecurityEvidence(options);
    _journal = journal;
    _options = options;
    _timeProvider = timeProvider ?? TimeProvider.System;
  }

  public async ValueTask<SignedCapabilityBoundaryAttestation>
    IssueCapabilityBoundaryAttestationAsync(
      CapabilityBoundaryAttestationRequestV1 request,
      int authenticatedClientProcessId,
      long authenticatedClientProcessCreationTimeUnixMilliseconds,
      CancellationToken cancellationToken)
  {
    EnsureInitialized();
    ArgumentNullException.ThrowIfNull(request);
    var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
    if (request.ContractVersion != CapabilityBoundaryAttestationContract.Version
      || !Guid.TryParseExact(request.RequestId, "D", out _)
      || !IsCanonicalSha256(request.RequestNonceSha256)
      || !Exact(request.DeviceId, _options.DeviceId)
      || !CapabilityBoundaryAttestationContract.IsRole(request.SubjectRole)
      || request.SubjectProcessId <= 0
      || request.SubjectProcessCreationTimeUnixMilliseconds <= 0
      || !IsCanonicalSha256(request.SubjectImageSha256)
      || (!request.BrowserExternalEffectsRequested
        && !request.EmergencyCommandRequested)
      || !IsCanonicalSha256(request.CapabilityManifestSha256)
      || !IsCanonicalSha256(request.DestinationPolicySha256)
      || request.CapabilityCatalogVersion
        != CapabilityBoundaryAttestationContract.CapabilityCatalogVersion
      || request.EgressBoundaryContractVersion != EgressBoundaryCanonical.ContractVersion
      || request.EgressSupervisorProtocolVersion != EgressSupervisorWireProtocol.Version
      || request.SessionBridgeProtocolVersion != SessionBridgeProtocol.Version
      || request.RequestedAtUnixMilliseconds < now - 60_000
      || request.RequestedAtUnixMilliseconds > now + 30_000
      || authenticatedClientProcessId <= 0
      || authenticatedClientProcessCreationTimeUnixMilliseconds <= 0)
    {
      throw new EgressSupervisorException("capability_attestation_request_invalid");
    }

    var companionSubject = string.Equals(
      request.SubjectRole,
      CapabilityBoundaryAttestationContract.CompanionServiceRole,
      StringComparison.Ordinal);
    if (companionSubject
      && (request.SubjectProcessId != authenticatedClientProcessId
        || request.SubjectProcessCreationTimeUnixMilliseconds
          != authenticatedClientProcessCreationTimeUnixMilliseconds))
    {
      throw new EgressSupervisorException("capability_attestation_peer_mismatch");
    }

    var expectedImagePath = companionSubject
      ? _options.CompanionImagePath
      : _options.AgentImagePath;
    var expectedImageSha256 = companionSubject
      ? _options.CompanionImageSha256
      : _options.AgentImageSha256;
    if (!IsSafeAbsoluteLocalPath(expectedImagePath)
      || !IsCanonicalSha256(expectedImageSha256)
      || !FixedTimeHex(request.SubjectImageSha256, expectedImageSha256)
      || !_processVerifier.IsExactMeasuredProcess(
        request.SubjectProcessId,
        request.SubjectProcessCreationTimeUnixMilliseconds,
        expectedImagePath,
        expectedImageSha256)
      || !FixedTimeHex(request.DestinationPolicySha256, _destinationPolicy.Sha256)
      || !FixedTimeHex(
        request.CapabilityManifestSha256,
        StandardUserCapabilityCatalog.RequestedManifestSha256(
          request.BrowserExternalEffectsRequested,
          request.EmergencyCommandRequested)))
    {
      throw new EgressSupervisorException("capability_attestation_subject_invalid");
    }

    var requiredFeatures = EgressBoundaryFeatures.RequiredFor(
      request.BrowserExternalEffectsRequested,
      request.EmergencyCommandRequested);
    var posture = GetCurrentPosture();
    if (!requiredFeatures.All(feature => posture.Features.Contains(
        feature,
        StringComparer.Ordinal))
      || (request.BrowserExternalEffectsRequested
        && posture.BrowserBrokerBuildSha256 is null))
    {
      throw new EgressSupervisorException("capability_attestation_feature_unavailable");
    }

    var pipeSecuritySha256 = _pipeSecurityEvidence
      .GetVerifiedSecurityDescriptorSha256();
    if (!IsCanonicalSha256(pipeSecuritySha256))
    {
      throw new EgressSupervisorException("capability_attestation_pipe_acl_invalid");
    }

    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      EnsureKillSwitchClear();
      if (!_capabilityAttestationRequestIds.Add(request.RequestId))
      {
        throw new EgressSupervisorException("capability_attestation_request_replayed");
      }

      var expiresAt = checked(now + CheckedSeconds(
        _options.CapabilityAttestationLifetimeSeconds,
        5,
        120));
      var attestation = new CapabilityBoundaryAttestationV1(
        CapabilityBoundaryAttestationContract.Version,
        Guid.NewGuid().ToString("D"),
        request.RequestId,
        request.RequestNonceSha256,
        posture.DeviceId,
        posture.SupervisorInstanceId,
        posture.BootId,
        request.SubjectRole,
        request.SubjectProcessId,
        request.SubjectProcessCreationTimeUnixMilliseconds,
        request.SubjectImageSha256,
        request.BrowserExternalEffectsRequested,
        request.EmergencyCommandRequested,
        request.CapabilityManifestSha256,
        request.DestinationPolicySha256,
        request.CapabilityCatalogVersion,
        request.EgressBoundaryContractVersion,
        request.EgressSupervisorProtocolVersion,
        request.SessionBridgeProtocolVersion,
        CapabilityBoundaryAttestationContract.RequiredSupervisorServiceSid,
        pipeSecuritySha256,
        posture.SecureBootEnabled,
        posture.HvciEnabled,
        posture.DriverActive,
        posture.ServiceActive,
        posture.DriverMeasurementSha256,
        posture.ServiceMeasurementSha256,
        posture.BrowserBrokerBuildSha256,
        requiredFeatures,
        now,
        expiresAt);
      var signed = _signingKeys.SignCapabilityAttestation(attestation);
      if (!_signingKeys.VerifyCapabilityAttestation(signed))
      {
        throw new EgressSupervisorException("capability_attestation_signature_invalid");
      }
      return signed;
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask InitializeAsync(CancellationToken cancellationToken)
  {
    if (Volatile.Read(ref _initialized) == 2)
    {
      return;
    }

    await _initializationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      if (Volatile.Read(ref _initialized) == 2)
      {
        return;
      }
      Volatile.Write(ref _initialized, 1);
      EnsureKillSwitchClear();
      _journal.Initialize();
      ValidatePosture(_postureProvider.GetVerifiedPosture());
      var snapshot = _journal.Snapshot();
      _sessions = new Dictionary<string, PersistedEgressSession>(
        snapshot.SessionsByLeaseSha256,
        StringComparer.Ordinal);
      _lastReceiptSequence = snapshot.LastReceiptSequence;
      foreach (var pair in _sessions.ToArray())
      {
        cancellationToken.ThrowIfCancellationRequested();
        ValidateRecoveredSession(pair.Key, pair.Value);
        var interruptedNetworkFlow = string.Equals(
          pair.Value.Lifecycle,
          EgressSessionLifecycle.FlowActive,
          StringComparison.Ordinal);
        var interruptedBrowserFlow = pair.Value.Lifecycle is
          EgressSessionLifecycle.BrowserStarting or EgressSessionLifecycle.BrowserActive;
        if (!interruptedNetworkFlow && !interruptedBrowserFlow)
        {
          continue;
        }

        var recovered = pair.Value with
        {
          Lifecycle = EgressSessionLifecycle.RecoveryUncertain,
          MeasurementUncertain = true,
        };
        _journal.Append(
          interruptedBrowserFlow
            ? "browser-observation-recovered-uncertain"
            : "flow-recovered-uncertain",
          recovered);
        _sessions[pair.Key] = recovered;
      }
      Volatile.Write(ref _initialized, 2);
    }
    catch
    {
      Volatile.Write(ref _initialized, 0);
      throw;
    }
    finally
    {
      _initializationGate.Release();
    }
  }

  public async ValueTask<EgressExecutionAuthorization> ReserveAsync(
    EgressReserveRequestPayload request,
    CancellationToken cancellationToken)
  {
    EnsureInitialized();
    ArgumentNullException.ThrowIfNull(request);
    if (request.ContractVersion != EgressSupervisorLifecycleContract.Version
      || !Guid.TryParseExact(request.OperationId, "D", out _)
      || string.IsNullOrWhiteSpace(request.CompactActionToken)
      || request.CompactActionToken.Length > 131_072
      || string.IsNullOrWhiteSpace(request.ArgumentsJsonUtf8)
      || request.ArgumentsJsonUtf8.Length > 1_048_576)
    {
      throw new EgressSupervisorException("egress_reservation_request_invalid");
    }

    var requestSha256 = ReserveRequestSha256(request);
    var actionTokenSha256 = PayloadDigest.Sha256Hex(request.CompactActionToken);
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var prior = _sessions.Values.FirstOrDefault(session => string.Equals(
        session.ReserveOperationId,
        request.OperationId,
        StringComparison.Ordinal));
      if (prior is not null)
      {
        return FixedTimeHex(prior.ReserveRequestSha256, requestSha256)
          ? prior.Authorization
          : throw new EgressSupervisorException("egress_reservation_idempotency_conflict");
      }
    }
    finally
    {
      _gate.Release();
    }

    var verification = await _tokenVerifier.VerifyAsync(
      request.CompactActionToken,
      cancellationToken).ConfigureAwait(false);
    if (!verification.IsValid || verification.Claims is null)
    {
      throw new EgressSupervisorException(
        verification.ErrorCode ?? "egress_action_token_invalid");
    }
    var claims = verification.Claims;
    ValidateBinding(request, claims);
    var managedBrowser = IsManagedBrowserCapability(
      claims.CapabilityId,
      claims.CapabilityVersion);
    BrowserActionPolicyResolution? browserResolution = null;
    EgressDestinationPolicyEntryV1 exactDestination;
    byte[] requestBody;
    var dynamicDestination = false;
    if (managedBrowser)
    {
      if (!_browserBoundaryProvider.IsAvailable)
      {
        throw new EgressSupervisorException("egress_browser_boundary_not_implemented");
      }
      if (!BrowserActionPolicyCanonicalizer.TryCreate(
          claims.CapabilityId,
          claims.CapabilityVersion,
          request.ArgumentsJsonUtf8,
          claims.ArgumentsSha256,
          claims.ExpectedPreStateSha256!,
          PayloadDigest.Sha256Hex(claims.IdempotencyKey),
          _destinationPolicy,
          out browserResolution,
          out var browserPolicyError))
      {
        throw new EgressSupervisorException(browserPolicyError);
      }
      exactDestination = browserResolution.Destination;
      requestBody = [];
    }
    else
    {
      if (!EgressExternalActionCanonical.TryCreate(
          claims.CapabilityId,
          request.ArgumentsJsonUtf8,
          out ExactExternalActionDestination exactDestinationSpec,
          out requestBody,
          out _))
      {
        throw new EgressSupervisorException("egress_exact_action_arguments_invalid");
      }
      exactDestination = _destinationPolicy.Resolve(
        claims.CapabilityId,
        exactDestinationSpec);
      dynamicDestination = exactDestinationSpec.IsDynamic;
    }

    string requestBodySha256;
    string exactRequestPolicySha256;
    string reservationDnsAnswerSetSha256;
    try
    {
      if (dynamicDestination)
      {
        if (!_destinationPolicy.AllowsDynamicRequestBody(
            claims.CapabilityId,
            requestBody.Length))
        {
          throw new InvalidDataException("egress_dynamic_request_body_denied");
        }
      }
      var resolved = await _destinationResolver.ResolvePublicAsync(
        exactDestination.DestinationHost,
        cancellationToken).ConfigureAwait(false);
      var canonicalResolved = EgressRouteAttestation.Create(resolved.Addresses);
      if (!FixedTimeHex(canonicalResolved.AnswerSetSha256, resolved.AnswerSetSha256))
      {
        throw new InvalidDataException("egress_resolver_route_evidence_invalid");
      }
      reservationDnsAnswerSetSha256 = canonicalResolved.AnswerSetSha256;
      requestBodySha256 = Convert.ToHexString(SHA256.HashData(requestBody))
        .ToLowerInvariant();
      exactRequestPolicySha256 = EgressDestinationPolicy.ExactRequestPolicySha256(
        exactDestination,
        claims.ArgumentsSha256,
        claims.ExpectedPreStateSha256!,
        PayloadDigest.Sha256Hex(claims.IdempotencyKey),
        requestBodySha256);
    }
    catch (InvalidDataException exception)
    {
      throw new EgressSupervisorException(exception.Message);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(requestBody);
    }

    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var existing = _sessions.Values.FirstOrDefault(session => string.Equals(
        session.ReserveOperationId,
        request.OperationId,
        StringComparison.Ordinal));
      if (existing is not null)
      {
        return FixedTimeHex(existing.ReserveRequestSha256, requestSha256)
          ? existing.Authorization
          : throw new EgressSupervisorException("egress_reservation_idempotency_conflict");
      }

      var posture = GetCurrentPosture();
      if (!string.Equals(posture.DeviceId, request.Binding.DeviceId,
        StringComparison.Ordinal))
      {
        throw new EgressSupervisorException("egress_device_binding_mismatch");
      }
      if (!_destinationPolicy.AllowsCapability(request.Binding.CapabilityId)
        || !FixedTimeHex(
          request.Binding.DestinationPolicySha256,
          _destinationPolicy.Sha256))
      {
        throw new EgressSupervisorException("egress_destination_policy_mismatch");
      }
      if (managedBrowser
        && (!_browserBoundaryProvider.IsAvailable
          || posture.BrowserBrokerBuildSha256 is null
          || !EgressBoundaryFeatures.BrowserRequired.All(feature =>
            posture.Features.Contains(feature, StringComparer.Ordinal))))
      {
        throw new EgressSupervisorException("egress_browser_boundary_not_attested");
      }

      var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
      var attestationExpires = checked(now + CheckedSeconds(
        _options.AttestationLifetimeSeconds,
        30,
        300));
      var attestation = new BoundaryAttestationV1(
        EgressBoundaryCanonical.ContractVersion,
        Guid.NewGuid().ToString("D"),
        posture.DeviceId,
        posture.SupervisorInstanceId,
        posture.BootId,
        now,
        attestationExpires,
        posture.SecureBootEnabled,
        posture.HvciEnabled,
        posture.DriverActive,
        posture.ServiceActive,
        posture.DriverMeasurementSha256,
        posture.ServiceMeasurementSha256,
        posture.BrowserBrokerBuildSha256,
        _signingKeys.ReceiptKeyId,
        _signingKeys.ReceiptPublicKeySpkiBase64,
        _signingKeys.ReceiptPublicKeySha256,
        posture.Features);
      var signedAttestation = _signingKeys.SignAttestation(attestation);
      var tokenExpires = checked(claims.ExpiresAtUnixSeconds * 1_000L);
      var leaseExpires = Math.Min(
        Math.Min(attestationExpires, tokenExpires),
        checked(now + CheckedSeconds(_options.LeaseLifetimeSeconds, 30, 900)));
      if (leaseExpires <= now)
      {
        throw new EgressSupervisorException("egress_lease_expired_before_issue");
      }

      var lease = new EgressLeaseV1(
        EgressBoundaryCanonical.ContractVersion,
        Guid.NewGuid().ToString("D"),
        EgressBoundaryCanonical.AttestationSha256(attestation),
        actionTokenSha256,
        request.Binding.ActionId,
        request.Binding.TaskId,
        request.Binding.PlanVersionId,
        request.Binding.StepId,
        request.Binding.DeviceId,
        request.Binding.MandateId,
        request.Binding.CapabilityId,
        request.Binding.CapabilityVersion,
        request.Binding.DispatchCount,
        request.Binding.DestinationPolicySha256,
        request.Binding.ExecutionIdentitySha256,
        request.Binding.ArgumentsSha256,
        request.Binding.ExpectedPreStateSha256,
        request.Binding.IdempotencyKeySha256,
        exactDestination.DestinationScopeSha256,
        requestBodySha256,
        exactRequestPolicySha256,
        reservationDnsAnswerSetSha256,
        request.Binding.ReservedCapabilityEgressBytes,
        now,
        leaseExpires);
      var authorization = new EgressExecutionAuthorization(
        signedAttestation,
        _signingKeys.SignLease(lease));
      var session = new PersistedEgressSession(
        request.OperationId,
        requestSha256,
        request.Binding,
        authorization,
        now,
        EgressSessionLifecycle.Reserved,
        RegistrationKind: null,
        RegistrationOperationId: null,
        RegistrationRequestSha256: null,
        EgressSupervisorLifecycleCanonical.ZeroSha256,
        RegistrationAcknowledgement: null,
        DirectRegistration: null,
        FlowId: null,
        ReservationDnsAnswerSetSha256: reservationDnsAnswerSetSha256,
        ConnectionDnsAnswerSetSha256: null,
        SelectedAddressSha256: null,
        MeasuredExternalEgressBytes: 0,
        MeasurementUncertain: false,
        FlowLogSha256: EmptySha256,
        TerminalOperationId: null,
        TerminalDispositionSha256: null,
        TerminalReceipt: null,
        BrowserActionPolicy: browserResolution?.Policy);
      _journal.Append("reservation-created", session);
      _sessions.Add(EgressBoundaryCanonical.LeaseSha256(lease), session);
      return authorization;
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<EgressRegistrationAcknowledgementV1> RegisterDirectAsync(
    EgressDirectRegistrationRequestPayload request,
    int authenticatedClientProcessId,
    long authenticatedClientProcessCreationTimeUnixMilliseconds,
    CancellationToken cancellationToken)
  {
    EnsureInitialized();
    ArgumentNullException.ThrowIfNull(request);
    ValidateDirectRegistration(
      request,
      authenticatedClientProcessId,
      authenticatedClientProcessCreationTimeUnixMilliseconds);
    var leaseSha256 = EgressBoundaryCanonical.LeaseSha256(
      request.Authorization.Lease.Lease);
    var registrationSha256 = EgressSupervisorLifecycleCanonical.RegistrationSha256(
      request.Registration);
    var operationId = EgressSupervisorLifecycleCanonical.OperationId(
      request.Authorization.Lease.Lease.ActionId,
      $"register:{EgressSupervisorLifecycleContract.DirectRegistration}:"
        + request.Registration.RegistrationId);
    var requestSha256 = Sha256Fields(
      "MSAIDIZI-EGRESS-DIRECT-REGISTRATION-REQUEST-V2",
      leaseSha256,
      operationId,
      registrationSha256);

    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var session = ResolveExactSession(request.Authorization);
      if (session.RegistrationAcknowledgement is not null)
      {
        return string.Equals(session.RegistrationOperationId, operationId,
            StringComparison.Ordinal)
          && session.RegistrationRequestSha256 is not null
          && FixedTimeHex(session.RegistrationRequestSha256, requestSha256)
            ? session.RegistrationAcknowledgement
            : throw new EgressSupervisorException("egress_registration_idempotency_conflict");
      }
      if (!string.Equals(session.Lifecycle, EgressSessionLifecycle.Reserved,
        StringComparison.Ordinal))
      {
        throw new EgressSupervisorException("egress_registration_phase_invalid");
      }

      if (!MatchesCurrentPosture(
        GetCurrentPosture(),
        session.Authorization.Attestation.Attestation))
      {
        throw new EgressSupervisorException("egress_attested_posture_changed");
      }

      var registration = request.Registration;
      if (!FixedTimeHex(registration.DestinationPolicySha256, _destinationPolicy.Sha256)
        || !FixedTimeHex(
          registration.DestinationScopeSha256,
          session.Authorization.Lease.Lease.DestinationScopeSha256)
        || !FixedTimeHex(
          registration.ReservationDnsAnswerSetSha256,
          session.ReservationDnsAnswerSetSha256)
        || !RegistrationDestinationAllowed(session, registration))
      {
        throw new EgressSupervisorException("egress_registered_destination_denied");
      }

      var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
      if (now >= session.Authorization.Lease.Lease.ExpiresAtUnixMilliseconds)
      {
        throw new EgressSupervisorException("egress_registration_lease_expired");
      }
      var acknowledgement = new EgressRegistrationAcknowledgementV1(
        EgressSupervisorLifecycleContract.Version,
        operationId,
        registration.RegistrationId,
        EgressSupervisorLifecycleContract.DirectRegistration,
        leaseSha256,
        registrationSha256,
        now);
      var registered = session with
      {
        Lifecycle = EgressSessionLifecycle.Registered,
        RegistrationKind = EgressSupervisorLifecycleContract.DirectRegistration,
        RegistrationOperationId = operationId,
        RegistrationRequestSha256 = requestSha256,
        RegistrationSha256 = registrationSha256,
        RegistrationAcknowledgement = acknowledgement,
        DirectRegistration = registration,
      };
      _journal.Append("direct-registration-accepted", registered);
      _sessions[leaseSha256] = registered;
      return acknowledgement;
    }
    finally
    {
      _gate.Release();
    }
  }

  public static ValueTask<EgressRegistrationAcknowledgementV1>
    RejectProcessRegistrationAsync() =>
    ValueTask.FromException<EgressRegistrationAcknowledgementV1>(
      new EgressSupervisorException("egress_process_boundary_not_implemented"));

  public async ValueTask<EgressRegistrationAcknowledgementV1> RegisterBrowserAsync(
    EgressBrowserRegistrationRequestPayload request,
    CancellationToken cancellationToken)
  {
    EnsureInitialized();
    ArgumentNullException.ThrowIfNull(request);
    if (!_browserBoundaryProvider.IsAvailable)
    {
      throw new EgressSupervisorException("egress_browser_boundary_not_implemented");
    }
    ValidateBrowserRegistration(request);
    var lease = request.Authorization.Lease.Lease;
    var leaseSha256 = EgressBoundaryCanonical.LeaseSha256(lease);
    var registrationSha256 = EgressSupervisorLifecycleCanonical.RegistrationSha256(
      request.Registration);
    var operationId = EgressSupervisorLifecycleCanonical.OperationId(
      lease.ActionId,
      $"register:{EgressSupervisorLifecycleContract.BrowserRegistration}:"
        + request.Registration.RegistrationId);
    var requestSha256 = Sha256Fields(
      "MSAIDIZI-EGRESS-BROWSER-REGISTRATION-REQUEST-V2",
      leaseSha256,
      operationId,
      registrationSha256);
    BrowserActionPolicyV1 policy;

    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var session = ResolveExactSession(request.Authorization);
      if (session.RegistrationAcknowledgement is not null)
      {
        return ExactBrowserRegistrationReplay(
          session,
          operationId,
          requestSha256,
          registrationSha256);
      }
      if (string.Equals(
          session.Lifecycle,
          EgressSessionLifecycle.BrowserStarting,
          StringComparison.Ordinal))
      {
        throw new EgressSupervisorException(
          FixedTimeHex(session.RegistrationSha256, registrationSha256)
            && session.RegistrationRequestSha256 is not null
            && FixedTimeHex(session.RegistrationRequestSha256, requestSha256)
              ? "egress_browser_registration_in_progress"
              : "egress_registration_idempotency_conflict",
          mayHaveEgressed: true);
      }
      if (!string.Equals(session.Lifecycle, EgressSessionLifecycle.Reserved,
          StringComparison.Ordinal)
        || session.BrowserActionPolicy is not { } browserPolicy)
      {
        throw new EgressSupervisorException("egress_registration_phase_invalid");
      }
      policy = browserPolicy;

      var posture = GetCurrentPosture();
      if (!MatchesCurrentPosture(posture, session.Authorization.Attestation.Attestation)
        || posture.BrowserBrokerBuildSha256 is null
        || !EgressBoundaryFeatures.BrowserRequired.All(feature =>
          posture.Features.Contains(feature, StringComparer.Ordinal))
        || !BrowserRegistrationMatchesPolicyAndPosture(
          request.Registration,
          policy,
          posture.BrowserBrokerBuildSha256))
      {
        throw new EgressSupervisorException("egress_browser_registration_binding_invalid");
      }

      var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
      if (now >= lease.ExpiresAtUnixMilliseconds)
      {
        throw new EgressSupervisorException("egress_registration_lease_expired");
      }
      var prepared = session with
      {
        Lifecycle = EgressSessionLifecycle.BrowserStarting,
        RegistrationOperationId = operationId,
        RegistrationRequestSha256 = requestSha256,
        RegistrationSha256 = registrationSha256,
        BrowserRegistration = request.Registration,
      };
      _journal.Append("browser-registration-prepared", prepared);
      _sessions[leaseSha256] = prepared;
    }
    finally
    {
      _gate.Release();
    }

    BrowserBoundaryRegistrationEvidenceV1? evidence;
    try
    {
      using var timeout = BrowserProviderTimeout(cancellationToken);
      evidence = await _browserBoundaryProvider.TryRegisterAsync(
        new BrowserBoundaryRegistrationRequest(
          request.Authorization,
          policy,
          request.Registration),
        timeout.Token).ConfigureAwait(false);
    }
    catch (Exception exception) when (exception is not OutOfMemoryException
      and not StackOverflowException)
    {
      await MarkBrowserUncertainAsync(
        request.Authorization,
        "browser-registration-provider-failed").ConfigureAwait(false);
      throw new EgressSupervisorException(
        "egress_browser_registration_unconfirmed",
        mayHaveEgressed: true);
    }

    if (!ValidBrowserRegistrationEvidence(
        request.Authorization,
        policy,
        request.Registration,
        registrationSha256,
        evidence))
    {
      await MarkBrowserUncertainAsync(
        request.Authorization,
        "browser-registration-evidence-invalid").ConfigureAwait(false);
      throw new EgressSupervisorException(
        "egress_browser_registration_unconfirmed",
        mayHaveEgressed: true);
    }

    await _gate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
    try
    {
      var session = ResolveExactSession(request.Authorization);
      if (session.RegistrationAcknowledgement is not null)
      {
        return ExactBrowserRegistrationReplay(
          session,
          operationId,
          requestSha256,
          registrationSha256);
      }
      var posture = GetCurrentPosture();
      var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
      if (!string.Equals(
          session.Lifecycle,
          EgressSessionLifecycle.BrowserStarting,
          StringComparison.Ordinal)
        || session.BrowserRegistration is null
        || !FixedTimeHex(session.RegistrationSha256, registrationSha256)
        || session.RegistrationRequestSha256 is null
        || !FixedTimeHex(session.RegistrationRequestSha256, requestSha256)
        || !MatchesCurrentPosture(posture, session.Authorization.Attestation.Attestation)
        || now >= lease.ExpiresAtUnixMilliseconds)
      {
        await MarkBrowserUncertainUnderGateAsync(
          session,
          leaseSha256,
          "browser-registration-state-changed").ConfigureAwait(false);
        throw new EgressSupervisorException(
          "egress_browser_registration_state_changed",
          mayHaveEgressed: true);
      }

      var acknowledgement = new EgressRegistrationAcknowledgementV1(
        EgressSupervisorLifecycleContract.Version,
        operationId,
        request.Registration.RegistrationId,
        EgressSupervisorLifecycleContract.BrowserRegistration,
        leaseSha256,
        registrationSha256,
        now);
      var active = session with
      {
        Lifecycle = EgressSessionLifecycle.BrowserActive,
        RegistrationKind = EgressSupervisorLifecycleContract.BrowserRegistration,
        RegistrationAcknowledgement = acknowledgement,
        BrowserRegistrationEvidence = evidence,
      };
      _journal.Append("browser-registration-accepted", active);
      _sessions[leaseSha256] = active;
      return acknowledgement;
    }
    finally
    {
      _gate.Release();
    }
  }

  public static ValueTask<EgressRegistrationAcknowledgementV1>
    RejectBrowserRegistrationAsync() =>
    ValueTask.FromException<EgressRegistrationAcknowledgementV1>(
      new EgressSupervisorException("egress_browser_boundary_not_implemented"));

  public async ValueTask<EgressFlowAuthorization> BeginDirectFlowAsync(
    EgressFlowOpenRequestV1 request,
    int authenticatedClientProcessId,
    long authenticatedClientProcessCreationTimeUnixMilliseconds,
    CancellationToken cancellationToken)
  {
    EnsureInitialized();
    ValidateFlowRequest(request);
    byte[] nonce;
    try
    {
      nonce = Convert.FromBase64String(request.ConnectionNonceBase64);
    }
    catch (FormatException)
    {
      throw new EgressSupervisorException("egress_flow_nonce_invalid");
    }
    try
    {
      if (nonce.Length != 32)
      {
        throw new EgressSupervisorException("egress_flow_nonce_invalid");
      }
      var nonceSha256 = Convert.ToHexString(SHA256.HashData(nonce)).ToLowerInvariant();
      await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
      try
      {
        if (!_sessions.TryGetValue(request.LeaseSha256, out var session)
          || session.DirectRegistration is not { } registration
          || registration.ProcessId != authenticatedClientProcessId
          || registration.ProcessCreationTimeUnixMilliseconds
            != authenticatedClientProcessCreationTimeUnixMilliseconds
          || !string.Equals(session.Lifecycle, EgressSessionLifecycle.Registered,
            StringComparison.Ordinal)
          || !string.Equals(registration.RegistrationId, request.RegistrationId,
            StringComparison.Ordinal)
          || !FixedTimeHex(registration.ConnectionNonceSha256, nonceSha256)
          || !string.Equals(registration.DestinationHost, request.DestinationHost,
            StringComparison.OrdinalIgnoreCase)
          || registration.DestinationPort != request.DestinationPort
          || !FixedTimeHex(
            registration.DestinationScopeSha256,
            request.DestinationScopeSha256)
          || !RegistrationDestinationAllowed(session, registration))
        {
          throw new EgressSupervisorException("egress_flow_binding_invalid");
        }

        if (!MatchesCurrentPosture(
          GetCurrentPosture(),
          session.Authorization.Attestation.Attestation))
        {
          throw new EgressSupervisorException("egress_attested_posture_changed");
        }

        var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
        if (now >= session.Authorization.Lease.Lease.ExpiresAtUnixMilliseconds)
        {
          throw new EgressSupervisorException("egress_flow_lease_expired");
        }
        var flowId = Guid.NewGuid().ToString("D");
        EgressDestinationPolicyEntryV1 destination;
        try
        {
          destination = registration.ExactDestination is { } exact
            ? _destinationPolicy.Resolve(session.Binding.CapabilityId, exact)
            : _destinationPolicy.ResolveByScope(
              session.Binding.CapabilityId,
              registration.DestinationScopeSha256);
        }
        catch (InvalidDataException)
        {
          throw new EgressSupervisorException("egress_flow_destination_scope_unknown");
        }
        var lease = session.Authorization.Lease.Lease;
        if (!FixedTimeHex(
            lease.ExactRequestPolicySha256,
            EgressDestinationPolicy.ExactRequestPolicySha256(
              destination,
              lease.ArgumentsSha256,
              lease.ExpectedPreStateSha256!,
              lease.IdempotencyKeySha256,
              lease.RequestBodySha256)))
        {
          throw new EgressSupervisorException("egress_flow_exact_request_policy_changed");
        }
        var active = session with
        {
          Lifecycle = EgressSessionLifecycle.FlowActive,
          FlowId = flowId,
        };
        _journal.Append("flow-consumed", active);
        _sessions[request.LeaseSha256] = active;
        _flowCompletionSignals.Add(
          request.LeaseSha256,
          new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously));
        return new EgressFlowAuthorization(
          flowId,
          request.LeaseSha256,
          lease.ActionId,
          lease.CapabilityId,
          registration.DestinationHost,
          registration.DestinationPort,
          destination.DestinationPathAndQuery,
          destination.ServerCertificateSha256Pin,
          destination.CredentialReferenceId,
          destination.CredentialRecordSha256,
          destination.CredentialPrefix,
          destination.DestinationScopeSha256,
          lease.RequestBodySha256,
          lease.ExpectedPreStateSha256!,
          lease.IdempotencyKeySha256,
          lease.ExactRequestPolicySha256,
          lease.ReservationDnsAnswerSetSha256,
          lease.ReservedCapabilityEgressBytes,
          lease.ExpiresAtUnixMilliseconds);
      }
      finally
      {
        _gate.Release();
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(nonce);
    }
  }

  public async ValueTask RecordDirectRouteAsync(
    EgressFlowAuthorization flow,
    string connectionDnsAnswerSetSha256,
    string selectedAddressSha256,
    CancellationToken cancellationToken)
  {
    EnsureInitialized();
    if (!IsCanonicalSha256(connectionDnsAnswerSetSha256)
      || !IsCanonicalSha256(selectedAddressSha256)
      || !FixedTimeHex(
        connectionDnsAnswerSetSha256,
        flow.ReservationDnsAnswerSetSha256)
      || FixedTimeHex(selectedAddressSha256, EgressSupervisorLifecycleCanonical.ZeroSha256))
    {
      throw new EgressSupervisorException("egress_route_attestation_invalid", true);
    }

    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      if (!_sessions.TryGetValue(flow.LeaseSha256, out var session)
        || !string.Equals(session.Lifecycle, EgressSessionLifecycle.FlowActive,
          StringComparison.Ordinal)
        || !string.Equals(session.FlowId, flow.FlowId, StringComparison.Ordinal))
      {
        throw new EgressSupervisorException("egress_route_attestation_conflict", true);
      }
      if (session.ConnectionDnsAnswerSetSha256 is not null)
      {
        if (FixedTimeHex(
            session.ConnectionDnsAnswerSetSha256,
            connectionDnsAnswerSetSha256)
          && session.SelectedAddressSha256 is not null
          && FixedTimeHex(session.SelectedAddressSha256, selectedAddressSha256))
        {
          return;
        }
        throw new EgressSupervisorException("egress_route_attestation_conflict", true);
      }

      var attested = session with
      {
        ConnectionDnsAnswerSetSha256 = connectionDnsAnswerSetSha256,
        SelectedAddressSha256 = selectedAddressSha256,
      };
      _journal.Append("flow-route-attested", attested);
      _sessions[flow.LeaseSha256] = attested;
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask CompleteDirectFlowAsync(
    EgressFlowAuthorization flow,
    long measuredExternalEgressBytes,
    bool measurementUncertain,
    string flowLogSha256,
    CancellationToken cancellationToken)
  {
    EnsureInitialized();
    if (measuredExternalEgressBytes < 0
      || !IsCanonicalSha256(flowLogSha256))
    {
      throw new EgressSupervisorException("egress_flow_measurement_invalid", true);
    }

    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      if (!_sessions.TryGetValue(flow.LeaseSha256, out var session)
        || !string.Equals(session.Lifecycle, EgressSessionLifecycle.FlowActive,
          StringComparison.Ordinal)
        || !string.Equals(session.FlowId, flow.FlowId, StringComparison.Ordinal))
      {
        throw new EgressSupervisorException("egress_flow_completion_conflict", true);
      }

      var reserved = session.Authorization.Lease.Lease.ReservedCapabilityEgressBytes;
      var boundedMeasured = Math.Min(measuredExternalEgressBytes, reserved);
      var uncertain = measurementUncertain
        || measuredExternalEgressBytes > reserved
        || session.ConnectionDnsAnswerSetSha256 is null
        || session.SelectedAddressSha256 is null;
      var completed = session with
      {
        Lifecycle = uncertain
          ? EgressSessionLifecycle.RecoveryUncertain
          : EgressSessionLifecycle.FlowClosed,
        MeasuredExternalEgressBytes = boundedMeasured,
        MeasurementUncertain = uncertain,
        FlowLogSha256 = flowLogSha256,
      };
      _journal.Append(uncertain ? "flow-measurement-uncertain" : "flow-closed", completed);
      _sessions[flow.LeaseSha256] = completed;
      if (_flowCompletionSignals.Remove(flow.LeaseSha256, out var signal))
      {
        signal.TrySetResult();
      }
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<SignedEgressReceipt> TerminalAsync(
    EgressTerminalRequestPayload request,
    bool abort,
    CancellationToken cancellationToken)
  {
    EnsureInitialized();
    ValidateTerminalRequest(request);
    var managedBrowser = IsManagedBrowserCapability(
      request.Authorization.Lease.Lease.CapabilityId,
      request.Authorization.Lease.Lease.CapabilityVersion);
    if (managedBrowser)
    {
      await CompleteManagedBrowserObservationAsync(
        request.Authorization,
        abort,
        cancellationToken).ConfigureAwait(false);
    }
    await WaitForFlowCompletionAsync(
      request.Authorization,
      managedBrowser ? CancellationToken.None : cancellationToken).ConfigureAwait(false);
    var leaseSha256 = EgressBoundaryCanonical.LeaseSha256(
      request.Authorization.Lease.Lease);
    var dispositionSha256 = EgressSupervisorLifecycleCanonical.DispositionSha256(
      request.Disposition);

    await _gate.WaitAsync(
      managedBrowser ? CancellationToken.None : cancellationToken).ConfigureAwait(false);
    try
    {
      var session = ResolveExactSession(request.Authorization);
      if (session.TerminalReceipt is not null)
      {
        return string.Equals(
            session.TerminalOperationId,
            request.Disposition.OperationId,
            StringComparison.Ordinal)
          && session.TerminalDispositionSha256 is not null
          && FixedTimeHex(session.TerminalDispositionSha256, dispositionSha256)
            ? session.TerminalReceipt
            : throw new EgressSupervisorException("egress_terminal_idempotency_conflict", true);
      }
      if (string.Equals(session.Lifecycle, EgressSessionLifecycle.FlowActive,
        StringComparison.Ordinal))
      {
        throw new EgressSupervisorException("egress_flow_still_active", true);
      }
      if (!abort && session.RegistrationAcknowledgement is null)
      {
        throw new EgressSupervisorException("egress_settlement_registration_required");
      }
      if (!ExactAcknowledgement(request.Registration, session.RegistrationAcknowledgement))
      {
        throw new EgressSupervisorException("egress_terminal_registration_mismatch", true);
      }

      var recoveredUncertain = string.Equals(
        session.Lifecycle,
        EgressSessionLifecycle.RecoveryUncertain,
        StringComparison.Ordinal);
      var dispositionUnknown = request.Disposition.OutcomeUncertain
        || string.Equals(
          request.Disposition.Outcome,
          EgressSupervisorLifecycleContract.Unknown,
          StringComparison.Ordinal);
      var browserRegistration = string.Equals(
        session.RegistrationKind,
        EgressSupervisorLifecycleContract.BrowserRegistration,
        StringComparison.Ordinal);
      if (recoveredUncertain && !dispositionUnknown)
      {
        throw new EgressSupervisorException(
          "egress_recovered_flow_requires_unknown_disposition",
          true);
      }
      if (!recoveredUncertain
        && !dispositionUnknown
        && !browserRegistration
        && request.Disposition.ReportedExternalEgressBytes
          != session.MeasuredExternalEgressBytes)
      {
        throw new EgressSupervisorException("egress_reported_measurement_mismatch", true);
      }
      if (managedBrowser
        && !recoveredUncertain
        && !dispositionUnknown
        && (session.BrowserCompletionEvidence is null
          || !string.Equals(
            session.Lifecycle,
            EgressSessionLifecycle.FlowClosed,
            StringComparison.Ordinal)
          || request.Disposition.ReportedExternalEgressBytes
            > session.MeasuredExternalEgressBytes))
      {
        throw new EgressSupervisorException(
          "egress_browser_completion_measurement_mismatch",
          true);
      }

      var lease = session.Authorization.Lease.Lease;
      var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
      var unknown = recoveredUncertain || dispositionUnknown || session.MeasurementUncertain;
      // Browser UI automation cannot lower the signed LocalSystem artifact
      // floor. The independent supervisor may measure more transport bytes;
      // the receipt binds the maximum so downstream settlement charges it
      // exactly once. Direct/process flows retain their exact-measurement rule.
      var measured = browserRegistration && !managedBrowser
        ? Math.Max(
          session.MeasuredExternalEgressBytes,
          request.Disposition.ReportedExternalEgressBytes)
        : session.MeasuredExternalEgressBytes;
      var uncertainBytes = unknown
        ? checked(lease.ReservedCapabilityEgressBytes - measured)
        : 0L;
      var outcome = unknown
        ? EgressSupervisorLifecycleContract.Unknown
        : request.Disposition.Outcome;
      var sequence = checked(_lastReceiptSequence + 1);
      var receipt = new EgressReceiptV1(
        EgressBoundaryCanonical.ContractVersion,
        Guid.NewGuid().ToString("D"),
        leaseSha256,
        EgressBoundaryCanonical.AttestationSha256(
          session.Authorization.Attestation.Attestation),
        lease.ActionTokenSha256,
        lease.ActionId,
        lease.TaskId,
        lease.PlanVersionId,
        lease.StepId,
        lease.DeviceId,
        lease.MandateId,
        lease.CapabilityId,
        lease.CapabilityVersion,
        lease.DispatchCount,
        lease.DestinationPolicySha256,
        lease.ExecutionIdentitySha256,
        lease.ArgumentsSha256,
        lease.ExpectedPreStateSha256,
        lease.IdempotencyKeySha256,
        lease.DestinationScopeSha256,
        lease.RequestBodySha256,
        lease.ExactRequestPolicySha256,
        lease.ReservationDnsAnswerSetSha256,
        session.ConnectionDnsAnswerSetSha256
          ?? EgressSupervisorLifecycleCanonical.ZeroSha256,
        session.SelectedAddressSha256
          ?? EgressSupervisorLifecycleCanonical.ZeroSha256,
        session.RegistrationSha256,
        dispositionSha256,
        lease.ReservedCapabilityEgressBytes,
        measured,
        uncertainBytes,
        checked(measured + uncertainBytes),
        session.StartedAtUnixMilliseconds,
        now,
        sequence,
        session.FlowLogSha256,
        outcome);
      var signedReceipt = _signingKeys.SignReceipt(receipt);
      var terminal = session with
      {
        Lifecycle = EgressSessionLifecycle.Terminal,
        TerminalOperationId = request.Disposition.OperationId,
        TerminalDispositionSha256 = dispositionSha256,
        TerminalReceipt = signedReceipt,
      };
      _journal.Append(abort ? "reservation-aborted" : "reservation-settled", terminal);
      _sessions[leaseSha256] = terminal;
      _lastReceiptSequence = sequence;
      return signedReceipt;
    }
    finally
    {
      _gate.Release();
    }
  }

  private async ValueTask CompleteManagedBrowserObservationAsync(
    EgressExecutionAuthorization authorization,
    bool abort,
    CancellationToken cancellationToken)
  {
    PersistedEgressSession session;
    var leaseSha256 = EgressBoundaryCanonical.LeaseSha256(authorization.Lease.Lease);
    await _gate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
    try
    {
      session = ResolveExactSession(authorization);
      if (string.Equals(
          session.Lifecycle,
          EgressSessionLifecycle.BrowserStarting,
          StringComparison.Ordinal))
      {
        await MarkBrowserUncertainUnderGateAsync(
          session,
          leaseSha256,
          "browser-registration-interrupted").ConfigureAwait(false);
        return;
      }
      if (!string.Equals(
          session.Lifecycle,
          EgressSessionLifecycle.BrowserActive,
          StringComparison.Ordinal))
      {
        return;
      }
      if (abort)
      {
        await MarkBrowserUncertainUnderGateAsync(
          session,
          leaseSha256,
          "browser-observation-cancelled").ConfigureAwait(false);
        return;
      }
    }
    finally
    {
      _gate.Release();
    }

    if (session.BrowserActionPolicy is not { } policy
      || session.BrowserRegistration is not { } registration
      || session.BrowserRegistrationEvidence is not { } registrationEvidence)
    {
      await MarkBrowserUncertainAsync(
        authorization,
        "browser-observation-state-invalid").ConfigureAwait(false);
      return;
    }

    BrowserBoundaryCompletionEvidenceV1? completion;
    try
    {
      using var timeout = BrowserProviderTimeout(cancellationToken);
      completion = await _browserBoundaryProvider.TryObserveCompletionAsync(
        new BrowserBoundaryCompletionRequest(
          authorization,
          policy,
          registration,
          registrationEvidence),
        timeout.Token).ConfigureAwait(false);
    }
    catch (Exception exception) when (exception is not OutOfMemoryException
      and not StackOverflowException)
    {
      await MarkBrowserUncertainAsync(
        authorization,
        "browser-observation-provider-failed").ConfigureAwait(false);
      return;
    }

    if (!ValidBrowserCompletionEvidence(
        session,
        policy,
        registrationEvidence,
        completion))
    {
      await MarkBrowserUncertainAsync(
        authorization,
        "browser-completion-evidence-invalid").ConfigureAwait(false);
      return;
    }

    await _gate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
    try
    {
      var current = ResolveExactSession(authorization);
      if (current.Lifecycle is EgressSessionLifecycle.FlowClosed
        or EgressSessionLifecycle.RecoveryUncertain
        or EgressSessionLifecycle.Terminal)
      {
        return;
      }
      var posture = GetCurrentPosture();
      if (!string.Equals(
          current.Lifecycle,
          EgressSessionLifecycle.BrowserActive,
          StringComparison.Ordinal)
        || current.BrowserRegistrationEvidence is null
        || !FixedTimeHex(
          BrowserBoundaryCanonical.RegistrationEvidenceSha256(
            current.BrowserRegistrationEvidence),
          BrowserBoundaryCanonical.RegistrationEvidenceSha256(
            registrationEvidence))
        || !MatchesCurrentPosture(
          posture,
          current.Authorization.Attestation.Attestation))
      {
        await MarkBrowserUncertainUnderGateAsync(
          current,
          leaseSha256,
          "browser-completion-state-changed").ConfigureAwait(false);
        return;
      }

      var flowLogSha256 = BrowserBoundaryCanonical.EventLogSha256(
        registrationEvidence,
        completion!);
      var closed = current with
      {
        Lifecycle = EgressSessionLifecycle.FlowClosed,
        ConnectionDnsAnswerSetSha256 = completion!.ConnectionDnsAnswerSetSha256,
        SelectedAddressSha256 = completion.SelectedAddressSha256,
        MeasuredExternalEgressBytes = completion.MeasuredExternalEgressBytes,
        MeasurementUncertain = false,
        FlowLogSha256 = flowLogSha256,
        BrowserCompletionEvidence = completion,
      };
      _journal.Append("browser-observation-completed", closed);
      _sessions[leaseSha256] = closed;
    }
    finally
    {
      _gate.Release();
    }
  }

  private bool ValidBrowserCompletionEvidence(
    PersistedEgressSession session,
    BrowserActionPolicyV1 policy,
    BrowserBoundaryRegistrationEvidenceV1 registration,
    BrowserBoundaryCompletionEvidenceV1? completion)
  {
    if (completion is null
      || !BrowserBoundaryContractValidator.TryValidateSuccessfulCompletion(
        policy,
        registration,
        completion,
        out _))
    {
      return false;
    }

    var lease = session.Authorization.Lease.Lease;
    var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
    return FixedTimeHex(
        completion.ConnectionDnsAnswerSetSha256,
        session.ReservationDnsAnswerSetSha256)
      && completion.MeasuredExternalEgressBytes <= lease.ReservedCapabilityEgressBytes
      && registration.ObservedAtUnixMilliseconds >= lease.IssuedAtUnixMilliseconds
      && registration.ObservedAtUnixMilliseconds <= lease.ExpiresAtUnixMilliseconds
      && completion.ObservedAtUnixMilliseconds <= lease.ExpiresAtUnixMilliseconds
      && completion.ObservedAtUnixMilliseconds <= checked(now + 30_000L);
  }

  private static EgressRegistrationAcknowledgementV1 ExactBrowserRegistrationReplay(
    PersistedEgressSession session,
    string operationId,
    string requestSha256,
    string registrationSha256) =>
    string.Equals(session.RegistrationOperationId, operationId, StringComparison.Ordinal)
    && session.RegistrationRequestSha256 is not null
    && FixedTimeHex(session.RegistrationRequestSha256, requestSha256)
    && FixedTimeHex(session.RegistrationSha256, registrationSha256)
      ? session.RegistrationAcknowledgement!
      : throw new EgressSupervisorException("egress_registration_idempotency_conflict");

  private bool ValidBrowserRegistrationEvidence(
    EgressExecutionAuthorization authorization,
    BrowserActionPolicyV1 policy,
    EgressBrowserRegistrationV1 registration,
    string registrationSha256,
    BrowserBoundaryRegistrationEvidenceV1? evidence)
  {
    if (evidence is null
      || !BrowserBoundaryContractValidator.IsRegistrationEvidenceValid(evidence))
    {
      return false;
    }
    var lease = authorization.Lease.Lease;
    var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
    return FixedTimeHex(evidence.LeaseSha256, EgressBoundaryCanonical.LeaseSha256(lease))
      && FixedTimeHex(evidence.RegistrationSha256, registrationSha256)
      && FixedTimeHex(
        evidence.ActionPolicySha256,
        BrowserBoundaryCanonical.ActionPolicySha256(policy))
      && evidence.BrokerIdentity.WindowsSessionId == registration.WindowsSessionId
      && evidence.BrokerIdentity.ProcessId == registration.BrowserBrokerProcessId
      && evidence.BrokerIdentity.ProcessCreationTimeUnixMilliseconds
        == registration.BrowserBrokerProcessCreationTimeUnixMilliseconds
      && FixedTimeHex(
        evidence.BrokerIdentity.ImageSha256,
        registration.BrowserBrokerImageSha256)
      && FixedTimeHex(
        evidence.BrokerIdentity.BuildSha256,
        registration.BrowserBrokerBuildSha256)
      && !FixedTimeHex(
        evidence.CompletionChallengeSha256,
        registration.CompletionNonceSha256)
      && evidence.ObservedAtUnixMilliseconds >= lease.IssuedAtUnixMilliseconds
      && evidence.ObservedAtUnixMilliseconds <= lease.ExpiresAtUnixMilliseconds
      && evidence.ObservedAtUnixMilliseconds <= checked(now + 30_000L);
  }

  private async ValueTask MarkBrowserUncertainAsync(
    EgressExecutionAuthorization authorization,
    string eventKind)
  {
    await _gate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
    try
    {
      var session = ResolveExactSession(authorization);
      await MarkBrowserUncertainUnderGateAsync(
        session,
        EgressBoundaryCanonical.LeaseSha256(authorization.Lease.Lease),
        eventKind).ConfigureAwait(false);
    }
    finally
    {
      _gate.Release();
    }
  }

  private ValueTask MarkBrowserUncertainUnderGateAsync(
    PersistedEgressSession session,
    string leaseSha256,
    string eventKind)
  {
    if (session.Lifecycle is not (EgressSessionLifecycle.BrowserStarting
      or EgressSessionLifecycle.BrowserActive))
    {
      return ValueTask.CompletedTask;
    }
    var registrationEvidenceSha256 = session.BrowserRegistrationEvidence is null
      ? EgressSupervisorLifecycleCanonical.ZeroSha256
      : BrowserBoundaryCanonical.RegistrationEvidenceSha256(
        session.BrowserRegistrationEvidence);
    var uncertain = session with
    {
      Lifecycle = EgressSessionLifecycle.RecoveryUncertain,
      ConnectionDnsAnswerSetSha256 = null,
      SelectedAddressSha256 = null,
      MeasuredExternalEgressBytes = 0,
      MeasurementUncertain = true,
      FlowLogSha256 = Sha256Fields(
        "MSAIDIZI-BROWSER-UNKNOWN-FLOW-V1",
        session.RegistrationSha256,
        registrationEvidenceSha256),
      BrowserCompletionEvidence = null,
    };
    _journal.Append(eventKind, uncertain);
    _sessions[leaseSha256] = uncertain;
    return ValueTask.CompletedTask;
  }

  private CancellationTokenSource BrowserProviderTimeout(CancellationToken cancellationToken)
  {
    var timeoutMilliseconds = _options.FlowCompletionSettlementTimeoutMilliseconds;
    if (timeoutMilliseconds is < 100 or > 30_000)
    {
      throw new EgressSupervisorException(
        "egress_browser_provider_timeout_invalid",
        mayHaveEgressed: true);
    }
    var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
    timeout.CancelAfter(timeoutMilliseconds);
    return timeout;
  }

  private bool RegistrationDestinationAllowed(
    PersistedEgressSession session,
    EgressDirectRegistrationV1 registration)
  {
    try
    {
      var destination = registration.ExactDestination is { } exact
        ? _destinationPolicy.Resolve(session.Binding.CapabilityId, exact)
        : _destinationPolicy.ResolveByScope(
          session.Binding.CapabilityId,
          registration.DestinationScopeSha256);
      return string.Equals(
          destination.DestinationHost,
          registration.DestinationHost,
          StringComparison.OrdinalIgnoreCase)
        && destination.DestinationPort == registration.DestinationPort
        && FixedTimeHex(
          destination.DestinationScopeSha256,
          registration.DestinationScopeSha256);
    }
    catch (InvalidDataException)
    {
      return false;
    }
  }

  private static void ValidateBinding(
    EgressReserveRequestPayload request,
    ActionTokenClaims claims)
  {
    var binding = request.Binding;
    var expectedOperationId = EgressSupervisorLifecycleCanonical.OperationId(
      binding.ActionId,
      "reserve");
    var capabilityEgressValid = TryExpectedCapabilityEgressBytes(
      claims.Budgets,
      out var expectedCapabilityEgressBytes);
    if (!string.Equals(
        claims.ExecutionMode,
        ActionExecutionModes.Execute,
        StringComparison.Ordinal)
      || !string.Equals(request.OperationId, expectedOperationId, StringComparison.Ordinal)
      || !FixedTimeHex(
        PayloadDigest.Sha256Hex(request.CompactActionToken),
        binding.ActionTokenSha256)
      || !Exact(binding.ActionId, claims.ActionId)
      || !Exact(binding.TaskId, claims.TaskId)
      || !Exact(binding.PlanVersionId, claims.PlanVersionId)
      || !Exact(binding.StepId, claims.StepId)
      || !Exact(binding.DeviceId, claims.DeviceId)
      || !Exact(binding.MandateId, claims.MandateId)
      || !Exact(binding.CapabilityId, claims.CapabilityId)
      || !Exact(binding.CapabilityVersion, claims.CapabilityVersion)
      || binding.DispatchCount != claims.DispatchCount
      || !capabilityEgressValid
      || binding.ReservedCapabilityEgressBytes != expectedCapabilityEgressBytes
      || binding.ReservedCapabilityEgressBytes is < 0 or > 262_144_000
      || !IsCanonicalSha256(binding.ActionTokenSha256)
      || !IsCanonicalSha256(binding.DestinationPolicySha256)
      || !IsCanonicalSha256(binding.ExecutionIdentitySha256)
      || !FixedTimeHex(binding.ArgumentsSha256, claims.ArgumentsSha256)
      || !FixedTimeHex(
        PayloadDigest.Sha256Hex(request.ArgumentsJsonUtf8),
        claims.ArgumentsSha256)
      || claims.ExpectedPreStateSha256 is null
      || !FixedTimeHex(
        binding.ExpectedPreStateSha256 ?? string.Empty,
        claims.ExpectedPreStateSha256)
      || !FixedTimeHex(
        binding.IdempotencyKeySha256,
        PayloadDigest.Sha256Hex(claims.IdempotencyKey)))
    {
      throw new EgressSupervisorException("egress_action_binding_invalid");
    }
  }

  private static bool TryExpectedCapabilityEgressBytes(
    ActionBudget budgets,
    out long expectedCapabilityEgressBytes)
  {
    expectedCapabilityEgressBytes = 0;
    if (budgets.MaxExternalEgressBytes < 0
      || budgets.BrokerMaxDeliverySessions is < 1 or > 16
      || budgets.BrokerMaxRequestAttemptsPerSession is < 1 or > 5
      || budgets.BrokerSerializedResultUpperBoundBytes <= 0)
    {
      return false;
    }

    try
    {
      var brokerReservation = checked(
        budgets.BrokerSerializedResultUpperBoundBytes
        * budgets.BrokerMaxRequestAttemptsPerSession
        * budgets.BrokerMaxDeliverySessions);
      expectedCapabilityEgressBytes = checked(
        budgets.MaxExternalEgressBytes - brokerReservation);
      return brokerReservation > 0 && expectedCapabilityEgressBytes >= 0;
    }
    catch (OverflowException)
    {
      expectedCapabilityEgressBytes = 0;
      return false;
    }
  }

  private void ValidateDirectRegistration(
    EgressDirectRegistrationRequestPayload request,
    int authenticatedClientProcessId,
    long authenticatedClientProcessCreationTimeUnixMilliseconds)
  {
    var registration = request.Registration;
    if (request.ContractVersion != EgressSupervisorLifecycleContract.Version
      || registration.ContractVersion != EgressSupervisorLifecycleContract.Version
      || !Guid.TryParseExact(registration.RegistrationId, "D", out _)
      || registration.ProcessId <= 0
      || registration.ProcessId != authenticatedClientProcessId
      || registration.ProcessCreationTimeUnixMilliseconds <= 0
      || registration.ProcessCreationTimeUnixMilliseconds
        != authenticatedClientProcessCreationTimeUnixMilliseconds
      || !_processVerifier.IsExactLiveProcess(
        registration.ProcessId,
        registration.ProcessCreationTimeUnixMilliseconds)
      || registration.NetworkProtocol is not ("https" or "tls")
      || registration.DestinationHost.Length is < 1 or > 253
      || registration.DestinationPort is < 1 or > 65_535
      || !IsCanonicalSha256(registration.DestinationPolicySha256)
      || !IsCanonicalSha256(registration.DestinationScopeSha256)
      || !IsCanonicalSha256(registration.ReservationDnsAnswerSetSha256)
      || !IsCanonicalSha256(registration.ConnectionNonceSha256))
    {
      throw new EgressSupervisorException("egress_direct_registration_invalid");
    }
  }

  private static void ValidateBrowserRegistration(
    EgressBrowserRegistrationRequestPayload request)
  {
    ArgumentNullException.ThrowIfNull(request.Authorization);
    ArgumentNullException.ThrowIfNull(request.Registration);
    var lease = request.Authorization.Lease.Lease;
    var registration = request.Registration;
    if (request.ContractVersion != EgressSupervisorLifecycleContract.Version
      || registration.ContractVersion != EgressSupervisorLifecycleContract.Version
      || !IsManagedBrowserCapability(lease.CapabilityId, lease.CapabilityVersion)
      || !Guid.TryParseExact(registration.RegistrationId, "D", out _)
      || registration.WindowsSessionId <= 0
      || registration.BrowserBrokerProcessId <= 0
      || registration.BrowserBrokerProcessCreationTimeUnixMilliseconds <= 0
      || !IsCanonicalSha256(registration.OriginSha256)
      || !IsCanonicalSha256(registration.BrowserBrokerBuildSha256)
      || !IsCanonicalSha256(registration.BrowserBrokerImageSha256)
      || !IsCanonicalSha256(registration.CompletionNonceSha256)
      || FixedTimeHex(
        registration.CompletionNonceSha256,
        EgressSupervisorLifecycleCanonical.ZeroSha256)
      || !IsCanonicalSha256(registration.ActionPolicySha256))
    {
      throw new EgressSupervisorException("egress_browser_registration_invalid");
    }
  }

  private static bool BrowserRegistrationMatchesPolicyAndPosture(
    EgressBrowserRegistrationV1 registration,
    BrowserActionPolicyV1 policy,
    string browserBrokerBuildSha256) =>
    BrowserBoundaryContractValidator.IsActionPolicyValid(policy)
    && FixedTimeHex(registration.OriginSha256, policy.ExpectedOriginSha256)
    && FixedTimeHex(
      registration.ActionPolicySha256,
      BrowserBoundaryCanonical.ActionPolicySha256(policy))
    && FixedTimeHex(registration.BrowserBrokerBuildSha256, browserBrokerBuildSha256);

  private static void ValidateFlowRequest(EgressFlowOpenRequestV1 request)
  {
    ArgumentNullException.ThrowIfNull(request);
    if (request.ContractVersion != EgressSupervisorLifecycleContract.Version
      || !IsCanonicalSha256(request.LeaseSha256)
      || !Guid.TryParseExact(request.RegistrationId, "D", out _)
      || string.IsNullOrWhiteSpace(request.ConnectionNonceBase64)
      || request.ConnectionNonceBase64.Length > 128
      || request.DestinationHost.Length is < 1 or > 253
      || request.DestinationPort is < 1 or > 65_535
      || !IsCanonicalSha256(request.DestinationScopeSha256))
    {
      throw new EgressSupervisorException("egress_flow_request_invalid");
    }
  }

  private static void ValidateTerminalRequest(EgressTerminalRequestPayload request)
  {
    ArgumentNullException.ThrowIfNull(request);
    var disposition = request.Disposition;
    if (request.ContractVersion != EgressSupervisorLifecycleContract.Version
      || disposition.ContractVersion != EgressSupervisorLifecycleContract.Version
      || !Guid.TryParseExact(disposition.OperationId, "D", out _)
      || !EgressSupervisorLifecycleContract.TerminalOutcomes.Contains(disposition.Outcome)
      || disposition.ReportedExternalEgressBytes < 0
      || disposition.OccurredAtUnixMilliseconds <= 0)
    {
      throw new EgressSupervisorException("egress_terminal_request_invalid");
    }
  }

  private PersistedEgressSession ResolveExactSession(
    EgressExecutionAuthorization authorization)
  {
    var leaseSha256 = EgressBoundaryCanonical.LeaseSha256(authorization.Lease.Lease);
    if (!_sessions.TryGetValue(leaseSha256, out var session)
      || !FixedTimeHex(
        AuthorizationSha256(session.Authorization),
        AuthorizationSha256(authorization)))
    {
      throw new EgressSupervisorException("egress_authorization_unknown");
    }
    return session;
  }

  private void ValidateRecoveredSession(
    string leaseSha256,
    PersistedEgressSession session)
  {
    var authorization = session.Authorization;
    var attestation = authorization.Attestation.Attestation;
    var lease = authorization.Lease.Lease;
    if (!_signingKeys.VerifyAttestation(authorization.Attestation)
      || !_signingKeys.VerifyLease(authorization.Lease)
      || !FixedTimeHex(leaseSha256, EgressBoundaryCanonical.LeaseSha256(lease))
      || !FixedTimeHex(
        lease.AttestationSha256,
        EgressBoundaryCanonical.AttestationSha256(attestation))
      || !Exact(attestation.DeviceId, session.Binding.DeviceId)
      || !Exact(lease.ActionId, session.Binding.ActionId)
      || !Exact(lease.TaskId, session.Binding.TaskId)
      || !Exact(lease.PlanVersionId, session.Binding.PlanVersionId)
      || !Exact(lease.StepId, session.Binding.StepId)
      || !Exact(lease.DeviceId, session.Binding.DeviceId)
      || !Exact(lease.MandateId, session.Binding.MandateId)
      || !Exact(lease.CapabilityId, session.Binding.CapabilityId)
      || !Exact(lease.CapabilityVersion, session.Binding.CapabilityVersion)
      || lease.DispatchCount != session.Binding.DispatchCount
      || lease.ReservedCapabilityEgressBytes
        != session.Binding.ReservedCapabilityEgressBytes
      || !FixedTimeHex(lease.ActionTokenSha256, session.Binding.ActionTokenSha256)
      || !FixedTimeHex(
        lease.DestinationPolicySha256,
        session.Binding.DestinationPolicySha256)
      || !FixedTimeHex(
        lease.ExecutionIdentitySha256,
        session.Binding.ExecutionIdentitySha256)
      || !FixedTimeHex(lease.ArgumentsSha256, session.Binding.ArgumentsSha256)
      || !OptionalDigestMatches(
        lease.ExpectedPreStateSha256,
        session.Binding.ExpectedPreStateSha256)
      || !FixedTimeHex(
        lease.IdempotencyKeySha256,
        session.Binding.IdempotencyKeySha256)
      || !IsCanonicalSha256(lease.DestinationScopeSha256)
      || !IsCanonicalSha256(lease.RequestBodySha256)
      || !IsCanonicalSha256(lease.ExactRequestPolicySha256)
      || !IsCanonicalSha256(lease.ReservationDnsAnswerSetSha256)
      || !FixedTimeHex(
        lease.ReservationDnsAnswerSetSha256,
        session.ReservationDnsAnswerSetSha256)
      || !FixedTimeHex(lease.DestinationPolicySha256, _destinationPolicy.Sha256)
      || (session.DirectRegistration is { } registration
        && (!FixedTimeHex(
            session.RegistrationSha256,
            EgressSupervisorLifecycleCanonical.RegistrationSha256(registration))
          || session.RegistrationAcknowledgement is not { } acknowledgement
          || !FixedTimeHex(acknowledgement.LeaseSha256, leaseSha256)
          || !FixedTimeHex(
            acknowledgement.RegistrationSha256,
            session.RegistrationSha256)))
      || !ValidateRecoveredBrowserSession(session, leaseSha256)
      || (session.TerminalReceipt is { } terminal
        && (!ValidateRecoveredReceipt(session, leaseSha256, terminal)
          || !_signingKeys.VerifyReceipt(terminal))))
    {
      throw new EgressSupervisorException("egress_durable_state_signature_invalid", true);
    }
  }

  private static bool ValidateRecoveredBrowserSession(
    PersistedEgressSession session,
    string leaseSha256)
  {
    var lease = session.Authorization.Lease.Lease;
    var managedBrowser = IsManagedBrowserCapability(
      lease.CapabilityId,
      lease.CapabilityVersion);
    if (!managedBrowser)
    {
      return session.BrowserActionPolicy is null
        && session.BrowserRegistration is null
        && session.BrowserRegistrationEvidence is null
        && session.BrowserCompletionEvidence is null;
    }
    if (session.BrowserActionPolicy is not { } policy
      || !BrowserBoundaryContractValidator.IsActionPolicyValid(policy)
      || !FixedTimeHex(policy.ArgumentsSha256, lease.ArgumentsSha256)
      || !FixedTimeHex(policy.DestinationScopeSha256, lease.DestinationScopeSha256)
      || !EgressBoundaryFeatures.BrowserRequired.All(feature =>
        session.Authorization.Attestation.Attestation.Features.Contains(
          feature,
          StringComparer.Ordinal))
      || session.Authorization.Attestation.Attestation.BrowserBrokerBuildSha256 is not
      { } attestedBuild)
    {
      return false;
    }
    if (session.BrowserRegistration is not { } registration)
    {
      return session.Lifecycle is EgressSessionLifecycle.Reserved
        or EgressSessionLifecycle.Terminal;
    }
    var registrationSha256 = EgressSupervisorLifecycleCanonical.RegistrationSha256(
      registration);
    if (!FixedTimeHex(session.RegistrationSha256, registrationSha256)
      || !BrowserRegistrationMatchesPolicyAndPosture(registration, policy, attestedBuild))
    {
      return false;
    }
    if (session.BrowserRegistrationEvidence is not { } evidence)
    {
      return session.Lifecycle is EgressSessionLifecycle.BrowserStarting
        or EgressSessionLifecycle.RecoveryUncertain
        or EgressSessionLifecycle.Terminal;
    }
    if (!BrowserBoundaryContractValidator.IsRegistrationEvidenceValid(evidence)
      || !FixedTimeHex(evidence.LeaseSha256, leaseSha256)
      || !FixedTimeHex(evidence.RegistrationSha256, registrationSha256)
      || !FixedTimeHex(
        evidence.ActionPolicySha256,
        BrowserBoundaryCanonical.ActionPolicySha256(policy))
      || evidence.BrokerIdentity.WindowsSessionId != registration.WindowsSessionId
      || evidence.BrokerIdentity.ProcessId != registration.BrowserBrokerProcessId
      || evidence.BrokerIdentity.ProcessCreationTimeUnixMilliseconds
        != registration.BrowserBrokerProcessCreationTimeUnixMilliseconds
      || !FixedTimeHex(
        evidence.BrokerIdentity.ImageSha256,
        registration.BrowserBrokerImageSha256)
      || !FixedTimeHex(
        evidence.BrokerIdentity.BuildSha256,
        registration.BrowserBrokerBuildSha256)
      || evidence.ObservedAtUnixMilliseconds < lease.IssuedAtUnixMilliseconds
      || evidence.ObservedAtUnixMilliseconds > lease.ExpiresAtUnixMilliseconds)
    {
      return false;
    }
    if (session.BrowserCompletionEvidence is not { } completion)
    {
      return true;
    }
    return BrowserBoundaryContractValidator.TryValidateSuccessfulCompletion(
        policy,
        evidence,
        completion,
        out _)
      && FixedTimeHex(
        completion.ConnectionDnsAnswerSetSha256,
        session.ReservationDnsAnswerSetSha256)
      && completion.MeasuredExternalEgressBytes <= lease.ReservedCapabilityEgressBytes
      && completion.ObservedAtUnixMilliseconds <= lease.ExpiresAtUnixMilliseconds
      && FixedTimeHex(
        session.FlowLogSha256,
        BrowserBoundaryCanonical.EventLogSha256(evidence, completion));
  }

  private static bool ValidateRecoveredReceipt(
    PersistedEgressSession session,
    string leaseSha256,
    SignedEgressReceipt terminal)
  {
    var lease = session.Authorization.Lease.Lease;
    var receipt = terminal.Receipt;
    try
    {
      return receipt.ContractVersion == EgressBoundaryCanonical.ContractVersion
        && FixedTimeHex(receipt.LeaseSha256, leaseSha256)
        && FixedTimeHex(
          receipt.AttestationSha256,
          EgressBoundaryCanonical.AttestationSha256(
            session.Authorization.Attestation.Attestation))
        && FixedTimeHex(receipt.ActionTokenSha256, lease.ActionTokenSha256)
        && Exact(receipt.ActionId, lease.ActionId)
        && Exact(receipt.TaskId, lease.TaskId)
        && Exact(receipt.PlanVersionId, lease.PlanVersionId)
        && Exact(receipt.StepId, lease.StepId)
        && Exact(receipt.DeviceId, lease.DeviceId)
        && Exact(receipt.MandateId, lease.MandateId)
        && Exact(receipt.CapabilityId, lease.CapabilityId)
        && Exact(receipt.CapabilityVersion, lease.CapabilityVersion)
        && receipt.DispatchCount == lease.DispatchCount
        && FixedTimeHex(receipt.DestinationPolicySha256, lease.DestinationPolicySha256)
        && FixedTimeHex(receipt.ExecutionIdentitySha256, lease.ExecutionIdentitySha256)
        && FixedTimeHex(receipt.ArgumentsSha256, lease.ArgumentsSha256)
        && OptionalDigestMatches(
          receipt.ExpectedPreStateSha256,
          lease.ExpectedPreStateSha256)
        && FixedTimeHex(receipt.IdempotencyKeySha256, lease.IdempotencyKeySha256)
        && FixedTimeHex(receipt.DestinationScopeSha256, lease.DestinationScopeSha256)
        && FixedTimeHex(receipt.RequestBodySha256, lease.RequestBodySha256)
        && FixedTimeHex(
          receipt.ExactRequestPolicySha256,
          lease.ExactRequestPolicySha256)
        && FixedTimeHex(
          receipt.ReservationDnsAnswerSetSha256,
          lease.ReservationDnsAnswerSetSha256)
        && FixedTimeHex(
          receipt.ConnectionDnsAnswerSetSha256,
          session.ConnectionDnsAnswerSetSha256
            ?? EgressSupervisorLifecycleCanonical.ZeroSha256)
        && FixedTimeHex(
          receipt.SelectedAddressSha256,
          session.SelectedAddressSha256
            ?? EgressSupervisorLifecycleCanonical.ZeroSha256)
        && FixedTimeHex(receipt.RegistrationSha256, session.RegistrationSha256)
        && session.TerminalDispositionSha256 is not null
        && FixedTimeHex(
          receipt.DispositionSha256,
          session.TerminalDispositionSha256)
        && receipt.ReservedCapabilityEgressBytes == lease.ReservedCapabilityEgressBytes
        && receipt.MeasuredExternalEgressBytes == session.MeasuredExternalEgressBytes
        && FixedTimeHex(receipt.FlowLogSha256, session.FlowLogSha256)
        && checked(receipt.MeasuredExternalEgressBytes
          + receipt.UncertainExternalEgressBytes) == receipt.ChargedExternalEgressBytes
        && receipt.ChargedExternalEgressBytes <= receipt.ReservedCapabilityEgressBytes
        && (!Exact(receipt.Outcome, EgressSupervisorLifecycleContract.Unknown)
          || receipt.ChargedExternalEgressBytes == receipt.ReservedCapabilityEgressBytes);
    }
    catch (OverflowException)
    {
      return false;
    }
  }

  private static bool ExactAcknowledgement(
    EgressRegistrationAcknowledgementV1? actual,
    EgressRegistrationAcknowledgementV1? expected)
  {
    if (actual is null || expected is null)
    {
      return actual is null && expected is null;
    }
    return Exact(actual.OperationId, expected.OperationId)
      && Exact(actual.RegistrationId, expected.RegistrationId)
      && Exact(actual.RegistrationKind, expected.RegistrationKind)
      && FixedTimeHex(actual.LeaseSha256, expected.LeaseSha256)
      && FixedTimeHex(actual.RegistrationSha256, expected.RegistrationSha256)
      && actual.AcceptedAtUnixMilliseconds == expected.AcceptedAtUnixMilliseconds;
  }

  private static string ReserveRequestSha256(EgressReserveRequestPayload request) =>
    Sha256Fields(
      "MSAIDIZI-EGRESS-RESERVATION-REQUEST-V2",
      request.OperationId,
      PayloadDigest.Sha256Hex(request.CompactActionToken),
      PayloadDigest.Sha256Hex(request.ArgumentsJsonUtf8),
      BindingSha256(request.Binding));

  private static string BindingSha256(EgressActionBinding binding) => Sha256Fields(
    "MSAIDIZI-EGRESS-ACTION-BINDING-V1",
    binding.ActionTokenSha256,
    binding.ActionId,
    binding.TaskId,
    binding.PlanVersionId,
    binding.StepId,
    binding.DeviceId,
    binding.MandateId,
    binding.CapabilityId,
    binding.CapabilityVersion,
    binding.DispatchCount.ToString(CultureInfo.InvariantCulture),
    binding.ReservedCapabilityEgressBytes.ToString(CultureInfo.InvariantCulture),
    binding.DestinationPolicySha256,
    binding.ExecutionIdentitySha256,
    binding.ArgumentsSha256,
    binding.ExpectedPreStateSha256 ?? string.Empty,
    binding.IdempotencyKeySha256);

  private static string AuthorizationSha256(EgressExecutionAuthorization authorization)
  {
    var bytes = JsonSerializer.SerializeToUtf8Bytes(authorization);
    try
    {
      return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }
    finally
    {
      CryptographicOperations.ZeroMemory(bytes);
    }
  }

  private static string Sha256Fields(string domain, params string[] fields)
  {
    var canonical = string.Join('\n', new[] { domain }.Concat(fields.Select(Field)));
    var bytes = Encoding.UTF8.GetBytes(canonical);
    try
    {
      return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }
    finally
    {
      CryptographicOperations.ZeroMemory(bytes);
    }
  }

  private static string Field(string value) => $"{Encoding.UTF8.GetByteCount(value)}:{value}";

  private static bool Exact(string left, string right) =>
    string.Equals(left, right, StringComparison.Ordinal);

  private static bool IsManagedBrowserCapability(string capabilityId, string version) =>
    string.Equals(
      capabilityId,
      ManagedBrowserBoundaryContract.CapabilityId,
      StringComparison.Ordinal)
    && string.Equals(
      version,
      ManagedBrowserBoundaryContract.CapabilityVersion,
      StringComparison.Ordinal);

  private static bool OptionalDigestMatches(string? left, string? right) =>
    left is null || right is null
      ? left is null && right is null
      : FixedTimeHex(left, right);

  private static bool IsCanonicalSha256(string value) => value.Length == 64
    && string.Equals(value, value.ToLowerInvariant(), StringComparison.Ordinal)
    && value.All(Uri.IsHexDigit);

  private static bool IsSafeAbsoluteLocalPath(string value)
  {
    if (string.IsNullOrWhiteSpace(value)
      || !Path.IsPathFullyQualified(value)
      || value.StartsWith("\\\\", StringComparison.Ordinal)
      || value.StartsWith("\\??\\", StringComparison.Ordinal)
      || value.StartsWith("\\\\?\\", StringComparison.Ordinal))
    {
      return false;
    }

    try
    {
      return string.Equals(
          Path.GetFullPath(value),
          value,
          StringComparison.OrdinalIgnoreCase)
        && value.IndexOf(':', 3) < 0;
    }
    catch (Exception exception) when (exception is ArgumentException
      or NotSupportedException
      or PathTooLongException)
    {
      return false;
    }
  }

  private static bool FixedTimeHex(string actual, string expected)
  {
    if (!IsCanonicalSha256(actual) || !IsCanonicalSha256(expected))
    {
      return false;
    }
    var actualBytes = Convert.FromHexString(actual);
    var expectedBytes = Convert.FromHexString(expected);
    try
    {
      return CryptographicOperations.FixedTimeEquals(actualBytes, expectedBytes);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(actualBytes);
      CryptographicOperations.ZeroMemory(expectedBytes);
    }
  }

  private static long CheckedSeconds(int seconds, int minimum, int maximum)
  {
    if (seconds < minimum || seconds > maximum)
    {
      throw new EgressSupervisorException("egress_lifetime_configuration_invalid");
    }
    return checked(seconds * 1_000L);
  }

  private static void ValidatePosture(EgressHostPosture posture)
  {
    var sortedFeatures = posture.Features.Order(StringComparer.Ordinal).ToArray();
    var browserFeatures = posture.Features.Contains(
        EgressBoundaryFeatures.BrowserOriginAttested,
        StringComparer.Ordinal)
      && posture.Features.Contains(
        EgressBoundaryFeatures.BrowserCompletionAttested,
        StringComparer.Ordinal);
    if (!Guid.TryParseExact(posture.DeviceId, "D", out _)
      || !Guid.TryParseExact(posture.SupervisorInstanceId, "D", out _)
      || !Guid.TryParseExact(posture.BootId, "D", out _)
      || !posture.SecureBootEnabled
      || !posture.HvciEnabled
      || !posture.DriverActive
      || !posture.ServiceActive
      || !IsCanonicalSha256(posture.DriverMeasurementSha256)
      || !IsCanonicalSha256(posture.ServiceMeasurementSha256)
      || !posture.Features.SequenceEqual(sortedFeatures, StringComparer.Ordinal)
      || posture.Features.Distinct(StringComparer.Ordinal).Count()
        != posture.Features.Count
      || !posture.Features.All(EgressBoundaryFeatures.IsAllowed)
      || !EgressBoundaryFeatures.CommandRequired.All(feature =>
        posture.Features.Contains(feature, StringComparer.Ordinal))
      || posture.Features.Contains(
        EgressBoundaryFeatures.BrowserOriginAttested,
        StringComparer.Ordinal) != posture.Features.Contains(
        EgressBoundaryFeatures.BrowserCompletionAttested,
        StringComparer.Ordinal)
      || (posture.BrowserBrokerBuildSha256 is not null) != browserFeatures
      || (posture.BrowserBrokerBuildSha256 is not null
        && !IsCanonicalSha256(posture.BrowserBrokerBuildSha256)))
    {
      throw new EgressSupervisorException("egress_host_posture_invalid");
    }
  }

  private EgressHostPosture GetCurrentPosture()
  {
    var posture = _postureProvider.GetVerifiedPosture();
    ValidatePosture(posture);
    return posture;
  }

  private async ValueTask WaitForFlowCompletionAsync(
    EgressExecutionAuthorization authorization,
    CancellationToken cancellationToken)
  {
    Task? completion = null;
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var session = ResolveExactSession(authorization);
      if (string.Equals(
        session.Lifecycle,
        EgressSessionLifecycle.FlowActive,
        StringComparison.Ordinal))
      {
        var leaseSha256 = EgressBoundaryCanonical.LeaseSha256(
          authorization.Lease.Lease);
        if (!_flowCompletionSignals.TryGetValue(leaseSha256, out var signal))
        {
          throw new EgressSupervisorException("egress_flow_completion_signal_missing", true);
        }
        completion = signal.Task;
      }
    }
    finally
    {
      _gate.Release();
    }

    if (completion is null)
    {
      return;
    }

    var timeoutMilliseconds = _options.FlowCompletionSettlementTimeoutMilliseconds;
    if (timeoutMilliseconds is < 100 or > 30_000)
    {
      throw new EgressSupervisorException("egress_flow_completion_timeout_invalid", true);
    }
    try
    {
      await completion.WaitAsync(
        TimeSpan.FromMilliseconds(timeoutMilliseconds),
        cancellationToken).ConfigureAwait(false);
    }
    catch (TimeoutException)
    {
      throw new EgressSupervisorException("egress_flow_still_active", true);
    }
  }

  private static bool MatchesCurrentPosture(
    EgressHostPosture posture,
    BoundaryAttestationV1 attestation) =>
    Exact(posture.DeviceId, attestation.DeviceId)
    && Exact(posture.SupervisorInstanceId, attestation.SupervisorInstanceId)
    && Exact(posture.BootId, attestation.BootId)
    && posture.SecureBootEnabled == attestation.SecureBootEnabled
    && posture.HvciEnabled == attestation.HvciEnabled
    && posture.DriverActive == attestation.DriverActive
    && posture.ServiceActive == attestation.ServiceActive
    && FixedTimeHex(
      posture.DriverMeasurementSha256,
      attestation.DriverMeasurementSha256)
    && FixedTimeHex(
      posture.ServiceMeasurementSha256,
      attestation.ServiceMeasurementSha256)
    && Exact(
      posture.BrowserBrokerBuildSha256 ?? string.Empty,
      attestation.BrowserBrokerBuildSha256 ?? string.Empty)
    && posture.Features.SequenceEqual(attestation.Features, StringComparer.Ordinal);

  private void EnsureInitialized()
  {
    ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
    EnsureKillSwitchClear();
    if (Volatile.Read(ref _initialized) != 2)
    {
      throw new InvalidOperationException("The egress supervisor is not initialized.");
    }
  }

  private void EnsureKillSwitchClear()
  {
    if (EgressTrustedKillSwitch.IsEngaged(_options.KillSwitchPath))
    {
      throw new EgressSupervisorException("egress_kill_switch_engaged", true);
    }
  }

  public void Dispose()
  {
    if (Interlocked.Exchange(ref _disposed, 1) == 0)
    {
      foreach (var signal in _flowCompletionSignals.Values)
      {
        signal.TrySetCanceled();
      }
      _flowCompletionSignals.Clear();
      _gate.Dispose();
      _initializationGate.Dispose();
    }
  }
}
