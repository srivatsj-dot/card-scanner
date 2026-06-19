/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Optional Google OAuth client ID for "Continue with Google". When unset, the
  // Google button is hidden and username/password sign-in is used.
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
