import { isEarlierCapture, type LocalCapture } from './capture-store';
import { submissionEnvelope, type Draft, type DraftOutcome, type Submission } from './types';
export class SessionChangedError extends Error {
  constructor() {
    super('The signed-in operator changed. Open the request in the current workspace.');
  }
}
export async function reconcileCapture(
  capture: LocalCapture,
  transport: {
    outcome: (requestId: string) => Promise<DraftOutcome>;
    submit: (body: Submission) => Promise<Draft>;
  },
  save: (value: LocalCapture) => Promise<void>,
  isCurrent: () => boolean = () => true,
): Promise<Draft> {
  const guard = () => {
    if (!isCurrent()) throw new SessionChangedError();
  };
  guard();
  if (capture.state === 'SUBMITTED' && capture.draft) return capture.draft;
  try {
    // A missing response never proves a failed write. Observe the frozen identity first.
    const outcome = await transport.outcome(capture.requestId);
    guard();
    if (outcome.state !== 'not_found') {
      if (!outcome.draft)
        throw new Error('The server recorded this request. Refresh its status before continuing.');
      await save({ ...capture, state: 'SUBMITTED', draft: outcome.draft, error: undefined });
      return outcome.draft;
    }
    const draft = await transport.submit(capture.submission);
    guard();
    await save({ ...capture, state: 'SUBMITTED', draft, error: undefined });
    return draft;
  } catch (error) {
    if (error instanceof SessionChangedError || !isCurrent()) throw error;
    await save({
      ...capture,
      state: 'ATTENTION',
      error: error instanceof Error ? error.message : 'Could not check this request.',
    });
    throw error;
  }
}
export async function recoverHeldCapture(
  capture: LocalCapture,
  currentPartition: string,
  currentScope: { companyId: string; branchId: string },
  transport: Parameters<typeof reconcileCapture>[1],
  store: {
    readCurrent: () => Promise<LocalCapture[]>;
    save: (value: LocalCapture) => Promise<void>;
  },
  isCurrent: () => boolean,
) {
  if (!isCurrent()) throw new SessionChangedError();
  if (!isEarlierCapture(capture, currentPartition))
    throw new Error('This held capture does not belong to this approved operator and device.');
  if (
    capture.submission.companyId !== currentScope.companyId ||
    capture.submission.branchId !== currentScope.branchId
  )
    throw new Error(
      'This capture belongs to an earlier branch. Ask an administrator to reconcile it.',
    );
  const current = (await store.readCurrent()).find((row) => row.requestId === capture.requestId);
  if (!isCurrent()) throw new SessionChangedError();
  if (current?.state === 'SUBMITTED') {
    if (current.draft) return current.draft;
    throw new Error('This request was already acknowledged. Review its server status in Requests.');
  }
  if (
    current &&
    JSON.stringify(submissionEnvelope(current.submission)) !==
      JSON.stringify(submissionEnvelope(capture.submission))
  )
    throw new Error(
      'This request already has different saved details. Ask an administrator to reconcile it.',
    );
  const recovered = current ?? {
    ...capture,
    key: `${currentPartition}:${capture.requestId}`,
    partition: currentPartition,
  };
  // Store only the recovered copy; the earlier capture remains intact for reconciliation.
  return reconcileCapture(recovered, transport, store.save, isCurrent);
}
