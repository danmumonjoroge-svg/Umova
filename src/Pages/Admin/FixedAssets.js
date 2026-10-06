import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { postJournal } from "../../services/journalAPI";
import { getSystemAccount } from "../../services/chartOfAccountsAPI";
import { Page, SectionCard, Field, Tabs, StatusBadge, EmptyState, KpiCard, kes, todayISO } from "./AdminUI";

/**
 * Scoped to Computer/Software — the only categories with real asset +
 * accumulated-depreciation account pairs in the Chart of Accounts.
 * Disposal is NOT built (no Gain/Loss on Disposal account exists yet).
 * Posting logic is unchanged; this file only changes the presentation.
 */
const CATEGORY_KEYS = {
  Computer: { asset: "ASSET_COMPUTER", accumDep: "ACCUM_DEP_COMPUTER" },
  Software: { asset: "ASSET_SOFTWARE", accumDep: "ACCUM_DEP_SOFTWARE" },
};

const monthBounds = (yyyyMm) => {
  const [y, m] = yyyyMm.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};

const EMPTY_FORM = {
  asset_number: "", category: "Computer", description: "", acquisition_date: todayISO(),
  supplier_id: "", acquisition_cost: "", useful_life_years: "", location: "", department: "",
  payment_method: "Bank",
};

