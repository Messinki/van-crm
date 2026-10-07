// The Plus VAT toggle (D-043, D-044): one +VAT chip used beside every price —
// the table cell, the detail dialog and the manual form. Solid amber when the
// price is marked ex-VAT, faint and dashed when not.

import { effectivePrice, money } from '@/lib/format'
import { cn } from '@/lib/utils'

export function VatChip({
  on,
  onToggle,
  disabled,
}: {
  on: boolean
  onToggle: (on: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      title={on ? 'Marked plus VAT — click to undo' : 'Mark this price as plus VAT (adds 20%)'}
      className={cn(
        'shrink-0 rounded border px-1 py-0.5 text-[10px] font-semibold leading-none',
        on
          ? 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
          : 'border-dashed border-muted-foreground/30 text-muted-foreground/50 hover:border-amber-400 hover:text-amber-700',
      )}
      onClick={(e) => {
        // In the table the chip sits inside a clickable row.
        e.stopPropagation()
        onToggle(!on)
      }}
    >
      +VAT
    </button>
  )
}

/** "= £12,000 inc. VAT" under the box while the toggle is on. `listed` is the
 *  box's figure; the total goes through effectivePrice() like every other
 *  price read (D-051), so the × 1.2 sum lives in one place. */
export function VatTotal({ on, listed }: { on: boolean; listed: number | null }) {
  if (!on || listed === null || Number.isNaN(listed)) return null
  return (
    <p className="text-xs text-amber-700 dark:text-amber-400">
      = {money(effectivePrice({ price_gbp: listed, vat_status: 'plus_vat' }))} inc. VAT
    </p>
  )
}
