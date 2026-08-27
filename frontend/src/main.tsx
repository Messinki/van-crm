import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'

import './index.css'
import App from './App.tsx'
import { Toaster } from '@/components/ui/sonner'
import { errorMessage } from '@/api/client'

// Global error → toast wiring (replaces the old errorMessage() + toast() pairs
// scattered through app.js). A query or mutation that shows its errors inline
// opts out with meta: { silent: true }.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false, // single user, local app — nothing changes behind its back
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.meta?.silent) return
      toast.error('Could not load data: ' + errorMessage(error))
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.silent) return
      toast.error(errorMessage(error))
    },
  }),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  </StrictMode>,
)
