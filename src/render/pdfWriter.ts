import { colorToRgb, type Mat, type PathCmd, type SceneIR } from './ir';

/**
 * A small, dependency-free PDF writer that turns a {@link SceneIR} into a true
 * **vector** PDF: paths become PDF path operators, fills/strokes use device-RGB
 * colour operators, and sprites are embedded as JPEG image XObjects (the one
 * raster case the task allows).
 *
 * This is the portable fallback used when the running CanvasKit build does not
 * expose the Skia PDF backend. See render/pdfExport.ts for the backend-selection
 * logic and scripts/build-canvaskit-pdf.sh for the custom build.
 */

const KAPPA = 0.5522847498307936;

/** Format a number compactly for a content stream. */
function n(x: number): string {
  return (Math.round(x * 1000) / 1000).toString();
}

/** Emit `a b c d e f cm` from an IR matrix (same affine convention as PDF cm). */
function cm(m: Mat): string {
  return `${n(m.a)} ${n(m.b)} ${n(m.c)} ${n(m.d)} ${n(m.tx)} ${n(m.ty)} cm\n`;
}

/** Append PDF path-construction operators for one IR sub-path. */
function emitPath(cmds: PathCmd[]): string {
  let s = '';
  for (const c of cmds) {
    switch (c.op) {
      case 'moveTo':
        s += `${n(c.x)} ${n(c.y)} m\n`;
        break;
      case 'lineTo':
        s += `${n(c.x)} ${n(c.y)} l\n`;
        break;
      case 'rect':
        s += `${n(c.x)} ${n(c.y)} ${n(c.w)} ${n(c.h)} re\n`;
        break;
      case 'close':
        s += 'h\n';
        break;
      case 'roundRect': {
        const r = Math.max(0, Math.min(c.r, Math.min(c.w, c.h) / 2));
        const k = r * KAPPA;
        const { x, y, w, h } = c;
        s += `${n(x + r)} ${n(y)} m\n`;
        s += `${n(x + w - r)} ${n(y)} l\n`;
        s += `${n(x + w - r + k)} ${n(y)} ${n(x + w)} ${n(y + r - k)} ${n(x + w)} ${n(y + r)} c\n`;
        s += `${n(x + w)} ${n(y + h - r)} l\n`;
        s += `${n(x + w)} ${n(y + h - r + k)} ${n(x + w - r + k)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)} c\n`;
        s += `${n(x + r)} ${n(y + h)} l\n`;
        s += `${n(x + r - k)} ${n(y + h)} ${n(x)} ${n(y + h - r + k)} ${n(x)} ${n(y + h - r)} c\n`;
        s += `${n(x)} ${n(y + r)} l\n`;
        s += `${n(x)} ${n(y + r - k)} ${n(x + r - k)} ${n(y)} ${n(x + r)} ${n(y)} c\n`;
        s += 'h\n';
        break;
      }
      case 'ellipse': {
        const { cx, cy, rx, ry } = c;
        const ox = rx * KAPPA;
        const oy = ry * KAPPA;
        s += `${n(cx + rx)} ${n(cy)} m\n`;
        s += `${n(cx + rx)} ${n(cy - oy)} ${n(cx + ox)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)} c\n`;
        s += `${n(cx - ox)} ${n(cy - ry)} ${n(cx - rx)} ${n(cy - oy)} ${n(cx - rx)} ${n(cy)} c\n`;
        s += `${n(cx - rx)} ${n(cy + oy)} ${n(cx - ox)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)} c\n`;
        s += `${n(cx + ox)} ${n(cy + ry)} ${n(cx + rx)} ${n(cy + oy)} ${n(cx + rx)} ${n(cy)} c\n`;
        s += 'h\n';
        break;
      }
    }
  }
  return s;
}

interface ImageXObject {
  name: string;
  jpegBytes: Uint8Array;
  width: number;
  height: number;
}

