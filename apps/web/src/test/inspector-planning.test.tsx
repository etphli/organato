import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { Inspector } from "../components/Inspector";
import {
  OrganatoProvider,
  useOrganatoActions,
} from "../state/OrganatoProvider";
import { seedItems, seedSettings } from "../data/seed";
import { useEffect } from "react";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Inspector planning sections", () => {
  it("shows checklist, dependencies, and effort controls", async () => {
    const target = seedItems.find((item) => item.kind === "work")!;
    localStorage.setItem(
      "organato-demo-state-v1",
      JSON.stringify({
        items: [
          {
            ...target,
            subtasks: [
              {
                id: "sub-1",
                title: "Draft",
                completed: true,
                sortRank: 0,
                createdAt: target.createdAt,
                updatedAt: target.createdAt,
              },
            ],
            links: { blockedBy: [], blocking: [] },
          },
        ],
        subjects: [],
        settings: seedSettings,
        views: [],
      }),
    );

    function SelectProbe() {
      const { dispatch } = useOrganatoActions();
      useEffect(() => {
        dispatch({ type: "select", id: target.id });
      }, [dispatch]);
      return null;
    }

    render(
      <MemoryRouter>
        <OrganatoProvider>
          <SelectProbe />
          <Inspector />
        </OrganatoProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("Checklist")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Checklist progress" }),
    ).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByLabelText("Dependencies")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Estimated effort in minutes"),
    ).toBeInTheDocument();
  });
});
