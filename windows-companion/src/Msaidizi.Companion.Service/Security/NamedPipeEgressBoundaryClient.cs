using System.Buffers.Binary;
using System.ComponentModel;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;
using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Microsoft.Extensions.Options;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.Security;

internal static class EgressBoundaryClientFactory
{
  public static IEgressBoundaryClient Create(
    IOptions<EgressSupervisorClientOptions> clientOptions,
    IOptions<CompanionOptions> companionOptions,
    IOptions<EgressAttestationTrustOptions> trustOptions)
  {
    var client = clientOptions.Value;
    return NamedPipeEgressBoundaryClient.IsProductionReady(
      client,
      companionOptions.Value,
      trustOptions.Value)
        ? new NamedPipeEgressBoundaryClient(client)
        : new DisabledEgressBoundaryClient();
  }
}

/// <summary>
/// Default-off client for a separately signed LocalSystem egress supervisor.
/// The pipe peer is pinned before the compact action token is written. This
/// class transports signed lifecycle evidence; it does not implement or claim
/// WFP, proxy, process-tree, or browser enforcement.
/// </summary>
internal sealed class NamedPipeEgressBoundaryClient : IEgressBoundaryClient
{
  internal const string TransportName = "named-pipe-v2";
  private readonly EgressSupervisorClientOptions _options;
  private readonly IEgressSupervisorPipeConnector _connector;
  private readonly TimeProvider _timeProvider;

  public NamedPipeEgressBoundaryClient(
    EgressSupervisorClientOptions options,
    TimeProvider? timeProvider = null)
    : this(options, new WindowsEgressSupervisorPipeConnector(), timeProvider)
  {
  }

  internal NamedPipeEgressBoundaryClient(
    EgressSupervisorClientOptions options,
    IEgressSupervisorPipeConnector connector,
    TimeProvider? timeProvider = null)
  {
    ArgumentNullException.ThrowIfNull(options);
    ArgumentNullException.ThrowIfNull(connector);
    _options = options;
    _connector = connector;
    _timeProvider = timeProvider ?? TimeProvider.System;
  }

  public async ValueTask<SignedCapabilityBoundaryAttestation?>
    TryAttestCapabilitiesAsync(
      CapabilityBoundaryAttestationRequestV1 request,
      CancellationToken cancellationToken)
  {
    ValidateRuntimeConfiguration();
    ArgumentNullException.ThrowIfNull(request);
    if (request.ContractVersion != CapabilityBoundaryAttestationContract.Version
      || !Guid.TryParseExact(request.RequestId, "D", out _)
      || !IsCanonicalSha256(request.RequestNonceSha256)
      || !IsCanonicalSha256(request.SubjectImageSha256)
      || !IsCanonicalSha256(request.CapabilityManifestSha256)
      || !IsCanonicalSha256(request.DestinationPolicySha256))
    {
      throw new ArgumentException(
        "The capability-attestation request is not canonical.",
        nameof(request));
    }

    var response = await ExchangeAsync<
      EgressCapabilityAttestationRequestPayload,
      EgressCapabilityAttestationResponsePayload>(
        EgressSupervisorPipeProtocol.CapabilityAttestationRequest,
        EgressSupervisorPipeProtocol.CapabilityAttestationResponse,
        request.RequestId,
        new EgressCapabilityAttestationRequestPayload(request),
        cancellationToken).ConfigureAwait(false);
    var signed = response.Attestation;
    return string.Equals(
        signed.Attestation.RequestId,
        request.RequestId,
        StringComparison.Ordinal)
      && PayloadDigest.FixedTimeEqualsHex(
        signed.Attestation.RequestNonceSha256,
        request.RequestNonceSha256)
      && string.Equals(signed.KeyId, _options.AttestationKeyId,
        StringComparison.Ordinal)
      && string.Equals(
        signed.SignaturePurpose,
        CapabilityBoundaryAttestationContract.SignaturePurpose,
        StringComparison.Ordinal)
        ? signed
        : null;
  }

