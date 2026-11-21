/**
 * Demo project seeder — LEAD-OWNED.
 *
 * Seeds ONE realistic end-to-end example project that walks the entire ordered QA lifecycle,
 * so a first-time user sees every feature populated and understands the intended sequence.
 *
 * Run:  node apps/api/node_modules/tsx/dist/cli.mjs apps/api/src/seed/demo.ts
 * Safe to run repeatedly: it is keyed on the project `key` and skips if already present
 * (pass --force to wipe and rebuild that project).
 *
 * NOTE: `src/seed/curriculum.ts` and `src/seed/run.ts` belong to lane-learn.
 *       This file is separate and lead-owned; it never imports their internals except
 *       through the optional `seedCurriculum()` export, guarded by try/catch.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, migrate, toJson, nextCode, logActivity } from '../db/index.js';
import { newId, nowIso, riskScore, type Priority } from '@qatools/shared';

const PROJECT_KEY = 'DEMO-QA';

/* ------------------------------------------------------------------ utils */

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000);

interface SeedContext {
  projectId: string;
  requirementIds: string[];
  useCaseIds: string[];
  scenarioIds: string[];
  testCaseIds: string[];
  cycleId: string;
  sprintIds: string[];
  environmentId: string;
  collectionId: string;
  defectIds: string[];
}

