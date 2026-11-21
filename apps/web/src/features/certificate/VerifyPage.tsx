/**
 * VerifyPage — public certificate verification.
 * Lane E. Routes: /verify  and  /verify/:code
 *
 * Reads the `code` route param so /verify/QAT-2026-XXXXXX deep links work directly.
 * Shows a clear VALID (green) or INVALID (red) verdict with the reason.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';
import { Card, Empty, ErrorBox, Loading, PageHeader } from '../../components';
import '../learn/learn.css';

interface Certificate {
  id: string;
  code: string;
  learner_name: string;
  course_title: string;
  issued_at: string;
  score: number;
  grade: string;
  verification_hash: string;
  revoked: number;
  revoked_reason: string | null;
}

interface Verification {
  valid: boolean;
  certificate?: Certificate;
  reason?: string;
  learner_name?: string;
  course_title?: string;
  issued_at?: string;
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Accepts a bare code or a full verification URL and returns the code. */
function extractCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const afterVerify = trimmed.split('/verify/')[1];
  const candidate = afterVerify ?? trimmed;
  return decodeURIComponent(candidate.split(/[?#]/)[0] ?? '').trim();
}

export default function VerifyPage() {
  const { code: routeCode } = useParams();
  const navigate = useNavigate();

  const [input, setInput] = useState(routeCode ?? '');
  const [result, setResult] = useState<Verification | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [checked, setChecked] = useState('');

  const verify = useCallback(async (raw: string) => {
    const code = extractCode(raw);
    if (!code) {
      setResult(null);
      setChecked('');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: Verification }>(
        `/certificates/verify/${encodeURIComponent(code.toUpperCase())}`,
      );
      setResult(res.data);
      setChecked(code.toUpperCase());
    } catch (err) {
      setError(err);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Deep link: /verify/:code verifies immediately.
  useEffect(() => {
    if (routeCode) {
      setInput(routeCode);
      void verify(routeCode);
    } else {
      setResult(null);
      setChecked('');
    }
  }, [routeCode, verify]);

  function submit() {
    const code = extractCode(input);
    if (!code) {
      toast.warn('Masukkan kode sertifikat');
      return;
    }
    // Reflect the code in the URL so the result is shareable / bookmarkable.
    navigate(`/verify/${encodeURIComponent(code.toUpperCase())}`, { replace: false });
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.ok('Disalin');
    } catch {
      toast.err('Gagal menyalin');
    }
  }

  return (
    <div className="stack">
      <PageHeader
        title="✅ Verifikasi Sertifikat"
        subtitle="Periksa keaslian e-Certificate QATools. Verifikasi bersifat publik dan tidak memerlukan login."
        actions={
          <Link className="btn btn-ghost" to="/certificate">
            🏅 e-Certificate
          </Link>
        }
      />

      <Card title="Masukkan kode sertifikat" subtitle="Format: QAT-TAHUN-XXXXXX, atau tempel tautan verifikasi.">
        <div className="row row-wrap">
          <input
            className="input"
            style={{ maxWidth: 340, fontFamily: 'var(--mono)' }}
            placeholder="QAT-2026-ABC123"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          <button className="btn btn-primary" disabled={loading} onClick={submit}>
            {loading ? 'Memeriksa…' : 'Verifikasi'}
          </button>
        </div>
      </Card>

      {loading ? <Loading label="Memeriksa sertifikat…" /> : null}
      {error ? <ErrorBox error={error} onRetry={() => void verify(checked || input)} /> : null}

      {/* ---------------------------- verdict ---------------------------- */}
      {!loading && result ? (
        result.valid ? (
          <div className="verify-valid">
            <div className="verify-verdict">
              <span className="verify-verdict-icon">✅</span>
              <div>
                <div className="verify-verdict-title">SERTIFIKAT VALID</div>
                <div className="verify-verdict-sub">
                  Sertifikat ini asli dan diterbitkan oleh QATools Academy.
                </div>
              </div>
            </div>

            <div className="verify-grid">
              <div>
                <div className="verify-k">Nama peserta</div>
                <div className="verify-v">{result.learner_name ?? result.certificate?.learner_name}</div>
              </div>
              <div>
                <div className="verify-k">Kursus</div>
                <div className="verify-v">{result.course_title ?? result.certificate?.course_title}</div>
              </div>
              <div>
                <div className="verify-k">Tanggal terbit</div>
                <div className="verify-v">
                  {fmtDate(result.issued_at ?? result.certificate?.issued_at)}
                </div>
              </div>
              <div>
                <div className="verify-k">Kode</div>
                <div className="verify-v mono">{result.certificate?.code ?? checked}</div>
              </div>
              <div>
                <div className="verify-k">Grade</div>
                <div className="verify-v">{result.certificate?.grade ?? '—'}</div>
              </div>
              <div>
                <div className="verify-k">Skor rata-rata kuis</div>
                <div className="verify-v">{result.certificate?.score ?? '—'}</div>
              </div>
            </div>

            {result.certificate?.verification_hash ? (
              <div className="verify-hash">
                <div className="verify-k">Sidik verifikasi (SHA-256)</div>
                <code>{result.certificate.verification_hash}</code>
                <div className="row" style={{ marginTop: 8 }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => void copy(result.certificate?.verification_hash ?? '')}
                  >
                    Salin sidik
                  </button>
                  <a
                    className="btn btn-sm"
                    href={`/api/certificates/${result.certificate?.id}/render?format=html`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    🖨 Lihat sertifikat
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="verify-invalid">
            <div className="verify-verdict">
              <span className="verify-verdict-icon">⛔</span>
              <div>
                <div className="verify-verdict-title">SERTIFIKAT TIDAK VALID</div>
                <div className="verify-verdict-sub">{result.reason ?? 'Kode tidak dapat diverifikasi.'}</div>
              </div>
            </div>

            {result.certificate ? (
              <div className="verify-grid" style={{ marginTop: 'var(--space-4)' }}>
                <div>
                  <div className="verify-k">Kode</div>
                  <div className="verify-v mono">{result.certificate.code}</div>
                </div>
                <div>
                  <div className="verify-k">Nama pada sertifikat</div>
                  <div className="verify-v">{result.certificate.learner_name}</div>
                </div>
                <div>
                  <div className="verify-k">Kursus</div>
                  <div className="verify-v">{result.certificate.course_title}</div>
                </div>
                <div>
                  <div className="verify-k">Tanggal terbit</div>
                  <div className="verify-v">{fmtDate(result.certificate.issued_at)}</div>
                </div>
                {result.certificate.revoked_reason ? (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div className="verify-k">Alasan pencabutan</div>
                    <div className="verify-v">{result.certificate.revoked_reason}</div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <p className="mute-sm" style={{ marginTop: 'var(--space-4)' }}>
              Bila Anda yakin sertifikat ini sah, hubungi penerbit kursus dan sertakan kode di atas.
            </p>
          </div>
        )
      ) : null}

      {!loading && !result && !checked ? (
        <Empty
          icon="🔎"
          title="Belum ada kode yang diperiksa"
          subtitle="Masukkan kode sertifikat di atas untuk memverifikasi keasliannya."
        />
      ) : null}
    </div>
  );
}
