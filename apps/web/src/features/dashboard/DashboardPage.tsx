/**
 * Dashboard — the QA lifecycle landing page (lifecycle stages 1–12).
 *
 * The whole point of this page is to make the ORDERED nature of the tool unmistakable:
 * a 12-step pipeline strip driven by STAGE_META, each step carrying a live count and a
 * done/active/todo state, plus a "next suggested step" CTA that tells the tester exactly
 * what to do now.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  STAGE_META,
  DEFECT_STATUS_LABEL,
  DEFECT_STATUS_TONE,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  type Defect,
  type MetricsSnapshot,
  type QaStage,
  type TestRun,
} from '@qatools/shared';
import { api, listOf } from '../../lib/api';
import { useProject } from '../../lib/project';
import { toast } from '../../lib/toast';
import {
  PageHeader,
  Card,
  Stat,
  Badge,
  Progress,
  Loading,
  ErrorBox,
  Empty,
  fmtDateTime,
  pctLabel,
} from '../../components';

/* ------------------------------ stage counting ---------------------------- */

interface StageCount {
  count: number;
  hint: string;
}

/**
 * Live per-stage counts. Each stage answers a different question, so the payload differs:
 * entity counts for authoring stages, and aggregate verdicts for execution/regression.
 */
function useStageCounts(projectId: string | null) {
  const [counts, setCounts] = useState<Record<string, StageCount> | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    try {
      const [reqs, ucs, scs, tcs, matrix, cycles, envs, runs, defects, regSuite, metrics] = await Promise.all([
        listOf<unknown>('/requirements', { limit: 1 }).catch(() => []),
        listOf<unknown>('/usecases', { limit: 1 }).catch(() => []),
        listOf<unknown>('/scenarios', { limit: 1 }).catch(() => []),
        countOf(`/testcases?project_id=${projectId}`).catch(() => 0),
        api
          .get<{ data: { summary?: { coverage_pct?: number; gaps?: number; requirements?: number } } }>(
            `/projects/${projectId}/matrix`,
          )
          .catch(() => null),
        listOf<unknown>(`/projects/${projectId}/cycles`).catch(() => []),
        listOf<unknown>(`/projects/${projectId}/environments`).catch(() => []),
        listOf<TestRun>(`/projects/${projectId}/runs`, { limit: 200 }).catch(() => []),
        listOf<Defect>(`/projects/${projectId}/defects`).catch(() => []),
        api
          .get<{ data: unknown[] }>(`/projects/${projectId}/regression/suite`)
          .catch(() => ({ data: [] })),
        api.get<{ data: MetricsSnapshot }>(`/projects/${projectId}/metrics`).catch(() => null),
      ]);

      const matrixSummary = matrix?.data?.summary;
      const executed = metrics?.data?.coverage?.test_case_execution_pct ?? 0;
      const passRate = metrics?.data?.quality?.pass_rate ?? 0;
      const openDefects = defects.filter(
        (d) => d.status !== 'closed' && d.status !== 'rejected',
      ).length;

      setCounts({
        requirements: { count: reqs.length || matrixSummary?.requirements || 0, hint: 'kebutuhan tercatat' },
        usecases: { count: ucs.length, hint: 'use case ditulis' },
        scenarios: { count: scs.length, hint: 'skenario diturunkan' },
        testcases: { count: tcs, hint: 'test case dirancang' },
        matrix: {
          count: matrixSummary?.requirements ?? 0,
          hint: `coverage ${pctLabel(matrixSummary?.coverage_pct ?? 0)} · ${matrixSummary?.gaps ?? 0} gap`,
        },
        planning: { count: cycles.length, hint: 'cycle direncanakan' },
        environment: { count: envs.length, hint: 'environment siap' },
        execution: { count: runs.length, hint: `${pctLabel(executed)} test case dieksekusi` },
        defects: { count: openDefects, hint: `${defects.length} total defect` },
        regression: { count: regSuite.data?.length ?? 0, hint: 'anggota suite regresi' },
        release: {
          count: metrics?.data?.readiness?.blockers?.length ?? 0,
          hint: `pass rate ${pctLabel(passRate)}`,
        },
        metrics: { count: runs.filter((r) => r.status === 'completed').length, hint: 'run selesai dilaporkan' },
      });
    } catch (err) {
      setError(err);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { counts, error, reload: load };
}

async function countOf(path: string): Promise<number> {
  const res = await api.get<{ data: unknown[]; total?: number }>(path);
  return res.total ?? res.data?.length ?? 0;
}

/* ------------------------------- stage strip ------------------------------ */

type StageState = 'done' | 'active' | 'todo';

/**
 * Done/active/todo is derived from a per-stage readiness rule. `active` marks the single
 * earliest incomplete stage — that is the step the CTA points at.
 */
function stageState(stage: QaStage, counts: Record<string, StageCount> | null, metrics: MetricsSnapshot | null): StageState {
  const c = counts?.[stage]?.count ?? 0;
  switch (stage) {
    case 'requirements':
      return c > 0 ? 'done' : 'todo';
    case 'usecases':
      return c > 0 ? 'done' : 'todo';
    case 'scenarios':
      return c > 0 ? 'done' : 'todo';
    case 'testcases':
      return c > 0 ? 'done' : 'todo';
    case 'matrix':
      return c > 0 && (metrics?.coverage.requirement_coverage_pct ?? 0) >= 80 ? 'done' : c > 0 ? 'active' : 'todo';
    case 'planning':
      return c > 0 ? 'done' : 'todo';
    case 'environment':
      return c > 0 ? 'done' : 'todo';
    case 'execution':
      return (metrics?.coverage.test_case_execution_pct ?? 0) > 0 ? 'done' : 'todo';
    case 'defects':
      // Defects are done when every open defect has at least been triaged.
      return c === 0 && (metrics?.totals.defects_total ?? 0) > 0 ? 'done' : c > 0 ? 'active' : 'todo';
    case 'regression':
      return (counts?.regression?.count ?? 0) > 0 ? 'done' : 'todo';
    case 'release':
      return metrics?.readiness.go_no_go === 'go' ? 'done' : metrics?.readiness.go_no_go ? 'active' : 'todo';
    case 'metrics':
      return (counts?.metrics?.count ?? 0) > 0 ? 'done' : 'todo';
    default:
      return 'todo';
  }
}

const STAGE_PATH: Record<QaStage, string> = {
  requirements: '/requirements',
  usecases: '/usecases',
  scenarios: '/scenarios',
  testcases: '/testcases',
  matrix: '/matrix',
  planning: '/cycles',
  environment: '/environment',
  execution: '/runs',
  defects: '/defects',
  regression: '/regression',
  release: '/regression',
  metrics: '/metrics',
};

function StageStrip(props: {
  counts: Record<string, StageCount> | null;
  metrics: MetricsSnapshot | null;
  activeStage: QaStage;
}) {
  const { counts, metrics, activeStage } = props;
  return (
    <div className="grid grid-4" style={{ gap: 'var(--space-3)' }}>
      {STAGE_META.map((meta) => {
        const raw = stageState(meta.id, counts, metrics);
        const state: StageState = meta.id === activeStage ? 'active' : raw;
        const info = counts?.[meta.id];
        const tone =
          state === 'done' ? 'var(--ok)' : state === 'active' ? 'var(--accent)' : 'var(--border-strong)';
        return (
          <Link
            key={meta.id}
            to={STAGE_PATH[meta.id]}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div
              className="card"
              style={{
                borderLeft: `3px solid ${tone}`,
                padding: 'var(--space-3)',
                height: '100%',
                ...(state === 'active' ? { borderColor: 'var(--accent)' } : {}),
              }}
            >
              <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'flex-start' }}>
                <span className="mono" style={{ color: 'var(--text-mute)', fontSize: 11 }}>
                  {String(meta.order).padStart(2, '0')}
                </span>
                <span style={{ fontSize: 15 }}>{meta.icon}</span>
                <span className="strong" style={{ fontSize: 13, flex: 1 }}>
                  {meta.label}
                </span>
                {state === 'done' ? (
                  <span title="Selesai" style={{ color: 'var(--ok)' }}>
                    ✓
                  </span>
                ) : state === 'active' ? (
                  <span title="Langkah berikutnya" style={{ color: 'var(--accent)' }}>
                    ●
                  </span>
                ) : (
                  <span title="Belum dimulai" style={{ color: 'var(--text-mute)' }}>
                    ○
                  </span>
                )}
              </div>
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
                <span className="stat-value" style={{ fontSize: 19 }}>
                  {info ? info.count : '—'}
                </span>
                <span className="mute-sm" style={{ textAlign: 'right', fontSize: 10.5 }}>
                  {info?.hint ?? ''}
                </span>
              </div>
              <div className="mute-sm truncate" style={{ fontSize: 10.5, marginTop: 4 }} title={meta.blurb}>
                {meta.blurb}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/* --------------------------------- page ---------------------------------- */

export default function DashboardPage() {
  const { project, projectId } = useProject();
  const { counts, error, reload } = useStageCounts(projectId);

  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [metricsError, setMetricsError] = useState<unknown>(null);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setMetricsError(null);
    try {
      const [m, r, d] = await Promise.all([
        api.get<{ data: MetricsSnapshot }>(`/projects/${projectId}/metrics`),
        listOf<TestRun>(`/projects/${projectId}/runs`, { limit: 6 }),
        listOf<Defect>(`/projects/${projectId}/defects`),
      ]);
      setMetrics(m.data);
      setRuns(r);
      setDefects(d.slice(0, 6));
    } catch (err) {
      setMetricsError(err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The first incomplete stage in lifecycle order is what the tester should do next. */
  const nextStage = useMemo(() => {
    for (const meta of STAGE_META) {
      if (stageState(meta.id, counts, metrics) !== 'done') return meta;
    }
    return STAGE_META[STAGE_META.length - 1]!;
  }, [counts, metrics]);

  if (!projectId) {
    return <Empty icon="📁" title="Belum ada project" subtitle="Buat project terlebih dahulu." />;
  }
  if (loading && !metrics) return <Loading label="Memuat dashboard…" />;
  if (metricsError && !metrics) return <ErrorBox error={metricsError} onRetry={() => void load()} />;

  const readiness = metrics?.readiness;
  const goTone = readiness?.go_no_go === 'go' ? 'ok' : readiness?.go_no_go === 'conditional' ? 'warn' : 'err';

  return (
    <>
      <PageHeader
        title="Dashboard QA"
        subtitle={
          <>
            Alur QA berurutan 12 langkah untuk <strong>{project?.name ?? 'project'}</strong>. Setiap
            langkah memiliki masukan dari langkah sebelumnya — jangan lompati urutannya.
          </>
        }
        actions={
          <>
            <button className="btn btn-sm" onClick={() => { void load(); void reload(); }}>
              ⟳ Muat ulang
            </button>
            <Link className="btn btn-primary btn-sm" to={STAGE_PATH[nextStage.id]}>
              {nextStage.icon} Lanjut: {nextStage.label}
            </Link>
          </>
        }
      />

      {error ? (
        <div className="alert alert-warn" style={{ marginBottom: 'var(--space-4)' }}>
          <span>⚠️</span>
          <div>Sebagian data langkah gagal dimuat: {String((error as Error)?.message ?? error)}</div>
        </div>
      ) : null}

      {/* ------------------------- next suggested step ------------------------- */}
      <Card
        title={`Langkah berikutnya yang disarankan — Langkah ${nextStage.order} dari 12`}
        subtitle={nextStage.blurb}
        style={{ marginBottom: 'var(--space-4)', borderColor: 'var(--accent)' }}
        actions={
          <Link className="btn btn-primary btn-sm" to={STAGE_PATH[nextStage.id]}>
            {nextStage.icon} Kerjakan sekarang
          </Link>
        }
      >
        <div className="row row-wrap" style={{ gap: 'var(--space-3)' }}>
          <Badge tone="accent">#{nextStage.order}</Badge>
          <span className="strong">{nextStage.label}</span>
          <span className="muted">({nextStage.labelEn})</span>
          <span className="spacer" />
          <Progress
            value={((STAGE_META.filter((m) => stageState(m.id, counts, metrics) === 'done').length) / 12) * 100}
          />
          <span className="mute-sm">
            {STAGE_META.filter((m) => stageState(m.id, counts, metrics) === 'done').length}/12 langkah selesai
          </span>
        </div>
      </Card>

      {/* --------------------------- lifecycle strip --------------------------- */}
      <div className="row-between" style={{ marginBottom: 'var(--space-3)' }}>
        <h2 className="card-title" style={{ margin: 0 }}>
          🔄 Siklus QA Berurutan (12 Langkah)
        </h2>
        <span className="mute-sm">✓ selesai · ● langkah aktif sekarang · ○ belum dimulai</span>
      </div>
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <StageStrip counts={counts} metrics={metrics} activeStage={nextStage.id} />
      </div>

      {/* ------------------------------ stat cards ----------------------------- */}
      <div className="grid grid-4" style={{ marginBottom: 'var(--space-4)' }}>
        <Stat
          label="Cakupan Kebutuhan"
          value={pctLabel(metrics?.coverage.requirement_coverage_pct)}
          hint={`eksekusi ${pctLabel(metrics?.coverage.test_case_execution_pct)} · otomasi ${pctLabel(metrics?.coverage.automation_pct)}`}
          tone="info"
        />
        <Stat
          label="Pass Rate"
          value={pctLabel(metrics?.quality.pass_rate)}
          hint={`${metrics?.quality.fail_rate ?? 0}% gagal · ${metrics?.quality.block_rate ?? 0}% blokir`}
          tone={(metrics?.quality.pass_rate ?? 0) >= (readiness?.release_gate_pct ?? 90) ? 'ok' : 'err'}
        />
        <Stat
          label="Defect Terbuka"
          value={metrics?.totals.defects_open ?? 0}
          hint={`dari ${metrics?.totals.defects_total ?? 0} total · density ${metrics?.quality.defect_density ?? 0}`}
          tone={(metrics?.totals.defects_open ?? 0) > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="Suite Regresi"
          value={metrics?.coverage.regression_suite_size ?? 0}
          hint="👑 Raja dari Test — gerbang rilis"
          tone="accent"
        />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 'var(--space-4)' }}>
        {/* ------------------------------ readiness ----------------------------- */}
        <Card title="🚦 Kesiapan Rilis (Release Gate)">
          <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'center' }}>
            <div style={{ textAlign: 'center', minWidth: 110 }}>
              <div
                className="stat-value"
                style={{
                  fontSize: 30,
                  color: goTone === 'ok' ? 'var(--ok)' : goTone === 'warn' ? 'var(--warn)' : 'var(--err)',
                }}
              >
                {readiness?.go_no_go === 'go' ? 'GO' : readiness?.go_no_go === 'conditional' ? 'KONDISIONAL' : 'NO-GO'}
              </div>
              <div className="stat-label">Keputusan</div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="row-between" style={{ marginBottom: 4 }}>
                <span className="mute-sm">Quality gate: {readiness?.release_gate_pct ?? 0}%</span>
                <span className="mute-sm">Pass rate: {pctLabel(metrics?.quality.pass_rate)}</span>
              </div>
              <Progress
                value={metrics?.quality.pass_rate ?? 0}
                tone={(metrics?.quality.pass_rate ?? 0) >= (readiness?.release_gate_pct ?? 90) ? 'ok' : 'err'}
                large
              />
            </div>
          </div>

          <div className="divider" />
          {readiness?.blockers?.length ? (
            <div className="stack stack-sm">
              <span className="label">Blocker ({readiness.blockers.length})</span>
              {readiness.blockers.map((b, i) => (
                <div key={i} className="alert alert-warn" style={{ fontSize: 12.5 }}>
                  <span>⛔</span>
                  <span>{b}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="alert alert-ok">
              <span>✅</span>
              <span>Tidak ada blocker. Lanjutkan ke eksekusi regresi terakhir sebelum rilis.</span>
            </div>
          )}

          <div className="row" style={{ marginTop: 'var(--space-3)' }}>
            <Link className="btn btn-sm" to="/regression">
              👑 Buka halaman Regresi
            </Link>
            <Link className="btn btn-ghost btn-sm" to="/metrics">
              📊 Lihat metrik lengkap
            </Link>
          </div>
        </Card>

        {/* ----------------------------- latest runs ---------------------------- */}
        <Card
          title="Run Terbaru"
          actions={
            <Link className="btn btn-ghost btn-sm" to="/runs">
              Semua run →
            </Link>
          }
        >
          {!runs.length ? (
            <Empty
              icon="▶️"
              title="Belum ada run"
              subtitle="Buat run manual atau jalankan otomasi dari halaman Test Runs."
              action={
                <Link className="btn btn-primary btn-sm" to="/runs">
                  Buat Run
                </Link>
              }
            />
          ) : (
            <div className="stack stack-sm">
              {runs.map((r) => {
                const total = r.total || 0;
                const rate = total ? (r.passed / total) * 100 : 0;
                return (
                  <div key={r.id} className="row" style={{ gap: 'var(--space-3)' }}>
                    <span className="cell-mono" style={{ minWidth: 74 }}>
                      {r.code}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row-between">
                        <span className="truncate" style={{ fontSize: 13 }}>
                          {r.name}
                        </span>
                        <Badge tone={r.status === 'completed' ? 'ok' : r.status === 'aborted' ? 'err' : 'info'}>
                          {r.status}
                        </Badge>
                      </div>
                      <div className="row" style={{ gap: 'var(--space-2)', marginTop: 3 }}>
                        <Progress value={rate} tone={rate >= 90 ? 'ok' : rate >= 70 ? 'warn' : 'err'} />
                        <span className="mute-sm" style={{ whiteSpace: 'nowrap' }}>
                          {r.passed}/{total} lulus
                          {r.failed ? ` · ${r.failed} gagal` : ''}
                          {r.blocked ? ` · ${r.blocked} blokir` : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* --------------------------- recent defects ---------------------------- */}
      <Card
        title="Defect Terbaru"
        actions={
          <Link className="btn btn-ghost btn-sm" to="/defects">
            Semua defect →
          </Link>
        }
      >
        {!defects.length ? (
          <Empty icon="🐞" title="Tidak ada defect" subtitle="Bagus — belum ada defect tercatat pada project ini." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Judul</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Dibuat</th>
                </tr>
              </thead>
              <tbody>
                {defects.map((d) => (
                  <tr key={d.id}>
                    <td className="cell-mono">{d.code}</td>
                    <td>{d.title}</td>
                    <td>
                      <Badge tone={SEVERITY_TONE[d.severity]}>{SEVERITY_LABEL[d.severity]}</Badge>
                    </td>
                    <td>
                      <Badge tone={DEFECT_STATUS_TONE[d.status]}>{DEFECT_STATUS_LABEL[d.status]}</Badge>
                    </td>
                    <td className="mute-sm">{fmtDateTime(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
