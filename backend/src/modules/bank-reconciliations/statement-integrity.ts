import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface StatementImportRow {
  transactionDate: string;
  description: string;
  reference?: string;
  debitAmount: string;
  creditAmount: string;
}
export function normalizeStatementRow(row: StatementImportRow, start: Date, end: Date) {
  const date = new Date(row.transactionDate);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(row.transactionDate) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== row.transactionDate ||
    date < start ||
    date > end
  )
    throw new BadRequestException(
      'Statement dates must be valid YYYY-MM-DD dates inside the reconciliation period.',
    );
  if (!row.description.trim() || row.description.length > 500 || (row.reference?.length ?? 0) > 200)
    throw new BadRequestException(
      'Each line needs a description (maximum 500 characters) and a reference of at most 200 characters.',
    );
  const parse = (value: string) => {
    if (!/^\d{1,14}(\.\d{1,4})?$/.test(value))
      throw new BadRequestException(
        'Amounts must be non-negative decimals with at most four decimal places.',
      );
    return new Prisma.Decimal(value);
  };
  const debit = parse(row.debitAmount),
    credit = parse(row.creditAmount);
  if (debit.gt(0) === credit.gt(0))
    throw new BadRequestException(
      'Each statement line needs exactly one positive debit or credit.',
    );
  return {
    transactionDate: date,
    description: row.description.trim(),
    reference: row.reference?.trim() || null,
    debitAmount: debit,
    creditAmount: credit,
  };
}
export const statementKey = (row: {
  transactionDate: Date;
  description: string;
  reference?: string | null;
  debitAmount: Prisma.Decimal;
  creditAmount: Prisma.Decimal;
}) =>
  JSON.stringify([
    row.transactionDate.toISOString().slice(0, 10),
    row.description.trim(),
    row.reference?.trim() || '',
    row.debitAmount.toFixed(4),
    row.creditAmount.toFixed(4),
  ]);

export function statementEvidence(reconciliation: {
  statementOpeningBalance: Prisma.Decimal;
  statementClosingBalance: Prisma.Decimal;
  bookOpeningBalance: Prisma.Decimal;
  bookClosingBalance: Prisma.Decimal;
  statementLines: Array<{
    id: string;
    transactionDate: Date;
    debitAmount: Prisma.Decimal;
    creditAmount: Prisma.Decimal;
    matched: boolean;
  }>;
  statementStartDate: Date;
  statementEndDate: Date;
}) {
  const issues: string[] = [];
  let movement = new Prisma.Decimal(0);
  for (const line of reconciliation.statementLines) {
    if (
      line.debitAmount.lt(0) ||
      line.creditAmount.lt(0) ||
      line.debitAmount.gt(0) === line.creditAmount.gt(0)
    )
      issues.push('A statement line has an invalid debit/credit direction.');
    if (
      line.transactionDate < reconciliation.statementStartDate ||
      line.transactionDate > reconciliation.statementEndDate
    )
      issues.push('A statement line falls outside the statement period.');
    if (!line.matched) issues.push('Every statement line must be matched before approval.');
    movement = movement.plus(line.creditAmount).minus(line.debitAmount);
  }
  const calculatedClose = reconciliation.statementOpeningBalance.plus(movement);
  const bookClose = reconciliation.bookOpeningBalance.plus(movement);
  if (!calculatedClose.eq(reconciliation.statementClosingBalance))
    issues.push(
      'Statement opening balance plus its lines does not equal the statement closing balance.',
    );
  if (!bookClose.eq(reconciliation.statementClosingBalance))
    issues.push(
      'Book opening balance plus matched movements does not equal the statement closing balance.',
    );
  if (!reconciliation.bookClosingBalance.eq(bookClose))
    issues.push('The declared book closing balance does not match the reconciled movement.');
  return {
    issues,
    movement: movement.toFixed(4),
    calculatedClose: calculatedClose.toFixed(4),
    bookClose: bookClose.toFixed(4),
  };
}
