/**
 * Curriculum content, part A — courses 1–3.
 *
 * Owned by Lane E. Pure data: no database access, no side effects.
 * Content language is Bahasa Indonesia (the product language); identifiers are English.
 *
 * Courses here:
 *   1. QA Introduction          (pillar 'QA Introduction')
 *   2. QA Test Technique        (pillar 'QA Test Technique')
 *   3. QA Test Activity         (pillar 'QA Test Activity')
 */

import type { SeedCourse } from './types.js';

/* ==================================================================== *
 * 1 — QA Introduction
 * ==================================================================== */

const qaIntroduction: SeedCourse = {
  slug: 'qa-introduction',
  title: 'QA Introduction: Fondasi Software Quality Assurance',
  subtitle: 'Dari mitos "QA = tukang cari bug" menuju disiplin rekayasa mutu perangkat lunak.',
  description:
    'Kursus pembuka yang membangun cara berpikir seorang QA engineer: apa itu kualitas, dari mana asal cacat perangkat lunak, di mana QA berada di dalam SDLC, dan bagaimana seluruh siklus QA end-to-end bekerja. Setiap konsep langsung dipetakan ke fitur QATools sehingga teori tidak berhenti di slide.',
  level: 'beginner',
  pillar: 'QA Introduction',
  estimated_minutes: 420,
  order_index: 1,
  icon: '🎓',
  tags: ['peran-qa', 'kualitas', 'sdlc', 'onboarding'],
  modules: [
    {
      code: 'QA-INTRO-M1',
      title: 'Kualitas & Peran QA',
      summary: 'Menyepakati definisi kualitas, membedakan QA/QC/testing, dan memetakan tanggung jawab seorang QA engineer.',
      order_index: 1,
      lessons: [
        {
          code: 'L-INTRO-01',
          title: 'Apa Itu Kualitas Perangkat Lunak',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 1,
          content_md: `## Mengapa "kualitas" harus didefinisikan lebih dulu

Kata *kualitas* terdengar jelas sampai kita diminta membuktikannya. Dua orang bisa menguji aplikasi
yang sama dan menghasilkan kesimpulan berbeda, bukan karena salah satu tidak kompeten, tetapi karena
mereka memakai definisi yang berbeda. Sebelum menulis satu test case pun, sebuah tim harus menyepakati
definisi kualitas yang bisa diukur.

Secara industri, kualitas perangkat lunak biasanya dilihat dari lima sudut:

| Sudut pandang | Pertanyaan kuncinya | Contoh bukti terukur |
|---|---|---|
| Fungsionalitas | Apakah fitur melakukan apa yang dijanjikan? | 100% acceptance criteria kritis lulus |
| Keandalan | Apakah perilakunya konsisten dan tahan gangguan? | MTBF, defect leakage < 5% |
| Kinerja | Apakah tetap cepat saat beban realistis? | p95 respons API < 400 ms |
| Keamanan | Apakah data dan akses terkendali? | 0 temuan OWASP kritikal |
| Maintainability | Seberapa mahal produk ini diubah? | Flaky rate < 2%, waktu regresi turun |

**Kualitas bukan "bebas bug".** Nol bug tidak berarti apa-apa bila fitur yang dibangun tidak dipakai
atau tidak menjawab kebutuhan user. Sebaliknya, produk dengan bug minor yang terdokumentasi bisa
sangat sukses bila tim tahu risikonya dan memutuskan secara sadar.

### Definisi kerja yang dipakai QATools

> Kualitas adalah tingkat kesesuaian antara **perilaku sistem yang teramati**, **kebutuhan yang
> disepakati**, dan **harapan pengguna** — dinyatakan sebagai bukti yang bisa diaudit.

Tiga kata terakhir itu penting. QA bukan profesi opini ("menurut saya sudah oke"), melainkan profesi
bukti. Setiap klaim kualitas harus punya artefak pendukung: test case, hasil eksekusi, log, query,
screenshot, atau metrik.

### Empat biaya yang harus dipahami setiap QA

1. **Cost of prevention** — menulis requirement yang jelas, review desain, unit test.
2. **Cost of detection** — menjalankan test sebelum rilis.
3. **Cost of failure internal** — bug ditemukan di staging, diperbaiki sebelum user terdampak.
4. **Cost of failure eksternal** — bug lolos ke produksi: kehilangan data, refund, kepercayaan hilang.

Urutan biayanya tumbuh sangat tajam. Menemukan kesalahan requirement saat sesi grooming bisa
menghabiskan 15 menit. Kesalahan yang sama yang baru ditemukan di produksi bisa menghabiskan
berminggu-minggu kerja plus biaya reputasi. Inilah alasan QA modern menggeser energi ke hulu
(*shift left*), bukan menumpuk semua pengujian di akhir.

### Latihan

Ambil satu aplikasi yang Anda pakai setiap hari. Tuliskan satu bukti untuk masing-masing dari lima
sudut pandang di tabel atas. Bila Anda tidak bisa menemukan bukti untuk salah satu sudut, itulah
celah pengukuran pertama yang harus Anda tutup saat masuk ke proyek nyata.`,
        },
        {
          code: 'L-INTRO-02',
          title: 'QA, QC, dan Testing: Bukan Sinonim',
          kind: 'reading',
          duration_minutes: 18,
          order_index: 2,
          content_md: `## Tiga istilah yang sering dipakai bergantian (dan itu masalah)

Di banyak lowongan kerja, "QA engineer" berarti "orang yang mengetes aplikasi". Definisi itu terlalu
sempit. Membangun kesepahaman istilah membuat ruang lingkup pekerjaan Anda jelas dan terukur.

| Aspek | Quality Assurance | Quality Control | Testing |
|---|---|---|---|
| Fokus | Proses | Produk | Aktivitas teknis |
| Sifat | Preventif | Detektif | Verifikasi & validasi |
| Pertanyaan | "Apakah cara kerja kita mencegah cacat?" | "Apakah hasil kerja ini memenuhi standar?" | "Apakah sistem berperilaku sesuai harapan?" |
| Contoh artefak | Definition of Done, checklist review, standar test | Audit, inspeksi, hasil uji | Test case, script otomasi, laporan run |
| Ukuran sukses | Cacat tidak tercipta | Cacat terdeteksi sebelum rilis | Perilaku terbukti benar/salah |

### Hubungannya dalam satu kalimat

**QA membangun sistemnya, QC memeriksa hasilnya, testing adalah alat utama QC.** Ketika seorang QA
hanya menjalankan test case sepanjang hari, dia sedang menjadi QC — itu pekerjaan yang sah, tetapi
belum memanfaatkan penuh nilai seorang QA.

### Contoh nyata di QATools

Bayangkan tim Anda berulang kali menerima requirement yang berbunyi *"user bisa melakukan checkout"*.
Akibatnya, setiap test case yang diturunkan berbeda-beda dan seringkali tidak lengkap.

- **Respons QC:** menambah jumlah test case negatif pada setiap rilis.
- **Respons QA:** memperbaiki definisi requirement — menambahkan acceptance criteria yang bisa diuji,
  lalu memakai matrix untuk membuktikan bahwa tiap requirement punya test case.

Cara kedua menghilangkan seluruh kelas masalah, bukan satu instance masalah.

### Verifikasi vs validasi

- **Verifikasi** — "Apakah kita membangun produk dengan benar?" Diuji terhadap spesifikasi.
  *Contoh:* tombol Simpan menyimpan data ke database.
- **Validasi** — "Apakah kita membangun produk yang benar?" Diuji terhadap kebutuhan user.
  *Contoh:* user benar-benar bisa menyelesaikan pembelian tanpa bantuan customer support.

Sebuah sistem bisa lulus verifikasi penuh dan tetap gagal validasi. Itu kejadian yang lebih sering
daripada yang orang duga.

### Latihan

Ambil satu bug yang pernah Anda temukan. Klasifikasikan: apakah ini kegagalan verifikasi (spesifikasi
tidak dipenuhi) atau kegagalan validasi (spesifikasi sendiri yang salah)? Solusi untuk keduanya
berbeda: yang pertama butuh perbaikan kode, yang kedua butuh perbaikan proses requirement.`,
        },
        {
          code: 'L-INTRO-03',
          title: 'Peran & Tanggung Jawab QA Engineer',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 3,
          content_md: `## QA bukan gerbang terakhir, tapi jaring pengaman di setiap tahap

Ada satu gambar yang sering muncul di kepala orang: developer menulis kode, melemparnya ke QA, QA
menemukan bug, lalu melemparnya kembali. Model itu disebut *throw it over the wall*, dan hampir selalu
menghasilkan siklus yang lambat serta hubungan kerja yang konfrontatif.

QA modern bekerja paralel dengan pengembangan, bukan setelahnya.

### Matriks tanggung jawab

| Tahap | Kontribusi utama QA | Artefak yang dihasilkan |
|---|---|---|
| Discovery | Menantang requirement: apa definisi "selesai"? | Daftar pertanyaan klarifikasi, acceptance criteria |
| Desain | Menilai risikoo & testability | Analisis risiko, catatan arsitektur pengujian |
| Perencanaan | Memperkirakan effort & memilih cakupan | Strategi test, cycle & sprint plan |
| Implementasi | Menyiapkan test case & data sebelum kode siap | Test case, test data set, environment |
| Verifikasi | Mengeksekusi dengan bukti | Hasil run, defect, evidence |
| Rilis | Menyatakan go / no-go berbasis data | Laporan kesiapan, metrik |
| Pasca-rilis | Menutup umpan balik ke proses | Analisis defect lolos, perbaikan proses |

### Lima kompetensi inti

1. **Berpikir analitis** — memecah sistem menjadi perilaku yang bisa diperiksa.
2. **Ketelitian bertarget** — tahu di mana bug paling mungkin dan paling mahal, lalu fokus ke sana.
3. **Komunikasi** — laporan bug yang jelas menghemat lebih banyak waktu daripada sepuluh test case baru.
4. **Literasi teknis** — mampu membaca kode, HTTP, SQL, dan log untuk mempersempit akar masalah.
5. **Kepemilikan kualitas** — tidak menyatakan "sudah diuji" tanpa bukti yang bisa direproduksi.

### Yang BUKAN tanggung jawab QA

- **Menjamin nol bug.** QA menjamin risiko diketahui dan terdokumentasi.
- **Menjadi polisi rilis.** Keputusan rilis adalah keputusan produk; QA menyediakan datanya.
- **Mengetes semuanya.** Pengujian menyeluruh tidak mungkin; pengujian berbasis risiko yang mungkin.
- **Menggantikan unit test developer.** Piramida otomasi menempatkan unit test sebagai fondasi milik developer.

### Anti-pola yang harus dikenali sejak awal

| Anti-pola | Gejala | Perbaikan |
|---|---|---|
| QA sebagai gerbang | Bug menumpuk menjelang rilis | QA terlibat sejak refinement |
| Bug reporting sebagai dakwaan | Developer defensif | Fokus ke perilaku & bukti, bukan penilaian pribadi |
| Manual berulang tanpa akhir | Waktu regresi membengkak | Otomasi kasus stabil bernilai tinggi |
| Metrik palsu | "Jumlah test case" jadi KPI | Ukur cakupan & defect leakage |

### Latihan

Tuliskan tiga kebiasaan QA yang sudah berjalan di tim Anda (atau tim yang Anda kenal), lalu tandai
mana yang preventif dan mana yang detektif. Target realistis untuk bulan pertama: memindahkan satu
kebiasaan dari detektif ke preventif.`,
        },
      ],
    },
    {
      code: 'QA-INTRO-M2',
      title: 'Cacat, Kesalahan, dan Kegagalan',
      summary: 'Memahami rantai error → defect → failure dan kategori cacat perangkat lunak.',
      order_index: 2,
      lessons: [
        {
          code: 'L-INTRO-04',
          title: 'Rantai Error → Defect → Failure',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 1,
          content_md: `## Tiga kata yang sering tertukar

Istilah *error*, *defect*, dan *failure* sering dipakai bergantian dalam percakapan sehari-hari.
Dalam QA, ketiganya menunjuk hal yang berbeda, dan membedakannya membuat laporan bug Anda jauh lebih
tajam.

\`\`\`text
  Manusia membuat        Kode mengandung        Sistem berperilaku
      ERROR        ──▶        DEFECT      ──▶     menyimpang = FAILURE
   (kesalahan)            (cacat/fault)              (kegagalan)
        │                       │                        │
        └── penyebab ───────────┴──── manifestasi ───────┘
\`\`\`

- **Error (kesalahan):** tindakan manusia yang menghasilkan hasil tidak tepat. Contoh: developer salah
  memahami bahwa diskon dihitung *sebelum* pajak.
- **Defect / fault (cacat):** manifestasi error di dalam artefak. Contoh: baris kode yang menghitung
  diskon dari subtotal sebelum pajak.
- **Failure (kegagalan):** perilaku sistem yang menyimpang saat dijalankan. Contoh: total pembayaran
  user ternyata 5% lebih tinggi dari yang tertera di halaman ringkasan.

### Mengapa pemisahan ini penting

Ketika melaporkan bug, Anda melaporkan **failure** (perilaku teramati). Saat developer menyelidiki,
mereka mencari **defect** (baris yang salah). Saat tim melakukan retrospektif, mereka mengejar
**error** (keputusan atau asumsi yang salah).

Laporan yang hanya berisi "diskon salah" memaksa developer menebak. Laporan yang memuat nilai
teramati, nilai diharapkan, langkah reproduksi, dan konteks data memungkinkan developer melompat
langsung ke defect.

### Anatomi laporan bug yang baik

| Bagian | Isi | Contoh buruk | Contoh baik |
|---|---|---|---|
| Judul | Perilaku + kondisi, spesifik | "Diskon error" | "Diskon 10% dihitung dari harga sebelum pajak saat total > Rp500.000" |
| Lingkungan | Versi, environment, perangkat | "-" | "v2.4.1, staging, Chrome 121, akun tier Gold" |
| Langkah | Reproduksi minimal | "coba checkout" | 4 langkah bernomor dengan data uji konkret |
| Hasil aktual | Angka/teks teramati | "salah" | "Total ditampilkan Rp1.050.000" |
| Hasil diharapkan | Acuan aturan | "harus benar" | "Sesuai aturan PROMO-7, total seharusnya Rp1.000.000" |
| Bukti | Screenshot, log, respons API | tidak ada | 1 screenshot + potongan respons JSON |

### Teori sederhana tapi berguna: mengapa cacat bisa ada

1. **Kompleksitas** — kombinasi kondisi tumbuh eksponensial.
2. **Komunikasi** — requirement ambigu diterjemahkan berbeda oleh dua orang.
3. **Perubahan** — kode berubah, asumsi lama tidak ikut diperbarui.
4. **Waktu** — tekanan jadwal memotong review dan pengujian.
5. **Kelelahan** — manusia melewatkan hal yang sama ketika mengulang pekerjaan monoton.

Setiap akar penyebab punya penangkal berbeda. Kompleksitas ditangkal dengan teknik desain test
(pairwise, decision table). Komunikasi ditangkal dengan acceptance criteria. Kelelahan ditangkal
dengan otomasi.

### Latihan

Ambil satu bug nyata di produk favorit Anda dan tuliskan versi laporan lengkapnya memakai tabel di
atas. Lalu tuliskan dugaan akar penyebab di tingkat *error*, bukan hanya tingkat *defect*.`,
        },
        {
          code: 'L-INTRO-05',
          title: 'Kategori Cacat & Istilah Umum',
          kind: 'reading',
          duration_minutes: 16,
          order_index: 2,
          content_md: `## Kosakata yang akan Anda pakai setiap hari

Setiap tim punya variasi istilah, tetapi sebagian besar kembali ke daftar berikut.

### Berdasarkan sifat

| Istilah | Arti | Contoh |
|---|---|---|
| Functional defect | Perilaku tidak sesuai spesifikasi | Tombol Simpan tidak menyimpan |
| Regression defect | Fitur yang pernah bekerja kini rusak | Login rusak setelah perubahan middleware |
| Performance defect | Memenuhi fungsi tapi terlalu lambat/berat | Daftar 10.000 baris memuat 12 detik |
| Security defect | Celah akses atau kebocoran data | Endpoint mengembalikan data user lain |
| Usability defect | Sulit dipakai walau secara teknis benar | Pesan error tidak memberi tahu cara memperbaiki |
| Compatibility defect | Hanya gagal di lingkungan tertentu | Layout rusak di Safari iOS |
| Data defect | Data tersimpan/terhitung salah | Saldo tidak berkurang setelah transfer |

### Berdasarkan asal kemunculan

- **Pre-release defect** — ditemukan sebelum rilis. Ini kerja normal, bukan kabar buruk.
- **Escaped defect / production defect** — lolos ke produksi. Ini yang harus dianalisis, bukan sekadar
  diperbaiki. Setiap escaped defect adalah celah di proses, bukan hanya celah di kode.

Salah satu metrik paling jujur dalam QA adalah **defect leakage**:

\`\`\`text
defect leakage % = (jumlah defect ditemukan di produksi) / (total defect) × 100
\`\`\`

Angka kecil (misalnya di bawah 5%) menandakan proses deteksi Anda bekerja. Angka besar berarti Anda
perlu menambah cakupan di area yang bocor, atau memperbaiki hulu requirement.

### Severity vs priority — dua sumbu berbeda

Ini kesalahpahaman paling umum di tim pemula. **Severity** mengukur dampak teknis; **priority**
mengukur urgensi bisnis. Keduanya tidak selalu sejalan.

| Kombinasi | Contoh | Tindakan |
|---|---|---|
| Severity tinggi, priority tinggi | Checkout gagal total di semua user | Perbaiki sekarang, hotfix |
| Severity tinggi, priority rendah | Crash di menu admin yang dipakai 1 orang sebulan sekali | Perbaiki terjadwal |
| Severity rendah, priority tinggi | Salah tulis nama brand di halaman utama | Perbaiki cepat karena reputasi |
| Severity rendah, priority rendah | Typo di halaman bantuan | Masukkan backlog |

Aplikasi nyata: saat melaporkan bug di QATools, Anda mengisi keduanya secara terpisah. Jika QA hanya
mengisi satu sumbu, tim akan salah memprioritaskan pekerjaan.

### Latihan

Ambil sepuluh bug terakhir dari tracker tim Anda. Kelompokkan per kategori dan hitung defect leakage
sederhana bila datanya tersedia. Temuan yang paling berguna biasanya bukan jumlahnya, melainkan pola
di kategori mana cacat paling sering muncul.`,
        },
        {
          code: 'L-INTRO-13',
          title: 'Latihan: Menulis Analisis Akar Penyebab',
          kind: 'lab',
          duration_minutes: 25,
          order_index: 3,
          content_md: `## Tujuan lab

Berlatih menelusuri cacat sampai akar penyebabnya memakai teknik **lima pertanyaan "mengapa"**, lalu
menerjemahkan temuan itu menjadi perbaikan proses — bukan hanya perbaikan kode.

## Mengapa ini keterampilan QA

Memperbaiki satu bug menyelesaikan satu masalah. Memperbaiki akar penyebabnya menghilangkan seluruh
kelas masalah. Itulah perbedaan kontribusi seorang QA dan seorang tester.

## Contoh lengkap

\`\`\`text
Gejala : Total pesanan dengan kode promo lebih tinggi dari yang seharusnya.

Mengapa 1? Karena diskon dihitung dari subtotal sebelum pajak.
Mengapa 2? Karena urutan operasi di kode menghitung diskon lebih dulu.
Mengapa 3? Karena requirement tidak menyebut diskon dihitung setelah pajak.
Mengapa 4? Karena acceptance criteria REQ-001 berbunyi "diskon mengurangi total"
           tanpa menyebut basis perhitungannya.
Mengapa 5? Karena tim tidak memiliki aturan bahwa setiap perhitungan uang harus
           menyebutkan basis dan urutan operasinya secara eksplisit.

Akar penyebab : tidak ada aturan penulisan acceptance criteria untuk perhitungan uang.
Perbaikan     : tambahkan aturan pada template requirement — setiap kriteria yang menyentuh
                angka harus menyebut basis perhitungan, urutan operasi, dan aturan pembulatan.
\`\`\`

Perhatikan bahwa akar penyebabnya **bukan kode**, melainkan cara requirement ditulis. Perbaikan pada
tingkat itu mencegah seluruh kelas bug serupa di masa depan.

## Empat kategori akar penyebab

| Kategori | Contoh akar penyebab | Perbaikan khas |
|---|---|---|
| Requirement | Ambiguitas, kriteria tidak terukur | Perbaiki template & proses review |
| Desain | Asumsi arsitektur yang tidak diuji | Tambahkan tinjauan testabilitas |
| Implementasi | Kesalahan logika, penanganan nilai kosong | Perbaiki kode + tambahkan kasus batas |
| Proses | Tidak ada review, tes terlewat, lingkungan tidak siap | Ubah definisi selesai & checklist |

## Langkah lab

1. **Pilih lima cacat** dari daftar pada modul sebelumnya, prioritaskan yang berdampak terbesar.
2. Untuk setiap cacat, ajukan pertanyaan "mengapa" **lima kali**, dan catat setiap jawabannya.
3. Tentukan **kategori akar penyebab** memakai tabel di atas.
4. Tuliskan **satu perbaikan proses** per akar penyebab. Perbaikan harus spesifik dan dapat dijalankan
   minggu ini, bukan rencana umum.
5. Periksa apakah ada akar penyebab yang **berulang** di beberapa cacat. Pengulangan adalah sinyal
   prioritas tertinggi.
6. Susun ringkasan satu halaman untuk tim.

## Format keluaran

| Cacat | M1 | M2 | M3 | M4 | M5 | Kategori | Perbaikan |
|---|---|---|---|---|---|---|---|
| BUG-… | … | … | … | … | … | … | … |

## Kriteria selesai

- Lima cacat dianalisis sampai pertanyaan kelima.
- Setiap akar penyebab punya satu perbaikan konkret, bukan pernyataan umum.
- Minimal satu akar penyebab diidentifikasi sebagai berulang.
- Ringkasan menyebutkan **satu** perbaikan yang akan dimulai lebih dulu, beserta alasan prioritas.

## Refleksi

Perhatikan bahwa teknik lima "mengapa" dengan cepat meninggalkan wilayah teknis dan masuk ke wilayah
proses. Itu bukan penyimpangan — justru di sanalah perbaikan yang paling berdampak berada. Sebagian
besar cacat berulang berasal dari proses, bukan dari kelalaian individu.`,
          lab_ref: '/defects',
        },
      ],
    },
    {
      code: 'QA-INTRO-M3',
      title: 'SDLC, STLC, dan Siklus QA End-to-End',
      summary: 'Menempatkan pengujian di dalam siklus hidup perangkat lunak dan siklus hidup pengujian.',
      order_index: 3,
      lessons: [
        {
          code: 'L-INTRO-06',
          title: 'SDLC vs STLC',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 1,
          content_md: `## Dua siklus yang berjalan bersamaan

**SDLC (Software Development Life Cycle)** adalah siklus hidup produk: dari ide sampai pemeliharaan.
**STLC (Software Testing Life Cycle)** adalah siklus hidup pekerjaan pengujian: dari analisis sampai
penutupan test.

Keduanya bukan dua dunia terpisah. STLC adalah lapisan yang menempel pada SDLC; ia mulai lebih awal
daripada yang biasa orang bayangkan.

| Fase STLC | Pertanyaan utama | Artefak keluaran |
|---|---|---|
| Requirement analysis | Apa yang bisa & perlu diuji? | Testable requirements, daftar pertanyaan |
| Test planning | Bagaimana kita menguji? | Strategi, estimasi, cakupan, peran |
| Test case design | Kasus apa yang membuktikannya? | Test case, data uji, skenario |
| Environment setup | Di mana kita menguji? | Environment, akun, data set |
| Test execution | Apa hasilnya? | Hasil run, defect, bukti |
| Test closure | Apa yang kita pelajari? | Laporan, metrik, pelajaran |

### Perbandingan model SDLC dan implikasinya bagi QA

| Model | Ciri | Implikasi QA |
|---|---|---|
| Waterfall | Fase berurutan, dokumen berat | Pengujian terlambat; analisis requirement harus sangat ketat |
| V-Model | Tiap fase build punya pasangan fase verifikasi | Test design dimulai seiring desain |
| Agile/Scrum | Iterasi pendek, rilis sering | Pengujian berkelanjutan, otomasi regresi wajib |
| DevOps/CI-CD | Integrasi & rilis otomatis | Otomasi adalah prasyarat, bukan bonus |
| Shift-left modern | Kualitas dibangun sejak awal | QA ikut merancang definisi "selesai" |

### Yang berubah, yang tidak

Yang **tidak** berubah: pada akhirnya ada seseorang yang harus menyatakan "ini cukup baik untuk
dirilis", dan pernyataan itu harus berbasis bukti.

Yang **berubah**: kapan bukti itu dikumpulkan. Di waterfall, bukti dikumpulkan di akhir. Di CI/CD,
bukti dikumpulkan setiap commit sehingga pada saat rilis keputusan hampir otomatis.

### Memetakan STLC ke QATools

QATools memaksa urutan yang biasanya implisit menjadi eksplisit. Alur produk mengikuti 12 tahap
berurutan yang berpadanan dengan SDLC/STLC:

\`\`\`text
requirements → usecases → scenarios → testcases → matrix → planning
      → environment → execution → defects → regression → release → metrics
\`\`\`

Poin penting: **matrix** (traceability) tidak ada di STLC klasik. QATools menaikkannya menjadi tahap
tersendiri karena tanpa jejak yang bisa diaudit, "sudah diuji" hanya sebatas klaim.

### Latihan

Petakan setiap fase STLC ke tahap QATools yang berpadanan. Anda akan menemukan bahwa beberapa tahap
QATools menggabungkan dua fase klasik — itu disengaja agar alurnya bisa dikerjakan oleh tim kecil.`,
        },
        {
          code: 'L-INTRO-07',
          title: 'Tur Alur QA End-to-End di QATools',
          kind: 'reading',
          duration_minutes: 25,
          order_index: 2,
          content_md: `## Satu studi kasus, dua belas tahap

Halaman ini adalah tur ringkas yang akan Anda praktikkan langsung di Lab. Bayangkan Anda QA di
"TokoKita", sebuah toko online kecil, dan stakeholder meminta fitur **kode promo**.

### 1. Requirements — kumpulkan & normalisasi

Anda menuliskan kebutuhan dalam bentuk yang bisa diuji, bukan keinginan.

\`\`\`text
REQ-001  Judul   : Penerapan kode promo pada checkout
Prioritas        : tinggi
Kriteria terima  :
  - Kode valid mengurangi total sesuai tipe diskon (persen atau nominal)
  - Diskon persen dihitung dari subtotal setelah pajak
  - Kode kedaluwarsa ditolak dengan pesan yang bisa dipahami
  - Satu kode hanya bisa dipakai sekali per akun
\`\`\`

Perhatikan bahwa keempat baris kriteria terima sudah berbentuk pernyataan yang bisa dibuktikan.
Inilah perbedaan terbesar antara requirement yang bisa diuji dan yang tidak.

### 2. Use Cases — ubah menjadi perilaku bernama

\`\`\`text
UC-001  Terapkan kode promo saat checkout
Actor   : Pembeli terautentikasi
Pre     : Keranjang berisi minimal 1 item; user login
Alur    :
  1. Pembeli membuka halaman checkout
  2. Pembeli memasukkan kode promo
  3. Sistem memvalidasi kode
  4. Sistem menerapkan diskon dan memperbarui total
Pasca   : Total checkout berkurang; kode tercatat terpakai
\`\`\`

### 3. Scenarios — pecah menjadi positive, negative, edge

| Kode | Judul | Jenis |
|---|---|---|
| SC-001 | Kode persen valid diterapkan | happy_path |
| SC-002 | Kode kedaluwarsa ditolak | negative |
| SC-003 | Kode sudah dipakai akun lain | negative |
| SC-004 | Diskon melebihi subtotal | edge |
| SC-005 | Kode huruf kecil diterima | edge |

Skenario negatif dan edge inilah yang paling sering hilang ketika tim tidak menulisnya secara eksplisit.

### 4. Test Cases — tambahkan langkah & data

Setiap skenario diturunkan menjadi satu atau lebih test case dengan langkah, data uji, dan hasil yang
diharapkan. Dari SC-004 (diskon melebihi subtotal) lahirlah dua kasus: persen 150% dan nominal lebih
besar dari total.

### 5. Matrix — buktikan jejaknya

Matriks menunjukkan REQ-001 tercakup oleh UC-001, SC-001…SC-005, dan seluruh test case turunannya.
Bila ada requirement tanpa test case, sistem menandainya sebagai **gap**. Bila ada test case tanpa
requirement induk, ia ditandai **orphan**. Keduanya adalah temuan, bukan sekadar tampilan.

### 6–7. Planning & Environment

Anda memecah pekerjaan ke dalam cycle dan sprint, menyiapkan environment *staging* beserta data uji:
akun pembeli, akun dengan kode sudah terpakai, dan kode kedaluwarsa buatan.

### 8. Execution

Kasus dijalankan lewat beberapa mesin: manual untuk alur eksploratif, API untuk aturan diskon,
database untuk memverifikasi pencatatan pemakaian kode, web automation untuk alur UI.

### 9. Defects

Temuan dicatat dengan severity dan priority terpisah. Langkah reproduksi harus bisa diikuti orang lain
tanpa bertanya.

### 10–12. Regression, Release, Metrics

Kasus bernilai tinggi masuk suite regresi. Release gate dihitung dari pass rate terhadap ambang mutu
proyek. Setelah rilis, metrik menjawab pertanyaan: apakah proses kita membaik dibanding siklus lalu?

### Latihan

Jalankan alur ini untuk fitur kecil di aplikasi Anda sendiri, minimal sampai tahap 5. Panjangnya tidak
penting; yang penting setiap artefak benar-benar terhubung ke artefak sebelumnya.`,
          lab_ref: '/requirements',
        },
        {
          code: 'L-INTRO-08',
          title: 'Lab: Menyusun Requirement yang Dapat Diuji',
          kind: 'lab',
          duration_minutes: 30,
          order_index: 3,
          content_md: `## Tujuan lab

Mengubah satu kalimat kebutuhan yang ambigu menjadi requirement yang dapat diuji, lalu membuktikan
keterlacakannya lewat matriks.

## Skenario

Stakeholder mengirim pesan singkat: *"Kita butuh fitur lupa password."*

## Langkah

1. Buka halaman **Requirements** di QATools. Buat project bila belum ada.
2. Tulis requirement \`REQ-001 — Reset Password\`. Salin kalimat stakeholder apa adanya ke deskripsi.
3. Sekarang tulis minimal **lima acceptance criteria** yang bisa dibuktikan. Gunakan pola:
   - *Diberikan* kondisi awal,
   - *ketika* aksi dilakukan,
   - *maka* hasil teramati.
4. Tandai prioritas requirement. Untuk reset password, jawabannya hampir selalu **kritis**: kegagalan
   di sini memblokir seluruh akses user.
5. Ajukan tiga pertanyaan yang belum terjawab oleh stakeholder. Contoh yang bagus:
   - Berapa lama tautan reset berlaku?
   - Apakah user yang belum terverifikasi email boleh mereset?
   - Apakah permintaan reset berulang harus dibatasi (rate limit)?
6. Simpan, lalu buka **Traceability Matrix** dan pastikan requirement baru Anda muncul di sana.
   Perhatikan status cakupannya: saat ini pasti **gap**, karena belum ada test case.

## Kriteria selesai

- Requirement tersimpan dengan minimal lima acceptance criteria.
- Setiap acceptance criteria bisa diterjemahkan menjadi test case tanpa bertanya lagi.
- Requirement tampil di matrix dengan status cakupan awal yang jelas.

## Refleksi

Bandingkan requirement awal (satu kalimat) dengan hasil akhir Anda. Selisih itulah nilai tambah QA
pada tahap hulu: bukan menemukan bug, tetapi mencegah seluruh kelas bug tercipta.`,
          lab_ref: '/usecases',
        },
        {
          code: 'L-INTRO-11',
          title: 'Lab: Peta Cacat & Analisis Akar Penyebab',
          kind: 'lab',
          duration_minutes: 25,
          order_index: 3,
          content_md: `## Tujuan lab

Melatih dua kebiasaan yang membedakan QA reaktif dan QA yang memperbaiki proses: mengelompokkan cacat
berdasarkan kategori, dan menelusuri akar penyebab sampai tingkat **error**, bukan berhenti di defect.

## Skenario

Tim Anda mencatat 20 defect pada satu siklus. Daftar mentahnya ada di bawah.

## Data defect

\`\`\`text
 1. Tombol Simpan tidak menyimpan data saat field catatan kosong
 2. Format tanggal tampil MM/DD/YYYY padahal seharusnya DD/MM/YYYY
 3. Halaman daftar pesanan memuat 14 detik dengan 9.000 baris
 4. Login gagal bila email memakai huruf besar
 5. Setelah ubah alamat, halaman checkout menampilkan alamat lama
 6. Total keranjang tidak berubah setelah item dihapus
 7. Endpoint detail pesanan mengembalikan data pesanan milik user lain
 8. Tombol Batal di modal tidak berfungsi
 9. Unggahan berkas 6 MB gagal tanpa pesan error
10. Laporan bulanan menghitung pesanan yang dibatalkan
11. Nomor telepon dengan tanda + ditolak
12. Urutan kolom berubah sendiri setelah refresh
13. Kode promo huruf kecil ditolak
14. Notifikasi email terkirim dua kali
15. Filter status menghilang setelah kembali dari halaman detail
16. Subtotal tidak memperhitungkan biaya kirim
17. Ikon tidak punya teks alternatif
18. Perubahan profil hilang bila dua tab dibuka bersamaan
19. Pencarian tidak menemukan produk dengan karakter khusus
20. Pesan error dalam bahasa Inggris di halaman berbahasa Indonesia
\`\`\`

## Langkah

1. **Klasifikasikan.** Kelompokkan keduapuluh defect memakai kategori dari modul ini: fungsional,
   regresi, performa, keamanan, usability, kompatibilitas, data.
2. **Tetapkan severity dan priority.** Isi keduanya secara terpisah dan tandai setiap kasus di mana
   kedua sumbu itu berbeda arah.
3. **Hitung distribusi.** Buat tabel jumlah defect per kategori.
4. **Cari akar penyebab tingkat error.** Untuk lima defect dengan dampak terbesar, tuliskan dugaan
   *error* (keputusan atau asumsi manusia), bukan hanya *defect* (baris kode yang salah).
5. **Identifikasi clustering.** Apakah ada kategori atau modul yang menumpuk? Berapa banyak defect
   yang berasal dari satu area?
6. **Usulkan perbaikan proses.** Untuk setiap akar penyebab, tuliskan satu perubahan proses yang
   mencegah seluruh kelas masalah itu, bukan hanya instance-nya.

## Format keluaran

| # | Kategori | Severity | Priority | Akar penyebab (error) | Perbaikan proses |
|---|---|---|---|---|---|
| 1 | … | … | … | … | … |

## Kriteria selesai

- Keduapuluh defect terkategori tanpa ada yang tersisa.
- Minimal lima defect punya severity dan priority yang berbeda arah, dengan penjelasan singkat.
- Minimal tiga perbaikan proses yang bersifat mencegah kelas masalah, bukan menambal satu instance.

## Refleksi

Perhatikan defect nomor 7 dan nomor 18. Salah satunya adalah celah keamanan, satunya lagi adalah
kondisi balapan. Keduanya hampir tidak pernah muncul dari pengujian happy path — dan keduanya akan
selalu muncul kembali bila perbaikannya hanya bersifat menambal satu jalur.`,
          lab_ref: '/defects',
        },
      ],
    },
    {
      code: 'QA-INTRO-M4',
      title: 'Prinsip Pengujian & Mindset QA',
      summary: 'Tujuh prinsip pengujian, bias kognitif yang merusak, dan etika pelaporan.',
      order_index: 4,
      lessons: [
        {
          code: 'L-INTRO-09',
          title: 'Tujuh Prinsip Pengujian',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 1,
          content_md: `## Prinsip yang menyelamatkan Anda dari kerja sia-sia

Tujuh prinsip berikut bukan teori akademis. Masing-masing adalah pelajaran mahal yang sudah dibayar
industri, dan masing-masing langsung mengubah cara Anda mengalokasikan waktu.

### 1. Pengujian menunjukkan adanya cacat, bukan ketiadaannya

Sebuah test yang lulus membuktikan sistem berperilaku benar *pada kondisi yang diuji*. Ia tidak
membuktikan tidak ada bug di tempat lain. Karena itu kata "terbukti bebas bug" tidak pernah boleh
muncul dalam laporan.

> Rumusan aman: "Pada 214 test case yang dijalankan di environment staging, 209 lulus dan 5 gagal."

### 2. Pengujian menyeluruh tidak mungkin

Kombinasi input, urutan aksi, dan kondisi lingkungan tidak terhingga. Setiap strategi pengujian adalah
latihan **memilih**. Yang membedakan QA baik dan QA hebat adalah kualitas pilihannya.

### 3. Pengujian lebih awal menghemat waktu dan biaya

Cacat yang ditemukan saat review requirement diperbaiki dengan mengedit satu paragraf. Cacat yang
sama bila ditemukan di produksi bisa memicu migrasi data. Ini dasar dari *shift left*.

### 4. Cacat cenderung mengelompok (defect clustering)

Sejumlah kecil modul biasanya menyumbang mayoritas cacat. Analisis data defect per modul hampir selalu
menghasilkan distribusi yang tidak rata. Konsekuensinya: setelah modul tertentu terbukti rawan, alokasi
pengujian di sana harus lebih besar, bukan sama rata.

### 5. Pestisida (pesticide paradox)

Test case yang diulang terus-menerus berhenti menemukan bug baru. Regresi tetap perlu dijalankan, tapi
cakupan harus diperbarui: tambah variasi data, ubah kombinasi, atau tambahkan skenario eksploratif.

### 6. Pengujian bergantung pada konteks

Aplikasi perbankan dan game kasual tidak boleh diuji dengan standar yang sama. Kriteria "cukup aman
untuk rilis" ditentukan oleh risiko bisnis, bukan oleh template.

### 7. Kekeliruan "tidak ada bug" (absence-of-errors fallacy)

Sistem yang bebas bug tetapi tidak memenuhi kebutuhan user tetap gagal. Verifikasi tanpa validasi
adalah pekerjaan yang rapi menuju tempat yang salah.

### Tabel ringkas

| Prinsip | Kalimat praktis | Kebiasaan yang lahir |
|---|---|---|
| 1 | Lulus ≠ bebas bug | Laporkan cakupan, bukan jaminan |
| 2 | Pilih, jangan kerjakan semua | Prioritaskan berbasis risiko |
| 3 | Uji lebih awal | Terlibat di refinement |
| 4 | Cacat mengelompok | Fokuskan energi ke modul rawan |
| 5 | Variasi melawan kebuntuan | Perbarui data & skenario berkala |
| 6 | Konteks menentukan standar | Sesuaikan strategi per produk |
| 7 | Benar belum tentu berguna | Selalu validasi ke user |

### Latihan

Pilih satu prinsip yang paling sering dilanggar di tim Anda, dan tuliskan satu perubahan kebiasaan
konkret yang bisa dimulai minggu ini.`,
        },
        {
          code: 'L-INTRO-10',
          title: 'Bias Kognitif & Etika Pelaporan',
          kind: 'reading',
          duration_minutes: 18,
          order_index: 2,
          content_md: `## Otak Anda adalah alat ukur yang bisa keliru

Pengujian adalah pekerjaan kognitif. Alat ukurnya adalah perhatian dan penalaran Anda, dan keduanya
punya mode kegagalan yang terdokumentasi baik.

| Bias | Bagaimana muncul saat menguji | Penangkal praktis |
|---|---|---|
| Confirmation bias | Anda mencari bukti bahwa fitur bekerja, bukan bahwa ia gagal | Tulis dulu hipotesis "bagaimana ini bisa gagal" |
| Automation bias | Anda memercayai hasil otomasi tanpa memeriksa assertion | Review assertion, bukan hanya status hijau |
| Anchoring | Estimasi pertama mengunci estimasi berikutnya | Estimasi ulang dari data historis |
| Sunk cost | Melanjutkan skenario yang jelas tidak produktif | Timebox eksplorasi, catat dan lanjut |
| Availability | Menguji area yang paling Anda kuasai | Bagi area secara sengaja, rotasi modul |
| Curse of knowledge | Anda lupa bahwa user baru tidak tahu konteks | Uji sebagai pengguna baru, tanpa asumsi |

### Etika pelaporan

1. **Laporkan apa yang teramati, bukan kesimpulan.** "Total menampilkan Rp1.050.000" lebih berguna
   daripada "logika pajak rusak".
2. **Jangan memperbesar atau memperkecil temuan.** Melebih-lebihkan merusak kepercayaan; menutupi
   temuan membahayakan produk.
3. **Selalu sertakan cara reproduksi.** Bug yang tidak bisa direproduksi tidak bisa diperbaiki.
4. **Satu bug, satu laporan.** Menggabungkan beberapa cacat dalam satu tiket membuat pelacakan kacau.
5. **Hormati orangnya, kritik produknya.** "Perilaku ini menyimpang dari REQ-001" bukan "kode siapa ini?".
6. **Jangan menandai selesai tanpa verifikasi.** Status *verified* berarti Anda sudah menjalankan
   ulang dan melihat perilaku benar.

### Definisi selesai yang menutup celah

Tim tanpa definisi "selesai" yang eksplisit selalu berdebat di akhir. Contoh definisi yang bisa dipakai:

\`\`\`text
Sebuah user story SELESAI bila:
  [ ] Kode sudah di-review minimal 1 orang
  [ ] Unit test lulus di CI
  [ ] Acceptance criteria punya test case yang tertaut di matrix
  [ ] Semua test case berprioritas kritis & tinggi lulus di staging
  [ ] Tidak ada defect severity blocker atau critical yang terbuka
  [ ] Dokumentasi / catatan rilis diperbarui bila perilaku berubah
\`\`\`

Perhatikan bahwa daftar itu mencampur syarat teknis dan syarat QA. Itu disengaja: definisi selesai
adalah kontrak bersama, bukan milik satu peran.

### Latihan

Ambil satu bias dari tabel dan cari contoh nyata di pekerjaan Anda sendiri. Bias yang tidak Anda sadari
adalah bias yang paling mahal.`,
        },
        {
          code: 'L-INTRO-12',
          title: 'Lab: Klasifikasi Severity & Priority',
          kind: 'lab',
          duration_minutes: 20,
          order_index: 3,
          content_md: `## Tujuan lab

Melatih pemisahan **severity** (dampak teknis) dan **priority** (urgensi bisnis) — dua sumbu yang paling
sering dicampur, dan sumber utama perdebatan prioritisasi dengan tim produk.

## Aturan yang dipakai

\`\`\`text
Severity (dampak teknis)   : cosmetic · minor · major · critical · blocker
Priority (urgensi bisnis)  : rendah · sedang · tinggi · kritis

Pertanyaan pemandu:
  Severity  → "seberapa rusak sistemnya?"
  Priority  → "seberapa mendesak bagi bisnis?"
\`\`\`

## Kasus untuk diklasifikasi

| # | Kasus | Severity? | Priority? |
|---|---|---|---|
| 1 | Checkout gagal untuk semua pengguna | … | … |
| 2 | Nama produk salah tulis di halaman utama kampanye | … | … |
| 3 | Menu admin langka (dipakai 2 orang/bulan) menyebabkan crash | … | … |
| 4 | Typo pada halaman bantuan FAQ | … | … |
| 5 | Laporan pajak salah hitung 1% | … | … |
| 6 | Tombol berwarna kurang kontras (gagal aksesibilitas) | … | … |
| 7 | Data pelanggan terlihat oleh pengguna lain | … | … |
| 8 | Ikon keranjang menampilkan angka lama hingga refresh | … | … |
| 9 | Halaman daftar produk lambat 3 detik saat jam sibuk | … | … |
| 10 | Pengguna tidak bisa mengubah kata sandi | … | … |

## Langkah

1. Isi kolom severity dan priority untuk kesepuluh kasus.
2. Tandai kasus yang **berbeda arah** (severity tinggi tetapi priority rendah, atau sebaliknya).
3. Untuk setiap kasus berbeda arah, tuliskan satu kalimat pembenaran yang menyebut dampak dan konteks.
4. Tentukan tiga kasus yang akan Anda prioritaskan bila tersisa satu hari sebelum rilis, beserta alasan
   berbasis risiko bisnis (bukan kemudahan perbaikan).
5. Bandingkan hasil Anda dengan rekan atau keputusan tim. Perbedaan biasanya muncul pada kasus 6 dan 9 —
   keduanya sangat bergantung pada konteks produk.

## Kunci pembahasan

| # | Severity | Priority | Alasan singkat |
|---|---|---|---|
| 1 | blocker | kritis | Alur pendapatan mati total |
| 2 | cosmetic | tinggi | Dampak teknis nol, risiko reputasi besar |
| 3 | major | rendah | Rusak, tetapi audiensnya sangat kecil |
| 4 | cosmetic | rendah | Tidak memengaruhi fungsi maupun persepsi luas |
| 5 | major | kritis | Kesalahan finansial berskala |
| 6 | minor | sedang | Bukan fungsi, tetapi ada kewajiban aksesibilitas |
| 7 | blocker | kritis | Kebocoran data; berpotensi kewajiban hukum |
| 8 | minor | sedang | Menyesatkan pengguna |
| 9 | major | tinggi | Memengaruhi konversi pada jam sibuk |
| 10 | major | tinggi | Menyangkut keamanan akun |

## Kriteria selesai

- Kesepuluh kasus terisi dengan severity dan priority.
- Minimal tiga kasus ditandai berbeda arah dengan pembenaran tertulis.
- Tiga prioritas untuk sisa satu hari dijelaskan berdasarkan risiko bisnis.

## Refleksi

Bila Anda kesulitan memisahkan kedua sumbu, ajukan dua pertanyaan berurutan: "kalau ini tidak
diperbaiki, apa yang rusak?" (menghasilkan severity) lalu "kalau ini tidak diperbaiki minggu ini, apa
yang hilang?" (menghasilkan priority).`,
          lab_ref: '/defects',
        },
      ],
    },
  ],
  quizzes: [
    {
      title: 'Kuis QA Introduction',
      pass_score: 70,
      order_index: 1,
      questions: [
        {
          prompt:
            'Seorang QA menyatakan "aplikasi ini bebas bug karena seluruh 180 test case lulus". Prinsip pengujian mana yang dilanggar?',
          options: [
            'Pesticide paradox',
            'Pengujian menunjukkan adanya cacat, bukan ketiadaannya',
            'Defect clustering',
            'Pengujian bergantung pada konteks',
          ],
          answer_index: 1,
          explanation:
            'Hasil lulus hanya membuktikan perilaku benar pada kondisi yang diuji. Jumlah test case yang lulus tidak pernah membuktikan tidak ada cacat di tempat lain, sehingga klaim "bebas bug" tidak sah.',
          points: 1,
        },
        {
          prompt: 'Apa perbedaan utama antara aktivitas Quality Assurance dan Quality Control?',
          options: [
            'QA berfokus pada produk, QC berfokus pada proses',
            'QA bersifat preventif terhadap proses, QC bersifat detektif terhadap produk',
            'QA hanya dilakukan manajer, QC hanya dilakukan tester',
            'QA dan QC adalah dua nama untuk aktivitas yang sama',
          ],
          answer_index: 1,
          explanation:
            'QA membangun sistem yang mencegah cacat tercipta (preventif, berorientasi proses), sedangkan QC memeriksa hasil kerja terhadap standar (detektif, berorientasi produk). Testing adalah alat utama QC.',
          points: 1,
        },
        {
          prompt:
            'Sebuah kesalahan penulisan nama brand di halaman utama tidak memengaruhi fungsi apa pun, namun perusahaan ingin segera memperbaikinya. Bagaimana klasifikasi yang tepat?',
          options: [
            'Severity tinggi, priority tinggi',
            'Severity rendah, priority tinggi',
            'Severity tinggi, priority rendah',
            'Severity rendah, priority rendah',
          ],
          answer_index: 1,
          explanation:
            'Severity mengukur dampak teknis (rendah: tidak ada fungsi yang rusak), sedangkan priority mengukur urgensi bisnis (tinggi: berdampak pada persepsi merek). Keduanya memang dapat berbeda arah.',
          points: 1,
        },
        {
          prompt: 'Urutan yang benar dalam rantai penyebab cacat perangkat lunak adalah…',
          options: [
            'Failure → Defect → Error',
            'Error → Defect → Failure',
            'Defect → Error → Failure',
            'Error → Failure → Defect',
          ],
          answer_index: 1,
          explanation:
            'Manusia membuat error (kesalahan), error meninggalkan jejak pada artefak sebagai defect (cacat), dan defect tersebut termanifestasi saat sistem dijalankan sebagai failure (kegagalan).',
          points: 1,
        },
        {
          prompt:
            'Mengapa QATools menempatkan Traceability Matrix sebagai tahap tersendiri, bukan sekadar laporan tambahan?',
          options: [
            'Agar jumlah test case terlihat lebih banyak',
            'Karena tanpa jejak yang dapat diaudit, klaim "sudah diuji" tidak dapat dibuktikan',
            'Karena matriks menggantikan kebutuhan test case',
            'Agar QA tidak perlu menjalankan eksekusi',
          ],
          answer_index: 1,
          explanation:
            'Matriks menghubungkan requirement → use case → skenario → test case sehingga cakupan, gap, dan orphan dapat dibuktikan secara audit. Klaim pengujian tanpa keterlacakan hanyalah asersi.',
          points: 1,
        },
        {
          prompt: 'Manakah pernyataan yang paling tepat menggambarkan prinsip "pesticide paradox"?',
          options: [
            'Cacat cenderung menumpuk di sejumlah kecil modul',
            'Test case yang diulang tanpa variasi berhenti menemukan cacat baru',
            'Pengujian menyeluruh tidak mungkin dilakukan',
            'Sistem tanpa bug tetap bisa gagal memenuhi kebutuhan user',
          ],
          answer_index: 1,
          explanation:
            'Seperti pestisida yang efektivitasnya menurun, suite test yang tidak diperbarui secara bertahap kehilangan daya temunya. Solusinya adalah memperbarui data uji, kombinasi, dan skenario secara berkala.',
          points: 1,
        },
      ],
    },
  ],
};

