import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { OrganatoProvider } from "../state/OrganatoProvider";
import HomePage from "../pages/HomePage";

describe("Home", () => {
  it("keeps new Canvas work visible for classification", () => {
    localStorage.clear();
    render(
      <MemoryRouter>
        <OrganatoProvider>
          <HomePage />
        </OrganatoProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("3 items to classify")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Both" })).toBeInTheDocument();
  });
});
