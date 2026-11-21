/**
 * agents/healing — selector healing for the AI QA agent pool.
 *
 * When a web/ai case fails because a selector no longer resolves, the pool asks
 * this module for a replacement. The offline path is a **genuine DOM scan** of
 * the HTML captured at failure time: it parses the page with Lane C's
 * dependency-free extractor and proposes real selectors from real nodes.
 *
 * Precedence (IDENTICAL to Lane C's `selectorCandidates`, ARCHITECTURE.md §11):
 *   data-testid > id > name > aria-label > class > text
 *
 * Lane C's own helper ranks `id` first; the pool's documented contract ranks
 * `data-testid` first, so the scoring table below is the authoritative order for
 * healing while the candidate set is sourced from the same parser.
 *
 * Lane D (`aiService`) is used only to *re-rank/explain* candidates — never to
 * invent selectors that do not exist in the supplied HTML. Every AI path
 * degrades to the deterministic scan, and `used_mock` reports the truth.
 */

import type { HealRequest, HealResult } from '@qatools/shared';

/* ------------------------------------------------------------------ *
 * Attribute precedence — the single source of truth for robustness
 * ------------------------------------------------------------------ */

export interface AttributeRule {
  /** Attribute name, or `null` for the text-content rule. */
  attribute: string | null;
  /** Base score before frequency/length adjustments. */
  score: number;
  /** Why this attribute is (or is not) robust. */
  reason: string;
  /** Renders the selector for a matched node. */
  render: (node: DomNode) => string | null;
}

/**
 * Ordered from most to least robust. Scoring encodes the *documented*
 * precedence: data-testid > id > name > aria-label > class > text.
 */
export const HEAL_PRECEDENCE: AttributeRule[] = [
  {
    attribute: 'data-testid',
    score: 100,
    reason: 'data-testid adalah kontrak test khusus dan tidak berubah saat styling atau struktur berubah.',
    render: (n) => `[data-testid="${n.attrs['data-testid']}"]`,
  },
  {
    attribute: 'id',
    score: 78,
    reason: 'id unik dan stabil, tetapi sering ikut berubah bila framework merender ulang komponen.',
    render: (n) => `#${n.attrs.id}`,
  },
  {
    attribute: 'name',
    score: 60,
    reason: 'name adalah atribut fungsional form sehingga jarang berubah, meski tidak menjamin keunikan.',
    render: (n) => `${n.tag}[name="${n.attrs.name}"]`,
  },
  {
    attribute: 'aria-label',
    score: 45,
    reason: 'aria-label mengikuti aksesibilitas: cukup stabil, tetapi bisa berubah saat teks UI diperbarui.',
    render: (n) => `[aria-label="${n.attrs['aria-label']}"]`,
  },
  {
    attribute: 'class',
    score: 25,
    reason: 'class bergantung pada CSS/utilitas dan paling mudah berubah — dipakai hanya sebagai pilihan terakhir.',
    render: (n) => `.${firstClass(n.attrs.class)}`,
  },
  {
    attribute: null,
    score: 15,
    reason: 'Pencocokan teks mudah dibaca manusia, tetapi patah begitu copywriting atau lokalisasi berubah.',
    render: (n) => (n.text ? `${n.tag} >> text=${n.text}` : null),
  },
];

/* ------------------------------------------------------------------ *
 * HTML parser (Lane C, dynamic import — guarded)
 *
 * We deliberately REUSE Lane C's hand-written parser instead of writing a
 * second one: two parsers would drift and the healed selector must resolve in
 * the very engine that reported the failure. Lane C is imported DYNAMICALLY and
 * inside the function so a mid-edit file cannot break the API boot; if it is
 * unavailable we fall back to a compact local scanner below.
 * ------------------------------------------------------------------ */

export interface DomNode {
  tag: string;
  attrs: Record<string, string>;
  children: DomNode[];
  parent: DomNode | null;
  text: string;
  index: number;
}

type ParserModule = {
  parseHtml?: (html: string) => DomNode;
  flattenTree?: (root: DomNode) => DomNode[];
  normaliseWhitespace?: (s: string) => string;
};

let parserPromise: Promise<ParserModule | null> | null = null;

