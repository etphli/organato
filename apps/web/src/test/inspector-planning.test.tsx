import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
  it("refreshes untouched focused notes and preserves notes being edited", async () => {
    const target = seedItems[0]!;
    let update: ((notesMarkdown: string) => void) | undefined;
    function LiveUpdates() {
      const { dispatch } = useOrganatoActions();
      useEffect(() => {
        dispatch({ type: "select", id: target.id });
        update = (notesMarkdown) =>
          dispatch({
            type: "replaceItem",
            item: { ...target, version: 2, notesMarkdown },
          });
      }, [dispatch]);
      return null;
    }
    render(
      <MemoryRouter>
        <OrganatoProvider>
          <LiveUpdates />
          <Inspector />
        </OrganatoProvider>
      </MemoryRouter>,
    );
    const notes = await screen.findByPlaceholderText("Add notes in Markdown…");
    act(() => notes.focus());
    act(() => update?.("Latest server notes"));
    expect(notes).toHaveValue("Latest server notes");
    fireEvent.change(notes, { target: { value: "My unsaved notes" } });
    act(() => update?.("Another server revision"));
    expect(notes).toHaveValue("My unsaved notes");
    expect(notes).toHaveFocus();
  });

  it("keeps a focused name draft through a server update and resets it for another item", async () => {
    const target = seedItems[0]!;
    const next = seedItems[1]!;
    let update: (() => void) | undefined;
    let selectNext: (() => void) | undefined;
    function LiveUpdates() {
      const { dispatch } = useOrganatoActions();
      useEffect(() => {
        dispatch({ type: "select", id: target.id });
        update = () =>
          dispatch({
            type: "replaceItem",
            item: { ...target, version: 2, displayName: "Server revision" },
          });
        selectNext = () => dispatch({ type: "select", id: next.id });
      }, [dispatch]);
      return null;
    }
    render(
      <MemoryRouter>
        <OrganatoProvider>
          <LiveUpdates />
          <Inspector />
        </OrganatoProvider>
      </MemoryRouter>,
    );
    const name = await screen.findByRole("textbox", { name: "Item name" });
    act(() => name.focus());
    act(() => update?.());
    expect(name).toHaveValue("Server revision");
    fireEvent.change(name, { target: { value: "My unsaved name" } });
    act(() => update?.());
    expect(name).toHaveValue("My unsaved name");
    expect(name).toHaveFocus();
    act(() => selectNext?.());
    expect(name).toHaveValue(next.displayName);
  });

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

  it("keeps item actions in the header menu, not a manage section", async () => {
    const target = seedItems.find((item) => item.kind === "work")!;
    localStorage.setItem(
      "organato-demo-state-v1",
      JSON.stringify({
        items: [
          { ...target, subtasks: [], links: { blockedBy: [], blocking: [] } },
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

    expect(await screen.findByLabelText("Item actions")).toBeInTheDocument();
    expect(screen.queryByText("Pin to top")).toBeNull();
    expect(screen.queryByText("Duplicate")).toBeNull();
    fireEvent.click(screen.getByLabelText("Item actions"));
    expect(
      screen.getByRole("menuitem", { name: "Duplicate" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Pin to top" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Delete forever…" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Manage archive in Settings")).toBeInTheDocument();
  });
});
