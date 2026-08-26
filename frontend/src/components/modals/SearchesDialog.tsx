// Saved-search CRUD: inline edits save on change; the add row appends.

import { useState } from 'react'

import { useCreateSearch, useDeleteSearch, useSearches, useUpdateSearch } from '@/api/queries'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { SavedSearch } from '@/lib/schema'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const NUMBER_FIELDS = ['min_price', 'max_price', 'year_min', 'year_max'] as const

export function SearchesDialog({ open, onOpenChange }: Props) {
  const searches = useSearches()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Saved searches</DialogTitle>
        </DialogHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="p-1">Label</th>
                <th className="p-1">Query</th>
                <th className="p-1">Min £</th>
                <th className="p-1">Max £</th>
                <th className="p-1">Year from</th>
                <th className="p-1">Year to</th>
                <th className="p-1">On</th>
                <th className="p-1" />
              </tr>
            </thead>
            <tbody>
              {(searches.data ?? []).map((search) => (
                <SearchRow key={search.id} search={search} />
              ))}
              <AddRow />
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SearchRow({ search }: { search: SavedSearch }) {
  const update = useUpdateSearch()
  const remove = useDeleteSearch()
  const save = (field: string, value: unknown) => update.mutate({ id: search.id, fields: { [field]: value } })

  return (
    <tr>
      <td className="p-1">
        <Input className="h-7" defaultValue={search.label} onBlur={(e) => e.target.value !== search.label && save('label', e.target.value)} />
      </td>
      <td className="p-1">
        <Input className="h-7" defaultValue={search.query} onBlur={(e) => e.target.value !== search.query && save('query', e.target.value)} />
      </td>
      {NUMBER_FIELDS.map((field) => (
        <td key={field} className="p-1">
          <Input
            className="h-7 w-20"
            type="number"
            defaultValue={search[field] ?? ''}
            onBlur={(e) => {
              const next = e.target.value === '' ? null : Number(e.target.value)
              if (next !== (search[field] ?? null)) save(field, next)
            }}
          />
        </td>
      ))}
      <td className="p-1 text-center">
        <input
          type="checkbox"
          checked={search.enabled}
          onChange={(e) => save('enabled', e.target.checked)}
        />
      </td>
      <td className="p-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          title="Delete"
          onClick={() => {
            if (!confirm(`Delete search "${search.label}"?`)) return
            remove.mutate(search.id)
          }}
        >
          🗑
        </Button>
      </td>
    </tr>
  )
}

function AddRow() {
  const create = useCreateSearch()
  const [values, setValues] = useState({ label: '', query: '', min_price: '', max_price: '', year_min: '', year_max: '' })
  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }))

  const add = () => {
    if (!values.label.trim() || !values.query.trim()) return
    const data: Record<string, unknown> = { label: values.label, query: values.query }
    for (const f of NUMBER_FIELDS) if (values[f] !== '') data[f] = Number(values[f])
    create.mutate(data, {
      onSuccess: () => setValues({ label: '', query: '', min_price: '', max_price: '', year_min: '', year_max: '' }),
    })
  }

  return (
    <tr className="border-t">
      <td className="p-1">
        <Input className="h-7" placeholder="New search" value={values.label} onChange={(e) => set('label', e.target.value)} />
      </td>
      <td className="p-1">
        <Input className="h-7" placeholder="query" value={values.query} onChange={(e) => set('query', e.target.value)} />
      </td>
      {NUMBER_FIELDS.map((field) => (
        <td key={field} className="p-1">
          <Input className="h-7 w-20" type="number" value={values[field]} onChange={(e) => set(field, e.target.value)} />
        </td>
      ))}
      <td className="p-1" />
      <td className="p-1">
        <Button size="sm" className="h-7" disabled={create.isPending} onClick={add}>
          Add
        </Button>
      </td>
    </tr>
  )
}
