export interface PeopleDashboard {
  workforce: {
    total: number;
    active: number;
    onLeave: number;
    suspended: number;
    activeRate: number;
  };
  contracts: { active: number; expiringWithin30Days: number };
  leave: { pendingApproval: number; approved: number };
  payroll: {
    openPeriods: number;
    runsInFlight: number;
    paidRunsThisMonth: number;
    grossPayThisMonth: number;
    deductionsThisMonth: number;
    netPayThisMonth: number;
  };
  attendance: {
    scheduledShiftsToday: number;
    presentToday: number;
    absentToday: number;
    lateToday: number;
    attendanceCaptureRate: number;
  };
  compliance: {
    totalHrDocuments: number;
    expiringMedicalExams: number;
    openDisputes: number;
    activeDisciplinaryActions: number;
  };
  employeesByCompany: Array<{ companyId: string; company: string; code?: string; count: number }>;
  recentEmployees: Array<{
    id: string;
    employeeCode: string;
    fullName: string;
    employmentStatus: string;
    hireDate?: string;
  }>;
  upcomingContractExpiries: Array<{
    id: string;
    contractCode: string;
    employeeId: string;
    contractType: string;
    endDate: string;
    status: string;
  }>;
}
export const peopleDestinations = [
  {
    href: '/hr/employees',
    label: 'Employees',
    description: 'Profiles and employment details',
    permission: 'employees.view',
  },
  {
    href: '/hr/departments',
    label: 'Departments',
    description: 'Your organization structure',
    permission: 'departments.view',
  },
  {
    href: '/hr/positions',
    label: 'Positions',
    description: 'Roles across the workforce',
    permission: 'positions.view',
  },
  {
    href: '/hr/employment-contracts',
    label: 'Contracts',
    description: 'Agreements and their status',
    permission: 'employment_contracts.view',
  },
  {
    href: '/hr/attendance',
    label: 'Attendance',
    description: 'Daily records and hours',
    permission: 'attendance.view',
  },
  {
    href: '/hr/leave-requests',
    label: 'Leave requests',
    description: 'Requests and approvals',
    permission: 'leave_requests.view',
  },
  {
    href: '/hr/payroll-runs',
    label: 'Payroll runs',
    description: 'Review and process payroll',
    permission: 'payroll.view',
  },
  {
    href: '/hr/payroll-periods',
    label: 'Pay periods',
    description: 'Payroll cycles and dates',
    permission: 'payroll.view',
  },
  {
    href: '/hr/reports',
    label: 'People reports',
    description: 'Workforce and payroll records',
    permission: 'hr.reports.view',
  },
];