  public async ValueTask<IEgressBoundarySession?> TryReserveAsync(
    string compactActionToken,
    string argumentsJsonUtf8,
    EgressActionBinding binding,
    CancellationToken cancellationToken)
  {
    ValidateRuntimeConfiguration();
    ValidateActionBinding(binding);
    if (string.IsNullOrWhiteSpace(compactActionToken)
      || compactActionToken.Length > 131_072
      || !PayloadDigest.FixedTimeEqualsHex(
        PayloadDigest.Sha256Hex(compactActionToken),
        binding.ActionTokenSha256)
      || string.IsNullOrWhiteSpace(argumentsJsonUtf8)
      || argumentsJsonUtf8.Length > 1_048_576
      || !PayloadDigest.FixedTimeEqualsHex(
        PayloadDigest.Sha256Hex(argumentsJsonUtf8),
        binding.ArgumentsSha256))
    {
      throw new ArgumentException(
        "The compact action token does not match the egress binding.",
        nameof(compactActionToken));
    }

    var operationId = EgressSupervisorLifecycleCanonical.OperationId(
      binding.ActionId,
      "reserve");
    var response = await ExchangeAsync<EgressReserveRequestPayload, EgressReserveResponsePayload>(
      EgressSupervisorPipeProtocol.ReserveRequest,
      EgressSupervisorPipeProtocol.ReserveResponse,
      operationId,
      new EgressReserveRequestPayload(
        EgressSupervisorLifecycleContract.Version,
        operationId,
        compactActionToken,
        argumentsJsonUtf8,
        binding),
      cancellationToken).ConfigureAwait(false);
    if (!AuthorizationMatches(response.Authorization, binding))
    {
      return null;
    }

    return new Session(this, binding, response.Authorization, _timeProvider);
  }

  public ValueTask<IEgressBoundarySession?> TryResumeAsync(
    EgressExecutionAuthorization authorization,
    EgressActionBinding binding,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    ValidateRuntimeConfiguration();
    ValidateActionBinding(binding);
    return ValueTask.FromResult<IEgressBoundarySession?>(
      AuthorizationMatches(authorization, binding)
        ? new Session(this, binding, authorization, _timeProvider)
        : null);
  }

  internal static bool IsProductionReady(
    EgressSupervisorClientOptions options,
    CompanionOptions companion,
    EgressAttestationTrustOptions trust)
  {
    ArgumentNullException.ThrowIfNull(options);
    ArgumentNullException.ThrowIfNull(companion);
    ArgumentNullException.ThrowIfNull(trust);
    return OperatingSystem.IsWindows()
      && options.Enabled
      && string.Equals(options.Transport, TransportName, StringComparison.Ordinal)
      && options.ProtocolVersion == EgressSupervisorPipeProtocol.Version
      && EgressSupervisorPipeProtocol.IsSafePipeName(options.PipeName)
      && IsSafeAbsoluteLocalPath(options.ExpectedSupervisorImagePath)
      && IsCanonicalSha256(options.ExpectedSupervisorImageSha256)
      && string.Equals(
        options.ExpectedSupervisorServiceSid,
        EgressSupervisorClientOptions.RequiredSupervisorServiceSid,
        StringComparison.Ordinal)
      && IsSafeToken(options.AttestationKeyId, 128)
      && IsCanonicalSha256(options.ExpectedSupervisorPipeSecuritySha256)
      && options.MaximumFrameBytes
        is >= EgressSupervisorPipeProtocol.MinimumFrameBytes
        and <= EgressSupervisorPipeProtocol.AbsoluteMaximumFrameBytes
      && options.ConnectTimeoutMilliseconds is >= 100 and <= 30_000
      && options.OperationTimeoutMilliseconds is >= 100 and <= 30_000
      && IsCanonicalSha256(companion.EgressDestinationPolicySha256)
      && IsCanonicalSha256(companion.EgressExecutionIdentitySha256)
      && trust.Enabled
      && trust.TrustedSupervisorCertificates.Count(entry => string.Equals(
        entry.KeyId,
        options.AttestationKeyId,
        StringComparison.Ordinal)) == 1;
  }

  private async ValueTask<TResponse> ExchangeAsync<TRequest, TResponse>(
    string requestKind,
    string responseKind,
    string correlationId,
    TRequest payload,
    CancellationToken cancellationToken)
  {
    using var connectTimeout = CancellationTokenSource.CreateLinkedTokenSource(
      cancellationToken);
    connectTimeout.CancelAfter(_options.ConnectTimeoutMilliseconds);
    await using var connection = await _connector.ConnectAsync(
      _options,
      connectTimeout.Token).ConfigureAwait(false);
    return await EgressSupervisorPipeExchange.ExchangeAsync<TRequest, TResponse>(
      connection,
      _options.MaximumFrameBytes,
      TimeSpan.FromMilliseconds(_options.OperationTimeoutMilliseconds),
      requestKind,
      responseKind,
      correlationId,
      payload,
      cancellationToken).ConfigureAwait(false);
  }

