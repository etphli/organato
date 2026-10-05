import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedItems, seedSettings, seedSubjects, seedViews } from "../data/seed";

const cache = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("../lib/workspaceCache", () => ({
  loadWorkspaceCache: cache.load,
  saveWorkspaceCache: cache.save,
  clearWorkspaceCache: cache.clear,
}));
vi.mock("../components/AuthGate", () => ({
  useAuthOwner: () => ({
    email: "bench@example.com",
    workspaceId: "workspace-one",
  }),
}));

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubEnv("VITE_DEMO_MODE", "false");
  cache.load.mockResolvedValue({
    version: 1,
    exportedAt: new Date().toISOString(),
    items: [seedItems[0]],
    subjects: seedSubjects,
    settings: seedSettings,
    savedViews: seedViews,
  });
  cache.save.mockResolvedValue(undefined);
  cache.clear.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

async function workspace(items: Promise<Response>, patch?: Promise<Response>) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = String(input);
      if (init.method === "PATCH" && patch) return patch;
      if (path.startsWith("/api/items?")) return (await items).clone();
      return json(
        path === "/api/subjects"
          ? { subjects: seedSubjects }
          : path === "/api/settings"
            ? { settings: seedSettings }
            : path === "/api/views"
              ? { views: seedViews }
              : { integrations: [] },
      );
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const {
    OrganatoProvider,
    useOrganatoData,
    useOrganatoActions,
    useOrganatoUi,
  } = await import("../state/OrganatoProvider");
  function Probe() {
    const { items } = useOrganatoData();
    const { dispatch } = useOrganatoActions();
    const { toast } = useOrganatoUi();
    return (
      <>
        <input aria-label="Filter" defaultValue="kept filter" />
        <p>{items.map((item) => item.displayName).join(",")}</p>
        <p>{toast}</p>
        <button
          onClick={() =>
            dispatch({
              type: "patchItem",
              id: seedItems[0]!.id,
              patch: { displayName: "Local edit" },
            })
          }
        >
          Edit
        </button>
      </>
    );
  }
  render(
    <OrganatoProvider>
      <Probe />
    </OrganatoProvider>,
  );
  return fetchMock;
}

describe("saved workspace hydration", () => {
  it("opens saved items while the server is pending and updates without remounting the page", async () => {
    const server = deferred<Response>();
    await workspace(server.promise);
    expect(await screen.findByText(seedItems[0]!.displayName)).toBeVisible();
    expect(cache.load).toHaveBeenCalledWith("bench@example.com:workspace-one");
    const input = screen.getByRole("textbox", { name: "Filter" });
    input.focus();
    fireEvent.change(input, { target: { value: "my filter" } });
    await act(async () =>
      server.resolve(
        json({
          items: [
            { ...seedItems[0], version: 2, displayName: "Server revision" },
          ],
        }),
      ),
    );
    expect(await screen.findByText("Server revision")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Filter" })).toBe(input);
    expect(input).toHaveValue("my filter");
    expect(input).toHaveFocus();
    await waitFor(() => expect(cache.save).toHaveBeenCalled());
    expect(cache.save.mock.lastCall?.[1].items[0].displayName).toBe(
      "Server revision",
    );
  });

  it("keeps the saved view available if revalidation fails", async () => {
    const server = deferred<Response>();
    await workspace(server.promise);
    await screen.findByText(seedItems[0]!.displayName);
    await act(async () => server.resolve(new Response("{}", { status: 503 })));
    expect(
      await screen.findByText(/Showing saved workspace data/),
    ).toBeVisible();
    expect(screen.getByText(seedItems[0]!.displayName)).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(cache.save).not.toHaveBeenCalled();
  });

  it("does not let a pre-edit response overwrite an optimistic edit", async () => {
    const server = deferred<Response>();
    const patch = deferred<Response>();
    await workspace(server.promise, patch.promise);
    await screen.findByText(seedItems[0]!.displayName);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Local edit")).toBeVisible();
    await act(async () => server.resolve(json({ items: [seedItems[0]] })));
    expect(screen.getByText("Local edit")).toBeVisible();
    expect(cache.clear).toHaveBeenCalled();
    expect(cache.save).not.toHaveBeenCalled();
    await act(async () =>
      patch.resolve(
        json({
          item: { ...seedItems[0], version: 2, displayName: "Local edit" },
        }),
      ),
    );
    // The retry receives the same older fixture response: preserve newer confirmed versions.
    await waitFor(() => expect(cache.save).toHaveBeenCalled());
    expect(screen.getByText("Local edit")).toBeVisible();
    expect(cache.save.mock.lastCall?.[1].items[0].displayName).toBe(
      "Local edit",
    );
  });
});
