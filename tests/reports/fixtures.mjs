export const members = [
  { id: 'A', name: 'Alice', role: 'admin', email: 'a@x' }, { id: 'B', name: 'Bob', role: 'member', email: 'b@x' },
  { id: 'C', name: 'Carol', role: 'member', email: 'c@x' }, { id: 'D', name: 'Dan', role: 'member', email: 'd@x' },
]
const tx = (id, user_id, type, amount, status, transaction_date, extra = {}) =>
  ({ id, user_id, type, amount, status, transaction_date, created_at: transaction_date, reference: `REF-${id}`, ...extra })
export const transactions = [
  tx('t1', 'A', 'deposit', 10000, 'completed', '2026-08-15T10:00:00+03:00', { bank_verification_code: 'BNK1', verified_at: '2026-08-15T12:00:00+03:00', verified_by_name: 'Bob' }),
  tx('t2', 'B', 'deposit', 5000, 'completed', '2026-09-10T10:00:00+03:00'),                                   // legacy: no bank code
  tx('t3', 'C', 'deposit', 2000, 'completed', '2026-09-20T10:00:00+03:00', { bank_verification_code: 'BNK3', verified_at: '2026-09-20T11:00:00+03:00', verified_by_name: 'Alice' }),
  tx('t4', 'A', 'deposit', 4000, 'completed', '2026-10-05T09:00:00+03:00', { bank_verification_code: 'BNK4', verified_at: '2026-10-05T11:00:00+03:00', verified_by_name: 'Bob' }),   // 2h
  tx('t5', 'B', 'deposit', 3000, 'completed', '2026-10-12T08:00:00+03:00', { bank_verification_code: 'BNK5', verified_at: '2026-10-12T20:00:00+03:00', verified_by_name: 'Alice' }), // 12h
  tx('t6', 'C', 'withdrawal', 2500, 'completed', '2026-10-15T10:00:00+03:00'),                               // Carol overdrawn
  tx('t7', 'B', 'withdrawal', 1000, 'pending', '2026-10-20T10:00:00+03:00'),                                  // not counted
  tx('t8', 'D', 'deposit', 1500, 'pending_verification', '2026-10-25T10:00:00+03:00'),                        // not counted
  tx('t9', 'A', 'adjustment', -200, 'completed', '2026-10-28T10:00:00+03:00'),
  tx('t10', 'B', 'deposit', 700, 'rejected', '2026-10-30T10:00:00+03:00'),                                    // not counted
  tx('t11', 'C', 'deposit', 1000, 'completed', '2026-11-03T10:00:00+03:00', { bank_verification_code: 'BNK11' }), // after October
  tx('t12', 'B', 'deposit', 800, 'completed', '2026-10-31T21:30:00+00:00'),                                   // = 1 Nov 00:30 Nairobi -> NOT October
  tx('t13', 'A', 'deposit', 900, 'completed', '2026-09-30T21:30:00+00:00'),                                   // = 1 Oct 00:30 Nairobi -> IS October
]
export const reconciliations = [
  { transaction_id: 't4', bank_date: '2026-10-05', bank_amount: 4000, match_status: 'matched', bank_reference: 'BNK4', transactions: { amount: 4000 } },
  { transaction_id: 't5', bank_date: '2026-10-12', bank_amount: 3000, match_status: 'matched', bank_reference: 'BNK5', transactions: { amount: 3000 } },
  { transaction_id: null, bank_date: '2026-10-20', bank_amount: 1200, match_status: 'unmatched', bank_reference: 'X9', bank_description: 'Unknown credit', transactions: null },
  { transaction_id: 't6', bank_date: '2026-10-22', bank_amount: 2600, match_status: 'matched', bank_reference: 'W1', transactions: { amount: 2500 } },  // +100 variance
  { transaction_id: 't3', bank_date: '2026-09-30', bank_amount: 2000, match_status: 'matched', bank_reference: 'BNK3', transactions: { amount: 2000 } },  // other month
]
export const reserve = {
  status: { current_balance: 1000, group_pool_balance: 21000, target_balance: 2000, vs_target: -1000, pct_of_target: 50, health_status: 'building' },
  contributions: [
    { direction: 'allocate', amount: 500, created_at: '2026-10-10T10:00:00+03:00' }, { direction: 'withdraw', amount: 200, created_at: '2026-10-20T10:00:00+03:00' },
    { direction: 'allocate', amount: 300, created_at: '2026-09-30T10:00:00+03:00' },
  ],
}
export const investments = [
  { title: 'Land plot', investment_type: 'real_estate', amount_invested: 8000, expected_return: 9000, actual_return: null, status: 'active', roi_pct: 0, net_profit: -8000, computed_status: 'active', dividend_count: 0, total_distributed: 0 },
  { title: 'T-Bill', investment_type: 'bonds', amount_invested: 5000, expected_return: 5400, actual_return: 5500, status: 'completed', roi_pct: 10, net_profit: 500, computed_status: 'completed', dividend_count: 1, total_distributed: 500 },
  { title: 'Dairy', investment_type: 'agri', amount_invested: 2000, expected_return: 2400, actual_return: null, status: 'active', roi_pct: 0, net_profit: -2000, computed_status: 'maturing', dividend_count: 0, total_distributed: 0 },
]
export const goals = [
  { title: 'Land fund', target_amount: 44400, target_date: '2027-03-31', is_active: true },
  { title: 'Starter pot', target_amount: 20000, target_date: null, is_active: true },
]
export const ledger = [
  { entry_date: '2026-09-10', account_name: 'Cash', account_type: 'asset', debit: 5000, credit: 0 }, { entry_date: '2026-09-10', account_name: 'Member Equity', account_type: 'equity', debit: 0, credit: 5000 },
  { entry_date: '2026-10-05', account_name: 'Cash', account_type: 'asset', debit: 4000, credit: 0 }, { entry_date: '2026-10-05', account_name: 'Member Equity', account_type: 'equity', debit: 0, credit: 4000 },
  { entry_date: '2026-10-12', account_name: 'Cash', account_type: 'asset', debit: 3000, credit: 0 }, { entry_date: '2026-10-12', account_name: 'Member Equity', account_type: 'equity', debit: 0, credit: 3000 },
  { entry_date: '2026-11-04', account_name: 'Cash', account_type: 'asset', debit: 999, credit: 0 },   // after October: must be excluded
]
export const health = { risk_level: 'low', savings_strength: 80, growth_rate: 5, member_count: 4, overdrawn_count: 1, near_limit_count: 0, active_investments: 2, pending_count: 1 }
export const dividends = [
  { user_id: 'A', amount: 300, ownership_percentage: 64.8, distribution_date: '2026-10-14', reinvested: false, notes: 'Q3', profiles: { name: 'Alice' }, investments: { title: 'T-Bill' } },
  { user_id: 'B', amount: 200, ownership_percentage: 35.2, distribution_date: '2026-10-14', reinvested: true, notes: '', profiles: { name: 'Bob' }, investments: { title: 'T-Bill' } },
  { user_id: 'A', amount: 100, ownership_percentage: 60, distribution_date: '2026-09-10', reinvested: true, notes: '', profiles: { name: 'Alice' }, investments: { title: 'Dairy' } },
]
export const raw = { dividends, members, transactions, reconciliations, reserve, investments, goals, ledger, health }