  private void ValidateRuntimeConfiguration()
  {
    if (!_options.Enabled
      || !string.Equals(_options.Transport, TransportName, StringComparison.Ordinal)
      || _options.ProtocolVersion != EgressSupervisorPipeProtocol.Version
      || !EgressSupervisorPipeProtocol.IsSafePipeName(_options.PipeName)
      || !IsSafeAbsoluteLocalPath(_options.ExpectedSupervisorImagePath)
      || !IsCanonicalSha256(_options.ExpectedSupervisorImageSha256)
      || !string.Equals(
        _options.ExpectedSupervisorServiceSid,
        EgressSupervisorClientOptions.RequiredSupervisorServiceSid,
        StringComparison.Ordinal)
      || !IsSafeToken(_options.AttestationKeyId, 128)
      || !IsCanonicalSha256(_options.ExpectedSupervisorPipeSecuritySha256)
      || _options.MaximumFrameBytes
        is < EgressSupervisorPipeProtocol.MinimumFrameBytes
        or > EgressSupervisorPipeProtocol.AbsoluteMaximumFrameBytes
      || _options.ConnectTimeoutMilliseconds is < 100 or > 30_000
      || _options.OperationTimeoutMilliseconds is < 100 or > 30_000)
    {
      throw new InvalidOperationException(
        "The egress supervisor client is not safely configured.");
    }
  }

  private static void ValidateActionBinding(EgressActionBinding binding)
  {
    ArgumentNullException.ThrowIfNull(binding);
    if (!IsCanonicalSha256(binding.ActionTokenSha256)
      || !IsSafeToken(binding.ActionId, 160)
      || !IsSafeToken(binding.TaskId, 160)
      || !IsSafeToken(binding.PlanVersionId, 160)
      || !IsSafeToken(binding.StepId, 160)
      || !IsSafeToken(binding.DeviceId, 160)
      || !IsSafeToken(binding.MandateId, 160)
      || !IsSafeToken(binding.CapabilityId, 160)
      || !IsSafeToken(binding.CapabilityVersion, 64)
      || binding.DispatchCount is < 1 or > 16
      || binding.ReservedCapabilityEgressBytes < 0
      || !IsCanonicalSha256(binding.DestinationPolicySha256)
      || !IsCanonicalSha256(binding.ExecutionIdentitySha256)
      || !IsCanonicalSha256(binding.ArgumentsSha256)
      || (binding.ExpectedPreStateSha256 is not null
        && !IsCanonicalSha256(binding.ExpectedPreStateSha256))
      || !IsCanonicalSha256(binding.IdempotencyKeySha256))
    {
      throw new ArgumentException("The egress action binding is not canonical.", nameof(binding));
    }
  }

  private bool AuthorizationMatches(
    EgressExecutionAuthorization authorization,
    EgressActionBinding binding)
  {
    var lease = authorization.Lease.Lease;
    return lease.ContractVersion == EgressBoundaryCanonical.ContractVersion
      && Exact(authorization.Attestation.KeyId, _options.AttestationKeyId)
      && PayloadDigest.FixedTimeEqualsHex(lease.ActionTokenSha256, binding.ActionTokenSha256)
      && Exact(lease.ActionId, binding.ActionId)
      && Exact(lease.TaskId, binding.TaskId)
      && Exact(lease.PlanVersionId, binding.PlanVersionId)
      && Exact(lease.StepId, binding.StepId)
      && Exact(lease.DeviceId, binding.DeviceId)
      && Exact(lease.MandateId, binding.MandateId)
      && Exact(lease.CapabilityId, binding.CapabilityId)
      && Exact(lease.CapabilityVersion, binding.CapabilityVersion)
      && lease.DispatchCount == binding.DispatchCount
      && lease.ReservedCapabilityEgressBytes == binding.ReservedCapabilityEgressBytes
      && PayloadDigest.FixedTimeEqualsHex(
        lease.DestinationPolicySha256,
        binding.DestinationPolicySha256)
      && PayloadDigest.FixedTimeEqualsHex(
        lease.ExecutionIdentitySha256,
        binding.ExecutionIdentitySha256)
      && PayloadDigest.FixedTimeEqualsHex(
        lease.ArgumentsSha256,
        binding.ArgumentsSha256)
      && OptionalDigestMatches(
        lease.ExpectedPreStateSha256,
        binding.ExpectedPreStateSha256)
      && PayloadDigest.FixedTimeEqualsHex(
        lease.IdempotencyKeySha256,
        binding.IdempotencyKeySha256);
  }

  private static bool Exact(string left, string right) =>
    string.Equals(left, right, StringComparison.Ordinal);

  private static bool OptionalDigestMatches(string? left, string? right) =>
    left is null || right is null
      ? left is null && right is null
      : PayloadDigest.FixedTimeEqualsHex(left, right);

  private static bool IsCanonicalSha256(string? value) =>
    PayloadDigest.IsSha256Hex(value)
    && string.Equals(value, value?.ToLowerInvariant(), StringComparison.Ordinal);

  private static bool IsSafeToken(string? value, int maximumLength) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= maximumLength
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_' or ':');

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

