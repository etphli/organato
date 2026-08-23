import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { OrganatoItem } from "@organato/domain";
import { seedItems, seedSettings, seedSubjects } from "../data/seed";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createdAssignment(displayName: string): OrganatoItem {
  const template = seedItems.find((item) => item.kind === "work")!;
  const now = new Date().toISOString();
  return {
    ...template,
    id: "created-assignment",
    version: 1,
    classification: "assignment",
    sourceType: "manual",
    canvasAssignmentId: null,
    canvasCourseId: null,
    canvasHtmlUrl: null,
    sourceName: null,
    sourceDueAt: null,
    sourceUpdatedAt: null,
    sourcePayloadHash: null,
    displayName,
    dueAt: null,
    dueDateLocal: null,
    dueHasExplicitTime: false,
    subjectId: null,
    priority: null,
    archivedAt: null,
    archiveReason: null,
    createdAt: now,
    updatedAt: now,
    overrides: [],
    attachments: [],
    history: [],
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("server-backed item mutations", () => {
  it("uses mutation responses directly when creating and deleting an assignment", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "false");
    const assignment = createdAssignment("Mutation response assignment");
    let createShouldFail = false;
    let holdNextCreate = false;
    let releaseHeldCreate: (() => void) | null = null;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const path = String(input);
        if (path === "/api/items" && init.method === "POST") {
          if (holdNextCreate) {
            holdNextCreate = false;
            return new Promise<Response>((resolve) => {
              releaseHeldCreate = () =>
                resolve(json({ item: assignment }, 201));
            });
          }
          if (createShouldFail) {
            return json({ error: "Assignment service unavailable." }, 503);
          }
          return json({ item: assignment }, 201);
        }
        if (
          path === `/api/items/${assignment.id}/permanent-delete` &&
          init.method === "POST"
        ) {
          return json({ ok: true });
        }
        if (path.startsWith("/api/items?")) return json({ items: [] });
        if (path === "/api/subjects") return json({ subjects: seedSubjects });
        if (path === "/api/settings") return json({ settings: seedSettings });
        if (path === "/api/integrations") return json({ integrations: [] });
        if (path === "/api/views") return json({ views: [] });
        return json({ error: "Unexpected request" }, 500);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const { OrganatoProvider } = await import("../state/OrganatoProvider");
    const { default: WorkPage } = await import("../pages/WorkPage");
    const { Toast } = await import("../components/Toast");

    const rendered = render(
      <MemoryRouter initialEntries={["/assignments"]}>
        <OrganatoProvider>
          <WorkPage page="assignments" />
          <Toast />
        </OrganatoProvider>
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Assignments" });
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Work item name" }), {
      target: { value: assignment.displayName },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create assignment" }));

    expect(await screen.findByText(assignment.displayName)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).startsWith("/api/items?"),
      ),
    ).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("button", {
        name: `Actions for ${assignment.displayName}`,
      }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Delete assignment" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Type delete to confirm assignment deletion",
      }),
      { target: { value: "delete" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete assignment" }));

    await waitFor(() =>
      expect(
        screen.queryByText(assignment.displayName),
      ).not.toBeInTheDocument(),
    );
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).startsWith("/api/items?"),
      ),
    ).toHaveLength(1);

    holdNextCreate = true;
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Work item name" }), {
      target: { value: "Held assignment" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create assignment" }));
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Work item name" }), {
      target: { value: "Concurrent assignment" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create assignment" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) =>
            String(input) === "/api/items" && init?.method === "POST",
        ),
      ).toHaveLength(3),
    );
    expect(releaseHeldCreate).not.toBeNull();
    releaseHeldCreate!();

    createShouldFail = true;
    rendered.unmount();
    render(
      <MemoryRouter initialEntries={["/assignments"]}>
        <OrganatoProvider>
          <WorkPage page="assignments" />
          <Toast />
        </OrganatoProvider>
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Assignments" });
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Work item name" }), {
      target: { value: "Failed assignment" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create assignment" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Assignment service unavailable.",
      ),
    );
    expect(screen.queryByText("Failed assignment")).not.toBeInTheDocument();
  }, 30_000);
});
