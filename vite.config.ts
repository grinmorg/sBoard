import { defineConfig } from 'vite';

export default defineConfig({
  // CanvasKit ships a large .wasm; allow it to be served/inlined correctly.
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: {
    // The CanvasKit glue is a CJS/UMD module; let Vite pre-bundle it.
    include: ['canvaskit-wasm'],
  },
  server: {
    port: 5173,
    open: true,
  },
});
