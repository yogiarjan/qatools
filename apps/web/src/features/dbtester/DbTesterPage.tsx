/**
 * Database Testing — connection manager, SQL editor and assertion builder.
 *
 * Route: /db-tester  (registered by the Lead in App.tsx)
 *
 * The UI is explicit about which dialects are enabled and WHY: only `sqlite`
 * runs without extra dependencies (node:sqlite built into Node). postgres/mysql
 * require the user to install `pg` / `mysql2` themselves.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Assertion, AssertionOperator, DbCheck, DbConnection } from '@qatools/shared';
import { api, ApiError } from '../../lib/api';
import { toast } from '../../lib/toast';
import { useProject } from '../../lib/project';
import {
  Badge,
  Card,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  Tabs,
  fmtDuration,
  fmtDateTime,
} from '../../components';
import '../automation.css';

/* --------------------------------- types ---------------------------------- */

const SOURCES: Assertion['source'][] = ['row_count', 'column', 'jsonpath', 'body', 'duration'];

const DB_OPERATORS: AssertionOperator[] = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'exists',
  'not_exists',
  'matches',
  'in',
  'length_gte',
  'length_lte',
];

type Dialect = 'sqlite' | 'postgres' | 'mysql';

interface DialectCap {
  dialect: Dialect;
  available: boolean;
  driver: string;
  reason: string;
}

interface QueryOutcome {
  status: string;
  duration_ms: number;
  error: string | null;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  row_count: number;
  result_text: string;
  logs: Array<{ index: number; action: string; status: string; message: string; duration_ms: number }>;
  assertions: Array<{ assertion: Assertion; passed: boolean; observed: unknown; message: string }>;
}

interface SchemaTable {
  name: string;
  type: string;
  columns: Array<{ name: string; type: string; notnull: number; pk: number }>;
}

interface ConnectionDraft {
  id?: string;
  name: string;
  dialect: Dialect;
  dsn: string;
  readonly_guard: boolean;
}

const EMPTY_DRAFT: ConnectionDraft = {
  name: '',
  dialect: 'sqlite',
  dsn: '',
  readonly_guard: true,
};

/** Safe-looking examples so the user is not staring at an empty box. */
const DSN_EXAMPLES: Record<Dialect, string> = {
  sqlite: 'data/qatools.db',
  postgres: 'postgres://user:password@localhost:5432/mydb',
  mysql: 'mysql://user:password@localhost:3306/mydb',
};

/* ------------------------------- component -------------------------------- */

