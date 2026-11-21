/**
 * agents/triage — failure triage + run narrative for the AI QA agent pool.
 *
 * Two responsibilities:
 *  1. `triageFailures(outcomes)` — for every non-passing case, ask Lane D
 *     (`triage_defect`) for severity / root cause / owner. Lane D's own offline
 *     generator is deterministic, so triage works with zero configuration; the
 *     returned shapes are also normalised here so a partially-shaped AI reply
 *     can never corrupt an outcome.
 *  2. `buildAiSummary(result-ish)` — a Bahasa Indonesia narrative of the whole
 *     run: pass rate, notable failures, flaky cases, healing and the measured
 *     speedup. With no key this is generated deterministically (NOT a fake AI
 *     claim) and `ai_used` is reported honestly.
 *
 * Cross-lane imports are dynamic and inside the functions.
 */

import type { PoolCaseOutcome, Severity } from '@qatools/shared';

/* ------------------------------------------------------------------ *
 * Shared shapes
 * ------------------------------------------------------------------ */

export interface TriageResult {
  severity: Severity;
  likely_root_cause: string;
  suggested_owner_role: string;
  rationale: string;
}

export interface TriageSummary {
  /** Number of cases that received a triage row. */
  triaged: number;
  /** True only when a live AI provider produced at least one triage. */
  ai_used: boolean;
  notes: string[];
}

const SEVERITIES: Severity[] = ['cosmetic', 'minor', 'major', 'critical', 'blocker'];

function asSeverity(value: unknown, fallback: Severity): Severity {
  return typeof value === 'string' && (SEVERITIES as string[]).includes(value) ? (value as Severity) : fallback;
}

function asText(value: unknown, fallback: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return s || fallback;
}

/* ------------------------------------------------------------------ *
 * Offline triage — deterministic, used when Lane D is unavailable
 * ------------------------------------------------------------------ */

/** Severity from the test case's own metadata + the observed error text. */
export function offlineTriage(outcome: PoolCaseOutcome): TriageResult {
  const text = `${outcome.code} ${outcome.title} ${outcome.error ?? ''} ${outcome.engine}`.toLowerCase();

  let severity: Severity = 'major';
  let cause = 'Kegagalan perlu direproduksi terarah; bandingkan hasil aktual dengan ekspektasi pada satu alur tunggal.';
  let owner = 'QA Engineer';

  if (/\b(timeout|timed out|etimedout|deadline|hang)\b/.test(text)) {
    severity = 'major';
    cause = 'Waktu tunggu terlampaui: target lambat merespons, atau batas timeout pada konfigurasi pool terlalu ketat untuk lingkungan uji.';
    owner = 'Backend Engineer / DevOps';
  } else if (/\b(econnrefused|enotfound|dns|unreachable|getaddrinfo|network)\b/.test(text)) {
    severity = 'blocker';
    cause = 'Target tidak dapat dijangkau dari mesin ini (DNS/koneksi). Kemungkinan environment belum siap, bukan cacat produk.';
    owner = 'DevOps / Environment Owner';
  } else if (/\b(500|exception|stack ?trace|internal server)\b/.test(text)) {
    severity = 'critical';
    cause = 'Exception tidak tertangkap di sisi server; periksa log aplikasi pada rentang waktu eksekusi ini.';
    owner = 'Backend Engineer';
  } else if (/\b(401|403|unauthorized|forbidden|token|otentikasi|otorisasi)\b/.test(text)) {
    severity = 'critical';
    cause = 'Kegagalan otorisasi/otentikasi: kredensial pada environment mungkin kedaluwarsa atau hak akses berubah.';
    owner = 'Backend Engineer (Security Champion)';
  } else if (/\b(404|not found|tidak ditemukan)\b/.test(text)) {
    severity = 'major';
    cause = 'Endpoint, artefak, atau selector tidak ditemukan. Bila artefak tidak tertaut, ini masalah konfigurasi uji, bukan cacat produk.';
    owner = 'QA Automation Engineer';
  } else if (/\b(selector|elemen|element)\b/.test(text)) {
    severity = 'major';
    cause = 'Selector tidak lagi cocok dengan DOM: kemungkinan perubahan markup/atribut tanpa memperbarui skrip otomasi.';
    owner = 'Frontend Engineer';
  } else if (/\b(assertion|expected|ekspektasi|tidak sesuai|salah)\b/.test(text)) {
    severity = 'major';
    cause = 'Nilai aktual tidak sesuai ekspektasi; verifikasi apakah ekspektasi uji atau perilaku aplikasi yang berubah.';
    owner = 'Full-stack Engineer';
  } else if (/\b(db|sql|query|database|constraint|unique)\b/.test(text)) {
    severity = 'major';
    cause = 'Kegagalan pada lapisan data: query tidak mengembalikan baris yang diharapkan atau constraint menolak operasi.';
    owner = 'Backend Engineer / DBA';
  }

  if (outcome.engine === 'manual') {
    severity = 'minor';
    cause = 'Test case ber-engine manual sehingga tidak dieksekusi server; statusnya menunggu pencatatan tester.';
    owner = 'QA Engineer';
  }
  if (outcome.engine === 'ai') {
    owner = 'QA Automation Engineer (AI)';
  }

  const attemptsNote =
    outcome.attempts > 1
      ? ` Kasus ini dicoba ${outcome.attempts} kali, jadi indikasi kuat masalah non-deterministik.`
      : '';

  return {
    severity,
    likely_root_cause: cause,
    suggested_owner_role: owner,
    rationale:
      `Triase offline deterministik dari engine "${outcome.engine}", status ${outcome.initial_status}→${outcome.final_status}, ` +
      `dan pesan galat yang tercatat.${attemptsNote} Tingkat keparahan diturunkan dari kata kunci kegagalan; ` +
      'hubungkan dengan defect pada tracker sebelum menaikkan prioritas.',
  };
}

