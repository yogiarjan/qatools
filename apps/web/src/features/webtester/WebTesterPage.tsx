/**
 * Web Automation — flow editor, element picker and per-step run timeline.
 *
 * Route: /web-tester  (registered by the Lead in App.tsx)
 *
 * The engine-mode banner is deliberately blunt: HTTP mode performs REAL page
 * fetching + HTML verification but is NOT a browser, and the UI says so.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { RunStatus, WebFlow, WebStep, WebStepAction } from '@qatools/shared';
import { RUN_STATUS_LABEL, RUN_STATUS_TONE } from '@qatools/shared';
import { api, ApiError } from '../../lib/api';
import { toast } from '../../lib/toast';
import { useProject } from '../../lib/project';
import {
  Badge,
  Card,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  fmtDuration,
  fmtDateTime,
} from '../../components';
import '../automation.css';

/* --------------------------------- types ---------------------------------- */

const ACTIONS: WebStepAction[] = [
  'goto',
  'click',
  'fill',
  'select',
  'check',
  'uncheck',
  'press',
  'wait',
  'assert_text',
  'assert_visible',
  'assert_url',
  'screenshot',
  'hover',
  'scroll',
];

/** Which field a given action actually uses — keeps the editor uncluttered. */
const ACTION_FIELDS: Record<WebStepAction, { selector: boolean; value: boolean; expected: boolean }> = {
  goto: { selector: false, value: true, expected: false },
  click: { selector: true, value: false, expected: false },
  fill: { selector: true, value: true, expected: false },
  select: { selector: true, value: true, expected: false },
  check: { selector: true, value: false, expected: false },
  uncheck: { selector: true, value: false, expected: false },
  press: { selector: true, value: true, expected: false },
  wait: { selector: false, value: true, expected: false },
  assert_text: { selector: true, value: false, expected: true },
  assert_visible: { selector: true, value: false, expected: false },
  assert_url: { selector: false, value: false, expected: true },
  screenshot: { selector: false, value: false, expected: false },
  hover: { selector: true, value: false, expected: false },
  scroll: { selector: true, value: false, expected: false },
};

interface WebMode {
  mode: 'http' | 'playwright';
  available: boolean;
  reason: string;
  version?: string | null;
}

interface WebRunOutcome {
  status: RunStatus;
  mode: 'http' | 'playwright';
  mode_reason: string;
  duration_ms: number;
  error: string | null;
  logs: Array<{ index: number; action: string; status: string; message: string; duration_ms: number; observed?: unknown }>;
  evidence: Record<string, unknown>;
}

interface RecordHint {
  url: string;
  fetched: boolean;
  status: number | null;
  title: string;
  suggested_steps: WebStep[];
  elements: Array<{ tag: string; text: string; selector: string; candidates: string[] }>;
  forms: Array<{ action: string; method: string }>;
  tables: Array<{ headers: string[]; rowCount: number }>;
  message: string;
}

/* ------------------------------- component -------------------------------- */

