/* ════════════════════════════════════════════════════════════════════════════
   CHAMA CONTRIBUTIONS ANALYZER v3.3
   Optimized for Supabase 'chama_contributions' schema
════════════════════════════════════════════════════════════════════════════ */

import React, { useState, useMemo, useEffect, useReducer } from 'react';
import { toast } from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { BarChart3, TrendingUp, Search, Download, RefreshCw, X, Wallet, AlertTriangle } from 'lucide-react';

/* Financial Logic */
const FinancialEngine = {
  formatKES: (val) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(val || 0),
  
  processRow: (row) => ({
    ...row,
    savings: Number(row.savings) || 0,
    fines: Number(row.fines) || 0,
    loans: Number(row.loans) || 0,
    welfare: Number(row.welfare) || 0,
    get grandTotal() { return this.savings + this.fines + this.loans + this.welfare; }
  })
};

/* State Management */
const initialState = { search: '', view: 'table' };
const reducer = (state, action) => {
  switch (action.type) {
    case 'SET_SEARCH': return { ...state, search: action.payload };
    case 'SET_VIEW': return { ...state, view: action.payload };
    default: return state;
  }
};

export default function ChamaAnalyzer({ chamaId }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!chamaId) return;

    // Fetch initial data
    const loadData = async () => {
      const { data: fetched, error } = await supabase
        .from('chama_contributions')
        .select('*')
        .eq('chama_id', chamaId);
      
      if (error) toast.error('Failed to load contributions');
      else setData(fetched.map(FinancialEngine.processRow));
      setLoading(false);
    };

    loadData();

    // Real-time subscription
    const channel = supabase.channel('realtime-contributions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chama_contributions', filter: `chama_id=eq.${chamaId}` }, 
      (payload) => {
        if (payload.eventType === 'INSERT') setData(prev => [...prev, FinancialEngine.processRow(payload.new)]);
        if (payload.eventType === 'UPDATE') setData(prev => prev.map(m => m.id === payload.new.id ? FinancialEngine.processRow(payload.new) : m));
      }).subscribe();

    return () => supabase.removeChannel(channel);
  }, [chamaId]);

  const filteredData = useMemo(() => 
    data.filter(m => m.name?.toLowerCase().includes(state.search.toLowerCase())),
  [data, state.search]);

  if (loading) return <div className="p-8 text-center">Loading Contribution Data...</div>;

  return (
    <div className="chama-container">
      <header className="toolbar">
        <input 
          placeholder="Search member..." 
          onChange={(e) => dispatch({ type: 'SET_SEARCH', payload: e.target.value })}
        />
        <button onClick={() => dispatch({ type: 'SET_VIEW', payload: state.view === 'table' ? 'charts' : 'table' })}>
          Toggle {state.view === 'table' ? 'Charts' : 'Table'}
        </button>
      </header>

      <table className="chama_contributions">
        <thead>
          <tr>
            <th>name</th>
            <th>savings</th>
            <th>loans</th>
            <th>fines</th>
            <th>welfare</th>
            <th>total</th>
          </tr>
        </thead>
        <tbody>
          {filteredData.map(m => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td>{FinancialEngine.formatKES(m.savings)}</td>
              <td>{FinancialEngine.formatKES(m.loans)}</td>
              <td>{FinancialEngine.formatKES(m.fines)}</td>
              <td>{FinancialEngine.formatKES(m.welfare)}</td>
              <td className="font-bold">{FinancialEngine.formatKES(m.grandTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}