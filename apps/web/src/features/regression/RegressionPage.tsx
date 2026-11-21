/**
 * RegressionPage — 👑 KING OF THE TEST (lifecycle stage 10).
 *
 * This is the flagship page. It must make risk-based selection genuinely explainable:
 * every selected AND excluded case carries a human-readable reason, and the plan always
 * reports estimated duration, automated share, and coverage of high-risk cases.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RISK_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  ENGINE_LABEL,
  type ExecEngine,
  type RegressionPlan,
  type RiskLevel,
} from '@qatools/shared';
import { api, listOf } from '../../lib/api';
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
  Modal,
  Field,
  Tabs,
  fmtDateTime,
  fmtDuration,
  pctLabel,
} from '../../components';

/* ------------------------------ shared types ------------------------------ */

interface PlanDetail {
  threshold: number;
  strategy_label: string;
  budget_minutes: number | null;
  automated_count: number;
  manual_minutes: number;
  automated_minutes: number;
  high_risk_total: number;
  high_risk_covered: number;
  excluded_high_risk: Array<{ test_case_id: string; code: string; title: string; risk_score: number }>;
  impact_of: string | null;
  phases: Array<{ name: string; test_case_ids: string[]; reason: string }>;
  factors_legend: Record<string, string>;
}

interface ExplainedPlan extends RegressionPlan {
  detail: PlanDetail;
}

interface SuiteRow {
  id: string;
  code: string;
  title: string;
  priority: string;
  type: string;
  engine: string;
  automation_status: string;
  risk_score: number;
  estimated_minutes: number;
}

interface SuiteResponse {
  data: SuiteRow[];
  total: number;
  summary: {
    size: number;
    estimated_minutes: number;
    automated: number;
    by_priority: Record<string, number>;
    by_engine: Record<string, number>;
  };
}

interface FlakyRow {
  test_case_id: string;
  code: string;
  title: string;
  flips: number;
  pass_rate: number;
  executions: number;
  last_status: string | null;
}

interface StrategyInfo {
  id: string;
  label: string;
  description: string;
}

interface GateVerdict {
  verdict: 'go' | 'conditional' | 'no_go';
  pass_rate: number;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  message: string;
}

const STRATEGY_ICON: Record<string, string> = {
  risk_based: '🎯',
  full: '🧱',
  impact_only: '💥',
  smoke_then_full: '💨',
  time_boxed: '⏱️',
};

const RISK_TONE: Record<RiskLevel, 'err' | 'warn' | 'ok'> = { high: 'err', medium: 'warn', low: 'ok' };

