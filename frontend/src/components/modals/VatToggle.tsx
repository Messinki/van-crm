// The Plus VAT toggle that sits beside the price box (D-043), shared by the
// manual form and the detail dialog. The box always holds the listed price; this
// marks it ex-VAT and spells out what you'd actually pay.

import { Button } from '@/components/ui/button'
import { VAT_MULTIPLIER, money } from '@/lib/format'
import { cn } from '@/lib/utils'

export function VatToggle({ on, onToggle }: { on: boolean; onToggle: (on: boolean) => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-pressed={on}
      title={on ? 'Price is marked ex-VAT — click to undo' : 'Mark this price as ex-VAT (adds 20%)'}
      className={cn(
        'h-8 shrink-0',
        on &&
          'border-amber-400 bg-amber-100 text-amber-800 hover:bg-amber-200 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300',
      )}
      onClick={() => onToggle(!on)}
    >
      Plus VAT
    </Button>
  )
}

/** "= £12,000 inc. VAT" under the box while the toggle is on. */
export function VatTotal({ on, listed }: { on: boolean; listed: number | null }) {
  if (!on || listed === null || Number.isNaN(listed)) return null
  return (
    <p className="text-xs text-amber-700 dark:text-amber-400">
      = {money(Math.round(listed * VAT_MULTIPLIER))} inc. VAT
    </p>
  )
}