function existingProject(): string | null {
  const row = db.prepare('SELECT id FROM projects WHERE key = ?').get(PROJECT_KEY) as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

function wipe(projectId: string): void {
  // ON DELETE CASCADE handles the children for every table that references projects(id).
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
}

/* --------------------------------------------------------------- 1. project */

function seedProject(): string {
  const id = newId('prj_');
  const ts = nowIso();
  db.prepare(
    `INSERT INTO projects (id, key, name, description, target_url, repo_url, owner, status,
                           quality_gate, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
  ).run(
    id,
    PROJECT_KEY,
    'Demo: Toko Online Sehatku',
    'Project contoh untuk mendemonstrasikan SELURUH alur QA berurutan di QATools: ' +
      'kebutuhan → use case → skenario → test case → traceability matrix → perencanaan → ' +
      'environment → eksekusi (manual/DB/API/Web/AI) → defect → regresi → release gate → metrik.',
    'https://sehatku.example.id',
    'https://github.com/yogiarjan/qatools',
    'Yogi Arjan',
    90,
    toJson({
      demo: true,
      note: 'Data contoh. Aman dihapus. Jalankan ulang: node apps/api/node_modules/tsx/dist/cli.mjs apps/api/src/seed/demo.ts --force',
    }),
    ts,
    ts,
  );
  logActivity({
    project_id: id,
    action: 'seed.create',
    entity_kind: 'project',
    entity_id: id,
    summary: 'Project demo dibuat oleh seeder',
  });
  return id;
}

/* ---------------------------------------------------------- 2. requirements */

const REQUIREMENTS: Array<{
  title: string;
  description: string;
  source: string;
  priority: Priority;
  ac: string[];
}> = [
  {
    title: 'Pengguna dapat mendaftar akun baru dengan email dan kata sandi',
    description:
      'Calon pelanggan membuat akun menggunakan email unik dan kata sandi minimal 8 karakter. ' +
      'Sistem mengirim email verifikasi dan menolak email yang sudah terdaftar.',
    source: 'Product Owner — Sprint Planning #1',
    priority: 'critical',
    ac: [
      'Email harus unik dan berformat valid',
      'Kata sandi minimal 8 karakter, mengandung huruf dan angka',
      'Email verifikasi terkirim maksimal 60 detik setelah pendaftaran',
      'Email duplikat ditolak dengan pesan yang jelas',
    ],
  },
  {
    title: 'Pengguna dapat masuk (login) dan sesi bertahan sesuai kebijakan',
    description:
      'Autentikasi menggunakan email + kata sandi. Sesi memakai token yang kedaluwarsa setelah 24 jam. ' +
      'Percobaan gagal berulang harus dibatasi (rate limit).',
    source: 'Product Owner — Sprint Planning #1',
    priority: 'critical',
    ac: [
      'Kredensial benar menghasilkan token akses',
      'Kredensial salah menghasilkan HTTP 401',
      'Maksimal 5 percobaan gagal per menit per akun',
      'Token kedaluwarsa setelah 24 jam',
    ],
  },
  {
    title: 'Pengguna dapat mencari produk berdasarkan kata kunci dan kategori',
    description:
      'Pencarian mengembalikan daftar produk yang cocok, mendukung filter kategori, ' +
      'dan menampilkan pesan kosong yang informatif bila tidak ada hasil.',
    source: 'Hasil analisis web existing (Site Analyzer)',
    priority: 'high',
    ac: [
      'Hasil pencarian relevan dengan kata kunci',
      'Filter kategori mempersempit hasil dengan benar',
      'Pencarian tanpa hasil menampilkan empty state, bukan halaman error',
      'Waktu respons di bawah 2 detik untuk 10.000 produk',
    ],
  },
  {
    title: 'Pengguna dapat menambahkan produk ke keranjang dan mengubah jumlahnya',
    description:
      'Keranjang menyimpan item per pengguna, menghitung subtotal secara real-time, ' +
      'dan memvalidasi ketersediaan stok.',
    source: 'Product Owner — Sprint Planning #2',
    priority: 'high',
    ac: [
      'Item ditambahkan dengan jumlah minimal 1',
      'Jumlah tidak boleh melebihi stok tersedia',
      'Subtotal diperbarui setiap perubahan jumlah',
      'Keranjang bertahan setelah pengguna login ulang',
    ],
  },
  {
    title: 'Pengguna dapat menyelesaikan checkout dan menerima nomor pesanan',
    description:
      'Checkout membuat pesanan, memotong stok, mencatat transaksi secara atomik, ' +
      'dan mengembalikan nomor pesanan unik.',
    source: 'Product Owner — Sprint Planning #2',
    priority: 'critical',
    ac: [
      'Pesanan dibuat dengan status awal "menunggu pembayaran"',
      'Stok berkurang tepat sekali (tidak boleh minus)',
      'Nomor pesanan unik dan dapat dilacak',
      'Keranjang dikosongkan setelah checkout berhasil',
    ],
  },
  {
    title: 'Riwayat pesanan dapat dilihat dan difilter berdasarkan status',
    description: 'Pengguna melihat daftar pesanan lampau beserta status pembayaran dan pengiriman.',
    source: 'Customer Support — tiket #482',
    priority: 'medium',
    ac: [
      'Hanya pesanan milik pengguna yang tampil',
      'Filter status berfungsi untuk semua status',
      'Halaman detail pesanan menampilkan item dan total yang benar',
    ],
  },
  {
    title: 'Laporan penjualan harian dapat diekspor oleh admin',
    description:
      'Admin mengekspor laporan penjualan harian dalam format CSV dengan total yang konsisten ' +
      'terhadap data transaksi.',
    source: 'Tim Finance — permintaan bulanan',
    priority: 'medium',
    ac: [
      'CSV berisi kolom tanggal, jumlah pesanan, total pendapatan',
      'Total CSV sama dengan jumlah di database',
      'Hanya admin yang dapat mengakses fitur ini',
    ],
  },
  {
    title: 'Sistem menolak akses tidak sah pada endpoint admin',
    description:
      'Semua endpoint admin memerlukan peran admin. Akses dengan token pengguna biasa ' +
      'harus ditolak tanpa membocorkan informasi internal.',
    source: 'Audit keamanan internal',
    priority: 'high',
    ac: [
      'Token pengguna biasa mendapat HTTP 403',
      'Tanpa token mendapat HTTP 401',
      'Pesan error tidak membocorkan detail internal',
    ],
  },
];

function seedRequirements(projectId: string): string[] {
  const ids: string[] = [];
  REQUIREMENTS.forEach((req, i) => {
    const id = newId('req_');
    const ts = nowIso();
    db.prepare(
      `INSERT INTO requirements (id, project_id, code, title, description, source, priority, status,
                                 acceptance_criteria, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)`,
    ).run(
      id,
      projectId,
      `REQ-${String(i + 1).padStart(3, '0')}`,
      req.title,
      req.description,
      req.source,
      req.priority,
      toJson(req.ac),
      ts,
      ts,
    );
    ids.push(id);
  });
  return ids;
}

/* -------------------------------------------------------------- 3. usecases */

interface UseCaseSeed {
  reqIndex: number;
  code: string;
  name: string;
  goal: string;
  actors: string[];
  pre: string[];
  post: string[];
  mainFlow: string[];
  alt: Array<{ name: string; steps: string[] }>;
  rules: string[];
  priority: Priority;
  risk: 'low' | 'medium' | 'high';
}

const USE_CASES: UseCaseSeed[] = [
  {
    reqIndex: 0,
    code: 'UC-001',
    name: 'Registrasi Akun Pelanggan',
    goal: 'Calon pelanggan berhasil membuat akun dan dapat langsung login.',
    actors: ['Calon Pelanggan', 'Sistem Email', 'Sistem Autentikasi'],
    pre: ['Calon pelanggan membuka halaman registrasi', 'Email belum pernah terdaftar'],
    post: ['Akun tersimpan dengan status belum terverifikasi', 'Email verifikasi terkirim'],
    mainFlow: [
      'Pelanggan membuka halaman /register',
      'Sistem menampilkan formulir registrasi (nama, email, kata sandi)',
      'Pelanggan mengisi seluruh field dan menekan "Daftar"',
      'Sistem memvalidasi format email dan kekuatan kata sandi',
      'Sistem memeriksa keunikan email di database',
      'Sistem menyimpan akun baru dan mengirim email verifikasi',
      'Sistem menampilkan pesan sukses dan mengarahkan ke halaman login',
    ],
    alt: [
      {
        name: 'Email sudah terdaftar',
        steps: [
          'Sistem menemukan email sudah ada',
          'Sistem menampilkan pesan "Email sudah terdaftar"',
          'Sistem tidak membuat akun baru',
        ],
      },
      {
        name: 'Kata sandi terlalu lemah',
        steps: [
          'Sistem mendeteksi kata sandi kurang dari 8 karakter',
          'Sistem menampilkan indikator kekuatan kata sandi dan pesan validasi',
        ],
      },
    ],
    rules: ['Email harus unik', 'Kata sandi minimal 8 karakter', 'Email verifikasi berlaku 24 jam'],
    priority: 'critical',
    risk: 'high',
  },
  {
    reqIndex: 1,
    code: 'UC-002',
    name: 'Login Pengguna',
    goal: 'Pengguna terdaftar memperoleh token akses dan masuk ke area akun.',
    actors: ['Pelanggan', 'Admin', 'Sistem Autentikasi'],
    pre: ['Akun sudah terdaftar dan terverifikasi'],
    post: ['Token akses diterbitkan', 'Sesi tercatat di activity log'],
    mainFlow: [
      'Pengguna membuka halaman /login',
      'Pengguna memasukkan email dan kata sandi',
      'Sistem memverifikasi kredensial terhadap hash kata sandi',
      'Sistem menerbitkan token akses berumur 24 jam',
      'Sistem mengarahkan pengguna ke dashboard sesuai perannya',
    ],
    alt: [
      {
        name: 'Kredensial salah',
        steps: ['Sistem gagal memverifikasi', 'Sistem mengembalikan HTTP 401', 'Sistem menambah penghitung percobaan gagal'],
      },
      {
        name: 'Terlalu banyak percobaan',
        steps: ['Penghitung gagal melewati 5 dalam 1 menit', 'Sistem membalas HTTP 429', 'Akun dikunci sementara 15 menit'],
      },
    ],
    rules: ['Token berlaku 24 jam', 'Maksimal 5 percobaan gagal per menit', 'Pesan error tidak membedakan email ada/tidak'],
    priority: 'critical',
    risk: 'high',
  },
  {
    reqIndex: 2,
    code: 'UC-003',
    name: 'Pencarian dan Filter Produk',
    goal: 'Pengguna menemukan produk yang diinginkan dengan cepat.',
    actors: ['Pelanggan', 'Admin Katalog'],
    pre: ['Katalog produk berisi minimal satu produk aktif'],
    post: ['Daftar produk relevan ditampilkan'],
    mainFlow: [
      'Pengguna mengetik kata kunci pada kolom pencarian',
      'Pengguna memilih kategori dari dropdown',
      'Sistem mengeksekusi query pencarian dengan filter',
      'Sistem menampilkan hasil terurut berdasarkan relevansi',
    ],
    alt: [
      { name: 'Tidak ada hasil', steps: ['Query tidak menemukan produk', 'Sistem menampilkan empty state dengan saran kata kunci'] },
      { name: 'Kata kunci kosong', steps: ['Sistem menampilkan seluruh produk pada kategori terpilih'] },
    ],
    rules: ['Pencarian tidak case-sensitive', 'Hasil maksimal 50 item per halaman'],
    priority: 'high',
    risk: 'medium',
  },
  {
    reqIndex: 3,
    code: 'UC-004',
    name: 'Kelola Keranjang Belanja',
    goal: 'Pengguna mengumpulkan produk yang akan dibeli dan melihat total sementara.',
    actors: ['Pelanggan'],
    pre: ['Pengguna sudah login', 'Produk memiliki stok tersedia'],
    post: ['Keranjang tersimpan dan subtotal akurat'],
    mainFlow: [
      'Pengguna menekan "Tambah ke Keranjang" pada halaman produk',
      'Sistem menambahkan item dengan jumlah 1',
      'Sistem menghitung ulang subtotal',
      'Pengguna dapat mengubah jumlah melalui halaman keranjang',
      'Sistem memvalidasi jumlah terhadap stok tersedia',
    ],
    alt: [
      { name: 'Jumlah melebihi stok', steps: ['Sistem menolak perubahan', 'Sistem menampilkan stok tersedia'] },
      { name: 'Produk dihapus dari katalog', steps: ['Sistem menandai item sebagai tidak tersedia di keranjang'] },
    ],
    rules: ['Jumlah minimal 1', 'Jumlah maksimal sama dengan stok', 'Subtotal selalu dihitung ulang di server'],
    priority: 'high',
    risk: 'medium',
  },
  {
    reqIndex: 4,
    code: 'UC-005',
    name: 'Checkout dan Pembuatan Pesanan',
    goal: 'Pengguna menyelesaikan pembelian dan menerima nomor pesanan.',
    actors: ['Pelanggan', 'Sistem Pembayaran', 'Sistem Inventori'],
    pre: ['Keranjang berisi minimal satu item', 'Alamat pengiriman terisi'],
    post: ['Pesanan tercatat', 'Stok berkurang', 'Keranjang dikosongkan'],
    mainFlow: [
      'Pengguna membuka halaman checkout',
      'Sistem menampilkan ringkasan keranjang dan total',
      'Pengguna memilih alamat dan metode pengiriman',
      'Pengguna menekan "Buat Pesanan"',
      'Sistem memvalidasi stok terakhir',
      'Sistem membuat pesanan dan mengurangi stok dalam satu transaksi',
      'Sistem mengembalikan nomor pesanan dan mengosongkan keranjang',
    ],
    alt: [
      {
        name: 'Stok habis saat checkout',
        steps: ['Validasi stok gagal', 'Transaksi dibatalkan (rollback)', 'Sistem meminta pengguna menyesuaikan keranjang'],
      },
      { name: 'Keranjang kosong', steps: ['Sistem menolak checkout dengan HTTP 400'] },
    ],
    rules: [
      'Pembuatan pesanan dan pengurangan stok harus atomik',
      'Stok tidak boleh bernilai negatif',
      'Nomor pesanan unik dan tidak dapat ditebak berurutan',
    ],
    priority: 'critical',
    risk: 'high',
  },
  {
    reqIndex: 5,
    code: 'UC-006',
    name: 'Lihat Riwayat Pesanan',
    goal: 'Pengguna meninjau pesanan lampau dan statusnya.',
    actors: ['Pelanggan'],
    pre: ['Pengguna sudah login', 'Pengguna memiliki minimal satu pesanan'],
    post: ['Daftar pesanan tampil sesuai filter'],
    mainFlow: [
      'Pengguna membuka menu "Pesanan Saya"',
      'Sistem memuat pesanan milik pengguna',
      'Pengguna memilih filter status',
      'Pengguna membuka detail salah satu pesanan',
    ],
    alt: [{ name: 'Belum ada pesanan', steps: ['Sistem menampilkan empty state dengan ajakan belanja'] }],
    rules: ['Pengguna hanya dapat melihat pesanannya sendiri', 'Pesanan pengguna lain menghasilkan HTTP 403'],
    priority: 'medium',
    risk: 'medium',
  },
  {
    reqIndex: 6,
    code: 'UC-007',
    name: 'Ekspor Laporan Penjualan Harian',
    goal: 'Admin memperoleh berkas CSV penjualan untuk rekonsiliasi keuangan.',
    actors: ['Admin', 'Tim Finance'],
    pre: ['Pengguna memiliki peran admin', 'Terdapat transaksi pada tanggal yang diminta'],
    post: ['Berkas CSV terunduh dengan total yang konsisten'],
    mainFlow: [
      'Admin membuka halaman laporan',
      'Admin memilih rentang tanggal',
      'Sistem mengagregasi transaksi dari database',
      'Sistem membentuk CSV dan mengirimkannya sebagai unduhan',
    ],
    alt: [{ name: 'Tidak ada transaksi', steps: ['Sistem tetap mengirim CSV dengan baris header saja'] }],
    rules: ['Hanya admin yang boleh mengakses', 'Total CSV harus sama dengan SUM di database'],
    priority: 'medium',
    risk: 'medium',
  },
  {
    reqIndex: 7,
    code: 'UC-008',
    name: 'Proteksi Endpoint Admin',
    goal: 'Mencegah akses tidak sah ke fungsi administratif.',
    actors: ['Penyerang', 'Pengguna Biasa', 'Admin', 'Sistem Otorisasi'],
    pre: ['Endpoint admin terdaftar di router'],
    post: ['Akses tidak sah ditolak dan tercatat'],
    mainFlow: [
      'Klien mengirim permintaan ke endpoint /admin/*',
      'Sistem mengekstrak dan memvalidasi token',
      'Sistem memeriksa klaim peran',
      'Sistem mengizinkan hanya bila peran adalah admin',
    ],
    alt: [
      { name: 'Tanpa token', steps: ['Sistem membalas HTTP 401 Unauthorized'] },
      { name: 'Token pengguna biasa', steps: ['Sistem membalas HTTP 403 Forbidden', 'Percobaan dicatat di log keamanan'] },
      { name: 'Token dipalsukan', steps: ['Verifikasi tanda tangan gagal', 'Sistem membalas HTTP 401'] },
    ],
    rules: ['Semua endpoint /admin/* wajib peran admin', 'Pesan error tidak membocorkan detail internal'],
    priority: 'high',
    risk: 'high',
  },
];

function seedUseCases(projectId: string): string[] {
  const ids: string[] = [];
  USE_CASES.forEach((uc) => {
    const id = newId('uc_');
    const ts = nowIso();
    db.prepare(
      `INSERT INTO use_cases (id, project_id, code, name, goal, actors, preconditions, postconditions,
                              main_flow, alternate_flows, business_rules, priority, risk, status,
                              generated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 'manual', ?, ?)`,
    ).run(
      id,
      projectId,
      uc.code,
      uc.name,
      uc.goal,
      toJson(uc.actors),
      toJson(uc.pre),
      toJson(uc.post),
      toJson(uc.mainFlow),
      toJson(uc.alt),
      toJson(uc.rules),
      uc.priority,
      uc.risk,
      ts,
      ts,
    );
    ids.push(id);
  });
  return ids;
}

/* ------------------------------------------------------------- 4. scenarios */

interface ScenarioSeed {
  ucIndex: number;
  code: string;
  title: string;
  kind: 'happy_path' | 'alternative' | 'negative' | 'edge' | 'security' | 'performance';
  given: string;
  when: string;
  then: string;
  priority: Priority;
}

const SCENARIOS: ScenarioSeed[] = [
  { ucIndex: 0, code: 'SC-001', title: 'Registrasi berhasil dengan data valid', kind: 'happy_path', given: 'email belum terdaftar dan kata sandi memenuhi syarat', when: 'pelanggan mengirim formulir registrasi yang valid', then: 'akun dibuat, email verifikasi terkirim, dan pesan sukses tampil', priority: 'critical' },
  { ucIndex: 0, code: 'SC-002', title: 'Registrasi ditolak karena email duplikat', kind: 'negative', given: 'email sudah terdaftar di sistem', when: 'pelanggan mendaftar dengan email tersebut', then: 'sistem menolak dengan pesan "Email sudah terdaftar" dan tidak membuat akun', priority: 'high' },
  { ucIndex: 0, code: 'SC-003', title: 'Registrasi ditolak karena format email tidak valid', kind: 'negative', given: 'email berbentuk "bukan-email"', when: 'pelanggan mengirim formulir', then: 'validasi gagal dan pesan kesalahan format ditampilkan', priority: 'medium' },
  { ucIndex: 0, code: 'SC-004', title: 'Kata sandi tepat 8 karakter diterima (batas bawah)', kind: 'edge', given: 'kata sandi tepat 8 karakter mengandung huruf dan angka', when: 'pelanggan mendaftar', then: 'registrasi berhasil karena batas bawah terpenuhi', priority: 'medium' },
  { ucIndex: 0, code: 'SC-005', title: 'Kata sandi 7 karakter ditolak (batas bawah - 1)', kind: 'edge', given: 'kata sandi 7 karakter', when: 'pelanggan mendaftar', then: 'sistem menolak dengan pesan minimal 8 karakter', priority: 'medium' },
  { ucIndex: 1, code: 'SC-006', title: 'Login berhasil dengan kredensial benar', kind: 'happy_path', given: 'akun terdaftar dan terverifikasi', when: 'pengguna mengirim email dan kata sandi yang benar', then: 'token akses diterbitkan dan pengguna diarahkan ke dashboard', priority: 'critical' },
  { ucIndex: 1, code: 'SC-007', title: 'Login gagal dengan kata sandi salah', kind: 'negative', given: 'akun terdaftar', when: 'pengguna mengirim kata sandi yang salah', then: 'sistem membalas HTTP 401 tanpa membocorkan keberadaan akun', priority: 'critical' },
  { ucIndex: 1, code: 'SC-008', title: 'Akun dikunci setelah 5 percobaan gagal', kind: 'security', given: 'akun terdaftar', when: 'pengguna gagal login 6 kali dalam satu menit', then: 'percobaan ke-6 dibalas HTTP 429 dan akun dikunci sementara', priority: 'high' },
  { ucIndex: 1, code: 'SC-009', title: 'Token kedaluwarsa setelah 24 jam', kind: 'edge', given: 'token diterbitkan 24 jam 1 menit lalu', when: 'token digunakan untuk mengakses endpoint terproteksi', then: 'sistem membalas HTTP 401 karena token kedaluwarsa', priority: 'high' },
  { ucIndex: 2, code: 'SC-010', title: 'Pencarian mengembalikan produk relevan', kind: 'happy_path', given: 'katalog berisi produk dengan kata kunci "vitamin"', when: 'pengguna mencari "vitamin"', then: 'daftar produk relevan tampil terurut berdasarkan relevansi', priority: 'high' },
  { ucIndex: 2, code: 'SC-011', title: 'Pencarian tanpa hasil menampilkan empty state', kind: 'negative', given: 'tidak ada produk cocok', when: 'pengguna mencari "zzzqqq"', then: 'empty state informatif tampil, bukan halaman error', priority: 'medium' },
  { ucIndex: 2, code: 'SC-012', title: 'Kinerja pencarian di bawah 2 detik untuk 10.000 produk', kind: 'performance', given: 'katalog berisi 10.000 produk', when: 'pengguna menjalankan pencarian', then: 'respons selesai kurang dari 2000 ms', priority: 'medium' },
  { ucIndex: 3, code: 'SC-013', title: 'Menambahkan produk ke keranjang berhasil', kind: 'happy_path', given: 'pengguna login dan produk memiliki stok', when: 'pengguna menekan "Tambah ke Keranjang"', then: 'item muncul di keranjang dengan jumlah 1 dan subtotal benar', priority: 'high' },
  { ucIndex: 3, code: 'SC-014', title: 'Menambah jumlah melebihi stok ditolak', kind: 'negative', given: 'stok produk tersisa 3', when: 'pengguna mengubah jumlah menjadi 5', then: 'sistem menolak dan menampilkan stok tersedia', priority: 'high' },
  { ucIndex: 3, code: 'SC-015', title: 'Keranjang bertahan setelah login ulang', kind: 'alternative', given: 'keranjang berisi 2 item', when: 'pengguna logout lalu login kembali', then: 'isi keranjang tetap sama', priority: 'medium' },
  { ucIndex: 4, code: 'SC-016', title: 'Checkout berhasil membuat pesanan', kind: 'happy_path', given: 'keranjang berisi item dengan stok cukup', when: 'pengguna menyelesaikan checkout', then: 'pesanan dibuat, stok berkurang, keranjang kosong, nomor pesanan tampil', priority: 'critical' },
  { ucIndex: 4, code: 'SC-017', title: 'Checkout dibatalkan saat stok habis', kind: 'negative', given: 'stok produk habis tepat sebelum checkout', when: 'pengguna menekan "Buat Pesanan"', then: 'transaksi rollback, tidak ada pesanan, stok tidak berubah', priority: 'critical' },
  { ucIndex: 4, code: 'SC-018', title: 'Stok tidak pernah bernilai negatif pada pembelian bersamaan', kind: 'edge', given: 'stok tersisa 1', when: 'dua pengguna checkout produk yang sama secara bersamaan', then: 'tepat satu berhasil dan stok akhir 0, tidak pernah -1', priority: 'critical' },
  { ucIndex: 5, code: 'SC-019', title: 'Riwayat pesanan milik pengguna tampil', kind: 'happy_path', given: 'pengguna memiliki 3 pesanan', when: 'pengguna membuka "Pesanan Saya"', then: 'hanya 3 pesanan miliknya yang tampil', priority: 'medium' },
  { ucIndex: 5, code: 'SC-020', title: 'Pengguna tidak dapat melihat pesanan orang lain', kind: 'security', given: 'pengguna A login', when: 'pengguna A mengakses detail pesanan milik pengguna B', then: 'sistem membalas HTTP 403', priority: 'high' },
  { ucIndex: 6, code: 'SC-021', title: 'Ekspor CSV laporan penjualan konsisten dengan database', kind: 'happy_path', given: 'terdapat 12 transaksi hari ini', when: 'admin mengekspor laporan hari ini', then: 'CSV berisi 12 baris dan totalnya sama dengan SUM di database', priority: 'medium' },
  { ucIndex: 6, code: 'SC-022', title: 'Non-admin ditolak saat mengekspor laporan', kind: 'security', given: 'pengguna dengan peran pelanggan', when: 'pengguna mengakses endpoint ekspor laporan', then: 'sistem membalas HTTP 403', priority: 'high' },
  { ucIndex: 7, code: 'SC-023', title: 'Akses endpoint admin tanpa token ditolak', kind: 'security', given: 'klien tanpa token', when: 'klien memanggil GET /admin/reports', then: 'sistem membalas HTTP 401', priority: 'high' },
  { ucIndex: 7, code: 'SC-024', title: 'Akses endpoint admin dengan token pengguna biasa ditolak', kind: 'security', given: 'klien dengan token peran pelanggan', when: 'klien memanggil GET /admin/reports', then: 'sistem membalas HTTP 403 tanpa membocorkan detail internal', priority: 'high' },
];

function seedScenarios(projectId: string, useCaseIds: string[]): string[] {
  const ids: string[] = [];
  SCENARIOS.forEach((sc) => {
    const id = newId('sc_');
    const ts = nowIso();
    db.prepare(
      `INSERT INTO scenarios (id, project_id, use_case_id, code, title, kind, given_text, when_text,
                              then_text, priority, generated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
    ).run(
      id,
      projectId,
      useCaseIds[sc.ucIndex] ?? null,
      sc.code,
      sc.title,
      sc.kind,
      sc.given,
      sc.when,
      sc.then,
      sc.priority,
      ts,
      ts,
    );
    ids.push(id);
  });
  return ids;
}

