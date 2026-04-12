import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatCurrency, formatPercentage, formatDate } from '../lib/utils'
import { Lightbulb, X, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'

const SEVERITY_STYLE = {
  info:     { bg: 'rgba(58,77,181,0.07)',  border: 'rgba(58,77,181,0.2)',  color: 'var(--navy-light)' },
  warning:  { bg: 'rgba(230,144,10,0.07)', border: 'rgba(230,144,10,0.22)', color: 'var(--accent-amber)' },
  critical: { bg: 'rgba(220,53,69,0.07)',  border: 'rgba(220,53,69,0.22)', color: 'var(--accent-red)' },
}

/**
 * Smart insights panel — generates and displays financial alerts.
 * Compact mode shows only unread count with a popover.
 */
export default function InsightsPanel({ compact = false }) {
  const { isAdmin, profile } = useAuth()
  const [insights, setInsights] = useState([])
  const [memberInsights, setMemberInsights] = useState([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [memberData, setMemberData] = useState([])
  const [poolData, setPoolData] = useState(null)

  const fetchInsights = useCallback(async () => {
    setLoading(true)
    const [insRes, equityRes] = await Promise.all([
      supabase.from('system_insights')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('member_equity_summary').select('*'),
    ])
    if (insRes.data) setInsights(insRes.data)
    if (equityRes.data) {
      setMemberData(equityRes.data)
      const total = equityRes.data.reduce((s, m) => s + Math.max(0, Number(m.available_equity || 0)), 0)
      setPoolData({ total, members: equityRes.data })
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchInsights() }, [fetchInsights])

  // Build client-side smart insights from live data
  useEffect(() => {
    if (!poolData || !profile) return
    const insights = []
    const { total, members } = poolData

    members.forEach(m => {
      const pct = total > 0 ? (Math.max(0, Number(m.available_equity || 0)) / total) * 100 : 0

      // Contribution milestone
      if (pct > 0) {
        insights.push({
          id: `contrib-${m.id}`,
          severity: pct > 50 ? 'warning' : 'info',
          title: `${m.name?.split(' ')[0]} contributes ${pct.toFixed(1)}% of total funds`,
          message: pct > 50
            ? `${m.name?.split(' ')[0]}'s equity makes up over half the pool — concentration risk.`
            : `${m.name?.split(' ')[0]}'s pool share is ${formatCurrency(Math.max(0, Number(m.available_equity || 0)))}.`,
        })
      }

      // Near limit warning
      if (m.equity_status === 'near_limit') {
        insights.push({
          id: `near-${m.id}`,
          severity: 'warning',
          title: `${m.name?.split(' ')[0]} is near withdrawal limit`,
          message: `Available equity is ${formatCurrency(Number(m.available_equity || 0))} — less than 15% of total deposits.`,
        })
      }

      // Overdrawn
      if (m.equity_status === 'overdrawn') {
        insights.push({
          id: `overdrawn-${m.id}`,
          severity: 'critical',
          title: `${m.name?.split(' ')[0]} is overdrawn`,
          message: `Debt of ${formatCurrency(Math.abs(Number(m.available_equity || 0)))}. Admin review required.`,
        })
      }
    })

    setMemberInsights(insights)
  }, [poolData, profile])

  const generateServerInsights = async () => {
    if (!isAdmin) return
    setGenerating(true)
    const { data, error } = await supabase.rpc('generate_financial_insights')
    if (error) toast.error('Failed: ' + error.message)
    else toast.success(`Generated ${data} new server insights`)
    await fetchInsights()
    setGenerating(false)
  }

  const dismissInsight = async (id) => {
    // Only dismiss DB insights, not client-side ones
    if (id.startsWith('contrib-') || id.startsWith('near-') || id.startsWith('overdrawn-')) {
      setMemberInsights(prev => prev.filter(i => i.id !== id))
      return
    }
    await supabase.from('system_insights').update({ is_read: true }).eq('id', id)
    setInsights(prev => prev.filter(i => i.id !== id))
  }

  const allInsights = [
    ...insights.filter(i => !i.is_read),
    ...memberInsights,
  ]

  const unread = allInsights.length

  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Lightbulb size={15} style={{ color: unread > 0 ? 'var(--accent-amber)' : 'var(--text-muted)' }} />
        {unread > 0 && (
          <span style={{
            background: 'var(--accent-amber)', color: '#fff',
            borderRadius: 99, fontSize: 10, fontWeight: 700,
            padding: '1px 6px', minWidth: 18, textAlign: 'center'
          }}>{unread}</span>
        )}
      </div>
    )
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Lightbulb size={16} style={{ color: 'var(--accent-amber)' }} />
          <span style={{ fontWeight: 700, fontSize: 14 }}>
            Smart Insights
            {unread > 0 && <span style={{ marginLeft: 8, background: 'var(--accent-amber)', color: '#fff', borderRadius: 99, fontSize: 10, fontWeight: 700, padding: '1px 7px' }}>{unread}</span>}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {isAdmin && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={generateServerInsights}
              disabled={generating}
              style={{ gap: 5 }}
            >
              <RefreshCw size={11} style={{ animation: generating ? 'spin 0.7s linear infinite' : 'none' }} />
              {generating ? 'Analysing…' : 'Run Analysis'}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center" style={{ padding: 24 }}><div className="spinner" style={{ width: 20, height: 20 }} /></div>
      ) : allInsights.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-muted)', fontSize: 13 }}>
          <Lightbulb size={28} style={{ opacity: 0.2, display: 'block', margin: '0 auto 6px' }} />
          No active insights — financial health looks good!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {allInsights.slice(0, 8).map(ins => {
            const sev = ins.severity || 'info'
            const style = SEVERITY_STYLE[sev] || SEVERITY_STYLE.info
            return (
              <div key={ins.id} style={{
                background: style.bg,
                border: `1px solid ${style.border}`,
                borderRadius: 8,
                padding: '10px 12px',
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: style.color, marginBottom: 2 }}>{ins.title}</p>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{ins.message}</p>
                </div>
                <button
                  onClick={() => dismissInsight(ins.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, flexShrink: 0, marginTop: 1 }}
                >
                  <X size={13} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
