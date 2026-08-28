/**
 * Small, runtime JSON-schema projection for controller DTO parameters.
 *
 * Nest already retains the DTO constructor in `design:paramtypes`, while
 * class-validator and Swagger retain the field-level contract.  The capability
 * manifest joins those sources so Msaidizi can describe the same request shape
 * that the global ValidationPipe enforces instead of advertising an unbounded
 * object and waiting for a loopback 400.
 *
 * This is deliberately a projection, not a second validator.  The HTTP request
 * still goes through Nest's real ValidationPipe and guards.  When metadata is
 * incomplete we report `partial`/`opaque` and keep that portion open rather
 * than pretending the schema is authoritative.
 */

import { getMetadataStorage } from 'class-validator';
import 'reflect-metadata';

type RuntimeConstructor = abstract new (...args: never[]) => unknown;

export type RequestSchemaQuality = 'strict' | 'partial' | 'opaque';

export interface JsonObjectSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: boolean;
}

export interface DerivedDtoSchema {
  schema: JsonObjectSchema;
  quality: RequestSchemaQuality;
  /** Metadata sources that contributed fields or constraints. */
  sources: Array<'class-validator' | 'openapi' | 'design-type' | 'class-transformer'>;
  /** DTO class name, safe to expose in diagnostics and coverage reports. */
  dtoName: string;
}

interface ValidationMetadataLike {
  propertyName: string;
  type: string;
  name?: string;
  constraints?: unknown[];
  each?: boolean;
}

interface TransformerTypeMetadata {
  reflectedType?: RuntimeConstructor;
  typeFunction?: () => RuntimeConstructor;
}

interface TransformerMetadataStorage {
  findTypeMetadata(
    target: RuntimeConstructor,
    propertyName: string,
  ): TransformerTypeMetadata | undefined;
}

const OPENAPI_MODEL_PROPERTIES = 'swagger/apiModelProperties';
const OPENAPI_MODEL_PROPERTIES_ARRAY = 'swagger/apiModelPropertiesArray';
const MAX_SCHEMA_DEPTH = 8;

const cache = new WeakMap<RuntimeConstructor, DerivedDtoSchema | null>();

let transformerStorage: TransformerMetadataStorage | undefined;
try {
  // class-transformer does not export this registry from its public entrypoint,
  // but @Type metadata is the only runtime source for an array's element DTO.
  // Keep the import optional: schema extraction must never stop application
  // startup when class-transformer's internal layout changes.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const storageModule = require('class-transformer/cjs/storage') as {
    defaultMetadataStorage?: TransformerMetadataStorage;
  };
  transformerStorage = storageModule.defaultMetadataStorage;
} catch {
  transformerStorage = undefined;
}

/** Returns a closed DTO schema when runtime metadata can identify its fields. */
export function deriveDtoSchema(type: unknown): DerivedDtoSchema | undefined {
  if (typeof type !== 'function' || isOpaqueRuntimeType(type as RuntimeConstructor)) {
    return undefined;
  }

  const constructor = type as RuntimeConstructor;

  const cached = cache.get(constructor);
  if (cached !== undefined) return cached ?? undefined;

  // Seed before recursion so self-referential DTOs degrade safely instead of
  // recursing forever. The finished value replaces this marker below.
  cache.set(constructor, null);
  const derived = deriveDtoSchemaAtDepth(constructor, 0, new Set());
  cache.set(constructor, derived ?? null);
  return derived;
}

