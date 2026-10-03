import React from 'react';
import type { SelectFieldOption } from './select-field';

/**
 * The bridge that lets the `<select>`-shaped FormSelect components render a
 * SelectField without touching their 600-odd call sites.
 *
 * Those call sites hand over `<option>` children and read `e.target.value` in
 * their change handlers. These helpers turn the children into SelectField
 * options and a chosen value back into an event of the shape the handlers read.
 */

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return '';
}

type OptionProps = {
  value?: string | number | readonly string[];
  label?: string;
  disabled?: boolean;
  children?: React.ReactNode;
};

/**
 * Read `<option>` elements — mapped, conditional or wrapped in fragments or an
 * `<optgroup>` — the way the browser would: an option without a `value`
 * submits its text, and its text is what the operator reads.
 */
export function optionsFromChildren(children: React.ReactNode): SelectFieldOption[] {
  const options: SelectFieldOption[] = [];
  const walk = (nodes: React.ReactNode) =>
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement<OptionProps>(child)) return;
      if (child.type === React.Fragment || child.type === 'optgroup') {
        walk(child.props.children);
        return;
      }
      if (child.type !== 'option') return;
      const text = child.props.label ?? textOf(child.props.children);
      options.push({
        value: child.props.value == null ? text : String(child.props.value),
        label: text,
        disabled: !!child.props.disabled,
      });
    });
  walk(children);
  return options;
}

/**
 * A change event carrying the chosen value where a native select's would.
 *
 * Handlers read `e.target.value`, some of them later inside a state updater, so
 * the target is a plain snapshot rather than a live element whose value could
 * move on underneath them.
 */
export function selectChangeEvent(
  value: string,
  name = '',
  id = '',
): React.ChangeEvent<HTMLSelectElement> {
  const target = { value, name, id, type: 'select-one', tagName: 'SELECT', nodeName: 'SELECT' };
  let defaultPrevented = false;
  let propagationStopped = false;
  return {
    target,
    currentTarget: target,
    nativeEvent: new Event('change', { bubbles: true }),
    type: 'change',
    bubbles: true,
    cancelable: false,
    eventPhase: 2,
    isTrusted: false,
    timeStamp: Date.now(),
    get defaultPrevented() {
      return defaultPrevented;
    },
    preventDefault() {
      defaultPrevented = true;
    },
    isDefaultPrevented: () => defaultPrevented,
    stopPropagation() {
      propagationStopped = true;
    },
    isPropagationStopped: () => propagationStopped,
    persist() {},
  } as unknown as React.ChangeEvent<HTMLSelectElement>;
}
