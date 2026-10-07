// Words in a description worth a second look: VAT wording and size terms (D-056).
// Plain regexes, no AI. This file only highlights; the backend's
// normalise.description_hints() reads the same terms to fill empty boxes (D-058).

export type KeywordKind = 'vat' | 'size' | 'wheelbase'

/** Each pattern is matched case-insensitively and must stand as whole words, so
 *  "Swbxyz" or "vatable" don't count. Longer phrases come first in each pattern so
 *  "no VAT to add" wins over "no VAT", and "extra long wheelbase" over "wheelbase". */
export const KEYWORD_PATTERNS: { kind: KeywordKind; source: string }[] = [
  {
    kind: 'vat',
    source: [
      String.raw`\bno\s+vat\s+to\s+add\b`,
      String.raw`\b(?:plus|no)\s+vat\b`,
      String.raw`\+\s*vat\b`,
      String.raw`\bex(?:\.?\s+|-)vat\b`,
      String.raw`\bexcl(?:uding|\.)?\s+vat\b`,
      String.raw`\bvat[\s-]?free\b`,
    ].join('|'),
  },
  { kind: 'size', source: String.raw`\bl[1-4]\s?h[1-3]\b` },
  {
    kind: 'wheelbase',
    source: [
      String.raw`\b(?:(?:extra[\s-]+long|long|medium|short)[\s-]+)?wheel\s?base\b`,
      String.raw`\b(?:lwb|mwb|swb|elwb|xlwb)\b`,
    ].join('|'),
  },
]

// One regex with a named group per kind, so a single left-to-right pass finds
// every match and never overlaps two.
const COMBINED = new RegExp(
  KEYWORD_PATTERNS.map((p) => `(?<${p.kind}>${p.source})`).join('|'),
  'gi',
)

export type Segment = { text: string; kind: KeywordKind | null }

/** Split text into runs of plain text and keyword matches, in order. Joining
 *  every segment's text gives back the input exactly. */
export function keywordSegments(text: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of text.matchAll(COMBINED)) {
    const start = m.index
    if (start > last) out.push({ text: text.slice(last, start), kind: null })
    const kind = (KEYWORD_PATTERNS.find((p) => m.groups?.[p.kind] !== undefined)?.kind ?? 'vat')
    out.push({ text: m[0], kind })
    last = start + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: null })
  return out
}
