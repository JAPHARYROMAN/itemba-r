import { MsaidiziEffect, MsaidiziExecutionTarget } from '@prisma/client';
import {
  assertTemplateWithinMandate,
  MsaidiziScheduleTemplateError,
  validateScheduleTaskTemplate,
} from './msaidizi-schedule-template';
import {
  proposalDataClass,
  UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
  UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
} from '../msaidizi-updates/update-candidate-proposal.port';
import { createHash } from 'node:crypto';

function template() {
  return {
    title: 'Morning review',
    objective: 'Review new expenses',
    steps: [
      {
        key: 'load-expenses',
        name: 'Load expenses',
        target: MsaidiziExecutionTarget.ERP,
        capability: 'ExpensesController.findAll',
        capabilityVersion: '1',
        arguments: { path: {}, query: {} },
        dependsOn: [],
        expectedEffect: MsaidiziEffect.READ,
        dataClass: 'internal',
        preconditions: {},
        budgets: {},
        stopConditions: {},
        idempotent: true,
        mutation: false,
      },
    ],
  };
}

function hostTemplate(capability: string, args: Record<string, unknown>) {
  return {
    title: 'Governed external action',
    objective: 'Perform an exact external action',
    steps: [
      {
        key: 'external-action',
        name: 'Perform external action',
        target: MsaidiziExecutionTarget.HOST,
        capability,
        capabilityVersion: '1',
        arguments: args,
        dependsOn: [],
        expectedEffect: MsaidiziEffect.EXTERNAL,
        dataClass: 'confidential',
        preconditions: {},
        budgets: {},
        stopConditions: {},
        idempotent: true,
        mutation: true,
      },
    ],
  };
}

const dynamicArguments = {
  endpointId: 'dynamic-email',
  destinationAuthority: 'mandate_dynamic_https_v1',
  destinationUri: 'https://api.itemba.com/v1/email/send',
  serverCertificateSha256: 'a'.repeat(64),
  vaultReferenceId: '78ad31e5-b7d8-48f4-b606-bc6cd0e82c0f',
  vaultRecordSha256: 'b'.repeat(64),
  headerPrefix: 'Bearer ',
  to: ['employee@example.com'],
  subject: 'Daily report',
  text: 'The governed routine completed.',
};

