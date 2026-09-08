export interface Env {
  DB: D1Database;
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
}

export interface SessionUser {
  email: string;
  workspaceId: string;
  displayName: string;
  csrfToken: string;
  sessionIdHash: string;
  authenticatedAt: string;
}

export type Variables = {
  user: SessionUser;
};
