using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Itemba.Msaidizi.AuditSigner.Channel;
using Itemba.Msaidizi.AuditSigner.Configuration;
using Itemba.Msaidizi.AuditSigner.Contracts;
using Itemba.Msaidizi.AuditSigner.Execution;
using Itemba.Msaidizi.AuditSigner.Journal;
using Itemba.Msaidizi.AuditSigner.Security;
using Xunit;

namespace Itemba.Msaidizi.AuditSigner.Tests;

public sealed class TrustedAuditSignerTests : IDisposable
{
  private readonly string _root = Path.Combine(
    Path.GetTempPath(),
    "msaidizi-audit-signer-tests",
    Guid.NewGuid().ToString("N"));

  public TrustedAuditSignerTests() => Directory.CreateDirectory(_root);

  [Fact]
  public async Task SignsExactChainAndSurvivesRestart()
  {
    var options = Options();
    using var signer = new TestSigner();
    var broker = new FakeBroker(options.SignerKeyId);
    broker.AppendEvent("{\"cursor\":\"1\",\"payload\":{\"a\":1}}", 1);
    var journal = new FileAuditSignerJournal(options.JournalPath);
    var engine = new TrustedAuditSignerEngine(options, journal, broker, signer);

    Assert.True(await engine.RunOnceAsync(CancellationToken.None));
    Assert.Equal("1", journal.State.AcceptedHead.Cursor);
    Assert.Null(journal.State.Pending);
    Assert.Single(broker.Submitted);
    VerifyCheckpointSignature(broker.Submitted[0], signer.Certificate);

    broker.AppendEvent("{\"cursor\":\"2\",\"payload\":{\"b\":2}}", 2);
    var restarted = new FileAuditSignerJournal(options.JournalPath);
    var restartedEngine = new TrustedAuditSignerEngine(options, restarted, broker, signer);
    Assert.True(await restartedEngine.RunOnceAsync(CancellationToken.None));
    Assert.Equal("2", restarted.State.AcceptedHead.Cursor);
    Assert.Equal(2, broker.Submitted.Count);
  }

  [Fact]
  public async Task LostReceiptReplaysIdenticalPendingCheckpointWithoutResigning()
  {
    var options = Options();
    using var signer = new TestSigner();
    var broker = new FakeBroker(options.SignerKeyId) { LoseFirstReceipt = true };
    broker.AppendEvent("{\"cursor\":\"1\",\"payload\":\"once\"}", 1);
    var journal = new FileAuditSignerJournal(options.JournalPath);
    var engine = new TrustedAuditSignerEngine(options, journal, broker, signer);

    await Assert.ThrowsAsync<HttpRequestException>(
      () => engine.RunOnceAsync(CancellationToken.None));
    var original = Assert.IsType<PendingAuditCheckpoint>(journal.State.Pending).Checkpoint;

    var restarted = new FileAuditSignerJournal(options.JournalPath);
    var replayEngine = new TrustedAuditSignerEngine(options, restarted, broker, signer);
    Assert.True(await replayEngine.RunOnceAsync(CancellationToken.None));
    Assert.Null(restarted.State.Pending);
    Assert.Equal("1", restarted.State.AcceptedHead.Cursor);
    Assert.Equal(2, broker.Submitted.Count);
    Assert.All(broker.Submitted, item =>
      Assert.Equal(original.ManifestJson, item.ManifestJson));
  }

  [Fact]
  public void TamperAndForkedBrokerHeadFailClosed()
  {
    var options = Options();
    using var signer = new TestSigner();
    var local = new AuditSignerHead(
      "5",
      new string('a', 64),
      new string('b', 64));
    var forked = new AuditSegmentResponse(
      new AuditCheckpointHead("4", new string('c', 64), new string('d', 64)),
      [],
      false,
      300,
      options.SignerKeyId);
    Assert.Throws<InvalidDataException>(
      () => AuditSignerProtocol.ValidateSegment(forked, local, options));

    var material = "{\"cursor\":\"6\"}";
    var badEvent = new UnsignedAuditEvent(
      "6",
      1,
      local.EventHash,
      new string('e', 64),
      material);
    var tampered = forked with
    {
      CheckpointHead = new AuditCheckpointHead(local.Cursor, local.EventHash, local.ManifestSha256),
      Events = [badEvent],
    };
    Assert.Throws<InvalidDataException>(
      () => AuditSignerProtocol.ValidateSegment(tampered, local, options));
  }

