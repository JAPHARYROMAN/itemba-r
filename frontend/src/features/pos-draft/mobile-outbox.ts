import type { LocalCapture } from './capture-store';
import type { Draft, DraftOutcome, Submission } from './types';
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
