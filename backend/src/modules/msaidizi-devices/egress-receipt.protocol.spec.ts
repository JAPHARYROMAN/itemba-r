import 'reflect-metadata';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ActionResultDto } from './dto/msaidizi-device.dto';
import {
  BOUNDARY_ATTESTATION_DOMAIN,
  boundaryAttestationSha256,
  BoundaryAttestationClaims,
  canonicalBoundaryAttestationBytes,
  canonicalEgressReceiptBytes,
  EgressReceiptClaims,
  EgressReceiptProtocolError,
  parseSignedBoundaryAttestation,
  parseSignedEgressReceipt,
  parseWireEgressReceiptProof,
} from './egress-receipt.protocol';

const attestationId = '10000000-0000-4000-8000-000000000001';
const deviceId = '20000000-0000-4000-8000-000000000002';
const supervisorInstanceId = '30000000-0000-4000-8000-000000000003';
const bootId = '40000000-0000-4000-8000-000000000004';
const receiptId = '50000000-0000-4000-8000-000000000005';
const actionId = '60000000-0000-4000-8000-000000000006';
const taskId = '70000000-0000-4000-8000-000000000007';
const planVersionId = '80000000-0000-4000-8000-000000000008';
const stepId = '90000000-0000-4000-8000-000000000009';
const mandateId = 'a0000000-0000-4000-8000-00000000000a';
const signatureBase64 = Buffer.alloc(64, 7).toString('base64');

