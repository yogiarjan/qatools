/**
 * Run Center — the flagship execution page.
 *
 * Route: /execute  (registered by the Lead in App.tsx)
 *
 * Features: engine picker, multi-select test cases with filters, dry-run toggle,
 * live-ish results table, drill-down into per-step logs / assertion results /
 * evidence, "Buat Defect" on failures, and an honest engine capability panel.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  EngineResult,
  ExecEngine,
  RunStatus,
  SuiteResult,
} from '@qatools/shared';
import { EXEC_ENGINES, ENGINE_LABEL, RUN_STATUS_LABEL, RUN_STATUS_TONE } from '@qatools/shared';
import { api, ApiError } from '../../lib/api';
import { toast } from '../../lib/toast';
import { useProject } from '../../lib/project';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  Progress,
  Stat,
  fmtDuration,
  fmtDateTime,
} from '../../components';

/* ------------------------------- local types ----------------------------- */

interface CaseRow {
  id: string;
  code: string;
  title: string;
  engine: ExecEngine;
  layer: string;
  priority: string;
  severity: string;
  automation_status: string;
  is_regression: number;
  risk_score: number;
  status: string;
}

interface SuiteRow {
  test_case_id: string;
  code: string;
  title: string;
  status: RunStatus;
  duration_ms: number;
  error: string | null;
}

interface ResultDetail {
  id: string;
  status: RunStatus;
  engine: ExecEngine;
  duration_ms: number;
  actual_result: string | null;
  error_message: string | null;
  executed_at: string | null;
  executed_by: string | null;
  defect_id: string | null;
  evidence: Record<string, unknown> | null;
  test_case?: { code: string; title: string } | null;
}

interface CapabilityEntry {
  engine: ExecEngine;
  available: boolean;
  mode: string;
  reason: string;
  test_cases?: number;
}

interface Capabilities {
  engines: CapabilityEntry[];
  dialects: Array<{ dialect: string; available: boolean; driver: string; reason: string }>;
  web_modes: Array<{ mode: string; available: boolean; reason: string; version?: string | null }>;
  ai: { available: boolean; mode: string; reason: string };
  generated_at: string;
}

/* --------------------------------- helpers -------------------------------- */

const STATUS_FILTERS: Array<{ id: 'all' | RunStatus; label: string }> = [
  { id: 'all', label: 'Semua' },
  { id: 'passed', label: 'Lulus' },
  { id: 'failed', label: 'Gagal' },
  { id: 'blocked', label: 'Terblokir' },
  { id: 'not_run', label: 'Belum' },
];

/** Sane defaults: point automation at lane D's built-in mock system. */
const MOCK_BASE_HINT = '/api/mock';

