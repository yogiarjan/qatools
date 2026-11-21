/**
 * Curriculum content, part B — courses 4–6 (automation track).
 *
 * Owned by Lane E. Pure data: no database access, no side effects.
 *
 * Courses here:
 *   4. Basic QA Automation    (pillar 'Basic QA Automation')
 *   5. API Automation         (pillar 'API Automation')
 *   6. Web Automation         (pillar 'Web Automation')
 */

import type { SeedCourse } from './types.js';

/* ==================================================================== *
 * 4 — Basic QA Automation
 * ==================================================================== */

const basicAutomation: SeedCourse = {
  slug: 'basic-qa-automation',
  title: 'Basic QA Automation: Otomasi Pertama yang Bertahan Lama',
  subtitle: 'Piramida otomasi, kapan TIDAK mengotomasi, skrip pertama, assertion, dan perawatan suite.',
  description:
    'Kursus pengantar otomasi pengujian. Anda akan belajar memilih apa yang layak diotomasi, menyusun skrip pertama berbasis API, menulis assertion yang benar-benar menguji, dan menjaga suite tetap andal sehingga tim memercayainya.',
  level: 'beginner',
  pillar: 'Basic QA Automation',
  estimated_minutes: 600,
  order_index: 4,
  icon: '🤖',
  tags: ['otomasi', 'piramida', 'assertion', 'maintainability'],
  modules: [
    {
      code: 'QA-AUTO-M1',
      title: 'Dasar & Keputusan Otomasi',
      summary: 'Piramida otomasi, ROI, dan daftar hal yang tidak boleh diotomasi.',
      order_index: 1,
      lessons: [
        {
          code: 'L-AUTO-01',
          title: 'Piramida Otomasi & ROI',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 1,
          content_md: `## Otomasi bukan tujuan, melainkan investasi

Otomasi mengubah pekerjaan berulang menjadi biaya tetap di awal (*setup*) dan biaya hampir nol di
setiap pengulangan. Karena itu otomasi baru masuk akal bila ada **pengulangan** yang cukup banyak.

### Piramida otomasi

\`\`\`text
            ╱╲          UI / End-to-End   — sedikit, lambat, mahal, rapuh
           ╱  ╲
          ╱────╲        API / Integrasi   — sedang, cepat, stabil
         ╱      ╲
        ╱────────╲      Unit / Komponen  — banyak, sangat cepat, murah
       ╱__________╲
\`\`\`

| Lapisan | Jumlah ideal | Kecepatan | Biaya rawat | Pemilik umum |
|---|---|---|---|---|
| Unit | Ratusan–ribuan | Milidetik | Sangat rendah | Developer |
| API/integrasi | Puluhan–ratusan | Ratusan ms | Rendah | QA automation |
| UI end-to-end | Belasan | Detik–menit | Tinggi | QA automation |

Piramida terbalik — banyak UI test, sedikit unit test — adalah pola kegagalan paling umum dalam
otomasi. Suite seperti itu lambat, rapuh, dan akhirnya dinonaktifkan.

### Hitung ROI-nya sebelum menulis skrip

\`\`\`text
Manfaat per bulan = (waktu manual per eksekusi) × (jumlah eksekusi per bulan)
Biaya awal        = (waktu membangun) + (waktu stabilisasi)
Biaya per bulan   = waktu perawatan

Titik impas = biaya awal / (manfaat per bulan − biaya per bulan)
\`\`\`

**Contoh nyata:**

| Faktor | Nilai |
|---|---|
| Kasus regresi login & pembayaran | 25 kasus |
| Waktu manual sekali jalan | 40 menit |
| Frekuensi eksekusi | 12× per bulan |
| Manfaat bulanan | 480 menit (8 jam) |
| Waktu membangun | 3 hari (1.440 menit) |
| Perawatan bulanan | 60 menit |
| Titik impas | 1.440 / (480 − 60) ≈ **3,4 bulan** |

Kesimpulan jujur: proyek ini baru menguntungkan setelah bulan keempat. Bila fitur tersebut akan
diganti dalam dua bulan, otomasi adalah kerugian.

### Kapan otomasi hampir selalu layak

1. Kasus yang dijalankan setiap rilis (regresi).
2. Kasus dengan data dan langkah yang stabil.
3. Perhitungan yang rumit dan mudah salah bila diperiksa manual.
4. Kasus yang memerlukan banyak kombinasi data.
5. Pemeriksaan integrasi antar sistem yang sulit dilakukan mata manusia (misalnya sinkronisasi API ↔ DB).

### Kapan otomasi sering merugikan

1. UI yang sedang berubah cepat.
2. Kasus yang dijalankan sekali (misalnya migrasi satu kali).
3. Pengujian yang membutuhkan penilaian manusia (estetika, kejelasan pesan).
4. Kasus eksploratif tanpa langkah tetap.
5. Fitur yang akan dihapus dalam waktu dekat.

### Latihan

Ambil lima kasus regresi tim Anda, hitung titik impas masing-masing memakai rumus di atas, dan
urutkan berdasarkan ROI. Hasilnya biasanya sangat berbeda dari urutan "yang paling mudah diotomasi".`,
        },
        {
          code: 'L-AUTO-02',
          title: 'Kapan TIDAK Mengotomasi',
          kind: 'reading',
          duration_minutes: 18,
          order_index: 2,
          content_md: `## Daftar keputusan yang menyelamatkan anggaran

Keinginan mengotomasi segalanya adalah tanda tim baru memulai otomasi. Berikut daftar hal yang dalam
praktik hampir selalu lebih baik tetap manual, beserta alasannya.

| Kategori | Mengapa tetap manual | Alternatif |
|---|---|---|
| Penilaian estetika & tata letak | Mata manusia menilai proporsi, jarak, keterbacaan | Checklist visual + screenshot review |
| Kualitas pesan & bahasa | Nada dan kejelasan butuh penilaian | Review konten terjadwal |
| Eksplorasi fitur baru | Tidak ada langkah tetap untuk dikodekan | Sesi eksploratif bercharter |
| UI yang sedang berubah drastis | Selector berubah setiap minggu | Tunggu UI stabil, otomasi API-nya dulu |
| Alur yang bergantung pada pihak ketiga tidak stabil | Kegagalan berasal dari luar kendali | Mock atau stub |
| Kasus sekali pakai | Biaya lebih besar dari manfaat | Checklist manual |
| Verifikasi legal/kepatuhan tertentu | Membutuhkan jejak tanda tangan manusia | Prosedur manual dengan bukti |
| Kapasitas perangkat fisik (kamera, sensor) | Butuh perangkat nyata | Manual + lab perangkat |

### Kriteria keputusan yang bisa dipakai berulang

Sebuah kasus layak diotomasi bila **semua** pernyataan berikut benar:

1. Ada hasil yang bisa dinilai otomatis (lulus/gagal objektif).
2. Langkahnya dapat diulang tanpa variasi manusia.
3. Kasus akan dijalankan minimal beberapa kali ke depan.
4. Biaya perawatan diperkirakan lebih kecil daripada manfaatnya.
5. Environment dan data uji tersedia secara terprogram.

Bila ada satu saja yang gagal, tunda otomasi.

### Tekanan yang harus dilawan

| Tekanan | Alasan masuk akal yang bisa dipakai menolak |
|---|---|
| "Semua harus otomatis" | Ukur ROI; sebagian kasus lebih murah manual |
| "Coverage harus 100%" | Angka coverage mudah dimanipulasi; yang penting risiko tertutup |
| "Otomasi ini cepat dibuat" | Skrip cepat dibuat biasanya mahal dirawat |
| "Pakai tools terbaru" | Nilai tools diukur dari keandalan suite, bukan kebaruannya |

### Alternatif sebelum mengotomasi

1. **Perbaiki testabilitas** — tambahkan ID stabil pada elemen, sediakan endpoint status.
2. **Pindahkan ke lapisan lebih rendah** — uji aturan di API, bukan lewat UI.
3. **Sederhanakan data uji** — data yang bisa dibuat otomatis jauh lebih murah diuji.
4. **Kurangi cakupan manual** — checklist yang lebih ramping lebih mungkin dijalankan konsisten.

### Latihan

Ambil daftar kasus yang tim Anda rencanakan untuk diotomasi kuartal ini. Terapkan lima kriteria di
atas. Biasanya 20–30% dari daftar akan gugur — dan menghapusnya menghemat lebih banyak waktu daripada
mengotomasinya.`,
          lab_ref: '/testcases',
        },
        {
          code: 'L-AUTO-03',
          title: 'Anatomi Skrip Otomasi Pertama',
          kind: 'reading',
          duration_minutes: 26,
          order_index: 3,
          content_md: `## Skrip pertama: sederhana, jelas, dan benar

Skrip otomasi pertama sebaiknya menyerang lapisan **API**, bukan UI. Alasannya: API stabil, cepat, dan
tidak bergantung pada tata letak.

### Struktur empat bagian

Setiap skrip otomasi yang sehat terdiri atas empat bagian yang bisa dikenali:

\`\`\`text
1. SETUP     — siapkan prasyarat & data
2. ACTION    — lakukan satu perilaku yang diuji
3. ASSERT    — periksa hasil dengan kriteria obyektif
4. TEARDOWN  — bersihkan, agar skrip bisa dijalankan ulang
\`\`\`

Bila bagian teardown hilang, skrip akan gagal pada eksekusi kedua karena data dari eksekusi pertama
masih ada. Ini penyebab paling umum "skrip saya jalan kemarin, sekarang gagal".

### Contoh lengkap (pseudo-TypeScript)

\`\`\`text
// ============ 1. SETUP ============
const baseUrl = env.get('API_BASE');            // dari konfigurasi, bukan hard-code
const email   = \`qa+\${Date.now()}@contoh.id\`;   // data unik per eksekusi
await request('POST', \`\${baseUrl}/api/users\`, { name: 'QA Uji', email });

// ============ 2. ACTION ============
const res = await request('POST', \`\${baseUrl}/api/sessions\`, {
  email,
  password: 'Rahasia#123',
});

// ============ 3. ASSERT ============
assert(res.status === 201,        'status harus 201 Created');
assert(typeof res.body.token === 'string' && res.body.token.length > 0,
       'respons harus memuat token');
assert(res.body.user.email === email, 'email pada respons harus sama dengan yang dikirim');

// ============ 4. TEARDOWN ============
await request('DELETE', \`\${baseUrl}/api/users/\${res.body.user.id}\`);
\`\`\`

### Tiga kebiasaan yang membedakan skrip amatir dan profesional

**1. Data uji dibuat oleh skrip, bukan diandalkan dari environment.**
Skrip yang bergantung pada "user demo yang sudah ada" akan rusak ketika seseorang menghapus user itu.
Seperti contoh di atas, skrip membuat email unik sendiri.

**2. Konfigurasi berasal dari luar.**
\`baseUrl\`, kredensial, dan timeout berasal dari konfigurasi environment. Ini membuat skrip yang sama
bisa dijalankan di lokal, staging, dan CI.

**3. Setiap assertion punya pesan.**
Ketika gagal di CI pada jam 2 pagi, pesan "status harus 201 Created, diterima 500" langsung menunjukkan
akar masalah. Tanpa pesan, Anda hanya tahu "assertion gagal di baris 14".

### Urutan yang harus dijaga

\`\`\`text
setup → action → assert → teardown
\`\`\`

Kesalahan umum adalah menaruh assertion di tengah setup. Akibatnya, ketika setup gagal karena masalah
environment, hasilnya terlihat seperti bug produk.

### Latihan

Tulis satu skrip untuk endpoint paling sederhana di sistem Anda (misalnya \`GET /health\` lalu
\`POST /login\`) dengan struktur empat bagian yang jelas. Fokus pada kejelasan, bukan kelengkapan.`,
          lab_ref: '/api-tester',
        },
      ],
    },
    {
      code: 'QA-AUTO-M2',
      title: 'Menulis Assertion yang Bermakna',
      summary: 'Memilih pemeriksaan yang benar-benar mendeteksi cacat, dan menghindari assertion palsu.',
      order_index: 2,
      lessons: [
        {
          code: 'L-AUTO-04',
          title: 'Assertion yang Menguji Sesuatu',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 1,
          content_md: `## Suite yang selalu hijau adalah suite yang tidak berguna

Ada dua jenis assertion palsu yang membuat suite terlihat bekerja padahal tidak menguji apa pun:

1. **Terlalu longgar** — selalu benar apa pun yang terjadi.
2. **Terlalu banyak** — memeriksa hal yang tidak berkaitan sehingga gagal karena alasan yang salah.

### Contoh assertion lemah vs kuat

| Lemah | Masalah | Kuat |
|---|---|---|
| \`assert(res.status !== 500)\` | Menerima 404, 401, bahkan 200 yang salah | \`assert(res.status === 201)\` |
| \`assert(res.body)\` | Objek kosong pun lulus | \`assert(res.body.data.id === createdId)\` |
| \`assert(res.text.includes('error') === false)\` | Halaman error dalam bahasa lain lolos | \`assert(res.body.error === undefined)\` |
| \`assert(rows.length > 0)\` | Satu baris sampah pun lulus | \`assert(rows.length === 3)\` |
| \`assert(ok)\` | Variabel \`ok\` tidak jelas asalnya | \`assert(res.body.user.email === email)\` |

### Memeriksa nilai, bukan hanya keberadaan

Untuk perhitungan, assertion harus memeriksa **nilai yang tepat**, bukan sekadar "ada angka".

\`\`\`text
Lemah : assert(res.body.total > 0)
Kuat  : assert(res.body.total === 540000)
Kuat  : assert(res.body.discount.amount === 60000)
Kuat  : assert(res.body.discount.type === 'percent')
\`\`\`

Versi kuat menguji aturan bisnis (total setelah diskon 10% dari 600.000), sedangkan versi lemah hanya
menguji bahwa sesuatu yang berupa angka muncul.

### Hukum jumlah assertion

| Situasi | Jumlah assertion |
|---|---|
| Satu perilaku diuji | 1–5 assertion yang saling terkait |
| Pemeriksaan kontrak API | Gabungkan menjadi satu pemeriksaan skema |
| Endpoint mengembalikan objek kompleks | Periksa kolom kunci, bukan seluruh respons |

Memeriksa seluruh respons secara identik (\`assert(res.body).equals(expectedJson)\`) juga rapuh: setiap
penambahan field baru akan mematahkan skrip tanpa ada bug.

### Pola yang layak dipakai berulang

**1. Periksa kode status sebelum isi body.**

\`\`\`text
assert(res.status === 200)                 // gerbang utama
assert(res.body.data.id === expected.id)   // baru isi
\`\`\`

**2. Periksa tipe dan rentang.**

\`\`\`text
assert(typeof res.body.created_at === 'string')
assert(new Date(res.body.created_at) <= new Date())
\`\`\`

**3. Periksa efek samping di sistem lain.**

\`\`\`text
const rows = await sql('SELECT promo_code FROM orders WHERE id = ?', [orderId]);
assert(rows[0].promo_code === 'PROMO10')   // membuktikan persistensi, bukan hanya respons
\`\`\`

Assertion ketiga adalah yang paling sering hilang. API bisa mengembalikan respons sukses sementara data
tidak benar-benar tersimpan — hanya pemeriksaan lapisan penyimpanan yang bisa menangkapnya.

### Latihan

Ambil satu skrip yang selalu lulus. Coba rusak aplikasinya secara sengaja (misalnya ubah satu karakter
pada perhitungan) dan lihat apakah skrip Anda gagal. Bila tidak, assertion Anda perlu diperkuat.`,
          lab_ref: '/api-tester',
        },
        {
          code: 'L-AUTO-05',
          title: 'Data Uji & Isolasi',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 2,
          content_md: `## Penyebab nomor satu suite yang tidak stabil

Sebagian besar ketidakstabilan otomasi bukan berasal dari aplikasi, melainkan dari **data uji yang
dibagi bersama**.

### Empat pola pengelolaan data uji

| Pola | Cara kerja | Kelebihan | Kekurangan |
|---|---|---|---|
| Data statis bersama | Satu set data dipakai semua skrip | Sederhana | Skrip saling mengganggu |
| Data per skrip | Setiap skrip membuat datanya sendiri | Terisolasi | Butuh waktu setup |
| Data per run | Sekali setup untuk satu run | Efisien | Kompleksitas pengelolaan |
| Data tercampur | Sebagian statis, sebagian dibuat | Seimbang | Perlu aturan yang jelas |

Untuk suite yang sedang tumbuh, **data per skrip** adalah titik awal yang paling aman.

### Teknik membuat data unik

\`\`\`text
email   : qa+20260115T1432-a7f3@contoh.id      (timestamp + potongan acak)
kode    : PRM-8F3A21                            (acak berprefiks)
nama    : Pengguna Uji a7f3                     (agar mudah dikenali saat dibersihkan)
nomor HP: 0812 + 8 digit acak
\`\`\`

Prefiks yang konsisten memudahkan pembersihan massal: semua data uji yang diawali \`qa+\` atau
\`Pengguna Uji\` dapat dihapus oleh satu perintah.

### Isolasi yang sering terlupakan

1. **Isolasi data** — data skrip A tidak dipakai skrip B.
2. **Isolasi akun** — jangan memakai akun bersama; sekali terkunci, seluruh suite gagal.
3. **Isolasi waktu** — hindari ketergantungan pada tanggal tetap; gunakan tanggal relatif.
4. **Isolasi urutan** — setiap skrip harus bisa dijalankan sendiri, tidak bergantung pada skrip lain.
5. **Isolasi environment** — perubahan konfigurasi satu skrip tidak memengaruhi yang lain.

Ketergantungan urutan adalah jebakan halus: suite yang hanya lulus bila dijalankan dari awal tidak
bisa dijalankan sebagian — dan justru di saat debug Anda perlu menjalankan sebagian.

### Pola setup–teardown yang bisa diandalkan

\`\`\`text
sebelum semua : siapkan koneksi, verifikasi environment hidup
sebelum masing-masing : buat entitas yang dibutuhkan skrip ini
sesudah masing-masing : hapus entitas yang dibuat (walau skrip gagal)
sesudah semua : bersihkan sisa data uji berprefiks qa+
\`\`\`

Poin krusial: teardown harus berjalan **walau skrip gagal**. Bila teardown hanya berjalan pada jalur
sukses, data uji akan menumpuk dan menyebabkan kegagalan berikutnya.

### Latihan

Periksa suite Anda: berapa skrip yang bergantung pada data atau akun bersama? Buat daftarnya, lalu
konversikan setidaknya satu skrip menjadi mandiri (membuat datanya sendiri) dan bandingkan
kestabilannya setelah dieksekusi berulang.`,
          lab_ref: '/db-tester',
        },
        {
          code: 'L-AUTO-09',
          title: 'Latihan: Membangun Pustaka Assertion Tim',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 3,
          content_md: `## Mengapa pustaka assertion sendiri lebih baik daripada menyalin kode

Setiap suite otomasi yang tumbuh akan mulai mengulang pola yang sama: periksa status sukses, periksa
skema respons, periksa nilai di database. Bila pola itu disalin ke setiap tes, satu perubahan format
respons memaksa Anda mengedit puluhan berkas.

Pustaka assertion kecil — beberapa fungsi bernama — menyelesaikan masalah ini sekaligus menaikkan
kualitas pemeriksaan.

### Pola yang layak menjadi fungsi bersama

| Pola berulang | Fungsi yang lahir | Keuntungan |
|---|---|---|
| Periksa status + kode error | \`expectGagalValidasi(res, 'promo_expired')\` | Pesan kegagalan konsisten |
| Periksa bentuk respons | \`expectSkema(res, skemaPesanan)\` | Cakupan kontrak seragam |
| Periksa nilai tersimpan | \`expectBaris(sql, params, { total_amount: 540000 })\` | Pemeriksaan DB jadi ringkas |
| Periksa waktu respons | \`expectCepat(res, 1500)\` | Menangkap kemunduran performa |
| Periksa urutan & jumlah | \`expectJumlah(rows, 3)\` | Menghindari \`length > 0\` yang lemah |

### Contoh pustaka minimal

\`\`\`text
// assertions.ts
export function expectStatus(res, kode, pesan = '') {
  if (res.status !== kode) {
    throw new Error(\`status diharapkan \${kode}, diterima \${res.status}\${pesan ? ' — ' + pesan : ''}\`);
  }
}

export function expectKodeError(res, kode) {
  const aktual = res.body?.error?.code;
  if (aktual !== kode) {
    throw new Error(\`kode error diharapkan "\${kode}", diterima "\${aktual}"\`);
  }
}

export function expectNilai(objek, jalur, nilai) {
  const aktual = jalur.split('.').reduce((o, k) => (o == null ? undefined : o[k]), objek);
  if (aktual !== nilai) {
    throw new Error(\`\${jalur} diharapkan \${JSON.stringify(nilai)}, diterima \${JSON.stringify(aktual)}\`);
  }
}
\`\`\`

Ketiga fungsi itu sudah menghilangkan sebagian besar duplikasi di suite berukuran sedang.

### Aturan menulis pustaka assertion

1. **Pesan kegagalan harus memuat nilai diharapkan dan nilai diterima.** Tanpa keduanya, fungsi hanya
   memindahkan kebingungan.
2. **Jangan menyembunyikan logika bisnis di dalam helper.** \`expectPromoDiterapkan(res)\` menyembunyikan
   perhitungan; lebih baik \`expectNilai(res.body, 'discount.amount', 60000)\`.
3. **Satu fungsi satu pemeriksaan.** Fungsi yang memeriksa lima hal sekaligus melaporkan kegagalan yang
   membingungkan.
4. **Nama fungsi diawali kata kerja** (\`expect…\`, \`pastikan…\`) agar terbaca sebagai kalimat di dalam tes.

### Risiko yang harus dihindari

| Risiko | Gejala | Perbaikan |
|---|---|---|
| Assertion terlalu pintar | Kegagalan sulit dilacak | Pisahkan menjadi pemeriksaan kecil |
| Terlalu banyak parameter opsional | Pemanggilan tidak terbaca | Pecah menjadi beberapa fungsi |
| Menelan kesalahan | Tes selalu lulus | Jangan pernah membungkus dengan try/catch kosong |
| Cakupan tersembunyi | Tidak jelas apa yang diperiksa | Dokumentasikan setiap fungsi |

Baris "menelan kesalahan" adalah yang paling berbahaya. Bila sebuah helper menangkap error lalu tidak
melemparkannya kembali, seluruh tes yang memakainya menjadi tidak bermakna — dan itu sulit terdeteksi
karena suite tetap hijau.

### Latihan

Periksa 10 tes Anda, catat pola pemeriksaan yang berulang, lalu ekstrak menjadi pustaka assertion kecil
dengan pesan kegagalan yang menyebut nilai diharapkan dan diterima.`,
          lab_ref: '/api-tester',
        },
      ],
    },
    {
      code: 'QA-AUTO-M3',
      title: 'Merawat Suite Otomasi',
      summary: 'Struktur kode, ketidakstabilan (flaky), laporan, dan integrasi CI.',
      order_index: 3,
      lessons: [
        {
          code: 'L-AUTO-06',
          title: 'Maintainability: Menulis Skrip yang Bertahan',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 1,
          content_md: `## Biaya sebenarnya ada di perawatan

Membuat otomasi pertama mudah. Yang sulit adalah membuatnya masih berjalan dua tahun kemudian tanpa
menghabiskan seluruh waktu tim.

### Prinsip yang menentukan umur suite

| Prinsip | Praktik | Akibat bila dilanggar |
|---|---|---|
| Pemisahan niat & mekanisme | Tes menyebut *apa* yang diuji; helper menangani *bagaimana* | Perubahan UI memaksa edit puluhan tes |
| Satu sumber definisi | Endpoint, kredensial, dan data ada di config/helper | Nilai tersebar, sulit diubah |
| Nama yang jelas | \`loginGagalKarenaPasswordSalah\` | Orang malas membaca, tes diabaikan |
| Tanpa duplikasi | Helper untuk alur berulang | Perbaikan harus dilakukan berkali-kali |
| Gagal dengan pesan | Assertion selalu berpesan | Debugging memakan waktu |
| Cepat | API dulu, UI seperlunya | Suite lambat ditinggalkan |

### Contoh pemisahan lapisan

\`\`\`text
// level tes — membaca seperti kalimat
test('kode promo kedaluwarsa ditolak', async () => {
  const sesi = await loginSebagaiPembeli();
  const hasil = await terapkanPromo(sesi, { kode: 'PROMO-LEWAT', total: 600000 });
  expect(hasil.status).toBe(400);
  expect(hasil.body.error.code).toBe('promo_expired');
  expect(hasil.body.total).toBe(600000);      // total tidak berubah
});

// helper — menyembunyikan detail endpoint
async function terapkanPromo(sesi, input) { /* detail HTTP */ }
async function loginSebagaiPembeli() { /* detail autentikasi */ }
\`\`\`

Perhatikan bahwa level tes tidak memuat URL, header, atau token. Semua itu ada di dalam helper. Ketika
endpoint berpindah dari \`/api/promo\` ke \`/api/v2/promo\`, hanya satu baris helper yang berubah.

### Aturan keras yang layak diadopsi

1. **Tidak ada \`sleep\` tetap.** Gunakan penantian berbasis kondisi. \`sleep(5000)\` adalah tanda
   ketidakstabilan, bukan solusi.
2. **Tidak ada data uji hard-code di dalam tes.** Selalu dari config atau dibuat saat itu.
3. **Tidak ada ketergantungan antar tes.** Setiap tes berdiri sendiri.
4. **Tidak ada kredensial di dalam kode.** Rahasia disimpan di variabel lingkungan.
5. **Tidak ada kode mati.** Tes yang dinonaktifkan menumpuk dan membusuk; hapus atau perbaiki.

### Isyarat suite mulai membusuk

- Waktu eksekusi bertambah setiap bulan meski kasusnya tidak bertambah.
- Semakin banyak tes yang "kadang gagal".
- Orang mulai menjalankan tes secara manual sebelum mempercayai hasilnya.
- Tidak ada yang tahu mengapa sebuah tes ditulis.
- Membaca output kegagalan tidak cukup untuk tahu penyebabnya.

Bila tiga dari lima isyarat muncul, prioritas berikutnya bukan menambah tes, melainkan merawat yang
ada.

### Latihan

Hitung waktu rata-rata yang tim Anda habiskan per bulan untuk memperbaiki tes yang rusak. Bandingkan
dengan waktu yang dibutuhkan untuk merapikan struktur suite. Angka itu adalah bahan argumen terbaik
untuk pekerjaan perawatan.`,
          lab_ref: '/web-tester',
        },
        {
          code: 'L-AUTO-07',
          title: 'Mengenali & Mengatasi Flaky Test',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 2,
          content_md: `## Flaky test: lulus dan gagal tanpa perubahan kode

Tes yang hasilnya berubah-ubah tanpa ada perubahan aplikasi disebut **flaky**. Flaky test lebih
merugikan daripada tes yang tidak ada, karena ia merusak kepercayaan pada seluruh suite.

### Dampak berantai

\`\`\`text
flaky test → tim mengabaikan hasil merah → bug nyata lolos → produksi bermasalah
\`\`\`

Sekali tim belajar mengabaikan warna merah, nilai seluruh otomasi hilang.

### Penyebab umum dan penangkalnya

| Penyebab | Gejala | Penangkal |
|---|---|---|
| Waktu tunggu tetap (\`sleep\`) | Gagal terutama di CI yang lebih lambat | Tunggu berdasarkan kondisi, bukan durasi |
| Balapan data (race) | Gagal ketika dijalankan paralel | Data unik per skrip |
| Ketergantungan urutan | Lulus penuh, gagal bila satu tes dijalankan | Setiap tes mandiri |
| Data uji tersisa | Gagal pada run kedua | Teardown selalu berjalan |
| Animasi/transisi UI | Gagal saat animasi lebih lambat | Tunggu keadaan stabil |
| Kapasitas environment | Gagal saat bersamaan dengan suite lain | Isolasi environment atau penjadwalan |
| Ketergantungan jaringan eksternal | Gagal saat pihak ketiga lambat | Mock layanan eksternal |
| Waktu/tanggal sistem | Gagal di pergantian hari/bulan | Tanggal relatif, zona waktu eksplisit |
| Cache tidak dibersihkan | Gagal setelah rilis lain | Bersihkan cache di awal run |

### Prosedur penanganan yang benar

1. **Jangan tambah \`sleep\`.** Ini menyembunyikan gejala dan memperlambat suite.
2. **Reproduksi.** Jalankan tes tersebut 20 kali berturut-turut dan catat rasio kegagalannya.
3. **Isolasi.** Jalankan sendiri; bila lulus sendiri tetapi gagal dalam suite, masalahnya adalah
   interaksi (data/urutan/paralelisme).
4. **Perbaiki akar penyebab** memakai tabel di atas.
5. **Catat tingkat flakiness** (\`flips\`) sebagai metrik berkelanjutan.
6. Bila akar penyebab belum bisa diperbaiki, **karantinakan** tes tersebut dengan tiket dan tenggat —
   jangan dihapus tanpa jejak, jangan dibiarkan mengotori hasil.

### Metrik flaky

\`\`\`text
flaky rate = jumlah kasus dengan hasil berubah / total kasus yang dieksekusi
\`\`\`

Bila flaky rate di atas 5%, kepercayaan tim biasanya sudah rusak. Target yang sehat adalah di bawah 2%.

### Kebiasaan pencegahan

- Tinjau tes baru untuk mencari \`sleep\` dan data bersama sebelum digabungkan.
- Jalankan suite lengkap dua kali berturut-turut di CI untuk mendeteksi flakiness lebih awal.
- Tampilkan daftar tes flaky di dasbor; transparansi mempercepat perbaikan.

### Latihan

Ambil tes yang paling sering gagal di suite Anda, jalankan 20 kali, dan hitung rasio kegagalannya.
Kemudian cari penyebabnya di tabel di atas dan perbaiki akarnya — bukan gejalanya.`,
          lab_ref: '/regression',
        },
        {
          code: 'L-AUTO-08',
          title: 'Menjalankan Otomasi di CI & Membaca Laporan',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 3,
          content_md: `## Otomasi yang tidak dijalankan otomatis hanyalah kode mati

Nilai otomasi muncul ketika ia berjalan tanpa diingat-ingat orang. Karena itu otomasi dan CI adalah
satu paket.

### Tahapan yang masuk akal

| Tahap CI | Isi | Target durasi |
|---|---|---|
| Setiap commit | Unit test + lint | < 5 menit |
| Setiap pull request | Unit + API test inti | < 15 menit |
| Setiap merge ke main | Suite API lengkap + smoke UI | < 30 menit |
| Terjadwal harian | Regresi penuh, lintas browser | < 2 jam |
| Sebelum rilis | Regresi penuh + pengujian performa | sesuai kebutuhan |

Prinsipnya: **semakin cepat umpan balik, semakin awal pada tahap itu dijalankan.**

### Gerbang kualitas di CI

\`\`\`text
Pull request GAGAL bila:
  - ada unit test gagal
  - ada API test inti gagal
  - pass rate suite di bawah ambang yang disepakati
  - terdapat tes flaky yang ditandai "blocking"
\`\`\`

Gerbang harus dipasang pada tes yang andal. Menjadikan tes flaky sebagai penghalang merge akan membuat
tim mencari jalan pintas untuk melewatinya.

### Membaca laporan kegagalan dengan cepat

Urutan yang menghemat waktu:

1. **Lihat status dan durasi.** Kegagalan pada 0,1 detik biasanya masalah setup, bukan produk.
2. **Lihat assertion pertama yang gagal**, bukan yang terakhir.
3. **Lihat bukti terlampir** — respons API, screenshot, potongan log.
4. **Bedakan** kegagalan produk, kegagalan data, dan kegagalan environment.
5. **Catat**, jangan perbaiki langsung, bila kegagalan bersifat flaky.

### Klasifikasi kegagalan yang harus dilatih

| Jenis | Tanda | Tindakan |
|---|---|---|
| Produk | Gagal konsisten di semua environment | Laporkan sebagai defect |
| Data | Gagal karena data hilang/terpakai | Perbaiki setup data |
| Environment | Gagal saat service lain mati | Perbaiki infrastruktur |
| Skrip | Gagal karena selector/endpoint berubah | Perbarui skrip |
| Flaky | Kadang lulus, kadang gagal | Perbaiki akar penyebab |

Melatih klasifikasi ini sangat berharga: tanpa itu, tim akan melaporkan masalah infrastruktur sebagai
bug produk, dan kredibilitas QA merosot.

### Artefak yang harus disimpan dari setiap run

1. **Laporan hasil** (format terstruktur) untuk pembacaan mesin.
2. **Log lengkap** untuk investigasi.
3. **Bukti visual** untuk kegagalan UI.
4. **Snapshot konfigurasi** (versi build, environment, versi data) agar bisa direproduksi.
5. **Riwayat tren** untuk melihat apakah kestabilan membaik.

### Latihan

Lihat lima kegagalan CI terakhir di tim Anda. Klasifikasikan memakai tabel di atas. Distribusinya
biasanya mengejutkan: sering kali mayoritas "kegagalan" bukan defect produk.`,
          lab_ref: '/execute',
        },
      ],
    },
  ],
  quizzes: [
    {
      title: 'Kuis Dasar Otomasi',
      pass_score: 70,
      order_index: 1,
      questions: [
        {
          prompt:
            'Sebuah tim memiliki 400 tes UI dan 20 unit test. Apa masalah utama dari konfigurasi piramida ini?',
          options: [
            'Tidak masalah, UI test paling mendekati pengalaman pengguna',
            'Piramida terbalik: suite menjadi lambat, mahal dirawat, dan rapuh sehingga akhirnya ditinggalkan',
            'Jumlah unit test tidak memengaruhi apa pun',
            'UI test tidak bisa diotomasi',
          ],
          answer_index: 1,
          explanation:
            'Piramida otomasi menempatkan unit test sebagai fondasi terbanyak dan UI test paling sedikit. Konfigurasi terbalik menghasilkan eksekusi lambat, biaya perawatan tinggi, dan kegagalan yang sulit didiagnosis.',
          points: 1,
        },
        {
          prompt:
            'Kapan otomasi paling TIDAK layak dilakukan?',
          options: [
            'Kasus regresi yang dijalankan setiap rilis',
            'Kasus dengan data dan langkah yang stabil',
            'Kasus sekali pakai atau fitur yang akan dihapus dalam waktu dekat',
            'Perhitungan rumit yang mudah salah bila diperiksa manual',
          ],
          answer_index: 2,
          explanation:
            'Otomasi membutuhkan pengulangan agar investasi awalnya kembali. Untuk kasus sekali pakai atau fitur yang akan segera dihapus, biaya membangun dan merawat lebih besar daripada manfaatnya.',
          points: 1,
        },
        {
          prompt:
            'Manakah assertion yang paling kuat untuk menguji perhitungan diskon pada respons API?',
          options: [
            'assert(res.status !== 500)',
            'assert(res.body !== null)',
            'assert(res.body.total === 540000 && res.body.discount.amount === 60000)',
            'assert(res.body.total > 0)',
          ],
          answer_index: 2,
          explanation:
            'Assertion kuat memeriksa nilai yang tepat sesuai aturan bisnis. Pemeriksaan "bukan 500" atau "lebih besar dari nol" akan lulus meskipun perhitungannya salah.',
          points: 1,
        },
        {
          prompt:
            'Sebuah tes gagal pada run kedua tetapi lulus pada run pertama. Penyebab paling mungkin adalah…',
          options: [
            'Bug pada aplikasi yang muncul secara acak',
            'Data uji dari run pertama tidak dibersihkan sehingga mengganggu run kedua',
            'Kesalahan pada browser',
            'Assertion terlalu banyak',
          ],
          answer_index: 1,
          explanation:
            'Pola "lulus sekali, gagal kedua kali" hampir selalu menunjuk pada teardown yang tidak berjalan atau data bersama yang terpakai. Teardown wajib dijalankan meskipun skrip gagal.',
          points: 1,
        },
        {
          prompt:
            'Apa tindakan yang tepat ketika menemukan tes yang flaky?',
          options: [
            'Menambahkan sleep agar lebih stabil',
            'Menghapus tes tanpa jejak',
            'Mencari akar penyebab (waktu tunggu, data bersama, urutan, lingkungan), memperbaikinya, dan mengarantina dengan tiket bila belum bisa diperbaiki',
            'Mengabaikan hasilnya dan melanjutkan',
          ],
          answer_index: 2,
          explanation:
            'Menambah sleep menyembunyikan gejala dan memperlambat suite. Menghapus tanpa jejak menghilangkan cakupan. Yang benar adalah mendiagnosis akar penyebab, dan bila belum teratasi, mengarantina dengan tiket serta tenggat.',
          points: 1,
        },
        {
          prompt:
            'Tes gagal 0,2 detik setelah dimulai dengan pesan koneksi ditolak. Klasifikasi yang paling mungkin adalah…',
          options: [
            'Defect produk',
            'Kegagalan environment (layanan tidak tersedia)',
            'Assertion yang lemah',
            'Data uji yang salah',
          ],
          answer_index: 1,
          explanation:
            'Kegagalan yang sangat cepat dengan pesan koneksi biasanya berasal dari layanan yang tidak berjalan atau konfigurasi alamat yang salah, bukan dari perilaku produk yang diuji.',
          points: 1,
        },
      ],
    },
  ],
};

