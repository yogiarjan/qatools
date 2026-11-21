/**
 * Independent verification of generated code (lead-owned).
 *
 * Asserts the codegen output is not just plausible-looking text: the generated
 * TypeScript must PARSE, the Python must COMPILE, the Postman JSON must be a valid
 * v2.1 collection, and the ZIP must extract.
 *
 * Usage: node _verify/codegen-output.mjs   (API must be running on :5174, seeded)
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const API = process.env.QATOOLS_API ?? 'http://127.0.0.1:5174';
const tsc = join(root, 'node_modules/typescript/bin/tsc');

let pass = 0;
let fail = 0;
const failures = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    pass++;
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    fail++;
    failures.push({ name, error: err.message });
    console.log(`FAIL  ${name} — ${err.message}`);
  }
}

const j = async (path, init) => {
  const res = await fetch(`${API}${path}`, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
};

const projects = await j('/api/projects');
const projectId = projects.data?.[0]?.id;
if (!projectId) {
  console.log('CODEGEN_OUTPUT=SKIP (no project; seed first)');
  process.exit(0);
}

const workspace = mkdtempSync(join(tmpdir(), 'qatools-codegen-'));

async function generate(framework) {
  const body = JSON.stringify({
    framework,
    parallel: true,
    workers: 4,
    base_url: 'https://sehatku.example.id',
    persist: true,
  });
  const res = await j(`/api/projects/${projectId}/codegen`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  return res.data;
}

/** Writes a generated project to disk so real toolchains can inspect it. */
function materialise(project, label) {
  const dir = join(workspace, label);
  for (const f of project.files) {
    const full = join(dir, f.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, f.content, 'utf8');
  }
  return dir;
}

/* ---------------------------------------------------- universal invariants */

const ALL = [
  'playwright',
  'robotframework',
  'pytest',
  'cypress',
  'selenium-java',
  'k6',
  'postman',
  'rest-assured',
];

const generated = {};
for (const fw of ALL) {
  generated[fw] = await generate(fw);
}

await check('all 8 frameworks generate a non-trivial project', () => {
  for (const fw of ALL) {
    const p = generated[fw];
    if (!p) throw new Error(`${fw}: no project returned`);
    if (p.files.length < 3) throw new Error(`${fw}: only ${p.files.length} files`);
    if (p.summary.total_lines < 60) throw new Error(`${fw}: only ${p.summary.total_lines} lines`);
  }
  return ALL.map((f) => `${f}:${generated[f].files.length}f`).join(' ');
});

await check('no generated file contains a placeholder or coercion artefact', () => {
  // NOTE: `undefined` and `NaN` are legitimate values in JS/TS
  // (`x === undefined`, `to.not.be.undefined`, `let parsed: unknown = undefined`).
  // Only flag genuine PLACEHOLDER / stringification artefacts, i.e. undefined/NaN that
  // leaked into a *quoted string* or was concatenated into an identifier.
  const bad =
    /\[object Object\]|<PLACEHOLDER>|\bTODO\b|undefinedundefined|NaNNaN|"(undefined|NaN)"|'(undefined|NaN)'|value="(undefined|NaN)"|:\s*"(undefined|NaN)"/;
  const offenders = [];
  for (const fw of ALL) {
    for (const f of generated[fw].files) {
      const m = f.content.match(bad);
      if (m) offenders.push(`${fw}/${f.path}:${m[0]}`);
    }
  }
  if (offenders.length) throw new Error(`${offenders.length} offenders: ${offenders.slice(0, 4).join(', ')}`);
  return 'scanned all files';
});

await check('every generated file declares a purpose', () => {
  for (const fw of ALL) {
    for (const f of generated[fw].files) {
      if (!f.purpose || f.purpose.length < 4) throw new Error(`${fw}/${f.path} has no purpose`);
    }
  }
  return 'ok';
});

await check('generated content carries the real project base URL', () => {
  const hits = [];
  for (const fw of ALL) {
    const joined = generated[fw].files.map((f) => f.content).join('\n');
    if (joined.includes('sehatku.example.id')) hits.push(fw);
  }
  if (hits.length < 5) throw new Error(`only ${hits.length} frameworks embedded the URL`);
  return `${hits.length}/8 embedded it`;
});

/* ------------------------------------------------ TypeScript must PARSE */