  private sealed class Session : IEgressBoundarySession
  {
    private readonly NamedPipeEgressBoundaryClient _client;
    private readonly EgressActionBinding _binding;
    private readonly TimeProvider _timeProvider;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private RegistrationState? _registration;
    private TerminalState? _terminal;
    private bool _disposed;

    public Session(
      NamedPipeEgressBoundaryClient client,
      EgressActionBinding binding,
      EgressExecutionAuthorization authorization,
      TimeProvider timeProvider)
    {
      _client = client;
      _binding = binding;
      _timeProvider = timeProvider;
      Authorization = authorization;
    }

    public EgressExecutionAuthorization Authorization { get; }

    public bool HasRegistration => _registration is not null;

    public bool IsTerminal => _terminal is not null;

    public SignedEgressReceipt? TerminalReceipt => _terminal?.Receipt;

    public ValueTask<EgressRegistrationAcknowledgementV1?> TryRegisterProcessAsync(
      EgressProcessRegistrationV1 registration,
      CancellationToken cancellationToken) => RegisterAsync(
        EgressSupervisorLifecycleContract.ProcessRegistration,
        registration.RegistrationId,
        EgressSupervisorLifecycleCanonical.RegistrationSha256(registration),
        new EgressProcessRegistrationRequestPayload(
          EgressSupervisorLifecycleContract.Version,
          Authorization,
          registration),
        EgressSupervisorPipeProtocol.ProcessRegisterRequest,
        () => Validate(registration),
        cancellationToken);

    public ValueTask<EgressRegistrationAcknowledgementV1?> TryRegisterDirectAsync(
      EgressDirectRegistrationV1 registration,
      CancellationToken cancellationToken) => RegisterAsync(
        EgressSupervisorLifecycleContract.DirectRegistration,
        registration.RegistrationId,
        EgressSupervisorLifecycleCanonical.RegistrationSha256(registration),
        new EgressDirectRegistrationRequestPayload(
          EgressSupervisorLifecycleContract.Version,
          Authorization,
          registration),
        EgressSupervisorPipeProtocol.DirectRegisterRequest,
        () =>
        {
          Validate(registration);
          if (!PayloadDigest.FixedTimeEqualsHex(
            registration.DestinationPolicySha256,
            _binding.DestinationPolicySha256))
          {
            throw new ArgumentException(
              "The direct registration destination policy does not match the lease.",
              nameof(registration));
          }
          if (!PayloadDigest.FixedTimeEqualsHex(
              registration.DestinationScopeSha256,
              Authorization.Lease.Lease.DestinationScopeSha256))
          {
            throw new ArgumentException(
              "The direct registration destination scope does not match the lease.",
              nameof(registration));
          }
        },
        cancellationToken);

    public ValueTask<EgressRegistrationAcknowledgementV1?> TryRegisterBrowserAsync(
      EgressBrowserRegistrationV1 registration,
      CancellationToken cancellationToken) => RegisterAsync(
        EgressSupervisorLifecycleContract.BrowserRegistration,
        registration.RegistrationId,
        EgressSupervisorLifecycleCanonical.RegistrationSha256(registration),
        new EgressBrowserRegistrationRequestPayload(
          EgressSupervisorLifecycleContract.Version,
          Authorization,
          registration),
        EgressSupervisorPipeProtocol.BrowserRegisterRequest,
        () => Validate(registration),
        cancellationToken);

    public ValueTask<SignedEgressReceipt?> TrySettleAsync(
      EgressTerminalDispositionV1 disposition,
      CancellationToken cancellationToken) => TerminalAsync(
        disposition,
        abort: false,
        cancellationToken);

    public ValueTask<SignedEgressReceipt?> TryAbortAsync(
      EgressTerminalDispositionV1 disposition,
      CancellationToken cancellationToken) => TerminalAsync(
        disposition,
        abort: true,
        cancellationToken);

    public async ValueTask DisposeAsync()
    {
      await _gate.WaitAsync().ConfigureAwait(false);
      try
      {
        _disposed = true;
      }
      finally
      {
        _gate.Release();
        _gate.Dispose();
      }
    }

