// The faceted filter bar: one chip per active property filter, each opening its
// condition editor in a popover, plus the + Filter menu of unfiltered
// properties. Adding a filter opens its editor straight away.

import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  activeFilters,
  blankCondition,
  conditionSummary,
  distinctValues,
  editorKind,
  EMPTY_TOKEN,
  filterableProps,
  specLabel,
  STORED_KIND,
  type Condition,
  type FilterableProp,
  type Filters,
} from '@/lib/filtering'
import type { Listing, PropertyDef, Schema } from '@/lib/schema'

interface Props {
  schema: Schema
  properties: PropertyDef[]
  listings: Listing[]
  filters: Filters
  onFiltersChange: (next: Filters) => void
}

export function FilterBar({ schema, properties, listings, filters, onFiltersChange }: Props) {
  const props = filterableProps(schema, properties)
  const active = activeFilters(filters, props)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const apply = (key: string, cond: Condition) =>
    onFiltersChange({ ...filters, props: { ...filters.props, [key]: cond } })

  const remove = (key: string) => {
    const next = { ...filters.props }
    delete next[key]
    if (openKey === key) setOpenKey(null)
    onFiltersChange({ ...filters, props: next })
  }

  const taken = new Set(Object.keys(filters.props))
  const choices = props.filter((p) => !taken.has(p.key))

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {active.map(({ prop, cond }) => (
        <Popover
          key={prop.key}
          open={openKey === prop.key}
          // A close event may arrive after another popover has already claimed
          // openKey (adding a filter from the + menu) — only clear our own.
          onOpenChange={(open) =>
            setOpenKey((prev) => (open ? prop.key : prev === prop.key ? null : prev))
          }
        >
          <span className="flex items-center overflow-hidden rounded-full border bg-secondary text-xs">
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1 py-0.5 pl-2.5 pr-1 hover:bg-accent">
                <span className="text-muted-foreground">{prop.label}</span>
                <span className="font-medium">{conditionSummary(prop, cond)}</span>
              </button>
            </PopoverTrigger>
            <button
              className="px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
              title="Remove this filter"
              onClick={() => remove(prop.key)}
            >
              ✕
            </button>
          </span>
          <PopoverContent align="start" className="w-64 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">{prop.label}</p>
            <FilterEditor
              prop={prop}
              cond={cond}
              listings={listings}
              onApply={(next) => apply(prop.key, next)}
            />
          </PopoverContent>
        </Popover>
      ))}

      <Popover
        open={openKey === '+'}
        onOpenChange={(open) => setOpenKey((prev) => (open ? '+' : prev === '+' ? null : prev))}
      >
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 rounded-full px-2 text-xs text-muted-foreground">
            + Filter
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="max-h-80 w-52 overflow-y-auto p-1"
          // Closing normally hands focus back to the + trigger; when a property
          // was just picked that focus shift would dismiss the editor popover
          // that opened on the new chip.
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {choices.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">Every property is filtered already.</p>
          ) : (
            choices.map((prop) => (
              <button
                key={prop.key}
                className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => {
                  apply(prop.key, blankCondition(STORED_KIND[editorKind(prop)]))
                  // Deferred so the click that chose the property finishes before
                  // the new chip's popover mounts — the same click would land as
                  // an "outside interaction" and dismiss it straight away.
                  setTimeout(() => setOpenKey(prop.key), 0)
                }}
              >
                {prop.label || prop.key}
              </button>
            ))
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}

