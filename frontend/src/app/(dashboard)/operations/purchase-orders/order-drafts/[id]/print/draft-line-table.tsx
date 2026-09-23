import { WorkspaceTable } from '@/components/ui/workspace-table';
import type { SupplierOrderDraftLine } from '../../../_components/supplier-order-draft-types';
import { money } from '../../../_components/supplier-order-draft-types';

export function DraftLineTable({
  lines,
  currency,
}: {
  lines: SupplierOrderDraftLine[];
  currency: string;
}) {
  return (
    <WorkspaceTable className="supplier-order-draft-table w-full table-fixed border-collapse text-[7pt] leading-[1.25]">
      <thead>
        <tr className="bg-slate-100">
          <th className="w-[5%] border border-slate-400 px-[1mm] py-[1.2mm]">#</th>
          <th className="w-[31%] border border-slate-400 px-[1mm] py-[1.2mm] text-left">
            Description
          </th>
          <th className="w-[10%] border border-slate-400 px-[1mm] py-[1.2mm] text-left">Code</th>
          <th className="w-[8%] border border-slate-400 px-[1mm] py-[1.2mm] text-right">Qty</th>
          <th className="w-[8%] border border-slate-400 px-[1mm] py-[1.2mm]">Unit</th>
          <th className="w-[13%] border border-slate-400 px-[1mm] py-[1.2mm] text-right">
            Unit Price
          </th>
          <th className="w-[10%] border border-slate-400 px-[1mm] py-[1.2mm] text-right">
            Disc/Tax
          </th>
          <th className="w-[15%] border border-slate-400 px-[1mm] py-[1.2mm] text-right">
            Amount
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.id ?? line.lineNumber} className="break-inside-avoid">
            <td className="border border-slate-300 px-[1mm] py-[1.2mm] text-center align-top">
              {line.lineNumber}
            </td>
            <td className="border border-slate-300 px-[1mm] py-[1.2mm] align-top">
              <b>{line.description}</b>
              {line.notes && (
                <div className="mt-[0.5mm] text-[6.4pt] text-slate-600">{line.notes}</div>
              )}
            </td>
            <td className="border border-slate-300 px-[1mm] py-[1.2mm] align-top">
              {line.itemCode || '-'}
            </td>
            <td className="border border-slate-300 px-[1mm] py-[1.2mm] text-right align-top">
              {Number(line.quantity).toLocaleString()}
            </td>
            <td className="border border-slate-300 px-[1mm] py-[1.2mm] text-center align-top">
              {line.unitLabel}
            </td>
            <td className="border border-slate-300 px-[1mm] py-[1.2mm] text-right align-top">
              {line.unitPrice === null ? (
                <span className="font-semibold text-amber-700">Price to be confirmed</span>
              ) : (
                money(line.unitPrice, currency)
              )}
            </td>
            <td className="border border-slate-300 px-[1mm] py-[1.2mm] text-right align-top">
              {line.unitPrice === null ? (
                '-'
              ) : (
                <>
                  <div>-{money(line.discountAmount, currency)}</div>
                  <div>+{money(line.taxAmount, currency)}</div>
                </>
              )}
            </td>
            <td className="border border-slate-300 px-[1mm] py-[1.2mm] text-right font-semibold align-top">
              {line.lineTotal === null ? 'Pending' : money(line.lineTotal, currency)}
            </td>
          </tr>
        ))}
      </tbody>
    </WorkspaceTable>
  );
}
