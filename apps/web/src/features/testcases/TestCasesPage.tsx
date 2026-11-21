/**
 * Test cases page — stage 4 of the lifecycle.
 * Dense catalogue table with full filtering, an ordered steps editor, test data editor,
 * and the "Kirim ke Regresi" (👑) toggle.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AutomationStatus,
  CaseType,
  ExecEngine,
  LayerKind,
  Priority,
  Severity,
  TestCase,
  TestStep,
} from '@qatools/shared';
import {
  AUTOMATION_STATUSES,
  AUTOMATION_STATUS_LABEL,
  CASE_TYPES,
  CASE_TYPE_LABEL,
  EXEC_ENGINES,
  ENGINE_LABEL,
  LAYER_KINDS,
  LAYER_LABEL,
  PRIORITIES,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  SEVERITIES,
  SEVERITY_LABEL,
} from '@qatools/shared';
import { api, listOf } from '../../lib/api';
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
  DataTable,
  KeyValueEditor,
  type Column,
} from '../../components';

interface TestCaseRow extends TestCase {
  scenario?: { id: string; code: string; title: string } | null;
  use_case?: { id: string; code: string; name: string } | null;
  step_count?: number;
  tags_list?: string[];
  test_data_list?: Array<{ field: string; value: string }>;
}

interface ScenarioOption {
  id: string;
  code: string;
  title: string;
}

interface StepDraft {
  action: string;
  expected: string;
  data: string;
}

interface FormState {
  scenario_id: string;
  code: string;
  title: string;
  objective: string;
  preconditions: string;
  type: CaseType;
  layer: LayerKind;
  priority: Priority;
  severity: Severity;
  automation_status: AutomationStatus;
  engine: ExecEngine;
  estimated_minutes: number;
  expected_result: string;
  status: TestCase['status'];
  tags: string;
}

const EMPTY_FORM: FormState = {
  scenario_id: '',
  code: '',
  title: '',
  objective: '',
  preconditions: '',
  type: 'functional',
  layer: 'web',
  priority: 'medium',
  severity: 'major',
  automation_status: 'manual',
  engine: 'manual',
  estimated_minutes: 10,
  expected_result: '',
  status: 'ready',
  tags: '',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  ready: 'Siap',
  deprecated: 'Usang',
};

/** Risk score → badge tone, mirroring the shared thresholds. */
function riskTone(score: number): 'ok' | 'warn' | 'err' {
  if (score >= 65) return 'err';
  if (score >= 35) return 'warn';
  return 'ok';
}

