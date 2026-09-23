import { Prisma } from '@prisma/client';
import { parsePersistedInputBindings } from '../msaidizi-tasks/msaidizi-input-bindings';
import { parseDependencyLineage } from '../msaidizi-tasks/msaidizi-dependency-lineage';

/** Model-facing metadata only: no source values, secret handles, schemas or historical IDs. */
export function runtimeBindingContext(step: {
  inputBindings?: Prisma.JsonValue;
  dependencyLineage?: Prisma.JsonValue;
}) {
  try {
    const bindings = parsePersistedInputBindings(
      step.inputBindings === undefined ? [] : step.inputBindings,
    );
    const pins = parseDependencyLineage(step.dependencyLineage);
    return {
      status: 'VALID' as const,
      resolutionOwner: 'EXECUTOR' as const,
      lockedTargets: bindings.map((binding) => ({
        targetPath: binding.targetPath,
        modelFillAllowed: false,
        expectedType: binding.expectedType,
        transform: { name: binding.transform.name, version: binding.transform.version },
        sourceKind: binding.source.kind,
        ...(binding.source.dependencyStepKey
          ? {
              sourceStepKey: binding.source.dependencyStepKey,
              sourceScope: pins.some(
                (pin) => pin.dependencyStepKey === binding.source.dependencyStepKey,
              )
                ? 'PINNED_PRIOR_PLAN'
                : 'CURRENT_PLAN',
            }
          : {}),
      })),
    };
  } catch {
    // Corrupt metadata cannot enter model context as purported instructions.
    return { status: 'INVALID' as const, resolutionOwner: 'EXECUTOR' as const, lockedTargets: [] };
  }
}