  [Fact]
  public async Task JournalDetectsTamperAndRejectsLocalRollback()
  {
    var options = Options();
    using var signer = new TestSigner();
    var broker = new FakeBroker(options.SignerKeyId);
    broker.AppendEvent("{\"cursor\":\"1\"}", 1);
    var journal = new FileAuditSignerJournal(options.JournalPath);
    await new TrustedAuditSignerEngine(options, journal, broker, signer)
      .RunOnceAsync(CancellationToken.None);

    var text = File.ReadAllText(options.JournalPath);
    File.WriteAllText(options.JournalPath, text.Replace("ACCEPTED", "REJECTED",
      StringComparison.Ordinal));
    Assert.Throws<InvalidDataException>(() => new FileAuditSignerJournal(options.JournalPath));

    var cleanOptions = Options("rollback");
    var clean = new FileAuditSignerJournal(cleanOptions.JournalPath);
    broker = new FakeBroker(cleanOptions.SignerKeyId);
    broker.AppendEvent("{\"cursor\":\"1\"}", 1);
    await new TrustedAuditSignerEngine(cleanOptions, clean, broker, signer)
      .RunOnceAsync(CancellationToken.None);
    var invalidManifest = broker.Submitted[0].Manifest with
    {
      CheckpointId = Guid.NewGuid().ToString("D"),
      PreviousCheckpointSha256 = AuditSignerProtocol.ZeroSha256,
      PreviousEventHash = AuditSignerProtocol.ZeroSha256,
      FromCursor = "2",
      ToCursor = "2",
      EventHeadHash = new string('f', 64),
    };
    var invalidJson = AuditSignerProtocol.CanonicalManifestJson(invalidManifest);
    var invalid = new SignedAuditCheckpoint(
      invalidManifest,
      invalidJson,
      AuditSignerProtocol.Sha256(Encoding.UTF8.GetBytes(invalidJson)),
      broker.Submitted[0].Signature);
    await Assert.ThrowsAsync<InvalidDataException>(
      () => clean.AppendSignedAsync(invalid, CancellationToken.None));
  }

  [Fact]
  public async Task KillSwitchPreventsFetchAndSigning()
  {
    var options = Options();
    Directory.CreateDirectory(Path.GetDirectoryName(options.KillSwitchPath)!);
    await File.WriteAllTextAsync(options.KillSwitchPath, "disabled");
    using var signer = new TestSigner();
    var broker = new FakeBroker(options.SignerKeyId);
    broker.AppendEvent("{\"cursor\":\"1\"}", 1);
    var journal = new FileAuditSignerJournal(options.JournalPath);

    Assert.False(await new TrustedAuditSignerEngine(options, journal, broker, signer)
      .RunOnceAsync(CancellationToken.None));
    Assert.Equal(0, broker.FetchCount);
    Assert.Empty(broker.Submitted);
    Assert.Equal(AuditSignerHead.Genesis, journal.State.AcceptedHead);
  }

  [Fact]
  public void CheckpointLifetimeIsBoundedAndCanonical()
  {
    var options = Options().WithOptions(checkpointTtlSeconds: 120);
    using var signer = new TestSigner();
    var head = AuditSignerHead.Genesis;
    var material = "{\"cursor\":\"1\"}";
    var eventHash = AuditSignerProtocol.Sha256(Encoding.UTF8.GetBytes(material));
    var segment = new AuditSegmentResponse(
      new AuditCheckpointHead(head.Cursor, head.EventHash, head.ManifestSha256),
      [new UnsignedAuditEvent("1", 1, head.EventHash, eventHash, material)],
      false,
      60,
      options.SignerKeyId);
    var now = new DateTimeOffset(2026, 8, 26, 10, 20, 30, 456, TimeSpan.Zero);

    var signed = AuditSignerProtocol.CreateCheckpoint(segment, head, options, signer, now);
    Assert.Equal("2026-08-26T10:20:30.456Z", signed.Manifest.IssuedAt);
    Assert.Equal("2026-08-26T10:21:30.456Z", signed.Manifest.ExpiresAt);
    Assert.Equal(signed.ManifestJson, AuditSignerProtocol.CanonicalManifestJson(signed.Manifest));

    var invalid = segment with { MaxCheckpointTtlSeconds = 5 };
    Assert.Throws<InvalidDataException>(
      () => AuditSignerProtocol.CreateCheckpoint(invalid, head, options, signer, now));
  }

