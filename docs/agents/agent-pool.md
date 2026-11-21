# AI Agent Pool — Regresi Paralel dengan Banyak Agen QA

Dokumen ini menjelaskan fitur **spawn QA agent AI** di QATools: menjalankan satu
suite regresi otomatis dengan **N worker paralel**, lengkap dengan percobaan
ulang, deteksi *flaky*, penyembuhan selector, dan triase kegagalan.

> Halaman UI: **/agents** · Modul API: `apps/api/src/modules/agents/`

---

## 1. Apa itu QA agent pool?

**Agent pool** adalah sekumpulan *worker* (agen) yang menjalankan test case
**secara bersamaan**, bukan berurutan. Setiap worker:

- menerima satu **shard** — daftar test case yang menjadi tanggung jawabnya;
- menjalankan test case di dalam shard-nya **satu per satu** (ini yang membuat
  satu worker berbeda dari worker lain);
- mengulang (retry) test case yang gagal sesuai kebijakan pool;
- melaporkan hasil per kasus: status awal, status akhir, jumlah percobaan,
  apakah flaky, apakah selector-nya disembuhkan.

Bedanya dengan "menjalankan suite seperti biasa":

| Aspek | Suite berurutan | Agent pool |
|---|---|---|
| Waktu | jumlah durasi semua kasus | ≈ durasi shard terpanjang |
| Retry | manual / tidak ada | otomatis, per kasus |
| Flaky | tidak terdeteksi | terdeteksi & dilaporkan terpisah |
| Selector rusak | langsung gagal | dicoba disembuhkan otomatis |
| Kegagalan | daftar mentah | ditriase: severity, akar masalah, pemilik |

**Paralelismenya nyata.** Shard dijalankan lewat *concurrency limiter* buatan
sendiri (berbasis `Promise`, tanpa dependensi tambahan seperti `p-limit`), dan
hanya `workers` shard yang boleh berjalan pada satu waktu. Pool tidak memakai
`node:worker_threads` karena pekerjaannya *I/O bound* (HTTP, koneksi DB, parser
HTML) sehingga event loop Node sudah menjalankannya tumpang tindih; selain itu
fasad basis data (`node:sqlite`) bersifat sinkron dan satu koneksi, sehingga
thread tambahan tidak menambah *throughput* tetapi menambah risiko.

---

## 2. Strategi pembagian shard

Strategi menentukan **bagaimana test case dibagi** ke tiap worker.

| Strategi | Cara kerja | Kapan dipakai |
|---|---|---|
| **Round Robin** | Kasus ke-`i` dikirim ke worker ke-`(i mod N)`. | Semua kasus setara durasinya; ingin pembagian paling mudah diprediksi. |
| **Berbasis Risiko** (`risk_weighted`) | Urutkan kasus berdasarkan `risk_score` tertinggi, lalu bagi dengan *greedy LPT*. | Regresi: pekerjaan paling berisiko mulai lebih dulu sehingga hasilnya cepat diketahui. |
| **Seimbang Durasi** (`duration_balanced`) | *Greedy longest-processing-time* (LPT) berdasarkan `estimated_minutes`. | Durasi kasus sangat bervariasi; ingin *makespan* (shard terlama) sekecil mungkin. |
| **Kelompok per Engine** (`same_engine`) | Kelompokkan per `test_cases.engine` sehingga satu worker memakai satu engine. | Biaya inisialisasi engine mahal (sesi HTTP, koneksi DB, konteks AI) dan ingin dihindari berulang. |
| **Dioptimalkan AI** (`ai_optimized`) | Minta AI (`predict_risk`) menilai risiko, lalu pakai skor itu sebagai bobot LPT. | Ingin prioritas berbasis analisis, bukan hanya kolom `risk_score`. |

### Kenapa LPT bisa menyeimbangkan beban

Algoritma *longest-processing-time* bekerja sederhana tetapi efektif:

1. urutkan kasus dari yang terberat ke teringan;
2. untuk setiap kasus, taruh di worker yang **paling ringan saat itu**.

Karena kasus terberat ditempatkan lebih dulu, ia tidak "terjebak" menumpuk di
satu worker bersama kasus besar lain. Pada fixture yang sengaja miring
(1 kasus 10 menit + 7 kasus kecil, 3 worker), LPT menghasilkan *makespan* ±33%
lebih rendah daripada Round Robin — Round Robin selalu menaruh kasus terpanjang
di worker 0 dan tidak pernah mengimbanginya. Perbandingan ini bisa dilihat
langsung di UI lewat tombol **Plan (dry run)**.

`ai_optimized` **tidak mengarang klaim AI**: kalau tidak ada API key, ia otomatis
memakai kolom `risk_score` (setara `risk_weighted`) dan melaporkan `ai_used: false`.

