# Deploying the Itemba Group website

The public marketing site is hosted on **Vercel**, in the existing `itemba-r`
project. `website/` is an independent Next.js 15 app; its package and lockfile are
separate from the ERP `frontend/` and `backend/`. A public-site release uses the
Vercel procedure below and does not run the ERP/droplet deployment workflow.

**Launch decision, 15 October 2026:** the public site offers WhatsApp, email and
phone contact only. Its contact cards have no forms or personal-detail fields and
make no `POST /api/enquiries` requests. Company selection prepares message context;
visitors send in their own messaging/email app or place a call. Resend terms were
accepted by the user, but Resend must not be provisioned for this unused launch
path. Server-side email configuration and inbox receipt are not launch prerequisites.
This contact change requires a new production-target build. Record its source,
staged deployment, validation and promotion in the
[release verification record](../docs/public-site/rebuild-verification-2026-10-14.md).

Verified hosting configuration on **14 October 2026**:

| Setting | Value |
| --- | --- |
| Scope | `team_TeJHOALxYDLMBE2VNoy81baj` (`japharyroman's projects`) |
| Project | `itemba-r` / `prj_8hHUGyGgL0ZtLT6a7Ap14J7ItAKq` |
| Root Directory | `website` |
| Runtime | Node.js `24.x`; Next.js framework preset |
| Install / build | `npm ci` / `npm run build` |
| Public domains | `www.itembagrouptz.com` and `itembagrouptz.com` |

Domain DNS is managed through Cloudflare. Keep the existing domain assignments
and DNS for this release. Docker deployment remains an alternative reference:
the app's standalone image serves every page, asset and API endpoint on port
**3001**, independently of Vercel.

---

## 1. Environment variables

Two classes — and the distinction matters.

### Build-time (Vercel environment settings, or Docker `--build-arg`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | optional | Google Analytics 4 ID (`G-XXXXXXXXXX`). Enables GA + the conversion events. |
| `NEXT_PUBLIC_GTM_ID` | optional | Google Tag Manager container ID (`GTM-XXXXXXX`). Alternative/addition to GA. |
| `GOOGLE_SITE_VERIFICATION` | optional | Search Console verification token (baked into `<meta>` on static pages). |

`NEXT_PUBLIC_*` values are **compiled into the client bundle at build time**.
Configure them before the Vercel build. Setting them only at `docker run` has no
effect — Docker builds require `--build-arg`s.
If neither analytics ID is set, the `<Analytics />` component renders nothing
(no tracking, no errors).

### Retained API runtime settings — future use

`POST /api/enquiries` retains its payload, routing intents and response statuses
for compatibility. The current public contact card does not call it. The
following settings apply to future API use, not the direct-contact launch:

| Variable | Required | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | future API email only | Sends API enquiry emails via Resend. No provider/key is needed for the direct contact links. |
| `ENQUIRY_EMAIL_TO` | future API email only | Destination inbox for API enquiry submissions. |
| `ENQUIRY_EMAIL_FROM` | future API email only | Verified sender address for future Resend API delivery. |
| `ENQUIRY_STORAGE_DIR` | future self-hosted API storage | Append location for `enquiries.jsonl`; defaults to **`/app/data`** in Docker. Keep it writable and mount a volume when exercising the retained API, including when API email is enabled. Vercel filesystem storage is not durable. |

Vercel/serverless filesystem writes are temporary and are not a durable API
fallback. The retained API returns its existing delivery-error response when no
working transport is configured. This does not affect WhatsApp, email or phone
links. A future decision to enable website submissions requires its own provider,
verified sender, secure environment configuration and delivery validation.

---

## 2. Vercel: stage, verify, promote

Run from the **repository root**, because the linked project's Root Directory is
`website`. Reuse the existing `.vercel/project.json` link and confirm its project
and scope match the table above. The root `.vercelignore` includes website sources,
fonts, images and PDFs, while excluding ERP code, local dependencies, build
artifacts and environment files. Deploy source rather than a local prebuilt output.

