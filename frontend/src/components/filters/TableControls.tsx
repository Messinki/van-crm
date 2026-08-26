// The controls row above the table: title search, status chips, show-inactive
// toggle, column visibility. The property filter chips and the rank panel are
// their own components, rendered alongside.

import { useEffect, useRef, useState } from 'react'
import type { VisibilityState } from '@tanstack/react-table'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { specLabel, type Filters } from '@/lib/filtering'
import type { PropertyDef, Schema } from '@/lib/schema'
import { cn } from '@/lib/utils'

interface Props {
  schema: Schema
  properties: PropertyDef[]
  filters: Filters
  onFiltersChange: (next: Filters) => void
  columnVisibility: VisibilityState
  onColumnVisibilityChange: (next: VisibilityState) => void
}

export function TableControls({
  schema,
  properties,
  filters,
  onFiltersChange,
  columnVisibility,
  onColumnVisibilityChange,
}: Props) {
  const statusSpec = schema.fields.find((f) => f.key === 'status') ?? null

  // The search re-filters the whole table, so don't do it per keystroke.
  const [q, setQ] = useState(filters.q)
  const timer = useRef<ReturnType<typeof setTimeout>>(null)
  useEffect(() => () => clearTimeout(timer.current ?? undefined), [])

  const hideable = [
    ...schema.fields.filter((f) => f.in_table !== false && f.label).map((f) => ({ key: f.key, label: f.label })),
    ...properties.map((p) => ({ key: 'custom:' + p.key, label: p.label })),
  ]

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          clearTimeout(timer.current ?? undefined)
          timer.current = setTimeout(() => onFiltersChange({ ...filters, q: e.target.value }), 150)
        }}
        placeholder="Search titles…"
        className="h-8 w-48"
      />

      <div className="flex flex-wrap gap-1">
        {schema.statuses.map((status) => {
          const on = filters.statuses.includes(status)
          return (
            <button
              key={status}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                on
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-accent',
              )}
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  statuses: on ? filters.statuses.filter((s) => s !== status) : [...filters.statuses, status],
                })
              }
            >
              {specLabel(statusSpec, status)}
            </button>
          )
        })}
      </div>

      <Label className="ml-1 flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
        <Switch
          checked={filters.showInactive}
          onCheckedChange={(checked) => onFiltersChange({ ...filters, showInactive: checked })}
          className="scale-75"
        />
        Show ended
      </Label>

      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              View
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-96 overflow-y-auto">
            {hideable.map((col) => (
              <DropdownMenuCheckboxItem
                key={col.key}
                checked={columnVisibility[col.key] !== false}
                onCheckedChange={(checked) =>
                  onColumnVisibilityChange({ ...columnVisibility, [col.key]: checked })
                }
                onSelect={(e) => e.preventDefault()}
              >
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
