import type { OrganatoItem } from "@organato/domain";

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
  const text = await response.text().catch(() => "");
  let result: T & { error?: string; code?: string };
  try {
    result = (text ? JSON.parse(text) : {}) as T & {
      error?: string;
      code?: string;
    };
  } catch {
    result = {} as T & { error?: string; code?: string };
  }
  if (!response.ok) {
    // Keep the server message when present, but always include the status
    // so outages (502/HTML from the edge) stay diagnosable in the UI.
    const detail =
      result.error ??
      (text.trim()
        ? `Request failed (${response.status}): ${text.trim().slice(0, 160)}`
        : `Request failed (${response.status}).`);
    throw new IntegrationRequestError(detail, result.code);
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
  // Redirect without logging out first: the callback mints a fresh session
  // cookie on success, and if the user abandons the Google round-trip the
  // existing session stays valid instead of dropping them to the starter page.
  window.location.assign(result.authorizationUrl);
}

export async function resolveCalendarConflict(
  itemId: string,
  strategy: "mine" | "theirs",
): Promise<void> {
  await integrationRequest<{ ok: true }>(
    "/api/integrations/google/resolve-conflict",
    {
      method: "POST",
      body: JSON.stringify({ itemId, strategy }),
    },
  );
}

/** Display href for an attachment: stored files resolve to the authed route. */
export function attachmentHref(attachment: {
  id: string;
  url: string;
}): string {
  if (attachment.url.startsWith("kv://")) {
    return `/api/attachments/${attachment.id}/file`;
  }
  return attachment.url;
}

export async function uploadAttachment(
  itemId: string,
  file: File,
  label: string,
  linkType: string,
): Promise<{ item: OrganatoItem }> {
  const form = new FormData();
  form.set("file", file);
  form.set("label", label);
  form.set("linkType", linkType);
  const response = await fetch(
    `/api/items/${encodeURIComponent(itemId)}/attachments/upload`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "X-CSRF-Token": sessionStorage.getItem("organato_csrf") ?? "",
      },
      body: form,
    },
  );
  const result = (await response.json().catch(() => ({}))) as {
    item?: OrganatoItem;
    error?: string;
  };
  if (!response.ok || !result.item) {
    throw new IntegrationRequestError(
      result.error ?? `Upload failed (${response.status}).`,
    );
  }
  return { item: result.item };
}
