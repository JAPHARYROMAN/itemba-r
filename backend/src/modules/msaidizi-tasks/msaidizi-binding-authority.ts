import type { MsaidiziInputBindingDto } from './dto/msaidizi-task.dto';

type JsonObject = Record<string, unknown>;

export interface BindingAuthorityStep {
  key: string;
  arguments: JsonObject;
  inputBindings?: readonly MsaidiziInputBindingDto[];
}

export interface BindingAuthorityIssue {
  code: 'INPUT_BINDING_AUTHORITY_SOURCE_MISSING';
  message: string;
  stepKey: string;
}

/** Secret handles and fixed artifact selectors must originate in reviewed inputs. */
export function bindingAuthorityIssues(
  steps: readonly BindingAuthorityStep[],
  planInputs: JsonObject,
): BindingAuthorityIssue[] {
  const issues: BindingAuthorityIssue[] = [];
  for (const step of steps) {
    for (const binding of step.inputBindings ?? []) {
      if (
        binding.source.kind === 'SECRET_REFERENCE' &&
        !containsReferenceAuthority(planInputs, {
          id: binding.source.secretReferenceId,
          sha256: binding.source.secretReferenceSha256,
          scope: binding.source.scope,
        })
      ) {
        issues.push({
          code: 'INPUT_BINDING_AUTHORITY_SOURCE_MISSING',
          message:
            `Step ${step.key} secret reference must be supplied in reviewed inputs as ` +
            '{id, sha256, scope}',
          stepKey: step.key,
        });
      }
      if (
        binding.source.kind === 'DEPENDENCY_ARTIFACT' &&
        binding.source.artifactId &&
        !containsScalar(planInputs, binding.source.artifactId)
      ) {
        issues.push({
          code: 'INPUT_BINDING_AUTHORITY_SOURCE_MISSING',
          message: `Step ${step.key} fixed artifact selector was not supplied in reviewed inputs`,
          stepKey: step.key,
        });
      }
    }
  }
  return issues;
}

/**
 * Projection used only for DLP inspection. It removes exact reviewed null
 * placeholders and opaque reference handles while leaving every other value,
 * schema, transform, and scope visible to the ordinary secret detector.
 */
export function bindingSafeDlpProjection<T extends { steps?: unknown }>(value: T): T {
  const cloned = cloneJson(value) as T & { steps?: unknown };
  if (!Array.isArray(cloned.steps)) return cloned;
  cloned.steps = cloned.steps.map((raw) => {
    if (!isObject(raw)) return raw;
    const step = cloneJson(raw);
    const bindings = Array.isArray(step.inputBindings) ? step.inputBindings.filter(isObject) : [];
    if (isObject(step.arguments)) {
      for (const binding of bindings) {
        if (typeof binding.targetPath === 'string') {
          pointerDelete(step.arguments, binding.targetPath);
        }
      }
    }
    step.inputBindings = bindings.map((binding) => {
      const next = cloneJson(binding);
      if (isObject(next.source) && next.source.kind === 'SECRET_REFERENCE') {
        delete next.source.secretReferenceId;
        delete next.source.secretReferenceSha256;
      }
      return next;
    });
    return step;
  });
  return cloned;
}

/** Restore only reviewed null targets after generic key-name DLP. */
export function restoreBoundNullPlaceholders<T>(
  sanitizedArguments: T,
  originalArguments: unknown,
  bindings: readonly Pick<MsaidiziInputBindingDto, 'targetPath'>[],
): T {
  if (!isObject(sanitizedArguments) || !isObject(originalArguments)) return sanitizedArguments;
  for (const binding of bindings) {
    const original = pointerRead(originalArguments, binding.targetPath);
    if (original.exists && original.value === null) {
      pointerWrite(sanitizedArguments, binding.targetPath, null);
    }
  }
  return sanitizedArguments;
}

function containsReferenceAuthority(
  value: unknown,
  expected: { id?: string; sha256?: string; scope?: unknown },
  depth = 0,
): boolean {
  if (depth > 20) return false;
  if (Array.isArray(value)) {
    return value.some((item) => containsReferenceAuthority(item, expected, depth + 1));
  }
  if (!isObject(value)) return false;
  if (
    value.id === expected.id &&
    value.sha256 === expected.sha256 &&
    canonicalJson(value.scope) === canonicalJson(expected.scope)
  ) {
    return true;
  }
  return Object.values(value).some((item) => containsReferenceAuthority(item, expected, depth + 1));
}

function containsScalar(value: unknown, expected: string, depth = 0): boolean {
  if (depth > 20) return false;
  if (value === expected) return true;
  if (Array.isArray(value)) return value.some((item) => containsScalar(item, expected, depth + 1));
  return (
    isObject(value) &&
    Object.values(value).some((item) => containsScalar(item, expected, depth + 1))
  );
}

function pointerRead(root: unknown, pointer: string): { exists: boolean; value: unknown } {
  let current = root;
  for (const token of pointerTokens(pointer)) {
    if (
      (!isObject(current) && !Array.isArray(current)) ||
      !Object.prototype.hasOwnProperty.call(current, token)
    ) {
      return { exists: false, value: undefined };
    }
    current = (current as JsonObject)[token];
  }
  return { exists: true, value: current };
}

function pointerWrite(root: JsonObject, pointer: string, value: unknown): void {
  const tokens = pointerTokens(pointer);
  let current: unknown = root;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    current = (current as JsonObject)[tokens[index]];
    if (!isObject(current) && !Array.isArray(current)) return;
  }
  if (tokens.length > 0 && (isObject(current) || Array.isArray(current))) {
    (current as JsonObject)[tokens[tokens.length - 1]] = value;
  }
}

function pointerDelete(root: JsonObject, pointer: string): void {
  const tokens = pointerTokens(pointer);
  let current: unknown = root;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    current = (current as JsonObject)[tokens[index]];
    if (!isObject(current) && !Array.isArray(current)) return;
  }
  if (tokens.length > 0 && (isObject(current) || Array.isArray(current))) {
    delete (current as JsonObject)[tokens[tokens.length - 1]];
  }
}

function pointerTokens(pointer: string): string[] {
  if (!pointer.startsWith('/')) return [];
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
