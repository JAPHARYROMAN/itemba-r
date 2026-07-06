import React from 'react';
import Image from 'next/image';

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
  tone?: 'default' | 'danger';
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

const statValueTone = {
  neutral: 'text-slate-950',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-red-700',
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

  const branchLine = [branchName, organization.code].filter(Boolean).join(' · ');
  const contactLine = [organization.address, organization.phone, organization.email]
    .filter(Boolean)
    .join(' • ');
  const taxLine = [
    tin ? `TIN: ${tin}` : null,
    organization.vrn ? `VRN: ${organization.vrn}` : null,
    organization.registrationNumber ? `Reg: ${organization.registrationNumber}` : null,
  ]
    .filter(Boolean)
    .join(' • ');
  const footerContactLine = [organization.website, organization.email, organization.phone]
    .filter(Boolean)
    .join(' • ');

  return (
    <div className="document-print-root min-h-full bg-slate-100 px-4 py-5 text-slate-900 sm:px-6 lg:px-8">
      {actions && (
        <div className="document-no-print mx-auto mb-4 flex w-full max-w-[210mm] items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
          {actions}
        </div>
      )}

      <article className="document-page mx-auto min-h-[297mm] w-full max-w-[210mm] border-t-[3px] border-brand-600 bg-white px-8 py-8 text-slate-900 shadow-sm ring-1 ring-slate-200 sm:px-10">
        <header className="flex flex-col gap-5 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center">
              {organization.logoUrl ? (
                <Image
                  src={organization.logoUrl}
                  alt={`${groupName} logo`}
                  width={56}
                  height={56}
                  className="h-full w-full object-contain"
                  unoptimized
                />
              ) : (
                <span className="text-2xl font-extrabold text-brand-600">
                  {organization.logoText ?? initials(groupName)}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-base font-extrabold uppercase tracking-wide text-slate-950">
                {groupName}
              </div>
              <div className="mt-0.5 text-sm text-slate-800">{companyName}</div>
              {branchLine && <div className="mt-0.5 text-xs text-slate-500">{branchLine}</div>}
              {contactLine && (
                <div className="mt-2 text-[11px] leading-5 text-slate-500">{contactLine}</div>
              )}
              {taxLine && <div className="text-[11px] leading-5 text-slate-500">{taxLine}</div>}
            </div>
          </div>

          <div className="flex-shrink-0 text-left sm:text-right">
            <div className="text-2xl font-extrabold uppercase leading-none tracking-tight text-slate-950">
              {title}
            </div>
            {reference && (
              <div className="mt-1.5 text-sm font-semibold text-brand-600">{reference}</div>
            )}
            {status && (
              <span
                className={`mt-2 inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusToneClasses[statusTone]}`}
              >
                {status}
              </span>
            )}
            {subtitle && <div className="mt-2 text-xs text-slate-500">{subtitle}</div>}
          </div>
        </header>

        {meta.length > 0 && (
          <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-3 border-y border-slate-200 py-3">
            {meta.map((item) => (
              <div key={item.label}>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {item.label}
                </dt>
                <dd className="mt-0.5 text-sm font-semibold text-slate-900">{item.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-6">{children}</div>

        <footer className="mt-10">
          <div className="text-[11px] leading-5 text-slate-500">
            <div>{footerNote ?? 'This document was generated from ITEMBA-R system records.'}</div>
            <div className="mt-0.5">
              Printed copies are uncontrolled unless signed or issued by an authorized user.
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-4 border-t border-slate-200 pt-2.5 text-[10px] text-slate-500">
            <span>{footerContactLine}</span>
            <span>Generated {formatDateTime(generatedAt)}</span>
          </div>
        </footer>
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
        <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
          {title}
        </h2>
        {description && <div className="text-xs text-slate-500">{description}</div>}
      </div>
      {children}
    </section>
  );
}

export function DocumentKeyValueGrid({ items }: { items: DocumentMetaItem[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="border-b border-slate-100 pb-2">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            {item.label}
          </dt>
          <dd className="mt-1 break-words text-sm text-slate-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DocumentStatGrid({ items }: { items: DocumentStatItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-4 border-y border-slate-200 py-4 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label}>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            {item.label}
          </div>
          <div className={`mt-1 text-lg font-bold ${statValueTone[item.tone ?? 'neutral']}`}>
            {item.value}
          </div>
          {item.hint && (
            <div className="mt-0.5 text-[11px] leading-4 text-slate-500">{item.hint}</div>
          )}
        </div>
      ))}
    </div>
  );
}

export function DocumentTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="document-table w-full border-collapse text-sm [&_thead_tr]:border-b [&_thead_tr]:border-brand-100 [&_thead_tr]:bg-brand-50 [&_tbody_tr]:border-b [&_tbody_tr]:border-slate-200 [&_tbody_tr:last-child]:border-b-0">
        {children}
      </table>
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
    <th
      className={`px-3 py-2.5 ${alignClass} text-[10px] font-bold uppercase tracking-[0.1em] text-brand-700`}
    >
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
    <td
      className={`px-3 py-2.5 ${alignClass} align-top ${mono ? 'font-mono text-[11px] text-slate-500' : 'text-xs text-slate-800'}`}
    >
      {children}
    </td>
  );
}

export function DocumentTotals({ items }: { items: DocumentTotalItem[] }) {
  return (
    <dl className="ml-auto mt-4 w-full max-w-xs">
      {items.map((item) => (
        <div
          key={item.label}
          className={`flex items-center justify-between gap-4 border-b border-slate-200 px-3 py-2 last:border-b-0 ${
            item.emphasis ? 'bg-brand-50 font-bold text-slate-950' : 'text-slate-700'
          } ${item.tone === 'danger' ? 'font-semibold text-red-600' : ''}`}
        >
          <dt className="text-xs uppercase tracking-wide">{item.label}</dt>
          <dd className="text-right text-sm tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DocumentSignatureGrid({ labels }: { labels: string[] }) {
  return (
    <div className="grid grid-cols-1 gap-8 pt-6 sm:grid-cols-3">
      {labels.map((label) => (
        <div key={label}>
          <div className="h-12 border-b border-slate-400" />
          <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            {label}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-400">Name, signature, date</div>
        </div>
      ))}
    </div>
  );
}

export function DocumentNotePanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-sm bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
      {children}
    </div>
  );
}

export function EmptyDocumentState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-sm bg-slate-50 px-4 py-5 text-center text-sm italic text-slate-500">
      {children}
    </div>
  );
}

function initials(name: string) {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return 'IR';
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}