export default function WebTesterPage() {
  const { projectId } = useProject();

  const [flows, setFlows] = useState<WebFlow[]>([]);
  const [activeFlow, setActiveFlow] = useState<WebFlow | null>(null);
  const [modes, setModes] = useState<WebMode[]>([]);
  const [activeMode, setActiveMode] = useState<'http' | 'playwright'>('http');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  /* editor */
  const [name, setName] = useState('Flow Baru');
  const [startUrl, setStartUrl] = useState('');
  const [steps, setSteps] = useState<WebStep[]>([{ action: 'goto', value: '' }]);

  const [outcome, setOutcome] = useState<WebRunOutcome | null>(null);
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /* record hint */
  const [showHint, setShowHint] = useState(false);
  const [hintUrl, setHintUrl] = useState('');
  const [hint, setHint] = useState<RecordHint | null>(null);
  const [hintLoading, setHintLoading] = useState(false);

  /* ------------------------------ loaders ----------------------------- */

  const loadModes = useCallback(async () => {
    try {
      const res = await api.get<{ data: { active_mode: 'http' | 'playwright'; modes: WebMode[] } }>('/web-modes');
      setModes(res.data.modes ?? []);
      setActiveMode(res.data.active_mode);
    } catch {
      setModes([]);
    }
  }, []);

  const loadFlows = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: WebFlow[] }>(`/projects/${projectId}/web-flows`);
      setFlows(res.data ?? []);
      setActiveFlow((current) => {
        if (current && res.data?.some((f) => f.id === current.id)) return current;
        return null;
      });
    } catch (err) {
      setError(err);
      setFlows([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadModes();
    void loadFlows();
  }, [loadModes, loadFlows]);

  const openFlow = (flow: WebFlow) => {
    setActiveFlow(flow);
    setName(flow.name);
    setStartUrl(flow.start_url ?? '');
    try {
      const parsed = JSON.parse(flow.steps) as unknown;
      setSteps(Array.isArray(parsed) && parsed.length ? (parsed as WebStep[]) : [{ action: 'goto', value: '' }]);
    } catch {
      setSteps([{ action: 'goto', value: '' }]);
    }
    setOutcome(null);
    setProblem(null);
  };

  const newFlow = () => {
    setActiveFlow(null);
    setName('Flow Baru');
    setStartUrl('');
    setSteps([{ action: 'goto', value: '' }]);
    setOutcome(null);
    setProblem(null);
  };

  /* ------------------------------ actions ----------------------------- */

  const saveFlow = async (): Promise<string | null> => {
    if (!projectId) return null;
    if (!steps.length) {
      toast.warn('Flow harus punya minimal satu langkah.');
      return null;
    }
    const payload = { name: name || 'Flow Baru', start_url: startUrl || null, steps };
    try {
      if (activeFlow) {
        const res = await api.patch<{ data: WebFlow }>(`/web-flows/${activeFlow.id}`, payload);
        setActiveFlow(res.data);
        toast.ok('Flow tersimpan.');
        await loadFlows();
        return res.data.id;
      }
      const res = await api.post<{ data: WebFlow }>(`/projects/${projectId}/web-flows`, payload);
      setActiveFlow(res.data);
      toast.ok('Flow dibuat.');
      await loadFlows();
      return res.data.id;
    } catch (err) {
      toast.fromError(err, 'Gagal menyimpan flow');
      return null;
    }
  };

  const runFlow = async (dryRun = false) => {
    setRunning(true);
    setProblem(null);
    setOutcome(null);
    try {
      const id = await saveFlow();
      if (!id) return;
      const res = await api.post<{ data: WebRunOutcome }>(`/web-flows/${id}/run`, { dry_run: dryRun });
      setOutcome(res.data);
      const tone = res.data.status === 'passed' ? 'ok' : res.data.status === 'skipped' ? 'info' : 'err';
      toast[tone](
        `${dryRun ? 'Dry-run' : 'Run'} selesai: ${res.data.status} (mode: ${res.data.mode}).`,
      );
      await loadFlows();
    } catch (err) {
      if (err instanceof ApiError) {
        setProblem(err.message);
        toast.err(err.message);
      } else {
        toast.fromError(err, 'Gagal menjalankan flow');
      }
    } finally {
      setRunning(false);
    }
  };

  const deleteFlow = async () => {
    if (!activeFlow) return;
    try {
      await api.del(`/web-flows/${activeFlow.id}`);
      toast.ok('Flow dihapus.');
      newFlow();
      await loadFlows();
    } catch (err) {
      toast.fromError(err, 'Gagal menghapus flow');
    }
  };

  const fetchHint = async () => {
    const url = hintUrl || startUrl;
    if (!url.trim()) {
      toast.warn('Isi URL terlebih dahulu.');
      return;
    }
    setHintLoading(true);
    setHint(null);
    try {
      const res = await api.post<{ data: RecordHint }>('/web-flows/record-hint', { url });
      setHint(res.data);
      toast[res.data.fetched ? 'ok' : 'warn'](res.data.message);
    } catch (err) {
      toast.fromError(err, 'Gagal mengambil elemen');
    } finally {
      setHintLoading(false);
    }
  };

  /* --------------------------- step utilities ------------------------- */

  const updateStep = (i: number, patch: Partial<WebStep>) =>
    setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const addStep = (step?: WebStep) =>
    setSteps((prev) => [...prev, step ?? { action: 'assert_visible', selector: '' }]);

  const moveStep = (i: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const next = [...prev];
      const target = i + dir;
      if (target < 0 || target >= next.length) return prev;
      const a = next[i] as WebStep;
      const b = next[target] as WebStep;
      next[i] = b;
      next[target] = a;
      return next;
    });
  };

  /** Applies a suggested step from the record-hint panel. */
  const appendSuggested = (step: WebStep) => {
    setSteps((prev) => [...prev, step]);
    toast.ok(`Langkah "${step.action}" ditambahkan.`);
  };

  /** Replaces the whole flow with the suggestion set (after review). */
  const applyAllSuggestions = () => {
    if (!hint) return;
    setSteps(hint.suggested_steps.map((s) => ({ ...s })));
    if (!startUrl && hint.url) setStartUrl(hint.url);
    setShowHint(false);
    toast.ok(`${hint.suggested_steps.length} langkah saran diterapkan. Tinjau dan simpan.`);
  };

  const playwrightMode = useMemo(() => modes.find((m) => m.mode === 'playwright') ?? null, [modes]);

  /* ------------------------------- render ----------------------------- */

  if (!projectId) return <Empty icon="📁" title="Pilih project terlebih dahulu" />;

  return (
    <>
      <PageHeader
        title="Web Automation"
        subtitle="Susun alur langkah, ambil kandidat selector dari halaman nyata, lalu jalankan dan tinjau log per langkah."
        actions={
          <>
            <button
              className="btn"
              onClick={() => {
                setHintUrl(startUrl);
                setShowHint(true);
              }}
            >
              🎯 Ambil Elemen
            </button>
            <button className="btn" onClick={() => void runFlow(true)} disabled={running}>
              Dry-run
            </button>
            <button className="btn btn-primary" onClick={() => void runFlow(false)} disabled={running}>
              {running ? 'Menjalankan…' : '▶ Jalankan Flow'}
            </button>
          </>
        }
      />

      {/* --------------------------- mode banner -------------------------- */}
      <div className={`web-banner ${activeMode === 'playwright' ? 'web-banner-browser' : 'web-banner-http'}`}>
        {activeMode === 'playwright' ? (
          <>
            <strong>Mode: Playwright (browser sungguhan)</strong> — paket Playwright terdeteksi
            {playwrightMode?.version ? ` (versi ${playwrightMode.version})` : ''}. Interaksi DOM nyata akan dijalankan.
          </>
        ) : (
          <>
            <strong>Mode: HTTP (bukan browser)</strong> — Playwright tidak terpasang, sehingga engine mengambil halaman
            dengan <span className="cell-mono">fetch</span>, mengurai HTML dengan parser internal, lalu memverifikasi
            teks/elemen/URL secara nyata. Aksi yang butuh DOM sungguhan (klik, isi form, screenshot) hanya
            diverifikasi keberadaannya dan ditandai jelas pada log. QATools tidak menyamar seolah browser dijalankan.
          </>
        )}
      </div>

      <div className="web-layout">
        {/* --------------------------- sidebar --------------------------- */}
        <div className="stack">
          <Card
            title={`Web Flows (${flows.length})`}
            actions={
              <button className="btn btn-sm" onClick={newFlow}>
                + Flow
              </button>
            }
          >
            {loading ? (
              <Loading />
            ) : error ? (
              <ErrorBox error={error} onRetry={() => void loadFlows()} />
            ) : !flows.length ? (
              <Empty icon="🌐" title="Belum ada flow" subtitle='Buat flow baru, atau tekan "Ambil Elemen" untuk memulai dari URL.' />
            ) : (
              <div className="api-sidebar-list stack stack-sm">
                {flows.map((f) => (
                  <button
                    key={f.id}
                    className={`api-item ${f.id === activeFlow?.id ? 'active' : ''}`}
                    onClick={() => openFlow(f)}
                  >
                    <div className="row-between">
                      <span className="api-item-name">{f.name}</span>
                      {f.last_status ? (
                        <Badge tone={RUN_STATUS_TONE[f.last_status as RunStatus] ?? 'muted'}>
                          {RUN_STATUS_LABEL[f.last_status as RunStatus] ?? f.last_status}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mute-sm truncate cell-mono">{f.start_url ?? '— tanpa start url —'}</div>
                    <div className="mute-sm">{f.last_run_at ? fmtDateTime(f.last_run_at) : 'belum dijalankan'}</div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card
            title={`Langkah (${steps.length})`}
            actions={
              <button className="btn btn-sm" onClick={() => addStep()}>
                + Langkah
              </button>
            }
          >
            <div className="stack stack-sm web-steps-list">
              {steps.map((s, i) => {
                const fields = ACTION_FIELDS[s.action] ?? { selector: true, value: true, expected: true };
                return (
                  <div className="web-step" key={i}>
                    <span className="web-step-index">{i + 1}</span>
                    <select
                      className="select input-sm"
                      value={s.action}
                      onChange={(e) => updateStep(i, { action: e.target.value as WebStepAction })}
                    >
                      {ACTIONS.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input input-sm"
                      placeholder="selector"
                      disabled={!fields.selector}
                      value={s.selector ?? ''}
                      onChange={(e) => updateStep(i, { selector: e.target.value })}
                    />
                    <input
                      className="input input-sm"
                      placeholder="value"
                      disabled={!fields.value}
                      value={s.value ?? ''}
                      onChange={(e) => updateStep(i, { value: e.target.value })}
                    />
                    <input
                      className="input input-sm"
                      placeholder="expected"
                      disabled={!fields.expected}
                      value={s.expected ?? ''}
                      onChange={(e) => updateStep(i, { expected: e.target.value })}
                    />
                    <div className="row" style={{ gap: 2 }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Naikkan"
                        onClick={() => moveStep(i, -1)}
                        disabled={i === 0}
                      >
                        ↑
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Turunkan"
                        onClick={() => moveStep(i, 1)}
                        disabled={i === steps.length - 1}
                      >
                        ↓
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Hapus"
                        onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card
            title="Detail Flow"
            actions={
              <div className="row">
                {activeFlow ? (
                  <button className="btn btn-danger btn-sm" onClick={() => void deleteFlow()}>
                    Hapus
                  </button>
                ) : null}
                <button className="btn btn-sm" onClick={() => void saveFlow()}>
                  💾 Simpan
                </button>
              </div>
            }
          >
            <div className="stack stack-sm">
              <Field label="Nama flow">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Start URL" hint="Contoh tanpa internet: http://127.0.0.1:5174/api/mock/health">
                <input
                  className="input cell-mono"
                  value={startUrl}
                  onChange={(e) => setStartUrl(e.target.value)}
                  placeholder="http://127.0.0.1:5174/api/mock/health"
                />
              </Field>
            </div>
          </Card>
        </div>

        {/* ---------------------------- results --------------------------- */}
        <div className="stack">
          {problem ? (
            <div className="alert alert-err">
              <span>🚫</span>
              <div>{problem}</div>
            </div>
          ) : null}

          <Card
            title="Timeline Eksekusi"
            actions={
              outcome ? (
                <div className="row">
                  <Badge tone={RUN_STATUS_TONE[outcome.status]}>{RUN_STATUS_LABEL[outcome.status]}</Badge>
                  <Badge tone={outcome.mode === 'playwright' ? 'ok' : 'warn'}>
                    mode: {outcome.mode}
                  </Badge>
                  <span className="chip">{fmtDuration(outcome.duration_ms)}</span>
                </div>
              ) : null
            }
          >
            {!outcome ? (
              <Empty
                icon="▶️"
                title="Belum dijalankan"
                subtitle='Tekan "Jalankan Flow" untuk mengeksekusi setiap langkah dan melihat hasilnya di sini.'
              />
            ) : (
              <>
                <div className="mute-sm rc-mb">{outcome.mode_reason}</div>

                <ol className="rc-timeline">
                  {outcome.logs.map((l, i) => (
                    <li key={i} className={`rc-timeline-item rc-${l.status}`}>
                      <span className="rc-timeline-dot" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row-between">
                          <span className="strong cell-mono">{l.action}</span>
                          <span className="mute-sm">{fmtDuration(l.duration_ms)}</span>
                        </div>
                        <div className="rc-log-msg">{l.message}</div>
                      </div>
                    </li>
                  ))}
                </ol>

                {outcome.error ? <div className="alert alert-err" style={{ marginTop: 'var(--space-3)' }}>{outcome.error}</div> : null}

                <h4 className="card-title" style={{ marginTop: 'var(--space-4)' }}>
                  Evidence
                </h4>
                <div className="kv">
                  <span className="kv-key">URL akhir</span>
                  <span className="cell-mono">{String(outcome.evidence.url ?? '—')}</span>
                  <span className="kv-key">Judul halaman</span>
                  <span>{String(outcome.evidence.page_title ?? '—')}</span>
                  <span className="kv-key">Mode</span>
                  <span>{String(outcome.evidence.mode_label ?? '—')}</span>
                  <span className="kv-key">Status HTTP</span>
                  <span className="cell-mono">{String(outcome.evidence.status_code ?? '—')}</span>
                  <span className="kv-key">Langkah</span>
                  <span>
                    {String(outcome.evidence.steps_passed ?? 0)} lulus · {String(outcome.evidence.steps_failed ?? 0)} gagal
                  </span>
                </div>

                {typeof outcome.evidence.text_sample === 'string' ? (
                  <pre className="pre" style={{ maxHeight: 200, marginTop: 'var(--space-3)' }}>
                    {outcome.evidence.text_sample}
                  </pre>
                ) : null}
              </>
            )}
          </Card>

          {activeFlow ? (
            <Card title="Hasil Run Terakhir" subtitle={`Flow ${activeFlow.name}`}>
              <div className="kv">
                <span className="kv-key">Status terakhir</span>
                <span>
                  {activeFlow.last_status ? (
                    <Badge tone={RUN_STATUS_TONE[activeFlow.last_status as RunStatus] ?? 'muted'}>
                      {RUN_STATUS_LABEL[activeFlow.last_status as RunStatus] ?? activeFlow.last_status}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </span>
                <span className="kv-key">Dijalankan pada</span>
                <span>{fmtDateTime(activeFlow.last_run_at)}</span>
                <span className="kv-key">ID flow</span>
                <span className="cell-mono">{activeFlow.id}</span>
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      {/* --------------------------- record hint ------------------------- */}
      {showHint ? (
        <Modal
          title="Ambil Elemen dari Halaman"
          onClose={() => setShowHint(false)}
          size="lg"
          footer={
            <>
              <button className="btn" onClick={() => setShowHint(false)}>
                Tutup
              </button>
              <button className="btn btn-primary" onClick={applyAllSuggestions} disabled={!hint?.fetched}>
                Terapkan semua saran
              </button>
            </>
          }
        >
          <div className="stack">
            <div className="alert alert-info">
              QATools mengambil halaman dan menyarankan langkah beserta kandidat selector dengan urutan prioritas{' '}
              <strong>id &gt; data-testid &gt; name &gt; aria-label &gt; text</strong>. Semua saran bersifat usulan —
              tinjau sebelum menyimpan.
            </div>

            <div className="row">
              <input
                className="input"
                placeholder="https://… atau http://127.0.0.1:5174/api/mock/health"
                value={hintUrl}
                onChange={(e) => setHintUrl(e.target.value)}
              />
              <button className="btn btn-primary" onClick={() => void fetchHint()} disabled={hintLoading}>
                {hintLoading ? 'Mengambil…' : 'Ambil'}
              </button>
            </div>

            {hintLoading ? <Loading label="Mengambil halaman…" /> : null}

            {hint ? (
              <>
                <div className={hint.fetched ? 'alert alert-ok' : 'alert alert-warn'}>{hint.message}</div>

                {hint.fetched ? (
                  <>
                    <div className="kv">
                      <span className="kv-key">URL</span>
                      <span className="cell-mono">{hint.url}</span>
                      <span className="kv-key">Judul</span>
                      <span>{hint.title || '—'}</span>
                      <span className="kv-key">Status</span>
                      <span className="cell-mono">{hint.status ?? '—'}</span>
                    </div>

                    <h4 className="card-title">Langkah yang disarankan ({hint.suggested_steps.length})</h4>
                    <div className="stack stack-sm">
                      {hint.suggested_steps.map((s, i) => (
                        <div className="row" key={i}>
                          <span className="web-step-index">{i + 1}</span>
                          <span className="chip">{s.action}</span>
                          <span className="cell-mono mute-sm truncate" style={{ flex: 1 }}>
                            {s.selector ?? s.value ?? s.expected ?? ''}
                          </span>
                          <button className="btn btn-sm" onClick={() => appendSuggested(s)}>
                            + Tambah
                          </button>
                        </div>
                      ))}
                    </div>

                    <h4 className="card-title" style={{ marginTop: 'var(--space-4)' }}>
                      Elemen terdeteksi ({hint.elements.length})
                    </h4>
                    <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                      {hint.elements.map((el, i) => (
                        <div
                          className="web-elem"
                          key={i}
                          onClick={() => {
                            appendSuggested({ action: 'assert_visible', selector: el.selector });
                          }}
                          title="Klik untuk menambahkan langkah assert_visible"
                        >
                          <div className="row-between">
                            <span className="chip">{el.tag}</span>
                            <span className="mute-sm truncate">{el.text || '—'}</span>
                          </div>
                          <div className="web-elem-selector">{el.selector}</div>
                          <div style={{ marginTop: 2 }}>
                            {el.candidates.slice(1, 4).map((c) => (
                              <span className="web-candidate" key={c}>
                                alternatif: {c}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
