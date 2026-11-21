/**
 * UI smoke check (verifier-owned).
 *
 * 1. Every page imported by apps/web/src/App.tsx resolves to a file that exists.
 * 2. Every such file default-exports a component.
 * 3. Every `className="..."` token used in feature/pages code exists in
 *    apps/web/src/styles/components.css (or is a feature-prefixed custom class).
 *
 * Reads only; never writes outside _verify/.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const webSrc = resolve(root, 'apps/web/src');
const appPath = resolve(webSrc, 'App.tsx');
const app = readFileSync(appPath, 'utf8');

const failures = [];
const notes = [];

/* ---------------- 1+2. route imports resolve & default-export ---------------- */
const importRe = /^import\s+(\w+)\s+from\s+'(\.[^']+)';/gm;
const pages = [];
let m;
while ((m = importRe.exec(app)) !== null) {
  pages.push({ symbol: m[1], spec: m[2] });
}

console.log(`=== App.tsx page imports: ${pages.length} ===`);
for (const p of pages) {
  const base = resolve(dirname(appPath), p.spec);
  const candidates = [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')];
  const file = candidates.find((c) => existsSync(c));
  if (!file) {
    console.log(`  MISSING ${p.symbol}  <- ${p.spec}`);
    failures.push(`route import ${p.symbol} from '${p.spec}' has no file`);
    continue;
  }
  const src = readFileSync(file, 'utf8');
  const hasDefault = /export\s+default\s/.test(src);
  if (!hasDefault) {
    console.log(`  NO-DEFAULT-EXPORT ${p.symbol}  (${file.slice(root.length + 1)})`);
    failures.push(`${p.symbol} (${file.slice(root.length + 1)}) has no default export`);
    continue;
  }
  console.log(`  ok  ${p.symbol.padEnd(22)} ${file.slice(root.length + 1).replace(/\\/g, '/')}`);
}

/* ---------------- route elements referenced in Routes ---------------- */
const routeRe = /<Route\s+path="([^"]+)"\s+element=\{([^}]*?)\}\s*\/>/g;
const routes = [];
while ((m = routeRe.exec(app)) !== null) routes.push({ path: m[1], element: m[2] });
console.log(`\n=== <Route> declarations: ${routes.length} ===`);
// Local components defined inside App.tsx itself (e.g. `function Page(...)`) are legitimate.
const localComponents = new Set([...app.matchAll(/function\s+([A-Z]\w*)\s*\(/g)].map((x) => x[1]));
const declaredSymbols = new Set(pages.map((p) => p.symbol).concat([...localComponents]));
for (const r of routes) {
  const syms = [...r.element.matchAll(/<([A-Z]\w*)/g)].map((x) => x[1]);
  const unknown = syms.filter((s) => !declaredSymbols.has(s));
  if (unknown.length) {
    failures.push(`route ${r.path} references undeclared component(s): ${unknown.join(', ')}`);
    console.log(`  UNKNOWN COMPONENT ${r.path} -> ${unknown.join(', ')}`);
  } else {
    console.log(`  ok  ${r.path.padEnd(20)} -> ${syms.join(', ')}`);
  }
}

/* ---------------- 3. CSS class usage ---------------- */
// ARCHITECTURE.md §8: lanes add NO new global CSS but MAY ship feature-scoped stylesheets
// (e.g. features/learn/learn.css, features/automation.css). Collect every stylesheet in the app.
const globalCssPath = resolve(webSrc, 'styles/components.css');
const tokensPath = resolve(webSrc, 'styles/tokens.css');
const featureCss = [];
(function findCss(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) findCss(p);
    else if (e.endsWith('.css') && p !== globalCssPath && p !== tokensPath) featureCss.push(p);
  }
})(webSrc);

if (!existsSync(globalCssPath)) failures.push('apps/web/src/styles/components.css is MISSING');
const globalCss = (existsSync(globalCssPath) ? readFileSync(globalCssPath, 'utf8') : '') +
  (existsSync(tokensPath) ? readFileSync(tokensPath, 'utf8') : '');
const scopedCss = featureCss.map((p) => readFileSync(p, 'utf8')).join('\n');

