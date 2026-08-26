// Formatting helpers ported from app.js — the table, drawer and filter chips all
// share these so a value reads the same everywhere.

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return '£' + Number(value).toLocaleString('en-GB', { maximumFractionDigits: 0 })
}

export function number(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return Number(value).toLocaleString('en-GB')
}

export function formatReg(reg: string | null | undefined): string {
  if (!reg) return ''
  return reg.length === 7 ? reg.slice(0, 4) + ' ' + reg.slice(4) : reg
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function isoInDays(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

export function todayIso(): string {
  return isoInDays(0)
}

/** An ISO-8601 UTC stamp (db.now_iso()) as local date + time. */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** First `words` words of `text`, with an ellipsis if anything was dropped. */
export function truncateWords(text: string | null | undefined, words: number): string {
  const parts = (text || '').split(' ').filter(Boolean)
  if (parts.length <= words) return parts.join(' ')
  return parts.slice(0, words).join(' ') + '…'
}

export function cleanReg(reg: string | null | undefined): string {
  return (reg || '').replace(/\s+/g, '').toUpperCase()
}
