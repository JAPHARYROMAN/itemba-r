using System.Diagnostics;
using System.Globalization;
using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

public sealed record ExternalActionEndpoint(
  string Id,
  string Kind,
  string CapabilityId,
  Uri Destination,
  string ServerCertificateSha256Pin,
  string CredentialReferenceId,
  string CredentialRecordSha256,
  string CredentialPrefix,
  string DestinationScopeSha256,
  ExactExternalActionDestination? ExactDestination = null);

/// <summary>
/// Resolves either a deployment-owned static endpoint ID or the exact signed
/// dynamic HTTPS descriptor enabled by a matching supervisor policy digest.
/// It never infers dynamic authority from an action's prose or capability ID.
/// </summary>
public sealed class ExternalActionPolicy
{
  private static readonly Dictionary<string, string> KindCapabilities =
    new Dictionary<string, string>(StringComparer.Ordinal)
    {
      ["email"] = ExternalActionCapabilityCatalog.EmailSend.Id,
      ["message"] = ExternalActionCapabilityCatalog.MessageSend.Id,
      ["publish"] = ExternalActionCapabilityCatalog.PublishCreate.Id,
      ["purchase"] = ExternalActionCapabilityCatalog.PurchaseSubmit.Id,
    };

  private readonly Dictionary<string, ExternalActionEndpoint> _endpoints;
  private readonly bool _dynamicDestinationsEnabled;

  public ExternalActionPolicy(
    IOptions<ExternalActionOptions> options,
    IOptions<CompanionOptions>? companionOptions = null)
  {
    var configured = options.Value;
    if (!configured.Enabled
      || configured.ConnectTimeoutSeconds is < 1 or > 120
      || configured.MaximumResponseBytes is < 1 or > 16_777_216
      || configured.MaximumRequestBodyBytes is < 1 or > 1_048_576
      || configured.Endpoints.Count > 256
      || (configured.Endpoints.Count == 0 && !configured.DynamicDestinationsEnabled))
    {
      throw new InvalidOperationException("The external-action policy is not enabled or bounded.");
    }
    if (configured.DynamicDestinationsEnabled
      && (companionOptions is null
        || !PayloadDigest.IsSha256Hex(
          companionOptions.Value.EgressDestinationPolicySha256)
        || !string.Equals(
          companionOptions.Value.EgressDestinationPolicySha256,
          companionOptions.Value.EgressDestinationPolicySha256.ToLowerInvariant(),
          StringComparison.Ordinal)))
    {
      throw new InvalidOperationException(
        "Dynamic external destinations require an exact provisioned egress-policy digest.");
    }

    ConnectTimeout = TimeSpan.FromSeconds(configured.ConnectTimeoutSeconds);
    MaximumResponseBytes = configured.MaximumResponseBytes;
    MaximumRequestBodyBytes = configured.MaximumRequestBodyBytes;
    _dynamicDestinationsEnabled = configured.DynamicDestinationsEnabled;
    var endpoints = new Dictionary<string, ExternalActionEndpoint>(StringComparer.Ordinal);
    foreach (var endpoint in configured.Endpoints)
    {
      var resolved = ResolveConfiguredEndpoint(endpoint);
      if (!endpoints.TryAdd(resolved.Id, resolved))
      {
        throw new InvalidOperationException("External-action endpoint IDs must be unique.");
      }
    }
    _endpoints = endpoints;
  }

  public TimeSpan ConnectTimeout { get; }

  public int MaximumResponseBytes { get; }

  public int MaximumRequestBodyBytes { get; }

  public ExternalActionEndpoint Resolve(string endpointId, string capabilityId)
  {
    if (!_endpoints.TryGetValue(endpointId, out var endpoint)
      || !string.Equals(endpoint.CapabilityId, capabilityId, StringComparison.Ordinal))
    {
      throw new HostPreconditionException("external_endpoint_not_allowed");
    }
    return endpoint;
  }

  public ExternalActionEndpoint Resolve(
    ExactExternalActionDestination destination,
    string capabilityId,
    string kind)
  {
    ArgumentNullException.ThrowIfNull(destination);
    if (!destination.IsDynamic)
    {
      return Resolve(destination.EndpointId, capabilityId);
    }
    if (!_dynamicDestinationsEnabled
      || !KindCapabilities.TryGetValue(kind, out var expectedCapability)
      || !string.Equals(expectedCapability, capabilityId, StringComparison.Ordinal)
      || !PublicNetworkDestinationPolicy.TryCanonicalizeHttpsUri(
        destination.AbsoluteHttpsUri,
        2_048,
        out var uri)
      || !PayloadDigest.IsSha256Hex(destination.ServerCertificateSha256)
      || !PayloadDigest.IsSha256Hex(destination.VaultRecordSha256)
      || !Guid.TryParseExact(destination.VaultReferenceId, "D", out _))
    {
      throw new HostPreconditionException("external_dynamic_destination_not_allowed");
    }
    return new ExternalActionEndpoint(
      destination.EndpointId,
      kind,
      capabilityId,
      uri,
      destination.ServerCertificateSha256,
      destination.VaultReferenceId,
      destination.VaultRecordSha256,
      destination.HeaderPrefix,
      EgressExternalActionCanonical.DestinationScopeSha256(
        capabilityId,
        destination.EndpointId,
        uri.AbsoluteUri,
        destination.ServerCertificateSha256,
        destination.VaultReferenceId,
        destination.HeaderPrefix),
      destination);
  }

  private static ExternalActionEndpoint ResolveConfiguredEndpoint(
    ExternalActionEndpointOptions endpoint)
  {
    if (!IsSafeId(endpoint.Id)
      || !KindCapabilities.TryGetValue(endpoint.Kind, out var capabilityId)
      || !PayloadDigest.IsSha256Hex(endpoint.ServerCertificateSha256Pin)
      || !TryResolveDestination(endpoint.Origin, endpoint.RelativePath, out var destination)
      || !TryResolveCredentialReference(endpoint.CredentialReferenceId, out var credentialReference)
      || !IsCanonicalSha256(endpoint.CredentialRecordSha256)
      || !IsSafeCredentialPrefix(endpoint.CredentialPrefix))
    {
      throw new InvalidOperationException("An external-action endpoint is invalid.");
    }

    var scope = EgressExternalActionCanonical.DestinationScopeSha256(
      capabilityId,
      endpoint.Id,
      destination.AbsoluteUri,
      endpoint.ServerCertificateSha256Pin.ToLowerInvariant(),
      credentialReference,
      endpoint.CredentialPrefix);
    var exact = new ExactExternalActionDestination(
      EgressExternalActionCanonical.StaticEndpointAuthority,
      endpoint.Id,
      string.Empty,
      string.Empty,
      string.Empty,
      string.Empty,
      string.Empty);
    return new ExternalActionEndpoint(
      endpoint.Id,
      endpoint.Kind,
      capabilityId,
      destination,
      endpoint.ServerCertificateSha256Pin.ToLowerInvariant(),
      credentialReference,
      endpoint.CredentialRecordSha256.ToLowerInvariant(),
      endpoint.CredentialPrefix,
      scope,
      exact);
  }

