import { Container, Graphics, Point, Sprite, type DisplayObject } from 'pixi.js-legacy';

const tmpPoint = new Point();

function isInteractive(o: DisplayObject): boolean {
  return o.eventMode === 'static' || o.eventMode === 'dynamic';
}

/** Graphics/Sprite are Containers too; treat them as drawable leaves for hit-testing. */
function isLeaf(o: DisplayObject): boolean {
  return o instanceof Graphics || o instanceof Sprite;
}

function search(node: DisplayObject, gx: number, gy: number): DisplayObject | null {
  if (!node.visible) return null;

  if (node instanceof Container && !isLeaf(node)) {
    // Iterate top-most child first so overlapping shapes resolve correctly.
    for (let i = node.children.length - 1; i >= 0; i--) {
      const hit = search(node.children[i], gx, gy);
      if (hit) return hit;
    }
    return null;
  }

  if (!isInteractive(node)) return null;

  // Map the global (canvas) point into the node's local space via its world transform.
  node.worldTransform.applyInverse({ x: gx, y: gy }, tmpPoint);

  if (node instanceof Graphics) {
    return node.containsPoint(tmpPoint) ? node : null;
  }
  if (node instanceof Sprite) {
    const b = node.getLocalBounds();
    const inside =
      tmpPoint.x >= b.x &&
      tmpPoint.x <= b.x + b.width &&
      tmpPoint.y >= b.y &&
      tmpPoint.y <= b.y + b.height;
    return inside ? node : null;
  }
  return null;
}

/**
 * Find the top-most interactive DisplayObject under a point given in the same
 * coordinate space as the rendered scene (canvas pixels, resolution 1:1).
 */
export function pickTopMost(root: Container, gx: number, gy: number): DisplayObject | null {
  return search(root, gx, gy);
}

/**
 * Attach pointer hit-testing to the Skia <canvas>. Because the Skia canvas has
 * no scene graph of its own, we re-use the PIXI tree: we find the hit object and
 * fire the very same `pointerdown` / `pointerup` listeners registered on it
 * (PIXI DisplayObjects are EventEmitters), so events behave identically on both
 * canvases.
 */
export function attachSkiaPointerEvents(canvas: HTMLCanvasElement, root: Container): void {
  const dispatch = (type: 'pointerdown' | 'pointerup', ev: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((ev.clientY - rect.top) / rect.height) * canvas.height;
    const target = pickTopMost(root, x, y);
    if (target) {
      target.emit(type, {
        type,
        target,
        global: new Point(x, y),
        // minimal federated-event-like shape; enough for the demo handlers
      } as never);
    }
  };

  canvas.addEventListener('pointerdown', (ev) => dispatch('pointerdown', ev));
  canvas.addEventListener('pointerup', (ev) => dispatch('pointerup', ev));
}
