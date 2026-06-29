import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { QueryBankAccountDto } from '../modules/bank-accounts/dto/query-bank-account.dto';
import { QueryCashAccountDto } from '../modules/cash-accounts/dto/query-cash-account.dto';
import { QueryChartOfAccountDto } from '../modules/chart-of-accounts/dto/query-chart-of-account.dto';
import { QueryDocumentDto } from '../modules/documents/dto/query-document.dto';
import { QueryExpenseCategoryDto } from '../modules/expense-categories/dto/query-expense-category.dto';
import { QuerySalesChannelDto } from '../modules/sales-channels/dto/query-sales-channel.dto';
import { QueryApiRequestLogDto } from '../modules/api-request-logs/dto/query-api-request-log.dto';

// Exercise each boolean query DTO through the SAME ValidationPipe config as
// main.ts. Under enableImplicitConversion a boolean-typed field is coerced from
// any non-empty string to `true` BEFORE @Transform runs, so the fix
// (@Type(() => String) before @Transform) is what keeps "false" -> false.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const cases: Array<[string, unknown, string]> = [
  ['QueryBankAccountDto', QueryBankAccountDto, 'isActive'],
  ['QueryCashAccountDto', QueryCashAccountDto, 'isActive'],
  ['QueryChartOfAccountDto', QueryChartOfAccountDto, 'isActive'],
  ['QueryDocumentDto', QueryDocumentDto, 'isConfidential'],
  ['QueryExpenseCategoryDto', QueryExpenseCategoryDto, 'isActive'],
  ['QuerySalesChannelDto', QuerySalesChannelDto, 'isActive'],
  ['QueryApiRequestLogDto', QueryApiRequestLogDto, 'rateLimited'],
];

describe('boolean query-param coercion under enableImplicitConversion', () => {
  it.each(cases)('%s coerces its boolean param both ways', async (_name, Dto, field) => {
    const run = (raw: string) =>
      pipe.transform(
        { [field]: raw },
        { type: 'query', metatype: Dto as never } as never,
      ) as Promise<Record<string, unknown>>;
    expect((await run('true'))[field]).toBe(true);
    expect((await run('false'))[field]).toBe(false);
  });
});
