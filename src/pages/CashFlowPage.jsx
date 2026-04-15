import AdminActions from "../components/AdminActions";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Zap,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import { formatCurrency, formatDate } from "../lib/utils";
import PageHeader from "../components/PageHeader";
import ReserveFundPanel from "../components/ReserveFundPanel";
import { Bar, Line } from "react-chartjs-2";
import toast from "react-hot-toast";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

// Converts "2026-04" → "Apr 26"
function formatMonthLabel(ym) {
  if (!ym || ym === "unknown") return ym;
  const [year, month] = ym.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

export default function CashFlowPage() {
  const { isAdmin } = useAuth();
  const [forecast, setForecast] = useState(null);
  const [projections, setProjections] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [capital, setCapital] = useState([]);
  const [rawTxs, setRawTxs] = useState([]);
  const [rawContribs, setRawContribs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [projRes, txRes, accRes, capRes, reserveRes] = await Promise.all([
      supabase
        .from("cash_flow_projections")
        .select("*")
        .order("projection_date"),
      supabase
        .from("transactions")
        .select("type,amount,status,transaction_date")
        .eq("status", "completed")
        .order("transaction_date", { ascending: true }),
      supabase.from("virtual_accounts").select("*").order("account_type"),
      supabase
        .from("capital_accounts")
        .select("*, profiles!capital_accounts_member_id_fkey(name,avatar_url)"),
      supabase.from("reserve_contributions").select("direction,amount,source"),
    ]);

    if (projRes.data) setProjections(projRes.data);
    if (capRes.data) setCapital(capRes.data);
    if (accRes.data) setAccounts(accRes.data);

    const txs = txRes.data || [];
    const contribs = reserveRes.data || [];
    setRawTxs(txs);
    setRawContribs(contribs);

    // Build monthly summary
    const map = {};
    txs.forEach((t) => {
      const key = t.transaction_date
        ? t.transaction_date.slice(0, 7)
        : "unknown";
      if (!map[key]) map[key] = { label: key, in: 0, out: 0, net: 0 };
      if (t.type === "deposit") {
        map[key].in += Number(t.amount);
        map[key].net += Number(t.amount);
      }
      if (t.type === "withdrawal") {
        map[key].out += Number(t.amount);
        map[key].net -= Number(t.amount);
      }
      if (t.type === "adjustment") {
        map[key].in += Number(t.amount);
        map[key].net += Number(t.amount);
      }
    });
    const sortedKeys = Object.keys(map).sort().slice(-12);
    let running = 0;
    setMonthly(
      sortedKeys.map((k) => {
        running += map[k].net;
        return { ...map[k], label: formatMonthLabel(k), balance: running };
      }),
    );

    // Background sync — fire and forget safely
    supabase
      .rpc("sync_virtual_account_balances")
      .then(() => {})
      .catch(() => {});

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Derive balances from raw source data — always accurate regardless of virtual_accounts state
  const totalDeposits = rawTxs
    .filter((t) => t.type === "deposit")
    .reduce((s, t) => s + Number(t.amount), 0);
  const totalWithdrawals = rawTxs
    .filter((t) => t.type === "withdrawal")
    .reduce((s, t) => s + Number(t.amount), 0);
  const totalAdjustments = rawTxs
    .filter((t) => t.type === "adjustment")
    .reduce((s, t) => s + Number(t.amount), 0);
  const reserveFromPool = rawContribs
    .filter((r) => r.source === "group_pool")
    .reduce(
      (s, r) =>
        s + (r.direction === "allocate" ? Number(r.amount) : -Number(r.amount)),
      0,
    );
  const currentBalance =
    totalDeposits - totalWithdrawals + totalAdjustments - reserveFromPool;
  const invBalance =
    accounts.find((a) => a.account_code === "INV_WALLET")?.balance || 0;
  const liquidBalance = currentBalance - invBalance;
  const liquidPct =
    currentBalance > 0 ? Math.round((liquidBalance / currentBalance) * 100) : 0;

  // Build accounts display list with computed values patched in
  const displayAccounts = (() => {
    const computedReserve = rawContribs.reduce(
      (s, r) =>
        s + (r.direction === "allocate" ? Number(r.amount) : -Number(r.amount)),
      0,
    );
    const base = accounts.length
      ? accounts
      : [
          {
            id: "gw",
            account_code: "GROUP_WALLET",
            account_name: "Group Wallet",
            account_type: "group",
            balance: 0,
            updated_at: new Date().toISOString(),
          },
          {
            id: "rf",
            account_code: "RESERVE_FUND",
            account_name: "Emergency Reserve Fund",
            account_type: "reserve",
            balance: 0,
            updated_at: new Date().toISOString(),
          },
          {
            id: "iw",
            account_code: "INV_WALLET",
            account_name: "Investment Wallet",
            account_type: "investment",
            balance: 0,
            updated_at: new Date().toISOString(),
          },
        ];
    return base.map((a) => {
      if (a.account_code === "GROUP_WALLET")
        return { ...a, balance: currentBalance };
      if (a.account_code === "RESERVE_FUND")
        return { ...a, balance: computedReserve };
      return a;
    });
  })();

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const runForecast = async () => {
    setGenerating(true);
    const { data, error } = await supabase.rpc("generate_cash_flow_forecast", {
      p_days: 90,
    });
    if (error) {
      toast.error(error.message);
    } else {
      setForecast(data);
      toast.success("Forecast updated!");
      fetchData();
    }
    setGenerating(false);
  };

  // Get latest projection values
  const proj30 = projections.find(
    (p) =>
      Math.abs(
        (new Date(p.projection_date) - new Date()) / (1000 * 60 * 60 * 24) - 30,
      ) < 5,
  );
  const proj60 = projections.find(
    (p) =>
      Math.abs(
        (new Date(p.projection_date) - new Date()) / (1000 * 60 * 60 * 24) - 60,
      ) < 5,
  );
  const proj90 = projections.find(
    (p) =>
      Math.abs(
        (new Date(p.projection_date) - new Date()) / (1000 * 60 * 60 * 24) - 90,
      ) < 5,
  );

  const riskFlag = proj30
    ? Number(proj30.projected_balance) < 0
      ? "critical"
      : Number(proj30.projected_balance) < currentBalance * 0.3
        ? "warning"
        : "safe"
    : "safe";

  const cashFlowChartData = useMemo(
    () => ({
      labels: monthly.map((m) => m.label),
      datasets: [
        {
          label: "Inflows",
          data: monthly.map((m) => m.in),
          backgroundColor: "rgba(13,156,94,0.7)",
          borderRadius: 4,
        },
        {
          label: "Outflows",
          data: monthly.map((m) => m.out),
          backgroundColor: "rgba(220,53,69,0.7)",
          borderRadius: 4,
        },
      ],
    }),
    [monthly],
  );

  const balanceChartData = useMemo(
    () => ({
      labels: [
        ...monthly.map((m) => m.label),
        ...(proj30 ? ["+30d"] : []),
        ...(proj60 ? ["+60d"] : []),
        ...(proj90 ? ["+90d"] : []),
      ],
      datasets: [
        {
          label: "Balance",
          data: [
            ...monthly.map((m) => m.balance),
            ...(proj30 ? [Number(proj30.projected_balance)] : []),
            ...(proj60 ? [Number(proj60.projected_balance)] : []),
            ...(proj90 ? [Number(proj90.projected_balance)] : []),
          ],
          borderColor:
            riskFlag === "critical" ? "var(--accent-red)" : "var(--olive)",
          backgroundColor:
            riskFlag === "critical"
              ? "rgba(220,53,69,0.10)"
              : "rgba(90,138,30,0.10)",
          tension: 0.4,
          fill: true,
          pointRadius: 3,
        },
      ],
    }),
    [monthly, proj30, proj60, proj90, riskFlag],
  );

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: "#8a9a90", font: { size: 11 } } },
      tooltip: {
        callbacks: { label: (ctx) => ` KES ${ctx.raw.toLocaleString()}` },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: "#8a9a90", font: { size: 10 } },
      },
      y: {
        grid: { color: "rgba(128,128,128,0.1)" },
        ticks: {
          color: "#8a9a90",
          font: { size: 10 },
          callback: (v) => `${(v / 1000).toFixed(0)}k`,
        },
      },
    },
  };

  return (
    <div>
      <PageHeader
        title="Cash Flow & Projections"
        subtitle="Inflows, outflows, virtual accounts, and 90-day liquidity forecast"
        onRefresh={fetchData}
        loading={loading}
      >
        <button
          className="btn btn-primary"
          onClick={runForecast}
          disabled={generating}
        >
          {generating ? (
            <>
              <div className="spinner" style={{ width: 14, height: 14 }} />{" "}
              Forecasting…
            </>
          ) : (
            <>
              <Zap size={14} /> Run Forecast
            </>
          )}
        </button>
      </PageHeader>

      {/* Risk banner */}
      {riskFlag !== "safe" && (
        <div
          style={{
            background:
              riskFlag === "critical"
                ? "rgba(220,53,69,0.08)"
                : "rgba(230,144,10,0.08)",
            border: `1px solid ${riskFlag === "critical" ? "rgba(220,53,69,0.25)" : "rgba(230,144,10,0.25)"}`,
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <AlertTriangle
            size={16}
            style={{
              color:
                riskFlag === "critical"
                  ? "var(--accent-red)"
                  : "var(--accent-amber)",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color:
                riskFlag === "critical"
                  ? "var(--accent-red)"
                  : "var(--accent-amber)",
            }}
          >
            {riskFlag === "critical"
              ? "🚨 Critical liquidity risk — projected balance will go negative within 30 days"
              : "⚠️ Liquidity warning — projected balance drops below 30% reserve in 30 days"}
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="page-tab-bar">
        {[
          ["overview", "Overview"],
          ["reserve", "🛡️ Reserve Fund"],
          ["virtual", "Virtual Accounts"],
          ["capital", "Capital Accounts"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{
              padding: "9px 16px",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontFamily: "var(--font-main)",
              fontSize: 14,
              fontWeight: 600,
              borderBottom:
                activeTab === id
                  ? "2px solid var(--olive)"
                  : "2px solid transparent",
              color: activeTab === id ? "var(--olive)" : "var(--text-muted)",
              position: "relative",
              bottom: -1,
              transition: "all 0.15s",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Projection cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
              gap: 10,
            }}
          >
            {[
              {
                label: "Current Balance",
                value: formatCurrency(currentBalance),
                color: "var(--navy-light)",
                sub: "Live pool",
              },
              {
                label: "Liquid Available",
                value: formatCurrency(liquidBalance),
                color: "var(--accent-emerald)",
                sub: `${liquidPct}% of pool`,
              },
              {
                label: "In 30 Days",
                value: proj30
                  ? formatCurrency(proj30.projected_balance)
                  : "Run forecast",
                color:
                  riskFlag === "safe"
                    ? "var(--olive)"
                    : riskFlag === "warning"
                      ? "var(--accent-amber)"
                      : "var(--accent-red)",
                sub: "Projection",
              },
              {
                label: "In 60 Days",
                value: proj60 ? formatCurrency(proj60.projected_balance) : "—",
                color: "var(--text-secondary)",
                sub: "Projection",
              },
              {
                label: "In 90 Days",
                value: proj90 ? formatCurrency(proj90.projected_balance) : "—",
                color: "var(--text-muted)",
                sub: "Projection",
              },
            ].map((s) => (
              <div
                key={s.label}
                className="card"
                style={{ padding: "12px 14px" }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    marginBottom: 4,
                  }}
                >
                  {s.label}
                </div>
                <div
                  style={{
                    fontSize: 17,
                    fontWeight: 800,
                    fontFamily: "var(--font-mono)",
                    color: s.color,
                  }}
                >
                  {s.value}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    marginTop: 2,
                  }}
                >
                  {s.sub}
                </div>
              </div>
            ))}
          </div>

          {/* Balance timeline chart */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">
                Balance Timeline + 90-Day Forecast
              </span>
            </div>
            <div style={{ height: 240 }}>
              {monthly.length > 0 ? (
                <Line data={balanceChartData} options={chartOpts} />
              ) : (
                <div className="empty-state">
                  <p>No transaction data yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Cash flow bar chart */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">
                Monthly Cash Flow (Inflows vs Outflows)
              </span>
            </div>
            <div style={{ height: 220 }}>
              {monthly.length > 0 ? (
                <Bar data={cashFlowChartData} options={chartOpts} />
              ) : (
                <div className="empty-state">
                  <p>No data yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Monthly table */}
          {monthly.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div
                style={{
                  padding: "14px 16px 10px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span className="card-title">Monthly Breakdown</span>
              </div>
              <div
                className="table-container"
                style={{ border: "none", borderRadius: 0 }}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th style={{ textAlign: "right" }}>Inflows</th>
                      <th style={{ textAlign: "right" }}>Outflows</th>
                      <th style={{ textAlign: "right" }}>Net</th>
                      <th style={{ textAlign: "right" }}>Running Balance</th>
                      {isAdmin && <th style={{ width: 70 }}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {monthly.map((m) => (
                      <tr key={m.label}>
                        <td style={{ fontWeight: 600 }}>{m.label}</td>
                        <td
                          style={{
                            textAlign: "right",
                            fontFamily: "var(--font-mono)",
                            color: "var(--accent-emerald)",
                            fontSize: 13,
                          }}
                        >
                          {formatCurrency(m.in)}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            fontFamily: "var(--font-mono)",
                            color: "var(--accent-red)",
                            fontSize: 13,
                          }}
                        >
                          {formatCurrency(m.out)}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            fontFamily: "var(--font-mono)",
                            fontWeight: 700,
                            fontSize: 13,
                            color:
                              m.net >= 0
                                ? "var(--accent-emerald)"
                                : "var(--accent-red)",
                          }}
                        >
                          {m.net >= 0 ? "+" : ""}
                          {formatCurrency(m.net)}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            fontFamily: "var(--font-mono)",
                            fontWeight: 800,
                            fontSize: 13,
                            color: "var(--navy-light)",
                          }}
                        >
                          {formatCurrency(m.balance)}
                        </td>
                        {isAdmin && (
                          <td>
                            <AdminActions
                              onDelete={async () => {
                                if (
                                  !window.confirm(
                                    `Delete all cash flow projections for ${m.label}?`,
                                  )
                                )
                                  return;
                                const { error } = await supabase
                                  .from("cash_flow_projections")
                                  .delete()
                                  .gte("projection_date", m.label)
                                  .lte("projection_date", m.label);
                                if (error) toast.error(error.message);
                                else {
                                  toast.success("Projection deleted");
                                  fetchData();
                                }
                              }}
                              size="xs"
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "reserve" && <ReserveFundPanel onUpdate={fetchData} />}

      {activeTab === "virtual" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              background: "rgba(26,36,114,0.06)",
              border: "1px solid rgba(26,36,114,0.15)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              color: "var(--text-secondary)",
            }}
          >
            🏦 Virtual accounts provide internal fund separation — Group Wallet
            (liquid pool), Investment Wallet (deployed capital), and per-member
            accounts tracking individual equity.
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
              gap: 10,
            }}
          >
            {displayAccounts.map((acc) => {
              const typeColor =
                {
                  group: "var(--navy-light)",
                  investment: "var(--olive)",
                  member: "var(--accent-emerald)",
                  reserve: "var(--accent-amber)",
                }[acc.account_type] || "var(--text-primary)";
              return (
                <div
                  key={acc.id}
                  className="card"
                  style={{ borderLeft: `3px solid ${typeColor}` }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>
                        {acc.account_name}
                      </div>
                      {/* <div style={{fontSize:11,color:'var(--text-muted)',fontFamily:'var(--font-mono)',marginTop:2}}>{acc.account_code}</div> */}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexShrink: 0,
                      }}
                    >
                      <span
                        className="badge badge-gray"
                        style={{ fontSize: 10, textTransform: "capitalize" }}
                      >
                        {acc.account_type}
                      </span>
                      {isAdmin && (
                        <AdminActions
                          onDelete={async () => {
                            const isSys = [
                              "GROUP_WALLET",
                              "INV_WALLET",
                              "RESERVE_FUND",
                            ].includes(acc.account_code);
                            const msg = isSys
                              ? `⚠️ Delete system account "${acc.account_name}"?\n\nThis will reset its balance to 0. It will be recreated on next sync. Only do this to fix corrupt data.`
                              : `Delete virtual account "${acc.account_name}"? It will be recreated on next sync.`;
                            if (!window.confirm(msg)) return;
                            if (
                              acc.id &&
                              !["gw", "rf", "iw"].includes(acc.id)
                            ) {
                              const { error } = await supabase
                                .from("virtual_accounts")
                                .delete()
                                .eq("id", acc.id);
                              if (error) toast.error(error.message);
                              else {
                                toast.success(
                                  "Account deleted — re-sync to restore",
                                );
                                fetchData();
                              }
                            } else {
                              toast.error(
                                "Synthetic account — run migration to create real virtual_accounts first",
                              );
                            }
                          }}
                          size="xs"
                        />
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 900,
                      fontFamily: "var(--font-mono)",
                      color: typeColor,
                    }}
                  >
                    {formatCurrency(acc.balance)}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: 4,
                    }}
                  >
                    Updated {new Date(acc.updated_at).toLocaleDateString()}
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      height: 4,
                      background: "var(--bg-elevated)",
                      borderRadius: 99,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        background: typeColor,
                        width: `${Math.min(100, Math.max(0, currentBalance > 0 ? (Number(acc.balance) / currentBalance) * 100 : 0))}%`,
                        borderRadius: 99,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === "capital" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div
            style={{
              padding: "14px 16px 10px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span className="card-title">Capital Accounts</span>
            <p
              style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}
            >
              Paid-in capital, retained earnings, and profit allocations per
              member
            </p>
          </div>
          {capital.length === 0 ? (
            <div className="empty-state">
              <p>No capital accounts yet — run the migration and sync</p>
            </div>
          ) : (
            <div
              className="table-container"
              style={{ border: "none", borderRadius: 0 }}
            >
              <table>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th style={{ textAlign: "right" }}>Paid-In Capital</th>
                    <th style={{ textAlign: "right" }}>Retained Earnings</th>
                    <th style={{ textAlign: "right" }}>Current Year Profit</th>
                    <th style={{ textAlign: "right" }}>Carry Forward</th>
                    <th style={{ textAlign: "right" }}>Total Capital</th>
                    {isAdmin && <th style={{ width: 80 }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {capital.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 600 }}>{c.profiles?.name}</td>
                      <td
                        style={{
                          textAlign: "right",
                          fontFamily: "var(--font-mono)",
                          fontSize: 13,
                        }}
                      >
                        {formatCurrency(c.paid_in_capital)}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          fontFamily: "var(--font-mono)",
                          fontSize: 13,
                          color: "var(--accent-emerald)",
                        }}
                      >
                        {formatCurrency(c.retained_earnings)}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          fontFamily: "var(--font-mono)",
                          fontSize: 13,
                          color: "var(--olive)",
                        }}
                      >
                        {formatCurrency(c.current_year_profit)}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          fontFamily: "var(--font-mono)",
                          fontSize: 13,
                          color: "var(--text-muted)",
                        }}
                      >
                        {formatCurrency(c.carry_forward)}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          fontFamily: "var(--font-mono)",
                          fontWeight: 800,
                          fontSize: 14,
                          color: "var(--navy-light)",
                        }}
                      >
                        {formatCurrency(c.total_capital)}
                      </td>
                      {isAdmin && (
                        <td>
                          <AdminActions
                            onDelete={async () => {
                              if (
                                !window.confirm(
                                  `Reset capital account for ${c.profiles?.name}? This deletes the record (it will be recreated on next sync).`,
                                )
                              )
                                return;
                              const { error } = await supabase
                                .from("capital_accounts")
                                .delete()
                                .eq("id", c.id);
                              if (error) toast.error(error.message);
                              else {
                                toast.success("Capital account reset");
                                fetchData();
                              }
                            }}
                            size="xs"
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
