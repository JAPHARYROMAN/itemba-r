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
import { documentOrganization } from './document-utils';

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
  telephone: '+255758793511',
  phone: '+255764601358',
  email: 'sales@westside.co.tz',
  website: 'www.westside.co.tz',
  tin: '123-456-789',
  vrn: '40-030602-Q',
  registrationNumber: '135764',
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
  it('renders the document title in the title block', () => {
    renderShell();
    const title = screen.getByText('Sales Order');
    expect(title).toHaveClass('document-title', 'uppercase', 'font-extrabold');
    expect(title.parentElement).toHaveClass('min-w-0');
  });

  it('renders the document reference in both letterhead positions', () => {
    renderShell();
    const references = screen.getAllByText('SO-2026-0001');
    expect(references).toHaveLength(2);
    expect(references[0]).toHaveClass('document-reference', 'font-extrabold');
  });

  it('renders the document status in the letterhead marker', () => {
    renderShell();
    const pill = screen.getByText('Confirmed');
    expect(pill).toHaveClass('document-status', 'uppercase');
  });

  it('renders the complete labelled organization letterhead', () => {
    renderShell();
    expect(screen.getByText('Address: 12 Uhuru Street')).toBeInTheDocument();
    expect(
      screen.getByText('Tel: +255758793511 | Email: sales@westside.co.tz'),
    ).toBeInTheDocument();
    expect(screen.getByText('Phone: +255764601358')).toBeInTheDocument();
    expect(
      screen.getByText('TIN: 123-456-789 • VRN: 40-030602-Q • Reg No: 135764'),
    ).toBeInTheDocument();
  });

  it('renders the footer with website/email/phone line and the generated timestamp', () => {
    renderShell();
    expect(
      screen.getByText(
        'www.westside.co.tz • sales@westside.co.tz • Tel: +255758793511 • Phone: +255764601358',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Generated /)).toBeInTheDocument();
  });

  it('uses a clean white document page for the reference letterhead', () => {
    const { container } = renderShell();
    const article = container.querySelector('article.document-page');
    expect(article).not.toBeNull();
    expect(article).toHaveClass('bg-white', 'text-slate-950');
  });

  it('renders the fallback initials inside the bordered logo block', () => {
    renderShell();
    const initials = screen.getByText('IG');
    expect(initials).toHaveClass('text-slate-950', 'font-extrabold');
    expect(initials.parentElement).toHaveClass('document-logo-box', 'border-2');
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

describe('documentOrganization', () => {
  it('uses the standard Itemba letterhead when the company profile is incomplete', () => {
    const result = documentOrganization({ name: 'WESTSIDES COMPANY LTD' });

    expect(result).toMatchObject({
      groupName: 'ITEMBA GROUP',
      name: 'WESTSIDES COMPANY LTD',
      address: 'Kisimani Area, Tunduma Town Centre',
      telephone: '+255758793511',
      phone: '+255764601358',
      email: 'info@itembagrouptz.com',
      tin: '136-065-580',
      vrn: '40-030602-Q',
      registrationNumber: '135764',
    });
  });
});
