/**
 * Courses module — catalog, course tree, lessons and quiz submission.
 * Owned by Lane E (routes: courses, lessons, quizzes, curriculum overview).
 *
 * The answer key (`answer_index`, `explanation`) is NEVER exposed by a read route:
 * it is released only through POST /quizzes/:id/submit, so a learner cannot scrape answers.
 */

import type { FastifyInstance } from 'fastify';
import { CURRICULUM_PILLARS, newId } from '@qatools/shared';
import { db } from '../../db/index.js';
import { badRequest, list, notFound, one } from '../../lib/http.js';
import {
  buildPillarOverview,
  CURRICULUM_PILLS,
  PHOTO_CURRICULUM_ITEMS,
} from '../../seed/curriculum.js';
import {
  findCourse,
  findLesson,
  findQuiz,
  lessonCount,
  listCourses,
  listLessonsForCourse,
  listModules,
  listQuestions,
  listQuizzes,
  quizzesForCourse,
  toPublicQuestion,
  updateLesson,
} from './repo.js';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

interface EnrollJoin {
  progress_pct: number;
  status: string;
}

/** Optional progress overlay so the catalog can show "you are here". */
function progressByCourse(email?: string): Map<string, EnrollJoin> {
  const out = new Map<string, EnrollJoin>();
  if (!email) return out;
  const rows = db
    .prepare('SELECT course_id, progress_pct, status FROM enrollments WHERE learner_email = ?')
    .all(email) as Array<{ course_id: string; progress_pct: number; status: string }>;
  for (const r of rows) out.set(r.course_id, { progress_pct: r.progress_pct, status: r.status });
  return out;
}

function normaliseEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

