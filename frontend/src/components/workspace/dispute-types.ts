export interface DisputeEmployee {
  id: string;
  employeeCode: string;
  fullName?: string | null;
  firstName?: string;
  lastName?: string;
  department?: { name: string } | null;
  position?: { title: string } | null;
}
export interface DisputeRecord {
  id: string;
  disputeNumber: string;
  companyId: string;
  company?: { id: string; name: string };
  employeeId: string;
  employee?: DisputeEmployee;
  type: string;
  status: string;
  raisedAt: string;
  summary: string;
  initialPosition?: string | null;
  notes?: string | null;
  division?: { name: string } | null;
  branch?: { name: string } | null;
  directToGroupHr?: boolean;
  mediatedAt?: string | null;
  mediationOutcome?: string | null;
  cmaReferenceNumber?: string | null;
  cmaReferredAt?: string | null;
  cmaArbitrator?: string | null;
  cmaHearingDate?: string | null;
  resolvedAt?: string | null;
  resolutionType?: string | null;
  resolutionAmount?: string | number | null;
  resolutionNotes?: string | null;
  raisedBy?: { fullName: string } | null;
  mediatedBy?: { fullName: string } | null;
  cmaReferredBy?: { fullName: string } | null;
  resolvedBy?: { fullName: string } | null;
  disciplinaryActions?: Array<{
    id: string;
    actionNumber: string;
    type: string;
    status: string;
    issuedAt: string;
    reason: string;
  }>;
}
export const disputePath = '/hr/employment-disputes';
export const disputeLabel = (value: string) =>
  value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\bcma\b/g, 'CMA');
export const disputeTypes = [
  'GRIEVANCE',
  'WAGE_DISPUTE',
  'WORKING_CONDITIONS',
  'HARASSMENT',
  'DISCRIMINATION',
  'UNFAIR_TERMINATION',
  'CONSTRUCTIVE_DISMISSAL',
  'CONTRACT_BREACH',
  'OTHER',
].map((value) => ({ value, label: disputeLabel(value) }));
export const disputeStatuses = [
  'RAISED',
  'INTERNAL_MEDIATION',
  'CMA_REFERRED',
  'CMA_HEARING',
  'RESOLVED',
  'DISMISSED',
  'WITHDRAWN',
].map((value) => ({ value, label: disputeLabel(value) }));
export const disputeResolutions = [
  'SETTLED_INTERNALLY',
  'CMA_AWARD_FOR_EMPLOYEE',
  'CMA_AWARD_FOR_EMPLOYER',
  'WITHDRAWN_BY_EMPLOYEE',
  'ABANDONED',
  'OTHER',
].map((value) => ({ value, label: disputeLabel(value) }));
export const disputeEmployeeName = (e?: DisputeEmployee) =>
  e?.fullName ||
  [e?.firstName, e?.lastName].filter(Boolean).join(' ') ||
  e?.employeeCode ||
  'Employee';
export const disputeDate = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : 'Not recorded';
export const disputeClosed = (r: DisputeRecord) =>
  ['RESOLVED', 'DISMISSED', 'WITHDRAWN'].includes(r.status);
export type DisputeOperation = 'mediate' | 'refer-cma' | 'resolve' | 'withdraw' | 'delete';
export const disputeOperationAllowed = (r: DisputeRecord, op: DisputeOperation) =>
  op === 'delete' ||
  (op === 'mediate'
    ? r.status === 'RAISED'
    : op === 'refer-cma'
      ? ['RAISED', 'INTERNAL_MEDIATION'].includes(r.status)
      : !disputeClosed(r));
