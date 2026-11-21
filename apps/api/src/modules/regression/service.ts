/**
 * regression service — 👑 KING OF THE TEST.
 *
 * `selectSuite(projectId, opts)` produces an explainable, reproducible `RegressionPlan`:
 * every candidate is scored with the frozen `riskScore()` model, every selected/excluded case
 * carries a human-readable `reason`, and the plan reports duration, automated share and
 * coverage of high-risk cases.
 *
 * Strategies:
 *   risk_based     (default) risk_score >= 65, plus regression members and open-defect cases
 *   full                      every non-deprecated case, risk order
 *   impact_only               only cases reachable from the changed artifact
 *   smoke_then_full           a fast automated smoke layer first, then the rest (marked phase 2)
 *   time_boxed                greedy highest-risk-first until the minute budget is spent
 *
 * This service is consumed in-process by lane-auto (§6.1) and over HTTP by the web app.
 */

import type {
  ExecEngine,
  RegressionPlan,
  RiskLevel,
} from '@qatools/shared';
import { riskScore } from '@qatools/shared';
import {
  gatherCandidates,
  openDefectsByCase,
  impactedTestCaseIds,
  automationArtifactCount,
  type Candidate,
} from './repo.js';

export type RegressionStrategy = RegressionPlan['strategy'];

export const REGRESSION_STRATEGIES: RegressionStrategy[] = [
  'risk_based',
  'full',
  'impact_only',
  'smoke_then_full',
  'time_boxed',
];

/** Anything at or above this score is non-negotiable: it always enters the suite. */
export const HIGH_RISK_THRESHOLD = 65;
/** Time-boxed default budget when the caller does not name one. */
export const DEFAULT_BUDGET_MINUTES = 120;
/** Smoke layer size cap — a smoke run must stay fast. */
const SMOKE_MAX_CASES = 15;

export interface SelectOptions {
  strategy?: RegressionStrategy | string;
  /** Accepts anything: a query string, a JSON number, or null. Normalised internally. */
  budget_minutes?: unknown;
  impact_of?: unknown;
  /** Restrict candidates to these ids (used when the caller already resolved a shortlist). */
  test_case_ids?: string[];
  /** Include the cases a time-boxed plan had to drop in `excluded` (default true). */
  explain_exclusions?: boolean;
}

interface ScoredCase extends Candidate {
  score: number;
  level: RiskLevel;
  factors: string[];
  /** Step-by-step, human-readable justification assembled from the scoring factors. */
  explanation: string[];
  open_defects: Array<{ code: string; severity: string; status: string }>;
  has_automation_artifact: boolean;
  engine: ExecEngine;
}

export interface ExplainedPlan extends RegressionPlan {
  /** Extra explainability the UI renders but the frozen RegressionPlan shape does not carry. */
  detail: {
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
  };
}

const STRATEGY_LABEL: Record<RegressionStrategy, string> = {
  risk_based: 'Berbasis Risiko',
  full: 'Suite Penuh',
  impact_only: 'Hanya Dampak Perubahan',
  smoke_then_full: 'Smoke dulu, lalu Penuh',
  time_boxed: 'Dibatasi Waktu',
};

