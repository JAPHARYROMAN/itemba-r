# Direct-contact launch: mobile performance comparison — 15 October 2026

A fresh paired comparison completed **24 successful mobile Lighthouse audits**
on 15 October, approximately 12:42–12:47 EAT: three runs per route for the retained
pre-rebuild baseline and the final direct-contact candidate. Representative
performance scores were unchanged or higher; existing advisory metric misses
reduced from three to two.

## Source, builds and measurement method

- Baseline source: `7f36a58bda187b1d374e3cc72c15719f93044bdb`. The retained archived
  production build (`nU-gJWAebvvAMZYPqg9v2`) was compiled with Next.js 15.5.26.
- Final source: `b71599f3f6e7bbd4aabed4da97cc8b4282499e3b`. Its verified production
  standalone build (`oOYrezYM0OJYkBJkZ8zGO`) uses Next.js 15.5.27 and the direct
  WhatsApp/email/phone card, without a public form or personal-detail fields.
- The retained baseline was served with an existing matching Next.js 15.5.26
  runtime through an ignored, process-only `next/*` resolution helper. Attempting
  to serve that build with 15.5.27 returned Fuel 404/`NoFallbackError`; that setup
  was rejected before any recorded audit. No baseline install, rebuild, source
  edit or dependency-junction change was made.
- Tools for both sets: LHCI 0.15.1, Lighthouse 12.6.1, Chrome 154.0.8037.98 and
  Node.js 24.19.0. Baseline and final ran on ports 3037 and 3035 respectively.
- Existing CI settings: mobile, simulated 150 ms RTT, 1638.4 Kbps throughput and
  4× CPU slowdown, three runs per URL. Collections ran sequentially, baseline
  then final, without concurrent local builds or test suites.
- Both collections attached to one isolated hidden headless Chrome instance to
  avoid Windows temporary-profile teardown failures. Lighthouse retained its
  standard per-run origin and browser-cache reset. All eight target URLs returned
  200 before measurement; Fuel/Contact/Profile showed baseline forms and final
  direct-contact cards as expected.

The measured change includes the full public-site rebuild, direct-contact launch
scope and Next.js patch. Raw reports, configs, assertion logs, diagnostics,
metadata and the reproducible helper are retained under
`tmp/direct-public-site-performance/`. The earlier
[14 October comparison](mobile-performance-2026-10-14.md) remains the record of
its prior form-based candidate.

## Native LHCI representative results

LHCI's `median-run` chooses the run nearest median FCP and interactive values.
Times below are milliseconds; values show baseline → final direct candidate.
Accessibility and SEO scored **1.00 on every route** in both sets.

| Route | Performance | LCP ms | TBT ms | CLS | Final advisory misses |
|---|---|---|---|---|---|
| Home `/` | 0.96 → 0.96 | 2710 → 2720 | 14 → 20 | 0.006 → 0.000 | LCP |
| Fuel `/services/fuel-and-lubricants` | 0.94 → 0.97 | 2728 → 2258 | 23 → 35 | 0.089 → 0.085 | CLS |
| Contact `/contact` | 0.99 → 0.99 | 2107 → 1959 | 61 → 17 | 0.001 → 0.005 | None |
| Profile `/company-profile` | 0.97 → 0.97 | 2484 → 2480 | 26 → 26 | 0.027 → 0.016 | None |

All final representatives meet the existing performance ≥0.90,
accessibility/SEO ≥0.95 and TBT ≤200 ms targets. Home LCP remains above 2500 ms
(2720 ms), and Fuel CLS remains above 0.05 (0.085). Those paths also missed the
same targets in the fresh baseline, which additionally missed Fuel LCP. Native
LHCI assertions therefore report three baseline metric misses and two final
metric misses. These remain advisory; the existing blocking bundle budgets are
unchanged.

## Independent per-metric medians

Each value is independently the median across its three runs and can differ from
the single native representative above.

| Route | Performance | FCP ms | LCP ms | TBT ms | CLS | Total transfer bytes |
|---|---|---|---|---|---|---|
| Home | 0.96 → 0.96 | 1211 → 1211 | 2710 → 2720 | 19 → 20 | 0.006 → 0.000 | 381410 → 411523 |
| Fuel | 0.94 → 0.96 | 1211 → 1210 | 2725 → 2333 | 23 → 27 | 0.089 → 0.085 | 336824 → 334522 |
| Contact | 0.99 → 0.99 | 1210 → 1209 | 2107 → 1959 | 61 → 17 | 0.001 → 0.005 | 243933 → 241367 |
| Profile | 0.97 → 0.97 | 1361 → 1359 | 2484 → 2481 | 24 → 24 | 0.027 → 0.016 | 343855 → 333241 |

## Diagnostics and interpretation

Home's representative LCP changed by **+10 ms (0.4%)**. Total transfer increased
by **30113 bytes (7.9%)**; image transfer increased by 32151 bytes with five image
requests instead of four. Script transfer decreased by 1401 bytes and CSS by
237 bytes. The rebuild's additional photographic content explains the measured
transfer increase.

Fuel's representative LCP improved by **470 ms**, and its independent median
improved by **392 ms**. Its remaining CLS is attributed by Lighthouse to the
web font loading and moving the hero image container. Contact LCP improved by
**147 ms** and TBT by **44 ms**. Profile representative timings were essentially
unchanged, with transfer reduced by **10614 bytes**.

No recorded run produced a Lighthouse warning. Host CPU benchmark readings
ranged from 2376 to 3687, so small timing deltas still have ordinary local-run
variability. This is a local simulated-mobile comparison; no field-performance
or message-delivery claim follows from it. No performance source changes were
made during measurement.
