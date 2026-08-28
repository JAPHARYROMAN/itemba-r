using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Service.Security;

internal sealed record SecretProvisioningCallerIdentity(
  string UserSid,
  int ProcessId,
  int SessionId,
  string AgentExecutableSha256);

internal sealed record SecretProvisioningMutationIntent(
  string RequestId,
  string Operation,
  string BindingId,
  string? VaultReferenceId,
  string ManifestSha256,
  string DestinationScopeSha256,
  string CapabilitySetSha256,
  SecretProvisioningCallerIdentity Caller);

internal sealed class SecretProvisioningBindingCatalog
{
  private readonly Dictionary<string, SecretProvisioningBindingPreview> _bindings;

  public SecretProvisioningBindingCatalog(IOptions<SecretProvisioningOptions> options)
  {
    var configured = options.Value.Bindings;
    var bindings = new Dictionary<string, SecretProvisioningBindingPreview>(
      StringComparer.Ordinal);
    foreach (var item in configured)
    {
      var capabilities = item.AllowedCapabilities
        .Order(StringComparer.Ordinal)
        .ToArray();
      if (!IsSafeToken(item.BindingId, 80)
        || !IsBoundedText(item.DisplayName, 160)
        || !IsSafeToken(item.Kind, 128)
        || !IsBoundedText(item.Destination, 2_048)
        || !PayloadDigest.IsSha256Hex(item.DestinationScopeSha256)
        || capabilities.Length is < 1 or > 32
        || capabilities.Any(value => !IsSafeToken(value, 256))
        || capabilities.Distinct(StringComparer.Ordinal).Count() != capabilities.Length
        || !bindings.TryAdd(item.BindingId, new SecretProvisioningBindingPreview(
          item.BindingId,
          item.DisplayName,
          item.Kind,
          item.Destination,
          item.DestinationScopeSha256.ToLowerInvariant(),
          capabilities)))
      {
        throw new InvalidOperationException(
          "A local secret provisioning binding is invalid or duplicated.");
      }
    }

    _bindings = bindings;
  }

  public IReadOnlyList<SecretProvisioningBindingPreview> List() =>
    _bindings.Values.OrderBy(value => value.BindingId, StringComparer.Ordinal).ToArray();

  public SecretProvisioningBindingPreview Resolve(string bindingId) =>
    _bindings.TryGetValue(bindingId, out var binding)
      ? binding
      : throw new SecretProvisioningException("secret_binding_not_allowed");

  public static string CapabilitySetSha256(SecretProvisioningBindingPreview binding) =>
    PayloadDigest.Sha256Hex(string.Join('\n',
      ["itemba-msaidizi-secret-capabilities-v1", .. binding.AllowedCapabilities]));

  private static bool IsSafeToken(string value, int maximumLength) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= maximumLength
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_' or ':');

  private static bool IsBoundedText(string value, int maximumLength) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= maximumLength
    && value.All(character => !char.IsControl(character));
}

internal sealed record SecretProvisioningAuditEntry(
  int IntegrityVersion,
  long Sequence,
  DateTimeOffset RecordedAt,
  string Phase,
  string RequestId,
  string Operation,
  string BindingId,
  string? VaultReferenceId,
  string ManifestSha256,
  string DestinationScopeSha256,
  string CapabilitySetSha256,
  string UserSid,
  int ProcessId,
  int SessionId,
  string AgentExecutableSha256,
  string? Outcome,
  string? ErrorCode,
  SecretProvisioningResultMetadata? Result,
  string PreviousHash,
  string Hash);

