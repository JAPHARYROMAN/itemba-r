import { AccessLevel } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  accessibleCompanyIdsFromUser,
  assertCanAccessCompanyFromUser,
  isGroupScopedUser,
} from '../../common/services/company-scope.service';

export function assertWritableCompany(user: AuthUser, companyId: string | null) {
  assertCanAccessCompanyFromUser(user, companyId, AccessLevel.WRITE);
}

export type ControlPlaneCompanyWhere = {
  companyId?: string | null | { in: string[] };
  id?: { in: string[] };
  OR?: ControlPlaneCompanyWhere[];
};

/** Company predicate that deliberately includes group-level (`null`) rows for group users. */
export function controlPlaneCompanyScope(
  user: AuthUser,
  requestedCompanyId?: string,
): ControlPlaneCompanyWhere {
  if (requestedCompanyId) {
    assertCanAccessCompanyFromUser(user, requestedCompanyId, AccessLevel.READ);
    return { companyId: requestedCompanyId };
  }
  const companyIds = accessibleCompanyIdsFromUser(user);
  if (isGroupScopedUser(user)) {
    return companyIds.length > 0
      ? { OR: [{ companyId: null }, { companyId: { in: companyIds } }] }
      : { companyId: null };
  }
  return companyIds.length > 0 ? { companyId: { in: companyIds } } : { id: { in: [] } };
}
