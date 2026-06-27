# Deploying the Itemba Group website

The marketing site (`website/`) is an independent Next.js 15 app, separate from
the ERP `frontend/` and `backend/`. It ships as a single container using Next's
**standalone** output and serves on port **3001**.

> The container is fully self-contained: the homepage, all cinematic pages, the
> per-page Open Graph images, and the `/api/enquiries` endpoint are all served by
> the one Node process in `Dockerfile`. No external Next server is required.

---

## 1. Environment variables

Two classes — and the distinction matters.

### Build-time (inlined into the build — pass as `--build-arg`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | optional | Google Analytics 4 ID (`G-XXXXXXXXXX`). Enables GA + the conversion events. |
| `NEXT_PUBLIC_GTM_ID` | optional | Google Tag Manager container ID (`GTM-XXXXXXX`). Alternative/addition to GA. |
| `GOOGLE_SITE_VERIFICATION` | optional | Search Console verification token (baked into `<meta>` on static pages). |

`NEXT_PUBLIC_*` values are **compiled into the client bundle at build time**.
Setting them only at `docker run` has no effect — they must be `--build-arg`s.
If neither analytics ID is set, the `<Analytics />` component renders nothing
(no tracking, no errors).

### Runtime (read per request — pass at `docker run`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | for email | Sends enquiry emails via Resend. Without it, enquiries are saved but not emailed. |
| `ENQUIRY_EMAIL_TO` | for email | Destination inbox for enquiry submissions. |
| `ENQUIRY_EMAIL_FROM` | for email | Verified sender address for Resend. |
| `ENQUIRY_STORAGE_DIR` | optional | Where each enquiry is appended (`enquiries.jsonl`). Defaults to **`/app/data`** in the container (pre-created and writable by the runtime user; declared as a `VOLUME`). Every `POST /api/enquiries` writes here — even when email is configured — so the dir must stay writable. Mount a volume at `/app/data`, or point this at a mounted path, to persist enquiries across deploys. |

---

## 2. Build the image

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

## 3. Run the container

```bash
docker run -d --name itemba-website \
  -p 3001:3001 \
  -e RESEND_API_KEY=re_xxx \
  -e ENQUIRY_EMAIL_TO=enquiries@itembagrouptz.com \
  -e ENQUIRY_EMAIL_FROM=website@itembagrouptz.com \
  -v itemba-enquiries:/app/data \
  itemba-website:latest
```

The `-v itemba-enquiries:/app/data` mount persists submitted enquiries
(`enquiries.jsonl`) across container recreations. Without it they are still
written, but live only as long as the container.

The site is now on `http://<host>:3001`.

## 4. Domain & TLS

Point **`www.itembagrouptz.com`** at the host and terminate TLS at a reverse
proxy (Nginx / Caddy / your platform's load balancer) forwarding to `:3001`.

`next.config.ts` already 301-redirects the apex and the legacy `itembagroup.com`
hosts to `https://www.itembagrouptz.com`, so configure DNS for both the apex and
`www`, and let the app normalise them. Set the DNS `A`/`AAAA` (or `CNAME` for
`www`) records accordingly.

## 5. Verify after deploy

```bash
curl -I https://www.itembagrouptz.com/                      # 200, text/html
curl -I https://www.itembagrouptz.com/companies/mwanjalisi-oil/opengraph-image  # 200, image/png
curl -s https://www.itembagrouptz.com/ | grep -o '<title>[^<]*</title>'
```

- **Analytics:** open the site with GA DebugView (or the GTM Preview) and confirm
  a `page_view` on navigation, a `website_conversion` on a phone/email/WhatsApp
  click, and an `enquiry_submit` after submitting the enquiry form. All three are
  wired in `ConversionTracker` and `EnquiryRouter`; they only emit once a GA/GTM
  ID is present in the build.
- **Social cards:** paste a page URL into the
  [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) or
  [X Card Validator](https://cards-dev.twitter.com/validator) — every route now
  serves a bespoke 1200×630 card.

## 6. Health

`GET /api/health` returns `200` with `{"status":"ok","service":"itemba-group-website",…}`
(handled by `src/app/api/health/route.ts`, served by the same standalone Node
process). Use it as the liveness/readiness probe rather than `GET /` (which
renders the full marketing homepage):

```bash
curl -fsS http://localhost:3001/api/health
```

The image already declares a Docker `HEALTHCHECK` against this endpoint, so
`docker ps` / orchestrators report health automatically.
