/**
 * CyclesPage — lifecycle stage 6 (perencanaan proyek QA).
 *
 * Cycles contain sprints, sprints contain scope (test cases with estimate + assignee).
 * The gantt strip uses the lead-owned `.gantt-row/.gantt-track/.gantt-bar` classes.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CYCLE_STATUSES,
  SPRINT_STATUSES,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  type Cycle,
  type Sprint,
  type TestCase,
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
  ConfirmDialog,
  fmtDate,
  fmtDuration,
  pctLabel,
} from '../../components';

interface ScopeRow {
  id: string;
  sprint_id: string;
  test_case_id: string;
  assignee: string | null;
  estimate_minutes: number;
  status: 'todo' | 'in_progress' | 'done';
  tc_code: string;
  tc_title: string;
  tc_priority: string;
  tc_automation_status: string;
  tc_risk_score: number;
}

interface PlanSprint {
  sprint_id: string;
  code: string;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  capacity_points: number;
  scope_count: number;
  estimate_sum: number;
  actual_minutes: number;
  progress_pct: number;
  capacity_used_pct: number;
  status_counts: { todo: number; in_progress: number; done: number };
  offset_days: number;
  duration_days: number;
}

interface PlanView {
  window: { start: string | null; end: string | null; total_days: number };
  totals: {
    cycles: number;
    sprints: number;
    scope_count: number;
    estimate_minutes: number;
    actual_minutes: number;
    capacity_points: number;
    capacity_used_pct: number;
    progress_pct: number;
  };
  cycles: Array<{
    cycle_id: string;
    code: string;
    name: string;
    start_date: string | null;
    end_date: string | null;
    total_days: number;
    scope_count: number;
    estimate_sum: number;
    capacity_points: number;
    progress_pct: number;
    sprints: PlanSprint[];
  }>;
}

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'info' | 'muted' | 'accent'> = {
  planned: 'info',
  active: 'accent',
  completed: 'ok',
  archived: 'muted',
  todo: 'muted',
  in_progress: 'warn',
  done: 'ok',
};

export default function CyclesPage() {
  const { projectId } = useProject();

  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [activeCycleId, setActiveCycleId] = useState<string>('');
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [scopeBySprint, setScopeBySprint] = useState<Record<string, ScopeRow[]>>({});
  const [testCases, setTestCases] = useState<TestCase[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const [cycleModal, setCycleModal] = useState(false);
  const [sprintModal, setSprintModal] = useState(false);
  const [scopeModalSprint, setScopeModalSprint] = useState<Sprint | null>(null);
  const [scopePick, setScopePick] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'cycle' | 'sprint'; id: string; name: string } | null>(null);

  /* ------------------------------- form state ---------------------------- */
  const [cycleForm, setCycleForm] = useState({
    name: '',
    goal: '',
    start_date: '',
    end_date: '',
    entry_criteria: 'Semua requirement utama sudah approved',
    exit_criteria: 'Pass rate ≥ quality gate & tidak ada blocker terbuka',
  });
  const [sprintForm, setSprintForm] = useState({
    name: '',
    goal: '',
    start_date: '',
    end_date: '',
    capacity_points: 40,
  });

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [cyc, pl, tcs] = await Promise.all([
        listOf<Cycle>(`/projects/${projectId}/cycles`),
        api.get<{ data: PlanView }>(`/projects/${projectId}/plan`),
        listOf<TestCase>('/testcases', { limit: 2000 }).catch(() => []),
      ]);
      setCycles(cyc);
      setPlan(pl.data);
      setTestCases(tcs);
      setActiveCycleId((current) =>
        current && cyc.some((c) => c.id === current) ? current : (cyc[0]?.id ?? ''),
      );
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadSprints = useCallback(async (cycleId: string) => {
    if (!cycleId) {
      setSprints([]);
      setScopeBySprint({});
      return;
    }
    try {
      const rows = await listOf<Sprint>(`/cycles/${cycleId}/sprints`);
      setSprints(rows);
      const scopes = await Promise.all(
        rows.map(async (s) => [s.id, await listOf<ScopeRow>(`/sprints/${s.id}/scope`)] as const),
      );
      setScopeBySprint(Object.fromEntries(scopes));
    } catch (err) {
      toast.fromError(err, 'Gagal memuat sprint');
    }
  }, []);

  useEffect(() => {
    void loadSprints(activeCycleId);
  }, [activeCycleId, loadSprints]);

  const activeCycle = cycles.find((c) => c.id === activeCycleId) ?? null;

  /* --------------------------------- CRUD -------------------------------- */

  async function createCycle() {
    if (!projectId || !cycleForm.name.trim()) return;
    setBusy(true);
    try {
      const res = await api.post<{ data: Cycle }>(`/projects/${projectId}/cycles`, {
        name: cycleForm.name.trim(),
        goal: cycleForm.goal.trim() || null,
        start_date: cycleForm.start_date || null,
        end_date: cycleForm.end_date || null,
        entry_criteria: cycleForm.entry_criteria
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        exit_criteria: cycleForm.exit_criteria
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      toast.ok(`Cycle ${res.data.code} dibuat`);
      setCycleModal(false);
      setCycleForm({ ...cycleForm, name: '', goal: '' });
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal membuat cycle');
    } finally {
      setBusy(false);
    }
  }

  async function createSprint() {
    if (!activeCycleId || !sprintForm.name.trim()) return;
    setBusy(true);
    try {
      const res = await api.post<{ data: Sprint }>(`/cycles/${activeCycleId}/sprints`, {
        name: sprintForm.name.trim(),
        goal: sprintForm.goal.trim() || null,
        start_date: sprintForm.start_date || activeCycle?.start_date || null,
        end_date: sprintForm.end_date || activeCycle?.end_date || null,
        capacity_points: Number(sprintForm.capacity_points) || 40,
      });
      toast.ok(`Sprint ${res.data.code} dibuat`);
      setSprintModal(false);
      setSprintForm({ ...sprintForm, name: '', goal: '' });
      await load();
      await loadSprints(activeCycleId);
    } catch (err) {
      toast.fromError(err, 'Gagal membuat sprint');
    } finally {
      setBusy(false);
    }
  }

  async function updateCycleStatus(id: string, status: string) {
    try {
      await api.patch(`/cycles/${id}`, { status });
      toast.ok('Status cycle diperbarui');
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal memperbarui cycle');
    }
  }

  async function updateSprintStatus(id: string, status: string) {
    try {
      await api.patch(`/sprints/${id}`, { status });
      toast.ok('Status sprint diperbarui');
      await loadSprints(activeCycleId);
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal memperbarui sprint');
    }
  }

  async function deleteConfirmed() {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      if (confirmDelete.kind === 'cycle') {
        await api.del(`/cycles/${confirmDelete.id}`);
        await load();
      } else {
        await api.del(`/sprints/${confirmDelete.id}`);
        await load();
        await loadSprints(activeCycleId);
      }
      toast.ok('Dihapus');
      setConfirmDelete(null);
    } catch (err) {
      toast.fromError(err, 'Gagal menghapus');
    } finally {
      setBusy(false);
    }
  }

  async function addScope() {
    if (!scopeModalSprint || !scopePick.size) return;
    setBusy(true);
    try {
      await api.post(`/sprints/${scopeModalSprint.id}/scope`, { test_case_ids: [...scopePick] });
      toast.ok(`${scopePick.size} test case ditambahkan ke sprint`);
      setScopeModalSprint(null);
      setScopePick(new Set());
      await loadSprints(activeCycleId);
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal menambah scope');
    } finally {
      setBusy(false);
    }
  }

  async function patchScope(rowId: string, patch: Record<string, unknown>) {
    try {
      await api.patch(`/sprint-scope/${rowId}`, patch);
      await loadSprints(activeCycleId);
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal memperbarui scope');
    }
  }

  async function removeScope(rowId: string) {
    try {
      await api.del(`/sprint-scope/${rowId}`);
      toast.ok('Dihapus dari scope');
      await loadSprints(activeCycleId);
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal menghapus scope');
    }
  }

  /* --------------------------------- render ------------------------------ */

  const gantt = useMemo(() => plan?.cycles.find((c) => c.cycle_id === activeCycleId) ?? null, [plan, activeCycleId]);
  const ganttSpan = Math.max(1, gantt?.total_days || plan?.window.total_days || 1);

  const availableCases = useMemo(() => {
    const taken = new Set(
      scopeModalSprint ? (scopeBySprint[scopeModalSprint.id] ?? []).map((r) => r.test_case_id) : [],
    );
    return testCases.filter((t) => !taken.has(t.id)).slice(0, 300);
  }, [testCases, scopeModalSprint, scopeBySprint]);

  if (!projectId) return <Empty icon="📁" title="Belum ada project" />;
  if (loading && !cycles.length && !plan) return <Loading label="Memuat perencanaan…" />;
  if (error && !plan) return <ErrorBox error={error} onRetry={() => void load()} />;

  return (
    <>
      <PageHeader
        title="Cycle & Sprint"
        subtitle="Langkah 6 — susun cycle, pecah menjadi sprint, alokasikan test case beserta estimasi dan penanggung jawab."
        actions={
          <>
            <button className="btn btn-sm" onClick={() => void load()}>
              ⟳ Muat ulang
            </button>
            <button className="btn btn-sm" onClick={() => setSprintModal(true)} disabled={!activeCycleId}>
              + Sprint
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setCycleModal(true)}>
              + Cycle
            </button>
          </>
        }
      />

      {/* ------------------------------- totals ------------------------------ */}
      <div className="grid grid-4" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="stat">
          <span className="stat-label">Cycle</span>
          <span className="stat-value">{plan?.totals.cycles ?? 0}</span>
          <span className="stat-delta">{plan?.totals.sprints ?? 0} sprint total</span>
        </div>
        <div className="stat">
          <span className="stat-label">Test Case Ter-scope</span>
          <span className="stat-value">{plan?.totals.scope_count ?? 0}</span>
          <span className="stat-delta">estimasi {plan?.totals.estimate_minutes ?? 0} menit</span>
        </div>
        <div className="stat">
          <span className="stat-label">Kapasitas Terpakai</span>
          <span className="stat-value">{pctLabel(plan?.totals.capacity_used_pct)}</span>
          <span className="stat-delta">{plan?.totals.capacity_points ?? 0} poin kapasitas</span>
        </div>
        <div className="stat stat-accent">
          <span className="stat-label">Progres Scope</span>
          <span className="stat-value">{pctLabel(plan?.totals.progress_pct)}</span>
          <span className="stat-delta">aktual {plan?.totals.actual_minutes ?? 0} menit</span>
        </div>
      </div>

      {!cycles.length ? (
        <Empty
          icon="🗂️"
          title="Belum ada cycle"
          subtitle="Mulai dengan membuat cycle pertama, lalu tambahkan sprint di dalamnya."
          action={
            <button className="btn btn-primary" onClick={() => setCycleModal(true)}>
              + Buat Cycle
            </button>
          }
        />
      ) : (
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          {/* --------------------------- cycle list --------------------------- */}
          <Card title="Daftar Cycle">
            <div className="stack stack-sm">
              {cycles.map((c) => {
                const stat = plan?.cycles.find((p) => p.cycle_id === c.id);
                const selected = c.id === activeCycleId;
                return (
                  <div
                    key={c.id}
                    className="card card-hover"
                    style={{
                      padding: 'var(--space-3)',
                      borderColor: selected ? 'var(--accent)' : undefined,
                    }}
                    onClick={() => setActiveCycleId(c.id)}
                  >
                    <div className="row-between">
                      <div className="row" style={{ gap: 'var(--space-2)' }}>
                        <span className="cell-mono">{c.code}</span>
                        <span className="strong">{c.name}</span>
                      </div>
                      <Badge tone={STATUS_TONE[c.status] ?? 'muted'}>{c.status}</Badge>
                    </div>
                    {c.goal ? <div className="mute-sm" style={{ marginTop: 4 }}>{c.goal}</div> : null}
                    <div className="mute-sm" style={{ marginTop: 4, fontSize: 11.5 }}>
                      {fmtDate(c.start_date)} – {fmtDate(c.end_date)} · {stat?.sprints.length ?? 0} sprint ·{' '}
                      {stat?.scope_count ?? 0} test case
                    </div>
                    <div className="row" style={{ marginTop: 8, gap: 'var(--space-2)' }}>
                      <select
                        className="select input-sm"
                        style={{ maxWidth: 130 }}
                        value={c.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => void updateCycleStatus(c.id, e.target.value)}
                      >
                        {CYCLE_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <span className="spacer" />
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDelete({ kind: 'cycle', id: c.id, name: c.code });
                        }}
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* ------------------------ sprints + gantt ------------------------- */}
          <div className="stack">
            <Card
              title={activeCycle ? `Sprint di ${activeCycle.code}` : 'Sprint'}
              subtitle={activeCycle?.name}
              actions={
                <button className="btn btn-sm" onClick={() => setSprintModal(true)}>
                  + Sprint
                </button>
              }
            >
              {!sprints.length ? (
                <Empty
                  icon="🏃"
                  title="Belum ada sprint"
                  subtitle="Pecah cycle ini menjadi sprint agar beban kerja terukur."
                  action={
                    <button className="btn btn-primary btn-sm" onClick={() => setSprintModal(true)}>
                      + Buat Sprint
                    </button>
                  }
                />
              ) : (
                <div className="stack stack-sm">
                  {sprints.map((s) => {
                    const scope = scopeBySprint[s.id] ?? [];
                    const done = scope.filter((r) => r.status === 'done').length;
                    const pct = scope.length ? (done / scope.length) * 100 : 0;
                    const estimate = scope.reduce((sum, r) => sum + r.estimate_minutes, 0);
                    const capacity = s.capacity_points * 60;
                    const over = capacity > 0 && estimate > capacity;

                    return (
                      <div key={s.id} className="card" style={{ padding: 'var(--space-3)' }}>
                        <div className="row-between">
                          <div className="row" style={{ gap: 'var(--space-2)' }}>
                            <span className="cell-mono">{s.code}</span>
                            <span className="strong">{s.name}</span>
                            <Badge tone={STATUS_TONE[s.status] ?? 'muted'}>{s.status}</Badge>
                          </div>
                          <select
                            className="select input-sm"
                            style={{ maxWidth: 120 }}
                            value={s.status}
                            onChange={(e) => void updateSprintStatus(s.id, e.target.value)}
                          >
                            {SPRINT_STATUSES.map((x) => (
                              <option key={x} value={x}>
                                {x}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="mute-sm" style={{ marginTop: 4, fontSize: 11.5 }}>
                          {fmtDate(s.start_date)} – {fmtDate(s.end_date)} · kapasitas {s.capacity_points} poin
                        </div>

                        <div className="row" style={{ marginTop: 8, gap: 'var(--space-2)' }}>
                          <Progress value={pct} tone={pct >= 100 ? 'ok' : pct >= 50 ? 'warn' : undefined} />
                          <span className="mute-sm" style={{ whiteSpace: 'nowrap' }}>
                            {done}/{scope.length} selesai
                          </span>
                        </div>

                        <div className="row" style={{ marginTop: 6, gap: 'var(--space-3)' }}>
                          <span className={`mute-sm ${over ? 'strong' : ''}`} style={over ? { color: 'var(--err)' } : undefined}>
                            {estimate} / {capacity} menit{over ? ' ⚠️ over capacity' : ''}
                          </span>
                          <span className="spacer" />
                          <button className="btn btn-sm" onClick={() => setScopeModalSprint(s)}>
                            + Scope
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => setConfirmDelete({ kind: 'sprint', id: s.id, name: s.code })}
                          >
                            Hapus
                          </button>
                        </div>

                        {scope.length ? (
                          <div className="table-wrap" style={{ marginTop: 'var(--space-3)' }}>
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>Test Case</th>
                                  <th>Prioritas</th>
                                  <th>Estimasi</th>
                                  <th>Assignee</th>
                                  <th>Status</th>
                                  <th />
                                </tr>
                              </thead>
                              <tbody>
                                {scope.map((r) => (
                                  <tr key={r.id}>
                                    <td>
                                      <div className="cell-mono">{r.tc_code}</div>
                                      <div className="clamp-2" style={{ fontSize: 12 }}>
                                        {r.tc_title}
                                      </div>
                                    </td>
                                    <td>
                                      <Badge tone={PRIORITY_TONE[r.tc_priority as 'low'] ?? 'muted'}>
                                        {PRIORITY_LABEL[r.tc_priority as 'low'] ?? r.tc_priority}
                                      </Badge>
                                    </td>
                                    <td>
                                      <input
                                        className="input input-sm"
                                        type="number"
                                        min={0}
                                        style={{ width: 68 }}
                                        defaultValue={r.estimate_minutes}
                                        onBlur={(e) => {
                                          const v = Number(e.target.value);
                                          if (v !== r.estimate_minutes) void patchScope(r.id, { estimate_minutes: v });
                                        }}
                                      />
                                    </td>
                                    <td>
                                      <input
                                        className="input input-sm"
                                        style={{ width: 96 }}
                                        defaultValue={r.assignee ?? ''}
                                        placeholder="nama"
                                        onBlur={(e) => {
                                          if (e.target.value !== (r.assignee ?? '')) {
                                            void patchScope(r.id, { assignee: e.target.value || null });
                                          }
                                        }}
                                      />
                                    </td>
                                    <td>
                                      <select
                                        className="select input-sm"
                                        style={{ width: 100 }}
                                        value={r.status}
                                        onChange={(e) => void patchScope(r.id, { status: e.target.value })}
                                      >
                                        <option value="todo">todo</option>
                                        <option value="in_progress">in_progress</option>
                                        <option value="done">done</option>
                                      </select>
                                    </td>
                                    <td className="cell-actions">
                                      <button
                                        className="btn btn-ghost btn-sm"
                                        title="Keluarkan dari sprint"
                                        onClick={() => void removeScope(r.id)}
                                      >
                                        ✕
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="mute-sm" style={{ marginTop: 8 }}>
                            Belum ada test case di sprint ini.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* ------------------------------- gantt -------------------------- */}
            <Card
              title="Timeline (Gantt)"
              subtitle={
                activeCycle
                  ? `Rentang cycle ${activeCycle.code}: ${fmtDate(activeCycle.start_date)} – ${fmtDate(activeCycle.end_date)} (${ganttSpan} hari)`
                  : 'Pilih cycle untuk melihat timeline'
              }
            >
              {!gantt || !gantt.sprints.length ? (
                <div className="mute-sm">Belum ada sprint berjadwal untuk digambar.</div>
              ) : (
                <div>
                  {gantt.sprints.map((s) => {
                    const offsetPct = (s.offset_days / ganttSpan) * 100;
                    const widthPct = Math.max(1.5, (s.duration_days / ganttSpan) * 100);
                    return (
                      <div className="gantt-row" key={s.sprint_id}>
                        <div className="truncate" title={`${s.code} — ${s.name}`}>
                          <span className="cell-mono">{s.code}</span> {s.name}
                          <div className="mute-sm" style={{ fontSize: 10.5 }}>
                            {s.progress_pct}% · {s.estimate_sum} menit · {s.scope_count} case
                          </div>
                        </div>
                        <div className="gantt-track" title={`${s.start_date ?? '?'} → ${s.end_date ?? '?'}`}>
                          <div
                            className="gantt-bar"
                            style={{
                              left: `${offsetPct}%`,
                              width: `${widthPct}%`,
                              opacity: s.status === 'completed' ? 0.55 : 1,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  <div className="row-between mute-sm" style={{ marginTop: 'var(--space-2)', fontSize: 11 }}>
                    <span>{fmtDate(gantt.start_date)}</span>
                    <span>{fmtDate(gantt.end_date)}</span>
                  </div>
                </div>
              )}

              <div className="divider" />
              <div className="kv">
                <span className="kv-key">Estimasi scope</span>
                <span>{fmtDuration((plan?.totals.estimate_minutes ?? 0) * 60_000)}</span>
                <span className="kv-key">Aktual tercatat</span>
                <span>{fmtDuration((plan?.totals.actual_minutes ?? 0) * 60_000)}</span>
                <span className="kv-key">Kapasitas total</span>
                <span>{plan?.totals.capacity_points ?? 0} poin</span>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ------------------------------- modals ------------------------------- */}
      {cycleModal ? (
        <Modal
          title="Buat Cycle"
          onClose={() => setCycleModal(false)}
          footer={
            <>
              <button className="btn" onClick={() => setCycleModal(false)} disabled={busy}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={() => void createCycle()} disabled={busy || !cycleForm.name.trim()}>
                {busy ? 'Menyimpan…' : 'Simpan Cycle'}
              </button>
            </>
          }
        >
          <div className="stack">
            <Field label="Nama cycle" required>
              <input
                className="input"
                value={cycleForm.name}
                onChange={(e) => setCycleForm({ ...cycleForm, name: e.target.value })}
                placeholder="mis. Q1 2026"
              />
            </Field>
            <Field label="Tujuan">
              <textarea
                className="textarea"
                value={cycleForm.goal}
                onChange={(e) => setCycleForm({ ...cycleForm, goal: e.target.value })}
                placeholder="Apa yang ingin dicapai cycle ini?"
              />
            </Field>
            <div className="grid grid-2">
              <Field label="Mulai">
                <input
                  className="input"
                  type="date"
                  value={cycleForm.start_date}
                  onChange={(e) => setCycleForm({ ...cycleForm, start_date: e.target.value })}
                />
              </Field>
              <Field label="Selesai">
                <input
                  className="input"
                  type="date"
                  value={cycleForm.end_date}
                  onChange={(e) => setCycleForm({ ...cycleForm, end_date: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Entry criteria" hint="Satu kriteria per baris — syarat sebelum QA dimulai.">
              <textarea
                className="textarea"
                value={cycleForm.entry_criteria}
                onChange={(e) => setCycleForm({ ...cycleForm, entry_criteria: e.target.value })}
              />
            </Field>
            <Field label="Exit criteria" hint="Satu kriteria per baris — syarat cycle boleh ditutup.">
              <textarea
                className="textarea"
                value={cycleForm.exit_criteria}
                onChange={(e) => setCycleForm({ ...cycleForm, exit_criteria: e.target.value })}
              />
            </Field>
          </div>
        </Modal>
      ) : null}

      {sprintModal ? (
        <Modal
          title={`Buat Sprint di ${activeCycle?.code ?? '-'}`}
          onClose={() => setSprintModal(false)}
          size="sm"
          footer={
            <>
              <button className="btn" onClick={() => setSprintModal(false)} disabled={busy}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={() => void createSprint()} disabled={busy || !sprintForm.name.trim()}>
                {busy ? 'Menyimpan…' : 'Simpan Sprint'}
              </button>
            </>
          }
        >
          <div className="stack">
            <Field label="Nama sprint" required>
              <input
                className="input"
                value={sprintForm.name}
                onChange={(e) => setSprintForm({ ...sprintForm, name: e.target.value })}
                placeholder="mis. Sprint 1"
              />
            </Field>
            <Field label="Tujuan sprint">
              <input
                className="input"
                value={sprintForm.goal}
                onChange={(e) => setSprintForm({ ...sprintForm, goal: e.target.value })}
              />
            </Field>
            <div className="grid grid-2">
              <Field label="Mulai">
                <input
                  className="input"
                  type="date"
                  value={sprintForm.start_date}
                  onChange={(e) => setSprintForm({ ...sprintForm, start_date: e.target.value })}
                />
              </Field>
              <Field label="Selesai">
                <input
                  className="input"
                  type="date"
                  value={sprintForm.end_date}
                  onChange={(e) => setSprintForm({ ...sprintForm, end_date: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Kapasitas (poin)" hint="1 poin ≈ 60 menit effort QA.">
              <input
                className="input"
                type="number"
                min={1}
                value={sprintForm.capacity_points}
                onChange={(e) => setSprintForm({ ...sprintForm, capacity_points: Number(e.target.value) })}
              />
            </Field>
          </div>
        </Modal>
      ) : null}

      {scopeModalSprint ? (
        <Modal
          title={`Tambah Scope ke ${scopeModalSprint.code}`}
          onClose={() => setScopeModalSprint(null)}
          size="lg"
          footer={
            <>
              <span className="mute-sm">{scopePick.size} test case dipilih</span>
              <span className="spacer" />
              <button className="btn" onClick={() => setScopeModalSprint(null)} disabled={busy}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={() => void addScope()} disabled={busy || !scopePick.size}>
                {busy ? 'Menambahkan…' : 'Tambahkan ke Sprint'}
              </button>
            </>
          }
        >
          {!availableCases.length ? (
            <Empty
              icon="🧪"
              title="Tidak ada test case tersedia"
              subtitle="Semua test case project ini sudah masuk sprint, atau katalog masih kosong."
            />
          ) : (
            <div className="table-wrap" style={{ maxHeight: 460 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }} />
                    <th>Kode</th>
                    <th>Judul</th>
                    <th>Prioritas</th>
                    <th>Otomasi</th>
                    <th>Estimasi</th>
                  </tr>
                </thead>
                <tbody>
                  {availableCases.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => {
                        const next = new Set(scopePick);
                        if (next.has(t.id)) next.delete(t.id);
                        else next.add(t.id);
                        setScopePick(next);
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <input
                          className="checkbox"
                          type="checkbox"
                          checked={scopePick.has(t.id)}
                          onChange={() => {
                            const next = new Set(scopePick);
                            if (next.has(t.id)) next.delete(t.id);
                            else next.add(t.id);
                            setScopePick(next);
                          }}
                        />
                      </td>
                      <td className="cell-mono">{t.code}</td>
                      <td>{t.title}</td>
                      <td>
                        <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
                      </td>
                      <td className="mute-sm">{t.automation_status}</td>
                      <td className="mute-sm">{t.estimated_minutes} m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title={`Hapus ${confirmDelete.kind === 'cycle' ? 'cycle' : 'sprint'}?`}
          message={
            confirmDelete.kind === 'cycle'
              ? `${confirmDelete.name} beserta seluruh sprint dan scope di dalamnya akan dihapus permanen.`
              : `${confirmDelete.name} beserta scope-nya akan dihapus permanen.`
          }
          confirmLabel="Hapus"
          danger
          busy={busy}
          onConfirm={() => void deleteConfirmed()}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}
    </>
  );
}
