using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Security;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Runtime.InteropServices;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Channel;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Journal;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Channel;

/// <summary>
/// Outbound-only HTTPS polling channel. Client identity stays in the Windows
/// certificate store and server pinning supplements normal chain and hostname
/// validation rather than replacing it.
/// </summary>
public sealed class HttpPollingCompanionChannel : IOutboundCompanionChannel
{
  private static readonly JsonSerializerOptions SerializerOptions = CompanionWireJson.Options;

  private static readonly Action<ILogger, string, int, string, Exception?> LogRequestFailure =
    LoggerMessage.Define<string, int, string>(
      LogLevel.Warning,
      new EventId(1300, nameof(LogRequestFailure)),
      "Device channel {Operation} attempt {Attempt} failed with {ErrorCode}.");

  private readonly BrokerChannelOptions _options;
  private readonly string _deviceId;
  private readonly ILogger<HttpPollingCompanionChannel> _logger;
  private readonly IDeviceIdentityProvisioner? _identityProvisioner;
  private readonly SemaphoreSlim _lifecycleGate = new(1, 1);
  private readonly bool _preconfiguredClient;
  private HttpClient? _client;
  private X509Certificate2? _deviceCertificate;
  private Uri? _channelBaseUri;
  private long _lastAcknowledgementTimestamp;
  private int _state = (int)OutboundChannelState.Disconnected;
  private bool _disposed;

  internal HttpPollingCompanionChannel(
    IOptions<BrokerChannelOptions> options,
    IOptions<CompanionOptions> companionOptions,
    IDeviceIdentityProvisioner identityProvisioner,
    ILogger<HttpPollingCompanionChannel> logger)
  {
    _options = options.Value;
    _deviceId = companionOptions.Value.DeviceId;
    _identityProvisioner = identityProvisioner;
    _logger = logger;
  }

  internal HttpPollingCompanionChannel(
    IOptions<BrokerChannelOptions> options,
    IOptions<CompanionOptions> companionOptions,
    ILogger<HttpPollingCompanionChannel> logger,
    HttpClient preconfiguredClient)
  {
    _options = options.Value;
    _deviceId = companionOptions.Value.DeviceId;
    _logger = logger;
    _client = preconfiguredClient;
    _preconfiguredClient = true;
  }

  internal HttpPollingCompanionChannel(
    IOptions<BrokerChannelOptions> options,
    IOptions<CompanionOptions> companionOptions,
    ILogger<HttpPollingCompanionChannel> logger,
    HttpClient preconfiguredClient,
    IDeviceIdentityProvisioner identityProvisioner)
    : this(options, companionOptions, logger, preconfiguredClient)
  {
    _identityProvisioner = identityProvisioner;
  }

  public OutboundChannelState State => (OutboundChannelState)Volatile.Read(ref _state);

  public bool IsCentralLedgerConnected
  {
    get
    {
      if (State != OutboundChannelState.Connected)
      {
        return false;
      }

      var acknowledgedAt = Volatile.Read(ref _lastAcknowledgementTimestamp);
      return acknowledgedAt > 0
        && Stopwatch.GetElapsedTime(acknowledgedAt)
          <= TimeSpan.FromSeconds(_options.LedgerConnectivityTtlSeconds);
    }
  }

