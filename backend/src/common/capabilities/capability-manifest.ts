/**
 * Capability manifest — the machine-readable inventory of everything this API
 * can do, derived from the metadata the controllers already carry.
 *
 * Msaidizi (the agent layer) generates its tool registry from this: one tool per
 * capability, gated by the capability's own permission codes, tiered by how hard
 * the action is to undo. Nothing here is Msaidizi-specific, though — the manifest
 * is just a truthful description of the routing table, and is equally useful for
 * permission audits and API documentation.
 *
 * It reads Nest's own route metadata rather than parsing source, so it cannot
 * drift from what the router actually serves. See capability-manifest.spec.ts for
 * the drift guard that keeps every endpoint classified.
 */

import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { DIRECT_MTLS_DEVICE_KEY } from '../decorators/direct-mtls-device.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import {
  AGENT_EXCLUDED_KEY,
  AGENT_EXCLUSION_REASON_KEY,
  AgentExclusionReason,
} from '../decorators/agent-excluded.decorator';
import { API_SCOPE_KEY } from '../decorators/require-api-scope.decorator';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { classifyTier, ReversibilityTier } from './reversibility';
import { deriveDtoSchema, DerivedDtoSchema } from './dto-json-schema';
import {
  EXTERNAL_EGRESS_KEY,
  ExternalEgressMetadata,
} from '../decorators/external-egress.decorator';

export type HttpVerb = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'ALL';

/** How a route is actually guarded. Order matters: this is the strongest gate present. */
export type GuardKind =
  | 'permission' // @RequirePermissions — all listed codes required
  | 'permission-any' // @RequireAnyPermissions — at least one required
  | 'api-key' // @RequireApiScope + ApiKeyAuthGuard — machine-to-machine, scope-gated
  | 'mutual-tls' // directly authenticated client TLS socket, no proxy assertion
  | 'role' // @Roles at class or handler level, no permission codes
  | 'authenticated' // JWT only — no permission or role gate
  | 'public'; // @Public with no other gate — genuinely unauthenticated

export interface Capability {
  /** Stable identity: `ControllerName.handlerName`. */
  id: string;
  controller: string;
  handler: string;
  verb: HttpVerb;
  /** Full route path as the router serves it, e.g. `profit/products/:productId/cost`. */
  path: string;
  /** Codes from @RequirePermissions (AND semantics). */
  permissions: string[];
  /** Codes from @RequireAnyPermissions (OR semantics). */
  anyPermissions: string[];
  /** Role names from @Roles, class-level or handler-level. */
  roles: string[];
  /** Scopes from @RequireApiScope — API-key auth, a separate axis from permissions. */
  apiScopes: string[];
  guard: GuardKind;
  tier: ReversibilityTier;
  /** Why the tier was assigned — a rule name, or 'verb-default'. */
  tierReason: string;
  /** Declared parameters, read from Nest's route-argument metadata. */
  params: ParamSpec;
  /** `@ApiOperation({ summary })` where the controller declares one. */
  summary?: string;
  /** `@AgentExcluded()` — never offered to the agent, whatever the permissions. */
  agentExcluded: boolean;
  /** Stable reason supplied by `@AgentExcluded(reason)` for coverage and policy diagnostics. */
  agentExclusionReason?: AgentExclusionReason;
  /** Explicit server-side egress contract. Absence means no metered external effect. */
  externalEgress?: ExternalEgressMetadata;
}

export type CapabilityEffect = 'READ' | 'WRITE' | 'EXTERNAL' | 'IRREVERSIBLE';

export interface ParamSpec {
  /** `:name` segments the route requires. */
  path: string[];
  /** Named `@Query('x')` parameters — the ones we can describe precisely. */
  query: string[];
  /**
   * True when the handler takes the whole query object (`@Query()` with no key),
   * so the accepted keys are not knowable from route metadata alone.
   */
  freeFormQuery: boolean;
  /** True when the handler declares a `@Body()`. */
  hasBody: boolean;
  /**
   * Named transport headers consumed by the controller. Header values are
   * contextual request material, never model arguments; recording the names
   * here lets the loopback boundary forward only the exact declared contract.
   */
  headers?: string[];
  /** DTO/OpenAPI-derived contract for a whole-object `@Query()`, when available. */
  querySchema?: DerivedDtoSchema;
  /** DTO/OpenAPI-derived contract for `@Body()`, when available. */
  bodySchema?: DerivedDtoSchema;
}

/** Nest's route-arg paramtype enum values we care about. */
const PARAMTYPE_BODY = 3;
const PARAMTYPE_QUERY = 4;
const PARAMTYPE_PARAM = 5;
const PARAMTYPE_HEADERS = 6;

const API_OPERATION_METADATA = 'swagger/apiOperation';

/**
 * Reads `@Body()` / `@Query()` / `@Param()` declarations for one handler.
 *
 * Metadata is keyed `${paramtype}:${index}` on the controller class under the
 * handler's name, with `data` holding the argument name when one was given.
 * Custom param decorators (e.g. `@CurrentUser()`) appear under hashed keys and
 * are ignored — they are supplied by the framework, not by a caller.
 */