/* ==================================================================== *
 * 5 — API Automation
 * ==================================================================== */

const apiAutomation: SeedCourse = {
  slug: 'api-automation',
  title: 'API Automation: Menguji Kontrak & Alur Layanan',
  subtitle: 'HTTP, status code, autentikasi, skema JSON, contract testing, chaining, dan CI.',
  description:
    'Kursus otomasi API dari dasar sampai tingkat lanjut. Anda akan menguji status code dan body secara benar, menangani autentikasi, memvalidasi skema JSON, menyusun rantai request, dan menjalankan suite API di pipeline CI.',
  level: 'intermediate',
  pillar: 'API Automation',
  estimated_minutes: 840,
  order_index: 5,
  icon: '🔌',
  tags: ['api', 'http', 'json-schema', 'contract-testing', 'ci'],
  modules: [
    {
      code: 'QA-API-M1',
      title: 'Fundamental HTTP untuk QA',
      summary: 'Metode, status code, header, dan perbedaan semantik yang menentukan hasil uji.',
      order_index: 1,
      lessons: [
        {
          code: 'L-API-01',
          title: 'Metode, Idempotensi, dan Semantik HTTP',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 1,
          content_md: `## HTTP adalah kontrak, bukan sekadar alat angkut

Banyak bug integrasi bukan berasal dari logika bisnis, melainkan dari penggunaan HTTP yang menyimpang
dari semantiknya. Memahami semantik ini membuat Anda bisa merancang test case yang tepat.

### Metode dan janjinya

| Metode | Arti | Idempoten? | Aman? | Punya body? |
|---|---|---|---|---|
| GET | Ambil representasi | Ya | Ya | Tidak |
| POST | Buat sumber daya baru | **Tidak** | Tidak | Ya |
| PUT | Ganti seluruh sumber daya | Ya | Tidak | Ya |
| PATCH | Ubah sebagian | Biasanya Ya | Tidak | Ya |
| DELETE | Hapus sumber daya | Ya | Tidak | Tidak |
| HEAD | Seperti GET tanpa body | Ya | Ya | Tidak |
| OPTIONS | Tanyakan kemampuan | Ya | Ya | Tidak |

### Idempotensi — konsep yang paling sering diabaikan

**Idempoten** berarti menjalankan request yang sama beberapa kali menghasilkan keadaan akhir yang sama.

\`\`\`text
Idempoten (aman diulang):
  PUT   /api/users/123  { "nama": "Andi" }   → hasil sama berapa kali pun dijalankan
  DELETE /api/users/123                       → kali kedua: 404, keadaan tetap "tidak ada"

TIDAK idempoten:
  POST  /api/users      { "nama": "Andi" }    → membuat user baru setiap kali!
\`\`\`

Ini bukan teori. Ini sumber bug paling mahal di aplikasi nyata: **pengguna menekan tombol Simpan dua
kali** dan pesanan tercatat dua kali, atau saldo terpotong dua kali. Karena itu:

1. Setiap request POST yang memicu efek samping finansial harus punya perlindungan idempotensi
   (biasanya lewat *idempotency key*).
2. QA harus menguji pengiriman ulang request yang sama.

\`\`\`text
Kasus uji:
TC-1: POST /orders dengan header Idempotency-Key: abc123 → 201, 1 pesanan
TC-2: Ulangi POST yang sama dengan key sama             → 200, tetap 1 pesanan (bukan 2)
TC-3: POST yang sama dengan key berbeda                 → 201, menjadi 2 pesanan (perilaku benar)
\`\`\`

### Header yang penting bagi QA

| Header | Fungsi | Yang harus diuji |
|---|---|---|
| Content-Type | Format body | Kirim JSON dengan header \`text/plain\` → harusnya 415 |
| Accept | Format yang diinginkan | \`Accept: application/xml\` → 406 atau konversi |
| Authorization | Kredensial | Token hilang, kedaluwarsa, format salah |
| Cache-Control | Aturan cache | Data sensitif tidak ter-cache |
| X-Request-Id | Penelusuran | Ada di respons untuk korelasi log |
| Location | URL sumber daya baru | Ada pada 201 |

### Kesalahan semantik yang sering diuji QA

1. Menggunakan GET untuk mengubah data (melanggar "aman") — berbahaya karena bisa di-prefetch.
2. Mengembalikan 200 untuk kegagalan validasi.
3. POST diulang menciptakan data ganda tanpa perlindungan.
4. DELETE mengembalikan 200 padahal tidak ada yang dihapus.
5. PUT yang seharusnya PATCH sehingga menghapus field yang tidak dikirim.

### Latihan

Ambil tiga endpoint POST di sistem Anda yang memicu efek samping (pembuatan data, pembayaran, kirim
email). Untuk masing-masing, tulis test case yang mengirim request yang sama dua kali, lalu periksa apa
yang terjadi.`,
          lab_ref: '/api-tester',
        },
        {
          code: 'L-API-02',
          title: 'Status Code & Kontrak Respons',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 2,
          content_md: `## Status code adalah bahasa yang harus diucapkan dengan benar

Klien (aplikasi mobile, integrasi mitra, crawler) mengambil keputusan berdasarkan status code. Status
yang salah membuat klien berperilaku salah.

### Keluarga status code

| Keluarga | Arti | Umum dipakai |
|---|---|---|
| 2xx | Berhasil | 200, 201, 202, 204 |
| 3xx | Pengalihan | 301, 302, 304 |
| 4xx | Kesalahan sisi klien | 400, 401, 403, 404, 409, 422, 429 |
| 5xx | Kesalahan sisi server | 500, 502, 503, 504 |

### Nuansa yang membedakan QA pemula dan mahir

| Status | Kapan tepat | Kesalahan umum |
|---|---|---|
| 200 | GET/PUT/PATCH berhasil dengan body | Dipakai untuk POST yang membuat sumber daya |
| 201 | Sumber daya baru dibuat + header Location | Body memuat ID yang dibuat |
| 202 | Diterima, diproses asinkron | Klien tidak diberi cara memantau status |
| 204 | Berhasil tanpa body | Mengembalikan body kosong tapi header panjang |
| **401** | Belum terautentikasi (tidak ada/valid token) | Dicampur dengan 403 |
| **403** | Terautentikasi tapi tidak berwenang | Mengembalikan 404 untuk menyembunyikan (kadang disengaja) |
| 404 | Sumber daya tidak ada | Dipakai untuk validasi body yang salah |
| **400** | Permintaan cacat (format/sintaks) | Dicampur dengan 422 |
| **422** | Sintaks benar, isi tidak memenuhi aturan bisnis | Paling sering salah: memakai 400 |
| 409 | Konflik keadaan (duplikat, versi tidak cocok) | Dipakai untuk validasi generik |
| 429 | Terlalu banyak permintaan | Tidak menyertakan header Retry-After |

### Perbedaan 401 vs 403

Ini termasuk pengujian otorisasi yang paling sering salah.

\`\`\`text
Kasus A: token tidak dikirim                    → 401 (belum terautentikasi)
Kasus B: token kedaluwarsa                      → 401
Kasus C: token sah, tetapi user bukan pemilik   → 403
Kasus D: token sah, resource tidak ada          → 404
Kasus E: token sah milik user lain, mencoba akses via ID di URL
                                                → 403 (atau 404 bila sengaja disembunyikan)
\`\`\`

Kasus E adalah pengujian **IDOR** (insecure direct object reference) — salah satu celah keamanan paling
umum di API. Setiap endpoint dengan ID di URL harus diuji dengan token milik user lain.

### Perbedaan 400 vs 422

\`\`\`text
400 Bad Request:
  {"umur": "dua puluh"}          → tipe data salah, sintaks tidak dapat diproses
  body bukan JSON yang valid

422 Unprocessable Entity:
  {"email": "bukan-email"}       → sintaks JSON benar, format field salah
  {"tanggal": "2026-02-30"}      → tanggal tidak ada
  {"usia": 15}                   → melanggar aturan bisnis (minimum 17)
\`\`\`

Banyak API memakai 400 untuk keduanya, dan itu keputusan yang sah asalkan **konsisten**. Yang tidak
boleh adalah mengembalikan 200 dengan body berisi pesan error.

### Struktur body respons yang sehat

\`\`\`text
Sukses (single) : { "data": { ... } }
Sukses (list)   : { "data": [ ... ], "total": 128, "limit": 20, "offset": 0 }
Error           : { "error": { "code": "promo_expired",
                               "message": "Kode promo sudah kedaluwarsa",
                               "details": { "expired_at": "2026-01-01T00:00:00Z" } } }
\`\`\`

Tiga alasan struktur ini penting untuk QA:

1. **Kode error yang stabil** bisa di-assert tanpa bergantung pada teks pesan (yang bisa berubah bahasa).
2. **Detail terstruktur** memungkinkan pengujian presisi.
3. **Konsistensi** membuat satu helper assertion bisa dipakai di seluruh suite.

### Daftar periksa pengujian endpoint

Untuk setiap endpoint, uji minimal:

1. Happy path → status benar + body benar.
2. Validasi: field wajib hilang → 400/422 dengan kode error yang tepat.
3. Validasi: tipe data salah → 400.
4. Validasi: aturan bisnis dilanggar → 422 dengan detail.
5. Autentikasi: tanpa token → 401.
6. Otorisasi: token user lain → 403.
7. Tidak ditemukan: ID tidak ada → 404.
8. Konflik: data duplikat → 409.
9. Batas: ukuran/paginasi ekstrem.
10. Idempotensi: kirim ulang request yang sama.

Sepuluh kasus per endpoint bukanlah berlebihan; ini standar minimum untuk API yang dipakai klien luar.

### Latihan

Ambil satu endpoint di sistem Anda dan jalankan sepuluh pemeriksaan di atas. Catat setiap status yang
tidak sesuai dengan semantik HTTP.`,
          lab_ref: '/api-tester',
        },
        {
          code: 'L-API-09',
          title: 'Latihan: Matriks Uji Endpoint Lengkap',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 3,
          content_md: `## Sepuluh kasus yang sama untuk setiap endpoint

Daftar periksa adalah cara paling andal menjaga konsistensi cakupan. Modul ini mengubah daftar itu
menjadi matriks yang bisa diisi dan diaudit.

### Matriks pengujian endpoint

| # | Kasus | Input | Status diharapkan | Yang diperiksa |
|---|---|---|---|---|
| 1 | Happy path | Data valid lengkap | 200/201 | Body, skema, efek samping |
| 2 | Field wajib hilang | Hapus satu field wajib | 400/422 | \`error.code\` spesifik |
| 3 | Tipe data salah | String pada field angka | 400 | Tidak ada 500 |
| 4 | Aturan bisnis dilanggar | Usia di bawah minimum | 422 | Detail terstruktur |
| 5 | Tanpa autentikasi | Tanpa header Authorization | 401 | Tidak ada kebocoran data |
| 6 | Otorisasi kurang | Token pengguna lain | 403/404 | Tidak ada akses lintas akun |
| 7 | Sumber daya tidak ada | ID tidak dikenal | 404 | Pesan jelas |
| 8 | Konflik | Data duplikat | 409 | Kode error sesuai |
| 9 | Batas | Ukuran/paginasi ekstrem | 200 atau 422 | Tidak timeout, tidak 500 |
| 10 | Idempotensi | Ulangi request yang sama | 200/201 | Tidak ada duplikasi |

### Contoh terisi untuk endpoint pembuatan pesanan

\`\`\`text
POST /api/orders

#1  { cart_id: "cart_1", payment: "card" }   → 201  data.id, data.total, header Location
#2  { payment: "card" }                      → 400  error.code = "cart_id_required"
#3  { cart_id: 123, payment: "card" }        → 400  error.code = "invalid_type"
#4  { cart_id: "cart_kosong" }               → 422  error.code = "cart_empty"
#5  tanpa header Authorization               → 401
#6  cart milik pengguna lain                  → 403
#7  { cart_id: "cart_tidak_ada" }            → 404  error.code = "cart_not_found"
#8  cart yang sudah di-checkout               → 409  error.code = "cart_already_ordered"
#9  cart dengan 500 item                      → 200/422 (bukan 500, bukan timeout)
#10 request #1 diulang dengan key sama        → 200  tetap satu pesanan
\`\`\`

### Memeriksa nilai, bukan hanya status

Status saja tidak cukup. Tambahkan pemeriksaan berikut pada setiap baris matriks:

| # | Pemeriksaan tambahan |
|---|---|
| 1 | Bandingkan seluruh field penting dengan yang dikirim; periksa baris di database |
| 2 | Pastikan pesan menyebut field mana yang bermasalah |
| 3 | Pastikan tidak ada data yang tersimpan sebagian |
| 4 | Pastikan struktur detail memuat nilai yang dilanggar |
| 5 | Pastikan tidak ada informasi internal yang bocor |
| 6 | Pastikan tidak ada data pengguna lain di dalam respons |
| 7 | Pastikan tidak ada perbedaan perilaku yang membocorkan keberadaan data |
| 8 | Pastikan pesan memberi tahu cara mengatasi |
| 9 | Ukur waktu respons, pastikan di bawah 2 detik |
| 10 | Hitung baris di database sebelum dan sesudah |

### Membuat matriks ini hidup

Isi matriks untuk setiap endpoint baru, simpan sebagai artefak, dan perbarui saat kontrak berubah.
Manfaatnya nyata:

1. **Cakupan konsisten** — tidak bergantung pada siapa yang menguji hari itu.
2. **Onboarding cepat** — QA baru langsung tahu apa yang harus diuji.
3. **Audit mudah** — dapat membuktikan endpoint sudah diuji menyeluruh.
4. **Otomasi terarah** — setiap baris adalah kandidat test case otomatis.

### Latihan

Buat matriks ini untuk dua endpoint berbeda (satu GET berparameter, satu POST yang menulis data). Isi
seluruh sepuluh baris dan catat setiap penyimpangan dari semantik HTTP.`,
          lab_ref: '/api-tester',
        },
      ],
    },
    {
      code: 'QA-API-M2',
      title: 'Autentikasi & Validasi Respons',
      summary: 'Bearer, API key, OAuth, JWT, validasi skema JSON, dan pemeriksaan header.',
      order_index: 2,
      lessons: [
        {
          code: 'L-API-03',
          title: 'Autentikasi & Otorisasi dalam Pengujian',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 1,
          content_md: `## Tiga pertanyaan yang harus dijawab setiap suite API

1. Apakah request **tanpa** kredensial ditolak?
2. Apakah request dengan kredensial yang **tidak berwenang** ditolak?
3. Apakah kredensial yang **kedaluwarsa** ditolak?

Banyak suite hanya menguji jalur sukses dengan token yang selalu valid, sehingga seluruh kelas bug
otorisasi tidak pernah terdeteksi.

### Jenis autentikasi yang akan Anda temui

| Jenis | Cara kerja | Yang diuji QA |
|---|---|---|
| Basic | \`Authorization: Basic base64(user:pass)\` | Kredensial salah, tanpa header, skema salah |
| Bearer/JWT | \`Authorization: Bearer <token>\` | Kedaluwarsa, tanda tangan salah, klaim kurang |
| API Key | Header atau query param | Key hilang, key dicabut, key salah ruang lingkup |
| OAuth 2.0 | Token dari server otorisasi | Refresh, ruang lingkup, token dicabut |
| Session cookie | Cookie sesi | Kedaluwarsa, cookie tanpa atribut keamanan |

### Matriks pengujian otorisasi

| Skenario | Kredensial | Ekspektasi |
|---|---|---|
| Tanpa header Authorization | — | 401 |
| Skema salah (\`Auth: token123\`) | Ada | 401 |
| Token rusak (\`Bearer abc\`) | Ada | 401 |
| Token kedaluwarsa | Ada | 401 |
| Token sah, peran tidak berwenang | Ada | 403 |
| Token sah, sumber daya milik user lain | Ada | 403 atau 404 |
| Token sah, peran benar | Ada | 200/201 |
| Token dicabut | Ada | 401 |

### Pengujian JWT secara praktis

Karena JWT adalah base64 yang bisa didekode, QA dapat memeriksa isinya:

\`\`\`text
Bagian      : header.payload.signature (dipisah titik)
Yang diperiksa:
  - exp (kedaluwarsa) — apakah wajar? Terlalu panjang = risiko
  - iat / nbf — waktu terbit dan berlaku
  - aud — untuk layanan siapa token ini
  - iss — siapa yang menerbitkan
  - peran/ruang lingkup — apakah sesuai kebutuhan endpoint
  - apakah ada data sensitif di payload (JWT hanya dikodekan, TIDAK dienkripsi!)
\`\`\`

Poin terakhir adalah temuan yang sering muncul: data pribadi yang diletakkan dalam klaim JWT dapat
dibaca siapa pun yang memegang token.

### Celah otorisasi yang harus selalu diuji

1. **IDOR** — ganti ID di URL dengan milik user lain.
2. **Eskalasi peran** — kirim field \`role: "admin"\` pada body pembaruan profil.
3. **Mass assignment** — kirim field yang tidak seharusnya bisa diubah.
4. **Akses metode berbeda** — endpoint GET dilindungi, tetapi DELETE di endpoint sama tidak.
5. **Penyamaran** — header seperti \`X-User-Id\` yang dipercaya mentah oleh server.
6. **Akses ke berkas** — path traversal pada endpoint unduhan.

Contoh nyata pengujian mass assignment:

\`\`\`text
PATCH /api/profile
  { "nama": "Andi", "role": "admin", "saldo": 999999 }

Ekspektasi: hanya "nama" yang berubah.
Bug: "role" berubah menjadi admin.
\`\`\`

Satu request sederhana ini dapat mengungkap celah yang jauh lebih berbahaya daripada bug fungsional
biasa.

### Penanganan kredensial di otomasi

- Simpan di variabel lingkungan atau secret manager, **tidak pernah** di dalam kode.
- Gunakan akun uji khusus, bukan akun nyata karyawan.
- Sediakan mekanisme refresh token agar suite panjang tidak gagal karena token habis.
- Pastikan log tidak mencetak nilai token.

### Latihan

Untuk satu endpoint terproteksi di sistem Anda, jalankan delapan skenario pada matriks otorisasi, lalu
coba satu percobaan mass assignment.`,
          lab_ref: '/api-tester',
        },
        {
          code: 'L-API-04',
          title: 'Validasi Skema JSON & Header',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 2,
          content_md: `## Memeriksa bentuk, bukan hanya nilai

Assertion nilai (\`res.body.total === 540000\`) menjawab pertanyaan "apakah nilainya benar?". Assertion
skema menjawab pertanyaan yang berbeda: "apakah bentuk responsnya masih sesuai kontrak?".

Keduanya diperlukan. Tanpa validasi skema, perubahan yang menghilangkan field atau mengubah tipe data
bisa lolos meski nilai yang diperiksa tetap benar.

### Contoh skema minimal

\`\`\`text
{
  "type": "object",
  "required": ["data"],
  "properties": {
    "data": {
      "type": "object",
      "required": ["id", "email", "created_at"],
      "properties": {
        "id":         { "type": "string" },
        "email":      { "type": "string", "format": "email" },
        "name":       { "type": ["string", "null"] },
        "created_at": { "type": "string", "format": "date-time" },
        "roles":      { "type": "array", "items": { "type": "string" } }
      }
    }
  }
}
\`\`\`

Perhatikan \`"name": ["string", "null"]\` — field yang boleh kosong harus dinyatakan eksplisit. Bila tidak,
hipotesis "boleh null" tidak pernah diuji.

### Yang dicakup validasi skema

| Aspek | Pertanyaan | Contoh kegagalan |
|---|---|---|
| Field wajib | Apakah selalu ada? | \`id\` hilang pada respons tertentu |
| Tipe data | Apakah tipenya konsisten? | \`id\` kadang angka, kadang string |
| Format | Apakah formatnya benar? | \`created_at\` bukan ISO-8601 |
| Enum | Apakah nilainya dalam daftar? | \`status: "PROCESS"\` di luar daftar |
| Nullability | Apakah null diizinkan? | \`name\` null padahal skema bilang string |
| Tipe elemen array | Apakah isinya konsisten? | Array berisi campuran objek dan string |
| Field tambahan | Apakah ada yang tidak diharapkan? | Data internal bocor di respons |

### Tabel field yang harus diuji nullability-nya

Setiap field opsional berpotensi menimbulkan bug ketika nilainya kosong:

| Field | Kasus uji |
|---|---|
| name | Dikosongkan saat pembuatan |
| avatar_url | Belum diunggah |
| phone | Belum diverifikasi |
| deleted_at | Belum dihapus |
| last_login | Belum pernah login |

Bug klasik: aplikasi berjalan baik selama semua field terisi, lalu gagal pada user pertama yang belum
mengunggah foto profil.

### Pemeriksaan header yang sering terlupakan

| Header | Yang diperiksa |
|---|---|
| Content-Type | \`application/json; charset=utf-8\` konsisten |
| Cache-Control | Endpoint data sensitif memakai \`no-store\` |
| X-Request-Id | Ada untuk penelusuran |
| Location | Ada pada 201 |
| Retry-After | Ada pada 429 |
| Set-Cookie | Atribut \`Secure\`, \`HttpOnly\`, \`SameSite\` |
| Content-Security-Policy | Ada pada endpoint yang menyajikan HTML |

### Urutan pemeriksaan yang efisien

1. Status code.
2. Header kunci (Content-Type, Cache-Control bila sensitif).
3. Validasi skema.
4. Assertion nilai untuk field penting.
5. Efek samping (query database) untuk operasi tulis.

Urutan ini memastikan kegagalan yang jelas dilaporkan lebih dulu, sehingga pesan error tetap mudah
dibaca.

### Latihan

Ambil respons terbesar di API Anda dan tulis skemanya. Jalankan validasi skema pada lima kasus berbeda
(termasuk kasus dengan field opsional kosong) dan catat pelanggaran yang muncul.`,
          lab_ref: '/api-tester',
        },
        {
          code: 'L-API-10',
          title: 'Latihan: Menguji Skema & Nullability',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 3,
          content_md: `## Yang paling sering rusak adalah field yang kosong

Bug pada API jarang muncul ketika data lengkap. Ia muncul saat sebuah field opsional benar-benar kosong
untuk pertama kalinya — dan itu biasanya terjadi pada pengguna nyata, bukan pada data uji.

### Latihan terstruktur

1. **Inventarisasi field opsional.** Untuk satu endpoint detail, daftar seluruh field dan tandai mana yang
   boleh kosong menurut kontrak.
2. **Buat kasus kosong.** Untuk setiap field opsional, buat satu entitas uji yang field tersebut benar-benar
   kosong.
3. **Periksa tiga lapisan.** Respons API, tampilan antarmuka, dan nilai tersimpan di database.
4. **Catat pelanggaran skema.** Setiap perbedaan bentuk respons (tipe berubah, field hilang) adalah temuan.

### Tabel kerja

| Field | Wajib? | Nilai kosong | Bentuk respons | Tampilan UI | Nilai DB | Temuan |
|---|---|---|---|---|---|---|
| name | ya | — | string | tampil | string | — |
| avatar_url | tidak | null | string/null | ada placeholder? | null | ? |
| phone | tidak | null | string/null | tampil "—"? | null | ? |
| last_login | tidak | null | string/null | "Belum pernah"? | null | ? |
| deleted_at | tidak | null | string/null | tidak tampil | null | ? |

### Pola kegagalan yang hampir selalu muncul

| Pola | Gejala | Lapisan tempat terlihat |
|---|---|---|
| Tipe tidak konsisten | \`name\` kadang string, kadang null | Skema respons |
| Field hilang total | \`avatar_url\` tidak ada sama sekali, bukan null | Skema respons |
| Kesalahan tampilan | Teks "null" tercetak di layar | Antarmuka |
| Crash pemformatan | Tanggal null diformat langsung | Antarmuka |
| Kesalahan penyimpanan | String kosong disimpan alih-alih NULL | Database |
| Filter bocor | Entitas dengan field kosong hilang dari daftar | Query |

Baris terakhir sangat berbahaya: entitas dengan field kosong bisa **hilang dari daftar** karena kondisi
filter yang tidak menangani NULL — persis masalah \`<> NULL\` yang dibahas pada kursus Database Testing.

### Kasus khusus: string kosong vs null

Banyak sistem memperlakukan keduanya berbeda. Uji ketiganya:

\`\`\`text
1. Field tidak dikirim sama sekali         → harapan: nilai bawaan atau null
2. Field dikirim sebagai null              → harapan: null tersimpan
3. Field dikirim sebagai string kosong ""  → harapan: ditolak, atau dikonversi konsisten ke null
\`\`\`

Bila ketiganya menghasilkan perilaku berbeda tanpa aturan yang jelas, itu temuan tersendiri.

### Latihan

Jalankan latihan ini untuk satu endpoint detail di sistem Anda. Isi tabel kerja sepenuhnya, lalu
laporkan setiap pelanggaran skema atau ketidakkonsistenan penanganan nilai kosong.`,
          lab_ref: '/api-tester',
        },
      ],
    },
    {
      code: 'QA-API-M3',
      title: 'Contract Testing & Chaining',
      summary: 'Menjaga kesepakatan antar layanan, dan menyusun alur end-to-end dari request API.',
      order_index: 3,
      lessons: [
        {
          code: 'L-API-05',
          title: 'Contract Testing & Versioning',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 1,
          content_md: `## Masalah: dua tim, dua pemahaman

Layanan A memanggil layanan B. Tim A menganggap field \`user_id\` selalu ada. Tim B mengganti nama field
menjadi \`userId\` di versi baru. Tidak ada tes unit di salah satu sisi yang menangkap masalah ini —
keduanya lulus, tetapi integrasi di produksi gagal.

**Contract testing** menutup celah ini dengan memverifikasi kesepakatan (kontrak) antara penyedia dan
konsumen.

### Dua peran

| Peran | Tanggung jawab | Artefak |
|---|---|---|
| Provider (penyedia API) | Memenuhi kontrak | Skema OpenAPI, contoh respons |
| Consumer (pemakai API) | Menyatakan kebutuhannya | Ekspektasi field & perilaku |

### Jenis pemeriksaan kontrak

| Jenis | Cara kerja | Menangkap |
|---|---|---|
| Validasi skema respons | Bandingkan respons nyata dengan skema | Field hilang, tipe berubah |
| Snapshot kontrak | Simpan respons, bandingkan dengan sebelumnya | Perubahan tak sengaja |
| Consumer-driven contract | Konsumen mendefinisikan ekspektasi, penyedia diverifikasi | Ketidakcocokan kebutuhan nyata |
| Uji kompatibilitas versi | Jalankan suite lama terhadap API baru | Perubahan yang memutus klien lama |

### Perubahan yang memutus (breaking) vs tidak

| Perubahan | Breaking? | Alasan |
|---|---|---|
| Menambah field opsional baru | Tidak | Klien lama mengabaikannya |
| Menghapus field | **Ya** | Klien yang memakainya rusak |
| Mengubah nama field | **Ya** | Sama dengan hapus + tambah |
| Mengubah tipe (string → number) | **Ya** | Parsing klien gagal |
| Mengubah format nilai | **Ya** | Parsing tanggal/nilai gagal |
| Menambah nilai enum baru | Berpotensi | Klien dengan \`switch\` tanpa default bisa gagal |
| Mengubah pesan error (teks) | Tidak | Asalkan kode error tetap |
| Mengubah kode error | **Ya** | Klien yang memeriksa kode akan rusak |
| Menambah validasi lebih ketat | Berpotensi | Request yang dulu sah kini ditolak |
| Menurunkan batas rate limit | Berpotensi | Klien normal bisa terkena 429 |

Poin yang paling sering luput: **menambah validasi lebih ketat** dan **menambah nilai enum**. Keduanya
terasa seperti perbaikan, tetapi bisa memutus klien yang sudah berjalan.

### Strategi versioning

\`\`\`text
URL versioning      : /api/v1/orders  → /api/v2/orders     (paling mudah diuji)
Header versioning   : Accept: application/vnd.api+json;version=2
Query versioning    : /api/orders?version=2
Tanpa versioning    : hanya perubahan kompatibel yang diizinkan
\`\`\`

Yang penting bagi QA bukan memilih strategi, melainkan **menguji masa transisi**:

1. Apakah versi lama masih berfungsi setelah versi baru rilis?
2. Apakah data yang ditulis lewat versi lama terbaca benar di versi baru?
3. Apakah ada tanggal penghentian yang diumumkan, dan apakah QA menguji perilaku setelah tanggal itu?
4. Apakah klien lama menerima pesan penghentian yang jelas?

### Daftar periksa kontrak untuk tim QA

1. Simpan skema kontrak di repositori bersama.
2. Validasi setiap respons terhadap skema pada setiap run CI.
3. Tolak penggabungan kode yang mengubah skema tanpa pembaruan kontrak.
4. Uji versi lama terhadap API baru minimal sekali per rilis.
5. Dokumentasikan setiap perubahan yang memutus pada catatan rilis.

### Latihan

Ambil satu API yang dipanggil tim lain. Tuliskan kontraknya (field wajib, tipe, kode error) dan
identifikasi tiga perubahan yang akan memutus klien. Diskusikan hasilnya dengan tim pemilik API.`,
          lab_ref: '/api-tester',
        },
        {
          code: 'L-API-06',
          title: 'Chaining: Alur End-to-End via API',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 2,
          content_md: `## Satu request jarang membuktikan sesuatu

Sebagian besar perilaku bisnis nyata baru terbukti melalui **rangkaian** request: daftar → tambah ke
keranjang → terapkan promo → checkout → bayar → verifikasi data.

*Chaining* adalah teknik menyusun nilai dari respons satu request menjadi input request berikutnya.

### Contoh rantai lengkap

\`\`\`text
1. POST /api/sessions            → token
2. POST /api/carts               → cart_id
3. POST /api/carts/{cart_id}/items  { product_id, qty: 2 }   → cart total 600000
4. POST /api/carts/{cart_id}/promo  { code: "PROMO10" }      → discount 60000
5. POST /api/orders              { cart_id }                 → order_id, total 540000
6. POST /api/orders/{order_id}/pay                            → status "paid"
7. GET  /api/orders/{order_id}   → status "paid", total 540000
\`\`\`

Setiap tanda panah adalah *ekstraksi* nilai dari respons untuk dipakai di langkah berikutnya.

### Aturan menyusun rantai yang sehat

| Aturan | Alasan |
|---|---|
| Satu rantai = satu tujuan bisnis | Rantai panjang tanpa tujuan sulit didiagnosis |
| Verifikasi di antara langkah kunci | Kegagalan dilaporkan di langkah yang tepat |
| Jangan mengulang assertion langkah 1 di langkah 7 | Menjaga pesan kegagalan tetap jelas |
| Bersihkan di akhir | Rantai membuat data; tanpa pembersihan akan menumpuk |
| Simpan nilai dengan nama bermakna | \`orderId\` lebih baik daripada \`id2\` |

### Mengapa verifikasi bertahap penting

Bayangkan rantai 7 langkah tanpa pemeriksaan antara. Jika total akhir salah, Anda tidak tahu apakah
masalahnya di perhitungan promo (langkah 4), snapshot harga saat pembuatan pesanan (langkah 5), atau
perhitungan ulang saat pembayaran (langkah 6). Verifikasi di setiap langkah kunci menyempitkan
pencarian secara drastis.

\`\`\`text
Langkah 4: assert(body.discount_amount === 60000)     ← di sini bug ditemukan langsung
Langkah 5: assert(body.total === 540000)
Langkah 6: assert(body.status === 'paid')
Langkah 7: assert(body.total === 540000)              ← memastikan nilai persisten
\`\`\`

### Pemeriksaan lintas lapisan (lapisan yang sering hilang)

Rantai API saja tidak cukup untuk operasi yang menulis data. Tambahkan pemeriksaan database:

\`\`\`text
Setelah langkah 5:
  SELECT total_amount, discount_amount, status FROM orders WHERE id = ?
  → 540000, 60000, 'pending'

Setelah langkah 6:
  SELECT status, paid_at FROM orders WHERE id = ?
  → 'paid', <timestamp terisi>

Juga periksa efek samping:
  SELECT COUNT(*) FROM promo_usages WHERE promo_code = 'PROMO10' AND user_id = ?
  → 1  (kode tercatat terpakai; tidak boleh 2)
\`\`\`

Baris terakhir adalah kelas bug yang hanya bisa ditangkap dengan memeriksa efek samping: API
mengembalikan sukses, tetapi pencatatan internalnya salah.

### Data yang diekstrak vs dibangkitkan

| Jenis | Contoh | Catatan |
|---|---|---|
| Diekstrak dari respons | \`cart_id\`, \`order_id\`, token | Harus disimpan dengan nama jelas |
| Dibangkitkan skrip | email unik, kode promo acak | Menjamin isolasi |
| Dari konfigurasi | base URL, kredensial | Tidak pernah hard-code |

### Kasus tepi yang layak diuji di tingkat rantai

1. **Rantai dilakukan user A, lalu diakses user B** → harus 403.
2. **Langkah 4 dilakukan dua kali** → perilaku idempoten atau penolakan.
3. **Langkah 5 dijalankan setelah cart kedaluwarsa** → penolakan yang jelas.
4. **Langkah 6 dijalankan dua kali (klik bayar ganda)** → hanya satu pembayaran.
5. **Langkah 7 oleh sesi yang sudah logout** → 401.

### Latihan

Susun satu rantai minimal lima langkah untuk alur utama aplikasi Anda, dengan verifikasi di setiap
langkah kunci dan minimal satu pemeriksaan database.`,
          lab_ref: '/api-tester',
        },
        {
          code: 'L-API-11',
          title: 'Latihan: Merancang Kontrak & Uji Versi',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 3,
          content_md: `## Kontrak yang tidak ditulis akan dilanggar tanpa disadari

Latihan ini menghasilkan artefak yang bisa langsung dipakai tim: satu dokumen kontrak ringkas beserta
daftar perubahan yang berpotensi memutus klien.

### Bagian 1 — Menulis kontrak

Untuk satu endpoint, lengkapi tabel berikut:

| Aspek | Isi |
|---|---|
| Endpoint & metode | \`POST /api/orders\` |
| Autentikasi | Bearer token; peran "pembeli" |
| Field wajib | \`cart_id\` (string), \`payment_method\` (enum) |
| Field opsional | \`idempotency_key\` (string), \`note\` (string, maks 500) |
| Nilai yang mungkin | \`payment_method\`: \`card\`, \`transfer\`, \`wallet\` |
| Respons sukses | 201 dengan \`data\`: \`{ id, code, total_amount, status, created_at }\` |
| Respons gagal | 400 \`cart_id_required\` · 404 \`cart_not_found\` · 409 \`cart_already_ordered\` · 422 \`cart_empty\` |
| Efek samping | Baris pada \`orders\` dan \`order_items\`; kuota promo berkurang 1 |
| Idempotensi | Header \`Idempotency-Key\`; pengulangan dengan key sama tidak membuat pesanan baru |
| Batas | 20 item per keranjang; 50 permintaan/menit per akun |

### Bagian 2 — Mendaftar perubahan yang memutus klien

| Perubahan yang direncanakan | Breaking? | Mengapa | Mitigasi |
|---|---|---|---|
| Tambah field \`discount_amount\` pada respons | Tidak | Klien lama mengabaikannya | Langsung boleh |
| Ubah \`total_amount\` dari integer ke string desimal | Ya | Parsing angka klien gagal | Rilis versi baru |
| Hapus \`code\` dari respons | Ya | Klien memakainya untuk pelacakan | Deprecation 2 siklus |
| Tambah nilai enum \`qris\` | Berpotensi | Klien dengan switch tanpa default | Umumkan + pembaruan klien |
| Perketat validasi \`note\` menjadi maks 200 | Berpotensi | Permintaan yang dulu sah ditolak | Umumkan lebih dulu |
| Ubah kode error \`cart_empty\` → \`empty_cart\` | Ya | Klien memeriksa kode | Pertahankan keduanya selama transisi |

### Bagian 3 — Menulis kasus uji versi

\`\`\`text
V1: POST /api/v1/orders   → respons lama (total_amount integer)
V2: POST /api/v2/orders   → respons baru (total_amount string desimal)

Kasus uji:
  1. V1 masih berfungsi setelah V2 dirilis
  2. Pesanan yang dibuat via V1 terbaca benar via V2
  3. Pesanan yang dibuat via V2 terbaca benar via V1 (bila masih didukung)
  4. Klien yang memanggil V1 setelah tanggal penghentian menerima pesan yang jelas
  5. Kedua versi menulis ke tabel yang sama tanpa konflik
\`\`\`

Kasus ke-5 paling sering terlupakan dan paling mahal: dua versi yang menulis dengan aturan berbeda bisa
menghasilkan data tidak konsisten di tabel yang sama.

### Kriteria selesai

- Kontrak terisi lengkap untuk satu endpoint.
- Minimal lima perubahan diklasifikasi dengan alasan.
- Minimal tiga kasus uji versi ditulis, termasuk pemeriksaan data lintas versi.

### Refleksi

Kontrak yang ditulis memaksa tim menyepakati hal-hal yang biasanya baru dibahas ketika sudah terlambat:
format nilai, kode error, dan aturan idempotensi. Sebagian besar integrasi yang gagal di produksi gagal
pada butir-butir ini, bukan pada logika bisnis.`,
          lab_ref: '/api-tester',
        },
      ],
    },
    {
      code: 'QA-API-M4',
      title: 'CI & Praktik Lanjutan',
      summary: 'Paralelisasi, ambang mutu, laporan tren, dan performa dasar di dalam suite API.',
      order_index: 4,
      lessons: [
        {
          code: 'L-API-07',
          title: 'Menjalankan Suite API di CI',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 1,
          content_md: `## Rancangan pipeline yang membuat suite dipercaya

Suite API adalah kandidat terbaik untuk CI: cepat, stabil, dan bisa berjalan tanpa antarmuka. Tetapi
tanpa rancangan, ia akan tumbuh menjadi lambat dan diabaikan.

### Tahapan pipeline

\`\`\`text
1. Lint & typecheck                     < 1 menit
2. Unit test                            < 3 menit
3. API smoke (10–20 endpoint inti)      < 10 menit
4. API suite lengkap + validasi skema   < 10 menit
5. Pemeriksaan lintas lapisan (DB)      < 5 menit
6. Regresi terjadwal (harian)           < 30 menit
\`\`\`

### Mengelola data di CI

| Strategi | Cara | Kapan dipakai |
|---|---|---|
| Seed ulang tiap run | Buat database bersih, jalankan seeder | Paling andal, paling lambat |
| Transaksi dibatalkan | Jalankan dalam transaksi lalu rollback | Cepat, cocok untuk uji baca |
| Snapshot database | Pulihkan snapshot sebelum run | Cepat untuk dataset besar |
| Data unik per run | Tambahkan prefiks run id | Wajib untuk paralelisasi |

Kombinasi yang paling praktis: **database bersih + data unik per skrip**.

### Paralelisasi yang aman

Menjalankan tes paralel bisa memotong waktu hingga 70%, tetapi hanya bila isolasi benar:

1. Setiap *worker* memakai namespace data sendiri (prefiks run id).
2. Tidak ada tes yang bergantung pada keadaan global.
3. Perlindungan terhadap rate limit API.
4. Hindari paralelisasi pada tes yang menyentuh kuota terbatas (misalnya kuota email).

### Gerbang mutu

\`\`\`text
Gerbang PR:
  - Semua tes API lulus
  - Tidak ada pelanggaran skema
  - Tidak ada tes baru yang flaky (diulang 2×)
  - Waktu eksekusi tidak naik > 20% dibanding baseline

Gerbang rilis:
  - Suite regresi API pass rate ≥ 98%
  - Tidak ada kegagalan lintas lapisan terbuka
\`\`\`

### Artefak yang harus dipublikasikan

| Artefak | Pembaca | Kegunaan |
|---|---|---|
| Laporan hasil (JSON/JUnit) | CI | Status gerbang, riwayat |
| Ringkasan manusiawi | Tim | Melihat cepat apa yang gagal |
| Log respons lengkap | QA | Investigasi |
| Skema yang divalidasi | Tim API | Melihat kesepakatan |
| Tren durasi & pass rate | Manajemen | Melihat kesehatan suite |

### Tanda suite API perlu dirapikan

- Durasi naik terus tanpa pertambahan kasus.
- Banyak tes bergantung pada urutan.
- Kegagalan sering berakhir dengan "coba jalankan ulang".
- Data uji menumpuk di environment.
- Skema tidak pernah diperbarui.

### Latihan

Rancang pipeline untuk suite API Anda dengan pembagian tahap dan gerbang mutu eksplisit. Tuliskan
ambang angkanya, bukan deskripsi umum.`,
          lab_ref: '/execute',
        },
        {
          code: 'L-API-08',
          title: 'Performa & Ketahanan API Dasar',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 2,
          content_md: `## Pengujian performa bukan hanya milik tim khusus

Anda tidak perlu menjadi ahli performa untuk menangkap masalah yang paling sering terjadi. Sebagian
besar masalah performa API terdeteksi dengan pengujian sederhana yang dilakukan QA setiap rilis.

### Empat pengukuran dasar

| Pengukuran | Pertanyaan | Ambang contoh |
|---|---|---|
| Waktu respons rata-rata | Berapa cepat respons normal? | < 200 ms |
| p95 / p99 | Bagaimana kasus terburuk 5% / 1%? | p95 < 400 ms, p99 < 1 s |
| Throughput | Berapa permintaan per detik yang ditangani? | ≥ 100 rps |
| Tingkat kesalahan | Berapa persen request gagal? | < 0,1% |

Rata-rata menipu. Endpoint dengan rata-rata 150 ms tetapi p99 sebesar 8 detik akan membuat 1 dari 100
pengguna menunggu sangat lama — dan mereka akan mengeluh.

### Pola lambat yang bisa dikenali dari bentuk respons

| Gejala | Penyebab umum | Cara memastikan |
|---|---|---|
| Waktu naik seiring jumlah data | Query tanpa indeks, N+1 | Uji dengan 10 vs 10.000 baris |
| Respons pertama lambat, berikutnya cepat | Cold start, cache belum hangat | Jalankan 5 kali berurutan |
| Melambat saat bersamaan | Kontensi sumber daya | Kenaikan konkurensi bertahap |
| Melambat seiring waktu | Kebocoran memori/sumber daya | Jalankan lama lalu ukur ulang |
| Waktu naik pada payload besar | Serialisasi, ukuran transfer | Uji dengan objek besar & banyak |

### Pengujian ketahanan yang murah

1. **Payload besar** — kirim field 1 MB pada endpoint yang biasanya menerima 100 byte.
2. **Paginasi ekstrem** — \`limit=100000\`, \`offset=999999\`.
3. **Permintaan berulang cepat** — 50 request beruntun, periksa 429 dan pemulihannya.
4. **Timeout pihak ketiga** — matikan layanan eksternal, periksa perilaku dan pesan error.
5. **Koneksi terputus** — batalkan request di tengah jalan, periksa data tidak setengah tersimpan.
6. **Dua permintaan bersamaan pada data sama** — uji *race condition* (misalnya kuota promo).

Contoh race condition yang sering nyata:

\`\`\`text
Persediaan barang = 1
Dua request checkout dikirim bersamaan
Hasil benar : satu sukses, satu gagal dengan 409 "stok habis"
Hasil bug   : dua-duanya sukses → stok menjadi -1
\`\`\`

Skenario ini tidak bisa ditemukan dengan pengujian berurutan; ia memerlukan pengiriman bersamaan.

### Assertion performa di dalam suite fungsional

Cara paling hemat untuk menjaga performa: tambahkan assertion waktu di tes fungsional yang sudah ada.

\`\`\`text
const mulai = Date.now();
const res = await request('GET', '/api/orders?limit=50');
const durasi = Date.now() - mulai;

assert(res.status === 200, 'status harus 200');
assert(durasi < 1500, \`endpoint terlalu lambat: \${durasi} ms\`);
\`\`\`

Ambangnya longgar (1,5 detik) dengan sengaja: tujuannya menangkap kemunduran besar, bukan mengukur
presisi. Ini mencegah endpoint yang tadinya 100 ms menjadi 5 detik tanpa ada yang menyadarinya.

### Kapan perlu melibatkan tim performa

- Perlu mengukur kapasitas maksimum (berapa pengguna bersamaan yang ditanggung).
- Perlu uji ketahanan jangka panjang (> 1 jam).
- Perlu memodelkan pola trafik nyata yang kompleks.
- Perlu perbandingan arsitektur.

Untuk kebutuhan sehari-hari, empat pengukuran dasar ditambah pengujian ketahanan murah sudah menangkap
sebagian besar masalah.

### Latihan

Ukur p95 untuk lima endpoint tersibuk dan bandingkan dengan rata-ratanya. Selisih besar menandakan
adanya ekor distribusi yang harus diselidiki — biasanya query tanpa indeks.`,
          lab_ref: '/metrics',
        },
        {
          code: 'L-API-12',
          title: 'Latihan: Pipeline & Gerbang Mutu Suite API',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 3,
          content_md: `## Merancang pipeline yang tidak akan dilewati tim

Gerbang mutu hanya berguna bila ia cepat dan dapat dipercaya. Gerbang yang lambat akan dilewati dengan
cara yang halus: orang menandai tes sebagai "opsional", atau menjalankannya setelah merge.

### Rancangan yang harus Anda hasilkan

\`\`\`text
Tahap 1 — Setiap commit (target < 3 menit)
  - lint & typecheck
  - unit test
  Gerbang : semua harus lulus

Tahap 2 — Setiap pull request (target < 15 menit)
  - API smoke: 15 endpoint inti
  - validasi skema respons
  - 2 tes yang paling sering flaky dijalankan 2× berturut-turut
  Gerbang : semua lulus, tidak ada pelanggaran skema

Tahap 3 — Setiap merge ke main (target < 30 menit)
  - suite API lengkap + validasi skema penuh
  - pemeriksaan lintas lapisan (query verifikasi)
  - smoke UI 5 alur kritis
  Gerbang : pass rate ≥ 98%

Tahap 4 — Terjadwal harian
  - regresi penuh lintas browser
  - pengujian ketahanan (payload besar, konkurensi, rate limit)
  Gerbang : laporan tren, tidak memblokir merge
\`\`\`

### Gerbang mana yang memblokir?

Prinsip yang penting: **hanya tes yang andal yang boleh memblokir**. Bila tes flaky dijadikan penghalang,
tim akan mencari jalan pintas.

| Tes | Memblokir? | Alasan |
|---|---|---|
| Unit & smoke API | Ya | Cepat dan stabil |
| Validasi skema | Ya | Objektif, tidak flaky |
| Suite API lengkap | Ya, pada merge | Andal dan bermakna |
| Smohe UI | Ya | Sedikit dan stabil |
| Regresi lintas browser | Tidak (peringatan) | Lebih lambat, sesekali flaky |
| Pengujian ketahanan | Tidak | Hasilnya untuk analisis, bukan gerbang |

### Ukuran keberhasilan pipeline

| Metrik | Target |
|---|---|
| Waktu umpan balik untuk PR | < 15 menit |
| Flaky rate suite API | < 1% |
| Rasio kegagalan yang ternyata bug produk | Meningkat antar waktu |
| Rasio "coba jalankan ulang" pada PR | Menurun antar waktu |
| Pass rate suite lengkap di main | ≥ 98% |

Metrik keempat adalah yang paling jujur mengukur kepercayaan tim terhadap suite.

### Latihan

Tulis rancangan pipeline untuk suite API Anda dengan empat tahap, target durasi, dan keputusan eksplisit
tentang tes mana yang memblokir. Sertakan ambang angka, bukan deskripsi umum.`,
          lab_ref: '/execute',
        },
      ],
    },
  ],
  quizzes: [
    {
      title: 'Kuis API Automation',
      pass_score: 70,
      order_index: 1,
      questions: [
        {
          prompt:
            'Klien mengirim request tanpa header Authorization ke endpoint yang dilindungi. Status yang tepat adalah…',
          options: ['403 Forbidden', '401 Unauthorized', '404 Not Found', '400 Bad Request'],
          answer_index: 1,
          explanation:
            '401 berarti permintaan belum terautentikasi (kredensial tidak ada atau tidak sah), sedangkan 403 berarti sudah terautentikasi tetapi tidak berwenang. Tanpa header Authorization, kasusnya adalah 401.',
          points: 1,
        },
        {
          prompt: 'Mengapa POST dianggap TIDAK idempoten, dan apa implikasinya bagi QA?',
          options: [
            'Karena POST selalu lambat, sehingga perlu timeout lebih panjang',
            'Karena POST yang sama diulang dapat membuat sumber daya baru setiap kali, sehingga QA wajib menguji pengiriman ulang request (misalnya klik ganda)',
            'Karena POST tidak boleh memakai header Authorization',
            'Karena POST tidak boleh memiliki body',
          ],
          answer_index: 1,
          explanation:
            'Idempotensi berarti mengulang request menghasilkan keadaan akhir yang sama. POST yang mengulang pembuatan sumber daya dapat menghasilkan duplikat (pesanan ganda, saldo terpotong dua kali), sehingga pengujian pengiriman ulang menjadi wajib.',
          points: 1,
        },
        {
          prompt:
            'Sebuah endpoint menerima JSON dengan sintaks yang valid, tetapi nilai field melanggar aturan bisnis (usia 15 padahal minimum 17). Status yang paling tepat adalah…',
          options: ['400 Bad Request', '422 Unprocessable Entity', '500 Internal Server Error', '200 OK dengan pesan error di body'],
          answer_index: 1,
          explanation:
            '400 dipakai ketika permintaan tidak dapat diproses (sintaks/format rusak), sedangkan 422 dipakai ketika sintaks benar tetapi isinya melanggar aturan bisnis. Mengembalikan 200 dengan pesan error di body adalah anti-pola.',
          points: 1,
        },
        {
          prompt:
            'Apa nilai utama validasi skema JSON di atas assertion nilai biasa?',
          options: [
            'Membuat suite berjalan lebih cepat',
            'Menangkap perubahan bentuk respons (field hilang, tipe berubah, format salah) yang tidak terdeteksi oleh pemeriksaan nilai tertentu',
            'Menggantikan kebutuhan status code',
            'Menjamin tidak ada bug pada API',
          ],
          answer_index: 1,
          explanation:
            'Assertion nilai hanya memeriksa field yang diperiksa. Validasi skema memeriksa kontrak secara keseluruhan sehingga perubahan bentuk respons yang memutus klien dapat terdeteksi lebih awal.',
          points: 1,
        },
        {
          prompt:
            'Dalam pengujian otorisasi, token milik user A yang sah dipakai untuk mengakses sumber daya milik user B lewat ID di URL. Status yang diharapkan adalah…',
          options: ['200 dengan data user B', '401 Unauthorized', '403 Forbidden (atau 404 bila sengaja disembunyikan)', '500 Internal Server Error'],
          answer_index: 2,
          explanation:
            'Ini adalah pengujian IDOR: kredensial sah tetapi tidak berwenang atas sumber daya tersebut, sehingga jawabannya 403. Sebagian API memilih 404 untuk menyembunyikan keberadaan sumber daya, dan itu keputusan yang sah asalkan konsisten.',
          points: 1,
        },
        {
          prompt:
            'Manakah perubahan API yang bersifat BREAKING (memutus klien yang ada)?',
          options: [
            'Menambahkan field opsional baru pada respons',
            'Menghapus field dari respons atau mengubah nama field',
            'Memperbaiki teks pesan error tanpa mengubah kode error',
            'Menambahkan endpoint baru',
          ],
          answer_index: 1,
          explanation:
            'Menghapus atau mengganti nama field memutus klien yang memakainya. Menambah field opsional, memperbaiki teks pesan (selama kode error tetap), dan menambah endpoint baru umumnya tetap kompatibel.',
          points: 1,
        },
      ],
    },
  ],
};

