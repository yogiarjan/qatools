/**
 * Lane D — prompt builders, one per `AiTask`.
 *
 * Rules that every builder obeys:
 *  1. The model is told to answer with **STRICT JSON only** — no markdown fences,
 *     no commentary. The shared `extractJson()` still defends against violations.
 *  2. The exact JSON schema is written into the prompt, so a weak local model can
 *     follow it without guessing.
 *  3. The high-value chains (`generate_usecases`, `generate_scenarios`,
 *     `generate_testcases`) get 2–3 compact few-shot examples.
 */

import { AI_TASKS, type AiTask } from '@qatools/shared';

export interface BuiltPrompt {
  system: string;
  user: string;
  /** JSON skeleton echoed in the prompt — also handy for docs and debugging. */
  schema: string;
}

const BASE_SYSTEM = [
  'Anda adalah mesin QA senior di platform QATools.',
  'Tugas Anda menghasilkan artefak QA yang konkret, dapat dieksekusi, dan langsung dipakai tim.',
  'ATURAN MUTLAK:',
  '1. Balas HANYA dengan JSON valid. Tanpa penjelasan, tanpa komentar, tanpa markdown fence (```).',
  '2. Jangan menambahkan field di luar skema yang diminta.',
  '3. Semua teks isi ditulis dalam Bahasa Indonesia; nama field/identifier tetap dalam Bahasa Inggris.',
  '4. Gunakan istilah QA yang baku (precondition, main flow, expected result, boundary, negative).',
  '5. Nilai enum HARUS salah satu dari daftar yang diberikan (huruf kecil semua).',
].join('\n');

const JSON_ONLY = 'Balas dengan satu objek/array JSON valid saja.';

function system(extra?: string): string {
  return extra ? `${BASE_SYSTEM}\n${extra}` : BASE_SYSTEM;
}

/* ------------------------------------------------------------------ *
 * Schemas (documented in-prompt)
 * ------------------------------------------------------------------ */

export const OUTPUT_SCHEMAS: Record<string, string> = {
  crawl_site: `[{"url":"string","title":"string","headings":["string"],"forms":[{"action":"string","method":"string","fields":[{"name":"string","type":"string","required":true}]}],"links":[{"text":"string","href":"string"}],"buttons":["string"],"inputs":[{"name":"string","type":"string"}],"tables":[{"headers":["string"],"rowCount":0}],"textSample":"string"}]`,
  generate_usecases: `[{"name":"string","goal":"string","actors":["string"],"preconditions":["string"],"postconditions":["string"],"main_flow":["string"],"alternate_flows":[{"name":"string","steps":["string"]}],"business_rules":["string"],"priority":"low|medium|high|critical","risk":"low|medium|high"}]`,
  generate_scenarios: `[{"title":"string","kind":"happy_path|alternative|negative|edge|security|performance","given_text":"string","when_text":"string","then_text":"string","priority":"low|medium|high|critical"}]`,
  generate_testcases: `[{"title":"string","objective":"string","preconditions":"string","type":"functional|negative|boundary|security|performance|usability|compatibility|regression","layer":"web|api|db|mobile|unit","priority":"low|medium|high|critical","severity":"cosmetic|minor|major|critical|blocker","estimated_minutes":10,"tags":["string"],"test_data":[{"field":"string","value":"string"}],"expected_result":"string","steps":[{"action":"string","expected":"string","data":"string"}]}]`,
  generate_test_data: `{"columns":["string"],"rows":[{"kolom":"nilai"}],"notes":"string"}`,
  generate_api_tests: `[{"name":"string","method":"GET|POST|PUT|PATCH|DELETE","path":"/contoh","headers":{"Header":"value"},"query":{"param":"value"},"body":null,"body_type":"json|form|raw|none","assertions":[{"source":"status|body|header|duration|jsonpath|row_count|column|text|element","path":"$.data.id","operator":"equals|not_equals|contains|not_contains|gt|gte|lt|lte|exists|not_exists|matches|in|length_gte|length_lte","expected":"value","message":"string"}]}]`,
  generate_db_checks: `[{"name":"string","sql":"SELECT ...","assertions":[{"source":"row_count|column","path":"kolom","operator":"equals|gte|gt|lte|lt|in","expected":0,"message":"string"}],"rationale":"string"}]`,
  generate_web_flow: `{"name":"string","start_url":"https://...","steps":[{"action":"goto|click|fill|select|check|uncheck|press|wait|assert_text|assert_visible|assert_url|screenshot|hover|scroll","selector":"CSS selector","value":"string","expected":"string","timeout_ms":500,"description":"string"}]}`,
  generate_sql: `{"sql":"SELECT ...","explanation":"string","tables_used":["string"],"dialect":"sqlite","cautions":["string"]}`,
  review_coverage: `{"findings":[{"requirement_id":"REQ-001","severity":"cosmetic|minor|major|critical|blocker","issue":"string","recommendation":"string"}],"suggested_test_cases":[<TestCaseDraft>],"overall_assessment":"string"}`,
  triage_defect: `{"severity":"cosmetic|minor|major|critical|blocker","priority":"low|medium|high|critical","component":"string","likely_root_cause":"string","reproduction_hint":"string","suggested_owner_role":"string","duplicate_risk":"low|medium|high","rationale":"string"}`,
  summarize_test_plan: `{"title":"string","summary":"string","scope":["string"],"out_of_scope":["string"],"approach":[{"phase":"string","activities":["string"],"exit_criteria":"string"}],"environments":[{"name":"string","purpose":"string"}],"test_data":["string"],"risks":[{"risk":"string","likelihood":"low|medium|high","impact":"low|medium|high","mitigation":"string"}],"schedule":[{"day":"string","focus":"string","owner":"string"}],"entry_criteria":["string"],"exit_criteria":["string"],"metrics":["string"]}`,
  predict_risk: `{"items":[{"test_case_id":"tc_x","code":"TC-001","title":"string","score":0,"level":"low|medium|high","factors":["string"],"should_be_in_regression":true,"recommended_order":1}]}`,
  chat: `{"reply":"string","suggestions":["string"]}`,
};

