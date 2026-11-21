# Engine Eksekusi QATools — Panduan Lengkap

> Dokumen ini menjelaskan empat engine eksekusi QATools (Manual, Database, API, Web),
> assertion DSL yang dipakai bersama, cara mengaktifkan driver opsional, dan jalur belajar
> bertahap dari **Basic QA Automation → API Automation → Web Automation → Database Testing**.

---

## 1. Ringkasan: empat engine, satu tempat

Semua eksekusi bermuara pada satu pintu: **Run Center** (`/execute`). Di sana Anda memilih engine,
memilih test case, dan menjalankannya — satu per satu atau sebagai satu suite.

| Engine | Halaman | Menjalankan | Status di instalasi bawaan |
|---|---|---|---|
| **Manual** | Test Runs (`/runs`) | Langkah manual oleh tester | ✅ selalu tersedia |
| **Database** | `/db-tester` | SQL terhadap database | ✅ **sqlite aktif**; postgres/mysql perlu driver |
| **API** | `/api-tester` | HTTP request + assertion | ✅ aktif penuh |
| **Web** | `/web-tester` | Alur UI + verifikasi halaman | ✅ **mode HTTP aktif**; mode browser opsional |
| **AI** | `/ai` | Penalaran model atas hasil | ⚠️ tergantung modul AI & konfigurasi |

### Prinsip kejujuran mode

QATools **tidak pernah** mengklaim sesuatu berjalan padahal tidak. Halaman
`GET /api/execute/capabilities` selalu melaporkan, untuk setiap engine, **apa yang benar-benar
aktif dan mengapa**. Contoh: bila Playwright belum dipasang, Web Automation melaporkan dirinya
berada di **mode HTTP**, bukan berpura-pura menjalankan browser.

---

## 2. Kapan memakai engine yang mana

| Kebutuhan Anda | Engine | Alasan |
|---|---|---|
| Verifikasi ekspektasi bisnis yang butuh penilaian manusia | **Manual** | Otomasi tidak bisa menilai estetika/UX |
| Memastikan integritas data, migrasi, constraint, view | **Database** | UI/API bisa bohong; data tidak |
| Menguji kontrak endpoint, status, skema respons, auth | **API** | Paling cepat, paling stabil, tanpa browser |
| Menguji alur pengguna lintas halaman | **Web** | Satu-satunya yang melihat halaman seperti pengguna |
| Membantu menyimpulkan hasil yang ambigu | **AI** | Pendamping, bukan pengganti assertion |

**Urutan yang disarankan:** tulis assertion di API/Database dulu (cepat & stabil), lalu tambahkan
Web hanya untuk alur yang benar-benar membutuhkan UI.

---

## 3. Assertion DSL — satu bahasa untuk semua engine

Didefinisikan **beku** di `packages/shared/src/entities.ts` (`Assertion`, `AssertionOperator`) dan
dievaluasi oleh satu implementasi bersama di `apps/api/src/modules/execute/assertions.ts`.
Artinya: assertion yang Anda tulis di API Tester bisa dipahami dengan cara yang persis sama oleh
engine Database dan Web.

### 3.1 Bentuk assertion

```jsonc
{
  "source":   "jsonpath",        // dari mana nilai diambil
  "path":     "$.data.items[0].id", // path/kolom/header/selector (opsional)
  "operator": "equals",          // bagaimana dibandingkan
  "expected": "A-1",             // nilai harapan (opsional untuk exists)
  "message":  "SKU pertama benar" // pesan manusia saat gagal
}
```

### 3.2 Sumber (`source`)

| Sumber | Mengambil dari | Contoh `path` |
|---|---|---|
| `status` | Kode status HTTP | — |
| `body` | Body respons mentah | (opsional) kata kunci |
| `header` | Header respons (case-insensitive) | `content-type` |
| `duration` | Durasi eksekusi (ms) | — |
| `jsonpath` | Dokumen JSON respons | `$.data.items[0].sku` |
| `row_count` | Jumlah baris hasil SQL | — |
| `column` | Kolom pada baris pertama hasil SQL | `customer` |
| `text` | Teks halaman / elemen | (opsional) potongan teks |
| `element` | Hasil pencarian selector di halaman | `#login-form` |

> **Catatan penting untuk Database:** sumber `jsonpath` juga bekerja pada hasil SQL. Untuk query
> `SELECT COUNT(*) AS n ...`, tulis `jsonpath` dengan path `$.n`. Ini membuat penulisan assertion
> konsisten antara API dan Database.

