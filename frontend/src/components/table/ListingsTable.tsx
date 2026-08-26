import { useMemo } from 'react'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { filterableProps, type Filters } from '@/lib/filtering'
import { rankActive, type Rank } from '@/lib/ranking'
import type { Listing, PropertyDef, Schema } from '@/lib/schema'
import { visibleListings, type Sort } from '@/lib/visible'
import { cn } from '@/lib/utils'
import { buildColumns, SCORE_KEY } from './columns'

interface Props {
  listings: Listing[]
  schema: Schema
  properties: PropertyDef[]
  filters: Filters
  rank: Rank
  sort: Sort
  onSortChange: (sort: Sort) => void
  /** Sorting by a column hands the order back from rank mode (rank turns off). */
  onRankOff: () => void
  columnVisibility: VisibilityState
  onColumnVisibilityChange: (updater: React.SetStateAction<VisibilityState>) => void
  selectedId: number | null
  onRowClick: (listing: Listing) => void
}

export function ListingsTable({
  listings,
  schema,
  properties,
  filters,
  rank,
  sort,
  onSortChange,
  onRankOff,
  columnVisibility,
  onColumnVisibilityChange,
  selectedId,
  onRowClick,
}: Props) {
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

  const table = useReactTable({
    data: rows,
    columns,
    state: { columnVisibility },
    onColumnVisibilityChange,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.id),
    meta: { scores },
  })

  return (
    <div className="flex min-h-0 flex-col">
      <div className="overflow-auto rounded-md border">
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
                  className={cn(
                    'cursor-pointer',
                    listing.status === 'rejected' && 'opacity-50',
                    !listing.is_active && 'bg-muted/40 [&_td]:text-muted-foreground',
                    selectedId === listing.id && 'bg-accent',
                  )}
                  onClick={(event) => {
                    // The title link is the one thing in a row that isn't
                    // "open the details".
                    if ((event.target as HTMLElement).closest('a')) return
                    onRowClick(listing)
                  }}
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
