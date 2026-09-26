/**
 * `@/lib/site` stays API-compatible with origin/main while its data moves to
 * src/content: the same export names, and the legacy values the old pages and
 * the frozen API route rely on.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as barrel from '@/lib/site';
import { companies } from '@/content/companies';
import { mailtoWithSubject } from '@/content/contact';
import { site as contentSite } from '@/content/site';
import { buildMediaManifest } from '../../scripts/images/media-manifest.mjs';

const ROOT = path.resolve(__dirname, '../..');

/** Runtime exports of src/lib/site.ts on origin/main (types are checked by tsc). */
const ORIGIN_MAIN_EXPORTS = [
  'absoluteUrl',
  'breadcrumbJsonLd',
  'capabilityAreas',
  'companyProfiles',
  'companyUrl',
  'contact',
  'coreRoutes',
  'enquiryIntents',
  'faqJsonLd',
  'groupFaqs',
  'insightArticles',
  'insightUrl',
  'locationProfiles',
  'locationUrl',
  'mailtoWithSubject',
  'partnershipAreas',
  'partnershipFaqs',
  'serviceAreas',
  'serviceUrl',
  'site',
  'whatsappWithMessage',
];

describe('@/lib/site barrel', () => {
  it('exports exactly the origin/main runtime names', () => {
    expect(Object.keys(barrel).sort()).toEqual([...ORIGIN_MAIN_EXPORTS].sort());
  });

  it('pins the origin/main copy that the content flags change', () => {
    expect(barrel.site.description).toBe(
      'Itemba Group is a Tanzanian holding group headquartered in Mpemba-Tunduma, Songwe Region, operating across energy, trade, logistics, construction, hospitality, real estate, and manufacturing.',
    );
    expect(barrel.groupFaqs.find((f) => f.question === 'Which sectors does Itemba Group operate in?')?.answer).toBe(
      'The group operates across energy, trade, logistics, construction supplies, hospitality, parking, real estate, and manufacturing-related activities.',
    );
    // The flag-resolved content drops the unconfirmed sector.
    expect(contentSite.description).not.toMatch(/manufacturing/);
  });

  it('keeps the legacy company shape (accent classes included) in public order', () => {
    expect(barrel.companyProfiles.map((c) => c.slug)).toEqual(companies.map((c) => c.slug));
    expect(barrel.companyProfiles.map((c) => c.accentBg)).toEqual(['bg-amber-500', 'bg-blue-500', 'bg-emerald-500']);
    for (const company of barrel.companyProfiles) {
      expect(company.image.src.startsWith('/images/')).toBe(true);
      expect(company.gallery.length).toBeGreaterThan(0);
    }
  });

  it('keeps the enquiry intents the frozen route reads', () => {
    expect(barrel.enquiryIntents[0].id).toBe('general');
    expect(barrel.enquiryIntents.map((i) => [i.id, i.routeTo, i.subject])).toEqual([
      ['general', 'Itemba Group office', 'General business enquiry'],
      ['mwanjalisi', 'Mwanjalisi Oil Co Ltd', 'Mwanjalisi Oil fuel supply enquiry'],
      ['westsides', 'Westsides Company Ltd', 'Westsides Company trade supply enquiry'],
      ['enterprises', 'Itemba Enterprises Co Ltd', 'Itemba Enterprises operations enquiry'],
    ]);
  });

  it('builds the same URLs and JSON-LD as before', () => {
    expect(barrel.absoluteUrl('/about')).toBe('https://www.itembagrouptz.com/about');
    expect(barrel.absoluteUrl('about')).toBe('https://www.itembagrouptz.com/about');
    expect(barrel.companyUrl('x')).toBe('/companies/x');
    expect(barrel.serviceUrl('x')).toBe('/services/x');
    expect(barrel.locationUrl('x')).toBe('/locations/x');
    expect(barrel.insightUrl('x')).toBe('/insights/x');
    expect(barrel.breadcrumbJsonLd([{ name: 'Home', path: '/' }])).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: 'https://www.itembagrouptz.com/' }],
    });
    expect(barrel.faqJsonLd([{ question: 'Q', answer: 'A' }]).mainEntity).toEqual([
      { '@type': 'Question', name: 'Q', acceptedAnswer: { '@type': 'Answer', text: 'A' } },
    ]);
  });

  it('mailto links encode spaces as %20 and keep the subject and body', () => {
    expect(mailtoWithSubject('Business enquiry')).toBe('mailto:info@itembagrouptz.com?subject=Business%20enquiry');
    const href = mailtoWithSubject('A & B', 'Line 1\nLine 2');
    expect(href).toBe('mailto:info@itembagrouptz.com?subject=A%20%26%20B&body=Line%201%0ALine%202');
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('subject')).toBe('A & B');
    expect(params.get('body')).toBe('Line 1\nLine 2');
    expect(barrel.mailtoWithSubject).toBe(mailtoWithSubject);
  });
});

describe('media.generated.ts', () => {
  it('is up to date with public/images (npm run media:manifest)', async () => {
    const expected = await buildMediaManifest();
    const actual = readFileSync(path.join(ROOT, 'src/content/media.generated.ts'), 'utf8');
    expect(actual).toBe(expected);
  }, 120_000);
});