export const regressionService = {
  selectSuite(projectId: string, opts: SelectOptions = {}): ExplainedPlan {
    const strategy = normalizeStrategy(opts.strategy);
    const budget = normalizeBudget(opts.budget_minutes, strategy);
    const impactOf = opts.impact_of ? String(opts.impact_of) : null;

    const candidates = gatherCandidates(projectId);
    const openDefects = openDefectsByCase(projectId);
    const artifactCounts = automationArtifactCount(candidates.map((c) => c.id));

    // ---- score every candidate with the frozen model -----------------------
    let scored: ScoredCase[] = candidates.map((c) => {
      const risk = riskScore({
        businessCriticality: c.business_criticality,
        usageFrequency: c.usage_frequency,
        complexity: c.complexity,
        defectHistory: c.defect_history,
        lastRunFailed: c.last_run_failed,
        isRegression: c.is_regression === 1,
        hasAutomation: c.automation_status === 'automated',
      });
      const defects = openDefects.get(c.id) ?? [];
      const artifactCount = artifactCounts.get(c.id) ?? 0;
      return {
        ...c,
        score: risk.score,
        level: risk.level,
        factors: risk.factors,
        explanation: buildExplanation(c, risk.score, risk.level, defects, artifactCount),
        open_defects: defects,
        has_automation_artifact: artifactCount > 0,
        engine: c.engine as ExecEngine,
      };
    });

    // ---- strategy-specific candidate narrowing ----------------------------
    let narrowed = scored;
    let impactNote: string | null = null;
    let impactIds: string[] | null = null;

    if (strategy === 'impact_only') {
      if (!impactOf) {
        // Without a change reference the honest answer is "nothing to scope": return an empty,
        // fully-explained plan rather than silently falling back to a different strategy.
        impactNote = 'impact_of tidak diberikan';
        impactIds = [];
      } else {
        impactIds = impactedTestCaseIds(projectId, impactOf);
        impactNote = `${impactIds.length} test case terdampak oleh ${impactOf}`;
      }
      const allowed = new Set(impactIds);
      narrowed = scored.filter((c) => allowed.has(c.id));
    }

    if (Array.isArray(opts.test_case_ids) && opts.test_case_ids.length) {
      const allowed = new Set(opts.test_case_ids.map(String));
      narrowed = narrowed.filter((c) => allowed.has(c.id));
    }

    // ---- strategy-specific selection --------------------------------------
    const highRiskAll = narrowed.filter((c) => c.score >= HIGH_RISK_THRESHOLD);
    const decisions = new Map<string, { selected: boolean; reason: string; phase?: string }>();
    const phases: Array<{ name: string; test_case_ids: string[]; reason: string }> = [];

    const byRisk = [...narrowed].sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));

    switch (strategy) {
      case 'full': {
        for (const c of byRisk) {
          const must = c.is_regression === 1;
          decisions.set(c.id, {
            selected: true,
            reason: must
              ? `Suite penuh diwajibkan: seluruh test case aktif dijalankan (anggota regresi, risiko ${c.score})`
              : `Suite penuh diwajibkan: seluruh test case aktif dijalankan (risiko ${c.score})`,
          });
        }
        phases.push({
          name: 'Suite Penuh',
          test_case_ids: byRisk.map((c) => c.id),
          reason: 'Seluruh test case aktif masuk scope tanpa penyaringan risiko.',
        });
        break;
      }

      case 'smoke_then_full': {
        const smoke = pickSmokeLayer(byRisk);
        const smokeIds = new Set(smoke.map((c) => c.id));
        for (const c of byRisk) {
          if (smokeIds.has(c.id)) continue;
          decisions.set(c.id, {
            selected: true,
            phase: 'Fase 2 — Suite Penuh',
            reason: `Fase 2 suite penuh: dijalankan setelah smoke lolos (risiko ${c.score}, ${c.automation_status})`,
          });
        }
        for (const c of smoke) {
          decisions.set(c.id, {
            selected: true,
            phase: 'Fase 1 — Smoke',
            reason: smokeReason(c),
          });
        }
        phases.push({
          name: 'Fase 1 — Smoke',
          test_case_ids: smoke.map((c) => c.id),
          reason: `Lapisan smoke otomatis tercepat (maks ${SMOKE_MAX_CASES} kasus) untuk gerbang cepat sebelum suite penuh.`,
        });
        phases.push({
          name: 'Fase 2 — Suite Penuh',
          test_case_ids: byRisk.filter((c) => !smokeIds.has(c.id)).map((c) => c.id),
          reason: 'Dijalankan setelah smoke hijau — seluruh test case aktif.',
        });
        break;
      }

      case 'time_boxed': {
        let spent = 0;
        let overflowHigh: ScoredCase | null = null;
        for (const c of byRisk) {
          const isHigh = c.score >= HIGH_RISK_THRESHOLD;
          const cost = c.estimated_minutes;
          if (spent + cost <= budget) {
            spent += cost;
            decisions.set(c.id, {
              selected: true,
              reason: isHigh
                ? `Prioritas tertinggi dalam anggaran ${budget} menit (risiko ${c.score} ≥ ${HIGH_RISK_THRESHOLD}, butuh ${cost} menit, sisa ${budget - spent} menit)`
                : `Terpilih karena masih muat dalam anggaran waktu: risiko ${c.score}, butuh ${cost} menit, sisa ${budget - spent} menit`,
            });
            continue;
          }
          // High-risk cases may never be silently dropped by the budget: report them loudly.
          if (isHigh && !overflowHigh) overflowHigh = c;
          decisions.set(c.id, {
            selected: false,
            reason: isHigh
              ? `RISIKO TINGGI TERBUANG: risiko ${c.score} ≥ ${HIGH_RISK_THRESHOLD} tetapi butuh ${cost} menit dan hanya tersisa ${budget - spent} menit dari anggaran ${budget} menit — tambah anggaran atau turunkan cakupan`
              : `Anggaran waktu habis: butuh ${cost} menit, tersisa ${budget - spent} menit dari ${budget} menit (risiko ${c.score})`,
          });
        }
        if (overflowHigh) {
          phases.push({
            name: 'Peringatan Anggaran',
            test_case_ids: [overflowHigh.id],
            reason: `Anggaran ${budget} menit tidak cukup untuk seluruh kasus risiko tinggi; minimal satu kasus kritis tidak terpilih.`,
          });
        }
        break;
      }

      case 'impact_only': {
        if (!impactOf) {
          for (const c of byRisk) {
            decisions.set(c.id, {
              selected: false,
              reason: 'Strategi impact_only dipilih tanpa parameter impact_of, sehingga tidak ada perubahan yang bisa dilacak',
            });
          }
        } else {
          const allowed = new Set(impactIds ?? []);
          for (const c of byRisk) {
            decisions.set(c.id, {
              selected: allowed.has(c.id),
              reason: allowed.has(c.id)
                ? `Terhubung ke perubahan ${impactOf} melalui traceability matrix (risiko ${c.score}, ${c.factors.slice(0, 2).join('; ')})`
                : `Tidak terhubung ke ${impactOf} pada traceability matrix — di luar blast radius perubahan`,
            });
          }
        }
        break;
      }

      case 'risk_based':
      default: {
        for (const c of byRisk) {
          const reasons: string[] = [];
          const isHigh = c.score >= HIGH_RISK_THRESHOLD;

          if (isHigh) reasons.push(`risiko tinggi ${c.score} ≥ ambang ${HIGH_RISK_THRESHOLD}`);
          if (c.is_regression === 1) reasons.push('anggota tetap suite regresi');
          if (c.last_run_failed) reasons.push('gagal pada eksekusi terakhir');
          if (c.open_defects.length) {
            reasons.push(`defect terbuka: ${c.open_defects.map((d) => d.code).join(', ')}`);
          }
          if (c.defect_history >= 2) reasons.push(`riwayat ${c.defect_history} defect pada kasus ini`);

          const selected = isHigh || c.is_regression === 1 || c.last_run_failed || c.open_defects.length > 0;

          if (selected) {
            decisions.set(c.id, {
              selected: true,
              reason: `MASUK — ${reasons.join('; ')}. Faktor skor: ${c.factors.join(', ')}.`,
            });
          } else {
            decisions.set(c.id, {
              selected: false,
              reason: excludeReason(c, isHigh),
            });
          }
        }
        break;
      }
    }

    // ---- assemble the frozen RegressionPlan --------------------------------
    const selectedScored = byRisk.filter((c) => decisions.get(c.id)?.selected);
    const excludedScored = byRisk.filter((c) => !decisions.get(c.id)?.selected);

    const selected: RegressionPlan['selected'] = selectedScored.map((c) => ({
      test_case_id: c.id,
      code: c.code,
      title: c.title,
      risk_score: c.score,
      risk_level: c.level,
      reason: phasePrefix(c, decisions.get(c.id)) + (decisions.get(c.id)?.reason ?? ''),
      engine: c.engine,
      automation_status: c.automation_status,
    }));

    const excluded: RegressionPlan['excluded'] = excludedScored.map((c) => ({
      test_case_id: c.id,
      code: c.code,
      title: c.title,
      reason: decisions.get(c.id)?.reason ?? 'Tidak memenuhi kriteria pemilihan',
    }));

    const estimatedMinutes = selectedScored.reduce((sum, c) => sum + c.estimated_minutes, 0);
    const automatedCount = selectedScored.filter((c) => isAutomated(c)).length;
    const automatedMinutes = selectedScored.filter((c) => isAutomated(c)).reduce((s, c) => s + c.estimated_minutes, 0);
    const manualMinutes = estimatedMinutes - automatedMinutes;

    const highRiskTotal = highRiskAll.length;
    const highRiskCovered = selectedScored.filter((c) => c.score >= HIGH_RISK_THRESHOLD).length;
    const excludedHighRisk = excludedScored
      .filter((c) => c.score >= HIGH_RISK_THRESHOLD)
      .map((c) => ({ test_case_id: c.id, code: c.code, title: c.title, risk_score: c.score }));

    return {
      project_id: projectId,
      generated_at: new Date().toISOString(),
      strategy,
      selected,
      excluded,
      estimates: {
        total_cases: narrowed.length,
        selected_cases: selected.length,
        estimated_minutes: estimatedMinutes,
        automated_share_pct: selected.length ? round1((automatedCount / selected.length) * 100) : 0,
        coverage_of_high_risk_pct: highRiskTotal ? round1((highRiskCovered / highRiskTotal) * 100) : 100,
      },
      rationale: buildRationale({
        strategy,
        selected,
        excluded,
        highRiskTotal,
        highRiskCovered,
        estimatedMinutes,
        automatedCount,
        budget,
        impactNote,
        impactOf,
        overflowHighRisk: excludedHighRisk.length > 0,
      }),
      detail: {
        threshold: HIGH_RISK_THRESHOLD,
        strategy_label: STRATEGY_LABEL[strategy],
        budget_minutes: strategy === 'time_boxed' ? budget : null,
        automated_count: automatedCount,
        manual_minutes: manualMinutes,
        automated_minutes: automatedMinutes,
        high_risk_total: highRiskTotal,
        high_risk_covered: highRiskCovered,
        excluded_high_risk: excludedHighRisk,
        impact_of: impactOf,
        phases,
        factors_legend: {
          'business criticality': 'prioritas requirement / use case / skenario / test case tertinggi',
          'usage frequency': 'seberapa sering fitur dipakai pengguna (diturunkan dari tipe & severity kasus)',
          complexity: 'kompleksitas interaksi: layer, jumlah langkah, dan tipe kasus',
          'defect history': 'jumlah defect historis yang terhubung ke test case ini (maks +15)',
          'last run failed': 'status gagal pada eksekusi terakhir (+12)',
          'regression case': 'sudah menjadi anggota suite regresi (+6)',
          'not automated': 'belum terotomasi sehingga lebih rawan terlewat (+5)',
        },
      },
    };
  },

  /** Flaky cases, proxied from the runs repo so consumers have one regression surface. */
  strategies(): Array<{ id: RegressionStrategy; label: string; description: string }> {
    return [
      {
        id: 'risk_based',
        label: STRATEGY_LABEL.risk_based,
        description: `Pilih test case dengan skor risiko ≥ ${HIGH_RISK_THRESHOLD}, seluruh anggota suite regresi, kasus yang gagal terakhir, dan kasus dengan defect terbuka.`,
      },
      {
        id: 'full',
        label: STRATEGY_LABEL.full,
        description: 'Jalankan seluruh test case aktif tanpa penyaringan. Paling aman, paling mahal.',
      },
      {
        id: 'impact_only',
        label: STRATEGY_LABEL.impact_only,
        description: 'Hanya test case yang terhubung ke artefak yang berubah melalui traceability matrix.',
      },
      {
        id: 'smoke_then_full',
        label: STRATEGY_LABEL.smoke_then_full,
        description: `Lapisan smoke cepat (maks ${SMOKE_MAX_CASES} kasus otomatis prioritas tertinggi), lalu suite penuh bila smoke hijau.`,
      },
      {
        id: 'time_boxed',
        label: STRATEGY_LABEL.time_boxed,
        description: `Ambil kasus risiko tertinggi terlebih dahulu sampai anggaran ${DEFAULT_BUDGET_MINUTES} menit habis.`,
      },
    ];
  },
};

