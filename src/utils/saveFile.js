// src/utils/saveFile.js
//
// One place that turns "make a file" into "the member actually gets the file".
//
// Why this exists: inside the Android/iOS app the page runs in a WebView, and a WebView silently ignores
// jsPDF's doc.save() and <a download href="blob:..."> clicks, so "Download" appeared to do nothing.
// On a phone we instead write the file to the app's cache folder and open the system share sheet, from
// which the member can pick "Save to Drive / Files", WhatsApp, Email, Print, etc.
// In a normal browser the behaviour is the usual file download.
//
// Needs (phone app only, already-installed @capacitor/app and @capacitor/core are NOT enough):
//     npm i @capacitor/filesystem @capacitor/share
//     npx cap sync android

import { Capacitor } from "@capacitor/core";

const isNative = () => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

const safeName = (name) =>
  String(name || "file").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120);

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error || new Error("Could not read the file"));
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.readAsDataURL(blob);
  });

const isShareCancel = (e) => /cancel/i.test(String(e?.message || e || ""));

/**
 * Save or share a Blob.
 * Resolves { method: "browser" | "share", filename } and throws a readable Error on real failures.
 */
export async function saveBlob(blob, filename, { dialogTitle = "Save or share" } = {}) {
  const name = safeName(filename);

  if (!isNative()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { method: "browser", filename: name };
  }

  let Filesystem, Directory, Share;
  try {
    ({ Filesystem, Directory } = await import("@capacitor/filesystem"));
    ({ Share } = await import("@capacitor/share"));
  } catch (e) {
    throw new Error("File download is not set up in this build of the app (missing Filesystem/Share plugin).");
  }

  const data = await blobToBase64(blob);
  const written = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache });

  try {
    await Share.share({ title: name, dialogTitle, url: written.uri });
  } catch (e) {
    if (!isShareCancel(e)) throw new Error("Could not open the share sheet: " + (e?.message || e));
  }
  return { method: "share", filename: name };
}

/** jsPDF document -> saved/shared PDF. */
export const savePdf = (doc, filename) =>
  saveBlob(doc.output("blob"), filename, { dialogTitle: "Save or share statement" });

/** Plain text (CSV) -> saved/shared file. */
export const saveText = (text, filename, mime = "text/csv;charset=utf-8;") =>
  saveBlob(new Blob([text], { type: mime }), filename, { dialogTitle: "Save or share file" });
