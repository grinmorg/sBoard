/// <reference types="vite/client" />

// Allow importing the wasm binary as a URL string (Vite `?url` suffix).
declare module '*.wasm?url' {
  const src: string;
  export default src;
}
