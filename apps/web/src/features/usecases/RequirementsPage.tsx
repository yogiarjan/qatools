/**
 * Requirements page — stage 1 of the lifecycle.
 * Table + create/edit modal, priority filter, CSV paste import, and the
 * "Generate Use Cases with AI" action (gracefully degrades if lane-ai's route is absent).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Priority, Requirement } from '@qatools/shared';
import { PRIORITIES, PRIORITY_LABEL, PRIORITY_TONE, COVERAGE_LABEL } from '@qatools/shared';
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
  DataTable,
  StringListEditor,
  type Column,
} from '../../components';

interface RequirementRow extends Requirement {
  acceptance_criteria_list?: string[];
  use_case_count?: number;
}

interface FormState {
  code: string;
  title: string;
  description: string;
  source: string;
  priority: Priority;
  status: Requirement['status'];
  acceptance_criteria: string[];
}

const EMPTY_FORM: FormState = {
  code: '',
  title: '',
  description: '',
  source: 'manual',
  priority: 'medium',
  status: 'draft',
  acceptance_criteria: [],
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  approved: 'Disetujui',
  changed: 'Berubah',
  deprecated: 'Usang',
};

const STATUS_TONE: Record<string, 'muted' | 'ok' | 'warn' | 'err'> = {
  draft: 'muted',
  approved: 'ok',
  changed: 'warn',
  deprecated: 'err',
};

/** Friendly copy for the AI route being unavailable (lane-ai not ready). */
function aiUnavailableMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404 || err.status === 503) {
      return 'Fitur AI belum tersedia di server ini. Pastikan modul AI (lane-ai) sudah aktif, lalu coba lagi.';
    }
    if (err.status === 0) {
      return 'Tidak dapat menghubungi server API. Pastikan backend berjalan.';
    }
    return err.message;
  }
  return 'Fitur AI gagal dijalankan.';
}

