/**
 * Curriculum content, part C — courses 7–9.
 *
 * Owned by Lane E. Pure data: no database access, no side effects.
 *
 * Courses here:
 *   7. Database Testing                    (pillar 'Database Testing')
 *   8. Materi & Praktik: Studi Kasus E2E   (pillar 'Materi & Praktik')
 *   9. Bangun Portofolio QA                (pillar 'Bangun Portofolio')
 */

import type { SeedCourse } from './types.js';

/* ==================================================================== *
 * 7 — Database Testing
 * ==================================================================== */

const databaseTesting: SeedCourse = {
  slug: 'database-testing',
  title: 'Database Testing: Memverifikasi Kebenaran Data',
  subtitle: 'SQL untuk tester, verifikasi CRUD, join, constraint, transaksi, integritas, dan migrasi.',
  description:
    'Kursus pengujian lapisan data. API bisa mengembalikan "sukses" sementara datanya salah; kursus ini mengajarkan cara membuktikan kebenaran data secara langsung dengan SQL, memeriksa constraint, menguji transaksi dan isolasi, serta memvalidasi migrasi skema.',
  level: 'intermediate',
  pillar: 'Database Testing',
  estimated_minutes: 720,
  order_index: 7,
  icon: '🗄️',
  tags: ['sql', 'integritas-data', 'transaksi', 'constraint', 'migrasi'],
  modules: [
    {
      code: 'QA-DB-M1',
      title: 'SQL untuk Tester',
      summary: 'SELECT, filter, agregasi, join, dan subquery yang benar-benar dipakai saat menguji.',
      order_index: 1,
      lessons: [
        {
          code: 'L-DB-01',
          title: 'SELECT, Filter & Agregasi',
          kind: 'reading',
          duration_minutes: 26,
          order_index: 1,
          content_md: `## SQL adalah alat verifikasi, bukan hanya alat pengambilan data

Ketika API mengembalikan \`{"status": "success"}\`, itu adalah **klaim**. Membuktikannya memerlukan
pemeriksaan langsung ke lapisan penyimpanan. Inilah alasan QA perlu membaca dan menulis SQL.

### Kerangka query yang akan Anda pakai setiap hari

\`\`\`sql
SELECT   kolom_yang_diperiksa
FROM     tabel
WHERE    kondisi_pembatas
ORDER BY kolom
LIMIT    n;
\`\`\`

Urutan penulisan berbeda dari urutan eksekusi. Ini penting untuk memahami perilaku filter:

\`\`\`text
Urutan eksekusi sebenarnya:
  1. FROM      — sumber data
  2. WHERE     — filter baris
  3. GROUP BY  — pengelompokan
  4. HAVING    — filter setelah pengelompokan
  5. SELECT    — pemilihan kolom & ekspresi
  6. ORDER BY  — pengurutan
  7. LIMIT     — pembatasan jumlah
\`\`\`

Konsekuensi praktis: **alias kolom tidak bisa dipakai di \`WHERE\`** (karena \`WHERE\` berjalan sebelum
\`SELECT\`), tetapi bisa dipakai di \`ORDER BY\`.

### Operator filter yang paling berguna saat menguji

| Operator | Kegunaan | Contoh |
|---|---|---|
| \`=\`, \`<>\` | Perbandingan tepat | \`WHERE status = 'paid'\` |
| \`BETWEEN\` | Rentang inklusif | \`WHERE total BETWEEN 500000 AND 600000\` |
| \`IN\` | Beberapa nilai | \`WHERE status IN ('paid','shipped')\` |
| \`LIKE\` | Pola teks | \`WHERE email LIKE 'qa+%@contoh.id'\` |
| \`IS NULL\` | Nilai kosong | \`WHERE deleted_at IS NULL\` |
| \`IS NOT NULL\` | Nilai terisi | \`WHERE paid_at IS NOT NULL\` |
| \`AND\`/\`OR\` | Gabungan kondisi | \`WHERE status='paid' AND refunded_at IS NULL\` |

Peringatan penting tentang \`NULL\`: \`NULL\` bukan nilai, melainkan ketiadaan nilai.

\`\`\`sql
-- SALAH: tidak mengembalikan baris dengan phone NULL
SELECT * FROM users WHERE phone <> '08123';

-- BENAR: NULL harus diuji secara eksplisit
SELECT * FROM users WHERE phone IS NULL OR phone <> '08123';
\`\`\`

Ini sumber bug query yang paling sering ditemui QA pemula.

### Agregasi untuk pemeriksaan

| Fungsi | Pertanyaan yang dijawab | Contoh |
|---|---|---|
| \`COUNT(*)\` | Berapa baris? | Berapa pesanan dibuat hari ini? |
| \`COUNT(kolom)\` | Berapa baris dengan nilai tidak kosong? | Berapa pesanan yang sudah dibayar? |
| \`SUM\` | Berapa totalnya? | Total nilai pesanan |
| \`MIN\`/\`MAX\` | Nilai terkecil/terbesar | Tanggal paling awal |
| \`AVG\` | Rata-rata | Rata-rata nilai keranjang |

Perbedaan \`COUNT(*)\` dan \`COUNT(kolom)\` sangat berguna untuk mendeteksi data tidak lengkap:

\`\`\`sql
SELECT COUNT(*)                AS total_baris,
       COUNT(paid_at)          AS sudah_dibayar,
       COUNT(*) - COUNT(paid_at) AS belum_dibayar
FROM orders
WHERE created_at >= '2026-11-01';
\`\`\`

### GROUP BY dan HAVING untuk menemukan anomali

Query yang paling berguna untuk QA biasanya yang **mencari data yang tidak seharusnya ada**:

\`\`\`sql
-- Pesanan dengan total tidak sama dengan jumlah itemnya
SELECT o.id, o.total_amount, SUM(oi.price * oi.qty) AS hitung_ulang
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id, o.total_amount
HAVING o.total_amount <> SUM(oi.price * oi.qty);
\`\`\`

Bila query ini mengembalikan baris, Anda menemukan **bug integritas data** — jenis temuan yang jauh
lebih berharga daripada bug tampilan.

### Kesalahan umum saat menulis query verifikasi

1. Lupa \`WHERE\` sehingga memeriksa seluruh tabel, bukan data uji.
2. Memakai \`LIMIT 1\` lalu menyimpulkan hanya ada satu baris.
3. Mengabaikan \`NULL\`.
4. Membandingkan nilai uang dengan tipe floating point tanpa toleransi.
5. Tidak mengurutkan hasil sehingga kesimpulan bergantung pada urutan yang tidak dijamin.

### Pola verifikasi yang bisa dipakai ulang

\`\`\`sql
-- 1. Hitung dulu, jangan ambil barisnya
SELECT COUNT(*) AS n FROM promo_usages
WHERE promo_code = 'PROMO10' AND user_id = 'usr_123';   -- harapan: 1

-- 2. Periksa nilai persis
SELECT total_amount, discount_amount, status
FROM orders WHERE id = 'ord_456';                        -- harapan: 540000, 60000, 'paid'

-- 3. Periksa ketiadaan
SELECT COUNT(*) AS n FROM orders WHERE user_id = 'usr_123' AND status = 'draft';
                                                         -- harapan: 0
\`\`\`

### Latihan

Tulis lima query yang memeriksa hasil operasi tulis di aplikasi Anda: keberadaan, nilai persis,
jumlah, ketiadaan, dan konsistensi antar-tabel.`,
          lab_ref: '/db-tester',
        },
        {
          code: 'L-DB-02',
          title: 'JOIN & Subquery untuk Verifikasi Lintas Tabel',
          kind: 'reading',
          duration_minutes: 26,
          order_index: 2,
          content_md: `## Data nyata tersebar di banyak tabel

Satu operasi bisnis biasanya menyentuh beberapa tabel sekaligus. Untuk membuktikan kebenarannya, Anda
perlu menggabungkan data.

### Jenis JOIN dan kegunaannya saat menguji

| JOIN | Arti | Kegunaan pengujian |
|---|---|---|
| INNER JOIN | Hanya baris yang cocok di kedua sisi | Memastikan relasi benar-benar ada |
| LEFT JOIN | Semua baris kiri, cocok atau tidak | **Mencari data yatim** (relasi hilang) |
| RIGHT JOIN | Kebalikan LEFT JOIN | Jarang dipakai; biasanya dibalik |
| FULL OUTER JOIN | Semua baris kedua sisi | Mencari ketidakcocokan dua arah |
| CROSS JOIN | Semua kombinasi | Menghasilkan matriks data uji |

**LEFT JOIN adalah sahabat QA**, karena ia menemukan data yang seharusnya punya relasi tetapi tidak.

\`\`\`sql
-- Mencari pesanan yang tidak punya satu pun item (data yatim)
SELECT o.id, o.code, o.total_amount, COUNT(oi.id) AS jumlah_item
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id, o.code, o.total_amount
HAVING COUNT(oi.id) = 0;
\`\`\`

Bila query ini mengembalikan baris, ada pesanan tanpa isi — bug integritas yang serius.

### Pola pencarian anomali yang paling berguna

**1. Baris tanpa induk (orphan)**

\`\`\`sql
SELECT oi.id
FROM order_items oi
LEFT JOIN orders o ON o.id = oi.order_id
WHERE o.id IS NULL;
\`\`\`

**2. Induk tanpa anak padahal seharusnya punya**

\`\`\`sql
SELECT o.id
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
WHERE o.status = 'paid' AND oi.id IS NULL;
\`\`\`

**3. Nilai yang tidak konsisten antar-tabel**

\`\`\`sql
SELECT o.id, o.total_amount, p.amount AS jumlah_pembayaran
FROM orders o
JOIN payments p ON p.order_id = o.id
WHERE o.total_amount <> p.amount;
\`\`\`

**4. Duplikasi yang seharusnya tidak ada**

\`\`\`sql
SELECT email, COUNT(*) AS jumlah
FROM users
GROUP BY email
HAVING COUNT(*) > 1;
\`\`\`

**5. Status yang mustahil**

\`\`\`sql
SELECT id, status, paid_at, cancelled_at
FROM orders
WHERE status = 'cancelled' AND paid_at IS NOT NULL;
\`\`\`

Query terakhir mendeteksi keadaan yang secara aturan bisnis tidak mungkin: pesanan yang dibatalkan
tetapi tercatat sudah dibayar.

### Subquery: memeriksa yang tidak ada

Subquery sangat berguna untuk **pengujian negatif** — memastikan sesuatu tidak terjadi.

\`\`\`sql
-- User yang belum pernah memakai kode promo apa pun
SELECT u.id, u.email
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM promo_usages pu WHERE pu.user_id = u.id
);

-- Produk yang muncul di keranjang tetapi tidak ada di katalog
SELECT DISTINCT ci.product_id
FROM cart_items ci
WHERE ci.product_id NOT IN (SELECT id FROM products);
\`\`\`

Peringatan: \`NOT IN\` dengan subquery yang menghasilkan \`NULL\` berperilaku mengejutkan (tidak
mengembalikan baris apa pun). Gunakan \`NOT EXISTS\` untuk keandalan yang lebih baik.

### Menyusun laporan bukti dari SQL

Bukti query yang baik untuk laporan bug memuat tiga hal:

\`\`\`sql
-- 1. Query yang dijalankan (bisa diulang orang lain)
-- 2. Hasil yang teramati (tempel tabelnya)
-- 3. Hasil yang diharapkan (jelaskan dalam komentar)
\`\`\`

\`\`\`sql
-- BUG-012: total pesanan tidak memperhitungkan diskon promo
-- Diharapkan: total_amount = 540000 (600000 - 60000)
SELECT id, total_amount, discount_amount, promo_code
FROM orders WHERE id = 'ord_456';
-- Hasil: ord_456 | 600000 | 60000 | PROMO10   ← total tidak dikurangi
\`\`\`

Bukti seperti ini tidak bisa dibantah dan langsung menunjuk lokasi masalah.

### Latihan

Tulis lima query anomali untuk skema aplikasi Anda: baris yatim, induk tanpa anak, nilai tidak
konsisten, duplikat, dan status mustahil. Jalankan pada data staging dan laporkan temuannya.`,
          lab_ref: '/db-tester',
        },
        {
          code: 'L-DB-09',
          title: 'Latihan: Pustaka Query Pemeriksaan Integritas',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 3,
          content_md: `## Kumpulan query yang seharusnya berjalan setiap rilis

Sebagian besar tim hanya menjalankan query integritas ketika sudah ada masalah. Latihan ini menghasilkan
pustaka kecil yang bisa dijalankan kapan saja — sebelum rilis, setelah migrasi, atau setelah insiden.

### Prinsip pustaka pemeriksaan

1. **Setiap query mengembalikan baris hanya bila ada masalah.** Query yang mengembalikan nol baris berarti
   sehat — sehingga hasilnya mudah dibaca.
2. **Setiap query punya komentar berisi hasil yang diharapkan.**
3. **Query bersifat baca saja.** Tidak ada \`UPDATE\` atau \`DELETE\`.
4. **Query dapat dijalankan pada database mana pun** dengan skema yang sama.

### Pustaka inti

\`\`\`sql
-- 1. Nilai wajib yang kosong  (harapan: 0 baris)
SELECT id, email FROM users WHERE email IS NULL OR TRIM(email) = '';

-- 2. Duplikat pada kolom yang seharusnya unik  (harapan: 0 baris)
SELECT email, COUNT(*) AS jumlah FROM users GROUP BY LOWER(email) HAVING COUNT(*) > 1;

-- 3. Baris anak tanpa induk  (harapan: 0 baris)
SELECT oi.id FROM order_items oi
LEFT JOIN orders o ON o.id = oi.order_id WHERE o.id IS NULL;

-- 4. Induk yang seharusnya punya anak tetapi tidak  (harapan: 0 baris)
SELECT o.id FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
WHERE o.status = 'paid' AND oi.id IS NULL;

-- 5. Nilai di luar rentang wajar  (harapan: 0 baris)
SELECT id, qty FROM order_items WHERE qty <= 0 OR qty > 999;
SELECT id, price FROM products   WHERE price < 0;

-- 6. Timestamp tidak logis  (harapan: 0 baris)
SELECT id FROM orders WHERE updated_at < created_at;

-- 7. Keadaan mustahil menurut aturan bisnis  (harapan: 0 baris)
SELECT id FROM orders WHERE status = 'cancelled' AND paid_at IS NOT NULL;

-- 8. Jumlah tidak konsisten antar-tabel  (harapan: 0 baris)
SELECT o.id, o.total_amount, SUM(oi.qty * oi.price) AS hitung_ulang
FROM orders o JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id, o.total_amount
HAVING o.total_amount <> SUM(oi.qty * oi.price);

-- 9. Pembayaran melebihi nilai pesanan  (harapan: 0 baris)
SELECT o.id, o.total_amount, p.amount
FROM orders o JOIN payments p ON p.order_id = o.id
WHERE p.amount > o.total_amount;

-- 10. Soft delete yang bocor  (harapan: 0 baris)
SELECT u.id FROM users u
WHERE u.deleted_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.expires_at > datetime('now'));

-- 11. Pemakaian promo melebihi kuota  (harapan: 0 baris)
SELECT p.code, p.used_count, p.max_usage FROM promos p WHERE p.used_count > p.max_usage;

-- 12. Kode promo dipakai lebih dari sekali per akun  (harapan: 0 baris)
SELECT promo_code, user_id, COUNT(*) AS jumlah FROM promo_usages
GROUP BY promo_code, user_id HAVING COUNT(*) > 1;
\`\`\`

### Bagaimana membacanya sebagai laporan

Jalankan seluruh pustaka lalu sajikan hasilnya sebagai tabel — bukan dump mentah:

| # | Pemeriksaan | Hasil | Status |
|---|---|---|---|
| 1 | Nilai wajib kosong | 0 | ✅ |
| 2 | Duplikat email | 2 | ❌ |
| 3 | Anak tanpa induk | 0 | ✅ |
| … | … | … | … |

Dua baris duplikat email langsung menjadi temuan berprioritas tinggi, karena itu berarti pendaftaran
akun ganda mungkin terjadi.

### Menjadikannya otomatis

Pustaka ini paling berharga bila dijalankan otomatis:

1. Sebelum setiap rilis (pemeriksaan pra-rilis).
2. Setelah setiap migrasi (verifikasi integritas).
3. Terjadwal harian di staging (deteksi dini).
4. Dalam pengujian otomasi sebagai DB check.

### Kriteria selesai

- Pustaka memuat minimal sepuluh query dengan komentar hasil yang diharapkan.
- Seluruh query dijalankan dan hasilnya disajikan dalam tabel status.
- Setiap temuan non-nol dilaporkan sebagai defect dengan bukti query.

### Refleksi

Perhatikan bahwa sebagian besar query ini mencari **keadaan yang tidak seharusnya ada**, bukan menampilkan
data. Inilah pergeseran cara berpikir yang membedakan pengujian data yang reaktif dan yang proaktif.`,
          lab_ref: '/db-tester',
        },
      ],
    },
    {
      code: 'QA-DB-M2',
      title: 'Verifikasi CRUD & Integritas',
      summary: 'Membuktikan operasi tulis benar-benar tersimpan sesuai aturan.',
      order_index: 2,
      lessons: [
        {
          code: 'L-DB-03',
          title: 'Memverifikasi Create, Read, Update, Delete',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 1,
          content_md: `## Yang harus dibuktikan untuk setiap operasi tulis

Setiap operasi tulis memiliki serangkaian pemeriksaan yang sama. Menjadikannya checklist membuat Anda
tidak melewatkan hal penting.

### Checklist Create

| Pemeriksaan | Query / cara |
|---|---|
| Baris benar-benar dibuat | \`SELECT COUNT(*) FROM t WHERE id = ?\` |
| Jumlah tepat satu | Hasil \`COUNT\` harus 1, bukan ≥ 1 |
| Kolom terisi sesuai input | \`SELECT kolom FROM t WHERE id = ?\` |
| Kolom default terisi benar | Periksa kolom yang tidak dikirim klien |
| Timestamp masuk akal | \`created_at\` mendekati waktu sekarang, UTC |
| Relasi terbentuk | Periksa baris anak/induk terkait |
| Data turunan ikut terbuat | Misalnya keranjang → baris item |
| Tidak ada baris duplikat | Periksa seluruh kolom kunci, bukan hanya ID |

### Checklist Update

| Pemeriksaan | Alasan |
|---|---|
| Kolom yang diubah bernilai baru | Inti operasi |
| Kolom lain **tidak** berubah | Deteksi bug "update berlebihan" |
| \`updated_at\` berubah | Jejak audit |
| \`created_at\` tidak berubah | Bug umum: tertimpa oleh update |
| Baris lain tidak terpengaruh | Deteksi \`WHERE\` yang hilang |
| Perubahan tercermin di tabel terkait | Konsistensi |

Pemeriksaan "baris lain tidak terpengaruh" sangat penting. Bug \`UPDATE\` tanpa \`WHERE\` bisa mengubah
seluruh tabel, dan biasanya hanya terdeteksi dengan menghitung baris sebelum dan sesudah.

\`\`\`sql
-- SEBELUM
SELECT COUNT(*) AS total, COUNT(paid_at) AS berbayar FROM orders;

-- jalankan operasi pembayaran untuk satu pesanan

-- SESUDAH: total harus sama, berbayar bertambah tepat 1
SELECT COUNT(*) AS total, COUNT(paid_at) AS berbayar FROM orders;
\`\`\`

### Checklist Delete

| Pemeriksaan | Alasan |
|---|---|
| Baris hilang dari tabel utama | Inti operasi |
| Perilaku anak terdefinisi | Cascade atau set null — sesuai desain |
| Tidak ada baris yatim | Deteksi cascade yang salah |
| Soft delete benar | \`deleted_at\` terisi, baris masih ada |
| Data terkait ikut ditangani | Item keranjang, berkas, catatan |
| Tidak menghapus data lain | Deteksi \`WHERE\` hilang |

Perbedaan **hard delete** dan **soft delete** harus dipahami:

\`\`\`text
Hard delete : DELETE FROM users WHERE id = ?
              → baris benar-benar hilang; relasi bisa rusak

Soft delete : UPDATE users SET deleted_at = NOW() WHERE id = ?
              → baris tetap ada; semua query harus memfilter deleted_at IS NULL
\`\`\`

Untuk soft delete, ada pemeriksaan tambahan yang sering terlewat: **apakah semua query lain memfilter
data terhapus?** Bila ada satu endpoint yang lupa memfilter, user "terhapus" masih muncul.

\`\`\`sql
-- Deteksi kebocoran soft delete: user terhapus yang masih tampil di daftar
SELECT id, email, deleted_at
FROM users
WHERE deleted_at IS NOT NULL
  AND id IN (SELECT user_id FROM active_sessions);
\`\`\`

### Pemeriksaan batas: apa yang TIDAK boleh tersimpan

Pengujian data bukan hanya tentang apa yang tersimpan, tetapi juga apa yang **seharusnya ditolak**:

1. Panjang teks melebihi batas kolom.
2. Nilai yang melanggar constraint.
3. Data pribadi yang tersimpan tanpa enkripsi (bila dipersyaratkan).
4. Data duplikat pada kolom yang seharusnya unik.
5. Data dengan relasi yang tidak ada.

### Latihan

Ambil satu operasi tulis di aplikasi Anda dan jalankan seluruh checklist Create, Update, dan Delete.
Catat berapa pemeriksaan yang sebelumnya tidak pernah dilakukan tim.`,
          lab_ref: '/db-tester',
        },
        {
          code: 'L-DB-10',
          title: 'Latihan: Membuktikan Perilaku Soft Delete',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 3,
          content_md: `## Soft delete adalah sumber kebocoran yang paling sering luput

Menghapus data secara lunak (\`deleted_at\`) terlihat aman, tetapi ia memindahkan tanggung jawab penyaringan
ke **setiap query di seluruh aplikasi**. Satu query yang lupa memfilter, dan data "terhapus" muncul
kembali.

### Langkah 1 — Petakan seluruh tempat data muncul

| Tempat data muncul | Query/endpoint | Memfilter? |
|---|---|---|
| Daftar utama | \`GET /api/users\` | ? |
| Pencarian | \`GET /api/users?q=\` | ? |
| Detail langsung | \`GET /api/users/:id\` | ? |
| Ekspor laporan | \`GET /api/exports/users\` | ? |
| Autocomplete | \`GET /api/users/autocomplete\` | ? |
| Daftar relasi | \`GET /api/orders?user_id=\` | ? |
| Perhitungan agregat | Laporan bulanan | ? |
| Pencarian admin | Pencarian internal | ? |

Delapan tempat. Dalam praktik, tim biasanya mengingat tiga yang pertama dan melupakan lima sisanya —
terutama **ekspor**, **autocomplete**, dan **agregat**.

### Langkah 2 — Uji setiap tempat

\`\`\`text
1. Buat entitas uji, catat ID-nya.
2. Lakukan soft delete pada entitas itu.
3. Buka SETIAP tempat pada tabel di atas.
4. Harapan: entitas tidak muncul di mana pun (atau muncul sebagai "terhapus" bila desainnya begitu).
5. Catat setiap tempat yang masih menampilkannya.
\`\`\`

### Langkah 3 — Periksa jalur tidak langsung

Ini bagian yang paling sering melewatkan bug:

| Jalur | Yang diuji |
|---|---|
| Akses langsung via ID | \`GET /api/users/<id_terhapus>\` → harus 404 |
| Relasi | Pesanan milik user terhapus → apakah user tampil sebagai null? |
| Agregat | Jumlah user aktif tidak boleh menghitung yang terhapus |
| Unik | Bisakah email yang sama didaftarkan ulang setelah dihapus? |
| Pemulihan | Apakah ada jalur untuk memulihkan data terhapus? |
| Retensi | Apakah data terhapus benar-benar hilang setelah masa retensi? |

Pemeriksaan "unik" menarik: bila user dihapus lunak dan unique constraint masih berlaku, mendaftar ulang
dengan email yang sama akan gagal. Ini bug yang membingungkan bagi pengguna — akun mereka "tidak ada",
tetapi emailnya "sudah dipakai".

### Query verifikasi

\`\`\`sql
-- 1. Berapa banyak yang terhapus lunak
SELECT COUNT(*) FROM users WHERE deleted_at IS NOT NULL;

-- 2. Apakah ada user terhapus yang masih punya sesi aktif (kebocoran akses)
SELECT u.id, u.email FROM users u
WHERE u.deleted_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.expires_at > datetime('now'));

-- 3. Apakah agregat menghitung yang terhapus
SELECT COUNT(*) AS total_salah FROM orders o
JOIN users u ON u.id = o.user_id
WHERE u.deleted_at IS NOT NULL;      -- bandingkan dengan laporan aplikasi

-- 4. Apakah email terhapus masih memblokir pendaftaran baru
SELECT email FROM users WHERE deleted_at IS NOT NULL
  AND email IN (SELECT email FROM users WHERE deleted_at IS NULL);
\`\`\`

### Kriteria selesai

- Kedelapan tempat pada tabel diverifikasi satu per satu.
- Minimal enam jalur tidak langsung diuji.
- Setiap tempat yang masih menampilkan data terhapus dilaporkan sebagai defect dengan bukti.

### Refleksi

Soft delete tampak seperti fitur kecil, tetapi ia menyentuh hampir seluruh aplikasi. Inilah contoh
sempurna mengapa QA perlu memahami model data, bukan hanya antarmuka: kebocoran seperti ini tidak akan
pernah terlihat bila pengujian hanya menyentuh halaman utama.`,
          lab_ref: '/db-tester',
        },
        {
          code: 'L-DB-04',
          title: 'Constraint, Indeks & Integritas Referensial',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 2,
          content_md: `## Aturan yang seharusnya ditegakkan oleh database

Aplikasi bisa memiliki bug validasi. Database adalah lapisan terakhir yang bisa mencegah data rusak
tersimpan secara permanen. Karena itu QA perlu memeriksa apakah constraint benar-benar ada **dan
benar-benar berfungsi**.

### Jenis constraint dan cara mengujinya

| Constraint | Fungsi | Cara menguji |
|---|---|---|
| PRIMARY KEY | Keunikan identitas | Coba sisipkan ID duplikat |
| UNIQUE | Keunikan nilai bisnis | Sisipkan email yang sama dua kali |
| NOT NULL | Wajib terisi | Sisipkan tanpa nilai |
| CHECK | Aturan nilai | Sisipkan nilai di luar rentang |
| FOREIGN KEY | Relasi valid | Sisipkan anak dengan induk tidak ada |
| DEFAULT | Nilai bawaan | Sisipkan tanpa kolom tersebut |
| COMPOSITE UNIQUE | Keunikan gabungan | Kombinasi dua kolom sama |

### Uji UNIQUE — jangan hanya percaya pada tampilan

Validasi di UI bisa lolos, tetapi constraint di database adalah pertahanan sebenarnya:

\`\`\`sql
-- Harapan: ditolak dengan pelanggaran keunikan
INSERT INTO users (id, email, created_at) VALUES ('usr_x', 'sama@contoh.id', '2026-01-01');
INSERT INTO users (id, email, created_at) VALUES ('usr_y', 'sama@contoh.id', '2026-01-01');
\`\`\`

Poin penting: **uji juga variasi huruf besar-kecil dan spasi**.

\`\`\`text
sama@contoh.id
SAMA@contoh.id     ← apakah dianggap sama?
sama@contoh.id     ← spasi di belakang
 sama@contoh.id    ← spasi di depan
\`\`\`

Bila aplikasi menganggap keempatnya berbeda, Anda bisa mendaftarkan akun ganda dengan email yang
terlihat identik — masalah nyata yang sering ditemukan.

### Uji FOREIGN KEY

\`\`\`sql
-- Harapan: ditolak
INSERT INTO order_items (id, order_id, product_id, qty)
VALUES ('oi_x', 'ord_tidak_ada', 'prd_1', 1);
\`\`\`

Perilaku yang harus diperiksa saat menghapus induk:

| Aksi | Perilaku |
|---|---|
| \`ON DELETE CASCADE\` | Anak ikut terhapus |
| \`ON DELETE SET NULL\` | Anak tetap ada, kolom relasi menjadi NULL |
| \`ON DELETE RESTRICT\` | Penghapusan ditolak bila masih ada anak |
| Tanpa aksi | Tergantung konfigurasi; bisa menghasilkan baris yatim |

Setiap pilihan harus **disengaja** dan diuji. Yang paling berbahaya adalah konfigurasi default yang
menghasilkan baris yatim tanpa ada yang menyadari.

### Uji CHECK constraint

\`\`\`sql
-- Harapan: masing-masing ditolak
INSERT INTO products (id, price) VALUES ('prd_x', -100);       -- harga negatif
INSERT INTO orders   (id, status) VALUES ('ord_x', 'entah');   -- status di luar daftar
INSERT INTO users    (id, age) VALUES ('usr_x', 200);          -- usia tidak masuk akal
\`\`\`

Di beberapa database, tipe enum tidak tersedia sehingga validasi status bergantung pada constraint
CHECK. Bila tidak ada, nilai ngawur bisa tersimpan, dan aplikasi akan gagal saat membacanya.

### Indeks: memengaruhi performa dan keunikan

| Pemeriksaan indeks | Cara |
|---|---|
| Kolom pencarian utama punya indeks | Lihat rencana eksekusi \`EXPLAIN\` |
| Kolom unik punya indeks unik | Periksa definisi |
| Query umum tidak memindai seluruh tabel | Bandingkan waktu dengan 10 vs 10.000 baris |
| Indeks tidak berlebihan | Terlalu banyak indeks memperlambat tulis |

### Tabel pemeriksaan integritas yang bisa dipakai ulang

\`\`\`sql
-- 1. Nilai wajib yang kosong
SELECT COUNT(*) FROM users WHERE email IS NULL OR email = '';

-- 2. Duplikat pada kolom bisnis
SELECT email, COUNT(*) FROM users GROUP BY email HAVING COUNT(*) > 1;

-- 3. Anak tanpa induk
SELECT COUNT(*) FROM order_items oi
LEFT JOIN orders o ON o.id = oi.order_id WHERE o.id IS NULL;

-- 4. Nilai di luar rentang
SELECT COUNT(*) FROM order_items WHERE qty <= 0 OR qty > 999;

-- 5. Timestamp tidak logis
SELECT COUNT(*) FROM orders WHERE updated_at < created_at;
\`\`\`

Jalankan kumpulan query ini secara berkala. Mereka menemukan masalah yang tidak akan pernah muncul di
pengujian antarmuka.

### Latihan

Jalankan lima query pemeriksaan integritas di atas pada database staging Anda. Setiap baris yang
kembali bukan nol adalah temuan yang layak dilaporkan.`,
          lab_ref: '/db-tester',
        },
        {
          code: 'L-DB-11',
          title: 'Latihan: Menguji Constraint Sampai Batasnya',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 3,
          content_md: `## Constraint hanya berguna bila benar-benar menolak

Latihan ini menguji setiap constraint secara langsung di lapisan database, tanpa melewati validasi
aplikasi. Tujuannya memisahkan dua pertanyaan yang sering tercampur: "apakah aplikasi menolaknya?" dan
"apakah database menolaknya?".

### Mengapa keduanya harus diuji

| Kondisi | Arti |
|---|---|
| Aplikasi menolak, DB menolak | Aman berlapis — kondisi terbaik |
| Aplikasi menolak, DB menerima | Aman selama semua tulisan lewat aplikasi — berisiko bila ada skrip/impor |
| Aplikasi menerima, DB menolak | Pengalaman pengguna buruk: pesan error teknis |
| Keduanya menerima | Data rusak bisa tersimpan permanen |

Baris ketiga dan keempat keduanya adalah temuan.

### Matriks uji constraint

| Constraint | Uji | Harapan | Hasil | Lapisan |
|---|---|---|---|---|
| PRIMARY KEY | Sisipkan ID duplikat | Ditolak | ? | DB |
| UNIQUE (email) | Sisipkan email sama (huruf sama) | Ditolak | ? | DB |
| UNIQUE (email) | Sisipkan email sama (beda huruf besar-kecil) | Ditolak | ? | DB |
| UNIQUE (email) | Sisipkan email dengan spasi di ujung | Ditolak | ? | DB |
| NOT NULL | Sisipkan tanpa kolom wajib | Ditolak | ? | DB |
| CHECK (qty > 0) | Sisipkan qty = 0 | Ditolak | ? | DB |
| CHECK (harga >= 0) | Sisipkan harga negatif | Ditolak | ? | DB |
| FOREIGN KEY | Sisipkan anak dengan induk tidak ada | Ditolak | ? | DB |
| FK ON DELETE | Hapus induk yang punya anak | Cascade/restrict | ? | DB |
| DEFAULT | Sisipkan tanpa kolom berdefault | Nilai bawaan terisi | ? | DB |

### Perhatikan pemeriksaan keunikan

Pemeriksaan dua, tiga, dan empat pada tabel di atas menguji hal yang berbeda:

\`\`\`sql
-- 2. huruf identik
INSERT INTO users (id, email, created_at) VALUES ('u1', 'sama@contoh.id', '2026-01-01');
INSERT INTO users (id, email, created_at) VALUES ('u2', 'sama@contoh.id', '2026-01-01');
-- harapan: ditolak

-- 3. beda huruf besar-kecil
INSERT INTO users (id, email, created_at) VALUES ('u3', 'SAMA@CONTOH.ID', '2026-01-01');
-- harapan: ditolak (bila sistem menganggap email tidak peka huruf besar-kecil)

-- 4. spasi di ujung
INSERT INTO users (id, email, created_at) VALUES ('u4', ' sama@contoh.id ', '2026-01-01');
-- harapan: ditolak atau dinormalisasi
\`\`\`

Bila nomor 3 dan 4 diterima, seorang pengguna dapat membuat beberapa akun yang **terlihat identik**.
Dampaknya nyata: penipuan, kebingungan dukungan, dan laporan yang tidak akurat.

Perbaikannya biasanya bukan sekadar menambah constraint, melainkan menormalkan nilai (huruf kecil, trim)
sebelum disimpan, lalu memberi constraint unik pada kolom yang sudah dinormalkan.

### Uji perilaku penghapusan induk

Untuk setiap relasi, tentukan perilaku yang diinginkan lalu uji:

\`\`\`text
Hapus order yang memiliki order_items:
  - CASCADE   → order_items ikut terhapus   (harapan untuk data anak murni)
  - SET NULL  → order_items tetap ada, order_id menjadi NULL (jarang diinginkan)
  - RESTRICT  → penghapusan ditolak          (harapan untuk data referensi)
  - (tanpa aksi) → bergantung konfigurasi; sering menghasilkan baris yatim

Uji  : hapus satu order, lalu periksa order_items terkait
Bukti: SELECT COUNT(*) FROM order_items WHERE order_id = '<order_dihapus>';
\`\`\`

### Kriteria selesai

- Seluruh sepuluh baris matriks diisi dengan hasil nyata.
- Setiap perbedaan antara perilaku aplikasi dan perilaku database dicatat.
- Minimal satu temuan normalisasi (huruf besar-kecil atau spasi) dilaporkan dengan bukti.

### Refleksi

Pengujian di lapisan database sering menemukan hal yang tidak bisa ditemukan dari antarmuka: nilai yang
tidak dinormalkan, constraint yang hilang, dan perilaku penghapusan yang tidak disengaja. Inilah nilai
tambahan dari memeriksa data secara langsung.`,
          lab_ref: '/db-tester',
        },
      ],
    },
    {
      code: 'QA-DB-M3',
      title: 'Transaksi & Konkurensi',
      summary: 'ACID, tingkat isolasi, deadlock, dan pengujian kondisi balapan.',
      order_index: 3,
      lessons: [
        {
          code: 'L-DB-05',
          title: 'Transaksi & Isolasi',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 1,
          content_md: `## Mengapa QA perlu memahami transaksi

Bug transaksi adalah kelas bug yang paling sulit ditemukan dan paling mahal akibatnya: data setengah
tersimpan, saldo tidak seimbang, pesanan tanpa pembayaran. Semuanya hanya muncul ketika sesuatu gagal
di tengah jalan atau ketika dua operasi berjalan bersamaan.

### ACID dalam bahasa praktis

| Sifat | Arti praktis | Yang diuji QA |
|---|---|---|
| **Atomicity** | Semua langkah berhasil atau tidak sama sekali | Gagalkan langkah terakhir, periksa tidak ada sisa data |
| **Consistency** | Data selalu memenuhi aturan | Periksa constraint setelah operasi gagal |
| **Isolation** | Transaksi bersamaan tidak saling mengganggu | Jalankan dua operasi bersamaan pada data sama |
| **Durability** | Data tersimpan permanen setelah commit | Restart layanan, periksa data masih ada |

### Menguji atomicity: cara yang paling praktis

Ambil operasi multi-langkah (misalnya pembuatan pesanan yang menyentuh 3 tabel), lalu buat langkah
terakhir gagal dengan sengaja:

\`\`\`text
Cara membuat gagal:
  1. Kirim data yang melanggar constraint pada langkah terakhir
  2. Matikan layanan eksternal yang dipanggil di tengah alur
  3. Batalkan request (timeout) di tengah proses

Yang diperiksa setelah kegagalan:
  SELECT COUNT(*) FROM orders      WHERE user_id = 'usr_123';   -- harapan: tidak bertambah
  SELECT COUNT(*) FROM order_items WHERE order_id = <baru>;     -- harapan: tidak ada
  SELECT COUNT(*) FROM promo_usages WHERE user_id = 'usr_123';  -- harapan: tidak bertambah
\`\`\`

Bila ada sisa data setelah kegagalan, transaksi tidak dikelola dengan benar. Ini temuan serius.

### Tingkat isolasi dan anomali yang dicegahnya

| Tingkat | Dirty read | Non-repeatable read | Phantom read |
|---|---|---|---|
| Read uncommitted | mungkin | mungkin | mungkin |
| Read committed | tidak | mungkin | mungkin |
| Repeatable read | tidak | tidak | mungkin |
| Serializable | tidak | tidak | tidak |

Arti anomali dalam bahasa sehari-hari:

- **Dirty read** — membaca data yang belum di-commit dan mungkin dibatalkan.
- **Non-repeatable read** — membaca nilai yang sama dua kali dalam satu transaksi dan mendapat hasil
  berbeda karena transaksi lain mengubahnya.
- **Phantom read** — menjalankan query yang sama dua kali dan jumlah barisnya berubah.

### Menguji konkurensi secara praktis

Pengujian ini memerlukan pengiriman request **bersamaan**, bukan berurutan:

\`\`\`text
Skenario 1 — Stok terbatas
  Persediaan: 1 unit
  Kirim 2 request checkout bersamaan
  Benar: satu sukses, satu ditolak (409)
  Bug  : keduanya sukses → stok menjadi -1

Skenario 2 — Kuota promo
  Kuota: 100 pemakaian
  Kirim 10 request bersamaan pada kuota sisa 1
  Benar: satu berhasil
  Bug  : beberapa berhasil → kuota terlampaui

Skenario 3 — Saldo dompet
  Saldo: 100.000
  Kirim 2 penarikan 80.000 bersamaan
  Benar: satu sukses, satu ditolak
  Bug  : keduanya sukses → saldo negatif

Skenario 4 — Edit bersamaan
  Dua tab membuka data yang sama, keduanya menyimpan
  Benar: yang kedua ditolak (409) atau digabung
  Bug  : perubahan pertama hilang tanpa pemberitahuan
\`\`\`

Skenario 4 disebut **lost update** dan sangat sering terjadi pada aplikasi yang diedit dari beberapa
tab. Solusi umumnya adalah penomoran versi atau penguncian optimistik.

### Tanda-tanda masalah transaksi yang bisa dikenali QA

1. Data sisa setelah operasi gagal.
2. Saldo/kuota bisa menjadi negatif.
3. Perubahan hilang ketika dua pengguna mengedit bersamaan.
4. Operasi yang sama menghasilkan jumlah baris berbeda pada eksekusi paralel.
5. Laporan keuangan tidak cocok dengan detail transaksi.

### Latihan

Ambil satu operasi yang menyentuh minimal tiga tabel. Buat langkah terakhirnya gagal secara sengaja,
lalu periksa apakah ada data sisa. Ulangi dengan mengirim dua request bersamaan pada data yang sama.`,
          lab_ref: '/db-tester',
        },
        {
          code: 'L-DB-12',
          title: 'Latihan: Memburu Kondisi Balapan',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 3,
          content_md: `## Kondisi balapan tidak bisa ditemukan dengan pengujian berurutan

Ini kelas bug yang paling sering lolos ke produksi, karena pengujian normal menjalankan satu permintaan
pada satu waktu. Bug ini hanya muncul ketika dua operasi berjalan bersamaan, dan biasanya menghasilkan
kerusakan data yang tidak bisa dibatalkan.

### Langkah 1 — Temukan kandidat

Cari operasi yang memenuhi minimal dua syarat berikut:

| Sinyal | Contoh |
|---|---|
| Ada sumber daya terbatas | Stok, kuota promo, kursi, saldo |
| Ada pemeriksaan lalu penulisan | "Cek stok → kurangi stok" |
| Bisa dipicu dua kali oleh pengguna | Klik ganda, dua tab, dua perangkat |
| Ada nilai yang dihitung dari nilai sebelumnya | Saldo, penghitung, versi |
| Ada status yang berubah | Checkout ganda, refund ganda |

### Langkah 2 — Rancang skenario konkret

\`\`\`text
Skenario A — Kuota promo
  Prasyarat : kuota kode PROMO10 tersisa 1 pemakaian
  Aksi      : kirim 5 permintaan pemakaian PROMO10 secara bersamaan
  Benar     : tepat 1 berhasil, 4 ditolak dengan pesan yang jelas
  Bukti     : SELECT used_count, max_usage FROM promos WHERE code = 'PROMO10';
              SELECT COUNT(*) FROM promo_usages WHERE promo_code = 'PROMO10';

Skenario B — Stok barang
  Prasyarat : stok SKU-001 = 1
  Aksi      : 2 checkout bersamaan untuk SKU-001
  Benar     : 1 sukses, 1 gagal dengan 409 "stok habis"
  Bukti     : SELECT stock FROM products WHERE sku = 'SKU-001';   -- tidak boleh negatif

Skenario C — Saldo dompet
  Prasyarat : saldo Rp100.000
  Aksi      : 2 penarikan @ Rp80.000 bersamaan
  Benar     : 1 sukses, 1 ditolak
  Bukti     : SELECT balance FROM wallets WHERE user_id = '<id>';  -- tidak boleh negatif

Skenario D — Edit bersamaan (lost update)
  Prasyarat : satu entri data, dua sesi/tab terbuka
  Aksi      : kedua tab mengubah field berbeda lalu menyimpan
  Benar     : perubahan kedua ditolak (409) atau digabung tanpa kehilangan
  Bukti     : bandingkan nilai akhir dengan kedua perubahan yang dikirim

Skenario E — Checkout ganda
  Prasyarat : satu keranjang valid
  Aksi      : kirim POST pembuatan pesanan dua kali hampir bersamaan
  Benar     : hanya satu pesanan tercipta
  Bukti     : SELECT COUNT(*) FROM orders WHERE user_id = '<id>' AND created_at > '<waktu>';
\`\`\`

### Langkah 3 — Kirim permintaan secara bersamaan

Kunci dari latihan ini: permintaan harus **benar-benar bersamaan**, bukan berurutan. Bila dikirim satu
per satu, bug tidak akan muncul meski aplikasinya rusak.

\`\`\`text
Pendekatan 1 — Paralel sederhana
  Buat 5 permintaan, jalankan dengan Promise.all sehingga dikirim pada saat yang sama.

Pendekatan 2 — Pengulangan untuk meningkatkan peluang
  Ulangi skenario 10–20 kali; kondisi balapan bersifat probabilistik,
  sehingga satu kali percobaan sering tidak cukup untuk memunculkannya.

Pendekatan 3 — Perbesar jendela balapan
  Bila aplikasi punya titik lambat (misalnya panggilan layanan eksternal),
  kirim permintaan tepat sebelum titik itu. Jendela yang lebih lebar
  membuat bug jauh lebih mudah muncul.
\`\`\`

### Langkah 4 — Periksa bukti kerusakan

Yang membedakan laporan kuat dan lemah adalah bukti kerusakannya:

| Skenario | Bukti kuat |
|---|---|
| A | \`used_count\` > \`max_usage\`, atau jumlah baris \`promo_usages\` > kuota |
| B | \`stock\` bernilai negatif |
| C | \`balance\` bernilai negatif, atau jumlah penarikan melebihi saldo |
| D | Nilai akhir tidak memuat salah satu perubahan yang dikirim |
| E | Dua baris pesanan dengan \`cart_id\` yang sama |

### Langkah 5 — Laporkan dengan benar

Kondisi balapan sulit dipercaya tanpa bukti. Laporan harus memuat:

\`\`\`text
1. Jumlah percobaan dan berapa kali bug muncul (mis. "muncul 3 dari 20 percobaan")
2. Cara persis pengiriman bersamaan (skrip/perintah yang bisa dijalankan ulang)
3. Query bukti kerusakan beserta hasilnya
4. Dampak bisnis: apa yang bisa dilakukan penyalahguna?
5. Perkiraan perbaikan: penguncian, pengecekan atomik, atau idempotency key
\`\`\`

Poin pertama sangat penting. Menyebutkan "muncul 3 dari 20 percobaan" membuat developer tahu ini nyata
dan bukan kebetulan.

### Kriteria selesai

- Minimal tiga skenario dari daftar diuji dengan permintaan bersamaan.
- Setiap skenario diulang minimal 10 kali.
- Setiap kerusakan dibuktikan dengan query, bukan dengan dugaan.
- Setiap temuan dilaporkan dengan rasio kemunculan.

### Refleksi

Kondisi balapan adalah alasan paling kuat mengapa QA perlu memahami transaksi dan konkurensi, bukan hanya
antarmuka. Bug ini tidak muncul di pengujian mana pun yang berjalan berurutan — dan ketika muncul di
produksi, kerusakan datanya biasanya sudah terjadi pada banyak pengguna.`,
          lab_ref: '/db-tester',
        },
        {
          code: 'L-DB-06',
          title: 'Pengujian Migrasi & Perubahan Skema',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 2,
          content_md: `## Migrasi adalah titik paling berisiko dalam siklus rilis

Migrasi mengubah struktur data yang sudah berisi jutaan baris nyata. Kesalahan migrasi bisa
menghilangkan data secara permanen, dan biasanya tidak terdeteksi sampai produksi.

### Mengapa migrasi layak diuji secara khusus

| Karakteristik | Konsekuensi |
|---|---|
| Berjalan sekali | Kesalahan tidak bisa "dicoba lagi" |
| Menyentuh data nyata | Kehilangan data bersifat permanen |
| Bergantung pada volume | Berjalan cepat di data kecil, lambat di data besar |
| Sulit dibalik | Rollback belum tentu aman |
| Tidak tercakup tes fungsional | Tes memakai skema baru, bukan transisinya |

### Checklist pengujian migrasi

| Pemeriksaan | Cara |
|---|---|
| Migrasi berjalan dari nol | Buat database kosong, jalankan semua migrasi |
| Migrasi idempoten | Jalankan dua kali, pastikan tidak gagal |
| Data lama tetap ada | Bandingkan jumlah baris sebelum dan sesudah |
| Nilai kolom baru benar | Periksa pengisian nilai bawaan |
| Relasi tidak rusak | Jalankan query integritas setelah migrasi |
| Performa dapat diterima | Ukur durasi pada salinan data berukuran produksi |
| Rollback berfungsi | Jalankan rollback, periksa skema dan data |
| Kode lama tetap berjalan | Jalankan aplikasi versi lama terhadap skema baru |

### Pola migrasi yang aman dan tidak

**Aman:**

\`\`\`text
1. Tambah kolom baru sebagai nullable            (kode lama tetap jalan)
2. Isi nilai kolom baru lewat proses bertahap    (bisa dijalankan berulang)
3. Ubah kode aplikasi untuk memakai kolom baru
4. Jadikan kolom NOT NULL setelah data terisi
5. Hapus kolom lama pada rilis berikutnya
\`\`\`

**Berbahaya:**

\`\`\`text
- Menghapus kolom yang masih dipakai kode lama
- Mengubah tipe kolom tanpa konversi data
- Menambah kolom NOT NULL tanpa nilai bawaan pada tabel berisi data
- Mengganti nama kolom secara langsung
- Menjalankan migrasi berat tanpa perkiraan durasi
\`\`\`

Contoh bug nyata dari penambahan kolom NOT NULL tanpa nilai bawaan:

\`\`\`sql
-- Tabel users berisi 500.000 baris
ALTER TABLE users ADD COLUMN locale TEXT NOT NULL;
-- Hasil: migrasi gagal, atau semua baris terisi string kosong yang tidak valid
\`\`\`

### Memeriksa integritas setelah migrasi

Setelah setiap migrasi, jalankan kumpulan query pemeriksaan:

\`\`\`sql
-- 1. Jumlah baris tidak berkurang
SELECT COUNT(*) FROM users;                    -- bandingkan dengan sebelum

-- 2. Kolom baru terisi wajar
SELECT COUNT(*) AS kosong FROM users WHERE locale IS NULL OR locale = '';

-- 3. Tidak ada kerusakan relasi
SELECT COUNT(*) FROM orders o
LEFT JOIN users u ON u.id = o.user_id WHERE u.id IS NULL;

-- 4. Nilai terkonversi benar
SELECT COUNT(*) FROM orders WHERE created_at IS NULL;
\`\`\`

### Menguji dengan volume yang realistis

Migrasi yang berjalan 2 detik pada 1.000 baris bisa berjalan 20 menit pada 10 juta baris. Karena itu:

1. Buat salinan database dengan volume mendekati produksi.
2. Ukur durasi migrasi.
3. Tentukan apakah perlu jendela pemeliharaan (*maintenance window*).
4. Rencanakan perilaku aplikasi **selama** migrasi berjalan.

Pertanyaan yang harus dijawab: apakah aplikasi tetap melayani permintaan selama migrasi? Bila tidak,
berapa lama layanan tidak tersedia?

### Latihan

Ambil migrasi terakhir di proyek Anda. Jalankan pada database kosong, lalu pada salinan berisi data.
Periksa jumlah baris sebelum dan sesudah, dan ukur durasinya.`,
          lab_ref: '/db-tester',
        },
        {
          code: 'L-DB-13',
          title: 'Latihan: Rencana Uji Migrasi & Rollback',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 3,
          content_md: `## Rencana yang harus ada sebelum migrasi dijalankan

Migrasi yang gagal di produksi bukan masalah teknis semata — ia masalah **perencanaan**. Latihan ini
menghasilkan dokumen yang bisa langsung dipakai tim sebelum migrasi berikutnya.

### Bagian 1 — Deskripsi perubahan

| Aspek | Isi |
|---|---|
| Perubahan | Menambah kolom \`refunded_amount\` pada tabel \`orders\` |
| Alasan | Mendukung fitur refund sebagian |
| Tabel terpengaruh | \`orders\` (500.000 baris) |
| Kolom baru | \`refunded_amount REAL NOT NULL DEFAULT 0\` |
| Kode yang bergantung | Endpoint pembayaran, laporan keuangan, ekspor |
| Perkiraan durasi | ? (ukur pada salinan berukuran produksi) |
| Perlu downtime? | ? (tentukan setelah pengukuran) |

### Bagian 2 — Strategi bertahap

Rencana yang aman memecah perubahan menjadi langkah-langkah kecil yang dapat dijalankan berulang:

\`\`\`text
Langkah 1 (rilis A) — Tambah kolom sebagai nullable
  ALTER TABLE orders ADD COLUMN refunded_amount REAL;
  Dampak : kode lama tidak terpengaruh; kolom berisi NULL

Langkah 2 (skrip terpisah) — Isi nilai awal secara bertahap
  UPDATE orders SET refunded_amount = 0
  WHERE refunded_amount IS NULL
    AND id IN (SELECT id FROM orders WHERE refunded_amount IS NULL LIMIT 10000);
  Diulang hingga selesai — menghindari satu transaksi raksasa

Langkah 3 (rilis B) — Kode mulai memakai kolom baru
  Aplikasi menulis dan membaca refunded_amount

Langkah 4 (rilis C) — Tegakkan NOT NULL + default
  Setelah tidak ada NULL tersisa, ubah kolom menjadi NOT NULL DEFAULT 0

Langkah 5 (rilis D) — Hapus kolom lama bila ada
\`\`\`

Mengapa bertahap? Karena setiap langkah dapat dijalankan dan diverifikasi sendiri, dan **rollback menjadi
mungkin** — sesuatu yang tidak berlaku pada \`ALTER TABLE\` besar yang dijalankan sekali.

### Bagian 3 — Verifikasi sebelum dan sesudah

\`\`\`sql
-- SEBELUM migrasi: catat baseline
SELECT COUNT(*) AS total FROM orders;
SELECT COUNT(*) AS nilai_null FROM orders WHERE refunded_amount IS NULL;

-- SESUDAH langkah 1
SELECT COUNT(*) AS total FROM orders;              -- harus sama dengan baseline
SELECT COUNT(*) AS nilai_null FROM orders WHERE refunded_amount IS NULL;  -- semua baris NULL

-- SESUDAH langkah 2
SELECT COUNT(*) AS sisa_null FROM orders WHERE refunded_amount IS NULL;   -- harus 0

-- SESUDAH langkah 4
SELECT COUNT(*) AS negatif FROM orders WHERE refunded_amount < 0;         -- harus 0
SELECT COUNT(*) FROM orders
WHERE refunded_amount > total_amount;                                     -- harus 0 (aturan bisnis)

-- Integritas menyeluruh
SELECT COUNT(*) FROM orders o
LEFT JOIN users u ON u.id = o.user_id WHERE u.id IS NULL;                 -- harus 0
\`\`\`

### Bagian 4 — Rencana rollback

| Langkah | Cara rollback | Aman? |
|---|---|---|
| 1 tambah kolom | Hapus kolom | Aman — tidak ada kode yang memakainya |
| 2 isi nilai | Tidak perlu; nilai default tetap benar | Aman |
| 3 kode memakai kolom | Kembalikan versi kode lama | Aman — kolom tetap ada |
| 4 tegakkan NOT NULL | Hapus constraint | Aman |
| 5 hapus kolom lama | **Tidak dapat dirollback** | Berbahaya — tunggu 2 siklus |

Baris terakhir adalah alasan aturan industri: **jangan pernah menghapus data pada rilis yang sama dengan
yang mengubah kode**. Beri jarak minimal dua siklus agar rollback tetap mungkin.

### Bagian 5 — Rencana selama migrasi berjalan

| Pertanyaan | Jawaban yang harus ditentukan |
|---|---|
| Apakah layanan tetap melayani permintaan? | Ya / tidak |
| Bila tidak, berapa lama downtime? | … menit |
| Bagaimana perilaku aplikasi versi lama? | Tetap jalan / error |
| Siapa yang memantau? | Nama & kontak |
| Apa pemicu pembatalan? | Kondisi konkret (mis. durasi > 10 menit) |
| Bagaimana membatalkan? | Perintah rollback yang sudah diuji |

### Kriteria selesai

- Kelima bagian terisi untuk satu migrasi nyata.
- Perubahan dipecah menjadi minimal empat langkah yang dapat dijalankan berulang.
- Query verifikasi sebelum/sesudah ditulis dan dijalankan pada salinan berisi data.
- Rollback setiap langkah dinilai aman atau berbahaya, dengan alasan.
- Durasi migrasi diukur pada data berukuran realistis.

### Refleksi

Perhatikan bahwa seluruh dokumen ini ditulis **sebelum** migrasi dijalankan. Itulah bedanya pengujian
migrasi dan penyesalan migrasi: yang pertama menghabiskan satu jam persiapan, yang kedua menghabiskan
satu malam memperbaiki data yang hilang.`,
          lab_ref: '/db-tester',
        },
      ],
    },
    {
      code: 'QA-DB-M4',
      title: 'Alur Verifikasi Data Terpadu',
      summary: 'Menggabungkan API, UI, dan database menjadi satu alur pembuktian.',
      order_index: 4,
      lessons: [
        {
          code: 'L-DB-07',
          title: 'Menghubungkan Bukti API, UI, dan Database',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 1,
          content_md: `## Tiga saksi untuk satu kebenaran

Satu operasi bisnis bisa diamati di tiga tempat: antarmuka, API, dan database. Ketiganya bisa
memberikan jawaban **berbeda**, dan justru perbedaan itulah yang paling sering menunjuk akar masalah.

### Contoh alur lengkap dengan verifikasi berlapis

Misalkan user menambahkan komentar pada sebuah pesanan.

\`\`\`text
LANGKAH 1 — Lapisan UI
  Aksi  : ketik komentar, klik Kirim
  Bukti : komentar tampil di daftar dengan nama dan waktu yang benar

LANGKAH 2 — Lapisan API
  GET /api/orders/ord_456/comments
  Bukti : { "data": [ { "id": "cmt_1", "body": "...", "author": {...},
                        "created_at": "..." } ], "total": 1 }
  Diperiksa: jumlah tepat 1, body sama persis, penulis benar

LANGKAH 3 — Lapisan Database
  SELECT id, order_id, user_id, body, created_at, deleted_at
  FROM comments WHERE order_id = 'ord_456';
  Bukti : 1 baris, deleted_at IS NULL, body identik, created_at wajar

LANGKAH 4 — Efek samping
  SELECT COUNT(*) FROM activity_log
  WHERE entity_id = 'ord_456' AND action = 'comment_created';   -- harapan: 1

LANGKAH 5 — Notifikasi
  SELECT COUNT(*) FROM notifications
  WHERE ref_id = 'cmt_1' AND type = 'order_comment';            -- harapan: sesuai aturan
\`\`\`

Lima lapisan pemeriksaan untuk satu aksi. Inilah yang dimaksud "menghubungkan bukti": setiap lapisan
memverifikasi aspek yang tidak bisa dilihat lapisan lain.

### Tabel: apa yang hanya bisa dibuktikan di tiap lapisan

| Lapisan | Hanya bisa dibuktikan di sini |
|---|---|
| UI | Tata letak, keterbacaan, alur pengguna, keadaan tombol |
| API | Kontrak, status code, struktur respons, otorisasi |
| Database | Persistensi, integritas relasi, nilai tersimpan, efek samping |
| Log | Jejak audit, penelusuran, korelasi permintaan |

Ketika sebuah bug dilaporkan, pertanyaan pertama yang berguna adalah: **di lapisan mana perilaku itu
menyimpang?** Jawabannya mempersempit lokasi bug secara drastis.

### Empat pola ketidakcocokan yang paling sering muncul

| Pola | Gejala | Arti |
|---|---|---|
| UI benar, API salah | Nilai tampil benar padahal respons salah | Ada perhitungan di sisi klien yang menutupi bug |
| API benar, DB salah | Respons sukses, data tidak sesuai | Bug di lapisan penyimpanan |
| UI salah, API benar | Nilai tampil salah padahal data benar | Bug tampilan atau pemetaan |
| Ketiganya benar, efek samping hilang | Tidak ada log/notifikasi | Bug di alur lanjutan |

### Menyusun bukti untuk laporan bug lintas lapisan

Bukti yang paling kuat adalah bukti yang menunjukkan perbedaan antar lapisan:

\`\`\`text
BUG-021: Notifikasi email tidak terkirim walau komentar tersimpan

Lapisan UI   : komentar tampil normal
Lapisan API  : POST /comments → 201, body benar
Lapisan DB   : 1 baris di comments, benar
Efek samping : 0 baris di notifications untuk cmt_1

Kesimpulan   : komentar tersimpan, tetapi pembuatan notifikasi tidak terjadi.
               Bukan bug penyimpanan; bug di alur pasca-simpan.
\`\`\`

Laporan seperti ini memangkas waktu investigasi developer dari jam menjadi menit.

### Latihan

Pilih satu aksi tulis di aplikasi Anda dan susun lima lapisan pemeriksaan seperti contoh di atas.
Jalankan dan catat lapisan mana yang paling sering menyimpang.`,
          lab_ref: '/db-tester',
        },
        {
          code: 'L-DB-08',
          title: 'Lab: Alur Verifikasi Data End-to-End',
          kind: 'lab',
          duration_minutes: 40,
          order_index: 2,
          content_md: `## Tujuan lab

Menjalankan satu operasi tulis lintas lapisan dan membuktikan kebenarannya di UI, API, dan database.

## Skenario

Membuat pesanan dengan kode promo, membayarnya, lalu memverifikasi seluruh efek samping.

## Langkah

1. **Siapkan data uji.** Buat akun pembeli unik dan catat ID-nya. Siapkan kode promo yang valid,
   satu kode kedaluwarsa, dan satu akun yang sudah memakai kode tersebut.

2. **Jalankan lewat UI.** Buka halaman checkout, tambahkan dua item, terapkan kode promo, dan
   selesaikan pembayaran. Catat seluruh nilai yang tampil.

3. **Verifikasi lewat API.** Ambil pesanan memakai endpoint detail dan bandingkan setiap nilai dengan
   yang Anda lihat di UI:

\`\`\`text
Nilai yang dibandingkan:
  - total pesanan
  - jumlah diskon
  - kode promo yang tercatat
  - status pesanan
  - waktu pembayaran
\`\`\`

4. **Verifikasi lewat database.** Tulis dan jalankan query berikut:

\`\`\`sql
-- 1. Pesanan utama
SELECT id, user_id, total_amount, discount_amount, promo_code, status, created_at, paid_at
FROM orders WHERE user_id = '<id_pembeli>';

-- 2. Item pesanan
SELECT product_id, qty, price, (qty * price) AS subtotal
FROM order_items WHERE order_id = '<id_pesanan>';

-- 3. Jumlah item harus cocok dengan total
SELECT SUM(qty * price) AS total_item FROM order_items WHERE order_id = '<id_pesanan>';

-- 4. Pemakaian promo tercatat tepat sekali
SELECT COUNT(*) AS n FROM promo_usages
WHERE promo_code = '<kode>' AND user_id = '<id_pembeli>';

-- 5. Kuota promo berkurang tepat satu
SELECT used_count, max_usage FROM promos WHERE code = '<kode>';

-- 6. Tidak ada pesanan duplikat
SELECT COUNT(*) AS n FROM orders
WHERE user_id = '<id_pembeli>' AND created_at > '<waktu_mulai_lab>';

-- 7. Konsistensi lintas tabel
SELECT o.id, o.total_amount, p.amount
FROM orders o JOIN payments p ON p.order_id = o.id
WHERE o.id = '<id_pesanan>';

-- 8. Keadaan mustahil
SELECT COUNT(*) FROM orders
WHERE id = '<id_pesanan>' AND status = 'paid' AND paid_at IS NULL;
\`\`\`

5. **Uji pengiriman ulang.** Kirim ulang request POST pembuatan pesanan yang sama. Periksa apakah
   tercipta pesanan kedua (harapan: tidak, karena pesanan sudah ada).

6. **Uji kode kedaluwarsa.** Ulangi alur dengan kode kedaluwarsa dan pastikan tidak ada baris baru yang
   tercipta di tabel pesanan.

## Tabel bukti yang harus diisi

| Pemeriksaan | Lapisan | Hasil diharapkan | Hasil teramati | Simpulan |
|---|---|---|---|---|
| Total pesanan | UI / API / DB | 540000 | … | … |
| Jumlah diskon | DB | 60000 | … | … |
| Pemakaian promo | DB | 1 | … | … |
| Kuota promo | DB | berkurang 1 | … | … |
| Duplikat pesanan | DB | 0 | … | … |
| Konsistensi pembayaran | DB | sama | … | … |

## Kriteria selesai

- Setiap baris tabel bukti terisi dengan hasil nyata, bukan asumsi.
- Minimal satu query lintas tabel dijalankan.
- Minimal satu pemeriksaan efek samping dijalankan.
- Setiap ketidakcocokan antar lapisan dilaporkan sebagai temuan dengan bukti.

## Refleksi

Perhatikan berapa banyak masalah yang hanya terlihat di lapisan database. Inilah alasan mengapa
pengujian manual yang hanya menyentuh antarmuka tidak pernah cukup untuk aplikasi yang mengelola data
penting.`,
          lab_ref: '/db-tester',
        },
        {
          code: 'L-DB-14',
          title: 'Latihan: Laporan Bukti Data untuk Manajemen',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 3,
          content_md: `## Ketika temuan data harus meyakinkan orang non-teknis

Temuan pengujian database sering kali paling penting — kebocoran data, uang yang tidak seimbang, integritas
yang rusak — tetapi juga paling sulit dijelaskan kepada manajemen. Latihan ini melatih penyampaiannya.

### Mengapa temuan data sering diabaikan

| Penyebab | Gejala | Perbaikan |
|---|---|---|
| Bukti berupa query mentah | Pembaca tidak paham | Sertakan tabel hasil yang sudah dirangkum |
| Dampak tidak disebutkan | Dianggap masalah teknis kecil | Sebutkan jumlah pengguna/transaksi terdampak |
| Tidak ada perkiraan biaya | Sulit diprioritaskan | Perkirakan kerugian atau waktu perbaikan manual |
| Terlalu banyak detail | Pokok masalah tenggelam | Ringkasan 3 baris di depan |

### Kerangka laporan tiga lapis

**Lapis 1 — Ringkasan (3 baris, untuk eksekutif).**

\`\`\`text
Membandingkan total pesanan dengan detail itemnya menemukan 1.247 pesanan
(3,1% dari pesanan bulan ini) yang totalnya tidak sesuai dengan jumlah itemnya.
Selisih rata-rata Rp18.400; total selisih sekitar Rp22,9 juta.
Penyebab: perhitungan ulang tidak dijalankan ketika item dihapus dari pesanan.
\`\`\`

**Lapis 2 — Dampak bisnis (untuk manajer).**

| Aspek | Nilai |
|---|---|
| Pesanan terdampak | 1.247 (3,1%) |
| Selisih rata-rata | Rp18.400 |
| Total selisih | ≈ Rp22,9 juta |
| Arah selisih | Campuran (623 kurang tagih, 624 lebih tagih) |
| Risiko kepatuhan | Laporan keuangan tidak akurat |
| Beban operasional | Perlu koreksi manual bila tidak diperbaiki |

Arah selisih wajib disebutkan. "Lebih tagih" berarti pelanggan dirugikan dan itu berisiko reputasi;
"kurang tagih" berarti pendapatan hilang. Keduanya butuh respons berbeda.

**Lapis 3 — Bukti teknis (untuk tim engineering).**

\`\`\`sql
-- Query bukti
SELECT COUNT(*) AS jumlah_tidak_konsisten FROM (
  SELECT o.id
  FROM orders o JOIN order_items oi ON oi.order_id = o.id
  GROUP BY o.id, o.total_amount
  HAVING o.total_amount <> SUM(oi.qty * oi.price)
);

-- Lima contoh untuk penyelidikan
SELECT o.id, o.code, o.total_amount, SUM(oi.qty * oi.price) AS hitung_ulang
FROM orders o JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id, o.code, o.total_amount
HAVING o.total_amount <> SUM(oi.qty * oi.price)
LIMIT 5;
\`\`\`

### Aturan penyajian hasil query

| Jangan | Lakukan |
|---|---|
| Tempel 1.247 baris hasil | Tampilkan jumlah + 5 contoh |
| Tulis "data tidak konsisten" | Sebutkan angka selisih dan jumlah baris |
| Sebutkan nama tabel saja | Sebutkan dampak ke pengguna/keuangan |
| Tidak menyebut penyebab | Sertakan dugaan akar penyebab |

### Menyertakan pertanyaan yang harus dijawab

Laporan yang baik mengarahkan pembaca ke keputusan. Sertakan 2–3 pertanyaan:

\`\`\`text
1. Apakah 1.247 pesanan perlu dikoreksi manual, atau cukup diperbaiki untuk transaksi ke depan?
2. Siapa yang berwenang menyetujui koreksi data keuangan?
3. Apakah perlu pemberitahuan ke pelanggan yang ditagih lebih?
\`\`\`

Pertanyaan-pertanyaan ini memindahkan laporan dari kategori "informasi" ke kategori "butuh keputusan" —
dan itulah yang membuat temuan QA ditindaklanjuti.

### Latihan

Ambil satu temuan data dari latihan sebelumnya (atau temuan sintetis) dan susun laporan tiga lapis
lengkap dengan angka, dampak bisnis, query bukti, dan tiga pertanyaan keputusan.`,
          lab_ref: '/metrics',
        },
      ],
    },
  ],
  quizzes: [
    {
      title: 'Kuis Database Testing',
      pass_score: 70,
      order_index: 1,
      questions: [
        {
          prompt:
            'Query `SELECT * FROM users WHERE phone <> \'08123\'` tidak mengembalikan baris yang memiliki phone bernilai NULL. Mengapa?',
          options: [
            'Karena sintaks query salah',
            'Karena perbandingan apa pun dengan NULL menghasilkan UNKNOWN, sehingga NULL harus diuji dengan IS NULL',
            'Karena kolom phone tidak memiliki indeks',
            'Karena operator <> tidak didukung',
          ],
          answer_index: 1,
          explanation:
            'NULL berarti ketiadaan nilai, dan perbandingan dengan NULL selalu menghasilkan UNKNOWN (bukan benar), sehingga baris tersebut tersaring keluar. Pengujian NULL harus memakai IS NULL atau IS NOT NULL secara eksplisit.',
          points: 1,
        },
        {
          prompt:
            'Query mana yang paling tepat untuk menemukan pesanan yang tidak memiliki satu pun item (data yatim)?',
          options: [
            'SELECT * FROM orders WHERE id NOT IN (SELECT order_id FROM order_items)',
            'SELECT o.id FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id GROUP BY o.id HAVING COUNT(oi.id) = 0',
            'SELECT * FROM order_items WHERE order_id IS NULL',
            'SELECT COUNT(*) FROM orders',
          ],
          answer_index: 1,
          explanation:
            'LEFT JOIN mempertahankan seluruh baris pesanan meski tidak ada pasangan di order_items, sehingga HAVING COUNT(oi.id) = 0 tepat mengidentifikasi pesanan tanpa item. NOT IN berisiko salah bila subquery menghasilkan NULL.',
          points: 1,
        },
        {
          prompt:
            'Sebuah endpoint mengembalikan 201 Created tetapi query ke database menunjukkan tidak ada baris baru. Simpulan yang paling tepat adalah…',
          options: [
            'Endpoint benar, hanya cache yang menyebabkan perbedaan',
            'Terjadi ketidakcocokan lintas lapisan: lapisan API melaporkan sukses tetapi persistensi gagal, sehingga bug berada di lapisan data/transaksi',
            'Query verifikasi salah dan harus diabaikan',
            'Bug ada di antarmuka pengguna',
          ],
          answer_index: 1,
          explanation:
            'Respons sukses tanpa data tersimpan adalah pola "API benar, DB salah" yang khas. Ini menunjuk pada kegagalan persistensi atau pengelolaan transaksi, dan merupakan temuan berprioritas tinggi.',
          points: 1,
        },
        {
          prompt:
            'Skenario stok tersisa 1 unit, dua request checkout dikirim bersamaan dan keduanya sukses sehingga stok menjadi -1. Masalah apa yang terbukti?',
          options: [
            'Kesalahan validasi input',
            'Kondisi balapan (race condition) akibat penanganan konkurensi yang tidak benar',
            'Kesalahan penulisan query SELECT',
            'Masalah tampilan di antarmuka',
          ],
          answer_index: 1,
          explanation:
            'Pengujian berurutan tidak akan menemukan masalah ini. Dua transaksi membaca nilai stok yang sama sebelum salah satunya menulis, sehingga keduanya lolos validasi. Diperlukan penguncian atau pengecekan atomik.',
          points: 1,
        },
        {
          prompt:
            'Mengapa migrasi database perlu diuji dengan volume data yang mendekati produksi?',
          options: [
            'Agar migrasi terlihat lebih meyakinkan',
            'Karena durasi migrasi tumbuh seiring jumlah baris sehingga migrasi yang cepat pada data kecil bisa sangat lama atau gagal pada data besar',
            'Karena database produksi memakai tipe data berbeda',
            'Karena migrasi tidak dapat dijalankan pada database kosong',
          ],
          answer_index: 1,
          explanation:
            'Perilaku waktu dan kebutuhan sumber daya migrasi bergantung pada volume data. Menguji hanya pada data kecil menyembunyikan risiko downtime, kegagalan, dan dampak terhadap ketersediaan layanan.',
          points: 1,
        },
        {
          prompt:
            'Apa pemeriksaan paling penting yang sering terlewat setelah operasi UPDATE?',
          options: [
            'Memeriksa kolom yang diubah bernilai baru',
            'Memeriksa bahwa kolom lain tidak berubah dan baris lain tidak ikut terpengaruh',
            'Memeriksa bahwa respons API mengembalikan 200',
            'Memeriksa bahwa halaman di-refresh',
          ],
          answer_index: 1,
          explanation:
            'Selain memastikan nilai baru tersimpan, QA harus memverifikasi tidak ada perubahan yang tidak diinginkan: kolom lain tetap, created_at tidak tertimpa, dan jumlah baris yang terpengaruh tetap satu. UPDATE tanpa WHERE adalah penyebab klasik kerusakan massal.',
          points: 1,
        },
      ],
    },
  ],
};

