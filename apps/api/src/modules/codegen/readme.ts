/**
 * Generated-project README builder.
 *
 * Every generated project gets a README whose install/run commands come straight from
 * the FROZEN `FRAMEWORK_META` (`installCommand` / `runCommand`) — never re-typed here.
 * The README also carries the project's `warnings[]`, because the honest statement of
 * what could NOT be converted belongs next to the instructions, not only in the UI.
 */

import type { FrameworkMeta, GeneratedFile } from '@qatools/shared';
import { commentLine, textOf } from './util.js';
import type { GenerateContext } from './types.js';

/** A short, human file-map blurb derived from each file's own `purpose`. */
function fileMap(files: GeneratedFile[]): string {
  const rows = files
    .slice()
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `| \`${f.path}\` | ${f.lines} | ${commentLine(f.purpose)} |`);
  return ['| File | Baris | Kegunaan |', '|---|---:|---|', ...rows].join('\n');
}

/** Which QATools artifacts actually fed this generation. */
function artifactTable(ctx: GenerateContext): string {
  const rows = [
    `| Test case | ${ctx.cases.length} | dari proyek \`${ctx.project.key}\` |`,
    `| Web flow | ${ctx.flows.length} | ${ctx.layers.includes('web') ? 'layer web aktif' : 'layer web tidak diminta'} |`,
    `| API request | ${ctx.requests.length} | ${ctx.layers.includes('api') ? 'layer API aktif' : 'layer API tidak diminta'} |`,
    `| DB check | ${ctx.db_checks.length} | ${ctx.layers.includes('db') ? 'layer DB aktif' : 'layer DB tidak diminta'} |`,
  ];
  return ['| Artefak | Jumlah | Catatan |', '|---|---:|---|', ...rows].join('\n');
}

/** The test-case inventory, so a reviewer can match a generated test back to QATools. */
function caseInventory(ctx: GenerateContext): string {
  if (!ctx.cases.length) return '_Tidak ada test case yang digenerate._';
  const rows = ctx.cases.map((c) => {
    const ancestry = [c.ancestry.requirement, c.ancestry.use_case, c.ancestry.scenario]
      .filter((v): v is string => Boolean(v && v.trim()))
      .join(' › ');
    return `| \`${c.test_case.code}\` | ${commentLine(c.test_case.title)} | ${c.test_case.layer} | ${c.test_case.priority} | ${
      ancestry ? commentLine(ancestry) : '—'
    } |`;
  });
  return [
    '| Kode | Judul | Layer | Prioritas | Traceability |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function warningsSection(ctx: GenerateContext): string {
  if (!ctx.warnings.length) {
    return 'Tidak ada peringatan: semua artefak yang diminta berhasil dikonversi.';
  }
  return ctx.warnings.map((w, i) => `${i + 1}. ${commentLine(w)}`).join('\n');
}

/**
 * Builds the generated project's README.
 *
 * @param ctx    the resolved generation context
 * @param meta   the frozen framework metadata (source of the commands)
 * @param files  the files that were actually emitted
 */
export function buildReadme(ctx: GenerateContext, meta: FrameworkMeta, files: GeneratedFile[]): string {
  const shardNote = ctx.parallel
    ? `\n> **Paralel aktif.** Konfigurasi digenerate untuk **${ctx.workers} worker**. Jalankan pada mesin/CI dengan sumber daya yang memadai.\n`
    : '';

  const unsupportedLayers = ['mobile', 'unit'].filter((layer) =>
    ctx.cases.some((c) => c.test_case.layer === layer),
  );

  return `# ${ctx.project.name} — automation ${meta.label}

Proyek automation ini **digenerate oleh QATools** dari artefak proyek \`${ctx.project.key}\`.

- **Framework:** ${meta.label}
- **Bahasa:** ${meta.language}
- **Base URL:** \`${ctx.base_url}\`
- **Total file:** ${files.length}
- **Layer:** ${ctx.layers.length ? ctx.layers.join(', ') : '—'}

---

## 1. Instalasi

\`\`\`bash
${meta.installCommand}
\`\`\`

> **Penting:** QATools **tidak** memasang ${meta.label} untuk Anda. Perintah di atas
> dijalankan di komputer Anda sendiri dan membutuhkan koneksi internet. QATools hanya
> menghasilkan kode — tidak ada dependensi framework ini di dalam repositori QATools.

## 2. Menjalankan test

\`\`\`bash
${meta.runCommand}
\`\`\`
${shardNote}
## 3. Apa yang digenerate

${artifactTable(ctx)}

### Daftar test case

${caseInventory(ctx)}

## 4. Peta file

${fileMap(files)}

## 5. Peringatan — hal yang tidak dapat dikonversi

${warningsSection(ctx)}

${
  unsupportedLayers.length
    ? `\n> Test case dengan layer ${unsupportedLayers.join(', ')} tidak punya padanan otomasi di framework ini; langkah manualnya dipertahankan sebagai komentar di dalam file yang relevan.\n`
    : ''
}
## 6. Langkah berikutnya

1. Jalankan perintah instalasi di atas.
2. Isi kredensial/token yang masih kosong (lihat file konfigurasi dan variabel environment).
3. Jalankan test, lalu perbaiki selector atau endpoint yang gagal.
4. Commit proyek ini ke repositori Anda dan sambungkan ke CI.

## 7. Dokumentasi framework

- ${meta.label}: ${meta.docsUrl}
- Catatan QATools: ${commentLine(meta.notes)}

---

_Digenerate oleh QATools (\`generated_by: ${
    ctx.ai_enriched ? 'ai' : 'template'
  }\`). Mengubah file di sini tidak mengubah QATools; regenerate setelah artefak di QATools berubah._
`;
}

/** A compact one-paragraph summary used for `GeneratedProject.summary` display text. */
export function buildSummaryText(ctx: GenerateContext, fileCount: number, lineCount: number): string {
  const parts: string[] = [];
  parts.push(
    `${fileCount} file (${lineCount} baris) untuk ${ctx.framework} dari proyek ${textOf(ctx.project.name, '')}`,
  );
  parts.push(`${ctx.cases.length} test case`);
  if (ctx.flows.length) parts.push(`${ctx.flows.length} web flow`);
  if (ctx.requests.length) parts.push(`${ctx.requests.length} API request`);
  if (ctx.db_checks.length) parts.push(`${ctx.db_checks.length} DB check`);
  if (ctx.warnings.length) parts.push(`${ctx.warnings.length} peringatan`);
  return `${parts.join(' · ')}.`;
}

/** Kept alongside `buildSummaryText` so the unused-export lint cannot hide the pair. */
export const readmeBuilder = { buildReadme, buildSummaryText };
