// src/pos-erp/pages/workspaces/SalonWorkspace.jsx
import React from 'react';
import { Scissors, CalendarClock } from 'lucide-react';
import { useAppointments } from '../../hooks/useSalon';
import { WorkspacePage, CardGrid, ActionCard } from '../../components/workspace/WorkspaceKit';

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function SalonWorkspace() {
  const { appointments, loading } = useAppointments();
  const todays = appointments.filter((a) => a.appointment_date === todayStr() && ['SCHEDULED', 'CONFIRMED'].includes(a.status)).length;

  return (
    <WorkspacePage title="Salon" subtitle="Your services and your appointments.">
      <CardGrid>
        <ActionCard
          variant="feature" to="/pos/appointments" icon={CalendarClock} title="Appointments"
          stat={loading ? '…' : todays > 0 ? `${todays} today` : 'None today'}
          description="Book a client, and complete a service when it is done."
          action="View Appointments"
        />
        <ActionCard
          to="/pos/services" icon={Scissors} title="Services"
          description="What you offer and what it costs."
          action="View Services"
        />
      </CardGrid>
    </WorkspacePage>
  );
}
