import { estimateTokens } from '@agentos/model-gateway';

/**
 * Splits text into chunks of about `maxTokens`, breaking at paragraphs, then sentences, then
 * words, with `overlap` tokens carried over so an idea split across chunks stays findable.
 */
export function chunkText(text: string, maxTokens = 400, overlap = 40): string[] {
  const clean = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
  if (!clean) return [];
  const pieces: string[] = [];
  const split = (block: string, separators: RegExp[]) => {
    if (estimateTokens(block) <= maxTokens || separators.length === 0) {
      if (estimateTokens(block) <= maxTokens) pieces.push(block);
      else {
        // A single "word" longer than a chunk (e.g. a data blob): hard cut.
        const size = maxTokens * 4;
        for (let i = 0; i < block.length; i += size) pieces.push(block.slice(i, i + size));
      }
      return;
    }
    const [separator, ...rest] = separators;
    const parts = block.split(separator!).filter((p) => p.trim());
    if (parts.length === 1) return split(block, rest);
    for (const part of parts) split(part.trim(), rest);
  };
  split(clean, [/\n{2,}/, /(?<=[.!?])\s+/, /\s+/]);

  const chunks: string[] = [];
  let current: string[] = [];
  let tokens = 0;
  for (const piece of pieces) {
    const size = estimateTokens(piece);
    if (tokens + size > maxTokens && current.length > 0) {
      chunks.push(current.join('\n\n'));
      // Carry the tail of the previous chunk forward.
      const tail: string[] = [];
      let carried = 0;
      for (let i = current.length - 1; i >= 0 && carried < overlap; i -= 1) {
        const words = current[i]!.split(/\s+/);
        const take = words.slice(-Math.max(1, overlap - carried));
        tail.unshift(take.join(' '));
        carried += estimateTokens(take.join(' '));
      }
      current = tail;
      tokens = carried;
    }
    current.push(piece);
    tokens += size;
  }
  if (current.length > 0) chunks.push(current.join('\n\n'));
  return chunks;
}

const STOPWORDS = new Set(
  (
    'a an and are as at be but by can do for from has have how i if in into is it its me my of on or ' +
    'our please so that the their them then there these this to was we what when where which who why ' +
    'will with you your bir bu da de diye en gibi her için ile ki mi mı ne o ve veya ya çok şu'
  ).split(' '),
);

/**
 * Builds a to_tsquery('simple', …) string matching ANY of the meaningful words. Only letters
 * and digits survive, so the result is always a valid query.
 */
export function toTsquery(text: string, maxWords = 16): string {
  const words = [
    ...new Set(
      (text.toLocaleLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).filter(
        (w) => w.length > 1 && !STOPWORDS.has(w),
      ),
    ),
  ].slice(0, maxWords);
  return words.join(' | ');
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Readable text from an HTML page: drops scripts, styles and navigation chrome. */
export function htmlToText(html: string): { title: string | undefined; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(script|style|noscript|svg|nav|footer|header|form|iframe|template)\b[\s\S]*?<\/\1>/gi,
      ' ',
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ');
  const decode = (s: string) =>
    s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      if (entity[0] === '#') {
        const code =
          entity[1] === 'x' || entity[1] === 'X'
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : ' ';
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
    });
  const text = decode(body)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    title: title ? decode(title).replace(/\s+/g, ' ').trim() || undefined : undefined,
    text,
  };
}
