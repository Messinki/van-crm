import { useEffect, useMemo, useState } from 'react'
import type { VisibilityState } from '@tanstack/react-table'

import { useHomes, useListings, useProperties, useSchema } from '@/api/queries'
import { FilterBar } from '@/components/filters/FilterBar'
import { RankPanel } from '@/components/filters/RankPanel'
import { TableControls } from '@/components/filters/TableControls'
import { DetailDialog } from '@/components/detail/DetailDialog'
import { ColumnsDialog } from '@/components/modals/ColumnsDialog'
import { HomesDialog } from '@/components/modals/HomesDialog'
import { ImportDialog } from '@/components/modals/ImportDialog'
import { ManualEntryDialog } from '@/components/modals/ManualEntryDialog'
import { SearchesDialog } from '@/components/modals/SearchesDialog'
import { Suggestions } from '@/components/modals/Suggestions'
import { ListingsTable, useTableRows } from '@/components/table/ListingsTable'
import { Topbar } from '@/components/Topbar'
import { withNearest } from '@/lib/distance'
import { BLANK_FILTERS, filterableProps, type Filters } from '@/lib/filtering'
import type { Home, Listing, PropertyDef, Schema } from '@/lib/schema'
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
  const homes = useHomes()

  if (!schema.data || !listings.data || !properties.data || !homes.data) {
    return <p className="p-8 text-muted-foreground">Loading…</p>
  }
  return (
    <VanCrm schema={schema.data} listings={listings.data} properties={properties.data} homes={homes.data} />
  )
}

/** Mounted only once the boot queries have landed, so the saved filter state
 *  can be validated against the schema and custom properties on restore — and
 *  so distances are there from the first paint rather than popping in. */
function VanCrm({
  schema,
  listings: loaded,
  properties,
  homes,
}: {
  schema: Schema
  listings: Listing[]
  properties: PropertyDef[]
  homes: Home[]
}) {
  // Everything below reads listings with their closest home attached (D-047).
  const listings = useMemo(() => withNearest(loaded, homes), [loaded, homes])
  const props = useMemo(() => filterableProps(schema, properties), [schema, properties])

  const [filters, setFilters] = useState<Filters>(() => ({
    ...BLANK_FILTERS,
    props: restoreFilterProps(props),
  }))
  const [rank, setRank] = useState<Rank>(restoreRank)
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT)
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(restoreColumnVisibility)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [dialog, setDialog] = useState<'manual' | 'import' | 'searches' | 'homes' | 'columns' | null>(null)

  const { columns, rows, scores } = useTableRows(listings, schema, properties, filters, rank, sort)

  // The popup steps through the table's current order. A listing the filters
  // hide (say, one just added) still opens, it just has no neighbours.
  const at = selectedId === null ? -1 : rows.findIndex((l) => l.id === selectedId)
  const prevId = at > 0 ? rows[at - 1].id : null
  const nextId = at >= 0 && at < rows.length - 1 ? rows[at + 1].id : null

  useEffect(() => saveFilterProps(filters.props), [filters.props])
  useEffect(() => saveRank(rank), [rank])
  useEffect(() => saveColumnVisibility(columnVisibility), [columnVisibility])

  return (
    <div className="flex h-svh flex-col gap-3 p-4">
      <Topbar
        onAddManual={() => setDialog('manual')}
        onImport={() => setDialog('import')}
        onSearches={() => setDialog('searches')}
        onHomes={() => setDialog('homes')}
        onColumns={() => setDialog('columns')}
      />

      <TableControls
        schema={schema}
        properties={properties}
        filters={filters}
        onFiltersChange={setFilters}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={setColumnVisibility}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <FilterBar
          schema={schema}
          properties={properties}
          listings={listings}
          filters={filters}
          onFiltersChange={setFilters}
        />
        <RankPanel rank={rank} onRankChange={setRank} />
      </div>

      <ListingsTable
        listings={listings}
        columns={columns}
        rows={rows}
        scores={scores}
        rank={rank}
        sort={sort}
        onSortChange={setSort}
        onRankOff={() => setRank({ ...rank, enabled: false })}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={setColumnVisibility}
        selectedId={selectedId}
        onRowClick={(listing) => setSelectedId(listing.id)}
      />

      <DetailDialog
        listing={listings.find((l) => l.id === selectedId) ?? null}
        schema={schema}
        properties={properties}
        onClose={() => setSelectedId(null)}
        position={at >= 0 ? { index: at, total: rows.length } : null}
        onPrev={prevId === null ? null : () => setSelectedId(prevId)}
        onNext={nextId === null ? null : () => setSelectedId(nextId)}
        // Reject/un-reject drops the listing out of the view it was in, so move
        // on to the one below it — or above, at the end — as the order stood
        // when the button was pressed. Nothing left in the view: close.
        onRejectToggled={() => {
          if (at >= 0) setSelectedId(nextId ?? prevId)
        }}
      />

      <ManualEntryDialog
        schema={schema}
        open={dialog === 'manual'}
        onOpenChange={(open) => setDialog(open ? 'manual' : null)}
        onCreated={(listing) => setSelectedId(listing.id)}
      />
      <ImportDialog
        open={dialog === 'import'}
        onOpenChange={(open) => setDialog(open ? 'import' : null)}
        onCreated={setSelectedId}
      />
      <SearchesDialog
        open={dialog === 'searches'}
        onOpenChange={(open) => setDialog(open ? 'searches' : null)}
      />
      <HomesDialog
        listings={listings}
        open={dialog === 'homes'}
        onOpenChange={(open) => setDialog(open ? 'homes' : null)}
      />
      <ColumnsDialog
        open={dialog === 'columns'}
        onOpenChange={(open) => setDialog(open ? 'columns' : null)}
      />
      <Suggestions schema={schema} listings={listings} />
    </div>
  )
}

export default App