1. Confirm the target, domain ownership and current production deployment. Record
   the exact current deployment ID for rollback. Inspect environment **key names**
   with `env ls`; never retrieve or print secret values.

   ```bash
   vercel project inspect itemba-r --scope team_TeJHOALxYDLMBE2VNoy81baj --non-interactive --yes
   vercel domains inspect itembagrouptz.com --scope team_TeJHOALxYDLMBE2VNoy81baj
   vercel inspect www.itembagrouptz.com --scope team_TeJHOALxYDLMBE2VNoy81baj
   vercel env ls production --scope team_TeJHOALxYDLMBE2VNoy81baj
   vercel env ls preview --scope team_TeJHOALxYDLMBE2VNoy81baj
   ```

2. Commit the direct-contact source and complete `npm run verify` from `website/`,
   production dependency audit, Lighthouse review, PDF regeneration/relocking
   when PDF inputs changed, and visual acceptance. Prior form-based build/staging
   evidence does not verify this new contact UI. The
   separate Website CI Docker smoke verifies container health and enquiry-volume
   persistence; `npm run verify` does not run that job.

3. Use the reversible `autoAssignCustomDomains=false` project setting as a
   temporary staging guard, recording its original value. Create a
   **production-target** candidate without assigning live domains:

   ```bash
   vercel deploy --prod --skip-domain --scope team_TeJHOALxYDLMBE2VNoy81baj --yes
   ```

4. Record the candidate ID/URL and test that deployment: all public pages, mobile
   navigation, health, metadata, OG cards, redirects and four PDF downloads.
   Verify all company/service defaults and the WhatsApp, email and phone targets,
   prepared message context, keyboard and no-JavaScript contact links. Confirm
   the public UI has no forms, personal-detail fields, submit controls or enquiry
   POST requests; do not claim message receipt from a channel click.
   If deployment protection applies, use authenticated
   `vercel curl / --deployment <candidate-url>` rather than weakening protection.
   Confirm the public domains still resolve to the recorded prior deployment.

5. Promote **that same tested production artifact**, without rebuilding it:

   ```bash
   vercel promote <candidate-deployment-id> --scope team_TeJHOALxYDLMBE2VNoy81baj --yes
   ```

   Reinspect `www.itembagrouptz.com` to confirm the candidate ID now owns the public
   aliases, then repeat public smoke and direct-contact checks. Restore the
   recorded original `autoAssignCustomDomains` setting after promotion and smoke
   checks (`true` at the 14 October checkpoint). If launch is blocked, restore
   it before ending the attempt and leave the release PR unmerged. Revoke only
   temporary automation-bypass credentials created for this staging attempt and
   verify they are absent. The staging guard is temporary, not a permanent
   hosting change.

6. If acceptance fails after promotion, roll back to the **exact recorded prior
   production ID** and verify both public domains and health again. The checkpoint
   observed on 14 October 2026 was `dpl_2VUv5cacWsXNijokS3TcL96o4nFT`:

   ```bash
   vercel rollback dpl_2VUv5cacWsXNijokS3TcL96o4nFT --scope team_TeJHOALxYDLMBE2VNoy81baj --yes
   ```

   For later releases, replace that example with the ID recorded immediately
   before staging. Do not infer the rollback target from a branch name or deploy
   the ERP stack to roll back the public website.

## 3. Docker alternative: build the image

The build context is the `website/` directory (the Dockerfile expects
`package.json` and the app at the context root).

```bash
# from the repo root
docker build \
  --build-arg NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX \
  --build-arg GOOGLE_SITE_VERIFICATION=your-search-console-token \
  -t itemba-website:latest \
  -f website/Dockerfile \
  website
```

Omit the `--build-arg`s for a build without analytics (e.g. a staging preview).

## 4. Docker alternative: run the container

```bash
docker run -d --name itemba-website \
  -p 3001:3001 \
  itemba-website:latest
```

If the retained API is exercised in a future self-hosted workflow, add
`-v itemba-enquiries:/app/data` to persist its `enquiries.jsonl` records across
container recreations. API email settings can be inherited from the operator's
secure environment for that separate workflow.

The site is now on `http://<host>:3001`.

The direct-contact example requires no email-provider credentials.

## 5. Docker alternative: domain & TLS