### 3.3 Operator

| Operator | Arti | Contoh |
|---|---|---|
| `equals` | Sama dengan (numerik-aware: `200` = `"200"`) | `status equals 200` |
| `not_equals` | Tidak sama dengan | `status not_equals 500` |
| `contains` | Mengandung teks | `text contains "Masuk"` |
| `not_contains` | Tidak mengandung teks | `body not_contains "error"` |
| `gt` / `gte` | Lebih besar / lebih besar sama dengan | `row_count gte 1` |
| `lt` / `lte` | Lebih kecil / lebih kecil sama dengan | `duration lt 5000` |
| `exists` | Nilai/path ada | `jsonpath $.data.token exists` |
| `not_exists` | Nilai/path tidak ada | `jsonpath $.error not_exists` |
| `matches` | Cocok dengan regex | `text matches "^Selamat"` |
| `in` | Termasuk salah satu nilai | `status in [200, 201]` |
| `length_gte` | Panjang ≥ N (array/string/objek) | `jsonpath $.items length_gte 3` |
| `length_lte` | Panjang ≤ N | `jsonpath $.items length_lte 10` |

### 3.4 Path JSON (jsonpath-ish)

Parser path ditulis tangan — **tanpa paket `jsonpath`**. Yang didukung:

```
$.data.id                 akses anggota bersarang
$.data.items[0].sku       indeks array
$['kunci dengan spasi']   anggota berkutip
$.items[*].id             wildcard → mengembalikan array
$.items.length            panjang array/string/objek
$                         dokumen akar
data.items[0].id          tanda "$." di depan boleh dihilangkan
```

Path yang tidak ditemukan **tidak melempar error** — assertion `exists` menjadi `false` dan pesan
kegagalan menyebutkan path mana yang tidak ketemu.

### 3.5 Contoh lengkap

**API — endpoint login**

```jsonc
[
  { "source": "status",   "operator": "equals", "expected": 200 },
  { "source": "header",   "path": "content-type", "operator": "contains", "expected": "json" },
  { "source": "jsonpath", "path": "$.token", "operator": "exists" },
  { "source": "jsonpath", "path": "$.user.name", "operator": "equals", "expected": "tester",
    "message": "Nama user sesuai" },
  { "source": "duration", "operator": "lt", "expected": 3000, "message": "Respons di bawah 3 detik" }
]
```

**Database — jumlah order berstatus paid**

```sql
SELECT COUNT(*) AS n FROM orders WHERE status = 'paid'
```

```jsonc
[
  { "source": "row_count", "operator": "equals", "expected": 1 },
  { "source": "jsonpath",  "path": "$.n", "operator": "equals", "expected": 3 },
  { "source": "jsonpath",  "path": "$.n", "operator": "gte", "expected": 1 }
]
```

**Database — kolom pada baris pertama**

```sql
SELECT customer, total, status FROM orders WHERE status = 'paid' ORDER BY id
```

```jsonc
[
  { "source": "row_count", "operator": "equals", "expected": 3 },
  { "source": "column", "path": "customer", "operator": "equals", "expected": "Andi" },
  { "source": "column", "path": "total", "operator": "gt", "expected": 100000 },
  { "source": "column", "path": "status", "operator": "in", "expected": ["paid"] }
]
```

**Web — alur login**

```jsonc
[
  { "action": "goto", "value": "http://127.0.0.1:5174/login" },
  { "action": "assert_visible", "selector": "#login-form" },
  { "action": "assert_visible", "selector": "[data-testid=\"btn-login\"]" },
  { "action": "assert_text", "selector": "#product-table", "expected": "Kopi Arabika" },
  { "action": "fill", "selector": "input[name=\"username\"]", "value": "tester" },
  { "action": "assert_url", "expected": "/login" }
]
```

---

## 4. Engine API (`/api-tester`)

### 4.1 Yang benar-benar berjalan

Eksekusi memakai **`fetch` bawaan Node 22+** — tidak ada `axios`, tidak ada `node-fetch`.
Artinya: panggilan HTTP nyata, redirect diikuti, timeout dihormati.

### 4.2 Auth

| Tipe | Konfigurasi `auth_config` |
|---|---|
| `none` | — |
| `bearer` | `{ "token": "..." }` |
| `basic` | `{ "username": "...", "password": "..." }` |
| `api_key` | `{ "key": "X-API-Key", "value": "...", "in": "header" }` — `in` boleh `query` |

