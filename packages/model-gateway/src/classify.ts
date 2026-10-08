import type { TaskCategory } from './router';

export type Classification = {
  category: TaskCategory;
  /** What decided it: a matched word, or "short" / "long" for length-based calls. */
  signal: string | null;
};

// Word stems per category, English and Turkish (the app's two languages). A stem matches at
// the start of a word, so "research" also matches "researching" and "araştır" "araştırma".
// Stems that are prefixes of unrelated common words are left out or narrowed ("ara" would
// match "araba", so it isn't listed; "plan " needs the space so "planet" doesn't match, and
// "hesapla " / "hesaplay" keep "hesaplarını" (accounts) from reading as "calculate").
const STEMS: [TaskCategory, string[]][] = [
  [
    'private',
    [
      'confidential',
      'private',
      'password',
      'salary',
      'salaries',
      'medical',
      'diagnos',
      'social security',
      'passport',
      'iban',
      'gizli',
      'şifre',
      'parola',
      'maaş',
      'tıbbi',
      'teşhis',
      'kimlik numara',
      'pasaport',
    ],
  ],
  [
    'vision',
    [
      'image',
      'photo',
      'picture',
      'screenshot',
      'diagram',
      'görsel',
      'resim',
      'fotoğraf',
      'ekran görüntü',
    ],
  ],
  [
    'reasoning',
    [
      'analy',
      'step by step',
      'reason through',
      'prove',
      'calculat',
      'strateg',
      'trade-off',
      'tradeoff',
      'pros and cons',
      'decide',
      'evaluat',
      'debug',
      'plan ',
      'analiz',
      'adım adım',
      'hesapla ',
      'hesaplay',
      'kanıtla',
      'strateji',
      'artı ve eksi',
      'karar ver',
      'değerlendir',
    ],
  ],
  [
    'research',
    [
      'research',
      'look up',
      'search',
      'find out',
      'sources',
      'latest',
      'compare',
      'competitor',
      'trend',
      'araştır',
      'kaynak',
      'karşılaştır',
      'rakip',
      'güncel',
      'en son',
    ],
  ],
];

const SHORT_CHARS = 80;
const LONG_CHARS = 2_000;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERNS = STEMS.map(
  ([category, stems]) =>
    [
      category,
      stems.map((stem) => ({ stem, re: new RegExp(`(?<![\\p{L}\\p{N}])${escape(stem)}`, 'u') })),
    ] as const,
);

/**
 * Picks the Smart Router task type for a request, deterministically and without a model call,
 * so the run log can always say why (PRD §7.2 B). Privacy wins over everything else, so
 * sensitive requests reach a local model when one is routed.
 */
export function classifyTask(text: string): Classification {
  // Both casings: "I" lowers to "ı" in Turkish, which would break English words.
  // A trailing space lets stems that end in one ("plan ") match the last word too.
  const haystacks = [`${text.toLowerCase()} `, `${text.toLocaleLowerCase('tr')} `];
  for (const [category, patterns] of PATTERNS) {
    for (const { stem, re } of patterns) {
      if (haystacks.some((h) => re.test(h))) return { category, signal: stem.trim() };
    }
  }
  const length = text.trim().length;
  if (length >= LONG_CHARS) return { category: 'reasoning', signal: 'long' };
  if (length > 0 && length <= SHORT_CHARS) return { category: 'fast', signal: 'short' };
  return { category: 'general', signal: null };
}
