export interface DelegationUser {
  id: string;
  fullName?: string | null;
  email?: string | null;
}
export interface DelegationCompany {
  id: string;
  name: string;
}
export interface ApprovalDelegation {
  id: string;
  delegatorUserId: string;
  delegateUserId: string;
  companyId?: string | null;
  company?: DelegationCompany | null;
  entityType?: string | null;
  startDate: string;
  endDate: string;
  reason?: string | null;
  status: string;
  delegator?: DelegationUser | null;
  delegate?: DelegationUser | null;
}
export const delegationPath = '/approvals/delegations';
export const delegationStatuses = ['ACTIVE', 'INACTIVE', 'EXPIRED', 'CANCELLED'];
export const delegationUserLabel = (user?: DelegationUser | null, fallback = 'Unknown user') =>
  user?.fullName || user?.email || fallback;
export const delegationName = (record: ApprovalDelegation) =>
  `${delegationUserLabel(record.delegator, record.delegatorUserId)} → ${delegationUserLabel(record.delegate, record.delegateUserId)}`;
export const delegationDate = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function localInput(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
export const delegationForm = (record?: ApprovalDelegation, companyId = '') => ({
  delegatorUserId: record?.delegatorUserId || '',
  delegateUserId: record?.delegateUserId || '',
  companyId: record ? record.companyId || '' : companyId,
  entityType: record?.entityType || '',
  startDate: localInput(record?.startDate),
  endDate: localInput(record?.endDate),
  reason: record?.reason || '',
});
