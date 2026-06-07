import type { DocumentOrganization } from './DocumentShell';
import { toFiniteNumber } from '@/lib/design-system/formatters';

interface CompanyLike {
  name?: string | null;
  code?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  group?: {
    name?: string | null;
    code?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
  } | null;
  profile?: {
    registeredName?: string | null;
    tradingName?: string | null;
    brelaRegNumber?: string | null;
    tin?: string | null;
    vrn?: string | null;
    registeredAddress?: string | null;
    postalAddress?: string | null;
  } | null;
}

interface BranchLike {
  name?: string | null;
  code?: string | null;
  location?: string | null;
  address?: string | null;
  phone?: string | null;
}

const DEFAULT_DOCUMENT_LOGO_URL = '/brand/itemba-group-logo.png';

export function formatDocumentMoney(value: number | string | null | undefined, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-TZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toFiniteNumber(value))}`;
}

export function formatDocumentDate(value: string | Date | null | undefined) {
  if (!value) return 'N/A';
  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function valueOrNA(value: string | number | null | undefined) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : 'N/A';
}

export function labelDocumentValue(value: string | null | undefined) {
  return valueOrNA(value).replace(/_/g, ' ');
}

export function documentStatusTone(
  status: string | null | undefined,
): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  const normalized = String(status ?? '').toLowerCase();
  if (
    normalized.includes('paid') ||
    normalized.includes('accepted') ||
    normalized.includes('delivered') ||
    normalized.includes('closed')
  ) {
    return 'success';
  }
  if (
    normalized.includes('draft') ||
    normalized.includes('sent') ||
    normalized.includes('confirmed') ||
    normalized.includes('transit')
  ) {
    return 'info';
  }
  if (
    normalized.includes('partial') ||
    normalized.includes('pending') ||
    normalized.includes('expired')
  ) {
    return 'warning';
  }
  if (
    normalized.includes('cancel') ||
    normalized.includes('reject') ||
    normalized.includes('void')
  ) {
    return 'danger';
  }
  return 'neutral';
}

export function documentOrganization(
  company?: CompanyLike | null,
  branch?: BranchLike | null,
): DocumentOrganization {
  const profile = company?.profile;
  const group = company?.group;
  const groupName = firstPresent(group?.name, 'ITEMBA GROUP') ?? 'ITEMBA GROUP';
  const companyName =
    firstPresent(profile?.registeredName, company?.name, 'ITEMBA-R Group') ?? 'ITEMBA-R Group';

  return {
    groupName,
    name: companyName,
    companyName: company?.name,
    code: company?.code,
    branchName: branch?.name,
    address: firstPresent(
      branch?.address,
      branch?.location,
      profile?.registeredAddress,
      profile?.postalAddress,
      group?.address,
    ),
    phone: firstPresent(branch?.phone, company?.phone, group?.phone),
    email: firstPresent(company?.email, group?.email, 'info@itembagrouptz.com'),
    website: firstPresent(company?.website, group?.website, 'itembagrouptz.com'),
    tin: profile?.tin,
    vrn: profile?.vrn,
    registrationNumber: profile?.brelaRegNumber,
    logoUrl: firstPresent(company?.logoUrl, DEFAULT_DOCUMENT_LOGO_URL),
  };
}

function firstPresent(...values: Array<string | null | undefined>) {
  return values.find((value) => String(value ?? '').trim().length > 0) ?? null;
}
