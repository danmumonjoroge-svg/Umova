// src/pos-erp/pages/workspaces/MessagesWorkspace.jsx
//
// Communication workspace (brief section 5). WhatsApp and email are two
// CHANNELS of the same message flow in this app (whatsappService /
// emailService behind CustomerCommunicationPage, and supplier messages
// behind SuppliersPage), so they are not separate cards -- one honest
// entry per place a message can actually be written.
// Messages here are prepared for the owner to send (WhatsApp/mailto);
// nothing is auto-sent (see communicationService.js).

import React from 'react';
import { MessageSquare, Truck, Bell } from 'lucide-react';
import { useNotifications } from '../../hooks/useNotifications';
import { WorkspacePage, CardGrid, ActionCard } from '../../components/workspace/WorkspaceKit';

export default function MessagesWorkspace() {
  const { count, loading, error } = useNotifications();

  return (
    <WorkspacePage title="Messages" subtitle="Talk to customers and suppliers, and see what needs your attention.">
      <CardGrid>
        <ActionCard
          variant="feature" to="/pos/messages" icon={MessageSquare} title="Customer Messages"
          description="WhatsApp and email: receipts, reminders and payment follow-ups."
          action="Open Messages"
        />
        <ActionCard
          to="/pos/suppliers" icon={Truck} title="Supplier Messages"
          description="Open a supplier to send them an order or a payment note."
          action="Choose a Supplier"
        />
        <ActionCard
          variant={count > 0 ? 'alert' : 'default'}
          to="/pos/communication" icon={Bell} title="Notifications"
          stat={loading ? '…' : error ? '—' : count > 0 ? `${count} new` : 'All clear'}
          description="Alerts about stock, shifts and cash."
          action="See Notifications"
        />
      </CardGrid>
    </WorkspacePage>
  );
}
