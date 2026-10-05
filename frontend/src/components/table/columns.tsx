// The column model, built from the schema registry + custom properties in
// registry order (mirrors the FIELD_SPECS rule — nothing hardcoded). The score
// column is spliced in right after the thumb while rank mode is on: the score
// is the reason the rows are in the order they are, so it reads first.

import type { ColumnDef, TableMeta } from '@tanstack/react-table'

import { DistanceValue } from '@/components/DistanceValue'
import type { FieldSpec, Listing, PropertyDef, Schema } from '@/lib/schema'
import type { Scores } from '@/lib/ranking'
import {
  CustomCell,
  LocationCell,
  MotCell,
  MotDueCell,
  NotesCell,
  PriceCell,
  RejectButton,
  ScoreCell,
  SourceBadge,
  StatusPill,
  ThumbCell,
  TitleCell,
  plainCellText,
} from './cells'

export const SCORE_KEY = '__score'

export interface ColumnMeta {
  numeric: boolean
  sortable: boolean
}

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    numeric: boolean
    sortable: boolean
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData> {
    scores: Scores | null
    /** Opens the location map from the Location cell. */
    onShowMap?: (listing: Listing) => void
  }
}

function specCell(spec: FieldSpec, listing: Listing, meta: TableMeta<Listing> | undefined): React.ReactNode {
  switch (spec.cell) {
    case 'thumb':
      return <ThumbCell listing={listing} />
    case 'title_link':
      return <TitleCell listing={listing} />
    case 'badge':
      return <SourceBadge value={String(listing[spec.key] ?? '')} />
    case 'status_pill':
      return <StatusPill value={String(listing[spec.key] ?? '')} spec={spec} />
    case 'mot':
      return <MotCell listing={listing} />
    case 'reject':
      return <RejectButton listing={listing} />
    case 'mot_due':
      return <MotDueCell value={(listing[spec.key] as string | null) ?? null} />
    case 'money':
      // Only price carries a money cell; it shows the inc-VAT figure when flagged.
      return <PriceCell listing={listing} />
    case 'notes':
      return <NotesCell value={String(listing[spec.key] ?? '')} />
    case 'distance':
      return <DistanceValue listing={listing} aligned />
    case 'location':
      return <LocationCell listing={listing} onShowMap={meta?.onShowMap} />
    default:
      return plainCellText(spec, listing[spec.key])
  }
}

export function buildColumns(
  schema: Schema,
  properties: PropertyDef[],
  rankOn: boolean,
): ColumnDef<Listing>[] {
  const base: ColumnDef<Listing>[] = schema.fields
    .filter((f) => f.in_table !== false)
    .map((spec) => ({
      id: spec.key,
      header: spec.label,
      cell: ({ row, table }) => specCell(spec, row.original, table.options.meta),
      // Label-less utility columns (thumb, reject) can't be hidden — there'd be
      // nothing legible to re-enable them by.
      enableHiding: Boolean(spec.label),
      meta: { numeric: Boolean(spec.numeric), sortable: spec.sortable !== false },
    }))

  const custom: ColumnDef<Listing>[] = properties.map((prop) => ({
    id: 'custom:' + prop.key,
    header: prop.label,
    cell: ({ row }) => <CustomCell listing={row.original} prop={prop} />,
    enableHiding: true,
    meta: { numeric: prop.type === 'number', sortable: true },
  }))

  const cols = [...base, ...custom]
  if (rankOn) {
    const at = cols.findIndex((c) => c.id === 'thumb') + 1
    cols.splice(at, 0, {
      id: SCORE_KEY,
      header: 'Score',
      cell: ({ row, table }) => <ScoreCell parts={table.options.meta?.scores?.get(row.original.id)} />,
      enableHiding: false,
      meta: { numeric: true, sortable: false },
    })
  }
  return cols
}
