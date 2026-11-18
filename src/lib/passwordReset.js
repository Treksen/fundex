import { validateNewPassword } from './passwordRules'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Asks Supabase to email a reset link. The answer is the SAME whether or not the email has an account, so nobody can
// use this form to find out who is a member.
export async function requestPasswordReset(supabase, email, redirectTo) {
  const clean = String(email ?? '').trim().toLowerCase()
  if (!EMAIL.test(clean)) return { ok: false, error: 'Enter a valid email address' }
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(clean, { redirectTo })
    if (error && /rate|too many|seconds|limit|security purposes/i.test(error.message || '')) {
      return { ok: false, error: 'Too many requests. Please wait a few minutes and try again.' }
    }
  } catch {
    return { ok: false, error: 'Could not send the email. Check your connection and try again.' }
  }
  return { ok: true }
}

export function friendlyResetError(message) {
  const m = String(message || '')
  if (/same|different from the old/i.test(m)) return 'Choose a password you have not used before'
  if (/session|expired|invalid.*(token|jwt)|not authenticated|missing/i.test(m)) return 'This reset link has expired. Please request a new one.'
  if (/weak|at least|characters/i.test(m)) return m
  return 'Could not update your password. Please try again.'
}

// Supabase puts failures in the link itself (e.g. #error=access_denied&error_code=otp_expired)
export function linkProblemFromUrl(location) {
  const parts = [String(location?.hash || '').replace(/^#/, ''), String(location?.search || '').replace(/^\?/, '')]
  for (const p of parts) {
    const q = new URLSearchParams(p)
    if (q.get('error') || q.get('error_code') || q.get('error_description')) return q.get('error_code') || 'error'
  }
  return null
}

// Decides what the reset page should show: 'ready' (a valid recovery session exists), 'expired' (the link says so),
// or 'invalid' (nothing arrived in time).
export async function waitForRecovery(supabase, { timeoutMs = 5000, location = globalThis.location, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  if (linkProblemFromUrl(location)) return 'expired'
  const { data } = await supabase.auth.getSession()
  if (data?.session) return 'ready'
  return new Promise((resolve) => {
    let subscription = null
    const timer = setTimeoutFn(() => { subscription?.unsubscribe?.(); resolve('invalid') }, timeoutMs)
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        clearTimeoutFn(timer); subscription?.unsubscribe?.(); resolve('ready')
      }
    })
    subscription = listener?.subscription || null
  })
}

// Sets the new password, then signs out so the member proves it by signing in with it.
export async function completePasswordReset(supabase, password, confirm) {
  const invalid = validateNewPassword(password, confirm)
  if (invalid) return { ok: false, error: invalid }
  const { error } = await supabase.auth.updateUser({ password })
  if (error) return { ok: false, error: friendlyResetError(error.message) }
  try { await supabase.auth.signOut() } catch { /* the password is already changed */ }
  return { ok: true }
}