Nilai auth **disamarkan** pada evidence yang tersimpan (`Authorization: ***`), sehingga token tidak
bocor ke laporan.

### 4.3 Interpolasi variabel

Tulis `{{nama}}` di path, header, query, atau body. Nilainya diambil dari **variabel collection**
lalu **variabel environment** (environment menang). Placeholder yang belum terisi dicatat sebagai
peringatan pada log, bukan crash.

### 4.4 Skrip aman — tanpa JavaScript bebas

> ⚠️ **QATools tidak pernah menjalankan `eval` atau `new Function`.** Skrip pre/post dibatasi pada
> sub-himpunan deklaratif yang sempit. Pernyataan di luar itu **ditolak dengan pesan jelas.**

Bentuk yang diterima:

```
set("token", jsonpath("$.data.token"))      // ambil nilai dari respons
set("order_id", jsonpath("$.data.items[0].id"))
set("kode", status)                          // status respons
set("body_raw", body)
set("trace", header("X-Trace-Id"))
header("X-Custom", "nilai")                  // tambah/ubah header request (pre-script)
var("alias", jsonpath("$.a"))                // alias dari set()
```

Ekspresi yang didukung: string literal, angka, `true`/`false`/`null`, `jsonpath("...")`,
`status`, `body`, `header("...")`, dan nama variabel yang sudah ada.

Yang **ditolak** (contoh nyata dari pesan error):

```
console.log("hi")        → Fungsi "console" tidak diizinkan...
process.exit(1)          → Fungsi "process" tidak diizinkan...
eval("1+1")              → Fungsi "eval" tidak dikenal dalam ekspresi skrip...
```

### 4.5 Import OpenAPI / Swagger

Tombol **Import OpenAPI** menerima dokumen **JSON** (OpenAPI 3.x atau Swagger 2.0). Untuk setiap
operasi HTTP dibuat satu request, lengkap dengan:

- contoh query/header dari `parameters`,
- contoh body dari `requestBody.content['application/json'].schema`,
- assertion awal: status sukses sesuai `responses` + durasi < 5 detik.

Format **YAML tidak didukung langsung** — konversi dulu:

```bash
npx swagger-cli bundle -o openapi.json openapi.yaml
```

---

## 5. Engine Database (`/db-tester`)

### 5.1 Dialect yang aktif — dan mengapa

| Dialect | Driver | Status | Alasan |
|---|---|---|---|
| **sqlite** | `node:sqlite` (bawaan Node 22+) | ✅ **aktif penuh** | Tanpa kompilasi native sama sekali |
| **postgres** | `pg` | ❌ 501 `driver_not_installed` | Driver sengaja tidak dipaketkan |
| **mysql** | `mysql2` | ❌ 501 `driver_not_installed` | Driver sengaja tidak dipaketkan |

**Mengapa driver tidak dipaketkan?** QATools harus bisa dipasang dengan `pnpm install` biasa di
mesin **tanpa toolchain C/C++**. Menambahkan modul native akan mematahkan instalasi untuk semua
orang. Karena itu driver eksternal diserahkan ke pengguna.

### 5.2 Mengaktifkan postgres / mysql sendiri

```bash
# PostgreSQL
pnpm -F @qatools/api add pg

# MySQL
pnpm -F @qatools/api add mysql2
```

Setelah terpasang, buat koneksi dengan dialect yang sesuai di `/db-tester`. Selama driver belum
ada, QATools mengembalikan **501** yang jelas beserta cara memasangnya — bukan error samar.

Contoh DSN:

```
postgres://user:password@localhost:5432/mydb
mysql://user:password@localhost:3306/mydb
data/qatools.db            # sqlite, relatif terhadap direktori data API
/absolut/path/latihan.db   # sqlite absolut
:memory:                   # sqlite in-memory
```

> **Keamanan:** `dsn` **tidak pernah** dikembalikan pada respons daftar koneksi. Yang tampil hanya
> `dsn_masked` (mis. `postgres://user:***@host/db`).

### 5.3 🔒 Readonly guard — fitur keselamatan, bukan pelengkap

Saat **readonly guard aktif** (default), engine menolak apa pun selain **satu statement
`SELECT` / `WITH ... SELECT`**. Penolakan terjadi **sebelum** koneksi dibuka, sehingga statement
berbahaya tidak pernah menyentuh database.

