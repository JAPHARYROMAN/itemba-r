import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type User = Pick<ReturnType<typeof userEvent.setup>, 'click'>;
export type SelectFieldScope = HTMLElement;

function escape(label: string): string {
  return label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The trigger is named "<current choice> <label>", and a required field's label
// ends in its `*` marker.
function nameMatcher(label: string): RegExp {
  return new RegExp(`(^|\\s)${escape(label)}\\s?\\*?$`);
}

/**
 * Find a shared select field's trigger by its label.
 *
 * The label is matched at the end of the trigger's name rather than with
 * `getByLabelText`, which also reaches React Aria's inert native `<select>` and
 * so finds two elements.
 */
export function getSelectField(label: string, scope?: SelectFieldScope): HTMLElement {
  const queries = scope ? within(scope) : screen;
  return queries.getByRole('button', { name: nameMatcher(label) });
}

/** Wait for a select field that renders once its data has loaded. */
export function findSelectField(label: string, scope?: SelectFieldScope): Promise<HTMLElement> {
  const queries = scope ? within(scope) : screen;
  return queries.findByRole('button', { name: nameMatcher(label) });
}

/** The label of the current choice, or the placeholder when nothing matches. */
export function selectFieldValue(field: HTMLElement): string {
  return field.querySelector('.ui-select-value')?.textContent ?? '';
}

/**
 * Open a shared select field and pick an option by its visible label, the way
 * an operator would. The list is portaled to `<body>`, so the option is found on
 * the whole screen even when the field is looked up within `scope`. Pass a
 * RegExp for rows that carry more than a name, such as an account's balance.
 *
 * Pass the caller's own `userEvent` instance when it has one.
 */
export async function chooseSelectOption(
  field: HTMLElement | string,
  option: string | RegExp,
  user: User = userEvent,
  scope?: SelectFieldScope,
): Promise<void> {
  const trigger = typeof field === 'string' ? getSelectField(field, scope) : field;
  await user.click(trigger);
  await user.click(await screen.findByRole('option', { name: option }));
}
