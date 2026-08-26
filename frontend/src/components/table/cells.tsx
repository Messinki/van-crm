// Cell renderers, ported from app.js renderCell(). Each takes the listing and
// (where needed) its field spec / custom property; the column builder picks
// which one a column uses via the spec's `cell` hint.

import { toast } from 'sonner'

import { useFetchMot, useUpdateListing } from '@/api/queries'
import { Button } from '@/components/ui/button'
import { specLabel } from '@/lib/filtering'
import { formatDate, formatReg, formatStamp, isoInDays, money, number, todayIso, truncateWords } from '@/lib/format'
import type { FieldSpec, Listing, MotSummary, PropertyDef } from '@/lib/schema'
import type { ScoreParts } from '@/lib/ranking'
import { RANK_FACTORS } from '@/lib/ranking'
import { windowLink } from '@/lib/window'
import { errorMessage } from '@/api/client'
import { cn } from '@/lib/utils'

export function ThumbCell({ listing }: { listing: Listing }) {
  const src = listing.image_urls[0]
  return src ? (
    <img src={src} loading="lazy" alt="" className="h-10 w-14 rounded object-cover" />
  ) : (
    <div className="h-10 w-14 rounded bg-muted" />
  )
}

export function TitleCell({ listing }: { listing: Listing }) {
  if (!listing.url) return <span className="font-medium">{listing.title}</span>
  return (
    <a
      {...windowLink(listing.url)}
      title="Open the original listing"
      className="font-medium text-primary hover:underline"
    >
      {listing.title}
    </a>
  )
}

export function SourceBadge({ value }: { value: string }) {
  // Source is free text (suggest-only), so only the values we know about get a
  // dedicated colour and a shortened label — anything else shows as-is.
  const styles: Record<string, string> = {
    ebay: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
    facebook: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
    manual: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  }
  const label = value === 'ebay' ? 'eBay' : value === 'facebook' ? 'FB' : value === 'manual' ? 'Manual' : value
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', styles[value] ?? 'bg-muted')}>
      {label}
    </span>
  )
}

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  considering: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  contacted: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  viewing_booked: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  rejected: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
  purchased: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
}

export function StatusPill({ value, spec }: { value: string; spec: FieldSpec | null }) {
  return (
    <span
      className={cn(
        'whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        STATUS_STYLES[value] ?? 'bg-muted',
      )}
    >
      {specLabel(spec, value)}
    </span>
  )
}

export function MotDueCell({ value }: { value: string | null }) {
  // Stored as an ISO date; shown short, and flagged once it's in the past.
  if (!value) return null
  const overdue = value < todayIso()
  return (
    <span
      className={cn('whitespace-nowrap', overdue && 'font-medium text-destructive')}
      title={overdue ? 'MOT expired' : 'MOT due'}
    >
      {formatDate(value)}
    </span>
  )
}

export function NotesCell({ value }: { value: string }) {
  // A few words only — the full text lives in the detail view, and long notes
  // must not stretch the row.
  const full = (value || '').replace(/\s+/g, ' ').trim()
  return (
    <span className="text-muted-foreground" title={full || undefined}>
      {truncateWords(full, 5)}
    </span>
  )
}

/** Quiet badges: dangerous / major defect counts, then one catch-all warning. */
function MotBadges({ summary }: { summary: MotSummary }) {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'} in the last 3 years`
  const warnings: string[] = []
  if (summary.mileage_warning) warnings.push('the mileage goes backwards in this history')
  if (summary.flagged) warnings.push('corrosion, rust, an oil leak or "excessively" in a recent defect')
  return (
    <>
      {summary.dangerous > 0 && (
        <span
          className="rounded bg-red-100 px-1 text-xs font-semibold text-red-800 dark:bg-red-950 dark:text-red-300"
          title={plural(summary.dangerous, 'dangerous defect')}
        >
          D{summary.dangerous}
        </span>
      )}
      {summary.major > 0 && (
        <span
          className="rounded bg-orange-100 px-1 text-xs font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-300"
          title={plural(summary.major, 'major defect')}
        >
          M{summary.major}
        </span>
      )}
      {warnings.length > 0 && (
        <span
          className="rounded bg-amber-100 px-1 text-xs dark:bg-amber-950"
          title={'Worth a look: ' + warnings.join('; ')}
        >
          ⚠
        </span>
      )}
    </>
  )
}

