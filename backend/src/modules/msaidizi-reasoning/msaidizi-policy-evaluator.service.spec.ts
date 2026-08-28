import { MsaidiziEffect, MsaidiziExecutionTarget, MsaidiziTaskMode } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import { DeterministicMsaidiziPolicyEvaluator } from './msaidizi-policy-evaluator.service';
import {
  ProposedPlanDraft,
  ProposedPlanStep,
  ReasoningCapability,
  ReasoningContext,
} from './msaidizi-reasoning.types';

describe('DeterministicMsaidiziPolicyEvaluator', () => {
  const evaluator = new DeterministicMsaidiziPolicyEvaluator({
    autopilotEnabled: true,
  } as AutonomyConfig);

  it('accepts a locked, permission-filtered read plan', () => {
    const step = readStep();
    const result = evaluator.evaluate({
      context: context({ capabilities: [readCapability()] }),
      authorityDraft: draft(step),
      candidate: draft(step),
    });
    expect(result.allowed).toBe(true);
  });

  it('rejects a write that was absent from the authority-only draft', () => {
    const result = evaluator.evaluate({
      context: context({ capabilities: [readCapability(), writeCapability()] }),
      authorityDraft: draft(readStep()),
      candidate: draft(writeStep()),
    });
    expect(codes(result)).toContain('UNPLANNED_WRITE');
  });

  it('rejects permission and service-principal grant misses', () => {
    const step = readStep();
    const result = evaluator.evaluate({
      context: context({
        capabilities: [readCapability()],
        callerPermissions: [],
        principalPermissions: [],
      }),
      authorityDraft: draft(step),
      candidate: draft(step),
    });
    expect(codes(result)).toEqual(
      expect.arrayContaining(['CALLER_PERMISSION_DENIED', 'PRINCIPAL_PERMISSION_DENIED']),
    );
  });

  it('rejects an Autopilot capability outside the active mandate tuple', () => {
    const step = readStep();
    const result = evaluator.evaluate({
      context: context({
        mode: MsaidiziTaskMode.AUTOPILOT,
        requestedMandateId: 'mandate-1',
        mandate: {
          id: 'mandate-1',
          principalId: 'principal-1',
          deviceIds: [],
          budgets: {},
          capabilities: [
            {
              capability: step.capability,
              effects: [MsaidiziEffect.WRITE],
              dataClasses: ['internal'],
            },
          ],
        },
        capabilities: [readCapability()],
      }),
      authorityDraft: draft(step),
      candidate: draft(step),
    });
    expect(codes(result)).toContain('MANDATE_CAPABILITY_MISMATCH');
  });

  it('rejects a host step whose device differs from the active manifest', () => {
    const step = hostStep('device-2');
    const result = evaluator.evaluate({
      context: context({
        requestedMandateId: 'mandate-1',
        requestedDeviceId: 'device-1',
        mandate: {
          id: 'mandate-1',
          principalId: 'principal-1',
          deviceIds: ['device-1'],
          budgets: {},
          capabilities: [
            {
              capability: 'files.read',
              version: '1',
              effects: [MsaidiziEffect.READ],
              dataClasses: ['Internal'],
            },
          ],
        },
        capabilities: [hostCapability('device-1')],
      }),
      authorityDraft: draft(step),
      candidate: draft(step),
    });
    expect(codes(result)).toContain('DEVICE_CAPABILITY_UNAVAILABLE');
  });

  it.each(['filesystem.file.read', 'filesystem.file.disclose.ephemeral'])(
    'rejects unavailable file content capability %s even when a forged manifest offers it',
    (capability) => {
      const step = {
        ...hostStep('device-1'),
        capability,
        capabilityVersion: '1.0.0',
      };
      const forged = {
        ...hostCapability('device-1'),
        capability,
        capabilityVersion: '1.0.0',
      };
      const result = evaluator.evaluate({
        context: context({ capabilities: [forged] }),
        authorityDraft: draft(step),
        candidate: draft(step),
      });

      expect(codes(result)).toContain('REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY');
    },
  );

  it('requires an explicit mandate grant for a dynamic HTTPS destination', () => {
    const step = externalStep();
    const capability = externalCapability('device-1');
    const mandate = {
      id: 'mandate-1',
      principalId: 'principal-1',
      deviceIds: ['device-1'],
      budgets: {},
      capabilities: [
        {
          capability: step.capability,
          version: step.capabilityVersion,
          effects: [MsaidiziEffect.EXTERNAL],
          dataClasses: ['internal'],
          externalDestinationAuthorities: [] as string[],
        },
      ],
    };
    const denied = evaluator.evaluate({
      context: context({
        mode: MsaidiziTaskMode.AUTOPILOT,
        requestedMandateId: mandate.id,
        requestedDeviceId: 'device-1',
        mandate,
        capabilities: [capability],
        callerPermissions: [],
      }),
      authorityDraft: draft(step),
      candidate: draft(step),
    });
    expect(codes(denied)).toContain('MANDATE_CAPABILITY_MISMATCH');

    mandate.capabilities[0].externalDestinationAuthorities = ['mandate_dynamic_https_v1'];
    const allowed = evaluator.evaluate({
      context: context({
        mode: MsaidiziTaskMode.AUTOPILOT,
        requestedMandateId: mandate.id,
        requestedDeviceId: 'device-1',
        mandate,
        capabilities: [capability],
        callerPermissions: [],
      }),
      authorityDraft: draft(step),
      candidate: draft(step),
    });
    expect(allowed.allowed).toBe(true);
  });

  it('rejects dynamic-only destination fields when explicit authority is absent', () => {
    const step = externalStep();
    delete (step.arguments as Record<string, unknown>).destinationAuthority;
    const result = evaluator.evaluate({
      context: context({
        capabilities: [externalCapability('device-1')],
        callerPermissions: [],
      }),
      authorityDraft: draft(step),
      candidate: draft(step),
    });
    expect(codes(result)).toContain('EXTERNAL_DESTINATION_AUTHORITY_INVALID');
  });

  it('rejects task and step budget mismatches', () => {
    const step = writeStep();
    step.budgets = { maxMutations: 2 };
    const result = evaluator.evaluate({
      context: context({
        budgets: { ...context().budgets, maxMutations: 0 },
        capabilities: [writeCapability()],
      }),
      authorityDraft: draft(step),
      candidate: draft(step),
    });
    expect(codes(result)).toEqual(
      expect.arrayContaining(['TASK_MUTATION_BUDGET_EXCEEDED', 'STEP_BUDGET_MISMATCH']),
    );
  });

  it('rejects every protected supervisor-boundary capability', () => {
    const protectedPrefixes = [
      'supervisor.',
      'trusted-root.',
      'bootstrap.',
      'audit-signer.',
      'recovery-vault.',
      'kill-switch.',
      'update-verifier.',
    ];
    for (const prefix of protectedPrefixes) {
      const step = { ...readStep(), capability: `${prefix}mutate` };
      const result = evaluator.evaluate({
        context: context({
          capabilities: [{ ...readCapability(), capability: step.capability }],
        }),
        authorityDraft: draft(step),
        candidate: draft(step),
      });
      expect(codes(result)).toContain('SUPERVISOR_BOUNDARY_DENIED');
    }
  });

  it('fails preflight before a model call on mandate, device, and budget mismatch', () => {
    const result = evaluator.preflight(
      context({
        mode: MsaidiziTaskMode.AUTOPILOT,
        requestedMandateId: 'missing',
        requestedDeviceId: 'missing-device',
        mandate: null,
        budgetViolations: [{ code: 'DEPLOYMENT_BUDGET_EXCEEDED', message: 'too much spend' }],
        capabilities: [readCapability()],
      }),
    );
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        'DEPLOYMENT_BUDGET_EXCEEDED',
        'MANDATE_INACTIVE_OR_OUT_OF_SCOPE',
        'AUTOPILOT_MANDATE_REQUIRED',
        'DEVICE_UNAVAILABLE_OR_MISMATCHED',
      ]),
    );
  });

  it('accepts the exact browser.file.upload manifest schema with a reviewed scoped reference', () => {
    const deviceId = '10000000-0000-4000-8000-000000000008';
    const secretReferenceId = '10000000-0000-4000-8000-000000000010';
    const secretReferenceSha256 = createHash('sha256')
      .update(secretReferenceId, 'utf8')
      .digest('hex');
    const step = browserUploadStep(deviceId, secretReferenceId, secretReferenceSha256);
    const capability = browserUploadCapability(deviceId);
    const mandate = hostMandate(deviceId, capability);
    const scope = step.inputBindings[0].source.scope;

    const result = evaluator.evaluate({
      context: context({
        objective: 'Use the reviewed upload credential reference in the approved browser field.',
        mode: MsaidiziTaskMode.AUTOPILOT,
        requestedMandateId: mandate.id,
        requestedDeviceId: deviceId,
        mandate,
        capabilities: [capability],
        callerPermissions: [],
        inputs: {
          _msaidiziReferenceAuthority: [
            { id: secretReferenceId, sha256: secretReferenceSha256, scope },
          ],
        },
      }),
      authorityDraft: draft(step),
      candidate: draft(step),
    });

    expect(result.allowed).toBe(true);
    expect(result.checks).toContain('authority-input-bindings');
  });

  it('accepts file-to-email only through the reviewed governed attachment schema', () => {
    const deviceId = '10000000-0000-4000-8000-000000000008';
    const sourceCapability = { ...hostCapability(deviceId), dataClass: 'internal' };
    const source = {
      ...hostStep(deviceId),
      key: 'read-file',
      name: 'Read file',
      dataClass: 'internal',
    };
    const email = externalStep();
    email.preconditions = { deviceId };
    email.dependsOn = [source.key];
    email.arguments = { ...email.arguments, attachment: null };
    email.inputBindings = [
      {
        targetPath: '/attachment',
        source: {
          kind: 'DEPENDENCY_ARTIFACT',
          dependencyStepKey: source.key,
          path: '',
        },
        dataClass: 'internal',
        expectedType: 'object',
        expectedSchema: governedArtifactExpectedSchema('FILE', 'internal'),
        transform: { name: 'IDENTITY', version: '1' },
      },
    ];
    const emailCapability = externalCapability(deviceId);
    const mandate = {
      ...hostMandate(deviceId, emailCapability),
      capabilities: [
        {
          capability: sourceCapability.capability,
          version: sourceCapability.capabilityVersion,
          effects: [sourceCapability.expectedEffect],
          dataClasses: [sourceCapability.dataClass],
        },
        {
          ...hostMandate(deviceId, emailCapability).capabilities[0],
          externalDestinationAuthorities: ['mandate_dynamic_https_v1'],
        },
      ],
    };
    const proposal = { title: 'Task', summary: 'Summary', steps: [source, email] };

    const result = evaluator.evaluate({
      context: context({
        objective: 'Send the reviewed file artifact as the approved email attachment.',
        mode: MsaidiziTaskMode.AUTOPILOT,
        requestedMandateId: mandate.id,
        requestedDeviceId: deviceId,
        capabilities: [sourceCapability, emailCapability],
        callerPermissions: [],
        mandate,
      }),
      authorityDraft: proposal,
      candidate: proposal,
    });

    expect(result.allowed).toBe(true);
    expect(result.checks).toContain('authority-input-bindings');
  });

  it('accepts screen-to-upload only through the reviewed screenshot artifact schema', () => {
    const deviceId = '10000000-0000-4000-8000-000000000008';
    const source = screenshotStep(deviceId);
    const upload = browserArtifactUploadStep(deviceId);
    upload.dependsOn = [source.key];
    const capability = browserUploadCapability(deviceId);
    const screenCapability = screenshotCapability(deviceId);
    const mandate = {
      ...hostMandate(deviceId, capability),
      capabilities: [
        hostMandate(deviceId, capability).capabilities[0],
        {
          capability: screenCapability.capability,
          version: screenCapability.capabilityVersion,
          effects: [screenCapability.expectedEffect],
          dataClasses: [screenCapability.dataClass],
        },
      ],
    };
    const proposal = { title: 'Task', summary: 'Summary', steps: [source, upload] };

    const result = evaluator.evaluate({
      context: context({
        mode: MsaidiziTaskMode.AUTOPILOT,
        requestedMandateId: mandate.id,
        requestedDeviceId: deviceId,
        mandate,
        capabilities: [screenCapability, capability],
        callerPermissions: [],
      }),
      authorityDraft: proposal,
      candidate: proposal,
    });

    expect(result.allowed).toBe(true);
    expect(result.checks).toContain('authority-input-bindings');
  });

  it('does not let an enrichment-originated candidate change authority bindings', () => {
    const authority = readStep();
    authority.arguments = { path: {}, query: { page: null } };
    authority.inputBindings = [
      {
        targetPath: '/query/page',
        source: { kind: 'PLAN_INPUT', path: '/page' },
        dataClass: 'internal',
        expectedType: 'integer',
        expectedSchema: { type: 'integer', minimum: 1, maximum: 100 },
        transform: { name: 'IDENTITY', version: '1' },
      },
    ];
    const candidate = structuredClone(authority);
    candidate.inputBindings[0].source = { kind: 'PLAN_INPUT', path: '/untrustedPage' };

    const result = evaluator.evaluate({
      context: context({
        inputs: { page: 1, untrustedPage: 99 },
        capabilities: [
          {
            ...readCapability(),
            argumentsSchema: {
              ...envelopeSchema(),
              properties: {
                path: { type: 'object', properties: {}, additionalProperties: false },
                query: {
                  type: 'object',
                  properties: { page: { type: 'integer', minimum: 1, maximum: 100 } },
                  required: ['page'],
                  additionalProperties: false,
                },
              },
            },
          },
        ],
      }),
      authorityDraft: draft(authority),
      candidate: draft(candidate),
    });

    expect(codes(result)).toContain('UNTRUSTED_INPUT_BINDING_CHANGE');
  });
});

