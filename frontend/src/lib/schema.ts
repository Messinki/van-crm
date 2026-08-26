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
  widget?: 'reg_lookup' | 'notes'
  sortable?: boolean
  suggest?: boolean
  numeric?: boolean
  grouped?: boolean
  options?: string[]
  labels?: Record<string, string>
  form_default?: string
  placeholder?: string
}

export interface Schema {
  fields: FieldSpec[]
  statuses: string[]
  sources: string[]
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
}

export interface Listing {
  id: number
  title: string
  price_gbp: number | null
  make: string | null
  model: string | null
  year: number | null
  mileage: number | null
  height_code: string | null
  length_code: string | null
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
