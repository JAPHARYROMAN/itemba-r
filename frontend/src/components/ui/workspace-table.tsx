'use client';

import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type HTMLAttributes,
  type TableHTMLAttributes,
} from 'react';
import './workspace-table.css';

type NodeProps = HTMLAttributes<HTMLElement> & {
  children?: ReactNode;
  colSpan?: number;
  rowSpan?: number;
  scope?: string;
};
type Element = ReactElement<NodeProps>;

function elements(children: ReactNode, prefix = ''): Element[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<NodeProps>(child)) return [];
    const key = `${prefix}${child.key}`;
    return child.type === Fragment
      ? elements(child.props.children, `${key}:`)
      : [prefix ? cloneElement(child, { key }) : child];
  });
}

function textOf(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      return isValidElement<NodeProps>(child) ? textOf(child.props.children) : '';
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One DOM table, one set of controls. Simple registers become labelled records on phones;
 * matrices, editable grids and merged headers keep a keyboard-scrollable table. */
export function WorkspaceTable({
  children,
  className = '',
  mobile = 'records',
  label = 'Records',
  ...props
}: TableHTMLAttributes<HTMLTableElement> & { mobile?: 'records' | 'scroll'; label?: string }) {
  const sections = elements(children);
  const headRows = elements(sections.find((node) => node.type === 'thead')?.props.children);
  const headings = headRows.length === 1 ? elements(headRows[0].props.children) : [];
  const labels = headings.map((node) => textOf(node.props.children));
  const bodyRows = sections
    .filter((node) => node.type === 'tbody')
    .flatMap((node) => elements(node.props.children));
  const hasMergedCells =
    headings.some((cell) => (cell.props.colSpan ?? 1) > 1) ||
    bodyRows
      .flatMap((row) => elements(row.props.children))
      .some((cell) => (cell.props.rowSpan ?? 1) > 1);
  const records =
    mobile === 'records' &&
    headings.length > 0 &&
    !hasMergedCells &&
    bodyRows.every((node) => node.type === 'tr');

  function row(node: Element, header: boolean): Element {
    if (node.type !== 'tr') return node;
    let column = 0;
    const cells = elements(node.props.children).map((cell) => {
      const label = labels[column] || (column === labels.length - 1 ? 'Actions' : 'Details');
      column += cell.props.colSpan ?? 1;
      if (cell.type !== 'td' && cell.type !== 'th') return cell;
      return cloneElement(cell, {
        ...(header
          ? { scope: cell.props.scope ?? 'col', role: 'columnheader' }
          : { role: cell.type === 'th' ? 'rowheader' : 'cell' }),
        ...(!header
          ? {
              'data-column-label': label,
              'data-full-row': cell.props.colSpan === headings.length ? 'true' : undefined,
            }
          : {}),
      });
    });
    return cloneElement(
      node,
      {
        role: 'row',
        ...(node.props.onClick && node.props.tabIndex === undefined
          ? {
              tabIndex: 0,
              onKeyDown: (event) => {
                node.props.onKeyDown?.(event);
                if (
                  !event.defaultPrevented &&
                  event.target === event.currentTarget &&
                  (event.key === 'Enter' || event.key === ' ')
                ) {
                  event.preventDefault();
                  event.currentTarget.click();
                }
              },
            }
          : {}),
      },
      cells,
    );
  }

  return (
    <div className="os-table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table
        {...props}
        role="table"
        className={`os-workspace-table ${records ? 'os-table-records' : ''} ${className}`}
      >
        {sections.map((section) =>
          ['thead', 'tbody', 'tfoot'].includes(String(section.type))
            ? cloneElement(
                section,
                { role: 'rowgroup' },
                elements(section.props.children).map((node) => row(node, section.type === 'thead')),
              )
            : section,
        )}
      </table>
    </div>
  );
}
