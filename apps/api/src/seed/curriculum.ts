/**
 * The complete QATools curriculum as data. Owned by Lane E.
 *
 * This module elaborates every item advertised by the course photo:
 *
 *   Pills      : e-Certificate · Materi & Praktik · Belajar Online · Bangun Portofolio
 *   Curriculum : QA Introduction · QA Test Technique · QA Test Activity · Basic QA Automation
 *                API Automation · Web Automation · Database Testing · (dan masih banyak lagi)
 *
 * "dan masih banyak lagi" is elaborated into two further courses: an end-to-end capstone lab
 * ("Materi & Praktik") and a portfolio-building course ("Bangun Portofolio"), plus the
 * certificate/verification track delivered by the certificates module.
 *
 * `pillar` values come verbatim from the FROZEN `CURRICULUM_PILLARS` list in @qatools/shared.
 */

import { CURRICULUM_PILLARS, type CurriculumPillar } from '@qatools/shared';
import { CONTENT_A } from './content-a.js';
import { CONTENT_B } from './content-b.js';
import { CONTENT_C } from './content-c.js';
import type { SeedCourse, SeedCounts } from './types.js';

/** Every course in learning-path order. */
export const SEED_CURRICULUM: SeedCourse[] = [...CONTENT_A, ...CONTENT_B, ...CONTENT_C];

/** The four value pills advertised by the photo, in photo order. */
export const CURRICULUM_PILLS = [
  'e-Certificate',
  'Materi & Praktik',
  'Belajar Online',
  'Bangun Portofolio',
] as const;

/** The eight curriculum items advertised by the photo, in photo order. */
export const PHOTO_CURRICULUM_ITEMS = [
  'QA Introduction',
  'QA Test Technique',
  'QA Test Activity',
  'Basic QA Automation',
  'API Automation',
  'Web Automation',
  'Database Testing',
] as const;

export interface PillarOverview {
  pillar: CurriculumPillar;
  kind: 'pill' | 'course';
  course_count: number;
  lesson_count: number;
  courses: Array<{
    id: string;
    slug: string;
    title: string;
    subtitle: string | null;
    level: string;
    estimated_minutes: number;
    order_index: number;
    icon: string | null;
    module_count: number;
    lesson_count: number;
    quiz_count: number;
  }>;
}

/** Lab deep-links exposed by the curriculum — proves "Materi & Praktik" connects to the product. */
export const LAB_REFS = [
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
] as const;

export type LabRef = (typeof LAB_REFS)[number];

/** Counts the seeder writes, without touching the database. */
export function countCurriculum(courses: SeedCourse[] = SEED_CURRICULUM): SeedCounts {
  let modules = 0;
  let lessons = 0;
  let quizzes = 0;
  let questions = 0;
  let labs = 0;
  for (const course of courses) {
    quizzes += course.quizzes.length;
    for (const quiz of course.quizzes) questions += quiz.questions.length;
    for (const mod of course.modules) {
      modules += 1;
      lessons += mod.lessons.length;
      labs += mod.lessons.filter((l) => Boolean(l.lab_ref)).length;
    }
  }
  return { courses: courses.length, modules, lessons, quizzes, questions, labs };
}

/**
 * Structural validation of the authored content. Used by the seeder (which refuses to write
 * invalid content) and by tests. Throws with a precise, actionable message.
 */
