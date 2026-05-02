# ITEMBA-R Multi-Company Data Isolation

## Overview
ITEMBA-R strictly separates data between companies (Mwanjalisi Oil, Westsides, Itemba Enterprises) while allowing controlled Group-level access.

## Isolation Rules

### Company Scoping
- Every company-owned record has a `companyId` field
- All API endpoints filter by `companyId` from the authenticated user's company context
- Users cannot access records from other companies unless they hold Group-level roles

### Group Control
- Group Super Admin, Group Director, Group Finance Controller, Group Auditor have cross-company read access
- Sensitive records (bank accounts, loans, contracts, documents) require Group Control role
- All cross-company access is audit-logged

### Permission Boundaries
- Every module requires at minimum one permission
- Permissions are company-scoped or group-scoped
- PermissionsGuard enforces this on every endpoint

## Testing Isolation

ITEMBA-R includes a Data Isolation Testing framework at: **Performance & Ops → Data Isolation**

### Test Run Types
- `COMPANY_SCOPE` — verifies company filters are applied
- `DIVISION_SCOPE` — verifies division filters
- `BRANCH_SCOPE` — verifies branch-level filtering
- `BUSINESS_UNIT_SCOPE` — verifies business unit isolation
- `PERMISSION_SCOPE` — verifies permission enforcement
- `GROUP_CONTROL_SCOPE` — verifies Group Control access controls

### Running Tests
1. Navigate to Data Isolation → Isolation Tests
2. Click "Run New Test"
3. Select the test run type
4. Monitor results and review any issues found

### Resolving Issues
Issues are classified by severity: CRITICAL, HIGH, MEDIUM, LOW
- Critical and High issues must be resolved before production deployment
- Use the Issues tab to Acknowledge → Resolve each issue

## Best Practices
1. Always include `companyId` filter in service queries
2. Use the `CompanyScopeService` to validate access
3. Never return data without first checking company ownership
4. Audit-log all sensitive record access
5. Run isolation tests after each significant backend change