/* -------------------------------- helpers -------------------------------- */

function normalizeStrategy(v: unknown): RegressionStrategy {
  const s = String(v ?? 'risk_based');
  return (REGRESSION_STRATEGIES as string[]).includes(s) ? (s as RegressionStrategy) : 'risk_based';
}

function normalizeBudget(v: unknown, strategy: RegressionStrategy): number {
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  return strategy === 'time_boxed' ? DEFAULT_BUDGET_MINUTES : 0;
}

function isAutomated(c: ScoredCase): boolean {
  return c.automation_status === 'automated' || c.engine !== 'manual' || c.has_automation_artifact;
}

function phasePrefix(c: ScoredCase, d: { phase?: string } | undefined): string {
  return d?.phase ? `[${d.phase}] ` : '';
}

/**
 * Builds the per-case explanation list: why this score, in the order the factors applied.
 * Every line names the concrete evidence, not just the numeric weight.
 */
function buildExplanation(
  c: Candidate,
  score: number,
  level: RiskLevel,
  defects: Array<{ code: string; severity: string; status: string }>,
  artifactCount: number,
): string[] {
  const out: string[] = [];
  out.push(
    `Kritikalitas bisnis "${c.business_criticality}" (dari ${c.business_criticality_source}) — fitur ini ${
      c.business_criticality === 'critical' ? 'wajib selalu diuji' : 'memengaruhi rilis'
    }`,
  );
  out.push(`Frekuensi pemakaian "${c.usage_frequency}" (tipe ${c.type}, severity ${c.severity})`);
  out.push(
    `Kompleksitas "${c.complexity}" (layer ${c.layer}, ${c.step_count} langkah, tipe ${c.type})`,
  );
  if (c.defect_history) out.push(`${c.defect_history} defect historis terhubung ke kasus ini`);
  if (c.last_run_failed) out.push(`Gagal pada eksekusi terakhir (${c.last_run_at ?? 'waktu tidak tercatat'})`);
  if (defects.length) {
    out.push(
      `${defects.length} defect belum tuntas: ${defects.map((d) => `${d.code} (${d.severity}/${d.status})`).join(', ')}`,
    );
  }
  if (c.is_regression === 1) out.push('Sudah terdaftar sebagai anggota suite regresi');
  if (c.automation_status !== 'automated') {
    out.push(`Belum terotomasi (status: ${c.automation_status}) — rawan terlewat bila tidak dipilih`);
  } else {
    out.push(
      artifactCount
        ? `Terotomasi dengan artefak eksekusi siap pakai (${artifactCount} artefak)`
        : 'Ditandai terotomasi pada katalog test case',
    );
  }
  if (c.executions) {
    out.push(
      `Riwayat eksekusi: ${c.executions} kali, ${c.pass_count} lulus, ${c.fail_count} gagal, ${c.flips} kali berubah status`,
    );
  } else {
    out.push('Belum pernah dieksekusi — risiko belum tervalidasi');
  }
  out.push(`Total skor risiko ${score}/100 (${level})`);
  return out;
}

