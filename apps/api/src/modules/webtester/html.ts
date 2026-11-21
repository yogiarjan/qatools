/**
 * Hand-written HTML extractor — no `cheerio`, no `jsdom`, no native parser.
 *
 * It is deliberately small and predictable: a tag scanner feeds a light DOM
 * tree, and a CSS-subset matcher resolves the selector plans the WebTester
 * produces. It supports exactly the selector shapes QATools generates:
 *
 *   #id                     id > data-testid > name > aria-label > text
 *   tag                     e.g. `button`, `form`
 *   [data-testid="x"]       attribute presence/equality
 *   tag[attr="v"]           combined
 *   .class                  class membership
 *   selector >> text=Hello  text-targeted lookup
 */

export interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  parent: HtmlNode | null;
  text: string;
  /** 0-based source offset, used only for stable ordering. */
  index: number;
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Tags whose contents are not markup. */
const RAW_TAGS = new Set(['script', 'style', 'textarea', 'title']);

/* ------------------------------------------------------------------ *
 * Tag scanning helpers
 * ------------------------------------------------------------------ */

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([:@a-zA-Z_][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const name = (m[1] as string).toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

/** Finds the `>` that closes a tag, ignoring `>` inside quoted attribute values. */
function findTagEnd(html: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return i;
  }
  return -1;
}

/* ------------------------------------------------------------------ *
 * Tree building
 * ------------------------------------------------------------------ */

/**
 * Parses HTML into a light tree in ONE linear scan, attributing each text run
 * to the element open at that point. Text is aggregated bottom-up afterwards.
 */
export function parseHtml(html: string): HtmlNode {
  const root: HtmlNode = { tag: '#root', attrs: {}, children: [], parent: null, text: '', index: 0 };
  const stack: HtmlNode[] = [root];
  let counter = 0;
  let i = 0;
  const n = html.length;

  while (i < n) {
    const lt = html.indexOf('<', i);

    // Trailing text with no further tags.
    if (lt === -1) {
      appendText(stack, html.slice(i));
      break;
    }
    if (lt > i) appendText(stack, html.slice(i, lt));

    // Comments and doctype/PI are skipped without affecting the stack.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }

    const closing = html[lt + 1] === '/';
    const nameStart = lt + (closing ? 2 : 1);
    const nameMatch = /^([a-zA-Z][\w:-]*)/.exec(html.slice(nameStart, nameStart + 64));
    if (!nameMatch) {
      // A stray `<` that is not a tag: treat it as text.
      appendText(stack, '<');
      i = lt + 1;
      continue;
    }

    const tagName = (nameMatch[1] as string).toLowerCase();
    const gt = findTagEnd(html, nameStart + tagName.length);
    if (gt === -1) {
      appendText(stack, html.slice(lt));
      break;
    }

    if (closing) {
      // Pop to the nearest matching open element.
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s]?.tag === tagName) {
          stack.length = s;
          break;
        }
      }
      i = gt + 1;
      continue;
    }

    const attrSource = html.slice(nameStart + tagName.length, gt);
    const selfClosing = /\/\s*$/.test(attrSource) || VOID_TAGS.has(tagName);

    const parent = stack[stack.length - 1] as HtmlNode;
    const node: HtmlNode = {
      tag: tagName,
      attrs: parseAttributes(attrSource),
      children: [],
      parent,
      text: '',
      index: counter++,
    };
    parent.children.push(node);

    // Raw-text elements capture their body verbatim and never nest.
    if (RAW_TAGS.has(tagName)) {
      const close = html.toLowerCase().indexOf(`</${tagName}`, gt);
      node.text = decodeEntities(html.slice(gt + 1, close === -1 ? n : close));
      i = close === -1 ? n : close;
      continue;
    }

    if (!selfClosing) stack.push(node);
    i = gt + 1;
  }

  aggregateText(root);
  return root;
}

/** Bottom-up text aggregation: an element's text includes all its descendants. */
function aggregateText(node: HtmlNode): string {
  const parts = [node.text];
  for (const child of node.children) parts.push(aggregateText(child));
  node.text = normaliseWhitespace(parts.filter(Boolean).join(' '));
  return node.text;
}

function appendText(stack: HtmlNode[], raw: string): void {
  const text = decodeEntities(raw);
  if (!text.trim()) return;
  const top = stack[stack.length - 1] as HtmlNode;
  top.text += ` ${text}`;
}

