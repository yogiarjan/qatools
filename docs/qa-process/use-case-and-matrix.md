# Alur Use Case & Digital Traceability Matrix

> Dokumen ini menjelaskan cara kerja **pembuatan dokumen QA** di QATools: dari kebutuhan,
> use case, skenario, test case, sampai **Digital Traceability Matrix** — termasuk bagaimana
> fitur *Analyzer Web Existing* (crawler) membantu tim yang sudah punya aplikasi berjalan
> tetapi belum punya dokumentasi QA.

---

## 1. Mengapa urutannya penting

QATools memaksa satu **alur berurutan (ordered lifecycle)**. Setiap tahap hanya boleh dimulai
bila tahap sebelumnya sudah punya isi:

```
📋 Kebutuhan  →  📘 Use Case  →  🧭 Skenario  →  🧪 Test Case  →  🔗 Traceability Matrix
   (stage 1)      (stage 2)       (stage 3)       (stage 4)         (stage 5)
```

Urutan ini bukan sekadar tata letak menu. Konsekuensinya nyata:

| Tahap | Tidak boleh langsung ke | Alasan |
|---|---|---|
| Kebutuhan | Test case | Test case tanpa use case tidak punya konteks actor dan alur. |
| Use Case | Test case | Skenario adalah jembatan yang memaksa Anda memikirkan jalur negatif & batas. |
| Skenario | Rilis | Tanpa test case, skenario hanya cerita — tidak ada bukti eksekusi. |

**Satu kebutuhan tidak selalu menjadi satu use case.** Satu kebutuhan bisa melahirkan beberapa
use case (misalnya "pengguna dapat checkout" → use case untuk pembeli dan untuk admin gudang).
Sebaliknya, satu use case dapat melayani beberapa kebutuhan sekaligus.

---

## 2. Tahap 1 — Kebutuhan (Requirements)

Halaman: **Requirements**. Setiap kebutuhan otomatis mendapat kode `REQ-nnn`.

Yang perlu diisi dengan disiplin:

- **Judul** — satu kalimat, subjek + aksi + hasil. Contoh: *"Pengguna dapat menambahkan barang
  ke keranjang"*.
- **Prioritas** — rendah / sedang / tinggi / kritis. Prioritas ini nanti menjadi salah satu
  faktor **risk score** test case, jadi jangan asal mengisi.
- **Kriteria penerimaan** — daftar kondisi terukur. Inilah yang nanti menjadi bahan skenario
  dan assertion.
- **Sumber** — `stakeholder`, dokumen, atau `hasil crawl` bila berasal dari Analyzer.

### Import massal (CSV)

Tombol **📥 Import CSV** menerima tempelan langsung dari spreadsheet. Format per baris:

```
Judul saja
REQ-010, Judul kebutuhan, deskripsi, high, draft
"Judul dengan, koma", deskripsi
```

Aturan:

- Kolom pertama dianggap **kode** hanya bila polanya `REQ-nnn`; jika bukan, seluruh kolom
  pertama dianggap judul dan kode dibuat otomatis.
- Baris header (`code,title` / `kode,judul`) dilewati.
- Kode yang sudah dipakai akan **dilewati**, bukan menimpa data lama.
- Tanda kutip ganda (`"`) didukung untuk nilai yang mengandung koma.

### Menurunkan kebutuhan menjadi use case dengan AI

Pilih satu atau beberapa kebutuhan (centang di kolom paling kiri), lalu tekan
**✨ Generate Use Cases with AI**. Aplikasi memanggil `POST /api/projects/:projectId/ai/generate`
dengan `{ task: 'generate_usecases', requirement_ids: [...] }`.

