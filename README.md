<div align="center">

# QATools

**Platform Quality Assurance end-to-end — dari kebutuhan sampai e-Certificate.**

Use case & scenario builder · digital traceability matrix · manajemen proyek QA ·
regresi (👑 King of the Test) · manual / DB / API / Web / **AI** automation · metrik QA · kurikulum & sertifikat.

</div>

---

## Mengapa QATools

Sebagian besar tim QA memakai 6–8 alat terpisah: dokumen use case di Word, matrix di Excel,
test case di spreadsheet, defect di tracker lain, automation di repo ketiga, metrik dihitung manual.
Akibatnya rantai **kebutuhan → use case → skenario → test case → eksekusi → defect → regresi → rilis**
terputus, dan tidak ada satu pun tempat yang bisa menjawab pertanyaan:

> *"Kebutuhan nomor 4 ini sudah diuji belum, oleh test case mana, lulus atau tidak, dan defect-nya apa?"*

QATools menjawabnya dalam satu platform, dan menuntun tim **berurutan** — 12 tahap yang saling terhubung.

## Alur kerja 12 tahap (tulang punggung produk)

| # | Tahap | Yang dikerjakan |
|---|---|---|
| 1 | 📋 **Kebutuhan** | Kumpulkan kebutuhan dari stakeholder, atau **analisis web existing** lewat Site Analyzer |
| 2 | 📘 **Use Case** | Aktor, pre/post-condition, alur utama, alur alternatif, business rules |
| 3 | 🧭 **Skenario** | Happy path, alternatif, negatif, edge, security, performance |
| 4 | 🧪 **Test Case** | Langkah terurut, data uji, hasil diharapkan, tipe, layer, engine |
| 5 | 🔗 **Traceability Matrix** | Peta digital kebutuhan → use case → skenario → test case → defect |
| 6 | 🗂️ **Perencanaan** | Cycle, sprint, kapasitas, alokasi tester, estimasi effort |
| 7 | 🖥️ **Environment & Data** | Environment, kredensial, test data set |
| 8 | ▶️ **Eksekusi** | Manual, Database, API, Web, dan **AI automation** |
| 9 | 🐞 **Defect** | Catat, triase (dibantu AI), lacak sampai terverifikasi |
| 10 | 👑 **Regresi** | **Raja dari segala test** — pemilihan suite berbasis risiko |
| 11 | 🚦 **Release Gate** | Keputusan go / conditional / no-go yang terukur |
| 12 | 📊 **Metrik** | Pass rate, coverage, defect density, escape rate, flaky test |

## Fitur utama

### 1–2. Document creation & digital traceability matrix
- **Site Analyzer** — masukkan URL web existing, QATools mengekstrak judul, heading, form, tombol,
  link, dan tabel; lalu mengusulkan requirement + use case.
- **Use Case Builder** — struktur lengkap: aktor, pre/post-condition, alur utama berurutan,
  alur alternatif, dan business rules. Bisa dibuat manual atau di-generate AI.
- **Traceability Matrix** — matriks hidup dengan status cakupan per kebutuhan
  (`Tercakup` / `Sebagian` / `Belum Tercakup` / `Tanpa Induk`), deteksi gap dan orphan,
  impact analysis ("kalau use case ini berubah, test case mana yang terdampak?"),
  serta ekspor CSV / Markdown.

### 3. Project management khusus QA
- Cycle & sprint dengan kapasitas, scope, dan progress.
- **Defect tracker** dengan penjaga transisi status (tidak bisa lompat `new` → `closed`).
- **👑 Regresi — King of the Test.** Lima strategi pemilihan suite:
  `risk_based` (default), `full`, `impact_only`, `smoke_then_full`, dan `time_boxed`.
  Setiap test case mendapat skor risiko yang **dapat dijelaskan** (bobot kritikalitas bisnis,
  frekuensi pemakaian, kompleksitas, riwayat defect, kegagalan terakhir, status otomasi).
  Setiap baris membawa alasan mengapa ia dipilih atau dikecualikan.
- **Katalog metrik QA** — Requirement Coverage, Test Execution Progress, Pass/Fail Rate,
  Defect Density, Defect Leakage (escape rate), Defect Reopen Rate, Regression Pass Rate,
  Automation ROI, dan deteksi **flaky test**.
- **Release Gate** — go / conditional / no-go dihitung terhadap `quality_gate` project.

