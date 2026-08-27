// The detail view's MOT panel: the derived DVSA report, plus a Refresh once
// there is something to refresh. Ported from app.js motPanel()/motReport().
//
// There is deliberately no "Check MOT" button here. Fetching is "Look up plate"
// up in the reg field: it makes the same DVSA call, warms the same cache and
// fills the listing's fields in as well, and the report below then loads itself
// for free. The one job left over is forcing a re-pull past the 7-day cache.

import { useState } from 'react'

import { errorMessage } from '@/api/client'
import { useFetchMot, useMotReport } from '@/api/queries'
import { Button } from '@/components/ui/button'
import { formatDate, formatStamp, isoInDays, number } from '@/lib/format'
import type { Listing, MotDerived, MotTest } from '@/lib/schema'
import { cn } from '@/lib/utils'

export function MotPanel({ listing }: { listing: Listing }) {
  // Safe to run whenever the dialog opens: the GET only ever reads the cache.
  const report = useMotReport(listing.reg ? listing.id : null)
  const refresh = useFetchMot(true)
  const [error, setError] = useState('')

  const data = report.data
  const derived = data?.cached ? data.derived : null
  const fetchedAt = data?.cached ? data.fetched_at : null
  // Hidden until there is a cached check to re-pull — the report may still be in
  // flight, but listing.mot proves DVSA has answered for this reg at some point.
  const canRefresh = Boolean(listing.mot || derived)

  return (
    <div className="space-y-2">
      {canRefresh && (
        <Button
          variant="outline"
          size="sm"
          disabled={refresh.isPending}
          title="Force a re-pull past the 7-day cache"
          onClick={() => {
            setError('')
            refresh.mutate(
              { id: listing.id, force: true },
              { onError: (err) => setError(errorMessage(err)) },
            )
          }}
        >
          {refresh.isPending ? 'Refreshing…' : 'Refresh'}
        </Button>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      {!error && derived && fetchedAt && (
        <p className="text-xs text-muted-foreground">Checked {formatStamp(fetchedAt)}</p>
      )}
      {!derived && !error && <MotPlaceholder listing={listing} loading={report.isFetching} failed={report.isError} />}

      {derived && <MotReport derived={derived} />}
    </div>
  )
}

/** What the panel says while there is no report: loading, a load failure, or a
 *  pointer at the button that would fetch one. */
function MotPlaceholder({
  listing,
  loading,
  failed,
}: {
  listing: Listing
  loading: boolean
  failed: boolean
}) {
  if (failed) {
    return (
      <p className="text-xs text-destructive">
        Could not load the cached report — Refresh re-fetches it.
      </p>
    )
  }
  if (loading) return <p className="text-xs text-muted-foreground">Loading the report…</p>
  return (
    <p className="text-xs text-muted-foreground">
      {listing.reg
        ? 'Press Look up plate above to fetch the MOT history.'
        : 'Add a number plate above to see the MOT history.'}
    </p>
  )
}

function MotReport({ derived }: { derived: MotDerived }) {
  const vehicle = [
    derived.make,
    derived.model,
    derived.fuel_type,
    derived.colour,
    derived.first_used_date ? 'first used ' + derived.first_used_date.slice(0, 4) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const expiry = derived.latest_expiry
  const { dangerous, major, fails } = derived.serious
  const counts = [
    fails ? `${fails} fail${fails === 1 ? '' : 's'}` : null,
    dangerous ? `${dangerous} dangerous` : null,
    major ? `${major} major` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="space-y-2 text-sm">
      {vehicle && <p className="text-muted-foreground">{vehicle}</p>}

      <p>
        <strong className={derived.latest_result === 'PASSED' ? 'text-green-700 dark:text-green-400' : 'text-destructive'}>
          {derived.latest_result || 'no tests on record'}
        </strong>
        {derived.latest_test_date && ' on ' + formatDate(derived.latest_test_date)}
        {expiry && ' · expires '}
        {expiry && (
          <span className={cn(expiry <= isoInDays(30) && 'font-medium text-destructive')}>
            {formatDate(expiry)}
          </span>
        )}
      </p>

      {counts && (
        <p
          className="text-muted-foreground"
          title="A fail that was fixed on a retest still counts — it is history, not a verdict"
        >
          Last 3 years: {counts}
        </p>
      )}

      {derived.keyword_flags.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-amber-700 dark:text-amber-400">
          {derived.keyword_flags.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      )}

      {derived.mileage_series.length > 0 && (
        <>
          {derived.mileage_warning && (
            <p className="font-medium text-destructive">
              Mileage goes backwards in this history — possible clocking.
            </p>
          )}
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {[...derived.mileage_series].reverse().map((point) => (
              <li key={point.date + point.miles}>
                {formatDate(point.date)} — {number(point.miles)} mi
              </li>
            ))}
          </ul>
        </>
      )}

      {derived.tests.length > 0 && (
        <details className="rounded-md border p-2">
          <summary className="cursor-pointer text-xs font-medium">
            All {derived.tests.length} test{derived.tests.length === 1 ? '' : 's'}
          </summary>
          <div className="mt-2 space-y-3">
            {derived.tests.map((test, i) => (
              <MotTestBlock key={(test.date ?? '') + i} test={test} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

// Severity order, so a test's defects read worst-first however DVSA listed them.
const DEFECT_ORDER = ['DANGEROUS', 'MAJOR', 'MINOR', 'ADVISORY']

const DEFECT_STYLES: Record<string, string> = {
  dangerous: 'text-destructive font-medium',
  major: 'text-orange-700 dark:text-orange-400',
  minor: 'text-muted-foreground',
  advisory: 'text-muted-foreground',
}

function MotTestBlock({ test }: { test: MotTest }) {
  const sorted = [...test.defects].sort(
    (a, b) => DEFECT_ORDER.indexOf(a.level) - DEFECT_ORDER.indexOf(b.level),
  )
  return (
    <div className="space-y-1">
      <div className="flex gap-3 text-xs">
        <span>{formatDate(test.date)}</span>
        <span className={test.result === 'PASSED' ? 'text-green-700 dark:text-green-400' : 'text-destructive'}>
          {test.result || ''}
        </span>
        <span className="text-muted-foreground">
          {test.odometer_miles === null ? '' : number(test.odometer_miles) + ' mi'}
        </span>
      </div>
      {sorted.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-xs">
          {sorted.map((defect, i) => (
            <li key={defect.text + i} className={DEFECT_STYLES[defect.level.toLowerCase()]}>
              {defect.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No defects recorded</p>
      )}
    </div>
  )
}