/* ------------------------------------------------------------------ *
 * Lane D adapter (dynamic, guarded)
 * ------------------------------------------------------------------ */

type AiGenerate = (
  task: string,
  input: Record<string, unknown>,
  ctx?: Record<string, unknown>,
) => Promise<unknown>;

interface AiModule {
  aiService?: { generate?: AiGenerate };
}

let aiModulePromise: Promise<AiModule | null> | null = null;

async function loadAi(): Promise<AiModule | null> {
  if (!aiModulePromise) {
    aiModulePromise = (async () => {
      try {
        const specifier = '../ai/index.js';
        return (await import(/* @vite-ignore */ specifier)) as AiModule;
      } catch {
        return null;
      }
    })();
  }
  return aiModulePromise;
}

interface AiCallOutcome {
  result: TriageResult | null;
  /** True only when a live model actually answered. */
  aiUsed: boolean;
  note: string | null;
}

/** One guarded `triage_defect` call, normalised into our contract. */
async function aiTriage(generate: AiGenerate, service: unknown, outcome: PoolCaseOutcome): Promise<AiCallOutcome> {
  try {
    const raw = (await generate.call(service, 'triage_defect', {
      title: `${outcome.code}: ${outcome.title}`,
      description:
        `Kegagalan otomasi pada engine ${outcome.engine}. Status awal ${outcome.initial_status}, ` +
        `status akhir ${outcome.final_status}, jumlah percobaan ${outcome.attempts}, flaky=${outcome.flaky}.`,
      actual_result: outcome.error ?? '(tidak ada pesan galat tercatat)',
      expected_result: 'Test case lulus pada seluruh assertion.',
      evidence: JSON.stringify({
        engine: outcome.engine,
        attempts: outcome.attempts,
        initial_status: outcome.initial_status,
        final_status: outcome.final_status,
        flaky: outcome.flaky,
        worker_id: outcome.worker_id,
      }),
      project_id: null,
    })) as {
      ok?: boolean;
      data?: Partial<TriageResult> | null;
      meta?: { used_mock?: boolean };
    };

    const usedMock = raw?.meta?.used_mock === true;
    if (!raw?.ok || !raw.data) {
      return { result: null, aiUsed: false, note: null };
    }

    const result: TriageResult = {
      severity: asSeverity(raw.data.severity, 'major'),
      likely_root_cause: asText(raw.data.likely_root_cause, 'Perlu investigasi lanjutan.'),
      suggested_owner_role: asText(raw.data.suggested_owner_role, 'QA Engineer'),
      rationale: asText(raw.data.rationale, 'Ditriase otomatis oleh lapisan AI.'),
    };
    return { result, aiUsed: !usedMock, note: null };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { result: null, aiUsed: false, note: `Triase AI gagal untuk ${outcome.code}: ${reason.slice(0, 120)}` };
  }
}

