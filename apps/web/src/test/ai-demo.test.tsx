import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiQuickAdd } from "../components/ai/AiQuickAdd";
import { AiBreakdown } from "../components/ai/AiBreakdown";
import { AiNextAction } from "../components/ai/AiNextAction";
import {
  OrganatoProvider,
  useOrganatoData,
  useOrganatoActions,
} from "../state/OrganatoProvider";
import { MemoryRouter } from "react-router-dom";
import { CommandPalette } from "../components/CommandPalette";
import { CreateWorkForm } from "../pages/CreateWorkForm";

function CreationFlow({ dialog = false }: { dialog?: boolean }) {
  const { items, subjects, settings } = useOrganatoData();
  const { dispatch } = useOrganatoActions();
  return (
    <>
      <button onClick={() => dispatch({ type: "command", open: true })}>
        Open commands
      </button>
      <CommandPalette />
      {dialog ? (
        <CreateWorkForm
          subjects={subjects}
          settings={settings}
          timezone={settings.timezone}
          onCancel={() => {}}
          onCreate={(item) => dispatch({ type: "addWork", ...item })}
        />
      ) : null}
      <ul aria-label="Created items">
        {items.map((item) => (
          <li key={item.id}>
            {item.kind}: {item.displayName}
          </li>
        ))}
      </ul>
    </>
  );
}

