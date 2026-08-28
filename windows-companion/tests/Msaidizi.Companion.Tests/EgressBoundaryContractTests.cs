using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed partial class EgressBoundaryContractTests : IDisposable
{
  private const long NowUnixMilliseconds = 1_800_000_000_000;
  private const string DeviceId = "20000000-0000-4000-8000-000000000002";
  private const string ActionTokenSha256 =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  private const string DestinationPolicySha256 =
    "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  private const string ExecutionIdentitySha256 =
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"msaidizi-egress-tests-{Guid.NewGuid():N}");

  [Fact]
  public void VerifiesIndependentSupervisorSignatureAndExactBindings()
  {
    using var harness = CreateHarness();

    var verified = harness.Verifier.VerifyReceipt(
      harness.Evidence,
      harness.Binding,
      EgressBoundaryFeatures.CommandRequired);

    Assert.True(verified.IsValid, verified.ErrorCode);
    Assert.NotNull(verified.Value);
    Assert.Equal(
      EgressBoundaryCanonical.ReceiptSha256(harness.Evidence.Receipt.Receipt),
      verified.Value.ReceiptSha256);

    var pairedDeviceKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    using (pairedDeviceKey)
    {
      var selfAttested = harness.Evidence with
      {
        Authorization = harness.Evidence.Authorization with
        {
          Attestation = EgressBoundaryCanonical.SignAttestation(
            harness.Evidence.Authorization.Attestation.Attestation,
            "boundary-supervisor-v1",
            pairedDeviceKey),
        },
      };
      Assert.Equal(
        "egress_attestation_signature_invalid",
        harness.Verifier.VerifyReceipt(
          selfAttested,
          harness.Binding,
          EgressBoundaryFeatures.CommandRequired).ErrorCode);
    }

    Assert.Equal(
      "egress_lease_binding_invalid",
      harness.Verifier.VerifyReceipt(
        harness.Evidence,
        harness.Binding with { ActionTokenSha256 = new string('b', 64) },
        EgressBoundaryFeatures.CommandRequired).ErrorCode);
    Assert.Equal(
      "egress_lease_binding_invalid",
      harness.Verifier.VerifyReceipt(
        harness.Evidence,
        harness.Binding with { DestinationPolicySha256 = new string('c', 64) },
        EgressBoundaryFeatures.CommandRequired).ErrorCode);
    Assert.Equal(
      "egress_lease_binding_invalid",
      harness.Verifier.VerifyReceipt(
        harness.Evidence,
        harness.Binding with { ExecutionIdentitySha256 = new string('d', 64) },
        EgressBoundaryFeatures.CommandRequired).ErrorCode);
  }

  [Fact]
  public void RejectsHostIntegrityFailureAndStaleAttestation()
  {
    using var harness = CreateHarness();
    var attestation = harness.Evidence.Authorization.Attestation.Attestation;
    var noHvci = harness.Evidence.Authorization with
    {
      Attestation = EgressBoundaryCanonical.SignAttestation(
        attestation with { HvciEnabled = false },
        "boundary-supervisor-v1",
        harness.SupervisorKey),
    };
    Assert.Equal(
      "egress_attestation_invalid",
      harness.Verifier.VerifyAuthorization(
        noHvci,
        harness.Binding,
        EgressBoundaryFeatures.CommandRequired).ErrorCode);

    var stale = harness.Evidence.Authorization with
    {
      Attestation = EgressBoundaryCanonical.SignAttestation(
        attestation with
        {
          IssuedAtUnixMilliseconds = NowUnixMilliseconds - 600_000,
          ExpiresAtUnixMilliseconds = NowUnixMilliseconds - 60_000,
        },
        "boundary-supervisor-v1",
        harness.SupervisorKey),
    };
    Assert.Equal(
      "egress_attestation_stale",
      harness.Verifier.VerifyAuthorization(
        stale,
        harness.Binding,
        EgressBoundaryFeatures.CommandRequired).ErrorCode);
  }

  [Fact]
  public void UnknownOutcomeMustChargeTheFullReservation()
  {
    using var harness = CreateHarness();
    var receipt = harness.Evidence.Receipt.Receipt;
    var partialUnknown = receipt with
    {
      MeasuredExternalEgressBytes = 100,
      UncertainExternalEgressBytes = 0,
      ChargedExternalEgressBytes = 100,
      Outcome = "unknown",
    };
    var partialEvidence = harness.Evidence with
    {
      Receipt = EgressBoundaryCanonical.SignReceipt(
        partialUnknown,
        "boundary-receipt-v1",
        harness.ReceiptKey),
    };
    Assert.Equal(
      "egress_receipt_binding_invalid",
      harness.Verifier.VerifyReceipt(
        partialEvidence,
        harness.Binding,
        EgressBoundaryFeatures.CommandRequired).ErrorCode);

    var fullUnknown = partialUnknown with
    {
      UncertainExternalEgressBytes = 900,
      ChargedExternalEgressBytes = 1_000,
    };
    var fullEvidence = harness.Evidence with
    {
      Receipt = EgressBoundaryCanonical.SignReceipt(
        fullUnknown,
        "boundary-receipt-v1",
        harness.ReceiptKey),
    };
    Assert.True(harness.Verifier.VerifyReceipt(
      fullEvidence,
      harness.Binding,
      EgressBoundaryFeatures.CommandRequired).IsValid);
  }

  [Fact]
  public void SignedContractRejectsUppercaseSha256Fields()
  {
    using var harness = CreateHarness();
    var nonCanonical = harness.Evidence.Receipt.Receipt with
    {
      RegistrationSha256 = new string('A', 64),
    };
    var evidence = harness.Evidence with
    {
      Receipt = EgressBoundaryCanonical.SignReceipt(
        nonCanonical,
        "boundary-receipt-v1",
        harness.ReceiptKey),
    };

    Assert.Equal(
      "egress_receipt_binding_invalid",
      harness.Verifier.VerifyReceipt(
        evidence,
        harness.Binding,
        EgressBoundaryFeatures.CommandRequired).ErrorCode);
  }

  [Fact]
  public void BrowserEffectsRequireOriginCompletionAndBrokerMeasurementClaims()
  {
    using var commandHarness = CreateHarness();
    Assert.Equal(
      "egress_attestation_invalid",
      commandHarness.Verifier.VerifyAttestation(
        commandHarness.Evidence.Authorization.Attestation,
        EgressBoundaryFeatures.BrowserRequired).ErrorCode);

    using var browserHarness = CreateHarness(browser: true, DateTimeOffset.UtcNow);
    var verified = browserHarness.Verifier.VerifyAttestation(
      browserHarness.Evidence.Authorization.Attestation,
      EgressBoundaryFeatures.BrowserRequired);
    Assert.True(verified.IsValid, verified.ErrorCode);
    Assert.NotNull(verified.Value);

    Assert.Equal(
      EgressBoundaryFeatures.BrowserRequired,
      StandardUserCapabilityCatalog.RequiredBoundaryFeatures(
        StandardUserCapabilityCatalog.BrowserFormTextSet.Id));
  }

  [Fact]
  public void CommandEffectsRejectBrowserFeatureSupersets()
  {
    using var browserHarness = CreateHarness(browser: true, DateTimeOffset.UtcNow);

    var verified = browserHarness.Verifier.VerifyAttestation(
      browserHarness.Evidence.Authorization.Attestation,
      EgressBoundaryFeatures.CommandRequired);

    Assert.Equal("egress_attestation_invalid", verified.ErrorCode);
    Assert.False(verified.IsValid);
  }

  [Fact]
  public async Task ReplayLedgerSurvivesRestartAllowsExactIdempotencyAndRejectsConflicts()
  {
    var path = Path.Combine(_directory, "receipt-replay.jsonl");
    var bootId = "40000000-0000-4000-8000-000000000004";
    using (var first = new FileEgressReceiptReplayStore(path))
    {
      Assert.True(await first.TryCommitAsync(
        "60000000-0000-4000-8000-000000000006",
        "70000000-0000-4000-8000-000000000006",
        new string('6', 64),
        "50000000-0000-4000-8000-000000000005",
        bootId,
        1,
        CancellationToken.None));
    }

    using (var restarted = new FileEgressReceiptReplayStore(path))
    {
      Assert.True(await restarted.TryCommitAsync(
        "60000000-0000-4000-8000-000000000006",
        "70000000-0000-4000-8000-000000000006",
        new string('6', 64),
        "50000000-0000-4000-8000-000000000005",
        bootId,
        1,
        CancellationToken.None));
      Assert.False(await restarted.TryCommitAsync(
        "60000000-0000-4000-8000-000000000007",
        "70000000-0000-4000-8000-000000000007",
        new string('7', 64),
        "50000000-0000-4000-8000-000000000005",
        bootId,
        2,
        CancellationToken.None));
      Assert.False(await restarted.TryCommitAsync(
        "60000000-0000-4000-8000-000000000008",
        "70000000-0000-4000-8000-000000000008",
        new string('8', 64),
        "50000000-0000-4000-8000-000000000008",
        bootId,
        1,
        CancellationToken.None));
      Assert.True(await restarted.TryCommitAsync(
        "60000000-0000-4000-8000-000000000009",
        "70000000-0000-4000-8000-000000000009",
        new string('9', 64),
        "50000000-0000-4000-8000-000000000009",
        bootId,
        2,
        CancellationToken.None));
    }
    Assert.Equal(2, File.ReadLines(path).Count());
  }

  [Fact]
  public async Task ReplayLedgerRejectsSameActionIdentityWithFreshReceiptAndLease()
  {
    var path = Path.Combine(_directory, "action-identity-replay.jsonl");
    var actionId = "70000000-0000-4000-8000-000000000056";
    var bootId = "40000000-0000-4000-8000-000000000054";
    using (var first = new FileEgressReceiptReplayStore(path))
    {
      Assert.True(await first.TryCommitAsync(
        "60000000-0000-4000-8000-000000000056",
        actionId,
        new string('6', 64),
        "50000000-0000-4000-8000-000000000055",
        bootId,
        1,
        CancellationToken.None));
    }

    using (var restarted = new FileEgressReceiptReplayStore(path))
    {
      Assert.False(await restarted.TryCommitAsync(
        "60000000-0000-4000-8000-000000000057",
        actionId,
        new string('7', 64),
        "50000000-0000-4000-8000-000000000057",
        bootId,
        2,
        CancellationToken.None));
    }
    Assert.Single(File.ReadLines(path));
  }

  [Fact]
  public async Task ReplayLedgerRejectsConcurrentOwnerAndMalformedRestartState()
  {
    var path = Path.Combine(_directory, "exclusive-receipts.jsonl");
    using (var owner = new FileEgressReceiptReplayStore(path))
    {
      Assert.True(await owner.TryCommitAsync(
        "60000000-0000-4000-8000-000000000026",
        "70000000-0000-4000-8000-000000000026",
        new string('6', 64),
        "50000000-0000-4000-8000-000000000025",
        "40000000-0000-4000-8000-000000000024",
        1,
        CancellationToken.None));
      using var contender = new FileEgressReceiptReplayStore(path);
      await Assert.ThrowsAnyAsync<IOException>(() => contender.TryCommitAsync(
        "60000000-0000-4000-8000-000000000027",
        "70000000-0000-4000-8000-000000000027",
        new string('7', 64),
        "50000000-0000-4000-8000-000000000027",
        "40000000-0000-4000-8000-000000000024",
        2,
        CancellationToken.None).AsTask());
    }

    File.AppendAllText(path, "{\"partial\":true}", new UTF8Encoding(false));
    using var restarted = new FileEgressReceiptReplayStore(path);
    await Assert.ThrowsAsync<InvalidDataException>(() => restarted.TryCommitAsync(
      "60000000-0000-4000-8000-000000000028",
      "70000000-0000-4000-8000-000000000028",
      new string('8', 64),
      "50000000-0000-4000-8000-000000000028",
      "40000000-0000-4000-8000-000000000024",
      2,
      CancellationToken.None).AsTask());
  }

  [Fact]
  public async Task ReplayLedgerRejectsHashTamperAndUnknownJsonFields()
  {
    var path = Path.Combine(_directory, "tampered-receipts.jsonl");
    using (var store = new FileEgressReceiptReplayStore(path))
    {
      Assert.True(await store.TryCommitAsync(
        "60000000-0000-4000-8000-000000000036",
        "70000000-0000-4000-8000-000000000036",
        new string('6', 64),
        "50000000-0000-4000-8000-000000000035",
        "40000000-0000-4000-8000-000000000034",
        1,
        CancellationToken.None));
    }

    var canonical = File.ReadAllText(path, Encoding.UTF8);
    File.WriteAllText(
      path,
      canonical.Replace(new string('6', 64), new string('7', 64), StringComparison.Ordinal),
      new UTF8Encoding(false));
    using (var tampered = new FileEgressReceiptReplayStore(path))
    {
      await Assert.ThrowsAsync<InvalidDataException>(() => tampered.TryCommitAsync(
        "60000000-0000-4000-8000-000000000037",
        "70000000-0000-4000-8000-000000000037",
        new string('8', 64),
        "50000000-0000-4000-8000-000000000037",
        "40000000-0000-4000-8000-000000000034",
        2,
        CancellationToken.None).AsTask());
    }

    File.WriteAllText(
      path,
      canonical.TrimEnd('\r', '\n').Insert(
        canonical.TrimEnd('\r', '\n').Length - 1,
        ",\"unexpected\":true") + "\n",
      new UTF8Encoding(false));
    using var unknownField = new FileEgressReceiptReplayStore(path);
    await Assert.ThrowsAsync<InvalidDataException>(() => unknownField.TryCommitAsync(
      "60000000-0000-4000-8000-000000000038",
      "70000000-0000-4000-8000-000000000038",
      new string('8', 64),
      "50000000-0000-4000-8000-000000000038",
      "40000000-0000-4000-8000-000000000034",
      2,
      CancellationToken.None).AsTask());
  }

  [Fact]
  public async Task ReplayLedgerExpandsTheDeploymentOwnedProgramDataStylePath()
  {
    Directory.CreateDirectory(_directory);
    const string variable = "MSAIDIZI_TEST_EGRESS_LEDGER_ROOT";
    var previous = Environment.GetEnvironmentVariable(variable);
    Environment.SetEnvironmentVariable(variable, _directory);
    try
    {
      var expectedPath = Path.Combine(_directory, "expanded-receipts.jsonl");
      using var store = new FileEgressReceiptReplayStore(
        $"%{variable}%\\expanded-receipts.jsonl");
      Assert.True(await store.TryCommitAsync(
        "60000000-0000-4000-8000-000000000016",
        "70000000-0000-4000-8000-000000000016",
        new string('a', 64),
        "50000000-0000-4000-8000-000000000015",
        "40000000-0000-4000-8000-000000000014",
        1,
        CancellationToken.None));
      Assert.True(File.Exists(expectedPath));
    }
    finally
    {
      Environment.SetEnvironmentVariable(variable, previous);
    }
  }

  [Theory]
  [InlineData("relative-receipts.jsonl")]
  [InlineData(@"\\server\share\receipts.jsonl")]
  [InlineData(@"\\?\C:\receipts.jsonl")]
  [InlineData(@"\\.\C:\receipts.jsonl")]
  [InlineData(@"\??\C:\receipts.jsonl")]
  [InlineData(@"C:\receipts.jsonl:alternate")]
  [InlineData(@"C:\ProgramData\Itemba\NUL.jsonl")]
  [InlineData(@"C:\ProgramData\Itemba\receipts.jsonl.")]
  public void ReplayLedgerRejectsNonlocalDeviceAndAlternateDataStreamPaths(string path)
  {
    Assert.Throws<ArgumentException>(() => new FileEgressReceiptReplayStore(path));
  }

  [Fact]
  public async Task ReplayLedgerRejectsReparsePointAncestorWithoutWritingTarget()
  {
    var root = Path.Combine(_directory, "reparse-root");
    var outside = Path.Combine(_directory, "reparse-target");
    var link = Path.Combine(root, "linked");
    Directory.CreateDirectory(root);
    Directory.CreateDirectory(outside);
    try
    {
      CreateJunction(link, outside);

      using var store = new FileEgressReceiptReplayStore(
        Path.Combine(link, "receipts.v1.jsonl"));
      await Assert.ThrowsAsync<UnauthorizedAccessException>(() => store.TryCommitAsync(
        "60000000-0000-4000-8000-000000000046",
        "70000000-0000-4000-8000-000000000046",
        new string('6', 64),
        "50000000-0000-4000-8000-000000000045",
        "40000000-0000-4000-8000-000000000044",
        1,
        CancellationToken.None).AsTask());
      Assert.False(File.Exists(Path.Combine(outside, "receipts.v1.jsonl")));
    }
    finally
    {
      if (Directory.Exists(link))
      {
        Directory.Delete(link, recursive: false);
      }
    }
  }

  [Fact]
  public async Task ReplayLedgerRejectsHardLinkedLedgerFile()
  {
    Directory.CreateDirectory(_directory);
    var original = Path.Combine(_directory, "hard-link-origin.jsonl");
    var linked = Path.Combine(_directory, "hard-link-ledger.jsonl");
    File.WriteAllBytes(original, []);
    Assert.True(CreateHardLink(linked, original, IntPtr.Zero));
    using var store = new FileEgressReceiptReplayStore(linked);

    await Assert.ThrowsAsync<UnauthorizedAccessException>(() => store.TryCommitAsync(
      "60000000-0000-4000-8000-000000000066",
      "70000000-0000-4000-8000-000000000066",
      new string('6', 64),
      "50000000-0000-4000-8000-000000000065",
      "40000000-0000-4000-8000-000000000064",
      1,
      CancellationToken.None).AsTask());
    Assert.Empty(File.ReadAllBytes(original));
  }

  [Fact]
  public async Task ReplayLedgerPinsSingleLinkIdentityAgainstReplacementRace()
  {
    var path = Path.Combine(_directory, "identity-pinned.jsonl");
    using (var store = new FileEgressReceiptReplayStore(path))
    {
      Assert.True(await store.TryCommitAsync(
        "60000000-0000-4000-8000-000000000076",
        "70000000-0000-4000-8000-000000000076",
        new string('7', 64),
        "50000000-0000-4000-8000-000000000075",
        "40000000-0000-4000-8000-000000000074",
        1,
        CancellationToken.None));
      var replacement = Path.Combine(_directory, "replacement.jsonl");
      File.WriteAllText(replacement, string.Empty, new UTF8Encoding(false));

      var replacementFailure = Record.Exception(() => File.Move(
        replacement,
        path,
        overwrite: true));

      Assert.NotNull(replacementFailure);
      Assert.True(replacementFailure is IOException or UnauthorizedAccessException);
    }
    Assert.Single(File.ReadLines(path));
  }

  [Fact]
  public void ProductionReplayLedgerCannotBeRedirectedFromTheInstallerOwnedPath()
  {
    var redirected = Path.Combine(_directory, "redirected.jsonl");

    Assert.Throws<ArgumentException>(() => new FileEgressReceiptReplayStore(
      redirected,
      requireInstallerBoundary: true));
    Assert.False(File.Exists(redirected));
  }

  [Fact]
  public async Task ReplayStartupRejectsPartialStateAndTripsTheOneWayDispatchLatch()
  {
    Directory.CreateDirectory(_directory);
    var path = Path.Combine(_directory, "startup-partial.jsonl");
    File.WriteAllText(path, "{\"partial\":true}", new UTF8Encoding(false));
    using var store = new FileEgressReceiptReplayStore(path);
    var latch = new EgressBoundaryDispatchLatch();
    var startup = new EgressReceiptReplayStartupVerifier(store, latch);

    await Assert.ThrowsAsync<InvalidDataException>(() => startup.StartAsync(
      CancellationToken.None));

    Assert.True(latch.IsTripped);
    var refusal = Assert.Throws<EgressBoundaryUnsafeException>(latch.ThrowIfTripped);
    Assert.Equal("egress_replay_reconciliation_required", refusal.ErrorCode);
    Assert.False(refusal.MayHaveExecuted);
  }

  [Fact]
  public async Task ReceiptReplayStorageFailureTripsTheLatchAndSurfacesFatalAmbiguity()
  {
    using var harness = CreateHarness();
    var latch = new EgressBoundaryDispatchLatch();
    var verifier = new LocalSystemEgressEvidenceVerifier(
      harness.Verifier,
      new ThrowingReplayStore(),
      latch);

    var failure = await Assert.ThrowsAsync<EgressBoundaryUnsafeException>(() =>
      verifier.VerifyAndCommitReceiptAsync(
        harness.Evidence,
        harness.Binding,
        EgressBoundaryFeatures.CommandRequired,
        CancellationToken.None).AsTask());

    Assert.Equal("egress_receipt_replay_unavailable", failure.ErrorCode);
    Assert.True(failure.MayHaveExecuted);
    Assert.True(latch.IsTripped);
  }

  [Fact]
  public async Task InvalidPostExecutionReceiptTripsTheLatchBeforeFurtherDispatch()
  {
    using var harness = CreateHarness();
    using var store = new FileEgressReceiptReplayStore(
      Path.Combine(_directory, "invalid-receipt.jsonl"));
    var latch = new EgressBoundaryDispatchLatch();
    var verifier = new LocalSystemEgressEvidenceVerifier(
      harness.Verifier,
      store,
      latch);
    var invalid = harness.Evidence with
    {
      Receipt = harness.Evidence.Receipt with
      {
        SignatureBase64 = Convert.ToBase64String(new byte[64]),
      },
    };

    var failure = await Assert.ThrowsAsync<EgressBoundaryUnsafeException>(() =>
      verifier.VerifyAndCommitReceiptAsync(
        invalid,
        harness.Binding,
        EgressBoundaryFeatures.CommandRequired,
        CancellationToken.None).AsTask());

    Assert.Equal("egress_receipt_signature_invalid", failure.ErrorCode);
    Assert.True(failure.MayHaveExecuted);
    Assert.True(latch.IsTripped);
    Assert.False(File.Exists(Path.Combine(_directory, "invalid-receipt.jsonl")));
  }

  private static void CreateJunction(string junctionPath, string targetPath)
  {
    Directory.CreateDirectory(junctionPath);
    using var handle = OpenDirectoryForReparsePoint(junctionPath);
    Assert.False(handle.IsInvalid);
    var substituteName = $@"\??\{Path.GetFullPath(targetPath)}";
    var printName = Path.GetFullPath(targetPath);
    var substituteBytes = Encoding.Unicode.GetBytes(substituteName);
    var printBytes = Encoding.Unicode.GetBytes(printName);
    var pathBufferLength = checked(substituteBytes.Length + 2 + printBytes.Length + 2);
    var reparseDataLength = checked((ushort)(8 + pathBufferLength));
    var buffer = new byte[checked(8 + reparseDataLength)];
    BitConverter.GetBytes(0xA0000003u).CopyTo(buffer, 0);
    BitConverter.GetBytes(reparseDataLength).CopyTo(buffer, 4);
    BitConverter.GetBytes((ushort)0).CopyTo(buffer, 6);
    BitConverter.GetBytes((ushort)0).CopyTo(buffer, 8);
    BitConverter.GetBytes(checked((ushort)substituteBytes.Length)).CopyTo(buffer, 10);
    BitConverter.GetBytes(checked((ushort)(substituteBytes.Length + 2))).CopyTo(buffer, 12);
    BitConverter.GetBytes(checked((ushort)printBytes.Length)).CopyTo(buffer, 14);
    substituteBytes.CopyTo(buffer, 16);
    printBytes.CopyTo(buffer, checked(16 + substituteBytes.Length + 2));
    var unmanaged = Marshal.AllocHGlobal(buffer.Length);
    try
    {
      Marshal.Copy(buffer, 0, unmanaged, buffer.Length);
      Assert.True(SetReparsePoint(
        handle,
        0x000900A4,
        unmanaged,
        checked((uint)buffer.Length),
        IntPtr.Zero,
        0,
        out _,
        IntPtr.Zero));
    }
    finally
    {
      Marshal.FreeHGlobal(unmanaged);
    }
  }

  [LibraryImport("kernel32.dll", EntryPoint = "CreateFileW", SetLastError = true,
    StringMarshalling = StringMarshalling.Utf16)]
  private static partial SafeFileHandle OpenDirectoryForReparsePoint(
    string fileName,
    uint desiredAccess = 0x40000000,
    uint shareMode = 0,
    IntPtr securityAttributes = default,
    uint creationDisposition = 3,
    uint flagsAndAttributes = 0x02200000,
    IntPtr templateFile = default);

  [LibraryImport("kernel32.dll", EntryPoint = "DeviceIoControl", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool SetReparsePoint(
    SafeFileHandle device,
    uint controlCode,
    IntPtr inputBuffer,
    uint inputBufferSize,
    IntPtr outputBuffer,
    uint outputBufferSize,
    out uint bytesReturned,
    IntPtr overlapped);

  [LibraryImport("kernel32.dll", EntryPoint = "CreateHardLinkW", SetLastError = true,
    StringMarshalling = StringMarshalling.Utf16)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool CreateHardLink(
    string fileName,
    string existingFileName,
    IntPtr securityAttributes);

  [Fact]
  public void CanonicalAttestationVectorMatchesTheTypeScriptProtocol()
  {
    var vector = new BoundaryAttestationV1(
      EgressBoundaryCanonical.ContractVersion,
      "10000000-0000-4000-8000-000000000001",
      DeviceId,
      "30000000-0000-4000-8000-000000000003",
      "40000000-0000-4000-8000-000000000004",
      1_800_000_000_000,
      1_800_000_120_000,
      SecureBootEnabled: true,
      HvciEnabled: true,
      DriverActive: true,
      ServiceActive: true,
      new string('1', 64),
      new string('2', 64),
      BrowserBrokerBuildSha256: null,
      "receipt-key-v1",
      "AQID",
      new string('3', 64),
      EgressBoundaryFeatures.CommandRequired);

    Assert.Equal(
      "1841578b4b0ae916ad8f6db05e014a3be30546000858af43ebc0b41ccf4ec078",
      EgressBoundaryCanonical.AttestationSha256(vector));
  }

  public void Dispose()
  {
    if (Directory.Exists(_directory))
    {
      Directory.Delete(_directory, recursive: true);
    }
  }

  private static TestHarness CreateHarness(
    bool browser = false,
    DateTimeOffset? now = null)
  {
    var current = now ?? DateTimeOffset.FromUnixTimeMilliseconds(NowUnixMilliseconds);
    var currentMilliseconds = current.ToUnixTimeMilliseconds();
    var supervisorKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var receiptKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var receiptPublicKey = receiptKey.ExportSubjectPublicKeyInfo();
    var features = browser
      ? EgressBoundaryFeatures.BrowserRequired
      : EgressBoundaryFeatures.CommandRequired;
    var attestation = new BoundaryAttestationV1(
      EgressBoundaryCanonical.ContractVersion,
      "10000000-0000-4000-8000-000000000001",
      DeviceId,
      "30000000-0000-4000-8000-000000000003",
      "40000000-0000-4000-8000-000000000004",
      currentMilliseconds - 60_000,
      currentMilliseconds + 120_000,
      SecureBootEnabled: true,
      HvciEnabled: true,
      DriverActive: true,
      ServiceActive: true,
      new string('1', 64),
      new string('2', 64),
      browser ? new string('3', 64) : null,
      "boundary-receipt-v1",
      Convert.ToBase64String(receiptPublicKey),
      Convert.ToHexString(SHA256.HashData(receiptPublicKey)).ToLowerInvariant(),
      features);
    var signedAttestation = EgressBoundaryCanonical.SignAttestation(
      attestation,
      "boundary-supervisor-v1",
      supervisorKey);
    var lease = new EgressLeaseV1(
      EgressBoundaryCanonical.ContractVersion,
      "50000000-0000-4000-8000-000000000005",
      EgressBoundaryCanonical.AttestationSha256(attestation),
      ActionTokenSha256,
      "70000000-0000-4000-8000-000000000007",
      "80000000-0000-4000-8000-000000000008",
      "90000000-0000-4000-8000-000000000009",
      "a0000000-0000-4000-8000-00000000000a",
      DeviceId,
      "b0000000-0000-4000-8000-00000000000b",
      browser ? "browser.uri.open" : "command.emergency.execute",
      "1.0.0",
      1,
      DestinationPolicySha256,
      ExecutionIdentitySha256,
      new string('a', 64),
      new string('b', 64),
      new string('c', 64),
      new string('d', 64),
      new string('e', 64),
      new string('f', 64),
      new string('1', 64),
      1_000,
      currentMilliseconds - 10_000,
      currentMilliseconds + 60_000);
    var signedLease = EgressBoundaryCanonical.SignLease(
      lease,
      "boundary-receipt-v1",
      receiptKey);
    var receipt = new EgressReceiptV1(
      EgressBoundaryCanonical.ContractVersion,
      "60000000-0000-4000-8000-000000000006",
      EgressBoundaryCanonical.LeaseSha256(lease),
      EgressBoundaryCanonical.AttestationSha256(attestation),
      ActionTokenSha256,
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
      lease.ReservationDnsAnswerSetSha256,
      new string('2', 64),
      new string('5', 64),
      new string('6', 64),
      lease.ReservedCapabilityEgressBytes,
      100,
      0,
      100,
      currentMilliseconds - 5_000,
      currentMilliseconds - 1_000,
      1,
      new string('4', 64),
      "completed");
    var signedReceipt = EgressBoundaryCanonical.SignReceipt(
      receipt,
      "boundary-receipt-v1",
      receiptKey);
    var binding = new EgressActionBinding(
      ActionTokenSha256,
      lease.ActionId,
      lease.TaskId,
      lease.PlanVersionId,
      lease.StepId,
      lease.DeviceId,
      lease.MandateId,
      lease.CapabilityId,
      lease.CapabilityVersion,
      lease.DispatchCount,
      lease.ReservedCapabilityEgressBytes,
      DestinationPolicySha256,
      ExecutionIdentitySha256,
      lease.ArgumentsSha256,
      lease.ExpectedPreStateSha256,
      lease.IdempotencyKeySha256);
    var verifier = new EgressBoundaryContractVerifier(
      EgressBoundaryVerificationSettings.Strict(DeviceId),
      new StaticAttestationKeyResolver("boundary-supervisor-v1", supervisorKey),
      new FixedTimeProvider(current));
    return new TestHarness(
      supervisorKey,
      receiptKey,
      verifier,
      binding,
      new EgressExecutionEvidence(
        new EgressExecutionAuthorization(signedAttestation, signedLease),
        signedReceipt));
  }

  private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
  {
    public override DateTimeOffset GetUtcNow() => now;
  }

  private sealed class StaticAttestationKeyResolver : IEgressAttestationKeyResolver
  {
    private readonly string _keyId;
    private readonly ECParameters _parameters;

    public StaticAttestationKeyResolver(string keyId, ECDsa publicKey)
    {
      _keyId = keyId;
      _parameters = publicKey.ExportParameters(includePrivateParameters: false);
    }

    public bool TryResolve(string keyId, out ECDsa? publicKey)
    {
      if (!string.Equals(keyId, _keyId, StringComparison.Ordinal))
      {
        publicKey = null;
        return false;
      }

      publicKey = ECDsa.Create(_parameters);
      return true;
    }
  }

  private sealed class ThrowingReplayStore : IEgressReceiptReplayStore
  {
    public ValueTask InitializeAsync(CancellationToken cancellationToken) =>
      ValueTask.CompletedTask;

    public ValueTask<bool> TryCommitAsync(
      string receiptId,
      string actionId,
      string receiptSha256,
      string authorizationLeaseId,
      string boundaryBootId,
      long receiptSequence,
      CancellationToken cancellationToken) =>
      ValueTask.FromException<bool>(new IOException("simulated durable write failure"));
  }

  private sealed record TestHarness(
    ECDsa SupervisorKey,
    ECDsa ReceiptKey,
    EgressBoundaryContractVerifier Verifier,
    EgressActionBinding Binding,
    EgressExecutionEvidence Evidence) : IDisposable
  {
    public void Dispose()
    {
      SupervisorKey.Dispose();
      ReceiptKey.Dispose();
    }
  }
}
