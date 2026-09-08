#!/usr/bin/env node
/* global process */

import { ConnectorService } from "./service.mjs";
import { parseSsoAllowlist } from "./protocol.mjs";
import { DEFAULT_STATE_DIR, DurableState } from "./state.mjs";

function logger(event) {
  process.stdout.write(
    `${JSON.stringify({ at: new Date().toISOString(), event })}\n`,
  );
}

async function run() {
  const state = new DurableState(
    process.env.ORGANATO_STATE_DIR || DEFAULT_STATE_DIR,
  );
  const apiBase = process.env.ORGANATO_API_BASE;
  const service = new ConnectorService({
    state,
    ...(apiBase ? { apiBase } : {}),
    ssoAllowlist: parseSsoAllowlist(process.env.CANVAS_SSO_ALLOWLIST || ""),
    // The browser profile is part of the connector's owned state. Do not allow
    // an environment override that revocation could fail to erase.
    profileDir: state.profileDir,
    chromiumPath: process.env.CHROMIUM_EXECUTABLE_PATH,
    display: process.env.DISPLAY || ":99",
    vncPort: Number(process.env.ORGANATO_VNC_PORT || 5900),
    logger,
  });
  const stop = () => {
    void service.stop().finally(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  await service.start();
}

if (process.argv[2] !== "run") {
  process.stderr.write("Usage: node src/index.mjs run\n");
  process.exitCode = 2;
} else {
  run().catch((error) => {
    if (error?.message === "not_paired") logger("not_paired");
    else logger("startup_failed");
    process.exitCode = 1;
  });
}

export { run };
