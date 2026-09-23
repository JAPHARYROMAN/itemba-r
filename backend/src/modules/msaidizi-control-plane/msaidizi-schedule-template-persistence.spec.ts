import { createHash } from 'node:crypto';
import { EphemeralSecretFingerprintRegistry, PersistenceSecretGuard } from '../../common/services';
import { sanitizeMsaidiziPersistenceWrite } from '../../prisma/msaidizi-persistence-secret-boundary';
import { sanitizeScheduleTaskTemplate } from './msaidizi-schedule-template-persistence';
import { validateScheduleTaskTemplate } from './msaidizi-schedule-template';

const handle = '10000000-0000-4000-8000-000000000010';
const deviceId = '10000000-0000-4000-8000-000000000011';
function template() {
  const sha256 = createHash('sha256').update(handle).digest('hex');
  const scope = {
    capability: 'browser.secret.set',
    capabilityVersion: '1',
    dataClass: 'confidential',
    deviceId,
  };
  return {
    title: 'Use a reviewed credential handle',
    objective: 'Use only the exact opaque reference',
    inputs: { reference: { id: handle, sha256, scope: { ...scope } } },
    steps: [
      {
        key: 'reference',
        name: 'Use reference',
        target: 'HOST',
        capability: scope.capability,
        capabilityVersion: '1',
        arguments: { secretReferenceId: null },
        dependsOn: [],
        expectedEffect: 'WRITE',
        dataClass: 'confidential',
        mutation: true,
        idempotent: false,
        preconditions: { deviceId },
        budgets: {},
        stopConditions: {},
        inputBindings: [
          {
            targetPath: '/secretReferenceId',
            source: {
              kind: 'SECRET_REFERENCE',
              path: '',
              secretReferenceId: handle,
              secretReferenceSha256: sha256,
              scope,
            },
            dataClass: 'confidential',
            expectedType: 'string',
            expectedSchema: { type: 'string', minLength: 36, maxLength: 36 },
            transform: { name: 'IDENTITY', version: '1' },
          },
        ],
      },
    ],
  };
}

describe('Canonical routine binding persistence', () => {
  let registry: EphemeralSecretFingerprintRegistry;
  let guard: PersistenceSecretGuard;
  beforeEach(() => {
    registry = new EphemeralSecretFingerprintRegistry();
    guard = new PersistenceSecretGuard(registry);
  });

  it('keeps a scoped handle and exact null placeholder through API sanitization', () => {
    const input = template();
    expect(guard.sanitizeJson(input).value).not.toEqual(input);
    expect(validateScheduleTaskTemplate(input).steps[0].inputBindings).toEqual(
      input.steps[0].inputBindings,
    );
    expect(sanitizeScheduleTaskTemplate(input, guard)).toEqual(input);
  });

  it.each(['MsaidiziSchedule', 'MsaidiziScheduleVersion'])(
    'preserves canonical bindings at the %s Prisma boundary, including set updates',
    (model) => {
      const input = template();
      const params = { model, action: 'update', args: { data: { taskTemplate: { set: input } } } };
      sanitizeMsaidiziPersistenceWrite(params, guard);
      expect(params.args.data.taskTemplate.set).toEqual(input);
    },
  );

  it('does not treat a changed company scope as an omitted optional field', () => {
    const input = template();
    Object.assign(input.inputs.reference.scope, {
      companyId: '10000000-0000-4000-8000-000000000012',
    });
    Object.assign(input.steps[0].inputBindings[0].source.scope, {
      companyId: '10000000-0000-4000-8000-000000000013',
    });
    expect(() => sanitizeScheduleTaskTemplate(input, guard)).toThrow(
      'must be supplied in reviewed inputs',
    );
  });

  it.each([
    'raw-target',
    'bad-handle',
    'bad-digest',
    'missing-authority',
    'declared-handle',
    'declared-schema',
  ])('never restores unsafe canonical content: %s', (kind) => {
    const input = template();
    if (kind === 'raw-target')
      input.steps[0].arguments.secretReferenceId = 'actual-password-value' as never;
    if (kind === 'bad-handle')
      input.steps[0].inputBindings[0].source.secretReferenceId = 'actual-password-value';
    if (kind === 'bad-digest')
      input.steps[0].inputBindings[0].source.secretReferenceSha256 = 'a'.repeat(64);
    if (kind === 'missing-authority') input.inputs = {} as typeof input.inputs;
    if (kind === 'declared-handle') registry.register(handle);
    if (kind === 'declared-schema') {
      registry.register('runtime-secret-only');
      Object.assign(input.steps[0].inputBindings[0].expectedSchema, {
        enum: ['runtime-secret-only'],
      });
    }
    const params = {
      model: 'MsaidiziSchedule',
      action: 'create',
      args: { data: { taskTemplate: input } },
    };
    if (kind.startsWith('declared-')) {
      expect(() => sanitizeMsaidiziPersistenceWrite(params, guard)).toThrow(
        'DECLARED_EPHEMERAL_SECRET_AT_IMMUTABLE_BOUNDARY',
      );
    } else {
      expect(() => sanitizeMsaidiziPersistenceWrite(params, guard)).toThrow();
    }
  });
});
