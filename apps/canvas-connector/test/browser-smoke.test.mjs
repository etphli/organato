/* global process, URL */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CanvasBrowserAdapter } from "../src/canvas-browser.mjs";

async function chromiumPath() {
  const candidates = [
    process.env.CHROMIUM_EXECUTABLE_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next supported installation path.
    }
  }
  return null;
}

const executable = await chromiumPath();
const smokeEnabled =
  process.env.ORGANATO_CANVAS_SMOKE === "1" &&
  Boolean(process.env.DISPLAY) &&
  Boolean(executable);

test(
  "optional public Canvas login smoke opens the real browser without credentials",
  { skip: !smokeEnabled, timeout: 45_000 },
  async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "organato-canvas-smoke-"),
    );
    const adapter = new CanvasBrowserAdapter({
      canvasBaseUrl: "https://emanuel.instructure.com",
      profileDir: directory,
      executablePath: executable,
      display: process.env.DISPLAY,
    });
    try {
      await adapter.openLogin();
      assert.ok(adapter.page);
      assert.equal(new URL(adapter.page.url()).protocol, "https:");
    } finally {
      await adapter.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
);
