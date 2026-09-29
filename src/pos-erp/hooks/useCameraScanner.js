// Universal Scanning Engine — Camera Scanner Hook
//
// Manages camera lifecycle (permission, stream, decoder) for a <video>
// element ref. Always stops the camera on unmount/close — never leaves it
// running in the background.

import { useRef, useState, useCallback, useEffect } from 'react';
import { createVideoDecoder, startCameraStream, stopMediaStream } from '../services/barcodeService';
import { ScanCooldown } from '../utils/scannerUtils';
import { DEFAULT_DUPLICATE_SCAN_COOLDOWN_MS } from '../constants/scannerModes';

export function useCameraScanner({ onScan, cooldownMs = DEFAULT_DUPLICATE_SCAN_COOLDOWN_MS, active = false } = {}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const decoderRef = useRef(null);
  const cooldownRef = useRef(new ScanCooldown(cooldownMs));
  // Bumped by every start() and stop(). A start() that finds the counter has
  // moved on while it was awaiting (modal closed, camera toggled, React
  // StrictMode's mount/unmount/mount) is stale and must bail out quietly.
  const runIdRef = useRef(0);
  // Always call the latest onScan (start() only runs when `active` flips, so
  // capturing onScan directly would hold a stale closure).
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  const [status, setStatus] = useState('idle'); // idle | requesting | active | denied | unavailable | error
  const [errorMessage, setErrorMessage] = useState(null);

  const stop = useCallback(() => {
    runIdRef.current += 1; // invalidate any start() still awaiting
    try {
      decoderRef.current?.stop();
    } catch (err) {
      // Teardown must never throw (it runs during unmount) and must never
      // stop us releasing the camera below.
      console.warn('[SCANNER] decoder stop failed:', err?.message || err);
    }
    decoderRef.current = null;
    if (streamRef.current) {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
    }
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    const runId = ++runIdRef.current;
    const isStale = () => runIdRef.current !== runId;

    setStatus('requesting');
    setErrorMessage(null);
    let stream = null;
    try {
      stream = await startCameraStream();
      // Closed/toggled while the permission prompt or camera was opening:
      // release the camera we just got and stop, without reporting an error.
      if (isStale() || !videoRef.current) {
        stopMediaStream(stream);
        return;
      }
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (isStale() || !videoRef.current) {
        stopMediaStream(stream);
        if (streamRef.current === stream) streamRef.current = null;
        return;
      }

      const decoder = await createVideoDecoder(videoRef.current);
      if (isStale()) {
        decoder.stop?.();
        stopMediaStream(stream);
        if (streamRef.current === stream) streamRef.current = null;
        return;
      }
      decoderRef.current = decoder;
      // decoder.start() is async (ZXing) — await it so its rejection is
      // caught below instead of surfacing as an unhandled promise rejection.
      await decoder.start(
        (result) => {
          if (!cooldownRef.current.shouldAccept(result.barcode)) return;
          onScanRef.current?.(result);
        },
        () => {
          // Per-frame decode misses are normal and not surfaced as errors.
        }
      );
      if (isStale()) {
        // stop() ran while ZXing was still starting; its controls only exist
        // now, so shut the decode loop down again.
        decoder.stop?.();
        stopMediaStream(stream);
        if (streamRef.current === stream) streamRef.current = null;
        return;
      }
      setStatus('active');
    } catch (err) {
      if (isStale()) {
        // Torn down mid-start (e.g. play() interrupted) — not a real failure.
        if (stream) stopMediaStream(stream);
        return;
      }
      console.error('[SCANNER] camera start failed:', err?.name || '', err?.message || err);
      if (streamRef.current) {
        stopMediaStream(streamRef.current);
        streamRef.current = null;
      }
      if (err.message === 'PERMISSION_DENIED') {
        setStatus('denied');
        setErrorMessage('Camera permission was denied. Please enable camera access or use another scanner.');
      } else {
        setStatus('unavailable');
        setErrorMessage('Camera is unavailable.');
      }
    }
  }, []);

  useEffect(() => {
    if (active) start();
    else stop();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return { videoRef, status, errorMessage, start, stop };
}
