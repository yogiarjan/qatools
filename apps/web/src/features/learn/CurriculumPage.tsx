/**
 * CurriculumPage — the QA course catalog.
 * Lane E. Route: /learn
 *
 * Presents the four pills advertised by the course photo as explicit value propositions, then the
 * pillar → course map from GET /api/curriculum/overview.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, Progress } from '../../components';
import './learn.css';

/* ------------------------------- types ---------------------------------- */

interface CourseCard {
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
}

interface PillarGroup {
  pillar: string;
  kind: 'pill' | 'course';
  course_count: number;
  lesson_count: number;
  courses: CourseCard[];
}

interface Overview {
  pills: string[];
  photo_items: string[];
  pillars: string[];
  totals: {
    courses: number;
    modules: number;
    lessons: number;
    labs: number;
    quizzes: number;
    estimated_minutes: number;
  };
  groups: PillarGroup[];
}

/* ----------------------------- constants -------------------------------- */

/** The four pills from the photo, each elaborated into a concrete promise. */
const PILL_DETAIL: Record<string, { icon: string; blurb: string }> = {
  'e-Certificate': {
    icon: '🏅',
    blurb: 'Sertifikat digital dengan kode unik, grade, dan SHA-256 yang bisa diverifikasi publik.',
  },
  'Materi & Praktik': {
    icon: '🧪',
    blurb: 'Setiap konsep langsung dipraktikkan di fitur QATools — dari kebutuhan sampai metrik.',
  },
  'Belajar Online': {
    icon: '💻',
    blurb: 'Belajar mandiri dengan progres tersimpan: tandai pelajaran selesai dan lanjut kapan saja.',
  },
  'Bangun Portofolio': {
    icon: '🏆',
    blurb: 'Artefak nyata (use case, matrix, otomasi, metrik) dikemas menjadi bukti kompetensi.',
  },
};

const LEVEL_LABEL: Record<string, string> = {
  beginner: 'Pemula',
  intermediate: 'Menengah',
  advanced: 'Lanjutan',
};

const PILLAR_ICON: Record<string, string> = {
  'QA Introduction': '🎓',
  'QA Test Technique': '🧠',
  'QA Test Activity': '🗂️',
  'Basic QA Automation': '🤖',
  'API Automation': '🔌',
  'Web Automation': '🌐',
  'Database Testing': '🗄️',
  'Materi & Praktik': '🧪',
  'Bangun Portofolio': '🏆',
  'e-Certificate': '🏅',
};

function toneForLevel(level: string): 'ok' | 'info' | 'accent' {
  if (level === 'beginner') return 'ok';
  if (level === 'advanced') return 'accent';
  return 'info';
}

