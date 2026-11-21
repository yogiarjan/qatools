# Manajemen Proyek QA & Regresi — "King of the Test"

> Dokumen ini menjelaskan **Langkah 6–12** dari siklus QA QATools: perencanaan proyek (cycle &
> sprint), penyiapan environment & test data, eksekusi, pelacakan defect, **regresi sebagai raja**,
> gerbang rilis, dan pelaporan metrik.
>
> Kode program memakai identifikasi berbahasa Inggris (`regressionService`, `riskScore`), sedangkan
> teks antarmuka dan dokumen ini memakai Bahasa Indonesia — sesuai kebijakan bahasa di
> `ARCHITECTURE.md` §10.

---

## 1. Posisi tahap ini dalam siklus QA

QATools memaksa alur yang **berurutan**. Setiap tahap memakan keluaran tahap sebelumnya, dan
melompati urutan akan membuat angka metrik kehilangan makna.

| # | Tahap | Keluaran yang dikonsumsi tahap berikutnya |
|---|---|---|
| 1–5 | Kebutuhan → Use Case → Skenario → Test Case → Matrix | katalog test case + traceability |
| **6** | **Perencanaan (cycle & sprint)** | alokasi orang, estimasi effort, jadwal |
| **7** | **Environment & Test Data** | target eksekusi + data uji |
| **8** | **Eksekusi** (manual / DB / API / web / AI) | hasil per test case |
| **9** | **Defect** | defect tertaut ke kasus dan hasil run |
| **10** | **Regresi 👑** | suite optimal + keputusan gerbang |
| **11** | **Release Gate** | keputusan go / kondisional / no-go |
| **12** | **Metrik** | bukti untuk perbaikan siklus berikutnya |

Halaman **Dashboard** menggambar keduabelas tahap ini sebagai strip berurutan dengan jumlah hidup
per tahap dan satu CTA "langkah berikutnya" — supaya sifat berurutan itu tidak bisa dilewatkan.

---

## 2. Perencanaan Sprint QA

### 2.1 Struktur

```
Cycle  (mis. CYC-2026-C01, 1 kuartal)
 └─ Sprint (SPR-01, 2 minggu)  — punya capacity_points
     └─ Sprint Scope            — test_case_id + assignee + estimate_minutes + status
```

Batasan yang ditegakkan basis data:

- `sprints` unik pada `(cycle_id, code)`.
- `sprint_scope` unik pada `(sprint_id, test_case_id)` — menambahkan kasus yang sama dua kali akan
  **memperbarui**, bukan menduplikasi.

### 2.2 Kapasitas dan estimasi

`capacity_points` sprint dikonversi dengan asumsi yang dinyatakan terbuka di UI:

> **1 poin kapasitas ≈ 60 menit effort QA.**

Estimasi baris scope secara default diwarisi dari `test_cases.estimated_minutes`, sehingga penaksir
tidak perlu memasukkan angka dua kali. Endpoint `GET /projects/:id/plan` melaporkan
`capacity_used_pct` per sprint dan menandai sprint yang **over capacity** di UI.

### 2.3 Planned vs Actual

`buildPlan()` menghitung effort **terencana** dan **aktual** secara terpisah:

- **Terencana** = Σ `sprint_scope.estimate_minutes`.
- **Aktual** = untuk setiap baris scope, ambil durasi nyata dari `run_results` milik run yang
  terikat sprint tersebut; bila belum pernah dieksekusi, estimasi terencana dipakai sebagai
  pengganti (supaya persentase tidak melompat ke 0 hanya karena sprint belum jalan).

Query aktual memakai **subquery berkorelasi**, bukan `JOIN`, agar beberapa run untuk kasus yang sama
tidak menggandakan baris dan menggelembungkan total.

### 2.4 Entry & Exit Criteria

Setiap cycle menyimpan `entry_criteria` dan `exit_criteria` sebagai array JSON. Contoh yang dipakai
di UI:

**Entry criteria (syarat QA boleh dimulai)**
- Semua requirement utama berstatus `approved`.
- Use case sudah punya skenario positif **dan** negatif.
- Test case kritis sudah punya langkah dan data uji.
- Environment staging sehat dan test data tersedia.

