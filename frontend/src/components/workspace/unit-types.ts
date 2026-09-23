export interface Unit {
  updatedAt?: string;
  id: string;
  name: string;
  symbol: string;
  unitType: string;
  isBaseUnit: boolean;
  isSystemUnit: boolean;
  status: string;
  companyId?: string | null;
}
export interface UnitConversion {
  updatedAt?: string;
  id: string;
  companyId?: string | null;
  fromUnitId: string;
  toUnitId: string;
  conversionFactor: number | string;
  description?: string | null;
  isActive: boolean;
  fromUnit?: { name: string; symbol: string } | null;
  toUnit?: { name: string; symbol: string } | null;
}
export interface UnitCompany {
  id: string;
  name: string;
}
export const UNIT_TYPES = [
  'PIECE',
  'VOLUME',
  'WEIGHT',
  'LENGTH',
  'AREA',
  'PACKAGE',
  'SERVICE',
  'TIME',
  'OTHER',
];
export const unitTypeLabel = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();
export const conversionName = (record: UnitConversion) =>
  `${record.fromUnit?.name || record.fromUnitId} to ${record.toUnit?.name || record.toUnitId}`;
export const conversionEquation = (record: UnitConversion) =>
  `1 ${record.fromUnit?.symbol || record.fromUnitId} = ${record.conversionFactor} ${record.toUnit?.symbol || record.toUnitId}`;
export function validConversionFactor(text: string) {
  const value = Number(text);
  if (!text.trim() || !Number.isFinite(value) || value <= 0) return false;
  const [mantissa, exponent = '0'] = value.toString().toLowerCase().split('e');
  return Math.max(0, (mantissa.split('.')[1] || '').length - Number(exponent)) <= 6;
}