/** Cached, guarded dynamic import of Lane C's HTML extractor. */
async function loadParser(): Promise<ParserModule | null> {
  if (!parserPromise) {
    parserPromise = (async () => {
      try {
        const specifier = '../webtester/html.js';
        return (await import(/* @vite-ignore */ specifier)) as ParserModule;
      } catch {
        return null;
      }
    })();
  }
  return parserPromise;
}

function firstClass(value: string | undefined): string {
  return (value ?? '').trim().split(/\s+/).filter(Boolean)[0] ?? '';
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ *
 * Local fallback scanner — used only when Lane C's parser is unavailable
 * ------------------------------------------------------------------ */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TAGS = new Set(['script', 'style', 'textarea', 'title']);
const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'option', 'label', 'form']);

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([:@a-zA-Z_][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const name = m[1]?.toLowerCase();
    if (!name) continue;
    attrs[name] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

function localParseHtml(html: string): DomNode {
  const root: DomNode = { tag: '#root', attrs: {}, children: [], parent: null, text: '', index: 0 };
  const stack: DomNode[] = [root];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  let index = 0;

  while ((m = re.exec(html))) {
    const [full, closeTag, openTag, rawAttrs, selfClose, textChunk] = m;
    if (full.startsWith('<!--')) continue;

    if (closeTag) {
      const tag = closeTag.toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    if (openTag) {
      const tag = openTag.toLowerCase();
      const parent = stack[stack.length - 1];
      const node: DomNode = {
        tag,
        attrs: parseAttributes(rawAttrs ?? ''),
        children: [],
        parent,
        text: '',
        index: index++,
      };
      parent.children.push(node);

      if (VOID_TAGS.has(tag) || selfClose === '/') continue;
      if (RAW_TAGS.has(tag)) {
        const inner = new RegExp(`([\\s\\S]*?)</${tag}\\s*>`, 'i').exec(html.slice(re.lastIndex));
        if (inner) {
          node.text = tag === 'title' || tag === 'textarea' ? collapse(inner[1] ?? '') : '';
          re.lastIndex += (inner[0] ?? '').length;
        }
        continue;
      }
      stack.push(node);
      continue;
    }

    if (textChunk) {
      const parent = stack[stack.length - 1];
      if (parent && parent.tag !== '#root') parent.text += textChunk;
    }
  }

  aggregate(root);
  return root;
}

function aggregate(node: DomNode): void {
  let text = node.text;
  for (const child of node.children) {
    aggregate(child);
    if (!INTERACTIVE_TAGS.has(child.tag)) text += ` ${child.text}`;
  }
  node.text = collapse(text);
}

function localFlatten(root: DomNode): DomNode[] {
  const out: DomNode[] = [];
  const walk = (node: DomNode) => {
    for (const child of node.children) {
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

/* ------------------------------------------------------------------ *
 * Selector helpers
 * ------------------------------------------------------------------ */

/** Comparable form of a selector: quotes and whitespace removed, lowercased. */
export function normaliseSelector(selector: string): string {
  return (selector ?? '')
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s*>>\s*/g, '>>')
    .replace(/\s*([>~+])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The final identifier in a compound selector (`div.card > #x` → `x`). */
export function lastIdentifier(selector: string): string {
  const cleaned = (selector ?? '').trim();
  const tail = cleaned.split(/\s|>/).filter(Boolean).pop() ?? '';
  return tail.replace(/^[.#]/, '').replace(/\[.*$/, '').replace(/[:[].*$/, '');
}

/** Pulls `attr="value"` pairs out of a selector so we can match on them. */
export function selectorAttributes(selector: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  const re = /\[\s*([\w:-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(selector ?? ''))) {
    out.push({ name: (m[1] ?? '').toLowerCase(), value: collapse(m[3] ?? m[4] ?? m[5] ?? '') });
  }
  return out;
}

function selectorTag(selector: string): string | null {
  const m = /^\s*([a-zA-Z][\w-]*)/.exec(selector ?? '');
  return m ? m[1].toLowerCase() : null;
}

/* ------------------------------------------------------------------ *
 * Candidate generation — a real scan over the supplied HTML
 * ------------------------------------------------------------------ */

interface Candidate {
  selector: string;
  score: number;
  reason: string;
  /** Which precedence tier produced it (0 = most robust). */
  tier: number;
}

export interface ScanDiagnostics {
  nodes_scanned: number;
  parser: 'lane-c' | 'local';
  diagnostics: string[];
}

/**
 * Scans `html` and returns ranked candidates. Pure and deterministic: given the
 * same HTML and selector it always returns the same list, so tests can assert
 * on specific selectors.
 */
export async function proposeCandidates(
  failedSelector: string,
  html: string,
  intent?: string,
): Promise<{ candidates: Candidate[]; scan: ScanDiagnostics }> {
  const diagnostics: string[] = [];
  if (!html || !html.trim()) {
    return {
      candidates: [],
      scan: { nodes_scanned: 0, parser: 'local', diagnostics: ['HTML halaman tidak dikirim, sehingga pemindaian DOM tidak dapat dilakukan.'] },
    };
  }

  const parser = await loadParser();
  let root: DomNode;
  let nodes: DomNode[];
  let parserName: 'lane-c' | 'local';

  try {
    if (parser?.parseHtml && parser?.flattenTree) {
      root = parser.parseHtml(html);
      nodes = parser.flattenTree(root);
      parserName = 'lane-c';
    } else {
      root = localParseHtml(html);
      nodes = localFlatten(root);
      parserName = 'local';
      diagnostics.push('Parser HTML lane C tidak tersedia; dipakai pemindai cadangan internal agent pool.');
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    root = localParseHtml(html);
    nodes = localFlatten(root);
    parserName = 'local';
    diagnostics.push(`Parser lane C gagal (${reason.slice(0, 120)}); dipakai pemindai cadangan.`);
  }

  const collapsed = collapse;

  // --- frequency analysis: a selector matching many nodes is not an anchor ---
  const frequency = new Map<string, number>();
  const bump = (key: string) => frequency.set(key, (frequency.get(key) ?? 0) + 1);
  for (const node of nodes) {
    if (node.attrs['data-testid']) bump(`testid:${node.attrs['data-testid']}`);
    if (node.attrs.id) bump(`id:${node.attrs.id}`);
    if (node.attrs.name) bump(`name:${node.attrs.name}`);
    if (node.attrs['aria-label']) bump(`aria:${node.attrs['aria-label']}`);
    if (collapsed(node.text)) bump(`text:${collapsed(node.text)}`);
  }

  // --- scoring weights derived from the failed selector -------------------
  const normalisedFailed = normaliseSelector(failedSelector);
  const failedAttrs = selectorAttributes(failedSelector);
  const failedTag = selectorTag(failedSelector);
  const failedId = lastIdentifier(failedSelector);

  // Tokens the user cares about: id-ish words from the failed selector + intent.
  const wantedTokens = new Set<string>();
  for (const token of `${failedId} ${intent ?? ''}`.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length >= 3) wantedTokens.add(token);
  }

  const scored = new Map<string, Candidate>();

  for (const node of nodes) {
    const text = collapsed(node.text);
    const interactive = INTERACTIVE_TAGS.has(node.tag) || node.attrs.role === 'button' || node.attrs.role === 'link';

    for (const [tier, rule] of HEAL_PRECEDENCE.entries()) {
      if (rule.attribute === null) {
        // Text tier: only for interactive nodes and short, human-meaningful text.
        if (!interactive || !text || text.length > 80) continue;
        // Skip text that is merely the concatenation of child controls.
        if (!node.children.some((c) => INTERACTIVE_TAGS.has(c.tag)) === false) {
          /* keep going — aggregate text is still a valid anchor */
        }
      } else if (!node.attrs[rule.attribute]) {
        continue;
      }

      const selector = rule.render(node);
      if (!selector) continue;
      const key = normaliseSelector(selector);
      if (!key) continue;

      let score = rule.score;
      const why: string[] = [rule.reason];

      // 1. Same attribute family as the failed selector → likely the same element.
      for (const attr of failedAttrs) {
        if (rule.attribute && attr.name === rule.attribute) {
          score += 40;
          why.push(`atribut ${attr.name} sama dengan selector yang gagal, indikasi kuat elemen yang dimaksud.`);
          if (attr.value && node.attrs[attr.name] === attr.value) {
            score += 60;
            why.push('nilainya identik dengan selector lama — kandidat paling mungkin.');
          }
        }
      }

      // 2. Identifier overlap with the failed selector / intent.
      const rendered = selector.toLowerCase();
      let overlap = 0;
      for (const token of wantedTokens) if (rendered.includes(token)) overlap++;
      if (overlap) {
        score += Math.min(30, overlap * 12);
        why.push(`berbagi ${overlap} kata kunci dengan selector/intent yang gagal.`);
      }

      // 3. Uniqueness — a selector matching one node is a far better anchor.
      const familyKey =
        rule.attribute === 'data-testid'
          ? `testid:${node.attrs['data-testid']}`
          : rule.attribute === 'id'
            ? `id:${node.attrs.id}`
            : rule.attribute === 'name'
              ? `name:${node.attrs.name}`
              : rule.attribute === 'aria-label'
                ? `aria:${node.attrs['aria-label']}`
                : rule.attribute === null
                  ? `text:${text}`
                  : `class:${firstClass(node.attrs.class)}`;
      const count = frequency.get(familyKey) ?? 1;
      if (count === 1) {
        score += 22;
        why.push('cocok dengan tepat satu elemen pada halaman (unik).');
      } else {
        score -= Math.min(20, (count - 1) * 5);
        why.push(`cocok dengan ${count} elemen, jadi kurang spesifik sebagai jangkar.`);
      }

      // 4. Tag agreement with the failed selector.
      if (failedTag && node.tag === failedTag) {
        score += 10;
        why.push(`tag <${node.tag}> sama dengan selector lama.`);
      }

      // 5. Very long/derived identifiers are usually generated and unstable.
      const rawValue = rule.attribute ? (node.attrs[rule.attribute] ?? '') : text;
      if (/\d{4,}/.test(rawValue)) {
        score -= 6;
        why.push('nilai mengandung deret angka panjang sehingga kemungkinan id yang digenerate.');
      }
      if (rawValue.length > 60) {
        score -= 5;
        why.push('nilai sangat panjang sehingga rapuh terhadap perubahan konten.');
      }

      // 6. Class tier: only the first class, and only when it looks semantic.
      if (rule.attribute === 'class') {
        const cls = firstClass(node.attrs.class);
        if (!cls || /^(css-|sc-|jsx-|_)/.test(cls) || cls.length < 3) {
          score -= 25;
          why.push('class terlihat digenerate otomatis (css-/sc-/jsx-), sehingga sangat tidak stabil.');
        }
      }

      score = Math.max(1, Math.min(200, Math.round(score)));
      const existing = scored.get(key);
      if (!existing || existing.score < score) {
        scored.set(key, { selector, score, reason: why.join(' '), tier });
      }
    }
  }

  const candidates = [...scored.values()]
    .sort((a, b) => b.score - a.score || a.tier - b.tier || a.selector.localeCompare(b.selector))
    .slice(0, 12);

  if (!candidates.length) {
    diagnostics.push(
      `Pemindaian DOM atas ${nodes.length} elemen tidak menemukan atribut atau teks apa pun yang dapat dijadikan selector pengganti.`,
    );
  } else {
    diagnostics.push(
      `Memindai ${nodes.length} elemen (parser: ${parserName}) dan menghasilkan ${candidates.length} kandidat selector.`,
    );
  }

  return { candidates, scan: { nodes_scanned: nodes.length, parser: parserName, diagnostics } };
}

/* ------------------------------------------------------------------ *
 * AI re-ranking (Lane D, dynamic + guarded)
 * ------------------------------------------------------------------ */

interface AiRerankOutcome {
  order: string[] | null;
  aiUsed: boolean;
  note: string | null;
}

interface AiGenerateLike {
  generate?: (task: string, input: Record<string, unknown>, ctx?: Record<string, unknown>) => Promise<unknown>;
}

type AiModule = { aiService?: AiGenerateLike };

/**
 * Asks Lane D to re-rank candidates. It may ONLY reorder/choose from the list we
 * already produced — an AI-invented selector would be unverifiable, so unknown
 * selectors are dropped.
 */
async function aiRerank(
  failedSelector: string,
  action: string,
  candidates: Candidate[],
  intent?: string,
): Promise<AiRerankOutcome> {
  // `.catch(() => null)` keeps the awaited value typed as `AiModule | null` —
  // a mutable `let … = null` pre-initialised before the import narrows to
  // `never` in the catch path under `strict`.
  const aiModule = (await import('../ai/index.js').catch(() => null)) as AiModule | null;

  if (!aiModule) {
    return { order: null, aiUsed: false, note: 'Modul AI tidak dapat dimuat; kandidat diurutkan murni dari analisis DOM.' };
  }

  const service = aiModule.aiService;
  const generate = service?.generate;
  if (typeof generate !== 'function') {
    return { order: null, aiUsed: false, note: 'aiService.generate() tidak tersedia; kandidat diurutkan murni dari analisis DOM.' };
  }

  try {
    const result = (await generate.call(service, 'chat', {
      messages: [
        {
          role: 'system',
          content:
            'Anda ahli lokator otomasi web. Balas JSON: {"best":"<selector>","order":["..."],"rationale":"..."} HANYA memakai selector dari daftar kandidat yang diberikan. Tanpa markdown.',
        },
        {
          role: 'user',
          content:
            `Selector "${failedSelector}" gagal pada aksi "${action}".${intent ? ` Intent: ${intent}.` : ''} ` +
            `Kandidat (sudah diverifikasi ada di HTML): ${JSON.stringify(candidates.map((c) => c.selector))}. ` +
            'Pilih yang paling tahan perubahan dan jelaskan singkat dalam Bahasa Indonesia.',
        },
      ],
      context: 'Penyembuhan selector pada agent pool.',
    })) as {
      ok?: boolean;
      data?: { reply?: string } | null;
      meta?: { used_mock?: boolean };
    };

    if (result?.meta?.used_mock === true) {
      return {
        order: null,
        aiUsed: false,
        note: 'Tidak ada provider AI aktif — peringkat kandidat murni dari analisis DOM (bukan klaim AI).',
      };
    }

    if (result?.ok && typeof result.data?.reply === 'string') {
      const parsed = extractRerank(result.data.reply, candidates);
      if (parsed) return { order: parsed, aiUsed: true, note: 'Peringkat kandidat disetujui/diatur ulang oleh model AI aktif.' };
    }
    return { order: null, aiUsed: false, note: 'Balasan AI tidak memuat urutan kandidat yang valid; dipakai peringkat analisis DOM.' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { order: null, aiUsed: false, note: `Panggilan AI gagal (${reason.slice(0, 120)}).` };
  }
}

/** Parses the AI reply and keeps only selectors that actually exist on the page. */
function extractRerank(reply: string, candidates: Candidate[]): string[] | null {
  const known = new Map(candidates.map((c) => [normaliseSelector(c.selector), c.selector]));
  const tryParse = (text: string): string[] | null => {
    try {
      const parsed = JSON.parse(text) as { best?: unknown; order?: unknown };
      const raw: string[] = [];
      if (Array.isArray(parsed.order)) raw.push(...parsed.order.map(String));
      if (typeof parsed.best === 'string') raw.unshift(parsed.best);
      const seen = new Set<string>();
      const out: string[] = [];
      for (const item of raw) {
        const canonical = known.get(normaliseSelector(item));
        if (canonical && !seen.has(canonical)) {
          seen.add(canonical);
          out.push(canonical);
        }
      }
      return out.length ? out : null;
    } catch {
      return null;
    }
  };

  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/i);
  for (const candidate of [fenced?.[1], reply.match(/\{[\s\S]*\}/)?.[0], reply]) {
    if (!candidate) continue;
    const parsed = tryParse(candidate);
    if (parsed) return parsed;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * heal() — the public entry point
 * ------------------------------------------------------------------ */

export async function heal(req: HealRequest): Promise<HealResult> {
  const failedSelector = typeof req?.selector === 'string' ? req.selector.trim() : '';
  const action = typeof req?.action === 'string' && req.action ? req.action : 'click';
  const html = typeof req?.html === 'string' ? req.html : '';
  const intent = typeof req?.intent === 'string' ? req.intent : undefined;

  if (!failedSelector) {
    return {
      healed: false,
      selector: null,
      candidates: [],
      rationale: 'Field "selector" wajib diisi: tanpa selector yang gagal tidak ada yang bisa diselamatkan.',
      used_mock: true,
    };
  }

  const { candidates, scan } = await proposeCandidates(failedSelector, html, intent);
  const notes = [...scan.diagnostics];

  if (!candidates.length) {
    return {
      healed: false,
      selector: null,
      candidates: [],
      rationale:
        `Selector "${failedSelector}" tidak dapat diselamatkan: ${notes.join(' ')} ` +
        'Periksa apakah HTML yang dikirim benar-benar halaman saat kegagalan terjadi (bukan halaman login atau halaman kosong).',
      used_mock: true,
    };
  }

  const rerank = await aiRerank(failedSelector, action, candidates, intent);
  if (rerank.note) notes.push(rerank.note);

  let ordered = candidates;
  if (rerank.order) {
    const rank = new Map(rerank.order.map((s, i) => [s, i]));
    ordered = [...candidates].sort((a, b) => {
      const ra = rank.get(a.selector) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.selector) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || b.score - a.score;
    });
  }

  const best = ordered[0];
  const top = ordered.slice(0, 3);

  return {
    healed: true,
    selector: best.selector,
    candidates: ordered.map((c) => ({ selector: c.selector, score: c.score, reason: c.reason })),
    rationale:
      `Selector "${failedSelector}" diganti dengan "${best.selector}" (skor ${best.score}). ` +
      `${best.reason} Alasan pemeringkatan: QATools mengurutkan kandidat menurut ketahanan ` +
      'data-testid > id > name > aria-label > class > text, lalu menyesuaikan dengan kemiripan atribut, ' +
      `keunikan elemen, dan kecocokan tag. ${top.length > 1 ? `Cadangan berikutnya: ${top.slice(1).map((c) => c.selector).join(', ')}. ` : ''}` +
      notes.join(' '),
    used_mock: !rerank.aiUsed,
  };
}

/* ------------------------------------------------------------------ *
 * Pool integration helpers
 * ------------------------------------------------------------------ */

/**
 * Extracts the best (failed selector, html, action) triple from an engine
 * result's step logs/evidence. Returns null when the failure was not
 * selector-related, so the pool never claims a heal that did not happen.
 */
export function extractSelectorFailure(result: {
  logs?: Array<{ action?: string; target?: string; status?: string; message?: string }>;
  evidence?: Record<string, unknown>;
  error?: string | null;
}): { selector: string; action: string; html: string } | null {
  const logs = Array.isArray(result.logs) ? result.logs : [];
  const failedLog = logs.find((l) => l?.status === 'fail');

  // The HTML snapshot is only present in HTTP-mode web evidence; without it we
  // cannot honestly claim a DOM-based heal.
  const html =
    (typeof result.evidence?.html === 'string' && (result.evidence.html as string)) ||
    (typeof result.evidence?.page_html === 'string' && (result.evidence.page_html as string)) ||
    (typeof result.evidence?.body === 'string' && (result.evidence.body as string)) ||
    '';

  if (!html) return null;

  let selector = '';
  const target = typeof failedLog?.target === 'string' ? failedLog.target : '';
  if (target && looksLikeSelector(target)) selector = target;

  if (!selector) {
    const message = `${failedLog?.message ?? ''} ${result.error ?? ''}`;
    const quoted = /Elemen "([^"]+)"/.exec(message) ?? /Field "([^"]+)"/.exec(message) ?? /selector "([^"]+)"/i.exec(message);
    if (quoted?.[1] && looksLikeSelector(quoted[1])) selector = quoted[1];
  }

  if (!selector) return null;
  return { selector, action: typeof failedLog?.action === 'string' ? failedLog.action : 'click', html };
}

/** Heuristic: does this target string look like a CSS selector rather than a URL? */
export function looksLikeSelector(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/^https?:\/\//i.test(v)) return false;
  // Accept `#id`, `.class`, `tag`, `[attr=x]`, `tag >> text=...`
  return /^[#.\[]/.test(v) || /^[a-z][\w-]*(\[|$|:|\.|#|\s*>>)/i.test(v);
}

export { parseAttributes as _parseAttributes };