describe('egress receipt v4 protocol', () => {
  const receiptKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey;
  const receiptPublicKeySpki = receiptKey.export({ type: 'spki', format: 'der' });
  const receiptPublicKeySpkiBase64 = receiptPublicKeySpki.toString('base64');
  const receiptPublicKeySha256 = createHash('sha256').update(receiptPublicKeySpki).digest('hex');

  function boundaryClaims(): BoundaryAttestationClaims {
    return {
      contractVersion: 4,
      attestationId,
      deviceId,
      supervisorInstanceId,
      bootId,
      issuedAtUnixMilliseconds: 1_800_000_000_000,
      expiresAtUnixMilliseconds: 1_800_003_600_000,
      secureBootEnabled: true,
      hvciEnabled: true,
      driverActive: true,
      serviceActive: true,
      driverMeasurementSha256: 'a'.repeat(64),
      serviceMeasurementSha256: 'b'.repeat(64),
      browserBrokerBuildSha256: null,
      receiptKeyId: 'boundary-receipt-key-1',
      receiptPublicKeySpkiBase64,
      receiptPublicKeySha256,
      features: ['network-egress-enforced', 'process-tree-attributed', 'signed-egress-receipts'],
    };
  }

  function receiptClaims(): EgressReceiptClaims {
    return {
      contractVersion: 4,
      receiptId,
      leaseSha256: '1'.repeat(64),
      attestationSha256: '2'.repeat(64),
      actionTokenSha256: '3'.repeat(64),
      actionId,
      taskId,
      planVersionId,
      stepId,
      deviceId,
      mandateId,
      capabilityId: 'system.status.read',
      capabilityVersion: '1.0.0',
      dispatchCount: 2,
      destinationPolicySha256: '4'.repeat(64),
      executionIdentitySha256: '5'.repeat(64),
      argumentsSha256: '9'.repeat(64),
      expectedPreStateSha256: null,
      idempotencyKeySha256: 'a'.repeat(64),
      destinationScopeSha256: 'b'.repeat(64),
      requestBodySha256: 'c'.repeat(64),
      exactRequestPolicySha256: 'd'.repeat(64),
      reservationDnsAnswerSetSha256: 'e'.repeat(64),
      connectionDnsAnswerSetSha256: 'e'.repeat(64),
      selectedAddressSha256: 'f'.repeat(64),
      registrationSha256: '7'.repeat(64),
      dispositionSha256: '8'.repeat(64),
      reservedCapabilityEgressBytes: 10_000,
      measuredExternalEgressBytes: 1_200,
      uncertainExternalEgressBytes: 300,
      chargedExternalEgressBytes: 1_500,
      startedAtUnixMilliseconds: 1_800_000_010_000,
      endedAtUnixMilliseconds: 1_800_000_020_000,
      sequence: 9,
      flowLogSha256: '6'.repeat(64),
      outcome: 'completed',
    };
  }

  it('accepts the actual C# non-browser ActionResult fixture', async () => {
    const fixture = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          '../../../../windows-companion/tests/fixtures/egress-non-browser-action-result.json',
        ),
        'utf8',
      ),
    );

    expect(await validate(plainToInstance(ActionResultDto, fixture))).toEqual([]);
    const proof = parseWireEgressReceiptProof(fixture.actionTokenSha256, fixture.egressEvidence);
    expect(proof.authorization.attestation.browserBrokerBuildSha256).toBeNull();
  });

  it('emits the exact fixed-order cross-language boundary frame', () => {
    const claims = boundaryClaims();
    const encoded = (value: string) => Buffer.from(value, 'utf8').toString('base64url');
    expect(canonicalBoundaryAttestationBytes(claims).toString('utf8')).toBe(
      [
        BOUNDARY_ATTESTATION_DOMAIN,
        '4',
        encoded(attestationId),
        encoded(deviceId),
        encoded(supervisorInstanceId),
        encoded(bootId),
        '1800000000000',
        '1800003600000',
        '1',
        '1',
        '1',
        '1',
        encoded('a'.repeat(64)),
        encoded('b'.repeat(64)),
        '',
        encoded('boundary-receipt-key-1'),
        encoded(receiptPublicKeySpkiBase64),
        encoded(receiptPublicKeySha256),
        encoded('network-egress-enforced'),
        encoded('process-tree-attributed'),
        encoded('signed-egress-receipts'),
      ].join('\n'),
    );
  });

  it('matches the fixed C# canonical attestation digest vector', () => {
    expect(
      boundaryAttestationSha256({
        contractVersion: 4,
        attestationId: '10000000-0000-4000-8000-000000000001',
        deviceId: '20000000-0000-4000-8000-000000000002',
        supervisorInstanceId: '30000000-0000-4000-8000-000000000003',
        bootId: '40000000-0000-4000-8000-000000000004',
        issuedAtUnixMilliseconds: 1_800_000_000_000,
        expiresAtUnixMilliseconds: 1_800_000_120_000,
        secureBootEnabled: true,
        hvciEnabled: true,
        driverActive: true,
        serviceActive: true,
        driverMeasurementSha256: '1'.repeat(64),
        serviceMeasurementSha256: '2'.repeat(64),
        browserBrokerBuildSha256: null,
        receiptKeyId: 'receipt-key-v1',
        receiptPublicKeySpkiBase64: 'AQID',
        receiptPublicKeySha256: '3'.repeat(64),
        features: ['network-egress-enforced', 'process-tree-attributed', 'signed-egress-receipts'],
      }),
    ).toBe('1841578b4b0ae916ad8f6db05e014a3be30546000858af43ebc0b41ccf4ec078');
  });

  it('accepts only exact canonical fields, features, UUIDs, hashes, and Base64 signatures', () => {
    const signed = {
      ...boundaryClaims(),
      keyId: 'boundary-supervisor-key-1',
      signatureBase64,
    };
    expect(parseSignedBoundaryAttestation(signed)).toEqual(signed);

    for (const invalid of [
      { ...signed, extra: true },
      { ...signed, attestationId: 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF' },
      { ...signed, driverMeasurementSha256: 'A'.repeat(64) },
      { ...signed, secureBootEnabled: 1 },
      { ...signed, signatureBase64: Buffer.alloc(64).toString('base64url') },
      {
        ...signed,
        features: ['process-tree-attributed', 'network-egress-enforced', 'signed-egress-receipts'],
      },
      {
        ...signed,
        features: ['network-egress-enforced', 'signed-egress-receipts'],
      },
    ]) {
      expect(() => parseSignedBoundaryAttestation(invalid)).toThrow(EgressReceiptProtocolError);
    }
  });

  it('requires exact charge arithmetic within the reservation and ordered Unix milliseconds', () => {
    const valid = {
      ...receiptClaims(),
      keyId: 'boundary-receipt-key-1',
      signatureBase64,
    };
    expect(parseSignedEgressReceipt(valid)).toEqual(valid);
    expect(canonicalEgressReceiptBytes(receiptClaims())).toBeInstanceOf(Buffer);
    expect(
      parseSignedEgressReceipt({
        ...valid,
        reservedCapabilityEgressBytes: 0,
        measuredExternalEgressBytes: 0,
        uncertainExternalEgressBytes: 0,
        chargedExternalEgressBytes: 0,
      }),
    ).toMatchObject({ reservedCapabilityEgressBytes: 0, chargedExternalEgressBytes: 0 });
    expect(
      parseSignedEgressReceipt({
        ...valid,
        uncertainExternalEgressBytes: 8_800,
        chargedExternalEgressBytes: 10_000,
        outcome: 'unknown',
      }),
    ).toMatchObject({ outcome: 'unknown', chargedExternalEgressBytes: 10_000 });

    for (const invalid of [
      { ...valid, chargedExternalEgressBytes: 1_499 },
      {
        ...valid,
        measuredExternalEgressBytes: 9_900,
        uncertainExternalEgressBytes: 101,
        chargedExternalEgressBytes: 10_001,
      },
      { ...valid, endedAtUnixMilliseconds: valid.startedAtUnixMilliseconds - 1 },
      { ...valid, sequence: 0 },
      { ...valid, measuredExternalEgressBytes: 0.5 },
      { ...valid, registrationSha256: 'A'.repeat(64) },
      { ...valid, dispositionSha256: undefined },
      { ...valid, outcome: { toString: () => 'completed' } },
      { ...valid, outcome: 'unknown' },
    ]) {
      expect(() => parseSignedEgressReceipt(invalid)).toThrow(EgressReceiptProtocolError);
    }
  });

  it('fails closed on legacy, missing, or mismatched route attestations', () => {
    const valid = {
      ...receiptClaims(),
      keyId: 'boundary-receipt-key-1',
      signatureBase64,
    };
    const { selectedAddressSha256: _selectedAddressSha256, ...missingSelected } = valid;

    expect(() => parseSignedEgressReceipt(missingSelected)).toThrow(EgressReceiptProtocolError);
    expect(() =>
      parseSignedEgressReceipt({
        ...valid,
        connectionDnsAnswerSetSha256: '1'.repeat(64),
      }),
    ).toThrow('EGRESS_DNS_ANSWER_SET_CONTAINMENT_INVALID');
    expect(() =>
      parseSignedEgressReceipt({
        ...valid,
        selectedAddressSha256: '0'.repeat(64),
      }),
    ).toThrow('EGRESS_ROUTE_ATTESTATION_MISSING');
  });

  it('allows absent connection evidence only as an unknown full-reservation charge', () => {
    const unknown = {
      ...receiptClaims(),
      measuredExternalEgressBytes: 0,
      uncertainExternalEgressBytes: 10_000,
      chargedExternalEgressBytes: 10_000,
      connectionDnsAnswerSetSha256: '0'.repeat(64),
      selectedAddressSha256: '0'.repeat(64),
      outcome: 'unknown' as const,
      keyId: 'boundary-receipt-key-1',
      signatureBase64,
    };

    expect(parseSignedEgressReceipt(unknown)).toMatchObject({
      outcome: 'unknown',
      chargedExternalEgressBytes: 10_000,
    });
    expect(() => parseSignedEgressReceipt({ ...unknown, outcome: 'failed' })).toThrow(
      'EGRESS_ROUTE_ATTESTATION_MISSING',
    );
  });

  it('requires browser origin/completion evidence and the broker build as one unit', () => {
    const base = boundaryClaims();
    const originOnly = {
      ...base,
      features: [...base.features, 'browser-origin-attested'].sort(),
      keyId: 'boundary-supervisor-key-1',
      signatureBase64,
    };
    expect(() => parseSignedBoundaryAttestation(originOnly)).toThrow(
      'EGRESS_BROWSER_ATTESTATION_INCOMPLETE',
    );

    const bothWithoutBuild = {
      ...base,
      features: ['browser-completion-attested', 'browser-origin-attested', ...base.features].sort(),
      keyId: 'boundary-supervisor-key-1',
      signatureBase64,
    };
    expect(() => parseSignedBoundaryAttestation(bothWithoutBuild)).toThrow(
      'EGRESS_BROWSER_ATTESTATION_INCONSISTENT',
    );
  });
});
