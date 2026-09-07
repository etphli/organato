import { reportClientDiagnostic } from "../../clientDiagnostics";

export interface CanvasRfbSession {
  disconnect(): void;
  focus?(): void;
  sendKey?(keysym: number, code: string, down?: boolean): void;
}

export type CanvasRfbFactory = (
  target: HTMLElement,
  url: string,
  options?: { signal: AbortSignal; onDisconnect: () => void },
) => Promise<CanvasRfbSession>;

const mobileSpecialKeys: Record<string, { code: string; keysym: number }> = {
  ArrowDown: { code: "ArrowDown", keysym: 0xff54 },
  ArrowLeft: { code: "ArrowLeft", keysym: 0xff51 },
  ArrowRight: { code: "ArrowRight", keysym: 0xff53 },
  ArrowUp: { code: "ArrowUp", keysym: 0xff52 },
  Backspace: { code: "Backspace", keysym: 0xff08 },
  Delete: { code: "Delete", keysym: 0xffff },
  Enter: { code: "Enter", keysym: 0xff0d },
  Escape: { code: "Escape", keysym: 0xff1b },
  Tab: { code: "Tab", keysym: 0xff09 },
};

function mobileCharacterCode(character: string): string {
  if (/^[a-z]$/i.test(character)) return `Key${character.toUpperCase()}`;
  if (/^[0-9]$/.test(character)) return `Digit${character}`;

  const punctuationCodes: Record<string, string> = {
    "`": "Backquote",
    "-": "Minus",
    "=": "Equal",
    "[": "BracketLeft",
    "]": "BracketRight",
    "\\": "Backslash",
    ";": "Semicolon",
    "'": "Quote",
    ",": "Comma",
    ".": "Period",
    "/": "Slash",
  };

  return punctuationCodes[character] ?? "Unidentified";
}

export function forwardMobileText(
  session: CanvasRfbSession | null,
  text: string,
): void {
  if (!session?.sendKey) return;

  for (const character of text) {
    const keysym = character.codePointAt(0);
    if (keysym !== undefined) {
      session.sendKey(keysym, mobileCharacterCode(character));
    }
  }
}

export function forwardMobileSpecialKey(
  session: CanvasRfbSession | null,
  keyName: string,
): boolean {
  const key = mobileSpecialKeys[keyName];
  if (!key) return false;

  session?.sendKey?.(key.keysym, key.code);
  return true;
}

export async function defaultRfbFactory(
  target: HTMLElement,
  url: string,
  options?: { signal: AbortSignal; onDisconnect: () => void },
): Promise<CanvasRfbSession> {
  const { default: RFB } = await import("@novnc/novnc");
  options?.signal.throwIfAborted();
  const rfb = new RFB(target, url);
  rfb.scaleViewport = true;
  rfb.resizeSession = false;
  rfb.showDotCursor = true;
  return new Promise((resolve, reject) => {
    let connected = false;
    let stopped = false;
    let layoutTimer: number | undefined;
    const report = (stage: string) => {
      const canvas = target.querySelector("canvas");
      reportClientDiagnostic("canvas_viewer", {
        stage,
        width: target.clientWidth,
        height: target.clientHeight,
        canvasWidth: canvas?.width ?? 0,
        canvasHeight: canvas?.height ?? 0,
        renderedWidth: canvas?.getBoundingClientRect().width ?? 0,
        renderedHeight: canvas?.getBoundingClientRect().height ?? 0,
      });
    };
    const stop = () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearTimeout(layoutTimer);
      options?.signal.removeEventListener("abort", abort);
      rfb.disconnect();
    };
    const fail = (stage: string) => {
      if (stopped) return;
      report(stage);
      stop();
      if (connected) options?.onDisconnect();
      else reject(new Error("The Pi display connection failed. Reconnecting…"));
    };
    const abort = () => {
      stop();
      reject(new DOMException("Viewer closed", "AbortError"));
    };
    const timer = window.setTimeout(() => fail("handshake_timeout"), 20_000);
    options?.signal.addEventListener("abort", abort, { once: true });
    rfb.addEventListener("connect", () => {
      if (stopped) return;
      connected = true;
      window.clearTimeout(timer);
      report("connected");
      layoutTimer = window.setTimeout(() => report("display_layout"), 1_000);
      resolve({
        disconnect: stop,
        focus: () => rfb.focus(),
        sendKey: (keysym, code, down) => rfb.sendKey(keysym, code, down),
      });
    });
    rfb.addEventListener("disconnect", () => fail("disconnected"));
    rfb.addEventListener("securityfailure", () => fail("security_failure"));
    rfb.addEventListener("credentialsrequired", () =>
      fail("unexpected_credentials"),
    );
    report("connecting");
  });
}
