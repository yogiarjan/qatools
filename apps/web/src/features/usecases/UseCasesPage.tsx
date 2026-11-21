/**
 * Use cases page — stage 2 of the lifecycle.
 * List + rich detail modal (actors, pre/postconditions, ordered main flow, alternate
 * flows, business rules), manual editor, and AI "generate scenarios" per use case.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Priority, RiskLevel, UseCase } from '@qatools/shared';
import { PRIORITIES, PRIORITY_LABEL, PRIORITY_TONE, RISK_LABEL } from '@qatools/shared';
import { api, listOf, ApiError } from '../../lib/api';
import { toast } from '../../lib/toast';
import { useProject } from '../../lib/project';
import {
  PageHeader,
  Modal,
  Field,
  ConfirmDialog,
  Loading,
  ErrorBox,
  Empty,
  Badge,
  Tabs,
  StringListEditor,
} from '../../components';

interface AlternateFlow {
  name: string;
  steps: string[];
}

interface UseCaseRow extends UseCase {
  actors_list?: string[];
  preconditions_list?: string[];
  postconditions_list?: string[];
  main_flow_list?: string[];
  alternate_flows_list?: AlternateFlow[];
  business_rules_list?: string[];
  scenario_count?: number;
  test_case_count?: number;
  requirements?: Array<{ requirement_id: string; code: string; title: string }>;
}

interface FormState {
  name: string;
  goal: string;
  priority: Priority;
  risk: RiskLevel;
  status: UseCase['status'];
  actors: string[];
  preconditions: string[];
  postconditions: string[];
  main_flow: string[];
  business_rules: string[];
}

const EMPTY_FORM: FormState = {
  name: '',
  goal: '',
  priority: 'medium',
  risk: 'medium',
  status: 'draft',
  actors: [],
  preconditions: [],
  postconditions: [],
  main_flow: [],
  business_rules: [],
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  review: 'Ditinjau',
  approved: 'Disetujui',
  deprecated: 'Usang',
};

function aiMessage(err: unknown): string {
  if (err instanceof ApiError && (err.status === 404 || err.status === 503)) {
    return 'Fitur AI belum tersedia di server ini. Aktifkan modul AI (lane-ai) lalu coba lagi.';
  }
  if (err instanceof ApiError && err.status === 0) {
    return 'Tidak dapat menghubungi server API. Pastikan backend berjalan.';
  }
  return err instanceof Error ? err.message : 'Fitur AI gagal dijalankan.';
}

export default function UseCasesPage() {
  const { projectId } = useProject();
  const [rows, setRows] = useState<UseCaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<'' | Priority>('');

  const [detail, setDetail] = useState<UseCaseRow | null>(null);
  const [detailTab, setDetailTab] = useState<'flow' | 'alt' | 'rules' | 'trace'>('flow');
  const [detailLoading, setDetailLoading] = useState(false);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UseCaseRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [altFlows, setAltFlows] = useState<AlternateFlow[]>([]);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<UseCaseRow | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listOf<UseCaseRow>(`/projects/${projectId}/usecases`, {
        q: search || undefined,
        priority: priorityFilter || undefined,
      });
      setRows(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [projectId, search, priorityFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const withScenarios = rows.filter((r) => (r.scenario_count ?? 0) > 0).length;
    return {
      total: rows.length,
      withScenarios,
      withoutScenarios: rows.length - withScenarios,
      testCases: rows.reduce((n, r) => n + (r.test_case_count ?? 0), 0),
    };
  }, [rows]);

  async function openDetail(row: UseCaseRow) {
    setDetail(row);
    setDetailTab('flow');
    setDetailLoading(true);
    try {
      const full = await api.get<{ data: UseCaseRow }>(`/usecases/${row.id}`);
      setDetail(full.data);
    } catch (err) {
      toast.fromError(err, 'Gagal memuat detail use case');
    } finally {
      setDetailLoading(false);
    }
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setAltFlows([]);
    setCreating(true);
    setEditing(null);
  }

  function openEdit(row: UseCaseRow) {
    setForm({
      name: row.name,
      goal: row.goal ?? '',
      priority: row.priority,
      risk: row.risk,
      status: row.status,
      actors: row.actors_list ?? [],
      preconditions: row.preconditions_list ?? [],
      postconditions: row.postconditions_list ?? [],
      main_flow: row.main_flow_list ?? [],
      business_rules: row.business_rules_list ?? [],
    });
    setAltFlows(row.alternate_flows_list ?? []);
    setEditing(row);
    setCreating(false);
    setDetail(null);
  }

  function closeModal() {
    setCreating(false);
    setEditing(null);
  }

  async function save() {
    if (!form.name.trim()) {
      toast.err('Nama use case wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        goal: form.goal.trim() || null,
        priority: form.priority,
        risk: form.risk,
        status: form.status,
        actors_list: form.actors.filter((s) => s.trim()),
        preconditions_list: form.preconditions.filter((s) => s.trim()),
        postconditions_list: form.postconditions.filter((s) => s.trim()),
        main_flow_list: form.main_flow.filter((s) => s.trim()),
        alternate_flows_list: altFlows.filter((f) => f.name.trim()),
        business_rules_list: form.business_rules.filter((s) => s.trim()),
      };
      if (editing) {
        await api.patch(`/usecases/${editing.id}`, payload);
        toast.ok(`${editing.code} diperbarui.`);
      } else {
        await api.post(`/projects/${projectId}/usecases`, payload);
        toast.ok('Use case dibuat.');
      }
      closeModal();
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal menyimpan use case');
    } finally {
      setSaving(false);
    }
  }

  async function duplicate(row: UseCaseRow) {
    try {
      await api.post(`/usecases/${row.id}/duplicate`, {});
      toast.ok(`${row.code} diduplikasi.`);
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal menduplikasi');
    }
  }

  async function remove() {
    if (!toDelete) return;
    try {
      await api.del(`/usecases/${toDelete.id}`);
      toast.ok(`${toDelete.code} dihapus.`);
      setToDelete(null);
      setDetail(null);
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal menghapus use case');
    }
  }

  async function generateScenarios(row: UseCaseRow) {
    setAiBusy(row.id);
    try {
      await api.post(`/projects/${projectId}/ai/generate`, {
        task: 'generate_scenarios',
        project_id: projectId,
        input: { use_case_ids: [row.id], per_use_case: 3 },
        persist: true,
        input_ref: row.id,
      });
      toast.ok(`AI membuat skenario untuk ${row.code}.`);
      await load();
      if (detail?.id === row.id) await openDetail(row);
    } catch (err) {
      toast.warn(aiMessage(err));
    } finally {
      setAiBusy(null);
    }
  }

  if (loading && !rows.length) return <Loading label="Memuat use case…" />;
  if (error) return <ErrorBox error={error} onRetry={() => void load()} />;

  return (
    <>
      <PageHeader
        title="Use Case"
        subtitle="Tahap 2: ubah kebutuhan menjadi use case terstruktur — actor, pre/post-condition, alur utama, alur alternatif, dan aturan bisnis."
        actions={
          <>
            <button className="btn" onClick={openCreate}>
              + Use Case
            </button>
          </>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="stat">
          <span className="stat-label">Total Use Case</span>
          <span className="stat-value">{stats.total}</span>
        </div>
        <div className="stat stat-ok">
          <span className="stat-label">Sudah Punya Skenario</span>
          <span className="stat-value">{stats.withScenarios}</span>
        </div>
        <div className="stat stat-warn">
          <span className="stat-label">Belum Punya Skenario</span>
          <span className="stat-value">{stats.withoutScenarios}</span>
        </div>
        <div className="stat stat-info">
          <span className="stat-label">Test Case Turunan</span>
          <span className="stat-value">{stats.testCases}</span>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="input input-sm search"
          placeholder="🔍 Cari use case…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="select input-sm"
          style={{ maxWidth: 180 }}
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as '' | Priority)}
        >
          <option value="">Semua prioritas</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <Empty
          icon="📘"
          title="Belum ada use case"
          subtitle="Buat use case manual, atau kembali ke halaman Kebutuhan dan gunakan tombol ✨ Generate Use Cases with AI."
          action={
            <button className="btn btn-primary" onClick={openCreate}>
              + Use Case
            </button>
          }
        />
      ) : (
        <div className="grid grid-auto">
          {rows.map((row) => {
            const scenarioCount = row.scenario_count ?? 0;
            return (
              <div className="card uc-card" key={row.id} onClick={() => void openDetail(row)}>
                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                  <span className="chip chip-active">{row.code}</span>
                  <Badge tone={PRIORITY_TONE[row.priority]}>{PRIORITY_LABEL[row.priority]}</Badge>
                </div>
                <div className="strong" style={{ marginTop: 'var(--space-2)' }}>
                  {row.name}
                </div>
                {row.goal ? <p className="card-sub clamp-2">{row.goal}</p> : null}

                {row.actors_list?.length ? (
                  <div className="row row-wrap" style={{ gap: 4 }}>
                    {row.actors_list.slice(0, 3).map((a) => (
                      <span className="chip" key={a}>
                        👤 {a}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="row row-wrap" style={{ gap: 4, marginTop: 'var(--space-2)' }}>
                  <span className={scenarioCount ? 'badge badge-ok' : 'badge badge-err'}>
                    🧭 {scenarioCount} skenario
                  </span>
                  <span className="badge badge-muted">🧪 {row.test_case_count ?? 0} test case</span>
                  <span className="badge badge-muted">risiko {RISK_LABEL[row.risk]}</span>
                </div>

                <div className="row" style={{ gap: 4, marginTop: 'var(--space-3)' }}>
                  <button
                    className="btn btn-sm"
                    disabled={aiBusy === row.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      void generateScenarios(row);
                    }}
                    title="Buat skenario dari use case ini dengan AI"
                  >
                    {aiBusy === row.id ? '⏳' : '✨ Skenario'}
                  </button>
                  <span className="spacer" />
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Duplikat"
                    onClick={(e) => {
                      e.stopPropagation();
                      void duplicate(row);
                    }}
                  >
                    ⧉
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Ubah"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(row);
                    }}
                  >
                    ✏️
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Hapus"
                    onClick={(e) => {
                      e.stopPropagation();
                      setToDelete(row);
                    }}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ------------------------------- detail ------------------------------- */}
      {detail ? (
        <Modal
          title={
            <span className="row" style={{ gap: 'var(--space-2)' }}>
              <span className="chip chip-active">{detail.code}</span>
              {detail.name}
            </span>
          }
          onClose={() => setDetail(null)}
          size="lg"
          footer={
            <>
              <button className="btn" onClick={() => openEdit(detail)}>
                ✏️ Ubah
              </button>
              <button className="btn" onClick={() => void duplicate(detail)}>
                ⧉ Duplikat
              </button>
              <button
                className="btn btn-primary"
                disabled={aiBusy === detail.id}
                onClick={() => void generateScenarios(detail)}
              >
                {aiBusy === detail.id ? '⏳ AI bekerja…' : '✨ Generate Skenario dengan AI'}
              </button>
            </>
          }
        >
          {detailLoading ? (
            <Loading label="Memuat detail…" />
          ) : (
            <div className="stack">
              <div className="grid grid-4">
                <div className="stat">
                  <span className="stat-label">Prioritas</span>
                  <span className="stat-value" style={{ fontSize: 17 }}>
                    {PRIORITY_LABEL[detail.priority]}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Risiko</span>
                  <span className="stat-value" style={{ fontSize: 17 }}>
                    {RISK_LABEL[detail.risk]}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Status</span>
                  <span className="stat-value" style={{ fontSize: 17 }}>
                    {STATUS_LABEL[detail.status] ?? detail.status}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Dibuat oleh</span>
                  <span className="stat-value" style={{ fontSize: 17 }}>
                    {detail.generated_by === 'ai' ? '✨ AI' : detail.generated_by === 'import' ? '📥 Import' : '✍️ Manual'}
                  </span>
                </div>
              </div>

              {detail.goal ? (
                <div className="card">
                  <h3 className="card-title">🎯 Tujuan</h3>
                  <div>{detail.goal}</div>
                </div>
              ) : null}

              <div className="grid grid-2">
                <div className="card">
                  <h3 className="card-title">👤 Actor</h3>
                  {(detail.actors_list ?? []).length ? (
                    <ul className="list-clean">
                      {detail.actors_list?.map((a) => <li key={a}>{a}</li>)}
                    </ul>
                  ) : (
                    <span className="muted">Belum ditentukan</span>
                  )}
                </div>
                <div className="card">
                  <h3 className="card-title">⚠️ Aturan Bisnis</h3>
                  {(detail.business_rules_list ?? []).length ? (
                    <ul className="list-clean">
                      {detail.business_rules_list?.map((r) => <li key={r}>{r}</li>)}
                    </ul>
                  ) : (
                    <span className="muted">Belum ada aturan bisnis</span>
                  )}
                </div>
              </div>

              <div className="grid grid-2">
                <div className="card">
                  <h3 className="card-title">🔑 Precondition</h3>
                  {(detail.preconditions_list ?? []).length ? (
                    <ul className="list-clean">
                      {detail.preconditions_list?.map((p) => <li key={p}>{p}</li>)}
                    </ul>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </div>
                <div className="card">
                  <h3 className="card-title">✅ Postcondition</h3>
                  {(detail.postconditions_list ?? []).length ? (
                    <ul className="list-clean">
                      {detail.postconditions_list?.map((p) => <li key={p}>{p}</li>)}
                    </ul>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </div>
              </div>

              <Tabs
                tabs={[
                  { id: 'flow' as const, label: `Alur Utama (${(detail.main_flow_list ?? []).length})` },
                  { id: 'alt' as const, label: `Alur Alternatif (${(detail.alternate_flows_list ?? []).length})` },
                  { id: 'rules' as const, label: `Test Case (${detail.test_case_count ?? 0})` },
                  { id: 'trace' as const, label: 'Jejak Kebutuhan' },
                ]}
                active={detailTab}
                onChange={setDetailTab}
              />

              {detailTab === 'flow' ? (
                (detail.main_flow_list ?? []).length ? (
                  <ol className="uc-flow">
                    {detail.main_flow_list?.map((step, i) => (
                      <li key={i}>
                        <span className="uc-flow-num">{i + 1}</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="muted">Belum ada langkah alur utama.</div>
                )
              ) : null}

              {detailTab === 'alt' ? (
                (detail.alternate_flows_list ?? []).length ? (
                  <div className="stack">
                    {detail.alternate_flows_list?.map((flow, i) => (
                      <div className="card" key={i}>
                        <h3 className="card-title">↩︎ {flow.name}</h3>
                        {flow.steps.length ? (
                          <ol className="uc-flow">
                            {flow.steps.map((s, j) => (
                              <li key={j}>
                                <span className="uc-flow-num">{j + 1}</span>
                                <span>{s}</span>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <span className="muted">Tidak ada langkah rinci.</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="muted">Belum ada alur alternatif.</div>
                )
              ) : null}

              {detailTab === 'rules' ? (
                <div className="stack">
                  <button
                    className="btn btn-primary"
                    style={{ alignSelf: 'flex-start' }}
                    disabled={aiBusy === detail.id}
                    onClick={() => void generateScenarios(detail)}
                  >
                    ✨ Generate Skenario dengan AI
                  </button>
                  <div className="muted">
                    Test case diturunkan dari skenario. Buka halaman <b>Skenario</b> untuk
                    menambahkannya, atau <b>Test Cases</b> untuk melihat turunannya.
                  </div>
                </div>
              ) : null}

              {detailTab === 'trace' ? (
                (detail.requirements ?? []).length ? (
                  <ul className="list-clean">
                    {detail.requirements?.map((r) => (
                      <li key={r.requirement_id}>
                        <span className="cell-mono">{r.code}</span> — {r.title}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="alert alert-warn">
                    <span>⚠️</span>
                    <div>
                      Use case ini belum terhubung ke kebutuhan mana pun, jadi muncul sebagai
                      <b> orphan</b> di traceability matrix.
                    </div>
                  </div>
                )
              ) : null}
            </div>
          )}
        </Modal>
      ) : null}

      {/* ------------------------------- editor ------------------------------- */}
      {creating || editing ? (
        <Modal
          title={editing ? `Ubah ${editing.code}` : 'Use Case Baru'}
          onClose={closeModal}
          size="lg"
          footer={
            <>
              <button className="btn" onClick={closeModal} disabled={saving}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan'}
              </button>
            </>
          }
        >
          <div className="stack">
            <Field label="Nama Use Case" required>
              <input
                className="input"
                value={form.name}
                placeholder="Tambah ke keranjang"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>

            <Field label="Tujuan">
              <textarea
                className="textarea"
                value={form.goal}
                placeholder="Apa yang ingin dicapai actor dengan use case ini?"
                onChange={(e) => setForm({ ...form, goal: e.target.value })}
              />
            </Field>

            <div className="grid grid-3">
              <Field label="Prioritas">
                <select
                  className="select"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Risiko">
                <select
                  className="select"
                  value={form.risk}
                  onChange={(e) => setForm({ ...form, risk: e.target.value as RiskLevel })}
                >
                  <option value="low">Rendah</option>
                  <option value="medium">Sedang</option>
                  <option value="high">Tinggi</option>
                </select>
              </Field>
              <Field label="Status">
                <select
                  className="select"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as UseCase['status'] })}
                >
                  <option value="draft">Draft</option>
                  <option value="review">Ditinjau</option>
                  <option value="approved">Disetujui</option>
                  <option value="deprecated">Usang</option>
                </select>
              </Field>
            </div>

            <div className="grid grid-2">
              <StringListEditor
                label="Actor"
                values={form.actors}
                onChange={(next) => setForm({ ...form, actors: next })}
                placeholder="Pembeli"
              />
              <StringListEditor
                label="Precondition"
                values={form.preconditions}
                onChange={(next) => setForm({ ...form, preconditions: next })}
                placeholder="Pengguna sudah login"
              />
            </div>

            <div className="grid grid-2">
              <StringListEditor
                label="Postcondition"
                values={form.postconditions}
                onChange={(next) => setForm({ ...form, postconditions: next })}
                placeholder="Keranjang berisi produk"
              />
              <StringListEditor
                label="Aturan Bisnis"
                values={form.business_rules}
                onChange={(next) => setForm({ ...form, business_rules: next })}
                placeholder="Maksimal 99 unit per produk"
              />
            </div>

            <StringListEditor
              label="Alur Utama (urut)"
              values={form.main_flow}
              onChange={(next) => setForm({ ...form, main_flow: next })}
              placeholder="Buka detail produk"
              addLabel="Tambah langkah"
            />

            <div className="field">
              <span className="label">Alur Alternatif</span>
              <div className="stack stack-sm">
                {altFlows.map((flow, i) => (
                  <div className="card" key={i}>
                    <div className="row">
                      <input
                        className="input input-sm"
                        value={flow.name}
                        placeholder="Nama alur alternatif"
                        onChange={(e) => {
                          const next = [...altFlows];
                          next[i] = { ...flow, name: e.target.value };
                          setAltFlows(next);
                        }}
                      />
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Hapus alur"
                        onClick={() => setAltFlows(altFlows.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="stack stack-sm" style={{ marginTop: 'var(--space-2)' }}>
                      {flow.steps.map((step, j) => (
                        <div className="row" key={j}>
                          <span className="cell-mono" style={{ width: 22 }}>
                            {j + 1}.
                          </span>
                          <input
                            className="input input-sm"
                            value={step}
                            placeholder="Langkah"
                            onChange={(e) => {
                              const next = [...altFlows];
                              const steps = [...flow.steps];
                              steps[j] = e.target.value;
                              next[i] = { ...flow, steps };
                              setAltFlows(next);
                            }}
                          />
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              const next = [...altFlows];
                              next[i] = { ...flow, steps: flow.steps.filter((_, k) => k !== j) };
                              setAltFlows(next);
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        className="btn btn-sm"
                        style={{ alignSelf: 'flex-start' }}
                        onClick={() => {
                          const next = [...altFlows];
                          next[i] = { ...flow, steps: [...flow.steps, ''] };
                          setAltFlows(next);
                        }}
                      >
                        + Langkah
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  className="btn btn-sm"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => setAltFlows([...altFlows, { name: '', steps: [''] }])}
                >
                  + Tambah Alur Alternatif
                </button>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}

      {toDelete ? (
        <ConfirmDialog
          title="Hapus Use Case?"
          danger
          confirmLabel="Hapus"
          message={
            <>
              Use case <b>{toDelete.code}</b> — {toDelete.name} dan seluruh skenario di bawahnya
              akan dihapus.
            </>
          }
          onCancel={() => setToDelete(null)}
          onConfirm={() => void remove()}
        />
      ) : null}

      <style>{`
        .uc-card { cursor: pointer; display: flex; flex-direction: column; gap: 6px; }
        .uc-flow { list-style: none; margin: 0; padding: 0; counter-reset: ucstep; }
        .uc-flow li { display: flex; gap: var(--space-3); padding: 7px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
        .uc-flow li:last-child { border-bottom: none; }
        .uc-flow-num {
          flex: 0 0 22px; height: 22px; border-radius: 50%;
          background: var(--accent-soft); color: var(--accent-hover);
          display: grid; place-items: center; font-size: 11px; font-weight: 700;
        }
      `}</style>
    </>
  );
}
