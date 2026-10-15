/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  /** Base URL of the CinemaTrack API (worker/). Defaults to the official one. */
  readonly MAIN_VITE_API_URL?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