    private async ValueTask<EgressRegistrationAcknowledgementV1?> RegisterAsync<TPayload>(
      string kind,
      string registrationId,
      string registrationSha256,
      TPayload payload,
      string requestKind,
      Action validate,
      CancellationToken cancellationToken)
    {
      validate();
      await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
      try
      {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_terminal is not null)
        {
          throw new InvalidOperationException(
            "A terminal egress session cannot register another boundary.");
        }
        if (_registration is not null)
        {
          return _registration.Matches(kind, registrationId, registrationSha256)
            ? _registration.Acknowledgement
            : throw new InvalidOperationException(
              "One egress reservation cannot register two different boundaries.");
        }

        var operationId = EgressSupervisorLifecycleCanonical.OperationId(
          _binding.ActionId,
          $"register:{kind}:{registrationId}");
        var response = await _client.ExchangeAsync<TPayload, EgressRegistrationResponsePayload>(
          requestKind,
          EgressSupervisorPipeProtocol.RegisterResponse,
          operationId,
          payload,
          cancellationToken).ConfigureAwait(false);
        var acknowledgement = response.Acknowledgement;
        if (!AcknowledgementMatches(
          acknowledgement,
          operationId,
          registrationId,
          kind,
          registrationSha256))
        {
          return null;
        }

        _registration = new RegistrationState(
          kind,
          registrationId,
          registrationSha256,
          acknowledgement);
        return acknowledgement;
      }
      finally
      {
        _gate.Release();
      }
    }

    private async ValueTask<SignedEgressReceipt?> TerminalAsync(
      EgressTerminalDispositionV1 disposition,
      bool abort,
      CancellationToken cancellationToken)
    {
      Validate(disposition);
      var dispositionSha256 = EgressSupervisorLifecycleCanonical.DispositionSha256(disposition);
      await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
      try
      {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_terminal is not null)
        {
          return _terminal.Matches(abort, dispositionSha256)
            ? _terminal.Receipt
            : throw new InvalidOperationException(
              "An egress reservation cannot have conflicting terminal operations.");
        }
        if (!abort && _registration is null)
        {
          throw new InvalidOperationException(
            "Egress settlement requires a supervisor-acknowledged registration.");
        }

        var registrationSha256 = _registration?.RegistrationSha256
          ?? EgressSupervisorLifecycleCanonical.ZeroSha256;
        var response = await _client.ExchangeAsync<EgressTerminalRequestPayload,
          EgressTerminalResponsePayload>(
            abort
              ? EgressSupervisorPipeProtocol.AbortRequest
              : EgressSupervisorPipeProtocol.SettleRequest,
            EgressSupervisorPipeProtocol.TerminalResponse,
            disposition.OperationId,
            new EgressTerminalRequestPayload(
              EgressSupervisorLifecycleContract.Version,
              Authorization,
              _registration?.Acknowledgement,
              disposition),
            cancellationToken).ConfigureAwait(false);
        if (!ReceiptMatches(response.Receipt, registrationSha256, dispositionSha256))
        {
          return null;
        }

        _terminal = new TerminalState(abort, dispositionSha256, response.Receipt);
        return response.Receipt;
      }
      finally
      {
        _gate.Release();
      }
    }

    private bool AcknowledgementMatches(
      EgressRegistrationAcknowledgementV1 acknowledgement,
      string operationId,
      string registrationId,
      string kind,
      string registrationSha256)
    {
      var lease = Authorization.Lease.Lease;
      var acceptedAt = acknowledgement.AcceptedAtUnixMilliseconds;
      var now = _timeProvider.GetUtcNow();
      return acknowledgement.ContractVersion == EgressSupervisorLifecycleContract.Version
        && Exact(acknowledgement.OperationId, operationId)
        && Exact(acknowledgement.RegistrationId, registrationId)
        && Exact(acknowledgement.RegistrationKind, kind)
        && PayloadDigest.FixedTimeEqualsHex(
          acknowledgement.LeaseSha256,
          EgressBoundaryCanonical.LeaseSha256(lease))
        && PayloadDigest.FixedTimeEqualsHex(
          acknowledgement.RegistrationSha256,
          registrationSha256)
        && acceptedAt >= lease.IssuedAtUnixMilliseconds
        && acceptedAt <= lease.ExpiresAtUnixMilliseconds
        && now.ToUnixTimeMilliseconds() < lease.ExpiresAtUnixMilliseconds
        && acceptedAt <= now.AddSeconds(30).ToUnixTimeMilliseconds();
    }

    private bool ReceiptMatches(
      SignedEgressReceipt signedReceipt,
      string registrationSha256,
      string dispositionSha256)
    {
      var receipt = signedReceipt.Receipt;
      return receipt.ContractVersion == EgressBoundaryCanonical.ContractVersion
        && Exact(receipt.ActionId, _binding.ActionId)
        && PayloadDigest.FixedTimeEqualsHex(
          receipt.LeaseSha256,
          EgressBoundaryCanonical.LeaseSha256(Authorization.Lease.Lease))
        && PayloadDigest.FixedTimeEqualsHex(
          receipt.ActionTokenSha256,
          _binding.ActionTokenSha256)
        && PayloadDigest.FixedTimeEqualsHex(
          receipt.RegistrationSha256,
          registrationSha256)
        && PayloadDigest.FixedTimeEqualsHex(
          receipt.DispositionSha256,
          dispositionSha256);
    }

    private static void Validate(EgressProcessRegistrationV1 value)
    {
      if (value.ContractVersion != EgressSupervisorLifecycleContract.Version
        || !IsSafeToken(value.RegistrationId, 160)
        || value.ProcessId <= 0
        || value.ProcessCreationTimeUnixMilliseconds <= 0
        || !IsCanonicalSha256(value.ExecutableSha256)
        || !IsCanonicalSha256(value.ExecutablePathSha256)
        || !IsCanonicalSha256(value.OwnedJobIdentitySha256)
        || !value.CreatedSuspended)
      {
        throw new ArgumentException("The process registration is not canonical.", nameof(value));
      }
    }

    private static void Validate(EgressDirectRegistrationV1 value)
    {
      if (value.ContractVersion != EgressSupervisorLifecycleContract.Version
        || !IsSafeToken(value.RegistrationId, 160)
        || value.ProcessId <= 0
        || value.ProcessCreationTimeUnixMilliseconds <= 0
        || value.NetworkProtocol is not ("https" or "tls")
        || !IsSafeDestinationHost(value.DestinationHost)
        || value.DestinationPort is < 1 or > 65_535
        || !IsCanonicalSha256(value.DestinationPolicySha256)
        || !IsCanonicalSha256(value.DestinationScopeSha256)
        || !IsCanonicalSha256(value.ConnectionNonceSha256))
      {
        throw new ArgumentException("The direct registration is not canonical.", nameof(value));
      }
    }

    private static bool IsSafeDestinationHost(string value) => value.Length is >= 1 and <= 253
      && value.All(character => char.IsAsciiLetterOrDigit(character)
        || character is '.' or '-' or ':');

    private static void Validate(EgressBrowserRegistrationV1 value)
    {
      if (value.ContractVersion != EgressSupervisorLifecycleContract.Version
        || !IsSafeToken(value.RegistrationId, 160)
        || value.WindowsSessionId < 0
        || value.BrowserBrokerProcessId <= 0
        || !IsCanonicalSha256(value.OriginSha256)
        || !IsCanonicalSha256(value.BrowserBrokerBuildSha256)
        || !IsCanonicalSha256(value.CompletionNonceSha256))
      {
        throw new ArgumentException("The browser registration is not canonical.", nameof(value));
      }
    }

    private static void Validate(EgressTerminalDispositionV1 value)
    {
      if (value.ContractVersion != EgressSupervisorLifecycleContract.Version
        || !Guid.TryParseExact(value.OperationId, "D", out _)
        || !EgressSupervisorLifecycleContract.TerminalOutcomes.Contains(value.Outcome)
        || value.ReportedExternalEgressBytes < 0
        || value.OccurredAtUnixMilliseconds <= 0)
      {
        throw new ArgumentException("The terminal disposition is not canonical.", nameof(value));
      }
    }

    private sealed record RegistrationState(
      string Kind,
      string RegistrationId,
      string RegistrationSha256,
      EgressRegistrationAcknowledgementV1 Acknowledgement)
    {
      public bool Matches(string kind, string registrationId, string registrationSha256) =>
        Exact(Kind, kind)
        && Exact(RegistrationId, registrationId)
        && PayloadDigest.FixedTimeEqualsHex(RegistrationSha256, registrationSha256);
    }

    private sealed record TerminalState(
      bool Abort,
      string DispositionSha256,
      SignedEgressReceipt Receipt)
    {
      public bool Matches(bool abort, string dispositionSha256) =>
        Abort == abort
        && PayloadDigest.FixedTimeEqualsHex(DispositionSha256, dispositionSha256);
    }
  }
}

