/**
 * MyLearningPage — enroll by email and track progress across courses.
 * Lane E. Route: /my-learning
 *
 * Enroll by email → list enrollments with progress bars → per-course next-lesson CTA → quiz status →
 * "Klaim e-Certificate" enabled ONLY when eligible, showing the concrete unmet requirement otherwise.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { toast } from '../../lib/toast';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, Progress } from '../../components';
import './learn.css';

interface CertificateLite {
  id: string;
  code: string;
  grade: string;
  issued_at: string;
  revoked: number;
}

interface EnrollmentRow {
  id: string;
  course_id: string;
  learner_name: string;
  learner_email: string;
  progress_pct: number;
  status: string;
  completed_at: string | null;
  course_title: string;
  course_slug: string;
  course_icon: string | null;
  course_pillar: string;
  total_lessons: number;
  certificate: CertificateLite | null;
}

interface EnrollmentDetail {
  id: string;
  progress_pct: number;
  status: string;
  total_lessons: number;
  completed_lessons: number;
  certificate: CertificateLite | null;
  lessons: Array<{ id: string; title: string; completed: number; code: string; module_title: string }>;
}

interface CourseOption {
  id: string;
  title: string;
  pillar: string;
  icon: string | null;
  lesson_count: number;
}

/** Why a certificate cannot be claimed yet — mirrors the server's 409 reasons. */
interface Eligibility {
  ready: boolean;
  reason: string;
}

