/**
 * Lane D — AI Studio.
 *
 * A real workbench over the whole AI task catalogue: pick any entry from the frozen
 * `AI_TASKS` list, fill a dynamic form, generate, inspect pretty-printed JSON, and
 * optionally persist the result as traceable artifacts.
 *
 * Offline is a first-class state, not an error state: the 🟡 Offline indicator explains
 * that the deterministic rule-based generator is answering, and every task still works.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  AI_TASKS,
  PRIORITY_LABEL,
  SEVERITY_LABEL,
  type AiResult,
  type AiStatus,
  type AiTask,
} from '@qatools/shared';
import { api, ApiError } from '../../lib/api';
import { toast } from '../../lib/toast';
import { useProject } from '../../lib/project';
import { Badge, Card, Empty, ErrorBox, Field, Loading, PageHeader, Stat } from '../../components';

/* ------------------------------------------------------------------ *
 * Types mirroring the API surface
 * ------------------------------------------------------------------ */

interface TaskField {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'number' | 'json';
  hint?: string;
}

interface TaskMeta {
  task: string;
  label: string;
  fields: TaskField[];
  supports_persist: boolean;
}

interface SettingsEnvelope {
  data: {
    provider: string;
    model: string;
    base_url: string | null;
    api_key_masked: string | null;
    api_key_set: boolean;
    enabled: boolean;
    fallback_to_mock: boolean;
    status: AiStatus;
  };
}

interface GenerationRow {
  id: string;
  project_id: string | null;
  task: string;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  status: string;
  used_mock: number;
  error: string | null;
  created_at: string;
}

/** Quick-action chains over the ordered QA lifecycle. */
const QUICK_ACTIONS: Array<{
  id: string;
  task: AiTask;
  icon: string;
  title: string;
  blurb: string;
  seed: Record<string, unknown>;
  persistable: boolean;
}> = [
  {
    id: 'req-uc',
    task: 'generate_usecases',
    icon: '📋→📘',
    title: 'Kebutuhan → Use Case',
    blurb: 'Tempel deskripsi kebutuhan, dapatkan use case dengan actor, alur, dan aturan bisnis.',
    seed: { feature_description: '', count: 3 },
    persistable: true,
  },
  {
    id: 'uc-sc',
    task: 'generate_scenarios',
    icon: '📘→🧭',
    title: 'Use Case → Skenario',
    blurb: 'Turunkan use case menjadi skenario happy path, negatif, batas, dan keamanan.',
    seed: { per_use_case: 4 },
    persistable: true,
  },
  {
    id: 'sc-tc',
    task: 'generate_testcases',
    icon: '🧭→🧪',
    title: 'Skenario → Test Case',
    blurb: 'Rancang test case lengkap: langkah, data uji, hasil harapan, estimasi waktu.',
    seed: { per_scenario: 3 },
    persistable: true,
  },
  {
    id: 'coverage',
    task: 'review_coverage',
    icon: '🔗',
    title: 'Tinjau Coverage',
    blurb: 'Cari celah traceability matrix dan dapatkan saran test case penutup.',
    seed: { matrix_summary: { coverage_pct: 45, automation_pct: 15, requirements: 10 } },
    persistable: false,
  },
  {
    id: 'triage',
    task: 'triage_defect',
    icon: '🐞',
    title: 'Triase Defect',
    blurb: 'Tentukan severity, priority, komponen, dan dugaan akar masalah secara konsisten.',
    seed: { title: '', description: '', actual_result: '', expected_result: '' },
    persistable: false,
  },
  {
    id: 'risk',
    task: 'predict_risk',
    icon: '👑',
    title: 'Prediksi Risiko Regresi',
    blurb: 'Skor risiko tiap test case untuk menyusun suite regresi berbasis risiko.',
    seed: { test_cases: [] },
    persistable: false,
  },
  {
    id: 'apitests',
    task: 'generate_api_tests',
    icon: '🔌',
    title: 'API Test + Assertion',
    blurb: 'Dari OpenAPI atau deskripsi endpoint menjadi request + assertion siap jalan.',
    seed: { endpoints: 'POST /mock/login\nGET /mock/products' },
    persistable: true,
  },
  {
    id: 'webflow',
    task: 'generate_web_flow',
    icon: '🌐',
    title: 'Alur Otomasi Web',
    blurb: 'Ubah skenario menjadi langkah UI automation dengan selector dan assertion.',
    seed: { scenario_text: '', url: '' },
    persistable: true,
  },
  {
    id: 'dbcheck',
    task: 'generate_db_checks',
    icon: '🗄️',
    title: 'Pemeriksaan Database',
    blurb: 'Hasilkan query verifikasi data beserta assertion dan alasannya.',
    seed: { requirement_text: '' },
    persistable: true,
  },
  {
    id: 'plan',
    task: 'summarize_test_plan',
    icon: '📊',
    title: 'Ringkas Rencana Uji',
    blurb: 'Susun rencana pengujian: scope, pendekatan, risiko, jadwal, kriteria keluar.',
    seed: { project_name: '' },
    persistable: false,
  },
];

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const inputClass = (kind: TaskField['kind']): string =>
  kind === 'textarea' || kind === 'json' ? 'textarea' : 'input';

