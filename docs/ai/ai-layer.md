# Lapisan AI QATools

> Dokumen ini menjelaskan **lapisan AI** QATools: konfigurasi provider, mode offline
> deterministik, katalog lengkap task AI, mesin crawler, dan bagaimana AI ikut serta dalam
> alur QA berurutan.
>
> Kode: `apps/api/src/modules/ai/**` · UI: `apps/web/src/features/ai/**` · Mock SUT: `apps/api/src/modules/aimock/**`

---

## 1. Ringkasan dalam satu paragraf

Lapisan AI QATools mengubah bahan mentah QA — deskripsi kebutuhan, use case, skenario,
halaman web yang sudah ada, defect, dan hasil eksekusi — menjadi **artefak QA yang konkret**
(use case, skenario, test case beserta langkahnya, request API, pemeriksaan SQL, alur otomasi
web, triase defect, dan skor risiko regresi). Lapisan ini mendukung **tujuh provider** melalui
satu adapter seragam, dan — yang paling penting — **selalu dapat bekerja tanpa jaringan**:
bila tidak ada API key, atau provider gagal dan `fallback_to_mock` menyala, setiap task tetap
dijawab oleh **generator rule-based deterministik** milik QATools sendiri.

Semua kemampuan itu diekspos melalui satu permukaan in-process yang sama:

```ts
import { aiService } from '../ai/index.js';

const hasil = await aiService.generate<UseCaseDraft[]>('generate_usecases', {
  feature_description: 'Pengguna dapat login dengan email dan kata sandi.',
  count: 3,
});
```

---

## 2. Arsitektur

```
apps/api/src/modules/ai/
├─ providers.ts   adapter seragam untuk 7 provider (fetch global, tanpa SDK)
├─ prompts.ts     satu prompt builder per AiTask + skema JSON eksplisit + few-shot
├─ json.ts        extractJson() — tahan markdown fence, prosa, dan JSON rusak
├─ nlp.ts         utilitas NLP ringan & deterministik (aktor, aksi, objek, aturan)
├─ offline.ts     generator offline deterministik untuk SELURUH AI_TASKS
├─ crawler.ts     crawler HTML tanpa cheerio/jsdom
├─ persist.ts     penyimpanan artifact (INSERT saja) + matrix_links
└─ index.ts       aiService + seluruh route Fastify

apps/api/src/modules/aimock/index.ts   "system under test" kecil untuk dipakai offline
```

### Alur satu permintaan

```
generate(task, input)
   │
   ├─ 1. baca ai_settings            (provider, model, base_url, api_key, temperature, max_tokens)
   ├─ 2. tentukan mode               live = enabled && provider !== 'mock' && (key ada bila perlu)
   ├─ 3. bangun prompt               prompts.ts (skema JSON ditulis di dalam prompt)
   ├─ 4. panggil provider            providers.ts → fetch global (timeout 60s, tanpa SDK)
   ├─ 5. ekstrak JSON                json.ts — fence, prosa, trailing comma, kutip pintar
   ├─ 6. normalisasi ke kontrak      normaliseForTask() memvalidasi enum & bentuk
   ├─ 7. catat ke ai_generations     SELALU — sukses, mock, maupun gagal
   ├─ 8. persist (bila diminta)      INSERT artifact + matrix_links, id dikembalikan di meta
   └─ 9. fallback offline            bila langkah 4–6 gagal → offlineGenerate(), degraded=true
```

**Jaminan penting:** langkah 4–6 tidak pernah melempar exception ke pemanggil. Balasan model
yang rusak tidak pernah menghasilkan HTTP 500 — hasilnya jatuh ke generator offline dan
ditandai `meta.degraded = true` beserta `meta.degraded_reason`.

---

## 3. Mode offline deterministik — mengapa ini fitur utama

QATools dipakai di ruang kelas, laptop tanpa internet, dan demo luring. Karena itu
ketergantungan jaringan **tidak boleh** menjadi syarat agar produk berfungsi.

### Perilaku

| Kondisi | Mode | `used_mock` | `degraded` | Hasil |
|---|---|---|---|---|
| Provider `mock` (default) | `mock` | `true` | `false` | Generator offline — ini mode normal |
| Tidak ada API key | `mock` | `true` | `false` | Generator offline — ini mode normal |
| Provider live gagal, `fallback_to_mock` aktif | `live` → `mock` | `true` | `true` | Generator offline + alasan kegagalan |
| Provider live gagal, `fallback_to_mock` **nonaktif** | `live` | `false` | — | `ok:false` + pesan error (dicatat) |

