import { useMemo } from 'react'

import { NUMERIC_TYPES } from '@/lib/filtering'
import type { Listing, Schema } from '@/lib/schema'

export const suggestId = (key: string) => 'suggest-' + key

/** <datalist> per spec with `suggest`: the values already used across the
 *  listings, so make/model/year autocomplete from what's been entered before
 *  while staying free text. */
export function Suggestions({ schema, listings }: { schema: Schema; listings: Listing[] }) {
  const lists = useMemo(() => {
    return schema.fields
      .filter((f) => f.suggest)
      .map((spec) => {
        // Spellings that differ only in case or accents are one suggestion — the
        // most used one. The server already stores one spelling per make and
        // model (D-053); this is only a backstop.
        const counts = new Map<string, Map<string, number>>()
        for (const listing of listings) {
          const value = listing[spec.key]
          if (value === null || value === undefined || value === '') continue
          const text = String(value)
          const fold = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
          const spellings = counts.get(fold) ?? new Map<string, number>()
          spellings.set(text, (spellings.get(text) ?? 0) + 1)
          counts.set(fold, spellings)
        }
        const seen = Array.from(counts.values(), (spellings) =>
          Array.from(spellings).reduce((best, next) => (next[1] > best[1] ? next : best))[0],
        )
        // Years read best newest-first; everything else alphabetically.
        const values = seen.sort(
          NUMERIC_TYPES.includes(spec.type)
            ? (a, b) => Number(b) - Number(a)
            : (a, b) => a.localeCompare(b, 'en-GB', { sensitivity: 'base' }),
        )
        return { key: spec.key, values }
      })
  }, [schema, listings])

  return (
    <>
      {lists.map((list) => (
        <datalist key={list.key} id={suggestId(list.key)}>
          {list.values.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      ))}
    </>
  )
}