/* ------------------------------------------------------------------ *
 * triageFailures()
 * ------------------------------------------------------------------ */

/**
 * Populates `outcome.triage` for every case that did not finish cleanly.
 * Mutates the outcomes in place (they are freshly built by the pool) and also
 * returns them for convenience.
 *
 * Concurrency: triage calls are issued through a small local limiter so a
 * 100-failure run does not open 100 simultaneous provider requests.
 */
export async function triageFailures(
  outcomes: PoolCaseOutcome[],
  opts: { enabled?: boolean; concurrency?: number } = {},
): Promise<{ outcomes: PoolCaseOutcome[]; summary: TriageSummary }> {
  const summary: TriageSummary = { triaged: 0, ai_used: false, notes: [] };

  const targets = outcomes.filter((o) => o.final_status !== 'passed' && o.final_status !== 'skipped');
  if (!targets.length) {
    summary.notes.push('Tidak ada kegagalan yang perlu ditriase pada run ini.');
    return { outcomes, summary };
  }

  if (opts.enabled === false) {
    summary.notes.push('ai_triage nonaktif pada konfigurasi pool; tiap kegagalan tetap dibiarkan tanpa baris triase.');
    return { outcomes, summary };
  }

  const ai = await loadAi();
  const generate = ai?.aiService?.generate;

  if (typeof generate !== 'function') {
    for (const outcome of targets) {
      outcome.triage = offlineTriage(outcome);
      summary.triaged++;
    }
    summary.notes.push(
      'Modul AI (lane D) tidak tersedia; seluruh kegagalan ditriase dengan aturan offline deterministik yang sama.',
    );
    return { outcomes, summary };
  }

  const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? 4));
  const queue = [...targets];
  let aiAnswered = 0;
  const notes = new Set<string>();

  const worker = async (): Promise<void> => {
    for (;;) {
      const outcome = queue.shift();
      if (!outcome) return;
      const attempt = await aiTriage(generate, ai?.aiService, outcome);
      if (attempt.result) {
        outcome.triage = attempt.result;
        summary.triaged++;
        if (attempt.aiUsed) aiAnswered++;
        else notes.add('Sebagian/seluruh triase dilayani generator offline deterministik (tidak ada provider AI aktif).');
      } else {
        // AI could not answer for this case — fall back to the deterministic rule.
        outcome.triage = offlineTriage(outcome);
        summary.triaged++;
        if (attempt.note) notes.add(attempt.note);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));

  summary.ai_used = aiAnswered > 0;
  if (summary.ai_used) {
    summary.notes.push(
      `Triase dihasilkan model AI aktif untuk ${aiAnswered}/${targets.length} kegagalan` +
        (aiAnswered < targets.length ? '; sisanya memakai aturan offline.' : '.'),
    );
  } else if (!notes.size) {
    notes.add('Triase dilayani generator offline deterministik (tidak ada provider AI aktif).');
  }
  summary.notes.push(...notes);

  return { outcomes, summary };
}

/* ------------------------------------------------------------------ *
 * ai_summary — the Bahasa Indonesia run narrative
 * ------------------------------------------------------------------ */

export interface SummaryInput {
  project_id: string;
  strategy: string;
  workers: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    skipped: number;
    flaky: number;
    healed: number;
    retried: number;
    duration_ms: number;
    sequential_duration_ms: number;
    speedup: number;
    workers_used: number;
  };
  outcomes: PoolCaseOutcome[];
  /** AI availability, from `aiService.status()`. */
  aiConfigured: boolean;
  aiProvider: string;
  aiMode: string;
  aborted: boolean;
}

