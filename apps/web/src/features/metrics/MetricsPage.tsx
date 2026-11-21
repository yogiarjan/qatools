/**
 * MetricsPage — lifecycle stage 12 (metrik & laporan QA).
 *
 * Renders the full frozen MetricsSnapshot: totals, coverage, quality, efficiency and readiness,
 * plus a hand-rolled SVG line chart for the pass/fail trend (no chart library is permitted).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  SEVERITY_LABEL,
  DEFECT_STATUS_LABEL,
  type MetricsSnapshot,
  type Severity,
  type DefectStatus,
} from '@qatools/shared';
import { api } from '../../lib/api';
import { useProject } from '../../lib/project';
import { toast } from '../../lib/toast';
import {
  PageHeader,
  Card,
  Badge,
  Progress,
  Loading,
  ErrorBox,
  Empty,
  fmtDateTime,
  pctLabel,
} from '../../components';

interface TrendPoint {
  date: string;
  passed: number;
  failed: number;
  blocked: number;
  total: number;
}

interface CatalogGroup {
  group: string;
  items: Array<{ key: string; label: string; formula: string; target: string }>;
}

const DAY_OPTIONS = [7, 14, 30, 60, 90];

/* ================================================================== *
 * Hand-rolled SVG line chart — no chart library.
 * ================================================================== */

interface Series {
  key: 'passed' | 'failed' | 'blocked';
  label: string;
  color: string;
}

const SERIES: Series[] = [
  { key: 'passed', label: 'Lulus', color: 'var(--ok)' },
  { key: 'failed', label: 'Gagal', color: 'var(--err)' },
  { key: 'blocked', label: 'Terblokir', color: 'var(--warn)' },
];

/**
 * A dependency-free multi-series line chart.
 *
 * Geometry: a viewBox normalised to `W×H`, with a left gutter for y-axis labels and a bottom
 * gutter for a handful of x-axis dates. Points are scaled to the data max so the chart is
 * always filled regardless of magnitude.
 */
