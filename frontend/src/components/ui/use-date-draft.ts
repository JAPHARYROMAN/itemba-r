import { useState } from 'react';
import type { FocusEvent } from 'react';
import type { DateValue } from 'react-aria-components';
import {
  MIN_PLAUSIBLE_YEAR,
  formatIsoDate,
  formatIsoDateTime,
  parseIsoDate,
  parseIsoDateTime,
} from './date-value';

export type DateFieldGranularity = 'day' | 'minute';

/**
 * Holds the date being typed, separately from the date the form has accepted.
 *
 * The two are not the same thing while an operator is mid-entry. Segments
 * complete a date the instant the first year digit lands, so typing 2026 passes
 * through the years 2, 20 and 202. Reporting those would put a record dated in
 * antiquity into form state, and any sibling field deriving a `min` or `max`
 * bound from it would follow. So the draft absorbs them and the form hears
 * nothing until the year is real.
 *
 * That silence is why the draft has to exist at all: the field is controlled, so
 * without somewhere to keep the in-progress value, a value the parent never
 * echoes back would be erased on the next render, taking the already-typed day
 * and month with it.
 */
export function useDateDraft(
  value: string | undefined,
  onChange?: (value: string) => void,
  granularity: DateFieldGranularity = 'day',
) {
  const parse = granularity === 'minute' ? parseIsoDateTime : parseIsoDate;
  const format = granularity === 'minute' ? formatIsoDateTime : formatIsoDate;
  const [draft, setDraft] = useState<DateValue | null>(() => parse(value));
  const [syncedFrom, setSyncedFrom] = useState(value);
  const [swallowedPartialYear, setSwallowedPartialYear] = useState(false);

  // The value moved underneath us — a record loaded, a form reset, a sibling
  // field rewriting this one. Adjusting state during render is the supported
  // way to follow a prop; React re-runs this component before committing.
  if (value !== syncedFrom) {
    setSyncedFrom(value);
    setDraft(parse(value));
    setSwallowedPartialYear(false);
  }

  function change(next: DateValue | null) {
    setDraft(next);
    if (next && next.year < MIN_PLAUSIBLE_YEAR) {
      setSwallowedPartialYear(true);
      return;
    }
    setSwallowedPartialYear(false);
    onChange?.(format(next));
  }

  function blur(event: FocusEvent<HTMLElement>) {
    // Moving between segments is not leaving the field.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (!swallowedPartialYear) return;
    // What is on screen is not a date. Clearing it is honest, and lets
    // required-field validation say so; keeping the form's previous value while
    // showing something else would not.
    setSwallowedPartialYear(false);
    setDraft(null);
    onChange?.('');
  }

  return { draft, change, blur };
}
