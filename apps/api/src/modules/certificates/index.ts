/**
 * Certificates module — enrollment, progress, e-Certificate issuance and public verification.
 * Owned by Lane E.
 *
 * Route surface:
 *   POST /enrollments                            idempotent on unique(course_id, learner_email)
 *   GET  /enrollments?email=                     with course metadata
 *   GET  /enrollments/:id                        with lesson progress join
 *   POST /enrollments/:id/progress               upsert + RECOMPUTE progress_pct
 *   POST /enrollments/:id/certificate            issue ONLY if completed AND all quizzes passed
 *   GET  /certificates/:id
 *   GET  /certificates/verify/:code              CertificateVerification
 *   GET  /certificates?email=
 *   POST /certificates/:id/revoke
 *   GET  /certificates/:id/render?format=html    standalone print-ready HTML (no external assets)
 */

import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { newId, nowIso } from '@qatools/shared';
import { db } from '../../db/index.js';
import { badRequest, conflict, fail, list, notFound, one } from '../../lib/http.js';
import {
  applyProgress,
  codeExists,
  countCompleted,
  findCertificate,
  findCertificateByCode,
  findCertificateByEnrollment,
  findEnrollment,
  findEnrollmentByCourseEmail,
  findProgress,
  insertCertificate,
  insertEnrollment,
  listCertificatesByEmail,
  listEnrollmentsByEmail,
  listProgress,
  quizAttemptsFor,
  revokeCertificate,
  touchEnrollmentName,
  upsertProgress,
  upsertQuizAttempt,
  type CertificateRow,
} from './repo.js';

/* ------------------------------------------------------------------ *
 * Pure helpers (exported for tests)
 * ------------------------------------------------------------------ */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** `QAT-<YYYY>-<6 random base32>` — 30 bits of entropy, no ambiguous characters. */
export function generateCode(year = new Date().getUTCFullYear()): string {
  let suffix = '';
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) suffix += BASE32[(bytes[i] as number) % 32];
  return `QAT-${year}-${suffix}`;
}

/** Real SHA-256 over `${code}|${learner_email}|${course_id}|${issued_at}` so tampering is detectable. */
export function verificationHash(input: {
  code: string;
  learner_email: string;
  course_id: string;
  issued_at: string;
}): string {
  return createHash('sha256')
    .update(`${input.code}|${input.learner_email}|${input.course_id}|${input.issued_at}`, 'utf8')
    .digest('hex');
}

export function gradeFor(score: number): 'A' | 'B' | 'C' | 'Pass' {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  return 'Pass';
}

