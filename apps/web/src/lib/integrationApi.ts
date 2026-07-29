export interface GoogleDeliverySettings {
  connected: boolean;
  sender: string | null;
  recipients: string[];
  status: string;
  reconnectNeeded: boolean;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastErrorCategory: string | null;
}

export interface SessionSecurityState {
  recentAuthentication: boolean;
}

export class IntegrationRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "IntegrationRequestError";
  }
}

export async function integrationRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.method && !["GET", "HEAD"].includes(init.method)) {
    headers.set("X-CSRF-Token", sessionStorage.getItem("organato_csrf") ?? "");
  }
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new IntegrationRequestError(
      result.error ?? "The connection could not be updated.",
      result.code,
    );
  }
  return result;
}

export async function beginGoogleConnection(): Promise<void> {
  const result = await integrationRequest<{ authorizationUrl: string }>(
    "/api/integrations/google/start",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
  window.location.assign(result.authorizationUrl);
}

export async function reauthenticate(
  returnTo = window.location.pathname,
): Promise<void> {
  const result = await integrationRequest<{ authorizationUrl: string }>(
    "/api/auth/google/start",
    {
      method: "POST",
      body: JSON.stringify({ returnTo }),
    },
  );
  await integrationRequest("/api/auth/logout", {
    method: "POST",
    body: JSON.stringify({}),
  });
  window.location.assign(result.authorizationUrl);
}
