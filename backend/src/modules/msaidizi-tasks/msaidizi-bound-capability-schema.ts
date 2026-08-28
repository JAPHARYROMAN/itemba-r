import { createHash } from 'node:crypto';
import type { MsaidiziInputBindingDto } from './dto/msaidizi-task.dto';

type JsonObject = Record<string, unknown>;

export interface BoundCapabilitySchemaIssue {
  code:
    | 'BINDING_TARGET_SCHEMA_MISSING'
    | 'BINDING_TARGET_SCHEMA_INCOMPATIBLE'
    | 'CAPABILITY_ARGUMENT_SCHEMA_MISMATCH'
    | 'CAPABILITY_SCHEMA_UNSUPPORTED';
  message: string;
}

/**
 * Validates the reviewed null-template and every declared post-resolution
 * binding against the exact selected ERP DTO or device-manifest schema.
 * Unrecognised dynamic mappings fail closed; static legacy arguments retain
 * their existing schema behavior.
 */
export function validateBoundCapabilityArguments(
  argumentsValue: JsonObject,
  bindings: readonly MsaidiziInputBindingDto[],
  capabilitySchema: JsonObject,
  planInputs: JsonObject = {},
): BoundCapabilitySchemaIssue[] {
  const issues: BoundCapabilitySchemaIssue[] = [];
  const materialized = cloneJson(argumentsValue);

  for (const binding of bindings) {
    const targetSchema = schemaAtPointer(capabilitySchema, binding.targetPath);
    if (!targetSchema) {
      issues.push({
        code: 'BINDING_TARGET_SCHEMA_MISSING',
        message: `Binding target ${binding.targetPath} is not declared by the capability schema`,
      });
      continue;
    }
    issues.push(...bindingCompatibilityIssues(binding, targetSchema, planInputs));
    const representative = representativeBindingValue(binding, targetSchema, planInputs);
    if (representative.ok) {
      pointerWrite(materialized, binding.targetPath, representative.value);
    } else {
      issues.push({ code: representative.code, message: representative.message });
    }
  }

  for (const message of validateCapabilityJsonSchema(materialized, capabilitySchema, 'arguments')) {
    issues.push({ code: 'CAPABILITY_ARGUMENT_SCHEMA_MISMATCH', message });
  }
  return deduplicateIssues(issues);
}

