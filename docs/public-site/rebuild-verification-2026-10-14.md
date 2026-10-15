# Public-site rebuild verification - 14 October 2026

The release candidate on `codex/public-site-rebuild` has passed local verification
and Linux Website CI. A production-target build is staged on Vercel without the
public domains. The Lighthouse comparison is complete. Real enquiry email
delivery and production promotion remain pending; the missing email environment
must be configured and a new candidate tested before launch.

Staged HTTP verification completed on 15 October 2026 after the workstation
resumed. The deployment ID is immutable; checks before and after the pause used
the same candidate.

## Completed local evidence

| Check | Result |
| --- | --- |
| Full verification (`npm run verify` from `website/`) | Passed: typecheck, lint, unit tests, production build, budgets and Playwright |
| Unit suite | 710 passed locally; 711 passed in Linux CI |
| Full Playwright suite | 416 passed, 16 explicitly skipped, no failures |
| Focused print suite after pagination repair | 20 passed, 2 explicitly skipped |
| Production dependency audit | Zero reported production vulnerabilities; Next.js pinned to 15.5.27 |
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

HTML and client-island checks also passed. Linux CI passed the font-preload
checks that the Windows checker conditionally permits. These build budgets are
separate from the mobile Lighthouse measurements below.

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
| Candidate source commit | `21c229d815e16239297e0bb9fb6f74d3c10e591b` |
| Linux website CI / Docker smoke | [Website CI passed](https://github.com/JAPHARYROMAN/itemba-r/actions/runs/38601224580), including 416 browser tests, build/budgets, 711 unit tests and Docker image/volume/health checks |
| Production dependency audit | [Passed with zero vulnerabilities](https://github.com/JAPHARYROMAN/itemba-r/actions/runs/38601224468/job/115980678569) |
| Preview/staging deployment ID and URL | READY production-target `dpl_Cd9YP4XnYnM4g8Af7bFvWJELA1Q7`; [protected staged site](https://itemba-f3nadyxrn-japharyromans-projects.vercel.app) |
| Remote route, asset, health, 404, metadata and PDF checks | Passed: 25 pages and 25 valid 1200×630 OG PNGs; titles, descriptions, single H1, JSON-LD and canonical/OG URLs; health/robots/25-URL sitemap/manifest; 404 and enquiry GET 405; CSS/font/script/optimized hero image/favicon assets; all four PDF SHA256 hashes match the reviewed repository files. Each page has one font preload and stylesheet. |
| Remote accessibility and enquiry UI checks | Actual staged Home/Contact reviewed at mobile and desktop widths. Existing Linux CI axe/keyboard checks passed. Additional remote axe harness ran zero tests because its Vercel metadata lookup encountered a DNS failure after host suspension. |
| Lighthouse baseline/candidate comparison | [24 audits and comparison](mobile-performance-2026-10-14.md), same four URLs/settings, three runs each before/after. Candidate representative scores 94–97; accessibility/SEO 100. |
| Real enquiry email delivery | Blocked: Production and Preview email keys are absent, reconfirmed 15 October. A controlled staged submission displayed the real delivery-failure message, retained the visitor's message and presented WhatsApp/email/phone alternatives. No inbox receipt is claimed. Resend Free-plan provisioning is prepared and requires human Marketplace terms acceptance, then sender-domain verification/configuration, redeployment and confirmed receipt in the intended mailbox. |
| Production promotion | Not performed; release PR remains unmerged. |
| Post-promotion verification | Not performed; requires actual promotion and inbox delivery. |
| Rollback verification | Original READY deployment retained; `www` still points to its ID after staging. |
| Temporary settings / credentials | Original `autoAssignCustomDomains=true` restored; the sole CLI-created automation bypass credential was identified by its creation timestamp, revoked and verified absent after HTTP checks. Local owned preview/baseline servers and audit processes stopped. |

The configured Lighthouse targets are performance >= 90, accessibility/SEO >= 95,
LCP <= 2.5 s, CLS <= 0.05 and TBT <= 200 ms. Existing Lighthouse CI is
nonblocking. The local candidate comparison misses Home/Profile LCP and Fuel CLS;
the Linux CI advisory job misses Fuel LCP (2672 ms) and Profile LCP (2950 ms).
The blocking bundle budgets and all Website CI blocking jobs passed.

Vercel CLI authentication and the existing project link work. The official shared
MCP endpoint is configured, but its separate human OAuth consent timed out; the
connector still requests reauthentication. This does not prevent CLI deployment.

### Prepared email onboarding

Current official Vercel CLI 64.2.0 discovery identifies `resend/resend-email` in
the messaging category. The existing enquiry API already uses Resend. The
prepared installation targets this linked website project, the Free plan,
`itembagrouptz.com` sending domain, `us-east-1` and Production/Preview only:

```bash
npx --yes vercel@64.2.0 integration add resend/resend-email \
  --plan free --name itemba-public-site-enquiries \
  --metadata domain=itembagrouptz.com --metadata region=us-east-1 \
  --environment production --environment preview --no-claim --no-env-pull \
  --scope team_TeJHOALxYDLMBE2VNoy81baj --non-interactive
```

Vercel returned `integration_terms_acceptance_required`; no resource or email
credential was provisioned. The account owner must review and accept the
[Resend Marketplace agreement](https://vercel.com/japharyromans-projects/~/integrations/accept-terms/resend?source=cli)
before retrying that command. This includes Vercel/Resend terms and the stated
sharing of account ID, email and usage information. After installation, inspect
key names, complete sender-domain verification using the existing Cloudflare
DNS, set the verified sender and group recipient, and test a new staged build.
Do not promote the current environment snapshot expecting later environment
changes to appear in it.

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