**Exit criteria (syarat cycle boleh ditutup)**
- Pass rate ≥ quality gate project.
- Tidak ada defect severity `blocker`/`critical` yang masih terbuka.
- Suite regresi dijalankan penuh pada build kandidat dan hijau.
- Seluruh defect `fixed` sudah melewati `retest` → `verified`.

---

## 3. Environment & Test Data

| Field | Kegunaan |
|---|---|
| `base_url` | target untuk engine web automation |
| `api_base` | target untuk engine API automation |
| `db_uri` | target untuk engine database |
| `variables` | JSON key→value, dipakai sebagai substitusi variabel di artefak otomasi |
| `kind` | `dev` / `staging` / `uat` / `prod` / `local` |
| `is_default` | **tepat satu per project** |

**Invarian satu default.** Menandai environment sebagai default akan menghapus flag default dari
environment lain di project yang sama di dalam satu transaksi. Environment pertama yang dibuat
otomatis menjadi default, dan menghapus environment default akan mempromosikan environment lain —
project tidak pernah dibiarkan tanpa target eksekusi.

*Catatan keamanan:* `db_uri` disimpan apa adanya; enkripsi at-rest dinyatakan **di luar cakupan**
(kebijakan yang sama dengan `db_connections.dsn` di `ARCHITECTURE.md`).

---

## 4. Defect: alur status yang dijaga

Perpindahan status tidak bebas. Server menolak lompatan ilegal dengan
`409 illegal_transition` beserta daftar transisi yang sah, sehingga UI tidak pernah menampilkan
tombol yang akan gagal.

### 4.1 Jalur utama

```
new → triaged → in_progress → fixed → retest → verified → closed
```

### 4.2 Matriks transisi lengkap

| Dari | Boleh pindah ke |
|---|---|
| `new` | `triaged`, `in_progress`, `rejected`, `deferred` |
| `triaged` | `in_progress`, `rejected`, `deferred` |
| `in_progress` | `fixed`, `rejected`, `deferred` |
| `fixed` | `retest`, `reopened`, `deferred` |
| `retest` | `verified`, `reopened`, `deferred` |
| `verified` | `closed`, `reopened` |
| `reopened` | `in_progress`, `triaged`, `rejected`, `deferred` |
| `closed` | `reopened` |
| `rejected` | `reopened`, `triaged` |
| `deferred` | `triaged`, `in_progress`, `rejected` |

`closed_at` diisi saat status menjadi `closed`, dan **dibersihkan** begitu defect keluar dari status
tertutup — supaya lama terbuka (`age`) tidak salah hitung.

### 4.3 Promosi dari hasil run

`POST /defects/:id/promote-from-result { run_result_id }` membuat defect dari hasil run yang gagal
**dan** menulis `defects.id` balik ke `run_results.defect_id`. Penautan bersifat dua arah sehingga:

- UI bisa menampilkan defect dari baris hasil, dan
- pemanggilan kedua kali bersifat **idempoten** — tidak pernah membuat defect duplikat.

Langkah reproduksi diisi otomatis dari `test_steps` test case terkait, dan `source` mengikuti run
yang menghasilkan kegagalan (`regression`, `api`, `web`, `db`, `ai`, `manual`).

### 4.4 Triase AI

`POST /defects/:id/ai-triage` memanggil `aiService.generate('triage_defect', …)` milik lane AI dan
menyimpan hasil JSON ke `defects.ai_triage`. Bila modul AI belum tersedia, API menjawab
`503 ai_unavailable` — defect tetap dapat dikelola manual.

---

## 5. Regresi — 👑 King of the Test

### 5.1 Mengapa regresi disebut "Raja"

Fitur baru membuktikan bahwa sesuatu **bekerja**. Regresi membuktikan bahwa **tidak ada yang rusak**.
Ditambah fakta bahwa:

1. Regresi adalah **gerbang terakhir** sebelum rilis — satu-satunya tahap yang boleh mengatakan "tidak".
2. Regresi berjalan **berulang** setiap build, jadi biayanya berlipat, sedangkan nilainya menumpuk.
3. Regresi menangkap **regresi diam-diam** — fitur yang dulu lulus lalu rusak tanpa ada yang mengubah
   test case-nya.

