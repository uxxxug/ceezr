/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WASLAH_API_BASE?: string;
  readonly VITE_WASLAH_BOT_LINK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
