/**
 * Curriculum seeder CLI. Owned by Lane E.
 *
 *   pnpm -F @qatools/api seed
 *   node apps/api/node_modules/tsx/dist/cli.mjs apps/api/src/seed/run.ts
 *
 * Seeds ONLY curriculum data (courses, modules, lessons, quizzes, questions).
 * The demo-project seeder is owned by the Lead and is deliberately kept separate; the Lead can
 * compose it by importing `seedCurriculum()` from './curriculum-seed.js'.
 *
 * Idempotent: running it twice produces identical counts.
 */

import { DB_PATH } from '../db/index.js';
import { CURRICULUM_PILLS, SEED_CURRICULUM } from './curriculum.js';
import { seedCurriculum, curriculumTotals } from './curriculum-seed.js';

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width);
}

function padStart(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function main(): void {
  const started = Date.now();

  const result = seedCurriculum();

  // ---------------------------------------------------------------- summary
  console.log('');
  console.log('QATools curriculum seed');
  console.log('='.repeat(74));
  console.log(`database : ${DB_PATH}`);
  console.log(`pillars  : ${CURRICULUM_PILLS.join(' · ')}`);
  console.log('');

  const header = `${pad('entity', 12)}${padStart('authored', 10)}${padStart('inserted', 10)}${padStart(
    'updated',
    10,
  )}${padStart('stored', 10)}`;
  console.log(header);
  console.log('-'.repeat(header.length));

  const rows: Array<[string, number]> = [
    ['courses', result.courses],
    ['modules', result.modules],
    ['lessons', result.lessons],
    ['  labs', result.labs],
    ['quizzes', result.quizzes],
    ['questions', result.questions],
  ];
  for (const [label, authored] of rows) {
    const key = label.trim() as keyof typeof result.totals;
    console.log(
      `${pad(label, 12)}${padStart(authored, 10)}${padStart(result.inserted[key], 10)}${padStart(
        result.updated[key],
        10,
      )}${padStart(result.totals[key], 10)}`,
    );
  }
  console.log('-'.repeat(header.length));
  console.log('');

  // ------------------------------------------------------------- per course
  console.log('courses seeded (learning-path order)');
  console.log('-'.repeat(74));
  for (const course of SEED_CURRICULUM) {
    const lessons = course.modules.reduce((sum, m) => sum + m.lessons.length, 0);
    const questions = course.quizzes.reduce((sum, q) => sum + q.questions.length, 0);
    console.log(
      `  ${padStart(course.order_index, 2)}. [${pad(course.pillar, 20)}] ${course.title}`,
    );
    console.log(
      `      ${course.modules.length} modul · ${lessons} pelajaran · ${questions} soal kuis · ${course.estimated_minutes} menit · ${course.level}`,
    );
  }
  console.log('-'.repeat(74));

  if (result.new_course_slugs.length) {
    console.log(`new courses : ${result.new_course_slugs.join(', ')}`);
  } else {
    console.log('new courses : none (all courses already existed — idempotent re-run)');
  }

  const totals = curriculumTotals();
  console.log(
    `stored totals: ${totals.courses} courses · ${totals.modules} modules · ${totals.lessons} lessons ` +
      `(${totals.labs} labs) · ${totals.quizzes} quizzes · ${totals.questions} questions`,
  );
  console.log(`duration    : ${Date.now() - started} ms`);
  console.log('='.repeat(74));
  console.log('SEED_RESULT=OK');
}

main();
