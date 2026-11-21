/**
 * CoursePage — course detail, lesson viewer and quiz runner.
 * Lane E. Route: /learn/:courseId
 *
 * Course tree → lesson reader (safe hand-rolled markdown) → "Tandai selesai" → lab deep links →
 * quiz runner with per-question feedback and retry.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { toast } from '../../lib/toast';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, Progress } from '../../components';
import { renderMarkdown } from './markdown';
import './learn.css';

/* ------------------------------- types ---------------------------------- */

interface Lesson {
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
}

interface Module {
  id: string;
  code: string;
  title: string;
  summary: string | null;
  order_index: number;
  lessons: Lesson[];
}

interface QuizMeta {
  id: string;
  title: string;
  pass_score: number;
  question_count: number;
}

interface CourseDetail {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  level: string;
  pillar: string;
  estimated_minutes: number;
  icon: string | null;
  module_count: number;
  lesson_count: number;
  quiz_count: number;
  modules: Module[];
  quizzes: QuizMeta[];
}

interface PublicQuestion {
  id: string;
  prompt: string;
  options: string[];
  points: number;
}

interface QuizFull {
  id: string;
  title: string;
  pass_score: number;
  questions: PublicQuestion[];
}

interface PerQuestion {
  question_id: string;
  prompt: string;
  given_index: number | null;
  correct: boolean;
  correct_index: number;
  explanation: string | null;
}

interface SubmitResult {
  score: number;
  passed: boolean;
  pass_score: number;
  earned_points: number;
  total_points: number;
  per_question: PerQuestion[];
}

interface Enrollment {
  id: string;
  progress_pct: number;
  status: string;
}

const LEVEL_LABEL: Record<string, string> = {
  beginner: 'Pemula',
  intermediate: 'Menengah',
  advanced: 'Lanjutan',
};

const KIND_ICON: Record<string, string> = {
  reading: '📖',
  video: '🎬',
  lab: '🧪',
  quiz: '❓',
};

/* --------------------------------- page --------------------------------- */