function context(overrides: Partial<ReasoningContext> = {}): ReasoningContext {
  return {
    objective: 'Review expenses',
    mode: MsaidiziTaskMode.COLLABORATIVE,
    companyId: 'company-1',
    inputs: {},
    stopConditions: {},
    budgets: {
      maxWallTimeSeconds: 60,
      maxModelTurns: 10,
      maxAttemptedToolCalls: 10,
      maxMutations: 2,
      maxLocalBytes: 1_000,
      maxExternalEgressBytes: 1_000,
      maxModelCostUsd: 1,
    },
    budgetViolations: [],
    mandate: null,
    capabilities: [readCapability()],
    memories: [],
    callerPermissions: ['expenses.read'],
    principalPermissions: ['expenses.read', 'expenses.write'],
    redactionsApplied: false,
    ...overrides,
  };
}

function readCapability(): ReasoningCapability {
  return {
    target: MsaidiziExecutionTarget.ERP,
    capability: 'ExpensesController.findAll',
    capabilityVersion: '1',
    description: 'Read expenses',
    expectedEffect: MsaidiziEffect.READ,
    dataClass: 'internal',
    mutation: false,
    idempotent: true,
    argumentsSchema: envelopeSchema(),
    recoveryKind: 'NotApplicable',
    permissions: ['expenses.read'],
    anyPermissions: [],
  };
}