Ditolak:

```sql
UPDATE orders SET status = 'refunded' WHERE id = 1   -- ❌ UPDATE
DROP TABLE orders                                     -- ❌ DROP
DELETE FROM orders                                    -- ❌ DELETE
INSERT INTO orders (...) VALUES (...)                 -- ❌ INSERT
SELECT 1; DROP TABLE orders                           -- ❌ dua statement
PRAGMA journal_mode = WAL                             -- ❌ PRAGMA menulis
ATTACH DATABASE 'x.db' AS x                           -- ❌ ATTACH
WITH x AS (SELECT 1) DELETE FROM orders               -- ❌ CTE yang menulis
```

Diizinkan:

```sql
SELECT * FROM orders WHERE status = 'paid'            -- ✅
WITH paid AS (SELECT * FROM orders WHERE status='paid')
SELECT COUNT(*) AS n FROM paid                        -- ✅
SELECT 'DROP TABLE orders' AS pesan                   -- ✅ kata DROP di dalam literal aman
PRAGMA table_info(orders)                             -- ✅ PRAGMA baca
```

Saat ditolak, API mengembalikan **HTTP 400** dengan kode `readonly_guard_violation` dan penjelasan
statement mana yang melanggar. Analisis SQL dilakukan setelah komentar dan literal dibersihkan,
sehingga kata kunci di dalam string tidak salah dianggap perintah.

**Matikan guard hanya bila Anda memang perlu menulis** — mis. check yang memakai `setup_sql` untuk
menyisipkan data uji.

### 5.4 Setup dan teardown

- `setup_sql` — dijalankan **sebelum** query, boleh beberapa statement dipisah `;`.
- `teardown_sql` — **selalu** dijalankan setelah query, termasuk ketika query gagal (pembersihan).

Saat guard aktif, setup ikut tunduk pada aturan readonly.

### 5.5 EXPLAIN dan schema browser

- **EXPLAIN** menampilkan `EXPLAIN QUERY PLAN` sqlite — berguna melihat apakah indeks terpakai.
  Hanya tersedia untuk statement baca.
- **Schema browser** mendaftar tabel dan kolom (nama, tipe, NOT NULL, primary key) dari sqlite.

---

## 6. Engine Web (`/web-tester`)

### 6.1 Dua mode — dan mana yang sedang aktif

**Mode HTTP (selalu tersedia, tanpa dependensi).** Halaman diambil dengan `fetch`, lalu HTML
diurai oleh **parser tulis-tangan** (`apps/api/src/modules/webtester/html.ts`) — tanpa `cheerio`,
tanpa `jsdom`. Selanjutnya setiap langkah dan assertion dievaluasi secara **nyata** terhadap hasil
parsial: keberadaan elemen, teks, jumlah, dan URL.

**Mode Playwright (opsional, dipasang sendiri).** Bila paket `playwright` terdeteksi **dan** browser
sudah diunduh, engine menjalankan browser sungguhan: klik, isi form, hover, screenshot, dan
menunggu elemen.

### 6.2 Mengaktifkan mode browser

```bash
pnpm -F @qatools/api add -D playwright
npx playwright install chromium
```

Bila browser belum diunduh, engine **jatuh kembali ke mode HTTP** dan mencatat alasannya pada log —
tidak pernah gagal diam-diam atau mengaku browser berjalan.

`GET /execute/capabilities` melaporkan mode aktif beserta alasannya:

```jsonc
{
  "engine": "web",
  "available": true,
  "mode": "http",              // atau "playwright"
  "reason": "AKTIF dalam mode HTTP: ambil halaman dengan fetch, parse HTML ... Mode browser Playwright TIDAK aktif: ..."
}
```

### 6.3 Perilaku per aksi di mode HTTP

| Aksi | Mode HTTP | Mode Playwright |
|---|---|---|
| `goto` | ✅ benar-benar mengambil halaman | ✅ navigasi browser |
| `assert_visible` | ✅ nyata (ada/tidak di HTML) | ✅ nyata (terlihat) |
| `assert_text` | ✅ nyata (teks halaman/elemen) | ✅ nyata |
| `assert_url` | ✅ nyata | ✅ nyata |
| `click`, `hover`, `scroll` | ⚠️ diverifikasi keberadaannya saja | ✅ interaksi nyata |
| `fill`, `select`, `check`, `press` | ⚠️ diverifikasi elemennya bisa diisi | ✅ pengisian nyata |
| `wait` | ⏭️ dilewati (halaman sudah termuat penuh) | ✅ menunggu |
| `screenshot` | ⏭️ dilewati, dengan alasan jelas | ✅ PNG penuh |

