import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Drive the shared SelectField (and FormSelect, which renders one) the way the
 * replaced native `<select>` was driven:
 *
 * - `getByRole('combobox', { name })` → `getSelectField(name)` / `findSelectField(name)`
 * - `fireEvent.change(select, { target: { value } })` → `changeSelectField(field, value)`
 * - `user.selectOptions(select, valueOrText)` → `await chooseSelectOption(field, valueOrText, user)`
 * - `expect(select).toHaveValue(value)` → `expect(selectFieldValue(field)).toBe(value)`
 * - options of a closed select (`findByRole('option', { name })`, `within(select).getAllByRole('option')`)
 *   → `selectFieldOptions(field)`, e.g. `await waitFor(() => expect(selectFieldOptions(field)).toContain(name))`
 */

type User = Pick<ReturnType<typeof userEvent.setup>, 'click' | 'keyboard'>;
export type SelectFieldScope = HTMLElement;

function escape(label: string): string {
  return label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The trigger is named "<current choice> <label>", and a required field's label
// ends in " (required)" (its visible `*` is hidden from the name).
function nameMatcher(label: string | RegExp): RegExp {
  if (label instanceof RegExp) return label;
  return new RegExp(`(^|\\s)${escape(label)}(\\s?\\*|\\s\\(required\\))?$`);
}

/**
 * Find a shared select field's trigger by its label. Pass a RegExp to match the
 * trigger's whole name, which is "<current choice> <label>".
 *
 * The label is matched at the end of the trigger's name rather than with
 * `getByLabelText`, which also reaches React Aria's inert native `<select>` and
 * so finds two elements.
 */
export function getSelectField(label: string | RegExp, scope?: SelectFieldScope): HTMLElement {
  const queries = scope ? within(scope) : screen;
  return queries.getByRole('button', { name: nameMatcher(label) });
}

/** Wait for a select field that renders once its data has loaded. */
export function findSelectField(
  label: string | RegExp,
  scope?: SelectFieldScope,
): Promise<HTMLElement> {
  const queries = scope ? within(scope) : screen;
  return queries.findByRole('button', { name: nameMatcher(label) });
}

export function querySelectField(
  label: string | RegExp,
  scope?: SelectFieldScope,
): HTMLElement | null {
  const queries = scope ? within(scope) : screen;
  return queries.queryByRole('button', { name: nameMatcher(label) });
}

/** React Aria's hidden native select, which always holds the field's value. */
function hiddenSelect(field: HTMLElement): HTMLSelectElement {
  const select = field.closest('.ui-select')?.querySelector('select');
  if (!select)
    throw new Error('Not a SelectField trigger, or its list is too long for a native select');
  return select;
}

/** The current value, `''` included — what the replaced select's `value` read. */
export function selectFieldValue(field: HTMLElement): string {
  return hiddenSelect(field).value;
}

/** The label of the current choice, or the placeholder when nothing matches. */
export function selectFieldText(field: HTMLElement): string {
  return field.querySelector('.ui-select-value')?.textContent ?? '';
}

/**
 * Set a value synchronously, as `fireEvent.change` on the old select did. It goes
 * through React Aria's hidden select — the path browser autofill takes — so the
 * field reports the change exactly as a choice from the list would.
 *
 * Throws when no option has that value, where the native select would have
 * silently fallen back to its first option.
 */
export function changeSelectField(
  field: HTMLElement | string | RegExp,
  value: string,
  scope?: SelectFieldScope,
): void {
  const trigger = field instanceof HTMLElement ? field : getSelectField(field, scope);
  const select = hiddenSelect(trigger);
  if (![...select.options].some((option) => option.value === value)) {
    const values = [...select.options].map((option) => JSON.stringify(option.value)).join(', ');
    throw new Error(`No option with value "${value}". Values: ${values}`);
  }
  fireEvent.change(select, { target: { value } });
}

async function openList(trigger: HTMLElement, user: User): Promise<HTMLElement> {
  await user.click(trigger);
  return screen.findByRole('listbox');
}

/**
 * Open a shared select field and pick an option the way an operator would. Like
 * `user.selectOptions`, a string matches an option's value or its visible
 * label; a RegExp matches the label, for rows that carry more than a name.
 *
 * The list is portaled to `<body>`, so the option is found on the whole screen
 * even when the field is looked up within `scope`. Pass the caller's own
 * `userEvent` instance when it has one.
 */
export async function chooseSelectOption(
  field: HTMLElement | string | RegExp,
  option: string | RegExp,
  user: User = userEvent,
  scope?: SelectFieldScope,
): Promise<void> {
  const trigger = field instanceof HTMLElement ? field : getSelectField(field, scope);
  const listbox = await openList(trigger, user);
  const rows = within(listbox).queryAllByRole('option');
  const match = rows.find((row) =>
    option instanceof RegExp
      ? option.test(row.textContent ?? '')
      : row.getAttribute('data-key') === option || row.textContent === option,
  );
  if (!match) {
    const shown = rows.map((row) => `${row.getAttribute('data-key')}=${row.textContent}`);
    throw new Error(`No option matching ${String(option)}. Options: ${shown.join(', ')}`);
  }
  await user.click(match);
}

/**
 * The labels the field offers, in order, without opening it — what a closed
 * native select's options read. They come from React Aria's hidden select,
 * which mirrors the list item for item.
 */
export function selectFieldOptions(field: HTMLElement): string[] {
  // React Aria leads its hidden select with a blank row of its own.
  return [...hiddenSelect(field).options].slice(1).map((option) => option.textContent ?? '');
}