await check('generated Playwright TypeScript parses (tsc --noEmit, module resolution off)', () => {
  const dir = materialise(generated.playwright, 'playwright');
  const tsFiles = generated.playwright.files
    .filter((f) => f.language === 'typescript')
    .map((f) => join(dir, f.path));
  if (!tsFiles.length) throw new Error('no TypeScript files generated');

  // Write a tsconfig that disables type checking we cannot satisfy offline
  // (no @playwright/test installed) but still forces a full SYNTAX parse.
  writeFileSync(
    join(dir, 'tsconfig.verify.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          noEmit: true,
          skipLibCheck: true,
          allowJs: true,
          types: [],
        },
        include: ['**/*.ts'],
        exclude: ['node_modules'],
      },
      null,
      2,
    ),
  );
  try {
    execFileSync('node', [tsc, '--noEmit', '-p', join(dir, 'tsconfig.verify.json')], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return `${tsFiles.length} files parse`;
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    // Only TS1xxx codes are syntax errors. TS2307 (cannot find module) is expected offline.
    const syntax = out
      .split('\n')
      .filter((l) => /error TS1\d{3}/.test(l))
      .slice(0, 3);
    if (syntax.length) throw new Error(`syntax errors: ${syntax.join(' | ')}`);
    return `${tsFiles.length} files parse (only unresolved-import errors, expected offline)`;
  }
});

/* ---------------------------------------------------- Python must COMPILE */

const python = (() => {
  const candidates = [
    process.env.PYTHON,
    'C:/Users/yogia/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe',
    'python',
  ].filter(Boolean);
  return candidates.find((p) => p === 'python' || existsSync(p)) ?? null;
})();

await check('generated pytest Python compiles with py_compile', () => {
  if (!python) return 'SKIPPED (no python interpreter found)';
  const dir = materialise(generated.pytest, 'pytest');
  const pyFiles = generated.pytest.files.filter((f) => f.path.endsWith('.py')).map((f) => join(dir, f.path));
  if (!pyFiles.length) throw new Error('no .py files generated');
  try {
    execFileSync(python, ['-m', 'py_compile', ...pyFiles], { encoding: 'utf8', stdio: 'pipe' });
    return `${pyFiles.length} files compile`;
  } catch (err) {
    throw new Error(`${err.stdout ?? ''}${err.stderr ?? ''}`.slice(0, 400));
  }
});

await check('generated Robot Framework files are well-formed', () => {
  const robot = generated.robotframework.files.find((f) => f.path.endsWith('web.robot'));
  if (!robot) throw new Error('web.robot not generated');
  for (const section of ['*** Settings ***', '*** Test Cases ***']) {
    if (!robot.content.includes(section)) throw new Error(`missing ${section}`);
  }
  const lines = robot.content.split('\n');
  if (lines.length < 25) throw new Error(`only ${lines.length} lines`);
  return `${lines.length} lines, sections present`;
});

/* --------------------------------------------------- Postman must be valid */

await check('generated Postman collection is a valid v2.1 collection', () => {
  const f = generated.postman.files.find((x) => x.path.endsWith('collection.json'));
  if (!f) throw new Error('collection.json not generated');
  const col = JSON.parse(f.content);
  if (!col.info?.schema?.includes('schema.getpostman.com')) throw new Error('missing info.schema');
  // Postman nests requests inside folders, so collect recursively.
  const flatten = (list) => (list ?? []).flatMap((i) => [i, ...flatten(i.item)]);
  const all = flatten(col.item);
  const withRequest = all.filter((i) => i.request);
  if (!withRequest.length) throw new Error('no item has a request (even nested)');
  const withTest = all.filter((i) => (i.event ?? []).some((e) => e.listen === 'test'));
  if (!withTest.length) throw new Error('no pm.test assertions generated');
  const url = withRequest[0].request?.url;
  const urlText = typeof url === 'string' ? url : url?.raw;
  if (!urlText) throw new Error('first request has no url');
  return `${withRequest.length} requests (nested in ${(col.item ?? []).length} folder(s)), ${withTest.length} with pm.test`;
});

await check('generated pom.xml files are well-formed XML with real deps', () => {
  for (const fw of ['selenium-java', 'rest-assured']) {
    const f = generated[fw].files.find((x) => x.path.endsWith('pom.xml'));
    if (!f) throw new Error(`${fw}: pom.xml missing`);
    const c = f.content;
    if (!c.includes('<project') || !c.includes('</project>')) throw new Error(`${fw}: not XML`);
    if (!c.includes('<dependency>')) throw new Error(`${fw}: no dependencies`);
    const opens = (c.match(/<dependency>/g) ?? []).length;
    const closes = (c.match(/<\/dependency>/g) ?? []).length;
    if (opens !== closes) throw new Error(`${fw}: unbalanced dependency tags ${opens}/${closes}`);
  }
  return 'both POMs balanced';
});

await check('generated k6 script exports options and a default function', () => {
  const f = generated.k6.files.find((x) => x.path === 'script.js');
  if (!f) throw new Error('script.js missing');
  if (!/export\s+const\s+options/.test(f.content)) throw new Error('no exported options');
  if (!/export\s+default\s+function/.test(f.content)) throw new Error('no default function');
  if (!/thresholds/.test(f.content)) throw new Error('no thresholds');
  return 'options + default + thresholds';
});

await check('generated Cypress spec uses real cy commands', () => {
  const f = generated.cypress.files.find((x) => x.path.endsWith('.cy.js'));
  if (!f) throw new Error('no .cy.js generated');
  for (const cmd of ['describe(', 'it(']) {
    if (!f.content.includes(cmd)) throw new Error(`missing ${cmd}`);
  }
  if (!/cy\.(visit|get|contains|request)/.test(f.content)) throw new Error('no cy.* command');
  return 'real commands present';
});