  private static bool TryResolveDestination(
    string originValue,
    string relativePath,
    out Uri destination)
  {
    destination = null!;
    if (!Uri.TryCreate(originValue, UriKind.Absolute, out var origin)
      || !string.Equals(origin.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
      || string.IsNullOrWhiteSpace(origin.IdnHost)
      || !string.IsNullOrEmpty(origin.UserInfo)
      || origin.AbsolutePath != "/"
      || !string.IsNullOrEmpty(origin.Query)
      || !string.IsNullOrEmpty(origin.Fragment)
      || relativePath.Length is < 1 or > 2_048
      || relativePath[0] != '/'
      || relativePath.Contains('\\')
      || relativePath.Any(character => char.IsControl(character)))
    {
      return false;
    }

    if (!Uri.TryCreate(origin, relativePath, out var combined)
      || !string.Equals(combined.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
      || !string.Equals(combined.IdnHost, origin.IdnHost, StringComparison.OrdinalIgnoreCase)
      || combined.Port != origin.Port
      || !string.IsNullOrEmpty(combined.UserInfo)
      || !string.IsNullOrEmpty(combined.Fragment)
      || !string.Equals(combined.PathAndQuery, relativePath, StringComparison.Ordinal))
    {
      return false;
    }
    destination = combined;
    return true;
  }

  private static bool TryResolveCredentialReference(string value, out string reference)
  {
    if (Guid.TryParseExact(value, "D", out _))
    {
      reference = value;
      return true;
    }
    reference = string.Empty;
    return false;
  }

  private static bool IsSafeId(string value) => value.Length is >= 1 and <= 80
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_');

  private static bool IsSafeCredentialPrefix(string value) => value.Length <= 64
    && value.All(character => character is >= ' ' and <= '~')
    && !value.Contains('\r')
    && !value.Contains('\n');

  private static bool IsCanonicalSha256(string value) =>
    PayloadDigest.IsSha256Hex(value)
    && string.Equals(value, value.ToLowerInvariant(), StringComparison.Ordinal);
}

public sealed record ExternalActionTransportResult(
  bool RequestDispatched,
  long ChargedEgressBytes,
  byte[] ResponseBytes,
  string TransportCode);

/// <summary>
/// Ephemeral one-time capability for the supervisor-owned direct-flow data
/// plane. The nonce preimage is held only for the duration of one transport
/// attempt and is zeroed on disposal.
/// </summary>
public sealed class ExternalActionEgressFlowBinding : IDisposable
{
  private readonly byte[] _connectionNonce;
  private int _disposed;

  public ExternalActionEgressFlowBinding(
    string leaseSha256,
    string registrationId,
    byte[] connectionNonce,
    string destinationHost,
    int destinationPort,
    string destinationScopeSha256,
    long maximumExternalEgressBytes,
    long leaseExpiresAtUnixMilliseconds)
  {
    ArgumentNullException.ThrowIfNull(connectionNonce);
    if (!PayloadDigest.IsSha256Hex(leaseSha256)
      || !Guid.TryParseExact(registrationId, "D", out _)
      || connectionNonce.Length != 32
      || destinationHost.Length is < 1 or > 253
      || destinationPort is < 1 or > 65_535
      || !PayloadDigest.IsSha256Hex(destinationScopeSha256)
      || maximumExternalEgressBytes < 0
      || leaseExpiresAtUnixMilliseconds <= 0)
    {
      throw new ArgumentException("The external-action flow binding is not canonical.");
    }

    LeaseSha256 = leaseSha256;
    RegistrationId = registrationId;
    _connectionNonce = connectionNonce;
    DestinationHost = destinationHost;
    DestinationPort = destinationPort;
    DestinationScopeSha256 = destinationScopeSha256;
    MaximumExternalEgressBytes = maximumExternalEgressBytes;
    LeaseExpiresAtUnixMilliseconds = leaseExpiresAtUnixMilliseconds;
  }

  public string LeaseSha256 { get; }

  public string RegistrationId { get; }

  public string DestinationHost { get; }

  public int DestinationPort { get; }

  public string DestinationScopeSha256 { get; }

  public long MaximumExternalEgressBytes { get; }

  public long LeaseExpiresAtUnixMilliseconds { get; }

  public ReadOnlyMemory<byte> ConnectionNonce
  {
    get
    {
      ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
      return _connectionNonce;
    }
  }

  public void Dispose()
  {
    if (Interlocked.Exchange(ref _disposed, 1) == 0)
    {
      CryptographicOperations.ZeroMemory(_connectionNonce);
    }
  }
}

public interface IExternalActionTransport
{
  ValueTask<ExternalActionTransportResult> SendAsync(
    ExternalActionEndpoint endpoint,
    ExternalActionEgressFlowBinding flowBinding,
    ReadOnlyMemory<byte> requestBytes,
    int maximumResponseBytes,
    TimeSpan connectTimeout,
    CancellationToken cancellationToken);
}

public sealed class ExternalActionExecutor(
  ExternalActionPolicy policy,
  IExternalActionTransport transport,
  IHostSecretReferenceVault secretVault)
{
  private const int ResultEgressReserveBytes = 4_096;

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    CapabilityDescriptor descriptor,
    string endpointKind,
    string provenanceType,
    ActionExecutionContext context,
    IEgressBoundarySession egressSession,
    string endpointId,
    byte[] requestBody,
    CancellationToken cancellationToken) => ExecuteAsync(
      descriptor,
      endpointKind,
      provenanceType,
      context,
      egressSession,
      new ExactExternalActionDestination(
        EgressExternalActionCanonical.StaticEndpointAuthority,
        endpointId,
        string.Empty,
        string.Empty,
        string.Empty,
        string.Empty,
        string.Empty),
      requestBody,
      cancellationToken);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    CapabilityDescriptor descriptor,
    string endpointKind,
    string provenanceType,
    ActionExecutionContext context,
    IEgressBoundarySession egressSession,
    ExactExternalActionDestination exactDestination,
    byte[] requestBody,
    CancellationToken cancellationToken)
  {
    try
    {
      var endpoint = policy.Resolve(exactDestination, descriptor.Id, endpointKind);
      if (!string.Equals(endpoint.Kind, endpointKind, StringComparison.Ordinal)
        || !PayloadDigest.IsSha256Hex(context.ExpectedPreStateSha256 ?? string.Empty)
        || requestBody.Length > policy.MaximumRequestBodyBytes)
      {
        throw new HostPreconditionException("external_action_precondition_invalid");
      }

      _ = secretVault; // Provisioning remains Companion-owned; use is supervisor-owned.
      return await DispatchAsync(
        descriptor,
        provenanceType,
        context,
        egressSession,
        endpoint,
        requestBody,
        cancellationToken).ConfigureAwait(false);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(requestBody);
    }
  }

