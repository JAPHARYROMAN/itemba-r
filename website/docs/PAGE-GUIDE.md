# Page guide

How a page group builds its routes on the rebuilt site. The reference
implementations are home (`src/app/page.tsx`, `src/sections/home/*`) and the
company template (`src/app/companies/[slug]`, `src/sections/company/*`): copy
their patterns, spacing, type and component use.

## 1. Composing a page

- `src/app/<route>/page.tsx` is a **server component**. It exports its
  metadata, renders `<StructuredData>`, then the route's sections, then
  `<FooterTrail>` last.
- Sections live in `src/sections/<route>/`, one file per chapter
  (`AboutHero.tsx`, `AboutTimeline.tsx`, ...). Each section is one
  `<Section tone labelledBy>` + `<Container>` with an `h2`.
- Build from `@/ui` only. Use `PageHero`, `Section`, `Container`, `Heading`,
  `Eyebrow`, `Lede`, `ButtonLink`, `ChevronLink`, `ContactLink`, `Card`,
  `CardLink`, `Bento`/`BentoCell`, `Stat`, `FactList`, `FaqList`, `CheckList`,
  `Shortcuts`, `DirectionsLink`, `MapFacade`, `Media`, `TypePanel`, `CtaBand`,
  `SubNav`, `Reveal` and `Icon`. For a photograph in a
  hero or tile frame, use `LeadPhoto` (`src/sections/company/LeadPhoto.tsx`).
  If the kit lacks something, ask the integrator rather than styling around
  it.
- Copy comes from `src/content/*` only; content files hold no classes and no
  JSX. Contact data always comes from `@/content/contact` (or `ContactLink`).
  A grep test fails on phone numbers or the email address in `src/app` or
  `src/sections`.
- Unconfirmed facts stay behind `src/content/flags.ts` (`withFlags`,
  `isEnabled`). Keep the defaults: no divisions stat, no manufacturing, the
  estate stays typographic, and there is no growth claim.
- Client code goes only in `src/islands/`. Never server-render content at
  `opacity: 0`, and never put `data-reveal` (`<Reveal>`) on text, the hero or
  its LCP image. Only photographs fade up.

### Headings and the CTA hierarchy

- Each page has exactly one `h1`, from `PageHero`. Section titles are `h2`
  set at `size="h1"`; card titles are `h3` at `h4`/`h5`. Never skip a level.
- Each screen has at most one primary pill. Use `ButtonLink size="lg"` in the
  hero and the closing `CtaBand`.
- `ChevronLink` defaults to `body` (17px), which every tile, card and bento
  link uses. Use `body-lg` only beside an `lg` pill. There is no larger size
  by design.
- General enquiries go to `headerCta` (`/contact`), which is the
  general enquiry form. Never send a general "Enquire" or "Start a business
  enquiry" to `/partnerships`. A page with its own form links `#enquire`
  instead.

## 2. Tone rhythm

- The hero is `light`. After it, `light` and `alt` alternate.
- Use `cinema` (black) at most once per two screens, and never on two
  adjacent sections. A cinema tile carries a photograph or a `TypePanel`.
- The footer is `alt`, so the last section before it is `light`.
- Cards take the opposite surface of their tile automatically: `#f5f5f7` on
  white, white on `#f5f5f7`, raised black on cinema. Do not paint them by
  hand.

## 3. Photographs (owner decision)

- Reference photographs by registry id (`mediaImage('id')`), never by path.
  Metadata lives in `src/content/media.ts`.
- **Use the best photographs, sparingly.** Where no strong photograph exists,
  use a `TypePanel`: a line icon and one strong, factual sentence on an
  ink, alt or cinema panel. See the Westsides home tile and the Mwanjalisi
  and Enterprises strengths tiles.
- A page never shows the same photograph twice.
- A company's own page never shows its home tile photograph.
- A page shows at most two canopy photographs (`canopy: true`). The one
  exception is a station's own card on the Mwanjalisi Oil and fuel pages.
- Hero roles need a strong photograph.
  - Only a landscape master of 2000px or more runs across a frame
    (`heroFrame` decides). Anything smaller, or any portrait, stands beside
    the text in a 440px column or sits in a small cell.
  - Never use a hazy, tilted or low-resolution frame as a hero. These are
    retired from lead roles: `mpemba-coach-canopy` and
    `westsides-beer-delivery`.
- Third-party beverage branding stays out of hero roles until the owner
  answers the open question.