export default function DbTesterPage() {
  const { projectId } = useProject();

  const [connections, setConnections] = useState<DbConnection[]>([]);
  const [dialects, setDialects] = useState<DialectCap[]>([]);
  const [activeConnection, setActiveConnection] = useState<string | null>(null);
  const [checks, setChecks] = useState<DbCheck[]>([]);
  const [activeCheck, setActiveCheck] = useState<DbCheck | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  /* editor */
  const [sql, setSql] = useState('SELECT 1 AS n');
  const [checkName, setCheckName] = useState('Check Baru');
  const [setupSql, setSetupSql] = useState('');
  const [teardownSql, setTeardownSql] = useState('');
  const [assertions, setAssertions] = useState<Assertion[]>([
    { source: 'row_count', operator: 'gte', expected: 1 },
  ]);

  const [tab, setTab] = useState<'result' | 'schema'>('result');
  const [outcome, setOutcome] = useState<QueryOutcome | null>(null);
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /* schema browser */
  const [schema, setSchema] = useState<SchemaTable[]>([]);
  const [schemaLoading, setSchemaLoading] = useState(false);

  /* modals */
  const [showConnection, setShowConnection] = useState(false);
  const [draft, setDraft] = useState<ConnectionDraft>(EMPTY_DRAFT);
  const [testing, setTesting] = useState<string | null>(null);
  const [explain, setExplain] = useState<{ plan: string[]; message: string } | null>(null);

  /* ------------------------------ loaders ----------------------------- */

  const loadDialects = useCallback(async () => {
    try {
      const res = await api.get<{ data: { dialects: DialectCap[] } }>('/db-check-dialects');
      setDialects(res.data.dialects ?? []);
    } catch {
      setDialects([]);
    }
  }, []);

  const loadConnections = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: DbConnection[] }>(`/projects/${projectId}/db-connections`);
      setConnections(res.data ?? []);
      setActiveConnection((current) => {
        if (current && res.data?.some((c) => c.id === current)) return current;
        return res.data?.[0]?.id ?? null;
      });
    } catch (err) {
      setError(err);
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadChecks = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await api.get<{ data: DbCheck[] }>(`/projects/${projectId}/db-checks`);
      setChecks(res.data ?? []);
    } catch {
      setChecks([]);
    }
  }, [projectId]);

  useEffect(() => {
    void loadDialects();
    void loadConnections();
    void loadChecks();
  }, [loadDialects, loadConnections, loadChecks]);

  const connection = useMemo(
    () => connections.find((c) => c.id === activeConnection) ?? null,
    [connections, activeConnection],
  );

  const capabilityOf = useCallback(
    (dialect: string) => dialects.find((d) => d.dialect === dialect) ?? null,
    [dialects],
  );

  /* ------------------------------ actions ----------------------------- */

  const openCheck = (check: DbCheck) => {
    setActiveCheck(check);
    setCheckName(check.name);
    setSql(check.sql);
    setSetupSql(check.setup_sql ?? '');
    setTeardownSql(check.teardown_sql ?? '');
    try {
      const parsed = JSON.parse(check.assertions ?? '[]') as unknown;
      setAssertions(Array.isArray(parsed) ? (parsed as Assertion[]) : []);
    } catch {
      setAssertions([]);
    }
    setOutcome(null);
    setProblem(null);
    setExplain(null);
    setActiveConnection(check.connection_id);
  };

  const newCheck = () => {
    setActiveCheck(null);
    setCheckName('Check Baru');
    setSql('SELECT COUNT(*) AS n FROM sqlite_master');
    setSetupSql('');
    setTeardownSql('');
    setAssertions([{ source: 'row_count', operator: 'gte', expected: 0 }]);
    setOutcome(null);
    setProblem(null);
    setExplain(null);
  };

  const saveCheck = async (): Promise<string | null> => {
    if (!projectId || !activeConnection) {
      toast.warn('Pilih koneksi terlebih dahulu.');
      return null;
    }
    const payload = {
      connection_id: activeConnection,
      name: checkName || 'DB Check',
      sql,
      assertions,
      setup_sql: setupSql || null,
      teardown_sql: teardownSql || null,
    };
    try {
      if (activeCheck) {
        const res = await api.patch<{ data: DbCheck }>(`/db-checks/${activeCheck.id}`, payload);
        setActiveCheck(res.data);
        toast.ok('Check tersimpan.');
        await loadChecks();
        return res.data.id;
      }
      const res = await api.post<{ data: DbCheck }>(`/projects/${projectId}/db-checks`, payload);
      setActiveCheck(res.data);
      toast.ok('Check dibuat.');
      await loadChecks();
      return res.data.id;
    } catch (err) {
      toast.fromError(err, 'Gagal menyimpan check');
      return null;
    }
  };

  const runCheck = async () => {
    setRunning(true);
    setProblem(null);
    setOutcome(null);
    try {
      const id = await saveCheck();
      if (!id) return;
      const res = await api.post<{ data: QueryOutcome }>(`/db-checks/${id}/run`, {});
      setOutcome(res.data);
      toast[res.data.status === 'passed' ? 'ok' : 'err'](`Status: ${res.data.status}`);
      await loadChecks();
    } catch (err) {
      // The readonly guard surfaces here as a 400 with a clear message.
      if (err instanceof ApiError) {
        setProblem(err.message);
        toast.err(err.message);
      } else {
        toast.fromError(err, 'Gagal menjalankan check');
      }
    } finally {
      setRunning(false);
    }
  };

  const runExplain = async () => {
    setExplain(null);
    try {
      const id = await saveCheck();
      if (!id) return;
      const res = await api.post<{ data: { plan: string[]; message: string } }>(`/db-checks/${id}/explain`, {});
      setExplain(res.data);
      toast.ok('Query plan diperoleh.');
    } catch (err) {
      if (err instanceof ApiError) toast.err(err.message);
      else toast.fromError(err, 'Gagal EXPLAIN');
    }
  };

  const loadSchema = async () => {
    if (!activeConnection) return;
    setSchemaLoading(true);
    setTab('schema');
    try {
      const res = await api.get<{ data: { tables: SchemaTable[] } }>(`/db-connections/${activeConnection}/schema`);
      setSchema(res.data.tables ?? []);
    } catch (err) {
      toast.fromError(err, 'Gagal memuat skema');
      setSchema([]);
    } finally {
      setSchemaLoading(false);
    }
  };

  const testConnection = async (id: string) => {
    setTesting(id);
    try {
      const res = await api.post<{ data: { ok: boolean; message: string; latency_ms: number; version: string | null } }>(
        `/db-connections/${id}/test`,
        {},
      );
      toast[res.data.ok ? 'ok' : 'err'](`${res.data.message} (${fmtDuration(res.data.latency_ms)})`);
      await loadConnections();
    } catch (err) {
      if (err instanceof ApiError) toast.err(err.message);
      else toast.fromError(err, 'Koneksi gagal');
    } finally {
      setTesting(null);
    }
  };

  const saveConnection = async () => {
    if (!projectId) return;
    if (!draft.name.trim() || !draft.dsn.trim()) {
      toast.warn('Nama dan DSN wajib diisi.');
      return;
    }
    try {
      const payload = {
        name: draft.name,
        dialect: draft.dialect,
        dsn: draft.dsn,
        readonly_guard: draft.readonly_guard,
      };
      if (draft.id) {
        await api.patch(`/db-connections/${draft.id}`, payload);
        toast.ok('Koneksi diperbarui.');
      } else {
        await api.post(`/projects/${projectId}/db-connections`, payload);
        toast.ok('Koneksi dibuat.');
      }
      setShowConnection(false);
      setDraft(EMPTY_DRAFT);
      await loadConnections();
    } catch (err) {
      toast.fromError(err, 'Gagal menyimpan koneksi');
    }
  };

  const deleteConnection = async (id: string) => {
    try {
      await api.del(`/db-connections/${id}`);
      toast.ok('Koneksi dihapus.');
      await loadConnections();
      await loadChecks();
    } catch (err) {
      toast.fromError(err, 'Gagal menghapus koneksi');
    }
  };

  const updateAssertion = (i: number, patch: Partial<Assertion>) =>
    setAssertions((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  /* ------------------------------- render ----------------------------- */

  if (!projectId) return <Empty icon="📁" title="Pilih project terlebih dahulu" />;

  const guardOn = Number(connection?.readonly_guard ?? 1) === 1;
  const cap = connection ? capabilityOf(connection.dialect) : null;

  return (
    <>
      <PageHeader
        title="Database Testing"
        subtitle="Jalankan SQL, verifikasi hasil dengan assertion, dan jaga keamanan dengan readonly guard."
        actions={
          <>
            <button
              className="btn"
              onClick={() => {
                setDraft(EMPTY_DRAFT);
                setShowConnection(true);
              }}
            >
              + Koneksi
            </button>
            <button className="btn" onClick={() => void runExplain()} disabled={!activeConnection}>
              🔍 EXPLAIN
            </button>
            <button className="btn btn-primary" onClick={() => void runCheck()} disabled={running || !activeConnection}>
              {running ? 'Menjalankan…' : '▶ Jalankan'}
            </button>
          </>
        }
      />

      {/* ------------------------ dialect honesty panel ------------------- */}
      <Card
        title="Dialect yang tersedia"
        subtitle="Hanya sqlite yang berjalan tanpa dependensi tambahan."
        className="rc-mb"
      >
        <div className="grid grid-3">
          {dialects.map((d) => (
            <div className="rc-engine" key={d.dialect}>
              <div className="row-between">
                <span className="strong cell-mono">{d.dialect}</span>
                <Badge tone={d.available ? 'ok' : 'muted'}>{d.available ? 'aktif' : 'nonaktif'}</Badge>
              </div>
              <div className="mute-sm" style={{ marginTop: 2 }}>
                driver: <span className="cell-mono">{d.driver}</span>
              </div>
              <div className="rc-engine-reason">{d.reason}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="db-layout">
        {/* --------------------------- sidebar --------------------------- */}
        <div className="stack">
          <Card
            title={`Koneksi (${connections.length})`}
            actions={
              <button
                className="btn btn-sm"
                onClick={() => {
                  setDraft(EMPTY_DRAFT);
                  setShowConnection(true);
                }}
              >
                + Baru
              </button>
            }
          >
            {loading ? (
              <Loading />
            ) : error ? (
              <ErrorBox error={error} onRetry={() => void loadConnections()} />
            ) : !connections.length ? (
              <Empty
                icon="🗄️"
                title="Belum ada koneksi"
                subtitle="Tambahkan koneksi sqlite. Contoh DSN: data/qatools.db"
              />
            ) : (
              <div className="stack stack-sm">
                {connections.map((c) => {
                  const cCap = capabilityOf(c.dialect);
                  return (
                    <div
                      key={c.id}
                      className={`api-item ${c.id === activeConnection ? 'active' : ''}`}
                      onClick={() => setActiveConnection(c.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && setActiveConnection(c.id)}
                    >
                      <div className="row-between">
                        <span className="api-item-name strong">{c.name}</span>
                        <Badge tone={cCap?.available ? 'info' : 'muted'}>{c.dialect}</Badge>
                      </div>
                      <div className="mute-sm cell-mono truncate">{c.dsn_masked}</div>
                      <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        <span className={Number(c.readonly_guard) ? 'db-guard-on' : 'db-guard-off'}>
                          {Number(c.readonly_guard) ? '🔒 readonly' : '🔓 write aktif'}
                        </span>
                        <span className="spacer" />
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            void testConnection(c.id);
                          }}
                          disabled={testing === c.id}
                        >
                          {testing === c.id ? '…' : 'Tes'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card
            title={`Saved Checks (${checks.length})`}
            actions={
              <button className="btn btn-sm" onClick={newCheck}>
                + Check
              </button>
            }
          >
            {!checks.length ? (
              <Empty icon="✅" title="Belum ada check" subtitle="Simpan SQL sebagai check agar bisa dipakai ulang." />
            ) : (
              <div className="api-sidebar-list stack stack-sm">
                {checks.map((c) => (
                  <button
                    key={c.id}
                    className={`api-item ${c.id === activeCheck?.id ? 'active' : ''}`}
                    onClick={() => openCheck(c)}
                  >
                    <div className="row-between">
                      <span className="api-item-name">{c.name}</span>
                      {c.last_status ? (
                        <Badge tone={c.last_status === 'passed' ? 'ok' : 'err'}>{c.last_status}</Badge>
                      ) : null}
                    </div>
                    <div className="mute-sm truncate cell-mono">{c.sql.slice(0, 60)}</div>
                    <div className="mute-sm">
                      {c.last_rows !== null ? `${c.last_rows} baris · ` : ''}
                      {c.last_run_at ? fmtDateTime(c.last_run_at) : 'belum dijalankan'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ---------------------------- editor ---------------------------- */}
        <div className="stack">
          <Card
            title={activeCheck ? `Check: ${activeCheck.name}` : 'Check Baru'}
            actions={
              <div className="row">
                {activeConnection ? (
                  <button className="btn btn-danger btn-sm" onClick={() => void deleteConnection(activeConnection)}>
                    Hapus koneksi
                  </button>
                ) : null}
                <button className="btn btn-sm" onClick={() => void saveCheck()} disabled={!activeConnection}>
                  💾 Simpan
                </button>
              </div>
            }
          >
            {!activeConnection ? (
              <Empty icon="🗄️" title="Pilih koneksi" subtitle="Check harus terikat pada satu koneksi database." />
            ) : (
              <>
                {cap && !cap.available ? (
                  <div className="alert alert-warn rc-mb">
                    Dialect <strong>{cap.dialect}</strong> belum aktif. {cap.reason}
                  </div>
                ) : null}

                {guardOn ? (
                  <div className="alert alert-info rc-mb">
                    🔒 <strong>Readonly guard aktif.</strong> Hanya satu statement{' '}
                    <span className="cell-mono">SELECT</span> / <span className="cell-mono">WITH</span> yang diizinkan.
                    UPDATE, DELETE, DROP, INSERT, dan statement ganda akan ditolak sebelum menyentuh database.
                  </div>
                ) : (
                  <div className="alert alert-warn rc-mb">
                    🔓 <strong>Readonly guard nonaktif</strong> pada koneksi ini — pernyataan yang mengubah data akan
                    dijalankan.
                  </div>
                )}

                <Field label="Nama check">
                  <input className="input" value={checkName} onChange={(e) => setCheckName(e.target.value)} />
                </Field>

                <div style={{ marginTop: 'var(--space-3)' }}>
                  <Field label="SQL utama">
                    <textarea
                      className="textarea db-sql"
                      value={sql}
                      onChange={(e) => setSql(e.target.value)}
                      placeholder="SELECT COUNT(*) AS n FROM orders WHERE status = 'paid'"
                    />
                  </Field>
                </div>

                <div className="grid grid-2" style={{ marginTop: 'var(--space-3)' }}>
                  <Field label="Setup SQL" hint="Dijalankan sebelum query (boleh beberapa statement).">
                    <textarea
                      className="textarea db-sql"
                      style={{ minHeight: 70 }}
                      value={setupSql}
                      onChange={(e) => setSetupSql(e.target.value)}
                    />
                  </Field>
                  <Field label="Teardown SQL" hint="Selalu dijalankan setelah query, termasuk saat gagal.">
                    <textarea
                      className="textarea db-sql"
                      style={{ minHeight: 70 }}
                      value={teardownSql}
                      onChange={(e) => setTeardownSql(e.target.value)}
                    />
                  </Field>
                </div>

                <h4 className="card-title" style={{ marginTop: 'var(--space-4)' }}>
                  Assertion ({assertions.length})
                </h4>
                <div className="mute-sm rc-mb">
                  Sumber <span className="cell-mono">row_count</span> · <span className="cell-mono">column</span> (nama
                  kolom baris pertama) · <span className="cell-mono">jsonpath</span> (mis.{' '}
                  <span className="cell-mono">$.n</span> untuk <span className="cell-mono">SELECT COUNT(*) AS n</span>).
                </div>
                <div className="stack stack-sm">
                  {assertions.map((a, i) => (
                    <div className="api-assert-row" key={i}>
                      <select
                        className="select input-sm"
                        value={a.source}
                        onChange={(e) => updateAssertion(i, { source: e.target.value as Assertion['source'] })}
                      >
                        {SOURCES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input input-sm"
                        placeholder="nama kolom / path"
                        value={a.path ?? ''}
                        onChange={(e) => updateAssertion(i, { path: e.target.value })}
                      />
                      <select
                        className="select input-sm"
                        value={a.operator}
                        onChange={(e) => updateAssertion(i, { operator: e.target.value as AssertionOperator })}
                      >
                        {DB_OPERATORS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input input-sm"
                        placeholder="nilai harapan"
                        value={a.expected === undefined || a.expected === null ? '' : String(a.expected)}
                        onChange={(e) => updateAssertion(i, { expected: coerce(e.target.value) })}
                      />
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setAssertions((prev) => prev.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    className="btn btn-sm"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() => setAssertions((prev) => [...prev, { source: 'row_count', operator: 'gte', expected: 1 }])}
                  >
                    + Tambah assertion
                  </button>
                </div>

                <div className="row rc-mb" style={{ marginTop: 'var(--space-4)' }}>
                  <button className="btn btn-sm" onClick={() => void loadSchema()}>
                    🔎 Muat skema
                  </button>
                </div>
              </>
            )}
          </Card>

          {/* --------------------------- results --------------------------- */}
          <Card title="Hasil">
            <Tabs
              tabs={[
                { id: 'result' as const, label: 'Hasil Query' },
                { id: 'schema' as const, label: 'Skema (sqlite)' },
              ]}
              active={tab}
              onChange={(id) => setTab(id)}
            />

            {problem ? (
              <div className="alert alert-err rc-mb">
                <span>🚫</span>
                <div>{problem}</div>
              </div>
            ) : null}

            {tab === 'result' ? (
              outcome ? (
                <>
                  <div className="row rc-mb">
                    <Badge tone={outcome.status === 'passed' ? 'ok' : 'err'}>{outcome.status}</Badge>
                    <span className="chip">{outcome.row_count} baris</span>
                    <span className="chip">{fmtDuration(outcome.duration_ms)}</span>
                  </div>

                  {outcome.columns.length && outcome.rows.length ? (
                    <div className="table-wrap db-result">
                      <table className="table">
                        <thead>
                          <tr>
                            {outcome.columns.map((c) => (
                              <th key={c}>{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {outcome.rows.map((row, i) => (
                            <tr key={i}>
                              {outcome.columns.map((c) => (
                                <td key={c} className="cell-mono">
                                  {row[c] === null || row[c] === undefined ? (
                                    <span className="mute-sm">NULL</span>
                                  ) : (
                                    String(row[c])
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <pre className="pre">{outcome.result_text || '(tidak ada baris hasil)'}</pre>
                  )}

                  <h4 className="card-title" style={{ marginTop: 'var(--space-4)' }}>
                    Assertion ({outcome.assertions.filter((a) => a.passed).length}/{outcome.assertions.length})
                  </h4>
                  {outcome.assertions.length ? (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th style={{ width: 70 }}>Hasil</th>
                            <th>Sumber</th>
                            <th>Diamati</th>
                            <th>Pesan</th>
                          </tr>
                        </thead>
                        <tbody>
                          {outcome.assertions.map((a, i) => (
                            <tr key={i}>
                              <td>{a.passed ? <Badge tone="ok">lulus</Badge> : <Badge tone="err">gagal</Badge>}</td>
                              <td className="cell-mono">
                                {a.assertion.source}
                                {a.assertion.path ? ` ${a.assertion.path}` : ''} · {a.assertion.operator}
                              </td>
                              <td className="cell-mono">{JSON.stringify(a.observed)}</td>
                              <td>{a.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="mute-sm">Tidak ada assertion.</div>
                  )}

                  <h4 className="card-title" style={{ marginTop: 'var(--space-4)' }}>
                    Log
                  </h4>
                  {outcome.logs.map((l) => (
                    <div className="web-step-log" key={l.index}>
                      <span className="web-step-badge">
                        <Badge tone={l.status === 'ok' ? 'ok' : l.status === 'fail' ? 'err' : 'muted'}>{l.status}</Badge>
                      </span>
                      <span className="cell-mono" style={{ flex: '0 0 90px' }}>
                        {l.action}
                      </span>
                      <span className="web-msg">{l.message}</span>
                    </div>
                  ))}
                </>
              ) : (
                <Empty
                  icon="▶️"
                  title="Belum ada hasil"
                  subtitle='Tekan "Jalankan" untuk mengeksekusi SQL terhadap koneksi terpilih.'
                />
              )
            ) : schemaLoading ? (
              <Loading label="Memuat skema…" />
            ) : !schema.length ? (
              <Empty icon="🗂️" title="Skema kosong" subtitle='Pilih koneksi sqlite lalu tekan "Muat skema".' />
            ) : (
              <div className="grid grid-2">
                {schema.map((t) => (
                  <div className="db-schema-table" key={t.name}>
                    <div className="row-between rc-mb">
                      <span className="strong cell-mono">{t.name}</span>
                      <Badge tone="muted">{t.type}</Badge>
                    </div>
                    {t.columns.map((c) => (
                      <div className="db-col-row" key={c.name}>
                        <span className="cell-mono">
                          {c.pk ? '🔑 ' : ''}
                          {c.name}
                        </span>
                        <span className="mute-sm">
                          {c.type || '—'}
                          {c.notnull ? ' · NOT NULL' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {explain ? (
            <Card title="Query Plan (EXPLAIN)">
              <pre className="pre">{explain.plan.length ? explain.plan.join('\n') : explain.message}</pre>
            </Card>
          ) : null}
        </div>
      </div>

      {/* ------------------------- connection modal ---------------------- */}
      {showConnection ? (
        <Modal
          title={draft.id ? 'Ubah Koneksi' : 'Koneksi Baru'}
          onClose={() => setShowConnection(false)}
          size="sm"
          footer={
            <>
              <button className="btn" onClick={() => setShowConnection(false)}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={() => void saveConnection()}>
                Simpan
              </button>
            </>
          }
        >
          <div className="stack">
            <Field label="Nama" required>
              <input
                className="input"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Contoh: DB Latihan SQLite"
              />
            </Field>
            <Field label="Dialect" hint="postgres/mysql memerlukan driver yang dipasang sendiri.">
              <select
                className="select"
                value={draft.dialect}
                onChange={(e) => setDraft({ ...draft, dialect: e.target.value as Dialect })}
              >
                <option value="sqlite">sqlite (aktif)</option>
                <option value="postgres">postgres (perlu paket pg)</option>
                <option value="mysql">mysql (perlu paket mysql2)</option>
              </select>
            </Field>
            <Field label="DSN" hint={`Contoh: ${DSN_EXAMPLES[draft.dialect]}`}>
              <input
                className="input cell-mono"
                value={draft.dsn}
                onChange={(e) => setDraft({ ...draft, dsn: e.target.value })}
                placeholder={DSN_EXAMPLES[draft.dialect]}
              />
            </Field>
            <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                className="checkbox"
                checked={draft.readonly_guard}
                onChange={(e) => setDraft({ ...draft, readonly_guard: e.target.checked })}
              />
              <span className="label" style={{ margin: 0 }}>
                Readonly guard — tolak statement selain SELECT/WITH
              </span>
            </label>
            <div className="alert alert-info">
              DSN disimpan di server dan hanya ditampilkan dalam bentuk tersamarkan pada daftar koneksi.
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** Expected values arrive as strings; numeric/JSON-looking ones are coerced. */
function coerce(raw: string): unknown {
  const t = raw.trim();
  if (t === '') return '';
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if ((t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}'))) {
    try {
      return JSON.parse(t);
    } catch {
      return raw;
    }
  }
  return raw;
}
