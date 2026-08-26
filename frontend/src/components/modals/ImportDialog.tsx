// Import from an eBay link. A 409 means the listing is already in the table —
// the response carries its id, so open it rather than erroring.

import { useState } from 'react'
import { toast } from 'sonner'

import { ApiError, errorMessage } from '@/api/client'
import { useImportEbay } from '@/api/queries'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatReg } from '@/lib/format'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (listingId: number) => void
}

export function ImportDialog({ open, onOpenChange, onCreated }: Props) {
  const importEbay = useImportEbay()
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    importEbay.mutate(url.trim(), {
      onSuccess: (listing) => {
        setUrl('')
        onOpenChange(false)
        toast('Imported from eBay')
        // The importer reads a plate out of the title and description when
        // there's exactly one — point at the Look up button rather than
        // pressing it.
        if (listing.reg) toast(`Reg found: ${formatReg(listing.reg)} — Look up plate to fill the rest`)
        onCreated(listing.id)
      },
      onError: (err) => {
        const detail =
          err instanceof ApiError
            ? (err.data as { detail?: { listing_id?: number } } | null)?.detail
            : null
        if (err instanceof ApiError && err.status === 409 && detail?.listing_id) {
          setUrl('')
          onOpenChange(false)
          toast('Already in the list — opened it')
          onCreated(detail.listing_id)
          return
        }
        setError(errorMessage(err))
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import from eBay</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Input
            type="url"
            required
            placeholder="https://www.ebay.co.uk/itm/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={importEbay.isPending}>
              {importEbay.isPending ? 'Importing…' : 'Import'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
