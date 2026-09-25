import { BadRequestException } from '@nestjs/common';
import { Prisma, RecordEntry } from '@prisma/client';
import { createHash } from 'crypto';
import { RecordValuesDto } from './records.dto';

export const isDebt = (kind: string) => kind === 'DEBTOR' || kind === 'CREDITOR';
export const today = () => new Date(new Date().toISOString().slice(0, 10));
export function requestKey(value: object) {
  return createHash('sha256')
    .update(JSON.stringify(value, Object.keys(value).sort()))
    .digest('hex');
}
export function recordValues(d: RecordValuesDto) {
  const amount = new Prisma.Decimal(d.amount);
  if (!d.title.trim()) throw new BadRequestException('Enter a title.');
  if (isDebt(d.kind) && !d.counterparty?.trim())
    throw new BadRequestException('Enter who owes or is owed.');
  if (d.kind === 'NOTE' ? !amount.isZero() : !amount.gt(0))
    throw new BadRequestException('Enter a positive amount. Notes must have no amount.');
  if (d.dueDate && (!isDebt(d.kind) || d.dueDate < d.recordDate))
    throw new BadRequestException('A debt due date must be on or after its record date.');
  if ((!d.companyId && (d.divisionId || d.branchId)) || (!d.divisionId && d.branchId))
    throw new BadRequestException('Choose company, division, then branch.');
  return {
    kind: d.kind,
    title: d.title.trim(),
    counterparty: d.counterparty?.trim() || null,
    contact: d.contact?.trim() || null,
    reference: d.reference?.trim() || null,
    category: d.category?.trim() || null,
    notes: d.notes?.trim() || null,
    companyId: d.companyId || null,
    divisionId: d.divisionId || null,
    branchId: d.branchId || null,
    currency: d.currency,
    amount,
    recordDate: new Date(d.recordDate),
    dueDate: d.dueDate ? new Date(d.dueDate) : null,
  };
}
export function presentRecord<T extends RecordEntry>(row: T) {
  const balance =
    isDebt(row.kind) && !row.voidedAt ? row.amount.minus(row.settledAmount) : new Prisma.Decimal(0);
  const status = row.voidedAt
    ? 'void'
    : !isDebt(row.kind)
      ? 'recorded'
      : balance.isZero()
        ? 'settled'
        : row.dueDate && row.dueDate < today()
          ? 'overdue'
          : row.settledAmount.gt(0)
            ? 'partial'
            : 'open';
  return { ...row, balance: balance.toFixed(2), status };
}
/** Neutralise spreadsheet formula prefixes, including whitespace/control-prefixed formulae. */
export function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