  public async ValueTask ConnectAsync(CancellationToken cancellationToken)
  {
    await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
    ProvisionedDeviceIdentity? provisionedIdentity = null;
    try
    {
      ObjectDisposedException.ThrowIf(_disposed, this);
      if (_channelBaseUri is not null)
      {
        return;
      }

      _channelBaseUri = ValidateAndNormalizeOptions(_options, _deviceId);
      Volatile.Write(ref _state, (int)OutboundChannelState.Connecting);
      if (!_preconfiguredClient)
      {
        X509Certificate2 certificate;
        if (string.IsNullOrWhiteSpace(_options.DeviceCertificateThumbprint))
        {
          provisionedIdentity = await RequireIdentityProvisioner()
            .GetOrCreateAsync(_deviceId, cancellationToken).ConfigureAwait(false);
          certificate = provisionedIdentity.Certificate;
        }
        else
        {
          certificate = ResolveDeviceCertificate(_options);
        }

        var resources = CreateProductionClient(_options, certificate);
        _client = resources.Client;
        _deviceCertificate = resources.DeviceCertificate;
      }
      else if (string.IsNullOrWhiteSpace(_options.DeviceCertificateThumbprint))
      {
        provisionedIdentity = await RequireIdentityProvisioner()
          .GetOrCreateAsync(_deviceId, cancellationToken).ConfigureAwait(false);
      }

      if (provisionedIdentity is not null && !provisionedIdentity.IsPaired)
      {
        await CompleteFirstTrustPairingAsync(cancellationToken).ConfigureAwait(false);
        await RequireIdentityProvisioner().MarkPairedAsync(
          provisionedIdentity,
          cancellationToken).ConfigureAwait(false);
      }

      if (_preconfiguredClient)
      {
        provisionedIdentity?.Dispose();
        provisionedIdentity = null;
      }

      Volatile.Write(ref _state, (int)OutboundChannelState.Disconnected);
    }
    catch
    {
      if (_preconfiguredClient)
      {
        provisionedIdentity?.Dispose();
      }
      _channelBaseUri = null;
      if (!_preconfiguredClient)
      {
        _client?.Dispose();
        _deviceCertificate?.Dispose();
        _client = null;
        _deviceCertificate = null;
      }
      Volatile.Write(ref _state, (int)OutboundChannelState.Faulted);
      throw;
    }
    finally
    {
      _lifecycleGate.Release();
    }
  }

  public async ValueTask<JournalCentralHead> GetJournalHeadAsync(
    JournalCentralHeadRequest request,
    CancellationToken cancellationToken)
  {
    if (!string.Equals(request.DeviceId, _deviceId, StringComparison.Ordinal))
    {
      throw new InvalidOperationException("The journal-head request is for another device.");
    }

    var bytes = await PostWithRetryAsync(
      "journal-head",
      request,
      cancellationToken).ConfigureAwait(false);
    JournalCentralHead head;
    try
    {
      head = JsonSerializer.Deserialize<JournalCentralHead>(bytes, SerializerOptions)
        ?? throw new JsonException("The broker returned an empty central journal head.");
    }
    catch (JsonException)
    {
      MarkDisconnected();
      throw;
    }

    var validVersion = head.Sequence == 0
      ? head.HashVersion == 0
      : head.HashVersion is 1 or 2;
    if (!string.Equals(head.DeviceId, _deviceId, StringComparison.Ordinal)
      || head.Sequence < 0
      || !validVersion
      || !PayloadDigest.IsSha256Hex(head.EntryHash)
      || !string.Equals(head.EntryHash, head.EntryHash.ToLowerInvariant(), StringComparison.Ordinal))
    {
      MarkDisconnected();
      throw new JsonException("The broker returned an invalid central journal head.");
    }

    MarkAcknowledged();
    return head;
  }