### Sifat generator offline

1. **Deterministik** — memakai `stableHash()` dari `@qatools/shared` untuk memilih varian
   kalimat. Input yang sama menghasilkan keluaran yang **byte-identik**, sehingga dapat diuji
   dan diaudit.
2. **Murni** — tanpa jam, tanpa angka acak, tanpa I/O, dan **tanpa panggilan jaringan sama sekali**.
3. **Sungguhan, bukan placeholder** — generator membaca input dan menyusun keluaran yang masuk akal:
   - mendeteksi aktor dari kata kunci peran (`admin`, `pelanggan`, `guru`, `kurir`, …);
   - mengambil objek bisnis dari frasa setelah kata kerja aksi (`… mengunggah dokumen pendukung` → *dokumen pendukung*);
   - menyusun alur utama, alur alternatif, dan aturan bisnis;
   - menurunkan field formulir beserta contoh data valid / tidak valid / nilai batas;
   - menyusun langkah uji dengan aksi dan hasil harapan;
   - menilai severity dan prioritas defect dari kata kunci dampak.

Contoh keluaran nyata (tanpa jaringan):

```
generate_usecases    → [{"name":"Login Kata sandi salah","goal":"Memungkinkan Pengguna untuk login …",
                        "actors":["Pengguna"],"main_flow":[…],"priority":"high","risk":"high"}]
generate_testcases   → [{"title":"Login berhasil dengan kredensial valid","type":"functional","layer":"web",
                        "steps":[{"action":"Buka halaman /login","expected":"Form login tampil"},…]}]
predict_risk         → {"items":[{"test_case_id":"tc_b","score":63,"level":"medium",
                        "factors":["menyentuh autentikasi/otorisasi (+14)",…]}]}
```

### Membuktikan tidak ada panggilan jaringan

Berkas uji `apps/api/test/lane-d.test.ts` mengarahkan `base_url` ke **port tertutup** dan
menghitung setiap pemanggilan `fetch`, lalu menegaskan bahwa mode offline murni menghasilkan
**nol** panggilan:

```ts
setSettings({ provider: 'mock', api_key: null });
const before = networkAttempts;
for (const task of AI_TASKS) await aiService.generate(task, input);
assert.equal(networkAttempts, before, 'mode offline murni tidak boleh memanggil jaringan');
```

---

## 4. Katalog task AI

`AI_TASKS` (di `packages/shared/src/domain.ts`) adalah daftar **beku**. Setiap entri memiliki
generator offline sendiri, prompt builder sendiri, dan skema JSON eksplisit.

| Task | Guna | Bentuk input | Bentuk keluaran |
|---|---|---|---|
| `crawl_site` | Menganalisis halaman web yang sudah ada | `{ url, html? }` | `CrawlResult` |
| `generate_usecases` | Kebutuhan → use case | `{ feature_description, requirement_ids?, count? }` | `UseCaseDraft[]` |
| `generate_scenarios` | Use case → skenario | `{ use_case, use_case_ids?, per_use_case? }` | `ScenarioDraft[]` |
| `generate_testcases` | Skenario → test case | `{ scenario, scenario_ids?, per_scenario? }` | `TestCaseDraft[]` |
| `generate_test_data` | Test case → baris data uji | `{ fields?, rows?, crawl? }` | `{ columns, rows, notes }` |
| `generate_api_tests` | OpenAPI/deskripsi → request + assertion | `{ openapi?, endpoints?, base_url? }` | `ApiRequestDraft[]` |
| `generate_db_checks` | Kebutuhan data → pemeriksaan SQL | `{ requirement_text?, schema_sql? }` | `DbCheckDraft[]` |
| `generate_web_flow` | Skenario → langkah otomasi UI | `{ scenario_text?, url?, crawl? }` | `WebFlowDraft` |
| `generate_sql` | Bahasa alami → SQL | `{ requirement_text, schema_sql? }` | `{ sql, explanation, … }` |
| `review_coverage` | Matrix → celah & saran | `{ matrix_summary?, gaps? }` | `CoverageReviewResult` |
| `triage_defect` | Defect → severity/prioritas/pemilik | `DefectTriageInput` | `DefectTriageResult` |
| `summarize_test_plan` | Test case → rencana uji | `{ project_name?, test_cases? }` | objek rencana (lihat §4.1) |
| `predict_risk` | Test case → skor risiko regresi | `{ test_cases? }` | `RiskPredictionResult` |
| `chat` | Asisten bebas | `{ messages }` | `{ reply, suggestions }` |

