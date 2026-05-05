import React from 'react';

export interface DocumentOrganization {
  name: string;
  groupName?: string | null;
  companyName?: string | null;
  code?: string | null;
  branchName?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  tin?: string | null;
  vrn?: string | null;
  taxId?: string | null;
  registrationNumber?: string | null;
  logoUrl?: string | null;
  logoText?: string | null;
}

export interface DocumentMetaItem {
  label: string;
  value: React.ReactNode;
}

export interface DocumentStatItem {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}

export interface DocumentTotalItem {
  label: string;
  value: React.ReactNode;
  emphasis?: boolean;
}

interface DocumentShellProps {
  title: string;
  subtitle?: string;
  reference?: string;
  status?: string;
  statusTone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  organization: DocumentOrganization;
  meta?: DocumentMetaItem[];
  actions?: React.ReactNode;
  footerNote?: string;
  generatedAt?: Date;
  children: React.ReactNode;
}

const statusToneClasses = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  danger: 'border-red-200 bg-red-50 text-red-700',
  info: 'border-blue-200 bg-blue-50 text-blue-700',
};

const statToneClasses = {
  neutral: 'border-slate-200 bg-slate-50',
  success: 'border-emerald-200 bg-emerald-50',
  warning: 'border-amber-200 bg-amber-50',
  danger: 'border-red-200 bg-red-50',
};

