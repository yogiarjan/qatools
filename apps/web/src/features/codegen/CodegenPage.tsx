/**
 * Code Generator — memilih framework, memilih test case, lalu mengunduh proyek
 * automation yang benar-benar bisa dijalankan.
 *
 * Route: /codegen  (didaftarkan oleh Lead di App.tsx)
 *
 * Halaman ini menampilkan tiga hal yang jarang ada di generator kode lain:
 *   1. perintah instalasi & menjalankan, apa adanya dari FRAMEWORK_META;
 *   2. daftar `warnings[]` — apa yang TIDAK berhasil dikonversi dan alasannya;
 *   3. isi file per file beserta `purpose`-nya, supaya pengguna bisa memeriksa
 *      sebelum mempercayai hasil generate.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CodegenFramework,
  FrameworkMeta,
  GeneratedFile,
  GeneratedProject,
  GeneratedProjectMeta,
  TestCase,
} from '@qatools/shared';
import { api, ApiError, exportUrl, listOf } from '../../lib/api';
import { toast } from '../../lib/toast';
import { useProject } from '../../lib/project';
import {
  Badge,
  Card,
  DataTable,
  Empty,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  Stat,
  fmtDate,
  type Column,
} from '../../components';
import './codegen.css';

/* --------------------------------- types ---------------------------------- */

interface ListEnvelope<T> {
  data: T[];
  total: number;
}

const LAYER_LABEL: Record<string, string> = {
  web: 'Web UI',
  api: 'API',
  db: 'Database',
  performance: 'Performa',
};

/** Framework yang mendukung layer database secara nyata (hanya pytest). */
function supportsDb(meta: FrameworkMeta): boolean {
  return meta.supports.includes('db');
}

/* ------------------------------- page ------------------------------------- */

