import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useRef } from "react";
import { DeferredOverlays } from "../components/DeferredOverlays";
import WorkPage from "../pages/WorkPage";
import { seedItems } from "../data/seed";
import {
  OrganatoProvider,
  useOrganatoActions,
  useOrganatoData,
  useOrganatoWorkspace,
} from "../state/OrganatoProvider";

function DataRenderProbe() {
  const { items } = useOrganatoData();
  const { dispatch } = useOrganatoActions();
  const renderCount = Number(
    document.querySelector("[data-render-count]")?.textContent ?? "0",
  );
  return (
    <>
      <output data-render-count>{renderCount + 1}</output>
      <button
        type="button"
        onClick={() => dispatch({ type: "select", id: items[0]?.id ?? null })}
      >
        Select first
      </button>
      <button
        type="button"
        onClick={() => dispatch({ type: "select", id: null })}
      >
        Clear selection
      </button>
    </>
  );
}

function WorkspaceRenderProbe() {
  const { settings } = useOrganatoWorkspace();
  const { dispatch } = useOrganatoActions();
  const renders = useRef(0);
  renders.current += 1;
  return (
    <>
      <output aria-label="Workspace renders">{renders.current}</output>
      <span>{settings.timezone}</span>
      <button
        type="button"
        onClick={() =>
          dispatch({
            type: "patchItem",
            id: seedItems[0]!.id,
            patch: { pinned: true },
          })
        }
      >
        Pin item
      </button>
    </>
  );
}

describe("long-session performance regressions", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("unmounts the Inspector cleanly through repeated open and close cycles", async () => {
    render(
      <MemoryRouter>
        <OrganatoProvider>
          <WorkPage page="assignments" />
          <DeferredOverlays />
        </OrganatoProvider>
      </MemoryRouter>,
    );

    const row = screen.getByText("Group lab report").closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(row!);
    for (let index = 0; index < 10; index += 1) {
      fireEvent.click(
        await screen.findByRole("button", { name: "Close details" }),
      );
      expect(
        screen.queryByRole("dialog", { name: "Details for Group lab report" }),
      ).not.toBeInTheDocument();
      fireEvent.click(row!);
      expect(
        await screen.findByRole("dialog", {
          name: "Details for Group lab report",
        }),
      ).toBeVisible();
    }
  }, 60_000);

  it("opens the global search and command overlays", async () => {
    render(
      <MemoryRouter>
        <OrganatoProvider>
          <WorkPage page="assignments" />
          <DeferredOverlays />
        </OrganatoProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search Organato" }));
    expect(
      await screen.findByRole("dialog", { name: "Search Organato" }),
    ).toBeVisible();
    fireEvent.keyDown(window, { key: "Escape" });

    fireEvent.click(
      screen.getByRole("button", { name: "Open command palette" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Command palette" }),
    ).toBeVisible();
  });

  it("does not rerender data-only consumers when selection changes", () => {
    render(
      <OrganatoProvider>
        <DataRenderProbe />
      </OrganatoProvider>,
    );

    const count = screen.getByText("1");
    for (let index = 0; index < 25; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Select first" }));
      fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    }
    expect(count).toHaveTextContent("1");
  });

  it("does not rerender workspace-only consumers for item mutations", () => {
    render(
      <OrganatoProvider>
        <WorkspaceRenderProbe />
      </OrganatoProvider>,
    );

    const count = screen.getByLabelText("Workspace renders");
    for (let index = 0; index < 25; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Pin item" }));
    }
    expect(count).toHaveTextContent("1");
  });
});
