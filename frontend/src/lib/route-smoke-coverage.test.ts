import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const appDir = path.join(process.cwd(), 'src', 'app');
const fixtureFile = path.join(process.cwd(), 'scripts', 'route-smoke-fixtures.json');
const navigationSourceFiles = [
  path.join(process.cwd(), 'src', 'components', 'layout', 'sidebar.tsx'),
  path.join(process.cwd(), 'src', 'components', 'aurora', 'command', 'CommandPalette.tsx'),
];
const minPageRoutes = 190;

function walkPageFiles(dir: string, files: string[] = []) {
  for (const entry of readdirSync(dir)) {
    const absolute = path.join(dir, entry);
    if (statSync(absolute).isDirectory()) {
      walkPageFiles(absolute, files);
    } else if (entry === 'page.tsx') {
      files.push(absolute);
    }
  }
  return files;
}

function routeFromPageFile(file: string) {
  const relativeDir = path.relative(appDir, path.dirname(file));
  const segments = relativeDir
    .split(path.sep)
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')));

  return `/${segments.join('/')}`.replace(/\/$/, '') || '/';
}

function loadDynamicFixtures(): Map<string, string> {
  return new Map(Object.entries(JSON.parse(readFileSync(fixtureFile, 'utf8'))));
}

function hrefsFromSource(file: string) {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/href:\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .filter((href) => href.startsWith('/'))
    .map((href) => href.split(/[?#]/)[0])
    .filter(Boolean);
}

function routePatternToRegex(route: string) {
  const escaped = route
    .split('/')
    .map((segment) => {
      if (segment.startsWith('[...') && segment.endsWith(']')) return '.+';
      if (segment.startsWith('[') && segment.endsWith(']')) return '[^/]+';
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return new RegExp(`^${escaped}$`);
}

function hrefMatchesPageRoute(href: string, pageRoutes: string[]) {
  return pageRoutes.some((route) => {
    if (route === href) return true;
    if (!route.includes('[')) return false;
    return routePatternToRegex(route).test(href);
  });
}

describe('route smoke coverage manifest', () => {
  const pageRoutes = [...new Set(walkPageFiles(appDir).map(routeFromPageFile))].sort();
  const dynamicRoutes = pageRoutes.filter((route) => route.includes('['));
  const staticRoutes = pageRoutes.filter((route) => !route.includes('['));
  const dynamicFixtures = loadDynamicFixtures();

  it('keeps dashboard page coverage above the production smoke floor', () => {
    expect(existsSync(fixtureFile)).toBe(true);
    expect(pageRoutes.length).toBeGreaterThanOrEqual(minPageRoutes);
    expect(staticRoutes.length).toBeGreaterThan(170);
    expect(dynamicRoutes.length).toBeGreaterThan(15);
  });

  it('keeps dynamic route fixtures synchronized with app routes', () => {
    const missingFixtures = dynamicRoutes.filter((route) => !dynamicFixtures.has(route));
    const unusedFixtures = [...dynamicFixtures.keys()].filter(
      (route) => !dynamicRoutes.includes(route),
    );

    expect(missingFixtures).toEqual([]);
    expect(unusedFixtures).toEqual([]);
  });

  it('uses concrete absolute sample paths for every dynamic fixture', () => {
    for (const [pattern, sample] of dynamicFixtures.entries()) {
      expect(pattern).toContain('[');
      expect(sample.startsWith('/')).toBe(true);
      expect(sample).not.toContain('[');
      expect(sample).not.toContain(']');
    }
  });

  it('keeps navigation and global-search route commands backed by app pages', () => {
    const hrefs = [...new Set(navigationSourceFiles.flatMap(hrefsFromSource))].sort();
    const missing = hrefs.filter((href) => !hrefMatchesPageRoute(href, pageRoutes));

    expect(missing).toEqual([]);
  });

  it('keeps every static app page discoverable through navigation or global search', () => {
    const hrefs = new Set(navigationSourceFiles.flatMap(hrefsFromSource));
    const undiscoverableRoutes = staticRoutes.filter((route) => !hrefs.has(route));

    expect(undiscoverableRoutes).toEqual([]);
  });
});
