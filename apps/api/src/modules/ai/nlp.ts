/**
 * Lane D — tiny, dependency-free helpers shared by the deterministic offline generator.
 *
 * Everything here is pure and deterministic. No randomness, no clock reads, no I/O:
 * the same input always produces the same artifact, which is what makes offline mode
 * auditable and testable (see docs/ai/ai-layer.md).
 */

import { CASE_TYPES, SEVERITIES, LAYER_KINDS, type CaseType, type Severity } from '@qatools/shared';

/** Split a free-text blob into candidate requirement statements. */
export function splitSentences(text: string): string[] {
  if (!text) return [];
  return text
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .map((s) => s.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter((s) => s.length > 2);
}

const STOP_WORDS = new Set([
  'yang', 'dan', 'atau', 'untuk', 'dengan', 'pada', 'dari', 'ke', 'di', 'ini', 'itu', 'adalah',
  'akan', 'dapat', 'bisa', 'harus', 'agar', 'oleh', 'the', 'a', 'an', 'and', 'or', 'for', 'with',
  'to', 'of', 'in', 'on', 'is', 'are', 'be', 'can', 'must', 'should', 'user', 'sistem', 'system',
  'aplikasi', 'application', 'haruslah', 'sebuah', 'para', 'juga', 'tidak', 'bila', 'jika',
]);

const ACTION_WORDS = [
  'login', 'logout', 'masuk', 'keluar', 'daftar', 'register', 'membuat', 'buat', 'create', 'tambah',
  'add', 'edit', 'ubah', 'update', 'hapus', 'delete', 'cari', 'search', 'lihat', 'view', 'baca',
  'upload', 'unggah', 'download', 'unduh', 'kirim', 'send', 'bayar', 'pay', 'checkout', 'approve',
  'setujui', 'verifikasi', 'verify', 'reset', 'lupa', 'validasi', 'validate', 'cetak', 'print',
  'ekspor', 'export', 'impor', 'import', 'filter', 'urutkan', 'sort', 'pilih', 'select', 'reset',
  'lacak', 'track', 'assign', 'tetapkan', 'hitung', 'calculate', 'sinkron', 'sync',
];

/** Deterministic pick from a list. */
export function pick<T>(items: readonly T[], index: number): T {
  const safe = items.length ? items : ([''] as unknown as readonly T[]);
  const i = ((Math.trunc(index) % safe.length) + safe.length) % safe.length;
  return safe[i] as T;
}

export function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = (raw ?? '').trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** Title Case-ish normaliser that keeps the author's capitalisation for known words. */
export function titleise(text: string): string {
  const t = (text ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Truncate on a word boundary. */
export function truncate(text: string, max = 180): string {
  const t = (text ?? '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 40 ? cut.slice(0, sp) : cut).trim()}…`;
}

/** Lower-cases only the first character, keeping acronyms/proper nouns intact. */
export function lowerFirst(text: string): string {
  const t = (text ?? '').trim();
  if (!t) return '';
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/** Lower-cased, stop-word-stripped word list. */
export function keywords(text: string, limit = 40): string[] {
  const words = (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return uniq(words).slice(0, limit);
}

/**
 * Guesses the business object of a requirement sentence, e.g.
 * "Pengguna dapat mengunggah dokumen pendukung" → "dokumen pendukung".
 *
 * Strategy (deterministic, longest-match first):
 *  1. noun phrase after a known action verb;
 *  2. else the first noun phrase after any preposition/verb-ish marker;
 *  3. else the top keywords.
 */
export function subjectOf(text: string): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const lower = t.toLowerCase();

  // Longest verb first so "mengunggah" wins over "unggah".
  const verbs = [...ACTION_WORDS].sort((a, b) => b.length - a.length);
  let bestIdx = -1;
  let bestLen = 0;
  for (const verb of verbs) {
    const re = new RegExp(`(^|[^a-z])${verb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    const m = re.exec(lower);
    if (!m) continue;
    const at = m.index + m[1].length;
    // Prefer the earliest match; among equals, the longest verb.
    if (bestIdx === -1 || at < bestIdx || (at === bestIdx && verb.length > bestLen)) {
      bestIdx = at;
      bestLen = verb.length;
    }
  }
  if (bestIdx >= 0) {
    const after = t.slice(bestIdx + bestLen).replace(/^[\s:,-]+/, '');
    const cleaned = takeNounPhrase(after);
    if (cleaned.length > 2) return cleaned;
  }

  // Fallback: first noun phrase of the sentence, ignoring the leading subject pronoun.
  const body = t
    .replace(/^\s*(pengguna|user|admin|sistem|aplikasi|pelanggan|guru|siswa|operator|manager)\b/i, '')
    .replace(/^\s*(dapat|bisa|harus|akan|dapatlah)\b/i, '')
    .trim();
  const phrase = takeNounPhrase(body);
  if (phrase.length > 2) return phrase;

  const kws = keywords(t, 4);
  return kws.length ? titleise(kws.join(' ')) : titleise(truncate(t, 60));
}

const TRAILING_STOP = /\b(yang|untuk|dengan|dan|atau|di|ke|pada|dari|agar|supaya|bila|jika|setelah|sebelum|serta|maupun|ini|itu|tersebut)\b/i;

/** Takes up to 4 words and trims at the first trailing connector/clause boundary. */
function takeNounPhrase(raw: string): string {
  let s = (raw ?? '').split(/[.,;:!?()\[\]{}"']/)[0] ?? '';
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const words = s.split(' ');
  const kept: string[] = [];
  for (const w of words.slice(0, 5)) {
    const isStop = TRAILING_STOP.test(w);
    // Keep a connector only when something already precedes it.
    if (isStop && kept.length) break;
    if (isStop) continue;
    kept.push(w);
    if (kept.length >= 4) break;
  }
  const out = kept.join(' ').replace(/[.,;:!?]+$/, '').trim();
  return out ? titleise(out) : '';
}

/** The action verb present in the sentence (or a safe default). */
export function actionOf(text: string): string {
  const lower = (text ?? '').toLowerCase();
  const found = [...ACTION_WORDS].sort((a, b) => b.length - a.length).find((v) =>
    new RegExp(`(^|[^a-z])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(lower),
  );
  return found ?? 'mengelola';
}

/**
 * Full human-readable use-case name, e.g. "Login dengan Email" — never a verb concatenation.
 * Uses the sentence shape: "<Actor> dapat <verb> <object>" → "<Verb-ing> <Object>".
 */
export function nameForUseCase(text: string): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Use Case';
  // "Sistem harus menolak login ..." → "Menolak login ..." (drop modal verbs).
  const stripped = t
    .replace(/^\s*(pengguna|user|admin|sistem|aplikasi|pelanggan|guru|siswa|operator|manager|kurir)\b/i, '')
    .replace(/^\s*(dapat|bisa|harus|akan|wajib|mampu)\b/i, '')
    .trim();
  const verb = actionOf(t);
  const object = subjectOf(t);
  const hasVerb = verb !== 'mengelola';
  const candidate = hasVerb && object ? `${verb} ${object}` : stripped || object || t;
  return truncate(titleise(candidate), 110);
}

export interface ActorGuess {
  actor: string;
  evidence: string;
}

/** Role detection from free text. Returns deterministic, de-duplicated actors. */
export function detectActors(text: string): ActorGuess[] {
  const lower = (text ?? '').toLowerCase();
  const out: ActorGuess[] = [];
  const add = (actor: string, evidence: string) => {
    if (!out.some((a) => a.actor.toLowerCase() === actor.toLowerCase())) out.push({ actor, evidence });
  };
  if (/\b(admin|administrator|pengelola|super ?user|back ?office)\b/.test(lower)) add('Admin', 'kata kunci admin/pengelola');
  if (/\b(customer|pelanggan|pembeli|buyer|klien|client)\b/.test(lower)) add('Customer', 'kata kunci customer/pelanggan');
  if (/\b(guru|teacher|dosen|instruktur|trainer)\b/.test(lower)) add('Guru', 'kata kunci guru/instruktur');
  if (/\b(siswa|student|murid|peserta|learner|mahasiswa)\b/.test(lower)) add('Siswa', 'kata kunci siswa/peserta');
  if (/\b(kurir|courier|driver|pengemudi|mitra)\b/.test(lower)) add('Kurir', 'kata kunci kurir/mitra');
  if (/\b(operator|staff|petugas|agen|teller|kasir)\b/.test(lower)) add('Operator', 'kata kunci operator/petugas');
  if (/\b(manager|manajer|atasan|supervisor|kepala)\b/.test(lower)) add('Manager', 'kata kunci manager/supervisor');
  if (/\b(api|integrasi|webhook|service|sistem lain|third ?party)\b/.test(lower)) add('Sistem Eksternal', 'menyebut integrasi/API');
  if (!out.length) add('Pengguna', 'default: pelaku utama aplikasi');
  return out;
}

/** Detects business-rule-ish sentences (constraints, limits, validations). */
export function detectRules(text: string): string[] {
  const rules = splitSentences(text).filter((s) =>
    /(wajib|harus|tidak boleh|maksimal|minimal|paling (banyak|sedikit)|<=|>=|unik|unique|valid|invalid|format|batas|limit|maks|min|tidak dapat|hanya)/i.test(
      s,
    ),
  );
  return uniq(rules.map((r) => truncate(r, 200))).slice(0, 6);
}

/** Derives a coarse complexity bucket from the size/shape of the text. */
export function complexityOf(text: string, entityCount = 1): 'low' | 'medium' | 'high' {
  const words = (text ?? '').split(/\s+/).filter(Boolean).length;
  const rules = detectRules(text).length;
  const score = Math.min(10, Math.round(words / 25)) + Math.min(4, entityCount) + rules;
  if (score >= 9) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

/** Priority heuristic — security/payment/reporting features outrank cosmetics. */
export function priorityOf(text: string): 'low' | 'medium' | 'high' | 'critical' {
  const lower = (text ?? '').toLowerCase();
  if (/\b(pembayaran|payment|bayar|transaksi|checkout|gaji|payroll|transfer|kartu kredit)\b/.test(lower)) return 'critical';
  if (/\b(login|masuk|autentikasi|auth|password|kata sandi|hak akses|role|permission|keamanan|security)\b/.test(lower))
    return 'high';
  if (/\b(laporan|report|dashboard|ekspor|export|integrasi|api|sinkron|notifikasi|email)\b/.test(lower)) return 'high';
  if (/\b(tema|warna|logo|ikon|tooltip|footer|kosmetik|typo)\b/.test(lower)) return 'low';
  return 'medium';
}

/** Fields whose presence makes a form security-sensitive. */
const SENSITIVE_FIELDS = /password|passwd|pwd|token|secret|otp|pin|cvv|kata sandi|nomer kartu|card/i;

export interface DerivedField {
  name: string;
  type: string;
  label: string;
  required: boolean;
  /** Sample values: [happy, invalid, boundary] */
  samples: [string, string, string];
}

const SAMPLE_TABLE: Array<{ match: RegExp; samples: [string, string, string] }> = [
  { match: /email|e-mail|surel/i, samples: ['qa.tester@example.com', 'bukan-email', 'a@b.co'] },
  { match: /password|passwd|pwd|kata sandi/i, samples: ['Rahasia#2026', '123', 'R4h4s14!PanjangSekali2026'] },
  { match: /phone|telp|telepon|hp|whatsapp|msisdn/i, samples: ['081234567890', 'abc', '0000000000'] },
  { match: /qty|quantity|jumlah|count/i, samples: ['2', '-1', '0'] },
  { match: /price|harga|amount|nominal|total|subtotal/i, samples: ['150000', 'seribu', '0'] },
  { match: /date|tanggal|tgl/i, samples: ['2026-01-31', '31-02-2026', '2026-12-31'] },
  { match: /stock|stok/i, samples: ['10', '-5', '0'] },
  { match: /name|nama/i, samples: ['Budi Santoso', '', 'Nama Sangat Panjang '.repeat(6).trim()] },
  { match: /nik|ktp|identitas/i, samples: ['3174091234567890', '123', '0000000000000000'] },
  { match: /url|link|website/i, samples: ['https://example.com', 'bukan url', 'https://example.com/a?b=1'] },
  { match: /role|peran/i, samples: ['admin', 'superadmin', 'user'] },
  { match: /status/i, samples: ['active', 'unknown', 'inactive'] },
];

function samplesFor(name: string, type: string): [string, string, string] {
  for (const row of SAMPLE_TABLE) if (row.match.test(name)) return row.samples;
  if (type === 'number') return ['1', '-1', '0'];
  if (type === 'date') return ['2026-01-31', '31-02-2026', '2026-12-31'];
  if (type === 'checkbox') return ['true', 'false', 'true'];
  if (type === 'select' || type === 'radio') return ['opsi-a', 'opsi-tidak-ada', 'opsi-b'];
  return ['data-valid', '', 'DATA-VALID-PANJANG-'.padEnd(40, 'X')];
}

export function deriveField(name: string, type = 'text', required = true, label?: string): DerivedField {
  const t = (type || 'text').toLowerCase();
  return {
    name: name || 'field',
    type: t,
    label: label || titleise((name || 'field').replace(/[_-]+/g, ' ')),
    required,
    samples: samplesFor(name, t),
  };
}

/** Maps a free-text requirement to the most plausible test-case type. */
export function caseTypeOf(text: string, hint?: string): CaseType {
  const lower = `${hint ?? ''} ${text ?? ''}`.toLowerCase();
  if (/\b(negatif|negative|salah|invalid|gagal|error|ditolak|unauthorized|401|403)\b/.test(lower)) return 'negative';
  if (/\b(batas|boundary|minimal|maksimal|limit|tepi|edge)\b/.test(lower)) return 'boundary';
  if (/\b(keamanan|security|sql injection|xss|csrf|otentikasi|otorisasi|hak akses|enkripsi)\b/.test(lower)) return 'security';
  if (/\b(performa|performance|beban|load|respons|response time|latensi|throughput|1 juta)\b/.test(lower)) return 'performance';
  if (/\b(usability|kemudahan|aksesibilitas|accessibility|aria|kontras|keyboard)\b/.test(lower)) return 'usability';
  if (/\b(kompatibilitas|browser|chrome|firefox|safari|resolusi|mobile|android|ios)\b/.test(lower)) return 'compatibility';
  if (/\b(regresi|regression|tidak berubah|masih berjalan)\b/.test(lower)) return 'regression';
  return 'functional';
}

export function isCaseType(v: unknown): v is CaseType {
  return typeof v === 'string' && (CASE_TYPES as readonly string[]).includes(v);
}

export function isLayerKind(v: unknown): boolean {
  return typeof v === 'string' && (LAYER_KINDS as readonly string[]).includes(v);
}

export function isSeverity(v: unknown): v is Severity {
  return typeof v === 'string' && (SEVERITIES as readonly string[]).includes(v);
}

/** Coarse layer inference: DB words → db, HTTP words → api, the rest → web. */
export function layerOf(text: string, formFields = 0): 'web' | 'api' | 'db' | 'mobile' | 'unit' {
  const lower = (text ?? '').toLowerCase();
  if (/\b(sql|query|tabel|table|database|basis data|record|baris|kolom|schema|migrasi)\b/.test(lower)) return 'db';
  if (/\b(endpoint|api|rest|graphql|http|status code|json|payload|webhook|header)\b/.test(lower)) return 'api';
  if (/\b(mobile|android|ios|aplikasi hp)\b/.test(lower)) return 'mobile';
  if (/\b(unit|fungsi|function|method|library|utils?)\b/.test(lower) && formFields === 0) return 'unit';
  return 'web';
}

/** Derives a stable business component name from a defect/requirement title. */
export function componentOf(text: string): string {
  const lower = (text ?? '').toLowerCase();
  const table: Array<[RegExp, string]> = [
    [/login|masuk|sign ?in|autentikasi|auth|password|kata sandi/, 'Authentication'],
    [/register|daftar|sign ?up|registrasi/, 'Registration'],
    [/checkout|bayar|payment|pembayaran|transaksi/, 'Checkout & Payment'],
    [/cart|keranjang|basket/, 'Cart'],
    [/order|pesanan|invoice|faktur/, 'Order Management'],
    [/product|produk|barang|katalog|catalog/, 'Product Catalog'],
    [/search|cari|pencarian|filter/, 'Search'],
    [/report|laporan|dashboard|metrik|metrics/, 'Reporting'],
    [/email|notifikasi|notification|sms|whatsapp/, 'Notification'],
    [/upload|unggah|file|dokumen|document/, 'File Management'],
    [/api|endpoint|integrasi|webhook/, 'API Integration'],
    [/database|sql|migrasi|tabel/, 'Database'],
    [/profil|profile|akun|account/, 'User Profile'],
    [/role|permission|hak akses|otorisasi|authoriz/, 'Authorization'],
    [/ui|tampilan|layout|css|tema|responsive/, 'User Interface'],
  ];
  for (const [re, name] of table) if (re.test(lower)) return name;
  const kw = keywords(text, 2);
  return kw.length ? titleise(kw.join(' ')) : 'General';
}

/** Splits a CamelCase/snake_case identifier into words. */
export function humaniseIdentifier(id: string): string {
  return titleise(
    (id ?? '')
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}
