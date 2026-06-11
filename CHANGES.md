# Phase 9 — Error Log Page (Admin)

## What's new

A persistent error log that captures frontend exceptions, failed RPCs, and
unhandled errors — visible only to admins. Errors show up in real time,
can be filtered, resolved, and cleared.

## Files

| File | What it does |
|------|--------------|
| `supabase/migrations/032_error_logs.sql` | Creates `error_logs` table, RLS policies, and three RPCs: `log_error()`, `resolve_error()`, `reopen_error()` |
| `src/pages/ErrorLogPage.jsx` | Admin-only page: filterable table + mobile cards, resolve/reopen/delete actions, expandable detail view |
| `src/components/AppShell.jsx` | Adds Error Log to admin nav with a live red badge showing open error count |
| `src/components/ErrorBoundary.jsx` | React error boundary — catches unhandled component crashes, logs them, shows a friendly fallback |
| `src/lib/errorLogger.js` | Utility: `logError(err, context, extra, source, severity)` + convenience wrappers |
| `src/styles/main.css` | Table + mobile card CSS for the error log page |

## Two extra steps (manual)

### 1. Register the route in App.jsx
Add this import and route to your existing App.jsx:

```jsx
import ErrorLogPage from './pages/ErrorLogPage'

// Inside your Routes block, alongside the other admin routes:
<Route path="errorlog" element={<ErrorLogPage />} />
```

### 2. Wrap the app with ErrorBoundary in main.jsx
```jsx
import { ErrorBoundary } from './components/ErrorBoundary'

// Wrap your existing <App /> render:
<ErrorBoundary>
  <App />
</ErrorBoundary>
```

### 3. (Recommended) Wire logError into existing catch blocks
In any page where you have `toast.error(...)` inside a catch block,
add one line to also persist the error:

```js
import { logError, logRpcError } from '../lib/errorLogger'

// In a catch block:
catch (err) {
  logError(err, 'TransactionsPage.fetchData')
  toast.error('Failed to load transactions')
}

// After a failed Supabase RPC:
if (error) {
  logRpcError(error, 'verify_deposit', { transaction_id: tx.id })
  toast.error(error.message)
}
```

## Features

### Error Log page
- **Summary cards**: Critical / Error / Warning / Info / Unresolved counts at a glance
- **Filters**: severity, source, resolved/unresolved, message search
- **Table** (desktop) / **Cards** (mobile) with responsive toggle
- **Each row**: severity icon + badge, timestamp, source, context, message, error code, user, status
- **Expandable detail**: click any row to see the full JSON details + stack trace
- **Resolve with note**: optional note field when marking resolved
- **Reopen**: re-open a resolved entry if the issue recurs
- **Delete**: remove a single entry permanently
- **Clear resolved**: bulk delete all resolved entries (appears when unresolved = 0)
- **Live badge**: red count badge on the Error Log nav link, updates in real time via Supabase realtime

### ErrorBoundary
- Wraps the whole app
- Catches unhandled React render errors
- Logs them as `severity: 'critical'` with the component stack trace
- Shows a friendly "Something went wrong" screen with a Ref ID

### errorLogger.js
- `logError(err, context, extra?, source?, severity?)` — base function
- `logWarning(...)` / `logCritical(...)` / `logRpcError(...)` — convenience wrappers
- Silently swallows its own errors so it never crashes the app

## Apply
1. Run `032_error_logs.sql` in Supabase SQL editor
2. Deploy all files
3. Add the route and ErrorBoundary (see above — 5 lines total)
