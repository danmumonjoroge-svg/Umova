// src/pos-erp/pages/workspaces/ProductionWorkspace.jsx
// Production landing page. Every figure is read from real recipes and posted runs;
// a failed query shows "—", never a made-up number.
import React from 'react';
import { Factory, ChefHat } from 'lucide-react';
import { productionService } from '../../services/productionService';
import { todayLocal } from '../../services/roomService';
import { WorkspacePage, CardGrid, ActionCard, Stat, useStat, kes } from '../../components/workspace/WorkspaceKit';

export default function ProductionWorkspace() {
  const today = todayLocal();
  const drafts = useStat(async () => (await productionService.listRuns({ statuses: ['DRAFT'] })).length, []);
  const month = useStat(async () => {
    const rows = (await productionService.listRuns({ statuses: ['POSTED'], limit: 200 })).filter((r) => r.run_date >= `${today.slice(0, 7)}-01`);
    const exp = rows.reduce((s, r) => s + Number(r.expected_output || 0), 0);
    const act = rows.reduce((s, r) => s + Number(r.actual_output || 0), 0);
    return { runs: rows.length, yieldPct: exp > 0 ? (act / exp) * 100 : null, waste: rows.reduce((s, r) => s + Number(r.wastage_cost || 0), 0) };
  }, []);
  const recipes = useStat(async () => (await productionService.listRecipes()).rows.length, []);

  return (
    <WorkspacePage title="Production" subtitle="Turn materials into finished goods, and see what each one really cost.">
      <CardGrid>
        <ActionCard
          variant="feature" to="/pos/production-runs" icon={Factory} title="Production Runs"
          stat={<Stat state={drafts} format={(n) => (n > 0 ? `${n} to record` : 'None waiting')} />}
          description={month.value?.runs ? `This month: ${month.value.runs} run${month.value.runs > 1 ? 's' : ''}${month.value.yieldPct != null ? `, ${Math.round(month.value.yieldPct)}% yield` : ''}, ${kes(month.value.waste)} lost.` : 'Plan a batch, record what came out, and post it to stock.'}
          action="Open Production"
        />
        <ActionCard
          to="/pos/recipes" icon={ChefHat} title="Recipes"
          stat={<Stat state={recipes} />} statLabel="recipes"
          description="What goes in and what should come out, for one batch."
          action="View Recipes"
        />
      </CardGrid>
    </WorkspacePage>
  );
}
