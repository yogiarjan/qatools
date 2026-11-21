# QATools — fitur dari foto, dielaborasi

Foto kursus menampilkan judul **Software Quality Assurance** dengan empat *pill* dan delapan item
kurikulum. Dokumen ini memetakan **setiap** item tersebut ke fitur nyata di QATools — bukan sekadar
daftar, tetapi apa yang benar-benar bisa dipakai.

---

## Bagian A — empat pill

Foto: `• e-Certificate • Materi & Praktik • Belajar Online • Bangun Portofolio`

| Pill | Elaborasi di QATools | Di mana |
|---|---|---|
| **e-Certificate** | Sertifikat dengan kode unik `QAT-<tahun>-<6 karakter>`, grade (A/B/C/Pass), dan `verification_hash` **SHA-256** atas `code\|email\|course\|issued_at`. Halaman verifikasi publik `/verify/:code` membuktikan keaslian dan mendeteksi pemalsuan. Sertifikat bisa dicabut dengan alasan, dan ada versi HTML siap cetak. | `apps/api/src/modules/certificates/`, `features/certificate/` |
| **Materi & Praktik** | Setiap pelajaran punya `content_md` berisi teori **dan** `lab_ref` yang menautkan langsung ke fitur produk. Total **90 lab** dari 101 pelajaran menautkan ke halaman nyata (`/requirements`, `/matrix`, `/api-tester`, `/regression`, …) sehingga "praktik" berarti mengerjakan hal nyata, bukan latihan terpisah. | `apps/api/src/seed/content-a/b/c.ts` |
| **Belajar Online** | Katalog kursus dengan filter pillar & level, penelusuran modul → pelajaran, penanda "selesai" per pelajaran, progres otomatis (%), dan kuis dengan pembahasan per soal. | `features/learn/` |
| **Bangun Portofolio** | Kursus khusus **"Bangun Portofolio QA"** yang mengajarkan mengemas artefak yang benar-benar dihasilkan di QATools — use case, traceability matrix, skrip otomasi, defect, dan metrik — menjadi bukti kompetensi. Ditambah ekspor CSV/Markdown/JSON dari halaman Matrix dan Test Case. | kursus `bangun-portofolio-qa`, `modules/exports/` |

---

## Bagian B — delapan item kurikulum

Semua 8 item menjadi kursus nyata dengan modul, pelajaran, kuis, dan lab.
Total: **9 kursus · 32 modul · 101 pelajaran · 90 lab · 9 kuis · 52 soal · 6.240 menit**.

| # | Item di foto | Kursus | Isi yang diajarkan |
|---|---|---|---|
| 1 | **QA Introduction** | `qa-introduction` | Peran QA, perbedaan QA/QC/Testing, SDLC & STLC, seven testing principles, istilah dasar (defect/error/failure), mindset QA |
| 2 | **QA Test Technique** | `qa-test-technique` | Equivalence partitioning, boundary value analysis, decision table, state transition, pairwise/combinatorial, error guessing, exploratory testing — beserta kapan memakai yang mana |
| 3 | **QA Test Activity** | `qa-test-activity` | Test planning, test design, eksekusi, siklus hidup defect, pelaporan, kriteria masuk/keluar, dan penilaian kesiapan rilis |
| 4 | **Basic QA Automation** | `basic-qa-automation` | Automation pyramid, kapan **tidak** boleh mengotomasi, skrip pertama, assertion, dan perawatan suite agar tidak rapuh |
| 5 | **API Automation** | `api-automation` | Dasar HTTP, status code, autentikasi, validasi JSON, contract testing, chaining antar-request, dan integrasi CI |
| 6 | **Web Automation** | `web-automation` | Strategi locator (id > data-testid > name > aria-label > text), penanganan wait, page object, lintas browser, dan akar penyebab flakiness |
| 7 | **Database Testing** | `database-testing` | SQL untuk tester, verifikasi CRUD, join, constraint, transaksi & atomisitas, integritas data, dan pengujian migrasi |
| 8 | **dan masih banyak lagi** | `materi-praktik-studi-kasus-e2e` + `bangun-portofolio-qa` | Dua kursus tambahan: studi kasus end-to-end yang menelusuri **seluruh 12 tahap** QATools, dan cara membangun portofolio dari hasilnya |

Sembilan kursus tersebut persis mencakup 11 nilai `CURRICULUM_PILLARS` yang dibekukan di
`packages/shared/src/domain.ts`, termasuk keempat pill dari foto.

---

## Bagian C — bagaimana kurikulum terhubung ke produk

Yang membuat QATools bukan sekadar LMS: materi dan alat memakai **kosakata yang sama**.

```
Belajar "Boundary Value Analysis"  →  praktik di /testcases (type = boundary)
Belajar "Traceability Matrix"      →  praktik di /matrix (coverage per kebutuhan)
Belajar "API Automation"           →  praktik di /api-tester (assertion DSL yang sama)
Belajar "Database Testing"         →  praktik di /db-tester (readonly guard)
Belajar "Regresi"                  →  praktik di /regression (pemilihan berbasis risiko)
```

Contoh `lab_ref` yang benar-benar tertanam: `/matrix`, `/api-tester`, `/db-tester`, `/web-tester`,
`/regression`, `/metrics`, `/requirements`, `/usecases`, `/scenarios`, `/testcases`.

---

## Bagian D — aturan kelulusan dan sertifikat

1. Peserta mendaftar kursus (`POST /enrollments`, idempoten per email+kursus).
2. Menandai pelajaran selesai → `progress_pct` dihitung ulang dari jumlah pelajaran selesai.
3. Mengumpulkan kuis → skor disimpan di `quiz_attempts` (kunci jawaban **hanya** dirilis setelah submit).
4. **Sertifikat hanya terbit bila dua syarat terpenuhi sekaligus:**
   - progres pelajaran mencapai 100%, **dan**
   - **seluruh** kuis kursus tersebut lulus.

   Jika belum, server membalas `409` dengan alasan konkret — dan membedakan
   *"kuis belum dikerjakan"* dari *"kuis belum lulus (skor 40, minimal 70)"*.

Gerbang ini bersifat **fail-closed**: bila data tidak lengkap, sertifikat tidak akan pernah terbit
secara keliru.

## Bagian E — verifikasi keaslian

```
GET /api/certificates/verify/:code
→ { valid: true,  certificate: {...}, learner_name, course_title, issued_at }
→ { valid: false, reason: "Kode sertifikat tidak ditemukan…" }
→ { valid: false, reason: "Sertifikat ini telah dicabut: <alasan>" }
```

`verification_hash` dapat dihitung ulang dari data sertifikat; bila ada yang mengubah nama, kursus,
atau tanggal, hash tidak akan cocok.
