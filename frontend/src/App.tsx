import { useEffect, useState } from 'react'

// Phase 1 hello page: proves the toolchain and the /api proxy work.
// Replaced by the real app from Phase 3 onward.
function App() {
  const [fieldCount, setFieldCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/schema')
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.json()
      })
      .then((schema: { fields: unknown[] }) => setFieldCount(schema.fields.length))
      .catch((err: Error) => setError(err.message))
  }, [])

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-2">
      <h1 className="text-2xl font-semibold">VanCRM</h1>
      {error ? (
        <p className="text-destructive">Could not reach the API: {error}</p>
      ) : fieldCount === null ? (
        <p className="text-muted-foreground">Loading schema…</p>
      ) : (
        <p className="text-muted-foreground">
          API connected — {fieldCount} fields in the schema registry.
        </p>
      )}
    </div>
  )
}

export default App
