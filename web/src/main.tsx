import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { initAuth, isEntra, signIn } from './auth'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false } },
})

/** Entra mode: resolve the session (or show sign-in) before the app mounts.
 *  Dev mode: renders the app immediately — nothing changes. */
function AuthGate() {
  const [state, setState] = useState<'loading' | 'signed-in' | 'signed-out'>(
    isEntra ? 'loading' : 'signed-in',
  )
  useEffect(() => {
    if (!isEntra) return
    initAuth()
      .then((account) => setState(account ? 'signed-in' : 'signed-out'))
      .catch(() => setState('signed-out'))
  }, [])

  if (state === 'loading') {
    return <div className="auth-screen">Signing you in…</div>
  }
  if (state === 'signed-out') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="logo auth-logo">MET<span>S</span></div>
          <p>Master Electronics Ticketing System</p>
          <button className="btn primary" onClick={() => signIn()}>
            Sign in with Microsoft
          </button>
        </div>
      </div>
    )
  }
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate />
    </QueryClientProvider>
  </StrictMode>,
)