/* ------------------------------------------------------------------ *
 * Text helpers
 * ------------------------------------------------------------------ */

export function normaliseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©',
  reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity.startsWith('#')) {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const code = parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/* ------------------------------------------------------------------ *
 * Selector matching (CSS subset)
 * ------------------------------------------------------------------ */

export interface SelectorMatch {
  node: HtmlNode;
  /** Text used for `text=` comparisons. */
  text: string;
}

/**
 * Resolves a selector against the tree. Returns every match, in document order.
 * Supported: `#id`, `.class`, `tag`, `[attr]`, `[attr="v"]`, `tag.class`,
 * `tag[attr="v"]`, `#id tag`, `#id .class`, the `>>` descendant separator, and
 * `:nth-of-type(n)`.
 */
export function querySelectorAll(root: HtmlNode, selector: string): SelectorMatch[] {
  const trimmed = selector.trim();
  if (!trimmed) return [];

  // `>>` and whitespace both mean "descendant"; normalise to a segment chain.
  // Quoted values (`[attr="a b"]`) and the `text=` pseudo may contain spaces or
  // even `>>`, so they are masked BEFORE the combinator split and restored after.
  const protectedFragments: string[] = [];
  const mask = (fragment: string): string => {
    protectedFragments.push(fragment.trim());
    return `\u0000${protectedFragments.length - 1}\u0000`;
  };

  const normalised = trimmed
    // `[attr="..."]` first so a `>` inside quotes cannot split a segment.
    .replace(/\[[^\]]*\]/g, (m) => mask(m))
    // `text=...` runs to the end of the segment (next `>>` or end of string).
    .replace(/text\s*=[^>]*?(?=\s*>>|$)/gi, (m) => mask(m))
    .split('>>')
    .flatMap((part) => part.trim().split(/\s+/))
    .filter(Boolean)
    .map((segment) =>
      segment.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => protectedFragments[Number(i)] ?? ''),
    );

  if (!normalised.length) return [];

  let current: HtmlNode[] = [root];

  for (const [i, segment] of normalised.entries()) {
    const next: HtmlNode[] = [];
    const pool: HtmlNode[] = [];
    for (const node of current) {
      // For `A >> B`, B is matched against descendants of A — but a node may
      // also match B directly (e.g. `button >> text=Masuk` targets the button
      // itself), so the node is included for every segment after the first.
      if (i > 0) pool.push(node);
      collectDescendants(node, pool);
    }
    for (const node of pool) {
      if (matchesSimple(node, segment)) next.push(node);
    }
    current = next;
    if (!current.length) break;
  }

  return current.map((node) => ({ node, text: node.text }));
}

function collectDescendants(node: HtmlNode, out: HtmlNode[]): void {
  for (const child of node.children) {
    out.push(child);
    collectDescendants(child, out);
  }
}