  [Fact]
  public void WrongBrokerCertificateOrChainIsRejected()
  {
    using var expected = TestCertificate("expected");
    using var wrong = TestCertificate("wrong");
    var expectedCertificate = AuditSignerProtocol.Sha256(expected.RawData);
    using var expectedKey = expected.GetECDsaPublicKey();
    Assert.NotNull(expectedKey);
    var expectedSpki = AuditSignerProtocol.Sha256(expectedKey.ExportSubjectPublicKeyInfo());

    Assert.True(BrokerCertificatePinValidator.Validate(
      expected,
      SslPolicyErrors.None,
      expectedCertificate,
      expectedSpki));
    Assert.False(BrokerCertificatePinValidator.Validate(
      wrong,
      SslPolicyErrors.None,
      expectedCertificate,
      expectedSpki));
    Assert.False(BrokerCertificatePinValidator.Validate(
      expected,
      SslPolicyErrors.RemoteCertificateChainErrors,
      expectedCertificate,
      expectedSpki));
  }

  public void Dispose()
  {
    try
    {
      if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
    catch
    {
      // Test cleanup is best effort; production code never deletes trusted state.
    }
  }

  private AuditSignerOptions Options(string suffix = "default")
  {
    var supervisor = Path.Combine(_root, suffix, "supervisor");
    return new AuditSignerOptions
    {
      BrokerBaseUri = "https://broker.invalid/api/v1/",
      ClientCertificateThumbprint = "test",
      SignerKeyId = "audit-test-key",
      PinnedBrokerCertificateSha256 = new string('a', 64),
      PinnedBrokerSpkiSha256 = new string('b', 64),
      SupervisorRoot = Path.Combine(supervisor, "audit-signer"),
      JournalPath = Path.Combine(supervisor, "audit-signer", "journal.jsonl"),
      KillSwitchPath = Path.Combine(supervisor, "DISABLED"),
      MaxSegmentEvents = 256,
      CheckpointTtlSeconds = 300,
      PollIntervalSeconds = 2,
    };
  }

  private static void VerifyCheckpointSignature(
    SignedAuditCheckpoint checkpoint,
    X509Certificate2 certificate)
  {
    using var key = certificate.GetECDsaPublicKey();
    Assert.NotNull(key);
    Assert.True(key.VerifyData(
      Encoding.UTF8.GetBytes(checkpoint.ManifestJson),
      DecodeBase64Url(checkpoint.Signature),
      HashAlgorithmName.SHA256,
      DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
  }

  private static byte[] DecodeBase64Url(string value)
  {
    var padded = value.Replace('-', '+').Replace('_', '/');
    padded += new string('=', (4 - padded.Length % 4) % 4);
    return Convert.FromBase64String(padded);
  }

  private static X509Certificate2 TestCertificate(string name)
  {
    using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var request = new CertificateRequest(
      $"CN={name}",
      key,
      HashAlgorithmName.SHA256);
    return request.CreateSelfSigned(
      DateTimeOffset.UtcNow.AddMinutes(-1),
      DateTimeOffset.UtcNow.AddHours(1));
  }

  private sealed class TestSigner : IAuditCheckpointSigner, IDisposable
  {
    private readonly ECDsa _key = ECDsa.Create(ECCurve.NamedCurves.nistP256);

    public TestSigner()
    {
      var request = new CertificateRequest("CN=audit-test", _key, HashAlgorithmName.SHA256);
      Certificate = request.CreateSelfSigned(
        DateTimeOffset.UtcNow.AddMinutes(-1),
        DateTimeOffset.UtcNow.AddHours(1));
      CertificateSha256 = AuditSignerProtocol.Sha256(Certificate.RawData);
      using var publicKey = Certificate.GetECDsaPublicKey();
      SubjectPublicKeySha256 = AuditSignerProtocol.Sha256(
        publicKey?.ExportSubjectPublicKeyInfo()
        ?? throw new CryptographicException("Test certificate is not ECDSA."));
    }

    public X509Certificate2 Certificate { get; }
    public string CertificateSha256 { get; }
    public string SubjectPublicKeySha256 { get; }

    public byte[] Sign(byte[] canonicalManifest) => _key.SignData(
      canonicalManifest,
      HashAlgorithmName.SHA256,
      DSASignatureFormat.IeeeP1363FixedFieldConcatenation);

    public void Dispose()
    {
      Certificate.Dispose();
      _key.Dispose();
    }
  }

  private sealed class FakeBroker(string signerKeyId) : IAuditSignerBrokerClient
  {
    private readonly List<UnsignedAuditEvent> _events = [];
    private AuditSignerHead _head = AuditSignerHead.Genesis;
    private bool _receiptLost;

    public bool LoseFirstReceipt { get; init; }
    public int FetchCount { get; private set; }
    public List<SignedAuditCheckpoint> Submitted { get; } = [];

    public void AppendEvent(string canonicalMaterial, long cursor)
    {
      var previous = _events.LastOrDefault()?.EventHash ?? AuditSignerProtocol.ZeroSha256;
      _events.Add(new UnsignedAuditEvent(
        cursor.ToString(System.Globalization.CultureInfo.InvariantCulture),
        1,
        previous,
        AuditSignerProtocol.Sha256(Encoding.UTF8.GetBytes(canonicalMaterial)),
        canonicalMaterial));
    }

    public Task<AuditSegmentResponse> FetchSegmentAsync(
      AuditSignerHead head,
      int limit,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      FetchCount++;
      if (head != _head) throw new HttpRequestException("conflicting checkpoint head");
      var after = AuditSignerProtocol.ParseCursor(head.Cursor, allowZero: true);
      var rows = _events.Where(item =>
          AuditSignerProtocol.ParseCursor(item.Cursor, allowZero: false) > after)
        .Take(limit)
        .ToArray();
      return Task.FromResult(new AuditSegmentResponse(
        new AuditCheckpointHead(head.Cursor, head.EventHash, head.ManifestSha256),
        rows,
        _events.Count(item =>
          AuditSignerProtocol.ParseCursor(item.Cursor, allowZero: false) > after) > rows.Length,
        300,
        signerKeyId));
    }

    public Task<AuditCheckpointReceipt> SubmitCheckpointAsync(
      SignedAuditCheckpoint checkpoint,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      Submitted.Add(checkpoint);
      if (_head.ManifestSha256 == checkpoint.ManifestSha256)
      {
        return Task.FromResult(new AuditCheckpointReceipt(
          true,
          true,
          checkpoint.Manifest.CheckpointId));
      }
      if (_head.ManifestSha256 != checkpoint.Manifest.PreviousCheckpointSha256 ||
          _head.EventHash != checkpoint.Manifest.PreviousEventHash)
        throw new HttpRequestException("fork");
      _head = new AuditSignerHead(
        checkpoint.Manifest.ToCursor,
        checkpoint.Manifest.EventHeadHash,
        checkpoint.ManifestSha256);
      if (LoseFirstReceipt && !_receiptLost)
      {
        _receiptLost = true;
        throw new HttpRequestException("lost receipt");
      }
      return Task.FromResult(new AuditCheckpointReceipt(
        true,
        false,
        checkpoint.Manifest.CheckpointId));
    }
  }
}

internal static class TestOptionsExtensions
{
  public static AuditSignerOptions WithOptions(
    this AuditSignerOptions value,
    int checkpointTtlSeconds) => new()
    {
      BrokerBaseUri = value.BrokerBaseUri,
      ClientCertificateThumbprint = value.ClientCertificateThumbprint,
      SignerKeyId = value.SignerKeyId,
      HardwareKeyProvider = value.HardwareKeyProvider,
      PinnedBrokerCertificateSha256 = value.PinnedBrokerCertificateSha256,
      PinnedBrokerSpkiSha256 = value.PinnedBrokerSpkiSha256,
      SupervisorRoot = value.SupervisorRoot,
      JournalPath = value.JournalPath,
      KillSwitchPath = value.KillSwitchPath,
      MaxSegmentEvents = value.MaxSegmentEvents,
      CheckpointTtlSeconds = checkpointTtlSeconds,
      PollIntervalSeconds = value.PollIntervalSeconds,
    };
}
