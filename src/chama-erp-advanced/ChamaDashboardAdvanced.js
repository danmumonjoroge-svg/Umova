import React, { useState, useMemo, useEffect, useCallback, useRef, Suspense } from "react";
import { useChama } from "./ChamaContext";
import { supabase } from "../supabaseClient";
import {
  Home, Wallet, Users, HeartHandshake, MoreHorizontal, Bell, ArrowLeft, Coins, LogOut,
  Megaphone, FileText, PiggyBank, ChevronDown, Wifi, WifiOff, User,
} from "lucide-react";
import "./ChamaDashboardAdvanced.css";
import "./workspaces/workspaces.css";
import useOnlineStatus from "./shell/useOnlineStatus";
import { clearChamaCache } from "./shell/useCachedQuery";
import { useContributionOutbox, listOutbox } from "./shell/contributionOutbox";
import { VIEWS, canSee, parseRoute } from "./shell/views";
import { Spinner, Notice, ViewFrame } from "./shell/ui";
import { initials, roleLabel } from "./shell/format";
import LicenseBadge from "./shell/LicenseBadge";
import { ShieldAlert } from "lucide-react";

// -----------------------------------------------------------------------------
// ChamaDashboardAdvanced — the application SHELL only.
//
// Same file name and default export as before, so App.js is unchanged.
// It owns: navigation (bottom bar on phones, sidebar on tablet/desktop), the
// top bar, connectivity display, and which workspace is on screen. All
// business logic still lives in the existing screens, which are composed
// unchanged into the workspaces (see shell/views.js).
//
// Navigation model:
//   Bottom bar / sidebar answer "Where am I?"  -> Home, Money, Members, Welfare, More
//   Workspaces answer "What can I do here?"    -> landing page of action cards
//   No expandable menus anywhere.
// -----------------------------------------------------------------------------

const HomeWorkspace = React.lazy(() => import("./workspaces/HomeWorkspace"));
const MoneyWorkspace = React.lazy(() => import("./workspaces/MoneyWorkspace"));
const LoansWorkspace = React.lazy(() => import("./workspaces/LoansWorkspace"));
const WelfareWorkspace = React.lazy(() => import("./workspaces/WelfareWorkspace"));
const MembersWorkspace = React.lazy(() => import("./workspaces/MembersWorkspace"));
const MemberProfile = React.lazy(() => import("./workspaces/MemberProfile"));
const MoreWorkspace = React.lazy(() => import("./workspaces/MoreWorkspace"));

const LANDINGS = { home: HomeWorkspace, money: MoneyWorkspace, loans: LoansWorkspace, welfare: WelfareWorkspace, more: MoreWorkspace };
const TITLES = { home: "Home", money: "Money", loans: "Loans", members: "Members", welfare: "Welfare", more: "More" };

// Phone bottom bar: exactly five, as specified. Loans is reached from Money,
// Home and More on phones (and has its own sidebar entry on larger screens).
const TABS = [
  { key: "home", label: "Home", icon: Home },
  { key: "money", label: "Money", icon: Wallet },
  { key: "members", label: "Members", icon: Users },
  { key: "welfare", label: "Welfare", icon: HeartHandshake },
  { key: "more", label: "More", icon: MoreHorizontal },
];
const SIDEBAR = [
  { key: "home", label: "Home", icon: Home, route: "home" },
  { key: "money", label: "Money", icon: Wallet, route: "money" },
  { key: "loans", label: "Loans", icon: PiggyBank, route: "loans" },
  { key: "members", label: "Members", icon: Users, route: "members" },
  { key: "welfare", label: "Welfare", icon: HeartHandshake, route: "welfare" },
  { key: "updates", label: "Updates", icon: Megaphone, route: "more/updates" },
  { key: "statement", label: "My statement", icon: FileText, route: "money/statement" },
];

class Boundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null }); }
  render() {
    if (this.state.err) return <Notice tone="error" icon={ShieldAlert}>Something went wrong showing this screen. Go back and try again.</Notice>;
    return this.props.children;
  }
}

function ConnectionStatus({ online }) {
  return (
    <span className={`cm-conn ${online ? "on" : "off"}`} role="status" aria-label={online ? "Connected" : "Offline"}>
      {online ? <Wifi size={14} /> : <WifiOff size={14} />}<span className="cm-conn-text">{online ? "Online" : "Offline"}</span>
    </span>
  );
}

