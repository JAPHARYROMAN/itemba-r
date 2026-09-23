export interface WorkflowCompany {
  id: string;
  name: string;
  code?: string;
}
export interface ApprovalWorkflow {
  id: string;
  workflowCode: string;
  name: string;
  entityType: string;
  description?: string | null;
  workflowScope: string;
  triggerAction: string;
  companyId?: string | null;
  company?: WorkflowCompany | null;
  priority: number;
  isActive: boolean;
  steps?: Array<{ id: string; stepName: string; stepOrder: number }>;
}
export const workflowPath = '/approvals/workflows';
export const workflowScopes = ['GROUP', 'COMPANY', 'DIVISION', 'BRANCH', 'BUSINESS_UNIT', 'GLOBAL'];
export const workflowTriggers = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'SUBMIT',
  'POST',
  'PAY',
  'EXPORT',
  'APPROVE',
  'STATUS_CHANGE',
  'OTHER',
];
export const workflowLabel = (value: string) =>
  value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
export const workflowForm = (record?: ApprovalWorkflow, companyId = '') => ({
  workflowCode: record?.workflowCode || '',
  name: record?.name || '',
  entityType: record?.entityType || '',
  description: record?.description || '',
  workflowScope: record?.workflowScope || 'GLOBAL',
  triggerAction: record?.triggerAction || 'SUBMIT',
  companyId: record?.companyId || companyId,
  priority: String(record?.priority ?? 0),
  isActive: String(record?.isActive ?? true),
});
