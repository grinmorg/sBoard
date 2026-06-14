import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm';
// Vite resolves this to the served URL of the wasm binary that ships with the npm package.
import wasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';

let instance: CanvasKit | null = null;
let pending: Promise<CanvasKit> | null = null;

/**
 * Loads the CanvasKit (Skia) WASM module exactly once and caches the instance.
 *
 * NOTE: the stock `canvaskit-wasm` npm build does **not** include the Skia PDF
 * backend. To get a real Skia-generated PDF you must compile a custom build with
 * `skia_canvaskit_enable_pdf=true` (see scripts/build-canvaskit-pdf.sh) and drop
 * the resulting `canvaskit.wasm` / `canvaskit.js` next to this loader. The PDF
 * export module feature-detects that capability at runtime and otherwise falls
 * back to the built-in vector PDF writer.
 */
export async function getCanvasKit(): Promise<CanvasKit> {
  if (instance) return instance;
  if (!pending) {
    pending = CanvasKitInit({ locateFile: () => wasmUrl }).then((ck) => {
      instance = ck;
      return ck;
    });
  }
  return pending;
}
