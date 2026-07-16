import type { DocumentOrganization } from './DocumentShell';
import { toFiniteNumber } from '@/lib/design-system/formatters';
import { ITEMBA_DOCUMENT_LETTERHEAD } from '@/lib/document-letterhead';

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
  const groupName = ITEMBA_DOCUMENT_LETTERHEAD.groupName;
  const companyName =
    firstPresent(profile?.registeredName, company?.name, 'ITEMBA-R Group') ?? 'ITEMBA-R Group';

  return {
    groupName,
    name: companyName,
    companyName: company?.name,
    code: company?.code,
    branchName: branch?.name,
    address: firstPresent(
      profile?.registeredAddress,
      profile?.postalAddress,
      branch?.address,
      branch?.location,
      group?.address,
      ITEMBA_DOCUMENT_LETTERHEAD.address,
    ),
    telephone: firstPresent(company?.phone, group?.phone, ITEMBA_DOCUMENT_LETTERHEAD.telephone),
    phone: firstPresent(branch?.phone, ITEMBA_DOCUMENT_LETTERHEAD.phone),
    email: firstPresent(company?.email, group?.email, ITEMBA_DOCUMENT_LETTERHEAD.email),
    website: firstPresent(company?.website, group?.website, ITEMBA_DOCUMENT_LETTERHEAD.website),
    tin: firstPresent(profile?.tin, ITEMBA_DOCUMENT_LETTERHEAD.tin),
    vrn: firstPresent(profile?.vrn, ITEMBA_DOCUMENT_LETTERHEAD.vrn),
    registrationNumber: firstPresent(
      profile?.brelaRegNumber,
      ITEMBA_DOCUMENT_LETTERHEAD.registrationNumber,
    ),
    logoUrl: firstPresent(company?.logoUrl, DEFAULT_DOCUMENT_LOGO_URL),
  };
}

function firstPresent(...values: Array<string | null | undefined>) {
  return values.find((value) => String(value ?? '').trim().length > 0) ?? null;
}