/* ==================================================================== *
 * 2 — QA Test Technique
 * ==================================================================== */

const qaTestTechnique: SeedCourse = {
  slug: 'qa-test-technique',
  title: 'QA Test Technique: Merancang Kasus Uji yang Efektif',
  subtitle: 'Equivalence partitioning, boundary value, decision table, state transition, pairwise, error guessing, dan exploratory testing.',
  description:
    'Kursus inti desain test case. Anda akan belajar memilih teknik berdasarkan bentuk input dan logika yang diuji, menghitung berapa kasus yang benar-benar diperlukan, serta memakai matriks orthogonal array untuk memangkas kombinasi tanpa kehilangan daya temuan.',
  level: 'intermediate',
  pillar: 'QA Test Technique',
  estimated_minutes: 780,
  order_index: 2,
  icon: '🧠',
  tags: ['teknik-desain', 'boundary', 'decision-table', 'pairwise', 'exploratory'],
  modules: [
    {
      code: 'QA-TECH-M1',
      title: 'Mengapa Teknik Desain Menentukan Segalanya',
      summary: 'Biaya pengujian, batas kemampuan input, dan kerangka memilih teknik secara sistematis.',
      order_index: 1,
      lessons: [
        {
          code: 'L-TECH-01',
          title: 'Masalah Ledakan Kombinasi',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 1,
          content_md: `## Hitung dulu sebelum menulis test case

Bayangkan sebuah form pendaftaran dengan parameter berikut:

| Parameter | Nilai yang mungkin | Jumlah |
|---|---|---|
| Jenis akun | Personal, Bisnis | 2 |
| Metode pembayaran | Kartu, Transfer, E-wallet, Virtual account | 4 |
| Negara | Indonesia, Malaysia, Singapura | 3 |
| Mata uang | IDR, MYR, SGD, USD | 4 |
| Notifikasi | Email, SMS, Keduanya, Tidak ada | 4 |

Kombinasi penuh:

\`\`\`text
2 × 4 × 3 × 4 × 4 = 384 test case
\`\`\`

Dengan asumsi 8 menit per kasus, itu setara **51 jam** hanya untuk satu form, dan belum menghitung
perubahan di kemudian hari. Tidak ada tim yang punya anggaran waktu seperti itu.

### Konsekuensinya bukan "kurangi pengujian"

Ini adalah kesalahpahaman yang mahal. Yang benar: **pilih kasus secara cerdas** sehingga daya temunya
tetap tinggi dengan jumlah yang jauh lebih kecil. Inilah pekerjaan teknik desain test.

Dengan *equivalence partitioning* dan *boundary value analysis*, 384 kasus bisa menyusut menjadi belasan
tanpa kehilangan cakupan pada kesalahan yang paling sering terjadi.

### Kerangka memilih teknik

| Bentuk masalah | Teknik yang tepat | Hasil khas |
|---|---|---|
| Input dengan rentang nilai | Boundary value analysis (+ equivalence partitioning) | 4–6 kasus per field |
| Logika dengan banyak kondisi | Decision table | Satu kasus per aturan unik |
| Perilaku yang berubah karena status | State transition testing | Satu kasus per transisi legal + ilegal |
| Banyak parameter independen | Pairwise / orthogonal array | Puluhan, bukan ratusan kasus |
| Aturan yang baru dipelajari | Error guessing (berbasis pengalaman) | Kasus tajam, sedikit tapi tepat sasaran |
| Sistem yang belum terdokumentasi baik | Exploratory testing (session-based) | Temuan tak terduga + catatan sesi |
| Data kompleks tidak terstruktur | Classification tree / domain analysis | Struktur cakupan yang terlihat |

### Aturan pemilihan praktis

Pilih teknik berdasarkan **bentuk risiko**, bukan berdasarkan kebiasaan tim. Jika bug yang paling mahal
berasal dari kombinasi dua parameter, teknik pairwise menyelesaikannya. Jika bug berasal dari nilai
tepat di batas, boundary value analysis yang menyelesaikannya.

### Latihan

Ambil satu form di aplikasi Anda. Hitung jumlah kombinasi penuhnya. Angka itu adalah baseline; seluruh
kursus ini adalah cara menurunkannya secara bertanggung jawab.`,
        },
        {
          code: 'L-TECH-11',
          title: 'Latihan: Menghitung Baseline Ledakan Kombinasi',
          kind: 'lab',
          duration_minutes: 25,
          order_index: 3,
          content_md: `## Tujuan lab

Merasakan sendiri seberapa cepat kombinasi tumbuh, lalu membuktikan bahwa teknik desain mampu
memangkasnya secara bertanggung jawab.

## Fitur yang dipakai

Form pendaftaran akun dengan parameter berikut:

| Parameter | Nilai | Jumlah |
|---|---|---|
| Jenis akun | Personal, Bisnis | 2 |
| Negara | Indonesia, Malaysia, Singapura | 3 |
| Mata uang | IDR, MYR, SGD | 3 |
| Metode verifikasi | Email, SMS, Keduanya | 3 |
| Notifikasi pemasaran | Ya, Tidak | 2 |
| Metode pembayaran | Kartu, Transfer, E-wallet, Tanpa | 4 |

## Langkah 1 — Hitung baseline

\`\`\`text
Kombinasi penuh = 2 × 3 × 3 × 3 × 2 × 4 = ... (hitung sendiri)

Asumsi 6 menit per kasus:
  total menit  = kombinasi × 6
  total jam    = total menit / 60
  hari kerja   = total jam / 6
\`\`\`

Tuliskan angkanya. Angka inilah yang membuat diskusi tentang teknik desain menjadi konkret.

## Langkah 2 — Terapkan SETIAP teknik dan catat jumlah kasus

| Teknik | Cara menerapkan | Jumlah kasus |
|---|---|---|
| Equivalence partitioning | Kelas valid & tidak valid per field | ? |
| Boundary value analysis | Batas pada field yang punya rentang | ? |
| Decision table | Aturan verifikasi × jenis akun × metode bayar | ? |
| State transition | Status akun: belum terverifikasi → terverifikasi → aktif → ditangguhkan | ? |
| Pairwise | Enam parameter di atas, kekuatan 2 | ? |
| Error guessing | Daftar periksa pengalaman | ? |
| **Total** | | ? |

## Langkah 3 — Hitung penghematannya

| Metrik | Nilai |
|---|---|
| Kombinasi penuh | ? |
| Total kasus setelah teknik | ? |
| Persentase | ? |
| Waktu yang dihemat | ? |

Target yang sehat: total kasus akhir berada di bawah **10%** kombinasi penuh, tanpa kehilangan cakupan
pada kesalahan yang umum terjadi.

## Langkah 4 — Verifikasi tidak ada kelas risiko yang hilang

Periksa bahwa setiap kategori risiko berikut masih punya minimal satu kasus:

\`\`\`text
[ ] Input tidak valid (kelas negatif)
[ ] Nilai tepat di batas
[ ] Kombinasi parameter yang tidak kompatibel
     (mis. e-wallet + mata uang MYR bila tidak didukung)
[ ] Transisi status ilegal
[ ] Nilai kosong pada seluruh field opsional
[ ] Data duplikat (email sudah terdaftar)
[ ] Beban data besar (nama 5.000 karakter)
\`\`\`

Bila ada yang hilang, tekniknya dipakai terlalu agresif memangkas.

## Langkah 5 — Susun tabel keputusan akhir

Buat tabel yang memetakan setiap kasus akhir ke teknik yang menghasilkannya dan risiko yang ia tutup.
Inilah artefak yang membuat cakupan Anda dapat diaudit.

## Kriteria selesai

- Baseline kombinasi penuh dihitung dan dituliskan.
- Setiap teknik dari kursus ini dipakai minimal sekali, dengan jumlah kasus tercatat.
- Total kasus akhir di bawah 10% baseline.
- Tujuh kategori risiko pada langkah 4 semuanya tercakup.
- Setiap kasus dapat ditelusuri ke teknik penghasilnya.

## Refleksi

Bandingkan waktu yang dibutuhkan untuk menjalankan seluruh kombinasi dengan waktu yang dibutuhkan untuk
menjalankan hasil akhir. Selisih itulah nilai ekonomi dari teknik desain test — dan alasan mengapa
teknik ini diajarkan sebelum otomasi: mengotomasi suite yang salah hanya membuat Anda salah lebih cepat.`,
          lab_ref: '/testcases',
        },
        {
          code: 'L-TECH-02',
          title: 'Hubungan Teknik dengan Risiko',
          kind: 'reading',
          duration_minutes: 16,
          order_index: 2,
          content_md: `## Pengujian berbasis risiko

Tidak semua bagian aplikasi bernilai sama. Menguji semuanya dengan kedalaman yang sama adalah cara
tercepat menghabiskan anggaran tanpa menurunkan risiko secara berarti.

### Skor risiko sederhana dan bisa dipertahankan

QATools memakai formula yang transparan agar setiap skor bisa dijelaskan:

\`\`\`text
skor = business criticality (8–34)
     + frekuensi pemakaian  (3–20)
     + kompleksitas         (5–16)
     + riwayat defect       (maks 15)
     + (gagal di run terakhir ? 12 : 0)
     + (kasus regresi ? 6 : 0)
     + (belum diotomasi ? 5 : 0)

level: skor ≥ 65 tinggi · ≥ 35 sedang · sisanya rendah
\`\`\`

| Faktor | Pertanyaan yang dijawab |
|---|---|
| Business criticality | Seberapa mahal kegagalan fitur ini bagi bisnis? |
| Frekuensi pemakaian | Seberapa sering user menyentuh fitur ini? |
| Kompleksitas | Seberapa rumit logika dan integrasinya? |
| Riwayat defect | Apakah area ini pernah rawan? |
| Hasil run terakhir | Apakah baru saja gagal? |
| Status regresi | Apakah termasuk suite regresi? |
| Status otomasi | Apakah masih manual (mahal diulang)? |

### Mengapa rumus lebih baik daripada feeling

Skor yang bisa dihitung ulang memungkinkan tiga hal yang tidak mungkin dilakukan dengan intuisi:
1. **Konsistensi** — dua orang berbeda menghasilkan urutan prioritas yang sama.
2. **Audit** — setiap keputusan bisa dipertanggungjawabkan ke faktor penyusunnya.
3. **Perbaikan** — bila skor ternyata salah prediksi, faktor mana yang perlu disesuaikan bisa dilihat.

### Memetakan risiko ke teknik dan kedalaman

| Level risiko | Kedalaman pengujian | Teknik minimum |
|---|---|---|
| Tinggi | Positif, negatif, batas, kombinasi, eksploratif | Boundary + decision table + pairwise |
| Sedang | Positif, negatif, batas utama | Equivalence partitioning + boundary |
| Rendah | Positif dan satu negatif utama | Equivalence partitioning |

Prinsipnya sederhana: **energi pengujian mengikuti risiko**, bukan mengikuti urutan menu di aplikasi.
### Kesalahan umum

- Menguji berdasarkan urutan pembangunan, bukan urutan risiko.
- Menyamakan seluruh modul karena "adil".
- Menyusun skor sekali dan tidak pernah memperbaruinya setelah rilis besar.
- Menganggap semua bug sama pentingnya saat menghitung riwayat defect.

### Latihan

Ambil lima fitur utama aplikasi Anda, beri skor memakai formula di atas, lalu urutkan. Bandingkan
urutan itu dengan urutan yang biasa tim Anda pakai. Perbedaannya biasanya menjadi bahan diskusi yang
sangat produktif.`,
          lab_ref: '/testcases',
        },
      ],
    },
    {
      code: 'QA-TECH-M2',
      title: 'Equivalence Partitioning & Boundary Value Analysis',
      summary: 'Teknik paling sering dipakai: membagi domain input dan menguji nilai tepat di batas.',
      order_index: 2,
      lessons: [
        {
          code: 'L-TECH-03',
          title: 'Equivalence Partitioning: Satu Wakil per Kelas',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 1,
          content_md: `## Asumsi dasar

Equivalence partitioning (EP) bertumpu pada satu asumsi: **input dalam satu kelas ekuivalen akan
diperlakukan sama oleh sistem**. Jika sistem menangani satu nilai dengan benar, ia menangani seluruh
kelas dengan benar — dan jika salah, biasanya salah untuk seluruh kelas.

Karena itu kita tidak perlu menguji semua nilai; cukup satu wakil dari setiap kelas.

### Contoh: field "usia" pada form asuransi

Aturan bisnis: pemohon berusia 17–65 tahun boleh mendaftar.

| Kelas | Rentang | Tipe | Wakil |
|---|---|---|---|
| Tidak valid rendah | < 17 | Negatif | 10 |
| Valid | 17–65 | Positif | 30 |
| Tidak valid tinggi | > 65 | Negatif | 80 |

Tiga test case, bukan tak terhingga. Perhatikan bahwa **setiap kelas negatif juga harus punya wakil**;
inilah yang paling sering dilupakan.

### Kelas ekuivalen untuk input non-numerik

EP tidak terbatas pada angka.

| Tipe input | Kelas valid | Kelas tidak valid |
|---|---|---|
| Email | Format \`nama@domain.tld\` | Tanpa @, domain kosong, spasi di tengah |
| Tanggal | Format & rentang benar | Format salah, tanggal tidak ada (31 Feb) |
| File unggahan | .pdf < 5 MB | Ekstensi terlarang, melebihi batas, file kosong |
| Enum/select | Salah satu opsi tersedia | Nilai kosong, nilai di luar daftar |
| Boolean | true/false | null, string acak |

### Kelas berdasarkan aturan, bukan hanya berdasarkan tipe

Kelas ekuivalen juga muncul dari aturan bisnis, dan ini yang paling sering luput:

- Diskon berlaku untuk pembelian ≥ Rp500.000 → dua kelas: di bawah dan di atas/di samping ambang.
- Kode promo hanya sekali per akun → dua kelas: akun belum memakai, akun sudah memakai.
- Laporan hanya bisa diunduh role Manajer → dua kelas: Manajer, non-Manajer.

### Tabel desain yang bisa langsung dipakai

| Aturan | Kelas valid | Kelas tidak valid | Jumlah kasus |
|---|---|---|---|
| Usia 17–65 | 17–65 | < 17, > 65 | 3 |
| Diskon ≥ Rp500.000 | ≥ 500.000 | < 500.000 | 2 |
| Kode unik per akun | Belum dipakai | Sudah dipakai | 2 |
| Role Manajer | Manajer | Staf, Auditor | 3 |

Total sepuluh kasus untuk empat aturan. Bandingkan dengan menguji setiap nilai yang mungkin.

### Kesalahan umum dalam EP

1. **Terlalu banyak kelas.** Jika dua kelas diperlakukan identik, mereka satu kelas.
2. **Hanya menguji kelas valid.** Kesalahan paling sering ada di jalur negatif.
3. **Mengabaikan interaksi antar-field.** EP bekerja per-field; kombinasinya perlu teknik lain.
4. **Memilih wakil di nilai ekstrem.** Wakil harus **di tengah** kelas, karena nilai ekstrem adalah
   wilayah boundary value analysis.

### Latihan

Ambil satu field di aplikasi Anda. Tuliskan seluruh kelas ekuivalen valid dan tidak validnya, lalu
buat satu test case untuk tiap kelas.`,
        },
        {
          code: 'L-TECH-04',
          title: 'Boundary Value Analysis: di Mana Bug Bersembunyi',
          kind: 'reading',
          duration_minutes: 26,
          order_index: 2,
          content_md: `## Mengapa batas adalah tempat terbaik mencari bug

Sebagian besar bug batas lahir dari perbedaan operator yang tampak sepele:

\`\`\`text
<   vs  <=
>   vs  >=
batas inklusif vs eksklusif
pembulatan ke atas vs ke bawah
\`\`\`

Untuk aturan "usia 17–65 tahun", developer bisa menulis \`if (usia > 17 && usia < 65)\` atau
\`if (usia >= 17 && usia <= 65)\`. Kode yang dihasilkan berbeda perilaku tepat di angka 17 dan 65 —
dan hanya pengujian di titik itulah yang bisa membedakannya.

## Tiga titik (3-value BVA)

Untuk setiap batas, uji tiga titik:

| Titik | Usia | Nilai | Ekspektasi |
|---|---|---|---|
| Tepat di bawah minimum | 16 | tidak valid | Ditolak |
| Tepat di minimum | 17 | valid | Diterima |
| Tepat di atas minimum | 18 | valid | Diterima |
| Tepat di bawah maksimum | 64 | valid | Diterima |
| Tepat di maksimum | 65 | valid | Diterima |
| Tepat di atas maksimum | 66 | tidak valid | Ditolak |

Enam kasus untuk satu aturann sederhana. Dengan 2-value BVA (hanya nilai batas dan tetangga terdekat
pada satu sisi) Anda mendapat empat kasus; pilih 3-value bila biaya kegagalan tinggi.

### Batas tidak selalu berupa angka

| Jenis | Contoh batas | Kasus uji |
|---|---|---|
| Panjang teks | Nama 1–50 karakter | 0, 1, 50, 51 |
| Jumlah item | Keranjang maksimal 20 item | 19, 20, 21 |
| Ukuran file | Unggahan maksimal 5 MB | 4,9 MB; 5,0 MB; 5,1 MB |
| Waktu | Tautan reset berlaku 30 menit | 29:59, 30:00, 30:01 |
| Halaman | Paginasi 25 baris | 24, 25, 26 baris data |
| Kapasitas | Diskon maksimal Rp1.000.000 | tepat 1.000.000, lebih 1 |
| Nilai kosongan | Field opsional | kosong, spasi saja, null |

### Batas tersembunyi yang sering terlewat

1. **Batas tipe data** — integer 32-bit meluap di 2.147.483.647.
2. **Batas presisi** — uang dengan dua desimal; 0,005 dibulatkan ke mana?
3. **Batas zona waktu** — tengah malam lokal vs UTC.
4. **Batas tahun kabisat** — 29 Februari pada tahun non-kabisar.
5. **Batas urutan** — item pertama dan item terakhir pada daftar panjang.
6. **Batas kosong** — nol item, daftar kosong, string kosong.

### Menggabungkan EP dan BVA

Ini kombinasi standar industri dan hampir selalu dipakai bersamaan:

1. Bagi domain menjadi kelas ekuivalen (EP).
2. Untuk setiap batas antar-kelas, uji titik batas dan tetangganya (BVA).
3. Wakil kelas diambil dari tengah, bukan dari tepi.

Hasilnya adalah suite kecil dengan daya temuan tinggi, dan itulah tujuan seluruh kursus ini.

### Latihan

Ambil satu field dengan rentang angka di aplikasi Anda, tentukan enam titik 3-value BVA, lalu jalankan
seluruhnya. Berapa banyak bug yang muncul tepat di titik batas?`,
          lab_ref: '/testcases',
        },
        {
          code: 'L-TECH-12',
          title: 'Latihan: Menemukan Batas Tersembunyi',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 3,
          content_md: `## Batas yang tidak tertulis di requirement

Batas paling berbahaya adalah batas yang tidak pernah ditulis siapa pun. Ia ada di dalam kode, di dalam
tipe data, atau di dalam perilaku pustaka pihak ketiga — dan tidak satu pun muncul di dokumen.

### Katalog batas tersembunyi

| Kategori | Batas | Kasus uji |
|---|---|---|
| Tipe integer | 2.147.483.647 (int32) | Nilai tepat di batas dan satu di atasnya |
| Tipe integer | -2.147.483.648 | Nilai minimum, dan pengurangan dari minimum |
| Presisi uang | 2 desimal | 0,005 · 0,015 (arah pembulatan) |
| Presisi persen | 2 desimal | Diskon 33,333% → nilai akhir |
| Panjang kolom | \`VARCHAR(255)\` | tepat 255 dan 256 karakter |
| Panjang kode | 6 karakter | 5, 6, 7 karakter |
| Zona waktu | Batas hari | 23:59:59 dan 00:00:00 |
| Kalender | 29 Februari | Tahun kabisat dan bukan kabisat |
| Kalender | Akhir bulan | 30 vs 31 hari |
| Hari besar | Perubahan DST | Jam yang hilang atau berulang |
| Paginasi | Ukuran halaman | Halaman terakhir dengan sisa 1 baris |
| Array kosong | Elemen ke-0 | Kirim array kosong |
| Unicode | Panjang karakter | Emoji dan aksara gabungan |
| Berkas | Ukuran | 4,99 MB · 5,00 MB · 5,01 MB |
| Waktu tunggu | Timeout | Respons tepat di ambang timeout |

### Langkah kerja

1. **Pilih lima field** di aplikasi Anda yang menyimpan angka, teks, tanggal, atau berkas.
2. **Cari tipe datanya** di skema database dan di kode. Catat batas teknis setiap kolom.
3. **Cari aturan aplikasinya.** Apakah ada validasi yang lebih ketat dari tipe datanya?
4. **Cari batas pihak ketiga.** Pustaka pembayaran, layanan email, dan API eksternal punya batasnya
   sendiri yang sering lebih ketat.
5. **Susun tabel batas** untuk setiap field.
6. **Jalankan kasus tepat di batas** dan satu nilai di kedua sisinya.

### Tabel kerja

| Field | Batas teknis | Batas aplikasi | Batas pihak ketiga | Kasus uji | Bug ditemukan |
|---|---|---|---|---|---|
| Nama produk | 255 char | 100 char | — | 99, 100, 101 | ? |
| Harga | REAL | ≥ 0 | maks transaksi | -1, 0, 0,01 | ? |
| Kode promo | 20 char | 6–12 char | — | 5, 6, 12, 13 | ? |
| Tanggal kirim | TEXT ISO | hari ini..+90 | — | kemarin, hari ini, +90, +91 | ? |
| Berkas bukti | — | 5 MB | 10 MB | 4,99 / 5,00 / 5,01 MB | ? |

### Yang paling sering ditemukan

| Temuan | Mengapa terjadi |
|---|---|
| Validasi aplikasi lebih longgar dari kolom | Nilai terpotong tanpa peringatan |
| Batas berbeda antara UI dan API | UI menolak 101 karakter, API menerima |
| Presisi hilang saat pembulatan | Total berbeda 1 rupiah dari perhitungan manual |
| Batas pihak ketiga tidak diketahui | Transaksi gagal di produksi, bukan di staging |
| Zona waktu tidak eksplisit | Tanggal bergeser satu hari untuk pengguna tertentu |
| Panjang dihitung per byte, bukan per karakter | Emoji memotong teks |

### Kriteria selesai

- Tabel batas terisi untuk minimal lima field.
- Setiap field diuji pada nilai batas dan kedua tetangganya.
- Minimal tiga batas tersembunyi teridentifikasi (batas yang tidak disebut di requirement).
- Setiap temuan dilaporkan dengan nilai persis yang memicu masalah.

### Refleksi

Perhatikan bahwa sebagian besar temuan pada latihan ini tidak akan pernah muncul dari pengujian dengan
"data yang wajar". Inilah alasan boundary value analysis menjadi salah satu teknik dengan rasio
temuan-per-kasus tertinggi dalam seluruh disiplin pengujian.`,
          lab_ref: '/testcases',
        },
      ],
    },
    {
      code: 'QA-TECH-M3',
      title: 'Decision Table & State Transition',
      summary: 'Menangani logika dengan banyak kondisi, dan perilaku yang berubah mengikuti status.',
      order_index: 3,
      lessons: [
        {
          code: 'L-TECH-05',
          title: 'Decision Table Testing',
          kind: 'reading',
          duration_minutes: 26,
          order_index: 1,
          content_md: `## Ketika keputusan bergantung pada banyak kondisi

Begitu sebuah aturan melibatkan dua kondisi atau lebih, daftar test case berbasis teks mulai meninggalkan
lubang. Decision table memaksa Anda menuliskan **seluruh kombinasi kondisi dan aksi** dalam bentuk
tabel, sehingga lubangnya terlihat.

### Contoh: aturan diskon lanjutan

Aturan bisnis:

1. Diskon 10% bila keranjang > Rp500.000.
2. Diskon tambahan 5% bila member tier Gold.
3. Diskon tambahan 5% bila sudah berlangganan > 1 tahun.
4. Diskon maksimal 20%.
5. Bila total setelah diskon < Rp50.000, diskon dibatalkan.

Kondisi dan aksi:

\`\`\`text
C1: keranjang > 500.000        A1: diskon 10%
C2: tier Gold                  A2: diskon +5%
C3: langganan > 1 tahun        A3: diskon +5%
C4: hasil diskon > 20%         A4: potong ke 20%
C5: total akhir < 50.000       A5: batalkan diskon
\`\`\`

### Tabel keputusan lengkap

| | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 |
|---|---|---|---|---|---|---|---|---|
| C1 keranjang > 500rb | Y | Y | Y | Y | N | N | N | N |
| C2 tier Gold | Y | Y | N | N | Y | Y | N | N |
| C3 langganan > 1 th | Y | N | Y | N | Y | N | Y | N |
| **A1** diskon 10% | X | X | X | X | – | – | – | – |
| **A2** diskon +5% | X | X | – | – | – | – | – | – |
| **A3** diskon +5% | X | – | X | – | – | – | – | – |
| **A4** potong ke 20% | X | – | – | – | – | – | – | – |
| **A5** batalkan (total < 50rb) | – | – | X* | – | – | – | – | – |

\`*\` berlaku bila nilai keranjang membuat total akhir di bawah ambang meski diskon diterapkan.

### Delapan aturan, bukan puluhan kombinasi acak

Perhatikan tiga hal penting:

1. **Setiap kolom adalah satu test case.** Delapan kasus menutup seluruh ruang keputusan.
2. **Kolom R1 langsung memunculkan aturan batas maksimal.** Tanpa tabel, aturan "maksimal 20%" mudah
   terlupakan karena hanya muncul pada kombinasi paling lengkap.
3. **Kolom R5–R8 menunjukkan aturan saling eksklusif.** Bila C1 salah, C2 dan C3 tidak relevan —
   ini disebut *don't care* dan bisa diringkas menjadi satu kolom.

### Meringkas tabel dengan don't care

| | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|
| C1 | Y | Y | Y | Y | N |
| C2 | Y | Y | N | N | – |
| C3 | Y | N | Y | N | – |
| Hasil | 20% | 15% | 15% | 10% | 0% |

Lima kasus untuk seluruh ruang aturan. Inilah cara decision table memangkas pekerjaan tanpa kehilangan
cakupan.

### Kapan decision table paling berguna

- Perhitungan tarif, pajak, diskon, denda.
- Aturan otorisasi dan hak akses.
- Alur persetujuan berjenjang.
- Validasi dengan syarat saling bergantung.
- Logika kelayakan (eligibility) kredit, asuransi, beasiswa.

### Latihan

Ambil satu aturan bisnis dengan tiga kondisi di produk Anda. Susun tabel keputusan lengkapnya, tandai
kolom yang bisa diringkas dengan don't care, dan hitung berapa test case yang sebenarnya diperlukan.`,
          lab_ref: '/testcases',
        },
        {
          code: 'L-TECH-06',
          title: 'State Transition Testing',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 2,
          content_md: `## Ketika perilaku bergantung pada status saat ini

Sebagian sistem tidak bisa dipahami sebagai fungsi input → output. Perilakunya bergantung pada
**kondisi saat ini**. Contoh paling jelas: pesanan, langganan, tiket dukungan, dan akun pengguna.

### Diagram transisi pesanan

\`\`\`text
        [Draft]
           │ submit
           ▼
        [Pending] ──bayar──▶ [Paid] ──kirim──▶ [Shipped] ──terima──▶ [Completed]
           │                    │                  │
        batal                 refund            gagal kirim
           ▼                    ▼                  ▼
       [Cancelled]         [Refunded]         [Returned]
\`\`\`

### Tabel transisi (state × event)

| State \\ Event | submit | bayar | kirim | terima | batal | refund |
|---|---|---|---|---|---|---|
| Draft | Pending | – | – | – | Cancelled | – |
| Pending | – | Paid | – | – | Cancelled | – |
| Paid | – | – | Shipped | – | – | Refunded |
| Shipped | – | – | – | Completed | – | – |
| Completed | – | – | – | – | – | Refunded |
| Cancelled | – | – | – | – | – | – |
| Refunded | – | – | – | – | – | – |

Tanda \`–\` berarti transisi **tidak boleh terjadi**. Ini sama pentingnya dengan transisi yang sah,
karena di sinilah bug izin dan validasi status bersembunyi.

### Tiga jenis cakupan pengujian transisi

| Cakupan | Yang dijamin | Jumlah kasus (contoh di atas) |
|---|---|---|
| All states | Setiap status pernah dikunjungi | 7 |
| All transitions (0-switch) | Setiap transisi sah & ilegal diuji | 12 sah + 30 ilegal |
| All paths (1-switch) | Setiap pasangan transisi berurutan diuji | jauh lebih banyak |

Untuk sebagian besar tim, **all transitions** adalah titik seimbang. Uji semua transisi sah, dan fokuskan
transisi ilegal pada pasangan status yang berisiko secara bisnis (misalnya refund setelah Completed).

### Contoh nyata: bug yang hanya muncul di jalur ilegal

Sebuah sistem tiket dukungan mengizinkan transisi \`Closed → Reopened\`. Ketika QA menguji transisi
ilegal \`Closed → In Progress\` secara langsung, sistem menerimanya tanpa melewati tahap triage,
sehingga tiket kehilangan pemilik dan tidak muncul di dashboard. Bug ini tidak akan pernah ditemukan
dengan pengujian happy path.

### Status "terjebak" dan transisi mati

Saat menggambar diagram, periksa dua hal yang sering terlupakan:

1. **Status tanpa jalan keluar** — user masuk ke status yang tidak bisa ditinggalkan. Contoh klasik:
   pesanan Pending yang tidak bisa dibatalkan setelah kedaluwarsa, tetapi juga tidak otomatis
   dibatalkan sistem.
2. **Transisi tanpa status asal** — aksi yang tersedia di UI tetapi tidak sah dari status mana pun.

### Langkah praktis

1. Kumpulkan seluruh status legal dari requirement dan kode.
2. Gambar diagram transisi.
3. Ubah menjadi tabel state × event.
4. Tandai sel kosong (transisi ilegal) — ini daftar test case negatif Anda.
5. Uji setiap transisi sah minimal sekali, plus transisi ilegal bernilai risiko tinggi.

### Latihan

Ambil satu entitas berstatus di aplikasi Anda (pesanan, tiket, langganan, dokumen). Gambar tabel
transisinya, lalu cari minimal dua transisi ilegal yang saat ini masih bisa dilakukan.`,
          lab_ref: '/scenarios',
        },
        {
          code: 'L-TECH-13',
          title: 'Latihan: Tabel Keputusan untuk Aturan Berjenjang',
          kind: 'lab',
          duration_minutes: 25,
          order_index: 3,
          content_md: `## Tujuan lab

Menyusun tabel keputusan lengkap untuk aturan bisnis berjenjang, lalu memangkasnya dengan *don't care*
tanpa kehilangan cakupan.

## Aturan bisnis: kelayakan pengembalian dana (refund)

\`\`\`text
R1  Refund hanya untuk pesanan berstatus "paid" atau "shipped"
R2  Batas waktu 7 hari sejak pembayaran
R3  Refund sebagian diizinkan bila minimal 1 item belum dipakai
R4  Refund penuh hanya bila seluruh item belum dipakai
R5  Pesanan dengan kode promo: nilai refund dihitung setelah diskon
R6  Refund tidak boleh melebihi nilai pembayaran
R7  Refund ke dompet instan; refund ke kartu 3–5 hari kerja
R8  Pesanan yang sudah pernah di-refund penuh tidak bisa di-refund lagi
\`\`\`

## Langkah 1 — Daftar kondisi dan aksi

\`\`\`text
C1  Status pesanan paid atau shipped
C2  Dalam 7 hari sejak pembayaran
C3  Ada item yang belum dipakai
C4  Seluruh item belum dipakai
C5  Pesanan memakai kode promo
C6  Permintaan refund <= nilai pembayaran
C7  Belum pernah di-refund penuh

A1  Refund disetujui (penuh)
A2  Refund disetujui (sebagian)
A3  Refund ditolak dengan alasan waktu
A4  Refund ditolak dengan alasan status
A5  Refund ditolak karena sudah pernah di-refund
A6  Nilai refund dibatasi ke nilai pembayaran
A7  Metode pengembalian: dompet instan
A8  Metode pengembalian: kartu 3–5 hari kerja
\`\`\`

## Langkah 2 — Tabel keputusan lengkap

Isi seluruh kolom. Bila ada tujuh kondisi biner, ruang penuhnya adalah 128 kolom — tetapi banyak di
antaranya tidak mungkin. Mulailah dari aturan yang paling restriktif.

| | K1 | K2 | K3 | K4 | K5 | K6 | K7 |
|---|---|---|---|---|---|---|---|
| C1 status valid | Y | Y | Y | Y | Y | N | Y |
| C2 dalam 7 hari | Y | Y | Y | Y | N | Y | Y |
| C3 ada item belum dipakai | Y | Y | Y | N | Y | Y | Y |
| C4 seluruh item belum dipakai | Y | N | N | N | – | – | Y |
| C5 memakai promo | Y | N | N | N | – | – | Y |
| C6 refund <= pembayaran | Y | Y | N | Y | – | – | Y |
| C7 belum pernah refund penuh | Y | Y | Y | Y | – | – | N |
| **Aksi** | A1,A7 | A2,A8 | A6,A2 | *tolak* | A3 | A4 | A5 |

\`\`\`text
Bacaan tiap kolom:
  K1  refund penuh, promo, dompet instan
  K2  refund sebagian, tanpa promo, ke kartu
  K3  nominal melebihi pembayaran → dibatasi ke nilai pembayaran, lalu diproses sebagian
  K4  tidak ada item yang belum dipakai → tidak ada yang bisa di-refund
  K5  lewat 7 hari → ditolak karena waktu
  K6  status belum paid/shipped → ditolak karena status
  K7  sudah pernah refund penuh → ditolak karena duplikasi
\`\`\`

## Langkah 3 — Ringkas dengan don't care

Perhatikan kolom K5, K6, K7: begitu satu kondisi gagal, kondisi lainnya menjadi **tidak relevan**.
Itulah don't care. Ringkasan:

| Kelompok | Kondisi kunci | Jumlah kolom setelah ringkas |
|---|---|---|
| Ditolak karena waktu | C2 = N | 1 |
| Ditolak karena status | C1 = N, C2 = Y | 1 |
| Ditolak karena duplikasi | C1,C2 = Y; C7 = N | 1 |
| Tidak ada item | C1,C2,C7 = Y; C3 = N | 1 |
| Dibatasi ke nilai pembayaran | C6 = N (lainnya Y) | 1 |
| Disetujui | sisanya | 2 |

Dari ruang 128 kemungkinan menjadi **7 kasus** yang menutup seluruh aturan.

## Langkah 4 — Tambahkan kasus batas

Tabel keputusan menangani logika; batas tetap perlu diuji terpisah:

\`\`\`text
- Tepat 7 hari dan 7 hari + 1 detik
- Refund persis sama dengan nilai pembayaran
- Refund 1 rupiah lebih besar dari nilai pembayaran
- Refund sebagian membuat sisa nilai = 0
- Pesanan dengan promo 100% (nilai pembayaran 0) — boleh refund?
\`\`\`

Kasus terakhir biasanya menemukan celah yang tidak terpikirkan: refund pada pesanan bernilai nol.

## Langkah 5 — Periksa kelengkapan

Centang setiap aturan R1–R8 memiliki minimal satu kolom yang mengujinya. Bila ada aturan tanpa kolom,
tabel keputusan Anda belum lengkap — dan justru aturan itulah yang paling mungkin belum
diimplementasikan dengan benar.

## Kriteria selesai

- Tabel keputusan lengkap terisi dengan aksi untuk setiap kolom.
- Don't care dipakai untuk meringkas, dengan penjelasan alasannya.
- Delapan aturan semuanya punya minimal satu kolom penguji.
- Minimal empat kasus batas ditambahkan di luar tabel.

## Refleksi

Perhatikan aturan R5 (refund dihitung setelah diskon) dan R6 (tidak melebihi pembayaran). Keduanya hanya
muncul ketika tabel ditulis lengkap — dan keduanya adalah sumber sengketa uang yang nyata dengan
pelanggan. Inilah nilai praktis dari decision table: ia memaksa Anda menuliskan hal yang biasanya
dibiarkan implisit.`,
          lab_ref: '/testcases',
        },
      ],
    },
    {
      code: 'QA-TECH-M4',
      title: 'Pairwise, Error Guessing & Exploratory',
      summary: 'Memangkas kombinasi parameter, memakai pengalaman, dan menguji tanpa skrip.',
      order_index: 4,
      lessons: [
        {
          code: 'L-TECH-07',
          title: 'Pairwise & Orthogonal Array',
          kind: 'reading',
          duration_minutes: 26,
          order_index: 1,
          content_md: `## Klaim yang membuat pairwise bekerja

Pairwise testing bertumpu pada temuan empiris yang kuat: **sebagian besar cacat yang berkaitan dengan
kombinasi parameter disebabkan oleh interaksi dua parameter**, bukan tiga atau lebih.

Konsekuensinya: bila Anda menguji setiap pasangan nilai yang mungkin minimal satu kali, Anda menangkap
hampir semua cacat kombinasi dengan jumlah kasus yang jauh lebih kecil.

### Contoh: 3 parameter

| Parameter | Nilai |
|---|---|
| Browser | Chrome, Firefox, Safari |
| OS | Windows, macOS |
| Peran | Admin, User |

Kombinasi penuh: 3 × 2 × 2 = 12.

Rancangan pairwise (9 kasus sudah cukup, dan tabel berikut memakai 9 baris agar mudah dibaca):

| # | Browser | OS | Peran |
|---|---|---|---|
| 1 | Chrome | Windows | Admin |
| 2 | Chrome | macOS | User |
| 3 | Firefox | Windows | User |
| 4 | Firefox | macOS | Admin |
| 5 | Safari | Windows | Admin |
| 6 | Safari | macOS | User |

Enam kasus menutup **seluruh pasangan**:
Chrome–Windows, Chrome–macOS, Firefox–Windows, Firefox–macOS, Safari–Windows, Safari–macOS,
Chrome–Admin, Chrome–User, Firefox–Admin, Firefox–User, Safari–Admin, Safari–User,
Windows–Admin, Windows–User, macOS–Admin, macOS–User — semuanya hadir minimal sekali.

### Skala penghematannya

| Parameter | Nilai per parameter | Kombinasi penuh | Pairwise (perkiraan) |
|---|---|---|---|
| 4 | 3 | 81 | 9 |
| 5 | 4 | 1.024 | 16 |
| 6 | 3 | 729 | 15–18 |
| 8 | 4 | 65.536 | 24–30 |
| 10 | 5 | 9.765.625 | 35–45 |

Pertumbuhan pairwise bersifat logaritmik, sedangkan kombinasi penuh eksponensial. Perbedaan inilah yang
membuat pengujian kombinasi menjadi mungkin dilakukan.

### Kapan pairwise TIDAK cukup

1. **Parameter tidak independen.** Bila nilai satu parameter membatasi nilai parameter lain (misalnya
   "metode pembayaran e-wallet hanya untuk negara Indonesia"), pasangan yang mustahil tidak boleh
   dihitung sebagai cakupan.
2. **Ada interaksi tiga arah yang diketahui berisiko.** Contoh: kombinasi mata uang + metode bayar +
   negara pada perhitungan pajak.
3. **Ada parameter dengan aturan keamanan.** Selalu uji seluruh kombinasi untuk parameter terkait akses.

Untuk kasus seperti ini, naikkan kekuatan menjadi 3-way (triple-wise) hanya pada parameter yang
berisiko, lalu turunkan kembali ke 2-way untuk sisanya. Teknik ini disebut *mixed-strength covering array*.

### Cara menyusun secara manual

1. Daftar seluruh parameter dan nilainya.
2. Hitung kombinasi penuh sebagai baseline.
3. Susun baris secara bertahap: pada setiap baris, pilih nilai yang menambah cakupan pasangan baru
   terbanyak.
4. Berhenti ketika seluruh pasangan sudah tercakup minimal sekali.
5. Periksa ulang pasangan yang mustahil dan tandai sebagai pengecualian yang didokumentasikan.

### Latihan

Ambil form dengan minimal empat parameter di aplikasi Anda. Hitung kombinasi penuhnya, lalu susun
rancangan pairwise minimal yang menutup semua pasangan.`,
          lab_ref: '/testcases',
        },
        {
          code: 'L-TECH-08',
          title: 'Error Guessing & Exploratory Testing',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 2,
          content_md: `## Dua teknik yang tidak bisa diotomasi dengan mudah

Teknik sebelumnya bersifat sistematis dan dapat dihitung. Dua teknik berikut bertumpu pada pengalaman
manusia, dan justru di sanalah nilainya.

### Error guessing: memakai daftar pengalaman

Error guessing adalah menyusun test case berdasarkan dugaan di mana kesalahan paling mungkin terjadi,
bukan berdasarkan struktur formal. Ia menjadi jauh lebih kuat bila dilakukan **terstruktur** memakai
daftar periksa.

**Daftar periksa error guessing yang bisa dipakai berulang:**

| Kategori | Yang dicoba |
|---|---|
| Input kosong | String kosong, spasi saja, null, field tidak dikirim sama sekali |
| Batas | 0, -1, nilai maksimum, satu di atas maksimum |
| Format | Email tanpa @, tanggal tidak ada, angka dengan koma, unicode & emoji |
| Tipe data | String di field angka, angka di field tanggal, boolean di field teks |
| Urutan | Klik ganda cepat, submit sebelum data selesai dimuat |
| Kondisi jaringan | Koneksi terputus di tengah unggahan, respons sangat lambat |
| Otorisasi | Akses URL langsung tanpa login, ganti ID di URL ke milik user lain |
| Karakter khusus | \`'--\`, \`<script>\`, tanda kutip, backslash, newline |
| Data besar | 10.000 baris, nama 5.000 karakter, unggahan tepat di batas |
| Duplikasi | Klik "Simpan" dua kali, dua tab mengedit data yang sama |

Daftar ini berasal dari akumulasi pengalaman industri, dan justru itu yang membuatnya bernilai.
Setiap QA senior punya versi daftar ini di kepalanya; menuliskannya membuat ia bisa dipakai seluruh tim.

### Exploratory testing: belajar sambil menguji

Exploratory testing adalah pengujian yang **desain, eksekusi, dan pembelajaran terjadi bersamaan**.
Tidak ada test case tertulis sebelumnya; ada *charter*, *timebox*, dan **catatan sesi**.

| Elemen | Isi | Contoh |
|---|---|---|
| Charter | Misi singkat | "Jelajahi validasi kode promo pada checkout" |
| Timebox | Durasi ketat | 60 menit |
| Catatan | Apa yang dicoba & ditemukan | Daftar jalur, bug, pertanyaan |
| Debrief | Ringkasan hasil | Temuan, area berisiko baru, saran cakupan |

**Session-based test management (SBTM)** menambahkan struktur agar hasilnya terukur:

\`\`\`text
Sesi  : S1 — Validasi kode promo
Charter: Jelajahi penerapan kode promo, fokus pada kode kedaluwarsa dan kombinasi ganda
Durasi : 60 menit
Waktu  : 45 menit pengujian (T)
         10 menit investigasi (I)
          5 menit menulis laporan (B)
Coverage: 18% area checkout
Temuan : 3 bug (1 major, 2 minor), 2 pertanyaan requirement
\`\`\`

Perhatikan metrik \`T/I/B\` — ia memisahkan waktu menguji, menyelidiki, dan melaporkan, sehingga sesi
yang habis untuk investigasi terbaca sebagai sinyal, bukan sebagai kegagalan.

### Heuristic yang bisa dipakai saat eksplorasi

- **Batas waktu** — perilaku pada saat tenggat, kedaluwarsa, dan perubahan tanggal.
- **Gangguan** — apa yang terjadi bila koneksi putus, browser di-refresh, tab ditutup?
- **Interupsi** — notifikasi masuk, telepon, tab lain.
- **Banyak** — banyak item, banyak user bersamaan, banyak tab.
- **Kosong** — tidak ada data sama sekali.
- **Ada/tiada** — akun dengan dan tanpa hak, data dengan dan tanpa relasi.
- **Turunan** — apa yang berubah di layar lain ketika data ini berubah?

### Kapan exploratory lebih unggul

- Fitur baru yang dokumentasinya belum lengkap.
- Setelah rilis besar, untuk mencari masalah integrasi.
- Ketika suite regresi lulus semua tetapi bug masih lolos ke produksi.
- Saat membutuhkan pemahaman produk dengan cepat sebelum menulis test case formal.

### Latihan

Tulis satu charter eksplorasi 60 menit untuk fitur yang paling sering berubah di aplikasi Anda. Jalankan
sesi itu, catat waktu T/I/B, dan bandingkan temuan dengan hasil menjalankan suite test biasa.`,
          lab_ref: '/execute',
        },
        {
          code: 'L-TECH-09',
          title: 'Memilih Teknik: Studi Kasus Terpadu',
          kind: 'lab',
          duration_minutes: 30,
          order_index: 3,
          content_md: `## Tujuan lab

Menerapkan seluruh teknik dari modul ini pada satu fitur, lalu membandingkan jumlah kasus sebelum dan
sesudah teknik diterapkan.

## Fitur yang diuji

Form pencarian penerbangan dengan parameter:

- Kota asal dan tujuan (1.300+ maskapai-kota)
- Tanggal keberangkatan (hari ini sampai 365 hari ke depan)
- Jumlah penumpang (1–9)
- Kelas (Ekonomi, Bisnis, First)
- Transit (langsung saja atau dengan transit)
- Bagasi (0–3 koper)

## Langkah

1. **Hitung baseline.** Berapa kombinasi penuh bila setiap field dianggap memiliki setidaknya 3 nilai?

2. **Equivalence partitioning.** Untuk setiap field, tentukan kelas valid dan tidak valid. Khusus
   tanggal: perhatikan tanggal kemarin (tidak valid), hari ini, dan hari ke-366.

3. **Boundary value analysis.** Untuk jumlah penumpang (1–9), tuliskan enam titik 3-value BVA.
   Lakukan hal sama untuk bagasi dan tanggal.

4. **Decision table.** Buat aturan untuk kombinasi kelas penerbangan dan status anggota: anggota
   Platinum mendapat bagasi gratis 2 koper di kelas apa pun, sedangkan non-anggota hanya di Bisnis/First.

5. **State transition.** Gambar transisi status pencarian: \`Kosong → Terisi → HasilDitampilkan →
   Dipilih → Kadaluwarsa → Kosong\`. Tandai transisi ilegal.

6. **Pairwise.** Susun rancangan pairwise untuk enam parameter (kelas, transit, bagasi, jumlah
   penumpang, tipe anggota, rentang tanggal).

7. **Error guessing.** Terapkan daftar periksa: kota asal = kota tujuan, tanggal di masa lalu, jumlah
   penumpang 0 melalui manipulasi URL, kode bandara tidak dikenal.

8. **Bonus exploratory.** 20 menit sesi eksplorasi bebas dengan charter "temukan cara membuat pencarian
   mengembalikan hasil yang membingungkan".

## Bandingkan dan simpulkan

| Teknik | Jumlah kasus |
|---|---|
| Kombinasi penuh | (hitung) |
| EP saja | … |
| EP + BVA | … |
| + Decision table | … |
| + State transition | … |
| + Pairwise | … |
| + Error guessing | … |

## Kriteria selesai

- Setiap kasus dapat ditelusuri ke teknik yang menghasilkannya.
- Jumlah kasus akhir berada di bawah 10% kombinasi penuh.
- Setidaknya tiga kasus negatif yang tidak akan muncul dari pengujian happy path.

## Refleksi

Teknik desain bukan sekadar mengurangi jumlah kasus. Ia mengubah pengujian dari aktivitas berdasarkan
selera menjadi aktivitas yang bisa dipertanggungjawabkan secara matematis.`,
          lab_ref: '/testcases',
        },
        {
          code: 'L-TECH-10',
          title: 'Menggabungkan Teknik: Menyusun Rancangan Suite',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 3,
          content_md: `## Satu fitur, beberapa teknik sekaligus

Dalam praktik, tidak ada QA yang memilih satu teknik lalu mengabaikan sisanya. Yang terjadi adalah
teknik-teknik itu dipakai **berlapis**, masing-masing menutup jenis risiko yang berbeda.

### Alur kerja yang bisa dipakai berulang

\`\`\`text
1. Identifikasi input dan aturan
     → daftar field, rentang, aturan bisnis

2. Bagi domain dengan equivalence partitioning
     → kelas valid & tidak valid per field

3. Untuk setiap batas antar-kelas, terapkan boundary value analysis
     → 3-value pada batas berisiko tinggi, 2-value pada yang rendah

4. Untuk aturan yang melibatkan 2+ kondisi, susun decision table
     → satu kolom per aturan unik, ringkas dengan don't care

5. Untuk entitas berstatus, susun tabel state × event
     → transisi sah + transisi ilegal berisiko

6. Untuk parameter independen yang banyak, susun pairwise
     → kekuatan dinaikkan hanya pada parameter berisiko

7. Tambahkan error guessing dari daftar pengalaman
     → jalur yang tidak muncul dari langkah 2–6

8. Sisihkan satu timebox untuk exploratory
     → temuan yang tidak terpikirkan oleh rancangan
\`\`\`

### Bagaimana teknik saling melengkapi pada satu fitur

Ambil fitur "pendaftaran akun dengan kode undangan":

| Teknik | Yang dihasilkan | Risiko yang ditutup |
|---|---|---|
| EP | Kelas email valid/tidak valid, kode valid/kedaluwarsa | Input tidak sah |
| BVA | Panjang kata sandi 8/9, kode 6/7 karakter | Kesalahan operator batas |
| Decision table | Kombinasi verifikasi email × kode undangan × usia | Aturan yang saling bergantung |
| State transition | Alur akun: pending → aktif → terkunci | Bug izin di jalur tidak resmi |
| Pairwise | Peramban × negara × tipe akun | Kombinasi lingkungan |
| Error guessing | Kode didaftarkan dua kali, email dengan spasi | Kejadian nyata dari pengalaman |
| Exploratory | Alur bolak-balik saat pendaftaran setengah selesai | Integrasi yang tidak terdokumentasi |

### Menghindari tumpang tindih yang boros

Kesalahan sebaliknya juga nyata: memakai semua teknik pada semua hal sehingga menghasilkan ratusan
kasus yang saling mengulang.

| Gejala tumpang tindih | Perbaikan |
|---|---|
| Dua kasus dengan data identik dan langkah identik | Gabungkan |
| Kasus batas ditulis ulang sebagai kasus negatif biasa | Hapus duplikatnya |
| Pairwise ditambah seluruh kombinasi penuh | Pilih salah satu sesuai risiko |
| Decision table menyalin seluruh kasus EP | Pertahankan table hanya untuk aturan gabungan |

Tanda suite yang sehat: setiap kasus bisa menjawab pertanyaan **"teknik apa yang menghasilkannya dan
risiko apa yang ia tutup?"**.

### Melaporkan rantai keputusan

Saat menyusun test plan atau menjelaskan cakupan, tuliskan rantai keputusan secara ringkas. Contoh:

\`\`\`text
Rancangan pengujian — Form pendaftaran
  EP        : 9 kelas (5 valid, 4 tidak valid)               →  9 kasus
  BVA       : 3 batas berisiko (sandi, kode, usia)           →  9 kasus
  DT        : 6 kolom aturan gabungan                        →  6 kasus
  ST        : 5 transisi sah + 3 transisi ilegal berisiko    →  8 kasus
  Pairwise  : 4 parameter, kekuatan 2                        → 12 kasus
  EG        : 7 pemeriksaan dari daftar pengalaman           →  7 kasus
  Eksplorasi: 1 sesi 45 menit                                →  (bebas)
  ─────────────────────────────────────────────────────────────────
  total terkendali 51 kasus, dari 4 × 3 × 5 × 3 = 180 kombinasi penuh
\`\`\`

Rantai seperti ini membuat cakupan dapat diaudit dan menutup pertanyaan "mengapa hanya 51 kasus?".

### Latihan

Ambil satu fitur yang sedang Anda uji, tuliskan rantai keputusannya seperti contoh di atas, lalu
periksa apakah ada kasus yang tidak bisa dipertanggungjawabkan. Kasus tanpa asal-usul biasanya bisa
dihapus atau digabungkan.`,
          lab_ref: '/testcases',
        },
      ],
    },
  ],
  quizzes: [
    {
      title: 'Kuis Teknik Pengujian',
      pass_score: 70,
      order_index: 1,
      questions: [
        {
          prompt:
            'Aturan bisnis: "pembeli berusia 17 sampai 65 tahun boleh mendaftar." Manakah himpunan kasus uji yang paling tepat untuk boundary value analysis 3-value?',
          options: [
            '15, 30, 70',
            '16, 17, 18, 64, 65, 66',
            '17, 65',
            '0, 17, 65, 100',
          ],
          answer_index: 1,
          explanation:
            '3-value BVA menguji tiga titik untuk setiap batas: tepat di bawah, tepat di, dan tepat di atas. Untuk batas bawah 17 dan batas atas 65, himpunannya adalah 16, 17, 18, 64, 65, 66.',
          points: 1,
        },
        {
          prompt:
            'Sebuah form memiliki 5 parameter dengan masing-masing 4 nilai. Berapa kombinasi penuh, dan mengapa pairwise jauh lebih sedikit?',
          options: [
            '20 kombinasi; pairwise lebih sedikit karena mengabaikan parameter',
            '1024 kombinasi; pairwise lebih sedikit karena hanya menuntut setiap pasangan nilai tercakup minimal sekali',
            '1024 kombinasi; pairwise lebih sedikit karena hanya menguji nilai valid',
            '256 kombinasi; pairwise sama banyaknya tetapi lebih cepat dijalankan',
          ],
          answer_index: 1,
          explanation:
            'Kombinasi penuh = 4^5 = 1024. Pairwise menuntut setiap pasangan nilai dari dua parameter mana pun muncul minimal sekali, dan karena sebagian besar cacat kombinasi berasal dari interaksi dua parameter, jumlah kasusnya turun drastis (biasanya belasan).',
          points: 1,
        },
        {
          prompt:
            'Dalam tabel keputusan, apa arti lambang "don\'t care" (biasanya ditulis "–") pada kolom kondisi?',
          options: [
            'Kondisi tersebut belum pernah diuji',
            'Nilai kondisi tidak memengaruhi hasil untuk kolom aturan tersebut',
            'Kondisi tersebut selalu bernilai benar',
            'Kolom tersebut bukan test case yang sah',
          ],
          answer_index: 1,
          explanation:
            'Don\'t care berarti nilai kondisi apa pun menghasilkan aksi yang sama pada kolom aturan itu, sehingga beberapa kolom dapat diringkas menjadi satu tanpa kehilangan cakupan keputusan.',
          points: 1,
        },
        {
          prompt:
            'Pada pengujian transisi status pesanan, mengapa transisi ILEGAL (misalnya Completed → Pending) juga harus diuji?',
          options: [
            'Agar jumlah test case memenuhi target',
            'Karena di sanalah bug validasi status dan izin akses biasanya bersembunyi',
            'Karena transisi ilegal selalu menghasilkan pesan error yang benar',
            'Karena diagram transisi tidak boleh memiliki sel kosong',
          ],
          answer_index: 1,
          explanation:
            'Transisi ilegal menguji penegakan aturan status. Sistem yang menerima transisi terlarang dapat merusak integritas data dan alur bisnis, dan jalur ini biasanya tidak pernah tersentuh happy-path testing.',
          points: 1,
        },
        {
          prompt:
            'Apa perbedaan mendasar antara error guessing dan exploratory testing?',
          options: [
            'Error guessing memakai daftar pengalaman untuk menyusun kasus; exploratory testing mendesain, mengeksekusi, dan belajar secara bersamaan dalam timebox bercharter',
            'Error guessing dilakukan otomatis; exploratory testing selalu manual',
            'Keduanya identik, hanya berbeda nama',
            'Error guessing hanya untuk bug keamanan; exploratory hanya untuk UI',
          ],
          answer_index: 0,
          explanation:
            'Error guessing bertumpu pada daftar dugaan terstruktur dari pengalaman untuk merancang kasus, sedangkan exploratory testing adalah pendekatan sesi bercharter dan bertimebox di mana desain dan eksekusi berjalan bersamaan disertai catatan sesi.',
          points: 1,
        },
        {
          prompt:
            'Sebuah tim menguji seluruh kombinasi 4 parameter dengan 3 nilai memakai pairwise. Kapan pairwise TIDAK cukup?',
          options: [
            'Ketika jumlah parameter lebih dari tiga',
            'Ketika terdapat interaksi tiga arah yang diketahui berisiko atau aturan keamanan yang harus diuji penuh',
            'Ketika salah satu parameter bersifat opsional',
            'Pairwise selalu cukup untuk semua kasus',
          ],
          answer_index: 1,
          explanation:
            'Pairwise menjamin cakupan pasangan, bukan kombinasi tiga arah. Bila ada interaksi tiga parameter yang diketahui berisiko (misalnya perhitungan pajak lintas negara) atau parameter terkait keamanan, kekuatan cakupan harus dinaikkan untuk parameter tersebut.',
          points: 1,
        },
      ],
    },
  ],
};

