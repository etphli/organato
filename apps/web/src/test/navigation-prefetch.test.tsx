import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { OrganatoProvider } from "../state/OrganatoProvider";

const { prefetchRoute } = vi.hoisted(() => ({ prefetchRoute: vi.fn() }));
vi.mock("../lib/routeModules", () => ({
  prefetchRoute,
  warmSidebarRoutes: () => () => undefined,
}));

beforeEach(() => {
  localStorage.clear();
  prefetchRoute.mockClear();
});
afterEach(cleanup);

function mount() {
  render(
    <MemoryRouter>
      <OrganatoProvider>
        <AppShell>
          <h1>Current page</h1>
        </AppShell>
      </OrganatoProvider>
    </MemoryRouter>,
  );
}

describe("navigation prefetch", () => {
  it("preloads the destination on sidebar hover without navigating", () => {
    mount();
    fireEvent.mouseEnter(
      screen.getAllByRole("link", { name: "Assignments" })[0]!,
    );
    expect(prefetchRoute).toHaveBeenCalledWith("/assignments");
    expect(screen.getByRole("heading", { name: "Current page" })).toBeVisible();
  });
  it("preloads for keyboard focus and touch in the mobile navigation", () => {
    mount();
    fireEvent.focus(screen.getAllByRole("link", { name: "Calendar" })[0]!);
    fireEvent.touchStart(screen.getAllByRole("link", { name: "Todo" })[1]!);
    expect(prefetchRoute).toHaveBeenCalledWith("/calendar");
    expect(prefetchRoute).toHaveBeenCalledWith("/todo");
  });
  it("preloads account settings from both account links", () => {
    mount();
    fireEvent.mouseEnter(screen.getByRole("link", { name: "Owner Settings" }));
    fireEvent.focus(
      screen.getByRole("link", { name: "Open Settings for Owner" }),
    );
    expect(prefetchRoute).toHaveBeenCalledWith("/settings");
    expect(prefetchRoute).toHaveBeenCalledTimes(2);
  });
});