/* ==================================================================== *
 * 8 — Materi & Praktik: Studi Kasus End-to-End
 * ==================================================================== */

const capstone: SeedCourse = {
  slug: 'materi-praktik-studi-kasus-e2e',
  title: 'Materi & Praktik: Studi Kasus End-to-End',
  subtitle: 'Menjalankan seluruh siklus QA QATools pada satu studi kasus nyata, dari kebutuhan sampai metrik.',
  description:
    'Kursus praktik terpadu. Anda akan membangun satu proyek QA lengkap di dalam QATools — kebutuhan, use case, skenario, test case, matriks, perencanaan, environment, eksekusi lintas mesin, defect, regresi, release gate, dan metrik — dengan studi kasus yang sama dari awal sampai akhir.',
  level: 'advanced',
  pillar: 'Materi & Praktik',
  estimated_minutes: 900,
  order_index: 8,
  icon: '🧪',
  tags: ['capstone', 'praktik', 'end-to-end', 'traceability', 'regresi'],
  modules: [
    {
      code: 'QA-CAP-M1',
      title: 'Membangun Fondasi Artefak',
      summary: 'Dari kebutuhan mentah menjadi test case yang tertaut penuh dalam matriks.',
      order_index: 1,
      lessons: [
        {
          code: 'L-CAP-01',
          title: 'Studi Kasus & Pengumpulan Kebutuhan',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 1,
          content_md: `## Studi kasus: TokoKita — fitur kode promo dan pengembalian dana

Sepanjang kursus ini Anda akan mengerjakan **satu** studi kasus tanpa menggantinya. Tujuannya agar
Anda merasakan bagaimana setiap artefak terhubung ke artefak berikutnya — dan bagaimana keputusan
buruk di awal merambat ke seluruh siklus.

### Konteks produk

TokoKita adalah toko online kecil dengan 40.000 pengguna aktif. Tim rilis setiap dua minggu. Dua fitur
sedang dikembangkan:

1. **Kode promo** pada checkout (persen dan nominal, berlaku sekali per akun).
2. **Pengembalian dana (refund)** sebagian dan penuh, dengan tenggat 7 hari.

### Permintaan mentah dari stakeholder

\`\`\`text
"Dua minggu lagi kami mau rilis kode promo dan fitur refund. Kode promo bisa
persen atau nominal, tapi cuma bisa dipakai sekali per akun. Refund maksimal
7 hari setelah pembayaran, bisa sebagian atau penuh. Tolong pastikan aman ya."
\`\`\`

Perhatikan berapa banyak hal yang belum dijelaskan: berapa lama kode berlaku, apakah bisa digabung
antar kode, apa yang terjadi bila diskon melebihi total, bagaimana refund memengaruhi kuota promo, dan
siapa yang boleh menyetujui refund.

### Tugas Anda

Tulis requirement lengkap di QATools dengan aturan berikut:

| Aturan penulisan | Alasan |
|---|---|
| Satu requirement = satu kemampuan yang bisa diuji | Memudahkan keterlacakan |
| Minimal lima acceptance criteria per requirement | Menutup ambiguitas |
| Setiap kriteria dapat dibuktikan ya/tidak | Menghindari perdebatan nanti |
| Sertakan prioritas dan sumber | Konteks untuk prioritisasi |
| Catat pertanyaan terbuka | Alat negosiasi dengan stakeholder |

### Contoh hasil untuk kode promo

\`\`\`text
REQ-001 — Penerapan kode promo pada checkout
Prioritas : tinggi       Sumber: product owner

Kriteria terima:
  AC1  Kode valid mengurangi total sesuai tipe (persen atau nominal)
  AC2  Diskon persen dihitung dari subtotal setelah pajak
  AC3  Kode kedaluwarsa ditolak dengan kode error promo_expired
  AC4  Kode hanya dapat dipakai sekali per akun
  AC5  Diskon tidak boleh melebihi subtotal (total minimal 0)
  AC6  Kode tidak peka huruf besar-kecil
  AC7  Total akhir setelah diskon minimal Rp0; tidak boleh negatif

Pertanyaan terbuka:
  Q1  Berapa lama masa berlaku kode? (usulan: 30 hari)
  Q2  Apakah satu pesanan boleh memakai lebih dari satu kode?
  Q3  Apakah kode berlaku untuk produk yang sedang diskon lain?
  Q4  Bagaimana perlakuan promo bila pesanan dibatalkan?
\`\`\`

Empat pertanyaan terbuka itu adalah **hasil kerja QA yang paling bernilai** pada tahap ini. Setiap
pertanyaan yang tidak diajukan sekarang akan menjadi bug — atau lebih buruk, menjadi keputusan yang
diambil sendiri oleh developer tanpa sepengetahuan produk.

### Latihan

Buat project di QATools, lalu tulis requirement untuk **kedua** fitur (kode promo dan refund) beserta
seluruh pertanyaan terbukanya. Jangan lanjut ke modul berikutnya sebelum minimal sepuluh pertanyaan
terbuka tercatat.`,
          lab_ref: '/requirements',
        },
        {
          code: 'L-CAP-02',
          title: 'Use Case & Skenario dari Kebutuhan',
          kind: 'reading',
          duration_minutes: 26,
          order_index: 2,
          content_md: `## Dari "apa yang dibutuhkan" ke "bagaimana perilakunya"

Requirement menyatakan kebutuhan. Use case menyatakan **perilaku bernama** dengan aktor dan alur.
Skenario memecah use case menjadi jalur konkret.

### Contoh use case lengkap

\`\`\`text
UC-001 — Menerapkan kode promo saat checkout
Aktor        : Pembeli terautentikasi
Tujuan       : Mendapat potongan harga dengan kode promo yang sah

Prakondisi   :
  - Pembeli sudah login
  - Keranjang berisi minimal 1 item
  - Pembeli belum memakai kode ini sebelumnya

Alur utama   :
  1. Pembeli membuka halaman checkout
  2. Sistem menampilkan kolom kode promo dan total saat ini
  3. Pembeli memasukkan kode promo dan menekan Terapkan
  4. Sistem memvalidasi format dan keberadaan kode
  5. Sistem memeriksa masa berlaku dan riwayat pemakaian akun
  6. Sistem menghitung diskon sesuai tipe
  7. Sistem memperbarui total dan menampilkan rincian potongan

Alur alternatif:
  A1  Kode tidak ditemukan → pesan "Kode promo tidak ditemukan"
  A2  Kode kedaluwarsa → pesan "Kode promo sudah kedaluwarsa"
  A3  Kode sudah dipakai akun ini → pesan sesuai aturan
  A4  Diskon melebihi subtotal → total dibatasi Rp0, sisa diskon hangus
  A5  Kode huruf kecil → dinormalisasi otomatis, tetap berhasil

Pascakondisi : Total checkout berkurang; kode tercatat pada pesanan setelah dibayar
\`\`\`

Perhatikan bahwa **alur alternatif bukan hiasan**. Di situlah sebagian besar bug bersembunyi, dan
biasanya juga di situlah requirement asli tidak menjelaskan apa pun.

### Menurunkan skenario

Setiap alur menjadi satu atau lebih skenario dengan bentuk Given/When/Then:

| Kode | Judul | Jenis | Terkait |
|---|---|---|---|
| SC-001 | Kode persen valid diterapkan | happy_path | A1 utama |
| SC-002 | Kode nominal valid diterapkan | happy_path | utama |
| SC-003 | Kode tidak ditemukan | negative | A1 |
| SC-004 | Kode kedaluwarsa | negative | A2 |
| SC-005 | Kode sudah dipakai akun | negative | A3 |
| SC-006 | Diskon melebihi subtotal | edge | A4 |
| SC-007 | Kode huruf kecil diterima | edge | A5 |
| SC-008 | Kode berkode spasi di awal/akhir | edge | — |
| SC-009 | Promo dipakai bersamaan dua tab | edge | — |

Skenario SC-009 lahir dari pemikiran tentang **kondisi balapan**, bukan dari requirement. Inilah nilai
tambah berpikir sebagai QA: menambahkan jalur yang tidak terpikirkan oleh penulis requirement.

### Aturan jumlah skenario

Untuk satu use case, target yang sehat adalah:

- 1–3 happy path (jalur utama).
- Minimal 2 negative per aturan validasi.
- Minimal 1 edge per batas atau kondisi khusus.
- Minimal 1 skenario konkurensi bila menyentuh sumber daya terbatas.

### Latihan

Buat use case untuk UC-001 (promo) dan UC-002 (refund) beserta seluruh alur alternatifnya, lalu
turunkan minimal delapan skenario untuk masing-masing. Tandai jenis setiap skenario.`,
          lab_ref: '/scenarios',
        },
        {
          code: 'L-CAP-03',
          title: 'Test Case, Data Uji & Matriks',
          kind: 'reading',
          duration_minutes: 28,
          order_index: 3,
          content_md: `## Mengubah skenario menjadi kasus yang bisa dijalankan

Skenario menyatakan *apa* yang harus terjadi. Test case menyatakan *bagaimana* membuktikannya: langkah,
data, dan hasil yang dapat diamati.

### Contoh penurunan lengkap

Dari SC-006 (diskon melebihi subtotal) lahir tiga test case karena ada beberapa cara diskon bisa
melebihi total:

| Kode | Judul | Data uji | Hasil diharapkan |
|---|---|---|---|
| TC-010 | Persen > 100% | Keranjang Rp600.000, kode 150% | total Rp0, sisa diskon hangus, pesan informasi tampil |
| TC-011 | Nominal > total | Keranjang Rp200.000, kode Rp500.000 | total Rp0, tidak ada saldo negatif |
| TC-012 | Nominal tepat sama total | Keranjang Rp200.000, kode Rp200.000 | total Rp0, status pesanan normal |

Ketiga kasus ini berbeda pada perilaku sistem meski semuanya "diskon melebihi subtotal". Memisahkannya
membuat laporan kegagalan menjadi presisi.

### Data uji yang harus disiapkan

| Kelompok | Data | Dipakai oleh |
|---|---|---|
| Akun | Pembeli baru, pembeli pernah pakai kode, pembeli tanpa keranjang | TC-001…TC-012 |
| Kode promo | Persen valid, nominal valid, kedaluwarsa, tidak ada, kuota habis, sisa kuota 1 | Berbagai kasus |
| Keranjang | Kosong, 1 item, banyak item, total tepat di batas | Kasus batas |
| Waktu | Kode berlaku hari ini, berakhir besok, berakhir kemarin | Kasus kedaluwarsa |
| Konkurensi | Dua sesi pada akun yang sama | Kasus balapan |

Simpan kelompok data ini sebagai **test data set** di environment, agar setiap orang memakai data yang
sama dan hasilnya bisa direproduksi.

### Memasukkan kasus ke matriks

Setelah test case dibuat, periksa matriks untuk memastikan:

1. Setiap requirement memiliki minimal satu test case (tidak ada **gap**).
2. Setiap test case memiliki jalur ke requirement (tidak ada **orphan**).
3. Setiap skenario negatif tertaut ke skenario induknya.
4. Cakupan dihitung per requirement, bukan per fitur secara umum.

Bila ada gap, itu bukan kegagalan alat tetapi temuan nyata: ada kebutuhan yang belum diuji.

### Menandai status otomasi sejak awal

Saat membuat test case, tandai rencana otomasinya:

| Status | Kapan dipakai |
|---|---|
| manual | Perlu penilaian manusia atau sekali pakai |
| automated | Sudah ada otomasi |
| to_be_automated | Akan diotomasi, prioritas jelas |
| cannot_automate | Secara teknis tidak memungkinkan (misalnya verifikasi sensor fisik) |

Menandai sejak awal membuat rencana otomasi jelas dan terukur.

### Latihan

Turunkan seluruh skenario UC-001 dan UC-002 menjadi 35–45 test case. Untuk setiap kasus, isi: langkah,
data uji, hasil diharapkan, tipe, prioritas, dan status otomasi. Lalu buka matriks dan pastikan tidak
ada gap dan tidak ada orphan.`,
          lab_ref: '/matrix',
        },
      ],
    },
    {
      code: 'QA-CAP-M2',
      title: 'Perencanaan & Eksekusi',
      summary: 'Menyusun siklus, menyiapkan environment, dan menjalankan lintas mesin.',
      order_index: 2,
      lessons: [
        {
          code: 'L-CAP-04',
          title: 'Merencanakan Siklus & Sumber Daya',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 1,
          content_md: `## Rencana yang bisa dipertahankan

Sekarang Anda punya 40 test case dan tenggat dua minggu. Modul ini mengubah daftar menjadi jadwal.

### Menghitung effort

\`\`\`text
Test case manual                   : 32 kasus × 6 menit  = 192 menit
Kasus yang akan diotomasi          :  8 kasus × 25 menit = 200 menit
Setup environment & data uji       :                       60 menit
Investigasi & pelaporan defect     : 25% dari eksekusi  =  48 menit
Regresi (setelah perbaikan)        : 12 kasus × 2 menit  =  24 menit
Uji regresi lintas mesin           : 10 kasus × 3 menit  =  30 menit
──────────────────────────────────────────────────────────────────
Total                                                   ≈ 554 menit ≈ 9,2 jam kerja
\`\`\`

Dengan satu QA bekerja 6 jam efektif per hari, ini sekitar 1,5 hari kerja murni. Bila dikerjakan
sambil menunggu build, tambahkan penyangga 30%.

### Menyusun cycle dan sprint

\`\`\`text
CYC-2026-Q4 — Rilis kode promo & refund
  Goal        : memastikan dua fitur baru layak rilis dengan risiko tersisa terdokumentasi
  Mulai       : 2026-11-24
  Selesai     : 2026-12-05
  Entry       : requirement disetujui, build tersedia di staging, data uji siap
  Exit        : 100% kasus kritis dieksekusi, pass rate ≥ 90%, 0 blocker terbuka

  SPR-01 (24–28 Nov) — Fokus kode promo
    Cakupan : TC-001…TC-020
    Kapasitas: 60 poin

  SPR-02 (1–5 Des) — Fokus refund + regresi
    Cakupan : TC-021…TC-040 + suite regresi 12 kasus
    Kapasitas: 60 poin
\`\`\`

### Alokasi per mesin eksekusi

| Mesin | Kasus | Alasan |
|---|---|---|
| Manual | 24 | Alur eksploratif, penilaian pesan & tampilan |
| API | 10 | Aturan perhitungan, status code, otorisasi |
| Database | 4 | Verifikasi persistensi & efek samping |
| Web otomasi | 6 | Alur kritis yang akan diulang setiap rilis |

Perhatikan bahwa mesin dipilih berdasarkan **jenis pembuktian yang dibutuhkan**, bukan berdasarkan
preferensi.

### Menyiapkan environment dan data

Sebelum eksekusi dimulai, pastikan:

| Item | Pemeriksaan |
|---|---|
| Environment staging | Build terbaru terpasang, dapat diakses |
| Database uji | Skema terbaru sudah dimigrasi, data uji ada |
| Akun uji | Akun pembeli, akun admin, akun tanpa hak refund |
| Kode promo uji | Valid, kedaluwarsa, kuota habis, sisa kuota 1 |
| Gateway pembayaran | Mode sandbox aktif dan berfungsi |
| Data refund | Pesanan berumur < 7 hari dan > 7 hari |

Kegagalan paling umum pada hari pertama eksekusi adalah environment yang belum siap. Menyiapkan ini
sehari sebelumnya menghemat berjam-jam.

### Latihan

Susun cycle dan dua sprint untuk studi kasus Anda lengkap dengan entry/exit criteria berangka. Bagikan
ke tim sebelum siklus dimulai.`,
          lab_ref: '/cycles',
        },
        {
          code: 'L-CAP-05',
          title: 'Eksekusi Lintas Mesin',
          kind: 'reading',
          duration_minutes: 26,
          order_index: 2,
          content_md: `## Satu fitur, empat cara membuktikan

Sekarang saatnya menjalankan. Modul ini menunjukkan bagaimana mesin eksekusi yang berbeda saling
melengkapi pada studi kasus yang sama.

### Mesin 1 — Manual

Cocok untuk: alur pengguna, pesan error, tata letak, penilaian.

\`\`\`text
TC-001 (manual) — Kode persen valid diterapkan
  1. Login sebagai pembeli dengan keranjang 2 item (total Rp600.000)
  2. Buka checkout
  3. Masukkan "PROMO10" lalu klik Terapkan
  Harapan: muncul label "Diskon 10% — Rp60.000", total menjadi Rp540.000
  Bukti  : screenshot
\`\`\`

Yang dinilai manusia dan tidak bisa diotomasi: apakah pesan mudah dipahami, apakah rincian potongan
terlihat jelas, apakah alurnya masuk akal.

### Mesin 2 — API

Cocok untuk: aturan perhitungan, status code, validasi, otorisasi, idempotensi.

\`\`\`text
TC-014 (api) — Diskon persen dihitung setelah pajak
  POST /api/carts/{id}/promo   { "code": "PROMO10" }
  Harapan: 200
           discount.amount = 60000
           discount.type   = "percent"
           total_before    = 600000
           total_after     = 540000
  Tambahan: diskon dihitung dari subtotal SETELAH pajak, bukan sebelum

TC-015 (api) — Kode kedaluwarsa ditolak
  Harapan: 400 (atau 422), error.code = "promo_expired"

TC-016 (api) — Tanpa token
  Harapan: 401

TC-017 (api) — Token user lain pada keranjang milik orang lain
  Harapan: 403

TC-018 (api) — Kirim ulang request yang sama
  Harapan: tidak menambah pemakaian kode kedua kali (idempoten)
\`\`\`

Mesin API paling efisien untuk menguji seluruh kombinasi aturan, karena setiap kasus berjalan dalam
hitungan milidetik.

### Mesin 3 — Database

Cocok untuk: persistensi, efek samping, integritas.

\`\`\`text
TC-025 (db) — Pemakaian kode tercatat tepat sekali
  SELECT COUNT(*) FROM promo_usages
  WHERE promo_code = 'PROMO10' AND user_id = '<id>';       -- harapan: 1

TC-026 (db) — Kuota promo berkurang tepat satu
  SELECT used_count FROM promos WHERE code = 'PROMO10';    -- harapan: sebelum+1

TC-027 (db) — Tidak ada pesanan negatif
  SELECT COUNT(*) FROM orders WHERE total_amount < 0;      -- harapan: 0

TC-028 (db) — Refund tidak melebihi pembayaran
  SELECT o.id FROM orders o JOIN refunds r ON r.order_id = o.id
  WHERE r.amount > o.total_amount;                          -- harapan: 0 baris
\`\`\`

### Mesin 4 — Web otomasi

Cocok untuk: alur kritis yang akan diulang setiap rilis.

\`\`\`text
TC-031 (web) — Alur checkout dengan promo
  goto  /login
  fill  [data-testid="login-email"]    <akun uji>
  fill  [data-testid="login-password"] <sandi>
  click [data-testid="login-submit"]
  goto  /checkout
  fill  [data-testid="promo-input"]    PROMO10
  click [data-testid="promo-apply"]
  wait  sampai [data-testid="checkout-total"] berisi "Rp540.000"
  assert teks [data-testid="discount-label"] mengandung "10%"
\`\`\`

### Memilih mesin dengan tepat

| Pertanyaan | Mesin yang dipilih |
|---|---|
| Apakah ini tentang tampilan dan pesan? | Manual |
| Apakah ini aturan perhitungan dengan banyak kombinasi? | API |
| Apakah ini tentang data yang benar-benar tersimpan? | Database |
| Apakah ini alur yang akan diulang setiap rilis? | Web otomasi |
| Apakah ini eksplorasi tanpa langkah tetap? | Manual (eksploratif) |

### Latihan

Jalankan minimal tiga test case untuk setiap mesin pada studi kasus Anda. Untuk setiap kegagalan,
kumpulkan bukti pada lapisan tempat kegagalan terlihat.`,
          lab_ref: '/execute',
        },
        {
          code: 'L-CAP-06',
          title: 'Defect, Perbaikan & Verifikasi',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 3,
          content_md: `## Menutup siklus dengan benar

Menemukan bug adalah pertengahan pekerjaan. Modul ini menutup siklus: melaporkan, mengikuti perbaikan,
memverifikasi, dan menjalankan regresi.

### Contoh defect dari studi kasus

\`\`\`text
BUG-031 — [Promo] Diskon persen dihitung dari subtotal sebelum pajak
Severity : Mayor            Priority: Tinggi
Sumber   : api
Environment: v3.1.0 · staging · akun pembeli uji

Data uji : keranjang 2 item (Rp500.000 + Rp100.000), kode PROMO10 (diskon 10%)
Prasyarat: pembeli login; PROMO10 belum dipakai akun ini

Langkah  :
  1. POST /api/carts/{cart_id}/items  (2 item, subtotal 600.000)
  2. POST /api/carts/{cart_id}/promo  { "code": "PROMO10" }

Hasil aktual : discount.amount = 60000, total_after = 540000
Hasil harap  : Sesuai REQ-001 AC2, diskon dihitung setelah pajak
               (PPN 11% → 66.000) sehingga discount.amount = 66600
               dan total_after = 599400

Bukti     : potongan respons JSON; query DB menunjukkan total_amount = 540000
Dampak    : seluruh transaksi dengan kode promo; selisih ~0,9% dari total
Kasus uji : TC-014 gagal; TC-001 lulus (tampilan konsisten dengan nilai salah)
\`\`\`

Perhatikan butir terakhir: TC-001 (manual) **lulus** karena tampilan konsisten dengan perhitungan yang
salah. Ini contoh sempurna mengapa satu mesin eksekusi saja tidak cukup.

### Mengikuti perbaikan

Setelah developer memperbaiki:

1. Perbaikan masuk ke build baru — catat versi build-nya.
2. **Retest** TC-014 pada build tersebut.
3. Jalankan **regresi terarah**: seluruh kasus yang menyentuh perhitungan total (TC-010…TC-018,
   TC-025, TC-027).
4. Verifikasi di lapisan database bahwa nilai tersimpan sudah benar, bukan hanya respons API.
5. Tutup defect hanya setelah perilaku benar teramati dan bukti tersimpan.

### Regresi: raja dari pengujian

Fitur promo dan refund menyentuh perhitungan uang. Setiap perubahan di area itu berisiko mematahkan
sesuatu yang lain. Karena itu suite regresi harus memuat:

\`\`\`text
Wajib masuk regresi:
  - Semua kasus perhitungan total dan diskon
  - Semua kasus batas (diskon = subtotal, diskon > subtotal, total Rp0)
  - Alur checkout normal tanpa promo (untuk memastikan tidak rusak oleh perubahan promo)
  - Alur pembayaran
  - Alur refund dasar
  - Kasus otorisasi (akses lintas akun)

Boleh keluar dari regresi:
  - Kasus tampilan kosmetik
  - Kasus yang memerlukan data langka dan tidak berisiko
  - Kasus sekali pakai
\`\`\`

### Menganalisis defect untuk perbaikan proses

Setelah siklus selesai, jawab pertanyaan ini:

| Bug | Ditemukan di | Seharusnya ditemukan di | Perbaikan proses |
|---|---|---|---|
| BUG-031 | Eksekusi API | Sudah terjawab saat requirement | AC2 diperjelas: "setelah pajak" |
| BUG-032 | Eksekusi manual | Requirement | Tambahkan spesifikasi pesan error |
| BUG-033 | Regresi | — | Bagus, itu fungsi regresi |

Analisis ini mengubah defect menjadi perbaikan proses, bukan hanya perbaikan kode.

### Latihan

Buat minimal tiga defect dari hasil eksekusi studi kasus Anda, ikuti sampai verifikasi, lalu jalankan
regresi terarah. Tuliskan satu perbaikan proses hasil analisis defect.`,
          lab_ref: '/defects',
        },
      ],
    },
    {
      code: 'QA-CAP-M3',
      title: 'Release, Metrik & Retrospektif',
      summary: 'Menutup siklus dengan keputusan rilis berbasis bukti dan pelajaran untuk siklus berikutnya.',
      order_index: 3,
      lessons: [
        {
          code: 'L-CAP-07',
          title: 'Release Gate Berbasis Data',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 1,
          content_md: `## Mengubah 40 test case menjadi satu keputusan

Modul ini menutup studi kasus dengan keputusan rilis yang bisa dipertahankan.

### Mengumpulkan angka

\`\`\`text
Cakupan
  Test case direncanakan        : 40
  Test case dieksekusi          : 38  (95%)
  Kasus kritis dieksekusi       : 12/12 (100%)
  Requirement tercakup          : 6/6 (100%)
  Gap di matriks                : 0
  Orphan di matriks             : 1  (TC-033 tidak tertaut ke skenario)

Hasil
  Lulus                         : 33 (86,8%)
  Gagal                         : 3  (7,9%)
  Terblokir                     : 2  (5,3%)
  Durasi total                  : 412 menit

Defect
  Ditemukan                     : 9
  Blocker                       : 1
  Mayor                         : 3
  Minor                         : 4
  Kosmetik                      : 1
  Ditutup                       : 6
  Terbuka                       : 3 (1 mayor, 2 minor)

Otomasi
  Kasus terotomasi              : 14/40 (35%)
  Flaky                         : 1 kasus (2,5% dari yang otomatis)

Regresi
  Suite                         : 18 kasus
  Pass rate terakhir            : 17/18 (94,4%)
  Durasi                        : 9 menit
\`\`\`

### Menerapkan kriteria keluar

| Kriteria | Ambang | Hasil | Status |
|---|---|---|---|
| Kasus kritis dieksekusi | 100% | 12/12 | ✅ |
| Pass rate keseluruhan | ≥ 90% | 86,8% | ❌ |
| Blocker terbuka | 0 | 1 | ❌ |
| Critical terbuka | 0 | 0 | ✅ |
| Requirement tercakup | ≥ 95% | 100% | ✅ |
| Regresi lulus di build kandidat | ya | ya (17/18) | ✅ |
| Gap matriks | 0 | 0 | ✅ |

Keputusan otomatis dari tabel ini: **NO-GO** — pass rate belum memenuhi ambang dan masih ada blocker.

### Menyusun risiko dan jalur pemulihan

NO-GO bukan akhir. Yang diperlukan adalah rencana:

\`\`\`text
1. Blocker : pembayaran gagal pada akun dengan saldo dompet
   Pemilik  : tim pembayaran    Target: 2 hari
   Dampak   : rilis tertunda sampai diperbaiki

2. Pass rate 86,8% vs ambang 90%
   Penyebab : 2 dari 3 kegagalan berasal dari area promo (diperbaiki oleh BUG-031, BUG-032)
   Perkiraan setelah perbaikan: 36/38 = 94,7%

3. Risiko tersisa bila diperbaiki:
   - TC-033 (orphan) belum tertaut skenario; cakupan promonya perlu diperiksa
   - 1 kasus flaky di alur keranjang; perlu perbaikan akar penyebab
   - Refund sebagian lintas mata uang belum diuji (fitur satu negara untuk rilis ini)

Rencana setelah perbaikan: retest 5 kasus terkait + regresi 18 kasus (9 menit)
                          → perkiraan siklus kedua 1 hari kerja
\`\`\`

### Keputusan siklus kedua

Setelah perbaikan, hasil menjadi:

\`\`\`text
Pass rate   : 37/38 = 97,4%   ✅ (ambang 90%)
Blocker     : 0               ✅
Keputusan   : GO BERSYARAT
Syarat      : pantau error rate pembayaran 48 jam pertama;
              TC-033 ditautkan; kasus flaky masuk tiket perbaikan
\`\`\`

Perhatikan bagaimana angka yang sama, setelah perbaikan, menghasilkan keputusan berbeda — dan bagaimana
keputusan itu tetap memuat risiko tersisa secara eksplisit.

### Latihan

Susun tabel kriteria keluar untuk studi kasus Anda dengan angka nyata, lalu tentukan keputusan dan
rencana pemulihannya.`,
          lab_ref: '/regression',
        },
        {
          code: 'L-CAP-08',
          title: 'Metrik & Perbaikan Berkelanjutan',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 2,
          content_md: `## Angka yang mengubah perilaku siklus berikutnya

Metrik bukan laporan untuk manajemen semata. Nilainya terletak pada pertanyaan yang ia munculkan.

### Membaca metrik siklus Anda

| Metrik | Nilai | Pertanyaan yang muncul |
|---|---|---|
| Pass rate | 86,8% → 97,4% | Apakah ambang mutu proyek realistis? |
| Cakupan requirement | 100% | Apakah keterlacakan sudah menjadi kebiasaan? |
| Automation rate | 35% | Kasus mana yang paling layak diotomasi berikutnya? |
| Flaky rate | 2,5% | Apakah suite otomasi masih bisa dipercaya? |
| Defect leakage | belum ada (pre-release) | Perlu diukur setelah rilis |
| Reopen rate | 0/9 | Apakah verifikasi berjalan baik? |
| Efektivitas regresi | 1 dari 9 defect | Apakah suite regresi cukup luas? |

Baris terakhir adalah temuan paling berharga: **satu defect ditemukan oleh regresi**. Artinya area
regresi berhasil menangkap sesuatu yang tidak ditemukan pengujian fitur baru.

### Menganalisis pola, bukan angka tunggal

Angka tunggal jarang berguna. Pola yang berguna:

| Pola | Arti | Tindakan |
|---|---|---|
| Mayoritas defect di satu modul | Area rawan | Naikkan cakupan & tambah otomasi di sana |
| Defect banyak ditemukan di eksekusi manual, bukan API | Aturan tidak tercakup di otomasi | Tambahkan kasus API |
| Kegagalan sering pada batas | Teknik batas belum dipakai | Latih tim memakai boundary value analysis |
| Bug berulang dari requirement yang sama | Requirement kurang jelas | Perbaiki template requirement |
| Banyak defect kosmetik | Fokus bergeser | Ingatkan prioritisasi berbasis risiko |

### Empat pertanyaan retrospektif QA

1. **Bug mana yang seharusnya ditemukan lebih awal, dan mengapa tidak?**
   Biasanya jawabannya adalah kurangnya kriteria terima atau cakupan negatif.
2. **Apakah ada cakupan yang dibuang?** Bila ya, apakah keputusan itu tercatat dan disetujui?
3. **Berapa lama waktu yang hilang karena masalah environment atau data?**
   Angka ini biasanya lebih besar dari dugaan.
4. **Apa satu perubahan proses untuk siklus berikutnya?**
   Satu perubahan yang benar-benar dijalankan lebih baik daripada lima rencana.

### Perbaikan yang biasa muncul

| Temuan | Perbaikan konkret |
|---|---|
| Requirement ambigu berulang | Template requirement wajib dengan 5 acceptance criteria |
| Environment sering belum siap | Checklist persiapan dijalankan H-1 siklus |
| Otomasi sering flaky | Aturan larangan \`sleep\` dan tinjauan tes baru |
| Defect terlambat diverifikasi | Definisi selesai memuat "diverifikasi QA di build perbaikan" |
| Gap baru ditemukan setelah rilis | Matriks diperiksa sebelum gerbang rilis, bukan sesudah |

### Latihan

Ambil satu siklus terakhir di tim Anda dan jawab empat pertanyaan retrospektif di atas. Pilih **satu**
perbaikan proses dan jalankan pada siklus berikutnya — bukan lima.`,
          lab_ref: '/metrics',
        },
        {
          code: 'L-CAP-09',
          title: 'Lab Akhir: Siklus QA Lengkap',
          kind: 'lab',
          duration_minutes: 50,
          order_index: 3,
          content_md: `## Tujuan lab

Menjalankan satu siklus QA lengkap dari awal sampai akhir pada satu proyek QATools, dan menghasilkan
laporan akhir yang bisa dipresentasikan.

## Prasyarat

- Satu project di QATools dengan minimal 5 requirement.
- Minimal 4 use case dan 12 skenario.
- Minimal 25 test case dengan data uji.
- Matriks tanpa gap.

## Langkah

### 1. Perencanaan
Buat satu cycle beserta dua sprint. Isi entry dan exit criteria dengan angka.

### 2. Environment
Buat environment staging dan satu test data set yang memuat seluruh data uji yang dibutuhkan.

### 3. Eksekusi lintas mesin
- Jalankan 15 kasus lewat **Run Center** (manual).
- Buat minimal 5 **API request** di API Automation beserta assertion-nya.
- Buat minimal 3 **DB check** di Database Testing.
- Buat minimal 3 **web flow** di Web Automation.

### 4. Defect
Buat minimal 3 defect dari kegagalan yang ditemukan, lengkap dengan severity, priority, dan langkah
reproduksi. Ikuti sampai status terverifikasi.

### 5. Regresi
Buka **Regresi (King)**, pilih strategi berbasis risiko, jalankan suite yang terpilih, dan catat
pass rate serta durasinya.

### 6. Release gate
Susun tabel kriteria keluar dengan angka nyata dan tentukan GO / GO BERSYARAT / NO-GO.

### 7. Metrik
Buka **QA Metrics**, catat seluruh metrik yang tersedia, dan tuliskan tiga temuan.

## Laporan akhir yang harus dihasilkan

\`\`\`text
1. Ringkasan eksekutif (maksimal 5 baris)
2. Cakupan: requirement, use case, skenario, test case (angka)
3. Hasil eksekusi per mesin (manual / API / DB / web)
4. Defect: ditemukan, ditutup, terbuka, per severity
5. Regresi: ukuran suite, pass rate, durasi, kasus flaky
6. Metrik kualitas: pass rate, cakupan, automation rate, defect density
7. Risiko tersisa (bernomor, dengan mitigasi dan pemilik)
8. Rekomendasi rilis beserta syaratnya
9. Tiga pelajaran untuk siklus berikutnya
\`\`\`

## Kriteria selesai

- Seluruh sembilan bagian laporan terisi dengan angka nyata dari QATools.
- Matriks tidak memiliki gap; orphan (bila ada) dijelaskan.
- Setiap risiko tersisa memiliki mitigasi dan pemilik.
- Rekomendasi rilis memuat syarat konkret bila bersifat bersyarat.

## Refleksi

Bandingkan rencana Anda di awal modul dengan hasil nyata. Selisih antara keduanya adalah ukuran
paling jujur dari pembelajaran Anda — dan sekaligus alasan mengapa setiap siklus QA perlu dicatat.`,
          lab_ref: '/metrics',
        },
      ],
    },
  ],
  quizzes: [
    {
      title: 'Kuis Studi Kasus End-to-End',
      pass_score: 75,
      order_index: 1,
      questions: [
        {
          prompt:
            'Sebuah test case manual lulus (nilai di layar konsisten) sementara test case API untuk perhitungan yang sama gagal. Apa artinya?',
          options: [
            'Test case manual salah dan harus diabaikan',
            'Tampilan konsisten dengan perhitungan yang salah, sehingga hanya lapisan API/DB yang bisa mengungkap bug tersebut',
            'Test case API terlalu ketat',
            'Keduanya benar dan bug tidak ada',
          ],
          answer_index: 1,
          explanation:
            'Ini pola ketidakcocokan lintas lapisan: UI menampilkan hasil perhitungan yang salah secara konsisten, sehingga pengujian manual tidak menangkapnya. Verifikasi di lapisan API dan database diperlukan untuk membuktikan nilai yang benar.',
          points: 1,
        },
        {
          prompt:
            'Dalam matriks traceability, sebuah test case tanpa skenario atau requirement induk disebut…',
          options: ['gap', 'orphan', 'blocker', 'flaky'],
          answer_index: 1,
          explanation:
            'Orphan adalah artefak tanpa induk sehingga tidak dapat ditelusuri ke kebutuhan. Gap adalah kebalikannya: requirement yang belum memiliki test case.',
          points: 1,
        },
        {
          prompt:
            'Pass rate 86,8% sementara ambang mutu proyek 90%, dan masih ada 1 blocker terbuka. Keputusan yang tepat adalah…',
          options: [
            'GO, karena mayoritas kasus lulus',
            'NO-GO, dengan rencana perbaikan, perkiraan hasil setelah perbaikan, dan riset ulang cakupan terkait',
            'GO BERSYARAT tanpa syarat apa pun',
            'Mengubah ambang mutu agar sesuai hasil',
          ],
          answer_index: 1,
          explanation:
            'Kriteria keluar tidak terpenuhi pada dua butir, sehingga keputusannya NO-GO. Yang membuat keputusan ini profesional adalah disertakannya rencana pemulihan, perkiraan hasil setelah perbaikan, dan pemantauan ulang.',
          points: 1,
        },
        {
          prompt:
            'Mengapa satu defisi eksekusi hanya memakai satu mesin (misalnya hanya manual) dianggap berisiko?',
          options: [
            'Karena manual lebih lambat',
            'Karena setiap mesin hanya dapat membuktikan aspek tertentu; persistensi, efek samping, dan kontrak API tidak dapat diverifikasi dari antarmuka',
            'Karena otomasi wajib untuk semua kasus',
            'Karena manual tidak boleh dipakai untuk kasus kritis',
          ],
          answer_index: 1,
          explanation:
            'Antarmuka dapat menampilkan nilai yang konsisten meski perhitungan atau penyimpanannya salah. Verifikasi lintas lapisan (UI, API, database, efek samping) diperlukan untuk membuktikan kebenaran secara menyeluruh.',
          points: 1,
        },
        {
          prompt:
            'Apa keputusan perbaikan proses yang paling tepat ketika mayoritas defect ditemukan lewat eksekusi manual padahal aturannya sudah jelas dan berulang?',
          options: [
            'Menambah jumlah tester manual',
            'Menambahkan cakupan otomasi di lapisan API untuk aturan tersebut agar pengujian menjadi cepat dan konsisten',
            'Menghentikan pengujian manual sepenuhnya',
            'Menurunkan prioritas area tersebut',
          ],
          answer_index: 1,
          explanation:
            'Aturan yang jelas dan berulang adalah kandidat otomasi terbaik di lapisan API: cepat, stabil, dan dapat dijalankan setiap rilis. Pengujian manual tetap dipakai untuk aspek yang membutuhkan penilaian manusia.',
          points: 1,
        },
      ],
    },
  ],
};

