export interface WcfMonth {
  month: number;
  gross: number;
  wcfAmount: number;
  employees: number;
}
export interface WcfBranch {
  branchId: string | null;
  branchName: string;
  branchCode: string | null;
  region?: string | null;
  monthlyExposure: WcfMonth[];
  totalGross: number;
  totalWcf: number;
  totalEmployees: number;
}
export interface WcfExposure {
  header: {
    companyId: string;
    companyName: string;
    companyTin: string | null;
    year: number;
    fromMonth: number;
    toMonth: number;
    periodLabel: string;
  };
  summary: { branchCount: number; totalGross: number; totalWcf: number; effectiveRate: number };
  branches: WcfBranch[];
}
export const wcfMonthName = (month: number) =>
  new Date(2000, month - 1, 1).toLocaleDateString('en-GB', { month: 'long' });
export const wcfMonths = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: wcfMonthName(i + 1),
}));