/* ----------------------------------------------------------- ZIP integrity */

await check('download endpoint returns a ZIP that extracts correctly', async () => {
  const res = await fetch(`${API}/api/codegen/${generated.playwright.id}/download`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('zip')) throw new Error(`content-type ${type}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 4).toString('latin1') !== 'PK\x03\x04') throw new Error('bad local header');
  if (!buf.includes(Buffer.from('PK\x01\x02'))) throw new Error('no central directory');
  if (!buf.includes(Buffer.from('PK\x05\x06'))) throw new Error('no EOCD');
  const zipPath = join(workspace, 'gen.zip');
  writeFileSync(zipPath, buf);
  // Validate the archive with .NET's ZipFile (no extraction), which is authoritative
  // for "is this a real, readable zip with the expected entries".
  const script = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [System.IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/'/g, "''")}')
$names = $z.Entries | ForEach-Object { $_.FullName }
$count = $z.Entries.Count
$z.Dispose()
Write-Output "COUNT=$count"
$names | ForEach-Object { Write-Output "ENTRY=$_" }
`;
  const psOut = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
  });
  const countLine = psOut.split('\n').find((l) => l.startsWith('COUNT='));
  const entryCount = Number((countLine ?? 'COUNT=0').split('=')[1]);
  const names = psOut
    .split('\n')
    .filter((l) => l.startsWith('ENTRY='))
    .map((l) => l.slice('ENTRY='.length).trim());

  if (entryCount < 5) throw new Error(`zip reports only ${entryCount} entries`);
  // Sanity: entries must be real paths inside a single project folder, not all at root.
  const nested = names.filter((n) => n.includes('/')).length;
  if (nested < 5) throw new Error(`only ${nested} entries are nested (structure looks wrong)`);

  // Then extract for real, into a fresh path, and confirm on disk.
  const outDir = join(workspace, `extract-${Date.now()}`);
  mkdirSync(outDir, { recursive: true });
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${outDir}' -Force`,
    ],
    { stdio: 'pipe' },
  );
  const walk = (d) => {
    const out = [];
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else out.push(p);
    }
    return out;
  };
  const onDisk = walk(outDir).length;
  return `${buf.length} bytes, ${entryCount} zip entries, ${onDisk} extracted to disk`;
});

await check('a quote/backslash in a title cannot break generated code', async () => {
  const cases = await j(`/api/projects/${projectId}/testcases`);
  // Must pick a case that actually has a linked web flow, otherwise no web spec is emitted.
  const flows = await j(`/api/projects/${projectId}/web-flows`);
  const linkedIds = new Set((flows.data ?? []).map((f) => f.test_case_id).filter(Boolean));
  const victim =
    (cases.data ?? []).find((c) => linkedIds.has(c.id)) ?? (cases.data ?? [])[0];
  if (!victim) throw new Error('no test case available');

  const hostile = 'Login "user" & back\\slash ${injection} `tick`';
  await j(`/api/testcases/${victim.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: hostile }),
  });
  const p = await generate('playwright');
  const spec = p.files.find((f) => f.path.includes('web.spec')) ?? p.files.find((f) => f.path.includes('.spec.'));
  if (!spec) throw new Error('no spec generated');
  if (!spec.content.includes('back')) throw new Error('title did not reach the generated file');
  if (!spec.content.includes('tick')) throw new Error('backtick portion of the title was lost');

  // The real assertion: the output still PARSES despite quotes, backslashes, ${} and backticks.
  const dir = materialise(p, 'playwright-hostile');
  writeFileSync(
    join(dir, 'tsconfig.verify.json'),
    JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', noEmit: true, skipLibCheck: true, types: [] },
      include: ['**/*.ts'],
      exclude: ['node_modules'],
    }),
  );
  let syntaxErrors = [];
  try {
    execFileSync('node', [tsc, '--noEmit', '-p', join(dir, 'tsconfig.verify.json')], { stdio: 'pipe' });
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    syntaxErrors = out.split('\n').filter((l) => /error TS1\d{3}/.test(l)).slice(0, 3);
  }
  if (syntaxErrors.length) throw new Error(`hostile title broke syntax: ${syntaxErrors.join(' | ')}`);
  return `quotes/backslashes/\${}/backticks survived in ${spec.path}, output still parses`;
});

rmSync(workspace, { recursive: true, force: true });

console.log(`\n=== SUMMARY ===\nPASS=${pass} FAIL=${fail}`);
if (failures.length) {
  console.log('\n--- failures ---');
  for (const f of failures) console.log(`${f.name}: ${f.error}`);
}
console.log(fail === 0 ? 'CODEGEN_OUTPUT=PASS' : 'CODEGEN_OUTPUT=FAIL');
process.exit(fail === 0 ? 0 : 1);