export default function RegressionPage() {
  const { projectId } = useProject();

  const [strategy, setStrategy] = useState('risk_based');
  const [budgetMinutes, setBudgetMinutes] = useState(120);
  const [impactOf, setImpactOf] = useState('');

  const [plan, setPlan] = useState<ExplainedPlan | null>(null);
  const [suite, setSuite] = useState<SuiteResponse | null>(null);
  const [flaky, setFlaky] = useState<FlakyRow[]>([]);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [impactOptions, setImpactOptions] = useState<Array<{ id: string; label: string }>>([]);

  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'selected' | 'excluded' | 'suite' | 'flaky'>('selected');
  const [exclusionFilter, setExclusionFilter] = useState('');
  const [reasonModal, setReasonModal] = useState<{ kind: 'selected' | 'excluded'; row: RegressionPlan['selected'][number] | RegressionPlan['excluded'][number] } | null>(null);
  const [runModal, setRunModal] = useState(false);
  const [gate, setGate] = useState<GateVerdict | null>(null);
  const [overrides, setOverrides] = useState<Set<string>>(new Set());
  const [runForm, setRunForm] = useState({ engine: 'api' as ExecEngine, environment_id: '', dry_run: false, executed_by: '' });

  /* --------------------------------- data -------------------------------- */

  const loadSuite = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await api.get<SuiteResponse>(`/projects/${projectId}/regression/suite`);
      setSuite(res);
    } catch (err) {
      toast.fromError(err, 'Gagal memuat suite');
    }
  }, [projectId]);

  const loadFlaky = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await api.get<{ data: FlakyRow[] }>(`/projects/${projectId}/regression/flaky`);
      setFlaky(res.data);
    } catch {
      setFlaky([]);
    }
  }, [projectId]);

  const buildPlan = useCallback(
    async (opts?: { strategy?: string; budget?: number; impact?: string }) => {
      if (!projectId) return;
      const s = opts?.strategy ?? strategy;
      const b = opts?.budget ?? budgetMinutes;
      const imp = opts?.impact ?? impactOf;

      setPlanning(true);
      setError(null);
      try {
        const res = await api.get<{ data: ExplainedPlan }>(`/projects/${projectId}/regression/plan`, {
          strategy: s,
          budget_minutes: s === 'time_boxed' ? b : undefined,
          impact_of: s === 'impact_only' && imp ? imp : undefined,
        });
        setPlan(res.data);
        setOverrides(new Set());
      } catch (err) {
        setError(err);
      } finally {
        setPlanning(false);
      }
    },
    [projectId, strategy, budgetMinutes, impactOf],
  );

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    void (async () => {
      try {
        const [st, tc, uc] = await Promise.all([
          api.get<{ data: StrategyInfo[] }>(`/projects/${projectId}/regression/strategies`).catch(() => ({ data: [] })),
          listOf<{ id: string; code: string; title: string }>('/testcases', { limit: 2000 }).catch(() => []),
          listOf<{ id: string; code: string; name: string }>('/usecases', { limit: 500 }).catch(() => []),
        ]);
        setStrategies(st.data);
        setImpactOptions([
          ...uc.map((u) => ({ id: u.id, label: `${u.code} — ${u.name}` })),
          ...tc.slice(0, 200).map((t) => ({ id: t.id, label: `${t.code} — ${t.title}` })),
        ]);
      } finally {
        setLoading(false);
      }
      await buildPlan();
      await loadSuite();
      await loadFlaky();
    })();
  }, [projectId, buildPlan, loadSuite, loadFlaky]);

  /** When the user switches strategy, rebuild immediately so the table never lies. */
  useEffect(() => {
    if (!projectId || loading) return;
    void buildPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy, budgetMinutes, impactOf]);

  /* -------------------------------- actions ------------------------------ */

  async function runRegression() {
    if (!projectId) return;
    setBusy(true);
    try {
      const ids = overrides.size ? [...overrides] : undefined;
      const res = await api.post<{ data: { suite: { total: number; passed: number; failed: number }; gate: GateVerdict; run: { code: string } } }>(
        `/projects/${projectId}/regression/run`,
        {
          strategy,
          budget_minutes: strategy === 'time_boxed' ? budgetMinutes : undefined,
          impact_of: strategy === 'impact_only' ? impactOf || undefined : undefined,
          test_case_ids: ids,
          engine: runForm.engine,
          environment_id: runForm.environment_id || undefined,
          dry_run: runForm.dry_run,
          executed_by: runForm.executed_by || undefined,
        },
      );
      setGate(res.data.gate);
      toast.ok(`Regresi ${res.data.run.code} selesai: ${res.data.suite.passed}/${res.data.suite.total} lulus`);
      setRunModal(false);
      await loadSuite();
      await loadFlaky();
    } catch (err) {
      // 503 engine_unavailable is expected until lane-auto lands.
      toast.fromError(err, 'Regresi gagal dijalankan');
    } finally {
      setBusy(false);
    }
  }

  async function setSuiteMembership(testCaseIds: string[]) {
    if (!projectId) return;
    try {
      await api.put(`/projects/${projectId}/regression/suite`, { test_case_ids: testCaseIds });
      toast.ok('Anggota suite regresi diperbarui');
      await loadSuite();
      await buildPlan();
    } catch (err) {
      toast.fromError(err, 'Gagal memperbarui suite');
    }
  }

  async function addToSuite(ids: string[]) {
    if (!projectId || !ids.length) return;
    try {
      await api.post(`/projects/${projectId}/regression/suite`, { test_case_ids: ids });
      toast.ok(`${ids.length} test case ditambahkan ke suite regresi`);
      await loadSuite();
    } catch (err) {
      toast.fromError(err, 'Gagal menambah ke suite');
    }
  }

  async function removeFromSuite(ids: string[]) {
    if (!projectId || !ids.length) return;
    try {
      await api.del(`/projects/${projectId}/regression/suite`);
      toast.warn('Endpoint DELETE memerlukan body; gunakan PUT untuk mengatur ulang');
    } catch {
      /* fall through to the PUT path below */
    }
    // The API takes the full desired membership: remove the ids by rewriting the set.
    const remaining = (suite?.data ?? []).filter((r) => !ids.includes(r.id)).map((r) => r.id);
    await setSuiteMembership(remaining);
  }

  /* -------------------------------- derived ------------------------------ */

  const selected = plan?.selected ?? [];
  const excluded = plan?.excluded ?? [];

  /** Toggling a case off an included set removes it from what will run. */
  const effectiveSelected = useMemo(
    () => (overrides.size ? selected.filter((s) => overrides.has(s.test_case_id)) : selected),
    [selected, overrides],
  );

  const effectiveMinutes = useMemo(
    () =>
      effectiveSelected.reduce((sum, s) => {
        const fromSuite = suite?.data.find((r) => r.id === s.test_case_id);
        return sum + (fromSuite?.estimated_minutes ?? 10);
      }, 0),
    [effectiveSelected, suite],
  );

  const filteredExcluded = useMemo(() => {
    if (!exclusionFilter) return excluded;
    const needle = exclusionFilter.toLowerCase();
    return excluded.filter(
      (e) => e.code.toLowerCase().includes(needle) || e.title.toLowerCase().includes(needle) || e.reason.toLowerCase().includes(needle),
    );
  }, [excluded, exclusionFilter]);

  if (!projectId) return <Empty icon="📁" title="Belum ada project" />;
  if (loading) return <Loading label="Memuat halaman Regresi…" />;
  if (error && !plan) return <ErrorBox error={error} onRetry={() => void buildPlan()} />;

  const coverPct = plan?.estimates.coverage_of_high_risk_pct ?? 0;
  const highRiskGap = plan?.detail.excluded_high_risk.length ?? 0;

  return (
    <>
      <PageHeader
        title="👑 Regresi — King of the Test"
        subtitle="Langkah 10 — pilih suite regresi secara berbasis risiko, pahami alasan setiap keputusan, lalu jalankan sebagai gerbang rilis terakhir."
        actions={
          <>
            <button className="btn btn-sm" onClick={() => void buildPlan()} disabled={planning}>
              {planning ? '⏳ Menyusun…' : '⟳ Susun Ulang'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setRunModal(true)} disabled={!effectiveSelected.length}>
              ▶️ Jalankan Regresi
            </button>
          </>
        }
      />

      {/* --------------------------- strategy picker --------------------------- */}
      <Card
        title="Strategi Pemilihan Suite"
        subtitle="Setiap strategi menjawab pertanyaan berbeda. Pilih yang sesuai konteks rilis Anda."
        style={{ marginBottom: 'var(--space-4)' }}
      >
        <div className="grid grid-5" style={{ gap: 'var(--space-3)' }}>
          {(strategies.length
            ? strategies
            : [
                { id: 'risk_based', label: 'Berbasis Risiko', description: '' },
                { id: 'full', label: 'Suite Penuh', description: '' },
                { id: 'impact_only', label: 'Hanya Dampak', description: '' },
                { id: 'smoke_then_full', label: 'Smoke lalu Penuh', description: '' },
                { id: 'time_boxed', label: 'Dibatasi Waktu', description: '' },
              ]
          ).map((s) => {
            const active = s.id === strategy;
            return (
              <div
                key={s.id}
                className="card card-hover"
                onClick={() => setStrategy(s.id)}
                style={{
                  padding: 'var(--space-3)',
                  borderColor: active ? 'var(--accent)' : undefined,
                  background: active ? 'var(--accent-soft)' : undefined,
                }}
              >
                <div className="row" style={{ gap: 'var(--space-2)' }}>
                  <span style={{ fontSize: 17 }}>{STRATEGY_ICON[s.id] ?? '🎯'}</span>
                  <span className="strong" style={{ fontSize: 13 }}>
                    {s.label}
                  </span>
                </div>
                <div className="mute-sm" style={{ fontSize: 11, marginTop: 5 }}>
                  {s.description}
                </div>
              </div>
            );
          })}
        </div>

        <div className="divider" />

        {strategy === 'time_boxed' ? (
          <div className="row" style={{ gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 320px' }}>
              <div className="row-between">
                <span className="label">Anggaran waktu (menit)</span>
                <span className="strong mono">{budgetMinutes} menit</span>
              </div>
              <input
                type="range"
                min={10}
                max={600}
                step={10}
                value={budgetMinutes}
                onChange={(e) => setBudgetMinutes(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent)' }}
              />
              <div className="row-between mute-sm" style={{ fontSize: 11 }}>
                <span>10 menit</span>
                <span>600 menit</span>
              </div>
            </div>
            <div className="alert alert-info" style={{ flex: '1 1 300px' }}>
              <span>ℹ️</span>
              <span>
                Kasus diambil dari risiko tertinggi lebih dahulu sampai anggaran habis. Kasus risiko tinggi yang
                tidak muat akan ditandai <strong>RISIKO TINGGI TERBUANG</strong> agar tidak lolos diam-diam.
              </span>
            </div>
          </div>
        ) : null}

        {strategy === 'impact_only' ? (
          <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 380px' }}>
              <Field
                label="Artefak yang berubah (impact_of)"
                hint="Ditulusuri melalui traceability matrix: requirement → use case → skenario → test case."
              >
                <select className="select" value={impactOf} onChange={(e) => setImpactOf(e.target.value)}>
                  <option value="">— pilih artefak perubahan —</option>
                  {impactOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {!impactOf ? (
              <div className="alert alert-warn" style={{ flex: '1 1 300px' }}>
                <span>⚠️</span>
                <span>
                  Tanpa <code>impact_of</code>, tidak ada perubahan yang bisa dilacak sehingga suite akan kosong —
                  ini disengaja, bukan fallback diam-diam.
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {strategy === 'risk_based' || strategy === 'full' ? (
          <div className="alert alert-info">
            <span>🎯</span>
            <span>
              Ambang risiko tinggi adalah <strong>{plan?.detail.threshold ?? 65}</strong>. Setiap kasus dengan skor ≥
              ambang, anggota suite regresi, kegagalan terakhir, atau defect terbuka selalu masuk suite.
            </span>
          </div>
        ) : null}
      </Card>

      {/* ------------------------------ estimates ----------------------------- */}
      {plan ? (
        <>
          <div className="grid grid-5" style={{ marginBottom: 'var(--space-4)' }}>
            <div className="stat stat-accent">
              <span className="stat-label">Kasus Terpilih</span>
              <span className="stat-value">{plan.estimates.selected_cases}</span>
              <span className="stat-delta">dari {plan.estimates.total_cases} kandidat</span>
            </div>
            <div className="stat">
              <span className="stat-label">Estimasi Durasi</span>
              <span className="stat-value">{Math.round(plan.estimates.estimated_minutes)}m</span>
              <span className="stat-delta">{fmtDuration(plan.estimates.estimated_minutes * 60_000)}</span>
            </div>
            <div className="stat stat-ok">
              <span className="stat-label">Porsi Terotomasi</span>
              <span className="stat-value">{pctLabel(plan.estimates.automated_share_pct)}</span>
              <span className="stat-delta">{plan.detail.automated_count} kasus otomatis</span>
            </div>
            <div className={`stat ${coverPct >= 100 ? 'stat-ok' : coverPct >= 80 ? 'stat-warn' : 'stat-err'}`}>
              <span className="stat-label">Cakupan Risiko Tinggi</span>
              <span className="stat-value">{pctLabel(coverPct)}</span>
              <span className="stat-delta">
                {plan.detail.high_risk_covered}/{plan.detail.high_risk_total} kasus
              </span>
            </div>
            <div className={`stat ${highRiskGap ? 'stat-err' : 'stat-ok'}`}>
              <span className="stat-label">Risiko Tinggi Terbuang</span>
              <span className="stat-value">{highRiskGap}</span>
              <span className="stat-delta">{highRiskGap ? 'perlu tinjauan' : 'aman'}</span>
            </div>
          </div>

          {/* ------------------------------ rationale --------------------------- */}
          <Card
            title="📝 Rasional Pemilihan"
            subtitle={`Strategi ${plan.detail.strategy_label} · dibuat ${fmtDateTime(plan.generated_at)}`}
            style={{ marginBottom: 'var(--space-4)' }}
          >
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7 }}>{plan.rationale}</p>

            {plan.detail.phases.length ? (
              <>
                <div className="divider" />
                <span className="label">Fase eksekusi</span>
                <div className="stack stack-sm" style={{ marginTop: 6 }}>
                  {plan.detail.phases.map((p) => (
                    <div key={p.name} className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                      <Badge tone="accent">{p.name}</Badge>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12.5 }}>
                          {p.test_case_ids.length} test case — {p.reason}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {plan.detail.excluded_high_risk.length ? (
              <>
                <div className="divider" />
                <div className="alert alert-err">
                  <span>🚨</span>
                  <div>
                    <div className="strong">
                      {plan.detail.excluded_high_risk.length} test case risiko tinggi TIDAK masuk suite
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12.5 }}>
                      {plan.detail.excluded_high_risk.map((h) => `${h.code} (${h.risk_score})`).join(', ')}
                    </div>
                    <div className="mute-sm" style={{ marginTop: 4 }}>
                      Naikkan anggaran atau ubah strategi sebelum menyatakan rilis siap.
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            <div className="divider" />
            <details>
              <summary className="link-btn" style={{ fontSize: 12.5 }}>
                Bagaimana skor risiko dihitung?
              </summary>
              <div className="kv" style={{ marginTop: 'var(--space-3)' }}>
                {Object.entries(plan.detail.factors_legend).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <span className="kv-key mono">{k}</span>
                    <span className="mute-sm">{v}</span>
                  </React.Fragment>
                ))}
              </div>
            </details>
          </Card>

          {/* -------------------------------- tabs ------------------------------ */}
          <Tabs
            tabs={[
              { id: 'selected', label: `✅ Terpilih (${selected.length})` },
              { id: 'excluded', label: `⛔ Dikecualikan (${excluded.length})` },
              { id: 'suite', label: `👑 Suite Regresi (${suite?.summary.size ?? 0})` },
              { id: 'flaky', label: `🎲 Flaky (${flaky.length})` },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === 'selected' ? (
            <Card
              title="Test Case Terpilih — diurutkan berdasarkan risiko"
              subtitle="Matikan toggle untuk mengeluarkan kasus dari eksekusi kali ini (tanpa mengubah membership suite)."
              actions={
                <>
                  <span className="mute-sm">
                    {effectiveSelected.length} kasus · {Math.round(effectiveMinutes)} menit
                  </span>
                  <button className="btn btn-sm" onClick={() => setOverrides(new Set())}>
                    Reset pilihan
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => void addToSuite(effectiveSelected.map((s) => s.test_case_id))}
                    disabled={!effectiveSelected.length}
                  >
                    + Masukkan ke Suite Regresi
                  </button>
                </>
              }
            >
              {!selected.length ? (
                <Empty
                  icon="👑"
                  title="Tidak ada test case terpilih"
                  subtitle={
                    strategy === 'impact_only' && !impactOf
                      ? 'Pilih artefak perubahan terlebih dahulu agar dampak bisa dilacak.'
                      : 'Ubah strategi atau tambahkan anggota suite regresi.'
                  }
                />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 46 }}>Sertakan</th>
                        <th>Kode</th>
                        <th>Judul</th>
                        <th>Skor Risiko</th>
                        <th>Level</th>
                        <th>Engine</th>
                        <th>Otomasi</th>
                        <th>Alasan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.map((s) => {
                        const included = !overrides.size || overrides.has(s.test_case_id);
                        return (
                          <tr key={s.test_case_id} style={{ opacity: included ? 1 : 0.5 }}>
                            <td>
                              <input
                                className="checkbox"
                                type="checkbox"
                                checked={included}
                                onChange={() => {
                                  const next = new Set(overrides.size ? overrides : selected.map((x) => x.test_case_id));
                                  if (next.has(s.test_case_id)) next.delete(s.test_case_id);
                                  else next.add(s.test_case_id);
                                  setOverrides(next);
                                }}
                              />
                            </td>
                            <td className="cell-mono">{s.code}</td>
                            <td>{s.title}</td>
                            <td>
                              <div className="row" style={{ gap: 'var(--space-2)' }}>
                                <span className="mono strong" style={{ minWidth: 24 }}>
                                  {s.risk_score}
                                </span>
                                <div style={{ width: 60 }}>
                                  <Progress
                                    value={s.risk_score}
                                    tone={s.risk_score >= 65 ? 'err' : s.risk_score >= 35 ? 'warn' : 'ok'}
                                  />
                                </div>
                              </div>
                            </td>
                            <td>
                              <Badge tone={RISK_TONE[s.risk_level]}>{RISK_LABEL[s.risk_level]}</Badge>
                            </td>
                            <td className="mute-sm">{ENGINE_LABEL[s.engine]}</td>
                            <td className="mute-sm">{s.automation_status}</td>
                            <td className="mute-sm" style={{ maxWidth: 330 }}>
                              <div className="clamp-2" title={s.reason}>
                                {s.reason}
                              </div>
                              <button className="link-btn" style={{ fontSize: 11.5, marginTop: 3 }} onClick={() => setReasonModal({ kind: 'selected', row: s })}>
                                Kenapa kasus ini masuk?
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ) : null}

          {tab === 'excluded' ? (
            <Card
              title="Test Case Dikecualikan — setiap pengecualian punya alasan"
              subtitle="Pengecualian yang tidak dijelaskan adalah risiko tersembunyi. Tidak ada di sini."
              actions={
                <>
                  <input
                    className="input input-sm search"
                    placeholder="Cari kode, judul, atau alasan…"
                    value={exclusionFilter}
                    onChange={(e) => setExclusionFilter(e.target.value)}
                  />
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      void addToSuite(filteredExcluded.map((e) => e.test_case_id))
                    }
                    disabled={!filteredExcluded.length}
                  >
                    + Masukkan semua yang tampil
                  </button>
                </>
              }
            >
              {!filteredExcluded.length ? (
                <Empty
                  icon="✅"
                  title={excluded.length ? 'Tidak ada yang cocok dengan filter' : 'Tidak ada kasus dikecualikan'}
                  subtitle={
                    excluded.length
                      ? 'Ubah kata kunci pencarian.'
                      : 'Seluruh kandidat masuk suite — misi regresi tercapai.'
                  }
                />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Kode</th>
                        <th>Judul</th>
                        <th>Alasan Dikecualikan</th>
                        <th className="cell-actions">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredExcluded.map((e) => (
                        <tr key={e.test_case_id}>
                          <td className="cell-mono">{e.code}</td>
                          <td>{e.title}</td>
                          <td className="mute-sm" style={{ maxWidth: 520 }}>
                            <div className="clamp-2" title={e.reason}>
                              {e.reason}
                            </div>
                          </td>
                          <td className="cell-actions">
                            <button className="btn btn-sm" onClick={() => void addToSuite([e.test_case_id])}>
                              + Suite
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ) : null}

          {tab === 'suite' ? (
            <Card
              title="👑 Anggota Suite Regresi"
              subtitle="Test case dengan is_regression = 1. Ini adalah suite tetap yang selalu dipertimbangkan."
              actions={
                <>
                  <button
                    className="btn btn-sm"
                    onClick={() => void setSuiteMembership(selected.map((s) => s.test_case_id))}
                    disabled={!selected.length}
                  >
                    Ganti dengan hasil plan ({selected.length})
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => void setSuiteMembership([])}
                    disabled={!suite?.summary.size}
                  >
                    Kosongkan suite
                  </button>
                </>
              }
            >
              {!suite?.summary.size ? (
                <Empty
                  icon="👑"
                  title="Suite regresi masih kosong"
                  subtitle="Gerbang rilis belum bisa dijalankan tanpa suite regresi. Masukkan kasus risiko tinggi terlebih dahulu."
                />
              ) : (
                <>
                  <div className="grid grid-4" style={{ marginBottom: 'var(--space-3)' }}>
                    <div className="stat">
                      <span className="stat-label">Ukuran Suite</span>
                      <span className="stat-value">{suite.summary.size}</span>
                    </div>
                    <div className="stat">
                      <span className="stat-label">Estimasi</span>
                      <span className="stat-value">{suite.summary.estimated_minutes}m</span>
                    </div>
                    <div className="stat stat-ok">
                      <span className="stat-label">Terotomasi</span>
                      <span className="stat-value">{suite.summary.automated}</span>
                    </div>
                    <div className="stat stat-accent">
                      <span className="stat-label">Risiko Kritis</span>
                      <span className="stat-value">{suite.summary.by_priority.critical ?? 0}</span>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Kode</th>
                          <th>Judul</th>
                          <th>Prioritas</th>
                          <th>Tipe</th>
                          <th>Engine</th>
                          <th>Otomasi</th>
                          <th>Estimasi</th>
                          <th className="cell-actions">Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {suite.data.map((r) => (
                          <tr key={r.id}>
                            <td className="cell-mono">{r.code}</td>
                            <td>{r.title}</td>
                            <td>
                              <Badge tone={PRIORITY_TONE[r.priority as 'low'] ?? 'muted'}>
                                {PRIORITY_LABEL[r.priority as 'low'] ?? r.priority}
                              </Badge>
                            </td>
                            <td className="mute-sm">{r.type}</td>
                            <td className="mute-sm">{ENGINE_LABEL[r.engine as ExecEngine] ?? r.engine}</td>
                            <td className="mute-sm">{r.automation_status}</td>
                            <td className="mute-sm">{r.estimated_minutes}m</td>
                            <td className="cell-actions">
                              <button className="btn btn-ghost btn-sm" onClick={() => void removeFromSuite([r.id])}>
                                Keluarkan
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Card>
          ) : null}

          {tab === 'flaky' ? (
            <Card
              title="🎲 Test Case Flaky"
              subtitle="Kasus yang statusnya bolak-balik lulus/gagal. Mereka merusak kepercayaan pada hasil regresi."
            >
              {!flaky.length ? (
                <Empty icon="🎲" title="Tidak ada kasus flaky" subtitle="Riwayat eksekusi masih stabil dalam 90 hari terakhir." />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Kode</th>
                        <th>Judul</th>
                        <th>Pergantian Status</th>
                        <th>Pass Rate</th>
                        <th>Eksekusi</th>
                        <th>Status Terakhir</th>
                        <th className="cell-actions">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flaky.map((f) => (
                        <tr key={f.test_case_id}>
                          <td className="cell-mono">{f.code}</td>
                          <td>{f.title}</td>
                          <td>
                            <Badge tone={f.flips >= 4 ? 'err' : 'warn'}>{f.flips}×</Badge>
                          </td>
                          <td>
                            <div className="row" style={{ gap: 'var(--space-2)' }}>
                              <span className="mono">{pctLabel(f.pass_rate)}</span>
                              <div style={{ width: 56 }}>
                                <Progress value={f.pass_rate} tone={f.pass_rate >= 80 ? 'ok' : 'warn'} />
                              </div>
                            </div>
                          </td>
                          <td className="mute-sm">{f.executions}</td>
                          <td className="mute-sm">{f.last_status ?? '—'}</td>
                          <td className="cell-actions">
                            <button className="btn btn-sm" onClick={() => void addToSuite([f.test_case_id])}>
                              + Suite
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ) : null}
        </>
      ) : null}

      {/* ---------------------------- gate verdict ---------------------------- */}
      {gate ? (
        <Card title="🚦 Hasil Gerbang Rilis" style={{ marginTop: 'var(--space-4)' }}>
          <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'center' }}>
            <div
              className="stat-value"
              style={{
                fontSize: 30,
                color: gate.verdict === 'go' ? 'var(--ok)' : gate.verdict === 'conditional' ? 'var(--warn)' : 'var(--err)',
              }}
            >
              {gate.verdict === 'go' ? 'GO' : gate.verdict === 'conditional' ? 'KONDISIONAL' : 'NO-GO'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5 }}>{gate.message}</div>
              <div className="mute-sm" style={{ marginTop: 4 }}>
                {gate.passed} lulus · {gate.failed} gagal · {gate.blocked} terblokir dari {gate.total} eksekusi
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {/* -------------------------------- modals ------------------------------ */}
      {reasonModal ? (
        <Modal
          title={`Kenapa ${reasonModal.row.code} ${reasonModal.kind === 'selected' ? 'masuk' : 'dikeluarkan'}?`}
          onClose={() => setReasonModal(null)}
        >
          <div className="stack">
            <div className="mute-sm">{reasonModal.row.title}</div>
            <div className="pre">{reasonModal.row.reason}</div>
            <a className="btn btn-sm" href={`#explain-${reasonModal.row.test_case_id}`} onClick={() => setReasonModal(null)}>
              Tutup
            </a>
          </div>
        </Modal>
      ) : null}

      {runModal ? (
        <Modal
          title={`Jalankan Regresi — ${effectiveSelected.length} test case`}
          onClose={() => setRunModal(false)}
          footer={
            <>
              <span className="mute-sm">Estimasi {Math.round(effectiveMinutes)} menit</span>
              <span className="spacer" />
              <button className="btn" onClick={() => setRunModal(false)} disabled={busy}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={() => void runRegression()} disabled={busy}>
                {busy ? 'Menjalankan…' : '▶️ Jalankan Regresi'}
              </button>
            </>
          }
        >
          <div className="alert alert-warn" style={{ marginBottom: 'var(--space-3)' }}>
            <span>⚠️</span>
            <span>
              Regresi adalah gerbang rilis terakhir. Anggaran yang tidak cukup untuk kasus risiko tinggi harus
              dilaporkan, bukan disembunyikan.
            </span>
          </div>

          <div className="grid grid-2">
            <Field label="Engine">
              <select
                className="select"
                value={runForm.engine}
                onChange={(e) => setRunForm({ ...runForm, engine: e.target.value as ExecEngine })}
              >
                {(['api', 'web', 'db', 'ai', 'manual'] as ExecEngine[]).map((k) => (
                  <option key={k} value={k}>
                    {ENGINE_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Eksekutor">
              <input
                className="input"
                value={runForm.executed_by}
                onChange={(e) => setRunForm({ ...runForm, executed_by: e.target.value })}
                placeholder="nama tester"
              />
            </Field>
          </div>

          <label className="row" style={{ gap: 'var(--space-2)', cursor: 'pointer', marginTop: 'var(--space-3)' }}>
            <input
              className="checkbox"
              type="checkbox"
              checked={runForm.dry_run}
              onChange={(e) => setRunForm({ ...runForm, dry_run: e.target.checked })}
            />
            <span>Dry run</span>
          </label>

          <div className="divider" />
          <span className="label">Kasus yang akan dijalankan ({effectiveSelected.length})</span>
          <div className="stack stack-sm" style={{ maxHeight: 220, overflowY: 'auto', marginTop: 6 }}>
            {effectiveSelected.map((s) => (
              <div key={s.test_case_id} className="row" style={{ gap: 'var(--space-2)' }}>
                <span className="cell-mono">{s.code}</span>
                <span className="truncate" style={{ fontSize: 12.5, flex: 1 }}>
                  {s.title}
                </span>
                <Badge tone={RISK_TONE[s.risk_level]}>{s.risk_score}</Badge>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
