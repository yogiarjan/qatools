/**
 * Idempotent curriculum seeder. Owned by Lane E.
 *
 * Exports the reusable `seedCurriculum()` function so the Lead can compose it with the
 * demo-project seeder. `run.ts` is the thin CLI wrapper.
 *
 * Idempotency strategy: every row is keyed on a natural key, never on a generated id.
 *   course           → slug            (UNIQUE in schema)
 *   module           → (course_id, code)
 *   lesson           → (course_id, code)
 *   quiz             → (course_id, title)
 *   quiz_question    → (quiz_id, prompt)
 * Child rows of a rewritten parent are deleted and re-inserted inside one transaction, so
 * running the seeder twice yields identical counts and zero duplicates.
 */

import { newId, nowIso } from '@qatools/shared';
import { db, migrate } from '../db/index.js';
import { SEED_CURRICULUM, countCurriculum, validateCurriculum } from './curriculum.js';
import type { SeedCounts } from './types.js';

export interface SeedResult extends SeedCounts {
  /** Rows inserted rather than found already present. */
  inserted: SeedCounts;
  /** Rows that already existed under the same natural key and were updated in place. */
  updated: SeedCounts;
  /** Total rows now present in the learning tables. */
  totals: SeedCounts;
  duration_ms: number;
  /** Natural keys that were newly created (courses only — keeps the log readable). */
  new_course_slugs: string[];
}

interface Row {
  [key: string]: unknown;
}

function scalar(sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}

/** Total rows currently stored in the learning tables. */
export function curriculumTotals(): SeedCounts {
  return {
    courses: scalar('SELECT COUNT(*) AS n FROM courses'),
    modules: scalar('SELECT COUNT(*) AS n FROM course_modules'),
    lessons: scalar('SELECT COUNT(*) AS n FROM lessons'),
    quizzes: scalar('SELECT COUNT(*) AS n FROM quizzes'),
    questions: scalar('SELECT COUNT(*) AS n FROM quiz_questions'),
    labs: scalar("SELECT COUNT(*) AS n FROM lessons WHERE lab_ref IS NOT NULL AND lab_ref <> ''"),
  };
}

/**
 * Writes the whole curriculum. Safe to run any number of times.
 *
 * @param opts.strict  when true (default) content validation failures throw instead of warning
 */
