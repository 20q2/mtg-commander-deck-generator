/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_ANALYTICS_URL?: string;
  readonly VITE_TAG_REPO_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
