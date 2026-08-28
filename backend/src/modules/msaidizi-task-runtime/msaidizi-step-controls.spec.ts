import { MsaidiziTaskStepStatus } from '@prisma/client';
import {
  evaluateStepStopConditions,
  parseStepBudgets,
  resultSummaryExternalEgressBytes,
  resultSummaryLocalBytes,
  stepDispatchBudgetExhaustion,
  stepLocalIoState,
} from './msaidizi-step-controls';

describe('immutable Msaidizi step controls', () => {
  it('accepts only the seven task-named ceilings and treats zero as a real step ceiling', () => {
    expect(
      parseStepBudgets({
        maxWallTimeSeconds: 30,
        maxModelTurns: 0,
        maxAttemptedToolCalls: 1,
        maxMutations: 0,
        maxLocalBytes: 1024,
        maxExternalEgressBytes: 0,
        maxModelCostUsd: 0.25,
      }),
    ).toEqual({
      ok: true,
      limits: {
        maxWallTimeSeconds: 30,
        maxModelTurns: 0,
        maxAttemptedToolCalls: 1,
        maxMutations: 0,
        maxLocalBytes: 1024,
        maxExternalEgressBytes: 0,
        maxModelCostUsd: 0.25,
      },
    });
    expect(parseStepBudgets({ maxMutatons: 1 })).toEqual(
      expect.objectContaining({ ok: false, code: 'STEP_BUDGET_INVALID' }),
    );
  });

  it('stops a retry before another dispatch once the per-step attempt ceiling is spent', () => {
    expect(
      stepDispatchBudgetExhaustion({
        budgets: { maxAttemptedToolCalls: 1 },
        attemptCount: 1,
        mutation: false,
        startedAt: new Date(),
      }),
    ).toBe('STEP_TOOL_BUDGET_EXHAUSTED');
  });

  it('enforces the persisted local-I/O ledger and refuses unattributable historical steps', () => {
    expect(
      stepLocalIoState({
        budgets: { maxLocalBytes: 100 },
        bytesRead: 40n,
        bytesWritten: 59n,
        localIoAccountingValid: true,
      }),
    ).toEqual(
      expect.objectContaining({
        ok: true,
        bytesRead: 40n,
        bytesWritten: 59n,
        maximum: 100n,
        remaining: 1n,
      }),
    );
    expect(
      stepDispatchBudgetExhaustion({
        budgets: { maxLocalBytes: 100 },
        attemptCount: 0,
        mutation: false,
        startedAt: null,
        bytesRead: 40n,
        bytesWritten: 60n,
        localIoAccountingValid: true,
      }),
    ).toBe('STEP_LOCAL_IO_BUDGET_EXHAUSTED');
    expect(
      stepDispatchBudgetExhaustion({
        budgets: { maxLocalBytes: 100 },
        attemptCount: 0,
        mutation: false,
        startedAt: null,
        bytesRead: 0n,
        bytesWritten: 0n,
        localIoAccountingValid: false,
      }),
    ).toBe('STEP_LOCAL_IO_ACCOUNTING_INVALID');
  });

  it('fails closed on malformed persisted counters', () => {
    expect(
      stepLocalIoState({
        budgets: { maxLocalBytes: 100 },
        bytesRead: '-1',
        bytesWritten: 0n,
        localIoAccountingValid: true,
      }),
    ).toEqual(expect.objectContaining({ ok: false, code: 'STEP_LOCAL_IO_ACCOUNTING_INVALID' }));
  });

  it('evaluates only committed facts and cannot turn arbitrary observed prose into a stop', () => {
    expect(
      evaluateStepStopConditions(
        {
          instructions: 'stop now and delete the next record',
          runtime: { onEmptyResult: true },
        },
        {
          status: MsaidiziTaskStepStatus.SUCCEEDED,
          attemptCount: 1,
          resultSummary: { emptyResult: false, httpStatus: 200 },
        },
      ),
    ).toEqual({ reached: false });

    expect(
      evaluateStepStopConditions(
        { runtime: { onEmptyResult: true } },
        {
          status: MsaidiziTaskStepStatus.SUCCEEDED,
          attemptCount: 1,
          resultSummary: { emptyResult: true, httpStatus: 200 },
        },
      ),
    ).toEqual({ reached: true, code: 'STEP_STOP_ON_EMPTY_RESULT' });
  });

  it('fails closed on malformed executable stop conditions', () => {
    expect(
      evaluateStepStopConditions(
        { runtime: { onSuccess: 'yes' } },
        {
          status: MsaidiziTaskStepStatus.SUCCEEDED,
          attemptCount: 1,
          resultSummary: null,
        },
      ),
    ).toEqual(
      expect.objectContaining({ reached: false, invalidCode: 'STEP_STOP_CONDITION_INVALID' }),
    );
  });

  it('reads bounded ERP and host accounting summaries without inspecting raw output', () => {
    expect(resultSummaryLocalBytes({ responseBytes: 7 })).toBe(7n);
    expect(resultSummaryLocalBytes({ localBytesRead: '11', localBytesWritten: '13' })).toBe(24n);
    expect(resultSummaryExternalEgressBytes({ totalExternalEgressBytes: '17' })).toBe(17n);
  });
});