export function validateCapabilityJsonSchema(
  value: unknown,
  schema: JsonObject,
  path: string,
): string[] {
  const issues: string[] = [];
  if ('const' in schema && !deepEqual(value, schema.const)) {
    issues.push(`${path} differs from the required constant`);
  }
  const types = schemaTypes(schema);
  if (types.length > 0 && !types.some((type) => valueMatchesType(value, type))) {
    return [`${path} must match capability type ${types.join('|')}`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => deepEqual(value, item))) {
    issues.push(`${path} is outside the allowed enum`);
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      issues.push(`${path} is shorter than minLength`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      issues.push(`${path} is longer than maxLength`);
    }
    if (schema.format === 'uuid' && !isUuid(value)) issues.push(`${path} must be a UUID`);
    if (typeof schema.pattern === 'string') {
      const matches = safePatternMatches(schema.pattern, value);
      if (matches === false) issues.push(`${path} does not match the capability pattern`);
    }
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) issues.push(`${path} must be finite`);
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      issues.push(`${path} is below minimum`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      issues.push(`${path} is above maximum`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      issues.push(`${path} has too few items`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      issues.push(`${path} has too many items`);
    }
    if (isObject(schema.items)) {
      value.forEach((item, index) =>
        issues.push(
          ...validateCapabilityJsonSchema(item, schema.items as JsonObject, `${path}[${index}]`),
        ),
      );
    }
  }
  if (isObject(value)) {
    const properties = isObject(schema.properties) ? schema.properties : {};
    const required = stringArray(schema.required);
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key))
        issues.push(`${path}.${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          issues.push(`${path}.${key} is not allowed`);
        }
      }
    }
    for (const [key, child] of Object.entries(value)) {
      const childSchema = properties[key];
      if (isObject(childSchema)) {
        issues.push(...validateCapabilityJsonSchema(child, childSchema, `${path}.${key}`));
      }
    }
  }

  for (const branch of objectArray(schema.allOf)) {
    issues.push(...validateCapabilityJsonSchema(value, branch, path));
  }
  const anyOf = objectArray(schema.anyOf);
  if (
    anyOf.length > 0 &&
    !anyOf.some((branch) => validateCapabilityJsonSchema(value, branch, path).length === 0)
  ) {
    issues.push(`${path} does not match any allowed capability schema branch`);
  }
  const oneOf = objectArray(schema.oneOf);
  if (
    oneOf.length > 0 &&
    oneOf.filter((branch) => validateCapabilityJsonSchema(value, branch, path).length === 0)
      .length !== 1
  ) {
    issues.push(`${path} does not match exactly one capability schema branch`);
  }
  if (isObject(schema.not) && validateCapabilityJsonSchema(value, schema.not, path).length === 0) {
    issues.push(`${path} matches a forbidden capability schema branch`);
  }
  return issues;
}

function bindingCompatibilityIssues(
  binding: MsaidiziInputBindingDto,
  target: JsonObject,
  planInputs: JsonObject,
): BoundCapabilitySchemaIssue[] {
  const issues: BoundCapabilitySchemaIssue[] = [];
  const targetTypes = schemaTypes(target);
  if (!targetTypes.some((type) => typeAccepts(type, binding.expectedType))) {
    issues.push({
      code: 'BINDING_TARGET_SCHEMA_INCOMPATIBLE',
      message: `Binding ${binding.targetPath} expects ${binding.expectedType}, but the capability accepts ${targetTypes.join('|') || 'an undeclared type'}`,
    });
    return issues;
  }
  const expected = binding.expectedSchema;
  if ('const' in target && !schemaValuesConstrainedTo(expected, [target.const])) {
    issues.push(incompatible(binding, 'does not preserve the capability constant'));
  }
  if (Array.isArray(target.enum) && !schemaValuesConstrainedTo(expected, target.enum)) {
    issues.push(incompatible(binding, 'is wider than the capability enum'));
  }
  if (binding.expectedType === 'string') {
    if (
      typeof target.minLength === 'number' &&
      (typeof expected.minLength !== 'number' || expected.minLength < target.minLength)
    ) {
      issues.push(incompatible(binding, 'does not enforce the capability minLength'));
    }
    if (
      typeof target.maxLength === 'number' &&
      (typeof expected.maxLength !== 'number' || expected.maxLength > target.maxLength)
    ) {
      issues.push(incompatible(binding, 'does not enforce the capability maxLength'));
    }
    if (target.format === 'uuid' && !bindingGuaranteesUuid(binding, planInputs)) {
      issues.push(incompatible(binding, 'cannot prove the capability UUID format'));
    }
    if (
      typeof target.pattern === 'string' &&
      !bindingGuaranteesPattern(binding, target.pattern, planInputs)
    ) {
      issues.push({
        code: 'CAPABILITY_SCHEMA_UNSUPPORTED',
        message: `Binding ${binding.targetPath} cannot prove capability pattern ${target.pattern}`,
      });
    }
  }
  if (binding.expectedType === 'number' || binding.expectedType === 'integer') {
    if (
      typeof target.minimum === 'number' &&
      (typeof expected.minimum !== 'number' || expected.minimum < target.minimum)
    ) {
      issues.push(incompatible(binding, 'does not enforce the capability minimum'));
    }
    if (
      typeof target.maximum === 'number' &&
      (typeof expected.maximum !== 'number' || expected.maximum > target.maximum)
    ) {
      issues.push(incompatible(binding, 'does not enforce the capability maximum'));
    }
  }
  if (binding.expectedType === 'array') {
    if (
      typeof target.minItems === 'number' &&
      (typeof expected.minItems !== 'number' || expected.minItems < target.minItems)
    ) {
      issues.push(incompatible(binding, 'does not enforce the capability minItems'));
    }
    if (
      typeof target.maxItems === 'number' &&
      (typeof expected.maxItems !== 'number' || expected.maxItems > target.maxItems)
    ) {
      issues.push(incompatible(binding, 'does not enforce the capability maxItems'));
    }
    if (isObject(target.items) && isObject(expected.items)) {
      issues.push(...nestedSchemaCompatibility(binding, expected.items, target.items, 'items'));
    }
  }
  if (binding.expectedType === 'object') {
    issues.push(...nestedSchemaCompatibility(binding, expected, target, 'object'));
  }
  return issues;
}

function nestedSchemaCompatibility(
  binding: MsaidiziInputBindingDto,
  expected: JsonObject,
  target: JsonObject,
  label: string,
): BoundCapabilitySchemaIssue[] {
  const issues: BoundCapabilitySchemaIssue[] = [];
  const expectedProperties = isObject(expected.properties) ? expected.properties : {};
  const targetProperties = isObject(target.properties) ? target.properties : {};
  for (const required of stringArray(target.required)) {
    if (!stringArray(expected.required).includes(required)) {
      issues.push(incompatible(binding, `${label} may omit required field ${required}`));
    }
  }
  for (const [key, child] of Object.entries(expectedProperties)) {
    if (!isObject(targetProperties[key]) || !isObject(child)) {
      issues.push(incompatible(binding, `${label} field ${key} is not declared by the capability`));
      continue;
    }
    const expectedTypes = schemaTypes(child);
    const targetTypes = schemaTypes(targetProperties[key] as JsonObject);
    if (
      !expectedTypes.every((type) =>
        targetTypes.some((targetType) => typeAccepts(targetType, type)),
      )
    ) {
      issues.push(incompatible(binding, `${label} field ${key} has an incompatible type`));
    }
  }
  return issues;
}

function representativeBindingValue(
  binding: MsaidiziInputBindingDto,
  targetSchema: JsonObject,
  planInputs: JsonObject,
):
  | { ok: true; value: unknown }
  | { ok: false; code: BoundCapabilitySchemaIssue['code']; message: string } {
  if (binding.source.kind === 'SECRET_REFERENCE') {
    return { ok: true, value: binding.source.secretReferenceId };
  }
  if (binding.source.kind === 'PLAN_INPUT') {
    const source = pointerRead(planInputs, binding.source.path ?? '');
    if (!source.exists) {
      return {
        ok: false,
        code: 'BINDING_TARGET_SCHEMA_INCOMPATIBLE',
        message: `Binding ${binding.targetPath} plan input is unavailable for schema validation`,
      };
    }
    return { ok: true, value: applyTransform(source.value, binding.transform.name) };
  }
  const expected = binding.expectedSchema;
  if ('const' in expected) return { ok: true, value: cloneJson(expected.const) };
  if (Array.isArray(expected.enum) && expected.enum.length > 0) {
    return { ok: true, value: cloneJson(expected.enum[0]) };
  }
  const value = representativeForSchema(expected, targetSchema, binding);
  return value === undefined
    ? {
        ok: false,
        code: 'CAPABILITY_SCHEMA_UNSUPPORTED',
        message: `Binding ${binding.targetPath} has no safe representative for capability validation`,
      }
    : { ok: true, value };
}

function representativeForSchema(
  schema: JsonObject,
  target: JsonObject,
  binding: MsaidiziInputBindingDto,
): unknown {
  if ('const' in schema) return cloneJson(schema.const);
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return cloneJson(schema.enum[0]);
  switch (binding.expectedType) {
    case 'string': {
      if (target.format === 'uuid')
        return binding.source.kind === 'SECRET_REFERENCE'
          ? binding.source.secretReferenceId
          : '00000000-0000-4000-8000-000000000000';
      if (binding.transform.name === 'SHA256_HEX') return '0'.repeat(64);
      if (target.pattern === '^[a-f0-9]{64}$') return '0'.repeat(64);
      if (target.pattern === '^[A-F0-9]{64}$') return '0'.repeat(64).toUpperCase();
      if (target.pattern === '^[A-Za-z0-9._-]{1,80}$') return 'x';
      if (target.pattern === '^[A-Z]{3}$') return 'USD';
      const minimum = typeof schema.minLength === 'number' ? Math.max(0, schema.minLength) : 0;
      return 'x'.repeat(minimum);
    }
    case 'integer':
    case 'number': {
      const minimum = typeof schema.minimum === 'number' ? schema.minimum : 0;
      return binding.expectedType === 'integer' ? Math.ceil(minimum) : minimum;
    }
    case 'boolean':
      return false;
    case 'null':
      return null;
    case 'array': {
      const count = typeof schema.minItems === 'number' ? schema.minItems : 0;
      if (!isObject(schema.items)) return [];
      const childBinding = {
        ...binding,
        expectedType: schemaType(schema.items),
      } as MsaidiziInputBindingDto;
      const child = representativeForSchema(
        schema.items,
        isObject(target.items) ? target.items : {},
        childBinding,
      );
      return Array.from({ length: count }, () => cloneJson(child));
    }
    case 'object': {
      const result: JsonObject = {};
      const properties = isObject(schema.properties) ? schema.properties : {};
      const targetProperties = isObject(target.properties) ? target.properties : {};
      for (const key of stringArray(schema.required)) {
        const child = properties[key];
        if (!isObject(child)) return undefined;
        const childBinding = {
          ...binding,
          expectedType: schemaType(child),
        } as MsaidiziInputBindingDto;
        result[key] = representativeForSchema(
          child,
          isObject(targetProperties[key]) ? (targetProperties[key] as JsonObject) : {},
          childBinding,
        );
      }
      return result;
    }
    default:
      return undefined;
  }
}

function schemaAtPointer(schema: JsonObject, pointer: string): JsonObject | null {
  let current = schema;
  for (const token of pointerTokens(pointer)) {
    const types = schemaTypes(current);
    if (types.includes('object')) {
      const properties = isObject(current.properties) ? current.properties : {};
      const next = properties[token];
      if (!isObject(next)) return null;
      current = next;
      continue;
    }
    if (types.includes('array') && /^(?:0|[1-9]\d*)$/.test(token) && isObject(current.items)) {
      current = current.items;
      continue;
    }
    return null;
  }
  return current;
}

function bindingGuaranteesUuid(binding: MsaidiziInputBindingDto, planInputs: JsonObject): boolean {
  if (binding.source.kind === 'SECRET_REFERENCE')
    return isUuid(binding.source.secretReferenceId ?? '');
  return constrainedStrings(binding, planInputs)?.every(isUuid) === true;
}

function bindingGuaranteesPattern(
  binding: MsaidiziInputBindingDto,
  pattern: string,
  planInputs: JsonObject,
): boolean {
  if (pattern === '^[a-f0-9]{64}$' && binding.transform.name === 'SHA256_HEX') return true;
  const values = constrainedStrings(binding, planInputs);
  return values?.every((value) => safePatternMatches(pattern, value) === true) === true;
}

function constrainedStrings(
  binding: MsaidiziInputBindingDto,
  planInputs: JsonObject,
): string[] | null {
  if (binding.source.kind === 'SECRET_REFERENCE') return [binding.source.secretReferenceId ?? ''];
  if (binding.source.kind === 'PLAN_INPUT') {
    const source = pointerRead(planInputs, binding.source.path ?? '');
    if (!source.exists) return null;
    const transformed = applyTransform(source.value, binding.transform.name);
    return typeof transformed === 'string' ? [transformed] : null;
  }
  if (typeof binding.expectedSchema.const === 'string') return [binding.expectedSchema.const];
  if (
    Array.isArray(binding.expectedSchema.enum) &&
    binding.expectedSchema.enum.every((item) => typeof item === 'string')
  ) {
    return binding.expectedSchema.enum as string[];
  }
  return null;
}

function schemaValuesConstrainedTo(schema: JsonObject, allowed: unknown[]): boolean {
  if ('const' in schema) return allowed.some((item) => deepEqual(item, schema.const));
  return (
    Array.isArray(schema.enum) &&
    schema.enum.length > 0 &&
    schema.enum.every((candidate) => allowed.some((item) => deepEqual(item, candidate)))
  );
}

function safePatternMatches(pattern: string, value: string): boolean | null {
  switch (pattern) {
    case '^[a-f0-9]{64}$':
      return /^[a-f0-9]{64}$/.test(value);
    case '^[A-F0-9]{64}$':
      return /^[A-F0-9]{64}$/.test(value);
    case '^[A-Za-z0-9._-]{1,80}$':
      return /^[A-Za-z0-9._-]{1,80}$/.test(value);
    case '^[A-Z]{3}$':
      return /^[A-Z]{3}$/.test(value);
    default:
      return null;
  }
}

function applyTransform(
  value: unknown,
  transform: MsaidiziInputBindingDto['transform']['name'],
): unknown {
  switch (transform) {
    case 'IDENTITY':
      return cloneJson(value);
    case 'JSON_STRINGIFY':
      return stableJson(value);
    case 'SHA256_HEX':
      return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
    case 'BASE64URL':
      return Buffer.from(stableJson(value), 'utf8').toString('base64url');
  }
}

function schemaTypes(schema: JsonObject): string[] {
  if (typeof schema.type === 'string') return [schema.type];
  if (Array.isArray(schema.type))
    return schema.type.filter((item): item is string => typeof item === 'string');
  if ('const' in schema) return [jsonType(schema.const)];
  return [];
}

function schemaType(schema: JsonObject): MsaidiziInputBindingDto['expectedType'] {
  const type = schemaTypes(schema)[0];
  return ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'].includes(type)
    ? (type as MsaidiziInputBindingDto['expectedType'])
    : 'null';
}

function typeAccepts(target: string, expected: string): boolean {
  return target === expected || (target === 'number' && expected === 'integer');
}

function valueMatchesType(value: unknown, type: string): boolean {
  const actual = jsonType(value);
  return actual === type || (type === 'number' && actual === 'integer');
}

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  return typeof value;
}

function pointerRead(root: unknown, pointer: string): { exists: boolean; value: unknown } {
  if (pointer === '') return { exists: true, value: root };
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
  }
  (current as JsonObject)[tokens[tokens.length - 1]] = value;
}

function pointerTokens(pointer: string): string[] {
  if (!pointer.startsWith('/')) return [];
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function incompatible(
  binding: MsaidiziInputBindingDto,
  detail: string,
): BoundCapabilitySchemaIssue {
  return {
    code: 'BINDING_TARGET_SCHEMA_INCOMPATIBLE',
    message: `Binding ${binding.targetPath} ${detail}`,
  };
}

function deduplicateIssues(issues: BoundCapabilitySchemaIssue[]): BoundCapabilitySchemaIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}\0${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function objectArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value as JsonObject)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson((value as JsonObject)[key])}`)
    .join(',')}}`;
}
