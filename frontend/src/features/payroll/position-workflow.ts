export const POSITION_TYPE_OPTIONS = [
  { value: 'MANAGEMENT', label: 'Management' },
  { value: 'ADMINISTRATION', label: 'Administration' },
  { value: 'FINANCE', label: 'Finance' },
  { value: 'SALES', label: 'Sales' },
  { value: 'CASHIER', label: 'Cashier' },
  { value: 'INVENTORY', label: 'Inventory' },
  { value: 'DRIVER', label: 'Driver' },
  { value: 'MECHANIC', label: 'Mechanic' },
  { value: 'PUMP_ATTENDANT', label: 'Pump Attendant' },
  { value: 'STATION_SUPERVISOR', label: 'Station Supervisor' },
  { value: 'PARKING_ATTENDANT', label: 'Parking Attendant' },
  { value: 'SECURITY', label: 'Security' },
  { value: 'CLEANER', label: 'Cleaner' },
  { value: 'RECEPTIONIST', label: 'Receptionist' },
  { value: 'HOUSEKEEPER', label: 'Housekeeper' },
  { value: 'WAITER', label: 'Waiter' },
  { value: 'BARTENDER', label: 'Bartender' },
  { value: 'COOK', label: 'Cook' },
  { value: 'FARM_WORKER', label: 'Farm Worker' },
  { value: 'FARM_SUPERVISOR', label: 'Farm Supervisor' },
  { value: 'MACHINE_OPERATOR', label: 'Machine Operator' },
  { value: 'SITE_WORKER', label: 'Site Worker' },
  { value: 'SITE_SUPERVISOR', label: 'Site Supervisor' },
  { value: 'PROJECT_MANAGER', label: 'Project Manager' },
  { value: 'PROPERTY_MANAGER', label: 'Property Manager' },
  { value: 'OTHER', label: 'Other' },
];

export interface Department {
  id: string;
  departmentCode?: string | null;
  name: string;
  companyId?: string;
  divisionId?: string | null;
  branchId?: string | null;
  division?: { id: string; name: string; code?: string | null } | null;
  branch?: { id: string; name: string; code?: string | null } | null;
}

export interface Position {
  updatedAt?: string;
  id: string;
  positionCode: string;
  title: string;
  positionType?: string;
  defaultSalary?: number | string | null;
  currency?: string | null;
  companyId?: string;
  company?: { id: string; name: string } | null;
  departmentId?: string | null;
  department?: Department | null;
  status: string;
}

export interface FormState {
  positionCode: string;
  title: string;
  companyId: string;
  divisionId: string;
  branchId: string;
  departmentId: string;
  positionType: string;
  defaultSalary: string;
  currency: string;
  status: string;
}

export const empty: FormState = {
  positionCode: '',
  title: '',
  companyId: '',
  divisionId: '',
  branchId: '',
  departmentId: '',
  positionType: 'OTHER',
  defaultSalary: '',
  currency: 'TZS',
  status: 'ACTIVE',
};

export function labelForPositionType(value?: string) {
  return POSITION_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value ?? '-';
}

export function hierarchyLabel(department?: Department | null) {
  if (!department) return '-';
  const division = department.division?.code
    ? `${department.division.code} - ${department.division.name}`
    : department.division?.name;
  const branch = department.branch?.code
    ? `${department.branch.code} - ${department.branch.name}`
    : department.branch?.name;
  return [division, branch].filter(Boolean).join(' / ') || '-';
}

export const toForm = (record: Position): FormState => ({
  positionCode: record.positionCode,
  title: record.title,
  companyId: record.company?.id ?? record.companyId ?? '',
  divisionId: record.department?.division?.id ?? record.department?.divisionId ?? '',
  branchId: record.department?.branch?.id ?? record.department?.branchId ?? '',
  departmentId: record.department?.id ?? record.departmentId ?? '',
  positionType: record.positionType ?? 'OTHER',
  defaultSalary: record.defaultSalary == null ? '' : String(record.defaultSalary),
  status: record.status,
  currency: record.currency || 'TZS',
});
