/**
 * Extract the complete HTTP route surface from every registered module.
 * Handles multi-line `app.get<{...}>(\n  '/path',` declarations.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const modsDir = resolve(root, 'apps/api/src/modules');

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e === 'index.ts') files.push(p);
  }
})(modsDir);

const out = [];
for (const f of files.sort()) {
  const src = readFileSync(f, 'utf8');
  const mod = f.slice(modsDir.length + 1).replace(/\\/g, '/').replace('/index.ts', '');
  // Match app.<verb> ... ( 'path'  allowing generics and whitespace/newlines
  const re = /app\.(get|post|put|patch|delete|head|options)\s*(?:<[\s\S]*?>)?\s*\(\s*[`'"](\/[^`'"]*)[`'"]/g;
  let m;
  const routes = [];
  while ((m = re.exec(src)) !== null) routes.push(`${m[1].toUpperCase().padEnd(6)} ${m[2]}`);
  out.push({ module: mod, file: f.slice(root.length + 1).replace(/\\/g, '/'), count: routes.length, routes });
}

console.log('=== ROUTE SURFACE ===');
let total = 0;
for (const m of out) {
  total += m.count;
  console.log(`\n--- ${m.module} (${m.count}) [${m.file}]`);
  for (const rt of m.routes) console.log(`    ${rt}`);
}
console.log(`\nTOTAL ROUTES: ${total}`);
