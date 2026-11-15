// src/security/backHandlers.js
//
// One place for Android's Back button. A screen that wants to use Back for something of its own
// (e.g. "sign-up form -> back to login") registers a handler here; AndroidBackButton asks the newest
// handler first and only does its normal job (go back / close the app) if nobody used the press.
// This replaces screens adding their own Capacitor "backButton" listener, because two listeners
// would BOTH fire for one press.

const stack = [];

/** fn() returns true if it used the Back press. Returns an unregister function. */
export function registerBackHandler(fn) {
  stack.push(fn);
  return () => {
    const i = stack.lastIndexOf(fn);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Newest handler first. true = someone handled it. */
export function runBackHandlers() {
  for (let i = stack.length - 1; i >= 0; i--) {
    try {
      if (stack[i]()) return true;
    } catch (e) {
      console.error("[backHandlers]", e);
    }
  }
  return false;
}
