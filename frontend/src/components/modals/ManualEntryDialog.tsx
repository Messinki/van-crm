// Manual entry, built from the schema registry: every in_form field renders
// from its spec (nothing hardcoded), with reg + Look up plate above the grid.
// The lookup only fills fields the user has left empty.

import { useState } from 'react'
import { toast } from 'sonner'

import { useCreateListing, useRegLookup } from '@/api/queries'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { NUMERIC_TYPES, specLabel } from '@/lib/filtering'
import { cleanReg } from '@/lib/format'
import { LOOKUP_FILLS } from '@/lib/lookup'
import type { FieldSpec, Listing, RegLookupResult, Schema } from '@/lib/schema'
import { lookupErrorText, LookupResult } from './LookupHint'
import { suggestId } from './Suggestions'

interface Props {
  schema: Schema
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (listing: Listing) => void
}

type FormValues = Record<string, string>

function defaults(schema: Schema): FormValues {
  const out: FormValues = {}
  for (const spec of schema.fields) {
    if (spec.in_form && spec.form_default) out[spec.key] = spec.form_default
  }
  return out
}

export function ManualEntryDialog({ schema, open, onOpenChange, onCreated }: Props) {
  const create = useCreateListing()
  const lookup = useRegLookup()
  const [values, setValues] = useState<FormValues>(() => defaults(schema))
  const [lookupState, setLookupState] = useState<
    { kind: 'idle' } | { kind: 'busy' } | { kind: 'hint'; text: string } | { kind: 'error'; text: string } | { kind: 'result'; result: RegLookupResult }
  >({ kind: 'idle' })

  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }))

  const specs = schema.fields.filter((f) => f.in_form && f.key !== 'reg')
  const gridSpecs = specs.filter((f) => f.type !== 'urls' && f.type !== 'textarea')
  const wideSpecs = specs.filter((f) => f.type === 'urls' || f.type === 'textarea')

  const runLookup = () => {
    const reg = cleanReg(values.reg)
    if (!reg) {
      setLookupState({ kind: 'hint', text: 'Enter a number plate first' })
      return
    }
    setLookupState({ kind: 'busy' })
    lookup.mutate(reg, {
      onSuccess: (result) => {
        // Only fill fields the user has left empty; everything stays editable.
        setValues((v) => {
          const next = { ...v }
          for (const field of LOOKUP_FILLS) {
            if (result[field] && !next[field]) next[field] = String(result[field])
          }
          return next
        })
        setLookupState({ kind: 'result', result })
      },
      onError: (err) => setLookupState({ kind: 'error', text: lookupErrorText(err) }),
    })
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const data: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(values)) {
      if (value === '') continue
      data[key] = key === 'image_urls' ? value.split('\n').map((s) => s.trim()).filter(Boolean) : value
    }
    create.mutate(data, {
      onSuccess: (listing) => {
        setValues(defaults(schema))
        setLookupState({ kind: 'idle' })
        onOpenChange(false)
        toast('Listing added')
        onCreated(listing)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a listing</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Number plate</Label>
            <div className="flex gap-2">
              <Input
                value={values.reg ?? ''}
                onChange={(e) => set('reg', e.target.value)}
                className="h-8 w-40"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={lookupState.kind === 'busy'}
                title="Fill in the empty fields from DVSA/DVLA"
                onClick={runLookup}
              >
                {lookupState.kind === 'busy' ? 'Looking up…' : 'Look up plate'}
              </Button>
            </div>
            {lookupState.kind === 'hint' && <p className="text-xs text-muted-foreground">{lookupState.text}</p>}
            {lookupState.kind === 'error' && <p className="text-xs text-destructive">{lookupState.text}</p>}
            {lookupState.kind === 'result' && <LookupResult result={lookupState.result} />}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {gridSpecs.map((spec) => (
              <ManualField key={spec.key} spec={spec} value={values[spec.key] ?? ''} onChange={set} />
            ))}
          </div>
          {wideSpecs.map((spec) => (
            <ManualField key={spec.key} spec={spec} value={values[spec.key] ?? ''} onChange={set} />
          ))}

          <div className="flex justify-end">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Adding…' : 'Add listing'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ManualField({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec
  value: string
  onChange: (key: string, value: string) => void
}) {
  const label = spec.label + (spec.required ? ' *' : '')

  if (spec.type === 'select') {
    // A spec with a form_default has no blank option — it's always set to something.
    return (
      <div className="space-y-1">
        <Label className="text-xs">{label}</Label>
        <select
          className="h-8 w-full rounded-md border bg-transparent px-2 text-sm"
          value={value}
          onChange={(e) => onChange(spec.key, e.target.value)}
        >
          {!spec.form_default && <option value="" />}
          {(spec.options || []).map((o) => (
            <option key={o} value={o}>
              {specLabel(spec, o)}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (spec.type === 'checkbox') {
    return (
      <Label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={(e) => onChange(spec.key, e.target.checked ? 'true' : '')}
        />
        {label}
      </Label>
    )
  }

  if (spec.type === 'urls' || spec.type === 'textarea') {
    return (
      <div className="space-y-1">
        <Label className="text-xs">{label}</Label>
        <Textarea
          rows={spec.type === 'urls' ? 3 : 8}
          placeholder={spec.placeholder}
          value={value}
          onChange={(e) => onChange(spec.key, e.target.value)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        className="h-8"
        type={NUMERIC_TYPES.includes(spec.type) ? 'number' : spec.type === 'date' ? 'date' : spec.type === 'url' ? 'url' : 'text'}
        step={NUMERIC_TYPES.includes(spec.type) ? '1' : undefined}
        list={spec.suggest ? suggestId(spec.key) : undefined}
        required={spec.required}
        value={value}
        onChange={(e) => onChange(spec.key, e.target.value)}
      />
    </div>
  )
}
