/**
 * Backend-agnostic intermediate representation (IR) of a rendered scene.
 *
 * The PIXI scene graph is traversed **once** into a flat list of {@link DrawOp}s
 * with fully-resolved world transforms. Every backend (Skia screen surface,
 * Skia PDF backend, portable vector PDF writer) consumes the same IR, which
 * guarantees the PDF export is exactly the scene drawn on screen.
 */

/** 2D affine matrix in PIXI convention: x' = a*x + c*y + tx, y' = b*x + d*y + ty. */
export interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

/** Compose two affine transforms: result applies `local` first, then `parent`. */
export function matMul(parent: Mat, local: Mat): Mat {
  return {
    a: parent.a * local.a + parent.c * local.b,
    b: parent.b * local.a + parent.d * local.b,
    c: parent.a * local.c + parent.c * local.d,
    d: parent.b * local.c + parent.d * local.d,
    tx: parent.a * local.tx + parent.c * local.ty + parent.tx,
    ty: parent.b * local.tx + parent.d * local.ty + parent.ty,
  };
}

/** A single sub-path / primitive inside a Graphics shape. */
export type PathCmd =
  | { op: 'moveTo'; x: number; y: number }
  | { op: 'lineTo'; x: number; y: number }
  | { op: 'rect'; x: number; y: number; w: number; h: number }
  | { op: 'roundRect'; x: number; y: number; w: number; h: number; r: number }
  | { op: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { op: 'close' };

export interface Paint {
  kind: 'fill' | 'stroke';
  /** 0xRRGGBB */
  color: number;
  alpha: number;
  /** stroke width (stroke only) */
  width?: number;
  cap?: 'butt' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
}

/** A vector primitive: a path drawn with one or more paints (fill and/or stroke). */
export interface PathOp {
  type: 'path';
  matrix: Mat;
  path: PathCmd[];
  paints: Paint[];
}

/** A bitmap (PIXI.Sprite). Embedded as an image — the one allowed raster case. */
export interface ImageOp {
  type: 'image';
  matrix: Mat;
  /** RGBA pixels in row-major order. */
  pixels: Uint8Array;
  width: number;
  height: number;
  /** local-space placement rectangle (already accounts for anchor). */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  alpha: number;
}

export type DrawOp = PathOp | ImageOp;

/** The full scene ready to be rendered by any backend. */
export interface SceneIR {
  width: number;
  height: number;
  /** page/background colour, 0xRRGGBB */
  background: number;
  ops: DrawOp[];
}

export function colorToRgb(color: number): { r: number; g: number; b: number } {
  return {
    r: (color >> 16) & 0xff,
    g: (color >> 8) & 0xff,
    b: color & 0xff,
  };
}