### 4.1 Contoh lengkap — `generate_testcases`

**Masukan**

```json
{
  "scenario": {
    "title": "Login berhasil",
    "kind": "happy_path",
    "given_text": "Pengguna terdaftar dengan kredensial valid",
    "when_text": "mengisi email dan kata sandi lalu menekan Masuk",
    "then_text": "diarahkan ke dashboard",
    "priority": "high"
  },
  "per_scenario": 3
}
```

**Keluaran** (`TestCaseDraft[]`, sesuai kontrak beku)

```json
[
  {
    "title": "Login berhasil [functional]",
    "objective": "Memverifikasi bahwa \"Login berhasil\" berperilaku sesuai harapan untuk jenis pengujian functional.",
    "preconditions": "Pengguna terdaftar dengan kredensial valid. Environment uji aktif.",
    "type": "functional",
    "layer": "web",
    "priority": "high",
    "severity": "major",
    "estimated_minutes": 19,
    "tags": ["functional", "web", "happy_path", "login"],
    "test_data": [
      { "field": "Email", "value": "qa.tester@example.com" },
      { "field": "Kata Sandi", "value": "Rahasia#2026" }
    ],
    "expected_result": "diarahkan ke dashboard",
    "steps": [
      { "action": "Buka aplikasi dan siapkan environment uji pada kondisi awal yang didefinisikan.", "expected": "Halaman utama tampil tanpa error pada console/network." },
      { "action": "Siapkan prasyarat: Pengguna terdaftar dengan kredensial valid", "expected": "Prasyarat terpenuhi dan terverifikasi." },
      { "action": "Isi field \"Email\" dengan data uji.", "expected": "Nilai diterima sistem tanpa pesan kesalahan.", "data": "qa.tester@example.com" },
      { "action": "Kirim/simpan data dan tunggu proses selesai.", "expected": "Permintaan diproses tanpa error 4xx/5xx yang tidak diharapkan." },
      { "action": "Verifikasi hasil akhir pada UI dan pada data tersimpan.", "expected": "diarahkan ke dashboard" }
    ]
  }
]
```

### 4.2 Contoh — `triage_defect`

```json
// Masukan
{ "title": "Kebocoran data: pengguna lain dapat melihat pesanan",
  "description": "Akses tanpa hak melalui penggantian id",
  "actual_result": "Pesanan milik akun lain tampil" }

// Keluaran
{
  "severity": "critical",
  "priority": "critical",
  "component": "Order Management",
  "likely_root_cause": "Kontrol otorisasi/validasi input tidak diterapkan pada endpoint atau form terkait (kemungkinan missing server-side validation).",
  "reproduction_hint": "Gunakan environment yang sama dengan laporan (catat build & browser). Ikuti langkah: login dengan peran terkait → ulangi aksi → bandingkan hasil Ulangi 3x untuk memastikan bukan flaky; lampirkan screenshot/log/network HAR.",
  "suggested_owner_role": "Backend Engineer (Security Champion)",
  "duplicate_risk": "medium",
  "rationale": "Severity critical & priority critical diturunkan dari kata kunci pada judul/deskripsi (dampak: menghambat alur utama). Komponen \"Order Management\" dipilih dari pencocokan istilah domain. Indikasi isu keamanan menaikkan priority ke critical."
}
```

### 4.3 Endpoint task spesifik

Setiap task juga punya pintasan HTTP yang menerima bentuk masukan yang sama:

```
POST /api/ai/tasks/generate-usecases     POST /api/ai/tasks/generate-scenarios
POST /api/ai/tasks/generate-testcases    POST /api/ai/tasks/generate-test-data
POST /api/ai/tasks/generate-api-tests    POST /api/ai/tasks/generate-db-checks
POST /api/ai/tasks/generate-web-flow     POST /api/ai/tasks/generate-sql
POST /api/ai/tasks/review-coverage       POST /api/ai/tasks/triage-defect
POST /api/ai/tasks/predict-risk          POST /api/ai/tasks/summarize-test-plan
```

---

## 5. Konfigurasi setiap provider