/** Encode raw RGBA pixels as JPEG bytes via an offscreen canvas. */
function rgbaToJpeg(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d')!;
  const img = new ImageData(new Uint8ClampedArray(pixels), width, height);
  // Composite onto white so the JPEG (no alpha) looks reasonable for transparent PNGs.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.putImageData(img, 0, 0);
  const dataUrl = cv.toDataURL('image/jpeg', 0.92);
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Build the page content stream and collect referenced image/gstate resources. */
function buildContent(scene: SceneIR): {
  content: string;
  images: ImageXObject[];
  gstates: Map<string, number>;
} {
  const images: ImageXObject[] = [];
  const gstates = new Map<string, number>(); // alpha string -> object placeholder index (filled later)
  let imgCounter = 0;

  const gsName = (alpha: number): string => {
    const key = alpha.toFixed(3);
    if (!gstates.has(key)) gstates.set(key, gstates.size);
    return `GS${gstates.get(key)}`;
  };

  // Flip to a top-left, y-down coordinate system matching the screen scene.
  let content = `q\n1 0 0 -1 0 ${n(scene.height)} cm\n`;
  // Opaque white page background rectangle.
  const bg = colorToRgb(scene.background);
  content += `${n(bg.r / 255)} ${n(bg.g / 255)} ${n(bg.b / 255)} rg\n`;
  content += `0 0 ${n(scene.width)} ${n(scene.height)} re f\n`;

  for (const op of scene.ops) {
    content += 'q\n';
    content += cm(op.matrix);

    if (op.type === 'path') {
      for (const paint of op.paints) {
        const { r, g, b } = colorToRgb(paint.color);
        content += `/${gsName(paint.alpha)} gs\n`;
        content += emitPath(op.path);
        if (paint.kind === 'fill') {
          content += `${n(r / 255)} ${n(g / 255)} ${n(b / 255)} rg\n`;
          content += 'f\n';
        } else {
          content += `${n(r / 255)} ${n(g / 255)} ${n(b / 255)} RG\n`;
          content += `${n(paint.width ?? 1)} w\n`;
          content += `${paint.cap === 'round' ? 1 : paint.cap === 'square' ? 2 : 0} J\n`;
          content += `${paint.join === 'round' ? 1 : paint.join === 'bevel' ? 2 : 0} j\n`;
          content += 'S\n';
        }
      }
    } else {
      const name = `Im${imgCounter++}`;
      images.push({
        name,
        jpegBytes: rgbaToJpeg(op.pixels, op.width, op.height),
        width: op.width,
        height: op.height,
      });
      content += `/${gsName(op.alpha)} gs\n`;
      // Map the image unit square onto the local placement rect (upright).
      content += cm({ a: op.dw, b: 0, c: 0, d: -op.dh, tx: op.dx, ty: op.dy + op.dh });
      content += `/${name} Do\n`;
    }
    content += 'Q\n';
  }

  content += 'Q\n';
  return { content, images, gstates };
}

/** Serialise a complete PDF document and return its bytes. */
export function sceneToPdfBytes(scene: SceneIR): Uint8Array {
  const { content, images, gstates } = buildContent(scene);

  // Object layout:
  //   1 Catalog, 2 Pages, 3 Page, 4 Content, then one obj per image, then one per gstate.
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;

  const push = (data: string | Uint8Array): void => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };

  const objNum = { value: 5 };
  const imageObjNums = images.map(() => objNum.value++);
  const gstateObjNums = [...gstates.values()].map(() => objNum.value++);
  const totalObjects = objNum.value - 1;

  const xobjectEntries = images.map((im, i) => `/${im.name} ${imageObjNums[i]} 0 R`).join(' ');
  const gsEntries = [...gstates.entries()]
    .map(([, idx]) => `/GS${idx} ${gstateObjNums[idx]} 0 R`)
    .join(' ');

  const startObj = (num: number): void => {
    offsets[num] = length;
    push(`${num} 0 obj\n`);
  };

  push('%PDF-1.7\n%\xff\xff\xff\xff\n');

  startObj(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  startObj(2);
  push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  startObj(3);
  push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(scene.width)} ${n(scene.height)}] ` +
      `/Resources << /XObject << ${xobjectEntries} >> /ExtGState << ${gsEntries} >> >> ` +
      `/Contents 4 0 R >>\nendobj\n`,
  );

  const contentBytes = encoder.encode(content);
  startObj(4);
  push(`<< /Length ${contentBytes.length} >>\nstream\n`);
  push(contentBytes);
  push('\nendstream\nendobj\n');

  images.forEach((im, i) => {
    startObj(imageObjNums[i]);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.jpegBytes.length} >>\nstream\n`,
    );
    push(im.jpegBytes);
    push('\nendstream\nendobj\n');
  });

  [...gstates.entries()].forEach(([alphaKey, idx]) => {
    startObj(gstateObjNums[idx]);
    push(`<< /Type /ExtGState /ca ${alphaKey} /CA ${alphaKey} >>\nendobj\n`);
  });

  const xrefOffset = length;
  let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= totalObjects; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