// Collect all defined class selectors.
const defined = new Set();
for (const mm of globalCss.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(mm[1]);
const definedScoped = new Set();
for (const mm of scopedCss.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) definedScoped.add(mm[1]);

console.log(`\n=== CSS: ${defined.size} classes in components.css/tokens.css`);
console.log(`    ${definedScoped.size} classes across ${featureCss.length} feature stylesheet(s): ${featureCss.map((p) => p.slice(root.length + 1).replace(/\\/g, '/')).join(', ')} ===`);

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(e)) acc.push(p);
  }
  return acc;
}
const codeFiles = [...walk(resolve(webSrc, 'features')), ...walk(resolve(webSrc, 'pages')), ...walk(resolve(webSrc, 'components'))];

const usedClasses = new Map(); // class -> first file
for (const f of codeFiles) {
  const src = readFileSync(f, 'utf8');
  const rel = f.slice(root.length + 1).replace(/\\/g, '/');
  // (a) static className="a b c"
  for (const mm of src.matchAll(/className="([^"]*)"/g)) {
    for (const cls of mm[1].split(/\s+/)) if (cls) if (!usedClasses.has(cls)) usedClasses.set(cls, rel);
  }
  // (b) inside className={...} blocks: keep only literal words in the template/string parts,
  //     and drop anything adjacent to a `${...}` interpolation (those are computed, e.g.
  //     `badge-${tone}` -> the real class is constructed at runtime and cannot be checked statically).
  for (const mm of src.matchAll(/className=\{(`[^`]*`|'[^']*'|"[^"]*")\}/g)) {
    const raw = mm[1].slice(1, -1);
    // Remove interpolations entirely, then split on non-class characters, then keep tokens
    // that are not directly preceded by '-' (i.e. would have been a computed suffix).
    const tokens = raw
      .replace(/\$\{[^}]*\}/g, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    for (const t of tokens) {
      // A token ending in '-' was a computed prefix like `badge-` — skip it.
      if (t.endsWith('-') || t.includes('${')) continue;
      if (!/^-?[_a-zA-Z][\w-]*$/.test(t)) continue;
      if (!usedClasses.has(t)) usedClasses.set(t, rel);
    }
  }
  // (c) ternaries inside className={...} with quoted alternatives, e.g. 'btn-ok' : 'btn-danger'.
  //     Exclude comparison operands (`x === 'closed'`) — those are values, not class names.
  for (const mm of src.matchAll(/className=\{[^}]*\{[^}]*\}[^}]*\}/g)) {
    const block = mm[0];
    for (const sm of block.matchAll(/'([a-zA-Z][\w-]*)'/g)) {
      // Skip when the literal is the right-hand side of === / !== / == / != .
      const before = block.slice(Math.max(0, sm.index - 6), sm.index);
      if (/[!=]==?\s*$/.test(before)) continue;
      const c = sm[1];
      if (!usedClasses.has(c)) usedClasses.set(c, rel);
    }
  }
}

console.log(`=== distinct CSS classes referenced in UI code: ${usedClasses.size} ===`);
const unknownClasses = [];
for (const [cls, file] of usedClasses) {
  if (defined.has(cls) || definedScoped.has(cls)) continue;
  // Feature-scoped custom prefixes are allowed by ARCHITECTURE.md §8 (e.g. .uc-, .tc-).
  if (/^[a-z]{2,4}-/.test(cls)) {
    notes.push(`prefix-scoped class .${cls} (${file}) — allowed by §8 if defined in a scoped stylesheet`);
    continue;
  }
  unknownClasses.push(`.${cls} used in ${file}`);
}
if (unknownClasses.length) {
  console.log(`\n  UNKNOWN CLASSES (${unknownClasses.length}) — not in components.css/tokens.css or any feature stylesheet:`);
  for (const u of unknownClasses.slice(0, 60)) console.log(`    ${u}`);
  failures.push(`${unknownClasses.length} unknown CSS classes`);
} else {
  console.log('  every referenced class resolves to a real stylesheet rule');
}

/* ---------------- summary ---------------- */
console.log('\n=== SUMMARY ===');
console.log(`page imports: ${pages.length} | routes: ${routes.length} | css classes defined: ${defined.size} | referenced: ${usedClasses.size}`);
console.log(`prefix-scoped notes: ${notes.length}`);
if (failures.length) {
  console.log(`\nFAILURES (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log('\nUI_SMOKE=FAIL');
  process.exit(1);
}
console.log('\nUI_SMOKE=PASS');