export function extractParams(controller: ControllerClass, handlerName: string): ParamSpec {
  const raw = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handlerName) as
    | Record<string, { data?: unknown }>
    | undefined;

  const spec: ParamSpec = {
    path: [],
    query: [],
    freeFormQuery: false,
    hasBody: false,
    headers: [],
  };
  if (!raw) return spec;

  const parameterTypes = (Reflect.getMetadata(
    'design:paramtypes',
    controller.prototype,
    handlerName,
  ) ?? []) as unknown[];

  for (const [key, value] of Object.entries(raw)) {
    const paramtype = Number(key.split(':')[0]);
    const name = typeof value?.data === 'string' && value.data ? value.data : undefined;
    const parameterIndex = Number(key.split(':')[1]);
    const parameterType = Number.isInteger(parameterIndex)
      ? parameterTypes[parameterIndex]
      : undefined;

    if (paramtype === PARAMTYPE_PARAM && name) spec.path.push(name);
    else if (paramtype === PARAMTYPE_QUERY) {
      if (name) spec.query.push(name);
      else {
        spec.freeFormQuery = true;
        spec.querySchema = deriveDtoSchema(parameterType);
      }
    } else if (paramtype === PARAMTYPE_BODY) {
      spec.hasBody = true;
      spec.bodySchema = deriveDtoSchema(parameterType);
    } else if (paramtype === PARAMTYPE_HEADERS && name) {
      spec.headers?.push(name.toLowerCase());
    }
  }

  spec.path.sort();
  spec.query.sort();
  spec.headers?.sort();
  return spec;
}

/** A class with Nest controller metadata. */
export type ControllerClass = new (...args: never[]) => object;

const VERB_BY_ENUM: Record<number, HttpVerb> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
  [RequestMethod.ALL]: 'ALL',
};

/** Joins a controller base path and a handler path the way Nest's router does. */
function joinPath(base: unknown, sub: unknown): string {
  const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/^\/+|\/+$/g, '') : '');
  const segments = [clean(base), clean(sub)].filter((s) => s.length > 0);
  return segments.join('/');
}

function readStrings(key: string, ...targets: unknown[]): string[] {
  for (const target of targets) {
    const value = Reflect.getMetadata(key, target as object);
    if (Array.isArray(value) && value.length > 0) return value as string[];
  }
  return [];
}

function readExternalEgress(...targets: unknown[]): ExternalEgressMetadata | undefined {
  for (const target of targets) {
    const value = Reflect.getMetadata(EXTERNAL_EGRESS_KEY, target as object) as unknown;
    if (value === undefined) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('External egress metadata must be an object');
    }
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source).sort();
    if (
      keys.length !== 2 ||
      keys[0] !== 'metering' ||
      keys[1] !== 'reservationBytes' ||
      source.metering !== 'adapter-receipt-v1' ||
      !Number.isSafeInteger(source.reservationBytes) ||
      Number(source.reservationBytes) <= 0
    ) {
      throw new TypeError('External egress metadata is invalid');
    }
    return {
      metering: 'adapter-receipt-v1',
      reservationBytes: Number(source.reservationBytes),
    };
  }
  return undefined;
}

function determineGuard(
  permissions: string[],
  anyPermissions: string[],
  roles: string[],
  apiScopes: string[],
  isDirectMtls: boolean,
  isPublic: boolean,
): GuardKind {
  // API-scope routes carry @Public() to bypass JWT, then authenticate via
  // x-api-key. Checked before `isPublic` or they would read as unauthenticated.
  if (apiScopes.length > 0) return 'api-key';
  if (isDirectMtls) return 'mutual-tls';
  if (isPublic) return 'public';
  if (permissions.length > 0) return 'permission';
  if (anyPermissions.length > 0) return 'permission-any';
  if (roles.length > 0) return 'role';
  return 'authenticated';
}

/**
 * Extracts every routed endpoint from the given controller classes.
 *
 * Reads class-level metadata as a fallback for handler-level metadata, matching
 * Nest's own `getAllAndOverride` resolution in PermissionsGuard — a class-level
 * @Roles or @RequirePermissions applies to every handler that does not declare
 * its own.
 */
