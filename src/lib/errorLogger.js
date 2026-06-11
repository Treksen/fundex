/**
 * errorLogger.js
 * Lightweight utility for writing to the error_logs table.
 *
 * Usage:
 *   import { logError } from '../lib/errorLogger'
 *
 *   // Catch block
 *   catch (err) {
 *     logError(err, 'TransactionsPage.fetchData')
 *     toast.error('Failed to load transactions')
 *   }
 *
 *   // Supabase RPC error
 *   if (error) {
 *     logError(error, 'verify_deposit', { transaction_id: tx.id }, 'rpc')
 *     toast.error(error.message)
 *   }
 */

import { supabase } from './supabase'

/**
 * @param {Error|object|string} err   - The error object or message
 * @param {string}  context           - Page/component/function name
 * @param {object}  [extra]           - Any extra key/values to attach
 * @param {'frontend'|'rpc'|'trigger'|'edge_function'|'other'} [source]
 * @param {'info'|'warning'|'error'|'critical'} [severity]
 */
export async function logError(
  err,
  context = 'unknown',
  extra = {},
  source = 'frontend',
  severity = 'error'
) {
  try {
    const message =
      typeof err === 'string'
        ? err
        : err?.message || err?.error || JSON.stringify(err) || 'Unknown error'

    const details = {
      ...extra,
      stack:   err?.stack  || null,
      hint:    err?.hint   || null,
      details: err?.details|| null,
      code:    err?.code   || null,
    }

    // Strip nulls to keep the jsonb clean
    Object.keys(details).forEach(k => details[k] === null && delete details[k])

    await supabase.rpc('log_error', {
      p_message:    message,
      p_context:    context,
      p_details:    Object.keys(details).length ? details : null,
      p_severity:   severity,
      p_source:     source,
      p_error_code: err?.code || err?.status?.toString() || null,
    })
  } catch {
    // Swallow — never let error logging crash the app
  }
}

/**
 * Convenience wrappers for common severities.
 */
export const logWarning  = (err, ctx, extra) => logError(err, ctx, extra, 'frontend', 'warning')
export const logCritical = (err, ctx, extra) => logError(err, ctx, extra, 'frontend', 'critical')
export const logRpcError = (err, ctx, extra) => logError(err, ctx, extra, 'rpc', 'error')
