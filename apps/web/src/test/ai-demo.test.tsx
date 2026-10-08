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
import { OrganatoProvider, useOrganatoData } from "../state/OrganatoProvider";

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
