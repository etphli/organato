import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App";
import { OrganatoProvider } from "../state/OrganatoProvider";

describe("primary navigation lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(cleanup);

  it("keeps routing in-app through more than 20 consecutive clicks", () => {
    render(
      <MemoryRouter>
        <OrganatoProvider>
          <App />
        </OrganatoProvider>
      </MemoryRouter>,
    );

    const destinations = [
      { name: "Assignments", heading: "Assignments" },
      { name: "Checkpoints", heading: "Checkpoints" },
      { name: "Calendar", heading: "Calendar" },
      { name: "Todo", heading: "Todo" },
      { name: "Home", heading: "Home" },
    ];

    for (let index = 0; index < 25; index += 1) {
      const destination = destinations[index % destinations.length]!;
      fireEvent.click(
        screen.getAllByRole("link", { name: destination.name })[0]!,
      );
      expect(
        screen.getByRole("heading", { name: destination.heading }),
      ).toBeVisible();
    }
  }, 60_000);
});