function writeCapability(): ReasoningCapability {
  return {
    ...readCapability(),
    capability: 'ExpensesController.create',
    expectedEffect: MsaidiziEffect.WRITE,
    mutation: true,
    idempotent: false,
    argumentsSchema: {
      ...envelopeSchema(),
      properties: {
        path: { type: 'object', properties: {}, additionalProperties: false },
        query: { type: 'object', properties: {}, additionalProperties: false },
        body: {
          type: 'object',
          properties: { amount: { type: 'number' } },
          required: ['amount'],
          additionalProperties: false,
        },
      },
      required: ['path', 'query', 'body'],
    },
    recoveryKind: 'CompensatingAction',
    permissions: ['expenses.write'],
  };
}

function hostCapability(deviceId: string): ReasoningCapability {
  return {
    target: MsaidiziExecutionTarget.HOST,
    capability: 'files.read',
    capabilityVersion: '1',
    description: 'Read a file',
    expectedEffect: MsaidiziEffect.READ,
    dataClass: 'Internal',
    mutation: false,
    idempotent: true,
    argumentsSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    recoveryKind: 'NotApplicable',
    permissions: [],
    anyPermissions: [],
    deviceId,
  };
}

function browserUploadCapability(deviceId: string): ReasoningCapability {
  return {
    target: MsaidiziExecutionTarget.HOST,
    capability: 'browser.file.upload',
    capabilityVersion: '1.0.0',
    description:
      'Select one approved browser upload file through a scoped reference or governed artifact',
    expectedEffect: MsaidiziEffect.IRREVERSIBLE,
    dataClass: 'Restricted',
    mutation: true,
    idempotent: true,
    argumentsSchema: {
      type: 'object',
      properties: {
        originId: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,80}$' },
        originSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        processId: { type: 'integer', minimum: 1 },
        automationId: { type: 'string', minLength: 1, maxLength: 512 },
        secretReferenceId: { type: 'string', format: 'uuid' },
        uploadRootId: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,80}$' },
        artifact: governedArtifactCapabilitySchema('SCREENSHOT'),
      },
      oneOf: [
        {
          required: [
            'originId',
            'originSha256',
            'processId',
            'automationId',
            'secretReferenceId',
            'uploadRootId',
          ],
          not: { required: ['artifact'] },
        },
        {
          required: ['originId', 'originSha256', 'processId', 'automationId', 'artifact'],
          not: {
            anyOf: [{ required: ['secretReferenceId'] }, { required: ['uploadRootId'] }],
          },
        },
      ],
      additionalProperties: false,
    },
    recoveryKind: 'Irreversible',
    permissions: [],
    anyPermissions: [],
    deviceId,
  };
}

