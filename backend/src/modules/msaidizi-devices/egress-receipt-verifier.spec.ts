import { createHash, generateKeyPairSync, KeyObject, sign } from 'node:crypto';
import {
  boundaryAttestationClaims,
  boundaryAttestationSha256,
  BoundaryAttestationClaims,
  canonicalBoundaryAttestationBytes,
  canonicalEgressAuthorizationLeaseBytes,
  canonicalEgressReceiptBytes,
  EgressAuthorizationLeaseClaims,
  EGRESS_EVIDENCE_BUNDLE_DOMAIN,
  EgressReceiptClaims,
  EgressReceiptProof,
  egressAuthorizationLeaseClaims,
  egressAuthorizationLeaseSha256,
  egressEvidenceSha256,
  egressReceiptClaims,
  egressReceiptSha256,
  parseWireEgressReceiptProof,
  SignedBoundaryAttestation,
  SignedEgressAuthorizationLease,
  SignedEgressReceipt,
} from './egress-receipt.protocol';
import {
  EgressReceiptVerificationError,
  EgressReceiptVerificationOptions,
  egressPublicKeySpkiSha256,
  verifyEgressReceiptProof,
} from './egress-receipt-verifier';

const NOW = 1_800_000_000_000;
const attestationId = '10000000-0000-4000-8000-000000000001';
const deviceId = '20000000-0000-4000-8000-000000000002';
const supervisorInstanceId = '30000000-0000-4000-8000-000000000003';
const bootId = '40000000-0000-4000-8000-000000000004';
const leaseId = '50000000-0000-4000-8000-000000000005';
const receiptId = '60000000-0000-4000-8000-000000000006';
const actionId = '70000000-0000-4000-8000-000000000007';
const taskId = '80000000-0000-4000-8000-000000000008';
const planVersionId = '90000000-0000-4000-8000-000000000009';
const stepId = 'a0000000-0000-4000-8000-00000000000a';
const mandateId = 'b0000000-0000-4000-8000-00000000000b';

interface Harness {
  proof: EgressReceiptProof;
  options: EgressReceiptVerificationOptions;
  supervisorPrivateKey: KeyObject;
  receiptPrivateKey: KeyObject;
}

