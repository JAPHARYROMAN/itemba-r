import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type User = Pick<ReturnType<typeof userEvent.setup>, 'click' | 'keyboard'>;
type DateFieldQueries = {
  getByRole: typeof screen.getByRole;
  queryByRole: typeof screen.queryByRole;
};
export type DateFieldScope = HTMLElement | DateFieldQueries;

function queries(scope?: DateFieldScope): DateFieldQueries {
  if (!scope) return screen;
  if (typeof (scope as DateFieldQueries).getByRole === 'function' && !('nodeType' in scope)) {
    return scope as DateFieldQueries;
  }
  return within(scope as HTMLElement);
}

function nameMatcher(label: string | RegExp): RegExp {
  if (label instanceof RegExp) return label;
  return new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

/**
 * Find a shared date field by its label.
 *
 * The field is a composite widget rather than a single input, so it answers to
 * `getByRole('group')` and not to `getByLabelText`. Tests that used to reach a
 * native date input by label come here instead. `getByLabelText` now matches
 * both the group and React Aria's inert native shim, which is why those queries
 * fail after the migration.
 */
export function getDateField(label: string | RegExp, scope?: DateFieldScope): HTMLElement {
  return queries(scope).getByRole('group', { name: nameMatcher(label) });
}

export function queryDateField(
  label: string | RegExp,
  scope?: DateFieldScope,
): HTMLElement | null {
  return queries(scope).queryByRole('group', { name: nameMatcher(label) });
}

/**
 * The ISO value currently shown, or `''` when the field is empty.
 *
 * Day fields show DD/MM/YYYY and report `YYYY-MM-DD`. Minute fields add a
 * 24-hour clock and report `YYYY-MM-DDTHH:mm`.
 */
export function dateFieldValue(field: HTMLElement): string {
  const shown = field.querySelector('.ui-date-segments')?.textContent ?? '';
  const digits = shown.replace(/\D+/g, '');
  if (digits.length >= 12) {
    return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}`;
  }
  if (digits.length === 8) {
    return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
  }
  return '';
}

/**
 * Type an ISO date or local datetime into a shared date field, the way an
 * operator would: focus the first segment and type the digits straight through.
 * The field is pinned to en-GB with a 24-hour clock, so the segments run day,
 * month, year, then hour and minute when the field has minute granularity.
 *
 * Pass `''` to clear the field. Pass the caller's own `userEvent` instance when
 * it has one — a second instance would install its own clock and pointer state
 * alongside the first.
 */
export async function setDateField(
  field: HTMLElement | string | RegExp,
  iso: string,
  user: User = userEvent,
  scope?: DateFieldScope,
): Promise<void> {
  const target =
    typeof field === 'string' || field instanceof RegExp ? getDateField(field, scope) : field;
  if (iso === '') {
    const segments = within(target).getAllByRole('spinbutton');
    // Clicking a segment does not always select its contents, so one Backspace
    // only peels a digit. Four covers a four-digit year; day and month empty
    // sooner and the extra keystrokes are no-ops on a placeholder.
    for (const segment of [...segments].reverse()) {
      await user.click(segment);
      await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}');
    }
    return;
  }
  const [datePart, timePart] = iso.split('T');
  const [year, month, day] = datePart.split('-');
  if (!year || !month || !day) {
    throw new Error(`setDateField expects an ISO YYYY-MM-DD or YYYY-MM-DDTHH:mm value, received "${iso}"`);
  }
  const digits = timePart
    ? `${day}${month}${year}${(timePart.split(':')[0] ?? '').padStart(2, '0')}${(timePart.split(':')[1] ?? '').padStart(2, '0')}`
    : `${day}${month}${year}`;
  await user.click(within(target).getAllByRole('spinbutton')[0]);
  await user.keyboard(digits);
}
