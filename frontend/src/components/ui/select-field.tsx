'use client';
import React, { useRef, useState } from 'react';
import { Check, ChevronDown, CircleAlert, Search } from 'lucide-react';
import {
  Autocomplete,
  Button,
  FieldError as AriaFieldError,
  Input,
  Label as AriaLabel,
  ListBox,
  ListBoxItem,
  Popover,
  SearchField,
  Select,
  SelectValue,
  useFilter,
  type Key,
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

/**
 * The dropdown for every ITEMBA OS surface.
 *
 * A native `<select>` styles only its closed box; the open list belongs to the
 * browser. In the dark theme that list came up white while its options kept the
 * select's near-white text, so a scope bar read as a column of blanks. This
 * field renders the list itself — themed, with a check on the current choice and
 * a search box once the list is long enough to need one.
 *
 * It speaks plain strings like the `<select>` it replaces, `''` included, so call
 * sites keep what they store and send and only change how they read the value.
 */
export interface SelectFieldOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectFieldProps {
  label?: string;
  /** Accessible name when the visible caption lives outside this control. */
  'aria-label'?: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectFieldOption[];
  /** Shown when `value` matches no option. */
  placeholder?: string;
  /** Defaults to on once the list is longer than a glance. */
  searchable?: boolean;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
  /** `bare` drops the box, for inline captions such as a desk's scope bar. */
  variant?: 'field' | 'bare';
  /** `side` puts the caption beside the control, as a filter bar's "Currency" does. */
  labelPlacement?: 'top' | 'side';
}

const SEARCH_THRESHOLD = 8;

// Option values are the keys, `''` included. React Aria's hidden native select
// then carries `''` for a "Choose …" row, so a required field left there still
// blocks the form exactly as the `<select>` it replaces did.
const fromKey = (key: Key | null) => (key == null ? '' : String(key));

// The list is portaled to <body>, outside the window whose theme the field sits
// in — ITEMBA OS windows, the fuel portal and the auth pages each redefine these.
// Carrying the resolved values across keeps the list in the same palette.
const THEME_TOKENS = [
  '--aurora-card',
  '--aurora-bg-subtle',
  '--aurora-border',
  '--aurora-border-focus',
  '--aurora-text',
  '--aurora-text-secondary',
  '--aurora-text-muted',
  '--aurora-primary',
  '--aurora-primary-subtle',
  '--aurora-primary-text',
] as const;

function themeOf(element: Element | null): React.CSSProperties | undefined {
  if (!element) return undefined;
  const computed = getComputedStyle(element);
  const theme: Record<string, string> = {};
  for (const token of THEME_TOKENS) {
    const value = computed.getPropertyValue(token).trim();
    if (value) theme[token] = value;
  }
  return theme as React.CSSProperties;
}

export function SelectField({
  label,
  'aria-label': ariaLabel,
  hint,
  error,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchable = options.length > SEARCH_THRESHOLD,
  required,
  disabled,
  id,
  name,
  className = '',
  variant = 'field',
  labelPlacement = 'top',
}: SelectFieldProps) {
  const shake = useShakeOnError(error);
  const { fieldId, errorId, hintId, aria } = useFieldA11y(id, error, hint);
  const { contains } = useFilter({ sensitivity: 'base' });
  const root = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<React.CSSProperties>();
  const items = options.map((option) => ({ ...option, id: option.value }));
  const selected = options.some((option) => option.value === value) ? value : null;

  const list = (
    <ListBox
      className="ui-select-list"
      items={items}
      renderEmptyState={() => <p className="ui-select-empty">No matches</p>}
    >
      {(item) => (
        <ListBoxItem
          id={item.id}
          textValue={item.label}
          isDisabled={item.disabled}
          className="ui-select-option"
        >
          {({ isSelected }) => (
            <>
              <span className="ui-select-option-label">{item.label}</span>
              {isSelected && <Check size={14} aria-hidden="true" />}
            </>
          )}
        </ListBoxItem>
      )}
    </ListBox>
  );

  const plainLabel = variant === 'field' && labelPlacement === 'top';

  return (
    <Select
      ref={root}
      className={`ui-select ui-select-${variant}${labelPlacement === 'side' ? ' ui-select-side' : ''} ${className}`.trim()}
      value={selected}
      onChange={(key) => {
        onChange(fromKey(key));
        // Workspace drafts listen for bubbling `input` on a wrapping form, the
        // same signal the shared date field sends.
        root.current?.dispatchEvent(new Event('input', { bubbles: true }));
      }}
      onOpenChange={(open) => open && setTheme(themeOf(root.current))}
      placeholder={placeholder}
      isRequired={required}
      isDisabled={disabled}
      // `false` would pin the field valid and silence the native `required` check.
      isInvalid={error ? true : undefined}
      name={name}
      id={fieldId}
      aria-label={label ? undefined : ariaLabel}
      aria-describedby={aria['aria-describedby']}
    >
      {label && (
        <AriaLabel
          className={plainLabel ? LABEL_CLASS : 'ui-select-label'}
          style={plainLabel ? LABEL_STYLE : undefined}
        >
          {label}
          {required && <RequiredMark />}
        </AriaLabel>
      )}
      <Button className={`ui-select-trigger${error ? ' ui-select-trigger-invalid' : ''}${shake}`}>
        <SelectValue className="ui-select-value" />
        <ChevronDown size={15} aria-hidden="true" className="ui-select-chevron" />
      </Button>
      <Popover className="ui-select-popover" placement="bottom start" offset={6} style={theme}>
        {searchable ? (
          <Autocomplete filter={contains}>
            <SearchField
              className="ui-select-search"
              aria-label={`Search ${label ?? ariaLabel ?? 'options'}`}
              autoFocus
            >
              <Search size={14} aria-hidden="true" />
              <Input placeholder="Search" />
            </SearchField>
            {list}
          </Autocomplete>
        ) : (
          list
        )}
      </Popover>
      {error ? (
        <FieldError id={errorId}>{error}</FieldError>
      ) : (
        <>
          {hint && <Hint id={hintId}>{hint}</Hint>}
          {/* A native `required` check ends here, not in a browser bubble: React
              Aria cancels the bubble and moves focus to the trigger, so the
              reason has to be written out beside it. */}
          <AriaFieldError className="ui-select-error">
            {({ validationDetails, validationErrors }) => (
              <>
                <CircleAlert size={12} aria-hidden="true" />
                {validationDetails.valueMissing
                  ? `${label ?? ariaLabel ?? 'This field'} is required.`
                  : validationErrors.join(' ')}
              </>
            )}
          </AriaFieldError>
        </>
      )}
    </Select>
  );
}