export default async function routes(app: FastifyInstance): Promise<void> {
  /* --------------------------- GET /courses --------------------------- */
  app.get('/courses', async (req) => {
    const q = req.query as Record<string, unknown>;
    const rows = listCourses({
      pillar: q.pillar ? String(q.pillar) : undefined,
      level: q.level ? String(q.level) : undefined,
    });
    const email = q.email ? normaliseEmail(q.email) : '';
    const progress = progressByCourse(email);
    const data = rows.map((c) => ({
      ...c,
      tags: tagsForPillar(c.pillar),
      progress_pct: progress.get(c.id)?.progress_pct ?? 0,
      enrollment_status: progress.get(c.id)?.status ?? null,
    }));
    return list(data, data.length);
  });

  /* ----------------------- GET /curriculum/overview -------------------- */
  app.get('/curriculum/overview', async () => {
    const rows = listCourses();
    const pillars = buildPillarOverview(
      rows.map((c) => ({
        id: c.id,
        slug: c.slug,
        title: c.title,
        subtitle: c.subtitle,
        level: c.level,
        pillar: c.pillar,
        estimated_minutes: c.estimated_minutes,
        order_index: c.order_index,
        icon: c.icon,
        module_count: c.module_count,
        lesson_count: c.lesson_count,
        quiz_count: c.quiz_count,
      })),
    );
    const totals = {
      courses: rows.length,
      modules: rows.reduce((s, c) => s + c.module_count, 0),
      lessons: rows.reduce((s, c) => s + c.lesson_count, 0),
      labs: rows.reduce((s, c) => s + c.lab_count, 0),
      quizzes: rows.reduce((s, c) => s + c.quiz_count, 0),
      estimated_minutes: rows.reduce((s, c) => s + c.estimated_minutes, 0),
    };
    return one({
      /** The four value pills from the course photo, in photo order. */
      pills: CURRICULUM_PILLS,
      /** The eight curriculum items from the photo, in photo order. */
      photo_items: PHOTO_CURRICULUM_ITEMS,
      /** FROZEN vocabulary — the UI's filter chips come from here, not from local strings. */
      pillars: CURRICULUM_PILLARS,
      totals,
      groups: pillars,
    });
  });

  /* ------------------------- GET /courses/:id ------------------------- */
  app.get('/courses/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const course = findCourse(id);
    if (!course) return notFound(reply, 'Kursus');

    const modules = listModules(course.id);
    const lessons = listLessonsForCourse(course.id);
    const quizzes = quizzesForCourse(course.id);

    const tree = modules.map((m) => ({
      ...m,
      lessons: lessons
        .filter((l) => l.module_id === m.id)
        .map((l) => ({
          id: l.id,
          module_id: l.module_id,
          course_id: l.course_id,
          code: l.code,
          title: l.title,
          kind: l.kind,
          content_md: l.content_md,
          duration_minutes: l.duration_minutes,
          order_index: l.order_index,
          lab_ref: l.lab_ref,
        })),
    }));

    return one({
      ...course,
      tags: tagsForPillar(course.pillar),
      modules: tree,
      // Quiz metadata only — questions (and certainly answers) come from /courses/:id/quizzes.
      quizzes: quizzes.map((qz) => ({ ...qz })),
    });
  });

  /* ---------------------- GET /courses/:id/quizzes -------------------- */
  app.get('/courses/:id/quizzes', async (req, reply) => {
    const { id } = req.params as { id: string };
    const course = findCourse(id);
    if (!course) return notFound(reply, 'Kursus');

    const quizzes = listQuizzes(course.id).map((qz) => ({
      id: qz.id,
      course_id: qz.course_id,
      module_id: qz.module_id,
      title: qz.title,
      pass_score: qz.pass_score,
      time_limit_minutes: qz.time_limit_minutes,
      order_index: qz.order_index,
      questions: listQuestions(qz.id).map(toPublicQuestion),
    }));

    return list(quizzes, quizzes.length);
  });

  /* ------------------------- GET /lessons/:id ------------------------- */
  app.get('/lessons/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lesson = findLesson(id);
    if (!lesson) return notFound(reply, 'Pelajaran');
    return one(lesson);
  });

  /* ------------------------ PATCH /lessons/:id ------------------------ */
  app.patch('/lessons/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const existing = findLesson(id);
    if (!existing) return notFound(reply, 'Pelajaran');

    const kind = body.kind === undefined ? undefined : String(body.kind);
    if (kind !== undefined && !['reading', 'video', 'lab', 'quiz'].includes(kind)) {
      return badRequest(reply, 'kind harus salah satu dari: reading, video, lab, quiz');
    }
    const duration = body.duration_minutes === undefined ? undefined : Number(body.duration_minutes);
    if (duration !== undefined && (!Number.isFinite(duration) || duration < 0)) {
      return badRequest(reply, 'duration_minutes harus angka >= 0');
    }

    const updated = updateLesson(id, {
      title: body.title === undefined ? undefined : String(body.title),
      content_md: body.content_md === undefined ? undefined : String(body.content_md),
      kind,
      duration_minutes: duration,
      lab_ref:
        body.lab_ref === undefined ? undefined : body.lab_ref === null ? null : String(body.lab_ref),
    });
    return one(updated);
  });

  /* ---------------------- POST /quizzes/:id/submit -------------------- */
  app.post('/quizzes/:id/submit', async (req, reply) => {
    const { id } = req.params as { id: string };
    const quiz = findQuiz(id);
    if (!quiz) return notFound(reply, 'Kuis');

    const body = (req.body ?? {}) as { answers?: unknown; enrollment_id?: unknown };
    const answers = Array.isArray(body.answers) ? body.answers : null;
    if (!answers) return badRequest(reply, 'Body harus memuat "answers": array of {question_id, answer_index}');

    const questions = listQuestions(quiz.id);
    if (!questions.length) return badRequest(reply, 'Kuis ini belum memiliki soal');

    /** question_id -> submitted index */
    const submitted = new Map<string, number>();
    for (const raw of answers) {
      const a = raw as { question_id?: unknown; answer_index?: unknown };
      if (!a || typeof a.question_id !== 'string') continue;
      const idx = Number(a.answer_index);
      if (!Number.isInteger(idx)) continue;
      submitted.set(a.question_id, idx);
    }

    let earned = 0;
    let totalPoints = 0;
    const perQuestion = questions.map((q) => {
      totalPoints += q.points;
      const given = submitted.get(q.id);
      const correct = given !== undefined && given === q.answer_index;
      if (correct) earned += q.points;
      return {
        question_id: q.id,
        prompt: q.prompt,
        given_index: given ?? null,
        correct,
        // The answer key is released only here, after submission.
        correct_index: q.answer_index,
        explanation: q.explanation,
        points: q.points,
      };
    });

    const score = totalPoints ? Number(((earned / totalPoints) * 100).toFixed(1)) : 0;
    const passed = score >= quiz.pass_score;

    /*
     * Persist the attempt so POST /enrollments/:id/certificate can later PROVE the quiz was passed.
     * Stored in `quiz_attempts` (one row per enrollment+quiz, upsert on the natural key).
     * Best-effort: if the table is absent the score is still returned to the caller.
     */
    let recorded = false;
    const enrollmentId = body.enrollment_id === undefined ? '' : String(body.enrollment_id).trim();
    if (enrollmentId && quizAttemptsAvailable()) {
      const enrollment = db
        .prepare('SELECT id, course_id FROM enrollments WHERE id = ?')
        .get(enrollmentId) as { id: string; course_id: string } | undefined;
      if (enrollment && enrollment.course_id === quiz.course_id) {
        db.prepare(
          `INSERT INTO quiz_attempts (id, quiz_id, enrollment_id, score, passed, answers, submitted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(enrollment_id, quiz_id)
           DO UPDATE SET score = excluded.score, passed = excluded.passed,
                         answers = excluded.answers, submitted_at = excluded.submitted_at`,
        ).run(
          newId('qat_'),
          quiz.id,
          enrollment.id,
          score,
          passed ? 1 : 0,
          JSON.stringify(perQuestion.map((p) => ({ question_id: p.question_id, given_index: p.given_index }))),
          new Date().toISOString(),
        );
        recorded = true;
      }
    }

    return one({
      quiz_id: quiz.id,
      course_id: quiz.course_id,
      score,
      passed,
      pass_score: quiz.pass_score,
      earned_points: earned,
      total_points: totalPoints,
      answered: submitted.size,
      question_count: questions.length,
      recorded_for_enrollment: recorded,
      per_question: perQuestion,
    });
  });
}

