import React, { useState, useEffect } from 'react';
import BarcodeScanner from './BarcodeScanner';
import ScanResult from './ScanResult';
import ScannerInput from './ScannerInput';
import { SCANNER_TYPES, SCAN_RESULTS } from '../constants/scannerModes';

/**
 * The one scanner surface every module mounts. Wraps camera + manual entry
 * + result feedback + the "unknown barcode" recovery flow, all driven by a
 * `scan(barcode, scannerType, opts)` function (normally `processScan` from
 * useBarcodeScanner) so every caller shares identical resolution behaviour.
 *
 * <ScannerModal
 *   open={showScanner}
 *   onClose={() => setShowScanner(false)}
 *   scan={processScan}
 *   lastOutcome={lastOutcome}
 *   title="Scan Product"
 *   onCreateProduct={(barcode) => ...}   // optional — enables "Create Product"
 *   onAccept={() => setShowScanner(false)} // called after a RESOLVED scan, if you want to auto-close
 * />
 */
export default function ScannerModal({
  open,
  onClose,
  scan,
  lastOutcome,
  title = 'Scan Product',
  onCreateProduct,
  onAccept,
  autoCloseOnResolve = false,
}) {
  const [mode, setMode] = useState('camera'); // 'camera' | 'manual'
  const [cameraActive, setCameraActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setMode('camera');
    setCameraActive(true);
  }, [open]);

  useEffect(() => {
    if (!lastOutcome) return;
    if (lastOutcome.result === SCAN_RESULTS.RESOLVED && autoCloseOnResolve) {
      onAccept?.(lastOutcome);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastOutcome]);

  if (!open) return null;

  const handleCameraScan = async (result) => {
    setCameraActive(false); // stop camera immediately after a successful decode
    await scan(result.barcode, SCANNER_TYPES.CAMERA);
  };

  const handleManualSubmit = async (barcode) => {
    await scan(barcode, SCANNER_TYPES.MANUAL);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-bold text-lg">{title}</h3>
          <button onClick={onClose} className="text-gray-500 text-xl leading-none">&times;</button>
        </div>

        <div className="p-4 space-y-3">
          {mode === 'camera' ? (
            <>
              <BarcodeScanner active={cameraActive} onScan={handleCameraScan} />
              <p className="text-center text-sm text-gray-500">Point camera at barcode</p>
              <button
                type="button"
                onClick={() => { setCameraActive(false); setMode('manual'); }}
                className="w-full text-sm text-blue-600 py-1"
              >
                Enter barcode manually
              </button>
            </>
          ) : (
            <>
              <ScannerInput onSubmit={handleManualSubmit} autoFocus />
              <button
                type="button"
                onClick={() => { setMode('camera'); setCameraActive(true); }}
                className="w-full text-sm text-blue-600 py-1"
              >
                Use camera instead
              </button>
            </>
          )}

          <ScanResult
            outcome={lastOutcome}
            onCreateProduct={onCreateProduct}
            onScanAgain={() => { setCameraActive(false); requestAnimationFrame(() => setCameraActive(true)); }}
            onManual={() => setMode('manual')}
            onDismiss={onClose}
          />
        </div>

        <div className="px-4 pb-4">
          <button onClick={onClose} className="w-full bg-gray-100 py-2 rounded text-gray-700">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
