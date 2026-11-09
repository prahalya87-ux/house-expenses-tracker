import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('The app root element was not found.')

const root = createRoot(rootElement)
const missingSettings = [
  !import.meta.env.VITE_SUPABASE_URL && 'VITE_SUPABASE_URL',
  !import.meta.env.VITE_SUPABASE_ANON_KEY && 'VITE_SUPABASE_ANON_KEY',
].filter((setting): setting is string => Boolean(setting))

if (missingSettings.length > 0) {
  root.render(
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-800">
      <section className="w-full max-w-xl space-y-4 rounded-xl border border-amber-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-amber-800">Finish setting up SmartSpend AI</h1>
        <p className="text-sm text-slate-600">Add these settings to <code>frontend/.env</code> and restart Vite:</p>
        <ul className="list-inside list-disc text-sm font-mono text-slate-700">
          {missingSettings.map((setting) => <li key={setting}>{setting}</li>)}
        </ul>
        <p className="text-sm text-slate-600">
          The variable names are also listed in <code>frontend/.env.example</code>.
        </p>
      </section>
    </main>,
  )
} else {
  void Promise.all([import('./App'), import('./context/AuthContext')])
    .then(([{ default: App }, { AuthProvider }]) => {
      root.render(
        <AppProviders AuthProvider={AuthProvider} App={App} />,
      )
    })
    .catch((error: unknown) => {
      console.error('Failed to start SmartSpend AI:', error)
      root.render(
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-800">
          <p role="alert" className="max-w-xl rounded-xl border border-red-200 bg-white p-6 text-sm text-red-700">
            SmartSpend AI could not start. Check the browser console for details, then restart the development server.
          </p>
        </main>,
      )
    })
}

function AppProviders({
  AuthProvider,
  App,
}: {
  AuthProvider: typeof import('./context/AuthContext').AuthProvider
  App: typeof import('./App').default
}) {
  return (
    <StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>
  )
}