  public async ValueTask<JournalReconciliationAcknowledgement> ReconcileJournalAsync(
    JournalReconciliationRequest request,
    CancellationToken cancellationToken)
  {
    if (!string.Equals(request.DeviceId, _deviceId, StringComparison.Ordinal)
      || request.Entries.Count > JournalReconciliationContract.MaximumEntriesPerRange
      || request.StartingPreviousSequence < 0
      || request.FinalSequence < request.StartingPreviousSequence
      || request.LocalHeadSequence < request.FinalSequence)
    {
      throw new InvalidOperationException("The journal reconciliation request is invalid.");
    }

    var bytes = await PostWithRetryAsync(
      "journal-reconcile",
      request,
      cancellationToken).ConfigureAwait(false);
    JournalReconciliationAcknowledgement acknowledgement;
    try
    {
      acknowledgement = JsonSerializer.Deserialize<JournalReconciliationAcknowledgement>(
          bytes,
          SerializerOptions)
        ?? throw new JsonException("The broker returned an empty reconciliation acknowledgement.");
    }
    catch (JsonException)
    {
      MarkDisconnected();
      throw;
    }

    var shouldBeExact = request.FinalSequence == request.LocalHeadSequence
      && string.Equals(request.FinalHash, request.LocalHeadHash, StringComparison.OrdinalIgnoreCase);
    if (!acknowledgement.Accepted
      || !string.Equals(acknowledgement.DeviceId, _deviceId, StringComparison.Ordinal)
      || acknowledgement.StartingPreviousSequence != request.StartingPreviousSequence
      || !string.Equals(
        acknowledgement.StartingPreviousHash,
        request.StartingPreviousHash,
        StringComparison.OrdinalIgnoreCase)
      || acknowledgement.AcceptedThroughSequence != request.FinalSequence
      || !string.Equals(
        acknowledgement.AcceptedThroughHash,
        request.FinalHash,
        StringComparison.OrdinalIgnoreCase)
      || acknowledgement.LocalHeadSequence != request.LocalHeadSequence
      || !string.Equals(
        acknowledgement.LocalHeadHash,
        request.LocalHeadHash,
        StringComparison.OrdinalIgnoreCase)
      || acknowledgement.ExactHead != shouldBeExact)
    {
      MarkDisconnected();
      throw new JsonException("The broker reconciliation acknowledgement did not bind the request.");
    }

    MarkAcknowledged();
    return acknowledgement;
  }

