/**
 * CertificatePage — issued e-Certificates for a learner.
 * Lane E. Route: /certificate
 *
 * List by email → detail/preview mirroring the server-rendered HTML → open the print-ready HTML in a
 * new tab → copy code/hash → revoke with a reason.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { toast } from '../../lib/toast';
import { Badge, Card, ConfirmDialog, Empty, ErrorBox, Field, Loading, Modal, PageHeader } from '../../components';
import '../learn/learn.css';

interface Certificate {
  id: string;
  code: string;
  enrollment_id: string;
  course_id: string;
  learner_name: string;
  course_title: string;
  issued_at: string;
  score: number;
  grade: string;
  verification_hash: string;
  revoked: number;
  revoked_reason: string | null;
}

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

/* --------------------------------- page --------------------------------- */

export default function CertificatePage() {
  const [email, setEmail] = useState<string>(() => localStorage.getItem('qatools.learner.email') ?? '');
  const [items, setItems] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<Certificate | null>(null);
  const [revoking, setRevoking] = useState<Certificate | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const activeEmail = email.trim().toLowerCase();

  const load = useCallback(async () => {
    if (!activeEmail) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: Certificate[] }>('/certificates', { email: activeEmail });
      setItems(res.data ?? []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [activeEmail]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const active = items.filter((c) => !c.revoked).length;
    return { total: items.length, active, revoked: items.length - active };
  }, [items]);

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.ok(`${label} disalin`);
    } catch {
      toast.err('Gagal menyalin — salin manual dari kotak di bawah');
    }
  }

  async function doRevoke() {
    if (!revoking) return;
    const reason = revokeReason.trim();
    if (!reason) {
      toast.warn('Alasan pencabutan wajib diisi');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/certificates/${revoking.id}/revoke`, { reason });
      toast.ok('Sertifikat dicabut');
      setRevoking(null);
      setRevokeReason('');
      setConfirmRevoke(false);
      setSelected(null);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) toast.warn(err.message);
      else toast.fromError(err, 'Gagal mencabut sertifikat');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <PageHeader
        title="🏅 e-Certificate"
        subtitle="Sertifikat digital dengan kode unik, grade, dan sidik SHA-256 yang bisa diverifikasi publik."
        badge={stats.total ? <Badge tone="accent">{stats.active} aktif</Badge> : undefined}
        actions={
          <>
            <Link className="btn btn-ghost" to="/my-learning">
              ← Learning Saya
            </Link>
            <Link className="btn" to="/verify">
              ✅ Verifikasi
            </Link>
          </>
        }
      />

      <Card title="Cari sertifikat" subtitle="Masukkan email yang dipakai saat mendaftar kursus.">
        <div className="row row-wrap">
          <input
            className="input"
            style={{ maxWidth: 300 }}
            placeholder="nama@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            className="btn btn-primary"
            onClick={() => {
              localStorage.setItem('qatools.learner.email', activeEmail);
              void load();
            }}
          >
            Tampilkan
          </button>
        </div>
      </Card>

      {loading ? <Loading label="Memuat sertifikat…" /> : null}
      {error ? <ErrorBox error={error} onRetry={() => void load()} /> : null}

      {!loading && !error && activeEmail && items.length === 0 ? (
        <Empty
          icon="🏅"
          title="Belum ada e-Certificate"
          subtitle="Selesaikan seluruh pelajaran dan lulus semua kuis pada sebuah kursus, lalu klaim sertifikat di halaman Learning Saya."
          action={
            <Link className="btn btn-primary" to="/my-learning">
              Ke Learning Saya
            </Link>
          }
        />
      ) : null}

      {!loading && !activeEmail ? (
        <Empty icon="✉️" title="Masukkan email" subtitle="Masukkan email pelajar untuk menampilkan sertifikat." />
      ) : null}

      {items.length ? (
        <div className="grid grid-auto">
          {items.map((c) => (
            <Card key={c.id} className="cert-card">
              <div className="row-between row-wrap">
                <Badge tone={c.revoked ? 'err' : 'ok'}>{c.revoked ? 'Dicabut' : 'Aktif'}</Badge>
                <Badge tone="accent">Grade {c.grade}</Badge>
              </div>
              <h3 className="card-title" style={{ marginTop: 10 }}>
                {c.course_title}
              </h3>
              <div className="cert-code">{c.code}</div>
              <div className="mute-sm" style={{ marginTop: 6 }}>
                {c.learner_name} · terbit {fmtDate(c.issued_at)} · skor {c.score}
              </div>
              {c.revoked && c.revoked_reason ? (
                <p className="mute-sm" style={{ color: 'var(--err)' }}>
                  ⛔ {c.revoked_reason}
                </p>
              ) : null}
              <div className="row row-wrap" style={{ marginTop: 'var(--space-3)' }}>
                <button className="btn btn-sm btn-primary" onClick={() => setSelected(c)}>
                  Lihat detail
                </button>
                <a
                  className="btn btn-sm"
                  href={`${API_BASE}/certificates/${c.id}/render?format=html`}
                  target="_blank"
                  rel="noreferrer"
                >
                  🖨 Buka versi cetak
                </a>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {/* --------------------------- detail modal --------------------------- */}
      {selected ? (
        <Modal
          title={`Sertifikat ${selected.code}`}
          onClose={() => setSelected(null)}
          size="lg"
          footer={
            <>
              <button className="btn" onClick={() => setSelected(null)}>
                Tutup
              </button>
              <button className="btn" onClick={() => void copy(selected.code, 'Kode')}>
                Salin kode
              </button>
              <button className="btn" onClick={() => void copy(selected.verification_hash, 'Sidik')}>
                Salin sidik
              </button>
              <a
                className="btn btn-primary"
                href={`${API_BASE}/certificates/${selected.id}/render?format=html`}
                target="_blank"
                rel="noreferrer"
              >
                🖨 Buka versi cetak
              </a>
              {!selected.revoked ? (
                <button className="btn btn-danger" onClick={() => setRevoking(selected)}>
                  Cabut sertifikat
                </button>
              ) : null}
            </>
          }
        >
          {/* Preview mirroring the server-rendered HTML layout. */}
          <div className={`cert-preview ${selected.revoked ? 'revoked' : ''}`}>
            <div className="cert-preview-band" />
            {selected.revoked ? (
              <div className="cert-preview-revoked">
                SERTIFIKAT DICABUT{selected.revoked_reason ? ` — ${selected.revoked_reason}` : ''}
              </div>
            ) : null}
            <div className="cert-preview-inner">
              <div className="row-between">
                <div className="cert-preview-logo">Q</div>
                <div className="mute-sm" style={{ textAlign: 'right' }}>
                  <div className="strong">QATools Academy</div>
                  Sertifikat Kompetensi Quality Assurance
                </div>
              </div>
              <div className="cert-preview-kicker">Sertifikat Penyelesaian</div>
              <div className="cert-preview-code">Kode: {selected.code}</div>
              <div className="cert-preview-name">{selected.learner_name}</div>
              <p className="muted">telah menyelesaikan seluruh materi dan kuis pada kursus</p>
              <div className="cert-preview-course">{selected.course_title}</div>
              <div className="cert-preview-meta">
                <div>
                  <div className="cert-preview-meta-k">Tanggal terbit</div>
                  <div className="cert-preview-meta-v">{fmtDate(selected.issued_at)}</div>
                </div>
                <div>
                  <div className="cert-preview-meta-k">Skor rata-rata kuis</div>
                  <div className="cert-preview-meta-v">{selected.score}</div>
                </div>
                <div>
                  <div className="cert-preview-meta-k">Grade</div>
                  <div className="cert-preview-meta-v">
                    <span className="cert-preview-grade">{selected.grade}</span>
                  </div>
                </div>
              </div>
              <div className="cert-preview-hash">
                <div className="cert-preview-meta-k">Sidik verifikasi (SHA-256)</div>
                <code>{selected.verification_hash}</code>
              </div>
              <p className="mute-sm" style={{ marginTop: 12 }}>
                Verifikasi publik:{' '}
                <Link className="link-btn" to={`/verify/${selected.code}`}>
                  /verify/{selected.code}
                </Link>
              </p>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* --------------------------- revoke modal --------------------------- */}
      {revoking ? (
        <Modal
          title={`Cabut sertifikat ${revoking.code}`}
          onClose={() => {
            setRevoking(null);
            setRevokeReason('');
          }}
          size="sm"
          footer={
            <>
              <button
                className="btn"
                onClick={() => {
                  setRevoking(null);
                  setRevokeReason('');
                }}
              >
                Batal
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => setConfirmRevoke(true)}>
                Lanjutkan
              </button>
            </>
          }
        >
          <div className="alert alert-warn">
            <span>⚠️</span>
            <div>
              Mencabut sertifikat membuat verifikasi publiknya menjadi <strong>TIDAK VALID</strong> secara
              permanen. Tindakan ini tidak dapat dibatalkan.
            </div>
          </div>
          <Field label="Alasan pencabutan" required hint="Alasan ini akan tampil pada hasil verifikasi publik.">
            <input
              className="input"
              value={revokeReason}
              placeholder="cth. salah input data peserta"
              onChange={(e) => setRevokeReason(e.target.value)}
            />
          </Field>
        </Modal>
      ) : null}

      {confirmRevoke && revoking ? (
        <ConfirmDialog
          title="Konfirmasi pencabutan"
          danger
          busy={busy}
          confirmLabel="Cabut sekarang"
          message={
            <>
              Sertifikat <strong>{revoking.code}</strong> milik {revoking.learner_name} akan dicabut dengan
              alasan “{revokeReason}”. Verifikasi publik akan menampilkan status tidak valid.
            </>
          }
          onCancel={() => setConfirmRevoke(false)}
          onConfirm={() => void doRevoke()}
        />
      ) : null}
    </div>
  );
}
