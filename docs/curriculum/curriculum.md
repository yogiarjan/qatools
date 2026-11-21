# Kurikulum Software Quality Assurance — QATools

> Dokumen ini menjelaskan kurikulum belajar QATools secara lengkap: peta kursus, urutan jalur
> belajar, empat pilar nilai yang dijanjikan, serta desain e-Certificate dan verifikasinya.
> Bahasa: Indonesia (bahasa produk). Identifier kode tetap dalam bahasa Inggris.

---

## 1. Ringkasan

Kurikulum ini menyediakan **9 kursus**, **32 modul**, **101 pelajaran**, **90 tautan lab praktik**,
**9 kuis**, dan **52 soal** yang seluruhnya diambil dari satu sumber data:
`apps/api/src/seed/curriculum.ts` (dengan konten pada `content-a.ts`, `content-b.ts`, `content-c.ts`).

Seluruhnya berasal dari satu brosur kursus **"Software Quality Assurance"** yang memuat:

**Empat pilar nilai (pills):**

| Pilar | Janji yang dielaborasi |
|---|---|
| **e-Certificate** | Sertifikat digital dengan kode unik `QAT-<tahun>-<6 base32>`, grade, dan sidik SHA-256 yang dapat diverifikasi publik tanpa login. |
| **Materi & Praktik** | Setiap konsep dipasangkan dengan lab yang menaut langsung ke fitur QATools, sehingga teori tidak berhenti di bacaan. |
| **Belajar Online** | Belajar mandiri: progres per pelajaran tersimpan, bisa ditinggalkan dan dilanjutkan kapan saja. |
| **Bangun Portofolio** | Artefak yang dihasilkan selama belajar (requirement, matrix, otomasi, metrik) dikemas menjadi bukti kompetensi. |

**Delapan item kurikulum + "dan masih banyak lagi":**

`QA Introduction` · `QA Test Technique` · `QA Test Activity` · `Basic QA Automation` ·
`API Automation` · `Web Automation` · `Database Testing` · **dan masih banyak lagi**

Frasa *"dan masih banyak lagi"* tidak dibiarkan menggantung. Ia dielaborasi menjadi **dua kursus
tambahan** (studi kasus end-to-end dan pembangunan portofolio) plus jalur sertifikasi itu sendiri.
Dengan demikian setiap kata pada brosur memiliki padanan nyata di dalam produk.

---

## 2. Jalur belajar (learning path)

Urutan kursus **mencerminkan siklus QA QATools** (`QA_STAGES` pada `@qatools/shared`), bukan sekadar
urutan topik. Learner berjalan dari cara berpikir, ke teknik, ke aktivitas, lalu ke otomasi, dan
berakhir pada praktik terpadu serta portofolio.

| # | Kursus | Pilar | Level | Durasi | Modul | Pelajaran |
|---|---|---|---|---|---|---|
| 1 | QA Introduction: Fondasi Software Quality Assurance | QA Introduction | Pemula | 420 mnt | 4 | 13 |
| 2 | QA Test Technique: Merancang Kasus Uji yang Efektif | QA Test Technique | Menengah | 780 mnt | 4 | 13 |
| 3 | QA Test Activity: Perencanaan, Eksekusi, dan Pelaporan | QA Test Activity | Menengah | 720 mnt | 4 | 12 |
| 4 | Basic QA Automation: Otomasi Pertama yang Bertahan Lama | Basic QA Automation | Pemula | 600 mnt | 3 | 9 |
| 5 | API Automation: Menguji Kontrak & Alur Layanan | API Automation | Menengah | 840 mnt | 4 | 12 |
| 6 | Web Automation: Stabil, Cepat, dan Terawat | Web Automation | Menengah | 780 mnt | 3 | 10 |
| 7 | Database Testing: Memverifikasi Kebenaran Data | Database Testing | Menengah | 720 mnt | 4 | 14 |
| 8 | Materi & Praktik: Studi Kasus End-to-End | Materi & Praktik | Lanjutan | 900 mnt | 3 | 9 |
| 9 | Bangun Portofolio QA: Dari Artefak Kerja Menjadi Bukti Kompetensi | Bangun Portofolio | Pemula | 480 mnt | 3 | 9 |

Total waktu belajar terencana: **6.240 menit (104 jam)**.

### Pemetaan jalur belajar ke siklus hidup QA