function deriveDtoSchemaAtDepth(
  type: RuntimeConstructor,
  depth: number,
  ancestors: Set<RuntimeConstructor>,
): DerivedDtoSchema | undefined {
  if (depth > MAX_SCHEMA_DEPTH || ancestors.has(type)) return undefined;

  const validation = getMetadataStorage().getTargetValidationMetadatas(
    type,
    '',
    true,
    false,
  ) as ValidationMetadataLike[];
  const validationByProperty = groupValidation(validation);
  const openApiProperties = swaggerPropertyNames(type);
  const propertyNames = new Set<string>([...validationByProperty.keys(), ...openApiProperties]);

  if (propertyNames.size === 0) return undefined;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const sources = new Set<DerivedDtoSchema['sources'][number]>();
  let quality: RequestSchemaQuality = 'strict';
  const nextAncestors = new Set(ancestors).add(type);

  for (const propertyName of [...propertyNames].sort()) {
    const validators = validationByProperty.get(propertyName) ?? [];
    const openApi = readSwaggerProperty(type, propertyName);
    const projected = projectProperty(
      type,
      propertyName,
      validators,
      openApi,
      depth,
      nextAncestors,
    );

    properties[propertyName] = projected.schema;
    projected.sources.forEach((source) => sources.add(source));
    if (projected.quality !== 'strict') quality = 'partial';

    const conditionalValidators = validators.filter(
      (entry) => entry.type === 'conditionalValidation',
    );
    const optionalByValidator = conditionalValidators.length > 0;
    if (conditionalValidators.some((entry) => entry.name !== 'isOptional')) quality = 'partial';
    const requiredByOpenApi = openApi?.required;
    if (requiredByOpenApi === true || (!optionalByValidator && requiredByOpenApi !== false)) {
      required.push(propertyName);
    }
  }

  return {
    schema: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      // A property absent from the DTO is rejected by the production
      // ValidationPipe (`whitelist` + `forbidNonWhitelisted`).
      additionalProperties: false,
    },
    quality,
    sources: [...sources].sort(),
    dtoName: type.name || 'AnonymousDto',
  };
}

function groupValidation(
  metadata: ValidationMetadataLike[],
): Map<string, ValidationMetadataLike[]> {
  const grouped = new Map<string, ValidationMetadataLike[]>();
  for (const entry of metadata) {
    const entries = grouped.get(entry.propertyName) ?? [];
    entries.push(entry);
    grouped.set(entry.propertyName, entries);
  }
  return grouped;
}

function swaggerPropertyNames(type: RuntimeConstructor): string[] {
  const inherited = Reflect.getMetadata(
    OPENAPI_MODEL_PROPERTIES_ARRAY,
    type.prototype as object,
  ) as unknown;
  return Array.isArray(inherited)
    ? inherited
        .filter((key): key is string => typeof key === 'string')
        .map((key) => key.replace(/^:/, ''))
    : [];
}

function readSwaggerProperty(
  type: RuntimeConstructor,
  propertyName: string,
): Record<string, unknown> | undefined {
  const metadata = Reflect.getMetadata(
    OPENAPI_MODEL_PROPERTIES,
    type.prototype as object,
    propertyName,
  ) as unknown;
  return isRecord(metadata) ? metadata : undefined;
}

