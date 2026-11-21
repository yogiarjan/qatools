/**
 * Lane E tests — learning platform & e-Certificate.
 *
 * Run:
 *   node --test --import <repo>/apps/api/node_modules/tsx/dist/loader.mjs apps/api/test/lane-e.test.ts
 *
 * Uses an isolated database per process (QATOOLS_DB), so it never touches the dev database.
 * The DB path must be set BEFORE importing anything that opens it.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

/* ---- isolate the database before any module that opens a connection ---- */
const scratch = mkdtempSync(resolve(tmpdir(), 'qatools-lane-e-'));
process.env.QATOOLS_DB = resolve(scratch, 'lane-e.db');

const { db, migrate } = await import('../src/db/index.js');
const { seedCurriculum, curriculumTotals } = await import('../src/seed/curriculum-seed.js');
const { SEED_CURRICULUM, validateCurriculum, countCurriculum } = await import('../src/seed/curriculum.js');
const { buildApp } = await import('../src/server.js');
const { verificationHash, generateCode, gradeFor, escapeHtml } = await import(
  '../src/modules/certificates/index.js'
);
const { renderMarkdown, escapeHtml: mdEscape } = await import(
  '../../web/src/features/learn/markdown.js'
);

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

let app: Awaited<ReturnType<typeof buildApp>>;

interface Res<T> {
  status: number;
  body: T;
}

async function call<T = Record<string, unknown>>(
  method: string,
  url: string,
  payload?: unknown,
): Promise<Res<T>> {
  const res = await app.inject({
    method: method as 'GET' | 'POST' | 'PATCH',
    url,
    payload: payload as never,
  });
  let body: unknown = null;
  try {
    body = res.json();
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body: body as T };
}

/** Completes every lesson of an enrollment, in order. */
async function completeAllLessons(enrollmentId: string): Promise<void> {
  const detail = await call<{ data: { lessons: Array<{ id: string }> } }>(
    'GET',
    `/api/enrollments/${enrollmentId}`,
  );
  for (const lesson of detail.body.data.lessons) {
    const res = await call('POST', `/api/enrollments/${enrollmentId}/progress`, {
      lesson_id: lesson.id,
      completed: true,
    });
    assert.equal(res.status, 200, `progress for ${lesson.id} should be 200`);
  }
}

/** Submits a quiz with every answer correct, discovered through the released key. */
async function passQuiz(quizId: string, enrollmentId: string): Promise<number> {
  const quizzes = await call<{ data: Array<{ id: string; questions: Array<{ id: string }> }> }>(
    'GET',
    `/api/courses/${courseIdForQuiz(quizId)}/quizzes`,
  );
  const quiz = quizzes.body.data.find((q) => q.id === quizId);
  assert.ok(quiz, 'quiz must be listed');

  // First pass reveals the key (the read route never does).
  const probe = await call<{
    data: { per_question: Array<{ question_id: string; correct_index: number }> };
  }>('POST', `/api/quizzes/${quizId}/submit`, {
    answers: quiz.questions.map((q) => ({ question_id: q.id, answer_index: -1 })),
    enrollment_id: enrollmentId,
  });
  assert.equal(probe.status, 200);

  const key = new Map(probe.body.data.per_question.map((p) => [p.question_id, p.correct_index]));
  const res = await call<{ data: { score: number; passed: boolean } }>(
    'POST',
    `/api/quizzes/${quizId}/submit`,
    {
      answers: quiz.questions.map((q) => ({
        question_id: q.id,
        answer_index: key.get(q.id) ?? 0,
      })),
      enrollment_id: enrollmentId,
    },
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.data.passed, true, 'quiz should be passed with the released key');
  return res.body.data.score;
}

function courseIdForQuiz(quizId: string): string {
  const row = db.prepare('SELECT course_id FROM quizzes WHERE id = ?').get(quizId) as
    | { course_id: string }
    | undefined;
  assert.ok(row, `quiz ${quizId} must exist`);
  return row.course_id;
}

/* ------------------------------------------------------------------ *
 * lifecycle
 * ------------------------------------------------------------------ */

before(async () => {
  migrate();
  app = await buildApp();
  await app.ready();
});

after(async () => {
  await app?.close();
  rmSync(scratch, { recursive: true, force: true });
});

/* ================================================================== *
 * 1 — curriculum content & seeding
 * ================================================================== */