Buka **AI Settings** (`/ai/settings`) atau panggil `PUT /api/ai/settings`.

| Provider | Butuh API key | Base URL default | Model default | Catatan |
|---|---|---|---|---|
| `deepseek` | ya | `https://api.deepseek.com/v1` | `deepseek-chat` | OpenAI-compatible, hemat biaya |
| `openai` | ya | `https://api.openai.com/v1` | `gpt-4o-mini` | `POST /chat/completions` |
| `anthropic` | ya | `https://api.anthropic.com/v1` | `claude-3-5-sonnet-latest` | `POST /messages`, header `x-api-key` + `anthropic-version: 2023-06-01` |
| `google` | ya | `https://generativelanguage.googleapis.com/v1beta` | `gemini-1.5-flash` | `POST /models/{model}:generateContent?key=…` |
| `ollama` | **tidak** | `http://127.0.0.1:11434` | `llama3.1` | `POST /api/chat`, LLM lokal |
| `custom` | ya | `http://127.0.0.1:8000/v1` | `local-model` | Layanan OpenAI-compatible apa pun |
| `mock` | **tidak** | — | `qatools-mock-1` | **Tanpa jaringan sama sekali** |

### Contoh per provider

**DeepSeek** — paling hemat untuk tugas QA terstruktur.

```json
{ "provider": "deepseek", "model": "deepseek-chat",
  "base_url": "https://api.deepseek.com/v1", "api_key": "sk-…",
  "temperature": 0.2, "max_tokens": 4096, "enabled": true, "fallback_to_mock": true }
```

**OpenAI**

```json
{ "provider": "openai", "model": "gpt-4o-mini", "api_key": "sk-…", "temperature": 0.3 }
```

**Anthropic** — prompt sistem dikirim terpisah sebagai field `system`.

```json
{ "provider": "anthropic", "model": "claude-3-5-sonnet-latest", "api_key": "sk-ant-…" }
```

**Google Gemini** — API key dikirim sebagai parameter query `?key=`.

```json
{ "provider": "google", "model": "gemini-1.5-flash", "api_key": "AIza…" }
```

**Ollama (LLM lokal, tanpa key, tanpa internet)**

```bash
ollama serve
ollama pull llama3.1
```

```json
{ "provider": "ollama", "model": "llama3.1", "base_url": "http://127.0.0.1:11434" }
```

**Custom (vLLM / LM Studio / LiteLLM / gateway internal)**

```json
{ "provider": "custom", "model": "Qwen2.5-7B-Instruct",
  "base_url": "http://192.168.1.20:8000/v1", "api_key": "token-gateway" }
```

### Tanpa konfigurasi apa pun (default)

```json
{ "provider": "mock", "model": "qatools-mock-1", "fallback_to_mock": true }
```

Semua task bekerja. Tidak ada permintaan jaringan yang dibuat.

### Tes koneksi

`POST /api/ai/settings/test` melakukan panggilan `chat` kecil yang **nyata** pada pengaturan
yang sedang diisi (termasuk nilai yang belum disimpan) dan melaporkan hasil apa adanya:

```json
{ "ok": true,  "live": true,  "provider": "deepseek", "latency_ms": 842,
  "endpoint": "https://api.deepseek.com/v1/chat/completions",
  "message": "Koneksi berhasil dalam 842 ms. Balasan: \"OK\"", "sample": "OK" }

{ "ok": false, "live": false, "provider": "openai", "latency_ms": 31,
  "message": "Koneksi gagal: HTTP 401: Incorrect API key provided",
  "error": "HTTP 401: Incorrect API key provided" }
```

### Keamanan API key

- Kunci disimpan pada kolom `ai_settings.api_key` dan **tidak pernah dikembalikan utuh**.
  Semua endpoint hanya mengembalikan `api_key_masked` (mis. `sk-…abcd`).
- Form UI memakai `type="password"` dan **selalu kosong** saat dimuat; nilai tersamar hanya
  muncul sebagai *placeholder*. Field yang dibiarkan kosong berarti "pertahankan kunci lama".
- `{"clear_api_key": true}` menghapus kunci.
- Penyimpanan kunci **tidak terenkripsi**. Pada pemakaian bersama, lindungi berkas database
  dan gunakan kunci dengan hak akses minimal.

---

## 6. Crawler (`crawl_site`)

`crawlSite(input)` mengambil halaman dengan `fetch` global lalu mengurainya dengan
**extractor HTML tulisan tangan** — tanpa `cheerio`, tanpa `jsdom`, tanpa dependensi native.

