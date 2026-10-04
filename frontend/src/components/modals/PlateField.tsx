// The number plate box with its Look up plate button and the lookup's outcome
// underneath — shared by the manual form and the detail dialog, so the plate
// looks and behaves the same in both.

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cleanReg, formatReg } from '@/lib/format'
import type { LookupState } from '@/lib/lookup'
import { LookupResult } from './LookupHint'

interface Props {
  id: string
  labelClassName?: string
  /** Pass `value` for a controlled box, or `defaultValue` + `inputRef` for an uncontrolled one. */
  value?: string
  defaultValue?: string
  inputRef?: React.Ref<HTMLInputElement>
  onChange: (value: string) => void
  state: LookupState
  lookupTitle: string
  onLookup: () => void
}

export function PlateField({ id, labelClassName, value, defaultValue, inputRef, onChange, state, lookupTitle, onLookup }: Props) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className={labelClassName}>
        Number plate
      </Label>
      <div className="flex gap-2">
        <Input
          id={id}
          ref={inputRef}
          className="h-8 w-40"
          value={value}
          defaultValue={defaultValue}
          onChange={(e) => onChange(e.target.value)}
          // Typed as-is; tidied into capitals with the usual space on leaving the box.
          onBlur={(e) => {
            const tidy = formatReg(cleanReg(e.target.value))
            if (tidy === e.target.value) return
            e.target.value = tidy
            onChange(tidy)
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={state.kind === 'busy'}
          title={lookupTitle}
          onClick={onLookup}
        >
          {state.kind === 'busy' ? 'Looking up…' : 'Look up plate'}
        </Button>
      </div>
      {state.kind === 'hint' && <p className="text-xs text-muted-foreground">{state.text}</p>}
      {state.kind === 'error' && <p className="text-xs text-destructive">{state.text}</p>}
      {state.kind === 'result' && <LookupResult result={state.result} />}
    </div>
  )
}
