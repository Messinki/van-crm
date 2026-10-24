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
  // A stopped server shows up as a thrown fetch (served build) or as a non-JSON
  // proxy error page (Vite dev); both get one plain message instead of
  // "Failed to fetch" or a JSON syntax error.
  const unreachable = new ApiError("Can't reach the VanCRM server — is it still running?", 0, null)
  let res: Response
  try {
    res = await fetch(path, opts)
  } catch {
    throw unreachable
  }
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    if (!res.ok) throw unreachable
    throw new ApiError('The server sent back something that is not JSON', res.status, null)
  }
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