/** Matches one simple selector segment against a single node. */
function matchesSimple(node: HtmlNode, selector: string): boolean {
  const rest = selector.trim();

  // text=... pseudo-target. An element's aggregated text includes its
  // descendants, so a `text=` match is only accepted for the INNERMOST node
  // whose own content satisfies it — otherwise `text=Masuk` would also match
  // every ancestor wrapper.
  const textMatch = /^text\s*=\s*(.+)$/i.exec(rest);
  if (textMatch) {
    const wanted = unquote((textMatch[1] as string).trim()).toLowerCase();
    const haystack = normaliseWhitespace(node.text).toLowerCase();
    if (!haystack.includes(wanted)) return false;
    // Reject when a descendant already matches on its own.
    const childMatches = (parent: HtmlNode): boolean =>
      parent.children.some(
        (child) =>
          normaliseWhitespace(child.text).toLowerCase().includes(wanted) || childMatches(child),
      );
    return !childMatches(node);
  }

  // --- #id (may appear before or after the tag, e.g. `#x` or `form#x`) ---
  const idMatch = /#([\w:.-]+)/.exec(rest);
  if (idMatch) {
    if (node.attrs.id !== idMatch[1]) return false;
  }

  // --- leading tag (only when the selector STARTS with one) ---
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(rest);
  if (tagMatch) {
    if (node.tag !== (tagMatch[0] as string).toLowerCase()) return false;
  }

  // --- one or more attribute predicates ---
  const attrRe = /\[([\w:.-]+)(?:\s*([~^$*|]?=)\s*("([^"]*)"|'([^']*)'|([^\]\s]+)))?\]/g;
  let attrMatch: RegExpExecArray | null;
  let sawAttribute = false;
  while ((attrMatch = attrRe.exec(rest))) {
    sawAttribute = true;
    const name = (attrMatch[1] as string).toLowerCase();
    const op = attrMatch[2];
    const expectedRaw = attrMatch[4] ?? attrMatch[5] ?? attrMatch[6];
    const actual = node.attrs[name];

    if (actual === undefined) return false;
    if (op === undefined) continue; // presence only

    const expected = expectedRaw ?? '';
    const target = name === 'class' ? normaliseWhitespace(actual) : actual;
    const ok =
      op === '=' ? target === expected
      : op === '~=' ? target.split(/\s+/).includes(expected)
      : op === '^=' ? target.startsWith(expected)
      : op === '$=' ? target.endsWith(expected)
      : op === '*=' ? target.includes(expected)
      : op === '|=' ? target === expected || target.startsWith(`${expected}-`)
      : false;
    if (!ok) return false;
  }

  // --- one or more class predicates ---
  const classRe = /\.([\w-]+)/g;
  let classMatch: RegExpExecArray | null;
  let sawClass = false;
  while ((classMatch = classRe.exec(rest))) {
    sawClass = true;
    const classes = (node.attrs.class ?? '').split(/\s+/);
    if (!classes.includes(classMatch[1] as string)) return false;
  }

  // --- :nth-of-type(n) positional fallback ---
  const nth = /:nth-of-type\((\d+)\)/.exec(rest);
  if (nth) {
    const parent = node.parent;
    if (!parent) return false;
    const sameTag = parent.children.filter((c) => c.tag === node.tag);
    if (sameTag.indexOf(node) !== Number(nth[1]) - 1) return false;
  }

  // The selector must have consumed at least ONE meaningful token, and nothing
  // beyond the constructs above may remain.
  if (!idMatch && !tagMatch && !sawAttribute && !sawClass && !nth) return false;

  const leftover = rest
    .replace(/#[\w:.-]+/g, '')
    .replace(/^[a-zA-Z][\w-]*/, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\.[\w-]+/g, '')
    .replace(/:nth-of-type\(\d+\)/g, '')
    .trim();

  return leftover === '';
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/* ------------------------------------------------------------------ *
 * Element inspection used by the engine + record-hint
 * ------------------------------------------------------------------ */

export interface ExtractedElement {
  tag: string;
  selector: string;
  text: string;
  attributes: Record<string, string>;
  /** Ordered selector candidates, best first. */
  candidates: string[];
}

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'form', 'option']);

/** True when an element is worth exposing to the user as a step target. */
export function isInteractive(node: HtmlNode): boolean {
  if (INTERACTIVE_TAGS.has(node.tag)) return true;
  if (node.attrs.onclick) return true;
  const role = node.attrs.role ?? '';
  if (/^(button|link|tab|menuitem|checkbox|radio|textbox|combobox)$/.test(role)) return true;
  if (node.attrs.contenteditable === 'true') return true;
  return false;
}

export function flattenTree(root: HtmlNode): HtmlNode[] {
  const out: HtmlNode[] = [];
  const walk = (node: HtmlNode) => {
    for (const child of node.children) {
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

/**
 * Robust selector candidates for a node, in the documented priority order:
 * id > data-testid > name > aria-label > text, with an nth-of-type fallback.
 */
export function selectorCandidates(node: HtmlNode): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    if (s && !out.includes(s)) out.push(s);
  };

  if (node.attrs.id) push(`#${node.attrs.id}`);
  if (node.attrs['data-testid']) push(`[data-testid="${node.attrs['data-testid']}"]`);
  if (node.attrs['data-test']) push(`[data-test="${node.attrs['data-test']}"]`);
  if (node.attrs.name) push(`${node.tag}[name="${node.attrs.name}"]`);
  if (node.attrs['aria-label']) push(`[aria-label="${node.attrs['aria-label']}"]`);
  if (node.attrs.type) push(`${node.tag}[type="${node.attrs.type}"]`);
  if (node.attrs.placeholder) push(`${node.tag}[placeholder="${node.attrs.placeholder}"]`);

  const text = normaliseWhitespace(node.text);
  if (text && text.length <= 80 && INTERACTIVE_TAGS.has(node.tag)) {
    push(`${node.tag} >> text=${text}`);
  }

  if (node.attrs.href) push(`a[href="${node.attrs.href}"]`);

  // Positional fallback so we always return at least one usable candidate.
  const parent = node.parent;
  if (parent) {
    const sameTag = parent.children.filter((c) => c.tag === node.tag);
    const position = sameTag.findIndex((c) => c === node);
    push(`${node.tag}:nth-of-type(${position + 1})`);
  }
  push(node.tag);

  return out;
}

/** Builds a best-effort stable selector path (`div#a > form > input[name=x]`). */
export function describePath(node: HtmlNode): string {
  const parts: string[] = [];
  let current: HtmlNode | null = node;
  let depth = 0;
  while (current && current.tag !== '#root' && depth < 4) {
    let part = current.tag;
    if (current.attrs.id) part += `#${current.attrs.id}`;
    else if (current.attrs.class) {
      const first = (current.attrs.class as string).split(/\s+/).filter(Boolean)[0];
      if (first) part += `.${first}`;
    }
    parts.unshift(part);
    current = current.parent;
    depth++;
  }
  return parts.join(' > ');
}

/* ------------------------------------------------------------------ *
 * Document-level extraction
 * ------------------------------------------------------------------ */

export interface ParsedDocument {
  title: string;
  text: string;
  forms: Array<{ action: string; method: string; selectors: string[] }>;
  links: Array<{ text: string; href: string; selector: string }>;
  buttons: string[];
  inputs: Array<{ name: string; type: string; placeholder?: string; selector: string }>;
  tables: Array<{ headers: string[]; rowCount: number }>;
  interactive: ExtractedElement[];
}

/** One-stop document analysis shared by the engine and the record-hint endpoint. */
export function analyzeDocument(html: string, baseUrl?: string): ParsedDocument {
  const root = parseHtml(html);
  const nodes = flattenTree(root);

  const titleNode = nodes.find((n) => n.tag === 'title');

  const forms = nodes
    .filter((n) => n.tag === 'form')
    .map((form) => ({
      action: absolutise(form.attrs.action ?? '', baseUrl),
      method: (form.attrs.method ?? 'get').toUpperCase(),
      selectors: selectorCandidates(form),
    }));

  const links = nodes
    .filter((n) => n.tag === 'a' && n.attrs.href)
    .slice(0, 200)
    .map((a) => ({
      text: normaliseWhitespace(a.text),
      href: absolutise(a.attrs.href as string, baseUrl),
      selector: selectorCandidates(a)[0] as string,
    }));

  const buttons = nodes
    .filter((n) => n.tag === 'button' || n.attrs.role === 'button')
    .map((n) => normaliseWhitespace(n.text) || (n.attrs.value ?? ''))
    .filter(Boolean);

  const inputs = nodes
    .filter((n) => n.tag === 'input' || n.tag === 'select' || n.tag === 'textarea')
    .slice(0, 200)
    .map((n) => ({
      name: n.attrs.name ?? n.attrs.id ?? '',
      type: n.attrs.type ?? n.tag,
      placeholder: n.attrs.placeholder,
      selector: selectorCandidates(n)[0] as string,
    }));

  const tables = nodes
    .filter((n) => n.tag === 'table')
    .map((table) => {
      const headerCells = flattenTree(table)
        .filter((n) => n.tag === 'th')
        .map((n) => normaliseWhitespace(n.text));
      const bodyRows = flattenTree(table).filter((n) => n.tag === 'tr').length;
      return { headers: headerCells, rowCount: Math.max(0, bodyRows - (headerCells.length ? 1 : 0)) };
    });

  const interactive = nodes.filter(isInteractive).slice(0, 300).map((n) => ({
    tag: n.tag,
    selector: selectorCandidates(n)[0] as string,
    text: normaliseWhitespace(n.text).slice(0, 160),
    attributes: n.attrs,
    candidates: selectorCandidates(n),
  }));

  return {
    title: titleNode ? normaliseWhitespace(titleNode.text) : '',
    text: normaliseWhitespace(root.text),
    forms,
    links,
    buttons,
    inputs,
    tables,
    interactive,
  };
}

export function absolutise(href: string, baseUrl?: string): string {
  const raw = (href ?? '').trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('javascript:')) return raw;
  if (!baseUrl) return raw;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
}