export function validateCurriculum(courses: SeedCourse[] = SEED_CURRICULUM): string[] {
  const problems: string[] = [];
  const seenSlugs = new Set<string>();
  const seenModuleCodes = new Set<string>();
  const seenLessonCodes = new Set<string>();
  const seenLabRefs = new Set<string>(LAB_REFS);

  for (const course of courses) {
    if (seenSlugs.has(course.slug)) problems.push(`duplicate course slug: ${course.slug}`);
    seenSlugs.add(course.slug);

    if (!(CURRICULUM_PILLARS as readonly string[]).includes(course.pillar)) {
      problems.push(`${course.slug}: pillar "${course.pillar}" is not in CURRICULUM_PILLARS`);
    }
    if (course.modules.length < 3 || course.modules.length > 5) {
      problems.push(`${course.slug}: expected 3–5 modules, found ${course.modules.length}`);
    }
    if (course.quizzes.length < 1) problems.push(`${course.slug}: needs at least one quiz`);

    for (const quiz of course.quizzes) {
      if (quiz.questions.length < 4) {
        problems.push(`${course.slug} / "${quiz.title}": needs 4+ questions, found ${quiz.questions.length}`);
      }
      const prompts = new Set<string>();
      for (const q of quiz.questions) {
        if (prompts.has(q.prompt)) {
          problems.push(`${course.slug} / "${quiz.title}": duplicate question prompt`);
        }
        prompts.add(q.prompt);
        if (q.options.length < 2) problems.push(`${course.slug}: question has fewer than 2 options`);
        if (q.answer_index < 0 || q.answer_index >= q.options.length) {
          problems.push(`${course.slug}: answer_index ${q.answer_index} out of range`);
        }
        if (!q.explanation || q.explanation.trim().length < 10) {
          problems.push(`${course.slug}: question missing a meaningful explanation`);
        }
      }
    }

    for (const mod of course.modules) {
      if (seenModuleCodes.has(mod.code)) problems.push(`duplicate module code: ${mod.code}`);
      seenModuleCodes.add(mod.code);
      if (mod.lessons.length < 3 || mod.lessons.length > 6) {
        problems.push(`${mod.code}: expected 3–6 lessons, found ${mod.lessons.length}`);
      }
      for (const lesson of mod.lessons) {
        if (seenLessonCodes.has(lesson.code)) problems.push(`duplicate lesson code: ${lesson.code}`);
        seenLessonCodes.add(lesson.code);
        if (lesson.content_md.trim().length < 600) {
          problems.push(`${lesson.code}: content_md is too thin (${lesson.content_md.trim().length} chars)`);
        }
        if (lesson.lab_ref && !seenLabRefs.has(lesson.lab_ref)) {
          problems.push(`${lesson.code}: lab_ref "${lesson.lab_ref}" is not a known QATools route`);
        }
      }
    }
  }
  return problems;
}

/** Builds the pillar → course map consumed by the catalog UI. */
export function buildPillarOverview(
  courseRows: Array<{
    id: string;
    slug: string;
    title: string;
    subtitle: string | null;
    level: string;
    pillar: string;
    estimated_minutes: number;
    order_index: number;
    icon: string | null;
    module_count: number;
    lesson_count: number;
    quiz_count: number;
  }>,
  pillars: readonly string[] = CURRICULUM_PILLARS,
): PillarOverview[] {
  const byPillar = new Map<string, PillarOverview['courses']>();
  for (const row of courseRows) {
    const bucket = byPillar.get(row.pillar) ?? [];
    bucket.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      subtitle: row.subtitle,
      level: row.level,
      estimated_minutes: row.estimated_minutes,
      order_index: row.order_index,
      icon: row.icon,
      module_count: row.module_count,
      lesson_count: row.lesson_count,
      quiz_count: row.quiz_count,
    });
    byPillar.set(row.pillar, bucket);
  }

  const out: PillarOverview[] = [];
  for (const pillar of pillars) {
    const courses = (byPillar.get(pillar) ?? []).slice().sort((a, b) => a.order_index - b.order_index);
    const kind: 'pill' | 'course' = (CURRICULUM_PILLS as readonly string[]).includes(pillar)
      ? 'pill'
      : 'course';
    // A pill that also names a course (e.g. "Materi & Praktik") is reported as a pill only once.
    if (kind === 'course' && courses.length === 0) continue;
    out.push({
      pillar: pillar as CurriculumPillar,
      kind,
      course_count: courses.length,
      lesson_count: courses.reduce((sum, c) => sum + c.lesson_count, 0),
      courses,
    });
    byPillar.delete(pillar);
  }

  // Anything authored under a pillar outside the frozen list is surfaced rather than dropped.
  for (const [pillar, courses] of byPillar) {
    out.push({
      pillar: pillar as CurriculumPillar,
      kind: 'course',
      course_count: courses.length,
      lesson_count: courses.reduce((sum, c) => sum + c.lesson_count, 0),
      courses,
    });
  }
  return out;
}

export type { SeedCourse, SeedCounts };
