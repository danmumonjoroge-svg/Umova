// src/security/AndroidBackButton.js
//
// Android's back button, handled the way people expect from an app.
//
// After signing out the chain is:   login page  ->  public site  ->  out of the app (phone home screen)
//   - a screen that registered its own handler (backHandlers.js) gets first go;
//   - on a LOGIN screen (member, admin, chama) Back goes to the public site;
//   - on the public site, or on a signed-in home screen (member / admin / chama / POS home), Back CLOSES the app,
//     so nobody has to log out just to leave;
//   - anywhere else it goes back one screen (or up to that area's home if there is nothing to go back to).
// Renders nothing. Does nothing in a browser or on iOS. Mount it once, inside the Router (App.js).

import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { runBackHandlers } from "./backHandlers";

const EXIT_SCREENS = new Set([
  "/",                                   // public site: the last stop before leaving the app
  "/member/dashboard", "/admin/dashboard",
  "/chama",
  "/pos", "/pos/dashboard",              // POS home (when signed out, the POS login registers its own handler first)
]);

const LOGIN_SCREENS = new Set(["/login", "/admin-login", "/chama/login"]);

const areaHome = (p) => {
  if (p.startsWith("/admin")) return "/admin/dashboard";
  if (p.startsWith("/member")) return "/member/dashboard";
  if (p.startsWith("/chama")) return "/chama";
  if (p.startsWith("/pos")) return "/pos";
  return "/";
};

/** What should Back do here? -> { type: "exit" } | { type: "go", to, replace } | { type: "back" } */
export function backAction(pathname, historyIdx) {
  const p = (pathname || "/").replace(/\/+$/, "") || "/";
  if (LOGIN_SCREENS.has(p)) return { type: "go", to: "/", replace: true };
  if (EXIT_SCREENS.has(p)) return { type: "exit" };
  if ((historyIdx ?? 0) > 0) return { type: "back" };
  return { type: "go", to: areaHome(p), replace: true };
}

export default function AndroidBackButton() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    let android = false;
    try { android = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"; } catch { /* web */ }
    if (!android) return undefined;

    let handle;
    let cancelled = false;

    import("@capacitor/app").then(({ App }) => {
      App.addListener("backButton", () => {
        if (runBackHandlers()) return;
        const act = backAction(pathRef.current, window.history.state?.idx);
        if (act.type === "exit") App.exitApp();
        else if (act.type === "back") navigate(-1);
        else navigate(act.to, { replace: act.replace });
      }).then((h) => { if (cancelled) h.remove(); else handle = h; });
    }).catch((e) => console.error("[AndroidBackButton]", e));

    return () => { cancelled = true; handle?.remove?.(); };
  }, [navigate]);

  return null;
}
