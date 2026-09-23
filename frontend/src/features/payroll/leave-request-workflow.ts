export interface LeaveRequest {
  id: string;
  updatedAt?: string;
  leaveRequestNumber?: string;
  companyId?: string;
  employeeId?: string;
  leaveTypeId?: string;
  employee?: string | { fullName?: string; employeeCode?: string };
  company?: { name?: string };
  leaveType?: string | { name?: string };
  startDate?: string;
  endDate?: string;
  totalDays?: number | string;
  reason?: string;
  status: string;
  lineApprovedById?: string | null;
  groupHrApprovedById?: string | null;
  approvalNotes?: string;
  rejectionReason?: string;
}
export interface FormState {
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason: string;
}
export type Action = 'submit' | 'approve' | 'approve-hr' | 'reject' | 'cancel';
export const empty: FormState = {
  companyId: '',
  employeeId: '',
  leaveTypeId: '',
  startDate: '',
  endDate: '',
  reason: '',
};
export const actionNames: Record<Action, string> = {
  submit: 'Submit request',
  approve: 'Line approval',
  'approve-hr': 'Group HR approval',
  reject: 'Reject request',
  cancel: 'Cancel request',
};
export const employeeName = (r: LeaveRequest) =>
  typeof r.employee === 'string'
    ? r.employee
    : r.employee?.fullName || r.employee?.employeeCode || 'Employee';
export const typeName = (r: LeaveRequest) =>
  typeof r.leaveType === 'string' ? r.leaveType : r.leaveType?.name || '—';
export const date = (v?: string) =>
  v ? new Date(v).toLocaleDateString('en-GB', { timeZone: 'UTC' }) : '—';
export const label = (v: string) =>
  v
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (c) => c.toUpperCase());
export const leaveActionPermissions: Record<Action, string> = {
  submit: 'leave_requests.create',
  approve: 'leave_requests.approve',
  'approve-hr': 'leave_requests.approve.hr',
  reject: 'leave_requests.reject',
  cancel: 'leave_requests.create',
};
