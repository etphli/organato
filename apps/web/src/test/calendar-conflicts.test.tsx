import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarConflicts } from "../components/settings/CalendarConflicts";
const calls = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
  resolve: vi.fn<(id: string, strategy: string) => Promise<void>>(
    async () => {},
  ),
  load: vi.fn(),
}));
vi.mock("../state/OrganatoProvider", () => ({
  useOrganatoActions: () => ({ refresh: calls.refresh }),
}));
vi.mock("../lib/integrationApi", () => ({
  integrationRequest: (...args: unknown[]) => calls.load(...args),
  resolveCalendarConflict: (id: string, strategy: string) =>
    calls.resolve(id, strategy),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
describe("Calendar conflicts settings", () => {
  it("shows completed conflicts and removes them only after resolution succeeds", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "false");
    calls.load
      .mockResolvedValueOnce({
        conflicts: [
          {
            id: "completed",
            title: "Science test",
            dueAt: null,
            dueDateLocal: "2026-07-30",
            workingStatus: "submitted",
            archivedAt: null,
          },
        ],
      })
      .mockResolvedValue({ conflicts: [] });
    render(
      <MemoryRouter>
        <CalendarConflicts />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Science test")).toBeInTheDocument();
    expect(screen.getByText(/Organato date:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep Organato" }));
    await waitFor(() =>
      expect(calls.resolve).toHaveBeenCalledWith("completed", "mine"),
    );
    expect(
      await screen.findByText("No calendar conflicts."),
    ).toBeInTheDocument();
    expect(calls.refresh).toHaveBeenCalledOnce();
  });
  it("keeps a failed conflict visible and offers retry", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "false");
    calls.load.mockResolvedValue({
      conflicts: [
        {
          id: "item",
          title: "Math",
          dueAt: null,
          dueDateLocal: null,
          workingStatus: "submitted",
          archivedAt: null,
        },
      ],
    });
    calls.resolve.mockRejectedValueOnce(new Error("Google unavailable"));
    render(
      <MemoryRouter>
        <CalendarConflicts />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Use Google" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Google unavailable",
    );
    expect(screen.getByText("Math")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Google" })).toBeEnabled();
  });
});