/* ------------------------------------------------------------- 5. testcases */

interface TestCaseSeed {
  scenarioIndex: number;
  title: string;
  objective: string;
  pre: string;
  type: string;
  layer: 'web' | 'api' | 'db' | 'mobile' | 'unit';
  priority: Priority;
  severity: 'cosmetic' | 'minor' | 'major' | 'critical' | 'blocker';
  engine: 'manual' | 'db' | 'api' | 'web' | 'ai';
  automation: 'manual' | 'automated' | 'to_be_automated' | 'cannot_automate';
  minutes: number;
  tags: string[];
  data: Array<{ field: string; value: string }>;
  expected: string;
  steps: Array<{ action: string; expected: string }>;
}

const TEST_CASES: TestCaseSeed[] = [
  {
    scenarioIndex: 0, title: 'Registrasi akun baru dengan email unik berhasil', objective: 'Memastikan pendaftaran akun baru membuat data dan mengirim email verifikasi.',
    pre: 'Database bersih, layanan email aktif', type: 'functional', layer: 'api', priority: 'critical', severity: 'blocker', engine: 'api', automation: 'automated', minutes: 5,
    tags: ['smoke', 'auth', 'critical-path'],
    data: [{ field: 'email', value: 'budi.baru@example.id' }, { field: 'password', value: 'Rahasia123' }, { field: 'name', value: 'Budi Baru' }],
    expected: 'HTTP 201, akun tersimpan, email verifikasi terkirim',
    steps: [
      { action: 'POST /api/auth/register dengan data valid', expected: 'HTTP 201 Created' },
      { action: 'Periksa body respons memuat userId', expected: 'userId ada dan berformat benar' },
      { action: 'Query tabel users untuk email tersebut', expected: 'Tepat 1 baris ditemukan' },
    ],
  },
  {
    scenarioIndex: 1, title: 'Registrasi dengan email duplikat ditolak', objective: 'Memastikan keunikan email ditegakkan di level API dan database.',
    pre: 'Email sudah terdaftar', type: 'negative', layer: 'api', priority: 'high', severity: 'major', engine: 'api', automation: 'automated', minutes: 4,
    tags: ['auth', 'negative', 'validation'],
    data: [{ field: 'email', value: 'sudah.ada@example.id' }, { field: 'password', value: 'Rahasia123' }],
    expected: 'HTTP 409 dengan pesan email sudah terdaftar, tidak ada baris baru',
    steps: [
      { action: 'POST /api/auth/register dengan email yang sudah terdaftar', expected: 'HTTP 409 Conflict' },
      { action: 'Hitung baris users dengan email tersebut', expected: 'Jumlah tetap 1' },
    ],
  },
  {
    scenarioIndex: 4, title: 'Validasi batas kata sandi 7 dan 8 karakter', objective: 'Menguji nilai batas (boundary value) aturan panjang kata sandi.',
    pre: 'Tidak ada', type: 'boundary', layer: 'api', priority: 'medium', severity: 'major', engine: 'api', automation: 'automated', minutes: 4,
    tags: ['boundary', 'validation'],
    data: [{ field: 'password_7', value: 'Abc1234' }, { field: 'password_8', value: 'Abc12345' }],
    expected: '7 karakter ditolak dengan HTTP 400, 8 karakter diterima',
    steps: [
      { action: 'POST registrasi dengan kata sandi 7 karakter', expected: 'HTTP 400 dengan pesan minimal 8 karakter' },
      { action: 'POST registrasi dengan kata sandi 8 karakter', expected: 'HTTP 201 Created' },
    ],
  },
  {
    scenarioIndex: 5, title: 'Login dengan kredensial valid mengembalikan token', objective: 'Memverifikasi autentikasi sukses menghasilkan token akses.',
    pre: 'Akun admin terdaftar (admin/secret)', type: 'functional', layer: 'api', priority: 'critical', severity: 'blocker', engine: 'api', automation: 'automated', minutes: 3,
    tags: ['smoke', 'auth', 'critical-path'],
    data: [{ field: 'username', value: 'admin' }, { field: 'password', value: 'secret' }],
    expected: 'HTTP 200 dengan token tidak kosong',
    steps: [
      { action: 'POST /api/mock/login dengan kredensial benar', expected: 'HTTP 200 OK' },
      { action: 'Periksa field token pada respons', expected: 'token ada dan panjang > 0' },
    ],
  },
  {
    scenarioIndex: 6, title: 'Login dengan kata sandi salah ditolak', objective: 'Memastikan kredensial salah tidak menghasilkan token.',
    pre: 'Akun terdaftar', type: 'negative', layer: 'api', priority: 'critical', severity: 'major', engine: 'api', automation: 'automated', minutes: 3,
    tags: ['auth', 'negative', 'security'],
    data: [{ field: 'username', value: 'admin' }, { field: 'password', value: 'salah-sekali' }],
    expected: 'HTTP 401 tanpa token',
    steps: [
      { action: 'POST /api/mock/login dengan kata sandi salah', expected: 'HTTP 401 Unauthorized' },
      { action: 'Periksa body respons', expected: 'Tidak ada field token' },
    ],
  },
  {
    scenarioIndex: 7, title: 'Rate limit login setelah percobaan gagal berulang', objective: 'Memastikan perlindungan brute force bekerja.',
    pre: 'Akun terdaftar', type: 'security', layer: 'api', priority: 'high', severity: 'major', engine: 'manual', automation: 'to_be_automated', minutes: 8,
    tags: ['security', 'rate-limit'],
    data: [{ field: 'attempts', value: '6' }],
    expected: 'Percobaan ke-6 dibalas HTTP 429',
    steps: [
      { action: 'Kirim 6 permintaan login dengan kata sandi salah berturut-turut', expected: '5 pertama HTTP 401' },
      { action: 'Amati respons percobaan ke-6', expected: 'HTTP 429 Too Many Requests' },
    ],
  },
  {
    scenarioIndex: 9, title: 'Pencarian produk mengembalikan hasil relevan', objective: 'Memverifikasi endpoint pencarian mengembalikan produk cocok.',
    pre: 'Katalog berisi data seed', type: 'functional', layer: 'api', priority: 'high', severity: 'major', engine: 'api', automation: 'automated', minutes: 3,
    tags: ['search', 'regression'],
    data: [{ field: 'q', value: 'vitamin' }],
    expected: 'HTTP 200 dengan array produk tidak kosong',
    steps: [
      { action: 'GET /api/mock/products?q=vitamin', expected: 'HTTP 200 OK' },
      { action: 'Periksa panjang array data', expected: 'length >= 1' },
    ],
  },
  {
    scenarioIndex: 10, title: 'Pencarian tanpa hasil mengembalikan array kosong', objective: 'Memastikan tidak ada error saat hasil pencarian kosong.',
    pre: 'Katalog tersedia', type: 'negative', layer: 'api', priority: 'medium', severity: 'minor', engine: 'api', automation: 'automated', minutes: 2,
    tags: ['search', 'negative'],
    data: [{ field: 'q', value: 'zzzqqq' }],
    expected: 'HTTP 200 dengan array data kosong, bukan 500',
    steps: [
      { action: 'GET /api/mock/products?q=zzzqqq', expected: 'HTTP 200 OK' },
      { action: 'Periksa panjang array data', expected: 'length = 0' },
    ],
  },
  {
    scenarioIndex: 12, title: 'Verifikasi data user tersimpan benar di database', objective: 'Memastikan integritas data hasil registrasi pada level database.',
    pre: 'Database SQLite demo tersedia', type: 'functional', layer: 'db', priority: 'high', severity: 'major', engine: 'db', automation: 'automated', minutes: 5,
    tags: ['database', 'integrity', 'regression'],
    data: [{ field: 'table', value: 'users' }],
    expected: 'Jumlah user aktif lebih besar dari 0 dan kolom email unik',
    steps: [
      { action: 'SELECT COUNT(*) AS total FROM users WHERE active = 1', expected: 'total > 0' },
      { action: 'SELECT COUNT(*) AS dup FROM (SELECT email FROM users GROUP BY email HAVING COUNT(*) > 1)', expected: 'dup = 0' },
    ],
  },
  {
    scenarioIndex: 13, title: 'Stok tidak boleh bernilai negatif', objective: 'Memastikan constraint integritas stok di database terjaga.',
    pre: 'Tabel products berisi data', type: 'functional', layer: 'db', priority: 'critical', severity: 'blocker', engine: 'db', automation: 'automated', minutes: 4,
    tags: ['database', 'integrity', 'critical-path'],
    data: [{ field: 'table', value: 'products' }],
    expected: 'Tidak ada baris dengan stock < 0',
    steps: [
      { action: 'SELECT COUNT(*) AS bad FROM products WHERE stock < 0', expected: 'bad = 0' },
      { action: 'SELECT MIN(stock) AS min_stock FROM products', expected: 'min_stock >= 0' },
    ],
  },
  {
    scenarioIndex: 14, title: 'Keranjang bertahan setelah sesi login ulang', objective: 'Memastikan persistensi keranjang lintas sesi.',
    pre: 'Pengguna login dengan keranjang berisi 2 item', type: 'functional', layer: 'web', priority: 'medium', severity: 'major', engine: 'web', automation: 'to_be_automated', minutes: 10,
    tags: ['cart', 'session'],
    data: [{ field: 'items', value: '2' }],
    expected: 'Jumlah item tetap 2 setelah login ulang',
    steps: [
      { action: 'Buka halaman login dan masuk sebagai pelanggan', expected: 'Dashboard pengguna tampil' },
      { action: 'Buka halaman keranjang', expected: 'Terdapat 2 baris item' },
      { action: 'Logout lalu login kembali', expected: 'Login berhasil' },
      { action: 'Buka halaman keranjang lagi', expected: 'Jumlah item tetap 2' },
    ],
  },
  {
    scenarioIndex: 15, title: 'Checkout berhasil membuat pesanan dan memotong stok', objective: 'Memverifikasi alur checkout end-to-end.',
    pre: 'Keranjang berisi 1 item dengan stok cukup', type: 'functional', layer: 'api', priority: 'critical', severity: 'blocker', engine: 'api', automation: 'automated', minutes: 6,
    tags: ['checkout', 'critical-path', 'smoke'],
    data: [{ field: 'product_id', value: 'prod_001' }, { field: 'quantity', value: '2' }],
    expected: 'HTTP 201 dengan orderId, stok berkurang tepat 2',
    steps: [
      { action: 'POST /api/mock/orders dengan item valid', expected: 'HTTP 201 Created' },
      { action: 'Periksa field orderId pada respons', expected: 'orderId ada dan tidak kosong' },
      { action: 'GET /api/mock/orders/:id', expected: 'Detail pesanan sesuai' },
    ],
  },
  {
    scenarioIndex: 17, title: 'Pembelian bersamaan tidak membuat stok negatif', objective: 'Menguji konsistensi transaksi pada kondisi balapan (race condition).',
    pre: 'Stok produk tersisa 1', type: 'boundary', layer: 'api', priority: 'critical', severity: 'blocker', engine: 'manual', automation: 'cannot_automate', minutes: 20,
    tags: ['concurrency', 'edge', 'critical-path'],
    data: [{ field: 'concurrent_users', value: '2' }, { field: 'initial_stock', value: '1' }],
    expected: 'Tepat 1 pesanan berhasil, stok akhir 0, tidak pernah negatif',
    steps: [
      { action: 'Siapkan stok produk = 1', expected: 'Stok terkonfirmasi 1' },
      { action: 'Jalankan 2 checkout paralel untuk produk yang sama', expected: 'Kedua permintaan terkirim bersamaan' },
      { action: 'Amati hasil kedua permintaan', expected: 'Tepat satu HTTP 201, satu lagi HTTP 409' },
      { action: 'Query stok akhir di database', expected: 'stock = 0' },
    ],
  },
  {
    scenarioIndex: 18, title: 'Riwayat hanya menampilkan pesanan milik pengguna', objective: 'Memverifikasi isolasi data antar pengguna.',
    pre: 'Pengguna A memiliki 3 pesanan, pengguna B memiliki 2 pesanan', type: 'functional', layer: 'api', priority: 'medium', severity: 'major', engine: 'api', automation: 'automated', minutes: 4,
    tags: ['orders', 'regression'],
    data: [{ field: 'userId', value: 'usr_A' }],
    expected: 'Hanya 3 pesanan milik pengguna A yang tampil',
    steps: [
      { action: 'GET /api/mock/orders?userId=usr_A dengan token A', expected: 'HTTP 200' },
      { action: 'Periksa jumlah item', expected: 'length = 3' },
    ],
  },
  {
    scenarioIndex: 19, title: 'Akses pesanan pengguna lain ditolak', objective: 'Menguji otorisasi tingkat objek (IDOR).',
    pre: 'Pengguna A dan B terdaftar', type: 'security', layer: 'api', priority: 'high', severity: 'critical', engine: 'manual', automation: 'to_be_automated', minutes: 8,
    tags: ['security', 'idor', 'regression'],
    data: [{ field: 'targetOrder', value: 'milik pengguna B' }],
    expected: 'HTTP 403 dan data pesanan tidak terkirim',
    steps: [
      { action: 'Login sebagai pengguna A, ambil token', expected: 'Token A diperoleh' },
      { action: 'GET detail pesanan milik B menggunakan token A', expected: 'HTTP 403 Forbidden' },
      { action: 'Periksa body respons', expected: 'Tidak memuat data pesanan B' },
    ],
  },
  {
    scenarioIndex: 20, title: 'Total CSV laporan sama dengan agregasi database', objective: 'Memastikan konsistensi laporan terhadap sumber data.',
    pre: 'Terdapat transaksi pada tanggal uji', type: 'functional', layer: 'db', priority: 'medium', severity: 'major', engine: 'db', automation: 'automated', minutes: 6,
    tags: ['reporting', 'database', 'regression'],
    data: [{ field: 'table', value: 'orders' }],
    expected: 'SUM(total) dari orders sama dengan total pada CSV',
    steps: [
      { action: 'SELECT SUM(total) AS grand_total, COUNT(*) AS n FROM orders', expected: 'grand_total tidak null' },
      { action: 'Bandingkan dengan total pada CSV hasil ekspor', expected: 'Nilai identik' },
    ],
  },
  {
    scenarioIndex: 22, title: 'Endpoint admin tanpa token ditolak dengan 401', objective: 'Memverifikasi proteksi autentikasi endpoint admin.',
    pre: 'Endpoint admin tersedia', type: 'security', layer: 'api', priority: 'high', severity: 'critical', engine: 'api', automation: 'automated', minutes: 3,
    tags: ['security', 'authz', 'regression', 'smoke'],
    data: [{ field: 'endpoint', value: '/api/admin/reports' }],
    expected: 'HTTP 401 tanpa body yang membocorkan informasi',
    steps: [
      { action: 'GET /api/admin/reports tanpa header Authorization', expected: 'HTTP 401 Unauthorized' },
      { action: 'Periksa body respons', expected: 'Tidak memuat stack trace atau nama tabel' },
    ],
  },
  {
    scenarioIndex: 23, title: 'Endpoint admin dengan token pengguna biasa ditolak 403', objective: 'Memverifikasi otorisasi berbasis peran.',
    pre: 'Tersedia token pengguna berperan pelanggan', type: 'security', layer: 'api', priority: 'high', severity: 'critical', engine: 'api', automation: 'automated', minutes: 4,
    tags: ['security', 'authz', 'regression'],
    data: [{ field: 'role', value: 'customer' }],
    expected: 'HTTP 403 Forbidden',
    steps: [
      { action: 'GET /api/admin/reports dengan token peran customer', expected: 'HTTP 403 Forbidden' },
      { action: 'Pastikan respons tidak memuat data laporan', expected: 'Body tidak berisi data penjualan' },
    ],
  },
  {
    scenarioIndex: 2, title: 'Registrasi dengan format email tidak valid ditolak', objective: 'Menguji validasi format masukan.',
    pre: 'Tidak ada', type: 'negative', layer: 'api', priority: 'medium', severity: 'minor', engine: 'api', automation: 'automated', minutes: 3,
    tags: ['validation', 'negative'],
    data: [{ field: 'email', value: 'bukan-email' }],
    expected: 'HTTP 400 dengan pesan format email tidak valid',
    steps: [
      { action: 'POST /api/auth/register dengan email "bukan-email"', expected: 'HTTP 400 Bad Request' },
      { action: 'Periksa pesan validasi', expected: 'Menyebut format email' },
    ],
  },
  {
    scenarioIndex: 3, title: 'Kata sandi tepat 8 karakter diterima', objective: 'Menguji batas bawah aturan panjang kata sandi dari sisi positif.',
    pre: 'Tidak ada', type: 'boundary', layer: 'api', priority: 'medium', severity: 'minor', engine: 'api', automation: 'automated', minutes: 3,
    tags: ['boundary', 'validation'],
    data: [{ field: 'password', value: 'Abcd1234' }],
    expected: 'HTTP 201 Created',
    steps: [
      { action: 'POST registrasi dengan kata sandi tepat 8 karakter', expected: 'HTTP 201 Created' },
    ],
  },
  {
    scenarioIndex: 11, title: 'Kinerja pencarian di bawah 2 detik', objective: 'Memverifikasi anggaran waktu respons pencarian.',
    pre: 'Katalog berisi 10.000 produk', type: 'performance', layer: 'api', priority: 'medium', severity: 'major', engine: 'api', automation: 'to_be_automated', minutes: 10,
    tags: ['performance', 'search'],
    data: [{ field: 'threshold_ms', value: '2000' }],
    expected: 'Durasi respons kurang dari 2000 ms',
    steps: [
      { action: 'GET /api/mock/products?q=vitamin sebanyak 5 kali', expected: 'Semua permintaan selesai' },
      { action: 'Ukur durasi setiap permintaan', expected: 'durasi < 2000 ms' },
    ],
  },
  {
    scenarioIndex: 16, title: 'Checkout dengan keranjang kosong ditolak', objective: 'Menguji penanganan kondisi tidak valid pada checkout.',
    pre: 'Keranjang kosong', type: 'negative', layer: 'api', priority: 'high', severity: 'major', engine: 'api', automation: 'automated', minutes: 3,
    tags: ['checkout', 'negative'],
    data: [{ field: 'cart', value: '[]' }],
    expected: 'HTTP 400 dengan pesan keranjang kosong',
    steps: [
      { action: 'POST /api/mock/orders tanpa item', expected: 'HTTP 400 Bad Request' },
    ],
  },
  {
    scenarioIndex: 21, title: 'Non-admin ditolak mengakses ekspor laporan', objective: 'Menguji otorisasi pada fitur ekspor.',
    pre: 'Tersedia token pengguna biasa', type: 'security', layer: 'api', priority: 'high', severity: 'critical', engine: 'api', automation: 'automated', minutes: 3,
    tags: ['security', 'authz', 'reporting'],
    data: [{ field: 'endpoint', value: '/api/admin/reports/export' }],
    expected: 'HTTP 403 Forbidden',
    steps: [
      { action: 'GET /api/admin/reports/export dengan token customer', expected: 'HTTP 403 Forbidden' },
    ],
  },
  {
    scenarioIndex: 8, title: 'Token kedaluwarsa ditolak oleh sistem', objective: 'Memverifikasi masa berlaku token ditegakkan.',
    pre: 'Token kedaluwarsa tersedia', type: 'edge', layer: 'api', priority: 'high', severity: 'major', engine: 'manual', automation: 'to_be_automated', minutes: 6,
    tags: ['auth', 'edge', 'security'],
    data: [{ field: 'token_age', value: '24h1m' }],
    expected: 'HTTP 401 token kedaluwarsa',
    steps: [
      { action: 'Gunakan token yang diterbitkan 24 jam 1 menit lalu', expected: 'HTTP 401 Unauthorized' },
      { action: 'Periksa pesan error', expected: 'Menyebut token kedaluwarsa' },
    ],
  },
];