/** The reason an excluded case did not make the risk-based cut — always specific. */
function excludeReason(c: ScoredCase, isHigh: boolean): string {
  if (isHigh) return `Skor risiko tinggi ${c.score} namun tertahan oleh filter strategi`;
  const parts: string[] = [`Skor risiko ${c.score} di bawah ambang ${HIGH_RISK_THRESHOLD}`];
  if (c.is_regression !== 1) parts.push('bukan anggota suite regresi');
  if (!c.last_run_failed) parts.push(`eksekusi terakhir ${c.last_run_status ?? 'belum pernah dijalankan'}`);
  if (!c.open_defects.length) parts.push('tidak ada defect terbuka');
  parts.push(
    `kritikalitas ${c.business_criticality} (${c.business_criticality_source}), ${c.defect_history} defect historis`,
  );
  return `DIKELUARKAN — ${parts.join('; ')}. Faktor skor: ${c.factors.join(', ')}.`;
}

/** Smoke layer: fastest automated cases that cover the highest risk first. */
function pickSmokeLayer(byRisk: ScoredCase[]): ScoredCase[] {
  const automated = byRisk.filter((c) => isAutomated(c));
  const chosen: ScoredCase[] = [];
  const seen = new Set<string>();

  // 1. Every high-risk automated case that is also a regression member.
  for (const c of automated) {
    if (chosen.length >= SMOKE_MAX_CASES) break;
    if (c.score >= HIGH_RISK_THRESHOLD && c.is_regression === 1) {
      chosen.push(c);
      seen.add(c.id);
    }
  }
  // 2. Fill with the cheapest automated cases by risk density within a 10-minute smoke budget.
  let smokeBudget = 10;
  for (const c of automated) {
    if (chosen.length >= SMOKE_MAX_CASES || smokeBudget <= 0) break;
    if (seen.has(c.id)) continue;
    chosen.push(c);
    seen.add(c.id);
    smokeBudget -= Math.min(c.estimated_minutes, 3);
  }
  // 3. Last resort: the highest-risk manual case so smoke is never empty.
  if (!chosen.length && byRisk.length) {
    chosen.push(byRisk[0]!);
  }
  return chosen;
}

