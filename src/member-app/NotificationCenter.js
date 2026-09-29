import React from "react";
import { shortDate } from "./ui";

export function NotificationList({ notifications = [] }) {
  if (!notifications.length) return <p className="uma-empty">You're all caught up.</p>;
  return notifications.map((n, i) => (
    <div className="uma-row" key={n.id || i}>
      <div>
        <b>{n.title || "Notification"}</b>
        <div className="uma-note">{n.message || n.body}</div>
      </div>
      <span className="uma-note" style={{ whiteSpace: "nowrap" }}>{shortDate(n.created_at)}</span>
    </div>
  ));
}

// Small dropdown opened from the topbar bell. Full list lives at /member/notifications.
export default function NotificationCenter({ notifications, onClose, onSeeAll }) {
  return (
    <div className="uma-panel" role="dialog" aria-label="Notifications">
      <NotificationList notifications={notifications.slice(0, 6)} />
      <div className="uma-actions" style={{ paddingBottom: 8 }}>
        <button className="uma-btn uma-btn--ghost" onClick={onSeeAll}>See all</button>
        <button className="uma-btn uma-btn--ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
