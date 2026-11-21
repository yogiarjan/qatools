/**
 * Learning-progress repository — enrollments, lesson_progress and certificates.
 * Owned by Lane E.
 */

import { db } from '../../db/index.js';

export interface EnrollmentRow {
  id: string;
  course_id: string;
  learner_name: string;
  learner_email: string;
  progress_pct: number;
  started_at: string | null;
  completed_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface LessonProgressRow {
  id: string;
  enrollment_id: string;
  lesson_id: string;
  completed: number;
  completed_at: string | null;
  score: number | null;
}

export interface CertificateRow {
  id: string;
  code: string;
  enrollment_id: string;
  course_id: string;
  learner_name: string;
  course_title: string;
  issued_at: string;
  score: number;
  grade: string;
  verification_hash: string;
  revoked: number;
  revoked_reason: string | null;
}

/* ----------------------------- enrollments ------------------------------ */

export function findEnrollmentByCourseEmail(courseId: string, email: string): EnrollmentRow | undefined {
  return db
    .prepare('SELECT * FROM enrollments WHERE course_id = ? AND learner_email = ?')
    .get(courseId, email) as unknown as EnrollmentRow | undefined;
}

export function findEnrollment(id: string): EnrollmentRow | undefined {
  return db.prepare('SELECT * FROM enrollments WHERE id = ?').get(id) as unknown as EnrollmentRow | undefined;
}

export function listEnrollmentsByEmail(email: string): Array<EnrollmentRow & { course_title: string; course_slug: string; course_icon: string | null; course_pillar: string }> {
  return db
    .prepare(
      `SELECT e.*, c.title AS course_title, c.slug AS course_slug, c.icon AS course_icon, c.pillar AS course_pillar
       FROM enrollments e JOIN courses c ON c.id = e.course_id
       WHERE e.learner_email = ?
       ORDER BY e.updated_at DESC`,
    )
    .all(email) as unknown as Array<
    EnrollmentRow & { course_title: string; course_slug: string; course_icon: string | null; course_pillar: string }
  >;
}

export function insertEnrollment(row: {
  id: string;
  course_id: string;
  learner_name: string;
  learner_email: string;
  started_at: string;
  created_at: string;
  updated_at: string;
}): void {
  db.prepare(
    `INSERT INTO enrollments (id, course_id, learner_name, learner_email, progress_pct,
                              started_at, completed_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, NULL, 'active', ?, ?)`,
  ).run(
    row.id,
    row.course_id,
    row.learner_name,
    row.learner_email,
    row.started_at,
    row.created_at,
    row.updated_at,
  );
}

export function touchEnrollmentName(id: string, learnerName: string, updatedAt: string): void {
  db.prepare('UPDATE enrollments SET learner_name = ?, updated_at = ? WHERE id = ?').run(
    learnerName,
    updatedAt,
    id,
  );
}

/* --------------------------- lesson progress ---------------------------- */

export function listProgress(enrollmentId: string): LessonProgressRow[] {
  return db
    .prepare('SELECT * FROM lesson_progress WHERE enrollment_id = ?')
    .all(enrollmentId) as unknown as LessonProgressRow[];
}

export function findProgress(enrollmentId: string, lessonId: string): LessonProgressRow | undefined {
  return db
    .prepare('SELECT * FROM lesson_progress WHERE enrollment_id = ? AND lesson_id = ?')
    .get(enrollmentId, lessonId) as unknown as LessonProgressRow | undefined;
}

export function upsertProgress(row: {
  id: string;
  enrollment_id: string;
  lesson_id: string;
  completed: number;
  completed_at: string | null;
}): void {
  db.prepare(
    `INSERT INTO lesson_progress (id, enrollment_id, lesson_id, completed, completed_at, score)
     VALUES (?, ?, ?, ?, ?, NULL)
     ON CONFLICT(enrollment_id, lesson_id)
     DO UPDATE SET completed = excluded.completed, completed_at = excluded.completed_at`,
  ).run(row.id, row.enrollment_id, row.lesson_id, row.completed, row.completed_at);
}

/**
 * Counts completed REAL lessons only.
 *
 * `lesson_progress` is the only table keyed by lesson, and quiz attempts live in `quiz_attempts`,
 * so this is a straightforward count — it is kept as a named helper to make the denominator
 * explicit and to keep the JOIN defensive against orphan progress rows.
 */
export function countCompleted(enrollmentId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM lesson_progress lp
       JOIN lessons l ON l.id = lp.lesson_id
       WHERE lp.enrollment_id = ? AND lp.completed = 1`,
    )
    .get(enrollmentId) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/** Applies the recomputed progress and flips status/completed_at at 100%. */
export function applyProgress(
  enrollmentId: string,
  progressPct: number,
  completed: boolean,
  now: string,
): EnrollmentRow | undefined {
  db.prepare(
    `UPDATE enrollments
     SET progress_pct = ?,
         status = ?,
         completed_at = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(progressPct, completed ? 'completed' : 'active', completed ? now : null, now, enrollmentId);
  return findEnrollment(enrollmentId);
}

/* ------------------------------ certificates ---------------------------- */

export function findCertificate(id: string): CertificateRow | undefined {
  return db.prepare('SELECT * FROM certificates WHERE id = ?').get(id) as unknown as CertificateRow | undefined;
}

export function findCertificateByCode(code: string): CertificateRow | undefined {
  return db.prepare('SELECT * FROM certificates WHERE code = ?').get(code) as unknown as CertificateRow | undefined;
}

export function findCertificateByEnrollment(enrollmentId: string): CertificateRow | undefined {
  return db
    .prepare('SELECT * FROM certificates WHERE enrollment_id = ? ORDER BY issued_at DESC LIMIT 1')
    .get(enrollmentId) as unknown as CertificateRow | undefined;
}

export function listCertificatesByEmail(email: string): CertificateRow[] {
  return db
    .prepare(
      `SELECT c.* FROM certificates c
       JOIN enrollments e ON e.id = c.enrollment_id
       WHERE e.learner_email = ?
       ORDER BY c.issued_at DESC`,
    )
    .all(email) as unknown as CertificateRow[];
}

export function insertCertificate(row: CertificateRow): void {
  db.prepare(
    `INSERT INTO certificates (id, code, enrollment_id, course_id, learner_name, course_title,
                               issued_at, score, grade, verification_hash, revoked, revoked_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
  ).run(
    row.id,
    row.code,
    row.enrollment_id,
    row.course_id,
    row.learner_name,
    row.course_title,
    row.issued_at,
    row.score,
    row.grade,
    row.verification_hash,
  );
}

export function revokeCertificate(id: string, reason: string): CertificateRow | undefined {
  db.prepare('UPDATE certificates SET revoked = 1, revoked_reason = ? WHERE id = ?').run(reason, id);
  return findCertificate(id);
}

export function codeExists(code: string): boolean {
  const row = db.prepare('SELECT 1 AS ok FROM certificates WHERE code = ?').get(code) as
    | { ok: number }
    | undefined;
  return Boolean(row);
}

/* --------------------- quiz results (eligibility check) ----------------- */

export interface QuizAttemptRow {
  id: string;
  quiz_id: string;
  enrollment_id: string;
  score: number;
  passed: number;
  answers: string | null;
  submitted_at: string;
}

/**
 * True when the lead-owned `quiz_attempts` table exists.
 * Cached because it cannot change while the process is running.
 */
let attemptsAvailable: boolean | null = null;
export function quizAttemptsAvailable(): boolean {
  if (attemptsAvailable !== null) return attemptsAvailable;
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='quiz_attempts'")
      .get() as { name?: string } | undefined;
    attemptsAvailable = Boolean(row?.name);
  } catch {
    attemptsAvailable = false;
  }
  return attemptsAvailable;
}

/** quiz_id -> best score recorded for this enrollment. */
export function quizAttemptsFor(enrollmentId: string): Map<string, number> {
  const out = new Map<string, number>();
  if (!quizAttemptsAvailable()) return out;
  const rows = db
    .prepare('SELECT quiz_id, score FROM quiz_attempts WHERE enrollment_id = ?')
    .all(enrollmentId) as Array<{ quiz_id: string; score: number }>;
  for (const r of rows) out.set(r.quiz_id, Number(r.score));
  return out;
}

export function upsertQuizAttempt(row: {
  id: string;
  quiz_id: string;
  enrollment_id: string;
  score: number;
  passed: number;
  answers: string | null;
  submitted_at: string;
}): void {
  if (!quizAttemptsAvailable()) return;
  db.prepare(
    `INSERT INTO quiz_attempts (id, quiz_id, enrollment_id, score, passed, answers, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(enrollment_id, quiz_id)
     DO UPDATE SET score = excluded.score, passed = excluded.passed,
                   answers = excluded.answers, submitted_at = excluded.submitted_at`,
  ).run(
    row.id,
    row.quiz_id,
    row.enrollment_id,
    row.score,
    row.passed,
    row.answers,
    row.submitted_at,
  );
}
