import type { PersistenceSecretGuard } from '../../common/services/persistence-secret-guard.service';
import { restoreBoundNullPlaceholders } from '../msaidizi-tasks/msaidizi-binding-authority';
import { validateScheduleTaskTemplate } from './msaidizi-schedule-template';

/** Shared by schedule APIs and the final Prisma boundary, including version history. */
export function sanitizeScheduleTaskTemplate(
  value: unknown,
  secrets: PersistenceSecretGuard,
): unknown {
  if (isRecord(value) && Object.keys(value).length === 1 && 'set' in value) {
    return { set: sanitizeScheduleTaskTemplate(value.set, secrets) };
  }
  const sanitized = secrets.sanitizeJson(value).value;
  const hasBindings =
    isRecord(value) &&
    Array.isArray(value.steps) &&
    value.steps.some(
      (step) =>
        isRecord(step) && Array.isArray(step.inputBindings) && step.inputBindings.length > 0,
    );
  if (!hasBindings) return sanitized;

  // Fail rather than rewrite a canonical definition containing declared secret
  // bytes. Validation precedes every restoration; a binding cannot hide a raw
  // value at its target, introduce an undeclared source, or carry an arbitrary handle.
  const validated = validateScheduleTaskTemplate(value);
  secrets.assertNoDeclaredSecretJson(value);
  if (!isRecord(sanitized) || !Array.isArray(sanitized.steps)) {
    throw new Error('Validated schedule template lost its structural shape during sanitization');
  }
  sanitized.steps = sanitized.steps.map((step, index) => {
    if (!isRecord(step)) throw new Error('Validated schedule step lost its structural shape');
    const original = validated.steps[index];
    return {
      ...step,
      arguments: restoreBoundNullPlaceholders(
        step.arguments,
        original.arguments,
        original.inputBindings,
      ),
      inputBindings: JSON.parse(JSON.stringify(original.inputBindings)),
    };
  });
  return sanitized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
