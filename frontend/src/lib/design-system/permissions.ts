// ITEMBA-R Aurora Design System — Permission Helpers

/**
 * Check if a user has a specific permission
 */
export function hasPermission(
  userPermissions: string[] | undefined | null,
  required: string | string[]
): boolean {
  if (!userPermissions || userPermissions.length === 0) return false;
  if (Array.isArray(required)) {
    return required.every(p => userPermissions.includes(p));
  }
  return userPermissions.includes(required);
}

/**
 * Check if user has any of the listed permissions
 */
export function hasAnyPermission(
  userPermissions: string[] | undefined | null,
  required: string[]
): boolean {
  if (!userPermissions || userPermissions.length === 0) return false;
  return required.some(p => userPermissions.includes(p));
}

/**
 * Mask sensitive value based on permission
 */
export function maskSensitiveValue(
  value: string | number | null | undefined,
  canView: boolean,
  maskText = '••••••'
): string {
  if (!canView) return maskText;
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

/**
 * Check if user can view sensitive analytics
 */
export function canViewSensitiveValue(
  permissions: string[] | undefined | null,
  requiredPermission?: string | null
): boolean {
  if (!requiredPermission) return true;
  return hasPermission(permissions, requiredPermission);
}

/**
 * Sensitive permission names
 */
export const SENSITIVE_PERMISSIONS = {
  FINANCIAL_BI: 'financial_bi.view',
  PAYROLL_BI: 'payroll_bi.view',
  COMPLIANCE_BI: 'compliance_bi.view',
  GROUP_CONSOLIDATED: 'group_consolidated_reports.view',
  COMPANY_COMPARISON: 'company_comparison_reports.view',
  SENSITIVE_ANALYTICS: 'sensitive_analytics.view',
  SENSITIVE_EXPORT: 'sensitive_reports.export',
  BI_EXECUTIVE: 'bi.executive.view',
  BI_GROUP: 'bi.group.view',
} as const;
