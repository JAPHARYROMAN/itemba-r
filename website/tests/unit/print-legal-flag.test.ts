/**
 * flags.publishLegalIdentifiers covers the print documents, not only the
 * screen view: with the flag off, the hidden print documents on
 * /company-profile (page source, Ctrl+P, and the PDFs once regenerated)
 * carry no TIN, incorporation date/number, identifier table or director.
 * Unverified founding and historical dates stay omitted from narratives.
 * Each company remains named by its established public name.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/content/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/content/flags')>();
  return { ...actual, flags: { ...actual.flags, publishLegalIdentifiers: false } };
});

const { companies } = await import('@/content/companies');
const { flags } = await import('@/content/flags');
const { printableProfiles } = await import('@/content/profile');
const { default: ProfileDocuments } = await import('@/print/ProfileDocuments');

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('print documents with flags.publishLegalIdentifiers off', () => {
  const html = renderToStaticMarkup(h(ProfileDocuments));
  const printed = text(html);

  it('runs with the flag off', () => expect(flags.publishLegalIdentifiers).toBe(false));

  it('prints no TIN, identifier table or director, in any of the four documents', () => {
    expect(html.match(/<article class="print-profile-document"/g)).toHaveLength(4);
    for (const company of companies) {
      expect(printed, company.slug).not.toContain(company.legal.tin);
      expect(printed, company.slug).not.toContain(company.legal.incorporationNumber);
      expect(printed, company.slug).not.toContain(company.legal.incorporationDate);
      for (const director of company.legal.directors) expect(printed, director).not.toContain(director);
    }
    expect(printed).not.toMatch(/\bTIN\b/);
    expect(printed).not.toContain('EST. 2012');
    expect(html).not.toContain('print-table');
    for (const profile of printableProfiles) {
      expect(profile.facts.map((fact) => fact.label)).not.toEqual(expect.arrayContaining(['TIN']));
    }
  });

  it('still names every company by its public name', () => {
    for (const company of companies) expect(printed).toContain(company.name);
  });
});