internal sealed class FileSecretProvisioningAuditJournal : IDisposable
{
  private const int IntegrityVersion = 1;
  private const int MaximumJournalBytes = 16_777_216;
  private const int MaximumLineBytes = 131_072;
  private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);
  private static readonly string GenesisHash = new('0', 64);
  private readonly string _path;
  private readonly SemaphoreSlim _gate = new(1, 1);
  private readonly List<SecretProvisioningAuditEntry> _entries = [];
  private bool _loaded;

  public FileSecretProvisioningAuditJournal(IOptions<SecretProvisioningOptions> options)
  {
    _path = Path.GetFullPath(Environment.ExpandEnvironmentVariables(
      options.Value.AuditJournalPath));
  }

  internal FileSecretProvisioningAuditJournal(string path)
  {
    _path = Path.GetFullPath(path);
  }

  public void Dispose() => _gate.Dispose();

  public async ValueTask<SecretProvisioningResult?> PrepareAsync(
    SecretProvisioningMutationIntent intent,
    CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      await EnsureLoadedAsync(cancellationToken).ConfigureAwait(false);
      var prior = _entries.Where(value => string.Equals(
        value.RequestId,
        intent.RequestId,
        StringComparison.Ordinal)).ToArray();
      if (prior.Length != 0)
      {
        if (prior.Any(value => !Matches(value, intent)))
        {
          throw new SecretProvisioningException("secret_request_replay_conflict");
        }

        var terminal = prior.LastOrDefault(value => value.Phase == "terminal");
        if (terminal is not null)
        {
          return new SecretProvisioningResult(
            terminal.RequestId,
            terminal.Operation,
            terminal.Outcome ?? "needs_attention",
            Replayed: true,
            terminal.ErrorCode,
            terminal.Result);
        }

        throw new SecretProvisioningException("secret_request_outcome_uncertain");
      }

      await AppendAsync(
        NewEntry(intent, "prepared", null, null, null),
        cancellationToken).ConfigureAwait(false);
      return null;
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<bool> ContainsExactAsync(
    SecretProvisioningMutationIntent intent,
    CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      await EnsureLoadedAsync(cancellationToken).ConfigureAwait(false);
      var prior = _entries.Where(value => string.Equals(
        value.RequestId,
        intent.RequestId,
        StringComparison.Ordinal)).ToArray();
      if (prior.Any(value => !Matches(value, intent)))
      {
        throw new SecretProvisioningException("secret_request_replay_conflict");
      }
      return prior.Length != 0;
    }
    finally
    {
      _gate.Release();
    }
  }

  public async ValueTask<SecretProvisioningResult> CompleteAsync(
    SecretProvisioningMutationIntent intent,
    string outcome,
    string? errorCode,
    SecretProvisioningResultMetadata? result,
    CancellationToken cancellationToken)
  {
    await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      await EnsureLoadedAsync(cancellationToken).ConfigureAwait(false);
      var requestEntries = _entries.Where(value => string.Equals(
        value.RequestId,
        intent.RequestId,
        StringComparison.Ordinal)).ToArray();
      if (requestEntries.Length != 1
        || requestEntries[0].Phase != "prepared"
        || !Matches(requestEntries[0], intent)
        || outcome is not ("completed" or "failed" or "needs_attention"))
      {
        throw new SecretProvisioningException("secret_audit_state_invalid");
      }

      var entry = NewEntry(intent, "terminal", outcome, errorCode, result);
      await AppendAsync(entry, cancellationToken).ConfigureAwait(false);
      return new SecretProvisioningResult(
        intent.RequestId,
        intent.Operation,
        outcome,
        Replayed: false,
        errorCode,
        result);
    }
    finally
    {
      _gate.Release();
    }
  }

  private SecretProvisioningAuditEntry NewEntry(
    SecretProvisioningMutationIntent intent,
    string phase,
    string? outcome,
    string? errorCode,
    SecretProvisioningResultMetadata? result)
  {
    var sequence = checked(_entries.Count + 1L);
    var previousHash = _entries.Count == 0 ? GenesisHash : _entries[^1].Hash;
    var unsigned = new SecretProvisioningAuditEntry(
      IntegrityVersion,
      sequence,
      DateTimeOffset.UtcNow,
      phase,
      intent.RequestId,
      intent.Operation,
      intent.BindingId,
      intent.VaultReferenceId,
      intent.ManifestSha256.ToLowerInvariant(),
      intent.DestinationScopeSha256.ToLowerInvariant(),
      intent.CapabilitySetSha256.ToLowerInvariant(),
      intent.Caller.UserSid,
      intent.Caller.ProcessId,
      intent.Caller.SessionId,
      intent.Caller.AgentExecutableSha256.ToLowerInvariant(),
      outcome,
      errorCode,
      result,
      previousHash,
      string.Empty);
    return unsigned with { Hash = ComputeHash(unsigned) };
  }

  private async ValueTask EnsureLoadedAsync(CancellationToken cancellationToken)
  {
    if (_loaded)
    {
      return;
    }

    if (!File.Exists(_path))
    {
      _loaded = true;
      return;
    }

    var info = new FileInfo(_path);
    if (info.Length > MaximumJournalBytes)
    {
      throw new SecretProvisioningException("secret_audit_journal_invalid");
    }

    var lines = await File.ReadAllLinesAsync(_path, cancellationToken).ConfigureAwait(false);
    foreach (var line in lines)
    {
      if (string.IsNullOrWhiteSpace(line)
        || Encoding.UTF8.GetByteCount(line) > MaximumLineBytes)
      {
        throw new SecretProvisioningException("secret_audit_journal_invalid");
      }

      SecretProvisioningAuditEntry entry;
      try
      {
        entry = JsonSerializer.Deserialize<SecretProvisioningAuditEntry>(
          line,
          SerializerOptions) ?? throw new JsonException();
      }
      catch (JsonException)
      {
        throw new SecretProvisioningException("secret_audit_journal_invalid");
      }

      ValidateLoadedEntry(entry);
      _entries.Add(entry);
    }

    ValidateRequestPairs();
    _loaded = true;
  }

  private async ValueTask AppendAsync(
    SecretProvisioningAuditEntry entry,
    CancellationToken cancellationToken)
  {
    Directory.CreateDirectory(Path.GetDirectoryName(_path)
      ?? throw new InvalidOperationException("The secret audit path has no parent."));
    var payload = JsonSerializer.SerializeToUtf8Bytes(entry, SerializerOptions);
    if (payload.Length > MaximumLineBytes)
    {
      throw new SecretProvisioningException("secret_audit_record_too_large");
    }

    await using var stream = new FileStream(
      _path,
      FileMode.Append,
      FileAccess.Write,
      FileShare.Read,
      4096,
      FileOptions.Asynchronous | FileOptions.WriteThrough);
    if (stream.Length + payload.Length + 1 > MaximumJournalBytes)
    {
      throw new SecretProvisioningException("secret_audit_journal_full");
    }

    await stream.WriteAsync(payload, cancellationToken).ConfigureAwait(false);
    await stream.WriteAsync("\n"u8.ToArray(), cancellationToken).ConfigureAwait(false);
    await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
    stream.Flush(flushToDisk: true);
    _entries.Add(entry);
  }

  private void ValidateLoadedEntry(SecretProvisioningAuditEntry entry)
  {
    var expectedSequence = _entries.Count + 1L;
    var expectedPrevious = _entries.Count == 0 ? GenesisHash : _entries[^1].Hash;
    if (entry.IntegrityVersion != IntegrityVersion
      || entry.Sequence != expectedSequence
      || !PayloadDigest.FixedTimeEqualsHex(entry.PreviousHash, expectedPrevious)
      || !PayloadDigest.FixedTimeEqualsHex(entry.Hash, ComputeHash(entry))
      || !Guid.TryParseExact(entry.RequestId, "D", out _)
      || !SecretProvisioningOperations.IsKnown(entry.Operation)
      || !PayloadDigest.IsSha256Hex(entry.ManifestSha256)
      || !PayloadDigest.IsSha256Hex(entry.DestinationScopeSha256)
      || !PayloadDigest.IsSha256Hex(entry.CapabilitySetSha256)
      || !PayloadDigest.IsSha256Hex(entry.AgentExecutableSha256)
      || entry.ProcessId <= 0
      || entry.SessionId < 0
      || string.IsNullOrWhiteSpace(entry.UserSid)
      || entry.Phase is not ("prepared" or "terminal")
      || (entry.Phase == "prepared" && (entry.Outcome is not null
        || entry.ErrorCode is not null
        || entry.Result is not null))
      || (entry.Phase == "terminal" && entry.Outcome is not (
        "completed" or "failed" or "needs_attention")))
    {
      throw new SecretProvisioningException("secret_audit_journal_invalid");
    }
  }

  private void ValidateRequestPairs()
  {
    foreach (var group in _entries.GroupBy(value => value.RequestId, StringComparer.Ordinal))
    {
      var entries = group.ToArray();
      if (entries.Length is < 1 or > 2
        || entries[0].Phase != "prepared"
        || (entries.Length == 2 && (entries[1].Phase != "terminal"
          || !Matches(entries[1], entries[0]))))
      {
        throw new SecretProvisioningException("secret_audit_journal_invalid");
      }
    }
  }

  private static bool Matches(
    SecretProvisioningAuditEntry entry,
    SecretProvisioningMutationIntent intent) =>
    string.Equals(entry.Operation, intent.Operation, StringComparison.Ordinal)
    && string.Equals(entry.BindingId, intent.BindingId, StringComparison.Ordinal)
    && string.Equals(entry.VaultReferenceId, intent.VaultReferenceId, StringComparison.Ordinal)
    && PayloadDigest.FixedTimeEqualsHex(entry.ManifestSha256, intent.ManifestSha256)
    && PayloadDigest.FixedTimeEqualsHex(
      entry.DestinationScopeSha256,
      intent.DestinationScopeSha256)
    && PayloadDigest.FixedTimeEqualsHex(entry.CapabilitySetSha256, intent.CapabilitySetSha256)
    && string.Equals(entry.UserSid, intent.Caller.UserSid, StringComparison.Ordinal)
    && PayloadDigest.FixedTimeEqualsHex(
      entry.AgentExecutableSha256,
      intent.Caller.AgentExecutableSha256);

  private static bool Matches(
    SecretProvisioningAuditEntry left,
    SecretProvisioningAuditEntry right) =>
    string.Equals(left.Operation, right.Operation, StringComparison.Ordinal)
    && string.Equals(left.BindingId, right.BindingId, StringComparison.Ordinal)
    && string.Equals(left.VaultReferenceId, right.VaultReferenceId, StringComparison.Ordinal)
    && PayloadDigest.FixedTimeEqualsHex(left.ManifestSha256, right.ManifestSha256)
    && PayloadDigest.FixedTimeEqualsHex(
      left.DestinationScopeSha256,
      right.DestinationScopeSha256)
    && PayloadDigest.FixedTimeEqualsHex(left.CapabilitySetSha256, right.CapabilitySetSha256)
    && string.Equals(left.UserSid, right.UserSid, StringComparison.Ordinal)
    && left.ProcessId == right.ProcessId
    && left.SessionId == right.SessionId
    && PayloadDigest.FixedTimeEqualsHex(
      left.AgentExecutableSha256,
      right.AgentExecutableSha256);

  private static string ComputeHash(SecretProvisioningAuditEntry entry)
  {
    var canonical = string.Join('\n',
      "itemba-msaidizi-secret-provisioning-audit-v1",
      entry.IntegrityVersion.ToString(CultureInfo.InvariantCulture),
      entry.Sequence.ToString(CultureInfo.InvariantCulture),
      entry.RecordedAt.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
      Encode(entry.Phase),
      Encode(entry.RequestId),
      Encode(entry.Operation),
      Encode(entry.BindingId),
      Encode(entry.VaultReferenceId ?? string.Empty),
      entry.ManifestSha256.ToLowerInvariant(),
      entry.DestinationScopeSha256.ToLowerInvariant(),
      entry.CapabilitySetSha256.ToLowerInvariant(),
      Encode(entry.UserSid),
      entry.ProcessId.ToString(CultureInfo.InvariantCulture),
      entry.SessionId.ToString(CultureInfo.InvariantCulture),
      entry.AgentExecutableSha256.ToLowerInvariant(),
      Encode(entry.Outcome ?? string.Empty),
      Encode(entry.ErrorCode ?? string.Empty),
      Encode(entry.Result is null
        ? string.Empty
        : JsonSerializer.Serialize(entry.Result, SerializerOptions)),
      entry.PreviousHash.ToLowerInvariant());
    return PayloadDigest.Sha256Hex(canonical);
  }

  private static string Encode(string value) =>
    Convert.ToBase64String(Encoding.UTF8.GetBytes(value));
}

