// Shared helpers for the member admin tools. No React and no Supabase import, so they can be unit-tested.

// Calls the admin-manage-member server function and always returns { ok, data, error, needsPassword }.
export async function callMemberAdmin(supabase, action, memberId, extra = {}) {
  try {
    const { data, error } = await supabase.functions.invoke('admin-manage-member', {
      body: { action, member_id: memberId, ...extra },
    })
    if (!error && data && !data.error) return { ok: true, data }
    let body = data
    if (error?.context && typeof error.context.json === 'function') {
      try { body = await error.context.json() } catch { /* keep generic message */ }
    }
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    return {
      ok: false,
      data: body || null,
      needsPassword: !!body?.needs_password,
      error: body?.error || (offline ? 'No internet connection' : 'Something went wrong. Please try again.'),
    }
  } catch {
    return { ok: false, data: null, needsPassword: false, error: 'Could not reach the server. Check your connection.' }
  }
}

// 'blocked' -> sign the person out; 'must_change' -> show the "choose your own password" screen; 'ok' otherwise.
export function accountGate(profile) {
  if (!profile) return 'ok'
  if (profile.is_active === false || profile.login_disabled === true) return 'blocked'
  if (profile.must_change_password === true) return 'must_change'
  return 'ok'
}

export function memberStatus(m) {
  if (m?.is_active === false) return { key: 'inactive', label: 'Deactivated', badge: 'badge-gray' }
  if (m?.login_disabled === true) return { key: 'suspended', label: 'Sign-in suspended', badge: 'badge-amber' }
  return { key: 'active', label: 'Active', badge: 'badge-green' }
}

// Which tools to offer for a member. Mirrors the server rules (the server still enforces them).
export function availableActions(member, me) {
  if (!member || !me || me.role !== 'admin') return []
  if (member.id === me.id) return []
  const st = memberStatus(member).key
  if (st === 'inactive') return ['edit_details', 'reactivate']
  if (st === 'suspended') return ['edit_details', 'restore_login', 'deactivate']   // admins are never suspended
  if (member.role === 'admin') return ['edit_details', 'set_role']                  // demote first for the rest
  return ['edit_details', 'set_role', 'send_reset', 'temp_password', 'suspend', 'deactivate']
}

// Supabase says "User is banned" for a suspended or deactivated login.
export function friendlySignInError(message) {
  const m = String(message || '')
  if (/banned/i.test(m)) return 'This account cannot sign in. If you think this is a mistake, contact a group admin.'
  if (/invalid login credentials/i.test(m)) return 'Wrong email or password.'
  return m || 'Invalid credentials'
}

export const BLOCKED_MESSAGE = 'This account cannot sign in. If you think this is a mistake, contact a group admin.'
