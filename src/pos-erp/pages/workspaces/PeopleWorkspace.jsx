// src/pos-erp/pages/workspaces/PeopleWorkspace.jsx
//
// Customer workspace (brief section 5). "People Who Owe Me" and
// "Statements" live inside the existing CustomersPage (its own
// receivables filter and statement drawer) -- this page routes there
// rather than duplicating any of it.

import React from 'react';
import { UserRound, Users, FileText, MessageSquare } from 'lucide-react';
import { customerService } from '../../services/customerService';
import { WorkspacePage, CardGrid, ActionCard, Stat, useStat, kes } from '../../components/workspace/WorkspaceKit';

export default function PeopleWorkspace() {
  const total = useStat(async () => (await customerService.getAll({ activeOnly: true, limit: 1 })).count ?? 0, []);
  const owing = useStat(async () => {
    const rows = await customerService.getWithOutstandingBalances();
    return { count: rows.length, amount: rows.reduce((s, c) => s + Number(c.outstanding_balance || 0), 0) };
  }, []);

  return (
    <WorkspacePage title="Customers" subtitle="The people you sell to, and who still owes you.">
      <CardGrid>
        <ActionCard
          variant="feature" to="/pos/customers" icon={UserRound} title="Customers"
          stat={<Stat state={total} />} statLabel="customers"
          description="Add customers, see what they bought and their balance."
          action="View Customers"
        />
        <ActionCard
          variant={owing.value?.count > 0 ? 'alert' : 'default'}
          to="/pos/customers" icon={Users} title="People Who Owe Me"
          stat={<Stat state={owing} format={(o) => kes(o.amount)} />}
          statLabel={owing.value ? `from ${owing.value.count}` : undefined}
          description="Open a customer and record their payment."
          action="See Who Owes Me"
        />
        <ActionCard
          to="/pos/customers" icon={FileText} title="Statements"
          description="Open any customer to view or print their statement."
          action="Choose a Customer"
        />
        <ActionCard
          to="/pos/messages" icon={MessageSquare} title="Messages"
          description="Send a customer a receipt, a reminder or a note on WhatsApp or email."
          action="Open Messages"
        />
      </CardGrid>
    </WorkspacePage>
  );
}
