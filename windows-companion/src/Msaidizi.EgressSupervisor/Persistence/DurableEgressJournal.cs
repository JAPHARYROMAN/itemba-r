using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Contracts.Security;

namespace Itemba.Msaidizi.EgressSupervisor.Persistence;

public static class EgressSessionLifecycle
{
  public const string Reserved = "reserved";
  public const string Registered = "registered";
  public const string BrowserStarting = "browser-starting";
  public const string BrowserActive = "browser-active";
  public const string FlowActive = "flow-active";
  public const string FlowClosed = "flow-closed";
  public const string RecoveryUncertain = "recovery-uncertain";
  public const string Terminal = "terminal";

  public static IReadOnlySet<string> All { get; } = new HashSet<string>(
  [
    Reserved,
    Registered,
    BrowserStarting,
    BrowserActive,
    FlowActive,
    FlowClosed,
    RecoveryUncertain,
    Terminal,
  ], StringComparer.Ordinal);
}

public sealed record PersistedEgressSession(
  string ReserveOperationId,
  string ReserveRequestSha256,
  EgressActionBinding Binding,
  EgressExecutionAuthorization Authorization,
  long StartedAtUnixMilliseconds,
  string Lifecycle,
  string? RegistrationKind,
  string? RegistrationOperationId,
  string? RegistrationRequestSha256,
  string RegistrationSha256,
  EgressRegistrationAcknowledgementV1? RegistrationAcknowledgement,
  EgressDirectRegistrationV1? DirectRegistration,
  string? FlowId,
  string ReservationDnsAnswerSetSha256,
  string? ConnectionDnsAnswerSetSha256,
  string? SelectedAddressSha256,
  long MeasuredExternalEgressBytes,
  bool MeasurementUncertain,
  string FlowLogSha256,
  string? TerminalOperationId,
  string? TerminalDispositionSha256,
  SignedEgressReceipt? TerminalReceipt,
  [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  BrowserActionPolicyV1? BrowserActionPolicy = null,
  [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  EgressBrowserRegistrationV1? BrowserRegistration = null,
  [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  BrowserBoundaryRegistrationEvidenceV1? BrowserRegistrationEvidence = null,
  [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  BrowserBoundaryCompletionEvidenceV1? BrowserCompletionEvidence = null);

public sealed record EgressJournalSnapshot(
  IReadOnlyDictionary<string, PersistedEgressSession> SessionsByLeaseSha256,
  long LastJournalSequence,
  long LastReceiptSequence,
  string HeadSha256);

public interface IEgressJournalProtection
{
  void ValidatePreOpen(string directory, string journalPath, string lockPath);

  void ValidateOpened(FileStream journal, FileStream ownershipLock);
}

internal sealed record EgressJournalRecordV1(
  int FormatVersion,
  long Sequence,
  string EventId,
  long WrittenAtUnixMilliseconds,
  string EventKind,
  string LeaseSha256,
  string PreviousSha256,
  string SessionSha256,
  PersistedEgressSession Session,
  string RecordSha256);

/// <summary>
/// Single-writer, write-through, hash-chained lifecycle journal. Each record
/// carries a complete token-free session snapshot so recovery does not depend
/// on replaying caller-controlled commands or network traffic.
/// </summary>
public sealed class DurableEgressJournal : IDisposable
{
  private const int FormatVersion = 2;
  private const long MaximumJournalBytes = 268_435_456;
  private const int MaximumLineBytes = 262_144;
  private const int MaximumRecords = 500_000;
  private static readonly string GenesisSha256 = new('0', 64);
  private static readonly JsonSerializerOptions StrictJson = new(JsonSerializerDefaults.Web)
  {
    MaxDepth = 64,
    PropertyNameCaseInsensitive = false,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
  };

  private readonly string _path;
  private readonly bool _requirePreprovisionedFiles;
  private readonly IEgressJournalProtection? _protection;
  private readonly TimeProvider _timeProvider;
  private readonly object _gate = new();
  private readonly Dictionary<string, PersistedEgressSession> _sessions =
    new(StringComparer.Ordinal);
  private FileStream? _ownershipLock;
  private FileStream? _journal;
  private long _lastSequence;
  private long _lastReceiptSequence;
  private string _headSha256 = GenesisSha256;
  private int _initialized;
  private int _disposed;

  public DurableEgressJournal(
    string path,
    TimeProvider? timeProvider = null,
    bool requirePreprovisionedFiles = false,
    IEgressJournalProtection? protection = null)
  {
    if (string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path))
    {
      throw new ArgumentException("The egress journal path must be absolute.", nameof(path));
    }
    _path = Path.GetFullPath(path);
    _timeProvider = timeProvider ?? TimeProvider.System;
    _requirePreprovisionedFiles = requirePreprovisionedFiles;
    _protection = protection;
    if (_requirePreprovisionedFiles && _protection is null)
    {
      throw new ArgumentNullException(
        nameof(protection),
        "A preprovisioned egress journal requires a runtime protection verifier.");
    }
  }

  public void Initialize()
  {
    ThrowIfDisposed();
    lock (_gate)
    {
      if (Interlocked.Exchange(ref _initialized, 1) != 0)
      {
        return;
      }

      var directory = Path.GetDirectoryName(_path)
        ?? throw new InvalidOperationException("The egress journal has no parent directory.");
      if (_requirePreprovisionedFiles)
      {
        ValidatePreprovisionedTargets(directory);
        _protection!.ValidatePreOpen(directory, _path, _path + ".lock");
      }
      else
      {
        Directory.CreateDirectory(directory);
      }
      _ownershipLock = new FileStream(
        _path + ".lock",
        _requirePreprovisionedFiles ? FileMode.Open : FileMode.OpenOrCreate,
        FileAccess.ReadWrite,
        FileShare.None,
        1,
        FileOptions.WriteThrough);
      try
      {
        _journal = new FileStream(
          _path,
          _requirePreprovisionedFiles ? FileMode.Open : FileMode.OpenOrCreate,
          FileAccess.ReadWrite,
          FileShare.Read,
          16_384,
          FileOptions.WriteThrough);
        _protection?.ValidateOpened(_journal, _ownershipLock);
        LoadAndVerify();
        _journal.Position = _journal.Length;
      }
      catch
      {
        _journal?.Dispose();
        _journal = null;
        _ownershipLock.Dispose();
        _ownershipLock = null;
        Interlocked.Exchange(ref _initialized, 0);
        throw;
      }
    }
  }

  private void ValidatePreprovisionedTargets(string directory)
  {
    if (!Directory.Exists(directory)
      || !File.Exists(_path)
      || !File.Exists(_path + ".lock")
      || HasReparsePoint(directory)
      || HasReparsePoint(_path)
      || HasReparsePoint(_path + ".lock"))
    {
      throw new InvalidDataException(
        "The protected egress lifecycle journal was not preprovisioned exactly.");
    }
  }

  private static bool HasReparsePoint(string path)
  {
    var fullPath = Path.GetFullPath(path);
    if ((File.GetAttributes(fullPath) & FileAttributes.ReparsePoint) != 0)
    {
      return true;
    }
    var parent = Directory.GetParent(fullPath);
    while (parent is not null)
    {
      if ((parent.Attributes & FileAttributes.ReparsePoint) != 0)
      {
        return true;
      }
      parent = parent.Parent;
    }
    return false;
  }

  public EgressJournalSnapshot Snapshot()
  {
    EnsureInitialized();
    lock (_gate)
    {
      return new EgressJournalSnapshot(
        new Dictionary<string, PersistedEgressSession>(_sessions, StringComparer.Ordinal),
        _lastSequence,
        _lastReceiptSequence,
        _headSha256);
    }
  }

  public void Append(string eventKind, PersistedEgressSession session)
  {
    EnsureInitialized();
    ArgumentNullException.ThrowIfNull(session);
    lock (_gate)
    {
      ValidateSession(session);
      var leaseSha256 = EgressBoundaryCanonical.LeaseSha256(
        session.Authorization.Lease.Lease);
      if (_sessions.TryGetValue(leaseSha256, out var prior))
      {
        ValidateTransition(prior, session);
      }
      else if (!string.Equals(session.Lifecycle, EgressSessionLifecycle.Reserved,
        StringComparison.Ordinal))
      {
        throw new InvalidDataException("A new egress journal session must begin reserved.");
      }

      var sequence = checked(_lastSequence + 1);
      var eventId = Guid.NewGuid().ToString("D");
      var writtenAt = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
      var sessionBytes = JsonSerializer.SerializeToUtf8Bytes(session, StrictJson);
      try
      {
        var sessionSha256 = Sha256Hex(sessionBytes);
        var recordSha256 = RecordSha256(
          sequence,
          eventId,
          writtenAt,
          eventKind,
          leaseSha256,
          _headSha256,
          sessionSha256);
        var record = new EgressJournalRecordV1(
          FormatVersion,
          sequence,
          eventId,
          writtenAt,
          eventKind,
          leaseSha256,
          _headSha256,
          sessionSha256,
          session,
          recordSha256);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(record, StrictJson);
        try
        {
          if (bytes.Length > MaximumLineBytes
            || _journal is null
            || checked(_journal.Length + bytes.LongLength + 1L) > MaximumJournalBytes)
          {
            throw new IOException("The egress lifecycle journal is full.");
          }

          _journal.Write(bytes);
          _journal.WriteByte((byte)'\n');
          _journal.Flush(flushToDisk: true);
          _sessions[leaseSha256] = session;
          _lastSequence = sequence;
          _headSha256 = recordSha256;
          if (session.TerminalReceipt is { } terminal)
          {
            _lastReceiptSequence = Math.Max(
              _lastReceiptSequence,
              terminal.Receipt.Sequence);
          }
        }
        finally
        {
          CryptographicOperations.ZeroMemory(bytes);
        }
      }
      finally
      {
        CryptographicOperations.ZeroMemory(sessionBytes);
      }
    }
  }

  public void Dispose()
  {
    if (Interlocked.Exchange(ref _disposed, 1) != 0)
    {
      return;
    }

    lock (_gate)
    {
      _journal?.Dispose();
      _journal = null;
      _ownershipLock?.Dispose();
      _ownershipLock = null;
    }
  }

  private void LoadAndVerify()
  {
    _sessions.Clear();
    _lastSequence = 0;
    _lastReceiptSequence = 0;
    _headSha256 = GenesisSha256;
    if (_journal is null)
    {
      throw new InvalidOperationException("The egress lifecycle journal is not open.");
    }

    if (_journal.Length > MaximumJournalBytes)
    {
      throw new InvalidDataException("The egress lifecycle journal is oversized.");
    }

    var stream = _journal;
    stream.Position = 0;
    using var reader = new StreamReader(
      stream,
      new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true),
      detectEncodingFromByteOrderMarks: false,
      bufferSize: 16_384,
      leaveOpen: true);
    var records = 0;
    string? line;
    while ((line = reader.ReadLine()) is not null)
    {
      records++;
      if (records > MaximumRecords
        || line.Length == 0
        || Encoding.UTF8.GetByteCount(line) > MaximumLineBytes)
      {
        throw new InvalidDataException("The egress lifecycle journal is malformed.");
      }

      EgressJournalRecordV1 record;
      try
      {
        record = JsonSerializer.Deserialize<EgressJournalRecordV1>(line, StrictJson)
          ?? throw new JsonException();
      }
      catch (JsonException exception)
      {
        throw new InvalidDataException("The egress lifecycle journal is malformed.", exception);
      }

      ValidateRecord(record);
      ValidateSession(record.Session);
      if (record.Sequence != checked(_lastSequence + 1)
        || !FixedTimeHex(record.PreviousSha256, _headSha256)
        || !FixedTimeHex(
          record.LeaseSha256,
          EgressBoundaryCanonical.LeaseSha256(record.Session.Authorization.Lease.Lease)))
      {
        throw new InvalidDataException("The egress lifecycle journal chain is discontinuous.");
      }

      var sessionBytes = JsonSerializer.SerializeToUtf8Bytes(record.Session, StrictJson);
      try
      {
        var sessionSha256 = Sha256Hex(sessionBytes);
        var expectedRecordSha256 = RecordSha256(
          record.Sequence,
          record.EventId,
          record.WrittenAtUnixMilliseconds,
          record.EventKind,
          record.LeaseSha256,
          record.PreviousSha256,
          sessionSha256);
        if (!FixedTimeHex(record.SessionSha256, sessionSha256)
          || !FixedTimeHex(record.RecordSha256, expectedRecordSha256))
        {
          throw new InvalidDataException("The egress lifecycle journal hash is invalid.");
        }
      }
      finally
      {
        CryptographicOperations.ZeroMemory(sessionBytes);
      }

      if (_sessions.TryGetValue(record.LeaseSha256, out var prior))
      {
        ValidateTransition(prior, record.Session);
      }
      else if (!string.Equals(record.Session.Lifecycle, EgressSessionLifecycle.Reserved,
        StringComparison.Ordinal))
      {
        throw new InvalidDataException("The egress lifecycle journal omits reservation state.");
      }

      _sessions[record.LeaseSha256] = record.Session;
      _lastSequence = record.Sequence;
      _headSha256 = record.RecordSha256;
      if (record.Session.TerminalReceipt is { } terminal)
      {
        if (terminal.Receipt.Sequence <= _lastReceiptSequence)
        {
          throw new InvalidDataException("The egress receipt sequence rolled back or replayed.");
        }
        _lastReceiptSequence = terminal.Receipt.Sequence;
      }
    }

    if (stream.Length > 0)
    {
      stream.Position = stream.Length - 1;
      if (stream.ReadByte() != (byte)'\n')
      {
        throw new InvalidDataException("The egress lifecycle journal has a partial tail.");
      }
    }
  }

  private static void ValidateRecord(EgressJournalRecordV1 record)
  {
    if (record.FormatVersion != FormatVersion
      || record.Sequence <= 0
      || !Guid.TryParseExact(record.EventId, "D", out _)
      || record.WrittenAtUnixMilliseconds <= 0
      || string.IsNullOrWhiteSpace(record.EventKind)
      || record.EventKind.Length > 80
      || !IsCanonicalSha256(record.LeaseSha256)
      || !IsCanonicalSha256(record.PreviousSha256)
      || !IsCanonicalSha256(record.SessionSha256)
      || !IsCanonicalSha256(record.RecordSha256))
    {
      throw new InvalidDataException("An egress lifecycle journal record is invalid.");
    }
  }

  private static void ValidateSession(PersistedEgressSession session)
  {
    var lease = session.Authorization.Lease.Lease;
    if (!Guid.TryParseExact(session.ReserveOperationId, "D", out _)
      || !IsCanonicalSha256(session.ReserveRequestSha256)
      || !EgressSessionLifecycle.All.Contains(session.Lifecycle)
      || session.StartedAtUnixMilliseconds <= 0
      || !IsCanonicalSha256(session.RegistrationSha256)
      || !IsCanonicalSha256(session.ReservationDnsAnswerSetSha256)
      || !FixedTimeHex(
        session.ReservationDnsAnswerSetSha256,
        lease.ReservationDnsAnswerSetSha256)
      || (session.ConnectionDnsAnswerSetSha256 is null)
        != (session.SelectedAddressSha256 is null)
      || (session.ConnectionDnsAnswerSetSha256 is not null
        && (!IsCanonicalSha256(session.ConnectionDnsAnswerSetSha256)
          || !IsCanonicalSha256(session.SelectedAddressSha256!)
          || !FixedTimeHex(
            session.ConnectionDnsAnswerSetSha256,
            session.ReservationDnsAnswerSetSha256)))
      || session.MeasuredExternalEgressBytes < 0
      || !IsCanonicalSha256(session.FlowLogSha256)
      || session.MeasuredExternalEgressBytes > lease.ReservedCapabilityEgressBytes
      || (session.TerminalReceipt is null)
        != !string.Equals(session.Lifecycle, EgressSessionLifecycle.Terminal,
          StringComparison.Ordinal)
      || (session.RegistrationAcknowledgement is null)
        != (session.RegistrationKind is null)
      || (session.DirectRegistration is null)
        != !string.Equals(session.RegistrationKind,
          EgressSupervisorLifecycleContract.DirectRegistration,
          StringComparison.Ordinal)
      || !ValidBrowserState(session, lease))
    {
      throw new InvalidDataException("An egress lifecycle session is invalid.");
    }
  }

  private static bool ValidBrowserState(
    PersistedEgressSession session,
    EgressLeaseV1 lease)
  {
    var managedBrowser = string.Equals(
        lease.CapabilityId,
        ManagedBrowserBoundaryContract.CapabilityId,
        StringComparison.Ordinal)
      && string.Equals(
        lease.CapabilityVersion,
        ManagedBrowserBoundaryContract.CapabilityVersion,
        StringComparison.Ordinal);
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
      || !FixedTimeHex(policy.ExpectedPreStateSha256, lease.ExpectedPreStateSha256 ?? string.Empty)
      || !FixedTimeHex(policy.IdempotencyKeySha256, lease.IdempotencyKeySha256))
    {
      return false;
    }

    var registration = session.BrowserRegistration;
    var evidence = session.BrowserRegistrationEvidence;
    var completion = session.BrowserCompletionEvidence;
    var policySha256 = BrowserBoundaryCanonical.ActionPolicySha256(policy);
    var leaseSha256 = EgressBoundaryCanonical.LeaseSha256(lease);
    var hasAcknowledgedBrowser = string.Equals(
        session.RegistrationKind,
        EgressSupervisorLifecycleContract.BrowserRegistration,
        StringComparison.Ordinal)
      && session.RegistrationAcknowledgement is not null;

    if (registration is not null
      && (!ValidBrowserRegistration(registration, policy, policySha256)
        || !FixedTimeHex(
          session.RegistrationSha256,
          EgressSupervisorLifecycleCanonical.RegistrationSha256(registration))))
    {
      return false;
    }
    if (evidence is not null
      && (registration is null
        || !BrowserBoundaryContractValidator.IsRegistrationEvidenceValid(evidence)
        || !FixedTimeHex(evidence.LeaseSha256, leaseSha256)
        || !FixedTimeHex(evidence.RegistrationSha256, session.RegistrationSha256)
        || !FixedTimeHex(evidence.ActionPolicySha256, policySha256)
        || !ExactBrokerIdentity(evidence.BrokerIdentity, registration)))
    {
      return false;
    }
    if (completion is not null
      && (evidence is null
        || !BrowserBoundaryContractValidator.TryValidateSuccessfulCompletion(
          policy,
          evidence,
          completion,
          out _)
        || !FixedTimeHex(
          session.FlowLogSha256,
          BrowserBoundaryCanonical.EventLogSha256(evidence, completion))
        || !FixedTimeHex(
          session.ConnectionDnsAnswerSetSha256 ?? string.Empty,
          completion.ConnectionDnsAnswerSetSha256)
        || !FixedTimeHex(
          session.SelectedAddressSha256 ?? string.Empty,
          completion.SelectedAddressSha256)
        || session.MeasuredExternalEgressBytes != completion.MeasuredExternalEgressBytes
        || session.MeasurementUncertain))
    {
      return false;
    }

    return session.Lifecycle switch
    {
      EgressSessionLifecycle.Reserved => registration is null
        && evidence is null
        && completion is null
        && !hasAcknowledgedBrowser,
      EgressSessionLifecycle.BrowserStarting => registration is not null
        && evidence is null
        && completion is null
        && !hasAcknowledgedBrowser,
      EgressSessionLifecycle.BrowserActive => registration is not null
        && evidence is not null
        && completion is null
        && hasAcknowledgedBrowser,
      EgressSessionLifecycle.FlowClosed => registration is not null
        && evidence is not null
        && completion is not null
        && hasAcknowledgedBrowser,
      EgressSessionLifecycle.RecoveryUncertain => registration is not null
        && completion is null,
      EgressSessionLifecycle.Terminal => completion is null
        ? registration is null || evidence is null || hasAcknowledgedBrowser
        : hasAcknowledgedBrowser,
      _ => false,
    };
  }

  private static bool ValidBrowserRegistration(
    EgressBrowserRegistrationV1 registration,
    BrowserActionPolicyV1 policy,
    string policySha256) =>
    registration.ContractVersion == EgressSupervisorLifecycleContract.Version
    && Guid.TryParseExact(registration.RegistrationId, "D", out _)
    && registration.WindowsSessionId > 0
    && registration.BrowserBrokerProcessId > 0
    && registration.BrowserBrokerProcessCreationTimeUnixMilliseconds > 0
    && IsCanonicalSha256(registration.BrowserBrokerImageSha256)
    && IsCanonicalSha256(registration.BrowserBrokerBuildSha256)
    && IsCanonicalSha256(registration.CompletionNonceSha256)
    && FixedTimeHex(registration.OriginSha256, policy.ExpectedOriginSha256)
    && FixedTimeHex(registration.ActionPolicySha256, policySha256);

  private static bool ExactBrokerIdentity(
    BrowserBrokerIdentityV1 identity,
    EgressBrowserRegistrationV1 registration) =>
    identity.WindowsSessionId == registration.WindowsSessionId
    && identity.ProcessId == registration.BrowserBrokerProcessId
    && identity.ProcessCreationTimeUnixMilliseconds
      == registration.BrowserBrokerProcessCreationTimeUnixMilliseconds
    && FixedTimeHex(identity.ImageSha256, registration.BrowserBrokerImageSha256)
    && FixedTimeHex(identity.BuildSha256, registration.BrowserBrokerBuildSha256);

  private static void ValidateTransition(
    PersistedEgressSession prior,
    PersistedEgressSession next)
  {
    if (!FixedTimeHex(
        EgressBoundaryCanonical.LeaseSha256(prior.Authorization.Lease.Lease),
        EgressBoundaryCanonical.LeaseSha256(next.Authorization.Lease.Lease))
      || !FixedTimeHex(prior.ReserveRequestSha256, next.ReserveRequestSha256)
      || !string.Equals(prior.ReserveOperationId, next.ReserveOperationId,
        StringComparison.Ordinal)
      || !FixedTimeHex(
        prior.ReservationDnsAnswerSetSha256,
        next.ReservationDnsAnswerSetSha256)
      || !ImmutableOptionalDigest(
        prior.ConnectionDnsAnswerSetSha256,
        next.ConnectionDnsAnswerSetSha256)
      || !ImmutableOptionalDigest(
        prior.SelectedAddressSha256,
        next.SelectedAddressSha256)
      || !ImmutableBrowserPolicy(prior.BrowserActionPolicy, next.BrowserActionPolicy)
      || !ImmutableBrowserRegistration(prior.BrowserRegistration, next.BrowserRegistration)
      || !ImmutableBrowserRegistrationEvidence(
        prior.BrowserRegistrationEvidence,
        next.BrowserRegistrationEvidence)
      || !ImmutableBrowserCompletionEvidence(
        prior.BrowserRegistrationEvidence,
        prior.BrowserCompletionEvidence,
        next.BrowserRegistrationEvidence,
        next.BrowserCompletionEvidence)
      || prior.TerminalReceipt is not null
      || next.MeasuredExternalEgressBytes < prior.MeasuredExternalEgressBytes
      || (string.Equals(prior.Lifecycle, EgressSessionLifecycle.FlowActive,
          StringComparison.Ordinal)
        && string.Equals(next.Lifecycle, EgressSessionLifecycle.FlowActive,
          StringComparison.Ordinal)
        && (prior.ConnectionDnsAnswerSetSha256 is not null
          || next.ConnectionDnsAnswerSetSha256 is null
          || prior.MeasuredExternalEgressBytes != next.MeasuredExternalEgressBytes
          || prior.MeasurementUncertain != next.MeasurementUncertain
          || !FixedTimeHex(prior.FlowLogSha256, next.FlowLogSha256)))
      || !AllowedTransition(prior.Lifecycle, next.Lifecycle))
    {
      throw new InvalidDataException("An egress lifecycle transition is invalid.");
    }
  }

  private static bool ImmutableOptionalDigest(string? prior, string? next) =>
    prior is null
      ? next is null || IsCanonicalSha256(next)
      : next is not null && FixedTimeHex(prior, next);

  private static bool ImmutableBrowserPolicy(
    BrowserActionPolicyV1? prior,
    BrowserActionPolicyV1? next) => prior is null
      ? next is null
      : next is not null && FixedTimeHex(
        BrowserBoundaryCanonical.ActionPolicySha256(prior),
        BrowserBoundaryCanonical.ActionPolicySha256(next));

  private static bool ImmutableBrowserRegistration(
    EgressBrowserRegistrationV1? prior,
    EgressBrowserRegistrationV1? next) => prior is null
      ? next is null || IsCanonicalSha256(
        EgressSupervisorLifecycleCanonical.RegistrationSha256(next))
      : next is not null && FixedTimeHex(
        EgressSupervisorLifecycleCanonical.RegistrationSha256(prior),
        EgressSupervisorLifecycleCanonical.RegistrationSha256(next));

  private static bool ImmutableBrowserRegistrationEvidence(
    BrowserBoundaryRegistrationEvidenceV1? prior,
    BrowserBoundaryRegistrationEvidenceV1? next) => prior is null
      ? next is null || BrowserBoundaryContractValidator.IsRegistrationEvidenceValid(next)
      : next is not null && FixedTimeHex(
        BrowserBoundaryCanonical.RegistrationEvidenceSha256(prior),
        BrowserBoundaryCanonical.RegistrationEvidenceSha256(next));

  private static bool ImmutableBrowserCompletionEvidence(
    BrowserBoundaryRegistrationEvidenceV1? priorRegistration,
    BrowserBoundaryCompletionEvidenceV1? prior,
    BrowserBoundaryRegistrationEvidenceV1? nextRegistration,
    BrowserBoundaryCompletionEvidenceV1? next) => prior is null
      ? next is null || nextRegistration is not null
      : next is not null
        && priorRegistration is not null
        && nextRegistration is not null
        && FixedTimeHex(
          BrowserBoundaryCanonical.EventLogSha256(priorRegistration, prior),
          BrowserBoundaryCanonical.EventLogSha256(nextRegistration, next));

  private static bool AllowedTransition(string prior, string next) => prior switch
  {
    EgressSessionLifecycle.Reserved => next is EgressSessionLifecycle.Registered
      or EgressSessionLifecycle.BrowserStarting
      or EgressSessionLifecycle.Terminal,
    EgressSessionLifecycle.Registered => next is EgressSessionLifecycle.FlowActive
      or EgressSessionLifecycle.Terminal,
    EgressSessionLifecycle.BrowserStarting => next is EgressSessionLifecycle.BrowserActive
      or EgressSessionLifecycle.RecoveryUncertain
      or EgressSessionLifecycle.Terminal,
    EgressSessionLifecycle.BrowserActive => next is EgressSessionLifecycle.FlowClosed
      or EgressSessionLifecycle.RecoveryUncertain
      or EgressSessionLifecycle.Terminal,
    EgressSessionLifecycle.FlowActive => next is EgressSessionLifecycle.FlowActive
      or EgressSessionLifecycle.FlowClosed
      or EgressSessionLifecycle.RecoveryUncertain
      or EgressSessionLifecycle.Terminal,
    EgressSessionLifecycle.FlowClosed => next == EgressSessionLifecycle.Terminal,
    EgressSessionLifecycle.RecoveryUncertain => next == EgressSessionLifecycle.Terminal,
    _ => false,
  };

  private static string RecordSha256(
    long sequence,
    string eventId,
    long writtenAt,
    string eventKind,
    string leaseSha256,
    string previousSha256,
    string sessionSha256)
  {
    var canonical = string.Join('\n',
      "MSAIDIZI-EGRESS-SUPERVISOR-JOURNAL-V2",
      sequence.ToString(CultureInfo.InvariantCulture),
      Field(eventId),
      writtenAt.ToString(CultureInfo.InvariantCulture),
      Field(eventKind),
      Field(leaseSha256),
      Field(previousSha256),
      Field(sessionSha256));
    var bytes = Encoding.UTF8.GetBytes(canonical);
    try
    {
      return Sha256Hex(bytes);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(bytes);
    }
  }

  private static string Field(string value) => $"{Encoding.UTF8.GetByteCount(value)}:{value}";

  private static string Sha256Hex(ReadOnlySpan<byte> value) =>
    Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();

  private static bool IsCanonicalSha256(string value) => value.Length == 64
    && string.Equals(value, value.ToLowerInvariant(), StringComparison.Ordinal)
    && value.All(Uri.IsHexDigit);

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

  private void EnsureInitialized()
  {
    ThrowIfDisposed();
    if (Volatile.Read(ref _initialized) == 0)
    {
      throw new InvalidOperationException("The egress lifecycle journal is not initialized.");
    }
  }

  private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(
    Volatile.Read(ref _disposed) != 0,
    this);
}