/** Escapes text for safe insertion into the standalone HTML certificate. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normaliseEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function issuer(): { name: string; verifyBase: string } {
  return {
    name: process.env.QATOOLS_ISSUER ?? 'QATools Academy',
    verifyBase: process.env.QATOOLS_VERIFY_BASE ?? 'http://localhost:5173/verify',
  };
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

export default async function routes(app: FastifyInstance): Promise<void> {
  /* ----------------------- GET /certificates?email= ------------------- */
  // Declared before /certificates/:id so "verify" and the collection are not shadowed.
  app.get('/certificates', async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const email = normaliseEmail(q.email);
    if (!email) return badRequest(reply, 'Parameter "email" wajib diisi');
    return list(listCertificatesByEmail(email));
  });

  /* --------------------- GET /certificates/verify/:code --------------- */
  app.get('/certificates/verify/:code', async (req) => {
    const { code } = req.params as { code: string };
    const cert = findCertificateByCode(String(code).trim().toUpperCase());
    return one(verifyCertificate(cert));
  });

  /* ------------------------- GET /certificates/:id -------------------- */
  app.get('/certificates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const cert = findCertificate(id);
    if (!cert) return notFound(reply, 'Sertifikat');
    return one(cert);
  });

  /* -------------------- GET /certificates/:id/render ------------------ */
  app.get('/certificates/:id/render', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as Record<string, unknown>;
    const format = String(q.format ?? 'html').toLowerCase();
    const cert = findCertificate(id);
    if (!cert) return notFound(reply, 'Sertifikat');

    if (format === 'json') return one(cert);
    if (format !== 'html') return badRequest(reply, 'format harus "html" atau "json"');

    const html = renderCertificateHtml(cert);
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    return reply.send(html);
  });

  /* --------------------- POST /certificates/:id/revoke ---------------- */
  app.post('/certificates/:id/revoke', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { reason?: unknown };
    const reason = String(body.reason ?? '').trim();
    if (!reason) return badRequest(reply, 'Alasan pencabutan ("reason") wajib diisi');

    const cert = findCertificate(id);
    if (!cert) return notFound(reply, 'Sertifikat');
    if (cert.revoked) return conflict(reply, 'Sertifikat ini sudah dicabut sebelumnya');

    return one(revokeCertificate(id, reason));
  });

  /* --------------------------- POST /enrollments ---------------------- */
  app.post('/enrollments', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const courseId = String(body.course_id ?? '').trim();
    const learnerName = String(body.learner_name ?? '').trim();
    const email = normaliseEmail(body.learner_email);

    if (!courseId) return badRequest(reply, 'course_id wajib diisi');
    if (!learnerName) return badRequest(reply, 'learner_name wajib diisi');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return badRequest(reply, 'learner_email tidak valid');
    }

    const course = db.prepare('SELECT id, title FROM courses WHERE id = ? OR slug = ?').get(courseId, courseId) as
      | { id: string; title: string }
      | undefined;
    if (!course) return notFound(reply, 'Kursus');

    // Idempotent on the schema's UNIQUE(course_id, learner_email).
    const existing = findEnrollmentByCourseEmail(course.id, email);
    if (existing) {
      if (existing.learner_name !== learnerName) touchEnrollmentName(existing.id, learnerName, nowIso());
      const refreshed = findEnrollment(existing.id) as typeof existing;
      return reply.code(200).send({ data: refreshed });
    }

    const ts = nowIso();
    const id = newId('enr_');
    insertEnrollment({
      id,
      course_id: course.id,
      learner_name: learnerName,
      learner_email: email,
      started_at: ts,
      created_at: ts,
      updated_at: ts,
    });
    return reply.code(201).send({ data: findEnrollment(id) });
  });

  /* --------------------------- GET /enrollments ----------------------- */
  app.get('/enrollments', async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const email = normaliseEmail(q.email);
    if (!email) return badRequest(reply, 'Parameter "email" wajib diisi');

    const rows = listEnrollmentsByEmail(email).map((e) => ({
      ...e,
      certificate: findCertificateByEnrollment(e.id) ?? null,
      total_lessons: lessonCount(e.course_id),
    }));
    return list(rows);
  });

  /* ------------------------- GET /enrollments/:id --------------------- */
  app.get('/enrollments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const enrollment = findEnrollment(id);
    if (!enrollment) return notFound(reply, 'Enrollment');

    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(enrollment.course_id) as Record<
      string,
      unknown
    > | undefined;
    const total = lessonCount(enrollment.course_id);
    const progress = listProgress(enrollment.id);
    const byLesson = new Map(progress.map((p) => [p.lesson_id, p]));

    const lessons = db
      .prepare(
        `SELECT l.id, l.code, l.title, l.kind, l.order_index, l.duration_minutes, l.lab_ref, l.module_id,
                m.title AS module_title, m.code AS module_code
         FROM lessons l JOIN course_modules m ON m.id = l.module_id
         WHERE l.course_id = ? ORDER BY m.order_index, l.order_index`,
      )
      .all(enrollment.course_id) as Array<Record<string, unknown>>;

    return one({
      ...enrollment,
      course_title: course?.title ?? null,
      course_slug: course?.slug ?? null,
      course_icon: course?.icon ?? null,
      total_lessons: total,
      completed_lessons: countCompleted(enrollment.id),
      certificate: findCertificateByEnrollment(enrollment.id) ?? null,
      lessons: lessons.map((l) => {
        const p = byLesson.get(String(l.id));
        return {
          ...l,
          completed: p?.completed ?? 0,
          completed_at: p?.completed_at ?? null,
          score: p?.score ?? null,
        };
      }),
    });
  });

  /* ------------------- POST /enrollments/:id/progress ----------------- */
  app.post('/enrollments/:id/progress', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;

    const enrollment = findEnrollment(id);
    if (!enrollment) return notFound(reply, 'Enrollment');

    const lessonId = String(body.lesson_id ?? '').trim();
    if (!lessonId) return badRequest(reply, 'lesson_id wajib diisi');

    const lesson = db.prepare('SELECT id, course_id FROM lessons WHERE id = ?').get(lessonId) as
      | { id: string; course_id: string }
      | undefined;
    if (!lesson) return notFound(reply, 'Pelajaran');
    if (lesson.course_id !== enrollment.course_id) {
      return badRequest(reply, 'Pelajaran tersebut bukan bagian dari kursus enrollment ini');
    }

    const completed = body.completed === false || body.completed === 0 ? 0 : 1;
    const now = nowIso();

    const result = db.transaction(() => {
      const existing = findProgress(enrollment.id, lessonId);
      upsertProgress({
        id: existing?.id ?? newId('lp_'),
        enrollment_id: enrollment.id,
        lesson_id: lessonId,
        completed,
        completed_at: completed ? now : null,
      });

      // A submitted quiz also records its score on lesson_progress so eligibility is provable later.
      const score = body.score === undefined || body.score === null ? undefined : Number(body.score);
      const quizId = body.quiz_id === undefined ? null : String(body.quiz_id);
      if (score !== undefined && Number.isFinite(score) && quizId) {
        upsertQuizAttempt({
          id: newId('qat_'),
          quiz_id: quizId,
          enrollment_id: enrollment.id,
          score,
          passed: body.passed === true || score >= Number(body.pass_score ?? 70) ? 1 : 0,
          answers: null,
          submitted_at: now,
        });
      }

      const total = lessonCount(enrollment.course_id);
      const done = countCompleted(enrollment.id);
      const pct = total ? Number(((done / total) * 100).toFixed(2)) : 0;
      const updated = applyProgress(enrollment.id, pct, total > 0 && done >= total, now);
      return { updated, total, done, pct };
    });

    return one({
      enrollment: result.updated,
      lesson_id: lessonId,
      completed,
      completed_lessons: result.done,
      total_lessons: result.total,
      progress_pct: result.pct,
    });
  });

  /* ------------------ POST /enrollments/:id/certificate --------------- */
  app.post('/enrollments/:id/certificate', async (req, reply) => {
    const { id } = req.params as { id: string };
    const enrollment = findEnrollment(id);
    if (!enrollment) return notFound(reply, 'Enrollment');

    // Already issued? Return it rather than minting a duplicate.
    const existing = findCertificateByEnrollment(enrollment.id);
    if (existing) return reply.code(200).send({ data: existing });

    const course = db.prepare('SELECT id, title FROM courses WHERE id = ?').get(enrollment.course_id) as
      | { id: string; title: string }
      | undefined;
    if (!course) return notFound(reply, 'Kursus');

    /* ---- gate 1: enrollment must be 100% complete ---- */
    const total = lessonCount(enrollment.course_id);
    const done = countCompleted(enrollment.id);
    if (total === 0 || done < total) {
      return conflict(
        reply,
        `Sertifikat belum bisa diterbitkan: progres kursus baru ${done}/${total} pelajaran (${enrollment.progress_pct}%). ` +
          'Selesaikan seluruh pelajaran terlebih dahulu.',
      );
    }

    /* ---- gate 2: every quiz in the course must be passed ---- */
    const quizzes = db
      .prepare('SELECT id, title, pass_score FROM quizzes WHERE course_id = ? ORDER BY order_index')
      .all(enrollment.course_id) as Array<{ id: string; title: string; pass_score: number }>;

    const attempts = quizAttemptsFor(enrollment.id);

    const unmet: string[] = [];
    const quizScores: number[] = [];
    for (const quiz of quizzes) {
      const recorded = attempts.get(quiz.id);
      if (recorded === undefined) {
        unmet.push(`kuis "${quiz.title}" belum dikerjakan`);
        continue;
      }
      if (recorded < quiz.pass_score) {
        unmet.push(`kuis "${quiz.title}" belum lulus (skor ${recorded}, minimal ${quiz.pass_score})`);
        continue;
      }
      quizScores.push(recorded);
    }

    if (unmet.length) {
      return conflict(reply, `Sertifikat belum bisa diterbitkan: ${unmet.join('; ')}.`);
    }

    const score = quizScores.length
      ? Number((quizScores.reduce((a, b) => a + b, 0) / quizScores.length).toFixed(2))
      : 100;

    const issuedAt = nowIso();
    const code = uniqueCode();
    const cert: CertificateRow = {
      id: newId('cert_'),
      code,
      enrollment_id: enrollment.id,
      course_id: enrollment.course_id,
      learner_name: enrollment.learner_name,
      course_title: course.title,
      issued_at: issuedAt,
      score,
      grade: gradeFor(score),
      verification_hash: verificationHash({
        code,
        learner_email: enrollment.learner_email,
        course_id: enrollment.course_id,
        issued_at: issuedAt,
      }),
      revoked: 0,
      revoked_reason: null,
    };
    insertCertificate(cert);

    const created = findCertificate(cert.id) as CertificateRow;
    return reply.code(201).send({ data: created });
  });
}

