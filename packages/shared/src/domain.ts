/**
 * Lifecycle, enums and label dictionaries for QATools.
 *
 * This module is FROZEN (lead-owned). Lanes import from `@qatools/shared` and must not
 * redefine these vocabularies locally.
 */

/* ------------------------------------------------------------------ *
 * Ordered QA lifecycle
 * ------------------------------------------------------------------ */

export const QA_STAGES = [
  'requirements',
  'usecases',
  'scenarios',
  'testcases',
  'matrix',
  'planning',
  'environment',
  'execution',
  'defects',
  'regression',
  'release',
  'metrics',
] as const;

export type QaStage = (typeof QA_STAGES)[number];

export interface StageMeta {
  id: QaStage;
  order: number;
  label: string;
  labelEn: string;
  icon: string;
  blurb: string;
}

/** The ordered wizard that drives the whole product. Indonesian labels (UI language). */
export const STAGE_META: readonly StageMeta[] = [
  { id: 'requirements', order: 1,  label: 'Kebutuhan',            labelEn: 'Requirements',        icon: '📋', blurb: 'Kumpulkan & normalisasi kebutuhan dari stakeholder atau existing web.' },
  { id: 'usecases',     order: 2,  label: 'Use Case',             labelEn: 'Use Cases',           icon: '📘', blurb: 'Ubah kebutuhan menjadi use case terstruktur (actor, pre/post-condition, alur).' },
  { id: 'scenarios',    order: 3,  label: 'Skenario',             labelEn: 'Scenarios',           icon: '🧭', blurb: 'Turunkan use case menjadi skenario positif, negatif, dan alternatif.' },
  { id: 'testcases',    order: 4,  label: 'Test Case',            labelEn: 'Test Cases',          icon: '🧪', blurb: 'Rancang test case dengan langkah, data uji, dan hasil yang diharapkan.' },
  { id: 'matrix',       order: 5,  label: 'Traceability Matrix',  labelEn: 'Traceability Matrix', icon: '🔗', blurb: 'Petakan kebutuhan → use case → skenario → test case secara digital & dapat diaudit.' },
  { id: 'planning',     order: 6,  label: 'Perencanaan Proyek',   labelEn: 'Project Planning',    icon: '🗂️', blurb: 'Susun sprint, cycle, alokasi tester, dan estimasi effort.' },
  { id: 'environment',  order: 7,  label: 'Environment & Data',   labelEn: 'Environment & Data',  icon: '🖥️', blurb: 'Siapkan environment, kredensial uji, dan test data set.' },
  { id: 'execution',    order: 8,  label: 'Eksekusi',             labelEn: 'Execution',           icon: '▶️', blurb: 'Jalankan test: manual, database, API automation, web automation, atau oleh AI.' },
  { id: 'defects',      order: 9,  label: 'Defect',               labelEn: 'Defects',             icon: '🐞', blurb: 'Catat, triase, dan lacak defect sampai terverifikasi.' },
  { id: 'regression',   order: 10, label: 'Regresi (King)',       labelEn: 'Regression (King)',   icon: '👑', blurb: 'Regresi adalah raja: pilih suite optimal, jalankan, dan jaga kestabilan rilis.' },
  { id: 'release',      order: 11, label: 'Release Gate',         labelEn: 'Release Gate',        icon: '🚦', blurb: 'Tentukan go / no-go dengan kriteria keluar yang terukur.' },
  { id: 'metrics',      order: 12, label: 'Metrik & Laporan',     labelEn: 'Metrics & Reporting', icon: '📊', blurb: 'Ukur kualitas: pass rate, defect density, coverage, escape rate, dan lainnya.' },
];

export function stageMeta(stage: QaStage): StageMeta {
  return STAGE_META.find((s) => s.id === stage) as StageMeta;
}

/* ------------------------------------------------------------------ *
 * Enums
 * ------------------------------------------------------------------ */

export const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const CASE_TYPES = [
  'functional',
  'negative',
  'boundary',
  'security',
  'performance',
  'usability',
  'compatibility',
  'regression',
] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const AUTOMATION_STATUSES = ['manual', 'automated', 'to_be_automated', 'cannot_automate'] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

export const RUN_STATUSES = ['passed', 'failed', 'blocked', 'skipped', 'not_run'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const LAYER_KINDS = ['web', 'api', 'db', 'mobile', 'unit'] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];

/** The five execution engines. `ai` is a first-class engine, not an add-on. */
export const EXEC_ENGINES = ['manual', 'db', 'api', 'web', 'ai'] as const;
export type ExecEngine = (typeof EXEC_ENGINES)[number];

