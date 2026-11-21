/**
 * RunsPage — lifecycle stage 8 (eksekusi).
 *
 * Run list + create, run detail with per-case results, manual pass/fail/blocked recording,
 * and an "Execute" button that drives the automation engines through lane-auto's executeService.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RUN_STATUSES,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  ENGINE_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  type Environment,
  type ExecEngine,
  type RunStatus,
  type TestCase,
  type TestRun,
} from '@qatools/shared';
import { api, listOf } from '../../lib/api';
import { useProject } from '../../lib/project';
import { toast } from '../../lib/toast';
import {
  PageHeader,
  Card,
  Badge,
  Progress,
  Loading,
  ErrorBox,
  Empty,
  Modal,
  Field,
  Tabs,
  fmtDateTime,
  fmtDuration,
  pctLabel,
} from '../../components';

interface RunResultRow {
  id: string;
  run_id: string;
  test_case_id: string;
  status: RunStatus;
  engine: string;
  duration_ms: number;
  actual_result: string | null;
  error_message: string | null;
  evidence: string | null;
  executed_by: string | null;
  executed_at: string | null;
  defect_id: string | null;
  tc_code: string;
  tc_title: string;
  tc_priority: string;
  tc_type: string;
  tc_layer: string;
  defect_code: string | null;
}

interface RunDetail extends TestRun {
  results: RunResultRow[];
  environment: { id: string; name: string; kind: string; base_url: string | null } | null;
  sprint: { id: string; code: string; name: string } | null;
  cycle: { id: string; code: string; name: string } | null;
}

const ENGINES: ExecEngine[] = ['manual', 'db', 'api', 'web', 'ai'];
const KINDS = ['manual', 'automation', 'regression', 'smoke', 'ai'] as const;

export default function RunsPage() {
  const { projectId } = useProject();

  const [runs, setRuns] = useState<TestRun[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [detail, setDetail] = useState<RunDetail | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'latest' | 'all'>('all');
  const [kindFilter, setKindFilter] = useState('');

  const [createModal, setCreateModal] = useState(false);
  const [executeModal, setExecuteModal] = useState(false);
  const [resultModal, setResultModal] = useState<RunResultRow | null>(null);
  const [executeCaseRow, setExecuteCaseRow] = useState<RunResultRow | null>(null);

  const [form, setForm] = useState({
    name: '',
    kind: 'manual',
    engine: 'manual',
    environment_id: '',
    executed_by: '',
    notes: '',
    test_case_ids: [] as string[],
  });
  const [execForm, setExecForm] = useState({
    engine: 'api' as ExecEngine,
    environment_id: '',
    dry_run: false,
    ai_assist: false,
    caseIds: [] as string[],
  });
  const [resultForm, setResultForm] = useState({
    status: 'passed' as RunStatus,
    actual_result: '',
    error_message: '',
    duration_ms: 180000,
    executed_by: '',
  });

  /* --------------------------------- load -------------------------------- */

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [r, e, t] = await Promise.all([
        listOf<TestRun>(`/projects/${projectId}/runs`, { limit: 200 }),
        listOf<Environment>(`/projects/${projectId}/environments`).catch(() => []),
        listOf<TestCase>('/testcases', { limit: 2000 }).catch(() => []),
      ]);
      setRuns(r);
      setEnvironments(e);
      setTestCases(t);
      const def = e.find((x) => x.is_default) ?? e[0];
      setForm((f) => ({ ...f, environment_id: f.environment_id || def?.id || '' }));
      setExecForm((f) => ({ ...f, environment_id: f.environment_id || def?.id || '' }));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = useCallback(async (runId: string) => {
    try {
      const res = await api.get<{ data: RunDetail }>(`/runs/${runId}`);
      setDetail(res.data);
    } catch (err) {
      toast.fromError(err, 'Gagal memuat detail run');
    }
  }, []);

  const refreshDetail = useCallback(async () => {
    if (detail) await openDetail(detail.id);
  }, [detail, openDetail]);

  /* -------------------------------- actions ------------------------------ */

  async function createRun() {
    if (!projectId) return;
    setBusy(true);
    try {
      const res = await api.post<{ data: RunDetail }>(`/projects/${projectId}/runs`, {
        name: form.name.trim() || `Run ${form.kind} ${new Date().toISOString().slice(0, 10)}`,
        kind: form.kind,
        engine: form.engine,
        environment_id: form.environment_id || null,
        executed_by: form.executed_by.trim() || null,
        notes: form.notes.trim() || null,
        test_case_ids: form.test_case_ids,
      });
      toast.ok(`Run ${res.data.code} dibuat`);
      setCreateModal(false);
      setForm({ ...form, name: '', notes: '', test_case_ids: [] });
      await load();
      await openDetail(res.data.id);
    } catch (err) {
      toast.fromError(err, 'Gagal membuat run');
    } finally {
      setBusy(false);
    }
  }

  async function saveResult() {
    if (!detail || !resultModal) return;
    setBusy(true);
    try {
      await api.patch(`/run-results/${resultModal.id}`, {
        status: resultForm.status,
        actual_result: resultForm.actual_result.trim() || null,
        error_message: resultForm.error_message.trim() || null,
        duration_ms: Number(resultForm.duration_ms) || 0,
        executed_by: resultForm.executed_by.trim() || null,
      });
      toast.ok(`Hasil ${resultModal.tc_code} disimpan`);
      setResultModal(null);
      await refreshDetail();
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal menyimpan hasil');
    } finally {
      setBusy(false);
    }
  }

  /** One-click manual verdict from the results table. */
  async function quickRecord(row: RunResultRow, status: RunStatus) {
    if (!detail) return;
    try {
      await api.post(`/runs/${detail.id}/results`, {
        test_case_id: row.test_case_id,
        status,
        duration_ms: row.duration_ms || 180000,
      });
      toast.ok(`${row.tc_code} → ${RUN_STATUS_LABEL[status]}`);
      await refreshDetail();
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal mencatat hasil');
    }
  }

  async function completeRun() {
    if (!detail) return;
    setBusy(true);
    try {
      await api.post(`/runs/${detail.id}/complete`, {});
      toast.ok('Run diselesaikan');
      await refreshDetail();
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal menyelesaikan run');
    } finally {
      setBusy(false);
    }
  }

  async function executeSuite() {
    if (!detail) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        engine: execForm.engine,
        environment_id: execForm.environment_id || null,
        dry_run: execForm.dry_run,
        ai_assist: execForm.ai_assist,
      };
      if (execForm.caseIds.length) payload.test_case_ids = execForm.caseIds;

      const res = await api.post<{ data: { suite: { total: number; passed: number; failed: number } } }>(
        `/runs/${detail.id}/execute`,
        payload,
      );
      toast.ok(`Eksekusi selesai: ${res.data.suite.passed}/${res.data.suite.total} lulus`);
      setExecuteModal(false);
      await refreshDetail();
      await load();
    } catch (err) {
      // A 503 engine_unavailable is the expected state while lane-auto has not landed.
      toast.fromError(err, 'Eksekusi gagal');
    } finally {
      setBusy(false);
    }
  }

  async function executeSingleCase() {
    if (!detail || !executeCaseRow) return;
    setBusy(true);
    try {
      await api.post(`/runs/${detail.id}/execute-case`, {
        test_case_id: executeCaseRow.test_case_id,
        engine: execForm.engine,
        environment_id: execForm.environment_id || null,
      });
      toast.ok(`${executeCaseRow.tc_code} dieksekusi`);
      setExecuteCaseRow(null);
      await refreshDetail();
      await load();
    } catch (err) {
      toast.fromError(err, 'Eksekusi gagal');
    } finally {
      setBusy(false);
    }
  }

  async function promoteToDefect(row: RunResultRow) {
    try {
      const res = await api.post<{ data: { defect: { code: string } } }>(
        `/defects/${row.id}/promote-from-result`,
        { run_result_id: row.id },
      );
      toast.ok(`Defect ${res.data.defect.code} dibuat`);
      await refreshDetail();
    } catch (err) {
      toast.fromError(err, 'Gagal membuat defect');
    }
  }

  async function deleteRun(id: string) {
    try {
      await api.del(`/runs/${id}`);
      toast.ok('Run dihapus');
      if (detail?.id === id) setDetail(null);
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal menghapus run');
    }
  }

  /* -------------------------------- derived ------------------------------ */

  const visibleRuns = useMemo(() => {
    let list = runs;
    if (kindFilter) list = list.filter((r) => r.kind === kindFilter);
    if (tab === 'latest') list = list.slice(0, 8);
    return list;
  }, [runs, kindFilter, tab]);

  const runStats = useMemo(() => {
    const total = runs.reduce((s, r) => s + r.total, 0);
    const passed = runs.reduce((s, r) => s + r.passed, 0);
    const failed = runs.reduce((s, r) => s + r.failed, 0);
    const blocked = runs.reduce((s, r) => s + r.blocked, 0);
    return { total, passed, failed, blocked, rate: total ? (passed / total) * 100 : 0 };
  }, [runs]);

  const scopedCases = detail?.results ?? [];
  const progress = detail && detail.total ? (detail.passed / detail.total) * 100 : 0;
  const recorded = scopedCases.filter((r) => r.status !== 'not_run').length;

  if (!projectId) return <Empty icon="📁" title="Belum ada project" />;
  if (loading && !runs.length) return <Loading label="Memuat test run…" />;
  if (error && !runs.length) return <ErrorBox error={error} onRetry={() => void load()} />;

  return (
    <>
      <PageHeader
        title="Test Runs"
        subtitle="Langkah 8 — catat hasil eksekusi manual atau jalankan mesin otomasi, lalu roll-up otomatis ke total run."
        actions={
          <>
            <button className="btn btn-sm" onClick={() => void load()}>
              ⟳ Muat ulang
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setCreateModal(true)}>
              + Run Baru
            </button>
          </>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="stat">
          <span className="stat-label">Total Run</span>
          <span className="stat-value">{runs.length}</span>
          <span className="stat-delta">{runStats.total} test case dieksekusi</span>
        </div>
        <div className="stat stat-ok">
          <span className="stat-label">Pass Rate</span>
          <span className="stat-value">{pctLabel(runStats.rate)}</span>
          <span className="stat-delta">{runStats.passed} lulus</span>
        </div>
        <div className="stat stat-err">
          <span className="stat-label">Gagal</span>
          <span className="stat-value">{runStats.failed}</span>
          <span className="stat-delta">perlu defect</span>
        </div>
        <div className="stat stat-warn">
          <span className="stat-label">Terblokir</span>
          <span className="stat-value">{runStats.blocked}</span>
          <span className="stat-delta">belum terverifikasi</span>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 'var(--space-4)', gap: 'var(--space-3)' }}>
        <Tabs
          tabs={[
            { id: 'all', label: `Semua (${runs.length})` },
            { id: 'latest', label: 'Terbaru' },
          ]}
          active={tab}
          onChange={setTab}
        />
        <span className="spacer" />
        <select className="select input-sm" style={{ maxWidth: 180 }} value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
          <option value="">Semua jenis</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      <div className="grid" style={{ gridTemplateColumns: detail ? 'minmax(320px, 420px) 1fr' : '1fr', alignItems: 'start' }}>
        {/* ------------------------------ run list --------------------------- */}
        <Card title="Daftar Run" subtitle={`${visibleRuns.length} run ditampilkan`}>
          {!visibleRuns.length ? (
            <Empty
              icon="▶️"
              title="Belum ada run"
              subtitle="Buat run pertama untuk mulai mencatat hasil eksekusi."
              action={
                <button className="btn btn-primary btn-sm" onClick={() => setCreateModal(true)}>
                  + Run Baru
                </button>
              }
            />
          ) : (
            <div className="stack stack-sm" style={{ maxHeight: 640, overflowY: 'auto' }}>
              {visibleRuns.map((r) => {
                const rate = r.total ? (r.passed / r.total) * 100 : 0;
                const selected = detail?.id === r.id;
                return (
                  <div
                    key={r.id}
                    className="card card-hover"
                    style={{ padding: 'var(--space-3)', borderColor: selected ? 'var(--accent)' : undefined }}
                    onClick={() => void openDetail(r.id)}
                  >
                    <div className="row-between">
                      <div className="row" style={{ gap: 'var(--space-2)' }}>
                        <span className="cell-mono">{r.code}</span>
                        <Badge tone={r.kind === 'regression' ? 'accent' : 'info'}>{r.kind}</Badge>
                      </div>
                      <Badge tone={r.status === 'completed' ? 'ok' : r.status === 'aborted' ? 'err' : 'warn'}>
                        {r.status}
                      </Badge>
                    </div>
                    <div className="strong truncate" style={{ marginTop: 4, fontSize: 13 }}>
                      {r.name}
                    </div>
                    <div className="row" style={{ gap: 'var(--space-2)', marginTop: 6 }}>
                      <Progress value={rate} tone={rate >= 90 ? 'ok' : rate >= 70 ? 'warn' : 'err'} />
                      <span className="mute-sm" style={{ whiteSpace: 'nowrap' }}>
                        {r.passed}/{r.total}
                      </span>
                    </div>
                    <div className="mute-sm" style={{ marginTop: 4, fontSize: 11 }}>
                      {ENGINE_LABEL[r.engine]} · {fmtDateTime(r.started_at ?? r.created_at)}
                      {r.executed_by ? ` · ${r.executed_by}` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* ----------------------------- run detail -------------------------- */}
        {detail ? (
          <div className="stack">
            <Card
              title={
                <span className="row" style={{ gap: 'var(--space-2)' }}>
                  <span className="cell-mono">{detail.code}</span>
                  <span>{detail.name}</span>
                </span>
              }
              subtitle={`${detail.kind} · ${ENGINE_LABEL[detail.engine]} · dibuat ${fmtDateTime(detail.created_at)}`}
              actions={
                <>
                  <button className="btn btn-sm" onClick={() => setExecuteModal(true)}>
                    ▶️ Execute
                  </button>
                  {detail.status !== 'completed' ? (
                    <button className="btn btn-ok btn-sm" onClick={() => void completeRun()} disabled={busy}>
                      ✓ Selesaikan
                    </button>
                  ) : null}
                  <button className="btn btn-danger btn-sm" onClick={() => void deleteRun(detail.id)}>
                    Hapus
                  </button>
                </>
              }
            >
              <div className="grid grid-4" style={{ marginBottom: 'var(--space-3)' }}>
                <div className="stat">
                  <span className="stat-label">Total</span>
                  <span className="stat-value">{detail.total}</span>
                </div>
                <div className="stat stat-ok">
                  <span className="stat-label">Lulus</span>
                  <span className="stat-value">{detail.passed}</span>
                </div>
                <div className="stat stat-err">
                  <span className="stat-label">Gagal</span>
                  <span className="stat-value">{detail.failed}</span>
                </div>
                <div className="stat stat-warn">
                  <span className="stat-label">Blokir / Lewat</span>
                  <span className="stat-value">
                    {detail.blocked}/{detail.skipped}
                  </span>
                </div>
              </div>

              <Progress value={progress} tone={progress >= 90 ? 'ok' : progress >= 70 ? 'warn' : 'err'} large />
              <div className="row-between mute-sm" style={{ marginTop: 6 }}>
                <span>
                  {recorded}/{scopedCases.length} test case sudah punya hasil
                </span>
                <span>Durasi total {fmtDuration(detail.duration_ms)}</span>
              </div>

              <div className="divider" />
              <div className="kv">
                <span className="kv-key">Environment</span>
                <span>
                  {detail.environment ? `${detail.environment.name} (${detail.environment.kind})` : '— belum dipilih —'}
                </span>
                <span className="kv-key">Cycle / Sprint</span>
                <span>
                  {detail.cycle?.code ?? '—'} / {detail.sprint?.code ?? '—'}
                </span>
                <span className="kv-key">Eksekutor</span>
                <span>{detail.executed_by ?? '—'}</span>
                <span className="kv-key">Mulai / Selesai</span>
                <span>
                  {fmtDateTime(detail.started_at)} → {fmtDateTime(detail.finished_at)}
                </span>
                {detail.notes ? (
                  <>
                    <span className="kv-key">Catatan</span>
                    <span>{detail.notes}</span>
                  </>
                ) : null}
              </div>
            </Card>

            <Card
              title="Hasil per Test Case"
              subtitle="Klik Lulus / Gagal / Blokir untuk mencatat hasil manual, atau ▶️ untuk menjalankan mesin otomasi pada satu kasus."
            >
              {!scopedCases.length ? (
                <Empty
                  icon="🧪"
                  title="Run ini belum punya test case"
                  subtitle="Tambahkan test case saat membuat run, atau jalankan Execute untuk memilih kasus."
                  action={
                    <button className="btn btn-primary btn-sm" onClick={() => setExecuteModal(true)}>
                      ▶️ Pilih & Eksekusi
                    </button>
                  }
                />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Test Case</th>
                        <th>Prioritas</th>
                        <th>Status</th>
                        <th>Engine</th>
                        <th>Durasi</th>
                        <th>Catatan</th>
                        <th className="cell-actions">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scopedCases.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <div className="cell-mono">{row.tc_code}</div>
                            <div className="clamp-2" style={{ fontSize: 12 }}>
                              {row.tc_title}
                            </div>
                          </td>
                          <td>
                            <Badge tone={PRIORITY_TONE[row.tc_priority as 'low'] ?? 'muted'}>
                              {PRIORITY_LABEL[row.tc_priority as 'low'] ?? row.tc_priority}
                            </Badge>
                          </td>
                          <td>
                            <Badge tone={RUN_STATUS_TONE[row.status]}>{RUN_STATUS_LABEL[row.status]}</Badge>
                            {row.defect_code ? (
                              <div style={{ marginTop: 3 }}>
                                <Badge tone="err">🐞 {row.defect_code}</Badge>
                              </div>
                            ) : null}
                          </td>
                          <td className="mute-sm">{row.engine}</td>
                          <td className="mute-sm">{row.duration_ms ? fmtDuration(row.duration_ms) : '—'}</td>
                          <td className="mute-sm clamp-2" style={{ maxWidth: 190 }}>
                            {row.error_message ?? row.actual_result ?? '—'}
                          </td>
                          <td className="cell-actions">
                            <div className="row" style={{ gap: 3, justifyContent: 'flex-end' }}>
                              <button
                                className="btn btn-ok btn-sm"
                                title="Tandai lulus"
                                onClick={() => void quickRecord(row, 'passed')}
                              >
                                ✓
                              </button>
                              <button
                                className="btn btn-danger btn-sm"
                                title="Tandai gagal"
                                onClick={() => void quickRecord(row, 'failed')}
                              >
                                ✕
                              </button>
                              <button
                                className="btn btn-sm"
                                title="Tandai terblokir"
                                onClick={() => void quickRecord(row, 'blocked')}
                              >
                                ⛔
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                title="Catat hasil detail"
                                onClick={() => {
                                  setResultModal(row);
                                  setResultForm({
                                    status: row.status,
                                    actual_result: row.actual_result ?? '',
                                    error_message: row.error_message ?? '',
                                    duration_ms: row.duration_ms || 180000,
                                    executed_by: row.executed_by ?? '',
                                  });
                                }}
                              >
                                📝
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                title="Jalankan mesin otomasi untuk kasus ini"
                                onClick={() => setExecuteCaseRow(row)}
                              >
                                ▶️
                              </button>
                              {row.status === 'failed' && !row.defect_id ? (
                                <button
                                  className="btn btn-sm"
                                  title="Buat defect dari hasil ini"
                                  onClick={() => void promoteToDefect(row)}
                                >
                                  🐞
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        ) : null}
      </div>

      {/* ------------------------------- modals ------------------------------- */}
      {createModal ? (
        <Modal
          title="Buat Test Run"
          onClose={() => setCreateModal(false)}
          size="lg"
          footer={
            <>
              <span className="mute-sm">{form.test_case_ids.length} test case dipilih</span>
              <span className="spacer" />
              <button className="btn" onClick={() => setCreateModal(false)} disabled={busy}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={() => void createRun()} disabled={busy}>
                {busy ? 'Membuat…' : 'Buat Run'}
              </button>
            </>
          }
        >
          <div className="grid grid-2">
            <Field label="Nama run">
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="mis. Smoke manual 21 Nov"
              />
            </Field>
            <Field label="Jenis">
              <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Engine">
              <select className="select" value={form.engine} onChange={(e) => setForm({ ...form, engine: e.target.value })}>
                {ENGINES.map((k) => (
                  <option key={k} value={k}>
                    {ENGINE_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Environment">
              <select
                className="select"
                value={form.environment_id}
                onChange={(e) => setForm({ ...form, environment_id: e.target.value })}
              >
                <option value="">— tidak dipilih —</option>
                {environments.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.kind}){e.is_default ? ' · default' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Eksekutor">
              <input
                className="input"
                value={form.executed_by}
                onChange={(e) => setForm({ ...form, executed_by: e.target.value })}
                placeholder="nama tester"
              />
            </Field>
            <Field label="Catatan">
              <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>

          <div className="divider" />
          <div className="row-between" style={{ marginBottom: 'var(--space-2)' }}>
            <span className="label">Pilih test case untuk run ini</span>
            <div className="row" style={{ gap: 'var(--space-2)' }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setForm({ ...form, test_case_ids: testCases.map((t) => t.id) })}
              >
                Pilih semua
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, test_case_ids: [] })}>
                Kosongkan
              </button>
            </div>
          </div>
          <div className="table-wrap" style={{ maxHeight: 300 }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 40 }} />
                  <th>Kode</th>
                  <th>Judul</th>
                  <th>Prioritas</th>
                  <th>Estimasi</th>
                </tr>
              </thead>
              <tbody>
                {testCases.slice(0, 400).map((t) => {
                  const checked = form.test_case_ids.includes(t.id);
                  return (
                    <tr
                      key={t.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() =>
                        setForm({
                          ...form,
                          test_case_ids: checked
                            ? form.test_case_ids.filter((x) => x !== t.id)
                            : [...form.test_case_ids, t.id],
                        })
                      }
                    >
                      <td>
                        <input className="checkbox" type="checkbox" checked={checked} readOnly />
                      </td>
                      <td className="cell-mono">{t.code}</td>
                      <td>{t.title}</td>
                      <td>
                        <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
                      </td>
                      <td className="mute-sm">{t.estimated_minutes} m</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Modal>
      ) : null}

      {executeModal && detail ? (
        <Modal
          title={`Jalankan Suite — ${detail.code}`}
          onClose={() => setExecuteModal(false)}
          footer={
            <>
              <span className="mute-sm">
                {execForm.caseIds.length ? `${execForm.caseIds.length} test case dipilih` : 'Semua test case di run ini'}
              </span>
              <span className="spacer" />
              <button className="btn" onClick={() => setExecuteModal(false)} disabled={busy}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={() => void executeSuite()} disabled={busy}>
                {busy ? 'Menjalankan…' : '▶️ Jalankan'}
              </button>
            </>
          }
        >
          <div className="alert alert-info" style={{ marginBottom: 'var(--space-3)' }}>
            <span>ℹ️</span>
            <span>
              Eksekusi otomasi didelegasikan ke modul <code>execute</code> (lane otomasi). Selama modul itu belum
              tersedia, API akan menjawab <code>503 engine_unavailable</code> dan pencatatan manual tetap bisa
              dilakukan.
            </span>
          </div>

          <div className="grid grid-2">
            <Field label="Engine">
              <select
                className="select"
                value={execForm.engine}
                onChange={(e) => setExecForm({ ...execForm, engine: e.target.value as ExecEngine })}
              >
                {ENGINES.map((k) => (
                  <option key={k} value={k}>
                    {ENGINE_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Environment">
              <select
                className="select"
                value={execForm.environment_id}
                onChange={(e) => setExecForm({ ...execForm, environment_id: e.target.value })}
              >
                <option value="">— pakai bawaan run —</option>
                {environments.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.kind})
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="row" style={{ gap: 'var(--space-4)', marginTop: 'var(--space-3)' }}>
            <label className="row" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
              <input
                className="checkbox"
                type="checkbox"
                checked={execForm.dry_run}
                onChange={(e) => setExecForm({ ...execForm, dry_run: e.target.checked })}
              />
              <span>Dry run (validasi tanpa menembak target)</span>
            </label>
            <label className="row" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
              <input
                className="checkbox"
                type="checkbox"
                checked={execForm.ai_assist}
                onChange={(e) => setExecForm({ ...execForm, ai_assist: e.target.checked })}
              />
              <span>Bantuan AI saat assertion tidak konklusif</span>
            </label>
          </div>

          <div className="divider" />
          <span className="label">Batasi ke test case tertentu (opsional)</span>
          <div className="stack stack-sm" style={{ maxHeight: 220, overflowY: 'auto', marginTop: 6 }}>
            {scopedCases.map((row) => {
              const checked = execForm.caseIds.includes(row.test_case_id);
              return (
                <label key={row.id} className="row" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
                  <input
                    className="checkbox"
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setExecForm({
                        ...execForm,
                        caseIds: checked
                          ? execForm.caseIds.filter((x) => x !== row.test_case_id)
                          : [...execForm.caseIds, row.test_case_id],
                      })
                    }
                  />
                  <span className="cell-mono">{row.tc_code}</span>
                  <span className="truncate" style={{ fontSize: 12.5 }}>
                    {row.tc_title}
                  </span>
                </label>
              );
            })}
          </div>
        </Modal>
      ) : null}

      {resultModal ? (
        <Modal
          title={`Catat Hasil — ${resultModal.tc_code}`}
          onClose={() => setResultModal(null)}
          footer={
            <>
              <button className="btn" onClick={() => setResultModal(null)} disabled={busy}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={() => void saveResult()} disabled={busy}>
                {busy ? 'Menyimpan…' : 'Simpan Hasil'}
              </button>
            </>
          }
        >
          <div className="stack">
            <div className="mute-sm">{resultModal.tc_title}</div>
            <Field label="Status">
              <select
                className="select"
                value={resultForm.status}
                onChange={(e) => setResultForm({ ...resultForm, status: e.target.value as RunStatus })}
              >
                {RUN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {RUN_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Hasil aktual">
              <textarea
                className="textarea"
                value={resultForm.actual_result}
                onChange={(e) => setResultForm({ ...resultForm, actual_result: e.target.value })}
                placeholder="Apa yang sebenarnya terjadi?"
              />
            </Field>
            {resultForm.status === 'failed' || resultForm.status === 'blocked' ? (
              <Field label="Pesan error">
                <input
                  className="input"
                  value={resultForm.error_message}
                  onChange={(e) => setResultForm({ ...resultForm, error_message: e.target.value })}
                  placeholder="mis. HTTP 500 pada POST /orders"
                />
              </Field>
            ) : null}
            <div className="grid grid-2">
              <Field label="Durasi (ms)" hint="Default 180000 ms = 3 menit untuk eksekusi manual.">
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={resultForm.duration_ms}
                  onChange={(e) => setResultForm({ ...resultForm, duration_ms: Number(e.target.value) })}
                />
              </Field>
              <Field label="Eksekutor">
                <input
                  className="input"
                  value={resultForm.executed_by}
                  onChange={(e) => setResultForm({ ...resultForm, executed_by: e.target.value })}
                />
              </Field>
            </div>
          </div>
        </Modal>
      ) : null}

      {executeCaseRow && detail ? (
        <Modal
          title={`Jalankan Satu Kasus — ${executeCaseRow.tc_code}`}
          onClose={() => setExecuteCaseRow(null)}
          size="sm"
          footer={
            <>
              <button className="btn" onClick={() => setExecuteCaseRow(null)} disabled={busy}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={() => void executeSingleCase()} disabled={busy}>
                {busy ? 'Menjalankan…' : '▶️ Jalankan'}
              </button>
            </>
          }
        >
          <div className="mute-sm" style={{ marginBottom: 'var(--space-3)' }}>
            {executeCaseRow.tc_title}
          </div>
          <Field label="Engine">
            <select
              className="select"
              value={execForm.engine}
              onChange={(e) => setExecForm({ ...execForm, engine: e.target.value as ExecEngine })}
            >
              {ENGINES.map((k) => (
                <option key={k} value={k}>
                  {ENGINE_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        </Modal>
      ) : null}
    </>
  );
}