Karena itu regresi mendapat halaman sendiri, model pemilihan sendiri, dan keputusan yang **wajib bisa
dijelaskan**. Suite regresi yang tidak dapat dipertanggungjawabkan sama berbahayanya dengan tidak ada
suite sama sekali.

### 5.2 Lima strategi pemilihan

| Strategi | Aturan | Kapan dipakai |
|---|---|---|
| `risk_based` *(default)* | skor risiko ≥ 65, **atau** anggota suite regresi, **atau** gagal di eksekusi terakhir, **atau** punya defect terbuka | regresi harian normal |
| `full` | seluruh test case aktif, diurutkan risiko | build kandidat rilis |
| `impact_only` | hanya kasus yang terjangkau dari artefak berubah (`impact_of`) | perubahan terlokalisasi |
| `smoke_then_full` | Fase 1 smoke cepat (maks 15 kasus otomatis), Fase 2 suite penuh | umpan balik cepat dulu |
| `time_boxed` | ambil risiko tertinggi lebih dahulu sampai anggaran menit habis | waktu terbatas |

### 5.3 Model skor risiko

Skor memakai fungsi **beku** `riskScore()` dari `@qatools/shared` — satu implementasi untuk seluruh
platform, tanpa duplikasi. Komponennya:

| Faktor | Bobot | Sumber di QATools |
|---|---|---|
| Business criticality | +34 kritis / +26 tinggi / +16 sedang / +8 rendah / +12 bawaan | prioritas **tertinggi** di antara test case → skenario → use case → requirement |
| Usage frequency | +20 selalu / +14 sering / +8 kadang / +3 jarang | diturunkan dari tipe kasus & severity (blocker/kritis = selalu) |
| Complexity | +16 tinggi / +10 sedang / +5 rendah | layer (web/mobile lebih berat), jumlah `test_steps`, tipe kasus |
| Defect history | +3 per defect, **maks +15** | jumlah defect yang tertaut ke test case |
| Last run failed | +12 | status hasil eksekusi terakhir |
| Regression case | +6 | `is_regression = 1` |
| Not automated | +5 | `automation_status ≠ 'automated'` |

Ambang: **≥ 65 = risiko tinggi**, 35–64 = sedang, < 35 = rendah.

**Kritikalitas bisnis diwarisi.** Sebuah test case yang memverifikasi requirement `critical` tetap
dianggap kritis walaupun penulisnya mengetik `medium` pada baris kasus. Nilai tertinggi di sepanjang
rantai yang menang, dan UI menampilkan **dari mana** nilai itu berasal
(`business_criticality_source`).

### 5.4 Keterlacakan yang dapat diaudit

Setiap kasus — **baik yang terpilih maupun yang dikecualikan** — membawa `reason` yang dapat dibaca
manusia:

```
MASUK — risiko tinggi 87 ≥ ambang 65; anggota tetap suite regresi; gagal pada eksekusi
terakhir; defect terbuka: BUG-001, BUG-004. Faktor skor: business criticality +34,
usage frequency +20, complexity +10, last run failed +12, regression case +6, not automated +5.
```

```
DIKELUARKAN — Skor risiko 24 di bawah ambang 65; bukan anggota suite regresi; eksekusi
terakhir passed; tidak ada defect terbuka; kritikalitas low (test case), 0 defect historis.
```

Pengecualian yang tidak dijelaskan adalah risiko tersembunyi, jadi `excluded` tidak pernah kosong
tanpa alasan.

### 5.5 Cakupan risiko tinggi — angka yang paling penting

`coverage_of_high_risk_pct` = kasus risiko tinggi terpilih / seluruh kasus risiko tinggi.

- **100 %** → gate rilis dapat dipercaya.
- **< 100 %** → `detail.excluded_high_risk` mendaftarkan setiap kasus yang terbuang, dan rasional
  menyatakan peringatan secara eksplisit.

