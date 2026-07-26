import type {
  CalendarChangePage,
  CalendarEventProjection,
  CalendarEventRecord,
  CanvasProvider,
  CanvasSyncResult,
  EmailMessage,
  EmailProvider,
  GoogleCalendarProvider,
} from "./contracts";

export class FakeCanvasProvider implements CanvasProvider {
  constructor(private readonly result: CanvasSyncResult) {}
  async validateConnection() {
    return {
      id: "fake-user",
      name: "Alex Smith",
      hostname: "canvas.example.edu",
    };
  }
  async fetchUpcomingAssignments(): Promise<CanvasSyncResult> {
    return structuredClone(this.result);
  }
}

export class FakeGoogleCalendarProvider implements GoogleCalendarProvider {
  readonly events = new Map<string, CalendarEventRecord>();
  async ensureOrganatoCalendar(storedCalendarId?: string) {
    return storedCalendarId ?? "organato-calendar";
  }
  async upsertEvent(
    _calendarId: string,
    projection: CalendarEventProjection,
    existingEventId?: string,
  ) {
    const id = existingEventId ?? `event-${projection.itemId}`;
    const event: CalendarEventRecord = {
      id,
      etag: `"${projection.itemVersion}"`,
      status: "confirmed",
      updated: new Date().toISOString(),
      summary: projection.summary,
      description: projection.description,
      start: projection.start,
      extendedProperties: { private: projection.privateProperties },
    };
    this.events.set(id, event);
    return event;
  }
  async deleteEvent(_calendarId: string, eventId: string) {
    this.events.delete(eventId);
  }
  async listChanges(): Promise<CalendarChangePage> {
    return {
      events: [...this.events.values()],
      nextSyncToken: "fake-sync-token",
    };
  }
}

export class FakeEmailProvider implements EmailProvider {
  readonly messages: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.messages.push(structuredClone(message));
    return { messageId: `fake-message-${this.messages.length}` };
  }
}
