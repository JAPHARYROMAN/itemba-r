import { Prisma } from '@prisma/client';
import { EphemeralSecretFingerprintRegistry, PersistenceSecretGuard } from '../common/services';
import {
  MSAIDIZI_PERSISTENCE_SECRET_FIELDS,
  sanitizeMsaidiziPersistenceWrite,
} from './msaidizi-persistence-secret-boundary';

describe('Msaidizi persistence secret boundary', () => {
  let registry: EphemeralSecretFingerprintRegistry;
  let guard: PersistenceSecretGuard;

  beforeEach(() => {
    registry = new EphemeralSecretFingerprintRegistry();
    guard = new PersistenceSecretGuard(registry);
    registry.register('123456');
  });

  it('keeps the closed field policy aligned with the generated Prisma model types', () => {
    for (const [modelName, policy] of Object.entries(MSAIDIZI_PERSISTENCE_SECRET_FIELDS)) {
      const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === modelName);
      expect(model).toBeDefined();
      for (const fieldName of policy.text ?? []) {
        expect(model?.fields.find((field) => field.name === fieldName)).toMatchObject({
          kind: 'scalar',
          type: 'String',
        });
      }
      for (const fieldName of policy.json ?? []) {
        expect(model?.fields.find((field) => field.name === fieldName)).toMatchObject({
          kind: 'scalar',
          type: 'Json',
        });
      }
      for (const fieldName of policy.rejectText ?? []) {
        expect(model?.fields.find((field) => field.name === fieldName)).toMatchObject({
          kind: 'scalar',
          type: 'String',
        });
      }
      for (const fieldName of policy.rejectJson ?? []) {
        expect(model?.fields.find((field) => field.name === fieldName)).toMatchObject({
          kind: 'scalar',
          type: 'Json',
        });
      }
    }
  });

  it.each([
    ['conversation prompt', 'MsaidiziConversationTurn', 'prompt'],
    ['task definition', 'MsaidiziTask', 'objective'],
    ['plan inputs', 'MsaidiziPlanVersion', 'inputs'],
    ['step arguments', 'MsaidiziTaskStep', 'arguments'],
    ['task event', 'MsaidiziTaskEvent', 'payload'],
    ['memory metadata', 'MsaidiziMemory', 'metadata'],
    ['artifact provenance', 'MsaidiziArtifact', 'provenance'],
    ['host transcript', 'MsaidiziHostAction', 'resultSummary'],
    ['audit metadata', 'AuditLog', 'metadata'],
    ['reasoning plan/evaluation', 'MsaidiziReasoningTurn', 'evaluation'],
    ['update record', 'MsaidiziUpdateCandidate', 'evaluationSummary'],
    ['recovery record', 'MsaidiziRecoveryCommand', 'resultSummary'],
  ])('removes declared raw and encoded values from %s', (_label, model, field) => {
    const encoded = Buffer.from('123456').toString('base64');
    const params = {
      model,
      action: 'create',
      args: {
        data: {
          [field]:
            field === 'prompt' || field === 'objective'
              ? `raw=123456 encoded=${encoded}`
              : {
                  raw: 'before123456after',
                  encoded: `before${encoded}after`,
                },
        },
      },
    };

    sanitizeMsaidiziPersistenceWrite(params, guard);

    const serialized = JSON.stringify(params.args.data);
    expect(serialized).not.toContain('123456');
    expect(serialized).not.toContain(encoded);
    expect(registry.redactText(serialized).redactionsApplied).toBe(false);
  });

  it('sanitises nested creates and scalar update operators', () => {
    const params = {
      model: 'MsaidiziConversation',
      action: 'update',
      args: {
        data: {
          title: { set: 'title-123456' },
          turns: { create: { prompt: 'prompt-123456' } },
        },
      },
    };

    sanitizeMsaidiziPersistenceWrite(params, guard);

    expect(JSON.stringify(params.args.data)).not.toContain('123456');
  });

  it('removes declared values from durable request and workstation telemetry', () => {
    const audit = {
      model: 'AuditLog',
      action: 'create',
      args: { data: { ipAddress: '123456', userAgent: 'agent-123456' } },
    };
    const device = {
      model: 'MsaidiziDevice',
      action: 'update',
      args: {
        data: {
          platform: 'windows-123456',
          osVersion: 'build-123456',
          architecture: 'x64-123456',
        },
      },
    };

    sanitizeMsaidiziPersistenceWrite(audit, guard);
    sanitizeMsaidiziPersistenceWrite(device, guard);

    expect(JSON.stringify(audit.args.data)).not.toContain('123456');
    expect(JSON.stringify(device.args.data)).not.toContain('123456');
  });

  it('does not rewrite opaque ciphertext, identifiers, digests, or signed manifests', () => {
    const params = {
      model: 'MsaidiziConversation',
      action: 'update',
      args: {
        data: {
          resumeState: 'ciphertext-123456',
          agentSessionId: 'session-123456',
        },
      },
    };

    sanitizeMsaidiziPersistenceWrite(params, guard);

    expect(params.args.data).toEqual({
      resumeState: 'ciphertext-123456',
      agentSessionId: 'session-123456',
    });
  });

  it('preserves only an opaque secret-reference handle and typed digest in immutable bindings', () => {
    const secretReferenceId = '10000000-0000-4000-8000-000000000010';
    const secretReferenceSha256 = 'a'.repeat(64);
    const inputBindings = [
      {
        targetPath: '/secretReferenceId',
        source: {
          kind: 'SECRET_REFERENCE',
          path: '',
          secretReferenceId,
          secretReferenceSha256,
          scope: {
            capability: 'browser.secret.set',
            capabilityVersion: '1',
            dataClass: 'restricted',
            deviceId: '10000000-0000-4000-8000-000000000008',
          },
        },
        dataClass: 'restricted',
        expectedType: 'string',
        expectedSchema: { type: 'string', minLength: 36, maxLength: 36 },
        transform: { name: 'IDENTITY', version: '1' },
      },
    ];
    const params = {
      model: 'MsaidiziTaskStep',
      action: 'create',
      args: { data: { arguments: { secretReferenceId: null }, inputBindings } },
    };

    sanitizeMsaidiziPersistenceWrite(params, guard);

    expect(params.args.data.inputBindings).toEqual(inputBindings);
    expect(JSON.stringify(params.args.data.inputBindings)).toContain(secretReferenceId);
    expect(JSON.stringify(params.args.data.inputBindings)).toContain(secretReferenceSha256);
    expect(params.args.data.arguments.secretReferenceId).toBeNull();
  });

  it('rejects raw secret bytes in immutable binding schemas instead of rewriting them', () => {
    const params = {
      model: 'MsaidiziTaskStep',
      action: 'create',
      args: {
        data: {
          inputBindings: [
            {
              targetPath: '/value',
              expectedSchema: { type: 'string', const: '123456', enum: ['123456'] },
            },
          ],
        },
      },
    };

    expect(() => sanitizeMsaidiziPersistenceWrite(params, guard)).toThrow(
      'DECLARED_EPHEMERAL_SECRET_AT_IMMUTABLE_BOUNDARY',
    );
  });

  it.each([
    ['audit checkpoint', 'MsaidiziAuditCheckpoint', 'manifestJson', 'text'],
    ['recovery manifest', 'MsaidiziRecoveryCommand', 'manifestJson', 'text'],
    ['update manifest', 'MsaidiziUpdateDeployment', 'manifestJson', 'text'],
    ['trusted artifact claims', 'MsaidiziTrustedArtifactEvidence', 'canonicalClaims', 'json'],
    ['evaluation claims', 'MsaidiziUpdateEvaluationAttestation', 'canonicalClaims', 'json'],
    ['update manifest history', 'MsaidiziUpdateDeployment', 'manifestHistory', 'json'],
  ])('rejects rather than corrupting signed %s data', (_label, model, field, kind) => {
    const params = {
      model,
      action: 'create',
      args: {
        data: {
          [field]: kind === 'text' ? '{"value":"123456"}' : { value: '123456' },
        },
      },
    };

    expect(() => sanitizeMsaidiziPersistenceWrite(params, guard)).toThrow(
      'DECLARED_EPHEMERAL_SECRET_AT_IMMUTABLE_BOUNDARY',
    );
  });
});