Baris ⚠️ dan ⏭️ **selalu** ditandai pada log dan evidence. Inilah wujud kejujuran mode.

### 6.4 "Ambil Elemen" (record-hint)

Tombol ini mengambil URL dan **menyarankan** langkah beserta kandidat selector dengan urutan
prioritas:

```
id  >  data-testid  >  name  >  aria-label  >  text  >  nth-of-type  >  tag
```

Semua saran bersifat **usulan** — tidak ada yang langsung disimpan. Anda meninjau, menambahkan satu
per satu atau menerapkan semuanya, lalu menyimpan flow.

### 6.5 Selector yang didukung parser

```
#login-form                    id
[data-testid="btn-login"]      atribut
input[name="username"]         tag + atribut
[aria-label="Nama pengguna"]   atribut (nilai boleh berspasi)
.top                           class
form#login-form input          gabungan + keturunan
#product-table tr              keturunan
button >> text=Masuk           pemisah ">>" + pencocokan teks
```

---

## 7. Run Center (`/execute`)

Halaman eksekusi utama:

1. **Panel kesiapan engine** — status jujur setiap engine dari `GET /execute/capabilities`.
2. **Pemilih test case** — filter per engine, pencarian kode/judul, filter suite regresi.
3. **Multi-select** — pilih banyak test case sekaligus.
4. **Dry-run** — validasi & kompilasi tanpa menembak target.
5. **Tombol Jalankan** — menjalankan satu suite.
6. **Tabel hasil** — badge status, durasi, pesan error.
7. **Drill-down** — log per langkah, hasil tiap assertion, dan evidence mentah.
8. **Buat Defect** — membuat defect dari hasil yang gagal.

### API Run Center

| Metode | Path | Kegunaan |
|---|---|---|
| `GET` | `/api/execute/capabilities` | Matriks engine jujur + alasan |
| `GET` | `/api/execute/cases` | Daftar test case untuk pemilih |
| `POST` | `/api/execute/suite` | `{ test_case_ids, engine?, environment_id?, dry_run? }` |
| `POST` | `/api/test-cases/:id/execute` | Menjalankan satu test case |
| `GET` | `/api/execute/runs/:runId/results` | Hasil satu run |
| `GET` | `/api/execute/results/:resultId` | Detail satu hasil |
| `POST` | `/api/execute/preflight` | Memisahkan test case yang siap vs terblokir |

### Untuk lintas-lane (in-process)

Lane lain memanggil `executeService` langsung, tanpa HTTP:

```ts
import { executeService } from '../execute/index.js';

const result = await executeService.runCase('tc_...');          // EngineResult
const suite  = await executeService.runSuite(['tc_1', 'tc_2']); // SuiteResult
const caps   = await executeService.capabilities();
```

`runSuite` membuat baris `test_runs`, menulis `run_results` per test case, lalu menggelung
counter (total/lulus/gagal/terblokir/dilewati). Sertakan `opts.run_id` untuk **menambah** ke run
yang sudah ada.

---

## 8. Jalur belajar bertahap

Urutan ini disusun agar setiap tahap membangun keterampilan yang dipakai tahap berikutnya.

### Tahap 1 — Basic QA Automation
**Tujuan:** memahami bahwa "otomasi" = *langkah + assertion*, bukan sekadar menjalankan skrip.

- Buka `/execute`, pilih test case **manual**, jalankan, dan catat hasilnya.
- Kenali siklus: **siapkan → jalankan → verifikasi → catat bukti**.
- Latihan: tulis 3 test case manual dengan hasil yang diharapkan eksplisit.

### Tahap 2 — API Automation
**Tujuan:** memverifikasi kontrak tanpa UI.

- Buka `/api-tester`, buat collection dengan base URL `http://127.0.0.1:5174/api/mock`.
- Buat request `GET /health` dan `GET /products`.
- Tambahkan assertion `status equals 200` dan `jsonpath $.data length_gte 1`.
- Gunakan **Import OpenAPI** untuk membuat banyak request sekaligus.
- Latihan: uji juga jalur **negatif** — assertion yang sengaja salah, agar Anda melihat laporan gagal.

