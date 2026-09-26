import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CategoryModal, Company, ExpenseCategory } from './page';
import {
  changeSelectField,
  getSelectField,
  selectFieldOptions,
  selectFieldText,
  selectFieldValue,
} from '@/test/select-field';

/**
 * Expense-category GL linkage regression.
 *
 * Backend expense pay() debits expenseCategory.linkedAccountId and hard-blocks
 * when it is null (expenses.service.ts). Before this page there was no UI to
 * set it. These tests pin the linkage contract:
 *   - The "Linked GL Account" selector loads the selected company's chart-of-
 *     accounts and shows ONLY expense-natured accounts (EXPENSE / COGS).
 *   - Create POSTs { companyId, name, linkedAccountId, isActive } to
 *     /api/backend/expense-categories with the chosen linkedAccountId.
 *   - Edit PATCHes /api/backend/expense-categories/:id, omits companyId, and
 *     can set/clear linkedAccountId (blank goes as null so the PartialType
 *     update DTO clears the column).
 *   - Backend errors surface and the modal stays open.
 */

const COMPANIES: Company[] = [
  { id: 'co-1', name: 'Acme TZ', code: 'ACME' },
  { id: 'co-2', name: 'Beta TZ', code: 'BETA' },
];

// Chart-of-accounts payload for co-1: two expense-natured accounts plus noise
// (an ASSET and a LIABILITY) that must NOT appear in the GL selector.
const COA_CO1 = {
  success: true,
  data: {
    data: [
      {
        id: 'acc-exp-1',
        accountCode: '6000',
        accountName: 'Office Supplies',
        accountType: 'EXPENSE',
        isActive: true,
        companyId: 'co-1',
      },
      {
        id: 'acc-cogs-1',
        accountCode: '5000',
        accountName: 'Cost of Goods',
        accountType: 'COST_OF_GOODS_SOLD',
        isActive: true,
        companyId: 'co-1',
      },
      {
        id: 'acc-asset-1',
        accountCode: '1000',
        accountName: 'Cash',
        accountType: 'ASSET',
        isActive: true,
        companyId: 'co-1',
      },
      {
        id: 'acc-liab-1',
        accountCode: '2000',
        accountName: 'Accounts Payable',
        accountType: 'LIABILITY',
        isActive: true,
        companyId: 'co-1',
      },
    ],
  },
};

let fetchMock: ReturnType<typeof vi.fn>;

const companyField = () => getSelectField('Company');
const glField = () => getSelectField('Linked GL Account');

// Wait until the GL selector offers the given account.
async function findGlOption(name: string) {
  await waitFor(() => expect(selectFieldOptions(glField())).toContain(name));
}

function mockFetch(handler: (url: string, init?: RequestInit) => any) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const result = handler(url, init);
    return { ok: true, status: 200, json: async () => result, ...(result?.__override ?? {}) };
  });
  globalThis.fetch = fetchMock as any;
}

