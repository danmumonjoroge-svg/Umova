import "./AdminLayout.css";

import Dashboard from "./Dashboard";
import Members from "./Members";
import Loan from "./Loans";
import MemberStatements from "./MemberStatements";
import ERPDashboard from "./ERPDashboard";

import LoanApplications from "./LoanApplication";
import LoanRepayments from "./LoanRepayments";
import LoanAnalytics from "./LoanAnalytics";
import LoanDisbursement from "./LoanDisbursement";

import ArrearsDashboard from "./ArrearsDashboard";
import PARDashboard from "./PARDashboard";

import TrialBalance from "./TrialBalance";
import IncomeStatement from "./IncomeStatement";
import BalanceSheet from "./BalanceSheet";

import JournalEntries from "./JournalEntry";
import JournalList from "./JournalLine";

import FinancialReports from "./Reports";
import StoryDashboard from "./StoryDashboard";
import Settings from "./Settings";
import Payments from "./Payments";

/* NEW WHATSAPP */
import WhatsAppCenter from "./WhatsAppCenter";

import { useState, useMemo } from "react";

import {
  Home,
  Users,
  CreditCard,
  FileText,
  BarChart3,
  Settings as SettingsIcon,
  DollarSign,
  BookOpen,
  TrendingUp,
  Activity,
  Bell,
  Menu,
  PieChart,
  MessageCircle
} from "lucide-react";

const MENU = [
  {
    title: "CORE OPERATIONS",
    items: [
      { key: "dashboard", label: "Dashboard", component: Dashboard, icon: Home },
      { key: "erp", label: "ERP Overview", component: ERPDashboard, icon: BarChart3 },
      { key: "members", label: "Members", component: Members, icon: Users },
      { key: "statements", label: "Member Statements", component: MemberStatements, icon: FileText },
      { key: "payments", label: "Payments", component: Payments, icon: DollarSign }
    ]
  },

  {
    title: "LOAN ENGINE",
    items: [
      { key: "loan", label: "Loans", component: Loan, icon: CreditCard },
      { key: "loan_applications", label: "Loan Applications", component: LoanApplications, icon: FileText },
      { key: "loan_repayments", label: "Loan Repayments", component: LoanRepayments, icon: DollarSign },
      { key: "loan_analytics", label: "Loan Analytics", component: LoanAnalytics, icon: TrendingUp },
      { key: "loan_disbursement", label: "Loan Disbursement", component: LoanDisbursement, icon: Activity }
    ]
  },

  {
    title: "RISK & ARREARS",
    items: [
      { key: "arrears", label: "Arrears Dashboard", component: ArrearsDashboard, icon: Activity },
      { key: "par", label: "PAR Analysis", component: PARDashboard, icon: TrendingUp },
      { key: "story_dashboard", label: "Risk Engine", component: StoryDashboard, icon: PieChart }
    ]
  },

  {
    title: "ACCOUNTING CORE",
    items: [
      { key: "trial_balance", label: "Trial Balance", component: TrialBalance, icon: BookOpen },
      { key: "income_statement", label: "Income Statement", component: IncomeStatement, icon: TrendingUp },
      { key: "balance_sheet", label: "Balance Sheet", component: BalanceSheet, icon: BarChart3 },
      { key: "journal_entries", label: "Journal Entries", component: JournalEntries, icon: FileText },
      { key: "journal_list", label: "Journal Line", component: JournalList, icon: BookOpen }
    ]
  },

  /* NEW WHATSAPP SECTION */

  {
    title: "COMMUNICATION",
    items: [
      {
        key: "whatsapp",
        label: "WhatsApp Center",
        component: WhatsAppCenter,
        icon: MessageCircle
      }
    ]
  },

  {
    title: "REPORTING",
    items: [
      { key: "financial_reports", label: "Financial Reports", component: FinancialReports, icon: BarChart3 }
    ]
  },

  {
    title: "SYSTEM CONTROL",
    items: [
      { key: "settings", label: "Settings", component: Settings, icon: SettingsIcon }
    ]
  }
];

export default function AdminLayout() {

  const [activeTab, setActiveTab] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const filteredMenu = useMemo(() => {

    if (!search) return MENU;

    return MENU.map(group => ({
      ...group,
      items: group.items.filter(item =>
        item.label.toLowerCase().includes(search.toLowerCase())
      )
    })).filter(group => group.items.length > 0);

  }, [search]);

  let ActiveComponent = null;

  MENU.forEach(group => {
    group.items.forEach(item => {
      if (item.key === activeTab) {
        ActiveComponent = item.component;
      }
    });
  });

  return (
    <div className="admin-container">

      {/* SIDEBAR */}

      <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>

        <div className="sidebar-top">

          <div
            className="toggle-btn"
            onClick={() => setCollapsed(!collapsed)}
          >
            <Menu size={20} />
          </div>

          {!collapsed && (
            <>
              <h2 className="brand-title">UMOVA ERP</h2>

              <input
                className="search-input"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </>
          )}

        </div>

        <div className="menu-scroll">

          {filteredMenu.map(group => (

            <div key={group.title}>

              {!collapsed && (
                <div className="group-title">
                  {group.title}
                </div>
              )}

              {group.items.map(item => {

                const Icon = item.icon;

                return (
                  <div
                    key={item.key}
                    className={`menu-item ${
                      activeTab === item.key ? "active" : ""
                    }`}
                    onClick={() => setActiveTab(item.key)}
                  >
                    <Icon size={20} />

                    {!collapsed && (
                      <span>{item.label}</span>
                    )}

                  </div>
                );

              })}

            </div>

          ))}

        </div>

        <div className="profile-section">

          <div className="avatar">
            DN
          </div>

          {!collapsed && (
            <div>
              <div className="admin-name">
                Admin
              </div>

              <div className="admin-role">
                System Administrator
              </div>
            </div>
          )}

        </div>

      </aside>

      {/* MAIN */}

      <main className="main-content">

        <div className="topbar">

          <h3>
            {activeTab.replaceAll("_", " ").toUpperCase()}
          </h3>

          <div className="topbar-right">

            <div className="notification-wrapper">

              <div
                className="notification-btn"
                onClick={() =>
                  setShowNotifications(!showNotifications)
                }
              >
                <Bell size={20} />

                <span className="badge">
                  3
                </span>
              </div>

              {showNotifications && (
                <div className="notification-dropdown">

                  <div className="dropdown-item">
                    📌 New Loan Application
                  </div>

                  <div className="dropdown-item">
                    💰 Payment Received
                  </div>

                  <div className="dropdown-item">
                    ⚠️ Loan Overdue Alert
                  </div>

                </div>
              )}

            </div>

            <div className="online-status">
              ● Online
            </div>

          </div>

        </div>

        <div className="page-content">

          {activeTab === "dashboard" && (

            <div className="kpi-grid">

              <div className="kpi-card">
                <h4>Total Loans</h4>
                <h2>KES 12.4M</h2>
              </div>

              <div className="kpi-card">
                <h4>Members</h4>
                <h2>1,245</h2>
              </div>

              <div className="kpi-card">
                <h4>PAR %</h4>
                <h2>3.2%</h2>
              </div>

              <div className="kpi-card">
                <h4>Cash</h4>
                <h2>KES 5.6M</h2>
              </div>

            </div>

          )}

          <div className="content-area">

            {ActiveComponent
              ? <ActiveComponent />
              : "Module not found"
            }

          </div>

        </div>

      </main>

    </div>
  );
}