| Tahap QATools | Kursus yang menyiapkannya |
|---|---|
| 1–2 · Requirements & Use Case | QA Introduction, QA Test Activity |
| 3–4 · Scenarios & Test Cases | QA Test Technique |
| 5 · Traceability Matrix | QA Introduction, QA Test Activity, Materi & Praktik |
| 6–7 · Planning & Environment | QA Test Activity |
| 8 · Execution (manual/API/DB/web) | Basic QA Automation, API Automation, Web Automation, Database Testing |
| 9 · Defects | QA Test Activity, QA Introduction |
| 10 · Regression (King) | QA Test Activity, Basic QA Automation |
| 11–12 · Release & Metrics | QA Test Activity, Materi & Praktik |
| Sertifikasi & karier | e-Certificate (pilar), Bangun Portofolio |

Jalur ini memastikan seorang learner **mengalami** setiap tahap siklus sebelum diminta
mempertanggungjawabkannya pada kursus studi kasus.

---

## 3. Struktur setiap kursus

Setiap kursus mengikuti bentuk yang sama agar dapat diprediksi:

- **3–5 modul** per kursus.
- **3–6 pelajaran** per modul.
- Setiap pelajaran memiliki `content_md` dalam Bahasa Indonesia: multi-paragraf, dengan **heading**,
  **bullet list**, **tabel**, dan **code fence** bila membantu.
- Minimal **1 kuis** per kursus dengan **4+ soal** yang memiliki `answer_index` benar dan
  `explanation` sebagai umpan balik.
- Pelajaran bertipe `lab` memiliki `lab_ref` — deep link ke fitur QATools.

### Jenis pelajaran

| `kind` | Arti | Contoh |
|---|---|---|
| `reading` | Bacaan konseptual | Teknik decision table |
| `lab` | Praktik terpandu di fitur QATools | Lab: Menyusun requirement yang dapat diuji |
| `quiz` | Terkait kuis | — |
| `video` | Disiapkan untuk materi video mendatang | — |

### Deep link lab (`lab_ref`)

Sebanyak **90 pelajaran** memiliki tautan lab. Rute yang dipakai:

| Rute | Dipakai untuk |
|---|---|
| `/requirements` | Menulis acceptance criteria yang dapat diuji |
| `/usecases` | Menyusun use case & alur alternatif |
| `/scenarios` | Menurunkan skenario positif/negatif/edge |
| `/testcases` | Menerapkan teknik desain test |
| `/matrix` | Membuktikan keterlacakan & menemukan gap |
| `/cycles` | Menyusun cycle, sprint, entry/exit criteria |
| `/runs` | Menjalankan siklus eksekusi manual |
| `/execute` | Eksekusi lintas mesin |
| `/api-tester` | Otomasi API & assertion |
| `/db-tester` | Verifikasi data & query integritas |
| `/web-tester` | Otomasi UI, locator, penantian |
| `/defects` | Menulis & men-triase defect |
| `/regression` | Suite regresi (King of the Test) |
| `/metrics` | Metrik, laporan, keputusan rilis |
| `/certificate` | Klaim e-Certificate |
| `/verify` | Verifikasi publik sertifikat |

Inilah yang membuat klaim **"Materi & Praktik"** benar-benar terhubung ke produk: setiap lab adalah
rute nyata yang dapat dibuka learner.

---

## 4. Cakupan materi per kursus

### 1 · QA Introduction
Kualitas sebagai bukti (bukan opini) · QA vs QC vs testing · verifikasi vs validasi · peran &
kompetensi QA · rantai **error → defect → failure** · kategori cacat · severity vs priority ·
defect leakage · SDLC vs STLC · tur 12 tahap QATools · tujuh prinsip pengujian · bias kognitif &
etika pelaporan.

