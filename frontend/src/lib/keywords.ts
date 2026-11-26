// Words in a description worth a second look: VAT wording and size terms (D-056),
// engine and gearbox (D-068). Plain regexes, no AI. VAT/size/wheelbase are only
// highlighted here; the backend's normalise.description_hints() reads the same
// terms to fill empty boxes (D-058, D-059). Engine and gearbox are read here, by
// enginesNamed() / gearboxesNamed(), and never stored (D-068).

export type KeywordKind = 'vat' | 'size' | 'wheelbase' | 'engine' | 'gearbox'

// "2.2 BlueHDi", "2.3 MultiJet", "2.2HDI", "2,3 multi-jet": a size, then a family
// word. "Blue HDi" is tried before plain "HDi", so a BlueHDi never reads as an HDi.
const FAMILIES: { family: string; source: string }[] = [
  { family: 'BlueHDi', source: String.raw`blue[\s-]?hdi` },
  { family: 'HDi', source: String.raw`hdi` },
  { family: 'MultiJet', source: String.raw`multi[\s-]?jet|mjet|jtd` },
]
const FAMILY_SOURCE = FAMILIES.map((f) => f.source).join('|')
const ENGINE_SOURCE = String.raw`\b[1-3][.,]\d\s*-?(?:` + FAMILY_SOURCE + String.raw`)\b`

// A description says "Automatic Wipers & Lights" and "automatic roof fan", so there
// the word only counts beside gearbox wording; a bare "automatic" / "auto" /
// "manual" counts in the title only (TITLE_ONLY below).
const GEARBOX_WORD = String.raw`(?:gear\s*box|transmission|trans|box|gears?)`
const AUTOMATIC = [
  String.raw`\b(?:automatic|auto)\s+` + GEARBOX_WORD + String.raw`\b`,
  String.raw`\b(?:gear\s*box|transmission)\s*[:\-]?\s*(?:automatic|auto)\b`,
  String.raw`\bcomfort[\s-]?matic\b`,
  String.raw`\beat\s?8\b`,
  String.raw`\b[79]g[\s-]?tronic\b`,
  String.raw`\bselect\s?shift\b`,
]
const MANUAL = [
  String.raw`\b\d[\s-]?(?:speed|spd)\s+manual\b`,
  String.raw`\bmanual\s+` + GEARBOX_WORD + String.raw`\b`,
  String.raw`\b(?:gear\s*box|transmission)\s*[:\-]?\s*manual\b`,
]
const TITLE_ONLY = { automatic: String.raw`\b(?:automatic|auto)\b`, manual: String.raw`\bmanual\b` }

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
  { kind: 'engine', source: ENGINE_SOURCE },
  { kind: 'gearbox', source: [...AUTOMATIC, ...MANUAL].join('|') },
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

/* ------------------------------------------------- engine + gearbox (D-068) */

const familyOf = (word: string) =>
  FAMILIES.find((f) => new RegExp(`^(?:${f.source})$`, 'i').test(word.replace(/^\s*-?/, '')))?.family

export interface EngineSpec {
  name: string
  models: string[]
  built_from: string | null
  built_to: string | null
}

/** Engines for this model that could have been fitted in this build range
 *  ('YYYY-MM' months, or null when unknown). */
function fitting(engines: EngineSpec[], model: string, built: [string, string] | null): EngineSpec[] {
  return engines.filter(
    (e) =>
      e.models.includes(model) &&
      (!built || ((!e.built_to || built[0] <= e.built_to) && (!e.built_from || built[1] >= e.built_from))),
  )
}

/** The known engines (names from normalise.ENGINES, e.g. "2.2 BlueHDi") this text
 *  names for this model, read against the build range when known. Sellers write
 *  "2.2 HDi" for a BlueHDi too, so "HDi" means either and the build date picks;
 *  a mention that still fits two engines is left out. `title` also lets a bare
 *  size count ("2.3" on a Ducato). */
export function enginesNamed(
  text: string,
  model: string | null,
  engines: EngineSpec[],
  { title = false, built = null }: { title?: boolean; built?: [string, string] | null } = {},
): string[] {
  if (!model || !text) return []
  const known = fitting(engines, model, built).map((e) => e.name)
  const found = new Set<string>()
  const add = (candidates: string[]) => {
    const hits = known.filter((k) => candidates.some((c) => c.toLowerCase() === k.toLowerCase()))
    if (hits.length === 1) found.add(hits[0])
  }
  const full = new RegExp(String.raw`\b([1-3])[.,](\d)(\s*-?(?:${FAMILY_SOURCE}))\b`, 'gi')
  let mentioned = false
  for (const m of text.matchAll(full)) {
    mentioned = true
    const size = `${m[1]}.${m[2]}`
    const family = familyOf(m[3].trim())
    add(family === 'HDi' ? [`${size} HDi`, `${size} BlueHDi`] : [`${size} ${family}`])
  }
  if (title && !mentioned) {
    // A bare size ("2.3", "2.3L"), never a price ("£2,300"), weight or length
    // ("3.5t", "2.3m").
    for (const m of text.matchAll(/\b([1-3])[.,](\d)(?!\d)(?:\s*(?:l|ltr|litres?)\b)?(?!\s*(?:t|tons?|tonnes?|m|metres?|kg|%)\b)/gi)) {
      const size = `${m[1]}.${m[2]}`
      add(known.filter((k) => k.startsWith(size + ' ')))
    }
  }
  return [...found]
}

/** 'manual' / 'automatic' as named in the text. `title` also counts a bare
 *  "manual" or "auto", which in a description too often means something else
 *  ("owner's manual", "auto lights"). */
export function gearboxesNamed(text: string, { title = false }: { title?: boolean } = {}): string[] {
  if (!text) return []
  const auto = [...AUTOMATIC, ...(title ? [TITLE_ONLY.automatic] : [])]
  const manual = [...MANUAL, ...(title ? [TITLE_ONLY.manual] : [])]
  const found: string[] = []
  if (new RegExp(auto.join('|'), 'i').test(text)) found.push('automatic')
  if (new RegExp(manual.join('|'), 'i').test(text)) found.push('manual')
  return found
}
