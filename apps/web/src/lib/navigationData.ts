type NavigationDataPath = "/api/identities" | "/api/sessions";
const prefetchLifetimeMs = 10_000;
const pending = new Map<
  NavigationDataPath,
  {
    expiresAt: number;
    csrfToken: string | null;
    response: Promise<Response | null>;
  }
>();

function freshEntry(path: NavigationDataPath) {
  const entry = pending.get(path);
  if (
    entry &&
    entry.expiresAt > Date.now() &&
    entry.csrfToken === sessionStorage.getItem("organato_csrf")
  )
    return entry;
  pending.delete(path);
  return undefined;
}

export function prefetchAccountData(): void {
  if (import.meta.env.VITE_DEMO_MODE === "true" || !navigator.onLine) return;
  for (const path of [
    "/api/identities",
    "/api/sessions",
  ] satisfies NavigationDataPath[]) {
    if (freshEntry(path)) continue;
    const response = fetch(path, {
      credentials: "same-origin",
      signal: AbortSignal.timeout(prefetchLifetimeMs),
    }).then(
      (result) => (result.ok ? result : null),
      () => null,
    );
    pending.set(path, {
      expiresAt: Date.now() + prefetchLifetimeMs,
      csrfToken: sessionStorage.getItem("organato_csrf"),
      response,
    });
  }
}

export async function requestNavigationData(
  path: NavigationDataPath,
): Promise<Response> {
  const entry = freshEntry(path);
  pending.delete(path);
  const response = await entry?.response;
  return response ?? fetch(path, { credentials: "same-origin" });
}