/* ------------------------------------------------------------------ *
 * Internal helpers
 * ------------------------------------------------------------------ */

function lessonCount(courseId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE course_id = ?').get(courseId) as
    | { n: number }
    | undefined;
  return Number(row?.n ?? 0);
}

function uniqueCode(): string {
  for (let i = 0; i < 12; i++) {
    const candidate = generateCode();
    if (!codeExists(candidate)) return candidate;
  }
  // Practically unreachable; keeps the UNIQUE(code) constraint safe.
  return `QAT-${new Date().getUTCFullYear()}-${randomBytes(6).toString('hex').slice(0, 6).toUpperCase()}`;
}

/** A certificate whose stored hash no longer matches its own fields has been tampered with. */
export function verifyCertificate(cert: CertificateRow | undefined): {
  valid: boolean;
  certificate?: CertificateRow;
  reason?: string;
  learner_name?: string;
  course_title?: string;
  issued_at?: string;
} {
  if (!cert) {
    return { valid: false, reason: 'Kode sertifikat tidak ditemukan. Periksa kembali penulisannya.' };
  }

  const enrollment = findEnrollment(cert.enrollment_id);
  const expected = verificationHash({
    code: cert.code,
    learner_email: enrollment?.learner_email ?? '',
    course_id: cert.course_id,
    issued_at: cert.issued_at,
  });

  if (enrollment && expected !== cert.verification_hash) {
    return {
      valid: false,
      certificate: cert,
      reason:
        'Data sertifikat tidak cocok dengan sidik verifikasinya. Sertifikat ini kemungkinan telah diubah.',
      learner_name: cert.learner_name,
      course_title: cert.course_title,
      issued_at: cert.issued_at,
    };
  }

  if (cert.revoked) {
    return {
      valid: false,
      certificate: cert,
      reason: `Sertifikat ini telah dicabut${cert.revoked_reason ? `: ${cert.revoked_reason}` : '.'}`,
      learner_name: cert.learner_name,
      course_title: cert.course_title,
      issued_at: cert.issued_at,
    };
  }

  return {
    valid: true,
    certificate: cert,
    learner_name: cert.learner_name,
    course_title: cert.course_title,
    issued_at: cert.issued_at,
  };
}

