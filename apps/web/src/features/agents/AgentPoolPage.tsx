/**
 * AI Agent Pool — spawn N parallel QA agents for automated regression.
 *
 * Route: /agents  (registered by the Lead in App.tsx)
 *
 * Flow: configure the pool → **Plan (dry run)** to see the shard allocation and
 * per-worker estimated load → **Spawn Agents & Run** to execute, then inspect
 * per-shard cards, the summary bar (including FLAKY as its own bucket), the
 * measured speedup with its arithmetic, the outcomes table with drill-down, the
 * AI narrative, and a selector-healing playground.
 *
 * Styling: only `components.css` classes plus the `ap-` prefixed rules in
 * `./agents.css`. No global CSS is added.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AgentPoolConfig,
  AgentPoolResult,
  HealResult,
  PoolCaseOutcome,
  PoolRunMeta,
  PoolShard,
  WorkerStrategy,
} from '@qatools/shared';
import { WORKER_STRATEGIES, WORKER_STRATEGY_LABEL, RUN_STATUS_LABEL, RUN_STATUS_TONE, ENGINE_LABEL, SEVERITY_LABEL, SEVERITY_TONE } from '@qatools/shared';
import { api } from '../../lib/api';
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
  Modal,
  PageHeader,
  Progress,
  Stat,
  fmtDuration,
  fmtDateTime,
} from '../../components';
import './agents.css';

/* ------------------------------------------------------------------ *
 * Local types
 * ------------------------------------------------------------------ */

interface CaseRow {
  id: string;
  code: string;
  title: string;
  engine: string;
  layer: string;
  priority: string;
  severity: string;
  automation_status: string;
  is_regression: number;
  risk_score: number;
  status: string;
}

interface StrategyMeta {
  id: WorkerStrategy;
  label: string;
  description: string;
}

interface Capabilities {
  strategies: StrategyMeta[];
  defaults: AgentPoolConfig;
  max_workers: number;
  per_case_overhead_ms: number;
  ai: { configured: boolean; provider: string; model: string; mode: string; message: string };
  offline_capable: boolean;
  executor: { source: string; mode: string; reason: string };
  probe: { project_id: string | null; test_cases: number };
  notes: string[];
}

interface PlanResponse {
  shards: PoolShard[];
  estimates: {
    makespan_ms: number;
    sequential_ms: number;
    theoretical_speedup: number;
    average_shard_ms: number;
    balance_ratio: number;
  };
  strategy: WorkerStrategy;
  workers: number;
  total_cases: number;
  ai_used: boolean;
  notes: string[];
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function AgentPoolPage() {
  const { projectId } = useProject();

  /* ------------------------------- config ------------------------------ */
  const [workers, setWorkers] = useState(4);
  const [strategy, setStrategy] = useState<WorkerStrategy>('risk_weighted');
  const [maxRetries, setMaxRetries] = useState(1);
  const [timeoutMs, setTimeoutMs] = useState(120_000);
  const [abortAfter, setAbortAfter] = useState(0);
  const [aiHealing, setAiHealing] = useState(true);
  const [aiTriage, setAiTriage] = useState(true);
  const [spawnAiAgents, setSpawnAiAgents] = useState(true);
  const [retryFailedOnly, setRetryFailedOnly] = useState(true);

  /* -------------------------------- data ------------------------------- */
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<PoolRunMeta[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  /* ------------------------------- results ----------------------------- */
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [result, setResult] = useState<AgentPoolResult | null>(null);
  const [planning, setPlanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [detail, setDetail] = useState<PoolCaseOutcome | null>(null);

  /* --------------------------- healing playground ---------------------- */
  const [healHtml, setHealHtml] = useState(
    '<form id="login-form">\n  <input type="text" name="username" aria-label="Nama pengguna" />\n  <button type="submit" data-testid="btn-login">Masuk</button>\n</form>',
  );
  const [healSelector, setHealSelector] = useState('#login-btn');
  const [healResult, setHealResult] = useState<HealResult | null>(null);
  const [healing, setHealing] = useState(false);

  /* ------------------------------ loaders ------------------------------ */

  const loadCapabilities = useCallback(async () => {
    try {
      const res = await api.get<{ data: Capabilities }>('/agents/capabilities', {
        project_id: projectId ?? undefined,
      });
      setCapabilities(res.data);
      if (res.data?.defaults) {
        setWorkers((w) => (w === 4 ? res.data.defaults.workers : w));
      }
    } catch {
      setCapabilities(null);
    }
  }, [projectId]);

  const loadCases = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: CaseRow[] }>('/execute/cases', { project_id: projectId });
      setCases(res.data ?? []);
    } catch (err) {
      setError(err);
      setCases([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadHistory = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await api.get<{ data: PoolRunMeta[] }>(`/projects/${projectId}/agents/runs`, { limit: 25 });
      setHistory(res.data ?? []);
    } catch {
      setHistory([]);
    }
  }, [projectId]);

  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);
  useEffect(() => {
    void loadCases();
  }, [loadCases]);
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  /* ------------------------------ helpers ------------------------------ */

