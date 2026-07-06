import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  DocumentNotePanel,
  DocumentShell,
  DocumentTd,
  DocumentTh,
  DocumentTotals,
  type DocumentOrganization,
} from './DocumentShell';

// next/image requires the Next.js runtime; render a plain img in jsdom instead.
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { unoptimized: _unoptimized, ...rest } = props;
    return React.createElement('img', rest as React.ImgHTMLAttributes<HTMLImageElement>);
  },
}));

const organization: DocumentOrganization = {
  name: 'Westside Traders Ltd',
  groupName: 'ITEMBA GROUP',
  branchName: 'Dar es Salaam',
  code: 'WST-01',
  address: '12 Uhuru Street',
  phone: '+255 700 000 001',
  email: 'sales@westside.co.tz',
  website: 'www.westside.co.tz',
  tin: '123-456-789',
};

function renderShell(overrides: Partial<React.ComponentProps<typeof DocumentShell>> = {}) {
  return render(
    <DocumentShell
      title="Sales Order"
      subtitle="Order confirmation"
      reference="SO-2026-0001"
      status="Confirmed"
      statusTone="success"
      organization={organization}
      generatedAt={new Date('2026-07-06T10:30:00Z')}
      {...overrides}
    >
      <p>Body content</p>
    </DocumentShell>,
  );
}

describe('DocumentShell', () => {
  it('renders the document title as the uppercase right-side letterhead heading', () => {
    renderShell();
    const title = screen.getByText('Sales Order');
    expect(title).toHaveClass('uppercase', 'text-2xl', 'font-extrabold');
    expect(title.parentElement).toHaveClass('sm:text-right');
  });

  it('renders the reference in brand color', () => {
    renderShell();
    expect(screen.getByText('SO-2026-0001')).toHaveClass('text-brand-600');
  });

  it('renders the status pill with the tone classes', () => {
    renderShell();
    const pill = screen.getByText('Confirmed');
    expect(pill).toHaveClass('rounded-full', 'bg-emerald-50', 'text-emerald-700');
  });

  it('joins organization contact details with bullets', () => {
    renderShell();
    expect(
      screen.getByText('12 Uhuru Street • +255 700 000 001 • sales@westside.co.tz'),
    ).toBeInTheDocument();
    expect(screen.getByText('TIN: 123-456-789')).toBeInTheDocument();
  });

  it('renders the footer with website/email/phone line and the generated timestamp', () => {
    renderShell();
    expect(
      screen.getByText('www.westside.co.tz • sales@westside.co.tz • +255 700 000 001'),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Generated /)).toBeInTheDocument();
  });

  it('applies the brand accent rule to the document page article', () => {
    const { container } = renderShell();
    const article = container.querySelector('article.document-page');
    expect(article).not.toBeNull();
    expect(article).toHaveClass('border-t-[3px]', 'border-brand-600');
  });

  it('renders the fallback initials in brand color when no logo is set', () => {
    renderShell();
    const initials = screen.getByText('IG');
    expect(initials).toHaveClass('text-brand-600', 'font-extrabold');
  });
});

describe('DocumentTotals', () => {
  it('tints the emphasis row with the brand background', () => {
    render(
      <DocumentTotals
        items={[
          { label: 'Subtotal', value: 'TZS 100,000' },
          { label: 'Total', value: 'TZS 118,000', emphasis: true },
        ]}
      />,
    );
    const emphasisRow = screen.getByText('Total').parentElement;
    expect(emphasisRow).toHaveClass('bg-brand-50', 'font-bold');
    const plainRow = screen.getByText('Subtotal').parentElement;
    expect(plainRow).not.toHaveClass('bg-brand-50');
  });

  it('renders danger-tone rows in red', () => {
    render(
      <DocumentTotals items={[{ label: 'Outstanding', value: 'TZS 18,000', tone: 'danger' }]} />,
    );
    const row = screen.getByText('Outstanding').parentElement;
    expect(row).toHaveClass('text-red-600', 'font-semibold');
  });
});

describe('DocumentTh / DocumentTd', () => {
  it('applies alignment and the brand header label styling', () => {
    render(
      <table>
        <thead>
          <tr>
            <DocumentTh>Item</DocumentTh>
            <DocumentTh align="right">Amount</DocumentTh>
          </tr>
        </thead>
      </table>,
    );
    expect(screen.getByText('Item')).toHaveClass('text-left', 'text-brand-700', 'uppercase');
    expect(screen.getByText('Amount')).toHaveClass('text-right', 'text-brand-700');
  });

  it('renders mono cells as muted secondary text', () => {
    render(
      <table>
        <tbody>
          <tr>
            <DocumentTd mono>SKU-001</DocumentTd>
            <DocumentTd align="right">2,500</DocumentTd>
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByText('SKU-001')).toHaveClass('font-mono', 'text-slate-500');
    expect(screen.getByText('2,500')).toHaveClass('text-right', 'text-slate-800');
  });
});

describe('DocumentNotePanel', () => {
  it('renders children inside a light panel', () => {
    render(<DocumentNotePanel>Deliver before Friday.</DocumentNotePanel>);
    const panel = screen.getByText('Deliver before Friday.');
    expect(panel).toHaveClass('bg-slate-50', 'rounded-sm');
  });
});
