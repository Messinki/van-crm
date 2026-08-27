// TanStack Query hooks, one section per resource. All reads load once and stay
// fresh until a mutation touches them (D-035: the frontend loads every listing
// once; filtering/sorting are client-side). Mutations that return the updated
// row write it straight into the ['listings'] cache instead of refetching.

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import { del, get, patch, post } from './client'
import type {
  CheckAllProgress,
  CheckAllResult,
  CheckResult,
  Listing,
  MotResponse,
  PropertyDef,
  RegLookupResult,
  SavedSearch,
  Schema,
  ScrapeProgress,
  ScrapeResult,
} from '@/lib/schema'

/* ----------------------------------------------------------------- schema */

export function useSchema() {
  return useQuery({
    queryKey: ['schema'],
    queryFn: () => get<Schema>('/api/schema'),
    staleTime: Infinity, // the registry only changes with a backend deploy
  })
}

/* --------------------------------------------------------------- listings */

export function useListings() {
  return useQuery({
    queryKey: ['listings'],
    // Fetch everything once; "don't filter on active" (D-035).
    queryFn: () => get<Listing[]>('/api/listings?active=-1'),
  })
}

export function replaceListing(client: QueryClient, updated: Listing) {
  client.setQueryData<Listing[]>(['listings'], (rows) =>
    rows ? rows.map((l) => (l.id === updated.id ? updated : l)) : rows,
  )
}

export function useUpdateListing() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      patch<Listing>(`/api/listings/${id}`, fields),
    onSuccess: (updated) => replaceListing(client, updated),
  })
}

export function useCreateListing() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (fields: Record<string, unknown>) => post<Listing>('/api/listings', fields),
    onSuccess: (created) => {
      client.setQueryData<Listing[]>(['listings'], (rows) => [created, ...(rows ?? [])])
    },
  })
}

export function useDeleteListing() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => del<{ deleted: number }>(`/api/listings/${id}`),
    onSuccess: (result) => {
      client.setQueryData<Listing[]>(['listings'], (rows) =>
        rows ? rows.filter((l) => l.id !== result.deleted) : rows,
      )
    },
  })
}

/** Spec §5.4: is this eBay listing still live? Price + active flag can both move. */
export function useCheckListing() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => post<CheckResult>(`/api/listings/${id}/check`),
    onSuccess: (result) => replaceListing(client, result.listing),
  })
}

/* ------------------------------------------------------------- properties */

export function useProperties() {
  return useQuery({
    queryKey: ['properties'],
    queryFn: () => get<PropertyDef[]>('/api/properties'),
  })
}

export function useCreateProperty() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (fields: { label: string; type: string; options: string[] }) =>
      post<PropertyDef>('/api/properties', fields),
    onSuccess: () => client.invalidateQueries({ queryKey: ['properties'] }),
  })
}

export function useUpdateProperty() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      patch<PropertyDef>(`/api/properties/${id}`, fields),
    onSuccess: () => client.invalidateQueries({ queryKey: ['properties'] }),
  })
}

export function useDeleteProperty() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => del<{ deleted: number }>(`/api/properties/${id}`),
    onSuccess: () => {
      // Deleting strips the key from every listing's custom bag server-side.
      void client.invalidateQueries({ queryKey: ['properties'] })
      void client.invalidateQueries({ queryKey: ['listings'] })
    },
  })
}

/* --------------------------------------------------------------- searches */

export function useSearches() {
  return useQuery({
    queryKey: ['searches'],
    queryFn: () => get<SavedSearch[]>('/api/searches'),
  })
}

export function useCreateSearch() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (fields: Record<string, unknown>) => post<SavedSearch>('/api/searches', fields),
    onSuccess: () => client.invalidateQueries({ queryKey: ['searches'] }),
  })
}

export function useUpdateSearch() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      patch<SavedSearch>(`/api/searches/${id}`, fields),
    onSuccess: (updated) => {
      client.setQueryData<SavedSearch[]>(['searches'], (rows) =>
        rows ? rows.map((s) => (s.id === updated.id ? updated : s)) : rows,
      )
    },
  })
}

export function useDeleteSearch() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => del<{ deleted: number }>(`/api/searches/${id}`),
    onSuccess: (result) => {
      client.setQueryData<SavedSearch[]>(['searches'], (rows) =>
        rows ? rows.filter((s) => s.id !== result.deleted) : rows,
      )
    },
  })
}

/* -------------------------------------------------------------------- MOT */

/** Whatever the server already has cached for this listing's reg — never
 *  spends a DVSA call, so it's safe to run whenever the detail view opens.
 *  Silent: the detail view's MOT panel says so in the panel itself. */
export function useMotReport(listingId: number | null) {
  return useQuery({
    queryKey: ['mot', listingId],
    queryFn: () => get<MotResponse>(`/api/listings/${listingId}/mot`),
    enabled: listingId !== null,
    staleTime: 5 * 60 * 1000,
    meta: { silent: true },
  })
}

/** POST /mot — spends a DVSA call (force=true busts the 7-day cache).
 *  `silent` for the callers that show the failure where the button is. */
export function useFetchMot(silent = false) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, force }: { id: number; force?: boolean }) =>
      post<MotResponse & { cached: true }>(`/api/listings/${id}/mot${force ? '?force=true' : ''}`),
    meta: silent ? { silent: true } : undefined,
    onSuccess: (result, { id }) => {
      client.setQueryData(['mot', id], result)
      // The listing's table summary (listing.mot) changed too.
      client.setQueryData<Listing[]>(['listings'], (rows) =>
        rows ? rows.map((l) => (l.id === id ? { ...l, mot: result.summary } : l)) : rows,
      )
    },
  })
}

/* ------------------------------------------------------------- reg lookup */

export function useRegLookup() {
  return useMutation({
    mutationFn: (reg: string) => post<RegLookupResult>('/api/lookup/reg', { reg }),
    // Callers show lookup errors inline next to the reg field, not as toasts.
    meta: { silent: true },
  })
}

/* ------------------------------------------------- scrape + check-all (D-034) */

export function useScrape() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => post<ScrapeResult>('/api/scrape'),
    // Prices, new rows and active flags all move: reload the lot.
    onSettled: () => client.invalidateQueries({ queryKey: ['listings'] }),
  })
}

/** Poll while a scrape runs so the button can show live progress (D-034). */
export function useScrapeProgress(enabled: boolean) {
  return useQuery({
    queryKey: ['scrape-progress'],
    queryFn: () => get<ScrapeProgress>('/api/scrape/progress'),
    enabled,
    refetchInterval: 1000,
    gcTime: 0,
  })
}

export function useCheckAll() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => post<CheckAllResult>('/api/listings/check-all'),
    onSettled: () => client.invalidateQueries({ queryKey: ['listings'] }),
  })
}

export function useCheckAllProgress(enabled: boolean) {
  return useQuery({
    queryKey: ['check-all-progress'],
    queryFn: () => get<CheckAllProgress>('/api/listings/check-all/progress'),
    enabled,
    refetchInterval: 1000,
    gcTime: 0,
  })
}

/* ----------------------------------------------------------------- import */

export function useImportEbay() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (url: string) => post<Listing>('/api/import/ebay', { url }),
    onSuccess: (created) => {
      client.setQueryData<Listing[]>(['listings'], (rows) => [created, ...(rows ?? [])])
    },
    // The 409 "already in the table" case is handled by the import dialog.
    meta: { silent: true },
  })
}