/**
 * True when the `quiz_attempts` table exists.
 *
 * The table is lead-owned DDL; this module degrades cleanly (score is still returned) rather than
 * throwing a 500 if it has not been added to the schema yet.
 */
let quizAttemptsChecked: boolean | null = null;
function quizAttemptsAvailable(): boolean {
  if (quizAttemptsChecked !== null) return quizAttemptsChecked;
  try {
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='quiz_attempts'").get();
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='quiz_attempts'")
      .get() as { name?: string } | undefined;
    quizAttemptsChecked = Boolean(row?.name);
  } catch {
    quizAttemptsChecked = false;
  }
  return quizAttemptsChecked;
}

/** Derived catalog tags — keeps the UI filter row useful without storing free-form data. */
function tagsForPillar(pillar: string): string[] {
  const map: Record<string, string[]> = {
    'QA Introduction': ['peran-qa', 'kualitas', 'sdlc'],
    'QA Test Technique': ['teknik-desain', 'boundary', 'decision-table', 'pairwise'],
    'QA Test Activity': ['test-plan', 'eksekusi', 'defect', 'release-gate'],
    'Basic QA Automation': ['otomasi', 'piramida', 'assertion'],
    'API Automation': ['api', 'http', 'json-schema', 'ci'],
    'Web Automation': ['ui', 'locator', 'page-object', 'flakiness'],
    'Database Testing': ['sql', 'integritas-data', 'transaksi', 'migrasi'],
    'Materi & Praktik': ['capstone', 'praktik', 'end-to-end'],
    'Bangun Portofolio': ['portofolio', 'karier', 'wawancara'],
    'e-Certificate': ['sertifikat', 'verifikasi'],
    'Belajar Online': ['online', 'mandiri'],
  };
  return map[pillar] ?? [];
}

/** Exported for tests: proves no read projection leaks the answer key. */
export function assertNoAnswerKey(payload: unknown): boolean {
  const seen = JSON.stringify(payload ?? null);
  return !seen.includes('answer_index') && !seen.includes('"explanation"');
}