Bila modul AI belum aktif, QATools menampilkan pesan yang jelas (*"Fitur AI belum tersedia di
server ini…"*) dan **pekerjaan manual tetap bisa dilanjutkan**. Fitur AI tidak pernah menjadi
jalan buntu.

---

## 3. Tahap 2 — Use Case

Halaman: **Use Cases**. Kode otomatis `UC-nnn`.

Sebuah use case terdiri dari bagian-bagian berikut. Semuanya disimpan sebagai JSON di kolom
masing-masing sehingga aman untuk diedit bolak-balik:

| Bagian | Isi | Dipakai untuk apa |
|---|---|---|
| **Actor** | Siapa yang berinteraksi (Pembeli, Admin) | Menentukan cakupan otorisasi & data uji |
| **Tujuan (goal)** | Hasil yang diinginkan actor | Kalimat inti skenario `THEN` |
| **Precondition** | Kondisi yang harus benar sebelum mulai | Prasyarat yang harus disiapkan runner |
| **Postcondition** | Kondisi setelah use case selesai | Dasar assertion tingkat akhir |
| **Alur Utama** | Langkah berurutan (ordered) | Sumber skenario *happy path* |
| **Alur Alternatif** | `{ nama, langkah[] }` — cabang di luar jalur utama | Sumber skenario alternatif & negatif |
| **Aturan Bisnis** | Batasan yang tidak boleh dilanggar | Sumber test case *boundary* |
| **Prioritas & Risiko** | Penilaian awal | Faktor risk score |

### Alur Alternatif — kenapa array of object?

Alur alternatif sering punya nama dan langkah sendiri, misalnya:

```json
[
  { "name": "Stok habis", "steps": ["Pengguna klik tambah", "Sistem menolak", "Muncul pesan stok habis"] }
]
```

Karena itu bentuknya `{ name, steps[] }`. Bila Anda hanya mengetik teks biasa, QATools
mengubahnya menjadi `{ name: "<teks>", steps: [] }` agar datanya tetap konsisten.

### Duplikasi

Tombol **⧉ Duplikat** menyalin isi use case (termasuk semua alur & aturan) dan
**mempertahankan tautan kebutuhan** yang sama. Berguna untuk membuat varian use case dari
satu pola.

### Generate skenario dengan AI

Di kartu use case atau di dalam panel detail, tombol **✨ Skenario** menjalankan
`task: 'generate_scenarios'`. Bila route AI tidak tersedia, muncul pesan ramah dan Anda tetap
bisa menambah skenario manual.

---

## 4. Tahap 3 — Skenario

Halaman: **Scenarios**. Kode otomatis `SC-nnn`. Skenario dikelompokkan **per use case**
sehingga terlihat kebutuhan mana yang belum diturunkan.

Format wajib: **Given / When / Then**.

| Jenis | Kapan dipakai | Contoh |
|---|---|---|
| `happy_path` | Jalur sukses normal | Produk tersedia, berhasil ditambahkan |
| `alternative` | Cabang sah di luar jalur utama | Pembayaran via transfer bank |
| `negative` | Input/aksi yang harus ditolak | Password salah |
| `edge` | Nilai batas | Jumlah = 99 (batas maksimum) |
| `security` | Akses tanpa izin | Akses keranjang milik pengguna lain |
| `performance` | Beban & waktu respons | 100 pengguna serentak |

**Minimal satu skenario negatif per use case** adalah kebiasaan sehat. Skenario tanpa test case
akan muncul di bagian *Orphan* pada halaman Matrix sebagai pengingat.

---

## 5. Tahap 4 — Test Case

Halaman: **Test Cases**. Kode otomatis `TC-nnn`. Tabel dibuat padat agar satu layar memuat
banyak informasi: kode, judul, tipe, layer, prioritas, engine, status otomasi, risk score, dan
tanda regresi.

### Risk score (0–100)

Risk score **tidak pernah diisi manual** — selalu dihitung server memakai `riskScore()` dari
`@qatools/shared`, deterministik dan dapat dijelaskan. Faktornya:

| Faktor | Bobot |
|---|---|
| Prioritas bisnis (critical → low) | +34 → +8 |
| Frekuensi pemakaian (always → rarely) | +20 → +3 |
| Kompleksitas layer (web/api/db) | +16 / +10 / +5 |
| Riwayat defect | +3 per defect, maksimum +15 |
| Eksekusi terakhir gagal | +12 |
| Termasuk regresi | +6 |
| Belum terotomasi | +5 |

Ambang batas: **≥ 65 tinggi**, **≥ 35 sedang**, di bawahnya rendah.
Skor dihitung ulang setiap kali test case berubah, termasuk saat toggle regresi.

### Langkah (steps) — sub-resource terurut

`PUT /api/testcases/:id/steps` **mengganti seluruh daftar langkah**. Artinya urutan yang Anda
kirim adalah urutan final; langkah yang tidak dikirim akan terhapus. Setiap langkah punya
`action`, `expected`, dan `data` opsional.

### 👑 Kirim ke Regresi

Regresi adalah **raja**. Tombol bintang di kolom *Regresi* memanggil
`POST /api/testcases/:id/regression`. Bila body kosong, status dibalik (toggle). Regresi
menambah +6 pada risk score karena kasus ini dijaga setiap rilis.

---

## 6. Tahap 5 — Digital Traceability Matrix

Halaman: **Matrix** — inti dari keseluruhan QATools.

### Konsepnya

Matrix adalah **graf terarah (directed graph)** yang menghubungkan artefak:

```
requirement ──▶ usecase ──▶ scenario ──▶ testcase ──▶ defect
                                            │
                                            └──────▶ automation
```

Setiap sisi graf disimpan sebagai satu baris di tabel `matrix_links` dengan bentuk:

| Kolom | Contoh | Arti |
|---|---|---|
| `link_type` | `scenario_to_testcase` | Jenis relasi |
| `from_kind` / `from_id` | `scenario` / `sc_01J8…` | Ujung asal |
| `to_kind` / `to_id` | `testcase` / `tc_01J8…` | Ujung tujuan |
| `created_by` | `lane-docs` / `manual` / `ai` | Siapa yang membuat tautan |

Keunikan `(link_type, from_id, to_id)` membuat penyisipan bersifat **idempoten** — menjalankan
sinkronisasi dua kali tidak menggandakan tautan.

### Tautan diturunkan otomatis

Inilah bagian terpenting: **Anda tidak perlu menggambar tautan secara manual.** Saat artefak
dibuat, server langsung menurunkan tautannya:

| Aksi | Tautan yang otomatis dibuat |
|---|---|
| Buat use case dengan `requirement_ids` | `requirement_to_usecase` |
| Buat skenario dengan `use_case_id` | `usecase_to_scenario` |
| Buat test case dengan `scenario_id` | `scenario_to_testcase` |
| Test case dibuat | `requirement_to_testcase` (transitif) + `testcase_to_automation` |

Tautan `requirement_to_testcase` dihitung dengan menelusuri
`requirement → usecase → scenario → testcase`. Jadi bila Anda memindahkan sebuah test case ke
skenario lain, rantai di atasnya **dihitung ulang**, bukan dibiarkan basi.

### Status coverage per baris

| Status | Arti | Warna | `coverage_pct` |
|---|---|---|---|
| `covered` | Punya use case, skenario, **dan** test case | 🟢 hijau | 100% |
| `partial` | Punya use case tetapi belum lengkap skenario/test case | 🟡 kuning | 50–75% |
| `gap` | Belum punya use case sama sekali | 🔴 merah | 0% |
| `orphan` | Test case tidak bisa dilacak ke kebutuhan mana pun | ⚪ abu | 0% |

Baris berstatus `gap` diberi **latar merah** agar langsung terlihat. Tombol **Hanya Gap**
menyaring matriks sehingga hanya baris bermasalah yang tampil.

### Ringkasan (summary)

Di bagian atas halaman:

- **Coverage %** — `(covered + partial) / total requirement`.
- **Tercakup** — jumlah baris `covered`, plus berapa yang `partial`.
- **Gap** — kebutuhan yang belum turun ke use case.
- **Orphan** — test case tanpa jalur requirement.
- **Automation %** — porsi test case yang berstatus `automated` di seluruh project.

### Bagian Orphan

Orphan bukan selalu kesalahan. Test case eksploratif memang sah tidak punya induk. Tetapi
orphan **sering** berarti:

1. Ada kebutuhan yang belum dicatat, atau
2. Tautan matrix hilang/terputus.

Panel **⚠️ Orphan** menampilkan dua daftar: test case tanpa jalur requirement, dan skenario yang
belum diturunkan menjadi test case.

### Sync Matrix

Tombol **🔄 Sync Matrix** (`POST /api/projects/:projectId/matrix/sync`) **membangun ulang
seluruh tautan turunan dari kolom foreign key**. Pakai ini bila:

- Data diimpor langsung ke database (melewati API).
- Ada tautan yang terhapus tidak sengaja.
- Anda ingin memastikan konsistensi setelah perubahan besar.

Sinkronisasi bersifat **aman diulang**: yang dilaporkan sebagai `created` hanya tautan baru,
dan `total` adalah jumlah tautan aktif setelah sinkronisasi.

### Impact analysis (blast radius)

Tombol **🎯** pada setiap baris menjalankan
`GET /api/projects/:projectId/matrix/impact/:artifactId`. Algoritma menelusuri graf **ke dua
arah** (BFS) sampai tertutup, lalu mengumpulkan semua artefak terdampak:

- Kebutuhan, use case, skenario, test case, dan defect yang terkena.
- **`blast_radius`** — jumlah total artefak terdampak.
- **`recommended_regression_suite`** — test case terdampak yang berisiko ≥ 50 atau sudah
  anggota regresi.

Contoh pemakaian nyata: *"Bila requirement REQ-001 berubah, berapa test case yang harus
diuji ulang?"* — jawabannya adalah blast radius-nya. Inilah dasar pemilihan suite regresi
berbasis risiko.

### Export

| Tombol | Endpoint | Isi |
|---|---|---|
| ⬇️ CSV | `/export/matrix?format=csv` | Satu baris per requirement, lengkap dengan kode use case/skenario/test case |
| ⬇️ MD | `/export/matrix?format=md` | Laporan Markdown siap tempel ke Confluence/Notion, plus daftar gap |
| ⬇️ JSON | `/export/matrix?format=json` | `MatrixDocument` mentah untuk integrasi |

Semua respons memakai header `Content-Disposition: attachment` sehingga browser langsung
mengunduh file bernama, misalnya `matrix-SHOP-2026-01-31T10-22-33.csv`.

---

## 7. Analyzer Web Existing — dukungan untuk aplikasi yang sudah jalan

Halaman: **Analyzer Web Existing**.

Banyak tim QA mewarisi aplikasi yang sudah berjalan tanpa dokumen QA apa pun. Menulis ulang
seluruh kebutuhan dari nol tidak realistis. Karena itu QATools menyediakan crawler:

1. **Masukkan URL** halaman aplikasi Anda (misalnya `https://contoh.id/login`).
2. Tekan **🔍 Analisis Sekarang**. Aplikasi memanggil `POST /api/ai/crawl` dengan
   `CrawlSiteInput` (`url`, `max_pages`, `depth`, `include_links`).
3. Server mengembalikan **`CrawlResult`** berisi:
   - `pages[]` — setiap halaman dengan `headings`, `forms`, `buttons`, `inputs`, `tables`,
     dan `textSample`.
   - `features[]` — fitur yang terdeteksi beserta `kind` (form / navigation / listing / detail /
     action / auth / search), `evidence`, usulan actor dan prioritas.
   - `suggested_use_cases[]` — usulan use case dengan nama, tujuan, dan actor.
4. **Tinjau temuan sebagai checkbox.** Anda memilih mana yang relevan — crawler mengusulkan,
   Anda yang memutuskan.
5. Tekan **✨ Buat Requirements + Use Cases dari hasil analisis**.

### Apa yang terjadi saat tombol itu ditekan?

- Setiap fitur terpilih menjadi satu **kebutuhan** (lewat bulk create) dengan `source` berisi
  URL halaman, sehingga Anda tahu asal-usulnya.
- Setiap usulan terpilih menjadi satu **use case** dengan `generated_by: 'import'` dan alur
  utama awal.
- Setelah itu alur normal berlaku: buat skenario → test case → matrix.

### Bila crawler belum tersedia

Modul AI mungkin belum aktif, atau halaman tidak bisa diambil server (butuh login/firewall).
Dalam kasus itu server mengembalikan hasil **mock/offline** (`used_mock: true`) atau error
404/503. QATools menanganinya dengan tenang:

- Hasil mock tetap punya **struktur yang sama**, jadi tetap bisa dipakai untuk latihan dan
  untuk mengisi kerangka dokumen.
- Bila route benar-benar tidak ada, muncul pesan *"Fitur crawler AI belum tersedia di server
  ini…"* — dan seluruh pekerjaan manual di halaman lain tetap berjalan normal.

**Fitur AI tidak pernah menjadi syarat untuk memakai QATools.** AI mempercepat, tetapi semua
tahap dapat diselesaikan secara manual.

---

## 8. Alur kerja ringkas sehari-hari

```
1. Buat Project (isi Target URL web existing)   → /projects
2. Kumpulkan kebutuhan                          → /requirements
   ↳ atau crawl web existing dulu               → /site-analyzer
3. Turunkan ke use case (manual atau ✨ AI)     → /usecases
4. Buat skenario Given/When/Then                → /scenarios
5. Rancang test case + langkah + data uji       → /testcases
6. Periksa matriks, tutup semua gap             → /matrix
7. Tandai 👑 kasus berisiko ke suite regresi    → /testcases
8. Unduh laporan (CSV/MD/JSON) untuk stakeholder
```

Kembali ke **Matrix** setelah setiap perubahan besar. Bila ada baris merah (`gap`) atau
orphan, dokumen QA Anda belum selesai — dan matrix akan mengatakannya dengan jujur.

---

## 9. Referensi API (Lane A)

| Method | Path | Kegunaan |
|---|---|---|
| `GET` | `/api/projects` | Daftar project (envelope `{data,total}`) |
| `POST` | `/api/projects` | Buat project + environment default |
| `GET` | `/api/projects/:id` | Detail project + counts |
| `PATCH` | `/api/projects/:id` | Ubah project |
| `DELETE` | `/api/projects/:id` | Hapus project (`?force=true` bila masih ada artefak) |
| `GET` | `/api/projects/:projectId/requirements` | Daftar kebutuhan (filter `priority`, `status`, `q`) |
| `POST` | `/api/projects/:projectId/requirements` | Buat kebutuhan (kode `REQ-nnn` otomatis) |
| `POST` | `/api/projects/:projectId/requirements/bulk` | Import massal dari tempelan CSV |
| `PATCH`/`DELETE` | `/api/requirements/:id` | Ubah / hapus kebutuhan |
| `GET` | `/api/projects/:projectId/usecases` | Daftar use case |
| `POST` | `/api/projects/:projectId/usecases` | Buat use case (+ tautan kebutuhan) |
| `POST` | `/api/usecases/:id/duplicate` | Duplikasi use case |
| `GET` | `/api/usecases/:id` | Detail + skenario + test case + impact |
| `GET` | `/api/projects/:projectId/scenarios` | Daftar skenario (filter `use_case_id`, `kind`) |
| `POST` | `/api/projects/:projectId/scenarios` | Buat skenario (+ tautan use case) |
| `GET` | `/api/projects/:projectId/testcases` | Daftar test case (7 filter) |
| `POST` | `/api/projects/:projectId/testcases` | Buat test case (risk score dihitung) |
| `GET`/`PUT` | `/api/testcases/:id/steps` | Baca / ganti seluruh daftar langkah |
| `POST` | `/api/testcases/:id/regression` | Toggle keanggotaan suite regresi 👑 |
| `GET` | `/api/projects/:projectId/matrix` | `MatrixDocument` (cells + summary) |
| `GET` | `/api/projects/:projectId/matrix/impact/:artifactId` | `ImpactReport` (blast radius) |
| `POST` | `/api/projects/:projectId/matrix/sync` | Bangun ulang tautan turunan |
| `GET` | `/api/projects/:projectId/matrix/orphans` | Daftar artefak tanpa induk |
| `POST` | `/api/matrix/links` | Tautan manual |
| `DELETE` | `/api/matrix/links/:id` | Hapus tautan |
| `GET` | `/api/projects/:projectId/export/matrix` | Export matrix (`csv`\|`md`\|`json`) |
| `GET` | `/api/projects/:projectId/export/testcases` | Katalog test case (`csv`\|`json`) |
| `GET` | `/api/projects/:projectId/export/requirements` | Kebutuhan (`csv`) |
| `GET` | `/api/projects/:projectId/export/pack` | Bundel JSON seluruh artefak project |

---

## 10. Ringkasan prinsip

1. **Urutan adalah aturan, bukan saran.** Setiap tahap memakai keluaran tahap sebelumnya.
2. **Matriks diturunkan, bukan digambar.** Server menjaga konsistensi graf; Anda fokus pada isi.
3. **Setiap baris merah adalah utang.** Selama masih ada `gap`, dokumen QA belum selesai.
4. **Regresi adalah raja.** Kasus berisiko tinggi harus masuk suite regresi, bukan sekadar ada.
5. **AI mempercepat, bukan menggantikan.** Bila AI tidak tersedia, semua tahap tetap selesai manual.