export const DEFECT_STATUSES = [
  'new',
  'triaged',
  'in_progress',
  'fixed',
  'retest',
  'verified',
  'reopened',
  'closed',
  'rejected',
  'deferred',
] as const;
export type DefectStatus = (typeof DEFECT_STATUSES)[number];

export const SEVERITIES = ['cosmetic', 'minor', 'major', 'critical', 'blocker'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const DEFECT_SOURCES = ['manual', 'api', 'web', 'db', 'ai', 'regression', 'exploratory'] as const;
export type DefectSource = (typeof DEFECT_SOURCES)[number];

export const CYCLE_STATUSES = ['planned', 'active', 'completed', 'archived'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export const SPRINT_STATUSES = ['planned', 'active', 'completed'] as const;
export type SprintStatus = (typeof SPRINT_STATUSES)[number];

export const TRACE_LINK_TYPES = [
  'requirement_to_usecase',
  'usecase_to_scenario',
  'scenario_to_testcase',
  'testcase_to_defect',
  'requirement_to_testcase',
  'testcase_to_automation',
  'usecase_to_defect',
] as const;
export type TraceLinkType = (typeof TRACE_LINK_TYPES)[number];

export const ARTIFACT_KINDS = ['requirement', 'usecase', 'scenario', 'testcase', 'defect', 'apirequest', 'dbcheck', 'webflow'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** Task kinds the AI layer knows how to perform. Frozen: lanes call these exact keys. */
export const AI_TASKS = [
  'crawl_site',            // analyze an existing web page → features found
  'generate_usecases',     // requirement/feature → use cases
  'generate_scenarios',    // use case → scenarios
  'generate_testcases',    // scenario → test cases with steps
  'generate_test_data',    // test case → data rows
  'generate_api_tests',    // openapi / endpoint desc → API requests + assertions
  'generate_db_checks',    // data requirement → SQL assertions
  'generate_web_flow',     // scenario → UI automation steps/selectors
  'generate_sql',          // NL → SQL
  'review_coverage',       // matrix → coverage gaps & suggestions
  'triage_defect',         // defect → severity/priority/owner suggestion
  'summarize_test_plan',   // tests → human-readable plan
  'predict_risk',          // test cases → risk scores for regression selection
  'chat',                  // free-form assistant
] as const;
export type AiTask = (typeof AI_TASKS)[number];

/* ------------------------------------------------------------------ *
 * Label dictionaries (Bahasa Indonesia) — single source of truth for the UI
 * ------------------------------------------------------------------ */

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Rendah',
  medium: 'Sedang',
  high: 'Tinggi',
  critical: 'Kritis',
};

export const RISK_LABEL: Record<RiskLevel, string> = {
  low: 'Rendah',
  medium: 'Sedang',
  high: 'Tinggi',
};

export const CASE_TYPE_LABEL: Record<CaseType, string> = {
  functional: 'Fungsional',
  negative: 'Negatif',
  boundary: 'Nilai Batas',
  security: 'Keamanan',
  performance: 'Performa',
  usability: 'Usability',
  compatibility: 'Kompatibilitas',
  regression: 'Regresi',
};

export const AUTOMATION_STATUS_LABEL: Record<AutomationStatus, string> = {
  manual: 'Manual',
  automated: 'Terotomasi',
  to_be_automated: 'Akan diotomasi',
  cannot_automate: 'Tidak bisa diotomasi',
};

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  passed: 'Lulus',
  failed: 'Gagal',
  blocked: 'Terblokir',
  skipped: 'Dilewati',
  not_run: 'Belum dijalankan',
};

export const LAYER_LABEL: Record<LayerKind, string> = {
  web: 'Web UI',
  api: 'API',
  db: 'Database',
  mobile: 'Mobile',
  unit: 'Unit',
};

export const DEFECT_STATUS_LABEL: Record<DefectStatus, string> = {
  new: 'Baru',
  triaged: 'Tertriase',
  in_progress: 'Dikerjakan',
  fixed: 'Diperbaiki',
  retest: 'Siap Retest',
  verified: 'Terverifikasi',
  reopened: 'Dibuka Ulang',
  closed: 'Ditutup',
  rejected: 'Ditolak',
  deferred: 'Ditunda',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  cosmetic: 'Kosmetik',
  minor: 'Minor',
  major: 'Mayor',
  critical: 'Kritis',
  blocker: 'Blocker',
};

export const ENGINE_LABEL: Record<ExecEngine, string> = {
  manual: 'Manual',
  db: 'Database',
  api: 'API Automation',
  web: 'Web Automation',
  ai: 'AI Automation',
};

/** Badge tone per status — web maps these to `.badge-ok|warn|err|info|muted`. */
export type BadgeTone = 'ok' | 'warn' | 'err' | 'info' | 'muted' | 'accent';

export const RUN_STATUS_TONE: Record<RunStatus, BadgeTone> = {
  passed: 'ok',
  failed: 'err',
  blocked: 'warn',
  skipped: 'muted',
  not_run: 'muted',
};

export const DEFECT_STATUS_TONE: Record<DefectStatus, BadgeTone> = {
  new: 'info',
  triaged: 'info',
  in_progress: 'accent',
  fixed: 'warn',
  retest: 'warn',
  verified: 'ok',
  reopened: 'err',
  closed: 'muted',
  rejected: 'muted',
  deferred: 'muted',
};

export const SEVERITY_TONE: Record<Severity, BadgeTone> = {
  cosmetic: 'muted',
  minor: 'info',
  major: 'warn',
  critical: 'err',
  blocker: 'err',
};

export const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  low: 'muted',
  medium: 'info',
  high: 'warn',
  critical: 'err',
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Sortable, prefixed identifier: `<prefix><10 chars of base32 time><8 chars random>`.
 * Monotonic within a millisecond, so `ORDER BY id` ≈ `ORDER BY created_at`.
 */
export function newId(prefix: string): string {
  let time = Date.now();
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = B32[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  let rand = '';
  const bytes = new Uint8Array(8);
  // `crypto` is global in Node 18+ and in browsers, but not present in the ES2022 lib types,
  // so narrow it through a local alias rather than indexing globalThis.
  const webCrypto = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => void } }).crypto;
  if (typeof webCrypto?.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < 8; i++) rand += B32[(bytes[i] as number) % 32];
  return `${prefix}${timePart}${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Percentage helper that never divides by zero. */
export function pct(numerator: number, denominator: number, digits = 1): number {
  if (!denominator) return 0;
  const v = (numerator / denominator) * 100;
  return Number(v.toFixed(digits));
}

export function clampPct(v: number): number {
  return Math.max(0, Math.min(100, Number(v.toFixed(2))));
}

/** Simple, dependency-free deterministic hash — used for stable AI-stub output. */
export function stableHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Risk score 0–100 used by regression selection. Deterministic and explainable. */
export function riskScore(input: {
  businessCriticality?: Priority | string;
  usageFrequency?: string;
  complexity?: string;
  defectHistory?: number;
  lastRunFailed?: boolean;
  isRegression?: boolean;
  hasAutomation?: boolean;
}): { score: number; level: RiskLevel; factors: string[] } {
  const factors: string[] = [];
  let score = 0;

  const crit = { critical: 34, high: 26, medium: 16, low: 8 }[String(input.businessCriticality)] ?? 12;
  score += crit;
  factors.push(`business criticality +${crit}`);

  const freq = { always: 20, often: 14, sometimes: 8, rarely: 3 }[String(input.usageFrequency)] ?? 8;
  score += freq;
  factors.push(`usage frequency +${freq}`);

  const cx = { high: 16, medium: 10, low: 5 }[String(input.complexity)] ?? 8;
  score += cx;
  factors.push(`complexity +${cx}`);

  const dh = Math.min(15, (input.defectHistory ?? 0) * 3);
  if (dh) { score += dh; factors.push(`defect history +${dh}`); }

  if (input.lastRunFailed) { score += 12; factors.push('last run failed +12'); }
  if (input.isRegression) { score += 6; factors.push('regression case +6'); }
  if (!input.hasAutomation) { score += 5; factors.push('not automated +5'); }

  score = Math.max(0, Math.min(100, score));
  const level: RiskLevel = score >= 65 ? 'high' : score >= 35 ? 'medium' : 'low';
  return { score, level, factors };
}

/** Coverage status used by the traceability matrix. */
export type CoverageStatus = 'covered' | 'partial' | 'gap' | 'orphan';

export const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  covered: 'Tercakup',
  partial: 'Sebagian',
  gap: 'Belum Tercakup',
  orphan: 'Tanpa Induk',
};

export const COVERAGE_TONE: Record<CoverageStatus, BadgeTone> = {
  covered: 'ok',
  partial: 'warn',
  gap: 'err',
  orphan: 'muted',
};

/** The single source-of-truth list of features advertised by the QATools curriculum. */
export const CURRICULUM_PILLARS = [
  'e-Certificate',
  'Materi & Praktik',
  'Belajar Online',
  'Bangun Portofolio',
  'QA Introduction',
  'QA Test Technique',
  'QA Test Activity',
  'Basic QA Automation',
  'API Automation',
  'Web Automation',
  'Database Testing',
] as const;
export type CurriculumPillar = (typeof CURRICULUM_PILLARS)[number];