> Endpoint mock bawaan QATools (`/api/mock/health`, `/products`, `/login`, `/orders`) ideal untuk
> latihan karena tidak memerlukan internet.

### Tahap 3 — Web Automation
**Tujuan:** melihat sistem seperti pengguna melihatnya.

- Buka `/web-tester`, tekan **Ambil Elemen** dengan URL halaman yang ingin diuji.
- Tinjau kandidat selector — perhatikan bahwa `data-testid` lebih stabil daripada teks.
- Susun alur: `goto` → `assert_visible` → `fill` → `assert_text` → `assert_url`.
- Jalankan dan baca timeline per langkah.
- Pahami **batas mode HTTP**: klik/form hanya diverifikasi keberadaannya. Bila butuh interaksi
  sungguhan, pasang Playwright (bagian 6.2).

### Tahap 4 — Database Testing
**Tujuan:** memastikan datanya benar, bukan hanya tampilannya.

- Buka `/db-tester`, buat koneksi `sqlite` (mis. `data/qatools.db`).
- Biarkan **readonly guard aktif** — biasakan diri dengan batas aman.
- Tulis `SELECT COUNT(*) AS n FROM ...` dan assertion `jsonpath $.n equals <harapan>`.
- Coba sengaja menulis `DROP TABLE` untuk melihat guard menolak dengan pesan jelas.
- Muat **skema** untuk mengenali struktur tabel, lalu gunakan **EXPLAIN** untuk memeriksa query.
- Latihan lanjutan: gunakan `setup_sql` untuk menyiapkan data dan `teardown_sql` untuk
  membersihkannya (perlu koneksi tanpa guard).

### Tahap 5 — Menyatukan semuanya
- Buat satu suite regresi di `/execute` yang mencampur test case API, Web, dan Database.
- Jalankan dengan **dry-run** terlebih dahulu, lalu eksekusi sungguhan.
- Drill-down ke hasil yang gagal dan tekan **Buat Defect**.

---

## 9. Pemecahan masalah

| Gejala | Sebab | Tindakan |
|---|---|---|
| `501 driver_not_installed` | Dialect postgres/mysql tanpa driver | Pasang `pg` / `mysql2` (bagian 5.2) |
| Web flow melaporkan mode `http` | Playwright belum dipasang | Bagian 6.2, atau terima batas mode HTTP |
| `400 readonly_guard_violation` | Statement bukan SELECT/WITH | Ubah ke SELECT, atau matikan guard pada koneksi |
| Panggilan API `blocked` | Target tidak dapat dihubungi | Pastikan server target hidup dan URL benar |
| Request `blocked` pada GET | Body dikirim pada metode GET | Hapus body; engine mengabaikan body pada GET/HEAD |
| Skrip ditolak | Bukan bentuk `set`/`var`/`header` | Tulis ulang sesuai bagian 4.4 |
| Import OpenAPI gagal | Dokumen YAML, bukan JSON | Konversi dulu (bagian 4.5) |
| Assertion `jsonpath` gagal | Path tidak ada pada dokumen | Periksa path; untuk SQL gunakan `$.nama_kolom` |

---

## 10. Rujukan kode

| Berkas | Isi |
|---|---|
| `apps/api/src/modules/execute/assertions.ts` | Evaluator assertion bersama (satu-satunya implementasi) |
| `apps/api/src/modules/execute/jsonpath.ts` | Parser path JSON tulis-tangan |
| `apps/api/src/modules/execute/scripting.ts` | Interpolasi variabel, skrip aman, auth |
| `apps/api/src/modules/execute/index.ts` | `executeService` + rute Run Center |
| `apps/api/src/modules/apitester/engine.ts` | Engine API (fetch bawaan) |
| `apps/api/src/modules/apitester/openapi.ts` | Import OpenAPI/Swagger |
| `apps/api/src/modules/dbtester/engine.ts` | Engine Database (node:sqlite) |
| `apps/api/src/modules/dbtester/guard.ts` | Readonly guard & analisis SQL |
| `apps/api/src/modules/webtester/html.ts` | Parser & pencocok selector tulis-tangan |
| `apps/api/src/modules/webtester/engine.ts` | Engine Web (mode HTTP + Playwright opsional) |
| `apps/api/test/lane-c.test.ts` | Uji eksekusi nyata (loopback HTTP + sqlite + guard) |
