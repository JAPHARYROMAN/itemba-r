// Generates the downloadable company-profile PDFs (one per profile) from the
// built site, reusing the page's existing @media print layouts via Chromium's
// print emulation. Run with `npm run pdf` (builds first) or, against an already
// running server, `PDF_BASE_URL=http://127.0.0.1:3001 npm run pdf:generate`.
//
// Output: website/public/downloads/itemba-<profile>-profile.pdf  (committed)
// Requires a one-time `npx playwright install chromium`.

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const PORT = 3010;
const HOST = '127.0.0.1';
const PROFILES = ['group', 'westsides', 'mwanjalisi', 'enterprises'];
const OUT_DIR = path.join(process.cwd(), 'public', 'downloads');

const footerTemplate = `
  <div style="width:100%;font-family:Arial,Helvetica,sans-serif;font-size:8px;color:#475569;padding:0 14mm;display:flex;justify-content:space-between;">
    <span>Itemba Group &middot; www.itembagrouptz.com</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(baseUrl, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`Server at ${baseUrl} did not become healthy within ${timeoutMs}ms`);
}

function startServer() {
  const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  const child = spawn(process.execPath, [nextBin, 'start', '-p', String(PORT), '-H', HOST], {
    cwd: process.cwd(),
    stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT), HOSTNAME: HOST },
  });
  return child;
}

function stopServer(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const external = process.env.PDF_BASE_URL;
  const baseUrl = external || `http://${HOST}:${PORT}`;
  const server = external ? null : startServer();

  let browser;
  try {
    await waitForServer(baseUrl);
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.emulateMedia({ media: 'print' });
    for (const id of PROFILES) {
      // Fresh load each iteration so the profile starts with its images intact
      // (the image strip below is destructive within a single page).
      await page.goto(`${baseUrl}/company-profile`, { waitUntil: 'networkidle' });

      // Set the profile and make it survive page.pdf(). page.pdf() fires a
      // 'beforeprint' event, and PrintProfileButton listens for it to reset
      // data-print-profile to its dropdown default (group) — so we register our
      // own beforeprint listener AFTER it, making the requested profile win.
      // Then fix images: strip the OTHER profiles' photos (Chromium embeds every
      // loaded <img>, which bloats and homogenizes the PDFs) and cap the active
      // profile's via Next's optimizer (print shows them at ~38mm; the full-res
      // source would embed losslessly, ~11MB). The small logo is left untouched.
      await page.evaluate((profileId) => {
        window.addEventListener('beforeprint', () => {
          document.body.dataset.printProfile = profileId;
          document.body.classList.add('printing-company-profile');
        });
        document.body.dataset.printProfile = profileId;
        document.body.classList.add('printing-company-profile');
        for (const doc of document.querySelectorAll('.print-profile-document')) {
          const active = doc.getAttribute('data-profile') === profileId;
          for (const img of doc.querySelectorAll('img')) {
            if (!active) {
              img.removeAttribute('src');
              img.removeAttribute('srcset');
              continue;
            }
            const src = img.getAttribute('src') || '';
            if (src.startsWith('/images/')) {
              img.setAttribute('src', `/_next/image?url=${encodeURIComponent(src)}&w=828&q=75`);
            }
          }
        }
      }, id);

      // Let the now-visible article's images finish loading before printing.
      await page.waitForLoadState('networkidle');
      await page.evaluate(async (profileId) => {
        const root = document.querySelector(`.print-profile-document[data-profile="${profileId}"]`);
        if (!root) return;
        const imgs = Array.from(root.querySelectorAll('img'));
        await Promise.all(
          imgs.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => {}))),
        );
      }, id);

      const file = path.join(OUT_DIR, `itemba-${id}-profile.pdf`);
      await page.pdf({
        path: file,
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', bottom: '16mm', left: '14mm', right: '14mm' },
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate,
      });
      console.log(`✓ ${path.relative(process.cwd(), file)}`);
    }
  } finally {
    if (browser) await browser.close();
    stopServer(server);
  }
}

main().then(
  () => {
    console.log('Done. Commit the regenerated files under public/downloads/.');
    process.exit(0);
  },
  (error) => {
    console.error('PDF generation failed:', error);
    process.exit(1);
  },
);