### 2 · QA Test Technique
Ledakan kombinasi & kerangka memilih teknik · pengujian berbasis risiko (formula skor eksplisit) ·
**equivalence partitioning** · **boundary value analysis** (3-value, batas tersembunyi) ·
**decision table** (termasuk *don't care*) · **state transition** (all-states/transitions/paths) ·
**pairwise** & orthogonal array · **error guessing** · **exploratory testing** bercharter (SMBTM) ·
cara menggabungkan teknik menjadi rancangan suite.

### 3 · QA Test Activity
Strategi & test plan (ruang lingkup, pengecualian, estimasi, kriteria masuk/keluar) · prioritisasi
berbasis risiko · anatomi test case yang dapat dijalankan orang lain · disiplin eksekusi & bukti ·
retest vs regresi · siklus hidup defect · menulis laporan bug yang tidak diabaikan · triase defect ·
metrik QA yang berguna · kesiapan rilis & keputusan go/no-go · laporan risiko tersisa.

### 4 · Basic QA Automation
Piramida otomasi & ROI (dengan contoh titik impas) · kapan **tidak** mengotomasi · anatomi skrip
(setup → action → assert → teardown) · assertion yang benar-benar menguji · data uji & isolasi ·
pustaka assertion tim · maintainability · **flaky test** · menjalankan otomasi di CI.

### 5 · API Automation
Semantik HTTP & **idempotensi** · status code (401 vs 403, 400 vs 422) · struktur body respons ·
autentikasi & otorisasi (JWT, IDOR, mass assignment) · validasi skema & **nullability** ·
**contract testing** & versioning (perubahan breaking) · **chaining** lintas lapisan · pipeline CI &
gerbang mutu · performa & ketahanan dasar.

### 6 · Web Automation
Strategi locator (hierarki ketahanan) · audit locator · menunggu **keadaan**, bukan waktu ·
page object & component object · refactor berlapis · data-driven test · matriks lintas browser ·
pengujian visual & aksesibilitas · menekan flakiness.

### 7 · Database Testing
SQL untuk tester (SELECT, filter, agregasi, JOIN, subquery) · pola pencarian anomali · checklist
CRUD · soft delete & kebocorannya · constraint & integritas referensial · transaksi & isolasi
(atomicity, kondisi balapan) · pengujian migrasi & rollback · menghubungkan bukti UI ↔ API ↔ DB.

### 8 · Materi & Praktik: Studi Kasus End-to-End
Satu studi kasus (TokoKita: kode promo & refund) dikerjakan penuh: requirement → use case →
skenario → test case → matrix → planning → environment → eksekusi lintas mesin → defect → regresi →
release gate → metrik → retrospektif. Menghasilkan laporan kesiapan rilis dengan risiko tersisa.

### 9 · Bangun Portofolio QA
Apa yang dianggap bukti kompetensi · memilih & membatasi studi kasus · menyusun README portofolio ·
struktur repositori & bukti otomasi · menampilkan metrik tanpa membual · narasi wawancara (STAR) ·
merawat portofolio · lab akhir menerbitkan & memverifikasi e-Certificate.

---

## 5. Kuis

Setiap kursus memiliki minimal satu kuis dengan **4+ soal** (kursus capstone memiliki 5 soal dengan
ambang lulus 75). Soal dirancang menguji **pemahaman**, bukan hafalan:

- Skenario nyata, bukan definisi.
- Pengecoh yang mencerminkan kesalahpahaman umum.
- Setiap soal punya `explanation` yang menjelaskan **mengapa** jawabannya benar.

### Kunci jawaban tidak pernah bocor

| Rute | Mengekspos `answer_index`? |
|---|---|
| `GET /api/courses/:id/quizzes` | **Tidak** — soal & opsi saja |
| `POST /api/quizzes/:id/submit` | **Ya** — hanya setelah pengiriman |

Desain ini mencegah learner mengambil kunci jawaban dari API, sekaligus memberi umpan balik lengkap
(`correct_index` + `explanation`) setelah menjawab. Diuji eksplisit pada suite Lane E.

---

## 6. e-Certificate

### Kode sertifikat

Format `QAT-<YYYY>-<6 karakter base32>` (contoh `QAT-2026-MTFTL6`). Karakter memakai alfabet
base32 tanpa huruf ambigu (`I`, `O`, `0`, `1`) agar mudah dibaca ulang.

### Grade

Grade diturunkan dari **rata-rata skor kuis** kursus:

| Skor | Grade |
|---|---|
| ≥ 90 | A |
| ≥ 80 | B |
| ≥ 70 | C |
| < 70 | Pass |

### Syarat penerbitan (fail-closed)

Sertifikat diterbitkan **hanya** bila **kedua** syarat terpenuhi:

1. **Enrollment selesai 100%** — seluruh pelajaran ditandai selesai.
2. **Seluruh kuis kursus lulus** — skor tercatat ≥ `pass_score` kuis terkait.

Bila belum, server mengembalikan **409** dengan alasan konkret, dan membedakan dua kondisi:

- `"kuis "X" belum dikerjakan"` — belum ada percobaan.
- `"kuis "X" belum lulus (skor 40, minimal 70)"` — sudah dikerjakan tetapi belum lulus.

Penerbitan bersifat **idempoten**: permintaan kedua mengembalikan sertifikat yang sama (HTTP 200),
tidak membuat baris baru.

### Sidik verifikasi (SHA-256)

`verification_hash` dihitung dengan `node:crypto`:

```
sha256( `${code}|${learner_email}|${course_id}|${issued_at}` )
```

Empat komponen itu **sengaja** dipilih karena masing-masing mewakili klaim yang dapat dipalsukan:

| Komponen | Bila diubah tanpa penerbitan ulang |
|---|---|
| `code` | Hash tidak cocok |
| `learner_email` | Sertifikat tidak lagi terhubung ke peserta asli |
| `course_id` | Sertifikat dapat dipindah ke kursus lain |
| `issued_at` | Tanggal terbit dapat dipalsukan |

Pada verifikasi, hash **dihitung ulang** dari data yang tersimpan dan dibandingkan. Ketidakcocokan
membuat hasil verifikasi menjadi **tidak valid** dengan alasan bahwa data kemungkinan telah diubah.

### Tampilan cetak (`render?format=html`)

Rute `GET /api/certificates/:id/render?format=html` mengembalikan halaman HTML mandiri:

- `Content-Type: text/html; charset=utf-8`
- CSS inline, **tanpa aset eksternal** (tidak ada `<script>`, `<link>`, atau `<img>`)
- Memuat: judul kursus, nama peserta, tanggal terbit, kode, grade, sidik verifikasi, tautan verifikasi
- Sudah siap cetak (aturan `@media print`) sehingga dapat disimpan sebagai PDF lewat dialog cetak browser
- **Tidak memakai pustaka PDF** apa pun

`format=json` tersedia untuk konsumsi program.

---

## 7. Verifikasi publik

`GET /api/certificates/verify/:code` mengembalikan `CertificateVerification`:

```jsonc
// valid
{ "valid": true, "certificate": { ... }, "learner_name": "...", "course_title": "...", "issued_at": "..." }

// tidak valid
{ "valid": false, "reason": "Kode sertifikat tidak ditemukan. Periksa kembali penulisannya." }
{ "valid": false, "certificate": { ... }, "reason": "Sertifikat ini telah dicabut: ..." }
{ "valid": false, "certificate": { ... }, "reason": "Data sertifikat tidak cocok dengan sidik verifikasinya..." }
```

Rute ini **selalu 200**; status ada di dalam payload `valid`. Alasannya: kode yang tidak ada bukan
kesalahan pemanggil, dan UI perlu membedakan "tidak ditemukan" dari "server bermasalah".

Halaman web `/verify` dan `/verify/:code` membaca parameter rute `code`, sehingga tautan mendalam
seperti `/verify/QAT-2026-MTFTL6` langsung memverifikasi saat dibuka.

### Pencabutan

`POST /api/certificates/:id/revoke` dengan `{ reason }`:

- `reason` **wajib** (400 bila kosong)
- Pencabutan ganda ditolak dengan **409**
- Setelah dicabut, verifikasi mengembalikan `valid: false` beserta alasannya
- Halaman cetak menampilkan banner **SERTIFIKAT DICABUT** beserta alasannya

---

## 8. Sumber data & idempotensi

### Berkas

| Berkas | Isi |
|---|---|
| `apps/api/src/seed/types.ts` | Tipe data kurikulum (dependensi nol) |
| `apps/api/src/seed/content-a.ts` | Kursus 1–3 (fondasi, teknik, aktivitas) |
| `apps/api/src/seed/content-b.ts` | Kursus 4–6 (otomasi dasar, API, web) |
| `apps/api/src/seed/content-c.ts` | Kursus 7–9 (database, capstone, portofolio) |
| `apps/api/src/seed/curriculum.ts` | Penggabungan, pilar, `validateCurriculum()`, overview |
| `apps/api/src/seed/curriculum-seed.ts` | `seedCurriculum()` — penulisan idempoten |
| `apps/api/src/seed/run.ts` | CLI `pnpm -F @qatools/api seed` |

### Kunci alami & idempotensi

Seeder aman dijalankan berulang kali. Setiap baris dikunci pada **kunci alami**, bukan id:

| Entitas | Kunci alami |
|---|---|
| course | `slug` |
| module | `(course_id, code)` |
| lesson | `(course_id, code)` |
| quiz | `(course_id, title)` |
| question | `(quiz_id, prompt)` |

Baris anak yang dihapus dari konten juga dibersihkan, sehingga jumlah baris selalu konvergen ke
jumlah yang ditulis. Dijalankan dua kali berturut-turut: **0 baris disisipkan** pada jalankan kedua
dan total tersimpan identik.

### Validasi konten

`validateCurriculum()` menolak penulisan bila ada pelanggaran:

- 3–5 modul per kursus, 3–6 pelajaran per modul
- ≥ 1 kuis per kursus dengan ≥ 4 soal
- `answer_index` dalam rentang opsi, setiap soal punya `explanation`
- `pillar` termasuk dalam `CURRICULUM_PILLARS` (FROZEN)
- `lab_ref` menunjuk rute QATools yang dikenal
- tidak ada duplikat kunci alami
- `content_md` tidak terlalu tipis

Ini mencegah kurikulum "kerangka kosong" lolos ke database.

---

## 9. Rute API yang dipakai kurikulum

| Metode | Rute | Kegunaan |
|---|---|---|
| GET | `/api/courses` | Katalog; filter `?pillar=` `?level=` `?email=` |
| GET | `/api/courses/:id` | Pohon kursus lengkap dengan `content_md` |
| GET | `/api/courses/:id/quizzes` | Kuis **tanpa** kunci jawaban |
| GET | `/api/lessons/:id` | Satu pelajaran |
| PATCH | `/api/lessons/:id` | Ubah pelajaran |
| POST | `/api/quizzes/:id/submit` | Kirim jawaban → skor, lulus, umpan balik per soal |
| GET | `/api/curriculum/overview` | Peta pilar → kursus untuk UI |
| POST | `/api/enrollments` | Daftar kursus (idempoten) |
| GET | `/api/enrollments?email=` | Daftar enrollment + metadata kursus |
| GET | `/api/enrollments/:id` | Enrollment + progres per pelajaran |
| POST | `/api/enrollments/:id/progress` | Tandai selesai → hitung ulang `progress_pct` |
| POST | `/api/enrollments/:id/certificate` | Terbitkan sertifikat (409 bila belum layak) |
| GET | `/api/certificates?email=` | Sertifikat milik peserta |
| GET | `/api/certificates/:id` | Detail sertifikat |
| GET | `/api/certificates/:id/render` | Halaman cetak (`html`) atau `json` |
| POST | `/api/certificates/:id/revoke` | Cabut sertifikat dengan alasan |
| GET | `/api/certificates/verify/:code` | Verifikasi publik |

---

## 10. Halaman web

| Rute | Halaman | Isi |
|---|---|---|
| `/learn` | `CurriculumPage` | Pilar nilai, total, filter pilar, kartu kursus, elaborasi "dan masih banyak lagi" |
| `/learn/:courseId` | `CoursePage` | Pohon modul/pelajaran, pembaca materi, tombol tandai selesai, tautan lab, kuis |
| `/my-learning` | `MyLearningPage` | Daftar kursus, progres, CTA pelajaran berikutnya, klaim e-Certificate |
| `/certificate` | `CertificatePage` | Daftar sertifikat, pratinjau, buka versi cetak, salin kode, cabut |
| `/verify` · `/verify/:code` | `VerifyPage` | Verifikasi publik: VALID (hijau) / TIDAK VALID (merah) + alasan |

### Keamanan render markdown

`features/learn/markdown.ts` adalah renderer markdown buatan sendiri tanpa dependensi:

1. Sumber **di-escape lebih dulu** (`&`, `<`, `>`, `"`, `'`).
2. Baru kemudian konstruksi markup yang diizinkan diterapkan pada teks yang sudah aman.
3. Tautan hanya diizinkan untuk `http(s)://` dan rute relatif — `javascript:` dibuang.

Karena setiap keluaran berasal dari teks yang sudah di-escape, tidak ada jalur untuk menyuntikkan
tag atau atribut. Ini diuji dengan `content_md` yang berisi `<script>` dan `<img onerror>`.

---

## 11. Cara menjalankan

```bash
# dari root repo
pnpm -F @qatools/api seed          # tulis kurikulum (idempoten)

# verifikasi cepat
node scripts/probe.mjs /api/courses /api/curriculum/overview

# uji Lane E
node --test --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/test/lane-e.test.ts
```

Seeder mencetak ringkasan jumlah baris (authored / inserted / updated / stored) beserta daftar
kursus, sehingga hasil penulisan dapat diverifikasi langsung dari keluaran.

---

## 12. Catatan implementasi

- **`quiz_attempts`** ditambahkan ke `schema.sql` (lead-owned) agar syarat "seluruh kuis lulus"
  dapat dibuktikan. Tanpa tabel ini, skor kuis tidak memiliki tempat penyimpanan permanen:
  `lesson_progress.lesson_id` memiliki foreign key ke `lessons`, sehingga kunci sintetis tidak sah.
- Modul membaca keberadaan tabel tersebut lewat `sqlite_master`. Bila tabel belum ada, pengiriman
  kuis tetap mengembalikan skor lengkap (tidak gagal), dan gerbang sertifikat tetap **fail-closed**.
- Seluruh kueri memakai parameter terikat; tidak ada DDL di dalam modul Lane E.
- `seedCurriculum()` diekspor agar Lead dapat menggabungkannya dengan seeder demo-project tanpa
  konflik; `run.ts` fokus pada kurikulum saja.
