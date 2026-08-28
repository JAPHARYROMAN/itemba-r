import {
  capabilityRequiresSensitiveAccessAudit,
  isSensitiveAccessController,
} from './sensitive-access-policy';
import { SENSITIVE_ACCESS_KEY } from '../decorators/sensitive-access.decorator';
import { BankAccountsController } from '../../modules/bank-accounts/bank-accounts.controller';
import { ContractsController } from '../../modules/contracts/contracts.controller';
import { DebtsController } from '../../modules/debts/debts.controller';
import { FixedAssetsController } from '../../modules/fixed-assets/fixed-assets.controller';
import { LoansController } from '../../modules/loans/loans.controller';
import { DashboardController } from '../../modules/dashboard/dashboard.controller';

describe('sensitive access policy', () => {
  it('declares executive aggregates as sensitive even with any-permission access', () => {
    expect(
      capabilityRequiresSensitiveAccessAudit({
        id: 'DashboardController.getExecutiveSummary',
        permissions: [],
        anyPermissions: ['operations.dashboard.view', 'group-control.view'],
      }),
    ).toBe(true);
  });

  it('keeps unrelated dashboard capabilities outside the policy', () => {
    expect(
      capabilityRequiresSensitiveAccessAudit({
        id: 'DashboardController.notSensitive',
        permissions: [],
        anyPermissions: ['operations.dashboard.view'],
      }),
    ).toBe(false);
    expect(isSensitiveAccessController('DashboardController')).toBe(true);
  });

  it('keeps the evidence policy aligned with explicit route metadata', () => {
    for (const [controller, entityType] of [
      [BankAccountsController, 'BankAccounts'],
      [ContractsController, 'Contracts'],
      [DebtsController, 'Debts'],
      [FixedAssetsController, 'FixedAssets'],
      [LoansController, 'Loans'],
    ] as const) {
      expect(Reflect.getMetadata(SENSITIVE_ACCESS_KEY, controller)).toEqual({ entityType });
    }

    expect(
      Reflect.getMetadata(SENSITIVE_ACCESS_KEY, DashboardController.prototype.getExecutiveSummary),
    ).toEqual({ entityType: 'Dashboard' });
  });
});
