import { Capability } from '../../common/capabilities/capability-manifest';
import { matchMeasuredFastPath, resolveMeasuredFastPath } from './measured-fast-path';
import { buildRegistry } from './tool-registry';

function capability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: 'ExpensesController.findAll',
    controller: 'ExpensesController',
    handler: 'findAll',
    verb: 'GET',
    path: 'expenses',
    permissions: ['expenses.view'],
    anyPermissions: [],
    roles: [],
    apiScopes: [],
    guard: 'permission',
    tier: 'green',
    tierReason: 'read-verb',
    params: { path: [], query: [], freeFormQuery: true, hasBody: false },
    agentExcluded: false,
    ...overrides,
  };
}

describe('measured fast-path run policy', () => {
  it.each([
    'What did we spend money on recently?',
    'Show me our recent expenses.',
    'Give me an expense breakdown for last week.',
    'List expenditure details this quarter.',
    'Show expense transactions from last month.',
  ])('%s selects the recent expense-detail read', (prompt) => {
    expect(matchMeasuredFastPath(prompt)).toEqual({
      id: 'recent-expense-detail',
      capabilityId: 'ExpensesController.findAll',
      maxAttempts: 2,
    });
  });

  it.each([
    'Create an expense for fuel.',
    'Show recent expenses and unpaid bills.',
    'Compare expenses versus payables.',
    'Why did spending increase?',
    'Show spending trends.',
    'Give me an expense variance report.',
    'What do we owe our suppliers?',
    'What is an expense?',
    'Show expense categories.',
    'What is our expense policy?',
    'How much have we spent this month?',
    'Show all expenses.',
    'What did we spend on payroll last month?',
    'What did we spend on taxes last quarter?',
    'What did we spend on supplier payments recently?',
    'Show recent expenses plus payroll.',
    'Show recent expenses with payroll.',
    'Show recent expenses & payroll.',
    'What did we spend on purchase orders last month?',
    'What did we spend on fixed assets last quarter?',
    'Show recent expenses or cash balances.',
  ])('%s remains on ordinary tool search', (prompt) => {
    expect(matchMeasuredFastPath(prompt)).toBeUndefined();
  });

  it('resolves only a permitted green GET capability', () => {
    const question = 'What did we spend money on recently?';
    const permitted = buildRegistry([capability()], ['expenses.view'], ['green']);
    const missingPermission = buildRegistry([capability()], [], ['green']);
    const amber = buildRegistry([capability({ tier: 'amber' })], ['expenses.view'], ['amber']);
    const post = buildRegistry([capability({ verb: 'POST' })], ['expenses.view'], ['green']);

    expect(resolveMeasuredFastPath(question, permitted)).toMatchObject({
      toolName: 'Expenses_findAll',
      capabilityId: 'ExpensesController.findAll',
    });
    expect(resolveMeasuredFastPath(question, missingPermission)).toBeUndefined();
    expect(resolveMeasuredFastPath(question, amber)).toBeUndefined();
    expect(resolveMeasuredFastPath(question, post)).toBeUndefined();
  });
});
