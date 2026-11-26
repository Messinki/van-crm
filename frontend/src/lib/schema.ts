// Hand-written types for the API's shapes. The registry (GET /api/schema) is the
// single source of truth for listing fields — nothing here names an individual
// listing column beyond the handful the UI itself computes with (price, mileage,
// length_code for ranking; reg/status/title for their dedicated controls).

/** One entry of main.FIELD_SPECS. Visibility defaults to "everywhere" — a
 *  surface is opted out with an explicit false. */
export interface FieldSpec {
  key: string
  label: string
  type:
    | 'text'
    | 'url'
    | 'number'
    | 'integer'
    | 'money'
    | 'date'
    | 'select'
    | 'textarea'
    | 'urls'
    | 'checkbox'
  editable?: boolean
  required?: boolean
  in_table?: boolean
  in_drawer?: boolean
  in_form?: boolean
  section?: 'Details' | 'Images' | 'Notes' | 'MOT'
  cell?: string
  widget?: 'reg_lookup' | 'notes' | 'price_vat' | 'distance' | 'location' | 'engine' | 'vin_check'
  sortable?: boolean
  suggest?: boolean
  numeric?: boolean
  grouped?: boolean
  /** Shown after a numeric field's filter bounds ("≤ 100 mi"). */
  unit?: string
  options?: string[]
  labels?: Record<string, string>
  form_default?: string
  placeholder?: string
}

export interface Schema {
  fields: FieldSpec[]
  statuses: string[]
  sources: string[]
  /** Base models a van note can be ticked for, grouped by make (D-061). */
  models: Record<string, string[]>
  /** Badge shortcuts for the note model picker: label -> models (D-067). */
  model_families: Record<string, string[]>
  /** Engines a note can be limited to, and the models each fits (D-066). */
  engines: { name: string; models: string[] }[]
}

/** What Harry has learnt about a van type (D-061). Either year end may be open. */
export interface VanNote {
  id: number
  /** A recall shows under the popup's Recalls heading (D-067). */
  kind: 'fault' | 'recall'
  models: string[]
  /** Build window, 'YYYY' or 'YYYY-MM'; either end may be open (D-067). */
  built_from: string | null
  built_to: string | null
  /** Empty = any engine. */
  engines: string[]
  gearbox: string | null
  mileage_min: number | null
  mileage_max: number | null
  comment: string
  created_at: string
  updated_at: string
}

/** The compact MOT blob attach_mot() hangs on every listing (mot.summary). */
export interface MotSummary {
  expiry: string | null
  result: string | null
  test_date: string | null
  odometer_miles: number | null
  advisories: number
  dangerous: number
  major: number
  fails: number
  mileage_warning: boolean
  flagged: boolean
  fetched_at: string
  /** D-066: DVSA's manufactureDate (YYYY-MM-DD), engine size (cc, a string),
   *  the engine those point to, and the DVSA Recalls flag. */
  built: string | null
  engine_size: string | null
  engine_guess: string | null
  recall: RecallFlag | null
}

/** DVSA's hasOutstandingRecall. Unknown means no recall data, not "no recalls". */
export type RecallFlag = 'Yes' | 'No' | 'Unknown' | 'Unavailable'

/** POST /api/listings/{id}/vin-check (D-066). */
export interface VinCheckResult {
  vin: string
  registration: string | null
  /** null when the listing has no plate to compare with. */
  reg_matches: boolean | null
  make: string | null
  model: string | null
  built: string | null
  engine_size: string | null
  recall: RecallFlag | null
}

/** A remembered rejection of the same plate (D-055). The listing it names
 *  may since have been deleted — the memory outlives it. */
export interface RejectedBefore {
  listing_id: number
  title: string
  rejected_at: string
}