export function extractCapabilities(controllers: ControllerClass[]): Capability[] {
  const capabilities: Capability[] = [];

  for (const controller of controllers) {
    const basePath = Reflect.getMetadata(PATH_METADATA, controller);
    if (basePath === undefined) continue; // not a controller

    const prototype = controller.prototype as Record<string, unknown>;

    for (const handlerName of Object.getOwnPropertyNames(prototype)) {
      if (handlerName === 'constructor') continue;

      // Read the descriptor rather than the value: touching a getter would
      // invoke it, and some controllers define non-route accessors.
      const descriptor = Object.getOwnPropertyDescriptor(prototype, handlerName);
      const handler = descriptor?.value;
      if (typeof handler !== 'function') continue;

      const subPath = Reflect.getMetadata(PATH_METADATA, handler);
      if (subPath === undefined) continue; // not a route

      const verbEnum = Reflect.getMetadata(METHOD_METADATA, handler);
      const verb = VERB_BY_ENUM[verbEnum as number] ?? 'ALL';

      const permissions = readStrings(PERMISSIONS_KEY, handler, controller);
      const anyPermissions = readStrings(ANY_PERMISSIONS_KEY, handler, controller);
      const roles = readStrings(ROLES_KEY, handler, controller);
      const apiScopes = readStrings(API_SCOPE_KEY, handler, controller);
      const isPublic =
        Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true ||
        Reflect.getMetadata(IS_PUBLIC_KEY, controller) === true;
      const isDirectMtls =
        Reflect.getMetadata(DIRECT_MTLS_DEVICE_KEY, handler) === true ||
        Reflect.getMetadata(DIRECT_MTLS_DEVICE_KEY, controller) === true;

      const operation = Reflect.getMetadata(API_OPERATION_METADATA, handler) as
        | { summary?: string }
        | undefined;
      const agentExcluded =
        Reflect.getMetadata(AGENT_EXCLUDED_KEY, handler) === true ||
        Reflect.getMetadata(AGENT_EXCLUDED_KEY, controller) === true;
      const agentExclusionReason = agentExcluded
        ? ((Reflect.getMetadata(AGENT_EXCLUSION_REASON_KEY, handler) ??
            Reflect.getMetadata(AGENT_EXCLUSION_REASON_KEY, controller) ??
            'agent_excluded') as AgentExclusionReason)
        : undefined;
      const externalEgress = readExternalEgress(handler, controller);

      const base: Omit<Capability, 'tier' | 'tierReason'> = {
        id: `${controller.name}.${handlerName}`,
        controller: controller.name,
        handler: handlerName,
        verb,
        path: joinPath(basePath, subPath),
        permissions,
        anyPermissions,
        roles,
        apiScopes,
        guard: determineGuard(
          permissions,
          anyPermissions,
          roles,
          apiScopes,
          isDirectMtls,
          isPublic,
        ),
        params: extractParams(controller, handlerName),
        summary: operation?.summary,
        agentExcluded,
        ...(agentExclusionReason ? { agentExclusionReason } : {}),
        ...(externalEgress ? { externalEgress } : {}),
      };

      const { tier, reason } = classifyTier(base);
      // External actions always use the existing red/autopilot ceiling. Encoding
      // the declaration in tierReason also binds it into current signed CRUD
      // capability digests without weakening or rewriting evidence machinery.
      capabilities.push({
        ...base,
        tier: externalEgress ? 'red' : tier,
        tierReason: externalEgress ? 'metered-external-egress' : reason,
      });
    }
  }

  return capabilities.sort((a, b) => a.id.localeCompare(b.id));
}

/** The exact effect a durable ERP plan must copy from the manifest. */
export function capabilityEffect(capability: Capability): CapabilityEffect {
  if (capability.externalEgress) return 'EXTERNAL';
  if (capability.verb === 'GET' || capability.verb === 'HEAD') return 'READ';
  return capability.tier === 'red' ? 'IRREVERSIBLE' : 'WRITE';
}

/** Every permission code a capability could require, in one list. */
export function permissionCodesFor(capability: Capability): string[] {
  return [...capability.permissions, ...capability.anyPermissions];
}

/**
 * Filters a manifest to the capabilities a user may actually invoke.
 *
 * This is the function the Msaidizi tool registry calls: an unpermitted
 * capability is never turned into a tool, so the model cannot see it, cannot
 * name it, and has nothing to argue with. Role-gated and public capabilities are
 * deliberately excluded — an agent should reach the API through permission codes
 * only, so that its envelope is expressible as data rather than inferred.
 */
export function capabilitiesFor(
  manifest: Capability[],
  grantedPermissions: readonly string[],
): Capability[] {
  const granted = new Set(grantedPermissions);
  return manifest.filter((cap) => {
    // Excluded outright, before any permission reasoning: this answers "should
    // an agent ever do this", which is independent of whether the user may.
    if (cap.agentExcluded) return false;

    // Deliberately mirrors PermissionsGuard.canActivate rather than switching on
    // `guard`. A route may carry BOTH decorators, in which case the guard demands
    // every AND code *and* one OR code; keying off the single `guard` label would
    // check only the AND set and admit a capability the guard rejects. No route
    // does this today, which is exactly why it would be missed if it ever did —
    // an envelope wider than the guard is the one failure mode this must not have.
    const hasAnd = cap.permissions.length > 0;
    const hasOr = cap.anyPermissions.length > 0;

    // An agent reaches the API through permission codes only, so that its envelope
    // is expressible as data. Role-gated, API-key, public and JWT-only routes have
    // no code to check and are never admitted.
    if (!hasAnd && !hasOr) return false;

    if (hasAnd && !cap.permissions.every((p) => granted.has(p))) return false;
    if (hasOr && !cap.anyPermissions.some((p) => granted.has(p))) return false;
    return true;
  });
}