Point **`www.itembagrouptz.com`** at the host and terminate TLS at a reverse
proxy (Nginx / Caddy / your platform's load balancer) forwarding to `:3001`.

`next.config.ts` already redirects the apex and the legacy `itembagroup.com` and
`www.itembagroup.com` hosts to `https://www.itembagrouptz.com`, keeping the path
and query. The redirects are permanent (`permanent: true`), which Next sends as
**308**, not 301. Configure DNS for both the apex and `www`, and let the app
normalise them. Set the DNS `A`/`AAAA` (or `CNAME` for `www`) records
accordingly. The legacy hosts only redirect if DNS and the reverse proxy also
send them to the app. Next also 308-redirects a trailing slash to the path
without it (`/about/` → `/about`).

Search engines and headers:

- `robots.txt` allows the whole site except `/api/`, and points at
  `https://www.itembagrouptz.com/sitemap.xml`.
- The staging hosts `staging-www.itembagrouptz.com` and
  `www-staging.itembagrouptz.com` answer with `X-Robots-Tag: noindex`, so a
  staging deploy of the same image stays out of search results. Production
  hosts never get that header.
- Responses carry no `X-Powered-By` header (`poweredByHeader: false`).

## 6. Verify after deploy

```bash
curl -I https://www.itembagrouptz.com/                      # 200, text/html
curl -I https://www.itembagrouptz.com/companies/mwanjalisi-oil/opengraph-image  # 200, image/png
curl -s https://www.itembagrouptz.com/ | grep -o '<title>[^<]*</title>'
curl -s https://www.itembagrouptz.com/robots.txt                # Disallow: /api/ and the Sitemap line
curl -sI https://staging-www.itembagrouptz.com/ | grep -i x-robots-tag  # staging only: noindex
```

- **Analytics:** open the site with GA DebugView (or the GTM Preview) and confirm:
  - a `page_view` event on client-side navigation;
  - a `website_conversion` event with `conversion_action` set to `phone_click`,
    `email_click` or `whatsapp_click` when a phone, email or WhatsApp link is
    clicked.

  The direct-contact card does not emit `enquiry_submit`; a channel click does
  not establish sending, inbox receipt or an answered call. Channel events are
  wired in `src/components/ConversionTracker.tsx` and emit when a GA/GTM ID is
  present in the build. The retained API and conversion helper do not imply an
  active website-submission journey.
- **Social cards:** paste a page URL into the
  [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) or
  [X Card Validator](https://cards-dev.twitter.com/validator) — every route now
  serves a bespoke 1200×630 card.

## 7. Health

`GET /api/health` returns `200` with `{"status":"ok","service":"itemba-group-website",…}`
(handled by `src/app/api/health/route.ts` on both Vercel and the standalone
container). Use it as the liveness/readiness probe rather than `GET /` (which
renders the full marketing homepage):

```bash
curl -fsS http://localhost:3001/api/health
```

The image already declares a Docker `HEALTHCHECK` against this endpoint, so
`docker ps` / orchestrators report health automatically.

## 8. Regenerating the downloadable PDFs

The company-profile page offers ready-made PDF downloads at
`/downloads/itemba-<profile>-profile.pdf` (group + the three companies). These
are **pre-generated, committed binaries** under `website/public/downloads/` —
Vercel and the runtime image serve them as static files (no runtime Chromium).

They are produced from the same `@media print` layouts the in-browser "Print"
button uses, via Chromium's print engine, so they stay in sync with the print
output. **Regenerate them whenever the profile content changes** — i.e. after
editing the profile content (`src/content/profile/**`), the print documents
(`src/print/**`) or their stylesheet (`src/styles/print.css`), or the contact
and site data (`src/content/contact.ts`, `src/content/site.ts`):

```bash
# one-time, downloads the headless browser into the Playwright cache (not the image)
npx playwright install chromium      # CI/Linux: npx playwright install --with-deps chromium

# from website/: build and regenerate all four PDFs
npm run pdf

# visually review every document, then record the exact inputs and outputs
npm run pdf:lock
git add public/downloads scripts/pdf-inputs.lock
```

`npm run pdf` builds the site, starts the production server on a temporary port,
prints each profile to `public/downloads/`, and shuts the server down. To render
against an already-running server instead of building, use
`PDF_BASE_URL=http://127.0.0.1:3001 npm run pdf:generate`.

> Keep `public/downloads/` tracked in git and **not** excluded in
> `.dockerignore` or the root `.vercelignore` — that's how the PDFs reach both
> hosting paths. Regenerate and relock after any tracked PDF input or dependency
> changes; changing the flag for unpublished legal details also requires new PDFs.
> Playwright is a
> `devDependency` only; it is never traced into the standalone runtime.