---

## 3. Mengapa deteksi flaky itu penting

Inilah alasan utama fitur retry ada — dan alasan sebuah kasus yang gagal lalu
lulus **tidak boleh** dilaporkan sebagai lulus biasa.

Sebuah test case disebut **flaky** bila:

- percobaan **pertama gagal**, dan
- percobaan **berikutnya lulus**.

Pool mencatat dua hal sekaligus pada kasus seperti ini:

- `initial_status` = `failed` → apa yang sebenarnya terjadi pertama kali;
- `final_status` = `passed` → verdict akhir setelah retry;
- `flaky` = `true`.

**Konsekuensi penghitungan:** kasus flaky **tidak** masuk bucket "lulus bersih".
Ringkasan pool memisahkannya:

```
lulus bersih = kasus yang lulus pada percobaan PERTAMA
flaky        = kasus yang berubah verdict antar percobaan
gagal        = gagal di semua percobaan
```

Ini penting karena seorang QA Lead perlu tahu bedanya:

- **Gagal** = ada yang rusak, harus diperbaiki;
- **Flaky** = ada ketidakstabilan (race condition, data uji bocor antar kasus,
  timeout terlalu ketat, dependensi eksternal). Kalau flaky disamarkan sebagai
  "lulus", tim akan terus mempercayai hasil yang sebenarnya tidak dapat diandalkan.

Kasus flaky adalah **kandidat utama perbaikan stabilitas**, dan pool menyebutnya
eksplisit di ringkasan naratif.

**Catatan istilah:** `summary.retried` menghitung **jumlah percobaan tambahan**
(≈ `attempts - 1`), sedangkan `summary.total` tetap menghitung **test case**.
Jadi satu kasus dengan `max_retries: 2` yang selalu gagal memberi
`attempts: 3`, `retried: 2`, `total: 1`.

---

## 4. Penyembuhan selector (AI healing)

Saat langkah web gagal karena selector tidak lagi cocok (misalnya `#login-btn`
sudah tidak ada di DOM), pool dapat mencari penggantinya.

### Cara kerja jalur offline (tanpa API key)

Jalur offline **bukan stub** — ia benar-benar memindai HTML halaman yang
dikirim saat kegagalan:

1. HTML di-parse memakai ekstraktor HTML milik lane C (`modules/webtester/html.ts`,
   tanpa dependensi seperti cheerio/jsdom) menjadi pohon DOM;
2. setiap elemen diperiksa atributnya dan diberi skor menurut **urutan
   ketahanan** yang sama dengan lane C:

   **`data-testid` > `id` > `name` > `aria-label` > `class` > teks**

3. skor disesuaikan dengan: kemiripan atribut dengan selector lama, tumpang
   tindih kata kunci dengan selector/intent, **keunikan** elemen (selector yang
   cocok dengan tepat satu elemen jauh lebih baik), kecocokan tag, panjang nilai,
   dan apakah `class` terlihat digenerate otomatis (`css-`, `sc-`, `jsx-`).

Hasilnya: daftar kandidat nyata beserta skor dan **alasan** masing-masing.

### Peran AI saat provider aktif

Bila ada API key, model hanya dipakai untuk **mengurutkan ulang dan menjelaskan**
kandidat yang sudah ditemukan. Model **tidak boleh mengarang selector baru**:
setiap selector yang dikembalikan model diverifikasi harus ada di daftar kandidat
hasil pemindaian; yang tidak dikenal akan dibuang.

### Batas yang harus disadari

- Healing **butuh HTML halaman**. Kalau engine tidak menyertakan `html` di
  evidence (misalnya mode browser Playwright yang tidak menyimpan konten),
  pool melaporkan `applied: false` dan **tidak** mengklaim berhasil.
- Selector hasil healing **tidak otomatis ditulis permanen** ke flow. Ia
  disarankan; peninjauan manual tetap wajib — selector `data-testid` yang benar
  sebaiknya ditambahkan di aplikasi, bukan dipilih dari struktur yang kebetulan ada.
- Healing hanya menangani **selector**, bukan logika assertion atau bug produk.

`summary.healed` dan `shard.healed` hanya bertambah bila sebuah selector
pengganti **benar-benar dihasilkan**.

---

## 5. Triase kegagalan (AI triage)

Setiap kasus yang tidak lulus mendapat baris triase:

- **severity** — `cosmetic` | `minor` | `major` | `critical` | `blocker`;
- **likely_root_cause** — dugaan akar masalah;
- **suggested_owner_role** — peran yang sebaiknya menangani;
- **rationale** — alasan di balik penilaian tersebut.