describe('curriculum content', () => {
  test('authored content passes its own validator', () => {
    const problems = validateCurriculum(SEED_CURRICULUM);
    assert.deepEqual(problems, [], `content problems: ${problems.join('; ')}`);
  });

  test('every course has 3–5 modules, 3–6 lessons per module and a quiz with 4+ questions', () => {
    assert.equal(SEED_CURRICULUM.length, 9, 'nine courses');
    for (const course of SEED_CURRICULUM) {
      assert.ok(
        course.modules.length >= 3 && course.modules.length <= 5,
        `${course.slug}: ${course.modules.length} modules`,
      );
      for (const mod of course.modules) {
        assert.ok(
          mod.lessons.length >= 3 && mod.lessons.length <= 6,
          `${mod.code}: ${mod.lessons.length} lessons`,
        );
      }
      assert.ok(course.quizzes.length >= 1, `${course.slug} needs a quiz`);
      const questions = course.quizzes.flatMap((q) => q.questions);
      assert.ok(questions.length >= 4, `${course.slug}: ${questions.length} questions`);
      for (const q of questions) {
        assert.ok(q.answer_index >= 0 && q.answer_index < q.options.length, 'answer_index in range');
        assert.ok((q.explanation ?? '').length > 10, 'question has an explanation');
      }
    }
  });

  test('every photo curriculum item is covered by a course pillar', () => {
    const pillars = new Set(SEED_CURRICULUM.map((c) => c.pillar));
    for (const item of [
      'QA Introduction',
      'QA Test Technique',
      'QA Test Activity',
      'Basic QA Automation',
      'API Automation',
      'Web Automation',
      'Database Testing',
    ]) {
      assert.ok(pillars.has(item), `missing course for pillar ${item}`);
    }
    // "dan masih banyak lagi" → the two extra tracks.
    assert.ok(pillars.has('Materi & Praktik'), 'capstone course present');
    assert.ok(pillars.has('Bangun Portofolio'), 'portfolio course present');
  });

  test('lab deep links point at real QATools routes', () => {
    const known = new Set([
      '/requirements',
      '/usecases',
      '/scenarios',
      '/testcases',
      '/matrix',
      '/cycles',
      '/runs',
      '/execute',
      '/api-tester',
      '/db-tester',
      '/web-tester',
      '/defects',
      '/regression',
      '/metrics',
      '/certificate',
      '/verify',
    ]);
    let labs = 0;
    for (const course of SEED_CURRICULUM) {
      for (const mod of course.modules) {
        for (const lesson of mod.lessons) {
          if (!lesson.lab_ref) continue;
          labs += 1;
          assert.ok(known.has(lesson.lab_ref), `unknown lab_ref ${lesson.lab_ref}`);
        }
      }
    }
    assert.ok(labs >= 60, `expected many lab deep links, found ${labs}`);
  });
});

describe('seedCurriculum idempotency', () => {
  test('first run inserts the whole curriculum', () => {
    const first = seedCurriculum({ quiet: true });
    const authored = countCurriculum();
    assert.equal(first.courses, 9);
    assert.equal(first.inserted.courses, 9);
    assert.equal(first.totals.courses, 9);
    assert.equal(first.totals.modules, authored.modules);
    assert.equal(first.totals.lessons, authored.lessons);
    assert.equal(first.totals.quizzes, authored.quizzes);
    assert.equal(first.totals.questions, authored.questions);
  });

  test('second run inserts nothing and yields identical counts', () => {
    const beforeRun = curriculumTotals();
    const second = seedCurriculum({ quiet: true });

    assert.equal(second.inserted.courses, 0, 'no new courses');
    assert.equal(second.inserted.modules, 0, 'no new modules');
    assert.equal(second.inserted.lessons, 0, 'no new lessons');
    assert.equal(second.inserted.quizzes, 0, 'no new quizzes');
    assert.equal(second.inserted.questions, 0, 'no new questions');
    assert.deepEqual(second.totals, beforeRun, 'stored totals unchanged');
  });

  test('no duplicate natural keys exist after repeated seeding', () => {
    const dupCourses = db
      .prepare('SELECT slug, COUNT(*) AS n FROM courses GROUP BY slug HAVING n > 1')
      .all() as unknown[];
    assert.equal(dupCourses.length, 0, 'no duplicate course slugs');

    const dupModules = db
      .prepare('SELECT course_id, code, COUNT(*) AS n FROM course_modules GROUP BY course_id, code HAVING n > 1')
      .all() as unknown[];
    assert.equal(dupModules.length, 0, 'no duplicate module codes per course');

    const dupLessons = db
      .prepare('SELECT course_id, code, COUNT(*) AS n FROM lessons GROUP BY course_id, code HAVING n > 1')
      .all() as unknown[];
    assert.equal(dupLessons.length, 0, 'no duplicate lesson codes per course');

    const dupQuestions = db
      .prepare('SELECT quiz_id, prompt, COUNT(*) AS n FROM quiz_questions GROUP BY quiz_id, prompt HAVING n > 1')
      .all() as unknown[];
    assert.equal(dupQuestions.length, 0, 'no duplicate question prompts per quiz');
  });
});

