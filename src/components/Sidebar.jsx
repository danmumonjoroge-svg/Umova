import { Link, useLocation } from "react-router-dom";
import { useState } from "react";

export default function Sidebar() {
  const location = useLocation();
  const [openSections, setOpenSections] = useState({});

  const toggleSection = (section) => {
    setOpenSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // ✅ ACTIVE MATCH
  const isActive = (path) => location.pathname.startsWith(path);

  const linkClass = (path) =>
    `flex items-center gap-2 px-3 py-2 rounded text-sm transition ${
      isActive(path)
        ? "bg-blue-600 text-white"
        : "text-gray-300 hover:bg-gray-800"
    }`;

  // ✅ MENU CONFIG (CLEAN + SCALABLE)
  const menu = [
    {
      section: "Dashboard",
      items: [
        { name: "Dashboard", path: "/admin", icon: "📊" },
        { name: "Live Dashboard", path: "/admin/live-dashboard", icon: "⚡" },
      ],
    },
    {
      section: "Members",
      items: [
        { name: "Members", path: "/admin/members", icon: "👥" },
        { name: "Statements", path: "/admin/member-statements", icon: "📄" },
        { name: "Stories", path: "/admin/stories", icon: "📸" },
      ],
    },
    {
      section: "Payments",
      items: [
        { name: "Payments", path: "/admin/payments", icon: "💳" },
      ],
    },
    {
      section: "Loans",
      items: [
        { name: "Loans", path: "/admin/loans", icon: "💰" },
        { name: "Application", path: "/admin/loan-application", icon: "📝" },
        { name: "Approval", path: "/admin/loan-approval", icon: "✅" },
        { name: "Disbursement", path: "/admin/loan-disbursement", icon: "💸" },
        { name: "Repayments", path: "/admin/loan-repayments", icon: "🔁" },
        { name: "Schedule", path: "/admin/loan-schedule", icon: "📅" },
        { name: "Penalties", path: "/admin/loan-penalties", icon: "⚠️" },
      ],
    },
    {
      section: "Accounting",
      items: [
        { name: "Chart of Accounts", path: "/admin/chart-of-accounts", icon: "📚" },
        { name: "Trial Balance", path: "/admin/trial-balance", icon: "📊" },
        { name: "Balance Sheet", path: "/admin/balance-sheet", icon: "🧾" },
        { name: "Income Statement", path: "/admin/income-statement", icon: "📈" },
        { name: "Interest Dashboard", path: "/admin/interest-dashboard", icon: "📉" },
      ],
    },
    {
      section: "Reports",
      items: [
        { name: "Reports", path: "/admin/reports", icon: "📑" },
      ],
    },
    {
      section: "Executive",
      items: [
        { name: "Executive Dashboard", path: "/admin/executive", icon: "🧠" },
      ],
    },
  ];

  return (
    <div className="w-64 bg-gray-900 text-white min-h-screen flex flex-col">

      {/* HEADER */}
      <div className="p-4 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
        <h2 className="text-lg font-bold tracking-wide">
          SACCO ADMIN
        </h2>
      </div>

      {/* MENU */}
      <div className="flex-1 overflow-y-auto p-3">

        {menu.map((group, i) => (
          <div key={i} className="mb-3">

            {/* SECTION HEADER */}
            <button
              onClick={() => toggleSection(group.section)}
              className="w-full text-left text-xs text-gray-400 mb-2 uppercase tracking-wide hover:text-gray-200"
            >
              {group.section}
            </button>

            {/* ITEMS */}
            {openSections[group.section] !== false && (
              <div className="space-y-1">
                {group.items.map((item, idx) => (
                  <Link
                    key={idx}
                    to={item.path}
                    className={linkClass(item.path)}
                  >
                    <span>{item.icon}</span>
                    <span>{item.name}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}

      </div>

    </div>
  );
}