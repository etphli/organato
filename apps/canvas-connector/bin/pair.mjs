#!/usr/bin/env node
import readline from "node:readline/promises";
import process from "node:process";

import { pairDevice } from "../src/client.mjs";
import { DEFAULT_API_BASE, ProtocolError } from "../src/protocol.mjs";
import { DurableState, DEFAULT_STATE_DIR } from "../src/state.mjs";

const input = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

try {
  const code = await input.question("Pairing code: ");
  const defaultName = "Organato Pi";
  const enteredName = await input.question(`Device name [${defaultName}]: `);
  const name = enteredName.trim() || defaultName;
  const state = await new DurableState(
    process.env.ORGANATO_STATE_DIR || DEFAULT_STATE_DIR,
  ).init();
  const paired = await pairDevice({
    apiBase: process.env.ORGANATO_API_BASE || DEFAULT_API_BASE,
    code,
    name,
    state,
  });
  process.stdout.write(
    `Paired to ${paired.canvasBaseUrl}. The device credential was saved locally.\n`,
  );
} catch (error) {
  if (error instanceof ProtocolError)
    process.stderr.write("Pairing could not be completed: invalid setup.\n");
  else process.stderr.write("Pairing could not be completed.\n");
  process.exitCode = 1;
} finally {
  input.close();
}
