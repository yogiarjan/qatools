/**
 * Curriculum seed types. Owned by Lane E.
 *
 * Plain, dependency-free shapes for authoring the curriculum as data before it is
 * written to SQLite. `pillar` is deliberately typed as the frozen `CurriculumPillar`
 * union so a typo cannot compile.
 */

import type { CurriculumPillar } from '@qatools/shared';

export type CourseLevel = 'beginner' | 'intermediate' | 'advanced';
export type LessonKind = 'reading' | 'video' | 'lab' | 'quiz';

export interface SeedQuestion {
  prompt: string;
  options: string[];
  answer_index: number;
  explanation: string;
  points?: number;
}

export interface SeedQuiz {
  title: string;
  pass_score: number;
  order_index: number;
  time_limit_minutes?: number | null;
  questions: SeedQuestion[];
}

export interface SeedLesson {
  code: string;
  title: string;
  kind: LessonKind;
  content_md: string;
  duration_minutes: number;
  order_index: number;
  /** Deep link into a QATools feature, e.g. "/testcases". */
  lab_ref?: string | null;
}

export interface SeedModule {
  code: string;
  title: string;
  summary: string;
  order_index: number;
  lessons: SeedLesson[];
}

export interface SeedCourse {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  level: CourseLevel;
  pillar: CurriculumPillar;
  estimated_minutes: number;
  order_index: number;
  icon: string;
  /** Free-form tags used by the catalog UI (stored inside `description` footer metadata is avoided;
   *  tags are exposed through the courses API as a derived field). */
  tags: string[];
  modules: SeedModule[];
  quizzes: SeedQuiz[];
}

export interface SeedCounts {
  courses: number;
  modules: number;
  lessons: number;
  quizzes: number;
  questions: number;
  labs: number;
}
