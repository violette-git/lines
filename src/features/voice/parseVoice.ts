// Light parser for spoken labels: "pole 12345" -> { type: 'pole', rest: '12345' },
// "handhole by the driveway" -> { type: 'handhole', rest: 'by the driveway' }.
import type { NodeType } from '@/domain/types';

const TYPE_WORDS: { re: RegExp; type: NodeType }[] = [
  { re: /^(hand\s?holes?|hand-holes?)\b/i, type: 'handhole' },
  { re: /^(splice\s?cases?|splice\s?closures?|splices?)\b/i, type: 'splice_case' },
  { re: /^(building\s?entry|building\s?entries|building|house\s?drop|demarc)\b/i, type: 'building_entry' },
  { re: /^(pedestals?|peds?)\b/i, type: 'pedestal' },
  { re: /^(vaults?|manholes?)\b/i, type: 'vault' },
  { re: /^(risers?)\b/i, type: 'riser' },
  { re: /^(anchors?|down\s?guys?|guys?)\b/i, type: 'anchor' },
  { re: /^(poles?|pull)\b/i, type: 'pole' },
];

const NUMBER_WORDS: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', to: '2', too: '2', three: '3', four: '4', for: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
};

export interface ParsedVoice {
  type: NodeType | null;
  rest: string;
  raw: string;
}

/** Turns "number one two three" into "123" when the rest is purely spoken digits. */
function normalizeDigits(s: string): string {
  const words = s.replace(/^(number|no\.?|tag)\s+/i, '').split(/\s+/).filter(Boolean);
  if (words.length > 0 && words.every((w) => /^\d+$/.test(w) || NUMBER_WORDS[w.toLowerCase()] != null)) {
    return words.map((w) => NUMBER_WORDS[w.toLowerCase()] ?? w).join('');
  }
  return s.replace(/^(number|no\.?)\s+(?=\d)/i, '');
}

export function parseVoice(text: string): ParsedVoice {
  const raw = text.trim();
  for (const { re, type } of TYPE_WORDS) {
    const m = raw.match(re);
    if (m) {
      const rest = raw.slice(m[0].length).replace(/^[\s,.:-]+/, '').trim();
      return { type, rest: normalizeDigits(rest), raw };
    }
  }
  return { type: null, rest: raw, raw };
}