export default function CoursePage() {
  const { courseId = '' } = useParams();
  const navigate = useNavigate();

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [activeLessonId, setActiveLessonId] = useState<string>('');

  const email = (localStorage.getItem('qatools.learner.email') ?? '').trim();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [savingLesson, setSavingLesson] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: CourseDetail }>(`/courses/${courseId}`);
      setCourse(res.data);
      const first = res.data.modules?.[0]?.lessons?.[0];
      setActiveLessonId((prev) => prev || first?.id || '');
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Load the learner's enrollment + completed lessons for this course. */
  useEffect(() => {
    if (!email || !course) {
      setEnrollment(null);
      setCompleted(new Set());
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const res = await api.get<{ data: Array<Enrollment & { course_id: string }> }>('/enrollments', {
          email,
        });
        if (!alive) return;
        const mine = res.data.find((e) => e.course_id === course.id) ?? null;
        setEnrollment(mine);
        if (mine) {
          const detail = await api.get<{
            data: { lessons: Array<{ id: string; completed: number }> };
          }>(`/enrollments/${mine.id}`);
          if (!alive) return;
          setCompleted(new Set(detail.data.lessons.filter((l) => l.completed).map((l) => l.id)));
        } else {
          setCompleted(new Set());
        }
      } catch {
        /* progress overlay is optional */
      }
    })();
    return () => {
      alive = false;
    };
  }, [email, course]);

  const allLessons = useMemo(
    () => (course?.modules ?? []).flatMap((m) => m.lessons),
    [course],
  );
  const activeLesson = useMemo(
    () => allLessons.find((l) => l.id === activeLessonId) ?? allLessons[0] ?? null,
    [allLessons, activeLessonId],
  );

  const progressPct = allLessons.length
    ? Number(((completed.size / allLessons.length) * 100).toFixed(1))
    : 0;

  async function enroll() {
    try {
      const res = await api.post<{ data: Enrollment }>('/enrollments', {
        course_id: course?.id,
        learner_name: email.split('@')[0] || 'Pelajar',
        learner_email: email,
      });
      setEnrollment(res.data);
      setCompleted(new Set());
      toast.ok('Berhasil terdaftar di kursus ini');
    } catch (err) {
      toast.fromError(err, 'Gagal mendaftar');
    }
  }

  async function toggleLesson(lesson: Lesson, next: boolean) {
    if (!enrollment) {
      toast.warn('Daftar kursus terlebih dahulu untuk menyimpan progres');
      return;
    }
    setSavingLesson(true);
    try {
      const res = await api.post<{
        data: { enrollment: Enrollment; progress_pct: number };
      }>(`/enrollments/${enrollment.id}/progress`, { lesson_id: lesson.id, completed: next });
      setEnrollment(res.data.enrollment);
      setCompleted((prev) => {
        const copy = new Set(prev);
        if (next) copy.add(lesson.id);
        else copy.delete(lesson.id);
        return copy;
      });
      toast.ok(next ? 'Pelajaran ditandai selesai' : 'Tanda selesai dibatalkan');
    } catch (err) {
      toast.fromError(err, 'Gagal menyimpan progres');
    } finally {
      setSavingLesson(false);
    }
  }

  if (loading) return <Loading label="Memuat kursus…" />;
  if (error) return <ErrorBox error={error} onRetry={() => void load()} />;
  if (!course) return <Empty title="Kursus tidak ditemukan" />;

  const isDone = activeLesson ? completed.has(activeLesson.id) : false;

  return (
    <div className="stack">
      <PageHeader
        title={
          <>
            {course.icon ?? '📘'} {course.title}
          </>
        }
        subtitle={course.subtitle ?? undefined}
        badge={<Badge tone="muted">{LEVEL_LABEL[course.level] ?? course.level}</Badge>}
        actions={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/learn')}>
              ← Kurikulum
            </button>
            {course.quizzes.length ? (
              <a className="btn btn-sm" href="#kuis">
                ❓ Kuis
              </a>
            ) : null}
          </>
        }
      />

      {course.description ? <p className="muted">{course.description}</p> : null}

      {/* ------------------------ progress / enroll ------------------------ */}
      <Card>
        {!email ? (
          <div className="row-between row-wrap">
            <span className="muted">
              Isi email di <Link className="link-btn" to="/my-learning">Learning Saya</Link> untuk
              menyimpan progres dan mengklaim e-Certificate.
            </span>
            <Link className="btn btn-primary btn-sm" to="/my-learning">
              Daftar kursus
            </Link>
          </div>
        ) : !enrollment ? (
          <div className="row-between row-wrap">
            <span className="muted">
              Anda belum terdaftar pada kursus ini. Daftar untuk menyimpan progres dan membuka
              e-Certificate.
            </span>
            <button className="btn btn-primary btn-sm" onClick={() => void enroll()}>
              Daftar kursus ini
            </button>
          </div>
        ) : (
          <div>
            <div className="row-between">
              <span className="strong">Progres kursus</span>
              <span className="mute-sm">
                {completed.size}/{allLessons.length} pelajaran · {progressPct.toFixed(0)}%
              </span>
            </div>
            <Progress value={progressPct} tone={progressPct >= 100 ? 'ok' : 'default'} large />
            {progressPct >= 100 ? (
              <div className="row-between row-wrap" style={{ marginTop: 'var(--space-3)' }}>
                <Badge tone="ok">✅ Seluruh pelajaran selesai</Badge>
                <Link className="btn btn-primary btn-sm" to="/my-learning">
                  🏅 Klaim e-Certificate
                </Link>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {/* --------------------------- two columns --------------------------- */}
      <div className="learn-split">
        {/* module/lesson tree */}
        <aside className="learn-tree">
          {course.modules.map((m) => (
            <div key={m.id} className="learn-tree-module">
              <div className="learn-tree-module-head">
                <span className="cell-mono">{m.code}</span>
                <span className="strong">{m.title}</span>
              </div>
              {m.summary ? <p className="mute-sm" style={{ margin: '0 0 6px' }}>{m.summary}</p> : null}
              {m.lessons.map((l) => (
                <button
                  key={l.id}
                  className={`learn-tree-item ${l.id === activeLesson?.id ? 'active' : ''} ${
                    completed.has(l.id) ? 'done' : ''
                  }`}
                  onClick={() => setActiveLessonId(l.id)}
                >
                  <span>{completed.has(l.id) ? '✅' : KIND_ICON[l.kind] ?? '📄'}</span>
                  <span className="learn-tree-item-title">{l.title}</span>
                  <span className="mute-sm">{l.duration_minutes}m</span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        {/* lesson viewer */}
        <div className="stack" style={{ minWidth: 0 }}>
          {activeLesson ? (
            <Card>
              <div className="row-between row-wrap" style={{ marginBottom: 'var(--space-3)' }}>
                <div>
                  <div className="row row-wrap" style={{ gap: 6 }}>
                    <Badge tone="muted">{activeLesson.code}</Badge>
                    <Badge tone="info">{KIND_ICON[activeLesson.kind]} {activeLesson.kind}</Badge>
                    <Badge tone="muted">⏱ {activeLesson.duration_minutes} menit</Badge>
                  </div>
                  <h2 className="card-title" style={{ marginTop: 8 }}>
                    {activeLesson.title}
                  </h2>
                </div>
                <div className="row">
                  {activeLesson.lab_ref ? (
                    <Link className="btn btn-sm" to={activeLesson.lab_ref}>
                      🧪 Buka lab: {activeLesson.lab_ref}
                    </Link>
                  ) : null}
                  <button
                    className={`btn btn-sm ${isDone ? 'btn-ghost' : 'btn-primary'}`}
                    disabled={savingLesson}
                    onClick={() => void toggleLesson(activeLesson, !isDone)}
                  >
                    {savingLesson ? 'Menyimpan…' : isDone ? '↩ Batalkan selesai' : '✓ Tandai selesai'}
                  </button>
                </div>
              </div>

              <div
                className="learn-md"
                // Safe: renderMarkdown escapes the source BEFORE applying any markup.
                dangerouslySetInnerHTML={{ __html: renderMarkdown(activeLesson.content_md) }}
              />

              <div className="row-between row-wrap" style={{ marginTop: 'var(--space-4)' }}>
                <span className="mute-sm">
                  {completed.size}/{allLessons.length} pelajaran selesai
                </span>
                <NextLessonButton
                  lessons={allLessons}
                  currentId={activeLesson.id}
                  onGo={setActiveLessonId}
                />
              </div>
            </Card>
          ) : (
            <Empty title="Kursus ini belum memiliki pelajaran" />
          )}
        </div>
      </div>

      {/* ------------------------------ quizzes ---------------------------- */}
      {course.quizzes.length ? (
        <div id="kuis" className="stack">
          {course.quizzes.map((q) => (
            <QuizRunner
              key={q.id}
              quizMeta={q}
              courseId={course.id}
              enrollmentId={enrollment?.id ?? null}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------- next-lesson button -------------------------- */

function NextLessonButton({
  lessons,
  currentId,
  onGo,
}: {
  lessons: Lesson[];
  currentId: string;
  onGo: (id: string) => void;
}) {
  const idx = lessons.findIndex((l) => l.id === currentId);
  const next = idx >= 0 ? lessons[idx + 1] : undefined;
  if (!next) return <Badge tone="ok">Ini pelajaran terakhir</Badge>;
  return (
    <button className="btn btn-sm" onClick={() => onGo(next.id)}>
      Pelajaran berikutnya: {next.title} →
    </button>
  );
}

/* ------------------------------ quiz runner ------------------------------ */

function QuizRunner({
  quizMeta,
  courseId,
  enrollmentId,
}: {
  quizMeta: QuizMeta;
  courseId: string;
  enrollmentId: string | null;
}) {
  const [quiz, setQuiz] = useState<QuizFull | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  /** Fetches the quiz WITHOUT the answer key (the read route never exposes it). */
  const start = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setAnswers({});
    try {
      const res = await api.get<{ data: QuizFull[] }>(`/courses/${courseId}/quizzes`);
      const found = (res.data ?? []).find((q) => q.id === quizMeta.id) ?? null;
      setQuiz(found);
      if (!found) setError(new ApiError('Kuis tidak ditemukan', 'not_found', 404));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [courseId, quizMeta.id]);

  useEffect(() => {
    void start();
  }, [start]);

  async function submit() {
    if (!quiz) return;
    setBusy(true);
    try {
      const res = await api.post<{ data: SubmitResult }>(`/quizzes/${quiz.id}/submit`, {
        answers: quiz.questions.map((q) => ({
          question_id: q.id,
          answer_index: answers[q.id] ?? -1,
        })),
        enrollment_id: enrollmentId ?? undefined,
      });
      setResult(res.data);
      if (res.data.passed) toast.ok(`Lulus dengan skor ${res.data.score}`);
      else toast.warn(`Skor ${res.data.score} — minimal ${res.data.pass_score} untuk lulus`);
    } catch (err) {
      toast.fromError(err, 'Gagal mengirim jawaban');
    } finally {
      setBusy(false);
    }
  }

  const answeredCount = Object.keys(answers).length;

  return (
    <Card
      title={`❓ ${quizMeta.title}`}
      subtitle={`${quizMeta.question_count} soal · nilai minimal ${quizMeta.pass_score} untuk lulus`}
      actions={
        result ? (
          <button className="btn btn-sm" onClick={() => void start()}>
            ↻ Ulangi
          </button>
        ) : null
      }
    >
      {loading ? <Loading label="Memuat soal…" /> : null}
      {error ? <ErrorBox error={error} onRetry={() => void start()} /> : null}

      {quiz && !result ? (
        <div className="stack">
          {quiz.questions.map((q, qi) => (
            <div className="learn-quiz-q" key={q.id}>
              <div className="strong">
                {qi + 1}. {q.prompt}
              </div>
              <div className="stack stack-sm" style={{ marginTop: 8 }}>
                {q.options.map((opt, oi) => (
                  <label
                    className={`learn-opt ${answers[q.id] === oi ? 'selected' : ''}`}
                    key={oi}
                  >
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      checked={answers[q.id] === oi}
                      onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: oi }))}
                    />
                    <span className="cell-mono">{String.fromCharCode(65 + oi)}.</span>
                    <span>{opt}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="row-between row-wrap">
            <span className="mute-sm">
              {answeredCount}/{quiz.questions.length} soal dijawab
              {!enrollmentId ? ' · daftar kursus agar hasil tersimpan untuk e-Certificate' : ''}
            </span>
            <button
              className="btn btn-primary"
              disabled={busy || answeredCount < quiz.questions.length}
              onClick={() => void submit()}
            >
              {busy ? 'Mengirim…' : 'Kirim jawaban'}
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="stack">
          <div className={`alert ${result.passed ? 'alert-ok' : 'alert-err'}`}>
            <span>{result.passed ? '✅' : '❌'}</span>
            <div>
              <div className="strong">
                {result.passed ? 'LULUS' : 'BELUM LULUS'} — skor {result.score}
              </div>
              <div>
                {result.earned_points}/{result.total_points} poin · nilai minimal {result.pass_score}
              </div>
            </div>
          </div>

          {result.per_question.map((p, i) => (
            <div className={`learn-quiz-q ${p.correct ? 'ok' : 'err'}`} key={p.question_id}>
              <div className="row-between row-wrap">
                <span className="strong">
                  {p.correct ? '✅' : '❌'} {i + 1}. {p.prompt}
                </span>
                <Badge tone={p.correct ? 'ok' : 'err'}>
                  {p.correct ? 'Benar' : `Kunci: ${String.fromCharCode(65 + p.correct_index)}`}
                </Badge>
              </div>
              {p.explanation ? (
                <p className="mute-sm" style={{ marginTop: 6 }}>
                  💡 {p.explanation}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
