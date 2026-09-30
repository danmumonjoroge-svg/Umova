// src/pos-erp/pages/workspaces/RentalsWorkspace.jsx
import React from 'react';
import { Home, Repeat, Gauge, FileText, Wrench } from 'lucide-react';
import { useUnits } from '../../hooks/useProperty';
import { WorkspacePage, CardGrid, ActionCard } from '../../components/workspace/WorkspaceKit';

export default function RentalsWorkspace() {
  const { units, loading } = useUnits();
  const occupied = units.filter((u) => u.status === 'OCCUPIED').length;

  return (
    <WorkspacePage title="Rentals" subtitle="Your units, what tenants owe, and meter readings.">
      <CardGrid>
        <ActionCard
          variant="feature" to="/pos/units" icon={Home} title="Units"
          stat={loading ? '…' : `${occupied} of ${units.length}`} statLabel="occupied"
          description="Rooms, houses and shops, and who lives in them."
          action="View Units"
        />
        <ActionCard
          to="/pos/charges" icon={Repeat} title="Rent & Charges"
          description="Monthly rent and other recurring charges, and tenant payments."
          action="Open Charges"
        />
        <ActionCard
          to="/pos/meters" icon={Gauge} title="Meters"
          description="Water and electricity readings for each unit."
          action="Open Meters"
        />
        <ActionCard
          to="/pos/invoices" icon={FileText} title="My Invoices"
          description="Send each tenant a clear invoice and get paid."
          action="Open Invoices"
        />
        <ActionCard
          to="/pos/maintenance" icon={Wrench} title="My Maintenance"
          description="Repairs and jobs for your units, and what they cost."
          action="Open Maintenance"
        />
      </CardGrid>
    </WorkspacePage>
  );
}