function browserArtifactUploadStep(deviceId: string): ProposedPlanStep {
  return {
    ...browserUploadStep(deviceId, '10000000-0000-4000-8000-000000000010', '0'.repeat(64)),
    arguments: {
      originId: 'itemba',
      originSha256: 'a'.repeat(64),
      processId: 7,
      automationId: 'approved-upload-field',
      artifact: null,
    },
    inputBindings: [
      {
        targetPath: '/artifact',
        source: {
          kind: 'DEPENDENCY_ARTIFACT',
          dependencyStepKey: 'capture-screen',
          path: '',
        },
        dataClass: 'Restricted',
        expectedType: 'object',
        expectedSchema: governedArtifactExpectedSchema('SCREENSHOT', 'Restricted'),
        transform: { name: 'IDENTITY', version: '1' },
      },
    ],
  };
}

function browserUploadStep(
  deviceId: string,
  secretReferenceId: string,
  secretReferenceSha256: string,
): ProposedPlanStep {
  return {
    key: 'upload-file',
    name: 'Upload approved file',
    target: MsaidiziExecutionTarget.HOST,
    capability: 'browser.file.upload',
    capabilityVersion: '1.0.0',
    arguments: {
      originId: 'itemba',
      originSha256: 'a'.repeat(64),
      processId: 7,
      automationId: 'approved-upload-field',
      secretReferenceId: null,
      uploadRootId: 'exports',
    },
    dependsOn: [],
    inputBindings: [
      {
        targetPath: '/secretReferenceId',
        source: {
          kind: 'SECRET_REFERENCE',
          path: '',
          secretReferenceId,
          secretReferenceSha256,
          scope: {
            capability: 'browser.file.upload',
            capabilityVersion: '1.0.0',
            dataClass: 'Restricted',
            deviceId,
          },
        },
        dataClass: 'Restricted',
        expectedType: 'string',
        expectedSchema: { type: 'string', minLength: 36, maxLength: 36 },
        transform: { name: 'IDENTITY', version: '1' },
      },
    ],
    expectedEffect: MsaidiziEffect.IRREVERSIBLE,
    dataClass: 'Restricted',
    preconditions: { deviceId },
    recovery: { strategy: 'irreversible' },
    budgets: {},
    stopConditions: {},
    idempotent: true,
    mutation: true,
  };
}