  const body = useCallback(
    () => ({
      test_case_ids: Array.from(selected),
      workers,
      strategy,
      max_retries: maxRetries,
      case_timeout_ms: timeoutMs,
      abort_after_failures: abortAfter,
      ai_healing: aiHealing,
      ai_triage: aiTriage,
      spawn_ai_agents: spawnAiAgents,
      retry_failed_only: retryFailedOnly,
    }),
    [selected, workers, strategy, maxRetries, timeoutMs, abortAfter, aiHealing, aiTriage, spawnAiAgents, retryFailedOnly],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const all = cases.length > 0 && cases.every((c) => prev.has(c.id));
      return all ? new Set<string>() : new Set(cases.map((c) => c.id));
    });

  const runPlan = async () => {
    if (!projectId) return;
    setPlanning(true);
    setPlan(null);
    try {
      const ids = selected.size ? Array.from(selected) : cases.map((c) => c.id);
      if (!ids.length) {
        toast.warn('Belum ada test case untuk direncanakan.');
        return;
      }
      const res = await api.post<{ data: PlanResponse }>(`/projects/${projectId}/agents/plan`, {
        ...body(),
        test_case_ids: ids,
      });
      setPlan(res.data);
      toast.ok(`Rencana siap: ${res.data.total_cases} test case dibagi ke ${res.data.shards.length} worker.`);
    } catch (err) {
      toast.fromError(err, 'Gagal menyusun rencana');
    } finally {
      setPlanning(false);
    }
  };

  const runPool = async () => {
    if (!projectId) return;
    const ids = selected.size ? Array.from(selected) : cases.map((c) => c.id);
    if (!ids.length) {
      toast.warn('Pilih minimal satu test case, atau pastikan project memiliki test case.');
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const res = await api.post<{ data: AgentPoolResult }>(`/projects/${projectId}/agents/run`, {
        ...body(),
        test_case_ids: ids,
      });
      setResult(res.data);
      await loadHistory();
      const s = res.data.summary;
      toast[s.failed > 0 ? 'warn' : 'ok'](
        `Agent pool selesai: ${s.passed} lulus, ${s.failed} gagal, ${s.flaky} flaky · speedup ${s.speedup}x.`,
      );
    } catch (err) {
      toast.fromError(err, 'Gagal menjalankan agent pool');
    } finally {
      setRunning(false);
    }
  };

  const openHistory = async (id: string) => {
    try {
      const res = await api.get<{ data: AgentPoolResult }>(`/agents/runs/${id}`);
      setResult(res.data);
      setPlan(null);
      toast.info('Riwayat run dimuat ke tampilan hasil.');
    } catch (err) {
      toast.fromError(err, 'Gagal memuat riwayat');
    }
  };

  const runHeal = async () => {
    if (!healSelector.trim()) {
      toast.warn('Isi selector yang gagal terlebih dahulu.');
      return;
    }
    setHealing(true);
    setHealResult(null);
    try {
      const res = await api.post<{ data: HealResult }>('/agents/heal', {
        selector: healSelector,
        action: 'click',
        html: healHtml,
        intent: 'Memulihkan selector yang gagal pada playground.',
      });
      setHealResult(res.data);
      toast[res.data.healed ? 'ok' : 'warn'](
        res.data.healed ? `Selector pengganti ditemukan: ${res.data.selector}` : 'Tidak ada selector pengganti yang cocok.',
      );
    } catch (err) {
      toast.fromError(err, 'Penyembuhan selector gagal');
    } finally {
      setHealing(false);
    }
  };

  /* ------------------------------ derived ------------------------------ */

  const activeStrategy = useMemo(
    () => capabilities?.strategies.find((s) => s.id === strategy),
    [capabilities, strategy],
  );

  const selectionCount = selected.size || cases.length;

  /* ------------------------------- render ------------------------------ */

  return (
    <>
      <PageHeader
        title="AI Agent Pool"
        subtitle="Jalankan regresi otomatis dengan N worker paralel. Setiap worker adalah agen QA: ada percobaan ulang, deteksi flaky, penyembuhan selector, dan triase kegagalan."
        badge={
          capabilities ? (
            <Badge tone={capabilities.ai.configured ? 'ok' : 'muted'}>
              {capabilities.ai.configured ? `AI aktif (${capabilities.ai.provider})` : 'AI offline deterministik'}
            </Badge>
          ) : null
        }
        actions={
          <>
            <button className="btn" onClick={() => void runPlan()} disabled={planning || running || loading}>
              {planning ? 'Menyusun…' : '🧭 Plan (dry run)'}
            </button>
            <button className="btn btn-primary" onClick={() => void runPool()} disabled={running || planning || loading}>
              {running ? 'Agen berjalan…' : `🚀 Spawn ${workers} Agen & Jalankan`}
            </button>
          </>
        }
      />

      {/* ---------------------------- capabilities --------------------------- */}
      {capabilities ? (
        <Card
          title="Kesiapan Pool"
          subtitle="Status jujur: apa yang benar-benar berjalan di mesin ini, termasuk saat tidak ada API key."
          className="ap-mb"
        >
          <div className="grid grid-4 ap-mb">
            <Stat
              label="Workers maksimum"
              value={capabilities.max_workers}
              hint={`saat ini ${workers}`}
              tone="accent"
            />
            <Stat
              label="Executor"
              value={capabilities.executor.source === 'lane-c' ? 'lane C siap' : 'belum siap'}
              hint={capabilities.executor.mode}
              tone={capabilities.executor.source === 'lane-c' ? 'ok' : 'warn'}
            />
            <Stat
              label="Mode AI"
              value={capabilities.ai.mode}
              hint={`${capabilities.ai.provider} · ${capabilities.ai.model}`}
              tone={capabilities.ai.configured ? 'ok' : 'info'}
            />
            <Stat label="Test case project" value={cases.length} hint="kandidat regresi" />
          </div>

          <div className={`ap-note ${capabilities.executor.source === 'lane-c' ? '' : 'ap-note-warn'}`}>
            <strong>Executor:</strong> {capabilities.executor.reason}
          </div>
          <div className={`ap-note ${capabilities.ai.configured ? '' : 'ap-note-info'}`}>
            <strong>AI:</strong> {capabilities.ai.message}
          </div>
          {capabilities.executor.source !== 'lane-c' ? (
            <div className="alert alert-warn ap-mb">
              Modul eksekusi lane C belum bisa dimuat, jadi tombol jalankan akan menghasilkan status <em>blocked</em>{' '}
              untuk setiap kasus. Perencanaan shard dan penyembuhan selector tetap berfungsi.
            </div>
          ) : null}
        </Card>
      ) : (
        <div className="alert alert-warn ap-mb">
          Panel kesiapan pool tidak dapat dimuat. Periksa apakah API berjalan.
        </div>
      )}

      {/* ------------------------------ controls ---------------------------- */}
      <Card title="Konfigurasi Pool" className="ap-mb">
        <div className="ap-config">
          {/* workers */}
          <div className="ap-slider">
            <div className="row-between">
              <span className="label">Jumlah worker (agen paralel)</span>
              <span className="chip ap-workers-chip">{workers} worker</span>
            </div>
            <input
              type="range"
              min={1}
              max={capabilities?.max_workers ?? 16}
              step={1}
              value={workers}
              className="ap-range"
              onChange={(e) => setWorkers(Number(e.target.value))}
            />
            <div className="row-between mute-sm">
              <span>1 = berurutan</span>
              <span>{capabilities?.max_workers ?? 16} = maksimum</span>
            </div>
            <p className="ap-hint">
              Setiap worker menjalankan satu shard secara berurutan di dalamnya, tetapi antar-worker berjalan
              sungguh-sungguh bersamaan. Ukuran aman: jumlah worker ≈ jumlah core, dan jangan melebihi jumlah test case.
            </p>
          </div>

          {/* strategy */}
          <div className="ap-strategy">
            <span className="label">Strategi pembagian shard</span>
            <div className="ap-strategy-list">
              {WORKER_STRATEGIES.map((id) => {
                const meta = capabilities?.strategies.find((s) => s.id === id);
                return (
                  <button
                    key={id}
                    className={`ap-strategy-item ${strategy === id ? 'active' : ''}`}
                    onClick={() => setStrategy(id)}
                    type="button"
                  >
                    <span className="ap-strategy-label">
                      {meta?.label ?? WORKER_STRATEGY_LABEL[id]}
                      {strategy === id ? <span className="ap-check"> ✓</span> : null}
                    </span>
                    <span className="ap-strategy-desc">{meta?.description ?? ''}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="ap-grid-inputs">
          <Field label="Max retry per kasus" hint="0 = sekali coba. Retry inilah yang mendeteksi flaky.">
            <input
              className="input input-sm"
              type="number"
              min={0}
              max={10}
              value={maxRetries}
              onChange={(e) => setMaxRetries(Math.max(0, Number(e.target.value) || 0))}
            />
          </Field>
          <Field label="Timeout per kasus (ms)">
            <input
              className="input input-sm"
              type="number"
              min={1000}
              step={1000}
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Math.max(1000, Number(e.target.value) || 1000))}
            />
          </Field>
          <Field label="Abort setelah N kegagalan" hint="0 = jalan terus sampai selesai.">
            <input
              className="input input-sm"
              type="number"
              min={0}
              value={abortAfter}
              onChange={(e) => setAbortAfter(Math.max(0, Number(e.target.value) || 0))}
            />
          </Field>
        </div>

        <div className="ap-toggles">
          {(
            [
              ['ai_healing', aiHealing, setAiHealing, 'AI healing', 'Cari selector pengganti saat langkah web gagal.'],
              ['ai_triage', aiTriage, setAiTriage, 'AI triage', 'Nilai severity, akar masalah, dan pemilik untuk tiap kegagalan.'],
              ['spawn_ai_agents', spawnAiAgents, setSpawnAiAgents, 'Spawn AI agents', 'Beri setiap worker nama dan peran agen.'],
              ['retry_failed_only', retryFailedOnly, setRetryFailedOnly, 'Retry hanya yang gagal', 'Kasus yang lulus tidak diulang.'],
            ] as Array<[string, boolean, (v: boolean) => void, string, string]>
          ).map(([key, value, setter, label, hint]) => (
            <label className="ap-toggle" key={key}>
              <input
                type="checkbox"
                className="checkbox"
                checked={value}
                onChange={(e) => setter(e.target.checked)}
              />
              <span>
                <span className="ap-toggle-label">{label}</span>
                <span className="ap-toggle-hint">{hint}</span>
              </span>
            </label>
          ))}
        </div>

        {activeStrategy ? (
          <div className="ap-active-strategy">
            <strong>{activeStrategy.label}:</strong> {activeStrategy.description}
          </div>
        ) : null}
      </Card>

      {/* ----------------------------- test cases --------------------------- */}
      <Card
        title={`Test Case (${cases.length})`}
        className="ap-mb"
        actions={
          <div className="row">
            <span className="chip">{selectionCount} akan dijalankan</span>
            <button className="btn btn-sm" onClick={toggleAll} disabled={!cases.length}>
              {cases.length && cases.every((c) => selected.has(c.id)) ? 'Kosongkan' : 'Pilih semua'}
            </button>
          </div>
        }
      >
        {loading ? (
          <Loading label="Memuat test case…" />
        ) : error ? (
          <ErrorBox error={error} onRetry={() => void loadCases()} />
        ) : !cases.length ? (
          <Empty
            icon="🧪"
            title="Belum ada test case"
            subtitle="Buat test case terlebih dahulu, lalu kembali ke sini untuk menjalankan regresi paralel."
          />
        ) : (
          <>
            <p className="ap-hint ap-mb">
              Tidak memilih apa pun berarti <strong>semua</strong> test case pada project ini akan dijalankan.
            </p>
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
                  width: '120px',
                  render: (r) => <Badge tone="accent">{ENGINE_LABEL[r.engine as keyof typeof ENGINE_LABEL] ?? r.engine}</Badge>,
                },
                {
                  key: 'risk',
                  header: 'Risiko',
                  width: '85px',
                  render: (r) => (
                    <Badge tone={r.risk_score >= 65 ? 'err' : r.risk_score >= 35 ? 'warn' : 'muted'}>
                      {Math.round(r.risk_score)}
                    </Badge>
                  ),
                },
              ]}
            />
          </>
        )}
      </Card>

      {/* -------------------------------- plan ------------------------------ */}
      {plan ? (
        <Card
          title="Rencana Shard (dry run)"
          subtitle={`${plan.total_cases} test case dibagi ke ${plan.shards.length} worker · strategi ${WORKER_STRATEGY_LABEL[plan.strategy]}`}
          className="ap-mb"
          actions={<Badge tone={plan.ai_used ? 'ok' : 'muted'}>{plan.ai_used ? 'AI dipakai' : 'offline deterministik'}</Badge>}
        >
          <div className="grid grid-4 ap-mb">
            <Stat label="Estimasi makespan" value={fmtDuration(plan.estimates.makespan_ms)} hint="shard terlama" tone="accent" />
            <Stat label="Estimasi berurutan" value={fmtDuration(plan.estimates.sequential_ms)} hint="satu worker" />
            <Stat
              label="Speedup teoretis"
              value={`${plan.estimates.theoretical_speedup}x`}
              hint="berurutan ÷ makespan"
              tone="info"
            />
            <Stat
              label="Rasio keseimbangan"
              value={plan.estimates.balance_ratio}
              hint="1.0 = seimbang sempurna"
              tone={plan.estimates.balance_ratio <= 1.2 ? 'ok' : 'warn'}
            />
          </div>

          <ShardAllocation shards={plan.shards} maxEstimate={plan.estimates.makespan_ms} />

          {plan.notes.length ? (
            <div className="ap-notes">
              {plan.notes.map((n, i) => (
                <div key={i} className="ap-note">
                  {n}
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* ------------------------------- results ---------------------------- */}
      {result ? (
        <>
          <Card
            title="Ringkasan Eksekusi"
            subtitle={`Run ${result.run_id} · ${fmtDateTime(result.created_at)}`}
            className="ap-mb"
          >
            <div className="grid ap-summary-grid ap-mb">
              <Stat label="Total" value={result.summary.total} />
              <Stat label="Lulus bersih" value={result.summary.passed} tone="ok" />
              <Stat label="Gagal" value={result.summary.failed} tone="err" />
              <Stat label="Terblokir" value={result.summary.blocked} tone="warn" />
              <Stat label="Flaky" value={result.summary.flaky} tone="warn" />
              <Stat label="Healed" value={result.summary.healed} tone="info" />
              <Stat label="Dilewati" value={result.summary.skipped} />
              <Stat label="Retry" value={result.summary.retried} />
            </div>

            {/* the headline number, with its arithmetic shown */}
            <div className="ap-speedup">
              <div className="ap-speedup-main">
                <span className="ap-speedup-value">{result.summary.speedup}x</span>
                <span className="ap-speedup-label">speedup terukur</span>
              </div>
              <div className="ap-speedup-math">
                <div>
                  <span className="ap-math-key">Berurutan (jumlah semua durasi kasus)</span>
                  <span className="ap-math-val">{fmtDuration(result.summary.sequential_duration_ms)}</span>
                </div>
                <div>
                  <span className="ap-math-key">Wall-clock pool ({result.summary.workers_used} worker aktif)</span>
                  <span className="ap-math-val">{fmtDuration(result.summary.duration_ms)}</span>
                </div>
                <div className="ap-math-formula">
                  {Math.round(result.summary.sequential_duration_ms)} ms ÷ {Math.round(result.summary.duration_ms)} ms ={' '}
                  <strong>{result.summary.speedup}x</strong>
                </div>
                <div className="mute-sm">
                  Kecepatan ini diukur dari eksekusi nyata. Nilai mendekati 1 berarti paralelisme belum menolong
                  (kasus terlalu cepat atau sumber daya terbatas).
                </div>
              </div>
            </div>

            <Progress
              value={result.summary.total ? (result.summary.passed / result.summary.total) * 100 : 0}
              tone={
                result.summary.failed > 0 ? 'err' : result.summary.flaky > 0 ? 'warn' : 'ok'
              }
              large
            />
            <div className="mute-sm ap-mt">
              Tingkat kelulusan bersih {result.summary.total ? ((result.summary.passed / result.summary.total) * 100).toFixed(1) : '0.0'}% ·
              kasus flaky tidak dihitung sebagai lulus karena verdict-nya berubah antar percobaan.
            </div>
          </Card>

          {/* per-shard cards */}
          <Card title={`Shard / Agen (${result.shards.length})`} className="ap-mb">
            <div className="ap-shard-grid">
              {result.shards.map((shard) => (
                <ShardCard key={shard.worker_id} shard={shard} />
              ))}
            </div>
          </Card>

          {/* AI narrative */}
          {result.ai_summary ? (
            <Card
              title="Ringkasan Naratif"
              subtitle={result.ai_used ? 'Ditulis oleh model AI aktif.' : 'Disusun deterministik oleh QATools (tanpa provider AI aktif).'}
              className="ap-mb"
              actions={<Badge tone={result.ai_used ? 'ok' : 'muted'}>{result.ai_used ? 'ai_used: true' : 'ai_used: false'}</Badge>}
            >
              <p className="ap-narrative">{result.ai_summary}</p>
            </Card>
          ) : null}

          {/* outcomes table */}
          <Card title={`Hasil per Test Case (${result.outcomes.length})`} className="ap-mb">
            <DataTable<PoolCaseOutcome>
              rows={result.outcomes}
              rowKey={(r) => r.test_case_id}
              onRowClick={(r) => setDetail(r)}
              empty={<Empty title="Tidak ada hasil" subtitle="Pool tidak mengeksekusi kasus apa pun." />}
              columns={[
                { key: 'code', header: 'Kode', width: '110px', render: (r) => <span className="cell-mono">{r.code}</span> },
                { key: 'title', header: 'Judul', render: (r) => <span className="clamp-2">{r.title}</span> },
                {
                  key: 'engine',
                  header: 'Engine',
                  width: '100px',
                  render: (r) => <span className="mute-sm">{ENGINE_LABEL[r.engine] ?? r.engine}</span>,
                },
                {
                  key: 'initial',
                  header: 'Awal → Akhir',
                  width: '190px',
                  render: (r) => (
                    <span className="row" style={{ gap: 6 }}>
                      <Badge tone={RUN_STATUS_TONE[r.initial_status]}>{RUN_STATUS_LABEL[r.initial_status]}</Badge>
                      <span className="mute-sm">→</span>
                      <Badge tone={RUN_STATUS_TONE[r.final_status]}>{RUN_STATUS_LABEL[r.final_status]}</Badge>
                    </span>
                  ),
                },
                {
                  key: 'attempts',
                  header: 'Percobaan',
                  width: '90px',
                  align: 'right',
                  render: (r) => <span className="cell-mono">{r.attempts}</span>,
                },
                {
                  key: 'flaky',
                  header: 'Flaky',
                  width: '80px',
                  render: (r) => (r.flaky ? <Badge tone="warn">flaky</Badge> : <span className="mute-sm">—</span>),
                },
                {
                  key: 'duration',
                  header: 'Durasi',
                  width: '95px',
                  align: 'right',
                  render: (r) => <span className="cell-mono">{fmtDuration(r.duration_ms)}</span>,
                },
                {
                  key: 'worker',
                  header: 'Worker',
                  width: '80px',
                  render: (r) => <span className="cell-mono">{r.worker_id}</span>,
                },
                {
                  key: 'flags',
                  header: 'Tanda',
                  width: '120px',
                  render: (r) => (
                    <span className="row" style={{ gap: 4 }}>
                      {r.healing?.applied ? <Badge tone="info">healed</Badge> : null}
                      {r.triage ? <Badge tone={SEVERITY_TONE[r.triage.severity]}>{SEVERITY_LABEL[r.triage.severity]}</Badge> : null}
                    </span>
                  ),
                },
              ]}
            />
          </Card>
        </>
      ) : null}

      {/* ------------------------------ history ----------------------------- */}
      {history.length ? (
        <Card
          title={`Riwayat Agent Pool (${history.length})`}
          subtitle="Klik satu baris untuk memuat hasil lengkapnya kembali dari basis data."
          className="ap-mb"
        >
          <DataTable<PoolRunMeta>
            rows={history}
            rowKey={(r) => r.id}
            onRowClick={(r) => void openHistory(r.id)}
            columns={[
              { key: 'name', header: 'Nama', render: (r) => <span className="clamp-2">{r.name}</span> },
              { key: 'workers', header: 'Worker', width: '80px', align: 'right', render: (r) => r.workers },
              {
                key: 'strategy',
                header: 'Strategi',
                width: '150px',
                render: (r) => <Badge tone="accent">{WORKER_STRATEGY_LABEL[r.strategy] ?? r.strategy}</Badge>,
              },
              {
                key: 'status',
                header: 'Status',
                width: '110px',
                render: (r) => (
                  <Badge tone={r.status === 'completed' ? 'ok' : r.status === 'aborted' ? 'warn' : 'info'}>{r.status}</Badge>
                ),
              },
              {
                key: 'counts',
                header: 'Lulus/Gagal/Flaky',
                width: '150px',
                render: (r) => (
                  <span className="cell-mono">
                    {r.passed}/{r.failed}/{r.flaky}
                  </span>
                ),
              },
              {
                key: 'speedup',
                header: 'Speedup',
                width: '95px',
                align: 'right',
                render: (r) => <span className="cell-mono">{r.speedup}x</span>,
              },
              {
                key: 'duration',
                header: 'Durasi',
                width: '95px',
                align: 'right',
                render: (r) => <span className="cell-mono">{fmtDuration(r.duration_ms)}</span>,
              },
              { key: 'created', header: 'Dibuat', width: '170px', render: (r) => fmtDateTime(r.created_at) },
            ]}
          />
        </Card>
      ) : null}

      {/* ------------------------ healing playground ------------------------ */}
      <Card
        title="Playground Penyembuhan Selector"
        subtitle="Tempel HTML halaman dan selector yang gagal. QATools memindai DOM sungguhan lalu mengurutkan kandidat menurut ketahanannya."
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => void runHeal()} disabled={healing}>
            {healing ? 'Memindai…' : '🔧 Cari selector pengganti'}
          </button>
        }
      >
        <div className="ap-heal-grid">
          <Field label="Selector yang gagal" hint="Contoh: #login-btn, .btn-submit, [data-testid=…]">
            <input className="input input-sm" value={healSelector} onChange={(e) => setHealSelector(e.target.value)} />
          </Field>
          <Field label="HTML halaman saat kegagalan">
            <textarea
              className="textarea ap-heal-html"
              rows={8}
              value={healHtml}
              onChange={(e) => setHealHtml(e.target.value)}
              placeholder="<html>…</html>"
            />
          </Field>
        </div>

        {healResult ? (
          healResult.healed ? (
            <div className="ap-heal-result">
              <div className="row-between ap-mb">
                <span>
                  Selector pengganti terbaik: <strong className="cell-mono">{healResult.selector}</strong>
                </span>
                <Badge tone={healResult.used_mock ? 'muted' : 'ok'}>
                  {healResult.used_mock ? 'analisis DOM offline' : 'dibantu model AI'}
                </Badge>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 70 }}>Skor</th>
                    <th style={{ width: 260 }}>Selector</th>
                    <th>Alasan</th>
                  </tr>
                </thead>
                <tbody>
                  {healResult.candidates.map((c, i) => (
                    <tr key={i}>
                      <td className="cell-mono">{c.score}</td>
                      <td className="cell-mono ap-heal-sel">{c.selector}</td>
                      <td className="mute-sm">{c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ap-note ap-mt">{healResult.rationale}</div>
            </div>
          ) : (
            <div className="alert alert-warn">
              <span>⚠️</span>
              <div>
                <div className="strong">Tidak ada selector pengganti</div>
                <div>{healResult.rationale}</div>
              </div>
            </div>
          )
        ) : (
          <p className="ap-hint">
            Tekan <strong>Cari selector pengganti</strong> untuk melihat kandidat. Tanpa API key, QATools tetap
            memindai HTML dan mengurutkan kandidat secara deterministik — tidak ada kandidat yang dikarang.
          </p>
        )}
      </Card>

      {/* --------------------------- detail modal --------------------------- */}
      {detail ? <OutcomeDetailModal outcome={detail} onClose={() => setDetail(null)} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Sub-components
 * ------------------------------------------------------------------ */

/** Horizontal bars so the user can SEE how evenly the work was spread. */
function ShardAllocation(props: { shards: PoolShard[]; maxEstimate: number }) {
  const max = Math.max(1, props.maxEstimate);
  return (
    <div className="ap-alloc">
      <div className="ap-alloc-head ap-alloc-row">
        <span>Worker / Agen</span>
        <span>Beban estimasi</span>
        <span className="ap-alloc-num">Kasus</span>
        <span className="ap-alloc-num">Estimasi</span>
      </div>
      {props.shards.map((s) => (
        <div className="ap-alloc-row" key={s.worker_id}>
          <div className="ap-alloc-agent">
            <span className="ap-agent-dot" />
            <span>
              <span className="ap-agent-name">{s.agent_name}</span>
              <span className="ap-agent-role">{s.agent_role}</span>
            </span>
          </div>
          <div className="ap-alloc-bar-wrap">
            <div className="ap-alloc-bar" style={{ width: `${Math.max(2, (s.estimated_ms / max) * 100)}%` }} />
          </div>
          <span className="ap-alloc-num cell-mono">{s.test_case_ids.length}</span>
          <span className="ap-alloc-num cell-mono">{fmtDuration(s.estimated_ms)}</span>
        </div>
      ))}
    </div>
  );
}

function ShardCard(props: { shard: PoolShard }) {
  const s = props.shard;
  const total = s.test_case_ids.length;
  const done = s.passed + s.failed + s.blocked;
  const tone =
    s.status === 'aborted' ? 'warn' : s.status === 'failed' ? 'err' : s.status === 'done' ? 'ok' : 'info';

  return (
    <div className={`ap-shard ap-shard-${s.status}`}>
      <div className="row-between ap-mb">
        <div className="ap-agent">
          <span className={`ap-agent-dot ap-dot-${s.status}`} />
          <div>
            <div className="ap-agent-name">{s.agent_name}</div>
            <div className="ap-agent-role">{s.agent_role}</div>
          </div>
        </div>
        <Badge tone={tone}>{s.status}</Badge>
      </div>

      <div className="ap-shard-counts">
        <span className="ap-count ap-count-ok">{s.passed} lulus</span>
        <span className="ap-count ap-count-err">{s.failed} gagal</span>
        <span className="ap-count ap-count-warn">{s.blocked} blokir</span>
        {s.retried ? <span className="ap-count ap-count-info">{s.retried} retry</span> : null}
        {s.healed ? <span className="ap-count ap-count-info">{s.healed} healed</span> : null}
      </div>

      <Progress value={total ? (done / total) * 100 : 0} tone={s.failed ? 'err' : 'ok'} />
      <div className="row-between mute-sm ap-mt">
        <span>
          {done}/{total} kasus · {s.worker_id}
        </span>
        <span>{fmtDuration(s.estimated_ms)} est.</span>
      </div>

      {s.notes.length ? (
        <ul className="ap-shard-notes">
          {s.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function OutcomeDetailModal(props: { outcome: PoolCaseOutcome; onClose: () => void }) {
  const { outcome } = props;
  return (
    <Modal
      title={
        <span>
          {outcome.code}{' '}
          <Badge tone={RUN_STATUS_TONE[outcome.final_status]}>{RUN_STATUS_LABEL[outcome.final_status]}</Badge>
          {outcome.flaky ? <Badge tone="warn">flaky</Badge> : null}
        </span>
      }
      onClose={props.onClose}
      size="lg"
      footer={
        <button className="btn" onClick={props.onClose}>
          Tutup
        </button>
      }
    >
      <div className="kv ap-mb">
        <span className="kv-key">Judul</span>
        <span>{outcome.title}</span>
        <span className="kv-key">Engine</span>
        <span>{ENGINE_LABEL[outcome.engine] ?? outcome.engine}</span>
        <span className="kv-key">Status awal</span>
        <span>
          <Badge tone={RUN_STATUS_TONE[outcome.initial_status]}>{RUN_STATUS_LABEL[outcome.initial_status]}</Badge>
        </span>
        <span className="kv-key">Status akhir</span>
        <span>
          <Badge tone={RUN_STATUS_TONE[outcome.final_status]}>{RUN_STATUS_LABEL[outcome.final_status]}</Badge>
        </span>
        <span className="kv-key">Percobaan</span>
        <span className="cell-mono">{outcome.attempts}</span>
        <span className="kv-key">Durasi total</span>
        <span className="cell-mono">{fmtDuration(outcome.duration_ms)}</span>
        <span className="kv-key">Worker</span>
        <span className="cell-mono">{outcome.worker_id}</span>
        {outcome.error ? (
          <>
            <span className="kv-key">Error</span>
            <span className="ap-err">{outcome.error}</span>
          </>
        ) : null}
      </div>

      {outcome.flaky ? (
        <div className="alert alert-warn ap-mb">
          <span>🔁</span>
          <div>
            <div className="strong">Kasus ini flaky</div>
            <div>
              Percobaan pertama {RUN_STATUS_LABEL[outcome.initial_status]}, lalu menjadi{' '}
              {RUN_STATUS_LABEL[outcome.final_status]} pada percobaan berikutnya. Verdict-nya tidak stabil sehingga
              TIDAK dihitung sebagai lulus bersih — perbaiki stabilitasnya sebelum mempercayai hasil ini.
            </div>
          </div>
        </div>
      ) : null}

      {outcome.healing ? (
        <Card title="Penyembuhan Selector" className="ap-mb">
          <div className="row ap-mb">
            <Badge tone={outcome.healing.applied ? 'ok' : 'muted'}>
              {outcome.healing.applied ? 'selector pengganti dihasilkan' : 'tidak ada pengganti'}
            </Badge>
          </div>
          {outcome.healing.original_selector ? (
            <div className="kv ap-mb">
              <span className="kv-key">Selector gagal</span>
              <span className="cell-mono">{outcome.healing.original_selector}</span>
              <span className="kv-key">Selector hasil</span>
              <span className="cell-mono">{outcome.healing.healed_selector ?? '—'}</span>
            </div>
          ) : null}
          <p className="mute-sm">{outcome.healing.rationale}</p>
        </Card>
      ) : null}

      {outcome.triage ? (
        <Card title="Triase Kegagalan">
          <div className="kv ap-mb">
            <span className="kv-key">Keparahan</span>
            <span>
              <Badge tone={SEVERITY_TONE[outcome.triage.severity]}>{SEVERITY_LABEL[outcome.triage.severity]}</Badge>
            </span>
            <span className="kv-key">Akar masalah</span>
            <span>{outcome.triage.likely_root_cause}</span>
            <span className="kv-key">Pemilik disarankan</span>
            <span>{outcome.triage.suggested_owner_role}</span>
          </div>
          <p className="mute-sm">{outcome.triage.rationale}</p>
        </Card>
      ) : null}
    </Modal>
  );
}