  private async ValueTask<CapabilityExecutionResult> DispatchAsync(
    CapabilityDescriptor descriptor,
    string provenanceType,
    ActionExecutionContext context,
    IEgressBoundarySession egressSession,
    ExternalActionEndpoint endpoint,
    byte[] requestBody,
    CancellationToken cancellationToken)
  {
    byte[] request = [];
    byte[] response = [];
    try
    {
      request = BuildRequest(endpoint, context, requestBody);
      if (request.LongLength > context.Budgets.MaxExternalEgressBytes
        || request.LongLength + ResultEgressReserveBytes
          > context.Budgets.MaxExternalEgressBytes)
      {
        throw new HostPreconditionException("external_action_egress_budget_insufficient");
      }

      using var flowBinding = await RegisterDirectBoundaryAsync(
        descriptor,
        context,
        egressSession,
        endpoint,
        cancellationToken).ConfigureAwait(false);

      var dispatched = await transport.SendAsync(
        endpoint,
        flowBinding,
        request,
        policy.MaximumResponseBytes,
        policy.ConnectTimeout,
        cancellationToken).ConfigureAwait(false);
      response = dispatched.ResponseBytes;
      if (!dispatched.RequestDispatched)
      {
        throw new HostPreconditionException(dispatched.TransportCode);
      }

      var bodySha256 = Sha256Hex(requestBody);
      var idempotencySha256 = PayloadDigest.Sha256Hex(context.IdempotencyKey);
      var responseSha256 = Sha256Hex(response);
      var parsed = ExternalHttpResponse.Parse(response);
      var postStateSha256 = string.Empty;
      var confirmed = dispatched.TransportCode == "response_received"
        && parsed is not null
        && parsed.StatusCode is >= 200 and <= 299
        && parsed.HasSingleDigest("x-itemba-idempotency-key-sha256", idempotencySha256)
        && parsed.HasSingleDigest("x-itemba-request-sha256", bodySha256)
        && parsed.HasSingleDigest(
          "x-itemba-expected-pre-state-sha256",
          context.ExpectedPreStateSha256!)
        && parsed.TryGetSingleDigest("x-itemba-post-state-sha256", out postStateSha256);
      var output = JsonSerializer.Serialize(new
      {
        dispatched = true,
        confirmed,
        endpointId = endpoint.Id,
        statusCode = parsed?.StatusCode ?? 0,
        requestSha256 = bodySha256,
        responseSha256,
        responseBytes = response.LongLength,
        destinationScopeSha256 = endpoint.DestinationScopeSha256,
        postStateSha256 = confirmed ? postStateSha256 : null,
        transportCode = dispatched.TransportCode,
      });
      return new CapabilityExecutionResult(
        output,
        MutationCommitted: confirmed,
        OutcomeUncertain: !confirmed,
        Provenance:
        [
          new DataProvenance(
            provenanceType,
            endpoint.DestinationScopeSha256,
            bodySha256,
            ProvenanceTrust.AuthenticatedRemote,
            DateTimeOffset.UtcNow),
        ],
        PreStateSha256: context.ExpectedPreStateSha256,
        ExternalEgressBytes: dispatched.ChargedEgressBytes);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(request);
      CryptographicOperations.ZeroMemory(response);
    }
  }

  private static async ValueTask<ExternalActionEgressFlowBinding>
    RegisterDirectBoundaryAsync(
    CapabilityDescriptor descriptor,
    ActionExecutionContext context,
    IEgressBoundarySession egressSession,
    ExternalActionEndpoint endpoint,
    CancellationToken cancellationToken)
  {
    var lease = egressSession.Authorization.Lease.Lease;
    if (context.EgressAuthorization is null
      || !PayloadDigest.IsSha256Hex(context.ActionTokenSha256 ?? string.Empty)
      || !PayloadDigest.IsSha256Hex(context.EgressDestinationPolicySha256 ?? string.Empty)
      || !PayloadDigest.IsSha256Hex(context.EgressExecutionIdentitySha256 ?? string.Empty)
      || !PayloadDigest.FixedTimeEqualsHex(
        context.ActionTokenSha256!,
        lease.ActionTokenSha256)
      || !PayloadDigest.FixedTimeEqualsHex(
        context.EgressDestinationPolicySha256!,
        lease.DestinationPolicySha256)
      || !PayloadDigest.FixedTimeEqualsHex(
        context.EgressExecutionIdentitySha256!,
        lease.ExecutionIdentitySha256)
      || !PayloadDigest.FixedTimeEqualsHex(
        EgressBoundaryCanonical.LeaseSha256(context.EgressAuthorization.Lease.Lease),
        EgressBoundaryCanonical.LeaseSha256(lease))
      || !PayloadDigest.FixedTimeEqualsHex(
        EgressBoundaryCanonical.AttestationSha256(
          context.EgressAuthorization.Attestation.Attestation),
        EgressBoundaryCanonical.AttestationSha256(
          egressSession.Authorization.Attestation.Attestation))
      || !string.Equals(context.ActionId, lease.ActionId, StringComparison.Ordinal)
      || !string.Equals(context.TaskId, lease.TaskId, StringComparison.Ordinal)
      || !string.Equals(context.PlanVersionId, lease.PlanVersionId, StringComparison.Ordinal)
      || !string.Equals(context.StepId, lease.StepId, StringComparison.Ordinal)
      || !string.Equals(context.DeviceId, lease.DeviceId, StringComparison.Ordinal)
      || !string.Equals(context.MandateId, lease.MandateId, StringComparison.Ordinal)
      || !string.Equals(descriptor.Id, lease.CapabilityId, StringComparison.Ordinal)
      || !string.Equals(descriptor.Version, lease.CapabilityVersion, StringComparison.Ordinal)
      || context.DispatchCount != lease.DispatchCount
      || context.Budgets.MaxExternalEgressBytes != lease.ReservedCapabilityEgressBytes)
    {
      throw new HostPreconditionException("egress_direct_binding_invalid");
    }

    int processId;
    long processCreationTime;
    try
    {
      using var process = Process.GetCurrentProcess();
      processId = process.Id;
      processCreationTime = new DateTimeOffset(process.StartTime.ToUniversalTime())
        .ToUnixTimeMilliseconds();
    }
    catch (Exception exception) when (exception is InvalidOperationException
      or NotSupportedException
      or SystemException)
    {
      throw new HostPreconditionException(
        "egress_direct_process_identity_unavailable",
        exception);
    }

    var nonce = RandomNumberGenerator.GetBytes(32);
    string connectionNonceSha256;
    connectionNonceSha256 = Convert.ToHexString(SHA256.HashData(nonce)).ToLowerInvariant();

    var registrationId = EgressSupervisorLifecycleCanonical.OperationId(
      context.ActionId,
      $"direct:{endpoint.DestinationScopeSha256}:{processId.ToString(CultureInfo.InvariantCulture)}");
    var registration = new EgressDirectRegistrationV1(
      EgressSupervisorLifecycleContract.Version,
      registrationId,
      processId,
      processCreationTime,
      "https",
      endpoint.Destination.IdnHost,
      endpoint.Destination.Port,
      context.EgressDestinationPolicySha256!,
      endpoint.DestinationScopeSha256,
      egressSession.Authorization.Lease.Lease.ReservationDnsAnswerSetSha256,
      connectionNonceSha256,
      endpoint.ExactDestination ?? new ExactExternalActionDestination(
        EgressExternalActionCanonical.StaticEndpointAuthority,
        endpoint.Id,
        string.Empty,
        string.Empty,
        string.Empty,
        string.Empty,
        string.Empty));
    try
    {
      var acknowledgement = await egressSession.TryRegisterDirectAsync(
        registration,
        cancellationToken).ConfigureAwait(false);
      var registrationSha256 = EgressSupervisorLifecycleCanonical.RegistrationSha256(
        registration);
      var expectedOperationId = EgressSupervisorLifecycleCanonical.OperationId(
        context.ActionId,
        $"register:{EgressSupervisorLifecycleContract.DirectRegistration}:{registrationId}");
      if (acknowledgement is null
        || acknowledgement.ContractVersion != EgressSupervisorLifecycleContract.Version
        || !string.Equals(
          acknowledgement.OperationId,
          expectedOperationId,
          StringComparison.Ordinal)
        || !string.Equals(
          acknowledgement.RegistrationId,
          registrationId,
          StringComparison.Ordinal)
        || !string.Equals(
          acknowledgement.RegistrationKind,
          EgressSupervisorLifecycleContract.DirectRegistration,
          StringComparison.Ordinal)
        || !PayloadDigest.FixedTimeEqualsHex(
          acknowledgement.LeaseSha256,
          EgressBoundaryCanonical.LeaseSha256(lease))
        || !PayloadDigest.FixedTimeEqualsHex(
          acknowledgement.RegistrationSha256,
          registrationSha256))
      {
        throw new HostPreconditionException("egress_direct_registration_not_acknowledged");
      }

      return new ExternalActionEgressFlowBinding(
        EgressBoundaryCanonical.LeaseSha256(lease),
        registrationId,
        nonce,
        endpoint.Destination.IdnHost,
        endpoint.Destination.Port,
        endpoint.DestinationScopeSha256,
        context.Budgets.MaxExternalEgressBytes,
        lease.ExpiresAtUnixMilliseconds);
    }
    catch
    {
      CryptographicOperations.ZeroMemory(nonce);
      throw;
    }
  }