export default function RequirementsPage() {
  const { projectId, project } = useProject();
  const [rows, setRows] = useState<RequirementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [priorityFilter, setPriorityFilter] = useState<'' | Priority>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RequirementRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<RequirementRow | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);

  const [aiBusy, setAiBusy] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listOf<RequirementRow>(`/projects/${projectId}/requirements`, {
        priority: priorityFilter || undefined,
        q: search || undefined,
      });
      setRows(data);
      setSelected(new Set());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [projectId, priorityFilter, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const covered = rows.filter((r) => (r.use_case_count ?? 0) > 0).length;
    return {
      total: rows.length,
      covered,
      gaps: rows.length - covered,
      critical: rows.filter((r) => r.priority === 'critical').length,
    };
  }, [rows]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setCreating(true);
    setEditing(null);
  }

  function openEdit(row: RequirementRow) {
    setForm({
      code: row.code,
      title: row.title,
      description: row.description ?? '',
      source: row.source ?? '',
      priority: row.priority,
      status: row.status,
      acceptance_criteria: row.acceptance_criteria_list ?? [],
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
      toast.err('Judul kebutuhan wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim() || undefined,
        title: form.title.trim(),
        description: form.description.trim() || null,
        source: form.source.trim() || null,
        priority: form.priority,
        status: form.status,
        acceptance_criteria_list: form.acceptance_criteria.filter((s) => s.trim() !== ''),
      };
      if (editing) {
        await api.patch(`/requirements/${editing.id}`, payload);
        toast.ok(`${editing.code} diperbarui.`);
      } else {
        await api.post(`/projects/${projectId}/requirements`, payload);
        toast.ok('Kebutuhan dibuat.');
      }
      closeModal();
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal menyimpan kebutuhan');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!toDelete) return;
    try {
      await api.del(`/requirements/${toDelete.id}`);
      toast.ok(`${toDelete.code} dihapus.`);
      setToDelete(null);
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal menghapus kebutuhan');
    }
  }

  async function runImport() {
    if (!importText.trim()) {
      toast.err('Tempel dulu baris kebutuhan yang ingin diimpor.');
      return;
    }
    setImporting(true);
    try {
      const res = await api.post<{ data: unknown[]; total: number; skipped: string[] }>(
        `/projects/${projectId}/requirements/bulk`,
        { text: importText },
      );
      const created = res?.total ?? res?.data?.length ?? 0;
      toast.ok(`${created} kebutuhan diimpor.`);
      if (res?.skipped?.length) {
        toast.warn(`${res.skipped.length} baris dilewati (kode duplikat / tanpa judul).`);
      }
      setImportOpen(false);
      setImportText('');
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal mengimpor');
    } finally {
      setImporting(false);
    }
  }

  async function generateUseCases(ids: string[]) {
    if (!ids.length) {
      toast.warn('Pilih minimal satu kebutuhan untuk diturunkan menjadi use case.');
      return;
    }
    setAiBusy(true);
    try {
      await api.post(`/projects/${projectId}/ai/generate`, {
        task: 'generate_usecases',
        project_id: projectId,
        input: { requirement_ids: ids },
        persist: true,
      });
      toast.ok(`AI selesai membuat use case dari ${ids.length} kebutuhan.`);
      setSelected(new Set());
      await load();
    } catch (err) {
      toast.warn(aiUnavailableMessage(err));
    } finally {
      setAiBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const columns: Array<Column<RequirementRow>> = [
    {
      key: 'select',
      header: '',
      width: '34px',
      render: (row) => (
        <input
          className="checkbox"
          type="checkbox"
          checked={selected.has(row.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggle(row.id)}
        />
      ),
    },
    { key: 'code', header: 'Kode', width: '92px', render: (r) => <span className="cell-mono">{r.code}</span> },
    {
      key: 'title',
      header: 'Kebutuhan',
      render: (r) => (
        <div className="stack stack-sm">
          <span className="strong">{r.title}</span>
          {r.description ? <span className="mute-sm clamp-2">{r.description}</span> : null}
        </div>
      ),
    },
    {
      key: 'priority',
      header: 'Prioritas',
      width: '104px',
      render: (r) => <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABEL[r.priority]}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '104px',
      render: (r) => (
        <Badge tone={STATUS_TONE[r.status] ?? 'muted'}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
      ),
    },
    {
      key: 'coverage',
      header: 'Jejak',
      width: '120px',
      render: (r) =>
        (r.use_case_count ?? 0) > 0 ? (
          <Badge tone="ok">{r.use_case_count} use case</Badge>
        ) : (
          <Badge tone="err" title="Belum diturunkan ke use case">
            {COVERAGE_LABEL.gap}
          </Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      width: '96px',
      align: 'right',
      render: (r) => (
        <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          <button
            className="btn btn-ghost btn-sm"
            title="Ubah"
            onClick={(e) => {
              e.stopPropagation();
              openEdit(r);
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

  if (loading && !rows.length) return <Loading label="Memuat kebutuhan…" />;
  if (error) return <ErrorBox error={error} onRetry={() => void load()} />;

  return (
    <>
      <PageHeader
        title="Kebutuhan"
        subtitle={
          <>
            Tahap 1 dari alur QA. Kumpulkan kebutuhan dari stakeholder atau dari hasil analisis web
            existing, lalu turunkan menjadi use case.
            {project ? <> Project aktif: <b>{project.key}</b>.</> : null}
          </>
        }
        actions={
          <>
            <button className="btn" onClick={() => setImportOpen(true)}>
              📥 Import CSV
            </button>
            <button className="btn" onClick={openCreate}>
              + Kebutuhan
            </button>
            <button
              className="btn btn-primary"
              disabled={aiBusy}
              onClick={() => void generateUseCases([...selected])}
              title="Ubah kebutuhan terpilih menjadi use case dengan AI"
            >
              {aiBusy ? '⏳ AI bekerja…' : `✨ Generate Use Cases with AI${selected.size ? ` (${selected.size})` : ''}`}
            </button>
          </>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="stat">
          <span className="stat-label">Total Kebutuhan</span>
          <span className="stat-value">{stats.total}</span>
        </div>
        <div className="stat stat-ok">
          <span className="stat-label">Sudah Diturunkan</span>
          <span className="stat-value">{stats.covered}</span>
        </div>
        <div className="stat stat-err">
          <span className="stat-label">Gap</span>
          <span className="stat-value">{stats.gaps}</span>
        </div>
        <div className="stat stat-warn">
          <span className="stat-label">Prioritas Kritis</span>
          <span className="stat-value">{stats.critical}</span>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="input input-sm search"
          placeholder="🔍 Cari kode, judul, atau deskripsi…"
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
        {selected.size > 0 ? (
          <span className="chip chip-active">
            {selected.size} dipilih
            <span className="chip-remove" onClick={() => setSelected(new Set())}>
              ✕
            </span>
          </span>
        ) : null}
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set(rows.map((r) => r.id)))}>
          Pilih semua
        </button>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        empty={
          <Empty
            icon="📋"
            title="Belum ada kebutuhan"
            subtitle="Tambahkan kebutuhan satu per satu, tempel daftar dari spreadsheet lewat Import CSV, atau analisis web existing di halaman Analyzer."
            action={
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn" onClick={() => setImportOpen(true)}>
                  📥 Import CSV
                </button>
                <Link className="btn" to="/site-analyzer">
                  🔍 Analisis Web Existing
                </Link>
                <button className="btn btn-primary" onClick={openCreate}>
                  + Kebutuhan
                </button>
              </div>
            }
          />
        }
      />

      {creating || editing ? (
        <Modal
          title={editing ? `Ubah ${editing.code}` : 'Kebutuhan Baru'}
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
            <div className="grid grid-3">
              <Field label="Kode" hint="Kosongkan untuk REQ-otomatis">
                <input
                  className="input"
                  value={form.code}
                  placeholder="REQ-001"
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
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
              <Field label="Status">
                <select
                  className="select"
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as Requirement['status'] })
                  }
                >
                  <option value="draft">Draft</option>
                  <option value="approved">Disetujui</option>
                  <option value="changed">Berubah</option>
                  <option value="deprecated">Usang</option>
                </select>
              </Field>
            </div>

            <Field label="Judul Kebutuhan" required>
              <input
                className="input"
                value={form.title}
                placeholder="Pengguna dapat menambahkan barang ke keranjang"
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>

            <Field label="Deskripsi">
              <textarea
                className="textarea"
                value={form.description}
                placeholder="Konteks, aturan bisnis, dan batasan."
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>

            <Field label="Sumber" hint="stakeholder / dokumen / halaman web hasil crawl">
              <input
                className="input"
                value={form.source}
                placeholder="stakeholder"
                onChange={(e) => setForm({ ...form, source: e.target.value })}
              />
            </Field>

            <StringListEditor
              label="Kriteria Penerimaan"
              values={form.acceptance_criteria}
              onChange={(next) => setForm({ ...form, acceptance_criteria: next })}
              placeholder="Contoh: produk muncul di keranjang dalam 1 detik"
              addLabel="Tambah kriteria"
            />
          </div>
        </Modal>
      ) : null}

      {importOpen ? (
        <Modal
          title="Import Kebutuhan (tempel CSV)"
          onClose={() => setImportOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setImportOpen(false)} disabled={importing}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={() => void runImport()} disabled={importing}>
                {importing ? 'Mengimpor…' : 'Impor'}
              </button>
            </>
          }
        >
          <div className="stack">
            <div className="alert alert-info">
              <span>💡</span>
              <div>
                Satu baris satu kebutuhan. Format yang diterima:
                <div className="pre" style={{ marginTop: 8 }}>
                  {`Judul saja\nREQ-010, Judul kebutuhan, deskripsi, high, draft\n"Judul dengan, koma", deskripsi`}
                </div>
                Kode otomatis diberikan bila kolom pertama bukan kode <code>REQ-nnn</code>. Baris
                berjudul <code>code,title</code> dilewati sebagai header.
              </div>
            </div>
            <Field label="Tempel data di sini">
              <textarea
                className="textarea"
                style={{ minHeight: 200, fontFamily: 'var(--mono)', fontSize: 12.5 }}
                value={importText}
                placeholder={'Checkout berhasil, Pelanggan dapat menyelesaikan pembayaran, critical\nRiwayat pesanan tampil'}
                onChange={(e) => setImportText(e.target.value)}
              />
            </Field>
          </div>
        </Modal>
      ) : null}

      {toDelete ? (
        <ConfirmDialog
          title="Hapus Kebutuhan?"
          danger
          confirmLabel="Hapus"
          message={
            <>
              Kebutuhan <b>{toDelete.code}</b> — {toDelete.title} akan dihapus beserta link matrix-nya.
              Use case yang sudah dibuat tidak ikut terhapus.
            </>
          }
          onCancel={() => setToDelete(null)}
          onConfirm={() => void remove()}
        />
      ) : null}
    </>
  );
}