export interface SummaryOutcome {
  ai_summary: string;
  ai_used: boolean;
  notes: string[];
}

/** Deterministic offline narrative — same input, same text. */
export function offlineSummary(input: SummaryInput): string {
  const s = input.summary;
  const passRate = s.total ? (s.passed / s.total) * 100 : 0;
  const flaky = input.outcomes.filter((o) => o.flaky);
  const failed = input.outcomes.filter((o) => o.final_status === 'failed');
  const blocked = input.outcomes.filter((o) => o.final_status === 'blocked');
  const healed = input.outcomes.filter((o) => o.healing?.applied);

  const lines: string[] = [];

  lines.push(
    `Agent pool menjalankan ${s.total} test case memakai ${input.workers} worker (strategi ${input.strategy}).`,
  );
  lines.push(
    `Hasil: ${s.passed} lulus, ${s.failed} gagal, ${s.blocked} terblokir, ${s.skipped} dilewati — tingkat kelulusan ${passRate.toFixed(1)}%.`,
  );

  if (s.retried || s.flaky) {
    lines.push(
      s.flaky
        ? `Terdapat ${s.flaky} kasus flaky dari ${s.retried} percobaan ulang: lulus pada percobaan berikutnya setelah gagal, ` +
          'sehingga TIDAK dihitung sebagai lulus bersih. Kasus seperti ini adalah kandidat utama untuk diperbaiki stabilitasnya.'
        : `${s.retried} percobaan ulang dijalankan dan seluruhnya mengonfirmasi kegagalan yang sama (bukan flaky).`,
    );
  } else {
    lines.push('Tidak ada percobaan ulang yang perlu dijalankan pada run ini.');
  }

  if (flaky.length && flaky.length <= 8) {
    lines.push(`Kasus flaky: ${flaky.map((o) => `${o.code} (${o.attempts} percobaan)`).join(', ')}.`);
  } else if (flaky.length > 8) {
    lines.push(
      `Kasus flaky: ${flaky.slice(0, 8).map((o) => o.code).join(', ')}, dan ${flaky.length - 8} lainnya.`,
    );
  }

  if (failed.length) {
    const top = failed.slice(0, 5);
    lines.push(
      `Kegagalan yang paling perlu perhatian: ${top
        .map((o) => `${o.code}${o.triage ? ` [${o.triage.severity}]` : ''}`)
        .join(', ')}${failed.length > top.length ? `, dan ${failed.length - top.length} lainnya` : ''}.`,
    );
    const bySeverity = new Map<string, number>();
    for (const o of failed) {
      const sev = o.triage?.severity ?? 'belum ditriase';
      bySeverity.set(sev, (bySeverity.get(sev) ?? 0) + 1);
    }
    lines.push(
      `Distribusi keparahan kegagalan: ${[...bySeverity.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([sev, n]) => `${sev}=${n}`)
        .join(', ')}.`,
    );
  } else if (!blocked.length) {
    lines.push('Tidak ada kegagalan yang tercatat pada run ini.');
  }

  if (blocked.length) {
    lines.push(
      `${blocked.length} kasus terblokir — umumnya karena artefak engine belum tertaut atau environment tidak siap, bukan cacat produk.`,
    );
  }

  if (healed.length) {
    lines.push(
      `Penyembuhan selector berhasil pada ${healed.length} kasus: ` +
        healed
          .slice(0, 5)
          .map((o) => `${o.code} → ${o.healing?.healed_selector ?? '—'}`)
          .join(', ') +
        '. Selector pengganti wajib ditinjau manual sebelum dijadikan permanen.',
    );
  } else if (s.healed === 0 && input.outcomes.some((o) => o.healing)) {
    lines.push('Ada upaya penyembuhan selector, namun tidak ada selector pengganti yang benar-benar dihasilkan.');
  }

  lines.push(
    `Performa: wall-clock ${(s.duration_ms / 1000).toFixed(1)} s versus ${(s.sequential_duration_ms / 1000).toFixed(1)} s ` +
      `bila dijalankan berurutan, sehingga speedup terukur ${s.speedup.toFixed(2)}x dengan ${s.workers_used} worker aktif.` +
      (s.speedup < 1.2 && input.workers > 1
        ? ' Speedup rendah: kasus mungkin terlalu cepat, terikat I/O yang sama, atau jumlah worker melebihi jumlah kasus.'
        : ''),
  );

  if (input.aborted) {
    lines.push(
      'Run dihentikan lebih awal karena ambang abort_after_failures tercapai; sisa shard ditandai aborted dan tidak dijalankan.',
    );
  }

  lines.push(
    input.aiConfigured
      ? `Ringkasan ini disusun oleh model AI aktif (${input.aiProvider}, mode ${input.aiMode}).`
      : 'Ringkasan ini disusun generator offline deterministik QATools (tidak ada provider AI aktif), bukan keluaran model.',
  );

  return lines.join(' ');
}