  private static byte[] BuildRequest(
    ExternalActionEndpoint endpoint,
    ActionExecutionContext context,
    ReadOnlySpan<byte> body)
  {
    if (!IsSafeHeaderValue(context.ActionId, 160)
      || !IsSafeHeaderValue(context.IdempotencyKey, 200))
    {
      throw new HostPreconditionException("external_action_header_invalid");
    }

    var target = endpoint.Destination.PathAndQuery;
    var hostName = endpoint.Destination.HostNameType == UriHostNameType.IPv6
      ? $"[{endpoint.Destination.IdnHost}]"
      : endpoint.Destination.IdnHost;
    var host = endpoint.Destination.IsDefaultPort
      ? hostName
      : $"{hostName}:{endpoint.Destination.Port}";
    if (!target.All(character => character <= 0x7f)
      || !host.All(character => character <= 0x7f))
    {
      throw new HostPreconditionException("external_action_destination_invalid");
    }

    var bodySha256 = Sha256Hex(body);
    var header = string.Join("\r\n",
      $"POST {target} HTTP/1.1",
      $"Host: {host}",
      "Content-Type: application/json; charset=utf-8",
      $"Content-Length: {body.Length.ToString(CultureInfo.InvariantCulture)}",
      "User-Agent: Itemba-Msaidizi-Companion/1.0",
      $"Idempotency-Key: {context.IdempotencyKey}",
      $"X-Itemba-Action-Id: {context.ActionId}",
      $"X-Itemba-Request-Sha256: {bodySha256}",
      $"X-Itemba-Expected-Pre-State-Sha256: {context.ExpectedPreStateSha256}",
      "Connection: close",
      $"Authorization-Reference: {endpoint.CredentialReferenceId}");
    var headerBytes = Encoding.ASCII.GetBytes(header);
    var separatorBytes = Encoding.ASCII.GetBytes("\r\n\r\n");
    var request = GC.AllocateUninitializedArray<byte>(checked(
      headerBytes.Length + separatorBytes.Length + body.Length));
    var offset = 0;
    headerBytes.CopyTo(request, offset);
    offset += headerBytes.Length;
    separatorBytes.CopyTo(request, offset);
    offset += separatorBytes.Length;
    body.CopyTo(request.AsSpan(offset));
    CryptographicOperations.ZeroMemory(headerBytes);
    return request;
  }

  private static bool IsSafeHeaderValue(string value, int maximumLength) =>
    value.Length is >= 1 && value.Length <= maximumLength
    && value.All(character => character is >= '!' and <= '~');

  private static string Sha256Hex(ReadOnlySpan<byte> value)
  {
    var digest = SHA256.HashData(value);
    try
    {
      return Convert.ToHexString(digest).ToLowerInvariant();
    }
    finally
    {
      CryptographicOperations.ZeroMemory(digest);
    }
  }
}

internal sealed record ExternalHttpResponse(
  int StatusCode,
  IReadOnlyDictionary<string, IReadOnlyList<string>> Headers)
{
  private const int MaximumHeaderBytes = 65_536;

  public bool HasSingleDigest(string name, string expected) =>
    TryGetSingleDigest(name, out var actual)
    && PayloadDigest.FixedTimeEqualsHex(actual, expected);

  public bool TryGetSingleDigest(string name, out string value)
  {
    value = string.Empty;
    if (!Headers.TryGetValue(name, out var values)
      || values.Count != 1
      || !PayloadDigest.IsSha256Hex(values[0]))
    {
      return false;
    }
    value = values[0];
    return true;
  }

  public static ExternalHttpResponse? Parse(ReadOnlySpan<byte> response)
  {
    var headerEnd = IndexOf(response, "\r\n\r\n"u8);
    if (headerEnd is < 1 or > MaximumHeaderBytes
      || !IsHeaderBlockAscii(response[..headerEnd]))
    {
      return null;
    }
    var lines = Encoding.ASCII.GetString(response[..headerEnd]).Split("\r\n");
    var statusParts = lines[0].Split(' ', StringSplitOptions.RemoveEmptyEntries);
    if (statusParts.Length < 2
      || statusParts[0] is not ("HTTP/1.1" or "HTTP/1.0")
      || !int.TryParse(statusParts[1], NumberStyles.None, CultureInfo.InvariantCulture,
        out var statusCode)
      || statusCode is < 100 or > 599)
    {
      return null;
    }

    var headers = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
    foreach (var line in lines.Skip(1))
    {
      var separator = line.IndexOf(':');
      if (separator <= 0)
      {
        return null;
      }
      var name = line[..separator].Trim().ToLowerInvariant();
      var value = line[(separator + 1)..].Trim();
      if (!IsHeaderName(name) || value.Any(character => character < ' '))
      {
        return null;
      }
      if (!headers.TryGetValue(name, out var values))
      {
        values = [];
        headers.Add(name, values);
      }
      values.Add(value);
    }
    return new ExternalHttpResponse(
      statusCode,
      headers.ToDictionary(
        pair => pair.Key,
        pair => (IReadOnlyList<string>)pair.Value.ToArray(),
        StringComparer.OrdinalIgnoreCase));
  }

  private static int IndexOf(ReadOnlySpan<byte> haystack, ReadOnlySpan<byte> needle)
  {
    var index = haystack.IndexOf(needle);
    return index < 0 ? -1 : index;
  }

  private static bool IsHeaderBlockAscii(ReadOnlySpan<byte> value)
  {
    foreach (var item in value)
    {
      if (item is not (0x09 or 0x0a or 0x0d) && (item < 0x20 || item > 0x7e))
      {
        return false;
      }
    }
    return true;
  }

  private static bool IsHeaderName(string value) => value.Length is >= 1 and <= 128
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '!' or '#' or '$' or '%' or '&' or '\'' or '*' or '+' or '-'
        or '.' or '^' or '_' or '`' or '|' or '~');
}

