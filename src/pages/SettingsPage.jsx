import MemberAvatar from '../components/MemberAvatar'
import PageHeader from '../components/PageHeader'
import { useState, useEffect, useRef, useCallback } from 'react'
import { User, Bell, Lock, Save, Check, ExternalLink, Camera, UserPlus, Shield, Mail, ToggleLeft, ToggleRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatDateTime } from '../lib/utils'
import toast from 'react-hot-toast'
import { useSearchParams, useNavigate } from 'react-router-dom'

export default function SettingsPage() {
  const { profile, updateProfile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const defaultTab = searchParams.get('tab') === 'notifications' ? 'notifications' : 'profile'
  const [activeTab, setActiveTab] = useState(defaultTab)
  const [notifications, setNotifications] = useState([])
  const [loadingNotif, setLoadingNotif] = useState(false)
  const [emailPrefs, setEmailPrefs] = useState({
    email_notifications_enabled: true,
    notify_on_deposits:          true,
    notify_on_withdrawals:       true,
    notify_on_investments:       true,
    notify_on_governance:        true,
  })
  const [savingEmailPrefs, setSavingEmailPrefs] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '' })
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' })
  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')  // e.g. "Compressing…" / "Uploading…"
  const fileInputRef = useRef(null)

  /**
   * Compress an image file using the Canvas API.
   * Resizes to maxDim × maxDim (keeping aspect ratio) and re-encodes as JPEG.
   * Returns a Blob — typically <200 KB for a 800px avatar.
   */
  const compressImage = (file, maxDim = 800, quality = 0.82) => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        let { width, height } = img

        // Scale down proportionally if larger than maxDim
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height / width) * maxDim)
            width = maxDim
          } else {
            width = Math.round((width / height) * maxDim)
            height = maxDim
          }
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)

        canvas.toBlob(
          blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
          'image/jpeg',
          quality
        )
      }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')) }
      img.src = url
    })
  }

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0]
    // Reset input so same file can be re-selected after an error
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return }

    setUploadingPhoto(true)
    try {
      // Step 1 — Compress
      setUploadProgress('Compressing…')
      const compressed = await compressImage(file)
      const sizeMB = (compressed.size / 1024 / 1024).toFixed(2)

      // Step 2 — Upload (always as JPEG after compression)
      setUploadProgress(`Uploading (${sizeMB} MB)…`)
      const path = `avatars/${profile.id}.jpg`
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, compressed, { upsert: true, contentType: 'image/jpeg' })
      if (upErr) throw upErr

      // Step 3 — Save URL to profile
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
      const avatarUrl = urlData.publicUrl + `?t=${Date.now()}` // cache-bust
      const { error: profErr } = await updateProfile({ avatar_url: avatarUrl })
      if (profErr) throw profErr

      toast.success(`Photo updated! (${sizeMB} MB after compression)`)
    } catch (err) {
      toast.error('Upload failed: ' + err.message)
    } finally {
      setUploadingPhoto(false)
      setUploadProgress('')
    }
  }

  useEffect(() => {
    if (profile) {
      setForm({ name: profile.name || '', phone: profile.phone || '' })
      setEmailPrefs({
        email_notifications_enabled: profile.email_notifications_enabled !== false,
        notify_on_deposits:          profile.notify_on_deposits          !== false,
        notify_on_withdrawals:       profile.notify_on_withdrawals       !== false,
        notify_on_investments:       profile.notify_on_investments       !== false,
        notify_on_governance:        profile.notify_on_governance        !== false,
      })
    }
  }, [profile])

  useEffect(() => {
    if (activeTab === 'notifications') fetchNotifications()
  }, [activeTab])

  const fetchNotifications = useCallback(async () => {
    setLoadingNotif(true)
    const { data } = await supabase
      .from('notifications')
      .select('*, email_sent, email_sent_at')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
    if (data) setNotifications(data)
    setLoadingNotif(false)
  }, [profile])

  const saveEmailPrefs = async () => {
    setSavingEmailPrefs(true)
    const { error } = await supabase
      .from('profiles')
      .update({
        email_notifications_enabled: emailPrefs.email_notifications_enabled,
        notify_on_deposits:          emailPrefs.notify_on_deposits,
        notify_on_withdrawals:       emailPrefs.notify_on_withdrawals,
        notify_on_investments:       emailPrefs.notify_on_investments,
        notify_on_governance:        emailPrefs.notify_on_governance,
        updated_at:                  new Date().toISOString(),
      })
      .eq('id', profile.id)
    setSavingEmailPrefs(false)
    if (error) toast.error('Failed to save: ' + error.message)
    else toast.success('Email preferences saved ✅')
  }

  const toggleEmailPref = (key) => {
    setEmailPrefs(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const markAllRead = async () => {
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', profile.id).eq('is_read', false)
    fetchNotifications()
  }

  const markRead = async (id) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
  }

  const saveProfile = async (e) => {
    e.preventDefault()
    setSaving(true)
    const { error } = await updateProfile({ name: form.name, phone: form.phone || null })
    setSaving(false)
    if (error) toast.error(error.message)
    else toast.success('Profile updated!')
  }

  const changePassword = async (e) => {
    e.preventDefault()
    if (pwForm.newPw !== pwForm.confirm) { toast.error('Passwords do not match'); return }
    if (pwForm.newPw.length < 8) { toast.error('Password must be at least 8 characters'); return }
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password: pwForm.newPw })
    setSaving(false)
    if (error) toast.error(error.message)
    else { toast.success('Password changed!'); setPwForm({ current: '', newPw: '', confirm: '' }) }
  }

  const TABS = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'security', label: 'Security', icon: Lock },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin', icon: Shield }] : []),
  ]

  // Admin: register new user state
  const [inviteForm, setInviteForm] = useState({ email: '', name: '', role: 'member', password: '' })
  const [inviting, setInviting] = useState(false)
  const [invitations, setInvitations] = useState([])
  const [reminders, setReminders] = useState([])
  const [loadingAdmin, setLoadingAdmin] = useState(false)

  const fetchAdminData = useCallback(async () => {
    if (!isAdmin) return
    setLoadingAdmin(true)
    const [invRes, remRes] = await Promise.all([
      supabase.from('member_invitations').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('scheduled_reminders').select('*').order('reminder_type'),
    ])
    if (invRes.data) setInvitations(invRes.data)
    if (remRes.data) setReminders(remRes.data)
    setLoadingAdmin(false)
  }, [isAdmin])

  useEffect(() => {
    if (activeTab === 'admin') fetchAdminData()
  }, [activeTab, fetchAdminData])

  const handleRegisterUser = async (e) => {
    e.preventDefault()
    if (!inviteForm.email || !inviteForm.name || !inviteForm.password) {
      toast.error('Email, name and password are required')
      return
    }
    if (inviteForm.password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setInviting(true)
    try {
      // Create auth user via Supabase admin signUp (uses anon key — works if email confirm is off)
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: inviteForm.email.trim().toLowerCase(),
        password: inviteForm.password,
        options: {
          data: { name: inviteForm.name.trim(), role: inviteForm.role }
        }
      })
      if (authErr) throw authErr

      // Profile is created by trigger; update name/role explicitly
      if (authData?.user?.id) {
        await supabase.from('profiles').upsert({
          id: authData.user.id,
          name: inviteForm.name.trim(),
          email: inviteForm.email.trim().toLowerCase(),
          role: inviteForm.role,
        }, { onConflict: 'id' })
      }

      // Record invitation log
      await supabase.from('member_invitations').insert({
        email: inviteForm.email.trim().toLowerCase(),
        name: inviteForm.name.trim(),
        role: inviteForm.role,
        invited_by: profile.id,
        accepted_at: new Date().toISOString(),
      })

      // Audit log
      await supabase.from('audit_logs').insert({
        user_id: profile.id,
        action: `Admin registered new user: ${inviteForm.name} (${inviteForm.role})`,
        table_name: 'profiles',
        record_id: authData?.user?.id,
        change_type: 'create',
      })

      toast.success(`✅ ${inviteForm.name} has been registered! They can now log in with the provided credentials.`)
      setInviteForm({ email: '', name: '', role: 'member', password: '' })
      fetchAdminData()
    } catch (err) {
      toast.error('Registration failed: ' + err.message)
    }
    setInviting(false)
  }

  const toggleReminder = async (reminder) => {
    const { error } = await supabase.from('scheduled_reminders')
      .update({ is_active: !reminder.is_active })
      .eq('id', reminder.id)
    if (error) toast.error('Update failed')
    else { toast.success('Reminder updated'); fetchAdminData() }
  }

  const updateReminderDay = async (id, day) => {
    const d = Math.max(1, Math.min(28, Number(day)))
    const { error } = await supabase.from('scheduled_reminders').update({ day_of_month: d }).eq('id', id)
    if (!error) fetchAdminData()
  }

  const getNotifColor = (type) => {
    const map = { success: 'var(--accent-emerald)', warning: 'var(--accent-amber)', error: 'var(--accent-red)', approval: 'var(--olive)', info: 'var(--accent-blue-light)' }
    return map[type] || 'var(--text-secondary)'
  }

  const getNotifIcon = (type) => {
    const map = { success: '✅', warning: '⚠️', error: '❌', approval: '🔔', info: 'ℹ️' }
    return map[type] || '📣'
  }

  const unread = notifications.filter(n => !n.is_read).length

  return (
    <div style={{ maxWidth: '100%' }}>
      <PageHeader
        title="Settings"
        subtitle="Manage your account and preferences"
      />

      {/* Profile header with photo upload */}
      <div className="card mb-6" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        {/* Avatar with camera overlay */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <MemberAvatar
            name={profile?.name}
            avatarUrl={profile?.avatar_url}
            size={64}
            fontSize={22}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingPhoto}
            title="Change profile photo"
            style={{
              position: 'absolute', bottom: -2, right: -2,
              width: 22, height: 22, borderRadius: '50%',
              background: uploadingPhoto ? 'var(--accent-amber)' : 'var(--olive)',
              border: '2px solid #fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: uploadingPhoto ? 'default' : 'pointer', padding: 0
            }}
          >
            {uploadingPhoto
              ? <div className="spinner" style={{ width: 10, height: 10, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
              : <Camera size={11} color="#fff" />
            }
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handlePhotoUpload}
          />
        </div>
        <div>
          <h3 style={{ fontWeight: 700, fontSize: 16 }}>{profile?.name}</h3>
          <p className="text-sm text-muted">{profile?.email}</p>
          <span className={`badge badge-${profile?.role === 'admin' ? 'amber' : 'blue'}`} style={{ marginTop: 4 }}>{profile?.role}</span>
          {uploadingPhoto ? (
            <p style={{ fontSize: 11, color: 'var(--accent-amber)', marginTop: 6, fontWeight: 600 }}>
              {uploadProgress || 'Processing…'}
            </p>
          ) : (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              Click the camera icon to update your photo
            </p>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="page-tab-bar" style={{ marginBottom: 20 }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 16px',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--olive)' : '2px solid transparent',
              background: 'none',
              color: activeTab === tab.id ? 'var(--olive-light)' : 'var(--text-muted)',
              fontFamily: 'var(--font-main)',
              fontSize: 14, fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.2s',
              position: 'relative', bottom: -1
            }}
          >
            <tab.icon size={14} />
            {tab.label}
            {tab.id === 'notifications' && unread > 0 && (
              <span className="nav-badge">{unread}</span>
            )}
          </button>
        ))}
      </div>

      {/* Profile tab */}
      {activeTab === 'profile' && (
        <div className="card">
          <h3 style={{ fontWeight: 700, marginBottom: 20 }}>Personal Information</h3>
          <form onSubmit={saveProfile}>
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input className="form-input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input className="form-input" value={profile?.email || ''} disabled style={{ opacity: 0.5 }} />
              <p className="form-error" style={{ color: 'var(--text-muted)' }}>Email cannot be changed here</p>
            </div>
            <div className="form-group">
              <label className="form-label">Phone Number (optional)</label>
              <input className="form-input" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+254 700 000 000" />
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <Save size={14} />}
              Save Changes
            </button>
          </form>
        </div>
      )}

      {/* Notifications tab */}
      {activeTab === 'notifications' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── EMAIL PREFERENCES CARD ── */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(26,36,114,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Mail size={16} style={{ color: 'var(--navy-light)' }} />
              </div>
              <div>
                <h3 style={{ fontWeight: 700, fontSize: 15 }}>Email Notifications</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>Sent to <strong>{profile?.email}</strong></p>
              </div>
            </div>

            {/* Master toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 10, background: emailPrefs.email_notifications_enabled ? 'rgba(90,138,30,0.06)' : 'var(--bg-elevated)', border: `1px solid ${emailPrefs.email_notifications_enabled ? 'rgba(90,138,30,0.2)' : 'var(--border)'}`, marginBottom: 14, cursor: 'pointer' }}
              onClick={() => toggleEmailPref('email_notifications_enabled')}>
              <div>
                <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                  {emailPrefs.email_notifications_enabled ? '🔔 Email alerts ON' : '🔕 Email alerts OFF'}
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {emailPrefs.email_notifications_enabled
                    ? 'You will receive important notifications by email'
                    : 'No emails will be sent — in-app only'}
                </p>
              </div>
              {emailPrefs.email_notifications_enabled
                ? <ToggleRight size={28} style={{ color: 'var(--olive)', flexShrink: 0 }} />
                : <ToggleLeft  size={28} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
            </div>

            {/* Per-type toggles */}
            {emailPrefs.email_notifications_enabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 16 }}>
                {[
                  { key: 'notify_on_deposits',     label: 'Deposits & contributions', emoji: '💰', desc: 'When any member deposits funds' },
                  { key: 'notify_on_withdrawals',  label: 'Withdrawal approvals',     emoji: '💸', desc: 'Approval requests and outcomes' },
                  { key: 'notify_on_investments',  label: 'Investment updates',       emoji: '📈', desc: 'New investments, returns, dividends' },
                  { key: 'notify_on_governance',   label: 'Governance votes',         emoji: '🗳️', desc: 'Proposals requiring your vote' },
                ].map(({ key, label, emoji, desc }) => (
                  <div key={key}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 8, cursor: 'pointer', transition: 'background 0.12s' }}
                    onClick={() => toggleEmailPref(key)}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{emoji}</span>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</p>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{desc}</p>
                      </div>
                    </div>
                    {emailPrefs[key]
                      ? <ToggleRight size={22} style={{ color: 'var(--olive)', flexShrink: 0 }} />
                      : <ToggleLeft  size={22} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                  </div>
                ))}
              </div>
            )}

            <button
              className="btn btn-primary btn-sm"
              onClick={saveEmailPrefs}
              disabled={savingEmailPrefs}
              style={{ width: '100%', justifyContent: 'center' }}>
              {savingEmailPrefs
                ? <><div className="spinner" style={{ width: 13, height: 13 }} /> Saving…</>
                : <><Save size={13} /> Save Email Preferences</>}
            </button>
          </div>

          {/* ── IN-APP NOTIFICATION LIST ── */}
          <div className="card">
            <div className="flex justify-between items-center mb-4">
              <h3 style={{ fontWeight: 700 }}>In-App Notifications {unread > 0 && <span className="badge badge-red" style={{ marginLeft: 8 }}>{unread} new</span>}</h3>
              {unread > 0 && <button className="btn btn-secondary btn-sm" onClick={markAllRead}><Check size={13} /> Mark all read</button>}
            </div>
          {loadingNotif ? (
            <div className="flex justify-center" style={{ padding: 32 }}><div className="spinner" style={{ width: 24, height: 24 }} /></div>
          ) : notifications.length === 0 ? (
            <div className="empty-state"><Bell size={32} style={{ opacity: 0.3 }} /><p>No notifications yet</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {notifications.map(n => {
                const isApproval = n.type === 'approval' || n.action_url
                const isClickable = !n.is_read || isApproval
                const handleClick = async () => {
                  if (!n.is_read) await markRead(n.id)
                  if (n.action_url) navigate(n.action_url)
                }
                return (
                  <div
                    key={n.id}
                    onClick={isClickable ? handleClick : undefined}
                    style={{
                      padding: 14,
                      borderRadius: 10,
                      background: n.is_read ? 'transparent' : isApproval ? 'rgba(230,144,10,0.06)' : 'rgba(122,140,58,0.05)',
                      border: `1px solid ${n.is_read ? 'var(--border)' : isApproval ? 'rgba(230,144,10,0.22)' : 'rgba(122,140,58,0.15)'}`,
                      cursor: isClickable ? 'pointer' : 'default',
                      transition: 'all 0.15s'
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <span style={{ fontSize: 18, flexShrink: 0 }}>{getNotifIcon(n.type)}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="flex justify-between items-start gap-2">
                          <p style={{ fontWeight: n.is_read ? 500 : 700, fontSize: 14, color: n.is_read ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                            {n.title}
                          </p>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                            {!n.is_read && <div style={{ width: 8, height: 8, borderRadius: '50%', background: isApproval ? 'var(--accent-amber)' : 'var(--olive)', flexShrink: 0 }} />}
                            {isApproval && n.action_url && (
                              <span style={{ fontSize: 11, color: 'var(--olive)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                                <ExternalLink size={11} /> Review
                              </span>
                            )}
                          </div>
                        </div>
                        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{n.message}</p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                          <p className="text-xs text-muted">{formatDateTime(n.created_at)}</p>
                          {n.email_sent && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: 'var(--navy-light)', background: 'rgba(58,77,181,0.08)', border: '1px solid rgba(58,77,181,0.15)', borderRadius: 99, padding: '1px 7px' }}>
                              <Mail size={9} /> emailed
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* email_sent badge on each notification */}
        </div>
        </div>
      )}

      {/* Security tab */}
      {activeTab === 'security' && (
        <div className="card">
          <h3 style={{ fontWeight: 700, marginBottom: 20 }}>Change Password</h3>
          <form onSubmit={changePassword}>
            <div className="form-group">
              <label className="form-label">New Password</label>
              <input className="form-input" type="password" value={pwForm.newPw} onChange={e => setPwForm(p => ({ ...p, newPw: e.target.value }))} placeholder="At least 8 characters" required minLength={8} />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm New Password</label>
              <input className="form-input" type="password" value={pwForm.confirm} onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))} placeholder="Repeat new password" required />
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <Lock size={14} />}
              Update Password
            </button>
          </form>

          <div className="divider" />
          <h3 style={{ fontWeight: 700, marginBottom: 12 }}>Account Information</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'Account ID', value: profile?.id?.substring(0, 18) + '…' },
              { label: 'Role', value: profile?.role },
              { label: 'Member Since', value: profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span className="text-sm text-secondary">{item.label}</span>
                <span className="text-sm text-mono">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Admin tab */}
      {activeTab === 'admin' && isAdmin && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Register new user */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
              <UserPlus size={16} style={{ color: 'var(--olive)' }} />
              <h3 style={{ fontWeight: 700, fontSize: 15 }}>Register New Member</h3>
            </div>
            <div style={{ background: 'rgba(90,138,30,0.07)', border: '1px solid rgba(90,138,30,0.2)', borderRadius: 8, padding: 10, marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
              ℹ️ Creates a Supabase auth account and member profile. The new member can log in immediately with the credentials you set.
              If email confirmation is enabled in Supabase, they must confirm their email first.
            </div>
            <form onSubmit={handleRegisterUser}>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Full Name *</label>
                  <input
                    className="form-input"
                    value={inviteForm.name}
                    onChange={e => setInviteForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Jane Wanjiru"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <select
                    className="form-select"
                    value={inviteForm.role}
                    onChange={e => setInviteForm(p => ({ ...p, role: e.target.value }))}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Email Address *</label>
                <input
                  className="form-input"
                  type="email"
                  value={inviteForm.email}
                  onChange={e => setInviteForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="jane@fundex.app"
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Initial Password * (min 8 chars)</label>
                <input
                  className="form-input"
                  type="password"
                  value={inviteForm.password}
                  onChange={e => setInviteForm(p => ({ ...p, password: e.target.value }))}
                  placeholder="Strong password — share securely with the member"
                  minLength={8}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={inviting}>
                {inviting
                  ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Registering…</>
                  : <><UserPlus size={14} /> Register Member</>
                }
              </button>
            </form>
          </div>

          {/* Registration history */}
          {invitations.length > 0 && (
            <div className="card">
              <h3 style={{ fontWeight: 700, marginBottom: 14, fontSize: 15 }}>Registration History</h3>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Registered</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invitations.map(inv => (
                      <tr key={inv.id}>
                        <td style={{ fontWeight: 600, fontSize: 13 }}>{inv.name}</td>
                        <td className="text-sm text-secondary">{inv.email}</td>
                        <td><span className={`badge badge-${inv.role === 'admin' ? 'amber' : 'blue'}`}>{inv.role}</span></td>
                        <td className="text-xs text-muted">{new Date(inv.created_at).toLocaleDateString()}</td>
                        <td>
                          <span className={`badge badge-${inv.accepted_at ? 'green' : inv.expires_at && new Date(inv.expires_at) < new Date() ? 'red' : 'amber'}`}>
                            {inv.accepted_at ? 'Registered' : new Date(inv.expires_at) < new Date() ? 'Expired' : 'Pending'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Scheduled reminders */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Shield size={15} style={{ color: 'var(--olive)' }} />
              <h3 style={{ fontWeight: 700, fontSize: 15 }}>Scheduled Automations</h3>
            </div>
            {loadingAdmin ? (
              <div className="flex justify-center" style={{ padding: 24 }}><div className="spinner" style={{ width: 20, height: 20 }} /></div>
            ) : reminders.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No scheduled reminders configured. Run migration 008 to set them up.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {reminders.map(r => {
                  const labels = {
                    monthly_contribution: { title: '📅 Monthly Contribution Reminder', desc: 'Notifies all members to make their monthly contribution' },
                    snapshot: { title: '📸 Auto Ownership Snapshot', desc: 'Automatically snapshots ownership percentages for record-keeping' },
                    report: { title: '📊 Monthly Summary Report', desc: 'Generates and stores a monthly financial summary insight' },
                  }
                  const cfg = labels[r.reminder_type] || { title: r.reminder_type, desc: '' }
                  return (
                    <div key={r.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 14px', background: 'var(--bg-elevated)',
                      borderRadius: 8, border: '1px solid var(--border)', gap: 12, flexWrap: 'wrap'
                    }}>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <p style={{ fontSize: 13, fontWeight: 700 }}>{cfg.title}</p>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{cfg.desc}</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Day of month:</span>
                          <input
                            type="number" min="1" max="28"
                            value={r.day_of_month}
                            onChange={e => updateReminderDay(r.id, e.target.value)}
                            style={{ width: 48, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'var(--font-mono)', textAlign: 'center' }}
                          />
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <div
                            onClick={() => toggleReminder(r)}
                            style={{
                              width: 36, height: 20, borderRadius: 99, cursor: 'pointer',
                              background: r.is_active ? 'var(--olive)' : 'var(--bg-elevated)',
                              border: `1px solid ${r.is_active ? 'var(--olive)' : 'var(--border)'}`,
                              position: 'relative', transition: 'background 0.2s',
                            }}
                          >
                            <div style={{
                              width: 14, height: 14, borderRadius: '50%', background: '#fff',
                              position: 'absolute', top: 2,
                              left: r.is_active ? 18 : 2,
                              transition: 'left 0.2s',
                            }} />
                          </div>
                          <span style={{ fontSize: 12, color: r.is_active ? 'var(--olive)' : 'var(--text-muted)', fontWeight: 600 }}>
                            {r.is_active ? 'On' : 'Off'}
                          </span>
                        </label>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  )
}
