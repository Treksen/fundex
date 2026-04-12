import MemberAvatar from './MemberAvatar'
import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, ArrowLeftRight, Users, TrendingUp,
  Target, FileBarChart, Shield, Settings, LogOut,
  Bell, Menu, X, ChevronRight, Download, Sun, Moon,
  GitMerge, Lightbulb, BookOpen, Vote, BarChart2
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { supabase } from '../lib/supabase'
import InsightsPanel from './InsightsPanel'
import toast from 'react-hot-toast'

const NAV_ITEMS = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/transactions', icon: ArrowLeftRight, label: 'Transactions' },
  { path: '/members', icon: Users, label: 'Members' },
  { path: '/investments', icon: TrendingUp, label: 'Investments' },
  { path: '/goals', icon: Target, label: 'Goals' },
  { path: '/reports', icon: FileBarChart, label: 'Reports' },
  { path: '/governance', icon: Vote, label: 'Governance' },
  { path: '/cashflow', icon: BarChart2, label: 'Cash Flow' },
]

const ADMIN_ITEMS = [
  { path: '/ledger', icon: BookOpen, label: 'Ledger' },
  { path: '/reconciliation', icon: GitMerge, label: 'Reconciliation' },
  { path: '/audit', icon: Shield, label: 'Audit Log' },
  { path: '/settings', icon: Settings, label: 'Settings' },
]

// Bottom nav shows most-used pages only
const BOTTOM_NAV = [
  { path: '/', icon: LayoutDashboard, label: 'Home' },
  { path: '/transactions', icon: ArrowLeftRight, label: 'Txns' },
  { path: '/members', icon: Users, label: 'Members' },
  { path: '/governance', icon: Vote, label: 'Govern' },
  { path: '/settings', icon: Settings, label: 'Settings' },
]

