import useNotifications from "../hooks/useNotifications";

export default function NotificationBell({ user_id }) {

  const { notifications } = useNotifications(user_id);

  return (
    <div className="relative">

      <button className="bg-gray-800 text-white px-3 py-2 rounded">
        🔔 Notifications ({notifications.length})
      </button>

      {/* DROPDOWN */}
      <div className="absolute right-0 mt-2 w-80 bg-white shadow rounded max-h-96 overflow-y-auto">

        {notifications.length === 0 ? (
          <p className="p-3 text-sm text-gray-500">No notifications</p>
        ) : (
          notifications.map((n) => (
            <div key={n.id} className="p-3 border-b">

              <p className="font-bold text-sm">{n.title}</p>
              <p className="text-xs text-gray-600">{n.message}</p>

              <span className="text-xs text-gray-400">
                {new Date(n.created_at).toLocaleString()}
              </span>

            </div>
          ))
        )}

      </div>

    </div>
  );
}