Dengan API key, triase memakai task `triage_defect` milik lapisan AI. **Tanpa API
key**, pool memakai aturan kata kunci deterministik yang benar-benar membedakan
pola kegagalan, contohnya:

| Pola pesan galat | Severity | Dugaan akar masalah |
|---|---|---|
| `ECONNREFUSED`, DNS gagal | `blocker` | Target tidak terjangkau — masalah environment, bukan produk |
| `500`, exception tak tertangkap | `critical` | Periksa log aplikasi pada rentang waktu eksekusi |
| `401`/`403`, token | `critical` | Kredensial uji kedaluwarsa atau hak akses berubah |
| `404` | `major` | Endpoint/artefak tidak ditemukan — bisa masalah konfigurasi uji |
| `timeout` | `major` | Target lambat atau batas timeout pool terlalu ketat |
| selector/elemen tidak ada | `major` | Markup berubah tanpa memperbarui skrip otomasi |
| assertion tidak sesuai | `major` | Ekspektasi uji vs perilaku aplikasi |

**Batasnya:** triase adalah *triage*, bukan diagnosis. Ia menyaring dan
mengarahkan, lalu tetap harus diverifikasi manusia sebelum membuat defect resmi.
Severity dari kata kunci juga bisa salah bila pesan galat tidak khas.

Ringkasan naratif (`ai_summary`) juga dibuat oleh pool. Tanpa API key ia
**deterministik** — dan teksnya menyatakan hal itu secara eksplisit, bukan
menyamar sebagai keluaran model.

---

## 6. Cara menghitung speedup

Dua angka diukur saat eksekusi:

- **`sequential_duration_ms`** — jumlah durasi **semua percobaan** dari semua
  kasus. Ini perkiraan berapa lama pekerjaan yang sama memakan waktu bila
  dijalankan satu worker dengan kebijakan retry yang sama.
- **`duration_ms`** — *wall clock* nyata dari pool, diukur dengan jam dinding.

Kemudian:

```
speedup = sequential_duration_ms ÷ duration_ms
```

Contoh dari test suite lane G (8 kasus, tiap kasus diberi delay 300 ms):

| Konfigurasi | Wall clock | Speedup |
|---|---|---|
| `workers: 1` | 2.562 ms | 0,94x |
| `workers: 4` | 636 ms | **3,80x** |

Cara membaca:

- **speedup ≈ 1** dengan 1 worker → benar, karena satu worker memang berurutan.
- **speedup > 1** → paralelisme memberi manfaat nyata.
- **speedup tidak akan pernah setara jumlah worker** secara sempurna: ada
  overhead penjadwalan, wall clock minimum dibatasi shard terpanjang, dan
  pembagian beban tidak mungkin sempurna.
- **speedup ≈ 1 meski worker banyak** → biasanya karena kasus terlalu cepat
  (overhead mendominasi), semua kasus bersaing pada sumber daya yang sama
  (satu DB, satu server target), atau jumlah worker melebihi jumlah kasus.

QATools **tidak pernah menggelembungkan** angka ini; `speedup` dihitung apa
adanya dan UI menampilkan aritmetikanya (`berurutan ÷ wall-clock`).

---

## 7. Cara menentukan jumlah worker

Mulai dari **jumlah core CPU** mesin yang menjalankan API, lalu turunkan bila perlu.

| Situasi | Saran |
|---|---|
| Kasus API/DB menembak **satu server target yang sama** | 4–8 worker. Target akan menjadi *bottleneck*, bukan CPU-mu; worker berlebih hanya menambah beban dan membuat hasil saling mengganggu. |
| Kasus web mode HTTP (fetch + parse) | 4–8 worker; parsing HTML memakai CPU, jadi jangan jauh melebihi jumlah core. |
| Kasus berisi `wait`/tunggu jaringan panjang | Boleh lebih banyak worker (8–16), karena sebagian besar waktu terbuang menunggu. |
| Kasus DB yang menulis ke database yang sama | 2–4 worker. Eksekusi paralel pada satu DB berisiko saling mengunci dan membuat data uji bocor antar kasus. |
| Butuh hasil paling dapat dipercaya | **1 worker** atau sedikit worker dulu untuk *baseline*, baru bandingkan. |

**Aturan praktis:**

- Jangan set worker **lebih banyak daripada jumlah test case** — shard kosong
  tidak berguna. Pool otomatis membatasi jumlah shard agar tidak melebihi jumlah
  kasus.
- Naikkan worker secara bertahap dan **perhatikan `speedup`**. Begitu penambahan
  worker tidak lagi menaikkan speedup, kamu sudah mencapai titik jenuh.
- Perhatikan munculnya **flaky baru** setelah menaikkan worker. Kasus yang
  tadinya stabil bisa menjadi flaky karena berebut data uji atau sumber daya —
  itu tanda bahaya, bukan prestasi.

