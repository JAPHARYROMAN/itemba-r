# Public-site rebuild verification - 14 October 2026

Updated **15 October 2026** for the user's explicit decision to launch with
**WhatsApp, email and phone only**. This supersedes server-side email delivery
and Resend provisioning as launch prerequisites.

The prior rebuild candidate passed local verification and Linux Website CI and
was staged without public domains. Its staged HTTP checks completed on 15 October
against the same immutable deployment. The new direct-contact source requires a
new commit, build, staged deployment and validation before production promotion.

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

## Completed evidence for the prior form-based candidate

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

The prior build passed the existing gzip-based budgets below (decimal kB). The
new direct-contact build must pass the same limits. The original 110 kB shared-JS
ambition remains a recorded deviation.

| Metric | Limit | Prior measured result |
| --- | --- | --- |
| Shared first-load JavaScript | 122 kB | 120.3 kB, passed |
| Total first-load JavaScript, ordinary routes | 125 kB | All measured routes passed |
| Total first-load JavaScript, enquiry/profile routes | 135 kB | All measured routes passed |
| Stylesheets per page | 30 kB | 14.8 kB, passed |

HTML/client-island and Linux font-preload checks also passed. The
[24-run mobile comparison](mobile-performance-2026-10-14.md) measures the prior
form-based candidate: representative performance 94–97 and accessibility/SEO 100.
It has not been rerun for the smaller direct-contact client. The comparison misses
Home/Profile LCP and Fuel CLS; Linux CI's advisory Lighthouse job misses Fuel LCP
(2672 ms) and Profile LCP (2950 ms). These advisory results do not change the
retained blocking bundle limits.

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

## Release checklist - direct-contact candidate pending

| Release evidence | Status / slot to update |
| --- | --- |
| Prior source commit | `21c229d815e16239297e0bb9fb6f74d3c10e591b` |
| Prior Linux website CI / Docker smoke | [Passed](https://github.com/JAPHARYROMAN/itemba-r/actions/runs/38601224580): 416 browser tests, build/budgets, 711 unit tests and Docker image/volume/health checks |
| Prior production dependency audit | [Passed with zero vulnerabilities](https://github.com/JAPHARYROMAN/itemba-r/actions/runs/38601224468/job/115980678569) |
| Prior staged deployment | READY production-target `dpl_Cd9YP4XnYnM4g8Af7bFvWJELA1Q7`; [protected staged site](https://itemba-f3nadyxrn-japharyromans-projects.vercel.app). This contains the old form and is not the new launch candidate. |
| Prior remote checks | Passed for 25 pages, 25 valid 1200×630 OG PNGs, metadata/JSON-LD/canonicals, health/robots/sitemap/manifest/404/API GET 405, static assets and all four PDF hashes. Home/Contact were reviewed at phone/desktop widths; additional remote axe harness ran zero tests after a metadata DNS failure. |
| Direct-contact source commit | Pending: record the commit containing the direct card, updated copy and tests. |
| Direct-contact local and Linux verification | Pending refreshed full verification and CI. Focused API/content/PDF-lock subset passed 157 tests; copy lint passed. |
| New staged deployment ID / URL | Pending a new production-target build with live-domain assignment disabled. |
| New remote page and contact validation | Pending: all 25 routes/assets/SEO/downloads; mobile/desktop and accessibility; company defaults and prepared WhatsApp/email context; phone target; keyboard and no-JavaScript links; no public forms/personal fields/submit controls/enquiry POSTs; retained channel-click analytics. |
| Server-side email / Resend | Not required for this launch. Terms accepted, provider not provisioned and unused. No receipt claim or server-side submission event is part of acceptance. |
| Production promotion | Pending the same newly staged and validated direct-contact artifact; release PR remains unmerged. |
| Post-promotion verification | Pending promotion, public page/health/download checks, direct contact targets and channel-click analytics. Inbox receipt is not a prerequisite. |
| Rollback checkpoint | Original READY deployment retained; `www` still pointed to its ID after prior staging. Reconfirm before the next attempt. |
| Temporary settings / credentials | Prior `autoAssignCustomDomains=true` was restored; the CLI-created automation bypass credential was revoked and verified absent. For the new attempt, record the setting, apply the temporary staging guard, then restore its original value and revoke only credentials created for that attempt after checks or before ending a blocked attempt. |

The CLI authentication and project link previously worked; the user subsequently
confirmed the MCP connection. Check the chosen authenticated tool path when
starting the new staging attempt. Follow [DEPLOY.md](../../website/DEPLOY.md) for
staging, testing, promoting the same artifact and restoring the temporary guard.
No email-provider onboarding is needed for the direct-contact decision.

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
