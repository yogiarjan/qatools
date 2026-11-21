/**
 * Site Analyzer page — "existing web" support (user request point 1).
 *
 * Point a URL at the crawler (lane-ai exposes POST /api/ai/crawl returning CrawlResult),
 * review the discovered pages/forms/buttons/features as checkboxes, then turn the
 * selected ones into requirements + use cases in one click.
 */

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CrawlResult, CrawledPage } from '@qatools/shared';
import { PRIORITIES, PRIORITY_LABEL, PRIORITY_TONE, type Priority } from '@qatools/shared';
import { api, ApiError } from '../../lib/api';
import { toast } from '../../lib/toast';
import { useProject } from '../../lib/project';
import {
  PageHeader,
  Card,
  Modal,
  Field,
  Loading,
  Empty,
  Badge,
  Tabs,
} from '../../components';

const FEATURE_ICON: Record<string, string> = {
  form: '📝',
  navigation: '🧭',
  listing: '📄',
  detail: '🔍',
  action: '⚡',
  auth: '🔐',
  search: '🔎',
};

/** Friendly copy when the crawler route is not available yet. */
function crawlErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404 || err.status === 503) {
      return 'Fitur crawler AI belum tersedia di server ini. Aktifkan modul AI (lane-ai) lalu coba lagi.';
    }
    if (err.status === 0) {
      return 'Tidak dapat menghubungi server API. Pastikan backend berjalan.';
    }
    return err.message;
  }
  return 'Analisis web gagal dijalankan.';
}

