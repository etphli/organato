export interface Env {
  DB: D1Database;
  /** KV namespace for item file attachments (PDF/DOCX). Optional: routes 501 without it. */
  ATTACHMENTS?: KVNamespace;
  CANVAS_CONNECTOR?: DurableObjectNamespace;
  CONNECTOR_PUBLIC_ORIGIN?: string;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  ALLOWED_GOOGLE_EMAILS: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  DATA_ENCRYPTION_KEY: string;
  CANVAS_BASE_URL: string;
  CANVAS_DISPLAY_NAME?: string;
  SCHEDULER_TOKEN?: string;
  SCHEDULER_MODE?: "cloudflare" | "local";
  STUDATO_ISSUER?: string;
  DEMO_MODE?: string;
  AI_ENABLED?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
}

export interface SessionUser {
  email: string;
  workspaceId: string;
  displayName: string;
  csrfToken: string;
  sessionIdHash: string;
  authenticatedAt: string;
}

export interface ApiKeyUser {
  email: string;
  workspaceId: string;
  displayName: string;
  apiKeyId: string;
  csrfToken?: never;
  sessionIdHash?: never;
  authenticatedAt?: never;
}

export type Variables = {
  user: SessionUser | ApiKeyUser;
};
