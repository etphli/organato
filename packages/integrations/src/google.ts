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

async function googleJson<T>(
  tokenSource: TokenSource,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await tokenSource.accessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok)
    throw new Error(`Google API request failed (${response.status}).`);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export class GoogleCalendarRestProvider implements GoogleCalendarProvider {
  constructor(private readonly tokenSource: TokenSource) {}

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
    return googleJson<CalendarEventRecord>(
      this.tokenSource,
      existingEventId ? `${base}/${encodeURIComponent(existingEventId)}` : base,
      {
        method: existingEventId ? "PATCH" : "POST",
        body: JSON.stringify(eventBody),
        ...(etag ? { headers: { "If-Match": etag } } : {}),
      },
    );
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    await googleJson<void>(
      this.tokenSource,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" },
    );
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
    );
    return {
      events: result.items,
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

export class GmailSendProvider implements EmailProvider {
  constructor(
    private readonly tokenSource: TokenSource,
    private readonly sender: string,
  ) {}

  async send(message: EmailMessage): Promise<{ messageId: string }> {
    const boundary = `organato-${crypto.randomUUID()}`;
    const mime = [
      `From: ${this.sender}`,
      `To: ${message.to.join(", ")}`,
      `Subject: ${message.subject}`,
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
    );
    return { messageId: result.id };
  }
}
