/**
 * metrics module — lifecycle stages 11 & 12 (release gate, QA metrics & reporting).
 *
 * Routes (mounted at /api):
 *   GET /projects/:projectId/metrics                 full MetricsSnapshot
 *   GET /projects/:projectId/metrics/trend?days=30   pass/fail trend only
 *   GET /projects/:projectId/metrics/readiness       { go_no_go, blockers, quality_gate, pass_rate }
 *   GET /projects/:projectId/metrics/catalog         the metric catalog with formulas (UI help)
 *
 * `metricsService` is exported from ./service.ts and is imported in-process by lanes A, C and E.
 */

import type { FastifyInstance } from 'fastify';
import { one, notFound } from '../../lib/http.js';
import { findById } from '../../db/index.js';
import { metricsService, trend, readiness } from './service.js';

export { metricsService } from './service.js';

/** The QA metric catalog — mirrors the formulas documented in docs/project-management/. */
const METRIC_CATALOG = [
  {
    group: 'Coverage',
    items: [
      {
        key: 'requirement_coverage_pct',
        label: 'Cakupan Kebutuhan',
        formula: 'kebutuhan dengan minimal 1 test case tertaut / total kebutuhan × 100',
        target: '≥ 95%',
      },
      {
        key: 'test_case_execution_pct',
        label: 'Cakupan Eksekusi',
        formula: 'test case unik yang punya hasil eksekusi / total test case aktif × 100',
        target: '≥ 90%',
      },
      {
        key: 'automation_pct',
        label: 'Rasio Otomasi',
        formula: "test case berstatus 'automated' atau engine ≠ manual / total test case aktif × 100",
        target: '≥ 40%',
      },
      {
        key: 'regression_suite_size',
        label: 'Ukuran Suite Regresi',
        formula: 'jumlah test case dengan is_regression = 1',
        target: '≥ 20 kasus atau seluruh kasus risiko tinggi',
      },
    ],
  },
  {
    group: 'Quality',
    items: [
      {
        key: 'pass_rate',
        label: 'Pass Rate',
        formula: 'hasil eksekusi berstatus passed / seluruh eksekusi berstatus final × 100',
        target: '≥ quality gate project',
      },
      { key: 'fail_rate', label: 'Fail Rate', formula: 'failed / seluruh eksekusi final × 100', target: '≤ 5%' },
      { key: 'block_rate', label: 'Block Rate', formula: 'blocked / seluruh eksekusi final × 100', target: '≤ 3%' },
      {
        key: 'defect_density',
        label: 'Defect Density',
        formula: 'total defect / total test case aktif',
        target: '≤ 0.5 defect per test case',
      },
      {
        key: 'defect_leakage_pct',
        label: 'Defect Leakage (Escape Rate)',
        formula: 'defect dengan is_escaped = 1 / total defect × 100',
        target: '≤ 2%',
      },
      {
        key: 'reopen_rate',
        label: 'Reopen Rate',
        formula: "defect berstatus 'reopened' / total defect × 100",
        target: '≤ 5%',
      },
      {
        key: 'regression_suite_pass_pct',
        label: 'Pass Rate Suite Regresi',
        formula: 'hasil passed pada run berjenis regression / seluruh hasil run regression × 100',
        target: '= 100% untuk gerbang go',
      },
    ],
  },
  {
    group: 'Efficiency',
    items: [
      {
        key: 'avg_case_duration_ms',
        label: 'Rata-rata Durasi Kasus',
        formula: 'total duration_ms seluruh eksekusi final / jumlah eksekusi final',
        target: 'turunkan tiap sprint',
      },
      {
        key: 'automation_roi_minutes_saved',
        label: 'ROI Otomasi (menit)',
        formula: '(jumlah eksekusi otomatis × 3 menit baseline manual − total durasi otomatis) / 60000',
        target: 'naik tiap sprint',
      },
      {
        key: 'estimated_hours_saved_per_run',
        label: 'Estimasi Jam Hemat per Run',
        formula: 'ROI otomasi dalam menit / 60',
        target: 'naik tiap sprint',
      },
    ],
  },
  {
    group: 'Readiness',
    items: [
      {
        key: 'release_gate_pct',
        label: 'Quality Gate',
        formula: 'projects.quality_gate',
        target: 'disepakati bersama product owner',
      },
      {
        key: 'go_no_go',
        label: 'Keputusan Rilis',
        formula:
          "no_go bila belum ada eksekusi atau pass_rate < quality_gate; conditional bila ada blocker tersisa; go bila pass_rate ≥ gate dan tanpa blocker",
        target: 'go',
      },
      {
        key: 'flaky_cases',
        label: 'Kasus Flaky',
        formula: 'test case dengan ≥ 2 pergantian status berurutan dan pernah lulus serta gagal dalam 90 hari',
        target: '0 kasus',
      },
    ],
  },
];

export default async function routes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/metrics', async (req, reply) => {
    if (!findById('projects', req.params.projectId)) return notFound(reply, 'Project');
    return one(await metricsService.snapshot(req.params.projectId));
  });

  app.get<{ Params: { projectId: string }; Querystring: { days?: string } }>(
    '/projects/:projectId/metrics/trend',
    async (req, reply) => {
      if (!findById('projects', req.params.projectId)) return notFound(reply, 'Project');
      const days = req.query?.days ? Number(req.query.days) : 30;
      const points = trend(req.params.projectId, Number.isFinite(days) ? days : 30);
      return one({ days: points.length, data: points });
    },
  );

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/metrics/readiness', async (req, reply) => {
    if (!findById('projects', req.params.projectId)) return notFound(reply, 'Project');
    return one(readiness(req.params.projectId));
  });

  app.get('/metrics/catalog', async () => one(METRIC_CATALOG));
}
