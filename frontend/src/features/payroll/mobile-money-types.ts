export interface MobileMoney {
  id: string;
  employeeId?: string;
  provider: string;
  msisdn: string;
  accountName?: string | null;
  isPrimary: boolean;
  status: string;
  notes?: string | null;
  updatedAt?: string;
}
export const PROVIDER_LABELS: Record<string, string> = {
  M_PESA: 'M-Pesa (Vodacom)',
  TIGO_PESA: 'Tigo Pesa / Mixx by Yas',
  AIRTEL_MONEY: 'Airtel Money',
  HALOPESA: 'HaloPesa (Halotel)',
  EZYPESA: 'EzyPesa (Zantel)',
  T_PESA: 'T-Pesa (TTCL)',
  OTHER: 'Other',
};
export function mobileMoneyValues(record?: MobileMoney) {
  return {
    provider: record?.provider ?? 'M_PESA',
    msisdn: record?.msisdn ?? '',
    accountName: record?.accountName ?? '',
    isPrimary: record?.isPrimary ?? false,
    status: record?.status ?? 'ACTIVE',
    notes: record?.notes ?? '',
  };
}
export type MobileMoneyValues = ReturnType<typeof mobileMoneyValues>;
/** Identifies account-set changes without retaining account numbers or names. */
export function mobileMoneyVersion(records: MobileMoney[]) {
  return JSON.stringify(
    records
      .map((row) => [row.id, row.updatedAt || '', row.provider, row.status, row.isPrimary])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}
