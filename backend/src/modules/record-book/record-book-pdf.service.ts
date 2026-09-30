import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { GeneratedDocumentsService } from '../generated-documents/generated-documents.service';
import { RecordBookService } from './record-book.service';
import { RecordBookReportsService } from './record-book-reports.service';
import { RecordBookPdfQuery } from './dto/record-book.dto';
import { bookPdf, BookPdfGroup, BookPdfRow } from './record-book.pdf';

const LIMIT = 5000;
@Injectable()
export class RecordBookPdfService {
  constructor(
    private readonly records: RecordBookService,
    private readonly documents: GeneratedDocumentsService,
    private readonly reports: RecordBookReportsService,
  ) {}

  async export(query: RecordBookPdfQuery, user: AuthUser) {
    const type = query.type ?? 'combined';
    if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo)
      throw new BadRequestException('Start date must be on or before end date.');
    if (query.recordId && type !== 'sales' && type !== 'expenses')
      throw new BadRequestException('Choose daily sales or money out for an individual record.');
    const groups: BookPdfGroup[] = [];
    const q = {
      ...(type === 'trash' || type === 'categories'
        ? { companyId: query.companyId, search: query.search }
        : query),
      page: 1,
      limit: LIMIT + 1,
      ...(type === 'trash' ? { recordState: 'DELETED' as const } : {}),
    };
    const add = (
      kind: BookPdfGroup['kind'],
      title: string,
      result: { data: BookPdfRow[]; total: number },
    ) => {
      if (result.total > LIMIT || result.data.length > LIMIT)
        throw new BadRequestException('Narrow the filters to export up to 5,000 records.');
      groups.push({ kind, title, rows: result.data });
    };
    let source = { companyId: query.companyId, branchId: undefined as string | undefined };
    if (query.recordId) {
      const row =
        type === 'sales'
          ? await this.records.findDailySale(query.recordId, user)
          : await this.records.findExpense(query.recordId, user);
      source = { companyId: row.companyId, branchId: row.branchId || undefined };
      add(
        type === 'sales' ? 'sales' : 'expenses',
        type === 'sales' ? 'Daily sales record' : 'Money out record',
        {
          data: [row],
          total: 1,
        },
      );
    } else {
      if (['sales', 'combined', 'trash'].includes(type))
        add('sales', 'Daily sales', await this.records.findDailySales(q, user));
      if (['expenses', 'combined', 'trash'].includes(type))
        add('expenses', 'Money out', await this.records.findExpenses(q, user));
      if (['categories', 'trash'].includes(type))
        add('categories', 'Categories', await this.records.findCategories(q, user));
    }
    const count = groups.reduce((n, g) => n + g.rows.length, 0);
    if (count > LIMIT)
      throw new BadRequestException('Narrow the filters to export up to 5,000 records.');
    const categoryOnly = type === 'categories';
    const model = bookPdf(
      `Records - ${type === 'trash' ? 'Trash' : categoryOnly ? 'Categories' : type === 'sales' ? 'Daily sales' : type === 'expenses' ? 'Money out' : 'Daily overview'}`,
      groups,
      query.recordId
        ? []
        : [
            {
              label: 'Company',
              value: query.companyId
                ? groups.flatMap((g) => g.rows).find((r) => r.company)?.company?.name ||
                  query.companyId
                : 'All accessible companies',
            },
            {
              label: 'Record dates',
              value:
                categoryOnly || type === 'trash'
                  ? 'Not filtered by date'
                  : `${query.dateFrom || 'Beginning'} to ${query.dateTo || 'Latest record'}`,
            },
            ...(!categoryOnly && type !== 'trash'
              ? [
                  {
                    label: 'Division',
                    value: query.divisionId
                      ? groups.flatMap((g) => g.rows).find((r) => r.division)?.division?.name ||
                        query.divisionId
                      : 'All accessible divisions',
                  },
                  {
                    label: 'Branch',
                    value: query.branchId
                      ? groups.flatMap((g) => g.rows).find((r) => r.branch)?.branch?.name ||
                        query.branchId
                      : 'All accessible branches',
                  },
                ]
              : []),
            { label: 'Search', value: query.search || 'All records' },
            {
              label: 'Status',
              value:
                type === 'trash'
                  ? 'Deleted records only'
                  : categoryOnly
                    ? 'All non-deleted categories'
                    : query.status || 'All statuses',
            },
            ...(!categoryOnly
              ? [
                  {
                    label: 'Currency',
                    value:
                      type === 'trash'
                        ? 'Separate totals by currency'
                        : query.currency || 'Separate totals by currency',
                  },
                ]
              : []),
            ...(categoryOnly
              ? [
                  {
                    label: 'Category scope',
                    value:
                      'Company-level categories; transaction dates, division, branch and currency do not filter categories.',
                  },
                ]
              : []),
          ],
      !!query.recordId,
    );
    const buffer = await this.documents.renderLetterheadPdf(source, model, user);
    await this.reports.auditExport(
      {
        scope: 'raw',
        format: 'pdf',
        rowCount: count,
        companyId: source.companyId,
        ...(query.recordId ? {} : { dateFrom: query.dateFrom, dateTo: query.dateTo }),
      },
      user,
    );
    return {
      buffer,
      filename: `records-${type}${query.recordId ? `-${query.recordId.slice(0, 8)}` : ''}.pdf`,
    };
  }
}
