'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Printer, Share2 } from 'lucide-react';
import { DocumentArtifactButton } from '@/components/documents';
import { Btn, ErrorState, PageSpinner } from '@/components/ui';
import { backendGet, backendPost } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';
import { ITEMBA_DOCUMENT_LETTERHEAD } from '@/lib/document-letterhead';
import type { SupplierOrderDraft } from '../../../_components/supplier-order-draft-types';
import { dateOnly, money } from '../../../_components/supplier-order-draft-types';
import { SupplierOrderDraftShareDialog } from '../../../_components/SupplierOrderDraftShareDialog';
import { DraftLineTable } from './draft-line-table';
import { splitDraftLines } from './page-budget';

function text(...values: Array<string | null | undefined>) {
  return values.find((value) => value?.trim()) ?? '';
}

export default function SupplierOrderDraftPrintPage() {
  const params = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const canView = hasPermission('supplier_order_drafts.view');
  const canExport = hasPermission('supplier_order_drafts.export');
  const beginRequest = useRequestGuard();
  const [draft, setDraft] = useState<SupplierOrderDraft | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async () => {
    if (!canView) return;
    const request = beginRequest();
    setLoading(true);
    setError('');
    try {
      const next = await backendGet<SupplierOrderDraft>(`/supplier-order-drafts/${params.id}`, {
        signal: request.signal,
      });
      if (!request.current()) return;
      setDraft(next);
    } catch (cause) {
      if (!request.current()) return;
      setError(cause instanceof Error ? cause.message : 'Could not load supplier order draft');
    } finally {
      if (request.current()) setLoading(false);
    }
  }, [beginRequest, canView, params.id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function printDocument() {
    await backendPost(`/supplier-order-drafts/${params.id}/export-audit`, {
      format: 'PRINT',
    }).catch(() => undefined);
    window.print();
  }

  if (!canView) return <ErrorState message="Access Restricted" />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (loading || !draft) return <PageSpinner />;

  const company = draft.company;
  const profile = company?.profile;
  const companyName = text(profile?.registeredName, company?.name, 'ITEMBA-R');
  const address = text(
    profile?.registeredAddress,
    profile?.postalAddress,
    draft.branch?.address,
    ITEMBA_DOCUMENT_LETTERHEAD.address,
  );
  const telephone = text(
    company?.phone,
    company?.group?.phone,
    ITEMBA_DOCUMENT_LETTERHEAD.telephone,
  );
  const email = text(company?.email, company?.group?.email, ITEMBA_DOCUMENT_LETTERHEAD.email);
  const logo = text(company?.logoUrl, '/brand/itemba-group-logo.png');
  const split = splitDraftLines(draft.lines, {
    hasTitle: Boolean(draft.title?.trim()),
    unpriced: Boolean(draft.hasUnpricedLines),
  });

  return (
    <div className="document-print-root supplier-order-draft-print-root min-h-screen bg-slate-100 px-4 py-5 text-slate-950">
      <SupplierOrderDraftShareDialog
        open={sharing}
        draft={draft}
        onClose={() => setSharing(false)}
      />
      <div className="document-no-print mx-auto mb-4 flex w-full max-w-[210mm] flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <Link
          href={`/operations/purchase-orders/order-drafts/${draft.id}`}
          className="text-sm font-medium text-brand-600"
        >
          Back to draft
        </Link>
        <div className="flex flex-wrap gap-2">
          {canExport && (
            <>
              <Btn
                size="sm"
                variant="secondary"
                icon={<Share2 className="h-3.5 w-3.5" />}
                onClick={() => setSharing(true)}
              >
                Share
              </Btn>
              <DocumentArtifactButton
                entityType="SUPPLIER_ORDER_DRAFT"
                entityId={draft.id}
                buttonLabel="Generate PDF"
                compact
              />
            </>
          )}
          <Btn size="sm" icon={<Printer className="h-3.5 w-3.5" />} onClick={printDocument}>
            Print / Save PDF
          </Btn>
        </div>
      </div>

      <article className="document-page supplier-order-draft-document mx-auto min-h-[297mm] w-full max-w-[210mm] bg-white px-[12mm] py-[12mm] shadow-sm ring-1 ring-slate-200">
        <header className="supplier-order-draft-header grid grid-cols-[52%_48%] gap-[5mm] border-b-2 border-slate-950 pb-[2mm]">
          <div className="flex min-w-0 gap-[3mm]">
            <div className="flex h-[16mm] w-[16mm] flex-none items-center justify-center border border-slate-900 p-[1.5mm]">
              <Image
                src={logo}
                alt="Itemba Group logo"
                width={54}
                height={54}
                className="h-full w-full object-contain"
                unoptimized
              />
            </div>
            <div className="min-w-0 text-[7.2pt] leading-[1.28]">
              <div className="text-[11pt] font-extrabold uppercase leading-none">ITEMBA GROUP</div>
              <div className="mt-[1mm] text-[9pt] font-bold uppercase leading-tight">
                {companyName}
              </div>
              {draft.branch?.name && (
                <div className="mt-[0.5mm] uppercase">{draft.branch.name}</div>
              )}
              <div className="mt-[1mm]">Address: {address}</div>
              <div>
                Tel: {telephone} | Phone: {ITEMBA_DOCUMENT_LETTERHEAD.phone}
              </div>
              <div>Email: {email}</div>
              <div>
                TIN: {text(profile?.tin, '—')} | VRN:{' '}
                {text(profile?.vrn, '—')}
              </div>
              <div>
                Reg No:{' '}
                {text(profile?.brelaRegNumber, '—')}
              </div>
            </div>
          </div>
          <div className="min-w-0 text-[7.2pt] leading-[1.28]">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[10pt] font-extrabold uppercase">Supplier Order Draft</div>
                <div className="text-[9pt] font-bold">{draft.draftNumber}</div>
              </div>
              <div className="border border-slate-400 px-[2mm] py-[0.8mm] text-[6.5pt] font-bold uppercase">
                {draft.status}
              </div>
            </div>
            <div className="mt-[1mm] grid grid-cols-2 gap-x-3">
              <span>
                <b>Draft date:</b> {dateOnly(draft.draftDate)}
              </span>
              <span>
                <b>Needed by:</b> {dateOnly(draft.neededBy)}
              </span>
              <span>
                <b>Currency:</b> {draft.currency}
              </span>
              <span>
                <b>Scope:</b> {draft.branch?.name || draft.division?.name || 'Company'}
              </span>
            </div>
            <div className="mt-[1.5mm] border-t border-slate-300 pt-[1mm]">
              <div className="text-[6pt] font-bold uppercase tracking-wide text-slate-500">
                Supplier
              </div>
              <div className="truncate text-[8pt] font-bold">{draft.supplierName}</div>
              <div className="line-clamp-1">
                {[draft.supplierContact, draft.supplierPhone, draft.supplierEmail]
                  .filter(Boolean)
                  .join(' | ')}
              </div>
              <div className="line-clamp-1">{draft.supplierAddress}</div>
              <div>
                {[
                  draft.supplierTin ? `TIN: ${draft.supplierTin}` : '',
                  draft.supplierVrn ? `VRN: ${draft.supplierVrn}` : '',
                ]
                  .filter(Boolean)
                  .join(' | ')}
              </div>
            </div>
          </div>
        </header>

        <main className="mt-[3mm]">
          {draft.title && <h1 className="mb-[2mm] text-[11pt] font-bold">{draft.title}</h1>}
          {draft.hasUnpricedLines && (
            <div className="mb-[2mm] border border-amber-300 bg-amber-50 px-[2mm] py-[1.5mm] text-[7pt] text-amber-900">
              Prices are incomplete. “Partial total” includes priced lines only; remaining lines are
              marked “Price to be confirmed”.
            </div>
          )}
          <DraftLineTable lines={split.firstPageLines} currency={draft.currency} />
          {split.overflowLines.length > 0 && (
            <p className="mt-[2mm] text-[7.5pt] font-semibold">
              {split.overflowLines.length} further item(s) continue overleaf. Totals below cover
              every line.
            </p>
          )}

          <div className="mt-[2mm] ml-auto w-[72mm] text-[7.5pt]">
            <div className="flex justify-between py-[0.6mm]">
              <span>Priced subtotal</span>
              <b>{money(draft.subtotal, draft.currency)}</b>
            </div>
            <div className="flex justify-between py-[0.6mm]">
              <span>Discount</span>
              <b>-{money(draft.discountAmount, draft.currency)}</b>
            </div>
            <div className="flex justify-between py-[0.6mm]">
              <span>Tax</span>
              <b>{money(draft.taxAmount, draft.currency)}</b>
            </div>
            <div className="flex justify-between border-y border-slate-900 py-[1mm] text-[9pt]">
              <span className="font-bold">
                {draft.hasUnpricedLines ? 'Partial total' : 'Total'}
              </span>
              <b>{money(draft.totalAmount, draft.currency)}</b>
            </div>
          </div>

          <section className="mt-[2mm] border-y border-slate-300 py-[1.5mm] text-[6.7pt] leading-snug">
            <b className="uppercase">Supplier contact record:</b>{' '}
            {[
              draft.supplierName,
              draft.supplierContact,
              draft.supplierPhone,
              draft.supplierEmail,
              draft.supplierAddress,
              draft.supplierTin ? `TIN ${draft.supplierTin}` : '',
              draft.supplierVrn ? `VRN ${draft.supplierVrn}` : '',
            ]
              .filter(Boolean)
              .join(' | ')}
          </section>

          <div className="mt-[3mm] grid grid-cols-3 gap-[3mm] text-[7pt]">
            <section>
              <h2 className="border-b border-slate-300 pb-[0.5mm] font-bold uppercase">
                Delivery Instructions
              </h2>
              <p className="mt-[1mm] whitespace-pre-wrap">{draft.deliveryInstructions || '-'}</p>
            </section>
            <section>
              <h2 className="border-b border-slate-300 pb-[0.5mm] font-bold uppercase">Terms</h2>
              <p className="mt-[1mm] whitespace-pre-wrap">{draft.terms || '-'}</p>
            </section>
            <section>
              <h2 className="border-b border-slate-300 pb-[0.5mm] font-bold uppercase">Notes</h2>
              <p className="mt-[1mm] whitespace-pre-wrap">{draft.notes || '-'}</p>
            </section>
          </div>

          <div className="mt-[8mm] grid grid-cols-2 gap-[18mm] text-[7pt]">
            <div className="border-t border-slate-600 pt-[1mm]">
              Prepared by: {draft.createdBy?.fullName || ''}
            </div>
            <div className="border-t border-slate-600 pt-[1mm]">Supplier acknowledgement</div>
          </div>
        </main>
        <footer className="mt-[4mm] flex justify-between border-t border-slate-300 pt-[1mm] text-[6pt] text-slate-500">
          <span>
            Planning document only. No inventory, payable, journal, GRN, tax, or Purchase Order is
            created.
          </span>
          <span>{draft.draftNumber}</span>
        </footer>
      </article>
      {split.overflowLines.length > 0 && (
        <article className="document-page supplier-order-draft-document mx-auto mt-4 min-h-[297mm] w-full max-w-[210mm] bg-white px-[12mm] py-[12mm] shadow-sm ring-1 ring-slate-200">
          <header className="mb-[3mm] flex items-end justify-between border-b border-slate-950 pb-[2mm] text-[8pt]">
            <div className="text-[11pt] font-bold uppercase">Line items (continued)</div>
            <div>{draft.draftNumber}</div>
          </header>
          <DraftLineTable lines={split.overflowLines} currency={draft.currency} />
          <p className="mt-[3mm] text-[7.5pt] text-slate-600">
            Totals for all {draft.lines.length} items are stated on page 1.
          </p>
        </article>
      )}
    </div>
  );
}