export default function CodegenPage() {
  const { project, projectId } = useProject();

  /* frameworks */
  const [frameworks, setFrameworks] = useState<FrameworkMeta[]>([]);
  const [frameworkId, setFrameworkId] = useState<CodegenFramework | null>(null);

  /* test cases */
  const [cases, setCases] = useState<TestCase[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [caseQuery, setCaseQuery] = useState('');
  const [caseLayer, setCaseLayer] = useState('all');

  /* options */
  const [parallel, setParallel] = useState(false);
  const [workers, setWorkers] = useState(4);
  const [baseUrl, setBaseUrl] = useState('');
  const [useAi, setUseAi] = useState(false);
  const [persist, setPersist] = useState(true);

  /* state */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedProject | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [history, setHistory] = useState<GeneratedProjectMeta[]>([]);

  const framework = useMemo(
    () => frameworks.find((f) => f.id === frameworkId) ?? null,
    [frameworks, frameworkId],
  );

  /* ------------------------------ loading -------------------------------- */

  const loadFrameworks = useCallback(async () => {
    const rows = await listOf<FrameworkMeta>('/codegen/frameworks');
    setFrameworks(rows);
    setFrameworkId((current) => current ?? rows[0]?.id ?? null);
    return rows;
  }, []);

  const loadCases = useCallback(async (pid: string) => {
    const rows = await listOf<TestCase>('/testcases', { project_id: pid, limit: 2000 });
    setCases(rows.filter((c) => c.status !== 'deprecated'));
    return rows;
  }, []);

  const loadHistory = useCallback(async (pid: string) => {
    try {
      const res = await api.get<ListEnvelope<GeneratedProjectMeta>>(`/projects/${pid}/codegen`, {
        limit: 50,
      });
      setHistory(res.data ?? []);
    } catch {
      // Riwayat bersifat opsional; halaman tetap berguna tanpa itu.
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        await loadFrameworks();
        if (!projectId) return;
        await Promise.all([loadCases(projectId), loadHistory(projectId)]);
      } catch (err) {
        if (alive) setError(err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId, loadFrameworks, loadCases, loadHistory]);

  useEffect(() => {
    if (project?.target_url && !baseUrl) {
      setBaseUrl(project.target_url);
    }
  }, [project, baseUrl]);

  /* ------------------------------ selection ------------------------------ */

  const filteredCases = useMemo(() => {
    const q = caseQuery.trim().toLowerCase();
    return cases.filter((c) => {
      if (caseLayer !== 'all' && c.layer !== caseLayer) return false;
      if (!q) return true;
      return (
        c.code.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        (c.tags ?? '').toLowerCase().includes(q)
      );
    });
  }, [cases, caseQuery, caseLayer]);

  const layersPresent = useMemo(() => {
    const set = new Set<string>();
    for (const c of cases) set.add(c.layer);
    return [...set].sort();
  }, [cases]);

  const toggleCase = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = filteredCases.every((c) => next.has(c.id));
      for (const c of filteredCases) {
        if (allSelected) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });
  };

  /**
   * Layer yang dikirim ke API: diturunkan dari test case terpilih, jadi kita tidak
   * pernah meminta layer yang tidak diminta pengguna. Bila tidak ada yang dipilih,
   * kirim kosong = "semua layer yang didukung framework".
   */
  const requestedLayers = useMemo(() => {
    if (!framework || selected.size === 0) return undefined;
    const chosen = new Set<string>();
    for (const c of cases) {
      if (!selected.has(c.id)) continue;
      if (framework.supports.includes(c.layer as never)) chosen.add(c.layer);
    }
    return chosen.size ? [...chosen] : undefined;
  }, [cases, framework, selected]);

  /* ------------------------------ generate ------------------------------- */

  const generate = async () => {
    if (!projectId || !frameworkId) return;
    setGenerating(true);
    try {
      const res = await api.post<{ data: GeneratedProject }>(`/projects/${projectId}/codegen`, {
        framework: frameworkId,
        test_case_ids: selected.size ? [...selected] : undefined,
        layers: requestedLayers,
        base_url: baseUrl.trim() || undefined,
        parallel,
        workers: parallel ? workers : 1,
        use_ai: useAi,
        persist,
      });
      setResult(res.data);
      setActivePath(res.data.files[0]?.path ?? null);
      toast.ok(
        `${res.data.files.length} file digenerate untuk ${framework?.label ?? frameworkId} (${res.data.summary.total_lines} baris).`,
      );
      if (res.data.warnings.length) {
        toast.warn(`${res.data.warnings.length} peringatan — periksa daftar peringatan di bawah.`);
      }
      if (persist) void loadHistory(projectId);
    } catch (err) {
      if (err instanceof ApiError) toast.err(`${err.message} (${err.code})`);
      else toast.fromError(err, 'Gagal generate');
    } finally {
      setGenerating(false);
    }
  };

  const copyFile = async (file: GeneratedFile) => {
    try {
      await navigator.clipboard.writeText(file.content);
      toast.ok(`Isi ${file.path} disalin ke clipboard.`);
    } catch {
      toast.err('Browser menolak akses clipboard. Salin manual dari panel kode.');
    }
  };

  const openHistory = async (id: string) => {
    try {
      const res = await api.get<{ data: GeneratedProject }>(`/codegen/${id}`);
      setResult(res.data);
      setActivePath(res.data.files[0]?.path ?? null);
      toast.info(`Memuat hasil generate ${fmtDate(res.data.created_at)}.`);
    } catch (err) {
      toast.fromError(err, 'Gagal memuat hasil generate');
    }
  };

  const removeHistory = async (id: string) => {
    try {
      await api.del(`/codegen/${id}`);
      if (projectId) await loadHistory(projectId);
      if (result?.id === id) setResult(null);
      toast.ok('Hasil generate dihapus.');
    } catch (err) {
      toast.fromError(err, 'Gagal menghapus');
    }
  };

  /* -------------------------------- render -------------------------------- */

  if (loading) return <Loading label="Memuat daftar framework…" />;
  if (error) return <ErrorBox error={error} onRetry={() => window.location.reload()} />;

  if (!projectId) {
    return (
      <>
        <PageHeader
          title="Code Generator"
          subtitle="Ubah test case QATools menjadi proyek automation yang bisa langsung dijalankan."
        />
        <Empty
          icon="🏗️"
          title="Belum ada proyek aktif"
          subtitle="Pilih atau buat proyek terlebih dahulu — codegen membaca test case, web flow, API request, dan DB check dari proyek tersebut."
        />
      </>
    );
  }

  const activeFile = result?.files.find((f) => f.path === activePath) ?? null;
  const groupedFiles = groupByFolder(result?.files ?? []);

  const historyColumns: Array<Column<GeneratedProjectMeta>> = [
    {
      key: 'framework',
      header: 'Framework',
      width: '150px',
      render: (r) => <Badge tone="accent">{r.framework}</Badge>,
    },
    { key: 'name', header: 'Nama', render: (r) => <span className="truncate">{r.name}</span> },
    {
      key: 'files',
      header: 'File',
      width: '90px',
      align: 'right',
      render: (r) => (
        <span className="cell-mono">
          {r.file_count} · {r.total_lines}
        </span>
      ),
    },
    {
      key: 'created',
      header: 'Dibuat',
      width: '150px',
      render: (r) => <span className="mute-sm">{fmtDate(r.created_at)}</span>,
    },
    {
      key: 'actions',
      header: '',
      width: '120px',
      render: (r) => (
        <div className="cell-actions">
          <button className="btn btn-sm" onClick={() => void openHistory(r.id)}>
            Buka
          </button>
          <button className="btn btn-sm btn-danger" onClick={() => void removeHistory(r.id)}>
            Hapus
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Code Generator"
        subtitle={
          <>
            Ubah artefak <strong>{project?.name ?? 'proyek'}</strong> menjadi proyek automation
            yang benar-benar bisa dijalankan — Playwright, Robot Framework, pytest, Cypress,
            Selenium, k6, Postman, REST Assured.
          </>
        }
        badge={<Badge tone="accent">{frameworks.length} framework</Badge>}
        actions={
          result ? (
            <a
              className="btn btn-primary"
              href={exportUrl(`/codegen/${result.id ?? ''}/download`)}
              onClick={(e) => {
                if (!result.id) {
                  e.preventDefault();
                  toast.warn(
                    'Hasil ini belum disimpan (opsi "Simpan hasil" dimatikan), jadi belum bisa diunduh sebagai ZIP. Generate ulang dengan opsi simpan aktif.',
                  );
                }
              }}
            >
              ⬇️ Download ZIP
            </a>
          ) : null
        }
      />

      {/* -------------------------- 1. pilih framework -------------------------- */}
      <Card
        title="1. Pilih framework"
        subtitle="Setiap kartu menampilkan layer yang didukung, perintah instalasi, dan perintah menjalankan."
      >
        <div className="cg-grid">
          {frameworks.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`cg-fw ${f.id === frameworkId ? 'cg-fw-active' : ''}`}
              onClick={() => setFrameworkId(f.id)}
            >
              <div className="cg-fw-head">
                <span className="cg-fw-label">{f.label}</span>
                {f.id === frameworkId ? <Badge tone="accent">dipilih</Badge> : null}
              </div>
              <div className="row row-wrap" style={{ gap: 5 }}>
                <Badge tone="muted">{f.language}</Badge>
                {f.supports.map((s) => (
                  <Badge key={s} tone="info">
                    {LAYER_LABEL[s] ?? s}
                  </Badge>
                ))}
                {f.supports.includes('db') ? null : (
                  <Badge tone="muted" title="Framework ini tidak menjalankan assertion database">
                    tanpa DB
                  </Badge>
                )}
              </div>
              <p className="cg-fw-notes">{f.notes}</p>
              <div className="stack stack-sm">
                <span className="cg-cmd-label">install</span>
                <div className="cg-cmd">{f.installCommand}</div>
                <span className="cg-cmd-label">run</span>
                <div className="cg-cmd">{f.runCommand}</div>
              </div>
              {f.requiresUserInstall ? (
                <div className="cg-warn-install">
                  <span>⚠️</span>
                  <span>
                    Tool ini <strong>tidak</strong> dipasang oleh QATools. Menjalankan perintah
                    instalasi di atas adalah langkah Anda.
                  </span>
                </div>
              ) : null}
              <a
                className="link-btn"
                href={f.docsUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                Dokumentasi {f.label} ↗
              </a>
            </button>
          ))}
        </div>
      </Card>

      {/* --------------------------- 2. pilih test case -------------------------- */}
      <div style={{ marginTop: 'var(--space-4)' }}>
        <Card
          title="2. Pilih test case"
          subtitle={
            selected.size
              ? `${selected.size} dari ${cases.length} test case dipilih.`
              : `Tidak ada yang dipilih = seluruh ${cases.length} test case automatable di proyek ini.`
          }
          actions={
            <div className="row cg-toolbar-gap">
              <input
                className="input input-sm"
                style={{ width: 200 }}
                placeholder="Cari kode / judul / tag…"
                value={caseQuery}
                onChange={(e) => setCaseQuery(e.target.value)}
              />
              <select
                className="select input-sm"
                style={{ width: 140 }}
                value={caseLayer}
                onChange={(e) => setCaseLayer(e.target.value)}
              >
                <option value="all">Semua layer</option>
                {layersPresent.map((l) => (
                  <option key={l} value={l}>
                    {LAYER_LABEL[l] ?? l}
                  </option>
                ))}
              </select>
              <button className="btn btn-sm" onClick={selectAllFiltered}>
                {filteredCases.length && filteredCases.every((c) => selected.has(c.id))
                  ? 'Kosongkan'
                  : `Pilih ${filteredCases.length}`}
              </button>
              {selected.size ? (
                <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
                  Reset
                </button>
              ) : null}
            </div>
          }
        >
          {!cases.length ? (
            <Empty
              icon="🧪"
              title="Proyek ini belum punya test case"
              subtitle="Codegen tetap bisa dijalankan: proyek akan berisi struktur, config, dan README yang benar, dengan peringatan bahwa belum ada test case."
            />
          ) : !filteredCases.length ? (
            <Empty icon="🔍" title="Tidak ada test case yang cocok dengan filter" />
          ) : (
            <div className="cg-case-list">
              {filteredCases.map((c) => (
                <label className="cg-case" key={c.id}>
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggleCase(c.id)}
                    style={{ marginTop: 3 }}
                  />
                  <span className="cg-case-main">
                    <span className="cg-case-title">
                      <span className="cell-mono">{c.code}</span> — {c.title}
                    </span>
                    <span className="cg-case-meta">
                      <Badge tone="muted">{LAYER_LABEL[c.layer] ?? c.layer}</Badge>
                      <Badge tone={c.priority === 'critical' ? 'err' : 'muted'}>{c.priority}</Badge>
                      {c.automation_status === 'cannot_automate' ? (
                        <Badge tone="warn">cannot_automate — dilewati</Badge>
                      ) : null}
                      {c.is_regression ? <Badge tone="accent">regresi</Badge> : null}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ------------------------------ 3. opsi -------------------------------- */}
      <div style={{ marginTop: 'var(--space-4)' }}>
        <Card title="3. Opsi generate">
          <div className="row cg-toolbar-gap">
            <Field label="Base URL" hint="Kosongkan untuk memakai environment default proyek.">
              <input
                className="input"
                style={{ width: 300 }}
                placeholder={project?.target_url ?? 'https://staging.example.com'}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </Field>

            <Field label="Paralel">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={parallel}
                  onChange={(e) => setParallel(e.target.checked)}
                />
                <span>Aktifkan sharding / worker</span>
              </label>
            </Field>

            <Field label="Workers" hint="1–16.">
              <input
                className="input"
                style={{ width: 90 }}
                type="number"
                min={1}
                max={16}
                disabled={!parallel}
                value={workers}
                onChange={(e) => setWorkers(Math.max(1, Math.min(16, Number(e.target.value) || 1)))}
              />
            </Field>

            <Field label="AI">
              <label className="checkbox">
                <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
                <span>Pakai AI untuk memperkaya komentar</span>
              </label>
            </Field>

            <Field label="Simpan" hint="Perlu untuk dapat mengunduh ZIP.">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={persist}
                  onChange={(e) => setPersist(e.target.checked)}
                />
                <span>Simpan hasil generate</span>
              </label>
            </Field>

            <button
              className="btn btn-primary btn-lg"
              onClick={() => void generate()}
              disabled={generating || !frameworkId}
            >
              {generating ? '⏳ Menggenerate…' : '🏗️ Generate proyek'}
            </button>
          </div>

          {framework && requestedLayers ? (
            <p className="mute-sm" style={{ marginTop: 'var(--space-3)' }}>
              Layer yang akan digenerate: {requestedLayers.map((l) => LAYER_LABEL[l] ?? l).join(', ')}.
              {framework.supports.includes('db') ? null : (
                <>
                  {' '}
                  Framework ini tidak menjalankan assertion database
                  {cases.some((c) => selected.has(c.id) && c.layer === 'db')
                    ? ' — test case DB yang Anda pilih akan dilaporkan sebagai peringatan, bukan diabaikan diam-diam.'
                    : '.'}
                </>
              )}
            </p>
          ) : null}
        </Card>
      </div>

      {/* ------------------------------ hasil ---------------------------------- */}
      {result ? (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Card
            title="Hasil generate"
            subtitle={result.name}
            actions={
              <div className="row" style={{ gap: 'var(--space-2)' }}>
                <Badge tone={result.generated_by === 'ai' ? 'accent' : 'muted'}>
                  {result.generated_by}
                </Badge>
                <Badge tone="info">{result.framework}</Badge>
                {result.id ? (
                  <a className="btn btn-sm btn-primary" href={exportUrl(`/codegen/${result.id}/download`)}>
                    ⬇️ Download ZIP
                  </a>
                ) : (
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      toast.warn('Hasil ini belum disimpan; aktifkan opsi "Simpan hasil" lalu generate ulang.')
                    }
                  >
                    ⬇️ Download ZIP
                  </button>
                )}
              </div>
            }
          >
            <div className="grid grid-4" style={{ marginBottom: 'var(--space-4)' }}>
              <Stat label="File" value={result.summary.total_files} tone="accent" />
              <Stat label="Baris kode" value={result.summary.total_lines} />
              <Stat label="Test case" value={result.summary.test_cases} />
              <Stat label="Peringatan" value={result.warnings.length} tone={result.warnings.length ? 'warn' : 'ok'} />
            </div>

            <div className="row row-wrap" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              <Badge tone="info">web flow: {result.summary.web_flows}</Badge>
              <Badge tone="info">API request: {result.summary.api_requests}</Badge>
              <Badge tone="info">DB check: {result.summary.db_checks}</Badge>
              <Badge tone="muted">{fmtDate(result.created_at)}</Badge>
            </div>

            {result.warnings.length ? (
              <div className="alert alert-warn" style={{ alignItems: 'flex-start' }}>
                <span>⚠️</span>
                <div style={{ flex: 1 }}>
                  <div className="strong">
                    {result.warnings.length} hal yang tidak dapat dikonversi sepenuhnya
                  </div>
                  <ul className="cg-warn-list">
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="alert alert-ok">
                <span>✅</span>
                <div>Semua artefak yang diminta berhasil dikonversi tanpa peringatan.</div>
              </div>
            )}

            <div
              className="grid"
              style={{ gridTemplateColumns: 'minmax(220px, 320px) 1fr', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}
            >
              <div>
                <div className="label" style={{ marginBottom: 'var(--space-2)' }}>
                  Struktur file
                </div>
                <div className="cg-tree">
                  {groupedFiles.map((group) => (
                    <div key={group.folder}>
                      {group.folder ? <div className="cg-tree-group">{group.folder}</div> : null}
                      {group.files.map((f) => (
                        <button
                          key={f.path}
                          type="button"
                          className={`cg-tree-item ${f.path === activePath ? 'cg-tree-item-active' : ''}`}
                          title={`${f.path} — ${f.purpose}`}
                          onClick={() => setActivePath(f.path)}
                        >
                          {f.path.split('/').pop()} <span className="mute-sm">· {f.lines}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                {activeFile ? (
                  <>
                    <div className="row-between" style={{ marginBottom: 'var(--space-2)' }}>
                      <div className="row" style={{ gap: 'var(--space-2)' }}>
                        <span className="cell-mono strong">{activeFile.path}</span>
                        <Badge tone="muted">{activeFile.language}</Badge>
                        <Badge tone="info">{activeFile.lines} baris</Badge>
                      </div>
                      <button className="btn btn-sm" onClick={() => void copyFile(activeFile)}>
                        📋 Salin
                      </button>
                    </div>
                    <div className="cg-purpose">
                      <strong>Kegunaan:</strong> {activeFile.purpose}
                    </div>
                    <pre className="pre cg-viewer">
                      <code>{activeFile.content}</code>
                    </pre>
                  </>
                ) : (
                  <Empty icon="📄" title="Pilih sebuah file" subtitle="Isi file dan kegunaannya akan tampil di sini." />
                )}
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {/* ---------------------------- riwayat ---------------------------------- */}
      {history.length ? (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Card
            title="Riwayat generate"
            subtitle="Hasil yang tersimpan bisa dibuka kembali dan diunduh ulang sebagai ZIP."
          >
            <DataTable
              rows={history}
              columns={historyColumns}
              rowKey={(r) => r.id}
              empty={<Empty title="Belum ada hasil tersimpan" />}
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------- helpers ---------------------------------- */

function groupByFolder(files: GeneratedFile[]): Array<{ folder: string; files: GeneratedFile[] }> {
  const map = new Map<string, GeneratedFile[]>();
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const idx = f.path.lastIndexOf('/');
    const folder = idx === -1 ? '' : f.path.slice(0, idx);
    const list = map.get(folder) ?? [];
    list.push(f);
    map.set(folder, list);
  }
  return [...map.entries()].map(([folder, list]) => ({ folder, files: list }));
}

export { supportsDb };
