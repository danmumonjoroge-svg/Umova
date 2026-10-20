// Stops a double tap / double Enter from running the same save twice.
//
// Why this exists: buttons were protected only by a React state flag (setBusy(true) / disabled={busy}).
// State updates are asynchronous, so two taps within a few milliseconds BOTH ran the handler before the
// button became disabled. For a sale that means two sales, two sets of stock movements and (on a folio)
// two sets of folio lines. This guard is synchronous: while one run is in flight, further calls are ignored.
const inflight = new Set();

export function singleFlight(key, fn) {
  return async (...args) => {
    const ev = args[0];
    // a dropped form submit must still not fall through to the browser's own submit (page reload)
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    if (inflight.has(key)) return undefined;
    inflight.add(key);
    try { return await fn(...args); } finally { inflight.delete(key); }
  };
}

/** For tests only. */
export const _inflightCount = () => inflight.size;