/* ==================================================================== *
 * 6 — Web Automation
 * ==================================================================== */

const webAutomation: SeedCourse = {
  slug: 'web-automation',
  title: 'Web Automation: Stabil, Cepat, dan Terawat',
  subtitle: 'Strategi locator, penantian, page object, lintas browser, dan penanganan flakiness.',
  description:
    'Kursus otomasi antarmuka web. Fokusnya bukan sekadar "bisa mengklik tombol", tetapi membangun suite UI yang stabil, mudah dibaca, dan layak dijalankan setiap hari di CI.',
  level: 'intermediate',
  pillar: 'Web Automation',
  estimated_minutes: 780,
  order_index: 6,
  icon: '🌐',
  tags: ['ui', 'locator', 'waits', 'page-object', 'lintas-browser'],
  modules: [
    {
      code: 'QA-WEB-M1',
      title: 'Elemen & Locator',
      summary: 'Strategi memilih locator yang tahan perubahan dan menghindari selector rapuh.',
      order_index: 1,
      lessons: [
        {
          code: 'L-WEB-01',
          title: 'Strategi Locator yang Tahan Perubahan',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 1,
          content_md: `## Locator adalah titik terlemah otomasi UI

Sebagian besar kegagalan suite UI bukan karena aplikasi rusak, melainkan karena **locator berhenti
menemukan elemen**. Memilih locator adalah keputusan desain, bukan detail teknis.

### Hierarki prioritas locator

| Prioritas | Strategi | Contoh | Ketahanan |
|---|---|---|---|
| 1 | Role + nama aksesibel | \`role=button[name="Simpan"]\` | Tinggi — mengikuti aksesibilitas |
| 2 | Label / teks terkait | \`getByLabel('Alamat email')\` | Tinggi |
| 3 | Atribut uji khusus | \`[data-testid="checkout-submit"]\` | Tinggi — disengaja untuk uji |
| 4 | Teks terlihat | \`text="Tambah ke keranjang"\` | Sedang — berubah bila copy berubah |
| 5 | CSS struktural | \`.cart > div:nth-child(3) .btn\` | Rendah |
| 6 | XPath absolut | \`/html/body/div[2]/div[3]/button\` | Sangat rendah |
| 7 | Posisi/index | \`button:nth-of-type(2)\` | Sangat rendah |

Aturan praktis: **semakin dekat locator ke maksud pengguna, semakin tahan ia terhadap perubahan
implementasi.** Pengguna mencari tombol berdasarkan namanya, bukan berdasarkan posisinya di DOM.

### Mengapa XPath absolut buruk

\`\`\`text
/html/body/div[2]/div[3]/form/div[1]/div/button[2]

Rapuh karena:
  - Menambah satu <div> pembungkus → seluruh XPath rusak
  - Perubahan urutan elemen → mengenai tombol yang salah (lebih berbahaya daripada gagal)
  - Tidak menjelaskan apa yang dicari pembaca
\`\`\`

Yang lebih berbahaya daripada gagal adalah **menemukan elemen yang salah**: tesnya lulus atau gagal
tanpa alasan yang jelas.

### Pola \`data-testid\` yang dikelola baik

\`\`\`text
Ketentuan:
  - Format konsisten: <area>-<elemen>[-<varian>]
    contoh: checkout-submit, cart-item-remove, login-error-message
  - Hanya ada bila elemen perlu diuji (jangan menandai seluruh DOM)
  - Tidak pernah dipakai untuk styling
  - Stabil: tidak berisi angka urutan yang berubah
  - Disepakati bersama developer, bukan ditambahkan sendiri oleh QA
\`\`\`

Bila aplikasi belum punya \`data-testid\`, langkah pertama yang paling bernilai bukan menulis tes,
melainkan **berbicara dengan developer** untuk menambahkannya pada elemen kritis.

### Menangani elemen dinamis

| Situasi | Masalah | Pendekatan |
|---|---|---|
| Daftar berubah | \`nth-child\` bergeser | Cari berdasarkan teks/konten baris |
| ID acak | \`id="input-8f3a2"\` | Pakai label atau \`data-testid\` |
| Teks berubah bahasa | \`text="Save"\` vs \`"Simpan"\` | Pakai \`data-testid\` |
| Elemen di dalam iframe | Tidak ditemukan di DOM utama | Pindah konteks frame |
| Shadow DOM | Selector biasa gagal | Gunakan penembus shadow |
| Komponen muncul berulang | Ambil elemen pertama dari banyak | Persempit dengan wadah induk |

### Daftar periksa locator sebelum menulis tes

1. Apakah locator ini menjelaskan **apa** yang dicari, bukan **di mana** letaknya?
2. Apakah ia tetap benar bila tata letak berubah?
3. Apakah ia unik di halaman?
4. Apakah ia tetap benar bila teks diterjemahkan?
5. Apakah ia tetap benar bila urutan elemen berubah?

Bila ada jawaban "tidak", perbaiki locator sebelum menulis tesnya.

### Latihan

Ambil satu tes UI Anda yang paling sering gagal. Periksa locatornya, ganti yang struktural menjadi
locator berbasis peran atau \`data-testid\`, lalu jalankan sepuluh kali untuk melihat perubahannya.`,
          lab_ref: '/web-tester',
        },
        {
          code: 'L-WEB-08',
          title: 'Latihan: Audit Locator Seluruh Suite',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 3,
          content_md: `## Audit sebelum menulis tes baru

Menambah tes di atas fondasi locator yang rapuh hanya menambah utang. Sebelum menulis tes baru, audit
yang sudah ada — pekerjaan ini biasanya membayar dirinya sendiri dalam satu sprint.

### Klasifikasi locator yang ada

| Kategori | Ciri | Tindakan |
|---|---|---|
| A — Berbasis peran/label | \`role=button[name="Simpan"]\` | Pertahankan |
| B — \`data-testid\` | \`[data-testid="checkout-submit"]\` | Pertahankan |
| C — Teks terlihat | \`text="Tambah ke keranjang"\` | Ganti bila ada terjemahan |
| D — CSS struktural | \`.cart > div:nth-child(3)\` | Ganti prioritas tinggi |
| E — XPath absolut | \`/html/body/div[2]/…\` | Ganti segera |
| F — Berbasis indeks | \`button:nth-of-type(2)\` | Ganti segera |

### Tabel audit

| Berkas | Locator | Kategori | Alasan rapuh | Prioritas | Pengganti |
|---|---|---|---|---|---|
| checkout.spec | \`.cart > div:nth-child(3) .btn\` | D | Bergantung struktur | Tinggi | \`[data-testid="cart-checkout"]\` |
| login.spec | \`//button[2]\` | E/F | Urutan berubah | Tinggi | \`role=button[name="Masuk"]\` |
| profile.spec | \`text="Simpan"\` | C | Multi-bahasa | Sedang | \`[data-testid="profile-save"]\` |
| cart.spec | \`[data-testid="cart-remove"]\` | B | — | — | — |

### Aturan penggantian yang aman

1. **Satu locator per perubahan.** Ganti lalu jalankan tesnya; jangan mengganti sepuluh sekaligus.
2. **Catat elemen yang perlu \`data-testid\` baru.** Kumpulkan daftarnya dan ajukan ke developer dalam satu
   permintaan, bukan sepuluh permintaan terpisah.
3. **Beri nama dengan pola konsisten**: \`<area>-<elemen>[-<varian>]\`.
4. **Jangan menandai seluruh halaman.** Hanya elemen yang benar-benar diuji.
5. **Perbarui page object, bukan tes.** Bila struktur page object sudah baik, perubahan hanya di satu
   tempat.

### Daftar permintaan ke developer

Format yang mudah disetujui:

\`\`\`text
Mohon tambahkan atribut data-testid pada elemen berikut:

1. Tombol submit checkout
   Lokasi  : halaman /checkout, di dalam form ringkasan
   Usulan  : data-testid="checkout-submit"
   Alasan  : locator saat ini memakai posisi DOM; berubah setiap kali tata letak disesuaikan
   Dampak  : 4 tes UI menjadi stabil

2. Pesan error validasi (muncul di 3 form)
   Usulan  : data-testid="form-error"
   Alasan  : teks pesan berubah sewaktu-waktu dan akan diterjemahkan
   Dampak  : 7 tes menjadi tidak bergantung pada teks
\`\`\`

### Mengukur hasil audit

| Metrik | Sebelum | Sesudah |
|---|---|---|
| Locator kategori D–F | 22 | 0 |
| Tes gagal karena locator per bulan | 14 | ? |
| Waktu perbaikan rata-rata | 25 menit | ? |
| \`data-testid\` tersedia | 6 | 19 |

Ukur ulang setelah dua sprint untuk membuktikan bahwa audit ini memang membuahkan hasil.

### Latihan

Audit seluruh locator di satu berkas tes Anda, isi tabel audit, dan susun satu daftar permintaan
\`data-testid\` untuk developer.`,
          lab_ref: '/web-tester',
        },
        {
          code: 'L-WEB-02',
          title: 'Menunggu dengan Benar',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 2,
          content_md: `## \`sleep(3000)\` adalah tanda otomasi yang belum matang

Waktu tunggu tetap gagal dalam dua arah sekaligus: terlalu lama (suite melambat) dan terlalu pendek
(di CI yang lebih lambat, tes gagal). Keduanya membuat suite tidak dapat dipercaya.

### Empat kategori penantian

| Kategori | Cara kerja | Kapan dipakai |
|---|---|---|
| Penantian implisit | Framework menunggu otomatis sebelum menemukan elemen | Jangan diandalkan; berlaku global dan menyulitkan diagnosis |
| Penantian eksplisit | Tunggu sampai kondisi tertentu terpenuhi | Pilihan utama |
| Penantian berbasis animasi | Tunggu animasi/transisi selesai | Khusus elemen bergerak |
| Penantian tetap (\`sleep\`) | Tunggu durasi | Hindari; hanya untuk pembuktian negatif |

### Penantian eksplisit: menunggu keadaan, bukan waktu

Kondisi yang layak ditunggu:

\`\`\`text
- elemen terlihat / tersembunyi
- elemen dapat diklik (bukan tertutup overlay)
- teks tertentu muncul pada elemen
- jumlah elemen mencapai nilai tertentu
- URL berubah
- respons jaringan tertentu selesai
- atribut bernilai tertentu
\`\`\`

Contoh pola yang benar:

\`\`\`text
// SALAH — menebak durasi
klik('#simpan');
sleep(3000);
assert(teks('#status') === 'Tersimpan');

// BENAR — menunggu keadaan yang bermakna
klik('#simpan');
tungguSampai(() => teks('#status') === 'Tersimpan', { timeout: 10000 });
assert(teks('#status') === 'Tersimpan');
\`\`\`

Perhatikan bahwa versi benar tidak hanya lebih cepat, tetapi juga **lebih jelas**: ia menyatakan
kondisi yang ditunggu.

### Bahaya \`sleep\` untuk pembuktian negatif

Kasus satu-satunya di mana \`sleep\` masih masuk akal: memastikan sesuatu **tidak** terjadi.

\`\`\`text
setelahMenghapusItem();
sleep(2000);                      // beri waktu sistem untuk (tidak) menampilkan sesuatu
assert(tidakAda('#item-tersisa')); // pastikan item benar-benar hilang
\`\`\`

Bahkan di sini, lebih baik bila ada sinyal positif yang bisa ditunggu (misalnya munculnya pesan
"Item dihapus"), karena pembuktian negatif berbasis durasi selalu rapuh.

### Tabel diagnosis kegagalan penantian

| Gejala | Penyebab mungkin | Perbaikan |
|---|---|---|
| Gagal hanya di CI | Waktu tunggu terlalu pendek | Naikkan timeout untuk operasi itu + tunggu kondisi |
| Gagal sesekali pada animasi | Elemen bergerak saat diklik | Tunggu animasi selesai atau klik lewat aksi stabil |
| Elemen ditemukan tetapi klik gagal | Tertutup overlay/tooltip | Tunggu overlay hilang |
| Gagal pada data besar | Pemuatan lambat | Tunggu indikator pemuatan hilang |
| Gagal setelah beberapa menit | Sesi habis | Perbarui mekanisme login/refresh |
| Berhasil saat dijalankan sendiri | Ketergantungan data/urutan | Isolasi data |

### Prinsip yang layak dipegang

> Tunggu **keadaan**, bukan **waktu**. Setiap kali Anda menulis angka detik, tanyakan: keadaan apa
> yang sebenarnya saya tunggu?

Pertanyaan itu hampir selalu menghasilkan penantian yang lebih baik, lebih cepat, dan lebih jelas.

### Latihan

Cari seluruh \`sleep\` di suite Anda. Untuk masing-masing, tentukan keadaan apa yang sebenarnya
ditunggu, lalu gantikan. Ukur total waktu eksekusi sebelum dan sesudah.`,
          lab_ref: '/web-tester',
        },
        {
          code: 'L-WEB-09',
          title: 'Latihan: Menghapus Seluruh Penantian Buta',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 3,
          content_md: `## Latihan yang hasilnya langsung terasa

Mengganti \`sleep\` dengan penantian berbasis keadaan adalah perbaikan dengan rasio manfaat-usaha
terbaik dalam otomasi UI. Latihan ini memandu Anda melakukannya secara sistematis, bukan satu per satu
secara acak.

### Langkah 1 — Inventarisasi

Cari seluruh penantian tetap di suite Anda dan catat konteksnya:

| Berkas | Baris | Kode | Setelah aksi apa | Keadaan yang sebenarnya ditunggu |
|---|---|---|---|---|
| cart.spec | 42 | \`sleep(3000)\` | klik "Terapkan promo" | total berubah menjadi Rp540.000 |
| login.spec | 18 | \`sleep(2000)\` | klik "Masuk" | URL berubah ke /dashboard |
| profile.spec | 77 | \`sleep(1500)\` | klik "Simpan" | muncul teks "Tersimpan" |
| order.spec | 103 | \`sleep(5000)\` | klik "Bayar" | status berubah menjadi "paid" |

### Langkah 2 — Tentukan keadaan pengganti

Empat jenis keadaan yang menutup hampir semua kasus:

| Jenis | Kondisi | Cocok untuk |
|---|---|---|
| Perubahan teks | elemen berisi nilai tertentu | Konfirmasi, total, status |
| Kemunculan elemen | elemen muncul atau hilang | Pesan, dialog, indikator |
| Perubahan URL | alamat halaman berubah | Navigasi |
| Selesai memuat | indikator pemuatan hilang / jumlah baris tercapai | Tabel, daftar |

### Langkah 3 — Ganti dan ukur

\`\`\`text
SEBELUM
  klik('[data-testid="promo-apply"]');
  sleep(3000);
  assert(teks('[data-testid="checkout-total"]') === 'Rp540.000');

SESUDAH
  klik('[data-testid="promo-apply"]');
  tungguSampai(() => teks('[data-testid="checkout-total"]') === 'Rp540.000',
               { timeout: 10000, pesan: 'total tidak berubah setelah promo diterapkan' });
\`\`\`

Perhatikan bahwa versi baru menambahkan **pesan kegagalan yang bermakna**. Ini bonus penting: ketika
gagal di CI, pesan tersebut langsung menjelaskan apa yang tidak terjadi.

### Langkah 4 — Ukur hasilnya

| Metrik | Sebelum | Sesudah |
|---|---|---|
| Jumlah penantian tetap | 14 | 0 |
| Durasi suite | 6m 20s | ? |
| Kegagalan di CI per minggu | 9 | ? |
| Waktu tunggu rata-rata per kasus | 2,4 s | ? |

Biasanya durasi turun 30–50% dan kegagalan di CI turun drastis — dua perbaikan sekaligus dari satu
perubahan.

### Pengecualian yang sah

Satu-satunya penantian tetap yang masih wajar adalah untuk **membuktikan sesuatu tidak terjadi**
(pembuktian negatif):

\`\`\`text
hapusItem();
tungguSampai(() => !ada('[data-testid="cart-item"]'), { timeout: 5000 });
// Bila ingin memastikan item TIDAK muncul kembali dalam waktu tertentu:
tunggu(1500);   // jeda sengaja, dengan komentar alasan
assert(!ada('[data-testid="cart-item"]'));
\`\`\`

Bahkan di sini, berikan komentar yang menjelaskan mengapa jeda itu ada. Penantian tetap tanpa penjelasan
akan dianggap utang teknis oleh pembaca berikutnya.

### Kriteria selesai

- Seluruh penantian tetap terdokumentasi dalam tabel inventarisasi.
- Minimal sepuluh digantikan dengan penantian berbasis keadaan beserta pesan kegagalan.
- Durasi suite dan jumlah kegagalan diukur sebelum dan sesudah.

### Refleksi

Perhatikan bahwa penggantian ini bukan optimisasi mikro. Ia mengubah sifat suite: dari yang menebak
waktu menjadi yang memeriksa keadaan. Suite seperti itu menjadi lebih cepat **dan** lebih dapat
dipercaya pada saat yang sama.`,
          lab_ref: '/web-tester',
        },
      ],
    },
    {
      code: 'QA-WEB-M2',
      title: 'Struktur & Pola',
      summary: 'Page object, komponen, dan data-driven test agar suite tetap terbaca.',
      order_index: 2,
      lessons: [
        {
          code: 'L-WEB-03',
          title: 'Page Object & Component Pattern',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 1,
          content_md: `## Masalah: detail UI tersebar di mana-mana

Tanpa struktur, setiap tes memuat selector, URL, dan langkah navigasi. Ketika UI berubah, Anda harus
mengedit puluhan file — dan setiap edit berpotensi mematahkan tes lain.

**Page object** memindahkan pengetahuan tentang halaman ke satu tempat.

### Contoh terstruktur

\`\`\`text
// PAGE OBJECT — tahu tentang halaman, tidak tahu tentang tes
class HalamanCheckout {
  readonly tombolTerapkanPromo = '[data-testid="checkout-apply-promo"]';
  readonly inputPromo           = '[data-testid="checkout-promo-input"]';
  readonly labelTotal           = '[data-testid="checkout-total"]';
  readonly pesanError           = '[data-testid="checkout-error"]';

  async buka()                    { await goto('/checkout'); }
  async terapkanPromo(kode)       { await isi(this.inputPromo, kode);
                                    await klik(this.tombolTerapkanPromo);
                                    await tungguSelesaiMemuat(); }
  async ambilTotal()              { return await teks(this.labelTotal); }
  async ambilPesanError()         { return await teks(this.pesanError); }
}

// TEST — tahu tentang perilaku yang diuji
test('promo kedaluwarsa ditolak', async () => {
  const checkout = new HalamanCheckout();
  await checkout.buka();
  await checkout.terapkanPromo('PROMO-LEWAT');

  expect(await checkout.ambilPesanError()).toContain('sudah kedaluwarsa');
  expect(await checkout.ambilTotal()).toBe('Rp600.000');   // total tidak berubah
});
\`\`\`

Perhatikan bahwa tesnya **tidak memuat satu pun selector**. Ketika UI berubah, hanya page object yang
diperbarui.

### Aturan page object yang baik

| Aturan | Alasan |
|---|---|
| Tidak boleh memuat assertion | Assertion adalah milik tes, bukan halaman |
| Kembalikan data atau page object lain | Memungkinkan rantai alur yang terbaca |
| Satu page object per halaman/komponen besar | Terlalu besar menjadi tidak terawat |
| Nama metode memakai bahasa domain | \`terapkanPromo\` jelas; \`klikTombol3\` tidak |
| Tidak menyimpan keadaan antar tes | Keadaan yang tersimpan menyebabkan flakiness |

Aturan pertama paling sering dilanggar. Bila page object memuat assertion, Anda tidak bisa memakainya
untuk menguji jalur yang gagal.

### Component object untuk elemen berulang

Elemen yang muncul di banyak halaman (navigasi, notifikasi, tabel) sebaiknya menjadi komponen sendiri:

\`\`\`text
class TabelPesanan {
  constructor(private wadah) {}
  baris()             { return this.wadah.querySelectorAll('[data-testid="order-row"]'); }
  async pesananKe(n)  { return new BarisPesanan(this.baris()[n]); }
  async jumlahBaris() { return (await this.baris()).length; }
}

class BarisPesanan {
  async kode()   { /* ... */ }
  async status() { /* ... */ }
}
\`\`\`

### Tingkatan abstraksi yang sehat

\`\`\`text
Tes            → menyatakan perilaku bisnis
Helper alur    → rantai langkah lintas halaman (misalnya "checkoutSampaiBayar")
Page object    → elemen & aksi satu halaman
Komponen       → elemen berulang
Driver/browser → interaksi tingkat rendah
\`\`\`

Tes yang baik bisa dibaca oleh Product Owner. Bila tes Anda hanya bisa dibaca oleh orang yang menulisnya,
lapisannya tercampur.

### Latihan

Ambil satu tes UI Anda yang terpanjang. Pisahkan selector dan aksi ke dalam page object, lalu
bandingkan panjang dan keterbacaan tesnya.`,
          lab_ref: '/web-tester',
        },
        {
          code: 'L-WEB-10',
          title: 'Latihan: Refactor Satu Tes Menjadi Berlapis',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 3,
          content_md: `## Latihan refactor yang bisa diselesaikan dalam satu jam

Refactor besar jarang selesai. Refactor **satu tes** selalu selesai, dan hasilnya menjadi contoh yang
bisa ditiru untuk tes lainnya.

### Tes sebelum refactor

\`\`\`text
test('checkout dengan promo', async () => {
  await page.goto('https://staging.tokokita.id/login');
  await page.fill('#email', 'qa+1@contoh.id');
  await page.fill('#password', 'Rahasia#123');
  await page.click('button.btn-primary');
  await page.waitForTimeout(2000);
  await page.goto('https://staging.tokokita.id/products/sku-001');
  await page.click('.product-detail > div:nth-child(4) > button');
  await page.waitForTimeout(1500);
  await page.goto('https://staging.tokokita.id/checkout');
  await page.fill('#promo', 'PROMO10');
  await page.click('.cart > div:nth-child(3) .btn');
  await page.waitForTimeout(3000);
  const total = await page.textContent('.summary > div:nth-child(2) > span');
  expect(total).toBe('Rp540.000');
});
\`\`\`

### Masalah yang bisa Anda tunjuk

| Masalah | Bukti di kode | Akibat |
|---|---|---|
| URL hard-code | \`https://staging.tokokita.id\` | Tidak bisa dijalankan di environment lain |
| Kredensial di dalam kode | \`qa+1@contoh.id\` | Risiko keamanan & data bersama |
| Locator struktural | \`.cart > div:nth-child(3) .btn\` | Rapuh terhadap perubahan tata letak |
| Penantian tetap | \`waitForTimeout(3000)\` | Lambat dan tidak andal |
| Semua lapisan bercampur | navigasi + aksi + assertion dalam satu blok | Sulit dibaca & dirawat |
| Data uji tetap | kode promo sama setiap run | Gagal pada run kedua |

### Hasil setelah refactor

\`\`\`text
// helpers/alur.ts — alur bisnis
export async function checkoutDenganPromo(kodePromo) {
  const login = new HalamanLogin();
  await login.buka();
  await login.masuk(akunUji());
  const keranjang = new HalamanKeranjang();
  await keranjang.tambahProduk('SKU-001', 1);
  const checkout = await keranjang.lanjutKeCheckout();
  await checkout.terapkanPromo(kodePromo);
  return checkout;
}

// checkout.spec.ts — maksud tes saja
test('promo 10% diterapkan saat checkout', async () => {
  const checkout = await checkoutDenganPromo('PROMO10');
  expect(await checkout.ambilTotal()).toBe('Rp540.000');
  expect(await checkout.ambilLabelDiskon()).toContain('10%');
});
\`\`\`

### Daftar periksa perbandingan

| Aspek | Sebelum | Sesudah |
|---|---|---|
| Baris tes | 14 | 4 |
| Locator struktural | 3 | 0 |
| Penantian tetap | 3 | 0 |
| URL hard-code | 3 | 0 (dari konfigurasi) |
| Kredensial di kode | ada | tidak ada |
| Bisa dijalankan di environment lain | tidak | ya |
| Keterbacaan oleh non-teknis | rendah | tinggi |

### Langkah kerja

1. Pilih satu tes terpanjang.
2. Tandai setiap masalah di atas dengan komentar sebaris.
3. Buat page object untuk halaman yang disentuh tes itu.
4. Buat satu helper alur bisnis.
5. Tulis ulang tes menjadi maksimal 6 baris.
6. Jalankan 10 kali, bandingkan durasi & kegagalan dengan versi lama.

### Kriteria selesai

- Tes baru di bawah 6 baris dan dapat dibaca tanpa pengetahuan selector.
- Tidak ada URL, kredensial, atau penantian tetap di dalam berkas tes.
- Dijalankan 10 kali tanpa kegagalan.

### Refleksi

Perhatikan bahwa refactor ini tidak menambah cakupan pengujian apa pun — tetapi membuat tes itu bisa
dipercaya, cepat dibaca, dan mudah diperluas. Efeknya pada seluruh suite biasanya jauh lebih besar
daripada menambah sepuluh tes baru.`,
          lab_ref: '/web-tester',
        },
        {
          code: 'L-WEB-04',
          title: 'Data-Driven & Alur Berulang',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 2,
          content_md: `## Satu skrip, banyak data

Banyak kasus hanya berbeda pada data, bukan pada langkah. Menulis satu tes per baris data adalah
pemborosan dan sumber duplikasi.

### Pola data-driven

\`\`\`text
const kasus = [
  { nama: 'valid',                 kode: 'PROMO10',    total: 'Rp540.000', error: null },
  { nama: 'kedaluwarsa',           kode: 'PROMO-LEWAT', total: 'Rp600.000', error: 'kedaluwarsa' },
  { nama: 'huruf kecil',           kode: 'promo10',     total: 'Rp540.000', error: null },
  { nama: 'tidak dikenal',         kode: 'PROMO-XXX',   total: 'Rp600.000', error: 'tidak ditemukan' },
  { nama: 'kosong',                kode: '',            total: 'Rp600.000', error: 'wajib diisi' },
  { nama: 'dengan spasi',          kode: ' PROMO10 ',   total: 'Rp540.000', error: null },
  { nama: 'spasi saja',            kode: '   ',         total: 'Rp600.000', error: 'wajib diisi' },
];

for (const k of kasus) {
  test(\`promo \${k.nama}\`, async () => { /* satu implementasi */ });
}
\`\`\`

Tujuh tes dari satu implementasi. Menambah kasus baru berarti menambah satu baris data.

### Yang harus dijaga pada data-driven test

1. **Nama tes menggambarkan data**, bukan indeks. \`promo kedaluwarsa\` jelas; \`case 3\` tidak.
2. **Setiap baris data harus mandiri** — tidak bergantung pada baris sebelumnya.
3. **Data dari luar (file) tetap harus punya nama kolom yang jelas**, bukan \`col1\`, \`col2\`.
4. **Jangan mencampur perilaku berbeda** dalam satu tabel; itu menghasilkan tes yang sulit dibaca.

### Batas praktis

| Gejala | Masalah | Perbaikan |
|---|---|---|
| Tabel data > 30 baris | Sulit dibaca, sulit dirawat | Pisahkan per kategori |
| Banyak kolom bersyarat | Logika bercabang di dalam tes | Pisahkan menjadi beberapa tes |
| Data bersifat kejadian unik | Bukan pola berulang | Tulis sebagai tes tersendiri |
| Perbedaan langkah antar baris | Bukan data-driven lagi | Pisahkan skenario |

### Helper alur (flow helper)

Alur yang diulang di banyak tes sebaiknya diekstrak menjadi helper bernama:

\`\`\`text
async function checkoutSampaiBayar(kodePromo = null) {
  const keranjang = new HalamanKeranjang();
  await keranjang.tambahItem('SKU-001', 2);
  const checkout = await keranjang.lanjutKeCheckout();
  if (kodePromo) await checkout.terapkanPromo(kodePromo);
  return await checkout.lanjutKePembayaran();
}
\`\`\`

Tes yang memakai helper ini menjadi sangat ringkas:

\`\`\`text
test('promo diterapkan saat checkout', async () => {
  const bayar = await checkoutSampaiBayar('PROMO10');
  expect(await bayar.total()).toBe('Rp540.000');
});
\`\`\`

### Kehati-hatian dengan helper

- Helper yang terlalu pintar menyembunyikan kegagalan. Bila \`checkoutSampaiBayar\` gagal, Anda tidak
  tahu langkah mana. Tambahkan penanda pada setiap langkah dan biarkan kegagalan menyebut langkahnya.
- Helper harus tetap **menyatakan alur bisnis**, bukan mencampur logika bersyarat rumit.
- Bila satu helper mulai punya banyak parameter opsional, itu tanda ia seharusnya dipecah.

### Latihan

Ambil lima tes yang mirip di suite Anda, gabungkan menjadi satu tes data-driven, lalu ukur berapa baris
kode yang hilang tanpa mengurangi cakupan.`,
          lab_ref: '/web-tester',
        },
      ],
    },
    {
      code: 'QA-WEB-M3',
      title: 'Lintas Browser, Visual & Stabilitas',
      summary: 'Matriks browser, pengujian visual, dan strategi menekan flakiness.',
      order_index: 3,
      lessons: [
        {
          code: 'L-WEB-05',
          title: 'Lintas Browser & Perangkat',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 1,
          content_md: `## Matriks yang harus dipilih, bukan diperluas tanpa batas

Kombinasi browser × versi × sistem operasi × ukuran layar tumbuh sangat cepat. Menguji semuanya tidak
mungkin; memilih yang tepat adalah keputusan berbasis data pengguna.

### Dasar pemilihan

1. **Data analitik** — browser dan perangkat apa yang benar-benar dipakai pengguna Anda? Urutkan
   berdasarkan persentase.
2. **Dukungan resmi** — apa yang dijanjikan tim produk?
3. **Risiko teknis** — di mana perbedaan implementasi paling mungkin menimbulkan masalah?
4. **Biaya** — setiap tambahan kombinasi memperlambat suite dan menambah perawatan.

### Contoh matriks yang realistis

| Browser | Versi | Prioritas | Frekuensi uji |
|---|---|---|---|
| Chrome | 2 terakhir | Tinggi | Setiap pull request |
| Safari | 2 terakhir | Tinggi | Harian (mesin Safari) |
| Edge | 2 terakhir | Sedang | Harian |
| Firefox | 2 terakhir | Sedang | Harian |
| iOS Safari | 2 terakhir | Tinggi (mobile) | Harian |
| Android Chrome | 2 terakhir | Sedang | Harian |
| Browser lama | — | Rendah | Manual, bila ada keluhan |

### Perbedaan antar browser yang benar-benar menyebabkan bug

| Area | Perbedaan umum |
|---|---|
| Format tanggal & angka | Lokalisasi, pemisah desimal, urutan hari/bulan |
| Validasi form bawaan | Pesan dan waktu validasi berbeda |
| Elemen input khusus | \`type="date"\`, \`type="number"\` berperilaku berbeda |
| Unggahan berkas | Atribut \`accept\`, perilaku multi-berkas |
| Penyimpanan lokal | Batas kuota, perilaku mode privat |
| API modern | Dukungan fitur grafis dan animasi |
| Font & tata letak | Perbedaan lebar teks menggeser tata letak |
| Penanganan cetak | Aturan cetak tidak konsisten |

### Responsif: ukuran layar, bukan hanya browser

Uji pada rentang nyata yang mewakili pengguna:

\`\`\`text
Mobile  : 360 × 640   (layar kecil)
Mobile L: 414 × 896
Tablet  : 768 × 1024
Laptop  : 1366 × 768
Desktop : 1920 × 1080
\`\`\`

Titik kritis biasanya bukan ukuran perangkat, melainkan **titik henti (breakpoint)** di mana tata letak
berubah. Uji tepat di sekitar setiap breakpoint: satu piksel di bawah dan satu di atas.

### Lintas browser tanpa memperbanyak tes

Kuncinya: **satu suite tes, banyak target browser**. Jalankan suite yang sama pada matriks browser,
jangan menulis tes khusus per browser kecuali ada alasan kuat.

Pengujian yang layak dijalankan lintas browser secara penuh:
- Alur kritis (login, checkout, pencarian).
- Formulir dengan validasi.
- Halaman dengan tata letak kompleks.

Pengujian yang cukup di satu browser:
- Logika data murni (sudah dicakup API).
- Kasus negatif non-visual.

### Latihan

Susun matriks browser untuk aplikasi Anda berdasarkan data analitik nyata plus dukungan resmi tim.
Tuliskan alasannya untuk setiap baris — matriks tanpa alasan akan tumbuh tanpa kendali.`,
          lab_ref: '/web-tester',
        },
        {
          code: 'L-WEB-06',
          title: 'Pengujian Visual & Aksesibilitas Dasar',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 2,
          content_md: `## Yang tidak bisa ditangkap assertion fungsional

Sebuah tombol bisa "bekerja" tetapi tidak terlihat karena warnanya sama dengan latar. Sebuah form bisa
"lulus" tetapi tidak bisa diisi keyboard. Keduanya adalah bug nyata yang tidak terdeteksi oleh
assertion fungsional.

### Pengujian visual

Pendekatan tangkapan layar membandingkan hasil render dengan baseline dan melaporkan perbedaan piksel.

| Aspek | Praktik baik |
|---|---|
| Cakupan | Halaman dan komponen kunci, bukan seluruh aplikasi |
| Baseline | Diperbarui secara sadar, dengan review |
| Ambang perbedaan | Toleransi kecil untuk perbedaan anti-aliasing |
| Lingkungan | Konsisten — ukuran viewport, font, sistem operasi |
| Elemen dinamis | Disembunyikan atau di-mask (tanggal, kode acak, avatar) |

Masalah terbesar pengujian visual adalah **kebisingan**: perbedaan kecil yang tidak berarti membuat tim
mengabaikan hasilnya. Karena itu mask elemen dinamis dan tinjau setiap pembaruan baseline.

Kapan paling berguna:
- Setelah perubahan CSS atau komponen bersama.
- Pada komponen antarmuka yang dipakai banyak halaman.
- Untuk memeriksa keadaan responsif pada beberapa ukuran layar.

### Pemeriksaan aksesibilitas otomatis

Alat pemeriksaan otomatis menangkap sebagian masalah aksesibilitas — jauh lebih baik daripada tidak
sama sekali:

| Temuan | Contoh |
|---|---|
| Teks alternatif hilang | Gambar produk tanpa atribut \`alt\` |
| Label form tidak terkait | Input tanpa \`label\` atau \`aria-label\` |
| Kontras warna kurang | Teks abu-abu di latar putih |
| Urutan judul melompat | \`h1\` langsung ke \`h4\` |
| Elemen interaktif tanpa nama | Tombol ikon tanpa teks aksesibel |
| Atribut ARIA salah pakai | Peran yang tidak sesuai elemen |

Yang **tidak** bisa ditangkap otomatis dan harus diuji manual:
- Apakah alur bisa diselesaikan hanya dengan keyboard?
- Apakah fokus terlihat dan urutannya logis?
- Apakah pembaca layar membacakan konteks dengan bermakna?

### Uji keyboard: lima langkah yang cepat

\`\`\`text
1. Tab melalui halaman — apakah setiap elemen interaktif dapat dijangkau?
2. Apakah indikator fokus terlihat jelas?
3. Apakah urutan Tab mengikuti urutan visual?
4. Dapatkah dialog ditutup dengan Escape?
5. Apakah fokus terperangkap di dalam modal (tidak bocor ke belakang)?
\`\`\`

Lima pemeriksaan ini sering menemukan bug yang tidak terlihat oleh pengujian lain, dan biasanya cepat
diperbaiki.

### Hubungan dengan locator

Ada manfaat sampingan yang besar: aplikasi yang aksesibel menghasilkan **locator berbasis peran dan
label yang stabil**. Meningkatkan aksesibilitas sekaligus meningkatkan ketahanan suite otomasi Anda.

### Latihan

Jalankan pemeriksaan aksesibilitas otomatis pada lima halaman utama, lalu lakukan uji keyboard lima
langkah pada satu alur kritis. Catat temuan dan kelompokkan berdasarkan tingkat keparahan.`,
          lab_ref: '/web-tester',
        },
        {
          code: 'L-WEB-07',
          title: 'Menekan Flakiness di Suite UI',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 3,
          content_md: `## Suite UI adalah yang paling rentan flaky

Semua penyebab flakiness di otomasi API juga berlaku di UI, ditambah beberapa yang khas antarmuka.
Karena itu disiplin di lapisan ini paling menentukan.

### Penyebab khas UI dan penangkalnya

| Penyebab | Gejala | Penangkal |
|---|---|---|
| Penantian berbasis durasi | Gagal hanya di CI | Tunggu keadaan |
| Animasi belum selesai | Klik mengenai elemen bergerak | Tunggu stabil, atau nonaktifkan animasi di lingkungan uji |
| Overlay menutupi elemen | Klik gagal interaksi | Tunggu overlay hilang, tutup secara eksplisit |
| Scroll tidak sampai elemen | Elemen "tidak terlihat" | Gulir ke elemen sebelum berinteraksi |
| Fokus hilang | Input tidak terisi | Pastikan fokus sebelum mengetik |
| Balapan pemuatan data | Tabel kosong saat diperiksa | Tunggu jumlah baris atau indikator selesai |
| Unggahan/asinkron lambat | Langkah lanjut terlalu cepat | Tunggu sinyal selesai |
| Cache & sesi | Perilaku berbeda tiap run | Bersihkan keadaan di awal |
| Pemuatan font/layout shift | Klik mengenai elemen bergeser | Tunggu render stabil |
| Zona waktu mesin | Tanggal tampil berbeda | Set zona waktu tetap di lingkungan uji |

### Enam aturan untuk suite UI yang stabil

1. **Tidak ada \`sleep\` tetap.** Tunggu keadaan.
2. **Satu tes, satu tujuan.** Tes panjang lebih rapuh dan sulit didiagnosis.
3. **Data dibuat sendiri oleh tes.** Tidak ada ketergantungan pada data yang "kebetulan ada".
4. **Setiap tes dapat berdiri sendiri.** Bisa dijalankan satu per satu.
5. **Satu akun per tes bila menyentuh keadaan akun.** Akun bersama adalah sumber kegagalan berantai.
6. **Bersihkan setelah selesai**, termasuk logout dan penghapusan data uji.

### Strategi karantina

Meski disiplin sudah dijalankan, akan ada tes yang tetap flaky. Strategi yang sehat:

\`\`\`text
1. Tandai tes sebagai karantina dengan tiket dan pemilik.
2. Keluarkan dari gerbang PR, tetapi tetap jalankan secara terjadwal.
3. Beri tenggat perbaikan (misalnya 2 sprint).
4. Bila tidak diperbaiki, hapus dengan pencatatan alasan.
\`\`\`

Yang **tidak** boleh dilakukan: membiarkan tes flaky di gerbang PR, karena tim akan belajar mengabaikan
warna merah.

### Metrik yang harus dipantau

| Metrik | Target | Kenapa penting |
|---|---|---|
| Flaky rate | < 2% | Di atas itu kepercayaan hilang |
| Durasi suite | < 30 menit untuk regresi kritis | Suite lambat ditinggalkan |
| Rasio gagal karena skrip | Menurun antar waktu | Menandakan perawatan berjalan |
| Waktu perbaikan tes rusak | < 1 hari | Suite yang dibiarkan merah cepat membusuk |

### Latihan

Ambil satu tes flaky di suite Anda, jalankan 20 kali, dan catat rasio kegagalannya. Perbaiki akar
penyebabnya berdasarkan tabel di atas, lalu jalankan 20 kali lagi untuk membuktikan perbaikannya.`,
          lab_ref: '/regression',
        },
      ],
    },
  ],
  quizzes: [
    {
      title: 'Kuis Web Automation',
      pass_score: 70,
      order_index: 1,
      questions: [
        {
          prompt: 'Manakah locator yang paling tahan terhadap perubahan tata letak?',
          options: [
            '/html/body/div[2]/div[3]/form/button[2]',
            '.container > div:nth-child(3) .btn-primary',
            '[data-testid="checkout-submit"]',
            'button:nth-of-type(2)',
          ],
          answer_index: 2,
          explanation:
            'Locator berbasis atribut uji khusus tidak bergantung pada struktur DOM, urutan elemen, atau kelas styling, sehingga jauh lebih tahan terhadap perubahan implementasi maupun tata letak.',
          points: 1,
        },
        {
          prompt:
            'Mengapa \`sleep(3000)\` dianggap praktik buruk dalam otomasi UI?',
          options: [
            'Karena memperlambat suite dan tetap rapuh — terlalu pendek di CI yang lambat, terlalu lama di mesin cepat',
            'Karena tidak didukung semua framework',
            'Karena hanya bisa dipakai di dalam page object',
            'Karena membuat log menjadi panjang',
          ],
          answer_index: 0,
          explanation:
            'Menunggu berdasarkan durasi menebak waktu, bukan memeriksa keadaan. Di lingkungan yang lebih lambat tes tetap gagal, dan di lingkungan cepat waktu terbuang. Penantian eksplisit berbasis kondisi mengatasi keduanya sekaligus.',
          points: 1,
        },
        {
          prompt: 'Apa tujuan utama pola page object?',
          options: [
            'Mempercepat eksekusi tes',
            'Memusatkan pengetahuan tentang elemen dan aksi sebuah halaman sehingga perubahan UI hanya berdampak pada satu tempat',
            'Menggantikan kebutuhan assertion',
            'Menghilangkan kebutuhan menulis tes data-driven',
          ],
          answer_index: 1,
          explanation:
            'Page object memisahkan detail UI (selector, navigasi) dari maksud tes. Ketika UI berubah, hanya page object yang perlu diperbarui, sehingga biaya perawatan suite turun drastis.',
          points: 1,
        },
        {
          prompt:
            'Sebuah tes UI lulus saat dijalankan sendiri tetapi gagal ketika dijalankan bersama tes lain. Penyebab paling mungkin adalah…',
          options: [
            'Browser tidak mendukung fitur tersebut',
            'Ketergantungan data atau urutan antar tes (isolasi tidak terpenuhi)',
            'Assertion terlalu sedikit',
            'Timeout CI terlalu panjang',
          ],
          answer_index: 1,
          explanation:
            'Pola "lulus sendiri, gagal bersama" hampir selalu menandakan isolasi yang gagal: data bersama, akun bersama, atau ketergantungan pada keadaan yang ditinggalkan tes lain.',
          points: 1,
        },
        {
          prompt:
            'Dalam strategi lintas browser, pendekatan yang paling efisien adalah…',
          options: [
            'Menulis suite terpisah untuk setiap browser',
            'Menjalankan satu suite tes yang sama pada beberapa target browser',
            'Hanya menguji pada browser terbaru',
            'Menjalankan semua tes di semua browser setiap hari',
          ],
          answer_index: 1,
          explanation:
            'Satu suite yang dijalankan pada banyak target browser menjaga biaya perawatan tetap rendah sambil tetap mendeteksi perbedaan antar browser. Suite terpisah per browser menggandakan pekerjaan perawatan.',
          points: 1,
        },
        {
          prompt:
            'Apa manfaat sampingan pengujian aksesibilitas bagi otomasi UI?',
          options: [
            'Tidak ada hubungan antara keduanya',
            'Aplikasi yang aksesibel menyediakan peran dan label yang stabil sehingga locator otomasi menjadi lebih tahan perubahan',
            'Aksesibilitas membuat tes berjalan lebih cepat',
            'Aksesibilitas menghilangkan kebutuhan data uji',
          ],
          answer_index: 1,
          explanation:
            'Locator berbasis peran dan nama aksesibel mengikuti maksud pengguna, bukan struktur DOM. Meningkatkan aksesibilitas sekaligus memperkuat ketahanan locator otomasi.',
          points: 1,
        },
      ],
    },
  ],
};

export const CONTENT_B: SeedCourse[] = [basicAutomation, apiAutomation, webAutomation];