/** Standalone, print-ready certificate. Inline CSS only — no external assets, no PDF library. */
export function renderCertificateHtml(cert: CertificateRow): string {
  const { name: issuerName, verifyBase } = issuer();
  const verifyUrl = `${verifyBase.replace(/\/$/, '')}/${encodeURIComponent(cert.code)}`;
  const issued = new Date(cert.issued_at);
  const issuedLabel = Number.isNaN(issued.getTime())
    ? cert.issued_at
    : issued.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  const revokedBanner = cert.revoked
    ? `<div class="revoked">SERTIFIKAT DICABUT${cert.revoked_reason ? ` — ${escapeHtml(cert.revoked_reason)}` : ''}</div>`
    : '';

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sertifikat ${escapeHtml(cert.code)} — ${escapeHtml(cert.learner_name)}</title>
<style>
  :root { --accent:#7c3aed; --accent-2:#db2777; --ink:#1f2430; --dim:#5b6472; --line:#e4e7ee; }
  * { box-sizing:border-box; }
  body { margin:0; padding:32px 16px; background:#f5f6fa; color:var(--ink);
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .sheet { max-width:920px; margin:0 auto; background:#fff; border-radius:18px; overflow:hidden;
           box-shadow:0 18px 50px rgba(24,28,40,.14); }
  .band { height:10px; background:linear-gradient(90deg,var(--accent),var(--accent-2)); }
  .inner { padding:46px 52px 40px; }
  .brand { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
  .logo { width:52px; height:52px; border-radius:14px; background:linear-gradient(135deg,var(--accent),var(--accent-2));
          color:#fff; font-weight:800; font-size:26px; display:flex; align-items:center; justify-content:center; }
  .issuer { font-size:13px; color:var(--dim); text-align:right; line-height:1.5; }
  .issuer b { display:block; color:var(--ink); font-size:15px; }
  h1 { font-size:15px; letter-spacing:.22em; text-transform:uppercase; color:var(--dim);
       margin:34px 0 6px; font-weight:700; }
  .code-line { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:13px; color:var(--accent); }
  .learner { font-size:44px; line-height:1.15; margin:14px 0 10px; font-weight:800; letter-spacing:-.01em; }
  .lead { color:var(--dim); font-size:15px; }
  .course { font-size:27px; font-weight:700; margin:16px 0 6px; line-height:1.3; }
  .metabar { display:flex; flex-wrap:wrap; gap:26px; margin:30px 0 8px; padding-top:22px; border-top:1px solid var(--line); }
  .meta .k { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--dim); }
  .meta .v { font-size:15px; font-weight:600; margin-top:3px; }
  .grade { display:inline-block; padding:5px 14px; border-radius:999px; color:#fff; font-weight:700;
           background:linear-gradient(135deg,var(--accent),var(--accent-2)); }
  .hashbox { margin-top:26px; padding:16px 18px; border:1px solid var(--line); border-radius:12px; background:#fafaff; }
  .hashbox .k { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--dim); margin-bottom:6px; }
  .hashbox code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px;
                  word-break:break-all; color:var(--ink); }
  .foot { margin-top:22px; font-size:12px; color:var(--dim); line-height:1.7; }
  .foot a { color:var(--accent); }
  .revoked { margin:0 52px; padding:12px 16px; border-radius:10px; background:#fee2e2; color:#991b1b;
             font-weight:700; font-size:13px; letter-spacing:.06em; }
  @media print {
    body { background:#fff; padding:0; }
    .sheet { box-shadow:none; border-radius:0; max-width:none; }
    .noprint { display:none; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="band"></div>
    ${revokedBanner}
    <div class="inner">
      <div class="brand">
        <div class="logo">Q</div>
        <div class="issuer">
          <b>${escapeHtml(issuerName)}</b>
          Sertifikat Kompetensi Quality Assurance<br />
          Diterbitkan secara elektronik
        </div>
      </div>

      <h1>Sertifikat Penyelesaian</h1>
      <div class="code-line">Kode: ${escapeHtml(cert.code)}</div>

      <div class="learner">${escapeHtml(cert.learner_name)}</div>
      <p class="lead">telah menyelesaikan seluruh materi dan kuis pada kursus</p>
      <div class="course">${escapeHtml(cert.course_title)}</div>

      <div class="metabar">
        <div class="meta"><div class="k">Tanggal terbit</div><div class="v">${escapeHtml(issuedLabel)}</div></div>
        <div class="meta"><div class="k">Skor rata-rata kuis</div><div class="v">${cert.score}</div></div>
        <div class="meta"><div class="k">Grade</div><div class="v"><span class="grade">${escapeHtml(cert.grade)}</span></div></div>
      </div>

      <div class="hashbox">
        <div class="k">Sidik verifikasi (SHA-256)</div>
        <code>${escapeHtml(cert.verification_hash)}</code>
      </div>

      <p class="foot">
        Verifikasi keaslian sertifikat ini di <a href="${escapeHtml(verifyUrl)}">${escapeHtml(verifyUrl)}</a>.<br />
        Sidik verifikasi dihitung dari kode, email peserta, id kursus, dan waktu terbit. Perubahan pada salah
        satu data tersebut akan membuat verifikasi gagal.
      </p>
      <p class="foot noprint">Gunakan Ctrl/Cmd + P untuk menyimpan sebagai PDF.</p>
    </div>
  </div>
</body>
</html>`;
}

export { fail };