export function DocumentShell({
  title,
  subtitle,
  reference,
  status,
  statusTone = 'neutral',
  organization,
  meta = [],
  actions,
  footerNote,
  generatedAt = new Date(),
  children,
}: DocumentShellProps) {
  const groupName = organization.groupName ?? 'ITEMBA GROUP';
  const companyName = organization.name ?? organization.companyName ?? 'ITEMBA-R Group';
  const branchName = organization.branchName;
  const tin = organization.tin ?? organization.taxId;

  const contactLine = [
    organization.phone ? `Tel: ${organization.phone}` : null,
    organization.email ? `Email: ${organization.email}` : null,
  ].filter(Boolean).join(' | ');
  const taxLine = [
    tin ? `TIN: ${tin}` : null,
    organization.vrn ? `VRN: ${organization.vrn}` : null,
  ].filter(Boolean).join(' | ');

  return (
    <div className="document-print-root min-h-full bg-slate-100 px-4 py-5 text-slate-900 sm:px-6 lg:px-8">
      {actions && (
        <div className="document-no-print mx-auto mb-4 flex w-full max-w-[210mm] items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
          {actions}
        </div>
      )}

      <article className="document-page mx-auto min-h-[297mm] w-full max-w-[210mm] bg-white px-8 py-8 text-slate-900 shadow-sm ring-1 ring-slate-200 sm:px-10">
        <div className="flex flex-col gap-5 border-b-2 border-slate-900 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center border-2 border-slate-900 bg-white p-1 text-sm font-bold uppercase text-slate-900">
              {organization.logoUrl ? (
                <img src={organization.logoUrl} alt={`${groupName} logo`} className="h-full w-full object-contain" />
              ) : (
                organization.logoText ?? initials(groupName)
              )}
            </div>
            <div className="min-w-0">
              <div className="text-lg font-extrabold uppercase leading-tight text-slate-950">{groupName}</div>
              <div className="mt-0.5 text-sm font-bold leading-tight text-slate-900">{companyName}</div>
              {branchName && <div className="mt-0.5 text-sm leading-tight text-slate-700">{branchName}</div>}
              {organization.code && (
                <div className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{organization.code}</div>
              )}
              {organization.address && <div className="mt-2 text-xs leading-5 text-slate-600">Address: {organization.address}</div>}
              {contactLine && <div className="mt-1 text-xs leading-5 text-slate-600">{contactLine}</div>}
              {taxLine && <div className="mt-1 text-xs leading-5 text-slate-600">{taxLine}</div>}
              {organization.registrationNumber && (
                <div className="mt-1 text-xs leading-5 text-slate-600">Reg: {organization.registrationNumber}</div>
              )}
              {organization.website && <div className="mt-1 text-xs leading-5 text-slate-600">Website: {organization.website}</div>}
            </div>
          </div>

          <div className="text-left sm:text-right">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Document</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{reference ?? title}</div>
            {status && (
              <div className={`mt-2 inline-flex rounded border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${statusToneClasses[statusTone]}`}>
                {status}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Record View</div>
            <h1 className="mt-1 text-2xl font-bold leading-tight text-slate-950">{title}</h1>
            {subtitle && <p className="mt-1 text-sm leading-6 text-slate-600">{subtitle}</p>}
          </div>
          <div className="text-xs leading-5 text-slate-500 sm:text-right">
            <div>Generated</div>
            <div className="font-medium text-slate-800">{formatDateTime(generatedAt)}</div>
          </div>
        </div>

        {meta.length > 0 && (
          <dl className="mt-5 grid grid-cols-1 gap-px overflow-hidden border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
            {meta.map(item => (
              <div key={item.label} className="bg-white px-3 py-2">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{item.label}</dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">{item.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-6">{children}</div>

        <div className="mt-10 border-t border-slate-200 pt-4 text-[11px] leading-5 text-slate-500">
          <div>{footerNote ?? 'This document was generated from ITEMBA-R system records.'}</div>
          <div className="mt-1">Printed copies are uncontrolled unless signed or issued by an authorized user.</div>
        </div>
      </article>
    </div>
  );
}

export function DocumentSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="document-section mt-7 first:mt-0">
      <div className="mb-3 flex flex-col gap-1 border-b border-slate-200 pb-2 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-slate-800">{title}</h2>
        {description && <div className="text-xs text-slate-500">{description}</div>}
      </div>
      {children}
    </section>
  );
}

export function DocumentKeyValueGrid({ items }: { items: DocumentMetaItem[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(item => (
        <div key={item.label} className="border-b border-slate-100 pb-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{item.label}</dt>
          <dd className="mt-1 break-words text-sm text-slate-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DocumentStatGrid({ items }: { items: DocumentStatItem[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(item => (
        <div key={item.label} className={`border px-3 py-3 ${statToneClasses[item.tone ?? 'neutral']}`}>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{item.label}</div>
          <div className="mt-1 text-lg font-bold text-slate-950">{item.value}</div>
          {item.hint && <div className="mt-1 text-[11px] leading-4 text-slate-600">{item.hint}</div>}
        </div>
      ))}
    </div>
  );
}

export function DocumentTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto border border-slate-200">
      <table className="document-table w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function DocumentTh({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
}) {
  const alignClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th className={`px-3 py-2 ${alignClass} text-[10px] font-bold uppercase tracking-wide text-slate-600`}>
      {children}
    </th>
  );
}

export function DocumentTd({
  children,
  align = 'left',
  mono = false,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  mono?: boolean;
}) {
  const alignClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <td className={`px-3 py-2 ${alignClass} align-top text-xs text-slate-800 ${mono ? 'font-mono' : ''}`}>
      {children}
    </td>
  );
}

export function DocumentTotals({ items }: { items: DocumentTotalItem[] }) {
  return (
    <dl className="ml-auto mt-4 w-full max-w-xs border border-slate-200">
      {items.map(item => (
        <div
          key={item.label}
          className={`flex items-center justify-between gap-4 border-b border-slate-200 px-3 py-2 last:border-b-0 ${item.emphasis ? 'bg-slate-50 font-bold text-slate-950' : 'text-slate-700'}`}
        >
          <dt className="text-xs">{item.label}</dt>
          <dd className="text-right text-sm tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DocumentSignatureGrid({ labels }: { labels: string[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {labels.map(label => (
        <div key={label} className="min-h-24 border border-slate-200 px-3 py-3">
          <div className="h-12 border-b border-slate-300" />
          <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-1 text-[10px] text-slate-500">Name, signature, date</div>
        </div>
      ))}
    </div>
  );
}

export function EmptyDocumentState({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-slate-200 px-4 py-5 text-center text-sm italic text-slate-500">
      {children}
    </div>
  );
}

function initials(name: string) {
  const parts = name
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return 'IR';
  return parts
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}
