import { useEffect, useRef, type RefObject } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter(
    (element) =>
      !element.hidden &&
      element.getAttribute("aria-hidden") !== "true" &&
      !element.closest("[hidden]"),
  );
}

export function useDialogFocus(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  initialFocusRef: RefObject<HTMLElement | null>,
  focusKey: string,
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || !containerRef.current) return;
    const container = containerRef.current;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const initial =
      initialFocusRef.current ?? focusableElements(container)[0] ?? container;
    initial.focus();

    const containFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = focusableElements(container);
      if (!focusable.length) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !container.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", containFocus);
    return () => {
      container.removeEventListener("keydown", containFocus);
      const previous = previousFocusRef.current;
      if (previous?.isConnected) previous.focus();
    };
  }, [containerRef, focusKey, initialFocusRef, open]);
}
