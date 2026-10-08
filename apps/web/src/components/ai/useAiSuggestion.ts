import { useCallback, useEffect, useRef, useState } from "react";
import { aiDemoMode } from "../../lib/ai";
import { integrationRequest } from "../../lib/integrationApi";

type SuggestionState<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; value: T }
  | { kind: "error"; message: string };

export function useAiSuggestion<T>() {
  const [state, setState] = useState<SuggestionState<T>>({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const clear = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setState({ kind: "idle" });
  }, []);
  const generate = async (operation: (signal: AbortSignal) => Promise<T>) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ kind: "loading" });
    try {
      const value = await operation(current.signal);
      if (!current.signal.aborted) setState({ kind: "ready", value });
    } catch (error) {
      if (!current.signal.aborted)
        setState({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "AI is unavailable. Try again or continue manually.",
        });
    }
  };
  const edit = (update: (value: T) => T) =>
    setState((current) =>
      current.kind === "ready"
        ? { kind: "ready", value: update(current.value) }
        : current,
    );
  return { state, generate, clear, edit };
}

export function useAiAvailable() {
  const [available, setAvailable] = useState(aiDemoMode);
  useEffect(() => {
    if (aiDemoMode) return;
    const controller = new AbortController();
    void integrationRequest<unknown>("/api/ai/status", {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted)
          setAvailable(
            Boolean(
              result &&
              typeof result === "object" &&
              "enabled" in result &&
              result.enabled === true,
            ),
          );
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return available;
}
