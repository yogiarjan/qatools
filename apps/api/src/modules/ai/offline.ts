/**
 * Lane D — the DETERMINISTIC OFFLINE GENERATOR.
 *
 * This is a headline feature of QATools, not a stub. With no API key (or when the
 * configured provider is unreachable and `fallback_to_mock` is on) every AI task is
 * answered here by a rule-based engine that reads the actual input and produces
 * genuinely useful QA artifacts. See docs/ai/ai-layer.md §3.
 *
 * Guarantees:
 *  - Pure & deterministic: no clock, no randomness, no I/O. `stableHash()` picks
 *    variant wording, so the same input always yields byte-identical output.
 *  - No network access whatsoever.
 *  - Returns EXACTLY the shared contract shape for every entry of `AI_TASKS`.
 */

import {
  AI_TASKS,
  CASE_TYPES,
  LAYER_KINDS,
  SEVERITIES,
  stableHash,
  type AiTask,
  type ApiRequestDraft,
  type Assertion,
  type CoverageReviewResult,
  type CrawlResult,
  type DbCheckDraft,
  type DefectTriageResult,
  type RiskLevel,
  type RiskPredictionResult,
  type ScenarioDraft,
  type TestCaseDraft,
  type UseCaseDraft,
  type WebFlowDraft,
  type WebStep,
} from '@qatools/shared';
import {
  actionOf,
  caseTypeOf,
  componentOf,
  complexityOf,
  deriveField,
  detectActors,
  detectRules,
  humaniseIdentifier,
  keywords,
  layerOf,
  lowerFirst,
  nameForUseCase,
  pick,
  priorityOf,
  splitSentences,
  subjectOf,
  titleise,
  truncate,
  uniq,
  type DerivedField,
} from './nlp.js';

/* ------------------------------------------------------------------ *
 * Input access helpers (inputs are free-form `Record<string, unknown>`)
 * ------------------------------------------------------------------ */

type Input = Record<string, unknown>;