export interface Listing {
  id: number
  title: string
  price_gbp: number | null
  vat_status: string | null
  make: string | null
  model: string | null
  year: number | null
  mileage: number | null
  height_code: string | null
  length_code: string | null
  engine: string | null
  gearbox: string | null
  vin: string | null
  reg: string | null
  location: string | null
  seller_name: string | null
  url: string | null
  source: string
  status: string
  is_active: boolean
  image_urls: string[]
  mot_due: string | null
  notes: string
  /** User-defined columns; values validated server-side per property type. */
  custom: Record<string, unknown>
  mot: MotSummary | null
  /** The earlier rejection of this listing's plate under another listing
   *  (D-055), attached by rejected.attach(); null when there isn't one. */
  rejected_before: RejectedBefore | null
  /** Where app/geo.py placed `location` (D-048); null when it couldn't. */
  lat: number | null
  lng: number | null
  /** The location string the last lookup ran on — equal to `location` with
   *  null coordinates means postcodes.io didn't recognise it. */
  geocoded_from: string | null
  /** Not from the API: the closest enabled home, attached in the browser by
   *  withNearest() (lib/distance.ts) so it can't go stale when homes change. */
  nearest?: Nearest | null
  external_id: string | null
  first_seen_at: string
  last_seen_at: string
  created_at: string
  updated_at: string
  /** Registry-driven access: any column the schema names. */
  [key: string]: unknown
}

export interface PropertyDef {
  id: number
  key: string
  label: string
  type: 'text' | 'number' | 'checkbox' | 'select' | 'date'
  options: string[]
  sort_order: number
}

export interface SavedSearch {
  id: number
  label: string
  query: string
  min_price: number | null
  max_price: number | null
  category_id: string | null
  enabled: boolean
  year_min: number | null
  year_max: number | null
}

/** A place distances are measured from (D-047). Coordinates come from the
 *  postcode when it's saved, so a home is never unplaced. */
export interface Home {
  id: number
  label: string
  postcode: string
  lat: number
  lng: number
  enabled: boolean
  position: number
  created_at: string
}

export interface Nearest {
  /** Straight-line miles, unrounded — display rounds, sorting doesn't. */
  miles: number
  home: Home
}

/** POST /api/geocode/missing — failed means postcodes.io was unreachable. */
export interface GeocodeResult {
  located: number
  not_found: number
  failed: number
}

export interface RegLookupResult {
  reg: string
  make: string | null
  model: string | null
  year: number | null
  fuel_type: string | null
  colour: string | null
  engine_size: number | null
  length_code: string | null
  height_code: string | null
  mileage: number | null
  mot_due: string | null
  tax_status: string | null
  mot_cached: boolean
  sources: { mot: boolean; ves: boolean }
  warnings: string[]
}

export interface MotDefect {
  level: 'DANGEROUS' | 'MAJOR' | 'MINOR' | 'ADVISORY'
  text: string
}

export interface MotTest {
  date: string | null
  result: string | null
  odometer_miles: number | null
  expiry: string | null
  defects: MotDefect[]
}

/** mot.derive() — every key always present. */
export interface MotDerived {
  make: string | null
  model: string | null
  fuel_type: string | null
  colour: string | null
  engine_size: number | null
  first_used_date: string | null
  built: string | null
  registered: string | null
  recall: RecallFlag | null
  latest_expiry: string | null
  latest_result: string | null
  latest_test_date: string | null
  latest_odometer_miles: number | null
  latest_advisory_count: number
  serious: { dangerous: number; major: number; fails: number }
  mileage_warning: boolean
  keyword_flags: string[]
  mileage_series: { date: string; miles: number }[]
  tests: MotTest[]
}

export type MotResponse =
  | { cached: false; reason?: string }
  | {
      cached: true
      fetched_at: string
      from_cache: boolean
      derived: MotDerived
      summary: MotSummary
      raw: unknown
    }

export interface ScrapeResult {
  new: number
  updated: number
  skipped?: number
  errors: string[]
}

export interface ScrapeProgress {
  running: boolean
  processed: number
  label: string | null
  started_at: number | null
}

export interface CheckAllResult {
  checked: number
  ended: number
  unchanged: number
  errors: string[]
}

export interface CheckAllProgress {
  running: boolean
  processed: number
  total: number
  started_at: number | null
}

export interface CheckResult {
  active: boolean
  message: string
  listing: Listing
}