beforeEach(() => {
  // Ensure requestAnimationFrame exists for the Modal focus handling.
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0)) as any;
    globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as any;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CategoryModal — GL account linkage', () => {
  it('loads the selected company chart-of-accounts and lists ONLY expense-natured accounts', async () => {
    mockFetch((url) => {
      if (url.includes('/chart-of-accounts')) return COA_CO1;
      return {};
    });

    render(
      <CategoryModal mode="create" companies={COMPANIES} onClose={() => {}} onSaved={() => {}} />,
    );

    // Choose a company — this triggers the COA fetch.
    changeSelectField(companyField(), 'co-1');

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/chart-of-accounts'));
      expect(call).toBeTruthy();
      expect(String(call![0])).toContain('companyId=co-1');
    });

    // Expense + COGS accounts appear; asset/liability filtered out.
    await findGlOption('6000 — Office Supplies');
    expect(selectFieldOptions(glField())).toContain('5000 — Cost of Goods');
    expect(selectFieldOptions(glField())).not.toContain('1000 — Cash');
    expect(selectFieldOptions(glField())).not.toContain('2000 — Accounts Payable');
  });

  it('POSTs create with the chosen linkedAccountId and companyId', async () => {
    mockFetch((url) => {
      if (url.includes('/chart-of-accounts')) return COA_CO1;
      return { success: true, data: { id: 'cat-1' } };
    });
    const onSaved = vi.fn();

    render(
      <CategoryModal mode="create" companies={COMPANIES} onClose={() => {}} onSaved={onSaved} />,
    );

    changeSelectField(companyField(), 'co-1');
    await findGlOption('6000 — Office Supplies');

    fireEvent.change(screen.getByPlaceholderText('e.g. Office Supplies'), {
      target: { value: 'Office Supplies' },
    });
    changeSelectField(glField(), 'acc-exp-1');
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]) === '/api/backend/expense-categories' &&
          (c[1] as RequestInit)?.method === 'POST',
      );
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body).toMatchObject({
        companyId: 'co-1',
        name: 'Office Supplies',
        linkedAccountId: 'acc-exp-1',
        isActive: true,
      });
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('PATCHes edit to /:id, omits companyId, and can change linkedAccountId', async () => {
    mockFetch((url) => {
      if (url.includes('/chart-of-accounts')) return COA_CO1;
      return { success: true, data: { id: 'cat-1' } };
    });
    const existing: ExpenseCategory = {
      id: 'cat-1',
      name: 'Office Supplies',
      description: null,
      linkedAccountId: null,
      isActive: true,
      companyId: 'co-1',
      createdAt: new Date().toISOString(),
    };

    render(
      <CategoryModal
        mode="edit"
        initial={existing}
        companies={COMPANIES}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    await findGlOption('6000 — Office Supplies');
    changeSelectField(glField(), 'acc-cogs-1');
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]) === '/api/backend/expense-categories/cat-1' &&
          (c[1] as RequestInit)?.method === 'PATCH',
      );
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.linkedAccountId).toBe('acc-cogs-1');
      expect(body).not.toHaveProperty('companyId');
    });
  });

  it('keeps the initial linkedAccountId while accounts load, and sends null when cleared', async () => {
    mockFetch((url) => {
      if (url.includes('/chart-of-accounts')) return COA_CO1;
      return { success: true, data: { id: 'cat-1' } };
    });
    const existing: ExpenseCategory = {
      id: 'cat-1',
      name: 'Office Supplies',
      description: null,
      linkedAccountId: 'acc-exp-1',
      isActive: true,
      companyId: 'co-1',
      createdAt: new Date().toISOString(),
    };

    render(
      <CategoryModal
        mode="edit"
        initial={existing}
        companies={COMPANIES}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    // Once accounts load, the pre-linked account is still selected.
    await findGlOption('6000 — Office Supplies');
    expect(selectFieldValue(glField())).toBe('acc-exp-1');

    // Clear the linkage and save: PATCH body carries linkedAccountId: null.
    changeSelectField(glField(), '');
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]) === '/api/backend/expense-categories/cat-1' &&
          (c[1] as RequestInit)?.method === 'PATCH',
      );
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.linkedAccountId).toBeNull();
    });
  });

  it('preserves a linked account missing from the active list on an unrelated edit (no silent clearing)', async () => {
    // The linked account was deactivated (or is not expense-typed), so the
    // isActive=true EXPENSE/COGS fetch does not return it. A rename must NOT
    // silently PATCH linkedAccountId: null — the existing posting link stays
    // until the user explicitly changes it.
    mockFetch((url) => {
      if (url.includes('/chart-of-accounts')) return COA_CO1;
      return { success: true, data: { id: 'cat-1' } };
    });
    const existing: ExpenseCategory = {
      id: 'cat-1',
      name: 'Fuel',
      description: null,
      linkedAccountId: 'acc-deactivated-1',
      isActive: true,
      companyId: 'co-1',
      createdAt: new Date().toISOString(),
    };

    render(
      <CategoryModal
        mode="edit"
        initial={existing}
        companies={COMPANIES}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    // Accounts load; the missing link is kept selectable via a synthetic option.
    await findGlOption('6000 — Office Supplies');
    expect(selectFieldOptions(glField())).toContain('Current account (inactive or unavailable)');
    expect(selectFieldText(glField())).toBe('Current account (inactive or unavailable)');
    expect(selectFieldValue(glField())).toBe('acc-deactivated-1');

    // Unrelated edit: rename only, then save.
    fireEvent.change(screen.getByPlaceholderText('e.g. Office Supplies'), {
      target: { value: 'Fuel & Oils' },
    });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]) === '/api/backend/expense-categories/cat-1' &&
          (c[1] as RequestInit)?.method === 'PATCH',
      );
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.name).toBe('Fuel & Oils');
      // The regression: this used to be null.
      expect(body.linkedAccountId).toBe('acc-deactivated-1');
    });
  });

  it('clears the chosen account only when the company changes in create mode', async () => {
    mockFetch((url) => {
      if (url.includes('/chart-of-accounts')) return COA_CO1;
      return {};
    });

    render(
      <CategoryModal mode="create" companies={COMPANIES} onClose={() => {}} onSaved={() => {}} />,
    );

    changeSelectField(companyField(), 'co-1');
    await findGlOption('6000 — Office Supplies');
    changeSelectField(glField(), 'acc-exp-1');
    expect(selectFieldValue(glField())).toBe('acc-exp-1');

    // Switching company invalidates the account choice — it belongs to co-1.
    changeSelectField(companyField(), 'co-2');
    await waitFor(() => {
      expect(selectFieldValue(companyField())).toBe('co-2');
    });
    expect(selectFieldValue(glField())).toBe('');
  });

  it('surfaces backend errors and keeps the modal open', async () => {
    mockFetch((url) => {
      if (url.includes('/chart-of-accounts')) return COA_CO1;
      // Save fails.
      return {
        __override: { ok: false, status: 409 },
        message: 'An expense category with this name already exists for this company',
      };
    });
    const onSaved = vi.fn();

    render(
      <CategoryModal mode="create" companies={COMPANIES} onClose={() => {}} onSaved={onSaved} />,
    );

    changeSelectField(companyField(), 'co-1');
    await findGlOption('6000 — Office Supplies');
    fireEvent.change(screen.getByPlaceholderText('e.g. Office Supplies'), {
      target: { value: 'Office Supplies' },
    });
    fireEvent.click(screen.getByText('Create'));

    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('validates that a name is required before saving', async () => {
    mockFetch((url) => {
      if (url.includes('/chart-of-accounts')) return COA_CO1;
      return {};
    });

    render(
      <CategoryModal mode="create" companies={COMPANIES} onClose={() => {}} onSaved={() => {}} />,
    );

    changeSelectField(companyField(), 'co-1');
    fireEvent.click(screen.getByText('Create'));

    expect(await screen.findByText(/Name is required/)).toBeInTheDocument();
    // No save request was issued.
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === 'POST')).toBe(false);
  });
});
