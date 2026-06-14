import {
  Container,
  Graphics,
  Sprite,
  SHAPES,
  type DisplayObject,
  type Matrix,
} from 'pixi.js-legacy';
import {
  IDENTITY,
  matMul,
  type DrawOp,
  type Mat,
  type Paint,
  type PathCmd,
  type SceneIR,
} from './ir';

/** Convert a PIXI.Matrix to our plain IR matrix. */
function fromPixiMatrix(m: Matrix): Mat {
  return { a: m.a, b: m.b, c: m.c, d: m.d, tx: m.tx, ty: m.ty };
}

/** Read a node's up-to-date local transform (recomputed from position/rotation/scale/pivot/skew). */
function localMatrix(node: DisplayObject): Mat {
  // updateLocalTransform refreshes `localTransform` from the node's properties.
  (node.transform as unknown as { updateLocalTransform(): void }).updateLocalTransform();
  return fromPixiMatrix(node.transform.localTransform);
}

/** Map PIXI line-cap/join enums onto IR string unions, with safe defaults. */
function mapCap(cap: unknown): Paint['cap'] {
  return cap === 'round' || cap === 'square' ? cap : 'butt';
}
function mapJoin(join: unknown): Paint['join'] {
  return join === 'round' || join === 'bevel' ? join : 'miter';
}

/** Build IR path commands for a single PIXI shape. */
function shapeToPath(shape: any): PathCmd[] {
  switch (shape.type) {
    case SHAPES.RECT:
      return [{ op: 'rect', x: shape.x, y: shape.y, w: shape.width, h: shape.height }];
    case SHAPES.RREC:
      return [
        { op: 'roundRect', x: shape.x, y: shape.y, w: shape.width, h: shape.height, r: shape.radius },
      ];
    case SHAPES.CIRC:
      return [{ op: 'ellipse', cx: shape.x, cy: shape.y, rx: shape.radius, ry: shape.radius }];
    case SHAPES.ELIP:
      // PIXI Ellipse stores half-width/half-height as `width`/`height`.
      return [{ op: 'ellipse', cx: shape.x, cy: shape.y, rx: shape.width, ry: shape.height }];
    case SHAPES.POLY: {
      const pts: number[] = shape.points ?? [];
      const cmds: PathCmd[] = [];
      for (let i = 0; i + 1 < pts.length; i += 2) {
        cmds.push({ op: i === 0 ? 'moveTo' : 'lineTo', x: pts[i], y: pts[i + 1] });
      }
      // `closeStroke` distinguishes a closed polygon from an open polyline (moveTo/lineTo).
      if (shape.closeStroke) cmds.push({ op: 'close' });
      return cmds;
    }
    default:
      return [];
  }
}

/** Convert a PIXI.Graphics into one PathOp per stored shape (fill + stroke paints). */
function graphicsToOps(g: Graphics, worldMat: Mat, worldAlpha: number): DrawOp[] {
  const ops: DrawOp[] = [];
  const data: any[] = (g as any).geometry.graphicsData ?? [];

  for (const gd of data) {
    const path = shapeToPath(gd.shape);
    if (path.length === 0) continue;

    const paints: Paint[] = [];
    const fill = gd.fillStyle;
    if (fill && fill.visible) {
      paints.push({ kind: 'fill', color: fill.color >>> 0, alpha: fill.alpha * worldAlpha });
    }
    const line = gd.lineStyle;
    if (line && line.visible && line.width > 0) {
      paints.push({
        kind: 'stroke',
        color: line.color >>> 0,
        alpha: line.alpha * worldAlpha,
        width: line.width,
        cap: mapCap(line.cap),
        join: mapJoin(line.join),
      });
    }
    if (paints.length === 0) continue;

    // A GraphicsData may carry its own local matrix (rare); compose it in.
    const m = gd.matrix ? matMul(worldMat, fromPixiMatrix(gd.matrix)) : worldMat;
    ops.push({ type: 'path', matrix: m, path, paints });
  }
  return ops;
}

// Cache decoded sprite pixels per texture so we don't re-read on every frame.
const pixelCache = new WeakMap<object, { pixels: Uint8Array; width: number; height: number }>();

function spritePixels(
  sprite: Sprite,
): { pixels: Uint8Array; width: number; height: number } | null {
  const tex = sprite.texture;
  const baseAny = tex.baseTexture as any;
  const cacheKey = tex as unknown as object;
  const cached = pixelCache.get(cacheKey);
  if (cached) return cached;

  const source = baseAny?.resource?.source as CanvasImageSource | undefined;
  if (!source) return null;

  const frame = tex.frame;
  const w = Math.max(1, Math.round(frame.width));
  const h = Math.max(1, Math.round(frame.height));

  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, frame.x, frame.y, frame.width, frame.height, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const result = { pixels: new Uint8Array(data), width: w, height: h };
  pixelCache.set(cacheKey, result);
  return result;
}

function spriteToOp(sprite: Sprite, worldMat: Mat, worldAlpha: number): DrawOp | null {
  const px = spritePixels(sprite);
  if (!px) return null;

  const orig = sprite.texture.orig;
  const anchor = sprite.anchor;
  return {
    type: 'image',
    matrix: worldMat,
    pixels: px.pixels,
    width: px.width,
    height: px.height,
    dx: -anchor.x * orig.width,
    dy: -anchor.y * orig.height,
    dw: orig.width,
    dh: orig.height,
    alpha: worldAlpha,
  };
}

/** Recursively walk the scene graph, accumulating world transform and alpha. */
function walk(node: DisplayObject, parentMat: Mat, parentAlpha: number, out: DrawOp[]): void {
  if (!node.visible || node.alpha <= 0) return;

  const worldMat = matMul(parentMat, localMatrix(node));
  const worldAlpha = parentAlpha * node.alpha;

  if (node instanceof Graphics) {
    out.push(...graphicsToOps(node, worldMat, worldAlpha));
    return;
  }
  if (node instanceof Sprite) {
    const op = spriteToOp(node, worldMat, worldAlpha);
    if (op) out.push(op);
    return;
  }
  if (node instanceof Container) {
    for (const child of node.children) walk(child, worldMat, worldAlpha, out);
  }
}

export interface BuildOptions {
  width: number;
  height: number;
  background?: number;
}

/**
 * Convert a PIXI.Container (with arbitrarily nested children and transforms)
 * into a backend-agnostic {@link SceneIR}. This is the public entry point of
 * the "Skia wrapper" — Skia/PDF backends never touch PIXI types directly.
 */
export function buildSceneIR(root: Container, opts: BuildOptions): SceneIR {
  const ops: DrawOp[] = [];
  // Walk children of the root so the root container's own transform is honoured too.
  walk(root, IDENTITY, 1, ops);
  return {
    width: opts.width,
    height: opts.height,
    background: opts.background ?? 0xececec,
    ops,
  };
}