function str(input: Input, key: string, fallback = ''): string {
  const v = input?.[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

function num(input: Input, key: string, fallback: number): number {
  const v = Number(input?.[key]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function arrayOf<T>(input: Input, key: string): T[] {
  const v = input?.[key];
  return Array.isArray(v) ? (v as T[]) : [];
}

function obj(input: Input, key: string): Input | null {
  const v = input?.[key];
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Input) : null;
}

/** All free text we can find, in a stable order — the raw material for the rules. */
function blob(input: Input): string {
  const parts: string[] = [];
  for (const key of [
    'feature_description',
    'requirement_text',
    'scenario_text',
    'description',
    'actual_result',
    'expected_result',
    'title',
    'text',
    'prompt',
    'endpoints',
    'openapi',
    'schema_sql',
    'use_case',
    'scenario',
  ]) {
    const v = input?.[key];
    if (typeof v === 'string' && v.trim()) parts.push(v.trim());
    else if (typeof v === 'object' && v !== null && !Array.isArray(v)) parts.push(JSON.stringify(v));
  }
  const crawl = obj(input, 'crawl');
  if (crawl) {
    for (const page of arrayOf<Record<string, unknown>>(crawl, 'pages')) {
      if (typeof page?.title === 'string' && page.title) parts.push(page.title);
    }
    for (const f of arrayOf<Record<string, unknown>>(crawl, 'features')) {
      if (typeof f?.name === 'string') parts.push(String(f.name));
    }
  }
  return parts.filter(Boolean).join('. ');
}

/* ------------------------------------------------------------------ *
 * Requirement extraction
 * ------------------------------------------------------------------ */

interface RequirementLike {
  id: string | null;
  text: string;
  title: string;
  index: number;
}

/**
 * Reads `requirement_ids` / `requirement_text` / `feature_description` and reduces
 * them to a stable list of "requirement statements" the generators can iterate on.
 */
function requirementsFrom(input: Input): RequirementLike[] {
  const raw: RequirementLike[] = [];
  const ids = arrayOf<string>(input, 'requirement_ids').filter((x) => typeof x === 'string');
  ids.forEach((id, i) =>
    raw.push({ id, text: humaniseIdentifier(id), title: humaniseIdentifier(id), index: i }),
  );

  const rows = arrayOf<Record<string, unknown>>(input, 'requirements');
  rows.forEach((r, i) => {
    const text = [r?.title, r?.description].filter((x) => typeof x === 'string' && x).join(' — ');
    if (text) {
      raw.push({
        id: typeof r?.id === 'string' ? r.id : null,
        text,
        title: typeof r?.title === 'string' && r.title ? r.title : truncate(text, 80),
        index: i,
      });
    }
  });

  const free = [str(input, 'requirement_text'), str(input, 'feature_description')].filter(Boolean).join('\n');
  if (free) {
    splitSentences(free).forEach((s, i) =>
      raw.push({ id: null, text: s, title: truncate(s, 90), index: raw.length + i }),
    );
  }

  const crawlText = crawlFeatureLines(obj(input, 'crawl'));
  crawlText.forEach((line) => raw.push({ id: null, text: line, title: truncate(line, 90), index: raw.length }));

  if (!raw.length) {
    raw.push({ id: null, text: 'Mengelola data utama aplikasi', title: 'Mengelola data utama aplikasi', index: 0 });
  }
  // De-duplicate on lower-cased text, preserving order.
  const seen = new Set<string>();
  const out: RequirementLike[] = [];
  for (const r of raw) {
    const key = r.text.toLowerCase().slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, index: out.length });
  }
  return out;
}

/** Turns a CrawlResult into requirement-ish lines so crawl → use case works offline. */
function crawlFeatureLines(crawl: Input | null): string[] {
  if (!crawl) return [];
  const lines: string[] = [];
  for (const f of arrayOf<Record<string, unknown>>(crawl, 'features')) {
    const name = typeof f?.name === 'string' ? f.name : '';
    const kind = typeof f?.kind === 'string' ? f.kind : 'action';
    const evidence = typeof f?.evidence === 'string' ? f.evidence : '';
    if (name) lines.push(`Sistem menyediakan ${kind} "${name}"${evidence ? ` (${evidence})` : ''}`);
  }
  for (const uc of arrayOf<Record<string, unknown>>(crawl, 'suggested_use_cases')) {
    const name = typeof uc?.name === 'string' ? uc.name : '';
    const goal = typeof uc?.goal === 'string' ? uc.goal : '';
    if (name) lines.push(`${name}${goal ? `: ${goal}` : ''}`);
  }
  return lines;
}

/* ------------------------------------------------------------------ *
 * Task: generate_usecases
 * ------------------------------------------------------------------ */

export function generateUseCases(input: Input = {}): UseCaseDraft[] {
  const reqs = requirementsFrom(input);
  const count = Math.max(1, Math.min(12, num(input, 'count', reqs.length)));
  const chosen = reqs.slice(0, count);
  const seedBase = stableHash(blob(input) + '|usecases');

  return chosen.map((req, i) => {
    const seed = stableHash(`${seedBase}|${i}|${req.text}`);
    const actors = detectActors(req.text).map((a) => a.actor);
    const subject = subjectOf(req.text) || req.title;
    const action = actionOf(req.text);
    const rules = detectRules(req.text);
    const complex = complexityOf(req.text, reqs.length);
    const prio = priorityOf(req.text);

    const mainFlow = [
      `${actors[0] ?? 'Pengguna'} membuka halaman/modul terkait ${subject.toLowerCase()}.`,
      `Sistem menampilkan data awal dan status akses yang sesuai peran pengguna.`,
      `${actors[0] ?? 'Pengguna'} melakukan aksi "${action}" pada ${subject.toLowerCase()}.`,
      'Sistem memvalidasi kelengkapan dan format data masukan.',
      'Sistem menyimpan perubahan dan memperbarui tampilan secara konsisten.',
      `Sistem menampilkan notifikasi sukses beserta ringkasan ${subject.toLowerCase()}.`,
    ];

    const alternateFlows = [
      {
        name: 'Data masukan tidak valid',
        steps: [
          'Sistem mendeteksi field wajib yang kosong atau format yang tidak sesuai.',
          'Sistem menampilkan pesan kesalahan yang spesifik pada field terkait.',
          'Sistem mempertahankan data lain yang sudah terisi agar pengguna tidak mengulang.',
          'Pengguna memperbaiki data dan mengirim ulang.',
        ],
      },
      {
        name: 'Akses ditolak karena peran tidak sesuai',
        steps: [
          'Sistem memeriksa peran (role) pengguna terhadap kebutuhan otorisasi.',
          'Sistem menolak permintaan dengan pesan yang tidak membocorkan detail internal.',
          'Sistem mencatat percobaan akses pada activity log.',
        ],
      },
    ];
    if (complex === 'high') {
      alternateFlows.push({
        name: 'Koneksi ke layanan pendukung gagal',
        steps: [
          'Sistem mendeteksi timeout/error dari layanan pendukung.',
          'Sistem melakukan retry terbatas dengan backoff.',
          'Bila tetap gagal, sistem menampilkan pesan yang dapat ditindaklanjuti dan menandai transaksi untuk dicoba ulang.',
        ],
      });
    }

    const businessRules = rules.length
      ? rules
      : [
          `Hanya ${actors.join(' dan ')} yang berhak menjalankan fungsi ini.`,
          'Setiap perubahan tercatat pada audit trail beserta waktu dan pelakunya.',
        ];

    const risk: RiskLevel = prio === 'critical' || complex === 'high' ? 'high' : prio === 'low' ? 'low' : 'medium';

    return {
      name: nameForUseCase(req.text) || `Use Case ${i + 1}`,
      goal: `Memungkinkan ${actors.join('/')} untuk ${lowerFirst(action)} ${lowerFirst(subject)} secara terkendali dan dapat diaudit.`,
      actors: uniq(actors).length ? uniq(actors) : ['Pengguna'],
      preconditions: [
        'Aplikasi dapat diakses dan environment dalam kondisi siap uji.',
        `${actors[0] ?? 'Pengguna'} sudah terautentikasi dengan peran yang sesuai.`,
        pick(
          [
            'Master data pendukung sudah tersedia.',
            'Data referensi (kategori/status) sudah terisi.',
            'Konfigurasi sistem untuk modul ini sudah aktif.',
          ],
          seed,
        ),
      ],
      postconditions: [
        `${subject} tersimpan dan dapat ditemukan kembali melalui daftar/pencarian.`,
        'Riwayat aktivitas pengguna tercatat pada audit trail.',
        pick(
          [
            'Notifikasi/email konfirmasi terkirim ke pelaku.',
            'Metrik dashboard terkait ikut terbarui.',
            'Status turunan (mis. approval) berubah sesuai aturan bisnis.',
          ],
          seed >> 3,
        ),
      ],
      main_flow: mainFlow,
      alternate_flows: alternateFlows,
      business_rules: businessRules,
      priority: prio,
      risk,
      ...(req.id ? { requirement_refs: [req.id] } : {}),
    };
  });
}

/* ------------------------------------------------------------------ *
 * Task: generate_scenarios
 * ------------------------------------------------------------------ */

const SCENARIO_KINDS: ScenarioDraft['kind'][] = [
  'happy_path',
  'negative',
  'edge',
  'alternative',
  'security',
  'performance',
];

export function generateScenarios(input: Input = {}): ScenarioDraft[] {
  const perUseCase = Math.max(1, Math.min(8, num(input, 'per_use_case', 4)));
  const useCases = collectUseCases(input);
  const out: ScenarioDraft[] = [];

  for (const uc of useCases) {
    const seed = stableHash(`${uc.name}|${uc.goal ?? ''}|scenarios`);
    const actor = uc.actors?.[0] ?? 'Pengguna';
    const mainFirst = uc.main_flow?.[0] ?? `${actor} membuka modul terkait`;
    const lastPost = uc.postconditions?.[0] ?? 'Data tersimpan dengan benar';
    const alt = uc.alternate_flows ?? [];
    const kinds = SCENARIO_KINDS.slice(0, perUseCase);

    kinds.forEach((kind, i) => {
      const base = { priority: uc.priority ?? 'medium' };
      switch (kind) {
        case 'happy_path':
          out.push({
            ...base,
            title: `${uc.name} — jalur utama berhasil`,
            kind,
            given_text: `Diberikan ${actor} terautentikasi dan ${uc.preconditions?.[0] ?? 'data pendukung tersedia'}`,
            when_text: `${mainFirst.replace(/\.$/, '')} lalu menjalankan seluruh langkah utama sampai selesai`,
            then_text: `${lastPost} dan sistem menampilkan konfirmasi sukses`,
          });
          break;
        case 'negative':
          out.push({
            ...base,
            title: `${uc.name} — data tidak valid ditolak`,
            kind,
            given_text: `Diberikan ${actor} berada pada form yang sama dengan jalur utama`,
            when_text: pick(
              [
                'mengosongkan seluruh field wajib lalu menekan Simpan',
                'mengisi format yang salah (mis. email tanpa @) lalu menekan Simpan',
                'mengirim nilai melebihi batas karakter yang diizinkan',
              ],
              seed + i,
            ),
            then_text: 'Sistem menolak permintaan, menampilkan pesan kesalahan spesifik, dan tidak mengubah data',
          });
          break;
        case 'edge':
          out.push({
            ...base,
            title: `${uc.name} — nilai batas (boundary)`,
            kind,
            given_text: 'Diberikan data uji tepat pada ambang batas minimal dan maksimal',
            when_text: 'mengirim nilai batas bawah, batas atas, tepat di luar batas, dan nilai kosong',
            then_text: 'Sistem menerima nilai sesuai rentang dan menolak nilai di luar rentang dengan pesan yang jelas',
          });
          break;
        case 'security':
          out.push({
            ...base,
            priority: 'high',
            title: `${uc.name} — kontrol otorisasi & input berbahaya`,
            kind,
            given_text: `${actor} dengan peran terendah dan sesi yang valid`,
            when_text:
              'mencoba mengakses fungsi ini secara langsung (URL/endpoint) serta menyisipkan payload SQL/XSS pada input',
            then_text:
              'Sistem menolak akses tanpa hak, menetralkan payload, dan mencatat percobaan pada audit log',
          });
          break;
        case 'performance':
          out.push({
            ...base,
            title: `${uc.name} — respons di bawah beban`,
            kind,
            given_text: 'Diberikan environment uji dengan dataset representatif',
            when_text: 'menjalankan fungsi ini dengan 50 pengguna paralel selama 5 menit',
            then_text: 'Waktu respons p95 < 3 detik, tanpa error 5xx, dan tanpa kebocoran koneksi',
          });
          break;
        case 'alternative':
        default: {
          const flow = alt[0];
          out.push({
            ...base,
            title: flow ? `${uc.name} — ${flow.name}` : `${uc.name} — jalur alternatif`,
            kind: 'alternative',
            given_text: `Diberikan ${actor} pada kondisi jalur alternatif terpenuhi`,
            when_text: flow?.steps?.join(' → ') ?? 'menempuh langkah alternatif yang tersedia pada UI',
            then_text: pick(
              [
                'Sistem menyelesaikan tujuan use case tanpa error yang tidak tertangani',
                'Sistem memberi jalan keluar yang jelas dan menjaga konsistensi data',
              ],
              seed + i,
            ),
          });
          break;
        }
      }
    });

    // Always include a couple of negative/edge variants when the caller asks for few.
    if (perUseCase <= 2) {
      out.push({
        priority: 'medium',
        title: `${uc.name} — sesi kedaluwarsa saat proses berjalan`,
        kind: 'negative',
        given_text: `${actor} sudah login dan berada di tengah proses`,
        when_text: 'token/sesi kedaluwarsa lalu pengguna menekan Simpan',
        then_text: 'Sistem mengarahkan ke halaman login dan mempertahankan data yang belum terkirim bila memungkinkan',
      });
    }
  }

  return out;
}

function collectUseCases(input: Input): UseCaseDraft[] {
  const single = obj(input, 'use_case');
  const list = arrayOf<Record<string, unknown>>(input, 'use_cases');
  const drafts: UseCaseDraft[] = [];
  const coerce = (raw: Record<string, unknown>): UseCaseDraft => ({
    name: typeof raw.name === 'string' && raw.name ? raw.name : humaniseIdentifier(str(raw, 'id', 'Use Case')),
    goal: typeof raw.goal === 'string' ? raw.goal : '',
    actors: Array.isArray(raw.actors) ? (raw.actors as string[]) : ['Pengguna'],
    preconditions: Array.isArray(raw.preconditions) ? (raw.preconditions as string[]) : [],
    postconditions: Array.isArray(raw.postconditions) ? (raw.postconditions as string[]) : [],
    main_flow: Array.isArray(raw.main_flow) ? (raw.main_flow as string[]) : [],
    alternate_flows: Array.isArray(raw.alternate_flows)
      ? (raw.alternate_flows as Array<{ name: string; steps: string[] }>)
      : [],
    business_rules: Array.isArray(raw.business_rules) ? (raw.business_rules as string[]) : [],
    priority: (typeof raw.priority === 'string' ? raw.priority : 'medium') as UseCaseDraft['priority'],
    risk: (typeof raw.risk === 'string' ? raw.risk : 'medium') as RiskLevel,
  });
  if (single) drafts.push(coerce(single));
  for (const raw of list) drafts.push(coerce(raw as Record<string, unknown>));
  if (!drafts.length) {
    // Fall back to synthesising use cases from whatever text exists.
    return generateUseCases({ feature_description: blob(input) });
  }
  return drafts;
}

/* ------------------------------------------------------------------ *
 * Task: generate_testcases
 * ------------------------------------------------------------------ */

function defaultTestTypes(): string[] {
  return ['functional', 'negative', 'boundary'];
}

export function generateTestCases(input: Input = {}): TestCaseDraft[] {
  const perScenario = Math.max(1, Math.min(8, num(input, 'per_scenario', 3)));
  const requested = arrayOf<string>(input, 'include_types').filter((t) => typeof t === 'string');
  const types = (requested.length ? requested : defaultTestTypes()).filter((t) =>
    (CASE_TYPES as readonly string[]).includes(t),
  );
  const scenarios = collectScenarios(input);
  const out: TestCaseDraft[] = [];

  for (const scenario of scenarios) {
    const seed = stableHash(`${scenario.title}|${scenario.when_text}|testcases`);
    const fields = inferFieldsFromText(`${scenario.given_text} ${scenario.when_text} ${scenario.then_text}`);
    const chosenTypes = types.length ? types.slice(0, perScenario) : defaultTestTypes().slice(0, perScenario);

    chosenTypes.forEach((typeRaw, i) => {
      const type = caseTypeOf(`${typeRaw} ${scenario.title} ${scenario.when_text}`, typeRaw);
      const layer = layerOf(`${scenario.title} ${scenario.when_text}`, fields.length);
      const severity = severityFor(type, scenario.priority);
      const testData = fields.map((f) => ({ field: f.label, value: sampleValue(f, type) }));
      const steps = buildSteps(scenario, type, fields);
      out.push({
        title: truncate(`${scenario.title}${chosenTypes.length > 1 ? ` [${type}]` : ''}`, 140),
        objective: `Memverifikasi bahwa "${truncate(scenario.title, 100)}" berperilaku sesuai harapan untuk jenis pengujian ${type}.`,
        preconditions: preconditionText(scenario, i),
        type,
        layer,
        priority: scenario.priority ?? 'medium',
        severity,
        estimated_minutes: estimateMinutes(type, steps.length, layer),
        tags: uniq([
          type,
          layer,
          scenario.kind ?? 'happy_path',
          ...keywords(scenario.title, 3),
        ]).slice(0, 6),
        test_data: testData.length ? testData : [{ field: 'input_utama', value: 'data-valid' }],
        expected_result: expectedFor(scenario, type),
        steps,
      });
    });
  }

  if (!out.length) {
    const fallback = generateScenarios({ use_case: generateUseCases({ feature_description: blob(input) })[0] });
    return fallback.slice(0, perScenario).flatMap((s) => generateTestCases({ scenario: s, per_scenario: 1 }));
  }
  return out;
}

function severityFor(type: string, priority?: string): TestCaseDraft['severity'] {
  if (type === 'security') return 'critical';
  if (type === 'negative' && priority === 'critical') return 'critical';
  if (type === 'performance' || type === 'regression') return 'major';
  if (priority === 'critical') return 'critical';
  if (type === 'usability') return 'minor';
  return 'major';
}

function estimateMinutes(type: string, stepCount: number, layer: string): number {
  const base = 5 + stepCount * 2;
  const typeFactor = type === 'performance' ? 3 : type === 'security' ? 2 : type === 'boundary' ? 1.5 : 1;
  const layerFactor = layer === 'api' ? 0.8 : layer === 'db' ? 0.9 : 1;
  return Math.max(3, Math.round(base * typeFactor * layerFactor));
}

function preconditionText(scenario: ScenarioDraft, variant: number): string {
  const given = (scenario.given_text ?? '').replace(/^Diberikan\s+/i, '').trim();
  const extras = [
    'Environment uji aktif dan data referensi sudah tersedia.',
    'Pengguna uji dengan peran yang sesuai sudah dibuat.',
    'Modul terkait sudah dirilis pada build yang diuji.',
  ];
  return truncate([given, pick(extras, variant)].filter(Boolean).join(' '), 260);
}

function expectedFor(scenario: ScenarioDraft, type: string): string {
  const then = (scenario.then_text ?? '').trim();
  if (type === 'negative') return truncate(`${then || 'Sistem menolak input'} — tidak ada data yang tersimpan.`, 260);
  if (type === 'security') return truncate(`${then || 'Akses ditolak'} — tidak ada kebocoran data pada respons.`, 260);
  if (type === 'performance') return 'Semua permintaan selesai dengan p95 < 3 detik dan tanpa error 5xx.';
  return truncate(then || 'Sistem menampilkan hasil yang diharapkan tanpa error.', 260);
}

function sampleValue(f: DerivedField, type: string): string {
  if (type === 'negative') return f.samples[1] || 'nilai-tidak-valid';
  if (type === 'boundary') return f.samples[2] || f.samples[0];
  return f.samples[0];
}

function buildSteps(
  scenario: ScenarioDraft,
  type: string,
  fields: DerivedField[],
): Array<{ action: string; expected: string; data?: string }> {
  const steps: Array<{ action: string; expected: string; data?: string }> = [];  steps.push({
    action: 'Buka aplikasi dan siapkan environment uji pada kondisi awal yang didefinisikan.',
    expected: 'Halaman utama tampil tanpa error pada console/network.',
  });

  const given = (scenario.given_text ?? '').replace(/^Diberikan\s+/i, '').trim();
  if (given) {
    steps.push({ action: `Siapkan prasyarat: ${truncate(given, 160)}`, expected: 'Prasyarat terpenuhi dan terverifikasi.' });
  }

  if (fields.length) {
    for (const f of fields.slice(0, 5)) {
      steps.push({
        action: `Isi field "${f.label}" dengan data uji.`,
        expected:
          type === 'negative' || type === 'boundary'
            ? 'Sistem menampilkan validasi yang sesuai untuk nilai yang diuji.'
            : 'Nilai diterima sistem tanpa pesan kesalahan.',
        data: sampleValue(f, type),
      });
    }
  } else {
    steps.push({
      action: `Lakukan aksi: ${truncate((scenario.when_text ?? '').replace(/^Ketika\s+/i, ''), 180)}`,
      expected: 'Aksi diproses sistem dengan umpan balik yang jelas.',
    });
  }

  steps.push({
    action: 'Kirim/simpan data dan tunggu proses selesai.',
    expected:
      type === 'negative'
        ? 'Permintaan ditolak dengan pesan kesalahan spesifik; data tidak berubah.'
        : 'Permintaan diproses tanpa error 4xx/5xx yang tidak diharapkan.',
  });

  if (type === 'security') {
    steps.push({
      action: 'Ulangi permintaan dengan peran tanpa hak akses serta payload SQL/XSS pada input.',
      expected: 'Akses ditolak (401/403) dan payload dinetralkan; percobaan tercatat pada log.',
    });
  }
  if (type === 'performance') {
    steps.push({
      action: 'Jalankan skenario ini dengan 50 virtual user selama 5 menit.',
      expected: 'Tidak ada error 5xx dan p95 respons < 3 detik.',
    });
  }
  if (type === 'boundary') {
    steps.push({
      action: 'Ulangi pengujian dengan nilai tepat di bawah batas, tepat pada batas, dan tepat di atas batas.',
      expected: 'Nilai di dalam rentang diterima; nilai di luar rentang ditolak dengan pesan yang jelas.',
    });
  }

  steps.push({
    action: 'Verifikasi hasil akhir pada UI dan pada data tersimpan.',
    expected: truncate(expectedFor(scenario, type), 200),
  });
  return steps;
}

function collectScenarios(input: Input): ScenarioDraft[] {
  const single = obj(input, 'scenario');
  const list = arrayOf<Record<string, unknown>>(input, 'scenarios');
  const coerce = (raw: Record<string, unknown>): ScenarioDraft => ({
    title: typeof raw.title === 'string' && raw.title ? raw.title : humaniseIdentifier(str(raw, 'id', 'Skenario')),
    kind: (typeof raw.kind === 'string' ? raw.kind : 'happy_path') as ScenarioDraft['kind'],
    given_text: typeof raw.given_text === 'string' ? raw.given_text : '',
    when_text: typeof raw.when_text === 'string' ? raw.when_text : '',
    then_text: typeof raw.then_text === 'string' ? raw.then_text : '',
    priority: (typeof raw.priority === 'string' ? raw.priority : 'medium') as ScenarioDraft['priority'],
  });
  const out: ScenarioDraft[] = [];
  if (single) out.push(coerce(single));
  for (const raw of list) out.push(coerce(raw));
  if (!out.length) {
    return generateScenarios({ use_case: generateUseCases({ feature_description: blob(input) })[0], per_use_case: 3 });
  }
  return out;
}

/** Best-effort field inference from free text (used when no crawl/form data exists). */
function inferFieldsFromText(text: string): DerivedField[] {
  const lower = (text ?? '').toLowerCase();
  const table: Array<[RegExp, string, string]> = [
    [/\bemail\b|\be-mail\b/, 'email', 'email'],
    [/\bpassword\b|\bkata sandi\b/, 'password', 'password'],
    [/\busername\b|\bnama pengguna\b/, 'username', 'text'],
    [/\bphone\b|\btelepon\b|\bno\.? hp\b/, 'phone', 'tel'],
    [/\bjumlah\b|\bqty\b|\bquantity\b/, 'quantity', 'number'],
    [/\bharga\b|\bprice\b|\bnominal\b/, 'price', 'number'],
    [/\btanggal\b|\bdate\b/, 'date', 'date'],
    [/\balamat\b|\baddress\b/, 'address', 'text'],
    [/\bnama\b|\bname\b/, 'name', 'text'],
    [/\bcari\b|\bsearch\b|\bkeyword\b/, 'keyword', 'text'],
    [/\bstatus\b/, 'status', 'select'],
    [/\bcatatan\b|\bnotes?\b|\bketerangan\b/, 'notes', 'text'],
  ];
  const found: DerivedField[] = [];
  for (const [re, name, type] of table) {
    if (re.test(lower) && !found.some((f) => f.name === name)) found.push(deriveField(name, type, true));
  }
  return found.slice(0, 6);
}

/* ------------------------------------------------------------------ *
 * Task: generate_test_data
 * ------------------------------------------------------------------ */

export function generateTestData(input: Input = {}): {
  columns: string[];
  rows: Array<Record<string, string>>;
  notes: string;
} {
  const fields = inferFieldsForTestData(input);
  const rowCount = Math.max(1, Math.min(50, num(input, 'rows', 6)));
  const columns = fields.map((f) => f.name);
  const variants = ['valid', 'invalid', 'boundary', 'empty', 'special-char', 'duplicate', 'long'];
  const rows: Array<Record<string, string>> = [];
  for (let i = 0; i < rowCount; i++) {
    const variant = variants[i % variants.length] as string;
    const row: Record<string, string> = { kandidat: variant };
    for (const f of fields) {
      row[f.name] =
        variant === 'invalid'
          ? f.samples[1]
          : variant === 'boundary'
            ? f.samples[2]
            : variant === 'empty'
              ? ''
              : variant === 'special-char'
                ? `'"><script>alert(1)</script>`
                : f.samples[0];
    }
    rows.push(row);
  }
  return {
    columns: ['kandidat', ...columns],
    rows,
    notes:
      'Data uji deterministik yang dihasilkan mode offline. Kolom "kandidat" menandai jenis variasi (valid/invalid/boundary/empty/special-char/duplicate/long).',
  };
}

function inferFieldsForTestData(input: Input): DerivedField[] {
  // Prefer explicit field names when the caller supplies them.
  const explicit = uniq([
    ...arrayOf<string>(input, 'fields').filter((f) => typeof f === 'string'),
    ...(obj(input, 'test_data') ? Object.keys(obj(input, 'test_data') as Input) : []),
  ]);
  if (explicit.length) return explicit.slice(0, 10).map((name) => deriveField(name, guessType(name), true));

  const crawl = obj(input, 'crawl');
  if (crawl) {
    const fieldNames: string[] = [];
    for (const page of arrayOf<Record<string, unknown>>(crawl, 'pages')) {
      for (const form of arrayOf<Record<string, unknown>>(page, 'forms')) {
        for (const f of arrayOf<Record<string, unknown>>(form, 'fields')) {
          const n = typeof f?.name === 'string' ? f.name : '';
          if (n) fieldNames.push(n);
        }
      }
    }
    if (fieldNames.length) return uniq(fieldNames).slice(0, 10).map((n) => deriveField(n, guessType(n), true));
  }

  const inferred = inferFieldsFromText(blob(input));
  return inferred.length ? inferred : [deriveField('email', 'email', true), deriveField('password', 'password', true)];
}

function guessType(name: string): string {
  if (/email/i.test(name)) return 'email';
  if (/password|sandi/i.test(name)) return 'password';
  if (/phone|telp|hp/i.test(name)) return 'tel';
  if (/qty|jumlah|count|stock|stok|price|harga|amount|total/i.test(name)) return 'number';
  if (/date|tanggal|tgl/i.test(name)) return 'date';
  return 'text';
}

/* ------------------------------------------------------------------ *
 * Task: generate_sql
 * ------------------------------------------------------------------ */

export interface SqlDraft {
  sql: string;
  explanation: string;
  tables_used: string[];
  dialect: string;
  cautions: string[];
}

export function generateSql(input: Input = {}): SqlDraft {
  const question = blob(input) || 'seluruh data';
  const schema = str(input, 'schema_sql');
  const tables = detectTables(schema, question);
  const table = tables[0] ?? 'nama_tabel';
  const lower = question.toLowerCase();
  const seed = stableHash(question + schema);
  const cautions: string[] = [];

  let sql: string;
  if (/\b(jumlah|count|berapa banyak|total baris|banyak data)\b/.test(lower)) {
    sql = `SELECT COUNT(*) AS total\nFROM ${table}${whereFromText(lower, table)};`;
  } else if (/\b(rata-rata|average|avg|mean)\b/.test(lower)) {
    const col = guessColumn(question, ['amount', 'total', 'price', 'harga', 'nilai', 'qty']);
    sql = `SELECT AVG(${col}) AS rata_rata\nFROM ${table}${whereFromText(lower, table)};`;
  } else if (/\b(duplikat|duplicate|ganda)\b/.test(lower)) {
    const col = guessColumn(question, ['email', 'code', 'kode', 'nik', 'username']);
    sql = `SELECT ${col}, COUNT(*) AS jumlah\nFROM ${table}\nGROUP BY ${col}\nHAVING COUNT(*) > 1\nORDER BY jumlah DESC;`;
  } else if (/\b(yatim|orphan|tanpa induk|tidak punya|tidak memiliki)\b/.test(lower)) {
    sql = `SELECT t.*\nFROM ${table} t\nLEFT JOIN ${tables[1] ?? 'tabel_induk'} p ON p.id = t.${tables[1] ? singular(tables[1]) + '_id' : 'parent_id'}\nWHERE p.id IS NULL;`;
  } else if (/\b(cari|search|keyword|nama|berisi|mengandung)\b/.test(lower)) {
    const col = guessColumn(question, ['name', 'nama', 'title', 'judul', 'email']);
    sql = `SELECT *\nFROM ${table}\nWHERE ${col} LIKE '%' || :keyword || '%'\nORDER BY ${col}\nLIMIT 100;`;
    cautions.push('Gunakan parameter (:keyword), jangan interpolasi string ke dalam SQL.');
  } else if (/\b(paling (banyak|besar|tinggi)|terbanyak|top \d*|tertinggi)\b/.test(lower)) {
    const col = guessColumn(question, ['total', 'amount', 'qty', 'score', 'nilai']);
    sql = `SELECT *\nFROM ${table}\nORDER BY ${col} DESC\nLIMIT 10;`;
  } else {
    sql = `SELECT *\nFROM ${table}${whereFromText(lower, table)}\nORDER BY ${pick(['id', 'created_at', 'kode'], seed)} DESC\nLIMIT 100;`;
  }

  if (/\b(hapus|delete|update|ubah|drop|truncate)\b/.test(lower)) {
    cautions.push('Permintaan menyebut operasi tulis. Verifikasi hanya dilakukan dengan SELECT (readonly guard).');
  }
  if (/\b(produksi|production|prod)\b/.test(lower)) {
    cautions.push('Jangan jalankan query ini pada database produksi tanpa persetujuan.');
  }
  cautions.push('Batasi hasil dengan LIMIT untuk mencegah pengambilan data berlebihan.');

  return {
    sql,
    explanation: `Query dibentuk dari pertanyaan: "${truncate(question, 160)}". Tabel utama yang dipakai adalah ${table}; filter disusun dari kata kunci pada pertanyaan. Hasil dibaca-saja (SELECT).`,
    tables_used: tables.length ? tables.slice(0, 4) : [table],
    dialect: str(input, 'dialect', 'sqlite'),
    cautions: uniq(cautions),
  };
}

function singular(name: string): string {
  return name.endsWith('s') ? name.slice(0, -1) : name;
}

function whereFromText(lower: string, table: string): string {
  const today = /\b(hari ini|today)\b/.test(lower);
  const month = /\b(bulan ini|this month)\b/.test(lower);
  const year = /\b(tahun ini|this year)\b/.test(lower);
  const active = /\b(aktif|active|belum selesai|open)\b/.test(lower);
  const clauses: string[] = [];
  if (today) clauses.push("date(created_at) = date('now')");
  if (month) clauses.push("strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')");
  if (year) clauses.push("strftime('%Y', created_at) = strftime('%Y', 'now')");
  if (active) clauses.push("status IN ('active', 'open', 'in_progress')");
  if (!clauses.length) return '';
  void table;
  return `\nWHERE ${clauses.join('\n  AND ')}`;
}

function guessColumn(question: string, candidates: string[]): string {
  const lower = question.toLowerCase();
  const found = candidates.find((c) => lower.includes(c.toLowerCase()));
  return found ?? candidates[0] ?? 'id';
}

function detectTables(schema: string, question: string): string[] {
  const fromSchema = [...(schema ?? '').matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([a-zA-Z0-9_]+)["'`]?/gi)].map(
    (m) => m[1] as string,
  );
  const fromQuestion = keywords(question, 12);
  const merged = uniq([...fromQuestion.filter((w) => fromSchema.includes(w)), ...fromSchema]);
  if (merged.length) return merged;
  const guess = fromQuestion.find((w) => /s$/.test(w));
  return guess ? [guess] : ['nama_tabel'];
}

/* ------------------------------------------------------------------ *
 * Task: generate_api_tests
 * ------------------------------------------------------------------ */

export function generateApiTests(input: Input = {}): ApiRequestDraft[] {
  const openapi = str(input, 'openapi');
  const endpoints = str(input, 'endpoints');
  const fromSpec = openapi ? parseOpenApi(openapi) : [];
  const fromText = endpoints ? parseEndpointText(endpoints) : [];
  const all = [...fromSpec, ...fromText];
  if (!all.length) {
    // Sensible default set for the bundled mock system-under-test.
    return [
      draftRequest('Login berhasil', 'POST', '/mock/login', {
        body: { username: 'admin', password: 'secret' },
        assertions: [
          assert('status', undefined, 'equals', 200, 'Login sukses mengembalikan 200'),
          assert('body', 'token', 'exists', undefined, 'Token hadir pada respons'),
        ],
      }),
      draftRequest('Login gagal (kredensial salah)', 'POST', '/mock/login', {
        body: { username: 'admin', password: 'salah' },
        assertions: [assert('status', undefined, 'equals', 401, 'Kredensial salah harus 401')],
      }),
      draftRequest('Ambil daftar produk', 'GET', '/mock/products', {
        assertions: [
          assert('status', undefined, 'equals', 200, 'Daftar produk tersedia'),
          assert('jsonpath', '$.data', 'length_gte', 1, 'Minimal satu produk'),
        ],
      }),
      draftRequest('Simulasi endpoint flaky', 'GET', '/mock/flaky', {
        assertions: [assert('status', undefined, 'in', [200, 500], 'Endpoint flaky mengembalikan 200 atau 500')],
      }),
    ];
  }
  return all.map((ep) => endpointToDraft(ep));
}

interface EndpointLike {
  method: string;
  path: string;
  summary: string;
  hasBody: boolean;
  requiredParams: string[];
}

/** Maps a discovered endpoint onto the frozen ApiRequestDraft contract. */
function endpointToDraft(ep: EndpointLike): ApiRequestDraft {
  const method = (ep.method || 'GET').toUpperCase();
  const scope = `${ep.summary} ${ep.path}`.toLowerCase();
  const wantsAuth = /login|auth|token|register/.test(scope) === false && ['PUT', 'PATCH', 'DELETE'].includes(method);
  const headers: Record<string, string> = { Accept: 'application/json' };
  const query: Record<string, string> = {};
  for (const [, param] of ep.path.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) query[param as string] = `{{${param}}}`;
  for (const p of ep.requiredParams) if (!(p in query)) query[p] = `{{${p}}}`;

  let body: string | null = null;
  if (ep.hasBody) {
    const guess = guessBodyFor(scope);
    body = JSON.stringify(guess, null, 2);
    headers['Content-Type'] = 'application/json';
  }
  if (wantsAuth) headers.Authorization = 'Bearer {{token}}';

  const asserts: Assertion[] = [
    assert(
      'status',
      undefined,
      'in',
      method === 'POST' ? [200, 201] : [200, 204],
      `${method} ${ep.path} harus mengembalikan status sukses`,
    ),
  ];
  if (/\{([a-zA-Z0-9_]+)\}/.test(ep.path)) {
    asserts.push(assert('status', undefined, 'not_equals', 404, 'Sumber daya yang diminta harus ada'));
  }
  if (ep.hasBody) {
    asserts.push(assert('duration', undefined, 'lt', 3000, 'Respons di bawah 3 detik'));
  }

  return {
    name: truncate(`${method} ${ep.path}${ep.summary ? ` — ${ep.summary}` : ''}`, 140),
    method,
    path: ep.path,
    headers,
    query,
    body,
    body_type: body === null ? 'none' : 'json',
    assertions: asserts,
  };
}

/** Deterministic sample request body derived from the endpoint name. */
function guessBodyFor(scope: string): Record<string, unknown> {
  if (/login|auth|sign ?in|token/.test(scope)) return { username: 'admin', password: 'secret' };
  if (/order|pesanan/.test(scope)) return { product_id: 'prod_001', quantity: 2 };
  if (/product|produk|item/.test(scope)) return { name: 'Produk Uji', price: 150000, stock: 10, category: 'umum' };
  if (/user|pengguna|account|akun/.test(scope)) return { name: 'Budi Santoso', email: 'budi@example.com' };
  if (/payment|pembayaran|bayar/.test(scope)) return { order_id: 'ord_0001', method: 'transfer', amount: 150000 };
  return { name: 'Contoh Data Uji', description: 'Dibuat otomatis oleh generator offline QATools.' };
}

function parseEndpointText(text: string): EndpointLike[] {
  const out: EndpointLike[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = /^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S*)\s*(.*)$/i.exec(line);
    if (m) {
      out.push({
        method: (m[1] as string).toUpperCase(),
        path: m[2] as string,
        summary: (m[3] ?? '').trim() || `${m[1]} ${m[2]}`,
        hasBody: ['POST', 'PUT', 'PATCH'].includes((m[1] as string).toUpperCase()),
        requiredParams: [...(m[2] as string).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((x) => x[1] as string),
      });
      continue;
    }
    // Free-form: "POST /orders untuk membuat pesanan"
    const loose = /(GET|POST|PUT|PATCH|DELETE)\s*[:\-]?\s*(\/[a-zA-Z0-9_\-/{}.]+)/i.exec(line);
    if (loose) {
      out.push({
        method: (loose[1] as string).toUpperCase(),
        path: loose[2] as string,
        summary: truncate(line.trim(), 90),
        hasBody: ['POST', 'PUT', 'PATCH'].includes((loose[1] as string).toUpperCase()),
        requiredParams: [...(loose[2] as string).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((x) => x[1] as string),
      });
    }
  }
  return out;
}

function parseOpenApi(spec: string): EndpointLike[] {
  try {
    const doc = JSON.parse(spec) as {
      paths?: Record<string, Record<string, { summary?: string; requestBody?: unknown; parameters?: Array<{ name?: string; required?: boolean }> }>>;
    };
    const out: EndpointLike[] = [];
    for (const [path, ops] of Object.entries(doc.paths ?? {})) {
      for (const [method, op] of Object.entries(ops ?? {})) {
        const m = method.toUpperCase();
        if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(m)) continue;
        out.push({
          method: m,
          path,
          summary: op?.summary ?? `${m} ${path}`,
          hasBody: Boolean(op?.requestBody) || ['POST', 'PUT', 'PATCH'].includes(m),
          requiredParams: (op?.parameters ?? [])
            .filter((p) => p?.required && typeof p.name === 'string')
            .map((p) => p.name as string),
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function assert(
  source: Assertion['source'],
  path: string | undefined,
  operator: Assertion['operator'],
  expected: unknown,
  message: string,
): Assertion {
  return { source, ...(path ? { path } : {}), operator, ...(expected === undefined ? {} : { expected }), message };
}

function draftRequest(
  name: string,
  method: string,
  path: string,
  opts: { body?: unknown; assertions: Assertion[] } = { assertions: [] },
): ApiRequestDraft {
  const lower = `${name} ${path}`.toLowerCase();
  const wantsAuth = /login|auth|token/.test(lower) || ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (wantsAuth && !/login|auth|token/.test(lower)) headers.Authorization = 'Bearer {{token}}';
  const query: Record<string, string> = {};
  for (const [, param] of path.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) query[param as string] = `{{${param}}}`;
  return {
    name,
    method,
    path,
    headers,
    query,
    body: opts.body === undefined ? null : JSON.stringify(opts.body, null, 2),
    body_type: opts.body === undefined ? 'none' : 'json',
    assertions: opts.assertions.length
      ? opts.assertions
      : [assert('status', undefined, 'matches', '^2\\d\\d$', 'Respons sukses 2xx')],
  };
}

/* ------------------------------------------------------------------ *
 * Task: generate_db_checks
 * ------------------------------------------------------------------ */

export function generateDbChecks(input: Input = {}): DbCheckDraft[] {
  const requirement = str(input, 'requirement_text') || blob(input) || 'konsistensi data';
  const schema = str(input, 'schema_sql');
  const tables = detectTables(schema, requirement);
  const table = tables[0] ?? 'nama_tabel';
  const seed = stableHash(requirement + schema);
  const checks: DbCheckDraft[] = [];

  checks.push({
    name: `Tidak ada data yatim pada ${table}`,
    sql: `SELECT COUNT(*) AS jumlah\nFROM ${table} t\nLEFT JOIN ${tables[1] ?? 'tabel_induk'} p\n  ON p.id = t.${tables[1] ? singular(tables[1]) + '_id' : 'parent_id'}\nWHERE p.id IS NULL;`,
    assertions: [assert('column', 'jumlah', 'equals', 0, 'Tidak boleh ada baris yatim')],
    rationale: 'Integritas referensial: relasi ke tabel induk harus selalu terpenuhi.',
  });

  checks.push({
    name: `Kolom wajib ${table} tidak kosong`,
    sql: `SELECT COUNT(*) AS jumlah\nFROM ${table}\nWHERE ${pick(['name', 'title', 'kode', 'id'], seed)} IS NULL OR TRIM(CAST(${pick(
      ['name', 'title', 'kode', 'id'],
      seed,
    )} AS TEXT)) = '';`,
    assertions: [assert('column', 'jumlah', 'equals', 0, 'Kolom wajib harus terisi')],
    rationale: 'Aturan bisnis: atribut kunci tidak boleh kosong agar pencarian dan pelaporan tetap valid.',
  });

  if (/duplikat|unik|unique|ganda/i.test(requirement) || /UNIQUE/i.test(schema)) {
    const col = guessColumn(requirement, ['email', 'code', 'kode', 'nik', 'username']);
    checks.push({
      name: `Tidak ada duplikat ${col} pada ${table}`,
      sql: `SELECT ${col}, COUNT(*) AS jumlah\nFROM ${table}\nGROUP BY ${col}\nHAVING COUNT(*) > 1;`,
      assertions: [assert('row_count', undefined, 'equals', 0, 'Tidak boleh ada duplikat')],
      rationale: 'Constraint keunikan harus dipatuhi pada level data, bukan hanya di aplikasi.',
    });
  }

  checks.push({
    name: `Rentang nilai numerik ${table}`,
    sql: `SELECT COUNT(*) AS jumlah\nFROM ${table}\nWHERE ${guessColumn(requirement, [
      'amount',
      'total',
      'harga',
      'price',
      'qty',
      'jumlah',
    ])} < 0;`,
    assertions: [assert('column', 'jumlah', 'equals', 0, 'Nilai negatif tidak diizinkan')],
    rationale: 'Validasi bisnis: nilai transaksi/jumlah tidak boleh negatif.',
  });

  if (/status|approval|workflow|alur/i.test(requirement)) {
    checks.push({
      name: `Nilai status ${table} hanya dari daftar yang sah`,
      sql: `SELECT status, COUNT(*) AS jumlah\nFROM ${table}\nGROUP BY status;`,
      assertions: [
        assert('row_count', undefined, 'gte', 1, 'Minimal satu status terpakai'),
        assert('column', 'status', 'in', ['draft', 'active', 'inactive', 'closed'], 'Status harus dari daftar sah'),
      ],
      rationale: 'Mencegah status liar yang tidak dikenali alur kerja aplikasi.',
    });
  }

  checks.push({
    name: `Kesegaran data ${table} (dibuat 24 jam terakhir)`,
    sql: `SELECT COUNT(*) AS jumlah\nFROM ${table}\nWHERE created_at >= datetime('now', '-1 day');`,
    assertions: [assert('column', 'jumlah', 'gte', 0, 'Query berjalan dan mengembalikan angka')],
    rationale: 'Smoke check konektivitas + memastikan pipeline data berjalan.',
  });

  return checks;
}

/* ------------------------------------------------------------------ *
 * Task: generate_web_flow
 * ------------------------------------------------------------------ */

export function generateWebFlow(input: Input = {}): WebFlowDraft {
  const crawl = obj(input, 'crawl');
  const url = str(input, 'url') || firstPageUrl(crawl) || 'http://127.0.0.1:5174/mock/demo';
  const scenarioText = str(input, 'scenario_text') || blob(input) || 'menjalankan alur utama aplikasi';
  const page = firstPage(crawl);
  const steps: WebStep[] = [];

  steps.push({ action: 'goto', value: url, description: `Buka halaman awal ${url}` });
  steps.push({ action: 'wait', timeout_ms: 500, description: 'Tunggu halaman stabil' });
  steps.push({ action: 'assert_visible', selector: 'body', description: 'Halaman termuat (body terlihat)' });

  const forms = (page?.forms as Array<Record<string, unknown>> | undefined) ?? [];
  const form = forms[0];
  if (form) {
    const fields = (form.fields as Array<Record<string, unknown>> | undefined) ?? [];
    for (const f of fields.slice(0, 6)) {
      const name = typeof f?.name === 'string' ? f.name : 'field';
      const type = typeof f?.type === 'string' ? f.type : 'text';
      const selector = `[name="${name}"]`;
      const value = deriveField(name, type, true).samples[0];
      steps.push({
        action: type === 'checkbox' ? 'check' : 'fill',
        selector,
        ...(type === 'checkbox' ? {} : { value }),
        description: `Isi field ${name}`,
      });
    }
    const submit = pick(['button[type="submit"]', 'form button', 'input[type="submit"]'], stableHash(scenarioText));
    steps.push({ action: 'click', selector: submit, description: 'Kirim form' });
    steps.push({ action: 'wait', timeout_ms: 800, description: 'Tunggu respons server' });
  }

  const buttons = (page?.buttons as string[] | undefined) ?? [];
  if (buttons.length) {
    steps.push({ action: 'click', selector: `text=${buttons[0]}`, description: `Klik tombol "${buttons[0]}"` });
  }

  const links = (page?.links as Array<Record<string, unknown>> | undefined) ?? [];
  if (links.length && !form) {
    const link = links.find((l) => typeof l?.text === 'string' && l.text) ?? links[0];
    steps.push({
      action: 'click',
      selector: `text=${typeof link?.text === 'string' ? link.text : 'Detail'}`,
      description: 'Buka tautan navigasi utama',
    });
  }

  const expectText = (page?.title as string) || 'Berhasil';
  steps.push({ action: 'assert_text', selector: 'body', expected: expectText, description: `Verifikasi teks "${expectText}"` });
  steps.push({ action: 'screenshot', value: 'hasil-akhir', description: 'Ambil bukti screenshot' });

  return {
    name: truncate(`Alur: ${titleise(scenarioText)}`, 120),
    start_url: url,
    steps,
  };
}

function firstPage(crawl: Input | null): Record<string, unknown> | null {
  const pages = arrayOf<Record<string, unknown>>(crawl ?? {}, 'pages');
  return pages.length ? (pages[0] as Record<string, unknown>) : null;
}

function firstPageUrl(crawl: Input | null): string {
  const page = firstPage(crawl);
  return typeof page?.url === 'string' ? page.url : '';
}

/** Passes the crawl object down only when it is a real object (never `null`). */
function crawlInput(crawl: Input | null): Input {
  return crawl ?? {};
}
/* ------------------------------------------------------------------ *
 * Task: review_coverage
 * ------------------------------------------------------------------ */

export function reviewCoverage(input: Input = {}): CoverageReviewResult {
  const gaps = arrayOf<Record<string, unknown>>(input, 'gaps');
  const summary = obj(input, 'matrix_summary') ?? {};
  const findings: CoverageReviewResult['findings'] = [];
  const suggested: TestCaseDraft[] = [];

  for (const gap of gaps) {
    const requirementId = typeof gap?.requirement_id === 'string' ? gap.requirement_id : 'REQ-?';
    const title = typeof gap?.title === 'string' ? gap.title : humaniseIdentifier(requirementId);
    const text = `${title} ${requirementId}`;
    const priority = priorityOf(text);
    const severity: CoverageReviewResult['findings'][number]['severity'] =
      priority === 'critical' ? 'critical' : priority === 'high' ? 'major' : 'minor';
    findings.push({
      requirement_id: requirementId,
      severity,
      issue: `Belum ada test case yang menutup kebutuhan "${truncate(title, 110)}".`,
      recommendation: `Rancang minimal satu skenario happy path dan satu skenario negatif untuk ${requirementId}, lalu hubungkan ke traceability matrix.`,
    });

    const useCase = generateUseCases({ feature_description: title, count: 1 })[0] as UseCaseDraft;
    const scenarios = generateScenarios({ use_case: useCase, per_use_case: 3 });
    const cases = generateTestCases({ scenarios: scenarios as unknown as Record<string, unknown>[], per_scenario: 1 });
    suggested.push(...cases.slice(0, 2));
  }

  // Matrix-level observations (no gap list needed).
  const reqCount = Number(summary.requirements ?? summary.total_requirements ?? NaN);
  const coveragePct = Number(summary.coverage_pct ?? NaN);
  const automationPct = Number(summary.automation_pct ?? NaN);
  if (Number.isFinite(coveragePct) && coveragePct < 80) {
    findings.push({
      requirement_id: 'MATRIX',
      severity: coveragePct < 50 ? 'critical' : 'major',
      issue: `Coverage kebutuhan baru ${coveragePct}% — di bawah ambang aman 80%.`,
      recommendation:
        'Prioritaskan kebutuhan berisiko tinggi (payment/auth/integrasi) dan tambahkan test case sampai coverage ≥ 80%.',
    });
  }
  if (Number.isFinite(automationPct) && automationPct < 30) {
    findings.push({
      requirement_id: 'MATRIX',
      severity: 'minor',
      issue: `Otomasi baru ${automationPct}% dari test case.`,
      recommendation:
        'Otomasikan test case yang stabil & sering dijalankan (smoke + regresi inti) via engine API/Web Automation.',
    });
  }
  if (Number.isFinite(reqCount) && reqCount > 0 && !gaps.length) {
    findings.push({
      requirement_id: 'MATRIX',
      severity: 'cosmetic',
      issue: 'Tidak ada gap terdeteksi pada data yang dikirim.',
      recommendation: 'Jalankan ulang tinjauan setelah sprint berikutnya dan lengkapi acceptance criteria tiap kebutuhan.',
    });
  }

  const assessment = (() => {
    const critical = findings.filter((f) => f.severity === 'critical' || f.severity === 'blocker').length;
    const major = findings.filter((f) => f.severity === 'major').length;
    if (critical) return `Perlu tindakan segera: ${critical} temuan kritis dari ${findings.length} temuan. Jangan masuk release gate sebelum diperbaiki.`;
    if (major) return `Cukup sehat namun belum siap rilis: ${major} temuan mayor perlu ditutup lebih dulu.`;
    if (findings.length === 0) return 'Coverage terlihat lengkap pada data yang diberikan; lanjutkan pemantauan berkala.';
    return `Coverage baik dengan ${findings.length} catatan minor yang dapat dikerjakan paralel dengan pengujian berjalan.`;
  })();

  return { findings, suggested_test_cases: suggested.slice(0, 6), overall_assessment: assessment };
}

/* ------------------------------------------------------------------ *
 * Task: triage_defect
 * ------------------------------------------------------------------ */

export function triageDefect(input: Input = {}): DefectTriageResult {
  const title = str(input, 'title') || 'Defect tanpa judul';
  const description = str(input, 'description');
  const actual = str(input, 'actual_result');
  const expected = str(input, 'expected_result');
  const evidence = str(input, 'evidence');
  const all = [title, description, actual, expected, evidence].filter(Boolean).join('. ');
  const lower = all.toLowerCase();

  let severity: DefectTriageResult['severity'] = 'major';
  if (/\b(data (hilang|korup|rusak)|kehilangan data|crash|force close|tidak dapat (login|diakses)|down|tidak bisa diakses|blokir total|seluruh (halaman|aplikasi))\b/.test(lower))
    severity = 'blocker';
  else if (/\b(error 500|500|gagal simpan|tidak tersimpan|salah hitung|kebocoran|data (pengguna|pelanggan) lain|unauthorized access|sql injection|xss|kebocoran data)\b/.test(lower))
    severity = 'critical';
  else if (/\b(tidak sesuai|salah|gagal|error|tidak muncul|hilang|tidak berfungsi)\b/.test(lower)) severity = 'major';
  else if (/\b(lambat|lemot|timeout|loading lama|berat)\b/.test(lower)) severity = 'minor';
  else if (/\b(typo|warna|tata letak|layout|ikon|tooltip|kosmetik|ejaan)\b/.test(lower)) severity = 'cosmetic';

  const isSecurity = /\b(sql injection|xss|csrf|idor|akses tanpa hak|kebocoran data|password (terlihat|bocor)|otentikasi|otorisasi)\b/.test(lower);
  const isPayment = /\b(bayar|pembayaran|payment|checkout|transaksi|harga|total|invoice)\b/.test(lower);
  const isAuth = /\b(login|masuk|password|kata sandi|sesi|session|token|otp)\b/.test(lower);

  const priority: DefectTriageResult['priority'] =
    severity === 'blocker' || isSecurity || isPayment
      ? 'critical'
      : severity === 'critical' || isAuth
        ? 'high'
        : severity === 'cosmetic'
          ? 'low'
          : 'medium';

  const component = componentOf(all);

  const likelyRootCause = (() => {
    if (isSecurity) return 'Kontrol otorisasi/validasi input tidak diterapkan pada endpoint atau form terkait (kemungkinan missing server-side validation).';
    if (/\b(null|kosong|undefined|tidak terdefinisi)\b/.test(lower))
      return 'Nilai null/undefined tidak ditangani pada jalur eksekusi tertentu (kemungkinan missing null-check).';
    if (/\b(500|exception|stack ?trace|server error)\b/.test(lower))
      return 'Exception tidak tertangkap di sisi server — cek log aplikasi pada timestamp kejadian.';
    if (/\b(timeout|lambat|lemot|loading)\b/.test(lower))
      return 'Query atau panggilan layanan eksternal berjalan lambat / tidak ada index / N+1 query.';
    if (/\b(tampilan|layout|warna|typo|ikon|posisi)\b/.test(lower))
      return 'Perubahan CSS/komponen UI yang tidak teregresi atau konflik style antar komponen.';
    if (/\b(tidak tersimpan|gagal simpan|data hilang)\b/.test(lower))
      return 'Transaksi database tidak di-commit atau validasi server menolak tanpa pesan yang jelas.';
    return 'Perlu reproduksi terarah: bandingkan perilaku aktual vs ekspektasi pada satu alur tunggal, lalu periksa log terkait.';
  })();

  const reproductionHint = [
    'Gunakan environment yang sama dengan laporan (catat build & browser).',
    'Ikuti langkah: ' +
      pick(
        [
          'buka modul → isi data sesuai laporan → jalankan aksi → amati hasil',
          'login dengan peran terkait → ulangi aksi → bandingkan hasil',
          'siapkan data awal dari laporan → ulangi minimal 3 kali → cek konsistensi',
        ],
        stableHash(all),
      ),
    'Ulangi 3x untuk memastikan bukan flaky; lampirkan screenshot/log/network HAR.',
  ].join(' ');

  const suggestedOwnerRole = isSecurity
    ? 'Backend Engineer (Security Champion)'
    : isPayment
      ? 'Backend Engineer — Payments'
      : component === 'User Interface'
        ? 'Frontend Engineer'
        : component === 'Database'
          ? 'Backend Engineer / DBA'
          : 'Full-stack Engineer';

  const duplicateRisk: DefectTriageResult['duplicate_risk'] = /\b(sudah|pernah|lagi|ulang|sama seperti|seperti sebelumnya)\b/.test(
    lower,
  )
    ? 'high'
    : severity === 'major' || severity === 'critical'
      ? 'medium'
      : 'low';

  return {
    severity,
    priority,
    component,
    likely_root_cause: likelyRootCause,
    reproduction_hint: reproductionHint,
    suggested_owner_role: suggestedOwnerRole,
    duplicate_risk: duplicateRisk,
    rationale: `Severity ${severity} & priority ${priority} diturunkan dari kata kunci pada judul/deskripsi (dampak: ${
      severity === 'blocker' || severity === 'critical' ? 'menghambat alur utama' : 'mengganggu namun ada workaround'
    }). Komponen "${component}" dipilih dari pencocokan istilah domain. ${
      isSecurity ? 'Indikasi isu keamanan menaikkan priority ke critical.' : ''
    }`.trim(),
  };
}

/* ------------------------------------------------------------------ *
 * Task: predict_risk
 * ------------------------------------------------------------------ */

export function predictRisk(input: Input = {}): RiskPredictionResult {
  const rows = arrayOf<Record<string, unknown>>(input, 'test_cases');
  const ids = arrayOf<string>(input, 'test_case_ids').filter((x) => typeof x === 'string');

  const items: RiskPredictionResult['items'] = [];
  const source: Array<{ id: string; code?: string; title?: string; text: string }> = [];

  if (rows.length) {
    for (const r of rows) {
      source.push({
        id: typeof r.id === 'string' ? r.id : `tc_${source.length + 1}`,
        code: typeof r.code === 'string' ? r.code : undefined,
        title: typeof r.title === 'string' ? r.title : undefined,
        text: [r.title, r.objective, r.type, r.layer, r.priority, Array.isArray(r.tags) ? (r.tags as string[]).join(' ') : '']
          .filter(Boolean)
          .join(' '),
      });
    }
  } else if (ids.length) {
    ids.forEach((id) => source.push({ id, code: id, text: humaniseIdentifier(id) }));
  } else {
    source.push({ id: 'tc_contoh', code: 'TC-000', title: 'Contoh test case', text: 'contoh fungsional web' });
  }

  for (const row of source) {
    const text = row.text;
    const lower = text.toLowerCase();
    const factors: string[] = [];
    let score = 20;

    const prio = priorityOf(text);
    const prioPts = { critical: 26, high: 18, medium: 10, low: 4 }[prio] ?? 8;
    score += prioPts;
    factors.push(`prioritas ${prio} (+${prioPts})`);

    if (/\b(bayar|payment|checkout|transaksi|harga|invoice|gaji|transfer)\b/.test(lower)) {
      score += 18;
      factors.push('menyentuh transaksi/keuangan (+18)');
    }
    if (/\b(login|auth|password|token|otorisasi|hak akses|permission)\b/.test(lower)) {
      score += 14;
      factors.push('menyentuh autentikasi/otorisasi (+14)');
    }
    if (/\b(integrasi|api|webhook|sinkron|third ?party|payment gateway)\b/.test(lower)) {
      score += 10;
      factors.push('melibatkan integrasi eksternal (+10)');
    }
    if (/\b(negatif|negative|invalid|gagal|error|security|keamanan)\b/.test(lower) || (typeof rows.find((r) => r.id === row.id)?.type === 'string' && /negative|security/.test(String(rows.find((r) => r.id === row.id)?.type))))
    {
      score += 8;
      factors.push('jenis pengujian kritis (negatif/keamanan) (+8)');
    }
    if (/\b(boundary|batas|edge|limit)\b/.test(lower)) {
      score += 6;
      factors.push('pengujian nilai batas (+6)');
    }
    if (/\b(regresi|regression)\b/.test(lower)) {
      score += 12;
      factors.push('bertanda regresi (+12)');
    }
    if (/\b(manual|belum diotomasi|to_be_automated)\b/.test(lower)) {
      score += 5;
      factors.push('belum terotomasi (+5)');
    }
    if (/\b(performa|performance|beban|load)\b/.test(lower)) {
      score += 6;
      factors.push('dimensi performa (+6)');
    }
    // Deterministic jitter so equal-looking cases still order stably.
    const jitter = stableHash(row.id) % 7;
    score += jitter;
    if (jitter) factors.push(`variasi deterministik (+${jitter})`);

    score = Math.max(0, Math.min(100, score));
    const level: RiskLevel = score >= 65 ? 'high' : score >= 35 ? 'medium' : 'low';
    items.push({
      test_case_id: row.id,
      ...(row.code ? { code: row.code } : {}),
      ...(row.title ? { title: row.title } : {}),
      score,
      level,
      factors,
      should_be_in_regression: score >= 50,
      recommended_order: 0,
    });
  }

  items.sort((a, b) => b.score - a.score || a.test_case_id.localeCompare(b.test_case_id));
  items.forEach((it, i) => {
    it.recommended_order = i + 1;
  });
  return { items };
}

/* ------------------------------------------------------------------ *
 * Task: summarize_test_plan
 * ------------------------------------------------------------------ */

export function summarizeTestPlan(input: Input = {}): {
  title: string;
  summary: string;
  scope: string[];
  out_of_scope: string[];
  approach: Array<{ phase: string; activities: string[]; exit_criteria: string }>;
  environments: Array<{ name: string; purpose: string }>;
  test_data: string[];
  risks: Array<{ risk: string; likelihood: RiskLevel; impact: RiskLevel; mitigation: string }>;
  schedule: Array<{ day: string; focus: string; owner: string }>;
  entry_criteria: string[];
  exit_criteria: string[];
  metrics: string[];
} {
  const projectName = str(input, 'project_name') || str(input, 'name') || 'Proyek QA';
  const cases = arrayOf<Record<string, unknown>>(input, 'test_cases');
  const ids = arrayOf<string>(input, 'test_case_ids').filter((x) => typeof x === 'string');
  const total = cases.length || ids.length || 0;
  const scopeText = cases.map((c) => String(c.title ?? '')).filter(Boolean);
  const highRisk = predictRisk({ test_cases: cases }).items.filter((i) => i.level === 'high');
  const domains = uniq(cases.map((c) => componentOf(String(c.title ?? '')))).filter(Boolean);

  return {
    title: `Rencana Pengujian — ${projectName}`,
    summary:
      `Rencana ini mencakup ${total || 'seluruh'} test case${domains.length ? ` pada area ${domains.slice(0, 4).join(', ')}` : ''}. ` +
      'Pendekatan berbasis risiko: kasus dengan skor risiko tinggi dijalankan lebih dulu, diikuti regresi inti (King of the Test) dan uji eksploratori terarah. ' +
      `${highRisk.length} test case teridentifikasi berisiko tinggi dan wajib masuk suite regresi.`,
    scope: scopeText.length
      ? scopeText.slice(0, 12).map((t) => truncate(t, 120))
      : ['Alur utama aplikasi (happy path)', 'Validasi input & penanganan kesalahan', 'Kontrol akses berbasis peran'],
    out_of_scope: [
      'Pengujian performa skala penuh (>100 virtual user) — dijadwalkan terpisah.',
      'Pengujian keamanan mendalam (penetration test) oleh tim security.',
      'Pengujian perangkat keras/periferal di luar environment yang disepakati.',
    ],
    approach: [
      {
        phase: '1. Persiapan',
        activities: [
          'Review kebutuhan & acceptance criteria bersama product owner.',
          'Siapkan environment, kredensial uji, dan test data set.',
          'Pastikan traceability matrix terisi (kebutuhan → use case → skenario → test case).',
        ],
        exit_criteria: 'Semua test case yang akan dijalankan berstatus "ready" dan datanya tersedia.',
      },
      {
        phase: '2. Smoke Test',
        activities: ['Jalankan subset kritis (< 30 menit) untuk memastikan build layak diuji.', 'Catat blocker dan hentikan pengujian bila build tidak stabil.'],
        exit_criteria: 'Tidak ada blocker; pass rate smoke ≥ 90%.',
      },
      {
        phase: '3. Fungsional & Negatif',
        activities: [
          'Eksekusi test case fungsional, negatif, dan nilai batas per modul.',
          'Catat defect dengan bukti (screenshot/log/network).',
          'Lakukan triase defect harian bersama developer.',
        ],
        exit_criteria: 'Seluruh test case prioritas high/critical selesai dieksekusi; defect kritis tertriase.',
      },
      {
        phase: '4. Otomasi (API/DB/Web)',
        activities: [
          'Otomasikan kasus stabil & berulang menggunakan engine API, DB, dan Web Automation.',
          'Jalankan suite otomasi pada setiap build kandidat.',
        ],
        exit_criteria: 'Suite otomasi hijau dan waktu eksekusi < 15 menit.',
      },
      {
        phase: '5. Regresi & Release Gate',
        activities: [
          'Jalankan suite regresi berbasis risiko (seluruh kasus berisiko tinggi + kasus yang terdampak perubahan).',
          'Evaluasi kriteria keluar bersama stakeholder.',
        ],
        exit_criteria: `Pass rate ≥ quality gate, 0 defect blocker/critical terbuka, coverage kebutuhan ≥ 80%.`,
      },
    ],
    environments: [
      { name: 'Local/Mock', purpose: 'Pengujian cepat & demo offline (tanpa jaringan).' },
      { name: 'Staging', purpose: 'Pengujian fungsional terintegrasi dengan data mirip produksi.' },
      { name: 'UAT', purpose: 'Validasi bisnis oleh pengguna sebelum rilis.' },
    ],
    test_data: [
      'Data valid untuk jalur utama (happy path).',
      'Data tidak valid: kosong, format salah, melebihi batas karakter.',
      'Data batas: nilai minimum, maksimum, dan tepat di luar rentang.',
      'Data khusus: karakter unicode, spasi berlebih, payload SQL/XSS untuk uji keamanan.',
    ],
    risks: [
      {
        risk: 'Build tidak stabil sehingga pengujian tertunda.',
        likelihood: 'medium',
        impact: 'high',
        mitigation: 'Smoke test harian + pipeline otomatis; hentikan pengujian bila blocker muncul.',
      },
      {
        risk: 'Test data tidak representatif.',
        likelihood: 'medium',
        impact: 'medium',
        mitigation: 'Gunakan data set terkurasi & hasil generator AI untuk variasi kasus batas.',
      },
      {
        risk: 'Perubahan kebutuhan di tengah siklus.',
        likelihood: 'high',
        impact: 'high',
        mitigation: 'Change control + perbarui traceability matrix dan test case terdampak.',
      },
      {
        risk: 'Regresi tersembunyi pada modul yang tidak diuji.',
        likelihood: 'low',
        impact: 'high',
        mitigation: 'Regression suite berbasis risk score + uji eksploratori terarah pada area berubah.',
      },
    ],
    schedule: [
      { day: 'Hari 1', focus: 'Persiapan environment, data, dan review kebutuhan.', owner: 'QA Lead' },
      { day: 'Hari 2', focus: 'Smoke test + eksekusi test case prioritas critical.', owner: 'QA Engineer' },
      { day: 'Hari 3–4', focus: 'Eksekusi fungsional, negatif, dan nilai batas.', owner: 'QA Engineer' },
      { day: 'Hari 5', focus: 'Otomasi API/DB/Web + perbaikan suite.', owner: 'Automation Engineer' },
      { day: 'Hari 6', focus: 'Regresi (King of the Test) & retest defect.', owner: 'QA Lead + Engineer' },
      { day: 'Hari 7', focus: 'Release gate, laporan metrik, dan retrospektif.', owner: 'QA Lead' },
    ],
    entry_criteria: [
      'Build lolos smoke test dan dapat dideploy ke staging.',
      'Kebutuhan yang diuji sudah disetujui (approved) dan memiliki acceptance criteria.',
      'Environment & test data siap pakai.',
    ],
    exit_criteria: [
      'Pass rate ≥ ambang quality gate proyek.',
      'Tidak ada defect blocker/critical yang masih terbuka.',
      'Coverage kebutuhan ≥ 80% dan traceability matrix lengkap.',
      'Suite regresi hijau pada build kandidat rilis.',
    ],
    metrics: [
      'Pass rate & fail rate per modul.',
      'Defect density (defect per test case) dan defect leakage.',
      'Requirement coverage % serta automation %.',
      'Rata-rata durasi test case & ROI otomasi (menit yang dihemat).',
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Task: crawl_site (offline synthesis when the crawler cannot fetch)
 * ------------------------------------------------------------------ */

export function offlineCrawl(input: Input = {}): CrawlResult {
  const url = str(input, 'url');
  const segments = (() => {
    try {
      const u = new URL(url);
      return u.pathname.split('/').filter(Boolean);
    } catch {
      return url.split('/').filter(Boolean);
    }
  })();
  const title = segments.length ? humaniseIdentifier(segments[segments.length - 1] as string) : 'Halaman Aplikasi';
  return {
    url,
    fetched: false,
    pages: [],
    features: segments.slice(0, 4).map((seg, i) => ({
      name: humaniseIdentifier(seg),
      kind: (i === 0 ? 'navigation' : 'listing') as CrawlResult['features'][number]['kind'],
      evidence: `Segmen URL "/${seg}" pada ${url}`,
      suggested_actor: 'Pengguna',
      suggested_priority: 'medium' as const,
    })),
    suggested_use_cases: [{ name: `Menjelajahi ${title}`, goal: `Memahami fungsi halaman ${title}.`, actors: ['Pengguna'], priority: 'medium' as const }],
    used_mock: true,
  };
}

/* ------------------------------------------------------------------ *
 * Task: chat
 * ------------------------------------------------------------------ */

export function offlineChat(input: Input = {}): { reply: string; suggestions: string[] } {
  const messages = arrayOf<Record<string, unknown>>(input, 'messages');
  const last = [...messages].reverse().find((m) => m?.role === 'user');
  const question = typeof last?.content === 'string' ? last.content : str(input, 'message') || blob(input);
  const lower = question.toLowerCase();

  const suggestions = [
    'Buatkan use case dari deskripsi fitur ini.',
    'Turunkan skenario negatif dari use case tersebut.',
    'Susun test case lengkap dengan data uji.',
    'Tinjau celah coverage pada traceability matrix.',
    'Triase defect berikut dan tentukan severity-nya.',
  ];

  const reply = (() => {
    if (/\b(use ?case|usecase)\b/.test(lower)) {
      const uc = generateUseCases({ feature_description: question, count: 1 })[0] as UseCaseDraft;
      return [
        'Mode offline: saya menyusun use case draft dari teks Anda dengan mesin aturan QATools.',
        '',
        `Nama: ${uc.name}`,
        `Tujuan: ${uc.goal}`,
        `Actor: ${uc.actors.join(', ')}`,
        `Alur utama:`,
        ...uc.main_flow.map((s, i) => `  ${i + 1}. ${s}`),
        `Prioritas: ${uc.priority} · Risiko: ${uc.risk}`,
        '',
        'Buka AI Studio → task "generate_usecases" lalu aktifkan "Simpan sebagai artifact" untuk menyimpannya.',
      ].join('\n');
    }
    if (/\b(skenario|scenario)\b/.test(lower)) {
      const sc = generateScenarios({ use_case: generateUseCases({ feature_description: question, count: 1 })[0], per_use_case: 3 });
      return [
        'Mode offline: berikut skenario yang dapat saya turunkan.',
        '',
        ...sc.map((s) => `- [${s.kind}] ${s.title}\n    Given: ${s.given_text}\n    When: ${s.when_text}\n    Then: ${s.then_text}`),
        '',
        'Jalankan task "generate_scenarios" di AI Studio untuk menyimpan ke tabel scenarios.',
      ].join('\n');
    }
    if (/\b(test ?case|testcase)\b/.test(lower)) {
      const tc = generateTestCases({
        scenarios: generateScenarios({ use_case: generateUseCases({ feature_description: question, count: 1 })[0], per_use_case: 1 }),
        per_scenario: 1,
      })[0] as TestCaseDraft;
      return [
        'Mode offline: contoh test case yang saya hasilkan.',
        '',
        `Judul: ${tc.title}`,
        `Tipe: ${tc.type} · Layer: ${tc.layer} · Prioritas: ${tc.priority} · Estimasi: ${tc.estimated_minutes} menit`,
        'Langkah:',
        ...tc.steps.map((s, i) => `  ${i + 1}. ${s.action} → ${s.expected}`),
        `Hasil diharapkan: ${tc.expected_result}`,
      ].join('\n');
    }
    if (/\b(defect|bug|triase|triage)\b/.test(lower)) {
      const t = triageDefect({ title: question });
      return [
        'Mode offline: hasil triase rule-based.',
        '',
        `Severity: ${t.severity} · Priority: ${t.priority} · Komponen: ${t.component}`,
        `Dugaan akar masalah: ${t.likely_root_cause}`,
        `Saran pemilik: ${t.suggested_owner_role}`,
        `Sinyal duplikat: ${t.duplicate_risk}`,
        '',
        t.rationale,
      ].join('\n');
    }
    if (/\b(sql|query|database)\b/.test(lower)) {
      const s = generateSql({ requirement_text: question });
      return ['Mode offline: SQL draft (baca-saja).', '', '```sql', s.sql, '```', '', s.explanation].join('\n');
    }
    return [
      'Mode offline QATools aktif — tidak ada API key, jadi jawaban dibuat oleh generator rule-based lokal (deterministik).',
      '',
      `Pertanyaan Anda: "${truncate(question, 200)}"`,
      '',
      'Saya paling berguna bila diminta salah satu tugas terstruktur berikut:',
      ...suggestions.map((s) => `- ${s}`),
      '',
      'Isi provider + API key di halaman AI Settings bila ingin jawaban dari LLM sungguhan; tanpa itu, seluruh alur QA tetap bisa dijalankan penuh secara offline.',
    ].join('\n');
  })();

  return { reply, suggestions };
}

/* ------------------------------------------------------------------ *
 * Dispatcher — covers EVERY entry of AI_TASKS
 * ------------------------------------------------------------------ */

export function offlineGenerate(task: AiTask | string, input: Input = {}): unknown {
  switch (task) {
    case 'crawl_site':
      return offlineCrawl(input);
    case 'generate_usecases':
      return generateUseCases(input);
    case 'generate_scenarios':
      return generateScenarios(input);
    case 'generate_testcases':
      return generateTestCases(input);
    case 'generate_test_data':
      return generateTestData(input);
    case 'generate_api_tests':
      return generateApiTests(input);
    case 'generate_db_checks':
      return generateDbChecks(input);
    case 'generate_web_flow':
      return generateWebFlow(input);
    case 'generate_sql':
      return generateSql(input);
    case 'review_coverage':
      return reviewCoverage(input);
    case 'triage_defect':
      return triageDefect(input);
    case 'summarize_test_plan':
      return summarizeTestPlan(input);
    case 'predict_risk':
      return predictRisk(input);
    case 'chat':
      return offlineChat(input);
    default:
      // Unknown task (a lane typo): still answer with something honest and shaped.
      return {
        note: `Task "${task}" belum punya generator offline khusus.`,
        known_tasks: [...AI_TASKS],
        echo: input,
      };
  }
}

/** Contract-shape sanity used by the module before persisting/logging. */
export function isKnownTask(task: string): boolean {
  return (AI_TASKS as readonly string[]).includes(task);
}

/** Exposed for docs/tests: the exact set of tasks the generator covers. */
export const OFFLINE_COVERED_TASKS: readonly string[] = [...AI_TASKS];

/** Re-exported vocabulary so the module and tests share one source of truth. */
export { CASE_TYPES, LAYER_KINDS, SEVERITIES };