function fmtMinutes(total: number): string {
  if (!total) return '—';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h} jam ${m} mnt`;
  if (h) return `${h} jam`;
  return `${m} menit`;
}

/* --------------------------------- page --------------------------------- */

export default function CurriculumPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [pillar, setPillar] = useState<string>('semua');
  const [email, setEmail] = useState<string>(() => localStorage.getItem('qatools.learner.email') ?? '');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: Overview }>('/curriculum/overview');
      setData(res.data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    if (!data) return [];
    // Pills are rendered separately; the grid shows teachable pillar groups.
    return data.groups.filter((g) => g.kind !== 'pill' && g.courses.length > 0);
  }, [data]);

  const visible = useMemo(() => {
    if (pillar === 'semua') return groups;
    return groups.filter((g) => g.pillar === pillar);
  }, [groups, pillar]);

  if (loading) return <Loading label="Memuat kurikulum…" />;
  if (error) return <ErrorBox error={error} onRetry={() => void load()} />;
  if (!data) return <Empty title="Kurikulum belum tersedia" />;

  const { totals } = data;

  return (
    <div className="stack">
      <PageHeader
        title="Kurikulum Software Quality Assurance"
        subtitle="Sembilan kursus, dari fondasi QA sampai otomasi API, web, dan database — lengkap dengan praktik langsung di QATools."
        badge={<Badge tone="accent">{totals.courses} kursus</Badge>}
        actions={
          <>
            <Link className="btn" to="/my-learning">
              📈 Learning Saya
            </Link>
            <Link className="btn btn-primary" to="/certificate">
              🏅 e-Certificate
            </Link>
          </>
        }
      />

      {/* ---------------- the four pills from the photo ---------------- */}
      <section className="learn-pills">
        {data.pills.map((p) => {
          const detail = PILL_DETAIL[p];
          return (
            <div className="learn-pill" key={p}>
              <span className="learn-pill-icon">{detail?.icon ?? '✨'}</span>
              <div>
                <div className="learn-pill-title">{p}</div>
                <div className="learn-pill-blurb">{detail?.blurb ?? ''}</div>
              </div>
            </div>
          );
        })}
      </section>

      {/* ---------------------------- totals ---------------------------- */}
      <div className="grid grid-4">
        <Card>
          <div className="stat">
            <span className="stat-label">Kursus</span>
            <span className="stat-value">{totals.courses}</span>
            <span className="stat-delta">{totals.modules} modul</span>
          </div>
        </Card>
        <Card>
          <div className="stat">
            <span className="stat-label">Pelajaran</span>
            <span className="stat-value">{totals.lessons}</span>
            <span className="stat-delta">materi bacaan & lab</span>
          </div>
        </Card>
        <Card>
          <div className="stat">
            <span className="stat-label">Lab praktik</span>
            <span className="stat-value">{totals.labs}</span>
            <span className="stat-delta">tautan langsung ke fitur</span>
          </div>
        </Card>
        <Card>
          <div className="stat">
            <span className="stat-label">Total durasi</span>
            <span className="stat-value">{Math.round(totals.estimated_minutes / 60)}</span>
            <span className="stat-delta">jam belajar</span>
          </div>
        </Card>
      </div>

      {/* --------------------------- email ----------------------------- */}
      <Card
        title="Progres Anda"
        subtitle="Masukkan email untuk melihat progres pada kartu kursus (opsional)."
      >
        <div className="row">
          <input
            className="input"
            placeholder="nama@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            className="btn btn-primary"
            onClick={() => {
              localStorage.setItem('qatools.learner.email', email.trim());
              toast.ok(email.trim() ? 'Email disimpan' : 'Email dikosongkan');
              void load();
            }}
          >
            Terapkan
          </button>
          <Link className="btn btn-ghost" to="/my-learning">
            Kelola enrollment →
          </Link>
        </div>
      </Card>

      {/* --------------------------- filters --------------------------- */}
      <div className="toolbar row-wrap">
        <button
          className={`chip ${pillar === 'semua' ? 'chip-active' : ''}`}
          onClick={() => setPillar('semua')}
        >
          Semua ({groups.reduce((s, g) => s + g.course_count, 0)})
        </button>
        {groups.map((g) => (
          <button
            key={g.pillar}
            className={`chip ${pillar === g.pillar ? 'chip-active' : ''}`}
            onClick={() => setPillar(g.pillar)}
          >
            {PILLAR_ICON[g.pillar] ?? '📘'} {g.pillar} ({g.course_count})
          </button>
        ))}
      </div>

      {/* ---------------------------- courses -------------------------- */}
      {visible.length === 0 ? (
        <Empty
          icon="🎓"
          title="Belum ada kursus pada pilar ini"
          subtitle="Jalankan seeder kurikulum: pnpm -F @qatools/api seed"
        />
      ) : (
        visible.map((g) => (
          <section key={g.pillar} className="stack">
            <div className="row-between">
              <h2 className="card-title">
                {PILLAR_ICON[g.pillar] ?? '📘'} {g.pillar}
              </h2>
              <span className="mute-sm">
                {g.course_count} kursus · {g.lesson_count} pelajaran
              </span>
            </div>
            <div className="grid grid-auto">
              {g.courses.map((c) => (
                <CourseTile key={c.id} course={c} />
              ))}
            </div>
          </section>
        ))
      )}

      {/* --------------- "dan masih banyak lagi" elaboration ------------ */}
      <Card
        title="Dan masih banyak lagi"
        subtitle="Item kurikulum dari brosur, ditambah dua jalur yang melengkapinya."
      >
        <div className="row row-wrap">
          {data.photo_items.map((item) => (
            <span className="chip chip-active" key={item}>
              ✅ {item}
            </span>
          ))}
          <span className="chip chip-active">✅ Materi & Praktik: Studi Kasus End-to-End</span>
          <span className="chip chip-active">✅ Bangun Portofolio QA</span>
          <span className="chip chip-active">✅ e-Certificate &amp; Verifikasi Publik</span>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------ course tile ----------------------------- */

function CourseTile({ course }: { course: CourseCard }) {
  const progressPct = Number(
    (course as CourseCard & { progress_pct?: number }).progress_pct ?? 0,
  );

  return (
    <Card className="learn-course-card">
      <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <span className="learn-course-icon">{course.icon ?? '📘'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row row-wrap" style={{ gap: 5, marginBottom: 4 }}>
            <Badge tone={toneForLevel(course.level)}>{LEVEL_LABEL[course.level] ?? course.level}</Badge>
            <Badge tone="muted">⏱ {fmtMinutes(course.estimated_minutes)}</Badge>
          </div>
          <h3 className="card-title" style={{ marginBottom: 4 }}>
            {course.title}
          </h3>
          {course.subtitle ? <p className="card-sub">{course.subtitle}</p> : null}
        </div>
      </div>

      <div className="row row-wrap mute-sm" style={{ marginTop: 'var(--space-3)' }}>
        <span>📦 {course.module_count} modul</span>
        <span>📄 {course.lesson_count} pelajaran</span>
        <span>❓ {course.quiz_count} kuis</span>
      </div>

      {progressPct > 0 ? (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <div className="row-between mute-sm">
            <span>Progres</span>
            <span>{progressPct.toFixed(0)}%</span>
          </div>
          <Progress value={progressPct} tone={progressPct >= 100 ? 'ok' : 'default'} />
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 'var(--space-3)' }}>
        <Link className="btn btn-primary btn-sm" to={`/learn/${course.id}`}>
          Buka kursus
        </Link>
      </div>
    </Card>
  );
}
