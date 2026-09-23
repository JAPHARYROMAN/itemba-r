/* Local, static layout preview for DOM exported by isolated workspace tests.
 * No application JavaScript, authentication, API proxy or business mutations.
 * Usage: node scripts/workspace-visual-preview.cjs disciplinary-action disciplinary-approval
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { JSDOM } = require('jsdom');
const base = path.resolve(__dirname, '..');
const output = path.join(os.tmpdir(), 'itemba-payroll-visual');
const names = process.argv.slice(2);
if (!names.length || names.some((name) => !/^[a-z0-9-]+$/.test(name)))
  throw new Error('Supply exported fixture names.');
const shell = fs.readFileSync(path.join(os.tmpdir(), 'itemba-payroll-shell.html'), 'utf8');
function cssFiles(folder) {
  return fs
    .readdirSync(folder, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? cssFiles(path.join(folder, entry.name))
        : entry.name.endsWith('.css')
          ? [path.join(folder, entry.name)]
          : [],
    );
}
const css = cssFiles(path.join(base, '.next/static'))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');
const pages = new Map();
for (const name of names) {
  const dom = new JSDOM(
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ITEMBA OS · Synthetic fixture</title><link rel="stylesheet" href="/styles.css"></head><body>' +
      shell +
      '</body></html>',
  );
  const document = dom.window.document;
  const fixture = new JSDOM(fs.readFileSync(path.join(output, name + '.html'), 'utf8'));
  document.querySelector('.os-page').innerHTML =
    fixture.window.document.body.firstElementChild.innerHTML;
  document.querySelector('.os-window-caption').textContent =
    'Synthetic fixture · visual review only';
  // The reusable shell was captured in People; match the reviewed fixture's section.
  if (name.startsWith('approval-') || name.startsWith('partner-') || name.startsWith('units-') || name.startsWith('catalogue-') || name.startsWith('product-') || name.startsWith('inventory-')) {
    for (const row of document.querySelectorAll('.os-nav-row')) {
      const link = row.querySelector('a');
      const active = link?.getAttribute('href') === (name.startsWith('approval-') ? '/approvals/pending' : '/operations');
      row.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link?.removeAttribute('aria-current');
    }
  }
  document.querySelectorAll('script').forEach((node) => node.remove());
  pages.set('/' + name + '.html', dom.serialize());
}
const server = http.createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405);
    return res.end();
  }
  const url = new URL(req.url, 'http://127.0.0.1:3018');
  if (url.pathname === '/styles.css') {
    res.setHeader('Content-Type', 'text/css');
    return res.end(css);
  }
  if (pages.has(url.pathname)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const html = pages.get(url.pathname);
    return res.end(url.searchParams.get('theme') === 'dark' ? html.replace('<html>', '<html class="dark">') : html);
  }
  let relative, root;
  if (url.pathname === '/_next/image') {
    root = path.join(base, 'public');
    relative = (url.searchParams.get('url') || '').replace(/^\/+/, '');
  } else if (url.pathname.startsWith('/brand/')) {
    root = path.join(base, 'public');
    relative = url.pathname.slice(1);
  } else if (url.pathname.startsWith('/_next/static/')) {
    root = path.join(base, '.next/static');
    relative = url.pathname.slice('/_next/static/'.length);
  } else {
    res.writeHead(404);
    return res.end();
  }
  const file = path.resolve(root, relative);
  if (
    !file.startsWith(path.resolve(root) + path.sep) ||
    !['.png', '.svg', '.webp', '.jpg', '.woff2'].includes(path.extname(file))
  ) {
    res.writeHead(404);
    return res.end();
  }
  try {
    res.setHeader(
      'Content-Type',
      {
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.jpg': 'image/jpeg',
        '.woff2': 'font/woff2',
      }[path.extname(file)],
    );
    res.end(fs.readFileSync(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
server.listen(3018, '127.0.0.1', () =>
  console.log('Static synthetic fixture preview on http://127.0.0.1:3018'),
);
process.on('SIGINT', () => server.close(() => process.exit(0)));
