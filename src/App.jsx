import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './hooks/useAuth'
import AppShell from './components/AppShell'
import LoginPage from './pages/LoginPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ChangePasswordRequiredPage from './pages/ChangePasswordRequiredPage'
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
import ErrorLogPage from "./pages/ErrorLogPage";
import { UpdateProvider } from './hooks/useAppUpdate'

const ProtectedRoute = ({ children }) => {
  const { user, loading, mustChangePassword } = useAuth()
  if (loading) return (
    <div className="loading-page">
      <div className="spinner" style={{ width: 40, height: 40 }} />
      <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading Nitalink…</p>
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  // An admin set a temporary password: the member must choose their own before using the app.
  if (mustChangePassword) return <ChangePasswordRequiredPage />
  return children
}

const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth()
  if (loading) return null
  return !user ? children : <Navigate to="/" replace />
}

// A password-reset link signs the member in temporarily. Force the "set a new password" screen wherever they land.
const RecoveryGate = ({ children }) => {
  const { recovery } = useAuth()
  return recovery ? <ResetPasswordPage /> : children
}

function App() {
  return (
    <UpdateProvider>
    <BrowserRouter>
      <AuthProvider>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
              fontFamily: "var(--font-main)",
              fontSize: "14px",
            },
            success: {
              iconTheme: {
                primary: "var(--accent-emerald)",
                secondary: "var(--bg-base)",
              },
            },
            error: {
              iconTheme: {
                primary: "var(--accent-red)",
                secondary: "var(--bg-base)",
              },
            },
          }}
        />
        <RecoveryGate>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/login"
            element={
              <PublicRoute>
                <LoginPage />
              </PublicRoute>
            }
          />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
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
            <Route path="security" element={<SettingsPage section="security" />} />
            <Route path="updates" element={<SettingsPage section="updates" />} />
            <Route path="admin" element={<SettingsPage section="admin" />} />
            <Route path="errorlog" element={<ErrorLogPage />} />
          </Route>
        </Routes>
        </RecoveryGate>
      </AuthProvider>
    </BrowserRouter>
    </UpdateProvider>
  );
}

export default App