public static class ExternalActionCapabilityCatalog
{
  public static CapabilityDescriptor EmailSend { get; } = Descriptor(
    "external.email.send",
    "Send governed email",
    "Submits one exact email envelope to a pinned static gateway or an exact mandate-authorized, pre-provisioned authenticated HTTPS destination.",
    CapabilityDataClass.Confidential,
    CapabilityEffect.ExternalWrite,
    "external-email-action",
    "governed-artifact-attachment",
    EmailArgumentsSchema);

  public static CapabilityDescriptor MessageSend { get; } = Descriptor(
    "external.message.send",
    "Send governed message",
    "Submits one exact message to a pinned static gateway or an exact mandate-authorized, pre-provisioned authenticated HTTPS destination.",
    CapabilityDataClass.Confidential,
    CapabilityEffect.ExternalWrite,
    "external-message-action",
    MessageArgumentsSchema);

  public static CapabilityDescriptor PublishCreate { get; } = Descriptor(
    "external.publish.create",
    "Create governed publication",
    "Submits one exact publication to a pinned static gateway or an exact mandate-authorized, pre-provisioned authenticated HTTPS destination.",
    CapabilityDataClass.Restricted,
    CapabilityEffect.ExternalWrite,
    "external-publish-action",
    PublishArgumentsSchema);

  public static CapabilityDescriptor PurchaseSubmit { get; } = Descriptor(
    "external.purchase.submit",
    "Submit governed purchase",
    "Submits one exact purchase order to a pinned static gateway or an exact mandate-authorized, pre-provisioned authenticated HTTPS destination.",
    CapabilityDataClass.Restricted,
    CapabilityEffect.Financial,
    "external-purchase-action",
    PurchaseArgumentsSchema);

  public static IReadOnlyList<CapabilityDescriptor> All { get; } =
    [EmailSend, MessageSend, PublishCreate, PurchaseSubmit];

  private static CapabilityDescriptor Descriptor(
    string id,
    string displayName,
    string description,
    CapabilityDataClass dataClass,
    CapabilityEffect effect,
    string provenance,
    string argumentsSchema) => new(
      id,
      "1.0.0",
      displayName,
      description,
      dataClass,
      effect,
      ConsentRequirement.SignedMandate,
      RecoveryKind.Irreversible,
      RequiredPrivilege.LocalSystem,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      Parse(argumentsSchema),
      Parse(ResultSchema),
      [provenance],
      false);

  private static CapabilityDescriptor Descriptor(
    string id,
    string displayName,
    string description,
    CapabilityDataClass dataClass,
    CapabilityEffect effect,
    string provenance,
    string additionalProvenance,
    string argumentsSchema) => new(
      id,
      "1.0.0",
      displayName,
      description,
      dataClass,
      effect,
      ConsentRequirement.SignedMandate,
      RecoveryKind.Irreversible,
      RequiredPrivilege.LocalSystem,
      IdempotencySemantics.Required,
      ["windows-11-x64"],
      Parse(argumentsSchema),
      Parse(ResultSchema),
      [provenance, additionalProvenance],
      false);

  private static JsonElement Parse(string json)
  {
    using var document = JsonDocument.Parse(json);
    return document.RootElement.Clone();
  }

  private const string ResultSchema =
    """
    {
      "type": "object",
      "properties": {
        "dispatched": { "type": "boolean" },
        "confirmed": { "type": "boolean" },
        "endpointId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "statusCode": { "type": "integer", "minimum": 0, "maximum": 599 },
        "requestSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "responseSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "responseBytes": { "type": "integer", "minimum": 0 },
        "destinationScopeSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "postStateSha256": { "type": ["string", "null"], "pattern": "^[a-f0-9]{64}$" },
        "transportCode": {
          "type": "string",
          "enum": ["response_received", "response_read_uncertain", "response_limit_exceeded", "request_write_uncertain"]
        }
      },
      "required": ["dispatched", "confirmed", "endpointId", "statusCode", "requestSha256", "responseSha256", "responseBytes", "destinationScopeSha256", "postStateSha256", "transportCode"],
      "additionalProperties": false
    }
    """;

  private const string EmailArgumentsSchema =
    """
    {
      "type": "object",
      "properties": {
        "endpointId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "destinationAuthority": { "const": "mandate_dynamic_https_v1" },
        "destinationUri": { "type": "string", "minLength": 1, "maxLength": 2048 },
        "serverCertificateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "vaultReferenceId": { "type": "string", "format": "uuid" },
        "vaultRecordSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "headerPrefix": { "type": "string", "maxLength": 64 },
        "to": { "type": "array", "minItems": 1, "maxItems": 100, "items": { "type": "string", "maxLength": 320 } },
        "cc": { "type": "array", "maxItems": 100, "items": { "type": "string", "maxLength": 320 } },
        "subject": { "type": "string", "minLength": 1, "maxLength": 998 },
        "text": { "type": "string", "minLength": 1, "maxLength": 100000 },
        "attachment": {
          "type": "object",
          "properties": {
            "schemaVersion": { "const": 1 },
            "taskId": { "type": "string", "format": "uuid" },
            "planVersionId": { "type": "string", "format": "uuid" },
            "targetStepId": { "type": "string", "format": "uuid" },
            "deviceId": { "type": "string", "format": "uuid" },
            "sourceStepId": { "type": "string", "format": "uuid" },
            "sourceAttemptId": { "type": "string", "minLength": 1, "maxLength": 200 },
            "artifactId": { "type": "string", "format": "uuid" },
            "sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
            "byteSize": { "type": "integer", "minimum": 1, "maximum": 131072 },
            "mimeType": { "type": "string", "minLength": 3, "maxLength": 127 },
            "name": { "type": "string", "minLength": 1, "maxLength": 255 },
            "kind": { "type": "string", "enum": ["FILE", "SCREENSHOT", "REPORT", "AUDIO", "DOCUMENT", "OTHER"] },
            "dataClass": { "type": "string", "minLength": 1, "maxLength": 64 },
            "scopeSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
            "contentBase64": { "type": "string", "minLength": 4, "maxLength": 174764 }
          },
          "required": ["schemaVersion", "taskId", "planVersionId", "targetStepId", "deviceId", "sourceStepId", "sourceAttemptId", "artifactId", "sha256", "byteSize", "mimeType", "name", "kind", "dataClass", "scopeSha256", "contentBase64"],
          "additionalProperties": false
        }
      },
      "oneOf": [
        {
          "not": {
            "anyOf": [
              { "required": ["destinationAuthority"] },
              { "required": ["destinationUri"] },
              { "required": ["serverCertificateSha256"] },
              { "required": ["vaultReferenceId"] },
              { "required": ["vaultRecordSha256"] },
              { "required": ["headerPrefix"] }
            ]
          }
        },
        {
          "required": ["destinationAuthority", "destinationUri", "serverCertificateSha256", "vaultReferenceId", "vaultRecordSha256", "headerPrefix"]
        }
      ],
      "required": ["endpointId", "to", "subject", "text"],
      "additionalProperties": false
    }
    """;

