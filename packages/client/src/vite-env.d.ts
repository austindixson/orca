/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_CANVAS_BRIDGE?: string
  /** Must match server CANVAS_BRIDGE_TOKEN when bridge auth is enabled. */
  readonly VITE_CANVAS_BRIDGE_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.md?raw' {
  const content: string
  export default content
}