function screenshotCapability(deviceId: string): ReasoningCapability {
  return {
    target: MsaidiziExecutionTarget.HOST,
    capability: 'screen.capture',
    capabilityVersion: '1.0.0',
    description: 'Capture the reviewed window',
    expectedEffect: MsaidiziEffect.READ,
    dataClass: 'Restricted',
    mutation: false,
    idempotent: true,
    argumentsSchema: {
      type: 'object',
      properties: { windowId: { type: 'string', minLength: 1, maxLength: 128 } },
      required: ['windowId'],
      additionalProperties: false,
    },
    recoveryKind: 'NotApplicable',
    permissions: [],
    anyPermissions: [],
    deviceId,
  };
}

function screenshotStep(deviceId: string): ProposedPlanStep {
  return {
    ...readStep(),
    key: 'capture-screen',
    name: 'Capture reviewed window',
    target: MsaidiziExecutionTarget.HOST,
    capability: 'screen.capture',
    capabilityVersion: '1.0.0',
    arguments: { windowId: 'report-window' },
    dataClass: 'Restricted',
    preconditions: { deviceId },
  };
}

function hostMandate(
  deviceId: string,
  capability: ReasoningCapability,
): NonNullable<ReasoningContext['mandate']> {
  return {
    id: 'mandate-1',
    principalId: 'principal-1',
    deviceIds: [deviceId],
    budgets: {},
    capabilities: [
      {
        capability: capability.capability,
        version: capability.capabilityVersion,
        effects: [capability.expectedEffect],
        dataClasses: [capability.dataClass],
      },
    ],
  };
}