describe('egress receipt v4 trust-chain verification', () => {
  it('accepts a proof authorized by the independently enrolled boundary supervisor', () => {
    const harness = createHarness();
    expect(verifyEgressReceiptProof(harness.proof, harness.options)).toMatchObject({
      chargedExternalEgressBytes: 1_500,
      receiptPublicKeySha256: harness.proof.authorization.attestation.receiptPublicKeySha256,
      reservationDnsAnswerSetSha256: 'c'.repeat(64),
      connectionDnsAnswerSetSha256: 'c'.repeat(64),
      selectedAddressSha256: '4'.repeat(64),
    });
  });

  it('rejects a receipt whose connection DNS set escaped its reservation before trust evaluation', () => {
    const harness = createHarness();
    harness.proof.receipt.connectionDnsAnswerSetSha256 = '5'.repeat(64);

    expectThrowCode(
      () => verifyEgressReceiptProof(harness.proof, harness.options),
      'EGRESS_DNS_ANSWER_SET_CONTAINMENT_INVALID',
    );
  });

  it('exposes the fixed cross-platform digest of the exact signed evidence bundle', () => {
    const harness = createHarness();
    const { attestation, lease } = harness.proof.authorization;
    const { receipt } = harness.proof;
    const stringLine = (value: string) => Buffer.from(value, 'utf8').toString('base64url');
    const expected = createHash('sha256')
      .update(
        [
          EGRESS_EVIDENCE_BUNDLE_DOMAIN,
          stringLine(harness.proof.actionTokenSha256),
          stringLine(boundaryAttestationSha256(boundaryAttestationClaims(attestation))),
          stringLine(attestation.keyId),
          stringLine(attestation.signatureBase64),
          stringLine(egressAuthorizationLeaseSha256(egressAuthorizationLeaseClaims(lease))),
          stringLine(lease.keyId),
          stringLine(lease.signatureBase64),
          stringLine(egressReceiptSha256(egressReceiptClaims(receipt))),
          stringLine(receipt.keyId),
          stringLine(receipt.signatureBase64),
        ].join('\n'),
        'utf8',
      )
      .digest('hex');

    expect(egressEvidenceSha256(harness.proof)).toBe(expected);
    expect(verifyEgressReceiptProof(harness.proof, harness.options).egressEvidenceSha256).toBe(
      expected,
    );

    const originalSignature = receipt.signatureBase64;
    const changedSignature = Buffer.from(originalSignature, 'base64');
    changedSignature[0] ^= 1;
    receipt.signatureBase64 = changedSignature.toString('base64');
    expect(egressEvidenceSha256(harness.proof)).not.toBe(expected);
    receipt.signatureBase64 = originalSignature;
  });

  it('rejects paired-device self-attestation and a mismatched supervisor enrollment pin', () => {
    const harness = createHarness();
    const pairedDeviceKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    harness.proof.authorization.attestation.signatureBase64 = signP1363(
      canonicalBoundaryAttestationBytes(
        boundaryAttestationClaims(harness.proof.authorization.attestation),
      ),
      pairedDeviceKeys.privateKey,
    );
    expectThrowCode(
      () => verifyEgressReceiptProof(harness.proof, harness.options),
      'EGRESS_BOUNDARY_ATTESTATION_SIGNATURE_INVALID',
    );

    const missingSupervisor = createHarness();
    expectThrowCode(
      () =>
        verifyEgressReceiptProof(missingSupervisor.proof, {
          ...missingSupervisor.options,
          enrolledBoundarySupervisor: undefined,
          pairedDevice: {
            deviceId,
            keyId: 'ordinary-paired-device-key',
            publicKey: pairedDeviceKeys.publicKey,
          },
        } as unknown as EgressReceiptVerificationOptions),
      'EGRESS_TRUST_POLICY_INCOMPLETE',
    );

    const wrongPin = createHarness();
    expectThrowCode(
      () =>
        verifyEgressReceiptProof(wrongPin.proof, {
          ...wrongPin.options,
          enrolledBoundarySupervisor: {
            ...wrongPin.options.enrolledBoundarySupervisor,
            publicKeySpkiSha256: 'f'.repeat(64),
          },
        }),
      'EGRESS_BOUNDARY_SUPERVISOR_KEY_NOT_ENROLLED',
    );
  });

  it('requires Secure Boot, HVCI, driver, and service integrity gates to all be active', () => {
    for (const field of [
      'secureBootEnabled',
      'hvciEnabled',
      'driverActive',
      'serviceActive',
    ] as const) {
      const harness = createHarness();
      harness.proof.authorization.attestation[field] = false;
      signAttestation(harness);
      expectThrowCode(
        () => verifyEgressReceiptProof(harness.proof, harness.options),
        'EGRESS_BOUNDARY_HOST_INTEGRITY_INVALID',
      );
    }
  });

  it('strictly adapts the nested C# wire envelopes and rejects wrapper extras', () => {
    const harness = createHarness();
    const { attestation, lease } = harness.proof.authorization;
    const { receipt } = harness.proof;
    const wire = {
      authorization: {
        attestation: {
          attestation: boundaryAttestationClaims(attestation),
          keyId: attestation.keyId,
          signatureBase64: attestation.signatureBase64,
        },
        lease: {
          lease: egressAuthorizationLeaseClaims(lease),
          keyId: lease.keyId,
          signatureBase64: lease.signatureBase64,
        },
      },
      receipt: {
        receipt: egressReceiptClaims(receipt),
        keyId: receipt.keyId,
        signatureBase64: receipt.signatureBase64,
      },
    };

    expect(parseWireEgressReceiptProof(harness.proof.actionTokenSha256, wire)).toEqual(
      harness.proof,
    );
    expect(() =>
      parseWireEgressReceiptProof(harness.proof.actionTokenSha256, {
        ...wire,
        extra: true,
      }),
    ).toThrow('EGRESS_WIRE_EVIDENCE_SCHEMA_INVALID');
    expect(() =>
      parseWireEgressReceiptProof(harness.proof.actionTokenSha256, {
        ...wire,
        receipt: { ...wire.receipt, extra: true },
      }),
    ).toThrow('EGRESS_WIRE_RECEIPT_ENVELOPE_INVALID');
  });

  it('rejects a tampered attestation, lease, or receipt signature', () => {
    for (const target of ['attestation', 'lease', 'receipt'] as const) {
      const harness = createHarness();
      const signed =
        target === 'attestation'
          ? harness.proof.authorization.attestation
          : target === 'lease'
            ? harness.proof.authorization.lease
            : harness.proof.receipt;
      const signature = Buffer.from(signed.signatureBase64, 'base64');
      signature[0] ^= 1;
      signed.signatureBase64 = signature.toString('base64');
      expect(() => verifyEgressReceiptProof(harness.proof, harness.options)).toThrow(
        EgressReceiptVerificationError,
      );
    }
  });

  it('rejects a validly signed receipt whose redundant action binding changed', () => {
    const harness = createHarness();
    harness.proof.receipt.actionId = 'c0000000-0000-4000-8000-00000000000c';
    signReceipt(harness);
    expectThrowCode(
      () => verifyEgressReceiptProof(harness.proof, harness.options),
      'EGRESS_ACTION_BINDING_MISMATCH',
    );
  });

  it('checks canonical attestation/lease digests rather than trusting supplied links', () => {
    const harness = createHarness();
    harness.proof.receipt.leaseSha256 = 'f'.repeat(64);
    signReceipt(harness);
    expectThrowCode(
      () => verifyEgressReceiptProof(harness.proof, harness.options),
      'EGRESS_LEASE_DIGEST_BINDING_MISMATCH',
    );
  });

  it('rejects expired authority, future receipts, and excessive lease lifetimes', () => {
    const expired = createHarness();
    expired.options.nowUnixMilliseconds =
      expired.proof.authorization.attestation.expiresAtUnixMilliseconds + 1;
    expectThrowCode(
      () => verifyEgressReceiptProof(expired.proof, expired.options),
      'EGRESS_BOUNDARY_ATTESTATION_TIME_INVALID',
    );

    const future = createHarness();
    future.proof.receipt.endedAtUnixMilliseconds = NOW + 1;
    signReceipt(future);
    expectThrowCode(
      () => verifyEgressReceiptProof(future.proof, future.options),
      'EGRESS_RECEIPT_TIME_INVALID',
    );

    const excessiveLease = createHarness();
    excessiveLease.options.maxLeaseLifetimeMilliseconds = 1;
    expectThrowCode(
      () => verifyEgressReceiptProof(excessiveLease.proof, excessiveLease.options),
      'EGRESS_AUTHORIZATION_LEASE_TIME_INVALID',
    );
  });

  it('accepts a cached terminal receipt older than five minutes only in explicit historical mode', () => {
    const cached = createHarness();
    cached.options.nowUnixMilliseconds =
      cached.proof.authorization.attestation.expiresAtUnixMilliseconds + 300_001;

    expect(
      cached.options.nowUnixMilliseconds - cached.proof.receipt.endedAtUnixMilliseconds,
    ).toBeGreaterThan(300_000);
    expect(cached.proof.authorization.attestation.expiresAtUnixMilliseconds).toBeLessThan(
      cached.options.nowUnixMilliseconds,
    );
    expect(cached.proof.authorization.lease.expiresAtUnixMilliseconds).toBeLessThan(
      cached.options.nowUnixMilliseconds,
    );
    expectThrowCode(
      () => verifyEgressReceiptProof(cached.proof, cached.options),
      'EGRESS_BOUNDARY_ATTESTATION_TIME_INVALID',
    );

    expect(
      verifyEgressReceiptProof(cached.proof, {
        ...cached.options,
        timeValidationMode: 'HISTORICAL_TERMINAL_RECEIPT',
      }),
    ).toMatchObject({ chargedExternalEgressBytes: 1_500 });
  });

  it('never accepts future issued or receipt times in historical mode, even within clock skew', () => {
    const futureAttestation = createHarness();
    futureAttestation.options.maxClockSkewMilliseconds = 60_000;
    futureAttestation.options.nowUnixMilliseconds =
      futureAttestation.proof.authorization.attestation.issuedAtUnixMilliseconds - 1;
    expectThrowCode(
      () =>
        verifyEgressReceiptProof(futureAttestation.proof, {
          ...futureAttestation.options,
          timeValidationMode: 'HISTORICAL_TERMINAL_RECEIPT',
        }),
      'EGRESS_BOUNDARY_ATTESTATION_TIME_INVALID',
    );

    const futureLease = createHarness();
    futureLease.options.maxClockSkewMilliseconds = 60_000;
    futureLease.options.nowUnixMilliseconds =
      futureLease.proof.authorization.lease.issuedAtUnixMilliseconds - 1;
    expectThrowCode(
      () =>
        verifyEgressReceiptProof(futureLease.proof, {
          ...futureLease.options,
          timeValidationMode: 'HISTORICAL_TERMINAL_RECEIPT',
        }),
      'EGRESS_AUTHORIZATION_LEASE_TIME_INVALID',
    );

    const futureReceipt = createHarness();
    futureReceipt.options.maxClockSkewMilliseconds = 60_000;
    futureReceipt.options.nowUnixMilliseconds =
      futureReceipt.proof.receipt.endedAtUnixMilliseconds - 1;
    expectThrowCode(
      () =>
        verifyEgressReceiptProof(futureReceipt.proof, {
          ...futureReceipt.options,
          timeValidationMode: 'HISTORICAL_TERMINAL_RECEIPT',
        }),
      'EGRESS_RECEIPT_TIME_INVALID',
    );
  });

  it('requires historical receipt execution to remain exactly inside the signed lease window', () => {
    const startedBeforeLease = createHarness();
    startedBeforeLease.options.maxClockSkewMilliseconds = 60_000;
    startedBeforeLease.options.nowUnixMilliseconds =
      startedBeforeLease.proof.authorization.attestation.expiresAtUnixMilliseconds + 1;
    startedBeforeLease.proof.receipt.startedAtUnixMilliseconds =
      startedBeforeLease.proof.authorization.lease.issuedAtUnixMilliseconds - 1;
    signReceipt(startedBeforeLease);
    expectThrowCode(
      () =>
        verifyEgressReceiptProof(startedBeforeLease.proof, {
          ...startedBeforeLease.options,
          timeValidationMode: 'HISTORICAL_TERMINAL_RECEIPT',
        }),
      'EGRESS_RECEIPT_TIME_INVALID',
    );

    const endedAfterLease = createHarness();
    endedAfterLease.options.maxClockSkewMilliseconds = 60_000;
    endedAfterLease.options.nowUnixMilliseconds =
      endedAfterLease.proof.authorization.attestation.expiresAtUnixMilliseconds + 1;
    endedAfterLease.proof.receipt.endedAtUnixMilliseconds =
      endedAfterLease.proof.authorization.lease.expiresAtUnixMilliseconds + 1;
    signReceipt(endedAfterLease);
    expectThrowCode(
      () =>
        verifyEgressReceiptProof(endedAfterLease.proof, {
          ...endedAfterLease.options,
          timeValidationMode: 'HISTORICAL_TERMINAL_RECEIPT',
        }),
      'EGRESS_RECEIPT_TIME_INVALID',
    );
  });

  it('retains maximum lifetimes and authority containment in historical mode', () => {
    const excessiveAttestation = createHarness();
    excessiveAttestation.options.nowUnixMilliseconds =
      excessiveAttestation.proof.authorization.attestation.expiresAtUnixMilliseconds + 1;
    expectThrowCode(
      () =>
        verifyEgressReceiptProof(excessiveAttestation.proof, {
          ...excessiveAttestation.options,
          maxAttestationLifetimeMilliseconds: 1,
          timeValidationMode: 'HISTORICAL_TERMINAL_RECEIPT',
        }),
      'EGRESS_BOUNDARY_ATTESTATION_TIME_INVALID',
    );

    const excessiveLease = createHarness();
    excessiveLease.options.nowUnixMilliseconds =
      excessiveLease.proof.authorization.attestation.expiresAtUnixMilliseconds + 1;
    expectThrowCode(
      () =>
        verifyEgressReceiptProof(excessiveLease.proof, {
          ...excessiveLease.options,
          maxLeaseLifetimeMilliseconds: 1,
          timeValidationMode: 'HISTORICAL_TERMINAL_RECEIPT',
        }),
      'EGRESS_AUTHORIZATION_LEASE_TIME_INVALID',
    );

    const escapedLease = createHarness();
    escapedLease.proof.authorization.attestation.expiresAtUnixMilliseconds =
      escapedLease.proof.authorization.lease.expiresAtUnixMilliseconds - 1;
    signAuthorizationChain(escapedLease);
    escapedLease.options.nowUnixMilliseconds =
      escapedLease.proof.authorization.lease.expiresAtUnixMilliseconds + 1;
    expectThrowCode(
      () =>
        verifyEgressReceiptProof(escapedLease.proof, {
          ...escapedLease.options,
          timeValidationMode: 'HISTORICAL_TERMINAL_RECEIPT',
        }),
      'EGRESS_AUTHORIZATION_LEASE_TIME_INVALID',
    );
  });

  it('rejects receipt/lease replay and a non-increasing sequence in one boot epoch', () => {
    const receiptReplay = createHarness();
    receiptReplay.options.replay = {
      acceptedReceiptIds: new Set([receiptReplay.proof.receipt.receiptId]),
    };
    expectThrowCode(
      () => verifyEgressReceiptProof(receiptReplay.proof, receiptReplay.options),
      'EGRESS_RECEIPT_REPLAYED',
    );

    const sequenceReplay = createHarness();
    sequenceReplay.options.replay = {
      lastAcceptedBootId: sequenceReplay.proof.authorization.attestation.bootId,
      lastAcceptedReceiptSequence: sequenceReplay.proof.receipt.sequence,
    };
    expectThrowCode(
      () => verifyEgressReceiptProof(sequenceReplay.proof, sequenceReplay.options),
      'EGRESS_RECEIPT_SEQUENCE_REPLAYED',
    );
  });

  it('requires browser proofs in browser mode and rejects them in non-browser mode', () => {
    const harness = createHarness(true);
    expectThrowCode(
      () => verifyEgressReceiptProof(harness.proof, harness.options),
      'EGRESS_BROWSER_BOUNDARY_DISABLED',
    );
    expect(
      verifyEgressReceiptProof(harness.proof, {
        ...harness.options,
        requireBrowserAttestation: true,
      }),
    ).toMatchObject({ chargedExternalEgressBytes: 1_500 });

    const omitted = createHarness(false);
    expectThrowCode(
      () =>
        verifyEgressReceiptProof(omitted.proof, {
          ...omitted.options,
          requireBrowserAttestation: true,
        }),
      'EGRESS_BROWSER_ATTESTATION_REQUIRED',
    );
  });

  it('rejects a non-P-256 enrolled boundary-supervisor key', () => {
    const harness = createHarness();
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
    expectThrowCode(
      () =>
        verifyEgressReceiptProof(harness.proof, {
          ...harness.options,
          enrolledBoundarySupervisor: {
            ...harness.options.enrolledBoundarySupervisor,
            publicKey: rsa,
          },
        }),
      'EGRESS_PUBLIC_KEY_INVALID',
    );
  });
});