  public async IAsyncEnumerable<DeviceCommand> ReadCommandsAsync(
    [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
  {
    EnsureConnectedConfiguration();
    while (!cancellationToken.IsCancellationRequested)
    {
      IReadOnlyList<DeviceCommand> receivedCommands;
      try
      {
        var bytes = await PostWithRetryAsync(
          "poll",
          new PollRequest(_deviceId, _options.MaxCommandsPerPoll),
          cancellationToken).ConfigureAwait(false);
        var response = JsonSerializer.Deserialize<PollResponse>(bytes, SerializerOptions)
          ?? throw new JsonException("The broker poll response was empty.");
        if (response.Commands is null || response.Commands.Count > _options.MaxCommandsPerPoll)
        {
          throw new JsonException("The broker returned an invalid command count.");
        }

        foreach (var command in response.Commands)
        {
          ValidateCommandDevice(command);
        }

        MarkAcknowledged();
        receivedCommands = response.Commands;
      }
      catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
      {
        yield break;
      }
      catch (Exception exception) when (exception is HttpRequestException or JsonException)
      {
        MarkDisconnected();
        LogRequestFailure(
          _logger,
          "poll",
          _options.MaxRequestAttempts,
          exception.GetType().Name,
          exception);
        await Task.Delay(
          TimeSpan.FromSeconds(_options.MaximumRetryDelaySeconds),
          cancellationToken).ConfigureAwait(false);
        continue;
      }

      foreach (var command in receivedCommands)
      {
        yield return command;
      }

      await Task.Delay(_options.PollIntervalMilliseconds, cancellationToken)
        .ConfigureAwait(false);
    }
  }

  public ValueTask<ActionProgressAcknowledgement> SendProgressAsync(
    ActionProgress progress,
    CancellationToken cancellationToken)
  {
    if (!LeaseFenceContract.IsLive(
      progress.LeaseId,
      progress.FencingToken,
      progress.LeaseExpiresAt,
      DateTimeOffset.UtcNow))
    {
      return ValueTask.FromException<ActionProgressAcknowledgement>(
        new InvalidOperationException(
        "The progress message does not carry a live lease fence."));
    }
    return SendProgressAcknowledgedAsync(progress, cancellationToken);
  }

  public ValueTask SendResultAsync(
    ActionResult result,
    CancellationToken cancellationToken)
  {
    if (!LeaseFenceContract.IsLive(
      result.LeaseId,
      result.FencingToken,
      result.LeaseExpiresAt,
      DateTimeOffset.UtcNow)
      || !BrokerReservationMatches(result)
      || CompanionWireJson.ResultUpperBoundBytes(result)
        > result.BrokerSerializedResultUpperBoundBytes)
    {
      return ValueTask.FromException(new InvalidOperationException(
        "The result does not match its broker-signed delivery reservation."));
    }
    return SendAcknowledgedAsync(
      "result",
      result,
      cancellationToken,
      Math.Min(_options.MaxRequestAttempts, result.BrokerMaxRequestAttemptsPerSession),
      result.BrokerSerializedResultUpperBoundBytes);
  }

  public ValueTask SendActionFencedAsync(
    ActionFencedReceipt receipt,
    CancellationToken cancellationToken) =>
    SendAcknowledgedAsync("action-fenced", receipt, cancellationToken);

  public ValueTask SendHeartbeatAsync(
    CompanionHeartbeat heartbeat,
    CancellationToken cancellationToken) =>
    SendAcknowledgedAsync("heartbeat", heartbeat, cancellationToken);

  public ValueTask SendManifestAsync(
    CapabilityManifestSnapshot manifest,
    CancellationToken cancellationToken) =>
    SendAcknowledgedAsync("manifest", manifest, cancellationToken);

  public async ValueTask DisposeAsync()
  {
    await _lifecycleGate.WaitAsync().ConfigureAwait(false);
    try
    {
      if (_disposed)
      {
        return;
      }

      _disposed = true;
      Volatile.Write(ref _state, (int)OutboundChannelState.Disabled);
      _client?.Dispose();
      _deviceCertificate?.Dispose();
      _client = null;
      _deviceCertificate = null;
    }
    finally
    {
      _lifecycleGate.Release();
      _lifecycleGate.Dispose();
    }
  }

  private async ValueTask SendAcknowledgedAsync<T>(
    string operation,
    T message,
    CancellationToken cancellationToken,
    int? maximumAttempts = null,
    long? maximumPayloadBytes = null)
  {
    var bytes = await PostWithRetryAsync(
      operation,
      message,
      cancellationToken,
      maximumAttempts,
      maximumPayloadBytes)
      .ConfigureAwait(false);
    using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions
    {
      AllowTrailingCommas = false,
      CommentHandling = JsonCommentHandling.Disallow,
      MaxDepth = 16,
    });
    if (document.RootElement.ValueKind != JsonValueKind.Object
      || !document.RootElement.TryGetProperty("accepted", out var accepted)
      || accepted.ValueKind != JsonValueKind.True)
    {
      MarkDisconnected();
      throw new JsonException("The broker did not acknowledge the channel message.");
    }

    MarkAcknowledged();
  }

  private async ValueTask<ActionProgressAcknowledgement> SendProgressAcknowledgedAsync(
    ActionProgress progress,
    CancellationToken cancellationToken)
  {
    var bytes = await PostWithRetryAsync(
      "progress",
      progress,
      cancellationToken).ConfigureAwait(false);
    ActionProgressAcknowledgement acknowledgement;
    try
    {
      acknowledgement = JsonSerializer.Deserialize<ActionProgressAcknowledgement>(
          bytes,
          SerializerOptions)
        ?? throw new JsonException("The broker returned an empty progress acknowledgement.");
    }
    catch (JsonException)
    {
      MarkDisconnected();
      throw;
    }

    if (!acknowledgement.Accepted)
    {
      MarkDisconnected();
      throw new JsonException("The broker did not acknowledge the progress message.");
    }

    MarkAcknowledged();
    return acknowledgement;
  }

  private Task<byte[]> PostWithRetryAsync<T>(
    string operation,
    T message,
    CancellationToken cancellationToken,
    int? maximumAttempts = null,
    long? maximumPayloadBytes = null) =>
    PostWithRetryAsync(
      operation,
      new Uri(_channelBaseUri!, operation),
      message,
      cancellationToken,
      maximumAttempts,
      maximumPayloadBytes);

  private async Task<byte[]> PostWithRetryAsync<T>(
    string operation,
    Uri endpoint,
    T message,
    CancellationToken cancellationToken,
    int? maximumAttempts = null,
    long? maximumPayloadBytes = null)
  {
    EnsureConnectedConfiguration();
    var payload = JsonSerializer.SerializeToUtf8Bytes(message, SerializerOptions);
    if (maximumPayloadBytes is not null
      && (maximumPayloadBytes <= 0 || payload.LongLength > maximumPayloadBytes))
    {
      throw new InvalidOperationException(
        "The serialized broker message exceeds its signed request-body ceiling.");
    }
    var attempts = Math.Min(_options.MaxRequestAttempts, maximumAttempts ?? int.MaxValue);
    if (attempts <= 0)
    {
      throw new InvalidOperationException("The broker request-attempt ceiling is invalid.");
    }
    Exception? lastFailure = null;
    for (var attempt = 1; attempt <= attempts; attempt++)
    {
      cancellationToken.ThrowIfCancellationRequested();
      using var request = new HttpRequestMessage(
        HttpMethod.Post,
        endpoint)
      {
        // Exact HTTP/1.1 plus Connection: close avoids HTTP/2 REFUSED_STREAM /
        // GOAWAY body replay and stale pooled-connection replay hidden inside
        // one HttpClient.SendAsync attempt. Only this explicit loop may retry.
        Version = HttpVersion.Version11,
        VersionPolicy = HttpVersionPolicy.RequestVersionExact,
        Content = new ByteArrayContent(payload),
      };
      request.Headers.ConnectionClose = true;
      request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
      request.Headers.UserAgent.ParseAdd("Itemba-Msaidizi-Companion/1.0");
      request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json")
      {
        CharSet = "utf-8",
      };

      try
      {
        using var response = await _client!.SendAsync(
          request,
          HttpCompletionOption.ResponseHeadersRead,
          cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
          throw new BrokerResponseException(
            response.StatusCode,
            IsRetryable(response.StatusCode));
        }

        return await ReadBoundedAsync(
          response.Content,
          _options.MaximumResponseBytes,
          cancellationToken).ConfigureAwait(false);
      }
      catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
      {
        lastFailure = new HttpRequestException("The broker request timed out.", exception);
      }
      catch (HttpRequestException exception)
      {
        lastFailure = exception;
        if (exception is BrokerResponseException responseFailure && !responseFailure.Retryable)
        {
          break;
        }
      }

      MarkDisconnected();
      LogRequestFailure(
        _logger,
        operation,
        attempt,
        lastFailure.GetType().Name,
        lastFailure);
      if (attempt < attempts)
      {
        await Task.Delay(RetryDelay(attempt), cancellationToken).ConfigureAwait(false);
      }
    }

    MarkDisconnected();
    throw lastFailure ?? new HttpRequestException("The broker request failed.");
  }

  private static bool BrokerReservationMatches(ActionResult result)
  {
    if (result.BrokerMaxDeliverySessions is < 1 or > 16
      || result.BrokerMaxRequestAttemptsPerSession is < 1 or > 5
      || result.BrokerSerializedResultUpperBoundBytes <= 0)
    {
      return false;
    }
    try
    {
      return checked(
        result.BrokerSerializedResultUpperBoundBytes
        * result.BrokerMaxRequestAttemptsPerSession
        * result.BrokerMaxDeliverySessions) == result.BrokerExternalEgressBytes;
    }
    catch (OverflowException)
    {
      return false;
    }
  }

  private TimeSpan RetryDelay(int attempt)
  {
    var maximumMilliseconds = checked(_options.MaximumRetryDelaySeconds * 1_000);
    var exponential = Math.Min(
      maximumMilliseconds,
      _options.InitialRetryDelayMilliseconds * (1 << Math.Min(attempt - 1, 10)));
    var jitter = RandomNumberGenerator.GetInt32(0, Math.Max(2, exponential / 2));
    return TimeSpan.FromMilliseconds(Math.Min(maximumMilliseconds, exponential + jitter));
  }

  private void ValidateCommandDevice(DeviceCommand command)
  {
    var commandDeviceId = command switch
    {
      ExecuteActionCommand execute => execute.Action?.Request?.DeviceId,
      ReplayResultCommand replay => replay.Action?.Request?.DeviceId,
      FenceActionCommand fence => fence.Fence?.Request?.DeviceId,
      CancelActionCommand cancel => cancel.Request?.DeviceId,
      PingCommand => _deviceId,
      _ => null,
    };
    if (!string.Equals(commandDeviceId, _deviceId, StringComparison.Ordinal))
    {
      throw new JsonException("The broker command targets a different device.");
    }
  }

  private void MarkAcknowledged()
  {
    Volatile.Write(ref _lastAcknowledgementTimestamp, Stopwatch.GetTimestamp());
    Volatile.Write(ref _state, (int)OutboundChannelState.Connected);
  }

  private void MarkDisconnected()
  {
    Volatile.Write(ref _state, (int)OutboundChannelState.Disconnected);
    Volatile.Write(ref _lastAcknowledgementTimestamp, 0);
  }

  private void EnsureConnectedConfiguration()
  {
    ObjectDisposedException.ThrowIf(_disposed, this);
    if (_channelBaseUri is null || _client is null)
    {
      throw new InvalidOperationException("The broker channel has not been initialized.");
    }
  }

  private static ChannelResources CreateProductionClient(
    BrokerChannelOptions options,
    X509Certificate2 certificate)
  {
    try
    {
      var pin = Convert.FromHexString(NormalizeHex(options.ServerCertificateSha256Pin));
      var handler = new SocketsHttpHandler
      {
        AllowAutoRedirect = false,
        AutomaticDecompression = DecompressionMethods.None,
        ConnectTimeout = TimeSpan.FromSeconds(options.ConnectTimeoutSeconds),
        MaxConnectionsPerServer = 2,
        PooledConnectionLifetime = TimeSpan.FromMinutes(5),
        UseCookies = false,
        SslOptions = new SslClientAuthenticationOptions
        {
          ClientCertificates = new X509CertificateCollection { certificate },
          LocalCertificateSelectionCallback = (_, _, _, _, _) => certificate,
          CertificateRevocationCheckMode = X509RevocationMode.Online,
          EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13,
          RemoteCertificateValidationCallback = (_, serverCertificate, _, policyErrors) =>
            ValidatePinnedServerCertificate(serverCertificate, policyErrors, pin),
        },
      };
      var client = new HttpClient(handler, disposeHandler: true)
      {
        Timeout = TimeSpan.FromSeconds(options.RequestTimeoutSeconds),
      };
      return new ChannelResources(client, certificate);
    }
    catch
    {
      certificate.Dispose();
      throw;
    }
  }

  private static X509Certificate2 ResolveDeviceCertificate(BrokerChannelOptions options)
  {
    DeviceIdentityPolicy.Validate(options);
    if (!Enum.TryParse<StoreName>(options.DeviceCertificateStoreName, out var storeName)
      || !Enum.TryParse<StoreLocation>(options.DeviceCertificateStoreLocation, out var storeLocation))
    {
      throw new InvalidOperationException("The configured device certificate store is invalid.");
    }

    using var store = new X509Store(storeName, storeLocation);
    store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
    var matches = store.Certificates.Find(
      X509FindType.FindByThumbprint,
      NormalizeHex(options.DeviceCertificateThumbprint),
      validOnly: true);
    var candidates = matches.Cast<X509Certificate2>().ToArray();
    if (candidates.Length != 1
      || !candidates[0].HasPrivateKey
      || !HasPermittedNonExportableCngPrivateKey(candidates[0], options))
    {
      foreach (var candidate in candidates)
      {
        candidate.Dispose();
      }

      throw new InvalidOperationException(
        "Exactly one valid device certificate with a private key must match the configured thumbprint.");
    }

    return candidates[0];
  }

  private static bool HasPermittedNonExportableCngPrivateKey(
    X509Certificate2 certificate,
    BrokerChannelOptions options)
  {
    using var ecdsa = certificate.GetECDsaPrivateKey();
    if (ecdsa is not ECDsaCng ecdsaCng
      || ecdsaCng.KeySize != 256
      || !IsNonExportable(ecdsaCng.Key.ExportPolicy))
    {
      return false;
    }

    try
    {
      var providerName = ecdsaCng.Key.Provider?.Provider ?? string.Empty;
      DeviceIdentityPolicy.EnsurePersistedIdentityAllowed(
        options,
        providerName,
        string.Equals(
          providerName,
          CngProvider.MicrosoftPlatformCryptoProvider.Provider,
          StringComparison.Ordinal));
      return true;
    }
    catch (CryptographicException)
    {
      return false;
    }
  }

  private static bool IsNonExportable(CngExportPolicies exportPolicy) =>
    (exportPolicy
      & (CngExportPolicies.AllowExport
        | CngExportPolicies.AllowPlaintextExport
        | CngExportPolicies.AllowArchiving
        | CngExportPolicies.AllowPlaintextArchiving)) == 0;

  private static bool ValidatePinnedServerCertificate(
    X509Certificate? certificate,
    SslPolicyErrors policyErrors,
    byte[] expectedPin)
  {
    if (certificate is null || policyErrors != SslPolicyErrors.None)
    {
      return false;
    }

    var actualPin = SHA256.HashData(certificate.GetRawCertData());
    return CryptographicOperations.FixedTimeEquals(actualPin, expectedPin);
  }

  private static Uri ValidateAndNormalizeOptions(BrokerChannelOptions options, string deviceId)
  {
    DeviceIdentityPolicy.Validate(options);
    if (!options.Enabled
      || string.IsNullOrWhiteSpace(deviceId)
      || string.Equals(deviceId, "UNENROLLED", StringComparison.Ordinal)
      || !Uri.TryCreate(options.Endpoint, UriKind.Absolute, out var endpoint)
      || endpoint.Scheme != Uri.UriSchemeHttps
      || !string.IsNullOrEmpty(endpoint.Query)
      || !string.IsNullOrEmpty(endpoint.Fragment)
      || (!IsHex(options.DeviceCertificateThumbprint, minimumBytes: 20)
        && (!options.BootstrapIdentityEnabled
          || string.IsNullOrWhiteSpace(options.DeviceIdentityRecordPath)
          || string.IsNullOrWhiteSpace(options.DeviceKeyNamePrefix)))
      || !IsHex(options.ServerCertificateSha256Pin, minimumBytes: 32, exactBytes: 32)
      || options.ConnectTimeoutSeconds is < 1 or > 60
      || options.RequestTimeoutSeconds is < 1 or > 120
      || options.MaxRequestAttempts is < 1 or > 5
      || options.InitialRetryDelayMilliseconds is < 50 or > 5_000
      || options.MaximumRetryDelaySeconds is < 1 or > 60
      || options.PollIntervalMilliseconds is < 100 or > 30_000
      || options.MaxCommandsPerPoll is < 1 or > 10
      || options.LedgerConnectivityTtlSeconds is < 5 or > 120
      || options.MaximumResponseBytes is < 1_024 or > 4_194_304)
    {
      throw new InvalidOperationException("The enabled broker channel configuration is invalid.");
    }

    var absolute = endpoint.AbsoluteUri.EndsWith('/')
      ? endpoint.AbsoluteUri
      : $"{endpoint.AbsoluteUri}/";
    return new Uri(absolute, UriKind.Absolute);
  }

  private static bool IsHex(string value, int minimumBytes, int? exactBytes = null)
  {
    var normalized = NormalizeHex(value);
    var requiredCharacters = exactBytes is null ? minimumBytes * 2 : exactBytes.Value * 2;
    return (exactBytes is null ? normalized.Length >= requiredCharacters : normalized.Length == requiredCharacters)
      && normalized.All(Uri.IsHexDigit);
  }

  private static string NormalizeHex(string value) => value
    .Replace("SHA256:", string.Empty, StringComparison.OrdinalIgnoreCase)
    .Replace(":", string.Empty, StringComparison.Ordinal)
    .Replace(" ", string.Empty, StringComparison.Ordinal)
    .ToUpperInvariant();

  private static async Task<byte[]> ReadBoundedAsync(
    HttpContent content,
    int maximumBytes,
    CancellationToken cancellationToken)
  {
    if (content.Headers.ContentLength is > 0
      && content.Headers.ContentLength > maximumBytes)
    {
      throw new HttpRequestException("The broker response exceeds the configured limit.");
    }

    await using var source = await content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
    using var destination = new MemoryStream();
    var buffer = new byte[16_384];
    while (true)
    {
      var read = await source.ReadAsync(buffer.AsMemory(), cancellationToken).ConfigureAwait(false);
      if (read == 0)
      {
        return destination.ToArray();
      }

      if (destination.Length + read > maximumBytes)
      {
        throw new HttpRequestException("The broker response exceeds the configured limit.");
      }

      await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken)
        .ConfigureAwait(false);
    }
  }