export default function AppShell() {
  const { profile, signOut, isAdmin } = useAuth()
  const { isDark, toggle: toggleTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [pendingGovernance, setPendingGovernance] = useState(0)
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showInstallBanner, setShowInstallBanner] = useState(false)

  // Capture PWA install prompt
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
      // Show banner after 3 seconds if not dismissed before
      const dismissed = sessionStorage.getItem('pwa-banner-dismissed')
      if (!dismissed) {
        setTimeout(() => setShowInstallBanner(true), 3000)
      }
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstallApp = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') toast.success('Fundex added to your home screen! 🎉')
    setDeferredPrompt(null)
    setShowInstallBanner(false)
  }

  const dismissInstallBanner = () => {
    setShowInstallBanner(false)
    sessionStorage.setItem('pwa-banner-dismissed', '1')
  }

  useEffect(() => {
    if (!profile) return
    fetchUnreadCount()
    fetchPendingApprovals()
    fetchPendingGovernance()
    const notifChannel = supabase.channel('shell-notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` }, () => fetchUnreadCount())
      .subscribe()
    const approvalChannel = supabase.channel('shell-approvals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawal_approvals', filter: `approver_id=eq.${profile.id}` }, () => fetchPendingApprovals())
      .subscribe()
    const govChannel = supabase.channel('shell-governance')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'action_approvals' }, () => fetchPendingGovernance())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'action_approval_votes' }, () => fetchPendingGovernance())
      .subscribe()
    return () => { supabase.removeChannel(notifChannel); supabase.removeChannel(approvalChannel); supabase.removeChannel(govChannel) }
  }, [profile])

  const fetchUnreadCount = async () => {
    const { count } = await supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', profile.id).eq('is_read', false)
    setUnreadCount(count || 0)
  }

  const fetchPendingApprovals = async () => {
    const { count } = await supabase.from('withdrawal_approvals').select('*, transactions!inner(status)', { count: 'exact', head: true }).eq('approver_id', profile.id).eq('status', 'pending').eq('transactions.status', 'pending')
    setPendingApprovals(count || 0)
  }

  const fetchPendingGovernance = async () => {
    if (!profile) return
    // Count action_approvals that are pending AND the current user hasn't voted on AND didn't create
    const { data } = await supabase
      .from('action_approvals')
      .select('id, requested_by, action_approval_votes!left(voter_id)')
      .eq('status', 'pending')
      .neq('requested_by', profile.id)
    if (data) {
      const unvoted = data.filter(a =>
        !a.action_approval_votes?.some(v => v.voter_id === profile.id)
      )
      setPendingGovernance(unvoted.length)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    toast.success('Signed out successfully')
    navigate('/login')
  }

  const getPageTitle = () => {
    const all = [...NAV_ITEMS, ...ADMIN_ITEMS]
    const match = all.find(item => item.path === location.pathname)
    return match?.label || 'Fundex'
  }

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 99 }} onClick={() => setSidebarOpen(false)} />
      )}

      {/* SIDEBAR */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <div className="logo-mark">
            <div className="logo-icon"><img src="/logo.jpeg" alt="Fundex Savings" /></div>
            <div className="logo-text">
              <span className="logo-name">Fundex</span>
              <span className="logo-tagline">Savings & Investment</span>
            </div>
          </div>
        </div>
        <nav className="sidebar-nav">
          <span className="nav-section-label">Navigation</span>
          {NAV_ITEMS.map(item => (
            <NavLink key={item.path} to={item.path} end={item.path === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={() => setSidebarOpen(false)}>
              <item.icon size={16} />
              {item.label}
              {item.path === '/transactions' && pendingApprovals > 0 && <span className="nav-badge">{pendingApprovals}</span>}
              {item.path === '/governance' && pendingGovernance > 0 && <span className="nav-badge">{pendingGovernance}</span>}
            </NavLink>
          ))}
          {isAdmin && (
            <>
              <span className="nav-section-label" style={{ marginTop: 16 }}>Admin</span>
              {ADMIN_ITEMS.map(item => (
                <NavLink key={item.path} to={item.path} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={() => setSidebarOpen(false)}>
                  <item.icon size={16} />{item.label}
                </NavLink>
              ))}
            </>
          )}
          {/* Install app button in sidebar */}
          {deferredPrompt && (
            <button
              className="nav-item"
              style={{ marginTop: 8, border: '1px dashed var(--olive)', background: 'var(--olive-pale)', color: 'var(--olive)', width: '100%' }}
              onClick={handleInstallApp}
            >
              <Download size={16} /> Install App
            </button>
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="user-card" onClick={() => navigate('/settings')}>
            <MemberAvatar name={profile?.name} avatarUrl={profile?.avatar_url} size={34} />
            <div className="user-info">
              <div className="user-name">{profile?.name?.split(' ')[0]} {profile?.name?.split(' ')[1]}</div>
              <div className="user-role">{profile?.role}</div>
            </div>
            <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
          </div>
          <button className="btn btn-secondary w-full mt-2" style={{ justifyContent: 'center', fontSize: 13 }} onClick={handleSignOut}>
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <div className="main-content">
        <header className="topbar">
          <div className="flex items-center gap-3">
            <button className="menu-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div className="topbar-logo">
              <img src="/logo.jpeg" alt="Fundex" />
              <span>Fundex</span>
            </div>
            <h1 className="topbar-title">{getPageTitle()}</h1>
          </div>
          <div className="topbar-actions">
            {pendingApprovals > 0 && (
              <button
                className="btn btn-sm"
                style={{ background: 'rgba(230,144,10,0.1)', border: '1px solid rgba(230,144,10,0.3)', color: 'var(--accent-amber)', fontWeight: 700, fontSize: 12, padding: '5px 12px' }}
                onClick={() => navigate('/transactions')}
                title={`${pendingApprovals} withdrawal${pendingApprovals !== 1 ? 's' : ''} waiting for your approval`}
              >
                ⏳ {pendingApprovals}
              </button>
            )}
            {/* Dark / light mode toggle */}
            <button className="theme-toggle" onClick={toggleTheme} title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
              {isDark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            {/* Insights compact button */}
            {isAdmin && (
              <div style={{ position: 'relative' }}>
                <InsightsPanel compact />
              </div>
            )}
            <button className="btn btn-secondary btn-icon" style={{ position: 'relative' }} onClick={() => navigate('/settings?tab=notifications')} title="Notifications">
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="notif-dot" style={unreadCount > 1 ? { width: 'auto', height: 16, borderRadius: 99, padding: '0 4px', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', top: -2, right: -2 } : {}}>
                  {unreadCount > 1 ? unreadCount : ''}
                </span>
              )}
            </button>
            <div style={{ cursor: 'pointer', borderRadius: '50%', overflow: 'hidden' }} onClick={() => navigate('/settings')} title="Profile settings">
              <MemberAvatar name={profile?.name} avatarUrl={profile?.avatar_url} size={36} />
            </div>
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>

      {/* MOBILE BOTTOM NAV */}
      <nav className="mobile-bottom-nav">
        {BOTTOM_NAV.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) => isActive ? 'active' : ''}
          >
            <div style={{ position: 'relative' }}>
              <item.icon size={20} />
              {item.path === '/transactions' && pendingApprovals > 0 && (
                <span className="mnav-badge">{pendingApprovals}</span>
              )}
              {item.path === '/governance' && pendingGovernance > 0 && (
                <span className="mnav-badge">{pendingGovernance}</span>
              )}
            </div>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* PWA INSTALL BANNER */}
      <div className={`pwa-install-banner ${showInstallBanner ? 'visible' : ''}`}>
        <div style={{ width: 40, height: 40, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
          <img src="/logo.jpeg" alt="Fundex" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
        <div className="pwa-install-banner-text">
          <div className="pwa-install-banner-title">Install Fundex App</div>
          <div className="pwa-install-banner-sub">Add to home screen for quick access</div>
        </div>
        <button className="pwa-install-btn" onClick={handleInstallApp}>Install</button>
        <button className="pwa-dismiss-btn" onClick={dismissInstallBanner}>✕</button>
      </div>
    </div>
  )
}