/* ================================================================== *
 * 2 — catalog & answer-key leakage
 * ================================================================== */

describe('courses API', () => {
  test('GET /api/courses lists all courses with module and lesson counts', async () => {
    const res = await call<{ data: Array<Record<string, unknown>>; total: number }>('GET', '/api/courses');
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 9);
    for (const c of res.body.data) {
      assert.ok(Number(c.module_count) >= 3, `${c.slug} module_count`);
      assert.ok(Number(c.lesson_count) >= 9, `${c.slug} lesson_count`);
    }
  });

  test('GET /api/courses?pillar= filters by pillar', async () => {
    const res = await call<{ data: Array<{ pillar: string }> }>(
      'GET',
      '/api/courses?pillar=API%20Automation',
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 1);
    assert.ok(res.body.data.every((c) => c.pillar === 'API Automation'));
  });

  test('GET /api/curriculum/overview maps the four pills and every pillar', async () => {
    const res = await call<{
      data: { pills: string[]; totals: Record<string, number>; groups: Array<{ pillar: string }> };
    }>('GET', '/api/curriculum/overview');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.pills, [
      'e-Certificate',
      'Materi & Praktik',
      'Belajar Online',
      'Bangun Portofolio',
    ]);
    assert.equal(res.body.data.totals.courses, 9);
    assert.ok(res.body.data.totals.labs >= 60);
    const pillars = res.body.data.groups.map((g) => g.pillar);
    for (const p of [
      'QA Introduction',
      'QA Test Technique',
      'QA Test Activity',
      'Basic QA Automation',
      'API Automation',
      'Web Automation',
      'Database Testing',
      'Materi & Praktik',
      'Bangun Portofolio',
    ]) {
      assert.ok(pillars.includes(p), `overview missing pillar ${p}`);
    }
  });

  test('GET /api/courses/:id returns the full tree with lesson content', async () => {
    const list = await call<{ data: Array<{ id: string }> }>('GET', '/api/courses');
    const id = list.body.data[0].id;
    const res = await call<{
      data: { modules: Array<{ lessons: Array<{ content_md: string }> }> };
    }>('GET', `/api/courses/${id}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.modules.length >= 3);
    const totalLessons = res.body.data.modules.reduce((s, m) => s + m.lessons.length, 0);
    assert.ok(totalLessons >= 9);
    for (const m of res.body.data.modules) {
      for (const l of m.lessons) {
        assert.ok(l.content_md.length > 500, 'lesson content is substantive');
      }
    }
  });

  test('GET /api/courses/:id/quizzes NEVER leaks answer_index or explanation', async () => {
    const list = await call<{ data: Array<{ id: string }> }>('GET', '/api/courses');
    for (const course of list.body.data) {
      const res = await call('GET', `/api/courses/${course.id}/quizzes`);
      assert.equal(res.status, 200);
      const raw = JSON.stringify(res.body);
      assert.ok(!raw.includes('answer_index'), `answer_index leaked for ${course.id}`);
      assert.ok(!raw.includes('"explanation"'), `explanation leaked for ${course.id}`);
      // The questions themselves must still be present.
      const quizzes = (res.body as { data: Array<{ questions: unknown[] }> }).data;
      for (const q of quizzes) assert.ok(q.questions.length >= 4);
    }
  });

  test('POST /api/quizzes/:id/submit releases the key only after submission', async () => {
    const list = await call<{ data: Array<{ id: string }> }>('GET', '/api/courses');
    const quizzes = await call<{ data: Array<{ id: string; questions: Array<{ id: string }> }> }>(
      'GET',
      `/api/courses/${list.body.data[0].id}/quizzes`,
    );
    const quiz = quizzes.body.data[0];
    const res = await call<{
      data: { score: number; passed: boolean; per_question: Array<Record<string, unknown>> };
    }>('POST', `/api/quizzes/${quiz.id}/submit`, {
      answers: quiz.questions.map((q) => ({ question_id: q.id, answer_index: 0 })),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.per_question.length, quiz.questions.length);
    for (const p of res.body.data.per_question) {
      assert.ok('correct_index' in p, 'correct_index released');
      assert.ok('explanation' in p, 'explanation released');
      assert.ok('correct' in p, 'correct flag present');
    }
  });

  test('POST /api/quizzes/:id/submit scores correctly', async () => {
    const list = await call<{ data: Array<{ id: string }> }>('GET', '/api/courses');
    const quizzes = await call<{ data: Array<{ id: string; questions: Array<{ id: string }> }> }>(
      'GET',
      `/api/courses/${list.body.data[0].id}/quizzes`,
    );
    const quiz = quizzes.body.data[0];

    const wrong = await call<{ data: { score: number; passed: boolean } }>(
      'POST',
      `/api/quizzes/${quiz.id}/submit`,
      { answers: quiz.questions.map((q) => ({ question_id: q.id, answer_index: -1 })) },
    );
    assert.equal(wrong.body.data.score, 0);
    assert.equal(wrong.body.data.passed, false);

    const probe = await call<{
      data: { per_question: Array<{ question_id: string; correct_index: number }> };
    }>('POST', `/api/quizzes/${quiz.id}/submit`, {
      answers: quiz.questions.map((q) => ({ question_id: q.id, answer_index: -1 })),
    });
    const key = new Map(probe.body.data.per_question.map((p) => [p.question_id, p.correct_index]));
    const right = await call<{ data: { score: number; passed: boolean } }>(
      'POST',
      `/api/quizzes/${quiz.id}/submit`,
      {
        answers: quiz.questions.map((q) => ({
          question_id: q.id,
          answer_index: key.get(q.id) ?? 0,
        })),
      },
    );
    assert.equal(right.body.data.score, 100);
    assert.equal(right.body.data.passed, true);
  });

  test('PATCH /api/lessons/:id updates a lesson and rejects invalid kind', async () => {
    const list = await call<{ data: Array<{ id: string }> }>('GET', '/api/courses');
    const detail = await call<{ data: { modules: Array<{ lessons: Array<{ id: string }> }> } }>(
      'GET',
      `/api/courses/${list.body.data[0].id}`,
    );
    const lessonId = detail.body.data.modules[0].lessons[0].id;

    const ok = await call<{ data: { title: string; duration_minutes: number } }>(
      'PATCH',
      `/api/lessons/${lessonId}`,
      { duration_minutes: 42 },
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.duration_minutes, 42);

    const bad = await call('PATCH', `/api/lessons/${lessonId}`, { kind: 'nonsense' });
    assert.equal(bad.status, 400);
  });
});

/* ================================================================== *
 * 3 — enrollment & progress
 * ================================================================== */

describe('enrollment & progress', () => {
  test('POST /api/enrollments is idempotent on (course_id, learner_email)', async () => {
    const list = await call<{ data: Array<{ id: string }> }>('GET', '/api/courses');
    const courseId = list.body.data[0].id;
    const email = `idem-${Date.now()}@contoh.id`;

    const first = await call<{ data: { id: string } }>('POST', '/api/enrollments', {
      course_id: courseId,
      learner_name: 'Uji Idempoten',
      learner_email: email,
    });
    assert.equal(first.status, 201);

    const second = await call<{ data: { id: string } }>('POST', '/api/enrollments', {
      course_id: courseId,
      learner_name: 'Uji Idempoten',
      learner_email: email,
    });
    assert.equal(second.status, 200, 'second enrollment returns 200, not 201');
    assert.equal(second.body.data.id, first.body.data.id, 'same enrollment row reused');

    const count = db
      .prepare('SELECT COUNT(*) AS n FROM enrollments WHERE course_id = ? AND learner_email = ?')
      .get(courseId, email) as { n: number };
    assert.equal(Number(count.n), 1, 'exactly one enrollment row');
  });

  test('progress recomputes to 100% and flips status to completed', async () => {
    const list = await call<{ data: Array<{ id: string }> }>('GET', '/api/courses');
    const courseId = list.body.data[0].id;
    const created = await call<{ data: { id: string } }>('POST', '/api/enrollments', {
      course_id: courseId,
      learner_name: 'Uji Progres',
      learner_email: `progress-${Date.now()}@contoh.id`,
    });
    const enrollmentId = created.body.data.id;

    const start = await call<{ data: { progress_pct: number; status: string } }>(
      'GET',
      `/api/enrollments/${enrollmentId}`,
    );
    assert.equal(start.body.data.progress_pct, 0);
    assert.equal(start.body.data.status, 'active');

    await completeAllLessons(enrollmentId);

    const done = await call<{
      data: { progress_pct: number; status: string; completed_at: string | null; completed_lessons: number; total_lessons: number };
    }>('GET', `/api/enrollments/${enrollmentId}`);
    assert.equal(done.body.data.progress_pct, 100, 'progress reaches 100');
    assert.equal(done.body.data.status, 'completed', 'status flips to completed');
    assert.ok(done.body.data.completed_at, 'completed_at is set');
    assert.equal(done.body.data.completed_lessons, done.body.data.total_lessons);
  });

  test('partial progress recomputes proportionally and un-completing works', async () => {
    const list = await call<{ data: Array<{ id: string }> }>('GET', '/api/courses');
    const courseId = list.body.data[0].id;
    const created = await call<{ data: { id: string } }>('POST', '/api/enrollments', {
      course_id: courseId,
      learner_name: 'Uji Sebagian',
      learner_email: `partial-${Date.now()}@contoh.id`,
    });
    const enrollmentId = created.body.data.id;

    const detail = await call<{ data: { lessons: Array<{ id: string }> } }>(
      'GET',
      `/api/enrollments/${enrollmentId}`,
    );
    const lessons = detail.body.data.lessons;
    const half = Math.floor(lessons.length / 2);
    for (let i = 0; i < half; i++) {
      await call('POST', `/api/enrollments/${enrollmentId}/progress`, {
        lesson_id: lessons[i].id,
        completed: true,
      });
    }

    const mid = await call<{ data: { progress_pct: number; status: string } }>(
      'GET',
      `/api/enrollments/${enrollmentId}`,
    );
    assert.ok(mid.body.data.progress_pct > 0 && mid.body.data.progress_pct < 100);
    assert.equal(mid.body.data.status, 'active');

    // Un-complete one lesson → progress must drop.
    await call('POST', `/api/enrollments/${enrollmentId}/progress`, {
      lesson_id: lessons[0].id,
      completed: false,
    });
    const after = await call<{ data: { progress_pct: number } }>(
      'GET',
      `/api/enrollments/${enrollmentId}`,
    );
    assert.ok(after.body.data.progress_pct < mid.body.data.progress_pct, 'progress decreases');
  });

  test('progress rejects a lesson from a different course', async () => {
    const list = await call<{ data: Array<{ id: string }> }>('GET', '/api/courses');
    const created = await call<{ data: { id: string } }>('POST', '/api/enrollments', {
      course_id: list.body.data[0].id,
      learner_name: 'Uji Lintas Kursus',
      learner_email: `cross-${Date.now()}@contoh.id`,
    });
    const other = await call<{ data: { modules: Array<{ lessons: Array<{ id: string }> }> } }>(
      'GET',
      `/api/courses/${list.body.data[1].id}`,
    );
    const foreignLesson = other.body.data.modules[0].lessons[0].id;

    const res = await call('POST', `/api/enrollments/${created.body.data.id}/progress`, {
      lesson_id: foreignLesson,
      completed: true,
    });
    assert.equal(res.status, 400, 'foreign lesson rejected');
  });
});

/* ================================================================== *
 * 4 — certificate issuance, hash, verification, revoke
 * ================================================================== */

describe('certificate lifecycle', () => {
  /** Enrolls, passes every quiz, completes all lessons → eligible enrollment. */
  async function makeEligible(courseIndex = 0): Promise<{
    enrollmentId: string;
    courseId: string;
    courseTitle: string;
    email: string;
    quizScores: number[];
  }> {
    const list = await call<{ data: Array<{ id: string; title: string }> }>('GET', '/api/courses');
    const course = list.body.data[courseIndex];
    const email = `cert-${courseIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@contoh.id`;

    const created = await call<{ data: { id: string } }>('POST', '/api/enrollments', {
      course_id: course.id,
      learner_name: 'Uji Sertifikat',
      learner_email: email,
    });
    const enrollmentId = created.body.data.id;

    // Quizzes must be passed BEFORE the certificate is issued.
    const quizzes = await call<{ data: Array<{ id: string }> }>(
      'GET',
      `/api/courses/${course.id}/quizzes`,
    );
    const quizScores: number[] = [];
    for (const quiz of quizzes.body.data) {
      quizScores.push(await passQuiz(quiz.id, enrollmentId));
    }

    await completeAllLessons(enrollmentId);
    return { enrollmentId, courseId: course.id, courseTitle: course.title, email, quizScores };
  }

  test('certificate is REFUSED with 409 before completion', async () => {
    const list = await call<{ data: Array<{ id: string }> }>('GET', '/api/courses');
    const created = await call<{ data: { id: string } }>('POST', '/api/enrollments', {
      course_id: list.body.data[0].id,
      learner_name: 'Uji Tolak',
      learner_email: `refuse-${Date.now()}@contoh.id`,
    });

    const res = await call<{ error: { code: string; message: string } }>(
      'POST',
      `/api/enrollments/${created.body.data.id}/certificate`,
    );
    assert.equal(res.status, 409, 'issuance refused');
    assert.match(res.body.error.message, /belum bisa diterbitkan/i);
  });

  test('certificate is REFUSED when lessons are complete but quizzes were not passed', async () => {
    const list = await call<{ data: Array<{ id: string }> }>('GET', '/api/courses');
    const created = await call<{ data: { id: string } }>('POST', '/api/enrollments', {
      course_id: list.body.data[2].id,
      learner_name: 'Uji Tanpa Kuis',
      learner_email: `noquiz-${Date.now()}@contoh.id`,
    });
    const enrollmentId = created.body.data.id;

    await completeAllLessons(enrollmentId);

    const res = await call<{ error: { message: string } }>(
      'POST',
      `/api/enrollments/${enrollmentId}/certificate`,
    );
    assert.equal(res.status, 409, 'quiz gate still blocks issuance');
    assert.match(res.body.error.message, /kuis/i, 'reason mentions the quiz requirement');
  });

  test('certificate is REFUSED when a quiz was attempted but not passed', async () => {
    const list = await call<{ data: Array<{ id: string }> }>('GET', '/api/courses');
    const course = list.body.data[3];
    const created = await call<{ data: { id: string } }>('POST', '/api/enrollments', {
      course_id: course.id,
      learner_name: 'Uji Gagal Kuis',
      learner_email: `failedquiz-${Date.now()}@contoh.id`,
    });
    const enrollmentId = created.body.data.id;

    const quizzes = await call<{ data: Array<{ id: string; questions: Array<{ id: string }> }> }>(
      'GET',
      `/api/courses/${course.id}/quizzes`,
    );
    const quiz = quizzes.body.data[0];
    const bad = await call<{ data: { score: number; passed: boolean } }>(
      'POST',
      `/api/quizzes/${quiz.id}/submit`,
      {
        answers: quiz.questions.map((q) => ({ question_id: q.id, answer_index: -1 })),
        enrollment_id: enrollmentId,
      },
    );
    assert.equal(bad.body.data.passed, false);

    await completeAllLessons(enrollmentId);

    const res = await call<{ error: { message: string } }>(
      'POST',
      `/api/enrollments/${enrollmentId}/certificate`,
    );
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /belum lulus/i, 'reason distinguishes "attempted but failed"');
  });

  test('certificate is ALLOWED with 201 after completion and passing quizzes', async () => {
    const { enrollmentId } = await makeEligible(0);

    const res = await call<{
      data: { id: string; code: string; grade: string; verification_hash: string; score: number };
    }>('POST', `/api/enrollments/${enrollmentId}/certificate`);
    assert.equal(res.status, 201, 'certificate issued');

    const cert = res.body.data;
    assert.match(cert.code, /^QAT-\d{4}-[A-Z2-7]{6}$/, `code format: ${cert.code}`);
    assert.ok(['A', 'B', 'C', 'Pass'].includes(cert.grade), `grade: ${cert.grade}`);
    assert.equal(cert.verification_hash.length, 64, 'sha-256 hex digest');
  });

  test('issuing twice returns the SAME certificate (no duplicate)', async () => {
    const { enrollmentId } = await makeEligible(0);
    const first = await call<{ data: { id: string; code: string } }>(
      'POST',
      `/api/enrollments/${enrollmentId}/certificate`,
    );
    const second = await call<{ data: { id: string; code: string } }>(
      'POST',
      `/api/enrollments/${enrollmentId}/certificate`,
    );
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.data.id, first.body.data.id, 'same certificate reused');

    const count = db
      .prepare('SELECT COUNT(*) AS n FROM certificates WHERE enrollment_id = ?')
      .get(enrollmentId) as { n: number };
    assert.equal(Number(count.n), 1, 'exactly one certificate row');
  });

  test('verification_hash matches an independently recomputed SHA-256 (tamper detection)', async () => {
    const { enrollmentId, email, courseId } = await makeEligible(0);
    const res = await call<{
      data: { code: string; issued_at: string; verification_hash: string };
    }>('POST', `/api/enrollments/${enrollmentId}/certificate`);

    const cert = res.body.data;
    const expected = createHash('sha256')
      .update(`${cert.code}|${email}|${courseId}|${cert.issued_at}`, 'utf8')
      .digest('hex');
    assert.equal(cert.verification_hash, expected, 'hash matches recomputation');

    // And the module helper agrees with the raw crypto call.
    assert.equal(
      verificationHash({
        code: cert.code,
        learner_email: email,
        course_id: courseId,
        issued_at: cert.issued_at,
      }),
      expected,
    );

    // Tampering with any component changes the hash.
    const tampered = createHash('sha256')
      .update(`${cert.code}|${email}|${courseId}|${cert.issued_at}X`, 'utf8')
      .digest('hex');
    assert.notEqual(tampered, cert.verification_hash, 'tampering is detectable');
  });

  test('GET /api/certificates/verify/:code returns valid=true and the learner details', async () => {
    const { enrollmentId, email } = await makeEligible(0);
    const issued = await call<{ data: { code: string } }>(
      'POST',
      `/api/enrollments/${enrollmentId}/certificate`,
    );
    const code = issued.body.data.code;

    const res = await call<{
      data: { valid: boolean; learner_name?: string; course_title?: string; certificate?: { code: string } };
    }>('GET', `/api/certificates/verify/${code}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.valid, true);
    assert.equal(res.body.data.certificate?.code, code);
    assert.ok(res.body.data.learner_name);
    assert.ok(res.body.data.course_title);

    const byEmail = await call<{ data: Array<{ code: string }> }>('GET', `/api/certificates?email=${encodeURIComponent(email)}`);
    assert.equal(byEmail.status, 200);
    assert.equal(byEmail.body.data.length, 1);
  });

  test('verify returns valid=false with a reason for an unknown code', async () => {
    const res = await call<{ data: { valid: boolean; certificate?: unknown; reason?: string } }>(
      'GET',
      '/api/certificates/verify/QAT-2026-ZZZZZZ',
    );
    assert.equal(res.status, 200, 'unknown code is a 200 with valid=false, not a 404');
    assert.equal(res.body.data.valid, false);
    assert.equal(res.body.data.certificate, undefined);
    assert.match(res.body.data.reason ?? '', /tidak ditemukan/i);
  });

  test('verify returns valid=false with a reason for a revoked certificate', async () => {
    const { enrollmentId } = await makeEligible(0);
    const issued = await call<{ data: { id: string; code: string } }>(
      'POST',
      `/api/enrollments/${enrollmentId}/certificate`,
    );
    const { id, code } = issued.body.data;

    const revoke = await call<{ data: { revoked: number; revoked_reason: string } }>(
      'POST',
      `/api/certificates/${id}/revoke`,
      { reason: 'uji otomatis' },
    );
    assert.equal(revoke.status, 200);
    assert.equal(revoke.body.data.revoked, 1);
    assert.equal(revoke.body.data.revoked_reason, 'uji otomatis');

    const res = await call<{ data: { valid: boolean; reason?: string; certificate?: { revoked: number } } }>(
      'GET',
      `/api/certificates/verify/${code}`,
    );
    assert.equal(res.body.data.valid, false);
    assert.match(res.body.data.reason ?? '', /dicabut/i);
    assert.equal(res.body.data.certificate?.revoked, 1);
  });

  test('revoke requires a reason and refuses a double revoke', async () => {
    const { enrollmentId } = await makeEligible(0);
    const issued = await call<{ data: { id: string } }>(
      'POST',
      `/api/enrollments/${enrollmentId}/certificate`,
    );
    const id = issued.body.data.id;

    const noReason = await call('POST', `/api/certificates/${id}/revoke`, {});
    assert.equal(noReason.status, 400);

    const first = await call('POST', `/api/certificates/${id}/revoke`, { reason: 'alasan' });
    assert.equal(first.status, 200);

    const second = await call('POST', `/api/certificates/${id}/revoke`, { reason: 'alasan lagi' });
    assert.equal(second.status, 409, 'double revoke refused');
  });

  test('GET /api/certificates/:id/render?format=html returns standalone print-ready HTML', async () => {
    const { enrollmentId } = await makeEligible(0);
    const issued = await call<{
      data: { id: string; code: string; learner_name: string; course_title: string; verification_hash: string; grade: string };
    }>('POST', `/api/enrollments/${enrollmentId}/certificate`);
    const cert = issued.body.data;

    const res = await app.inject({ method: 'GET', url: `/api/certificates/${cert.id}/render?format=html` });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] as string, /text\/html/);

    const html = res.body;
    assert.match(html, /<!doctype html>/i);
    assert.ok(html.includes(cert.code), 'code present');
    assert.ok(html.includes(cert.learner_name), 'learner name present');
    assert.ok(html.includes(cert.course_title), 'course title present');
    assert.ok(html.includes(cert.verification_hash), 'hash present');
    assert.ok(html.includes(cert.grade), 'grade present');
    assert.match(html, /verify/i, 'verification URL present');
    // Standalone: no external assets.
    assert.ok(!/<script/i.test(html), 'no scripts');
    assert.ok(!/<link[^>]+href=/i.test(html), 'no external stylesheets');
    assert.ok(!/<img/i.test(html), 'no external images');

    const asJson = await call<{ data: { code: string } }>(
      'GET',
      `/api/certificates/${cert.id}/render?format=json`,
    );
    assert.equal(asJson.status, 200);
    assert.equal(asJson.body.data.code, cert.code);
  });
});