  private const string MessageArgumentsSchema =
    """
    {
      "type": "object",
      "properties": {
        "endpointId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "destinationAuthority": { "const": "mandate_dynamic_https_v1" },
        "destinationUri": { "type": "string", "minLength": 1, "maxLength": 2048 },
        "serverCertificateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "vaultReferenceId": { "type": "string", "format": "uuid" },
        "vaultRecordSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "headerPrefix": { "type": "string", "maxLength": 64 },
        "conversationId": { "type": "string", "minLength": 1, "maxLength": 256 },
        "text": { "type": "string", "minLength": 1, "maxLength": 100000 }
      },
      "oneOf": [
        {
          "not": {
            "anyOf": [
              { "required": ["destinationAuthority"] },
              { "required": ["destinationUri"] },
              { "required": ["serverCertificateSha256"] },
              { "required": ["vaultReferenceId"] },
              { "required": ["vaultRecordSha256"] },
              { "required": ["headerPrefix"] }
            ]
          }
        },
        {
          "required": ["destinationAuthority", "destinationUri", "serverCertificateSha256", "vaultReferenceId", "vaultRecordSha256", "headerPrefix"]
        }
      ],
      "required": ["endpointId", "conversationId", "text"],
      "additionalProperties": false
    }
    """;

  private const string PublishArgumentsSchema =
    """
    {
      "type": "object",
      "properties": {
        "endpointId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "destinationAuthority": { "const": "mandate_dynamic_https_v1" },
        "destinationUri": { "type": "string", "minLength": 1, "maxLength": 2048 },
        "serverCertificateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "vaultReferenceId": { "type": "string", "format": "uuid" },
        "vaultRecordSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "headerPrefix": { "type": "string", "maxLength": 64 },
        "destinationId": { "type": "string", "minLength": 1, "maxLength": 256 },
        "title": { "type": "string", "minLength": 1, "maxLength": 998 },
        "content": { "type": "string", "minLength": 1, "maxLength": 250000 },
        "visibility": { "type": "string", "enum": ["public", "unlisted", "private"] }
      },
      "oneOf": [
        {
          "not": {
            "anyOf": [
              { "required": ["destinationAuthority"] },
              { "required": ["destinationUri"] },
              { "required": ["serverCertificateSha256"] },
              { "required": ["vaultReferenceId"] },
              { "required": ["vaultRecordSha256"] },
              { "required": ["headerPrefix"] }
            ]
          }
        },
        {
          "required": ["destinationAuthority", "destinationUri", "serverCertificateSha256", "vaultReferenceId", "vaultRecordSha256", "headerPrefix"]
        }
      ],
      "required": ["endpointId", "destinationId", "title", "content", "visibility"],
      "additionalProperties": false
    }
    """;

  private const string PurchaseArgumentsSchema =
    """
    {
      "type": "object",
      "properties": {
        "endpointId": { "type": "string", "pattern": "^[A-Za-z0-9._-]{1,80}$" },
        "destinationAuthority": { "const": "mandate_dynamic_https_v1" },
        "destinationUri": { "type": "string", "minLength": 1, "maxLength": 2048 },
        "serverCertificateSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "vaultReferenceId": { "type": "string", "format": "uuid" },
        "vaultRecordSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "headerPrefix": { "type": "string", "maxLength": 64 },
        "vendorId": { "type": "string", "minLength": 1, "maxLength": 256 },
        "currency": { "type": "string", "pattern": "^[A-Z]{3}$" },
        "totalAmountMinor": { "type": "integer", "minimum": 1, "maximum": 9007199254740991 },
        "items": {
          "type": "array",
          "minItems": 1,
          "maxItems": 100,
          "items": {
            "type": "object",
            "properties": {
              "sku": { "type": "string", "minLength": 1, "maxLength": 256 },
              "quantityMilli": { "type": "integer", "minimum": 1, "maximum": 1000000000 },
              "unitAmountMinor": { "type": "integer", "minimum": 1, "maximum": 9007199254740991 }
            },
            "required": ["sku", "quantityMilli", "unitAmountMinor"],
            "additionalProperties": false
          }
        }
      },
      "oneOf": [
        {
          "not": {
            "anyOf": [
              { "required": ["destinationAuthority"] },
              { "required": ["destinationUri"] },
              { "required": ["serverCertificateSha256"] },
              { "required": ["vaultReferenceId"] },
              { "required": ["vaultRecordSha256"] },
              { "required": ["headerPrefix"] }
            ]
          }
        },
        {
          "required": ["destinationAuthority", "destinationUri", "serverCertificateSha256", "vaultReferenceId", "vaultRecordSha256", "headerPrefix"]
        }
      ],
      "required": ["endpointId", "vendorId", "currency", "totalAmountMinor", "items"],
      "additionalProperties": false
    }
    """;
}

public abstract class ExternalActionCapabilityAdapter(
  CapabilityDescriptor descriptor,
  string endpointKind,
  string provenanceType,
  ExternalActionExecutor? executor = null) : IEgressLifecycleCapabilityAdapter
{
  public CapabilityDescriptor Descriptor { get; } = descriptor;

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments) =>
    ExternalActionContractValidator.ValidateArguments(Descriptor.Id, arguments);

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    ExternalActionContractValidator.ValidateResult(result);

  public ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    throw new HostPreconditionException("egress_supervisor_flow_handle_required");
  }

  public async ValueTask<CapabilityExecutionResult> ExecuteWithEgressAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    IEgressBoundarySession session,
    CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(session);
    if (executor is null)
    {
      throw new HostPreconditionException("egress_supervisor_flow_transport_unconfigured");
    }
    var validation = ValidateArguments(arguments);
    if (!validation.IsValid)
    {
      throw new HostPreconditionException(
        validation.ErrorCode ?? "external_arguments_invalid");
    }

    GovernedArtifactDescriptor? artifact = null;
    if (Descriptor.Id == "external.email.send"
      && arguments.TryGetProperty("attachment", out var attachment)
      && !ExternalActionContractValidator.ValidArtifact(
        attachment,
        context,
        requiredKind: null,
        out artifact))
    {
      throw new HostPreconditionException("external_attachment_scope_invalid");
    }

    if (!EgressExternalActionCanonical.TryCreate(
        Descriptor.Id,
        arguments.GetRawText(),
        out ExactExternalActionDestination destination,
        out var requestBody,
        out var errorCode))
    {
      throw new HostPreconditionException(
        string.IsNullOrEmpty(errorCode) ? "external_arguments_invalid" : errorCode);
    }
    var result = await executor.ExecuteAsync(
      Descriptor,
      endpointKind,
      provenanceType,
      context,
      session,
      destination,
      requestBody,
      cancellationToken).ConfigureAwait(false);
    if (artifact is null)
    {
      return result;
    }
    return result with
    {
      Provenance =
      [
        .. result.Provenance,
        new DataProvenance(
          "governed-artifact-attachment",
          artifact.ScopeSha256,
          artifact.Sha256,
          ProvenanceTrust.UntrustedContent,
          DateTimeOffset.UtcNow),
      ],
    };
  }
}

