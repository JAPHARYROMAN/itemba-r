# Public-site rebuild verification - 14 October 2026

Updated **15 October 2026** for the user's explicit decision to launch with
**WhatsApp, email and phone only**. This supersedes server-side email delivery
and Resend provisioning as launch prerequisites.

The final direct-contact source is `b71599f3f6e7bbd4aabed4da97cc8b4282499e3b`.
It passed full local verification and the Linux Website workflow. Its new
production-target deployment was staged without public domains, tested and then
promoted unchanged on 15 October. Later documentation commits do not change the
application tree in that tested artifact. The public rebuild is live at
[www.itembagrouptz.com](https://www.itembagrouptz.com/).

## Direct-contact launch decision - 15 October

The public contact card has no form, personal-detail fields or submit control and
makes no `POST /api/enquiries` request. Its company selector only supplies context
to a prepared WhatsApp message or email. Visitors send in their own app or make a
phone call. All three default contact links are server-rendered.

The API's payloads, routing intents and response statuses remain available for
future use. Existing phone/email/WhatsApp click analytics are retained. The public
card emits no `enquiry_submit` conversion and makes no claim of message delivery,
inbox receipt or an answered call.

The user confirmed the MCP connection and accepted Resend terms on 15 October.
No Resend resource or credential was provisioned. The unused provider must not be
provisioned for this launch; missing email environment variables are no longer a
release blocker.

## Final direct-contact verification - 15 October

| Check | Result |
| --- | --- |
| Full local verification (`npm run verify`) | Passed: typecheck, lint, 708 unit tests, production build, budgets and 420 Playwright tests; 16 explicit viewport-specific skips |
| Linux Website CI | [Passed](https://github.com/JAPHARYROMAN/itemba-r/actions/runs/38714118282): type/lint/709 unit tests, build/budgets/420 E2E tests (16 explicit skips), Docker smoke and Lighthouse |
| Production dependency audit | [Passed](https://github.com/JAPHARYROMAN/itemba-r/actions/runs/38714118281/job/116352498229), zero production vulnerabilities |
| Accessibility and interaction | No serious or critical axe findings across all 25 routes at phone/desktop widths; keyboard, reduced motion, no-JavaScript navigation and direct links passed |
| Direct-contact behavior | Company defaults and all prepared subjects/messages/phone targets pass; no public form, personal fields, submit control, enquiry POST or submission conversion |
| Manual staged review | Desktop 1440×1000 and mobile 360×800 Contact card reviewed; Westsides selection updates context and contact targets; all three mobile channel actions fit without clipping |
| Retained contracts | API payload/status/routing tests, metadata, JSON-LD, route links, social cards, redirects, sitemap, robots, print and PDF input lock passed |

Contact tests inspect or cancel channel navigation. No real message was sent or
phone call placed, and no inbox receipt or answered-call claim is made. The
source review found no actionable React, native-radio focus, SSR or analytics
issues in the replacement card.

### Historical form-candidate verification

The following evidence applies to source `21c229d815e16239297e0bb9fb6f74d3c10e591b`.
It remains useful historical evidence and must be refreshed for the new contact UI.

| Check | Result |
| --- | --- |
| Full verification (`npm run verify` from `website/`) | Passed: typecheck, lint, unit tests, production build, budgets and Playwright |
| Unit suite | 710 passed locally; 711 passed in Linux CI |
| Full Playwright suite | 416 passed, 16 explicitly skipped, no failures |
| Focused print suite after pagination repair | 20 passed, 2 explicitly skipped |
| Production dependency audit | Zero reported production vulnerabilities; Next.js pinned to 15.5.27 |
| Public URL contract | All 25 sitemap routes covered; company/service/article URLs retained |
| Accessibility | No serious or critical axe violations in tested phone/desktop routes |
| Interaction contracts | No-JavaScript navigation/contact fallbacks, keyboard focus containment/restoration, Escape and mobile quick contact passed; axe/keyboard checks used reduced-motion emulation |
| Content/SEO contracts | Canonicals, redirects, metadata, JSON-LD, social cards, route links and enquiry intent routing passed |

The explicit skips cover viewport-specific cases. Playwright used the production
standalone server. Prior enquiry tests used test storage or controlled responses;
they do not establish real email delivery, which is not part of the new public path.

### Retained performance budgets and measured comparison

The final direct-contact build passes the existing gzip-based budgets below
(decimal kB). The original 110 kB shared-JS ambition remains a recorded deviation.

| Metric | Limit | Final local measured result |
| --- | --- | --- |
| Shared first-load JavaScript | 122 kB | 120.4 kB, passed |
| Total first-load JavaScript, ordinary routes | 125 kB | 122.9 kB, passed |
| Total first-load JavaScript, enquiry/profile routes | 135 kB | 126.7 kB contact routes; 129.9 kB profile, passed |
| Stylesheets per page | 30 kB | 14.3 kB, passed |

HTML/client-island and Linux font-preload checks also passed. The final
[Linux Lighthouse job](https://github.com/JAPHARYROMAN/itemba-r/actions/runs/38714118282/job/116352499189)
passes all advisory budgets: representative mobile performance 97–99,
accessibility/SEO 100, LCP 2007–2494 ms, CLS zero and TBT 33–75 ms. The fresh
[24-run paired comparison](mobile-performance-2026-10-15.md) measures the
baseline and final direct-contact source with their matching Next.js runtimes.
Representative scores are unchanged or improved (96/97/99/97), and all
accessibility/SEO scores are 100. Two inherited local advisory misses remain:
Home LCP 2720 ms and Fuel CLS 0.085. Fuel LCP improves 470 ms and Contact 147 ms;
Home's 10 ms LCP change is within ordinary run variability. The
[14 October comparison](mobile-performance-2026-10-14.md) remains historical
evidence for the prior form candidate; its advisory misses do not describe the
current CI result.

## Content and downloadable profiles

The [content verification record](content-verification-2026-10-14.md) explains the
verify-or-omit decisions. Unconfirmed legal identifiers, dates and named leadership,
speculative expansions/emerging businesses, unsupported exclusivity and growth
claims, and unverified lodging/property images are withheld. Existing public
company names, three companies, six sectors and the owner-supplied 50+ stockists
statement remain.

All four PDFs were regenerated from the reviewed content/print layout, visually
checked at approximately 100 dpi and relocked. Their input hash is
`2e97c41c6cd175f92a66ecfedf59804084c28df3599763b63a31b24da760045f`.
The direct-contact copy changes do not modify PDF inputs.

| Download | Pages |
| --- | --- |
| [Group profile](../../website/public/downloads/itemba-group-profile.pdf) | 7 |
| [Enterprises profile](../../website/public/downloads/itemba-enterprises-profile.pdf) | 3 |
| [Mwanjalisi profile](../../website/public/downloads/itemba-mwanjalisi-profile.pdf) | 3 |
| [Westsides profile](../../website/public/downloads/itemba-westsides-profile.pdf) | 3 |

The 16 reviewed pages have legible text, correct titles and sequential counters,
no clipping/overlaps or orphan trailing pages, and no known withheld-content drift.
Enterprises' short operating-focus section stays together. Future PDF-input edits
require regeneration, visual review and a new input lock.

## Release checklist - direct-contact candidate

| Release evidence | Status / slot to update |
| --- | --- |
| Prior source commit | `21c229d815e16239297e0bb9fb6f74d3c10e591b` |
| Prior Linux website CI / Docker smoke | [Passed](https://github.com/JAPHARYROMAN/itemba-r/actions/runs/38601224580): 416 browser tests, build/budgets, 711 unit tests and Docker image/volume/health checks |
| Prior production dependency audit | [Passed with zero vulnerabilities](https://github.com/JAPHARYROMAN/itemba-r/actions/runs/38601224468/job/115980678569) |
| Prior staged deployment | READY production-target `dpl_Cd9YP4XnYnM4g8Af7bFvWJELA1Q7`; [protected staged site](https://itemba-f3nadyxrn-japharyromans-projects.vercel.app). This contains the old form and is not the new launch candidate. |
| Prior remote checks | Passed for 25 pages, 25 valid 1200×630 OG PNGs, metadata/JSON-LD/canonicals, health/robots/sitemap/manifest/404/API GET 405, static assets and all four PDF hashes. Home/Contact were reviewed at phone/desktop widths; additional remote axe harness ran zero tests after a metadata DNS failure. |
| Direct-contact source commit | `b71599f3f6e7bbd4aabed4da97cc8b4282499e3b` |
| Direct-contact local and Linux verification | Passed, as recorded above. |
| New staged deployment ID / URL | READY production-target `dpl_9W5tXvVAv2JsKaFsn3W7Wsq7BTe4`; [protected staged site](https://itemba-c8jyv13cm-japharyromans-projects.vercel.app), created with `--prod --skip-domain`. |
| New remote page and contact validation | Passed: 25 page GETs and metadata/JSON-LD/canonicals; 19 SSR direct cards with correct company defaults, three channel targets and prepared context; 25 valid 1200×630 OG PNGs; four repo-identical PDF hashes; CSS/font/favicon hashes, optimized hero, webpack, font preloads, health, robots/sitemap/manifest, missing route 404 and API GET 405. |
| Server-side email / Resend | Not required for this launch. Terms accepted, provider not provisioned and unused. No receipt claim or server-side submission event is part of acceptance. |
| Production promotion | Completed on 15 October at approximately 09:48 UTC using `vercel promote dpl_9W5tXvVAv2JsKaFsn3W7Wsq7BTe4`; no rebuild. `vercel inspect www.itembagrouptz.com` resolves to this exact READY production ID. [Release PR #121](https://github.com/JAPHARYROMAN/itemba-r/pull/121) records final merge and operational closure. |
| Post-promotion verification | Passed: all 25 public pages, 19 direct cards, 25 byte-identical social cards, all four PDF hashes/16 pages, metadata, assets, preloads, health, sitemap/robots/manifest, missing 404 and API GET 405. Live mobile Home/Contact and company selection reviewed. No inbox-receipt claim. |
| Redirect correction | Existing Vercel apex redirect had an unset status (observed 307), overriding the app's permanent redirect. Set explicit `redirect: www.itembagrouptz.com` and `redirectStatusCode: 308`; DNS and destination unchanged. Preserve both fields when using the project-domain PATCH API. Apex and trailing-slash probes preserve paths/queries. |
| Rollback checkpoint | Original READY deployment retained; `www` reconfirmed at its exact ID on 15 October before promotion. |
| Temporary settings / credentials | The one scoped automation credential created for staged reads was revoked and absence verified. Original `autoAssignCustomDomains=true` recorded; guard held false through Git source finalization to prevent another build replacing the promoted artifact. Final restoration/alias check is recorded in [PR #121](https://github.com/JAPHARYROMAN/itemba-r/pull/121). |

The authenticated CLI and exact existing project link were used. The user's MCP
consent was acknowledged, but the app connector still rejected authentication;
it did not block the working CLI release path. Follow
[DEPLOY.md](../../website/DEPLOY.md) for future staged releases. No email-provider
onboarding is needed for the direct-contact decision. No ERP files or deployment
were included. The local production preview and owned audit browser/baseline
processes were stopped after verification.

Detailed temporary evidence is retained under `tmp/direct-staged-http/`,
`tmp/public-release-http/`, `tmp/direct-public-site-performance/` and
`tmp/public-site-qa/`. These ignored artifacts contain no authentication values;
the public/staged sweeps made only GET requests.

## Original production / rollback target

Captured before deploying this rebuild. Preserve this original deployment as the
rollback target rather than substituting a later preview or candidate.

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
both aliases, health and key routes. Record the action and resulting checks;
a local Git reset is not a production rollback. Restore the recorded original
`autoAssignCustomDomains` setting after rollback checks as well.
