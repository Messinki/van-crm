// The topbar: Scrape and Check live (both with D-034 progress polling), the
// Add dropdown, Searches and Columns dialog openers.

import { useState } from 'react'
import { toast } from 'sonner'

import { useCheckAll, useCheckAllProgress, useScrape, useScrapeProgress } from '@/api/queries'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface Props {
  onAddManual: () => void
  onImport: () => void
  onSearches: () => void
  onColumns: () => void
}

/** eBay warnings ride back in `errors` and every one is shown (D-002) — a typo'd
 *  filter looks exactly like a search that found nothing. */
function toastErrors(errors: string[] | undefined) {
  for (const message of errors || []) toast.error(message)
}

export function Topbar({ onAddManual, onImport, onSearches, onColumns }: Props) {
  const scrape = useScrape()
  const checkAll = useCheckAll()
  const [scraping, setScraping] = useState(false)
  const [checking, setChecking] = useState(false)
  const scrapeProgress = useScrapeProgress(scraping)
  const checkProgress = useCheckAllProgress(checking)

  const scrapeLabel = () => {
    if (!scraping) return 'Scrape eBay'
    const p = scrapeProgress.data
    if (!p || !p.running) return 'Scraping…'
    const secs = Math.round(Date.now() / 1000 - (p.started_at ?? Date.now() / 1000))
    return `Scraping… (${p.processed} processed, ${secs}s)`
  }

  const checkLabel = () => {
    if (!checking) return 'Check live'
    const p = checkProgress.data
    if (!p || !p.running) return 'Checking…'
    return `Checking… (${p.processed}/${p.total})`
  }

  return (
    <header className="flex flex-wrap items-center gap-2">
      <h1 className="mr-2 text-lg font-semibold">VanCRM</h1>

      <Button
        size="sm"
        disabled={scraping}
        onClick={() => {
          setScraping(true)
          scrape.mutate(undefined, {
            onSuccess: (result) => {
              toast(`${result.new} new · ${result.updated} updated`)
              toastErrors(result.errors)
            },
            onSettled: () => setScraping(false),
          })
        }}
      >
        {scrapeLabel()}
      </Button>

      <Button
        size="sm"
        variant="outline"
        disabled={checking}
        onClick={() => {
          if (!confirm('Re-check every active eBay listing? This makes one eBay call per listing.')) return
          setChecking(true)
          checkAll.mutate(undefined, {
            onSuccess: (result) => {
              toast(
                result.checked
                  ? `${result.checked} checked · ${result.ended} ended`
                  : 'No active eBay listings to check',
              )
              toastErrors(result.errors)
            },
            onSettled: () => setChecking(false),
          })
        }}
      >
        {checkLabel()}
      </Button>

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              Add listing
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onAddManual}>Manual entry</DropdownMenuItem>
            <DropdownMenuItem onSelect={onImport}>Import from eBay link</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" variant="outline" onClick={onSearches}>
          Searches
        </Button>
        <Button size="sm" variant="outline" onClick={onColumns}>
          Columns
        </Button>
      </div>
    </header>
  )
}
