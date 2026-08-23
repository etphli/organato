import type {
  CalendarChangePage,
  CalendarEventProjection,
  CalendarEventRecord,
  EmailMessage,
  EmailProvider,
  GoogleCalendarProvider,
} from "./contracts";

interface TokenSource {
  accessToken(): Promise<string>;
}

type Sleep = (milliseconds: number) => Promise<void>;

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(`Google API request failed (${status}).`);
    this.name = "GoogleApiError";
  }
}

export function googleRetryAfterMs(
  value: string | null,
  attempt: number,
  nowMs = Date.now(),
): number {
  const fallback = Math.min(5_000, 250 * 2 ** attempt);
  if (!value) return fallback;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(10_000, seconds * 1_000);
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return fallback;
  return Math.min(10_000, Math.max(0, date - nowMs));
}

export async function deterministicGoogleEventId(
  itemId: string,
  itemVersion: number,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${itemId}:${itemVersion}`),
  );
  const hexadecimal = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `organato${hexadecimal}`;
}

async function googleJson<T>(
  tokenSource: TokenSource,
  url: string,
  init: RequestInit = {},
  options: {
    fetcher?: typeof fetch;
    sleep?: Sleep;
    retryable?: boolean;
  } = {},
): Promise<T> {
  const fetcher = options.fetcher ?? fetch;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const attempts = options.retryable ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const token = await tokenSource.accessToken();
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: init.signal ?? AbortSignal.timeout(15_000),
        redirect: "manual",
      });
    } catch (error) {
      if (attempt < attempts - 1) {
        await sleep(googleRetryAfterMs(null, attempt));
        continue;
      }
      throw error;
    }
    const retryable =
      response.status === 429 || [500, 502, 503, 504].includes(response.status);
    if (retryable && attempt < attempts - 1) {
      await response.body?.cancel();
      await sleep(
        googleRetryAfterMs(response.headers.get("Retry-After"), attempt),
      );
      continue;
    }
    if (!response.ok) throw new GoogleApiError(response.status, retryable);
    if (response.status === 204) return undefined as T;
    const contentLength = Number(response.headers.get("Content-Length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > 5_000_000) {
      throw new GoogleApiError(502, false);
    }
    const text = await response.text();
    if (text.length > 5_000_000) throw new GoogleApiError(502, false);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new GoogleApiError(502, false);
    }
  }
  throw new GoogleApiError(503, true);
}

export class GoogleCalendarRestProvider implements GoogleCalendarProvider {
  constructor(
    private readonly tokenSource: TokenSource,
    private readonly fetcher: typeof fetch = fetch,
    private readonly sleep: Sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async ensureOrganatoCalendar(storedCalendarId?: string): Promise<string> {
    if (storedCalendarId) return storedCalendarId;
    const created = await googleJson<{ id: string }>(
      this.tokenSource,
      "https://www.googleapis.com/calendar/v3/calendars",
      {
        method: "POST",
        body: JSON.stringify({
          summary: "Organato",
          timeZone: "Australia/Sydney",
        }),
      },
      { fetcher: this.fetcher, sleep: this.sleep },
    );
    return created.id;
  }

  async upsertEvent(
    calendarId: string,
    projection: CalendarEventProjection,
    existingEventId?: string,
    etag?: string,
  ): Promise<CalendarEventRecord> {
    const eventBody = {
      summary: projection.summary,
      description: projection.description,
      start: projection.start,
      end: projection.end,
      reminders: { useDefault: false, overrides: [] },
      extendedProperties: { private: projection.privateProperties },
    };
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    if (existingEventId) {
      return googleJson<CalendarEventRecord>(
        this.tokenSource,
        `${base}/${encodeURIComponent(existingEventId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(eventBody),
          ...(etag ? { headers: { "If-Match": etag } } : {}),
        },
        { fetcher: this.fetcher, sleep: this.sleep, retryable: true },
      );
    }
    const eventId = await deterministicGoogleEventId(
      projection.itemId,
      projection.itemVersion,
    );
    try {
      return await googleJson<CalendarEventRecord>(
        this.tokenSource,
        base,
        {
          method: "POST",
          body: JSON.stringify({ id: eventId, ...eventBody }),
        },
        { fetcher: this.fetcher, sleep: this.sleep, retryable: true },
      );
    } catch (error) {
      if (!(error instanceof GoogleApiError) || error.status !== 409)
        throw error;
      return googleJson<CalendarEventRecord>(
        this.tokenSource,
        `${base}/${encodeURIComponent(eventId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(eventBody),
        },
        { fetcher: this.fetcher, sleep: this.sleep, retryable: true },
      );
    }
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      await googleJson<void>(
        this.tokenSource,
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { method: "DELETE" },
        { fetcher: this.fetcher, sleep: this.sleep, retryable: true },
      );
    } catch (error) {
      if (
        error instanceof GoogleApiError &&
        (error.status === 404 || error.status === 410)
      ) {
        return;
      }
      throw error;
    }
  }

  async listChanges(
    calendarId: string,
    syncToken?: string,
    pageToken?: string,
  ): Promise<CalendarChangePage> {
    const params = new URLSearchParams({
      showDeleted: "true",
      singleEvents: "true",
      maxResults: "2500",
    });
    if (syncToken) params.set("syncToken", syncToken);
    if (pageToken) params.set("pageToken", pageToken);
    const result = await googleJson<{
      items: CalendarEventRecord[];
      nextPageToken?: string;
      nextSyncToken?: string;
    }>(
      this.tokenSource,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      {},
      { fetcher: this.fetcher, sleep: this.sleep, retryable: true },
    );
    return {
      events: Array.isArray(result.items) ? result.items : [],
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
      ...(result.nextSyncToken ? { nextSyncToken: result.nextSyncToken } : {}),
    };
  }
}

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function encodeMimeHeader(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

export class GmailSendProvider implements EmailProvider {
  constructor(
    private readonly tokenSource: TokenSource,
    private readonly sender: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<{ messageId: string }> {
    const boundary = `organato-${crypto.randomUUID()}`;
    const mime = [
      `From: ${this.sender}`,
      `To: ${message.to.join(", ")}`,
      `Subject: ${encodeMimeHeader(message.subject)}`,
      `X-Organato-Delivery-Key: ${message.deliveryKey.replaceAll(/[\r\n]/g, "")}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      message.text,
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "",
      message.html,
      `--${boundary}--`,
    ].join("\r\n");
    const result = await googleJson<{ id: string }>(
      this.tokenSource,
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      { method: "POST", body: JSON.stringify({ raw: base64Url(mime) }) },
      { fetcher: this.fetcher },
    );
    return { messageId: result.id };
  }
}
