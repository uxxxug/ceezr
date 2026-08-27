/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WASLAH_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