internal static class EgressSupervisorPipeProtocol
{
  public const int Version = 2;
  public const int MinimumFrameBytes = 4_096;
  public const int AbsoluteMaximumFrameBytes = 262_144;

  public const string ReserveRequest = "reserve.request.v2";
  public const string ReserveResponse = "reserve.response.v2";
  public const string ProcessRegisterRequest = "register.process.request.v2";
  public const string DirectRegisterRequest = "register.direct.request.v2";
  public const string BrowserRegisterRequest = "register.browser.request.v2";
  public const string RegisterResponse = "register.response.v2";
  public const string SettleRequest = "settle.request.v2";
  public const string AbortRequest = "abort.request.v2";
  public const string TerminalResponse = "terminal.response.v2";
  public const string CapabilityAttestationRequest =
    "capability-attestation.request.v1";
  public const string CapabilityAttestationResponse =
    "capability-attestation.response.v1";

  public static bool IsSafePipeName(string value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 240
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_');
}

internal sealed record EgressSupervisorPipeFrameV1(
  int ProtocolVersion,
  long Sequence,
  string Kind,
  string MessageId,
  string CorrelationId,
  string PayloadJson);

internal sealed record EgressReserveRequestPayload(
  int ContractVersion,
  string OperationId,
  string CompactActionToken,
  string ArgumentsJsonUtf8,
  EgressActionBinding Binding);

internal sealed record EgressReserveResponsePayload(EgressExecutionAuthorization Authorization);

internal sealed record EgressProcessRegistrationRequestPayload(
  int ContractVersion,
  EgressExecutionAuthorization Authorization,
  EgressProcessRegistrationV1 Registration);

internal sealed record EgressDirectRegistrationRequestPayload(
  int ContractVersion,
  EgressExecutionAuthorization Authorization,
  EgressDirectRegistrationV1 Registration);

internal sealed record EgressBrowserRegistrationRequestPayload(
  int ContractVersion,
  EgressExecutionAuthorization Authorization,
  EgressBrowserRegistrationV1 Registration);

internal sealed record EgressRegistrationResponsePayload(
  EgressRegistrationAcknowledgementV1 Acknowledgement);

internal sealed record EgressTerminalRequestPayload(
  int ContractVersion,
  EgressExecutionAuthorization Authorization,
  EgressRegistrationAcknowledgementV1? Registration,
  EgressTerminalDispositionV1 Disposition);

internal sealed record EgressTerminalResponsePayload(SignedEgressReceipt Receipt);

internal sealed record EgressCapabilityAttestationRequestPayload(
  CapabilityBoundaryAttestationRequestV1 Request);

internal sealed record EgressCapabilityAttestationResponsePayload(
  SignedCapabilityBoundaryAttestation Attestation);

internal interface IEgressSupervisorPipeConnector
{
  ValueTask<IEgressSupervisorPipeConnection> ConnectAsync(
    EgressSupervisorClientOptions options,
    CancellationToken cancellationToken);
}

internal interface IEgressSupervisorPipeConnection : IAsyncDisposable
{
  Stream RawStream { get; }

