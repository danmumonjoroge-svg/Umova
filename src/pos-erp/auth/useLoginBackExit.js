// src/pos-erp/auth/useLoginBackExit.js
//
// After "Sign out" the way out of the app should be:   login page  ->  public site  ->  out of the app.
//
// The problem it solves: after sign-out the login page is shown, but every screen the person visited before is
// still in the browser history. Back just walks through those old screens (each shows the login page again), so the
// person feels stuck and cannot get out to the phone's home screen.
//
// What it does, only while the login / sign-up screens are showing:
//   1. History (browser, installed web app, phone app): after a REAL sign-out (someone was signed in during this
//      visit) it rewinds to the first screen of this visit and then puts the login page back on top. The person
//      still SEES the login page, and one Back lands on the first screen (the public site when POS was opened
//      from there). This must NOT run when someone simply opens POS from the public site while signed out;
//      that is what made POS bounce back to the public site.
//   2. Phone app (Android): Back on the login page goes to the public site (and Back there closes the app).
//      Registered with security/backHandlers.js, the single owner of the Back button (AndroidBackButton.js),
//      instead of adding a second Capacitor listener, because two listeners would both fire for one press.
//
// Nothing here touches sign-in, sessions or permissions.

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { registerBackHandler } from "../../security/backHandlers";

/**
 * Rewind to the first screen of this visit. Resolves after the browser has moved (or immediately if already there),
 * so the caller can put the login page back on top.
 */
export function rewindToFirstScreen() {
  return new Promise((resolve) => {
    try {
      const idx = window.history.state?.idx; // set by React Router
      if (!Number.isInteger(idx) || idx <= 0) { resolve(false); return; }
      const done = () => { window.removeEventListener("popstate", done); setTimeout(() => resolve(true), 0); };
      window.addEventListener("popstate", done);
      window.history.go(-idx);
    } catch { resolve(false); }
  });
}

/**
 * @param {boolean} active          true only while the login/sign-up screens are showing
 * @param {() => boolean} [onSubScreenBack]  return true if Back was used to close an inner screen (e.g. sign-up -> login)
 * @param {boolean} [afterSignOut]  true only if someone was signed in earlier in this visit (a real sign-out)
 */
export function useLoginBackExit(active, onSubScreenBack, afterSignOut = false) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!active || typeof window === "undefined") return undefined;

    if (afterSignOut) {
      const loginPath = window.location.pathname + window.location.search;
      // Wait one tick so sign-out can finish its own navigation first.
      setTimeout(async () => {
        const moved = await rewindToFirstScreen();
        if (moved) navigate(loginPath); // login page back on top: [first screen, login]
      }, 0);
    }

    // Android Back on the sign-in screen: close an inner screen first, otherwise go to the public site.
    const unregister = registerBackHandler(() => {
      if (onSubScreenBack && onSubScreenBack()) return true;
      navigate("/", { replace: true });
      return true;
    });

    return unregister;
  }, [active, onSubScreenBack, afterSignOut, navigate]);
}