export default function SiteAnalyzerPage() {
  const { projectId, project } = useProject();

  const [url, setUrl] = useState(project?.target_url ?? '');
  const [maxPages, setMaxPages] = useState(5);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<CrawlResult | null>(null);
  const [activePage, setActivePage] = useState(0);
  const [tab, setTab] = useState<'features' | 'pages' | 'usecases'>('features');

  const [selectedFeatures, setSelectedFeatures] = useState<Set<number>>(new Set());
  const [selectedUseCases, setSelectedUseCases] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);

  // Requirements are derived from the ticked features.
  const selectedFeatureList = useMemo(() => {
    if (!result) return [];
    return result.features.filter((_, i) => selectedFeatures.has(i));
  }, [result, selectedFeatures]);

  const selectedUseCaseList = useMemo(() => {
    if (!result) return [];
    return result.suggested_use_cases.filter((_, i) => selectedUseCases.has(i));
  }, [result, selectedUseCases]);

  async function analyze() {
    if (!url.trim()) {
      toast.err('Masukkan URL halaman yang ingin dianalisis.');
      return;
    }
    setAnalyzing(true);
    setResult(null);
    try {
      const input: Record<string, unknown> = { url: url.trim(), max_pages: maxPages, include_links: true };
      const res = await api.post<{ data?: CrawlResult } | CrawlResult>('/ai/crawl', {
        ...input,
        project_id: projectId,
      });
      // Accept either the raw CrawlResult or an AiResult/CrawlResult envelope.
      const payload = (res as { data?: CrawlResult }).data ?? (res as unknown as CrawlResult);
      if (!payload?.pages) {
        toast.warn('Crawler tidak mengembalikan halaman apa pun.');
        return;
      }
      setResult(payload);
      setActivePage(0);
      setSelectedFeatures(new Set(payload.features.map((_, i) => i)));
      setSelectedUseCases(new Set(payload.suggested_use_cases.map((_, i) => i)));
      toast.ok(
        `Ditemukan ${payload.pages.length} halaman dan ${payload.features.length} fitur${
          payload.used_mock ? ' (mode offline/mock)' : ''
        }.`,
      );
    } catch (err) {
      toast.warn(crawlErrorMessage(err));
    } finally {
      setAnalyzing(false);
    }
  }

  function toggleFeature(i: number) {
    setSelectedFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function toggleUseCase(i: number) {
    setSelectedUseCases((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  /** Creates one requirement per selected feature, then one use case per suggestion. */
  async function createArtifacts() {
    if (!projectId) return;
    if (!selectedFeatureList.length && !selectedUseCaseList.length) {
      toast.warn('Pilih minimal satu fitur atau use case.');
      return;
    }
    setCreating(true);
    try {
      let requirementCount = 0;
      if (selectedFeatureList.length) {
        const res = await api.post<{ total: number }>(`/projects/${projectId}/requirements/bulk`, {
          items: selectedFeatureList.map((f) => ({
            title: `${f.name}`,
            description: `Ditemukan dari analisis web (${f.evidence}). Actor: ${f.suggested_actor}.`,
            source: result?.url ?? url,
            priority: f.suggested_priority,
          })),
        });
        requirementCount = res?.total ?? selectedFeatureList.length;
      }

      let useCaseCount = 0;
      for (const uc of selectedUseCaseList) {
        await api.post(`/projects/${projectId}/usecases`, {
          name: uc.name,
          goal: uc.goal,
          actors_list: uc.actors,
          priority: uc.priority,
          generated_by: 'import',
          main_flow_list: [`Buka ${result?.url ?? url}`, uc.goal],
        });
        useCaseCount += 1;
      }

      toast.ok(`${requirementCount} kebutuhan dan ${useCaseCount} use case dibuat dari hasil analisis.`);
      setPreviewOpen(false);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 503)) {
        toast.warn(crawlErrorMessage(err));
      } else {
        toast.fromError(err, 'Gagal membuat artefak');
      }
    } finally {
      setCreating(false);
    }
  }

  const page: CrawledPage | undefined = result?.pages[activePage];

  return (
    <>
      <PageHeader
        title="Analyzer Web Existing"
        subtitle="Punya aplikasi yang sudah jalan tapi belum ada dokumen QA-nya? Arahkan crawler ke URL-nya, lalu ubah temuan menjadi kebutuhan dan use case."
        actions={
          <Link className="btn" to="/requirements">
            📋 Lihat Kebutuhan
          </Link>
        }
      />

      <Card title="🔍 Analisis Halaman" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="row row-wrap" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <Field label="URL Halaman" hint="Contoh: https://contoh.id/login">
              <input
                className="input"
                value={url}
                placeholder="https://contoh.id"
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void analyze();
                }}
              />
            </Field>
          </div>
          <div style={{ width: 130 }}>
            <Field label="Maks. Halaman">
              <input
                className="input"
                type="number"
                min={1}
                max={50}
                value={maxPages}
                onChange={(e) => setMaxPages(Number(e.target.value))}
              />
            </Field>
          </div>
          <button className="btn btn-primary" disabled={analyzing} onClick={() => void analyze()}>
            {analyzing ? '⏳ Menganalisis…' : '🔍 Analisis Sekarang'}
          </button>
        </div>

        {analyzing ? (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Loading label="Crawler sedang membaca halaman & mendeteksi fitur…" />
          </div>
        ) : null}
      </Card>

      {!result && !analyzing ? (
        <Empty
          icon="🔍"
          title="Belum ada hasil analisis"
          subtitle="Masukkan URL aplikasi web existing Anda. QATools akan mendeteksi halaman, form, tombol, dan fitur, lalu mengusulkan kebutuhan serta use case."
        />
      ) : null}

      {result ? (
        <div className="stack stack-lg">
          <div className="grid grid-4">
            <div className="stat">
              <span className="stat-label">Halaman Ditemukan</span>
              <span className="stat-value">{result.pages.length}</span>
            </div>
            <div className="stat stat-info">
              <span className="stat-label">Fitur Terdeteksi</span>
              <span className="stat-value">{result.features.length}</span>
            </div>
            <div className="stat stat-accent">
              <span className="stat-label">Usulan Use Case</span>
              <span className="stat-value">{result.suggested_use_cases.length}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Sumber</span>
              <span className="stat-value" style={{ fontSize: 16 }}>
                {result.used_mock ? '🤖 Mock/offline' : '🌐 Live crawl'}
              </span>
            </div>
          </div>

          {result.used_mock ? (
            <div className="alert alert-warn">
              <span>🤖</span>
              <div>
                Hasil ini berasal dari <b>mode mock/offline</b> karena tidak ada penyedia AI yang
                dikonfigurasi atau halaman tidak dapat diambil server. Strukturnya tetap valid untuk
                latihan; konfigurasikan API key di <b>AI Settings</b> untuk crawl sungguhan.
              </div>
            </div>
          ) : null}

          <div className="toolbar">
            <span className="strong">
              {selectedFeatureList.length} fitur & {selectedUseCaseList.length} use case dipilih
            </span>
            <span className="spacer" />
            <button
              className="btn btn-primary"
              disabled={creating}
              onClick={() => setPreviewOpen(true)}
            >
              {creating ? '⏳ Membuat…' : '✨ Buat Requirements + Use Cases dari hasil analisis'}
            </button>
          </div>

          <Tabs
            tabs={[
              { id: 'features' as const, label: `Fitur (${result.features.length})` },
              { id: 'pages' as const, label: `Halaman (${result.pages.length})` },
              { id: 'usecases' as const, label: `Usulan Use Case (${result.suggested_use_cases.length})` },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === 'features' ? (
            result.features.length ? (
              <div className="grid grid-2">
                {result.features.map((f, i) => (
                  <div className="card sa-feature" key={i} onClick={() => toggleFeature(i)}>
                    <div className="row" style={{ alignItems: 'flex-start' }}>
                      <input
                        className="checkbox"
                        type="checkbox"
                        checked={selectedFeatures.has(i)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleFeature(i)}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row-between">
                          <span className="strong">
                            {FEATURE_ICON[f.kind] ?? '•'} {f.name}
                          </span>
                          <Badge tone={PRIORITY_TONE[f.suggested_priority]}>
                            {PRIORITY_LABEL[f.suggested_priority]}
                          </Badge>
                        </div>
                        <div className="mute-sm" style={{ marginTop: 4 }}>
                          {f.evidence}
                        </div>
                        <div className="row row-wrap" style={{ gap: 4, marginTop: 6 }}>
                          <span className="chip">{f.kind}</span>
                          <span className="chip">👤 {f.suggested_actor}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty icon="🧩" title="Tidak ada fitur terdeteksi" />
            )
          ) : null}

          {tab === 'pages' && page ? (
            <div className="stack">
              <div className="row row-wrap">
                {result.pages.map((p, i) => (
                  <button
                    key={i}
                    className={`btn btn-sm ${i === activePage ? 'btn-primary' : ''}`}
                    onClick={() => setActivePage(i)}
                    title={p.url}
                  >
                    {i + 1}. {p.title || p.url}
                  </button>
                ))}
              </div>

              <Card title={`📄 ${page.title || page.url}`} subtitle={page.url}>
                <div className="stack">
                  {page.headings.length ? (
                    <div>
                      <span className="label">Judul Bagian</span>
                      <ul className="list-clean">
                        {page.headings.slice(0, 12).map((h, i) => (
                          <li key={i}>{h}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="grid grid-2">
                    <div>
                      <span className="label">Form ({page.forms.length})</span>
                      {page.forms.length ? (
                        page.forms.map((form, i) => (
                          <div className="card" key={i} style={{ marginTop: 6 }}>
                            <div className="cell-mono">
                              {form.method} {form.action || '(halaman ini)'}
                            </div>
                            <ul className="list-clean">
                              {form.fields.map((field, j) => (
                                <li key={j}>
                                  <span className="cell-mono">{field.name}</span> · {field.type}
                                  {field.required ? <Badge tone="warn">wajib</Badge> : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))
                      ) : (
                        <div className="muted">Tidak ada form.</div>
                      )}
                    </div>

                    <div>
                      <span className="label">Tombol ({page.buttons.length})</span>
                      <div className="row row-wrap" style={{ gap: 4, marginTop: 6 }}>
                        {page.buttons.length ? (
                          page.buttons.map((b, i) => (
                            <span className="chip" key={i}>
                              🔘 {b}
                            </span>
                          ))
                        ) : (
                          <span className="muted">Tidak ada tombol.</span>
                        )}
                      </div>

                      <span className="label" style={{ display: 'block', marginTop: 'var(--space-3)' }}>
                        Tabel ({page.tables.length})
                      </span>
                      {page.tables.length ? (
                        <ul className="list-clean">
                          {page.tables.map((t, i) => (
                            <li key={i}>
                              {t.rowCount} baris · {t.headers.slice(0, 5).join(', ')}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="muted">Tidak ada tabel.</div>
                      )}
                    </div>
                  </div>

                  {page.textSample ? (
                    <div>
                      <span className="label">Cuplikan Teks</span>
                      <pre className="pre">{page.textSample.slice(0, 900)}</pre>
                    </div>
                  ) : null}
                </div>
              </Card>
            </div>
          ) : null}

          {tab === 'usecases' ? (
            result.suggested_use_cases.length ? (
              <div className="grid grid-2">
                {result.suggested_use_cases.map((uc, i) => (
                  <div className="card sa-feature" key={i} onClick={() => toggleUseCase(i)}>
                    <div className="row" style={{ alignItems: 'flex-start' }}>
                      <input
                        className="checkbox"
                        type="checkbox"
                        checked={selectedUseCases.has(i)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleUseCase(i)}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row-between">
                          <span className="strong">📘 {uc.name}</span>
                          <Badge tone={PRIORITY_TONE[uc.priority]}>{PRIORITY_LABEL[uc.priority]}</Badge>
                        </div>
                        <div className="mute-sm" style={{ marginTop: 4 }}>
                          🎯 {uc.goal}
                        </div>
                        <div className="row row-wrap" style={{ gap: 4, marginTop: 6 }}>
                          {uc.actors.map((a) => (
                            <span className="chip" key={a}>
                              👤 {a}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty icon="📘" title="Tidak ada usulan use case" />
            )
          ) : null}
        </div>
      ) : null}

      {previewOpen ? (
        <Modal
          title="Buat Artefak dari Hasil Analisis"
          onClose={() => setPreviewOpen(false)}
          size="lg"
          footer={
            <>
              <button className="btn" onClick={() => setPreviewOpen(false)} disabled={creating}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={() => void createArtifacts()} disabled={creating}>
                {creating ? 'Membuat…' : `Buat ${selectedFeatureList.length + selectedUseCaseList.length} Artefak`}
              </button>
            </>
          }
        >
          <div className="stack">
            <div className="alert alert-info">
              <span>ℹ️</span>
              <div>
                {selectedFeatureList.length} fitur akan menjadi <b>kebutuhan</b> (sumber: hasil crawl), dan{' '}
                {selectedUseCaseList.length} usulan akan menjadi <b>use case</b>.
              </div>
            </div>

            {selectedFeatureList.length ? (
              <div>
                <span className="label">Kebutuhan yang akan dibuat</span>
                <ul className="list-clean">
                  {selectedFeatureList.map((f, i) => (
                    <li key={i}>
                      {f.name}{' '}
                      <Badge tone={PRIORITY_TONE[f.suggested_priority]}>
                        {PRIORITY_LABEL[f.suggested_priority]}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {selectedUseCaseList.length ? (
              <div>
                <span className="label">Use case yang akan dibuat</span>
                <ul className="list-clean">
                  {selectedUseCaseList.map((u, i) => (
                    <li key={i}>
                      <b>{u.name}</b> — {u.goal}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      <style>{`
        .sa-feature { cursor: pointer; }
        .sa-feature:hover { border-color: var(--border-strong); }
      `}</style>
    </>
  );
}
