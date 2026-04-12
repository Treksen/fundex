import MemberAvatar from '../components/MemberAvatar'
import PageHeader from '../components/PageHeader'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { TrendingUp, Wallet, Users, ArrowDownRight, Plus, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatCurrency, formatDate, formatPercentage, getMemberColor } from '../lib/utils'
import { Line, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  Title, Tooltip, Legend, ArcElement, Filler
} from 'chart.js'
import AddTransactionModal from '../components/transactions/AddTransactionModal'
import InsightsPanel from '../components/InsightsPanel'
import GroupHealthScore from '../components/GroupHealthScore'
import { useNavigate } from 'react-router-dom'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ArcElement, Filler)

export default function DashboardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalPool: 0,
    myContribution: 0,
    myWithdrawals: 0,
    myEquity: 0,
    myOwnership: 0,
    memberCount: 0,
  });
  const [members, setMembers] = useState([]);
  const [recentTx, setRecentTx] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddTx, setShowAddTx] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  // ✅ DEFINE FIRST
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchStats(),
        fetchMembers(),
        fetchRecentTx(),
        fetchChartData(),
        fetchPendingApprovals(),
      ]);
    } catch (err) {
      console.error("fetchAll error:", err);
    }
    setLoading(false);
  }, [profile]);
  
  useEffect(() => {
    fetchAll();
  }, [profile]);

  // Real-time: auto-refresh dashboard when transactions or approvals change
  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel("dashboard-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transactions" },
        () => fetchAll(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "withdrawal_approvals" },
        () => fetchAll(),
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile, fetchAll]);

  // const fetchAll = useCallback(async () => {
  //   setLoading(true);
  //   try {
  //     await Promise.all([
  //       fetchStats(),
  //       fetchMembers(),
  //       fetchRecentTx(),
  //       fetchChartData(),
  //       fetchPendingApprovals(),
  //     ]);
  //   } catch (err) {
  //     console.error("fetchAll error:", err);
  //   }
  //   setLoading(false);
  // }, [profile]);

  const fetchPendingApprovals = async () => {
    if (!profile) return;
    const { data } = await supabase
      .from("withdrawal_approvals")
      .select(
        "*, transactions!inner(id, amount, status, user_id, profiles!transactions_user_id_fkey(name))",
      )
      .eq("approver_id", profile.id)
      .eq("status", "pending")
      .eq("transactions.status", "pending");
    if (data) setPendingApprovals(data);
  };

  const fetchStats = async () => {
    const { data, error } = await supabase
      .from("member_equity_summary")
      .select("*");
    if (error || !data) return;
    const totalPool = data.reduce(
      (s, m) => s + Math.max(0, Number(m.available_equity || 0)),
      0,
    );
    const me = data.find((m) => m.id === profile?.id);
    const myContrib = me ? Number(me.total_deposits || 0) : 0;
    const myWithdraw = me ? Number(me.total_withdrawals || 0) : 0;
    const myEquity = me ? Number(me.available_equity || 0) : 0;
    const myOwnership =
      totalPool > 0 ? (Math.max(0, myEquity) / totalPool) * 100 : 0;
    setStats({
      totalPool,
      myContribution: myContrib,
      myWithdrawals: myWithdraw,
      myEquity,
      myOwnership,
      memberCount: data.length,
    });
  };

  const fetchMembers = async () => {
    const { data } = await supabase.from("member_equity_summary").select("*");
    if (data) {
      const totalEquity = data.reduce(
        (s, m) => s + Math.max(0, Number(m.available_equity || 0)),
        0,
      );
      setMembers(
        data.map((m) => ({
          ...m,
          ownership_pct:
            totalEquity > 0
              ? (Math.max(0, Number(m.available_equity || 0)) / totalEquity) *
                100
              : 0,
        })),
      );
    }
  };

  const fetchRecentTx = async () => {
    const { data } = await supabase
      .from("transactions")
      .select("*, profiles!transactions_user_id_fkey(name, avatar_url)")
      .order("transaction_date", { ascending: false })
      .limit(6);
    if (data) setRecentTx(data);
  };

  const fetchChartData = async () => {
    const { data, error } = await supabase
      .from("transactions")
      .select("amount, type, transaction_date")
      .eq("status", "completed")
      .order("transaction_date", { ascending: true });
    if (error || !data || data.length === 0) {
      setChartData([]);
      return;
    }
    const monthly = {};
    let running = 0;
    data.forEach((tx) => {
      const key = formatDate(tx.transaction_date, "MMM yy");
      if (!monthly[key]) monthly[key] = 0;
      running +=
        tx.type === "withdrawal" ? -Number(tx.amount) : Number(tx.amount);
      monthly[key] = running;
    });
    setChartData(Object.entries(monthly).slice(-12));
  };

  const lineData = useMemo(
    () => ({
      labels: chartData.map((d) => d[0]),
      datasets: [
        {
          label: "Pool Balance",
          data: chartData.map((d) => d[1]),
          borderColor: "#7a8c3a",
          backgroundColor: "rgba(122,140,58,0.12)",
          tension: 0.4,
          fill: true,
          pointBackgroundColor: "#7a8c3a",
          pointRadius: 4,
        },
      ],
    }),
    [chartData],
  );

  const lineOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#f5f7f5",
          titleColor: "#f0f4ff",
          bodyColor: "#8fa3c8",
          callbacks: { label: (ctx) => ` KES ${ctx.raw.toLocaleString()}` },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(0,0,0,0.04)" },
          ticks: { color: "#4a6080", font: { size: 10 }, maxRotation: 45 },
        },
        y: {
          grid: { color: "rgba(0,0,0,0.04)" },
          ticks: {
            color: "#4a6080",
            font: { size: 10 },
            callback: (v) => `${(v / 1000).toFixed(0)}k`,
          },
        },
      },
    }),
    [],
  );

  const doughnutData = useMemo(
    () => ({
      labels: members.map((m) => m.name?.split(" ")[0]),
      datasets: [
        {
          data: members.map((m) => Number(m.ownership_pct) || 0),
          backgroundColor: members.map((m) => getMemberColor(m.name)),
          borderColor: "#ffffff",
          borderWidth: 3,
          hoverOffset: 6,
        },
      ],
    }),
    [members],
  );

  const doughnutOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: "72%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${ctx.raw.toFixed(2)}%`,
          },
        },
      },
    }),
    [],
  );

  const STAT_CARDS = useMemo(
    () => [
      {
        label: "Total Pool Value",
        value: formatCurrency(stats.totalPool),
        icon: Wallet,
        color: "gold",
        bg: "rgba(122,140,58,0.08)",
      },
      {
        label: "My Contributions",
        value: formatCurrency(stats.myContribution),
        icon: TrendingUp,
        color: "green",
        bg: "rgba(16,185,129,0.08)",
      },
      {
        label: "My Withdrawals",
        value: formatCurrency(stats.myWithdrawals),
        icon: ArrowDownRight,
        color: "red",
        bg: "rgba(220,53,69,0.08)",
      },
      {
        label: "My Available Equity",
        value: formatCurrency(stats.myEquity),
        icon: Users,
        color: stats.myEquity < 0 ? "red" : "blue",
        bg:
          stats.myEquity < 0 ? "rgba(220,53,69,0.08)" : "rgba(59,130,246,0.08)",
      },
    ],
    [stats],
  );

  return (
    <div>
      {pendingApprovals.length > 0 && (
        <div
          onClick={() => navigate("/transactions")}
          style={{
            background: "rgba(230,144,10,0.08)",
            border: "1px solid rgba(230,144,10,0.28)",
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 18,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <AlertCircle
              size={18}
              style={{ color: "var(--accent-amber)", flexShrink: 0 }}
            />
            <div>
              <p
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--accent-amber)",
                }}
              >
                {pendingApprovals.length} withdrawal
                {pendingApprovals.length !== 1 ? "s" : ""} waiting for your
                approval
              </p>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  marginTop: 2,
                }}
              >
                {pendingApprovals
                  .map(
                    (a) =>
                      `${a.transactions?.profiles?.name} — ${formatCurrency(a.transactions?.amount)}`,
                  )
                  .join(" · ")}
              </p>
            </div>
          </div>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--accent-amber)",
              whiteSpace: "nowrap",
            }}
          >
            Review →
          </span>
        </div>
      )}

      <PageHeader
        title={`Welcome Back, ${profile?.name?.split(" ")[1]} 👋`}
        subtitle="Group Financial Overview"
        onRefresh={fetchAll}
        loading={loading}
      >
        <button className="btn btn-primary" onClick={() => setShowAddTx(true)}>
          <Plus size={15} /> Transact
        </button>
      </PageHeader>

      <div className="grid-4 mb-6">
        {STAT_CARDS.map((card) => (
          <div key={card.label} className="card">
            <div className="flex items-center justify-between mb-4">
              <span className="card-title">{card.label}</span>
              <div
                style={{
                  width: 36,
                  height: 36,
                  background: card.bg,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <card.icon
                  size={16}
                  style={{
                    color:
                      card.color === "gold"
                        ? "var(--olive-light)"
                        : card.color === "green"
                          ? "var(--accent-emerald)"
                          : card.color === "blue"
                            ? "var(--accent-blue-light)"
                            : card.color === "red"
                              ? "var(--accent-red)"
                              : "var(--text-secondary)",
                  }}
                />
              </div>
            </div>
            <div className={`stat-value ${card.color}`}>
              {loading ? (
                <div className="skeleton" style={{ width: 100, height: 28 }} />
              ) : (
                card.value
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Charts — stacks to 1 col on mobile via .dashboard-charts-grid */}
      <div className="dashboard-charts-grid">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Pool Growth Over Time</span>
          </div>
          <div style={{ height: 220 }}>
            {chartData.length > 0 ? (
              <Line data={lineData} options={lineOptions} />
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">📈</div>
                <p>No transaction data yet</p>
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Ownership Split</span>
            <span
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              net equity
            </span>
          </div>
          <div style={{ height: 160, position: "relative" }}>
            {members.some((m) => Number(m.ownership_pct) > 0) ? (
              <Doughnut data={doughnutData} options={doughnutOptions} />
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">🥧</div>
                <p>No contributions yet</p>
              </div>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            {[...members]
              .sort((a, b) => Number(b.ownership_pct) - Number(a.ownership_pct))
              .map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "6px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: getMemberColor(m.name),
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{ fontSize: 12, color: "var(--text-secondary)" }}
                    >
                      {m.name}
                    </span>
                  </div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span
                      style={{ fontSize: 11, color: "var(--accent-emerald)" }}
                    >
                      {formatCurrency(
                        Math.max(0, Number(m.available_equity || 0)),
                      )}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontFamily: "var(--font-mono)",
                        color: "var(--accent-blue)",
                        fontWeight: 700,
                        minWidth: 46,
                        textAlign: "right",
                      }}
                    >
                      {formatPercentage(m.ownership_pct, 1)}
                    </span>
                  </div>
                </div>
              ))}
          </div>
          <div
            style={{
              marginTop: 10,
              padding: "8px 10px",
              borderRadius: 8,
              background: "var(--olive-pale)",
              border: "1px solid rgba(90,138,30,0.2)",
            }}
          >
            <p
              style={{
                fontSize: 10,
                color: "var(--olive-dim)",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Your share
            </p>
            <p
              style={{
                fontSize: 20,
                fontWeight: 800,
                fontFamily: "var(--font-mono)",
                color: "var(--olive)",
                lineHeight: 1.2,
              }}
            >
              {formatPercentage(stats.myOwnership, 2)}
            </p>
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Recent Transactions</span>
          <a
            href="/transactions"
            style={{
              fontSize: 12,
              color: "var(--olive)",
              textDecoration: "none",
            }}
          >
            View all →
          </a>
        </div>
        {recentTx.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">💳</div>
            <p>No transactions yet</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="table-container tx-table-view">
              <table>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Date</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTx.map((tx) => (
                    <tr key={tx.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <MemberAvatar
                            name={tx.profiles?.name}
                            avatarUrl={tx.profiles?.avatar_url}
                            size={28}
                            fontSize={11}
                          />
                          <span>{tx.profiles?.name}</span>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`badge badge-${tx.type === "deposit" ? "green" : tx.type === "withdrawal" ? "red" : "amber"}`}
                        >
                          {tx.type}
                        </span>
                      </td>
                      <td className="text-secondary text-sm">
                        {tx.description || tx.reference || "—"}
                      </td>
                      <td className="text-sm text-muted">
                        {formatDate(tx.transaction_date)}
                      </td>
                      <td className="text-right text-mono font-semibold">
                        <span
                          style={{
                            color:
                              tx.type === "deposit"
                                ? "var(--accent-emerald)"
                                : "var(--accent-red)",
                          }}
                        >
                          {tx.type === "deposit" ? "+" : "-"}
                          {formatCurrency(tx.amount)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div>
              {recentTx.map((tx) => (
                <div
                  key={tx.id}
                  className="mobile-tx-card"
                  style={{ cursor: "default" }}
                >
                  <div className="mobile-tx-card-row">
                    <div className="mobile-tx-card-member">
                      <MemberAvatar
                        name={tx.profiles?.name}
                        avatarUrl={tx.profiles?.avatar_url}
                        size={36}
                        fontSize={13}
                      />
                      <div className="mobile-tx-card-info">
                        <div className="mobile-tx-card-name">
                          {tx.profiles?.name?.split(" ")[0]}
                        </div>
                        <div className="mobile-tx-card-sub">
                          {tx.description ||
                            tx.reference ||
                            formatDate(tx.transaction_date)}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 4,
                        flexShrink: 0,
                      }}
                    >
                      <span
                        className="mobile-tx-card-amount"
                        style={{
                          color:
                            tx.type === "deposit"
                              ? "var(--accent-emerald)"
                              : "var(--accent-red)",
                        }}
                      >
                        {tx.type === "deposit" ? "+" : "-"}
                        {formatCurrency(tx.amount)}
                      </span>
                      <span
                        className={`badge badge-${tx.type === "deposit" ? "green" : tx.type === "withdrawal" ? "red" : "amber"}`}
                        style={{ fontSize: 10 }}
                      >
                        {tx.type}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Group Health Score + Insights side by side on desktop */}
      <div className="grid-health-insights">
        <GroupHealthScore />
        <InsightsPanel />
      </div>

      {showAddTx && (
        <AddTransactionModal
          onClose={() => setShowAddTx(false)}
          onSuccess={fetchAll}
        />
      )}
    </div>
  );
}
