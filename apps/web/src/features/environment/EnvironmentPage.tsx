/**
 * EnvironmentPage — lifecycle stage 7 (environment & test data).
 *
 * Environment CRUD with key/value variable editor and a single-default toggle, plus a
 * test-data set editor (columns + rows grid) that the automation engines consume.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Environment, TestDataSet } from '@qatools/shared';
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
  ConfirmDialog,
  KeyValueEditor,
  fmtDateTime,
} from '../../components';

const KINDS = ['dev', 'staging', 'uat', 'prod', 'local'] as const;

const KIND_TONE: Record<string, 'ok' | 'warn' | 'err' | 'info' | 'accent' | 'muted'> = {
  dev: 'info',
  staging: 'accent',
  uat: 'warn',
  prod: 'err',
  local: 'muted',
};

const EMPTY_ENV = {
  name: '',
  base_url: '',
  api_base: '',
  db_uri: '',
  kind: 'staging',
  notes: '',
  variables: {} as Record<string, string>,
};

interface DataSetDraft {
  name: string;
  description: string;
  environment_id: string;
  columns: string[];
  rows: Array<Record<string, string>>;
}

const EMPTY_DATASET: DataSetDraft = {
  name: '',
  description: '',
  environment_id: '',
  columns: ['field', 'value'],
  rows: [{ field: '', value: '' }],
};

export default function EnvironmentPage() {
  const { projectId } = useProject();

  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [dataSets, setDataSets] = useState<TestDataSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const [envModal, setEnvModal] = useState<{ id: string | null } | null>(null);
  const [envForm, setEnvForm] = useState({ ...EMPTY_ENV });

  const [dsModal, setDsModal] = useState<{ id: string | null } | null>(null);
  const [dsForm, setDsForm] = useState<DataSetDraft>({ ...EMPTY_DATASET });

  const [confirm, setConfirm] = useState<{ kind: 'env' | 'dataset'; id: string; name: string } | null>(null);

  /* --------------------------------- load -------------------------------- */

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [envs, sets] = await Promise.all([
        listOf<Environment>(`/projects/${projectId}/environments`),
        listOf<TestDataSet>(`/projects/${projectId}/testdata`).catch(() => []),
      ]);
      setEnvironments(envs);
      setDataSets(sets);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ------------------------------- env CRUD ------------------------------ */

  function openEnvModal(env?: Environment) {
    if (env) {
      let variables: Record<string, string> = {};
      try {
        variables = env.variables ? (JSON.parse(env.variables) as Record<string, string>) : {};
      } catch {
        variables = {};
      }
      setEnvForm({
        name: env.name,
        base_url: env.base_url ?? '',
        api_base: env.api_base ?? '',
        db_uri: env.db_uri ?? '',
        kind: env.kind,
        notes: env.notes ?? '',
        variables,
      });
      setEnvModal({ id: env.id });
    } else {
      setEnvForm({ ...EMPTY_ENV });
      setEnvModal({ id: null });
    }
  }

  async function saveEnv() {
    if (!projectId || !envForm.name.trim()) return;
    setBusy(true);
    try {
      const payload = {
        name: envForm.name.trim(),
        base_url: envForm.base_url.trim() || null,
        api_base: envForm.api_base.trim() || null,
        db_uri: envForm.db_uri.trim() || null,
        kind: envForm.kind,
        notes: envForm.notes.trim() || null,
        variables: envForm.variables,
      };
      if (envModal?.id) {
        await api.patch(`/environments/${envModal.id}`, payload);
        toast.ok('Environment diperbarui');
      } else {
        await api.post(`/projects/${projectId}/environments`, payload);
        toast.ok('Environment dibuat');
      }
      setEnvModal(null);
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal menyimpan environment');
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(id: string) {
    try {
      await api.post(`/environments/${id}/default`, {});
      toast.ok('Environment default diperbarui');
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal mengubah default');
    }
  }

  /* ----------------------------- dataset CRUD ---------------------------- */

  function openDsModal(ds?: TestDataSet) {
    if (ds) {
      let columns: string[] = [];
      let rows: Array<Record<string, string>> = [];
      try {
        columns = ds.columns ? (JSON.parse(ds.columns) as string[]) : [];
      } catch {
        columns = [];
      }
      try {
        rows = ds.rows ? (JSON.parse(ds.rows) as Array<Record<string, string>>) : [];
      } catch {
        rows = [];
      }
      if (!columns.length && rows.length) columns = Object.keys(rows[0]!);
      setDsForm({
        name: ds.name,
        description: ds.description ?? '',
        environment_id: ds.environment_id ?? '',
        columns,
        rows: rows.length ? rows : [{}],
      });
      setDsModal({ id: ds.id });
    } else {
      setDsForm({ ...EMPTY_DATASET, environment_id: environments.find((e) => e.is_default)?.id ?? '' });
      setDsModal({ id: null });
    }
  }

  async function saveDataSet() {
    if (!projectId || !dsForm.name.trim()) return;
    setBusy(true);
    try {
      const payload = {
        name: dsForm.name.trim(),
        description: dsForm.description.trim() || null,
        environment_id: dsForm.environment_id || null,
        columns: dsForm.columns,
        rows: dsForm.rows,
      };
      if (dsModal?.id) {
        await api.patch(`/testdata/${dsModal.id}`, payload);
        toast.ok('Test data diperbarui');
      } else {
        await api.post(`/projects/${projectId}/testdata`, payload);
        toast.ok('Test data dibuat');
      }
      setDsModal(null);
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal menyimpan test data');
    } finally {
      setBusy(false);
    }
  }

  async function deleteConfirmed() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'env') await api.del(`/environments/${confirm.id}`);
      else await api.del(`/testdata/${confirm.id}`);
      toast.ok('Dihapus');
      setConfirm(null);
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal menghapus');
    } finally {
      setBusy(false);
    }
  }

  /* --------------------------- dataset grid ops -------------------------- */

  function addColumn() {
    const name = `kolom_${dsForm.columns.length + 1}`;
    setDsForm({
      ...dsForm,
      columns: [...dsForm.columns, name],
      rows: dsForm.rows.map((r) => ({ ...r, [name]: '' })),
    });
  }

  function renameColumn(index: number, next: string) {
    const old = dsForm.columns[index];
    if (!old || old === next) return;
    const columns = [...dsForm.columns];
    columns[index] = next;
    setDsForm({
      ...dsForm,
      columns,
      rows: dsForm.rows.map((r) => {
        const copy: Record<string, string> = { ...r, [next]: r[old] ?? '' };
        delete copy[old];
        return copy;
      }),
    });
  }

  function removeColumn(index: number) {
    const old = dsForm.columns[index];
    if (!old) return;
    setDsForm({
      ...dsForm,
      columns: dsForm.columns.filter((_, i) => i !== index),
      rows: dsForm.rows.map((r) => {
        const copy = { ...r };
        delete copy[old];
        return copy;
      }),
    });
  }

  const defaultEnv = useMemo(() => environments.find((e) => e.is_default) ?? null, [environments]);

  if (!projectId) return <Empty icon="📁" title="Belum ada project" />;
  if (loading && !environments.length) return <Loading label="Memuat environment…" />;
  if (error && !environments.length) return <ErrorBox error={error} onRetry={() => void load()} />;

  return (
    <>
      <PageHeader
        title="Environment & Test Data"
        subtitle="Langkah 7 — siapkan target eksekusi (base URL, API, database, variabel) dan test data set yang dipakai mesin otomasi."
        actions={
          <>
            <button className="btn btn-sm" onClick={() => void load()}>
              ⟳ Muat ulang
            </button>
            <button className="btn btn-sm" onClick={() => openDsModal()} disabled={!environments.length}>
              + Test Data
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => openEnvModal()}>
              + Environment
            </button>
          </>
        }
      />

      {defaultEnv ? (
        <div className="alert alert-info" style={{ marginBottom: 'var(--space-4)' }}>
          <span>🖥️</span>
          <span>
            Environment default saat ini: <strong>{defaultEnv.name}</strong> ({defaultEnv.kind})
            {defaultEnv.base_url ? ` · ${defaultEnv.base_url}` : ''}. Mesin eksekusi memakai environment ini bila
            run tidak menentukan environment lain.
          </span>
        </div>
      ) : null}

      {/* ---------------------------- environments --------------------------- */}
      <div className="row-between" style={{ marginBottom: 'var(--space-3)' }}>
        <h2 className="card-title" style={{ margin: 0 }}>
          Environment ({environments.length})
        </h2>
        <span className="mute-sm">Tepat satu environment boleh menjadi default per project.</span>
      </div>

      {!environments.length ? (
        <Empty
          icon="🖥️"
          title="Belum ada environment"
          subtitle="Buat environment pertama — otomatis menjadi default project ini."
          action={
            <button className="btn btn-primary" onClick={() => openEnvModal()}>
              + Buat Environment
            </button>
          }
        />
      ) : (
        <div className="grid grid-3" style={{ marginBottom: 'var(--space-5)' }}>
          {environments.map((env) => {
            let vars: Record<string, string> = {};
            try {
              vars = env.variables ? (JSON.parse(env.variables) as Record<string, string>) : {};
            } catch {
              vars = {};
            }
            const varKeys = Object.keys(vars);
            return (
              <Card
                key={env.id}
                title={
                  <span className="row" style={{ gap: 'var(--space-2)' }}>
                    <span>{env.name}</span>
                    {env.is_default ? <Badge tone="accent">DEFAULT</Badge> : null}
                  </span>
                }
                actions={<Badge tone={KIND_TONE[env.kind] ?? 'muted'}>{env.kind}</Badge>}
              >
                <div className="kv">
                  <span className="kv-key">Base URL</span>
                  <span className="truncate" title={env.base_url ?? ''}>
                    {env.base_url ?? '—'}
                  </span>
                  <span className="kv-key">API base</span>
                  <span className="truncate" title={env.api_base ?? ''}>
                    {env.api_base ?? '—'}
                  </span>
                  <span className="kv-key">DB URI</span>
                  <span className="truncate" title={env.db_uri ?? ''}>
                    {env.db_uri ?? '—'}
                  </span>
                  <span className="kv-key">Variabel</span>
                  <span>{varKeys.length} kunci</span>
                </div>

                {varKeys.length ? (
                  <div className="row row-wrap" style={{ gap: 4, marginTop: 'var(--space-2)' }}>
                    {varKeys.slice(0, 6).map((k) => (
                      <span key={k} className="chip" style={{ fontSize: 10.5 }}>
                        {k}
                      </span>
                    ))}
                    {varKeys.length > 6 ? <span className="mute-sm">+{varKeys.length - 6}</span> : null}
                  </div>
                ) : null}

                {env.notes ? <div className="mute-sm" style={{ marginTop: 8 }}>{env.notes}</div> : null}

                <div className="row" style={{ marginTop: 'var(--space-3)', gap: 'var(--space-2)' }}>
                  {!env.is_default ? (
                    <button className="btn btn-sm" onClick={() => void makeDefault(env.id)}>
                      Jadikan default
                    </button>
                  ) : null}
                  <span className="spacer" />
                  <button className="btn btn-ghost btn-sm" onClick={() => openEnvModal(env)}>
                    Ubah
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => setConfirm({ kind: 'env', id: env.id, name: env.name })}
                  >
                    Hapus
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ----------------------------- test data ----------------------------- */}
      <div className="row-between" style={{ marginBottom: 'var(--space-3)' }}>
        <h2 className="card-title" style={{ margin: 0 }}>
          Test Data Set ({dataSets.length})
        </h2>
        <span className="mute-sm">Grid kolom × baris yang dipakai sebagai data uji.</span>
      </div>

      {!dataSets.length ? (
        <Empty
          icon="🗃️"
          title="Belum ada test data set"
          subtitle={
            environments.length
              ? 'Buat set data pertama untuk dipakai pada eksekusi manual maupun otomasi.'
              : 'Buat environment terlebih dahulu.'
          }
          action={
            environments.length ? (
              <button className="btn btn-primary" onClick={() => openDsModal()}>
                + Buat Test Data
              </button>
            ) : null
          }
        />
      ) : (
        <Card>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Environment</th>
                  <th>Kolom</th>
                  <th>Baris</th>
                  <th>Dibuat</th>
                  <th className="cell-actions">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {dataSets.map((ds) => {
                  let columns: string[] = [];
                  let rows: unknown[] = [];
                  try {
                    columns = ds.columns ? (JSON.parse(ds.columns) as string[]) : [];
                  } catch {
                    columns = [];
                  }
                  try {
                    rows = ds.rows ? (JSON.parse(ds.rows) as unknown[]) : [];
                  } catch {
                    rows = [];
                  }
                  const env = environments.find((e) => e.id === ds.environment_id);
                  return (
                    <tr key={ds.id}>
                      <td>
                        <div className="strong">{ds.name}</div>
                        {ds.description ? (
                          <div className="mute-sm" style={{ fontSize: 11.5 }}>
                            {ds.description}
                          </div>
                        ) : null}
                      </td>
                      <td className="mute-sm">{env ? env.name : '—'}</td>
                      <td>
                        <div className="row row-wrap" style={{ gap: 3 }}>
                          {columns.slice(0, 5).map((c) => (
                            <span key={c} className="chip" style={{ fontSize: 10.5 }}>
                              {c}
                            </span>
                          ))}
                          {columns.length > 5 ? <span className="mute-sm">+{columns.length - 5}</span> : null}
                        </div>
                      </td>
                      <td className="mono">{rows.length}</td>
                      <td className="mute-sm">{fmtDateTime(ds.created_at)}</td>
                      <td className="cell-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => openDsModal(ds)}>
                          Ubah
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setConfirm({ kind: 'dataset', id: ds.id, name: ds.name })}
                        >
                          Hapus
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ------------------------------- modals ------------------------------- */}
      {envModal ? (
        <Modal
          title={envModal.id ? 'Ubah Environment' : 'Buat Environment'}
          onClose={() => setEnvModal(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEnvModal(null)} disabled={busy}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={() => void saveEnv()} disabled={busy || !envForm.name.trim()}>
                {busy ? 'Menyimpan…' : 'Simpan'}
              </button>
            </>
          }
        >
          <div className="stack">
            <div className="grid grid-2">
              <Field label="Nama" required>
                <input
                  className="input"
                  value={envForm.name}
                  onChange={(e) => setEnvForm({ ...envForm, name: e.target.value })}
                  placeholder="mis. Staging"
                />
              </Field>
              <Field label="Jenis">
                <select className="select" value={envForm.kind} onChange={(e) => setEnvForm({ ...envForm, kind: e.target.value })}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Base URL (web)">
              <input
                className="input"
                value={envForm.base_url}
                onChange={(e) => setEnvForm({ ...envForm, base_url: e.target.value })}
                placeholder="https://staging.example.com"
              />
            </Field>
            <Field label="API base URL">
              <input
                className="input"
                value={envForm.api_base}
                onChange={(e) => setEnvForm({ ...envForm, api_base: e.target.value })}
                placeholder="https://api.staging.example.com"
              />
            </Field>
            <Field label="DB URI" hint="Dipakai mesin pengujian database.">
              <input
                className="input"
                value={envForm.db_uri}
                onChange={(e) => setEnvForm({ ...envForm, db_uri: e.target.value })}
                placeholder="sqlite://./data/app.db"
              />
            </Field>

            <KeyValueEditor
              label="Variabel (key → value)"
              values={envForm.variables}
              onChange={(variables) => setEnvForm({ ...envForm, variables })}
            />

            <Field label="Catatan">
              <textarea className="textarea" value={envForm.notes} onChange={(e) => setEnvForm({ ...envForm, notes: e.target.value })} />
            </Field>
          </div>
        </Modal>
      ) : null}

      {dsModal ? (
        <Modal
          title={dsModal.id ? 'Ubah Test Data Set' : 'Buat Test Data Set'}
          onClose={() => setDsModal(null)}
          size="lg"
          footer={
            <>
              <span className="mute-sm">
                {dsForm.columns.length} kolom × {dsForm.rows.length} baris
              </span>
              <span className="spacer" />
              <button className="btn" onClick={() => setDsModal(null)} disabled={busy}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={() => void saveDataSet()} disabled={busy || !dsForm.name.trim()}>
                {busy ? 'Menyimpan…' : 'Simpan'}
              </button>
            </>
          }
        >
          <div className="stack">
            <div className="grid grid-2">
              <Field label="Nama" required>
                <input
                  className="input"
                  value={dsForm.name}
                  onChange={(e) => setDsForm({ ...dsForm, name: e.target.value })}
                  placeholder="mis. Data checkout valid"
                />
              </Field>
              <Field label="Environment">
                <select
                  className="select"
                  value={dsForm.environment_id}
                  onChange={(e) => setDsForm({ ...dsForm, environment_id: e.target.value })}
                >
                  <option value="">— berlaku umum —</option>
                  {environments.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({e.kind})
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Deskripsi">
              <input
                className="input"
                value={dsForm.description}
                onChange={(e) => setDsForm({ ...dsForm, description: e.target.value })}
              />
            </Field>

            <div className="row-between">
              <span className="label">Grid data</span>
              <div className="row" style={{ gap: 'var(--space-2)' }}>
                <button className="btn btn-ghost btn-sm" onClick={addColumn}>
                  + Kolom
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setDsForm({
                      ...dsForm,
                      rows: [...dsForm.rows, Object.fromEntries(dsForm.columns.map((c) => [c, '']))],
                    })
                  }
                >
                  + Baris
                </button>
              </div>
            </div>

            <div className="table-wrap" style={{ maxHeight: 380 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    {dsForm.columns.map((c, i) => (
                      <th key={`${c}-${i}`}>
                        <div className="row" style={{ gap: 4 }}>
                          <input
                            className="input input-sm"
                            value={c}
                            onChange={(e) => renameColumn(i, e.target.value)}
                          />
                          <button className="btn btn-ghost btn-sm" title="Hapus kolom" onClick={() => removeColumn(i)}>
                            ✕
                          </button>
                        </div>
                      </th>
                    ))}
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {dsForm.rows.map((row, ri) => (
                    <tr key={ri}>
                      <td className="cell-mono">{ri + 1}</td>
                      {dsForm.columns.map((c) => (
                        <td key={c}>
                          <input
                            className="input input-sm"
                            value={row[c] ?? ''}
                            onChange={(e) => {
                              const rows = [...dsForm.rows];
                              rows[ri] = { ...rows[ri]!, [c]: e.target.value };
                              setDsForm({ ...dsForm, rows });
                            }}
                          />
                        </td>
                      ))}
                      <td className="cell-actions">
                        <button
                          className="btn btn-ghost btn-sm"
                          title="Hapus baris"
                          onClick={() => setDsForm({ ...dsForm, rows: dsForm.rows.filter((_, i) => i !== ri) })}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!dsForm.rows.length ? (
              <div className="mute-sm">Belum ada baris. Tambahkan baris untuk mulai mengisi data uji.</div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {confirm ? (
        <ConfirmDialog
          title={`Hapus ${confirm.kind === 'env' ? 'environment' : 'test data set'}?`}
          message={`${confirm.name} akan dihapus permanen.`}
          confirmLabel="Hapus"
          danger
          busy={busy}
          onConfirm={() => void deleteConfirmed()}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </>
  );
}
