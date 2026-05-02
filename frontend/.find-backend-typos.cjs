const fs = require('fs');
const path = require('path');

// Re-extract the seed codes
const seedSrc = fs.readFileSync('C:/projects/Actual Projects/itemba-r/database/seeds/seed.ts', 'utf8');
const seeded = new Set();
const re1 = /perms\(\s*['"]([a-zA-Z_\.\-]+)['"]\s*,\s*\[([^\]]*)\]/g;
let m;
while ((m = re1.exec(seedSrc))) {
  const mod = m[1];
  const actions = [...m[2].matchAll(/['"]([a-zA-Z_\.\-]+)['"]/g)].map((x) => x[1]);
  for (const a of actions) seeded.add(mod + '.' + a);
}
const re2 = /code:\s*['"]([a-zA-Z_\-]+(?:\.[a-zA-Z_\-]+)+)['"]/g;
while ((m = re2.exec(seedSrc))) seeded.add(m[1]);

const root = 'C:/projects/Actual Projects/itemba-r/backend/src';
function walk(dir, files) {
  files = files || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(p, files);
    } else if (/\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) {
      files.push(p);
    }
  }
  return files;
}

const re = /@RequirePermissions\(\s*['"]([a-zA-Z_\-]+(?:\.[a-zA-Z_\-]+)+)['"]/g;
const usages = [];
for (const f of walk(root)) {
  const txt = fs.readFileSync(f, 'utf8');
  const lines = txt.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const r = new RegExp(re.source, 'g');
    let mm;
    while ((mm = r.exec(lines[i]))) {
      const rel = f.split(path.sep).join('/').replace('C:/projects/Actual Projects/itemba-r/', '');
      usages.push({ file: rel, line: i + 1, code: mm[1] });
    }
  }
}

const used = new Set(usages.map((u) => u.code));
const missing = [...used].filter((c) => !seeded.has(c)).sort();

console.log('=== BACKEND USED but NOT SEEDED (' + missing.length + ') ===');
for (const c of missing) {
  console.log('  ' + c);
  for (const u of usages.filter((x) => x.code === c)) {
    console.log('    ' + u.file + ':' + u.line);
  }
}
console.log('\n=== distinct used: ' + used.size + ' | missing: ' + missing.length + ' ===');