function TrendChart(props: { points: TrendPoint[]; height?: number }) {
  const W = 900;
  const H = props.height ?? 260;
  const padLeft = 46;
  const padRight = 14;
  const padTop = 14;
  const padBottom = 30;

  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;
  const { points } = props;

  const max = useMemo(() => {
    const m = Math.max(1, ...points.map((p) => Math.max(p.passed, p.failed, p.blocked, 0)));
    // Round up to a friendly axis maximum.
    const step = m <= 5 ? 1 : m <= 20 ? 5 : m <= 100 ? 10 : 50;
    return Math.ceil(m / step) * step;
  }, [points]);

  if (!points.length) {
    return <Empty icon="📈" title="Belum ada data tren" subtitle="Tren muncul setelah ada eksekusi test." />;
  }

  const x = (i: number) => padLeft + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => padTop + plotH - (v / max) * plotH;

  const gridLines = 4;
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label="Grafik tren lulus, gagal, dan terblokir"
        style={{ display: 'block', minWidth: 520 }}
      >
        {/* horizontal grid + y labels */}
        {Array.from({ length: gridLines + 1 }, (_, i) => {
          const value = (max / gridLines) * i;
          const yy = y(value);
          return (
            <g key={`grid-${i}`}>
              <line
                x1={padLeft}
                x2={W - padRight}
                y1={yy}
                y2={yy}
                stroke="var(--border)"
                strokeWidth={1}
                strokeDasharray={i === 0 ? undefined : '3 4'}
              />
              <text x={padLeft - 8} y={yy + 4} textAnchor="end" fontSize={10} fill="var(--text-mute)">
                {Math.round(value)}
              </text>
            </g>
          );
        })}

        {/* x labels */}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text
              key={`x-${p.date}`}
              x={x(i)}
              y={H - 10}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-mute)"
            >
              {p.date.slice(5)}
            </text>
          ) : null,
        )}

        {/* series */}
        {SERIES.map((s) => {
          const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p[s.key]).toFixed(1)}`).join(' ');
          return (
            <g key={s.key}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {points.map((p, i) => (
                <circle key={`${s.key}-${p.date}`} cx={x(i)} cy={y(p[s.key])} r={2.5} fill={s.color}>
                  <title>{`${p.date} — ${s.label}: ${p[s.key]}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>

      <div className="row" style={{ gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
        {SERIES.map((s) => (
          <span key={s.key} className="row" style={{ gap: 6, fontSize: 12 }}>
            <span style={{ width: 12, height: 3, background: s.color, display: 'inline-block', borderRadius: 2 }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ================================================================== *
 * Simple horizontal bar list (defect breakdowns).
 * ================================================================== */

function BarList(props: { items: Array<{ label: string; value: number; tone?: string }>; empty?: string }) {
  const max = Math.max(1, ...props.items.map((i) => i.value));
  if (!props.items.length) return <div className="mute-sm">{props.empty ?? 'Tidak ada data.'}</div>;
  return (
    <div className="stack stack-sm">
      {props.items.map((i) => (
        <div key={i.label} className="row" style={{ gap: 'var(--space-3)' }}>
          <span style={{ minWidth: 108, fontSize: 12.5 }}>{i.label}</span>
          <div style={{ flex: 1 }}>
            <div className="progress">
              <div
                className="progress-bar"
                style={{ width: `${(i.value / max) * 100}%`, background: i.tone ?? 'var(--accent-grad)' }}
              />
            </div>
          </div>
          <span className="mono strong" style={{ minWidth: 26, textAlign: 'right' }}>
            {i.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ================================================================== *
 * Page
 * ================================================================== */

export default function MetricsPage() {
  const { projectId } = useProject();

  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [trendDays, setTrendDays] = useState(30);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [catalog, setCatalog] = useState<CatalogGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [showCatalog, setShowCatalog] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [m, t, c] = await Promise.all([
        api.get<{ data: MetricsSnapshot }>(`/projects/${projectId}/metrics`),
        api.get<{ data: { data: TrendPoint[] } }>(`/projects/${projectId}/metrics/trend?days=${trendDays}`),
        api.get<{ data: CatalogGroup[] }>('/metrics/catalog').catch(() => ({ data: [] })),
      ]);
      setMetrics(m.data);
      setTrend(t.data.data);
      setCatalog(c.data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [projectId, trendDays]);

  useEffect(() => {
    void load();
  }, [load]);

  const goTone = useMemo(() => {
    const g = metrics?.readiness.go_no_go;
    return g === 'go' ? 'ok' : g === 'conditional' ? 'warn' : 'err';
  }, [metrics]);

  if (!projectId) return <Empty icon="📁" title="Belum ada project" />;
  if (loading && !metrics) return <Loading label="Menghitung metrik QA…" />;
  if (error && !metrics) return <ErrorBox error={error} onRetry={() => void load()} />;
  if (!metrics) return <Empty icon="📊" title="Metrik tidak tersedia" />;

  const m = metrics;
  const gate = m.readiness.release_gate_pct;

  return (
    <>
      <PageHeader
        title="QA Metrics & Reporting"
        subtitle="Langkah 12 — katalog metrik lengkap: cakupan, kualitas, efisiensi, dan kesiapan rilis."
        actions={
          <>
            <button className="btn btn-sm" onClick={() => void load()}>
              ⟳ Hitung ulang
            </button>
            <button className="btn btn-sm" onClick={() => setShowCatalog((v) => !v)}>
              {showCatalog ? 'Sembunyikan rumus' : '📖 Katalog & rumus metrik'}
            </button>
            <Link className="btn btn-primary btn-sm" to="/regression">
              👑 Regresi
            </Link>
          </>
        }
      />

      {showCatalog ? (
        <Card title="📖 Katalog Metrik QA" subtitle="Definisi dan rumus setiap angka pada halaman ini." style={{ marginBottom: 'var(--space-4)' }}>
          <div className="grid grid-2">
            {catalog.map((g) => (
              <div key={g.group}>
                <div className="label" style={{ marginBottom: 6 }}>
                  {g.group}
                </div>
                <div className="stack stack-sm">
                  {g.items.map((it) => (
                    <div key={it.key} style={{ fontSize: 12.5 }}>
                      <div className="strong">{it.label}</div>
                      <div className="mute-sm mono" style={{ fontSize: 11.5 }}>
                        {it.formula}
                      </div>
                      <div className="mute-sm" style={{ fontSize: 11.5 }}>
                        target: {it.target}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* ------------------------------ readiness ----------------------------- */}
      <Card
        title="🚦 Kesiapan Rilis"
        subtitle={`Quality gate project: ${gate}% · dihitung ${fmtDateTime(m.generated_at)}`}
        style={{ marginBottom: 'var(--space-4)', borderColor: goTone === 'ok' ? 'var(--ok)' : undefined }}
      >
        <div className="grid grid-3" style={{ alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div
              className="stat-value"
              style={{
                fontSize: 34,
                color: goTone === 'ok' ? 'var(--ok)' : goTone === 'warn' ? 'var(--warn)' : 'var(--err)',
              }}
            >
              {m.readiness.go_no_go === 'go' ? 'GO' : m.readiness.go_no_go === 'conditional' ? 'KONDISIONAL' : 'NO-GO'}
            </div>
            <div className="stat-label">Keputusan Rilis</div>
          </div>
          <div>
            <div className="row-between">
              <span className="label">Pass rate vs quality gate</span>
              <span className="mono strong">
                {pctLabel(m.quality.pass_rate)} / {gate}%
              </span>
            </div>
            <Progress
              value={m.quality.pass_rate}
              tone={m.quality.pass_rate >= gate ? 'ok' : 'err'}
              large
            />
            <div className="mute-sm" style={{ marginTop: 4 }}>
              Kekurangan {(gate - m.quality.pass_rate).toFixed(1)} poin persen untuk membuka gerbang.
            </div>
          </div>
          <div>
            <div className="label" style={{ marginBottom: 6 }}>
              Blocker ({m.readiness.blockers.length})
            </div>
            {!m.readiness.blockers.length ? (
              <div className="alert alert-ok" style={{ fontSize: 12.5 }}>
                <span>✅</span>
                <span>Tidak ada blocker.</span>
              </div>
            ) : (
              <div className="stack stack-sm" style={{ maxHeight: 160, overflowY: 'auto' }}>
                {m.readiness.blockers.map((b, i) => (
                  <div key={i} className="alert alert-warn" style={{ fontSize: 12 }}>
                    <span>⛔</span>
                    <span>{b}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ------------------------------- totals ------------------------------- */}
      <div className="grid grid-4" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="stat">
          <span className="stat-label">Kebutuhan</span>
          <span className="stat-value">{m.totals.requirements}</span>
          <span className="stat-delta">
            {m.totals.use_cases} use case · {m.totals.scenarios} skenario
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Test Case</span>
          <span className="stat-value">{m.totals.test_cases}</span>
          <span className="stat-delta">{m.totals.automated} terotomasi</span>
        </div>
        <div className="stat stat-accent">
          <span className="stat-label">Suite Regresi</span>
          <span className="stat-value">{m.coverage.regression_suite_size}</span>
          <span className="stat-delta">pass rate {pctLabel(m.quality.regression_suite_pass_pct)}</span>
        </div>
        <div className="stat stat-warn">
          <span className="stat-label">Defect</span>
          <span className="stat-value">{m.totals.defects_open}</span>
          <span className="stat-delta">terbuka dari {m.totals.defects_total} total</span>
        </div>
      </div>

      {/* ------------------------------ coverage ------------------------------ */}
      <div className="grid grid-2" style={{ marginBottom: 'var(--space-4)' }}>
        <Card title="🎯 Cakupan (Coverage)">
          <div className="stack">
            {[
              { label: 'Cakupan Kebutuhan', value: m.coverage.requirement_coverage_pct, hint: 'kebutuhan punya test case' },
              { label: 'Cakupan Eksekusi', value: m.coverage.test_case_execution_pct, hint: 'test case sudah dieksekusi' },
              { label: 'Rasio Otomasi', value: m.coverage.automation_pct, hint: 'test case terotomasi' },
            ].map((row) => (
              <div key={row.label}>
                <div className="row-between">
                  <span className="label">{row.label}</span>
                  <span className="mono strong">{pctLabel(row.value)}</span>
                </div>
                <Progress
                  value={row.value}
                  tone={row.value >= 90 ? 'ok' : row.value >= 60 ? 'warn' : 'err'}
                />
                <div className="mute-sm" style={{ fontSize: 11 }}>
                  {row.hint}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="⚙️ Efisiensi (Efficiency)">
          <div className="kv">
            <span className="kv-key">Rata-rata durasi kasus</span>
            <span className="mono">
              {m.efficiency.avg_case_duration_ms
                ? `${(m.efficiency.avg_case_duration_ms / 1000).toFixed(1)} detik`
                : '—'}
            </span>
            <span className="kv-key">ROI otomasi</span>
            <span className="mono">{m.efficiency.automation_roi_minutes_saved} menit tersimpan</span>
            <span className="kv-key">Estimasi hemat per run</span>
            <span className="mono strong" style={{ color: 'var(--ok)' }}>
              {m.efficiency.estimated_hours_saved_per_run} jam
            </span>
            <span className="kv-key">Total run</span>
            <span className="mono">{m.totals.runs}</span>
          </div>
          <div className="divider" />
          <div className="mute-sm" style={{ fontSize: 11.5 }}>
            ROI dihitung dengan asumsi baseline eksekusi manual 3 menit per test case; otomasi dikreditkan dengan
            durasi terukurnya.
          </div>
        </Card>
      </div>

      {/* -------------------------------- trend ------------------------------- */}
      <Card
        title="📈 Tren Lulus / Gagal / Terblokir"
        subtitle={`${trend.length} hari terakhir · grafik SVG tanpa library eksternal`}
        style={{ marginBottom: 'var(--space-4)' }}
        actions={
          <div className="row" style={{ gap: 'var(--space-2)' }}>
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                className={`btn btn-sm ${trendDays === d ? 'btn-primary' : ''}`}
                onClick={() => setTrendDays(d)}
              >
                {d}h
              </button>
            ))}
          </div>
        }
      >
        <TrendChart points={trend} />
      </Card>

      {/* -------------------------------- quality ----------------------------- */}
      <Card title="✅ Kualitas (Quality)" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="grid grid-4">
          <div className="stat stat-ok">
            <span className="stat-label">Pass Rate</span>
            <span className="stat-value">{pctLabel(m.quality.pass_rate)}</span>
          </div>
          <div className="stat stat-err">
            <span className="stat-label">Fail Rate</span>
            <span className="stat-value">{pctLabel(m.quality.fail_rate)}</span>
          </div>
          <div className="stat stat-warn">
            <span className="stat-label">Block Rate</span>
            <span className="stat-value">{pctLabel(m.quality.block_rate)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Defect Density</span>
            <span className="stat-value">{m.quality.defect_density}</span>
            <span className="stat-delta">defect per test case</span>
          </div>
          <div className="stat">
            <span className="stat-label">Defect Leakage</span>
            <span className="stat-value">{pctLabel(m.quality.defect_leakage_pct)}</span>
            <span className="stat-delta">lolos ke production</span>
          </div>
          <div className="stat">
            <span className="stat-label">Reopen Rate</span>
            <span className="stat-value">{pctLabel(m.quality.reopen_rate)}</span>
          </div>
          <div className="stat stat-accent">
            <span className="stat-label">Pass Rate Regresi</span>
            <span className="stat-value">{pctLabel(m.quality.regression_suite_pass_pct)}</span>
            <span className="stat-delta">hanya run berjenis regresi</span>
          </div>
        </div>
      </Card>

      {/* -------------------------------- defects ----------------------------- */}
      <div className="grid grid-2" style={{ marginBottom: 'var(--space-4)' }}>
        <Card title="🐞 Defect per Severity">
          <BarList
            items={Object.entries(m.defects_by_severity)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => ({
                label: SEVERITY_LABEL[k as Severity] ?? k,
                value: v,
                tone:
                  k === 'blocker' || k === 'critical'
                    ? 'var(--err)'
                    : k === 'major'
                      ? 'var(--warn)'
                      : 'var(--accent-grad)',
              }))}
            empty="Belum ada defect tercatat."
          />
        </Card>
        <Card title="📋 Defect per Status">
          <BarList
            items={Object.entries(m.defects_by_status)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => ({
                label: DEFECT_STATUS_LABEL[k as DefectStatus] ?? k,
                value: v,
              }))}
            empty="Belum ada defect tercatat."
          />
        </Card>
      </div>

      {/* --------------------------------- flaky ------------------------------ */}
      <Card
        title="🎲 Test Case Flaky"
        subtitle="Kasus dengan riwayat status bolak-balik — perusak terbesar kepercayaan pada hasil regresi."
      >
        {!m.flaky_cases.length ? (
          <Empty icon="🎲" title="Tidak ada kasus flaky" subtitle="Riwayat eksekusi stabil dalam 90 hari terakhir." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Judul</th>
                  <th>Pergantian</th>
                  <th>Pass Rate</th>
                </tr>
              </thead>
              <tbody>
                {m.flaky_cases.map((f) => (
                  <tr key={f.test_case_id}>
                    <td className="cell-mono">{f.code}</td>
                    <td>{f.title}</td>
                    <td>
                      <Badge tone={f.flips >= 4 ? 'err' : 'warn'}>{f.flips}×</Badge>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 'var(--space-2)' }}>
                        <span className="mono">{pctLabel(f.pass_rate)}</span>
                        <div style={{ width: 70 }}>
                          <Progress value={f.pass_rate} tone={f.pass_rate >= 80 ? 'ok' : 'warn'} />
                        </div>
                      </div>
                    </td>
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