function smokeReason(c: ScoredCase): string {
  if (c.score >= HIGH_RISK_THRESHOLD && c.is_regression === 1) {
    return `Smoke prioritas: risiko tinggi ${c.score} dan anggota suite regresi, cepat dijalankan (${c.automation_status})`;
  }
  if (isAutomated(c)) {
    return `Smoke cepat: terotomasi (${c.engine}), risiko ${c.score}, ±${c.estimated_minutes} menit`;
  }
  return `Smoke fallback: kasus risiko tertinggi yang tersedia (${c.score}) karena belum ada kasus terotomasi`;
}

interface RationaleInput {
  strategy: RegressionStrategy;
  selected: RegressionPlan['selected'];
  excluded: RegressionPlan['excluded'];
  highRiskTotal: number;
  highRiskCovered: number;
  estimatedMinutes: number;
  automatedCount: number;
  budget: number;
  impactNote: string | null;
  impactOf: string | null;
  overflowHighRisk: boolean;
}

/** The rationale is user-facing copy: Bahasa Indonesia, specific numbers, honest about gaps. */
function buildRationale(input: RationaleInput): string {
  const {
    strategy,
    selected,
    excluded,
    highRiskTotal,
    highRiskCovered,
    estimatedMinutes,
    automatedCount,
    budget,
    impactNote,
    impactOf,
    overflowHighRisk,
  } = input;

  const coverPct = highRiskTotal ? round1((highRiskCovered / highRiskTotal) * 100) : 100;
  const autoPct = selected.length ? round1((automatedCount / selected.length) * 100) : 0;
  const head = `Strategi ${STRATEGY_LABEL[strategy]}`;

  if (!selected.length) {
    const why =
      strategy === 'impact_only' && !impactOf
        ? 'Tidak ada artefak perubahan (impact_of) yang diberikan, sehingga tidak ada test case yang bisa dipilih.'
        : strategy === 'time_boxed'
          ? `Anggaran ${budget} menit tidak cukup untuk satu pun test case pada katalog.`
          : 'Tidak ada test case aktif yang memenuhi kriteria strategi ini.';

    const parts = [`${head}: suite kosong. ${why}`];
    if (strategy === 'time_boxed' && overflowHighRisk) {
      parts.push(
        `PERINGATAN: ${highRiskTotal} test case berisiko tinggi tidak dapat dijalankan dalam anggaran ini — naikkan budget_minutes sebelum merilis, karena gate rilis tidak boleh dilewati tanpa bukti.`,
      );
    }
    parts.push(
      'Periksa kembali katalog test case, membership regresi, atau parameter strategi sebelum menjalankan gate rilis.',
    );
    return parts.join(' ');
  }

  const parts: string[] = [];
  parts.push(
    `${head} memilih ${selected.length} dari ${selected.length + excluded.length} test case (estimasi ${estimatedMinutes} menit, ${autoPct}% terotomasi).`,
  );

  if (strategy === 'time_boxed') {
    parts.push(
      `Anggaran ${budget} menit dialokasikan dengan mengambil risiko tertinggi lebih dahulu (greedy by risk score).`,
    );
    if (overflowHighRisk) {
      parts.push(
        `PERINGATAN: anggaran tidak cukup untuk seluruh kasus risiko tinggi — lihat daftar excluded_high_risk dan naikkan budget sebelum merilis.`,
      );
    }
  }
  if (strategy === 'impact_only' && impactNote) {
    parts.push(`Cakupan dampak: ${impactNote}, ditelusuri melalui traceability matrix dan relasi struktur skenario/use case.`);
  }
  if (strategy === 'smoke_then_full') {
    parts.push(
      'Dua fase dijalankan berurutan: smoke dulu untuk gerbang cepat, lalu suite penuh bila smoke hijau.',
    );
  }

  parts.push(
    `Cakupan kasus risiko tinggi ${highRiskCovered}/${highRiskTotal} (${coverPct}%).`,
  );
  if (coverPct >= 100) {
    parts.push('Seluruh kasus risiko tinggi sudah masuk suite — gate rilis ini dapat dipercaya.');
  } else {
    parts.push(
      'Sebagian kasus risiko tinggi belum masuk suite; tinjau daftar pengecualian sebelum menyatakan rilis siap.',
    );
  }

  parts.push(
    `Regresi adalah Raja: suite ini adalah gerbang terakhir sebelum rilis, sehingga pengecualian harus disengaja, terdokumentasi, dan ditinjau ulang setiap siklus.`,
  );
  return parts.join(' ');
}

function round1(n: number): number {
  return Number(n.toFixed(1));
}
