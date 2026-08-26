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
        const seen = new Set<string>()
        for (const listing of listings) {
          const value = listing[spec.key]
          if (value === null || value === undefined || value === '') continue
          seen.add(String(value))
        }
        // Years read best newest-first; everything else alphabetically.
        const values = Array.from(seen).sort(
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
