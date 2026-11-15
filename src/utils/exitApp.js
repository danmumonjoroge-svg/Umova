// src/utils/exitApp.js
// Close the phone app straight from any screen, so the user can go and do something else on the phone
// without logging out first. Does nothing in a normal browser (browsers don't let a page close itself).

import { Capacitor } from "@capacitor/core";

export const canExitApp = () => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

export async function exitApp() {
  if (!canExitApp()) return false;
  try {
    const { App } = await import("@capacitor/app");
    await App.exitApp();
    return true;
  } catch (e) {
    console.error("[exitApp]", e);
    return false;
  }
}
