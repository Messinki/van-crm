import { useEffect, useMemo, useState } from 'react'
import type { VisibilityState } from '@tanstack/react-table'

import { useListings, useProperties, useSchema } from '@/api/queries'
import { TableControls } from '@/components/filters/TableControls'
import { ListingsTable } from '@/components/table/ListingsTable'
import { BLANK_FILTERS, filterableProps, type Filters } from '@/lib/filtering'
import type { Listing, PropertyDef, Schema } from '@/lib/schema'
import type { Rank } from '@/lib/ranking'
import {
  restoreColumnVisibility,
  restoreFilterProps,
  restoreRank,
  saveColumnVisibility,
  saveFilterProps,
  saveRank,
} from '@/lib/store'
import { DEFAULT_SORT, type Sort } from '@/lib/visible'

function App() {
  const schema = useSchema()
  const listings = useListings()
  const properties = useProperties()

  if (!schema.data || !listings.data || !properties.data) {
    return <p className="p-8 text-muted-foreground">Loading…</p>
  }
  return <VanCrm schema={schema.data} listings={listings.data} properties={properties.data} />
}

/** Mounted only once the three boot queries have landed, so the saved filter
 *  state can be validated against the schema and custom properties on restore. */
function VanCrm({
  schema,
  listings,
  properties,
}: {
  schema: Schema
  listings: Listing[]
  properties: PropertyDef[]
}) {
  const props = useMemo(() => filterableProps(schema, properties), [schema, properties])

  const [filters, setFilters] = useState<Filters>(() => ({
    ...BLANK_FILTERS,
    props: restoreFilterProps(props),
  }))
  const [rank, setRank] = useState<Rank>(restoreRank)
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT)
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(restoreColumnVisibility)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => saveFilterProps(filters.props), [filters.props])
  useEffect(() => saveRank(rank), [rank])
  useEffect(() => saveColumnVisibility(columnVisibility), [columnVisibility])

  return (
    <div className="flex h-svh flex-col gap-3 p-4">
      <header className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">VanCRM</h1>
      </header>

      <TableControls
        schema={schema}
        properties={properties}
        filters={filters}
        onFiltersChange={setFilters}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={setColumnVisibility}
      />

      <ListingsTable
        listings={listings}
        schema={schema}
        properties={properties}
        filters={filters}
        rank={rank}
        sort={sort}
        onSortChange={setSort}
        onRankOff={() => setRank({ ...rank, enabled: false })}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={setColumnVisibility}
        selectedId={selectedId}
        onRowClick={(listing) => setSelectedId(listing.id)}
      />
    </div>
  )
}

export default App
