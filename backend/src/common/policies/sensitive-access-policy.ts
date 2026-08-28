/**
 * Group-control controllers whose successful and denied requests append a
 * sensitive-access observation.  Keep this as data (rather than burying it in
 * the interceptor) so the signed CRUD evidence registry can declare the same
 * database effect before it executes a read.
 */
export const SENSITIVE_ACCESS_CONTROLLER_NAMES = Object.freeze([
  'BankAccountsController',
  'ContractsController',
  'DebtsController',
  'FixedAssetsController',
  'LoansController',
  'DashboardController',
] as const);

const SENSITIVE_ACCESS_CONTROLLERS = new Set<string>(SENSITIVE_ACCESS_CONTROLLER_NAMES);

/** Permission modules considered group-control data by the interceptor. */
export const SENSITIVE_ACCESS_PERMISSION_MODULES = Object.freeze([
  'bank-accounts',
  'contracts',
  'debts',
  'fixed-assets',
  'loans',
] as const);

const SENSITIVE_PERMISSION_MODULES = new Set<string>(SENSITIVE_ACCESS_PERMISSION_MODULES);

export function isSensitiveAccessController(controllerName: string): boolean {
  return SENSITIVE_ACCESS_CONTROLLERS.has(controllerName);
}

export function hasSensitiveAccessPermission(required: readonly string[] | undefined): boolean {
  return (
    required?.some((permission) =>
      SENSITIVE_PERMISSION_MODULES.has(permission.split('.')[0] ?? ''),
    ) ?? false
  );
}

/**
 * A manifest capability is audit-writing only when both its controller and its
 * reviewed group-control permission identify the sensitive policy boundary.
 */
export function capabilityRequiresSensitiveAccessAudit(input: {
  id: string;
  permissions: readonly string[];
  anyPermissions?: readonly string[];
}): boolean {
  if (input.id === 'DashboardController.getExecutiveSummary') return true;
  const separator = input.id.indexOf('.');
  const controllerName = separator < 0 ? input.id : input.id.slice(0, separator);
  return (
    isSensitiveAccessController(controllerName) &&
    hasSensitiveAccessPermission([...input.permissions, ...(input.anyPermissions ?? [])])
  );
}