function FilterEditor({
  prop,
  cond,
  listings,
  onApply,
}: {
  prop: FilterableProp
  cond: Condition
  listings: Listing[]
  onApply: (cond: Condition) => void
}) {
  switch (editorKind(prop)) {
    case 'range':
      return <RangeEditor cond={cond as Condition & { kind: 'range' }} onApply={onApply} inputType="number" />
    case 'date':
      return <RangeEditor cond={cond as Condition & { kind: 'range' }} onApply={onApply} inputType="date" />
    case 'bool':
      return <BoolEditor cond={cond as Condition & { kind: 'bool' }} onApply={onApply} />
    case 'select':
      return (
        <SetEditor
          cond={cond as Condition & { kind: 'set' }}
          onApply={onApply}
          options={[
            ...prop.options.map((o) => ({ value: o, label: specLabel(prop.spec, o), muted: false })),
            { value: EMPTY_TOKEN, label: '(empty)', muted: true },
          ]}
        />
      )
    default: {
      // The value list is rebuilt from the current listings every time this opens.
      const { values, hasEmpty } = distinctValues(listings, prop)
      return (
        <SetEditor
          cond={cond as Condition & { kind: 'set' }}
          onApply={onApply}
          options={[
            ...values.map((v) => ({ value: v, label: v, muted: false })),
            ...(hasEmpty ? [{ value: EMPTY_TOKEN, label: '(empty)', muted: true }] : []),
          ]}
        />
      )
    }
  }
}

function RangeEditor({
  cond,
  onApply,
  inputType,
}: {
  cond: Condition & { kind: 'range' }
  onApply: (cond: Condition) => void
  inputType: 'number' | 'date'
}) {
  const [min, setMin] = useState(cond.min === null ? '' : String(cond.min))
  const [max, setMax] = useState(cond.max === null ? '' : String(cond.max))
  // Every change re-filters and re-renders the whole table, so don't do it per keystroke.
  const timer = useRef<ReturnType<typeof setTimeout>>(null)
  useEffect(() => () => clearTimeout(timer.current ?? undefined), [])
  const push = (nextMin: string, nextMax: string) => {
    clearTimeout(timer.current ?? undefined)
    timer.current = setTimeout(
      () => onApply({ kind: 'range', min: nextMin === '' ? null : nextMin, max: nextMax === '' ? null : nextMax }),
      250,
    )
  }
  const dates = inputType === 'date'
  return (
    <div className="space-y-2">
      <Label className="flex items-center justify-between gap-2 text-xs">
        <span className="w-10 text-muted-foreground">{dates ? 'From' : 'Min'}</span>
        <Input
          type={inputType}
          value={min}
          className="h-7"
          onChange={(e) => {
            setMin(e.target.value)
            push(e.target.value, max)
          }}
        />
      </Label>
      <Label className="flex items-center justify-between gap-2 text-xs">
        <span className="w-10 text-muted-foreground">{dates ? 'To' : 'Max'}</span>
        <Input
          type={inputType}
          value={max}
          className="h-7"
          onChange={(e) => {
            setMax(e.target.value)
            push(min, e.target.value)
          }}
        />
      </Label>
    </div>
  )
}

function SetEditor({
  cond,
  onApply,
  options,
}: {
  cond: Condition & { kind: 'set' }
  onApply: (cond: Condition) => void
  options: { value: string; label: string; muted: boolean }[]
}) {
  if (!options.length) return <p className="text-xs text-muted-foreground">No values to pick from yet.</p>
  const selected = new Set(cond.values)
  return (
    <div className="max-h-64 space-y-1 overflow-y-auto">
      {options.map((opt) => (
        <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selected.has(opt.value)}
            onChange={(e) => {
              const values = new Set(selected)
              if (e.target.checked) values.add(opt.value)
              else values.delete(opt.value)
              onApply({ kind: 'set', values: Array.from(values) })
            }}
          />
          <span className={opt.muted ? 'text-muted-foreground' : undefined}>{opt.label}</span>
        </label>
      ))}
    </div>
  )
}

function BoolEditor({
  cond,
  onApply,
}: {
  cond: Condition & { kind: 'bool' }
  onApply: (cond: Condition) => void
}) {
  return (
    <div className="space-y-1">
      {[
        { value: true, label: 'Checked' },
        { value: false, label: 'Unchecked' },
      ].map(({ value, label }) => (
        <label key={label} className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            name="boolfilter"
            checked={(cond.value === true) === value}
            onChange={() => onApply({ kind: 'bool', value })}
          />
          <span>{label}</span>
        </label>
      ))}
    </div>
  )
}