### Yang diekstrak

`title` · `headings` (h1–h3) · `forms` (action, method, field + label + `required`) ·
`links` · `buttons` · `inputs` (name, type, placeholder) · `tables` (header + jumlah baris) ·
`textSample`.

### Penanganan kegagalan

Crawler **tidak pernah melempar exception**. Fetch gagal → `{ fetched: false, … }` beserta
pesan yang membantu dan fitur minimal yang diturunkan dari segmen URL, sehingga
crawl → use case tetap dapat dilanjutkan.

```json
// POST /api/ai/crawl  { "url": "http://127.0.0.1:1/tidak-ada" }
{
  "url": "http://127.0.0.1:1/tidak-ada",
  "fetched": false,
  "pages": [{ "title": "Tidak dapat mengambil http://127.0.0.1:1/tidak-ada",
              "textSample": "Gagal mengambil halaman: … Fitur di bawah diturunkan dari segmen URL." }],
  "features": [{ "name": "Tidak Ada", "kind": "navigation", "suggested_priority": "medium" }],
  "suggested_use_cases": [{ "name": "Menjelajahi Tidak Ada", "actors": ["Pengguna"], "priority": "medium" }],
  "used_mock": true
}
```

### Batasan sumber daya

- Timeout default **12 detik** (`AbortSignal.timeout`).
- Batas ukuran **2 MB**; isi yang lebih panjang dipotong.
- `input.html` dapat diberikan langsung (mis. halaman di balik autentikasi) — **tidak ada
  jaringan yang disentuh**.
- URL relatif (mis. `/mock/demo`) diselesaikan terhadap `QATOOLS_API_BASE`, sehingga mock
  SUT bawaan dapat di-crawl sepenuhnya offline.

### Penurunan fitur & use case

Dari hasil parsing, crawler menurunkan `features` (`form`, `navigation`, `listing`, `detail`,
`action`, `auth`, `search`) beserta `evidence`, `suggested_actor`, dan `suggested_priority`,
lalu menyusun `suggested_use_cases` siap dijadikan use case nyata:

```
form login            → kind: "auth",     priority: "high"
tabel daftar          → kind: "listing",  priority: "medium"
form pencarian        → kind: "search",   priority: "medium"
tombol "Checkout"     → kind: "action",   priority: "critical"
```

---

## 7. AI dalam alur QA berurutan

Lapisan AI bukan tambahan di pinggir — ia mempercepat setiap tahap siklus hidup QA QATools.

```
1  Kebutuhan          crawl_site            → fitur + saran use case dari web existing
        │
2  Use Case           generate_usecases     → UseCaseDraft[]  (aktor, alur, aturan bisnis)
        │
3  Skenario           generate_scenarios    → ScenarioDraft[] (happy/negatif/edge/keamanan/performa)
        │
4  Test Case          generate_testcases    → TestCaseDraft[] (langkah, data uji, hasil harapan)
        │
5  Matrix             review_coverage       → temuan celah + saran test case penutup
        │
6–7 Perencanaan       summarize_test_plan   → scope, pendekatan, risiko, jadwal, kriteria keluar
                      generate_test_data    → baris data uji (valid/invalid/batas/khusus)
        │
8  Eksekusi           generate_api_tests    → ApiRequestDraft[] + Assertion
                      generate_db_checks    → DbCheckDraft[]   + SQL verifikasi
                      generate_web_flow     → WebFlowDraft[]   + langkah UI & selector
        │
9  Defect             triage_defect         → severity, priority, komponen, akar masalah, pemilik
        │
10 Regresi (King)     predict_risk          → skor risiko + urutan eksekusi + keanggotaan regresi
```

### Rantai penuh dengan penyimpanan

```bash
# 1. Kebutuhan → use case (tersimpan + matrix_links requirement_to_usecase)
curl -X POST http://127.0.0.1:5174/api/ai/generate \
  -H 'Content-Type: application/json' \
  -d '{"task":"generate_usecases","project_id":"prj_…","persist":true,
       "input":{"feature_description":"Pengguna dapat login dengan email.","requirement_ids":["req_…"]}}'

# 2. Use case → skenario (matrix_links usecase_to_scenario)
curl -X POST http://127.0.0.1:5174/api/ai/tasks/generate-scenarios \
  -H 'Content-Type: application/json' \
  -d '{"project_id":"prj_…","persist":true,
       "use_case_ids":["uc_…"],"use_case":{…},"per_use_case":4}'

# 3. Skenario → test case (matrix_links scenario_to_testcase + test_steps)
curl -X POST http://127.0.0.1:5174/api/ai/tasks/generate-testcases \
  -H 'Content-Type: application/json' \
  -d '{"project_id":"prj_…","persist":true,
       "scenario_ids":["sc_…"],"use_case_ids":["uc_…"],"scenario":{…},"per_scenario":3}'
```