/* ==================================================================== *
 * 9 — Bangun Portofolio QA
 * ==================================================================== */

const portfolio: SeedCourse = {
  slug: 'bangun-portofolio-qa',
  title: 'Bangun Portofolio QA: Dari Artefak Kerja Menjadi Bukti Kompetensi',
  subtitle: 'Mengemas use case, matriks, otomasi, dan metrik dari QATools menjadi portofolio yang meyakinkan.',
  description:
    'Kursus penutup tentang mengubah pekerjaan nyata menjadi bukti kompetensi. Anda akan menyusun studi kasus portofolio, README yang kuat, bukti artefak, ringkasan metrik, dan narasi wawancara — semuanya berasal dari artefak yang sudah Anda hasilkan di QATools.',
  level: 'beginner',
  pillar: 'Bangun Portofolio',
  estimated_minutes: 480,
  order_index: 9,
  icon: '🏆',
  tags: ['portofolio', 'karier', 'studi-kasus', 'wawancara'],
  modules: [
    {
      code: 'QA-PORT-M1',
      title: 'Fondasi Portofolio QA',
      summary: 'Apa yang dianggap bukti, dan bagaimana memilih studi kasus yang tepat.',
      order_index: 1,
      lessons: [
        {
          code: 'L-PORT-01',
          title: 'Apa yang Dianggap Bukti Kompetensi',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 1,
          content_md: `## Masalah: semua orang menulis "teliti dan detail"

Hampir setiap CV QA memuat kata *teliti*, *detail*, dan *mampu bekerja dalam tim*. Karena semuanya
memuat itu, frasa tersebut tidak membedakan siapa pun. Yang membedakan adalah **bukti yang bisa
diperiksa**.

### Bukti kuat vs klaim

| Klaim | Bukti yang sepadan |
|---|---|
| "Saya teliti" | 40 test case dengan 12 kasus batas dan 8 kasus negatif |
| "Saya paham traceability" | Matriks yang menunjukkan 0 gap dan 0 orphan dari 6 requirement |
| "Saya bisa otomasi" | Suite 14 kasus API dengan catatan flaky rate 0% selama 20 run |
| "Saya paham proses QA" | Laporan siklus lengkap dengan metrik dan rekomendasi rilis |
| "Saya bisa menulis bug report" | Tiga defect dengan langkah reproduksi dan bukti lintas lapisan |

Perhatikan bahwa kolom kanan selalu berupa **angka atau artefak yang bisa dibuka**. Itulah inti
portofolio.

### Empat jenis bukti yang paling dihargai pewawancara

1. **Artefak langsung** — test case, matriks, skrip otomasi, laporan defect.
2. **Metrik** — angka yang menunjukkan hasil dan perbaikan dari waktu ke waktu.
3. **Narasi keputusan** — mengapa Anda memilih cakupan itu, apa yang Anda korbankan, dan apa risikonya.
4. **Refleksi** — apa yang Anda pelajari dan apa yang akan Anda lakukan berbeda.

Jenis ketiga dan keempat adalah yang paling jarang dimiliki pelamar, sehingga paling membedakan.

### Yang TIDAK boleh ada di portofolio

| Jangan | Alasan |
|---|---|
| Data perusahaan nyata | Melanggar kerahasiaan; bisa merusak kredibilitas |
| Kredensial atau token nyata | Risiko keamanan |
| Artefak hasil menyalin orang lain | Mudah terdeteksi saat wawancara mendalam |
| Kerangka kosong tanpa isi | Menunjukkan ketiadaan pekerjaan nyata |
| Sertifikat tanpa bukti kerja | Sertifikat menunjukkan pembelajaran, bukan kompetensi |

**Aturan aman:** gunakan aplikasi publik, aplikasi demo, atau aplikasi buatan sendiri dengan data
fiktif. Jika memakai sistem nyata, anonimkan nama dan ganti seluruh data.

### Portofolio yang berasal dari QATools

Keuntungan besar dari kursus ini: seluruh artefak portofolio Anda **sudah ada** di dalam QATools.

| Artefak portofolio | Sumber di QATools |
|---|---|
| Kumpulan requirement & acceptance criteria | Requirements |
| Use case dengan alur alternatif | Use Cases |
| Skenario positif/negatif/edge | Scenarios |
| Test case dengan data uji | Test Cases |
| Matriks traceability & cakupan | Traceability Matrix |
| Rencana siklus & sprint | Cycle & Sprint |
| Bukti eksekusi lintas mesin | Run Center, API/DB/Web Tester |
| Contoh defect berkualitas | Defect Tracker |
| Suite & hasil regresi | Regresi (King) |
| Metrik QA & kesiapan rilis | QA Metrics |
| e-Certificate | e-Certificate |

Anda tidak perlu membuat apa pun dari nol — tugas Anda adalah **memilih, mengemas, dan menjelaskan**.

### Latihan

Buka QATools dan catat setiap artefak yang sudah Anda hasilkan beserta jumlahnya. Daftar itu adalah
bahan mentah portofolio Anda.`,
          lab_ref: '/metrics',
        },
        {
          code: 'L-PORT-02',
          title: 'Memilih Studi Kasus Portofolio',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 2,
          content_md: `## Satu studi kasus mendalam mengalahkan sepuluh yang dangkal

Kesalahan paling umum: portofolio berisi banyak proyek yang masing-masing hanya memperlihatkan
tangkapan layar. Rekruter tidak bisa menilai kedalaman dari tangkapan layar.

### Kriteria memilih studi kasus

| Kriteria | Mengapa penting |
|---|---|
| Ada logika bisnis nyata | Memungkinkan memperlihatkan teknik desain test |
| Ada perhitungan atau aturan | Menunjukkan pemahaman batas & decision table |
| Ada beberapa lapisan (UI, API, DB) | Menunjukkan kemampuan verifikasi menyeluruh |
| Ada alur berstatus | Memungkinkan pengujian state transition |
| Ada risiko keamanan | Menunjukkan kesadaran otorisasi |
| Ukurannya wajar | Cukup besar untuk bermakna, cukup kecil untuk rapi |

### Contoh studi kasus yang kuat

\`\`\`text
Aplikasi  : TokoKita (demo toko online)
Fitur     : Kode promo dan pengembalian dana
Kenapa    :
  - Ada perhitungan (persen, nominal, batas total)
  - Ada aturan status (pesanan: pending → paid → refunded)
  - Ada otorisasi (refund hanya role tertentu)
  - Ada batas waktu (refund maksimal 7 hari)
  - Ada kondisi balapan (kode sekali pakai per akun)
Hasil     :
  - 6 requirement, 4 use case, 14 skenario, 40 test case
  - Matriks: 0 gap, 0 orphan
  - Otomasi: 14 kasus API, flaky rate 0% dalam 20 run
  - 9 defect ditemukan, 3 kelas bug tercatat dengan analisis akar penyebab
  - Laporan siklus dengan keputusan GO BERSYARAT dan risiko tersisa
\`\`\`

### Berapa banyak studi kasus?

| Tingkat pengalaman | Jumlah | Catatan |
|---|---|---|
| Pemula / fresh graduate | 1–2 | Kedalaman lebih penting daripada jumlah |
| 1–3 tahun | 2–3 | Variasi jenis aplikasi mulai berguna |
| Senior | 3–4 | Fokus pada dampak dan perbaikan proses |

Untuk sebagian besar pelamar, **satu studi kasus yang sangat lengkap** sudah cukup. Tambahkan yang
kedua hanya bila ia menunjukkan kemampuan berbeda (misalnya satu aplikasi web dan satu API murni).

### Menyiapkan data yang aman

Untuk setiap studi kasus:

1. Gunakan aplikasi demo publik atau buatan sendiri.
2. Ganti seluruh data dengan data fiktif.
3. Hapus kredensial, token, dan alamat server internal.
4. Anonimkan nama orang dan perusahaan.
5. Dokumentasikan sumber aplikasi (dengan tautan bila publik).

Ini bukan formalitas: portofolio yang memuat data perusahaan nyata justru menunjukkan kurangnya
kesadaran profesional.

### Latihan

Pilih satu studi kasus untuk portofolio Anda dan tuliskan dalam tiga baris: aplikasi apa, fitur apa,
dan mengapa fitur itu layak dipamerkan.`,
          lab_ref: '/usecases',
        },
        {
          code: 'L-PORT-09',
          title: 'Latihan: Memilih & Membatasi Studi Kasus',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 3,
          content_md: `## Studi kasus yang terlalu besar tidak akan pernah selesai

Penyebab paling umum portofolio QA yang tidak pernah dipublikasikan adalah studi kasus yang dipilih
terlalu luas. Latihan ini membatasi ruang lingkup sampai ukuran yang benar-benar bisa diselesaikan.

### Aturan pembatasan

| Aturan | Cara menerapkan |
|---|---|
| Satu fitur utama | Bukan satu aplikasi; satu fitur dengan logika nyata |
| Maksimal 3 aturan bisnis | Cukup untuk menunjukkan decision table |
| Maksimal 2 lapisan verifikasi | Misalnya API + database |
| Maksimal 40 test case | Lebih banyak tidak menambah nilai, hanya menambah waktu |
| Maksimal 1 tabel skema khusus | Agar data uji mudah disiapkan |
| Maksimal 2 minggu kalender | Termasuk penulisan dokumentasi |

### Tiga tingkat ukuran

| Tingkat | Isi | Durasi | Cocok untuk |
|---|---|---|---|
| Kecil | 1 fitur, 15 kasus, dokumentasi ringkas | 3–5 hari | Portofolio pertama |
| Sedang | 1 fitur, 40 kasus, otomasi API, laporan metrik | 2 minggu | Pelamar dengan pengalaman |
| Besar | 2–3 fitur atau satu alur end-to-end | 4+ minggu | Senior, atau saat mengejar peran lead |

**Mulailah dari tingkat kecil.** Portofolio tingkat kecil yang selesai dan dipublikasikan jauh lebih
berguna daripada rencana tingkat besar yang berhenti di tengah.

### Kartu studi kasus

Isi kartu ini sebelum menulis satu artefak pun:

\`\`\`text
Nama studi kasus : …
Aplikasi         : … (tautan bila publik / "aplikasi buatan sendiri")
Fitur            : SATU fitur utama
Alasan pemilihan : 3 alasan konkret (logika, lapisan, risiko)
Aturan bisnis    : maksimal 3
Lapisan uji      : API + DB  (atau UI + API)
Target artefak   : 15 test case · 5 skenario · 1 matriks · 1 laporan
Batas waktu      : tanggal selesai
Yang TIDAK diuji : daftar eksplisit
\`\`\`

Baris terakhir adalah yang paling sering hilang. Menuliskan apa yang tidak Anda uji membuat lingkupnya
terkunci dan sekaligus menunjukkan cara berpikir profesional sejak awal.

### Memeriksa kelayakan studi kasus

Sebuah fitur layak dijadikan studi kasus bila memenuhi minimal **tiga** dari lima kriteria berikut:

\`\`\`text
[ ] Ada perhitungan atau aturan numerik        → menunjukkan boundary & decision table
[ ] Ada status yang berubah                    → menunjukkan state transition
[ ] Ada aturan otorisasi atau peran            → menunjukkan pengujian keamanan
[ ] Ada lapisan data yang bisa diverifikasi    → menunjukkan pengujian database
[ ] Ada batas waktu atau kuota                 → menunjukkan pengujian konkurensi
\`\`\`

Bila kurang dari tiga, cari fitur lain. Studi kasus tanpa kriteria ini akan menghasilkan portofolio yang
hanya berisi pengujian tampilan.

### Contoh pemilihan untuk tiga latar belakang

| Latar belakang | Studi kasus yang dipilih | Alasan |
|---|---|---|
| Fresh graduate | Kode promo pada toko demo | Perhitungan + batas + kuota |
| Manual tester berpengalaman | Alur persetujuan berjenjang | Status + peran + aturan |
| Developer pindah ke QA | Endpoint pembayaran API publik | Kontrak + idempotensi + otorisasi |

### Kriteria selesai

- Satu kartu studi kasus terisi lengkap.
- Fitur memenuhi minimal tiga dari lima kriteria kelayakan.
- Batas waktu ditetapkan dan realistis sesuai tingkat ukuran.
- Daftar "yang tidak diuji" ditulis eksplisit.

### Refleksi

Perhatikan bahwa membatasi lingkup bukan mengurangi ambisi, melainkan memindahkan energi dari
mengumpulkan artefak ke **menjelaskan keputusan**. Portofolio dengan 15 test case yang dijelaskan dengan
baik selalu mengalahkan portofolio dengan 200 test case tanpa narasi.`,
          lab_ref: '/usecases',
        },
      ],
    },
    {
      code: 'QA-PORT-M2',
      title: 'Mengemas Artefak',
      summary: 'README, struktur repositori, bukti otomasi, dan ringkasan metrik.',
      order_index: 2,
      lessons: [
        {
          code: 'L-PORT-03',
          title: 'Menyusun README Portofolio',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 1,
          content_md: `## README adalah pintu masuk; sebagian orang tidak membaca lebih jauh

Rekruter biasanya menghabiskan 1–2 menit per portofolio. README yang baik membuat mereka memutuskan
untuk melihat lebih dalam.

### Struktur README yang bekerja

\`\`\`markdown
# Studi Kasus QA — TokoKita: Kode Promo & Pengembalian Dana

## Ringkasan
Proyek pengujian end-to-end untuk fitur kode promo dan refund pada aplikasi
toko online demo. Mencakup 6 requirement, 40 test case, otomasi API, pengujian
database, matriks traceability tanpa gap, dan laporan kesiapan rilis.

**Hasil utama**
- 40 test case (12 batas, 14 negatif, 14 fungsional)
- Matriks: 0 gap, 0 orphan
- Otomasi: 14 kasus API, flaky rate 0% dalam 20 run
- 9 defect ditemukan (1 blocker, 3 mayor), semuanya dengan bukti lintas lapisan
- Keputusan rilis: GO BERSYARAT dengan 3 risiko tersisa terdokumentasi

## Ruang lingkup
| Dalam cakupan | Di luar cakupan |
|---|---|
| ... | ... |

## Pendekatan
1. Requirement & acceptance criteria
2. Use case & skenario
3. Test case berbasis teknik desain
4. Matriks traceability
5. Eksekusi lintas mesin (manual, API, DB)
6. Laporan & rekomendasi rilis

## Artefak
- 📋 [Requirements](link)
- 📘 [Use cases](link)
- 🧭 [Scenarios](link)
- 🧪 [Test cases](link)
- 🔗 [Traceability matrix](link)
- 🐞 [Defect examples](link)
- 📊 [QA metrics report](link)

## Teknik desain yang dipakai
- Equivalence partitioning & boundary value analysis (perhitungan diskon)
- Decision table (aturan kelayakan refund)
- State transition testing (siklus status pesanan)
- Pairwise untuk kombinasi parameter refund
- Exploratory session untuk alur keranjang

## Contoh temuan
### BUG-031 — Diskon persen dihitung sebelum pajak
[ringkas: dampak, bukti, akar penyebab, perbaikan]

## Pelajaran
1. ...
2. ...
3. ...

## Teknologi
QATools · SQL · HTTP/REST · TypeScript
\`\`\`

### Empat bagian yang paling menentukan

| Bagian | Fungsi |
|---|---|
| Ringkasan + hasil utama | Menjawab "apa ini" dalam 15 detik |
| Ruang lingkup (dalam & luar) | Menunjukkan cara berpikir profesional |
| Contoh temuan | Membuktikan Anda benar-benar menemukan sesuatu |
| Pelajaran | Menunjukkan kedewasaan dan kesadaran diri |

### Tips penulisan

1. **Angka di awal.** "40 test case" lebih kuat daripada "cakupan pengujian yang komprehensif".
2. **Satu temuan menarik yang dijelaskan lengkap** lebih baik daripada sepuluh tangkapan layar.
3. **Sebutkan yang tidak Anda lakukan.** Menyatakan batasan justru menaikkan kredibilitas.
4. **Hindari istilah pemasaran.** "Test case yang komprehensif" tidak bermakna.
5. **Tautan yang bisa diklik.** Setiap artefak harus dapat dibuka.

### Latihan

Tulis README untuk portofolio Anda mengikuti struktur di atas, dengan minimal empat angka konkret.`,
          lab_ref: '/metrics',
        },
        {
          code: 'L-PORT-04',
          title: 'Struktur Repositori & Bukti Otomasi',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 2,
          content_md: `## Repositori yang rapi menunjukkan cara kerja yang rapi

Struktur folder portofolio adalah sinyal pertama tentang bagaimana Anda bekerja.

### Struktur yang disarankan

\`\`\`text
qa-portfolio-tokokita/
├─ README.md                     ← ringkasan & tautan
├─ docs/
│  ├─ 01-requirements.md         ← 6 requirement + acceptance criteria
│  ├─ 02-usecases.md             ← 4 use case lengkap
│  ├─ 03-scenarios.md            ← 14 skenario (positif/negatif/edge)
│  ├─ 04-test-cases.md           ← 40 test case + data uji
│  ├─ 05-traceability.md         ← matriks + analisis gap
│  ├─ 06-test-plan.md            ← cakupan, jadwal, exit criteria
│  ├─ 07-defects.md              ← 3 contoh defect terbaik
│  ├─ 08-metrics-report.md       ← laporan siklus + rekomendasi rilis
│  └─ 09-lessons-learned.md      ← refleksi & perbaikan proses
├─ automation/
│  ├─ api/                       ← 14 kasus API (atau kumpulan request)
│  ├─ db/                        ← 4 query verifikasi
│  ├─ web/                       ← 3 alur UI
│  └─ README.md                  ← cara menjalankan + hasil terakhir
├─ data/
│  └─ test-data.md               ← data uji (fiktif, aman dibagikan)
└─ evidence/
   └─ screenshots/               ← bukti visual yang sudah dianonimkan
\`\`\`

### Tantangan terbesar: bukti otomasi

Menunjukkan skrip otomasi tidak cukup — rekruter ingin tahu apakah skripnya **berjalan**. Sertakan:

| Bukti | Cara menyajikan |
|---|---|
| Skrip dapat dijalankan | Perintah yang jelas di README automation |
| Hasil terakhir | Ringkasan hasil (jumlah lulus/gagal, durasi) |
| Assertion bermakna | Tunjukkan satu contoh assertion kuat dan alasannya |
| Kestabilan | Catat flaky rate dari beberapa run |
| Struktur | Tunjukkan pemisahan helper dan halaman |

Bila Anda memakai QATools, Anda bisa menyajikan artefak otomasi sebagai:
\`\`\`text
- Kumpulan API request dengan assertion (ekspor JSON dari API Automation)
- DB check dengan SQL dan assertion
- Web flow dengan langkah dan selector
- Bukti eksekusi dari Run Center
\`\`\`

Yang penting: pembaca dapat memahami **apa yang diperiksa dan mengapa**, bukan hanya melihat kode.

### Yang membuat bukti otomasi meyakinkan

1. **Assertion yang benar-benar menguji.** Tunjukkan satu assertion kuat dan jelaskan mengapa versi
   lemahnya tidak cukup.
2. **Pemisahan yang jelas.** Ada helper, ada page object, ada konfigurasi terpisah.
3. **Tanpa rahasia di dalam kode.** Kredensial dari variabel lingkungan.
4. **Catatan stabilitas.** Menyebutkan flaky rate menunjukkan Anda mengukur, bukan hanya menjalankan.
5. **Cara menjalankan.** Perintah yang bisa disalin dan dijalankan.

### Latihan

Buat struktur repositori untuk studi kasus Anda dan isi minimal enam dokumen. Tulis README di dalam
folder automation yang menjelaskan cara menjalankan dan hasil terakhir.`,
          lab_ref: '/api-tester',
        },
        {
          code: 'L-PORT-05',
          title: 'Menampilkan Metrik Tanpa Membual',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 3,
          content_md: `## Metrik yang jujur lebih meyakinkan daripada metrik yang besar

Metrik portofolio paling sering dipakai secara salah: orang menampilkan angka terbesar yang bisa
mereka klaim, tanpa konteks. Akibatnya angka tersebut menimbulkan kecurigaan, bukan kepercayaan.

### Metrik yang layak ditampilkan

| Metrik | Cara menyajikan dengan jujur |
|---|---|
| Jumlah test case | Sebutkan komposisinya: 12 batas, 14 negatif, 14 fungsional |
| Cakupan requirement | "6/6 requirement tercakup, 0 gap, 0 orphan" |
| Automation rate | "14 dari 40 kasus (35%) — sisanya sengaja manual karena butuh penilaian visual" |
| Flaky rate | "0% dalam 20 run berturut-turut" (sebutkan jumlah run!) |
| Defect ditemukan | "9 defect: 1 blocker, 3 mayor, 4 minor, 1 kosmetik" |
| Waktu eksekusi | "38 kasus dalam 412 menit (≈10,8 menit/kasus termasuk investigasi)" |
| Efektivitas regresi | "1 dari 9 defect ditemukan lewat regresi" |

### Konteks yang wajib disertakan

Angka tanpa konteks selalu mencurigakan. Selalu sertakan:

1. **Basis perhitungan** — 20 run, bukan "beberapa kali".
2. **Batasan** — "tidak termasuk pengujian performa".
3. **Yang dikorbankan** — "refund lintas mata uang tidak diuji, fitur satu negara untuk rilis ini".
4. **Periode** — "selama siklus 2 minggu".

### Contoh kalimat metrik yang baik vs buruk

| Buruk | Baik |
|---|---|
| "Meningkatkan kualitas 40%" | "Defect leakage turun dari 8% ke 3% dalam tiga siklus (sumber: laporan siklus)" |
| "Mengotomasi 100% pengujian" | "Mengotomasi 14 dari 40 kasus (35%); memilih tidak mengotomasi 6 kasus visual karena biaya perawatan melebihi manfaat" |
| "Coverage 100%" | "Cakupan requirement 100%; cakupan baris kode tidak diukur dalam proyek ini" |
| "Menemukan 50 bug" | "Menemukan 9 defect, 4 di antaranya kelas bug integritas data yang hanya terlihat lewat verifikasi database" |

Perhatikan bahwa versi baik **lebih kecil angkanya tetapi lebih meyakinkan**, karena ia menunjukkan
penilaian dan kejujuran.

### Menampilkan tren, bukan hanya hasil akhir

Yang paling dihargai adalah bukti perbaikan:

\`\`\`text
Siklus 1 : pass rate 86,8% · flaky 2,5% · 3 defect terbuka
Siklus 2 : pass rate 97,4% · flaky 1,0% · 0 defect terbuka
Perbaikan: validasi kode promo dipindahkan ke lapisan API sehingga kasus
           berjalan 40× lebih cepat dan tidak lagi bergantung pada UI
\`\`\`

Baris "perbaikan" adalah bagian terpenting: ia menjelaskan **tindakan**, bukan hanya hasil.

### Latihan

Ambil seluruh metrik dari studi kasus Anda dan tuliskan masing-masing dengan basis perhitungan,
batasan, dan periode. Hapus setiap angka yang tidak bisa Anda pertahankan saat ditanya.`,
          lab_ref: '/metrics',
        },
      ],
    },
    {
      code: 'QA-PORT-M3',
      title: 'Narasi & Kesiapan Karier',
      summary: 'Menyusun narasi wawancara, menjawab pertanyaan teknis, dan merawat portofolio.',
      order_index: 3,
      lessons: [
        {
          code: 'L-PORT-06',
          title: 'Narasi Wawancara dari Portofolio',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 1,
          content_md: `## Portofolio membuka pintu; narasi yang membuat Anda diterima

Wawancara QA hampir selalu memuat pertanyaan seperti "ceritakan proyek pengujian terakhir Anda".
Portofolio Anda adalah bahan jawabannya — asalkan Anda bisa menceritakannya dengan struktur.

### Kerangka STAR yang disesuaikan untuk QA

| Bagian | Pertanyaan yang dijawab | Contoh isi |
|---|---|---|
| Situation | Konteks & risiko | "Rilis kode promo & refund, dua minggu, satu QA" |
| Task | Tanggung jawab spesifik | "Menyusun cakupan, eksekusi lintas mesin, rekomendasi rilis" |
| Action | Apa yang Anda lakukan & mengapa | "Cakupan berbasis risiko; teknik desain per jenis aturan; otomasi API untuk perhitungan" |
| Result | Hasil terukur | "40 kasus, 0 gap matriks, 9 defect, 14 kasus terotomasi, rekomendasi GO BERSYARAT" |

Bagian **Action** adalah tempat Anda menang atau kalah. Jawaban lemah berbunyi "saya menguji fitur
tersebut". Jawaban kuat menjelaskan **pilihan**:

\`\`\`text
"Saya memilih memindahkan seluruh pengujian perhitungan diskon ke lapisan API
 karena aturannya memiliki banyak kombinasi. Dengan begitu 14 kasus berjalan
 dalam 12 detik, dan saya bisa mengulanginya setiap kali ada perubahan.
 Pengujian manual saya sisakan untuk pesan error dan keterbacaan rincian
 potongan, yang tidak bisa dinilai otomatis."
\`\`\`

Perhatikan bahwa jawaban ini memuat keputusan, alasan, dan pengorbanan yang disadari.

### Sepuluh pertanyaan wawancara yang hampir selalu muncul

1. Bagaimana Anda menentukan apa yang diuji ketika waktu terbatas?
2. Ceritakan bug paling menarik yang pernah Anda temukan.
3. Bagaimana Anda membedakan severity dan priority?
4. Kapan Anda memilih mengotomasi, dan kapan tidak?
5. Bagaimana Anda menangani tes yang flaky?
6. Apa yang Anda lakukan ketika developer menolak bug Anda?
7. Bagaimana Anda memastikan cakupan pengujian memadai?
8. Bagaimana Anda menguji fitur yang tidak memiliki dokumentasi?
9. Kapan Anda menyatakan sebuah rilis layak dirilis?
10. Bagaimana Anda mengukur keberhasilan pekerjaan QA Anda?

Untuk masing-masing, siapkan jawaban yang mengacu pada **artefak nyata** di portofolio Anda. Jawaban
"biasanya saya..." jauh lebih lemah daripada "pada studi kasus TokoKita, saya...".

### Menjawab "ceritakan bug menarik"

Gunakan struktur: gejala → bagaimana ditemukan → mengapa penting → akar penyebab → perbaikan.

\`\`\`text
Gejala      : total pesanan dengan kode promo lebih tinggi dari yang tertera
Ditemukan   : verifikasi API, bukan pengujian UI — tampilan konsisten dengan nilai salah
Penting     : menyentuh seluruh transaksi dengan promo; selisih ~0,9% per transaksi
Akar sebab  : diskon dihitung dari subtotal sebelum pajak, melanggar AC2
Perbaikan   : urutan perhitungan diperbaiki + test case batas ditambahkan
              ke suite regresi agar tidak terulang
\`\`\`

Jawaban ini menunjukkan tiga hal sekaligus: kemampuan teknis, pemahaman dampak bisnis, dan kesadaran
proses (menambahkan kasus ke regresi).

### Latihan

Tulis jawaban STAR untuk "ceritakan proyek pengujian terakhir Anda" dalam maksimal 250 kata, memakai
angka dari portofolio Anda.`,
          lab_ref: '/execute',
        },
        {
          code: 'L-PORT-07',
          title: 'Merawat & Mengembangkan Portofolio',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 2,
          content_md: `## Portofolio adalah artefak hidup

Portofolio yang dibuat sekali lalu ditinggalkan akan terlihat usang dalam setahun. Ia perlu dirawat
sama seperti suite otomasi.

### Irama perawatan

| Frekuensi | Aktivitas |
|---|---|
| Setiap selesai siklus | Tambahkan satu temuan menarik dan perbarui metrik |
| Setiap kuartal | Perbarui README, hapus artefak yang tidak lagi relevan |
| Setiap enam bulan | Tambahkan satu studi kasus baru bila kemampuan baru dipelajari |
| Sebelum melamar | Sesuaikan studi kasus yang ditonjolkan dengan lowongan |

### Mengembangkan ke arah kemampuan baru

Setiap studi kasus baru sebaiknya menunjukkan kemampuan yang **belum** terlihat:

| Sudah ada | Studi kasus berikutnya bisa menambahkan |
|---|---|
| Pengujian fungsional & API | Pengujian performa dasar |
| Otomasi UI | Pengujian keamanan (otorisasi, IDOR) |
| Pengujian database | Pengujian aksesibilitas |
| Laporan manual | Integrasi CI dengan gerbang mutu |
| Satu aplikasi | Aplikasi mobile atau API publik pihak ketiga |

Dengan begitu portofolio Anda tumbuh secara terarah, bukan sekadar bertambah.

### Melacak dampak, bukan hanya aktivitas

Simpan catatan singkat untuk setiap siklus:

\`\`\`text
Siklus        : 2026-Q4
Cakupan       : 40 test case, 6 requirement
Hasil         : 9 defect (1 blocker), pass rate 86,8% → 97,4% setelah perbaikan
Keputusan     : GO BERSYARAT, 3 risiko tersisa
Otomasi       : 14 kasus API, flaky 0% dalam 20 run
Pembelajaran  : teknik decision table sangat membantu untuk aturan refund
Perbaikan     : validasi promo dipindahkan ke lapisan API (40× lebih cepat)
\`\`\`

Catatan seperti ini menjadi bahan mentah untuk wawancara, penilaian kinerja, dan lamaran berikutnya.

### Meminta umpan balik

Portofolio yang tidak pernah ditinjau tidak akan membaik. Mintalah umpan balik dari:

1. **QA senior** — menilai kedalaman teknis dan kelayakan artefak.
2. **Developer** — menilai apakah laporan bug Anda benar-benar berguna.
3. **Manajer produk atau rekruter** — menilai kejelasan ringkasan dan dampak bisnis.

Pertanyaan yang paling berguna untuk diajukan: *"Dalam 60 detik pertama, apa yang Anda pahami tentang
cara saya bekerja?"* Jawabannya biasanya menunjukkan celah di README Anda.

### Sertifikasi dan perannya

Sertifikat (termasuk e-Certificate dari kursus ini) berguna sebagai **penanda pembelajaran**, bukan
bukti kompetensi. Cara memakainya dengan tepat:

| Tepat | Tidak tepat |
|---|---|
| "Menyelesaikan kurikulum QA dengan studi kasus end-to-end" + tautan artefak | "Bersertifikat" tanpa artefak apa pun |
| Menyebutkan topik yang dikuasai | Mengklaim keahlian tanpa contoh |
| Melengkapi portofolio | Menggantikan portofolio |

Kombinasi paling kuat: sertifikat + artefak + narasi. Ketiganya saling menguatkan.

### Latihan

Tentukan irama perawatan portofolio Anda, lalu minta umpan balik dari satu orang dengan pertanyaan
60 detik di atas. Catat dua perubahan yang akan Anda lakukan.`,
          lab_ref: '/certificate',
        },
        {
          code: 'L-PORT-08',
          title: 'Lab Akhir: Menerbitkan Portofolio & e-Certificate',
          kind: 'lab',
          duration_minutes: 40,
          order_index: 3,
          content_md: `## Tujuan lab

Mengemas artefak QATools Anda menjadi portofolio yang bisa dibagikan, dan menerbitkan e-Certificate
sebagai penutup perjalanan belajar.

## Bagian A — Menyelesaikan kurikulum

1. Buka **Kurikulum QA** dan pastikan kesembilan kursus tampil.
2. Untuk setiap kursus, selesaikan seluruh pelajaran dan tandai **selesai**.
3. Kerjakan setiap kuis. Skor minimal untuk lulus adalah 70 (75 untuk kursus studi kasus).
4. Buka **Learning Saya** dan pastikan progres setiap kursus mencapai 100%.

## Bagian B — Menerbitkan e-Certificate

1. Pada kartu kursus yang sudah selesai 100% dan kuisnya lulus, tombol **Klaim e-Certificate** akan
   aktif. Bila belum aktif, panel akan menampilkan syarat yang belum terpenuhi — penuhi dahulu.
2. Klik **Klaim e-Certificate**. Sistem menerbitkan kode berformat \`QAT-<tahun>-<6 karakter>\`
   beserta grade berdasarkan skor kuis.
3. Buka **e-Certificate**, lalu buka tampilan cetak dan simpan sebagai PDF bila diinginkan.
4. Catat kode sertifikat dan **verification hash** Anda.

## Bagian C — Membuktikan sertifikat dapat diverifikasi

1. Buka **Verifikasi Sertifikat**.
2. Masukkan kode sertifikat Anda. Hasilnya harus menampilkan status **VALID** beserta nama, kursus,
   tanggal terbit, dan hash.
3. Coba masukkan kode yang salah (misalnya ganti satu karakter terakhir). Hasilnya harus **TIDAK
   VALID** dengan alasan yang jelas.
4. Dari halaman detail sertifikat, lakukan **revoke** dengan alasan (misalnya "uji coba"), lalu
   verifikasi kembali kode tersebut — statusnya harus berubah menjadi tidak valid beserta alasannya.
5. Terbitkan ulang sertifikat untuk kursus lain bila tersedia, sebagai contoh kedua.

## Bagian D — Menyusun portofolio

Buat dokumen \`PORTOFOLIO.md\` dengan struktur:

\`\`\`markdown
# Portofolio QA — <Nama Anda>

## Ringkasan
<Satu paragraf: fokus, jumlah artefak, hasil utama>

## Studi Kasus: <Nama Proyek>
### Konteks & risiko
### Ruang lingkup (dalam & luar cakupan)
### Pendekatan (teknik desain yang dipakai)
### Hasil (angka: requirement, use case, skenario, test case, defect, otomasi)
### Contoh temuan terbaik (satu bug, dijelaskan lengkap)
### Pelajaran & perbaikan proses

## Artefak
<Tautan ke artefak: requirements, use case, skenario, test case, matriks, defect, metrik>

## Sertifikasi
- e-Certificate: <kode> — <judul kursus> — <tanggal>
  Verifikasi: <tautan /verify/<kode>>

## Teknologi & alat
\`\`\`

## Kriteria selesai

- Minimal satu e-Certificate diterbitkan dan terverifikasi **VALID**.
- Verifikasi kode palsu menunjukkan status **TIDAK VALID** dengan alasan yang jelas.
- Satu sertifikat berhasil di-revoke dan verifikasinya berubah sesuai.
- \`PORTOFOLIO.md\` memuat minimal empat angka konkret dan satu contoh temuan lengkap.

## Refleksi

Perhatikan bahwa portofolio Anda bukan kumpulan tangkapan layar, melainkan **jejak keputusan**: apa
yang Anda pilih untuk diuji, apa yang Anda pilih untuk tidak diuji, dan bagaimana Anda membuktikan
keduanya. Itulah yang dicari oleh tim yang merekrut QA.`,
          lab_ref: '/verify',
        },
      ],
    },
  ],
  quizzes: [
    {
      title: 'Kuis Portofolio QA',
      pass_score: 70,
      order_index: 1,
      questions: [
        {
          prompt:
            'Manakah pernyataan yang paling kuat untuk portofolio QA?',
          options: [
            'Saya teliti dan detail dalam menguji aplikasi',
            'Saya melakukan pengujian komprehensif pada seluruh fitur',
            'Saya merancang 40 test case untuk 6 requirement, dengan 12 kasus batas dan 14 kasus negatif; matriks menunjukkan 0 gap',
            'Saya berpengalaman menggunakan berbagai tools pengujian',
          ],
          answer_index: 2,
          explanation:
            'Pernyataan bukti memuat angka konkret dan artefak yang dapat diperiksa. Klaim sifat seperti "teliti" atau "komprehensif" tidak dapat diverifikasi dan tidak membedakan pelamar.',
          points: 1,
        },
        {
          prompt:
            'Apa yang harus dilakukan ketika menampilkan metrik flaky rate 0% di portofolio?',
          options: [
            'Cukup menyebut 0% agar terlihat sempurna',
            'Menyebutkan basis perhitungannya, misalnya "0% dalam 20 run berturut-turut"',
            'Tidak perlu menyebut flaky rate sama sekali',
            'Menyebut angka 0% dan menambahkan bahwa suite tidak pernah diperiksa',
          ],
          answer_index: 1,
          explanation:
            'Metrik tanpa basis perhitungan mencurigakan. Menyebutkan jumlah run membuat klaim dapat diverifikasi dan menunjukkan bahwa Anda benar-benar mengukur kestabilan suite.',
          points: 1,
        },
        {
          prompt:
            'Manakah praktik yang WAJIB dilakukan saat memakai artefak dari proyek nyata untuk portofolio?',
          options: [
            'Menampilkan nama perusahaan agar terlihat kredibel',
            'Menyertakan kredensial untuk membuktikan akses',
            'Menganonimkan data, mengganti dengan data fiktif, dan menghapus kredensial serta alamat internal',
            'Menyalin seluruh database produksi',
          ],
          answer_index: 2,
          explanation:
            'Portofolio yang memuat data perusahaan nyata atau kredensial melanggar kerahasiaan dan justru menunjukkan kurangnya kesadaran profesional. Gunakan aplikasi demo atau data yang dianonimkan.',
          points: 1,
        },
        {
          prompt:
            'Dalam menjawab pertanyaan wawancara "ceritakan proyek pengujian terakhir Anda", bagian STAR mana yang paling menentukan penilaian?',
          options: [
            'Situation, karena menunjukkan konteks perusahaan',
            'Action, karena menjelaskan pilihan yang Anda ambil beserta alasannya',
            'Result, karena hanya angka yang penting',
            'Semua bagian sama pentingnya tanpa penekanan',
          ],
          answer_index: 1,
          explanation:
            'Bagian Action memperlihatkan cara berpikir: apa yang Anda pilih, mengapa, dan apa yang Anda korbankan. Jawaban yang hanya menyebut aktivitas tanpa alasan tidak membedakan kandidat.',
          points: 1,
        },
        {
          prompt:
            'Bagaimana posisi sertifikat seperti e-Certificate dalam portofolio QA?',
          options: [
            'Sertifikat adalah bukti kompetensi yang menggantikan portofolio',
            'Sertifikat adalah penanda pembelajaran yang paling kuat bila dilengkapi artefak dan narasi',
            'Sertifikat tidak berguna sama sekali',
            'Sertifikat hanya berguna bagi QA senior',
          ],
          answer_index: 1,
          explanation:
            'Sertifikat menunjukkan bahwa Anda telah mempelajari suatu topik, tetapi belum membuktikan penerapannya. Kombinasi sertifikat, artefak nyata, dan narasi keputusan memberikan gambaran paling lengkap.',
          points: 1,
        },
      ],
    },
  ],
};

export const CONTENT_C: SeedCourse[] = [databaseTesting, capstone, portfolio];