describe('Msaidizi schedule task templates', () => {
  it('accepts a strict task DAG inside the persisted mandate scope', () => {
    const parsed = validateScheduleTaskTemplate(template());
    expect(() =>
      assertTemplateWithinMandate(parsed, [
        {
          capability: 'ExpensesController.findAll',
          effects: [MsaidiziEffect.READ],
          dataClasses: ['internal'],
        },
      ]),
    ).not.toThrow();
    expect(parsed.steps[0].target).toBe(MsaidiziExecutionTarget.ERP);
  });

  it('rejects template-controlled identity and authority fields', () => {
    expect(() => validateScheduleTaskTemplate({ ...template(), mode: 'AUTOPILOT' })).toThrow(
      MsaidiziScheduleTemplateError,
    );
    expect(() =>
      validateScheduleTaskTemplate({ ...template(), companyId: 'different-company' }),
    ).toThrow(MsaidiziScheduleTemplateError);
  });

  it('rejects credentials and capabilities outside the mandate', () => {
    expect(() =>
      validateScheduleTaskTemplate({ ...template(), inputs: { apiKey: 'abcdef1234567890' } }),
    ).toThrow(MsaidiziScheduleTemplateError);

    const parsed = validateScheduleTaskTemplate(template());
    expect(() =>
      assertTemplateWithinMandate(parsed, [
        {
          capability: 'CustomersController.findAll',
          effects: [MsaidiziEffect.READ],
          dataClasses: ['internal'],
        },
      ]),
    ).toThrow(MsaidiziScheduleTemplateError);
  });

  it('keeps static external endpoint schedules compatible without a dynamic grant', () => {
    const parsed = validateScheduleTaskTemplate(
      hostTemplate('external.email.send', {
        endpointId: 'corporate-email-gateway',
        to: ['employee@example.com'],
        subject: 'Daily report',
        text: 'The governed routine completed.',
      }),
    );

    expect(() =>
      assertTemplateWithinMandate(parsed, [
        {
          capability: 'external.email.send',
          effects: [MsaidiziEffect.EXTERNAL],
          dataClasses: ['confidential'],
        },
      ]),
    ).not.toThrow();
  });

  it('requires explicit dynamic destination authority for scheduled external steps', () => {
    const parsed = validateScheduleTaskTemplate(
      hostTemplate('external.email.send', dynamicArguments),
    );
    const baseGrant = {
      capability: 'external.email.send',
      effects: [MsaidiziEffect.EXTERNAL],
      dataClasses: ['confidential'],
    };

    expect(() => assertTemplateWithinMandate(parsed, [baseGrant])).toThrow(
      MsaidiziScheduleTemplateError,
    );
    expect(() =>
      assertTemplateWithinMandate(parsed, [
        {
          ...baseGrant,
          externalDestinationAuthorities: ['mandate_dynamic_https_v1'],
        },
      ]),
    ).not.toThrow();
  });

  it('rejects dynamic browser destination fields even when a mandate claims the grant', () => {
    const parsed = validateScheduleTaskTemplate(
      hostTemplate('browser.navigate', {
        destinationAuthority: 'mandate_dynamic_https_v1',
        destinationUri: 'https://example.com/',
      }),
    );

    expect(() =>
      assertTemplateWithinMandate(parsed, [
        {
          capability: 'browser.navigate',
          effects: [MsaidiziEffect.EXTERNAL],
          dataClasses: ['confidential'],
          externalDestinationAuthorities: ['mandate_dynamic_https_v1'],
        },
      ]),
    ).toThrow(MsaidiziScheduleTemplateError);
  });

  it('persists generated self-improvement schedules only under an explicit exact v2 grant', () => {
    const source = Buffer.from('export const scheduledValue = 42;\n', 'utf8');
    const dataClass = proposalDataClass('APPLICATION');
    const parsed = validateScheduleTaskTemplate({
      title: 'Bounded generated update',
      objective: 'Prepare an isolated application candidate',
      steps: [
        {
          key: 'generate-candidate',
          name: 'Generate candidate',
          target: MsaidiziExecutionTarget.SELF_IMPROVEMENT,
          capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
          capabilityVersion: UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
          arguments: {
            name: 'Scheduled bounded application update',
            version: '2.0.0',
            scope: 'APPLICATION',
            rollbackVersion: '1.9.0',
            rationale: 'Prepare and evaluate a bounded source update in the isolated VM.',
            baseRevisionSha256: 'a'.repeat(64),
            changes: [
              {
                relativePath: 'backend/src/modules/orders/scheduled-value.ts',
                operation: 'ADD',
                expectedPreSha256: null,
                contentBase64: source.toString('base64'),
                contentSha256: createHash('sha256').update(source).digest('hex'),
              },
            ],
            evaluationBudget: {
              maxWallTimeSeconds: 600,
              maxCpuTimeSeconds: 1_200,
              maxBytesRead: '10485760',
              maxBytesWritten: '10485760',
              maxExternalEgressBytes: '1048576',
              maxModelTurns: 4,
              maxModelInputTokens: '10000',
              maxModelOutputTokens: '5000',
              maxModelCostMicrousd: '1000000',
            },
          },
          dependsOn: [],
          expectedEffect: MsaidiziEffect.WRITE,
          dataClass,
          preconditions: {},
          budgets: {},
          stopConditions: {},
          idempotent: true,
          mutation: true,
        },
      ],
    });
    const grant = {
      capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
      effects: [MsaidiziEffect.WRITE],
      dataClasses: [dataClass],
    };

    expect(() => assertTemplateWithinMandate(parsed, [grant])).toThrow(
      MsaidiziScheduleTemplateError,
    );
    expect(() =>
      assertTemplateWithinMandate(parsed, [
        { ...grant, version: UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION },
      ]),
    ).not.toThrow();
  });
});