function readStep(): ProposedPlanStep {
  return {
    key: 'read-expenses',
    name: 'Read expenses',
    target: MsaidiziExecutionTarget.ERP,
    capability: 'ExpensesController.findAll',
    capabilityVersion: '1',
    arguments: { path: {}, query: {} },
    dependsOn: [],
    inputBindings: [],
    expectedEffect: MsaidiziEffect.READ,
    dataClass: 'internal',
    preconditions: {},
    recovery: null,
    budgets: {},
    stopConditions: { after: 1 },
    idempotent: true,
    mutation: false,
  };
}

function writeStep(): ProposedPlanStep {
  return {
    ...readStep(),
    key: 'create-expense',
    name: 'Create expense',
    capability: 'ExpensesController.create',
    arguments: { path: {}, query: {}, body: { amount: 10 } },
    expectedEffect: MsaidiziEffect.WRITE,
    recovery: { strategy: 'compensating-delete' },
    idempotent: false,
    mutation: true,
  };
}

function hostStep(deviceId: string): ProposedPlanStep {
  return {
    ...readStep(),
    key: 'read-file',
    name: 'Read file',
    target: MsaidiziExecutionTarget.HOST,
    capability: 'files.read',
    arguments: { path: 'C:\\report.txt' },
    dataClass: 'Internal',
    preconditions: { deviceId },
  };
}

function externalCapability(deviceId: string): ReasoningCapability {
  return {
    target: MsaidiziExecutionTarget.HOST,
    capability: 'external.email.send',
    capabilityVersion: '1.0.0',
    description: 'Send one exact email through a governed HTTPS endpoint',
    expectedEffect: MsaidiziEffect.EXTERNAL,
    dataClass: 'internal',
    mutation: true,
    idempotent: true,
    argumentsSchema: {
      type: 'object',
      properties: {
        destinationAuthority: { type: 'string' },
        endpointId: { type: 'string' },
        destinationUri: { type: 'string' },
        serverCertificateSha256: { type: 'string' },
        vaultReferenceId: { type: 'string' },
        vaultRecordSha256: { type: 'string' },
        headerPrefix: { type: 'string' },
        to: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        text: { type: 'string' },
        attachment: governedArtifactCapabilitySchema(),
      },
      required: [
        'destinationAuthority',
        'endpointId',
        'destinationUri',
        'serverCertificateSha256',
        'vaultReferenceId',
        'vaultRecordSha256',
        'headerPrefix',
        'to',
        'subject',
        'text',
      ],
      additionalProperties: false,
    },
    recoveryKind: 'IdempotentReplay',
    permissions: [],
    anyPermissions: [],
    deviceId,
  };
}