public sealed class ExternalEmailSendCapabilityAdapter : ExternalActionCapabilityAdapter
{
  public ExternalEmailSendCapabilityAdapter()
    : this(null)
  {
  }

  public ExternalEmailSendCapabilityAdapter(ExternalActionExecutor? executor)
    : base(
      ExternalActionCapabilityCatalog.EmailSend,
      "email",
      "external-email-action",
      executor)
  {
  }
}

public sealed class ExternalMessageSendCapabilityAdapter : ExternalActionCapabilityAdapter
{
  public ExternalMessageSendCapabilityAdapter()
    : this(null)
  {
  }

  public ExternalMessageSendCapabilityAdapter(ExternalActionExecutor? executor)
    : base(
      ExternalActionCapabilityCatalog.MessageSend,
      "message",
      "external-message-action",
      executor)
  {
  }
}

public sealed class ExternalPublishCreateCapabilityAdapter : ExternalActionCapabilityAdapter
{
  public ExternalPublishCreateCapabilityAdapter()
    : this(null)
  {
  }

  public ExternalPublishCreateCapabilityAdapter(ExternalActionExecutor? executor)
    : base(
      ExternalActionCapabilityCatalog.PublishCreate,
      "publish",
      "external-publish-action",
      executor)
  {
  }
}

public sealed class ExternalPurchaseSubmitCapabilityAdapter : ExternalActionCapabilityAdapter
{
  public ExternalPurchaseSubmitCapabilityAdapter()
    : this(null)
  {
  }

  public ExternalPurchaseSubmitCapabilityAdapter(ExternalActionExecutor? executor)
    : base(
      ExternalActionCapabilityCatalog.PurchaseSubmit,
      "purchase",
      "external-purchase-action",
      executor)
  {
  }
}

internal static class ExternalActionContractValidator
{
  public static CapabilityArgumentValidation ValidateArguments(
    string capabilityId,
    JsonElement arguments)
  {
    if (arguments.ValueKind != JsonValueKind.Object)
    {
      return Invalid("external_arguments_object_required");
    }
    if (capabilityId is not (
      "external.email.send" or
      "external.message.send" or
      "external.publish.create" or
      "external.purchase.submit"))
    {
      return Invalid("external_capability_unknown");
    }
    if (!HasDynamicDestinationFields(arguments))
    {
      return capabilityId switch
      {
        "external.email.send" => ValidateEmail(arguments),
        "external.message.send" => ValidateMessage(arguments),
        "external.publish.create" => ValidatePublish(arguments),
        "external.purchase.submit" => ValidatePurchase(arguments),
        _ => Invalid("external_capability_unknown"),
      };
    }
    if (!EgressExternalActionCanonical.TryCreate(
        capabilityId,
        arguments.GetRawText(),
        out ExactExternalActionDestination _,
        out var body,
        out var errorCode))
    {
      return Invalid(string.IsNullOrEmpty(errorCode)
        ? "external_arguments_invalid"
        : errorCode);
    }
    CryptographicOperations.ZeroMemory(body);
    return CapabilityArgumentValidation.Success;
  }

  public static CapabilityArgumentValidation ValidateResult(JsonElement result)
  {
    string[] required =
    [
      "dispatched",
      "confirmed",
      "endpointId",
      "statusCode",
      "requestSha256",
      "responseSha256",
      "responseBytes",
      "destinationScopeSha256",
      "postStateSha256",
      "transportCode",
    ];
    if (!HasExactly(result, required)
      || result.GetProperty("dispatched").ValueKind != JsonValueKind.True
      || result.GetProperty("confirmed").ValueKind is not (JsonValueKind.True or JsonValueKind.False)
      || !SafeId(result.GetProperty("endpointId"))
      || !IntegerInRange(result.GetProperty("statusCode"), 0, 599)
      || !Digest(result.GetProperty("requestSha256"))
      || !Digest(result.GetProperty("responseSha256"))
      || !IntegerInRange(result.GetProperty("responseBytes"), 0, long.MaxValue)
      || !Digest(result.GetProperty("destinationScopeSha256"))
      || (result.GetProperty("postStateSha256").ValueKind != JsonValueKind.Null
        && !Digest(result.GetProperty("postStateSha256")))
      || result.GetProperty("transportCode").ValueKind != JsonValueKind.String
      || result.GetProperty("transportCode").GetString() is not (
        "response_received" or "response_read_uncertain" or
        "response_limit_exceeded" or "request_write_uncertain"))
    {
      return Invalid("external_result_schema_invalid");
    }
    var confirmed = result.GetProperty("confirmed").GetBoolean();
    if (confirmed != (result.GetProperty("statusCode").GetInt32() is >= 200 and <= 299
      && result.GetProperty("postStateSha256").ValueKind == JsonValueKind.String
      && result.GetProperty("transportCode").GetString() == "response_received"))
    {
      return Invalid("external_result_confirmation_invalid");
    }
    return CapabilityArgumentValidation.Success;
  }

  public static byte[] CanonicalPayload(string capabilityId, JsonElement arguments)
  {
    if (!EgressExternalActionCanonical.TryCreate(
      capabilityId,
      arguments.GetRawText(),
      out ExactExternalActionDestination _,
      out var body,
      out var errorCode))
    {
      throw new InvalidOperationException(string.IsNullOrEmpty(errorCode)
        ? "external_arguments_invalid"
        : errorCode);
    }
    return body;
  }

  private static CapabilityArgumentValidation ValidateEmail(JsonElement value)
  {
    if (!HasOnlyRequiredAndOptional(
      value,
      ["endpointId", "to", "subject", "text"],
      ["cc", "attachment"])
      || !SafeId(value.GetProperty("endpointId"))
      || !EmailArray(value.GetProperty("to"), 1, 100)
      || (value.TryGetProperty("cc", out var cc) && !EmailArray(cc, 0, 100))
      || !BoundedText(value.GetProperty("subject"), 1, 998, allowNewLines: false)
      || !BoundedText(value.GetProperty("text"), 1, 100_000, allowNewLines: true)
      || (value.TryGetProperty("attachment", out var attachment)
        && !ValidArtifact(attachment, context: null, requiredKind: null, out _)))
    {
      return Invalid("external_email_arguments_invalid");
    }
    return CapabilityArgumentValidation.Success;
  }