  private static bool IsRetryable(HttpStatusCode statusCode) =>
    statusCode is HttpStatusCode.RequestTimeout
      or HttpStatusCode.TooManyRequests
      || (int)statusCode >= 500;

  private IDeviceIdentityProvisioner RequireIdentityProvisioner() =>
    _identityProvisioner
    ?? throw new InvalidOperationException("Device identity bootstrap is not available.");

  private async Task CompleteFirstTrustPairingAsync(CancellationToken cancellationToken)
  {
    if (!_options.BootstrapIdentityEnabled
      || string.IsNullOrWhiteSpace(_options.PairingCode))
    {
      throw new InvalidOperationException(
        "An unpaired device identity requires a supervisor-provided one-time pairing code.");
    }

    var emptyManifest = new CapabilityManifestSnapshot(
      _deviceId,
      Convert.ToHexString(SHA256.HashData("[]"u8)),
      [],
      DateTimeOffset.UtcNow);
    var responseBytes = await PostWithRetryAsync(
      "pairing",
      new Uri(_channelBaseUri!, "../pairing/complete"),
      new PairingRequest(
        _deviceId,
        _options.PairingCode,
        "windows",
        Truncate(RuntimeInformation.OSDescription, 120),
        RuntimeInformation.OSArchitecture.ToString().ToLowerInvariant(),
        emptyManifest),
      cancellationToken).ConfigureAwait(false);
    var response = JsonSerializer.Deserialize<PairingResponse>(responseBytes, SerializerOptions)
      ?? throw new JsonException("The broker pairing response was empty.");
    if (!string.Equals(response.DeviceId, _deviceId, StringComparison.Ordinal)
      || !string.Equals(response.Status, "ACTIVE", StringComparison.Ordinal))
    {
      throw new JsonException("The broker pairing response did not bind this device.");
    }

    MarkAcknowledged();
  }

  private static string Truncate(string value, int maximumLength) =>
    value.Length <= maximumLength ? value : value[..maximumLength];

  private sealed record PollRequest(string DeviceId, int MaxCommands);

  private sealed record PollResponse(IReadOnlyList<DeviceCommand> Commands);

  private sealed record PairingRequest(
    string DeviceId,
    string PairingCode,
    string Platform,
    string OsVersion,
    string Architecture,
    CapabilityManifestSnapshot CapabilityManifest);

  private sealed record PairingResponse(string DeviceId, string Status);

  private sealed record ChannelResources(HttpClient Client, X509Certificate2 DeviceCertificate);

  private sealed class BrokerResponseException(HttpStatusCode statusCode, bool retryable)
    : HttpRequestException($"The broker returned HTTP {(int)statusCode}.", null, statusCode)
  {
    public bool Retryable { get; } = retryable;
  }
}
