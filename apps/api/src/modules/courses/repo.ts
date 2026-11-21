/**
 * Courses repository — SQL against the frozen learning tables.
 * Owned by Lane E. Only this module writes to courses/course_modules/lessons/quizzes/quiz_questions.
 */

import { db } from '../../db/index.js';

export interface CourseRow {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  level: string;
  pillar: string;
  estimated_minutes: number;
  order_index: number;
  icon: string | null;
  is_published: number;
  created_at: string;
  updated_at: string;
}

export interface CourseListRow extends CourseRow {
  module_count: number;
  lesson_count: number;
  quiz_count: number;
  lab_count: number;
}

export interface ModuleRow {
  id: string;
  course_id: string;
  code: string;
  title: string;
  summary: string | null;
  order_index: number;
}

export interface LessonRow {
  id: string;
  module_id: string;
  course_id: string;
  code: string;
  title: string;
  kind: string;
  content_md: string;
  duration_minutes: number;
  order_index: number;
  lab_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuizRow {
  id: string;
  course_id: string;
  module_id: string | null;
  title: string;
  pass_score: number;
  time_limit_minutes: number | null;
  order_index: number;
}

export interface QuestionRow {
  id: string;
  quiz_id: string;
  prompt: string;
  options: string;
  answer_index: number;
  explanation: string | null;
  points: number;
  order_index: number;
}

/* ------------------------------- courses -------------------------------- */

const COURSE_SELECT = `
  SELECT c.*,
         (SELECT COUNT(*) FROM course_modules m WHERE m.course_id = c.id)                     AS module_count,
         (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id)                            AS lesson_count,
         (SELECT COUNT(*) FROM quizzes q WHERE q.course_id = c.id)                             AS quiz_count,
         (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id AND l.lab_ref IS NOT NULL)   AS lab_count
  FROM courses c
`;

export function listCourses(filter: { pillar?: string; level?: string; publishedOnly?: boolean } = {}): CourseListRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.pillar) {
    where.push('c.pillar = ?');
    params.push(filter.pillar);
  }
  if (filter.level) {
    where.push('c.level = ?');
    params.push(filter.level);
  }
  if (filter.publishedOnly !== false) where.push('c.is_published = 1');
  const sql = `${COURSE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.order_index, c.title`;
  return db.prepare(sql).all(...params) as unknown as CourseListRow[];
}

export function findCourse(idOrSlug: string): CourseListRow | undefined {
  return db
    .prepare(`${COURSE_SELECT} WHERE c.id = ? OR c.slug = ?`)
    .get(idOrSlug, idOrSlug) as unknown as CourseListRow | undefined;
}

export function listModules(courseId: string): ModuleRow[] {
  return db
    .prepare('SELECT * FROM course_modules WHERE course_id = ? ORDER BY order_index, code')
    .all(courseId) as unknown as ModuleRow[];
}

export function listLessonsForCourse(courseId: string): LessonRow[] {
  return db
    .prepare('SELECT * FROM lessons WHERE course_id = ? ORDER BY order_index, code')
    .all(courseId) as unknown as LessonRow[];
}

export function findLesson(id: string): LessonRow | undefined {
  return db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as unknown as LessonRow | undefined;
}

export function updateLesson(
  id: string,
  patch: { title?: string; content_md?: string; kind?: string; duration_minutes?: number; lab_ref?: string | null },
): LessonRow | undefined {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    params.push(patch.title);
  }
  if (patch.content_md !== undefined) {
    sets.push('content_md = ?');
    params.push(patch.content_md);
  }
  if (patch.kind !== undefined) {
    sets.push('kind = ?');
    params.push(patch.kind);
  }
  if (patch.duration_minutes !== undefined) {
    sets.push('duration_minutes = ?');
    params.push(patch.duration_minutes);
  }
  if (patch.lab_ref !== undefined) {
    sets.push('lab_ref = ?');
    params.push(patch.lab_ref);
  }
  if (!sets.length) return findLesson(id);
  sets.push('updated_at = ?');
  params.push(new Date().toISOString(), id);
  db.prepare(`UPDATE lessons SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return findLesson(id);
}

/* -------------------------------- quizzes -------------------------------- */

export function listQuizzes(courseId: string): QuizRow[] {
  return db
    .prepare('SELECT * FROM quizzes WHERE course_id = ? ORDER BY order_index, title')
    .all(courseId) as unknown as QuizRow[];
}

export function findQuiz(id: string): QuizRow | undefined {
  return db.prepare('SELECT * FROM quizzes WHERE id = ?').get(id) as unknown as QuizRow | undefined;
}

export function listQuestions(quizId: string): QuestionRow[] {
  return db
    .prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY order_index, id')
    .all(quizId) as unknown as QuestionRow[];
}

/** Public projection — the answer key is removed. Used by every read route. */
export interface PublicQuestion {
  id: string;
  quiz_id: string;
  prompt: string;
  options: string[];
  points: number;
  order_index: number;
}

export function toPublicQuestion(row: QuestionRow): PublicQuestion {
  let options: string[] = [];
  try {
    const parsed = JSON.parse(row.options);
    if (Array.isArray(parsed)) options = parsed.map((o) => String(o));
  } catch {
    options = [];
  }
  return {
    id: row.id,
    quiz_id: row.quiz_id,
    prompt: row.prompt,
    options,
    points: row.points,
    order_index: row.order_index,
  };
}

export function quizzesForCourse(courseId: string): Array<QuizRow & { question_count: number }> {
  return db
    .prepare(
      `SELECT q.*, (SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id) AS question_count
       FROM quizzes q WHERE q.course_id = ? ORDER BY q.order_index, q.title`,
    )
    .all(courseId) as unknown as Array<QuizRow & { question_count: number }>;
}

/** Total lessons in a course — the denominator for progress. */
export function lessonCount(courseId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE course_id = ?').get(courseId) as
    | { n: number }
    | undefined;
  return Number(row?.n ?? 0);
}