---

## 8. Konfigurasi pool

| Field | Arti | Default |
|---|---|---|
| `workers` | Jumlah worker paralel (1 = berurutan), maksimum 16. | `4` |
| `strategy` | Salah satu dari 5 strategi di atas. | `risk_weighted` |
| `case_timeout_ms` | Timeout per kasus yang diberikan ke engine. | `120000` |
| `max_retries` | Percobaan tambahan per kasus. `0` = sekali coba. | `1` |
| `retry_failed_only` | Bila aktif, kasus yang lulus tidak diulang. | `true` |
| `ai_healing` | Cari selector pengganti saat langkah web gagal. | `true` |
| `ai_triage` | Triase setiap kegagalan. | `true` |
| `abort_after_failures` | Hentikan pool setelah N kegagalan (`0` = jangan pernah). | `0` |
| `spawn_ai_agents` | Beri setiap worker nama dan peran agen. | `true` |

### `abort_after_failures`

Berguna untuk *safety gate*: kalau build sedang rusak parah, tidak ada gunanya
menjalankan 500 test case. Begitu ambangnya tercapai:

- shard yang **belum mulai** ditandai `aborted` dan tidak dijalankan sama sekali;
- shard yang **sedang berjalan** berhenti pada **batas kasus berikutnya**
  (granularitas yang jujur untuk worker yang sedang di tengah jalan);
- baris `pool_runs` disimpan dengan `status: 'aborted'`.

---

## 9. Rute API

Semua rute ter-mount di bawah `/api`.

| Metode | Rute | Kegunaan |
|---|---|---|
| `GET` | `/agents/capabilities` | Daftar strategi + default + `max_workers` + status AI + kesiapan executor. **Selalu menjawab**, bahkan tanpa konfigurasi apa pun. |
| `POST` | `/projects/:projectId/agents/plan` | **Dry run**: alokasi shard + estimasi beban, tanpa eksekusi. |
| `POST` | `/projects/:projectId/agents/run` | Jalankan pool dan kembalikan `AgentPoolResult`. |
| `GET` | `/projects/:projectId/agents/runs` | Riwayat run (`PoolRunMeta[]`). |
| `GET` | `/agents/runs/:id` | `AgentPoolResult` lengkap yang dimuat ulang dari basis data. |
| `POST` | `/agents/heal` | Playground penyembuhan selector (body: `HealRequest`). |

Contoh:

```bash
curl -s http://127.0.0.1:5174/api/agents/capabilities

curl -s -X POST http://127.0.0.1:5174/api/projects/prj_xxx/agents/plan \
  -H 'Content-Type: application/json' \
  -d '{"workers":4,"strategy":"duration_balanced","test_case_ids":["tc_1","tc_2","tc_3"]}'

curl -s -X POST http://127.0.0.1:5174/api/agents/heal \
  -H 'Content-Type: application/json' \
  -d '{"selector":"#login-btn","action":"click","html":"<button data-testid=\"btn-login\">Masuk</button>"}'
```

---

## 10. Batas dan kejujuran pelaporan

QATools memilih melaporkan keterbatasan daripada menyamarkannya:

1. **`ai_used` jujur.** Bernilai `true` hanya bila sebuah model sungguhan
   benar-benar menghasilkan sesuatu yang dipakai. Tanpa API key, seluruh jalur
   AI memakai generator deterministik dan `ai_used` bernilai `false`.
2. **Selector hasil healing tidak diverifikasi ulang di halaman hidup.** Ia
   diambil dari HTML yang dilaporkan engine; kalau HTML itu sudah kedaluwarsa,
   selector hasilnya juga bisa salah.
3. **Speedup bukan janji.** Ia angka terukur untuk run tersebut, pada mesin itu.
   Kasus yang terikat target bersama akan selalu jenuh.
4. **Triase bersifat indikatif.** Aturan kata kunci bisa salah menilai severity.
5. **Pool hanya menulis tabel `pool_runs`.** Setiap hasil per kasus ditulis oleh
   lane C (`executeService`), sehingga `test_runs`/`run_results` tetap punya
   **satu penulis** dan tidak ada balapan penulisan.
6. **Bila modul eksekusi lane C tidak dapat dimuat**, pool tidak berpura-pura
   menjalankan kasus: setiap kasus dilaporkan `blocked` beserta alasannya.

---

## 11. Menjalankan test

```bash
node --test --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/test/lane-g.test.ts
```

Suite ini membuktikan hal-hal paling penting, termasuk **paralelisme nyata**:
dengan stub runner berdelay 300 ms, run `workers: 4` harus jauh lebih cepat
daripada `workers: 1` dan `speedup > 1.5`.
