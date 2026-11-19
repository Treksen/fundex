import { createClient } from '@supabase/supabase-js'
import { capturingFetch, createReporter } from './errorCapture'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env.local file.')
}

const currentPage = () => (typeof window !== 'undefined' ? window.location.pathname : null)
const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

// Sends rows to the Error Log (admin only can read it). Set up below, once the client exists.
let sendRow = async () => {}
export const errorReporter = createReporter({ send: (row) => sendRow(row), isOnline: online })

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  },
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  },
  // Every failed database / function / storage request is recorded in the Error Log (see errorCapture.js).
  global: {
    fetch: capturingFetch((...args) => fetch(...args), errorReporter.report, { getPage: currentPage, isOnline: online })
  }
})

sendRow = (row) => {
  const details = Object.fromEntries(Object.entries(row.details || {}).filter(([, v]) => v !== null && v !== undefined && v !== ''))
  return supabase.rpc('log_error', {
    p_message: row.message,
    p_context: row.context || null,
    p_details: Object.keys(details).length ? details : null,
    p_severity: row.severity || 'error',
    p_source: row.source || 'frontend',
    p_error_code: row.error_code || null,
  })
}

export default supabase
