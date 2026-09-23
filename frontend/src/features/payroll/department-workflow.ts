export interface Department {
  updatedAt?: string;
  id: string;
  departmentCode: string;
  name: string;
  company?: { id: string; name: string } | string;
  companyId?: string;
  division?: { id: string; name: string; code?: string | null } | null;
  divisionId?: string;
  branch?: { id: string; name: string; code?: string | null } | null;
  branchId?: string;
  status: string;
}

export interface FormState {
  departmentCode: string;
  name: string;
  companyId: string;
  divisionId: string;
  branchId: string;
  status: string;
}

export const empty: FormState = {
  departmentCode: '',
  name: '',
  companyId: '',
  divisionId: '',
  branchId: '',
  status: 'ACTIVE',
};

export const toForm = (record: Department): FormState => ({
  departmentCode: record.departmentCode,
  name: record.name,
  companyId: typeof record.company === 'object' ? record.company.id : record.companyId || '',
  divisionId: record.division?.id ?? record.divisionId ?? '',
  branchId: record.branch?.id ?? record.branchId ?? '',
  status: record.status,
});
