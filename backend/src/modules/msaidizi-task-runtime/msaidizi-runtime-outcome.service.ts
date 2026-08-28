import { Injectable } from '@nestjs/common';
import { MsaidiziTaskStatus } from '@prisma/client';
import { RuntimeReasoningDecision } from './msaidizi-runtime-reasoning.protocol';

export interface RuntimeOutcomeEvaluation {
  action: 'CONTINUE' | 'STOP' | 'REPLAN';
  terminalStatus: MsaidiziTaskStatus | null;
  reasonCode: string;
}

/** Deterministic mapping from a critic-approved model decision to task state. */
@Injectable()
export class MsaidiziRuntimeOutcomeEvaluator {
  evaluate(decision: RuntimeReasoningDecision): RuntimeOutcomeEvaluation {
    if (decision.decision === 'CONTINUE') {
      return { action: 'CONTINUE', terminalStatus: null, reasonCode: decision.reasonCode };
    }
    if (decision.decision === 'REPLAN') {
      return { action: 'REPLAN', terminalStatus: null, reasonCode: decision.reasonCode };
    }
    const terminalStatus =
      decision.outcome === 'COMPLETE'
        ? MsaidiziTaskStatus.COMPLETED
        : decision.outcome === 'PARTIAL'
          ? MsaidiziTaskStatus.PARTIAL
          : decision.outcome === 'FAILED'
            ? MsaidiziTaskStatus.FAILED
            : decision.outcome === 'NEEDS_ATTENTION'
              ? MsaidiziTaskStatus.NEEDS_ATTENTION
              : null;
    if (!terminalStatus) throw new Error('Critic allowed a non-terminal STOP outcome');
    return { action: 'STOP', terminalStatus, reasonCode: decision.reasonCode };
  }
}
