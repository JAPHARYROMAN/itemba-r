export type AnalysisRow = Record<string, string | number>;
export type AnalysisTable = {
  id: string;
  title: string;
  columns: { key: string; label: string; money?: boolean }[];
  rows: AnalysisRow[];
};
export type Analysis = {
  source: string;
  period: { from: string; to: string; previousFrom: string; previousTo: string };
  generatedAt: string;
  basis: string;
  currencies: {
    currency: string;
    opening: string;
    issued?: string;
    paid?: string;
    closing: string;
    overdue?: string;
    previous: string;
    change: string | null;
    expenses?: string;
    inflow?: string;
    outflow?: string;
    count?: number;
  }[];
  tables: AnalysisTable[];
};
export type AnalysisFilters = {
  companyId: string;
  divisionId: string;
  branchId: string;
  from: string;
  to: string;
  currency: string;
  partyId: string;
};
