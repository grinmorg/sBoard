# PIXI → Skia → PDF

Приложение на **TypeScript**, которое:

1. Отрисовывает один и тот же `PIXI.Container` двумя способами — средствами
   **Pixi.js** (Канвас 1) и через собственную **обёртку над Skia / CanvasKit**
   (Канвас 2).
2. Экспортирует сцену в **векторный PDF** через **Skia PDF backend** (с
   fallback-ом на встроенный векторный PDF-writer, если PDF-бэкенд не вкомпилен
   в текущую wasm-сборку CanvasKit).
3. Поддерживает события `pointerdown` / `pointerup` для объектов
   `PIXI.DisplayObject` — **на обоих канвасах**.
4. Умеет генерировать случайные фигуры/линии.

Pixi.js используется в legacy-сборке версии **7.2.4** (`pixi.js-legacy`), а
`PIXI.Application` создаётся с **`forceCanvas: true`** (Canvas-рендерер, не WebGL).

---

## Запуск

```bash
npm install
npm run dev
```

Откроется `http://localhost:5173`. Доступные команды:

| Команда            | Назначение                                  |
| ------------------ | ------------------------------------------- |
| `npm run dev`      | Дев-сервер с HMR                            |
| `npm run build`    | Проверка типов + продакшен-сборка (Vite)    |
| `npm run preview`  | Локальный просмотр продакшен-сборки         |
| `npm run typecheck`| Только проверка типов (`tsc --noEmit`)      |

### Использование

- **«Сгенерировать случайную линию/фигуру»** — добавляет случайный
  `PIXI.Graphics` (rect / ellipse / circle / line / triangle) в контейнер.
  Изменение сразу видно на обоих канвасах.
- **«Экспорт в PDF»** — скачивает `scene.pdf`. В строке статуса указывается, каким
  бэкендом он создан (Skia PDF backend или встроенный writer).
- **«Очистить добавленные»** — удаляет добавленные пользователем фигуры.
- **Клик по фигуре** на любом из канвасов печатает событие
  (`pointerdown` / `pointerup`) в строку статуса и в консоль.

---

## Архитектура

Ключевая идея — единое **промежуточное представление (IR)** сцены. PIXI-дерево
обходится **один раз**, трансформации (translate / rotate / scale, в т.ч.
вложенные контейнеры) сворачиваются в мировые матрицы, и формируется плоский
список примитивов. Каждый бэкенд рендерит один и тот же IR — поэтому PDF
гарантированно совпадает с тем, что нарисовано на экране.

```
                       ┌────────────────────────┐
   PIXI.Container ───► │ pixiToIr.buildSceneIR() │ ──► SceneIR (DrawOp[])
                       └────────────────────────┘            │
                                                              ├─► skiaRenderer.drawSceneToSkCanvas ─► Skia software surface (Канвас 2)
                                                              ├─► skiaRenderer.drawSceneToSkCanvas ─► Skia PDF backend  (вектор) *
                                                              └─► pdfWriter.sceneToPdfBytes        ─► встроенный векторный PDF (fallback)
```

`*` — требует кастомной wasm-сборки CanvasKit, см. ниже.

### Структура

```
src/
  main.ts                  — точка входа: PIXI app, Skia surface, UI, render loop
  skia/canvaskit.ts        — однократная загрузка CanvasKit (Skia) WASM
  render/
    ir.ts                  — типы IR + аффинные матрицы
    pixiToIr.ts            — ОБЁРТКА: PIXI.Container → SceneIR (Graphics, Sprite, трансформации)
    skiaRenderer.ts        — IR → любой Skia Canvas (экран + PDF), класс SkiaSurface
    pdfWriter.ts           — встроенный векторный PDF-writer (fallback)
    pdfExport.ts           — выбор бэкенда (Skia PDF / fallback) + скачивание
  interaction/hitTest.ts   — hit-testing и проброс pointer-событий на Skia-канвас
  pixi/scenes.ts           — демо-сцена и генератор случайных фигур
scripts/build-canvaskit-pdf.sh — сборка кастомного CanvasKit с PDF-бэкендом
```

### Поддерживаемые объекты обёртки

- `PIXI.Graphics`: `drawRect`, `drawRoundedRect`, `drawCircle`, `drawEllipse`,
  `drawPolygon`, `drawShape`, а также `moveTo` / `lineTo` (линии). Учитываются
  стили заливки (`fill`) и обводки (`line`: ширина, цвет, alpha, cap, join).
- `PIXI.Sprite` (PNG/bitmap) — встраивается как изображение (единственный
  разрешённый растровый случай).
- Трансформации `translate` / `rotate` / `scale` / `pivot` / `skew`, включая
  вложенные `PIXI.Container`.

---

## Skia PDF backend (векторный экспорт)

PDF должен быть **векторным**. Идеальный путь — рендер IR на «холст» документа
Skia PDF (`SkPDF`). Однако пакет `canvaskit-wasm` из npm собран **без** PDF-бэкенда,
поэтому из коробки используется встроенный векторный writer (`pdfWriter.ts`),
который тоже даёт настоящий вектор (пути, заливки, обводки; спрайты — bitmap).

Чтобы задействовать именно **Skia PDF backend**, нужно собрать кастомный
CanvasKit:

```bash
bash scripts/build-canvaskit-pdf.sh
# затем скопировать out/canvaskit_wasm/{canvaskit.js,canvaskit.wasm}
# поверх node_modules/canvaskit-wasm/bin/
```

После этого `render/pdfExport.ts` автоматически обнаружит фабрику PDF-документа
на экземпляре CanvasKit (feature-detection) и переключится на Skia-бэкенд —
строка статуса покажет «PDF создан через Skia PDF backend».

> Сборка Skia/Emscripten объёмная (depot_tools + emsdk + ninja, ~15 ГБ, долго).
> Поэтому в репозитории встроенный writer — это рабочий дефолт, а Skia-бэкенд —
> опциональное улучшение через скрипт сборки.

---

## Технические заметки

- **Совмещение координат**: оба канваса рендерятся в одном логическом размере
  (500×340, resolution 1:1), поэтому глобальные координаты клика одинаково
  отображаются в локальные через `worldTransform`.
- **События на Skia-канвасе**: у Skia нет своего scene-graph, поэтому клик
  хит-тестится по PIXI-дереву (`pickTopMost`), а затем у найденного объекта
  вызываются те же слушатели через `EventEmitter.emit` — поведение идентично
  PIXI-канвасу.
- **Память CanvasKit**: `Path`/`Paint` создаются и освобождаются в рамках кадра;
  изображения кэшируются по буферу пикселей.