export function seedCurriculum(opts: { strict?: boolean; quiet?: boolean } = {}): SeedResult {
  const started = Date.now();
  const strict = opts.strict ?? true;

  migrate();

  const problems = validateCurriculum(SEED_CURRICULUM);
  if (problems.length) {
    const message = `curriculum content is invalid:\n  - ${problems.join('\n  - ')}`;
    if (strict) throw new Error(message);
    // eslint-disable-next-line no-console
    console.warn(message);
  }

  const inserted: SeedCounts = { courses: 0, modules: 0, lessons: 0, quizzes: 0, questions: 0, labs: 0 };
  const updated: SeedCounts = { courses: 0, modules: 0, lessons: 0, quizzes: 0, questions: 0, labs: 0 };
  const newCourseSlugs: string[] = [];

  db.transaction(() => {
    const findCourse = db.prepare('SELECT id FROM courses WHERE slug = ?');
    const findModule = db.prepare('SELECT id FROM course_modules WHERE course_id = ? AND code = ?');
    const findLesson = db.prepare('SELECT id FROM lessons WHERE course_id = ? AND code = ?');
    const findQuiz = db.prepare('SELECT id FROM quizzes WHERE course_id = ? AND title = ?');
    const findQuestion = db.prepare('SELECT id FROM quiz_questions WHERE quiz_id = ? AND prompt = ?');

    const insCourse = db.prepare(
      `INSERT INTO courses (id, slug, title, subtitle, description, level, pillar,
                            estimated_minutes, order_index, icon, is_published, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    );
    const updCourse = db.prepare(
      `UPDATE courses SET title = ?, subtitle = ?, description = ?, level = ?, pillar = ?,
                          estimated_minutes = ?, order_index = ?, icon = ?, is_published = 1,
                          updated_at = ?
       WHERE id = ?`,
    );
    const insModule = db.prepare(
      `INSERT INTO course_modules (id, course_id, code, title, summary, order_index)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const updModule = db.prepare(
      `UPDATE course_modules SET title = ?, summary = ?, order_index = ? WHERE id = ?`,
    );
    const insLesson = db.prepare(
      `INSERT INTO lessons (id, module_id, course_id, code, title, kind, content_md,
                            duration_minutes, order_index, lab_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updLesson = db.prepare(
      `UPDATE lessons SET module_id = ?, title = ?, kind = ?, content_md = ?, duration_minutes = ?,
                          order_index = ?, lab_ref = ?, updated_at = ?
       WHERE id = ?`,
    );
    const insQuiz = db.prepare(
      `INSERT INTO quizzes (id, course_id, module_id, title, pass_score, time_limit_minutes, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const updQuiz = db.prepare(
      `UPDATE quizzes SET module_id = ?, pass_score = ?, time_limit_minutes = ?, order_index = ? WHERE id = ?`,
    );
    const insQuestion = db.prepare(
      `INSERT INTO quiz_questions (id, quiz_id, prompt, options, answer_index, explanation, points, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updQuestion = db.prepare(
      `UPDATE quiz_questions SET options = ?, answer_index = ?, explanation = ?, points = ?, order_index = ?
       WHERE id = ?`,
    );
    const delQuestion = db.prepare('DELETE FROM quiz_questions WHERE id = ?');
    const delOrphanQuestions = db.prepare(
      'DELETE FROM quiz_questions WHERE quiz_id = ? AND id NOT IN (SELECT value FROM json_each(?))',
    );

    for (const course of SEED_CURRICULUM) {
      const ts = nowIso();
      const existingCourse = findCourse.get(course.slug) as Row | undefined;
      let courseId: string;

      if (existingCourse) {
        courseId = String(existingCourse.id);
        updCourse.run(
          course.title,
          course.subtitle,
          course.description,
          course.level,
          course.pillar,
          course.estimated_minutes,
          course.order_index,
          course.icon,
          ts,
          courseId,
        );
        updated.courses += 1;
      } else {
        courseId = newId('crs_');
        insCourse.run(
          courseId,
          course.slug,
          course.title,
          course.subtitle,
          course.description,
          course.level,
          course.pillar,
          course.estimated_minutes,
          course.order_index,
          course.icon,
          ts,
          ts,
        );
        inserted.courses += 1;
        newCourseSlugs.push(course.slug);
      }

      // ---- modules & lessons -------------------------------------------------
      const moduleIds = new Map<string, string>();
      for (const mod of course.modules) {
        const existingModule = findModule.get(courseId, mod.code) as Row | undefined;
        let moduleId: string;
        if (existingModule) {
          moduleId = String(existingModule.id);
          updModule.run(mod.title, mod.summary, mod.order_index, moduleId);
          updated.modules += 1;
        } else {
          moduleId = newId('mod_');
          insModule.run(moduleId, courseId, mod.code, mod.title, mod.summary, mod.order_index);
          inserted.modules += 1;
        }
        moduleIds.set(mod.code, moduleId);

        for (const lesson of mod.lessons) {
          const existingLesson = findLesson.get(courseId, lesson.code) as Row | undefined;
          const labRef = lesson.lab_ref ?? null;
          if (existingLesson) {
            updLesson.run(
              moduleId,
              lesson.title,
              lesson.kind,
              lesson.content_md,
              lesson.duration_minutes,
              lesson.order_index,
              labRef,
              nowIso(),
              String(existingLesson.id),
            );
            updated.lessons += 1;
            if (labRef) updated.labs += 1;
          } else {
            insLesson.run(
              newId('lsn_'),
              moduleId,
              courseId,
              lesson.code,
              lesson.title,
              lesson.kind,
              lesson.content_md,
              lesson.duration_minutes,
              lesson.order_index,
              labRef,
              ts,
              ts,
            );
            inserted.lessons += 1;
            if (labRef) inserted.labs += 1;
          }
        }
      }

      // ---- quizzes & questions ----------------------------------------------
      for (const quiz of course.quizzes) {
        const existingQuiz = findQuiz.get(courseId, quiz.title) as Row | undefined;
        let quizId: string;
        const ownerModuleId = moduleIds.get(course.modules[0]?.code ?? '') ?? null;

        if (existingQuiz) {
          quizId = String(existingQuiz.id);
          updQuiz.run(ownerModuleId, quiz.pass_score, quiz.time_limit_minutes ?? null, quiz.order_index, quizId);
          updated.quizzes += 1;
        } else {
          quizId = newId('qz_');
          insQuiz.run(
            quizId,
            courseId,
            ownerModuleId,
            quiz.title,
            quiz.pass_score,
            quiz.time_limit_minutes ?? null,
            quiz.order_index,
          );
          inserted.quizzes += 1;
        }

        const keptIds: string[] = [];
        for (const [index, question] of quiz.questions.entries()) {
          const existingQuestion = findQuestion.get(quizId, question.prompt) as Row | undefined;
          const options = JSON.stringify(question.options);
          if (existingQuestion) {
            const qid = String(existingQuestion.id);
            updQuestion.run(
              options,
              question.answer_index,
              question.explanation,
              question.points ?? 1,
              index + 1,
              qid,
            );
            keptIds.push(qid);
            updated.questions += 1;
          } else {
            const qid = newId('qq_');
            insQuestion.run(
              qid,
              quizId,
              question.prompt,
              options,
              question.answer_index,
              question.explanation,
              question.points ?? 1,
              index + 1,
            );
            keptIds.push(qid);
            inserted.questions += 1;
          }
        }
        // Remove questions that were deleted from the authored content (keeps counts stable).
        delOrphanQuestions.run(quizId, JSON.stringify(keptIds));
      }

      // Quizzes removed from the authored content are dropped along with their questions.
      const authoredQuizTitles = course.quizzes.map((q) => q.title);
      if (authoredQuizTitles.length) {
        const stale = db
          .prepare(
            `SELECT id FROM quizzes WHERE course_id = ? AND title NOT IN (SELECT value FROM json_each(?))`,
          )
          .all(courseId, JSON.stringify(authoredQuizTitles)) as Row[];
        for (const row of stale) {
          const qid = String(row.id);
          const questionIds = db.prepare('SELECT id FROM quiz_questions WHERE quiz_id = ?').all(qid) as Row[];
          for (const q of questionIds) delQuestion.run(String(q.id));
          db.prepare('DELETE FROM quizzes WHERE id = ?').run(qid);
        }
      }
    }
  });

  const taught = countCurriculum();
  const totals = curriculumTotals();
  if (!opts.quiet) {
    const drift = (Object.keys(taught) as Array<keyof SeedCounts>).filter((k) => taught[k] !== totals[k]);
    if (drift.length) {
      // eslint-disable-next-line no-console
      console.warn(
        `seed: row-count drift vs authored content for: ${drift
          .map((k) => `${k} (authored ${taught[k]}, stored ${totals[k]})`)
          .join(', ')}`,
      );
    }
  }

  return {
    ...taught,
    inserted,
    updated,
    totals,
    duration_ms: Date.now() - started,
    new_course_slugs: newCourseSlugs,
  };
}
