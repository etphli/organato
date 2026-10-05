import { Suspense, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prefetchablePage } from "../lib/prefetchablePage";

afterEach(cleanup);
function CounterPage({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount(count + 1)}>
      {label} {count}
    </button>
  );
}

describe("prefetchable page", () => {
  it("shares the hover request and renders a prefetched page without a loading fallback", async () => {
    const load = vi.fn(async () => ({ default: CounterPage }));
    const { Page, preload } = prefetchablePage(load);
    const first = preload();
    expect(preload()).toBe(first);
    await first;
    render(
      <Suspense fallback={<p>Loading page</p>}>
        <Page label="Count" />
      </Suspense>,
    );
    expect(screen.getByRole("button", { name: "Count 0" })).toBeVisible();
    expect(screen.queryByText("Loading page")).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledOnce();
  });
  it("keeps page state after an ordinary lazy load followed by a preload", async () => {
    const { Page, preload } = prefetchablePage(async () => ({
      default: CounterPage,
    }));
    const tree = () => (
      <Suspense fallback={<p>Loading page</p>}>
        <Page label="Count" />
      </Suspense>
    );
    const view = render(tree());
    await act(async () => {
      await preload();
    });
    fireEvent.click(await screen.findByRole("button", { name: "Count 0" }));
    await preload();
    view.rerender(tree());
    expect(screen.getByRole("button", { name: "Count 1" })).toBeVisible();
  });
  it("allows a failed speculative load to retry when opening the page", async () => {
    const load = vi
      .fn<() => Promise<{ default: typeof CounterPage }>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ default: CounterPage });
    const { Page, preload } = prefetchablePage(load);
    await expect(preload()).rejects.toThrow("network");
    render(
      <Suspense fallback={<p>Loading page</p>}>
        <Page label="Count" />
      </Suspense>,
    );
    expect(
      await screen.findByRole("button", { name: "Count 0" }),
    ).toBeVisible();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
