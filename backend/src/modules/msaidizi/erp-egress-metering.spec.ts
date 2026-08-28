import { actionArgumentDigest } from '../../common/utils/canonical-digest';
import {
  encodeErpEgressAdapterMeasurement,
  encodeErpEgressRequestContext,
  ErpEgressInvocationBinding,
  issueErpEgressMeteringReceipt,
  verifyErpEgressMeteringReceipt,
} from './erp-egress-metering';

describe('ERP egress metering receipt v1', () => {
  const binding: ErpEgressInvocationBinding = {
    taskId: 'task-1',
    planVersionId: 'plan-1',
    stepId: 'step-1',
    attemptId: 'attempt-1',
    capabilityId: 'ExternalController.send',
    capabilityVersion: '1',
    argumentsSha256: actionArgumentDigest({ body: { recipient: 'customer-1' } }),
    reservedExternalEgressBytes: 10_000,
  };
  const resultSha256 = 'a'.repeat(64);

  it('binds measured usage to the exact action and raw result deterministically', () => {
    const context = encodeErpEgressRequestContext(binding);
    const issued = issueErpEgressMeteringReceipt({
      binding,
      contextSha256: context.sha256,
      measurementHeader: encodeErpEgressAdapterMeasurement({
        kind: 'msaidizi-erp-egress-measurement/v1',
        contextSha256: context.sha256,
        measurementId: 'b'.repeat(64),
        destinationSha256: 'c'.repeat(64),
        outcome: 'completed',
        measuredExternalEgressBytes: 1_200,
        uncertainExternalEgressBytes: 300,
      }),
      httpStatus: 200,
      resultSha256,
    });

    expect(issued).toMatchObject({
      ok: true,
      receipt: {
        ...binding,
        chargedExternalEgressBytes: 1_500,
        resultSha256,
      },
    });
    if (!issued.ok) throw new Error('receipt was not issued');
    expect(
      verifyErpEgressMeteringReceipt(issued.receipt, {
        binding,
        httpStatus: 200,
        resultSha256,
      }),
    ).toEqual(issued);

    const replay = issueErpEgressMeteringReceipt({
      binding,
      contextSha256: context.sha256,
      measurementHeader: encodeErpEgressAdapterMeasurement({
        kind: 'msaidizi-erp-egress-measurement/v1',
        contextSha256: context.sha256,
        measurementId: 'b'.repeat(64),
        destinationSha256: 'c'.repeat(64),
        outcome: 'completed',
        measuredExternalEgressBytes: 1_200,
        uncertainExternalEgressBytes: 300,
      }),
      httpStatus: 200,
      resultSha256,
    });
    expect(replay).toEqual(issued);
  });

  it('rejects cross-attempt replay and result tampering', () => {
    const context = encodeErpEgressRequestContext(binding);
    const issued = issueErpEgressMeteringReceipt({
      binding,
      contextSha256: context.sha256,
      measurementHeader: encodeErpEgressAdapterMeasurement({
        kind: 'msaidizi-erp-egress-measurement/v1',
        contextSha256: context.sha256,
        measurementId: 'd'.repeat(64),
        destinationSha256: 'e'.repeat(64),
        outcome: 'completed',
        measuredExternalEgressBytes: 40,
        uncertainExternalEgressBytes: 0,
      }),
      httpStatus: 201,
      resultSha256,
    });
    if (!issued.ok) throw new Error('receipt was not issued');

    expect(
      verifyErpEgressMeteringReceipt(issued.receipt, {
        binding: { ...binding, attemptId: 'attempt-2' },
        httpStatus: 201,
        resultSha256,
      }),
    ).toEqual({ ok: false, code: 'ERP_EGRESS_RECEIPT_BINDING_MISMATCH' });
    expect(
      verifyErpEgressMeteringReceipt(issued.receipt, {
        binding,
        httpStatus: 201,
        resultSha256: 'f'.repeat(64),
      }),
    ).toEqual({ ok: false, code: 'ERP_EGRESS_RESULT_MISMATCH' });
  });

  it('full-charges an adapter-declared unknown outcome and rejects ambiguous evidence', () => {
    const context = encodeErpEgressRequestContext(binding);
    const unknown = issueErpEgressMeteringReceipt({
      binding,
      contextSha256: context.sha256,
      measurementHeader: encodeErpEgressAdapterMeasurement({
        kind: 'msaidizi-erp-egress-measurement/v1',
        contextSha256: context.sha256,
        measurementId: '1'.repeat(64),
        destinationSha256: '2'.repeat(64),
        outcome: 'unknown',
        measuredExternalEgressBytes: 1,
        uncertainExternalEgressBytes: 1,
      }),
      httpStatus: 503,
      resultSha256,
    });
    expect(unknown).toMatchObject({
      ok: true,
      receipt: { outcome: 'unknown', chargedExternalEgressBytes: 10_000 },
    });
    expect(
      issueErpEgressMeteringReceipt({
        binding,
        contextSha256: context.sha256,
        measurementHeader: encodeErpEgressAdapterMeasurement({
          kind: 'msaidizi-erp-egress-measurement/v1',
          contextSha256: context.sha256,
          measurementId: '3'.repeat(64),
          destinationSha256: '4'.repeat(64),
          outcome: 'unknown',
          measuredExternalEgressBytes: 10_001,
          uncertainExternalEgressBytes: 0,
        }),
        httpStatus: 503,
        resultSha256,
      }),
    ).toEqual({ ok: false, code: 'ERP_EGRESS_RECEIPT_OVER_RESERVATION' });

    expect(
      issueErpEgressMeteringReceipt({
        binding,
        contextSha256: context.sha256,
        measurementHeader: null,
        httpStatus: 200,
        resultSha256,
      }),
    ).toEqual({ ok: false, code: 'ERP_EGRESS_RECEIPT_MISSING' });
    expect(
      issueErpEgressMeteringReceipt({
        binding,
        contextSha256: context.sha256,
        measurementHeader: 'not+base64url',
        httpStatus: 200,
        resultSha256,
      }),
    ).toEqual({ ok: false, code: 'ERP_EGRESS_RECEIPT_MALFORMED' });
  });
});