function createHarness(browser = false): Harness {
  const supervisorKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const receiptKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const receiptSpki = receiptKeys.publicKey.export({ type: 'spki', format: 'der' });
  const receiptPublicKeySpkiBase64 = receiptSpki.toString('base64');
  const receiptPublicKeySha256 = createHash('sha256').update(receiptSpki).digest('hex');
  const attestationClaims: BoundaryAttestationClaims = {
    contractVersion: 4,
    attestationId,
    deviceId,
    supervisorInstanceId,
    bootId,
    issuedAtUnixMilliseconds: NOW - 60_000,
    expiresAtUnixMilliseconds: NOW + 3_600_000,
    secureBootEnabled: true,
    hvciEnabled: true,
    driverActive: true,
    serviceActive: true,
    driverMeasurementSha256: 'a'.repeat(64),
    serviceMeasurementSha256: 'b'.repeat(64),
    browserBrokerBuildSha256: browser ? 'c'.repeat(64) : null,
    receiptKeyId: 'boundary-receipt-key-1',
    receiptPublicKeySpkiBase64,
    receiptPublicKeySha256,
    features: browser
      ? [
          'browser-completion-attested',
          'browser-origin-attested',
          'network-egress-enforced',
          'process-tree-attributed',
          'signed-egress-receipts',
        ]
      : ['network-egress-enforced', 'process-tree-attributed', 'signed-egress-receipts'],
  };
  const attestation: SignedBoundaryAttestation = {
    ...attestationClaims,
    keyId: 'boundary-supervisor-key-1',
    signatureBase64: signP1363(
      canonicalBoundaryAttestationBytes(attestationClaims),
      supervisorKeys.privateKey,
    ),
  };
  const attestationDigest = boundaryAttestationSha256(attestationClaims);
  const leaseClaims: EgressAuthorizationLeaseClaims = {
    contractVersion: 4,
    leaseId,
    attestationSha256: attestationDigest,
    actionTokenSha256: 'd'.repeat(64),
    actionId,
    taskId,
    planVersionId,
    stepId,
    deviceId,
    mandateId,
    capabilityId: 'system.status.read',
    capabilityVersion: '1.0.0',
    dispatchCount: 1,
    destinationPolicySha256: 'e'.repeat(64),
    executionIdentitySha256: 'f'.repeat(64),
    argumentsSha256: '6'.repeat(64),
    expectedPreStateSha256: '7'.repeat(64),
    idempotencyKeySha256: '8'.repeat(64),
    destinationScopeSha256: '9'.repeat(64),
    requestBodySha256: 'a'.repeat(64),
    exactRequestPolicySha256: 'b'.repeat(64),
    reservationDnsAnswerSetSha256: 'c'.repeat(64),
    reservedCapabilityEgressBytes: 10_000,
    issuedAtUnixMilliseconds: NOW - 30_000,
    expiresAtUnixMilliseconds: NOW + 300_000,
  };
  const lease: SignedEgressAuthorizationLease = {
    ...leaseClaims,
    keyId: attestation.receiptKeyId,
    signatureBase64: signP1363(
      canonicalEgressAuthorizationLeaseBytes(leaseClaims),
      receiptKeys.privateKey,
    ),
  };
  const receiptClaims: EgressReceiptClaims = {
    contractVersion: 4,
    receiptId,
    leaseSha256: egressAuthorizationLeaseSha256(leaseClaims),
    attestationSha256: attestationDigest,
    actionTokenSha256: lease.actionTokenSha256,
    actionId,
    taskId,
    planVersionId,
    stepId,
    deviceId,
    mandateId,
    capabilityId: lease.capabilityId,
    capabilityVersion: lease.capabilityVersion,
    dispatchCount: lease.dispatchCount,
    destinationPolicySha256: lease.destinationPolicySha256,
    executionIdentitySha256: lease.executionIdentitySha256,
    argumentsSha256: lease.argumentsSha256,
    expectedPreStateSha256: lease.expectedPreStateSha256,
    idempotencyKeySha256: lease.idempotencyKeySha256,
    destinationScopeSha256: lease.destinationScopeSha256,
    requestBodySha256: lease.requestBodySha256,
    exactRequestPolicySha256: lease.exactRequestPolicySha256,
    reservationDnsAnswerSetSha256: lease.reservationDnsAnswerSetSha256,
    connectionDnsAnswerSetSha256: lease.reservationDnsAnswerSetSha256,
    selectedAddressSha256: '4'.repeat(64),
    registrationSha256: '2'.repeat(64),
    dispositionSha256: '3'.repeat(64),
    reservedCapabilityEgressBytes: lease.reservedCapabilityEgressBytes,
    measuredExternalEgressBytes: 1_200,
    uncertainExternalEgressBytes: 300,
    chargedExternalEgressBytes: 1_500,
    startedAtUnixMilliseconds: NOW - 20_000,
    endedAtUnixMilliseconds: NOW - 10_000,
    sequence: 7,
    flowLogSha256: '1'.repeat(64),
    outcome: 'completed',
  };
  const receipt: SignedEgressReceipt = {
    ...receiptClaims,
    keyId: attestation.receiptKeyId,
    signatureBase64: signP1363(canonicalEgressReceiptBytes(receiptClaims), receiptKeys.privateKey),
  };
  const proof: EgressReceiptProof = {
    actionTokenSha256: lease.actionTokenSha256,
    authorization: { attestation, lease },
    receipt,
  };
  const options: EgressReceiptVerificationOptions = {
    enrolledBoundarySupervisor: {
      deviceId,
      keyId: attestation.keyId,
      publicKey: supervisorKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      publicKeySpkiSha256: egressPublicKeySpkiSha256(supervisorKeys.publicKey),
    },
    expected: {
      actionTokenSha256: lease.actionTokenSha256,
      actionId,
      taskId,
      planVersionId,
      stepId,
      deviceId,
      mandateId,
      capabilityId: lease.capabilityId,
      capabilityVersion: lease.capabilityVersion,
      dispatchCount: lease.dispatchCount,
      destinationPolicySha256: lease.destinationPolicySha256,
      executionIdentitySha256: lease.executionIdentitySha256,
      argumentsSha256: lease.argumentsSha256,
      expectedPreStateSha256: lease.expectedPreStateSha256,
      idempotencyKeySha256: lease.idempotencyKeySha256,
      reservedCapabilityEgressBytes: lease.reservedCapabilityEgressBytes,
    },
    nowUnixMilliseconds: NOW,
    maxClockSkewMilliseconds: 0,
    maxAttestationLifetimeMilliseconds: 7_200_000,
    maxLeaseLifetimeMilliseconds: 600_000,
    requireBrowserAttestation: false,
  };
  expect(egressPublicKeySpkiSha256(receiptKeys.publicKey)).toBe(receiptPublicKeySha256);
  return {
    proof,
    options,
    supervisorPrivateKey: supervisorKeys.privateKey,
    receiptPrivateKey: receiptKeys.privateKey,
  };
}

