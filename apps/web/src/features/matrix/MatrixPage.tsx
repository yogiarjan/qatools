/**
 * Traceability Matrix page — the flagship deliverable (stage 5).
 *
 * Renders the digital traceability matrix: one row per requirement, columns for the
 * use cases / scenarios / test cases it reaches, a coverage badge per row, gap
 * highlighting, a heat legend, summary KPIs, click-through on every cell, a sync
 * button, exports, and an orphan section.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  COVERAGE_LABEL,
  COVERAGE_TONE,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  CASE_TYPE_LABEL,
  ENGINE_LABEL,
  LAYER_LABEL,
  type CoverageStatus,
  type MatrixDocument,
  type Priority,
} from '@qatools/shared';
import { api, listOf } from '../../lib/api';
import { toast } from '../../lib/toast';
import { useProject } from '../../lib/project';
import {
  PageHeader,
  Modal,
  Loading,
  ErrorBox,
  Empty,
  Badge,
  Tabs,
  Progress,
  fmtDateTime,
} from '../../components';

interface RequirementLite {
  id: string;
  code: string;
  title: string;
  priority: Priority;
  status: string;
}

interface UseCaseLite {
  id: string;
  code: string;
  name: string;
}

interface ScenarioLite {
  id: string;
  code: string;
  title: string;
  kind: string;
}

interface TestCaseLite {
  id: string;
  code: string;
  title: string;
  type: string;
  layer: string;
  engine: string;
  automation_status: string;
  risk_score: number;
  is_regression: number;
}

interface OrphanPayload {
  test_cases: Array<{
    id: string;
    code: string;
    title: string;
    risk_score: number;
    scenario_code: string | null;
    use_case_code: string | null;
  }>;
  scenarios_without_test_case: Array<{ id: string; code: string; title: string }>;
}

type ColumnMode = 'usecase' | 'scenario' | 'testcase';

interface CellDetail {
  title: string;
  subtitle?: string;
  rows: Array<{ id: string; code: string; label: string; meta?: string; tone?: 'ok' | 'warn' | 'err' | 'muted' | 'info' }>;
}

/** Heat colour for a coverage percentage — drives the legend and the coverage bar. */
function heatClass(pct: number, coverage: CoverageStatus): string {
  if (coverage === 'orphan') return 'mx-heat-orphan';
  if (pct >= 100) return 'mx-heat-100';
  if (pct >= 75) return 'mx-heat-75';
  if (pct >= 50) return 'mx-heat-50';
  if (pct > 0) return 'mx-heat-25';
  return 'mx-heat-0';
}

/**
 * Impact analysis modal state — the blast radius of an artifact, fetched from
 * `GET /projects/:projectId/matrix/impact/:artifactId`.
 */
interface ImpactView {
  title: string;
  code: string | null;
  kind: string;
  blastRadius: number;
  counts: Array<{ label: string; value: number }>;
  testCases: Array<{ id: string; code: string; title: string; risk_score: number; is_regression: number }>;
  regressionSuite: string[];
}

