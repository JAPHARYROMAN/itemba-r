/**
 * Content model invariants (src/content/*): the counts the site promises, the
 * cross-references between modules, and the media registry.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { companies, getCompanyBySlug } from '@/content/companies';
import { contact } from '@/content/contact';
import { corridorSites } from '@/content/corridor';
import { enquiryIntents } from '@/content/enquiry';
import { faqSections, groupFaqs, partnershipFaqs } from '@/content/faqs';
import { flags } from '@/content/flags';
import { facts } from '@/content/facts';
import { insightArticles } from '@/content/insights';
import { locationProfiles } from '@/content/locations';
import { media, mediaIds, getMedia, type MediaImage } from '@/content/media';
import { mediaGenerated } from '@/content/media.generated';
import { ogCards } from '@/content/og';
import { partnershipAreas } from '@/content/partnerships';
import * as profile from '@/content/profile';
import { serviceAreas } from '@/content/services';
import { coreRoutes } from '@/content/site';
import * as home from '@/content/home';
import { aboutPage } from '@/content/about';

const ROOT = path.resolve(__dirname, '../..');
const PUBLIC = path.join(ROOT, 'public');

const serviceSlugs = new Set(serviceAreas.map((s) => s.slug));
const companySlugs = new Set(companies.map((c) => c.slug));
const locationSlugs = new Set(locationProfiles.map((l) => l.slug));

describe('counts', () => {
  it('6 services, 3 companies, 1 location, 4 insights, 4 intents', () => {
    expect(serviceAreas).toHaveLength(6);
    expect(companies).toHaveLength(3);
    expect(locationProfiles).toHaveLength(1);
    expect(insightArticles).toHaveLength(4);
    expect(enquiryIntents).toHaveLength(4);
  });

  it('34 FAQs across the 12 /faq sections', () => {
    const sections = faqSections();
    expect(sections).toHaveLength(12);
    expect(sections.flatMap((s) => s.faqs)).toHaveLength(34);
    expect(groupFaqs).toHaveLength(4);
    expect(partnershipFaqs).toHaveLength(4);
  });

  it('17 company-profile outline ids, unique, starting at the cover', () => {
    const ids = profile.outline.map((o) => o.id);
    expect(ids).toHaveLength(17);
    expect(new Set(ids).size).toBe(17);
    expect(ids[0]).toBe('cover-page');
    expect(ids.at(-1)).toBe('attachments');
  });

  it('11 core routes; with the dynamic routes the sitemap has 25 URLs', () => {
    expect(coreRoutes).toHaveLength(11);
    expect(coreRoutes.length + serviceAreas.length + locationProfiles.length + companies.length + insightArticles.length).toBe(25);
  });
});

describe('identity and cross-references', () => {
  it('slugs and ids are unique', () => {
    for (const list of [serviceAreas.map((s) => s.slug), companies.map((c) => c.slug), companies.map((c) => c.id), insightArticles.map((a) => a.slug), enquiryIntents.map((i) => i.id), partnershipAreas.map((p) => p.id)]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it('intents are the general route plus one per company, in public order', () => {
    expect(enquiryIntents.map((i) => i.id)).toEqual(['general', ...companies.map((c) => c.id)]);
  });

  it('the /faq section anchor ids are stable', () => {
    expect(faqSections().map((s) => s.id)).toEqual([
      'partnerships',
      'group',
      'company-mwanjalisi-oil',
      'company-westsides-company',
      'company-itemba-enterprises',
      'service-fuel-and-lubricants',
      'service-trade-and-distribution',
      'service-logistics-and-cross-border-transit',
      'service-construction-supplies-and-hardware',
      'service-hospitality-and-lodging',
      'service-real-estate-and-property',
      'location-songwe-tunduma',
    ]);
  });

  it('every service points at a company that exists, with its public name', () => {
    for (const service of serviceAreas) {
      const company = getCompanyBySlug(service.companySlug);
      expect(company, service.slug).toBeDefined();
      expect(service.companyName).toBe(company?.name);
      expect(enquiryIntents.some((i) => i.id === service.intentId)).toBe(true);
    }
  });

  it('insights, partnerships and locations only reference slugs that exist', () => {
    for (const article of insightArticles) {
      for (const s of article.serviceSlugs) expect(serviceSlugs.has(s), `${article.slug} → ${s}`).toBe(true);
      for (const c of article.companySlugs) expect(companySlugs.has(c), `${article.slug} → ${c}`).toBe(true);
      for (const l of article.locationSlugs) expect(locationSlugs.has(l), `${article.slug} → ${l}`).toBe(true);
      expect(article.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(article.updatedAt >= article.publishedAt).toBe(true);
    }
    for (const area of partnershipAreas) {
      for (const s of area.serviceSlugs) expect(serviceSlugs.has(s), `${area.id} → ${s}`).toBe(true);
      for (const c of area.companySlugs) expect(companySlugs.has(c), `${area.id} → ${c}`).toBe(true);
    }
    for (const location of locationProfiles) {
      for (const s of location.serviceSlugs) expect(serviceSlugs.has(s)).toBe(true);
      for (const c of location.companySlugs) expect(companySlugs.has(c)).toBe(true);
    }
    for (const tile of home.homeCompanyTiles) expect(companySlugs.has(tile.companySlug)).toBe(true);
    for (const item of home.homeSectors.items) expect(serviceSlugs.has(item.serviceSlug)).toBe(true);
  });

  it('legal profiles come from the company records, in print order', () => {
    expect(profile.legalCompanyProfiles.map((p) => p.id)).toEqual(['westsides', 'mwanjalisi', 'enterprises']);
    for (const legal of profile.legalCompanyProfiles) {
      const company = companies.find((c) => c.id === legal.id);
      expect(legal.name).toBe(company?.legalName);
      expect(legal.tin).toBe(company?.legal.tin);
      expect(legal.directors).toEqual(company?.legal.directors);
      expect(legal.tin).toMatch(/^\d{3}-\d{3}-\d{3}$/);
    }
  });

  it('the printable profiles match the print selector and the committed PDFs', () => {
    const ids = profile.printableProfiles.map((p) => p.id);
    expect(ids).toEqual(profile.printProfileOptions.map((o) => o.id));
    expect(ids).toEqual(['group', 'westsides', 'mwanjalisi', 'enterprises']);
    for (const id of ids) expect(existsSync(path.join(PUBLIC, profile.profilePdfHref(id)))).toBe(true);
    expect(profile.printableProfiles[0]?.directors).toBeUndefined();
    for (const doc of profile.printableProfiles.slice(1)) expect(doc.directors?.length).toBeGreaterThan(0);
  });

  it('each profile section with a lead is in the outline', () => {
    const ids = new Set<string>(profile.outline.map((o) => o.id));
    for (const id of Object.keys(profile.sectionLeads)) expect(ids.has(id)).toBe(true);
    expect(profile.sectionNumber('company-overview')).toBe(2);
    expect(profile.sectionNumber('attachments')).toBe(17);
  });

  it('corridor sites cover the six hub sites', () => {
    expect(corridorSites.map((s) => s.id)).toEqual(['mpemba', 'yard', 'hardware', 'uzunguni', 'inn', 'hq']);
  });

  it('OG card copy exists for every static route', () => {
    expect(Object.keys(ogCards).sort()).toEqual(
      ['about', 'capabilities', 'companies', 'companyProfile', 'contact', 'faq', 'insights', 'locations', 'partnerships', 'root', 'services'].sort(),
    );
  });
});

describe('media registry', () => {
  it('every media id points at an existing file under public/images with generated size and blur', () => {
    expect(mediaIds.length).toBeGreaterThan(0);
    for (const id of mediaIds) {
      const entry = media[id];
      expect(entry.src.startsWith('/images/'), id).toBe(true);
      expect(existsSync(path.join(PUBLIC, entry.src)), `${id}: ${entry.src}`).toBe(true);
      const resolved = getMedia(id);
      expect(resolved.width).toBeGreaterThan(0);
      expect(resolved.height).toBeGreaterThan(0);
      expect(resolved.blurDataURL).toMatch(/^data:image\/webp;base64,/);
      expect(entry.alt.trim().length, `${id} alt`).toBeGreaterThan(0);
    }
  });

  it('media ids are unique per file', () => {
    const srcs = mediaIds.map((id) => media[id].src);
    expect(new Set(srcs).size).toBe(srcs.length);
  });

  it('third-party (stock) images carry a credit and licence', () => {
    for (const id of mediaIds) {
      const entry = getMedia(id);
      if (entry.provenance === 'stock') {
        expect(entry.credit, id).toBeTruthy();
        expect(entry.licence, id).toBeTruthy();
      }
    }
    expect(getMedia('songwe-landscape').licence).toBe('CC BY-SA 4.0');
  });

  it('media.generated.ts covers every image in public/images', () => {
    const generated = Object.keys(mediaGenerated);
    expect(generated.length).toBeGreaterThanOrEqual(mediaIds.length);
    for (const src of generated) expect(existsSync(path.join(PUBLIC, src)), src).toBe(true);
  });

  it('every image in content resolves through the registry', () => {
    const refs: MediaImage[] = [];
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) return value.forEach(visit);
      const record = value as Record<string, unknown>;
      if (typeof record.media === 'string' && typeof record.src === 'string') refs.push(record as unknown as MediaImage);
      Object.values(record).forEach(visit);
    };
    visit([companies, serviceAreas, locationProfiles, home, aboutPage, profile]);
    expect(refs.length).toBeGreaterThan(40);
    for (const ref of refs) {
      expect(ref.media in media, ref.media).toBe(true);
      expect(ref.src).toBe(media[ref.media as keyof typeof media].src);
    }
  });
});

describe('flags and facts', () => {
  it('flags default to the plan’s conservative options', () => {
    expect(flags).toEqual({
      showDivisionsStat: false,
      mentionManufacturing: false,
      publishLegalIdentifiers: true,
      stateHqIsItembaMpemba: false,
      showEnterprisesMapPin: false,
      useUnverifiedHospitalityPhotos: true,
      estateImagery: 'typographic',
      songweGrowthClaim: false,
    });
  });

  it('every flag is backed by a fact the owner can confirm', () => {
    const flagged = new Set(Object.values(facts).map((f) => ('flag' in f ? f.flag : undefined)).filter(Boolean));
    for (const name of Object.keys(flags)) expect(flagged.has(name as never), name).toBe(true);
  });
});

describe('contact', () => {
  it('keeps the E.164 numbers and the prepared WhatsApp link', () => {
    expect(contact.primaryPhone).toMatch(/^\+255\d{9}$/);
    expect(contact.secondaryPhone).toMatch(/^\+255\d{9}$/);
    expect(contact.whatsapp).toBe(
      'https://wa.me/255758793511?text=Hello%20Itemba%20Group%2C%20I%20would%20like%20to%20make%20a%20business%20enquiry.',
    );
  });

  it('keeps the legacy head-office and postal strings', () => {
    expect(contact.headOffice).toBe('Itemba Filling Station, Along Tunduma-Ileje Highway, Mpemba, Tunduma');
    expect(contact.postal).toBe('P.O. Box 132, Tunduma-Songwe, Tanzania');
  });
});
