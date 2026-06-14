import './style.css';
import { Application, Container, Rectangle } from 'pixi.js-legacy';
import { getCanvasKit } from './skia/canvaskit';
import { SkiaSurface } from './render/skiaRenderer';
import { buildSceneIR } from './render/pixiToIr';
import { exportScenePdf, downloadPdf } from './render/pdfExport';
import { attachSkiaPointerEvents } from './interaction/hitTest';
import { addRandomShape, buildDemoScene } from './pixi/scenes';

const WIDTH = 500;
const HEIGHT = 340;
const BACKGROUND = 0xececec;

// ---- DOM ----
const pixiHost = document.getElementById('pixi-host') as HTMLDivElement;
const skiaCanvas = document.getElementById('skia-canvas') as HTMLCanvasElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;
const btnRandom = document.getElementById('btn-random') as HTMLButtonElement;
const btnExport = document.getElementById('btn-export') as HTMLButtonElement;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;

// ---- status log (small ring buffer) ----
const log: string[] = [];
function setStatus(message: string): void {
  log.unshift(message);
  log.length = Math.min(log.length, 4);
  statusEl.textContent = log.join('\n');
}

async function main(): Promise<void> {
  // ---- Canvas 1: PIXI (forceCanvas = true, legacy build) ----
  const app = new Application({
    width: WIDTH,
    height: HEIGHT,
    forceCanvas: true, // required by the task: use the Canvas renderer, not WebGL
    backgroundColor: BACKGROUND,
    antialias: true,
    autoDensity: false,
    resolution: 1,
  });
  pixiHost.appendChild(app.view as unknown as HTMLCanvasElement);

  // Enable interaction across the whole stage so child `eventMode:'static'` works.
  app.stage.eventMode = 'static';
  app.stage.hitArea = new Rectangle(0, 0, WIDTH, HEIGHT);

  const scene: Container = buildDemoScene(setStatus);
  app.stage.addChild(scene);
  const initialChildCount = scene.children.length;

  // ---- Canvas 2: Skia (CanvasKit software surface) ----
  skiaCanvas.width = WIDTH;
  skiaCanvas.height = HEIGHT;
  setStatus('Загрузка CanvasKit (Skia)…');
  await getCanvasKit();
  const skia = new SkiaSurface(await getCanvasKit(), skiaCanvas);

  // Pointer events on the Skia canvas (re-uses the PIXI scene graph for hit-testing).
  attachSkiaPointerEvents(skiaCanvas, scene);

  // ---- render loop: PIXI auto-renders Canvas 1; we mirror the scene onto Skia ----
  const renderSkia = (): void => {
    const ir = buildSceneIR(scene, { width: WIDTH, height: HEIGHT, background: BACKGROUND });
    skia.render(ir);
  };
  app.ticker.add(renderSkia);
  renderSkia();
  setStatus('Готово. Кликайте по фигурам на обоих канвасах.');

  // ---- UI actions ----
  btnRandom.addEventListener('click', () => addRandomShape(scene, setStatus));

  btnClear.addEventListener('click', () => {
    while (scene.children.length > initialChildCount) {
      scene.removeChildAt(scene.children.length - 1).destroy();
    }
    setStatus('Добавленные фигуры удалены.');
  });

  btnExport.addEventListener('click', async () => {
    btnExport.disabled = true;
    setStatus('Экспорт в PDF…');
    try {
      const ir = buildSceneIR(scene, { width: WIDTH, height: HEIGHT, background: 0xffffff });
      const { bytes, backend } = await exportScenePdf(ir);
      downloadPdf(bytes, 'scene.pdf');
      setStatus(
        backend === 'skia'
          ? 'PDF создан через Skia PDF backend (вектор).'
          : 'PDF создан встроенным векторным writer-ом (Skia PDF backend не найден в текущей wasm-сборке).',
      );
    } catch (err) {
      console.error(err);
      setStatus('Ошибка экспорта PDF (см. консоль).');
    } finally {
      btnExport.disabled = false;
    }
  });
}

main().catch((err) => {
  console.error(err);
  setStatus('Ошибка инициализации (см. консоль).');
});
