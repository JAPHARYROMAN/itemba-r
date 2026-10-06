import { ForbiddenException } from '@nestjs/common';
import { PayrollCashService } from './payroll-cash.service';
import { OrganizationScopeService } from '../../../common/services/organization-scope.service';
import { payloadKey } from '../../cash-desk/cash-desk.domain';
import { PayPayrollRunDto } from './dto/payroll-run-action.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';

const permissions = [
  'payroll.pay',
  'cash_desk.view',
  'cash_desk.record',
  'journal_entries.create',
  'journal_entries.post',
];
const actor = { id: 'payer', permissions, roleScopes: ['COMPANY'] };
const dto = { requestId: 'request', cashDeskAccountId: 'cash', businessDate: '2026-01-01' };
const run = { id: 'run', status: 'PAID' };
describe('Payroll cash payment controls', () => {
  it('deducts both cash balances for an owned payroll payment and restores only recorded ERP effects', async () => {
    const decimal = (value: number) => new Prisma.Decimal(value);
    const account: any = {
      id: 'desk',
      erpCashAccountId: 'erp',
      companyId: 'company',
      currency: 'TZS',
      divisionId: null,
      branchId: null,
      openingDate: new Date('2026-01-01'),
    };
    let erp = decimal(100),
      desk = decimal(100),
      originalApplied = true;
    const entries: any[] = [];
    const tx: any = {
      cashAccount: {
        findFirst: jest.fn(async () => ({
          id: 'erp',
          companyId: 'company',
          currency: 'TZS',
          divisionId: null,
          branchId: null,
          ledgerAccount: {
            companyId: 'company',
            isActive: true,
            accountType: 'ASSET',
            divisionId: null,
            branchId: null,
          },
        })),
        updateMany: jest.fn(async ({ data }: any) => {
          erp = erp.plus(data.currentBalance.increment);
          return { count: 1 };
        }),
      },
      cashDeskEntry: {
        groupBy: jest.fn(async () => [
          { businessDate: new Date('2026-01-01'), _sum: { amount: desk } },
        ]),
        findFirst: jest.fn(async () => ({ erpBalanceApplied: originalApplied })),
      },
      cashDeskMovement: {
        create: jest.fn(async ({ data }: any) => {
          entries.push(data.entries.create);
          return { id: 'movement' };
        }),
      },
      cashDeskAccount: {
        update: jest.fn(async ({ data }: any) => {
          desk = data.balance;
        }),
      },
    };
    const cash = new PayrollCashService(
      {} as never,
      {} as never,
      { logStrictInTransaction: jest.fn() } as never,
      {} as never,
    );
    const input = {
      requestId: 'payment',
      key: 'key',
      date: new Date('2026-01-02'),
      amount: decimal(-30),
      journalId: 'journal',
    };
    await (cash as any).movement(
      tx,
      { id: 'run', companyId: 'company', payrollRunNumber: 'PAY' },
      actor,
      account,
      input,
    );
    expect([erp.toString(), desk.toString()]).toEqual(['70', '70']);
    expect(entries[0].erpBalanceApplied).toBe(true);
    await (cash as any).movement(
      tx,
      { id: 'run', companyId: 'company', payrollRunNumber: 'PAY' },
      actor,
      account,
      { ...input, amount: decimal(30), reversalOfId: 'payment' },
    );
    expect([erp.toString(), desk.toString()]).toEqual(['100', '100']);
    originalApplied = false;
    desk = decimal(70);
    await (cash as any).movement(
      tx,
      { id: 'run', companyId: 'company', payrollRunNumber: 'PAY' },
      actor,
      account,
      { ...input, amount: decimal(30), reversalOfId: 'old-payment' },
    );
    expect([erp.toString(), desk.toString()]).toEqual(['100', '100']);
    expect(entries[2].erpBalanceApplied).toBe(false);
  });
  const service = new PayrollCashService(
    new OrganizationScopeService({} as never),
    {} as never,
    {} as never,
    {} as never,
  );
  it.each(permissions)('requires %s in addition to payroll permission', async (permission) => {
    await expect(
      service.authorize({
        ...actor,
        permissions: permissions.filter((p) => p !== permission),
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each(['DIVISION', 'BRANCH'])(
    'does not let a %s actor disburse company-wide payroll',
    async (scope) => {
      await expect(
        service.authorize({ ...actor, roleScopes: [scope] } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
  it('requires both reversal permissions', async () => {
    await expect(service.authorize(actor as never, true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.authorize(
        {
          ...actor,
          permissions: [...permissions, 'cash_desk.reverse', 'journal_entries.reverse'],
        } as never,
        true,
      ),
    ).resolves.toBeUndefined();
  });
  it('accepts an identical committed retry without replaying side effects', async () => {
    const previous = {
      payrollRunId: 'run',
      payloadKey: payloadKey({ runId: run.id, ...dto }),
      reversedAt: null,
    };
    const tx = { cashDeskMovement: { findUnique: jest.fn().mockResolvedValue(previous) } };
    await expect(service.payment(tx as never, run as never, actor as never, dto)).resolves.toEqual({
      duplicate: true,
      movement: previous,
    });
  });
  it.each([{ payrollRunId: 'another-run' }, { payloadKey: 'changed' }, { reversedAt: new Date() }])(
    'rejects reused request keys with changed or reversed evidence',
    async (override) => {
      const previous = {
        payrollRunId: 'run',
        payloadKey: payloadKey({ runId: run.id, ...dto }),
        reversedAt: null,
        ...override,
      };
      const tx = { cashDeskMovement: { findUnique: jest.fn().mockResolvedValue(previous) } };
      await expect(service.payment(tx as never, run as never, actor as never, dto)).rejects.toThrow(
        'changed or was reversed',
      );
    },
  );
  it('rejects missing account, request key and date instead of silently choosing Bank 1010', async () => {
    const errors = await validate(plainToInstance(PayPayrollRunDto, {}));
    expect(errors.map((e) => e.property).sort()).toEqual([
      'businessDate',
      'cashDeskAccountId',
      'requestId',
    ]);
  });
});