Setiap respons mengembalikan id yang dibuat pada `meta.created`, sehingga UI dapat langsung
menavigasi ke artifact tersebut:

```json
{
  "ok": true,
  "data": [ … ],
  "meta": {
    "provider": "mock", "model": "qatools-mock-1", "task": "generate_usecases",
    "used_mock": true, "degraded": false, "latency_ms": 4,
    "prompt_tokens": 0, "completion_tokens": 0,
    "generation_id": "aig_01M7…",
    "created": {
      "use_cases": ["uc_01M7…"], "scenarios": [], "test_cases": [],
      "test_steps": [], "api_requests": [], "db_checks": [],
      "web_flows": [], "requirements": [], "matrix_links": ["mlk_01M7…"]
    },
    "created_labels": [{ "kind": "use_case", "id": "uc_01M7…", "code": "UC-004", "title": "…" }],
    "persist_skipped": []
  }
}
```

### Aturan penyimpanan

- **Hanya INSERT.** Lapisan AI tidak pernah `UPDATE` atau `DELETE` baris milik lane lain.
- Kode artifact memakai `nextCode()` sehingga melanjutkan urutan yang ada (`UC-004`, `TC-012`, …).
- `generated_by = 'ai'` dan `ai_generation_id` selalu diisi.
- Baris `matrix_links` hanya ditulis bila **kedua** induknya ada (tidak ada tautan menggantung).
- Seluruh batch dibungkus satu transaksi — gagal di tengah berarti dibatalkan seluruhnya.
- Bila `api_requests`/`db_checks` perlu induk (`collection_id`/`connection_id`) yang belum ada,
  lapisan AI membuat satu baris induk tambahan secara otomatis.

---

## 8. Mock system-under-test (`aimock`)

Agar otomasi API/web/database dan demo AI punya sasaran **nyata tanpa internet**:

| Endpoint | Perilaku |
|---|---|
| `GET /api/mock/health` | Status + penghitung deterministik |
| `GET /api/mock/products` | Daftar produk (`?q=` untuk pencarian) |
| `POST /api/mock/login` | `admin`/`secret` → token; kredensial salah → **401** |
| `POST /api/mock/orders` | Membuat pesanan; stok habis → 409 |
| `GET /api/mock/orders/:id` | Detail pesanan |
| `GET /api/mock/flaky` | **Gagal deterministik**: 500 bila `counter % 3 != 0`, sukses bila `% 3 == 0` |
| `GET /api/mock/slow?ms=800` | Tidur terbatas (maks 10 detik) untuk menguji timeout |
| `GET /api/mock/echo` | Mengembalikan method/header/query/body |
| `GET /api/mock/state` | Memeriksa penghitung & pola flaky berikutnya |
| `POST /api/mock/reset` | Mengatur ulang penghitung dan pesanan |
| `GET /api/mock/demo` | Halaman HTML dengan form login, form pencarian, tabel, dan tombol |

`/mock/flaky` sengaja **deterministik**, bukan acak: pola 2 gagal lalu 1 sukses membuat
logika retry/healing dapat diuji secara reprodusibel.

```bash
# Pola flaky yang dapat diprediksi
curl -X POST http://127.0.0.1:5174/api/mock/reset
curl -i http://127.0.0.1:5174/api/mock/flaky   # → 500
curl -i http://127.0.0.1:5174/api/mock/flaky   # → 500
curl -i http://127.0.0.1:5174/api/mock/flaky   # → 200
```

---

## 9. Referensi API