/** MOT column: no reg → a hint, no cached check → a Check button, else expiry + badges. */
export function MotCell({ listing }: { listing: Listing }) {
  const fetchMot = useFetchMot()

  if (!listing.reg) return <span className="text-xs text-muted-foreground">add reg</span>

  const summary = listing.mot
  if (!summary) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs"
        disabled={fetchMot.isPending}
        title={'Fetch the MOT history for ' + formatReg(listing.reg)}
        onClick={(e) => {
          e.stopPropagation()
          fetchMot.mutate({ id: listing.id })
        }}
      >
        {fetchMot.isPending ? 'Checking…' : 'Check'}
      </Button>
    )
  }

  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      {summary.expiry ? (
        <span
          className={cn(summary.expiry <= isoInDays(30) && 'font-medium text-destructive')}
          title={
            (summary.expiry < todayIso() ? 'MOT expired ' : 'MOT expires ') +
            formatDate(summary.expiry) +
            ' · checked ' +
            formatStamp(summary.fetched_at)
          }
        >
          {formatDate(summary.expiry)}
        </span>
      ) : (
        <span
          className="font-medium text-destructive"
          title="No passing test on record — the latest test is a fail"
        >
          no pass
        </span>
      )}
      <MotBadges summary={summary} />
    </span>
  )
}

/** The Reject / Un-reject toggle (table cell and detail-view variants share it).
 *
 *  Un-rejecting lands on 'new' rather than whatever the status was before: the
 *  previous value isn't stored anywhere, and 'new' is the one status that means
 *  "not judged yet". Nothing is deleted either way — rejecting only drops the
 *  row out of the default view; the Rejected status chip brings it back. */
export function RejectButton({ listing, size = 'table' }: { listing: Listing; size?: 'table' | 'full' }) {
  const update = useUpdateListing()
  const rejected = listing.status === 'rejected'
  return (
    <Button
      variant="outline"
      size="sm"
      className={size === 'table' ? 'h-6 px-2 text-xs' : undefined}
      disabled={update.isPending}
      title={rejected ? 'Put this listing back to New' : 'Mark this listing rejected'}
      onClick={(e) => {
        e.stopPropagation()
        update.mutate(
          { id: listing.id, fields: { status: rejected ? 'new' : 'rejected' } },
          {
            onSuccess: () => {
              // Rejecting makes the row vanish, which reads like a delete, so
              // the toast says where it went.
              if (!rejected) toast('Rejected — select the Rejected chip to see it again')
            },
            onError: (err) => toast.error(errorMessage(err)),
          },
        )
      }}
    >
      {rejected ? 'Un-reject' : 'Reject'}
    </Button>
  )
}

/** The rank score, 0–100, with the three factors behind it in the tooltip. */
export function ScoreCell({ parts }: { parts: ScoreParts | undefined }) {
  if (!parts) return null
  const pct = Math.round(parts.total * 100)
  return (
    <span
      className="flex items-center gap-1.5"
      title={RANK_FACTORS.map((f) => `${f} ${parts[f].toFixed(2)}`).join(' · ')}
    >
      <span className="w-6 text-right text-xs font-semibold tabular-nums">{pct}</span>
      <span className="h-1.5 w-10 overflow-hidden rounded bg-muted">
        <span className="block h-full bg-primary" style={{ width: pct + '%' }} />
      </span>
    </span>
  )
}

export function CustomCell({ listing, prop }: { listing: Listing; prop: PropertyDef }) {
  const value = listing.custom[prop.key]
  if (prop.type === 'checkbox') return <>{value === true ? '✓' : ''}</>
  return <>{value === undefined || value === null ? '' : String(value)}</>
}

/** Plain value cells driven by the spec's `cell` hint. */
export function plainCellText(spec: FieldSpec, value: unknown): string {
  switch (spec.cell) {
    case 'money':
      return money(value as number | null)
    case 'number':
      // `grouped: false` on the spec means "print it raw" — a year, not a quantity.
      return value === null || value === undefined
        ? ''
        : spec.grouped === false
          ? String(value)
          : number(value as number)
    case 'reg':
      return formatReg(value as string | null)
    case 'date':
      return formatDate(value as string | null)
    case 'check':
      return value === true ? '✓' : ''
    default:
      return value === null || value === undefined ? '' : String(value)
  }
}
