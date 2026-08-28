/** Signed governance semantics attached to every positive CRUD evidence fixture. */

export type CrudFixtureGovernanceScope =
  | 'company'
  | 'actor'
  | 'seeded-company'
  | 'global'
  | 'unclassified'
  | 'not_applicable';

export type CrudFixtureAuditScopeKind =
  | 'COMPANY'
  | 'MULTI_COMPANY'
  | 'GROUP'
  | 'GLOBAL'
  | 'UNATTRIBUTED';

export type CrudFixtureAuditAttributionStatus = 'EXPLICIT' | 'RESOLVED' | 'LEGACY' | 'FAILED';

export type CrudFixtureAuditCompanyBinding = 'companyA' | 'companyB' | 'adminOperationsCompany';

/**
 * Immutable AuditLog provenance expected from one audited read. Bindings are
 * resolved from the signed fixture seed/request, never from the HTTP response.
 */
export interface CrudFixtureAuditScopeContract {
  scopeKind: CrudFixtureAuditScopeKind;
  attributionStatus: CrudFixtureAuditAttributionStatus;
  companyScopeBindings: readonly CrudFixtureAuditCompanyBinding[];
}

export interface CrudFixtureGovernanceContract {
  /** Reviewed ownership semantics; unclassified reads fail the release gate closed. */
  scope: CrudFixtureGovernanceScope;
  /** Mutations must prove their exact attributable AuditLog row. */
  audit: 'required' | 'not_applicable';
  /** Required for audited reads; mutation fixtures carry the equivalent contract in `audit`. */
  auditScope?: CrudFixtureAuditScopeContract;
}

/** All currently signed sensitive reads are explicitly narrowed to companyA. */
export const CRUD_COMPANY_A_EXPLICIT_AUDIT_SCOPE = Object.freeze({
  scopeKind: 'COMPANY',
  attributionStatus: 'EXPLICIT',
  companyScopeBindings: Object.freeze(['companyA'] as const),
} satisfies CrudFixtureAuditScopeContract);

export const CRUD_MUTATION_GOVERNANCE = Object.freeze({
  scope: 'not_applicable',
  audit: 'required',
} satisfies CrudFixtureGovernanceContract);
