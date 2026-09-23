export const DEFAULT_FUEL_COMPANY_CODE = 'MWANJALISI';
export const DEFAULT_FUEL_COMPANY_NAME = 'Mwanjalisi Oil Co Ltd';

export function fuelCompanyName(company: { companyCode: string; companyName: string }) {
  return company.companyCode.trim().toUpperCase() === DEFAULT_FUEL_COMPANY_CODE
    ? DEFAULT_FUEL_COMPANY_NAME
    : company.companyName;
}

export function defaultFuelDivision<T extends { companyCode: string }>(divisions: T[]) {
  return divisions.find((d) => d.companyCode.trim().toUpperCase() === DEFAULT_FUEL_COMPANY_CODE);
}
