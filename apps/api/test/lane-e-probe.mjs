/**
 * Lane E end-to-end probe: drives the full learn/certificate lifecycle against a live API.
 * Run manually via scripts/probe.mjs or by hand. Not a test file.
 */
const base = process.env.QATOOLS_PROBE_BASE ?? 'http://127.0.0.1:5199';
const j = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, parsed };
};

const courses = await j('GET', '/api/courses');
console.log('GET /api/courses ->', courses.status, 'total=', courses.parsed?.total);
const c0 = courses.parsed?.data?.[0];
console.log('first course:', c0?.slug, c0?.pillar, 'modules=', c0?.module_count, 'lessons=', c0?.lesson_count);

const ov = await j('GET', '/api/curriculum/overview');
console.log('GET /api/curriculum/overview ->', ov.status, 'groups=', ov.parsed?.data?.groups?.length,
  'totals=', JSON.stringify(ov.parsed?.data?.totals));

const detail = await j('GET', `/api/courses/${c0.id}`);
console.log('GET /api/courses/:id ->', detail.status, 'modules=', detail.parsed?.data?.modules?.length);

const quizzes = await j('GET', `/api/courses/${c0.id}/quizzes`);
const quiz = quizzes.parsed?.data?.[0];
console.log('GET /api/courses/:id/quizzes ->', quizzes.status,
  'leaks answer_index?', JSON.stringify(quizzes.parsed).includes('answer_index'),
  'questions=', quiz?.questions?.length);

const email = `probe+${Date.now()}@contoh.id`;
const enr = await j('POST', '/api/enrollments', {
  course_id: c0.id, learner_name: 'Probe Learner', learner_email: email,
});
console.log('POST /api/enrollments ->', enr.status, enr.parsed?.data?.id);
const enr2 = await j('POST', '/api/enrollments', {
  course_id: c0.id, learner_name: 'Probe Learner', learner_email: email,
});
console.log('POST /api/enrollments (idempotent) ->', enr2.status, 'same id?', enr2.parsed?.data?.id === enr.parsed?.data?.id);

const tooEarly = await j('POST', `/api/enrollments/${enr.parsed.data.id}/certificate`);
console.log('certificate BEFORE completion ->', tooEarly.status, tooEarly.parsed?.error?.message?.slice(0, 90));

// Submit quiz. The public projection hides the key, so the probe first fetches the answers by
// brute force: it submits once, reads correct_index from the released key, then re-submits.
const first = await j('POST', `/api/quizzes/${quiz.id}/submit`, {
  answers: (quiz?.questions ?? []).map((q) => ({ question_id: q.id, answer_index: 0 })),
  enrollment_id: enr.parsed.data.id,
});
const answerKey = new Map((first.parsed?.data?.per_question ?? []).map((p) => [p.question_id, p.correct_index]));
const answers = (quiz?.questions ?? []).map((q) => ({ question_id: q.id, answer_index: answerKey.get(q.id) ?? 0 }));
const sub = await j('POST', `/api/quizzes/${quiz.id}/submit`, { answers, enrollment_id: enr.parsed.data.id });
console.log('POST /api/quizzes/:id/submit ->', sub.status, 'score=', sub.parsed?.data?.score,
  'passed=', sub.parsed?.data?.passed,
  'recorded=', sub.parsed?.data?.recorded_for_enrollment,
  'per_question[0] has correct_index?', sub.parsed?.data?.per_question?.[0]?.correct_index !== undefined);

const full = await j('GET', `/api/enrollments/${enr.parsed.data.id}`);
for (const l of full.parsed?.data?.lessons ?? []) {
  await j('POST', `/api/enrollments/${enr.parsed.data.id}/progress`, { lesson_id: l.id, completed: true });
}
const after = await j('GET', `/api/enrollments/${enr.parsed.data.id}`);
console.log('progress after completing all ->', after.parsed?.data?.progress_pct, after.parsed?.data?.status,
  `${after.parsed?.data?.completed_lessons}/${after.parsed?.data?.total_lessons}`);

const cert = await j('POST', `/api/enrollments/${enr.parsed.data.id}/certificate`);
console.log('certificate AFTER completion ->', cert.status, cert.parsed?.data?.code, 'grade=', cert.parsed?.data?.grade);

const ver = await j('GET', `/api/certificates/verify/${cert.parsed?.data?.code}`);
console.log('verify valid ->', ver.status, 'valid=', ver.parsed?.data?.valid, ver.parsed?.data?.learner_name);

const bad = await j('GET', '/api/certificates/verify/QAT-2026-ZZZZZZ');
console.log('verify unknown ->', bad.status, 'valid=', bad.parsed?.data?.valid, bad.parsed?.data?.reason);

const html = await fetch(`${base}/api/certificates/${cert.parsed?.data?.id}/render?format=html`);
const body = await html.text();
console.log('render html ->', html.status, html.headers.get('content-type'),
  'has code?', body.includes(cert.parsed?.data?.code), 'bytes=', body.length);

await j('POST', `/api/certificates/${cert.parsed?.data?.id}/revoke`, { reason: 'uji probe' });
const ver2 = await j('GET', `/api/certificates/verify/${cert.parsed?.data?.code}`);
console.log('verify after revoke ->', ver2.status, 'valid=', ver2.parsed?.data?.valid, ver2.parsed?.data?.reason?.slice(0, 60));
