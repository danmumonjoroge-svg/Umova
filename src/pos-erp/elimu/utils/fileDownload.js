// elimu/utils/fileDownload.js -- ONE way to save a file from any Elimu screen (CSV, PDF, templates).
// Browser: a normal download. Phone app (Android WebView): browser-style downloads do nothing there, so the file is written to the app cache and
// handed to the share sheet (Save, Print, WhatsApp, Email), the same way the POS reports do it.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export const isNative = () => { try { return Capacitor.isNativePlatform(); } catch { return false; } };
const toBytes = (data) => (typeof data === 'string' ? new TextEncoder().encode(data) : data);
const toBase64 = (bytes) => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };

/**
 * Saves text or bytes as a file. In a browser it downloads. In the phone app (Android WebView) a browser-style download does nothing,
 * so the file is written to the app's cache and handed to the share sheet, which is where Save, Print, WhatsApp and Email live
 * (the same way the POS reports do it). Resolves to 'downloaded' or 'shared'.
 */
export async function download(name, data, type) {
  if (isNative()) {
    const written = await Filesystem.writeFile({ path: name, data: toBase64(toBytes(data)), directory: Directory.Cache, recursive: true });
    try { await Share.share({ title: name, text: name, url: written.uri, dialogTitle: 'Save, print or send this file' }); }
    catch (e) { if (!/cancel/i.test(String(e?.message || e))) throw e; }   // closing the sheet is not an error
    return 'shared';
  }
  const blob = new Blob([data], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}


/** For button handlers: saves the file and tells the person in plain words if it could not be saved. Never throws. */
export async function saveFile(name, data, type = 'text/csv;charset=utf-8') {
  try { return await download(name, data, type); }
  catch { try { window.alert('The file could not be saved. Please try again.'); } catch { /* no dialog available */ } return 'failed'; }
}
/** CSV text with the byte-order mark Excel needs to read accents and symbols correctly. */
export const csvFile = (name, text) => saveFile(name, '\uFEFF' + text, 'text/csv;charset=utf-8');
