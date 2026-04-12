import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './hooks/useAuth'
import AppShell from './components/AppShell'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import TransactionsPage from './pages/TransactionsPage'
import MembersPage from './pages/MembersPage'
import InvestmentsPage from './pages/InvestmentsPage'
import GoalsPage from './pages/GoalsPage'
import ReportsPage from './pages/ReportsPage'
import AuditPage from './pages/AuditPage'
import SettingsPage from './pages/SettingsPage'
import BankReconciliationPage from './pages/BankReconciliationPage'
import LedgerPage from './pages/LedgerPage'
import GovernancePage from './pages/GovernancePage'
import CashFlowPage from './pages/CashFlowPage'
import './styles/main.css'

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="loading-page">
      <div className="spinner" style={{ width: 40, height: 40 }} />
      <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading Fundex…</p>
    </div>
  )
  return user ? children : <Navigate to="/login" replace />
}

const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth()
  if (loading) return null
  return !user ? children : <Navigate to="/" replace />
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              fontFamily: 'var(--font-main)',
              fontSize: '14px'
            },
            success: { iconTheme: { primary: 'var(--accent-emerald)', secondary: 'var(--bg-base)' } },
            error: { iconTheme: { primary: 'var(--accent-red)', secondary: 'var(--bg-base)' } }
          }}
        />
        <Routes>
          <Route path="/login" element={
            <PublicRoute><LoginPage /></PublicRoute>
          } />
          <Route path="/" element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }>
            <Route index element={<DashboardPage />} />
            <Route path="transactions" element={<TransactionsPage />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="investments" element={<InvestmentsPage />} />
            <Route path="goals" element={<GoalsPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="reconciliation" element={<BankReconciliationPage />} />
            <Route path="ledger" element={<LedgerPage />} />
            <Route path="governance" element={<GovernancePage />} />
            <Route path="cashflow" element={<CashFlowPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
