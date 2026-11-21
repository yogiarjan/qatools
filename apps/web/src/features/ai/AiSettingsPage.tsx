/**
 * Lane D — AI Settings.
 *
 * Configures the provider adapter for the whole platform.
 *
 * SECURITY CONTRACT: the stored API key is NEVER displayed. The input is a password
 * field that shows only the masked value as its placeholder; leaving it untouched keeps
 * the existing secret, and the response of every endpoint is checked to be key-free.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { AiStatus } from '@qatools/shared';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';
import { Badge, Card, Field, Loading, PageHeader, Stat } from '../../components';

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

interface ProviderInfo {
  id: string;
  label: string;
  needs_key: boolean;
  default_base_url: string;
  default_model: string;
  docs: string;
}

interface SettingsData {
  id: string;
  provider: string;
  model: string;
  base_url: string | null;
  api_key_masked: string | null;
  api_key_set: boolean;
  temperature: number;
  max_tokens: number;
  enabled: boolean;
  fallback_to_mock: boolean;
  status: AiStatus;
  notice?: string;
}

interface TestResult {
  ok: boolean;
  live: boolean;
  provider: string;
  model: string;
  latency_ms: number;
  endpoint?: string;
  message: string;
  error?: string | null;
  sample?: string | null;
  mode: 'live' | 'mock';
}

/** Providers that can never reach the network, with an honest explanation. */
const OFFLINE_ONLY = new Set(['mock']);