export default function FixedAssets() {
  const [tab, setTab] = useState("purchase");
  const [assets, setAssets] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [accountIds, setAccountIds] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [depPeriod, setDepPeriod] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => { loadAssets(); loadSuppliers(); loadSystemAccounts(); }, []);

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
          getSystemAccount("CASH"), getSystemAccount("BANK"),
          getSystemAccount("ASSET_COMPUTER"), getSystemAccount("ASSET_SOFTWARE"),
          getSystemAccount("ACCUM_DEP_COMPUTER"), getSystemAccount("ACCUM_DEP_SOFTWARE"),
          getSystemAccount("DEPRECIATION_EXPENSE"),
        ]);
      setAccountIds({ CASH, BANK, ASSET_COMPUTER, ASSET_SOFTWARE, ACCUM_DEP_COMPUTER, ACCUM_DEP_SOFTWARE, DEPRECIATION_EXPENSE });
    } catch (err) {
      setResult({ ok: false, text: `Chart of Accounts mapping failed to load: ${err.message || err}` });
    }
  };

  // ================= PURCHASE =================
  const submitAsset = async () => {
    const f = form;
    if (!f.asset_number || !f.acquisition_date || !f.acquisition_cost || !f.useful_life_years) {
      return setResult({ ok: false, text: "Asset number, acquisition date, cost and useful life are all required." });
    }
    if (!accountIds) return setResult({ ok: false, text: "Chart of Accounts mapping hasn't loaded yet." });

    setLoading(true);
    setResult(null);
    let journalRef = null;
    try {
      const cost = Number(f.acquisition_cost);
      journalRef = `FA-${Date.now()}`;
      const cashOrBank = f.payment_method === "Cash" ? accountIds.CASH : accountIds.BANK;

      // Fixed Asset DR, Cash/Bank CR (direct cash/bank purchase only).
      await postJournal({
        reference: journalRef,
        date: f.acquisition_date,
        description: `Asset purchase: ${f.asset_number} (${f.description || f.category})`,
        source_module: "fixed_assets",
        lines: [
          { account_id: accountIds[CATEGORY_KEYS[f.category].asset], debit: cost, credit: 0 },
          { account_id: cashOrBank, debit: 0, credit: cost },
        ],
      });

      const { error } = await supabase.from("fixed_assets").insert([{
        asset_number: f.asset_number, category: f.category, description: f.description,
        acquisition_date: f.acquisition_date, supplier_id: f.supplier_id || null,
        acquisition_cost: cost, useful_life_years: Number(f.useful_life_years),
        location: f.location, department: f.department, journal_reference: journalRef,
      }]);
      if (error) throw Object.assign(error, { afterPost: true });

      setResult({ ok: true, text: `Asset ${f.asset_number} recorded · purchase posted (${journalRef})` });
      setForm({ ...EMPTY_FORM, acquisition_date: todayISO() });
      loadAssets();
      setTab("register");
    } catch (err) {
      setResult({
        ok: false,
        text: err.afterPost
          ? `Purchase journal ${journalRef} WAS posted, but the asset record failed to save: ${err.message}. Do not post again — contact support to link it.`
          : `Asset not recorded: ${err.message || err}`,
      });
    } finally {
      setLoading(false);
    }
  };

  // ================= DEPRECIATION =================
  const runDepreciation = async () => {
    if (!depPeriod) return setResult({ ok: false, text: "Select a month to run depreciation for." });
    if (!accountIds) return setResult({ ok: false, text: "Chart of Accounts mapping hasn't loaded yet." });

    const { start, end } = monthBounds(depPeriod);
    const activeAssets = assets.filter((a) => a.status === "active");
    if (activeAssets.length === 0) return setResult({ ok: false, text: "No active assets to depreciate." });

    setLoading(true);
    setResult(null);
    let posted = 0, skipped = 0, failed = 0;

    for (const asset of activeAssets) {
      const netBookValue = Number(asset.acquisition_cost) - Number(asset.accumulated_depreciation);
      if (netBookValue <= 0.005) { skipped++; continue; }
      const monthlyAmount = Number(asset.acquisition_cost) / (Number(asset.useful_life_years) * 12);
      const amount = Math.min(monthlyAmount, netBookValue); // never depreciate past zero NBV

      try {
        const journalRef = `DEP-${asset.asset_number}-${depPeriod}`;
        await postJournal({
          reference: journalRef,
          date: end,
          description: `Depreciation: ${asset.asset_number} (${depPeriod})`,
          source_module: "fixed_assets",
          lines: [
            { account_id: accountIds.DEPRECIATION_EXPENSE, debit: amount, credit: 0 },
            { account_id: accountIds[CATEGORY_KEYS[asset.category].accumDep], debit: 0, credit: amount },
          ],
        });

        const { error: runErr } = await supabase.from("asset_depreciation_runs").insert([{
          asset_id: asset.id, period_start: start, period_end: end, amount, journal_reference: journalRef,
        }]);
        if (runErr) {
          if (runErr.code === "23505") { skipped++; continue; } // already run for this period
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
    setResult({
      ok: failed === 0,
      text: `Depreciation for ${depPeriod}: ${posted} posted, ${skipped} skipped (already run or fully depreciated), ${failed} failed.`,
    });
    loadAssets();
  };

  const totalCost = assets.reduce((s, a) => s + Number(a.acquisition_cost || 0), 0);
  const totalDep = assets.reduce((s, a) => s + Number(a.accumulated_depreciation || 0), 0);

  return (
    <Page
      intro="Computer and Software assets only. Disposal isn't built yet (it needs a Gain/Loss on Disposal account)."
      result={result} onCloseResult={() => setResult(null)}
    >
      <div className="ua-stat-row">
        <KpiCard label="Assets" value={assets.length} />
        <KpiCard label="Total cost" value={kes(totalCost)} />
        <KpiCard label="Accum. depreciation" value={kes(totalDep)} />
        <KpiCard label="Net book value" value={kes(totalCost - totalDep)} />
      </div>

      <Tabs value={tab} onChange={setTab} items={[
        { key: "purchase", label: "Record purchase" },
        { key: "depreciation", label: "Depreciation" },
        { key: "register", label: "Register", count: assets.length },
      ]} />

      {tab === "purchase" && (
        <SectionCard title="Record asset purchase">
          <div className="ua-form cols-2">
            <Field label="Asset number" htmlFor="fa-no"><input id="fa-no" placeholder="e.g. FA-0001" value={form.asset_number} onChange={set("asset_number")} /></Field>
            <Field label="Category" htmlFor="fa-cat">
              <select id="fa-cat" value={form.category} onChange={set("category")}>
                <option value="Computer">Computer</option><option value="Software">Software</option>
              </select>
            </Field>
            <Field label="Description" span2 htmlFor="fa-desc"><input id="fa-desc" value={form.description} onChange={set("description")} /></Field>
            <Field label="Acquisition date" htmlFor="fa-date"><input id="fa-date" type="date" value={form.acquisition_date} onChange={set("acquisition_date")} /></Field>
            <Field label="Supplier (optional)" htmlFor="fa-sup">
              <select id="fa-sup" value={form.supplier_id} onChange={set("supplier_id")}>
                <option value="">— None —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Acquisition cost" htmlFor="fa-cost">
              <div className="ua-amount"><span>KES</span>
                <input id="fa-cost" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={form.acquisition_cost} onChange={set("acquisition_cost")} />
              </div>
            </Field>
            <Field label="Useful life (years)" htmlFor="fa-life"><input id="fa-life" type="number" inputMode="numeric" min="1" step="1" value={form.useful_life_years} onChange={set("useful_life_years")} /></Field>
            <Field label="Location" htmlFor="fa-loc"><input id="fa-loc" value={form.location} onChange={set("location")} /></Field>
            <Field label="Department" htmlFor="fa-dep"><input id="fa-dep" value={form.department} onChange={set("department")} /></Field>
            <Field label="Paid via" span2>
              <Tabs className="choice" value={form.payment_method} onChange={(v) => setForm((f) => ({ ...f, payment_method: v }))}
                items={[{ key: "Bank", label: "Bank" }, { key: "Cash", label: "Cash" }]} />
            </Field>
          </div>
          <button type="button" className="ua-btn ua-btn-primary ua-submit" onClick={submitAsset} disabled={loading || !accountIds}>
            {loading ? "Posting…" : "Record & post purchase"}
          </button>
        </SectionCard>
      )}

      {tab === "depreciation" && (
        <SectionCard title="Run monthly depreciation" subtitle="Posts one journal per active asset. Months already run are skipped.">
          <div className="ua-inline">
            <Field label="Month" htmlFor="fa-month">
              <input id="fa-month" type="month" value={depPeriod} max={todayISO().slice(0, 7)} onChange={(e) => setDepPeriod(e.target.value)} />
            </Field>
            <button type="button" className="ua-btn ua-btn-primary" onClick={runDepreciation} disabled={loading || !accountIds}>
              {loading ? "Running…" : "Run depreciation"}
            </button>
          </div>
        </SectionCard>
      )}

      {tab === "register" && (
        <SectionCard title="Asset register">
          {assets.length === 0 ? (
            <EmptyState title="No assets yet" message="Recorded purchases will appear here." />
          ) : (
            <div className="ua-table-wrap">
              <table className="ua-table stack">
                <thead><tr><th>Asset #</th><th>Category</th><th className="num">Cost</th><th className="num">Accum. dep.</th><th className="num">Net book value</th><th>Status</th></tr></thead>
                <tbody>
                  {assets.map((a) => (
                    <tr key={a.id}>
                      <td data-label="Asset #"><strong>{a.asset_number}</strong></td>
                      <td data-label="Category">{a.category}</td>
                      <td data-label="Cost" className="num">{kes(a.acquisition_cost)}</td>
                      <td data-label="Accum. dep." className="num">{kes(a.accumulated_depreciation)}</td>
                      <td data-label="Net book value" className="num">{kes(Number(a.acquisition_cost) - Number(a.accumulated_depreciation))}</td>
                      <td data-label="Status"><StatusBadge tone={a.status === "active" ? "success" : "neutral"}>{a.status}</StatusBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
    </Page>
  );
}