  internal static bool ValidArtifact(
    JsonElement value,
    ActionExecutionContext? context,
    string? requiredKind,
    out GovernedArtifactDescriptor descriptor)
  {
    if (!GovernedArtifactEnvelope.TryDecode(
      value,
      context,
      requiredKind,
      out descriptor,
      out var content))
    {
      return false;
    }
    CryptographicOperations.ZeroMemory(content);
    return true;
  }

  private static bool HasDynamicDestinationFields(JsonElement value) =>
    value.TryGetProperty("destinationAuthority", out _)
    || value.TryGetProperty("destinationUri", out _)
    || value.TryGetProperty("serverCertificateSha256", out _)
    || value.TryGetProperty("vaultReferenceId", out _)
    || value.TryGetProperty("vaultRecordSha256", out _)
    || value.TryGetProperty("headerPrefix", out _);

  private static CapabilityArgumentValidation ValidateMessage(JsonElement value)
  {
    if (!HasExactly(value, ["endpointId", "conversationId", "text"])
      || !SafeId(value.GetProperty("endpointId"))
      || !BoundedText(value.GetProperty("conversationId"), 1, 256, false)
      || !BoundedText(value.GetProperty("text"), 1, 100_000, true))
    {
      return Invalid("external_message_arguments_invalid");
    }
    return CapabilityArgumentValidation.Success;
  }

  private static CapabilityArgumentValidation ValidatePublish(JsonElement value)
  {
    if (!HasExactly(
      value,
      ["endpointId", "destinationId", "title", "content", "visibility"])
      || !SafeId(value.GetProperty("endpointId"))
      || !BoundedText(value.GetProperty("destinationId"), 1, 256, false)
      || !BoundedText(value.GetProperty("title"), 1, 998, false)
      || !BoundedText(value.GetProperty("content"), 1, 250_000, true)
      || value.GetProperty("visibility").ValueKind != JsonValueKind.String
      || value.GetProperty("visibility").GetString() is not (
        "public" or "unlisted" or "private"))
    {
      return Invalid("external_publish_arguments_invalid");
    }
    return CapabilityArgumentValidation.Success;
  }

  private static CapabilityArgumentValidation ValidatePurchase(JsonElement value)
  {
    if (!HasExactly(
      value,
      ["endpointId", "vendorId", "currency", "totalAmountMinor", "items"])
      || !SafeId(value.GetProperty("endpointId"))
      || !BoundedText(value.GetProperty("vendorId"), 1, 256, false)
      || value.GetProperty("currency").ValueKind != JsonValueKind.String
      || value.GetProperty("currency").GetString() is not { Length: 3 } currency
      || currency.Any(character => character is < 'A' or > 'Z')
      || !IntegerInRange(value.GetProperty("totalAmountMinor"), 1, 9_007_199_254_740_991)
      || value.GetProperty("items").ValueKind != JsonValueKind.Array
      || value.GetProperty("items").GetArrayLength() is < 1 or > 100)
    {
      return Invalid("external_purchase_arguments_invalid");
    }

    long calculated = 0;
    try
    {
      foreach (var item in value.GetProperty("items").EnumerateArray())
      {
        if (!HasExactly(item, ["sku", "quantityMilli", "unitAmountMinor"])
          || !BoundedText(item.GetProperty("sku"), 1, 256, false)
          || !IntegerInRange(item.GetProperty("quantityMilli"), 1, 1_000_000_000)
          || !IntegerInRange(
            item.GetProperty("unitAmountMinor"),
            1,
            9_007_199_254_740_991))
        {
          return Invalid("external_purchase_item_invalid");
        }
        var numerator = checked(
          item.GetProperty("quantityMilli").GetInt64()
          * item.GetProperty("unitAmountMinor").GetInt64());
        if (numerator % 1_000 != 0)
        {
          return Invalid("external_purchase_fractional_minor_unit");
        }
        calculated = checked(calculated + numerator / 1_000);
      }
    }
    catch (OverflowException)
    {
      return Invalid("external_purchase_total_overflow");
    }
    return calculated == value.GetProperty("totalAmountMinor").GetInt64()
      ? CapabilityArgumentValidation.Success
      : Invalid("external_purchase_total_mismatch");
  }

  private static bool HasExactly(JsonElement value, IReadOnlyCollection<string> names) =>
    HasOnlyRequiredAndOptional(value, names, []);

  private static bool HasOnlyRequiredAndOptional(
    JsonElement value,
    IReadOnlyCollection<string> required,
    IReadOnlyCollection<string> optional)
  {
    if (value.ValueKind != JsonValueKind.Object)
    {
      return false;
    }
    var properties = value.EnumerateObject().Select(property => property.Name).ToArray();
    return properties.Distinct(StringComparer.Ordinal).Count() == properties.Length
      && required.All(name => properties.Contains(name, StringComparer.Ordinal))
      && properties.All(name => required.Contains(name, StringComparer.Ordinal)
        || optional.Contains(name, StringComparer.Ordinal));
  }

  private static bool SafeId(JsonElement value) =>
    value.ValueKind == JsonValueKind.String
    && value.GetString() is { Length: >= 1 and <= 80 } text
    && text.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_');

  private static bool BoundedText(
    JsonElement value,
    int minimum,
    int maximum,
    bool allowNewLines)
  {
    if (value.ValueKind != JsonValueKind.String
      || value.GetString() is not { } text
      || text.Length < minimum
      || text.Length > maximum)
    {
      return false;
    }
    return text.All(character => !char.IsControl(character)
      || (allowNewLines && character is '\r' or '\n' or '\t'));
  }

  private static bool EmailArray(JsonElement value, int minimum, int maximum)
  {
    if (value.ValueKind != JsonValueKind.Array
      || value.GetArrayLength() < minimum
      || value.GetArrayLength() > maximum)
    {
      return false;
    }
    var addresses = StringArray(value);
    return addresses.Distinct(StringComparer.OrdinalIgnoreCase).Count() == addresses.Length
      && addresses.All(address => address.Length <= 320
        && MailAddress.TryCreate(address, out var parsed)
        && string.Equals(parsed.Address, address, StringComparison.OrdinalIgnoreCase));
  }

  private static string[] StringArray(JsonElement value) => value.EnumerateArray()
    .Select(item => item.ValueKind == JsonValueKind.String ? item.GetString()! : string.Empty)
    .ToArray();

  private static bool IntegerInRange(JsonElement value, long minimum, long maximum) =>
    value.ValueKind == JsonValueKind.Number
    && value.TryGetInt64(out var number)
    && number >= minimum
    && number <= maximum;

  private static bool Digest(JsonElement value) => value.ValueKind == JsonValueKind.String
    && PayloadDigest.IsSha256Hex(value.GetString()!);

  private static CapabilityArgumentValidation Invalid(string code) =>
    CapabilityArgumentValidation.Invalid(code, code);
}
