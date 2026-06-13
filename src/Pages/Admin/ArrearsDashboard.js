import React, { useEffect, useState, useMemo } from "react";
import { supabase } from "../../supabaseClient";
import { calculateArrearsFromLedger } from "../../utils/arrearsEngine"; // Adjust import path as needed
import { 
  ShieldAlert, Search, MessageSquare, AlertOctagon, 
  Coins, Users, RefreshCw, Filter, Calendar, TrendingDown
} from "lucide-react";

export default function ArrearsDashboard() {
  const [ledgerRows, setLedgerRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRiskTier, setSelectedRiskTier] = useState("ALL");
  const [isEscalatingId, setIsEscalatingId] = useState(null);

  // --- DIRECT CORE LEDGER DATA INGESTION ---
  const fetchGeneralLedgerData = async () => {
    try {
      setLoading(true);
      // Query raw transactional mappings for Loan Principal (1011) and Interest Revenue (1020)
      const { data, error } = await supabase
        .from("general_ledger")
        .select("*")
        .or("debit_account_id.in.(1011,1020),credit_account_id.in.(1011,1020)")
        .order("created_at", { ascending: true });

      if (error) throw error;
      setLedgerRows(data || []);
    } catch (err) {
      console.error("Critical error while reading general ledger streams:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGeneralLedgerData();
  }, []);

  // --- CALCULATION ENGINE COUPLING LAYER ---
  const processedArrearsData = useMemo(() => {
    return calculateArrearsFromLedger(ledgerRows);
  }, [ledgerRows]);

  // --- SUMMARY KPI AGGREGATOR ---
  const structuralMetrics = useMemo(() => {
    let summaryPrincipal = 0;
    let summaryProvisions = 0;
    let summaryPenalties = 0;
    let counts = { WATCH: 0, SUBSTANDARD: 0, DOUBTFUL: 0, LOSS: 0 };

    processedArrearsData.forEach(p => {
      summaryPrincipal += p.balance;
      summaryProvisions += p.lossProvision;
      summaryPenalties += p.penalty_accrued;
      if (counts[p.riskTier] !== undefined) counts[p.riskTier]++;
    });

    return { summaryPrincipal, summaryProvisions, summaryPenalties, counts };
  }, [processedArrearsData]);

  // --- DYNAMIC SEARCH & TIER FILTER VIEW ---
  const dynamicFilteredView = useMemo(() => {
    return processedArrearsData.filter(p => {
      const queryMatch = String(p.member_no).toLowerCase().includes(searchQuery.toLowerCase());
      const tierMatch = selectedRiskTier === "ALL" || p.riskTier === selectedRiskTier;
      return queryMatch && tierMatch;
    });
  }, [processedArrearsData, searchQuery, selectedRiskTier]);

  // --- ESCALATION OUTBOX COMMUNICATOR HOOK ---
  const dispatchEscalationSms = async (profile) => {
    try {
      setIsEscalatingId(profile.member_no);
      const messageBody = `🚨 *URGENT ARREARS RECOVERY EXECUTABLE*\n\nMember Ref: ${profile.member_no}\nAccount Exposure Group: *${profile.riskTier}*\nDays in Arrears: *${profile.arrears_days} Days Overdue*\n\nOutstanding Balance: USD ${profile.balance.toLocaleString()}\nAccrued Penalty: USD ${profile.penalty_accrued.toLocaleString()}\n\nKindly dispatch clearances immediately to prevent account credit rating suspensions.`;

      const { error } = await supabase.from("whatsapp_outbox").insert([{
        member_no: profile.member_no,
        phone: "", // Fallback defaults to queue-level picker lookup
        type: "ledger_arrears_escalation",
        message: messageBody
      }]);

      if (error) throw error;
      alert(`Success: Escalation notice queued for Member Account ${profile.member_no}`);
    } catch (err) {
      alert(`Execution Pipeline Interrupted: ${err.message}`);
    } finally {
      setIsEscalatingId(null);
    }
  };

  const formatCurrency = (val) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 bg-slate-950 min-h-screen text-slate-100 font-sans">
      
      {/* 1. TOP BRAND PROFILE CONSOLE BAR */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-800 pb-6 gap-4">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-3">
            <ShieldAlert className="text-rose-500" size={32} />
            Arrears Management Command Center
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Analyzing real-time credit impairment matrices derived directly from the ground-truth <span className="font-mono text-amber-400">general_ledger</span>.
          </p>
        </div>
        <button onClick={fetchGeneralLedgerData} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 font-bold text-xs px-4 py-2.5 rounded-xl transition flex items-center gap-2 self-start md:self-auto">
          <RefreshCw size={14} /> Re-sync General Ledger
        </button>
      </div>

      {/* 2. CORE PERFORMANCE STATS ROW */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <SummaryCard 
          title="Total Portfolio Value at Risk (PAR)" 
          value={formatCurrency(structuralMetrics.summaryPrincipal)} 
          subtitle="Net outstanding principal currently past due (Code 1011)" 
          icon={<Coins className="text-rose-400" />} 
          styling="border-rose-500/20 bg-rose-500/5" 
        />
        <SummaryCard 
          title="Impairment Provisions Required" 
          value={formatCurrency(structuralMetrics.summaryProvisions)} 
          subtitle="Regulatory expected reserve capital requirements" 
          icon={<TrendingDown className="text-orange-400" />} 
          styling="border-orange-500/20 bg-orange-500/5" 
        />
        <SummaryCard 
          title="Accrued Administrative Penalties" 
          value={formatCurrency(structuralMetrics.summaryPenalties)} 
          subtitle="Derived 10% interest baseline premium formulas" 
          icon={<AlertOctagon className="text-amber-400" />} 
          styling="border-amber-500/20 bg-amber-500/5" 
        />
      </div>

      {/* 3. DRILLDOWN CONTROLS AND MULTI-AXIS FILTERS CONTAINER */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex flex-col lg:flex-row gap-4 justify-between items-center">
        <div className="relative w-full lg:max-w-xs">
          <Search className="absolute left-4 top-3.5 text-slate-500" size={15} />
          <input 
            type="text" 
            placeholder="Filter by Member Reference..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-11 pr-4 py-2.5 text-xs text-slate-200 outline-none focus:border-rose-500/50 transition"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* TIER TABS SYSTEM */}
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          {["ALL", "WATCH", "SUBSTANDARD", "DOUBTFUL", "LOSS"].map(tier => (
            <button
              key={tier}
              onClick={() => setSelectedRiskTier(tier)}
              className={`text-xs font-black px-3 py-2 rounded-lg border transition ${
                selectedRiskTier === tier 
                  ? "bg-rose-600 text-white border-rose-500 shadow-lg shadow-rose-950/40" 
                  : "bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700"
              }`}
            >
              {tier} ({tier === "ALL" ? processedArrearsData.length : structuralMetrics.counts[tier]})
            </button>
          ))}
        </div>
      </div>

      {/* 4. GROUND TRUTH BALANCES SHEET MATRIX TABLE */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        {loading ? (
          <div className="p-12 text-center text-slate-400 font-semibold animate-pulse">Running data aggregation filters against active general ledger records...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-950 text-xs font-bold text-slate-400 uppercase border-b border-slate-800 tracking-wider">
                  <th className="p-4">Member ID</th>
                  <th className="p-4 text-right">Derived Exposure Balance</th>
                  <th className="p-4 text-center">Arrears Aging Tracker</th>
                  <th className="p-4 text-right">Calculated Provisions</th>
                  <th className="p-4 text-center">Impairment Tier</th>
                  <th className="p-4 text-right">Emergency Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-sm text-slate-300 font-medium">
                {dynamicFilteredView.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-12 text-center text-slate-500 italic">No non-performing credit tracking profiles matched your parameters.</td>
                  </tr>
                ) : (
                  dynamicFilteredView.map((p) => (
                    <tr key={p.member_no} className="hover:bg-slate-800/30 transition-colors duration-150">
                      <td className="p-4">
                        <div className="flex items-center space-x-3">
                          <div className="p-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-400 font-bold text-xs">
                            <Users size={14} />
                          </div>
                          <div>
                            <span className="text-white font-bold block">Member #{p.member_no}</span>
                            <span className="text-[11px] text-slate-500 font-mono">Vintage Vintage: {p.vintageYear}</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-right font-mono text-slate-100 font-bold">{formatCurrency(p.balance)}</td>
                      <td className="p-4 text-center">
                        <div className="inline-block mx-auto">
                          <span className="text-sm font-black text-white block">{p.arrears_days} Days</span>
                          <span className="text-[10px] text-slate-500 block font-sans whitespace-nowrap">Last Activity: {p.lastRepayment}</span>
                        </div>
                      </td>
                      <td className="p-4 text-right font-mono text-slate-400">{formatCurrency(p.lossProvision)}</td>
                      <td className="p-4 text-center">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-black tracking-wide border block text-center max-w-[120px] mx-auto ${p.badgeClass}`}>
                          {p.riskTier}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <button
                          onClick={() => dispatchEscalationSms(p)}
                          disabled={isEscalatingId === p.member_no}
                          className="bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-bold px-3 py-1.5 rounded-xl transition inline-flex items-center gap-2 hover:text-white"
                        >
                          <MessageSquare size={12} className="text-rose-400" />
                          Escalate Collections Notice
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

function SummaryCard({ title, value, subtitle, icon, styling }) {
  return (
    <div className={`p-6 rounded-2xl border flex flex-col justify-between backdrop-blur-sm shadow-xl transition duration-200 ${styling}`}>
      <div className="flex justify-between items-start">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{title}</span>
        <div className="p-2 bg-slate-950 border border-slate-800 rounded-xl">{icon}</div>
      </div>
      <div className="mt-4">
        <h3 className="text-2xl font-black text-white tracking-tight">{value}</h3>
        <p className="text-[11px] text-slate-500 mt-0.5 font-medium italic">{subtitle}</p>
      </div>
    </div>
  );
}