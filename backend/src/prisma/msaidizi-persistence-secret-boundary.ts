import { Prisma } from '@prisma/client';
import { PersistenceSecretGuard } from '../common/services/persistence-secret-guard.service';
import { restoreBoundNullPlaceholders } from '../modules/msaidizi-tasks/msaidizi-binding-authority';

type FieldPolicy = Readonly<{
  text?: readonly string[];
  json?: readonly string[];
  rejectText?: readonly string[];
  rejectJson?: readonly string[];
}>;

/**
 * Closed list of user/model/tool-authored fields that may reach durable
 * Msaidizi or audit storage. Opaque ciphertext, identifiers, digests,
 * signatures and signed manifests are deliberately absent: changing those at
 * the Prisma boundary would corrupt protocol evidence instead of sanitising
 * its plaintext source.
 */
export const MSAIDIZI_PERSISTENCE_SECRET_FIELDS: Readonly<Record<string, FieldPolicy>> = {
  MsaidiziProcedure: {
    text: ['name', 'instruction'],
    json: ['capabilities'],
  },
  MsaidiziConversation: { text: ['title'] },
  MsaidiziConversationTurn: { text: ['prompt'] },
  MsaidiziPrincipal: { text: ['displayName'], json: ['grants'] },
  MsaidiziTask: { text: ['title', 'objective', 'statusDetail'] },
  MsaidiziPlanVersion: {
    text: ['summary', 'objective'],
    json: ['inputs', 'stopConditions', 'budgetSnapshot'],
  },
  MsaidiziTaskStep: {
    text: ['name'],
    json: ['arguments', 'dependencies', 'preconditions', 'recovery', 'budgets', 'stopConditions'],
    // Canonical binding definitions may contain an opaque UUID secret handle.
    // Rewriting it under the generic sensitive-key heuristic would invalidate
    // the reviewed plan; the immutable-boundary guard still rejects any actual
    // process-declared secret bytes.
    rejectJson: ['inputBindings'],
  },
  MsaidiziToolAttempt: {
    text: ['rejectionReason', 'errorMessage'],
    json: ['argumentsRedacted', 'resultSummary'],
    rejectJson: ['resolvedInputProvenance'],
  },
  MsaidiziReasoningTurn: { json: ['evaluation'] },
  MsaidiziTaskEvent: { json: ['payload'] },
  MsaidiziAuditCheckpoint: { rejectText: ['manifestJson'] },
  MsaidiziMandate: {
    text: ['name', 'description'],
    json: ['capabilities', 'deviceIds', 'budgets'],
  },
  MsaidiziSchedule: { text: ['name'], json: ['taskTemplate'] },
  MsaidiziMandateVersion: {
    text: ['name', 'description'],
    json: ['capabilities', 'deviceIds', 'budgets'],
  },
  MsaidiziScheduleVersion: { text: ['name'], json: ['taskTemplate'] },
  MsaidiziArtifact: { text: ['name', 'dataClass'], json: ['provenance'] },
  MsaidiziMemory: { text: ['scopeKey'], json: ['metadata', 'sourceProvenance'] },
  MsaidiziDevice: {
    text: ['name', 'platform', 'osVersion', 'architecture'],
    json: ['capabilityManifest'],
  },
  MsaidiziHostAction: {
    text: ['recovery'],
    json: ['argumentsRedacted', 'expectedPreState', 'budgetSnapshot', 'resultSummary'],
    rejectJson: ['resolvedInputProvenance'],
  },
  MsaidiziUpdateCandidate: {
    text: ['proposalRationale', 'name', 'version', 'rollbackVersion', 'scope'],
    json: ['evaluationSummary', 'reviewerDecisions', 'healthSummary'],
  },
  MsaidiziTrustedArtifactEvidence: {
    rejectJson: ['canonicalClaims', 'toolchainVersions'],
  },
  MsaidiziUpdateEvaluationAttestation: { rejectJson: ['canonicalClaims'] },
  MsaidiziUpdateDeployment: {
    json: ['resultSummary'],
    rejectText: ['manifestJson'],
    rejectJson: ['manifestHistory'],
  },
  MsaidiziRecoveryCommand: {
    json: ['resultSummary'],
    rejectText: ['manifestJson'],
  },
  AuditLog: {
    text: ['ipAddress', 'userAgent'],
    json: ['oldValue', 'newValue', 'metadata'],
  },
};

interface PersistenceMiddlewareParams {
  model?: string;
  action: string;
  args?: Record<string, unknown>;
}

/**
 * Sanitises the write payload in place immediately before Prisma serialises it.
 * This is the common final boundary for direct clients and transaction clients.
 */
export function sanitizeMsaidiziPersistenceWrite(
  params: PersistenceMiddlewareParams,
  secrets: PersistenceSecretGuard,
): void {
  if (!params.model || !MSAIDIZI_PERSISTENCE_SECRET_FIELDS[params.model] || !params.args) return;

  switch (params.action) {
    case 'create':
    case 'createMany':
    case 'createManyAndReturn':
    case 'update':
    case 'updateMany':
    case 'updateManyAndReturn':
      params.args.data = sanitizeModelData(params.model, params.args.data, secrets);
      break;
    case 'upsert':
      params.args.create = sanitizeModelData(params.model, params.args.create, secrets);
      params.args.update = sanitizeModelData(params.model, params.args.update, secrets);
      break;
    default:
      break;
  }
}

