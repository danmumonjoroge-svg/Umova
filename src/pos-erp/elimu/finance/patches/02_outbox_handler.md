# Patch 2 - let the POS outbox submit Elimu fee drafts (proposal, not applied)

In `offline/syncEngine.js`, `HANDLERS` is a private const. Smallest change:

```js
// syncEngine.js
const HANDLERS = { shift_open, sale };
export function registerOutboxHandler(kind, fn) { if (!HANDLERS[kind]) HANDLERS[kind] = fn; }
```
Then at app start, in Elimu code:
```js
registerOutboxHandler('elimu_fee_payment', async (row) => {
  const res = await financeApi.recordPayment(row.payload.businessId, row.payload.studentId, { ...row.payload, clientReference: row.clientReference });
  return { serverId: res.payment_id, serverNumber: res.receipt_no };   // PENDING payments return no receipt: show as "awaiting confirmation"
});
```
`client_reference` makes replays safe (E003 unique index). Do not mark an outbox row "synced = paid": inspect `res.status` - PENDING is not money.