export default function MatrixPage() {
  const { projectId, project } = useProject();

  const [doc, setDoc] = useState<MatrixDocument | null>(null);
  const [requirements, setRequirements] = useState<Map<string, RequirementLite>>(new Map());
  const [useCases, setUseCases] = useState<Map<string, UseCaseLite>>(new Map());
  const [scenarios, setScenarios] = useState<Map<string, ScenarioLite>>(new Map());
  const [testCases, setTestCases] = useState<Map<string, TestCaseLite>>(new Map());
  const [orphans, setOrphans] = useState<OrphanPayload | null>(null);

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const [mode, setMode] = useState<ColumnMode>('usecase');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [search, setSearch] = useState('');
  const [cell, setCell] = useState<CellDetail | null>(null);
  const [impact, setImpact] = useState<ImpactView | null>(null);
  const [showOrphans, setShowOrphans] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [matrix, reqs, ucs, scs, tcs, orphanPayload] = await Promise.all([
        api.get<{ data: MatrixDocument }>(`/projects/${projectId}/matrix`),
        listOf<RequirementLite>(`/projects/${projectId}/requirements`),
        listOf<UseCaseLite>(`/projects/${projectId}/usecases`),
        listOf<ScenarioLite>(`/projects/${projectId}/scenarios`),
        listOf<TestCaseLite>(`/projects/${projectId}/testcases`),
        api
          .get<{ data: OrphanPayload }>(`/projects/${projectId}/matrix/orphans`)
          .catch(() => ({ data: { test_cases: [], scenarios_without_test_case: [] } })),
      ]);
      setDoc(matrix.data);
      setRequirements(new Map(reqs.map((r) => [r.id, r])));
      setUseCases(new Map(ucs.map((u) => [u.id, u])));
      setScenarios(new Map(scs.map((s) => [s.id, s])));
      setTestCases(new Map(tcs.map((t) => [t.id, t])));
      setOrphans(orphanPayload.data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sync() {
    setSyncing(true);
    try {
      const res = await api.post<{ data: { counts: { total: number; removed: number } } }>(
        `/projects/${projectId}/matrix/sync`,
        {},
      );
      const counts = res?.data?.counts;
      toast.ok(`Matrix disinkronkan: ${counts?.total ?? 0} link aktif.`);
      await load();
    } catch (err) {
      toast.fromError(err, 'Gagal sinkronisasi matrix');
    } finally {
      setSyncing(false);
    }
  }

  /** Real (non-orphan) requirement rows, filtered by search + gap toggle. */
  const rows = useMemo(() => {
    if (!doc) return [];
    return doc.cells
      .filter((c) => !c.requirement_id.startsWith('orphan:'))
      .filter((c) => (onlyGaps ? c.coverage !== 'covered' : true))
      .filter((c) => {
        if (!search) return true;
        const req = requirements.get(c.requirement_id);
        const needle = search.toLowerCase();
        return (
          (req?.code ?? '').toLowerCase().includes(needle) ||
          (req?.title ?? '').toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => {
        const ra = requirements.get(a.requirement_id)?.code ?? '';
        const rb = requirements.get(b.requirement_id)?.code ?? '';
        return ra.localeCompare(rb);
      });
  }, [doc, onlyGaps, search, requirements]);

  const summary = doc?.summary;

  const health = useMemo(() => {
    if (!summary) return { label: '—', tone: 'muted' as const };
    if (summary.gaps === 0 && summary.orphans === 0) return { label: 'Sehat', tone: 'ok' as const };
    if (summary.coverage_pct >= 80) return { label: 'Perlu Perhatian', tone: 'warn' as const };
    return { label: 'Kritis', tone: 'err' as const };
  }, [summary]);

  /** Test cases flagged as high risk that are not yet in the regression suite. */
  const regressionGaps = useMemo(() => {
    return [...testCases.values()].filter(
      (t) => Number(t.risk_score) >= 65 && Number(t.is_regression) === 0,
    );
  }, [testCases]);

  function openUseCases(requirementId: string, ids: string[]) {
    const req = requirements.get(requirementId);
    setCell({
      title: `Use Case untuk ${req?.code ?? requirementId}`,
      subtitle: req?.title,
      rows: ids.map((id) => {
        const uc = useCases.get(id);
        return { id, code: uc?.code ?? id, label: uc?.name ?? '(tidak ditemukan)' };
      }),
    });
  }

  function openScenarios(requirementId: string, ids: string[]) {
    const req = requirements.get(requirementId);
    setCell({
      title: `Skenario untuk ${req?.code ?? requirementId}`,
      subtitle: req?.title,
      rows: ids.map((id) => {
        const sc = scenarios.get(id);
        return { id, code: sc?.code ?? id, label: sc?.title ?? '(tidak ditemukan)', meta: sc?.kind };
      }),
    });
  }

  function openTestCases(requirementId: string, ids: string[]) {
    const req = requirements.get(requirementId);
    setCell({
      title: `Test Case untuk ${req?.code ?? requirementId}`,
      subtitle: req?.title,
      rows: ids.map((id) => {
        const tc = testCases.get(id);
        return {
          id,
          code: tc?.code ?? id,
          label: tc?.title ?? '(tidak ditemukan)',
          meta: tc ? `${LAYER_LABEL[tc.layer as keyof typeof LAYER_LABEL] ?? tc.layer} · ${ENGINE_LABEL[tc.engine as keyof typeof ENGINE_LABEL] ?? tc.engine}` : undefined,
          tone: tc && Number(tc.risk_score) >= 65 ? ('err' as const) : undefined,
        };
      }),
    });
  }

  /** Impact / blast-radius report for an artifact. */
  async function openImpact(artifactId: string) {
    try {
      const res = await api.get<{
        data: {
          artifact_kind: string;
          artifact_code: string | null;
          artifact_title: string | null;
          affected_requirements: unknown[];
          affected_use_cases: unknown[];
          affected_scenarios: unknown[];
          affected_test_cases: Array<{
            id: string;
            code: string;
            title: string;
            risk_score: number;
            is_regression: number;
          }>;
          affected_defects: unknown[];
          recommended_regression_suite: string[];
          blast_radius: number;
        };
      }>(`/projects/${projectId}/matrix/impact/${artifactId}`);

      const d = res.data;
      setImpact({
        title: `Blast Radius — ${d.artifact_code ?? artifactId}`,
        code: d.artifact_code,
        kind: d.artifact_kind,
        blastRadius: d.blast_radius,
        counts: [
          { label: 'Kebutuhan', value: d.affected_requirements.length },
          { label: 'Use case', value: d.affected_use_cases.length },
          { label: 'Skenario', value: d.affected_scenarios.length },
          { label: 'Test case', value: d.affected_test_cases.length },
          { label: 'Defect', value: d.affected_defects.length },
        ],
        testCases: d.affected_test_cases,
        regressionSuite: d.recommended_regression_suite,
      });
    } catch (err) {
      toast.fromError(err, 'Gagal menghitung impact');
    }
  }

  if (!projectId) {
    return <Empty icon="📁" title="Pilih project dulu" subtitle="Matrix bekerja per project." />;
  }
  if (loading && !doc) return <Loading label="Membangun digital traceability matrix…" />;
  if (error) return <ErrorBox error={error} onRetry={() => void load()} />;
  if (!doc) return null;

  const exportBase = `/api/projects/${projectId}/export/matrix`;

  return (
    <>
      <PageHeader
        title="Digital Traceability Matrix"
        subtitle={
          <>
            Tahap 5: peta digital kebutuhan → use case → skenario → test case. Setiap baris
            menunjukkan apakah sebuah kebutuhan sudah terbukti diuji, dan seberapa besar bagiannya
            yang terotomasi.
            {project ? <> Project: <b>{project.key}</b>.</> : null}
          </>
        }
        badge={<Badge tone={health.tone}>{health.label}</Badge>}
        actions={
          <>
            <a className="btn" href={`${exportBase}?format=csv`} download>
              ⬇️ Export CSV
            </a>
            <a className="btn" href={`${exportBase}?format=md`} download>
              ⬇️ Export MD
            </a>
            <a className="btn" href={`${exportBase}?format=json`} download>
              ⬇️ JSON
            </a>
            <button className="btn btn-primary" disabled={syncing} onClick={() => void sync()}>
              {syncing ? '⏳ Menyinkronkan…' : '🔄 Sync Matrix'}
            </button>
          </>
        }
      />

      {/* ------------------------------- summary ------------------------------- */}
      <div className="grid grid-4" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="stat">
          <span className="stat-label">Coverage</span>
          <span className="stat-value">{summary?.coverage_pct ?? 0}%</span>
          <div style={{ marginTop: 6 }}>
            <Progress
              value={summary?.coverage_pct ?? 0}
              tone={
                (summary?.coverage_pct ?? 0) >= 80
                  ? 'ok'
                  : (summary?.coverage_pct ?? 0) >= 50
                    ? 'warn'
                    : 'err'
              }
            />
          </div>
        </div>
        <div className="stat stat-ok">
          <span className="stat-label">Tercakup</span>
          <span className="stat-value">{summary?.covered ?? 0}</span>
          <span className="stat-delta">
            + {summary?.partial ?? 0} sebagian dari {summary?.requirements ?? 0} kebutuhan
          </span>
        </div>
        <div className="stat stat-err">
          <span className="stat-label">Gap</span>
          <span className="stat-value">{summary?.gaps ?? 0}</span>
          <span className="stat-delta">kebutuhan belum punya use case</span>
        </div>
        <div className="stat stat-warn">
          <span className="stat-label">Orphan</span>
          <span className="stat-value">{summary?.orphans ?? 0}</span>
          <span className="stat-delta">test case tanpa jalur requirement</span>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="stat stat-info">
          <span className="stat-label">Automation</span>
          <span className="stat-value">{summary?.automation_pct ?? 0}%</span>
        </div>
        <div className="stat">
          <span className="stat-label">Use Case</span>
          <span className="stat-value">{useCases.size}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Skenario</span>
          <span className="stat-value">{scenarios.size}</span>
        </div>
        <div className="stat stat-accent">
          <span className="stat-label">Test Case</span>
          <span className="stat-value">{testCases.size}</span>
        </div>
      </div>

      {/* --------------------------- coverage heat legend --------------------------- */}
      <div className="card mx-legend" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="row-between" style={{ flexWrap: 'wrap' }}>
          <div className="row row-wrap" style={{ gap: 'var(--space-3)' }}>
            <span className="label" style={{ margin: 0 }}>
              Legenda Coverage
            </span>
            <span className="mx-legend-item">
              <i className="mx-swatch mx-heat-100" /> 100% — use case, skenario, test case lengkap
            </span>
            <span className="mx-legend-item">
              <i className="mx-swatch mx-heat-75" /> 75% — ada skenario
            </span>
            <span className="mx-legend-item">
              <i className="mx-swatch mx-heat-50" /> 50% — baru use case
            </span>
            <span className="mx-legend-item">
              <i className="mx-swatch mx-heat-0" /> 0% — gap
            </span>
            <span className="mx-legend-item">
              <i className="mx-swatch mx-heat-orphan" /> orphan
            </span>
          </div>
          <span className="mute-sm">Dibuat {fmtDateTime(doc.generated_at)}</span>
        </div>
      </div>

      {/* -------------------------------- toolbar -------------------------------- */}
      <div className="toolbar">
        <input
          className="input input-sm search"
          placeholder="🔍 Cari kebutuhan…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="tabs" style={{ border: 'none', margin: 0 }}>
          {(
            [
              ['usecase', '🧩 Use Case'],
              ['scenario', '🧭 Skenario'],
              ['testcase', '🧪 Test Case'],
            ] as Array<[ColumnMode, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              className={`tab ${mode === id ? 'active' : ''}`}
              onClick={() => setMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className={`btn btn-sm ${onlyGaps ? 'btn-primary' : ''}`}
          onClick={() => setOnlyGaps(!onlyGaps)}
          title="Tampilkan hanya baris yang belum tercakup penuh"
        >
          {onlyGaps ? '✓ ' : ''}Hanya Gap
        </button>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => setShowOrphans(true)}>
          ⚠️ Orphan ({orphans?.test_cases.length ?? summary?.orphans ?? 0})
        </button>
      </div>

      {/* --------------------------------- matrix --------------------------------- */}
      {rows.length === 0 ? (
        <Empty
          icon="🔗"
          title={onlyGaps ? 'Tidak ada gap — semua kebutuhan tercakup! 🎉' : 'Belum ada kebutuhan'}
          subtitle={
            onlyGaps
              ? 'Matriks Anda sehat. Matikan filter "Hanya Gap" untuk melihat seluruh baris.'
              : 'Mulai dari halaman Kebutuhan, lalu turunkan menjadi use case, skenario, dan test case.'
          }
          action={
            onlyGaps ? (
              <button className="btn" onClick={() => setOnlyGaps(false)}>
                Tampilkan semua
              </button>
            ) : (
              <Link className="btn btn-primary" to="/requirements">
                📋 Buka Kebutuhan
              </Link>
            )
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table mx-table">
            <thead>
              <tr>
                <th style={{ width: '30%' }}>Kebutuhan</th>
                <th style={{ width: 84 }}>Prioritas</th>
                <th style={{ width: 92 }}>Status</th>
                <th style={{ width: mode === 'usecase' ? '22%' : '34%' }} className="mx-col">
                  {mode === 'usecase' ? 'Use Case' : mode === 'scenario' ? 'Skenario' : 'Test Case'}
                </th>
                <th style={{ width: 176 }}>Coverage</th>
                <th style={{ width: 70 }} align-right="true">
                  Auto
                </th>
                <th style={{ width: 90 }}>Risiko</th>
                <th style={{ width: '1%' }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const req = requirements.get(c.requirement_id);
                const count =
                  mode === 'usecase'
                    ? c.use_case_ids.length
                    : mode === 'scenario'
                      ? c.scenario_ids.length
                      : c.test_case_ids.length;
                const ids =
                  mode === 'usecase'
                    ? c.use_case_ids
                    : mode === 'scenario'
                      ? c.scenario_ids
                      : c.test_case_ids;

                const preview =
                  mode === 'usecase'
                    ? c.use_case_ids.map((id) => useCases.get(id)?.code ?? id)
                    : mode === 'scenario'
                      ? c.scenario_ids.map((id) => scenarios.get(id)?.code ?? id)
                      : c.test_case_ids.map((id) => testCases.get(id)?.code ?? id);

                return (
                  <tr
                    key={c.requirement_id}
                    className={c.coverage === 'gap' ? 'mx-row-gap' : ''}
                  >
                    <td>
                      <div className="stack stack-sm">
                        <span className="cell-mono">{req?.code ?? c.requirement_id}</span>
                        <span className="strong">{req?.title ?? '(tidak ditemukan)'}</span>
                      </div>
                    </td>
                    <td>
                      {req ? (
                        <Badge tone={PRIORITY_TONE[req.priority]}>
                          {PRIORITY_LABEL[req.priority]}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="mute-sm">{req?.status ?? '—'}</td>
                    <td className="mx-col">
                      {count === 0 ? (
                        <span className="muted">— belum ada —</span>
                      ) : (
                        <button
                          className="link-btn mx-cell-btn"
                          title="Klik untuk melihat detail"
                          onClick={() => {
                            if (mode === 'usecase') openUseCases(c.requirement_id, ids);
                            else if (mode === 'scenario') openScenarios(c.requirement_id, ids);
                            else openTestCases(c.requirement_id, ids);
                          }}
                        >
                          <span className="chip chip-active">{count} item</span>
                          <span className="mute-sm truncate mx-cell-codes">
                            {preview.slice(0, 4).join(', ')}
                            {preview.length > 4 ? ` +${preview.length - 4}` : ''}
                          </span>
                        </button>
                      )}
                    </td>
                    <td>
                      <div className="stack stack-sm">
                        <div className="row" style={{ gap: 6 }}>
                          <Badge tone={COVERAGE_TONE[c.coverage]}>
                            {COVERAGE_LABEL[c.coverage]}
                          </Badge>
                          <span className="cell-mono">{c.coverage_pct}%</span>
                        </div>
                        <div className={`mx-coverage-bar ${heatClass(c.coverage_pct, c.coverage)}`}>
                          <span style={{ width: `${c.coverage_pct}%` }} />
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }} className="cell-mono">
                      {c.automation_pct}%
                    </td>
                    <td>
                      <Badge
                        tone={c.risk === 'high' ? 'err' : c.risk === 'medium' ? 'warn' : 'ok'}
                      >
                        {c.risk === 'high' ? 'Tinggi' : c.risk === 'medium' ? 'Sedang' : 'Rendah'}
                      </Badge>
                    </td>
                    <td className="cell-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Lihat blast radius (impact analysis)"
                        onClick={() => void openImpact(c.requirement_id)}
                      >
                        🎯
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ------------------------------- regression gaps ------------------------------- */}
      {regressionGaps.length ? (
        <div className="alert alert-warn" style={{ marginTop: 'var(--space-4)' }}>
          <span>👑</span>
          <div>
            <b>{regressionGaps.length} test case berisiko tinggi belum masuk suite regresi.</b>{' '}
            Regresi adalah raja — pastikan kasus paling berisiko ikut dijaga.{' '}
            <Link to="/testcases">Buka Test Cases</Link> untuk menandainya.
          </div>
        </div>
      ) : null}

      {/* -------------------------------- cell detail -------------------------------- */}
      {cell ? (
        <Modal
          title={cell.title}
          onClose={() => setCell(null)}
          footer={
            <button className="btn" onClick={() => setCell(null)}>
              Tutup
            </button>
          }
        >
          {cell.subtitle ? <p className="card-sub">{cell.subtitle}</p> : null}
          {cell.rows.length ? (
            <ul className="list-clean">
              {cell.rows.map((row) => (
                <li key={row.id} className="row-between">
                  <span className="row" style={{ gap: 'var(--space-2)', minWidth: 0 }}>
                    <span className="cell-mono">{row.code}</span>
                    <span className="truncate">{row.label}</span>
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    {row.meta ? <span className="mute-sm">{row.meta}</span> : null}
                    {row.tone ? <Badge tone={row.tone}>risiko tinggi</Badge> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="muted">Belum ada artefak yang terhubung.</div>
          )}
        </Modal>
      ) : null}

      {/* --------------------------------- orphans --------------------------------- */}
      {showOrphans ? (
        <Modal
          title="⚠️ Orphan — Artefak Tanpa Induk"
          onClose={() => setShowOrphans(false)}
          size="lg"
          footer={
            <button className="btn" onClick={() => setShowOrphans(false)}>
              Tutup
            </button>
          }
        >
          <Tabs
            tabs={[
              { id: 'tc' as const, label: `Test Case (${orphans?.test_cases.length ?? 0})` },
              {
                id: 'sc' as const,
                label: `Skenario tanpa Test Case (${orphans?.scenarios_without_test_case.length ?? 0})`,
              },
            ]}
            active={'tc'}
            onChange={() => undefined}
          />
          <div className="stack">
            <div className="alert alert-warn">
              <span>ℹ️</span>
              <div>
                <b>Orphan</b> adalah artefak yang tidak bisa dilacak ke kebutuhan mana pun. Ini bukan
                selalu salah (misalnya test case eksploratif), tetapi biasanya menandakan kebutuhan
                yang belum tercatat atau tautan matrix yang hilang.
              </div>
            </div>

            <div>
              <span className="label">Test case tanpa jalur requirement</span>
              {orphans?.test_cases.length ? (
                <ul className="list-clean">
                  {orphans.test_cases.map((t) => (
                    <li key={t.id} className="row-between">
                      <span className="row" style={{ gap: 'var(--space-2)', minWidth: 0 }}>
                        <span className="cell-mono">{t.code}</span>
                        <span className="truncate">{t.title}</span>
                      </span>
                      <span className="row" style={{ gap: 6 }}>
                        <Badge tone={Number(t.risk_score) >= 65 ? 'err' : 'muted'}>
                          risiko {Number(t.risk_score).toFixed(0)}
                        </Badge>
                        <span className="mute-sm">
                          {t.scenario_code ?? t.use_case_code ?? 'tanpa induk'}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="muted">Tidak ada test case orphan. 👍</div>
              )}
            </div>

            <div>
              <span className="label">Skenario belum diturunkan ke test case</span>
              {orphans?.scenarios_without_test_case.length ? (
                <ul className="list-clean">
                  {orphans.scenarios_without_test_case.map((s) => (
                    <li key={s.id}>
                      <span className="cell-mono">{s.code}</span> — {s.title}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="muted">Semua skenario sudah punya test case. 👍</div>
              )}
            </div>
          </div>
        </Modal>
      ) : null}

      {impact ? (
        <Modal
          title={`🎯 ${impact.title}`}
          onClose={() => setImpact(null)}
          size="lg"
          footer={
            <button className="btn" onClick={() => setImpact(null)}>
              Tutup
            </button>
          }
        >
          <div className="stack">
            <div className="alert alert-info">
              <span>🎯</span>
              <div>
                <b>Blast radius</b> adalah jumlah artefak yang ikut terdampak bila{' '}
                <b>{impact.code ?? impact.title}</b> ({impact.kind}) berubah. Angka ini dipakai untuk
                memilih suite regresi yang optimal — bukan yang terbesar.
              </div>
            </div>

            <div className="grid grid-5">
              <div className="stat stat-accent">
                <span className="stat-label">Total</span>
                <span className="stat-value">{impact.blastRadius}</span>
              </div>
              {impact.counts.map((c) => (
                <div className="stat" key={c.label}>
                  <span className="stat-label">{c.label}</span>
                  <span className="stat-value">{c.value}</span>
                </div>
              ))}
            </div>

            <div>
              <span className="label">Test case terdampak (urut risiko)</span>
              {impact.testCases.length ? (
                <ul className="list-clean">
                  {impact.testCases.map((tc) => (
                    <li key={tc.id} className="row-between">
                      <span className="row" style={{ gap: 'var(--space-2)', minWidth: 0 }}>
                        <span className="cell-mono">{tc.code}</span>
                        <span className="truncate">{tc.title}</span>
                      </span>
                      <span className="row" style={{ gap: 6 }}>
                        <Badge tone={Number(tc.risk_score) >= 65 ? 'err' : 'muted'}>
                          risiko {Number(tc.risk_score).toFixed(0)}
                        </Badge>
                        {Number(tc.is_regression) === 1 ? <Badge tone="ok">👑 regresi</Badge> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="muted">Tidak ada test case terdampak.</div>
              )}
            </div>

            {impact.regressionSuite.length ? (
              <div className="alert alert-ok">
                <span>👑</span>
                <div>
                  <b>{impact.regressionSuite.length} test case</b> disarankan masuk suite regresi untuk
                  perubahan artefak ini.
                </div>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      <style>{`
        .mx-table td { vertical-align: middle; }
        .mx-col { min-width: 180px; }
        .mx-cell-btn { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; width: 100%; }
        .mx-cell-codes { display: block; max-width: 100%; }
        .mx-row-gap { background: color-mix(in srgb, var(--err) 7%, transparent); }
        .mx-row-gap:hover { background: color-mix(in srgb, var(--err) 11%, transparent) !important; }

        .mx-coverage-bar {
          height: 6px; border-radius: 20px; background: var(--surface-2); overflow: hidden;
        }
        .mx-coverage-bar span { display: block; height: 100%; border-radius: 20px; }
        .mx-heat-100 span { background: var(--ok); }
        .mx-heat-75 span { background: var(--warn); }
        .mx-heat-50 span { background: var(--info); }
        .mx-heat-25 span { background: color-mix(in srgb, var(--info) 60%, var(--surface-2)); }
        .mx-heat-0 span { background: var(--err); }
        .mx-heat-orphan span { background: var(--text-mute); }

        .mx-legend { padding: var(--space-3) var(--space-4); }
        .mx-legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-dim); }
        .mx-swatch {
          width: 13px; height: 9px; border-radius: 3px; display: inline-block;
          background: var(--surface-2);
        }
        .mx-swatch.mx-heat-100 { background: var(--ok); }
        .mx-swatch.mx-heat-75 { background: var(--warn); }
        .mx-swatch.mx-heat-50 { background: var(--info); }
        .mx-swatch.mx-heat-0 { background: var(--err); }
        .mx-swatch.mx-heat-orphan { background: var(--text-mute); }
      `}</style>
    </>
  );
}