function sanitizeModelData(
  modelName: string,
  input: unknown,
  secrets: PersistenceSecretGuard,
): unknown {
  if (Array.isArray(input)) return input.map((item) => sanitizeModelData(modelName, item, secrets));
  if (!isRecord(input)) return input;

  const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === modelName);
  const policy = MSAIDIZI_PERSISTENCE_SECRET_FIELDS[modelName];
  if (!model || !policy) return input;

  const textFields = new Set(policy.text ?? []);
  const jsonFields = new Set(policy.json ?? []);
  const rejectedTextFields = new Set(policy.rejectText ?? []);
  const rejectedJsonFields = new Set(policy.rejectJson ?? []);
  const output: Record<string, unknown> = { ...input };

  for (const [key, value] of Object.entries(input)) {
    const field = model.fields.find((candidate) => candidate.name === key);
    if (!field) continue;

    if (textFields.has(key)) {
      output[key] = sanitizeTextField(value, secrets);
    } else if (jsonFields.has(key)) {
      const sanitized = sanitizeJsonField(value, secrets);
      output[key] =
        modelName === 'MsaidiziTaskStep' &&
        key === 'arguments' &&
        Array.isArray(input.inputBindings)
          ? restoreBoundNullPlaceholders(
              sanitized,
              value,
              input.inputBindings.filter(
                (binding): binding is { targetPath: string } =>
                  isRecord(binding) && typeof binding.targetPath === 'string',
              ),
            )
          : sanitized;
    } else if (rejectedTextFields.has(key)) {
      assertTextFieldSafe(value, secrets);
    } else if (rejectedJsonFields.has(key)) {
      assertJsonFieldSafe(value, secrets);
    } else if (field.kind === 'object' && MSAIDIZI_PERSISTENCE_SECRET_FIELDS[field.type]) {
      output[key] = sanitizeNestedRelation(field.type, value, secrets);
    }
  }

  return output;
}

function assertTextFieldSafe(value: unknown, secrets: PersistenceSecretGuard): void {
  if (typeof value === 'string') {
    secrets.assertNoDeclaredSecretText(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertTextFieldSafe(item, secrets);
    return;
  }
  if (isRecord(value) && typeof value.set === 'string') {
    secrets.assertNoDeclaredSecretText(value.set);
  }
}

function assertJsonFieldSafe(value: unknown, secrets: PersistenceSecretGuard): void {
  if (isRecord(value) && Object.keys(value).length === 1 && 'set' in value) {
    secrets.assertNoDeclaredSecretJson(value.set);
    return;
  }
  secrets.assertNoDeclaredSecretJson(value);
}

function sanitizeTextField(value: unknown, secrets: PersistenceSecretGuard): unknown {
  if (typeof value === 'string') return secrets.sanitizeText(value).value;
  if (Array.isArray(value)) return value.map((item) => sanitizeTextField(item, secrets));
  if (!isRecord(value)) return value;

  const output: Record<string, unknown> = { ...value };
  if (typeof value.set === 'string') output.set = secrets.sanitizeText(value.set).value;
  if (typeof value.push === 'string' || Array.isArray(value.push)) {
    output.push = sanitizeTextField(value.push, secrets);
  }
  return output;
}

function sanitizeJsonField(value: unknown, secrets: PersistenceSecretGuard): unknown {
  if (isRecord(value) && Object.keys(value).length === 1 && 'set' in value) {
    return { set: secrets.sanitizeJson(value.set).value };
  }
  return secrets.sanitizeJson(value).value;
}

function sanitizeNestedRelation(
  modelName: string,
  value: unknown,
  secrets: PersistenceSecretGuard,
): unknown {
  if (Array.isArray(value))
    return value.map((item) => sanitizeNestedRelation(modelName, item, secrets));
  if (!isRecord(value)) return value;

  const output: Record<string, unknown> = { ...value };
  for (const operation of ['create', 'update'] as const) {
    if (!(operation in value)) continue;
    const nested = value[operation];
    output[operation] = Array.isArray(nested)
      ? nested.map((item) =>
          isRecord(item) && 'data' in item
            ? { ...item, data: sanitizeModelData(modelName, item.data, secrets) }
            : sanitizeModelData(modelName, item, secrets),
        )
      : isRecord(nested) && 'data' in nested
        ? { ...nested, data: sanitizeModelData(modelName, nested.data, secrets) }
        : sanitizeModelData(modelName, nested, secrets);
  }

  for (const operation of ['createMany', 'updateMany'] as const) {
    if (!isRecord(value[operation])) continue;
    output[operation] = {
      ...value[operation],
      data: sanitizeModelData(modelName, value[operation].data, secrets),
    };
  }

  if (isRecord(value.upsert)) {
    output.upsert = {
      ...value.upsert,
      create: sanitizeModelData(modelName, value.upsert.create, secrets),
      update: sanitizeModelData(modelName, value.upsert.update, secrets),
    };
  }
  if (isRecord(value.connectOrCreate)) {
    output.connectOrCreate = {
      ...value.connectOrCreate,
      create: sanitizeModelData(modelName, value.connectOrCreate.create, secrets),
    };
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