Pada strategi `time_boxed`, kasus risiko tinggi yang tidak muat **tidak pernah dibuang diam-diam**;
alasannya diberi prefiks `RISIKO TINGGI TERBUANG` dan anggaran yang kurang dilaporkan di UI.
Menyembunyikan kasus kritis demi memenuhi anggaran adalah kegagalan produk, bukan optimasi.

### 5.6 Rasional

Setiap rencana menyertakan `rationale` dalam Bahasa Indonesia yang menyebut angka nyata: jumlah
terpilih, estimasi menit, porsi terotomasi, dan cakupan risiko tinggi. Ketika suite kosong, rasional
mengatakan **mengapa** kosong (mis. `impact_only` tanpa `impact_of`) alih-alih diam-diam beralih ke
strategi lain.

### 5.7 Flaky

Kasus dianggap flaky bila dalam 90 hari terakhir statusnya berganti minimal **2 kali** dan ia pernah
**lulus sekaligus gagal**. Kasus flaky merusak kepercayaan pada hasil regresi, jadi ia ditampilkan
sebagai panel tersendiri dengan `flips` dan `pass_rate` agar bisa dikarantina atau diperbaiki.

---

## 6. Katalog Metrik QA

Tersedia di UI melalui tombol **"Katalog & rumus metrik"** dan di API melalui
`GET /api/metrics/catalog`.

### 6.1 Cakupan (Coverage)

| Metrik | Rumus | Target |
|---|---|---|
| `requirement_coverage_pct` | kebutuhan dengan ≥ 1 test case terjangkau / total kebutuhan × 100 | ≥ 95 % |
| `test_case_execution_pct` | test case unik yang punya hasil eksekusi final / total test case aktif × 100 | ≥ 90 % |
| `automation_pct` | test case terotomasi / total test case aktif × 100 | ≥ 40 % |
| `regression_suite_size` | jumlah test case dengan `is_regression = 1` | ≥ 20 kasus |

> **Aturan arah link (`ARCHITECTURE.md` §5.4).** `matrix_links.from_id` adalah artefak **hulu/induk**
> dan `to_id` adalah **hilir/turunan**, mengikuti arah siklus QA
> (requirement → use case → skenario → test case). Untuk mencari apa yang mencakup sebuah
> requirement, query `from_id = <requirement>`. **Requirement tidak pernah menjadi ujung hilir.**
>
> `metricsService` **mendelegasikan** `requirement_coverage_pct` ke `matrixService.document()` milik
> lane A, karena kedua angka ditampilkan berdampingan dan tidak boleh berbeda. Delegasi dilakukan
> lewat dynamic import dengan fallback lokal yang mengikuti arah §5.4 yang sama. Ada uji regresi yang
> menegaskan `matrix.coverage_pct === metrics.requirement_coverage_pct`.

### 6.2 Kualitas (Quality)

| Metrik | Rumus | Target |
|---|---|---|
| `pass_rate` | `passed` / seluruh eksekusi final × 100 | ≥ quality gate |
| `fail_rate` | `failed` / seluruh eksekusi final × 100 | ≤ 5 % |
| `block_rate` | `blocked` / seluruh eksekusi final × 100 | ≤ 3 % |
| `defect_density` | total defect / total test case aktif | ≤ 0,5 |
| `defect_leakage_pct` | defect `is_escaped = 1` / total defect × 100 | ≤ 2 % |
| `reopen_rate` | defect berstatus `reopened` / total defect × 100 | ≤ 5 % |
| `regression_suite_pass_pct` | `passed` pada run **berjenis regression** / seluruh hasil run regression × 100 | 100 % untuk `go` |

Definisi "eksekusi final" = `status IN ('passed','failed','blocked','skipped')`. Baris `not_run`
sengaja **tidak** dihitung: ia ada agar daftar hasil menampilkan scope yang belum dikerjakan, tetapi
tidak boleh menggelembungkan cakupan eksekusi.

### 6.3 Efisiensi (Efficiency)

