/**
 * DefectsPage — lifecycle stage 9 (catat, triase, lacak defect).
 *
 * Defect table with severity/status badges and tones, filters, a detail modal
 * (steps to reproduce, expected/actual, linked test case + run result), status transition
 * buttons driven by the server's legal-transition guard, and an AI triage button.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFECT_STATUSES,
  DEFECT_STATUS_LABEL,
  DEFECT_STATUS_TONE,
  SEVERITIES,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  PRIORITIES,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  DEFECT_SOURCES,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  type Defect,
  type DefectStatus,
  type RunStatus,
  type TestCase,
} from '@qatools/shared';
import { api, listOf } from '../../lib/api';
import { useProject } from '../../lib/project';
import { toast } from '../../lib/toast';
import {
  PageHeader,
  Card,
  Badge,
  Loading,
  ErrorBox,
  Empty,
  Modal,
  Field,
  DataTable,
  fmtDate,
  fmtDateTime,
  type Column,
} from '../../components';

interface DefectRow extends Defect {
  tc_code: string | null;
  tc_title: string | null;
}

interface RunResultLink {
  id: string;
  run_id: string;
  test_case_id: string;
  status: RunStatus;
  engine: string;
  duration_ms: number;
  actual_result: string | null;
  error_message: string | null;
  evidence: string | null;
  executed_at: string | null;
}

interface DefectDetail extends DefectRow {
  test_case: { id: string; code: string; title: string } | null;
  run_result: RunResultLink | null;
  run: { id: string; code: string; name: string; kind: string } | null;
  environment: { id: string; name: string; kind: string } | null;
  sibling_defects: number;
  allowed_next: string[];
}

interface DefectStats {
  total: number;
  open: number;
  closed: number;
  by_severity: Record<string, number>;
  by_status: Record<string, number>;
  age: {
    avg_days_open: number;
    oldest_open_days: number;
    buckets: { lt_1d: number; d1_3: number; d3_7: number; d7_14: number; gt_14d: number };
  };
  escaped: number;
  reopen_rate: number;
  top_components: Array<{ test_case_id: string; code: string; title: string; count: number }>;
}

interface TriageResult {
  severity?: string;
  priority?: string;
  component?: string;
  likely_root_cause?: string;
  reproduction_hint?: string;
  suggested_owner_role?: string;
  duplicate_risk?: string;
  rationale?: string;
}

const EMPTY_FORM = {
  title: '',
  description: '',
  steps_to_reproduce: '',
  expected_result: '',
  actual_result: '',
  severity: 'major',
  priority: 'high',
  source: 'manual',
  test_case_id: '',
  assignee: '',
  reporter: '',
};

export default function DefectsPage() {
  const { projectId } = useProject();

  const [defects, setDefects] = useState<DefectRow[]>([]);
  const [stats, setStats] = useState<DefectStats | null>(null);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [detail, setDetail] = useState<DefectDetail | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [triaging, setTriaging] = useState(false);

  /* filters */
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [openOnly, setOpenOnly] = useState(true);

  const [createModal, setCreateModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [transitionModal, setTransitionModal] = useState<{ to: DefectStatus } | null>(null);
  const [transitionNote, setTransitionNote] = useState({ assignee: '', fixed_in_build: '', note: '' });
  const [transitionError, setTransitionError] = useState<string | null>(null);

  /* --------------------------------- load -------------------------------- */

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [d, s, t] = await Promise.all([
        listOf<DefectRow>(`/projects/${projectId}/defects`, {
          search: search || undefined,
          status: statusFilter || undefined,
          severity: severityFilter || undefined,
          open_only: openOnly ? 1 : undefined,
        }),
        api.get<{ data: DefectStats }>(`/projects/${projectId}/defects/stats`).catch(() => null),
        listOf<TestCase>('/testcases', { limit: 2000 }).catch(() => []),
      ]);
      setDefects(d);
      if (s) setStats(s.data);
      setTestCases(t);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [projectId, search, statusFilter, severityFilter, openOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = useCallback(async (id: string) => {
    try {
      const res = await api.get<{ data: DefectDetail }>(`/defects/${id}`);
      setDetail(res.data);
      setTransitionError(null);
      setTransitionNote({ assignee: res.data.assignee ?? '', fixed_in_build: res.data.fixed_in_build ?? '', note: '' });
    } catch (err) {
      toast.fromError(err, 'Gagal memuat detail defect');
    }
  }, []);

  /* -------------------------------- actions ------------------------------ */

  async function createDefect() {
    if (!projectId || !form.title.trim()) return;
    setBusy(true);
    try {
      const res = await api.post<{ data: Defect }>(`/projects/${projectId}/defects`, {
        title: form.title.trim(),
        description: form.description.trim() || null,
        steps_to_reproduce: form.steps_to_reproduce.trim() || null,
        expected_result: form.expected_result.trim() || null,
        actual_result: form.actual_result.trim() || null,
        severity: form.severity,
        priority: form.priority,
        source: form.source,
        test_case_id: form.test_case_id || null,
        assignee: form.assignee.trim() || null,
        reporter: form.reporter.trim() || null,
      });
      toast.ok(`Defect ${res.data.code} dibuat`);
      setCreateModal(false);
      setForm({ ...EMPTY_FORM });
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal membuat defect');
    } finally {
      setBusy(false);
    }
  }

  async function applyTransition() {
    if (!detail || !transitionModal) return;
    setBusy(true);
    setTransitionError(null);
    try {
      const res = await api.patch<{ data: DefectDetail }>(`/defects/${detail.id}/status`, {
        status: transitionModal.to,
        assignee: transitionNote.assignee.trim() || undefined,
        fixed_in_build: transitionNote.fixed_in_build.trim() || undefined,
        note: transitionNote.note.trim() || undefined,
      });
      toast.ok(`${detail.code} → ${DEFECT_STATUS_LABEL[transitionModal.to]}`);
      setTransitionModal(null);
      setDetail((prev) => (prev ? { ...prev, ...res.data } : prev));
      await openDetail(detail.id);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTransitionError(msg);
      toast.fromError(err, 'Transisi ditolak');
    } finally {
      setBusy(false);
    }
  }

  async function runAiTriage() {
    if (!detail) return;
    setTriaging(true);
    try {
      const res = await api.post<{ data: { triage: TriageResult } }>(`/defects/${detail.id}/ai-triage`, {});
      toast.ok('Triase AI selesai');
      setDetail((prev) => (prev ? { ...prev, ai_triage: JSON.stringify(res.data.triage) } : prev));
      await openDetail(detail.id);
    } catch (err) {
      toast.fromError(err, 'Triase AI gagal');
    } finally {
      setTriaging(false);
    }
  }

  async function deleteDefect(id: string) {
    try {
      await api.del(`/defects/${id}`);
      toast.ok('Defect dihapus');
      setDetail(null);
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal menghapus defect');
    }
  }

  /* -------------------------------- derived ------------------------------ */

  const triage = useMemo<TriageResult | null>(() => {
    if (!detail?.ai_triage) return null;
    try {
      return JSON.parse(detail.ai_triage) as TriageResult;
    } catch {
      return null;
    }
  }, [detail]);

  const columns: Array<Column<DefectRow>> = [
    { key: 'code', header: 'Kode', width: '96px', render: (r) => <span className="cell-mono">{r.code}</span> },
    {
      key: 'title',
      header: 'Judul',
      render: (r) => (
        <div>
          <div className="strong clamp-2">{r.title}</div>
          {r.tc_code ? (
            <div className="mute-sm" style={{ fontSize: 11 }}>
              🧪 {r.tc_code}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'severity',
      header: 'Severity',
      width: '104px',
      render: (r) => <Badge tone={SEVERITY_TONE[r.severity]}>{SEVERITY_LABEL[r.severity]}</Badge>,
    },
    {
      key: 'priority',
      header: 'Prioritas',
      width: '100px',
      render: (r) => <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABEL[r.priority]}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '116px',
      render: (r) => <Badge tone={DEFECT_STATUS_TONE[r.status]}>{DEFECT_STATUS_LABEL[r.status]}</Badge>,
    },
    { key: 'assignee', header: 'Assignee', width: '110px', render: (r) => <span className="mute-sm">{r.assignee ?? '—'}</span> },
    { key: 'source', header: 'Sumber', width: '96px', render: (r) => <span className="mute-sm">{r.source}</span> },
    { key: 'created', header: 'Dibuat', width: '110px', render: (r) => <span className="mute-sm">{fmtDate(r.created_at)}</span> },
  ];

  if (!projectId) return <Empty icon="📁" title="Belum ada project" />;
  if (loading && !defects.length && !stats) return <Loading label="Memuat defect…" />;
  if (error && !defects.length && !stats) return <ErrorBox error={error} onRetry={() => void load()} />;

  return (
    <>
      <PageHeader
        title="Defect Tracker"
        subtitle="Langkah 9 — catat defect, jalankan triase, dan lacak sampai terverifikasi. Perpindahan status dijaga oleh alur legal."
        actions={
          <>
            <button className="btn btn-sm" onClick={() => void load()}>
              ⟳ Muat ulang
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setCreateModal(true)}>
              + Defect Baru
            </button>
          </>
        }
      />

      {/* ------------------------------- stats -------------------------------- */}
      <div className="grid grid-5" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="stat">
          <span className="stat-label">Total Defect</span>
          <span className="stat-value">{stats?.total ?? 0}</span>
        </div>
        <div className="stat stat-warn">
          <span className="stat-label">Terbuka</span>
          <span className="stat-value">{stats?.open ?? 0}</span>
          <span className="stat-delta">belum selesai</span>
        </div>
        <div className="stat stat-ok">
          <span className="stat-label">Selesai / Ditolak</span>
          <span className="stat-value">{stats?.closed ?? 0}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Umur Rata-rata</span>
          <span className="stat-value">{stats?.age.avg_days_open ?? 0}h</span>
          <span className="stat-delta">tertua {stats?.age.oldest_open_days ?? 0} hari</span>
        </div>
        <div className="stat stat-err">
          <span className="stat-label">Escaped ke Prod</span>
          <span className="stat-value">{stats?.escaped ?? 0}</span>
          <span className="stat-delta">reopen rate {stats?.reopen_rate ?? 0}%</span>
        </div>
      </div>

      {stats?.top_components.length ? (
        <Card title="🔥 Komponen Paling Rawan (test case dengan defect terbanyak)" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="row row-wrap" style={{ gap: 'var(--space-2)' }}>
            {stats.top_components.map((c) => (
              <span key={c.test_case_id} className="chip" title={c.title}>
                {c.code} · {c.count} defect
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      {/* ------------------------------ filters ------------------------------- */}
      <div className="toolbar">
        <input
          className="input input-sm search"
          placeholder="Cari kode, judul, atau deskripsi…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="select input-sm" style={{ maxWidth: 150 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Semua status</option>
          {DEFECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {DEFECT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select className="select input-sm" style={{ maxWidth: 150 }} value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
          <option value="">Semua severity</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABEL[s]}
            </option>
          ))}
        </select>
        <label className="row" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
          <input className="checkbox" type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          <span style={{ fontSize: 12.5 }}>Hanya yang terbuka</span>
        </label>
        <span className="spacer" />
        <span className="mute-sm">{defects.length} defect</span>
      </div>

      {/* -------------------------------- table ------------------------------- */}
      <Card>
        <DataTable
          rows={defects}
          columns={columns}
          rowKey={(r) => r.id}
          onRowClick={(r) => void openDetail(r.id)}
          loading={loading && !defects.length}
          empty={
            <Empty
              icon="🐞"
              title="Tidak ada defect"
              subtitle={
                openOnly
                  ? 'Tidak ada defect terbuka yang cocok dengan filter. Coba matikan "hanya yang terbuka".'
                  : 'Belum ada defect tercatat untuk project ini.'
              }
              action={
                <button className="btn btn-primary btn-sm" onClick={() => setCreateModal(true)}>
                  + Catat Defect
                </button>
              }
            />
          }
        />
      </Card>

      {/* -------------------------------- detail ------------------------------ */}
      {detail ? (
        <Modal
          title={
            <span className="row" style={{ gap: 'var(--space-2)' }}>
              <span className="cell-mono">{detail.code}</span>
              <span>{detail.title}</span>
            </span>
          }
          onClose={() => setDetail(null)}
          size="lg"
          footer={
            <>
              <button className="btn btn-danger btn-sm" onClick={() => void deleteDefect(detail.id)}>
                Hapus Defect
              </button>
              <span className="spacer" />
              <button className="btn" onClick={() => setDetail(null)}>
                Tutup
              </button>
            </>
          }
        >
          <div className="row row-wrap" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
            <Badge tone={SEVERITY_TONE[detail.severity]}>{SEVERITY_LABEL[detail.severity]}</Badge>
            <Badge tone={PRIORITY_TONE[detail.priority]}>{PRIORITY_LABEL[detail.priority]}</Badge>
            <Badge tone={DEFECT_STATUS_TONE[detail.status]}>{DEFECT_STATUS_LABEL[detail.status]}</Badge>
            <span className="chip">sumber: {detail.source}</span>
            {detail.is_escaped ? <Badge tone="err">Lolos ke production</Badge> : null}
            {detail.sibling_defects ? <span className="chip">{detail.sibling_defects} defect lain pada kasus ini</span> : null}
          </div>

          {/* ----------------------- status transitions ---------------------- */}
          <Card title="Ubah Status" subtitle="Hanya transisi yang sah menurut alur QA yang disediakan.">
            {!detail.allowed_next.length ? (
              <div className="mute-sm">Tidak ada transisi tersedia dari status ini.</div>
            ) : (
              <div className="row row-wrap" style={{ gap: 'var(--space-2)' }}>
                {detail.allowed_next.map((next) => (
                  <button
                    key={next}
                    className={`btn btn-sm ${next === 'closed' || next === 'verified' ? 'btn-ok' : next === 'rejected' ? 'btn-danger' : ''}`}
                    onClick={() => {
                      setTransitionModal({ to: next as DefectStatus });
                      setTransitionError(null);
                    }}
                  >
                    → {DEFECT_STATUS_LABEL[next as DefectStatus] ?? next}
                  </button>
                ))}
              </div>
            )}
            <div className="mute-sm" style={{ marginTop: 'var(--space-2)', fontSize: 11.5 }}>
              Alur legal: new → triaged → in_progress → fixed → retest → verified → closed, ditambah reopened /
              rejected / deferred.
            </div>
          </Card>

          {/* ---------------------------- AI triage -------------------------- */}
          <Card
            title="✨ Triase AI"
            subtitle="Saran severity, prioritas, komponen, dan akar masalah yang mungkin."
            style={{ marginTop: 'var(--space-3)' }}
            actions={
              <button className="btn btn-sm" onClick={() => void runAiTriage()} disabled={triaging}>
                {triaging ? '⏳ Menganalisis…' : triage ? '↻ Ulangi Triase' : '✨ Jalankan Triase AI'}
              </button>
            }
          >
            {!triage ? (
              <div className="mute-sm">
                Belum ada hasil triase. Jalankan untuk mendapatkan saran otomatis. Modul AI disediakan lane AI —
                bila belum tersedia, API menjawab 503 <code>ai_unavailable</code>.
              </div>
            ) : (
              <div className="kv">
                {triage.severity ? (
                  <>
                    <span className="kv-key">Saran severity</span>
                    <span>{triage.severity}</span>
                  </>
                ) : null}
                {triage.priority ? (
                  <>
                    <span className="kv-key">Saran prioritas</span>
                    <span>{triage.priority}</span>
                  </>
                ) : null}
                {triage.component ? (
                  <>
                    <span className="kv-key">Komponen</span>
                    <span>{triage.component}</span>
                  </>
                ) : null}
                {triage.likely_root_cause ? (
                  <>
                    <span className="kv-key">Perkiraan akar masalah</span>
                    <span>{triage.likely_root_cause}</span>
                  </>
                ) : null}
                {triage.reproduction_hint ? (
                  <>
                    <span className="kv-key">Saran reproduksi</span>
                    <span>{triage.reproduction_hint}</span>
                  </>
                ) : null}
                {triage.suggested_owner_role ? (
                  <>
                    <span className="kv-key">Pemilik disarankan</span>
                    <span>{triage.suggested_owner_role}</span>
                  </>
                ) : null}
                {triage.duplicate_risk ? (
                  <>
                    <span className="kv-key">Risiko duplikat</span>
                    <span>{triage.duplicate_risk}</span>
                  </>
                ) : null}
                {triage.rationale ? (
                  <>
                    <span className="kv-key">Rasional</span>
                    <span>{triage.rationale}</span>
                  </>
                ) : null}
              </div>
            )}
          </Card>

          {/* ----------------------------- context --------------------------- */}
          <div className="grid grid-2" style={{ marginTop: 'var(--space-3)' }}>
            <Card title="Detail Defect">
              <div className="kv">
                <span className="kv-key">Pelapor</span>
                <span>{detail.reporter ?? '—'}</span>
                <span className="kv-key">Assignee</span>
                <span>{detail.assignee ?? '—'}</span>
                <span className="kv-key">Environment</span>
                <span>{detail.environment ? `${detail.environment.name} (${detail.environment.kind})` : '—'}</span>
                <span className="kv-key">Fixed in build</span>
                <span>{detail.fixed_in_build ?? '—'}</span>
                <span className="kv-key">Dibuat</span>
                <span>{fmtDateTime(detail.created_at)}</span>
                <span className="kv-key">Ditutup</span>
                <span>{fmtDateTime(detail.closed_at)}</span>
              </div>
            </Card>

            <Card title="Test Case Terkait">
              {detail.test_case ? (
                <div className="kv">
                  <span className="kv-key">Kode</span>
                  <span className="cell-mono">{detail.test_case.code}</span>
                  <span className="kv-key">Judul</span>
                  <span>{detail.test_case.title}</span>
                </div>
              ) : (
                <div className="mute-sm">Defect ini tidak tertaut ke test case tertentu (mis. defect eksploratori).</div>
              )}

              {detail.run_result ? (
                <>
                  <div className="divider" />
                  <div className="label" style={{ marginBottom: 6 }}>
                    Hasil Run Terkait
                  </div>
                  <div className="kv">
                    <span className="kv-key">Run</span>
                    <span>
                      {detail.run ? `${detail.run.code} — ${detail.run.name}` : detail.run_result.run_id}
                    </span>
                    <span className="kv-key">Status</span>
                    <span>
                      <Badge tone={RUN_STATUS_TONE[detail.run_result.status]}>
                        {RUN_STATUS_LABEL[detail.run_result.status]}
                      </Badge>
                    </span>
                    <span className="kv-key">Engine</span>
                    <span>{detail.run_result.engine}</span>
                    <span className="kv-key">Dieksekusi</span>
                    <span>{fmtDateTime(detail.run_result.executed_at)}</span>
                  </div>
                  {detail.run_result.error_message ? (
                    <div className="pre" style={{ marginTop: 'var(--space-3)' }}>
                      {detail.run_result.error_message}
                    </div>
                  ) : null}
                </>
              ) : null}
            </Card>
          </div>

          {/* -------------------------- reproduction ------------------------- */}
          <Card title="Reproduksi & Hasil" style={{ marginTop: 'var(--space-3)' }}>
            <div className="stack">
              <div>
                <div className="label">Deskripsi</div>
                <div style={{ fontSize: 13 }}>{detail.description ?? '—'}</div>
              </div>
              <div>
                <div className="label">Langkah reproduksi</div>
                <pre className="pre">{detail.steps_to_reproduce ?? '—'}</pre>
              </div>
              <div className="grid grid-2">
                <div>
                  <div className="label">Hasil diharapkan</div>
                  <div className="pre">{detail.expected_result ?? '—'}</div>
                </div>
                <div>
                  <div className="label">Hasil aktual</div>
                  <div className="pre">{detail.actual_result ?? '—'}</div>
                </div>
              </div>
            </div>
          </Card>
        </Modal>
      ) : null}

      {/* --------------------------- transition modal -------------------------- */}
      {transitionModal && detail ? (
        <Modal
          title={`Ubah status: ${DEFECT_STATUS_LABEL[detail.status]} → ${DEFECT_STATUS_LABEL[transitionModal.to]}`}
          onClose={() => setTransitionModal(null)}
          size="sm"
          footer={
            <>
              <button className="btn" onClick={() => setTransitionModal(null)} disabled={busy}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={() => void applyTransition()} disabled={busy}>
                {busy ? 'Menyimpan…' : 'Terapkan'}
              </button>
            </>
          }
        >
          {transitionError ? (
            <div className="alert alert-err" style={{ marginBottom: 'var(--space-3)' }}>
              <span>⛔</span>
              <div>
                <div className="strong">Transisi ditolak</div>
                <div style={{ fontSize: 12.5 }}>{transitionError}</div>
              </div>
            </div>
          ) : null}

          <div className="stack">
            {transitionModal.to === 'in_progress' ? (
              <Field label="Assignee">
                <input
                  className="input"
                  value={transitionNote.assignee}
                  onChange={(e) => setTransitionNote({ ...transitionNote, assignee: e.target.value })}
                  placeholder="nama developer"
                />
              </Field>
            ) : null}
            {transitionModal.to === 'fixed' ? (
              <Field label="Fixed in build">
                <input
                  className="input"
                  value={transitionNote.fixed_in_build}
                  onChange={(e) => setTransitionNote({ ...transitionNote, fixed_in_build: e.target.value })}
                  placeholder="mis. v1.4.2-rc1"
                />
              </Field>
            ) : null}
            <Field label="Catatan" hint="Catatan masuk ke activity log project.">
              <textarea
                className="textarea"
                value={transitionNote.note}
                onChange={(e) => setTransitionNote({ ...transitionNote, note: e.target.value })}
                placeholder="Konteks perubahan status…"
              />
            </Field>
          </div>
        </Modal>
      ) : null}

      {/* ----------------------------- create modal ---------------------------- */}
      {createModal ? (
        <Modal
          title="Catat Defect Baru"
          onClose={() => setCreateModal(false)}
          size="lg"
          footer={
            <>
              <button className="btn" onClick={() => setCreateModal(false)} disabled={busy}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={() => void createDefect()} disabled={busy || !form.title.trim()}>
                {busy ? 'Menyimpan…' : 'Simpan Defect'}
              </button>
            </>
          }
        >
          <div className="stack">
            <Field label="Judul" required>
              <input
                className="input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Ringkas dan spesifik: apa yang salah, di mana"
              />
            </Field>

            <div className="grid grid-3">
              <Field label="Severity">
                <select className="select" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {SEVERITY_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Prioritas">
                <select className="select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {PRIORITIES.map((s) => (
                    <option key={s} value={s}>
                      {PRIORITY_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sumber">
                <select className="select" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                  {DEFECT_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Test case terkait" hint="Menautkan defect ke kasus mempertajam perhitungan risiko regresi.">
              <select className="select" value={form.test_case_id} onChange={(e) => setForm({ ...form, test_case_id: e.target.value })}>
                <option value="">— tidak ditautkan —</option>
                {testCases.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} — {t.title}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Deskripsi">
              <textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>

            <Field label="Langkah reproduksi" hint="Satu langkah per baris.">
              <textarea
                className="textarea"
                value={form.steps_to_reproduce}
                onChange={(e) => setForm({ ...form, steps_to_reproduce: e.target.value })}
                placeholder={'1. Buka halaman checkout\n2. Klik tombol Bayar'}
              />
            </Field>

            <div className="grid grid-2">
              <Field label="Hasil diharapkan">
                <textarea className="textarea" value={form.expected_result} onChange={(e) => setForm({ ...form, expected_result: e.target.value })} />
              </Field>
              <Field label="Hasil aktual">
                <textarea className="textarea" value={form.actual_result} onChange={(e) => setForm({ ...form, actual_result: e.target.value })} />
              </Field>
            </div>

            <div className="grid grid-2">
              <Field label="Pelapor">
                <input className="input" value={form.reporter} onChange={(e) => setForm({ ...form, reporter: e.target.value })} />
              </Field>
              <Field label="Assignee">
                <input className="input" value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })} />
              </Field>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