/* ================================================================== *
 * 5 — pure helpers
 * ================================================================== */

describe('certificate helpers', () => {
  test('generateCode uses the QAT-<year>-<6 base32> format', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCode(2026);
      assert.match(code, /^QAT-2026-[A-Z2-7]{6}$/);
    }
  });

  test('gradeFor applies the documented thresholds', () => {
    assert.equal(gradeFor(100), 'A');
    assert.equal(gradeFor(90), 'A');
    assert.equal(gradeFor(89.9), 'B');
    assert.equal(gradeFor(80), 'B');
    assert.equal(gradeFor(79.9), 'C');
    assert.equal(gradeFor(70), 'C');
    assert.equal(gradeFor(69.9), 'Pass');
    assert.equal(gradeFor(0), 'Pass');
  });

  test('escapeHtml neutralises markup in the certificate renderer', () => {
    assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(escapeHtml('a & "b"'), 'a &amp; &quot;b&quot;');
  });

  test('certificate HTML escapes a hostile learner name', async () => {
    const list = await call<{ data: Array<{ id: string }> }>('GET', '/api/courses');
    const courseId = list.body.data[0].id;
    const hostile = `<img src=x onerror=alert(1)>`;
    const created = await call<{ data: { id: string } }>('POST', '/api/enrollments', {
      course_id: courseId,
      learner_name: hostile,
      learner_email: `xss-${Date.now()}@contoh.id`,
    });
    const enrollmentId = created.body.data.id;

    const quizzes = await call<{ data: Array<{ id: string }> }>('GET', `/api/courses/${courseId}/quizzes`);
    for (const quiz of quizzes.body.data) await passQuiz(quiz.id, enrollmentId);
    await completeAllLessons(enrollmentId);

    const issued = await call<{ data: { id: string } }>(
      'POST',
      `/api/enrollments/${enrollmentId}/certificate`,
    );
    assert.equal(issued.status, 201);

    const html = await app.inject({ method: 'GET', url: `/api/certificates/${issued.body.data.id}/render?format=html` });
    assert.ok(!html.body.includes('<img src=x'), 'raw markup must not survive');
    assert.ok(html.body.includes('&lt;img'), 'markup is escaped');
  });
});

