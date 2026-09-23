import { ReceivablesService } from './receivables.service';
import { PayablesService } from '../payables/payables.service';
import { ExpensesService } from '../expenses/expenses.service';

describe('Financial workspace search', () => {
  it.each(['receivable', 'payable', 'expense'] as const)(
    '%s searches before pagination without replacing the company access boundary',
    async (kind) => {
      const model = {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(43),
      };
      const prisma = { [kind]: model } as any;
      const scope = {
        accessibleCompanyIds: jest.fn().mockResolvedValue(['allowed']),
        companyWhereFor: jest.fn().mockResolvedValue({
          OR: [{ companyId: 'allowed' }],
          AND: [{ companyId: { not: 'revoked' } }],
        }),
      } as any;
      const unused = {} as any;
      const service =
        kind === 'receivable'
          ? new ReceivablesService(prisma, unused, scope, unused, unused, unused)
          : kind === 'payable'
            ? new PayablesService(prisma, unused, scope, unused, unused, unused)
            : new ExpensesService(prisma, unused, unused, unused, scope, unused, unused, unused);
      const user = { id: 'reader' } as any;
      const result = await service.findAll({ search: '  Acme  ', page: 2, limit: 20 }, user);
      const args = model.findMany.mock.calls[0][0];
      if (kind === 'expense') {
        expect(scope.companyWhereFor).toHaveBeenCalledWith(user, undefined);
        expect(args.where.OR).toEqual([{ companyId: 'allowed' }]);
        expect(args.where.AND[0]).toEqual({ companyId: { not: 'revoked' } });
      } else {
        expect(scope.accessibleCompanyIds).toHaveBeenCalledWith(user);
        expect(args.where.companyId).toEqual({ in: ['allowed'] });
      }
      expect(args.where.AND.at(-1).OR).toContainEqual({
        [`${kind}Number`]: { contains: 'Acme', mode: 'insensitive' },
      });
      expect(args.where.deletedAt).toBeNull();
      expect(args).toMatchObject({ skip: 20, take: 20 });
      expect(model.count).toHaveBeenCalledWith({ where: args.where });
      expect(result.total).toBe(43);
      expect(result.totalPages).toBe(3);
    },
  );
});
