import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'

const RISK_COLOR = { Low: 'var(--accent-emerald)', Medium: 'var(--accent-amber)', High: 'var(--accent-red)', 'No Activity': 'var(--text-muted)' }
const GROWTH_COLOR = { High: 'var(--accent-emerald)', Moderate: 'var(--navy-light)', Low: 'var(--accent-amber)', 'No Activity': 'var(--text-muted)' }
const GROWTH_ICON = { High: '📈', Moderate: '➡️', Low: '📉', 'No Activity': '⏸️' }

export default function GroupHealthScore() {
  const [score, setScore] = useState(null)
  const [consistency, setConsistency] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchScore = useCallback(async () => {
    setLoading(true)
    const [scoreRes, consRes] = await Promise.all([
      supabase.from('group_health_score').select('*').single(),
      supabase.from('member_contribution_consistency').select('*'),
    ])
    if (scoreRes.data) setScore(scoreRes.data)
    if (consRes.data) setConsistency(consRes.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchScore() }, [fetchScore])

  if (loading) return (
    <div className="card" style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
      <div className="spinner" style={{ width: 24, height: 24 }} />
    </div>
  )
  if (!score) return null

  const strength = score.savings_strength || 0
  const strengthColor = strength >= 70 ? 'var(--accent-emerald)' : strength >= 40 ? 'var(--accent-amber)' : 'var(--accent-red)'
  const strengthLabel = strength >= 70 ? 'Strong' : strength >= 40 ? 'Moderate' : 'Weak'

  return (
    <div className="card">
      <div className="card-header" style={{ marginBottom: 16 }}>
        <span className="card-title">Group Financial Health</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Live score</span>
      </div>

      {/* Main score ring */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 18, flexWrap: 'wrap' }}>
        {/* Circular score */}
        <div style={{ position: 'relative', width: 90, height: 90, flexShrink: 0 }}>
          <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--bg-elevated)" strokeWidth="3" />
            <circle
              cx="18" cy="18" r="15.9" fill="none"
              stroke={strengthColor}
              strokeWidth="3"
              strokeDasharray={`${strength} ${100 - strength}`}
              strokeLinecap="round"
              style={{ transition: 'stroke-dasharray 1s ease' }}
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 20, fontWeight: 900, fontFamily: 'var(--font-mono)', color: strengthColor, lineHeight: 1 }}>{strength}</span>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>/100</span>
          </div>
        </div>

        {/* Key indicators */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Savings Strength</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: strengthColor }}>{strengthLabel}</div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Risk Level</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: RISK_COLOR[score.risk_level] }}>{score.risk_level}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Growth Rate</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: GROWTH_COLOR[score.growth_rate] }}>
                {GROWTH_ICON[score.growth_rate]} {score.growth_rate}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pool stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'Total Pool', value: formatCurrency(score.total_equity), color: 'var(--navy-light)' },
          { label: 'Active Investments', value: score.active_investments || 0, color: 'var(--olive)' },
          { label: 'Avg Investment ROI', value: `${Number(score.avg_investment_roi || 0).toFixed(1)}%`, color: Number(score.avg_investment_roi) >= 0 ? 'var(--accent-emerald)' : 'var(--accent-red)' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-mono)', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Alerts row */}
      {(score.overdrawn_count > 0 || score.pending_count > 0 || score.near_limit_count > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {score.overdrawn_count > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: 'rgba(220,53,69,0.1)', color: 'var(--accent-red)', border: '1px solid rgba(220,53,69,0.2)' }}>
              🔴 {score.overdrawn_count} overdrawn
            </span>
          )}
          {score.near_limit_count > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: 'rgba(230,144,10,0.1)', color: 'var(--accent-amber)', border: '1px solid rgba(230,144,10,0.2)' }}>
              🟡 {score.near_limit_count} near limit
            </span>
          )}
          {score.pending_count > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: 'rgba(58,77,181,0.1)', color: 'var(--navy-light)', border: '1px solid rgba(58,77,181,0.2)' }}>
              ⏳ {score.pending_count} pending approvals
            </span>
          )}
        </div>
      )}

      {/* Member contribution consistency */}
      {consistency.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Contribution Consistency</div>
          {consistency.map(m => {
            const streak = m.streak_3months || 0
            const consistent = streak >= 3
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{m.name?.split(' ')[0]}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                    {m.active_months_6}/6 months active
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: consistent ? 'var(--accent-emerald)' : 'var(--accent-amber)', fontWeight: 700 }}>
                    {consistent ? '🔥 ' + streak + ' month streak' : streak > 0 ? streak + '/3 this quarter' : '—'}
                  </span>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                    avg {formatCurrency(m.avg_monthly_deposit)}/mo
                  </span>
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
