# Public-site rebuild verification - 14 October 2026

The local release candidate on `codex/public-site-rebuild` has passed the checks
below. Remote staging checks, the Lighthouse comparison, real enquiry email
delivery and production promotion remain pending. Local test success does not
establish that the candidate is deployed or that the production inbox receives
enquiries.

## Completed local evidence

| Check | Result |
| --- | --- |
| Full verification (`npm run verify` from `website/`) | Passed: typecheck, lint, unit tests, production build, budgets and Playwright |
| Unit suite | 710 passed |
| Full Playwright suite | 416 passed, 16 explicitly skipped, no failures |
| Focused print suite after pagination repair | 20 passed, 2 explicitly skipped |
| Dependency audit | Zero reported vulnerabilities; Next.js pinned to 15.5.27 |
| Public URL contract | All 25 sitemap routes covered; company/service/article URLs retained |
| Accessibility | No serious or critical axe violations in tested phone/desktop routes |
| Interaction contracts | No-JavaScript navigation/contact fallbacks, keyboard focus containment/restoration, Escape and mobile quick contact passed; axe/keyboard checks ran with reduced-motion emulation |
| Content/SEO contracts | Canonicals, redirects, metadata, JSON-LD, social cards, route links and enquiry intent routing passed |

The skipped tests are explicit viewport-specific cases: desktop-only server/PDF
checks and phone-only menu behavior. They are not failed tests. Playwright uses
the local production standalone server, not a development server. Its enquiry
checks use test storage or controlled responses and do not prove real email
delivery.

### Performance budgets

Sizes below are decimal kB, measured with the existing gzip-based budget checker.
The budgets were retained; the original 110 kB shared-JavaScript ambition remains
a recorded deviation, not an achieved result.

| Metric | Limit | Current result |
| --- | --- | --- |
| Shared first-load JavaScript | 122 kB | 120.3 kB, passed |
| Total first-load JavaScript, ordinary routes | 125 kB | All measured routes passed |
| Total first-load JavaScript, enquiry/profile routes | 135 kB | All measured routes passed |
| Stylesheets per page | 30 kB | 14.8 kB, passed |

HTML and client-island checks also passed. The existing checker permits the
known Windows font-manifest limitation; Linux CI and the Vercel build still
need to establish production font preloads. These build budgets do not prove
mobile LCP, CLS or blocking-time targets; those require the pending Lighthouse
comparison and remote measurements.

## Content and downloadable profiles

The [content verification record](content-verification-2026-10-14.md) explains
the verify-or-omit decisions. Unconfirmed legal identifiers, dates and named
leadership, speculative expansions/emerging businesses, unsupported exclusivity
and growth claims, and unverified lodging/property images are withheld. The
existing public company names, three companies, six sectors and owner-supplied
50+ stockists statement remain.

All four final PDFs were regenerated from the final content/print layout,
visually checked at approximately 100 dpi, and relocked. The input hash is
`2e97c41c6cd175f92a66ecfedf59804084c28df3599763b63a31b24da760045f`.

| Download | Pages |
| --- | --- |
| [Group profile](../../website/public/downloads/itemba-group-profile.pdf) | 7 |
| [Enterprises profile](../../website/public/downloads/itemba-enterprises-profile.pdf) | 3 |
| [Mwanjalisi profile](../../website/public/downloads/itemba-mwanjalisi-profile.pdf) | 3 |
| [Westsides profile](../../website/public/downloads/itemba-westsides-profile.pdf) | 3 |

The 16 pages have legible text, correct visible profile titles and sequential
page counters, no clipping/overlaps or orphan trailing pages, and no known
withheld identifiers, historical dates, named leaders or emerging-business
content drift. Enterprises' short operating-focus section now stays together.
Future PDF-input edits require regeneration, visual review and a new input lock.

## Remote release checklist - pending updates

| Release evidence | Status / slot to update |
| --- | --- |
| Candidate source commit | Pending final commit |
| Linux website CI / Docker smoke | Pending GitHub CI; local Docker Desktop engine unavailable |
| Preview/staging deployment ID and URL | Pending |
| Remote route, asset, health, 404, metadata and PDF checks | Pending against the actual candidate deployment |
| Remote accessibility and enquiry UI checks | Pending |
| Lighthouse baseline/candidate comparison | Pending: same four configured URLs and mobile settings, median of three runs; record baseline and candidate performance/accessibility/SEO, LCP, CLS and TBT |
| Real enquiry email delivery | Pending: send an identified release-test enquiry, confirm receipt in the intended mailbox and record the lead ID; mocked/local storage success is insufficient |
| Production promotion | Pending: record promoted deployment ID, time and resulting aliases |
| Post-promotion verification | Pending: both public hosts, key routes, health, downloads, enquiry delivery and live metadata |
| Rollback verification | Pending: retain and verify the original deployment below |

The configured Lighthouse targets are performance >= 90, accessibility/SEO >= 95,
LCP <= 2.5 s, CLS <= 0.05 and TBT <= 200 ms. Existing Lighthouse CI is
nonblocking; record any misses and the baseline comparison before promotion.
CLI authentication was reconfirmed. The connector remains unauthorized and its
OAuth connection is pending; this is not evidence of a deployment result.

## Original production / rollback target

Captured before deploying this rebuild. Preserve this original deployment as
the rollback target, rather than substituting a later preview or candidate.

| Field | Original value |
| --- | --- |
| Deployment ID | `dpl_2VUv5cacWsXNijokS3TcL96o4nFT` |
| Deployment URL | [Original production deployment](https://itemba-dx27bhhzx-japharyromans-projects.vercel.app) |
| State / target | READY / production |
| Source commit | `7f36a58bda187b1d374e3cc72c15719f93044bdb` |
| Project / root directory | `itemba-r` / `website` |
| Project ID | `prj_8hHUGyGgL0ZtLT6a7Ap14J7ItAKq` |
| Team ID | `team_TeJHOALxYDLMBE2VNoy81baj` |
| Production aliases | `www.itembagrouptz.com`, `itembagrouptz.com` |

If rollback is needed, restore production to this exact deployment and verify
both aliases, health and key routes. Record the action and resulting checks in
the release checklist; a local Git reset is not a production rollback.
