using System.Buffers.Binary;
using System.ComponentModel;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

/// <summary>
/// Configuration for the optional local trusted-root supervisor transport.
/// The shipped service selects this client only when the complete external
/// supervisor identity, restricted service SID, protected public-key pins, and
/// measured policy bundle are provisioned. Every incomplete configuration
/// retains the rejecting gate.
/// </summary>
public sealed record PrivilegedCommandTrustedRootPipeClientOptions
{
  public bool Enabled { get; init; }

  public string PipeName { get; init; } = string.Empty;

  public string ExpectedSupervisorImagePath { get; init; } = string.Empty;

  public string ExpectedSupervisorImageSha256 { get; init; } = string.Empty;

  public string ExpectedSupervisorServiceSid { get; init; } = string.Empty;

  public int MaximumFrameBytes { get; init; } = 131_072;

  public TimeSpan ConnectTimeout { get; init; } = TimeSpan.FromSeconds(5);

  public TimeSpan OperationTimeout { get; init; } = TimeSpan.FromSeconds(10);

  public TimeSpan ReservationRequestLifetime { get; init; } = TimeSpan.FromMinutes(1);

  public PrivilegedCommandIsolationVerificationSettings? Verification { get; init; }
}

/// <summary>
/// Default-off client foundation for a separately installed trusted-root
/// supervisor. Signed lifecycle contracts authenticate every accepting
/// response; the named-pipe peer is additionally pinned to a live LocalSystem
/// restricted-service token containing the exact supervisor SID, session zero,
/// and an exact locked image path and SHA-256.
/// </summary>
public sealed class NamedPipePrivilegedCommandTrustedRootIsolationClient :
  IPrivilegedCommandTrustedRootIsolationGate,
  IPrivilegedCommandTrustedRootIsolationRecovery
{
  private readonly PrivilegedCommandTrustedRootPipeClientOptions _options;
  private readonly IPrivilegedCommandIsolationVerificationKeyResolver _keys;
  private readonly IPrivilegedCommandIsolationPipeConnector _connector;
  private readonly TimeProvider _timeProvider;

  public NamedPipePrivilegedCommandTrustedRootIsolationClient(
    PrivilegedCommandTrustedRootPipeClientOptions options,
    IPrivilegedCommandIsolationVerificationKeyResolver keys,
    TimeProvider? timeProvider = null)
    : this(options, keys, new WindowsPrivilegedCommandIsolationPipeConnector(), timeProvider)
  {
  }

  internal NamedPipePrivilegedCommandTrustedRootIsolationClient(
    PrivilegedCommandTrustedRootPipeClientOptions options,
    IPrivilegedCommandIsolationVerificationKeyResolver keys,
    IPrivilegedCommandIsolationPipeConnector connector,
    TimeProvider? timeProvider = null)
  {
    ArgumentNullException.ThrowIfNull(options);
    ArgumentNullException.ThrowIfNull(keys);
    ArgumentNullException.ThrowIfNull(connector);
    _options = options;
    _keys = keys;
    _connector = connector;
    _timeProvider = timeProvider ?? TimeProvider.System;
  }

  public async ValueTask<IPrivilegedCommandTrustedRootIsolationSession?> TryReserveAsync(
    PrivilegedCommandIsolationRequestBinding binding,
    CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(binding);
    if (!_options.Enabled)
    {
      return null;
    }

    var verifier = ValidateAndCreateVerifier();
    ValidateBinding(binding);
    var action = CreateAction(binding);
    var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
    var request = new PrivilegedCommandIsolationReservationRequestV1(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      NewCanonicalGuid(),
      NewNonceBase64Url(),
      action,
      now,
      checked(now + Milliseconds(_options.ReservationRequestLifetime)));
    var connection = await ConnectAsync(cancellationToken).ConfigureAwait(false);
    var exchange = new PrivilegedCommandIsolationPipeExchange(
      connection,
      _options.MaximumFrameBytes,
      _options.OperationTimeout);
    try
    {
      var response = await exchange.ExchangeAsync<ReserveRequestPayload,
        ReserveResponsePayload>(
          PrivilegedCommandIsolationPipeProtocol.ReserveRequest,
          PrivilegedCommandIsolationPipeProtocol.ReserveResponse,
          request.RequestId,
          new ReserveRequestPayload(
            request,
            binding.EphemeralBinding!.ActionAuthorization.SignedAction.CompactToken,
            binding.EphemeralBinding.ActionAuthorization.SignedAction.Request,
            binding.EphemeralBinding.Invocation),
          cancellationToken).ConfigureAwait(false);
      var verified = verifier.VerifyReservation(
        request,
        response.SignedLease,
        action);
      if (!verified.IsValid || verified.Value is null)
      {
        await exchange.DisposeAsync().ConfigureAwait(false);
        return null;
      }

      return new Session(
        exchange,
        verifier,
        verified.Value,
        binding.EphemeralBinding.Invocation);
    }
    catch
    {
      await exchange.DisposeAsync().ConfigureAwait(false);
      throw;
    }
  }

  public async ValueTask<VerifiedPrivilegedCommandIsolationPreBindRelease?>
    TryRecoverPendingReservationAsync(
      PrivilegedCommandIsolationPendingReservation pending,
      CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(pending);
    if (!_options.Enabled)
    {
      return null;
    }

    var verifier = ValidateAndCreateVerifier();
    var reservation = verifier.VerifyReservationForRecovery(
      pending.Request,
      pending.SignedLease,
      pending.Request.Action);
    if (!reservation.IsValid || reservation.Value is null)
    {
      return null;
    }

    await using var exchange = new PrivilegedCommandIsolationPipeExchange(
      await ConnectAsync(cancellationToken).ConfigureAwait(false),
      _options.MaximumFrameBytes,
      _options.OperationTimeout);
    var response = await exchange.ExchangeAsync<RecoverReservationRequestPayload,
      ReleaseResponsePayload>(
        PrivilegedCommandIsolationPipeProtocol.RecoverReservationRequest,
        PrivilegedCommandIsolationPipeProtocol.RecoverReservationResponse,
        pending.Request.RequestId,
        new RecoverReservationRequestPayload(pending),
        cancellationToken).ConfigureAwait(false);
    var released = verifier.VerifyPreBindReleaseForRecovery(
      reservation.Value,
      response.SignedRelease);
    return released.IsValid ? released.Value : null;
  }

  public async ValueTask<VerifiedPrivilegedCommandIsolationTerminalReceipt?>
    TryRecoverPendingBindAsync(
      PrivilegedCommandIsolationPendingBind pending,
      CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(pending);
    if (!_options.Enabled)
    {
      return null;
    }

    var verifier = ValidateAndCreateVerifier();
    var reservation = verifier.VerifyReservationForRecovery(
      pending.Request,
      pending.SignedLease,
      pending.Request.Action);
    if (!reservation.IsValid || reservation.Value is null)
    {
      return null;
    }
    var bind = verifier.VerifyBindAcknowledgementForRecovery(
      reservation.Value,
      pending.Binding,
      pending.SignedAcknowledgement);
    if (!bind.IsValid || bind.Value is null)
    {
      return null;
    }

    await using var exchange = new PrivilegedCommandIsolationPipeExchange(
      await ConnectAsync(cancellationToken).ConfigureAwait(false),
      _options.MaximumFrameBytes,
      _options.OperationTimeout);
    var response = await exchange.ExchangeAsync<RecoverBindRequestPayload,
      SettleResponsePayload>(
        PrivilegedCommandIsolationPipeProtocol.RecoverBindRequest,
        PrivilegedCommandIsolationPipeProtocol.RecoverBindResponse,
        pending.Request.RequestId,
        new RecoverBindRequestPayload(pending),
        cancellationToken).ConfigureAwait(false);
    var terminal = verifier.VerifyTerminalReceiptForRecovery(
      bind.Value,
      response.SignedReceipt);
    return terminal.IsValid ? terminal.Value : null;
  }

  private PrivilegedCommandIsolationContractVerifier ValidateAndCreateVerifier()
  {
    ValidateConfiguration();
    return new PrivilegedCommandIsolationContractVerifier(
      _options.Verification!,
      _keys,
      _timeProvider);
  }

  private PrivilegedCommandIsolationActionBinding CreateAction(
    PrivilegedCommandIsolationRequestBinding binding)
  {
    var verification = _options.Verification!;
    var ephemeral = binding.EphemeralBinding
      ?? throw new ArgumentException(
        "The trusted-root isolation request requires live authorization material.",
        nameof(binding));
    var request = ephemeral.ActionAuthorization.SignedAction.Request;
    var claims = ephemeral.ActionAuthorization.VerifiedClaims;
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
      verification.ExpectedIsolationPolicySha256,
      verification.ExpectedDriverMeasurementSha256,
      verification.ExpectedServiceMeasurementSha256,
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

  private void ValidateBinding(PrivilegedCommandIsolationRequestBinding binding)
  {
    if (!IsCanonicalGuid(binding.ActionId)
      || !IsCanonicalGuid(binding.TaskId)
      || !IsCanonicalGuid(binding.PlanVersionId)
      || !IsCanonicalGuid(binding.StepId)
      || !IsCanonicalGuid(binding.DeviceId)
      || !IsCanonicalGuid(binding.MandateId)
      || !string.Equals(
        binding.DeviceId,
        _options.Verification!.ExpectedDeviceId,
        StringComparison.Ordinal)
      || !IsCanonicalSha256(binding.ActionTokenSha256)
      || !IsCanonicalSha256(binding.InvocationSha256)
      || !IsCanonicalSha256(binding.ExpectedImagePathSha256)
      || !IsCanonicalSha256(binding.ExpectedImageSha256)
      || binding.EphemeralBinding is null
      || !PrivilegedCommandIsolationCanonical.IsValidInvocation(
        binding.EphemeralBinding.Invocation)
      || !PayloadDigest.FixedTimeEqualsHex(
        binding.InvocationSha256,
        PrivilegedCommandIsolationCanonical.InvocationSha256(
          binding.EphemeralBinding.Invocation))
      || !PayloadDigest.FixedTimeEqualsHex(
        binding.ActionTokenSha256,
        PayloadDigest.Sha256Hex(
          binding.EphemeralBinding.ActionAuthorization.SignedAction.CompactToken))
      || ActionRequestAuthorizer.Validate(
        binding.EphemeralBinding.ActionAuthorization.SignedAction.Request,
        binding.EphemeralBinding.ActionAuthorization.VerifiedClaims,
        _timeProvider.GetUtcNow()) is not null
      || !RequestMatchesBinding(
        binding.EphemeralBinding.ActionAuthorization.SignedAction.Request,
        binding))
    {
      throw new ArgumentException(
        "The trusted-root isolation request binding is not canonical.",
        nameof(binding));
    }
  }

  private async ValueTask<IPrivilegedCommandIsolationPipeConnection> ConnectAsync(
    CancellationToken cancellationToken)
  {
    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
    timeout.CancelAfter(_options.ConnectTimeout);
    return await _connector.ConnectAsync(_options, timeout.Token).ConfigureAwait(false);
  }

  private void ValidateConfiguration()
  {
    if (!_options.Enabled
      || !PrivilegedCommandIsolationPipeProtocol.IsSafePipeName(_options.PipeName)
      || !IsSafeAbsoluteLocalPath(_options.ExpectedSupervisorImagePath)
      || !IsCanonicalSha256(_options.ExpectedSupervisorImageSha256)
      || !TrustedSupervisorProcessAccessGrant.IsCanonicalRestrictedServiceSid(
        _options.ExpectedSupervisorServiceSid)
      || !string.Equals(
        _options.ExpectedSupervisorServiceSid,
        PrivilegedCommandIsolationSupervisorIdentity.ServiceSid,
        StringComparison.Ordinal)
      || _options.MaximumFrameBytes
        is < PrivilegedCommandIsolationPipeProtocol.MinimumFrameBytes
        or > PrivilegedCommandIsolationPipeProtocol.AbsoluteMaximumFrameBytes
      || !InRange(
        _options.ConnectTimeout,
        TimeSpan.FromMilliseconds(100),
        TimeSpan.FromSeconds(30))
      || !InRange(
        _options.OperationTimeout,
        TimeSpan.FromMilliseconds(100),
        TimeSpan.FromSeconds(30))
      || !InRange(
        _options.ReservationRequestLifetime,
        TimeSpan.FromSeconds(1),
        TimeSpan.FromMinutes(2))
      || _options.Verification is null)
    {
      throw new InvalidOperationException(
        "The trusted-root isolation pipe client is not safely configured.");
    }
  }

  private static bool IsSafeAbsoluteLocalPath(string value)
  {
    if (string.IsNullOrWhiteSpace(value)
      || !Path.IsPathFullyQualified(value)
      || value.StartsWith("\\\\", StringComparison.Ordinal)
      || value.StartsWith("\\??\\", StringComparison.Ordinal)
      || value.StartsWith("\\\\?\\", StringComparison.Ordinal)
      || value.EndsWith(' ')
      || value.EndsWith('.'))
    {
      return false;
    }

    try
    {
      var fullPath = Path.GetFullPath(value);
      return string.Equals(fullPath, value, StringComparison.OrdinalIgnoreCase)
        && fullPath.IndexOf(':', 3) < 0;
    }
    catch (Exception exception) when (exception is ArgumentException
      or NotSupportedException
      or PathTooLongException)
    {
      return false;
    }
  }

  private static bool IsCanonicalSha256(string? value) =>
    PayloadDigest.IsSha256Hex(value)
    && string.Equals(value, value?.ToLowerInvariant(), StringComparison.Ordinal);

  private static bool IsCanonicalGuid(string? value) =>
    value is not null
    && Guid.TryParseExact(value, "D", out var parsed)
    && string.Equals(parsed.ToString("D"), value, StringComparison.Ordinal);

  private static bool InRange(TimeSpan value, TimeSpan minimum, TimeSpan maximum) =>
    value >= minimum && value <= maximum;

  private static long Milliseconds(TimeSpan value) => checked((long)value.TotalMilliseconds);

  private static string NewCanonicalGuid() => Guid.NewGuid().ToString("D");

  private static bool RequestMatchesBinding(
    ActionRequest request,
    PrivilegedCommandIsolationRequestBinding binding) =>
    string.Equals(request.ActionId, binding.ActionId, StringComparison.Ordinal)
    && string.Equals(request.TaskId, binding.TaskId, StringComparison.Ordinal)
    && string.Equals(request.PlanVersionId, binding.PlanVersionId, StringComparison.Ordinal)
    && string.Equals(request.StepId, binding.StepId, StringComparison.Ordinal)
    && string.Equals(request.DeviceId, binding.DeviceId, StringComparison.Ordinal)
    && string.Equals(request.MandateId, binding.MandateId, StringComparison.Ordinal)
    && string.Equals(
      request.CapabilityId,
      PrivilegedCommandIsolationCapability.Id,
      StringComparison.Ordinal)
    && string.Equals(
      request.CapabilityVersion,
      PrivilegedCommandIsolationCapability.Version,
      StringComparison.Ordinal)
    && string.Equals(
      request.ExecutionMode,
      ActionExecutionModes.Execute,
      StringComparison.Ordinal);

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

  private sealed class Session : IPrivilegedCommandTrustedRootIsolationSession
  {
    private readonly PrivilegedCommandIsolationPipeExchange _exchange;
    private readonly PrivilegedCommandIsolationContractVerifier _verifier;
    private readonly PrivilegedCommandIsolationInvocationV2 _invocation;
    private VerifiedPrivilegedCommandIsolationPreBindRelease? _release;
    private VerifiedPrivilegedCommandIsolationBindAcknowledgement? _bind;
    private VerifiedPrivilegedCommandIsolationTerminalReceipt? _terminal;
    private readonly SemaphoreSlim _stateGate = new(1, 1);
    private SessionPhase _phase = SessionPhase.Reserved;

    public Session(
      PrivilegedCommandIsolationPipeExchange exchange,
      PrivilegedCommandIsolationContractVerifier verifier,
      VerifiedPrivilegedCommandIsolationReservation reservation,
      PrivilegedCommandIsolationInvocationV2 invocation)
    {
      _exchange = exchange;
      _verifier = verifier;
      _invocation = invocation;
      Reservation = reservation;
    }

    public VerifiedPrivilegedCommandIsolationReservation Reservation { get; }

    public async ValueTask<VerifiedPrivilegedCommandIsolationPreBindRelease?>
      TryReleaseBeforeBindAsync(
        string outcome,
        CancellationToken cancellationToken)
    {
      await _stateGate.WaitAsync(cancellationToken).ConfigureAwait(false);
      try
      {
        EnsureNotDisposed();
        if (!PrivilegedCommandIsolationPreBindReleaseOutcomes.All.Contains(outcome))
        {
          throw new ArgumentOutOfRangeException(nameof(outcome));
        }
        if (_phase == SessionPhase.Released)
        {
          return string.Equals(
            _release!.SignedRelease.Release.Outcome,
            outcome,
            StringComparison.Ordinal)
            ? _release
            : throw new InvalidOperationException(
              "A reservation cannot be released with two different outcomes.");
        }
        EnsurePhase(SessionPhase.Reserved, "pre-bind release");

        var response = await _exchange.ExchangeAsync<ReleaseRequestPayload,
          ReleaseResponsePayload>(
            PrivilegedCommandIsolationPipeProtocol.ReleaseRequest,
            PrivilegedCommandIsolationPipeProtocol.ReleaseResponse,
            Reservation.Request.RequestId,
            new ReleaseRequestPayload(
              Reservation.Request,
              Reservation.SignedLease,
              outcome),
            cancellationToken).ConfigureAwait(false);
        var verified = _verifier.VerifyPreBindRelease(
          Reservation,
          response.SignedRelease);
        if (!verified.IsValid
          || verified.Value is null
          || !string.Equals(
            verified.Value.SignedRelease.Release.Outcome,
            outcome,
            StringComparison.Ordinal))
        {
          return null;
        }

        _release = verified.Value;
        _phase = SessionPhase.Released;
        return _release;
      }
      finally
      {
        _stateGate.Release();
      }
    }

    public async ValueTask<VerifiedPrivilegedCommandIsolationBindAcknowledgement?>
      TryBindSuspendedProcessAsync(
        PrivilegedCommandSuspendedProcessObservation observation,
        CancellationToken cancellationToken)
    {
      ArgumentNullException.ThrowIfNull(observation);
      await _stateGate.WaitAsync(cancellationToken).ConfigureAwait(false);
      try
      {
        EnsureNotDisposed();
        if (_phase == SessionPhase.Bound)
        {
          return ObservationMatches(_bind!, observation)
            ? _bind
            : throw new InvalidOperationException(
              "A reservation cannot be bound to two different processes.");
        }
        EnsurePhase(SessionPhase.Reserved, "suspended-process bind");
        if (!observation.CreatedSuspended || !observation.AssignedToJob)
        {
          throw new ArgumentException(
            "The child must still be suspended and assigned to its job.",
            nameof(observation));
        }

        var response = await _exchange.ExchangeAsync<BindRequestPayload,
          BindResponsePayload>(
            PrivilegedCommandIsolationPipeProtocol.BindRequest,
            PrivilegedCommandIsolationPipeProtocol.BindResponse,
            Reservation.Request.RequestId,
            new BindRequestPayload(
              Reservation.Request,
              Reservation.SignedLease,
              observation,
              _invocation),
            cancellationToken).ConfigureAwait(false);
        var verified = _verifier.VerifyBindAcknowledgement(
          Reservation,
          response.Binding,
          response.SignedAcknowledgement);
        if (!verified.IsValid
          || verified.Value is null
          || !PrivilegedCommandTrustedRootIsolationVerifier.BindMatches(
            verified.Value,
            Reservation,
            observation))
        {
          return null;
        }

        _bind = verified.Value;
        _phase = SessionPhase.Bound;
        return _bind;
      }
      finally
      {
        _stateGate.Release();
      }
    }

    public async ValueTask<VerifiedPrivilegedCommandIsolationTerminalReceipt?>
      TrySettleAsync(
        VerifiedPrivilegedCommandIsolationBindAcknowledgement bindAcknowledgement,
        PrivilegedCommandTerminalObservation observation,
        CancellationToken cancellationToken)
    {
      ArgumentNullException.ThrowIfNull(bindAcknowledgement);
      ArgumentNullException.ThrowIfNull(observation);
      await _stateGate.WaitAsync(cancellationToken).ConfigureAwait(false);
      try
      {
        EnsureNotDisposed();
        if (_phase == SessionPhase.Settled)
        {
          return BindIsExact(bindAcknowledgement)
            && TerminalObservationMatches(_terminal!, observation)
            ? _terminal
            : throw new InvalidOperationException(
              "A process cannot be settled with conflicting evidence.");
        }
        EnsurePhase(SessionPhase.Bound, "terminal settlement");
        if (!BindIsExact(bindAcknowledgement))
        {
          throw new InvalidOperationException(
            "Terminal settlement requires this session's exact bind acknowledgement.");
        }

        var response = await _exchange.ExchangeAsync<SettleRequestPayload,
          SettleResponsePayload>(
            PrivilegedCommandIsolationPipeProtocol.SettleRequest,
            PrivilegedCommandIsolationPipeProtocol.SettleResponse,
            Reservation.Request.RequestId,
            new SettleRequestPayload(
              Reservation.Request,
              Reservation.SignedLease,
              _bind!.Binding,
              _bind.SignedAcknowledgement,
              observation),
            cancellationToken).ConfigureAwait(false);
        var verified = _verifier.VerifyTerminalReceipt(
          _bind,
          response.SignedReceipt);
        if (!verified.IsValid
          || verified.Value is null
          || !PrivilegedCommandTrustedRootIsolationVerifier.TerminalReceiptMatches(
            verified.Value,
            _bind,
            observation))
        {
          return null;
        }

        _terminal = verified.Value;
        _phase = SessionPhase.Settled;
        return _terminal;
      }
      finally
      {
        _stateGate.Release();
      }
    }

    public async ValueTask DisposeAsync()
    {
      await _stateGate.WaitAsync().ConfigureAwait(false);
      try
      {
        if (_phase != SessionPhase.Disposed)
        {
          _phase = SessionPhase.Disposed;
          await _exchange.DisposeAsync().ConfigureAwait(false);
        }
      }
      finally
      {
        _stateGate.Release();
      }
    }

    private bool BindIsExact(
      VerifiedPrivilegedCommandIsolationBindAcknowledgement candidate) =>
      _bind is not null
      && PayloadDigest.FixedTimeEqualsHex(
        _bind.AcknowledgementSha256,
        candidate.AcknowledgementSha256);

    private static bool ObservationMatches(
      VerifiedPrivilegedCommandIsolationBindAcknowledgement bind,
      PrivilegedCommandSuspendedProcessObservation observation) =>
      PrivilegedCommandTrustedRootIsolationVerifier.BindMatches(
        bind,
        bind.Reservation,
        observation);

    private static bool TerminalObservationMatches(
      VerifiedPrivilegedCommandIsolationTerminalReceipt receipt,
      PrivilegedCommandTerminalObservation observation) =>
      PrivilegedCommandTrustedRootIsolationVerifier.TerminalReceiptMatches(
        receipt,
        receipt.BindAcknowledgement,
        observation);

    private void EnsureNotDisposed() =>
      ObjectDisposedException.ThrowIf(_phase == SessionPhase.Disposed, this);

    private void EnsurePhase(SessionPhase expected, string operation)
    {
      if (_phase != expected)
      {
        throw new InvalidOperationException(
          $"Isolation lifecycle phase {_phase} cannot perform {operation}.");
      }
    }
  }

  private enum SessionPhase
  {
    Reserved = 0,
    Released = 1,
    Bound = 2,
    Settled = 3,
    Disposed = 4,
  }
}

internal static class PrivilegedCommandIsolationPipeProtocol
{
  public const int Version = 2;
  public const int MinimumFrameBytes = 4_096;
  public const int AbsoluteMaximumFrameBytes = 262_144;

  public const string ReserveRequest = "reserve.request.v2";
  public const string ReserveResponse = "reserve.response.v2";
  public const string ReleaseRequest = "pre-bind-release.request.v2";
  public const string ReleaseResponse = "pre-bind-release.response.v2";
  public const string BindRequest = "suspended-bind.request.v2";
  public const string BindResponse = "suspended-bind.response.v2";
  public const string SettleRequest = "terminal-settle.request.v2";
  public const string SettleResponse = "terminal-settle.response.v2";
  public const string RecoverReservationRequest =
    "recover-pending-reservation.request.v2";
  public const string RecoverReservationResponse =
    "recover-pending-reservation.response.v2";
  public const string RecoverBindRequest = "recover-pending-bind.request.v2";
  public const string RecoverBindResponse = "recover-pending-bind.response.v2";

  public static bool IsSafePipeName(string value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 240
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_');
}

internal sealed record PrivilegedCommandIsolationPipeFrameV1(
  int ProtocolVersion,
  long Sequence,
  string Kind,
  string MessageId,
  string CorrelationId,
  string PayloadJson);

internal sealed record ReserveRequestPayload(
  PrivilegedCommandIsolationReservationRequestV1 Request,
  string CompactActionToken,
  ActionRequest ActionRequest,
  PrivilegedCommandIsolationInvocationV2 Invocation);

internal sealed record ReserveResponsePayload(
  SignedPrivilegedCommandIsolationReservationLease SignedLease);

internal sealed record ReleaseRequestPayload(
  PrivilegedCommandIsolationReservationRequestV1 Request,
  SignedPrivilegedCommandIsolationReservationLease SignedLease,
  string Outcome);

internal sealed record ReleaseResponsePayload(
  SignedPrivilegedCommandIsolationPreBindRelease SignedRelease);

internal sealed record BindRequestPayload(
  PrivilegedCommandIsolationReservationRequestV1 Request,
  SignedPrivilegedCommandIsolationReservationLease SignedLease,
  PrivilegedCommandSuspendedProcessObservation Observation,
  PrivilegedCommandIsolationInvocationV2 Invocation);

internal sealed record BindResponsePayload(
  PrivilegedCommandSuspendedProcessBindingV1 Binding,
  SignedPrivilegedCommandIsolationBindAcknowledgement SignedAcknowledgement);

internal sealed record SettleRequestPayload(
  PrivilegedCommandIsolationReservationRequestV1 Request,
  SignedPrivilegedCommandIsolationReservationLease SignedLease,
  PrivilegedCommandSuspendedProcessBindingV1 Binding,
  SignedPrivilegedCommandIsolationBindAcknowledgement SignedAcknowledgement,
  PrivilegedCommandTerminalObservation Observation);

internal sealed record SettleResponsePayload(
  SignedPrivilegedCommandIsolationTerminalReceipt SignedReceipt);

internal sealed record RecoverReservationRequestPayload(
  PrivilegedCommandIsolationPendingReservation Pending);

internal sealed record RecoverBindRequestPayload(
  PrivilegedCommandIsolationPendingBind Pending);

internal interface IPrivilegedCommandIsolationPipeConnector
{
  ValueTask<IPrivilegedCommandIsolationPipeConnection> ConnectAsync(
    PrivilegedCommandTrustedRootPipeClientOptions options,
    CancellationToken cancellationToken);
}

internal interface IPrivilegedCommandIsolationPipeConnection : IAsyncDisposable
{
  ValueTask WriteFrameAsync(
    ReadOnlyMemory<byte> frame,
    CancellationToken cancellationToken);

  ValueTask<ReadOnlyMemory<byte>> ReadFrameAsync(
    int maximumFrameBytes,
    CancellationToken cancellationToken);
}

internal sealed class PrivilegedCommandIsolationPipeExchange : IAsyncDisposable
{
  private static readonly JsonSerializerOptions SerializerOptions = new(
    JsonSerializerDefaults.Web)
  {
    MaxDepth = 32,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
  };

  private readonly IPrivilegedCommandIsolationPipeConnection _connection;
  private readonly int _maximumFrameBytes;
  private readonly TimeSpan _operationTimeout;
  private readonly SemaphoreSlim _gate = new(1, 1);
  private long _sequence;
  private int _disposed;

  public PrivilegedCommandIsolationPipeExchange(
    IPrivilegedCommandIsolationPipeConnection connection,
    int maximumFrameBytes,
    TimeSpan operationTimeout)
  {
    _connection = connection;
    _maximumFrameBytes = maximumFrameBytes;
    _operationTimeout = operationTimeout;
  }

  public async ValueTask<TResponse> ExchangeAsync<TRequest, TResponse>(
    string requestKind,
    string responseKind,
    string correlationId,
    TRequest payload,
    CancellationToken cancellationToken)
  {
    ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    byte[]? requestBytes = null;
    try
    {
      ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
      using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
        cancellationToken);
      timeout.CancelAfter(_operationTimeout);
      var sequence = checked(++_sequence);
      var payloadJson = JsonSerializer.Serialize(payload, SerializerOptions);
      var request = new PrivilegedCommandIsolationPipeFrameV1(
        PrivilegedCommandIsolationPipeProtocol.Version,
        sequence,
        requestKind,
        Guid.NewGuid().ToString("D"),
        correlationId,
        payloadJson);
      requestBytes = JsonSerializer.SerializeToUtf8Bytes(request, SerializerOptions);
      if (requestBytes.Length > _maximumFrameBytes)
      {
        throw new InvalidDataException("The isolation request frame is oversized.");
      }

      await _connection.WriteFrameAsync(requestBytes, timeout.Token).ConfigureAwait(false);
      var responseBytes = await _connection.ReadFrameAsync(
        _maximumFrameBytes,
        timeout.Token).ConfigureAwait(false);
      if (responseBytes.IsEmpty || responseBytes.Length > _maximumFrameBytes)
      {
        throw new InvalidDataException("The isolation response frame is invalid.");
      }

      PrivilegedCommandIsolationPipeFrameV1 response;
      try
      {
        response = JsonSerializer.Deserialize<PrivilegedCommandIsolationPipeFrameV1>(
          responseBytes.Span,
          SerializerOptions) ?? throw new JsonException();
      }
      catch (JsonException exception)
      {
        throw new InvalidDataException(
          "The isolation response frame is malformed.",
          exception);
      }

      if (response.ProtocolVersion != PrivilegedCommandIsolationPipeProtocol.Version
        || response.Sequence != sequence
        || !string.Equals(response.Kind, responseKind, StringComparison.Ordinal)
        || !IsCanonicalGuid(response.MessageId)
        || !string.Equals(
          response.CorrelationId,
          correlationId,
          StringComparison.Ordinal))
      {
        throw new InvalidDataException(
          "The isolation response frame is out of phase or uncorrelated.");
      }

      try
      {
        return JsonSerializer.Deserialize<TResponse>(
          response.PayloadJson,
          SerializerOptions) ?? throw new JsonException();
      }
      catch (JsonException exception)
      {
        throw new InvalidDataException(
          "The isolation response payload is malformed.",
          exception);
      }
    }
    catch
    {
      Interlocked.Exchange(ref _disposed, 1);
      await _connection.DisposeAsync().ConfigureAwait(false);
      throw;
    }
    finally
    {
      if (requestBytes is not null)
      {
        CryptographicOperations.ZeroMemory(requestBytes);
      }
      _gate.Release();
    }
  }

  public async ValueTask DisposeAsync()
  {
    if (Interlocked.Exchange(ref _disposed, 1) == 0)
    {
      await _connection.DisposeAsync().ConfigureAwait(false);
    }
    _gate.Dispose();
  }

  internal static byte[] SerializeResponse<T>(
    long sequence,
    string kind,
    string correlationId,
    T payload) => JsonSerializer.SerializeToUtf8Bytes(
      new PrivilegedCommandIsolationPipeFrameV1(
        PrivilegedCommandIsolationPipeProtocol.Version,
        sequence,
        kind,
        Guid.NewGuid().ToString("D"),
        correlationId,
        JsonSerializer.Serialize(payload, SerializerOptions)),
      SerializerOptions);

  internal static PrivilegedCommandIsolationPipeFrameV1 DeserializeRequest(
    ReadOnlySpan<byte> bytes) =>
    JsonSerializer.Deserialize<PrivilegedCommandIsolationPipeFrameV1>(
      bytes,
      SerializerOptions) ?? throw new InvalidDataException();

  internal static T DeserializePayload<T>(string json) =>
    JsonSerializer.Deserialize<T>(json, SerializerOptions)
      ?? throw new InvalidDataException();

  private static bool IsCanonicalGuid(string value) =>
    Guid.TryParseExact(value, "D", out var parsed)
    && string.Equals(parsed.ToString("D"), value, StringComparison.Ordinal);
}

internal sealed class WindowsPrivilegedCommandIsolationPipeConnector :
  IPrivilegedCommandIsolationPipeConnector
{
  public async ValueTask<IPrivilegedCommandIsolationPipeConnection> ConnectAsync(
    PrivilegedCommandTrustedRootPipeClientOptions options,
    CancellationToken cancellationToken)
  {
    TrustedSupervisorProcessAccessGrant.Ensure(options.ExpectedSupervisorServiceSid);
    var pipe = new NamedPipeClientStream(
      ".",
      options.PipeName,
      PipeDirection.InOut,
      PipeOptions.Asynchronous | PipeOptions.WriteThrough,
      TokenImpersonationLevel.Identification);
    try
    {
      await pipe.ConnectAsync(cancellationToken).ConfigureAwait(false);
      var identity = ValidateServerIdentity(pipe.SafePipeHandle, options);
      return new WindowsPipeConnection(pipe, identity.Process, identity.ImageLock);
    }
    catch
    {
      await pipe.DisposeAsync().ConfigureAwait(false);
      throw;
    }
  }

  private static ServerIdentityLease ValidateServerIdentity(
    SafePipeHandle pipe,
    PrivilegedCommandTrustedRootPipeClientOptions options)
  {
    if (!GetNamedPipeServerProcessId(pipe, out var processId)
      || processId is 0 or > int.MaxValue
      || !ProcessIdToSessionId(processId, out var sessionId)
      || sessionId != 0)
    {
      throw new UnauthorizedAccessException(
        "The trusted-root isolation pipe server identity is unavailable.");
    }

    var process = OpenProcess(
      ProcessQueryInformation | Synchronize,
      inheritHandle: false,
      processId);
    if (process.IsInvalid || WaitForSingleObject(process, 0) != WaitTimeout)
    {
      process.Dispose();
      throw new UnauthorizedAccessException(
        "The trusted-root isolation pipe server process is not live.");
    }

    FileStream? imageLock = null;
    try
    {
      ValidateRestrictedServiceProcess(
        process,
        options.ExpectedSupervisorServiceSid);
      var observedPath = QueryProcessImagePath(process);
      var expectedPath = Path.GetFullPath(options.ExpectedSupervisorImagePath);
      if (!string.Equals(observedPath, expectedPath, StringComparison.OrdinalIgnoreCase))
      {
        throw new UnauthorizedAccessException(
          "The trusted-root isolation pipe server image path is not pinned.");
      }

      EnsurePathHasNoReparsePoints(expectedPath);
      imageLock = OpenAndBindMappedImage(process, expectedPath);
      var observedSha256 = Convert.ToHexString(SHA256.HashData(imageLock))
        .ToLowerInvariant();
      if (!PayloadDigest.FixedTimeEqualsHex(
        observedSha256,
        options.ExpectedSupervisorImageSha256))
      {
        throw new UnauthorizedAccessException(
          "The trusted-root isolation pipe server image measurement is not pinned.");
      }
      imageLock.Position = 0;
      return new ServerIdentityLease(process, imageLock);
    }
    catch
    {
      imageLock?.Dispose();
      process.Dispose();
      throw;
    }
  }

  private static FileStream OpenAndBindMappedImage(
    SafeProcessHandle process,
    string expectedPath)
  {
    var handle = CreateFile(
      expectedPath,
      GenericRead | FileExecute | Synchronize,
      FileShareRead,
      IntPtr.Zero,
      OpenExisting,
      FileAttributeNormal | FileFlagSequentialScan,
      IntPtr.Zero);
    if (handle.IsInvalid)
    {
      var error = Marshal.GetLastWin32Error();
      handle.Dispose();
      throw new Win32Exception(error);
    }

    try
    {
      if (!GetFileInformationByHandle(handle, out var information)
        || information.NumberOfLinks != 1
        || (information.FileAttributes & FileAttributeReparsePoint) != 0
        || (information.FileAttributes & FileAttributeDirectory) != 0)
      {
        throw new UnauthorizedAccessException(
          "The trusted-root supervisor image file identity is unsafe.");
      }

      // Compare the retained file object with the exact mapped image section.
      // A pathname lookup and hash alone would permit a post-launch rename or
      // replacement to authenticate bytes the process is not executing.
      var fileHandle = handle.DangerousGetHandle();
      var status = NtQueryInformationProcess(
        process,
        ProcessImageFileMapping,
        ref fileHandle,
        IntPtr.Size,
        IntPtr.Zero);
      if (status != NtStatusSuccess)
      {
        throw new UnauthorizedAccessException(
          "The trusted-root supervisor mapped image does not match the measured file.");
      }

      var finalPath = GetFinalPath(handle);
      if (!string.Equals(
          finalPath,
          Path.GetFullPath(expectedPath),
          StringComparison.OrdinalIgnoreCase))
      {
        throw new UnauthorizedAccessException(
          "The trusted-root supervisor image handle resolved to an unexpected path.");
      }
      return new FileStream(handle, FileAccess.Read, 16_384, isAsync: false);
    }
    catch
    {
      handle.Dispose();
      throw;
    }
  }

  private static string GetFinalPath(SafeFileHandle handle)
  {
    var buffer = new char[32_768];
    uint length;
    unsafe
    {
      fixed (char* pointer = buffer)
      {
        length = GetFinalPathNameByHandle(
          handle,
          pointer,
          checked((uint)buffer.Length),
          0);
      }
    }
    if (length == 0 || length >= buffer.Length)
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    var path = new string(buffer, 0, checked((int)length));
    return path.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)
      ? @"\\" + path[8..]
      : path.StartsWith(@"\\?\", StringComparison.Ordinal)
        ? path[4..]
        : path;
  }

  private static void ValidateRestrictedServiceProcess(
    SafeProcessHandle process,
    string expectedServiceSid)
  {
    if (!OpenProcessToken(
        process.DangerousGetHandle(),
        TokenAccessLevels.Query,
        out var token))
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    using (token)
    {
      var serviceSid = new SecurityIdentifier(expectedServiceSid);
      if (!RestrictedServicePeerTokenValidator.IsExactRestrictedService(
          token,
          serviceSid))
      {
        throw new UnauthorizedAccessException(
          "The trusted-root isolation pipe server is not the exact restricted service.");
      }
    }
  }

  private static string QueryProcessImagePath(SafeProcessHandle process)
  {
    var length = 32_768u;
    var buffer = new char[length];
    bool queried;
    unsafe
    {
      fixed (char* bufferPointer = buffer)
      {
        queried = QueryFullProcessImageName(process, 0, bufferPointer, ref length);
      }
    }
    if (!queried || length == 0)
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    return Path.GetFullPath(new string(buffer, 0, checked((int)length)));
  }

  private static void EnsurePathHasNoReparsePoints(string filePath)
  {
    if ((File.GetAttributes(filePath) & FileAttributes.ReparsePoint) != 0)
    {
      throw new UnauthorizedAccessException(
        "The trusted-root supervisor image is a reparse point.");
    }

    var directory = Directory.GetParent(filePath);
    while (directory is not null)
    {
      if ((directory.Attributes & FileAttributes.ReparsePoint) != 0)
      {
        throw new UnauthorizedAccessException(
          "The trusted-root supervisor image has a reparse-point ancestor.");
      }
      directory = directory.Parent;
    }
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetNamedPipeServerProcessId(
    SafePipeHandle pipe,
    out uint serverProcessId);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool ProcessIdToSessionId(uint processId, out uint sessionId);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern SafeProcessHandle OpenProcess(
    uint desiredAccess,
    [MarshalAs(UnmanagedType.Bool)] bool inheritHandle,
    uint processId);

  [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode,
    SetLastError = true)]
  private static extern SafeFileHandle CreateFile(
    string fileName,
    uint desiredAccess,
    uint shareMode,
    IntPtr securityAttributes,
    uint creationDisposition,
    uint flagsAndAttributes,
    IntPtr templateFile);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetFileInformationByHandle(
    SafeFileHandle file,
    out ByHandleFileInformation fileInformation);

  [DllImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW",
    CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern unsafe uint GetFinalPathNameByHandle(
    SafeFileHandle file,
    char* filePath,
    uint filePathLength,
    uint flags);

  [DllImport("ntdll.dll")]
  private static extern int NtQueryInformationProcess(
    SafeProcessHandle process,
    int processInformationClass,
    ref IntPtr processInformation,
    int processInformationLength,
    IntPtr returnLength);

  [DllImport("advapi32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool OpenProcessToken(
    IntPtr processHandle,
    TokenAccessLevels desiredAccess,
    out SafeAccessTokenHandle tokenHandle);

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern unsafe bool QueryFullProcessImageName(
    SafeProcessHandle process,
    int flags,
    char* executableName,
    ref uint size);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern uint WaitForSingleObject(SafeProcessHandle handle, uint milliseconds);

  private const uint ProcessQueryInformation = 0x0400;
  private const uint Synchronize = 0x00100000;
  private const uint WaitTimeout = 0x00000102;
  private const uint GenericRead = 0x80000000;
  private const uint FileExecute = 0x00000020;
  private const uint FileShareRead = 0x00000001;
  private const uint OpenExisting = 3;
  private const uint FileAttributeDirectory = 0x00000010;
  private const uint FileAttributeNormal = 0x00000080;
  private const uint FileAttributeReparsePoint = 0x00000400;
  private const uint FileFlagSequentialScan = 0x08000000;
  private const int ProcessImageFileMapping = 44;
  private const int NtStatusSuccess = 0;

  [StructLayout(LayoutKind.Sequential)]
  private struct ByHandleFileInformation
  {
    public uint FileAttributes;
    public uint CreationTimeLow;
    public uint CreationTimeHigh;
    public uint LastAccessTimeLow;
    public uint LastAccessTimeHigh;
    public uint LastWriteTimeLow;
    public uint LastWriteTimeHigh;
    public uint VolumeSerialNumber;
    public uint FileSizeHigh;
    public uint FileSizeLow;
    public uint NumberOfLinks;
    public uint FileIndexHigh;
    public uint FileIndexLow;
  }

  private sealed record ServerIdentityLease(
    SafeProcessHandle Process,
    FileStream ImageLock);

  private sealed class WindowsPipeConnection :
    IPrivilegedCommandIsolationPipeConnection
  {
    private readonly NamedPipeClientStream _pipe;
    private readonly SafeProcessHandle _serverProcess;
    private readonly FileStream _serverImageLock;
    private int _disposed;

    public WindowsPipeConnection(
      NamedPipeClientStream pipe,
      SafeProcessHandle serverProcess,
      FileStream serverImageLock)
    {
      _pipe = pipe;
      _serverProcess = serverProcess;
      _serverImageLock = serverImageLock;
    }

    public async ValueTask WriteFrameAsync(
      ReadOnlyMemory<byte> frame,
      CancellationToken cancellationToken)
    {
      ThrowIfUnavailable();
      var prefix = new byte[sizeof(int)];
      BinaryPrimitives.WriteInt32BigEndian(prefix, frame.Length);
      await _pipe.WriteAsync(prefix, cancellationToken).ConfigureAwait(false);
      await _pipe.WriteAsync(frame, cancellationToken).ConfigureAwait(false);
      await _pipe.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    public async ValueTask<ReadOnlyMemory<byte>> ReadFrameAsync(
      int maximumFrameBytes,
      CancellationToken cancellationToken)
    {
      ThrowIfUnavailable();
      var prefix = new byte[sizeof(int)];
      await ReadExactlyAsync(prefix, cancellationToken).ConfigureAwait(false);
      var length = BinaryPrimitives.ReadInt32BigEndian(prefix);
      if (length <= 0 || length > maximumFrameBytes)
      {
        throw new InvalidDataException("The isolation pipe frame length is invalid.");
      }
      var frame = new byte[length];
      await ReadExactlyAsync(frame, cancellationToken).ConfigureAwait(false);
      return frame;
    }

    public async ValueTask DisposeAsync()
    {
      if (Interlocked.Exchange(ref _disposed, 1) == 0)
      {
        _serverImageLock.Dispose();
        _serverProcess.Dispose();
        await _pipe.DisposeAsync().ConfigureAwait(false);
      }
    }

    private async ValueTask ReadExactlyAsync(
      Memory<byte> buffer,
      CancellationToken cancellationToken)
    {
      var read = 0;
      while (read < buffer.Length)
      {
        var count = await _pipe.ReadAsync(buffer[read..], cancellationToken)
          .ConfigureAwait(false);
        if (count == 0)
        {
          throw new EndOfStreamException(
            "The trusted-root isolation pipe disconnected mid-frame.");
        }
        read += count;
      }
    }

    private void ThrowIfUnavailable()
    {
      ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
      if (!_pipe.IsConnected || WaitForSingleObject(_serverProcess, 0) != WaitTimeout)
      {
        throw new EndOfStreamException(
          "The trusted-root isolation pipe server disconnected.");
      }
    }
  }
}
