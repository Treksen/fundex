// Browser-side helpers for "Pay with M-Pesa". No React and no Supabase import, so they can be unit-tested.

// Shown only when the website is built with VITE_MPESA_ENABLED=true (turn on after sandbox testing).
export const mpesaEnabled = () => String(import.meta.env?.VITE_MPESA_ENABLED ?? '') === 'true'

// Profile phones may be stored as 07..., +2547..., 2547... Show them the way people type them.
export function displayPhone(p) {
  const d = String(p ?? '').replace(/[^\d]/g, '')
  if (/^254[17]\d{8}$/.test(d)) return '0' + d.slice(3)
  if (/^0[17]\d{8}$/.test(d)) return d
  return String(p ?? '')
}

export function looksLikeKenyanMobile(p) {
  const d = String(p ?? '').replace(/[\s()+-]/g, '')
  return /^(254|0)?[17]\d{8}$/.test(d)
}

// Terminal states of an M-Pesa request, and what to tell the person.
export const FINAL = ['paid', 'cancelled', 'failed', 'timeout', 'needs_review', 'send_failed']

const BY_CODE = {
  1: 'Not enough money in the M-Pesa account.',
  1001: 'Another M-Pesa payment is in progress on this phone. Wait a moment and try again.',
  1019: 'The payment request expired before the PIN was entered.',
  1025: 'M-Pesa could not send the prompt. Try again.',
  1032: 'The payment was cancelled on the phone.',
  1037: 'The phone could not be reached. Check that it is on and has network, then try again.',
  2001: 'The M-Pesa PIN was wrong.',
}

export function describeResult(r) {
  if (!r) return { tone: 'wait', title: 'Waiting…', text: '' }
  const amount = `KES ${Number(r.amount || 0).toLocaleString('en-KE')}`
  switch (r.status) {
    case 'sending':
    case 'pending':
      return { tone: 'wait', title: 'Check the phone', text: `Enter the M-Pesa PIN on ${displayPhone(r.phone)} to pay ${amount}.` }
    case 'paid':
      return { tone: 'ok', title: 'Payment received', text: `${amount} received. M-Pesa code ${r.mpesa_receipt}. The deposit now awaits verification by an admin.` }
    case 'cancelled':
      return { tone: 'error', title: 'Payment cancelled', text: BY_CODE[1032] }
    case 'timeout':
      return { tone: 'error', title: 'No response', text: BY_CODE[r.result_code] || BY_CODE[1037] }
    case 'failed':
      return { tone: 'error', title: 'Payment failed', text: BY_CODE[r.result_code] || r.result_desc || 'M-Pesa did not complete the payment.' }
    case 'needs_review':
      return { tone: 'warn', title: 'Received, needs a check', text: 'M-Pesa reported this payment, but it could not be recorded automatically. The admins have been notified and will sort it out.' }
    case 'send_failed':
      return { tone: 'error', title: 'Could not start the payment', text: 'M-Pesa could not send the prompt. Check the number and try again.' }
    default:
      return { tone: 'wait', title: 'Waiting…', text: '' }
  }
}

// Columns the browser may read (the callback secret's hash is never readable).
export const REQUEST_COLUMNS = 'id, status, amount, phone, mpesa_receipt, result_code, result_desc, transaction_id, created_at'
