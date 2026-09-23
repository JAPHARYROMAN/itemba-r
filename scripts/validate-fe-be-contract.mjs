#!/usr/bin/env node
/**
 * Frontend <-> backend route contract validator.
 *
 * Statically extracts every backend call the frontend makes (raw
 * `fetch('/api/backend/...')` plus the `backend*` helpers in
 * frontend/src/lib/api-client.ts) and asserts that a NestJS controller route
 * with the same METHOD + path shape exists. This is the guard rail from the
 * simplification plan: wrong paths (`compliance/tax-*` vs `tax/*`), wrong
 * verbs (PUT vs @Patch), and calls to endpoints that were never built all
 * become CI failures instead of silent empty states.
 *
 * A call whose URL is an identifier rather than a literal — the streaming
 * client's `fetchImpl(endpoint, …)`, where `endpoint` resolves through
 * `options.endpoint ?? MSAIDIZI_STREAM_PATH` — is followed through the module
 * constants of its own file. Without that, the one endpoint carrying the whole
 * Msaidizi feature was invisible here, and a backend rename of its route would
 * have passed every gate in the repo and surfaced only as a 404 in production.
 *
 * That indirection-following is itself under test, by
 * `validate-fe-be-contract.test.mjs`, run with
 * `node --test scripts/validate-fe-be-contract.test.mjs`. It asserts against
 * this repo's own tree that `POST /msaidizi/ask/stream` is among the calls this
 * file checks and that a backend route answers it. Measured on this tree, with
 * each half of the improvement reverted on its own: the `fetch`-only callee
 * pattern takes the checked set from 1022 call sites to 1021 — the single one it
 * loses being the streaming endpoint — and the literals-only first-argument
 * branch takes it to 985. Both reverts leave the gate exiting 0 and both turn
 * two tests in that file red, which is the point: a gate whose coverage can
 * shrink while it still prints OK is not a gate, and this one shrank silently
 * before the test existed.
 *
 * CI does invoke that test: `verify:deploy` runs `node --test
 * scripts/validate-fe-be-contract.test.mjs` after this script, and the
 * Deployment — Compose Validation job runs `verify:deploy`. So a change that
 * makes this script blind to a call site fails the build rather than printing
 * OK to whoever happens to run it by hand.
 *
 * Limitations (by design): calls whose path is not a string/template literal
 * are reported as "dynamic" and skipped; request/response body shapes are not
 * validated. Path segments produced by `${...}` interpolation match any
 * single backend segment. Constant resolution is in-file only — a path imported
 * from another module is still dynamic, because following it would mean
 * resolving imports, and this script deliberately does no module graph.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

// Derived from this file's own location, not `process.cwd()`. The tree it walks
// is a property of the checkout, not of where the command was typed, and a
// cwd-relative root fails open: a wrong directory makes `walk` throw at best and
// scan nothing at worst, which reads as a pass.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendSrc = path.join(repoRoot, 'backend', 'src');
const frontendSrc = path.join(repoRoot, 'frontend', 'src');

function walk(dir, predicate, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
    const absolute = path.join(dir, entry);
    if (statSync(absolute).isDirectory()) walk(absolute, predicate, files);
    else if (predicate(absolute)) files.push(absolute);
  }
  return files;
}

// ── Backend route table ─────────────────────────────────────────────────────

const HTTP_DECORATORS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'All'];

function joinRoute(prefix, sub) {
  const joined = `/${[prefix, sub].filter(Boolean).join('/')}`
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
  return joined === '' ? '/' : joined;
}

export function collectBackendRoutes() {
  const routes = [];
  const files = walk(backendSrc, (f) => f.endsWith('.controller.ts'));
  // Nest accepts either one controller prefix or an array of aliases. Keep the
  // capture deliberately literal-only: a computed decorator argument is not a
  // route this static gate can prove and must not be guessed at.
  const controllerRe =
    /@Controller\(\s*((?:['"`][^'"`]*['"`])|(?:\[(?:\s*['"`][^'"`]*['"`]\s*,?)*\]))?\s*\)/g;
  const methodRe = new RegExp(
    `@(${HTTP_DECORATORS.join('|')})\\(\\s*(?:['"\`]([^'"\`]*)['"\`])?\\s*\\)`,
    'g',
  );
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    // Split the file into controller scopes so multi-controller files work.
    const scopes = [];
    let match;
    while ((match = controllerRe.exec(source)) !== null) {
      const argument = match[1] ?? '';
      const prefixes = argument
        ? [...argument.matchAll(/['"`]([^'"`]*)['"`]/g)].map((literal) => literal[1])
        : [''];
      scopes.push({ prefixes, start: match.index });
    }
    scopes.forEach((scope, index) => {
      const end = scopes[index + 1]?.start ?? source.length;
      const body = source.slice(scope.start, end);
      let decorator;
      while ((decorator = methodRe.exec(body)) !== null) {
        const method = decorator[1] === 'All' ? 'ALL' : decorator[1].toUpperCase();
        for (const prefix of scope.prefixes) {
          routes.push({
            method,
            route: joinRoute(prefix, decorator[2] ?? ''),
            file: path.relative(repoRoot, file),
          });
        }
      }
      methodRe.lastIndex = 0;
    });
    controllerRe.lastIndex = 0;
  }
  return routes;
}

// ── Frontend call extraction ────────────────────────────────────────────────

const HELPER_METHODS = {
  backendGet: 'GET',
  backendList: 'GET',
  backendPage: 'GET',
  backendPost: 'POST',
  backendPut: 'PUT',
  backendPatch: 'PATCH',
  backendDelete: 'DELETE',
  backendUpload: 'POST',
};

/**
 * Replace each `${...}` interpolation (brace-aware, so nested templates work)
 * with `:param`, or drop it entirely when the expression builds a query-string
 * suffix (contains a quoted `?`), then strip any literal query string.
 */
