import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { postJournal } from "../../services/journalAPI";
import { getSystemAccount } from "../../services/chartOfAccountsAPI";

/**
 * Section 16, scoped to Computer/Software — the only categories with real
 * asset + accumulated-depreciation account pairs in the Chart of Accounts.
 * Disposal is NOT built (see migration comment — no Gain/Loss on Disposal
 * account exists yet).
 */
const CATEGORY_KEYS = {
  Computer: { asset: "ASSET_COMPUTER", accumDep: "ACCUM_DEP_COMPUTER" },
  Software: { asset: "ASSET_SOFTWARE", accumDep: "ACCUM_DEP_SOFTWARE" },
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthBounds = (yyyyMm) => {
  const [y, m] = yyyyMm.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};

export default function FixedAssets() {
  const [assets, setAssets] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [accountIds, setAccountIds] = useState(null);

  const [form, setForm] = useState({
    asset_number: "", category: "Computer", description: "", acquisition_date: "",
    supplier_id: "", acquisition_cost: "", useful_life_years: "", location: "", department: "",
    payment_method: "Bank",
  });

  const [depPeriod, setDepPeriod] = useState(""); // "2026-09"
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadAssets();
    loadSuppliers();
    loadSystemAccounts();
  }, []);

  const loadAssets = async () => {
    const { data } = await supabase.from("fixed_assets").select("*").order("acquisition_date", { ascending: false });
    setAssets(data || []);
  };

  const loadSuppliers = async () => {
    const { data } = await supabase.from("suppliers").select("id, name").order("name");
    setSuppliers(data || []);
  };

  const loadSystemAccounts = async () => {
    try {
      const [CASH, BANK, ASSET_COMPUTER, ASSET_SOFTWARE, ACCUM_DEP_COMPUTER, ACCUM_DEP_SOFTWARE, DEPRECIATION_EXPENSE] =
        await Promise.all([
          getSystemAccount("CASH"),
          getSystemAccount("BANK"),
          getSystemAccount("ASSET_COMPUTER"),
          getSystemAccount("ASSET_SOFTWARE"),
          getSystemAccount("ACCUM_DEP_COMPUTER"),
          getSystemAccount("ACCUM_DEP_SOFTWARE"),
          getSystemAccount("DEPRECIATION_EXPENSE"),
        ]);
      setAccountIds({ CASH, BANK, ASSET_COMPUTER, ASSET_SOFTWARE, ACCUM_DEP_COMPUTER, ACCUM_DEP_SOFTWARE, DEPRECIATION_EXPENSE });
    } catch (err) {
      alert(`Failed to load Chart of Accounts mapping: ${err.message || err}`);
    }
  };

  // ================= PURCHASE =================
  const submitAsset = async () => {
    const f = form;
    if (!f.asset_number || !f.acquisition_date || !f.acquisition_cost || !f.useful_life_years) {
      return alert("Asset number, acquisition date, cost, and useful life are all required.");
    }
    if (!accountIds) return alert("Chart of Accounts mapping hasn't loaded yet.");

    setLoading(true);
    try {
      const cost = Number(f.acquisition_cost);
      const journalRef = `FA-${Date.now()}`;
      const assetAcctKey = CATEGORY_KEYS[f.category].asset;
      const cashOrBank = f.payment_method === "Cash" ? accountIds.CASH : accountIds.BANK;

      // Asset Purchase: Fixed Asset DR, Cash/Bank CR. Scoped to direct
      // cash/bank purchase — buying on credit through Accounts Payable
      // isn't wired up here.
      await postJournal({
        reference: journalRef,
        date: f.acquisition_date,
        description: `Asset purchase: ${f.asset_number} (${f.description || f.category})`,
        source_module: "fixed_assets",
        lines: [
          { account_id: accountIds[assetAcctKey], debit: cost, credit: 0 },
          { account_id: cashOrBank, debit: 0, credit: cost },
        ],
      });

      const { error } = await supabase.from("fixed_assets").insert([{
        asset_number: f.asset_number,
        category: f.category,
        description: f.description,
        acquisition_date: f.acquisition_date,
        supplier_id: f.supplier_id || null,
        acquisition_cost: cost,
        useful_life_years: Number(f.useful_life_years),
        location: f.location,
        department: f.department,
        journal_reference: journalRef,
      }]);
      if (error) throw error;

      alert("✅ Asset recorded and purchase posted");
      setForm({ asset_number: "", category: "Computer", description: "", acquisition_date: "", supplier_id: "", acquisition_cost: "", useful_life_years: "", location: "", department: "", payment_method: "Bank" });
      loadAssets();
    } catch (err) {
      alert(`Failed to record asset: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  // ================= DEPRECIATION =================
  const runDepreciation = async () => {
    if (!depPeriod) return alert("Select a month to run depreciation for.");
    if (!accountIds) return alert("Chart of Accounts mapping hasn't loaded yet.");

    const { start, end } = monthBounds(depPeriod);
    const activeAssets = assets.filter((a) => a.status === "active");
    if (activeAssets.length === 0) return alert("No active assets to depreciate.");

    setLoading(true);
    let posted = 0, skipped = 0, failed = 0;

    for (const asset of activeAssets) {
      const netBookValue = Number(asset.acquisition_cost) - Number(asset.accumulated_depreciation);
      if (netBookValue <= 0.005) { skipped++; continue; }

      const monthlyAmount = Number(asset.acquisition_cost) / (Number(asset.useful_life_years) * 12);
      const amount = Math.min(monthlyAmount, netBookValue); // never depreciate past zero NBV

      try {
        const journalRef = `DEP-${asset.asset_number}-${depPeriod}`;
        const accumDepAcctKey = CATEGORY_KEYS[asset.category].accumDep;

        await postJournal({
          reference: journalRef,
          date: end,
          description: `Depreciation: ${asset.asset_number} (${depPeriod})`,
          source_module: "fixed_assets",
          lines: [
            { account_id: accountIds.DEPRECIATION_EXPENSE, debit: amount, credit: 0 },
            { account_id: accountIds[accumDepAcctKey], debit: 0, credit: amount },
          ],
        });

        const { error: runErr } = await supabase.from("asset_depreciation_runs").insert([{
          asset_id: asset.id, period_start: start, period_end: end, amount, journal_reference: journalRef,
        }]);
        if (runErr) {
          // unique (asset_id, period_start, period_end) — already run for this period
          if (runErr.code === "23505") { skipped++; continue; }
          throw runErr;
        }

        await supabase.from("fixed_assets")
          .update({ accumulated_depreciation: Number(asset.accumulated_depreciation) + amount })
          .eq("id", asset.id);

        posted++;
      } catch (err) {
        console.error(`Depreciation failed for ${asset.asset_number}`, err);
        failed++;
      }
    }

    setLoading(false);
    alert(`Depreciation run complete: ${posted} posted, ${skipped} skipped (already run or fully depreciated), ${failed} failed.`);
    loadAssets();
  };

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h2>Fixed Assets</h2>
      <p style={{ color: "#666" }}>
        Scoped to Computer and Software — the only categories with a matching
        asset + accumulated-depreciation account pair in the Chart of Accounts.
        Disposal isn't built yet (needs a Gain/Loss on Disposal account).
      </p>

      <h4>Record Asset Purchase</h4>
      <div style={{ display: "grid", gap: 8, maxWidth: 420, marginBottom: 32 }}>
        <input placeholder="Asset number (e.g. FA-0001)" value={form.asset_number} onChange={(e) => setForm((f) => ({ ...f, asset_number: e.target.value }))} />
        <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
          <option value="Computer">Computer</option>
          <option value="Software">Software</option>
        </select>
        <input placeholder="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        <label>Acquisition date<input type="date" value={form.acquisition_date} onChange={(e) => setForm((f) => ({ ...f, acquisition_date: e.target.value }))} /></label>
        <select value={form.supplier_id} onChange={(e) => setForm((f) => ({ ...f, supplier_id: e.target.value }))}>
          <option value="">-- Supplier (optional) --</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="number" placeholder="Acquisition cost" value={form.acquisition_cost} onChange={(e) => setForm((f) => ({ ...f, acquisition_cost: e.target.value }))} />
        <input type="number" placeholder="Useful life (years)" value={form.useful_life_years} onChange={(e) => setForm((f) => ({ ...f, useful_life_years: e.target.value }))} />
        <input placeholder="Location" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
        <input placeholder="Department" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} />
        <select value={form.payment_method} onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}>
          <option value="Bank">Paid via Bank</option>
          <option value="Cash">Paid via Cash</option>
        </select>
        <button onClick={submitAsset} disabled={loading}>Record & Post Purchase</button>
      </div>

      <h4>Run Monthly Depreciation</h4>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 32 }}>
        <input type="month" value={depPeriod} onChange={(e) => setDepPeriod(e.target.value)} max={todayISO().slice(0, 7)} />
        <button onClick={runDepreciation} disabled={loading}>Run Depreciation for this Month</button>
      </div>

      <h4>Asset Register</h4>
      <table width="100%" cellPadding={6} style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th>Asset #</th><th>Category</th><th>Cost</th><th>Accum. Depreciation</th><th>Net Book Value</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>{a.asset_number}</td>
              <td>{a.category}</td>
              <td>{a.acquisition_cost}</td>
              <td>{Number(a.accumulated_depreciation).toFixed(2)}</td>
              <td>{(Number(a.acquisition_cost) - Number(a.accumulated_depreciation)).toFixed(2)}</td>
              <td>{a.status}</td>
            </tr>
          ))}
          {assets.length === 0 && <tr><td colSpan={6}>No assets recorded yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
