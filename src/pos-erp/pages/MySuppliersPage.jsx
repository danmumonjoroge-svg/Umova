// src/pos-erp/pages/MySuppliersPage.jsx
// My Suppliers (network): the businesses I am connected with, and requests waiting for an answer.
// Not required before searching: Find Stock works without a connection. A connection unlocks contract prices and
// orders from suppliers that only sell to connected businesses. Your own private supplier list stays on the Suppliers page.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { FitPage, CardGrid, DataCard, MiniStats, Notice, LoadingBlock, EmptyBlock, TextBtn } from '../components/CardKit';
import { OfflineBanner, ghostBtn, useLoad, useOnline } from '../components/network/networkKit';
import { usePermissions } from '../navigation/PermissionsContext';
import { networkService } from '../services/networkService';
import { mapNetworkError } from '../utils/networkHelpers';

const LABEL = {
  ACCEPTED: { tone: 'good', text: 'Connected' },
  PENDING_SENT: { tone: 'warn', text: 'Waiting for them' },
  PENDING_RECEIVED: { tone: 'warn', text: 'Wants to connect' },
  REJECTED: { tone: 'neutral', text: 'Declined' },
  ENDED: { tone: 'neutral', text: 'Ended' },
};

export default function MySuppliersPage() {
  const online = useOnline();
  const { can } = usePermissions();
  const list = useLoad(() => networkService.connections(), []);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState(null);
  const canDecide = can('settings.manage');

  const rows = (list.data || []).filter((c) => c.status !== 'ENDED');
  const kind = (c) => (c.status === 'PENDING' ? (c.direction === 'SENT' ? 'PENDING_SENT' : 'PENDING_RECEIVED') : c.status);
  const asked = rows.filter((c) => kind(c) === 'PENDING_RECEIVED').length;

  const answer = async (c, accept) => {
    if (busyId) return;
    setBusyId(c.connection_id); setErr(null);
    try { await networkService.respondConnection(c.connection_id, accept); await list.reload(); }
    catch (e) { setErr(mapNetworkError(e).message); } finally { setBusyId(null); }
  };

  return (
    <FitPage
      title="My Suppliers"
      icon={Users}
      subtitle="Businesses you are connected with."
      summary={!list.loading && !list.error && <MiniStats items={[{ label: 'Connected', value: rows.filter((c) => c.status === 'ACCEPTED').length, tone: 'good' }, { label: 'Waiting for you', value: asked, tone: asked ? 'gold' : undefined }]} />}
    >
      {!online && <OfflineBanner />}
      {err && <Notice tone="bad">{err}</Notice>}
      {list.loading && !list.data ? <LoadingBlock />
        : list.error && !list.data ? <Notice>{mapNetworkError(list.error).message} <button type="button" className="underline font-semibold ml-1" onClick={list.reload}>Try again</button></Notice>
        : rows.length === 0 ? (
          <EmptyBlock>
            <p>No connections yet.</p>
            <p className="mt-1 text-[12px]">Find a supplier in Find Stock, open an offer and tap “Ask to connect”.</p>
            <Link to="/pos/network/find" className={`${ghostBtn} mt-3 max-w-[220px] mx-auto`}>Go to Find Stock</Link>
          </EmptyBlock>
        ) : (
          <CardGrid>
            {rows.map((c) => {
              const k = kind(c);
              const ask = k === 'PENDING_RECEIVED';
              return (
                <DataCard
                  key={c.connection_id}
                  alert={ask}
                  title={c.other_name}
                  subtitle={ask && c.message ? c.message : `${c.order_count} order${c.order_count === 1 ? '' : 's'} together`}
                  pill={{ tone: LABEL[k].tone, label: LABEL[k].text }}
                  actions={ask ? (canDecide ? (
                    <>
                      <TextBtn disabled={busyId === c.connection_id || !online} onClick={() => answer(c, true)}>Accept</TextBtn>
                      <TextBtn tone="danger" disabled={busyId === c.connection_id || !online} onClick={() => answer(c, false)}>Decline</TextBtn>
                    </>
                  ) : <span className="text-[11px] text-[#8B8766]">The owner can answer this.</span>) : null}
                />
              );
            })}
          </CardGrid>
        )}
    </FitPage>
  );
}
