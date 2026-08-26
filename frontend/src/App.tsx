import { useListings, useProperties, useSchema } from '@/api/queries'

// Phase 2 throwaway page: raw listing titles straight from the data layer.
// Replaced by the real table in Phase 3.
function App() {
  const schema = useSchema()
  const listings = useListings()
  const properties = useProperties()

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-4 text-2xl font-semibold">VanCRM</h1>
      <p className="mb-4 text-muted-foreground">
        {schema.data ? `${schema.data.fields.length} fields` : 'schema…'} ·{' '}
        {properties.data ? `${properties.data.length} custom properties` : 'properties…'} ·{' '}
        {listings.data ? `${listings.data.length} listings` : 'listings…'}
      </p>
      <ul className="list-disc space-y-1 pl-6" data-testid="titles">
        {listings.data?.map((l) => (
          <li key={l.id}>{l.title}</li>
        ))}
      </ul>
    </div>
  )
}

export default App