function DemoFlow() {
  const { items } = useOrganatoData();
  const assignment = items.find((item) => item.id === "essay");
  return (
    <>
      <AiQuickAdd />
      <AiNextAction />
      {assignment ? <AiBreakdown item={assignment} /> : null}
      <ul aria-label="Saved demo tasks">
        {items.map((item) => (
          <li key={item.id}>
            {item.displayName}
            {item.subtasks.map((step) => (
              <span key={step.id}>{step.title}</span>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("AI demo review flows", () => {
  it("detects an assignment from command-palette text and saves only after review", async () => {
    render(
      <MemoryRouter>
        <OrganatoProvider>
          <CreationFlow />
        </OrganatoProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Open commands"));
    const input = screen.getByRole("combobox", {
      name: "Command palette — type to filter commands",
    });
    fireEvent.change(input, {
      target: { value: "English essay assignment tomorrow at 5pm" },
    });
    fireEvent.keyDown(input, { key: "Enter" });
    const destination = await screen.findByLabelText("Save to");
    expect(destination).toHaveValue("work");
    expect(
      screen.getByRole("list", { name: "Created items" }),
    ).not.toHaveTextContent("English essay assignment");
    fireEvent.click(screen.getByRole("button", { name: "Save assignment" }));
    await waitFor(() =>
      expect(
        screen.getByRole("list", { name: "Created items" }),
      ).toHaveTextContent("work: English essay assignment"),
    );
    expect(
      screen.queryByRole("dialog", { name: "Command palette" }),
    ).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("detects a todo and allows correcting the destination before saving", async () => {
    render(
      <MemoryRouter>
        <OrganatoProvider>
          <CreationFlow />
        </OrganatoProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Open commands"));
    const input = screen.getByRole("combobox", {
      name: "Command palette — type to filter commands",
    });
    fireEvent.change(input, {
      target: { value: "Read chapter four tomorrow" },
    });
    fireEvent.keyDown(input, { key: "Enter" });
    const destination = await screen.findByLabelText("Save to");
    expect(destination).toHaveValue("todo");
    fireEvent.change(destination, { target: { value: "work" } });
    fireEvent.click(screen.getByRole("button", { name: "Save assignment" }));
    await waitFor(() =>
      expect(
        screen.getByRole("list", { name: "Created items" }),
      ).toHaveTextContent("work: Read chapter four"),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("offers natural assignment entry in New without replacing the manual form", async () => {
    render(
      <MemoryRouter>
        <OrganatoProvider>
          <CreationFlow dialog />
        </OrganatoProvider>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("Work item name")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Describe it naturally" }),
    );
    expect(screen.queryByLabelText("Work item name")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("What needs doing?"), {
      target: { value: "Read chapter six tomorrow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview assignment" }));
    expect(await screen.findByLabelText("Save to")).toHaveValue("work");
    fireEvent.click(screen.getByRole("button", { name: "Save assignment" }));
    await waitFor(() =>
      expect(
        screen.getByRole("list", { name: "Created items" }),
      ).toHaveTextContent("work: Read chapter six"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Enter details" }));
    expect(screen.getByLabelText("Work item name")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("previews and edits a natural todo before saving with no network requests", async () => {
    render(
      <OrganatoProvider>
        <DemoFlow />
      </OrganatoProvider>,
    );
    const panel = screen.getByRole("region", { name: "Natural-language todo" });
    fireEvent.change(within(panel).getByLabelText("What needs doing?"), {
      target: {
        value: "Finish my English draft tomorrow at 5pm, high priority",
      },
    });
    fireEvent.click(
      within(panel).getByRole("button", { name: "Preview todo" }),
    );
    const title = await within(panel).findByLabelText("Title");
    expect(
      screen.getByRole("list", { name: "Saved demo tasks" }),
    ).not.toHaveTextContent("Finish my English draft");
    expect(within(panel).getByLabelText("Time")).toHaveValue("17:00");
    fireEvent.change(title, { target: { value: "My edited English draft" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Save todo" }));
    await waitFor(() =>
      expect(
        screen.getByRole("list", { name: "Saved demo tasks" }),
      ).toHaveTextContent("My edited English draft"),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("adds only selected edited steps and preserves the assignment", async () => {
    render(
      <OrganatoProvider>
        <DemoFlow />
      </OrganatoProvider>,
    );
    const panel = screen.getByRole("region", { name: "Assignment breakdown" });
    fireEvent.click(
      within(panel).getByRole("button", { name: "Suggest steps" }),
    );
    const first = await within(panel).findByLabelText("Step 1 title");
    fireEvent.change(first, { target: { value: "Read my teacher's rubric" } });
    fireEvent.click(within(panel).getByLabelText("Include step 2"));
    fireEvent.click(
      within(panel).getByRole("button", { name: "Add selected steps" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("list", { name: "Saved demo tasks" }),
      ).toHaveTextContent("Read my teacher's rubric"),
    );
    expect(
      screen.getByRole("list", { name: "Saved demo tasks" }),
    ).not.toHaveTextContent("Collect evidence and make an outline");
    expect(
      screen.getByRole("list", { name: "Saved demo tasks" }),
    ).toHaveTextContent("Comparative essay draft");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("generates a bounded next action and discards a draft without saving", async () => {
    render(
      <OrganatoProvider>
        <DemoFlow />
      </OrganatoProvider>,
    );
    const next = screen.getByRole("region", { name: "What to do next" });
    fireEvent.change(within(next).getByLabelText("Time available"), {
      target: { value: "15" },
    });
    fireEvent.click(
      within(next).getByRole("button", { name: "Suggest next action" }),
    );
    expect(
      await within(next).findByText(/about 15 minutes/),
    ).toBeInTheDocument();
    expect(
      within(next).getByRole("button", { name: "Open task" }),
    ).toBeInTheDocument();
    const quick = screen.getByRole("region", { name: "Natural-language todo" });
    fireEvent.change(within(quick).getByLabelText("What needs doing?"), {
      target: { value: "Unwanted draft tomorrow" },
    });
    fireEvent.click(
      within(quick).getByRole("button", { name: "Preview todo" }),
    );
    fireEvent.click(
      await within(quick).findByRole("button", { name: "Discard" }),
    );
    expect(
      screen.getByRole("list", { name: "Saved demo tasks" }),
    ).not.toHaveTextContent("Unwanted draft");
    expect(fetch).not.toHaveBeenCalled();
  });
});