function projectProperty(
  owner: RuntimeConstructor,
  propertyName: string,
  validators: ValidationMetadataLike[],
  openApi: Record<string, unknown> | undefined,
  depth: number,
  ancestors: Set<RuntimeConstructor>,
): {
  schema: Record<string, unknown>;
  quality: RequestSchemaQuality;
  sources: Set<DerivedDtoSchema['sources'][number]>;
} {
  const sources = new Set<DerivedDtoSchema['sources'][number]>();
  if (validators.length > 0) sources.add('class-validator');
  if (openApi) sources.add('openapi');

  const reflected = Reflect.getMetadata('design:type', owner.prototype as object, propertyName) as
    | RuntimeConstructor
    | undefined;
  if (reflected) sources.add('design-type');

  const transformerType = transformerStorage?.findTypeMetadata(owner, propertyName);
  const explicitNestedType = safeTypeFunction(transformerType?.typeFunction);
  if (explicitNestedType) sources.add('class-transformer');

  const schema: Record<string, unknown> = {};
  applySwaggerMetadata(schema, openApi);

  const validatorType = typeFromValidators(validators);
  const swaggerType = typeFromSwagger(openApi);
  const reflectedType = jsonTypeForConstructor(reflected);
  const type = validatorType ?? swaggerType ?? reflectedType;
  if (type) schema.type = type;

  // Constraints declared with `{ each: true }` describe array elements, not
  // the array container. Project them into `items` below.
  applyValidationConstraints(
    schema,
    validators.filter((entry) => entry.each !== true),
  );

  const appliesToEach = validators.some((entry) => entry.each === true);
  const isArray = schema.type === 'array' || reflected === Array;
  if (isArray) {
    schema.type = 'array';
    const itemValidators = appliesToEach ? validators.filter((entry) => entry.each === true) : [];
    const nestedType = explicitNestedType ?? nestedSwaggerType(openApi);
    const nested = nestedType
      ? deriveDtoSchemaAtDepth(nestedType, depth + 1, ancestors)
      : undefined;

    if (nested) {
      schema.items = nested.schema;
      return {
        schema,
        quality: nested.quality,
        sources: mergeSources(sources, nested.sources),
      };
    }

    const itemSchema: Record<string, unknown> = {};
    applyValidationConstraints(itemSchema, itemValidators);
    const itemType = typeFromValidators(itemValidators);
    if (itemType && !itemSchema.type) itemSchema.type = itemType;
    const itemIsRepresented =
      itemType !== undefined ||
      'enum' in itemSchema ||
      '$ref' in itemSchema ||
      'allOf' in itemSchema;
    schema.items = itemIsRepresented ? itemSchema : { type: 'object', additionalProperties: true };
    return { schema, quality: itemIsRepresented ? 'strict' : 'partial', sources };
  }

  const nestedType =
    explicitNestedType ??
    nestedSwaggerType(openApi) ??
    (reflected && !isOpaqueRuntimeType(reflected) && !jsonTypeForConstructor(reflected)
      ? reflected
      : undefined);
  if (nestedType) {
    const nested = deriveDtoSchemaAtDepth(nestedType, depth + 1, ancestors);
    if (nested) {
      Object.assign(schema, nested.schema);
      return {
        schema,
        quality: nested.quality,
        sources: mergeSources(sources, nested.sources),
      };
    }
  }

  if (schema.type === 'object' && !('properties' in schema)) {
    schema.additionalProperties = true;
    // @IsObject is the complete runtime contract for an intentionally
    // free-form JSON object: the global pipe rejects non-objects, while nested
    // keys are deliberately unconstrained because there is no @ValidateNested
    // DTO. Representing that as `{ type: object, additionalProperties: true }`
    // is exact, not a metadata gap. A bare reflected `Object`, by contrast,
    // remains partial because it tells us nothing about whether arbitrary keys
    // are really accepted.
    const explicitlyFreeForm = validators.some((entry) => entry.name === 'isObject');
    return { schema, quality: explicitlyFreeForm ? 'strict' : 'partial', sources };
  }

  if (!schema.type && !('enum' in schema) && !('$ref' in schema) && !('allOf' in schema)) {
    return { schema, quality: 'partial', sources };
  }

  return { schema, quality: 'strict', sources };
}

function applySwaggerMetadata(
  target: Record<string, unknown>,
  metadata: Record<string, unknown> | undefined,
): void {
  if (!metadata) return;
  const allowed = [
    'description',
    'format',
    'default',
    'example',
    'minimum',
    'maximum',
    'minLength',
    'maxLength',
    'pattern',
    'minItems',
    'maxItems',
    'uniqueItems',
  ] as const;
  for (const key of allowed) {
    if (metadata[key] !== undefined) target[key] = metadata[key];
  }

  if (Array.isArray(metadata.enum)) target.enum = enumValues(metadata.enum);
}

function applyValidationConstraints(
  target: Record<string, unknown>,
  validators: ValidationMetadataLike[],
): void {
  for (const validator of validators) {
    const first = validator.constraints?.[0];
    switch (validator.name) {
      case 'isUUID':
      case 'isUuid':
        target.type = 'string';
        target.format = 'uuid';
        break;
      case 'isEmail':
        target.type = 'string';
        target.format = 'email';
        break;
      case 'isUrl':
        target.type = 'string';
        target.format = 'uri';
        break;
      case 'isDateString':
      case 'isISO8601':
        target.type = 'string';
        target.format = 'date-time';
        break;
      case 'isEnum':
      case 'isIn': {
        const values = enumValues(
          validator.name === 'isEnum'
            ? (validator.constraints?.[1] ?? validator.constraints?.[0])
            : validator.constraints?.[0],
        );
        if (values.length > 0) {
          target.enum = values;
          target.type = values.every((value) => typeof value === 'number') ? 'number' : 'string';
        }
        break;
      }
      case 'min':
        if (typeof first === 'number') target.minimum = first;
        break;
      case 'max':
        if (typeof first === 'number') target.maximum = first;
        break;
      case 'minLength':
        if (typeof first === 'number') target.minLength = first;
        break;
      case 'maxLength':
        if (typeof first === 'number') target.maxLength = first;
        break;
      case 'arrayMinSize':
        if (typeof first === 'number') target.minItems = first;
        break;
      case 'arrayMaxSize':
        if (typeof first === 'number') target.maxItems = first;
        break;
      case 'arrayUnique':
        target.uniqueItems = true;
        break;
      case 'matches':
        if (first instanceof RegExp) target.pattern = first.source;
        break;
      case 'isPositive':
        target.exclusiveMinimum = 0;
        break;
      case 'isNegative':
        target.exclusiveMaximum = 0;
        break;
      default:
        break;
    }
  }
}