const PLACEHOLDER: Record<string, string> = {
  url: 'https://contoh.com/halaman atau /mock/demo',
  html: '<html>…</html> (opsional — dipakai bila server tidak bisa mengakses URL)',
  feature_description:
    'Contoh: Pengguna dapat login dengan email dan kata sandi. Admin dapat menonaktifkan akun pengguna. Pelanggan dapat checkout keranjang dan membayar dengan kartu kredit.',
  requirement_text: 'Contoh: Sistem harus menolak login dengan kata sandi salah dan mencatat percobaan pada audit log.',
  scenario_text: 'Contoh: Pengguna membuka halaman login, mengisi kredensial valid, lalu diarahkan ke dashboard.',
  endpoints: 'Satu endpoint per baris, contoh:\nPOST /mock/login\nGET /mock/products',
  openapi: '{ "openapi": "3.0.0", "paths": { "/mock/login": { "post": { "summary": "Login" } } } }',
  schema_sql: 'CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, created_at TEXT);',
  title: 'Contoh: Tombol Simpan tidak berfungsi saat data kosong',
  description: 'Langkah reproduksi dan konteks kejadian…',
  actual_result: 'Apa yang sebenarnya terjadi',
  expected_result: 'Apa yang seharusnya terjadi',
  project_name: 'Toko Demo QA',
  count: '3',
  per_use_case: '4',
  per_scenario: '3',
  rows: '6',
  base_url: 'http://127.0.0.1:5174/api',
  message: 'Contoh: Buatkan use case untuk fitur login pengguna',
};

/** Parses a JSON field, tolerating empty input by returning the provided default. */
function parseJsonField(raw: string, fallback: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const text = (raw ?? '').trim();
  if (!text) return { ok: true, value: fallback };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function fmtNumber(n: number | undefined | null): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('id-ID') : '—';
}