/* ================================================================== *
 * 6 — markdown renderer (safe, dependency-free)
 * ================================================================== */

describe('markdown renderer', () => {
  test('renders headings, lists, tables and code fences', () => {
    const html = renderMarkdown(
      [
        '# Judul',
        '',
        'Paragraf dengan **tebal** dan *miring* serta `kode`.',
        '',
        '- satu',
        '- dua',
        '',
        '| A | B |',
        '|---|---|',
        '| 1 | 2 |',
        '',
        '```sql',
        'SELECT 1;',
        '```',
      ].join('\n'),
    );
    assert.match(html, /<h1 class="md-h1">Judul<\/h1>/);
    assert.match(html, /<strong>tebal<\/strong>/);
    assert.match(html, /<em>miring<\/em>/);
    assert.match(html, /<code class="md-code">kode<\/code>/);
    assert.match(html, /<ul><li>satu<\/li><li>dua<\/li><\/ul>/);
    assert.match(html, /<table class="table md-table">/);
    assert.match(html, /<th>A<\/th>/);
    assert.match(html, /<pre class="md-pre language-sql"><code>SELECT 1;<\/code><\/pre>/);
  });

  test('escapes raw HTML from the source (no injection)', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    assert.ok(!html.includes('<script'), 'script tag must not survive');
    assert.ok(!/<img/i.test(html), 'img tag must not survive');
    assert.ok(html.includes('&lt;script&gt;'), 'markup is escaped');
  });

  test('rejects javascript: URLs in links but keeps safe ones', () => {
    const bad = renderMarkdown('[klik](javascript:alert(1))');
    assert.ok(!bad.includes('javascript:'), 'javascript: href dropped');
    assert.ok(!bad.includes('<a '), 'link is not rendered');

    const good = renderMarkdown('[docs](https://example.com/a)');
    assert.ok(good.includes('href="https://example.com/a"'));
    assert.ok(good.includes('rel="noreferrer noopener"'));

    const relative = renderMarkdown('[lab](/testcases)');
    assert.ok(relative.includes('href="/testcases"'));
  });

  test('inline HTML inside a code fence is still escaped', () => {
    const html = renderMarkdown('```\n<b>not bold</b>\n```');
    assert.ok(html.includes('&lt;b&gt;not bold&lt;/b&gt;'));
    assert.ok(!html.includes('<b>not bold</b>'));
  });

  test('escapeHtml matches the API-side escaping', () => {
    assert.equal(mdEscape('<a href="x">&'), escapeHtml('<a href="x">&'));
  });

  test('seeded lesson content renders without throwing', () => {
    const lessons = db.prepare('SELECT content_md FROM lessons LIMIT 25').all() as Array<{
      content_md: string;
    }>;
    assert.ok(lessons.length > 0);
    for (const l of lessons) {
      const html = renderMarkdown(l.content_md);
      assert.ok(html.length > 0, 'content produces output');
      assert.ok(!/<script/i.test(html), 'no script tags from seeded content');
    }
  });
});