function signReceipt(harness: Harness): void {
  const claims = egressReceiptClaims(harness.proof.receipt);
  harness.proof.receipt.signatureBase64 = signP1363(
    canonicalEgressReceiptBytes(claims),
    harness.receiptPrivateKey,
  );
}

function signAuthorizationChain(harness: Harness): void {
  signAttestation(harness);
  const attestationDigest = boundaryAttestationSha256(
    boundaryAttestationClaims(harness.proof.authorization.attestation),
  );
  harness.proof.authorization.lease.attestationSha256 = attestationDigest;
  const leaseClaims = egressAuthorizationLeaseClaims(harness.proof.authorization.lease);
  harness.proof.authorization.lease.signatureBase64 = signP1363(
    canonicalEgressAuthorizationLeaseBytes(leaseClaims),
    harness.receiptPrivateKey,
  );
  harness.proof.receipt.attestationSha256 = attestationDigest;
  harness.proof.receipt.leaseSha256 = egressAuthorizationLeaseSha256(leaseClaims);
  signReceipt(harness);
}

function signAttestation(harness: Harness): void {
  const claims = boundaryAttestationClaims(harness.proof.authorization.attestation);
  harness.proof.authorization.attestation.signatureBase64 = signP1363(
    canonicalBoundaryAttestationBytes(claims),
    harness.supervisorPrivateKey,
  );
}

function signP1363(payload: Buffer, privateKey: KeyObject): string {
  return sign('sha256', payload, { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
}

function expectThrowCode(received: () => unknown, expectedCode: string): void {
  try {
    received();
  } catch (error) {
    expect(error).toBeInstanceOf(EgressReceiptVerificationError);
    expect((error as EgressReceiptVerificationError).code).toBe(expectedCode);
    return;
  }
  throw new Error(`expected function to throw ${expectedCode}`);
}