| Metode | Path | Keterangan |
|---|---|---|
| `GET` | `/api/ai/status` | `AiStatus` (mode, provider, model, pesan) |
| `GET` | `/api/ai/settings` | Pengaturan + status — **kunci hanya tersamar** |
| `PUT` | `/api/ai/settings` | Menyimpan pengaturan |
| `POST` | `/api/ai/settings/test` | Tes koneksi nyata (ok/latensi/pesan error asli) |
| `GET` | `/api/ai/tasks` | Katalog task + field form + dukungan persist |
| `GET` | `/api/ai/providers` | Katalog provider |
| `GET` | `/api/ai/prompts` | Skema keluaran setiap task |
| `POST` | `/api/ai/generate` | `{ task, input, project_id?, persist? }` → `AiResult<unknown>` |
| `POST` | `/api/projects/:projectId/ai/generate` | Sama, terikat project dari path |
| `POST`/`GET` | `/api/ai/crawl` | `CrawlResult` |
| `POST` | `/api/ai/chat` | `{ messages }` → balasan kontekstual (bekerja offline) |
| `POST` | `/api/ai/tasks/<nama>` | 12 pintasan task spesifik |
| `GET` | `/api/ai/generations` | Riwayat generasi (`?project_id=&task=&limit=&offset=`) |
| `GET` | `/api/ai/health` | Diagnostik lapisan AI |

### Permukaan in-process (untuk lane lain)

```ts
import { aiService } from '../ai/index.js';

await aiService.generate<T>(task, input, ctx?): Promise<AiResult<T>>
await aiService.status(): Promise<AiStatus>
await aiService.crawl(input): Promise<CrawlResult>
```

Lane B memakai `aiService.generate('triage_defect', …)` untuk triase defect.

---

## 10. Antarmuka pengguna

| Halaman | Rute | Isi |
|---|---|---|
| **AI Studio** | `/ai` | Pemilih seluruh `AI_TASKS`, form input dinamis, Generate, JSON cantik pada blok `.pre`, tombol "Simpan sebagai artifact", indikator 🟢 Live / 🟡 Offline, tabel riwayat generasi, dan kartu aksi cepat untuk rantai bernilai tinggi |
| **AI Settings** | `/ai/settings` | Pilih provider, model, base URL, API key (password, **tidak pernah menampilkan kunci tersimpan**), temperature/max_tokens, tombol aktif & fallback offline, "Tes Koneksi" dengan latensi/error nyata, dan penjelasan jujur tentang mode offline |

---

## 11. Catatan implementasi & batasan

- **Tanpa dependensi baru.** Tidak ada `openai`, `@anthropic-ai/sdk`, `@google/generative-ai`,
  `axios`, `node-fetch`, `cheerio`, `jsdom`, `tiktoken`, atau modul native apa pun. Semua
  permintaan memakai `fetch` global; semua parsing HTML ditulis tangan. Ini disengaja: mesin
  tanpa toolchain C tidak boleh gagal `pnpm install` karena lapisan AI.
- **Tidak ada balasan model yang menghasilkan 500.** `extractJson()` menangani fence markdown,
  prosa sebelum/sesudah JSON, objek bersarang, tanda kutip tipografis, dan trailing comma;
  bila semuanya gagal, generator offline mengambil alih.
- **Setiap panggilan tercatat.** Sukses, mock, maupun gagal — semuanya masuk ke
  `ai_generations` beserta token, latensi, dan pesan error.
- **Provider yang diuji secara langsung:** `mock` (seluruh alur), serta jalur kegagalan
  terkontrol untuk `deepseek`, `openai`, `anthropic`, `google`, `ollama`, dan `custom`
  (diarahkan ke port tertutup, memastikan setiap adapter memetakan kegagalan menjadi hasil
  terstruktur tanpa melempar exception).
- **Provider yang diimplementasikan namun belum diuji langsung dengan kunci sungguhan:**
  `deepseek`, `openai`, `anthropic`, `google`, `ollama`, dan `custom`. Pemetaan bentuk respons
  mengikuti dokumentasi resmi masing-masing vendor, tetapi belum diverifikasi terhadap API
  produksi karena lingkungan pengujian tidak memiliki kunci maupun jaminan jaringan.
  Gunakan **Tes Koneksi** di AI Settings untuk memverifikasi sebelum diandalkan.
- **Pencarian multi-halaman belum diterapkan.** `max_pages` dan `depth` diterima pada
  `CrawlSiteInput` namun crawler saat ini menganalisis satu halaman per pemanggilan.
- **`generate_sql` hanya menghasilkan `SELECT`.** Permintaan yang menyebut operasi tulis
  tetap dijawab dengan peringatan eksplisit dan tidak pernah mengeksekusi apa pun.
