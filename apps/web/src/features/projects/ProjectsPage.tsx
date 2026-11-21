/**
 * Projects page — the entry point of the whole QA lifecycle.
 * Grid of project cards, create/edit modal, delete confirm, click to select + navigate.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '@qatools/shared';
import { api, listOf, ApiError } from '../../lib/api';
import { toast } from '../../lib/toast';
import { useProject } from '../../lib/project';
import {
  PageHeader,
  Card,
  Modal,
  Field,
  ConfirmDialog,
  Loading,
  ErrorBox,
  Empty,
  Badge,
  Stat,
} from '../../components';

interface ProjectWithCounts extends Project {
  counts?: {
    requirements: number;
    use_cases: number;
    scenarios: number;
    test_cases: number;
  };
}

interface FormState {
  key: string;
  name: string;
  description: string;
  target_url: string;
  owner: string;
  quality_gate: number;
  status: 'active' | 'on_hold' | 'archived';
}

const EMPTY_FORM: FormState = {
  key: '',
  name: '',
  description: '',
  target_url: '',
  owner: '',
  quality_gate: 90,
  status: 'active',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Aktif',
  on_hold: 'Ditahan',
  archived: 'Diarsipkan',
};

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'muted'> = {
  active: 'ok',
  on_hold: 'warn',
  archived: 'muted',
};

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { projectId, selectProject, reload: reloadContext } = useProject();

  const [projects, setProjects] = useState<ProjectWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<ProjectWithCounts | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<ProjectWithCounts | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listOf<ProjectWithCounts>('/projects');
      setProjects(rows);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    return projects.reduce(
      (acc, p) => ({
        requirements: acc.requirements + (p.counts?.requirements ?? 0),
        useCases: acc.useCases + (p.counts?.use_cases ?? 0),
        scenarios: acc.scenarios + (p.counts?.scenarios ?? 0),
        testCases: acc.testCases + (p.counts?.test_cases ?? 0),
      }),
      { requirements: 0, useCases: 0, scenarios: 0, testCases: 0 },
    );
  }, [projects]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setCreating(true);
    setEditing(null);
  }

  function openEdit(project: ProjectWithCounts) {
    setForm({
      key: project.key,
      name: project.name,
      description: project.description ?? '',
      target_url: project.target_url ?? '',
      owner: project.owner ?? '',
      quality_gate: project.quality_gate,
      status: project.status,
    });
    setEditing(project);
    setCreating(false);
  }

  function closeModal() {
    setCreating(false);
    setEditing(null);
  }

  async function save() {
    if (!form.key.trim()) {
      toast.err('Key project wajib diisi.');
      return;
    }
    if (!form.name.trim()) {
      toast.err('Nama project wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        key: form.key.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        target_url: form.target_url.trim() || null,
        owner: form.owner.trim() || null,
        quality_gate: Number(form.quality_gate),
        status: form.status,
      };

      if (editing) {
        await api.patch<{ data: Project }>(`/projects/${editing.id}`, payload);
        toast.ok(`Project ${payload.key} diperbarui.`);
      } else {
        const res = await api.post<{ data: Project }>('/projects', payload);
        toast.ok(`Project ${payload.key} dibuat.`);
        if (res?.data?.id) selectProject(res.data.id);
      }
      closeModal();
      await load();
      await reloadContext();
    } catch (err) {
      toast.fromError(err, 'Gagal menyimpan project');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      const counts = toDelete.counts;
      const total =
        (counts?.requirements ?? 0) +
        (counts?.use_cases ?? 0) +
        (counts?.scenarios ?? 0) +
        (counts?.test_cases ?? 0);
      const force = total > 0 ? '?force=true' : '';
      await api.del(`/projects/${toDelete.id}${force}`);
      toast.ok(`Project ${toDelete.key} dihapus.`);
      setToDelete(null);
      await load();
      await reloadContext();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.warn(err.message);
      } else {
        toast.fromError(err, 'Gagal menghapus project');
      }
    } finally {
      setDeleting(false);
    }
  }

  function openProject(project: ProjectWithCounts) {
    selectProject(project.id);
    navigate('/requirements');
  }

  if (loading) return <Loading label="Memuat daftar project…" />;
  if (error) return <ErrorBox error={error} onRetry={() => void load()} />;

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Setiap project adalah satu unit QA: target yang diuji, quality gate rilis, dan seluruh artefak dari kebutuhan sampai sertifikat."
        actions={
          <button className="btn btn-primary" onClick={openCreate}>
            + Project Baru
          </button>
        }
      />

      {projects.length > 0 ? (
        <div className="grid grid-4" style={{ marginBottom: 'var(--space-5)' }}>
          <Stat label="Project" value={projects.length} />
          <Stat label="Kebutuhan" value={totals.requirements} tone="info" />
          <Stat label="Use Case" value={totals.useCases} tone="accent" />
          <Stat label="Test Case" value={totals.testCases} tone="ok" />
        </div>
      ) : null}

      {projects.length === 0 ? (
        <Empty
          icon="📁"
          title="Belum ada project"
          subtitle="Buat project QA pertama Anda. Alurnya: kebutuhan → use case → skenario → test case → traceability matrix → eksekusi → regresi → rilis."
          action={
            <button className="btn btn-primary" onClick={openCreate}>
              Buat Project Pertama
            </button>
          }
        />
      ) : (
        <div className="grid grid-auto">
          {projects.map((project) => {
            const counts = project.counts;
            const active = project.id === projectId;
            return (
              <Card
                key={project.id}
                className={active ? 'pj-card pj-active' : 'pj-card'}
                onClick={() => openProject(project)}
              >
                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      <span className="chip chip-active">{project.key}</span>
                      <Badge tone={STATUS_TONE[project.status] ?? 'muted'}>
                        {STATUS_LABEL[project.status] ?? project.status}
                      </Badge>
                    </div>
                    <div className="strong" style={{ marginTop: 'var(--space-2)' }}>
                      {project.name}
                    </div>
                  </div>
                  {active ? <Badge tone="accent">Aktif</Badge> : null}
                </div>

                {project.description ? (
                  <p className="card-sub clamp-2" style={{ marginTop: 'var(--space-2)' }}>
                    {project.description}
                  </p>
                ) : null}

                {project.target_url ? (
                  <div className="mute-sm truncate" title={project.target_url}>
                    🔗 {project.target_url}
                  </div>
                ) : null}

                <div className="pj-counts">
                  <span className="chip" title="Kebutuhan">📋 {counts?.requirements ?? 0}</span>
                  <span className="chip" title="Use case">📘 {counts?.use_cases ?? 0}</span>
                  <span className="chip" title="Skenario">🧭 {counts?.scenarios ?? 0}</span>
                  <span className="chip" title="Test case">🧪 {counts?.test_cases ?? 0}</span>
                </div>

                <div className="row-between" style={{ marginTop: 'var(--space-3)' }}>
                  <span className="mute-sm">Gate rilis {project.quality_gate}%</span>
                  <div className="row" style={{ gap: 4 }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      title="Ubah project"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(project);
                      }}
                    >
                      ✏️
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      title="Hapus project"
                      onClick={(e) => {
                        e.stopPropagation();
                        setToDelete(project);
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {creating || editing ? (
        <Modal
          title={editing ? `Ubah Project ${editing.key}` : 'Project Baru'}
          onClose={closeModal}
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
            <div className="grid grid-2">
              <Field label="Key" required hint="Kode pendek unik, contoh: SHOP">
                <input
                  className="input"
                  value={form.key}
                  placeholder="SHOP"
                  onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label="Nama Project" required>
                <input
                  className="input"
                  value={form.name}
                  placeholder="Toko Online"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Deskripsi">
              <textarea
                className="textarea"
                value={form.description}
                placeholder="Ruang lingkup QA, fitur utama, dan konteks bisnis."
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>

            <div className="grid grid-2">
              <Field label="Target URL" hint="Web existing yang akan dianalisis crawler">
                <input
                  className="input"
                  value={form.target_url}
                  placeholder="https://contoh.id"
                  onChange={(e) => setForm({ ...form, target_url: e.target.value })}
                />
              </Field>
              <Field label="Owner">
                <input
                  className="input"
                  value={form.owner}
                  placeholder="Nama QA lead"
                  onChange={(e) => setForm({ ...form, owner: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid grid-2">
              <Field label="Quality Gate (%)" hint="Pass rate minimum untuk lolos rilis">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  value={form.quality_gate}
                  onChange={(e) => setForm({ ...form, quality_gate: Number(e.target.value) })}
                />
              </Field>
              <Field label="Status">
                <select
                  className="select"
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as FormState['status'] })
                  }
                >
                  <option value="active">Aktif</option>
                  <option value="on_hold">Ditahan</option>
                  <option value="archived">Diarsipkan</option>
                </select>
              </Field>
            </div>

            {!editing ? (
              <div className="alert alert-info">
                <span>🖥️</span>
                <div>
                  Saat project dibuat, QATools otomatis menyiapkan satu <b>environment default</b> dari
                  Target URL agar eksekusi bisa langsung berjalan.
                </div>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {toDelete ? (
        <ConfirmDialog
          title="Hapus Project?"
          danger
          busy={deleting}
          confirmLabel="Hapus"
          message={
            <>
              Project <b>{toDelete.key}</b> beserta seluruh kebutuhan, use case, skenario, test case,
              dan link matrix-nya akan dihapus permanen.
            </>
          }
          onCancel={() => setToDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}

      <style>{`
        .pj-card { cursor: pointer; display: flex; flex-direction: column; gap: 6px; }
        .pj-active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-soft); }
        .pj-counts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: var(--space-3); }
      `}</style>
    </>
  );
}
