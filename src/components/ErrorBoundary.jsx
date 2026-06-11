import React from 'react'
import { logError } from '../lib/errorLogger'

/**
 * ErrorBoundary — wraps the app to catch unhandled React render
 * errors. Logs them to error_logs and shows a friendly fallback.
 *
 * Usage in main.jsx / App.jsx:
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, errorId: null }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    logError(
      error,
      'ErrorBoundary',
      { componentStack: info?.componentStack || null },
      'frontend',
      'critical'
    ).then(id => {
      this.setState({ errorId: id })
    })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '60vh', gap: 16, padding: 32,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 48 }}>⚠️</div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
          Something went wrong
        </h2>
        <p style={{ color: 'var(--text-muted)', maxWidth: 400, margin: 0, fontSize: 14 }}>
          An unexpected error occurred. It has been logged for the admin to review.
          {this.state.errorId && (
            <span style={{ display: 'block', marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.6 }}>
              Ref: {this.state.errorId}
            </span>
          )}
        </p>
        <button
          className="btn btn-primary"
          onClick={() => {
            this.setState({ hasError: false, errorId: null })
            window.location.href = '/'
          }}
        >
          Return to Dashboard
        </button>
      </div>
    )
  }
}

export default ErrorBoundary