/**
 * Produces `ai_summary`. Attempts a live model narrative first (Lane D `chat`),
 * and always falls back to the deterministic offline narrative above.
 */
export async function buildAiSummary(input: SummaryInput): Promise<SummaryOutcome> {
  const notes: string[] = [];
  const fallback = offlineSummary(input);

  const ai = await loadAi();
  const generate = ai?.aiService?.generate;

  if (typeof generate !== 'function') {
    notes.push('Modul AI tidak tersedia; ringkasan dibuat deterministik oleh agent pool.');
    return { ai_summary: fallback, ai_used: false, notes };
  }

  if (!input.aiConfigured) {
    notes.push('Tidak ada provider AI aktif; ringkasan dibuat deterministik (bukan klaim keluaran model).');
    return { ai_summary: fallback, ai_used: false, notes };
  }

  try {
    const failedCodes = input.outcomes
      .filter((o) => o.final_status === 'failed')
      .slice(0, 12)
      .map((o) => ({ code: o.code, severity: o.triage?.severity ?? null, error: (o.error ?? '').slice(0, 160) }));

    const raw = (await generate.call(ai?.aiService, 'chat', {
      messages: [
        {
          role: 'system',
          content:
            'Anda QA Lead. Tulis ringkasan eksekusi regresi dalam Bahasa Indonesia, 3-6 kalimat, faktual, tanpa markdown. ' +
            'Sebutkan tingkat kelulusan, kegagalan penting, kasus flaky, dan speedup paralel.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            total: input.summary.total,
            passed: input.summary.passed,
            failed: input.summary.failed,
            blocked: input.summary.blocked,
            skipped: input.summary.skipped,
            flaky: input.summary.flaky,
            healed: input.summary.healed,
            retried: input.summary.retried,
            workers: input.workers,
            strategy: input.strategy,
            duration_ms: input.summary.duration_ms,
            sequential_duration_ms: input.summary.sequential_duration_ms,
            speedup: input.summary.speedup,
            workers_used: input.summary.workers_used,
            aborted: input.aborted,
            failed_samples: failedCodes,
            flaky_codes: input.outcomes.filter((o) => o.flaky).map((o) => o.code),
          }),
        },
      ],
      context: 'Ringkasan run agent pool.',
    })) as {
      ok?: boolean;
      data?: { reply?: string } | null;
      meta?: { used_mock?: boolean };
    };

    if (raw?.ok && raw.meta?.used_mock !== true && typeof raw.data?.reply === 'string' && raw.data.reply.trim()) {
      notes.push('Ringkasan dihasilkan oleh model AI aktif.');
      return { ai_summary: raw.data.reply.trim(), ai_used: true, notes };
    }

    notes.push('Balasan AI tidak dapat dipakai; ringkasan dibuat deterministik oleh agent pool.');
    return { ai_summary: fallback, ai_used: false, notes };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    notes.push(`Panggilan AI untuk ringkasan gagal (${reason.slice(0, 120)}); ringkasan dibuat deterministik.`);
    return { ai_summary: fallback, ai_used: false, notes };
  }
}
