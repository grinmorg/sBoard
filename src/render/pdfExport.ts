import type { CanvasKit } from 'canvaskit-wasm';
import { getCanvasKit } from '../skia/canvaskit';
import { drawSceneToSkCanvas } from './skiaRenderer';
import { sceneToPdfBytes } from './pdfWriter';
import type { SceneIR } from './ir';

export type PdfBackend = 'skia' | 'portable';

export interface PdfResult {
  bytes: Uint8Array;
  backend: PdfBackend;
}

/**
 * Attempt to render the scene with the **Skia PDF backend**.
 *
 * The Skia PDF backend (SkPDF) is only present when CanvasKit is compiled with
 * `skia_canvaskit_enable_pdf=true` (see scripts/build-canvaskit-pdf.sh). When
 * present, builds expose a PDF document factory on the CanvasKit instance; the
 * exact symbol differs between builds, so we probe the common names. Because the
 * scene is drawn through the shared {@link drawSceneToSkCanvas} routine, the PDF
 * is fully vector and identical to the on-screen Skia render.
 *
 * Returns null on the stock npm build (no PDF backend) so the caller can fall
 * back to the portable writer.
 */
function trySkiaPdfBackend(ck: CanvasKit, scene: SceneIR): Uint8Array | null {
  const anyCk = ck as unknown as Record<string, unknown>;
  const factory =
    (anyCk.MakePDFDocument as Function | undefined) ??
    (anyCk.MakePDFStream as Function | undefined) ??
    (anyCk.MakePDF as Function | undefined);
  if (typeof factory !== 'function') return null;

  try {
    // The PDF document exposes a Skia Canvas per page; we draw the scene onto it
    // using the exact same code path as the screen surface.
    const doc = factory.call(ck, { width: scene.width, height: scene.height }) as {
      beginPage?: (w: number, h: number) => unknown;
      getCanvas?: () => unknown;
      endPage?: () => void;
      close: () => Uint8Array;
    };
    const canvas = (doc.beginPage?.(scene.width, scene.height) ?? doc.getCanvas?.()) as
      | Parameters<typeof drawSceneToSkCanvas>[1]
      | undefined;
    if (!canvas) return null;
    drawSceneToSkCanvas(ck, canvas, scene);
    doc.endPage?.();
    return doc.close();
  } catch (err) {
    console.warn('Skia PDF backend present but failed; using portable writer.', err);
    return null;
  }
}

/** Render the scene to PDF, preferring the Skia backend and falling back to the portable writer. */
export async function exportScenePdf(scene: SceneIR): Promise<PdfResult> {
  const ck = await getCanvasKit();
  const skia = trySkiaPdfBackend(ck, scene);
  if (skia) return { bytes: skia, backend: 'skia' };
  return { bytes: sceneToPdfBytes(scene), backend: 'portable' };
}

/** Trigger a browser download of the given PDF bytes. */
export function downloadPdf(bytes: Uint8Array, filename = 'scene.pdf'): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
