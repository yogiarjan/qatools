/**
 * API Automation — a Postman-like workspace.
 *
 * Route: /api-tester  (registered by the Lead in App.tsx)
 *
 * Collection sidebar → request editor (method/path/headers/query/body tabs) →
 * assertion builder rows → Send with status/time/pretty body → run collection →
 * OpenAPI import modal.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiCollection, ApiRequest, Assertion, AssertionOperator } from '@qatools/shared';
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
} from '../../components';
import '../automation.css';

/* --------------------------------- types ---------------------------------- */

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
type Method = (typeof METHODS)[number];

const SOURCES: Assertion['source'][] = [
  'status',
  'body',
  'header',
  'duration',
  'jsonpath',
  'row_count',
  'column',
  'text',
  'element',
];

const OPERATORS: AssertionOperator[] = [
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

type EditorTab = 'headers' | 'query' | 'body' | 'assertions' | 'scripts';

interface RunOutcome {
  status: string;
  duration_ms: number;
  http_status: number | null;
  url: string;
  error: string | null;
  logs: Array<{ index: number; action: string; status: string; message: string; duration_ms: number }>;
  assertions: Array<{ assertion: Assertion; passed: boolean; observed: unknown; message: string }>;
  evidence: Record<string, unknown>;
}

interface ImportResult {
  title: string;
  version: string;
  base_url: string | null;
  created: number;
  skipped_existing: number;
  skipped_paths: string[];
}

const METHOD_TONE: Record<string, string> = {
  GET: 'ok',
  POST: 'info',
  PUT: 'warn',
  PATCH: 'accent',
  DELETE: 'err',
};

/* -------------------------------- helpers --------------------------------- */

function parseJsonObject(text: string | null | undefined): Record<string, string> {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        out[k] = v === null || v === undefined ? '' : String(v);
      }
      return out;
    }
  } catch {
    /* fall through */
  }
  return {};
}

function parseAssertions(text: string | null | undefined): Assertion[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? (parsed as Assertion[]) : [];
  } catch {
    return [];
  }
}

