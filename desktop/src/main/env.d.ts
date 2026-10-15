/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  readonly MAIN_VITE_TMDB_KEY?: string
  readonly MAIN_VITE_GEMINI_KEY?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