/* ------------------------------------------------------------------ *
 * Few-shot examples (highest-value chains only — keeps prompts compact)
 * ------------------------------------------------------------------ */

const FEWSHOT: Partial<Record<AiTask, string>> = {
  generate_usecases: `CONTOH 1
Input: "Pengguna dapat mengunggah dokumen pendukung maksimal 5 MB"
Output: [{"name":"Mengunggah Dokumen Pendukung","goal":"Memungkinkan Pengguna untuk mengunggah dokumen pendukung sebagai syarat pemenuhan berkas.","actors":["Pengguna"],"preconditions":["Pengguna sudah terautentikasi","Jenis dokumen yang diterima sudah didefinisikan"],"postconditions":["Dokumen tersimpan dan dapat diunduh kembali oleh pengguna berhak"],"main_flow":["Pengguna membuka halaman unggah dokumen.","Sistem menampilkan form unggah beserta batas ukuran dan format.","Pengguna memilih berkas dari perangkatnya.","Sistem memvalidasi ukuran (maks 5 MB) dan format berkas.","Sistem menyimpan berkas dan menautkannya ke data pengguna.","Sistem menampilkan konfirmasi unggah berhasil."],"alternate_flows":[{"name":"Ukuran berkas melebihi batas","steps":["Sistem menolak berkas.","Sistem menampilkan pesan bahwa ukuran maksimal 5 MB.","Pengguna memilih berkas lain."]}],"business_rules":["Ukuran berkas maksimal 5 MB.","Format yang diterima hanya PDF, JPG, dan PNG."],"priority":"medium","risk":"low"}]

CONTOH 2
Input: "Admin dapat menonaktifkan akun pengguna"
Output: [{"name":"Menonaktifkan Akun Pengguna","goal":"Memungkinkan Admin menonaktifkan akun yang melanggar kebijakan tanpa menghapus riwayatnya.","actors":["Admin"],"preconditions":["Admin sudah login dengan peran admin","Akun target berstatus aktif"],"postconditions":["Akun target berstatus nonaktif dan tidak dapat login"],"main_flow":["Admin membuka daftar pengguna.","Admin mencari pengguna yang dituju.","Admin memilih aksi Nonaktifkan.","Sistem meminta konfirmasi beserta alasan.","Admin mengonfirmasi.","Sistem menonaktifkan akun dan mencatat aktivitas."],"alternate_flows":[{"name":"Admin mencoba menonaktifkan akunnya sendiri","steps":["Sistem menolak aksi.","Sistem menampilkan pesan bahwa akun sendiri tidak dapat dinonaktifkan."]}],"business_rules":["Admin tidak dapat menonaktifkan akunnya sendiri.","Setiap penonaktifan wajib memiliki alasan."],"priority":"high","risk":"high"}]`,

  generate_scenarios: `CONTOH 1
Input use case: "Login Pengguna — pengguna masuk dengan email & kata sandi"
Output: [{"title":"Login Pengguna — jalur utama berhasil","kind":"happy_path","given_text":"Diberikan Pengguna terdaftar dengan email dan kata sandi yang valid","when_text":"Pengguna membuka halaman login, mengisi email dan kata sandi, lalu menekan tombol Masuk","then_text":"Sistem mengarahkan pengguna ke dashboard dan membuat sesi login","priority":"high"},{"title":"Login Pengguna — kata sandi salah ditolak","kind":"negative","given_text":"Diberikan Pengguna berada pada halaman login","when_text":"Pengguna mengisi email benar dengan kata sandi salah lalu menekan Masuk","then_text":"Sistem menolak login, menampilkan pesan generik, dan tidak membuat sesi","priority":"high"}]

CONTOH 2
Input use case: "Checkout Pesanan — pelanggan membayar pesanan"
Output: [{"title":"Checkout Pesanan — nilai batas jumlah item","kind":"edge","given_text":"Diberikan Pelanggan memiliki keranjang dengan jumlah item tepat pada batas sistem","when_text":"Pelanggan melakukan checkout dengan jumlah item minimum, maksimum, dan satu di atas maksimum","then_text":"Sistem memproses jumlah yang diizinkan dan menolak jumlah di luar batas dengan pesan jelas","priority":"high"}]`,

  generate_testcases: `CONTOH 1
Input scenario: {"title":"Login — jalur utama berhasil","kind":"happy_path","given_text":"Pengguna terdaftar dengan kredensial valid","when_text":"mengisi email & kata sandi lalu menekan Masuk","then_text":"diarahkan ke dashboard dan sesi dibuat"}
Output: [{"title":"Login berhasil dengan kredensial valid","objective":"Memverifikasi pengguna dengan email dan kata sandi valid dapat masuk dan memperoleh sesi.","preconditions":"Akun uji aktif dan environment dapat diakses.","type":"functional","layer":"web","priority":"high","severity":"major","estimated_minutes":8,"tags":["functional","web","login"],"test_data":[{"field":"Email","value":"qa.tester@example.com"},{"field":"Kata Sandi","value":"Rahasia#2026"}],"expected_result":"Pengguna diarahkan ke dashboard dan token sesi tersimpan.","steps":[{"action":"Buka halaman /login","expected":"Form login tampil tanpa error"},{"action":"Isi field Email dengan data uji","expected":"Nilai diterima sistem","data":"qa.tester@example.com"},{"action":"Isi field Kata Sandi dengan data uji","expected":"Nilai tersamarkan pada UI","data":"Rahasia#2026"},{"action":"Klik tombol Masuk","expected":"Permintaan diproses tanpa error 4xx/5xx"},{"action":"Verifikasi halaman dashboard dan token sesi","expected":"Dashboard tampil dan token sesi tersimpan"}]}]

CONTOH 2 (negatif)
Input scenario: {"title":"Login — kata sandi salah ditolak","kind":"negative","given_text":"Pengguna berada pada halaman login","when_text":"mengisi kata sandi salah lalu menekan Masuk","then_text":"Sistem menolak login dengan pesan generik"}
Output: [{"title":"Login gagal saat kata sandi salah","objective":"Memverifikasi sistem menolak kredensial tidak valid tanpa membocorkan informasi akun.","preconditions":"Akun uji aktif dan environment dapat diakses.","type":"negative","layer":"web","priority":"high","severity":"major","estimated_minutes":7,"tags":["negative","web","login"],"test_data":[{"field":"Email","value":"qa.tester@example.com"},{"field":"Kata Sandi","value":"salah"}],"expected_result":"Login ditolak dengan pesan generik dan tidak ada sesi yang dibuat.","steps":[{"action":"Buka halaman /login","expected":"Form login tampil"},{"action":"Isi Email yang valid","expected":"Nilai diterima","data":"qa.tester@example.com"},{"action":"Isi Kata Sandi dengan nilai salah","expected":"Nilai tersamarkan","data":"salah"},{"action":"Klik Masuk","expected":"Permintaan ditolak dengan pesan generik; sesi tidak dibuat"},{"action":"Verifikasi tidak ada token sesi pada storage","expected":"Tidak ada sesi aktif"}]}]`,
};

