declare module "@novnc/novnc" {
  export default class RFB {
    constructor(target: HTMLElement, url: string);
    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    disconnect(): void;
    focus(): void;
    sendKey(keysym: number, code: string, down?: boolean): void;
  }
}