  void ThrowIfUnavailable();

  ValueTask WriteFrameAsync(ReadOnlyMemory<byte> frame, CancellationToken cancellationToken);

  ValueTask<ReadOnlyMemory<byte>> ReadFrameAsync(
    int maximumFrameBytes,
    CancellationToken cancellationToken);
}

internal static class EgressSupervisorPipeExchange
{
  private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
  {
    MaxDepth = 32,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
  };

  public static async ValueTask<TResponse> ExchangeAsync<TRequest, TResponse>(
    IEgressSupervisorPipeConnection connection,
    int maximumFrameBytes,
    TimeSpan operationTimeout,
    string requestKind,
    string responseKind,
    string correlationId,
    TRequest payload,
    CancellationToken cancellationToken)
  {
    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
    timeout.CancelAfter(operationTimeout);
    var request = new EgressSupervisorPipeFrameV1(
      EgressSupervisorPipeProtocol.Version,
      1,
      requestKind,
      Guid.NewGuid().ToString("D"),
      correlationId,
      JsonSerializer.Serialize(payload, Json));
    var requestBytes = JsonSerializer.SerializeToUtf8Bytes(request, Json);
    if (requestBytes.Length > maximumFrameBytes)
    {
      throw new InvalidDataException("The egress supervisor request frame is oversized.");
    }

    await connection.WriteFrameAsync(requestBytes, timeout.Token).ConfigureAwait(false);
    var responseBytes = await connection.ReadFrameAsync(
      maximumFrameBytes,
      timeout.Token).ConfigureAwait(false);
    EgressSupervisorPipeFrameV1 response;
    try
    {
      response = JsonSerializer.Deserialize<EgressSupervisorPipeFrameV1>(
        responseBytes.Span,
        Json) ?? throw new JsonException();
    }
    catch (JsonException exception)
    {
      throw new InvalidDataException("The egress supervisor response is malformed.", exception);
    }

    if (response.ProtocolVersion != EgressSupervisorPipeProtocol.Version
      || response.Sequence != 1
      || !string.Equals(response.Kind, responseKind, StringComparison.Ordinal)
      || !Guid.TryParseExact(response.MessageId, "D", out _)
      || !string.Equals(response.CorrelationId, correlationId, StringComparison.Ordinal))
    {
      throw new InvalidDataException(
        "The egress supervisor response is out of phase or uncorrelated.");
    }

    try
    {
      return JsonSerializer.Deserialize<TResponse>(response.PayloadJson, Json)
        ?? throw new JsonException();
    }
    catch (JsonException exception)
    {
      throw new InvalidDataException(
        "The egress supervisor response payload is malformed.",
        exception);
    }
  }