function governedArtifactCapabilitySchema(kind?: 'SCREENSHOT') {
  return {
    type: 'object',
    properties: {
      schemaVersion: { const: 1 },
      taskId: { type: 'string', format: 'uuid' },
      planVersionId: { type: 'string', format: 'uuid' },
      targetStepId: { type: 'string', format: 'uuid' },
      deviceId: { type: 'string', format: 'uuid' },
      sourceStepId: { type: 'string', format: 'uuid' },
      sourceAttemptId: { type: 'string', minLength: 1, maxLength: 200 },
      artifactId: { type: 'string', format: 'uuid' },
      sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      byteSize: { type: 'integer', minimum: 1, maximum: 131_072 },
      mimeType: { type: 'string', minLength: 3, maxLength: 127 },
      name: { type: 'string', minLength: 1, maxLength: 255 },
      kind: kind
        ? { const: kind }
        : { type: 'string', enum: ['FILE', 'SCREENSHOT', 'REPORT', 'AUDIO', 'DOCUMENT', 'OTHER'] },
      dataClass: { type: 'string', minLength: 1, maxLength: 64 },
      scopeSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      contentBase64: { type: 'string', minLength: 4, maxLength: 174_764 },
    },
    required: [
      'schemaVersion',
      'taskId',
      'planVersionId',
      'targetStepId',
      'deviceId',
      'sourceStepId',
      'sourceAttemptId',
      'artifactId',
      'sha256',
      'byteSize',
      'mimeType',
      'name',
      'kind',
      'dataClass',
      'scopeSha256',
      'contentBase64',
    ],
    additionalProperties: false,
  };
}

function governedArtifactExpectedSchema(kind: 'FILE' | 'SCREENSHOT', dataClass: string) {
  const properties = {
    schemaVersion: { type: 'integer', const: 1 },
    taskId: { type: 'string', minLength: 36, maxLength: 36 },
    planVersionId: { type: 'string', minLength: 36, maxLength: 36 },
    targetStepId: { type: 'string', minLength: 36, maxLength: 36 },
    deviceId: { type: 'string', minLength: 36, maxLength: 36 },
    sourceStepId: { type: 'string', minLength: 36, maxLength: 36 },
    sourceAttemptId: { type: 'string', minLength: 1, maxLength: 200 },
    artifactId: { type: 'string', minLength: 36, maxLength: 36 },
    sha256: { type: 'string', minLength: 64, maxLength: 64 },
    byteSize: { type: 'integer', minimum: 1, maximum: 131_072 },
    mimeType: { type: 'string', minLength: 3, maxLength: 127 },
    name: { type: 'string', minLength: 1, maxLength: 255 },
    kind: { type: 'string', const: kind },
    dataClass: { type: 'string', const: dataClass },
    scopeSha256: { type: 'string', minLength: 64, maxLength: 64 },
    contentBase64: { type: 'string', minLength: 4, maxLength: 174_764 },
  };
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function externalStep(): ProposedPlanStep {
  return {
    ...readStep(),
    key: 'send-email',
    name: 'Send exact email',
    target: MsaidiziExecutionTarget.HOST,
    capability: 'external.email.send',
    capabilityVersion: '1.0.0',
    arguments: {
      destinationAuthority: 'mandate_dynamic_https_v1',
      endpointId: 'dynamic-mail-v1',
      destinationUri: 'https://mail-api.example.net/v1/messages',
      serverCertificateSha256: 'a'.repeat(64),
      vaultReferenceId: '3c5e3dba-c528-4b0a-937e-bdb9be90e347',
      vaultRecordSha256: 'b'.repeat(64),
      headerPrefix: 'Bearer ',
      to: ['finance@example.net'],
      subject: 'Approved report',
      text: 'The approved report is attached.',
    },
    expectedEffect: MsaidiziEffect.EXTERNAL,
    dataClass: 'internal',
    preconditions: { deviceId: 'device-1' },
    recovery: { strategy: 'idempotent-provider-key' },
    idempotent: true,
    mutation: true,
  };
}

function draft(step: ProposedPlanStep): ProposedPlanDraft {
  return { title: 'Task', summary: 'Summary', steps: [step] };
}

function envelopeSchema() {
  return {
    type: 'object',
    properties: {
      path: { type: 'object', properties: {}, additionalProperties: false },
      query: { type: 'object', properties: {}, additionalProperties: false },
    },
    required: ['path', 'query'],
    additionalProperties: false,
  };
}

function codes(result: { violations: Array<{ code: string }> }): string[] {
  return result.violations.map((violation) => violation.code);
}
