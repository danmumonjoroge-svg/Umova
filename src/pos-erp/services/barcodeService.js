// Universal Scanning Engine — Barcode Decoding Service
//
// Wraps whichever camera decoding backend is available so the rest of the
// app never has to know which one is in use:
//
//   1. Native BarcodeDetector API (Chrome/Android/Edge) — zero dependencies,
//      decodes locally on-device, no network round trip per frame.
//   2. ZXing (@zxing/browser) — optional dependency, used as a fallback for
//      Safari/iOS and other browsers that don't ship BarcodeDetector.
//
// Decoding always happens locally on the device. A network request is only
// ever made afterwards, to resolve the decoded barcode against the product
// database (see productResolverService.js).

import { NATIVE_DETECTOR_FORMAT_MAP, SUPPORTED_DETECTOR_FORMATS } from '../constants/barcodeFormats';
import { guessBarcodeFormat } from '../utils/barcodeUtils';

export function isNativeDetectorSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

let zxingModulePromise = null;
async function loadZXing() {
  if (!zxingModulePromise) {
    // Loaded lazily so apps that never open the camera scanner don't pay for
    // the dependency. Requires `@zxing/browser` + `@zxing/library` to be
    // installed (see README delivered with this feature).
    zxingModulePromise = import('@zxing/browser');
  }
  return zxingModulePromise;
}

/**
 * Creates a decoder bound to a <video> element. Returns
 * { start(onResult, onError), stop() }.
 */
export async function createVideoDecoder(videoElement) {
  if (isNativeDetectorSupported()) {
    return createNativeDecoder(videoElement);
  }
  return createZXingDecoder(videoElement);
}

function createNativeDecoder(videoElement) {
  const detector = new window.BarcodeDetector({ formats: SUPPORTED_DETECTOR_FORMATS });
  let rafId = null;
  let stopped = false;

  async function tick(onResult, onError) {
    if (stopped) return;
    try {
      const barcodes = await detector.detect(videoElement);
      if (barcodes && barcodes.length > 0) {
        const best = barcodes[0];
        onResult({
          barcode: best.rawValue,
          format: NATIVE_DETECTOR_FORMAT_MAP[best.format] || guessBarcodeFormat(best.rawValue),
        });
      }
    } catch (err) {
      onError?.(err);
    }
    if (!stopped) rafId = requestAnimationFrame(() => tick(onResult, onError));
  }

  return {
    start(onResult, onError) {
      stopped = false;
      tick(onResult, onError);
    },
    stop() {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
    },
  };
}

async function createZXingDecoder(videoElement) {
  const { BrowserMultiFormatReader } = await loadZXing();
  const reader = new BrowserMultiFormatReader();
  let controls = null;

  return {
    async start(onResult, onError) {
      controls = await reader.decodeFromVideoElement(videoElement, (result, err) => {
        if (result) {
          onResult({
            barcode: result.getText(),
            format: result.getBarcodeFormat ? String(result.getBarcodeFormat()) : guessBarcodeFormat(result.getText()),
          });
        } else if (err && err.name !== 'NotFoundException') {
          onError?.(err);
        }
      });
    },
    stop() {
      // controls.stop() is the supported way to end the decode loop in
      // current @zxing/browser. BrowserMultiFormatReader.reset() was removed
      // in newer versions, so only call it where it still exists.
      try { controls?.stop(); } catch (e) { /* already stopped */ }
      try { if (typeof reader.reset === 'function') reader.reset(); } catch (e) { /* ignore */ }
    },
  };
}

/**
 * Requests camera access for scanning. Callers should always call
 * stopMediaStream() when the scanner modal closes — never leave the camera
 * running in the background.
 */
export async function startCameraStream({ facingMode = 'environment' } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('CAMERA_UNAVAILABLE');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      throw new Error('PERMISSION_DENIED');
    }
    throw new Error('CAMERA_UNAVAILABLE');
  }
}

export function stopMediaStream(stream) {
  stream?.getTracks()?.forEach((track) => track.stop());
}
