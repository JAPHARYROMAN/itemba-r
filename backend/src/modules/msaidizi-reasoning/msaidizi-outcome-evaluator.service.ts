import { Injectable } from '@nestjs/common';
import { MsaidiziEffect } from '@prisma/client';
import { ProposalOutcomeEvaluation, ProposedPlanDraft } from './msaidizi-reasoning.types';

export abstract class MsaidiziOutcomeEvaluator {
  abstract evaluateProposal(plan: ProposedPlanDraft): ProposalOutcomeEvaluation;
}

@Injectable()
export class DeterministicMsaidiziOutcomeEvaluator extends MsaidiziOutcomeEvaluator {
  evaluateProposal(plan: ProposedPlanDraft): ProposalOutcomeEvaluation {
    const readCount = plan.steps.filter(
      (step) => step.expectedEffect === MsaidiziEffect.READ,
    ).length;
    const mutationSteps = plan.steps.filter((step) => step.mutation);
    const externalActionCount = plan.steps.filter(
      (step) => step.expectedEffect === MsaidiziEffect.EXTERNAL,
    ).length;
    const irreversibleActionCount = plan.steps.filter(
      (step) => step.expectedEffect === MsaidiziEffect.IRREVERSIBLE,
    ).length;
    const recovered = mutationSteps.filter(
      (step) => step.recovery && Object.keys(step.recovery).length > 0,
    ).length;
    return {
      proposedOnly: true,
      stepCount: plan.steps.length,
      readCount,
      mutationCount: mutationSteps.length,
      externalActionCount,
      irreversibleActionCount,
      recoveryCoverage: mutationSteps.length === 0 ? 1 : recovered / mutationSteps.length,
      highestRisk: highestRisk(plan),
      stopConditionsDeclared:
        plan.steps.length > 0 &&
        plan.steps.every((step) => Object.keys(step.stopConditions).length > 0),
    };
  }
}

function highestRisk(plan: ProposedPlanDraft): ProposalOutcomeEvaluation['highestRisk'] {
  if (plan.steps.some((step) => step.expectedEffect === MsaidiziEffect.IRREVERSIBLE)) {
    return 'IRREVERSIBLE';
  }
  if (plan.steps.some((step) => step.expectedEffect === MsaidiziEffect.EXTERNAL)) {
    return 'EXTERNAL';
  }
  if (plan.steps.some((step) => step.expectedEffect === MsaidiziEffect.WRITE)) return 'WRITE';
  return 'READ';
}
