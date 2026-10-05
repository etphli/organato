import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedItems, seedSettings } from "../data/seed";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

describe("item detail caching", () => {
  it("reuses several items, shares pending requests, and invalidates after refresh", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "false");
    let version = 1;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/api/items?"))
        return json({
          items: seedItems.slice(0, 2).map((item) => ({ ...item, version })),
        });
      if (path.startsWith("/api/items/"))
        return json({
          item: {
            ...seedItems.find((item) => path.endsWith(item.id)),
            version,
            notesMarkdown: `Details version ${version}`,
          },
        });
      return json(
        path === "/api/settings"
          ? { settings: seedSettings }
          : path === "/api/subjects"
            ? { subjects: [] }
            : path === "/api/views"
              ? { views: [] }
              : { integrations: [] },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const { OrganatoProvider, useOrganatoActions, useOrganatoUi } =
      await import("../state/OrganatoProvider");
    function Probe() {
      const { dispatch, refresh } = useOrganatoActions();
      const { selectedItem } = useOrganatoUi();
      return (
        <>
          <button
            onClick={() => dispatch({ type: "select", id: seedItems[0]!.id })}
          >
            First
          </button>
          <button
            onClick={() => dispatch({ type: "select", id: seedItems[1]!.id })}
          >
            Second
          </button>
          <button onClick={() => void refresh()}>Refresh</button>
          <p>{selectedItem?.notesMarkdown}</p>
        </>
      );
    }
    render(
      <OrganatoProvider>
        <Probe />
      </OrganatoProvider>,
    );
    await screen.findByRole("button", { name: "First" });
    for (const label of ["First", "Second", "First", "Second"]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      await screen.findByText("Details version 1");
      await act(async () => {});
    }
    const details = () =>
      fetchMock.mock.calls.filter(([path]) =>
        String(path).startsWith("/api/items/"),
      );
    expect(details()).toHaveLength(2);
    version = 2;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Details version 2")).toBeVisible();
    await waitFor(() => expect(details()).toHaveLength(3));
  });
});