internal sealed class SecretProvisioningCoordinator(
  ITrustedSecretProvisioner provisioner,
  FileSecretProvisioningAuditJournal auditJournal,
  IOptions<CompanionOptions> companionOptions)
{
  private readonly CompanionOptions _companion = companionOptions.Value;

  public async ValueTask<SecretProvisioningResult> ExecuteAsync(
    SecretProvisioningChallenge challenge,
    SecretProvisioningCallerIdentity caller,
    ReadOnlyMemory<byte> secret,
    CancellationToken cancellationToken)
  {
    var intent = CreateIntent(challenge, caller);
    var replay = await auditJournal.PrepareAsync(intent, cancellationToken)
      .ConfigureAwait(false);
    if (replay is not null)
    {
      return replay;
    }

    if (IsKillSwitchEngaged())
    {
      return await auditJournal.CompleteAsync(
        intent,
        "failed",
        "secret_provisioning_kill_switch_engaged",
        null,
        cancellationToken).ConfigureAwait(false);
    }

    var request = new TrustedSecretProvisioningRequest(
      challenge.Binding.Kind,
      challenge.Binding.DestinationScopeSha256,
      challenge.Binding.AllowedCapabilities);
    try
    {
      HostSecretReferenceMetadata metadata = challenge.Operation switch
      {
        SecretProvisioningOperations.Create => await provisioner.ProvisionWithReferenceAsync(
          challenge.RequestId,
          request,
          secret,
          cancellationToken).ConfigureAwait(false),
        SecretProvisioningOperations.Rotate => await provisioner.RotateAsync(
          challenge.VaultReferenceId!,
          request,
          secret,
          cancellationToken).ConfigureAwait(false),
        SecretProvisioningOperations.Delete => await provisioner.DeleteAsync(
          challenge.VaultReferenceId!,
          request,
          cancellationToken).ConfigureAwait(false),
        _ => throw new SecretProvisioningException("secret_operation_invalid"),
      };
      var result = new SecretProvisioningResultMetadata(
        metadata.VaultReferenceId,
        metadata.Kind,
        metadata.ScopeSha256,
        metadata.AllowedCapabilities,
        metadata.Version,
        metadata.CreatedAt,
        metadata.UpdatedAt);
      return await auditJournal.CompleteAsync(
        intent,
        "completed",
        null,
        result,
        cancellationToken).ConfigureAwait(false);
    }
    catch (HostSecretReferenceException exception)
    {
      return await auditJournal.CompleteAsync(
        intent,
        "failed",
        exception.ErrorCode,
        null,
        cancellationToken).ConfigureAwait(false);
    }
    catch (SecretProvisioningException exception)
    {
      return await auditJournal.CompleteAsync(
        intent,
        "failed",
        exception.ErrorCode,
        null,
        cancellationToken).ConfigureAwait(false);
    }
    catch (Exception exception) when (exception is IOException
      or UnauthorizedAccessException
      or CryptographicException)
    {
      return await auditJournal.CompleteAsync(
        intent,
        "needs_attention",
        "secret_mutation_outcome_uncertain",
        null,
        cancellationToken).ConfigureAwait(false);
    }
  }

  internal static SecretProvisioningMutationIntent CreateIntent(
    SecretProvisioningChallenge challenge,
    SecretProvisioningCallerIdentity caller) => new(
      challenge.RequestId,
      challenge.Operation,
      challenge.Binding.BindingId,
      challenge.Operation == SecretProvisioningOperations.Create
        ? challenge.RequestId
        : challenge.VaultReferenceId,
      challenge.ManifestSha256,
      challenge.Binding.DestinationScopeSha256,
      SecretProvisioningBindingCatalog.CapabilitySetSha256(challenge.Binding),
      caller);

  private bool IsKillSwitchEngaged() => File.Exists(Path.GetFullPath(
    Environment.ExpandEnvironmentVariables(_companion.KillSwitchPath)));
}

internal sealed class SecretProvisioningException(string errorCode) : Exception(errorCode)
{
  public string ErrorCode { get; } = errorCode;
}