  internal static EgressSupervisorPipeFrameV1 DeserializeRequest(ReadOnlySpan<byte> value) =>
    JsonSerializer.Deserialize<EgressSupervisorPipeFrameV1>(value, Json)
      ?? throw new InvalidDataException();

  internal static T DeserializePayload<T>(string value) =>
    JsonSerializer.Deserialize<T>(value, Json) ?? throw new InvalidDataException();

  internal static byte[] SerializeResponse<T>(
    string kind,
    string correlationId,
    T payload) => JsonSerializer.SerializeToUtf8Bytes(
      new EgressSupervisorPipeFrameV1(
        EgressSupervisorPipeProtocol.Version,
        1,
        kind,
        Guid.NewGuid().ToString("D"),
        correlationId,
        JsonSerializer.Serialize(payload, Json)),
      Json);
}

internal sealed class WindowsEgressSupervisorPipeConnector : IEgressSupervisorPipeConnector
{
  public async ValueTask<IEgressSupervisorPipeConnection> ConnectAsync(
    EgressSupervisorClientOptions options,
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
    EgressSupervisorClientOptions options)
  {
    if (!GetNamedPipeServerProcessId(pipe, out var processId)
      || processId is 0 or > int.MaxValue
      || !ProcessIdToSessionId(processId, out var sessionId)
      || sessionId != 0)
    {
      throw new UnauthorizedAccessException(
        "The egress supervisor pipe identity is unavailable.");
    }

    var process = OpenProcess(ProcessQueryInformation | Synchronize, false, processId);
    if (process.IsInvalid || WaitForSingleObject(process, 0) != WaitTimeout)
    {
      process.Dispose();
      throw new UnauthorizedAccessException("The egress supervisor process is not live.");
    }

    FileStream? imageLock = null;
    try
    {
      ValidateRestrictedSupervisorProcess(process);
      var observedPath = QueryProcessImagePath(process);
      var expectedPath = Path.GetFullPath(options.ExpectedSupervisorImagePath);
      if (!string.Equals(observedPath, expectedPath, StringComparison.OrdinalIgnoreCase))
      {
        throw new UnauthorizedAccessException(
          "The egress supervisor image path is not pinned.");
      }

      EnsurePathHasNoReparsePoints(expectedPath);
      imageLock = OpenAndBindMappedImage(process, expectedPath);
      var observedSha256 = Convert.ToHexString(SHA256.HashData(imageLock)).ToLowerInvariant();
      if (!PayloadDigest.FixedTimeEqualsHex(
        observedSha256,
        options.ExpectedSupervisorImageSha256))
      {
        throw new UnauthorizedAccessException(
          "The egress supervisor image measurement is not pinned.");
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

  private static void ValidateRestrictedSupervisorProcess(SafeProcessHandle process)
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
      var requiredServiceSid = new SecurityIdentifier(
        EgressSupervisorClientOptions.RequiredSupervisorServiceSid);
      if (!RestrictedServicePeerTokenValidator.IsExactRestrictedService(
          token,
          requiredServiceSid))
      {
        throw new UnauthorizedAccessException(
          "The egress supervisor is not the exact restricted service identity.");
      }
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
          "The egress supervisor image file identity is unsafe.");
      }

      // ProcessImageFileMapping compares the supplied file object with the
      // exact file object from which the process image section was created.
      // This defeats path replacement, rename, and hard-link substitution
      // between pipe authentication and measurement.
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
          "The egress supervisor mapped image does not match the measured file.");
      }

      var finalPath = GetFinalPath(handle);
      if (!string.Equals(
          finalPath,
          Path.GetFullPath(expectedPath),
          StringComparison.OrdinalIgnoreCase))
      {
        throw new UnauthorizedAccessException(
          "The egress supervisor image handle resolved to an unexpected path.");
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
      throw new UnauthorizedAccessException("The egress supervisor image is a reparse point.");
    }

    var directory = Directory.GetParent(filePath);
    while (directory is not null)
    {
      if ((directory.Attributes & FileAttributes.ReparsePoint) != 0)
      {
        throw new UnauthorizedAccessException(
          "The egress supervisor image has a reparse-point ancestor.");
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

  private sealed record ServerIdentityLease(SafeProcessHandle Process, FileStream ImageLock);

  private sealed class WindowsPipeConnection : IEgressSupervisorPipeConnection
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

    public Stream RawStream => _pipe;

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
        throw new InvalidDataException("The egress supervisor frame length is invalid.");
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
          throw new EndOfStreamException("The egress supervisor disconnected mid-frame.");
        }
        read += count;
      }
    }

    public void ThrowIfUnavailable()
    {
      ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
      if (!_pipe.IsConnected || WaitForSingleObject(_serverProcess, 0) != WaitTimeout)
      {
        throw new EndOfStreamException("The egress supervisor disconnected.");
      }
    }
  }
}
