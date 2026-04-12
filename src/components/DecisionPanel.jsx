import { useState, useCallback } from 'react'
import { Brain, AlertTriangle, CheckCircle, TrendingUp, Lightbulb, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'
import toast from 'react-hot-toast'

/**
 * Smart Decision Advisor
 * Drop it next to any amount input to get live AI-like advice.
 * Props:
 *   amount (number) — the amount being considered
 *   action (string) — 'invest' | 'withdraw' | 'deposit'
 */
export default function DecisionPanel({ amount, action }) {
  const [advice, setAdvice] = useState(null)
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const getAdvice = useCallback(async () => {
    if (!amount || Number(amount) <= 0) {
      toast.error('Enter a valid amount first')
      return
    }
    setLoading(true)
    setDismissed(false)
    const { data, error } = await supabase.rpc('get_decision_advice', {
      p_amount: Number(amount),
      p_action: action,
    })
    if (error) { toast.error('Advisor error: ' + error.message) }
    else setAdvice(data)
    setLoading(false)
  }, [amount, action])

  if (dismissed || (!advice && !loading)) {
    return (
      <button
        type="button"
        onClick={getAdvice}
        disabled={loading}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', borderRadius: 99, cursor: 'pointer',
          background: 'rgba(26,36,114,0.08)', border: '1px solid rgba(26,36,114,0.2)',
          color: 'var(--navy-light)', fontSize: 12, fontWeight: 600,
          fontFamily: 'var(--font-main)',
        }}
      >
        {loading
          ? <><div className="spinner" style={{ width: 11, height: 11 }} /> Analysing…</>
          : <><Brain size={12} /> Get Advisor Opinion</>
        }
      </button>
    )
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', fontSize: 13, color: 'var(--text-muted)' }}>
      <div className="spinner" style={{ width: 14, height: 14 }} /> Analysing your request…
    </div>
  )

  if (!advice) return null

  const recColor = {
    safe: 'var(--accent-emerald)',
    caution: 'var(--accent-amber)',
    not_recommended: 'var(--accent-red)',
  }[advice.recommendation] || 'var(--text-secondary)'

  const recIcon = {
    safe: <CheckCircle size={16} />,
    caution: <AlertTriangle size={16} />,
    not_recommended: <AlertTriangle size={16} />,
  }[advice.recommendation] || <Lightbulb size={16} />

  const recLabel = {
    safe: '✅ Safe to Proceed',
    caution: '⚠️ Proceed with Caution',
    not_recommended: '🚫 Not Recommended',
  }[advice.recommendation] || 'ℹ️ Advisory'

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: `1px solid ${recColor}33`,
      borderLeft: `4px solid ${recColor}`,
      borderRadius: 10, padding: '12px 14px',
      position: 'relative', marginTop: 6,
    }}>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        style={{ position: 'absolute', top: 8, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
      >
        <X size={13} />
      </button>

      {/* Headline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <span style={{ color: recColor }}>{recIcon}</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: recColor }}>{recLabel}</span>
      </div>

      {/* Key metrics row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 10 }}>
        {[
          { label: 'Pool Balance', value: formatCurrency(advice.pool_balance) },
          { label: 'Safe Capacity', value: formatCurrency(advice.safe_capacity) },
          { label: 'Liquidity', value: `${advice.liquidity_pct}%` },
          { label: 'Avg ROI', value: `${advice.avg_group_roi}%` },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg-surface)', borderRadius: 6, padding: '6px 8px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{s.label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', marginTop: 2 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Warnings */}
      {advice.warnings?.length > 0 && advice.warnings.map((w, i) => (
        <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginBottom: 6, fontSize: 12, color: 'var(--accent-amber)' }}>
          <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          {w}
        </div>
      ))}

      {/* Tips */}
      {advice.tips?.length > 0 && advice.tips.map((t, i) => (
        <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginBottom: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
          <TrendingUp size={12} style={{ flexShrink: 0, marginTop: 1, color: 'var(--olive)' }} />
          {t}
        </div>
      ))}

      <button type="button" onClick={getAdvice} style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-main)' }}>
        🔄 Re-analyse
      </button>
    </div>
  )
}