export default function MyLearningPage() {
  const [email, setEmail] = useState<string>(() => localStorage.getItem('qatools.learner.email') ?? '');
  const [name, setName] = useState<string>(() => localStorage.getItem('qatools.learner.name') ?? '');

  const [rows, setRows] = useState<EnrollmentRow[]>([]);
  const [details, setDetails] = useState<Record<string, EnrollmentDetail>>({});
  const [eligible, setEligible] = useState<Record<string, Eligibility>>({});
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string>('');

  const activeEmail = email.trim().toLowerCase();

  /* ------------------------------ loading ------------------------------ */

  const loadCourses = useCallback(async () => {
    try {
      const res = await api.get<{ data: CourseOption[] }>('/courses');
      setCourses(res.data ?? []);
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadEnrollments = useCallback(async () => {
    if (!activeEmail) {
      setRows([]);
      setDetails({});
      setEligible({});
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: EnrollmentRow[] }>('/enrollments', { email: activeEmail });
      const list = res.data ?? [];
      setRows(list);

      // Detail + quiz status per enrollment, so we can show the concrete unmet requirement.
      const detailEntries = await Promise.all(
        list.map(async (e) => {
          try {
            const d = await api.get<{ data: EnrollmentDetail }>(`/enrollments/${e.id}`);
            return [e.id, d.data] as const;
          } catch {
            return null;
          }
        }),
      );
      const nextDetails: Record<string, EnrollmentDetail> = {};
      for (const entry of detailEntries) if (entry) nextDetails[entry[0]] = entry[1];
      setDetails(nextDetails);

      // Eligibility is derived from the same rules the server enforces.
      const nextEligible: Record<string, Eligibility> = {};
      for (const e of list) {
        const d = nextDetails[e.id];
        if (!d) {
          nextEligible[e.id] = { ready: false, reason: 'Gagal memuat detail progres.' };
          continue;
        }
        if (d.certificate) {
          nextEligible[e.id] = { ready: false, reason: 'Sertifikat sudah diterbitkan.' };
          continue;
        }
        const lessonsDone = d.completed_lessons >= d.total_lessons && d.total_lessons > 0;
        if (!lessonsDone) {
          nextEligible[e.id] = {
            ready: false,
            reason: `Selesaikan seluruh pelajaran dulu (${d.completed_lessons}/${d.total_lessons}).`,
          };
          continue;
        }
        // Lessons complete: the remaining gate is passing every quiz. The quizzes endpoint
        // tells us how many exist; the server enforces the pass check on claim.
        try {
          const qz = await api.get<{ data: Array<{ id: string; title: string; pass_score: number }> }>(
            `/courses/${e.course_id}/quizzes`,
          );
          const count = (qz.data ?? []).length;
          nextEligible[e.id] = {
            ready: true,
            reason: count
              ? `Siap diklaim setelah ${count} kuis lulus (server memverifikasi skor kuis).`
              : 'Siap diklaim.',
          };
        } catch {
          nextEligible[e.id] = { ready: true, reason: 'Siap diklaim.' };
        }
      }
      setEligible(nextEligible);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [activeEmail]);

  useEffect(() => {
    void loadCourses();
  }, [loadCourses]);

  useEffect(() => {
    void loadEnrollments();
  }, [loadEnrollments]);

  /* ------------------------------ actions ------------------------------ */

  function persistIdentity() {
    localStorage.setItem('qatools.learner.email', activeEmail);
    localStorage.setItem('qatools.learner.name', name.trim());
    toast.ok('Identitas pelajar disimpan');
    void loadEnrollments();
  }

  async function enrollIn(courseId: string) {
    if (!activeEmail) {
      toast.warn('Isi email terlebih dahulu');
      return;
    }
    setBusyId(courseId);
    try {
      await api.post('/enrollments', {
        course_id: courseId,
        learner_name: name.trim() || activeEmail.split('@')[0] || 'Pelajar',
        learner_email: activeEmail,
      });
      toast.ok('Berhasil terdaftar');
      await loadEnrollments();
    } catch (err) {
      toast.fromError(err, 'Gagal mendaftar');
    } finally {
      setBusyId('');
    }
  }

  async function claimCertificate(enrollmentId: string) {
    setBusyId(enrollmentId);
    try {
      const res = await api.post<{ data: { code: string; grade: string } }>(
        `/enrollments/${enrollmentId}/certificate`,
      );
      toast.ok(`e-Certificate diterbitkan: ${res.data.code} (grade ${res.data.grade})`);
      await loadEnrollments();
    } catch (err) {
      // A 409 carries the precise unmet requirement — surface it verbatim.
      if (err instanceof ApiError && err.status === 409) toast.warn(err.message);
      else toast.fromError(err, 'Gagal menerbitkan sertifikat');
    } finally {
      setBusyId('');
    }
  }

  const notEnrolled = courses.filter((c) => !rows.some((r) => r.course_id === c.id));

  return (
    <div className="stack">
      <PageHeader
        title="📈 Learning Saya"
        subtitle="Daftar kursus, lacak progres pelajaran, dan klaim e-Certificate setelah seluruh syarat terpenuhi."
        actions={
          <>
            <Link className="btn btn-ghost" to="/learn">
              ← Kurikulum
            </Link>
            <Link className="btn" to="/certificate">
              🏅 e-Certificate
            </Link>
          </>
        }
      />

      {/* ---------------------------- identity ---------------------------- */}
      <Card title="Identitas pelajar" subtitle="Email dipakai untuk menyimpan progres dan menerbitkan sertifikat.">
        <div className="row row-wrap">
          <input
            className="input"
            style={{ maxWidth: 240 }}
            placeholder="Nama lengkap"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="input"
            style={{ maxWidth: 280 }}
            placeholder="nama@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="btn btn-primary" onClick={persistIdentity}>
            Simpan &amp; muat
          </button>
        </div>
      </Card>

      {loading ? <Loading label="Memuat enrollment…" /> : null}
      {error ? <ErrorBox error={error} onRetry={() => void loadEnrollments()} /> : null}

      {/* -------------------------- enrollments -------------------------- */}
      {!loading && !error && activeEmail && rows.length === 0 ? (
        <Empty
          icon="🎓"
          title="Belum ada kursus yang diikuti"
          subtitle="Pilih kursus di bawah untuk mulai belajar."
        />
      ) : null}

      {rows.map((e) => {
        const d = details[e.id];
        const elig = eligible[e.id];
        const nextLesson = d?.lessons.find((l) => !l.completed);
        const done = d ? d.completed_lessons : 0;
        const total = d ? d.total_lessons : e.total_lessons;

        return (
          <Card key={e.id}>
            <div className="row-between row-wrap" style={{ marginBottom: 'var(--space-3)' }}>
              <div>
                <h3 className="card-title">
                  {e.course_icon ?? '📘'} {e.course_title}
                </h3>
                <div className="row row-wrap mute-sm" style={{ gap: 8, marginTop: 4 }}>
                  <Badge tone="muted">{e.course_pillar}</Badge>
                  <Badge tone={e.status === 'completed' ? 'ok' : 'info'}>
                    {e.status === 'completed' ? 'Selesai' : 'Berjalan'}
                  </Badge>
                  {e.certificate ? (
                    <Badge tone={e.certificate.revoked ? 'err' : 'accent'}>
                      🏅 {e.certificate.code}
                      {e.certificate.revoked ? ' (dicabut)' : ''}
                    </Badge>
                  ) : null}
                </div>
              </div>
              <Link className="btn btn-sm" to={`/learn/${e.course_id}`}>
                Buka kursus
              </Link>
            </div>

            <div className="row-between mute-sm">
              <span>Progres pelajaran</span>
              <span>
                {done}/{total} · {e.progress_pct.toFixed(0)}%
              </span>
            </div>
            <Progress
              value={e.progress_pct}
              tone={e.progress_pct >= 100 ? 'ok' : 'default'}
              large
            />

            <div className="row row-wrap" style={{ marginTop: 'var(--space-3)' }}>
              {nextLesson ? (
                <Link className="btn btn-sm btn-primary" to={`/learn/${e.course_id}`}>
                  ▶ Lanjutkan: {nextLesson.title}
                </Link>
              ) : (
                <Badge tone="ok">✅ Semua pelajaran selesai</Badge>
              )}

              {e.certificate ? (
                <Link className="btn btn-sm" to="/certificate">
                  Lihat e-Certificate
                </Link>
              ) : (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busyId === e.id || !elig?.ready}
                  title={elig?.reason ?? ''}
                  onClick={() => void claimCertificate(e.id)}
                >
                  {busyId === e.id ? 'Memproses…' : '🏅 Klaim e-Certificate'}
                </button>
              )}
            </div>

            {/* The concrete unmet requirement, never a vague "not eligible". */}
            {!e.certificate && elig && !elig.ready ? (
              <p className="mute-sm" style={{ marginTop: 8 }}>
                ⛔ Belum bisa diklaim: {elig.reason}
              </p>
            ) : null}
            {!e.certificate && elig?.ready ? (
              <p className="mute-sm" style={{ marginTop: 8 }}>
                ℹ️ {elig.reason} Bila ada kuis yang belum lulus, server akan menolak dengan alasannya.
              </p>
            ) : null}
          </Card>
        );
      })}

      {/* ------------------------ courses to enroll ---------------------- */}
      {activeEmail && notEnrolled.length ? (
        <Card title="Kursus lain yang tersedia" subtitle="Satu klik untuk mendaftar.">
          <div className="grid grid-auto">
            {notEnrolled.map((c) => (
              <div className="learn-enroll-tile" key={c.id}>
                <div className="strong">
                  {c.icon ?? '📘'} {c.title}
                </div>
                <div className="mute-sm">
                  {c.pillar} · {c.lesson_count} pelajaran
                </div>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busyId === c.id}
                  onClick={() => void enrollIn(c.id)}
                >
                  {busyId === c.id ? 'Mendaftar…' : 'Daftar'}
                </button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
