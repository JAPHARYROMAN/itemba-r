import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, backendGet, backendPost } from '@/lib/api-client';
import { ReportEditor } from './report-editor';
import { newPayload, type Payload, type Report, type Workspace } from './types';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: () => false }),
}));
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  backendGet: vi.fn(),
  backendPost: vi.fn(),
}));

const branch = {
  id: 'station',
  name: 'Station',
  companyId: 'company',
  companyName: 'Company',
  companyCode: 'MWANJALISI',
};
const date = '2026-11-06';
const catalog = { nozzles: [], tanks: [] };
const initial = newPayload(catalog, null);

function report(version: number, changes: Partial<Payload> = {}, status = 'DRAFT'): Report {
  return {
    id: 'shift',
    branchId: branch.id,
    businessDate: date,
    shift: 'DAY',
    status,
    version,
    payload: {
      ...initial,
      ...changes,
      catalog,
      companyName: branch.companyName,
      branchName: branch.name,
    },
    summary: {
      sales: 0,
      litres: 0,
      collected: 0,
      credit: 0,
      expenses: 0,
      purchases: 0,
      unpricedDeliveries: 0,
      cashOut: 0,
      expectedCash: 0,
      flagged: 0,
      issues: [],
      stock: [],
      discrepancies: [],
    },
    updatedAt: date,
    closedAt: status === 'CLOSED' ? date : null,
  };
}

function workspace(current: Report | null): Workspace {
  return {
    canManageReports: true,
    catalog,
    report: current,
    previous: null,
    daily: [],
    products: [],
    pumps: [],
  };
}

function renderEditor(current: Report | null, canManage = true) {
  render(
    <ReportEditor
      branch={branch}
      date={date}
      shift="DAY"
      workspace={workspace(current)}
      canManage={canManage}
      mode="report"
      onSaved={vi.fn()}
      onLock={vi.fn()}
      apiBase="/petrodollar"
    />,
  );
  return screen.getByRole('textbox', { name: 'Shift notes' });
}

const saveDraft = () => screen.getByRole('button', { name: 'Save draft' });
const loadLatest = () => screen.getByRole('button', { name: 'Load latest revision' });
const post = vi.mocked(backendPost);
const get = vi.mocked(backendGet);
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const stale = () =>
  new ApiError('This report changed in another window. Reload before saving.', 409, null);

describe('PetroDollar draft entry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('focuses the close confirmation and restores the opener on cancel or Escape', () => {
    renderEditor(report(2));
    const review = screen.getByRole('button', { name: 'Review & close shift' });
    fireEvent.click(review);
    const heading = screen.getByRole('heading', { name: 'Close the day shift?' });
    expect(heading).toHaveFocus();
    fireEvent.keyDown(heading, { key: 'Escape' });
    expect(review).toHaveFocus();
    expect(heading).not.toBeInTheDocument();

    fireEvent.click(review);
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(review).toHaveFocus();
    expect(post).not.toHaveBeenCalled();
  });

  it('keeps a station’s read-only report visible and prevents editing', () => {
    const notes = renderEditor(report(2, { notes: 'Read-only draft' }), false);
    expect(notes).toHaveValue('Read-only draft');
    expect(notes).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
  });

  it('keeps focus and totals in place while serializing new edits against the saved revision', async () => {
    let finishFirstSave!: (result: Report) => void;
    post
      .mockReturnValueOnce(
        new Promise<Report>((resolve) => {
          finishFirstSave = resolve;
        }),
      )
      .mockResolvedValueOnce(report(2, { notes: 'Second entry' }));
    const notes = renderEditor(null);
    const totals = screen.getByRole('group', { name: 'Last saved shift totals' });
    const history = screen.getByRole('button', { name: 'View revision history' });

    notes.focus();
    fireEvent.change(notes, { target: { value: 'First entry' } });
    await tick(1600);
    expect(notes).toBeEnabled();
    expect(notes).toHaveFocus();
    expect(totals).toBeInTheDocument();
    expect(saveDraft()).toBeDisabled();
    expect(post).toHaveBeenNthCalledWith(
      1,
      '/petrodollar/reports',
      expect.objectContaining({
        version: 0,
        payload: expect.objectContaining({ notes: 'First entry' }),
      }),
    );

    fireEvent.change(notes, { target: { value: 'Second entry' } });
    await tick(3000);
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => finishFirstSave(report(1, { notes: 'First entry' })));
    expect(notes).toHaveValue('Second entry');
    expect(notes).toHaveFocus();
    expect(totals).toBeInTheDocument();
    expect(history).toBeInTheDocument();

    await tick(1600);
    expect(post).toHaveBeenNthCalledWith(
      2,
      '/petrodollar/reports',
      expect.objectContaining({
        version: 1,
        payload: expect.objectContaining({ notes: 'Second entry' }),
      }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved · revision 2');
    expect(notes).toHaveFocus();
  });

  it('keeps local entries after a conflict and brings in changes from untouched sections', async () => {
    post.mockRejectedValueOnce(stale()).mockResolvedValueOnce(report(4));
    get.mockResolvedValueOnce(
      workspace(
        report(3, {
          notes: 'Other operator’s notes',
          discrepancyReason: 'Other operator’s explanation',
        }),
      ),
    );
    const notes = renderEditor(report(2));

    fireEvent.change(notes, { target: { value: 'My entries' } });
    await tick(1600);
    expect(saveDraft()).toBeDisabled();
    expect(notes).toHaveValue('My entries');

    await act(async () => fireEvent.click(loadLatest()));
    expect(get).toHaveBeenCalledWith('/petrodollar/workspace', {
      query: { branchId: branch.id, businessDate: date, shift: 'DAY' },
    });
    expect(screen.getByText(/Both drafts changed shift notes/)).toBeInTheDocument();
    expect(notes).toHaveValue('My entries');
    fireEvent.click(screen.getByRole('button', { name: 'Apply my entries to revision 3' }));
    expect(notes).toHaveValue('My entries');
    expect(screen.getByRole('textbox', { name: 'Explanation of discrepancies' })).toHaveValue(
      'Other operator’s explanation',
    );

    await tick(3000);
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.click(saveDraft()));
    expect(post).toHaveBeenNthCalledWith(
      2,
      '/petrodollar/reports',
      expect.objectContaining({
        version: 3,
        payload: expect.objectContaining({
          notes: 'My entries',
          discrepancyReason: 'Other operator’s explanation',
        }),
      }),
    );
  });

  it('holds on to local entries when the latest shift is closed and allows recovery after reopening', async () => {
    post.mockRejectedValueOnce(stale());
    get
      .mockResolvedValueOnce(workspace(report(3, {}, 'CLOSED')))
      .mockResolvedValueOnce(workspace(report(4)));
    const notes = renderEditor(report(2));
    fireEvent.change(notes, { target: { value: 'Still editing' } });
    await tick(1600);

    await act(async () => fireEvent.click(loadLatest()));
    expect(screen.getByText(/Revision 3 is closed/)).toBeInTheDocument();
    expect(notes).toHaveValue('Still editing');
    expect(saveDraft()).toBeDisabled();

    await act(async () => fireEvent.click(loadLatest()));
    fireEvent.click(screen.getByRole('button', { name: 'Apply my entries to revision 4' }));
    expect(notes).toHaveValue('Still editing');
    expect(saveDraft()).toBeEnabled();
    expect(post).toHaveBeenCalledTimes(1);
  });
});