export default function ExecutePage() {
  const { projectId } = useProject();

  /* ------------------------------ state ------------------------------- */
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const [engineFilter, setEngineFilter] = useState<'all' | ExecEngine>('all');
  const [search, setSearch] = useState('');
  const [onlyRegression, setOnlyRegression] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [dryRun, setDryRun] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [suite, setSuite] = useState<SuiteResult | null>(null);
  const [resultFilter, setResultFilter] = useState<'all' | RunStatus>('all');

  const [detail, setDetail] = useState<ResultDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [defectFor, setDefectFor] = useState<SuiteRow | null>(null);
  const [defectBusy, setDefectBusy] = useState(false);

  /* ------------------------------ loaders ----------------------------- */

  const loadCases = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: CaseRow[] }>('/execute/cases', {
        project_id: projectId,
        engine: engineFilter === 'all' ? undefined : engineFilter,
        search: search || undefined,
        regression: onlyRegression ? 'true' : undefined,
      });
      setCases(res.data ?? []);
    } catch (err) {
      setError(err);
      setCases([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, engineFilter, search, onlyRegression]);

  const loadCapabilities = useCallback(async () => {
    try {
      const res = await api.get<{ data: Capabilities }>('/execute/capabilities');
      setCapabilities(res.data);
    } catch {
      setCapabilities(null);
    }
  }, []);

  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);

  useEffect(() => {
    const t = setTimeout(() => void loadCases(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadCases, search]);

  /* ------------------------------ actions ----------------------------- */

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const allVisible = cases.every((c) => prev.has(c.id));
      const next = new Set(prev);
      for (const c of cases) {
        if (allVisible) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });
  };

  const runSuite = async () => {
    if (!selected.size) {
      toast.warn('Pilih minimal satu test case untuk dijalankan.');
      return;
    }
    setExecuting(true);
    setSuite(null);
    try {
      const res = await api.post<{ data: SuiteResult }>('/execute/suite', {
        test_case_ids: Array.from(selected),
        engine: engineFilter === 'all' ? undefined : engineFilter,
        dry_run: dryRun,
        executed_by: 'run-center',
      });
      setSuite(res.data);
      toast[dryRun ? 'info' : res.data.failed > 0 ? 'warn' : 'ok'](
        dryRun
          ? `Dry-run selesai: ${res.data.total} test case divalidasi.`
          : `Suite selesai: ${res.data.passed} lulus, ${res.data.failed} gagal dari ${res.data.total}.`,
      );
    } catch (err) {
      toast.fromError(err, 'Gagal menjalankan suite');
    } finally {
      setExecuting(false);
    }
  };

  const openDetail = async (row: SuiteRow) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const runId = suite?.run_id;
      if (!runId) throw new Error('Run id tidak tersedia.');
      const results = await api.get<{
        data: Array<ResultDetail & { test_case_id: string }>;
      }>(`/execute/runs/${runId}/results`);
      const match = (results.data ?? []).find((r) => r.test_case_id === row.test_case_id);
      if (!match) {
        toast.warn('Detail hasil belum tersedia untuk test case ini.');
        return;
      }
      setDetail(match);
    } catch (err) {
      toast.fromError(err, 'Gagal memuat detail');
    } finally {
      setDetailLoading(false);
    }
  };

  /** Calls lane-pm's promote-from-result; a 404 is expected until it lands. */
  const promoteToDefect = async (row: SuiteRow) => {
    setDefectBusy(true);
    try {
      const runId = suite?.run_id;
      const results = runId
        ? await api.get<{ data: Array<ResultDetail & { test_case_id: string }> }>(
            `/execute/runs/${runId}/results`,
          )
        : { data: [] };
      const resultId = (results.data ?? []).find((r) => r.test_case_id === row.test_case_id)?.id;

      if (!resultId) {
        toast.warn('Hasil run belum tersimpan, sehingga defect tidak dapat dibuat dari hasil ini.');
        return;
      }

      await api.post(`/defects/${resultId}/promote-from-result`, {
        title: `${row.code}: ${row.title}`,
        actual_result: row.error,
      });
      toast.ok('Defect berhasil dibuat dari hasil ini.');
      setDefectFor(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        toast.warn(
          'Fitur "Buat Defect" belum tersedia di server ini (endpoint defect belum terpasang). ' +
            'Buat defect manual di Defect Tracker.',
        );
      } else {
        toast.fromError(err, 'Gagal membuat defect');
      }
    } finally {
      setDefectBusy(false);
    }
  };

  /* ------------------------------ derived ----------------------------- */

  const visibleResults = useMemo(() => {
    const rows = suite?.results ?? [];
    return resultFilter === 'all' ? rows : rows.filter((r) => r.status === resultFilter);
  }, [suite, resultFilter]);

  const passRate = suite && suite.total ? (suite.passed / suite.total) * 100 : 0;

  const engineCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of cases) counts[c.engine] = (counts[c.engine] ?? 0) + 1;
    return counts;
  }, [cases]);

  /* ------------------------------- render ----------------------------- */

  return (
    <>
      <PageHeader
        title="Run Center"
        subtitle="Jalankan test case manual, database, API, web, atau AI dari satu tempat. Pilih engine, tinjau hasil, lalu drill-down ke log per langkah."
        actions={
          <>
            <button className="btn" onClick={() => void loadCases()} disabled={loading}>
              ⟳ Muat ulang
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void runSuite()}
              disabled={executing || !selected.size}
            >
              {executing ? 'Menjalankan…' : dryRun ? '▶ Dry-run' : '▶ Jalankan'}
            </button>
          </>
        }
      />

      {/* ------------------------- capability panel ------------------------- */}
      {capabilities ? (
        <Card
          title="Kesiapan Engine"
          subtitle="Status jujur dari setiap engine: apa yang benar-benar berjalan di mesin ini."
          className="rc-mb"
        >
          <div className="grid grid-5">
            {capabilities.engines.map((e) => (
              <div key={e.engine} className="rc-engine">
                <div className="row-between">
                  <span className="strong">{ENGINE_LABEL[e.engine]}</span>
                  <Badge tone={e.available ? 'ok' : 'muted'}>{e.available ? 'aktif' : 'nonaktif'}</Badge>
                </div>
                <div className="mute-sm" style={{ marginTop: 2 }}>
                  mode: <span className="cell-mono">{e.mode}</span>
                </div>
                <div className="rc-engine-reason">{e.reason}</div>
                <div className="mute-sm" style={{ marginTop: 4 }}>
                  {e.test_cases ?? 0} test case memakai engine ini
                </div>
              </div>
            ))}
          </div>
          <div className="rc-mode-note">
            <strong>Catatan mode web:</strong>{' '}
            {capabilities.web_modes.find((m) => m.mode === 'playwright')?.available
              ? 'Playwright terdeteksi — browser sungguhan tersedia.'
              : 'Playwright TIDAK terpasang, jadi Web Automation berjalan dalam mode HTTP (fetch + parser HTML internal). ' +
                'QATools tidak menyamar seolah browser dijalankan.'}
          </div>
        </Card>
      ) : (
        <div className="alert alert-warn rc-mb">
          Panel kesiapan engine tidak dapat dimuat. Periksa apakah API berjalan.
        </div>
      )}

      {/* ------------------------------ controls --------------------------- */}
      <Card className="rc-mb">
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <input
            className="input search"
            placeholder="Cari kode atau judul test case…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="select"
            style={{ maxWidth: 190 }}
            value={engineFilter}
            onChange={(e) => setEngineFilter(e.target.value as 'all' | ExecEngine)}
          >
            <option value="all">Semua engine</option>
            {EXEC_ENGINES.map((e) => (
              <option key={e} value={e}>
                {ENGINE_LABEL[e]} ({engineCounts[e] ?? 0})
              </option>
            ))}
          </select>
          <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              className="checkbox"
              checked={onlyRegression}
              onChange={(e) => setOnlyRegression(e.target.checked)}
            />
            <span className="label" style={{ margin: 0 }}>
              Hanya suite regresi
            </span>
          </label>
          <span className="spacer" />
          <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              className="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
            />
            <span className="label" style={{ margin: 0 }}>
              Dry-run (validasi tanpa menembak target)
            </span>
          </label>
        </div>
      </Card>

      {/* ------------------------------- cases ----------------------------- */}
      <Card
        title={`Test Case (${cases.length})`}
        actions={
          <div className="row">
            <span className="chip">{selected.size} dipilih</span>
            <button className="btn btn-sm" onClick={toggleAllVisible} disabled={!cases.length}>
              {cases.every((c) => selected.has(c.id)) && cases.length ? 'Kosongkan' : 'Pilih semua'}
            </button>
          </div>
        }
        className="rc-mb"
      >
        {loading ? (
          <Loading label="Memuat test case…" />
        ) : error ? (
          <ErrorBox error={error} onRetry={() => void loadCases()} />
        ) : !cases.length ? (
          <Empty
            icon="🧪"
            title="Belum ada test case"
            subtitle="Buat test case terlebih dahulu di halaman Test Cases, lalu kembali ke sini untuk menjalankannya."
          />
        ) : (
          <DataTable<CaseRow>
            rows={cases}
            rowKey={(r) => r.id}
            onRowClick={(r) => toggle(r.id)}
            columns={[
              {
                key: 'pick',
                header: '',
                width: '38px',
                render: (r) => (
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ),
              },
              { key: 'code', header: 'Kode', width: '110px', render: (r) => <span className="cell-mono">{r.code}</span> },
              { key: 'title', header: 'Judul', render: (r) => <span className="clamp-2">{r.title}</span> },
              {
                key: 'engine',
                header: 'Engine',
                width: '130px',
                render: (r) => <Badge tone="accent">{ENGINE_LABEL[r.engine]}</Badge>,
              },
              {
                key: 'risk',
                header: 'Risiko',
                width: '90px',
                render: (r) => (
                  <Badge tone={r.risk_score >= 65 ? 'err' : r.risk_score >= 35 ? 'warn' : 'muted'}>
                    {Math.round(r.risk_score)}
                  </Badge>
                ),
              },
              {
                key: 'reg',
                header: 'Regresi',
                width: '90px',
                render: (r) => (r.is_regression ? <Badge tone="info">ya</Badge> : <span className="mute-sm">—</span>),
              },
            ]}
          />
        )}
      </Card>

      {/* ------------------------------ results ---------------------------- */}
      {suite ? (
        <Card
          title="Hasil Eksekusi"
          subtitle={`Run ${suite.run_id} · ${fmtDuration(suite.duration_ms)}`}
          className="rc-mb"
          actions={
            <div className="row">
              <select
                className="select input-sm"
                style={{ maxWidth: 150 }}
                value={resultFilter}
                onChange={(e) => setResultFilter(e.target.value as 'all' | RunStatus)}
              >
                {STATUS_FILTERS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          }
        >
          <div className="grid grid-4 rc-mb">
            <Stat label="Total" value={suite.total} />
            <Stat label="Lulus" value={suite.passed} tone="ok" />
            <Stat label="Gagal" value={suite.failed} tone="err" />
            <Stat label="Terblokir" value={suite.blocked} tone="warn" />
          </div>
          <Progress value={passRate} tone={passRate >= 90 ? 'ok' : passRate >= 60 ? 'warn' : 'err'} large />

          <div style={{ marginTop: 'var(--space-4)' }}>
            <DataTable<SuiteRow>
              rows={visibleResults}
              rowKey={(r) => r.test_case_id}
              onRowClick={(r) => void openDetail(r)}
              empty={<Empty title="Tidak ada hasil pada filter ini" />}
              columns={[
                { key: 'code', header: 'Kode', width: '120px', render: (r) => <span className="cell-mono">{r.code}</span> },
                { key: 'title', header: 'Judul', render: (r) => <span className="clamp-2">{r.title}</span> },
                {
                  key: 'status',
                  header: 'Status',
                  width: '120px',
                  render: (r) => <Badge tone={RUN_STATUS_TONE[r.status]}>{RUN_STATUS_LABEL[r.status]}</Badge>,
                },
                {
                  key: 'duration',
                  header: 'Durasi',
                  width: '100px',
                  align: 'right',
                  render: (r) => <span className="cell-mono">{fmtDuration(r.duration_ms)}</span>,
                },
                {
                  key: 'error',
                  header: 'Error',
                  render: (r) =>
                    r.error ? <span className="rc-err clamp-2">{r.error}</span> : <span className="mute-sm">—</span>,
                },
                {
                  key: 'actions',
                  header: '',
                  width: '180px',
                  render: (r) => (
                    <div className="row" style={{ gap: 4 }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openDetail(r);
                        }}
                      >
                        Detail
                      </button>
                      {r.status === 'failed' ? (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDefectFor(r);
                          }}
                        >
                          Buat Defect
                        </button>
                      ) : null}
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </Card>
      ) : null}

      {/* --------------------------- detail modal -------------------------- */}
      {detailLoading ? <Loading label="Memuat detail hasil…" /> : null}

      {detail ? (
        <ResultDetailModal
          detail={detail}
          onClose={() => setDetail(null)}
          onPromote={() => {
            const row = (suite?.results ?? []).find((r) => r.test_case_id === (detail as unknown as { test_case_id?: string }).test_case_id);
            if (row) {
              setDetail(null);
              setDefectFor(row);
            } else {
              toast.warn('Test case untuk hasil ini tidak ditemukan pada suite.');
            }
          }}
        />
      ) : null}

      {defectFor ? (
        <ConfirmDialog
          title="Buat Defect dari hasil ini?"
          danger
          busy={defectBusy}
          confirmLabel="Buat Defect"
          message={
            <>
              Defect akan dibuat dari hasil <strong>{defectFor.code}</strong> — {defectFor.title}.
              {defectFor.error ? <div className="rc-err" style={{ marginTop: 8 }}>{defectFor.error}</div> : null}
            </>
          }
          onConfirm={() => void promoteToDefect(defectFor)}
          onCancel={() => setDefectFor(null)}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Drill-down modal: logs → assertions → evidence
 * ------------------------------------------------------------------ */

function ResultDetailModal(props: { detail: ResultDetail; onClose: () => void; onPromote: () => void }) {
  const [tab, setTab] = useState<'logs' | 'assertions' | 'evidence'>('logs');
  const { detail } = props;

  const evidence = (detail.evidence ?? {}) as Record<string, unknown>;
  const logs = Array.isArray(evidence.logs) ? (evidence.logs as Array<Record<string, unknown>>) : [];
  const assertions = Array.isArray(evidence.assertions)
    ? (evidence.assertions as Array<Record<string, unknown>>)
    : [];

  return (
    <Modal
      title={
        <span>
          {detail.test_case?.code ?? 'Hasil'}{' '}
          <Badge tone={RUN_STATUS_TONE[detail.status]}>{RUN_STATUS_LABEL[detail.status]}</Badge>
        </span>
      }
      onClose={props.onClose}
      size="lg"
      footer={
        <>
          {detail.status === 'failed' ? (
            <button className="btn btn-danger" onClick={props.onPromote}>
              🐞 Buat Defect
            </button>
          ) : null}
          <button className="btn" onClick={props.onClose}>
            Tutup
          </button>
        </>
      }
    >
      <div className="kv rc-mb">
        <span className="kv-key">Test case</span>
        <span>{detail.test_case?.title ?? '—'}</span>
        <span className="kv-key">Engine</span>
        <span>{ENGINE_LABEL[detail.engine] ?? detail.engine}</span>
        <span className="kv-key">Durasi</span>
        <span className="cell-mono">{fmtDuration(detail.duration_ms)}</span>
        <span className="kv-key">Dijalankan</span>
        <span>{fmtDateTime(detail.executed_at)} oleh {detail.executed_by ?? '—'}</span>
        <span className="kv-key">Actual result</span>
        <span>{detail.actual_result ?? '—'}</span>
        {detail.error_message ? (
          <>
            <span className="kv-key">Error</span>
            <span className="rc-err">{detail.error_message}</span>
          </>
        ) : null}
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'logs' ? 'active' : ''}`} onClick={() => setTab('logs')}>
          Log Langkah ({logs.length})
        </button>
        <button className={`tab ${tab === 'assertions' ? 'active' : ''}`} onClick={() => setTab('assertions')}>
          Assertion ({assertions.length})
        </button>
        <button className={`tab ${tab === 'evidence' ? 'active' : ''}`} onClick={() => setTab('evidence')}>
          Evidence
        </button>
      </div>

      {tab === 'logs' ? (
        logs.length ? (
          <ol className="rc-timeline">
            {logs.map((log, i) => (
              <li key={i} className={`rc-timeline-item rc-${String(log.status)}`}>
                <span className="rc-timeline-dot" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row-between">
                    <span className="strong cell-mono">{String(log.action ?? '')}</span>
                    <span className="mute-sm">{fmtDuration(Number(log.duration_ms ?? 0))}</span>
                  </div>
                  <div className="rc-log-msg">{String(log.message ?? '')}</div>
                  {log.observed !== undefined && log.observed !== null ? (
                    <div className="mute-sm cell-mono">observed: {JSON.stringify(log.observed)}</div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <Empty icon="📋" title="Tidak ada log" subtitle="Engine ini tidak merekam langkah per langkah." />
        )
      ) : null}

      {tab === 'assertions' ? (
        assertions.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Hasil</th>
                  <th>Sumber & Operator</th>
                  <th>Diamati</th>
                  <th>Pesan</th>
                </tr>
              </thead>
              <tbody>
                {assertions.map((a, i) => {
                  const assertion = (a.assertion ?? {}) as Record<string, unknown>;
                  return (
                    <tr key={i}>
                      <td>{a.passed ? <Badge tone="ok">lulus</Badge> : <Badge tone="err">gagal</Badge>}</td>
                      <td className="cell-mono">
                        {String(assertion.source ?? '')}
                        {assertion.path ? ` ${String(assertion.path)}` : ''} · {String(assertion.operator ?? '')}
                      </td>
                      <td className="cell-mono">{JSON.stringify(a.observed)}</td>
                      <td>{String(a.message ?? '')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="✅" title="Tidak ada assertion" subtitle="Hasil ditentukan oleh keberhasilan pemanggilan." />
        )
      ) : null}

      {tab === 'evidence' ? (
        <pre className="pre" style={{ maxHeight: 460 }}>
          {JSON.stringify(detail.evidence ?? {}, null, 2)}
        </pre>
      ) : null}

      <div className="rc-mb" />
      <Field label="ID hasil run">
        <input className="input input-sm" readOnly value={detail.id} />
      </Field>
    </Modal>
  );
}
