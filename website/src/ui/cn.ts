/**
 * Joins class names, skipping falsy values. The Tailwind lint rule reads the
 * arguments of `cn(...)` (eslint.config.mjs `callees`), so every class passed
 * here is checked against the token theme.
 *
 * There is no conflict resolution: when two classes set the same property,
 * the one Tailwind emits later wins. Components therefore keep their own
 * defaults narrow and let `className` add, not fight.
 */
export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  let out = '';
  for (const value of values) {
    if (!value) continue;
    out = out ? `${out} ${value}` : value;
  }
  return out;
}