export default function ChamaDashboardAdvanced() {
  const { chama, member, hasRole, logout } = useChama();
  const online = useOnlineStatus();
  // Contributions declared while offline are sent from here (not only from the contribution form): when the app opens,
  // the moment the connection returns, and every 30 seconds while something is waiting.
  const outbox = useContributionOutbox({ supabase, memberId: member?.id });
  const waitingCount = outbox.items.filter((i) => i.status !== "failed").length;
  const refusedCount = outbox.items.filter((i) => i.status === "failed").length;
  const [route, setRoute] = useState(() => window.history.state?.chamaRoute || "home");
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef(null);

  // ---- history: hardware/browser Back moves within the app ----
  useEffect(() => {
    if (!window.history.state?.chamaRoute) window.history.replaceState({ ...(window.history.state || {}), chamaRoute: route, idx: 0 }, "");
    const onPop = (e) => setRoute(e.state?.chamaRoute || "home");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = useCallback((next) => {
    setMenuOpen(false);
    const idx = (window.history.state?.idx || 0) + 1;
    window.history.pushState({ ...(window.history.state || {}), chamaRoute: next, idx }, "");
    setRoute(next);
  }, []);

  const back = useCallback(() => {
    if ((window.history.state?.idx || 0) > 0) window.history.back();
    else { const root = parseRoute(route).ws; window.history.replaceState({ ...(window.history.state || {}), chamaRoute: root, idx: 0 }, ""); setRoute(root); }
  }, [route]);

  useEffect(() => { mainRef.current?.scrollTo?.(0, 0); window.scrollTo?.(0, 0); }, [route]);

  // Logging out must never silently lose a contribution that has not reached the server. If we are online, send what is
  // waiting first; if something is still unsent, say so and let the person decide. Unsent items stay on the phone (they are
  // NOT removed by clearChamaCache) and are sent the next time this member signs in. `logoutRef` keeps one stable function
  // that always uses the latest values (the screens below are memoised and would otherwise keep an old copy).
  const logoutRef = useRef(null);
  logoutRef.current = async () => {
    if (member?.id) {
      if (online) { try { await outbox.sync(); } catch { /* fall through to the check below */ } }
      const left = listOutbox(member.id).filter((i) => i.status !== "failed").length;
      if (left > 0 && !window.confirm(
        `You have ${left} contribution${left === 1 ? "" : "s"} saved on this phone that ${left === 1 ? "has" : "have"} not been sent yet. ` +
        `${left === 1 ? "It stays" : "They stay"} on this phone and will be sent the next time you sign in. Log out anyway?`
      )) return;
    }
    clearChamaCache();
    logout();
  };
  const doLogout = useCallback(() => logoutRef.current(), []);

  const parsed = parseRoute(route);
  const { ws, view, params } = parsed;
  const isSubView = !!view;

  // Which tab/sidebar entry is "where I am".
  const activeSide = parsed.key === "money/statement" ? "statement" : parsed.key === "more/updates" ? "updates" : ws;
  const activeTab = ws === "loans" ? "money" : ws;

  // ---- resolve what to render ----
  const content = useMemo(() => {
    if (ws === "members") {
      if (view && view.startsWith("profile/")) return { title: "Member profile", node: <MemberProfile memberId={view.split("/")[1]} go={go} />, framed: true };
      return { title: "Members", node: <MembersWorkspace go={go} params={params} />, framed: false };
    }
    if (!view) {
      const Landing = LANDINGS[ws] || HomeWorkspace;
      return { title: TITLES[ws] || "Home", node: <Landing go={go} onLogout={doLogout} params={params} />, framed: false };
    }
    const entry = VIEWS[parsed.key];
    if (!entry) return { title: "Not found", node: <Notice tone="error" icon={ShieldAlert}>That screen does not exist.</Notice>, framed: true };
    // hasRole() — the existing permission check — decides. (The screens and
    // the database enforce it again; this just avoids rendering a dead end.)
    if (!canSee(hasRole, entry.roles)) return { title: entry.title, node: <Notice tone="error" icon={ShieldAlert}>You do not have access to this part of the Chama.</Notice>, framed: true };
    const C = entry.C;
    return { title: entry.title, node: <C chamaId={chama?.id} go={go} params={params} {...(entry.props || {})} />, framed: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, member?.role, chama?.id]);

  const backLabel = ws === "members" ? "Members" : TITLES[ws] || "Back";

  return (
    <div className="cm-app">
      <aside className="cm-sidebar" aria-label="Main navigation">
        <div className="cm-side-head">
          <span className="cm-logo"><Coins size={18} /></span>
          <div>
            <h1>{chama?.name || "My Chama"}</h1>
            <small>{chama?.chama_no}</small>
            <LicenseBadge chama={chama} />
          </div>
        </div>
        <nav className="cm-side-nav">
          {SIDEBAR.map((s) => (
            <button key={s.key} className={`cm-side-item ${activeSide === s.key ? "active" : ""}`} onClick={() => go(s.route)} aria-current={activeSide === s.key ? "page" : undefined}>
              <s.icon size={18} /><span>{s.label}</span>
            </button>
          ))}
        </nav>
        <div className="cm-side-foot">
          <button className={`cm-side-item ${activeSide === "more" ? "active" : ""}`} onClick={() => go("more")}><MoreHorizontal size={18} /><span>More</span></button>
          <button className="cm-side-item" onClick={doLogout}><LogOut size={18} /><span>Log out</span></button>
        </div>
      </aside>

      <div className="cm-main">
        <header className="cm-topbar">
          {isSubView ? (
            <button className="cm-icon-btn light cm-top-back" onClick={back} aria-label="Back"><ArrowLeft size={20} /></button>
          ) : (
            <span className="cm-logo sm cm-top-logo"><Coins size={16} /></span>
          )}
          <div className="cm-top-title">
            <h1>{isSubView ? content.title : (ws === "home" ? (chama?.name || "Home") : content.title)}</h1>
          </div>
          <div className="cm-top-right">
            <ConnectionStatus online={online} />
            <button className="cm-icon-btn light" onClick={() => go("more/updates")} aria-label="Updates"><Bell size={19} /></button>
            <div className="cm-profile-menu">
              <button className="cm-avatar-btn" onClick={() => setMenuOpen((v) => !v)} aria-label="Your account" aria-expanded={menuOpen}>
                <span className="cm-avatar">{initials(member?.name)}</span><ChevronDown size={13} className="cm-avatar-chev" />
              </button>
              {menuOpen && (
                <>
                  <div className="cm-menu-scrim" onClick={() => setMenuOpen(false)} />
                  <div className="cm-menu" role="menu">
                    <div className="cm-menu-who"><strong>{member?.name}</strong><small>{roleLabel(member?.role)}</small></div>
                    <button role="menuitem" onClick={() => go(`members/profile/${member?.id}`)}><User size={15} /> My profile</button>
                    <button role="menuitem" onClick={() => go("money/statement")}><FileText size={15} /> My statement</button>
                    <button role="menuitem" onClick={doLogout}><LogOut size={15} /> Log out</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {!online && (
          <div className="cm-offline-banner" role="status">
            <WifiOff size={14} /> You're offline. You can look at information saved on this phone, and you can declare a contribution: it is saved on this phone and sent when you're back online. Applying for loans and other money actions need a connection and are not saved.
          </div>
        )}
        {waitingCount > 0 && (
          <div className="cm-offline-banner" role="status">
            <Coins size={14} /> {waitingCount} contribution{waitingCount === 1 ? "" : "s"} saved on this phone, not sent yet.
            {online ? (outbox.syncing ? " Sending…" : " It will be sent automatically.") : " It will be sent when you're back online."}
          </div>
        )}
        {refusedCount > 0 && (
          <div className="cm-offline-banner" role="alert">
            <ShieldAlert size={14} /> {refusedCount} contribution{refusedCount === 1 ? "" : "s"} could not be accepted by the server. Open the contribution form to see why.
          </div>
        )}

        <main className="cm-content" ref={mainRef}>
          <Boundary resetKey={route}>
            <Suspense fallback={<Spinner />}>
              {content.framed
                ? <ViewFrame title={content.title} onBack={back} backLabel={backLabel}>{content.node}</ViewFrame>
                : content.node}
            </Suspense>
          </Boundary>
        </main>
      </div>

      <nav className="cm-bottomnav" aria-label="Main navigation">
        {TABS.map((t) => (
          <button key={t.key} className={activeTab === t.key ? "active" : ""} onClick={() => go(t.key)} aria-current={activeTab === t.key ? "page" : undefined}>
            <t.icon size={22} /><span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
