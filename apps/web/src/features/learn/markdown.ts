/**
 * Markdown renderer for lesson content. Lane E (learn feature).
 *
 * Deliberately dependency-free. Security model:
 *   1. The raw source is HTML-escaped FIRST, so no author-supplied markup survives.
 *   2. Only a fixed set of block/inline constructs is then re-introduced by this renderer.
 * Every emitted string is produced from escaped text, so nothing can inject a tag or attribute.
 *
 * Supported: h1–h4, paragraphs, unordered/ordered lists, tables, fenced code blocks,
 * blockquotes, horizontal rules, bold, italic, inline code, and safe links.
 */

/** Escapes the five characters that can break out of text or an attribute context. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) and same-origin relative links are allowed. */
function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (/^https?:\/\//i.test(url) || (url.startsWith('/') && !url.startsWith('//'))) return url;
  return null;
}

/** Inline formatting. Input MUST already be escaped. */
function inline(escaped: string): string {
  let out = escaped;

  // Inline code first, so ** and _ inside code are not treated as emphasis.
  const codeSlots: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => {
    codeSlots.push(`<code class="md-code">${code}</code>`);
    return `\u0000${codeSlots.length - 1}\u0000`;
  });

  // Links: [label](href)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    // href was escaped; undo &amp; so the URL round-trips, then re-validate.
    const decoded = href.replace(/&amp;/g, '&');
    const safe = safeHref(decoded);
    if (!safe) return label;
    return `<a class="md-link" href="${escapeHtml(safe)}" target="_blank" rel="noreferrer noopener">${label}</a>`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');

  // Restore inline code.
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, idx: string) => codeSlots[Number(idx)] ?? '');
  return out;
}

interface TableState {
  header: string[] | null;
  rows: string[][];
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

/**
 * Renders markdown to an HTML string.
 * Returns HTML that is safe to pass to `dangerouslySetInnerHTML` because every text run is escaped.
 */
export function renderMarkdown(source: string): string {
  if (!source) return '';
  // Normalise newlines; escape up-front. All later work happens on escaped text.
  const lines = escapeHtml(source.replace(/\r\n?/g, '\n')).split('\n');

  const html: string[] = [];
  let i = 0;
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: TableState | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? 'ol' : 'ul';
    html.push(`<${tag}>${list.items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
    list = null;
  };
  const flushTable = () => {
    if (!table) return;
    const head = table.header
      ? `<thead><tr>${table.header.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>`
      : '';
    const body = `<tbody>${table.rows
      .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
      .join('')}</tbody>`;
    html.push(`<div class="md-table-wrap"><table class="table md-table">${head}${body}</table></div>`);
    table = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    html.push(`<blockquote class="md-quote">${inline(quote.join(' '))}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
    flushQuote();
  };

  while (i < lines.length) {
    const line = lines[i] as string;

    // ---- fenced code block ----
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      flushAll();
      const lang = fence[1] ?? '';
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i] as string)) {
        body.push(lines[i] as string);
        i += 1;
      }
      i += 1; // consume closing fence
      const cls = lang ? ` class="md-pre language-${lang}"` : ' class="md-pre"';
      html.push(`<pre${cls}><code>${body.join('\n')}</code></pre>`);
      continue;
    }

    // ---- table ----
    const isTableRow = /^\s*\|.*\|\s*$/.test(line);
    const next = lines[i + 1] ?? '';
    const isDivider = /^\s*\|[\s:|-]+\|\s*$/.test(next);
    if (isTableRow && (table || isDivider)) {
      flushParagraph();
      flushList();
      flushQuote();
      if (!table) table = { header: null, rows: [] };
      if (!table.header && isDivider) {
        table.header = splitRow(line);
        i += 2;
        continue;
      }
      table.rows.push(splitRow(line));
      i += 1;
      continue;
    }
    if (table) flushTable();

    // ---- heading ----
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = (heading[1] as string).length;
      html.push(`<h${level} class="md-h${level}">${inline(heading[2] as string)}</h${level}>`);
      i += 1;
      continue;
    }

    // ---- horizontal rule ----
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushAll();
      html.push('<hr class="md-hr" />');
      i += 1;
      continue;
    }

    // ---- blockquote ----
    const bq = line.match(/^\s*&gt;\s?(.*)$/); // '>' was escaped to &gt;
    if (bq) {
      flushParagraph();
      flushList();
      flushTable();
      quote.push(bq[1] as string);
      i += 1;
      continue;
    }
    if (quote.length) flushQuote();

    // ---- list item ----
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushParagraph();
      flushTable();
      const ordered = Boolean(ol);
      const text = (ul ? ul[1] : ol ? ol[1] : '') as string;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(text);
      i += 1;
      continue;
    }
    if (list) flushList();

    // ---- blank line ----
    if (!line.trim()) {
      flushParagraph();
      i += 1;
      continue;
    }

    paragraph.push(line.trim());
    i += 1;
  }

  flushAll();
  return html.join('\n');
}