### 4. AI untuk automation
- **Multi-provider**: DeepSeek, OpenAI, Anthropic, Google Gemini, Ollama (lokal), custom OpenAI-compatible.
- **AI menjalankan automation**, bukan cuma menulis teks: generate use case, skenario, test case
  beserta langkahnya, data uji, API test, DB check, web flow, review cakupan, triase defect,
  dan prediksi risiko untuk regresi.
- **Mode offline deterministik** — tanpa API key, seluruh fitur AI tetap menghasilkan artifact QA
  yang masuk akal lewat generator berbasis aturan. Platform **tidak pernah** gagal hanya karena
  tidak ada API key atau tidak ada internet.
- API key disimpan lokal dan **hanya ditampilkan dalam bentuk ter-mask**.

### 5. Eksekusi & automation
| Engine | Cakupan |
|---|---|
| ✋ **Manual** | Run manual dengan pencatatan hasil, bukti, dan promosi ke defect sekali klik |
| 🗄️ **Database** | SQL check dengan assertion pada `row_count`/`kolom`, plus **readonly guard** yang menolak statement non-SELECT |
| 🔌 **API** | Postman-like: collection, variable interpolation `{{var}}`, auth bearer/basic/api-key, assertion DSL, import OpenAPI |
| 🌐 **Web** | Flow berbasis langkah + saran selector otomatis; mode HTTP asli, atau Playwright bila Anda pasang sendiri |
| ✨ **AI** | Model menalar hasil dan mengusulkan verdict saat assertion tidak konklusif |

Satu **assertion DSL** dipakai bersama oleh engine API, DB, dan Web.

### 6. Belajar & e-Certificate
- Kurikulum lengkap: **QA Introduction · QA Test Technique · QA Test Activity · Basic QA Automation ·
  API Automation · Web Automation · Database Testing · Studi Kasus End-to-End · Bangun Portofolio**.
- Setiap course berisi modul, materi, kuis dengan pembahasan, dan **lab yang terhubung langsung**
  ke fitur QATools (`lab_ref`).
- **e-Certificate** dengan kode unik, grade, dan `verification_hash` SHA-256 sehingga
  keasliannya bisa diverifikasi publik lewat halaman `/verify` — dan terdeteksi bila dipalsukan.
- Sertifikat hanya terbit bila progres 100% **dan** seluruh kuis lulus.

## Mulai cepat

```bash
git clone https://github.com/yogiarjan/qatools.git
cd qatools
pnpm install          # tanpa native module — tidak butuh compiler C

pnpm seed             # kurikulum QA
pnpm -F @qatools/api exec tsx src/seed/demo.ts   # project demo end-to-end

pnpm dev              # API http://127.0.0.1:5174  ·  Web http://127.0.0.1:5173
```

Buka **http://127.0.0.1:5173** — pilih project *DEMO-QA* di sidebar untuk melihat
seluruh alur terisi dari tahap 1 sampai 12.

### Verifikasi cepat

```bash
node scripts/probe.mjs                 # boot API + status registrasi seluruh modul
node -e "fetch('http://127.0.0.1:5174/api/health').then(r=>r.json()).then(console.log)"
```

## Arsitektur

```
qatools/
├─ apps/api/       Fastify 5 + node:sqlite + TypeScript   (seluruh persistence)
├─ apps/web/       React 18 + Vite 5 + TypeScript          (seluruh UI)
├─ packages/shared/  kosakata domain & kontrak antar-lane (frozen)
├─ docs/           dokumentasi produk, proses QA, kurikulum, verifikasi
└─ scripts/        harness boot/probe
```

**Pilihan teknologi yang disengaja:** `node:sqlite` (bawaan Node ≥ 22) alih-alih `better-sqlite3`,
dan tanpa library chart/markdown/HTTP eksternal — supaya `pnpm install` berhasil di mesin mana pun
tanpa compiler C, tanpa unduhan browser, dan tanpa akses internet.

Baca **[ARCHITECTURE.md](./ARCHITECTURE.md)** untuk kontrak lengkap antar-modul.

## Dokumentasi

| Dokumen | Isi |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Kontrak teknis, peta kepemilikan, konvensi API/DB/UI |
| `docs/qa-process/` | Alur use case, skenario, dan traceability matrix |
| `docs/project-management/` | Perencanaan QA, regresi, katalog metrik |
| `docs/automation/` | Engine eksekusi & referensi assertion DSL |
| `docs/ai/` | Konfigurasi provider AI & katalog task |
| `docs/curriculum/` | Peta kurikulum & desain sertifikat |
| `docs/verification/` | Hasil verifikasi end-to-end independen |

## Lisensi

MIT