/* ==================================================================== *
 * 3 — QA Test Activity
 * ==================================================================== */

const qaTestActivity: SeedCourse = {
  slug: 'qa-test-activity',
  title: 'QA Test Activity: Perencanaan, Eksekusi, dan Pelaporan',
  subtitle: 'Dari test plan sampai keputusan go/no-go yang bisa dipertanggungjawabkan.',
  description:
    'Kursus tentang pekerjaan harian seorang QA: menyusun rencana pengujian, mendesain dan mengeksekusi, mengelola siklus hidup defect, membuat laporan yang dibaca manajemen, dan menetapkan kesiapan rilis berbasis kriteria keluar yang terukur.',
  level: 'intermediate',
  pillar: 'QA Test Activity',
  estimated_minutes: 720,
  order_index: 3,
  icon: '🗂️',
  tags: ['test-plan', 'eksekusi', 'defect-lifecycle', 'release-gate', 'pelaporan'],
  modules: [
    {
      code: 'QA-ACT-M1',
      title: 'Perencanaan Pengujian',
      summary: 'Strategi, ruang lingkup, estimasi, dan kriteria masuk/keluar.',
      order_index: 1,
      lessons: [
        {
          code: 'L-ACT-01',
          title: 'Menyusun Strategi & Rencana Pengujian',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 1,
          content_md: `## Apa yang sebenarnya harus ada di dalam test plan

Test plan yang baik bukan dokumen tebal berisi template. Ia adalah jawaban tertulis atas enam
pertanyaan yang akan ditanyakan manajer dan tim pada saat paling sibuk.

| Pertanyaan | Bagian test plan |
|---|---|
| Apa yang akan diuji (dan tidak diuji)? | Ruang lingkup & pengecualian |
| Mengapa ini yang dipilih? | Pendekatan & dasar risiko |
| Kapan dikerjakan? | Jadwal & milestone |
| Di mana? | Environment & konfigurasi |
| Oleh siapa? | Peran & tanggung jawab |
| Kapan dinyatakan selesai? | Kriteria masuk/keluar & kriteria tangguh |

### Ruang lingkup: hal pertama yang harus ditulis

Bagian yang paling sering dilupakan justru yang paling menyelamatkan: **daftar apa yang TIDAK diuji**.
Tanpa daftar ini, setiap orang punya asumsi berbeda, dan di akhir siklus muncul kejutan.

\`\`\`text
DALAM CAKUPAN
  - Alur checkout dengan kode promo (REQ-001, REQ-002)
  - Perhitungan diskon persen dan nominal
  - Riwayat pemakaian kode per akun

DI LUAR CAKUPAN (dengan alasan)
  - Integrasi dengan gateway pembayaran pihak ketiga (diuji oleh vendor, tersedia sertifikasi)
  - Performa beban > 1.000 pengguna bersamaan (masuk siklus pengujian performa terpisah)
  - Aplikasi mobile native (belum dirilis)
\`\`\`

### Pendekatan pengujian

| Pendekatan | Kapan dipilih | Konsekuensi |
|---|---|---|
| Berbasis risiko | Waktu terbatas, cakupan luas | Prioritas jelas; butuh data risiko yang jujur |
| Berbasis requirement | Kontrak/regulasi menuntut keterlacakan | Cakupan terukur; lemah pada hal tak tertulis |
| Eksploratif | Dokumentasi lemah, fitur baru | Temuan tak terduga; sulit diperkirakan |
| Regresi terotomasi | Rilis sering | Cepat & konsisten; butuh investasi awal |
| Hybrid (paling umum) | Hampir semua produk nyata | Butuh disiplin agar tidak jadi "serba sedikit" |

### Estimasi yang bisa dipertahankan

Tiga metode yang bisa dipakai bersamaan:

1. **Berbasis kasus** — jumlah test case × rata-rata menit per kasus, ditambah overhead 30–40%.
2. **Berbasis historis** — berapa lama siklus serupa sebelumnya, dikoreksi dengan faktor ukuran.
3. **Tiga titik** — (optimistis + 4×realistis + pesimistis) / 6.

\`\`\`text
Contoh (berbasis kasus):
  120 kasus × 6 menit            = 720 menit
  + setup environment & data 15% = 108 menit
  + investigasi & pelaporan 20%  = 144 menit
  + regresi 40 kasus × 2 menit   =  80 menit
  ─────────────────────────────────────────
  total                          = 1.052 menit ≈ 17,5 jam kerja
\`\`\`

Perhatikan overhead yang disertakan. Rencana yang hanya menghitung waktu eksekusi akan selalu meleset,
karena pekerjaan QA yang sebenarnya mencakup penyiapan, investigasi, dan pelaporan.

### Kriteria masuk (entry) dan keluar (exit)

| Kriteria masuk | Kriteria keluar |
|---|---|
| Build tersedia di environment uji | Seluruh kasus kritis & tinggi sudah dieksekusi |
| Seluruh requirement sudah disetujui | Pass rate ≥ ambang mutu proyek (mis. 90%) |
| Test case untuk cakupan siklus sudah siap | Tidak ada defect severity blocker/critical terbuka |
| Environment & data uji siap dipakai | Seluruh defect yang diperbaiki sudah di-retest |
| Tidak ada blocker build yang diketahui | Laporan hasil & metrik sudah dipublikasikan |

Kriteria keluar yang tidak terukur ("kualitas sudah bagus") tidak berguna. Setiap baris harus bisa
dijawab ya/tidak oleh orang lain tanpa berdebat.

### Latihan

Tulis test plan satu halaman untuk fitur berikutnya di tim Anda. Bagian terpanjang haruslah daftar
"di luar cakupan" beserta alasannya.`,
          lab_ref: '/cycles',
        },
        {
          code: 'L-ACT-02',
          title: 'Memilih Cakupan: Prioritisasi Berbasis Risiko',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 2,
          content_md: `## Realitas: Anda tidak akan menguji semuanya

Setiap siklus pengujian punya batas waktu, orang, dan energi. Pertanyaannya bukan "apakah kita harus
memilih?" melainkan "apakah pilihan kita disengaja dan terdokumentasi?".

### Matriks prioritisasi

| Dampak bisnis \\ Kemungkinan gagal | Rendah | Sedang | Tinggi |
|---|---|---|---|
| **Tinggi** | Uji penuh + otomasi | Uji penuh | Uji penuh, blokir rilis bila gagal |
| **Sedang** | Uji dasar | Uji utama + batas | Uji utama + negatif |
| **Rendah** | Uji asap saja | Uji asap | Uji dasar |

Cara mengisi sumbu:

- **Dampak bisnis** — apa yang terjadi bila fitur ini gagal di produksi? Kehilangan uang, data, atau
  kepercayaan?
- **Kemungkinan gagal** — seberapa baru kode ini, seberapa rumit, berapa kali berubah dalam siklus ini,
  dan berapa banyak defect historisnya?

### Sinyal yang menaikkan prioritas

1. Kode berubah pada siklus ini (perubahan = risiko).
2. Area pernah punya defect di rilis sebelumnya.
3. Logika bercabang banyak atau perhitungan uang/tanggal.
4. Integrasi lintas sistem.
5. Fitur yang menyentuh data pribadi atau izin akses.
6. Keluhan user atau tiket dukungan yang meningkat.

### Sinyal yang menurunkan prioritas

1. Kode tidak berubah dan sudah stabil selama beberapa rilis.
2. Fitur yang jarang dipakai dan kegagalannya tidak menghambat alur utama.
3. Fitur yang sudah punya otomasi regresi yang andal.
4. Fitur yang dampaknya kosmetik.

### Teknik "smoke dulu, lalu mendalam"

Ini pola paling hemat yang dipakai tim berpengalaman:

1. **Smoke (15–30 menit).** Alur paling kritis saja, untuk memastikan build layak diuji.
2. Bila smoke gagal → kembalikan build, jangan buang waktu menguji detail.
3. Bila smoke lulus → lanjut ke cakupan berisiko tinggi.
4. Terakhir, cakupan berisiko rendah bila waktu tersisa.

### Dokumentasikan keputusan, bukan hanya hasil

Yang membedakan QA profesional bukan cakupan yang luas, tetapi **kemampuan menjelaskan mengapa cakupan
itu dipilih**. Contoh catatan yang berguna:

\`\`\`text
Siklus 2026-Q1:
  Diuji penuh    : checkout, pembayaran, autentikasi (dampak tinggi, kode berubah)
  Diuji sebagian : laporan admin (dampak sedang, kode tidak berubah)
  Tidak diuji    : halaman statis "Tentang Kami" (dampak rendah, terakhir berubah 8 bulan lalu)
  Alasan         : 3 hari kerja tersedia; 2 defect historis di area checkout
\`\`\`

### Latihan

Ambil daftar fitur yang akan dirilis minggu ini. Isi matriks prioritisasi untuk semuanya, lalu tuliskan
cakupan akhir dalam format catatan di atas. Bahas dengan pemangku kepentingan — persetujuan mereka
adalah bagian dari hasil kerja Anda.`,
          lab_ref: '/cycles',
        },
        {
          code: 'L-ACT-11',
          title: 'Latihan: Meninjau Rencana Secara Kritis',
          kind: 'reading',
          duration_minutes: 20,
          order_index: 3,
          content_md: `## Rencana pengujian juga perlu ditinjau

Menulis test plan adalah satu keterampilan; meninjaunya secara kritis adalah keterampilan lain yang
jauh lebih cepat dipelajari dengan latihan. Modul ini memberi daftar periksa peninjauan yang bisa
dipakai pada pekerjaan sendiri maupun rekan.

### Contoh rencana yang tampak baik tetapi lemah

\`\`\`text
TEST PLAN — Rilis v2.4.1
Ruang lingkup : menguji seluruh fitur aplikasi
Pendekatan    : pengujian manual dan otomasi
Jadwal        : dua minggu sebelum rilis
Environment   : staging
Kriteria lulus: semua tes lulus
\`\`\`

Setiap baris terlihat wajar, tetapi tidak satu pun dapat ditindaklanjuti. Inilah pola rencana yang
"terdengar benar namun kosong".

### Daftar periksa peninjauan

| # | Pertanyaan | Rencana di atas | Perbaikan |
|---|---|---|---|
| 1 | Apakah ruang lingkup menyebut apa yang TIDAK diuji? | Tidak | Daftar pengecualian + alasan |
| 2 | Apakah pendekatan menyebut dasar pemilihan? | Tidak | Berbasis risiko + daftar area berisiko |
| 3 | Apakah jadwal memuat tanggal konkret? | Kabur | Tanggal mulai/akhir + milestone |
| 4 | Apakah estimasi memuat overhead? | Tidak ada | Rumus berbasis kasus + 30–40% |
| 5 | Apakah environment dirinci? | Hanya "staging" | Versi, data uji, akun, akses |
| 6 | Apakah kriteria lulus terukur? | "semua lulus" | Ambang angka + kriteria keluar |
| 7 | Apakah peran dan tanggung jawab jelas? | Tidak | Pemilik per area |
| 8 | Apakah kriteria masuk disebutkan? | Tidak | Syarat build & data siap |
| 9 | Apakah risiko tersisa didokumentasikan? | Tidak | Daftar risiko + mitigasi + pemilik |
| 10 | Bisakah orang lain menjalankannya tanpa bertanya? | Tidak | Uji dengan rekan |

### Kalimat yang harus membuat Anda waspada

| Frasa | Masalahnya | Tanyakan |
|---|---|---|
| "menguji seluruh fitur" | Tidak mungkin dan tidak bermakna | Fitur mana prioritas, mana dikecualikan? |
| "pengujian menyeluruh" | Tidak terukur | Berapa kasus, dan dengan teknik apa? |
| "semua tes harus lulus" | Mengabaikan ambang risiko | Ambang pass rate dan aturan blocker? |
| "secepatnya" | Bukan jadwal | Tanggal mulai dan akhir? |
| "QA bertanggung jawab atas kualitas" | Terlalu umum | Siapa memutuskan rilis, berdasarkan apa? |
| "dikoordinasikan nanti" | Belum ada rencana | Siapa pemilik area ini? |

### Meninjau rencana Anda sendiri

Tinjauan paling berguna adalah terhadap rencana sendiri, dan pertanyaan paling tajam:

> Bila saya tidak masuk kerja besok, apakah rekan saya bisa menjalankan rencana ini tanpa menelepon?

Bila jawabannya tidak, ada asumsi yang belum tertulis. Asumsi tersembunyi adalah penyebab paling umum
pekerjaan QA yang tidak bisa diwariskan.

### Latihan

Ambil test plan apa pun di tim Anda — termasuk buatan Anda sendiri — lalu nilai memakai kesepuluh
pertanyaan di atas. Tuliskan tiga perbaikan terkecil dengan dampak terbesar.`,
          lab_ref: '/cycles',
        },
      ],
    },
    {
      code: 'QA-ACT-M2',
      title: 'Desain & Eksekusi',
      summary: 'Anatomi test case yang bisa dijalankan orang lain, dan disiplin saat eksekusi.',
      order_index: 2,
      lessons: [
        {
          code: 'L-ACT-03',
          title: 'Anatomi Test Case yang Baik',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 1,
          content_md: `## Uji sederhana: bisakah orang lain menjalankannya?

Test case yang baik bisa dijalankan oleh rekan setim yang tidak tahu apa-apa tentang fitur tersebut,
tanpa perlu bertanya. Itulah standar yang harus Anda pakai.

### Komponen wajib

| Komponen | Isi | Contoh |
|---|---|---|
| ID | Identitas unik | TC-014 |
| Judul | Perilaku + kondisi | Terapkan kode promo persen valid pada keranjang > Rp500.000 |
| Prasyarat | Kondisi awal yang harus benar | User login; keranjang berisi 2 item total Rp600.000 |
| Langkah | Aksi bernomor | 1. Buka checkout 2. Isi kode PROMO10 3. Klik Terapkan |
| Data uji | Nilai konkret | Kode: PROMO10 (diskon 10%, belum kedaluwarsa) |
| Hasil diharapkan | Teramati & spesifik | Total berubah dari Rp600.000 menjadi Rp540.000; label diskon tampil |
| Tipe & prioritas | Klasifikasi | functional / tinggi |
| Layer | Di mana dijalankan | web / api / db |

### Hasil diharapkan harus bisa diamati

| Buruk | Baik |
|---|---|
| "Sistem bekerja dengan benar" | "Total menjadi Rp540.000 dan label 'Diskon 10%' tampil" |
| "Tidak ada error" | "HTTP 200, body berisi \`discount_amount: 60000\`" |
| "Data tersimpan" | "Query \`SELECT promo_code FROM orders\` mengembalikan 'PROMO10'" |

Perhatikan bahwa contoh baik menyebutkan **di mana** hasilnya diamati. Itu penting, karena satu perilaku
bisa diamati di UI, di respons API, dan di database — ketiganya bisa berbeda.

### Satu kasus, satu perilaku

Menggabungkan beberapa pemeriksaan dalam satu test case membuat interpretasi hasilnya kabur. Bila
langkah ke-7 gagal, apakah langkah 1–6 sudah benar? Pisahkan bila pemeriksaannya berbeda.

### Ukuran test case yang sehat

- Panjang langkah: 3–10 langkah. Lebih dari itu, pecah.
- Satu tujuan per kasus.
- Data uji selalu konkret, tidak pernah "isi data yang valid".
- Prasyarat bisa disiapkan orang lain tanpa bertanya.

### Jejak keterlacakan

Setiap test case harus menunjuk ke skenario atau requirement induknya. Ini bukan birokrasi: ketika
requirement berubah, Anda perlu tahu tepat kasus mana yang harus diperbarui. QATools melakukan ini
melalui matriks, dan menandai test case tanpa induk sebagai **orphan**.

### Latihan

Ambil satu test case lama milik Anda yang hasilnya berbunyi "sistem berjalan normal". Perbaiki hasil
harapannya sehingga bisa diamati oleh orang lain, lalu minta rekan menjalankannya tanpa penjelasan.`,
          lab_ref: '/testcases',
        },
        {
          code: 'L-ACT-04',
          title: 'Eksekusi & Pengumpulan Bukti',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 2,
          content_md: `## Eksekusi bukan sekadar klik dan tandai

Eksekusi adalah saat di mana asumsi bertemu kenyataan. Disiplin di sini menentukan apakah laporan Anda
bisa dipercaya.

### Status hasil dan artinya

| Status | Arti | Kesalahan umum |
|---|---|---|
| Lulus | Perilaku teramati sama dengan hasil diharapkan | Menandai lulus karena sebelumnya lulus |
| Gagal | Perilaku berbeda dari hasil diharapkan | Menandai gagal karena masalah environment |
| Terblokir | Tidak bisa dijalankan karena hambatan eksternal | Dipakai sebagai pelarian dari kasus sulit |
| Dilewati | Sengaja tidak dijalankan (di luar cakupan) | Dipakai tanpa alasan tercatat |
| Belum dijalankan | Belum disentuh | Tidak pernah dibedakan dari dilewati |

**Terblokir dan dilewati bukan hal yang sama.** Terblokir berarti ada hambatan yang harus diselesaikan
(misalnya environment mati); dilewati berarti keputusan sadar untuk tidak menjalankan. Mencampur keduanya
membuat laporan tidak bisa dipercaya.

### Disiplin bukti

Untuk setiap kegagalan, kumpulkan minimal:

1. **Screenshot atau rekaman** pada momen kegagalan.
2. **Log atau respons mentah** yang memuat nilai mencurigakan.
3. **Data uji yang dipakai** (bukan "data default").
4. **Timestamp dan build/versi** yang diuji.
5. **Langkah reproduksi minimal** — bukan seluruh perjalanan Anda sejak login.

Bukti yang dikumpulkan tepat setelah kegagalan terjadi menghemat puluhan menit dibanding mengumpulkan
ulang di akhir siklus, ketika build sudah berubah.

### Retest vs regresi

Ini dua aktivitas berbeda yang sering tertukar:

| | Retest | Regresi |
|---|---|---|
| Tujuan | Memastikan perbaikan berhasil | Memastikan tidak ada yang rusak |
| Cakupan | Kasus yang gagal + kasus serumpun | Area terdampak + suite regresi |
| Dipicu oleh | Perbaikan defect | Perubahan kode apa pun |
| Prioritas | Defect severity tinggi lebih dulu | Berbasis risiko |

Bug yang diperbaiki bisa memunculkan bug baru di tempat lain. Karena itu retest **selalu** diikuti
setidaknya regresi terarah pada area sekitar perubahan.

### Menghindari kesalahan eksekusi umum

1. **Menguji di build yang salah.** Catat versi sebelum mulai, bukan sesudah.
2. **Menandai lulus tanpa menjalankan.** Terutama pada kasus panjang dan membosankan.
3. **Melewatkan langkah prasyarat.** Hasilnya tidak valid, tetapi sering tidak disadari.
4. **Mengubah data uji di tengah jalan.** Membuat hasil tidak bisa direproduksi.
5. **Tidak mencatat waktu.** Menghilangkan kemampuan memperkirakan effort siklus berikutnya.

### Latihan

Jalankan lima test case pada rilis terakhir dengan protokol bukti di atas. Hitung berapa lama tambahan
waktu yang dibutuhkan untuk mengumpulkan bukti, lalu bandingkan dengan waktu yang biasanya hilang saat
menggali ulang konteks bug di akhir siklus.`,
          lab_ref: '/execute',
        },
        {
          code: 'L-ACT-05',
          title: 'Lab: Siklus Eksekusi Lengkap',
          kind: 'lab',
          duration_minutes: 35,
          order_index: 3,
          content_md: `## Tujuan lab

Menjalankan satu siklus eksekusi penuh — dari menyiapkan run, mengeksekusi, melaporkan defect, sampai
menutup run dengan laporan.

## Persiapan

1. Buka halaman **Test Runs** dan buat run baru bertipe manual untuk siklus aktif.
2. Pilih 10 test case dari area checkout, termasuk minimal tiga kasus negatif dan dua kasus batas.
3. Tentukan environment yang dipakai dan catat versi build.

## Langkah eksekusi

1. Jalankan setiap kasus sesuai urutan prioritas: kritis → tinggi → sedang → rendah.
2. Untuk setiap hasil, isi status dengan tepat. Gunakan *terblokir* hanya bila benar-benar ada hambatan,
   dan tuliskan hambatannya.
3. Untuk setiap kegagalan, catat bukti: nilai teramati, nilai diharapkan, dan langkah reproduksi minimal.
4. Dari run center, buat defect untuk setiap kegagalan. Hubungkan defect ke test case-nya.
5. Setelah selesai, buka **QA Metrics** dan lihat pass rate run tersebut.

## Laporan penutupan run

Tulis ringkasan dengan format:

\`\`\`text
Run        : RUN-0007 — Checkout kode promo
Build      : v2.4.1 (staging)
Cakupan    : 10 test case (3 negatif, 2 batas, 5 positif)
Hasil      : 7 lulus, 2 gagal, 1 terblokir
Durasi     : 47 menit
Defect     : BUG-012 (mayor, diskon persen), BUG-013 (minor, label tidak tampil)
Blocker    : environment pembayaran sandbox tidak merespons (kasus ke-8)
Risiko     : jalur pembayaran belum terverifikasi di build ini
Rekomendasi: perbaiki BUG-012, selesaikan blocker environment, ulangi 3 kasus terkait
\`\`\`

## Kriteria selesai

- Sepuluh kasus memiliki status akhir yang jujur, bukan semua "lulus".
- Setiap kegagalan punya defect tertaut dengan langkah reproduksi yang bisa diikuti orang lain.
- Laporan penutupan memuat angka, bukan kata sifat.

## Refleksi

Bandingkan estimasi Anda di awal dengan durasi nyata. Selisih inilah yang membuat estimasi siklus
berikutnya menjadi lebih akurat — dan itulah alasan setiap run perlu dicatat.`,
          lab_ref: '/runs',
        },
      ],
    },
    {
      code: 'QA-ACT-M3',
      title: 'Manajemen Defect',
      summary: 'Menulis, men-triase, melacak, dan menutup defect tanpa konflik.',
      order_index: 3,
      lessons: [
        {
          code: 'L-ACT-06',
          title: 'Siklus Hidup Defect',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 1,
          content_md: `## Perjalanan sebuah defect

Defect bukan tiket yang dibuat lalu hilang. Ia melewati serangkaian status yang, bila dijalankan
dengan disiplin, mencegah tiga masalah paling umum: bug yang hilang, bug yang diperbaiki dua kali, dan
bug yang "selesai" tanpa pernah diverifikasi.

\`\`\`text
  [Baru] ──triase──▶ [Tertriase] ──▶ [Dikerjakan] ──▶ [Diperbaiki] ──▶ [Siap Retest]
                                                                    │
                                              ┌─── lulus retest ─────┴───▶ [Terverifikasi] ──▶ [Ditutup]
                                              │
                                              └─── gagal retest ────────▶ [Dibuka Ulang] ──▶ [Dikerjakan]
\`\`\`

Status lain yang sah:

- **Ditolak** — bukan bug, atau tidak dapat direproduksi, dengan alasan tertulis.
- **Ditunda** — bug nyata, tetapi sengaja tidak diperbaiki pada rilis ini; wajib punya alasan dan
  pemilik keputusan.

### Tabel status dan siapa yang biasanya menangani

| Status | Pemilik langkah | Definisi selesai untuk status ini |
|---|---|---|
| Baru | QA | Tiket punya langkah, bukti, severity, priority |
| Tertriase | Lead/PO | Prioritas & penetapan pemilik sudah ditetapkan |
| Dikerjakan | Developer | Ada assignee aktif |
| Diperbaiki | Developer | Perbaikan sudah masuk build |
| Siap retest | Developer | Build berisi perbaikan tersedia di environment uji |
| Terverifikasi | QA | Perilaku benar teramati di build perbaikan |
| Ditutup | QA/Lead | Semua langkah selesai, bukti tersimpan |
| Dibuka ulang | QA | Masih gagal, dengan bukti baru |
| Ditolak | Lead/PO | Alasan penolakan tertulis dan jelas |
| Ditunda | Lead/PO | Target rilis baru dan alasannya tertulis |

### Aturan penting: verifikasi bukan formalitas

Banyak tim melewati tahap verifikasi: begitu developer bilang "sudah diperbaiki", tiket langsung
ditutup. Akibatnya bug yang sama muncul kembali di produksi, dan tidak ada yang tahu apakah pernah
benar-benar diperbaiki.

**Defect hanya bisa ditutup setelah QA mengamati perilaku benar** pada build yang memuat perbaikan.
Ini membutuhkan disiplin tetapi menghilangkan seluruh kelas bug berulang.

### Bug yang tidak dapat direproduksi

Ini situasi yang tidak nyaman tetapi tidak boleh diselesaikan dengan menutup tiket begitu saja. Langkah
bertahap yang bisa dipakai:

1. Kumpulkan informasi tambahan: log server, waktu kejadian, data akun.
2. Coba pada environment berbeda dan data berbeda.
3. Periksa apakah bug bersifat intermiten (kadang muncul) — bila ya, catat sebagai kandidat *flaky*.
4. Bila tetap tidak dapat direproduksi, tandai **Ditolak** dengan catatan eksplisit bahwa penyebabnya
   belum diketahui dan tiket dapat dibuka ulang dengan bukti baru.

### Metrik yang berguna dari data defect

| Metrik | Rumus | Kegunaan |
|---|---|---|
| Defect density | defect / test case | Menemukan modul yang perlu perhatian |
| Reopen rate | dibuka ulang / total | Mengukur kualitas perbaikan |
| Kecepatan perbaikan | rata-rata waktu Baru → Terverifikasi | Memprediksi jadwal rilis |
| Defect leakage | defect produksi / total | Mengukur efektivitas deteksi |
| Valid rate | defect sah / total dilaporkan | Mengukur presisi pelaporan QA |

### Latihan

Periksa tracker tim Anda. Berapa tingkat reopen dan berapa defect yang terverifikasi tanpa bukti jelas?
Dua angka itu biasanya berkorelasi kuat.`,
          lab_ref: '/defects',
        },
        {
          code: 'L-ACT-12',
          title: 'Latihan: Triase Defect Bersama Tim',
          kind: 'lab',
          duration_minutes: 25,
          order_index: 3,
          content_md: `## Tujuan lab

Berlatih memimpin sesi triase defect — pertemuan singkat yang menentukan prioritas dan pemilik setiap
temuan. Ini keterampilan yang jarang dilatih tetapi berdampak besar pada kecepatan tim.

## Mengapa triase perlu dipimpin QA

Tanpa triase, defect menumpuk di antrean tanpa prioritas. Semua orang mengerjakan yang paling berisik,
bukan yang paling berisiko. QA adalah pihak yang paling memahami dampak tiap temuan, sehingga paling
tepat memandu diskusi.

## Aturan sesi triase yang efektif

\`\`\`text
Durasi    : 30 menit, tidak lebih
Peserta   : QA, tech lead, perwakilan produk
Masukan   : daftar defect berstatus "baru"
Keluaran  : setiap defect punya severity, priority, dan pemilik
Aturan    : tidak ada diskusi perbaikan teknis di sesi ini — hanya prioritisasi
\`\`\`

Aturan terakhir adalah kuncinya. Sesi triase yang berubah menjadi diskusi arsitektur akan kehabisan
waktu setelah tiga tiket.

## Peran yang harus diisi

| Peran | Tanggung jawab dalam sesi |
|---|---|
| Pemimpin (QA) | Menyajikan dampak tiap defect secara ringkas |
| Perwakilan produk | Menetapkan prioritas bisnis |
| Tech lead | Menilai kompleksitas dan penetapan pemilik |
| Pencatat | Mencatat keputusan dan alasan penundaan |

## Contoh agenda untuk 12 defect

\`\`\`text
00:00–02:00  Ringkasan: 12 defect baru (1 blocker, 4 mayor, 5 minor, 2 kosmetik)
02:00–10:00  Blocker + mayor  → keputusan langsung
10:00–22:00  Minor           → dikelompokkan, diputuskan per kelompok
22:00–27:00  Kosmetik        → batch: diterima atau ditunda
27:00–30:00  Penundaan: catat alasan + pemilik + target rilis
\`\`\`

Kelompokkan tiket sejenis. Memutuskan lima kosmetik sekaligus memakan waktu kurang dari satu menit
per tiket, sedangkan membahasnya satu per satu memakan dua menit masing-masing.

## Langkah lab

1. Siapkan 8–12 defect fiktif (boleh dari daftar pada modul sebelumnya) dan tandai sebagai "baru".
2. Bagi tim menjadi empat peran di atas. Bila bekerja sendiri, mainkan seluruh peran secara bergantian.
3. Jalankan sesi 25 menit dengan agenda di atas.
4. Untuk setiap defect, hasilkan tiga keputusan: severity, priority, dan pemilik.
5. Untuk setiap defect yang **ditunda**, catat alasan, pemilik keputusan, dan target rilis.
6. Perbarui status setiap defect sesuai keputusan, lalu periksa kembali tracker.

## Format keluaran

| Kode | Judul singkat | Severity | Priority | Pemilik | Status keputusan |
|---|---|---|---|---|---|
| BUG-… | … | … | … | … | dikerjakan / ditunda / ditolak |

## Kriteria selesai

- Seluruh defect memiliki severity, priority, dan pemilik — tidak ada yang tersisa tanpa keputusan.
- Setiap penundaan memiliki alasan tertulis dan target rilis.
- Sesi selesai dalam 25 menit tanpa keluar dari agenda.

## Refleksi

Perhatikan bagaimana keputusan menjadi jauh lebih cepat ketika QA menyajikan **dampak** terlebih
dahulu, bukan detail teknis. Kalimat seperti "ini memblokir seluruh transaksi dengan kode promo"
memungkinkan keputusan diambil dalam hitungan detik, sedangkan penjelasan teknis panjang justru
memperlambatnya.`,
          lab_ref: '/defects',
        },
        {
          code: 'L-ACT-07',
          title: 'Menulis Laporan Defect yang Tidak Diabaikan',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 2,
          content_md: `## Tujuan laporan bug: mempercepat perbaikan

Laporan bug yang baik memindahkan beban berpikir dari pembaca ke penulis. Developer yang membaca laporan
Anda seharusnya tahu **apa yang salah, di mana, kapan, dan bagaimana membuktikannya** dalam kurang dari
satu menit.

### Struktur standar

\`\`\`text
Judul       : [Komponen] Perilaku menyimpang pada kondisi spesifik
Severity    : critical | major | minor | cosmetic
Priority    : tinggi | sedang | rendah
Environment : versi, environment, browser/perangkat, akun
Data uji    : nilai konkret yang dipakai
Prasyarat   : kondisi awal
Langkah     : 1., 2., 3. … (minimal, bisa diulang)
Hasil aktual: apa yang teramati (angka/teks persis)
Hasil harap : apa yang seharusnya (dengan acuan aturan)
Bukti       : screenshot, log, respons API, baris database
Dampak      : siapa terdampak dan seberapa luas
\`\`\`

### Contoh nyata: buruk vs baik

**Buruk:**

\`\`\`text
Judul  : Diskon salah
Deskripsi: waktu saya coba checkout diskonnya salah, tolong dicek
\`\`\`

Mengapa buruk: tidak ada versi, tidak ada data, tidak ada angka, tidak ada ekspektasi. Developer harus
menebak dan menghubungi QA, yang menghabiskan waktu dua orang.

**Baik:**

\`\`\`text
Judul       : [Checkout] Diskon persen dihitung dari subtotal sebelum pajak
Severity    : Mayor          Priority: Tinggi
Environment : v2.4.1 · staging · Chrome 121 · akun pembeli terautentikasi
Data uji    : keranjang 2 item (Rp500.000 + Rp100.000), kode PROMO10 (10%)
Prasyarat   : user login, kode PROMO10 belum pernah dipakai akun ini
Langkah     : 1. Tambahkan 2 item
              2. Buka checkout
              3. Isi kode PROMO10 lalu klik Terapkan
Hasil aktual: Total menampilkan Rp540.000 (diskon Rp60.000 dari subtotal sebelum pajak)
Hasil harap : Sesuai REQ-001, diskon dihitung setelah pajak → total seharusnya Rp534.600
Bukti       : screenshot checkout.png · respons GET /api/cart/quote
Dampak      : seluruh transaksi dengan kode promo; selisih 1% dari total
\`\`\`

Perhatikan bahwa laporan baik **mengutip aturan** (REQ-001) sehingga tidak bisa diperdebatkan sebagai
"pendapat QA".

### Tujuh kesalahan yang membuat laporan diabaikan

1. **Judul umum** — "Error", "Tidak berfungsi".
2. **Tidak ada langkah reproduksi** — developer tidak bisa melihat masalahnya.
3. **Menggabungkan beberapa bug** dalam satu tiket.
4. **Menyalahkan orang**, bukan mendeskripsikan perilaku.
5. **Severity dilebih-lebihkan** — semuanya kritis, sehingga tidak ada yang kritis.
6. **Hasil diharapkan samar** — "seharusnya benar".
7. **Tidak ada bukti** — membuat retest dan verifikasi menjadi tidak mungkin.

### Nada laporan

Tulis seolah Anda melaporkan perilaku sistem kepada rekan yang ingin memperbaikinya, bukan seolah
menyampaikan kesalahan seseorang. Contoh perbedaan:

| Menyalahkan | Netral |
|---|---|
| "Validasi tidak dibuat dengan benar" | "Validasi menerima kode kedaluwarsa" |
| "Kode siapa ini?" | "Terjadi pada build v2.4.1 di modul checkout" |
| "Sudah saya bilang kemarin" | "Perilaku ini masih teramati setelah perbaikan BUG-009" |

### Latihan

Tulis ulang laporan bug terlama yang pernah Anda buat dengan struktur di atas. Bandingkan: apakah
sekarang lebih mudah dipahami orang yang tidak tahu konteksnya?`,
          lab_ref: '/defects',
        },
      ],
    },
    {
      code: 'QA-ACT-M4',
      title: 'Pelaporan & Kesiapan Rilis',
      summary: 'Metrik QA, laporan untuk manajemen, dan kriteria go/no-go.',
      order_index: 4,
      lessons: [
        {
          code: 'L-ACT-08',
          title: 'Metrik QA yang Benar-Benar Berguna',
          kind: 'reading',
          duration_minutes: 22,
          order_index: 1,
          content_md: `## Metrik buruk menciptakan perilaku buruk

Bila tim diukur dari **jumlah test case yang dibuat**, orang akan membuat test case kecil-kecil dan
banyak. Bila diukur dari **jumlah bug yang ditemukan**, orang akan melaporkan bug sepele. Metrik bukan
sekadar pengukuran; ia adalah sistem insentif.

### Metrik yang layak dipakai

| Metrik | Rumus | Yang sebenarnya diukur | Peringatan |
|---|---|---|---|
| Pass rate | lulus / dieksekusi | Kesiapan build saat ini | Bisa dinaikkan dengan menguji yang mudah |
| Cakupan requirement | requirement dengan test / total | Kelengkapan cakupan | Bukan ukuran kualitas test-nya |
| Automation rate | kasus terotomasi / total | Efisiensi jangka panjang | Otomasi buruk lebih mahal daripada manual |
| Defect density | defect / ukuran modul | Konsentrasi masalah | Perlu ukuran modul yang konsisten |
| Defect leakage | defect produksi / total | Efektivitas deteksi | Wajib diikuti analisis akar penyebab |
| Reopen rate | dibuka ulang / total | Kualitas perbaikan | Tinggi berarti verifikasi lemah |
| Escape & flaky rate | kasus berubah hasil / total run | Keandalan suite | Ini yang merusak kepercayaan otomasi |
| Efektivitas regresi | defect ditemukan regresi / total | Nilai suite regresi | Suite besar belum tentu efektif |

### Empat metrik inti untuk laporan rutin

Bila hanya boleh memilih empat:

1. **Cakupan requirement** — apakah kita menguji hal yang benar?
2. **Pass rate pada kasus kritis** — apakah build layak?
3. **Defect leakage** — apakah proses kita menemukan masalah sebelum user?
4. **Flaky rate** — apakah hasil otomasi bisa dipercaya?

Keempatnya menjawab pertanyaan berbeda: cakupan (benar/salah sasaran), kondisi (layak/tidak),
efektivitas (bekerja/tidak), dan keandalan (bisa dipercaya/tidak).

### Visualisasi yang dibaca cepat

| Grafik | Menjawab |
|---|---|
| Tren pass rate per build | Apakah kualitas stabil atau memburuk? |
| Defect per modul (batang) | Di mana masalah menumpuk? |
| Defect terbuka per severity (tumpuk) | Apakah sisa masalah berbahaya? |
| Tren escaped defect per rilis | Apakah proses membaik? |
| Distribusi durasi eksekusi | Apakah estimasi realistis? |

Hindari dasbor dengan 20 grafik. Dasbor yang baik membuat pengambil keputusan bertindak dalam satu
menit.

### Contoh laporan siklus yang jujur

\`\`\`text
Siklus        : 2026-Q1 · rilis v2.4.1
Cakupan       : 214 kasus dieksekusi dari 226 direncanakan (94,7%)
                requirement tercakup 38/40 (95%) — 2 gap: pelaporan ekspor, audit trail
Hasil         : 198 lulus (92,5%), 11 gagal, 5 terblokir
Defect        : 18 ditemukan (2 blocker, 5 mayor, 9 minor, 2 kosmetik)
                ditutup 12, terbuka 6 (0 blocker, 3 mayor, 3 minor)
Otomasi       : 132 kasus terotomasi (61,7%); flaky rate 1,9%
Regresi       : suite 87 kasus, lulus 85 (97,7%), durasi 22 menit
Risiko tersisa: jalur pembayaran cukup diuji; laporan ekspor belum diuji sama sekali
Rekomendasi   : GO bersyarat — tunda fitur ekspor, rilis sisanya
\`\`\`

Perhatikan kalimat terakhir. Laporan QA yang berguna **memberi rekomendasi**, bukan hanya data. Tim
produk tetap memutuskan, tetapi mereka memutuskan dengan informasi yang lengkap.

### Latihan

Ambil laporan QA terakhir di tim Anda. Hitung berapa dari empat metrik inti yang tersedia. Untuk yang
tidak tersedia, tuliskan mengapa datanya tidak ada — biasanya jawabannya adalah celah proses, bukan
celah alat.`,
          lab_ref: '/metrics',
        },
        {
          code: 'L-ACT-09',
          title: 'Release Readiness & Go/No-Go',
          kind: 'reading',
          duration_minutes: 24,
          order_index: 2,
          content_md: `## Keputusan rilis adalah keputusan risiko, bukan keputusan emosi

Tidak ada rilis tanpa risiko. Tugas QA bukan menghilangkan risiko, tetapi membuatnya **terlihat dan
terukur**, sehingga keputusan bisa diambil dengan sadar.

### Kerangka keputusan

\`\`\`text
GO           : seluruh kriteria keluar terpenuhi
GO BERSYARAT : ada risiko tersisa yang diketahui, terbatas, dan dimitigasi
NO-GO        : ada risiko tersisa yang tidak dapat diterima
\`\`\`

### Kriteria keluar yang terukur

| Kriteria | Ambang | Cara memeriksa |
|---|---|---|
| Cakupan kasus kritis | 100% dieksekusi | Daftar kasus prioritas kritis |
| Pass rate keseluruhan | ≥ ambang mutu proyek (mis. 90%) | Metrik run |
| Defect blocker terbuka | 0 | Daftar defect |
| Defect critical terbuka | 0, atau ada persetujuan tertulis | Daftar defect + catatan persetujuan |
| Regresi terakhir | Lulus di build kandidat | Hasil run regresi |
| Requirement tercakup | ≥ 95% | Matriks traceability |
| Performa | p95 < ambang yang disepakati | Hasil uji performa |

### Menyusun daftar risiko tersisa

Dokumen paling berharga yang dihasilkan QA menjelang rilis bukan daftar "apa yang sudah diuji",
tetapi **daftar "apa yang belum diuji dan seberapa berbahaya"**.

\`\`\`text
RISIKO TERSISA — v2.4.1
1. Ekspor laporan ke Excel belum diuji sama sekali
   Dampak: laporan bisa salah format bagi 40 pengguna admin
   Mitigasi: fitur disembunyikan di balik feature flag untuk rilis ini
   Pemilik: tim admin

2. Beban 500 pengguna bersamaan belum diuji dengan kode baru
   Dampak: kemungkinan respons melambat di jam sibuk
   Mitigasi: pantau p95 selama 48 jam pertama; rollback plan siap
   Pemilik: tim SRE

3. Bug BUG-018 (mayor) di perhitungan ulang setelah refund
   Dampak: sebagian kecil transaksi butuh koreksi manual
   Mitigasi: proses koreksi manual sudah disiapkan tim operasi
   Pemilik: tim keuangan
\`\`\`

Format ini mengubah percakapan: dari "apakah sudah selesai?" menjadi "risiko mana yang kita terima
dan bagaimana kita mengelolanya?".

### Contoh keputusan bersyarat

Sebuah tim memutuskan GO BERSYARAT dengan syarat:
- Fitur ekspor dinonaktifkan lewat feature flag.
- Pemantauan p95 diaktifkan 48 jam pertama.
- Rollback plan diuji di staging.
- BUG-018 masuk backlog dengan tenggat satu minggu.

Keputusan ini jujur dan bisa dipertanggungjawabkan. Bandingkan dengan keputusan "GO karena sudah
deadline" — keputusan yang sama, tetapi tanpa mitigasi dan tanpa dokumentasi.

### Yang harus dihindari QA saat rilis

1. **Menjadi penghambat tanpa alternatif.** "Tidak boleh rilis" tanpa menjelaskan mitigasi bukanlah
   kontribusi.
2. **Menyetujui tanpa数据.** Rilis yang dipaksakan tanpa catatan risiko melindungi jadwal, bukan produk.
3. **Menyembunyikan risiko kecil.** Risiko yang tidak ditulis akan menjadi kejutan di produksi.
4. **Menyamakan semua defect.** Blocker dan kosmetik tidak boleh diperlakukan sama.

### Latihan

Susun kerangka keputusan rilis untuk fitur berikutnya di tim Anda: tujuh kriteria keluar dengan ambang
angka, dan format daftar risiko tersisa. Bagikan ke pemangku kepentingan sebelum siklus dimulai,
bukan sesudahnya.`,
          lab_ref: '/regression',
        },
        {
          code: 'L-ACT-10',
          title: 'Lab: Laporan Kesiapan Rilis',
          kind: 'lab',
          duration_minutes: 35,
          order_index: 3,
          content_md: `## Tujuan lab

Menyusun satu laporan kesiapan rilis yang lengkap berdasar data nyata dari QATools, lalu mengambil
keputusan go/no-go yang bisa dipertahankan.

## Langkah

1. Buka **QA Metrics** untuk project aktif dan catat: pass rate, cakupan requirement, automation rate,
   defect density, dan defect leakage bila tersedia.
2. Buka **Traceability Matrix** dan catat jumlah requirement dengan status **gap** dan **orphan**.
3. Buka **Defect Tracker**, filter defect yang masih terbuka, dan kelompokkan per severity.
4. Buka **Regresi (King)**, jalankan seleksi suite, dan catat berapa kasus terpilih serta estimasi
   durasinya.
5. Buka **Run Center** dan ambil hasil run terakhir di build kandidat rilis.
6. Susun laporan dengan struktur:

\`\`\`text
1. Ringkasan eksekutif (3 baris: status, alasan, rekomendasi)
2. Cakupan pengujian (angka, bukan kata sifat)
3. Hasil eksekusi (pass rate, blocker, durasi)
4. Defect (terbuka per severity, reopen rate)
5. Regresi (ukuran suite, pass rate, durasi, flaky)
6. Risiko tersisa (daftar bernomor + mitigasi + pemilik)
7. Rekomendasi: GO / GO BERSYARAT / NO-GO dengan syarat tertulis
\`\`\`

7. Tulis satu paragraf pembenaran keputusan yang bisa dibaca manajer non-teknis.

## Kriteria selesai

- Setiap angka bisa ditelusuri ke halaman QATools tempat ia diambil.
- Terdapat minimal tiga risiko tersisa dengan mitigasi dan pemilik.
- Rekomendasi memuat syarat konkret bila bersifat bersyarat.

## Refleksi

Perhatikan perbedaan antara laporan yang berbunyi "pengujian sudah dilakukan" dan laporan yang
membuat pembacanya memahami risiko. Yang kedua adalah alasan QA ada di dalam tim.`,
          lab_ref: '/metrics',
        },
      ],
    },
  ],
  quizzes: [
    {
      title: 'Kuis Aktivitas Pengujian',
      pass_score: 70,
      order_index: 1,
      questions: [
        {
          prompt:
            'Dalam eksekusi test, apa perbedaan penting antara status "terblokir" dan "dilewati"?',
          options: [
            'Keduanya sama, hanya berbeda istilah',
            'Terblokir berarti ada hambatan eksternal yang harus diselesaikan; dilewati adalah keputusan sadar dengan alasan tercatat',
            'Terblokir berarti QA malas menjalankan; dilewati berarti kasusnya tidak ada',
            'Terblokir hanya untuk kasus otomasi; dilewati hanya untuk kasus manual',
          ],
          answer_index: 1,
          explanation:
            'Terblokir menandakan hambatan yang mencegah eksekusi (environment mati, data tidak tersedia) sehingga memerlukan tindakan lanjutan. Dilewati adalah keputusan cakupan yang sengaja diambil. Mencampur keduanya membuat laporan tidak dapat dipercaya.',
          points: 1,
        },
        {
          prompt:
            'Seorang developer menyatakan "sudah saya perbaiki" di komentar tiket. Apa langkah yang tepat bagi QA?',
          options: [
            'Menutup tiket karena perbaikan sudah dilakukan',
            'Mengubah status menjadi terverifikasi tanpa menguji karena developer sudah yakin',
            'Menjalankan ulang kasus pada build yang memuat perbaikan, lalu menutup tiket hanya bila perilaku benar teramati',
            'Membuka tiket baru untuk perbaikan yang sama',
          ],
          answer_index: 2,
          explanation:
            'Status terverifikasi dan tertutup menuntut bukti pengamatan QA pada build perbaikan. Menutup tiket atas dasar pernyataan developer menghapus tahap verifikasi dan menjadi penyebab utama bug berulang.',
          points: 1,
        },
        {
          prompt:
            'Tim Anda hanya boleh memantau empat metrik QA. Manakah himpunan yang paling seimbang?',
          options: [
            'Jumlah test case, jumlah bug, jumlah tester, jumlah jam kerja',
            'Cakupan requirement, pass rate kasus kritis, defect leakage, dan flaky rate',
            'Kecepatan eksekusi, jumlah build, ukuran tim, uptime server',
            'Pass rate, jumlah defect ditemukan, jumlah sprint, dan coverage kode',
          ],
          answer_index: 1,
          explanation:
            'Keempat metrik ini menjawab pertanyaan berbeda: apakah kita menguji hal yang benar (cakupan), apakah build layak (pass rate kritis), apakah proses mendeteksi masalah sebelum user (leakage), dan apakah hasil otomasi dapat dipercaya (flaky).',
          points: 1,
        },
        {
          prompt:
            'Apa perbedaan utama antara retest dan regression test setelah sebuah defect diperbaiki?',
          options: [
            'Retest memastikan perbaikan berhasil pada kasus yang gagal; regression memastikan perubahan tidak merusak area lain',
            'Retest dilakukan developer; regression dilakukan QA',
            'Retest hanya untuk defect kritis; regression untuk semua defect',
            'Keduanya identik dan dapat saling menggantikan',
          ],
          answer_index: 0,
          explanation:
            'Retest memverifikasi perbaikan pada kasus yang gagal beserta kasus serumpun, sedangkan regression test memeriksa area terdampak untuk memastikan tidak ada kerusakan baru akibat perubahan tersebut.',
          points: 1,
        },
        {
          prompt:
            'Sebuah rilis memiliki 0 blocker terbuka, pass rate 93%, tetapi fitur ekspor laporan belum diuji sama sekali. Rekomendasi paling profesional adalah…',
          options: [
            'NO-GO, karena selalu ada yang belum diuji',
            'GO, karena tidak ada blocker',
            'GO BERSYARAT dengan menonaktifkan fitur ekspor lewat feature flag, memantau metrik pasca-rilis, dan mencatat risiko beserta pemiliknya',
            'GO tanpa catatan, agar jadwal rilis tidak terganggu',
          ],
          answer_index: 2,
          explanation:
            'Keputusan bersyarat mengakui risiko tersisa secara jujur sambil tetap memungkinkan rilis, asalkan ada mitigasi konkret, pemantauan, dan dokumentasi. Menyembunyikan risiko atau menolak tanpa alternatif sama-sama tidak profesional.',
          points: 1,
        },
        {
          prompt:
            'Mengapa laporan test case yang berbunyi "hasil diharapkan: sistem berjalan normal" bermasalah?',
          options: [
            'Karena terlalu panjang',
            'Karena tidak dapat diamati dan diverifikasi oleh orang lain, sehingga hasil eksekusi menjadi subjektif',
            'Karena tidak menyebutkan nama developer',
            'Karena tidak memakai istilah teknis',
          ],
          answer_index: 1,
          explanation:
            'Hasil yang diharapkan harus berupa perilaku yang dapat diamati dan spesifik (nilai, teks, atau status tertentu). Rumusan samar membuat penilaian lulus/gagal bergantung pada opini pelaksana.',
          points: 1,
        },
      ],
    },
  ],
};

export const CONTENT_A: SeedCourse[] = [qaIntroduction, qaTestTechnique, qaTestActivity];