function stripInterpolations(raw) {
  let result = '';
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '$' && raw[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < raw.length && depth > 0) {
        if (raw[j] === '{') depth += 1;
        else if (raw[j] === '}') depth -= 1;
        j += 1;
      }
      const expr = raw.slice(i + 2, j - 1);
      // A real path parameter always follows a '/'. An interpolation glued to
      // the previous segment (`...notifications${qs}`) or whose expression
      // builds a '?...' suffix is a query string — drop it.
      const gluedToSegment = result.length > 0 && !result.endsWith('/') && j === raw.length;
      result += gluedToSegment || /['"`]\?/.test(expr) ? '' : ':param';
      i = j - 1;
    } else {
      result += raw[i];
    }
  }
  return result;
}

function normalizeCallPath(raw) {
  const templated = stripInterpolations(raw).split('?')[0];
  const normalized = `/${templated}`.replace(/\/+/g, '/').replace(/\/$/, '');
  return normalized === '' ? '/' : normalized;
}

/** All /api/backend path literals inside a first-argument expression. */
function backendPathLiterals(argText) {
  return [...argText.matchAll(/['"`]\/api\/backend\/([^'"`]*)['"`]/g)].map((m) => m[1]);
}

/**
 * Module constants of one file, as name -> initialiser text.
 *
 * Best effort by design: an initialiser is taken to end at the first `;` or
 * newline, which is true of the path constants this exists to follow and false
 * of nothing that would matter if it were.
 */
export function moduleConstants(source) {
  const constants = new Map();
  const declarationRe =
    /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]+)?=\s*([^;\n]+)/g;
  let match;
  while ((match = declarationRe.exec(source)) !== null) {
    constants.set(match[1], match[2]);
  }
  return constants;
}

/**
 * The backend paths an expression can produce, following identifiers through
 * the file's own constants when the expression carries no literal itself.
 *
 * `fetchImpl(endpoint, …)` -> `const endpoint = options.endpoint ?? MSAIDIZI_STREAM_PATH`
 * -> `const MSAIDIZI_STREAM_PATH = '/api/backend/msaidizi/ask/stream'`. `seen`
 * makes a `const a = b` cycle terminate rather than recurse forever.
 */
export function resolveBackendPaths(expression, constants, seen = new Set()) {
  const direct = backendPathLiterals(expression);
  if (direct.length > 0) return direct;
  const paths = [];
  for (const [name] of expression.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (seen.has(name) || !constants.has(name)) continue;
    seen.add(name);
    paths.push(...resolveBackendPaths(constants.get(name), constants, seen));
  }
  return paths;
}

function pairPathsWithMethods(paths, methods) {
  if (paths.length === 0 || methods.length === 0) return [];
  // `cond ? createPath : editPath` + `method: cond ? 'POST' : 'PATCH'` line up
  // index-wise; fall back to the cross product when the shapes differ.
  if (paths.length === methods.length) {
    return paths.map((p, i) => ({ path: p, method: methods[i] }));
  }
  return paths.flatMap((p) => methods.map((m) => ({ path: p, method: m })));
}

/**
 * Every backend call one file makes, plus the count of its call sites whose
 * path could not be resolved to a literal.
 *
 * Split out of `collectFrontendCalls` so the extraction can be exercised on a
 * source string rather than only on this repo's tree: the constant-following
 * above is the part with a shape worth testing, and a test that can only run
 * against real files can only assert what those files happen to contain today.
 */
export function callsInSource(source, relative) {
  return callsInSyntaxTree(source, relative);
}

// Parse expressions rather than treating every quoted substring as a URL.
// Concatenations, nested templates and conditional endpoints are common in forms.
function callsInSyntaxTree(source, relative) {
  const tree = ts.createSourceFile(
    relative,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const constants = new Map();
  const gather = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const declarations = constants.get(node.name.text) ?? [];
      declarations.push(node);
      constants.set(node.name.text, declarations);
    }
    ts.forEachChild(node, gather);
  };
  gather(tree);
  const unknown = '${dynamic}';
  let conditions = new Map();
  const product = (left, right) => left.flatMap((a) => right.map((b) => a + b));
  const owner = (node) => {
    for (let p = node.parent; p; p = p.parent) if (ts.isBlock(p) || ts.isSourceFile(p)) return p;
  };
  const contains = (scope, node) => scope && scope.pos <= node.pos && scope.end >= node.end;
  function paths(node, seen = new Set()) {
    if (!node) return [unknown];
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node))
      return paths(node.expression, seen);
    if (ts.isConditionalExpression(node)) {
      const condition = conditions.get(node.condition.getText(tree));
      if (condition !== undefined) return paths(condition ? node.whenTrue : node.whenFalse, seen);
      return [...paths(node.whenTrue, seen), ...paths(node.whenFalse, seen)];
    }
    if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken)
        return product(paths(node.left, seen), paths(node.right, seen));
      if (
        [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(
          node.operatorToken.kind,
        )
      )
        return [...paths(node.left, seen), ...paths(node.right, seen)];
    }
    if (ts.isTemplateExpression(node)) {
      let result = [node.head.text];
      for (const part of node.templateSpans)
        result = product(result, paths(part.expression, seen)).map((p) => p + part.literal.text);
      return result;
    }
    if (ts.isIdentifier(node)) {
      const declaration = (constants.get(node.text) ?? [])
        .filter((d) => contains(owner(d), node))
        .sort((a, b) => owner(a).end - owner(a).pos - (owner(b).end - owner(b).pos))[0];
      if (declaration && !seen.has(declaration))
        return paths(declaration.initializer, new Set([...seen, declaration]));
    }
    return [unknown];
  }
  const calls = [];
  let dynamicCount = 0;
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      const fetchCall = /^fetch[A-Za-z_$]*$/.test(callee);
      if (fetchCall || callee in HELPER_METHODS || callee === 'backendFetch') {
        conditions = new Map();
        for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent)
          if (ts.isIfStatement(parent))
            conditions.set(parent.expression.getText(tree), child === parent.thenStatement);
        const candidates = [...new Set(paths(node.arguments[0]))];
        const resolved = candidates
          .filter((p) =>
            fetchCall
              ? p.startsWith('/api/backend/')
              : p !== unknown && (p.startsWith('/') || /^[a-z][\w-]*\//.test(p)),
          )
          .map((p) => (fetchCall ? p.slice('/api/backend/'.length) : p));
        let methods = [HELPER_METHODS[callee] ?? 'GET'];
        if (fetchCall || callee === 'backendFetch') {
          const options = node.arguments[1];
          const method =
            options && ts.isObjectLiteralExpression(options)
              ? options.properties.find(
                  (p) =>
                    ts.isPropertyAssignment(p) &&
                    p.name.getText(tree).replace(/['"]/g, '') === 'method',
                )
              : null;
          methods = method
            ? paths(method.initializer).filter((v) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(v))
            : ['GET'];
        }
        if (!resolved.length && !fetchCall) dynamicCount++;
        for (const pair of pairPathsWithMethods(resolved, methods))
          calls.push({
            method: pair.method,
            route: normalizeCallPath(pair.path),
            file: relative,
            line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
          });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return {
    calls: [...new Map(calls.map((c) => [`${c.line}:${c.method}:${c.route}`, c])).values()],
    dynamicCount,
  };
}

export function collectFrontendCalls() {
  const calls = [];
  let dynamicCount = 0;
  const files = walk(
    frontendSrc,
    (f) =>
      (f.endsWith('.ts') || f.endsWith('.tsx')) &&
      !f.endsWith('.test.ts') &&
      !f.endsWith('.test.tsx') &&
      !f.endsWith('.spec.ts'),
  );
  for (const file of files) {
    const found = callsInSource(readFileSync(file, 'utf8'), path.relative(repoRoot, file));
    calls.push(...found.calls);
    dynamicCount += found.dynamicCount;
  }
  return { calls, dynamicCount };
}

// ── Matching ────────────────────────────────────────────────────────────────

function segmentsMatch(callSegs, routeSegs) {
  if (callSegs.length !== routeSegs.length) return false;
  return routeSegs.every((routeSeg, i) => {
    if (routeSeg.startsWith(':') || routeSeg === '*') return true;
    if (callSegs[i] === ':param') return true;
    if (callSegs[i].includes(':param')) {
      const pattern = callSegs[i]
        .split(':param')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]+');
      return new RegExp(`^${pattern}$`).test(routeSeg);
    }
    return routeSeg === callSegs[i];
  });
}

export function findMatches(call, routes) {
  const callSegs = call.route.split('/').filter(Boolean);
  return routes.filter((route) => segmentsMatch(callSegs, route.route.split('/').filter(Boolean)));
}

/** Calls with no backend route answering them, at the same method. */
export function brokenContracts(calls, routes) {
  const failures = [];
  for (const call of calls) {
    const shapeMatches = findMatches(call, routes);
    const methodMatch = shapeMatches.some(
      (route) => route.method === call.method || route.method === 'ALL',
    );
    if (!methodMatch) {
      const otherVerbs = [...new Set(shapeMatches.map((r) => r.method))];
      failures.push({ ...call, otherVerbs });
    }
  }
  return failures;
}

function main() {
  const backendRoutes = collectBackendRoutes();
  const { calls, dynamicCount } = collectFrontendCalls();
  const failures = brokenContracts(calls, backendRoutes);

  const uniqueKey = (f) => `${f.method} ${f.route}`;
  const grouped = new Map();
  for (const failure of failures) {
    const key = uniqueKey(failure);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(failure);
  }

  console.log(
    `contract: ${calls.length} literal frontend calls checked against ${backendRoutes.length} backend routes` +
      ` (${dynamicCount} dynamic call sites skipped)`,
  );

  if (grouped.size === 0) {
    console.log('contract: OK — every checked call has a matching backend route');
    return 0;
  }

  console.error(
    `\ncontract: ${grouped.size} broken route contracts (${failures.length} call sites):\n`,
  );
  for (const [key, sites] of [...grouped.entries()].sort()) {
    const hint = sites[0].otherVerbs.length
      ? `  <- path exists as ${sites[0].otherVerbs.join('/')}`
      : '  <- no backend route with this shape';
    console.error(`  ${key}${hint}`);
    for (const site of sites) console.error(`      ${site.file}:${site.line}`);
  }
  return 1;
}

// Importing this file — which the test does — must not run the gate or exit the
// process. Same guard as `backfill-counter-sale-delivery-notes.mjs`.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) process.exit(main());