function typeFromValidators(metadata: ValidationMetadataLike[]): string | undefined {
  const names = new Set(metadata.map((entry) => entry.name));
  if (names.has('isArray')) return 'array';
  if (names.has('isBoolean')) return 'boolean';
  if (names.has('isInt')) return 'integer';
  if (names.has('isNumber') || names.has('isDecimal') || names.has('isPositive')) return 'number';
  if (names.has('isObject')) return 'object';
  if (
    [...names].some((name) =>
      [
        'isString',
        'isUUID',
        'isUuid',
        'isEmail',
        'isUrl',
        'isDateString',
        'isISO8601',
        'matches',
      ].includes(name ?? ''),
    )
  ) {
    return 'string';
  }
  return undefined;
}

function typeFromSwagger(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return undefined;
  if (metadata.isArray === true || Array.isArray(metadata.type)) return 'array';
  if (typeof metadata.type === 'string') return metadata.type.toLowerCase();
  if (typeof metadata.type === 'function') {
    const raw = metadata.type;
    const resolved =
      raw.name === 'type'
        ? safeTypeFunction(raw as unknown as () => RuntimeConstructor)
        : (raw as unknown as RuntimeConstructor);
    return jsonTypeForConstructor(resolved);
  }
  return undefined;
}

function nestedSwaggerType(
  metadata: Record<string, unknown> | undefined,
): RuntimeConstructor | undefined {
  if (!metadata) return undefined;
  const raw = Array.isArray(metadata.type) ? metadata.type[0] : metadata.type;
  if (typeof raw !== 'function') return undefined;
  const resolved =
    raw.name === 'type'
      ? safeTypeFunction(raw as () => RuntimeConstructor)
      : (raw as RuntimeConstructor);
  return resolved && !isOpaqueRuntimeType(resolved) && !jsonTypeForConstructor(resolved)
    ? resolved
    : undefined;
}

function safeTypeFunction(
  factory: (() => RuntimeConstructor) | undefined,
): RuntimeConstructor | undefined {
  if (!factory) return undefined;
  try {
    const value = factory();
    return typeof value === 'function' ? value : undefined;
  } catch {
    return undefined;
  }
}

function jsonTypeForConstructor(type: RuntimeConstructor | undefined): string | undefined {
  if (type === String) return 'string';
  if (type === Number) return 'number';
  if (type === Boolean) return 'boolean';
  if (type === Array) return 'array';
  if (type === Object) return 'object';
  return undefined;
}

function isOpaqueRuntimeType(type: RuntimeConstructor): boolean {
  return (
    type === String ||
    type === Number ||
    type === Boolean ||
    type === Array ||
    type === Object ||
    type === Function ||
    type === Promise
  );
}

function enumValues(value: unknown): Array<string | number | boolean> {
  const raw = Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];
  const primitive = raw.filter(
    (entry): entry is string | number | boolean =>
      typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean',
  );
  // Numeric TypeScript enums contain a reverse name mapping. When numbers are
  // present, the string names are not valid wire values.
  const withoutReverseNames = primitive.some((entry) => typeof entry === 'number')
    ? primitive.filter((entry) => typeof entry === 'number')
    : primitive;
  return [...new Set(withoutReverseNames)];
}

function mergeSources(
  target: Set<DerivedDtoSchema['sources'][number]>,
  additions: DerivedDtoSchema['sources'],
): Set<DerivedDtoSchema['sources'][number]> {
  additions.forEach((source) => target.add(source));
  return target;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