- Some images carry conditions:
  - Itemba Estate stays typographic (`flags.estateImagery`).
  - The UZUNGUNI INN room photo is flag-gated.
  - `Media` renders the Songwe landscape's CC BY-SA credit itself. Never
    crop the credit away.
- Art direction lives in the registry, not in the page: `focus`, `focusX` and
  `phoneZoom` for phone crops.

## 4. SubNav

These pages use `<SubNav>`: company pages, service pages
(`/services/[slug]`) and `/company-profile`, the last with ProfileNav in its
children slot. Its props:

- `title`: the page name.
- `label`: "<name> sections".
- `links`: in-page anchors. Every `#id` must exist on the page (tested).
- `menuLabel`: for the phone chevron menu.
- `cta`: `{ href: '#enquire', label: 'Enquire' }` when the page has a form,
  otherwise `headerCta`.
- `accent`: the company accent on company and service pages.

The global nav's Enquire pill steps aside automatically while a sub-nav is
on the page. See `CompanySubNav.tsx` for a worked example.

## 5. EnquiryRouter placement (a contract: route inventory checks presence and intent)

| Route | Mode | `title` / `description` | `defaultIntentId` |
|---|---|---|---|
| `/contact` | full | default | `general` |
| `/capabilities` | full | `enquiryPrompts.capabilities` | `general` |
| `/partnerships` | full | `enquiryPrompts.partnerships` | `general` |
| `/company-profile` | compact, `className="print-hidden"` | `enquiryPrompts.companyProfile` | `general` |
| `/faq` | compact | `enquiryPrompts.faq` | `general` |
| `/companies/[slug]` | compact | `company.enquiryLabel` | `company.id` |
| `/services/[slug]` | compact | `enquiryPrompts.service` | `service.intentId` |
| `/insights/[slug]` | compact | `enquiryPrompts.insightArticle` | `general` |
| `/locations/[slug]` | compact | `enquiryPrompts.location` | `general` |

- Use one router per page, inside a section with `id="enquire"`, with
  `headingLevel` set to fit the outline. Pages without a form (`/`,
  `/about`, `/companies`, `/services`, `/locations`, `/insights`) must not
  gain one.
- The quick-contact bar hides itself on the routes above
  (`hasInlineEnquiry`). Never change that matrix.
- `/contact` is the target of every Enquire pill. Keep its form high on
  the page.

## 6. Metadata, breadcrumbs and JSON-LD

- **Metadata:** use `pageMetadata({ title, description, path, ogTitle?,
  ogDescription?, type? })` from `@/lib/seo` (or `generateMetadata` for slug
  routes, with `dynamicParams = false`).
  - Title, canonical and og:url are hard baseline contracts.
  - Description and og/twitter copy are soft. Change them only with an
    entry under `routes` in `tests/baseline/approved-changes.json` that has
    a one-line reason.
  - Log every other intentional visible-copy change, link-target change or
    spec deviation in that file's `visible` list.
- **Breadcrumbs:** every inner page ends with
  `<FooterTrail items={[crumbs.home, crumbs.<section>, { name, path }]} />`
  (`crumbs` from `@/content/nav`). This renders the visible trail and the
  page's only BreadcrumbList. Do not add a second `<Breadcrumbs>` with
  JSON-LD.
- **JSON-LD:** use the typed builders in `@/lib/jsonld`: `companyJsonLd`,
  `serviceJsonLd`, `placeJsonLd`, `headOfficeJsonLd`, `articleJsonLd`,
  `faqPageJsonLd` and `webPageJsonLd`. Pass them through
  `<StructuredData data={[...]} />`.
  - The layout already emits Organization and WebSite.
  - Keep every baseline `@type` and `@id` (superset). The org `@id` is
    `ORG_ID`.
  - The FAQPage question count must equal the visible `<details>` count.

## 7. Checks to run before handing a page group back

From `website/`, on your own port (never the root checkout):

```sh
npm run typecheck
npm run lint                       # 0 errors; no new warnings in your files
npm run test:unit
npm run build
npm run budget                     # enforcing: JS, CSS, HTML and font budgets, no inline opacity:0, the 'use client' allowlist
E2E_ROUTES=/your,/routes/* npm run test:e2e:contract   # route inventory, links, JSON-LD, analytics, QuickContact
E2E_ROUTES=/your,/routes/* npm run test:e2e:quality    # axe at 360 and 1280, no-JS
```

`test:e2e*` serves `.next/standalone` on port 3191 itself. Stop any server you
started, and look at your pages at 360px and 1440px before you report.
