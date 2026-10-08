import { useEffect, useMemo, useRef } from 'react'
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { filterableProps, type Filters } from '@/lib/filtering'
import { rankActive, type Rank, type Scores } from '@/lib/ranking'
import type { Listing, PropertyDef, Schema } from '@/lib/schema'
import { visibleListings, type Sort } from '@/lib/visible'
import { cn } from '@/lib/utils'
import { buildColumns, SCORE_KEY } from './columns'

/** The table's columns and its rows in their filtered, ranked/sorted order.
 *  Lives above the table because the detail popup steps through the same
 *  order the table shows. */
export function useTableRows(
  listings: Listing[],
  schema: Schema,
  properties: PropertyDef[],
  filters: Filters,
  rank: Rank,
  sort: Sort,
) {
  const rankOn = rankActive(rank)
  const columns = useMemo(() => buildColumns(schema, properties, rankOn), [schema, properties, rankOn])
  const props = useMemo(() => filterableProps(schema, properties), [schema, properties])
  const { rows, scores } = useMemo(
    () =>
      visibleListings(
        listings,
        filters,
        rank,
        sort,
        props,
        columns.map((c) => ({ key: c.id!, numeric: c.meta?.numeric })),
      ),
    [listings, filters, rank, sort, props, columns],
  )
  return { columns, rows, scores }
}

interface Props {
  listings: Listing[]
  columns: ColumnDef<Listing>[]
  rows: Listing[]
  scores: Scores | null
  rank: Rank
  sort: Sort
  onSortChange: (sort: Sort) => void
  /** Sorting by a column hands the order back from rank mode (rank turns off). */
  onRankOff: () => void
  columnVisibility: VisibilityState
  onColumnVisibilityChange: (updater: React.SetStateAction<VisibilityState>) => void
  /** The listing open in the popup, or the last one it showed. */
  highlightId: number | null
  onRowClick: (listing: Listing) => void
  onShowMap: (listing: Listing) => void
}

export function ListingsTable({
  listings,
  columns,
  rows,
  scores,
  rank,
  sort,
  onSortChange,
  onRankOff,
  columnVisibility,
  onColumnVisibilityChange,
  highlightId,
  onRowClick,
  onShowMap,
}: Props) {
  const rankOn = rankActive(rank)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Stepping through the popup can walk off the visible rows, so keep the
  // highlighted one on screen — it's there behind the popup when it closes.
  useEffect(() => {
    if (highlightId === null) return
    scrollRef.current
      ?.querySelector(`[data-listing-id="${highlightId}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlightId])

  const table = useReactTable({
    data: rows,
    columns,
    state: { columnVisibility },
    onColumnVisibilityChange,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.id),
    meta: { scores, onShowMap },
  })

  return (
    <div className="flex min-h-0 flex-col">
      <div ref={scrollRef} className="overflow-auto rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta
                  const sortable = Boolean(meta?.sortable)
                  // In rank mode the score owns the order, so it carries the
                  // arrow instead of whichever column `sort` still remembers.
                  const active = header.column.id === SCORE_KEY ? true : !rankOn && sort.key === header.column.id
                  const arrow = !active
                    ? ''
                    : header.column.id === SCORE_KEY
                      ? ' ↓'
                      : sort.dir === 'asc'
                        ? ' ↑'
                        : ' ↓'
                  return (
                    <TableHead
                      key={header.id}
                      className={cn('whitespace-nowrap', sortable && 'cursor-pointer select-none')}
                      onClick={
                        sortable
                          ? () => {
                              // Rank mode and a column sort can't both drive the
                              // order — picking a column hands it back.
                              if (rank.enabled) onRankOff()
                              if (sort.key === header.column.id) {
                                onSortChange({ key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })
                              } else {
                                onSortChange({ key: header.column.id, dir: 'asc' })
                              }
                            }
                          : undefined
                      }
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {arrow}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => {
              const listing = row.original
              return (
                <TableRow
                  key={row.id}
                  data-listing-id={listing.id}
                  className={cn(
                    // Clears the sticky header when scrolled into view.
                    'cursor-pointer scroll-mt-10',
                    listing.status === 'rejected' && 'opacity-50',
                    !listing.is_active && 'bg-muted/40 [&_td]:text-muted-foreground',
                    highlightId === listing.id &&
                      'bg-sky-100 hover:bg-sky-100 dark:bg-sky-950 dark:hover:bg-sky-950 [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-sky-500)]',
                  )}
                  onClick={() => onRowClick(listing)}
                >
                  {row.getVisibleCells().map((cell) => {
                    const numeric = cell.column.columnDef.meta?.numeric
                    return (
                      <TableCell key={cell.id} className={cn('py-1.5', numeric && 'text-right tabular-nums')}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    )
                  })}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {listings.length === 0 && (
          <p className="p-8 text-center text-muted-foreground">
            No listings yet — scrape eBay or add one manually.
          </p>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {rows.length} {rows.length === 1 ? 'listing' : 'listings'}
      </p>
    </div>
  )
}