export default function TestCasesPage() {
  const { projectId } = useProject();
  const [rows, setRows] = useState<TestCaseRow[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const [filters, setFilters] = useState({
    type: '',
    layer: '',
    priority: '',
    engine: '',
    automation_status: '',
    regression: '' as '' | 'true' | 'false',
    q: '',
  });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TestCaseRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [testData, setTestData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<TestCaseRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [cases, scs] = await Promise.all([
        listOf<TestCaseRow>(`/projects/${projectId}/testcases`, {
          type: filters.type || undefined,
          layer: filters.layer || undefined,
          priority: filters.priority || undefined,
          engine: filters.engine || undefined,
          automation_status: filters.automation_status || undefined,
          regression: filters.regression || undefined,
          q: filters.q || undefined,
        }),
        listOf<ScenarioOption>(`/projects/${projectId}/scenarios`),
      ]);
      setRows(cases);
      setScenarios(scs);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [projectId, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const automated = rows.filter((r) => r.automation_status === 'automated').length;
    const regression = rows.filter((r) => Number(r.is_regression) === 1).length;
    const highRisk = rows.filter((r) => Number(r.risk_score) >= 65).length;
    const minutes = rows.reduce((n, r) => n + (r.estimated_minutes ?? 0), 0);
    return {
      total: rows.length,
      automated,
      automationPct: rows.length ? Math.round((automated / rows.length) * 100) : 0,
      regression,
      highRisk,
      minutes,
    };
  }, [rows]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setSteps([{ action: '', expected: '', data: '' }]);
    setTestData({});
    setCreating(true);
    setEditing(null);
  }

  async function openEdit(row: TestCaseRow) {
    setCreating(false);
    setEditing(row);
    setForm({
      scenario_id: row.scenario_id ?? '',
      code: row.code,
      title: row.title,
      objective: row.objective ?? '',
      preconditions: row.preconditions ?? '',
      type: row.type,
      layer: row.layer,
      priority: row.priority,
      severity: row.severity,
      automation_status: row.automation_status,
      engine: row.engine,
      estimated_minutes: row.estimated_minutes,
      expected_result: row.expected_result ?? '',
      status: row.status,
      tags: (row.tags_list ?? []).join(', '),
    });
    setTestData(
      Object.fromEntries((row.test_data_list ?? []).map((d) => [d.field, d.value])),
    );
    setSteps([{ action: '', expected: '', data: '' }]);
    try {
      const full = await api.get<{ data: TestCaseRow & { steps: TestStep[] } }>(`/testcases/${row.id}`);
      const loaded = full.data.steps ?? [];
      setSteps(
        loaded.length
          ? loaded.map((s) => ({ action: s.action, expected: s.expected ?? '', data: s.data ?? '' }))
          : [{ action: '', expected: '', data: '' }],
      );
    } catch (err) {
      toast.fromError(err, 'Gagal memuat langkah');
    }
  }

  function closeModal() {
    setCreating(false);
    setEditing(null);
  }

  async function save() {
    if (!form.title.trim()) {
      toast.err('Judul test case wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        scenario_id: form.scenario_id || null,
        code: form.code.trim() || undefined,
        title: form.title.trim(),
        objective: form.objective.trim() || null,
        preconditions: form.preconditions.trim() || null,
        type: form.type,
        layer: form.layer,
        priority: form.priority,
        severity: form.severity,
        automation_status: form.automation_status,
        engine: form.engine,
        estimated_minutes: Number(form.estimated_minutes),
        expected_result: form.expected_result.trim() || null,
        status: form.status,
        tags_list: form.tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        test_data_list: Object.entries(testData)
          .filter(([k]) => k.trim() !== '')
          .map(([field, value]) => ({ field, value })),
        steps: steps
          .filter((s) => s.action.trim() !== '')
          .map((s) => ({
            action: s.action.trim(),
            expected: s.expected.trim() || null,
            data: s.data.trim() || null,
          })),
      };

      if (editing) {
        await api.patch(`/testcases/${editing.id}`, payload);
        toast.ok(`${editing.code} diperbarui.`);
      } else {
        await api.post(`/projects/${projectId}/testcases`, payload);
        toast.ok('Test case dibuat.');
      }
      closeModal();
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal menyimpan test case');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!toDelete) return;
    try {
      await api.del(`/testcases/${toDelete.id}`);
      toast.ok(`${toDelete.code} dihapus.`);
      setToDelete(null);
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal menghapus test case');
    }
  }

  /** 👑 Kirim ke Regresi — the King of the Test. */
  async function toggleRegression(row: TestCaseRow) {
    setBusy(row.id);
    try {
      const next = Number(row.is_regression) === 1 ? 0 : 1;
      await api.post(`/testcases/${row.id}/regression`, { is_regression: next });
      toast.ok(
        next
          ? `👑 ${row.code} masuk ke suite regresi.`
          : `${row.code} dikeluarkan dari suite regresi.`,
      );
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal mengubah status regresi');
    } finally {
      setBusy(null);
    }
  }

  const columns: Array<Column<TestCaseRow>> = [
    { key: 'code', header: 'Kode', width: '78px', render: (r) => <span className="cell-mono">{r.code}</span> },
    {
      key: 'title',
      header: 'Judul',
      width: '26%',
      render: (r) => (
        <div className="stack stack-sm">
          <span className="strong">{r.title}</span>
          <span className="mute-sm truncate" title={r.scenario?.title ?? ''}>
            {r.scenario ? `🧭 ${r.scenario.code}` : '⚠️ tanpa skenario'}
            {r.step_count ? ` · ${r.step_count} langkah` : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Tipe',
      width: '96px',
      render: (r) => <span className="mute-sm">{CASE_TYPE_LABEL[r.type]}</span>,
    },
    {
      key: 'layer',
      header: 'Layer',
      width: '88px',
      render: (r) => <Badge tone="info">{LAYER_LABEL[r.layer]}</Badge>,
    },
    {
      key: 'priority',
      header: 'Prioritas',
      width: '94px',
      render: (r) => <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABEL[r.priority]}</Badge>,
    },
    {
      key: 'engine',
      header: 'Engine',
      width: '116px',
      render: (r) => <span className="mute-sm">{ENGINE_LABEL[r.engine]}</span>,
    },
    {
      key: 'automation',
      header: 'Otomasi',
      width: '112px',
      render: (r) => (
        <Badge
          tone={
            r.automation_status === 'automated'
              ? 'ok'
              : r.automation_status === 'to_be_automated'
                ? 'warn'
                : 'muted'
          }
        >
          {AUTOMATION_STATUS_LABEL[r.automation_status]}
        </Badge>
      ),
    },
    {
      key: 'risk',
      header: 'Risiko',
      width: '84px',
      align: 'center',
      render: (r) => (
        <Badge tone={riskTone(Number(r.risk_score))} title="risk_score 0–100 dari riskScore()">
          {Number(r.risk_score).toFixed(0)}
        </Badge>
      ),
    },
    {
      key: 'regression',
      header: 'Regresi',
      width: '78px',
      align: 'center',
      render: (r) => (
        <button
          className={`btn btn-sm ${Number(r.is_regression) === 1 ? 'btn-ok' : 'btn-ghost'}`}
          disabled={busy === r.id}
          title={Number(r.is_regression) === 1 ? 'Keluarkan dari suite regresi' : 'Kirim ke suite regresi'}
          onClick={(e) => {
            e.stopPropagation();
            void toggleRegression(r);
          }}
        >
          {Number(r.is_regression) === 1 ? '👑' : '☆'}
        </button>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '76px',
      align: 'right',
      render: (r) => (
        <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          <button
            className="btn btn-ghost btn-sm"
            title="Ubah"
            onClick={(e) => {
              e.stopPropagation();
              void openEdit(r);
            }}
          >
            ✏️
          </button>
          <button
            className="btn btn-ghost btn-sm"
            title="Hapus"
            onClick={(e) => {
              e.stopPropagation();
              setToDelete(r);
            }}
          >
            🗑️
          </button>
        </div>
      ),
    },
  ];

  if (loading && !rows.length) return <Loading label="Memuat test case…" />;
  if (error) return <ErrorBox error={error} onRetry={() => void load()} />;

  return (
    <>
      <PageHeader
        title="Test Case"
        subtitle="Tahap 4: rancang test case dengan langkah berurutan, data uji, dan hasil yang diharapkan. Tandai 👑 untuk memasukkannya ke suite regresi."
        actions={
          <>
            <a className="btn" href={`/api/projects/${projectId}/export/testcases?format=csv`} download>
              ⬇️ Export CSV
            </a>
            <button className="btn btn-primary" onClick={openCreate}>
              + Test Case
            </button>
          </>
        }
      />

      <div className="grid grid-5" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="stat">
          <span className="stat-label">Total</span>
          <span className="stat-value">{stats.total}</span>
        </div>
        <div className="stat stat-ok">
          <span className="stat-label">Otomasi</span>
          <span className="stat-value">{stats.automationPct}%</span>
          <span className="stat-delta">
            {stats.automated}/{stats.total} kasus
          </span>
        </div>
        <div className="stat stat-accent">
          <span className="stat-label">Suite Regresi</span>
          <span className="stat-value">👑 {stats.regression}</span>
        </div>
        <div className="stat stat-err">
          <span className="stat-label">Risiko Tinggi</span>
          <span className="stat-value">{stats.highRisk}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Estimasi</span>
          <span className="stat-value">{Math.round(stats.minutes / 60)}j</span>
          <span className="stat-delta">{stats.minutes} menit</span>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="input input-sm search"
          placeholder="🔍 Cari test case…"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
        <select
          className="select input-sm"
          style={{ maxWidth: 150 }}
          value={filters.type}
          onChange={(e) => setFilters({ ...filters, type: e.target.value })}
        >
          <option value="">Semua tipe</option>
          {CASE_TYPES.map((t) => (
            <option key={t} value={t}>
              {CASE_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select
          className="select input-sm"
          style={{ maxWidth: 130 }}
          value={filters.layer}
          onChange={(e) => setFilters({ ...filters, layer: e.target.value })}
        >
          <option value="">Semua layer</option>
          {LAYER_KINDS.map((l) => (
            <option key={l} value={l}>
              {LAYER_LABEL[l]}
            </option>
          ))}
        </select>
        <select
          className="select input-sm"
          style={{ maxWidth: 140 }}
          value={filters.priority}
          onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
        >
          <option value="">Semua prioritas</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
        <select
          className="select input-sm"
          style={{ maxWidth: 150 }}
          value={filters.engine}
          onChange={(e) => setFilters({ ...filters, engine: e.target.value })}
        >
          <option value="">Semua engine</option>
          {EXEC_ENGINES.map((e2) => (
            <option key={e2} value={e2}>
              {ENGINE_LABEL[e2]}
            </option>
          ))}
        </select>
        <select
          className="select input-sm"
          style={{ maxWidth: 165 }}
          value={filters.automation_status}
          onChange={(e) => setFilters({ ...filters, automation_status: e.target.value })}
        >
          <option value="">Semua status otomasi</option>
          {AUTOMATION_STATUSES.map((a) => (
            <option key={a} value={a}>
              {AUTOMATION_STATUS_LABEL[a]}
            </option>
          ))}
        </select>
        <select
          className="select input-sm"
          style={{ maxWidth: 145 }}
          value={filters.regression}
          onChange={(e) =>
            setFilters({ ...filters, regression: e.target.value as '' | 'true' | 'false' })
          }
        >
          <option value="">Regresi: semua</option>
          <option value="true">👑 Hanya regresi</option>
          <option value="false">Bukan regresi</option>
        </select>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() =>
            setFilters({
              type: '',
              layer: '',
              priority: '',
              engine: '',
              automation_status: '',
              regression: '',
              q: '',
            })
          }
        >
          Reset
        </button>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        empty={
          <Empty
            icon="🧪"
            title="Belum ada test case"
            subtitle="Test case diturunkan dari skenario. Buat skenario dulu, atau tambahkan test case manual di sini."
            action={
              <button className="btn btn-primary" onClick={openCreate}>
                + Test Case
              </button>
            }
          />
        }
      />

      {creating || editing ? (
        <Modal
          title={editing ? `Ubah ${editing.code}` : 'Test Case Baru'}
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
            <Field label="Skenario Induk" hint="Test case tanpa skenario tidak akan terhubung ke kebutuhan">
              <select
                className="select"
                value={form.scenario_id}
                onChange={(e) => setForm({ ...form, scenario_id: e.target.value })}
              >
                <option value="">— tanpa skenario —</option>
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.title}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-3">
              <Field label="Kode" hint="Kosongkan untuk TC-otomatis">
                <input
                  className="input"
                  value={form.code}
                  placeholder="TC-001"
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </Field>
              <Field label="Status">
                <select
                  className="select"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as TestCase['status'] })}
                >
                  <option value="draft">Draft</option>
                  <option value="ready">Siap</option>
                  <option value="deprecated">Usang</option>
                </select>
              </Field>
              <Field label="Estimasi (menit)">
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={form.estimated_minutes}
                  onChange={(e) => setForm({ ...form, estimated_minutes: Number(e.target.value) })}
                />
              </Field>
            </div>

            <Field label="Judul" required>
              <input
                className="input"
                value={form.title}
                placeholder="Tambah produk tersedia ke keranjang"
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>

            <div className="grid grid-2">
              <Field label="Objective">
                <textarea
                  className="textarea"
                  value={form.objective}
                  placeholder="Apa yang divalidasi test case ini?"
                  onChange={(e) => setForm({ ...form, objective: e.target.value })}
                />
              </Field>
              <Field label="Precondition">
                <textarea
                  className="textarea"
                  value={form.preconditions}
                  placeholder="Pengguna sudah login"
                  onChange={(e) => setForm({ ...form, preconditions: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid grid-4">
              <Field label="Tipe">
                <select
                  className="select"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as CaseType })}
                >
                  {CASE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {CASE_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Layer">
                <select
                  className="select"
                  value={form.layer}
                  onChange={(e) => setForm({ ...form, layer: e.target.value as LayerKind })}
                >
                  {LAYER_KINDS.map((l) => (
                    <option key={l} value={l}>
                      {LAYER_LABEL[l]}
                    </option>
                  ))}
                </select>
              </Field>
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
              <Field label="Severity">
                <select
                  className="select"
                  value={form.severity}
                  onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })}
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {SEVERITY_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid grid-2">
              <Field label="Status Otomasi">
                <select
                  className="select"
                  value={form.automation_status}
                  onChange={(e) =>
                    setForm({ ...form, automation_status: e.target.value as AutomationStatus })
                  }
                >
                  {AUTOMATION_STATUSES.map((a) => (
                    <option key={a} value={a}>
                      {AUTOMATION_STATUS_LABEL[a]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Engine Eksekusi">
                <select
                  className="select"
                  value={form.engine}
                  onChange={(e) => setForm({ ...form, engine: e.target.value as ExecEngine })}
                >
                  {EXEC_ENGINES.map((e2) => (
                    <option key={e2} value={e2}>
                      {ENGINE_LABEL[e2]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* --------------------------- steps editor --------------------------- */}
            <div className="field">
              <span className="label">Langkah Pengujian (urut)</span>
              <div className="stack stack-sm">
                {steps.map((step, i) => (
                  <div className="card tc-step" key={i}>
                    <div className="row-between">
                      <span className="cell-mono">Langkah {i + 1}</span>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Hapus langkah"
                        onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </div>
                    <input
                      className="input input-sm"
                      value={step.action}
                      placeholder="Aksi: klik tombol Tambah ke Keranjang"
                      onChange={(e) => {
                        const next = [...steps];
                        next[i] = { ...step, action: e.target.value };
                        setSteps(next);
                      }}
                    />
                    <div className="grid grid-2">
                      <input
                        className="input input-sm"
                        value={step.expected}
                        placeholder="Hasil diharapkan"
                        onChange={(e) => {
                          const next = [...steps];
                          next[i] = { ...step, expected: e.target.value };
                          setSteps(next);
                        }}
                      />
                      <input
                        className="input input-sm"
                        value={step.data}
                        placeholder="Data uji (opsional)"
                        onChange={(e) => {
                          const next = [...steps];
                          next[i] = { ...step, data: e.target.value };
                          setSteps(next);
                        }}
                      />
                    </div>
                  </div>
                ))}
                <button
                  className="btn btn-sm"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => setSteps([...steps, { action: '', expected: '', data: '' }])}
                >
                  + Tambah Langkah
                </button>
              </div>
            </div>

            <KeyValueEditor
              label="Data Uji"
              values={testData}
              onChange={setTestData}
            />

            <Field label="Hasil yang Diharapkan">
              <textarea
                className="textarea"
                value={form.expected_result}
                placeholder="Keranjang berisi 1 produk dengan harga yang benar"
                onChange={(e) => setForm({ ...form, expected_result: e.target.value })}
              />
            </Field>

            <Field label="Tags" hint="Pisahkan dengan koma">
              <input
                className="input"
                value={form.tags}
                placeholder="smoke, checkout, prioritas-tinggi"
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
              />
            </Field>
          </div>
        </Modal>
      ) : null}

      {toDelete ? (
        <ConfirmDialog
          title="Hapus Test Case?"
          danger
          confirmLabel="Hapus"
          message={
            <>
              Test case <b>{toDelete.code}</b> — {toDelete.title} beserta seluruh langkahnya akan
              dihapus.
            </>
          }
          onCancel={() => setToDelete(null)}
          onConfirm={() => void remove()}
        />
      ) : null}

      <style>{`
        .tc-step { display: flex; flex-direction: column; gap: 6px; padding: var(--space-3); }
      `}</style>
    </>
  );
}
