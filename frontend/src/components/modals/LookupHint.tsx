import { ApiError, errorMessage } from '@/api/client'
import { lookupDetailLine, lookupHeadline } from '@/lib/lookup'
import type { RegLookupResult } from '@/lib/schema'

/** Two lines under the reg field: what it is, then the read-only extras — plus
 *  any half-success warnings. A lookup can half-succeed: say so, rather than
 *  letting the missing half pass for a plate that simply has no tax record. */
export function LookupResult({ result }: { result: RegLookupResult }) {
  const detail = lookupDetailLine(result)
  return (
    <div className="space-y-0.5 text-xs">
      <p className="font-medium text-green-700 dark:text-green-400">{lookupHeadline(result)}</p>
      {detail && <p className="text-muted-foreground">{detail}</p>}
      {(result.warnings || []).map((text) => (
        <p key={text} className="text-amber-700 dark:text-amber-400">
          {text}
        </p>
      ))}
    </div>
  )
}

export function lookupErrorText(err: unknown): string {
  if (err instanceof ApiError && err.status === 404) {
    return errorMessage(err) || 'No record found for this plate'
  }
  return errorMessage(err)
}
