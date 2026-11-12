import { fetchAll } from './fetchAll'

// Loads everything the monthly report needs. A failed OPTIONAL source is listed in raw._failed (the exports say
// so); a failed CORE source (members, transactions) sets raw._coreFailed and exports are blocked, because totals
// built from partial data would be wrong.
export async function loadReportData(supabase) {
  const failed = []
  let coreFailed = false
  const one = async (label, query, fallback) => {
    const { data, error } = await query
    if (error) { failed.push(label); return fallback }
    return data ?? fallback
  }
  const many = async (label, makeQuery, core = false) => {
    const { data, error } = await fetchAll(makeQuery)
    if (error) { failed.push(label); if (core) coreFailed = true; return [] }
    return data
  }

  const [members, txRows, reconciliations, investments, dividends, goals, reserveStatus, reserveContribs, health, ledger] = await Promise.all([
    many('members', () => supabase.from('profiles').select('id,name,role,email').order('id'), true),
    many('transactions', () => supabase.from('transactions')
      .select('id,user_id,type,amount,status,transaction_date,created_at,reference,description,statement_no,bank_verification_code,verified_at,verifier:profiles!transactions_verified_by_fkey(name)')
      .order('id'), true),
    many('bank reconciliation', () => supabase.from('bank_reconciliations')
      .select('id,transaction_id,bank_date,bank_amount,bank_reference,bank_description,match_status,transactions(amount)').order('id')),
    one('investments', supabase.from('investment_performance').select('*'), []),
    many('dividends', () => supabase.from('dividends')
      .select('id,user_id,amount,ownership_percentage,distribution_date,reinvested,notes,profiles!dividends_user_id_fkey(name),investments(title)').order('id')),
    one('goals', supabase.from('savings_goals').select('*').eq('is_active', true), []),
    one('reserve fund', supabase.from('reserve_fund_status').select('*').limit(1), []),
    many('reserve history', () => supabase.from('reserve_contributions').select('id,direction,amount,created_at').order('id')),
    one('group health', supabase.from('group_health_score').select('*').limit(1), []),
    many('ledger', () => supabase.from('ledger_entries').select('id,entry_date,account_name,account_type,debit,credit').order('id')),
  ])

  return {
    members,
    transactions: txRows.map((t) => ({ ...t, verified_by_name: t.verifier?.name || null })),
    reconciliations, investments, dividends, goals,
    reserve: { status: reserveStatus[0] || null, contributions: reserveContribs },
    health: health[0] || null,
    ledger,
    _failed: failed,
    _coreFailed: coreFailed,
  }
}
