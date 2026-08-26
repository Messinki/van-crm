// Custom-column CRUD: label edits save on blur; ↑/↓ renumber every row's sort_order.

import { useState } from 'react'
import { toast } from 'sonner'

import { useCreateProperty, useDeleteProperty, useProperties, useUpdateProperty } from '@/api/queries'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { PropertyDef } from '@/lib/schema'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const TYPES: { value: PropertyDef['type']; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'select', label: 'Select' },
  { value: 'date', label: 'Date' },
]

export function ColumnsDialog({ open, onOpenChange }: Props) {
  const properties = useProperties()
  const update = useUpdateProperty()
  const rows = properties.data ?? []

  // Swap with the neighbour, then patch every row's sort_order to its new index —
  // the server stores the order, so a partial renumber would leave gaps or ties.
  const reorder = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= rows.length) return
    const reordered = [...rows]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    reordered.forEach((prop, i) => update.mutate({ id: prop.id, fields: { sort_order: i } }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Custom columns</DialogTitle>
        </DialogHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="p-1">Label</th>
                <th className="p-1">Type</th>
                <th className="p-1">Options</th>
                <th className="p-1">Order</th>
                <th className="p-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((prop, index) => (
                <ColumnRow
                  key={prop.id}
                  prop={prop}
                  first={index === 0}
                  last={index === rows.length - 1}
                  onMove={(delta) => reorder(index, delta)}
                />
              ))}
            </tbody>
          </table>
        </div>
        <AddForm />
      </DialogContent>
    </Dialog>
  )
}

function ColumnRow({
  prop,
  first,
  last,
  onMove,
}: {
  prop: PropertyDef
  first: boolean
  last: boolean
  onMove: (delta: number) => void
}) {
  const update = useUpdateProperty()
  const remove = useDeleteProperty()

  return (
    <tr>
      <td className="p-1">
        <Input
          className="h-7"
          defaultValue={prop.label}
          onBlur={(e) =>
            e.target.value !== prop.label && update.mutate({ id: prop.id, fields: { label: e.target.value } })
          }
        />
      </td>
      <td className="p-1 text-muted-foreground">{prop.type}</td>
      <td className="p-1 text-muted-foreground">{prop.options.join(', ')}</td>
      <td className="p-1 whitespace-nowrap">
        <Button variant="ghost" size="sm" className="h-7 px-2" title="Move up" disabled={first} onClick={() => onMove(-1)}>
          ↑
        </Button>
        <Button variant="ghost" size="sm" className="h-7 px-2" title="Move down" disabled={last} onClick={() => onMove(1)}>
          ↓
        </Button>
      </td>
      <td className="p-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          title="Delete"
          onClick={() => {
            if (!confirm(`Delete column "${prop.label}"? Values on every listing will be removed.`)) return
            remove.mutate(prop.id, { onSuccess: () => toast('Column deleted') })
          }}
        >
          🗑
        </Button>
      </td>
    </tr>
  )
}

function AddForm() {
  const create = useCreateProperty()
  const empty = { label: '', type: 'text' as PropertyDef['type'], options: '' }
  const [values, setValues] = useState(empty)

  const add = () => {
    if (!values.label.trim()) return
    create.mutate(
      {
        label: values.label,
        type: values.type,
        options: values.options.split(',').map((s) => s.trim()).filter(Boolean),
      },
      {
        onSuccess: () => {
          setValues(empty)
          toast('Column added')
        },
      },
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
      <Input
        className="h-8 w-40"
        placeholder="Column name"
        value={values.label}
        onChange={(e) => setValues((s) => ({ ...s, label: e.target.value }))}
      />
      <Select
        value={values.type}
        onValueChange={(type) => setValues((s) => ({ ...s, type: type as PropertyDef['type'] }))}
      >
        <SelectTrigger className="h-8 w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        className="h-8 w-56"
        placeholder="Options (comma separated)"
        value={values.options}
        onChange={(e) => setValues((s) => ({ ...s, options: e.target.value }))}
      />
      <Button size="sm" className="h-8" disabled={create.isPending} onClick={add}>
        Add
      </Button>
    </div>
  )
}
