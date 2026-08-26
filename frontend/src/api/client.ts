// The one fetch wrapper. Errors carry the HTTP status and the parsed body:
// `detail` is usually a string, but a few endpoints send an object so the caller
// can act on it (the import 409 carries the existing listing's id).

export class ApiError extends Error {
  status: number
  data: unknown

  constructor(message: string, status: number, data: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Something went wrong'
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, headers: {} }
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' }
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(path, opts)
  const text = await res.text()
  const data: unknown = text ? JSON.parse(text) : null
  if (!res.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail
    const message =
      (detail && typeof detail === 'object'
        ? (detail as { message?: string }).message
        : (detail as string | undefined)) || res.statusText
    throw new ApiError(message, res.status, data)
  }
  return data as T
}

export const get = <T>(path: string) => api<T>('GET', path)
export const post = <T>(path: string, body?: unknown) => api<T>('POST', path, body)
export const patch = <T>(path: string, body?: unknown) => api<T>('PATCH', path, body)
export const del = <T>(path: string) => api<T>('DELETE', path)
