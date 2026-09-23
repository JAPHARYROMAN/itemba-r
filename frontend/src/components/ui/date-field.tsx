'use client';
import React, { useRef } from 'react';
import { CalendarDays } from 'lucide-react';
import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  DateInput as AriaDateInput,
  DatePicker,
  DateSegment,
  Dialog,
  Group,
  Heading,
  I18nProvider,
  Label as AriaLabel,
  Popover,
} from 'react-aria-components';
import {
  FieldError,
  Hint,
  LABEL_CLASS,
  LABEL_STYLE,
  RequiredMark,
  useFieldA11y,
  useShakeOnError,
} from './field-chrome';
import { DATE_DISPLAY_LOCALE, parseIsoDate, parseIsoDateTime } from './date-value';
import { useDateDraft, type DateFieldGranularity } from './use-date-draft';

/**
 * The date control for every ITEMBA OS surface.
 *
 * `<input type="date">` hands the job to the browser's own picker, and on the
 * in-app browser used for acceptance that picker crashed the tab outright —
 * recorded against Invoice Desk in `docs/releases/itemba-os-release-readiness.md`.
 * Nothing in application code could guard against it, because the crash lived
 * inside a widget we did not render. So this field renders the whole control
 * itself: typed day/month/year segments and an in-page calendar, no native
 * picker anywhere in the path.
 *
 * It speaks the same `YYYY-MM-DD` strings the old inputs did, so call sites only
 * change how they read the new value, never what they store or send.
 */
export interface FormDateFieldProps {
  label?: string;
  /**
   * Accessible name when the visible caption lives outside this control — a
   * wrapping "From" in a filter bar, or a page that already rendered its own
   * `<label>`. `label` wins when both are set.
   */
  'aria-label'?: string;
  hint?: string;
  error?: string;
  /** ISO `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` when `granularity` is `minute`. */
  value?: string;
  /** Receives the same ISO shape as `value`, or '' when the operator clears. */
  onChange?: (value: string) => void;
  /** Day is the default. Minute replaces `<input type="datetime-local">`. */
  granularity?: DateFieldGranularity;
  /** ISO bounds, matching the `min`/`max` the native input accepted. */
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
}

export function FormDateField({
  label,
  'aria-label': ariaLabel,
  hint,
  error,
  value,
  onChange,
  granularity = 'day',
  min,
  max,
  required,
  disabled,
  id,
  name,
  className = '',
}: FormDateFieldProps) {
  const shake = useShakeOnError(error);
  const { fieldId, errorId, hintId, aria } = useFieldA11y(id, error, hint);
  const { draft, change, blur } = useDateDraft(value, onChange, granularity);
  const host = useRef<HTMLDivElement>(null);
  const parseBound = granularity === 'minute' ? parseIsoDateTime : parseIsoDate;

  // Workspace drafts listen for bubbling `input`/`change` on a wrapping form.
  // The segments are not native inputs, so an operator edit has to announce
  // itself the same way the old `<input type="date">` did.
  function notifyForm() {
    host.current?.dispatchEvent(new Event('input', { bubbles: true }));
  }

  return (
    <I18nProvider locale={DATE_DISPLAY_LOCALE}>
      <div ref={host} className="ui-date-field-host">
        <DatePicker
          className={`${className}${granularity === 'minute' ? ' ui-date-field-datetime' : ''}`.trim()}
          value={draft}
          onChange={(next) => {
            change(next);
            notifyForm();
          }}
          minValue={parseBound(min) ?? undefined}
          maxValue={parseBound(max) ?? undefined}
          isRequired={required}
          isDisabled={disabled}
          isInvalid={!!error}
          granularity={granularity}
          hourCycle={granularity === 'minute' ? 24 : undefined}
          shouldForceLeadingZeros
          name={name}
          id={fieldId}
          aria-label={label ? undefined : ariaLabel}
          aria-describedby={aria['aria-describedby']}
        >
          {label && (
            <AriaLabel className={LABEL_CLASS} style={LABEL_STYLE}>
              {label}
              {required && <RequiredMark />}
            </AriaLabel>
          )}
          <Group
            className={`ui-date-group${error ? ' ui-date-group-invalid' : ''}${shake}`}
            onBlur={(event) => {
              blur(event);
              notifyForm();
            }}
          >
            <AriaDateInput className="ui-date-segments">
              {(segment) => <DateSegment segment={segment} className="ui-date-segment" />}
            </AriaDateInput>
            <Button className="ui-date-trigger">
              <CalendarDays size={15} aria-hidden="true" />
            </Button>
          </Group>
          <Popover className="ui-date-popover" placement="bottom start">
            <Dialog className="ui-date-dialog">
              <Calendar className="ui-date-calendar">
                <header className="ui-date-calendar-header">
                  <Button slot="previous" className="ui-date-nav">
                    &#8249;
                  </Button>
                  <Heading className="ui-date-calendar-heading" />
                  <Button slot="next" className="ui-date-nav">
                    &#8250;
                  </Button>
                </header>
                <CalendarGrid className="ui-date-grid">
                  {(date) => <CalendarCell date={date} className="ui-date-cell" />}
                </CalendarGrid>
              </Calendar>
            </Dialog>
          </Popover>
        </DatePicker>
      </div>
      {error ? (
        <FieldError id={errorId}>{error}</FieldError>
      ) : hint ? (
        <Hint id={hintId}>{hint}</Hint>
      ) : null}
    </I18nProvider>
  );
}