| Metrik | Rumus |
|---|---|
| `avg_case_duration_ms` | total `duration_ms` eksekusi final / jumlah eksekusi final |
| `automation_roi_minutes_saved` | (jumlah eksekusi otomatis × 3 menit baseline manual − total durasi otomatis) / 60 000 |
| `estimated_hours_saved_per_run` | ROI otomasi dalam menit / 60 |

Baseline 3 menit per eksekusi manual dinyatakan terbuka di UI karena merupakan **asumsi**, bukan
pengukuran. Durasi otomatis memakai waktu terukur yang sebenarnya.

### 6.4 Kesiapan (Readiness) & gerbang rilis

`go_no_go` diturunkan dari `projects.quality_gate`:

| Keputusan | Syarat |
|---|---|
| `no_go` | belum ada eksekusi sama sekali, **atau** `pass_rate < quality_gate` |
| `conditional` | `pass_rate` memenuhi gate **tetapi** masih ada blocker |
| `go` | `pass_rate ≥ quality_gate` **dan** tanpa blocker |

Blocker yang dihitung:

- Defect severity `blocker`/`critical` yang masih terbuka (dengan kode dan judulnya).
- Pass rate di bawah quality gate (menyebut selisihnya).
- Test case terblokir — hasilnya belum dapat diverifikasi.
- Suite regresi masih kosong.
- Defect berstatus `fixed`/`retest` yang belum diverifikasi.
- Defect yang lolos ke production (`is_escaped = 1`).

### 6.5 Tren & flaky

`trend` adalah deret 30 hari yang **selalu berisi** setiap tanggal dalam rentang — hari tanpa eksekusi
muncul sebagai nol, supaya grafik tidak bohong dengan cara memampatkan waktu. Grafiknya digambar
dengan SVG buatan sendiri (tidak ada library chart, sesuai keputusan stack di `ARCHITECTURE.md` §4).

---

## 7. Kontrak lintas-lane yang diandalkan lane ini

| Arah | Simbol | Perilaku bila modul belum ada |
|---|---|---|
| lane B ← lane C | `executeService.runSuite(ids, opts)` di `modules/execute/index.ts` | dynamic import + `503 engine_unavailable` |
| lane B ← lane D | `aiService.generate('triage_defect', …)` di `modules/ai/index.ts` | dynamic import + `503 ai_unavailable` |
| lane B ← lane A | `matrixService.document(projectId)` di `modules/matrix/index.ts` | fallback traversal lokal ber-arah §5.4 |
| lane B → lane C | `regressionService.selectSuite(projectId, opts)` | diekspor dari `modules/regression/index.ts` |
| lane B → A, C, E | `metricsService.snapshot(projectId)` | diekspor dari `modules/metrics/service.ts` |

**Aturan mutlak:** modul lintas-lane **tidak pernah** diimpor di tingkat atas file. Import dilakukan
di dalam handler, sehingga modul yang belum ada tidak dapat menggagalkan boot atau typecheck. Tiga
bridge tersebut punya uji yang menegaskan jawaban 503 saat modul tidak tersedia, dan uji integrasi
yang memverifikasi jalur normal saat modul sudah ada.

---

## 8. Ringkasan berkas

| Berkas | Isi |
|---|---|
| `apps/api/src/modules/cycles/{index,repo}.ts` | cycle, sprint, scope, `GET /plan` (planned vs actual + data gantt) |
| `apps/api/src/modules/runs/{index,repo}.ts` | run, hasil, roll-up, bridge eksekusi |
| `apps/api/src/modules/regression/{index,service,repo}.ts` | `regressionService.selectSuite` + 5 strategi |
| `apps/api/src/modules/metrics/{index,service}.ts` | `metricsService.snapshot` / `trend` / `readiness` |
| `apps/api/src/modules/defects/{index,repo}.ts` | defect, penjaga transisi, promosi, statistik, triase AI |
| `apps/api/src/modules/environment/{index,repo}.ts` | environment (default tunggal) & test data set |
| `apps/api/test/lane-b.test.ts` | 69 uji: alur, penjaga transisi, anggaran, kesepakatan §5.4, degradasi lintas-lane |
| `apps/web/src/features/{dashboard,cycles,regression,metrics,defects,environment}/` | 7 halaman UI |
