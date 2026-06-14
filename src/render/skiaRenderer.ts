import type { Canvas, CanvasKit, Image, Paint as SkPaint, Path as SkPath } from 'canvaskit-wasm';
import { colorToRgb, type DrawOp, type Mat, type Paint, type PathCmd, type SceneIR } from './ir';

/** Convert an IR matrix to a Skia 3x3 row-major matrix (length-9 array). */
function toSkMatrix(m: Mat): number[] {
  // x' = a*x + c*y + tx ; y' = b*x + d*y + ty
  return [m.a, m.c, m.tx, m.b, m.d, m.ty, 0, 0, 1];
}

function buildPath(ck: CanvasKit, cmds: PathCmd[]): SkPath {
  const path = new ck.Path();
  for (const c of cmds) {
    switch (c.op) {
      case 'moveTo':
        path.moveTo(c.x, c.y);
        break;
      case 'lineTo':
        path.lineTo(c.x, c.y);
        break;
      case 'rect':
        path.addRect(ck.XYWHRect(c.x, c.y, c.w, c.h));
        break;
      case 'roundRect':
        path.addRRect(ck.RRectXY(ck.XYWHRect(c.x, c.y, c.w, c.h), c.r, c.r));
        break;
      case 'ellipse':
        path.addOval(ck.XYWHRect(c.cx - c.rx, c.cy - c.ry, c.rx * 2, c.ry * 2));
        break;
      case 'close':
        path.close();
        break;
    }
  }
  return path;
}

function buildPaint(ck: CanvasKit, p: Paint): SkPaint {
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  const { r, g, b } = colorToRgb(p.color);
  paint.setColor(ck.Color4f(r / 255, g / 255, b / 255, p.alpha));
  if (p.kind === 'stroke') {
    paint.setStyle(ck.PaintStyle.Stroke);
    paint.setStrokeWidth(p.width ?? 1);
    paint.setStrokeCap(
      p.cap === 'round'
        ? ck.StrokeCap.Round
        : p.cap === 'square'
          ? ck.StrokeCap.Square
          : ck.StrokeCap.Butt,
    );
    paint.setStrokeJoin(
      p.join === 'round'
        ? ck.StrokeJoin.Round
        : p.join === 'bevel'
          ? ck.StrokeJoin.Bevel
          : ck.StrokeJoin.Miter,
    );
  } else {
    paint.setStyle(ck.PaintStyle.Fill);
  }
  return paint;
}

// Cache Skia images keyed by the (stable, per-texture) pixel buffer reference.
const imageCache = new WeakMap<Uint8Array, Image>();

function getImage(ck: CanvasKit, op: Extract<DrawOp, { type: 'image' }>): Image | null {
  const cached = imageCache.get(op.pixels);
  if (cached) return cached;
  const img = ck.MakeImage(
    {
      width: op.width,
      height: op.height,
      alphaType: ck.AlphaType.Unpremul,
      colorType: ck.ColorType.RGBA_8888,
      colorSpace: ck.ColorSpace.SRGB,
    },
    op.pixels,
    op.width * 4,
  );
  if (img) imageCache.set(op.pixels, img);
  return img;
}

/**
 * Draw a {@link SceneIR} onto any Skia {@link Canvas}. The same routine powers
 * the on-screen software surface and the (PDF-backed) document canvas, so the
 * exported PDF is pixel-faithful to the screen.
 */
export function drawSceneToSkCanvas(ck: CanvasKit, canvas: Canvas, scene: SceneIR): void {
  const bg = colorToRgb(scene.background);
  canvas.clear(ck.Color4f(bg.r / 255, bg.g / 255, bg.b / 255, 1));

  for (const op of scene.ops) {
    canvas.save();
    canvas.concat(toSkMatrix(op.matrix));

    if (op.type === 'path') {
      const path = buildPath(ck, op.path);
      for (const p of op.paints) {
        const paint = buildPaint(ck, p);
        canvas.drawPath(path, paint);
        paint.delete();
      }
      path.delete();
    } else {
      const img = getImage(ck, op);
      if (img) {
        const samplePaint = new ck.Paint();
        samplePaint.setAntiAlias(true);
        if (typeof (samplePaint as unknown as { setAlphaf?: (a: number) => void }).setAlphaf === 'function') {
          (samplePaint as unknown as { setAlphaf: (a: number) => void }).setAlphaf(op.alpha);
        }
        canvas.drawImageRect(
          img,
          ck.XYWHRect(0, 0, op.width, op.height),
          ck.XYWHRect(op.dx, op.dy, op.dw, op.dh),
          samplePaint,
        );
        samplePaint.delete();
      }
    }
    canvas.restore();
  }
}

/** A live Skia software surface bound to an on-page <canvas>. */
export class SkiaSurface {
  private surface: ReturnType<CanvasKit['MakeSWCanvasSurface']>;

  constructor(
    private ck: CanvasKit,
    canvasEl: HTMLCanvasElement,
  ) {
    const surface = ck.MakeSWCanvasSurface(canvasEl);
    if (!surface) throw new Error('Failed to create CanvasKit software surface');
    this.surface = surface;
  }

  render(scene: SceneIR): void {
    const canvas = this.surface!.getCanvas();
    drawSceneToSkCanvas(this.ck, canvas, scene);
    this.surface!.flush();
  }
}