const PROVIDER_HELP: Record<string, string> = {
  deepseek:
    'Endpoint OpenAI-compatible. Base URL default https://api.deepseek.com/v1, model deepseek-chat. Paling hemat biaya untuk tugas QA terstruktur.',
  openai:
    'Base URL default https://api.openai.com/v1. Gunakan model seperti gpt-4o-mini untuk biaya rendah atau gpt-4o untuk kualitas tertinggi.',
  anthropic:
    'Memakai header x-api-key dan anthropic-version: 2023-06-01. Base URL default https://api.anthropic.com/v1.',
  google:
    'Memakai endpoint generateContent dengan parameter ?key=. Base URL default https://generativelanguage.googleapis.com/v1beta.',
  ollama:
    'LLM lokal tanpa API key. Jalankan `ollama serve` lalu pastikan base URL mengarah ke mesin Anda (default http://127.0.0.1:11434).',
  custom:
    'Layanan apa pun yang OpenAI-compatible (vLLM, LM Studio, LiteLLM, gateway internal). Wajib mengisi Base URL.',
  mock:
    'Tanpa jaringan dan tanpa API key. Seluruh task AI dijawab generator rule-based deterministik milik QATools.',
};

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function AiSettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Form state — `apiKey` is intentionally always blank on load (never prefilled).
  const [provider, setProvider] = useState('mock');
  const [model, setModel] = useState('qatools-mock-1');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [temperature, setTemperature] = useState(0.3);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [enabled, setEnabled] = useState(true);
  const [fallbackToMock, setFallbackToMock] = useState(true);

  const applyToForm = useCallback((d: SettingsData) => {
    setProvider(d.provider);
    setModel(d.model);
    setBaseUrl(d.base_url ?? '');
    setApiKey(''); // never echo the stored secret back into the form
    setTemperature(d.temperature);
    setMaxTokens(d.max_tokens);
    setEnabled(d.enabled);
    setFallbackToMock(d.fallback_to_mock);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsRes, providersRes] = await Promise.all([
        api.get<{ data: SettingsData }>('/ai/settings'),
        api.get<{ data: ProviderInfo[] }>('/ai/providers').catch(() => ({ data: [] as ProviderInfo[] })),
      ]);
      setData(settingsRes.data);
      applyToForm(settingsRes.data);
      if (providersRes.data?.length) setProviders(providersRes.data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [applyToForm]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeProvider = providers.find((p) => p.id === provider);
  const needsKey = activeProvider?.needs_key ?? provider !== 'mock';
  const isOfflineProvider = OFFLINE_ONLY.has(provider);

  /* ------------------------------ actions ----------------------------- */

  function onProviderChange(next: string): void {
    setProvider(next);
    const info = providers.find((p) => p.id === next);
    if (info) {
      setModel(info.default_model);
      setBaseUrl(next === 'mock' ? '' : info.default_base_url);
    }
    setTestResult(null);
  }

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        provider,
        model: model.trim() || activeProvider?.default_model || 'qatools-mock-1',
        base_url: baseUrl.trim(),
        temperature,
        max_tokens: maxTokens,
        enabled,
        fallback_to_mock: fallbackToMock,
      };
      // Only send api_key when the user actually typed a new one — an empty field means
      // "keep whatever is stored", so we never blank out a working key by accident.
      if (apiKey.trim()) payload.api_key = apiKey.trim();

      const res = await api.put<{ data: SettingsData }>('/ai/settings', payload);
      setData(res.data);
      applyToForm(res.data);
      toast.ok(res.data.notice ?? 'Pengaturan AI tersimpan.');
    } catch (err) {
      toast.fromError(err, 'Gagal menyimpan pengaturan');
    } finally {
      setSaving(false);
    }
  }

  async function clearKey(): Promise<void> {
    setSaving(true);
    try {
      const res = await api.put<{ data: SettingsData }>('/ai/settings', { clear_api_key: true });
      setData(res.data);
      applyToForm(res.data);
      toast.ok('API key dihapus. AI berjalan penuh secara offline.');
    } catch (err) {
      toast.fromError(err, 'Gagal menghapus API key');
    } finally {
      setSaving(false);
    }
  }

  async function runTest(): Promise<void> {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post<{ data: TestResult }>('/ai/settings/test', {
        provider,
        model: model.trim(),
        base_url: baseUrl.trim(),
        // Test the UNSAVED key if the user typed one; otherwise the stored key is used.
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      });
      setTestResult(res.data);
      if (res.data.ok) toast.ok(res.data.message);
      else toast.err(res.data.message);
    } catch (err) {
      toast.fromError(err, 'Tes koneksi gagal');
      setTestResult({
        ok: false,
        live: false,
        provider,
        model,
        latency_ms: 0,
        message: err instanceof Error ? err.message : String(err),
        mode: 'mock',
      });
    } finally {
      setTesting(false);
    }
  }

  /* ------------------------------ render ------------------------------ */

  if (loading) return <Loading label="Memuat pengaturan AI…" />;

  if (error && !data) {
    return (
      <>
        <PageHeader title="AI Settings" subtitle="Konfigurasi provider AI untuk seluruh platform." />
        <div className="alert alert-err">
          <span>⚠️</span>
          <div style={{ flex: 1 }}>
            <div className="strong">Tidak dapat memuat pengaturan</div>
            <div>{error instanceof Error ? error.message : String(error)}</div>
          </div>
          <button className="btn btn-sm" onClick={() => void load()}>
            Coba lagi
          </button>
        </div>
      </>
    );
  }

  const status = data?.status;
  const isLive = status?.configured === true && status?.mode === 'live';

  return (
    <>
      <PageHeader
        title="AI Settings"
        subtitle="Pilih provider, model, dan kunci API. Tanpa konfigurasi apa pun, platform tetap berjalan penuh secara offline."
        badge={
          status ? (
            <span style={{ marginLeft: 10 }}>
              {isLive ? (
                <Badge tone="ok">🟢 Live · {status.provider}</Badge>
              ) : (
                <Badge tone="warn">🟡 Offline deterministik</Badge>
              )}
            </span>
          ) : null
        }
        actions={
          <NavLink className="btn" to="/ai">
            ✨ Buka AI Studio
          </NavLink>
        }
      />

      {/* --------------------------- status --------------------------- */}
      <Card
        title="Status Lapisan AI"
        subtitle={status?.message ?? 'Konfigurasi belum terbaca.'}
      >
        <div className="grid grid-4">
          <Stat
            label="Mode"
            value={isLive ? 'Live' : 'Offline'}
            tone={isLive ? 'ok' : 'warn'}
            hint={isLive ? 'memanggil provider sungguhan' : 'generator rule-based lokal'}
          />
          <Stat label="Provider" value={data?.provider ?? '—'} hint={data?.model ?? ''} />
          <Stat
            label="API Key"
            value={data?.api_key_set ? data.api_key_masked ?? 'tersimpan' : 'belum diisi'}
            tone={data?.api_key_set ? 'ok' : 'warn'}
            hint={data?.api_key_set ? 'hanya versi tersamar yang ditampilkan' : 'tidak diperlukan untuk mode offline'}
          />
          <Stat
            label="Fallback offline"
            value={data?.fallback_to_mock ? 'Aktif' : 'Nonaktif'}
            tone={data?.fallback_to_mock ? 'ok' : 'warn'}
            hint={data?.fallback_to_mock ? 'kegagalan provider jatuh ke generator offline' : 'kegagalan provider dilaporkan sebagai error'}
          />
        </div>
      </Card>

      {/* --------------------------- offline note --------------------------- */}
      <div style={{ marginTop: 'var(--space-4)' }}>
        <div className="alert alert-info">
          <span>ℹ️</span>
          <div>
            <div className="strong">Mengapa mode offline itu penting</div>
            <div className="mute-sm" style={{ marginTop: 4 }}>
              QATools tidak boleh bergantung pada jaringan. Bila belum ada API key — atau provider sedang
              tidak dapat dihubungi dan <span className="strong">fallback offline</span> aktif — setiap task AI
              tetap dijawab oleh <span className="strong">generator rule-based deterministik</span> milik platform:
              use case, skenario, test case, pemeriksaan SQL, alur otomasi web, triase defect, sampai prediksi risiko.
            </div>
            <ul className="list-clean" style={{ marginTop: 6 }}>
              <li className="mute-sm">Deterministik — input yang sama selalu menghasilkan keluaran yang sama (dapat diuji & diaudit).</li>
              <li className="mute-sm">Bekerja di laptop tanpa internet, di ruang kelas, dan pada demo luring.</li>
              <li className="mute-sm">Setiap pemanggilan tetap dicatat pada tabel <span className="cell-mono">ai_generations</span> beserta penanda <span className="cell-mono">used_mock</span>.</li>
              <li className="mute-sm">Kegagalan provider tidak pernah menghasilkan error 500 — hasil tetap tersedia dan ditandai <span className="cell-mono">degraded</span>.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* --------------------------- form --------------------------- */}
      <div className="grid grid-2" style={{ marginTop: 'var(--space-4)' }}>
        <Card title="⚙️ Konfigurasi Provider" subtitle="Perubahan baru berlaku setelah ditekan Simpan.">
          <div className="stack">
            <Field label="Provider" required>
              <select className="select" value={provider} onChange={(e) => onProviderChange(e.target.value)}>
                {providers.length === 0 ? (
                  ['deepseek', 'openai', 'anthropic', 'google', 'ollama', 'custom', 'mock'].map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))
                ) : (
                  providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {p.needs_key ? ' (butuh API key)' : ' (tanpa API key)'}
                    </option>
                  ))
                )}
              </select>
            </Field>

            {PROVIDER_HELP[provider] ? <p className="hint">{PROVIDER_HELP[provider]}</p> : null}

            <Field label="Model" required hint={activeProvider ? `Default: ${activeProvider.default_model}` : undefined}>
              <input
                className="input"
                value={model}
                placeholder={activeProvider?.default_model ?? 'nama model'}
                onChange={(e) => setModel(e.target.value)}
              />
            </Field>

            <Field
              label="Base URL"
              hint={
                provider === 'mock'
                  ? 'Tidak dipakai pada provider mock.'
                  : `Kosongkan untuk memakai default${activeProvider?.default_base_url ? `: ${activeProvider.default_base_url}` : ''}`
              }
            >
              <input
                className="input"
                value={baseUrl}
                disabled={provider === 'mock'}
                placeholder={activeProvider?.default_base_url ?? 'https://…'}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </Field>

            <Field
              label="API Key"
              hint={
                isOfflineProvider
                  ? 'Provider mock tidak memerlukan API key.'
                  : data?.api_key_set
                    ? `Tersimpan sebagai ${data.api_key_masked ?? '(tersamar)'}. Biarkan kosong untuk mempertahankan kunci yang ada.`
                    : 'Kunci disimpan lokal pada database; hanya versi tersamar yang pernah dikembalikan API.'
              }
            >
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={apiKey}
                disabled={isOfflineProvider}
                placeholder={
                  isOfflineProvider
                    ? 'tidak diperlukan'
                    : data?.api_key_set
                      ? `${data.api_key_masked ?? '••••'} — isi hanya bila ingin mengganti`
                      : 'masukkan API key'
                }
                onChange={(e) => setApiKey(e.target.value)}
              />
            </Field>

            {data?.api_key_set ? (
              <div className="row">
                <Badge tone="ok">🔒 Kunci tersimpan (ditampilkan tersamar saja)</Badge>
                <button className="btn btn-danger btn-sm" onClick={() => void clearKey()} disabled={saving}>
                  🗑️ Hapus API key
                </button>
              </div>
            ) : null}

            <div className="grid grid-2">
              <Field label="Temperature" hint="0 = deterministik, 1+ = lebih variatif.">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                />
              </Field>
              <Field label="Max tokens" hint="Batas panjang jawaban model.">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={200000}
                  step={256}
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                />
              </Field>
            </div>

            <label className="checkbox" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span>
                Aktifkan lapisan AI
                <span className="hint" style={{ display: 'block' }}>
                  Bila dimatikan, seluruh task tetap dilayani generator offline.
                </span>
              </span>
            </label>

            <label className="checkbox" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={fallbackToMock}
                onChange={(e) => setFallbackToMock(e.target.checked)}
              />
              <span>
                Fallback ke generator offline saat provider gagal
                <span className="hint" style={{ display: 'block' }}>
                  Sangat disarankan. Tanpa ini, kegagalan provider dilaporkan sebagai error dan tidak ada
                  hasil pengganti.
                </span>
              </span>
            </label>

            <div className="row">
              <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
                {saving ? 'Menyimpan…' : '💾 Simpan'}
              </button>
              <button className="btn" onClick={() => void runTest()} disabled={testing || saving}>
                {testing ? 'Menguji…' : '🔌 Tes Koneksi'}
              </button>
              <button className="btn btn-ghost" onClick={() => void load()} disabled={saving || testing}>
                Muat ulang
              </button>
            </div>
          </div>
        </Card>

        <Card title="🔌 Hasil Tes Koneksi" subtitle="Panggilan kecil yang nyata — hasilnya dilaporkan apa adanya.">
          {testing ? <Loading label="Menguji koneksi provider…" /> : null}

          {!testing && !testResult ? (
            <>
              {isOfflineProvider ? (
                <div className="alert alert-warn">
                  <span>🟡</span>
                  <div>
                    <div className="strong">Provider mock tidak menyentuh jaringan</div>
                    <div className="mute-sm">
                      Tes koneksi akan melaporkan sukses seketika. Ini bukan bug: provider mock memang
                      dirancang untuk bekerja tanpa jaringan sama sekali.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty">
                  <div className="empty-icon">🔌</div>
                  <div className="empty-title">Belum ada hasil tes</div>
                  <p className="empty-sub">
                    Tekan <span className="strong">Tes Koneksi</span> untuk memverifikasi model, base URL, dan API
                    key yang sedang Anda isi. Nilai yang belum disimpan ikut diuji.
                  </p>
                </div>
              )}
            </>
          ) : null}

          {!testing && testResult ? (
            <div className="stack">
              <div className={`alert ${testResult.ok ? 'alert-ok' : 'alert-err'}`}>
                <span>{testResult.ok ? '✅' : '⛔'}</span>
                <div style={{ flex: 1 }}>
                  <div className="strong">
                    {testResult.ok
                      ? testResult.provider === 'mock'
                        ? 'Provider mock selalu tersedia'
                        : 'Koneksi berhasil'
                      : 'Koneksi gagal'}
                  </div>
                  <div className="mute-sm">{testResult.message}</div>
                  {testResult.error ? (
                    <div className="mute-sm" style={{ marginTop: 4 }}>
                      Pesan provider: <span className="cell-mono">{testResult.error}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-3">
                <Stat label="Provider" value={testResult.provider} hint={testResult.model} />
                <Stat
                  label="Latensi"
                  value={testResult.latency_ms ? `${testResult.latency_ms} ms` : '—'}
                  tone={testResult.ok ? 'ok' : 'err'}
                />
                <Stat
                  label="Mode"
                  value={testResult.mode === 'live' ? 'Live' : 'Offline'}
                  tone={testResult.mode === 'live' ? 'ok' : 'warn'}
                />
              </div>

              {testResult.endpoint ? (
                <div>
                  <div className="label">Endpoint yang diuji</div>
                  <div className="cell-mono mute-sm" style={{ wordBreak: 'break-all' }}>
                    {testResult.endpoint}
                  </div>
                </div>
              ) : null}

              {testResult.sample ? (
                <div>
                  <div className="label">Contoh balasan model</div>
                  <pre className="pre" style={{ maxHeight: 160, overflow: 'auto' }}>
                    {testResult.sample}
                  </pre>
                </div>
              ) : null}

              {!testResult.ok ? (
                <div className="alert alert-info">
                  <span>💡</span>
                  <div>
                    <div className="strong">Tetap bisa lanjut</div>
                    <div className="mute-sm">
                      Koneksi gagal tidak menghambat pekerjaan Anda. Selama{' '}
                      <span className="strong">fallback offline</span> aktif, seluruh task AI tetap dijawab
                      generator deterministik lokal.
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>

      {/* --------------------------- reference --------------------------- */}
      <div style={{ marginTop: 'var(--space-4)' }}>
        <Card title="🗺️ Referensi Provider" subtitle="Ringkasan default yang dipakai setiap adapter.">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Butuh API key</th>
                  <th>Base URL default</th>
                  <th>Model default</th>
                  <th>Catatan</th>
                </tr>
              </thead>
              <tbody>
                {(providers.length
                  ? providers
                  : [
                      { id: 'deepseek', label: 'DeepSeek', needs_key: true, default_base_url: 'https://api.deepseek.com/v1', default_model: 'deepseek-chat', docs: '' },
                      { id: 'openai', label: 'OpenAI', needs_key: true, default_base_url: 'https://api.openai.com/v1', default_model: 'gpt-4o-mini', docs: '' },
                      { id: 'anthropic', label: 'Anthropic Claude', needs_key: true, default_base_url: 'https://api.anthropic.com/v1', default_model: 'claude-3-5-sonnet-latest', docs: '' },
                      { id: 'google', label: 'Google Gemini', needs_key: true, default_base_url: 'https://generativelanguage.googleapis.com/v1beta', default_model: 'gemini-1.5-flash', docs: '' },
                      { id: 'ollama', label: 'Ollama (lokal)', needs_key: false, default_base_url: 'http://127.0.0.1:11434', default_model: 'llama3.1', docs: '' },
                      { id: 'custom', label: 'Custom (OpenAI-compatible)', needs_key: true, default_base_url: 'http://127.0.0.1:8000/v1', default_model: 'local-model', docs: '' },
                      { id: 'mock', label: 'Offline deterministik (mock)', needs_key: false, default_base_url: '—', default_model: 'qatools-mock-1', docs: '' },
                    ]
                ).map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="strong">{p.label}</span>
                      <div className="mute-sm cell-mono">{p.id}</div>
                    </td>
                    <td>{p.needs_key ? <Badge tone="warn">ya</Badge> : <Badge tone="ok">tidak</Badge>}</td>
                    <td className="cell-mono mute-sm" style={{ wordBreak: 'break-all' }}>
                      {p.default_base_url || '—'}
                    </td>
                    <td className="cell-mono mute-sm">{p.default_model}</td>
                    <td className="mute-sm">{PROVIDER_HELP[p.id] ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 'var(--space-4)' }}>
        <div className="alert alert-warn">
          <span>🔒</span>
          <div>
            <div className="strong">Tentang penyimpanan API key</div>
            <div className="mute-sm" style={{ marginTop: 4 }}>
              Kunci disimpan pada kolom <span className="cell-mono">ai_settings.api_key</span> di database lokal
              QATools dan <span className="strong">tidak pernah dikembalikan dalam bentuk utuh</span> oleh API —
              semua endpoint hanya mengembalikan versi tersamar (mis. <span className="cell-mono">sk-…abcd</span>).
              Penyimpanan kunci ini <span className="strong">tidak terenkripsi</span>; pada pemakaian bersama,
              lindungi berkas database dan gunakan kunci dengan hak akses minimal.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export const AI_SETTINGS_META = { emoji: '⚙️', offlineOnly: Array.from(OFFLINE_ONLY) } as const;