/** Compact JSON for prompt embedding (stable order, no pretty-print noise). */
function j(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
}

/* ------------------------------------------------------------------ *
 * Builders
 * ------------------------------------------------------------------ */

function build(task: AiTask, input: Record<string, unknown>): BuiltPrompt {
  const schema = OUTPUT_SCHEMAS[task] ?? '{}';
  const fewshot = FEWSHOT[task];
  const user = [
    `TASK: ${task}`,
    `SKEMA OUTPUT (ikuti persis): ${schema}`,
    `INPUT: ${j(input)}`,
    fewshot ? `CONTOH:\n${fewshot}` : '',
    JSON_ONLY,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { system: system(`Skema untuk task "${task}": ${schema}`), user, schema };
}

const CACHE = new Map<string, BuiltPrompt>();

/**
 * Returns the prompt for a task. Unknown task keys still get a valid, safe prompt
 * (never throws) so a lane typo cannot break a request.
 */
export function buildPrompt(task: AiTask | string, input: Record<string, unknown> = {}): BuiltPrompt {
  const key = `${task}:${j(input).length}`;
  const cached = CACHE.get(key);
  if (cached) return cached;
  const built = build(task as AiTask, input);
  if (CACHE.size > 200) CACHE.clear();
  CACHE.set(key, built);
  return built;
}

/** Catalogue used by docs/tests and the AI Studio "task" picker. */
export function promptCatalogue(): Array<{ task: string; schema: string }> {
  return AI_TASKS.map((t) => ({ task: t, schema: OUTPUT_SCHEMAS[t] ?? '{}' }));
}

/** Human-readable task labels (Indonesian) for the UI picker. */
export const TASK_LABEL: Record<string, string> = {
  crawl_site: 'Analisis situs web (crawl)',
  generate_usecases: 'Kebutuhan → Use Case',
  generate_scenarios: 'Use Case → Skenario',
  generate_testcases: 'Skenario → Test Case',
  generate_test_data: 'Data uji',
  generate_api_tests: 'API test + assertion',
  generate_db_checks: 'Pemeriksaan database (SQL)',
  generate_web_flow: 'Alur otomasi web',
  generate_sql: 'Bahasa alami → SQL',
  review_coverage: 'Tinjau coverage matrix',
  triage_defect: 'Triase defect',
  summarize_test_plan: 'Ringkas rencana uji',
  predict_risk: 'Prediksi risiko regresi',
  chat: 'Tanya jawab bebas',
};

/** Which input keys the AI Studio form should render for each task. */
export const TASK_FIELDS: Record<string, Array<{ key: string; label: string; kind: 'text' | 'textarea' | 'number' | 'json'; hint?: string }>> = {
  crawl_site: [
    { key: 'url', label: 'URL', kind: 'text', hint: 'Halaman yang dianalisis' },
    { key: 'html', label: 'HTML (opsional)', kind: 'textarea', hint: 'Isi bila server tidak dapat mengakses URL' },
  ],
  generate_usecases: [
    { key: 'feature_description', label: 'Deskripsi fitur / kebutuhan', kind: 'textarea' },
    { key: 'count', label: 'Jumlah use case', kind: 'number' },
  ],
  generate_scenarios: [
    { key: 'use_case', label: 'Use case (JSON UseCaseDraft)', kind: 'json' },
    { key: 'per_use_case', label: 'Skenario per use case', kind: 'number' },
  ],
  generate_testcases: [
    { key: 'scenario', label: 'Skenario (JSON ScenarioDraft)', kind: 'json' },
    { key: 'per_scenario', label: 'Test case per skenario', kind: 'number' },
  ],
  generate_test_data: [
    { key: 'fields', label: 'Daftar field (JSON array)', kind: 'json' },
    { key: 'rows', label: 'Jumlah baris', kind: 'number' },
  ],
  generate_api_tests: [
    { key: 'openapi', label: 'OpenAPI/Swagger (JSON)', kind: 'textarea' },
    { key: 'endpoints', label: 'Deskripsi endpoint', kind: 'textarea' },
    { key: 'base_url', label: 'Base URL', kind: 'text' },
  ],
  generate_db_checks: [
    { key: 'requirement_text', label: 'Kebutuhan / data requirement', kind: 'textarea' },
    { key: 'schema_sql', label: 'Skema SQL (opsional)', kind: 'textarea' },
  ],
  generate_web_flow: [
    { key: 'scenario_text', label: 'Teks skenario', kind: 'textarea' },
    { key: 'url', label: 'URL awal', kind: 'text' },
  ],
  generate_sql: [
    { key: 'requirement_text', label: 'Pertanyaan / kebutuhan data', kind: 'textarea' },
    { key: 'schema_sql', label: 'Skema SQL (opsional)', kind: 'textarea' },
  ],
  review_coverage: [
    { key: 'gaps', label: 'Daftar gap (JSON array)', kind: 'json' },
    { key: 'matrix_summary', label: 'Ringkasan matrix (JSON)', kind: 'json' },
  ],
  triage_defect: [
    { key: 'title', label: 'Judul defect', kind: 'text' },
    { key: 'description', label: 'Deskripsi', kind: 'textarea' },
    { key: 'actual_result', label: 'Hasil aktual', kind: 'textarea' },
    { key: 'expected_result', label: 'Hasil diharapkan', kind: 'textarea' },
  ],
  summarize_test_plan: [
    { key: 'project_name', label: 'Nama proyek', kind: 'text' },
    { key: 'test_cases', label: 'Daftar test case (JSON array)', kind: 'json' },
  ],
  predict_risk: [{ key: 'test_cases', label: 'Daftar test case (JSON array)', kind: 'json' }],
  chat: [{ key: 'message', label: 'Pertanyaan', kind: 'textarea' }],
};
