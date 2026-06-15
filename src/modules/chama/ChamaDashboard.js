import React, { useState, Suspense } from "react";
import {
  Users,
  Wallet,
  CreditCard,
  Landmark,
  UserCheck,
  Send,
  Repeat,
} from "lucide-react";

/* ---------------- LAZY MODULES ---------------- */
const Members = React.lazy(() => import("./chamamembers"));
const Contributions = React.lazy(() => import("./ChamaContributions"));
const Loans = React.lazy(() => import("./ChamaLoans"));
const Welfare = React.lazy(() => import("./ChamaWelfare"));
const Funds = React.lazy(() => import("./ChamaFunds"));
const Officials = React.lazy(() => import("./ChamaOfficialDashboard"));
const SendModule = React.lazy(() => import("./ChamasendContributions")); // FIXED NAME

/* ---------------- LOADING ---------------- */
const Loading = () => (
  <div className="p-6 text-slate-500">Loading module...</div>
);

/* ---------------- DASHBOARD ---------------- */
const ChamaDashboard = () => {
  const [activeModule, setActiveModule] = useState("members");

  const menu = [
    { key: "members", label: "Members", icon: Users },
    { key: "contributions", label: "Contributions", icon: Wallet },
    { key: "loans", label: "Loans", icon: CreditCard },
    { key: "welfare", label: "Welfare", icon: Repeat },
    { key: "funds", label: "Funds", icon: Landmark },
    { key: "officials", label: "Officials", icon: UserCheck },
    { key: "send", label: "Send", icon: Send },
  ];

  const renderModule = () => {
    switch (activeModule) {
      case "members":
        return <Members />;

      case "contributions":
        return <Contributions />;

      case "loans":
        return <Loans />;

      case "welfare":
        return <Welfare />;

      case "funds":
        return <Funds />;

      case "officials":
        return <Officials />;

      case "send":
        return <SendModule />;

      default:
        return <Members />;
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-100">

      {/* ================= SIDEBAR ================= */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col">

        <div className="p-4 border-b border-slate-700">
          <h1 className="text-emerald-400 font-bold text-lg">
            CHAMA ERP
          </h1>
          <p className="text-xs text-slate-400">
            SACCO Core System
          </p>
        </div>

        <nav className="flex-1 p-3 space-y-1">

          {menu.map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.key}
                onClick={() => setActiveModule(item.key)}
                className={`flex items-center gap-3 w-full p-2 rounded transition ${
                  activeModule === item.key
                    ? "bg-emerald-700"
                    : "hover:bg-slate-800"
                }`}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}

        </nav>

        <div className="p-3 border-t border-slate-700 text-xs text-slate-400">
          v1.0 SACCO Core System
        </div>

      </aside>

      {/* ================= MAIN ================= */}
      <main className="flex-1 p-6">

        <div className="bg-white rounded-xl shadow-sm border min-h-[80vh]">

          <Suspense fallback={<Loading />}>
            {renderModule()}
          </Suspense>

        </div>

      </main>

    </div>
  );
};

export default ChamaDashboard;