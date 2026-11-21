/**
 * Scenarios page — stage 3 of the lifecycle.
 * Grouped by use case, Given/When/Then editor, kind filter, and AI generation per use case.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Priority, Scenario } from '@qatools/shared';
import { PRIORITIES, PRIORITY_LABEL, PRIORITY_TONE } from '@qatools/shared';
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
} from '../../components';

type ScenarioKind = Scenario['kind'];

interface ScenarioRow extends Scenario {
  use_case?: { id: string; code: string; name: string } | null;
  test_case_count?: number;
}

interface UseCaseOption {
  id: string;
  code: string;
  name: string;
}

const KINDS: ScenarioKind[] = [
  'happy_path',
  'alternative',
  'negative',
  'edge',
  'security',
  'performance',
];

const KIND_LABEL: Record<ScenarioKind, string> = {
  happy_path: 'Jalur Bahagia',
  alternative: 'Alternatif',
  negative: 'Negatif',
  edge: 'Nilai Batas',
  security: 'Keamanan',
  performance: 'Performa',
};

const KIND_TONE: Record<ScenarioKind, 'ok' | 'info' | 'warn' | 'err' | 'accent' | 'muted'> = {
  happy_path: 'ok',
  alternative: 'info',
  negative: 'err',
  edge: 'warn',
  security: 'accent',
  performance: 'muted',
};

interface FormState {
  use_case_id: string;
  title: string;
  kind: ScenarioKind;
  given_text: string;
  when_text: string;
  then_text: string;
  priority: Priority;
}

const EMPTY_FORM: FormState = {
  use_case_id: '',
  title: '',
  kind: 'happy_path',
  given_text: '',
  when_text: '',
  then_text: '',
  priority: 'medium',
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

export default function ScenariosPage() {
  const { projectId } = useProject();
  const [rows, setRows] = useState<ScenarioRow[]>([]);
  const [useCases, setUseCases] = useState<UseCaseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [kindFilter, setKindFilter] = useState<'' | ScenarioKind>('');
  const [useCaseFilter, setUseCaseFilter] = useState('');
  const [search, setSearch] = useState('');

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ScenarioRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<ScenarioRow | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [scenarios, ucs] = await Promise.all([
        listOf<ScenarioRow>(`/projects/${projectId}/scenarios`, {
          kind: kindFilter || undefined,
          use_case_id: useCaseFilter || undefined,
        }),
        listOf<UseCaseOption>(`/projects/${projectId}/usecases`),
      ]);
      setRows(scenarios);
      setUseCases(ucs);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [projectId, kindFilter, useCaseFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Group by use case so the ordered lifecycle is visually obvious. */
  const grouped = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (!search) return true;
      const needle = search.toLowerCase();
      return (
        r.title.toLowerCase().includes(needle) ||
        r.code.toLowerCase().includes(needle) ||
        (r.given_text ?? '').toLowerCase().includes(needle) ||
        (r.when_text ?? '').toLowerCase().includes(needle) ||
        (r.then_text ?? '').toLowerCase().includes(needle)
      );
    });

    const map = new Map<string, { key: string; label: string; code: string; items: ScenarioRow[] }>();
    for (const row of filtered) {
      const key = row.use_case?.id ?? '__none__';
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: row.use_case?.name ?? 'Skenario tanpa use case',
          code: row.use_case?.code ?? '—',
          items: [],
        });
      }
      map.get(key)?.items.push(row);
    }
    return [...map.values()];
  }, [rows, search]);

  const stats = useMemo(() => {
    const withCases = rows.filter((r) => (r.test_case_count ?? 0) > 0).length;
    return {
      total: rows.length,
      withCases,
      withoutCases: rows.length - withCases,
      negative: rows.filter((r) => r.kind === 'negative' || r.kind === 'edge').length,
    };
  }, [rows]);

  function openCreate(presetUseCase?: string) {
    setForm({ ...EMPTY_FORM, use_case_id: presetUseCase ?? useCaseFilter ?? '' });
    setCreating(true);
    setEditing(null);
  }

  function openEdit(row: ScenarioRow) {
    setForm({
      use_case_id: row.use_case_id ?? '',
      title: row.title,
      kind: row.kind,
      given_text: row.given_text ?? '',
      when_text: row.when_text ?? '',
      then_text: row.then_text ?? '',
      priority: row.priority,
    });
    setEditing(row);
    setCreating(false);
  }

  function closeModal() {
    setCreating(false);
    setEditing(null);
  }

  async function save() {
    if (!form.title.trim()) {
      toast.err('Judul skenario wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        use_case_id: form.use_case_id || null,
        title: form.title.trim(),
        kind: form.kind,
        given_text: form.given_text.trim() || null,
        when_text: form.when_text.trim() || null,
        then_text: form.then_text.trim() || null,
        priority: form.priority,
      };
      if (editing) {
        await api.patch(`/scenarios/${editing.id}`, payload);
        toast.ok(`${editing.code} diperbarui.`);
      } else {
        await api.post(`/projects/${projectId}/scenarios`, payload);
        toast.ok('Skenario dibuat.');
      }
      closeModal();
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal menyimpan skenario');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!toDelete) return;
    try {
      await api.del(`/scenarios/${toDelete.id}`);
      toast.ok(`${toDelete.code} dihapus.`);
      setToDelete(null);
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal menghapus skenario');
    }
  }

  async function generateFor(useCaseId: string, code: string) {
    setAiBusy(useCaseId);
    try {
      await api.post(`/projects/${projectId}/ai/generate`, {
        task: 'generate_scenarios',
        project_id: projectId,
        input: { use_case_ids: [useCaseId], per_use_case: 3 },
        persist: true,
        input_ref: useCaseId,
      });
      toast.ok(`AI membuat skenario untuk ${code}.`);
      await load();
    } catch (err) {
      toast.warn(aiMessage(err));
    } finally {
      setAiBusy(null);
    }
  }

  if (loading && !rows.length) return <Loading label="Memuat skenario…" />;
  if (error) return <ErrorBox error={error} onRetry={() => void load()} />;

  return (
    <>
      <PageHeader
        title="Skenario"
        subtitle="Tahap 3: turunkan setiap use case menjadi skenario Given/When/Then — jalur bahagia, alternatif, negatif, nilai batas, keamanan, dan performa."
        actions={
          <button className="btn btn-primary" onClick={() => openCreate()}>
            + Skenario
          </button>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="stat">
          <span className="stat-label">Total Skenario</span>
          <span className="stat-value">{stats.total}</span>
        </div>
        <div className="stat stat-ok">
          <span className="stat-label">Sudah Punya Test Case</span>
          <span className="stat-value">{stats.withCases}</span>
        </div>
        <div className="stat stat-warn">
          <span className="stat-label">Belum Diturunkan</span>
          <span className="stat-value">{stats.withoutCases}</span>
        </div>
        <div className="stat stat-err">
          <span className="stat-label">Negatif / Batas</span>
          <span className="stat-value">{stats.negative}</span>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="input input-sm search"
          placeholder="🔍 Cari skenario…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="select input-sm"
          style={{ maxWidth: 190 }}
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as '' | ScenarioKind)}
        >
          <option value="">Semua jenis</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <select
          className="select input-sm"
          style={{ maxWidth: 250 }}
          value={useCaseFilter}
          onChange={(e) => setUseCaseFilter(e.target.value)}
        >
          <option value="">Semua use case</option>
          {useCases.map((u) => (
            <option key={u.id} value={u.id}>
              {u.code} · {u.name}
            </option>
          ))}
        </select>
        <span className="spacer" />
        {useCaseFilter ? (
          <button
            className="btn btn-sm"
            disabled={aiBusy === useCaseFilter}
            onClick={() => void generateFor(useCaseFilter, useCases.find((u) => u.id === useCaseFilter)?.code ?? '')}
          >
            {aiBusy === useCaseFilter ? '⏳' : '✨ Generate dengan AI'}
          </button>
        ) : null}
      </div>

      {grouped.length === 0 ? (
        <Empty
          icon="🧭"
          title="Belum ada skenario"
          subtitle="Skenario diturunkan dari use case. Tambahkan manual, atau gunakan AI pada halaman Use Case untuk membuatnya otomatis."
          action={
            <div className="row" style={{ justifyContent: 'center' }}>
              <Link className="btn" to="/usecases">
                📘 Buka Use Case
              </Link>
              <button className="btn btn-primary" onClick={() => openCreate()}>
                + Skenario
              </button>
            </div>
          }
        />
      ) : (
        <div className="stack stack-lg">
          {grouped.map((group) => (
            <div key={group.key}>
              <div className="row-between sc-group-head">
                <div className="row" style={{ gap: 'var(--space-2)', minWidth: 0 }}>
                  <span className="chip chip-active">{group.code}</span>
                  <span className="strong truncate">{group.label}</span>
                  <Badge tone="muted">{group.items.length} skenario</Badge>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  {group.key !== '__none__' ? (
                    <button
                      className="btn btn-sm"
                      disabled={aiBusy === group.key}
                      onClick={() => void generateFor(group.key, group.code)}
                    >
                      {aiBusy === group.key ? '⏳ AI bekerja…' : '✨ Generate dengan AI'}
                    </button>
                  ) : null}
                  <button className="btn btn-sm" onClick={() => openCreate(group.key === '__none__' ? '' : group.key)}>
                    + Skenario
                  </button>
                </div>
              </div>

              <div className="stack stack-sm" style={{ marginTop: 'var(--space-3)' }}>
                {group.items.map((row) => (
                  <div className="card sc-card" key={row.id}>
                    <div className="row-between" style={{ alignItems: 'flex-start' }}>
                      <div className="row" style={{ gap: 'var(--space-2)', minWidth: 0 }}>
                        <span className="cell-mono">{row.code}</span>
                        <span className="strong">{row.title}</span>
                      </div>
                      <div className="row" style={{ gap: 4 }}>
                        <Badge tone={KIND_TONE[row.kind]}>{KIND_LABEL[row.kind]}</Badge>
                        <Badge tone={PRIORITY_TONE[row.priority]}>{PRIORITY_LABEL[row.priority]}</Badge>
                      </div>
                    </div>

                    <div className="sc-gwt">
                      <div className="sc-gwt-cell">
                        <span className="sc-gwt-key">GIVEN</span>
                        <span>{row.given_text ?? '—'}</span>
                      </div>
                      <div className="sc-gwt-cell">
                        <span className="sc-gwt-key">WHEN</span>
                        <span>{row.when_text ?? '—'}</span>
                      </div>
                      <div className="sc-gwt-cell">
                        <span className="sc-gwt-key">THEN</span>
                        <span>{row.then_text ?? '—'}</span>
                      </div>
                    </div>

                    <div className="row-between" style={{ marginTop: 'var(--space-2)' }}>
                      <span className="mute-sm">
                        {row.test_case_count
                          ? `🧪 ${row.test_case_count} test case`
                          : '⚠️ belum ada test case'}
                      </span>
                      <div className="row" style={{ gap: 4 }}>
                        <button className="btn btn-ghost btn-sm" title="Ubah" onClick={() => openEdit(row)}>
                          ✏️
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          title="Hapus"
                          onClick={() => setToDelete(row)}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {creating || editing ? (
        <Modal
          title={editing ? `Ubah ${editing.code}` : 'Skenario Baru'}
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
            <Field label="Use Case Induk" hint="Skenario tanpa use case tidak akan muncul di matriks">
              <select
                className="select"
                value={form.use_case_id}
                onChange={(e) => setForm({ ...form, use_case_id: e.target.value })}
              >
                <option value="">— tanpa use case —</option>
                {useCases.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code} · {u.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Judul Skenario" required>
              <input
                className="input"
                value={form.title}
                placeholder="Menambahkan produk yang tersedia"
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>

            <div className="grid grid-2">
              <Field label="Jenis">
                <select
                  className="select"
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value as ScenarioKind })}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
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
            </div>

            <div className="card sc-gwt-editor">
              <Field label="GIVEN — kondisi awal">
                <textarea
                  className="textarea"
                  value={form.given_text}
                  placeholder="Pengguna berada di halaman detail produk dan sudah login"
                  onChange={(e) => setForm({ ...form, given_text: e.target.value })}
                />
              </Field>
              <Field label="WHEN — aksi yang dilakukan">
                <textarea
                  className="textarea"
                  value={form.when_text}
                  placeholder="Pengguna menekan tombol Tambah ke Keranjang"
                  onChange={(e) => setForm({ ...form, when_text: e.target.value })}
                />
              </Field>
              <Field label="THEN — hasil yang diharapkan">
                <textarea
                  className="textarea"
                  value={form.then_text}
                  placeholder="Produk muncul di keranjang dengan jumlah 1"
                  onChange={(e) => setForm({ ...form, then_text: e.target.value })}
                />
              </Field>
            </div>
          </div>
        </Modal>
      ) : null}

      {toDelete ? (
        <ConfirmDialog
          title="Hapus Skenario?"
          danger
          confirmLabel="Hapus"
          message={
            <>
              Skenario <b>{toDelete.code}</b> — {toDelete.title} akan dihapus. Test case turunannya
              tetap ada tetapi kehilangan induk skenario.
            </>
          }
          onCancel={() => setToDelete(null)}
          onConfirm={() => void remove()}
        />
      ) : null}

      <style>{`
        .sc-group-head {
          padding-bottom: var(--space-2);
          border-bottom: 1px solid var(--border-strong);
        }
        .sc-card { display: flex; flex-direction: column; }
        .sc-gwt { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); margin-top: var(--space-3); }
        @media (max-width: 900px) { .sc-gwt { grid-template-columns: minmax(0, 1fr); } }
        .sc-gwt-cell { display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; }
        .sc-gwt-key { font-size: 10px; font-weight: 800; letter-spacing: 0.8px; color: var(--accent-hover); }
        .sc-gwt-editor .field + .field { margin-top: var(--space-3); }
      `}</style>
    </>
  );
}
