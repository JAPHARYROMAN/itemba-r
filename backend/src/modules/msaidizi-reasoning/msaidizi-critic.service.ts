import { Injectable } from '@nestjs/common';
import { MsaidiziEffect } from '@prisma/client';
import {
  CriticIssue,
  CriticReview,
  ProposedPlanDraft,
  ReasoningContext,
} from './msaidizi-reasoning.types';

export abstract class MsaidiziCritic {
  abstract review(plan: ProposedPlanDraft, context: ReasoningContext): CriticReview;
}

@Injectable()
export class DeterministicMsaidiziCritic extends MsaidiziCritic {
  review(plan: ProposedPlanDraft, context: ReasoningContext): CriticReview {
    const issues: CriticIssue[] = [];
    const sequence = new Map(plan.steps.map((step, index) => [step.key, index]));
    for (const step of plan.steps) {
      if (step.expectedEffect === MsaidiziEffect.READ && !step.idempotent) {
        issues.push(
          issue('READ_NOT_IDEMPOTENT', 'ERROR', 'Read steps must be idempotent', step.key),
        );
      }
      if (step.mutation && (!step.recovery || Object.keys(step.recovery).length === 0)) {
        issues.push(
          issue(
            'MUTATION_WITHOUT_RECOVERY',
            'ERROR',
            'Mutation has no recovery strategy',
            step.key,
          ),
        );
      }
      if (Object.keys(step.stopConditions).length === 0) {
        issues.push(
          issue(
            'STEP_STOP_CONDITION_UNSPECIFIED',
            'WARNING',
            'Step relies only on task ceilings and has no narrower stop condition',
            step.key,
          ),
        );
      }
      for (const dependency of step.dependsOn) {
        const dependencySequence = sequence.get(dependency);
        const stepSequence = sequence.get(step.key);
        if (
          dependencySequence !== undefined &&
          stepSequence !== undefined &&
          dependencySequence > stepSequence
        ) {
          issues.push(
            issue(
              'FORWARD_DEPENDENCY',
              'WARNING',
              'Dependency is valid but appears later in presentation order',
              step.key,
            ),
          );
        }
      }
    }
    if (plan.steps.filter((step) => step.mutation).length > context.budgets.maxMutations / 2) {
      issues.push(
        issue(
          'HIGH_MUTATION_BUDGET_UTILIZATION',
          'WARNING',
          'Proposal consumes more than half of its mutation ceiling before retries',
        ),
      );
    }
    if (Object.keys(context.stopConditions).length === 0) {
      issues.push(
        issue(
          'TASK_STOP_CONDITION_UNSPECIFIED',
          'INFO',
          'Only deployment and task resource ceilings stop the overall task',
        ),
      );
    }
    return {
      acceptable: !issues.some((candidate) => candidate.severity === 'ERROR'),
      issues,
    };
  }
}

function issue(
  code: string,
  severity: CriticIssue['severity'],
  message: string,
  stepKey?: string,
): CriticIssue {
  return { code, severity, message, ...(stepKey && { stepKey }) };
}