function seedTestCases(
  projectId: string,
  scenarioIds: string[],
  useCaseIds: string[],
): string[] {
  const ids: string[] = [];
  TEST_CASES.forEach((tc, i) => {
    const id = newId('tc_');
    const ts = nowIso();
    const sc = SCENARIOS[tc.scenarioIndex];
    const ucIndex = sc?.ucIndex ?? 0;
    const risk = riskScore({
      businessCriticality: tc.priority,
      usageFrequency: tc.priority === 'critical' ? 'always' : tc.priority === 'high' ? 'often' : 'sometimes',
      complexity: tc.layer === 'api' ? 'medium' : 'high',
      defectHistory: 0,
      lastRunFailed: false,
      isRegression: tc.tags.includes('regression') || tc.tags.includes('smoke'),
      hasAutomation: tc.automation === 'automated',
    });

    db.prepare(
      `INSERT INTO test_cases (id, project_id, scenario_id, use_case_id, code, title, objective,
                               preconditions, type, layer, priority, severity, automation_status, engine,
                               risk_score, estimated_minutes, tags, test_data, expected_result,
                               is_regression, status, generated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', 'manual', ?, ?)`,
    ).run(
      id,
      projectId,
      scenarioIds[tc.scenarioIndex] ?? null,
      useCaseIds[ucIndex] ?? null,
      `TC-${String(i + 1).padStart(3, '0')}`,
      tc.title,
      tc.objective,
      tc.pre,
      tc.type,
      tc.layer,
      tc.priority,
      tc.severity,
      tc.automation,
      tc.engine,
      risk.score,
      tc.minutes,
      toJson(tc.tags),
      toJson(tc.data),
      tc.expected,
      tc.tags.includes('regression') || tc.tags.includes('smoke') ? 1 : 0,
      ts,
      ts,
    );

    tc.steps.forEach((step, si) => {
      db.prepare(
        `INSERT INTO test_steps (id, test_case_id, order_index, action, expected, data, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      ).run(newId('stp_'), id, si + 1, step.action, step.expected, ts);
    });

    ids.push(id);
  });
  return ids;
}

/* --------------------------------------------------------- 6. matrix links */

function seedMatrixLinks(
  projectId: string,
  requirementIds: string[],
  useCaseIds: string[],
  scenarioIds: string[],
  testCaseIds: string[],
): number {
  const ts = nowIso();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO matrix_links (id, project_id, link_type, from_kind, from_id, to_kind, to_id,
                                         note, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'seed')`,
  );
  let count = 0;
  const link = (
    linkType: string,
    fromKind: string,
    fromId: string,
    toKind: string,
    toId: string,
  ) => {
    stmt.run(newId('mlk_'), projectId, linkType, fromKind, fromId, toKind, toId, ts);
    count++;
  };

  // requirement -> use case
  USE_CASES.forEach((uc, i) => {
    const reqId = requirementIds[uc.reqIndex];
    const ucId = useCaseIds[i];
    if (reqId && ucId) link('requirement_to_usecase', 'requirement', reqId, 'usecase', ucId);
  });
  // use case -> scenario
  SCENARIOS.forEach((sc, i) => {
    const ucId = useCaseIds[sc.ucIndex];
    const scId = scenarioIds[i];
    if (ucId && scId) link('usecase_to_scenario', 'usecase', ucId, 'scenario', scId);
  });
  // scenario -> test case, and the derived requirement -> test case shortcut
  TEST_CASES.forEach((tc, i) => {
    const scId = scenarioIds[tc.scenarioIndex];
    const tcId = testCaseIds[i];
    const ucIndex = SCENARIOS[tc.scenarioIndex]?.ucIndex ?? 0;
    const ucId = useCaseIds[ucIndex];
    if (scId && tcId) link('scenario_to_testcase', 'scenario', scId, 'testcase', tcId);
    if (ucId && tcId) link('usecase_to_testcase' as never, 'usecase', ucId, 'testcase', tcId);
    const reqId = requirementIds[USE_CASES[ucIndex]?.reqIndex ?? 0];
    if (reqId && tcId) link('requirement_to_testcase', 'requirement', reqId, 'testcase', tcId);
  });

  return count;
}

/* ------------------------------------------------ 7. environments & data */

function seedEnvironment(projectId: string): string {
  const id = newId('env_');
  const ts = nowIso();
  db.prepare(
    `INSERT INTO environments (id, project_id, name, base_url, db_uri, api_base, kind, variables,
                               is_default, notes, created_at, updated_at)
     VALUES (?, ?, 'Demo — Local (offline)', ?, ?, ?, 'local', ?, 1, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    'http://127.0.0.1:5174',
    'apps/api/data/qatools-demo.db',
    'http://127.0.0.1:5174/api/mock',
    toJson({ DEMO_USER: 'admin', DEMO_PASS: 'secret', TIMEOUT_MS: '5000' }),
    'Environment demo memakai mock bawaan QATools (/api/mock/*) sehingga pengujian berjalan tanpa internet.',
    ts,
    ts,
  );

  // A second environment so the Environment page has something to compare.
  db.prepare(
    `INSERT INTO environments (id, project_id, name, base_url, db_uri, api_base, kind, variables,
                               is_default, notes, created_at, updated_at)
     VALUES (?, ?, 'Demo — Staging', ?, NULL, ?, 'staging', ?, 0, ?, ?, ?)`,
  ).run(
    newId('env_'),
    projectId,
    'https://staging.sehatku.example.id',
    'https://staging.sehatku.example.id/api',
    toJson({ DEMO_USER: 'staging_admin', TIMEOUT_MS: '10000' }),
    'Environment staging contoh (tidak dipakai oleh test otomatis demo).',
    ts,
    ts,
  );

  // Test data set
  db.prepare(
    `INSERT INTO test_data_sets (id, project_id, environment_id, name, description, columns, rows,
                                 generated_by, created_at, updated_at)
     VALUES (?, ?, ?, 'Data uji login & checkout', ?, ?, ?, 'manual', ?, ?)`,
  ).run(
    newId('tds_'),
    projectId,
    id,
    'Kombinasi kredensial dan item pesanan untuk pengujian manual maupun otomatis.',
    toJson(['username', 'password', 'expected', 'product_id', 'quantity']),
    toJson([
      { username: 'admin', password: 'secret', expected: '200', product_id: 'prod_001', quantity: '1' },
      { username: 'admin', password: 'salah', expected: '401', product_id: 'prod_001', quantity: '1' },
      { username: 'admin', password: 'secret', expected: '201', product_id: 'prod_002', quantity: '2' },
      { username: 'admin', password: 'secret', expected: '400', product_id: '', quantity: '0' },
    ]),
    ts,
    ts,
  );

  return id;
}

/* ------------------------------------------- 8. API collection & requests */

function seedApiArtifacts(projectId: string, testCaseIds: string[], environmentId: string): string {
  const ts = nowIso();
  const collectionId = newId('col_');
  db.prepare(
    `INSERT INTO api_collections (id, project_id, name, description, base_url, auth_type, auth_config,
                                  variables, created_at, updated_at)
     VALUES (?, ?, 'Mock QATools API', ?, 'http://127.0.0.1:5174/api/mock', 'none', NULL, ?, ?, ?)`,
  ).run(
    collectionId,
    projectId,
    'Koleksi contoh yang menembak mock bawaan QATools, jadi bisa dijalankan tanpa internet.',
    toJson({ q: 'vitamin', userId: 'usr_A' }),
    ts,
    ts,
  );

  const requests: Array<{
    tcIndex: number | null;
    name: string;
    method: string;
    path: string;
    body: string | null;
    bodyType: 'json' | 'none';
    assertions: unknown[];
    headers?: Record<string, string>;
  }> = [
    {
      tcIndex: 3,
      name: 'Login berhasil (mock)',
      method: 'POST',
      path: '/login',
      body: toJson({ username: 'admin', password: 'secret' }),
      bodyType: 'json',
      headers: { 'Content-Type': 'application/json' },
      assertions: [
        { source: 'status', operator: 'equals', expected: 200, message: 'Status harus 200' },
        { source: 'jsonpath', path: '$.data.token', operator: 'exists', message: 'Token harus ada di $.data.token' },
      ],
    },
    {
      tcIndex: 4,
      name: 'Login gagal — kata sandi salah (mock)',
      method: 'POST',
      path: '/login',
      body: toJson({ username: 'admin', password: 'salah-sekali' }),
      bodyType: 'json',
      headers: { 'Content-Type': 'application/json' },
      assertions: [
        { source: 'status', operator: 'equals', expected: 401, message: 'Status harus 401' },
        { source: 'jsonpath', path: '$.data.token', operator: 'not_exists', message: 'Tidak boleh ada token' },
      ],
    },
    {
      tcIndex: 6,
      name: 'Cari produk (mock)',
      method: 'GET',
      path: '/products',
      body: null,
      bodyType: 'none',
      assertions: [
        { source: 'status', operator: 'equals', expected: 200 },
        { source: 'jsonpath', path: '$.data', operator: 'length_gte', expected: 1, message: 'Minimal 1 produk' },
      ],
    },
    {
      tcIndex: 7,
      name: 'Cari produk tanpa hasil (mock)',
      method: 'GET',
      path: '/products?q=zzzqqq',
      body: null,
      bodyType: 'none',
      assertions: [
        { source: 'status', operator: 'equals', expected: 200 },
        { source: 'jsonpath', path: '$.data', operator: 'length_lte', expected: 0, message: 'Hasil harus kosong' },
      ],
    },
    {
      tcIndex: 11,
      name: 'Buat pesanan (mock)',
      method: 'POST',
      path: '/orders',
      // Field names must match the mock contract: product_id / quantity.
      // Product ids in the mock are `prod_*` (not `prd_*`), and prod_004 has zero stock.
      body: toJson({ product_id: 'prod_001', quantity: 2 }),
      bodyType: 'json',
      headers: { 'Content-Type': 'application/json' },
      assertions: [
        { source: 'status', operator: 'equals', expected: 201 },
        { source: 'jsonpath', path: '$.data.id', operator: 'exists', message: 'id pesanan harus ada' },
        { source: 'jsonpath', path: '$.data.status', operator: 'equals', expected: 'created' },
      ],
    },
    {
      tcIndex: 13,
      name: 'Riwayat pesanan pengguna (mock)',
      method: 'GET',
      path: '/orders',
      body: null,
      bodyType: 'none',
      assertions: [
        { source: 'status', operator: 'equals', expected: 200 },
        { source: 'jsonpath', path: '$.data', operator: 'exists', message: 'daftar pesanan harus ada' },
        { source: 'jsonpath', path: '$.total', operator: 'gte', expected: 0, message: 'total pesanan harus >= 0' },
      ],
    },
    {
      tcIndex: 18,
      name: 'Endpoint admin tanpa token harus 401',
      method: 'GET',
      path: '/admin/reports',
      body: null,
      bodyType: 'none',
      assertions: [
        { source: 'status', operator: 'in', expected: [401, 403], message: 'Harus ditolak' },
      ],
    },
    {
      tcIndex: 19,
      name: 'Endpoint admin dengan token customer harus 403',
      method: 'GET',
      path: '/admin/reports',
      body: null,
      bodyType: 'none',
      headers: { 'X-Role': 'customer' },
      assertions: [{ source: 'status', operator: 'in', expected: [401, 403] }],
    },
    {
      tcIndex: 20,
      name: 'Kinerja pencarian < 2000 ms',
      method: 'GET',
      path: '/products?q=vitamin',
      body: null,
      bodyType: 'none',
      assertions: [
        { source: 'status', operator: 'equals', expected: 200 },
        { source: 'duration', operator: 'lt', expected: 2000, message: 'Harus di bawah 2 detik' },
      ],
    },
    {
      tcIndex: 21,
      name: 'Checkout keranjang kosong ditolak',
      method: 'POST',
      path: '/orders',
      body: toJson({}),
      bodyType: 'json',
      headers: { 'Content-Type': 'application/json' },
      assertions: [{ source: 'status', operator: 'in', expected: [400, 422] }],
    },
    {
      tcIndex: null,
      name: 'Health check mock',
      method: 'GET',
      path: '/health',
      body: null,
      bodyType: 'none',
      assertions: [{ source: 'status', operator: 'equals', expected: 200 }],
    },
    {
      tcIndex: null,
      name: 'Produk lambat (uji timeout)',
      method: 'GET',
      path: '/slow?ms=300',
      body: null,
      bodyType: 'none',
      assertions: [{ source: 'status', operator: 'equals', expected: 200 }],
    },
  ];

  requests.forEach((r) => {
    db.prepare(
      `INSERT INTO api_requests (id, collection_id, project_id, test_case_id, name, method, path,
                                 headers, query, body, body_type, assertions, pre_script, post_script,
                                 generated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, 'manual', ?, ?)`,
    ).run(
      newId('apr_'),
      collectionId,
      projectId,
      r.tcIndex === null ? null : (testCaseIds[r.tcIndex] ?? null),
      r.name,
      r.method,
      r.path,
      r.headers ? toJson(r.headers) : null,
      r.body,
      r.bodyType,
      toJson(r.assertions),
      ts,
      ts,
    );
  });

  void environmentId;
  return collectionId;
}

/* ------------------------------------------------- 9. db connections/checks */

function seedDbArtifacts(projectId: string, testCaseIds: string[]): void {
  const ts = nowIso();
  const connectionId = newId('dbc_');

  // A self-contained demo SQLite database created on the fly so the DB engine has a real target.
  const demoDbPath = 'apps/api/data/qatools-demo-sample.db';
  db.prepare(
    `INSERT INTO db_connections (id, project_id, name, dialect, dsn_masked, dsn, readonly_guard,
                                 created_by, created_at, updated_at)
     VALUES (?, ?, 'Demo Sample SQLite', 'sqlite', ?, ?, 1, 'seed', ?, ?)`,
  ).run(connectionId, projectId, demoDbPath, demoDbPath, ts, ts);

  const checks: Array<{ tcIndex: number | null; name: string; sql: string; assertions: unknown[] }> = [
    {
      tcIndex: 8,
      name: 'Terdapat user aktif di database',
      sql: 'SELECT COUNT(*) AS total FROM users WHERE active = 1',
      assertions: [
        { source: 'column', path: 'total', operator: 'gt', expected: 0, message: 'Harus ada user aktif' },
      ],
    },
    {
      tcIndex: 8,
      name: 'Email user harus unik (tidak ada duplikat)',
      sql: 'SELECT COUNT(*) AS dup FROM (SELECT email FROM users GROUP BY email HAVING COUNT(*) > 1)',
      assertions: [{ source: 'column', path: 'dup', operator: 'equals', expected: 0 }],
    },
    {
      tcIndex: 9,
      name: 'Tidak ada stok negatif',
      sql: 'SELECT COUNT(*) AS bad FROM products WHERE stock < 0',
      assertions: [{ source: 'column', path: 'bad', operator: 'equals', expected: 0, message: 'Stok tidak boleh negatif' }],
    },
    {
      tcIndex: 9,
      name: 'Stok minimum tidak negatif',
      sql: 'SELECT MIN(stock) AS min_stock FROM products',
      assertions: [{ source: 'column', path: 'min_stock', operator: 'gte', expected: 0 }],
    },
    {
      tcIndex: 15,
      name: 'Total pesanan konsisten dengan item pesanan',
      sql: `SELECT COUNT(*) AS mismatch
            FROM orders o
            WHERE o.total <> (SELECT IFNULL(SUM(oi.qty * oi.price), 0) FROM order_items oi WHERE oi.order_id = o.id)`,
      assertions: [{ source: 'column', path: 'mismatch', operator: 'equals', expected: 0, message: 'Total pesanan harus konsisten' }],
    },
    {
      tcIndex: null,
      name: 'Jumlah pesanan per status terhitung',
      sql: 'SELECT status, COUNT(*) AS jumlah FROM orders GROUP BY status ORDER BY jumlah DESC',
      assertions: [{ source: 'row_count', operator: 'gte', expected: 0 }],
    },
  ];

  checks.forEach((c) => {
    db.prepare(
      `INSERT INTO db_checks (id, project_id, connection_id, test_case_id, name, sql, assertions,
                              setup_sql, teardown_sql, generated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'manual', ?, ?)`,
    ).run(
      newId('dbc_'), // ARCHITECTURE.md §5.3 (amended v1.1): dbc_ = db_checks
      projectId,
      connectionId,
      c.tcIndex === null ? null : (testCaseIds[c.tcIndex] ?? null),
      c.name,
      c.sql,
      toJson(c.assertions),
      ts,
      ts,
    );
  });
}

/* ---------------------------------------------------------- 10. web flows */

function seedWebArtifacts(projectId: string, testCaseIds: string[]): void {
  const ts = nowIso();
  const flows: Array<{ tcIndex: number | null; name: string; url: string; steps: unknown[] }> = [
    {
      tcIndex: 10,
      name: 'Alur login dan cek keranjang bertahan',
      url: 'http://127.0.0.1:5174/api/mock/health',
      steps: [
        { action: 'goto', value: 'http://127.0.0.1:5174/api/mock/health', description: 'Buka target' },
        { action: 'assert_text', selector: 'body', expected: 'ok', description: 'Halaman target merespons' },
        { action: 'screenshot', description: 'Ambil bukti tangkapan layar' },
      ],
    },
    {
      tcIndex: null,
      name: 'Smoke ketersediaan mock QATools',
      url: 'http://127.0.0.1:5174/api/mock/health',
      steps: [
        { action: 'goto', value: 'http://127.0.0.1:5174/api/mock/health' },
        { action: 'assert_visible', selector: 'body' },
      ],
    },
    {
      tcIndex: null,
      name: 'Halaman produk memuat daftar',
      url: 'http://127.0.0.1:5174/api/mock/products',
      steps: [
        { action: 'goto', value: 'http://127.0.0.1:5174/api/mock/products' },
        { action: 'assert_text', selector: 'body', expected: 'data' },
      ],
    },
  ];

  flows.forEach((f) => {
    db.prepare(
      `INSERT INTO web_flows (id, project_id, test_case_id, name, start_url, steps, viewport,
                              generated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
    ).run(
      newId('wbf_'),
      projectId,
      f.tcIndex === null ? null : (testCaseIds[f.tcIndex] ?? null),
      f.name,
      f.url,
      toJson(f.steps),
      toJson({ width: 1440, height: 900 }),
      ts,
      ts,
    );
  });
}

/* ------------------------------------------- 11. cycle, sprints and scope */

function seedPlanning(
  projectId: string,
  testCaseIds: string[],
): { cycleId: string; sprintIds: string[] } {
  const ts = nowIso();
  const cycleId = newId('cyc_');
  db.prepare(
    `INSERT INTO cycles (id, project_id, code, name, goal, start_date, end_date, status,
                         entry_criteria, exit_criteria, created_at, updated_at)
     VALUES (?, ?, 'CYC-2026-Q1', 'Regresi Rilis v1.0 Sehatku', ?, ?, ?, 'active', ?, ?, ?, ?)`,
  ).run(
    cycleId,
    projectId,
    'Membuktikan kesiapan rilis v1.0 dengan cakupan kebutuhan minimal 90% dan tanpa defect blocker terbuka.',
    iso(daysAgo(21)),
    iso(daysAhead(21)),
    toJson([
      'Semua kebutuhan prioritas critical sudah memiliki test case',
      'Environment uji siap dan dapat diakses',
      'Build kandidat rilis tersedia',
    ]),
    toJson([
      'Requirement coverage minimal 90%',
      'Regression suite pass rate minimal 90%',
      'Tidak ada defect severity blocker/critical berstatus terbuka',
      'Semua test case prioritas critical sudah dieksekusi',
    ]),
    ts,
    ts,
  );

  const sprintDefs = [
    { code: 'SPR-01', name: 'Sprint 1 — Fondasi Autentikasi', goal: 'Menuntaskan pengujian registrasi dan login.', start: daysAgo(21), end: daysAgo(7), capacity: 40, status: 'completed' },
    { code: 'SPR-02', name: 'Sprint 2 — Katalog & Keranjang', goal: 'Menuntaskan pengujian pencarian dan keranjang.', start: daysAgo(7), end: daysAhead(0), capacity: 40, status: 'active' },
    { code: 'SPR-03', name: 'Sprint 3 — Checkout & Keamanan', goal: 'Checkout, otorisasi, dan ekspor laporan.', start: daysAhead(0), end: daysAhead(14), capacity: 32, status: 'planned' },
  ];

  const sprintIds: string[] = [];
  sprintDefs.forEach((s) => {
    const id = newId('spr_');
    db.prepare(
      `INSERT INTO sprints (id, cycle_id, project_id, code, name, goal, start_date, end_date,
                            capacity_points, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, cycleId, projectId, s.code, s.name, s.goal, iso(s.start), iso(s.end), s.capacity, s.status, ts, ts);
    sprintIds.push(id);
  });

  // Distribute test cases across sprints by their layer/theme, then add a couple to sprint 3.
  const assignees = ['Rina (QA)', 'Bagus (QA)', 'Sari (QA)', 'Yogi (Lead QA)'];
  testCaseIds.forEach((tcId, i) => {
    const sprintIdx = i < 9 ? 0 : i < 17 ? 1 : 2;
    const sprintId = sprintIds[sprintIdx];
    if (!sprintId) return;
    const row = db.prepare('SELECT estimated_minutes FROM test_cases WHERE id = ?').get(tcId) as
      | { estimated_minutes: number }
      | undefined;
    db.prepare(
      `INSERT OR IGNORE INTO sprint_scope (id, sprint_id, test_case_id, assignee, estimate_minutes,
                                           status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId('scp_'),
      sprintId,
      tcId,
      assignees[i % assignees.length],
      row?.estimated_minutes ?? 10,
      sprintIdx === 0 ? 'done' : sprintIdx === 1 ? 'in_progress' : 'todo',
      ts,
      ts,
    );
  });

  return { cycleId, sprintIds };
}

/* -------------------------------------- 12. runs, results and defects */

function seedRunsAndDefects(
  projectId: string,
  cycleId: string,
  sprintIds: string[],
  environmentId: string,
  testCaseIds: string[],
): { defectIds: string[] } {
  const ts = nowIso();

  /** Deterministic pseudo-random so the demo is stable across runs. */
  let seed = 20261121;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const runPlan: Array<{
    name: string;
    kind: string;
    engine: string;
    daysAgo: number;
    cases: number[];
    passRate: number;
  }> = [
    { name: 'Smoke Test Sprint 1', kind: 'smoke', engine: 'api', daysAgo: 18, cases: [0, 3, 6, 11, 16], passRate: 1.0 },
    { name: 'Fungsional Sprint 1', kind: 'manual', engine: 'manual', daysAgo: 14, cases: [0, 1, 2, 4, 5], passRate: 0.8 },
    { name: 'Regresi Sprint 1', kind: 'regression', engine: 'api', daysAgo: 10, cases: [0, 3, 4, 6, 7, 11, 13, 16, 18, 19, 20, 21], passRate: 0.83 },
    { name: 'Fungsional Sprint 2', kind: 'manual', engine: 'manual', daysAgo: 6, cases: [3, 6, 7, 12, 14, 15, 17], passRate: 0.86 },
    { name: 'Database Integrity Check', kind: 'automation', engine: 'db', daysAgo: 4, cases: [8, 9, 15], passRate: 1.0 },
    { name: 'Regresi Sprint 2', kind: 'regression', engine: 'api', daysAgo: 2, cases: [0, 3, 4, 6, 7, 8, 9, 11, 13, 15, 16, 18, 19, 20, 21], passRate: 0.87 },
    { name: 'Smoke Kandidat Rilis v1.0', kind: 'smoke', engine: 'api', daysAgo: 1, cases: [0, 3, 6, 16, 18], passRate: 1.0 },
  ];

  const defectSeed: Array<{
    title: string;
    description: string;
    severity: string;
    priority: Priority;
    status: string;
    tcIndex: number;
    source: string;
    escaped?: boolean;
  }> = [];

  const runIds: string[] = [];

  runPlan.forEach((plan, ri) => {
    const runId = newId('run_');
    const startedAt = daysAgo(plan.daysAgo);
    const durationMs = plan.cases.reduce((acc, ci) => {
      const row = db.prepare('SELECT estimated_minutes FROM test_cases WHERE id = ?').get(testCaseIds[ci] ?? '') as
        | { estimated_minutes: number }
        | undefined;
      return acc + (row?.estimated_minutes ?? 5) * 1000;
    }, 0);

    db.prepare(
      `INSERT INTO test_runs (id, project_id, cycle_id, sprint_id, environment_id, code, name, kind,
                              engine, status, started_at, finished_at, executed_by, notes,
                              total, passed, failed, blocked, skipped, duration_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?)`,
    ).run(
      runId,
      projectId,
      cycleId,
      ri < 3 ? sprintIds[0] : ri < 5 ? sprintIds[1] : sprintIds[2],
      environmentId,
      `RUN-${String(ri + 1).padStart(4, '0')}`,
      plan.name,
      plan.kind,
      plan.engine,
      iso(startedAt),
      iso(new Date(startedAt.getTime() + 30 * 60 * 1000)),
      'Yogi (Lead QA)',
      `Seed demo run #${ri + 1}`,
      plan.cases.length,
      durationMs,
      iso(startedAt),
      ts,
    );
    runIds.push(runId);

    let passed = 0;
    let failed = 0;
    plan.cases.forEach((ci) => {
      const tcId = testCaseIds[ci];
      if (!tcId) return;
      const roll = rnd();
      let status: string;
      if (roll < plan.passRate) status = 'passed';
      else if (roll < plan.passRate + 0.1) status = 'blocked';
      else status = 'failed';

      if (status === 'passed') passed++;
      else if (status === 'failed') failed++;

      const row = db.prepare('SELECT code, title, estimated_minutes FROM test_cases WHERE id = ?').get(tcId) as
        | { code: string; title: string; estimated_minutes: number }
        | undefined;
      const caseDuration = (row?.estimated_minutes ?? 5) * 1000;

      db.prepare(
        `INSERT OR REPLACE INTO run_results (id, run_id, test_case_id, status, engine, duration_ms,
                                             actual_result, error_message, evidence, executed_by,
                                             executed_at, defect_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      ).run(
        newId('res_'),
        runId,
        tcId,
        status,
        plan.engine,
        caseDuration,
        status === 'passed'
          ? 'Hasil sesuai harapan.'
          : status === 'blocked'
            ? 'Pengujian terblokir karena data uji belum tersedia.'
            : 'Hasil tidak sesuai harapan.',
        status === 'failed'
          ? 'Assertion gagal: nilai aktual berbeda dengan nilai yang diharapkan.'
          : null,
        toJson({
          engine: plan.engine,
          assertions: status === 'failed' ? [{ passed: false, message: 'Diharapkan 200, diterima 500' }] : [{ passed: true }],
        }),
        'Yogi (Lead QA)',
        iso(new Date(startedAt.getTime() + caseDuration)),
        iso(startedAt),
        ts,
      );

      // Record a defect the first time a distinct case fails, so the tracker has realistic data.
      if (status === 'failed' && !defectSeed.some((d) => d.tcIndex === ci)) {
        defectSeed.push({
          title: `Kegagalan pada ${row?.code ?? 'test case'}: ${row?.title ?? ''}`,
          description:
            'Ditemukan saat eksekusi suite demo. Langkah reproduksi mengikuti langkah test case terkait.',
          severity: ci === 11 || ci === 16 ? 'blocker' : ci === 4 || ci === 18 ? 'critical' : 'major',
          priority: ci === 11 || ci === 16 ? 'critical' : 'high',
          status: ri >= 5 ? 'in_progress' : 'verified',
          tcIndex: ci,
          source: plan.engine === 'db' ? 'db' : plan.engine === 'api' ? 'api' : 'manual',
        });
      }
    });

    db.prepare(
      `UPDATE test_runs SET passed = ?, failed = ?, blocked = ?, skipped = ?, updated_at = ? WHERE id = ?`,
    ).run(passed, failed, plan.cases.length - passed - failed, 0, ts, runId);
  });

  // A defect that escaped to production — exercises defect_leakage_pct.
  defectSeed.push({
    title: 'Total pesanan tidak konsisten setelah diskon voucher',
    description:
      'Ditemukan oleh tim Finance di production: total pesanan tidak memperhitungkan pembulatan diskon voucher.',
    severity: 'critical',
    priority: 'critical',
    status: 'in_progress',
    tcIndex: 15,
    source: 'manual',
    escaped: true,
  });

  const defectIds: string[] = [];
  defectSeed.forEach((d, i) => {
    const id = newId('bug_');
    // Only reference the test case if the id actually exists — a dangling FK would abort the seed.
    const candidateTc = testCaseIds[d.tcIndex] ?? null;
    const tcExists =
      candidateTc &&
      db.prepare('SELECT 1 AS ok FROM test_cases WHERE id = ?').get(candidateTc) !== undefined;
    const tcId = tcExists ? candidateTc : null;
    const row = db.prepare('SELECT title, objective FROM test_cases WHERE id = ?').get(tcId ?? '') as
      | { title: string; objective: string }
      | undefined;
    const createdAt = daysAgo(Math.max(1, 12 - i));
    db.prepare(
      `INSERT INTO defects (id, project_id, code, title, description, steps_to_reproduce, expected_result,
                            actual_result, severity, priority, status, source, test_case_id, run_result_id,
                            environment_id, assignee, reporter, found_in_cycle_id, fixed_in_build,
                            is_escaped, ai_triage, closed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    ).run(
      id,
      projectId,
      `BUG-${String(i + 1).padStart(3, '0')}`,
      d.title,
      d.description,
      toJson([
        `Jalankan test case ${row?.title ?? 'terkait'}`,
        'Amati nilai aktual pada respons/antarmuka',
        'Bandingkan dengan hasil yang diharapkan',
      ]),
      row?.objective ?? 'Hasil sesuai dengan yang didefinisikan pada test case.',
      'Perilaku menyimpang dari yang diharapkan.',
      d.severity,
      d.priority,
      d.status,
      d.source,
      tcId,
      // run_result_id -> NULL in SQL (defects are linked to a test case, not one result row)
      environmentId,
      i % 2 === 0 ? 'Bagus (Dev)' : 'Rina (Dev)',
      'Yogi (Lead QA)',
      cycleId,
      d.status === 'verified' ? 'v1.0.0-rc1' : null,
      d.escaped ? 1 : 0,
      // ai_triage -> NULL in SQL
      d.status === 'verified' ? iso(createdAt) : null,
      iso(createdAt),
      ts,
    );
    defectIds.push(id);
  });

  return { defectIds };
}

/* ------------------------------------------------- 13. activity digest */

function seedActivity(projectId: string): void {
  const entries: Array<{ action: string; kind: string; summary: string; days: number }> = [
    { action: 'project.create', kind: 'project', summary: 'Project demo dibuat', days: 30 },
    { action: 'requirement.create', kind: 'requirement', summary: '8 kebutuhan ditambahkan dari Product Owner', days: 29 },
    { action: 'usecase.generate', kind: 'usecase', summary: '8 use case disusun dari kebutuhan', days: 27 },
    { action: 'scenario.generate', kind: 'scenario', summary: '24 skenario diturunkan dari use case', days: 25 },
    { action: 'testcase.generate', kind: 'testcase', summary: '24 test case dirancang beserta langkahnya', days: 24 },
    { action: 'matrix.sync', kind: 'matrix', summary: 'Traceability matrix disinkronkan', days: 23 },
    { action: 'cycle.create', kind: 'cycle', summary: 'Cycle CYC-2026-Q1 dibuka', days: 21 },
    { action: 'run.complete', kind: 'run', summary: 'Smoke test Sprint 1 selesai 100% lulus', days: 18 },
    { action: 'defect.create', kind: 'defect', summary: 'Defect pertama dilaporkan dari fungsional Sprint 1', days: 14 },
    { action: 'regression.plan', kind: 'regression', summary: 'Rencana regresi berbasis risiko dibuat', days: 10 },
    { action: 'metrics.snapshot', kind: 'metrics', summary: 'Snapshot metrik QA diperbarui', days: 3 },
    { action: 'run.complete', kind: 'run', summary: 'Smoke kandidat rilis v1.0 selesai 100% lulus', days: 1 },
  ];
  entries.forEach((e) => {
    db.prepare(
      `INSERT INTO activity_log (id, project_id, actor, action, entity_kind, entity_id, summary, created_at)
       VALUES (?, ?, 'Yogi (Lead QA)', ?, ?, NULL, ?, ?)`,
    ).run(newId('act_'), projectId, e.action, e.kind, e.summary, iso(daysAgo(e.days)));
  });
}

/* ------------------------------------------------------ 14. sample sqlite */

/**
 * Creates a small standalone SQLite database that the Database Testing engine can
 * point at, so the demo has a REAL database target without any extra setup.
 */
function createSampleDatabase(): string {
  const path = resolveDataPath('qatools-demo-sample.db');
  const sample = new DatabaseSync(path);

  sample.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1, role TEXT NOT NULL DEFAULT 'customer'
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      price REAL NOT NULL, stock INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL,
      status TEXT NOT NULL, total REAL NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
      qty INTEGER NOT NULL, price REAL NOT NULL
    );
  `);

  const userCount = (sample.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (userCount === 0) {
    const users = [
      [1, 'Admin Sehatku', 'admin@sehatku.example.id', 1, 'admin'],
      [2, 'Budi Santoso', 'budi@example.id', 1, 'customer'],
      [3, 'Siti Aminah', 'siti@example.id', 1, 'customer'],
      [4, 'Rudi Nonaktif', 'rudi@example.id', 0, 'customer'],
      [5, 'Dewi Lestari', 'dewi@example.id', 1, 'customer'],
    ];
    const insUser = sample.prepare('INSERT INTO users (id,name,email,active,role) VALUES (?,?,?,?,?)');
    users.forEach((u) => insUser.run(...(u as never[])));

    const products = [
      [1, 'VIT-C-1000', 'Vitamin C 1000mg', 85000, 42],
      [2, 'OMG-3-60', 'Omega 3 Fish Oil 60 kapsul', 145000, 18],
      [3, 'MSC-500', 'Masker Medis 500 pcs', 95000, 0],
      [4, 'SND-01', 'Hand Sanitizer 100ml', 25000, 120],
      [5, 'VIT-D-500', 'Vitamin D3 500IU', 67000, 7],
    ];
    const insProduct = sample.prepare('INSERT INTO products (id,sku,name,price,stock) VALUES (?,?,?,?,?)');
    products.forEach((p) => insProduct.run(...(p as never[])));

    const insOrder = sample.prepare('INSERT INTO orders (id,code,user_id,status,total,created_at) VALUES (?,?,?,?,?,?)');
    const insItem = sample.prepare('INSERT INTO order_items (id,order_id,product_id,qty,price) VALUES (?,?,?,?,?)');
    const statuses = ['paid', 'shipped', 'pending', 'paid', 'cancelled', 'delivered'];

    let itemId = 1;
    statuses.forEach((status, i) => {
      const orderId = i + 1;
      const qty = (i % 3) + 1;
      const product = products[i % products.length] as number[];
      const price = product[3] as number;
      const total = qty * price;
      insOrder.run(orderId, `ORD-${String(orderId).padStart(4, '0')}`, (i % 4) + 1, status, total, iso(daysAgo(30 - i * 5)));
      insItem.run(itemId++, orderId, product[0] as number, qty, price);
      if (i % 2 === 0) {
        const extra = products[(i + 2) % products.length] as number[];
        insItem.run(itemId++, orderId, extra[0] as number, 1, extra[3] as number);
      }
    });
  }

  sample.close();
  return path;
}

function resolveDataPath(file: string): string {
  const apiRoot = fileURLToPath(new URL('../../', import.meta.url)); // apps/api/
  const full = resolve(apiRoot, 'data', file);
  mkdirSync(dirname(full), { recursive: true });
  return full;
}

/* ------------------------------------------------------------- main flow */

export interface DemoSeedResult {
  projectId: string;
  counts: Record<string, number>;
  sampleDbPath: string;
}

export function seedDemoProject(): DemoSeedResult {
  let projectId = existingProject();
  if (projectId) {
    wipe(projectId);
  }
  projectId = seedProject();

  const sampleDbPath = createSampleDatabase();

  const ctx: SeedContext = {
    projectId,
    requirementIds: seedRequirements(projectId),
    useCaseIds: [],
    scenarioIds: [],
    testCaseIds: [],
    cycleId: '',
    sprintIds: [],
    environmentId: '',
    collectionId: '',
    defectIds: [],
  };

  ctx.useCaseIds = seedUseCases(projectId);
  ctx.scenarioIds = seedScenarios(projectId, ctx.useCaseIds);
  ctx.testCaseIds = seedTestCases(projectId, ctx.scenarioIds, ctx.useCaseIds);
  const linkCount = seedMatrixLinks(
    projectId,
    ctx.requirementIds,
    ctx.useCaseIds,
    ctx.scenarioIds,
    ctx.testCaseIds,
  );
  ctx.environmentId = seedEnvironment(projectId);
  ctx.collectionId = seedApiArtifacts(projectId, ctx.testCaseIds, ctx.environmentId);
  seedDbArtifacts(projectId, ctx.testCaseIds);
  seedWebArtifacts(projectId, ctx.testCaseIds);
  const plan = seedPlanning(projectId, ctx.testCaseIds);
  ctx.cycleId = plan.cycleId;
  ctx.sprintIds = plan.sprintIds;
  const { defectIds } = seedRunsAndDefects(
    projectId,
    ctx.cycleId,
    ctx.sprintIds,
    ctx.environmentId,
    ctx.testCaseIds,
  );
  ctx.defectIds = defectIds;
  seedActivity(projectId);

  const count = (table: string): number =>
    Number(
      (
        db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`).get(projectId) as {
          n: number;
        }
      ).n,
    );

  const counts: Record<string, number> = {
    requirements: count('requirements'),
    use_cases: count('use_cases'),
    scenarios: count('scenarios'),
    test_cases: count('test_cases'),
    test_steps: Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM test_steps s JOIN test_cases t ON t.id = s.test_case_id WHERE t.project_id = ?`,
          )
          .get(projectId) as { n: number }
      ).n,
    ),
    matrix_links: linkCount,
    environments: count('environments'),
    test_data_sets: count('test_data_sets'),
    api_requests: count('api_requests'),
    db_checks: count('db_checks'),
    web_flows: count('web_flows'),
    cycles: count('cycles'),
    sprints: count('sprints'),
    sprint_scope: Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM sprint_scope sc JOIN sprints sp ON sp.id = sc.sprint_id WHERE sp.project_id = ?`,
          )
          .get(projectId) as { n: number }
      ).n,
    ),
    test_runs: count('test_runs'),
    run_results: Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM run_results r JOIN test_runs t ON t.id = r.run_id WHERE t.project_id = ?`,
          )
          .get(projectId) as { n: number }
      ).n,
    ),
    defects: count('defects'),
    activity_log: count('activity_log'),
  };

  return { projectId, counts, sampleDbPath };
}

/* Optional: also seed the curriculum if lane-learn's seeder is present.
 * The module specifier is built at runtime so a missing file is a catchable error
 * rather than a compile-time/resolution-time failure.
 * `seedCurriculum` lives in `curriculum-seed.ts` (the data lives in curriculum.ts). */
async function maybeSeedCurriculum(): Promise<string> {
  const specifier = './curriculum-seed.js';
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      seedCurriculum?: (opts?: { strict?: boolean; quiet?: boolean }) => unknown;
    };
    if (typeof mod.seedCurriculum === 'function') {
      mod.seedCurriculum({ quiet: true });
      return 'curriculum seeded (9 courses / 32 modules / 101 lessons)';
    }
    return 'curriculum module found but no seedCurriculum() export — skipped';
  } catch (err) {
    return `curriculum seeding skipped: ${err instanceof Error ? err.message : String(err)}`;
  }
}

const isMain =
  process.argv[1] && (process.argv[1].endsWith('demo.ts') || process.argv[1].endsWith('demo.js'));

if (isMain) {
  migrate();
  const force = process.argv.includes('--force');
  if (existingProject() && !force) {
    // Rebuild anyway: the seeder is idempotent by replacing the demo project.
    console.log('Demo project sudah ada — membangun ulang (idempoten). Gunakan --force untuk senyap.');
  }
  const result = seedDemoProject();
  const curriculumNote = await maybeSeedCurriculum();

  console.log('\n=== QATools demo seed selesai ===');
  console.log(`project_id : ${result.projectId}`);
  console.log(`sample db  : ${result.sampleDbPath}`);
  for (const [k, v] of Object.entries(result.counts)) {
    console.log(`  ${k.padEnd(16)} ${v}`);
  }
  console.log(`curriculum : ${curriculumNote}`);
  console.log('=== selesai ===\n');
}
