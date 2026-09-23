import { ForbiddenException } from '@nestjs/common';
import { PayrollCashService } from './payroll-cash.service';
import { OrganizationScopeService } from '../../../common/services/organization-scope.service';
import { payloadKey } from '../../cash-desk/cash-desk.domain';
import { PayPayrollRunDto } from './dto/payroll-run-action.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

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
