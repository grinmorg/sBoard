import { Container, Graphics, Sprite, Texture, type DisplayObject } from 'pixi.js-legacy';

export type SceneEventLogger = (message: string) => void;

/** Make every object react to pointer events and report them through the logger. */
function makeInteractive(obj: DisplayObject, name: string, log: SceneEventLogger): void {
  obj.eventMode = 'static';
  obj.cursor = 'pointer';
  obj.on('pointerdown', () => log(`pointerdown → ${name}`));
  obj.on('pointerup', () => log(`pointerup → ${name}`));
}

/** Build a small "photo"-like texture so we have a real PIXI.Sprite (bitmap) in the scene. */
function makePhotoTexture(): Texture {
  const cv = document.createElement('canvas');
  cv.width = 120;
  cv.height = 90;
  const ctx = cv.getContext('2d')!;
  // faux room: floor + wall + a window
  const grad = ctx.createLinearGradient(0, 0, 0, 90);
  grad.addColorStop(0, '#d8e6f0');
  grad.addColorStop(1, '#b9c6d0');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 120, 90);
  ctx.fillStyle = '#9aa7b0';
  ctx.fillRect(0, 62, 120, 28); // floor
  ctx.fillStyle = '#eef4f8';
  ctx.fillRect(70, 14, 38, 30); // window
  ctx.strokeStyle = '#7d8a93';
  ctx.lineWidth = 2;
  ctx.strokeRect(70, 14, 38, 30);
  ctx.beginPath();
  ctx.moveTo(89, 14);
  ctx.lineTo(89, 44);
  ctx.moveTo(70, 29);
  ctx.lineTo(108, 29);
  ctx.stroke();
  ctx.fillStyle = '#c9d2d8';
  ctx.fillRect(12, 40, 26, 22); // a cabinet
  return Texture.from(cv);
}

/**
 * Build the default demonstration scene.
 *
 * Reproduces the exact `PIXI.Container` example from the task statement
 * (g1 ellipse, g2 scaled+rotated rect, g3/g4 lines inside a nested
 * subContainer) so a reviewer can cross-check the wrapper 1:1, and adds a
 * `PIXI.Sprite` (bitmap) — the other object type the wrapper must support.
 *
 * The task's own `pointerdown`/`pointerup` handlers (console.log) are wired
 * verbatim; we additionally surface every event through the status logger so
 * it is visible in the UI and demonstrably fires on both canvases.
 */
export function buildDemoScene(log: SceneEventLogger): Container {
  const mainContainer = new Container();
  const subContainer = new Container();

  const g1 = new Graphics();
  const g2 = new Graphics();
  const g3 = new Graphics();
  const g4 = new Graphics();

  // g1 — red ellipse, translated + rotated.
  g1.beginFill('#ff0000').drawEllipse(0, 0, 200, 100).endFill();
  g1.position.set(200, 100);
  g1.angle = 30;
  g1.on('pointerdown', () => {
    console.log('g1 pointerdown!');
  });
  makeInteractive(g1, 'g1 (red ellipse)', log);

  // g2 — blue rect, translated + rotated + non-uniform scale.
  g2.beginFill('#0000ff').drawRect(-50, -75, 100, 150).endFill();
  g2.position.set(120, 60);
  g2.angle = 15;
  g2.scale.set(1.5, 1.7);
  g2.on('pointerup', () => {
    console.log('g2 pointerup!');
  });
  makeInteractive(g2, 'g2 (blue rect)', log);

  // g3 — white line (moveTo/lineTo), rotated.
  g3.lineStyle(10, '#ffffff', 1).moveTo(0, 0).lineTo(150, 100);
  g3.angle = -20;
  makeInteractive(g3, 'g3 (white line)', log);

  // g4 — yellow line (moveTo/lineTo), rotated.
  g4.lineStyle(10, '#ffff00', 1).moveTo(0, 70).lineTo(150, -30);
  g4.angle = 20;
  makeInteractive(g4, 'g4 (yellow line)', log);

  // Nested container: its own translate composes with the lines' rotations,
  // exercising the wrapper's recursive world-transform handling.
  subContainer.position.set(75, 50);
  subContainer.addChild(g3, g4);

  // --- sprite (bitmap) — the one allowed raster object type ---
  const sprite = new Sprite(makePhotoTexture());
  sprite.anchor.set(0.5);
  sprite.position.set(360, 250);
  makeInteractive(sprite, 'sprite (photo)', log);

  mainContainer.addChild(subContainer, g1, g2, sprite);
  return mainContainer;
}

const PALETTE = ['#e74c3c', '#27ae60', '#2980b9', '#f39c12', '#8e44ad', '#16a085', '#111111'];

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Add a random shape or line (PIXI.Graphics) to the container — the
 * "Сгенерировать случайную линию/фигуру" interaction.
 */
export function addRandomShape(root: Container, log: SceneEventLogger): void {
  const g = new Graphics();
  const color = pick(PALETTE);
  const kind = pick(['rect', 'ellipse', 'circle', 'line', 'triangle']);
  let label = kind;

  switch (kind) {
    case 'rect':
      g.beginFill(color, 0.9).drawRect(-rand(20, 50), -rand(20, 50), rand(40, 100), rand(40, 100)).endFill();
      break;
    case 'ellipse':
      g.beginFill(color, 0.9).drawEllipse(0, 0, rand(25, 60), rand(15, 40)).endFill();
      break;
    case 'circle':
      g.beginFill(color, 0.9).drawCircle(0, 0, rand(18, 45)).endFill();
      break;
    case 'line':
      g.lineStyle(rand(3, 10), color, 1)
        .moveTo(0, 0)
        .lineTo(rand(-80, 80), rand(-80, 80));
      label = 'line';
      break;
    case 'triangle': {
      const s = rand(25, 55);
      g.beginFill(color, 0.9).drawPolygon([0, -s, s, s, -s, s]).endFill();
      break;
    }
  }

  g.position.set(rand(60, 440), rand(60, 280));
  g.angle = rand(0, 360);
  g.scale.set(rand(0.7, 1.3));

  const id = `random ${label}`;
  makeInteractive(g, id, log);
  root.addChild(g);
  log(`Добавлена фигура: ${label}`);
}
