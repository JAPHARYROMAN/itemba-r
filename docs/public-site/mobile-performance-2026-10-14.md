# Public-site mobile performance comparison — 14 October 2026

Measured the public-site rebuild against a fresh production build of `origin/main`. All 24 recorded audits completed: three runs on Home, Fuel, Contact and Company Profile for each build, collected sequentially with no concurrent builds or test suites.

## Builds and method

- Baseline: `7f36a58bda187b1d374e3cc72c15719f93044bdb`, extracted with `git archive origin/main website`, built independently and served on port 3037.
- Rebuild candidate: `21c229d815e16239297e0bb9fb6f74d3c10e591b`, served from its production standalone build on port 3035.
- Baseline used Next.js 15.5.26, confirmed by its archived package lock and saved server startup log. The rebuilt standalone contains Next.js 15.5.27 after the framework patch. This comparison includes that patch as well as the site rebuild. Audit tools were unchanged: LHCI 0.15.1, Lighthouse 12.6.1 and Google Chrome 154.0.8037.98.
- Existing `website/lighthouserc.json` settings: mobile, simulated throttling, 150 ms RTT, 1638.4 Kbps throughput and 4× CPU slowdown. Three runs per URL.
- Chrome's automatic Windows teardown initially failed with EPERM. The recorded comparison attached LHCI to one dedicated hidden headless Chrome instance with an isolated profile. Lighthouse retained its standard per-run origin and browser-cache reset. Both builds used this same harness.

Raw reports, configurations, assertion logs, diagnostic details and the complete comparison JSON are retained locally under `tmp/public-site-performance/`. The baseline extraction is under `tmp/public-site-baseline/`. These directories are ignored by Git.

## Native LHCI representative runs

LHCI's `median-run` selects the run nearest the median FCP and interactive measurements. These are its actual representative results, rather than a run selected by median performance score. Values show baseline → rebuild; times are milliseconds.

| Route | Performance | LCP | TBT | CLS | Accessibility / SEO |
|---|---|---|---|---|---|
| Home `/` | 0.93 → 0.96 | 2512 → 2666 | 225 → 54 | 0.000 → 0.000 | 1.00 / 1.00 → 1.00 / 1.00 |
| Fuel `/services/fuel-and-lubricants` | 0.96 → 0.95 | 2408 → 2263 | 38 → 135 | 0.089 → 0.085 | 1.00 / 1.00 → 1.00 / 1.00 |
| Contact `/contact` | 0.95 → 0.97 | 2022 → 2026 | 233 → 181 | 0.001 → 0.005 | 1.00 / 1.00 → 1.00 / 1.00 |
| Profile `/company-profile` | 0.94 → 0.94 | 2900 → 2951 | 59 → 116 | 0.000 → 0.016 | 1.00 / 1.00 → 1.00 / 1.00 |

All rebuilt representative performance scores meet 0.90; accessibility and SEO are 1.00. Existing advisory metric targets are still missed on Home LCP (2666 > 2500 ms), Fuel CLS (0.085 > 0.05) and Profile LCP (2951 > 2500 ms). These same paths missed those targets in the baseline; baseline also missed Home and Contact TBT. LHCI assertions therefore fail for both builds: five baseline metric misses and three rebuild metric misses. This measurement does not change the retained blocking bundle budgets or elevate the advisory metric targets into new release gates.

## Independent per-metric medians

Each value below is the median of that metric across the three runs; it can differ from the single native representative run.

| Route | Performance | FCP ms | LCP ms | TBT ms | CLS | Total transfer bytes |
|---|---|---|---|---|---|---|
| Home | 0.95 → 0.96 | 1669 → 1491 | 2512 → 2666 | 141 → 106 | 0.000 → 0.000 | 381410 → 414242 |
| Fuel | 0.96 → 0.95 | 1214 → 1292 | 2409 → 2708 | 42 → 135 | 0.089 → 0.085 | 336822 → 337888 |
| Contact | 0.95 → 0.97 | 1223 → 1236 | 2007 → 2026 | 233 → 181 | 0.001 → 0.005 | 243933 → 244875 |
| Profile | 0.94 → 0.94 | 1737 → 1442 | 2888 → 2379 | 59 → 116 | 0.000 → 0.016 | 343854 → 336617 |

## Diagnostics and limits

Home transferred an additional 32832 bytes (8.6%). Image transfer accounts for 32151 bytes of the representative-run difference, with five image requests instead of four. Script and CSS transfer increased by approximately 845 and 250 bytes respectively. The homepage LCP element remains its high-priority station photograph; representative LCP increased by 154 ms (6.1%).

Fuel's recurring layout shift is attributed by Lighthouse to the web font loading and moving the hero's photograph container. CLS improved slightly but remains above the existing advisory target. Its independent median LCP increased by 299 ms (12.4%), while the native representative LCP improved by 144 ms. Profile's representative LCP remains image-load dominated, although its independent median LCP improved by 510 ms.

Host CPU benchmark readings varied substantially, and one rebuilt Home run scored 0.75 before subsequent runs scored 0.97 and 0.96. The report retains every successful run and both aggregation views. Small timing deltas and increased Fuel TBT need this variability considered before attributing them to source changes; the image-byte increase and recurring font-related Fuel CLS are directly supported by the diagnostics. No performance code changes were made during this comparison.