function fmtMs(ms: number | undefined | null): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Compact one-line summary of a generation result, for the history table and preview. */
function summarise(data: unknown): string {
  if (data === null || data === undefined) return '—';
  if (Array.isArray(data)) return `${data.length} item`;
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.items)) return `${(obj.items as unknown[]).length} item risiko`;
    if (Array.isArray(obj.findings)) return `${(obj.findings as unknown[]).length} temuan`;
    if (Array.isArray(obj.rows)) return `${(obj.rows as unknown[]).length} baris data`;
    if (Array.isArray(obj.steps)) return `${(obj.steps as unknown[]).length} langkah`;
    if (typeof obj.reply === 'string') return `${(obj.reply as string).slice(0, 60)}…`;
    if (typeof obj.sql === 'string') return String(obj.sql).split('\n')[0]!.slice(0, 60);
    return `${Object.keys(obj).length} field`;
  }
  return String(data).slice(0, 60);
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function AiStudioPage() {
  const { projectId, project } = useProject();

  const [settings, setSettings] = useState<SettingsEnvelope['data'] | null>(null);
  const [settingsError, setSettingsError] = useState<unknown>(null);
  const [tasks, setTasks] = useState<TaskMeta[]>([]);
  const [selected, setSelected] = useState<AiTask>('generate_usecases');
  const [inputText, setInputText] = useState<Record<string, string>>({});
  const [persist, setPersist] = useState(true);

  const [result, setResult] = useState<AiResult<unknown> | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const [history, setHistory] = useState<GenerationRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  /* ----------------------------- loaders ----------------------------- */

  const loadSettings = useCallback(async () => {
    try {
      const res = await api.get<SettingsEnvelope>('/ai/settings');
      setSettings(res.data);
      setSettingsError(null);
    } catch (err) {
      setSettingsError(err);
    }
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const res = await api.get<{ data: TaskMeta[] }>('/ai/tasks');
      if (Array.isArray(res.data) && res.data.length) setTasks(res.data);
    } catch {
      // Fall back to the frozen vocabulary so the picker is never empty.
      setTasks(AI_TASKS.map((t) => ({ task: t, label: t, fields: [], supports_persist: true })));
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await api.get<{ data: GenerationRow[] }>('/ai/generations', { limit: 25 });
      setHistory(res.data ?? []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadTasks();
    void loadHistory();
  }, [loadSettings, loadTasks, loadHistory]);

  /* --------------------------- derived state -------------------------- */

  const taskMeta = useMemo<TaskMeta>(
    () =>
      tasks.find((t) => t.task === selected) ?? {
        task: selected,
        label: selected,
        fields: [{ key: 'input', label: 'Input (JSON)', kind: 'json' }],
        supports_persist: true,
      },
    [tasks, selected],
  );

  const status = settings?.status;
  const isLive = status?.configured === true && status?.mode === 'live';

  const modes = useMemo(() => Object.keys(PRIORITY_LABEL).length, []);

  /* ------------------------------ actions ----------------------------- */

  const setFieldValue = (key: string, value: string) => setInputText((prev) => ({ ...prev, [key]: value }));

  /** Builds the task payload from the dynamic form (JSON fields parsed strictly). */
  function buildInput(): Record<string, unknown> | null {
    const out: Record<string, unknown> = {};
    for (const field of taskMeta.fields) {
      const raw = inputText[field.key] ?? '';
      if (field.kind === 'json') {
        const parsed = parseJsonField(raw, field.key === 'test_cases' || field.key === 'gaps' || field.key === 'fields' ? [] : {});
        if (!parsed.ok) {
          toast.err(`Field "${field.label}" bukan JSON yang valid: ${parsed.error}`);
          return null;
        }
        // Skip untouched empty collections so the generator can use its own defaults.
        if (Array.isArray(parsed.value) && parsed.value.length === 0) continue;
        if (
          parsed.value &&
          typeof parsed.value === 'object' &&
          !Array.isArray(parsed.value) &&
          Object.keys(parsed.value as Record<string, unknown>).length === 0
        ) {
          continue;
        }
        out[field.key] = parsed.value;
        continue;
      }
      if (field.kind === 'number') {
        const n = Number(raw);
        if (raw.trim() && Number.isFinite(n)) out[field.key] = n;
        continue;
      }
      if (raw.trim()) out[field.key] = raw.trim();
    }
    return out;
  }

  async function run(task: AiTask, overrideInput?: Record<string, unknown>, overridePersist?: boolean): Promise<void> {
    const input = overrideInput ?? buildInput();
    if (input === null) return;
    if (!Object.keys(input).length) {
      toast.warn('Isi minimal satu field terlebih dahulu, atau pakai kartu aksi cepat.');
      return;
    }

    const wantsPersist = overridePersist ?? persist;
    setRunning(true);
    setError(null);
    try {
      const res = await api.post<AiResult<unknown>>('/ai/generate', {
        task,
        project_id: projectId,
        input,
        persist: wantsPersist,
      });
      setResult(res);

      if (!res.ok) {
        toast.err(res.error ?? 'AI gagal menghasilkan data.');
      } else if (res.meta.degraded) {
        toast.warn(`Provider gagal — hasil dihasilkan generator offline. ${res.error ?? ''}`.trim());
      } else if (res.meta.used_mock) {
        toast.ok('Selesai (mode offline deterministik).');
      } else {
        toast.ok(`Selesai via ${res.meta.provider}/${res.meta.model}.`);
      }

      const created = (res.meta as unknown as { created?: Record<string, string[]> }).created;
      const count = created ? Object.values(created).flat().length : 0;
      if (wantsPersist && count > 0) toast.ok(`${count} artifact tersimpan.`);

      void loadHistory();
    } catch (err) {
      setError(err);
      toast.fromError(err, 'Gagal menjalankan task AI');
    } finally {
      setRunning(false);
    }
  }

  /** Quick action: prefill the form for that task and run it immediately with seed input. */
  async function runQuick(action: (typeof QUICK_ACTIONS)[number]): Promise<void> {
    setSelected(action.task);
    const withProject = { ...action.seed };
    if (action.task === 'summarize_test_plan' && !withProject.project_name) {
      withProject.project_name = project?.name ?? 'Proyek QA';
    }
    const meaningful = Object.entries(withProject).filter(([, v]) =>
      Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim().length > 0 : true,
    );
    if (!meaningful.length) {
      toast.info('Lengkapi form di bawah lalu tekan Generate.');
      setInputText(
        Object.fromEntries(
          taskMeta.fields.map((f) => [f.key, f.kind === 'json' ? '' : String(action.seed[f.key] ?? '')]),
        ),
      );
      return;
    }
    await run(action.task, withProject, action.persistable ? persist : false);
  }

  /* ------------------------------ render ------------------------------ */

  if (settingsError && !settings) {
    return (
      <ErrorBox
        error={settingsError}
        onRetry={() => {
          void loadSettings();
        }}
      />
    );
  }

  const createdIds = (result?.meta as unknown as { created?: Record<string, string[]> } | undefined)?.created;
  const persistSkipped = (result?.meta as unknown as { persist_skipped?: string[] } | undefined)?.persist_skipped;

  return (
    <>
      <PageHeader
        title="AI Studio"
        subtitle="Jalankan seluruh kapabilitas AI QATools: kebutuhan → use case → skenario → test case → otomasi → triase → risiko."
        badge={
          status ? (
            <span style={{ marginLeft: 10 }}>
              {isLive ? (
                <Badge tone="ok" title={status.message}>
                  🟢 Live · {status.provider}/{status.model}
                </Badge>
              ) : (
                <Badge tone="warn" title={status.message}>
                  🟡 Offline deterministik
                </Badge>
              )}
            </span>
          ) : null
        }
        actions={
          <>
            <NavLink className="btn" to="/ai/settings">
              ⚙️ AI Settings
            </NavLink>
            <button
              className="btn btn-ghost"
              onClick={() => {
                void loadSettings();
                void loadHistory();
              }}
              disabled={running}
            >
              🔄 Muat ulang
            </button>
          </>
        }
      />

      {/* ------------------------- status panel ------------------------- */}
      <Card>
        <div className={`alert ${isLive ? 'alert-ok' : 'alert-warn'}`}>
          <span>{isLive ? '🟢' : '🟡'}</span>
          <div style={{ flex: 1 }}>
            <div className="strong">
              {isLive ? 'Mode Live aktif' : 'Mode Offline deterministik aktif'}
            </div>
            <div className="mute-sm">{status?.message ?? 'Memeriksa konfigurasi AI…'}</div>
            {!isLive ? (
              <div className="mute-sm" style={{ marginTop: 4 }}>
                Tanpa API key, seluruh task tetap berjalan penuh: generator rule-based lokal menyusun
                artefak QA yang dapat dipakai dan <span className="strong">deterministik</span> (input sama →
                hasil sama). Isi provider di <NavLink to="/ai/settings">AI Settings</NavLink> bila ingin jawaban LLM.
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid grid-4" style={{ marginTop: 'var(--space-3)' }}>
          <Stat label="Provider" value={settings?.provider ?? '—'} hint={settings?.model ?? ''} />
          <Stat
            label="API Key"
            value={settings?.api_key_set ? settings.api_key_masked ?? 'tersimpan' : 'belum diisi'}
            tone={settings?.api_key_set ? 'ok' : 'warn'}
            hint={settings?.api_key_set ? 'ditampilkan tersamar' : 'mode offline'}
          />
          <Stat
            label="Fallback offline"
            value={settings?.fallback_to_mock ? 'Aktif' : 'Nonaktif'}
            tone={settings?.fallback_to_mock ? 'ok' : 'warn'}
          />
          <Stat label="Task tersedia" value={AI_TASKS.length} hint={`${modes} tingkat prioritas`} />
        </div>
      </Card>

      {/* ------------------------ quick actions ------------------------- */}
      <div style={{ marginTop: 'var(--space-4)' }}>
        <div className="row-between" style={{ marginBottom: 'var(--space-2)' }}>
          <h2 className="card-title" style={{ margin: 0 }}>
            ⚡ Aksi Cepat
          </h2>
          <span className="mute-sm">
            Rantai bernilai tinggi: kebutuhan → use case → skenario → test case → regresi
          </span>
        </div>
        <div className="grid grid-auto">
          {QUICK_ACTIONS.map((action) => (
            <Card key={action.id} onClick={running ? undefined : () => void runQuick(action)} className="card-hover">
              <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
                <span style={{ fontSize: 20 }}>{action.icon}</span>
                <span className="strong">{action.title}</span>
              </div>
              <p className="card-sub" style={{ marginTop: 6 }}>
                {action.blurb}
              </p>
              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                <Badge tone="accent">{action.task}</Badge>
                {action.persistable ? <Badge tone="info">dapat disimpan</Badge> : null}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* --------------------------- workbench -------------------------- */}
      <div className="grid grid-2" style={{ marginTop: 'var(--space-4)' }}>
        <Card
          title="🧪 Jalankan Task"
          subtitle="Pilih task, isi input, lalu Generate. Semua task bekerja penuh secara offline."
        >
          <div className="stack">
            <Field label="Task AI" hint={`${AI_TASKS.length} task tersedia dari katalog beku AI_TASKS`}>
              <select
                className="select"
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value as AiTask);
                  setInputText({});
                  setResult(null);
                }}
              >
                {tasks.map((t) => (
                  <option key={t.task} value={t.task}>
                    {t.label} — {t.task}
                  </option>
                ))}
              </select>
            </Field>

            {taskMeta.fields.length ? (
              taskMeta.fields.map((f) => (
                <Field key={f.key} label={f.label} hint={f.hint}>
                  {f.kind === 'textarea' || f.kind === 'json' ? (
                    <textarea
                      className={inputClass(f.kind)}
                      rows={f.kind === 'json' ? 6 : 4}
                      spellCheck={false}
                      placeholder={PLACEHOLDER[f.key] ?? (f.kind === 'json' ? '{ }' : '')}
                      value={inputText[f.key] ?? ''}
                      onChange={(e) => setFieldValue(f.key, e.target.value)}
                      style={f.kind === 'json' ? { fontFamily: 'var(--mono)', fontSize: 12 } : undefined}
                    />
                  ) : (
                    <input
                      className={inputClass(f.kind)}
                      type={f.kind === 'number' ? 'number' : 'text'}
                      placeholder={PLACEHOLDER[f.key] ?? ''}
                      value={inputText[f.key] ?? ''}
                      onChange={(e) => setFieldValue(f.key, e.target.value)}
                    />
                  )}
                </Field>
              ))
            ) : (
              <Field label="Input (JSON)" hint="Task ini menerima payload JSON bebas.">
                <textarea
                  className="textarea"
                  rows={6}
                  spellCheck={false}
                  placeholder="{ }"
                  value={inputText.input ?? ''}
                  onChange={(e) => setFieldValue('input', e.target.value)}
                  style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
                />
              </Field>
            )}

            <label className="checkbox" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={persist}
                disabled={!taskMeta.supports_persist}
                onChange={(e) => setPersist(e.target.checked)}
              />
              <span>
                💾 Simpan sebagai artifact
                <span className="hint" style={{ display: 'block' }}>
                  {taskMeta.supports_persist
                    ? 'Menyisipkan hasil ke tabel artifact (use_cases, scenarios, test_cases, …) beserta baris traceability matrix.'
                    : 'Task ini tidak menghasilkan artifact yang dapat disimpan.'}
                </span>
              </span>
            </label>

            {!projectId ? (
              <div className="alert alert-warn">
                <span>📁</span>
                <div>
                  Belum ada project aktif — generate tetap berjalan, tetapi artifact tidak dapat disimpan.
                </div>
              </div>
            ) : null}

            <div className="row">
              <button className="btn btn-primary" onClick={() => void run(selected)} disabled={running}>
                {running ? '⏳ Menjalankan…' : '✨ Generate'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setInputText({});
                  setResult(null);
                  setError(null);
                }}
                disabled={running}
              >
                Bersihkan
              </button>
              {running ? <span className="spinner" /> : null}
            </div>
          </div>
        </Card>

        <Card
          title="📄 Hasil"
          subtitle="JSON lengkap beserta metadata provider, token, latensi, dan id artifact yang dibuat."
          actions={
            result ? (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(JSON.stringify(result.data, null, 2));
                  toast.ok('JSON disalin ke clipboard.');
                }}
              >
                Salin JSON
              </button>
            ) : null
          }
        >
          {error ? <ErrorBox error={error} /> : null}

          {running ? <Loading label="Menghubungi lapisan AI…" /> : null}

          {!running && !result && !error ? (
            <Empty
              icon="✨"
              title="Belum ada hasil"
              subtitle="Pilih task dan tekan Generate, atau pakai salah satu kartu Aksi Cepat di atas."
            />
          ) : null}

          {!running && result ? (
            <div className="stack">
              <div className="row row-wrap" style={{ gap: 6 }}>
                <Badge tone={result.ok ? 'ok' : 'err'}>{result.ok ? 'ok' : 'gagal'}</Badge>
                <Badge tone={result.meta.used_mock ? 'warn' : 'ok'}>
                  {result.meta.used_mock ? 'offline (mock)' : 'live'}
                </Badge>
                {result.meta.degraded ? <Badge tone="warn">degraded</Badge> : null}
                <Badge tone="muted">{result.meta.provider}/{result.meta.model}</Badge>
                <Badge tone="info">{fmtMs(result.meta.latency_ms)}</Badge>
                <Badge tone="muted">
                  {fmtNumber(result.meta.prompt_tokens)}↓ {fmtNumber(result.meta.completion_tokens)}↑ token
                </Badge>
              </div>

              {result.meta.degraded && result.error ? (
                <div className="alert alert-warn">
                  <span>⚠️</span>
                  <div>
                    <div className="strong">Provider gagal — hasil dari generator offline</div>
                    <div className="mute-sm">{result.error}</div>
                  </div>
                </div>
              ) : null}

              {result.error && !result.meta.degraded ? (
                <div className="alert alert-err">
                  <span>⛔</span>
                  <div>{result.error}</div>
                </div>
              ) : null}

              {createdIds && Object.values(createdIds).some((v) => v.length) ? (
                <div className="alert alert-ok">
                  <span>💾</span>
                  <div style={{ flex: 1 }}>
                    <div className="strong">Artifact tersimpan</div>
                    <div className="mute-sm">
                      {Object.entries(createdIds)
                        .filter(([, ids]) => ids.length)
                        .map(([kind, ids]) => `${kind}: ${ids.length}`)
                        .join(' · ')}
                    </div>
                    <div className="row row-wrap" style={{ gap: 6, marginTop: 6 }}>
                      {Object.entries(createdIds)
                        .filter(([kind, ids]) => ids.length && kind !== 'matrix_links' && kind !== 'test_steps')
                        .map(([kind, ids]) => (
                          <NavLink key={kind} className="btn btn-sm" to={pathForKind(kind)}>
                            Lihat {kind} ({ids.length})
                          </NavLink>
                        ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {persistSkipped?.length ? (
                <div className="alert alert-warn">
                  <span>ℹ️</span>
                  <div>
                    <div className="strong">Sebagian tidak disimpan</div>
                    <ul className="list-clean">
                      {persistSkipped.map((s, i) => (
                        <li key={i} className="mute-sm">
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}

              <div>
                <div className="label">Ringkasan</div>
                <div className="mute-sm">{summarise(result.data)}</div>
              </div>

              <pre className="pre" style={{ maxHeight: 460, overflow: 'auto' }}>
                {JSON.stringify(result.data, null, 2)}
              </pre>

              {result.meta.generation_id ? (
                <div className="mute-sm">
                  ID generasi: <span className="cell-mono">{result.meta.generation_id}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>

      {/* ---------------------------- history --------------------------- */}
      <div style={{ marginTop: 'var(--space-4)' }}>
        <Card
          title="🕘 Riwayat Generasi"
          subtitle="Setiap pemanggilan AI dicatat — termasuk kegagalan — sehingga dapat diaudit."
          actions={
            <button className="btn btn-ghost btn-sm" onClick={() => void loadHistory()} disabled={historyLoading}>
              🔄 Segarkan
            </button>
          }
        >
          {historyLoading ? (
            <Loading label="Memuat riwayat…" />
          ) : history.length === 0 ? (
            <Empty icon="🕘" title="Belum ada riwayat" subtitle="Jalankan satu task untuk mulai mencatat." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Task</th>
                    <th>Provider / Model</th>
                    <th style={{ textAlign: 'right' }}>Token ↓/↑</th>
                    <th style={{ textAlign: 'right' }}>Latensi</th>
                    <th>Status</th>
                    <th>Sumber</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id}>
                      <td className="cell-mono mute-sm">{new Date(row.created_at).toLocaleString('id-ID')}</td>
                      <td>
                        <span className="strong">{row.task}</span>
                      </td>
                      <td className="mute-sm">
                        {row.provider} / {row.model}
                      </td>
                      <td className="cell-mono" style={{ textAlign: 'right' }}>
                        {fmtNumber(row.prompt_tokens)} / {fmtNumber(row.completion_tokens)}
                      </td>
                      <td className="cell-mono" style={{ textAlign: 'right' }}>
                        {fmtMs(row.latency_ms)}
                      </td>
                      <td>
                        <Badge tone={row.status === 'success' ? 'ok' : 'err'}>{row.status}</Badge>
                      </td>
                      <td>
                        {row.used_mock ? <Badge tone="warn">offline</Badge> : <Badge tone="ok">live</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* --------------------------- reference -------------------------- */}
      <div style={{ marginTop: 'var(--space-4)' }}>
        <Card title="📚 Katalog Task AI" subtitle="Daftar beku AI_TASKS — setiap entri memiliki generator offline.">
          <div className="grid grid-auto">
            {AI_TASKS.map((task) => (
              <button
                key={task}
                className={`chip ${selected === task ? 'chip-active' : ''}`}
                onClick={() => {
                  setSelected(task);
                  setInputText({});
                  setResult(null);
                }}
                style={{ cursor: 'pointer' }}
              >
                {task}
              </button>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

/** Maps a created-artifact kind to the page that displays it. */
function pathForKind(kind: string): string {
  switch (kind) {
    case 'use_cases':
      return '/usecases';
    case 'scenarios':
      return '/scenarios';
    case 'test_cases':
      return '/testcases';
    case 'requirements':
      return '/requirements';
    case 'api_requests':
      return '/api-tester';
    case 'db_checks':
      return '/db-tester';
    case 'web_flows':
      return '/web-tester';
    default:
      return '/matrix';
  }
}

/** Metadata badge used by the summary strip (kept for API symmetry with sibling lanes). */
export const AI_STUDIO_META = {
  emoji: '✨',
  labels: { live: '🟢 Live', offline: '🟡 Offline' },
  priorities: PRIORITY_LABEL,
  severities: SEVERITY_LABEL,
} as const;

void ApiError;