function pretty(text: unknown): string {
  if (typeof text !== 'string') {
    try {
      return JSON.stringify(text, null, 2);
    } catch {
      return String(text);
    }
  }
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Sane defaults: point new collections at lane D's built-in mock system. */
const MOCK_BASE_HINT = '/api/mock';

export default function ApiTesterPage() {
  const { projectId } = useProject();

  /* ------------------------------ state ------------------------------- */
  const [collections, setCollections] = useState<ApiCollection[]>([]);
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [requests, setRequests] = useState<ApiRequest[]>([]);
  const [activeRequest, setActiveRequest] = useState<ApiRequest | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [runningCollection, setRunningCollection] = useState(false);

  /* editor buffers (kept separate from the saved row) */
  const [method, setMethod] = useState<Method>('GET');
  const [path, setPath] = useState('/');
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [query, setQuery] = useState<Record<string, string>>({});
  const [body, setBody] = useState('');
  const [bodyType, setBodyType] = useState<'json' | 'form' | 'raw' | 'none'>('none');
  const [assertions, setAssertions] = useState<Assertion[]>([]);
  const [preScript, setPreScript] = useState('');
  const [postScript, setPostScript] = useState('');

  const [tab, setTab] = useState<EditorTab>('headers');
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  /* modals */
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [newCollection, setNewCollection] = useState({ name: '', base_url: '', auth_type: 'none' });
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  /* ------------------------------ loaders ----------------------------- */

  const loadCollections = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: ApiCollection[] }>(`/projects/${projectId}/collections`);
      setCollections(res.data ?? []);
      setActiveCollection((current) => {
        if (current && res.data?.some((c) => c.id === current)) return current;
        return res.data?.[0]?.id ?? null;
      });
    } catch (err) {
      setError(err);
      setCollections([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadRequests = useCallback(async (collectionId: string) => {
    try {
      const res = await api.get<{ data: ApiRequest[] }>(`/collections/${collectionId}/requests`);
      setRequests(res.data ?? []);
      setActiveRequest((current) => {
        if (current && res.data?.some((r) => r.id === current.id)) return current;
        return null;
      });
    } catch (err) {
      toast.fromError(err, 'Gagal memuat request');
      setRequests([]);
    }
  }, []);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    if (activeCollection) void loadRequests(activeCollection);
    else setRequests([]);
  }, [activeCollection, loadRequests]);

  /** Pushes a saved request into the editor buffers. */
  const openRequest = useCallback((req: ApiRequest) => {
    setActiveRequest(req);
    setMethod((req.method as Method) ?? 'GET');
    setPath(req.path ?? '/');
    setHeaders(parseJsonObject(req.headers));
    setQuery(parseJsonObject(req.query));
    setBody(req.body ?? '');
    setBodyType((req.body_type as 'json' | 'form' | 'raw' | 'none') ?? 'none');
    setAssertions(parseAssertions(req.assertions));
    setPreScript(req.pre_script ?? '');
    setPostScript(req.post_script ?? '');
    setOutcome(null);
    setProblem(null);
    setTab('headers');
  }, []);

  const startNewRequest = () => {
    setActiveRequest(null);
    setMethod('GET');
    setPath('/health');
    setHeaders({});
    setQuery({});
    setBody('');
    setBodyType('none');
    setAssertions([{ source: 'status', operator: 'equals', expected: 200, message: 'HTTP 200' }]);
    setPreScript('');
    setPostScript('');
    setOutcome(null);
    setProblem(null);
    setTab('headers');
  };

  /* ------------------------------ actions ----------------------------- */

  const collection = useMemo(
    () => collections.find((c) => c.id === activeCollection) ?? null,
    [collections, activeCollection],
  );

  const save = async () => {
    if (!activeCollection) {
      toast.warn('Pilih atau buat collection terlebih dahulu.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: activeRequest?.name ?? `${method} ${path}`,
        method,
        path,
        headers,
        query,
        body: bodyType === 'none' ? null : body,
        body_type: bodyType,
        assertions,
        pre_script: preScript || null,
        post_script: postScript || null,
      };

      if (activeRequest) {
        const res = await api.patch<{ data: ApiRequest }>(`/requests/${activeRequest.id}`, payload);
        setActiveRequest(res.data);
        toast.ok('Request tersimpan.');
      } else {
        const res = await api.post<{ data: ApiRequest }>(`/collections/${activeCollection}/requests`, payload);
        setActiveRequest(res.data);
        toast.ok('Request baru dibuat.');
      }
      await loadRequests(activeCollection);
    } catch (err) {
      toast.fromError(err, 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!activeRequest) return;
    try {
      await api.del(`/requests/${activeRequest.id}`);
      toast.ok('Request dihapus.');
      setActiveRequest(null);
      if (activeCollection) await loadRequests(activeCollection);
    } catch (err) {
      toast.fromError(err, 'Gagal menghapus');
    }
  };

  /** Send = run the SAVED request (the engine reads from the database). */
  const send = async () => {
    setSending(true);
    setProblem(null);
    setOutcome(null);
    try {
      // Persist first so the engine and the UI agree on what ran.
      await save();
      const id = activeRequest?.id;
      if (!id) {
        const saved = await api.post<{ data: ApiRequest }>(`/collections/${activeCollection}/requests`, {
          name: `${method} ${path}`,
          method,
          path,
          headers,
          query,
          body: bodyType === 'none' ? null : body,
          body_type: bodyType,
          assertions,
          pre_script: preScript || null,
          post_script: postScript || null,
        });
        setActiveRequest(saved.data);
        const res = await api.post<{ data: RunOutcome }>(`/requests/${saved.data.id}/run`, {});
        setOutcome(res.data);
        if (activeCollection) await loadRequests(activeCollection);
        toast[res.data.status === 'passed' ? 'ok' : res.data.status === 'skipped' ? 'info' : 'err'](
          `Status: ${res.data.status}`,
        );
        return;
      }

      const res = await api.post<{ data: RunOutcome }>(`/requests/${id}/run`, {});
      setOutcome(res.data);
      if (activeCollection) await loadRequests(activeCollection);
      toast[res.data.status === 'passed' ? 'ok' : res.data.status === 'skipped' ? 'info' : 'err'](
        `Status: ${res.data.status} · HTTP ${res.data.http_status ?? '—'} · ${fmtDuration(res.data.duration_ms)}`,
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setProblem(err.message);
        toast.err(err.message);
      } else {
        toast.fromError(err, 'Gagal mengirim request');
      }
    } finally {
      setSending(false);
    }
  };

  const runCollection = async () => {
    if (!activeCollection) return;
    setRunningCollection(true);
    try {
      const res = await api.post<{
        data: { total: number; passed: number; failed: number; blocked: number };
      }>(`/collections/${activeCollection}/run`, {});
      const d = res.data;
      toast[d.failed ? 'warn' : 'ok'](
        `Collection selesai: ${d.passed} lulus, ${d.failed} gagal, ${d.blocked} terblokir dari ${d.total}.`,
      );
      await loadRequests(activeCollection);
    } catch (err) {
      toast.fromError(err, 'Gagal menjalankan collection');
    } finally {
      setRunningCollection(false);
    }
  };

  const createCollection = async () => {
    if (!projectId) return;
    if (!newCollection.name.trim()) {
      toast.warn('Nama collection wajib diisi.');
      return;
    }
    try {
      const res = await api.post<{ data: ApiCollection }>(`/projects/${projectId}/collections`, {
        name: newCollection.name,
        base_url: newCollection.base_url || null,
        auth_type: newCollection.auth_type,
        variables: {},
      });
      toast.ok('Collection dibuat.');
      setShowNewCollection(false);
      setNewCollection({ name: '', base_url: '', auth_type: 'none' });
      await loadCollections();
      setActiveCollection(res.data.id);
    } catch (err) {
      toast.fromError(err, 'Gagal membuat collection');
    }
  };

  const runImport = async () => {
    if (!activeCollection) {
      toast.warn('Pilih collection tujuan import terlebih dahulu.');
      return;
    }
    if (!importText.trim()) {
      toast.warn('Tempelkan dokumen OpenAPI/Swagger JSON terlebih dahulu.');
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const res = await api.post<{ data: ImportResult }>(`/collections/${activeCollection}/import-openapi`, {
        spec: importText,
      });
      setImportResult(res.data);
      toast.ok(`${res.data.created} request berhasil diimpor.`);
      await loadRequests(activeCollection);
      await loadCollections();
    } catch (err) {
      toast.fromError(err, 'Import gagal');
    } finally {
      setImporting(false);
    }
  };

  /* -------------------------- assertion helpers ------------------------ */

  const updateAssertion = (i: number, patch: Partial<Assertion>) => {
    setAssertions((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  };

  /* ------------------------------- render ----------------------------- */

  if (!projectId) {
    return <Empty icon="📁" title="Pilih project terlebih dahulu" />;
  }

  const responseBody =
    outcome?.evidence && typeof outcome.evidence.response_body === 'string'
      ? outcome.evidence.response_body
      : null;

  return (
    <>
      <PageHeader
        title="API Automation"
        subtitle="Bangun, jalankan, dan verifikasi REST API. Assertion memakai DSL yang sama dengan engine Database dan Web."
        actions={
          <>
            <button className="btn" onClick={() => setShowImport(true)} disabled={!activeCollection}>
              ⇪ Import OpenAPI
            </button>
            <button className="btn" onClick={() => void runCollection()} disabled={runningCollection || !requests.length}>
              {runningCollection ? 'Menjalankan…' : `▶ Jalankan Collection (${requests.length})`}
            </button>
          </>
        }
      />

      <div className="api-layout">
        {/* --------------------------- sidebar --------------------------- */}
        <div className="stack">
          <Card
            title="Collections"
            actions={
              <button className="btn btn-sm" onClick={() => setShowNewCollection(true)}>
                + Baru
              </button>
            }
          >
            {loading ? (
              <Loading />
            ) : error ? (
              <ErrorBox error={error} onRetry={() => void loadCollections()} />
            ) : !collections.length ? (
              <Empty icon="🗂️" title="Belum ada collection" subtitle="Buat collection untuk mulai." />
            ) : (
              <div className="stack stack-sm">
                {collections.map((c) => (
                  <button
                    key={c.id}
                    className={`api-item ${c.id === activeCollection ? 'active' : ''}`}
                    onClick={() => setActiveCollection(c.id)}
                  >
                    <div className="api-item-name">{c.name}</div>
                    <div className="mute-sm truncate">{c.base_url ?? '— tanpa base url —'}</div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card
            title={`Requests (${requests.length})`}
            actions={
              <button className="btn btn-sm" onClick={startNewRequest} disabled={!activeCollection}>
                + Request
              </button>
            }
          >
            {!requests.length ? (
              <Empty icon="🔌" title="Belum ada request" subtitle="Tambahkan request atau impor OpenAPI." />
            ) : (
              <div className="api-sidebar-list stack stack-sm">
                {requests.map((r) => (
                  <button
                    key={r.id}
                    className={`api-item ${r.id === activeRequest?.id ? 'active' : ''}`}
                    onClick={() => openRequest(r)}
                  >
                    <div className="row" style={{ gap: 6 }}>
                      <span className={`api-method api-method-${r.method.toLowerCase()}`}>{r.method}</span>
                      <span className="api-item-name">{r.name}</span>
                    </div>
                    <div className="row" style={{ gap: 6, marginTop: 2 }}>
                      {r.last_status ? (
                        <Badge tone={r.last_status < 400 ? 'ok' : 'err'}>{r.last_status}</Badge>
                      ) : (
                        <span className="mute-sm">belum dijalankan</span>
                      )}
                      <span className="mute-sm truncate">{r.path}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* --------------------------- editor ---------------------------- */}
        <div className="stack">
          <Card
            title={activeRequest ? `Edit: ${activeRequest.name}` : 'Request Baru'}
            actions={
              <div className="row">
                {activeRequest ? (
                  <button className="btn btn-danger btn-sm" onClick={() => void remove()}>
                    Hapus
                  </button>
                ) : null}
                <button className="btn btn-sm" onClick={() => void save()} disabled={saving || !activeCollection}>
                  {saving ? 'Menyimpan…' : '💾 Simpan'}
                </button>
              </div>
            }
          >
            {!activeCollection ? (
              <Empty icon="🗂️" title="Pilih collection" subtitle="Request selalu berada di dalam sebuah collection." />
            ) : (
              <>
                <div className="api-urlbar rc-mb">
                  <select
                    className="select"
                    style={{ maxWidth: 118 }}
                    value={method}
                    onChange={(e) => setMethod(e.target.value as Method)}
                  >
                    {METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    placeholder="/products atau https://host/path"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                  />
                  <button className="btn btn-primary" onClick={() => void send()} disabled={sending}>
                    {sending ? 'Mengirim…' : '➤ Kirim'}
                  </button>
                </div>

                <div className="mute-sm rc-mb">
                  Base URL collection: <span className="cell-mono">{collection?.base_url ?? '— belum diisi —'}</span> ·
                  auth: <span className="cell-mono">{collection?.auth_type ?? 'none'}</span> · gunakan{' '}
                  <span className="cell-mono">{'{{variabel}}'}</span> untuk interpolasi.
                </div>

                <Tabs<EditorTab>
                  tabs={[
                    { id: 'headers', label: `Headers (${Object.keys(headers).length})` },
                    { id: 'query', label: `Query (${Object.keys(query).length})` },
                    { id: 'body', label: 'Body' },
                    { id: 'assertions', label: `Assertion (${assertions.length})` },
                    { id: 'scripts', label: 'Script' },
                  ]}
                  active={tab}
                  onChange={setTab}
                />

                {tab === 'headers' ? (
                  <KeyValueGrid
                    values={headers}
                    onChange={setHeaders}
                    keyPlaceholder="Content-Type"
                    valuePlaceholder="application/json"
                  />
                ) : null}

                {tab === 'query' ? (
                  <KeyValueGrid
                    values={query}
                    onChange={setQuery}
                    keyPlaceholder="limit"
                    valuePlaceholder="10"
                  />
                ) : null}

                {tab === 'body' ? (
                  <div className="stack stack-sm">
                    <Field label="Tipe body">
                      <select
                        className="select"
                        value={bodyType}
                        onChange={(e) => setBodyType(e.target.value as 'json' | 'form' | 'raw' | 'none')}
                      >
                        <option value="none">none</option>
                        <option value="json">json</option>
                        <option value="form">form</option>
                        <option value="raw">raw</option>
                      </select>
                    </Field>
                    {bodyType !== 'none' ? (
                      <Field label="Body" hint="Metode GET/HEAD mengabaikan body.">
                        <textarea
                          className="textarea db-sql"
                          value={body}
                          onChange={(e) => setBody(e.target.value)}
                          placeholder={bodyType === 'json' ? '{\n  "name": "Contoh"\n}' : 'key=value&lain=nya'}
                        />
                      </Field>
                    ) : (
                      <div className="mute-sm">Request ini tidak mengirim body.</div>
                    )}
                  </div>
                ) : null}

                {tab === 'assertions' ? (
                  <div className="stack stack-sm">
                    <div className="mute-sm">
                      Sumber <span className="cell-mono">status</span> / <span className="cell-mono">duration</span> /{' '}
                      <span className="cell-mono">header</span> / <span className="cell-mono">jsonpath</span> (mis.{' '}
                      <span className="cell-mono">$.data.id</span>) — operator sesuai DSL.
                    </div>
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
                          placeholder="path / nama header / selector"
                          value={a.path ?? ''}
                          onChange={(e) => updateAssertion(i, { path: e.target.value })}
                        />
                        <select
                          className="select input-sm"
                          value={a.operator}
                          onChange={(e) => updateAssertion(i, { operator: e.target.value as AssertionOperator })}
                        >
                          {OPERATORS.map((o) => (
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
                      onClick={() =>
                        setAssertions((prev) => [...prev, { source: 'jsonpath', path: '$.', operator: 'exists' }])
                      }
                    >
                      + Tambah assertion
                    </button>
                  </div>
                ) : null}

                {tab === 'scripts' ? (
                  <div className="stack stack-sm">
                    <div className="alert alert-info">
                      QATools <strong>tidak</strong> mengeksekusi JavaScript bebas. Hanya bentuk aman ini yang
                      diterima: <span className="cell-mono">set(&quot;nama&quot;, jsonpath(&quot;$.data.token&quot;))</span>,{' '}
                      <span className="cell-mono">set(&quot;kode&quot;, status)</span>, dan{' '}
                      <span className="cell-mono">header(&quot;X-Trace&quot;, jsonpath(&quot;$.id&quot;))</span>.
                    </div>
                    <Field label="Pre-script (sebelum request)">
                      <textarea
                        className="textarea db-sql"
                        value={preScript}
                        onChange={(e) => setPreScript(e.target.value)}
                        placeholder={'set("base", "https://contoh.test")'}
                      />
                    </Field>
                    <Field label="Post-script (setelah response)">
                      <textarea
                        className="textarea db-sql"
                        value={postScript}
                        onChange={(e) => setPostScript(e.target.value)}
                        placeholder={'set("token", jsonpath("$.data.token"))'}
                      />
                    </Field>
                  </div>
                ) : null}
              </>
            )}
          </Card>

          {/* ------------------------ response panel ------------------------ */}
          {problem ? <div className="alert alert-err">{problem}</div> : null}

          {outcome ? (
            <Card
              title="Response"
              actions={
                <div className="row">
                  <Badge tone={outcome.status === 'passed' ? 'ok' : outcome.status === 'skipped' ? 'muted' : 'err'}>
                    {outcome.status}
                  </Badge>
                  <Badge tone={(outcome.http_status ?? 0) < 400 ? 'ok' : 'err'}>
                    HTTP {outcome.http_status ?? '—'}
                  </Badge>
                  <span className="chip">{fmtDuration(outcome.duration_ms)}</span>
                </div>
              }
            >
              <div className="cell-mono mute-sm rc-mb">{outcome.url}</div>

              <div className="tabs">
                <button className="tab active">Body</button>
              </div>
              <pre className="pre api-response-pre">{responseBody ? pretty(responseBody) : JSON.stringify(outcome.evidence, null, 2)}</pre>

              <h4 className="card-title" style={{ marginTop: 'var(--space-4)' }}>
                Hasil Assertion ({outcome.assertions.filter((a) => a.passed).length}/{outcome.assertions.length})
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
                <div className="mute-sm">Tidak ada assertion pada request ini.</div>
              )}

              <h4 className="card-title" style={{ marginTop: 'var(--space-4)' }}>
                Log Langkah
              </h4>
              <div>
                {outcome.logs.map((l) => (
                  <div className="web-step-log" key={l.index}>
                    <span className="web-step-badge">
                      <Badge tone={l.status === 'ok' ? 'ok' : l.status === 'fail' ? 'err' : 'muted'}>{l.status}</Badge>
                    </span>
                    <span className="cell-mono" style={{ flex: '0 0 100px' }}>
                      {l.action}
                    </span>
                    <span className="web-msg">{l.message}</span>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      {/* --------------------------- new collection --------------------- */}
      {showNewCollection ? (
        <Modal
          title="Collection Baru"
          onClose={() => setShowNewCollection(false)}
          size="sm"
          footer={
            <>
              <button className="btn" onClick={() => setShowNewCollection(false)}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={() => void createCollection()}>
                Buat
              </button>
            </>
          }
        >
          <div className="stack">
            <Field label="Nama" required>
              <input
                className="input"
                value={newCollection.name}
                onChange={(e) => setNewCollection({ ...newCollection, name: e.target.value })}
                placeholder="Contoh: Mock API QATools"
              />
            </Field>
            <Field
              label="Base URL"
              hint="Kosongkan untuk memakai path absolut. Mock bawaan QATools ada di /api/mock."
            >
              <input
                className="input"
                value={newCollection.base_url}
                onChange={(e) => setNewCollection({ ...newCollection, base_url: e.target.value })}
                placeholder="/api/mock"
              />
            </Field>
            <Field label="Tipe auth">
              <select
                className="select"
                value={newCollection.auth_type}
                onChange={(e) => setNewCollection({ ...newCollection, auth_type: e.target.value })}
              >
                <option value="none">none</option>
                <option value="bearer">bearer</option>
                <option value="basic">basic</option>
                <option value="api_key">api_key</option>
              </select>
            </Field>
          </div>
        </Modal>
      ) : null}

      {/* ----------------------------- import --------------------------- */}
      {showImport ? (
        <Modal
          title="Import OpenAPI / Swagger"
          onClose={() => setShowImport(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowImport(false)}>
                Tutup
              </button>
              <button className="btn btn-primary" onClick={() => void runImport()} disabled={importing}>
                {importing ? 'Mengimpor…' : 'Impor'}
              </button>
            </>
          }
        >
          <div className="stack">
            <div className="alert alert-info">
              Tempelkan dokumen dalam format <strong>JSON</strong> (OpenAPI 3.x atau Swagger 2.0). Setiap operasi
              menjadi satu request dengan assertion awal pada status sukses.
            </div>
            <Field label="Dokumen">
              <textarea
                className="textarea db-sql"
                style={{ minHeight: 220 }}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder='{"openapi":"3.0.0","info":{"title":"Demo"},"paths":{...}}'
              />
            </Field>
            {importResult ? (
              <div className="alert alert-ok">
                <div>
                  <strong>{importResult.title}</strong> ({importResult.version})
                  <div>
                    {importResult.created} request dibuat, {importResult.skipped_existing} dilewati karena sudah ada.
                  </div>
                  {importResult.base_url ? <div>base_url: {importResult.base_url}</div> : null}
                </div>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Small key/value grid editor (local to this page)
 * ------------------------------------------------------------------ */

function KeyValueGrid(props: {
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
}) {
  const entries = Object.entries(props.values);

  return (
    <div className="stack stack-sm">
      {entries.map(([k, v], i) => (
        <div className="row" key={i}>
          <input
            className="input input-sm"
            style={{ maxWidth: 220 }}
            value={k}
            placeholder={props.keyPlaceholder}
            onChange={(e) => {
              const next: Record<string, string> = {};
              entries.forEach(([ek, ev], j) => {
                next[j === i ? e.target.value : ek] = ev;
              });
              props.onChange(next);
            }}
          />
          <input
            className="input input-sm"
            value={v}
            placeholder={props.valuePlaceholder}
            onChange={(e) => props.onChange({ ...props.values, [k]: e.target.value })}
          />
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              const next = { ...props.values };
              delete next[k];
              props.onChange(next);
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        className="btn btn-sm"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => props.onChange({ ...props.values, '': '' })}
      >
        + Tambah baris
      </button>
    </div>
  );
}

/** Expected values arrive as strings; numeric-looking ones become numbers. */
function coerce(raw: string): unknown {
  const t = raw.trim();
  if (t === '') return '';
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
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
